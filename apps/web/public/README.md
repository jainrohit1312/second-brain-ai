# apps/web — static assets

Placeholder directory. It exists so git tracks `public/`; Next.js serves everything in here from
the site root (`/logo.svg` → `apps/web/public/logo.svg`).

## Expected assets

| File                       | Purpose                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `logo.svg`                 | Wordmark used in the app header and the landing hero.                        |
| `icon.svg` / `favicon.ico` | Browser tab icon; `icon.svg` is picked up by the App Router file convention. |
| `apple-touch-icon.png`     | 180×180 home-screen icon (iOS).                                              |
| `og-image.png`             | 1200×630 social card referenced from the root `metadata`.                    |
| `robots.txt`               | Crawl rules — the app is private, so this should disallow everything.        |

## Notes

- Do not commit captured content, avatars, or provider keys here: anything in `public/` is
  served verbatim to anonymous visitors.
- `next build` copies this directory into `.next/static`; no import or config change is needed to
  add a file.
- Once `logo.svg` and `og-image.png` exist, reference them from `src/app/layout.tsx`'s
  `metadata` export (icons + openGraph).
