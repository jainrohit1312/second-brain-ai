import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './types/database';

/**
 * The Postgres schema holding every Second Brain table, enum, and RPC.
 *
 * Deliberately **not** `public`. All application objects live in their own schema
 * so that `public` carries none of this product's tables, PostgREST's
 * exposed-schema list stays explicit (`supabase/config.toml` → `[api].schemas`),
 * and the privilege story is auditable in one place.
 *
 * Binding the schema here — rather than qualifying every call — is what lets the
 * query modules keep writing `.from('documents')` unqualified.
 *
 * Changing this value requires three things to move together: this constant,
 * `[api].schemas` in `supabase/config.toml`, and the top-level key of `Database`
 * in `./types/database.ts`. Miss the third and queries type-check but resolve
 * against the wrong schema.
 */
export const DEFAULT_SCHEMA = 'second_brain';

/** A Supabase client bound to `second_brain` — see {@link DEFAULT_SCHEMA}. */
export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Which credential a client was built with, and therefore whether Row Level
 * Security is doing any work.
 *
 * - `public` — the anon key. RLS applies, `auth.uid()` is whatever JWT the
 *   client carries (usually none), and every user-scoped query is filtered by
 *   policy. Safe in a browser or an extension bundle.
 * - `service` — the service-role key. RLS is bypassed entirely and every row of
 *   every table is visible. Server processes only.
 */
export type ClientMode = 'public' | 'service';

/**
 * Auth options passed through to `createClient`. All default to `false`, because
 * every factory here is aimed at a server process or a per-request client;
 * browser code that wants a persisted session passes them explicitly.
 */
export interface ClientAuthOptions {
  persistSession?: boolean;
  autoRefreshToken?: boolean;
  detectSessionInUrl?: boolean;
}

/** A client built from the anon key. RLS applies. */
export interface PublicClientConfig {
  mode: 'public';
  url: string;
  anonKey: string;
  auth?: ClientAuthOptions;
}

/**
 * A client built from the service-role key. RLS is bypassed — instantiating one
 * is a security decision, not a convenience.
 */
export interface ServiceClientConfig {
  mode: 'service';
  url: string;
  serviceRoleKey: string;
  auth?: ClientAuthOptions;
}

/**
 * Client configuration, discriminated on `mode` so that the two credentials can
 * never be confused: a service client has no `anonKey` field to fall back on,
 * and a public client has no `serviceRoleKey` field to fill in by accident.
 */
export type SupabaseClientConfig = PublicClientConfig | ServiceClientConfig;

/** Env vars read by `supabaseFromEnv`; see `.env.example`. */
export type DatabaseEnv = Readonly<Record<string, string | undefined>>;

/** Options for {@link DbError}. */
export interface DbErrorOptions {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  cause?: unknown;
}

/** Postgres `unique_violation` — an insert collided with a unique index. */
const UNIQUE_VIOLATION = '23505';

/** Postgres `foreign_key_violation` — the referenced row does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';

/** Postgres `undefined_table` — a migration has not been applied. */
const UNDEFINED_TABLE = '42P01';

const SUPABASE_URL_ENV_KEY = 'SUPABASE_URL';
const SUPABASE_ANON_KEY_ENV_KEY = 'SUPABASE_ANON_KEY';
const SUPABASE_SERVICE_ROLE_KEY_ENV_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/** Default auth options for every client this module builds. */
const SERVER_AUTH_DEFAULTS: ClientAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

/**
 * Error type for everything this package raises: a normalized wrapper around
 * PostgREST/Postgres failures, so `code`, `details` and `hint` do not have to be
 * re-read off a plain object at every call site.
 */
export class DbError extends Error {
  /** Postgres SQLSTATE, or `null` for a transport/configuration failure. */
  readonly code: string | null;
  /** Postgres `DETAIL` line, when the server sent one. */
  readonly details: string | null;
  /** Postgres `HINT` line, when the server sent one. */
  readonly hint: string | null;

  constructor(message: string, options: DbErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'DbError';
    this.code = options.code ?? null;
    this.details = options.details ?? null;
    this.hint = options.hint ?? null;
  }
}

/**
 * Builds a typed client from an explicit configuration.
 *
 * **Security boundary.** The `service` mode bypasses Row Level Security
 * completely: it can read and write every user's rows, and it must only ever be
 * instantiated in a server process (`services/*`, `supabase/functions/*`) from
 * `SUPABASE_SERVICE_ROLE_KEY`. Never construct one inside `apps/web` or
 * `apps/chrome-extension`, and never ship that key to a client bundle — the
 * discriminated union makes the mistake obvious in review, but it cannot detect
 * a leaked key at runtime.
 */
export function createSupabaseClient(config: SupabaseClientConfig): TypedSupabaseClient {
  const auth: ClientAuthOptions = { ...SERVER_AUTH_DEFAULTS, ...config.auth };

  if (config.mode === 'service') {
    return createClient<Database>(config.url, config.serviceRoleKey, {
      auth,
      db: { schema: DEFAULT_SCHEMA },
    });
  }
  return createClient<Database>(config.url, config.anonKey, {
    auth,
    db: { schema: DEFAULT_SCHEMA },
  });
}

/**
 * Builds a client from the environment.
 *
 * Reads `SUPABASE_URL` plus `SUPABASE_ANON_KEY` (`mode: 'public'`) or
 * `SUPABASE_SERVICE_ROLE_KEY` (`mode: 'service'`). The mode defaults to
 * `'public'` on purpose: a service client must be asked for by name, so that a
 * missing variable fails loudly instead of silently escalating privileges.
 * Throws {@link DbError} when the URL or the key for the requested mode is unset.
 */
export function supabaseFromEnv(
  env: DatabaseEnv,
  mode: ClientMode = 'public',
): TypedSupabaseClient {
  const url = readRequiredEnv(env, SUPABASE_URL_ENV_KEY);

  if (mode === 'service') {
    return createSupabaseClient({
      mode: 'service',
      url,
      serviceRoleKey: readRequiredEnv(env, SUPABASE_SERVICE_ROLE_KEY_ENV_KEY),
    });
  }

  return createSupabaseClient({
    mode: 'public',
    url,
    anonKey: readRequiredEnv(env, SUPABASE_ANON_KEY_ENV_KEY),
  });
}

/**
 * Builds a per-request client that carries a user's access token, so that
 * `auth.uid()` resolves in Postgres and RLS policies evaluate for that user.
 *
 * This is the shape server-side request handling needs: one client per request,
 * no session persistence, no refresh. The anon key is the credential the token
 * rides on — the token, never the service-role key, is what identifies the user.
 * An expired token yields empty results rather than an error, because RLS filters
 * rows instead of rejecting the query.
 */
export function createUserScopedClient(
  url: string,
  anonKey: string,
  accessToken: string,
): TypedSupabaseClient {
  return createClient<Database>(url, anonKey, {
    auth: SERVER_AUTH_DEFAULTS,
    db: { schema: DEFAULT_SCHEMA },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Normalizes anything thrown or returned by the client into a {@link DbError},
 * preserving SQLSTATE. Supabase returns failures as a plain `PostgrestError`
 * object rather than an `Error`, which is why this exists.
 */
export function asDbError(error: unknown): DbError {
  if (error instanceof DbError) return error;

  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    return new DbError(readString(candidate.message) ?? 'Database error', {
      code: readString(candidate.code),
      details: readString(candidate.details),
      hint: readString(candidate.hint),
      cause: error,
    });
  }

  return new DbError(typeof error === 'string' ? error : 'Unknown database error', {
    cause: error,
  });
}

/**
 * True for a `23505` unique violation. The dedup path expects this shape rather
 * than pre-checking: `activity_events` has a unique index on
 * `(user_id, dedupe_key)`, and a conflict there means the event is already
 * stored, which is a normal outcome during a re-sync.
 */
export function isUniqueViolation(error: unknown): boolean {
  return asDbError(error).code === UNIQUE_VIOLATION;
}

/**
 * True for a `23503` foreign key violation — an insert referenced a row that
 * does not exist, most often a device id the server has never seen.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return asDbError(error).code === FOREIGN_KEY_VIOLATION;
}

/**
 * True for a `42P01` undefined table — the schema this process expects is not
 * deployed, i.e. the migration or `pnpm db:start` has not run yet.
 */
export function isUndefinedTable(error: unknown): boolean {
  return asDbError(error).code === UNDEFINED_TABLE;
}

/** Reads an env var, rejecting an unset or blank value with a {@link DbError}. */
function readRequiredEnv(env: DatabaseEnv, key: string): string {
  const raw = env[key];
  const value = raw === undefined ? undefined : raw.trim();
  if (value === undefined || value === '') {
    throw new DbError(`Missing required environment variable ${key}.`, { code: null });
  }
  return value;
}

/** Narrows an unknown field of a PostgREST error object to a string. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
