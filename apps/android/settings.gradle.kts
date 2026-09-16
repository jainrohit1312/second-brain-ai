import org.gradle.api.initialization.resolve.RepositoriesMode

// Second Brain — Android workspace.
//
// This is a standalone Gradle build, not a pnpm workspace member. It talks to the
// backend over HTTPS and never imports anything from packages/, services/ or apps/web.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

// FAIL_ON_PROJECT_REPOS: every repository must be declared here, so the build is
// reproducible and no module can silently pull from an unreviewed repository.
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SecondBrain"

include(":app")
