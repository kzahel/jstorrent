package com.jstorrent.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.jstorrent.app.auth.StandaloneMode
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.mode.ModeDetector
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.ui.theme.JSTorrentTheme
import kotlinx.coroutines.launch

private const val TAG = "MainActivity"
private const val FALLBACK_URL = "https://new.jstorrent.com/launch"

class MainActivity : ComponentActivity() {

    private lateinit var tokenStore: TokenStore
    private var isPaired = mutableStateOf(false)
    private var backgroundModeEnabled = mutableStateOf(false)
    private var hasNotificationPermission = mutableStateOf(false)
    private var standaloneMode = mutableStateOf(StandaloneMode.WEBVIEW)

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "Notification permission granted: $isGranted")
        hasNotificationPermission.value = isGranted
        if (isGranted) {
            // Permission granted - enable background mode
            tokenStore.backgroundModeEnabled = true
            backgroundModeEnabled.value = true
            IoDaemonService.instance?.setForegroundMode(true)
        } else {
            // Permission denied - ensure background mode stays disabled
            tokenStore.backgroundModeEnabled = false
            backgroundModeEnabled.value = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        tokenStore = TokenStore(this)
        isPaired.value = tokenStore.hasToken()
        backgroundModeEnabled.value = tokenStore.backgroundModeEnabled
        hasNotificationPermission.value = checkNotificationPermission()
        standaloneMode.value = tokenStore.standaloneMode

        // Check if running on Chromebook
        val isChromebook = ModeDetector.isChromebook(this)
        Log.i(TAG, "Running on Chromebook: $isChromebook")

        // Non-Chromebook: launch standalone mode based on setting
        // Note: Magnet/torrent links go through LinkHandlerActivity, not here
        if (!isChromebook) {
            val targetActivity = when (tokenStore.standaloneMode) {
                StandaloneMode.NATIVE -> {
                    Log.i(TAG, "Not a Chromebook - launching native standalone mode")
                    NativeStandaloneActivity::class.java
                }
                StandaloneMode.WEBVIEW -> {
                    Log.i(TAG, "Not a Chromebook - launching WebView standalone mode")
                    StandaloneActivity::class.java
                }
            }

            startActivity(Intent(this, targetActivity).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            })
            finish()
            return
        }

        // Chromebook: handle pairing intent and start service
        handleIntent()
        IoDaemonService.start(this)

        setContent {
            JSTorrentTheme {
                MainScreen(
                    isPaired = isPaired.value,
                    backgroundModeEnabled = backgroundModeEnabled.value,
                    hasNotificationPermission = hasNotificationPermission.value,
                    standaloneMode = standaloneMode.value,
                    onBackgroundModeToggle = { enabled ->
                        if (enabled) {
                            // Request permission when enabling
                            requestNotificationPermission()
                        } else {
                            // Disable background mode
                            tokenStore.backgroundModeEnabled = false
                            backgroundModeEnabled.value = false
                            IoDaemonService.instance?.setForegroundMode(false)
                        }
                    },
                    onStandaloneModeChange = { mode ->
                        tokenStore.standaloneMode = mode
                        standaloneMode.value = mode
                    },
                    onBackToJSTorrent = {
                        // Check actual current state before deciding to close
                        val bgEnabled = tokenStore.backgroundModeEnabled
                        val hasPermission = checkNotificationPermission()
                        Log.i(TAG, "Back to JSTorrent: bgEnabled=$bgEnabled, hasPermission=$hasPermission")
                        launchBrowserFallback()
                        // Only close this window if background mode is fully enabled
                        if (bgEnabled && hasPermission) {
                            Log.i(TAG, "Closing window - background mode active")
                            finish()
                        } else {
                            Log.i(TAG, "Keeping window open - background mode not active")
                        }
                    },
                    onUnpair = {
                        // Close all WebSocket connections before clearing token
                        // This ensures the extension sees the disconnect
                        lifecycleScope.launch {
                            IoDaemonService.instance?.closeAllSessions()
                        }
                        tokenStore.clear()
                        isPaired.value = false
                        backgroundModeEnabled.value = false
                    },
                    onLaunchStandalone = {
                        val targetActivity = when (standaloneMode.value) {
                            StandaloneMode.NATIVE -> NativeStandaloneActivity::class.java
                            StandaloneMode.WEBVIEW -> StandaloneActivity::class.java
                        }
                        startActivity(Intent(this@MainActivity, targetActivity))
                    }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Refresh all state when returning to activity
        isPaired.value = tokenStore.hasToken()
        backgroundModeEnabled.value = tokenStore.backgroundModeEnabled

        // Check if permission was revoked in system settings
        val permissionGranted = checkNotificationPermission()
        hasNotificationPermission.value = permissionGranted

        // If permission was revoked but background mode is enabled, disable it
        if (backgroundModeEnabled.value && !permissionGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            tokenStore.backgroundModeEnabled = false
            backgroundModeEnabled.value = false
            IoDaemonService.instance?.setForegroundMode(false)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent()
    }

    private fun handleIntent() {
        val uri = intent?.data ?: return
        Log.d(TAG, "Received intent: $uri")

        // Only handle jstorrent:// scheme intents here
        // Magnet/torrent links are handled by LinkHandlerActivity
        when {
            uri.scheme == "jstorrent" && uri.host == "launch" -> {
                Log.i(TAG, "Launch intent - app started")
            }
            uri.scheme == "jstorrent" && uri.host == "pair" -> {
                // Pairing happens via HTTP POST /pair, not via intent
                Log.i(TAG, "Pair intent - ignored, use POST /pair")
            }
        }
    }

    private fun launchBrowserFallback() {
        // Target Chrome explicitly - on ChromeOS this opens in the real Chrome browser
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(FALLBACK_URL)).apply {
            setPackage("com.android.chrome")
        }
        try {
            startActivity(intent)
            Log.i(TAG, "Launched browser fallback: $FALLBACK_URL")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch Chrome, trying default browser", e)
            // Fallback to default browser if Chrome not available
            val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(FALLBACK_URL))
            startActivity(fallbackIntent)
        }
    }

    private fun checkNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            // Before Android 13, no permission needed for notifications
            true
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!checkNotificationPermission()) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                // Already have permission - enable background mode directly
                tokenStore.backgroundModeEnabled = true
                backgroundModeEnabled.value = true
                IoDaemonService.instance?.setForegroundMode(true)
            }
        } else {
            // Before Android 13, no permission needed - enable directly
            tokenStore.backgroundModeEnabled = true
            backgroundModeEnabled.value = true
            IoDaemonService.instance?.setForegroundMode(true)
        }
    }
}

@Composable
fun MainScreen(
    isPaired: Boolean,
    backgroundModeEnabled: Boolean,
    hasNotificationPermission: Boolean,
    standaloneMode: StandaloneMode,
    onBackgroundModeToggle: (Boolean) -> Unit,
    onStandaloneModeChange: (StandaloneMode) -> Unit,
    onBackToJSTorrent: () -> Unit,
    onUnpair: () -> Unit,
    onLaunchStandalone: () -> Unit
) {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (isPaired) {
                // Paired state header - centered text with small check to the left
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "✓",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Paired",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Connected to JSTorrent",
                    style = MaterialTheme.typography.bodyLarge
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Status message based on background mode
                if (backgroundModeEnabled && hasNotificationPermission) {
                    Text(
                        text = "✅ Running in background",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "You can safely close this window.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Text(
                        text = "⚠️ Keep this window open while",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error
                    )
                    Text(
                        text = "downloading torrents.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                HorizontalDivider()

                Spacer(modifier = Modifier.height(16.dp))

                // Background mode checkbox - entire row is clickable
                val isBackgroundActive = backgroundModeEnabled && hasNotificationPermission
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onBackgroundModeToggle(!isBackgroundActive) },
                    verticalAlignment = Alignment.Top
                ) {
                    Checkbox(
                        checked = isBackgroundActive,
                        onCheckedChange = { checked -> onBackgroundModeToggle(checked) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text(
                            text = "Run in background",
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Allows you to close this window. Shows a persistent notification.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Buttons
                Button(onClick = onBackToJSTorrent) {
                    Text("Back to JSTorrent")
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedButton(onClick = onUnpair) {
                    Text("Unpair")
                }

                // More Options section (collapsed by default)
                var showMoreOptions by remember { mutableStateOf(false) }

                Spacer(modifier = Modifier.height(32.dp))

                TextButton(onClick = { showMoreOptions = !showMoreOptions }) {
                    Text(if (showMoreOptions) "Hide Options" else "More Options")
                }

                if (showMoreOptions) {
                    Spacer(modifier = Modifier.height(16.dp))

                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "Experimental: Standalone Mode",
                                style = MaterialTheme.typography.titleSmall
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Run JSTorrent directly in this app without the browser extension. " +
                                       "Downloads will only work while this app is open.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            Spacer(modifier = Modifier.height(12.dp))

                            // Mode toggle
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Use Native UI",
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                    Text(
                                        text = if (standaloneMode == StandaloneMode.NATIVE)
                                            "Compose UI with QuickJS engine"
                                        else
                                            "WebView-based UI",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                Switch(
                                    checked = standaloneMode == StandaloneMode.NATIVE,
                                    onCheckedChange = { isNative ->
                                        onStandaloneModeChange(
                                            if (isNative) StandaloneMode.NATIVE else StandaloneMode.WEBVIEW
                                        )
                                    }
                                )
                            }

                            Spacer(modifier = Modifier.height(12.dp))
                            OutlinedButton(onClick = onLaunchStandalone) {
                                Text("Launch Standalone Mode")
                            }
                        }
                    }
                }
            } else {
                // Unpaired state
                Text(
                    text = "JSTorrent System Bridge",
                    style = MaterialTheme.typography.headlineMedium
                )

                Spacer(modifier = Modifier.height(24.dp))

                Text(
                    text = "Not paired",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(24.dp))

                Button(onClick = onBackToJSTorrent) {
                    Text("Back to JSTorrent")
                }
            }
        }
    }
}