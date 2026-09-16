// Root build script.
//
// Declares the plugin versions for the whole build from the version catalog
// (gradle/libs.versions.toml) and applies none of them; :app is the only module
// and it applies what it needs.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}
