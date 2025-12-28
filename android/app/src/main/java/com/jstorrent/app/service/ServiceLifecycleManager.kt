package com.jstorrent.app.service

import android.content.Context
import android.util.Log
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

private const val TAG = "ServiceLifecycleMgr"

/**
 * Decides when EngineService should run.
 *
 * Service runs when: active downloads/seeding AND user not in app
 * Service stops when: idle OR user in app
 *
 * This eliminates notification spam by only showing the foreground service
 * notification when there's actual background work happening.
 */
class ServiceLifecycleManager(
    private val context: Context,
    private val settingsStore: SettingsStore
) {

    private val _isActivityForeground = MutableStateFlow(false)
    val isActivityForeground: StateFlow<Boolean> = _isActivityForeground

    private var hasActiveWork = false
    private var serviceRunning = false

    /**
     * Called from Activity.onStart()
     */
    fun onActivityStart() {
        Log.d(TAG, "Activity started (foreground)")
        _isActivityForeground.value = true
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
        val shouldRun = hasActiveWork && !_isActivityForeground.value

        if (shouldRun && !serviceRunning) {
            Log.i(TAG, "Starting service: active work in background")
            EngineService.start(context)
            serviceRunning = true
        } else if (!shouldRun && serviceRunning) {
            val reason = when {
                !hasActiveWork -> "idle"
                _isActivityForeground.value -> "user in app"
                else -> "unknown"
            }
            Log.i(TAG, "Stopping service: $reason")
            EngineService.stop(context)
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
