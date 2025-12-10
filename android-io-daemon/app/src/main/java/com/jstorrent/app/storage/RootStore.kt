package com.jstorrent.app.storage

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Persists SAF download roots to internal storage.
 *
 * Storage format: JSON file at /data/data/com.jstorrent.app/files/roots.json
 *
 * Thread safety: All public methods are synchronized. For UI responsiveness,
 * call from a background thread.
 */
class RootStore(private val context: Context) {

    @Serializable
    private data class RootConfig(
        val salt: String,
        val roots: List<DownloadRoot>
    )

    private val configFile: File
        get() = File(context.filesDir, CONFIG_FILE_NAME)

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
    }

    private var config: RootConfig

    init {
        config = loadOrCreate()
    }

    /**
     * Get all configured roots.
     */
    @Synchronized
    fun listRoots(): List<DownloadRoot> = config.roots.toList()

    /**
     * Add a new root from a SAF tree URI.
     * Returns the new root, or existing root if URI already registered.
     */
    @Synchronized
    fun addRoot(treeUri: Uri): DownloadRoot {
        // Check if already exists
        val existing = config.roots.find { it.uri == treeUri.toString() }
        if (existing != null) {
            return existing
        }

        val key = generateKey(treeUri)
        val label = extractLabel(treeUri)
        val removable = isRemovableStorage(treeUri)

        val root = DownloadRoot(
            key = key,
            uri = treeUri.toString(),
            displayName = label,
            removable = removable,
            lastStatOk = true,
            lastChecked = System.currentTimeMillis()
        )

        config = config.copy(roots = config.roots + root)
        save()

        return root
    }

    /**
     * Remove a root by key.
     * Returns true if root was found and removed.
     */
    @Synchronized
    fun removeRoot(key: String): Boolean {
        val newRoots = config.roots.filter { it.key != key }
        if (newRoots.size == config.roots.size) {
            return false
        }
        config = config.copy(roots = newRoots)
        save()
        return true
    }

    /**
     * Resolve a root key to its SAF URI.
     * Returns null if key not found.
     */
    @Synchronized
    fun resolveKey(key: String): Uri? {
        val root = config.roots.find { it.key == key }
        return root?.let { Uri.parse(it.uri) }
    }

    /**
     * Reload configuration from disk.
     * Call this to pick up changes made by other components (e.g., AddRootActivity).
     */
    @Synchronized
    fun reload() {
        config = loadOrCreate()
    }

    /**
     * Check availability of all roots and update lastStatOk.
     * Call periodically or before returning roots to extension.
     */
    @Synchronized
    fun refreshAvailability(): List<DownloadRoot> {
        // Reload from disk first to pick up any changes from other components
        config = loadOrCreate()

        val updated = config.roots.map { root ->
            val available = checkAvailability(Uri.parse(root.uri))
            root.copy(
                lastStatOk = available,
                lastChecked = System.currentTimeMillis()
            )
        }
        config = config.copy(roots = updated)
        save()
        return updated
    }

    /**
     * Get a root by key with current availability.
     */
    @Synchronized
    fun getRoot(key: String): DownloadRoot? {
        return config.roots.find { it.key == key }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private fun loadOrCreate(): RootConfig {
        if (!configFile.exists()) {
            return RootConfig(
                salt = generateSalt(),
                roots = emptyList()
            )
        }

        return try {
            json.decodeFromString<RootConfig>(configFile.readText())
        } catch (e: Exception) {
            // Corrupted file, start fresh but log warning
            android.util.Log.w(TAG, "Failed to load roots config, starting fresh", e)
            RootConfig(salt = generateSalt(), roots = emptyList())
        }
    }

    private fun save() {
        configFile.writeText(json.encodeToString(config))
    }

    private fun generateSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun generateKey(uri: Uri): String {
        val input = config.salt + uri.toString()
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        // Return first 16 hex chars (64 bits) - enough for uniqueness
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }

    /**
     * Extract a human-readable label from SAF URI.
     * Example: content://...documents/tree/primary%3ADownload%2FJSTorrent
     *       -> "Download/JSTorrent"
     */
    private fun extractLabel(uri: Uri): String {
        // Try to get display name from DocumentFile
        try {
            val docFile = DocumentFile.fromTreeUri(context, uri)
            docFile?.name?.let { return it }
        } catch (_: Exception) {
        }

        // Fallback: parse from URI path
        val path = uri.lastPathSegment ?: return "Downloads"

        // URI-decode and extract path after the colon
        // e.g., "primary:Download/JSTorrent" -> "Download/JSTorrent"
        val decoded = Uri.decode(path)
        val colonIndex = decoded.indexOf(':')
        return if (colonIndex >= 0) {
            decoded.substring(colonIndex + 1)
        } else {
            decoded
        }
    }

    /**
     * Check if URI points to removable storage.
     */
    private fun isRemovableStorage(uri: Uri): Boolean {
        val path = uri.toString()
        // Primary storage is not removable
        if (path.contains("primary")) return false
        // SD cards and USB drives have different volume IDs
        return path.contains("/tree/") && !path.contains("primary")
    }

    /**
     * Check if a root is currently accessible.
     */
    private fun checkAvailability(uri: Uri): Boolean {
        return try {
            val docFile = DocumentFile.fromTreeUri(context, uri)
            docFile?.exists() == true && docFile.canWrite()
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val TAG = "RootStore"
        private const val CONFIG_FILE_NAME = "roots.json"
    }
}
