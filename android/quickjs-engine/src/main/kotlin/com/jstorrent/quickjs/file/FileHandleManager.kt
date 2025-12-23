package com.jstorrent.quickjs.file

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "FileHandleManager"

/**
 * Manages file handle operations for QuickJS file bindings.
 *
 * Phase 3c implementation uses app-private storage (context.filesDir/downloads/).
 * The rootKey parameter is accepted but ignored - all paths resolve relative
 * to the base directory. SAF support can be added later.
 *
 * @param context Android context for accessing app-private storage
 */
class FileHandleManager(private val context: Context) {

    // Base directory for all file operations
    private val baseDir: File by lazy {
        File(context.filesDir, "downloads").also { it.mkdirs() }
    }

    // Maps handleId to open RandomAccessFile
    private val handles = ConcurrentHashMap<Int, OpenHandle>()

    /**
     * Internal class to track open file state.
     */
    private data class OpenHandle(
        val file: File,
        val raf: RandomAccessFile,
        val mode: String
    )

    /**
     * Open a file for reading or writing.
     *
     * @param handleId Unique identifier for this file handle
     * @param rootKey Storage root identifier (ignored in Phase 3c)
     * @param path Relative path to the file
     * @param mode Open mode: "r" (read), "w" (write), "r+" (read+write)
     * @return true on success, false on failure
     */
    fun open(handleId: Int, rootKey: String, path: String, mode: String): Boolean {
        return try {
            val file = resolvePath(path)

            // Create parent directories if writing
            if (mode != "r") {
                file.parentFile?.mkdirs()
            }

            // Check if file exists for read-only mode
            if (mode == "r" && !file.exists()) {
                Log.w(TAG, "File not found for read: $path")
                return false
            }

            // Map mode to RandomAccessFile mode
            val rafMode = when (mode) {
                "r" -> "r"
                "w", "r+" -> "rw"
                else -> "rw"
            }

            // Create file if it doesn't exist and we're writing
            if (!file.exists() && mode != "r") {
                file.createNewFile()
            }

            val raf = RandomAccessFile(file, rafMode)

            // For write mode, truncate the file
            if (mode == "w") {
                raf.setLength(0)
            }

            handles[handleId] = OpenHandle(file, raf, mode)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open file: $path", e)
            false
        }
    }

    /**
     * Read data from an open file.
     *
     * @param handleId File handle ID
     * @param offset Offset into the read buffer (unused, kept for API compat)
     * @param length Number of bytes to read
     * @param position Position in file to read from
     * @return Byte array with read data, or null on error
     */
    fun read(handleId: Int, offset: Long, length: Int, position: Long): ByteArray? {
        val handle = handles[handleId] ?: run {
            Log.w(TAG, "Invalid handle for read: $handleId")
            return null
        }

        return try {
            handle.raf.seek(position)
            val buffer = ByteArray(length)
            val bytesRead = handle.raf.read(buffer)

            when {
                bytesRead == -1 -> ByteArray(0)  // EOF
                bytesRead < length -> buffer.copyOf(bytesRead)
                else -> buffer
            }
        } catch (e: Exception) {
            Log.e(TAG, "Read failed for handle $handleId", e)
            null
        }
    }

    /**
     * Write data to an open file.
     *
     * @param handleId File handle ID
     * @param data Data to write
     * @param position Position in file to write at
     * @return Number of bytes written, or -1 on error
     */
    fun write(handleId: Int, data: ByteArray, position: Long): Int {
        val handle = handles[handleId] ?: run {
            Log.w(TAG, "Invalid handle for write: $handleId")
            return -1
        }

        return try {
            handle.raf.seek(position)
            handle.raf.write(data)
            data.size
        } catch (e: Exception) {
            Log.e(TAG, "Write failed for handle $handleId", e)
            -1
        }
    }

    /**
     * Truncate a file to the specified length.
     *
     * @param handleId File handle ID
     * @param len New file length
     * @return true on success
     */
    fun truncate(handleId: Int, len: Long): Boolean {
        val handle = handles[handleId] ?: return false

        return try {
            handle.raf.setLength(len)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Truncate failed for handle $handleId", e)
            false
        }
    }

    /**
     * Flush file changes to storage.
     *
     * @param handleId File handle ID
     */
    fun sync(handleId: Int) {
        val handle = handles[handleId] ?: return

        try {
            handle.raf.fd.sync()
        } catch (e: Exception) {
            Log.e(TAG, "Sync failed for handle $handleId", e)
        }
    }

    /**
     * Close a file handle.
     *
     * @param handleId File handle ID
     */
    fun close(handleId: Int) {
        handles.remove(handleId)?.let { handle ->
            try {
                handle.raf.close()
            } catch (e: Exception) {
                Log.e(TAG, "Close failed for handle $handleId", e)
            }
        }
    }

    /**
     * Get file statistics.
     *
     * @param rootKey Storage root identifier (ignored)
     * @param path Relative path
     * @return JSON string with { size, mtime, isDirectory, isFile } or null if not found
     */
    fun stat(rootKey: String, path: String): String? {
        val file = resolvePath(path)

        if (!file.exists()) {
            return null
        }

        return try {
            JSONObject().apply {
                put("size", file.length())
                put("mtime", file.lastModified())
                put("isDirectory", file.isDirectory)
                put("isFile", file.isFile)
            }.toString()
        } catch (e: Exception) {
            Log.e(TAG, "Stat failed for path: $path", e)
            null
        }
    }

    /**
     * Create a directory.
     *
     * @param rootKey Storage root identifier (ignored)
     * @param path Relative path
     * @return true if directory exists or was created
     */
    fun mkdir(rootKey: String, path: String): Boolean {
        val dir = resolvePath(path)
        return dir.exists() || dir.mkdirs()
    }

    /**
     * Check if a path exists.
     *
     * @param rootKey Storage root identifier (ignored)
     * @param path Relative path
     * @return true if path exists
     */
    fun exists(rootKey: String, path: String): Boolean {
        return resolvePath(path).exists()
    }

    /**
     * Read directory contents.
     *
     * @param rootKey Storage root identifier (ignored)
     * @param path Relative path
     * @return JSON array of filenames
     */
    fun readdir(rootKey: String, path: String): String {
        val dir = resolvePath(path)
        val files = dir.listFiles() ?: emptyArray()

        return JSONArray().apply {
            files.forEach { put(it.name) }
        }.toString()
    }

    /**
     * Delete a file or directory.
     *
     * @param rootKey Storage root identifier (ignored)
     * @param path Relative path
     * @return true on success
     */
    fun delete(rootKey: String, path: String): Boolean {
        val file = resolvePath(path)

        return try {
            if (file.isDirectory) {
                file.deleteRecursively()
            } else {
                file.delete()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Delete failed for path: $path", e)
            false
        }
    }

    /**
     * Close all open handles (for cleanup).
     */
    fun closeAll() {
        handles.keys.toList().forEach { close(it) }
    }

    /**
     * Resolve a relative path to an absolute file.
     * Sanitizes path to prevent directory traversal.
     */
    private fun resolvePath(path: String): File {
        // Sanitize path - remove leading slashes and prevent directory traversal
        val sanitized = path
            .removePrefix("/")
            .replace("..", "")  // Simple protection against traversal
            .replace("//", "/")

        return File(baseDir, sanitized)
    }
}
