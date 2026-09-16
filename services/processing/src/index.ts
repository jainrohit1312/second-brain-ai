/**
 * `@second-brain/processing` — the pipeline that turns captured activity into memories.
 *
 * Stages, in order, each owned by one directory:
 *
 * 1. `extraction` — readable text from HTML, captions from video, cleaning, so that
 *    everything downstream works on prose rather than markup.
 * 2. `chunking` — bounded, heading-aware slices sized for embedding.
 * 3. embedding — delegated to `@second-brain/providers`; the pipeline only decides *what*
 *    gets embedded and records the model that did it.
 * 4. `classification` — topics and a category, on the distilled summary rather than the body.
 * 5. `distillation` — durable statements about the user, then deduplicated, merged or
 *    superseded against what the system already knows.
 *
 * `importance` sits alongside the stages rather than inside them: it is scored at capture
 * time (server-side, by the ingestion edge) and read by the stages that filter on it.
 *
 * This barrel is the package's public surface. Nothing outside the service should reach a
 * deep path.
 */

export type {
  Chunker,
  ChunkingOptions,
  CleanOptions,
  CleanedText,
  DistillationInput,
  ImportanceEngineConfig,
  ImportanceRuleOverride,
  PersistedChunk,
  ProcessingPipelineStage,
  ProcessingResult,
  ProcessingStageStatus,
  ReadableResult,
  TextChunk,
  TranscriptChunkOptions,
  TranscriptFetchOptions,
  TranscriptSegment,
} from './types';

export { ENGINE_VERSION, createImportanceEngine } from './importance/index';
export type { ImportanceEngine } from './importance/index';
export {
  APP_EXCLUDED_RULE_ID,
  DEFAULT_RULES,
  REQUIRED_WEIGHT_SUM,
  mergeRules,
  sumScoringWeights,
} from './importance/rules';
export type { RuleCondition, ScoringRule } from './importance/rules';
export { bandFor, computeScore, normalizeSignal } from './importance/score';
export {
  DWELL_SATURATION_SECONDS,
  LONG_FORM_WORD_COUNT,
  REVISIT_SATURATION_COUNT,
} from './importance/score';
export type { ScoreStamp } from './importance/score';
export { defaultSignalExtractor, extractSignals } from './importance/signals';
export type { SignalExtractor } from './importance/signals';

export { MIN_CONTENT_LENGTH, extractReadable } from './extraction/readability';
export {
  TRANSCRIPT_CHUNK_SECONDS,
  fetchTranscript,
  groupTranscriptIntoChunks,
  isTranscriptAvailable,
  transcriptToPlainText,
} from './extraction/youtube-transcript';
export {
  MAX_CONSECUTIVE_BLANK_LINES,
  MIN_REPEATED_LINE_OCCURRENCES,
  cleanText,
  collapseWhitespace,
  dedupeRepeatedLines,
  normalizeUnicode,
  removeNavAndFooter,
  stripBoilerplate,
} from './extraction/cleaner';

export {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  FixedChunker,
  MIN_CHUNK_SIZE,
  RecursiveChunker,
} from './chunking/recursive';
export { SEMANTIC_SIMILARITY_THRESHOLD, SemanticChunker } from './chunking/semantic';
export { DEFAULT_SEPARATORS, createChunker } from './chunking/index';

export {
  CLASSIFIER_PROMPT_VERSION,
  MAX_TOPICS_PER_DOCUMENT,
  classifyDocument,
  newTopicSuggestionSchema,
  suggestNewTopic,
  topicClassificationSchema,
} from './classification/topic-classifier';
export type { ClassifiableTopic, ClassificationInput } from './classification/topic-classifier';
export { DEFAULT_ROUTING_RULES, routeToCategory } from './classification/category-router';
export type { CategoryRoutingRule, RoutableDocument } from './classification/category-router';

export {
  DISTILLATION_PROMPT_VERSION,
  MAX_MEMORIES_PER_DOCUMENT,
  MAX_STATEMENT_LENGTH,
  distilledMemoriesSchema,
  extractMemories,
} from './distillation/memory-extractor';
export {
  CANDIDATE_K,
  EXACT_MATCH,
  NEAR_DUPLICATE_THRESHOLD,
  findDuplicate,
} from './distillation/dedup';
export type { DedupOptions, DuplicateMatch, MemoryRelation } from './distillation/dedup';
export { MAX_MERGED_STATEMENT_LENGTH, decideMerge, mergeStatements } from './distillation/merger';
