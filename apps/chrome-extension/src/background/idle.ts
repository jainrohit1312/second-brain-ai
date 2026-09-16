/**
 * Idle detection.
 *
 * Chrome reports idle transitions on the OS input clock, so this module answers a
 * different question than the content scripts do: not "is this tab visible" but "has the
 * person stopped using the machine". On `idle` or `locked` the worker flushes the queue
 * and stops enqueueing; on `active` capture resumes.
 *
 * Scope: the listener handle is module state, which the service worker's eviction rules
 * normally forbid for anything durable. It is not durable — it is a handle to a listener
 * this module registered, and after an eviction the listener is gone too, so the freshly
 * evaluated module starting with `null` is the correct state, not a lost one.
 */

/** How often Chrome polls the OS idle clock; also the resolution of state transitions. */
export const IDLE_DETECTION_INTERVAL_SECONDS = 60;
/** Seconds without input before Chrome reports `idle`; mirrors IDLE_FLUSH_DELAY_SECONDS. */
export const IDLE_THRESHOLD_SECONDS = 60;
/** State reported when the extension cannot reach the idle API, e.g. no `idle` permission. */
export const IDLE_FALLBACK_STATE = 'active';

/** Mirrors `chrome.idle.IdleState` so listeners can be typed without the ambient namespace. */
export type IdleBucket = 'active' | 'idle' | 'locked';

/** Callbacks invoked on idle transitions; all are optional. */
export interface IdleHandlers {
  /** Input resumed: clear the pause flag and restart capture. */
  onActive?: () => void;
  /** No input for {@link IDLE_THRESHOLD_SECONDS}: flush the queue and pause capture. */
  onIdle?: () => void;
  /** Screen locked: same as idle, but the machine may be suspended before the flush ends. */
  onLocked?: () => void;
}

/** The single listener currently registered, so {@link stopIdleWatch} can remove it. */
let registeredListener: ((state: chrome.idle.IdleState) => void) | null = null;

/** Narrows Chrome's idle state to {@link IdleBucket}, defaulting to `active` when unknown. */
function toIdleBucket(state: string): IdleBucket {
  if (state === 'idle' || state === 'locked') {
    return state;
  }
  return 'active';
}

/**
 * Starts idle detection and resolves with an unsubscribe function the caller must call
 * on `chrome.runtime.onSuspend`.
 *
 * Calling it twice replaces the previous registration rather than adding a second
 * listener, which is what keeps a worker that woke twice on `onStartup` from flushing
 * twice per transition.
 */
export function startIdleWatch(handlers: IdleHandlers): () => void {
  const listener = (state: chrome.idle.IdleState): void => {
    const bucket = toIdleBucket(state);
    if (bucket === 'active') {
      handlers.onActive?.();
      return;
    }
    if (bucket === 'locked') {
      handlers.onLocked?.();
      return;
    }
    handlers.onIdle?.();
  };

  stopIdleWatch();

  try {
    chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);
    chrome.idle.onStateChanged.addListener(listener);
    registeredListener = listener;
  } catch (error) {
    // Without the `idle` permission there is nothing to watch. Capture then behaves as if
    // the user were always active, which is the safe direction: it captures too much
    // rather than nothing at all.
    console.warn('[second-brain] idle detection is unavailable', error);
    return () => {
      // Nothing was registered.
    };
  }

  return () => {
    if (registeredListener === listener) {
      stopIdleWatch();
    }
  };
}

/** Removes the idle listener registered by {@link startIdleWatch}; safe to call twice. */
export function stopIdleWatch(): void {
  if (registeredListener === null) {
    return;
  }
  try {
    chrome.idle.onStateChanged.removeListener(registeredListener);
  } catch (error) {
    console.warn('[second-brain] could not remove the idle listener', error);
  }
  registeredListener = null;
}

/** Reads the current idle bucket on demand, for callers that missed a transition. */
export async function queryIdleState(): Promise<IdleBucket> {
  try {
    return toIdleBucket(await chrome.idle.queryState(IDLE_DETECTION_INTERVAL_SECONDS));
  } catch (error) {
    console.warn('[second-brain] cannot query the idle state', error);
    return IDLE_FALLBACK_STATE;
  }
}

/**
 * Whether an idle/locked transition should trigger a flush now, given the last flush
 * time. Rate-limits flushes so lock/unlock churn cannot starve the network.
 */
export function isIdleFlushDue(state: IdleBucket, lastFlushAt: string | null): boolean {
  if (state === 'active') {
    return false;
  }
  if (lastFlushAt === null) {
    return true;
  }
  const parsed = Date.parse(lastFlushAt);
  if (Number.isNaN(parsed)) {
    return true;
  }
  // The detection interval is the resolution of the idle clock, so a flush within one
  // interval of the previous one cannot be a new idle period.
  return Date.now() - parsed >= IDLE_DETECTION_INTERVAL_SECONDS * 1_000;
}
