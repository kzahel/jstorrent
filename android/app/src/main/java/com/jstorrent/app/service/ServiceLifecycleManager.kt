package com.jstorrent.app.service

import android.content.Context
import android.util.Log
import com.jstorrent.app.cache.TorrentSummaryCache
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

private const val TAG = "ServiceLifecycleMgr"

/**
 * Decides when ForegroundNotificationService should run.
 *
 * Service runs when: background downloads enabled AND active downloads/seeding AND user not in app
 * Service stops when: background downloads disabled OR idle OR user in app
 *
 * Engine shutdown for battery saving:
 * - When background downloads are disabled and user leaves the app
 * - When service stops due to idle (no active downloads/seeding) while in background
 *
 * Stage 4 (Lazy Engine Startup): Background service coordination:
 * - If engine not started but cache has active incomplete torrents AND background downloads
 *   are enabled, request engine start so downloads can continue in background.
 * - Otherwise, don't start engine just because activity is foregrounded.
 *
 * The engine is reinitialized when the user returns to the app.
 */
class ServiceLifecycleManager(
    private val context: Context,
    private val settingsStore: SettingsStore,
    private val torrentSummaryCache: TorrentSummaryCache? = null,
    private val onShutdownForBackground: () -> Unit = {},
    private val onRestoreFromBackground: () -> Unit = {},
    private val onStartEngineForBackground: () -> Unit = {}
) {

    private val _isActivityForeground = MutableStateFlow(false)
    val isActivityForeground: StateFlow<Boolean> = _isActivityForeground

    private var hasActiveWork = false
    private var serviceRunning = false
    private var engineShutdownForBackground = false
    private var hasEverBeenForeground = false  // Track if activity has ever been visible
    private var userRequestedQuit = false  // Prevents auto-restart after explicit quit

    /**
     * Called from Activity.onStart()
     */
    fun onActivityStart() {
        Log.d(TAG, "Activity started (foreground)")
        _isActivityForeground.value = true
        hasEverBeenForeground = true
        userRequestedQuit = false  // Reset quit flag when user returns to app
        updateServiceState()
    }

    /**
     * Called from Activity.onStop()
     */
    fun onActivityStop() {
        Log.d(TAG, "Activity stopped (background)")
        _isActivityForeground.value = false
        updateServiceState()
    }

    /**
     * Called when torrent state changes.
     * Determines if there's active work based on torrent statuses and settings.
     */
    fun onTorrentStateChanged(torrents: List<TorrentSummary>) {
        val seedInBackground = settingsStore.whenDownloadsComplete == "keep_seeding"

        hasActiveWork = torrents.any { torrent ->
            val isDownloading = torrent.status in listOf(
                "downloading",
                "downloading_metadata",
                "checking"
            )
            val isSeeding = torrent.status == "seeding" && seedInBackground
            isDownloading || isSeeding
        }

        Log.d(TAG, "Torrent state changed: hasActiveWork=$hasActiveWork, " +
            "torrents=${torrents.size}, seedInBackground=$seedInBackground")
        updateServiceState()
    }

    /**
     * Manually set activity foreground state.
     * Used for testing to simulate foreground/background transitions.
     */
    fun setActivityForeground(foreground: Boolean) {
        Log.d(TAG, "Manual foreground set: $foreground")
        _isActivityForeground.value = foreground
        updateServiceState()
    }

    private fun updateServiceState() {
        // Don't restart service if user explicitly quit
        if (userRequestedQuit) {
            Log.d(TAG, "Skipping service update - user requested quit")
            return
        }

        val backgroundEnabled = settingsStore.backgroundDownloadsEnabled
        val goingToBackground = !_isActivityForeground.value

        // Stage 4: Check cache for active incomplete torrents when engine isn't running
        // This allows us to start the engine in background if there's pending work
        val cacheHasActiveWork = torrentSummaryCache?.hasActiveIncompleteTorrents() ?: false

        // Handle engine shutdown/restore for battery saving
        // Shut down engine when going to background if there's no reason to keep it running:
        // - Background downloads disabled, OR
        // - No active work (nothing downloading or seeding from either engine or cache)
        // This completely stops the engine tick loop to prevent battery drain
        val shouldShutdownEngine = goingToBackground &&
            (!backgroundEnabled || (!hasActiveWork && !cacheHasActiveWork)) &&
            !engineShutdownForBackground &&
            hasEverBeenForeground

        if (shouldShutdownEngine) {
            val reason = if (!backgroundEnabled) "background downloads disabled" else "no active work"
            Log.i(TAG, "Shutting down engine ($reason) to save battery")
            onShutdownForBackground()
            engineShutdownForBackground = true
        } else if (_isActivityForeground.value && engineShutdownForBackground) {
            Log.i(TAG, "Restoring engine after background shutdown")
            onRestoreFromBackground()
            engineShutdownForBackground = false
        }

        // Stage 4: Start engine in background if cache shows active incomplete torrents
        // This handles the lazy engine startup case where user backgrounds the app
        // but has active downloads that need to continue.
        if (goingToBackground &&
            backgroundEnabled &&
            !hasActiveWork &&
            cacheHasActiveWork &&
            hasEverBeenForeground &&
            !engineShutdownForBackground
        ) {
            Log.i(TAG, "Starting engine for background work (cache has active incomplete torrents)")
            onStartEngineForBackground()
            // hasActiveWork will be updated when engine reports state via onTorrentStateChanged
        }

        // Determine if service should run:
        // - Background downloads enabled
        // - Either engine reports active work OR cache shows active incomplete torrents
        // - User is not in the app
        // - Activity has been foreground at least once
        val hasAnyActiveWork = hasActiveWork || cacheHasActiveWork
        val shouldRun = backgroundEnabled && hasAnyActiveWork && goingToBackground && hasEverBeenForeground

        if (shouldRun && !serviceRunning) {
            Log.i(TAG, "Starting service: active work in background")
            ForegroundNotificationService.start(context)
            serviceRunning = true
        } else if (!shouldRun && serviceRunning) {
            val reason = when {
                !backgroundEnabled -> "background downloads disabled"
                !hasAnyActiveWork -> "idle"
                _isActivityForeground.value -> "user in app"
                else -> "unknown"
            }
            Log.i(TAG, "Stopping service: $reason")
            ForegroundNotificationService.stop(context)
            serviceRunning = false
            // Note: Engine shutdown is handled above by shouldShutdownEngine
        }
    }

    /**
     * Reset the service tracking state.
     * Used when service is stopped externally (e.g., via notification quit action).
     */
    fun onServiceStopped() {
        serviceRunning = false
    }

    /**
     * Called when user explicitly quits the app.
     * Prevents auto-restart of the service until the user returns to the app.
     */
    fun onUserQuit() {
        Log.i(TAG, "User requested quit - preventing service restart")
        userRequestedQuit = true
        if (serviceRunning) {
            ForegroundNotificationService.stop(context)
            serviceRunning = false
        }
    }
}
