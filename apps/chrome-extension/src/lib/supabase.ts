import { createClient } from '@supabase/supabase-js';

import { AUTH_STORAGE_KEY, ChromeLocalStorage } from './storage';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for the extension.
 *
 * Secret-handling contract: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may
 * enter this bundle. The extension ships as a zip that any user can unpack and read, so
 * anything bundled is public — the anon key is safe only because Row Level Security on
 * every table restricts it to what the signed-in user may already see.
 * `SUPABASE_SERVICE_ROLE_KEY` must never be referenced from this workspace.
 */

/** Build-time environment as Vite exposes it. Public values only. */
interface ExtensionEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_API_BASE_URL?: string;
  VITE_SYNC_INTERVAL_SECONDS?: string;
}

/** Configuration resolved from the build-time env. */
export interface ExtensionRuntimeConfig {
  supabaseUrl: string;
  /** Public anon key. RLS, not secrecy, is what protects the data. */
  supabaseAnonKey: string;
  /**
   * Base URL of the retrieval and chat HTTP API (`services/retrieval`). Ingestion does
   * NOT use it: activity batches go to the `process-activity` edge function, which
   * `functions.invoke` addresses from `supabaseUrl` (see `postActivityBatch` in
   * `background/sync.ts`, and ADR-022).
   */
  apiBaseUrl: string;
  /** Desired background sync period in seconds; the alarm floor wins if it is larger. */
  syncIntervalSeconds: number;
}

/** Header attached to every request so the API can attribute the calling client. */
export const EXTENSION_CLIENT_HEADER = 'x-second-brain-client';
/** Value of {@link EXTENSION_CLIENT_HEADER}. */
export const EXTENSION_CLIENT_NAME = 'chrome-extension';
/** Retrieval API base used when `VITE_API_BASE_URL` is unset. Not an ingestion address. */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8787';
/** Sync period used when `VITE_SYNC_INTERVAL_SECONDS` is unset. */
export const DEFAULT_SYNC_INTERVAL_SECONDS = 120;

/**
 * Reads and validates the Vite env. Throws when a required variable is missing rather
 * than failing later with an opaque network error — an unset `VITE_SUPABASE_ANON_KEY`
 * otherwise surfaces as a 401 on the first sync, hours after the build.
 */
export function readExtensionEnv(): ExtensionRuntimeConfig {
  const env = import.meta.env as unknown as ExtensionEnv;

  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
  const missing: string[] = [];
  if (!supabaseUrl) {
    missing.push('VITE_SUPABASE_URL');
  }
  if (!supabaseAnonKey) {
    missing.push('VITE_SUPABASE_ANON_KEY');
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `Missing extension env: ${missing.join(', ')}. Set them in the repo root .env ` +
        '(see .env.example) and rebuild — Vite inlines env values at build time.',
    );
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl: env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    syncIntervalSeconds: Number(env.VITE_SYNC_INTERVAL_SECONDS ?? DEFAULT_SYNC_INTERVAL_SECONDS),
  };
}

/**
 * Creates the Supabase client used by the service worker and the extension pages.
 *
 * **Auth only.** This client exists for GoTrue — session restore, refresh, and the
 * signed-in user's id. GoTrue's objects live in the `auth` schema, so nothing here
 * depends on the application schema.
 *
 * The extension deliberately does NOT read or write application tables. Capture goes
 * to the `process-activity` edge function — through `supabase.functions.invoke(...)`
 * against `supabaseUrl`, which is why no ingestion path points at `apiBaseUrl` and none
 * points at PostgREST — and that is what keeps clients on the anon key with no write
 * path to the database (see ADR-018 and ADR-022).
 *
 * If direct table access is ever added here, the client MUST bind the schema:
 * `createClient(url, key, { db: { schema: 'second_brain' }, … })`. Every application
 * table lives in `second_brain`, and PostgREST's default schema is `public`, which
 * holds none of them — so omitting it produces "relation does not exist" for a table
 * that exists. `DEFAULT_SCHEMA` in `@second-brain/database` is the single definition
 * of that name; this workspace does not depend on that package, and should not gain
 * the dependency merely to restate it.
 *
 * The session is persisted through the `chrome.storage.local` adapter in `storage.ts`.
 * That wiring is not optional in an MV3 service worker: `persistSession` makes GoTrue
 * touch storage on the very first auth call, and the default adapter writes to
 * `window.localStorage`, which does not exist in a worker — the call throws before any
 * request is made. The adapter therefore has to be in place before the client is used,
 * which is why it is passed here rather than injected later.
 */
export function createExtensionClient(): SupabaseClient {
  const config = readExtensionEnv();

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: new ChromeLocalStorage(),
      // Logical key only; the adapter adds the `sb:` namespace prefix.
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // There is no page URL to parse in a worker or a popup, and an extension has no
      // origin to redirect back to; the magic-link callback path is a later phase.
      detectSessionInUrl: false,
    },
    global: {
      headers: { [EXTENSION_CLIENT_HEADER]: EXTENSION_CLIENT_NAME },
    },
  });
}
