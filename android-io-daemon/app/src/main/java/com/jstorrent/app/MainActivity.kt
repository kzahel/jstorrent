package com.jstorrent.app

import android.Manifest
import android.content.pm.PackageManager
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
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.ui.theme.JSTorrentTheme

private const val TAG = "MainActivity"

class MainActivity : ComponentActivity() {

    private lateinit var tokenStore: TokenStore

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "Notification permission granted: $isGranted")
        // Start service regardless of permission result
        IoDaemonService.start(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        tokenStore = TokenStore(this)

        // Handle pairing intent
        handleIntent()

        // Request notification permission on Android 13+
        requestNotificationPermissionAndStartService()

        setContent {
            JSTorrentTheme {
                MainScreen(
                    isPaired = tokenStore.hasToken(),
                    onUnpair = {
                        tokenStore.clear()
                        // Force recomposition
                        recreate()
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent()
    }

    private fun handleIntent() {
        val uri = intent?.data ?: return
        Log.d(TAG, "Received intent with URI: $uri")

        when {
            uri.scheme == "jstorrent" && uri.host == "pair" -> {
                val token = uri.getQueryParameter("token")
                if (token != null) {
                    Log.i(TAG, "Received pairing token via jstorrent:// scheme")
                    tokenStore.token = token
                }
            }
            uri.scheme == "magnet" -> {
                Log.i(TAG, "Received magnet link: $uri")
                // TODO: Forward to extension via some mechanism
            }
            (uri.scheme == "https" || uri.scheme == "http") && uri.host == "new.jstorrent.com" -> {
                // App Links from new.jstorrent.com
                Log.i(TAG, "Received App Link: $uri")
                val token = uri.getQueryParameter("token")
                if (token != null) {
                    Log.i(TAG, "Received pairing token via App Link")
                    tokenStore.token = token
                }
            }
        }
    }

    private fun requestNotificationPermissionAndStartService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED -> {
                    IoDaemonService.start(this)
                }
                else -> {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            IoDaemonService.start(this)
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
