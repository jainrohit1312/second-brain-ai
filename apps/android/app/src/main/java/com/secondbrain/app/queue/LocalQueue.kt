package com.secondbrain.app.queue

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.secondbrain.app.sync.ActivityEvent
import com.secondbrain.app.sync.IngestionRestClient
import kotlinx.serialization.json.Json

/**
 * One queued outbound event, stored as its serialised wire form.
 *
 * The event is persisted as JSON (`payload_json`) rather than as columns because the
 * payload must round-trip byte-for-byte to the server: the queue's job is delivery, not
 * interpretation, and a schema change in `@second-brain/shared` must never require a
 * Room migration. The columns that *are* real are the ones the queue needs to order,
 * deduplicate and expire rows.
 *
 * @property id auto-generated row id; the handle used for acknowledgement, never sent
 *   to the server.
 * @property eventId the event's own id (UUID from the producer); unique index makes
 *   re-enqueueing the same event a constraint violation instead of a duplicate push.
 * @property eventType wire value of the `ActivityEvent` discriminator, kept as a column
 *   so the queue can be inspected and filtered with plain SQL.
 * @property dedupeKey server-side idempotency key mirrored into a column for the same
 *   reason; the authoritative copy is inside `payload_json`. Indexed but *not* unique:
 *   collapsing genuine duplicates happens on the server, where the unique constraint is
 *   `(device_id, dedupe_key)` and the insert is `do nothing` — see
 *   `docs/ARCHITECTURE.md`, "Why `(deviceId, dedupeKey)` makes retries safe". The key
 *   must be produced by the shared `dedupeKey` utility so every client agrees, and must
 *   contain nothing that varies per delivery attempt.
 * @property deviceId device that observed the event; a drained queue restored from a
 *   different device would otherwise push rows under the wrong device id.
 * @property occurredAtMillis when the event happened, epoch milliseconds; the batch
 *   ordering key.
 * @property enqueuedAtMillis when the row was written; retention and diagnostics only,
 *   never delivery order.
 * @property attemptCount delivery attempts so far, diagnostics only.
 * @property lastAttemptAtMillis when the last attempt happened, or `null` if never.
 * @property payloadJson the serialised `ActivityEvent`, the exact bytes to upload.
 */
@Entity(
    tableName = "queue_events",
    indices = [
        Index(value = ["event_id"], unique = true),
        Index(value = ["dedupe_key"]),
        Index(value = ["occurred_at_millis"]),
    ],
)
data class QueueEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,
    @ColumnInfo(name = "event_id")
    val eventId: String,
    @ColumnInfo(name = "event_type")
    val eventType: String,
    @ColumnInfo(name = "dedupe_key")
    val dedupeKey: String,
    @ColumnInfo(name = "device_id")
    val deviceId: String,
    @ColumnInfo(name = "occurred_at_millis")
    val occurredAtMillis: Long,
    @ColumnInfo(name = "enqueued_at_millis")
    val enqueuedAtMillis: Long,
    @ColumnInfo(name = "attempt_count")
    val attemptCount: Int = 0,
    @ColumnInfo(name = "last_attempt_at_millis")
    val lastAttemptAtMillis: Long? = null,
    @ColumnInfo(name = "payload_json")
    val payloadJson: String,
)

/**
 * A queued row paired with its decoded event — what a caller needs to build a batch and
 * then acknowledge exactly those rows.
 *
 * @property rowId the `QueueEntity.id` to pass to [LocalQueue.acknowledge].
 */
data class QueuedEvent(
    val rowId: Long,
    val event: ActivityEvent,
)

/**
 * Repository facade over [QueueDao]: the only supported way to read or write the queue.
 *
 * ## Contract
 *
 *  - **Durability**: [enqueue] returns only after the row is committed to Room. A
 *    process killed immediately afterwards loses nothing.
 *  - **At-least-once delivery, never exactly-once**: [peekBatch] does not reserve or lock
 *    rows, so a second caller could read the same batch. That is safe because the server
 *    inserts with `on conflict (device_id, dedupe_key) do nothing`; the queue optimises for
 *    never losing an event, not for never sending one twice.
 *  - **Deletion only on a server verdict**: [acknowledge] is the only server-driven
 *    deletion, and it takes the row ids of the events the server gave a terminal answer
 *    for — accepted, duplicate, or schema-rejected. Never delete a batch just because it
 *    was sent: a 500, a timeout or an aborted coroutine must leave every row in place.
 *  - **Ordering**: batches are read `occurredAt` ascending with `id` breaking ties, so the
 *    server receives events in roughly the order they happened even after an offline week.
 *    Nothing may depend on `enqueuedAt`, which is a storage timestamp.
 *
 * All methods suspend and are safe to call from any dispatcher (Room owns the I/O
 * dispatcher); none of them may be called on the main thread.
 *
 * @param json wire configuration shared with the sync layer, so a payload written by
 *   [LocalQueue] is readable by `IngestionRestClient` and vice versa.
 */
class LocalQueue(
    private val dao: QueueDao,
    private val json: Json = IngestionRestClient.DEFAULT_JSON,
) {

    /**
     * Serialises and appends [event], returning its row id.
     *
     * @throws android.database.sqlite.SQLiteConstraintException if the event's id is
     *   already queued — callers treat that as success, not as an error.
     */
    suspend fun enqueue(event: ActivityEvent): Long =
        TODO("phase-2: map the event to a QueueEntity and insert it")

    /**
     * Appends every event in [events] in one transaction, returning the row ids in the
     * same order. Empty input is a no-op that returns an empty list.
     */
    suspend fun enqueueAll(events: List<ActivityEvent>): List<Long> =
        TODO("phase-2: insert the mapped entities in a single transaction")

    /**
     * Reads the oldest up to [limit] rows in `occurredAt` order and decodes them.
     *
     * Decoding failures are the caller's problem to report, not a reason to drop a row:
     * a payload that cannot be decoded stays queued so it can be inspected or expired by
     * retention, and is never silently deleted.
     */
    suspend fun peekBatch(limit: Int = DEFAULT_BATCH_SIZE): List<QueuedEvent> =
        TODO("phase-2: read the oldest rows and decode payload_json")

    /**
     * Deletes rows the server gave a terminal answer for and returns how many were
     * removed.
     *
     * Call with the ids of accepted **and** accepted-as-duplicate events — both are
     * delivered, and leaving duplicates behind would make the queue never drain. Ids that
     * the server rejected on schema grounds are also removed (bounded, visible loss: the
     * count and the first reason go to the device's `lastError`, which the UI surfaces),
     * because retrying a schema-invalid event forever is the one failure in which a queue
     * captures nothing at all.
     */
    suspend fun acknowledge(rowIds: List<Long>): Int =
        TODO("phase-2: delete the acknowledged rows")

    /** Pending row count, for the sync badge and the settings screen. */
    suspend fun count(): Int =
        TODO("phase-2: count the queued rows")

    /**
     * Drops rows enqueued before [cutoffMillis] and returns how many were removed.
     * The caller computes the cutoff from the retention window so this class holds no
     * policy.
     */
    suspend fun deleteOlderThan(cutoffMillis: Long): Int =
        TODO("phase-2: expire rows older than the cutoff")

    companion object {

        /**
         * Rows read per sync batch. Bounded so one upload stays a single request body a
         * phone can send over a weak connection, and so a failure costs one batch worth
         * of retry, not the whole queue.
         */
        const val DEFAULT_BATCH_SIZE: Int = 100
    }
}
