package com.jstorrent.app.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.util.Log
import android.widget.Toast
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
     * Tries multiple approaches for compatibility across devices.
     */
    private fun openFolder(context: Context, folderUri: Uri) {
        Log.i(TAG, "Attempting to open folder: $folderUri")

        // Try approach 1: Use DocumentsUI with BROWSE_DOCUMENT_ROOT action (Android 11+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                // Build a document URI from the tree URI
                val documentId = DocumentsContract.getTreeDocumentId(folderUri)
                val documentUri = DocumentsContract.buildDocumentUriUsingTree(folderUri, documentId)

                val browseIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(documentUri, DocumentsContract.Document.MIME_TYPE_DIR)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                // Note: Don't use resolveActivity() - it returns null on Android 11+
                // due to package visibility. Just try to start and catch any exception.
                context.startActivity(browseIntent)
                Log.i(TAG, "Opened folder with DocumentsContract approach")
                return
            } catch (e: Exception) {
                Log.w(TAG, "DocumentsContract approach failed", e)
            }
        }

        // Try approach 2: Open Google Files app directly (common on Pixel)
        try {
            val filesIntent = Intent(Intent.ACTION_VIEW).apply {
                setPackage("com.google.android.apps.nbu.files")
                data = folderUri
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            // Note: Don't use resolveActivity() - it returns null on Android 11+
            // due to package visibility. Just try to start and catch any exception.
            context.startActivity(filesIntent)
            Log.i(TAG, "Opened folder with Google Files app")
            return
        } catch (e: Exception) {
            Log.w(TAG, "Google Files approach failed", e)
        }

        // Try approach 3: Generic file manager with chooser
        try {
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                data = folderUri
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(viewIntent, "Open folder with").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            context.startActivity(chooser)
            Log.i(TAG, "Opened folder with chooser")
            return
        } catch (e: Exception) {
            Log.w(TAG, "Chooser approach failed", e)
        }

        // All approaches failed - show toast
        Toast.makeText(context, "Could not open folder", Toast.LENGTH_SHORT).show()
        Log.w(TAG, "All approaches to open folder failed for: $folderUri")
    }
}
