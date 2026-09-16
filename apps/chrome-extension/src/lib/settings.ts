/**
 * Local settings, counters, and the typed accessors around them.
 *
 * Purpose: one place that knows the names and JSON encoding of everything the extension
 * keeps in `chrome.storage.local`, so the content script, the service worker, and the
 * popup cannot disagree about a key. Phase 1a scope: the capture toggle, the idle pause
 * flag, the Phase 1a exclusion list, the last sync outcome, and the local drop counter.
 * User settings tables (`user_settings`) are not wired yet — these keys are the stand-in.
 */
import { ChromeLocalStorage } from './storage';

import type { SyncOutcome } from '@/types/events';

const storage = new ChromeLocalStorage();

/** Logical storage keys, without the adapter's `sb:` prefix. */
export const SETTING_KEYS = {
  /** User-facing capture switch; the only toggle the popup writes. */
  captureEnabled: 'capture-enabled',
  /** Set by the worker while the machine is idle or locked; distinct from the user switch. */
  capturePaused: 'capture-paused',
  /** Domains the user excluded, as a JSON array of hostnames. */
  excludedDomains: 'excluded-domains',
  /** Last {@link SyncOutcome}, written by the drain and read by the popup. */
  lastSync: 'last-sync',
  /** Monotonic count of events dropped locally (below threshold, duplicate, over capacity). */
  droppedCount: 'dropped-count',
  /** Phase 1a device id; see `lib/device.ts`. */
  deviceId: 'device-id',
  /** Phase 1a device identity record; see `lib/device.ts`. */
  deviceIdentity: 'device',
} as const;

/** Union of the logical storage keys. */
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Reads and JSON-decodes one setting, falling back when it is absent or corrupt. */
export async function readSetting<T>(key: SettingKey, fallback: T): Promise<T> {
  const raw = await storage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt value is treated as absent rather than fatal: a broken counter must not
    // stop capture.
    return fallback;
  }
}

/** JSON-encodes and writes one setting. */
export async function writeSetting(key: SettingKey, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value));
}

/** Removes one setting. Does not throw when it was never written. */
export async function removeSetting(key: SettingKey): Promise<void> {
  await storage.removeItem(key);
}

/** Whether capture is on. Defaults to on: an unconfigured install should capture. */
export async function readCaptureEnabled(): Promise<boolean> {
  return readSetting<boolean>(SETTING_KEYS.captureEnabled, true);
}

/** Persists the user's capture switch. */
export async function writeCaptureEnabled(enabled: boolean): Promise<void> {
  await writeSetting(SETTING_KEYS.captureEnabled, enabled);
}

/** Whether the worker paused capture for idle/lock. Defaults to off. */
export async function readCapturePaused(): Promise<boolean> {
  return readSetting<boolean>(SETTING_KEYS.capturePaused, false);
}

/** Sets the idle/lock pause flag. */
export async function writeCapturePaused(paused: boolean): Promise<void> {
  await writeSetting(SETTING_KEYS.capturePaused, paused);
}

/** Hostnames the user excluded, lowercased. Anything malformed is ignored. */
export async function readExcludedDomains(): Promise<string[]> {
  const value = await readSetting<unknown>(SETTING_KEYS.excludedDomains, []);
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());
}

/** The last drain outcome, or null before the first one. */
export async function readLastSync(): Promise<SyncOutcome | null> {
  const value = await readSetting<unknown>(SETTING_KEYS.lastSync, null);
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<SyncOutcome>;
  return typeof candidate.status === 'string' ? (candidate as SyncOutcome) : null;
}

/** Records the outcome of a drain for the popup. */
export async function writeLastSync(outcome: SyncOutcome): Promise<void> {
  await writeSetting(SETTING_KEYS.lastSync, outcome);
}

/** Events dropped locally since install. */
export async function readDroppedCount(): Promise<number> {
  const value = await readSetting<unknown>(SETTING_KEYS.droppedCount, 0);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Adds to the local drop counter and resolves with the new total.
 *
 * Read-modify-write, so two concurrent bumps can lose one increment. Acceptable for a
 * display counter; it is not used for any decision.
 */
export async function bumpDroppedCount(delta = 1): Promise<number> {
  const next = (await readDroppedCount()) + delta;
  await writeSetting(SETTING_KEYS.droppedCount, next);
  return next;
}

/**
 * Calls `handler` whenever one setting changes in `chrome.storage.local`, from any
 * extension context. Returns an unsubscribe function.
 *
 * The handler receives the *decoded* value — the same value `writeSetting` was given — not
 * the JSON string that is actually stored. Values are stored as JSON, so passing the raw
 * `newValue` through would hand every listener a string it has to remember to parse.
 *
 * Used by the content script to notice the capture toggle, the idle pause flag, and an
 * exclusion-list edit, and by the popup to refresh its numbers when the worker writes
 * `last-sync`.
 */
export function onSettingChanged(
  key: SettingKey,
  handler: (newValue: unknown) => void,
): () => void {
  const storageKey = storage.storageKey(key);
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'local') {
      return;
    }
    const change = changes[storageKey];
    if (change === undefined) {
      return;
    }
    handler(decodeSettingValue(change.newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** JSON-decodes a raw stored value; anything unparsable comes back as null. */
function decodeSettingValue(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
