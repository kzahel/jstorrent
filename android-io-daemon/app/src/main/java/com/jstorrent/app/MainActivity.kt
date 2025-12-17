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
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.link.PendingLink
import com.jstorrent.app.link.PendingLinkManager
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.ui.theme.JSTorrentTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val TAG = "MainActivity"
private const val FALLBACK_URL = "https://new.jstorrent.com/launch"
private const val CONNECTION_TIMEOUT_MS = 5000L
private const val POLL_INTERVAL_MS = 200L

class MainActivity : ComponentActivity() {

    private lateinit var tokenStore: TokenStore
    private var isPaired = mutableStateOf(false)
    private var backgroundModeEnabled = mutableStateOf(false)
    private var hasNotificationPermission = mutableStateOf(false)

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

        // Handle pairing intent
        handleIntent()

        // Start service (background mode handled by service based on preference)
        IoDaemonService.start(this)

        setContent {
            JSTorrentTheme {
                MainScreen(
                    isPaired = isPaired.value,
                    backgroundModeEnabled = backgroundModeEnabled.value,
                    hasNotificationPermission = hasNotificationPermission.value,
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
                        tokenStore.clear()
                        isPaired.value = false
                        backgroundModeEnabled.value = false
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

        when {
            uri.scheme == "jstorrent" && uri.host == "launch" -> {
                Log.i(TAG, "Launch intent - app started")
            }
            uri.scheme == "jstorrent" && uri.host == "pair" -> {
                // Pairing happens via HTTP POST /pair, not via intent
                Log.i(TAG, "Pair intent - ignored, use POST /pair")
            }
            uri.scheme == "magnet" -> {
                Log.i(TAG, "Magnet link: $uri")
                handleMagnetLink(uri.toString())
            }
            // Handle .torrent files (file:// or content:// URIs)
            uri.scheme == "file" || uri.scheme == "content" -> {
                Log.i(TAG, "Torrent file: $uri")
                handleTorrentFile(uri)
            }
        }
    }

    private fun handleMagnetLink(magnetLink: String) {
        val service = IoDaemonService.instance

        if (service?.hasActiveControlConnection() == true) {
            // Connection exists - send immediately
            Log.i(TAG, "Control connection active, sending magnet immediately")
            service.sendMagnetAdded(magnetLink)
        } else {
            // No connection - queue link, launch browser fallback, wait for connection
            Log.i(TAG, "No control connection, initiating fallback flow")
            PendingLinkManager.addMagnet(magnetLink)
            startFallbackFlow()
        }
    }

    private fun handleTorrentFile(uri: Uri) {
        // Read torrent file and encode as base64
        val name = uri.lastPathSegment ?: "unknown.torrent"
        val bytes = try {
            contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read torrent file: ${e.message}")
            return
        }

        if (bytes == null) {
            Log.e(TAG, "Failed to read torrent file: empty content")
            return
        }

        val contentsBase64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

        val service = IoDaemonService.instance

        if (service?.hasActiveControlConnection() == true) {
            Log.i(TAG, "Control connection active, sending torrent immediately")
            service.sendTorrentAdded(name, contentsBase64)
        } else {
            Log.i(TAG, "No control connection, initiating fallback flow")
            PendingLinkManager.addTorrent(name, contentsBase64)
            startFallbackFlow()
        }
    }

    private fun startFallbackFlow() {
        // Set up listener for when connection is established
        PendingLinkManager.setConnectionListener {
            lifecycleScope.launch {
                Log.i(TAG, "Control connection established, forwarding pending links")
                forwardPendingLinks()
            }
        }

        // Start timeout coroutine
        lifecycleScope.launch {
            val startTime = System.currentTimeMillis()

            // Poll for connection for up to TIMEOUT
            while (System.currentTimeMillis() - startTime < CONNECTION_TIMEOUT_MS) {
                if (IoDaemonService.instance?.hasActiveControlConnection() == true) {
                    Log.i(TAG, "Control connection established within timeout")
                    forwardPendingLinks()
                    return@launch
                }
                delay(POLL_INTERVAL_MS)
            }

            // Timeout - launch browser fallback
            Log.i(TAG, "Connection timeout, launching browser fallback")
            launchBrowserFallback()
        }
    }

    private fun forwardPendingLinks() {
        val service = IoDaemonService.instance ?: return
        val links = PendingLinkManager.getPendingLinks()

        for (link in links) {
            when (link) {
                is PendingLink.Magnet -> {
                    Log.i(TAG, "Forwarding queued magnet: ${link.link}")
                    service.sendMagnetAdded(link.link)
                }
                is PendingLink.Torrent -> {
                    Log.i(TAG, "Forwarding queued torrent: ${link.name}")
                    service.sendTorrentAdded(link.name, link.contentsBase64)
                }
            }
        }

        PendingLinkManager.clearPendingLinks()
        PendingLinkManager.setConnectionListener(null)
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
    onBackgroundModeToggle: (Boolean) -> Unit,
    onBackToJSTorrent: () -> Unit,
    onUnpair: () -> Unit
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
            } else {
                // Unpaired state
                Text(
                    text = "JSTorrent IO Daemon",
                    style = MaterialTheme.typography.headlineMedium
                )

                Spacer(modifier = Modifier.height(24.dp))

                Text(
                    text = "Not paired",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Open JSTorrent extension to pair",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}
