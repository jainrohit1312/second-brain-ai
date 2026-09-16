import type { ActivityEvent } from '@second-brain/shared';

/** IndexedDB database holding the durable outbound queue. */
export const QUEUE_DB_NAME = 'second-brain-queue';
/** Object store inside {@link QUEUE_DB_NAME}; one record per queued event, keyed by event id. */
export const QUEUE_STORE_NAME = 'events';
/** Schema version of the IndexedDB database; bump together with every store change. */
export const QUEUE_DB_VERSION = 1;
/** Default `peekBatch` page size; the ingestion API rejects batches larger than 100. */
export const DEFAULT_BATCH_LIMIT = 100;
/** Events older than this are pruned during a flush; 7 days. */
export const DEFAULT_MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/** Hard depth cap. Above it the lowest-scoring events are evicted first. */
export const MAX_QUEUE_DEPTH = 20_000;

/** Non-unique index on `queuedAt`; the drain reads it ascending, the status view descending. */
export const QUEUE_QUEUED_AT_INDEX = 'queuedAt';

/**
 * An activity event plus the delivery bookkeeping the queue needs. `id` mirrors
 * `event.id` so the object store key and the domain id cannot diverge.
 */
export interface QueuedEvent {
  id: string;
  event: ActivityEvent;
  /** ISO timestamp of the enqueue; drives FIFO order and age pruning. */
  queuedAt: string;
  /** Failed sync attempts so far; drives backoff and the give-up rule. */
  attempts: number;
  /** ISO timestamp of the last attempt; null while the event is still pristine. */
  lastAttemptAt: string | null;
}

/**
 * Durable outbound queue for captured events.
 *
 * Durability contract: once `enqueue` resolves, the event MUST survive service-worker
 * termination, browser restart, and crash — which is why the only shipped
 * implementation is IndexedDB-backed and not an in-memory array. Delivery is
 * at-least-once: `acknowledge` is the sole signal that the server has durably accepted
 * a batch, so a crash between sending and acknowledging re-sends the batch and the
 * server discards the repeats by `dedupeKey`.
 */
export interface QueueStore {
  /** Persists one event and resolves with the stored record; no-op if `event.id` is known. */
  enqueue(event: ActivityEvent): Promise<QueuedEvent>;
  /** Returns up to `limit` oldest unacknowledged events without mutating the queue. */
  peekBatch(limit: number): Promise<QueuedEvent[]>;
  /**
   * Returns up to `limit` newest queued events, newest first, without mutating anything.
   *
   * Not needed to drain — `peekBatch` does that — but required for the popup's "newest"
   * statistic, which the ascending read cannot answer without walking the whole store.
   */
  peekNewest(limit: number): Promise<QueuedEvent[]>;
  /** Removes the given ids and resolves with the number of records actually deleted. */
  acknowledge(ids: readonly string[]): Promise<number>;
  /** Number of events currently waiting. */
  size(): Promise<number>;
  /** Drops every queued event; callers must confirm with the user first. */
  clear(): Promise<void>;
  /** Drops events queued longer ago than `ms` and resolves with the number removed. */
  pruneOlderThan(ms: number): Promise<number>;
}

/** Opens (and upgrades) the queue database: one object store keyed by id, one `queuedAt` index. */
function openQueueDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this context; the queue cannot open.'));
      return;
    }

    const request = indexedDB.open(dbName, QUEUE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(storeName)) {
        return;
      }
      const store = db.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex(QUEUE_QUEUED_AT_INDEX, 'queuedAt', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Cannot open ${dbName}`));
    request.onblocked = () =>
      reject(new Error(`Cannot open ${dbName}: an older connection is still holding it`));
  });
}

/** Promisifies one IndexedDB request. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when a transaction commits, rejects when it errors or aborts. */
function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Reads up to `limit` records off a cursor, in the cursor's own direction. */
function readCursor(
  store: IDBObjectStore,
  limit: number,
  direction: IDBCursorDirection,
  indexName?: string,
): Promise<QueuedEvent[]> {
  return new Promise<QueuedEvent[]>((resolve, reject) => {
    if (limit <= 0) {
      resolve([]);
      return;
    }

    const source: IDBIndex | IDBObjectStore =
      indexName === undefined ? store : store.index(indexName);
    const collected: QueuedEvent[] = [];
    const request = source.openCursor(null, direction);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || collected.length >= limit) {
        resolve(collected);
        return;
      }
      collected.push(cursor.value as QueuedEvent);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
  });
}

/**
 * IndexedDB-backed {@link QueueStore}.
 *
 * The connection is opened lazily on first use and held for the life of the instance: an
 * MV3 worker can be evicted between any two calls, so durability lives in the database and
 * never in worker memory — but *not* holding the handle would open a fresh connection per
 * operation and leave the abandoned ones behind, which eventually blocks upgrades. The
 * handle is dropped on `versionchange` (so another context can upgrade) and on an
 * unexpected close, and reopened on the next call.
 */
export class IndexedDbQueue implements QueueStore {
  #connection: Promise<IDBDatabase> | null = null;

  constructor(
    readonly dbName: string = QUEUE_DB_NAME,
    readonly storeName: string = QUEUE_STORE_NAME,
  ) {}

  async enqueue(event: ActivityEvent): Promise<QueuedEvent> {
    const db = await this.#open();
    const record: QueuedEvent = {
      id: event.id,
      event,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastAttemptAt: null,
    };

    const stored = await new Promise<QueuedEvent>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      // Defaults to the record we are about to write; replaced by the existing one when the
      // id is already known, which makes `enqueue` idempotent without resetting `queuedAt`.
      let result: QueuedEvent = record;

      const lookup = store.get(record.id);
      lookup.onsuccess = () => {
        const existing = lookup.result as QueuedEvent | undefined;
        if (existing !== undefined) {
          result = existing;
          return;
        }
        store.put(record);
      };
      lookup.onerror = () => reject(lookup.error ?? new Error('Queue lookup failed'));

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Queue write failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Queue write aborted'));
    });

    await this.#evictOverCapacity();
    return stored;
  }

  async peekBatch(limit: number): Promise<QueuedEvent[]> {
    const db = await this.#open();
    const transaction = db.transaction(this.storeName, 'readonly');
    return readCursor(
      transaction.objectStore(this.storeName),
      limit,
      'next',
      QUEUE_QUEUED_AT_INDEX,
    );
  }

  async peekNewest(limit: number): Promise<QueuedEvent[]> {
    const db = await this.#open();
    const transaction = db.transaction(this.storeName, 'readonly');
    return readCursor(transaction.objectStore(this.storeName), limit, 'prev');
  }

  async acknowledge(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const db = await this.#open();
    let deleted = 0;

    const transaction = db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);

    for (const id of ids) {
      // `delete` succeeds whether or not the key exists, so presence has to be established
      // first for the count to mean "records actually removed".
      const lookup = store.getKey(id);
      lookup.onsuccess = () => {
        if (lookup.result === undefined) {
          return;
        }
        const removal = store.delete(id);
        removal.onsuccess = () => {
          deleted += 1;
        };
      };
    }

    await transactionToPromise(transaction);
    return deleted;
  }

  async size(): Promise<number> {
    const db = await this.#open();
    const transaction = db.transaction(this.storeName, 'readonly');
    const count = await requestToPromise(transaction.objectStore(this.storeName).count());
    return count;
  }

  async clear(): Promise<void> {
    const db = await this.#open();
    const transaction = db.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).clear();
    await transactionToPromise(transaction);
  }

  async pruneOlderThan(ms: number): Promise<number> {
    const cutoff = new Date(Date.now() - ms).toISOString();
    const db = await this.#open();
    let removed = 0;

    const transaction = db.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    // ISO-8601 timestamps sort lexicographically in the same order as chronologically, so
    // the index range is exactly "everything queued before the cutoff".
    const range = IDBKeyRange.upperBound(cutoff, true);
    const request = store.index(QUEUE_QUEUED_AT_INDEX).openCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        return;
      }
      const removal = cursor.delete();
      removal.onsuccess = () => {
        removed += 1;
      };
      cursor.continue();
    };

    await transactionToPromise(transaction);
    return removed;
  }

  /** Opens the connection once per instance, dropping it when the database is replaced. */
  #open(): Promise<IDBDatabase> {
    if (this.#connection === null) {
      this.#connection = openQueueDb(this.dbName, this.storeName)
        .then((db) => {
          db.onversionchange = () => {
            db.close();
            this.#connection = null;
          };
          db.onclose = () => {
            this.#connection = null;
          };
          return db;
        })
        .catch((error: unknown) => {
          this.#connection = null;
          throw error;
        });
    }
    return this.#connection;
  }

  /**
   * Drops the lowest-importance records while the store holds more than
   * {@link MAX_QUEUE_DEPTH}, and resolves with how many were removed.
   *
   * The count is taken first so the common case — under the cap — costs one `count()` and
   * no cursor walk. Worst case (the first insert past the cap) it is the only heavy pass:
   * the cap exists to bound memory and disk, not to run often.
   */
  async #evictOverCapacity(): Promise<number> {
    const db = await this.#open();

    return new Promise<number>((resolve, reject) => {
      let removed = 0;
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const overflow = countRequest.result - MAX_QUEUE_DEPTH;
        if (overflow <= 0) {
          return;
        }

        const candidates: Array<{ id: string; importance: number }> = [];
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            // Lowest importance first; ties fall back to insertion order because `sort` is
            // stable, so the older of two equally unimportant records goes first.
            candidates.sort((left, right) => left.importance - right.importance);
            for (const candidate of candidates.slice(0, overflow)) {
              const removal = store.delete(candidate.id);
              removal.onsuccess = () => {
                removed += 1;
              };
            }
            return;
          }
          const record = cursor.value as QueuedEvent;
          candidates.push({ id: record.id, importance: record.event.importance });
          cursor.continue();
        };
      };

      transaction.oncomplete = () => resolve(removed);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Queue eviction failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Queue eviction aborted'));
    });
  }
}
