# @second-brain/ingestion

The HTTP edge that turns raw client activity into validated, deduplicated, server-scored rows, and hands work to the processing pipeline.

## Status

Scaffold only. The folder structure, the zod schemas, the handler contracts and the type surface are real; **no handler body is implemented**. Every unimplemented function throws `Not implemented: <symbol>` behind a `TODO(phase-1)` marker, and the Hono app has route stubs with no runtime attached. Nothing in this package can serve a request yet.

`src/validation/schemas.ts` is the exception in kind, not in status: the schemas are complete because they are the contract the clients are written against, and they are the artifact other workspaces will validate against.

## Layout

```
services/ingestion/
├── src/
│   ├── index.ts                  Hono app skeleton: bearer auth + 3 write routes + /health
│   ├── handlers/
│   │   ├── activity.ts           per-event and per-batch contracts, IngestionContext, ports
│   │   ├── document.ts           captures for page reads, YouTube, PDFs, manual saves
│   │   └── batch.ts              mixed flush, chunkBatch, the idempotency contract
│   └── validation/
│       └── schemas.ts            zod schemas mirroring @second-brain/shared activity types
├── package.json
├── tsconfig.json
└── README.md
```

## What this service owns

- **Authentication** of every write route and resolution of the token to `(userId, deviceId)`.
- **Validation** of client payloads against `activityBatchSchema`, `ingestDocumentSchema` and the shared schema version.
- **Deduplication** on `ActivityEvent.dedupeKey` and on document `contentHash`.
- **Server-side importance re-scoring.** The client score is a pre-filter only and is always discarded; the score that reaches the database is stamped with the engine version that produced it.
- **Persistence** of activity events and document captures, and **enqueueing** the downstream work.
- The **idempotency contract** that makes a client retry of any flush safe.

## What this service explicitly does NOT own

| Not here                                                        | Owner                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| HTML/readable extraction, YouTube transcripts, text cleaning    | `services/processing/src/extraction`                                                           |
| Chunking, classification, distillation, embeddings              | `services/processing`                                                                          |
| Importance _scoring_ itself (signals, rules, weights)           | `services/processing/src/importance` — this service only calls it through the `ImportancePort` |
| Vector search, full-text search, fusion, reranking, RAG context | `services/retrieval`                                                                           |
| SQL, migrations, RPC definitions                                | `packages/database`, `supabase/`                                                               |
| Provider selection and HTTP clients                             | `packages/providers`                                                                           |
| Any ranking or answer synthesis                                 | `services/retrieval`                                                                           |

In short: this service is allowed to know _what arrived_ and _who it belongs to_. It is not allowed to know what any of it means.

## Scripts

| Script      | Command                                        | Notes                                              |
| ----------- | ---------------------------------------------- | -------------------------------------------------- |
| `build`     | `tsup src/index.ts --format esm --dts`         | Bundles the app entry, emits declarations.         |
| `dev`       | `tsup src/index.ts --format esm --dts --watch` | Same, in watch mode.                               |
| `lint`      | `eslint src --ext .ts`                         | Repo ESLint config.                                |
| `typecheck` | `tsc --noEmit`                                 | Uses this package's `tsconfig.json`.               |
| `test`      | `vitest run --passWithNoTests`                 | Passing with zero tests is expected until phase 1. |
| `clean`     | `rimraf dist .turbo`                           | Removes build output and Turborepo cache.          |

## Configuration

Read from the environment at process start; see `.env.example` for the annotated source of truth.

| Variable                    | Used for                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `INGEST_SHARED_SECRET`      | Bearer token presented by clients on every `/ingest` route.                                |
| `SUPABASE_URL`              | Supabase endpoint handed to `@second-brain/database`.                                      |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side client. Bypasses RLS, so it must never leave this service.                     |
| `IMPORTANCE_MIN_THRESHOLD`  | Floor below which a re-scored event is dropped instead of persisted.                       |
| `SYNC_BATCH_SIZE`           | Client-side flush size; mirrored by `MAX_BATCH_EVENTS` (100) in the schema.                |
| `IDLE_FLUSH_DELAY_SECONDS`  | Client-side flush timer. Documented here because it explains why batches arrive in bursts. |
| `LOG_LEVEL`                 | Verbosity of the `IngestionLogger` implementation wired at the composition root.           |

`EMBEDDING_*` and `LLM_*` are deliberately absent: this service never calls a model provider.

## Public exports

From the package root (`@second-brain/ingestion`):

- App: `createApp`, `bearerAuth`, `SERVICE_NAME`.
- Schemas and bounds: `activityEventSchema`, `activityBatchSchema`, `ingestDocumentSchema`, `MAX_BATCH_EVENTS`, `MAX_SELECTION_TEXT_LENGTH`, `MAX_SELECTION_CONTEXT_LENGTH`, `SCHEMA_VERSION`.
- Inferred input types: `ActivityEventInput`, `ActivityBatchInput`, `IngestDocumentInput`.
- Handlers: `handleActivityEvent`, `handleActivityBatch`, `handleDocumentCapture`, `handleMixedBatch`, `chunkBatch`, `batchIdempotencyKey`, `captureModeFor`, `buildDocumentDraft`.
- Contracts: `IngestionContext`, `IngestionRepository`, `ActivityRepository`, `DocumentRepository`, `ProcessingQueue`, `ImportancePort`, `IngestionLogger`, `IngestionClock`, `ScoredEvent`, `DocumentDraft`, `DocumentOutcome`, `CaptureMode`, `MixedBatch`, `MixedBatchResult`, `DocumentBatchResult`.
- Result types are shared, not local: `handleActivityEvent` returns the shared `IngestionOutcome` and `handleActivityBatch` returns the shared `ActivityBatchResult`, so the web app reads the same shapes the service produces.

## Related docs

- `docs/PROJECT_OVERVIEW.md` — the product case and the privacy invariants this edge enforces.
- `docs/ARCHITECTURE.md` — where the edge sits in the end-to-end flow.
- `docs/API_REFERENCE.md` — request/response bodies for the routes stubbed above.
- `docs/DATABASE_SCHEMA.md` — the tables behind `ActivityRepository` and `DocumentRepository`.
- `docs/DECISIONS.md` — ADR-004 (embedding provider pinning) and the reasoning behind server-side rescoring.
- `docs/TASKS.md` — the phased build order that fixes what "phase 1" means above.
