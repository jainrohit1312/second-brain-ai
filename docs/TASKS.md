# Second Brain — Build Plan

The phased implementation plan: what gets built in what order, where each task lands, how each phase proves it is done, and what is still genuinely unknown.

Status: draft — scaffold phase. Phase 0 is the current state of the repository. **Every phase after 0 is unstarted, and every behaviour in phase 0 is a placeholder.** See [ARCHITECTURE.md](./ARCHITECTURE.md) for what each phase is building and [DECISIONS.md](./DECISIONS.md) for why.

## How to read this plan

- **Ordering is by dependency, not by value.** Each phase leaves the system in a coherent state: something runs end to end, tests pass, and the next phase has a substrate rather than a promise.
- **Exit criteria are objectively checkable.** Each one names a command, a file, or an assertion. "Works well" is not an exit criterion; "`pnpm test` in `services/ingestion` passes and a fixture batch round-trips through the local stack" is.
- **"Depends on" names the phase whose exit criteria must be met.** A phase may be _started_ earlier for a spike; it may not be _completed_ earlier.
- **Paths are intended targets.** If a workspace lands with a different internal layout, the task's path is updated to match reality — the task is not dropped. Where a path is uncertain, the task names the workspace rather than inventing a file.
- **A phase is not complete until its [exit criteria](#phase-0--scaffold-current) are met and the check is recorded.** The checkbox on a parent item means the work is done, not that it was started.
- **Experiments from [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) are tasks, not background reading.** Where a phase depends on a measurement, the measurement is a checkbox with an id (E1–E7) so it cannot be quietly skipped.

## Phase 0 — Scaffold (current)

**Goal.** A repository that describes and constrains the system: the monorepo layout, the configuration, the frozen cross-cutting types, the placeholder signatures, and this documentation set. Nothing behaves. Everything is specified.

**Depends on.** Nothing.

### Repository root and tooling

- [x] `package.json` at the root — pnpm workspace scripts, `packageManager` pin, Turborepo and TypeScript dev dependencies.
- [x] `pnpm-workspace.yaml` — the workspace globs, the shared `catalog`, and a note that `apps/android` is deliberately excluded (ADR-019).
- [x] `turbo.json` — the task graph (`build` depends on `^build`; `dev` persistent and uncached).
- [x] `tsconfig.base.json` — strict flags, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`.
- [x] `.env.example` — every environment variable the system reads, with no values and a pointer to the decision that governs each provider choice.
- [x] `.prettierrc` — 2 spaces, single quotes, `printWidth: 100`, `proseWrap: preserve` for Markdown.
- [x] `.eslintrc.json` — the type-aware rules, the import order, and the per-workspace `env` overrides.
- [x] `.editorconfig`, `.gitignore`.
- [x] `README.md` — product summary, layout, getting started, conventions, and a status banner that says scaffold.

### Workspace skeletons

> These are ticked because the phase-0 deliverable _is_ the structure, and the layout is specified in the root `README.md`. **Run the glob below before starting phase 1** — if a workspace is missing, that is a phase-0 gap to close, not a phase-1 task.

- [x] `packages/shared` — the frozen types (`types/device.ts`, `types/activity.ts`, `types/document.ts`, `types/memory.ts`, `types/topic.ts`, `types/importance.ts`, `types/retrieval.ts`), the constants (`SOURCES`, `ACTIVITY_EVENT_TYPES`, `PASSIVE_EVENT_TYPES`, `CATEGORIES`, `IMPORTANCE_BAND_THRESHOLDS`, `SCHEMA_VERSION`, …), the pure utils (`hash.ts`, `date.ts`, `text.ts`, `validation.ts`), and a root barrel that re-exports types with `export type`.
- [x] `packages/providers` — `embedding/interface.ts` and `llm/interface.ts` (the `EmbeddingProvider` and `LlmProvider` contracts), the factories, one implementation per candidate provider (`embedding/{nvidia,openai,gemini,local}.ts`, `llm/{deepseek,openai,gemini,claude,qwen,local}.ts`), and the normalised error taxonomy.
- [x] `packages/database` — `src/client.ts` (the two constructors: anon and service-role, both binding `DEFAULT_SCHEMA = 'second_brain'`), `src/types/database.ts` (the generated-types placeholder, keyed on `second_brain`), and `src/queries/{activity,chunks,documents,memories,topics}.ts` requiring a `userId`.
- [x] `services/ingestion` — `src/index.ts` (the server entry point), `src/handlers/{activity,batch,document}.ts`, and `src/validation/schemas.ts`. All placeholders; **no health handler exists yet** — it is a phase-1 task below.
- [x] `services/processing` — `src/index.ts` plus one stub per stage directory: `importance/{signals,rules,score}.ts`, `extraction/{readability,cleaner,youtube-transcript}.ts`, `chunking/{recursive,semantic}.ts`, `classification/{topic-classifier,category-router}.ts`, `distillation/{memory-extractor,dedup,merger}.ts`.
- [x] `services/retrieval` — `src/intent/classifier.ts` and `src/hybrid/{vector-search,fts-search,fusion,metadata-filter}.ts`. **Context assembly and the HTTP routes do not exist yet** — they are phase-4 tasks below.
- [x] `apps/chrome-extension` — the MV3 manifest, the Vite/CRXJS build, and the entry points under `src/{background,content,popup,sidepanel,lib,types}`. The queue module's directory is `src/background/`, not `src/queue/` or `src/lib/`; see the phase-1 tasks.
- [x] `apps/android` — the Gradle project with `app/src/main/java/com/secondbrain/app/{watcher,queue,sync,privacy,auth,ui}`, the Compose shell, the Room entities, the `WorkManager` job, and the `UsageStatsManager` reader, all as stubs.
- [x] `apps/web` — the Next.js 14 App Router shell with `src/app/{chat,dashboard,settings}` pages and their components, including `chat/components/SourceCitation.tsx`. **No route handler for chat exists yet** — streaming is a phase-5 task below.
- [x] `supabase` — `config.toml` (with `[api].schemas = ["public", "graphql_public", "second_brain"]`), an empty `migrations/` directory, `functions/{process-activity,embed,distill}/index.ts` each with a `deno.json`, and `seed.sql` (whose writes are qualified as `second_brain.<table>`).
- [x] `scripts` — setup and dev-orchestration helpers.
- [x] `docs` — this documentation set: eight documents, cross-linked.

### Explicit non-goals for phase 0

- No business logic anywhere. A function that returns a hard-coded empty array behind `// TODO(phase-N)` is correct; a working chunker is not.
- No real HTTP calls, no real SQL, no prompt text, no parsing algorithm.
- No migrations. `supabase/migrations/` is empty and [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) is the specification phase 1 writes them from.
- No CI configuration in this phase — it is a phase-7 hardening task.

**Verification**

```bash
# The workspace tree exists
node -e "const g=require('fs').globSync('{apps,services,packages}/*/package.json');console.log(g)"
# Every workspace typechecks against the strict base config (no behaviour required)
pnpm typecheck
# Formatting is already clean, so later diffs show only real change
pnpm format:check
```

**Exit criteria.** `pnpm typecheck` and `pnpm format:check` both pass on a clean checkout, every workspace in `pnpm-workspace.yaml` exists with a `package.json` and a `tsconfig.json` extending the base, and every unimplemented body carries a `TODO(phase-N)` marker naming the phase that implements it.

## Phase 1 — Schema, RLS, and ingestion end to end

**Goal.** Data lands in Postgres safely and idempotently. A real Chrome extension captures a real page read, queues it offline, syncs it in a batch, and the row appears in the local database with the right `user_id`, `device_id`, and a `dedupe_key` that makes a retry a no-op. This is the phase where the security model stops being a document.

**Depends on.** Phase 0.

### Migrations

- [ ] `supabase/migrations/20260916085500_init_schema.sql` — **the schema bootstrap, applied before every table migration** (ADR-020). Its statements are separate tasks below on purpose: each one silently makes a table unreachable when it is missing, and none of them fails loudly.
- [ ] `create schema if not exists second_brain;` — every application object lives in this schema, not in `public`, and not on the default `search_path` (so every later migration qualifies `second_brain.<name>`).
- [ ] `grant usage on schema second_brain to authenticated, service_role;` — a custom schema gets no usage grant from Supabase's defaults, so no policy can be evaluated without it.
- [ ] `grant select, insert, update, delete on all tables in schema second_brain to authenticated;` — **RLS policies are filters, not grants.** The privilege is the capability and the policy is what narrows it; a table with no insert policy still rejects inserts.
- [ ] `alter default privileges in schema second_brain grant select, insert, update, delete on tables to authenticated;` — the line that keeps a table added by a **later** migration from being invisible. It applies only to objects created by the role that runs it, so it must be executed by the same role that creates the tables (`postgres`).
- [ ] Confirm `[api].schemas` in `supabase/config.toml` includes `second_brain`. PostgREST serves only the schemas listed there, so omitting it fails every query with `PGRST106` **no matter how correct the policies are**, and the error points at the request rather than at this file.
- [ ] `supabase/migrations/20260916090000_init_extensions.sql` — `create extension if not exists vector with schema extensions;`, the `second_brain.set_updated_at()` trigger function, and any shared helpers.
- [ ] `..._init_devices.sql` — `devices` per [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#devices), including `ingest_secret_hash`, the composite `unique (id, user_id)`, the platform check, and the `devices_guard_immutable_columns` trigger.
- [ ] `..._init_activity_events.sql` — `activity_events` with the composite FK to `devices (id, user_id)`, the unique `(device_id, dedupe_key)` constraint, the promoted-column checks, the band column, and all five indexes.
- [ ] `..._init_documents.sql` — `documents` with the generated `fts` column, the extraction-status consistency check, the `(user_id, content_hash)` unique constraint, and the partial indexes. Use the worked example in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#a-worked-migration) as the template.
- [ ] `..._init_document_chunks.sql` — `document_chunks` with `embedding vector(1024)`, its HNSW index (ADR-016), the GIN index on the generated `fts`, and the unique `(document_id, ordinal)`.
- [ ] `..._init_memories.sql` — `memories` with the temporal columns, the supersede consistency check, the partial HNSW and GIN indexes on `status = 'active'`, and the `memories_guard_supersede_columns` trigger.
- [ ] `..._init_topics.sql` — `topics` plus the self-referencing composite FK, the slug format check, and the counters.
- [ ] `..._init_document_topics.sql` — the join table, its composite PK, and the one-primary-per-document partial unique index.
- [ ] `..._init_memory_sources.sql` — the evidence table with its surrogate PK, the `has_source` check, and the frozen `excerpt`.
- [ ] Enable **and force** RLS on every table in the same migration that creates it, and add every policy from the schema document. A table that exists without RLS — even briefly — is a table the anon key can read (ADR-018).
- [ ] `supabase/seed.sql` — a user, two devices, a topic taxonomy from `CATEGORIES`, and a small fixture corpus for local development. **Not** in a migration: migrations are schema-only.
- [ ] **Verify the triggers.** Write a test per guard trigger asserting that a client-role update to a guarded column is rejected, and that the same update as the service role succeeds.

### RLS enforcement

- [ ] A CI-runnable assertion that every table in the `second_brain` schema has `relrowsecurity = true`. This is the guard that makes the anon key safe, and it is the single most important test in the repository.
- [ ] A second assertion that every table has at least one policy or appears on an explicit service-role-only allowlist with a reason.
- [ ] Per-table policy tests that run as **two distinct users** and assert zero rows leak in either direction, for every table. Not a sample — every table, because the failure mode is a table that was forgotten.
- [ ] A test that a request with a valid JWT but a `userId` in the body is scoped to the JWT's user, not the body's (ADR-018).

### Device registration — **an unresolved gap**

- [ ] **Decide and implement the device-registration path.** Every ingest depends on `X-Device-Secret`, and nothing issues one ([API_REFERENCE.md](./API_REFERENCE.md#read-endpoints-referenced-but-not-specified-here)). Options are (a) `POST /v1/devices` on `services/ingestion`, (b) a Supabase edge function, (c) an Auth hook. The tradeoffs are in the API document's open questions. **Phase 1 cannot exit without this.**
- [ ] Secret issuance: generate, hash, store in `devices.ingest_secret_hash`, return **once** and never again.
- [ ] Secret rotation: issue-new-then-revoke-old, with a test that the old secret stops working and the new one works.
- [ ] Revocation: set `revoked_at`, clear the hash, and assert the next ingest returns `403 device_revoked`.

### Ingestion service

- [ ] `services/ingestion/src/index.ts` — fill in the HTTP shell: request-id assignment and propagation, the error envelope, and the JSON body limit.
- [ ] `services/ingestion/src/auth/device.ts` **(new file)** — `apikey` check, JWT verification, `user_id` **from the JWT only**, device-secret hash comparison, revocation check. Each failure path returns its specific code from [API_REFERENCE.md](./API_REFERENCE.md#error-codes).
- [ ] `services/ingestion/src/validation/schemas.ts` — implement the zod schemas per event type, derived from the `ActivityEvent` union in `@second-brain/shared` so there is exactly one definition of a valid event.
- [ ] `services/ingestion/src/handlers/activity.ts` — `POST /v1/ingest/activity`, including the `201`/`200`-duplicate distinction.
- [ ] `services/ingestion/src/handlers/batch.ts` — `POST /v1/ingest/batch`: batch-level validation, then `insert … on conflict (device_id, dedupe_key) do nothing`, returning `accepted` / `duplicates` / `rejected` / `rejectedIds` / `serverCursor`. Assert the invariant that the three counts sum to the batch length.
- [ ] `services/ingestion/src/handlers/document.ts` — `POST /v1/ingest/document`: server-computed `contentHash` (never client-supplied), `(user_id, content_hash)` dedup, `202` with `deduplicated`.
- [ ] A `GET /v1/health` handler **(new; no handler exists in the landed layout)** — dependency reachability with **no user-specific data** (see [API_REFERENCE.md](./API_REFERENCE.md#get-v1health)).
- [ ] `serverCursor` issuance — monotonic per device, opaque, and a distinct token type from a pagination cursor (ADR-017).
- [ ] `Idempotency-Key` handling with a short replay window, layered over the database constraint rather than instead of it.
- [ ] Rate limits per endpoint, with `Retry-After` on `429`.
- [ ] Fire-and-forget `process-activity` dispatch after a successful write, tolerant of the invocation failing.

### Chrome extension (capture half)

**Phase 1a landed 2026-09-16.** The extension signs in, captures, queues, and drains
`page_view` events end to end. `apps/chrome-extension/README.md` records the live/stubbed
boundary; the remaining capture paths are listed under Phase 2.

- [x] The IndexedDB queue module — landed at `apps/chrome-extension/src/background/queue.ts`
      (not `src/lib/`), with the `queuedAt` index, the per-id acknowledgement delete, the
      bounded drop policy (ADR-010), a 20 000-record cap with lowest-importance eviction, and
      7-day age pruning. The `dedupeKey` index ADR-010 names is **not** built: nothing queries
      the queue by dedupe key, because deduplication happens in the in-memory ring and on the
      server.
- [x] `apps/chrome-extension/src/background/` — the drain routine and the flush triggers:
      `chrome.idle`, the periodic alarm, worker startup, the post-capture count threshold, a
      tab going hidden, and the popup's manual flush. `DeviceSyncState` persistence is **not**
      done; it is a Phase 2 entry below.
- [x] The `dedupeKey` implementation — `contentDedupeKey()` takes its identity half from the
      shared `dedupeKey` utility, so extension and server agree on identity by construction
      rather than by convention. The fixture test that asserts both sides compute the same key
      for the same inputs belongs next to the server implementation, which does not exist yet.
- [x] The **client pre-score** with the locally available subset of `ImportanceSignals`, and
      the `IMPORTANCE_MIN_THRESHOLD` gate **before** the queue write.
      `isUniqueDomain`, `revisitCount`, and `topicNovelty` need history the client does not
      have and are pinned to zero, which makes the pre-filter stricter than the server's score.
- [x] **The exclusion check runs before the event object is constructed.** It lives in the
      content script, ahead of the draft: loopback origins, a sensitive-host list, and
      `sb:excluded-domains`. An excluded page produces no payload, not a redacted one.
- [ ] The capture path for the event types the phase needs: **`page_view` is done**;
      `page_read`, `selection`, `copy`, `bookmark`, `download`, and `search` are Phase 2.
- [x] `apps/chrome-extension/src/popup/` — pending count, last error, and a "sync now" action,
      plus the capture toggle and sign-in/sign-out.
- [x] The `chrome.storage.local` session adapter (without it the first auth call throws in an
      MV3 worker), the message router with a zod-validated protocol, and the Phase 1a device
      identity — which reads `VITE_DEVICE_ID` rather than registering a device, because no
      registration endpoint exists yet.

### Exit criteria

1. `pnpm db:reset` followed by `pnpm test` produces a stack where every migration applies from scratch and every RLS assertion passes.
2. The RLS "every table has forced RLS" test and the two-user leakage test both pass, and they fail if a table is added without policies (verify by deliberately adding one and watching the test fail).
3. **S3 passes:** a driven capture of an excluded domain writes **zero** rows to the queue, the request body, and every destination table — asserted, not inspected.
4. **S4 passes:** a 24-hour simulated offline session of at least `SYNC_BATCH_SIZE` events syncs with the client's captured count equal to `count(distinct dedupe_key)` for that device on the server.
5. A batch re-sent verbatim returns `duplicates` equal to its length and writes no new rows.
6. A malformed event in an otherwise valid batch returns `200` with `rejected: 1` and a `rejectedIds` entry, and the client queue drains rather than retrying forever.
7. `GET /v1/health` returns `200` with the database `ok` and returns `503` when Postgres is stopped.
8. A device whose secret is rotated: the old secret gets `401 device_mismatch`, the new one succeeds, and a revoked device gets `403 device_revoked`.

## Phase 2 — Processing: importance, extraction, chunking, classification

**Goal.** A stored event becomes a document with embedded, topic-classified chunks, re-scored for importance with the full signal vector. Retrieval does not exist yet, so the proof that this phase works is the data it produces, inspected directly.

**Depends on.** Phase 1.

### Importance scoring

- [ ] `services/processing/src/importance/rules.ts` — the weights, expressed as data (a table of signal → weight) rather than as code, so a change is reviewable as a diff.
- [ ] `services/processing/src/importance/score.ts` — the full `ImportanceSignals` vector to `ImportanceScore` with `contributions` and a `version`.
- [ ] `services/processing/src/importance/version.ts` **(new file)** — the version string, and the rule that **a rubric change that does not bump it makes re-scoring a no-op** (ADR-009).
- [ ] `services/processing/src/importance/signals.ts` — fill in signal derivation, including the two signals the client cannot compute (`topicNovelty`, cross-device `revisitCount`).
- [ ] The server re-score writing `server_importance` and `importance_version`, reading `coalesce(server_importance, importance)` everywhere downstream.
- [ ] The claim-versus-recomputation cross-check: `durationMs` and `domain` recomputed from the event, divergence recorded in `metadata.confidenceCheck`.
- [ ] **E6 — day-one simulation** ([RESEARCH_NOTES.md](./RESEARCH_NOTES.md#the-experiment-cold-start-simulation-e6-e7)). Seed nothing, replay a corpus chronologically, and record the cold-start drop rate of eventually-important events. **Blocking for the threshold decision.**
- [ ] **E7 — threshold calibration.** Pick `IMPORTANCE_MIN_THRESHOLD` from a measurement, not from a guess, on the principle that a dropped event is unrecoverable.
- [ ] The shared scoring **fixture set** (signals → expected score) that the extension, the server, and later Kotlin all assert against. This is the artifact that keeps three implementations of one rubric honest (ADR-019) and must exist before phase 6.

### Aggregation and extraction

- [ ] `services/processing/src/pipeline/aggregate.ts` **(new file)** — join events into documents on `(user_id, content_hash)`, attach contributing events, and compute `captured_at`, `word_count`, and `reading_time_seconds`.
- [ ] `services/processing/src/extraction/readability.ts` — the extraction interface plus the HTML path, populating `extracted_text`, `language`, `extraction_status`, and `extraction_failure_reason`. Pair it with `extraction/cleaner.ts` for normalisation, and `extraction/youtube-transcript.ts` for the video path.
- [ ] Every failure mode in [RESEARCH_NOTES.md](./RESEARCH_NOTES.md#content-extraction-failure-modes) is a **recorded state**, not a null: paywall, cookie wall, JS-rendered shell, no text layer, non-HTML, fetch blocked.
- [ ] **E9 — the JS-rendered-page gap.** Instrument the failure distribution over real captured pages and evaluate using the client-supplied rendered text instead of a server fetch. This is the highest-value known extraction gap.
- [ ] **E10 — the `extraction_status` distribution** over a week of real capture, surfaced in the dashboard rather than in a log.

### Chunking

- [ ] `services/processing/src/chunking/recursive.ts` — recursive splitting (heading → paragraph → sentence → hard cut) with `CHUNK_SIZE` and `CHUNK_OVERLAP` from configuration, populating `ordinal`, `token_count`, `heading_path`, `strategy = 'recursive'`, and `content_hash`.
- [ ] `heading_path` populated from the document's structure — the thing that makes a citation locate itself.
- [ ] Idempotency: a re-chunk of unchanged text rewrites nothing, asserted by running the chunker twice and diffing row counts and hashes.
- [ ] `fixed` implemented as a **test-only** strategy for the phase-7 comparison. If nothing outside tests references it, that is a finding ([ADR-013](./DECISIONS.md#adr-013-proposed-recursive-chunking-in-v1-semantic-chunking-deferred-to-phase-7)).

### Embedding

- [ ] `packages/providers/src/embedding/` — fill in the implementations behind `EmbeddingProvider`: `nvidia.ts` (the default), `openai.ts` and `gemini.ts` for the E1 comparison, and `local.ts` for the local endpoint. The interface and the factory already exist as stubs.
- [ ] `inputType: 'query' | 'passage'` as a **required** parameter end to end, because the default model is asymmetric and getting it silently wrong degrades recall ([API_REFERENCE.md](./API_REFERENCE.md#embed)).
- [ ] `embedding` and `embedding_model` written in the same statement, with the `(embedding is null) = (embedding_model is null)` constraint as the backstop.
- [ ] Assert returned `dimensions` against `EMBEDDING_DIMENSIONS` **before** writing, so a mismatch is a clear error rather than a database error (ADR-004).
- [ ] The re-embed backlog query: `where embedding_model is null or embedding_model <> $configured`.
- [ ] **E1 — embedding model comparison.** **Blocking for the pinned default**; recall@1/@3/@8 on a committed fixture passage set and 50 questions, with `nv-embedqa-e5-v5` measured both with a correct and a deliberately wrong `input_type`.
- [ ] **E2 — embedding stability.** The same text embedded a week apart; if identical input drifts, `content_hash`-based embedding skips are unsound.

### Topic classification

- [ ] `services/processing/src/classification/topic-classifier.ts` — the keyword first pass from `topics.keywords`, then centroid similarity, then a model call for the residue. `classification/category-router.ts` assigns `category_slug` from `CATEGORIES`.
- [ ] `TopicSuggestion` handling: propose, match against existing slugs, insert only above a confidence bar.
- [ ] `document_topics` writes with `confidence` and exactly one `is_primary`, and the `documents.topic_ids` denormalisation trigger.
- [ ] `topics.document_count` and `topics.last_seen_at` maintained.
- [ ] Resolve the **topic hierarchy cycle** question ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)) before classification writes topics, or explicitly decide not to use `parent_id` in v1.

### Pipeline plumbing

- [ ] `services/processing/src/index.ts` — the stage runner, ordered cheapest-first so a document that fails extraction never reaches a stage that costs money.
- [ ] Per-stage stamps written so a backfill is a `where` clause (see the table in [ARCHITECTURE.md](./ARCHITECTURE.md#the-processing-pipeline)).
- [ ] `supabase/functions/process-activity/index.ts` — the invocation contract, per-stage status response, and the `sweep` mode bounded by `limit`.
- [ ] `supabase/functions/embed/index.ts` — the batched embed contract, with `model` and `dimensions` in the response.
- [ ] The scheduled sweep for backlogged documents, **redundant with** the post-ingest push: the push is an optimisation, the sweep is the guarantee.
- [ ] Resolve the **`processing_runs` table** question ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)) — row-level stamps only, or a run-level record too.
- [ ] Decide whether `documents.device_id` stays ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)) while the schema is still cheap to change.

### Ingest contract debt

Three gaps the phase-1 ingest path inherits or creates. Each is a behavioural difference rather than a cleanup, and each is currently invisible to a client.

- [ ] **A `youtube_watch` with an unknown duration is rejected, and then lost.** `activity_events_promoted_fields_check` requires `duration_seconds` for `youtube_watch`, while `YouTubeWatchEvent.durationSeconds` is `number | null`. The ingest function rejects such an event individually, and the client drops every id in `rejectedIds` from its queue — so the event disappears with no error the user ever sees. Decide which side moves: a nullable promoted column (a migration), or a documented sentinel value with a defined meaning, and pin the choice with a fixture. See [ADR-022](./DECISIONS.md#adr-022-ingestion-runs-as-the-process-activity-edge-function).
- [ ] **Nothing can enqueue the follow-up work.** There is no job-queue table among the nine phase-1 tables, so `process-activity` cannot schedule extraction for a row it just accepted, and the post-ingest push that the plumbing above depends on has nowhere to write. Design the queue first — table shape, claim semantics, retry/backoff columns, and the idempotency key a retried job relies on — then let the push and the sweep be thin clients of it. The phase-1 draft expected this to be `device_sync_state`, which is a **client-side type** in `@second-brain/shared`, not a table. See [ADR-022](./DECISIONS.md#adr-022-ingestion-runs-as-the-process-activity-edge-function).
- [ ] **Two error envelopes are in the wild.** `process-activity` answers `{ error: { code, message, requestId } }` while `embed` and `distill` answer a flat `{ function, error, requestId }`, so a client that branches on `code` — `token_expired` wants a refresh, `device_revoked` wants capture stopped — works against one function and not the others. Unify on the documented envelope, including the `405` and `500` paths, and decide the same question for `internal_error` messages: `process-activity` returns a fixed string and logs the real one, while the other two echo `error.message`, which can name a table, a column, or a query.

### Chrome extension capture paths (the Phase 1a remainder)

Phase 1a wired one capture path end to end. These are the rest, in rough dependency order.
Every one of them already has its contract and its constants — what is missing is the wiring,
so each is a smaller task than it looks.

- [ ] **`page_read`.** `src/content/extractor.ts` implements the Readability wrapper and is
      unit-testable, but nothing calls it. Wire it into the page-view lifecycle: when
      extraction clears `READABILITY_MIN_CHARACTERS`, emit a `page_read` carrying `wordCount`,
      `readingTimeSeconds`, and `contentHash` instead of the bare `page_view`, and add the
      `wordCount` signal the pre-score currently never sees.
- [ ] **`selection` and `copy`.** `src/content/selection.ts` is implemented; start
      `createSelectionObserver()` from the content script, add the `copy` path with the same
      privacy rule, and implement `CAPTURE_SELECTION` in the worker router — it currently
      refuses that message rather than answering with a decision it did not make.
- [ ] **`youtube_watch`.** `src/content/youtube.ts` is contracts only. Implement detection,
      the watch accumulator, and the flush hooks — after resolving the unknown-duration
      question in "Ingest contract debt" above, since a null duration is rejected today and
      the rejected id is dropped from the client queue.
- [ ] **`bookmark`, `download`, `search`.** Context menus, `chrome.downloads`, and the search
      engine result page. These are the first `EXPLICIT_INTENT_EVENT_TYPES` the client will
      emit, and they are what makes the `contextMenus` and `downloads` manifest permissions
      real.
- [ ] **Score the client can actually compute.** `isUniqueDomain` and `revisitCount` are
      pinned to zero because nothing reads `chrome.history` yet, and `topicNovelty` needs the
      server's corpus. Wiring history is the cheapest way to close part of the gap between the
      client pre-score and the server's authoritative score, and it is what the `history`
      permission was declared for.
- [ ] **`DeviceSyncState` persistence.** Store the last `serverCursor` and the last error so a
      stuck drain survives worker eviction; the popup reads the outcome from
      `sb:last-sync` today, which is a snapshot rather than a cursor.
- [ ] **Magic-link sign-in.** The client runs with `detectSessionInUrl: false` and an emailed
      link opens a browser tab, so OTP can be requested but never completes. Give the
      extension a callback route it can observe, or remove the button.

### Exit criteria

1. A `page_read` event fed through the pipeline produces one `documents` row, N>0 `document_chunks` rows each with a non-null `embedding` and a matching `embedding_model`, and at least one `document_topics` row with exactly one `is_primary`.
2. Running the pipeline twice on the same document changes no row counts and no chunk `content_hash` values.
3. A document whose extraction fails has `extraction_status = 'failed'`, a non-null `extraction_failure_reason`, a null `extracted_text`, and **zero** chunks — and the constraint that enforces the first two holds.
4. `server_importance` is written for every event, `importance_version` is non-null, and bumping the version makes the re-score select rows while an unchanged version selects none.
5. The scoring fixture set passes against the extension's TypeScript implementation and the server's implementation with no divergence.
6. **E1** has a recorded result and the default embedding model is either confirmed or changed with the migration plan from ADR-004 written before the change.
7. `pnpm db:reset && pnpm test` passes, and a from-scratch pipeline run over the seed corpus completes without a manual step.

## Phase 3 — Distillation, memory dedup, and merge

**Goal.** Documents produce durable memories with evidence, provenance, and temporal validity — and a document that contains nothing durable produces nothing. This is the phase where the product either becomes what it claims to be or does not.

**Depends on.** Phase 2.

### Distillation

- [ ] `services/processing/src/distillation/memory-extractor.ts` — chunks plus `heading_path` context to `MemoryCandidate[]`, with the prompt version and model stamped on every result.
- [ ] **The `DISTILLATION_MIN_BAND` gate.** Only a document at or above `normal` (score ≥ `0.45`) is distilled. A document below it keeps its chunks and stays searchable, and produces no memories — which is the main cost control as well as the noise control. Assert that a `low`-band document is never sent to the distiller.
- [ ] **An empty candidate list is a successful result.** No retry, no fallback to "store a summary anyway", no escalation to a stronger model (ADR-007).
- [ ] The prompt work: self-containment (resolve pronouns, name the entities), atomicity (one proposition per statement), and the **"the user read that X" versus "the user believes X"** distinction — the hardest and least-specified behaviour in the system.
- [ ] `supabase/functions/distill/index.ts` — the invocation contract, chunk-windowing for documents that exceed one invocation, and `candidates: []` as a `200`.
- [ ] `packages/providers` `completeJson` used for every extraction, with the repair loop and the per-provider JSON behaviour recorded.
- [ ] **E3 — structured-extraction bake-off.** 30 fixture documents including **at least five that should yield zero memories**, measuring first-pass schema validity, validity after one repair, kind distribution, and false-positive extraction on the empty documents. **Blocking for the distillation model choice.**
- [ ] **E17 — local LLM for distillation.** The same fixture set against a local model, with particular attention to the empty-list behaviour. A local model would make the strongest privacy claim available.

### Memory semantics

- [ ] The three worked examples from [RESEARCH_NOTES.md](./RESEARCH_NOTES.md#what-a-memory-should-mean) expanded into a fixture set with **both** should-produce and should-not-produce lists, and every should-not entry asserted as a failure.
- [ ] `kind` assignment validated against `MemoryKind` with a documented example per kind, so a reviewer can tell an `insight` from a `fact`.
- [ ] `confidence` and `importance` treated as independent throughout, never collapsed.

### Adjudication and persistence

- [ ] `services/processing/src/distillation/dedup.ts` and `distillation/merger.ts` — per candidate, find near-duplicate and contradicting active memories (embedding similarity plus a model call) and emit a `MemoryMergeDecision` with `action`, `targetMemoryId`, `reason`, and `mergedStatement`.
- [ ] **E4 — the adjudication threshold.** The similarity distribution for true duplicates, contradictions, and distinct memories; producing a merge-above threshold, an insert-below threshold, and an explicit ambiguous band that routes to `status: 'candidate'` for review. Optimise for **fewer wrong merges than wrong inserts**, because a wrong merge loses information invisibly.
- [ ] `services/processing/src/distillation/persist.ts` **(new file)** — the transactional write: the `memories` row, the `memory_sources` rows with the frozen `excerpt`, the embedding with its model stamp, and — for a supersede — the new row plus the closed window and `superseded_by` on the old one, in one transaction. Use the typed query modules in `packages/database/src/queries/memories.ts`.
- [ ] Supersede is never partial: a test that a supersede which fails mid-transaction leaves **zero** active contradictory memories.
- [ ] Resolve the **`memory_sources` NULL-uniqueness** question ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)) against the pinned Postgres version.
- [ ] `status: 'candidate'` memories are excluded from retrieval until confirmed; assert that a default query never returns a superseded or candidate memory.
- [ ] Resolve the ambiguity of `archived` vs `superseded` vs `rejected` **in the UI copy**, not only in the schema, so the review screen is coherent.
- [ ] **E16 — excerpt stability.** Compare stored excerpts against their chunks before and after a forced re-chunk; a drift would undermine ADR-008's citation-integrity argument.

### User-facing correction

- [ ] The memory review queue: accept, reject, archive, and correct a statement, writing through the RLS-permitted paths and respecting the guard trigger.
- [ ] A manual memory creation path using the `memories_insert_own` policy.
- [ ] "Forget this memory" as a real delete, with its effect on citations stated to the user rather than discovered.

### Exit criteria

1. All three worked-example documents produce exactly their should-produce memories, and **none** of their should-not-produce candidates — asserted, including the five should-yield-zero documents.
2. A document that yields zero memories is recorded as a success: no retry, no error, and the eval counts it as a correct empty.
3. Superseding a memory leaves the old row with `valid_to` non-null and `superseded_by` set, the new row `active`, and a query for the belief at a past timestamp returns the old statement.
4. A default retrieval-shaped query never returns a `superseded`, `archived`, `rejected`, or `candidate` memory.
5. Every memory has at least one `memory_sources` row with a non-null `excerpt`, and at least one of `chunk_id`/`document_id` non-null.
6. Re-running distillation on the same document with the same prompt version creates no duplicate memories.
7. **E3** and **E4** have recorded results, and the distillation model and adjudication thresholds are chosen from them.

## Phase 4 — Retrieval: hybrid search, fusion, intent routing, context

**Goal.** A question returns ranked, cited evidence. The pipeline runs end to end and the evaluation harness exists — because from here on, quality is a measurement rather than an opinion.

**Depends on.** Phase 3.

### The two legs

- [ ] `services/retrieval/src/hybrid/vector-search.ts` — the cosine-distance leg over `document_chunks` and `memories`, using the HNSW indexes, with the memory leg filtered to `status = 'active'` so the partial index is the fast path.
- [ ] `services/retrieval/src/hybrid/fts-search.ts` — `websearch_to_tsquery` against the generated `tsvector` with `ts_rank_cd`, served by GIN. **This leg has no external dependency and must never degrade.**
- [ ] `services/retrieval/src/hybrid/metadata-filter.ts` — metadata filters applied as SQL predicates, not post-filters.
- [ ] Deterministic tie-breaking by id in both legs, so fusion is reproducible.
- [ ] Query embedding with `inputType: 'query'` — the asymmetry is a correctness requirement, not a hint.

### Fusion

- [ ] `services/retrieval/src/hybrid/fusion.ts` — RRF with `k = 60` and `HYBRID_VECTOR_WEIGHT` / `HYBRID_FTS_WEIGHT` as per-list weights (ADR-006).
- [ ] A pure unit test asserting a known-good fused ordering from two fixture lists, so a refactor cannot silently invert it.
- [ ] Fusion degrades correctly with one leg: it becomes a single-list ranking without changing shape.
- [ ] Per-signal scores (`vectorScore`, `ftsScore`, `rerankScore`) retained on every surviving `RankedChunk`.

### Intent routing

- [ ] `services/retrieval/src/intent/classifier.ts` — a heuristic first pass, then a cheap model classification into the five `QueryIntent` values, with `mixed` as the fallback.
- [ ] The five routes from [ARCHITECTURE.md](./ARCHITECTURE.md#b-one-recall-query-from-question-to-cited-answer), including the `activity` route that can terminate in aggregates with no chunk involved.
- [ ] `temporal` with an unparseable date falls back to `mixed` rather than silently dropping the constraint — a dropped date filter is a wrong answer, not a degraded one.
- [ ] `entity` routes exact-identifier matches **around** reranking (ADR-014).
- [ ] **E14 — router accuracy.** The misroute rate of the heuristic pass against model classification on a labelled question set. Blocking for the router's shape, because it sits in the interactive path.

### Context assembly and the endpoint

- [ ] `services/retrieval/src/context/assembler.ts` **(new file)** — deduplicate overlapping chunks, order strongest-nearest, assign citation indices, pack to a token budget, and record any truncation.
- [ ] `services/retrieval/src/routes/retrieve.ts` **(new file; no HTTP routes exist in the landed layout)** — the `POST /v1/retrieve` contract exactly as specified, including `intent` echoed back, `tookMs`, and `degraded`.
- [ ] `degraded` set when the vector leg or the rerank stage is skipped, and **not** set for an empty result set or a token-budget truncation.
- [ ] `access_count` and `last_accessed_at` incremented for the rows actually used.
- [ ] Decide the **`explain` mode** question ([API_REFERENCE.md](./API_REFERENCE.md#open-questions)) — a full intermediate-state response, or the compact result only.

### The evaluation harness

- [ ] A committed fixture corpus: passages, 50 questions with known correct sources, and the expected empty cases.
- [ ] The harness runs `/v1/retrieve` (or the pipeline directly) and reports recall@1/@3/@8, MRR, and the rank of the first correct result.
- [ ] **Citation integrity assertion (S2):** every citation index resolves to a row, and no citation references a non-existent id.
- [ ] **S1 gate:** the correct source appears in the top 3 for at least 80% of the 50 questions. This is the phase's primary exit criterion and the number every later retrieval change is measured against.
- [ ] **S6:** with the embedding provider stubbed to fail, retrieval still returns results with `degraded: true`.
- [ ] **E13 — HNSW recall under a per-user filter.** ANN-with-filter versus exact nearest-neighbour recall, across synthetic corpus sizes.
- [ ] **E18 — at what corpus size does an exact scan beat HNSW?** If it is large, the index is premature; if small, it is essential from day one.
- [ ] **E15 — does topic pre-filtering help or hurt recall?** If it hurts, demote it from a filter to a boost. Inaccurate metadata filters actively exclude the right answer.
- [ ] Record the **retrieval latency baseline** for S8: p95 over the harness, and set the p95 budget from it rather than from a guess. This is the number phase 5's chat path and phase 7's reranker are judged against.

### Exit criteria

1. **S1 passes:** ≥80% of the 50 evaluation questions return their known correct source in the top 3.
2. **S2 passes:** every citation in every harness result resolves to a row, asserted on every run.
3. **S6 passes:** the provider-stubbed run returns results with `degraded: true` and does not fail.
4. A vector-leg failure produces an FTS-only result set with `degraded: true`; a query with no matching content returns `chunks: []` with `degraded: false`.
5. Fusion's unit test asserts a known fused ordering, and the per-signal scores are present on every `RankedChunk`.
6. A temporal query with a valid date range returns only rows inside it; the same query with an unparseable date returns `intent: 'mixed'` rather than ignoring the constraint.
7. An `activity`-intent query is answerable with aggregates and zero chunks.
8. The recorded p95 latency baseline exists and is enforced as a gate.
9. `pnpm test` passes in `services/retrieval`, and the harness runs as part of it.

## Phase 5 — Web app: chat with citations, dashboard, settings

**Goal.** A person can use the system. Ask a question and read a cited answer; see what was captured; correct what is wrong; manage providers, rules, and devices. This is the phase where the product is judged, and it is deliberately after retrieval works, so the app has something real to show.

**Depends on.** Phase 4.

### Chat

- [ ] `apps/web/src/app/api/chat/route.ts` **(new file; the web workspace landed with pages and components but no route handlers)** — proxy to `services/retrieval`'s `/v1/chat`, forwarding the user's JWT and streaming SSE through.
- [ ] The SSE contract from [API_REFERENCE.md](./API_REFERENCE.md#post-v1chat): `meta` first with citations **before** any text, then `token`s, then `done`, with `error` as a possible terminal event.
- [ ] Citation rendering in `apps/web/src/app/chat/components/SourceCitation.tsx` (the component exists as a stub): `[n]` markers that resolve to a source with its title, url, date, and snippet. A marker that does not resolve is a rendered error state, not a broken link.
- [ ] `degraded: true` surfaced as a visible caveat ("keyword search only"), never hidden. A degradation the user cannot see is indistinguishable from a quality regression.
- [ ] Streaming error handling for both cases: an error **before** the first byte (a normal 5xx) and one **mid-stream** (an `error` event after a `meta`).
- [ ] The `history` bound resolved ([API_REFERENCE.md](./API_REFERENCE.md#open-questions)).

### Dashboard and curation

- [ ] `/v1/activity`, `/v1/documents`, `/v1/memories`, `/v1/topics` read endpoints with keyset pagination per the documented orderings (ADR-017, and note that the UI cannot offer "jump to page N").
- [ ] The activity view: infinite scroll, filterable by device, type, domain, band, and date range — the filters the client pre-score and the server re-score make available.
- [ ] Per-device sync health: pending count, last synced, last error. The one signal that distinguishes "nothing captured" from "everything stuck".
- [ ] The **`extraction_status` distribution** visible per document with its reason (E10), so a user whose reading produced no memories can see why.
- [ ] The memory review queue: accept, reject, archive, edit a statement, and see the evidence with its excerpt.
- [ ] Topic curation: rename, re-keyword, merge, and delete.
- [ ] The document detail view showing chunks and the memories derived from them — the inspectability that makes the system trustworthy rather than magical.

### Settings

- [ ] Provider configuration: embedding and LLM provider, model, and key presence (**never** the key value — presence and a rotated timestamp only), with the re-embed warning when the model changes (ADR-004).
- [ ] Rule settings: the exclusion list (domains, packages, URL patterns), per-device; the importance threshold; retention overrides.
- [ ] Importance-rule weights, using `ImportanceRule` (`id`, `description`, `signals`, `weight`, `enabled`) — the tunable surface the type was written for. The screen must show each rule's signals and its weight, and refuse a configuration whose enabled weights do not roughly sum to 1, because a weighted sum whose weights do not sum to 1 silently rescales every score against a fixed threshold.
- [ ] Device management: label, last seen, rotate secret, revoke, and register a new device through the phase-1 path.
- [ ] **Onboarding that asks for exclusions first**, and states plainly that the exclusion list is not retroactive for content already sent (see [The privacy promise](./PROJECT_OVERVIEW.md#the-privacy-promise)). This ordering is a product requirement, not a UI flourish.

### Cross-cutting

- [ ] Decide **whether ingest and retrieval share an origin** ([API_REFERENCE.md](./API_REFERENCE.md#open-questions)).
- [ ] Decide **cursor lifetime** ([API_REFERENCE.md](./API_REFERENCE.md#open-questions)) — stateless forever, or an embedded issue time.
- [ ] Auth: Supabase sign-in, JWT refresh, and a distinct path for `token_expired` so a refresh is not a logout.
- [ ] **E12 — a chat turn's assembled token count, `tookMs`, and truncation events**, instrumented rather than assumed.
- [ ] No content in client-side analytics, logs, or error reports. Content-free error reporting only.

### Exit criteria

1. A question asked in the UI returns a streamed answer whose every `[n]` marker resolves to a rendered citation with a working source link.
2. A query with no matching content returns an honest "nothing captured about this" rather than an invented answer.
3. With the embedding provider disabled, the UI shows results with a visible "keyword search only" caveat.
4. The dashboard lists, filters, and paginates activity across at least three pages without a duplicate or a skipped row while a sync is writing concurrently.
5. A stuck device queue is visibly reported with its pending count and last error.
6. A memory can be corrected, archived, and forgotten from the UI, and the change is reflected in retrieval on the next query.
7. The exclusion list can be edited and takes effect on the next captured event, asserted by driving the capture path.
8. **S7's export half:** the user can export everything the system holds, and the manifest covers every table.

## Phase 6 — Android watcher and sync

**Goal.** The second client. Foreground app sessions captured through `UsageStatsManager`, queued in Room, synced through the same protocol, with domain-level reading activity where the platform allows it.

**Depends on.** Phase 1 (the sync contract), and it can proceed in parallel with phases 2–5 because it depends on nothing in the processing or retrieval pipeline.

- [ ] `apps/android/app/src/main/java/com/secondbrain/app/watcher/` — the `UsageStatsManager` reader: foreground intervals, an explicit **allow-list** of event types, a minimum-duration filter, and interval truncation recorded in `metadata` (ADR-012).
- [ ] `apps/android/app/src/main/java/com/secondbrain/app/privacy/` — **the exclusion check before the event object is constructed.** Same invariant, same test, at the Room boundary. This directory exists as a stub and is where the check belongs.
- [ ] `apps/android/app/src/main/java/com/secondbrain/app/queue/` — the Room queue with the same contract as IndexedDB: indexes on `dedupeKey` and `occurredAt`, per-id acknowledgement delete, bounded drop policy, `DeviceSyncState`.
- [ ] `apps/android/app/src/main/java/com/secondbrain/app/sync/` — the `WorkManager` drain with a network constraint, plus the same flush triggers adapted to Android's scheduler.
- [ ] The Kotlin `dedupeKey` implementation, asserted against the **same fixture set** as the TypeScript one. A divergent key is silent duplicate accumulation.
- [ ] The Kotlin importance pre-score, asserted against the **same scoring fixtures** as the TypeScript implementation (ADR-009, ADR-019).
- [ ] Duplicate-interval handling: dedupe on `(packageName, startAt)` client-side **and** on `(device_id, dedupe_key)` server-side, because the usage-stats window can genuinely overlap.
- [ ] Partial-session handling: an interval that becomes complete after first observation must not be emitted twice.
- [ ] Permission state: poll the `PACKAGE_USAGE_STATS` grant and surface a revoked permission explicitly rather than capturing nothing silently.
- [ ] Resolve **Kotlin ↔ TypeScript constant generation** ([DECISIONS.md](./DECISIONS.md#open-decisions-not-yet-in-this-log)) — generate the constants and event shapes, or keep duplicating them with a fixture test as the only guard. This is ADR-019's accepted drift risk, and this phase is where it is paid down or accepted explicitly.
- [ ] Client version skew: handle `unsupported_schema_version` with an explicit "update required" state rather than a retry loop.
- [ ] Decide whether an Android browser yields domain-level activity or an app session only ([ADR-012](./DECISIONS.md#adr-012-android-usagestatsmanager-rather-than-an-accessibilityservice)).

**Exit criteria**

1. A foreground app session of known duration produces one `app_session` event with a duration within an accepted tolerance, and an excluded package produces **zero** rows — asserted at the Room boundary.
2. The Kotlin `dedupeKey` and scoring implementations pass the shared fixtures with no divergence from the TypeScript ones.
3. A flight-mode session of at least `SYNC_BATCH_SIZE` events syncs on reconnect with no loss and no duplicates (**S4** on the second platform).
4. A revoked device stops capturing and reports it, rather than retrying indefinitely.
5. An old client receiving `unsupported_schema_version` shows an update prompt and stops syncing.
6. A revoked usage-access permission is visible in the app within one polling interval.

## Phase 7 — Reranking, semantic chunking, retention, hardening

**Goal.** Quality, durability, and the deliberate deferrals. This phase resolves the two Proposed ADRs, adds the only automated deletion in the system, and makes the whole thing survivable by someone who did not write it.

**Depends on.** Phases 4, 5, and 6.

### Reranking (ADR-014)

- [ ] A `Reranker` interface symmetric with the provider interfaces, with a `version` stamped on every `rerankScore`.
- [ ] The local cross-encoder implementation, with an explicit warm-up strategy for the first query after idle.
- [ ] The hosted API implementation, selectable by configuration, so the comparison is a config change. **The user's question is the artifact sent — that is the privacy axis of this decision.**
- [ ] **E5** in full ([RESEARCH_NOTES.md](./RESEARCH_NOTES.md#reranking-options)): the delta versus no reranking, local versus hosted, latency measured on the retrieval host under concurrent database load, cold-start cost, and the licence terms of any shipped model artifact.
- [ ] The retrieval evaluation re-run against the latency baseline from phase 4, and the p95 budget re-set from the measurement.
- [ ] **ADR-014 moved from Proposed to Accepted or Superseded**, with the measurement recorded in the ADR.

### Semantic chunking (ADR-013)

- [ ] The `semantic` strategy implemented behind the existing interface, with `content_hash` freezing the result so a retry is idempotent.
- [ ] The comparison from [RESEARCH_NOTES.md](./RESEARCH_NOTES.md#chunking-strategy-comparison): recall@8, snippet quality judged on a sample, ingest cost and wall-clock per document, and chunk-count inflation.
- [ ] **A class-specific outcome is acceptable**: `semantic` for transcripts and long unstructured essays, `recursive` elsewhere, with `strategy` as the discriminator.
- [ ] Any corpus-wide re-chunk runs the full re-chunk → re-embed → re-distill chain, with the cost reported **before** it runs.
- [ ] **ADR-013 moved from Proposed to Accepted or Superseded**, and `strategy` values that are unused are removed from `ChunkingStrategy` rather than left as decoration.

### Retention and deletion

- [ ] `services/processing/src/retention/` **(new directory; no retention module exists in the landed layout)** — the band-based sweep from [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#retention-and-ttl), driven by the `activity_events_retention_idx` partial index.
- [ ] The sweep deletes `activity_events` rows **only**; documents and memories are untouched. A test asserts that sweeping a `low` `page_view` does not remove a document the user read and now cites.
- [ ] Resolve **retention override semantics** ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)): a per-user/per-device policy table, columns on `devices`, or a single JSONB setting.
- [ ] Resolve the **retention floor**: the user may shorten retention but not lengthen the `noise` band beyond a bound.
- [ ] **S7's delete half:** "forget this" makes a row unrecoverable by any application path, asserted by checking every table reachable from the deleted id.
- [ ] Resolve the **superseded-memory retention** question ([DECISIONS.md](./DECISIONS.md#open-decisions-not-yet-in-this-log)) — whether closed memory rows are ever swept, given that citation integrity depends on them.
- [ ] Data export: a complete manifest plus content, in a documented format.

### Hardening

- [ ] CI: typecheck, lint, test, format check, the RLS assertions, the migration-from-scratch check, the fixture tests, and the retrieval evaluation gate (**S1** as a regression gate, not just a phase-4 milestone).
- [ ] Backups and a **tested restore**, including the vector columns and the generated `tsvector` columns (the latter recompute, which is worth verifying rather than assuming).
- [ ] The processing pipeline's behaviour at scale: a large backlog processed in bounded invocations, with progress observable by stamp.
- [ ] Resolve the **multilingual `fts`** question ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#open-schema-questions)) for the languages that actually appear in a corpus.
- [ ] Resolve the **`activity_events` payload GIN index** question, based on whether a per-app analytics query exists.
- [ ] Resolve the **topic hierarchy cycle** question if `parent_id` is in use.
- [ ] A runbook: what to do when a device stops syncing, when the provider is down, when the backlog grows, when a migration fails mid-way.
- [ ] The **re-score / re-embed / re-distill** jobs run at least once against real data, because a migration path that has never been executed is a hypothesis.
- [ ] Review every ADR's Consequence list against reality and record what was wrong. An ADR whose predictions did not hold is a finding, not an embarrassment.

**Exit criteria**

1. **ADR-013 and ADR-014 are each Accepted or Superseded** with the deciding measurement recorded in the ADR.
2. The retention sweep runs on a schedule, has a dry-run mode, deletes only `activity_events` rows, and is provably resumable and idempotent.
3. **S7 passes in both directions:** export is complete and a hard delete is unrecoverable.
4. CI enforces all of the above, including **S1** as a regression gate — a retrieval change that drops below the threshold fails the build.
5. A restore from backup is performed successfully on the local stack, and the vector indexes are verified queryable afterwards (not merely present).
6. At least one full corpus-wide re-embed has been executed end to end using the ADR-004 procedure, including the dual-read window.
7. The runbook covers every failure mode in [ARCHITECTURE.md](./ARCHITECTURE.md#failure-modes-and-degraded-behaviour), and each has been exercised or explicitly marked as untested.

## Known unknowns

Recorded so they are not mistaken for solved. Each has an owner phase; the first four are blocking for the phase that names them.

| #   | Unknown                                                                                | Why it is unresolved                                                                                                                                                                                                                                              | Owner                                           |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Who registers a device, and how is the ingest secret issued?**                       | Every authenticated ingest depends on it, and no endpoint in [API_REFERENCE.md](./API_REFERENCE.md) issues one. Options and tradeoffs are in the API document's open questions.                                                                                   | Phase 1 — **blocking**                          |
| 2   | **Which embedding model is pinned, and is 1024 the right width?**                      | The schema hard-codes the width; changing it is the most expensive migration in the system. Requires E1, which requires a retrieval harness that does not exist until phase 4.                                                                                    | Phases 2/4 — **blocking for the default**       |
| 3   | **What exactly is a memory, at the boundary?**                                         | The three worked examples are a start, not a specification. "The user read that X" versus "the user believes X" is the least well-specified behaviour in the system, and it is the one that determines whether the archive is a knowledge base or a summary pile. | Phase 3 — **blocking for distillation quality** |
| 4   | **Does a bad extraction produce memories anyway?**                                     | A junk extraction that yields plausible-looking memories is worse than a recorded failure, because it is invisible. Requires E10's distribution before a quality heuristic can be designed.                                                                       | Phases 2/7                                      |
| 5   | **Does reranking earn its complexity at all?**                                         | If the delta over RRF is small, the honest answer is to skip it and keep the degrade path as the only path — a simpler and cheaper system (ADR-014).                                                                                                              | Phase 7                                         |
| 6   | **Is a local LLM good enough for distillation?**                                       | It would make the strongest privacy claim available, and its failure mode is quality rather than cost — specifically the empty-list behaviour.                                                                                                                    | Phases 3/7                                      |
| 7   | **How accurate are the topics, and does filtering on them help or hurt?**              | Inaccurate metadata filters actively exclude the right answer, so a topic system that is usually right can be net-negative (E15).                                                                                                                                 | Phase 4                                         |
| 8   | **How much does the client pre-score disagree with the server re-score?**              | It quantifies how much the local heuristic discards irrecoverably. No data exists until both scores exist for the same events (E11).                                                                                                                              | Phase 2                                         |
| 9   | **Can a page that requires JavaScript be captured at all?**                            | The client has the rendered text and the server has a shell; using the client's text changes the ingest contract and the privacy surface. This is the largest known extraction gap (E9).                                                                          | Phase 2                                         |
| 10  | **How large is a chat turn's context window, and what gets truncated?**                | Directly affects answer quality, and it is currently unmeasured (E12).                                                                                                                                                                                            | Phase 5                                         |
| 11  | **What happens to a memory whose source documents are swept by retention or deleted?** | The statement survives and its provenance arrays survive, but the `memory_sources` rows cascade away with the chunks, so the quoted span is gone and the citation degrades to a historical pointer. Whether that is acceptable has not been decided.              | Phase 7                                         |
| 12  | **Do two devices reading the same article produce one document or two?**               | The design says one, via `(user_id, content_hash)`, but the content hash depends on what each client extracted, which differs by platform and by rendered DOM. This is a cross-platform behaviour that has not been tested because only one client exists.        | Phase 6                                         |
| 13  | **Will three implementations of the scoring rubric stay in step?**                     | ADR-009 and ADR-019 both accept this risk. The fixture set is the mitigation, and it only works if all three assert against it.                                                                                                                                   | Phase 6                                         |
| 14  | **Is there a second user?**                                                            | Everything is scoped by `user_id` and RLS is per-user, but the system has been designed for one person. Multi-user behaviour (provider cost isolation, per-user provider configuration, a shared topic taxonomy's absence) is untested by construction.           | Post-v1                                         |
| 15  | **What does the migration path from a scaffold to a running system actually cost?**    | Nothing in this repository has been executed. The estimate is that phases 1–4 are the bulk of the work and phases 5–7 are durability, and that estimate is an estimate.                                                                                           | Ongoing                                         |

## Related documents

| Document                                   | Why                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | What each phase builds, and the failure modes every phase must handle.                                               |
| [DECISIONS.md](./DECISIONS.md)             | The decisions these phases implement, and the two Proposed ADRs that phase 7 resolves.                               |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | The specification phase 1's migrations are written from, including the open schema questions listed in these phases. |
| [API_REFERENCE.md](./API_REFERENCE.md)     | The contracts phase 1 (ingest), phase 4 (retrieve), and phase 5 (chat) implement.                                    |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)   | The experiments (E1–E7 and the numbered questions) that appear as tasks in each phase.                               |
| [ROADMAP.md](./ROADMAP.md)                 | What comes after phase 7, and the triggers that would force a re-architecture.                                       |
