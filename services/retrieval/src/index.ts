/**
 * `@second-brain/retrieval` — the recall engine.
 *
 * One `retrieve` call runs the whole pipeline:
 *
 * ```
 * intent → strategy → (vector ∥ fts ∥ metadata) → fusion → rerank → context
 * ```
 *
 * 1. **Intent** — resolve `RetrievalQuery.intent` if the caller supplied one, otherwise
 *    classify. Intent decides which retrievers run, so it runs first and cheaply.
 * 2. **Strategy** — the composition declared for that intent: which sub-retrievers, with which
 *    weights, and whether the metadata filter is mandatory.
 * 3. **Retrieval** — vector and text search run in parallel, with the user's query embedded
 *    once, using the model pinned on the stored rows.
 * 4. **Fusion** — reciprocal rank fusion, because the two scorers are not on a comparable
 *    scale. See `hybrid/fusion.ts` for why this is not interpolation.
 * 5. **Reranking** — a cross-encoder reads the survivors and the query together. It may drop
 *    candidates, including all of them.
 * 6. **Context** — evidence is trimmed to a token budget and given citation indexes, in the
 *    order the model will read it.
 *
 * `answer` wraps the same pipeline and adds synthesis through an `LlmProvider`, streaming
 * tokens while keeping the citations verifiable.
 *
 * This barrel is the package's public surface. Nothing outside the service should reach a deep
 * path.
 */
import type { AnswerStream, RetrievalDeps } from './types';
import type { LlmProvider } from '@second-brain/providers';
import type { RetrievalQuery, RetrievalResult } from '@second-brain/shared';

/**
 * A configured retrieval engine.
 *
 * Bound to one dependency set (providers, data port, tuning) at construction, so a request
 * cannot accidentally run with a different embedding model than the one the stored vectors came
 * from.
 */
export interface RetrievalEngine {
  /**
   * Runs the full pipeline and returns ranked chunks plus citations.
   *
   * Must set `degraded` whenever a stage was skipped — reranking unavailable, vector search
   * skipped because the embedding provider is down, stale-model rows dropped. A degraded result
   * that looks complete is worse than a failure, because the answer built on it will be
   * confident and thin. See success criterion S6 in `docs/PROJECT_OVERVIEW.md`.
   */
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;

  /**
   * Answers a question from retrieved evidence.
   *
   * The returned stream is consumed for display; `completed()` resolves with the assembled
   * `Answer`, its citations and the `RetrievalResult` it was grounded in. The caller is
   * expected to verify that every marker in the answer text has a citation and that every
   * citation is referenced, before treating the answer as valid.
   *
   * @param query - The question, unmodified.
   * @param llm - Provider used for synthesis. The engine's own `deps.llm` is used for
   *   classification and reranking, which is a different job and a different budget.
   */
  answer(query: RetrievalQuery, llm: LlmProvider): Promise<AnswerStream>;
}

/**
 * Builds the engine.
 *
 * Tuning comes from `deps.config`, which the composition root resolves from the environment:
 * `RETRIEVAL_TOP_K` (candidates per retriever, 40), `RERANK_TOP_K` (survivors, 8),
 * `HYBRID_VECTOR_WEIGHT` (0.6) and `HYBRID_FTS_WEIGHT` (0.4). The constants in `hybrid/` and
 * `reranking/` are the documented defaults they must agree with.
 *
 * `deps.embeddings` is the single most consequential argument: its `model` must be the model
 * recorded on the stored vectors, and the construction step is the last cheap place to assert
 * that (`assertDimensionsMatch` in `@second-brain/providers`).
 *
 * @param deps - Providers, data port and tuning. See `RetrievalDeps`.
 */
export function createRetrievalEngine(_deps: RetrievalDeps): RetrievalEngine {
  // TODO(phase-3): resolve the strategy for the intent, embed the query once with
  // `deps.embeddings` (`inputType: 'query'`), run the declared retrievers with the metadata
  // predicates pushed into their queries, fuse, rerank with `'none'` as the degraded path, map
  // the survivors onto the shared `RankedChunk` (populating `rerankScore`, `occurredAt` and
  // `source`), assemble the context, and set `degraded` / `tookMs` on the result.
  throw new Error('Not implemented: createRetrievalEngine');
}

export type {
  AnswerStream,
  BuildContextOptions,
  BuiltContext,
  CandidateSource,
  FilterClause,
  FilterPredicate,
  FtsQuery,
  FusedItem,
  FusedRank,
  FusedResult,
  MatchedRow,
  PostgrestFilter,
  RankedList,
  RerankerConfig,
  RetrievalConfig,
  RetrievalDatabase,
  RetrievalDeps,
  RetrievalStrategy,
  RetrieverKind,
  ScoredChunk,
  StrategyComponent,
  VectorQuery,
} from './types';

export { similarityToScore, vectorSearch } from './hybrid/vector-search';
export {
  MAX_TSQUERY_LENGTH,
  TS_RANK_FUNCTION,
  TS_RANK_NORMALIZATION,
  buildTsQuery,
  ftsSearch,
  tsRankToScore,
} from './hybrid/fts-search';
export { applyFilters, buildFilterClause } from './hybrid/metadata-filter';
export {
  HYBRID_FTS_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  RERANK_CONSTANT,
  normalizeScores,
  reciprocalRankFusion,
} from './hybrid/fusion';

export {
  ACTIVITY_VERBS,
  QUESTION_WORDS,
  RULE_CONFIDENCE_THRESHOLD,
  SHORT_QUERY_WORD_LIMIT,
  TEMPORAL_CUES,
  classifyIntent,
  detectIntentSignals,
} from './intent/classifier';
export type { IntentSignals } from './intent/classifier';
export {
  activityStrategy,
  entityStrategy,
  mixedStrategy,
  semanticStrategy,
  temporalStrategy,
} from './intent/strategies';

export {
  CohereReranker,
  LlmReranker,
  NoopReranker,
  RERANK_TOP_K,
  createReranker,
  rerankScoresSchema,
} from './reranking/reranker';
export type { RerankProvider } from './reranking/reranker';

export {
  CITATION_SNIPPET_CHARS,
  CONTEXT_TOKEN_BUDGET,
  assignCitationIndexes,
  buildContext,
  estimateBudget,
  selectWithinBudget,
} from './context/builder';
