import type { DeviceId } from './device';
import type { DocumentSource } from './document';
import type { MemoryKind } from './memory';

/**
 * Retrieval contracts.
 *
 * These types are shared between the retrieval service, the edge functions, and
 * the web app, because the chat UI renders exactly what the engine returns —
 * `RankedChunk` for the debug view, `Citation` for the user-visible markers.
 */

/**
 * What kind of question is being asked. Drives which sub-retrievers run and in
 * what proportion.
 *
 * - `semantic`  — conceptual, no time component. "what do I know about X".
 * - `temporal`  — explicitly time-bounded. "what was I reading last week".
 * - `activity`  — about behaviour rather than content. "where did my time go".
 * - `entity`    — about a specific named thing. "everything involving Acme".
 * - `mixed`     — weighted blend; the safe default when classification is unsure.
 */
export type QueryIntent = 'semantic' | 'temporal' | 'activity' | 'entity' | 'mixed';

/**
 * A retrieval request.
 *
 * `filters` are applied inside the SQL query, not after retrieval — post-hoc
 * filtering destroys recall instead of narrowing it.
 */
export interface RetrievalQuery {
  userId: string;
  /** Natural-language question, verbatim from the user. Never rewritten before search. */
  text: string;
  /** Pre-computed intent. Omit to let the classifier decide. */
  intent?: QueryIntent;
  /** How many fused candidates to retrieve before reranking. */
  topK: number;
  filters: {
    topicIds?: string[];
    sourceTypes?: DocumentSource[];
    kinds?: MemoryKind[];
    /** ISO-8601 UTC, inclusive. */
    from?: string;
    /** ISO-8601 UTC, inclusive. */
    to?: string;
    deviceIds?: DeviceId[];
  };
}

/**
 * One scored retrieval candidate.
 *
 * The individual sub-scores are retained rather than collapsed, because the
 * difference between "high vector score, no keyword match" and the reverse is
 * the single most useful debugging signal when retrieval looks wrong.
 */
export interface RankedChunk {
  chunkId: string;
  documentId: string;
  text: string;
  /** Final score after fusion and reranking. Comparable only within one result set. */
  score: number;
  /** Cosine similarity in `[0, 1]`, or `null` if this came from full-text search only. */
  vectorScore: number | null;
  /** Normalized `ts_rank` in `[0, 1]`, or `null` if this came from vector search only. */
  ftsScore: number | null;
  /** Reranker output, or `null` when reranking was skipped or unavailable. */
  rerankScore: number | null;
  /** Whether this came from the chunk index or the memory store. */
  source: 'document' | 'memory';
  title: string;
  url: string | null;
  /** ISO-8601 UTC of the underlying document or memory. Used by temporal queries. */
  occurredAt: string | null;
}

/**
 * A user-visible source marker.
 *
 * Invariant: every chunk that reaches the prompt must have a citation index,
 * and indices are assigned in the order the sources appear in the assembled
 * context. An uncited claim in an answer is a bug, not a rounding error.
 */
export interface Citation {
  /** 1-based marker shown inline as `[n]`. */
  index: number;
  documentId: string | null;
  memoryId: string | null;
  title: string;
  url: string | null;
  occurredAt: string | null;
  /** The quoted span the model relied on, for one-click verification. */
  snippet: string;
}

export interface RetrievalResult {
  query: RetrievalQuery;
  /** The intent actually used, which may have been classified rather than supplied. */
  intent: QueryIntent;
  chunks: RankedChunk[];
  citations: Citation[];
  tookMs: number;
  /**
   * True when a stage failed and was skipped — reranking, or vector search with
   * the embedding provider down. The UI surfaces this so a weak answer is
   * never mistaken for a complete one.
   */
  degraded: boolean;
}

/** Answer mode selected in the chat UI. Narrows which sub-retrievers participate. */
export type AnswerMode = 'ask' | 'recall' | 'reflect' | 'activity';

/** A streamed token or delta from the answer model. */
export interface AnswerStreamChunk {
  text: string;
  done: boolean;
}

/**
 * A completed answer with its provenance.
 *
 * `citations` is authoritative: any marker appearing in `text` must exist here,
 * and any citation here must be referenced from `text`. The web app verifies
 * this before rendering.
 */
export interface Answer {
  text: string;
  citations: Citation[];
  mode: AnswerMode;
  /** The retrieval result the answer was grounded in, retained for the debug view. */
  retrieval: RetrievalResult;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}
