import type { DocumentDraft } from '@/types/events';
import type { ActivityEvent } from '@second-brain/shared';

/** IndexedDB database holding the durable outbound queue. */
export const QUEUE_DB_NAME = 'second-brain-queue';
/** Object store inside {@link QUEUE_DB_NAME}; one record per queued event, keyed by event id. */
export const QUEUE_STORE_NAME = 'events';
/**
 * Object store inside {@link QUEUE_DB_NAME} holding queued document bodies, keyed by content
 * hash. A second store rather than a second database: one connection and one upgrade path,
 * and the two queues are drained together in a single batch.
 */
export const DOCUMENT_STORE_NAME = 'documents';
/**
 * Schema version of the IndexedDB database; bump together with every store change.
 *
 * Version 2 added the `documents` store. The upgrade creates a store only when it is
 * missing and never clears an existing one, so an install that already holds queued events
 * keeps every one of them.
 */
export const QUEUE_DB_VERSION = 2;
/** Default `peekBatch` page size; the ingestion API rejects batches larger than 100. */
export const DEFAULT_BATCH_LIMIT = 100;
/**
 * Default `peekDocumentBatch` page size. The ingestion contract caps documents at 5 per
 * batch — far below the event cap, because one document carries a whole page body where one
 * event carries an excerpt — so a larger page would be rejected rather than split.
 */
export const DEFAULT_DOCUMENT_BATCH_LIMIT = 5;
/** Events older than this are pruned during a flush; 7 days. Documents use the same age. */
export const DEFAULT_MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/** Hard depth cap. Above it the lowest-scoring events are evicted first. */
export const MAX_QUEUE_DEPTH = 20_000;

/** Non-unique index on `queuedAt`; the drain reads it ascending, the status view descending. */
export const QUEUE_QUEUED_AT_INDEX = 'queuedAt';

/**
 * Non-unique index on `queuedAt` in the document store. The drain reads it ascending, so a
 * `queuedAt`-ordered read is possible without the store's key order (content hash) leaking
 * into the batch order.
 */
export const DOCUMENT_QUEUED_AT_INDEX = 'queuedAt';

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
 * A captured document body plus the delivery bookkeeping the queue needs.
 *
 * `id` is the SHA-256 of `document.content`, so two captures of the same text collapse onto
 * one record instead of being sent twice. It is a **local** key only: the server's dedup
 * identity for a document is its own `contentHash` over the same text, computed server-side
 * precisely so a client cannot name it. The two values have the same job in different
 * places and nothing ever compares them.
 */
export interface QueuedDocument {
  id: string;
  document: DocumentDraft;
  /** ISO timestamp of the enqueue; drives FIFO order and age pruning. */
  queuedAt: string;
  /** Failed sync attempts so far. Documents are not retried selectively; kept for parity. */
  attempts: number;
  /** ISO timestamp of the last attempt; null while the document is still pristine. */
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

  /** Persists one document and resolves with the stored record; no-op if its id is known. */
  enqueueDocument(document: QueuedDocument): Promise<QueuedDocument>;
  /** Returns up to `limit` oldest unacknowledged documents without mutating the queue. */
  peekDocumentBatch(limit: number): Promise<QueuedDocument[]>;
  /** Removes the given document ids and resolves with the number of records actually deleted. */
  acknowledgeDocuments(ids: readonly string[]): Promise<number>;
  /** Number of documents currently waiting. */
  documentCount(): Promise<number>;
  /** Drops every queued document; callers must confirm with the user first. */
  clearDocuments(): Promise<void>;
  /** Drops documents queued longer ago than `ms` and resolves with the number removed. */
  pruneDocumentsOlderThan(ms: number): Promise<number>;
}

/** Creates one store and its `queuedAt` index, unless the store is already there. */
function ensureStore(db: IDBDatabase, storeName: string, queuedAtIndex: string): void {
  if (db.objectStoreNames.contains(storeName)) {
    return;
  }
  const store = db.createObjectStore(storeName, { keyPath: 'id' });
  store.createIndex(queuedAtIndex, 'queuedAt', { unique: false });
}

/**
 * Opens (and upgrades) the queue database: one object store per queue kind, each keyed by
 * `id` with its own `queuedAt` index.
 *
 * The upgrade is additive by construction — `ensureStore` only ever creates, and nothing is
 * ever cleared — so an upgrade from version 1, which held the events store alone, leaves
 * every queued event exactly where it was.
 */
function openQueueDb(
  dbName: string,
  eventStoreName: string,
  documentStoreName: string,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this context; the queue cannot open.'));
      return;
    }

    const request = indexedDB.open(dbName, QUEUE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      ensureStore(db, eventStoreName, QUEUE_QUEUED_AT_INDEX);
      ensureStore(db, documentStoreName, DOCUMENT_QUEUED_AT_INDEX);
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

/**
 * Reads up to `limit` records off a cursor, in the cursor's own direction.
 *
 * Generic over the record type because the same walk serves the event store and the document
 * store, which hold different shapes; what they share is the key and index layout, and that
 * is all this function depends on.
 */
function readCursor<T>(
  store: IDBObjectStore,
  limit: number,
  direction: IDBCursorDirection,
  indexName?: string,
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    if (limit <= 0) {
      resolve([]);
      return;
    }

    const source: IDBIndex | IDBObjectStore =
      indexName === undefined ? store : store.index(indexName);
    const collected: T[] = [];
    const request = source.openCursor(null, direction);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || collected.length >= limit) {
        resolve(collected);
        return;
      }
      collected.push(cursor.value as T);
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
    readonly documentStoreName: string = DOCUMENT_STORE_NAME,
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

  /**
   * Persists one document, or returns the record already stored under the same id.
   *
   * Idempotent for the same reason `enqueue` is, and by the same mechanism: an id that is
   * already present is returned untouched rather than re-written, so re-capturing text that
   * is still queued cannot move it to the back of the FIFO by resetting `queuedAt`.
   */
  async enqueueDocument(document: QueuedDocument): Promise<QueuedDocument> {
    const db = await this.#open();

    return new Promise<QueuedDocument>((resolve, reject) => {
      const transaction = db.transaction(this.documentStoreName, 'readwrite');
      const store = transaction.objectStore(this.documentStoreName);
      let result = document;

      const lookup = store.get(document.id);
      lookup.onsuccess = () => {
        const existing = lookup.result as QueuedDocument | undefined;
        if (existing !== undefined) {
          result = existing;
          return;
        }
        store.put(document);
      };
      lookup.onerror = () => reject(lookup.error ?? new Error('Document lookup failed'));

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Document write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Document write aborted'));
    });
  }

  async peekDocumentBatch(limit: number): Promise<QueuedDocument[]> {
    const db = await this.#open();
    const transaction = db.transaction(this.documentStoreName, 'readonly');
    return readCursor<QueuedDocument>(
      transaction.objectStore(this.documentStoreName),
      limit,
      'next',
      DOCUMENT_QUEUED_AT_INDEX,
    );
  }

  async acknowledgeDocuments(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const db = await this.#open();
    let deleted = 0;

    const transaction = db.transaction(this.documentStoreName, 'readwrite');
    const store = transaction.objectStore(this.documentStoreName);

    for (const id of ids) {
      // Same presence check as `acknowledge`: `delete` succeeds on a missing key, so the
      // count is only meaningful if the key was known to be there.
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

  async documentCount(): Promise<number> {
    const db = await this.#open();
    const transaction = db.transaction(this.documentStoreName, 'readonly');
    const count = await requestToPromise(transaction.objectStore(this.documentStoreName).count());
    return count;
  }

  async clearDocuments(): Promise<void> {
    const db = await this.#open();
    const transaction = db.transaction(this.documentStoreName, 'readwrite');
    transaction.objectStore(this.documentStoreName).clear();
    await transactionToPromise(transaction);
  }

  async pruneDocumentsOlderThan(ms: number): Promise<number> {
    const cutoff = new Date(Date.now() - ms).toISOString();
    const db = await this.#open();
    let removed = 0;

    const transaction = db.transaction(this.documentStoreName, 'readwrite');
    const store = transaction.objectStore(this.documentStoreName);
    const range = IDBKeyRange.upperBound(cutoff, true);
    const request = store.index(DOCUMENT_QUEUED_AT_INDEX).openCursor(range);

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
      this.#connection = openQueueDb(this.dbName, this.storeName, this.documentStoreName)
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
