/**
 * Next.js configuration for the Second Brain web app.
 *
 * Kept CommonJS on purpose: this workspace deliberately does not declare `"type": "module"`, so
 * `next.config.js` and `postcss.config.js` are loaded as CommonJS while every source file stays
 * ESM (TypeScript + `moduleResolution: "Bundler"`). `tailwind.config.ts` is TypeScript.
 */

/** @param {string | undefined} raw */
function toOrigin(raw) {
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

const supabaseOrigin = toOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const apiOrigin = toOrigin(process.env.NEXT_PUBLIC_API_BASE_URL);
/** Realtime and auth callbacks use the same host over ws://; empty strings are dropped below. */
const supabaseSocketOrigin = supabaseOrigin.replace(/^http/, 'ws');

/**
 * Content-Security-Policy for every route.
 *
 * `connect-src` MUST include the Supabase origin (NEXT_PUBLIC_SUPABASE_URL) and its `ws://`
 * sibling: supabase-js talks to `<origin>/auth/v1` and `<origin>/rest/v1`, and Realtime opens a
 * websocket on the same host. The services API origin is listed as well because every `/ask` and
 * `/ingest` call goes there. When a new backend host is introduced, add it here or the browser
 * will block the request before it leaves the page.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` in `script-src` are required by the Next.js dev server
 * (inline bootstrap script, React Fast Refresh). Tighten these to hashes/nonces and drop
 * `'unsafe-eval'` before production; see README "Content Security Policy".
 */
const connectSrc = ["'self'", supabaseOrigin, supabaseSocketOrigin, apiOrigin]
  .filter(Boolean)
  .join(' ');

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `connect-src ${connectSrc}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript, so Next must compile them as part of the app bundle.
  transpilePackages: ['@second-brain/shared', '@second-brain/database'],
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
