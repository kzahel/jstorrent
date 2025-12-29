package com.jstorrent.app.notification

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat

private const val TAG = "OpenFolderActivity"

/**
 * Trampoline activity to open a folder and dismiss the notification.
 *
 * This is needed because:
 * 1. Notification action buttons don't auto-cancel the notification
 * 2. Starting activities from BroadcastReceivers is blocked by BAL restrictions
 *
 * This activity is transparent and finishes immediately after launching the file manager.
 */
class OpenFolderActivity : Activity() {

    companion object {
        const val EXTRA_FOLDER_URI = "folder_uri"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val folderUriString = intent.getStringExtra(EXTRA_FOLDER_URI)
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)

        Log.i(TAG, "Opening folder: $folderUriString, notificationId: $notificationId")

        // Cancel the notification
        if (notificationId != -1) {
            NotificationManagerCompat.from(this).cancel(notificationId)
        }

        // Open the folder
        if (folderUriString != null) {
            openFolder(Uri.parse(folderUriString))
        }

        // Finish immediately - this activity has no UI
        finish()
    }

    private fun openFolder(folderUri: Uri) {
        // Try approach 1: DocumentsContract (Android 11+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val documentId = DocumentsContract.getTreeDocumentId(folderUri)
                val documentUri = DocumentsContract.buildDocumentUriUsingTree(folderUri, documentId)

                val browseIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(documentUri, DocumentsContract.Document.MIME_TYPE_DIR)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                startActivity(browseIntent)
                Log.i(TAG, "Opened folder with DocumentsContract approach")
                return
            } catch (e: Exception) {
                Log.w(TAG, "DocumentsContract approach failed", e)
            }
        }

        // Try approach 2: Google Files app (common on Pixel)
        try {
            val filesIntent = Intent(Intent.ACTION_VIEW).apply {
                setPackage("com.google.android.apps.nbu.files")
                data = folderUri
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            startActivity(filesIntent)
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

            startActivity(chooser)
            Log.i(TAG, "Opened folder with chooser")
            return
        } catch (e: Exception) {
            Log.w(TAG, "Chooser approach failed", e)
        }

        // All approaches failed
        Toast.makeText(this, "Could not open folder", Toast.LENGTH_SHORT).show()
        Log.w(TAG, "All approaches to open folder failed for: $folderUri")
    }
}
