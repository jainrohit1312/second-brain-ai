package com.secondbrain.app.watcher

/**
 * Turns a stream of foreground/screen observations into completed [AppSession] rows.
 *
 * Pure state machine: no Android types, no clock, no I/O — every transition takes an
 * explicit `atMillis`, so the whole class is unit-testable on the JVM (see
 * `app/src/test`) with a fake clock and no `UsageStatsManager`.
 *
 * Lifecycle contract:
 *  1. [onForegroundChanged] is called whenever the polled foreground package differs
 *     from the one currently open; it closes the open session and starts a new one.
 *  2. [onScreenOff]/[onScreenOn] bound a session that would otherwise run all night.
 *     A screen-off session is still emitted (with `isForeground = true`) because the
 *     user did use the app for that time; time after screen-off is not counted.
 *  3. [flush] closes whatever is open, whenever the caller needs the value — service
 *     shutdown, sync checkpoint, or app exit. It must be safe to call repeatedly.
 *
 * @param deviceId stamped on every emitted session; comes from the app container, not
 *   from this class, so the state machine stays free of persistence concerns.
 * @param appLabelFor resolves a display label for a package name; the caller supplies a
 *   `PackageManager`-backed implementation, tests supply a stub.
 */
class SessionTracker(
    private val deviceId: String,
    private val appLabelFor: (packageName: String) -> String,
) {

    /**
     * Records that [packageName] became the foreground app at [atMillis].
     * Closing and opening the same package is a no-op, so a caller may invoke this on
     * every poll without producing duplicate sessions.
     */
    fun onForegroundChanged(packageName: String, atMillis: Long): Unit =
        TODO("phase-2: close the open session and open one for packageName")

    /**
     * Records that the screen turned off at [atMillis]: the open session ends there and
     * no new session starts until the next foreground transition.
     */
    fun onScreenOff(atMillis: Long): Unit =
        TODO("phase-2: close the open session at atMillis")

    /**
     * Records that the screen turned on at [atMillis]. Screen-on alone does not open a
     * session — the next [onForegroundChanged] does, because the foreground package on
     * wake may be the lock screen.
     */
    fun onScreenOn(atMillis: Long): Unit =
        TODO("phase-2: mark the tracker ready to accept the next foreground transition")

    /**
     * Closes and returns the session that is currently open, or `null` when there is
     * nothing to emit: no session open, or the closed session was shorter than
     * [MIN_SESSION_SECONDS].
     *
     * The short-session rule exists because the usage-stats stream reports a transition
     * for every swipe past the recents carousel; emitting those would flood the sync
     * queue and the activity feed with sub-second noise.
     */
    fun flush(atMillis: Long): AppSession? =
        TODO("phase-2: close, filter by MIN_SESSION_SECONDS, and return the session")

    companion object {

        /**
         * Sessions shorter than this are discarded rather than emitted. Chosen to sit
         * above the app-switcher noise floor and below the shortest deliberate app visit.
         */
        const val MIN_SESSION_SECONDS: Int = 5
    }
}

/**
 * One completed foreground interval, shaped to mirror `AppSessionEvent` in
 * `@second-brain/shared` (`types/activity.ts`).
 *
 * @property startAt ISO-8601 UTC instant, matching the shared `startAt` field; the
 *   tracker's inputs are epoch milliseconds and are converted at this boundary. It is
 *   also the emitted event's `occurredAt` (the shared type states the two are equal for
 *   `app_session`).
 * @property endAt ISO-8601 UTC instant; always after [startAt].
 * @property durationSeconds whole seconds between the two instants, equal to
 *   [endAt] minus [startAt] and always `>= SessionTracker.MIN_SESSION_SECONDS`.
 * @property isForeground always `true` for a session this tracker emits — it only emits
 *   foreground sessions, including one ended by screen-off (the app was on screen for
 *   that time). The field stays explicit so background sessions can be added later
 *   without a wire change.
 */
data class AppSession(
    val deviceId: String,
    val packageName: String,
    val appLabel: String,
    val startAt: String,
    val endAt: String,
    val durationSeconds: Int,
    val isForeground: Boolean,
)
