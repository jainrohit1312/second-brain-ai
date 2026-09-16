/**
 * `chrome.storage.local` adapter.
 *
 * Purpose: give the Supabase auth client a durable, asynchronous key/value store that
 * works inside an MV3 service worker, where `localStorage` does not exist and a module
 * variable does not survive eviction. Phase 1a scope: session persistence and the
 * extension's own settings/counters. The capture queue does *not* use this — it needs
 * indexes and transactions, which `chrome.storage` cannot provide (see
 * `background/queue.ts`).
 *
 * Note on the `sb:` prefix: `chrome.storage.local` is already partitioned per extension,
 * so the prefix is not what keeps us away from other extensions. It keeps this
 * extension's keys grouped in one greppable namespace and gives `onSettingChanged` a
 * single prefix to match on.
 */

/** Asynchronous key/value store; structurally compatible with Supabase's `SupportedStorage`. */
export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Prefix applied to every logical key before it reaches `chrome.storage.local`. */
export const STORAGE_KEY_PREFIX = 'sb:';

/**
 * Storage key Supabase persists the auth session under. Lives here rather than in
 * `auth.ts` so that `supabase.ts` can read it without importing `auth.ts` — that would
 * be a cycle, since `auth.ts` builds its client through `supabase.ts`.
 *
 * The adapter prefixes it, so the on-disk key is `sb:sb-auth-token`. The doubled prefix
 * is cosmetic: the value never leaves this extension's storage partition.
 */
export const AUTH_STORAGE_KEY = 'sb-auth-token';

/** Suffix Supabase appends to the storage key for the PKCE code verifier. */
export const AUTH_CODE_VERIFIER_SUFFIX = '-code-verifier';

/** Returns the storage area, or throws a clear error when the extension context is absent. */
function requireLocalArea(): chrome.storage.StorageArea {
  // Deliberately no in-memory fallback: a missing chrome.storage means the code is
  // running somewhere it was never meant to run, and a silent Map would hide that
  // until a user's session failed to persist.
  const area: chrome.storage.StorageArea | undefined = chrome?.storage?.local;
  if (!area) {
    throw new Error(
      'chrome.storage.local is unavailable in this context. This adapter only works ' +
        'inside the extension (service worker, popup, side panel, or content script).',
    );
  }
  return area;
}

/** Rethrows a pending `chrome.runtime.lastError` as a real error. */
function assertNoRuntimeError(operation: string, key: string): void {
  const lastError: chrome.runtime.LastError | undefined = chrome?.runtime?.lastError;
  if (lastError) {
    throw new Error(`chrome.storage.local ${operation} failed for "${key}": ${lastError.message}`);
  }
}

/** `chrome.storage.local` behind {@link AsyncKeyValueStorage}. */
export class ChromeLocalStorage implements AsyncKeyValueStorage {
  constructor(readonly prefix: string = STORAGE_KEY_PREFIX) {}

  /** Maps a logical key onto its namespaced storage key. */
  storageKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /** Reads a string, or null when the key is absent or holds a non-string value. */
  async getItem(key: string): Promise<string | null> {
    const area = requireLocalArea();
    const storageKey = this.storageKey(key);
    const values = (await area.get(storageKey)) as Record<string, unknown>;
    assertNoRuntimeError('get', storageKey);
    const value = values[storageKey];
    return typeof value === 'string' ? value : null;
  }

  /** Writes a string. Overwrite semantics, exactly like `localStorage.setItem`. */
  async setItem(key: string, value: string): Promise<void> {
    const area = requireLocalArea();
    const storageKey = this.storageKey(key);
    await area.set({ [storageKey]: value });
    assertNoRuntimeError('set', storageKey);
  }

  /** Removes a key. Resolves whether or not the key existed. */
  async removeItem(key: string): Promise<void> {
    const area = requireLocalArea();
    const storageKey = this.storageKey(key);
    await area.remove(storageKey);
    assertNoRuntimeError('remove', storageKey);
  }
}
