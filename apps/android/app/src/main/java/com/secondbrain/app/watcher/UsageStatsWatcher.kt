package com.secondbrain.app.watcher

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.secondbrain.app.MainActivity
import com.secondbrain.app.R
import com.secondbrain.app.SecondBrainApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that polls `UsageStatsManager` and feeds
 * [SessionTracker].
 *
 * ## Hard dependency on a special access grant
 *
 * This service **silently produces nothing** unless the user has granted Usage access
 * (`PACKAGE_USAGE_STATS`) in Settings. The manifest declaration is not a runtime
 * permission and cannot be requested with `ActivityResultContracts.RequestPermission`:
 *
 *   Settings > Apps > Special app access > Usage access > Second Brain > Allow
 *
 * `UsageStatsManager.queryEvents` returns an empty cursor for a caller without the
 * grant, so the failure is invisible — no exception, no crash, just an empty feed. The
 * UI must therefore check [ForegroundAppDetector.Companion.hasUsageStatsPermission]
 * before implying that capture is working, and every screen that shows captured data
 * needs an empty state that points at the settings path above.
 *
 * ## Why a foreground service
 *
 * Android 8+ stops background services, and API 31+ forbids starting one from the
 * background at all, so capture must be an explicit user-visible foreground service.
 * The user therefore always sees the ongoing notification built by
 * [buildNotification] while capture is on; that is a product requirement, not a
 * side effect. On API 33+ the notification additionally needs a runtime
 * `POST_NOTIFICATIONS` grant to be visible, and on API 34+ the service type declared in
 * the manifest (`dataSync`) must be passed to `startForeground`.
 *
 * ## Lifecycle
 *
 * `START_STICKY`: the system restarts the service after a low-memory kill. That is safe
 * because the service holds no durable state — anything not yet handed to
 * `LocalQueue` is simply lost, and the queue, not this service, is the source of truth.
 */
class UsageStatsWatcher : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The polling loop, if one is running; `null` before [onStartCommand]. */
    private var pollJob: Job? = null

    private val detector: ForegroundAppDetector by lazy {
        ForegroundAppDetector(applicationContext)
    }

    /**
     * Session state machine for this service instance. Created lazily so that binding
     * the device id (an encrypted-preferences read) never happens on the main thread
     * during `onCreate`.
     */
    private val tracker: SessionTracker by lazy {
        SessionTracker(
            deviceId = (application as SecondBrainApp).container.deviceId,
            appLabelFor = { packageName -> detector.labelFor(packageName) },
        )
    }

    /** Nothing binds to this service; all communication is through intents. */
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    /**
     * Enters the foreground and starts (or keeps) polling.
     *
     * Returns `START_STICKY` so the system recreates the service after a kill. An
     * [ACTION_STOP] intent performs an orderly shutdown instead.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        startPolling()
        return START_STICKY
    }

    /** Cancels the polling loop; queued sessions are already safe in Room by then. */
    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Runs [pollOnce] every [POLL_INTERVAL_MILLIS]. Idempotent: repeated
     * `onStartCommand` calls (a restart, or a second [start]) do not stack loops.
     *
     * Phase-2 resolves the privacy exclusion list once, before this loop starts
     * (`AppContainer.loadExclusionList`), because the check must not block the first tick
     * on a disk read.
     */
    private fun startPolling() {
        if (pollJob?.isActive == true) return

        pollJob = scope.launch {
            while (isActive) {
                pollOnce()
                delay(POLL_INTERVAL_MILLIS)
            }
        }
    }

    /**
     * One capture tick: check the exclusion list, read the foreground package, feed
     * [SessionTracker], and hand any completed session to the local queue.
     *
     * Order is not negotiable. The exclusion check comes **first**, before anything is
     * observed: an excluded package must produce no event object, no row in Room and no
     * counter — not a row that is later filtered or redacted. That is the exclusion
     * invariant, and the only place it can be enforced without a leak is here.
     *
     * Must never throw — an unhandled exception in this loop kills the process-wide
     * capture service. Phase-2 wraps the usage-stats read in the permission check
     * ([ForegroundAppDetector.Companion.hasUsageStatsPermission]) and enqueues a flushed
     * [AppSession] through `LocalQueue`.
     */
    private suspend fun pollOnce() {
        TODO("phase-2: check exclusion, detect the foreground package, update the tracker, enqueue flushed sessions")
    }

    /**
     * Creates the low-importance capture channel. Idempotent: creating an existing
     * channel is a no-op, so this is safe on every service start.
     */
    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_capture_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_capture_description)
            setShowBadge(false)
        }

        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    /**
     * The always-visible ongoing notification: silent, ongoing, tap-to-open. It tells
     * the user capture is running, which is the transparency half of the privacy model
     * (the other half being the exclusion list).
     */
    private fun buildNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_capture)
            .setContentTitle(getString(R.string.notification_capture_title))
            .setContentText(getString(R.string.notification_capture_text))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {

        /**
         * How often the foreground app is sampled, in milliseconds.
         *
         * Trade-off: every tick wakes the CPU and scans usage events, so a shorter
         * interval costs battery; a longer one merges distinct app visits into one
         * session. Five seconds keeps sessions accurate for real app switching while
         * staying well inside a foreground service's budget.
         */
        const val POLL_INTERVAL_MILLIS: Long = 5_000L

        /** Notification channel for the ongoing capture notification. */
        const val NOTIFICATION_CHANNEL_ID = "second_brain_capture"

        /** Stable id for the ongoing notification; one notification, always present. */
        const val NOTIFICATION_ID = 1001

        /** Intent action: enter the foreground and start polling. */
        const val ACTION_START = "com.secondbrain.app.action.START_CAPTURE"

        /** Intent action: stop polling and leave the foreground. */
        const val ACTION_STOP = "com.secondbrain.app.action.STOP_CAPTURE"

        /**
         * Starts capture. Must be called while the app is in the foreground (API 31+
         * throws `ForegroundServiceStartNotAllowedException` otherwise).
         */
        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, UsageStatsWatcher::class.java).setAction(ACTION_START),
            )
        }

        /** Stops capture and removes the ongoing notification. */
        fun stop(context: Context) {
            context.startService(
                Intent(context, UsageStatsWatcher::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
