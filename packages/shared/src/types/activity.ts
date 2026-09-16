import type { DeviceId } from './device';
import type { DocumentSource } from './document';

/**
 * Raw activity capture.
 *
 * These are the events produced by clients. They are intentionally cheap to
 * produce and cheap to transmit — payloads carry metadata and short excerpts,
 * never full page bodies. Full text arrives later, through the document path.
 */

/**
 * The closed set of captureable event types.
 *
 * Adding a member here is a breaking change for ingestion validation and for
 * the `activity_events` table's type constraint; ship it with a migration.
 */
export type ActivityEventType =
  | 'page_view'
  | 'page_read'
  | 'selection'
  | 'copy'
  | 'youtube_watch'
  | 'app_session'
  | 'search'
  | 'bookmark'
  | 'download';

/**
 * Fields shared by every event.
 *
 * `importance` is the *client's* estimate. It exists so the local queue can
 * drop noise before it costs a network round-trip; the server always re-scores
 * and never trusts this value.
 */
export interface ActivityEventBase {
  /** Client-generated UUID. Stable across retries, which is what makes sync idempotent. */
  id: string;
  deviceId: DeviceId;
  type: ActivityEventType;
  /** ISO-8601 UTC. When the activity happened, per the client clock. */
  occurredAt: string;
  /** ISO-8601 UTC. Set by the server on receipt; never sent by the client. */
  receivedAt?: string;
  /** Client-side importance estimate in `[0, 1]`. Advisory only. */
  importance: number;
  /**
   * Stable deduplication key derived from the event's identity (see
   * `dedupeKey` in `@second-brain/shared`). `(deviceId, dedupeKey)` is unique
   * server-side, so a replayed batch can never double-count.
   */
  dedupeKey: string;
  url: string | null;
  title: string | null;
  /** Free-form, type-specific extras. Never used for filtering or scoring. */
  metadata: Record<string, unknown>;
}

/** A page was opened and dwelled on. Emitted on visibility change or navigation. */
export interface PageViewEvent extends ActivityEventBase {
  type: 'page_view';
  /** Registrable domain, lowercased, without `www.`. */
  domain: string;
  durationMs: number;
  /** 0–100. Max depth reached, not final scroll position. */
  scrollDepthPct: number;
}

/**
 * A page crossed the reading threshold and its readable content was extracted.
 * Only this event type carries an extraction, and only for non-excluded origins.
 */
export interface PageReadEvent extends ActivityEventBase {
  type: 'page_read';
  domain: string;
  wordCount: number;
  readingTimeSeconds: number;
  /** Hash of the normalized extracted text. Drives document deduplication. */
  contentHash: string;
}

/** A passage was highlighted or dwelled on long enough to be a deliberate signal. */
export interface SelectionEvent extends ActivityEventBase {
  type: 'selection';
  text: string;
  /** Up to ~120 characters either side, for disambiguation during distillation. */
  contextBefore: string;
  contextAfter: string;
  selectionLength: number;
}

/** The user copied a passage to the clipboard. A stronger intent signal than selection. */
export interface CopyEvent extends ActivityEventBase {
  type: 'copy';
  text: string;
  selectionLength: number;
}

/** A YouTube video was watched. Progress is sampled, then flushed on navigation. */
export interface YouTubeWatchEvent extends ActivityEventBase {
  type: 'youtube_watch';
  videoId: string;
  channelName: string | null;
  watchedSeconds: number;
  durationSeconds: number | null;
  /** `watchedSeconds / durationSeconds`, in `[0, 1]`. `0` when the duration is unknown. */
  watchedPct: number;
  /** False when captions are disabled or unavailable; the video then yields no text. */
  transcriptAvailable: boolean;
}

/**
 * A foreground app session on Android.
 *
 * Invariant: an excluded package never produces one of these. The event is not
 * emitted with redacted fields — it is not emitted at all.
 */
export interface AppSessionEvent extends ActivityEventBase {
  type: 'app_session';
  packageName: string;
  appLabel: string;
  /** ISO-8601 UTC. Equal to `occurredAt` for this type. */
  startAt: string;
  /** ISO-8601 UTC. */
  endAt: string;
  durationSeconds: number;
  /** Always true today; kept explicit so background sessions can be added later. */
  isForeground: boolean;
}

/** A search was performed. Captured because queries are unusually high-signal intent. */
export interface SearchEvent extends ActivityEventBase {
  type: 'search';
  query: string;
  /** Search engine host, e.g. `google.com`. */
  engine: string;
}

/** A page was bookmarked, through the browser or the extension. */
export interface BookmarkEvent extends ActivityEventBase {
  type: 'bookmark';
  url: string;
  folder: string | null;
}

/** A file was downloaded. */
export interface DownloadEvent extends ActivityEventBase {
  type: 'download';
  url: string;
  filename: string;
  mimeType: string | null;
  bytes: number | null;
}

/**
 * Discriminated on `type`. Narrow with a `switch` on `event.type`; the
 * exhaustiveness is enforced by `assertNever` at the end of the default branch.
 */
export type ActivityEvent =
  | PageViewEvent
  | PageReadEvent
  | SelectionEvent
  | CopyEvent
  | YouTubeWatchEvent
  | AppSessionEvent
  | SearchEvent
  | BookmarkEvent
  | DownloadEvent;

/**
 * A document body a client extracted and uploaded with a batch.
 *
 * Carried alongside `events` on the same {@link ActivityBatch} so one flush moves
 * both halves of a capture: the events say *that* the user read something, the
 * document says *what* they read. The two halves are independent — a batch may
 * carry documents and no events — and they are deliberately not linked yet.
 * Correlating them is a later phase, done by URL and timestamp at query time.
 *
 * Two fields a client might expect are absent on purpose:
 *
 * - There is no `contentHash`. The server computes it, because
 *   `documents.content_hash` is the document's dedup identity under
 *   `documents_user_content_hash_key`; a client-supplied hash would let a client
 *   merge two documents it merely believes are identical.
 * - There is no `metadata`. Nothing persists one, so the client may compute a
 *   byline or an excerpt while building its draft but must not send them.
 */
export interface DocumentUpload {
  /** As observed, before normalization. Required, and non-empty. */
  url: string;
  /** May be an empty string — `documents.title` is `not null default ''`. */
  title: string;
  /**
   * The full readable text, already extracted by the client. Bounded at both ends:
   * under 200 characters is not a document, and 500 000 is the body ceiling the
   * ingestion contract's 4 MB limit is sized against.
   *
   * Stored verbatim as `documents.extracted_text` with `extraction_status` set to
   * `succeeded`, because the client has already run extraction. A client that
   * could not extract a body must not upload a document at all — the failure is
   * recorded as an event, not as a document row with no text.
   */
  content: string;
  /** BCP-47 tag; `null` when the client's detection was inconclusive. */
  language: string | null;
  /**
   * Where the document came from. Browser captures send `'web'`; this is a
   * `DocumentSource`, not a free string, because `documents_source_check` rejects
   * anything outside the enum and the server would otherwise fail the insert.
   */
  source: DocumentSource;
  /** Word count of `content`. At least 1 — see `documents_word_count_check`. */
  wordCount: number;
  /** ISO-8601 UTC. When the client captured it; becomes `documents.captured_at`. */
  occurredAt: string;
}

/**
 * The wire format for a sync request. One batch is one device's queued work, cut
 * into two halves that are capped separately: events by `SYNC_BATCH_SIZE`, and
 * documents by a much smaller per-batch limit, because a single document carries a
 * whole page body where an event carries an excerpt.
 *
 * `schemaVersion` lets the server reject a client it can no longer understand
 * instead of silently mis-parsing it.
 */
export interface ActivityBatch {
  schemaVersion: number;
  deviceId: DeviceId;
  /** ISO-8601 UTC, from the client clock. Used to detect clock skew, not for ordering. */
  clientSentAt: string;
  /**
   * Queued events. May be empty when the batch carries at least one document: a
   * flush whose only pending work is a document body still has to be sendable. A
   * batch that is empty on both halves is rejected by the server.
   */
  events: ActivityEvent[];
  /**
   * Extracted document bodies, at most 5 per batch. Omitted when the batch carries
   * only events, which is the common case.
   */
  documents?: DocumentUpload[];
}

/**
 * Per-batch outcome.
 *
 * Partial acceptance is deliberate: one malformed event must not discard the
 * other 99. `rejectedIds` is what the client uses to drop poison rows from its
 * local queue rather than retrying them forever.
 *
 * The document counters are separate rather than pooled into `accepted`,
 * `rejected`, and `duplicates`. An event and a document are different units,
 * validated differently, deduplicated on different keys, and counted against
 * different caps — so one pair of counters covering both could never satisfy the
 * invariants the server asserts.
 */
export interface ActivityBatchResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  /** Opaque cursor the client stores in `DeviceSyncState.cursor`. */
  serverCursor: string;
  rejectedIds: string[];
  /**
   * Documents stored or refreshed by this batch. Every validated document counts,
   * whether it created a row or matched an existing one through
   * `documents_user_content_hash_key` and refreshed it.
   */
  documentsAccepted: number;
  /** Documents that failed per-document validation. */
  documentsRejected: number;
  /**
   * The urls to remove from the client's document queue. Kept apart from
   * `rejectedIds` because those are event ids, and a document has no id until the
   * server has hashed its content — the url is the only handle the client and the
   * server both have at rejection time.
   */
  rejectedDocumentUrls: string[];
}

/** Why a single event was not accepted. */
export type IngestionStatus = 'accepted' | 'duplicate' | 'rejected';

/** Per-event outcome, used by the ingestion handlers and surfaced in logs. */
export interface IngestionOutcome {
  status: IngestionStatus;
  eventId: string;
  /** Human-readable reason, populated only when `status` is `rejected`. */
  reason: string | null;
  /** Server-computed importance, which may differ from the client's estimate. */
  importance: number | null;
}

/**
 * History the scorer needs but the client does not have.
 *
 * Sourced from the server because `revisitCount` and `topicNovelty` require
 * prior events; this is precisely why the client-side score is advisory.
 */
export interface ActivityHistoryWindow {
  /** Number of prior views of the same canonical URL. */
  revisitCount: number;
  /** Domains already seen by this user, used for the novelty signal. */
  seenDomains: string[];
  /** Distinct topics already assigned to this user's documents. */
  knownTopicSlugs: string[];
  /** Minutes of foreground app time in the trailing 24 hours. */
  foregroundMinutes24h: number;
}
