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
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import android.widget.Toast
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.network.NetworkMonitor
import com.jstorrent.app.power.DozeMonitor
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

private const val TAG = "ForegroundNotificationService"

/**
 * Foreground service that keeps the app alive during background downloads.
 *
 * Responsibilities:
 * - Runs as a foreground service to prevent process death
 * - Shows persistent notification with pause/resume/quit actions
 * - Monitors WiFi state for wifi-only mode
 * - Sends completion/error notifications for torrents
 *
 * Note: The engine itself lives in the Application (app.engineController),
 * not in this service. This service just keeps the process alive.
 *
 * Usage:
 * ```kotlin
 * ForegroundNotificationService.start(context)
 * ForegroundNotificationService.stop(context)
 * ```
 */
class ForegroundNotificationService : Service() {

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

    // Wake locks to prevent deep sleep and WiFi throttling during downloads
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    // Doze mode monitoring for debugging power state transitions
    private var dozeMonitor: DozeMonitor? = null

    // Battery monitoring for low battery shutdown
    private var batteryMonitorJob: Job? = null
    private var hasTriggeredLowBatteryShutdown = false  // Prevent repeated triggers

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

        // Initialize dependencies needed for notification
        notificationManager = ForegroundNotificationManager(this)

        // CRITICAL: Call startForeground immediately in onCreate to avoid ANR on slow devices.
        // Android requires startForeground within ~5 seconds of startForegroundService().
        // On slow CI emulators, waiting until onStartCommand can exceed this timeout.
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
        Log.i(TAG, "startForeground called")

        // Initialize remaining dependencies
        rootStore = RootStore(this)
        settingsStore = SettingsStore(this)
        torrentNotificationManager = TorrentNotificationManager(this)
        networkMonitor = NetworkMonitor(this)
        dozeMonitor = DozeMonitor(this)

        // Set singleton
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        // Start notification updates and WiFi monitoring
        // Engine is already initialized by Activity before service starts
        startNotificationUpdates()
        if (settingsStore.wifiOnlyEnabled) {
            startWifiMonitoring()
        }

        // Acquire wake locks if enabled
        if (settingsStore.cpuWakeLockEnabled) {
            acquireWakeLocks()
        }

        // Always start Doze monitoring for debugging
        dozeMonitor?.start()

        // Start battery monitoring if enabled
        if (settingsStore.shutdownOnLowBatteryEnabled) {
            startBatteryMonitoring()
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

        // Stop Doze monitoring
        dozeMonitor?.stop()
        dozeMonitor = null

        // Stop battery monitoring
        stopBatteryMonitoring()

        // Release wake locks
        releaseWakeLocks()

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
        // Update both unlimited flag and limit value for consistent persistence
        settingsStore.downloadSpeedUnlimited = (bytesPerSec == 0)
        if (bytesPerSec > 0) {
            settingsStore.downloadSpeedLimit = bytesPerSec
        }
        controller?.getConfigBridge()?.setDownloadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Download limit set: ${if (bytesPerSec == 0) "unlimited" else "$bytesPerSec B/s"}")
    }

    /**
     * Set upload speed limit and persist to settings.
     * @param bytesPerSec Limit in bytes/sec (0 = unlimited)
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        // Update both unlimited flag and limit value for consistent persistence
        settingsStore.uploadSpeedUnlimited = (bytesPerSec == 0)
        if (bytesPerSec > 0) {
            settingsStore.uploadSpeedLimit = bytesPerSec
        }
        controller?.getConfigBridge()?.setUploadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Upload limit set: ${if (bytesPerSec == 0) "unlimited" else "$bytesPerSec B/s"}")
    }

    /**
     * Get the current download speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getDownloadSpeedLimit(): Int =
        if (settingsStore.downloadSpeedUnlimited) 0 else settingsStore.downloadSpeedLimit

    /**
     * Get the current upload speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getUploadSpeedLimit(): Int =
        if (settingsStore.uploadSpeedUnlimited) 0 else settingsStore.uploadSpeedLimit

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
            // Seed previousStates with current state before starting the loop.
            // This prevents showing completion notifications for torrents that were
            // already complete before the service started (e.g., after service restart).
            val initialTorrents = state?.value?.torrents ?: emptyList()
            for (torrent in initialTorrents) {
                previousStates[torrent.infoHash] = TorrentStateSnapshot(
                    progress = torrent.progress,
                    status = torrent.status
                )
            }

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
                    this@ForegroundNotificationService,
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
                    this@ForegroundNotificationService,
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
    // Wake Locks for Preventing Deep Sleep and WiFi Throttling
    // =========================================================================

    /**
     * Acquire wake locks to keep CPU running and WiFi at high performance.
     */
    @Suppress("DEPRECATION")
    private fun acquireWakeLocks() {
        // CPU wake lock
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "JSTorrent::DownloadWakeLock"
            ).apply {
                acquire()
            }
            Log.i(TAG, "CPU wake lock acquired")
        }

        // WiFi wake lock - keeps WiFi at high performance when screen is off
        if (wifiLock == null) {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val wifiMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            } else {
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            }
            wifiLock = wifiManager.createWifiLock(wifiMode, "JSTorrent::DownloadWifiLock").apply {
                acquire()
            }
            Log.i(TAG, "WiFi wake lock acquired (mode: ${if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) "LOW_LATENCY" else "HIGH_PERF"})")
        }
    }

    /**
     * Release all wake locks if held.
     */
    private fun releaseWakeLocks() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.i(TAG, "CPU wake lock released")
            }
        }
        wakeLock = null

        wifiLock?.let {
            if (it.isHeld) {
                it.release()
                Log.i(TAG, "WiFi wake lock released")
            }
        }
        wifiLock = null
    }

    /**
     * Enable or disable wake locks at runtime.
     * Called from SettingsViewModel when user toggles the setting.
     */
    fun setCpuWakeLockEnabled(enabled: Boolean) {
        settingsStore.cpuWakeLockEnabled = enabled

        if (enabled) {
            acquireWakeLocks()
        } else {
            releaseWakeLocks()
        }

        Log.i(TAG, "Wake locks ${if (enabled) "enabled" else "disabled"}")
    }

    // =========================================================================
    // Battery Monitoring for Low Battery Shutdown
    // =========================================================================

    /**
     * Start monitoring battery level for low battery shutdown.
     */
    private fun startBatteryMonitoring() {
        batteryMonitorJob?.cancel()
        hasTriggeredLowBatteryShutdown = false

        batteryMonitorJob = ioScope.launch {
            dozeMonitor?.batteryLevel?.collectLatest { level ->
                handleBatteryLevelChange(level)
            }
        }
        Log.i(TAG, "Battery monitoring started (threshold: ${settingsStore.shutdownOnLowBatteryThreshold}%)")
    }

    /**
     * Stop battery level monitoring.
     */
    private fun stopBatteryMonitoring() {
        batteryMonitorJob?.cancel()
        batteryMonitorJob = null
        Log.i(TAG, "Battery monitoring stopped")
    }

    /**
     * Handle battery level changes when low battery shutdown is enabled.
     */
    private fun handleBatteryLevelChange(batteryLevel: Int) {
        if (!settingsStore.shutdownOnLowBatteryEnabled) return
        if (hasTriggeredLowBatteryShutdown) return  // Already triggered
        if (batteryLevel < 0) return  // Invalid reading

        val threshold = settingsStore.shutdownOnLowBatteryThreshold
        val isCharging = dozeMonitor?.isCharging?.value ?: false

        // Don't trigger if charging
        if (isCharging) {
            // Reset the flag if we're charging again
            hasTriggeredLowBatteryShutdown = false
            return
        }

        if (batteryLevel <= threshold) {
            Log.w(TAG, "Battery level ($batteryLevel%) at or below threshold ($threshold%) - shutting down")
            hasTriggeredLowBatteryShutdown = true
            triggerLowBatteryShutdown()
        }
    }

    /**
     * Trigger shutdown due to low battery.
     */
    private fun triggerLowBatteryShutdown() {
        // Show toast on main thread
        mainHandler.post {
            Toast.makeText(
                this@ForegroundNotificationService,
                "Stopping - battery low",
                Toast.LENGTH_LONG
            ).show()
        }

        // Pause all torrents
        pauseAllTorrents()

        // Stop the service after a short delay to let the toast show
        mainHandler.postDelayed({
            stop(this@ForegroundNotificationService)
        }, 500)
    }

    /**
     * Enable or disable low battery shutdown at runtime.
     * Called from SettingsViewModel when user toggles the setting.
     */
    fun setShutdownOnLowBatteryEnabled(enabled: Boolean) {
        settingsStore.shutdownOnLowBatteryEnabled = enabled

        if (enabled) {
            startBatteryMonitoring()
            // Check current battery level immediately
            val currentLevel = dozeMonitor?.batteryLevel?.value ?: 100
            handleBatteryLevelChange(currentLevel)
        } else {
            stopBatteryMonitoring()
        }

        Log.i(TAG, "Low battery shutdown ${if (enabled) "enabled" else "disabled"}")
    }

    /**
     * Update the low battery shutdown threshold.
     * Called from SettingsViewModel when user changes the threshold.
     */
    fun setShutdownOnLowBatteryThreshold(threshold: Int) {
        settingsStore.shutdownOnLowBatteryThreshold = threshold
        // If monitoring is active, check if current level is now below new threshold
        if (settingsStore.shutdownOnLowBatteryEnabled) {
            val currentLevel = dozeMonitor?.batteryLevel?.value ?: 100
            handleBatteryLevelChange(currentLevel)
        }
        Log.i(TAG, "Low battery shutdown threshold set to $threshold%")
    }

    companion object {
        /**
         * Reference to the running service instance, or null if service is not running.
         *
         * IMPORTANT: Do NOT use this for engine operations (pause/resume torrents, add torrents,
         * change settings, etc). The engine lives in the Application (app.engineController) and
         * persists for the process lifetime. The service is only running during background
         * downloads - using this for engine operations will silently fail when the service
         * isn't running. Use app.engineController instead.
         *
         * Valid uses: checking if service is running, service-specific operations like WiFi monitoring.
         */
        @Volatile
        var instance: ForegroundNotificationService? = null
            private set

        @Volatile
        var storageMode: String? = null
            private set

        fun start(context: Context, storageMode: String? = null) {
            this.storageMode = storageMode
            val intent = Intent(context, ForegroundNotificationService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ForegroundNotificationService::class.java)
            context.stopService(intent)
        }
    }
}
