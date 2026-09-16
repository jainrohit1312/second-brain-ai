# Second Brain — Chrome Extension

A Manifest V3 extension that captures what you read, watch, select, and copy in the
browser, and feeds it into the Second Brain memory pipeline.

> **Status: Phase 1a — `page_view` capture works end to end.** Sign-in, capture, the
> durable queue, and the drain to the `process-activity` edge function are implemented.
> Everything else is listed explicitly under [Phase 1a: what works](#phase-1a-what-works).
> See the root [README](../../README.md) and `docs/TASKS.md` for the build order.

## Phase 1a: what works

**Live.**

| Area           | Behaviour                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | Email + password against Supabase Auth. The session is persisted in `chrome.storage.local` (never `localStorage` — an MV3 worker has none) and the access token is refreshed before expiry.                                            |
| Page views     | A `page_view` event is emitted when a page is hidden, navigated away from, or replaced by an SPA route change, carrying dwell time, maximum scroll depth, and the page domain.                                                          |
| Exclusion      | Loopback origins, a short sensitive-host list (banking, medical, password managers), and whatever is stored under `sb:excluded-domains` are checked **before an event object exists**, so an excluded page produces no payload at all.  |
| Scoring        | `scoreLocally()` with `IMPORTANCE_MIN_THRESHOLD` applied before the queue write. Explicit-intent event types (`bookmark`, `download`, `search`, `selection`, `copy`) bypass the threshold by contract.                                 |
| Queue          | Durable IndexedDB queue, idempotent on event id, capped at 20 000 records with lowest-importance eviction, and pruned by age at 7 days.                                                                                                |
| Sync           | One batch per drain. Acknowledges exactly what the server accounted for, including the ids the server rejected, so one poison event cannot wedge the queue.                                                                             |
| Flush triggers | The periodic alarm, a tab going hidden, an idle/lock transition, the 90-event threshold, worker startup, and the popup's **Sync now**.                                                                                                  |
| Popup          | Three real states (loading, signed out, signed in): queue depth, oldest queued, dropped count, last sync outcome *and its error*, capture toggle, sign out, and the side-panel shortcut.                                                 |

**Stubbed.** Each of these has its module and its contract in place but is not wired into
the capture path. They are Phase 2 work, listed in `docs/TASKS.md`:

- `youtube_watch` — `src/content/youtube.ts` is contracts only.
- `selection` / `copy` — `src/content/selection.ts` is implemented, but no observer is
  started, so no selection is ever emitted.
- `page_read` — `src/content/extractor.ts` implements the Readability extraction; nothing
  calls it yet, so no document body is extracted and no `page_read` event exists.
- `bookmark`, `download`, `search` — no context menus, no downloads or history wiring.
- Side-panel chat — the panel renders an empty transcript and the router refuses
  `ASK_QUESTION`.
- Magic-link sign-in — the mail is sent, but the link opens a web page and this client runs
  with `detectSessionInUrl: false`, so a link cannot sign the extension in. Use a password.
- Device registration — no `register-device` function exists yet, so `VITE_DEVICE_ID` must
  name a device row that already exists for the signed-in user.

### What actually gets captured

The pre-filter is a real gate, not a formality: the positive client weights sum to 1.37 and
`DEFAULT_CAPTURE_THRESHOLD` is `0.15`, so **three signals clear the line unaided** —
saturated dwell (0.30, reached at 10 s of attention), a full scroll, and a maximal
`topicNovelty` (0.15 each). Every other signal still has to combine with something. In
practice:

| Visit                                    | Score | Captured? |
| ---------------------------------------- | ----- | --------- |
| 4 s, no scrolling                        | 0.12  | no        |
| 10 s, no scrolling                       | 0.30  | yes       |
| Scrolled to the bottom, no dwell         | 0.15  | yes       |
| 30 s, scrolled to the bottom             | 0.45  | yes       |
| 30 s, no scrolling, inside working hours | 0.33  | yes       |
| 2 min, 80 % scroll, readable article     | 0.56  | yes       |
| A bookmark or a download                 | —     | always    |

So a sub-five-second glance with no scroll and no novelty is still not recorded. Beyond that,
the bar is attention alone rather than attention _plus_ depth. When verifying the pipeline end
to end, ten seconds on the page is enough; scrolling is no longer required, and a bookmark
still works.

## What it captures

| Signal                         | Event type                       | How it is collected                                                                              |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pages read                     | `page_view`, `page_read`         | Dwell time, scroll depth, and a Readability extraction when the page clears the noise threshold. |
| Text selections                | `selection`                      | Selections longer than `MIN_SELECTION_CHARS` on a non-excluded origin.                           |
| Copied text                    | `copy`                           | The same rule as selections, triggered by the `copy` event.                                      |
| Video watches                  | `youtube_watch`                  | Playback sampled every `WATCH_PING_INTERVAL_MS` and flushed on visibility change and unload.     |
| Bookmarks, downloads, searches | `bookmark`, `download`, `search` | Browser APIs plus the search engine result page in the active tab.                               |
| App sessions                   | `app_session`                    | **Not this workspace** — the Android watcher produces these.                                     |

The table describes the design. Only `page_view` is wired today — see
[Phase 1a: what works](#phase-1a-what-works) for the boundary.

Page bodies are never uploaded raw: extraction happens in the page process and only the
resulting text leaves the tab. Selections and page text are skipped entirely for origins
on the user's exclusion list.

## Capture pipeline

```
content script          service worker                         server
──────────────          ──────────────                         ──────
observe DOM
  └─ build draft ──► score    scoreLocally() / shouldCapture()   recomputes the score
                     dedupe   contentDedupeKey() + RecentKeyRing  dedupes on dedupeKey
                     queue    QueueStore → IndexedDB (durable)
                     sync     flushQueue() ──── batched POST ──► ingestion service
                              acknowledge(everything accounted   returns serverCursor
                              for, rejected ids included)
```

1. **Capture** — a content script watches the document, applies the exclusion rules, and
   builds an `ActivityEvent` draft. It knows the page, not the device, so `id`, `deviceId`,
   `dedupeKey`, and `importance` are left to the worker (`CapturedEventDraft` in
   `src/types/events.ts`).
2. **Score** — `scoreLocally()` applies the client weights and drops anything below
   `DEFAULT_CAPTURE_THRESHOLD` (0.15). The queue must not fill with noise while offline,
   and the server re-scores every accepted event anyway.
3. **Dedupe** — `contentDedupeKey()` combines page identity with a content hash, and a
   bounded in-memory ring suppresses the burst a render loop produces.
4. **Queue** — survivors go into IndexedDB. This is the durability boundary: an accepted
   event outlives worker eviction, browser restart, and crash, which is why the queue is
   not an in-memory array.
5. **Sync** — the periodic alarm, a tab going hidden, an idle transition, the 90-event
   threshold, or the popup's button drains one batch. Everything the response accounted for
   is acknowledged — accepted, duplicate, and rejected — so delivery is at-least-once, the
   server's `dedupeKey` makes the repeats harmless, and a batch the server refuses to
   accept cannot be retried forever.

## Layout

```
apps/chrome-extension/
  manifest.json              Manifest V3, the source of truth for entries and permissions
  vite.config.ts             CRXJS + React; rewrites the manifest into dist/
  tsconfig.json              Strict TS, jsx: react-jsx, `@/*` → ./src/*
  scripts/
    generate-placeholder-icons.mjs   Writes the four icons the manifest requires
  public/icons/              Generated placeholder PNGs + how to replace them
  src/
    background/
      index.ts               MV3 service worker entry: listeners, the message router, capture
      queue.ts               QueueStore contract + IndexedDbQueue (durability boundary)
      sync.ts                Batching, backoff, flushQueue, and the periodic sync alarm
      idle.ts                chrome.idle transitions → flush and pause
    content/
      index.ts               Content script entry: page-view lifecycle, history hooks
      page-view.ts           The page_view draft builder (pure; schema-tested)
      exclusions.ts          Loopback, sensitive-host, and user exclusion rules
      extractor.ts           @mozilla/readability wrapper with a minimum-length floor
      selection.ts           Selection and copy capture with the privacy rule
      youtube.ts             Video detection and watch-progress accumulation
    popup/
      index.html, index.tsx, styles.css    Status, queue depth, sync toggle
    sidepanel/
      index.html, index.tsx, styles.css    Search, chat transcript, citations
    lib/
      supabase.ts            Client construction, build-time env, and the storage adapter
      storage.ts             chrome.storage.local adapter + namespaced keys
      auth.ts                Session helpers on chrome.storage, never localStorage
      settings.ts            Local settings, counters, and change subscriptions
      device.ts              Phase 1a device identity (no server registration yet)
      messages.ts            The protocol's zod schemas and the two send helpers
      scoring.ts             Client-side importance pre-filter
      dedup.ts               Content-hash keys and the recent-key ring
    types/
      events.ts              Extension-internal message and port protocol
```

## Scripts

| Script      | Command                                              | Purpose                                                                                       |
| ----------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `build`     | `vite build`                                         | Emits a loadable extension into `dist/`.                                                      |
| `dev`       | `vite build --watch`                                 | Rebuilds `dist/` on change; reload the extension in `chrome://extensions` after each rebuild. |
| `lint`      | `eslint src --ext .ts,.tsx`                          | Lint with the root config.                                                                    |
| `typecheck` | `tsc --noEmit`                                       | Strict type check of `src`.                                                                   |
| `test`      | `vitest run --passWithNoTests`                       | Unit tests; passes while no test exists.                                                      |
| `clean`     | `rimraf dist .turbo`                                 | Removes build output.                                                                         |
| `zip`       | `cd dist && bestzip ../second-brain-extension.zip *` | Packages `dist/` for the Chrome Web Store.                                                    |

Run them from the repo root as `pnpm --filter @second-brain/chrome-extension <script>`.

## Permissions

Every permission in `manifest.json` is requested for a reason that cannot be deferred to
a later prompt. Nothing here is for analytics.

| Permission / host                                           | Justification                                                                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                   | MV3 persistence for settings, the device id, and the auth session — `localStorage` does not exist in a service worker.                                                                         |
| `idle`                                                      | Detect machine idle and screen lock so the queue flushes and capture pauses while the user is away.                                                                                            |
| `alarms`                                                    | Periodic background sync; an MV3 worker cannot hold its own timer between evictions.                                                                                                           |
| `tabs`                                                      | Resolve the active tab's URL, title, and navigation state so a capture can be attributed and closed.                                                                                           |
| `scripting`                                                 | Inject the extractor on demand for pages the declarative content script cannot reach, and re-inject after an extension reload.                                                                 |
| `activeTab`                                                 | User-initiated capture of the current tab without a standing grant; access ends when the tab navigates.                                                                                        |
| `contextMenus`                                              | The "Save page", "Save selection", and "Save video" entries.                                                                                                                                   |
| `downloads`                                                 | Record `download` events, including filename, MIME type, and size.                                                                                                                             |
| `history`                                                   | Supply revisit counts and the "already visited" signal that feeds importance scoring and search history backfill.                                                                              |
| `sidePanel`                                                 | Open the side panel from the popup button; the Side Panel API requires this permission alongside the `side_panel` manifest key.                                                                |
| `<all_urls>` (host)                                         | The content script must observe any page the user chooses to read, on any site.                                                                                                                |
| `http://127.0.0.1:8787/*`, `http://localhost:8787/*` (host) | The local ingestion/retrieval API the worker posts batches to; declared explicitly even though `<all_urls>` also covers it, so the fetch target is visible when the pattern is narrowed later. |

`web_accessible_resources` **is** declared in the built manifest, by CRXJS rather than by
hand: an MV3 content script is loaded through a small loader that dynamically imports the
compiled chunk, and a chunk reachable from a page context has to be listed. The entries are
the content script's own bundle and its sourcemap, scoped to `http://*/*` and `https://*/*` —
the minimum the loader needs. Nothing injects a stylesheet, font, or image into a page.

Sourcemaps are emitted into `dist/` (`build.sourcemap` in `vite.config.ts`). That is what
makes a stack trace from a user's browser readable, and it also means the unminified source
of the content script is fetchable from any page once the extension is installed. Turn
sourcemaps off for a Web Store release if that is not a trade you want.

The only secret-adjacent value in the bundle is `VITE_SUPABASE_ANON_KEY`. It is public by
design; Row Level Security is the access guard. `SUPABASE_SERVICE_ROLE_KEY` must never be
referenced from this workspace.

## Configuration

The extension reads build-time variables from the repo-root `.env`
(`vite.config.ts` sets `envDir` to the monorepo root, and Vite inlines `VITE_*` values at
build time, so changing any of them requires a rebuild).

| Variable                     | Default                 | Used by                                                                                       |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`          | — (required)            | `createExtensionClient()`; missing value throws at first use.                                 |
| `VITE_SUPABASE_ANON_KEY`     | — (required)            | `createExtensionClient()`; the public anon key, RLS-guarded.                                  |
| `VITE_API_BASE_URL`          | `http://127.0.0.1:8787` | The retrieval and chat API. Ingestion does **not** use it — batches go to `process-activity`. |
| `VITE_SYNC_INTERVAL_SECONDS` | `120`                   | The periodic sync alarm; Chrome clamps periods below one minute.                              |
| `VITE_DEVICE_ID`             | — (required)            | The Phase 1a device id; every event carries it. See the note below.                           |

Server-side defaults that shape client behaviour — `IMPORTANCE_MIN_THRESHOLD`,
`SYNC_BATCH_SIZE`, `IDLE_FLUSH_DELAY_SECONDS` — live in the root `.env.example` and are
mirrored by constants in this workspace (`DEFAULT_CAPTURE_THRESHOLD`,
`DEFAULT_BATCH_LIMIT`, `IDLE_THRESHOLD_SECONDS`).

### `VITE_DEVICE_ID` is not a secret, and it is not optional

Phase 1a has no device-registration path: there is no `register-device` edge function, and
the extension must not invent an id, because the ingestion path attributes every batch to a
device row. So `VITE_DEVICE_ID` must name a device that **already exists in
`second_brain.devices` for the user you are about to sign in as**. The ingest secret half
of the device contract belongs to a later phase; until then the pipeline authenticates the
caller by JWT alone.

The value is inlined into the bundle at build time and is not sensitive — a device id is an
attribution label. Changing it requires a rebuild.

## Signing in

The popup signs in with **email and password** against Supabase Auth. Any user in the
project's `auth.users` works — create one in the Supabase dashboard (Authentication → Users
→ Add user), or reuse an existing account.

Two things must line up, or the extension will sign in but sync nothing:

1. The password sign-in must succeed (the popup flips to the signed-in screen).
2. `VITE_DEVICE_ID` must be a device row owned by **that** user. A row owned by somebody
   else produces a rejected batch, which shows up as a non-zero **Dropped** count and an
   error under **Last sync**.

Magic-link sign-in is offered but does not complete: the emailed link opens a web page and
this client runs with `detectSessionInUrl: false`. Use the password.

## Loading the extension unpacked

```bash
# 1. Provide the required env values (repo root).
cp .env.example .env   # then set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_DEVICE_ID

# 2. Build.
pnpm install
pnpm --filter @second-brain/chrome-extension build
```

Then, in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `apps/chrome-extension/dist` — the build output, not
   the workspace directory. The workspace contains TypeScript entry points that Chrome
   cannot execute; only `dist/` holds a valid manifest and its compiled assets.
4. Pin the extension. Open the popup from the toolbar and the side panel from the popup's
   **Open side panel** button.
5. Sign in with an email and password (see [Signing in](#signing-in)). Then browse: stay on
   a page for about half a minute and scroll, switch away from the tab, and open the popup —
   **Queued** should drop to 0 and **Last sync** should read `ok`.

After a rebuild, press **Reload** on the extension card: Chrome reads the manifest only at
load time, so permission and entry-point changes require a reload, and content scripts in
already-open tabs need the tab to be reloaded too.

### Debugging a capture that did not happen

Everything the extension logs is prefixed `[second-brain]`. The content script logs to the
page's own console, and the worker logs to the service worker console (DevTools → the
**service worker** link on the extension card in `chrome://extensions`). A capture that was
scored below the threshold, was a duplicate, or was paused leaves no trace — those are
counted in the popup's **Dropped** number instead.

## Icons

`manifest.json` references four icons. They **are** committed, as generated placeholders —
CRXJS refuses to build when a manifest asset is missing, so a repository without them
cannot produce a loadable `dist/`:

| File                 | Size      |
| -------------------- | --------- |
| `icons/icon-16.png`  | 16 × 16   |
| `icons/icon-32.png`  | 32 × 32   |
| `icons/icon-48.png`  | 48 × 48   |
| `icons/icon-128.png` | 128 × 128 |

They live in `public/icons/` (Vite copies `public/` verbatim into `dist/`, so the manifest
paths resolve) and are regenerated with
`node apps/chrome-extension/scripts/generate-placeholder-icons.mjs`. Replace them with real
artwork before any release; the full explanation is in
[`public/icons/README.md`](public/icons/README.md).

## Related docs

| Document                                             | Contents                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| [Root README](../../README.md)                       | Monorepo layout, conventions, workspace scripts.                |
| [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)   | Components, data flow, deployment.                              |
| [docs/API_REFERENCE.md](../../docs/API_REFERENCE.md) | The ingestion and retrieval HTTP surface this client posts to.  |
| [docs/DECISIONS.md](../../docs/DECISIONS.md)         | ADRs, including the local-scoring and exclusion-list decisions. |
| [docs/TASKS.md](../../docs/TASKS.md)                 | Phased plan and the `TODO(phase-N)` markers used here.          |
| [apps/web](../web/README.md)                         | The dashboard and chat surface that shares the retrieval API.   |
