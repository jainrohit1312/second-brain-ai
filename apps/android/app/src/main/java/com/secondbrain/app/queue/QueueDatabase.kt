package com.secondbrain.app.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Room database holding the outbound capture queue — the single durable store on this
 * device.
 *
 * ## Durability and survival
 *
 * Rows survive process death, force-stop and reboot because Room writes them to
 * `second_brain_queue.db` in the app's private storage. They are *deleted only after a
 * successful server acknowledgement* (`QueueDao.deleteByIds`) or when the retention
 * window expires (`QueueDao.deleteOlderThan`). Nothing in the app may clear this
 * database on sign-out: an unsigned device keeps capturing locally, and the queue drains
 * on the next successful sign-in.
 *
 * ## Timestamps
 *
 * All time columns are epoch milliseconds stored as `Long`, and there are therefore no
 * `@TypeConverters` on this database:
 *  - integer comparison in SQL is what the queue needs (`ORDER BY`, `<` for retention),
 *    and ISO-8601 strings only sort correctly by accident;
 *  - the wire format still uses ISO-8601 strings (see the shared `ActivityEvent` type),
 *    so conversion happens exactly once, at the `LocalQueue` boundary;
 *  - a converter added later for a non-primitive column (for example `List<String>`)
 *    must be registered here *and* documented as a migration-relevant change.
 *
 * ## Versioning
 *
 * `version = 1` with no destructive fallback. Queued rows are by definition not
 * reproducible from any other source, so a schema change requires a real
 * `Migration` plus a `MigrationTestHelper` test against the exported schema — never
 * `fallbackToDestructiveMigration`.
 */
@Database(
    entities = [QueueEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class QueueDatabase : RoomDatabase() {

    /** DAO for the `queue_events` table. */
    abstract fun queueDao(): QueueDao

    companion object {

        /**
         * On-disk file name. Excluded from cloud backup and device transfer in
         * `res/xml/data_extraction_rules.xml` and `res/xml/backup_rules.xml` — keeping
         * this constant and those files in sync is a hard requirement.
         */
        const val DATABASE_NAME = "second_brain_queue.db"

        @Volatile
        private var instance: QueueDatabase? = null

        /**
         * Returns the process-wide instance, building it on first use.
         *
         * Double-checked locking with a `@Volatile` field: the container calls this from
         * a `lazy` and from background workers, so concurrent first access is expected.
         */
        fun getInstance(context: Context): QueueDatabase =
            instance ?: synchronized(this) {
                instance ?: build(context).also { instance = it }
            }

        private fun build(context: Context): QueueDatabase =
            Room.databaseBuilder(
                context.applicationContext,
                QueueDatabase::class.java,
                DATABASE_NAME,
            ).build()
    }
}
