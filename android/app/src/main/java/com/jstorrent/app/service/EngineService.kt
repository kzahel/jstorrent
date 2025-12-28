package com.jstorrent.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.jstorrent.app.network.NetworkMonitor
import com.jstorrent.app.notification.ForegroundNotificationManager
import com.jstorrent.app.notification.TorrentNotificationManager
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.quickjs.EngineController
import com.jstorrent.quickjs.model.ContentRoot
import com.jstorrent.quickjs.model.EngineConfig
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val TAG = "EngineService"

/**
 * Foreground service for the JSTorrent engine.
 *
 * Runs the QuickJS engine with the TypeScript BitTorrent implementation.
 * Provides singleton access for Activities to control torrents.
 *
 * Usage:
 * ```kotlin
 * EngineService.start(context)
 * EngineService.instance?.addTorrent("magnet:...")
 * EngineService.stop(context)
 * ```
 */
class EngineService : Service() {

    // Use IO dispatcher for network/file operations in the engine
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var rootStore: RootStore
    private lateinit var settingsStore: SettingsStore
    private var _controller: EngineController? = null

    // Notification management
    private lateinit var notificationManager: ForegroundNotificationManager
    private lateinit var torrentNotificationManager: TorrentNotificationManager
    private var notificationUpdateJob: Job? = null

    // State tracking for completion/error notifications
    private data class TorrentStateSnapshot(
        val progress: Double,
        val status: String
    )
    private val previousStates = mutableMapOf<String, TorrentStateSnapshot>()

    // Network monitoring for WiFi-only mode
    private var networkMonitor: NetworkMonitor? = null
    private var wifiMonitorJob: Job? = null
    private var wasPausedByWifi = false  // Track if we paused due to WiFi loss

    // Service lifecycle state
    private val _serviceState = MutableStateFlow(ServiceState.RUNNING)
    val serviceState: StateFlow<ServiceState> = _serviceState.asStateFlow()

    // Main thread handler for toasts
    private val mainHandler = Handler(Looper.getMainLooper())

    // Timestamp when engine finished loading (for startup grace period)
    private var engineLoadedAtMs: Long = 0L

    // Track if we've seen at least one torrent complete during this session
    // Used to prevent auto-stop when all torrents are already complete at startup
    private var hasSeenCompletionDuringSession = false

    /** Public access to controller for root management */
    val controller: EngineController?
        get() = _controller

    // Exposed state for UI
    val state: StateFlow<EngineState?>?
        get() = controller?.state

    val isLoaded: StateFlow<Boolean>?
        get() = controller?.isLoaded

    val lastError: StateFlow<String?>?
        get() = controller?.lastError

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        rootStore = RootStore(this)
        settingsStore = SettingsStore(this)
        notificationManager = ForegroundNotificationManager(this)
        torrentNotificationManager = TorrentNotificationManager(this)
        networkMonitor = NetworkMonitor(this)

        // Set singleton
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        // Must call startForeground immediately (Android requirement)
        // Android 14+ requires specifying foreground service type
        val initialNotification = notificationManager.buildNotification(emptyList())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                ForegroundNotificationManager.NOTIFICATION_ID,
                initialNotification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(ForegroundNotificationManager.NOTIFICATION_ID, initialNotification)
        }

        // Initialize engine on IO thread
        ioScope.launch {
            try {
                initializeEngine()
                startNotificationUpdates()

                // Start WiFi monitoring if WiFi-only mode is enabled
                if (settingsStore.wifiOnlyEnabled) {
                    startWifiMonitoring()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize engine", e)
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        instance = null

        // Stop WiFi monitoring
        stopWifiMonitoring()
        networkMonitor?.stop()
        networkMonitor = null

        notificationUpdateJob?.cancel()
        notificationUpdateJob = null

        _controller?.close()
        _controller = null

        _serviceState.value = ServiceState.STOPPED
        ioScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // =========================================================================
    // Engine Control API
    // =========================================================================

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file.
     */
    fun addTorrent(magnetOrBase64: String) {
        controller?.addTorrent(magnetOrBase64)
    }

    /**
     * Add test torrent with hardcoded peer hint for debugging.
     */
    fun addTestTorrent() {
        controller?.addTestTorrent()
    }

    /**
     * Pause a torrent.
     */
    fun pauseTorrent(infoHash: String) {
        controller?.pauseTorrent(infoHash)
    }

    /**
     * Resume a paused torrent.
     */
    fun resumeTorrent(infoHash: String) {
        controller?.resumeTorrent(infoHash)
    }

    /**
     * Remove a torrent.
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false) {
        controller?.removeTorrent(infoHash, deleteFiles)
    }

    /**
     * Get full torrent list.
     */
    fun getTorrentList(): List<TorrentInfo> {
        return controller?.getTorrentList() ?: emptyList()
    }

    /**
     * Get files for a torrent.
     */
    fun getFiles(infoHash: String): List<FileInfo> {
        return controller?.getFiles(infoHash) ?: emptyList()
    }

    // =========================================================================
    // Async Engine Control API
    // =========================================================================

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file (async).
     */
    suspend fun addTorrentAsync(magnetOrBase64: String) {
        controller?.addTorrentAsync(magnetOrBase64)
    }

    /**
     * Add test torrent with hardcoded peer hint for debugging (async).
     */
    suspend fun addTestTorrentAsync() {
        controller?.addTestTorrentAsync()
    }

    /**
     * Pause a torrent (async).
     */
    suspend fun pauseTorrentAsync(infoHash: String) {
        controller?.pauseTorrentAsync(infoHash)
    }

    /**
     * Resume a paused torrent (async).
     */
    suspend fun resumeTorrentAsync(infoHash: String) {
        controller?.resumeTorrentAsync(infoHash)
    }

    /**
     * Remove a torrent (async).
     */
    suspend fun removeTorrentAsync(infoHash: String, deleteFiles: Boolean = false) {
        controller?.removeTorrentAsync(infoHash, deleteFiles)
    }

    /**
     * Get full torrent list (async).
     */
    suspend fun getTorrentListAsync(): List<TorrentInfo> {
        return controller?.getTorrentListAsync() ?: emptyList()
    }

    /**
     * Get files for a torrent (async).
     */
    suspend fun getFilesAsync(infoHash: String): List<FileInfo> {
        return controller?.getFilesAsync(infoHash) ?: emptyList()
    }

    // =========================================================================
    // Bandwidth Control API
    // =========================================================================

    /**
     * Set download speed limit and persist to settings.
     * @param bytesPerSec Limit in bytes/sec (0 = unlimited)
     */
    fun setDownloadSpeedLimit(bytesPerSec: Int) {
        settingsStore.downloadSpeedLimit = bytesPerSec
        controller?.getConfigBridge()?.setDownloadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Download limit set: $bytesPerSec B/s")
    }

    /**
     * Set upload speed limit and persist to settings.
     * @param bytesPerSec Limit in bytes/sec (0 = unlimited)
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        settingsStore.uploadSpeedLimit = bytesPerSec
        controller?.getConfigBridge()?.setUploadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Upload limit set: $bytesPerSec B/s")
    }

    /**
     * Get the current download speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getDownloadSpeedLimit(): Int = settingsStore.downloadSpeedLimit

    /**
     * Get the current upload speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getUploadSpeedLimit(): Int = settingsStore.uploadSpeedLimit

    // =========================================================================
    // Network Settings API
    // =========================================================================

    /**
     * Enable or disable DHT and persist to settings.
     */
    fun setDhtEnabled(enabled: Boolean) {
        settingsStore.dhtEnabled = enabled
        controller?.getConfigBridge()?.setDhtEnabled(enabled)
        Log.i(TAG, "DHT ${if (enabled) "enabled" else "disabled"}")
    }

    /**
     * Get whether DHT is enabled.
     */
    fun getDhtEnabled(): Boolean = settingsStore.dhtEnabled

    /**
     * Enable or disable PEX and persist to settings.
     */
    fun setPexEnabled(enabled: Boolean) {
        settingsStore.pexEnabled = enabled
        controller?.getConfigBridge()?.setPexEnabled(enabled)
        Log.i(TAG, "PEX ${if (enabled) "enabled" else "disabled"}")
    }

    /**
     * Get whether PEX is enabled.
     */
    fun getPexEnabled(): Boolean = settingsStore.pexEnabled

    /**
     * Set encryption policy and persist to settings.
     * @param policy One of: "disabled", "allow", "prefer", "required"
     */
    fun setEncryptionPolicy(policy: String) {
        settingsStore.encryptionPolicy = policy
        controller?.getConfigBridge()?.setEncryptionPolicy(policy)
        Log.i(TAG, "Encryption policy set: $policy")
    }

    /**
     * Get the current encryption policy.
     */
    fun getEncryptionPolicy(): String = settingsStore.encryptionPolicy

    // =========================================================================
    // Private Implementation
    // =========================================================================

    private fun initializeEngine() {
        // Don't reinitialize if already loaded
        if (_controller?.isLoaded?.value == true) {
            Log.i(TAG, "Engine already loaded, skipping initialization")
            return
        }

        Log.i(TAG, "Initializing engine...")

        // Create rootResolver that queries RootStore dynamically
        // This allows FileBindings to find roots added after engine startup
        // We reload() before each resolve to pick up changes from AddRootActivity
        val rootResolver: (String) -> android.net.Uri? = { key ->
            rootStore.reload()
            rootStore.resolveKey(key)
        }

        _controller = EngineController(
            context = this,
            scope = ioScope,
            rootResolver = rootResolver
        )

        // Build config from RootStore
        val roots = rootStore.listRoots()
        // Use saved default root key, or fall back to first root
        val defaultKey = settingsStore.defaultRootKey?.takeIf { key ->
            roots.any { it.key == key }
        } ?: roots.firstOrNull()?.key

        val config = EngineConfig(
            contentRoots = roots.map { root ->
                ContentRoot(
                    key = root.key,
                    label = root.displayName,
                    path = root.uri  // SAF URI as path
                )
            },
            defaultContentRoot = defaultKey,
            storageMode = if (storageMode == "null") "null" else null
        )

        _controller!!.loadEngine(config)
        engineLoadedAtMs = System.currentTimeMillis()
        Log.i(TAG, "Engine loaded successfully")

        // Apply all saved settings to engine
        applyEngineSettings()
    }

    /**
     * Apply all saved settings from SettingsStore to the engine.
     */
    private fun applyEngineSettings() {
        val configBridge = _controller?.getConfigBridge() ?: return

        // Bandwidth settings
        val downloadLimit = settingsStore.downloadSpeedLimit
        val uploadLimit = settingsStore.uploadSpeedLimit

        if (downloadLimit > 0) {
            configBridge.setDownloadSpeedLimit(downloadLimit)
        }
        if (uploadLimit > 0) {
            configBridge.setUploadSpeedLimit(uploadLimit)
        }

        // Network settings
        configBridge.setDhtEnabled(settingsStore.dhtEnabled)
        configBridge.setPexEnabled(settingsStore.pexEnabled)
        configBridge.setEncryptionPolicy(settingsStore.encryptionPolicy)

        Log.i(TAG, "Applied engine settings: download=${downloadLimit}B/s, upload=${uploadLimit}B/s, " +
            "dht=${settingsStore.dhtEnabled}, pex=${settingsStore.pexEnabled}, " +
            "encryption=${settingsStore.encryptionPolicy}")
    }

    // =========================================================================
    // Notification
    // =========================================================================

    /**
     * Start the notification update loop.
     * Updates notification every 1 second with current torrent stats.
     * Also detects completion and error state transitions to show notifications.
     */
    private fun startNotificationUpdates() {
        notificationUpdateJob = ioScope.launch {
            while (isActive) {
                val torrents = state?.value?.torrents ?: emptyList()

                // Check for state transitions
                checkStateTransitions(torrents)

                // Update foreground notification
                notificationManager.updateNotification(torrents)
                delay(1000)  // Update every 1 second
            }
        }
    }

    /**
     * Check for torrent state transitions and show notifications.
     */
    private suspend fun checkStateTransitions(torrents: List<TorrentSummary>) {
        for (torrent in torrents) {
            val prev = previousStates[torrent.infoHash]

            // Detect completion: wasn't complete before, now is
            if (torrent.progress >= 1.0 && (prev == null || prev.progress < 1.0)) {
                showCompletionNotification(torrent)
                // Only count as "seen completion" if torrent was previously incomplete
                // (not if it was already complete at startup)
                if (prev != null && prev.progress < 1.0) {
                    hasSeenCompletionDuringSession = true
                }
            }

            // Detect error: wasn't error before, now is
            if (torrent.status == "error" && prev?.status != "error") {
                showErrorNotification(torrent)
            }

            // Update previous state
            previousStates[torrent.infoHash] = TorrentStateSnapshot(
                progress = torrent.progress,
                status = torrent.status
            )
        }

        // Clean up removed torrents from tracking
        val currentHashes = torrents.map { it.infoHash }.toSet()
        previousStates.keys.removeAll { it !in currentHashes }

        // Check if all torrents are complete for auto-stop
        checkAllComplete(torrents)
    }

    /**
     * Show a completion notification for a torrent.
     */
    private suspend fun showCompletionNotification(torrent: TorrentSummary) {
        Log.i(TAG, "Torrent completed: ${torrent.name}")

        // Get full TorrentInfo for size
        val info = controller?.getTorrentListAsync()
            ?.find { it.infoHash == torrent.infoHash }

        val size = info?.size ?: 0L

        // Get default download folder URI
        val folderUri = getDefaultFolderUri()

        torrentNotificationManager.showDownloadComplete(
            torrentName = torrent.name,
            infoHash = torrent.infoHash,
            sizeBytes = size,
            folderUri = folderUri
        )
    }

    /**
     * Show an error notification for a torrent.
     */
    private fun showErrorNotification(torrent: TorrentSummary) {
        Log.w(TAG, "Torrent error: ${torrent.name}")

        // TODO: Get specific error message from engine when available
        val errorMessage = "Download error"

        torrentNotificationManager.showError(
            torrentName = torrent.name,
            infoHash = torrent.infoHash,
            errorMessage = errorMessage
        )
    }

    /**
     * Get the URI for the default download folder.
     */
    private fun getDefaultFolderUri(): Uri? {
        val defaultKey = settingsStore.defaultRootKey
        if (defaultKey != null) {
            return rootStore.resolveKey(defaultKey)
        }

        // Fall back to first available root
        val roots = rootStore.listRoots()
        return roots.firstOrNull()?.let { Uri.parse(it.uri) }
    }

    /**
     * Pause all active torrents. Called from notification action.
     */
    fun pauseAllTorrents() {
        ioScope.launch {
            val torrents = state?.value?.torrents ?: return@launch
            for (torrent in torrents) {
                if (torrent.status != "stopped") {
                    pauseTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    /**
     * Resume all stopped torrents. Called from notification action.
     */
    fun resumeAllTorrents() {
        ioScope.launch {
            val torrents = state?.value?.torrents ?: return@launch
            for (torrent in torrents) {
                if (torrent.status == "stopped") {
                    resumeTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    // =========================================================================
    // WiFi Monitoring for WiFi-Only Mode
    // =========================================================================

    /**
     * Start monitoring WiFi state for WiFi-only mode.
     */
    private fun startWifiMonitoring() {
        networkMonitor?.start()

        wifiMonitorJob?.cancel()
        wifiMonitorJob = ioScope.launch {
            networkMonitor?.isWifiConnected?.collectLatest { isWifi ->
                handleWifiStateChange(isWifi)
            }
        }
        Log.i(TAG, "WiFi monitoring started")
    }

    /**
     * Stop WiFi monitoring.
     */
    private fun stopWifiMonitoring() {
        wifiMonitorJob?.cancel()
        wifiMonitorJob = null
        Log.i(TAG, "WiFi monitoring stopped")
    }

    /**
     * Handle WiFi state changes when WiFi-only mode is enabled.
     */
    private fun handleWifiStateChange(isWifiConnected: Boolean) {
        if (!settingsStore.wifiOnlyEnabled) return

        if (!isWifiConnected && _serviceState.value == ServiceState.RUNNING) {
            // Lost WiFi, pause everything
            Log.i(TAG, "WiFi lost, pausing all torrents")
            _serviceState.value = ServiceState.PAUSED_WIFI
            wasPausedByWifi = true
            pauseAllTorrents()

            // Show toast on main thread
            mainHandler.post {
                Toast.makeText(
                    this@EngineService,
                    "Paused - waiting for WiFi",
                    Toast.LENGTH_SHORT
                ).show()
            }
        } else if (isWifiConnected && _serviceState.value == ServiceState.PAUSED_WIFI) {
            // WiFi restored, resume
            Log.i(TAG, "WiFi restored, resuming all torrents")
            _serviceState.value = ServiceState.RUNNING
            if (wasPausedByWifi) {
                resumeAllTorrents()
                wasPausedByWifi = false
            }

            mainHandler.post {
                Toast.makeText(
                    this@EngineService,
                    "WiFi connected - resuming",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    /**
     * Enable or disable WiFi-only mode at runtime.
     * Called from SettingsViewModel when user toggles the setting.
     */
    fun setWifiOnlyEnabled(enabled: Boolean) {
        settingsStore.wifiOnlyEnabled = enabled

        if (enabled) {
            startWifiMonitoring()
            // Check current state immediately
            val isWifi = networkMonitor?.isWifiConnected?.value ?: true
            if (!isWifi) {
                handleWifiStateChange(false)
            }
        } else {
            // Disable WiFi-only: resume if we were paused
            if (_serviceState.value == ServiceState.PAUSED_WIFI) {
                _serviceState.value = ServiceState.RUNNING
                if (wasPausedByWifi) {
                    resumeAllTorrents()
                    wasPausedByWifi = false
                }
            }
            stopWifiMonitoring()
        }

        Log.i(TAG, "WiFi-only mode ${if (enabled) "enabled" else "disabled"}")
    }

    // =========================================================================
    // All-Complete Detection for Auto-Stop
    // =========================================================================

    /**
     * Check if service should auto-stop and handle shutdown.
     * Called from the notification update loop after state transitions.
     *
     * Auto-stops when:
     * - No torrents exist (empty list)
     * - All torrents are paused by user
     * - All torrents are complete (and at least one completed during this session)
     */
    private fun checkAllComplete(torrents: List<TorrentSummary>) {
        // Common guards - these apply to all auto-stop conditions
        if (settingsStore.whenDownloadsComplete != "stop_and_close") return
        if (_serviceState.value == ServiceState.PAUSED_WIFI) return

        // Don't auto-stop during startup grace period
        val timeSinceLoad = System.currentTimeMillis() - engineLoadedAtMs
        if (timeSinceLoad < STARTUP_GRACE_PERIOD_MS) {
            Log.d(TAG, "Skipping auto-stop: within startup grace period (${timeSinceLoad}ms)")
            return
        }

        // Don't auto-stop while activity is in foreground
        if (isActivityInForeground) {
            Log.d(TAG, "Skipping auto-stop: activity is in foreground")
            return
        }

        // Stop if no torrents exist
        if (torrents.isEmpty()) {
            Log.i(TAG, "No torrents exist, stopping service")
            _serviceState.value = ServiceState.STOPPED
            stopSelf()
            return
        }

        // Stop if all torrents are paused by user
        val allPaused = torrents.all { it.status == "stopped" }
        if (allPaused) {
            Log.i(TAG, "All torrents paused, stopping service")
            _serviceState.value = ServiceState.STOPPED
            stopSelf()
            return
        }

        // Don't auto-stop if all torrents were already complete at startup
        // Only auto-stop when at least one torrent has actually completed during this session
        if (!hasSeenCompletionDuringSession) {
            Log.d(TAG, "Skipping auto-stop: no torrents completed during this session")
            return
        }

        // Check if ALL torrents are complete (progress >= 1.0)
        val allComplete = torrents.all { it.progress >= 1.0 }

        if (allComplete) {
            Log.i(TAG, "All torrents complete, stopping service")

            // Show toast on main thread before stopping
            mainHandler.post {
                Toast.makeText(
                    this@EngineService,
                    "All downloads complete",
                    Toast.LENGTH_SHORT
                ).show()
            }

            // Stop the service
            _serviceState.value = ServiceState.STOPPED
            stopSelf()
        }
    }

    companion object {
        /** Grace period after engine init before auto-stop is allowed (ms) */
        private const val STARTUP_GRACE_PERIOD_MS = 5000L

        @Volatile
        var instance: EngineService? = null
            private set

        @Volatile
        var storageMode: String? = null
            private set

        /**
         * Set by activity to indicate it's in foreground.
         * When true, auto-stop on completion is disabled.
         */
        @Volatile
        var isActivityInForeground: Boolean = false

        fun start(context: Context, storageMode: String? = null) {
            this.storageMode = storageMode
            val intent = Intent(context, EngineService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, EngineService::class.java)
            context.stopService(intent)
        }
    }
}
