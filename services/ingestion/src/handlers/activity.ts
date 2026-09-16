/**
 * Activity ingestion: the per-event and per-batch contracts for everything that arrives
 * on `POST /ingest/activity` and `POST /ingest/batch`.
 *
 * The contract every event travels through, in order:
 *
 * 1. **Validate** at the HTTP edge with `activityEventSchema` / `activityBatchSchema`.
 * 2. **Deduplicate** on `ActivityEvent.dedupeKey`, both within the batch and against rows
 *    already stored for the device. A dedupe hit is a *successful* outcome, not an error:
 *    the client is retrying and the server already has the event.
 * 3. **Re-score importance server-side.** The client score is a cheap pre-filter and is
 *    always discarded; `ctx.importance` is the authority and stamps its own version.
 * 4. **Persist**.
 * 5. **Enqueue** downstream processing. Extraction, chunking, classification and
 *    distillation all belong to `services/processing`.
 *
 * Per-event failures must never fail the batch: the client flushes on a timer and cannot
 * replay a partial request cheaply, so `ActivityBatchResult` counts accepted / rejected /
 * duplicates and lists the rejected ids so the client can drop poison rows instead of
 * retrying them forever.
 */
import type {
  ActivityBatch,
  ActivityBatchResult,
  ActivityEvent,
  DeviceId,
  DocumentUpsertInput,
  ImportanceScore,
  IngestionOutcome,
} from '@second-brain/shared';

/** Minimal structured logger the handlers write through; satisfies `console` and pino. */
export interface IngestionLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Injected time source, so handlers are deterministic under test. */
export interface IngestionClock {
  /** Current instant. Used for `receivedAt`, cursors and re-score timestamps. */
  now(): Date;
}

/**
 * Server-side importance scoring port.
 *
 * Implemented by adapting the `ImportanceEngine` from `services/processing` at the
 * composition root. The adapter is also what loads the shared `ActivityHistoryWindow`
 * — which is what the engine's `revisitCount`, `isUniqueDomain` and `topicNovelty`
 * signals require and the client cannot supply. The port exposes only `score`: the
 * ingestion edge has no business knowing about signals or weights.
 *
 * This is the only score the system trusts. The client's `importance` field exists to
 * keep low-value events off the wire, nothing more.
 */
export interface ImportancePort {
  /** Engine version, stamped into every `ImportanceScore.version` so re-scores are auditable. */
  readonly version: string;
  /** Scores one event. Must not mutate the event, and must be deterministic for a fixed history. */
  score(event: ActivityEvent): Promise<ImportanceScore>;
}

/** An event paired with the score the server computed for it. */
export interface ScoredEvent {
  event: ActivityEvent;
  importance: ImportanceScore;
}

/**
 * A document draft ready to persist.
 *
 * Extends the shared `DocumentUpsertInput` with the fields the edge is responsible for
 * deriving — `wordCount` and `readingTimeSeconds` from the accepted text, `capturedAt`
 * from the server clock, and a baseline `importance` before any signal scoring. `id`,
 * `summary` and `topicIds` are assigned by persistence and by `services/processing`.
 */
export type DocumentDraft = DocumentUpsertInput & {
  /** ISO-8601 UTC. Ordering uses this, never the unreliable `publishedAt`. */
  capturedAt: string;
  /** Derived from the accepted text; `0` while the body is still pending extraction. */
  wordCount: number;
  readingTimeSeconds: number;
  /** Baseline importance in `[0, 1]` for a capture, before signal scoring refines it. */
  importance: number;
  author: string | null;
  siteName: string | null;
  publishedAt: string | null;
  language: string | null;
};

/**
 * Activity persistence, backed by `@second-brain/database`. Declared here as a port so
 * the handlers stay free of SQL and remain testable with an in-memory double.
 */
export interface ActivityRepository {
  /**
   * Returns the subset of `dedupeKeys` already present for this device.
   * Must be a single round trip: the batch path calls it once per batch, not per event.
   */
  findExistingDedupeKeys(args: {
    userId: string;
    deviceId: DeviceId;
    dedupeKeys: readonly string[];
  }): Promise<ReadonlySet<string>>;

  /**
   * Inserts accepted events with the server score that belongs to each. Callers only pass
   * events that survived dedupe, so this is an insert, not an upsert; a uniqueness
   * conflict here is a real error (a racing duplicate) and should surface rather than be
   * swallowed, because swallowing it would hide a broken dedupe key.
   */
  insertEvents(args: {
    userId: string;
    deviceId: DeviceId;
    receivedAt: string;
    events: readonly ScoredEvent[];
  }): Promise<void>;

  /** Opaque resume token for the device. Must be stable for a given tip and monotonic. */
  latestCursor(args: { userId: string; deviceId: DeviceId }): Promise<string>;
}

/** Document persistence. Insert-only at this stage; enrichment happens in processing. */
export interface DocumentRepository {
  /** Dedupe entry point for captures: the same body captured twice must not duplicate a row. */
  findIdByContentHash(args: {
    userId: string;
    contentHash: string;
  }): Promise<{ id: string } | null>;

  /** Inserts a capture and returns its generated id. */
  insertDocument(args: { draft: DocumentDraft }): Promise<{ id: string }>;
}

/**
 * The downstream hand-off. The queue decides which pipeline stages run; the edge only
 * says *what* changed, because stage selection is the processing service's business.
 */
export interface ProcessingQueue {
  /** Enqueues events for extraction / chunking / embedding. */
  enqueueEvents(args: { userId: string; eventIds: readonly string[] }): Promise<void>;
  /** Enqueues a document for extraction onwards. */
  enqueueDocument(args: { userId: string; documentId: string }): Promise<void>;
}

/** Everything the ingestion handlers are allowed to touch. */
export interface IngestionRepository {
  readonly activity: ActivityRepository;
  readonly documents: DocumentRepository;
  readonly queue: ProcessingQueue;
}

/**
 * Request-scoped dependencies. Constructed once per authenticated request by the HTTP
 * layer in `src/index.ts`; never shared across users.
 */
export interface IngestionContext {
  /** Owner of every row written through this context. Comes from the bearer token. */
  userId: string;
  /** Device the batch claims to come from; must match the token's device binding. */
  deviceId: DeviceId;
  repository: IngestionRepository;
  logger: IngestionLogger;
  clock: IngestionClock;
  /** Server-side scorer. See `ImportancePort`. */
  importance: ImportancePort;
}

/**
 * Ingests one event through the full validate → dedupe → re-score → persist → enqueue
 * path. Callers holding a batch should use `handleActivityBatch` instead, which amortises
 * the dedupe lookup across events.
 *
 * @param event - An already-parsed event. Malformed payloads are the HTTP layer's job, so
 *   a `rejected` outcome here means dedupe or persistence refused it.
 * @param ctx - Request-scoped dependencies.
 */
export async function handleActivityEvent(
  _event: ActivityEvent,
  _ctx: IngestionContext,
): Promise<IngestionOutcome> {
  // TODO(phase-1): look up `event.dedupeKey` for the device, re-score through
  // `ctx.importance.score`, insert with `receivedAt` from `ctx.clock`, then enqueue.
  throw new Error('Not implemented: handleActivityEvent');
}

/**
 * Ingests a whole sync batch with partial acceptance.
 *
 * Guarantees:
 * - Ordering within the batch does not matter; the result is identical for the same set
 *   of events, and duplicates *inside* the batch are counted once.
 * - One bad event never fails its neighbours. `rejectedIds` is the retry hint.
 * - `serverCursor` advances only for accepted events.
 * - Replaying the same batch (same `deviceId`, same event ids) is idempotent: every
 *   member comes back as `duplicate` and no new row is written, which is what makes
 *   client retries safe.
 *
 * @param batch - A parsed batch produced by `activityBatchSchema`.
 * @param ctx - Request-scoped dependencies.
 */
export async function handleActivityBatch(
  _batch: ActivityBatch,
  _ctx: IngestionContext,
): Promise<ActivityBatchResult> {
  // TODO(phase-1): reject an unsupported `schemaVersion`, load existing dedupe keys once,
  // re-score in parallel, insert accepted events in one statement, enqueue their ids.
  throw new Error('Not implemented: handleActivityBatch');
}
