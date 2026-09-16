package com.secondbrain.app.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Second Brain palette.
//
// A restrained indigo/violet primary with a teal accent: the app is a reading and
// recall surface, so the accent is reserved for "this was captured" affordances and
// never used for large fills. Tokens are numbered by M3 role, not by hue, so a
// re-skin does not require renaming call sites.

/** Primary container tone used for high-emphasis surfaces and selected nav items. */
val Primary40 = Color(0xFF5B4BE0)

/** Primary tone for dark-theme fills; lighter so it stays legible on near-black. */
val Primary80 = Color(0xFFC6BFFF)

/** Secondary container tone: capture affordances and progress. */
val Secondary40 = Color(0xFF0F7B6C)

/** Secondary tone for dark-theme fills. */
val Secondary80 = Color(0xFF7BD8C8)

/** Tertiary container tone: memory and recall surfaces. */
val Tertiary40 = Color(0xFF7A4E9C)

/** Tertiary tone for dark-theme fills. */
val Tertiary80 = Color(0xFFE3C2F5)

/** Error tone, light theme. */
val Error40 = Color(0xFFB3261E)

/** Error tone, dark theme. */
val Error80 = Color(0xFFF2B8B5)

/** Light-theme surface and background. */
val LightBackground = Color(0xFFFDFBFF)
val LightSurface = Color(0xFFFDFBFF)
val LightSurfaceVariant = Color(0xFFE5E1EC)
val LightOnSurface = Color(0xFF1B1B1F)
val LightOnSurfaceVariant = Color(0xFF47464F)
val LightOutline = Color(0xFF787680)

/** Dark-theme surface and background. */
val DarkBackground = Color(0xFF131318)
val DarkSurface = Color(0xFF131318)
val DarkSurfaceVariant = Color(0xFF47464F)
val DarkOnSurface = Color(0xFFE5E1E9)
val DarkOnSurfaceVariant = Color(0xFFC9C5D0)
val DarkOutline = Color(0xFF928F99)

/**
 * Light-theme colour scheme. Applied whenever dynamic colour is unavailable (API < 31)
 * or explicitly disabled by the caller.
 */
val SecondBrainLightColors = lightColorScheme(
    primary = Primary40,
    onPrimary = Color.White,
    secondary = Secondary40,
    onSecondary = Color.White,
    tertiary = Tertiary40,
    onTertiary = Color.White,
    error = Error40,
    onError = Color.White,
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline,
)

/**
 * Dark-theme colour scheme. The default for this app: capture happens in the evening
 * as much as during the day, and a dark feed is easier on the eyes at length.
 */
val SecondBrainDarkColors = darkColorScheme(
    primary = Primary80,
    onPrimary = Color(0xFF2A1C86),
    secondary = Secondary80,
    onSecondary = Color(0xFF00382F),
    tertiary = Tertiary80,
    onTertiary = Color(0xFF3D1F5C),
    error = Error80,
    onError = Color(0xFF601410),
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline,
)
