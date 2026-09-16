# Second Brain — Android

Kotlin + Jetpack Compose app that captures foreground app sessions on the device, queues
them durably, and syncs them to `services/ingestion` in batches.

> **Status: scaffold.** Structure, contracts, and configuration only. Every function that
> would do real work carries a `TODO("phase-2: ...")` body, and there is no Gradle wrapper
> yet (see [Bootstrap](#bootstrap-the-gradle-wrapper)).

## Status

What exists today:

| Area                     | State                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradle build             | Real. AGP 8.5.2 / Kotlin 2.0.21 / compileSdk 35 / minSdk 26 / Java 17, all versions in `gradle/libs.versions.toml`.                               |
| Manifest                 | Real and coherent: permissions, foreground service with `foregroundServiceType="dataSync"`, backup/transfer rules, Compose launcher activity.     |
| Wire contract            | Real. `sync/SupabaseClient.kt` transcribes the shared `ActivityEvent` union, `ActivityBatch`, and `ActivityBatchResult` as `@Serializable` types. |
| Interfaces and contracts | Real, with KDoc stating units, invariants, and callers.                                                                                           |
| Behaviour                | **Not implemented.** `watcher/`, `queue/`, `sync/`, `auth/`, `privacy/` bodies are `TODO("phase-2: ...")`.                                        |
| UI                       | Navigation shell and placeholder screens only (`Activity`, `Search`, `Settings`), plus a real Material 3 theme.                                   |

Deliberately **not** in this scaffold, each with a reason:

- **No Gradle wrapper** (`gradlew`, `gradlew.bat`, `gradle/wrapper/*`): those are generated
  binaries. Run `gradle wrapper --gradle-version 8.9` once — see
  [Bootstrap](#bootstrap-the-gradle-wrapper).
- **No launcher icon assets.** Notification small icon (`res/drawable/ic_stat_capture.xml`)
  exists because the foreground service needs one; adaptive-icon mipmaps are an asset task.
- **No test sources.** Test dependencies (JUnit4, `androidx.test.ext:junit`, Espresso,
  `room-testing`) and their source sets are wired; the tests themselves are phase-2.
- **No local pre-score.** `ImportanceSignals` → `ImportanceScore` is phase-2 and is gated
  on the shared fixture set existing first (ADR-009).
- **No queue bound.** `docs/ARCHITECTURE.md` requires a max-count/max-age bound on the
  queue with the lowest-importance entries dropped first; the DAO exposes
  `deleteOlderThan` (max age) and the count/importance bound is phase-2.
- **No device registration call.** Device registration is a server-side operation with an
  endpoint that ADR-018 lists as an open phase-1 question; `AuthManager.deviceSecret()`
  reads whatever registration stored.
- **No `DeviceSyncState` persistence.** `cursor` / `lastSyncedAt` / `lastError` are
  mirrored locally per the architecture, but the store for them is phase-2.

## Layout

```
apps/android/
├── settings.gradle.kts                 pluginManagement + FAIL_ON_PROJECT_REPOS, :app
├── build.gradle.kts                    plugin versions from the catalog, applied by :app
├── gradle.properties                   JVM args, AndroidX, caching, config cache, env-var notes
├── gradle/libs.versions.toml           every version in the build
├── README.md                           this file
└── app/
    ├── build.gradle.kts                Android config, BuildConfig fields, Room/KSP, deps
    ├── proguard-rules.pro              keep rules: kotlinx.serialization, Room, Ktor, coroutines
    └── src/main/
        ├── AndroidManifest.xml         permissions, foreground service, backup rules
        ├── res/values/strings.xml      notification, permission rationale, nav and settings strings
        ├── res/values/themes.xml       minimal window theme; Compose owns the real theme
        ├── res/xml/data_extraction_rules.xml   API 31+ backup/transfer exclusions
        ├── res/xml/backup_rules.xml            API ≤30 backup exclusions
        ├── res/drawable/ic_stat_capture.xml    notification small icon
        └── java/com/secondbrain/app/
            ├── SecondBrainApp.kt       Application + hand-rolled AppContainer + sync scheduling
            ├── MainActivity.kt         Compose host, NavHost (activity/search/settings)
            ├── watcher/
            │   ├── UsageStatsWatcher.kt     foreground service, 5 s poll loop
            │   ├── ForegroundAppDetector.kt UsageStatsManager reads + permission check
            │   └── SessionTracker.kt        pure state machine → AppSession
            ├── queue/
            │   ├── LocalQueue.kt            QueueEntity + repository facade
            │   ├── QueueDao.kt              inserts, peekBatch, delete-on-ack, retention
            │   └── QueueDatabase.kt         Room database, singleton builder
            ├── sync/
            │   ├── SupabaseClient.kt        wire DTOs + RemoteEventSink + Ktor client
            │   └── SyncWorker.kt            CoroutineWorker, backoff, batch bound
            ├── auth/AuthManager.kt          encrypted session, SessionState, DeviceIdentity
            ├── privacy/AppExclusionList.kt   default-on exclusion set in DataStore
            └── ui/theme/                    Theme.kt, Color.kt, Type.kt (Material 3)
```

## Scripts

This workspace is **not** a pnpm package and is not part of the Turborepo pipeline
(ADR-019). `pnpm build`, `pnpm test`, and `pnpm lint` do not touch it. Its tasks are Gradle
tasks, run from `apps/android`:

| Command                                    | What it does                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `gradle wrapper --gradle-version 8.9`      | One-time bootstrap: generates `gradlew`/`gradlew.bat` and the wrapper JAR.                         |
| `./gradlew :app:assembleDebug`             | Builds the debug APK.                                                                              |
| `./gradlew :app:installDebug`              | Installs on a connected device or emulator.                                                        |
| `./gradlew :app:testDebugUnitTest`         | JVM unit tests (`SessionTracker`, queue mapping, DTO round-trips).                                 |
| `./gradlew :app:connectedDebugAndroidTest` | Instrumented tests (Room via `room-testing`, Compose/Espresso).                                    |
| `./gradlew :app:lintDebug`                 | Android lint; the `PACKAGE_USAGE_STATS` and `QUERY_ALL_PACKAGES` suppressions are in the manifest. |
| `./gradlew :app:bundleRelease`             | Release App Bundle (minified; needs a signing config, below).                                      |
| `./gradlew clean`                          | Deletes build outputs (not `~/.gradle` caches).                                                    |

### Bootstrap the Gradle wrapper

The wrapper is not committed — `gradlew`, `gradlew.bat`, and
`gradle/wrapper/gradle-wrapper.jar` are generated binaries and are out of scope for a
text-only scaffold. Before the first build, from `apps/android`, run once with a local
Gradle 8.7+ installation:

```bash
gradle wrapper --gradle-version 8.9 --distribution-type bin
./gradlew --version   # verifies the wrapper and downloads the distribution
```

Commit the generated wrapper afterwards: pinning the Gradle version in-repo is what makes
the build reproducible. Requires **JDK 17** (`JAVA_HOME`), which is also the
`compileOptions`/`kotlin.jvmToolchain` target.

## Configuration

### Versions

Every version lives in `gradle/libs.versions.toml` and is referenced as `libs.*`:

| Dependency                         | Version               | Notes                                                                                           |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| AGP                                | 8.5.2                 | needs Gradle 8.7+                                                                               |
| Kotlin                             | 2.0.21                | Compose compiler comes from the Kotlin plugin (`kotlin.plugin.compose`), not a separate version |
| KSP                                | 2.0.21-1.0.25         | versioned against Kotlin; compiles Room                                                         |
| Compose BOM                        | 2024.09.03            | governs every `androidx.compose.*` version                                                      |
| Room / WorkManager / DataStore     | 2.6.1 / 2.9.1 / 1.1.1 | queue, sync scheduling, preferences                                                             |
| Ktor                               | 2.3.12                | OkHttp engine, content negotiation, kotlinx-json                                                |
| kotlinx-serialization / coroutines | 1.7.3 / 1.9.0         | wire format and async                                                                           |

### Build-time values

Three values are compiled into `BuildConfig`. `app/build.gradle.kts` resolves each one in
this order, and an absent value resolves to an empty string (a debug build must not fail
because a developer has no backend yet):

1. a Gradle property — `-PSECOND_BRAIN_SUPABASE_URL=...`
2. an environment variable (CI)
3. `local.properties` (developer machine, git-ignored)

| Key → `BuildConfig` field                              | Example                                | Used for                                        |
| ------------------------------------------------------ | -------------------------------------- | ----------------------------------------------- |
| `SECOND_BRAIN_API_BASE_URL` → `API_BASE_URL`           | `https://api.example.invalid`          | `POST /v1/ingest/batch` on `services/ingestion` |
| `SECOND_BRAIN_SUPABASE_URL` → `SUPABASE_URL`           | `https://YOUR_PROJECT_REF.supabase.co` | Supabase Auth (GoTrue) base URL                 |
| `SECOND_BRAIN_SUPABASE_ANON_KEY` → `SUPABASE_ANON_KEY` | `YOUR_ANON_KEY_HERE`                   | public `apikey` header on ingest requests       |

Only the **anon** key belongs here. It is safe in a client bundle because it grants
nothing without a user JWT — RLS is what protects data. The `service_role` key must never
be referenced by any client workspace (ADR-018). Nothing in this app writes activity to
Supabase directly: the only write path is the ingestion service.

Re-run the build after changing any value — `BuildConfig` fields are baked in at compile
time.

### Signing (release)

No keystore is committed. `bundleRelease` needs a `signingConfigs` block populated from
`local.properties` or CI secrets; that is a phase-2 task alongside the Play Store
submission (which also needs the `QUERY_ALL_PACKAGES` declaration, below).

## Permissions and special access

| Permission                                           | Why                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PACKAGE_USAGE_STATS`                                | **Special access**, not a runtime permission. Required to read foreground app sessions. Declared with `tools:ignore="ProtectedPermissions"`. |
| `INTERNET`, `ACCESS_NETWORK_STATE`                   | Ingest uploads, and `SyncWorker`'s pre-flight network check.                                                                                 |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | The capture service runs in the foreground with `foregroundServiceType="dataSync"`.                                                          |
| `POST_NOTIFICATIONS`                                 | The ongoing capture notification must be visible on API 33+; the user is asked at runtime.                                                   |
| `RECEIVE_BOOT_COMPLETED`                             | WorkManager's boot receiver reschedules pending sync work after a reboot; declared explicitly rather than relying on manifest merging.       |
| `QUERY_ALL_PACKAGES`                                 | Resolve human-readable app labels for the exclusion list (see below).                                                                        |

### `PACKAGE_USAGE_STATS` — the special grant

There is no `requestPermissions()` call for this. The user grants it in system settings:

```
Settings > Apps > Special app access > Usage access > Second Brain > Allow
```

Until then, `UsageStatsManager.queryEvents` returns an **empty cursor**: no exception, no
crash, no log line, just an empty activity feed. Consequences the product must handle:

- every screen that shows captured data needs an empty state that links to the path above
  (`ForegroundAppDetector.hasUsageStatsPermission` is the check, `strings.xml` has the
  rationale copy);
- capture must never be described as "working" while the grant is missing;
- revoking the grant revokes capture entirely and visibly, which is a feature: the user can
  turn the whole capability off from a system screen, without uninstalling.

### The ongoing notification

While capture is on, the user always sees the notification built in
`UsageStatsWatcher.buildNotification()` — silent, ongoing, tap-to-open, channel
`second_brain_capture` (low importance). That is deliberate transparency, not incidental:
the app records what you use, and it says so the entire time. Stopping capture (via
`UsageStatsWatcher.stop`) removes it.

### `QUERY_ALL_PACKAGES`, and the `<queries>` alternative

`QUERY_ALL_PACKAGES` is used **instead of** a `<queries>` block, for one reason: the
exclusion list is user-editable, so the set of apps whose labels must be resolved cannot be
enumerated at build time. A `<queries>` allowlist (the usual alternative, e.g.
`ACTION_MAIN`/`CATEGORY_LAUNCHER`) only covers packages with a launcher entry, while usage
stats can report packages that have none — and those are exactly the packages a user might
want to exclude.

Cost and mitigation: this permission needs a Play Store declaration form, and the app
degrades gracefully without it. Labels fall back to the raw package name, and exclusion
still works, because exclusion is keyed on the package name — never on the label. If the
declaration is refused, switch to a `<queries>` block and accept the label gap.

`android:usesCleartextTraffic="false"` is set: all traffic (ingest and auth) is HTTPS.

## Privacy model

**An excluded package is recorded as nothing at all.** No package name, no label, no
duration, no timestamp, and no redacted or hashed row — as if the app had never been
opened. This is enforced at the earliest possible point: `AppExclusionList.isExcluded`
runs _before_ an event object is constructed, so nothing is written to Room, nothing is
counted locally, and nothing can be re-derived later from the queue. Filtering after the
fact (or marking a row "excluded") is a bug, not an optimisation.

Defaults are **on**, not opt-in:

- passwords and 2FA (`com.agilebits.onepassword`, `com.dashlane`, `com.lastpass.lpandroid`, …)
- banking, brokerage, and wallets
- health and medical
- browsers that can open a private/incognito tab — usage stats cannot distinguish a normal
  tab from a private one, so a tab the user believes is unrecorded stays unrecorded

The list is visible and editable in Settings (`AppExclusionList.exclude` / `include`).
`com.example.*` entries are placeholders for the real regional apps; the definitive shipped
list is defined in the product spec and copied into
`AppExclusionList.DEFAULT_EXCLUDED_PACKAGES` verbatim. A missing entry that a user expects
to be excluded is a privacy incident, not a bug.

Nothing here reads screen content, window titles, UI hierarchies, or pixels. An
`app_session` carries `packageName`, `appLabel`, `startAt`, `endAt`, `durationSeconds`,
`isForeground` — and that is the complete set of what Android contributes (ADR-012).

### What is never backed up

`res/xml/data_extraction_rules.xml` (API 31+) and `res/xml/backup_rules.xml` (API ≤30)
exclude from **both** cloud backup and device transfer:

- the Room database `second_brain_queue.db` (plus `-wal` / `-shm`),
- the encrypted session store `second_brain_session.xml` (access + refresh token, device
  secret, device id),
- the `datastore/` directory (`second_brain_preferences.preferences_pb`, the exclusion
  list).

The queue is per-device outbound state whose rows belong to the device that created them,
and restoring a refresh token onto a different device is credential relocation. Renaming
any of those files means editing both XML files in the same change.

## Capture → queue → sync

```
UsageStatsWatcher (foreground service, 5 s poll)
   │  ForegroundAppDetector.detectForegroundPackage()      ← needs PACKAGE_USAGE_STATS
   │  AppExclusionList.isExcluded(pkg)?  ── true ──► nothing is created, ever
   ▼
SessionTracker (pure state machine)                         MIN_SESSION_SECONDS = 5
   │  onForegroundChanged / onScreenOff / onScreenOn / flush
   ▼
AppSession  ──►  LocalQueue.enqueue(AppSessionEvent)        Room, committed before return
   │                                                        ← durability boundary
   ▼
SyncWorker (periodic 15 min, network constraint, 5 batches/run)
   │  LocalQueue.peekBatch(100)      occurredAt ASC, id tiebreak
   │  RemoteEventSink.pushBatch(ActivityBatch)
   ▼
POST {API_BASE_URL}/v1/ingest/batch        services/ingestion
     apikey: <anon key>
     Authorization: Bearer <user JWT>
     X-Device-Secret: <per-device secret>
     Idempotency-Key: <hash of the batch's event ids>
   │
   ▼
ActivityBatchResult { accepted, rejected, duplicates, serverCursor, rejectedIds }
   │
   ▼
LocalQueue.acknowledge(ids of accepted + duplicates + rejected)
```

### Why the queue is the source of truth

An event has exactly one durable home at a time: the device's Room database before
acknowledgement, Postgres after it. There is no window in which the only copy is in memory,
which is why:

- **`Result.retry()` is the only correct outcome for a transient failure.** A 500, a
  timeout, or a lost response leaves every row on disk; `SYNC_BATCH_SIZE` (100) bounds one
  request, `MAX_BATCHES_PER_RUN` (5) bounds one wake-up, and a week offline becomes a large
  backlog rather than data loss.
- **Retries are safe.** The server inserts with
  `on conflict (device_id, dedupe_key) do nothing`, so a re-sent batch returns
  `duplicates: N` and writes nothing twice. The client never has to reason about whether a
  request "went through" — it re-sends and reads the verdict.
- **A stuck queue is visible.** Pending count and `lastError` are surfaced in Settings
  ("412 events pending, last error: 401"), which is the one case the server cannot detect on
  its own.
- **Acknowledgement is per event, never per batch.** `accepted`, `duplicates`, and
  `rejectedIds` are all terminal and all deleted; anything not in those lists stays queued.
  `rejectedIds` are dropped _and recorded_ rather than retried forever, because a queue that
  never drains captures nothing at all.

`dedupeKey` must be produced by the same algorithm as the extension and the server's
backfill re-derivation — for an `app_session` that means the package name plus a time
bucket, never the event `id` and nothing that varies per delivery attempt. The
cross-platform fixture set (ADR-019) must exist before the Kotlin implementation does, and
it is the only thing that keeps three implementations honest.

### Wire-format parity with the other clients

Three implementations produce this one wire format — the extension, this app, and the
server's re-derivation for backfill — so `sync/SupabaseClient.kt` fixes the mapping rules
rather than leaving them to the serialiser's defaults. The shared fixture set (ADR-019) is
the test that enforces them; it must exist before the Kotlin implementation does.

| Rule                                                                                                                                            | Why it is not the default                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `number` → `Int`/`Long` only for integral counts; `Double` for `importance` (`[0,1]`), `watchedPct` (`[0,1]`) and `scrollDepthPct` (0–100).     | A fractional value decoded into an `Int` throws at decode time.                                                                                                                                               |
| Required-but-nullable keys (`url`, `title`, `folder`, `mimeType`, `bytes`) are written as JSON `null`, never omitted (`explicitNulls = true`).  | The shared types declare them `string \| null`, so a schema built from them accepts `null` and may reject a missing key. An omitted `url` would reject **every** `app_session`, because a session has no URL. |
| `receivedAt` is `@Transient` — never serialised.                                                                                                | It is optional on the wire (`.optional()`, not `.nullable()`), and the server stamps it on receipt; sending `"receivedAt": null` would fail validation.                                                       |
| The discriminator is `type`, emitted by the serialiser from each subclass's `@SerialName`.                                                      | It must match the shared `ActivityEventBase.type` union exactly.                                                                                                                                              |
| `dedupeKey` comes from the shared `dedupeKey` algorithm — never from the event `id`, never including anything that varies per delivery attempt. | A key that changes on retry defeats `(device_id, dedupe_key)` and duplicates accumulate silently.                                                                                                             |

## UI

Compose only, Material 3, single `Activity`. Routes are string constants in `Routes`
(`activity`, `search`, `settings`) with a bottom navigation bar; the `NavHost` keeps one
copy of each top-level destination on the back stack. `SecondBrainTheme` follows the system
dark/light setting and uses wallpaper-derived dynamic colour on API 31+; pass
`dynamicColor = false` to pin the brand palette (screenshots, tests, and any screen where
the "captured" accent must stay recognisable).

## Testing

Nothing is tested yet (no test sources — see [Status](#status)). Where the tests will go,
and what each layer can be tested with:

| Target                                       | Source set     | Why it is testable as designed                                                                                                                                          |
| -------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionTracker`                             | `test/` (JVM)  | Pure: explicit `atMillis` inputs, no Android types, no clock, no I/O. Cover app-switch noise below `MIN_SESSION_SECONDS`, screen-off mid-session, and repeated `flush`. |
| `AppExclusionList.DEFAULT_EXCLUDED_PACKAGES` | `test/` (JVM)  | Assert the shipped default set matches the product spec — the one check that stops a privacy regression.                                                                |
| DTO round-trips                              | `test/` (JVM)  | Encode/decode every `ActivityEvent` subtype, and assert the wire shape (`type` discriminator, optional fields omitted) matches the shared fixture set.                  |
| `LocalQueue` + `QueueDao`                    | `androidTest/` | Room in-memory database via `room-testing`; assert ordering by `occurredAt`, and that nothing is deleted without an ack.                                                |
| Exclusion boundary                           | `androidTest/` | The invariant as a test at the Room boundary: an excluded package produces zero rows.                                                                                   |
| Sync outcome mapping                         | `test/` (JVM)  | `RemoteEventSink` fake returning each `ActivityBatchResult` shape and each HTTP status class from the taxonomy.                                                         |

## Related docs

| Document                                                         | Why it matters here                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [../../README.md](../../README.md)                               | Monorepo overview and where this app sits.                                                                                                                                                                                                                  |
| [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)         | The capture→ingest flow, the sync protocol, and the queue/idempotency contract this app implements.                                                                                                                                                         |
| [../../docs/DECISIONS.md](../../docs/DECISIONS.md)               | ADR-009 (client pre-score and the exclusion invariant), ADR-012 (`UsageStatsManager`, not an accessibility service), ADR-018 (anon key + per-device ingest secret, clients never write activity directly), ADR-019 (Android is outside the pnpm workspace). |
| [../../docs/PROJECT_OVERVIEW.md](../../docs/PROJECT_OVERVIEW.md) | The privacy promise the exclusion list implements.                                                                                                                                                                                                          |
| [../../docs/API_REFERENCE.md](../../docs/API_REFERENCE.md)       | The `POST /v1/ingest/batch` surface and the device-registration endpoint (still to be written).                                                                                                                                                             |
| `../../packages/shared/src/types/activity.ts`                    | The source of truth `sync/SupabaseClient.kt` transcribes; change them in the same PR.                                                                                                                                                                       |

## Known deviations from the scaffold brief

- `sync/SupabaseClient.kt` keeps its scaffolded **file** name, but the client inside is
  `IngestionRestClient` and it posts to `services/ingestion`
  (`{API_BASE_URL}/v1/ingest/batch`) rather than writing to Supabase PostgREST. ADR-018 is
  explicit that clients never write activity directly, and that the device is authenticated
  with a per-device secret, so a Supabase-direct client would contradict the documented
  security model. A file rename to `IngestionClient.kt` is a cosmetic phase-2 cleanup.
- `res/values/themes.xml` and `res/drawable/ic_stat_capture.xml` are small additions the
  manifest needs (a `@style/Theme.SecondBrain` window theme, and a small icon for the
  foreground-service notification).
- `AuthManager.kt` also holds `DeviceIdentity` and the per-device ingest secret accessor:
  both are credentials that belong in the same encrypted store as the session, and no extra
  file was warranted.
- `androidx.security:security-crypto` (1.1.0-alpha06, `EncryptedSharedPreferences`) is
  required by the brief but is no longer actively developed upstream. Phase-2 should
  evaluate a Keystore-backed store directly; the class boundary (`AuthManager`) is where
  that swap happens.
