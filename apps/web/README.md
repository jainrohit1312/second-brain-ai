# @second-brain/web

Next.js 14 (App Router) front end: cited chat over your captured activity, an activity dashboard,
and provider/rule/device settings.

## Status

**Phase 1c-1 — authenticated reads over real captured data.** What works today:

- **Auth.** `src/middleware.ts` refreshes the session and gates every route except `/login`, and
  `app/(app)/layout.tsx` re-checks it server-side. Sign-in is email + password against the same
  Supabase account the extension syncs to; the header carries sign-out.
- **Dashboard** (`/dashboard`): today's page views, the week's document count, the top five domains,
  the last 50 activity events, and the last 20 documents with their word count and extraction status.
- **Search** (`/search`): ranked PostgreSQL full-text search over `documents.extracted_text`,
  through the `/api/search` route handler and the `second_brain.search_documents` RPC.
- **Chat** (`/chat`): retrieve → answer → cite. `/api/chat` pulls the five best-matching documents,
  builds a cited context, and calls DeepSeek server-side. Answers render with `SourceCitation` popovers.
- Routing, layout, theming tokens, and the shared UI primitives.

What does **not** exist yet:

- **`/settings` is still a shell.** Every control is local state; nothing is persisted and no request
  is sent.
- **Chat has two of its four modes.** `recall` and `ask` answer from documents; `reflect` and
  `activity` return `501 — coming in phase 1c-2`, which the transcript surfaces as a note.
- **Answers are neither streamed nor persisted.** `/api/chat` returns a complete answer and the
  transcript lives in component state only.
- **No embeddings and no vector search** (phase 1c-2): retrieval is the full-text leg alone.
- **The transcript starts empty.** The phase-1a example question and answer are gone, because the
  surface now answers real questions.
- `src/lib/api.ts` is still the **services-API** contract (POST `/ask`, `/ingest`, `/devices`,
  `/activity/stats`) and every call in it still throws — those endpoints belong to `services/*`, which
  this app does not talk to yet. Chat deliberately does not use it; it calls the route handler.
- **`TimeByTopic`, `TopicCloud` and `RecentActivity` are unused.** Per-topic dwell time and topic
  assignment are phase-1c-2 work; the components are kept for it.

## Route map

| Route         | File                               | Rendering       | Purpose                                                                |
| ------------- | ---------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `/login`      | `src/app/login/page.tsx`           | Server + client | Email/password sign-in. The one route outside the auth guard.          |
| `/`           | `src/app/(app)/page.tsx`           | Server          | Landing: product summary and entry-point cards.                        |
| `/chat`       | `src/app/(app)/chat/page.tsx`      | Client          | Transcript, mode selector, composer. Posts to `/api/chat`.             |
| `/dashboard`  | `src/app/(app)/dashboard/page.tsx` | Server          | Stats tiles, activity feed, recent documents. Reads under RLS.         |
| `/search`     | `src/app/(app)/search/page.tsx`    | Server + client | Search box and results. Posts nothing; reads `/api/search`.            |
| `/settings`   | `src/app/(app)/settings/page.tsx`  | Server          | Provider config, importance rules, device list. All still local state. |
| `/api/search` | `src/app/api/search/route.ts`      | Route handler   | `GET ?q=` → ranked full-text search. Session required.                 |
| `/api/chat`   | `src/app/api/chat/route.ts`        | Route handler   | `POST { question, mode }` → retrieve, answer, cite. Session required.  |

Route groups: everything under `(app)/` shares the signed-in layout and the session check; `/login`
sits outside it, and `middleware.ts` redirects between the two.

## Layout

```
apps/web/
├── src/
│   ├── middleware.ts               # session refresh + route guard (matcher: everything but assets)
│   ├── app/
│   │   ├── layout.tsx              # metadata, Inter font, globals.css, QueryProvider
│   │   ├── providers.tsx           # 'use client' React Query provider
│   │   ├── login/                  # the one route outside the guard
│   │   │   ├── page.tsx            #   server: sanitizes `?next=`, renders the form
│   │   │   └── components/
│   │   │       └── SignInForm.tsx  #   client: email + password, signInWithPassword
│   │   ├── (app)/                  # protected group: session check, then the header
│   │   │   ├── layout.tsx          #   server: getUser() → redirect('/login')
│   │   │   ├── components/
│   │   │   │   └── Header.tsx      #   client: nav, identity, sign-out
│   │   │   ├── page.tsx            #   server: landing / entry point
│   │   │   ├── chat/
│   │   │   │   ├── page.tsx        #   client: transcript + composer state
│   │   │   │   └── components/
│   │   │   │       ├── MessageList.tsx     # transcript, empty state, streaming caret
│   │   │   │       ├── MessageInput.tsx    # textarea composer, Enter/Shift+Enter, stop
│   │   │   │       ├── SourceCitation.tsx  # inline [n] marker + hover card
│   │   │   │       └── ModeSelector.tsx    # ask | recall | reflect | activity
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx        #   server: five concurrent RLS-scoped reads
│   │   │   │   └── components/
│   │   │   │       ├── StatsRow.tsx        # pages today, documents this week, top domains
│   │   │   │       ├── ActivityFeed.tsx    # activity_events, newest first
│   │   │   │       ├── RecentDocuments.tsx # documents + extraction status
│   │   │   │       ├── TimeByTopic.tsx     # (unused until 1c-2) recharts stacked bar
│   │   │   │       ├── RecentActivity.tsx  # (unused until 1c-2) older capture list
│   │   │   │       └── TopicCloud.tsx      # (unused until 1c-2) weighted tag cloud
│   │   │   └── settings/
│   │   │       ├── page.tsx        # placeholder devices + panel composition
│   │   │       └── components/
│   │   │           ├── ProviderConfig.tsx  # embedding/LLM pickers, test connection
│   │   │           ├── RulesConfig.tsx     # importance threshold + signal weights
│   │   │           └── DeviceList.tsx      # device table with revoke
│   │   └── api/
│   │       ├── search/route.ts     # GET ?q= → search_documents RPC, ranked
│   │       └── chat/route.ts       # POST { question, mode } → retrieve, answer, cite
│   ├── components/ui/          # Button, Card, Input, Skeleton
│   ├── lib/
│   │   ├── api.ts              # services-API contract (all calls still throw)
│   │   ├── queries.ts          # server-side reads: dashboard queries + search RPC
│   │   ├── supabase.ts         # browser + server client factories
│   │   ├── supabase-server.ts  # next/headers cookie adapter (server-only module)
│   │   └── utils.ts            # cn, formatDuration, formatRelativeDay, formatPercent
│   └── styles/globals.css      # Tailwind layers + semantic HSL tokens
├── public/README.md            # placeholder for logo/og-image/favicons
├── .eslintrc.json
├── next.config.js
├── postcss.config.js
├── tailwind.config.ts
└── tsconfig.json
```

`next-env.d.ts` is generated by `next dev` / `next build`; do not create it by hand.

## Scripts

| Script      | Command                        | Notes                                            |
| ----------- | ------------------------------ | ------------------------------------------------ |
| `dev`       | `next dev`                     | Serves on :3000. Requires the env vars below.    |
| `build`     | `next build`                   | Also regenerates `.next/types` for typed routes. |
| `start`     | `next start`                   | Serves the production build.                     |
| `lint`      | `next lint`                    | Extends `next/core-web-vitals` + `prettier`.     |
| `typecheck` | `tsc --noEmit`                 | Next compiles the app; this only type-checks it. |
| `test`      | `vitest run --passWithNoTests` | No test files yet.                               |
| `clean`     | `rimraf .next .turbo`          | Removes build output and the Turborepo cache.    |

From the repo root, use `pnpm --filter @second-brain/web <script>` or `turbo run <script>`.

## Configuration

**Public** — `NEXT_PUBLIC_*`, inlined into the browser bundle at build time:

| Variable                        | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project origin. Also allow-listed in the CSP `connect-src`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe key. RLS — not the key — is the security boundary.      |
| `NEXT_PUBLIC_API_BASE_URL`      | Base URL of the services API used by `apiFetch`.                     |

**Server-only** — read inside route handlers, never inlined into a client chunk:

| Variable            | Purpose                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`  | Answer-model credential for `/api/chat`. Unset ⇒ that route returns `500` naming the variable; everything else works. |
| `DEEPSEEK_BASE_URL` | Defaults to `https://api.deepseek.com/v1` (the same value as `DEEPSEEK_LLM_DEFAULTS`).                                |
| `DEEPSEEK_MODEL`    | Defaults to `deepseek-chat`.                                                                                          |

Rules the code depends on:

- **A secret never carries a `NEXT_PUBLIC_` prefix.** Those values are public, and the service-role
  key bypasses RLS. The DeepSeek key is unprefixed precisely so Next cannot inline it; `/api/chat`
  reads it from `process.env` at request time and the browser never sees it.
- **`SUPABASE_SERVICE_ROLE_KEY` must never appear here.** Reads use the caller's session; RLS is the
  boundary, and there is no service-role client in this app.
- Server-side secrets for the capture pipeline still belong to `services/*` and
  `supabase/functions`, which read them from their own environment.

### Which env file wins

Next loads `.env*` from the app directory, so `apps/web/.env.local` is this app's own file. But
`@next/env` does **not** overwrite a variable that is already present in `process.env` — so if your
shell, terminal profile, or dev daemon exports the repo-root `.env`, that copy wins and
`apps/web/.env.local` is silently ignored. That matters here because the repo-root `.env` points
`NEXT_PUBLIC_SUPABASE_URL` at the **local** stack (`127.0.0.1:55321`) while the extension writes to
the hosted project: exported, it sends the web app to the wrong database and, with its empty
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, every Supabase call fails at request time with _"Your project's URL
and Key are required to create a Supabase client!"_. Fix it by pointing the root `.env` at the project
you actually want, or by not exporting the root `.env` at all.

### `NODE_ENV` must not be `development` for a build

`next build` needs `NODE_ENV=production`, and Next only sets it itself when it is unset. If the
environment already says `development` (the repo-root `.env` sets exactly that), Next builds the
production bundle while React resolves its development internals, and prerendering fails for **every**
page with `Cannot read properties of null (reading 'useContext')`. Next prints a warning —
_"You are using a non-standard NODE_ENV value"_ — immediately before it does. Either keep `NODE_ENV`
out of the exported environment, or build with:

```
set "NODE_ENV=production" && pnpm --filter @second-brain/web build
```

### Content Security Policy

`next.config.js` sends a strict CSP plus `X-Frame-Options: DENY`, `Referrer-Policy`,
`X-Content-Type-Options`, and a `Permissions-Policy` that denies camera, microphone, and
geolocation. The policy is assembled at config-evaluation time, so the Supabase origin from
`NEXT_PUBLIC_SUPABASE_URL` (and its `ws://` sibling used by Realtime) lands in `connect-src`
automatically — that entry is mandatory, and a new backend host must be added there or the browser
blocks the request before it leaves the page.

`script-src` currently includes `'unsafe-inline'` and `'unsafe-eval'` for the dev server.
TODO(phase-2): move to nonces/hashes and drop `'unsafe-eval'` for production.

## Client / server component split

Server components are the default; `'use client'` is added only where a component owns state or a
browser-only dependency:

- **Server:** `/`, `/dashboard`, `/search` (the page shell), `/settings`, `/login` (the section that
  sanitizes the return path), `RecentDocuments`, `StatsRow`, `ActivityFeed`, `TopicCloud`,
  `RecentActivity`. These read and format data; all interactivity lives in the client islands they
  compose.
- **Client:** `providers.tsx` (React Query), `Header` (navigation + sign-out), `SignInForm`, `/chat`
  and its four components (transcript, mode, composer), `SearchPanel` (the box, the fetch, the result
  list), `TimeByTopic` (recharts renders SVG in the browser), `ProviderConfig`, `RulesConfig`,
  `DeviceList`.
- **Route handlers** (`/api/search`, `/api/chat`) are server-only by construction: they read the
  session from the request cookies and never render UI.
- Pages and layouts use **default exports** (Next.js requires it); every component uses a **named
  export**.

Dates and formatting live in `src/lib/utils.ts` so server and client components format identically.

## Why `transpilePackages`

`next.config.js` lists `transpilePackages: ['@second-brain/shared', '@second-brain/database',
'@second-brain/providers']`. Workspace packages ship raw TypeScript (`declaration` only for tooling)
and are resolved through pnpm's symlinks, so Next's default SWC pass skips them; without this option
the build fails on the first `.ts` file it cannot parse. The names must stay in sync with the
workspace dependencies in `package.json`.

Note that the packages publish from `dist/`, so **a change under `packages/*/src` needs that package
rebuilt before this app sees it**: `pnpm --filter @second-brain/database build` (or `providers`).
`typecheck` resolves the same `dist/index.d.ts`, so a stale `dist` type-checks against last week's
types.

## Styling conventions

- TailwindCSS with `darkMode: 'class'`; `content` covers `./src/**/*.{ts,tsx}`.
- Semantic colours (`background`, `foreground`, `muted`, `border`, `primary`, `accent`,
  `destructive`, `ring`) are HSL triplets in CSS variables, declared in both `:root` and `.dark` in
  `src/styles/globals.css`. Components never hard-code a palette colour or a `dark:` colour pair —
  add a variable instead.
- Radii come from `--radius`; use `rounded-sm|md|lg` rather than `rounded-[10px]`.
- Class lists are composed with `cn()` (clsx + tailwind-merge) so a caller's `className` wins.
- UI primitives live in `src/components/ui` and are used everywhere instead of raw containers; each
  forwards refs and native props. Gaps that phase 2 should fill: a `Textarea` (chat composer) and a
  `Select` (provider pickers) — both are noted with TODOs at their call sites.
- Reusable buttons outside a `<form>` need a link-styled element: use
  `buttonVariants(variant, size)` from `Button.tsx` on a `<Link>`.

## Related docs

| Document                        | Contents                                                            |
| ------------------------------- | ------------------------------------------------------------------- |
| `../../docs/ARCHITECTURE.md`    | Where the web app sits in the capture → process → recall flow       |
| `../../docs/API_REFERENCE.md`   | Ingestion and retrieval HTTP surface behind `src/lib/api.ts`        |
| `../../docs/DATABASE_SCHEMA.md` | Tables and RLS policies the Supabase clients read through           |
| `../../docs/DECISIONS.md`       | ADR log, including the re-embed migration rule surfaced in settings |
| `../../docs/TASKS.md`           | Phased build order for the TODOs above                              |
