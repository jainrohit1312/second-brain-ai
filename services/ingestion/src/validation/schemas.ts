/**
 * Zod schemas for the ingestion edge.
 *
 * These mirror the `@second-brain/shared` activity vocabulary field for field, so the
 * parsed output of each schema is structurally identical to the matching shared
 * interface. The exported input types are inferred from the schemas (`z.infer`) rather
 * than hand written, which keeps the runtime guard and the compile-time contract from
 * drifting apart.
 *
 * This module is the *only* place in the service where client-supplied data is trusted,
 * and only after it parses. Everything downstream consumes parsed values.
 */
import { SCHEMA_VERSION, isIsoTimestamp, SOURCES } from '@second-brain/shared';
import { z } from 'zod';

/** The schema version this service accepts on `ActivityBatch.schemaVersion`. */
export { SCHEMA_VERSION };

/**
 * Maximum events in one sync request. Mirrors `SYNC_BATCH_SIZE` in `.env.example`;
 * raising the env var without raising this bound requires a schema change by design, so
 * an oversized batch is rejected at the edge instead of being half processed.
 */
export const MAX_BATCH_EVENTS = 100;

/** Upper bound on selection / copy text, in UTF-16 code units. */
export const MAX_SELECTION_TEXT_LENGTH = 20_000;

/** Upper bound on the surrounding context a client sends for a selection, per side. */
export const MAX_SELECTION_CONTEXT_LENGTH = 500;

/**
 * Validator for a shared string-literal union constant such as `SOURCES`, which is
 * declared as a widened `readonly DocumentSource[]` and therefore cannot be handed to
 * `z.enum`. A refine over the shared array keeps the taxonomy single-sourced.
 */
const sharedLiteralUnion = <T extends string>(values: readonly T[], label: string) =>
  z.string().refine((value): value is T => values.includes(value as T), {
    message: `Unknown ${label}`,
  });

/**
 * ISO-8601 instant validator. Delegates to the shared `isIsoTimestamp` so the client,
 * the extension and the server agree on what a timestamp looks like.
 */
const isoTimestamp = () =>
  z.string().refine(isIsoTimestamp, { message: 'Expected an ISO-8601 timestamp' });

/**
 * Client-generated event identifier. A UUID, because ids must be unique across devices
 * without coordination and stable across retries.
 */
const eventId = () =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'Expected a UUID',
  });

/**
 * Free-form identifier issued by the server (`deviceId`) or the auth provider
 * (`userId`). Opaque: it may not be a UUID, so only its length is constrained.
 */
const opaqueId = () => z.string().min(1).max(128);

/**
 * Deduplication key, as produced by `dedupeKey` in `@second-brain/shared`:
 * `"<eventType>:<minuteBucket>:<fnv1a64Hex>"`. Validating the shape — rather than only
 * the length — is what stops a client from sending a URL, a title, or an empty string
 * here and silently defeating `(deviceId, dedupeKey)` uniqueness.
 */
const dedupeKey = () =>
  z.string().regex(/^[a-z_]+:\d+:[0-9a-f]{16}$/, {
    message: 'Expected a key produced by the shared dedupeKey() helper',
  });

/**
 * Content digest as produced by the shared `contentHash` helper: an optional
 * algorithm prefix followed by lowercase hex.
 */
const contentHash = () =>
  z
    .string()
    .min(16)
    .max(128)
    .regex(/^(?:[a-z0-9]+:)?[0-9a-f]{16,}$/i, { message: 'Expected a hex digest' });

/** Percent value in `[0, 100]` — not a fraction. */
const percent = () => z.number().min(0).max(100);

/** Fraction value in `[0, 1]`. */
const fraction = () => z.number().min(0).max(1);

/** Non-negative integral quantity (count, millisecond, second, byte). */
const nonNegativeInt = () => z.number().int().min(0);

/**
 * Fields every activity event carries regardless of type.
 *
 * `title` may be empty because clients cannot always resolve a document title.
 * `importance` is validated but never trusted — the server re-scores every event with
 * the processing engine (see `handlers/activity.ts`) and discards whatever the client
 * computed.
 *
 * `receivedAt` is deliberately absent: it is a server field. zod strips unknown keys by
 * default, so a client that sends one is ignored rather than rejected.
 */
const activityEventBase = z.object({
  id: eventId(),
  deviceId: opaqueId(),
  occurredAt: isoTimestamp(),
  importance: fraction(),
  dedupeKey: dedupeKey(),
  url: z.string().url().nullable(),
  title: z.string().max(500).nullable(),
  metadata: z.record(z.unknown()),
});

/** `page_view` — a page that became visible. Carries dwell time and scroll depth. */
export const pageViewEventSchema = activityEventBase.extend({
  type: z.literal('page_view'),
  domain: z.string().min(1).max(253),
  durationMs: nonNegativeInt(),
  scrollDepthPct: percent(),
});

/** `page_read` — the client judged the page read and hashed the text it saw. */
export const pageReadEventSchema = activityEventBase.extend({
  type: z.literal('page_read'),
  domain: z.string().min(1).max(253),
  wordCount: nonNegativeInt(),
  readingTimeSeconds: nonNegativeInt(),
  contentHash: contentHash(),
});

/** `selection` — highlighted text. The context fields are what make it interpretable. */
export const selectionEventSchema = activityEventBase.extend({
  type: z.literal('selection'),
  text: z.string().min(1).max(MAX_SELECTION_TEXT_LENGTH),
  contextBefore: z.string().max(MAX_SELECTION_CONTEXT_LENGTH),
  contextAfter: z.string().max(MAX_SELECTION_CONTEXT_LENGTH),
  selectionLength: z.number().int().min(1).max(MAX_SELECTION_TEXT_LENGTH),
});

/** `copy` — a clipboard write of a selection. A stronger intent signal than selection. */
export const copyEventSchema = activityEventBase.extend({
  type: z.literal('copy'),
  text: z.string().min(1).max(MAX_SELECTION_TEXT_LENGTH),
  selectionLength: z.number().int().min(1).max(MAX_SELECTION_TEXT_LENGTH),
});

/**
 * `youtube_watch` — watch progress on a video. `durationSeconds` stays nullable because
 * the client often does not know the total length at flush time, and `watchedPct` is
 * `0` in that case rather than being derived from an unknown denominator.
 */
export const youtubeWatchEventSchema = activityEventBase.extend({
  type: z.literal('youtube_watch'),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, { message: 'Expected a YouTube video id' }),
  channelName: z.string().max(200).nullable(),
  watchedSeconds: nonNegativeInt(),
  durationSeconds: nonNegativeInt().nullable(),
  watchedPct: fraction(),
  transcriptAvailable: z.boolean(),
});

/** `app_session` — a foreground or background span in a mobile app package. */
export const appSessionEventSchema = activityEventBase.extend({
  type: z.literal('app_session'),
  packageName: z.string().min(1).max(255),
  appLabel: z.string().min(1).max(200),
  startAt: isoTimestamp(),
  endAt: isoTimestamp(),
  durationSeconds: nonNegativeInt(),
  isForeground: z.boolean(),
});

/** `search` — a query typed into a search engine. */
export const searchEventSchema = activityEventBase.extend({
  type: z.literal('search'),
  query: z.string().min(1).max(500),
  engine: z.string().min(1).max(50),
});

/** `bookmark` — an explicit save. `url` is required, unlike the nullable base field. */
export const bookmarkEventSchema = activityEventBase.extend({
  type: z.literal('bookmark'),
  url: z.string().url(),
  folder: z.string().max(200).nullable(),
});

/** `download` — a completed download. `url` is required; `bytes` is often unknown. */
export const downloadEventSchema = activityEventBase.extend({
  type: z.literal('download'),
  url: z.string().url(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255).nullable(),
  bytes: nonNegativeInt().nullable(),
});

/**
 * The activity event union, discriminated on `type`. Each member narrows the fields only
 * that event type carries, mirroring the shared `ActivityEvent` union exactly.
 */
export const activityEventSchema = z.discriminatedUnion('type', [
  pageViewEventSchema,
  pageReadEventSchema,
  selectionEventSchema,
  copyEventSchema,
  youtubeWatchEventSchema,
  appSessionEventSchema,
  searchEventSchema,
  bookmarkEventSchema,
  downloadEventSchema,
]);

/**
 * A client sync batch.
 *
 * `schemaVersion` is bounded above by `SCHEMA_VERSION` rather than merely required to be
 * positive, because a client newer than the server must be rejected instead of
 * mis-parsed. Cross-event invariants are deliberately *not* enforced here — for example
 * that `watchedSeconds <= durationSeconds`, or that events are ordered by `occurredAt` —
 * because the handlers check those per event so that one malformed event can be rejected
 * without failing the whole batch.
 */
export const activityBatchSchema = z.object({
  schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION),
  deviceId: opaqueId(),
  clientSentAt: isoTimestamp(),
  events: z.array(activityEventSchema).min(1).max(MAX_BATCH_EVENTS),
});

/**
 * A document capture from a client.
 *
 * The client sends metadata plus a content hash, and sends `bodyText` only when it
 * genuinely holds the body (a manual save, a newsletter, a PDF it already parsed).
 * Otherwise it sends `null` and the server fetches the URL. Readable-text extraction
 * from HTML belongs to `services/processing`, never to this edge.
 *
 * `wordCount` and `readingTimeSeconds` are absent on purpose: the server derives them
 * from the accepted text so two clients cannot disagree about the same document.
 */
export const ingestDocumentSchema = z
  .object({
    source: sharedLiteralUnion(SOURCES, 'document source'),
    url: z.string().url().nullable(),
    canonicalUrl: z.string().url().nullable(),
    title: z.string().max(500),
    author: z.string().max(300).nullable(),
    siteName: z.string().max(200).nullable(),
    publishedAt: isoTimestamp().nullable(),
    contentHash: contentHash(),
    language: z.string().min(2).max(35).nullable(),
    deviceId: opaqueId().nullable(),
    bodyText: z.string().min(1).max(2_000_000).nullable(),
    metadata: z.record(z.unknown()),
  })
  .refine((input) => input.url !== null || input.bodyText !== null, {
    message: 'A document capture must carry either a url to fetch or a bodyText to accept',
    path: ['url'],
  });

/** Validated activity event, structurally identical to the shared `ActivityEvent`. */
export type ActivityEventInput = z.infer<typeof activityEventSchema>;

/** Validated client sync batch, structurally identical to the shared `ActivityBatch`. */
export type ActivityBatchInput = z.infer<typeof activityBatchSchema>;

/** Validated document capture accepted by `handleDocumentCapture`. */
export type IngestDocumentInput = z.infer<typeof ingestDocumentSchema>;
