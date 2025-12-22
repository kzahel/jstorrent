package com.jstorrent.io.file

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer

private const val TAG = "FileManagerImpl"

/**
 * SAF-based FileManager implementation with LRU caching.
 *
 * @param context Android context for SAF operations (ContentResolver access)
 * @param maxCacheSize Maximum number of DocumentFile references to cache (default: 200)
 */
class FileManagerImpl(
    private val context: Context,
    maxCacheSize: Int = 200
) : FileManager {

    /**
     * LRU cache for DocumentFile references to avoid repeated SAF traversals.
     * Key format: "$rootUri|$relativePath"
     */
    private val documentFileCache = object : LinkedHashMap<String, DocumentFile>(100, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, DocumentFile>?): Boolean {
            return size > maxCacheSize
        }
    }
    private val cacheLock = Any()

    override fun read(rootUri: Uri, relativePath: String, offset: Long, length: Int): ByteArray {
        val file = getCachedFile(rootUri, relativePath)
            ?: throw FileManagerException.FileNotFound(relativePath)

        try {
            context.contentResolver.openFileDescriptor(file.uri, "r")?.use { pfd ->
                val channel = FileInputStream(pfd.fileDescriptor).channel
                channel.position(offset)

                val buffer = ByteBuffer.allocate(length)
                var totalRead = 0
                while (buffer.hasRemaining()) {
                    val read = channel.read(buffer)
                    if (read == -1) break
                    totalRead += read
                }

                if (totalRead < length) {
                    throw FileManagerException.InsufficientData(relativePath, length, totalRead)
                }

                buffer.flip()
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                return bytes
            } ?: throw FileManagerException.CannotOpenFile(relativePath)
        } catch (e: FileManagerException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}", e)
            throw FileManagerException.ReadError(relativePath, e)
        }
    }

    override fun write(rootUri: Uri, relativePath: String, offset: Long, data: ByteArray) {
        try {
            // Try cache first for existing files
            var file = getCachedFile(rootUri, relativePath)

            if (file == null) {
                // Not in cache or doesn't exist - create it
                file = createFile(rootUri, relativePath)
                    ?: throw FileManagerException.CannotCreateFile(relativePath)
                // Cache the newly created file
                cacheFile(rootUri, relativePath, file)
            }

            // Use ParcelFileDescriptor for true random access writes
            context.contentResolver.openFileDescriptor(file.uri, "rw")?.use { pfd ->
                val channel = FileOutputStream(pfd.fileDescriptor).channel
                channel.position(offset)
                channel.write(ByteBuffer.wrap(data))
            } ?: throw FileManagerException.CannotOpenFile(relativePath)
        } catch (e: FileManagerException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file: ${e.message}", e)
            when {
                e.message?.contains("ENOSPC") == true ||
                        e.message?.contains("No space") == true -> {
                    throw FileManagerException.DiskFull(relativePath)
                }
                else -> {
                    throw FileManagerException.WriteError(relativePath, e)
                }
            }
        }
    }

    override fun exists(rootUri: Uri, relativePath: String): Boolean {
        return getCachedFile(rootUri, relativePath) != null
    }

    override fun getOrCreateFile(rootUri: Uri, relativePath: String): DocumentFile? {
        // Try cache first
        getCachedFile(rootUri, relativePath)?.let { return it }

        // Create if not found
        val file = createFile(rootUri, relativePath) ?: return null
        cacheFile(rootUri, relativePath, file)
        return file
    }

    override fun clearCache() {
        synchronized(cacheLock) {
            documentFileCache.clear()
        }
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    /**
     * Get a cached DocumentFile, or resolve and cache it if not in cache.
     * Returns null if file doesn't exist.
     */
    private fun getCachedFile(rootUri: Uri, relativePath: String): DocumentFile? {
        val cacheKey = "$rootUri|$relativePath"

        synchronized(cacheLock) {
            documentFileCache[cacheKey]?.let { cached ->
                // Verify it still exists
                if (cached.exists()) {
                    return cached
                } else {
                    documentFileCache.remove(cacheKey)
                }
            }
        }

        // Cache miss - do the traversal
        val file = resolveFile(rootUri, relativePath)
        if (file != null) {
            synchronized(cacheLock) {
                documentFileCache[cacheKey] = file
            }
        }
        return file
    }

    /**
     * Add a file to the cache.
     */
    private fun cacheFile(rootUri: Uri, relativePath: String, file: DocumentFile) {
        val cacheKey = "$rootUri|$relativePath"
        synchronized(cacheLock) {
            documentFileCache[cacheKey] = file
        }
    }

    /**
     * Resolve a relative path under a SAF tree URI to a DocumentFile.
     * Returns null if file doesn't exist.
     */
    private fun resolveFile(rootUri: Uri, relativePath: String): DocumentFile? {
        var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null

        val segments = relativePath.trimStart('/').split('/')
        for (segment in segments) {
            current = current.findFile(segment) ?: return null
        }

        return if (current.isFile) current else null
    }

    /**
     * Create a file at the given path under a SAF tree.
     * Creates parent directories as needed.
     */
    private fun createFile(rootUri: Uri, relativePath: String): DocumentFile? {
        var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null

        val segments = relativePath.trimStart('/').split('/')
        val fileName = segments.lastOrNull() ?: return null
        val dirSegments = segments.dropLast(1)

        // Create/navigate directories
        for (segment in dirSegments) {
            val existing = current.findFile(segment)
            current = if (existing != null && existing.isDirectory) {
                existing
            } else {
                current.createDirectory(segment) ?: return null
            }
        }

        // Get or create file
        val existingFile = current.findFile(fileName)
        return if (existingFile != null && existingFile.isFile) {
            existingFile
        } else {
            // Guess MIME type from extension
            val mimeType = guessMimeType(fileName)
            current.createFile(mimeType, fileName)
        }
    }

    /**
     * Guess MIME type from file extension.
     */
    private fun guessMimeType(fileName: String): String {
        return when {
            fileName.endsWith(".mp4") -> "video/mp4"
            fileName.endsWith(".mkv") -> "video/x-matroska"
            fileName.endsWith(".avi") -> "video/x-msvideo"
            fileName.endsWith(".mp3") -> "audio/mpeg"
            fileName.endsWith(".flac") -> "audio/flac"
            fileName.endsWith(".zip") -> "application/zip"
            fileName.endsWith(".rar") -> "application/x-rar-compressed"
            fileName.endsWith(".torrent") -> "application/x-bittorrent"
            else -> "application/octet-stream"
        }
    }
}
