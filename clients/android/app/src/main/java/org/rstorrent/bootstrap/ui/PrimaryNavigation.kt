package org.rstorrent.bootstrap.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import org.rstorrent.bootstrap.R

/** The two primary destinations, in the web UI's order (Tactical 376). */
enum class PrimaryDestination(
    val route: String,
    @StringRes val labelRes: Int,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
) {
    LIBRARY(
        ProductRoutes.MEDIA_LIBRARY,
        R.string.nav_library,
        Icons.Outlined.VideoLibrary,
        Icons.Filled.VideoLibrary,
    ),
    TORRENTS(
        ProductRoutes.TORRENTS,
        R.string.nav_torrents,
        Icons.Outlined.Download,
        Icons.Filled.Download,
    ),
    ;

    companion object {
        fun forRoute(route: String?): PrimaryDestination? = entries.firstOrNull { it.route == route }

        /** A remembered name that no longer exists takes the default. */
        fun fromPreference(name: String?): PrimaryDestination =
            entries.firstOrNull { it.name == name } ?: TORRENTS
    }
}

/** Windows at least this wide use a navigation rail instead of a bottom bar. */
private const val NAVIGATION_RAIL_MIN_WIDTH_DP = 600

/**
 * Switches primary destination with saved per-destination state. With
 * [restoreState] false it lands on the destination's list itself, for
 * flows such as an external add that must show the torrent list.
 */
internal fun NavController.showPrimary(
    destination: PrimaryDestination,
    restoreState: Boolean = true,
) {
    navigate(destination.route) {
        popUpTo(graph.findStartDestination().id) { saveState = restoreState }
        launchSingleTop = true
        this.restoreState = restoreState
    }
}

/**
 * The primary navigation around the screens: a bar below them at compact
 * widths, a rail beside them from [NAVIGATION_RAIL_MIN_WIDTH_DP], nothing when
 * [current] is null. Content placed at the bottom of [content] stays above the bar.
 */
@Composable
internal fun PrimaryNavigationScaffold(
    current: PrimaryDestination?,
    onSelect: (PrimaryDestination) -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val rail = LocalConfiguration.current.screenWidthDp >= NAVIGATION_RAIL_MIN_WIDTH_DP
    // The bar or rail pads these insets, so the screens must not pad them again.
    val padded =
        when {
            current == null -> WindowInsets(0, 0, 0, 0)
            rail -> WindowInsets.systemBars.only(WindowInsetsSides.Start)
            else -> WindowInsets.systemBars.only(WindowInsetsSides.Bottom)
        }
    Row(Modifier.fillMaxSize()) {
        if (current != null && rail) PrimaryNavigationRail(current, onSelect)
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Box(Modifier.weight(1f).fillMaxWidth().consumeWindowInsets(padded), content = content)
            if (current != null && !rail) PrimaryNavigationBar(current, onSelect)
        }
    }
}

@Composable
private fun PrimaryNavigationBar(
    current: PrimaryDestination,
    onSelect: (PrimaryDestination) -> Unit,
) {
    NavigationBar(Modifier.testTag("primary-navigation-bar")) {
        PrimaryDestination.entries.forEach { destination ->
            val selected = destination == current
            NavigationBarItem(
                selected = selected,
                onClick = { if (!selected) onSelect(destination) },
                icon = {
                    Icon(
                        if (selected) destination.selectedIcon else destination.icon,
                        contentDescription = null,
                    )
                },
                label = { Text(stringResource(destination.labelRes)) },
            )
        }
    }
}

@Composable
private fun PrimaryNavigationRail(
    current: PrimaryDestination,
    onSelect: (PrimaryDestination) -> Unit,
) {
    NavigationRail(Modifier.testTag("primary-navigation-rail")) {
        PrimaryDestination.entries.forEach { destination ->
            val selected = destination == current
            NavigationRailItem(
                selected = selected,
                onClick = { if (!selected) onSelect(destination) },
                icon = {
                    Icon(
                        if (selected) destination.selectedIcon else destination.icon,
                        contentDescription = null,
                    )
                },
                label = { Text(stringResource(destination.labelRes)) },
            )
        }
    }
}
