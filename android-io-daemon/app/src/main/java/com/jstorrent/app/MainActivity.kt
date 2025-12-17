package com.jstorrent.app

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
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
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.ui.theme.JSTorrentTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val TAG = "MainActivity"

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
                forwardMagnetToExtension(uri.toString())
            }
            uri.scheme == "file" || uri.scheme == "content" -> {
                forwardTorrentFileToExtension(uri)
            }
        }
    }

    private fun forwardMagnetToExtension(magnetUri: String) {
        Log.i(TAG, "Forwarding magnet link to extension: $magnetUri")
        lifecycleScope.launch {
            val service = waitForService()
            if (service != null) {
                // Extension expects { link: string }
                val payload = buildJsonObject {
                    put("link", magnetUri)
                }
                service.broadcastEvent("MagnetAdded", payload)
            } else {
                Log.e(TAG, "Service not available, cannot forward magnet link")
            }
        }
    }

    private fun forwardTorrentFileToExtension(uri: Uri) {
        lifecycleScope.launch {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    val service = waitForService()
                    if (service != null) {
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        Log.i(TAG, "Forwarding torrent file to extension (${bytes.size} bytes)")
                        // Extension expects { name?, infohash?, contentsBase64 }
                        val payload = buildJsonObject {
                            put("contentsBase64", base64)
                        }
                        service.broadcastEvent("TorrentAdded", payload)
                    } else {
                        Log.e(TAG, "Service not available, cannot forward torrent file")
                    }
                } else {
                    Log.e(TAG, "Failed to read torrent file: empty content")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read torrent file: ${e.message}")
            }
        }
    }

    private suspend fun waitForService(timeoutMs: Long = 5000): IoDaemonService? {
        val startTime = System.currentTimeMillis()
        while (System.currentTimeMillis() - startTime < timeoutMs) {
            IoDaemonService.instance?.let { return it }
            delay(100)
        }
        return null
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
