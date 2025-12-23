package com.jstorrent.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.jstorrent.app.service.EngineService
import com.jstorrent.app.storage.RootStore
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val TAG = "NativeStandaloneActivity"

/**
 * Native standalone activity with Compose UI.
 * Binds to EngineService to display and control torrents.
 */
class NativeStandaloneActivity : ComponentActivity() {

    private lateinit var rootStore: RootStore

    // UI State
    private var hasRoots = mutableStateOf(false)
    private var magnetInput = mutableStateOf("")
    private var torrents = mutableStateOf<List<TorrentSummary>>(emptyList())
    private var isEngineLoaded = mutableStateOf(false)
    private var lastError = mutableStateOf<String?>(null)

    // For handling magnet intents while engine is loading
    private var pendingMagnet: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        rootStore = RootStore(this)
        hasRoots.value = rootStore.listRoots().isNotEmpty()

        // Handle incoming intent (magnet link or torrent file)
        handleIncomingIntent(intent)

        // Start EngineService
        EngineService.start(this)

        setContent {
            JSTorrentTheme {
                NativeStandaloneScreen(
                    hasRoots = hasRoots.value,
                    magnetInput = magnetInput.value,
                    onMagnetInputChange = { magnetInput.value = it },
                    onAddTorrent = { addTorrent(it) },
                    torrents = torrents.value,
                    isEngineLoaded = isEngineLoaded.value,
                    lastError = lastError.value,
                    onAddRoot = { launchAddRoot() },
                    onPauseTorrent = { hash -> EngineService.instance?.pauseTorrent(hash) },
                    onResumeTorrent = { hash -> EngineService.instance?.resumeTorrent(hash) },
                    onRemoveTorrent = { hash -> EngineService.instance?.removeTorrent(hash, false) }
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        observeEngineState()
    }

    override fun onResume() {
        super.onResume()
        // Refresh roots (may have been added via AddRootActivity)
        rootStore.reload()
        hasRoots.value = rootStore.listRoots().isNotEmpty()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        Log.d(TAG, "Received intent: $uri")

        when (uri.scheme) {
            "magnet" -> {
                val magnet = uri.toString()
                if (isEngineLoaded.value) {
                    addTorrent(magnet)
                } else {
                    pendingMagnet = magnet
                }
            }
            "content", "file" -> {
                handleTorrentFile(uri)
            }
            "jstorrent" -> {
                // Handle jstorrent://native launch intent
                Log.i(TAG, "Launch intent received")
            }
        }
    }

    private fun observeEngineState() {
        lifecycleScope.launch {
            // Wait for service instance
            while (EngineService.instance == null) {
                delay(100)
            }

            val service = EngineService.instance!!

            // Collect isLoaded
            launch {
                service.isLoaded?.collect { loaded ->
                    isEngineLoaded.value = loaded
                    // Handle pending magnet when engine becomes ready
                    if (loaded && pendingMagnet != null) {
                        addTorrent(pendingMagnet!!)
                        pendingMagnet = null
                    }
                }
            }

            // Collect state updates
            launch {
                service.state?.collect { state ->
                    torrents.value = state?.torrents ?: emptyList()
                }
            }

            // Collect errors
            launch {
                service.lastError?.collect { error ->
                    lastError.value = error
                }
            }
        }
    }

    private fun addTorrent(magnetOrBase64: String) {
        if (magnetOrBase64.isBlank()) return
        EngineService.instance?.addTorrent(magnetOrBase64)
        magnetInput.value = ""  // Clear input
    }

    private fun handleTorrentFile(uri: Uri) {
        try {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
            if (bytes != null) {
                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                if (isEngineLoaded.value) {
                    addTorrent(base64)
                } else {
                    pendingMagnet = base64
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read torrent file", e)
            lastError.value = "Failed to read torrent file: ${e.message}"
        }
    }

    private fun launchAddRoot() {
        startActivity(Intent(this, AddRootActivity::class.java))
    }
}

// =============================================================================
// Composables
// =============================================================================

@Composable
fun NativeStandaloneScreen(
    hasRoots: Boolean,
    magnetInput: String,
    onMagnetInputChange: (String) -> Unit,
    onAddTorrent: (String) -> Unit,
    torrents: List<TorrentSummary>,
    isEngineLoaded: Boolean,
    lastError: String?,
    onAddRoot: () -> Unit,
    onPauseTorrent: (String) -> Unit,
    onResumeTorrent: (String) -> Unit,
    onRemoveTorrent: (String) -> Unit
) {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp)
        ) {
            // Header
            Text(
                text = "JSTorrent",
                style = MaterialTheme.typography.headlineMedium
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Error banner
            lastError?.let { error ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = error,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
            }

            if (!hasRoots) {
                // Setup required
                SetupRequiredCard(onAddRoot = onAddRoot)
            } else if (!isEngineLoaded) {
                // Loading state
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "Starting engine...",
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                }
            } else {
                // Main UI
                AddTorrentRow(
                    magnetInput = magnetInput,
                    onMagnetInputChange = onMagnetInputChange,
                    onAddTorrent = onAddTorrent
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Torrent list
                if (torrents.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "No torrents yet",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Paste a magnet link above to get started",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(torrents, key = { it.infoHash }) { torrent ->
                            TorrentCard(
                                torrent = torrent,
                                onPause = { onPauseTorrent(torrent.infoHash) },
                                onResume = { onResumeTorrent(torrent.infoHash) },
                                onRemove = { onRemoveTorrent(torrent.infoHash) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SetupRequiredCard(onAddRoot: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Setup Required",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Please select a download folder to store your torrents.",
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = onAddRoot) {
                Text("Select Download Folder")
            }
        }
    }
}

@Composable
fun AddTorrentRow(
    magnetInput: String,
    onMagnetInputChange: (String) -> Unit,
    onAddTorrent: (String) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        OutlinedTextField(
            value = magnetInput,
            onValueChange = onMagnetInputChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text("Paste magnet link...") },
            singleLine = true
        )
        Spacer(modifier = Modifier.width(8.dp))
        Button(
            onClick = { onAddTorrent(magnetInput) },
            enabled = magnetInput.isNotBlank()
        ) {
            Text("Add")
        }
    }
}

@Composable
fun TorrentCard(
    torrent: TorrentSummary,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRemove: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp)
        ) {
            // Name
            Text(
                text = torrent.name.ifEmpty { "Unknown" },
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Status + Speed
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = formatStatus(torrent.status),
                    style = MaterialTheme.typography.bodySmall,
                    color = statusColor(torrent.status)
                )
                Text(
                    text = formatSpeed(torrent.downloadSpeed),
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Progress bar
            LinearProgressIndicator(
                progress = { torrent.progress.toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Progress percentage
            Text(
                text = "${(torrent.progress * 100).toInt()}%",
                style = MaterialTheme.typography.bodySmall
            )

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                if (torrent.status == "stopped") {
                    TextButton(onClick = onResume) {
                        Text("Resume")
                    }
                } else {
                    TextButton(onClick = onPause) {
                        Text("Pause")
                    }
                }
                TextButton(onClick = onRemove) {
                    Text("Remove")
                }
            }
        }
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

@Composable
private fun statusColor(status: String) = when (status) {
    "downloading" -> MaterialTheme.colorScheme.primary
    "seeding" -> MaterialTheme.colorScheme.tertiary
    "stopped" -> MaterialTheme.colorScheme.outline
    "checking" -> MaterialTheme.colorScheme.secondary
    "error" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurface
}

private fun formatStatus(status: String): String = when (status) {
    "downloading" -> "Downloading"
    "downloading_metadata" -> "Getting metadata..."
    "seeding" -> "Seeding"
    "stopped" -> "Paused"
    "checking" -> "Checking..."
    "error" -> "Error"
    else -> status.replaceFirstChar { it.uppercase() }
}

private fun formatSpeed(bytesPerSecond: Long): String {
    return when {
        bytesPerSecond >= 1_000_000 -> "${bytesPerSecond / 1_000_000} MB/s"
        bytesPerSecond >= 1_000 -> "${bytesPerSecond / 1_000} KB/s"
        bytesPerSecond > 0 -> "$bytesPerSecond B/s"
        else -> ""
    }
}
