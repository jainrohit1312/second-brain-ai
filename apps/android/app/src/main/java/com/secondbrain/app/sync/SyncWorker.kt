package com.secondbrain.app.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Drains the local capture queue to `services/ingestion`.
 *
 * ## The queue is the source of truth
 *
 * This worker owns no state. It reads rows through `LocalQueue` and deletes them only
 * after a server verdict. Therefore:
 *
 *  - **a transient network error is always `Result.retry()`** — the rows are still on
 *    disk, so retrying is strictly correct, and returning `Result.failure()` for a flaky
 *    connection would abandon unsynced user data;
 *  - `Result.success()` means "this run has nothing left to do", not "everything ever
 *    captured has synced"; the periodic schedule re-runs it anyway;
 *  - `Result.failure()` is reserved for a permanent, non-retryable condition, because
 *    WorkManager will not run the request again after it.
 *
 * ## Outcome taxonomy (from the sync protocol)
 *
 * | Response | Outcome | Why |
 * | --- | --- | --- |
 * | transport error, timeout, 5xx, 429 | `Result.retry()` | Transient; the queue keeps the rows |
 * | 200 with a result | acknowledge per id, then `success()` | `accepted`, `duplicates` and `rejectedIds` are all terminal |
 * | 401 | refresh the session once, then retry | The user's JWT expired; the rows are still valid |
 * | 403 `device_revoked` | `failure()` and stop capture | The device is revoked server-side; retrying is futile and syncing must visibly stop |
 * | 400 schema error | drop the ids in `rejectedIds`, record `lastError`, then `success()` | A malformed event will never validate; an infinite retry is a queue that never drains |
 *
 * ## Why WorkManager and not a background service
 *
 * WorkManager survives reboot and Doze, respects the user's battery optimisations, and
 * gives exponential backoff for free — all of which a hand-rolled `AlarmManager` loop
 * would reimplement badly. Its `Constraints` (network connected) make the common offline
 * case a scheduling detail rather than an error path; [isOnline] is a cheap pre-flight
 * that avoids beginning a run only to fail on the first request. The backoff ceiling is
 * this request's period, not a tighter loop: a device that has failed for hours must keep
 * trying without hammering the server.
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    /**
     * Runs up to [MAX_BATCHES_PER_RUN] upload cycles.
     *
     * A cycle is: read a batch, POST it to `{API_BASE_URL}/v1/ingest/batch`, then
     * acknowledge exactly the rows the server gave a verdict for. Batch size is
     * `LocalQueue.DEFAULT_BATCH_SIZE` (`SYNC_BATCH_SIZE`, 100 in the protocol), so one run
     * is bounded in both requests and memory regardless of how large the backlog has grown
     * — a device that was offline for a week drains over several runs instead of one long
     * run that Doze will kill.
     */
    override suspend fun doWork(): Result {
        if (!isOnline()) {
            // Not an error: the queue is durable, and WorkManager retries with backoff.
            return Result.retry()
        }

        TODO("phase-2: drain up to MAX_BATCHES_PER_RUN batches and map outcomes to Result")
    }

    /**
     * Cheap pre-flight: is there a network that claims to be able to reach the internet?
     *
     * Deliberately optimistic — `NET_CAPABILITY_INTERNET` says "this network should route
     * to the internet", not "the internet works" (captive portals pass it). That is fine
     * here because a false positive costs one failed request that turns into
     * `Result.retry()`, while a false negative would stall the queue.
     */
    private fun isOnline(): Boolean {
        val manager = applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    companion object {

        /** Unique periodic work name; enqueue with `KEEP` so relaunches never restack it. */
        const val UNIQUE_WORK_NAME: String = "second_brain_sync"

        /**
         * Upload cycles per run. Bounds the work done in one wake-up so a huge backlog
         * cannot run past the system's execution window and be killed mid-batch.
         */
        const val MAX_BATCHES_PER_RUN: Int = 5

        /**
         * Periodic interval in minutes. Fifteen is WorkManager's minimum for periodic
         * work; the queue makes a longer interval harmless, since nothing is lost while
         * the worker sleeps.
         */
        const val SYNC_INTERVAL_MINUTES: Long = 15L

        /** Base backoff for retries; WorkManager doubles this per attempt (exponential). */
        const val BACKOFF_SECONDS: Long = 30L

        /** Work tag, so the settings screen can observe or cancel sync work by tag. */
        const val TAG: String = "sync"

        /** The recurring background sync request. */
        fun periodicRequest(): PeriodicWorkRequest =
            PeriodicWorkRequestBuilder<SyncWorker>(SYNC_INTERVAL_MINUTES, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .setInitialDelay(SYNC_INTERVAL_MINUTES, TimeUnit.MINUTES)
                .addTag(TAG)
                .build()

        /**
         * A one-shot run, for "sync now" in the settings screen and for an immediate
         * drain after sign-in. Distinct from the periodic request so a manual run never
         * resets the periodic schedule.
         */
        fun oneTimeRequest(): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()

        /** Runs only with a validated internet connection. */
        private fun networkConstraints(): Constraints =
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
    }
}
