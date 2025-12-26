package com.jstorrent.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.jstorrent.app.ui.screens.SettingsScreen
import com.jstorrent.app.ui.screens.TorrentDetailScreen
import com.jstorrent.app.ui.screens.TorrentListScreen
import com.jstorrent.app.viewmodel.SettingsViewModel
import com.jstorrent.app.viewmodel.TorrentDetailViewModel
import com.jstorrent.app.viewmodel.TorrentListViewModel

/**
 * Navigation routes for the app.
 */
object Routes {
    const val TORRENT_LIST = "torrent_list"
    const val TORRENT_DETAIL = "torrent_detail/{infoHash}"
    const val SETTINGS = "settings"

    fun torrentDetail(infoHash: String) = "torrent_detail/$infoHash"
}

/**
 * Main navigation host for the app.
 * Handles navigation between torrent list, detail, and settings screens.
 */
@Composable
fun TorrentNavHost(
    listViewModel: TorrentListViewModel,
    onAddRootClick: () -> Unit,
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController()
) {
    NavHost(
        navController = navController,
        startDestination = Routes.TORRENT_LIST,
        modifier = modifier
    ) {
        // Torrent list screen
        composable(Routes.TORRENT_LIST) {
            TorrentListScreen(
                viewModel = listViewModel,
                onTorrentClick = { infoHash ->
                    navController.navigate(Routes.torrentDetail(infoHash))
                },
                onAddRootClick = onAddRootClick,
                onSettingsClick = {
                    navController.navigate(Routes.SETTINGS)
                },
                onSearchClick = {
                    // TODO: Implement search in future phase
                }
            )
        }

        // Torrent detail screen
        composable(
            route = Routes.TORRENT_DETAIL,
            arguments = listOf(
                navArgument("infoHash") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val infoHash = backStackEntry.arguments?.getString("infoHash") ?: ""
            val detailViewModel: TorrentDetailViewModel = viewModel(
                factory = TorrentDetailViewModel.Factory(infoHash)
            )
            TorrentDetailScreen(
                viewModel = detailViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // Settings screen
        composable(Routes.SETTINGS) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            SettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() },
                onAddRootClick = onAddRootClick
            )
        }
    }
}
