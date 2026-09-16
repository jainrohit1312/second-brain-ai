/**
 * Mixed-batch ingestion and the idempotency contract that makes client retries safe.
 *
 * The clients (extension, Android) buffer work offline and flush on a timer. They therefore
 * have to assume that any flush may be delivered twice: once successfully but with a lost
 * response, once as a retry. The server's job is to make the second delivery a no-op.
 *
 * ## Idempotency contract
 *
 * For a fixed `deviceId` and a fixed set of event ids, `handleMixedBatch` and
 * `handleActivityBatch` must return the same counts and the same `serverCursor`, and write
 * no additional rows, no matter how many times they are called. Concretely:
 *
 * - events are deduplicated on `ActivityEvent.dedupeKey`, which the client derives from the
 *   event content, so a retry of the same event carries the same key;
 * - documents are deduplicated on `(userId, contentHash)`;
 * - the batch identity is derived only from the device and the event id set, sorted, so
 *   reordering the same events inside the payload does not create a new batch
 *   (see `batchIdempotencyKey`);
 * - a replay therefore reports every member as a duplicate and leaves the cursor where it
 *   was.
 *
 * ## Partial acceptance
 *
 * A batch is not a transaction. One unroutable document must not cost the client a whole
 * flush of otherwise good activity, so each member is applied independently and the result
 * reports the survivors and the rejections separately.
 */
import { MAX_BATCH_EVENTS } from '../validation/schemas';

import type { IngestionContext } from './activity';
import type { IngestDocumentInput } from '../validation/schemas';
import type { ActivityBatchResult, ActivityEvent, DeviceId } from '@second-brain/shared';

/**
 * One flush from a client: buffered events and buffered document captures together.
 *
 * A single endpoint exists because a client that goes offline accumulates both and should
 * have one place to send them, in one order, with one cursor back.
 */
export interface MixedBatch {
  schemaVersion: number;
  deviceId: DeviceId;
  clientSentAt: string;
  events: ActivityEvent[];
  documents: IngestDocumentInput[];
}

/** Per-item results for the document half of a mixed batch. */
export interface DocumentBatchResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  /** Ids of the documents that were stored or already existed, in submission order. */
  documentIds: readonly string[];
  /** Indexes into `MixedBatch.documents` for the captures that were refused, and why. */
  rejections: readonly { index: number; reason: string }[];
}

/** Result of a mixed flush. `serverCursor` is opaque to the client; it stores and echoes it. */
export interface MixedBatchResult {
  serverCursor: string;
  activity: ActivityBatchResult;
  documents: DocumentBatchResult;
  tookMs: number;
}

/**
 * Splits a list into consecutive batches of at most `size`.
 *
 * Pure and order-preserving. The default bound is `MAX_BATCH_EVENTS`, the same limit the
 * schema enforces, so a payload that splits into more than one chunk is by definition one
 * the schema would reject if sent whole; callers that need to exceed it must store the
 * overflow rather than send an oversized request.
 *
 * @param items - Items to split. Not mutated.
 * @param size - Maximum chunk length; must be a positive integer.
 * @throws RangeError when `size` is not a positive integer.
 */
export function chunkBatch<T>(items: readonly T[], size: number = MAX_BATCH_EVENTS): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunkBatch: size must be a positive integer, received ${size}`);
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Derives the stable identity of a flush.
 *
 * Pure. The event ids are sorted before joining so that a client which reorders its buffer
 * between attempts still produces the same key — that is the whole point, and the reason a
 * raw joined string is not good enough. Callers persist a hash of this value; the returned
 * string is not a secret and must not be logged verbatim if ids are user-derived.
 *
 * @param args - Device that sent the batch and the ids it contained.
 */
export function batchIdempotencyKey(args: {
  deviceId: DeviceId;
  eventIds: readonly string[];
}): string {
  const canonicalIds = [...args.eventIds].sort();
  return `${args.deviceId}:${canonicalIds.join(',')}`;
}

/**
 * Ingests a mixed flush: events first, then documents.
 *
 * Events go first because they are cheap and must not be held up behind a document fetch
 * that may itself fail. Both halves keep their own partial-acceptance semantics.
 *
 * Idempotency and ordering guarantees are stated in the module header; this function adds
 * one more: batches are applied in `chunkBatch` order, so a caller that splits its payload
 * and loses connection half way can resume from the last acknowledged chunk without
 * reordering anything.
 *
 * @param batch - A parsed mixed flush.
 * @param ctx - Request-scoped dependencies. `ctx.deviceId` must equal `batch.deviceId`.
 */
export async function handleMixedBatch(
  _batch: MixedBatch,
  _ctx: IngestionContext,
): Promise<MixedBatchResult> {
  // TODO(phase-1): delegate the event half to handleActivityBatch, apply the document half
  // per capture, combine the two results and advance the cursor exactly once.
  throw new Error('Not implemented: handleMixedBatch');
}
