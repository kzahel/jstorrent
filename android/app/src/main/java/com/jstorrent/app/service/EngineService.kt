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
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.network.NetworkMonitor
import com.jstorrent.app.notification.ForegroundNotificationManager
import com.jstorrent.app.notification.TorrentNotificationManager
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.quickjs.EngineController
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

    // Access engine from Application (engine lives for process lifetime)
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication

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

    /** Public access to controller for root management */
    val controller: EngineController?
        get() = app.engineController

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

        // Start notification updates and WiFi monitoring
        // Engine is already initialized by Activity before service starts
        startNotificationUpdates()
        if (settingsStore.wifiOnlyEnabled) {
            startWifiMonitoring()
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

        // NOTE: Engine is NOT destroyed here - it lives in Application
        // and survives service restarts

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

    companion object {
        @Volatile
        var instance: EngineService? = null
            private set

        @Volatile
        var storageMode: String? = null
            private set

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
