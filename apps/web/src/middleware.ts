import { DEFAULT_SCHEMA } from '@second-brain/database';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** The one route reachable without a session. */
const LOGIN_PATH = '/login';

/**
 * Supabase public values, hardcoded because middleware runs on the Edge Runtime.
 *
 * Next.js 14 does not reliably expose .env.local values to the Edge bundle, even with
 * the `env` field set in next.config.js. These two values are NEXT_PUBLIC_* — already
 * shipped to the browser in every build — so hardcoding them here is not an exposure.
 */
const SUPABASE_URL = 'https://bgaasnmptcmuunppbogq.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnYWFzbm1wdGNtdXVucHBib2dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjcxMzUsImV4cCI6MjEwMTYwMzEzNX0.Kl2pbn3T1oyInGI5skIXUl2xEv7xzcSBtcckRl2hI9M';

/**
 * Session refresh and route protection.
 *
 * Every request passes through here first. `auth.getUser()` is what refreshes an expired access
 * token, and the refreshed cookies are written onto the response — which is why this has to live in
 * middleware rather than in a layout: a Server Component cannot write cookies.
 *
 * Authorization decisions:
 * - No session on a non-login path → redirect to `/login?next=<path>`, so the form can return the
 *   user to where they were headed.
 * - Session on `/login` → redirect to `/`.
 * - `/api/*` is refreshed but never redirected: a route handler answers with a JSON `401`, and a
 *   `307` to an HTML page is not a useful answer to `fetch()`.
 *
 * `DEFAULT_SCHEMA` is bound here as well, so a query issued from middleware cannot silently resolve
 * against `public`. Authentication itself is schema-independent (`/auth/v1`), but sharing one client
 * shape avoids a second, subtly different client later.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    db: { schema: DEFAULT_SCHEMA },
  });

  // Must be `getUser()` and not `getSession()`: only the former validates the token against the
  // auth server, and a forged cookie would otherwise look like a session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    return response;
  }

  if (!user && pathname !== LOGIN_PATH) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === LOGIN_PATH) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

/**
 * Everything except Next's build output, the icon, and static assets from `public/`.
 *
 * `/api` is deliberately included: the session refresh has to happen before a route handler reads
 * the cookies.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};