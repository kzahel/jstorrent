package com.jstorrent.app

import android.Manifest
import android.content.ActivityNotFoundException
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

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "Notification permission granted: $isGranted")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        tokenStore = TokenStore(this)
        isPaired.value = tokenStore.hasToken()

        // Handle pairing intent
        handleIntent()

        // Start service immediately, then request notification permission
        startServiceAndRequestNotificationPermission()

        setContent {
            JSTorrentTheme {
                MainScreen(
                    isPaired = isPaired.value,
                    onUnpair = {
                        tokenStore.clear()
                        isPaired.value = false
                    }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Refresh pairing state when returning from PairingApprovalActivity
        val wasPaired = isPaired.value
        isPaired.value = tokenStore.hasToken()

        // Request notification permission after pairing completes (not during onboarding)
        if (!wasPaired && isPaired.value) {
            requestNotificationPermissionIfNeeded()
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
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(FALLBACK_URL))
            startActivity(intent)
            Log.i(TAG, "Launched browser fallback: $FALLBACK_URL")
        } catch (e: ActivityNotFoundException) {
            Log.e(TAG, "No browser available to launch fallback URL")
        }
    }

    private fun startServiceAndRequestNotificationPermission() {
        // Always start service immediately - don't block on permission dialog
        IoDaemonService.start(this)

        // Only request notification permission after pairing is complete
        // This avoids dialog conflicts during onboarding
        if (tokenStore.hasToken()) {
            requestNotificationPermissionIfNeeded()
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}

@Composable
fun MainScreen(
    isPaired: Boolean,
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
            Text(
                text = "JSTorrent IO Daemon",
                style = MaterialTheme.typography.headlineMedium
            )

            Spacer(modifier = Modifier.height(24.dp))

            if (isPaired) {
                Text(
                    text = "Paired with extension",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary
                )

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedButton(onClick = onUnpair) {
                    Text("Unpair")
                }
            } else {
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
