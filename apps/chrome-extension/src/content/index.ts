import { assertNever, clamp, extractDomain } from '@second-brain/shared';

import { parseContentScriptCommandValue, sendRuntimeMessage } from '@/lib/messages';
import { SETTING_KEYS, onSettingChanged, readCaptureEnabled, readCapturePaused } from '@/lib/settings';

import { EXCLUDED_DOMAINS_SETTING, isExcludedOrigin, refreshExcludedDomains } from './exclusions';
import { buildPageViewDraft } from './page-view';

import type { CaptureDecision, CapturedEventDraft, ContentScriptAck, ContentScriptCommand, FlushReason } from '@/types/events';

/**
 * Content script entry point.
 *
 * Runs in the isolated world once per frame, after `document_idle`, in every http/https
 * page. It owns capture: it observes the document, builds drafts, and forwards them to the
 * service worker over `chrome.runtime.sendMessage`, which is the only channel it has.
 * Scoring, deduplication, and queueing all happen in the worker, so this file stays small
 * enough to run on every page without a measurable cost to the user's browsing.
 *
 * Phase 1a scope: `page_view` only, emitted when the page is left (hidden, navigated away
 * from, or replaced by an SPA route change). Selection, copy, video, and the Readability
 * extraction are implemented in their own modules and are not wired in yet.
 *
 * What this file decides, and what it deliberately does not:
 * - It decides *whether* a page may be captured at all — exclusion, sensitivity, and the
 *   capture switch are applied before a draft object exists, so an excluded page produces
 *   no payload and no queue row to redact later.
 * - It does not score. The score needs the device id, the session, and the recent-key ring,
 *   none of which belong in a page the user visits.
 */

/**
 * Shortest visit worth reporting. Below this the tab was opened and abandoned before it
 * rendered, which is a loading event rather than something the user looked at.
 */
export const MIN_PAGE_DWELL_MS = 2_000;

/**
 * Seconds without input after which dwell time stops accumulating.
 *
 * Mirrors `IDLE_THRESHOLD_SECONDS` in `background/idle.ts`. It is duplicated rather than
 * imported because the content script cannot reach `chrome.idle` — that API is not exposed
 * to content scripts — and importing the background module would pull the queue and the
 * Supabase client into every page in the browser.
 */
const IDLE_TAIL_THRESHOLD_SECONDS = 60;

/** A page visit being accumulated, from `document_idle` to the moment it is left. */
interface ActiveVisit {
  /** Epoch milliseconds the visit started accumulating from. */
  startedAt: number;
  /** URL at the moment the visit started; a later SPA route does not rewrite it. */
  url: string;
  title: string | null;
  domain: string;
}

/** The visit in progress, or null when none is being accumulated. */
let visit: ActiveVisit | null = null;
/** Deepest scroll position seen during the current visit, 0-100. */
let maxScrollDepthPct = 0;
/** Epoch milliseconds of the last observed user input, for the idle-tail correction. */
let lastActivityAt = Date.now();
/** Mirrors the user's capture switch so the hot path never awaits storage. */
let captureEnabled = true;
/** Mirrors the worker's idle/lock pause flag. */
let capturePaused = false;

/** Wires the observers and the command channel. Called once per document. */
export function bootstrapContentScript(): void {
  chrome.runtime.onMessage.addListener(handleContentScriptMessage);

  void refreshCaptureFlags();
  void refreshExcludedDomains();

  // The worker writes the switch, the pause flag, and the exclusion list, so every tab
  // sees a change without being messaged individually.
  onSettingChanged(SETTING_KEYS.captureEnabled, (value) => {
    applyCaptureEnabled(value !== false);
  });
  onSettingChanged(SETTING_KEYS.capturePaused, (value) => {
    capturePaused = value === true;
  });
  onSettingChanged(EXCLUDED_DOMAINS_SETTING, () => {
    void refreshExcludedDomains();
  });

  installPageLifecycle();
  installHistoryHooks();
  startVisit();
}

/** Re-reads the two capture flags the hot path consults. */
async function refreshCaptureFlags(): Promise<void> {
  try {
    captureEnabled = await readCaptureEnabled();
    capturePaused = await readCapturePaused();
  } catch (error) {
    console.warn('[second-brain] cannot read the capture flags', error);
  }
}

/** Applies the capture switch locally, discarding or starting the current visit. */
function applyCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled;
  if (!enabled) {
    visit = null;
    return;
  }
  if (visit === null) {
    startVisit();
  }
}

/** Begins accumulating a visit from the current document. */
function startVisit(): void {
  const url = location.href;
  visit = {
    startedAt: Date.now(),
    url,
    title: document.title.length > 0 ? document.title : null,
    domain: extractDomain(url) ?? location.hostname,
  };
  maxScrollDepthPct = currentScrollDepthPct();
  lastActivityAt = Date.now();
}

/** Records user input, so the idle tail can be subtracted from dwell time. */
function noteActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * How far down the page the viewport has reached, 0-100.
 *
 * A page that fits the viewport reads as 100: there is nothing to scroll, and the whole
 * document was in view, so the signal should not punish a short page for being short.
 */
function currentScrollDepthPct(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollable <= 0) {
    return 100;
  }
  return clamp((window.scrollY / scrollable) * 100, 0, 100);
}

/** Milliseconds of the visit that passed with no input, past the idle threshold. */
function idleTailMs(now: number): number {
  const idleFor = now - lastActivityAt - IDLE_TAIL_THRESHOLD_SECONDS * 1_000;
  return idleFor > 0 ? idleFor : 0;
}

/** Watches visibility, unload, scroll depth, and input on the current document. */
function installPageLifecycle(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void finishVisit();
      return;
    }
    // The user came back to a tab that was already reported; the rest of the visit is a
    // new segment, not an extension of the one already sent.
    if (visit === null) {
      startVisit();
    }
  });

  window.addEventListener('pagehide', () => {
    void finishVisit();
  });
  window.addEventListener('beforeunload', () => {
    void finishVisit();
  });

  window.addEventListener(
    'scroll',
    () => {
      maxScrollDepthPct = Math.max(maxScrollDepthPct, currentScrollDepthPct());
      noteActivity();
    },
    { passive: true },
  );
  window.addEventListener('mousemove', noteActivity, { passive: true });
  window.addEventListener('keydown', noteActivity, { passive: true });
}

/**
 * Treats an SPA route change as a new page.
 *
 * `pushState`/`replaceState` never unload the document, so without this a single-page app
 * would report one enormous visit for the whole session and attribute every route to the
 * first URL.
 */
function installHistoryHooks(): void {
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalPush(data, unused, url);
    handleRouteChange();
  };
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalReplace(data, unused, url);
    handleRouteChange();
  };
  window.addEventListener('popstate', handleRouteChange);
}

/** Reports the visit that just ended, then starts accumulating the new route. */
function handleRouteChange(): void {
  if (location.href === visit?.url) {
    return;
  }
  void finishVisit();
}

/**
 * Emits the visit in progress, if it is worth emitting, and clears it.
 */
async function finishVisit(): Promise<void> {
  const active = visit;
  visit = null;
  if (active === null) {
    return;
  }

  if (!captureEnabled || capturePaused) {
    return;
  }
  if (isExcludedOrigin(active.url)) {
    console.debug('[second-brain] not capturing an excluded or sensitive origin');
    return;
  }

  const now = Date.now();
  const dwellMs = Math.max(0, now - active.startedAt - idleTailMs(now));
  if (dwellMs < MIN_PAGE_DWELL_MS) {
    console.debug('[second-brain] not capturing a visit shorter than the minimum dwell');
    return;
  }

  const draft = buildPageViewDraft({
    url: active.url,
    title: active.title,
    domain: active.domain,
    dwellMs,
    scrollDepthPct: maxScrollDepthPct,
    occurredAt: new Date(now).toISOString(),
  });

  const decision = await deliverDraft(draft);
  if (decision?.queued === true) {
    // The page is going away or the user moved on: get the event out now instead of
    // waiting for the next alarm. The worker decides whether the queue has room to care.
    await requestFlush('tab-hidden');
  }
}

/** Sends one captured draft to the service worker for scoring, dedup, and queueing. */
export function reportCapturedEvent(draft: CapturedEventDraft): void {
  void deliverDraft(draft);
}

/** Delivers a draft and resolves with the worker's decision, or null when it never landed. */
async function deliverDraft(draft: CapturedEventDraft): Promise<CaptureDecision | null> {
  try {
    return await sendRuntimeMessage({ type: 'EVENT_CAPTURED', draft });
  } catch (error) {
    // Normal when the extension was just reloaded: this script instance belongs to an
    // invalidated context and can no longer reach the worker.
    console.debug('[second-brain] capture could not be delivered', error);
    return null;
  }
}

/** Asks the worker to drain the queue now, for the given reason. */
async function requestFlush(reason: FlushReason): Promise<void> {
  try {
    await sendRuntimeMessage({ type: 'FLUSH_QUEUE', reason });
  } catch (error) {
    console.debug('[second-brain] flush request could not be delivered', error);
  }
}

/** Validates an inbound message and narrows it to a command, or null when it is not one. */
export function parseContentScriptCommand(message: unknown): ContentScriptCommand | null {
  return parseContentScriptCommandValue(message);
}

/** Executes one command from the service worker. */
export function runContentScriptCommand(command: ContentScriptCommand): void {
  switch (command.command) {
    case 'PING':
      return;
    case 'SET_CAPTURE_ENABLED':
      applyCaptureEnabled(command.enabled);
      return;
    case 'RESYNC_SETTINGS':
      void refreshCaptureFlags();
      void refreshExcludedDomains();
      return;
    // Phase 2 and later: on-demand extraction, forced selection capture, and the video
    // watch flush all need the capture paths that ship with them.
    case 'EXTRACT_DOCUMENT':
    case 'CAPTURE_SELECTION_NOW':
    case 'FLUSH_WATCH_PROGRESS':
      return;
    default:
      assertNever(command);
  }
}

/** Message listener; returns false because every command responds synchronously. */
function handleContentScriptMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (ack?: unknown) => void,
): boolean {
  const command = parseContentScriptCommand(message);
  if (command === null) {
    return false;
  }

  let ack: ContentScriptAck;
  try {
    runContentScriptCommand(command);
    ack = { ok: true, error: null };
  } catch (error) {
    ack = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  sendResponse(ack);
  return false;
}

bootstrapContentScript();
