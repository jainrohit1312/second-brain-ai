/**
 * Types local to `@second-brain/processing`.
 *
 * The domain vocabulary — documents, chunks, memories, topics, importance — lives in
 * `@second-brain/shared` and is imported, never re-declared. What lives here is either a
 * pipeline-internal shape (a pre-persistence chunk, a cleaning result) or engine
 * configuration (rule sets, chunker options), which no other workspace has an opinion
 * about.
 */
import type { ChunkingStrategy, TopicAssignment } from '@second-brain/shared';

/**
 * The stages this service owns, in execution order.
 *
 * `extraction` produces the body, `chunking` slices it, `embedding` vectorises the
 * slices, `classification` assigns topics and a category, and `distillation` turns the
 * chunks into memories. A stage is skippable: a PDF whose text the client already
 * supplied arrives at `chunking` directly.
 */
export type ProcessingPipelineStage =
  'extraction' | 'chunking' | 'embedding' | 'classification' | 'distillation';

/** How a stage ended for one document. `skipped` is not a failure. */
export type ProcessingStageStatus = 'succeeded' | 'skipped' | 'failed';

/**
 * Outcome of one stage for one document.
 *
 * Persisted so the pipeline is resumable and so a partially processed document can be
 * explained ("extracted, chunked, never classified because the LLM provider was down").
 */
export interface ProcessingResult {
  stage: ProcessingPipelineStage;
  documentId: string;
  status: ProcessingStageStatus;
  /** ISO-8601 UTC. When the stage finished, not when it started. */
  completedAt: string;
  /** Rows produced by the stage: chunks, embeddings or memory candidates. `0` when skipped. */
  produced: number;
  /** Populated only when `status` is `failed`. */
  failureReason: string | null;
  /** Wall-clock milliseconds, for the pipeline budget. */
  tookMs: number;
}

/**
 * A chunk of text before it is persisted.
 *
 * Deliberately not `DocumentChunk`: that type carries an id, an embedding and an
 * embedding model, none of which exist yet at chunking time.
 */
export interface TextChunk {
  text: string;
  /** 0-based position within the document. Retrieval reconstructs reading order from it. */
  ordinal: number;
  /** Estimated token count, from the shared `estimateTokens`. Never exact. */
  tokenCount: number;
  /**
   * Enclosing headings, outermost first. Prefixed to the text before embedding so a
   * chunk that says "see the table above" still means something on its own.
   */
  headingPath: string[];
}

/**
 * Splits one document body into chunks.
 *
 * Implementations must be deterministic for a fixed input and options: chunk identity
 * (and therefore the skip-unmodified-chunks optimisation) depends on it.
 */
export interface Chunker {
  /** Strategy name persisted on every chunk this chunker produces (`DocumentChunk.strategy`). */
  readonly strategy: ChunkingStrategy;
  /**
   * @param text - Cleaned document body.
   * @param opts - Sizing overrides. Implementations fall back to their own documented defaults.
   * @returns Chunks in reading order, with contiguous `ordinal` values starting at 0.
   */
  chunk(text: string, opts?: ChunkingOptions): TextChunk[];
}

/** Sizing options accepted by every chunker. */
export interface ChunkingOptions {
  /** Target maximum characters per chunk. Defaults to `CHUNK_SIZE` (800, per `.env.example`). */
  chunkSize?: number;
  /** Characters of overlap between consecutive chunks. Defaults to `CHUNK_OVERLAP` (120). */
  overlap?: number;
  /** Separators tried in order, coarsest first. Chunker-specific default. */
  separators?: readonly string[];
}

/** Options for the cleaning stage. Every flag defaults to the conservative choice. */
export interface CleanOptions {
  /** Drop a line that occurs more than this many times. Defaults to `MIN_REPEATED_LINE_OCCURRENCES`. */
  maxRepeatedLineOccurrences?: number;
  /** Remove navigation, cookie-banner and footer blocks. Defaults to `true`. */
  removeNavAndFooter?: boolean;
  /** Collapse whitespace runs while preserving paragraph breaks. Defaults to `true`. */
  collapseWhitespace?: boolean;
}

/**
 * Result of the cleaning stage.
 *
 * `removedRatio` is the point of the type: cleaning quality is invisible in the output
 * text, so a regression has to be measurable. A sudden rise in the ratio across a corpus
 * means the extractor started returning navigation chrome, or the cleaner started eating
 * content — both are visible before anyone reads a bad memory.
 */
export interface CleanedText {
  text: string;
  /** Characters removed as a fraction of the input, in `[0, 1]`. */
  removedRatio: number;
  /** Character count of the input, before cleaning. */
  originalLength: number;
  /** Character count of `text`. */
  cleanedLength: number;
}

/**
 * Result of the readable-content extraction stage.
 *
 * Mirrors what `@mozilla/readability` exposes, with `publishedTime` normalized to ISO-8601
 * because everything crossing a boundary in this codebase is an ISO-8601 UTC string.
 */
export interface ReadableResult {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** ISO-8601 UTC when the page reported a parseable date, `null` otherwise. */
  publishedTime: string | null;
  /** Readable body text with markup removed. Not yet cleaned — see `CleanedText`. */
  textContent: string;
  /** Character length of `textContent`. */
  length: number;
  /** Short lead paragraph, or `null` when the extractor could not identify one. */
  excerpt: string | null;
  /** BCP-47 language tag, or `null` when the document did not declare one. */
  language: string | null;
}

/** One timed caption span from a video transcript. */
export interface TranscriptSegment {
  /** Seconds from the start of the video. */
  startSeconds: number;
  /** Length of the span in seconds; `0` for a synthetic trailing segment. */
  durationSeconds: number;
  /** Caption text. Already de-duplicated of rolling-caption repeats by the source. */
  text: string;
}

/** Options for retrieving a transcript. */
export interface TranscriptFetchOptions {
  /**
   * BCP-47 tags in preference order. The first available track wins; an empty list means
   * "whatever the video declares as default".
   */
  languages?: readonly string[];
}

/** Options for grouping transcript segments into embeddable chunks. */
export interface TranscriptChunkOptions {
  /** Maximum span of one chunk, in seconds. Defaults to `TRANSCRIPT_CHUNK_SECONDS`. */
  maxSeconds?: number;
  /** Maximum characters of one chunk. Defaults to `CHUNK_SIZE`. */
  maxChars?: number;
}

/**
 * A persisted chunk, referenced by id.
 *
 * Distillation runs after persistence (memories must cite the chunks they came from via
 * `MemoryCandidate.sourceChunkIds`), so its input is this rather than `TextChunk`.
 */
export interface PersistedChunk {
  id: string;
  text: string;
  headingPath: string[];
}

/**
 * Everything the distiller is allowed to see about one document.
 *
 * `summary` is absent on purpose. The distiller must work from source text: summarising a
 * summary loses exactly the specifics that make a memory worth keeping.
 */
export interface DistillationInput {
  documentId: string;
  title: string;
  /** The document's chunks, in reading order. Provenance for every memory extracted. */
  chunks: readonly PersistedChunk[];
  /** Topics assigned by classification, used to tag the resulting memories. */
  topics: readonly TopicAssignment[];
  /** ISO-8601 UTC. When the user captured the document; becomes `Memory.validFrom`. */
  occurredAt: string;
}

/**
 * Configuration for the importance engine.
 *
 * The rule set is the surface the web app's settings page writes to, which is why it is
 * overrides over defaults rather than a whole replacement set: shipping a new default rule
 * must not silently disable a user's tuning of the rules they did change.
 */
export interface ImportanceEngineConfig {
  /** Rule overrides keyed by rule id. Unknown ids are ignored. */
  overrides?: readonly ImportanceRuleOverride[];
  /** Version stamped into every `ImportanceScore.version`. Defaults to `ENGINE_VERSION`. */
  version?: string;
  /** Clock used to stamp `scoredAt`. Injected so tests are deterministic. */
  now?: () => string;
}

/** One tunable value of a default rule, as edited in Settings. */
export interface ImportanceRuleOverride {
  id: string;
  /** New contribution weight. Omit to keep the default. */
  weight?: number;
  /** New enabled state. Omit to keep the default. */
  enabled?: boolean;
}
