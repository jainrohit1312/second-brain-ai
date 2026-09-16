package com.secondbrain.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.secondbrain.app.ui.theme.SecondBrainTheme

/**
 * The app's only Activity: a Compose host with three top-level destinations.
 *
 * Edge-to-edge is enabled before `setContent`, so the Compose tree owns the insets and
 * the theme can draw under the system bars. All capture work happens in
 * `UsageStatsWatcher` and `SyncWorker`; the Activity itself never touches the queue.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            SecondBrainTheme {
                SecondBrainRoot()
            }
        }
    }
}

/**
 * Route names for the top-level destinations. String constants rather than a
 * serialisable route type: these three screens take no arguments, and a plain string
 * keeps the navigation graph readable in a scaffold.
 */
object Routes {
    const val ACTIVITY = "activity"
    const val SEARCH = "search"
    const val SETTINGS = "settings"
}

/**
 * Navigation shell: top app bar, bottom navigation and the [NavHost] that swaps the
 * three placeholder screens.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecondBrainRoot(modifier: Modifier = Modifier) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(title = { Text(text = stringResource(id = R.string.app_name)) })
        },
        bottomBar = {
            NavigationBar {
                TopLevelDestination.entries.forEach { destination ->
                    NavigationBarItem(
                        selected = currentRoute == destination.route,
                        onClick = { navController.navigateToTopLevel(destination.route) },
                        icon = {
                            Icon(
                                imageVector = destination.icon,
                                contentDescription = null,
                            )
                        },
                        label = { Text(text = stringResource(id = destination.labelRes)) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.ACTIVITY,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Routes.ACTIVITY) { PlaceholderScreen(strings = TopLevelDestination.ACTIVITY) }
            composable(Routes.SEARCH) { PlaceholderScreen(strings = TopLevelDestination.SEARCH) }
            composable(Routes.SETTINGS) { PlaceholderScreen(strings = TopLevelDestination.SETTINGS) }
        }
    }
}

/**
 * The three top-level destinations, in bottom-bar order.
 *
 * @property route must match the `composable(...)` route in [SecondBrainRoot].
 * @property labelRes string resource for the bottom-bar label.
 * @property icon Material icon rendered in the bottom bar.
 * @property titleRes string resource used by the placeholder screen body.
 * @property bodyRes string resource used by the placeholder screen body.
 */
private enum class TopLevelDestination(
    val route: String,
    @StringRes val labelRes: Int,
    val icon: ImageVector,
    @StringRes val titleRes: Int,
    @StringRes val bodyRes: Int,
) {
    ACTIVITY(
        route = Routes.ACTIVITY,
        labelRes = R.string.nav_activity,
        icon = Icons.Filled.Home,
        titleRes = R.string.activity_screen_title,
        bodyRes = R.string.activity_screen_body,
    ),
    SEARCH(
        route = Routes.SEARCH,
        labelRes = R.string.nav_search,
        icon = Icons.Filled.Search,
        titleRes = R.string.search_screen_title,
        bodyRes = R.string.search_screen_body,
    ),
    SETTINGS(
        route = Routes.SETTINGS,
        labelRes = R.string.nav_settings,
        icon = Icons.Filled.Settings,
        titleRes = R.string.settings_screen_title,
        bodyRes = R.string.settings_screen_body,
    ),
}

/**
 * Phase-1 body for every destination: a title and a one-line statement of what the
 * screen will show. Phase-2 replaces the bodies, not the routes.
 */
@Composable
private fun PlaceholderScreen(
    strings: TopLevelDestination,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(id = strings.titleRes),
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            text = stringResource(id = strings.bodyRes),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

/**
 * Navigates to a top-level destination while keeping a single copy of each on the back
 * stack, so repeated bottom-bar taps do not grow history and returning to a tab restores
 * its previous scroll position.
 */
private fun NavHostController.navigateToTopLevel(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
