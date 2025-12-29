package com.jstorrent.app.service

import android.content.Context
import android.util.Log
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
 * When background downloads are disabled and user leaves the app, all torrents are paused.
 * This prevents silent battery drain - users must opt-in to background downloads.
 */
class ServiceLifecycleManager(
    private val context: Context,
    private val settingsStore: SettingsStore,
    private val onPauseAll: () -> Unit = {},
    private val onResumeAll: () -> Unit = {}
) {

    private val _isActivityForeground = MutableStateFlow(false)
    val isActivityForeground: StateFlow<Boolean> = _isActivityForeground

    private var hasActiveWork = false
    private var serviceRunning = false
    private var pausedForBackground = false
    private var hasEverBeenForeground = false  // Track if activity has ever been visible

    /**
     * Called from Activity.onStart()
     */
    fun onActivityStart() {
        Log.d(TAG, "Activity started (foreground)")
        _isActivityForeground.value = true
        hasEverBeenForeground = true
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
        val backgroundEnabled = settingsStore.backgroundDownloadsEnabled
        val goingToBackground = !_isActivityForeground.value

        // Handle pause/resume when background downloads are disabled
        // Only pause when transitioning FROM foreground TO background (not on initial startup)
        if (!backgroundEnabled && goingToBackground && hasActiveWork && !pausedForBackground && hasEverBeenForeground) {
            Log.i(TAG, "Background downloads disabled - pausing all torrents")
            onPauseAll()
            pausedForBackground = true
        } else if (_isActivityForeground.value && pausedForBackground) {
            Log.i(TAG, "Resuming torrents after background pause")
            onResumeAll()
            pausedForBackground = false
        }

        // Only start service if background downloads are enabled
        // Also require activity to have been foreground at least once - prevents starting
        // during app initialization before onActivityStart() is called
        val shouldRun = backgroundEnabled && hasActiveWork && goingToBackground && hasEverBeenForeground

        if (shouldRun && !serviceRunning) {
            Log.i(TAG, "Starting service: active work in background")
            ForegroundNotificationService.start(context)
            serviceRunning = true
        } else if (!shouldRun && serviceRunning) {
            val reason = when {
                !backgroundEnabled -> "background downloads disabled"
                !hasActiveWork -> "idle"
                _isActivityForeground.value -> "user in app"
                else -> "unknown"
            }
            Log.i(TAG, "Stopping service: $reason")
            ForegroundNotificationService.stop(context)
            serviceRunning = false
        }
    }

    /**
     * Reset the service tracking state.
     * Used when service is stopped externally (e.g., via notification quit action).
     */
    fun onServiceStopped() {
        serviceRunning = false
    }
}
