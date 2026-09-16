package com.secondbrain.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Root theme for every Compose surface in the app.
 *
 * @param darkTheme follows the system setting by default; pass `false` from a preview or
 *   a screenshot test that needs a fixed appearance.
 * @param dynamicColor uses the wallpaper-derived Material You palette on API 31+ when
 *   [darkTheme] is resolved. Set to `false` to force the brand [SecondBrainLightColors] /
 *   [SecondBrainDarkColors] palette on every device — worth doing for product screenshots
 *   and for any screen where the "captured" accent must stay recognisable.
 */
@Composable
fun SecondBrainTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> SecondBrainDarkColors
        else -> SecondBrainLightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = SecondBrainTypography,
        content = content,
    )
}
