package com.jstorrent.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.content.PermissionChecker
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.jstorrent.app.service.ForegroundNotificationService
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.app.ui.dialogs.NotificationPermissionDialog
import com.jstorrent.app.ui.navigation.TorrentNavHost
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.TorrentListViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG = "NativeStandaloneActivity"

/**
 * Native standalone activity with Compose UI.
 * Uses the engine from the Application to display and control torrents.
 */
class NativeStandaloneActivity : ComponentActivity() {

    private lateinit var rootStore: RootStore
    private lateinit var settingsStore: SettingsStore

    // Access Application for engine initialization
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication

    // ViewModel for torrent list
    private val viewModel: TorrentListViewModel by viewModels {
        TorrentListViewModel.Factory(application)
    }

    // UI State
    private var hasRoots = mutableStateOf(false)
    private var testStorageMode = mutableStateOf<String?>(null)
    private var isAddingRoot = mutableStateOf(false)
    private var showNotificationDialog = mutableStateOf(false)

    // For handling magnet intents while engine is loading
    private var pendingMagnet: String? = null
    private var pendingReplace: Boolean = false

    // For navigating to a specific torrent from notification tap
    private var initialInfoHash = mutableStateOf<String?>(null)

    // Trigger to navigate back to list after adding a torrent (increment to trigger)
    private var navigateToListTrigger = mutableStateOf(0)

    // Track which roots we've already synced with the engine
    private var knownRootKeys = mutableSetOf<String>()

    // Notification permission launcher
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        // Permission result handled - dialog was dismissed
        showNotificationDialog.value = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        rootStore = RootStore(this)
        settingsStore = SettingsStore(this)
        hasRoots.value = rootStore.listRoots().isNotEmpty()

        // Handle incoming intent (magnet link or torrent file)
        handleIncomingIntent(intent)

        // Initialize engine (idempotent)
        app.initializeEngine(storageMode = testStorageMode.value)

        // Check if we should show notification permission dialog (first launch only)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PermissionChecker.PERMISSION_GRANTED

            if (!granted && !settingsStore.hasShownNotificationPrompt) {
                showNotificationDialog.value = true
            }
        }

        setContent {
            JSTorrentTheme {
                // Show blank screen while notification dialog or adding root
                if (showNotificationDialog.value || isAddingRoot.value) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {}
                } else if (!hasRoots.value && testStorageMode.value == null) {
                    // Setup required
                    SetupRequiredScreen(onAddRoot = { launchAddRoot() })
                } else {
                    // Main navigation host
                    TorrentNavHost(
                        listViewModel = viewModel,
                        onAddRootClick = { launchAddRoot() },
                        onShutdownClick = { shutdown() },
                        initialInfoHash = initialInfoHash.value,
                        navigateToListTrigger = navigateToListTrigger.value,
                        onNavigatedToList = { navigateToListTrigger.value = 0 }
                    )
                }

                // Notification permission dialog (first launch only)
                if (showNotificationDialog.value) {
                    NotificationPermissionDialog(
                        onEnable = {
                            settingsStore.hasShownNotificationPrompt = true
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                notificationPermissionLauncher.launch(
                                    Manifest.permission.POST_NOTIFICATIONS
                                )
                            }
                        },
                        onNotNow = {
                            settingsStore.hasShownNotificationPrompt = true
                            showNotificationDialog.value = false
                        }
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        app.serviceLifecycleManager.onActivityStart()
        observeEngineForPendingMagnet()
    }

    override fun onStop() {
        super.onStop()
        app.serviceLifecycleManager.onActivityStop()
    }

    override fun onResume() {
        super.onResume()

        // Refresh roots (may have been added via AddRootActivity)
        rootStore.reload()
        hasRoots.value = rootStore.listRoots().isNotEmpty()

        // Clear the adding root flag (we're back from the picker)
        isAddingRoot.value = false

        // Sync any new roots with the running engine (on IO thread to avoid ANR)
        // The engine's callGlobalFunction uses latch.await() which blocks the calling thread
        lifecycleScope.launch(Dispatchers.IO) {
            syncRootsWithEngine()
        }
    }

    /**
     * Sync roots with the running engine.
     * Called on resume to handle roots added while activity was paused.
     * Uses async methods to avoid blocking.
     */
    private suspend fun syncRootsWithEngine() {
        val controller = app.engineController ?: return

        val currentRoots = rootStore.listRoots()
        val currentKeys = currentRoots.map { it.key }.toSet()

        // Add new roots to engine using async methods
        for (root in currentRoots) {
            if (root.key !in knownRootKeys) {
                controller.addRootAsync(root.key, root.displayName, root.uri)
                Log.i(TAG, "Synced new root to engine: ${root.key}")
            }
        }

        // Set default if we didn't have one before
        if (knownRootKeys.isEmpty() && currentRoots.isNotEmpty()) {
            controller.setDefaultRootAsync(currentRoots.first().key)
            Log.i(TAG, "Set default root: ${currentRoots.first().key}")
        }

        // Update known keys
        knownRootKeys = currentKeys.toMutableSet()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        // Check for infoHash extra from notification tap
        val infoHash = intent?.getStringExtra("infoHash")
        if (!infoHash.isNullOrEmpty()) {
            Log.i(TAG, "Navigating to torrent from notification: $infoHash")
            initialInfoHash.value = infoHash
            return
        }

        // Check for pre-read torrent file (base64 from MainActivity)
        // MainActivity reads the file while it has URI permission, then passes base64 here
        val torrentBase64 = intent?.getStringExtra("torrent_base64")
        if (!torrentBase64.isNullOrEmpty()) {
            Log.i(TAG, "Received torrent from MainActivity (${torrentBase64.length} chars)")
            addOrQueueMagnet(torrentBase64)
            return
        }

        val uri = intent?.data ?: return
        Log.d(TAG, "Received intent: $uri")

        when (uri.scheme) {
            "magnet" -> {
                val magnet = uri.toString()
                addOrQueueMagnet(magnet)
            }
            "content", "file" -> {
                handleTorrentFile(uri)
            }
            "jstorrent" -> {
                // Handle jstorrent://native launch intent
                Log.i(TAG, "Launch intent received")

                // Parse storage mode: ?storage=private or ?storage=null
                val storageParam = uri.getQueryParameter("storage")
                if (storageParam != null) {
                    testStorageMode.value = storageParam.lowercase()
                    Log.i(TAG, "Test storage mode: $storageParam")
                }

                // Parse replace mode: ?replace=true (removes existing torrent before adding)
                val replaceParam = uri.getQueryParameter("replace")?.lowercase() == "true"
                if (replaceParam) {
                    Log.i(TAG, "Replace mode enabled - will remove existing torrent if present")
                }

                // Check for base64-encoded magnet: jstorrent://native?magnet_b64=<base64>
                val magnetB64 = uri.getQueryParameter("magnet_b64")
                if (!magnetB64.isNullOrEmpty()) {
                    val magnet = String(Base64.decode(magnetB64, Base64.DEFAULT), Charsets.UTF_8)
                    Log.i(TAG, "Magnet from base64 param: $magnet")
                    addOrQueueMagnet(magnet, replace = replaceParam)
                } else {
                    // Fallback: Check for plain magnet query parameter
                    val magnetParam = uri.getQueryParameter("magnet")
                    if (!magnetParam.isNullOrEmpty()) {
                        Log.i(TAG, "Magnet from query param: $magnetParam")
                        addOrQueueMagnet(magnetParam, replace = replaceParam)
                    }
                }
            }
        }
    }

    /**
     * Add magnet immediately if engine is loaded, otherwise queue it.
     * After adding, navigates to the torrent list.
     *
     * @param magnet The magnet link or base64-encoded torrent file
     * @param replace If true, removes any existing torrent with the same infohash first
     */
    private fun addOrQueueMagnet(magnet: String, replace: Boolean = false) {
        val controller = app.engineController
        if (controller != null && controller.isLoaded?.value == true) {
            Log.i(TAG, "Engine loaded, adding torrent immediately (replace=$replace)")
            if (replace) {
                viewModel.replaceAndStartTorrent(magnet)
            } else {
                viewModel.addTorrent(magnet)
            }
            // Navigate to list to show the newly added torrent
            navigateToListTrigger.value++
        } else {
            Log.i(TAG, "Engine not loaded yet, queuing torrent (replace=$replace)")
            pendingMagnet = magnet
            pendingReplace = replace
        }
    }

    /**
     * Observe engine load state to add pending magnets.
     */
    private fun observeEngineForPendingMagnet() {
        lifecycleScope.launch {
            // Wait for engine controller to be available
            while (app.engineController == null) {
                delay(100)
            }

            val controller = app.engineController!!

            // Collect isLoaded to handle pending magnet
            controller.isLoaded?.collect { loaded ->
                if (loaded && pendingMagnet != null) {
                    Log.i(TAG, "Engine now loaded, adding queued torrent (replace=$pendingReplace)")
                    if (pendingReplace) {
                        viewModel.replaceAndStartTorrent(pendingMagnet!!)
                    } else {
                        viewModel.addTorrent(pendingMagnet!!)
                    }
                    pendingMagnet = null
                    pendingReplace = false
                    // Navigate to list to show the newly added torrent
                    navigateToListTrigger.value++
                }
            }
        }
    }

    private fun handleTorrentFile(uri: Uri) {
        // Read file on IO thread to avoid blocking main thread
        // Note: This is a fallback path. Normally MainActivity reads the file and passes base64.
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    Log.i(TAG, "Read torrent file directly: ${bytes.size} bytes")
                    withContext(Dispatchers.Main) {
                        addOrQueueMagnet(base64)
                    }
                } else {
                    Log.e(TAG, "Failed to read torrent file: openInputStream returned null (permission issue?)")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read torrent file", e)
            }
        }
    }

    private fun launchAddRoot() {
        isAddingRoot.value = true
        startActivity(Intent(this, AddRootActivity::class.java))
    }

    private fun shutdown() {
        // Stop the foreground service (if running)
        ForegroundNotificationService.stop(this)
        // Finish the activity
        finish()
    }
}

// =============================================================================
// Setup Required Screen
// =============================================================================

/**
 * Screen shown when no download folder is configured.
 */
@Composable
fun SetupRequiredScreen(
    onAddRoot: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Setup Required",
                        style = MaterialTheme.typography.titleLarge
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Please select a download folder to store your torrents.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Button(onClick = onAddRoot) {
                        Text("Select Download Folder")
                    }
                }
            }
        }
    }
}
