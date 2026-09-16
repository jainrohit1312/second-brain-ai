import type { DeviceId } from './device';

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
 * The wire format for a sync request. One batch is one device's queued events,
 * capped by `SYNC_BATCH_SIZE`. `schemaVersion` lets the server reject a client
 * it can no longer understand instead of silently mis-parsing it.
 */
export interface ActivityBatch {
  schemaVersion: number;
  deviceId: DeviceId;
  /** ISO-8601 UTC, from the client clock. Used to detect clock skew, not for ordering. */
  clientSentAt: string;
  events: ActivityEvent[];
}

/**
 * Per-batch outcome.
 *
 * Partial acceptance is deliberate: one malformed event must not discard the
 * other 99. `rejectedIds` is what the client uses to drop poison rows from its
 * local queue rather than retrying them forever.
 */
export interface ActivityBatchResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  /** Opaque cursor the client stores in `DeviceSyncState.cursor`. */
  serverCursor: string;
  rejectedIds: string[];
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
