import type { ActivityBatchResult, ActivityEvent, ImportanceBand } from '@second-brain/shared';
import type { ZodType } from 'zod';

/**
 * Extension-internal message protocol.
 *
 * These types describe how the extension talks to itself — content script ↔ service
 * worker ↔ popup/side panel — and are deliberately distinct from the domain types in
 * `@second-brain/shared`. Nothing here redefines activity or document semantics; it
 * only carries shared values across context boundaries.
 */

/**
 * Distributes `Omit` over a union, so each `ActivityEvent` variant keeps its own
 * discriminant and variant fields.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An event as produced by a content script, before the service worker mints the
 * fields only it can know: `id`, `deviceId`, `dedupeKey`, and `importance`.
 */
export type CapturedEventDraft = DistributiveOmit<
  ActivityEvent,
  'id' | 'deviceId' | 'dedupeKey' | 'importance'
>;

/** Why a flush was requested; recorded on the resulting {@link SyncOutcome}. */
export type FlushReason = 'idle' | 'alarm' | 'manual' | 'batch-full' | 'tab-hidden' | 'sign-out';

/** Which retrieval surface the side panel is currently driving. */
export type ChatMode = 'ask' | 'recall' | 'timeline';

/** Auth state as the extension UI sees it; a projection of the Supabase session. */
export interface AuthStateSnapshot {
  status: 'signed-in' | 'signed-out' | 'expired';
  userId: string | null;
  email: string | null;
  /** ISO timestamp; null when signed out. */
  expiresAt: string | null;
}

/** Snapshot of the local capture queue, as rendered by the popup. */
export interface QueueStatus {
  /** Events waiting in IndexedDB. */
  depth: number;
  /**
   * Document bodies waiting in IndexedDB, in a store of their own. Counted separately from
   * `depth` because they are a different kind of thing — one row here is a whole page body,
   * not an excerpt — and because the server caps them at five per batch rather than a hundred.
   */
  documentsQueued: number;
  /** ISO timestamp of the oldest queued event; null when the queue is empty. */
  oldestQueuedAt: string | null;
  /** ISO timestamp of the newest queued event; null when the queue is empty. */
  newestQueuedAt: string | null;
  /**
   * Events and documents dropped locally since install — below threshold, duplicate, over
   * capacity, or rejected by the server and therefore dropped from the queue to unblock it.
   */
  droppedCount: number;
  /** True while capture is paused by the user, an exclusion rule, or an idle lock. */
  isPaused: boolean;
  /** ISO timestamp of the last successful sync; null before the first one. */
  lastSyncedAt: string | null;
}

/** Result of one flush attempt, including skipped and failed ones. */
export interface SyncOutcome {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  /** The trigger that caused this attempt; null for opportunistic retries. */
  reason: FlushReason | null;
  /** ISO timestamp the drain started, and the one it ended. */
  attemptedAt: string;
  finishedAt: string;
  /** Events handed to the transport, accepted or not. */
  sent: number;
  /** Server response for the batch; null when the request never left the client. */
  result: ActivityBatchResult | null;
  /** Human-readable failure detail; null on success. */
  error: string | null;
}

/** Everything the popup and side panel need to render their chrome. */
export interface ExtensionStatus {
  queue: QueueStatus;
  lastSync: SyncOutcome | null;
  auth: AuthStateSnapshot;
  captureEnabled: boolean;
  /** Null until the device row has been minted on first run. */
  deviceId: string | null;
}

/**
 * The cheap half of {@link ExtensionStatus}: what the popup polls when a setting changes,
 * without paying for an auth read and a queue scan it is not going to render.
 */
export interface SyncStatusSnapshot {
  /** Events waiting in IndexedDB. */
  queueDepth: number;
  /** Document bodies waiting in IndexedDB; see {@link QueueStatus.documentsQueued}. */
  documentsQueued: number;
  lastSync: SyncOutcome | null;
}

/** Why a captured draft did not reach the queue; null when it did. */
export type CaptureDropReason =
  'below-threshold' | 'duplicate' | 'paused' | 'excluded-origin' | 'too-short';

/** The service worker's verdict on a capture, returned to the content script. */
export interface CaptureDecision {
  queued: boolean;
  reason: CaptureDropReason | null;
  importance: number;
  band: ImportanceBand;
}

/** Raw selection capture, sent before scoring so high-volume selections stay cheap. */
export interface SelectionCapturePayload {
  text: string;
  contextBefore: string;
  contextAfter: string;
  url: string;
  title: string | null;
}

/**
 * An extracted page body, as the content script sends it to the service worker.
 *
 * The content script is the only side that can produce this: Readability needs the live DOM,
 * which the service worker has no access to, and the whole point of extracting there is that
 * the raw DOM never leaves the page.
 *
 * Two fields a reader might expect are deliberately absent. There is no `contentHash`: the
 * server computes the document's dedup identity from `content`, because a client-named
 * identity would let a client merge two documents it merely believes are identical. And
 * there is no `metadata`, because nothing persists one.
 *
 * `source` is narrowed to `'web'` rather than the shared `DocumentSource` union, which is
 * honest about what this client can produce — a browser capture is a web capture — and it
 * still satisfies the shared wire type, whose `source` accepts it.
 */
export interface DocumentDraft {
  url: string;
  title: string;
  content: string;
  language: string | null;
  source: 'web';
  wordCount: number;
  occurredAt: string;
}

/** Generic acknowledgement for messages that carry no payload of their own. */
export interface AckResponse {
  ok: boolean;
  error: string | null;
}

/** Response payloads, keyed by the request's discriminant. */
export interface RuntimeResponseByType {
  EVENT_CAPTURED: CaptureDecision;
  FLUSH_QUEUE: SyncOutcome;
  SYNC_NOW: SyncOutcome;
  GET_STATUS: ExtensionStatus;
  SYNC_STATUS: SyncStatusSnapshot;
  SET_CAPTURE_ENABLED: AckResponse;
  AUTH_STATE_CHANGED: AckResponse;
  CAPTURE_SELECTION: CaptureDecision;
  DOCUMENT_CAPTURED: AckResponse;
  ASK_QUESTION: { accepted: boolean; questionId: string };
}

/** Every message the extension accepts over `chrome.runtime.sendMessage`. */
export type RuntimeMessage =
  | { type: 'EVENT_CAPTURED'; draft: CapturedEventDraft }
  | { type: 'FLUSH_QUEUE'; reason: FlushReason }
  | { type: 'SYNC_NOW'; force: boolean }
  | { type: 'GET_STATUS' }
  | { type: 'SYNC_STATUS' }
  | { type: 'SET_CAPTURE_ENABLED'; enabled: boolean }
  | { type: 'AUTH_STATE_CHANGED'; auth: AuthStateSnapshot }
  | { type: 'CAPTURE_SELECTION'; selection: SelectionCapturePayload }
  | { type: 'DOCUMENT_CAPTURED'; document: DocumentDraft }
  | { type: 'ASK_QUESTION'; question: string; mode: ChatMode };

/** Union of valid discriminants, handy for building a dispatch table. */
export type RuntimeMessageType = RuntimeMessage['type'];

/** Response type for a given discriminant. */
export type RuntimeResponse<T extends RuntimeMessageType> = RuntimeResponseByType[T];

/** Response type for a given message value. */
export type RuntimeResponseFor<M extends RuntimeMessage> = RuntimeResponseByType[M['type']];

/**
 * Runtime validator for {@link RuntimeMessage}. The concrete zod schema lives in
 * `lib/messages.ts` next to the router's dispatch table; this alias pins the contract it
 * must satisfy so a schema and the union cannot drift apart.
 */
export type RuntimeMessageSchema = ZodType<RuntimeMessage>;

/** Commands the service worker sends into a content script. */
export type ContentScriptCommand =
  | { command: 'PING' }
  | { command: 'SET_CAPTURE_ENABLED'; enabled: boolean }
  | { command: 'EXTRACT_DOCUMENT' }
  | { command: 'CAPTURE_SELECTION_NOW' }
  | { command: 'FLUSH_WATCH_PROGRESS' }
  | { command: 'RESYNC_SETTINGS' };

/** Acknowledgement a content script returns for a {@link ContentScriptCommand}. */
export interface ContentScriptAck {
  ok: boolean;
  error: string | null;
}
