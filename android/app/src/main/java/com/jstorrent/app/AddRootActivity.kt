package com.jstorrent.app

import android.app.NotificationManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import com.jstorrent.app.service.EngineService
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.storage.RootStore

/**
 * Translucent activity that immediately launches SAF folder picker.
 * Triggered via intent: jstorrent://add-root
 *
 * Flow:
 * 1. Extension opens jstorrent://add-root intent
 * 2. This activity launches, immediately opens SAF picker
 * 3. User picks folder
 * 4. We validate it's local storage (not cloud)
 * 5. We persist permission, add to RootStore, finish
 * 6. Extension polls /roots until new root appears
 */
class AddRootActivity : AppCompatActivity() {

    private lateinit var rootStore: RootStore

    private val pickFolder = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri != null) {
            handleFolderSelected(uri)
        } else {
            Log.i(TAG, "Folder picker cancelled")
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        rootStore = RootStore(this)

        // Cancel the folder picker notification (in case we were launched via full-screen intent)
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.cancel(FOLDER_PICKER_NOTIFICATION_ID)

        // Create JSTorrent folder in Downloads
        val folderCreated = createJSTorrentFolder()

        // Launch picker at Download/JSTorrent if created, otherwise Downloads
        val initialUri = if (folderCreated) {
            DocumentsContract.buildDocumentUri(
                "com.android.externalstorage.documents",
                "primary:Download/JSTorrent"
            )
        } else {
            DocumentsContract.buildDocumentUri(
                "com.android.externalstorage.documents",
                "primary:Download"
            )
        }
        pickFolder.launch(initialUri)
    }

    /**
     * Create the JSTorrent folder in Downloads.
     * Uses different methods depending on Android version:
     * - Android 9 and below: Direct file system access
     * - Android 10+: MediaStore API (create a temp file to force folder creation)
     */
    private fun createJSTorrentFolder(): Boolean {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val jstorrentDir = File(downloadsDir, "JSTorrent")

        // Check if folder already exists
        if (jstorrentDir.exists()) {
            Log.i(TAG, "JSTorrent folder already exists")
            return true
        }

        // Try direct file system access first (works on Android 9 and below)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val created = jstorrentDir.mkdirs()
            Log.i(TAG, "Created JSTorrent folder via File API: $created")
            return created
        }

        // Android 10+: Use MediaStore to create a temp file, which creates the folder
        return try {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, ".jstorrent_init")
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/JSTorrent")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            if (uri != null) {
                // File created, now delete it (folder remains)
                contentResolver.delete(uri, null, null)
                Log.i(TAG, "Created JSTorrent folder via MediaStore")
                true
            } else {
                Log.w(TAG, "Failed to create temp file via MediaStore")
                false
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to create JSTorrent folder via MediaStore: ${e.message}")
            false
        }
    }

    private fun handleFolderSelected(uri: Uri) {
        Log.i(TAG, "Folder selected: $uri")

        // Validate this is local storage, not a cloud provider
        // Cloud providers don't support random access writes which we require
        if (!isLocalStorageProvider(uri)) {
            Log.w(TAG, "Rejected non-local provider: ${uri.authority}")
            Toast.makeText(
                this,
                "Cloud storage is not supported. Please select a local folder.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        // Take persistable permission
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION

        try {
            contentResolver.takePersistableUriPermission(uri, flags)
            Log.i(TAG, "Persisted URI permission")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to persist permission", e)
            Toast.makeText(this, "Failed to get folder permission", Toast.LENGTH_SHORT).show()
            return
        }

        // Add to RootStore
        val root = rootStore.addRoot(uri)
        Log.i(TAG, "Added root: key=${root.key}, label=${root.displayName}")

        // Notify EngineService (native standalone mode) - async to avoid blocking Main
        EngineService.instance?.controller?.let { controller ->
            val isFirstRoot = rootStore.listRoots().size == 1
            lifecycleScope.launch(Dispatchers.IO) {
                controller.addRootAsync(root.key, root.displayName, root.uri)
                // Set as default if this is the first root
                if (isFirstRoot) {
                    controller.setDefaultRootAsync(root.key)
                }
                Log.i(TAG, "Notified engine of new root: ${root.key}")
            }
        }

        // Notify connected clients about new root (companion mode)
        IoDaemonService.instance?.broadcastRootsChanged()

        Toast.makeText(
            this,
            "Download folder added: ${root.displayName}",
            Toast.LENGTH_SHORT
        ).show()
    }

    /**
     * Check if the URI is from a local storage provider that supports random access.
     *
     * We explicitly allow:
     * - com.android.externalstorage.documents (internal + SD card + USB)
     * - com.android.providers.downloads.documents (Downloads folder)
     *
     * We reject cloud providers like:
     * - com.google.android.apps.docs.storage (Google Drive)
     * - com.dropbox.android.document (Dropbox)
     * - com.microsoft.skydrive.content.StorageAccessProvider (OneDrive)
     * - com.box.android.documents (Box)
     *
     * Random access (seek + write) doesn't work reliably on cloud-backed SAF providers.
     */
    private fun isLocalStorageProvider(uri: Uri): Boolean {
        val authority = uri.authority ?: return false

        return authority in ALLOWED_PROVIDERS
    }

    companion object {
        private const val TAG = "AddRootActivity"
        const val FOLDER_PICKER_NOTIFICATION_ID = 2

        private val ALLOWED_PROVIDERS = setOf(
            "com.android.externalstorage.documents", // Internal storage, SD cards, USB drives
            "com.android.providers.downloads.documents", // Downloads folder
            // Note: MTP devices show up under externalstorage.documents
        )
    }
}
