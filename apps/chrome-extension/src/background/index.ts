import { EXPLICIT_INTENT_EVENT_TYPES, sha256Hex } from '@second-brain/shared';

import { getSession, toAuthStateSnapshot } from '@/lib/auth';
import { RecentKeyRing, contentDedupeKey } from '@/lib/dedup';
import { getDeviceIdentity, getOrInitDeviceId } from '@/lib/device';
import { parseRuntimeMessage, sendContentScriptCommand } from '@/lib/messages';
import { scoreLocally, shouldCapture } from '@/lib/scoring';
import {
  SETTING_KEYS,
  bumpDroppedCount,
  readCaptureEnabled,
  readCapturePaused,
  readDroppedCount,
  readLastSync,
  readSetting,
  writeCaptureEnabled,
  writeCapturePaused,
} from '@/lib/settings';
import { deriveSignals } from '@/lib/signals';
import { createExtensionClient } from '@/lib/supabase';

import { isIdleFlushDue, startIdleWatch, stopIdleWatch } from './idle';
import { IndexedDbQueue, MAX_QUEUE_DEPTH } from './queue';
import { SYNC_ALARM_NAME, flushQueue, startPeriodicSync, stopPeriodicSync } from './sync';

import type { IdleBucket } from './idle';
import type { QueueStore } from './queue';
import type {
  AckResponse,
  CaptureDecision,
  CapturedEventDraft,
  ContentScriptCommand,
  DocumentDraft,
  ExtensionStatus,
  FlushReason,
  QueueStatus,
  RuntimeMessage,
  RuntimeMessageType,
  RuntimeResponse,
  SyncOutcome,
  SyncStatusSnapshot,
} from '@/types/events';
import type { ActivityEvent, DeviceId } from '@second-brain/shared';

/**
 * Manifest V3 service worker entry point.
 *
 * Every listener below is registered during the module's first synchronous
 * evaluation, because Chrome evicts an idle worker after roughly 30 seconds and
 * re-runs this file on the next event. Nothing durable may live in module scope:
 * queue depth, auth session, device id, and sync cursor all live in IndexedDB or
 * `chrome.storage`, never in a module variable.
 *
 * The one deliberate exception is the recent-key ring, whose whole job is to be
 * short-lived: it absorbs the burst of near-identical captures a render loop produces,
 * and being empty after a restart costs a redundant round trip, never a duplicate row.
 */

/** Queue handle for this worker instance; the backing database outlives the worker. */
export const queue: QueueStore = new IndexedDbQueue();

/** Above this depth a capture triggers an immediate flush instead of waiting for the alarm. */
export const BATCH_FLUSH_THRESHOLD = 90;

/**
 * Documents above which a capture triggers an immediate flush. Far below
 * {@link BATCH_FLUSH_THRESHOLD} because the two queues are capped differently: the server
 * takes at most five documents per batch, so a sixth body cannot leave until the next drain
 * and waiting for the alarm would simply let the document store grow behind a batch that is
 * already full.
 */
export const DOCUMENT_FLUSH_THRESHOLD = 5;

/** Dedupe ring for this worker instance; see the module note above. */
const recentKeys = new RecentKeyRing();

/** Handler for one protocol message; the resolved value is the response payload. */
type MessageHandler<T extends RuntimeMessageType> = (
  message: Extract<RuntimeMessage, { type: T }>,
) => Promise<RuntimeResponse<T>>;

/** Renders an unknown thrown value as a message for the popup or the log. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds a sync dependency set and drains the queue, swallowing only the failures that
 * happen *before* the drain starts — a build with no Supabase env, or a device id that was
 * never seeded. Those become a `failed` outcome so the popup can show why nothing moves,
 * rather than an exception that would vanish into an unhandled rejection.
 */
async function flushForSync(reason: FlushReason): Promise<SyncOutcome> {
  const attemptedAt = new Date().toISOString();
  try {
    const client = createExtensionClient();
    const deviceId = await getOrInitDeviceId();
    return await flushQueue(queue, { client, deviceId }, reason);
  } catch (error) {
    const detail = describeError(error);
    console.error(`[second-brain] sync (${reason}) could not start: ${detail}`);
    return {
      status: 'failed',
      reason,
      attemptedAt,
      finishedAt: new Date().toISOString(),
      sent: 0,
      result: null,
      error: detail,
    };
  }
}

/** Sends one command to every tab's content script; resolves with an error, or null. */
async function broadcastToContentScripts(command: ContentScriptCommand): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) =>
        tab.id === undefined ? Promise.resolve(null) : sendContentScriptCommand(tab.id, command),
      ),
    );
    return null;
  } catch (error) {
    return describeError(error);
  }
}

/**
 * Applies an idle or lock transition.
 *
 * The pause flag is written before the flush so content scripts stop building drafts
 * immediately, and the flush is rate-limited by {@link isIdleFlushDue} because the same
 * transition is observed twice: once by the watcher started on `onStartup` and once by the
 * static listener at the bottom of this file, which is what revives an evicted worker.
 */
async function handleIdleTransition(bucket: IdleBucket): Promise<void> {
  try {
    await writeCapturePaused(bucket !== 'active');
    if (bucket === 'active') {
      await broadcastToContentScripts({
        command: 'SET_CAPTURE_ENABLED',
        enabled: await readCaptureEnabled(),
      });
      return;
    }

    const lastSync = await readLastSync();
    if (!isIdleFlushDue(bucket, lastSync?.finishedAt ?? null)) {
      return;
    }
    await flushForSync('idle');
  } catch (error) {
    console.warn('[second-brain] idle handling failed', error);
  }
}

/** Clears the pause flag set when the machine went idle or locked. */
function resumeCapture(): void {
  void handleIdleTransition('active');
}

/** Recorded as a capture decision when the event never reached the queue. */
function dropped(reason: CaptureDecision['reason'], importance = 0, band: CaptureDecision['band'] = 'noise'): CaptureDecision {
  return { queued: false, reason, importance, band };
}

/** Text a dedupe hash should consider, for the event types that carry any. */
function draftText(draft: CapturedEventDraft): string | null {
  switch (draft.type) {
    case 'selection':
    case 'copy':
      return draft.text;
    case 'search':
      return draft.query;
    default:
      return null;
  }
}

/** Completes a draft into the event the server accepts, minting the four worker-only fields. */
function mintEvent(
  draft: CapturedEventDraft,
  deviceId: DeviceId,
  dedupeKeyValue: string,
  importance: number,
): ActivityEvent {
  return {
    ...draft,
    id: crypto.randomUUID(),
    deviceId,
    importance,
    dedupeKey: dedupeKeyValue,
  };
}

/**
 * Scores, deduplicates, and queues one captured draft.
 *
 * The checks run in the order that costs least first, and every drop is counted so the
 * popup can show a non-zero number instead of a silent gap.
 */
async function handleEventCaptured(draft: CapturedEventDraft): Promise<CaptureDecision> {
  if (!(await readCaptureEnabled()) || (await readCapturePaused())) {
    await bumpDroppedCount(1);
    return dropped('paused');
  }

  const dedupeKeyValue = contentDedupeKey({
    type: draft.type,
    url: draft.url,
    title: draft.title,
    text: draftText(draft),
    occurredAt: draft.occurredAt,
  });

  if (recentKeys.has(dedupeKeyValue)) {
    await bumpDroppedCount(1);
    return dropped('duplicate');
  }

  const score = scoreLocally(deriveSignals(draft, new Date()));
  // Explicit intent — a bookmark, a download, a search — is captured whatever it scores:
  // the user did something on purpose, and that is the one thing a threshold must not
  // overrule.
  const explicitIntent = EXPLICIT_INTENT_EVENT_TYPES.includes(draft.type);
  if (!explicitIntent && !shouldCapture(score)) {
    await bumpDroppedCount(1);
    return dropped('below-threshold', score.value, score.band);
  }

  const deviceId = await getOrInitDeviceId();
  const event = mintEvent(draft, deviceId, dedupeKeyValue, score.value);

  const before = await queue.size();
  await queue.enqueue(event);
  const after = await queue.size();
  if (before >= MAX_QUEUE_DEPTH && after < before + 1) {
    // The store evicted to stay under the cap. Whatever left the queue during this insert
    // — the new event included, if it scored lowest — is a local drop.
    const evicted = Math.max(0, before + 1 - after);
    if (evicted > 0) {
      await bumpDroppedCount(evicted);
    }
  }

  recentKeys.add(dedupeKeyValue);

  if (after >= BATCH_FLUSH_THRESHOLD) {
    void flushForSync('batch-full');
  }

  return { queued: true, reason: null, importance: score.value, band: score.band };
}

/**
 * Queues one extracted document body.
 *
 * The id is the SHA-256 of `content`, so the store is idempotent on the text rather than on
 * the page: re-capturing the same article collapses onto the record already queued instead of
 * sending the body twice.
 *
 * `sha256Hex` needs `crypto.subtle`, which is the reason this runs here rather than in the
 * content script. A content script is injected into whatever the user is browsing, including
 * plain `http://` origins where `crypto.subtle` does not exist, while a service worker is
 * always a secure context.
 *
 * No score is consulted and no threshold is applied. A document exists only because the
 * content script already decided the page was worth the cost of extracting it, and a cheap
 * length floor here would be a second gate that has to stay aligned with the first — the same
 * failure mode `selection-draft.ts` avoids on the other side. `enqueueDocument` absorbs a
 * repeat, which is the only deduplication this path needs.
 */
async function handleDocumentCaptured(document: DocumentDraft): Promise<AckResponse> {
  const id = await sha256Hex(document.content);

  await queue.enqueueDocument({
    id,
    document,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
  });

  if ((await queue.documentCount()) >= DOCUMENT_FLUSH_THRESHOLD) {
    void flushForSync('batch-full');
  }

  return { ok: true, error: null };
}

/** Queue depth, oldest/newest stamps, the drop counter, and the pause state. */
async function collectQueueStatus(): Promise<QueueStatus> {
  const [depth, documentsQueued, oldest, newest, droppedCount, captureEnabled, capturePaused, lastSync] =
    await Promise.all([
      queue.size(),
      queue.documentCount(),
      queue.peekBatch(1),
      queue.peekNewest(1),
      readDroppedCount(),
      readCaptureEnabled(),
      readCapturePaused(),
      readLastSync(),
    ]);

  const lastSucceeded =
    lastSync !== null && (lastSync.status === 'ok' || lastSync.status === 'partial')
      ? lastSync.finishedAt
      : null;

  return {
    depth,
    documentsQueued,
    oldestQueuedAt: oldest[0]?.queuedAt ?? null,
    newestQueuedAt: newest[0]?.queuedAt ?? null,
    droppedCount,
    isPaused: !captureEnabled || capturePaused,
    lastSyncedAt: lastSucceeded,
  };
}

/** The cheap half of the status: for refreshes that will not render the rest. */
async function collectSyncStatus(): Promise<SyncStatusSnapshot> {
  const [queueDepth, documentsQueued, lastSync] = await Promise.all([
    queue.size(),
    queue.documentCount(),
    readLastSync(),
  ]);
  return { queueDepth, documentsQueued, lastSync };
}

/** Everything the popup and side panel render. */
async function collectStatus(): Promise<ExtensionStatus> {
  const [queueStatus, lastSync, captureEnabled, session, identity] = await Promise.all([
    collectQueueStatus(),
    readLastSync(),
    readCaptureEnabled(),
    getSession(),
    getDeviceIdentity(),
  ]);

  return {
    queue: queueStatus,
    lastSync,
    auth: toAuthStateSnapshot(session),
    captureEnabled,
    deviceId: identity?.deviceId ?? null,
  };
}

/** Persists the capture switch and pushes it to every open tab. */
async function applyCaptureEnabled(enabled: boolean): Promise<AckResponse> {
  await writeCaptureEnabled(enabled);
  const failure = await broadcastToContentScripts({ command: 'SET_CAPTURE_ENABLED', enabled });
  return { ok: failure === null, error: failure };
}

/**
 * Dispatch table for the extension-internal protocol. The router validates the incoming
 * message against `runtimeMessageSchema` before looking it up.
 *
 * `CAPTURE_SELECTION` and `ASK_QUESTION` are deliberately absent. Selection capture is
 * push-based and needs nothing from this table — the content script's observer and its copy
 * listener build their drafts and send them as `EVENT_CAPTURED`, so a `CAPTURE_SELECTION`
 * handler would be a second way to record the same thing, driven by a command the worker
 * never sends. Retrieval is Phase 4. The router answers both with a plain refusal rather than
 * a payload shaped like a decision it did not make.
 */
export const messageHandlers: {
  [T in RuntimeMessageType]?: MessageHandler<T>;
} = {
  EVENT_CAPTURED: (message) => handleEventCaptured(message.draft),
  DOCUMENT_CAPTURED: (message) => handleDocumentCaptured(message.document),
  FLUSH_QUEUE: (message) => flushForSync(message.reason),
  SYNC_NOW: () => flushForSync('manual'),
  GET_STATUS: () => collectStatus(),
  SYNC_STATUS: () => collectSyncStatus(),
  SET_CAPTURE_ENABLED: (message) => applyCaptureEnabled(message.enabled),
  AUTH_STATE_CHANGED: () => Promise.resolve({ ok: true, error: null }),
};

/** Routes one validated message, or refuses it when Phase 1a has no handler for it. */
async function dispatchMessage(message: RuntimeMessage): Promise<unknown> {
  const handler = messageHandlers[message.type];
  if (handler === undefined) {
    const refusal: AckResponse = {
      ok: false,
      error: `${message.type} is not implemented in Phase 1a`,
    };
    return refusal;
  }
  // The table is keyed by discriminant, so this pairing is the one the lookup just proved;
  // TypeScript cannot express it because the mapped type loses the correlation.
  return (handler as MessageHandler<typeof message.type>)(message);
}

/**
 * First-run (and upgrade) work.
 *
 * Phase 1a: resolve the device id, seed the capture toggle, and arm the periodic sync. All
 * three are idempotent, so an extension update re-runs them harmlessly. A failure here is
 * logged rather than thrown: a missing `VITE_DEVICE_ID` must not stop the worker from
 * registering its listeners, or the popup's "not configured" message would have nowhere to
 * come from.
 *
 * The alarm belongs here as well as in `onStartup`, because `onStartup` fires when the
 * *browser* starts — installing or reloading the extension does not — so without this an
 * install would capture events and never drain them until the next browser restart.
 */
async function initializeOnInstalled(reason: string): Promise<void> {
  console.log(`[second-brain] onInstalled (reason: ${reason})`);

  try {
    const deviceId = await getOrInitDeviceId();
    console.log(`[second-brain] device id initialised: ${deviceId}`);
  } catch (error) {
    console.error('[second-brain] device initialisation failed', error);
  }

  // Only seed when unset: an update must not silently turn capture back on for a user who
  // switched it off.
  const existing = await readSetting<unknown>(SETTING_KEYS.captureEnabled, null);
  if (existing === null) {
    await writeCaptureEnabled(true);
    console.log('[second-brain] capture enabled by default');
  }

  startPeriodicSync();
}

chrome.runtime.onInstalled.addListener((details) => {
  void initializeOnInstalled(details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  startPeriodicSync();
  startIdleWatch({
    onIdle: () => void handleIdleTransition('idle'),
    onLocked: () => void handleIdleTransition('locked'),
    onActive: resumeCapture,
  });
});

chrome.runtime.onSuspend.addListener(() => {
  stopPeriodicSync();
  stopIdleWatch();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = parseRuntimeMessage(message);
  if (parsed === null) {
    const refusal: AckResponse = { ok: false, error: 'Unrecognised message' };
    sendResponse(refusal);
    return false;
  }

  dispatchMessage(parsed)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      const failure: AckResponse = { ok: false, error: describeError(error) };
      sendResponse(failure);
    });

  // Keeps the message channel open until the async response is sent; without it the worker
  // may answer into a closed port.
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    void flushForSync('alarm');
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  // The static registration is what revives an evicted worker on an idle transition; the
  // watcher started on `onStartup` covers the in-worker case. `handleIdleTransition` is
  // rate-limited, so the overlap costs one skipped flush, not two.
  void handleIdleTransition(state);
});

chrome.contextMenus.onClicked.addListener((_info, _tab) => {
  // Phase 2: "Save page" / "Save selection" / "Save video" arrive with `chrome.contextMenus.create`
  // in `initializeOnInstalled`, which Phase 1a does not register.
});
