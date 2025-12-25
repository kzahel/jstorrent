package com.jstorrent.app

import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
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

        // Launch picker immediately
        pickFolder.launch(null)
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

        // Notify EngineService (native standalone mode)
        EngineService.instance?.controller?.let { controller ->
            controller.addRoot(root.key, root.displayName, root.uri)
            // Set as default if this is the first root
            if (rootStore.listRoots().size == 1) {
                controller.setDefaultRoot(root.key)
            }
            Log.i(TAG, "Notified engine of new root: ${root.key}")
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
