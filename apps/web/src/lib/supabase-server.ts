import { cookies } from 'next/headers';

import { createSupabaseServerClient, type CookieStore } from './supabase';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Adapts `next/headers`' cookie jar to the {@link CookieStore} contract the Supabase factory takes.
 *
 * `setAll` is allowed to fail: in a Server Component the jar is read-only and throwing on the
 * refresh attempt is the documented behaviour. Nothing is lost, because `src/middleware.ts` runs on
 * every request and writes the refreshed cookies onto the response before the render starts — the
 * component only ever sees an already-refreshed session.
 */
export function nextCookieStore(): CookieStore {
  const store = cookies();

  return {
    getAll: () => store.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      } catch {
        // Server Component render: read-only jar. The middleware owns the refresh.
      }
    },
  };
}

/**
 * Request-scoped Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Thin wrapper over `createSupabaseServerClient` that supplies the `next/headers` cookie store, so
 * server code does not have to build one. Kept in its own module rather than in `./supabase.ts`
 * because that module is also imported by client components, and `next/headers` cannot be part of a
 * browser bundle.
 *
 * Never share the returned client across requests: it carries the caller's session cookies, and
 * therefore their RLS identity.
 */
export function createServerSupabaseClient(): SupabaseClient {
  return createSupabaseServerClient(nextCookieStore());
}
