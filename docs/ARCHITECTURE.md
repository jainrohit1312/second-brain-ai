# Second Brain — Architecture

The technical spine: what the components are, what each one owns and explicitly does not, how a page read becomes a memory and a question becomes a cited answer, and what happens when each dependency fails.

Status: draft — scaffold phase, no implementation yet. Every path named below is the target layout; every pipeline stage is specified and unimplemented. See [TASKS.md](./TASKS.md) for the build order and [DECISIONS.md](./DECISIONS.md) for the rationale behind each structural choice.

## System context

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  apps/chrome-extension      │        │  apps/android                │
│  Manifest V3 + Vite + CRXJS │        │  Kotlin · Compose · Room     │
│  ─ content script: capture  │        │  ─ UsageStatsManager reader   │
│  ─ service worker: drain    │        │  ─ WorkManager drain          │
│  ─ IndexedDB queue          │        │  ─ SQLite queue (Room)        │
└──────────────┬──────────────┘        └───────────────┬──────────────┘
               │                                       │
               │  POST /v1/ingest/batch                │  POST /v1/ingest/batch
               │  apikey + Bearer JWT + X-Device-Secret│  (same contract)
               └───────────────────┬───────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  services/ingestion          │
                    │  zod validate → dedupe →     │
                    │  persist (service role)      │
                    └──────────────┬───────────────┘
                                   │ service-role writes
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Supabase                                                                │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ Postgres        │  │ pgvector     │  │ Auth     │  │ Edge functions│   │
│  │ 8 tables        │  │ hnsw indexes │  │ JWT      │  │ process-      │   │
│  │ RLS on all      │  │ tsvector/GIN │  │ auth.uid │  │  activity     │   │
│  │                 │  │              │  │          │  │ embed, distill│   │
│  └────────────────┘  └──────────────┘  └──────────┘  └───────────────┘   │
└────────────┬─────────────────────────────────────────────┬──────────────┘
             │                                             │
             │  hybrid SQL (vector + fts + filters)        │  chunk / memory
             ▼                                             ▼  upserts
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  services/retrieval         │        │  services/processing             │
│  intent route → fan-out →   │        │  extract → chunk → classify →    │
│  RRF → rerank → context     │        │  score → distill → adjudicate    │
└──────────────┬──────────────┘        └────────────────┬─────────────────┘
               │                                        │
               │              packages/providers        │
               │        ┌──────────────────────────┐    │
               └───────►│ EmbeddingProvider        │◄───┘
                        │ LlmProvider              │
                        └───────────┬──────────────┘
                                    ▼
                 ┌──────────────────────────────────────────┐
                 │  NVIDIA · OpenAI · Gemini · DeepSeek ·    │
                 │  Anthropic · Qwen · local (Ollama/vLLM)   │
                 └──────────────────────────────────────────┘

┌─────────────────────────────┐
│  apps/web (Next.js 14)       │  reads own rows directly (anon key + JWT)
│  chat + citations · activity │  → POST /v1/retrieve, /v1/chat for assembly
│  dashboard · settings        │  → Supabase client for everything else
└─────────────────────────────┘
```

Three things about this diagram are deliberate and worth stating:

1. **Clients never write user content directly.** The only write path for activity is `services/ingestion`. Clients do read their own rows directly, which is why RLS exists rather than a read proxy.
2. **The web app does not talk to `services/processing`.** Processing is asynchronous and scheduled; the web app's synchronous needs are reads and the two retrieval endpoints.
3. **`packages/providers` is a library, not a service.** It is imported by `services/processing`, `services/retrieval`, and the edge functions, so there is no single "model gateway" process to run. This is a scalability decision (a service would serialise all model traffic through one process) and a privacy decision (one less hop that could log content).

## Component responsibilities

Each component has one boundary it owns and several it explicitly does not. The "does not own" column is the more useful half: it is where integration assumptions get tested.

| Component               | Owns                                                                                                                                                                                                                                                                                                                                                  | Explicitly does **not** own                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/chrome-extension` | Observation of page views, reads, selections, copies, YouTube watches, searches, bookmarks, and downloads in the browser. Local importance pre-score. The IndexedDB queue and its bound. Deciding what never leaves the device.                                                                                                                       | Persistence. Validation (beyond pre-score filtering). Topic extraction. Any retrieval. Anything the user did in a non-browser app.                                                                 |
| `apps/android`          | Foreground app sessions via `UsageStatsManager`. The Room queue and its bound. Local pre-score of `app_session` events.                                                                                                                                                                                                                               | Reading screen content, window titles, or UI hierarchies (ADR-012). Browser page-level capture. Anything on a device the user has not granted usage access to.                                     |
| `services/ingestion`    | The single authoritative write path for activity. zod validation against the shared schemas. Resolving `user_id` from the verified JWT. Device authentication via the per-device secret. Idempotent batch persistence keyed on `(device_id, dedupe_key)`. Issuing `serverCursor`.                                                                     | Scoring importance (it records the client score and defers re-scoring). Extraction, chunking, classification, distillation. Retrieval. Deciding what the user should see.                          |
| `services/processing`   | The whole pipeline from stored events to durable memories: joining events into documents, content extraction, chunking, embedding orchestration, topic classification, importance re-scoring, memory distillation, and memory adjudication (insert/merge/supersede/reject).                                                                           | Request/response serving. What the user is allowed to see (RLS does that). Immediate consistency: processing is asynchronous and eventually consistent by design.                                  |
| `services/retrieval`    | Query intent routing, the hybrid fan-out (vector + FTS + metadata), reciprocal rank fusion, reranking, and context-window assembly. Emitting `RetrievalResult` with per-signal scores.                                                                                                                                                                | Ingesting or processing content. Generating the final answer text (that is the web app's chat route calling `LlmProvider`). Access control beyond passing the caller's credentials through to RLS. |
| `apps/web`              | The user-facing surface: chat with citations, the activity dashboard, topic curation, memory review and correction, provider and rule settings, device management. Streaming chat synthesis via `LlmProvider`.                                                                                                                                        | Capture. Processing. Being the only way to read data — the API is not a private contract to the UI.                                                                                                |
| `packages/providers`    | One interface per model capability (`EmbeddingProvider`, `LlmProvider`, and a proposed `Reranker`), the factories that select implementations from config, normalized error taxonomy, retry/backoff, timeout, and per-call token and cost accounting. `completeJson` as the only structured-extraction path.                                          | Prompt content (callers own their prompts). Business logic. Storage. Deciding which provider is correct for a task — configuration does that.                                                      |
| `packages/shared`       | The frozen cross-cutting types (`ActivityEvent` and its nine variants, `Memory`, `MemoryKind`, `Document`, `DocumentChunk`, `Topic`, `ImportanceSignals`, `ImportanceScore`, `RetrievalQuery`, `RetrievalResult`, `RankedChunk`, `Citation`, `Device`, `ActivityBatch`, `ActivityBatchResult`), the shared constants, and pure utilities with no I/O. | Any I/O. Any dependency on Supabase, React, or a provider SDK. Anything mutable: this package is types, constants, and pure functions only.                                                        |
| `packages/database`     | The typed Supabase client in two modes (anon-key and service-role), generated DB types, and typed query modules that require a `userId` argument so an unfiltered query is inconvenient to write. Every client binds `DEFAULT_SCHEMA` (`second_brain`) at construction, so the query modules call `.from('documents')` unqualified.                   | Domain logic. RLS policies (those are migrations). Deciding what a query means.                                                                                                                    |
| `supabase/migrations`   | The schema, the constraints, the indexes (including `hnsw` and GIN), and every RLS policy — all in the `second_brain` schema, with the schema's `usage` and table grants (ADR-020). The authoritative definition of what is possible.                                                                                                                 | Application behaviour. Validation semantics beyond what a constraint can express.                                                                                                                  |
| `supabase/functions`    | Three thin Deno functions that need data locality or scheduling: `process-activity`, `embed`, `distill`.                                                                                                                                                                                                                                              | Business logic that belongs in a service. Being a second implementation of anything.                                                                                                               |
| `scripts`               | Local setup, dev orchestration, seeding, and deployment helpers.                                                                                                                                                                                                                                                                                      | Anything a contributor needs in order to _understand_ the system.                                                                                                                                  |
| `docs` (this directory) | The contracts: schema, API surface, decisions, build order.                                                                                                                                                                                                                                                                                           | Truth about implementation state. When a document and the code disagree, the code is right and the document is a bug.                                                                              |

### The one structural rule

`packages/shared` has **no dependencies on any other workspace**, and every workspace may depend on it. This makes the type surface acyclic by construction and means a change to a shared type is reviewable in isolation. Cross-workspace imports go through the package root barrel only — `@second-brain/shared`, never `@second-brain/shared/src/types/memory` — so that the package's public surface is one file and cannot be widened by accident.

## End-to-end data flow

### A. One page read, from observation to retrievable memory

Numbered by the artefact that exists at each step. Steps 1–11 are capture and ingest; 12–21 are processing.

1. **The user opens an article.** The extension's content script has been injected on the page. It starts a dwell timer and tracks scroll depth. Nothing is stored yet — no event object exists.
2. **The exclusion list is checked before anything else.** If the domain matches an exclusion pattern, the script stops: no timer, no event, no queue entry, no counter. This is the exclusion invariant, and it is enforced here — at the earliest possible point — not at the sync boundary.
3. **The read completes.** Dwell exceeds the minimum, or the page is unloaded. The content script constructs a `page_read` event: `domain`, `wordCount`, `readingTimeSeconds`, `contentHash` over the extracted text, plus the base fields (`id`, `deviceId`, `type`, `occurredAt`, `url`, `title`, `metadata`).
4. **The client pre-score runs.** `ImportanceSignals` are assembled from what the device knows — `dwellSeconds`, `scrollDepthPct`, `wordCount`, `hasSelection`, `hasCopy`, `isBookmarked`, `isDownloaded`, `isUniqueDomain`, `revisitCount`, `isWorkingHours`, and `appIsExcluded` (always `false` by construction; see ADR-009). The result is an `ImportanceScore` with `value`, `band`, `contributions`, `scoredAt`, and `version`.
5. **The threshold gate decides — for passive events only.** `PASSIVE_EVENT_TYPES` (`page_view`, `page_read`, `youtube_watch`, `app_session`) are the ones that get filtered: if `value < IMPORTANCE_MIN_THRESHOLD` (which mirrors `IMPORTANCE_BAND_THRESHOLDS.low`, i.e. `0.25`), the event is discarded entirely. It is not queued, not counted, and not summarised to the server. This is a data-loss decision made deliberately on the device, which is why the threshold is set conservatively (ADR-009). **`EXPLICIT_INTENT_EVENT_TYPES` — `selection`, `copy`, `search`, `bookmark`, `download` — bypass the gate and are always queued**, because the user produced them on purpose and a deliberate act is not something a heuristic gets to throw away.
6. **The event is written to IndexedDB.** A transaction writes the event and its `dedupeKey` into the queue store, indexed on `dedupeKey` and `occurredAt`. This is the durability boundary: from here on, the event survives a service-worker kill, a browser restart, and an offline week.
7. **A drain is scheduled.** The service worker arms a `chrome.alarms` alarm at `IDLE_FLUSH_DELAY_SECONDS` (default `60`) after the last captured event, and checks whether `pendingCount >= SYNC_BATCH_SIZE` (default `100`). If it is, the drain runs immediately.
8. **A flush trigger fires.** Either the alarm, a `chrome.idle` transition to `idle`/`locked`, the periodic floor alarm (`VITE_SYNC_INTERVAL_SECONDS`, default `120`), or worker startup. Every trigger is a restart of the same drain routine, reading its state from IndexedDB.
9. **The drain builds a batch.** The oldest `SYNC_BATCH_SIZE` un-acknowledged events, ordered by `occurredAt`, wrapped in an `ActivityBatch`: `{ schemaVersion: SCHEMA_VERSION, deviceId, clientSentAt, events }`. `clientSentAt` is recorded so the server can derive sync lag.
10. **The batch is POSTed to `/v1/ingest/batch`** — see the [sync protocol](#the-sync-protocol) below for the exact credentials and retry rules.
11. **The server acknowledges per event.** `services/ingestion` returns an `ActivityBatchResult`: `{ accepted, rejected, duplicates, serverCursor, rejectedIds }`. The client deletes only the acknowledged ids from IndexedDB, updates `DeviceSyncState` (`cursor`, `lastSyncedAt`, `lastError`), and leaves everything else for the next drain. A rejected id is removed from the queue and its rejection reason is recorded in `lastError`, because retrying a schema-invalid event forever is a queue that never drains.
12. **`receivedAt` is stamped and rows land in `activity_events`.** Insert uses `on conflict (device_id, dedupe_key) do nothing`, so a retried batch returns `duplicates > 0` rather than writing twice.
13. **A processing job picks up the event.** Triggered two ways, deliberately redundant: the `process-activity` edge function is invoked after ingest (a push, for latency), and a scheduled sweep queries for events whose documents are stale (a pull, for correctness after a failure). The push is an optimisation; the pull is the guarantee.
14. **Events are joined into a `document`.** The unit of processing is a document, not an event. A `page_read` with a `contentHash` is the seed; related `selection`, `copy`, `bookmark`, and `download` events for the same URL within a window are attached via `document_id` and contribute to the importance signals. Dedup is on `(user_id, content_hash)`, so the same article read on three devices produces one document with three contributing events.
15. **The full importance re-score runs.** Now the corpus is available, so `topicNovelty` — the signal the client cannot compute — is populated, along with cross-device `revisitCount` and `isUniqueDomain`. `server_importance` and `importance_version` (the `ImportanceScore.version` stamp) are written. Retrieval uses `coalesce(server_importance, importance)`. This is a re-score, not an overwrite: the client's original score is preserved as the record of what the device decided (ADR-009).
16. **Readable content is extracted.** The stored `page_read` content hash points at content the client already had; extraction normalises it to `extractedText` (whitespace normalised, boilerplate stripped, headings preserved for `headingPath`). Failure modes and what happens on each are in [Failure modes](#failure-modes-and-degraded-behaviour) and [RESEARCH_NOTES.md](./RESEARCH_NOTES.md).
17. **The document is chunked** with the `recursive` strategy (ADR-013): heading → paragraph → sentence → hard cut at `CHUNK_SIZE` (default `800` tokens) with `CHUNK_OVERLAP` (default `120`). Each `document_chunks` row records `ordinal`, `text`, `tokenCount`, `headingPath`, `strategy`, and a `content_hash` over the text plus strategy. The hash is what makes a re-chunk idempotent: unchanged chunks are not rewritten.
18. **Chunks are embedded.** `packages/providers` batches the chunk texts through the configured `EmbeddingProvider` (`nv-embedqa-e5-v5`, 1024 dimensions by default). The embedding input is the chunk's `headingPath` prepended to its `text`, so a chunk like "see the table above" is self-contained for the model as well as for the reader. Each row gets `embedding` and `embedding_model` in the same statement. A row whose `embedding_model` does not match the configured model is treated as having no vector by retrieval — never as approximately correct (ADR-004).
19. **Topics are assigned.** Existing topics are matched by keyword and centroid similarity; unmatched content yields `TopicSuggestion`s that become new `topics` rows when confidence clears the bar. Assignments land in `document_topics` with `confidence` and `is_primary` (exactly one primary per document, enforced by a partial unique index). `documents.topic_ids` is maintained as a denormalised array by trigger for fast filtering; `document_topics` remains the source of truth.
20. **Memories are distilled — but only above the band gate.** `DISTILLATION_MIN_BAND` (`normal`, i.e. score ≥ `0.45`) decides eligibility: a document below it keeps its chunks, stays searchable, and is never distilled. This is what stops the memory store filling with trivia, and it is also the main cost control, since distillation is the most expensive stage. For an eligible document, the distiller reads its chunks with their `headingPath` context and returns `MemoryCandidate[]` — `kind`, `statement`, `confidence`, `importance`, `sourceChunkIds`, `topicIds`. **An empty array is a valid, successful result** and is not retried (ADR-007). Every candidate's provenance is stamped: the prompt version and the model that produced it.
21. **Candidates are adjudicated and written.** For each candidate, the adjudicator looks for a near-duplicate or contradicting active memory (embedding similarity plus a model call) and emits a `MemoryMergeDecision`: `insert`, `merge`, `supersede` (which requires a `targetMemoryId` and a `reason`), or `reject`. The write path is transactional: `memories` gains the row, `memory_sources` links it to its chunks and documents with a frozen `excerpt`, and a supersede closes the old row's validity window and sets `superseded_by` in the same transaction (ADR-008).

The document is now retrievable in two ways: its chunks are in the vector and full-text surfaces, and its memories are statements that can answer questions the document cannot.

### B. One recall query, from question to cited answer

1. **The user asks a question in `apps/web`.** `POST /v1/chat` with the question text and any UI-applied filters (a topic, a date range, a device).
2. **The retrieval service classifies intent.** A cheap model call (or a heuristic first pass) yields one of the five `QueryIntent` values:
   - `semantic` — "what did I read about X", "why did we choose Y"
   - `temporal` — "what was I working on last Tuesday", "what did I read in March"
   - `activity` — "how much time did I spend on X", "which apps did I use most"
   - `entity` — "everything about Northwind", "what did Priya say about the migration"
   - `mixed` — nothing dominates; the default
3. **The intent selects a route.** The routes differ in which signal leads, not in whether the others participate:

   | Intent     | Primary signal                                                                              | Extra behaviour                                                                                                                                                      |
   | ---------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `semantic` | Vector                                                                                      | Metadata filters applied as a pre-filter.                                                                                                                            |
   | `temporal` | `occurred_at` range on `activity_events` / `documents`                                      | Date filters are _required_, not optional; an unparseable date falls back to `mixed` rather than silently ignoring the constraint.                                   |
   | `activity` | Aggregates over `activity_events` (`duration_seconds`, `domain`, `payload->>'packageName'`) | Returns aggregates and a thin set of illustrative chunks; it is the one route that can answer with no document involved.                                             |
   | `entity`   | FTS for the entity name, vector for the description                                         | Exact-name matches are boosted and routed **around** reranking, because a cross-encoder can legitimately disagree with an exact string match and be wrong (ADR-014). |
   | `mixed`    | Vector and FTS at configured weights                                                        | The default path.                                                                                                                                                    |

4. **The vector leg runs.** `document_chunks.embedding` and `memories.embedding` are searched with cosine distance (`<=>`), using the `hnsw` indexes. `memories` is searched through a partial index on `status = 'active'`, so superseded beliefs cannot enter the candidate set (ADR-008). Both sources contribute to one ranked list of `RankedChunk` values with `source: 'document' | 'memory'`.
5. **The full-text leg runs.** `websearch_to_tsquery` against the generated `tsvector` column with `ts_rank_cd` ranking, served by the GIN index. This leg is what finds error codes, function names, ticket ids, and quoted strings, and it is the leg that still works when the embedding provider is unreachable.
6. **Metadata filters apply.** `topicIds`, `sourceTypes`, `kinds`, `from`/`to`, `deviceIds` from `RetrievalQuery.filters`. Applied as SQL predicates, not post-filters, wherever the index can serve them.
7. **Both legs return `RETRIEVAL_TOP_K`** (default `40`) candidates each, ties broken deterministically by id so the fusion is reproducible.
8. **Reciprocal rank fusion combines them.** `rrf_score(d) = Σ weight_list / (60 + rank_list(d))`, with `HYBRID_VECTOR_WEIGHT` (default `0.6`) and `HYBRID_FTS_WEIGHT` (default `0.4`) as the per-list weights. Rank-only, so no score normalisation is needed and the configured weights are the actual weights (ADR-006).
9. **The top `RERANK_TOP_K`** (default `8`) survive. Every surviving `RankedChunk` keeps `vectorScore`, `ftsScore`, and `rerankScore`, so the ranking is attributable — the evaluation harness can say _which_ signal moved a result.
10. **Reranking runs** if a reranker is configured and the intent is not an exact-identifier route. `RerankScore` and the reranker's `version` are stamped on the results. Unavailable reranker ⇒ RRF order is kept and `degraded: true` is set; the query never fails.
11. **Context is assembled.** The final chunks are packed into a token budget for the LLM, deduplicated by overlapping content, ordered to put the strongest evidence nearest the question, and each one assigned a citation index.
12. **`RetrievalResult` is returned:** `query`, `intent`, `chunks`, `citations`, `tookMs`, `degraded`. Each `Citation` carries `documentId` or `memoryId`, `title`, `url`, `occurredAt`, and `snippet`.
13. **`apps/web` streams the answer.** The chat route calls `LlmProvider` with the assembled context and a system prompt that requires citation markers. Tokens stream to the browser; the final message carries the citation list.
14. **Access is recorded.** The memory and document rows that were actually used have `access_count` incremented and `last_accessed_at` set — the only feedback signal the system has about what retrieval was useful.
15. **Citation integrity is verified.** Every citation index in the streamed answer must resolve to a row in the returned set. A citation that does not resolve is a bug, and the evaluation harness treats it as a failed answer rather than a cosmetic flaw (S2 in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)).

## The offline queue and idempotency design

### Why the client queue is the source of truth

An event's lifecycle has exactly one durable home at a time. Before acknowledgement that home is the device's local store; after acknowledgement it is Postgres. There is no window in which the only copy is in memory.

The alternative — treating the server as authoritative and the client as a buffer — inverts the failure modes badly. If the client is a buffer, an event lost in the buffer is lost, and the server's absence of the event is indistinguishable from the event never having happened. If the client is the source of truth until acknowledged, an event is lost only if the device's storage fails, and the client can always tell the user how many events are pending.

Concretely, the contract both clients implement:

| Property     | Chrome extension                                                                            | Android                                                      |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Store        | IndexedDB object store, indexes on `dedupeKey` and `occurredAt`                             | Room (SQLite) table, indexes on `dedupeKey` and `occurredAt` |
| Write point  | Before the capture callback returns                                                         | Before the usage-stats query returns                         |
| Delete point | On per-id acknowledgement in `ActivityBatchResult`                                          | Same                                                         |
| Ordering     | `occurredAt` ascending, `id` as tiebreaker                                                  | Same                                                         |
| Durability   | Survives worker kill, tab close, browser restart                                            | Survives process death, device reboot                        |
| Bound        | Max count and max age; lowest-importance entries dropped first, drop count recorded locally | Same                                                         |
| Sync state   | `DeviceSyncState` mirrored locally and server-side                                          | Same                                                         |

Because the queue is authoritative, three things become possible that are not otherwise: a stuck queue is visible (the user can be told "412 events pending, last error: 401"), a retry is trivially safe (delete only what was acknowledged), and an offline week degrades into a large batch rather than data loss.

### Why `(deviceId, dedupeKey)` makes retries safe

The client queue guarantees at-least-once delivery, not exactly-once. A drain can be interrupted between "server persisted the batch" and "client deleted the acknowledged ids" — the service worker is killed, the phone loses signal after the request was sent, the response is lost. The client must therefore be able to re-send a batch it already sent, and the server must be able to absorb that without duplicating anything.

`activity_events` has a unique constraint on `(device_id, dedupe_key)`, and the insert is `on conflict (device_id, dedupe_key) do nothing`. Which makes the pair two things at once:

- **The idempotency key.** The same batch re-sent produces `duplicates: N` and zero new rows. Retry is always safe, so the client never needs to reason about whether a request "went through" — it re-sends and reads the result.
- **The logical identity of an event.** `dedupeKey` is produced by the `dedupeKey` utility in `@second-brain/shared` over the event's distinguishing content — for a `page_view` that is the URL plus a time bucket, for a `page_read` it is the URL plus `contentHash`. So the constraint is not just a retry guard: it also collapses genuine duplicates, such as the same article read twice in the same session, and the same page read on two browsers that share a `deviceId` after a profile restore.

Consequences that follow directly, and are the reason the design is stated as a contract rather than an implementation detail:

- **`dedupeKey` must be computed identically on every client.** Three implementations (extension, Android, and the server's re-derivation for backfill) must agree, or the same logical event is deduped inconsistently. This is one of the shared fixture sets (ADR-019).
- **`dedupeKey` must not include anything that varies per attempt** — no client timestamp of _sending_, no attempt counter. A key that changes on retry defeats the constraint entirely, and the failure is silent: duplicates accumulate and look like real activity.
- **The client must not generate `dedupeKey` from `id`.** The event `id` is unique per attempt in a naive implementation, which would make every retry a new row.
- **`duplicates` in `ActivityBatchResult` is a first-class outcome, not an error.** The client deletes duplicated ids just like accepted ones. A non-zero `duplicates` count is normal operation.
- **Ordering across retries is not guaranteed.** A re-sent batch may land after a later one. Nothing may depend on insertion order — which is why every ordering in the read path is on `occurred_at`, never on `received_at`.

### What the server does with a rejected event

`rejectedIds` is the third outcome, and it needs its own rule, because the naive handling (leave it in the queue and retry) produces a queue that never drains.

A rejected event is one that failed zod validation against its type's schema. Rejections are possible for two reasons, and the server cannot distinguish them:

- **A client bug** — the shape is wrong and will be wrong forever.
- **A version skew** — an old client sending a shape the new server no longer accepts.

Both are resolved by not retrying and telling the client. The client removes rejected ids from the queue and records the count and the first reason in `lastError`, which surfaces in the UI. This is a deliberate choice of visible, bounded loss over an unbounded retry loop: a queue that never drains captures nothing at all, which is strictly worse than losing the malformed events. The `schemaVersion` on the batch is what makes the skew case identifiable rather than mysterious.

## The sync protocol

```
client                                  services/ingestion
  │
  │  1. read oldest N un-acked events, ordered by occurredAt
  │  2. build ActivityBatch { schemaVersion, deviceId, clientSentAt, events }
  │
  ├── POST /v1/ingest/batch ──────────────────────────────►│
  │      apikey: <supabase anon key>                       │  3. verify apikey
  │      Authorization: Bearer <user JWT>                  │  4. verify JWT → userId (never from body)
  │      X-Device-Secret: <device secret>                  │  5. verify secret hash for body.deviceId
  │      Idempotency-Key: <batch hash>                     │  6. reject if device.revoked_at is not null
  │                                                        │  7. zod validate every event
  │                                                        │  8. insert on conflict (device_id, dedupe_key)
  │                                                        │     do nothing → accepted / duplicates
  │                                                        │  9. stamp received_at; compute serverCursor
  │◄── 200 ActivityBatchResult ────────────────────────────│
  │      { accepted, rejected, duplicates,                 │
  │        serverCursor, rejectedIds }                     │
  │
  │ 10. delete accepted + duplicate ids from IndexedDB
  │ 11. record rejectedIds in lastError, remove them too
  │ 12. persist { cursor: serverCursor, lastSyncedAt }
  │
  │ 13. fire-and-forget: invoke process-activity edge function
  │     (idempotent; a lost invocation is recovered by the scheduled sweep)
  │
  │ 14. if pendingCount > 0, schedule the next drain
```

| Aspect                     | Rule                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch size                 | `SYNC_BATCH_SIZE`, default `100` events. Also the drain trigger threshold.                                                                                                                                                          |
| Event order within a batch | `occurredAt` ascending, `id` breaking ties.                                                                                                                                                                                         |
| Trigger set                | idle-transition, post-capture alarm (`IDLE_FLUSH_DELAY_SECONDS`, default `60`), periodic floor (`VITE_SYNC_INTERVAL_SECONDS`, default `120`), startup, and count threshold.                                                         |
| Retry                      | Exponential backoff with jitter, capped, driven by the normalised error class from `packages/providers`-style taxonomy (`rate_limited`, `timeout`, `unavailable` ⇒ retry; `auth`, `bad_request` ⇒ do not retry).                    |
| Backoff ceiling            | A device that has failed for hours must keep trying but must not hammer: the ceiling is the periodic floor alarm, not a tighter loop.                                                                                               |
| Non-retryable responses    | `401` (JWT invalid — the user must re-authenticate), `403 device_revoked` (stop capture and surface it), `400` with a schema error (reject the ids, do not retry).                                                                  |
| Acknowledgement            | Per event id. Never per batch. A partially-acknowledged batch re-sends only the remainder.                                                                                                                                          |
| `serverCursor`             | Opaque, server-issued, and a **different token type** from a pagination cursor (ADR-017). Increments monotonically per device.                                                                                                      |
| Clock skew                 | `occurredAt` is client-supplied and cannot be fully trusted. `receivedAt` is server-stamped. A `occurredAt` in the future or older than a bound is clamped and the clamp is recorded in `metadata` rather than rejecting the event. |
| Batch-level idempotency    | `Idempotency-Key` is a hash of the batch's event ids, so a re-sent batch is recognisable at the door, before per-event work.                                                                                                        |
| Ordering across batches    | Not guaranteed, and nothing depends on it.                                                                                                                                                                                          |

## The processing pipeline

Stages run in this order, each one idempotent and resumable. The unit of work is a **document**, not an event.

| #   | Stage                    | Input                                                                                                               | Output                                                                                                                                                                 | Idempotency key                                 | Phase |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| 1   | **Aggregate**            | `activity_events` rows for a URL within a window                                                                    | A `documents` row (or an existing one, matched on `(user_id, content_hash)`) with contributing events linked                                                           | `(user_id, content_hash)`                       | 2     |
| 2   | **Re-score importance**  | The aggregated events; the corpus for novelty                                                                       | `server_importance`, `importance_version`                                                                                                                              | `importance_version ≠ current`                  | 2     |
| 3   | **Extract**              | The stored content for the `contentHash`, or a fetch for a URL with no captured body                                | `documents.extracted_text`, `word_count`, `reading_time_seconds`, `language`, and `extraction_status` (`ExtractionStatus`)                                             | `extraction_status ≠ 'succeeded'`               | 2     |
| 4   | **Chunk**                | `extracted_text`, heading structure                                                                                 | `document_chunks` rows with `ordinal`, `text`, `token_count`, `heading_path`, `strategy = 'recursive'`, `content_hash`                                                 | `(document_id, ordinal)` + chunk `content_hash` | 2     |
| 5   | **Embed**                | Chunk texts                                                                                                         | `embedding`, `embedding_model` per chunk                                                                                                                               | `embedding_model ≠ configured model`            | 2     |
| 6   | **Classify topics**      | Chunk texts + document metadata; existing `topics`                                                                  | `document_topics` rows (`confidence`, `is_primary`), new `topics` rows from `TopicSuggestion`s, `documents.topic_ids`                                                  | `(document_id, topic_id)`                       | 2     |
| 7   | **Distill**              | Chunks with `heading_path` context; document metadata — **only for a document at or above `DISTILLATION_MIN_BAND`** | `MemoryCandidate[]` — possibly **empty**, which is success (ADR-007)                                                                                                   | `(document_id, prompt_version)`                 | 3     |
| 8   | **Adjudicate**           | Each candidate + near-duplicate active memories                                                                     | `MemoryMergeDecision` per candidate (`insert`/`merge`/`supersede`/`reject`)                                                                                            | candidate content hash                          | 3     |
| 9   | **Persist memories**     | Decisions                                                                                                           | `memories` rows, `memory_sources` rows, embeddings, closed validity windows on superseded rows — one transaction                                                       | `memories.id` + supersede constraint            | 3     |
| 10  | **Attribute provenance** | Every stage                                                                                                         | `importance_version`, `extraction_version`, `chunking_strategy` + `content_hash`, `embedding_model`, `classification_version`, `distillation_prompt_version` + `model` | —                                               | 2–3   |

Three properties the table is designed to guarantee:

- **Every stage can be re-run without effect.** Each row above is a query a backfill can be written from — "select rows whose stamp is not the current version" is the whole re-processing mechanism, and it is the same shape for importance, extraction, embedding, and distillation.
- **Partial progress is safe.** A pipeline that fails at stage 5 leaves a document with chunks and no embeddings, which is a valid state: retrieval simply does not see those chunks in the vector leg, and the FTS leg still finds them. There is no stage after which the document is unusable.
- **The stages are ordered by cost, cheapest first.** Aggregation and extraction are free; embedding and distillation cost real money per token. A document that fails at extraction never reaches the stages that cost money.

## The retrieval pipeline

| #   | Stage                        | Implementation                                                                                                   | Config                                                                                             | Degrade behaviour                                                                     |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Intent routing**           | Heuristic pass, then a cheap `LlmProvider` classification into `QueryIntent`                                     | —                                                                                                  | Fall back to `mixed`                                                                  |
| 2   | **Vector leg**               | `embedding <=> $queryVec` over `document_chunks` and `memories` (partial on `status = 'active'`), `hnsw` indexes | `RETRIEVAL_TOP_K` = 40                                                                             | Leg omitted; `degraded: true`                                                         |
| 3   | **FTS leg**                  | `websearch_to_tsquery` against the generated `tsvector`, `ts_rank_cd` ranking, GIN index                         | `RETRIEVAL_TOP_K` = 40                                                                             | Never degrades — no external dependency                                               |
| 4   | **Metadata filters**         | SQL predicates on `topicIds`, `sourceTypes`, `kinds`, `from`/`to`, `deviceIds`                                   | from `RetrievalQuery.filters`                                                                      | Cannot degrade; an unsatisfiable filter returns zero results honestly                 |
| 5   | **Reciprocal rank fusion**   | `rrf_score = Σ weight / (60 + rank)`, per-list weights, ties broken by id                                        | `HYBRID_VECTOR_WEIGHT` = 0.6, `HYBRID_FTS_WEIGHT` = 0.4                                            | With one leg missing, RRF degenerates to a single-list ranking without changing shape |
| 6   | **Rerank**                   | `Reranker` implementation (local cross-encoder proposed, hosted API as the alternative)                          | `RERANK_TOP_K` = 8                                                                                 | RRF order retained, `rerankScore: null`, `degraded: true`                             |
| 7   | **Memory recency weighting** | `memories.access_count`, `last_accessed_at`, `valid_from` on the surviving memory candidates                     | A decayed weight per memory, from `MemoryDecayConfig` (`halfLifeDays`, `minWeight`, `accessBoost`) | —                                                                                     | 4   |
| 8   | **Context assembly**         | Deduplicate overlapping chunks, order strongest-nearest, assign citation indices, pack to a token budget         | —                                                                                                  | If over budget, truncate lowest-ranked first and record the drop                      |
| 9   | **Return**                   | `RetrievalResult` with per-signal scores retained on every `RankedChunk`                                         | —                                                                                                  | `degraded` is the honest signal that a stage was skipped                              |

The pipeline is a fan-out and a fold, not a chain: steps 2 and 3 run concurrently and are combined at step 5. That matters for the failure design, because a missing leg is a missing term in a sum rather than a broken link in a sequence.

Three deliberate asymmetries:

- **Exact-identifier routes skip step 6.** A cross-encoder asked "is this passage about `ERR_TIMEOUT_503`" can legitimately answer "not really" about a passage that contains the literal string, and be wrong in a way the user will notice immediately. So `entity` and quoted-string queries are routed around reranking rather than through it (ADR-014).
- **Step 7 applies to memories only, and it is a weight rather than a filter.** A never-retrieved memory is not buried permanently: `minWeight` puts a floor under the decay so an old important memory can still surface, and `accessBoost` rewards memories that have proved useful before. Pure similarity would rank a memory retrieved last week and one from a year ago identically, which is the wrong model of usefulness for a personal memory store.
- **`activity` intent can terminate at step 4.** A question about time spent is answerable from aggregates over `activity_events` with no chunk or memory in the result at all. The `RetrievalResult` still has the same shape; `chunks` may be short and illustrative.

## Failure modes and degraded behaviour

The design principle: **a failure removes a capability and says so; it never fabricates a result and never fails the whole query if a lesser answer is available.** Every row below is a case the code must handle explicitly, and each is an exit criterion in the phase that introduces the dependency.

| Failure                                                                       | What degrades                                                                                       | What the user sees                                                                                                                                                                                                                                                                                                           | Recovery                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Embedding provider unavailable**                                            | Vector leg omitted (retrieval step 2) and new chunks cannot be embedded (processing stage 5).       | Retrieval still works on the FTS leg alone, flagged `degraded: true`. The UI shows a "keyword search only" notice rather than pretending. Existing chunks keep their vectors; nothing is lost.                                                                                                                               | Processing defers with backoff: chunks persist with `embedding: null`, and the `embedding_model ≠ configured` query picks them up when the provider returns.                               |
| **Reranker unavailable**                                                      | Retrieval step 6 skipped.                                                                           | RRF order is used, `rerankScore: null`, `degraded: true`. Answers remain correct; they are ranked less precisely, and the difference is usually invisible to the user.                                                                                                                                                       | Reranking is stateless, so the next query after recovery reranks normally.                                                                                                                 |
| **LLM provider unavailable**                                                  | Classification falls back to the heuristic; distillation cannot run; chat cannot synthesise.        | Fallback chain, in order: (1) `LLM_PROVIDER` → (2) the configured local endpoint (`LOCAL_LLM_BASE_URL`) → (3) for retrieval, return `RetrievalResult` **without** a synthesised answer, so the user gets a ranked, cited passage list instead of prose — a worse but genuinely useful answer. Distillation queues for later. | Distillation is resumable from stored chunks, so a day of provider outage is a backlog, not a loss.                                                                                        |
| **Database unreachable**                                                      | Everything.                                                                                         | An error, honestly reported with a request id.                                                                                                                                                                                                                                                                               | Nothing to degrade to; this is the one hard failure.                                                                                                                                       |
| **`hnsw` index missing or not yet built** (e.g. during a re-embed migration)  | Vector leg falls back to a sequential scan or is omitted.                                           | Slower results, or `degraded: true` if the leg is skipped.                                                                                                                                                                                                                                                                   | Building the index is a migration step (ADR-004); the service should detect and report rather than time out.                                                                               |
| **Extraction fails** (paywall, cookie wall, JS-rendered, transcript disabled) | Chunks and therefore memories cannot be produced for that document.                                 | The activity dashboard shows the document with its metadata and an explicit `extraction_status = 'failed'` state and reason. It is never silently absent, and it never produces memories from metadata alone.                                                                                                                | Retried on a schedule while the status is `pending`; a terminal `failed` state requires a manual retry from the UI. See [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) for the failure taxonomy. |
| **Distillation yields zero memories**                                         | Nothing — this is success (ADR-007).                                                                | The document appears in activity with no memories. The eval harness counts it as a correct empty, not a miss.                                                                                                                                                                                                                | None needed.                                                                                                                                                                               |
| **Adjudication cannot decide** (similarity is ambiguous)                      | The candidate is inserted with `status: 'candidate'` rather than `active`.                          | A review item appears in the memory review queue; the memory is not retrievable until confirmed when the ambiguity is high.                                                                                                                                                                                                  | User review, or a later adjudication pass with a better model.                                                                                                                             |
| **Client queue unreachable / stuck**                                          | Capture continues locally; nothing reaches the server.                                              | `pendingCount` and `lastError` are surfaced in the extension popup and the Android app, plus a dashboard warning when a device has not synced within a threshold. This is the one case where the server genuinely cannot tell "nothing happened" from "nothing got through".                                                 | Backoff retry, and an explicit "sync now" action.                                                                                                                                          |
| **Device revoked**                                                            | All capture stops for that device.                                                                  | An explicit `403 device_revoked` on the next sync, and a UI state telling the user the device needs re-registration.                                                                                                                                                                                                         | Re-registration issues a new secret (ADR-018).                                                                                                                                             |
| **Clock skew on a device**                                                    | `occurred_at` ordering is wrong in the dashboard; temporal queries are wrong for that device.       | Nothing visible, until a temporal question returns something odd.                                                                                                                                                                                                                                                            | Clamping at ingest plus a divergence check between `occurredAt` and `receivedAt` recorded in `metadata`; a device whose skew exceeds a bound is flagged in settings.                       |
| **Provider returns malformed JSON for structured extraction**                 | The `completeJson` repair-and-retry loop runs, then the candidate set is dropped for that document. | The document is retrievable by chunks but produced no memories, with the failure recorded against the extraction version so it is retryable.                                                                                                                                                                                 | Retried on the next processing pass; provider-specific JSON reliability is a selection criterion in [RESEARCH_NOTES.md](./RESEARCH_NOTES.md).                                              |
| **Retention sweep running late**                                              | Raw events live longer than policy.                                                                 | Nothing user-visible; the sweep is a maintenance job.                                                                                                                                                                                                                                                                        | Idempotent and resumable, keyed on the band-based cutoffs in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).                                                                                   |

### The `degraded` flag, precisely

`RetrievalResult.degraded: boolean` is the contract that makes the above honest. It means **at least one configured stage of the retrieval pipeline did not run**, and it must be set conservatively:

- A skipped vector leg sets it. A skipped rerank sets it.
- A reranker that ran and returned the same order does **not** set it.
- An empty result set does **not** set it — no results is a legitimate answer to a question about something that was never captured, and conflating it with degradation would make the flag useless.
- A partial result set due to truncation at the token budget does not set it; that is normal assembly, and the truncation is recorded separately.
- The UI must surface it. A degradation that the user cannot see is indistinguishable from a quality regression, and this flag exists so that it is not.

## Deployment topology

```
                    ┌──────────────────────────────────┐
  User's devices    │  Chrome Web Store / APK release   │
                    │  (clients are shipped artefacts,  │
  ──────────────►   │   not server-deployed)            │
                    └──────────────────────────────────┘
                                    │ HTTPS
                                    ▼
                    ┌──────────────────────────────────┐
  Edge / CDN        │  apps/web on a Next.js host       │  ← deployed independently
                    │  (server components + route       │
                    │   handlers for /chat streaming)   │
                    └────────────────┬─────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
  Managed platform   │  Supabase project                 │
                    │  ─ Postgres + pgvector + RLS     │
                    │  ─ Auth (JWT issuance)           │
                    │  ─ Edge functions: process-       │
                    │    activity, embed, distill      │
                    │  ─ Storage (future: exports)     │
                    └────────────────┬─────────────────┘
                                     │ service-role, server-side only
                    ┌────────────────▼─────────────────┐
  Services           │  services/ingestion  (HTTP)      │
                    │  services/processing (worker +    │
                    │    scheduled sweeps)              │
                    │  services/retrieval  (HTTP)       │
                    └────────────────┬─────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
  External           │  Embedding + LLM providers        │
                    └──────────────────────────────────┘
```

| Environment           | Shape                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local development** | Supabase CLI stack in Docker (Postgres on `55321` locally), the three services in Turborepo watch mode, `apps/web` dev server. Migrations applied with `supabase db reset` for a clean rebuild. No hosted provider required: `LOCAL_LLM_BASE_URL` and a local embedding endpoint are enough to run the whole pipeline offline. |
| **Hosted**            | One Supabase project, one Next.js deployment, and the services as containerised Node processes. The services are the only things holding `SUPABASE_SERVICE_ROLE_KEY`.                                                                                                                                                             |
| **Clients**           | Shipped, not deployed. The anon key and `VITE_API_BASE_URL` are baked in at build time, which is why they must be public values only.                                                                                                                                                                                             |

Three properties worth stating because they constrain future changes:

- **The services are stateless, and holding no state is what makes them individually restorable.** No service keeps a queue in memory; the queue is IndexedDB/Room (ADR-010) and the processing backlog is the database's `where <stamp> ≠ current` queries.
- **`services/processing` is the only component that is a worker rather than a request/response server.** It is triggered by a post-ingest invocation and by a scheduled sweep, redundantly, so a lost invocation is a latency problem and not a correctness problem.
- **There is no message broker.** Postgres is the queue. This is a deliberate simplification (ADR-002, ADR-003) and it holds because the pipeline's stages are idempotent queries rather than events, which means a broker would add delivery semantics the system does not need. Revisit when a stage needs to be retried independently at high volume — see the triggers in [ROADMAP.md](./ROADMAP.md).

## Observability

The system is a personal tool with one operator, so observability is aimed at answering "what happened to this specific thing" rather than at dashboards.

### Request and correlation ids

- Every HTTP response carries a `requestId`, and it is present in the error envelope (`{ error: { code, message, requestId } }`) so a user-reported failure is traceable without asking them to reproduce it. This is specified in [API_REFERENCE.md](./API_REFERENCE.md).
- A batch sync threads one `requestId` through validation, insert, and the processing invocation, so a rejected event's whole path is one grep.
- Processing jobs carry a `jobRunId` in addition to the originating `requestId`, because a processing run touches many documents from many requests and both directions of the traversal are needed.

### Version stamps as the observability substrate

The decision that makes re-processing auditable (and therefore debuggable) is that **every derived artefact records what version of what produced it**. A change in output quality is then attributable to a change in a stamp rather than a mystery.

| Stamp                               | Column                                                        | Answers                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImportanceScore.version`           | `activity_events.importance_version`                          | "Which rubric scored this?" and, for re-scoring, "which rows are behind?" — `where importance_version is distinct from $current`. The default stamp is `IMPORTANCE_ENGINE_VERSION` (`importance-v1`). |
| Extraction version                  | `documents.extraction_status` + version stamp                 | "Did extraction run, fail, or not try?" and "which documents predate the new extractor?"                                                                                                              |
| Chunking strategy + `content_hash`  | `document_chunks.strategy`, `.content_hash`                   | "Which chunks were produced by the old splitter?" — the query that makes a re-chunk incremental instead of total.                                                                                     |
| `embedding_model`                   | `document_chunks.embedding_model`, `memories.embedding_model` | "Which vectors are stale?" and, critically, "which vectors must be excluded from search?" (ADR-004)                                                                                                   |
| Classification version              | topic assignment stamps                                       | "Which assignments came from the keyword pass and which from the model?"                                                                                                                              |
| Distillation prompt version + model | on `memory_sources` / the distillation run record             | "Which memories were distilled by a prompt we have since changed?" — the query that makes a re-distill targeted.                                                                                      |
| Reranker `version`                  | `RankedChunk.rerankScore` provenance                          | "Did the ranking change because the reranker changed?"                                                                                                                                                |

The pattern is uniform on purpose: **every stamp exists so that a backfill is a `where` clause.** A stamp that is not queryable is not observability, it is a comment.

### What is deliberately not measured

- **No per-page or per-domain analytics are sent anywhere.** Session telemetry, funnel analytics, or crash reporting that includes event content would violate the privacy promise in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md). Errors are reported as codes and request ids, never as content.
- **No content in logs.** Log lines reference ids, counts, durations, and error classes. A log statement that interpolates `text`, `statement`, or `extracted_text` is a bug.
- **No engagement metrics as a product goal.** `memories.access_count` and `last_accessed_at` are recorded because they are the only feedback signal about retrieval usefulness, not to build a retention chart.

### The three health signals that matter

| Signal                                      | Source                               | Why it is the important one                                                                                                  |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Pending count and last error per device** | `DeviceSyncState`                    | Distinguishes "nothing captured" from "everything stuck" — the failure the server cannot otherwise see.                      |
| **Processing backlog by stamp**             | The `where <stamp> ≠ current` counts | The size of every deferred job, and the honest measure of whether the pipeline is keeping up.                                |
| **Degraded-query rate**                     | `RetrievalResult.degraded`           | The rate at which retrieval answered from a partial pipeline. A slow rise here is the earliest signal of a provider problem. |

`GET /health` reports reachability of each dependency and nothing user-specific — no counts, no ids, no user data. Its shape is specified in [API_REFERENCE.md](./API_REFERENCE.md).

## Security model

Four mechanisms, in order of how much they are load-bearing.

### 1. RLS on every table, deny by default

A table with RLS enabled and **no policy** returns zero rows to `anon` and `authenticated`, and every policy predicate is `user_id = auth.uid()` (or a join to a row that satisfies it). No policy means no access, so a table added without policies is inaccessible rather than open — which is the correct failure direction.

Every application table lives in the **`second_brain`** schema rather than `public` (ADR-020), and that schema is reachable over HTTP only because `supabase/config.toml` lists it in `[api].schemas`. Two consequences are easy to get wrong and both are silent:

- **PostgREST does not serve a schema it was not told about.** A missing `second_brain` entry fails every request with `PGRST106` before any policy is evaluated, so correct RLS is no defence against that mistake.
- **Policies are filters, not grants.** The schema carries explicit `usage` and table grants, plus an `alter default privileges` line so that a table added by a later migration is not left invisible; and every table is `enable`d **and** `force`d, because migrations run as `postgres`, which owns the tables and is otherwise exempt from their policies.

The grants, the `force row level security` rule, and the config surface are all specified in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#privileges-rls-policies-are-filters-not-grants) and in [`supabase/README.md`](../supabase/README.md).

The service-role key bypasses RLS entirely, so server-side services are **outside** this protection and must filter by `user_id` in their own queries. That is not a gap to fix; it is the reason the second mechanism exists.

A table with RLS enabled and no policy is invisible, which is also the failure mode to fear: a _new feature_ that silently returns nothing because the policy was forgotten. So the guard is a phase-1 CI assertion in both directions:

- Every table in the `second_brain` schema has `relrowsecurity = true`.
- Every table has at least one policy, or is explicitly listed as service-role-only with a reason.
- Policy tests run as two distinct users and assert that neither can read the other's rows, in both directions, for every table.

Per-table policies, predicates, and names are specified in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).

### 2. Two Supabase client modes, and the anon-key-only rule

`packages/database` exposes exactly two constructors, and the distinction is the security boundary in code:

| Mode             | Key                                         | Where it may run                          | RLS                                                |
| ---------------- | ------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| **Anon mode**    | `SUPABASE_ANON_KEY` + the caller's user JWT | Everywhere, including all clients         | Enforced. Reads only what `auth.uid()` owns.       |
| **Service mode** | `SUPABASE_SERVICE_ROLE_KEY`                 | Only in `services/*` process environments | **Bypassed.** Must filter by `user_id` explicitly. |

The rule: **only the anon key ever ships in a client bundle.** The anon key is safe to ship because it grants nothing by itself — RLS denies without a user JWT — which means the anon key's safety is _derived_ from RLS, and RLS is therefore load-bearing for a public artefact. This chain of reasoning is ADR-018, and it is why mechanism 1 cannot be relaxed.

Service mode is used only where a client cannot legitimately write: ingestion persistence, processing, and the edge functions. No client workspace references the service-role variable, and that is checked rather than assumed.

### 3. Per-device ingest secrets

| Credential                                   | Held by     | Validated by                                               | Grants                                                 |
| -------------------------------------------- | ----------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Supabase anon key                            | All clients | Supabase gateway                                           | API access; RLS still denies without a JWT             |
| Supabase user JWT                            | All clients | Supabase Auth, surfacing as `auth.uid()`                   | Rows the user owns                                     |
| Per-device ingest secret (`X-Device-Secret`) | One device  | `services/ingestion`, against `devices.ingest_secret_hash` | The right to submit activity for that `device_id` only |

Rules that make this hold:

- **Secrets are stored hashed and are never part of a read model.** `devices.ingest_secret_hash` is deliberately not a field of the `Device` type in `@second-brain/shared`, so it cannot leak through a serialisation path.
- **Secrets are issued server-side at device registration.** A client cannot mint its own, or a compromised client could create a device the user never authorised.
- **`user_id` is resolved from the verified JWT, never from the request body.** A body-supplied `userId` is ignored, and there is a test for it. This is the specific bug that would turn the service-role key into a cross-user write.
- **`device_id` is verified against the secret's hash.** Presenting a valid JWT with another user's `device_id` fails at step 5 of the sync protocol.
- **Revocation is a column write** (`devices.revoked_at`), effective immediately, and rejected with an explicit `403 device_revoked` rather than a silent success.
- **Clients cannot write activity directly.** There is no `insert` policy on `activity_events` for `authenticated`. Ingestion is the only path, which is also what makes the zod schemas and the exclusion re-check enforceable in one place.

### 4. The exclusion invariant as a security property

Excluded domains, app packages, and URL patterns produce **no record at all** — no row, no queue entry, no counter, no redacted placeholder. The check runs before the event object is constructed (ADR-009), which is what makes it a property of what the system _can_ leak rather than of what it _chooses_ not to send.

The honest limits, stated because a security section that only lists strengths is not useful:

- **Sync is not retroactive.** Content already sent to a provider for embedding or distillation has already left. The exclusion list prevents capture; it does not un-send. This is why onboarding asks for exclusions before capture starts, and the UI must say so plainly.
- **A rule added later converges, it does not erase.** Re-scoring historical events after the exclusion list changes sets `appIsExcluded: true`, which forces the `noise` band (ADR-009). The rows are not deleted automatically, because deleting evidence the user may still want is a different decision that belongs to retention policy and the delete path.
- **The exclusion list itself is stored**, because it must be enforced. It contains patterns the user typed, not observations about their activity.
- **Client secrets are bearer tokens in local storage.** A browser extension has no secure element, so a per-device secret is a credential with a device-sized blast radius. Stated honestly rather than described as secure storage.
- **The host can see metadata.** Row counts, table sizes, and request volumes are visible to the platform operator (ADR-002). Content is protected by RLS and encryption at rest; volume is not hidden.

## Related documents

| Document                                     | Why                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) | The product case and the pillars these components implement.                                   |
| [DECISIONS.md](./DECISIONS.md)               | Why each structural choice was made, and what it costs.                                        |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)   | The tables, indexes, and exact RLS policies referenced throughout.                             |
| [API_REFERENCE.md](./API_REFERENCE.md)       | The HTTP surface, including the sync protocol's wire format.                                   |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)     | Provider candidates, extraction failure modes, and the experiments that settle open questions. |
| [TASKS.md](./TASKS.md)                       | Which phase builds which stage, and the exit criteria.                                         |
| [ROADMAP.md](./ROADMAP.md)                   | What comes after v1, and the triggers that would re-architect this design.                     |
