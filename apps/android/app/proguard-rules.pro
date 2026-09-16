# R8 / ProGuard rules for the release build (isMinifyEnabled = true).
#
# Library modules ship their own consumer rules (Compose, WorkManager, Room, Ktor all
# do), so this file only covers what reflection touches inside our own code plus a
# few keep-warnings that R8 full mode reports for optional Kotlin/JVM dependencies.

# ---------------------------------------------------------------------------
# kotlinx.serialization
# The generated `Companion.serializer()` members and `$$serializer` classes are
# looked up reflectively by the serializers of our @Serializable types, so they
# must survive minification. Annotations are kept because `@SerialName`,
# `@JsonClassDiscriminator` and `@Transient` are read at runtime by the plugin's
# generated code paths.
# ---------------------------------------------------------------------------
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisibleAnnotations
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Our own serializable model: the sync DTOs, the auth session and the queue payloads.
-keepclassmembers class com.secondbrain.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.secondbrain.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep class com.secondbrain.app.**$$serializer { *; }

# ---------------------------------------------------------------------------
# Room
# The generated <Database>_Impl classes are instantiated by name from
# Room.databaseBuilder, and @Entity/@Dao members are read reflectively when Room
# validates the schema at runtime.
# ---------------------------------------------------------------------------
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao interface * { *; }
-dontwarn androidx.room.paging.**

# ---------------------------------------------------------------------------
# Ktor + OkHttp client engine
# The engine is loaded through a service entry point and uses reflection for a few
# optional integrations that this app does not ship (logging backends, SPDY, etc.).
# ---------------------------------------------------------------------------
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-keep class io.ktor.client.engine.okhttp.OkHttpEngineContainer { <init>(); }
-keepnames class okhttp3.internal.platform.Platform

# ---------------------------------------------------------------------------
# Coroutines
# DebugProbes and the Android main-dispatcher factory are optional and resolved by
# name; without these keeps R8 warns or (worse) strips the dispatcher factory.
# ---------------------------------------------------------------------------
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-dontwarn kotlinx.coroutines.debug.**

# ---------------------------------------------------------------------------
# Kotlin metadata
# Retained so that reflective tools (and the Compose compiler's runtime checks)
# continue to see declaration metadata in the shrunk APK.
# ---------------------------------------------------------------------------
-keep class kotlin.Metadata { *; }
