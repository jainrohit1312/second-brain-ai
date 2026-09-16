package com.secondbrain.app.queue

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Data access for the durable capture queue.
 *
 * Every method is `suspend`: Room runs them on its own dispatcher, so callers may invoke
 * them from any coroutine context without blocking the main thread. No method here
 * deletes a row except [deleteByIds] and [deleteOlderThan], which enforces the queue's
 * central invariant — a row leaves the queue only after a server acknowledgement or
 * after an explicit retention policy expires.
 */
@Dao
interface QueueDao {

    /**
     * Inserts one queued event and returns its row id.
     *
     * @throws android.database.sqlite.SQLiteConstraintException when the event's
     *   `event_id` already exists — [OnConflictStrategy.ABORT] is deliberate, since a
     *   duplicate insert means the caller built an event that was already queued.
     */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: QueueEntity): Long

    /**
     * Inserts a batch of events in one transaction and returns their row ids in the
     * order given. Used when the watcher flushes several sessions at once.
     */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(entities: List<QueueEntity>): List<Long>

    /**
     * Reads the oldest [limit] rows in event order.
     *
     * Order is `occurredAt` ascending with `id` breaking ties, matching the sync
     * protocol's batch ordering: the server then receives events in roughly the order
     * they happened even after a device was offline for a week. `enqueuedAt` is a
     * storage timestamp and must never define delivery order.
     */
    @Query(
        "SELECT * FROM queue_events ORDER BY occurred_at_millis ASC, id ASC LIMIT :limit",
    )
    suspend fun peekBatch(limit: Int): List<QueueEntity>

    /**
     * Deletes acknowledged rows and returns how many were removed.
     *
     * The only server-driven deletion path: call it *after* the server returned a verdict
     * for a row (accepted, duplicate, or schema-rejected), and with exactly those rows —
     * never the whole queue.
     */
    @Query("DELETE FROM queue_events WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>): Int

    /** Number of rows waiting to sync; drives the pending badge in the UI. */
    @Query("SELECT COUNT(*) FROM queue_events")
    suspend fun count(): Int

    /**
     * Drops rows enqueued before [cutoffMillis] and returns how many were removed.
     *
     * Retention valve for rows that can never be delivered (a permanently rejected
     * event, or a user who never signs in again). The caller supplies the cutoff so the
     * retention window stays a product decision rather than a storage detail.
     */
    @Query("DELETE FROM queue_events WHERE enqueued_at_millis < :cutoffMillis")
    suspend fun deleteOlderThan(cutoffMillis: Long): Int

    /**
     * Records a delivery attempt for [ids] and returns how many rows were updated.
     *
     * Attempt counts are diagnostic only — the retry schedule is owned by WorkManager's
     * backoff, not by this column — so they must never gate whether a row is retried.
     */
    @Query(
        """
        UPDATE queue_events
        SET attempt_count = attempt_count + 1, last_attempt_at_millis = :attemptedAtMillis
        WHERE id IN (:ids)
        """,
    )
    suspend fun markAttempted(ids: List<Long>, attemptedAtMillis: Long): Int
}
