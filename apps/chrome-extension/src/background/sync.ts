import {
  SCHEMA_VERSION,
  type ActivityBatch,
  type ActivityBatchResult,
  type DeviceId,
} from '@second-brain/shared';

import { isAuthRequiredError, requireAuth } from '@/lib/auth';
import { bumpDroppedCount, writeLastSync } from '@/lib/settings';
import { DEFAULT_SYNC_INTERVAL_SECONDS, readExtensionEnv } from '@/lib/supabase';

import { DEFAULT_BATCH_LIMIT, DEFAULT_MAX_QUEUE_AGE_MS } from './queue';

import type { QueueStore, QueuedEvent } from './queue';
import type { FlushReason, SyncOutcome } from '@/types/events';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Alarm name for the periodic sync tick; also the marker the alarm handler dispatches on. */
export const SYNC_ALARM_NAME = 'second-brain:sync';
/** Failed attempts before an event stops being retried and is reported as dropped. */
export const MAX_SYNC_ATTEMPTS = 5;
/** Ceiling for exponential retry backoff; five minutes. */
export const MAX_BACKOFF_MS = 5 * 60 * 1_000;
/** Delay before the first retry; doubles with each attempt. */
export const BASE_BACKOFF_MS = 1_000;
/**
 * Floor for the sync alarm period. Chrome clamps sub-minute alarm periods in release
 * builds, and an alarm configured below the floor either never fires or fires in a burst.
 */
export const MIN_ALARM_PERIOD_MINUTES = 1;
/** Name of the edge function that ingests a batch; matches the directory under `supabase/functions`. */
export const INGEST_FUNCTION_NAME = 'process-activity';

/** Collaborators a drain needs: an authenticated client and the device identity. */
export interface SyncDeps {
  /** Supabase client bound to the signed-in user's session; RLS rejects anonymous writes. */
  client: SupabaseClient;
  /** Stable id minted on first run; every event in the batch carries it. */
  deviceId: DeviceId;
  /** Clock override for tests; defaults to the wall clock. */
  now?: () => Date;
}

/**
 * Arms the periodic sync alarm. The period comes from `VITE_SYNC_INTERVAL_SECONDS`
 * (via `readExtensionEnv()`), floored at one minute because Chrome clamps shorter
 * alarm periods in release builds.
 *
 * A build with no Supabase environment cannot be configured by `readExtensionEnv`, which
 * throws; that must not take the whole worker down with it, so the default period is used
 * and the failure is logged. The alarm firing without credentials is harmless — the drain
 * reports "skipped" until the extension is configured and signed in.
 */
export function startPeriodicSync(): void {
  let periodInMinutes = DEFAULT_SYNC_INTERVAL_SECONDS / 60;
  try {
    periodInMinutes = readExtensionEnv().syncIntervalSeconds / 60;
  } catch (error) {
    console.warn(
      `[second-brain] cannot read the sync interval; using ${DEFAULT_SYNC_INTERVAL_SECONDS}s`,
      error,
    );
  }

  const period = Math.max(MIN_ALARM_PERIOD_MINUTES, periodInMinutes);
  chrome.alarms
    .create(SYNC_ALARM_NAME, { periodInMinutes: period, delayInMinutes: period })
    .catch((error: unknown) => {
      console.error('[second-brain] cannot arm the sync alarm', error);
    });
}

/** Clears the periodic sync alarm; called on sign-out and while capture is paused. */
export function stopPeriodicSync(): void {
  chrome.alarms.clear(SYNC_ALARM_NAME).catch((error: unknown) => {
    console.error('[second-brain] cannot clear the sync alarm', error);
  });
}

/**
 * Exponential backoff for a failed batch, capped at {@link MAX_BACKOFF_MS}.
 *
 * Deterministic on purpose: no jitter, so the schedule is reproducible in a test and in a
 * bug report. The extension has exactly one client per device, so there is no thundering
 * herd for jitter to spread out.
 */
export function computeBackoffMs(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt));
  // `2 ** step` overflows to Infinity for a large attempt; `Math.min` turns that into the cap.
  return Math.min(BASE_BACKOFF_MS * 2 ** step, MAX_BACKOFF_MS);
}

/** Wraps queued events in the wire envelope the ingestion endpoint expects. */
export function buildActivityBatch(
  events: readonly QueuedEvent[],
  deviceId: DeviceId,
  now: () => Date = () => new Date(),
): ActivityBatch {
  return {
    // Stamped from the shared constant rather than from the caller: a batch built
    // with a version this build does not understand is rejected outright by the
    // server, and the shared constant is the one place that knows the current one.
    schemaVersion: SCHEMA_VERSION,
    deviceId,
    // The moment of construction, not of the last capture. The server compares it
    // against its own clock for skew; ordering uses each event's `occurredAt`.
    clientSentAt: now().toISOString(),
    events: events.map((queued) => queued.event),
  };
}

/**
 * POSTs one batch to the ingestion edge function and returns the server's accounting.
 *
 * The call goes through `functions.invoke` rather than `fetch` so it carries the anon
 * key, the signed-in user's access token, and the extension's client header — the same
 * header the function's CORS allowlist has to admit. A non-2xx response rejects the
 * promise, and never retries: retrying belongs to the queue, which knows the attempt
 * count and the backoff, and a second retry loop here would multiply the two.
 */
export async function postActivityBatch(
  client: SupabaseClient,
  batch: ActivityBatch,
): Promise<ActivityBatchResult> {
  const { data, error } = await client.functions.invoke<ActivityBatchResult>(INGEST_FUNCTION_NAME, {
    body: batch,
  });

  if (error !== null) {
    const code = await readIngestionErrorCode(error);
    throw new Error(
      code === null
        ? `Ingestion failed: ${error.message}`
        : `Ingestion failed [${code}]: ${error.message}`,
    );
  }

  // `acknowledge` is driven by `rejectedIds`, so a response without it is not a
  // response this client can act on. Treating the batch as unsent is the safe
  // reading: re-sending is idempotent, and dropping it would lose the events.
  if (data === null || !Array.isArray(data.rejectedIds)) {
    throw new Error('Ingestion returned no per-event outcomes; the batch was not acknowledged.');
  }

  return data;
}

/**
 * Best-effort read of the documented error envelope `{ error: { code, message } }`
 * out of a failed invocation. `functions.invoke` collapses every non-2xx answer into
 * one error whose message describes the transport rather than the cause, and the
 * `code` inside the body is what a caller branches on — `token_expired` wants a
 * refresh and a single retry, `device_revoked` wants capture stopped. The envelope is
 * therefore read back while the response is still reachable.
 *
 * A body that is not the envelope — a gateway page, an empty 500, a consumed stream —
 * is not an error in itself; it just leaves the code unknown.
 */
async function readIngestionErrorCode(error: { context?: unknown }): Promise<string | null> {
  const context = error.context;
  if (!(context instanceof Response)) {
    return null;
  }
  try {
    const body = (await context.clone().json()) as { error?: { code?: unknown } };
    const code = body.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** The parts of an outcome the drain decides; the timestamps and reason are stamped around it. */
type SyncOutcomeCore = Pick<SyncOutcome, 'status' | 'sent' | 'result' | 'error'>;

/** Renders an unknown thrown value as the human-readable detail `SyncOutcome.error` carries. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Drains the queue once: prune what has expired, refuse to send when signed out, send one
 * batch, and acknowledge exactly what the server accounted for. Resolves with a
 * {@link SyncOutcome} on every path, including "nothing to do" and "not signed in" — a
 * drain is not an exceptional event, so it never rejects.
 *
 * One batch per call, not a loop until empty. `SyncOutcome` carries a single
 * `ActivityBatchResult`, and the drain runs on a timer, on idle, and on the post-capture
 * threshold, so a deep queue catches up over several ticks rather than holding a worker
 * open for an unbounded time.
 *
 * A successful response removes the whole batch, but not indiscriminately: ids the server
 * rejected are removed too. They are poison — a malformed event would otherwise sit at the
 * head of the queue forever, be retried on every tick, and stop the queue from ever
 * draining. Removing them is what `rejectedIds` is for, and they are counted as dropped so
 * the loss is visible in the popup instead of silent.
 *
 * Only attempts that actually reached the transport are recorded as `sb:last-sync`; a
 * "skipped" tick carries no information about what the server has, and overwriting the last
 * real outcome with it would make the popup's "last sync" timestamp a lie.
 */
export async function flushQueue(
  store: QueueStore,
  deps: SyncDeps,
  reason: FlushReason,
): Promise<SyncOutcome> {
  const attemptedAt = (deps.now ?? (() => new Date()))().toISOString();

  const finish = async (core: SyncOutcomeCore): Promise<SyncOutcome> => {
    const outcome: SyncOutcome = {
      ...core,
      reason,
      attemptedAt,
      finishedAt: (deps.now ?? (() => new Date()))().toISOString(),
    };
    if (outcome.status !== 'skipped') {
      try {
        await writeLastSync(outcome);
      } catch (error) {
        console.warn('[second-brain] cannot record the sync outcome', error);
      }
    }
    return outcome;
  };

  // Age pruning is best-effort: failing to prune must not stop the batch that is waiting.
  try {
    const pruned = await store.pruneOlderThan(DEFAULT_MAX_QUEUE_AGE_MS);
    if (pruned > 0) {
      await bumpDroppedCount(pruned);
    }
  } catch (error) {
    console.warn('[second-brain] queue prune failed', error);
  }

  try {
    await requireAuth();
  } catch (error) {
    if (isAuthRequiredError(error)) {
      return finish({ status: 'skipped', sent: 0, result: null, error: 'not signed in' });
    }
    return finish({ status: 'failed', sent: 0, result: null, error: describeError(error) });
  }

  let batch: QueuedEvent[];
  try {
    batch = await store.peekBatch(DEFAULT_BATCH_LIMIT);
  } catch (error) {
    return finish({ status: 'failed', sent: 0, result: null, error: describeError(error) });
  }

  if (batch.length === 0) {
    return finish({ status: 'skipped', sent: 0, result: null, error: null });
  }

  const envelope = buildActivityBatch(batch, deps.deviceId, deps.now);

  try {
    const result = await postActivityBatch(deps.client, envelope);

    const rejected = new Set(result.rejectedIds);
    const acceptedIds = batch.map((queued) => queued.id).filter((id) => !rejected.has(id));
    if (acceptedIds.length > 0) {
      await store.acknowledge(acceptedIds);
    }

    // Only ids that were really in this batch are dropped, so a server that reports an id
    // from another batch cannot cause an unrelated event to be deleted.
    const rejectedInBatch = batch
      .map((queued) => queued.id)
      .filter((id) => rejected.has(id));
    if (rejectedInBatch.length > 0) {
      await store.acknowledge(rejectedInBatch);
      await bumpDroppedCount(rejectedInBatch.length);
      console.warn(
        `[second-brain] server rejected ${rejectedInBatch.length} event(s); dropped from the queue`,
      );
    }

    return finish({
      status: result.rejected > 0 ? 'partial' : 'ok',
      sent: batch.length,
      result,
      error: null,
    });
  } catch (error) {
    // Nothing is acknowledged: every event in the batch is still queued and will be
    // re-sent, which the server's `(deviceId, dedupeKey)` constraint makes harmless.
    return finish({
      status: 'failed',
      sent: batch.length,
      result: null,
      error: describeError(error),
    });
  }
}
