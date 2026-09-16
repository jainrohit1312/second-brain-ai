import { assertNever, clamp, extractDomain, wordCount } from '@second-brain/shared';

import { parseContentScriptCommandValue, sendRuntimeMessage } from '@/lib/messages';
import { scoreLocally } from '@/lib/scoring';
import { SETTING_KEYS, onSettingChanged, readCaptureEnabled, readCapturePaused } from '@/lib/settings';
import { deriveSignals } from '@/lib/signals';

import { EXCLUDED_DOMAINS_SETTING, isExcludedOrigin, refreshExcludedDomains } from './exclusions';
import { extractReadableDocument, hasEnoughContent } from './extractor';
import { buildPageViewDraft } from './page-view';
import { createSelectionObserver, getCurrentSelection } from './selection';
import { buildCopyDraft, buildSelectionDraft } from './selection-draft';

import type { CaptureDecision, CapturedEventDraft, ContentScriptAck, ContentScriptCommand, DocumentDraft, FlushReason } from '@/types/events';

/**
 * Content script entry point.
 *
 * Runs in the isolated world once per frame, after `document_idle`, in every http/https
 * page. It owns capture: it observes the document, builds drafts, and forwards them to the
 * service worker over `chrome.runtime.sendMessage`, which is the only channel it has.
 * Scoring, deduplication, and queueing all happen in the worker, so this file stays small
 * enough to run on every page without a measurable cost to the user's browsing.
 *
 * Scope: `page_view`, emitted when the page is left — hidden, navigated away from, or replaced
 * by an SPA route change — plus `selection` and `copy`, emitted by the debounced observer and
 * the `copy` listener through `./selection-draft`, plus a `DOCUMENT_CAPTURED` carrying the
 * extracted page body when the visit earns it (see `captureDocument`). Video is contracts only
 * and is not wired in yet.
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

/**
 * Dwell after which a page's body is worth extracting even when it scored below
 * {@link EXTRACTION_SCORE_THRESHOLD}: long enough that the user was reading rather than
 * skimming past.
 */
export const EXTRACTION_DWELL_MS = 15_000;

/**
 * Page-view score at or above which a page's body is worth extracting.
 *
 * Higher than `DEFAULT_CAPTURE_THRESHOLD` (0.15, the bar for queueing the page view itself),
 * because the two decisions cost very different things: recording a view is a row, while
 * extracting is a Readability parse of the entire document on the page-hide path, against a
 * document that is about to be torn down.
 */
export const EXTRACTION_SCORE_THRESHOLD = 0.3;

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
/**
 * Tears down the selection observer, or null when it is not running.
 *
 * Held so the observer can be stopped as well as started. `createSelectionObserver`
 * returns its own unbind, and a content script that kept it listening while capture was
 * off would read every selection on the page in order to build a draft the worker then
 * throws away — work on the hottest path in the extension, for no result.
 */
let disposeSelectionObserver: (() => void) | null = null;
/**
 * Set once this document has been offered to the extractor, so a document is extracted at most
 * once. Reset never: a new visit to the same document is still the same page.
 */
let extractionRan = false;
/**
 * Set when a selection or a copy happens on this page, which is one of the three things that
 * make its body worth extracting.
 *
 * Held as state rather than derived at page-hide time because it is an *event*, not a property
 * of the visit: by the time the document is going away there is nothing left to observe that
 * would tell us it happened.
 */
let selectionOrCopyObserved = false;
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
  startSelectionObserver();
  startCopyListener();
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

/** Applies the capture switch locally: discards the visit and unbinds the selection and
 * copy listeners, or starts them again. */
function applyCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled;
  if (!enabled) {
    visit = null;
    stopSelectionObserver();
    stopCopyListener();
    return;
  }
  if (visit === null) {
    startVisit();
  }
  startSelectionObserver();
  startCopyListener();
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
 * Starts watching for settled selections, if the observer is not already running.
 *
 * A selection is the highest-signal thing a page produces and the most sensitive, so the
 * observer is bound and unbound with the capture switch rather than left listening. The
 * privacy rule itself lives in `selection.ts` — `getCurrentSelection` returns null for an
 * excluded origin, for a selection under `MIN_SELECTION_CHARS`, and for a selection inside
 * a form control or a contenteditable region — so nothing here re-checks any of it.
 *
 * No score is computed here, and none is consulted: `selection` is an
 * `EXPLICIT_INTENT_EVENT_TYPES` member, so the worker queues it even when its score would
 * fall below the noise threshold.
 */
function startSelectionObserver(): void {
  if (disposeSelectionObserver !== null) {
    return;
  }

  disposeSelectionObserver = createSelectionObserver((payload) => {
    // A selection is one of the three things that make this page's body worth extracting, and
    // it is the criterion that does not depend on how long the visit lasts or how it scores:
    // the user singled out a passage, and the text around it is what makes that passage
    // interpretable later.
    selectionOrCopyObserved = true;
    // Stamped here rather than inside the builder: the observer debounces, so this is the
    // only point that knows when the selection settled.
    reportCapturedEvent(buildSelectionDraft(payload, new Date().toISOString()));
  });
}

/** Unbinds the selection observer. Safe to call when it is not running. */
function stopSelectionObserver(): void {
  if (disposeSelectionObserver === null) {
    return;
  }
  disposeSelectionObserver();
  disposeSelectionObserver = null;
}

/**
 * Handles a `copy` event: one `copy` draft for the passage being copied.
 *
 * `getCurrentSelection` is reused unchanged rather than reimplemented against the clipboard,
 * because the privacy rule has to be identical — an excluded origin, a selection under the
 * length floor, and a selection inside a form control or a contenteditable region all return
 * null, and a copy has no business recording anything a selection would not.
 *
 * The event's own clipboard payload is never read. `window.getSelection()` describes what the
 * user highlighted; a `ClipboardEvent`'s serialised data is a different thing, and reaching
 * for it would capture text the user may yet cancel.
 */
function onCopyHandler(): void {
  const selection = getCurrentSelection();
  if (selection === null) {
    return;
  }

  // Set before the draft, not after: a copy is the extraction criterion, and it holds whether
  // or not the draft below clears the copy builder's length floor.
  selectionOrCopyObserved = true;

  const draft = buildCopyDraft({
    text: selection.text,
    url: selection.url,
    title: selection.title,
    occurredAt: new Date().toISOString(),
  });
  if (draft !== null) {
    reportCapturedEvent(draft);
  }
}

/**
 * Starts listening for copies.
 *
 * No guard flag here, unlike the selection observer: `onCopyHandler` is a top-level function,
 * so the DOM's own rule — a listener is not registered twice when its type, its function and
 * its capture flag all match — already makes this idempotent. `createSelectionObserver` needed
 * a flag only because it hands back a freshly created closure on each call.
 */
function startCopyListener(): void {
  document.addEventListener('copy', onCopyHandler);
}

/** Stops listening for copies. Safe to call when it is not listening. */
function stopCopyListener(): void {
  document.removeEventListener('copy', onCopyHandler);
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
  const occurredAt = new Date(now).toISOString();

  const draft = buildPageViewDraft({
    url: active.url,
    title: active.title,
    domain: active.domain,
    dwellMs,
    scrollDepthPct: maxScrollDepthPct,
    occurredAt,
  });

  // Offered the draft above the dwell floor, not below it. The two decisions answer different
  // questions: `MIN_PAGE_DWELL_MS` asks whether the visit is worth *reporting*, while
  // extraction eligibility asks whether the text is worth *keeping* — and a selection made two
  // seconds in is exactly the case the selection criterion exists for. Both sit after the
  // exclusion check, so an excluded page still produces nothing at all.
  await captureDocument(draft, dwellMs, occurredAt);

  if (dwellMs < MIN_PAGE_DWELL_MS) {
    console.debug('[second-brain] not capturing a visit shorter than the minimum dwell');
    return;
  }

  const decision = await deliverDraft(draft);
  if (decision?.queued === true) {
    // The page is going away or the user moved on: get the event out now instead of
    // waiting for the next alarm. The worker decides whether the queue has room to care.
    await requestFlush('tab-hidden');
  }
}

/**
 * Whether this visit's body is worth extracting, decided once the visit is ending.
 *
 * Lazy for two of the three criteria, deliberately: dwell and score are properties of the
 * whole visit, so tracking them eagerly would mean recomputing a score on every scroll and
 * keystroke for a decision that is read exactly once, on a path where the document is about to
 * disappear. The third criterion cannot be derived here at all — that a selection or copy
 * *happened* is an event rather than a property — which is why `selectionOrCopyObserved` is
 * set by the two capture paths as they fire.
 *
 * The score comes from the same `deriveSignals`/`scoreLocally` pair the worker uses, so this
 * gate can never disagree with the score the worker goes on to store for the same draft.
 */
function isExtractionEligible(draft: CapturedEventDraft, dwellMs: number): boolean {
  if (selectionOrCopyObserved) {
    return true;
  }
  if (dwellMs >= EXTRACTION_DWELL_MS) {
    return true;
  }
  return scoreLocally(deriveSignals(draft, new Date())).value >= EXTRACTION_SCORE_THRESHOLD;
}

/**
 * Extracts the page body and sends it as a document, when this visit earns it.
 *
 * Best-effort by construction, and the only place in the capture path where that is true: a
 * failure here is logged and dropped rather than retried, because a page Readability cannot
 * parse is not something the user needs to hear about, and a retry would re-run the parse
 * against a document that is already on its way out. `visit` is cleared before this runs, so a
 * second hide event for the same visit finds nothing to finish and the retry cannot happen
 * anyway.
 *
 * The clone is not repeated here: `extractReadableDocument` clones internally, because
 * Readability mutates the document it is handed and this runs while the user's page is still on
 * screen. Cloning first as well would work, and would read the whole document twice.
 */
async function captureDocument(
  draft: CapturedEventDraft,
  dwellMs: number,
  occurredAt: string,
): Promise<void> {
  if (extractionRan) {
    return;
  }
  if (!isExtractionEligible(draft, dwellMs)) {
    return;
  }

  try {
    const extracted = extractReadableDocument(document);
    if (extracted === null || !hasEnoughContent(extracted)) {
      console.debug('[second-brain] this page has no readable content to extract');
      return;
    }

    const documentDraft: DocumentDraft = {
      url: location.href,
      // Readability already falls back to the document title internally; this repeats the
      // fallback for the case where its own fallback produced an empty string.
      title: extracted.title || document.title,
      content: extracted.textContent,
      language: extracted.language ?? null,
      source: 'web',
      wordCount: wordCount(extracted.textContent),
      occurredAt,
    };

    await sendRuntimeMessage({ type: 'DOCUMENT_CAPTURED', document: documentDraft });
    extractionRan = true;
  } catch (error) {
    console.warn('[second-brain] extraction failed', error);
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
    // Dead paths in Phase 1b-1, retained deliberately. Selection and extraction are
    // push-based: the selection observer and the copy listener call reportCapturedEvent()
    // directly, so nothing drives these two commands, and the video watch flush has no
    // accumulator behind it yet. The branches stay for the manual triggers TASKS.md still
    // anticipates — a keyboard shortcut, a context menu — and currently do nothing.
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
