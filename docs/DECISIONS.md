# Second Brain — Decision Log (ADRs)

An append-only record of the architectural decisions this repository is built on: what was decided, what it costs, and what the alternative was.

Status: draft — scaffold phase, no implementation yet. ADRs marked **Proposed** are not yet binding and are revisited before the phase that depends on them.

## How to read and extend this log

- ADR numbers are **never reused** and never renumbered, even after a supersede. A superseded ADR stays in place with its status changed; the replacement references it.
- An ADR records a decision that is expensive to reverse. Anything cheap to reverse belongs in a code comment or a PR description, not here.
- **Consequences lists are deliberately balanced**: every accepted decision lists what it costs, including the parts we do not like. An ADR with only positives has not been thought through.
- Dates are absolute (`YYYY-MM-DD`). "Context" explains the forces at the time; it is not edited later when the forces change — that is what a supersede is for.
- Open questions that a future ADR must resolve are marked with the ADR number that will resolve them, and are also tracked in [TASKS.md](./TASKS.md) and [RESEARCH_NOTES.md](./RESEARCH_NOTES.md).

| ADR                                                                                                       | Title                                                                                     | Status   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| [ADR-001](#adr-001-pnpm-workspaces--turborepo-rather-than-nx-or-a-plain-repo)                             | pnpm workspaces + Turborepo rather than Nx or a plain repo                                | Accepted |
| [ADR-002](#adr-002-supabase-rather-than-a-hand-rolled-postgres-stack)                                     | Supabase rather than a hand-rolled Postgres stack                                         | Accepted |
| [ADR-003](#adr-003-one-shared-postgres-schema-with-rls-rather-than-schema-per-user)                       | One shared Postgres schema with RLS rather than schema-per-user                           | Accepted |
| [ADR-004](#adr-004-pinned-embedding-dimensions-and-a-mandatory-re-embedding-migration)                    | Pinned embedding dimensions and a mandatory re-embedding migration                        | Accepted |
| [ADR-005](#adr-005-provider-abstraction-behind-a-factory-rather-than-direct-sdk-usage)                    | Provider abstraction behind a factory rather than direct SDK usage                        | Accepted |
| [ADR-006](#adr-006-reciprocal-rank-fusion-rather-than-score-interpolation)                                | Reciprocal rank fusion rather than score interpolation                                    | Accepted |
| [ADR-007](#adr-007-distill-to-memories-rather-than-storing-summaries)                                     | Distill to memories rather than storing summaries                                         | Accepted |
| [ADR-008](#adr-008-memories-are-superseded-never-deleted)                                                 | Memories are superseded, never deleted                                                    | Accepted |
| [ADR-009](#adr-009-client-side-pre-scoring-and-server-side-re-scoring-with-the-client-score-untrusted)    | Client-side pre-scoring **and** server-side re-scoring, client score untrusted            | Accepted |
| [ADR-010](#adr-010-durable-on-device-queues-indexeddb-and-room-rather-than-in-memory-or-direct-writes)    | Durable on-device queues (IndexedDB / Room) rather than in-memory or direct writes        | Accepted |
| [ADR-011](#adr-011-mv3-service-worker-with-chromeidle-flush-rather-than-a-persistent-background-page)     | MV3 service worker with `chrome.idle` flush rather than a persistent background page      | Accepted |
| [ADR-012](#adr-012-android-usagestatsmanager-rather-than-an-accessibilityservice)                         | Android `UsageStatsManager` rather than an `AccessibilityService`                         | Accepted |
| [ADR-013](#adr-013-proposed-recursive-chunking-in-v1-semantic-chunking-deferred-to-phase-7)               | Recursive chunking in v1, semantic chunking deferred to phase 7                           | Proposed |
| [ADR-014](#adr-014-proposed-local-reranker-rather-than-a-hosted-reranking-api)                            | Local reranker rather than a hosted reranking API                                         | Proposed |
| [ADR-015](#adr-015-a-single-activity_events-table-with-typed-jsonb-payloads)                              | A single `activity_events` table with typed JSONB payloads                                | Accepted |
| [ADR-016](#adr-016-hnsw-rather-than-ivfflat-for-vector-indexes)                                           | HNSW rather than IVFFlat for vector indexes                                               | Accepted |
| [ADR-017](#adr-017-keyset-pagination-rather-than-offset-pagination)                                       | Keyset pagination rather than offset pagination                                           | Accepted |
| [ADR-018](#adr-018-anon-key-only-in-clients-with-per-device-ingest-secrets)                               | Anon-key-only in clients, with per-device ingest secrets                                  | Accepted |
| [ADR-019](#adr-019-android-is-a-gradle-project-outside-the-pnpm-workspace)                                | Android is a Gradle project outside the pnpm workspace                                    | Accepted |
| [ADR-020](#adr-020-isolate-all-application-objects-in-a-dedicated-second_brain-schema-rather-than-public) | Isolate all application objects in a dedicated `second_brain` schema rather than `public` | Accepted |
| [ADR-021](#adr-021-phase-1-pins-1024-dimension-embeddings-with-a-named-default-model)                     | Phase 1 pins 1024-dimension embeddings with a named default model                         | Accepted |
| [ADR-022](#adr-022-ingestion-runs-as-the-process-activity-edge-function)                                  | Ingestion runs as the `process-activity` edge function, written by the service role       | Accepted |
| [ADR-023](#adr-023-document-upserts-via-service_role-rpc-not-rls-client)                                  | Document upserts via `service_role` RPC, not an RLS client                                | Accepted |
| [ADR-024](#adr-024-switch-to-the-nemotron-3-embed-model-with-a-matryoshka-reduction-to-1024)              | Switch to the nemotron-3 embed model with a Matryoshka reduction to 1024                  | Accepted |

---

## ADR-001: pnpm workspaces + Turborepo rather than Nx or a plain repo

**Status:** Accepted
**Date:** 2026-09-16

### Context

The system spans four TypeScript applications and libraries (extension, web, three services, three packages) plus one Kotlin app that shares nothing but HTTP contracts. Three pressures:

1. `@second-brain/shared` holds frozen types that `services/*`, `apps/web`, and `apps/chrome-extension` all import. Divergent copies of those types would silently break the frozen contract.
2. The build graph is real but shallow: everything depends on `shared`, most things depend on `database` and `providers`, and the three services do not depend on each other. Nothing is deep enough to need a graph solver.
3. Scope discipline matters more than tooling power. This is a personal-knowledge project with a small number of workspaces; a framework that generates code and owns the directory layout would fight the explicit layout in the brief.

### Decision

Use **pnpm workspaces** for linking and **Turborepo** for orchestration. Workspace names are `@second-brain/<workspace>`, internal dependencies always use the `workspace:*` protocol, and cross-package imports go through the package root barrel only — never a deep path into another workspace's `src/`. A pnpm `catalog` pins `react`, `react-dom`, `@supabase/supabase-js`, `zod`, and `typescript` to one version each, so two workspaces cannot disagree about the Supabase client type surface.

Turborepo tasks are declared in [`turbo.json`](../turbo.json): `build` depends on `^build` (topological), `dev` is persistent and uncached, and `lint` / `typecheck` / `test` depend on `^build` so a stale dependency never produces a green check against stale types.

### Consequences

**Positive**

- Workspace linking is content-addressed and strict; a missing `workspace:*` dependency fails loudly rather than resolving to a published package.
- The pnpm `catalog` makes version drift inside the monorepo a review error rather than a runtime surprise.
- Turborepo's task graph is a JSON file, readable in one screen, with no plugin ecosystem to learn.
- The `@second-brain/*` naming makes the dependency direction obvious in every import line.

**Negative**

- pnpm's strict `node_modules` layout breaks packages that assume hoisted dependencies. Next.js and CRXJS are both occasionally in this category and may require `public-hoist-pattern` or `shamefully-hoist` entries. This is a known tax, accepted knowingly.
- Turborepo's remote cache is hosted; we will not use it (see ADR-018 for the reasoning about not shipping content to third parties). Local cache only.
- Two tools where Nx is one. Contributors must know that `pnpm` links and `turbo` orchestrates; `turbo run` without `pnpm` installed looks like a different tool.
- The Android app is outside this system entirely (ADR-019), so "one build" is false from the start.

### Alternatives considered

- **Nx.** Generators, executors, a plugin for Gradle, and a project graph that understands more than npm scripts. Rejected because the value is concentrated in the generator ecosystem, which we would mostly disable, and because the tool wants to own layout conventions that the brief pins explicitly.
- **Plain repo, no workspaces.** Simplest possible thing; a single root `package.json` with path aliases. Rejected because it makes the app/package boundary advisory. The brief's layout must be enforceable, not aspirational.
- **npm or yarn workspaces.** Viable. pnpm was chosen for strict linking, the `catalog` feature, and disk efficiency across four workspaces that share heavy dev dependencies.
- **Separate repositories per workspace.** Rejected: the frozen cross-cutting types are the single most valuable artifact here, and they must be versioned atomically with the code that consumes them.

---

## ADR-002: Supabase rather than a hand-rolled Postgres stack

**Status:** Accepted
**Date:** 2026-09-16

### Context

The system needs, on day one: Postgres, `pgvector`, full-text search, row-level security, user authentication, object storage for eventual exports, a migration workflow, and a way to run arbitrary server-side code close to the data. It has exactly one operator (the author) and no infrastructure budget line.

Running a hand-rolled stack means Postgres, `pgvector`, an auth service, a migration tool, a connection pooler, backups, and a deploy pipeline — six operational surfaces before the first memory is distilled. Every hour spent on that is an hour not spent on distillation quality, which is the actual risk in this product.

### Decision

Use **Supabase** (hosted, or the local CLI stack for development) as the backend platform. Specifically:

- Postgres with the `vector` extension enabled by migration, not by hand.
- Supabase Auth for user identity; every table carries a `user_id` and RLS policies keyed on `auth.uid()`.
- Supabase Edge Functions (Deno) for the three functions that must run close to the data: `process-activity`, `embed`, `distill`.
- Supabase CLI for migrations (`supabase/migrations/`, append-only) and `supabase gen types typescript` to generate the typed client into `packages/database`.
- The TypeScript services (`services/ingestion`, `services/processing`, `services/retrieval`) remain ordinary Node processes so their logic is testable without the Supabase runtime.

Supabase is used as a **Postgres host with conveniences**, not as the application's only runtime. Business logic lives in the services; edge functions are thin wrappers that exist for locality and scheduling.

### Consequences

**Positive**

- `pgvector` and `tsvector` sit in the same transaction as the relational data. Hybrid retrieval is one SQL round trip with no cross-system consistency problem — this is the property that makes ADR-006 (RRF) practical at all.
- RLS gives a defence-in-depth boundary that does not depend on service code being correct. A query missing a `user_id` filter fails closed.
- Migrations, generated types, local stack, and seed data are one tool with one config file.
- Auth, including JWT issuance and refresh, is not our problem.

**Negative**

- Provider lock-in is real. RLS policies, `auth.uid()`, `auth.users` foreign keys, and edge-function idioms are Supabase-specific. Escaping means rewriting the security layer and the migration history's references to `auth.users`.
- A dependency on a third party observing the database's existence and volume. The content is still protected by RLS and encryption at rest, but metadata (row counts, sizes) is visible to the host.
- Edge functions run on Deno, which means a second TypeScript dialect in the repo (`deno` eslint env, `npm:` specifiers, no shared `tsconfig`). This is a permanent friction tax on any code that wants to be shared between a service and an edge function.
- Supabase's local stack requires Docker. Contributors without Docker cannot run the read paths at all. Documented as a prerequisite in the root README.
- Version churn in the CLI and the client library is frequent; the root `package.json` pins a version range rather than a floating tag.

### Alternatives considered

- **Hand-rolled: RDS/Neon + `pgvector` + a bespoke auth service + `node-pg-migrate`.** Maximum control, no framework lock-in, and the retrieval SQL is identical. Rejected on operational cost, not on technical merit: it adds a pooler, a backup story, and an auth implementation for zero product value.
- **Firebase / Firestore.** Rejected outright: no relational joins, no `pgvector`, no SQL full-text search. Hybrid retrieval with reciprocal rank fusion cannot be expressed as efficiently, and the data model here is emphatically relational.
- **SQLite + a local vector store (sqlite-vec) on the server.** Attractive for the local-only story and cheap. Rejected because multi-device sync and server-side processing want one authoritative store, and a personal Postgres host is not expensive.
- **Supabase self-hosted.** Keeps the API while removing the host dependency. Not rejected — this is the escape hatch, and it is the reason the migration history must not depend on hosted-only features. Revisit if vendor risk becomes the dominant concern.

---

## ADR-003: One shared Postgres schema with RLS rather than schema-per-user

**Status:** Accepted
**Date:** 2026-09-16

### Context

The product is single-tenant per user, but multiuser in the database: every row belongs to exactly one `user_id`, and no row is ever shared. Two conventional ways to isolate that:

- One schema, all users' rows in the same tables, RLS policies keyed on `auth.uid()`.
- One Postgres schema per user (`user_<uuid>.documents`, …), selected by connection or `search_path`.

The schema-per-user approach has a certain appeal for a privacy product: isolation is a namespace property, so "the query forgot the `user_id` filter" is not a bug that can exist.

### Decision

One shared schema — the **`second_brain`** schema, whose object placement and privileges are [ADR-020](#adr-020-isolate-all-application-objects-in-a-dedicated-second_brain-schema-rather-than-public). Every table that holds user content carries a non-null `user_id uuid` column, RLS is enabled on **every** table, and the default is deny: no policy means no access for the `authenticated` or `anon` roles. The service-role key bypasses RLS and is used only by server-side services, which must still filter by `user_id` in their own queries because they are the only thing preventing cross-user reads there.

Security is enforced in three layers, with explicit awareness that a mistake in any one is survivable:

1. **RLS policies** — the boundary that does not depend on service code.
2. **Query-module discipline** — all user-scoped reads go through typed query modules in `packages/database` that require a `userId` argument, so there is no convenient way to write an unfiltered query.
3. **Integrity constraints** — `user_id` is non-null everywhere, foreign keys are composite where ownership is implied, so a row cannot be attached to another user's parent.

### Consequences

**Positive**

- One migration set to write, review, and reason about. Schema-per-user multiplies every migration by the number of users.
- Cross-user operations that will eventually be needed — aggregated costs, provider-level token accounting, scheduled retention sweeps — are single queries instead of a fan-out over an unbounded number of schemas.
- Connection pooling works normally. Schema-per-user with `search_path` interacts badly with poolers, and `user_<uuid>` schemas are invisible to the query planner's statistics at scale.
- `supabase gen types typescript` produces one type set. With per-user schemas there is no single type surface to generate against.
- Indexes are shared, so `pgvector` index maintenance is amortised rather than duplicated per user.

**Negative**

- **A missing RLS policy is a data leak, and the guard is a test, not the type system.** Mitigation: a CI-time assertion that every table in the `second_brain` schema has RLS enabled and at least one policy, plus per-table policy tests that run as two distinct users and assert zero rows leak in either direction. This assertion is a phase-1 exit criterion in [TASKS.md](./TASKS.md).
- A noisy-neighbour query can affect other users' latency; an `hnsw` scan is shared work.
- "Delete my account" is a `where user_id = …` over many tables rather than `drop schema`. Mitigated by making every user-owned foreign key `on delete cascade` from `auth.users`, so a single delete is complete and auditable.
- Every index must lead with `user_id` (or be a partial index on it) to be useful, which constrains index design in ways that are easy to get wrong.

### Alternatives considered

- **Schema-per-user.** Strong isolation as a structural property, and conceptually satisfying for a privacy product. Rejected because migrations, pooling, generated types, and index maintenance all become per-user operations, and because it does not actually eliminate the need for application-level correctness — the service-role layer still has to pick the right schema.
- **A database per user.** The strongest isolation available. Rejected as categorically unaffordable and operationally absurd for a personal tool.
- **RLS plus a per-request `set local app.current_user_id` on a pooled connection, ignoring `auth.uid()`.** Interesting but redundant: Supabase's JWT already carries `auth.uid()`, and adding a second mechanism creates two sources of truth for identity.
- **Application-level filtering only, no RLS.** Rejected. Given that clients hold the anon key and talk to Postgres directly for reads, RLS is the only boundary that holds if a query module is misused.

---

## ADR-004: Pinned embedding dimensions and a mandatory re-embedding migration

**Status:** Accepted
**Date:** 2026-09-16

### Context

`pgvector` columns are declared `vector(N)`, and `N` is fixed. Vectors of a different width cannot be inserted without a cast, and a cast is a lossy dimensionality change, not a migration. Meanwhile the embedding model is the single largest lever on retrieval quality, and the model landscape changes roughly quarterly.

The candidates have different native widths: `nv-embedqa-e5-v5` at 1024, `text-embedding-3-small` at 1536, `text-embedding-004` at 768. Some models support truncation (Matryoshka-style) and some do not; a truncated 1536-dimension vector is not the same as a native 1024-dimension vector even when both are stored in a `vector(1024)` column, because the embedding was trained differently.

Embeddings are also _derived data_, reproducible from source text, which is what makes a re-embed migration possible at all.

### Decision

1. **Pin the dimension at 1024** (`EMBEDDING_DIMENSIONS=1024`) with `nv-embedqa-e5-v5` as the default provider and model. Every vector column — `document_chunks.embedding`, `memories.embedding`, `topics.centroid` — is `vector(1024)`.
2. **Stamp every vector with the model that produced it.** `embedding_model text` is written in the same statement as `embedding`. A vector whose stamp is missing or does not match the configured model is treated as absent by retrieval, never as approximately correct.
3. **A dimension change is a migration with a written plan**, never an in-place widening. The procedure:
   - Add `embedding_<newmodel> vector(N_new)` alongside the existing column, in a single append-only migration.
   - Backfill in batches from source text, writing the new column and its stamp, leaving the old column and index intact and serving.
   - Hold a dual-read window in which retrieval prefers the new column when present and falls back to the old, so quality is never worse than the previous model during the transition.
   - Rebuild the `hnsw` index on the new column, `analyze`, and only then drop the old column and index in a second migration.
   - Report the cost of the backfill (tokens embedded, wall time, provider spend) before executing it, because it is proportional to the whole corpus.
4. **Changing the model at the same width is still a re-embed.** The dimension being equal does not make the vector spaces comparable. Mixed-model vectors in one index produce confidently wrong neighbours, which is worse than no neighbours.

### Consequences

**Positive**

- The schema is simple and the index is a single `hnsw` structure per surface, with no per-model partitioning.
- `embedding_model` makes a partially complete backfill **visible and safe** rather than silently wrong: rows that have not been re-embedded still say which model produced them, so retrieval can exclude them deterministically.
- Reproducibility from source text means a re-embed is a cost problem, not a data-loss problem. `content_hash` on chunks and documents means a no-op re-embed can be skipped by hash.
- The dual-read window means the migration can be run over days without a maintenance window.

**Negative**

- **1024 is a compromise width, not an optimum one.** If a materially better model at 1536 or 3072 dimensions arrives, the ceiling on quality is bounded by the pinned width until the migration is paid for. Some APIs can emit a reduced width natively — that must be verified per model, not assumed.
- A corpus-wide re-embed is the single most expensive recurring operation in the system. It is bounded by corpus token count × provider price, which is why cost is a _driver_ in the roadmap rather than a number.
- Storage roughly doubles during the dual-read window (two vector columns, two `hnsw` indexes) for the duration of the migration.
- The `topics.centroid` column must be recomputed too. Centroid drift during a partial migration can make topic assignment momentarily inconsistent with chunk embeddings.
- The temptation to "just cast" is real and permanently available. The rule in point 4 exists specifically to make that mistake legible in review.

### Alternatives considered

- **Pin 1536 with `text-embedding-3-small`.** The most widely deployed general-purpose model, good tooling, lower risk of being unavailable. Rejected as the default because of the training-data posture and because 1536 at this corpus size costs more index memory per row for a retrieval-quality delta that is not yet measured. Retained as the leading fallback, and the migration path above is what makes it cheap to switch.
- **Store a variable-length `float4[]` array instead of `vector(N)`.** Removes the width constraint entirely. Rejected because it forfeits `pgvector`'s operators and indexes — the whole point of the extension — and would force an external vector store.
- **Model-agnostic storage: one row per (chunk, model) pair in a separate `chunk_embeddings` table.** Genuinely more flexible, supports A/B comparison of models on live data, and would make a gradual migration trivial. Rejected for now as premature: it multiplies storage, complicates every query with a join, and can be introduced later without losing data. Worth reconsidering once a second model is actually in production, and it is the change ADR-004's successor would most likely make.
- **Recompute embeddings on read, cache nothing durable.** Rejected: retrieval latency would be dominated by provider calls and the system would be unusable offline.

---

## ADR-005: Provider abstraction behind a factory rather than direct SDK usage

**Status:** Accepted
**Date:** 2026-09-16

### Context

The system calls two kinds of external model endpoint:

- **Embeddings** — four candidates (NVIDIA, OpenAI, Gemini, local Ollama/vLLM), all OpenAI-compatible or near it, all with different dimensions.
- **LLMs** — for topic classification, distillation, and chat synthesis. DeepSeek is the default; OpenAI, Gemini, Claude, Qwen, and a local endpoint are all candidates.

Writing `new OpenAI(...)` at each call site means the provider choice, the model name, the retry policy, the timeout, the token accounting, and the error taxonomy are duplicated in `services/processing`, `services/retrieval`, `supabase/functions/*`, and `apps/web`. That is five places to change when a provider is swapped, and five places to get retry semantics wrong differently.

### Decision

Every model call goes through `@second-brain/providers`, which exposes **one interface per capability**, with a factory that selects an implementation from configuration:

```ts
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], opts: EmbedOptions): Promise<EmbedResult>;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  complete(prompt: LlmRequest, opts: LlmOptions): Promise<LlmResponse>;
  completeJson<T>(prompt: LlmRequest, schema: ZodType<T>, opts: LlmOptions): Promise<T>;
}
```

Rules that go with the interface:

- **No provider SDK is imported outside `@second-brain/providers`.** Not in a service, not in an edge function, not in the web app.
- **`completeJson` is the only path for structured extraction.** Providers that offer a native JSON mode use it; providers that do not get a repair-and-retry loop. Callers receive a validated object or an error — never a string they must parse.
- **The provider returns its own cost and token accounting** on every result, so the caller does not multiply tokens by a price table it does not own.
- **Failures are normalised** into a small taxonomy (`rate_limited`, `timeout`, `auth`, `bad_request`, `content_filtered`, `unavailable`) so retry and degradation logic is provider-independent.
- Configuration is the selection mechanism: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `LLM_PROVIDER`, `LLM_MODEL` in [`.env.example`](../.env.example). No code change to switch providers.

### Consequences

**Positive**

- Swapping providers is configuration, and the eval harness in [TASKS.md](./TASKS.md) can compare two providers with the same test corpus and no branching.
- Retry, timeout, backoff, cost accounting, and the error taxonomy exist exactly once. This is where most provider-integration bugs live.
- Tests substitute a deterministic fake at the interface, so the whole processing pipeline is testable with no network.
- `completeJson` being mandatory for extraction pushes JSON reliability (see [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)) into a single testable seam rather than being a property each call site hopes for.
- Token accounting per call makes cost projections a measurement rather than a guess.

**Negative**

- **The interface is the lowest common denominator.** Provider-specific capabilities — native tool calling, prompt caching, structured-output grammars, streaming with log probabilities — have to be expressed in the shared shape or discarded. A capability that only one provider has is effectively unavailable unless the interface is widened for it.
- An extra indirection between the caller and the wire makes some errors harder to debug; the raw provider response must be attached to the normalised error or the abstraction becomes a debugging obstruction.
- Streaming needs care: `completeJson` is inherently non-streaming, while chat synthesis is inherently streaming. The interface carries both, which means two code paths to test.
- The concrete model list in [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) will drift. An interface cannot drift; this ADR is deliberately provider-agnostic so the notes can.

### Alternatives considered

- **Direct SDK usage at each call site.** Fewer layers, full access to provider features, and the fastest thing to write for the first call site. Rejected because the second and third call sites are where it degrades into five divergent retry policies.
- **A single OpenAI-compatible client pointed at different base URLs.** Most of the candidates speak the OpenAI chat-completions shape, so this nearly works. Rejected as a _replacement_ for the interface, because it fails exactly where it matters: embedding dimensions and `input_type` asymmetry differ, some providers do not support JSON mode, and DeepSeek/Gemini/Claude each deviate enough that the divergences would end up as `if (provider === …)` blocks — the same duplication with less honesty. Retained as an _implementation strategy_ for the OpenAI-shaped providers behind the interface.
- **Vercel AI SDK or LangChain as the abstraction.** Mature, broad provider coverage, and the streaming story is already solved. Rejected because both bring a large dependency surface, a prompt-template DSL, and a chaining model we do not need; our interface is roughly fifty lines and its semantics are ours. Also worth noting: a framework's retry and telemetry defaults would silently determine data-handling behaviour, which is a privacy surface we want to control explicitly.
- **Route everything through Supabase Edge Functions so there is one network boundary.** Attractive for secret isolation. Rejected as the _primary_ path because Deno/Node divergence would move the abstraction problem rather than solve it; used only for the three functions that benefit from data locality.

---

## ADR-006: Reciprocal rank fusion rather than score interpolation

**Status:** Accepted
**Date:** 2026-09-16

### Context

Retrieval fuses two ranked lists with **incomparable scores**:

- pgvector cosine distance — bounded, but with a distribution that varies with corpus density and query length. A distance of `0.18` means nothing in isolation.
- Postgres `ts_rank_cd` — an unbounded lexical score that depends on term frequency, document length, and the `tsvector` normalisation flags it was computed with.

Both are `float8`. Neither is a probability. There is no principled common unit, and the temptation to write `0.6 * vectorScore + 0.4 * ftsScore` is exactly the mistake this decision exists to prevent: it silently assumes the two scores have comparable scales, which is false and drifts as the corpus grows. Weighting by linear combination also makes the `HYBRID_VECTOR_WEIGHT` / `HYBRID_FTS_WEIGHT` knobs meaningless, because the effective weight of each signal becomes a function of its score distribution rather than of the configured constant.

It is worth being precise about a related temptation, because `RankedChunk` exposes `vectorScore` as a cosine similarity in `[0, 1]` and `ftsScore` as a normalized rank in `[0, 1]`. Those are **display** normalisations, deliberately per-query, and they do not make the two signals commensurable: a per-query min-max normalisation makes the top result of each list `1.0` regardless of how good it actually is, which destroys cross-query comparability and makes any threshold derived from a score meaningless. Normalising for the UI is right. Summing normalised scores to fuse is still wrong, and it is wrong for the same reason as before — the normalisation is relative to the result set, not to the query's quality.

### Decision

Fuse with **Reciprocal Rank Fusion (RRF)**. For a document that appears at rank `r` in a result list, its contribution is `1 / (k + r)` with `k = 60`, summed across lists:

```
rrf_score(d) = Σ_list  weight_list / (k + rank_list(d))
```

Properties that make this the right choice here:

- **Rank-only.** It uses positions, not scores, so it is immune to the scale mismatch and needs no normalisation step, no calibration corpus, and no per-provider tuning.
- **Composable.** A third list (a metadata-only recency ranking, a reranker, an entity-match list) participates by summing. Adding a signal is a new term, not a re-tuning of the existing ones.
- **Robust to outliers.** One enormous `ts_rank_cd` value cannot dominate, because only its rank survives.
- `k = 60` is the value from the original TREC work and is deliberately not tuned per query. It is a config constant, not a parameter to fit.

The per-list `weight_list` is where `HYBRID_VECTOR_WEIGHT` (default `0.6`) and `HYBRID_FTS_WEIGHT` (default `0.4`) apply. Weights scale a bounded contribution, so the configured ratio is the actual ratio — the property the linear combination does not have.

Fusion runs after each list is retrieved at `RETRIEVAL_TOP_K` (default `40`), and its output is truncated to `RERANK_TOP_K` (default `8`) candidates before reranking and context assembly. `RankedChunk.vectorScore`, `.ftsScore`, `.rerankScore`, and `.score` are all retained on the result so the fusion is inspectable and the eval harness can attribute a ranking change to a specific signal.

### Consequences

**Positive**

- No calibration work. There is no "normalise the scores" task in the plan, because there is no score to normalise.
- Metrics are attributable: because each candidate keeps its per-signal scores, a regression can be traced to vector recall, lexical recall, or reranking without guesswork.
- Deterministic and cheap to test — the fusion function is pure, takes two ranked id lists, and returns a ranked list.
- Extensible without retuning: adding a recency list or an entity list is additive, and the existing weights keep their meaning.

**Negative**

- **Score information is discarded.** A chunk that vector search ranked first by a huge margin and a chunk it barely preferred are treated identically at the top of the list. If the retrieval problem is fundamentally "how strong is this match" rather than "how many signals agree", RRF throws away the answer.
- **A single signal is diluted by agreement, not amplified by strength.** A document found by _one_ signal with overwhelming strength loses to a document found by two signals weakly. For exact-identifier lookups this can be actively wrong, which is why intent routing (below) exists.
- RRF requires that both lists be genuinely _ranked_ — a `ts_rank_cd` list where 500 results tie on the same score contributes an essentially arbitrary ordering into the sum. Ties must be broken deterministically (by `document_id`) or fusion becomes non-reproducible, which is a real and easy bug.
- `k = 60` is a magic number carried from the literature. It is not tuned here and will be the first thing to suspect if fusion behaves strangely.
- Adds a stage that must be unit-tested against known-good fused orderings, or a refactor can silently invert it.

### Alternatives considered

- **Weighted linear combination of normalised scores** (`0.6 * norm(vector) + 0.4 * norm(fts)`). If normalisation is per-query min-max, the top score is always 1.0 regardless of absolute quality, which destroys cross-query comparability and makes thresholds meaningless. If normalisation is corpus-wide z-score, it requires statistics that shift as the corpus grows, and a single new document can move the mean. Rejected on both, and because the resulting weights are not what the config says.
- **Convex combination on raw scores.** Requires the two scores to be commensurate, which they are not. Rejected as the mistake this ADR is written to prevent.
- **Only vector search.** Simplest, one stage, one index. Rejected because embedding models are reliably bad at exact tokens: error codes, function names, ticket ids, product names, file paths, and quoted strings are precisely where lexical search is strong and dense retrieval is weakest. Full-text also degrades gracefully when the provider is unreachable (S6 in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)).
- **Only full-text search.** Works with no provider at all and is deterministic. Rejected because paraphrase recall is the primary use case — the user's question and the document answer share almost no tokens.
- **A learned fusion model or a cross-encoder trained on this data.** Would likely be better, once there is data. There is no relevance-labelled corpus at this stage, so it is not a decision that can be made yet. Noted as a candidate for ADR consideration in phase 7+.
- **`ts_rank_cd` weighted by vector similarity as a boost factor.** A hybrid of the two, tuned per query class. Rejected as more knobs with less interpretability, for no measured gain.

---

## ADR-007: Distill to memories rather than storing summaries

**Status:** Accepted
**Date:** 2026-09-16

### Context

Every "chat with your documents" system has to choose what to persist beyond the raw text. The default, and the one almost every retrieval-augmented product implements, is a per-document summary: chunk the document, summarise it, store the summary, embed the summary.

This produces a familiar archive. Ten thousand summaries of ten thousand documents, each one a compressed restatement of something the user already decided was not worth reading carefully. The summary is _about the document_. When the user asks a question, the summary has no privileged relationship to the answer, because the answer is about the user's situation, not the article's contents.

There is also a cost to summarising everything: a summarisation call per document is wasted on the majority of documents that contain nothing durable, and the resulting archive is dominated by noise that dilutes retrieval.

### Decision

The processing pipeline distills documents into **memories**: durable, self-contained statements about the user and their work. A memory is:

- **Atomic** — one proposition per row, not a paragraph. `memories.statement` is a single sentence.
- **Self-contained** — intelligible with no access to the source document. Pronouns are resolved, products and people are named, and the statement does not begin with "this article says".
- **Typed** — one of eight `MemoryKind` values (`fact`, `preference`, `decision`, `project`, `entity`, `insight`, `task`, `reference`), because the type determines how the memory is later superseded, filtered, and surfaced.
- **Attributed** — linked to the chunks and documents it came from via `memory_sources`, with a frozen excerpt, so every memory is auditable back to evidence.
- **Scored** — `confidence` (how sure the extractor is) and `importance` (how much it should affect retrieval), which are separate and must not be collapsed.
- **Temporally bounded** — `valid_from` / `valid_to`, and supersedable rather than deletable (ADR-008).
- **Provenanced** — the prompt version and model that produced it are recorded, so a change in distillation quality is attributable to a change, not a mystery.

**And a document may legitimately produce zero memories.** The extraction contract returns a list, and an empty list is a valid, successful, non-error result. This is a rule with teeth:

- Empty results are not retried and not escalated to a stronger model.
- The pipeline does not fall back to "store a summary anyway". A document with no durable content is recorded as `documents` row with its chunks and no memories, and the eval harness counts it as a correct empty, not a miss.
- Guarding against over-extraction is a real risk in the other direction: a distiller that always finds something is failing, and the eval must include documents that should yield nothing and assert that they do.
- `Document.summary` still exists as a short descriptive field for display in the activity dashboard. It is a convenience for browsing, it is **not** embedded, and it is **not** retrievable content. Nothing about recall depends on it.

The distinction is deliberately sharp: chunks are _what was read_, memories are _what it means for the user_, and summaries are _labels for the dashboard_.

### Consequences

**Positive**

- Retrieval can answer questions that no document answers. "What did we decide about the retry policy?" has an answer when the decision was distilled, and no answer when only the source documents exist.
- The memory layer composes across documents. Three articles read a month apart plus a Slack export can produce one memory that is better than any of them, which is the actual point of the system.
- Zero-memory documents reduce noise in retrieval, which improves precision without any tuning.
- Distillation is where topic novelty and cross-document synthesis happen, so the cost is spent where the value is.
- Memories are small and few relative to chunks, so the vector surface that must be searched for "what do I know" is orders of magnitude smaller than the chunk corpus.
- Because memories carry kinds and validity, the system can answer temporal and preference-shaped queries that a chunk corpus cannot express.

### Negative

- **Distillation quality is the whole product, and it is the least testable part.** A wrong memory is worse than no memory, because it is a confident false statement about the user that will be cited back at them. This makes the eval harness (memories that must be produced, memories that must not be) a first-class deliverable rather than an afterthought.
- **Lossy by construction.** If the distiller misses something, retrieval cannot recover it from the memory layer. Chunks remain the safety net, which is why both surfaces are searched and `RankedChunk.source` distinguishes `document` from `memory`.
- Extraction is the most expensive per-document operation in the pipeline, and it scales with document length.
- Duplicate and near-duplicate memories are inevitable. Adjudication is a distinct problem requiring embeddings, a similarity threshold, and `MemoryMergeDecision` — real work, deliberately deferred to phase 3.
- The three example documents in [RESEARCH_NOTES.md](./RESEARCH_NOTES.md) show how much judgement is in "is this durable?" — two reviewers can disagree, so the definition of a memory needs examples, not just rules.

### Alternatives considered

- **Per-document summaries only.** Cheapest, most familiar, and trivially shippable. This is the decision this ADR exists to reject; the reasoning is in the Context section.
- **Store both summaries and memories.** More content, no conflict. Rejected because summaries embedded into the retrieval surface are noise that competes with memories for the top of the ranked list, and a non-embedded summary is what we already do (`Document.summary`).
- **No distillation; rely on chunks and let the LLM synthesise at query time.** This is the pure-RAG design: store everything, reason at read time. Rejected because it cannot answer cross-document or temporal questions reliably, it makes every query pay the synthesis cost, and it cannot accumulate: nothing improves as the archive grows.
- **Extract memories from a rolling window rather than per document.** Would let one memory cite multiple sources naturally. Rejected for v1 because it makes the unit of work stateful and hard to retry idempotently; per-document distillation with a separate merge step (phase 3) reaches the same place with a much simpler failure story.
- **Let the user write memories manually.** Useful as a correction mechanism, and the schema supports it (`MemoryStatus`, editable statements). Rejected as the primary source: a memory system that only knows what you typed is a note-taking app, which is an explicit non-goal.

---

## ADR-008: Memories are superseded, never deleted

**Status:** Accepted
**Date:** 2026-09-16

### Context

Facts change. A project that was "blocked on legal review" is later "cleared"; a preference for one library is later reversed; a person's role changes. The naive model treats memory as a mutable key-value store: find the old row, overwrite the statement, move on. This is wrong in both directions:

- **It loses the ability to answer temporal questions.** "What did I believe in March?" and "how many times did this decision change?" become unanswerable, and temporal queries are one of the five personas' primary use cases (Tomas's "what did I do last Tuesday", Devi's "papers I read this quarter").
- **It loses the audit trail.** If a memory was cited in a chat answer last month, overwriting its text means the citation now points at a statement that was never made. A citation is only meaningful if the cited statement is immutable.

The opposite failure — deleting the contradicted memory — is worse: it destroys the evidence that the belief ever existed, which is often the interesting part.

At the same time, a memory archive must have a way to remove things, or it becomes an accumulating liability. Two genuinely different intents are being conflated:

| Intent                                    | Whose intent     | Correct semantics                                          |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------- |
| The world changed; this is no longer true | System inference | **Supersede** — keep both rows, close the validity window. |
| This should not exist                     | User decision    | **Delete** — remove the row and its dependents.            |

### Decision

Memories carry explicit temporal validity and are closed, never rewritten:

- `valid_from timestamptz not null default now()` — when the statement became true.
- `valid_to timestamptz null` — `null` means "still believed".
- `superseded_by uuid null references memories(id)` — the replacement.
- `status` moves `active` → `superseded`, and the constraint is enforced: a row with `status = 'superseded'` must have both `valid_to` non-null and `superseded_by` non-null.

Rules:

1. **The statement of an active memory is immutable.** Corrections are made by superseding, not by `update memories set statement = …`. The sole exception is a user correction to an existing, still-active memory during the grace window — that is treated as fixing a transcription error, and it is audited.
2. **Superseding is a two-row transaction.** Insert the replacement with `valid_from = now()`, then close the old row with `valid_to = now()` and `superseded_by = <new id>`. Never one without the other; a partial supersede leaves two active contradictory memories.
3. **Retrieval filters to `status = 'active'` by default** and the vector index on memories is partial on that condition (see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)). Historical statements are reachable only by an explicit temporal query, which sets `filters.from` / `filters.to` and passes back over the closed rows.
4. **Contradiction detection happens before insertion**, not after: the distiller's adjudication step proposes `MemoryMergeDecision` with `action: 'insert' | 'merge' | 'supersede' | 'reject'`, and `supersede` requires naming the `targetMemoryId` and giving a `reason`.
5. **`status = 'archived'` and `'rejected'` are not supersedes.** `archived` removes a memory from retrieval because it is no longer relevant (not because it is false); `rejected` records that an extraction was wrong. Neither sets `superseded_by`, and both are reversible by a user.
6. **Hard delete is a user action, and it is a real delete.** "Forget this" removes the row and its `memory_sources`. It is deliberately not modelled as a status, because a status that retains the content is not a deletion.

### Consequences

**Positive**

- Temporal queries are answerable without a separate history table: the current belief is `valid_to is null`, and the belief at any instant is `valid_from <= t and (valid_to is null or valid_to > t)`.
- Citations remain valid indefinitely. A chat answer that cited memory X still resolves to the exact statement X contained when the answer was generated.
- Contradictions are visible as data rather than lost. "This changed twice in February" is a query, not an archaeology project.
- Superseding plus `MemoryMergeDecision` gives the deduplication story and the temporal story one mechanism instead of two.
- Deleting is unambiguous when the user asks for it, because supersede and delete are not overloaded onto the same status value.

**Negative**

- **Every retrieval path has to remember the filter.** Forgetting `status = 'active'` returns superseded beliefs as if they were current — the worst possible failure for this product. Mitigated by the partial index making the filtered path the fast one, by query modules in `packages/database` that apply it by default, and by a test that asserts a superseded memory is never returned by a default query.
- **The table grows monotonically.** Memories are cheap relative to chunks, so the growth is slow, but a user who has used the system for years will accumulate closed rows indefinitely. The alternative is a retention sweep over superseded rows that is _not_ implemented and would need to preserve citation integrity — an open question for phase 7.
- **Adjudication is hard and is now on the critical path.** Deciding supersede vs merge vs insert requires embedding similarity, a threshold, and often a model call, which is latency and cost per distillation.
- **Supersede chains can become long.** A belief revised ten times yields a chain of eleven rows. Reconstructing "the current position on X" is one query, but "the story of X" needs chain traversal that must be written and tested.
- Distinguishing `archived` from `superseded` from `rejected` is a real cognitive load on the UI. Getting it wrong in the settings screen produces an archive that looks chaotic to the user.

### Alternatives considered

- **Mutable rows with an `updated_at`.** Simplest, and what an ORM-shaped design produces by default. Rejected: destroys temporal queries and invalidates citations.
- **A separate `memory_history` audit table, memories mutable.** Keeps the hot table small and gives an audit trail. Rejected because it splits the read path — every retrieval would need to know whether to consult history — and because "the current statement" and "the statement at time t" would live in different tables with different shapes.
- **Never remove anything, no delete at all.** Maximally faithful to "memory is append-only". Rejected: it makes the product unable to honour a deletion request, which the privacy commitments in [ROADMAP.md](./ROADMAP.md) make a hard requirement.
- **Bi-temporal modelling** (valid time _and_ transaction time, so you can ask what the system believed at time t about time t'). More rigorous, and standard in financial/temporal databases. Rejected for v1 as one axis of complexity too many: the questions this product asks are about the user's past, not about the system's own belief history. Revisit if "when did the system first think X" becomes a real query.
- **Soft delete via `deleted_at` on memories, plus supersede columns.** Adds a third concept to a two-concept problem, and the two-colour status enum already carries the distinction. Rejected.
- **Reopen a superseded memory instead of inserting a replacement** (i.e. set `valid_to` back to `null` if the old belief turns out to be true again). Tempting and superficially elegant. Rejected because it rewrites history: the belief genuinely was false in between, and a citation from that period would now resolve to a statement that appears continuously true.

---

## ADR-009: Client-side pre-scoring **and** server-side re-scoring, with the client score untrusted

**Status:** Accepted
**Date:** 2026-09-16

### Context

Importance scoring determines what gets captured at all: `IMPORTANCE_MIN_THRESHOLD` (default `0.25`) drops events below the bar _on the device_, before they enter the sync queue. This gives three things that are not obtainable any other way:

- **Privacy by volume.** Most page views are noise. If every one is uploaded, the server sees the user's whole browsing history, which is exactly what the product promised not to do (see the exclusion invariant in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)).
- **Bandwidth and battery.** Capturing on a phone means uploading on a phone. A local filter is the difference between kilobytes and megabytes per day.
- **Offline functionality.** A device with no connectivity must still decide what is worth queueing.

But a client-side score has three properties that make it unfit to be authoritative:

1. **It is untrusted input.** The extension runs on a machine the user partly controls; the score arrives over the network in a request body. It is attacker-controlled data, and it will be used to decide what to keep, what to embed, and what to spend money on.
2. **It is blind to history.** The best signal for importance is _novelty relative to what the user already knows_, which requires the corpus. `ImportanceSignals.topicNovelty` is literally uncomputable on a device that has never seen the other devices.
3. **It cannot be revised.** A week later the user adds a domain to the exclusion list, or the scoring rubric improves. Nothing local can re-score history, because the local device no longer has it (and in the exclude case, was never allowed to keep it).

### Decision

Score **twice**, with different authority, and record both.

**Client pre-score (on device).** Computes an `ImportanceScore` from the subset of `ImportanceSignals` available locally — `dwellSeconds`, `scrollDepthPct`, `hasSelection`, `hasCopy`, `isBookmarked`, `isDownloaded`, `youtubeWatchedPct`, `wordCount`, `isUniqueDomain`, `revisitCount`, `isWorkingHours`, and `appIsExcluded` (always `false` for a persisted event by construction; see the note below). Its purpose is **filtering**, not ranking. Passive events (`page_view`, `page_read`, `youtube_watch`, `app_session`) below `IMPORTANCE_MIN_THRESHOLD` never leave the device. **Events the user produced deliberately — `selection`, `copy`, `search`, `bookmark`, `download`, which the shared constants group as `EXPLICIT_INTENT_EVENT_TYPES` — bypass the threshold entirely and are always queued.** The gate exists to keep browsing noise off the network, not to second-guess a click.

**Server re-score (in `services/processing`).** Recomputes the full signal vector, including the signals the client cannot know — `topicNovelty` (needs the corpus), cross-device `revisitCount` and `isUniqueDomain`, and `appIsExcluded` after a rule change. It writes `server_importance` and an `ImportanceScore.version` stamp. Retrieval and downstream processing use `coalesce(server_importance, importance)`, so a row that has not been re-scored yet is still usable at its pre-score.

The consequences of "untrusted" are enforced, not just asserted:

- **The client score can only lower what is kept, never raise it.** The server re-score is bounded above by nothing and the server is free to _increase_ the score of a surviving event; but the client cannot make an event more important than its own signals justify because the server recomputes those signals from the event payload.
- **The client cannot bypass the threshold for excluded content**, because exclusion is enforced at the capture path _before_ the event object is built (the invariant), and additionally the server re-check cannot resurrect anything that was never sent.
- **Trusted signals are recomputed, not trusted.** `dwellSeconds`, `scrollDepthPct`, `isUniqueDomain` and friends arrive as claims; the server recomputes what it can from stored events (durations from timestamps, domain from the URL, novelty from the corpus) and treats the claimed value only as a cross-check. A large divergence between claimed and recomputed is a bug signal and a telemetry counter, not a rejection.
- **`ImportanceScore.version` is mandatory** on every score, and it is the string that makes re-processing auditable: given a new rubric version, the re-scoring job is `where importance_version is distinct from $new_version`, which is deterministic and resumable.
- Client scores are never used for anything with a cost attached (what gets embedded, what gets distilled). Those decisions read the server score.

On `ImportanceSignals.appIsExcluded`: the key is always `false` for an event that reaches the server, because an excluded app's event is never constructed. It is not vestigial, however — it is what the **re-score** path uses when the user adds a package to the exclusion list after the fact. Per the shared contract, a `true` value **forces the score to zero**, which puts the row in the `noise` band. Since the `noise` band is defined as "discarded before persistence" and the retention policy purges it first, the convergence is clean: the invariant applies at capture time (no row at all), and a later rule change moves surviving history into the band that the sweep removes. That is the intended behaviour — a capture-time absolute and a post-hoc convergence — not an oversight. It is recorded in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) and is the reason `importance_band` is a stored column rather than a value recomputed from a float.

### Consequences

**Positive**

- The device never has to upload what a local heuristic considers junk, which is the only architectural answer to "why would I let this watch my browsing?"
- The server score can use the corpus, so `topicNovelty` — plausibly the single strongest importance signal — is available where it matters.
- Re-scoring history is a bounded, idempotent, resumable job keyed on a version string, not an ad-hoc migration.
- A compromised or buggy client cannot inflate importance to cause cost or pollute retrieval, because the server recomputes the trusted signals and makes the cost-bearing decisions itself.
- Keeping both scores means the divergence between client and server is a _measured_ quantity, which is how the local heuristic gets improved: the eval corpus can compare the two and quantify how much the client is throwing away.

**Negative**

- **Two implementations of one rubric, in two languages, that will drift.** The extension is TypeScript and the Android app is Kotlin, so the pre-score already exists twice before the server's third copy. Drift is certain; the mitigation is a shared fixture set of `ImportanceSignals` → expected `ImportanceScore` vectors that all three implementations must pass. This fixture set is the actual artifact that keeps the rubric honest, and it must exist before the Kotlin implementation does.
- **A client that under-scores loses data irrecoverably.** The dropped event was never uploaded; there is no replay. Under-scoring is therefore a _data-loss_ bug, and the threshold must be set conservatively — with the explicit acknowledgement that a conservative threshold means uploading more than ideal.
- **A client that over-scores costs money.** The opposite failure is cheaper but real: more embedding and distillation spend on noise.
- Re-scoring is a full pass over the user's event history, so it is a batch job with real cost and a real runtime at corpus scale.
- The `coalesce(server_importance, importance)` rule means the effective score of a row changes under the reader's feet while a re-score runs, which makes a mid-run eval comparison confusing unless the version stamp is included in the comparison.
- Version strings are easy to forget to bump. A rubric change that does not bump `ImportanceScore.version` silently makes re-scoring a no-op — which is why the version is a required field on the score type, not an optional one.

### Alternatives considered

- **Server-side scoring only; upload everything.** One implementation, one rubric, best quality. Rejected on privacy and bandwidth: it means the server observes every page view including the ones the user would never have consented to upload.
- **Client-side scoring only.** Cheapest, and the score is available with zero latency and no round trip. Rejected on the three points in Context: untrusted, history-blind, and unrevised.
- **Client score as authoritative, server stores it verbatim.** Rejected: attacker-controlled input determining cost and retrieval ranking.
- **Client filters but does not score; server scores.** This is close to the decision and is worth naming as the alternative it is. Rejected because the local score is also what makes the _UI_ useful offline ("what was important today" is browsable with no connection), and because having the client score is the only way to measure how much the local heuristic discards.
- **Fully homomorphic or privacy-preserving scoring.** Not a serious option at this stage and not needed: the signal vector is small and the local score is not secret from the server, which has already seen the event.
- **On-device embedding and vector search so nothing leaves the device at all.** Architecturally attractive and would make the privacy story trivial. Rejected for v1: it forfeits cross-device memory, server-side processing, and corpus novelty signals, and it requires an on-device embedding model of acceptable quality. Kept as a possible future for a "local-only mode", which is noted in [ROADMAP.md](./ROADMAP.md) as a re-architecture trigger rather than a feature.

---

## ADR-010: Durable on-device queues (IndexedDB and Room) rather than in-memory or direct writes

**Status:** Accepted
**Date:** 2026-09-16

### Context

Capture produces events continuously on devices that are frequently offline, frequently suspended, and frequently killed by the OS. The extension's service worker is terminated aggressively by Chrome (ADR-011); an Android app is killed by the OS under memory pressure and after battery optimisations. The question is where an event lives between "observed" and "confirmed persisted server-side".

Three candidates: send immediately and hope; buffer in memory and flush; or write durably to local storage first and sync from there.

The property that matters is the failure mode. A dropped event is invisible: the user never learns that the article they read on the train is missing from their memory, so the loss is only discovered months later, if at all, as a pattern of gaps. That is a much worse failure than a slow sync.

### Decision

**The on-device queue is the source of truth for un-synced events.** Capture writes to durable local storage first; the network path drains that storage. Specifically:

- **Chrome extension:** IndexedDB, written from the content script's message handler, read by the service worker on `chrome.idle` and on an alarm. Versioned object store with an index on `dedupeKey` and on `occurredAt`.
- **Android:** Room (SQLite) with the same logical schema, drained by a `WorkManager` job with a network constraint.
- An event is deleted from the queue **only after an explicit server acknowledgement** — the `ActivityBatchResult` for its id. Not on request success, not on HTTP 200: on the per-id outcome.
- The queue survives restarts, tab closes, process death, and battery-optimiser kills.
- Sync is batched (`SYNC_BATCH_SIZE`, default `100`) and the client keeps `DeviceSyncState`: `cursor`, `pendingCount`, `lastSyncedAt`, `lastError` — the last of which is surfaced in the UI rather than swallowed, because a stuck queue that silently stops draining is indistinguishable from "nothing interesting happened".
- **The queue is bounded.** A cap on retained events (count and age) drops the _lowest-importance_ entries first and records the drop count locally, so a device that is offline for a month degrades instead of filling the user's disk. Drops are local-only and never reported as events.

### Consequences

**Positive**

- No event is lost to a process kill, a closed tab, or a network transition. This is the whole point.
- Offline capture works for arbitrarily long periods, which is the normal case for a phone on a commute.
- Retry is trivial and safe: drain the queue, delete acknowledged ids, leave the rest. There is no "is this event already sent?" bookkeeping beyond the id.
- The queue is inspectable. `pendingCount` and `lastError` give a real health signal, and a user can see that capture is stuck instead of assuming it is broken.
- Batching amortises request overhead and makes server-side idempotency (ADR-018, `(device_id, dedupe_key)`) worth having, because a retried batch is a normal event rather than a rare anomaly.
- The bound keeps the storage footprint predictable on a device the user did not buy for this purpose.

### Negative

- **Local durability is not free.** IndexedDB writes are transactional and asynchronous; Room writes are synchronous and can block a capture callback. Both need care not to add latency to the page the user is browsing. The content-script path must not `await` a queue write in a way that delays a page interaction.
- **Two queue implementations, in two languages and two storage engines**, with the same semantics. They will diverge. Mitigated by specifying the queue's contract (ordering guarantee, acknowledgement rule, bound, drop policy) as a written contract that both implement, and by testing both against the same scenario list rather than trusting symmetry.
- **A stuck queue looks like an empty one** from the server's perspective. Mitigated by surfacing `lastError` and by a server-side "device has not synced in N hours" signal, but the server can never distinguish "nothing captured" from "everything stuck".
- Storage limits exist in both engines (IndexedDB quotas, Android app storage) and both can evict under pressure. A user whose device is full can lose queued events despite the durable write, which is why the bound exists — an explicit drop of the least important events is better than an eviction of arbitrary ones.
- Deleting only on acknowledgement means a queue can grow while the server is down, and the drain is then a burst. The batch size bound limits the burst's peak but not its duration.
- The extension's service worker can be killed mid-drain, so acknowledgement handling must be **per-id and idempotent**, not per-batch. A partially-acknowledged batch must be re-sent as the un-acked remainder, which the server tolerates by design (`duplicates` in `ActivityBatchResult`).

### Alternatives considered

- **Send on capture, no queue.** Least code, no storage, zero durability. Rejected: every offline moment, every service-worker kill, and every network blip is silent data loss.
- **In-memory buffer with a flush timer.** Survives a slow network but not a process kill, and the service worker is killed routinely by design. Rejected for the extension specifically because MV3 makes it not merely risky but normal.
- **Direct writes to Supabase from the client, with the local queue as a fallback.** Attractive because it removes a service from the path. Rejected because it puts the anon key and per-event RLS insert policies in the client, and because per-event round trips are exactly what the batching design exists to avoid. Ingestion stays a service that validates with zod and owns persistence.
- **`chrome.storage.local` as the extension's queue instead of IndexedDB.** Simpler API, works in the service worker without extra permissions. Rejected on scale: `chrome.storage.local` is a single key-value area with a low byte cap and no indexed queries, so an indexed, bounded, per-event-deduped queue is not expressible.
- **A file-based append-only log on Android.** Lower overhead than Room for pure append. Rejected because the queue needs indexed lookups (`by dedupeKey`, `by occurredAt`, oldest-first drain) and a transactional delete-after-ack, which is what SQLite is for.
- **Let the OS/browser own the retry (e.g. a Background Sync API, or WorkManager with a raw HTTP call and no local store).** The retry mechanism is not the problem; the storage of un-sent events is. Background Sync would still need a durable store to sync _from_. Partially adopted: `WorkManager` and `chrome.alarms` are the _schedulers_, and Room/IndexedDB are the _stores_.

---

## ADR-011: MV3 service worker with `chrome.idle` flush rather than a persistent background page

**Status:** Accepted
**Date:** 2026-09-16

### Context

Manifest V3 removed persistent background pages. A service worker is terminated after roughly thirty seconds of inactivity and on a schedule, with no reliable "I am about to be killed" hook. This is not negotiable: MV2 is not an option on the Chrome Web Store.

A capture extension wants exactly what MV3 forbids — a long-lived process that accumulates events and flushes them periodically. The event volumes are low (a page read is one event every few minutes) but bursty (a `selection` and a `copy` in the same second), and the network is frequently unavailable.

### Decision

Embrace the ephemeral worker, and make every step independently durable.

- **Registration:** `chrome.idle.onStateChanged` and `chrome.idle.setDetectionInterval` for activity transitions, `chrome.alarms` for a periodic drain, and `chrome.webNavigation` / `chrome.tabs` for navigation events. No state in module scope is ever assumed to survive.
- **Capture is fire-and-forget into IndexedDB.** The content script sends a message; the worker's handler validates, scores, and writes to the queue in a transaction, then returns. It never holds an in-flight batch across an await boundary it does not control.
- **Flush triggers, in order of preference:**
  1. `chrome.idle` transitions to `idle` or `locked` — the user has stopped browsing, which is the best possible moment to drain (ADR-010's queue is already durable, so this is an optimisation of latency, not a correctness requirement).
  2. `IDLE_FLUSH_DELAY_SECONDS` (default `60`) of quiet after the last captured event, scheduled with `chrome.alarms`.
  3. A periodic alarm (`VITE_SYNC_INTERVAL_SECONDS`, default `120`) as a floor, so a device that never goes idle still drains.
  4. A drain on worker startup, because a worker that just woke up may be waking up precisely because a previous drain was killed.
  5. A drain on `pendingCount >= SYNC_BATCH_SIZE`, so a burst does not wait for idle.
- **Every drain is restartable from durable state.** Cursor, pending set, and last error are in IndexedDB (with `DeviceSyncState` mirrored server-side). A worker killed mid-drain loses nothing but time.
- **Ordering is by `occurredAt`, not by insertion,** because a worker restart can interleave writers and the server's view of an event's time must be the time it happened.

### Consequences

**Positive**

- The extension behaves correctly under the termination policy it cannot change, rather than fighting it.
- Waking up on `idle` is a genuinely good signal and it is free: the user paused, the network is likely fine, and the batch is likely complete.
- Crash-safety comes from the durable queue, so the worker's lifecycle complexity is limited to _scheduling_, which `chrome.alarms` handles.
- Low steady-state memory and CPU: no process idles for hours holding an array of events.
- The same triggers map cleanly onto Android's `WorkManager` constraints, so the two clients share a design even though they share no code.

**Negative**

- **The alarm floor is coarse.** `chrome.alarms` is clamped to a minimum period on stable Chrome (roughly one minute, more when the browser is idle), so "flush after 30 seconds" is not actually available. The worst case is a delay, not a loss.
- **Latency to server is variable and unbounded in the worst case.** An event captured just after a drain may wait up to the alarm period plus idle detection. Acceptable because nothing user-visible depends on near-real-time ingestion, but it makes "I read this two minutes ago, why isn't it in the dashboard" a legitimate user question that the UI must answer honestly ("pending sync").
- **No shared in-memory state means no cross-event batching in memory.** Aggregation that would be trivial with a long-lived process (e.g. folding repeated selection events into one) must be done in the queue, in SQL, at read time.
- **Debugging is harder.** A worker that is torn down mid-operation produces logs that stop mid-sentence, and reproducing a termination requires `chrome://serviceworker-internals` rather than a breakpoint.
- `chrome.idle` requires the `idle` permission, which shows in the install prompt and is a (minor, but real) consent surface for a privacy-positioned product. `chrome.alarms` similarly. Both are justified in the permission rationale the extension must provide, and both are narrower than the `tabs`/`history` permissions the product deliberately does not request.
- The worker can be started for reasons unrelated to sync (e.g. to handle a message), so startup must be cheap and must not unconditionally kick off a drain before the queue is initialised.

### Alternatives considered

- **Manifest V2 background page.** Persistent by design and exactly what this extension wants. Not an option: MV2 is deprecated and unavailable for new listings, and planning around its removal is not planning.
- **An offscreen document to hold a persistent context.** MV3 permits an offscreen document with a DOM context, and its lifetime rules are looser than the worker's. Rejected because it is a workaround with its own lifecycle and permission cost, and because it would still need the durable queue for correctness — so it would add complexity without removing any.
- **Keep state in the worker and accept loss on termination.** Simpler, and the loss would be small (a few events). Rejected because the loss is silent, which is the one failure mode this product cannot afford.
- **Native messaging host for a long-lived local process.** Would give complete control over buffering and scheduling. Rejected as a distribution problem (a separate installable, per-OS binaries) for a benefit the durable queue already provides.
- **A single monolithic batch at browser shutdown.** No such reliable hook exists; `chrome.runtime.onSuspend` is best-effort and not called for all termination paths. Explicitly rejected as a primary mechanism, which is why triggering on idle transition is used instead.

---

## ADR-012: Android `UsageStatsManager` rather than an `AccessibilityService`

**Status:** Accepted
**Date:** 2026-09-16

### Context

Android has two plausible sources of "what app is in the foreground and for how long":

| Source                 | Permission                                                                             | Fidelity                                               | Play Store posture                                                        |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `UsageStatsManager`    | `PACKAGE_USAGE_STATS` — a special access permission the user grants in system settings | Per-app foreground intervals, aggregated by the OS     | Normal; the API exists for exactly this                                   |
| `AccessibilityService` | Accessibility service registration                                                     | Per-window, per-node, effectively everything on screen | High scrutiny; Play restricts accessibility use to accessibility purposes |
| `MediaProjection`      | Screen capture consent per session                                                     | Pixels; would require OCR                              | High scrutiny; intrusive                                                  |

The tempting one is `AccessibilityService`: it gives window titles, node text, and precise transitions — better data than `UsageStatsManager`'s coarse intervals, and it can see browser URLs from an app's address bar that `UsageStatsManager` never exposes.

It also means the app is reading the screen. For a product whose central promise is "excluded apps record nothing at all", an always-on screen reader is the wrong primitive: it makes the exclusion invariant enforceable only by application code that runs _after_ the content is already in the app's memory, and it makes "we do not record your keystrokes" a claim about code review rather than about capabilities.

### Decision

Use **`UsageStatsManager`** for Android capture:

- `app_session` events are derived from `UsageEvents` — foreground interval start/end per `packageName`, with `appLabel` resolved from the package manager.
- Only `MOVE_TO_FOREGROUND` / `MOVE_TO_BACKGROUND` / `ACTIVITY_RESUMED` / `ACTIVITY_PAUSED` events are consumed; `UsageEvents` carries other event types that are ignored by an explicit allow-list, not by a blocklist.
- Events shorter than a minimum duration are discarded on device, and intervals longer than a screen-on window are truncated with the truncation recorded in `metadata`.
- Content is **never** read. No window titles, no node text, no UI hierarchy, no screen pixels. `app_session` has `packageName`, `appLabel`, timestamps, `durationSeconds`, and `isForeground` — and that is the complete set of what Android contributes.
- **The exclusion check happens before the event is constructed**, in the same place the interval is read: if `packageName` matches the exclusion list, no `app_session` object is created, nothing is written to Room, and nothing is counted. This is the exclusion invariant from [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md), and it is testable at the Room boundary.
- The browser on Android is a normal app session. Page-level capture on Android is explicitly **out of scope for v1**: the Android app reports domain-level activity only if a URL becomes available through a supported API, and otherwise reports time in the browser as one app.

### Consequences

**Positive**

- The app has no ability to read screen content, so "we do not capture your messages" is a capability claim, not a policy claim. This is the strongest form the promise can take.
- `PACKAGE_USAGE_STATS` is a recognised, documented permission with an OS-provided consent flow, and revoking it revokes capture entirely and visibly.
- Low battery cost: the OS already collects this data; the app queries it rather than observing events. No accessibility service means no continuous node-tree processing.
- Foreground intervals are exactly the shape `app_session` needs (`startAt`, `endAt`, `durationSeconds`, `isForeground`), so no inference layer is required.
- Play Store review is materially simpler, and the accessibility-permission justification burden (which is substantial and increasingly scrutinised) is avoided.
- A revoked or never-granted permission has an obvious UI state: no data, with a clear "grant usage access" prompt, rather than a service that appears enabled but silently reads nothing.

**Negative**

- **Worse fidelity.** Intervals are coarse, transitions can be missed or coalesced, and screen-off time is not directly observable. `app_session` durations will be approximate, which is honest but means the dashboard must not present them as precise.
- **Delayed delivery.** `UsageEvents` must be polled; a `WorkManager` job queries a window (e.g. since the last cursor) rather than receiving a callback. Late-arriving events are normal, so the client must handle intervals that become complete _after_ they were first observed, and must not emit a session twice.
- **No URLs on Android.** Tomas's "what did I do for client X last week" scenario is weaker on a phone than on a laptop until a domain-level source exists. Mitigated by browser app sessions and by the fact that page-level capture is the extension's job.
- **Repeated intervals are possible**, so the client dedupes on `(packageName, startAt)` before writing to the queue, and the server dedupes again on `(device_id, dedupe_key)`. Two layers, because the client-side window can genuinely overlap.
- **The permission is easy to revoke accidentally** (a system settings entry, not an in-app toggle), and a revoked permission produces silent emptiness. The app must poll for the grant state and surface it.
- Some OEM Android variants restrict or delay usage-stats queries as part of battery management, so behaviour varies by device in ways that are hard to test exhaustively.

### Alternatives considered

- **`AccessibilityService`.** Better data — window titles, package transitions, and sometimes URLs from an address bar. Rejected primarily on the privacy promise (the capability exists, so the guarantee is only as strong as the code) and secondarily on Play policy risk, which for a personal-knowledge app is not worth carrying.
- **`MediaProjection` with OCR.** Would allow page-level capture without a browser extension. Rejected definitively: it is a screen recorder, which is an explicit non-goal, and the battery and consent cost is enormous.
- **VPN-based local traffic observation** (`VpnService`) to derive domains without an accessibility service. Technically the most complete Android story and it would give domain-level activity natively. Rejected for v1 because it requires the app to become a system-wide network intermediary, which is a far larger privacy surface than an app-usage reader and a much harder consent conversation. Noted as a possible future source in [ROADMAP.md](./ROADMAP.md).
- **A custom keyboard or share-sheet integration** for explicit capture. Rejected as manual capture, which the product exists to avoid.
- **Nothing on Android; extension only.** Simplest and keeps the privacy story trivially clean. Rejected because `app_session` is the only event type that can answer the activity-shaped queries in the first place, and phone-only days are common.

---

## ADR-013: (Proposed) Recursive chunking in v1, semantic chunking deferred to phase 7

**Status:** Proposed — resolves before phase 2 work begins
**Date:** 2026-09-16
**Supersedes:** nothing. Superseded by: —

### Context

`ChunkingStrategy` admits three values: `recursive`, `semantic`, `fixed`. Two must be implemented for v1 (or one, and the type carries values with no implementation, which needs stating).

- **Fixed-size splitting** is trivial and produces bad chunks: mid-sentence, mid-argument cuts that degrade both the embedding and the citation snippet.
- **Recursive splitting** respects structural boundaries in a priority order (heading → paragraph → sentence → hard cut at the token limit), with `CHUNK_SIZE` (default `800`) and `CHUNK_OVERLAP` (default `120`). It is deterministic, cheap, has no model dependency, and produces chunks that align with the document's own structure.
- **Semantic chunking** embeds sentences and cuts where adjacent-sentence similarity drops below a threshold, producing topically coherent chunks. It is materially better in the cases that matter most (long documents with topic shifts; transcripts with no structure), and materially more expensive: one embedding call per sentence at ingest, plus a threshold that must be tuned, plus nondeterminism that makes an ingestion retry produce different chunks unless `content_hash` is used to freeze them.

The cost difference is not marginal. A 5,000-word document is roughly 300 sentences, so semantic chunking is ~300 embedding calls per document at ingestion versus a handful (or zero — chunk embeddings can be batched) for recursive.

There is also a sequencing argument. Chunking quality can only be evaluated once retrieval exists (phase 4) and once there is a retrieval evaluation set. Choosing the algorithm before the measurement exists means picking on faith.

### Decision

**Proposed:** implement **recursive** splitting only for v1, and defer semantic chunking to phase 7, where it can be evaluated against the retrieval harness from phase 4.

- `chunks.strategy` is written on every row as `'recursive'`, so the population is homogeneous and a future re-chunk is a query (`where strategy = 'recursive'`).
- Chunk boundaries are deterministic given `(text, CHUNK_SIZE, CHUNK_OVERLAP, strategy)`, and `content_hash` is a hash of the chunk's text plus the strategy — so re-chunking only touches rows whose hash changed.
- `'fixed'` is implemented as a test-only strategy used to demonstrate that recursive is better in the evaluation harness. If it is never referenced outside tests, that is a finding, and the value is removed from `ChunkingStrategy`.
- `'semantic'` exists in the type but must not be produced by the pipeline in v1. A row claiming `strategy = 'semantic'` in v1 is a bug.

### Consequences if accepted

**Positive**

- No model dependency in the ingest path, so chunking works when the embedding provider is down and costs nothing per document.
- Deterministic, so ingestion is idempotent and testable with golden files.
- `headingPath` is populated naturally, because recursive splitting already walks headings — which is what makes citation snippets locate their context ("in _Cost tradeoffs → Q3_, …").
- Sequencing keeps the decision empirical: semantic chunking gets adopted only if the phase-4 harness shows the recall gain justifies the per-document cost.
- Re-chunking later is safe because memories cite `sourceChunkIds` and `memory_sources` keeps a frozen `excerpt`, so a re-chunk does not break citation integrity.

**Negative**

- **Transcripts and unstructured documents chunk badly.** A YouTube transcript has no headings and no paragraphs, so recursive splitting degenerates to sentence grouping, and a topic shift mid-transcript becomes a chunk boundary that splits an argument. This is the strongest argument against the proposal and the case the phase-7 evaluation must test explicitly.
- Long single-topic documents get chunks that cut arbitrarily at the token limit within a section, which is where overlap matters most and where overlap is also most likely to produce near-duplicate retrieval hits.
- The overlap (`CHUNK_OVERLAP`) duplicates content across chunks, inflating both the vector index and the number of near-identical candidates that fusion then has to rank apart.
- Deferring means a corpus-wide re-chunk plus re-embed plus re-distill later — the same shape of costly migration as ADR-004, and it lands on the whole corpus at once. Worth noting that the deferred work is not smaller later; it is just _better informed_ later.
- Adopting semantic chunking later creates a mixed population unless the re-chunk is complete, which means `strategy` becomes a filter in retrieval (probably desirable anyway).

### Alternatives considered

- **Implement both now, select per document by heuristics** (semantic for long unstructured documents, recursive otherwise). The obviously correct end state, and arguably not much more work than recursive alone. Rejected for v1 on the grounds that the heuristic needs a measurement to be worth writing, and because two ingest paths double the idempotency surface.
- **Fixed-size only.** Trivial. Rejected: the chunks are bad in a way that hurts both embeddings and citations, and the saving is small against recursive.
- **Semantic chunking only, now.** Best chunk quality, and it removes the later migration entirely. Rejected on ingest cost (an embedding call per sentence), on provider dependency in the critical path, and on the nondeterminism that complicates idempotent ingestion.
- **Late chunking** (embed the whole document, then pool token embeddings per chunk, preserving document context in each chunk embedding). Genuinely interesting and it improves recall for pronoun-heavy documents. Rejected for v1 because it requires a long-context embedding model and a pooling implementation, and there is no measurement to justify it yet. Worth a spike in phase 7; the embedding-provider interface already accommodates a different implementation behind the same method.
- **Model-based chunking** (an LLM proposes boundaries). Highest quality ceiling and the highest cost and latency. Rejected for ingest; possible later as a re-chunk pass over documents that matter.

---

## ADR-014: (Proposed) Local reranker rather than a hosted reranking API

**Status:** Proposed — resolves before phase 7 work begins
**Date:** 2026-09-16
**Supersedes:** nothing. Superseded by: —

### Context

Retrieval fuses to `RETRIEVAL_TOP_K` (default `40`) candidates and reranks down to `RERANK_TOP_K` (default `8`) for context assembly. Reranking is where retrieval quality is actually won or lost, because a cross-encoder reads the query and the passage together and can reject a passage that has high vector similarity for the wrong reason.

`RankedChunk.rerankScore` is a nullable field, which is the honest encoding of an open decision: reranking may be unavailable, and the system must already work without it. The degrade path (RRF ordering, `degraded: true`) exists regardless of which option is chosen.

The options:

| Option                                                                             | Latency                                  | Cost posture                                       | Privacy posture                                 | Ops cost                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| **Local cross-encoder** (e.g. a small ONNX reranker on the retrieval service host) | CPU-bound; scales with `RETRIEVAL_TOP_K` | No per-query fee; paid in compute and RAM          | Nothing leaves the service host                 | A model artifact to ship, version, and warm |
| **Hosted reranking API** (Cohere/Voyage/Jina-style)                                | Network-bound, one round trip per query  | Per-query fee, grows with usage rather than corpus | Query text and passage text go to a third party | Almost none                                 |
| **No reranking**                                                                   | Zero added latency                       | Zero                                               | Nothing extra leaves                            | None — already the degrade path             |

The privacy axis is the interesting one and it is not the usual one. Embeddings and distillation already send content to a provider, so "content leaves the machine" is not new. What _is_ new is that reranking sends **the user's question** — the raw, unredacted, most-intentional artifact in the system. Every other provider call sends content the user merely encountered; reranking sends what the user is actively trying to remember, which is a materially more sensitive signal.

### Decision

**Proposed:** implement a **local cross-encoder reranker** as the default, in `services/retrieval`, behind a `Reranker` interface symmetric with the provider interfaces in ADR-005:

```ts
export interface Reranker {
  readonly id: string;
  readonly version: string;
  rerank(query: string, candidates: RankedChunk[], topK: number): Promise<RankedChunk[]>;
}
```

- The hosted API remains available as a second implementation of the same interface, selected by configuration, so the quality comparison is a config change rather than a rewrite.
- The reranker's `version` is stamped on every `rerankScore` it produces, mirroring `ImportanceScore.version` (ADR-009), so a ranking change is attributable rather than mysterious.
- If the local model fails to load, the retrieval path proceeds with RRF ordering and sets `degraded: true`. It never fails the query.
- Exact-identifier queries (a ticket id, a function name, a quoted string) are routed **around** reranking entirely by the intent router, because a cross-encoder can legitimately disagree with an exact lexical match and be wrong about it. This makes ADR-006's dilution weakness a routing concern rather than an argument against RRF.

### Consequences if accepted

**Positive**

- The user's questions stay inside the service. This is the strongest privacy argument for the option, and it is the reason it is the proposed default rather than the cheaper-to-run hosted option.
- Cost is fixed by infrastructure, not by usage. Retrieval cost does not grow with how often the user asks; it grows with corpus size only through index memory.
- No network hop in the reranking stage, so p95 latency is bounded and does not depend on a third party's availability.
- No per-query provider dependency means the "everything is down but the database" case still reranks, which is a better degrade story than `degraded: true`.
- The interface makes the choice reversible, which is what makes a Proposed ADR acceptable at all.

**Negative**

- **A local cross-encoder is a real operational artifact.** A model file to obtain, version, ship, load, warm, and keep in memory. Cold-start latency on the first query after idle is a genuine problem for a service that is otherwise fast, and it needs an explicit warm-up or a keep-alive.
- **CPU inference competes with the database work on the same host.** Reranking 40 candidates is 40 forward passes, which is not free, and the retrieval service's latency profile becomes noisy under concurrent load.
- **Quality will likely be worse than the best hosted reranker.** A small local cross-encoder is not a frontier reranking model, and the recall difference is measurable — which is exactly what the phase-7 evaluation is for.
- **The model choice is itself a decision with licensing implications.** Redistribution terms for many cross-encoder weights are permissive but not uniformly so, and a model artifact shipped in the repo or a container is a redistribution. This must be checked before adoption, not after.
- If the local model is materially worse, the honest outcome is `degraded: false` but a lower-quality ranking that _looks_ fine — a worse failure mode than an explicit degrade flag, because nothing tells the user. The evaluation harness is the only thing that can catch it.

### Alternatives considered

- **Hosted reranking API as the default.** Better quality, no operational artifact, no warm-up. Rejected _as the default proposed here_ on the privacy axis — sending the user's question to a third party is a disproportionate step for the product's central promise — while remaining the implementation that wins on every other axis, which is why it stays in the interface.
- **No reranking at all; rely on RRF.** Simplest, and the degrade path already exists and is tested. Rejected as the end state because RRF cannot distinguish "two signals weakly agree" from "one signal is overwhelmingly right", which is the precision failure the reranker specifically fixes.
- **LLM-as-reranker** (ask the configured chat model to order the candidates). No new dependency at all, uses the existing `LlmProvider`. Rejected on cost and latency: it is a full generation per query with the candidates in the prompt, and it makes retrieval latency depend on the chat provider being up, which badly muddies the degrade story.
- **Rerank with the same embedding model** (re-encode query + passage jointly as a longer string). Cheap, no new model. Rejected because a bi-encoder scoring a concatenation is not a cross-encoder and does not capture the interaction term; it mostly duplicates the vector score already in the fusion.
- **Train a small reranker on accumulated click/accept feedback.** The best possible answer, and a real long-term option once usage data exists — but it needs a labelled set that does not exist yet, and it raises a question about using one's own interaction data for training which the privacy commitments in [ROADMAP.md](./ROADMAP.md) would need to address explicitly.

---

## ADR-015: A single `activity_events` table with typed JSONB payloads

**Status:** Accepted
**Date:** 2026-09-16

### Context

`ActivityEvent` is a discriminated union of nine variants with substantially different shapes:

- `page_view`: `domain`, `durationMs`, `scrollDepthPct`
- `page_read`: `domain`, `wordCount`, `readingTimeSeconds`, `contentHash`
- `selection` / `copy`: `text`, `selectionLength`, and for `selection` also `contextBefore` / `contextAfter`
- `youtube_watch`: `videoId`, `channelName`, `watchedSeconds`, `durationSeconds`, `watchedPct`, `transcriptAvailable`
- `app_session`: `packageName`, `appLabel`, `startAt`, `endAt`, `durationSeconds`, `isForeground`
- `search`: `query`, `engine`
- `bookmark`: `url`, `folder`
- `download`: `url`, `filename`, `mimeType`, `bytes`

Two conventional answers: one table per event type (nine tables), or one table with a JSONB column for the variant-specific fields and real columns for what is queried.

### Decision

**One `activity_events` table**, with:

- **Promoted columns** for the fields that are shared (`id`, `user_id`, `device_id`, `type`, `occurred_at`, `received_at`, `importance`, `server_importance`, `importance_version`, `dedupe_key`, `url`, `title`) and for the two variant fields that are queried constantly across types (`domain` — present on `page_view` and `page_read`, indexed for the dashboard's per-site views; and `duration_seconds` — a normalised derivation present for `page_view`, `app_session`, and `youtube_watch`, used for time-spent aggregation).
- **`payload jsonb not null default '{}'::jsonb`** for the remaining variant-specific fields, documented as an explicit per-type key map in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md). A payload containing keys that do not belong to its `type` is a validation error at the ingestion boundary, not a schema error.
- **`metadata jsonb not null default '{}'::jsonb`** for free-form, cross-type annotations (`ActivityEventBase.metadata`), kept separate from `payload` so variant shape and open extension data never mix.
- **A `check` constraint on `type`** enumerating the nine values, mirroring `ACTIVITY_EVENT_TYPES` from `@second-brain/shared`.
- **Shape enforcement is zod's job, at the ingestion boundary** — the same schemas that validate the wire format validate the payload, so there is exactly one definition of "a valid `youtube_watch`".

### Consequences

**Positive**

- **One RLS policy set, one index strategy, one retention sweep.** With nine tables, retention (which differs by band, not by type) would be nine deletion queries and nine policies to get right.
- **Cross-type queries are trivial**, which matters because the primary aggregate is inherently cross-type: "time spent on domain X this week" spans `page_view`, `page_read`, and `app_session`-derived browser usage. With nine tables that is a `union all` in every read path.
- `ImportanceSignals` is computed from multiple event types together (`hasSelection` from a `selection` row, `dwellSeconds` from `page_view`), so the scorer wants one row set, not nine.
- Adding a tenth event type is a union member, a zod schema, and a `check` constraint value — not a table, a policy set, and an index.
- The union discriminator (`type`) is a real column, so the shared TypeScript union and the database agree on the discriminator property, which keeps `ActivityEvent` narrowing honest.

**Negative**

- **The database cannot enforce the payload's shape.** Postgres will not stop you inserting `{"videoId": "…"}` into a `selection` row. The only defence is zod at the boundary, which means any write path that bypasses ingestion (a manual `insert`, a future service) can write a row the shared types cannot deserialise. Mitigation: make ingestion the only writer, and add a test asserting every row read back satisfies its type's schema.
- **Payload keys are not indexed by default.** A query on `payload->>'packageName'` without a matching expression index is a sequential scan. `app_session` is the cross-check, so the mitigation is a targeted `gin (payload jsonb_path_ops)` or per-key expression indexes only where a real query exists, added when the query is written rather than speculatively.
- **Payload keys are invisible to the type generator.** `supabase gen types typescript` sees `payload: Json`, so the mapping from JSONB keys to the typed union lives in hand-written code in `packages/database`, which must be kept in step with the zod schemas.
- **Wider rows for narrow events.** A `search` event stores eight or nine mostly-empty columns. At the volumes here (one user, low thousands of events per day) this is irrelevant, but it is the standard argument against the design and should be recorded rather than ignored.
- Two JSONB columns (`payload` and `metadata`) invites confusion about where a new field belongs. The rule is: if it belongs to exactly one event type, it is `payload`; if it can appear on any type, it is `metadata`. Ambiguity is resolved toward `payload`.

### Alternatives considered

- **One table per event type** (nine tables). Enforced shape, typed columns, per-type indexes, and it is the textbook normalised answer. Rejected because the cross-type aggregates that dominate the read path become unions, because retention and RLS policies multiply, and because the shared `ActivityEvent` union already gives type safety at the only place it matters (the ingestion boundary and the scorer).
- **Fully EAV** (one row per field). Maximum schema flexibility, zero readability, and unusable performance. Rejected outright.
- **A wide table with every variant field as a nullable column.** Typed end-to-end and enforceable with check constraints. Genuinely tempting. Rejected because it makes the nineteen-ish variant columns mostly null, and every new event type widens the table for all rows — but this is the closest alternative and the one to revisit if the JSONB key-mapping maintenance becomes a real cost.
- **Separate tables per _family_** (`browser_events`, `media_events`, `system_events`). A middle ground with fewer tables and partially shared shape. Rejected because the families are not stable — `download` straddles browser and system — and because it splits the table on a distinction no query needs.
- **Store only raw payloads and no promoted columns at all.** Pushes every filter into expression indexes. Rejected because `occurred_at`, `importance`, `dedupe_key`, `device_id`, and `user_id` are on every read path and every index in the schema, and `dedupe_key` is half of the idempotency constraint (ADR-018).

---

## ADR-016: HNSW rather than IVFFlat for vector indexes

**Status:** Accepted
**Date:** 2026-09-16

### Context

`pgvector` offers two index types, with materially different operational properties:

|                    | IVFFlat                                                                                                     | HNSW                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Build requirement  | Needs **existing data** to train the list centroids; an index built on an empty table is useless            | Builds on an empty table and stays useful as rows are added              |
| Recall/latency     | Good, sensitive to `lists` and `probes`; recall degrades if the corpus grows past the training distribution | Better recall at comparable latency, and more stable as the corpus grows |
| Insert behaviour   | New vectors must be assigned to a list; recall degrades as data drifts from the centroids until a rebuild   | Incremental, no retraining concept                                       |
| Build cost         | Fast                                                                                                        | Slow                                                                     |
| Index size         | Smaller                                                                                                     | Larger                                                                   |
| Parameters to tune | `lists` (roughly `rows/1000`), `probes` at query time                                                       | `m` and `ef_construction` at build, `hnsw.ef_search` at query            |

Two facts about this system drive the choice:

1. **The table is empty today and the corpus grows monotonically and unpredictably.** A user's corpus goes from zero to thousands of chunks in the first week and then grows slowly for years. IVFFlat's `lists` parameter should be set from a row count that does not exist yet, and would be wrong as soon as the corpus grew.
2. **Ingestion is continuous and incremental.** Chunks and memories are inserted whenever a document is processed, not in batches at a rebuild window. A design that needs periodic index rebuilds to maintain recall has a maintenance job that the system does not otherwise need.

### Decision

Use **HNSW** for every vector column: `document_chunks.embedding`, `memories.embedding` (partial, `where status = 'active'`), and any future chunk-level index. Operator class is `vector_cosine_ops` throughout, because embeddings from the candidate models are L2-normalised and cosine distance is the correct metric; `<=>` is the distance operator, and ordering is ascending.

```sql
create index document_chunks_embedding_hnsw_idx
  on second_brain.document_chunks using hnsw (embedding vector_cosine_ops);
```

- Build parameters are left at `pgvector` defaults initially (`m = 16`, `ef_construction = 64`) and `hnsw.ef_search` is left at its default (40), with a note that these are the tuning knobs if recall or latency disappoints — not something to guess at now.
- Because building HNSW is slow, index creation on a populated table is its own migration, and the backfill-then-index order in ADR-004 is deliberate: populate the new column, then build its index, then drop the old.
- `topics.centroid` gets **no** vector index. It is read in full (there are tens of topics, not thousands) and nearest-centroid assignment is a sequential scan over a tiny table.

### Consequences

**Positive**

- The index can be created in the initial migration on empty tables, which makes the migration history linear and reproducible from scratch — a real property, because IVFFlat would force "create table, load data, then build index" into the bootstrap sequence.
- Recall does not degrade as the corpus grows past whatever the lists were trained on, so retrieval quality is stable without a rebuild job.
- Continuous ingestion needs no index maintenance step, so there is no "rebuild the vector index" task in the operational runbook at all.
- Better recall at this scale is the more valuable axis: a personal corpus is small enough that latency is not the constraint, and a missed memory is a failed query.
- Uniform structure across all vector surfaces makes the retrieval SQL easy to read and reason about.

**Negative**

- **Slower and larger than IVFFlat.** Build time and index size both increase, and for a corpus of a few tens of thousands of vectors the size difference is measured in megabytes — acceptable, but real in the Supabase free tiers.
- **Higher memory for the working set.** HNSW keeps a graph in memory, so `maintenance_work_mem` matters at build time and the query working set is larger than IVFFlat's.
- **Build time grows with table size**, so the phase-4+ rebuild in a future re-embed migration gets progressively slower. The migration plan in ADR-004 accounts for this by building the new index before dropping the old, but the wall-clock cost is real.
- HNSW insert cost is higher than IVFFlat's per-row; with continuous single-document ingestion this is a steady overhead rather than a one-time cost.
- The two build parameters plus one query parameter are three knobs nobody has tuned, documented as defaults rather than as validated values. If recall is poor, the honest first hypothesis is the embedding model, and the second is `ef_search` — which should be stated so the wrong knob is not turned first.

### Alternatives considered

- **IVFFlat with `lists` estimated from a projected row count.** Would be faster to build and smaller. Rejected on the empty-table and drift problems described above: the index would need rebuilding as the corpus grows, and recall would be silently worse in between.
- **No vector index; exact nearest-neighbour scan.** At small corpus sizes this is actually _correct_ and gives perfect recall — a sequential scan over 20,000 vectors is not slow. Rejected as the default because it makes retrieval latency grow linearly and turns a future corpus-size surprise into a performance incident, but worth naming as the honest first implementation if HNSW build time becomes a development bottleneck. The retrieval query is identical either way, so this is reversible by dropping the index.
- **Mixed: IVFFlat now, HNSW later once the corpus justifies it.** Rejected because "later" needs a migration and a rebuild, and the reason to prefer HNSW (empty-table creation, no rebuild) applies from day one.
- **An external vector store** (Qdrant, Weaviate, pgvector-less). Rejected in ADR-002's reasoning: it splits hybrid retrieval across two systems and forfeits the single-transaction property that makes RRF practical.
- **Both index types on the same column for comparison.** Wasteful and confusing; the comparison belongs in the evaluation harness on a copy, not in production.

---

## ADR-017: Keyset pagination rather than offset pagination

**Status:** Accepted
**Date:** 2026-09-16

### Context

Every list-shaped read path is paginated: the activity dashboard (`activity_events` ordered by `occurred_at desc`), the document list, the memory list and review queue, topic listing, and the ingestion sync cursor. Two mechanisms are conventional:

- **Offset** (`limit`/`offset`, or a page number): `… order by occurred_at desc limit 50 offset 500`.
- **Keyset** (cursor): `… where (occurred_at, id) < ($cursor_ts, $cursor_id) order by occurred_at desc, id desc limit 50`.

Offset is easier to write in a UI ("page 7") but it has three problems that matter here, and one that is specific to this product:

1. **Cost grows with depth.** `offset 5000` still scans and discards 5,000 rows, so deep pages are slow exactly when the user is scrolling back through months of activity.
2. **Writes shift the window.** Activity events arrive continuously from capture (and any device can sync at any moment). With offset pagination, an insert at the top of the ordering displaces every row on the current page, so the user sees a duplicate or misses a row. The dashboard is a live-updating list of a stream — this is not a rare race, it is the normal case.
3. **`nulls` and ties.** `occurred_at` is not unique; several events share a timestamp routinely (a `selection` and a `copy` in the same second). Ordering by a non-unique key makes both offset and keyset unstable unless a tiebreaker is included. Offset cannot be made stable by a tiebreaker alone, because the tie set can change between requests.
4. **The sync cursor wants a watermark, not a page number.** `DeviceSyncState.cursor` and `ActivityBatchResult.serverCursor` are values the _server_ issues and the _client_ replays. That is keyset pagination by definition; there is no offset in a resumable sync.

### Decision

**Keyset pagination everywhere.** No endpoint accepts an `offset` or a page number.

- Every paginated endpoint takes an opaque `cursor` (string) and a `limit`, and returns `items` plus `nextCursor: string | null`.
- Every ordering that a cursor traverses is total: the pivot column plus `id` as a tiebreaker. `activity_events` uses `(occurred_at, id)`, `documents` uses `(captured_at, id)`, `memories` uses `(created_at, id)`, `topics` uses `(last_seen_at, id)`. The comparison is a row tuple comparison (`(occurred_at, id) < ($ts, $id)`), which the composite index on `(user_id, occurred_at desc, id desc)` serves directly.
- Cursors are **opaque to clients** — base64url of the encoded pivot values, versioned, and validated on decode. Clients must not construct or parse them, which keeps the pivot free to change without a client release. A cursor that fails validation is `400 invalid_cursor`, never a silently reinterpreted value.
- The cursor is **not a security boundary** in the sense of hiding data: RLS still applies to every query the cursor is used in, so a cursor from another user returns nothing rather than another user's rows. It is opaque for change-freedom, not for authorisation.
- Server-issued data-change cursors (`serverCursor` on a batch result) are a **different token type** from pagination cursors, even though both are opaque strings, because their lifetimes and validation rules differ. They are distinguished by a type prefix inside the encoded payload.
- The dashboard's "total count" is served by a separate lightweight count endpoint rather than by a total on every page, because a count on every page is the same cost problem offset has, in a different place.

### Consequences

**Positive**

- Page cost is constant regardless of depth, because the composite index seeks directly to the pivot.
- **Stable under concurrent writes**, which is the decisive argument: the user scrolling the activity list while a phone syncs does not see duplicates or skips.
- It works unchanged for the sync protocol, so there is one pagination concept in the codebase rather than two (a paged read API and a cursor-based sync).
- The composite indexes it requires (`(user_id, <sort> desc, id desc)`) are the indexes the dashboard wants anyway for its "most recent N" queries.
- No `offset` parameter means no way to accidentally write `offset 100000` and take down the database with a deep scan.

**Negative**

- **No jump to page N.** The UI cannot offer "page 47 of 312" without computing a count and a pivot, and we deliberately do not. The activity dashboard must be built as infinite-scroll or "load more" from the start, which is a UI constraint imposed by the data layer.
- **No total count** on a paged response, so the user cannot see "1,284 documents" without a second request and an expensive count. The tradeoff is accepted for `documents` and `memories` (which are small) and avoided for `activity_events` (which is not) — but the inconsistency is real and must be documented in the UI as much as in the API.
- **Cursors go stale.** A cursor that is days old may reference rows that have been deleted by retention, and the semantics of "continue from here" after the pivot row is gone are defined by the comparison (the pivot _value_ is what matters, not the row), which is subtle and must be tested. Deleting the pivot row does not break the cursor, and that is a property worth an explicit test.
- **Sort changes invalidate cursors.** A user who switches the activity list from date-descending to importance-descending is starting a new traversal; the UI must drop the old cursor. Mixing a cursor from one ordering into another silently returns a wrong slice, which is why the ordering is encoded in the cursor payload and validated.
- More server-side code: encode, decode, validate, version, and per-endpoint ordering definitions. This is boilerplate that offset does not need, and it is the main cost of the decision.

### Alternatives considered

- **Offset pagination.** Trivially simple, supports page numbers, and the SQL is what everyone already knows. Rejected on the duplicate/skip race under concurrent writes and on deep-scan cost — both of which are structural for a live-updating list of continuously arriving events, not hypothetical.
- **Offset pagination with a "load more, sorted by `occurred_at`" where-clause.** This _is_ keyset pagination, just with the cursor expressed as a raw timestamp in a query parameter. Rejected as the literal form because a raw `occurred_at` value leaks the internal query shape, breaks silently on ties, and cannot be versioned.
- **Opaque server-side cursors stored in a table** (a cursor row holding the query state, with a short TTL). Allows arbitrarily complex orderings and lets the server change the plan without client changes. Rejected because it adds a table and a cleanup job for a problem that encoded pivots solve, and because it makes cursors stateful across a database that is otherwise stateless in its read paths.
- **Cursor plus `total` in the same response.** Would give both the count and the stable traversal. Rejected on cost: the count is a full aggregate over the filtered set on every page.
- **No pagination; the client fetches everything and pages locally.** Viable for `topics` (tens of rows) and arguably for `memories` (hundreds). Rejected for `activity_events` (thousands per month) and rejected as a general policy because it makes the client's memory a function of the user's history. Used deliberately for `topics` and for `GET /health`'s dependency list — a documented exception rather than a pattern.

---

## ADR-018: Anon-key-only in clients, with per-device ingest secrets

**Status:** Accepted
**Date:** 2026-09-16

### Context

Clients are the least trustworthy part of the system: a browser extension's bundle is readable, an Android APK is decompilable, and a local development build can be modified by the person running it. Anything embedded in a client is public, which means anything in a client that grants access is a grant to everyone.

Three different things need to be authenticated, and conflating them is the usual mistake:

1. **The user** — whose data this is. Authenticated by a Supabase JWT, which is what makes RLS work.
2. **The device** — which of the user's devices produced this batch. Needed because the client queue is the source of truth (ADR-010) and because `(device_id, dedupe_key)` is the idempotency key.
3. **The user's own reads** — the dashboard and chat, which read rows the user owns.

### Decision

**One rule and one mechanism.**

**The rule:** only the Supabase **anon key** ever ships in a client bundle. The `service_role` key exists only in server-side environments (the three services, and nowhere else), where it is read from the process environment. There is no exception, and it is enforced by review plus a check that no client workspace references the variable.

The anon key is safe to ship because it grants nothing on its own: RLS denies by default, so an anon-key request without a user JWT reads zero rows. This is precisely why RLS is mandatory on every table (ADR-003) — the anon key's safety is _derived_ from RLS, not from the key being secret.

**The mechanism:** three credential types on the wire.

| Credential                   | Presented by                                    | Validated by                                                                   | Grants                                                     |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Supabase **anon key**        | All clients, as `apikey`                        | Supabase API gateway                                                           | Access to the API — nothing more; RLS denies without a JWT |
| Supabase **user JWT**        | All clients, as `Authorization: Bearer <jwt>`   | Supabase Auth; `auth.uid()` in RLS                                             | Rows where `user_id = auth.uid()`                          |
| **Per-device ingest secret** | The extension and Android, as `X-Device-Secret` | The **ingestion service** (not Supabase), against `devices.ingest_secret_hash` | The right to submit activity for that one `device_id`      |

Details that make it hold:

- **Ingest secrets are per device, not global.** `INGEST_SHARED_SECRET` in `.env.example` is the development bootstrap value; per-device secrets are the production posture. A leak of one device's secret is contained to that device and is revoked by setting `devices.revoked_at`.
- **Secrets are stored hashed, never retrievable.** The column is `ingest_secret_hash`; it is **not** part of the `Device` type in `@second-brain/shared`, precisely so it cannot leak through a read model. Rotation is issue-new-then-revoke-old, never read-and-resend.
- **The secret is issued server-side at device registration.** A client cannot mint its own secret, because that would let a compromised client create a device that the user never authorised. Registration is a server-side operation, which raises an open question recorded in [API_REFERENCE.md](./API_REFERENCE.md): which endpoint or edge function owns it, and it must be resolved in phase 1.
- **Clients never write activity directly.** There is no `insert` policy on `activity_events` for `authenticated`, so the only path in is through the ingestion service, which validates with zod and owns persistence. This is also what makes the exclusion invariant (ADR-009's capture-time rule) enforceable in one place.
- **Clients read their own rows directly** through the anon key plus JWT, which is why RLS `select` policies exist alongside no-insert policies. Direct reads keep the dashboard fast without proxying every read through a service.
- **The ingestion service uses the service-role key** to write, and therefore must filter by `user_id` itself — it is outside RLS's protection. The service resolves `user_id` from the validated JWT, **never** from the request body, so a client cannot claim to be another user by putting a `userId` in the payload.
- **A revoked device is rejected at the door.** `devices.revoked_at is not null` fails the ingest authentication before any row is written, and the response is an explicit `403 device_revoked` rather than a silent success — a client that thinks it is syncing must be told it is not.
- **Every response carries a request id** that appears in the service logs, so a client-reported failure is traceable to a server-side trace without asking the user to reproduce it.

### Consequences

**Positive**

- A leaked client bundle is not a data breach. It contains a key that can read nothing on its own.
- Device revocation is a single column write and takes effect immediately, without rotating anything global or redeploying.
- Per-device attribution is authenticated, not asserted, so `activity_events.device_id` can be trusted for the sync cursor and for the dashboard's per-device views.
- One place validates ingest (the ingestion service), so the zod schemas, the exclusion re-check, the importance re-score hook, and the idempotency logic live together instead of being duplicated in the database and the client.
- Client reads bypass the services entirely, which keeps the dashboard's latency bounded by Postgres rather than by an extra hop that would need its own auth.

**Negative**

- **RLS becomes load-bearing for the anon key's safety.** If a table is added without RLS, the anon key reads it. The guard is the phase-1 CI assertion that every table in the `second_brain` schema has RLS enabled and at least one policy — a test, not a type. (Table placement and the grants that make a policy reachable are [ADR-020](#adr-020-isolate-all-application-objects-in-a-dedicated-second_brain-schema-rather-than-public).)
- **Device registration is unspecified.** It is server-side by necessity and it has no endpoint in the surface described by [API_REFERENCE.md](./API_REFERENCE.md). This is a genuine gap with an owner (phase 1) and a concrete question, not a thing to discover later.
- **Revocation has no un-revoke.** A user who revokes a device by accident must re-register it, receiving a new secret. Modelling un-revoke as setting `revoked_at = null` is trivially possible but leaves an audit hole; the decision is deliberately deferred.
- **Ingest secrets need a rotation story that does not exist yet.** Manifest V3 and Android both make client-side secret storage awkward (no secure element in a browser extension), so the honest posture is "a per-device secret in local storage is a bearer token with the device's blast radius", documented rather than overstated.
- **Two auth mechanisms on one endpoint** (JWT for identity, device secret for device) is more moving parts than either alone, and a client that presents a valid JWT with a mismatched `device_id` must be rejected explicitly. That rejection is a test.
- The ingestion service's service-role key means a bug in its `user_id` resolution is a cross-user read. The mitigation is that `user_id` comes only from the verified JWT claim and there is a test that a body-supplied `userId` is ignored.

### Alternatives considered

- **Ship the service-role key and rely on client-side filtering.** Rejected without qualification: the service-role key bypasses RLS by design, so any bundle containing it grants full database access to anyone who opens devtools.
- **A single shared ingest secret for all of a user's devices.** Simpler by one column. Rejected because revocation becomes all-or-nothing, device attribution becomes an unverified claim, and one leaked device compromises every device.
- **Let clients write directly to `activity_events` under RLS** (`insert` policy with `user_id = auth.uid()`). Removes the ingestion service from the path and is genuinely simpler. Rejected because validation would then live in the client, the exclusion invariant would be enforced in three places (two clients plus a policy), and per-event round trips defeat batching.
- **Signed requests** (the client signs the payload with a key derived from the secret, so the payload cannot be tampered with in transit). Adds integrity on top of authentication. Rejected as unnecessary: TLS provides integrity, and the secret already authenticates the device. Reconsider if a client ever proxies through an untrusted intermediary.
- **OAuth device flow, per device, with short-lived tokens.** The most correct answer, and it aligns with how the platform expects this to work. Rejected for v1 as disproportionate machinery — it needs a refresh loop in a service worker and an Android background job, and its main benefit (short-lived credentials) is a mitigation for a threat the per-device secret already bounds. Noted as the natural upgrade path if per-device secrets prove operationally painful.
- **No device identity at all; batch events under the user only.** Simplest schema. Rejected because `(device_id, dedupe_key)` is the idempotency key (ADR-010), the dashboard's per-device filter and `DeviceSyncState` both need it, and "which device read this" is a real user question in the cross-device persona.

---

## ADR-019: Android is a Gradle project outside the pnpm workspace

**Status:** Accepted
**Date:** 2026-09-16

### Context

`apps/android` is Kotlin. It shares no runtime, no package manager, and no build graph with the TypeScript workspaces. It shares exactly two things: the HTTP contracts in [API_REFERENCE.md](./API_REFERENCE.md) and the `ActivityEvent` shapes that the extension also produces.

Two options: include it in the JS workspace's orchestration (via a bridge task, an Nx-style Gradle plugin, or a custom Turborepo task that shells out to `gradlew`), or keep it out and let the HTTP contract be the interface.

### Decision

`apps/android` is a **standalone Gradle project**, excluded from the pnpm workspace (there is no `apps/android` entry in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml), and the note there says so explicitly). It is not a Turborepo task.

The contract between it and the rest of the repo is the **HTTP API plus a written event-shape contract**:

- The nine event types, their required fields, and the batch/result envelope are specified in [API_REFERENCE.md](./API_REFERENCE.md) and in the frozen types in `packages/shared` — mirrored, not imported.
- The importance-scoring rubric is shared as a **fixture set** (input `ImportanceSignals` → expected `ImportanceScore`), not as code. The Kotlin implementation and the TypeScript implementations are both tested against the same fixtures, which is what keeps three implementations of one rubric honest (ADR-009).
- CI-wise, Android is built by its own toolchain. It is not gated by `pnpm lint`/`typecheck`/`test`, because it cannot be.

### Consequences

**Positive**

- No bridge tooling. A Gradle-in-Turborepo integration is a maintenance burden that pays for itself only when the two ecosystems genuinely share artifacts, which these do not.
- The Android build does not require Node, and the JS build does not require a JDK. Contributors can work on either half without installing the other's toolchain. This is a real accessibility win for a project with one part-time maintainer.
- The API contract is enforced where it should be — at the network boundary, by zod on the server. A divergence between the Kotlin event shape and the TypeScript one fails at ingest with a specific validation error, which is a better error than a build failure across a synthetic dependency.
- Kotlin is free to use Room, `WorkManager`, and `UsageStatsManager` idioms (ADR-010, ADR-012) without pretending to be a Node package.

**Negative**

- **There is no mechanical check that the Android event shapes match `ActivityEvent`.** The contract is enforced only at runtime by the server's zod schemas, so a drift is discovered by a rejected batch in production rather than by a red build. This is the single largest cost of the decision, and the mitigation is that the fixture set and the API document are the shared artifacts, reviewed like code.
- **"Build everything" is not one command.** `pnpm build` builds two thirds of the system. This must be stated in the root README rather than discovered.
- **Shared constants can drift.** `ACTIVITY_EVENT_TYPES`, `IMPORTANCE_BAND_THRESHOLDS`, and `DEFAULT_CATEGORY_SLUG` exist in TypeScript and must be duplicated in Kotlin (or generated). Generation is the obvious better answer and is not implemented — an open question for phase 6.
- Version skew is possible: an old APK against a new API. Since `ActivityBatch` carries `schemaVersion` and the API is `/v1`-prefixed, skew is detectable and rejectable, but the client must handle an explicit upgrade signal, which is extra work in phase 6.

### Alternatives considered

- **Include the Gradle build as a Turborepo task** via a shell-out. Gives one `pnpm build` and one task graph. Rejected because the dependency edges would be fictional (no artifact is shared), and because it makes a Node-only contributor's build fail on a missing JDK.
- **Generate the Kotlin types and constants from the TypeScript ones** (a `shared` → `kotlin` codegen step). This is the correct answer to the drift problem, and it is a phase-6 task rather than a v1 one. Doing it now would mean committing generated code with no consumer to validate it.
- **Flip the direction: make Kotlin the source of truth and generate TypeScript.** No: the server is TypeScript, and the schema should be authored where it is enforced.
- **A separate repository for Android.** Would make the contract a published artifact and formalise the boundary. Rejected because the fixture set and the API document need to evolve together with the schema, and splitting the repo makes a coordinated change a two-repo dance.
- **A cross-platform client (React Native / Kotlin Multiplatform) to share the queue and scoring code.** Would eliminate the triplicate rubric and the two queue implementations. Rejected because the capture capabilities needed — extension content scripts and Android usage stats — are inherently platform-specific, and the shared logic (scoring, dedupe, queue) is a small fraction of the client code. Noted as worth revisiting if the drift cost materialises.

---

## ADR-020: Isolate all application objects in a dedicated `second_brain` schema rather than `public`

**Status:** Accepted
**Date:** 2026-09-16

### Context

The scaffold assumed every application object would live in `public`, the schema Supabase creates and exposes by default. That default is convenient, and it is also why it is worth questioning: `public` is the platform's namespace. It holds Supabase's own functions and helpers, PostgREST exposes it to every client, and the privileges on it come from the platform's defaults rather than from a migration of ours.

Three problems surfaced as soon as the first migration was drafted:

1. **Ownership is implicit.** A product table in `public` is indistinguishable from a platform object, so "our schema" is not a thing that can be named in a `drop`, a `revoke`, or an audit query.
2. **The exposed surface is implicit.** PostgREST serves every schema listed in `[api].schemas`, so with everything in `public` the answer to "what is reachable over HTTP with the anon key" becomes "all of `public`, minus whatever someone remembered to revoke". That is the wrong default for a system whose entire client-side read boundary is RLS (ADR-018).
3. **The privilege story is invisible.** Because `public`'s grants are the platform's, there is no file a reviewer can read to answer "what can `authenticated` reach, and who granted it".

This is orthogonal to the tenancy question. [ADR-003](#adr-003-one-shared-postgres-schema-with-rls-rather-than-schema-per-user) decided that isolation is one shared schema with RLS, and that decision stands unchanged: this ADR is about _which schema name our objects occupy, how it is exposed, and how it is granted_, not about how users are separated.

### Decision

Every application object — the eight tables, their indexes and constraints, the column checks that stand in for enums, any RPC, and the `set_updated_at()` trigger helper — lives in one dedicated schema named **`second_brain`**. `public` holds none of our objects.

Three surfaces move together, and each fails **differently** when it goes stale:

| Surface                         | Where                                     | What breaks when it is stale                                                                    |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DEFAULT_SCHEMA`                | `packages/database/src/client.ts`         | Every constructor binds it as `db: { schema: … }`, so queries resolve against the wrong schema. |
| `[api].schemas`                 | `supabase/config.toml`                    | PostgREST does not serve the schema — every request is `PGRST106`, policies notwithstanding.    |
| The top-level key of `Database` | `packages/database/src/types/database.ts` | The generated types compile while describing a schema no client ever touches.                   |

The schema's privileges are part of the decision rather than an afterthought, because **RLS policies are filters, not grants**: a policy says which rows a role may see _if it can see the table at all_, and Supabase's default privileges cover `public` only. The first migration therefore carries `create schema if not exists second_brain`, `grant usage on schema second_brain to authenticated, service_role`, the table grants, and an `alter default privileges` line so that tables created by later migrations inherit them. `public` stays in `[api].schemas`, and stays the default schema for a request that sends no `Accept-Profile` header, which is what turns a mis-bound client into a loud "relation does not exist" rather than a quiet read of the wrong schema.

### Consequences

**Positive**

- **Ownership is explicit.** `public` stays the platform's namespace and `second_brain` is ours, so a `revoke`, a `drop`, or an audit query can name exactly the set of objects it means.
- **The HTTP-exposed surface is one line.** `[api].schemas` is the complete list of schemas PostgREST serves, so "what can a client reach" is answered by reading `config.toml` instead of by enumerating `public` and subtracting.
- **The privilege story is auditable in one file.** Schema grants, table grants, and the default-privileges rule are written together in the migration that creates the schema.
- **A mis-bound client fails loudly.** `public` holds none of our tables, so a client that forgets to bind the schema gets an error rather than a silent read of a same-named table in the wrong place.
- **The RLS assertions get a stable predicate.** "Every table in schema `second_brain` has `relrowsecurity = true` and at least one policy" is a query against `pg_namespace`/`pg_class`, and it does not have to filter the platform's own objects out of the result.

**Negative**

- **Every migration must qualify the schema on every object reference.** `search_path` for the `postgres` role is `"$user", public`, so an unqualified `create table documents (…)` either fails or — worse — creates the table in `public`, producing a migration history that looks right and a database that is not. This is a per-statement tax on every migration, and the mitigation is the convention in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#migration-conventions) plus review.
- **Two configuration surfaces must stay in sync with one constant**, and the type-surface one is the dangerous failure: a stale top-level key in `database.ts` still compiles, so a query type-checks against a schema the client never sends.
- **`pnpm db:types` must be re-run** whenever the schema changes. The file in `packages/database` is a hand-derived placeholder until the first migration lands, and it stops being trustworthy the moment a real migration exists.
- **The grants are a real burden, and each one fails silently.** Missing `usage` reads like a policy bug; a missing table grant reads like an empty table; and a missing `alter default privileges` line means only tables added _later_ are invisible, so the first migration works and the second one does not. `alter default privileges` also only affects objects created by the role that ran it, which is a detail that has to be right rather than approximately right.
- **`enable row level security` alone is not sufficient for a table owned by `postgres`.** Because migrations and seeds connect as the owner, every table also needs `force row level security`; this is documented as a convention rather than enforced by the schema object placement itself.
- **A rename is a coordinated change, not a search-and-replace.** The three surfaces above plus the type regeneration all have to move together, and there is no single constant the SQL side can read.

### Alternatives considered

- **Stay in `public`.** Simplest by a wide margin: no schema to create, no grants to write, no config to touch, no qualification in migrations, and Supabase's defaults do the work. Rejected because it mixes product objects into a namespace we do not own and leaves both the HTTP-exposed surface and the privilege set implicit — which matters more here than in an ordinary application, because clients hold the anon key and reach Postgres directly (ADR-018), so RLS's correctness is the whole boundary. Worth revisiting only if the qualification and grants tax proves to be a recurring source of incidents.
- **Schema-per-user** (`user_<uuid>.documents`, selected by connection or `search_path`). Already rejected in ADR-003, and this ADR does not reopen it: it multiplies every migration by the number of users, interacts badly with connection poolers, breaks a single generated type surface, and still leaves the service-role path needing application-level correctness. Object placement is not the tenancy question.
- **A schema per module** (`second_brain_documents`, `second_brain_memories`, …). A milder version of the same instinct, and it buys nothing here: the schema is a coarse grouping and this is one cohesive domain with foreign keys running across it (`document_chunks` → `documents`, `memory_sources` → both, `document_topics` → two). Cross-schema foreign keys and joins are legal but awkward — every reference needs qualification, `search_path` reasoning gets harder, and the grant statements and the PostgREST exposure list both multiply. More moving parts, the same single RLS boundary.
- **Keep the objects in `public` but revoke the platform's grants on it.** Would make the exposed surface explicit without a new schema. Rejected because `public` is where Supabase's own helpers live (Auth, Storage and the storage extensions assume it), so revoking platform privileges there is a fight that the platform re-applies on upgrade — which turns every future platform change into a potential privilege regression.
- **Put `second_brain` on the `search_path` for our roles instead of qualifying names.** Would remove most of the qualification burden in migrations, since unqualified names would resolve to our schema. Rejected because it hides the schema behind session state: the same SQL then resolves differently depending on who connected, which is precisely the class of surprise this decision exists to remove, and it would make an unqualified name in a future psql session behave differently from the same name in a migration.

---

## ADR-021: Phase 1 pins 1024-dimension embeddings with a named default model

**Status:** Accepted
**Date:** 2026-09-16

### Context

[ADR-004](#adr-004-pinned-embedding-dimensions-and-a-mandatory-re-embedding-migration) pinned the _dimension_ at 1024 and named the candidate models in prose. That was sufficient while no migration existed, because nothing had to write a model id into the database. The first migration ends that: `user_settings.embedding_model`, `document_chunks.embedding_model`, and `memories.embedding_model` all carry a `DEFAULT`, and a default has to be a concrete, fully-qualified id rather than a family. "1024 dimensions, provider to be decided" is no longer a state the schema can hold.

This ADR does not reopen ADR-004. It names the value ADR-004 left open, states the constraint that chose it, and fixes the shape of the eventual upgrade.

### Decision

**Phase 1 pins 1024 dimensions with `nvidia/nv-embedqa-e5-v5` as the default model**, written as the literal default wherever a model id is stored:

- `document_chunks.embedding_model`, `memories.embedding_model`, `user_settings.embedding_model` — `DEFAULT 'nvidia/nv-embedqa-e5-v5'`
- `.env.example` — `EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5`, paired with `EMBEDDING_DIMENSIONS=1024`
- `packages/providers/src/embedding/nvidia.ts` — the provider's default model

The id is fully qualified because that is the form the NVIDIA API expects; a bare `nv-embedqa-e5-v5` is a documentation shorthand, not a request value.

The width is chosen for the **Nano-tier RAM budget**. Storage and the HNSW index both scale with dimension, and the vector surfaces are the largest single consumer in the schema, so the width is a hosting constraint before it is a quality lever. 1024 is the widest value that keeps those surfaces inside the budget with room for the corpus to grow.

**The 2048-dimension upgrade is a Phase 4 additive column swap, not a rewrite.** Following the shape ADR-004 already specifies: add `embedding_v2`, backfill and dual-read, build the new index before dropping the old one. Deciding the _shape_ now is the point — an in-place `alter column type` would rewrite the table and require downtime, and that option is closed off here rather than rediscovered later.

### Consequences

- **One id, no ambiguity.** The schema, the environment, the provider adapter, and the settings UI all name the same model, which is what makes the dimension assertion in ADR-004 checkable at all.
- **The upgrade path is pre-decided**, so it is a migration that can be planned rather than a design debate at the moment recall turns out to be insufficient. ADR-004's dimension-change cost is unchanged; this only fixes which of its shapes is the intended one.
- **1024 is sticky.** The literal appears in three column defaults, one provider default, one env template, and one UI default. Nothing in the database enforces that the model's width and the column width agree, so a change to one without the others is a silent quality bug rather than an error — the neighbours come back plausible and wrong. This is the single largest cost of the decision, and it is the reason the value is recorded here rather than only in code.
- **A recall ceiling is accepted unmeasured.** 1024 may leave recall on the table relative to a wider model, and that gap cannot be sized until the E1 harness in RESEARCH_NOTES.md exists. Choosing on the RAM budget means choosing before the quality measurement, which is the honest ordering but not the ideal one.
- **The pinned model becomes a dependency on one hosted provider's catalogue.** v1 has no local fallback at the same width, so a deprecation is an ADR-004 re-embed rather than a config change.

### Alternatives considered

- **Leave the model default out and require every write to set it.** Would avoid a literal in the schema, and moves a correctness constraint into every write path plus every seed, fixture, and hand-written row. Rejected: the failure mode is a null model that silently behaves like a mismatched one.
- **Pin 2048 now, for headroom.** Rejected against the Nano-tier RAM budget: it roughly doubles the largest consumer in the schema for a recall gain that has not been measured. If E1 later shows the gate cannot be met at 1024, this ADR is superseded by the Phase 4 swap rather than quietly loosened.
- **Ship 1024 as explicitly temporary.** Rejected because a temporary width is a width you live with. Every row written under it is a row that must be re-embedded, so the only thing a "temporary" marker changes is how surprised the team is.
- **Keep the dimension in a lookup table so it has an owner.** Rejected as premature: one value with a handful of consumers does not need a table, and the table would not remove the literals in the column defaults anyway.

---

## ADR-022: Ingestion runs as the `process-activity` edge function

**Status:** Accepted
**Date:** 2026-09-16

### Context

Three incompatible shapes for the activity ingest path existed at once. [API_REFERENCE.md](./API_REFERENCE.md) specifies `POST /v1/ingest/batch` on `services/ingestion`, whose handlers are still placeholders ([TASKS.md](./TASKS.md) phase 1). The Chrome extension's `VITE_API_BASE_URL` defaults to `http://127.0.0.1:8787`, a local server that does not exist, so a capture loop built against it would fail at its first flush. And `supabase/functions/process-activity` declares itself the intake for `ActivityBatch` payloads in its own header and is named as such in `supabase/config.toml`, while its body was a phase-2 `TODO`.

Three questions had to be answered together, because each constrains the others: **where** ingestion runs, **which database role** writes, and **what the extension calls**.

The role question is settled by the migrations rather than by preference. `activity_events` and `documents` carry `enable row level security` _and_ `force row level security` with deliberately no INSERT policy — clients never write activity directly (ADR-018) — so an anon-key client holding a user JWT cannot insert a row at all, no matter how correct its policies are. Granting `authenticated` an INSERT policy would work, and is precisely the alternative ADR-018 rejected.

### Decision

**Ingestion for activity is the `process-activity` edge function, and the service role is its only writer.**

- **One intake.** The function lives at `supabase/functions/process-activity/` and deploys as `POST {SUPABASE_URL}/functions/v1/process-activity`. No second function is added beside it: `process-activity` already owns this payload in its header and in `config.toml`, and two intakes for one contract is two places to change.
- **The service role writes, with `user_id` from the JWT only.** Writes go through a service-role client that bypasses RLS, and every statement carries an explicit `user_id` filter. A body-supplied user identifier is never read. Reads that feed an access decision — the caller's identity, the device row — go through a second client bound to the caller's token, so RLS decides ownership and a foreign `device_id` is indistinguishable from a nonexistent one.
- **No INSERT policy is added.** Validation stays in the handler, which is the single place that can also re-score, clamp, and count outcomes.
- **The wire contract is the published one.** `ActivityBatch` in, `ActivityBatchResult` out, the `{ error: { code, message, requestId } }` envelope on failure, CORS preflight answered in the handler, and `accepted + rejected + duplicates` asserted against the batch length.
- **Per-device ingest secrets remain the intended device credential (ADR-018), with a transitional rule until registration exists.** A stored `devices.ingest_secret_hash` is authoritative and is verified; a missing hash is a logged allowance; an absent secret against a _stored_ hash is `401 device_mismatch`. Revocation is checked before any of that, because `devices_revoked_consistency_check` forces a revoked device's hash to null and would otherwise fall into the missing-hash allowance.
- **The extension calls it with `supabase.functions.invoke('process-activity', …)`**, which carries the anon key, the session access token, and the extension's own client header. `VITE_API_BASE_URL` stops being an ingestion address and stays reserved for the retrieval and chat API.

### Consequences

**Positive**

- Capture can work end to end with what exists — no local Node server to run, no extra service to deploy, and no new migration.
- Validation, importance handling, and outcome accounting live in one place, so a malformed event is rejected individually instead of failing a batch of 100.
- `user_id` has exactly one source, which is the property that makes a service-role write safe at all (ADR-018).
- Idempotency is inherited from the schema rather than implemented: `(device_id, dedupe_key)` plus `on conflict … do nothing`, so a retried batch is normal operation and a 500 on this endpoint is a retry rather than a recovery.

**Negative**

- **The documented route and the deployed route differ.** API_REFERENCE.md says `/v1/ingest/batch` on a service; the function's path is `/functions/v1/process-activity`. The document stays the contract — the URL in it is now the part that does not match reality, and this ADR records that debt rather than paying it.
- **Availability is now the edge runtime's.** The 4 MB body ceiling in the API document becomes a platform property instead of something this code enforces, and the ingest path shares the functions runtime's limits and cold starts.
- **The service role is back in the ingest path**, so a bug in `user_id` resolution is a cross-user write. The mitigation is review plus the one-source rule; the database does not enforce it.
- **The schema can reject a legitimate event.** `activity_events_promoted_fields_check` requires `duration_seconds` for `youtube_watch`, while the wire type allows `durationSeconds: null` when the duration is unknown — so those events are rejected and then dropped from the client's queue by its own `rejectedIds` rule. Either the constraint or the event type has to change; until one does, the loss is quiet.
- **`importance_band` is derived from the client's advisory score**, because the authoritative re-score is still absent (ADR-009), so the retention sweep filters on a band no server-side value produced.
- **A device with no stored hash is accepted without a secret.** That is the honest state before registration ships, but it means device-secret verification is not yet true of any row in the system, and the check itself is therefore unexercised in production.

### Alternatives considered

- **A new `ingest` edge function at `/functions/v1/ingest`.** The shortest path from the original brief. Rejected because it splits one contract across two functions whose validation would drift, and because `process-activity` already declares itself the intake.
- **Write through the caller's JWT and add INSERT policies to `activity_events`.** Removes the service-role key from the path and lets RLS do the ownership check. Rejected for ADR-018's reason: validation would move into the client, and the exclusion invariant would end up enforced in two clients and a policy.
- **Keep `services/ingestion` as the ingest server.** It is what the API document describes and it would leave the edge functions to background work alone. Rejected for phase 1 because it means running, deploying, and authenticating a second service before the capture loop can be exercised once; the edge function deploys code that already exists.
- **Wait for register-device, and verify device secrets only once it ships.** Simpler and arguably more honest than a four-case rule. Rejected because the check would then be written twice — once as a missing feature and once for real — and the second version would be new, unreviewed code in a path that already works.

## ADR-023: Document upserts via `service_role` RPC (not RLS client)

**Status:** Accepted
**Date:** 2026-09-16

### Context

`process-activity` now writes two kinds of row, and they do not want the same write
statement. Activity events are idempotent by `(device_id, dedupe_key)`, and a replay is
absorbed by `ON CONFLICT … DO NOTHING`. Documents are idempotent by
`(user_id, content_hash)`, but a re-capture is not a no-op: the contract is
`ON CONFLICT (user_id, content_hash) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at,
title = EXCLUDED.title, url = EXCLUDED.url` — a named, three-column update set, with
`captured_at` deliberately excluded because it means "first captured" and is the sort key
of `documents_user_captured_id_idx`.

Two shapes were considered for the document write:

- **(a) A caller-bound client — anon key plus the user's JWT — upserting through
  PostgREST.** This is the shape ADR-022 uses for the reads that feed an access decision.
  It cannot be made to work for documents without a schema change: `documents` carries
  `enable` *and* `force row level security` with deliberately no INSERT policy (ADR-018,
  ADR-022), so an `authenticated` insert is refused with `42501` before any dedup logic
  runs. Making it work means granting `authenticated` an INSERT policy on `documents`,
  which is precisely the alternative ADR-018 rejected.
- **(b) A dedicated RPC.** One entry point, granted to `service_role` alone, whose first
  parameter is `user_id`.

A second and narrower problem belongs to (a), and is recorded because it is the usual
reason this shape gets chosen. PostgREST's only upsert mode is
`Prefer: resolution=merge-duplicates`, which sets *every* column present in the payload;
there is no option that names a subset. Under `merge-duplicates`, telling "created" apart
from "refreshed" therefore relies on reading `xmax` back through the payload — `xmax = 0`
for an insert, non-zero for an update — which is a property of a `SELECT`-list projection
rather than a documented upsert feature.

### Decision

**Document writes go through `second_brain.upsert_document_captures`, granted to
`service_role` only.** It takes `p_user_id`, `p_device_id`, and `p_documents` — a JSON
array read through `jsonb_to_recordset` — and returns the number of documents it touched,
counting both inserts and refreshes.

- `p_user_id` is sourced inside the edge function from the verified caller JWT, and is
  never read from a request body.
- The update set is the contract's three columns, written in SQL, so no PostgREST
  projection can widen it.
- EXECUTE is revoked from `PUBLIC`, `anon`, and `authenticated` in the same migration that
  creates the function, leaving `service_role` as the only caller.
- The function is `security invoker`: the service role already bypasses RLS, and invoker
  rights mean it can never do more than its caller could.

### Rationale

- **Both halves of a batch write as the service role; the asymmetry is the *statement*,
  not the *role*.** ADR-022 already puts the service role behind every write to this
  schema, with `user_id` from the JWT and an explicit filter on each statement. The
  document write changes nothing about that boundary — only how the update set is
  expressed, which PostgREST cannot express at all.
- **The auth boundary is unchanged.** `service_role` bypasses RLS here exactly as it does
  for `activity_events`, and the property that makes that safe is the one ADR-022 names:
  `user_id` has a single source, the verified JWT.
- **Events need no RPC, and are not converted to one.** Their idempotency is satisfiable
  with `ON CONFLICT … DO NOTHING`, which PostgREST exposes as `ignoreDuplicates`, and that
  path works today. Rewriting a working write to make the two halves look alike would be
  symmetry for its own sake.
- **One controlled entry point is a smaller surface than an RLS policy.** Option (a) would
  have widened `authenticated`'s privileges on `documents` permanently, for the benefit of
  one caller. Option (b) grants one execute privilege on one function.

### Consequences

- **Document writes depend on RPC availability.** Any change to the write's shape — a
  column added to the update set, a change to the returned count — is a migration rather
  than a client change, and `upsert_document_captures` and the edge function's
  `UPSERT_DOCUMENTS_RPC` constant have to move together.
- **The service-role grant must be maintained.** A later migration that revokes default
  EXECUTE in this schema, or a `create or replace` that re-creates the function under a
  different owner, can silently remove the ability to write documents — and the symptom is
  a 500 on the document half of every batch, not a permission error a client can act on.
- **The caller must collapse duplicate content hashes itself.** Two rows sharing a
  `content_hash` in one statement raise `21000`, so the edge function deduplicates within
  the batch before calling. This is an obligation the function does not and cannot check.
- **The function will not resurrect a soft-deleted document.** A re-capture matching a row
  with `deleted_at` set refreshes its `last_seen_at`, `title`, and `url`, and leaves
  `deleted_at` alone. That is deliberate — "the user deleted this" is not a background
  sync's decision to reverse — but it does mean such a re-capture silently changes nothing
  the user can see.
- **`last_seen_at` had to be added to `documents`** (`20260916098000`), and it is not in
  `documents_guard_immutable_columns`, so `documents_update_own` currently lets a signed-in
  user write it. Recorded as a Phase 2 gap in [TASKS.md](./TASKS.md) rather than fixed
  here, because nothing yet depends on the value being server-authoritative.
- **A future document write with different auth — per-user secrets, say (ADR-018) — may
  need a different RPC**, since this one takes its authority from a `service_role` grant
  rather than from the caller's own credentials.

### Alternatives considered

- **Grant `authenticated` an INSERT policy on `documents` and upsert through the caller's
  client.** Keeps the service-role key out of this path and lets RLS do the ownership
  check. Rejected for ADR-018's reason: it moves validation into the client, and it leaves
  `authenticated` holding a standing INSERT privilege on a table whose insert path should
  stay in one place.
- **Insert with `ignoreDuplicates: true`, then update the pre-existing rows in a second
  statement.** Expressible with today's tools and no migration: select the batch's existing
  hashes, upsert the new ones, then update the rest with `{ last_seen_at, title, url }`.
  Rejected because it is three round trips per batch instead of one and it is not atomic —
  a concurrent batch can interleave between the select and the update. The interleaving is
  benign (no duplicate rows), but the counting becomes subtle, and these counters are
  asserted against the batch length.
- **A plain `merge-duplicates` upsert with `captured_at` left out of the payload.** One
  round trip, no migration, and `captured_at` survives a re-capture precisely because it is
  absent from the update set. Rejected because it would then have to come from the column's
  `now()` default, making a document's capture time the *sync* time rather than the
  client's — so a queue draining hours late would record the wrong instant, which is the
  failure the event path's clamping exists to avoid.

---

## ADR-024: Switch to the nemotron-3 embed model with a Matryoshka reduction to 1024

**Status:** Accepted
**Date:** 2026-09-17

### Context

[ADR-021](#adr-021-phase-1-pins-1024-dimension-embeddings-with-a-named-default-model) pinned
`nvidia/nv-embedqa-e5-v5` as the 1024-wide default and recorded, as the largest cost of that
decision, that "the pinned model becomes a dependency on one hosted provider's catalogue… a
deprecation is an ADR-004 re-embed rather than a config change." That risk materialised. As of
2026-09-17 the model answers

> `410 Gone` — "The model 'nvidia/nv-embedqa-e5-v5' has reached its end of life on
> 2026-08-25T09:00:00Z and is no longer available."

so no embedding could be produced at all: `document_chunks` stayed empty and every vector leg
(`match_chunks`, `match_memories`, `hybrid_search`, `search_documents_hybrid`) was inert.

The obvious successor is unavailable too. Measured against this account, six catalogue embedding
models — `nvidia/llama-nemotron-embed-1b-v2`, `nvidia/embed-qa-4`,
`nvidia/llama-3.2-nv-embedqa-1b-v1`, `nvidia/nv-embedqa-mistral-7b-v2`,
`snowflake/arctic-embed-l`, `nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1` — answer
`404 "Not found for account"`. Two models do serve this account, and **both are 2048-wide
natively**: `nvidia/nemotron-3-embed-1b` (released 2026-07-16, free endpoint, 34 languages
including Hindi, 32 768-token context) and `nvidia/llama-nemotron-embed-vl-1b-v2`.

That leaves exactly one question: change the schema width, or reduce the vector.

### Decision

**Pin `nvidia/nemotron-3-embed-1b`, keep `vector(1024)`, and reduce every response client-side**
— keep the first 1024 values, then L2-normalize — in both embedding paths:
`packages/providers/src/embedding/nvidia.ts` and the Deno mirror in
`supabase/functions/embed/index.ts`.

The reduction is a client-side step and **not a request parameter**, which is a correction to the
shape this change was first specified in:

```
dimensions: 1024  ->  400 {"message":"dimensions must be one of 2048"}
dimensions: 512   ->  400 {"message":"dimensions must be one of 2048"}
```

The endpoint accepts only its native width, so the request asks for 2048 and the adapter reduces.

**The re-normalization is the load-bearing part, and is why this is an ADR rather than a one-line
model swap.** The native vector is unit-norm (measured 1.000000) and its first-1024 slice is not
(measured 0.691104), because a slice of a unit vector is not itself a unit vector. Skipping the
step would leave stored and query vectors consistently mis-scaled — and *inaudible*: cosine
ordering is invariant under a uniform scale, so nothing would error and nothing would look wrong.
The damage would surface only as slightly worse recall, which is precisely the class of failure
[ADR-004](#adr-004-pinned-embedding-dimensions-and-a-mandatory-re-embedding-migration) exists to
prevent. `reduceToDimensions` therefore slices *and* normalizes, and refuses any width it cannot
reach that way (a narrower vector is never widened).

The reduction is gated on a declared capability set (`MATRYOSHKA_MODELS`) rather than applied to
any response that happens to be wider than the column. Slicing a model that was not trained for
first-k reduction discards information while still producing a numerically valid vector, so a
model that is not listed is refused instead of quietly reduced. NVIDIA shipping a natively
1024-wide model would not belong in the set at all.

### Consequences

- **No migration.** The `vector(1024)` columns, both HNSW indexes, and the signatures of
  `match_chunks`, `match_memories`, `hybrid_search` and `search_documents_hybrid` all stay as
  they are. ADR-004's re-embed cost is not paid.
- **ADR-021's pin is replaced, and its width is now derived rather than native.** 1024 is no
  longer the model's own output width, so ADR-021's "recall ceiling accepted unmeasured" carries
  one more unmeasured term: the reduction itself. This ADR does not size it.
- **`EMBEDDING_DIMENSIONS` no longer equals the model's output width**, which narrows how
  ADR-004's assertion reads. It still holds against the *column*; the provider and the edge
  function are what bridge the two widths, and both now assert the final length instead.
- **Two files must agree on the model id and the capability set.** Deno cannot import the pnpm
  workspace, so this is duplication with a header naming both sides, not a shared constant — the
  same liability the chunker already carries in that file.
- **The single-catalogue dependency is unchanged, and this is the second time it has bitten.**
  A local or second-provider fallback at the same width remains the structural answer; it is out
  of scope here and belongs in `ROADMAP.md` as a trigger.
- **It makes the 2048 upgrade cheaper.** If ADR-021's Phase 4 `embedding_v2` swap is taken, the
  reduction disappears and the model does not change — the migration becomes purely additive.

### Alternatives considered

- **Widen the columns to `vector(2048)`.** The most faithful use of the model, and it costs
  ADR-004's full re-embed: both embedding columns, both HNSW indexes, and every retrieval-RPC
  signature. Rejected *for now* because the corpus is 12 documents with zero vectors stored, so
  the migration would buy an unmeasured quality gain by rewriting the retrieval surface ADR-021
  deliberately held stable. It remains available, and pre-planned, as the Phase 4 swap.
- **Send `dimensions: 1024` and let the API truncate.** Not available — the endpoint answers 400.
  This was the originally specified shape and was measured before implementation.
- **Slice without re-normalizing.** Rejected. It writes vectors whose scale disagrees with the
  cosine semantics `<=>` implements, and the resulting recall loss is undiscoverable from any
  output. This is the most dangerous variant of the change.
- **Slice any wide response, with no capability set.** Fewer moving parts, and it is what this
  model's card implies. Rejected because the same code path would silently reduce the next
  non-Matryoshka model someone configures.
- **Prefer `nvidia/llama-nemotron-embed-vl-1b-v2`.** Both are 2048-wide and both serve this
  account. Rejected on fit: it is oriented at vision-language input this pipeline does not
  produce.

---

## Open decisions not yet in this log

These are known gaps, each with the phase that must resolve it. They are listed here so they are not mistaken for settled.

| Topic                                   | The question                                                                                                                                                                                                  | Resolved by                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Device registration endpoint            | Which endpoint or edge function issues a per-device `ingest_secret_hash`, and what authenticates that call? Currently only the anon-key rule and the necessity of server-side issuance are decided (ADR-018). | Phase 1 — see [API_REFERENCE.md](./API_REFERENCE.md) |
| Reranker choice                         | ADR-014 is Proposed; the local-vs-hosted decision needs the phase-4 retrieval baseline to be judged.                                                                                                          | Phase 7                                              |
| Chunking strategy beyond v1             | ADR-013 is Proposed; semantic chunking needs the retrieval harness to justify its per-document embedding cost.                                                                                                | Phase 7                                              |
| Retention sweep for superseded memories | Deleting closed memory rows would shrink the table, but must preserve the citation integrity that ADR-008 exists to protect. Not yet designed.                                                                | Phase 7                                              |
| Kotlin ↔ TypeScript constant generation | Generation would remove the drift risk ADR-019 accepts. Not implemented.                                                                                                                                      | Phase 6                                              |
| Local-only mode                         | If embeddings and retrieval moved on-device (ADR-009's rejected alternative), the privacy story becomes trivial and the product changes shape. Not a feature; a re-architecture.                              | Recorded in [ROADMAP.md](./ROADMAP.md) as a trigger  |
| Bi-temporal memory modelling            | ADR-008 rejected it for v1 as one axis too many. Revisit if "when did the system first believe X" becomes a real query.                                                                                       | Post-v1                                              |

## Related documents

| Document                                   | Why                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | The components these decisions produce, and the flow that connects them.                                      |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | The schema that ADR-003, ADR-004, ADR-008, ADR-015, ADR-016, and ADR-020 specify.                             |
| [API_REFERENCE.md](./API_REFERENCE.md)     | The surface that ADR-017 and ADR-018 constrain.                                                               |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)   | The provider comparisons that ADR-004, ADR-005, and ADR-014 depend on, with the experiments that settle them. |
| [TASKS.md](./TASKS.md)                     | The phases referenced above, and the exit criteria that make them checkable.                                  |
| [ROADMAP.md](./ROADMAP.md)                 | The milestones and the re-architecture triggers that would reopen a decision here.                            |
