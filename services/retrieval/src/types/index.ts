/**
 * Types local to `@second-brain/retrieval`.
 *
 * The retrieval *contract* — `RetrievalQuery`, `RankedChunk`, `Citation`,
 * `RetrievalResult`, `QueryIntent` — lives in `@second-brain/shared`, because the chat UI
 * renders exactly what the engine returns. `ChatMessage` lives in `@second-brain/providers`,
 * because the message shape has to be the one the provider adapters actually accept. What is
 * declared here is the machinery in between: retriever queries, ranked lists, fusion output,
 * filter clauses, reranker configuration and the assembled context.
 */
import type { ChatMessage, EmbeddingProvider, LlmProvider } from '@second-brain/providers';
import type {
  Answer,
  AnswerStreamChunk,
  Citation,
  QueryIntent,
  RetrievalQuery,
} from '@second-brain/shared';

/** Which sub-retriever produced a ranked list. */
export type RetrieverKind = 'vector' | 'fts' | 'metadata';

/** Where a candidate row came from. Activity rows are events, not documents. */
export type CandidateSource = 'document' | 'memory' | 'activity';

/**
 * A query against the pgvector index.
 *
 * `userId` is part of the query rather than the dependency set because the RPCs are
 * scoped per user and a single process serves many users.
 *
 * **Load-bearing invariant:** `embedding` must have been produced by the model recorded on
 * the rows being searched. Mixing models in one column does not raise an error — it silently
 * returns meaningless nearest neighbours — which is why `embedding_model` is pinned on every
 * row and why a provider change is a re-embed migration (ADR-004).
 */
export interface VectorQuery {
  userId: string;
  /** Query vector. See the invariant above. */
  embedding: number[];
  /** Maximum rows to return per target. */
  topK: number;
  /** Cosine similarity below which a row is dropped before it ever reaches fusion. */
  minSimilarity: number;
  /** Filters, applied inside the SQL query rather than after retrieval. */
  filters: RetrievalQuery['filters'];
  /** Which index to search. `both` runs `match_chunks` and `match_memories` and merges them. */
  target: 'chunks' | 'memories' | 'both';
}

/**
 * A query against the `tsvector` index.
 *
 * `tsQuery` is the string handed to `websearch_to_tsquery`, produced by `buildTsQuery` — it
 * is not the user's raw text, and it is never interpolated into SQL by hand.
 */
export interface FtsQuery {
  userId: string;
  /** Sanitized tsquery text. See `buildTsQuery`. */
  tsQuery: string;
  /** Original user text, kept for logging and for the rank function's phrase detection. */
  rawText: string;
  topK: number;
  filters: RetrievalQuery['filters'];
  /** Which text index to search. `both` searches chunks and memories. */
  target: 'chunks' | 'memories' | 'both';
  /** Include the activity-event text index, which is the only path that answers without a document. */
  includeActivity?: boolean;
}

/**
 * A row as returned by a pgvector or tsvector RPC.
 *
 * Declared here rather than imported from `@second-brain/database` so that this package does
 * not depend on the data layer's internal row types: the query modules project onto this
 * shape. Exactly one of `distance` and `rank` is non-null, depending on which RPC produced
 * the row.
 */
export interface MatchedRow {
  /** Chunk id, memory id, or event id depending on `source`. */
  id: string;
  /** Owning document, or `null` for a memory or an activity row. */
  documentId: string | null;
  memoryId: string | null;
  text: string;
  title: string;
  url: string | null;
  /** ISO-8601 UTC of the underlying document, memory or event. */
  occurredAt: string | null;
  source: CandidateSource;
  /** Cosine distance from the vector RPC, or `null` for a text RPC. */
  distance: number | null;
  /** Raw `ts_rank_cd` from the text RPC, or `null` for a vector RPC. */
  rank: number | null;
  /** Model that produced the stored vector. Must equal the query model. */
  embeddingModel: string | null;
}

/**
 * One candidate after a single sub-retriever has scored it.
 *
 * Carries both sub-scores rather than one collapsed value, because "high vector score, no
 * keyword match" and its reverse are the single most useful debugging signals when retrieval
 * looks wrong, and because fusion needs to know which list a row came from.
 */
export interface ScoredChunk {
  chunkId: string;
  documentId: string | null;
  memoryId: string | null;
  text: string;
  title: string;
  url: string | null;
  occurredAt: string | null;
  source: CandidateSource;
  /** Cosine similarity in `[0, 1]`, or `null` when this came from full-text search only. */
  vectorScore: number | null;
  /** Normalized text rank in `[0, 1]`, or `null` when this came from vector search only. */
  ftsScore: number | null;
  /**
   * The score this sub-retriever produced, in its own scale. Comparable **only** within one
   * sub-retriever: a cosine similarity and a text rank are not on the same axis, which is why
   * fusion uses ranks instead of these values.
   */
  score: number;
}

/**
 * The ordered output of one sub-retriever.
 *
 * Fusion consumes position, not score, so the order of `items` is load-bearing and must not
 * be resorted by a caller between retrieval and fusion.
 */
export interface RankedList<T> {
  /** Which sub-retriever produced this list. Used as the fusion identity of the list. */
  source: RetrieverKind;
  /** Whether the list holds document chunks or memories. */
  kind: 'document' | 'memory' | 'activity';
  /** Items, best first. Order is the contract. */
  items: readonly T[];
}

/** One item's provenance inside a fused result: which lists held it, and where. */
export interface FusedRank {
  /** `source` of the list that contained the item. */
  source: RetrieverKind;
  /** 1-based position in that list. */
  rank: number;
}

/** One fused candidate, with enough provenance to explain its position. */
export interface FusedItem<T> {
  item: T;
  /** Fused score on the RRF scale. Comparable only within one fused result. */
  score: number;
  /** Every list that contained this item, in list order. Never empty. */
  ranks: readonly FusedRank[];
}

/** The output of fusion: candidates ordered by reciprocal rank, each with its provenance. */
export interface FusedResult<T> {
  items: readonly FusedItem<T>[];
  /** Items contributed per list, keyed by `source`. Read by the debug view. */
  listedCounts: Readonly<Partial<Record<RetrieverKind, number>>>;
}

/** One SQL-safe predicate. `value` is always bound, never interpolated into the statement. */
export interface FilterPredicate {
  column: string;
  operator: '=' | 'in' | '>=' | '<=';
  value: string | readonly string[];
}

/** The PostgREST/supabase-js equivalent of a predicate, for the client-side query path. */
export interface PostgrestFilter {
  method: 'eq' | 'in' | 'gte' | 'lte';
  column: string;
  value: string | readonly string[];
}

/**
 * The translated form of `RetrievalQuery['filters']`.
 *
 * Two representations exist because the same filters have to run in two places: inside the
 * SQL RPCs, and through the web app's supabase-js client when it queries directly. Keeping
 * both translations in one function is what stops them diverging.
 */
export interface FilterClause {
  /** Predicates to be applied inside the query, ANDed together. */
  predicates: readonly FilterPredicate[];
  /** The same predicates expressed for PostgREST. */
  postgrest: readonly PostgrestFilter[];
  /**
   * True when a filter is present but selects nothing — an explicitly empty `topicIds`, for
   * instance. The caller must return zero rows rather than skipping the filter, because
   * "filtered to nothing" and "unfiltered" are very different answers.
   */
  matchesNothing: boolean;
}

/** Tuning resolved from the environment at startup, never read per request. */
export interface RetrievalConfig {
  /** Candidates retrieved per sub-retriever before fusion. `RETRIEVAL_TOP_K`, default 40. */
  topK: number;
  /** Candidates kept after reranking. `RERANK_TOP_K`, default 8. */
  rerankTopK: number;
  /** Vector share of the hybrid weighting. `HYBRID_VECTOR_WEIGHT`, default 0.6. */
  vectorWeight: number;
  /** Full-text share of the hybrid weighting. `HYBRID_FTS_WEIGHT`, default 0.4. */
  ftsWeight: number;
  /** Token budget for the assembled context window. */
  contextTokenBudget: number;
}

/**
 * The data-layer port.
 *
 * Declared structurally, with only the calls retrieval actually makes, so that this package
 * is testable against an in-memory double and does not depend on the shape of the query
 * modules in `@second-brain/database`. The implementations must be RLS-scoped per user and
 * must apply `filters` **inside** the query.
 *
 * What it has to be built over, as the data layer stands:
 *
 * - `matchChunks` projects `ChunksQueries.matchChunks(MatchChunksArgs)` from
 *   `createChunksQueries` — the `match_chunks` RPC, nearest first.
 * - `matchMemories` projects `MemoriesQueries.findSimilar(embedding, opts)` from
 *   `createMemoriesQueries` — the `match_memories` RPC.
 * - The three text methods have **no counterpart yet**: `@second-brain/database` exposes no
 *   full-text search, so `searchChunks`, `searchMemories` and `searchActivity` are a
 *   requirement this service places on the data layer rather than a wrapper around something
 *   already there. They are the reason `MatchedRow` exists as a projection target instead of
 *   the RPC row types being used directly.
 */
export interface RetrievalDatabase {
  /** pgvector nearest neighbours over document chunks. Backs the `match_chunks` RPC. */
  matchChunks(query: VectorQuery): Promise<MatchedRow[]>;
  /** pgvector nearest neighbours over memories. Backs the `match_memories` RPC. */
  matchMemories(query: VectorQuery): Promise<MatchedRow[]>;
  /** Full-text search over chunk text. */
  searchChunks(query: FtsQuery): Promise<MatchedRow[]>;
  /** Full-text search over memory statements. */
  searchMemories(query: FtsQuery): Promise<MatchedRow[]>;
  /** Full-text search over activity events, for questions with no document behind them. */
  searchActivity(query: FtsQuery): Promise<MatchedRow[]>;
}

/** Everything the engine needs, constructed once at the composition root. */
export interface RetrievalDeps {
  /** Embedding provider. Its `model` must match the vectors already stored. */
  embeddings: EmbeddingProvider;
  /** Data-layer port. See `RetrievalDatabase`. */
  db: RetrievalDatabase;
  /** LLM for the intent classifier's fallback and for `LlmReranker`. Omitted runs degraded. */
  llm?: LlmProvider;
  /** Tuning resolved from the environment. */
  config: RetrievalConfig;
  /** Clock, for `tookMs` and for resolving relative time cues. Injected so tests are stable. */
  now?: () => Date;
}

/** One sub-retriever a strategy composes, and how much it counts towards the fused ranking. */
export interface StrategyComponent {
  retriever: RetrieverKind;
  /** Weight applied when this component's list is fused. */
  weight: number;
}

/**
 * A retrieval strategy for one query intent.
 *
 * A strategy is a *composition declaration*, not an algorithm: it names the sub-retrievers to
 * run and their relative weights, and the engine does the running. That is what keeps
 * "temporal queries must filter on time" a property of the table below rather than a
 * condition buried in a retriever.
 */
export interface RetrievalStrategy {
  /** Intent this strategy answers. */
  readonly intent: QueryIntent;
  /** Relative weight when several strategies participate in a mixed query. */
  readonly weight: number;
  /** Sub-retrievers composed, with weights. `metadata` is mandatory for temporal and activity. */
  readonly components: readonly StrategyComponent[];
  /**
   * Runs the declared retrievers.
   *
   * @returns One ranked list per component that was actually run, in declaration order.
   */
  retrieve(query: RetrievalQuery, deps: RetrievalDeps): Promise<RankedList<ScoredChunk>[]>;
}

/** Which reranker to build, and how many candidates it may keep. */
export interface RerankerConfig {
  /** `none` keeps the fused order and is the degraded path, not an error. */
  provider: 'cohere' | 'llm' | 'none';
  /** Maximum candidates to keep after reranking. Defaults to `RERANK_TOP_K`. */
  topK: number;
  /** Credential for a hosted reranker. `null` for providers that need none. */
  apiKey?: string | null;
  /** Model name sent to the reranker. */
  model?: string | null;
  /** LLM used by the `llm` provider. Required when `provider` is `'llm'`. */
  llm?: LlmProvider;
}

/** Options for assembling an answer context. */
export interface BuildContextOptions {
  /** Total token budget for system prompt plus retrieved evidence. Defaults to the config value. */
  tokenBudget?: number;
  /**
   * Instructions for the answer model. Owned by the caller, not by this module: the context
   * builder decides *what evidence fits*, not *what the model should do*.
   */
  systemPrompt?: string;
  /** Prior conversation turns to carry, oldest first. */
  history?: readonly ChatMessage[];
}

/**
 * The prompt-ready payload handed to the answer model.
 *
 * Two invariants, both checked by the web app as well as here:
 * 1. `citations` are numbered in the order their sources appear in `messages`, starting at 1.
 * 2. Every retrieved chunk that survived selection has a citation. An uncited claim in the
 *    answer is a bug, not a rounding error.
 */
export interface BuiltContext {
  /** Instructions for the answer model, including the citation contract. */
  systemPrompt: string;
  /** The assembled turns: history, then the evidence block. */
  messages: readonly ChatMessage[];
  /** Citations in context order. `Citation.index` is 1-based and matches the inline markers. */
  citations: readonly Citation[];
  /** Budget the assembly was allowed to fill. */
  tokenBudget: number;
  /** True when candidates were dropped to fit — a partial context must never look complete. */
  truncated: boolean;
}

/**
 * A streamed answer in progress.
 *
 * The deltas are consumed as they arrive; `completed` resolves once the stream ends, with the
 * assembled answer, its citations and its provenance. Splitting the two is what lets the UI
 * render tokens immediately while still having a single place to verify citation integrity
 * before the answer is accepted.
 */
export interface AnswerStream {
  /** Token deltas, terminating with a chunk whose `done` is true. */
  readonly deltas: AsyncIterable<AnswerStreamChunk>;
  /** Resolves when the stream finishes, with the assembled `Answer`. */
  completed(): Promise<Answer>;
}
