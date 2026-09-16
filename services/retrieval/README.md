# @second-brain/retrieval

Hybrid recall: vector and full-text search fused by rank, reranked with the ability to drop candidates, and assembled into a cited context window.

## Status

Scaffold only. The folder structure, the interfaces, the weight tables, the keyword lists and the type surface are real; **the engine does not retrieve anything**. Every unimplemented function throws `Not implemented: <symbol>` behind a `TODO(phase-2)` or `TODO(phase-3)` marker.

What _is_ implemented, deliberately, because it is pure and deterministic:

- `buildFilterClause` — the filter translation into SQL predicates and PostgREST calls.
- `similarityToScore`, `tsRankToScore` — the two score conversions, done exactly once each.
- `buildTsQuery` — tsquery sanitization, preserving the web-search operators.
- `detectIntentSignals` — the rule-based feature extraction behind intent classification.
- `estimateBudget` — the prompt token estimate.
- `NoopReranker` — the degraded reranking path, which has to cap the prompt correctly.
- The strategy tables, routing weights, RRF constant and every threshold.

Everything that touches the database, a provider or the prompt does not exist yet.

## Layout

```
services/retrieval/
├── src/
│   ├── hybrid/
│   │   ├── vector-search.ts    pgvector cosine search, similarityToScore
│   │   ├── fts-search.ts       tsvector search, ts_rank_cd, buildTsQuery
│   │   ├── metadata-filter.ts  buildFilterClause, the inside-the-query rule
│   │   └── fusion.ts           reciprocal rank fusion, the weights, why not interpolation
│   ├── intent/
│   │   ├── classifier.ts       rule path + LLM fallback, cue and verb lists
│   │   └── strategies.ts       one composition per QueryIntent
│   ├── reranking/
│   │   └── reranker.ts         RerankProvider, Cohere / Llm / Noop, RERANK_TOP_K
│   ├── context/
│   │   └── builder.ts          buildContext, estimateBudget, citation indexing
│   ├── types/index.ts          retriever queries, ranked lists, fusion, ports, config
│   └── index.ts                RetrievalEngine, createRetrievalEngine, package barrel
├── package.json
├── tsconfig.json
└── README.md
```

## The pipeline

| Stage         | Owned here                  | Key contract                                                                                                |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Intent        | `intent/`                   | Rules first, LLM only when the rules are low-confidence; falls back to `mixed` when there is no LLM at all. |
| Strategy      | `intent/strategies.ts`      | A composition table per intent. `metadata` is mandatory for `temporal` and `activity`.                      |
| Vector search | `hybrid/vector-search.ts`   | Cosine (`<=>`), converted to similarity once. Query embedding must come from the model pinned on the rows.  |
| Text search   | `hybrid/fts-search.ts`      | `websearch_to_tsquery` and `ts_rank_cd`, because retrieval is passage-level.                                |
| Filtering     | `hybrid/metadata-filter.ts` | Filters go **inside** the query. Post-hoc filtering destroys recall rather than narrowing it.               |
| Fusion        | `hybrid/fusion.ts`          | Reciprocal rank fusion over ranks, because cosine and text rank are not on a comparable scale.              |
| Reranking     | `reranking/reranker.ts`     | Sees only the fused candidates and **may drop them**, including all of them.                                |
| Context       | `context/builder.ts`        | Citations numbered in context order; every included chunk has an index.                                     |

## What this service owns

- Query intent classification and the strategy composition per intent.
- Both retrievers, the metadata filter translation, and the fusion of their ranked lists.
- Reranking, including the decision to drop candidates and the degraded path.
- Context assembly: what fits, in what order, and with which citation indices.
- Answer synthesis streaming, with the citation set kept verifiable.

## What this service explicitly does NOT own

| Not here                                                            | Owner                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Capturing or validating activity, storing documents                 | `services/ingestion`                                                                      |
| Extraction, chunking, classification, distillation, embeddings      | `services/processing` — this service consumes chunks and memories, it never produces them |
| Choosing the importance rules or scoring quality                    | `services/processing/src/importance`                                                      |
| Provider selection, credentials, retries, model pinning enforcement | `packages/providers`                                                                      |
| SQL, the `match_chunks` / `match_memories` RPCs, RLS, indexes       | `packages/database`, `supabase/`                                                          |
| Rendering citations, the chat UI, the debug view                    | `apps/web`                                                                                |
| Writing to the corpus                                               | nothing here — this service is read-only by construction                                  |

In short: this service answers questions about what is already stored. It never decides what to store, and a bug here can make an answer worse but cannot corrupt the corpus.

## Scripts

| Script      | Command                                        | Notes                                                     |
| ----------- | ---------------------------------------------- | --------------------------------------------------------- |
| `build`     | `tsup src/index.ts --format esm --dts`         | Emits ESM plus declarations.                              |
| `dev`       | `tsup src/index.ts --format esm --dts --watch` | Watch mode.                                               |
| `lint`      | `eslint src --ext .ts`                         | Repo ESLint config.                                       |
| `typecheck` | `tsc --noEmit`                                 | Uses this package's `tsconfig.json`.                      |
| `test`      | `vitest run --passWithNoTests`                 | The evaluation harness that gates phase 4 will live here. |
| `clean`     | `rimraf dist .turbo`                           | Removes build output and Turborepo cache.                 |

## Configuration

| Variable                                                        | Used for                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `RETRIEVAL_TOP_K`                                               | Candidates retrieved per sub-retriever before fusion (`RetrievalConfig.topK`, 40).                                                   |
| `RERANK_TOP_K`                                                  | Candidates kept after reranking (`RERANK_TOP_K`, 8).                                                                                 |
| `HYBRID_VECTOR_WEIGHT`                                          | Vector share of the fused ranking (`HYBRID_VECTOR_WEIGHT`, 0.6).                                                                     |
| `HYBRID_FTS_WEIGHT`                                             | Text share of the fused ranking (`HYBRID_FTS_WEIGHT`, 0.4).                                                                          |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | The query embedding model. **Must match the vectors already stored** — a mismatch silently returns meaningless neighbours (ADR-004). |
| `LLM_PROVIDER`, `LLM_MODEL`                                     | Intent fallback, `LlmReranker`, and answer synthesis.                                                                                |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                     | The data-layer port behind `RetrievalDatabase`. Server-side only.                                                                    |

`RETRIEVAL_TOP_K` and `RERANK_TOP_K` are separate numbers on purpose: the first is a recall
knob (wider costs latency), the second is a precision knob (narrower costs evidence). Tuning
one to fix a problem caused by the other is the most common way this pipeline gets worse.

## Public exports

From the package root (`@second-brain/retrieval`):

- **Engine** — `createRetrievalEngine`, `RetrievalEngine`.
- **Hybrid retrieval** — `vectorSearch`, `similarityToScore`, `ftsSearch`, `buildTsQuery`, `tsRankToScore`, `TS_RANK_FUNCTION`, `TS_RANK_NORMALIZATION`, `MAX_TSQUERY_LENGTH`, `buildFilterClause`, `applyFilters`, `reciprocalRankFusion`, `normalizeScores`, `RERANK_CONSTANT`, `HYBRID_VECTOR_WEIGHT`, `HYBRID_FTS_WEIGHT`.
- **Intent** — `classifyIntent`, `detectIntentSignals`, `TEMPORAL_CUES`, `ACTIVITY_VERBS`, `QUESTION_WORDS`, `SHORT_QUERY_WORD_LIMIT`, `RULE_CONFIDENCE_THRESHOLD`, and the five strategies (`semanticStrategy`, `temporalStrategy`, `activityStrategy`, `entityStrategy`, `mixedStrategy`).
- **Reranking** — `createReranker`, `CohereReranker`, `LlmReranker`, `NoopReranker`, `rerankScoresSchema`, `RERANK_TOP_K`.
- **Context** — `buildContext`, `selectWithinBudget`, `assignCitationIndexes`, `estimateBudget`, `CONTEXT_TOKEN_BUDGET`, `CITATION_SNIPPET_CHARS`.
- **Types** — `VectorQuery`, `FtsQuery`, `MatchedRow`, `ScoredChunk`, `RankedList`, `FusedResult`, `FusedItem`, `FusedRank`, `FilterClause`, `FilterPredicate`, `PostgrestFilter`, `RetrievalDatabase`, `RetrievalDeps`, `RetrievalConfig`, `RetrievalStrategy`, `StrategyComponent`, `RerankerConfig`, `RerankProvider`, `BuildContextOptions`, `BuiltContext`, `AnswerStream`, `IntentSignals`.

`ChatMessage` is **not** redefined here: it comes from `@second-brain/providers`, because the message shape has to be the one the provider adapters accept. Alongside it, `RetrievalQuery`, `RetrievalResult`, `RankedChunk`, `Citation` and `QueryIntent` come from `@second-brain/shared`, so the web app renders exactly what the engine returns.

## Related docs

- `docs/PROJECT_OVERVIEW.md` — success criteria S1, S2 and S6, which are this service's gates (top-3 recall, citation integrity, degrade-don't-fail).
- `docs/ARCHITECTURE.md` — the end-to-end flow this sits at the end of.
- `docs/DATABASE_SCHEMA.md` — the indexes behind `RetrievalDatabase`, including the `tsvector` column and the pgvector widths.
- `docs/DECISIONS.md` — ADR-004 (embedding model pinning), and the retrieval decisions recorded alongside it.
- `docs/RESEARCH_NOTES.md` — provider candidates and what "a memory" means for retrieval.
- `docs/TASKS.md` — the phase gates for the evaluation harness.
