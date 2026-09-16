/**
 * `@second-brain/shared` — the cross-cutting contract layer.
 *
 * Every workspace depends on this package and nothing depends on them, which is
 * the whole point: an `ActivityEvent` produced by the Chrome extension, written
 * by the Android app, validated by the ingestion service, and rendered by the
 * web app is one type definition, not four that drift.
 *
 * Layering rule: this package has **no runtime dependencies** and no I/O. If a
 * helper needs the network, a database, or a model, it does not belong here.
 */

export * from './constants/categories';
export * from './constants/event-types';
export * from './constants/importance';
export * from './constants/sources';
export * from './constants/topics';

export * from './utils/date';
export * from './utils/hash';
export * from './utils/text';
export * from './utils/validation';

export type {
  Device,
  DeviceId,
  DevicePlatform,
  DeviceRegistrationRequest,
  DeviceRegistrationResponse,
  DeviceSyncState,
} from './types/device';

export type {
  ActivityBatch,
  ActivityBatchResult,
  ActivityEvent,
  ActivityEventBase,
  ActivityEventType,
  ActivityHistoryWindow,
  AppSessionEvent,
  BookmarkEvent,
  CopyEvent,
  DocumentUpload,
  DownloadEvent,
  IngestionOutcome,
  IngestionStatus,
  PageReadEvent,
  PageViewEvent,
  SearchEvent,
  SelectionEvent,
  YouTubeWatchEvent,
} from './types/activity';

export type {
  ChunkingStrategy,
  Document,
  DocumentChunk,
  DocumentSource,
  DocumentUpsertInput,
  ExtractionResult,
  ExtractionStatus,
} from './types/document';

export type {
  Memory,
  MemoryCandidate,
  MemoryDecayConfig,
  MemoryKind,
  MemoryMergeDecision,
  MemorySourceLink,
  MemoryStatus,
} from './types/memory';

export type {
  CategoryAssignment,
  CategorySlug,
  DocumentTopicLink,
  Topic,
  TopicAssignment,
  TopicSlug,
  TopicSuggestion,
} from './types/topic';

export type {
  ImportanceBand,
  ImportanceContribution,
  ImportanceRule,
  ImportanceScore,
  ImportanceSignals,
} from './types/importance';

export type {
  Answer,
  AnswerMode,
  AnswerStreamChunk,
  Citation,
  QueryIntent,
  RankedChunk,
  RetrievalQuery,
  RetrievalResult,
} from './types/retrieval';
