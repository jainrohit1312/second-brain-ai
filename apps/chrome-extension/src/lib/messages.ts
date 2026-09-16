/**
 * The extension-internal wire protocol: zod schemas plus the two send helpers.
 *
 * Purpose: validate everything that crosses a context boundary. A message arriving at the
 * service worker comes from a content script running in a page the extension does not
 * control, so it is untrusted input even though it is nominally "ours" — anything the
 * router accepts ends up in IndexedDB and, on the next drain, on the server. Phase 1a
 * scope: the full `RuntimeMessage` union and the service-worker → content-script command
 * channel.
 */
import { ACTIVITY_EVENT_TYPES, isIsoTimestamp } from '@second-brain/shared';
import { z } from 'zod';

import type {
  ContentScriptAck,
  ContentScriptCommand,
  RuntimeMessage,
  RuntimeMessageSchema,
  RuntimeResponseFor,
} from '@/types/events';
import type { ActivityEventType } from '@second-brain/shared';

/** Every flush trigger, mirrored from `FlushReason` so the schema cannot drift. */
const flushReasonSchema = z.enum(['idle', 'alarm', 'manual', 'batch-full', 'tab-hidden', 'sign-out']);

/** The chat modes the side panel drives; unused in Phase 1a but part of the contract. */
const chatModeSchema = z.enum(['ask', 'recall', 'timeline']);

/** The event-type discriminant, sourced from the shared list rather than restated. */
const activityEventTypeSchema = z.enum(
  ACTIVITY_EVENT_TYPES as readonly [ActivityEventType, ...ActivityEventType[]],
);

/** ISO-8601 UTC timestamps are shape-checked and then parsed, like the shared guard does. */
const isoTimestampSchema = z
  .string()
  .refine(isIsoTimestamp, { message: 'must be an ISO-8601 timestamp' });

const nullableStringSchema = z.string().nullable();

/** Fields every captured draft carries, whatever its variant. */
const capturedEventBaseShape = {
  type: activityEventTypeSchema,
  occurredAt: isoTimestampSchema,
  url: nullableStringSchema,
  title: nullableStringSchema,
  metadata: z.record(z.unknown()),
};

/**
 * A captured draft as it arrives from a content script.
 *
 * Every variant is spelled out: the router mints the identity fields and then writes the
 * draft straight into the durable queue, so a malformed one would be persisted and retried
 * until the server rejected it. Rejecting it here keeps poison out of IndexedDB.
 */
const capturedEventDraftSchema = z.discriminatedUnion('type', [
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('page_view'),
    domain: z.string(),
    durationMs: z.number(),
    scrollDepthPct: z.number(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('page_read'),
    domain: z.string(),
    wordCount: z.number(),
    readingTimeSeconds: z.number(),
    contentHash: z.string(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('selection'),
    text: z.string(),
    contextBefore: z.string(),
    contextAfter: z.string(),
    selectionLength: z.number(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('copy'),
    text: z.string(),
    selectionLength: z.number(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('youtube_watch'),
    videoId: z.string(),
    channelName: nullableStringSchema,
    watchedSeconds: z.number(),
    durationSeconds: z.number().nullable(),
    watchedPct: z.number(),
    transcriptAvailable: z.boolean(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('app_session'),
    packageName: z.string(),
    appLabel: z.string(),
    startAt: isoTimestampSchema,
    endAt: isoTimestampSchema,
    durationSeconds: z.number(),
    isForeground: z.boolean(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('search'),
    query: z.string(),
    engine: z.string(),
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('bookmark'),
    url: z.string(),
    folder: nullableStringSchema,
  }),
  z.object({
    ...capturedEventBaseShape,
    type: z.literal('download'),
    url: z.string(),
    filename: z.string(),
    mimeType: nullableStringSchema,
    bytes: z.number().nullable(),
  }),
]);

/** Auth snapshot as the popup broadcasts and reads it. */
const authStateSnapshotSchema = z.object({
  status: z.enum(['signed-in', 'signed-out', 'expired']),
  userId: nullableStringSchema,
  email: nullableStringSchema,
  expiresAt: nullableStringSchema,
});

/** Raw selection payload, sent before scoring so high-volume selections stay cheap. */
const selectionCapturePayloadSchema = z.object({
  text: z.string(),
  contextBefore: z.string(),
  contextAfter: z.string(),
  url: z.string(),
  title: nullableStringSchema,
});

/**
 * The live validator for {@link RuntimeMessage}.
 *
 * Typed against `RuntimeMessageSchema`, which is `ZodType<RuntimeMessage>` — if a schema
 * member and the union drift apart, this assignment stops compiling.
 */
export const runtimeMessageSchema: RuntimeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EVENT_CAPTURED'), draft: capturedEventDraftSchema }),
  z.object({ type: z.literal('FLUSH_QUEUE'), reason: flushReasonSchema }),
  z.object({ type: z.literal('SYNC_NOW'), force: z.boolean() }),
  z.object({ type: z.literal('GET_STATUS') }),
  z.object({ type: z.literal('SYNC_STATUS') }),
  z.object({ type: z.literal('SET_CAPTURE_ENABLED'), enabled: z.boolean() }),
  z.object({ type: z.literal('AUTH_STATE_CHANGED'), auth: authStateSnapshotSchema }),
  z.object({ type: z.literal('CAPTURE_SELECTION'), selection: selectionCapturePayloadSchema }),
  z.object({ type: z.literal('ASK_QUESTION'), question: z.string(), mode: chatModeSchema }),
]);

/** Validator for the commands the worker sends into a content script. */
export const contentScriptCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('PING') }),
  z.object({ command: z.literal('SET_CAPTURE_ENABLED'), enabled: z.boolean() }),
  z.object({ command: z.literal('EXTRACT_DOCUMENT') }),
  z.object({ command: z.literal('CAPTURE_SELECTION_NOW') }),
  z.object({ command: z.literal('FLUSH_WATCH_PROGRESS') }),
  z.object({ command: z.literal('RESYNC_SETTINGS') }),
]);

/** Parses an untrusted value into a {@link RuntimeMessage}, or null when it is not one. */
export function parseRuntimeMessage(candidate: unknown): RuntimeMessage | null {
  const parsed = runtimeMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Parses an untrusted value into a {@link ContentScriptCommand}, or null. */
export function parseContentScriptCommandValue(candidate: unknown): ContentScriptCommand | null {
  const parsed = contentScriptCommandSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Sends one protocol message to the service worker and resolves with its typed response.
 *
 * Rejects on transport failure — no receiving end, or an invalidated extension context
 * after a reload — so callers decide whether that is worth surfacing.
 */
export async function sendRuntimeMessage<M extends RuntimeMessage>(
  message: M,
): Promise<RuntimeResponseFor<M>> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  return response as RuntimeResponseFor<M>;
}

/**
 * Sends one command into a specific tab's content script.
 *
 * Resolves with null instead of rejecting when the tab has no content script — a
 * `chrome://` page, a PDF viewer, or a frame that was never injected. That is the normal
 * case while broadcasting, and it must not abort the broadcast for the tabs that do have
 * one.
 */
export async function sendContentScriptCommand(
  tabId: number,
  command: ContentScriptCommand,
): Promise<ContentScriptAck | null> {
  try {
    const ack: unknown = await chrome.tabs.sendMessage(tabId, command);
    return (ack as ContentScriptAck | undefined) ?? null;
  } catch {
    return null;
  }
}
