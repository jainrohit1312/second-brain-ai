import { AUTH_CODE_VERIFIER_SUFFIX, AUTH_STORAGE_KEY, ChromeLocalStorage } from './storage';
import { createExtensionClient } from './supabase';

import type { AuthStateSnapshot } from '@/types/events';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Authentication helpers.
 *
 * Storage contract: the session is persisted through a `chrome.storage.local` adapter and
 * never through `localStorage`. An MV3 service worker has no `localStorage` at all, and
 * `chrome.storage` is the only store that outlives worker eviction while remaining
 * readable from the popup, the side panel, and the content scripts. Every helper here is
 * safe to call from a cold worker: the session is rehydrated before any request.
 *
 * Scope note: this module owns a Supabase client built for GoTrue only. It reads no
 * application table — the `second_brain` schema is reached exclusively through the
 * `process-activity` edge function.
 */

/** Error code {@link requireAuth} rejects with, so callers can branch without importing the class. */
export const AUTH_REQUIRED_CODE = 'AUTH_REQUIRED';

/** Refresh a session once it is within this many seconds of expiry. */
export const AUTH_EXPIRY_SKEW_SECONDS = 60;

/** Rejection type for {@link requireAuth}; carries `code` for callers that only have `unknown`. */
export class AuthRequiredError extends Error {
  readonly code: string = AUTH_REQUIRED_CODE;

  constructor(message = 'Sign in to continue') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** True when `error` is this module's {@link AuthRequiredError}, however it was transported. */
export function isAuthRequiredError(error: unknown): boolean {
  if (error instanceof AuthRequiredError) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === AUTH_REQUIRED_CODE
  );
}

const authStorage = new ChromeLocalStorage();

/**
 * One client per worker/page instance.
 *
 * Not durable state: the client is a thin handle whose session is rehydrated from
 * `chrome.storage` on construction, so a fresh worker rebuilds it from the same values.
 * Memoising it keeps GoTrue's refresh timer and change listeners in one place per
 * context instead of one per call.
 */
let cachedClient: SupabaseClient | null = null;

/** Builds the client on first use, or null when the build is missing its Supabase env. */
function tryGetClient(): SupabaseClient | null {
  if (cachedClient !== null) {
    return cachedClient;
  }
  try {
    cachedClient = createExtensionClient();
    return cachedClient;
  } catch (error) {
    console.error('[second-brain] cannot build the Supabase client', error);
    return null;
  }
}

/** Builds the client or throws; for the calls that are meaningless without one. */
function getClient(): SupabaseClient {
  const client = tryGetClient();
  if (client === null) {
    throw new Error(
      'Supabase is not configured for this build. Set VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_ANON_KEY (see .env.example) and rebuild.',
    );
  }
  return client;
}

/** True once the session's access token is expired or inside {@link AUTH_EXPIRY_SKEW_SECONDS}. */
function isSessionExpired(session: Session, nowMs: number = Date.now()): boolean {
  if (typeof session.expires_at !== 'number') {
    return false;
  }
  return session.expires_at * 1_000 - AUTH_EXPIRY_SKEW_SECONDS * 1_000 <= nowMs;
}

/** Current session, or null when signed out or when the stored token has expired. */
export async function getSession(): Promise<Session | null> {
  const client = tryGetClient();
  if (client === null) {
    return null;
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error !== null || data.session === null) {
      return null;
    }
    return data.session;
  } catch (error) {
    // A cold worker with a corrupt stored session must read as "signed out", not crash
    // the caller: everything that needs a session already handles null.
    console.error('[second-brain] getSession failed', error);
    return null;
  }
}

/** Signs in with email and password; rejects with the Supabase auth error on failure. */
export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const client = getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    throw new Error(error.message);
  }
  if (data.session === null) {
    throw new Error('Sign-in succeeded but no session was returned');
  }
  return data.session;
}

/**
 * Sends a one-time login link or code to the address; resolves once the mail is queued.
 *
 * Phase 1a limitation: the emailed link opens a normal web page, and this client runs with
 * `detectSessionInUrl: false`, so a magic link completed in a browser tab does not sign
 * the extension in. Password sign-in is the supported path until the extension gets its
 * own callback route.
 */
export async function signInWithOtp(email: string): Promise<void> {
  const client = getClient();
  const { error } = await client.auth.signInWithOtp({ email });
  if (error !== null) {
    throw new Error(error.message);
  }
}

/**
 * Clears the stored session and any cached user state; the queue is left intact.
 *
 * Never rejects. A sign-out that fails because the network is down must still leave the
 * client signed out locally, or the user cannot switch accounts while offline.
 */
export async function signOut(): Promise<void> {
  const client = tryGetClient();
  if (client !== null) {
    try {
      const { error } = await client.auth.signOut();
      if (error !== null) {
        console.warn('[second-brain] signOut reported an error; clearing local state anyway', error);
      }
    } catch (error) {
      console.warn('[second-brain] signOut request failed; clearing local state anyway', error);
    }
  }

  try {
    await authStorage.removeItem(AUTH_STORAGE_KEY);
    await authStorage.removeItem(`${AUTH_STORAGE_KEY}${AUTH_CODE_VERIFIER_SUFFIX}`);
  } catch (error) {
    console.error('[second-brain] failed to clear the stored session', error);
  }
}

/**
 * Access token for the ingestion and retrieval API, or null when signed out. Callers must
 * not cache it: the adapter refreshes it when it is close to expiry.
 */
export async function getAccessToken(): Promise<string | null> {
  const client = tryGetClient();
  if (client === null) {
    return null;
  }

  const session = await getSession();
  if (session === null) {
    return null;
  }
  if (!isSessionExpired(session)) {
    return session.access_token;
  }

  try {
    const { data, error } = await client.auth.refreshSession();
    if (error !== null || data.session === null) {
      console.warn('[second-brain] session refresh failed', error);
      return null;
    }
    return data.session.access_token;
  } catch (error) {
    console.error('[second-brain] session refresh threw', error);
    return null;
  }
}

/**
 * Subscribes to auth changes across sign-in, sign-out, refresh, and expiry. Resolves with
 * an unsubscribe function; the handler receives the same snapshot the UI is sent.
 *
 * The current state is emitted immediately, so a caller that mounts after a sign-in is not
 * left waiting for the next transition. GoTrue's own `INITIAL_SESSION` event is skipped
 * for exactly that reason — it would be the same snapshot twice.
 */
export function onAuthStateChange(handler: (state: AuthStateSnapshot) => void): () => void {
  const client = tryGetClient();
  if (client === null) {
    handler(toAuthStateSnapshot(null));
    return () => {
      // Nothing was subscribed: the build has no Supabase env, so there is no client.
    };
  }

  void getSession().then((session) => handler(toAuthStateSnapshot(session)));

  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      return;
    }
    handler(toAuthStateSnapshot(session));
  });

  return () => data.subscription.unsubscribe();
}

/**
 * Guards a mutating call: resolves with a live session or rejects with an auth error, so
 * callers never have to distinguish "signed out" from "token expired".
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    throw new AuthRequiredError();
  }
  return session;
}

/** Projects a Supabase session onto the snapshot the extension protocol carries. */
export function toAuthStateSnapshot(session: Session | null): AuthStateSnapshot {
  if (session === null) {
    return { status: 'signed-out', userId: null, email: null, expiresAt: null };
  }

  const expiresAt =
    typeof session.expires_at === 'number'
      ? new Date(session.expires_at * 1_000).toISOString()
      : null;

  return {
    status: isSessionExpired(session) ? 'expired' : 'signed-in',
    userId: session.user.id,
    email: session.user.email ?? null,
    expiresAt,
  };
}
