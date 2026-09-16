package com.secondbrain.app.auth

import android.content.Context
import android.content.SharedPreferences
import io.ktor.client.HttpClient
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Whether this device currently holds a usable session.
 *
 * A sealed hierarchy rather than a nullable user id so that callers cannot forget the
 * "token expires soon" case: `Authenticated` means a request will succeed now, and
 * `Expiring` means it may still succeed but a refresh should be attempted first.
 */
sealed interface SessionState {

    /** No session, or the session was cleared because the refresh token was rejected. */
    data object Unauthenticated : SessionState

    /**
     * A session that will outlive the next few requests.
     *
     * @property expiresAt access-token expiry; the refresh token outlives it.
     */
    data class Authenticated(val userId: String, val expiresAt: Instant) : SessionState

    /**
     * A session whose access token expires inside the refresh window. Requests may still
     * be attempted (the server decides), but [AuthManager.refreshSession] should run
     * before anything user-visible.
     */
    data class Expiring(val userId: String, val expiresAt: Instant) : SessionState
}

/**
 * The persisted session, serialised to JSON and stored encrypted.
 *
 * Wire names are snake_case because these are Supabase's GoTrue response fields —
 * they are stored as received, so no mapping layer is needed and no field can be
 * silently dropped. This type never crosses the network in this app.
 *
 * @property refreshToken the sensitive secret: long-lived, and the one value that grants
 *   continued access. It must never be logged, never placed in a crash report, never put
 *   in an analytics event and never written anywhere but the encrypted store.
 * @property expiresAtEpochSeconds absolute expiry of [accessToken], in epoch seconds
 *   (GoTrue's `expires_at` form, not `expires_in`).
 */
@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_at") val expiresAtEpochSeconds: Long,
    @SerialName("user_id") val userId: String,
    @SerialName("token_type") val tokenType: String = "bearer",
)

/**
 * Owns the device's authentication session: sign-in, refresh, sign-out and the encrypted
 * persistence behind them.
 *
 * ## Secrets
 *
 * The refresh token is the secret; the Supabase **anon key is not** — it is a
 * client-side build value compiled into the APK (see `BuildConfig.SUPABASE_ANON_KEY`) and
 * is protected by row-level security, not by secrecy. The access token lives in memory
 * and in the encrypted store, and neither token may be logged or attached to telemetry.
 *
 * ## Storage
 *
 * Tokens are persisted with `EncryptedSharedPreferences` (AES-256-GCM values under a
 * Keystore-backed master key) in [SESSION_PREFS_NAME]; that file is excluded from cloud
 * backup and device transfer in `res/xml/data_extraction_rules.xml`, so a session cannot
 * be restored onto a different device.
 *
 * ## Sign-out semantics
 *
 * [signOut] clears the session and the stored tokens. It must **not** clear the capture
 * queue: queued events still belong to this user's history, and they upload on the next
 * sign-in. A device that signs out keeps capturing locally.
 *
 * @param context any context; the application context is extracted internally.
 * @param baseUrl Supabase project URL (`BuildConfig.SUPABASE_URL`).
 * @param anonKey public anon key; required on every GoTrue request.
 * @param httpClient shared Ktor client from the app container.
 */
class AuthManager(
    context: Context,
    private val baseUrl: String,
    private val anonKey: String,
    private val httpClient: HttpClient,
) {

    private val appContext: Context = context.applicationContext

    private val _sessionState = MutableStateFlow<SessionState>(SessionState.Unauthenticated)

    /**
     * Current session state for the UI. Updated on every successful sign-in, refresh and
     * sign-out, and after any refresh rejection.
     */
    val sessionState: StateFlow<SessionState> = _sessionState.asStateFlow()

    /**
     * Signs in with email and password and persists the resulting session.
     *
     * Contract: on success the session is written to encrypted storage *before* this
     * returns, and [sessionState] becomes `Authenticated`. On failure nothing is written
     * and the previous session (if any) is left untouched. Callers must not log the
     * password, and the failure message surfaced to the user must be generic — GoTrue
     * distinguishes "wrong password" from "no such user", and that distinction is an
     * account-enumeration leak.
     */
    suspend fun signIn(email: String, password: String): Unit =
        TODO("phase-2: POST /auth/v1/token?grant_type=password and persist the session")

    /**
     * Exchanges the stored refresh token for a new access token.
     *
     * Contract: called before a request that needs a fresh token, and by the sync worker
     * when it gets a 401. A rejected refresh token (revoked device, expired session)
     * means the only correct response is to clear the session and move to
     * `Unauthenticated` — retrying a rejected refresh token is an infinite loop.
     */
    suspend fun refreshSession(): Unit =
        TODO("phase-2: POST /auth/v1/token?grant_type=refresh_token and persist the result")

    /**
     * Clears the session locally and remotely (best effort) and moves to
     * `Unauthenticated`.
     *
     * The remote revoke failing must not leave the local session in place: local state is
     * cleared regardless, because the user asked to be signed out. The capture queue is
     * deliberately left intact.
     */
    suspend fun signOut(): Unit =
        TODO("phase-2: revoke the refresh token, then delete the encrypted session file")

    /**
     * The signed-in user's id, or `null` when there is no valid session.
     *
     * Synchronous on purpose: it reads the in-memory session state, so it may be called
     * from the UI without suspending. It never performs I/O and never refreshes — call
     * [refreshSession] explicitly if a fresh token is required.
     */
    fun currentUserId(): String? =
        TODO("phase-2: read the user id from the in-memory session state")

    /**
     * The access token to attach to an API request, or `null` when unauthenticated.
     *
     * Returns the stored token without refreshing; a caller that needs a guaranteed-valid
     * token must await [refreshSession] first. The value is a bearer credential: pass it
     * to the HTTP layer only, never to a log statement or a UI string.
     */
    suspend fun accessToken(): String? =
        TODO("phase-2: return the current access token from the encrypted session")

    /**
     * This device's ingest secret, or `null` when the device is not registered yet.
     *
     * Sent as the `X-Device-Secret` header on every ingest request; the ingestion service
     * verifies it against `devices.ingest_secret_hash` and rejects a mismatch, so the
     * secret is what authenticates the *device* (the JWT authenticates the *user*).
     * It is issued server-side at device registration — a client cannot mint its own,
     * because that would let a compromised client create a device the user never
     * authorised. Like the refresh token, it is a bearer secret: keep it in the encrypted
     * store, and never log it, never send it anywhere but the ingest endpoint, and never
     * put it in a crash report.
     */
    suspend fun deviceSecret(): String? =
        TODO("phase-2: return the stored per-device ingest secret")

    /**
     * The encrypted preferences file backing the session, created on first access.
     *
     * Kept private: the `SharedPreferences` object exposes raw tokens, so the only code
     * allowed to hold it is this class.
     */
    private val securePreferences: SharedPreferences by lazy {
        createSessionStore(appContext)
    }

    companion object {

        /**
         * Encrypted preferences file name. Excluded from backup and device transfer in
         * `res/xml/data_extraction_rules.xml` and `res/xml/backup_rules.xml` — rename it
         * and those files must be updated in the same change.
         */
        const val SESSION_PREFS_NAME: String = "second_brain_session"

        /** Key of the serialised [AuthSession] inside [SESSION_PREFS_NAME]. */
        const val SESSION_KEY: String = "auth_session"

        /** Key of the per-device ingest secret inside [SESSION_PREFS_NAME]. */
        const val DEVICE_SECRET_KEY: String = "device_secret"

        /**
         * Creates the encrypted store: a Keystore-backed `MasterKey` plus
         * `EncryptedSharedPreferences` for both keys and values.
         *
         * A `MasterKey` failure (wiped Keystore, restored backup) must be treated as
         * "no session" rather than a crash: the user signs in again and nothing else
         * breaks.
         */
        fun createSessionStore(context: Context): SharedPreferences =
            TODO("phase-2: build the MasterKey and open EncryptedSharedPreferences")

        /**
         * GoTrue password-grant path used by [signIn], relative to `BuildConfig.SUPABASE_URL`.
         */
        const val TOKEN_PATH: String = "/auth/v1/token"
    }
}

/**
 * Stable per-install device identifier.
 *
 * Distinct from the user id and from any Supabase auth identifier: one user may have
 * several devices, and every queued event is stamped with the device that observed it.
 * The id is generated once and persisted, and survives sign-out so that a device's
 * contribution to a user's history stays attributable across sessions. It is not a
 * privacy identifier for third parties — it is only ever sent to this app's own backend,
 * alongside the user's own authenticated session.
 */
object DeviceIdentity {

    /** Key of the device id inside the encrypted session store. */
    const val KEY_DEVICE_ID: String = "device_id"

    /**
     * Returns the persisted device id, generating and persisting a new one on first call.
     *
     * Stored alongside the session (encrypted) rather than in plain preferences so that
     * one storage decision covers every identifier this app holds.
     */
    fun getOrCreate(context: Context): String =
        TODO("phase-2: read the stored device id, or generate a UUID, persist it and return it")
}
