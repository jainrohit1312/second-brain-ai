import { contentHash, dedupeKey } from '@second-brain/shared';

import type { ActivityEventType } from '@second-brain/shared';

/**
 * Content-hash deduplication.
 *
 * Two layers, because neither alone is enough: a hash of the content (the same article
 * read twice produces the same key) plus a short-lived in-memory ring of keys already
 * seen by this worker, which suppresses the burst of near-identical events that SPA
 * re-renders and repeated selections produce before anything reaches the server.
 */

/** Everything needed to identify "the same content, again". */
export interface ContentDedupeInput {
  type: ActivityEventType;
  /** Canonicalized page URL; null for events that are not URL-bound, e.g. app sessions. */
  url: string | null;
  /** Page title, used only when there is no body text to hash. */
  title: string | null;
  /** Extracted body text or selection text; hashed and never stored in the queue. */
  text: string | null;
  /** ISO timestamp of the capture, bucketed before hashing so re-renders collapse. */
  occurredAt: string;
}

/**
 * Lower bound the ingestion API enforces on `dedupeKey`. Not a tuning knob.
 */
export const DEDUPE_KEY_MIN_LENGTH = 8;
/** Upper bound the ingestion API enforces on `dedupeKey`. Not a tuning knob. */
export const DEDUPE_KEY_MAX_LENGTH = 128;

/**
 * Stable dedupe key for one activity event.
 *
 * The key is `<identity>:<content>`, where the identity half comes from the shared
 * `dedupeKey` (type + minute bucket + canonicalized url, or the title when there is no
 * url) and the content half is `contentHash` of the body text.
 *
 * What the server does with it, precisely: it enforces uniqueness on
 * `(device_id, dedupe_key)` and checks that the length falls inside
 * [{@link DEDUPE_KEY_MIN_LENGTH}, {@link DEDUPE_KEY_MAX_LENGTH}]. It does **not**
 * recompute the key. So this function's contract is only "stable for the same content,
 * different for different content, and inside the length bounds" — it is not a value the
 * server can be asked to reproduce. The structural length is fixed by construction
 * (`type` ≤ 13 chars, minute bucket ≤ 10 digits, two 16-hex digests, three separators),
 * so it lands between 48 and 65 characters and can never breach either bound.
 */
export function contentDedupeKey(input: ContentDedupeInput): string {
  const identity = dedupeKey({
    type: input.type,
    occurredAt: input.occurredAt,
    url: input.url,
    // The title is the fallback identity for events with no URL, and the fallback body
    // when there is no extracted text — one field, both roles, because that is what the
    // server has to work with when it decides whether two rows are the same event.
    discriminator: input.title,
  });

  const body = contentHash(input.text ?? input.title ?? '');
  return `${identity}:${body}`;
}

/** Default ring size: a few page-loads' worth of keys at a few events per load. */
export const RECENT_KEY_RING_CAPACITY = 2_000;

/**
 * Bounded LRU of recently seen dedupe keys.
 *
 * In-memory by design: the ring only has to absorb the burst a render loop produces, and
 * it is expected to be empty after a worker restart. Cross-restart duplicates are caught
 * by the server on `dedupeKey`, so losing the ring costs a redundant network round-trip,
 * never a duplicate row.
 *
 * Backed by a `Map`, whose iteration order is insertion order — which is exactly LRU
 * order once every access deletes and re-inserts. A `Set` would track membership without
 * being able to evict the right entry.
 */
export class RecentKeyRing {
  readonly capacity: number;

  /** Key → nothing. The value is irrelevant; the *order* is the data structure. */
  readonly #keys = new Map<string, true>();

  constructor(capacity: number = RECENT_KEY_RING_CAPACITY) {
    this.capacity = capacity;
  }

  /** Number of keys currently held; exposed for tests and diagnostics. */
  get size(): number {
    return this.#keys.size;
  }

  /** True when the key was added recently and is still held in the ring. */
  has(key: string): boolean {
    if (!this.#keys.delete(key)) {
      return false;
    }
    // Re-insert so the entry becomes the most recently used one.
    this.#keys.set(key, true);
    return true;
  }

  /** Records a key, evicting the least recently used entry once `capacity` is exceeded. */
  add(key: string): void {
    this.#keys.delete(key);
    this.#keys.set(key, true);

    while (this.#keys.size > Math.max(0, this.capacity)) {
      const oldest = this.#keys.keys().next();
      if (oldest.done === true) {
        return;
      }
      this.#keys.delete(oldest.value);
    }
  }

  /** Empties the ring; called when the user clears local capture state. */
  clear(): void {
    this.#keys.clear();
  }
}
