package com.secondbrain.app.privacy

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow

/**
 * Process-wide Preferences DataStore for user settings.
 *
 * Declared as a `Context` extension delegate because DataStore requires exactly one
 * instance per file per process; opening a second one throws at runtime.
 */
val Context.exclusionDataStore: DataStore<Preferences> by preferencesDataStore(
    name = AppExclusionList.DATASTORE_NAME,
)

/**
 * The set of packages whose activity is never captured.
 *
 * ## The invariant
 *
 * An excluded package is recorded as **nothing at all**: no package name, no label, no
 * duration, no timestamp, and no redacted or hashed row. Not "recorded as unknown" —
 * simply absent, as if the app had never been opened. This is the product's privacy
 * promise, and it is enforced at the watcher: `SessionTracker` is never told about an
 * excluded package, so no event for it is ever constructed, queued or synced.
 *
 * ## Defaults are on
 *
 * [DEFAULT_EXCLUDED_PACKAGES] is applied on first run and covers the categories where
 * accidental capture is most harmful: credentials, banking and brokerage, health, and
 * browsers that can open a private/incognito tab. Users can remove entries — the list is
 * visible and editable in Settings — but the shipped defaults are opt-out, not opt-in.
 * A product decision that a category becomes default-off must be a change here, in the
 * same change as the product spec.
 *
 * ## Read path
 *
 * [isExcluded] is synchronous because the watcher calls it on every poll; it reads an
 * in-memory snapshot that [loadFrom] seeds and [observeExclusions] keeps current. Do not
 * turn it into a suspending DataStore read: the capture loop would then block behind disk
 * I/O on the hot path.
 */
class AppExclusionList private constructor(
    private val dataStore: DataStore<Preferences>,
    initialSnapshot: Set<String>,
) {

    /**
     * In-memory mirror of the persisted set. `@Volatile` because [isExcluded] runs on the
     * capture service's polling coroutine while writes happen on DataStore's dispatcher.
     */
    @Volatile
    private var snapshot: Set<String> = initialSnapshot

    /**
     * Whether [packageName] must not be captured.
     *
     * Callers must check this **before** constructing an event: skipping the check and
     * filtering later is what leaks an excluded app's existence through a retracted row.
     */
    fun isExcluded(packageName: String): Boolean =
        TODO("phase-2: answer from the in-memory snapshot")

    /**
     * Adds [packageName] to the exclusion set and persists the change.
     *
     * Removing capture for an app that is currently in the foreground must also end the
     * open session, so no partial session is emitted after the user excludes it.
     */
    suspend fun exclude(packageName: String): Unit =
        TODO("phase-2: add the package to the persisted set")

    /**
     * Removes [packageName] from the exclusion set, so future sessions for it are
     * captured again. Past exclusions are not retroactive: nothing was recorded while it
     * was excluded, and nothing can be reconstructed.
     */
    suspend fun include(packageName: String): Unit =
        TODO("phase-2: remove the package from the persisted set")

    /**
     * Emits the current exclusion set and every subsequent change.
     *
     * Backed by the DataStore file rather than the in-memory snapshot, so it is the
     * authoritative stream for the settings UI and for tests.
     */
    fun observeExclusions(): Flow<Set<String>> =
        TODO("phase-2: map the DataStore preferences flow to the exclusion set")

    companion object {

        /**
         * DataStore file name. Its directory is excluded from cloud backup and device
         * transfer in `res/xml/data_extraction_rules.xml` and `res/xml/backup_rules.xml`,
         * because the exclusion list is per-device privacy configuration.
         */
        const val DATASTORE_NAME: String = "second_brain_preferences"

        /** Preferences key holding the persisted exclusion set. */
        val EXCLUSIONS_KEY: Preferences.Key<Set<String>> =
            stringSetPreferencesKey("excluded_packages")

        /**
         * The shipped default exclusion set: credentials, banking/finance, health and
         * private-browsing-capable browsers.
         *
         * `com.example.*` entries are placeholders standing in for the real regional
         * apps; the definitive shipped list lives in the product spec and must be copied
         * here verbatim, because an entry a user expects to be excluded but that is
         * missing here is a privacy incident, not a bug.
         */
        val DEFAULT_EXCLUDED_PACKAGES: Set<String> = setOf(
            // Credentials — a captured password-manager session is the worst possible leak.
            "com.agilebits.onepassword",
            "com.dashlane",
            "com.lastpass.lpandroid",
            "com.example.passwordvault",

            // Banking, brokerage and wallets.
            "com.example.bankapp",
            "com.example.brokerage",
            "com.example.cryptowallet",

            // Health and anything a user would treat as medical.
            "com.example.healthapp",
            "com.example.periodtracker",

            // Browsers that can open a private/incognito tab. A tab the user believes is
            // unrecorded must stay unrecorded, and usage stats cannot tell the difference
            // between a normal and a private tab.
            "com.android.chrome",
            "com.brave.browser",
            "com.duckduckgo.mobile.android",
            "org.mozilla.firefox",

            // Identity / government documents.
            "com.example.govid",
        )

        /**
         * Loads the persisted exclusion set and returns a bound instance.
         *
         * On first run (or after a wipe) the persisted set is empty and
         * [DEFAULT_EXCLUDED_PACKAGES] is both returned and written, so a user who never
         * opens Settings still has the defaults applied. The returned instance's
         * [isExcluded] is safe to call synchronously from the capture hot path.
         */
        suspend fun loadFrom(dataStore: DataStore<Preferences>): AppExclusionList =
            TODO("phase-2: read the DataStore, seed defaults on first run, and bind an instance")
    }
}
