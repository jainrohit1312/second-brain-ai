package com.secondbrain.app

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.work.Configuration
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.WorkManager
import com.secondbrain.app.auth.AuthManager
import com.secondbrain.app.auth.DeviceIdentity
import com.secondbrain.app.privacy.AppExclusionList
import com.secondbrain.app.privacy.exclusionDataStore
import com.secondbrain.app.queue.LocalQueue
import com.secondbrain.app.queue.QueueDatabase
import com.secondbrain.app.sync.IngestionRestClient
import com.secondbrain.app.sync.RemoteEventSink
import com.secondbrain.app.sync.SyncWorker
import io.ktor.client.HttpClient

/**
 * Application entry point.
 *
 * Owns the hand-rolled [AppContainer] (no Hilt in this project — one container, built
 * in `onCreate`, is enough for a single-module app) and schedules the periodic sync.
 */
class SecondBrainApp : Application(), Configuration.Provider {

    /**
     * Process-wide dependency container. Android components reach it through
     * `(application as SecondBrainApp).container`; nothing else constructs
     * collaborators, so the object graph stays acyclic and inspectable.
     */
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        schedulePeriodicSync()
    }

    /**
     * WorkManager configuration for the *default* initializer.
     *
     * We deliberately keep the default initializer (`androidx.startup`) instead of
     * implementing on-demand initialization: nothing in this app starts WorkManager
     * before `Application.onCreate` returns. Implementing [Configuration.Provider] is
     * what makes that safe — WorkManager reads this configuration automatically, so no
     * `Configuration` argument is ever passed by hand. Removing the
     * `androidx.work.WorkManagerInitializer` from the manifest would require switching
     * to on-demand `WorkManager.initialize(this, config)` and calling it before any
     * `WorkManager.getInstance`.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(Log.INFO)
            .build()

    /**
     * Enqueues the periodic [SyncWorker] with [ExistingPeriodicWorkPolicy.KEEP], so
     * upgrading or relaunching the app never resets the schedule and never stacks
     * duplicate work. Phase-2 replaces this with a runtime toggle driven by the
     * user's capture setting.
     */
    private fun schedulePeriodicSync() {
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            SyncWorker.periodicRequest(),
        )
    }
}

/**
 * Hand-rolled dependency container.
 *
 * Every collaborator is a `lazy` singleton scoped to the application process, and the
 * only external inputs are `BuildConfig` values plus the application [Context].
 * Callers get interfaces ([RemoteEventSink]) rather than implementations wherever one
 * exists, so phase-2 can swap in fakes for tests without touching call sites.
 */
class AppContainer(context: Context) {

    private val appContext: Context = context.applicationContext

    /** Room database holding the durable capture queue. */
    val database: QueueDatabase by lazy { QueueDatabase.getInstance(appContext) }

    /** Repository facade over [database]; the only writer of queued events. */
    val localQueue: LocalQueue by lazy { LocalQueue(database.queueDao()) }

    /**
     * Single Ktor client for the whole process: connection pooling and the OkHttp
     * dispatcher are expensive to duplicate per feature.
     */
    val httpClient: HttpClient by lazy { IngestionRestClient.defaultHttpClient() }

    /** Session ownership: sign-in, refresh, sign-out and the encrypted token store. */
    val authManager: AuthManager by lazy {
        AuthManager(
            context = appContext,
            baseUrl = BuildConfig.SUPABASE_URL,
            anonKey = BuildConfig.SUPABASE_ANON_KEY,
            httpClient = httpClient,
        )
    }

    /**
     * Stable per-install identifier stamped on every queued event as `deviceId`.
     * Generated once and persisted in encrypted preferences; it is not the user id.
     */
    val deviceId: String by lazy { DeviceIdentity.getOrCreate(appContext) }

    /**
     * Base URL of the first-party API (`services/ingestion` for writes;
     * search/retrieval later). Not the Supabase project URL: clients never write activity
     * to Supabase directly (ADR-018).
     */
    val apiBaseUrl: String = BuildConfig.API_BASE_URL

    /**
     * Outbound event transport used by `SyncWorker`.
     *
     * Two credentials are resolved lazily, per request, so a refreshed session or a newly
     * registered device secret is picked up without rebuilding the container.
     */
    val remoteSink: RemoteEventSink by lazy {
        IngestionRestClient(
            apiBaseUrl = apiBaseUrl,
            anonKey = BuildConfig.SUPABASE_ANON_KEY,
            deviceId = deviceId,
            httpClient = httpClient,
            accessTokenProvider = { authManager.accessToken() },
            deviceSecretProvider = { authManager.deviceSecret() },
        )
    }

    /**
     * Loads the privacy exclusion list from its DataStore.
     *
     * Suspending because the first read hits disk; the returned instance exposes a
     * synchronous [AppExclusionList.isExcluded] for the watcher's hot path.
     */
    suspend fun loadExclusionList(): AppExclusionList =
        AppExclusionList.loadFrom(appContext.exclusionDataStore)
}
