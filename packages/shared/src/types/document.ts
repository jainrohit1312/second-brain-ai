import type { DeviceId } from './device';

/**
 * Documents: the captured, extracted, chunkable artifacts.
 *
 * A `Document` is created once per distinct piece of content, keyed by content
 * hash, and is the unit that gets chunked and embedded. The raw `ActivityEvent`
 * stream records *that* something was read; the `Document` records *what* was read.
 */

/**
 * Where the document came from. Drives the extraction path and the weighting
 * of several importance signals.
 */
export type DocumentSource = 'web' | 'youtube' | 'pdf' | 'gdoc' | 'newsletter' | 'manual';

/** Which chunker produced a given chunk. Persisted so a strategy change is auditable. */
export type ChunkingStrategy = 'recursive' | 'semantic' | 'fixed';

export interface Document {
  id: string;
  userId: string;
  source: DocumentSource;
  /** URL as observed, before normalization. `null` for manual entries with no origin. */
  url: string | null;
  /**
   * Normalized URL used for deduplication: lowercased host, tracking parameters
   * stripped, trailing slash removed. Two views of the same article after a
   * share link must resolve to the same canonical URL.
   */
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  siteName: string | null;
  /** ISO-8601 UTC, as reported by the content itself. Often unreliable or absent. */
  publishedAt: string | null;
  /** ISO-8601 UTC. When the user first captured it. Ordering uses this, not `publishedAt`. */
  capturedAt: string;
  wordCount: number;
  readingTimeSeconds: number;
  /** Hash of the normalized extracted text. The deduplication identity of the content. */
  contentHash: string;
  /**
   * Cleaned full text. `null` while extraction is pending or when extraction
   * failed — a document can exist as metadata for a while before it has a body.
   */
  extractedText: string | null;
  /** Machine-generated 1–3 sentence abstract. Feeds classification and the UI. */
  summary: string | null;
  /** BCP-47 tag, e.g. `en`. `null` when detection was inconclusive. */
  language: string | null;
  /** Server-computed, in `[0, 1]`. See `ImportanceScore`. */
  importance: number;
  topicIds: string[];
  /** Device that first captured it. Kept for provenance; never used for access control. */
  deviceId: DeviceId | null;
}

/**
 * A slice of a document, sized for embedding and retrieval.
 *
 * `ordinal` is the position within the document and is what makes retrieval
 * reconstruct a coherent reading order after a similarity search returns
 * chunks out of sequence.
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  userId: string;
  /** 0-based position within the document. Stable across re-chunking only if the strategy and text are unchanged. */
  ordinal: number;
  text: string;
  /** Estimated, not tokenizer-exact. See `estimateTokens`. */
  tokenCount: number;
  /**
   * Breadcrumb of enclosing headings, outermost first. Prepended to `text`
   * before embedding so a chunk like "see the table above" remains meaningful
   * in isolation.
   */
  headingPath: string[];
  strategy: ChunkingStrategy;
  /** Hash of the chunk text. Used to skip re-embedding unchanged chunks. */
  contentHash: string;
  /**
   * `null` until embedded. The vector is only comparable to vectors produced by
   * `embeddingModel` — mixing models in one column silently produces
   * meaningless similarity, which is why the model id is pinned per row.
   */
  embedding: number[] | null;
  embeddingModel: string | null;
}

/** Status of the extraction stage for a document. */
export type ExtractionStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

/** Result of the extraction stage, before a `Document` row is written. */
export interface ExtractionResult {
  status: ExtractionStatus;
  title: string;
  author: string | null;
  siteName: string | null;
  publishedAt: string | null;
  language: string | null;
  wordCount: number;
  readingTimeSeconds: number;
  contentHash: string;
  /** Cleaned text, or `null` when `status` is not `succeeded`. */
  text: string | null;
  /** Populated when `status` is `failed`, e.g. paywall, cookie wall, empty body. */
  failureReason: string | null;
}

/** Input accepted by the document ingestion path. */
export interface DocumentUpsertInput {
  userId: string;
  deviceId: DeviceId | null;
  source: DocumentSource;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  contentHash: string;
  /** Supplied by the client when it already extracted the body (page reads). */
  extractedText: string | null;
}
