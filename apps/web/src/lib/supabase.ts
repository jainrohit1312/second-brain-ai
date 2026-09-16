import { DEFAULT_SCHEMA } from '@second-brain/database';
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cookie accessors a server caller must supply. In a Server Component / Server Action the concrete
 * implementation wraps `next/headers`' `cookies()`; in a Route Handler it wraps the `NextResponse`.
 * `setAll` is called by supabase-js whenever it refreshes the session.
 */
export interface CookieStore {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>): void;
}

/**
 * Reads a public Supabase env var. These are inlined into the client bundle at build time and are
 * safe to expose: they carry no privileges beyond what Row Level Security grants to the signed-in
 * user.
 */
function readPublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let browserClient: SupabaseClient | undefined;

/**
 * Returns the browser-side Supabase client, created on first use.
 *
 * Only the anon key is ever used here. RLS — not the client — is the security boundary, and the
 * service-role key must never appear in this app (or in any `NEXT_PUBLIC_*` variable), because
 * everything under `NEXT_PUBLIC_` ships to the browser.
 *
 * TODO(phase-2): parameterise with the generated `Database` type from `@second-brain/database`
 * so queries are typed end to end.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  browserClient ??= createBrowserClient(
    readPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    // Without this the client defaults to the `public` schema, which holds none of
    // this product's tables — so the first `client.from('documents')` would fail
    // with "relation does not exist" even though the table exists. Imported from
    // `@second-brain/database` rather than restated, so the schema name has exactly
    // one definition.
    { db: { schema: DEFAULT_SCHEMA } },
  );
  return browserClient;
}

/**
 * Creates a request-scoped Supabase client for Server Components, Server Actions, and Route
 * Handlers. Never share the returned client across requests: it carries the caller's session
 * cookies and therefore their RLS identity.
 *
 * TODO(phase-2): add the auth route handlers and `src/middleware.ts` that refresh the session and
 * feed this store.
 */
export function createSupabaseServerClient(cookies: CookieStore): SupabaseClient {
  return createServerClient(
    readPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => cookies.getAll(),
        setAll: (cookiesToSet: Parameters<CookieStore['setAll']>[0]) =>
          cookies.setAll(cookiesToSet),
      },
      db: { schema: DEFAULT_SCHEMA },
    },
  );
}
