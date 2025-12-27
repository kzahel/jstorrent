package com.jstorrent.app.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
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
 * - OPEN_FOLDER: Open file manager at download folder
 */
class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_PAUSE_ALL = "com.jstorrent.app.action.PAUSE_ALL"
        const val ACTION_RESUME_ALL = "com.jstorrent.app.action.RESUME_ALL"
        const val ACTION_QUIT = "com.jstorrent.app.action.QUIT"
        const val ACTION_OPEN_FOLDER = "com.jstorrent.app.action.OPEN_FOLDER"

        const val EXTRA_FOLDER_URI = "folder_uri"
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
            ACTION_OPEN_FOLDER -> {
                val uriString = intent.getStringExtra(EXTRA_FOLDER_URI)
                Log.i(TAG, "Opening folder: $uriString")
                if (uriString != null) {
                    openFolder(context, Uri.parse(uriString))
                }
            }
        }
    }

    /**
     * Open the file manager at the specified folder URI.
     */
    private fun openFolder(context: Context, folderUri: Uri) {
        try {
            // Try to open with document UI (preferred for SAF URIs)
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(folderUri, "resource/folder")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            // Check if any app can handle this intent
            if (viewIntent.resolveActivity(context.packageManager) != null) {
                context.startActivity(viewIntent)
                return
            }

            // Fallback: try with vnd.android.document/directory mime type
            val documentIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(folderUri, "vnd.android.document/directory")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            if (documentIntent.resolveActivity(context.packageManager) != null) {
                context.startActivity(documentIntent)
                return
            }

            // Last fallback: open without specific mime type
            val genericIntent = Intent(Intent.ACTION_VIEW, folderUri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(genericIntent)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to open folder: $folderUri", e)
        }
    }
}
