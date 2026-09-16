package com.secondbrain.app.sync

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement

/**
 * Wire contract with the backend, plus the Ktor client that pushes batches.
 *
 * Every DTO in this file mirrors a type in `@second-brain/shared`
 * (`packages/shared/src/types/activity.ts`). The TypeScript package is the source of
 * truth; this file is a Kotlin transcription of it and must be changed in the same PR as
 * the shared type. Field names are kept in camelCase exactly as they appear on the wire —
 * do **not** rename them to Kotlin or SQL conventions, and do not add `@SerialName`
 * unless the server genuinely uses a different key.
 *
 * ## Where events are sent
 *
 * Batches go to **`services/ingestion`** at `POST /v1/ingest/batch` (see
 * `docs/ARCHITECTURE.md` → "The sync protocol"), **not** directly to Supabase. There is
 * no insert policy on `activity_events` for an authenticated client, and clients must
 * never write activity directly (ADR-018); the ingestion service owns validation,
 * idempotency and persistence. The scaffolding name of this file predates that decision —
 * a rename to `IngestionClient.kt` is a phase-2 cleanup, not a behaviour change.
 *
 * Runs on the app's own HTTPS origin (`BuildConfig.API_BASE_URL`); Supabase appears only
 * as the **auth** dependency (`auth/AuthManager.kt` speaks to Supabase GoTrue for the
 * user's session) plus the public anon key sent as the `apikey` header.
 *
 * ## Kotlin ↔ TypeScript mapping rules
 *
 * These rules are what keep three implementations of one wire format in step; a fixture
 * set of shared payloads (ADR-019) is the test that enforces them.
 *
 * 1. **`number` is `Double`, unless the field is an integral count.** `importance`
 *    (`[0, 1]`), `watchedPct` (`[0, 1]`) and `scrollDepthPct` (0–100) are `Double`, because
 *    a fractional value decoded into an `Int` fails loudly. Counts, whole seconds,
 *    millisecond durations and byte sizes are `Int`/`Long`, matching the integer columns
 *    the server stores them in.
 * 2. **Required-but-nullable fields are written as JSON `null`**, never omitted — see
 *    [DEFAULT_JSON]. `url: null` on an `app_session` is a present key with a null value,
 *    exactly as the TypeScript clients serialise it.
 * 3. **`receivedAt` is never sent by a client** (the server stamps it on receipt), so it
 *    is `@Transient` here: writing `"receivedAt": null` would fail a server schema that
 *    declares it `.optional()`.
 * 4. **The discriminator is `type`** and is produced by the serialiser from each
 *    subclass's `@SerialName`, never stored as a serialised property.
 */

/**
 * Key under which `kotlinx.serialization` writes the polymorphic type of an
 * [ActivityEvent]. Matches the `type` field of the shared `ActivityEventBase`, so the
 * discriminator the shared TypeScript consumers read is produced automatically.
 */
const val CLASS_DISCRIMINATOR: String = "type"

/**
 * Wire values of `ActivityEventType` in `@second-brain/shared`.
 *
 * The serial names are the contract: they are what lands in the `type` field of every
 * event and what the ingest pipeline switches on.
 */
@Serializable
enum class ActivityEventType {
    @SerialName("page_view")
    PAGE_VIEW,

    @SerialName("page_read")
    PAGE_READ,

    @SerialName("selection")
    SELECTION,

    @SerialName("copy")
    COPY,

    @SerialName("youtube_watch")
    YOUTUBE_WATCH,

    @SerialName("app_session")
    APP_SESSION,

    @SerialName("search")
    SEARCH,

    @SerialName("bookmark")
    BOOKMARK,

    @SerialName("download")
    DOWNLOAD,
}

/**
 * Wire shape of the shared `ActivityEvent` union.
 *
 * Closed (sealed) polymorphism: `kotlinx.serialization` writes
 * `"type": "<subclass @SerialName>"` and uses the same field to pick the subclass when
 * decoding, so an `ActivityBatch` serialises to the shape the shared TypeScript types
 * describe. Decoding an unknown `type` fails loudly, which is intended — the app must not
 * guess at an event family it does not understand.
 *
 * @property id globally unique event id; also the queue row's `event_id`.
 * @property deviceId device that observed the event.
 * @property occurredAt ISO-8601 UTC timestamp of the observation.
 * @property receivedAt server-side ingestion time. Set by the backend on receipt and
 *   never sent by a client, so it is `@Transient` in every subclass.
 * @property importance the client's importance estimate in `[0, 1]`. Advisory only: the
 *   server always re-scores and never trusts this value. `0.0` until scored.
 * @property dedupeKey server-side idempotency key; a repeated key inside one push is a
 *   duplicate, not a new event.
 * @property url canonical URL when the event has one, `null` for app/device events.
 * @property title human-readable title when known.
 * @property metadata free-form side data the pipeline may interpret later; empty by
 *   default and never used for anything the typed fields already carry.
 * @property type derived from the concrete subclass — a body property with no backing
 *   field, so it is never serialised (the discriminator already carries this value on the
 *   wire) and never needs to be passed to a constructor.
 */
@Serializable
@JsonClassDiscriminator(CLASS_DISCRIMINATOR)
sealed interface ActivityEvent {
    val id: String
    val deviceId: String
    val occurredAt: String
    val receivedAt: String?
    val importance: Double
    val dedupeKey: String
    val url: String?
    val title: String?
    val metadata: Map<String, JsonElement>
    val type: ActivityEventType
}

/**
 * `page_view` — a web page was viewed, with dwell time and scroll depth.
 */
@Serializable
@SerialName("page_view")
data class PageViewEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val domain: String,
    val durationMs: Long,
    val scrollDepthPct: Double,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.PAGE_VIEW
}

/**
 * `page_read` — a page the reader actually consumed, with extraction metadata.
 */
@Serializable
@SerialName("page_read")
data class PageReadEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val domain: String,
    val wordCount: Int,
    val readingTimeSeconds: Int,
    val contentHash: String,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.PAGE_READ
}

/**
 * `selection` — text the user highlighted, with just enough context to be re-read later.
 */
@Serializable
@SerialName("selection")
data class SelectionEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val text: String,
    val contextBefore: String,
    val contextAfter: String,
    val selectionLength: Int,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.SELECTION
}

/**
 * `copy` — the user copied text to the clipboard.
 */
@Serializable
@SerialName("copy")
data class CopyEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val text: String,
    val selectionLength: Int,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.COPY
}

/**
 * `youtube_watch` — a YouTube watch session. Produced by the browser extension, never by
 * this app; present here so the shared union stays faithfully represented.
 */
@Serializable
@SerialName("youtube_watch")
data class YouTubeWatchEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val videoId: String,
    val watchedSeconds: Int,
    val watchedPct: Double,
    val transcriptAvailable: Boolean,
    val channelName: String? = null,
    val durationSeconds: Int? = null,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.YOUTUBE_WATCH
}

/**
 * `app_session` — the only event family this app produces in phase-1.
 *
 * Mirrors `AppSessionEvent` in the shared package; `startAt`/`endAt` are ISO-8601 UTC
 * strings and `durationSeconds` is whole seconds. Sessions are produced by
 * `watcher.SessionTracker` from foreground observations.
 */
@Serializable
@SerialName("app_session")
data class AppSessionEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val packageName: String,
    val appLabel: String,
    val startAt: String,
    val endAt: String,
    val durationSeconds: Int,
    val isForeground: Boolean,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.APP_SESSION
}

/**
 * `search` — a search the user ran, with the engine that served it.
 */
@Serializable
@SerialName("search")
data class SearchEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    val query: String,
    val engine: String,
    @Transient override val receivedAt: String? = null,
    override val url: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.SEARCH
}

/**
 * `bookmark` — a bookmark was created. `url` is required here, unlike in the base
 * interface, matching the shared type.
 */
@Serializable
@SerialName("bookmark")
data class BookmarkEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    override val url: String,
    val folder: String? = null,
    @Transient override val receivedAt: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.BOOKMARK
}

/**
 * `download` — a file download completed. `url` is required, matching the shared type.
 */
@Serializable
@SerialName("download")
data class DownloadEvent(
    override val id: String,
    override val deviceId: String,
    override val occurredAt: String,
    override val importance: Double,
    override val dedupeKey: String,
    override val url: String,
    val filename: String,
    val mimeType: String? = null,
    val bytes: Long? = null,
    @Transient override val receivedAt: String? = null,
    override val title: String? = null,
    override val metadata: Map<String, JsonElement> = emptyMap(),
) : ActivityEvent {
    override val type: ActivityEventType get() = ActivityEventType.DOWNLOAD
}

/**
 * Wire shape of the shared `ActivityBatch`: one upload, one device, many events.
 *
 * @property schemaVersion from the shared `SCHEMA_VERSION` constant; the server rejects
 *   a version it does not understand rather than guessing.
 * @property deviceId the device that produced every event in [events]; a batch must
 *   never mix devices.
 * @property clientSentAt ISO-8601 UTC timestamp used to order batches from one device.
 * @property events ordered oldest-first; a single batch may mix event families.
 */
@Serializable
data class ActivityBatch(
    val schemaVersion: Int,
    val deviceId: String,
    val clientSentAt: String,
    val events: List<ActivityEvent>,
)

/**
 * Wire shape of the shared `ActivityBatchResult`: the server's verdict on one batch.
 *
 * @property accepted how many events were stored.
 * @property rejected how many were refused as malformed; their ids are in
 *   [rejectedIds] and they must not be retried forever.
 * @property duplicates how many were already known by `dedupeKey`; a duplicate still
 *   counts as delivered, so its row is acknowledged and deleted.
 * @property serverCursor opaque position marker for the ingestion stream, stored locally
 *   as the device's `cursor`.
 * @property rejectedIds the ids of the rejected events, so the queue can acknowledge the
 *   rest of the batch immediately.
 */
@Serializable
data class ActivityBatchResult(
    val accepted: Int,
    val rejected: Int,
    val duplicates: Int,
    val serverCursor: String,
    val rejectedIds: List<String> = emptyList(),
)

/**
 * Port for pushing a batch of events, independent of transport.
 *
 * Implemented by [IngestionRestClient] in production and by in-memory fakes in tests, so
 * `SyncWorker` can be tested without a network stack.
 */
interface RemoteEventSink {

    /**
     * Uploads [batch] and returns the server's verdict.
     *
     * Contract:
     *  - a successful return is a **per-event** verdict, never a per-batch one. Every
     *    event id is in exactly one of three outcomes, and all three are terminal:
     *    `accepted` (stored), `duplicates` (already known by `(deviceId, dedupeKey)` —
     *    still delivered, so its row is deleted like an accepted one), or
     *    [ActivityBatchResult.rejectedIds] (schema-invalid; removed from the queue and
     *    recorded in `lastError`, because retrying it forever is a queue that never
     *    drains);
     *  - **any thrown exception means "nothing was acknowledged"** — the caller must
     *    leave every row queued and let retry/backoff handle it. Do not throw for partial
     *    success; report it through the result;
     *  - the call must be safe to repeat with the same batch (the server inserts with
     *    `on conflict (device_id, dedupe_key) do nothing`, and the `Idempotency-Key`
     *    header makes the re-send recognisable at the door), because the queue does not
     *    reserve rows.
     */
    suspend fun pushBatch(batch: ActivityBatch): ActivityBatchResult
}

/**
 * Ktor-based [RemoteEventSink] for the ingestion service.
 *
 * One endpoint: `POST {apiBaseUrl}/v1/ingest/batch`. Four credentials ride on the request
 * (ADR-018) and each one answers a different question:
 *
 * | Header | Value | Question it answers |
 * | --- | --- | --- |
 * | `apikey` | Supabase anon key | may this client call the API at all (public value) |
 * | `Authorization` | `Bearer <user JWT>` | which user's history is this (from `AuthManager`) |
 * | `X-Device-Secret` | per-device ingest secret | which of that user's devices produced it |
 * | `Idempotency-Key` | hash of the batch's event ids | was this exact batch already seen |
 *
 * @param apiBaseUrl first-party API origin, from `BuildConfig.API_BASE_URL`. Not the
 *   Supabase project URL: events do not go to Supabase directly.
 * @param anonKey public Supabase anon key, from `BuildConfig.SUPABASE_ANON_KEY`. It is a
 *   client-side value and is not a secret — it grants nothing without a user JWT, which
 *   is what makes row-level security load-bearing.
 * @param httpClient shared client from the app container; owns connection pooling.
 * @param accessTokenProvider supplies the signed-in user's access token. A suspend lambda
 *   rather than an `AuthManager` reference keeps this class free of a dependency cycle
 *   with the auth layer. Returning `null` means unauthenticated; the request is still
 *   sent, the server answers 401, and the caller keeps every row queued.
 * @param deviceSecretProvider supplies this device's ingest secret, issued server-side at
 *   device registration and stored encrypted. Returning `null` means the device is not
 *   registered yet, which the server answers with 401/403 — never a silent drop.
 * @param deviceId the device these events belong to; also inside `batch.deviceId`, and
 *   the server rejects a mismatch rather than trusting the body.
 * @param json wire configuration; defaults to [DEFAULT_JSON], the same configuration the
 *   queue serialises with.
 */
class IngestionRestClient(
    private val apiBaseUrl: String,
    private val anonKey: String,
    private val deviceId: String,
    private val httpClient: HttpClient = defaultHttpClient(),
    private val accessTokenProvider: suspend () -> String? = { null },
    private val deviceSecretProvider: suspend () -> String? = { null },
    private val json: Json = DEFAULT_JSON,
) : RemoteEventSink {

    /**
     * POSTs [batch] to [BATCH_PATH] and decodes the verdict.
     *
     * Phase-2 adds the request itself: the four headers above, the JSON body serialised
     * with [json], and `ActivityBatchResult` decoded from the 200 response. Failure
     * mapping is the caller's contract, but the split is fixed by the protocol:
     *
     *  - transport failure, timeout, 5xx, 429 ⇒ throw / surface as retryable, so
     *    `SyncWorker` returns `Result.retry()` and every row stays queued;
     *  - 401 ⇒ the caller refreshes the session and retries once, then stops;
     *  - 403 `device_revoked` ⇒ non-retryable: capture must stop and the UI must say so;
     *  - 400 schema error ⇒ non-retryable per event: the ids in `rejectedIds` are removed
     *    from the queue and the first reason is recorded in `lastError`.
     *
     * The request must not log the access token, the device secret, or the response body
     * at info level — event payloads are private user data.
     */
    override suspend fun pushBatch(batch: ActivityBatch): ActivityBatchResult =
        TODO("phase-2: POST the batch to BATCH_PATH with the four credentials and decode the result")

    companion object {

        /** Path of the ingest endpoint, relative to `BuildConfig.API_BASE_URL`. */
        const val BATCH_PATH: String = "/v1/ingest/batch"

        /** Header carrying the public Supabase anon key. */
        const val HEADER_API_KEY: String = "apikey"

        /** Header carrying the per-device ingest secret, validated against `devices.ingest_secret_hash`. */
        const val HEADER_DEVICE_SECRET: String = "X-Device-Secret"

        /**
         * Header carrying a hash of the batch's event ids, so a re-sent batch is
         * recognised at the door before any per-event work happens.
         */
        const val HEADER_IDEMPOTENCY_KEY: String = "Idempotency-Key"

        /** Whole-request timeout. Generous: this runs in a background worker. */
        const val REQUEST_TIMEOUT_MILLIS: Long = 30_000L

        /** Connection timeout, kept short so an offline device fails fast into backoff. */
        const val CONNECT_TIMEOUT_MILLIS: Long = 10_000L

        /**
         * The one wire configuration for this app.
         *
         *  - `classDiscriminator = "type"` reproduces the shared union's discriminator.
         *  - `ignoreUnknownKeys` lets the server add fields without breaking old clients.
         *  - `encodeDefaults = true` writes explicit defaults — `metadata = {}`,
         *    `folder = null`, `mimeType = null` — matching the TypeScript clients, which
         *    always serialise these keys because their types require them.
         *  - `explicitNulls = true` (the kotlinx default, set explicitly because it is
         *    load-bearing) writes `url: null` / `title: null` instead of omitting them.
         *    Those keys are required-but-nullable in the shared types, so a server schema
         *    built from them accepts `null` but may reject a missing key — an omitted
         *    `url` would reject every `app_session`, since a session has no URL.
         *
         * The one field that must *not* be written when absent is `receivedAt`, which is
         * handled per property with `@Transient` rather than globally, because it is
         * optional on the wire (`.optional()`, not `.nullable()`).
         */
        val DEFAULT_JSON: Json = Json {
            classDiscriminator = CLASS_DISCRIMINATOR
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
        }

        /**
         * Builds the shared HTTP client: OkHttp engine on Android, JSON content
         * negotiation using [json], explicit timeouts, and `expectSuccess` so a non-2xx
         * response throws instead of being handed to the call site as a body to parse.
         */
        fun defaultHttpClient(json: Json = DEFAULT_JSON): HttpClient =
            HttpClient(OkHttp) {
                expectSuccess = true
                install(ContentNegotiation) {
                    json(json)
                }
                install(HttpTimeout) {
                    requestTimeoutMillis = REQUEST_TIMEOUT_MILLIS
                    connectTimeoutMillis = CONNECT_TIMEOUT_MILLIS
                }
            }
    }
}
