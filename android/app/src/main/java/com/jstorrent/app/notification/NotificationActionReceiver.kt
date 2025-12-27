package com.jstorrent.app.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.jstorrent.app.service.EngineService

private const val TAG = "NotificationActionReceiver"

/**
 * Handles notification action button clicks.
 *
 * Actions:
 * - PAUSE_ALL: Pause all active torrents
 * - RESUME_ALL: Resume all stopped torrents
 * - QUIT: Stop the engine service and exit
 */
class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_PAUSE_ALL = "com.jstorrent.app.action.PAUSE_ALL"
        const val ACTION_RESUME_ALL = "com.jstorrent.app.action.RESUME_ALL"
        const val ACTION_QUIT = "com.jstorrent.app.action.QUIT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "Received action: ${intent.action}")

        when (intent.action) {
            ACTION_PAUSE_ALL -> {
                Log.i(TAG, "Pausing all torrents")
                EngineService.instance?.pauseAllTorrents()
            }
            ACTION_RESUME_ALL -> {
                Log.i(TAG, "Resuming all torrents")
                EngineService.instance?.resumeAllTorrents()
            }
            ACTION_QUIT -> {
                Log.i(TAG, "Stopping service")
                EngineService.stop(context)
            }
        }
    }
}
