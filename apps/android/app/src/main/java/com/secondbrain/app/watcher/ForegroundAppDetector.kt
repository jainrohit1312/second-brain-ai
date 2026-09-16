package com.secondbrain.app.watcher

import android.content.Context

/**
 * Reads the device's foreground app from `UsageStatsManager`.
 *
 * Owns no state: [detectForegroundPackage] is called on a timer by
 * `UsageStatsWatcher`, and every failure mode returns `null` rather than throwing, so a
 * revoked permission or an empty event window can never crash the capture service.
 */
class ForegroundAppDetector(private val context: Context) {

    /**
     * Returns the package currently in the foreground, or `null` when nothing can be
     * determined (usage access not granted, no `MOVE_TO_FOREGROUND` event inside the
     * lookback window, or a launcher/System UI package that must never be recorded).
     *
     * Strategy: `UsageStatsManager.queryEvents(lookbackStart, now)` with
     * `lookbackStart = now - [LOOKBACK_WINDOW_MILLIS]`, then the *last*
     * `ACTIVITY_RESUMED` event in that window wins; a later `ACTIVITY_PAUSED` or
     * `ACTIVITY_STOPPED` for the same package means the app is no longer foreground and
     * `null` is returned. The window must be wider than the polling interval or a
     * short-lived foreground app is missed entirely, and it must stay small enough that
     * the event cursor never grows unbounded on a device with heavy app churn.
     *
     * `UsageStatsManager` replaces `ActivityManager.getRunningTasks`, which is
     * deprecated, restricted to the caller's own task on API 21+, and cannot see other
     * apps' tasks at all — it would silently report only this app.
     */
    fun detectForegroundPackage(): String? =
        TODO("phase-2: query events in the lookback window and resolve the last resumed package")

    /**
     * Resolves the user-visible label for [packageName], falling back to the package
     * name itself when the package cannot be resolved.
     *
     * Used both for the app label stored on an `AppSessionEvent` and by the privacy
     * screen's exclusion picker. Returning the package name on failure keeps the
     * exclusion list functional even if the Play Store declaration required by
     * `QUERY_ALL_PACKAGES` is not granted.
     */
    fun labelFor(packageName: String): String =
        TODO("phase-2: resolve the application label from PackageManager")

    companion object {

        /**
         * How far back to look for foreground transitions, in milliseconds.
         * Must exceed `UsageStatsWatcher.POLL_INTERVAL_MILLIS` so no transition is
         * skipped, and should stay small to keep the event scan cheap.
         */
        const val LOOKBACK_WINDOW_MILLIS: Long = 60_000L

        /**
         * Whether the user has granted the special "Usage access" permission.
         *
         * This is an AppOps check (`OPSTR_GET_USAGE_STATS`), not a runtime permission:
         * the manifest declaration is inert until the user enables it in
         * Settings > Apps > Special app access > Usage access. Call it before assuming
         * the watcher will ever see an event.
         */
        fun hasUsageStatsPermission(context: Context): Boolean =
            TODO("phase-2: check the GET_USAGE_STATS app-op for this app's uid")
    }
}
