package com.jstorrent.app.ui.navigation

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.PermissionChecker
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.jstorrent.app.ui.screens.AdvancedSettingsScreen
import com.jstorrent.app.ui.screens.BandwidthSettingsScreen
import com.jstorrent.app.ui.screens.ConnectionLimitsSettingsScreen
import com.jstorrent.app.ui.screens.DhtInfoScreen
import com.jstorrent.app.ui.screens.NetworkSettingsScreen
import com.jstorrent.app.ui.screens.NotificationsSettingsScreen
import com.jstorrent.app.ui.screens.PowerManagementSettingsScreen
import com.jstorrent.app.ui.screens.SettingsScreen
import com.jstorrent.app.ui.screens.SpeedHistoryScreen
import com.jstorrent.app.ui.screens.StorageSettingsScreen
import com.jstorrent.app.ui.screens.TorrentDetailScreen
import com.jstorrent.app.ui.screens.TorrentListScreen
import com.jstorrent.app.viewmodel.DhtViewModel
import com.jstorrent.app.viewmodel.SettingsViewModel
import com.jstorrent.app.viewmodel.SpeedHistoryViewModel
import com.jstorrent.app.viewmodel.TorrentDetailViewModel
import com.jstorrent.app.viewmodel.TorrentListViewModel

/**
 * Navigation routes for the app.
 */
object Routes {
    const val TORRENT_LIST = "torrent_list"
    const val TORRENT_DETAIL = "torrent_detail/{infoHash}"
    const val SETTINGS = "settings"
    const val SETTINGS_STORAGE = "settings/storage"
    const val SETTINGS_BANDWIDTH = "settings/bandwidth"
    const val SETTINGS_CONNECTION_LIMITS = "settings/connection_limits"
    const val SETTINGS_NOTIFICATIONS = "settings/notifications"
    const val SETTINGS_NETWORK = "settings/network"
    const val SETTINGS_POWER = "settings/power"
    const val SETTINGS_ADVANCED = "settings/advanced"
    const val DHT_INFO = "dht_info"
    const val SPEED_HISTORY = "speed_history"

    fun torrentDetail(infoHash: String) = "torrent_detail/$infoHash"
}

/**
 * Main navigation host for the app.
 * Handles navigation between torrent list, detail, and settings screens.
 *
 * @param initialInfoHash Optional infoHash to navigate to on launch (from notification tap)
 * @param navigateToListTrigger When this value changes to a non-zero value, navigate back to the list
 * @param onNavigatedToList Called after navigating to list, so caller can reset trigger
 */
@Composable
fun TorrentNavHost(
    listViewModel: TorrentListViewModel,
    onAddRootClick: () -> Unit,
    onShutdownClick: () -> Unit = {},
    modifier: Modifier = Modifier,
    initialInfoHash: String? = null,
    navigateToListTrigger: Int = 0,
    onNavigatedToList: () -> Unit = {},
    navController: NavHostController = rememberNavController()
) {
    // Navigate to detail screen if launched with an infoHash
    LaunchedEffect(initialInfoHash) {
        if (!initialInfoHash.isNullOrEmpty()) {
            navController.navigate(Routes.torrentDetail(initialInfoHash))
        }
    }

    // Navigate back to list when trigger changes (after adding a torrent)
    LaunchedEffect(navigateToListTrigger) {
        if (navigateToListTrigger > 0) {
            navController.popBackStack(Routes.TORRENT_LIST, inclusive = false)
            onNavigatedToList()
        }
    }

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
                },
                onShutdownClick = onShutdownClick,
                onSpeedClick = {
                    navController.navigate(Routes.SPEED_HISTORY)
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
            val application = LocalContext.current.applicationContext as android.app.Application
            val detailViewModel: TorrentDetailViewModel = viewModel(
                factory = TorrentDetailViewModel.Factory(application, infoHash)
            )
            TorrentDetailScreen(
                viewModel = detailViewModel,
                onNavigateBack = { navController.popBackStack() },
                onSettingsClick = { navController.navigate(Routes.SETTINGS) }
            )
        }

        // Settings hub screen
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToStorage = { navController.navigate(Routes.SETTINGS_STORAGE) },
                onNavigateToBandwidth = { navController.navigate(Routes.SETTINGS_BANDWIDTH) },
                onNavigateToConnectionLimits = { navController.navigate(Routes.SETTINGS_CONNECTION_LIMITS) },
                onNavigateToNotifications = { navController.navigate(Routes.SETTINGS_NOTIFICATIONS) },
                onNavigateToNetwork = { navController.navigate(Routes.SETTINGS_NETWORK) },
                onNavigateToPower = { navController.navigate(Routes.SETTINGS_POWER) },
                onNavigateToAdvanced = { navController.navigate(Routes.SETTINGS_ADVANCED) }
            )
        }

        // Storage settings
        composable(Routes.SETTINGS_STORAGE) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            StorageSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() },
                onAddRootClick = onAddRootClick
            )
        }

        // Bandwidth settings
        composable(Routes.SETTINGS_BANDWIDTH) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            BandwidthSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // Connection limits settings
        composable(Routes.SETTINGS_CONNECTION_LIMITS) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            ConnectionLimitsSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // Notifications settings
        composable(Routes.SETTINGS_NOTIFICATIONS) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )

            // Notification permission handling
            val permissionLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.RequestPermission()
            ) { isGranted ->
                val canRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val activity = context as? android.app.Activity
                    activity?.let {
                        ActivityCompat.shouldShowRequestPermissionRationale(
                            it,
                            Manifest.permission.POST_NOTIFICATIONS
                        )
                    } ?: true
                } else {
                    false
                }
                settingsViewModel.updateNotificationPermissionState(isGranted, canRequest)
            }

            // Check initial permission state
            LaunchedEffect(Unit) {
                val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PermissionChecker.PERMISSION_GRANTED
                } else {
                    true
                }

                val canRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val activity = context as? android.app.Activity
                    activity?.let {
                        !granted && ActivityCompat.shouldShowRequestPermissionRationale(
                            it,
                            Manifest.permission.POST_NOTIFICATIONS
                        )
                    } ?: (!granted)
                } else {
                    false
                }

                settingsViewModel.updateNotificationPermissionState(granted, canRequest || !granted)
            }

            NotificationsSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() },
                onRequestNotificationPermission = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
                onOpenNotificationSettings = {
                    val intent = Intent().apply {
                        action = Settings.ACTION_APP_NOTIFICATION_SETTINGS
                        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    }
                    context.startActivity(intent)
                }
            )
        }

        // Network settings
        composable(Routes.SETTINGS_NETWORK) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            NetworkSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() },
                onDhtInfoClick = { navController.navigate(Routes.DHT_INFO) }
            )
        }

        // Power management settings
        composable(Routes.SETTINGS_POWER) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )

            // Check initial permission state for background downloads
            LaunchedEffect(Unit) {
                val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PermissionChecker.PERMISSION_GRANTED
                } else {
                    true
                }

                val canRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val activity = context as? android.app.Activity
                    activity?.let {
                        !granted && ActivityCompat.shouldShowRequestPermissionRationale(
                            it,
                            Manifest.permission.POST_NOTIFICATIONS
                        )
                    } ?: (!granted)
                } else {
                    false
                }

                settingsViewModel.updateNotificationPermissionState(granted, canRequest || !granted)
            }

            PowerManagementSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() },
                onOpenNotificationSettings = {
                    val intent = Intent().apply {
                        action = Settings.ACTION_APP_NOTIFICATION_SETTINGS
                        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    }
                    context.startActivity(intent)
                }
            )
        }

        // Advanced settings
        composable(Routes.SETTINGS_ADVANCED) {
            val context = LocalContext.current
            val settingsViewModel: SettingsViewModel = viewModel(
                factory = SettingsViewModel.Factory(context)
            )
            AdvancedSettingsScreen(
                viewModel = settingsViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // DHT Info screen
        composable(Routes.DHT_INFO) {
            val application = LocalContext.current.applicationContext as android.app.Application
            val dhtViewModel: DhtViewModel = viewModel(
                factory = DhtViewModel.Factory(application)
            )
            DhtInfoScreen(
                viewModel = dhtViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // Speed History screen
        composable(Routes.SPEED_HISTORY) {
            val application = LocalContext.current.applicationContext as android.app.Application
            val speedHistoryViewModel: SpeedHistoryViewModel = viewModel(
                factory = SpeedHistoryViewModel.Factory(application)
            )
            SpeedHistoryScreen(
                viewModel = speedHistoryViewModel,
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}
