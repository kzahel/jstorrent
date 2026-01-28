package com.jstorrent.io.file

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

private const val TAG = "FileManagerImpl"

/**
 * Pooled file handle using FileChannel for lock-free positioned I/O.
 * FileChannel.write(buffer, position) and read(buffer, position) are atomic
 * positioned operations that don't use seek, enabling true concurrent access
 * to different positions without locking.
 */
private class PooledFileHandle(
    val path: String,
    val raf: RandomAccessFile,
    @Volatile var lastAccessTime: Long = System.currentTimeMillis()
) {
    val channel = raf.channel

    /**
     * Write data at the given position without seeking.
     * Uses FileChannel.write(buffer, position) which is atomic and thread-safe
     * for writes to different positions.
     */
    fun writeAt(offset: Long, data: ByteArray) {
        lastAccessTime = System.currentTimeMillis()
        val buffer = ByteBuffer.wrap(data)
        var written = 0
        while (buffer.hasRemaining()) {
            written += channel.write(buffer, offset + written)
        }
    }

    /**
     * Read data from the given position without seeking.
     * Uses FileChannel.read(buffer, position) which is atomic and thread-safe.
     */
    fun readAt(offset: Long, length: Int): ByteArray {
        lastAccessTime = System.currentTimeMillis()
        val buffer = ByteBuffer.allocate(length)
        var totalRead = 0
        while (buffer.hasRemaining()) {
            val read = channel.read(buffer, offset + totalRead)
            if (read == -1) break
            totalRead += read
        }
        if (totalRead < length) {
            throw IllegalStateException("Could not read $length bytes, only got $totalRead")
        }
        buffer.flip()
        return buffer.array()
    }

    fun close() {
        try {
            channel.close()
            raf.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing file handle: $path", e)
        }
    }
}

/**
 * SAF-based FileManager implementation with LRU caching.
 * Also supports file:// URIs using standard Java File I/O.
 *
 * @param context Android context for SAF operations (ContentResolver access)
 * @param maxCacheSize Maximum number of DocumentFile references to cache (default: 200)
 */
class FileManagerImpl(
    private val context: Context,
    maxCacheSize: Int = 200,
    private val maxFileHandles: Int = 32,
    private val handleIdleTimeoutMs: Long = 30_000L
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

    /**
     * Pool of open file handles for native file:// writes.
     * Key: absolute file path
     */
    private val fileHandlePool = LinkedHashMap<String, PooledFileHandle>(maxFileHandles, 0.75f, true)
    private val fileHandleLock = ReentrantLock()
    @Volatile private var lastEvictionCheck = System.currentTimeMillis()

    /**
     * Check if URI is a file:// scheme that should use native File I/O.
     */
    private fun isFileUri(uri: Uri): Boolean = uri.scheme == "file"

    /**
     * Convert file:// URI to File object.
     */
    private fun uriToFile(uri: Uri): File? = uri.path?.let { File(it) }

    override fun read(rootUri: Uri, relativePath: String, offset: Long, length: Int): ByteArray {
        // Handle file:// URIs with native File I/O
        if (isFileUri(rootUri)) {
            return readNative(rootUri, relativePath, offset, length)
        }

        val file = getCachedFile(rootUri, relativePath)
            ?: throw FileManagerException.FileNotFound(relativePath)

        try {
            context.contentResolver.openFileDescriptor(file.uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).use { fis ->
                    val channel = fis.channel
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
                }
            } ?: throw FileManagerException.CannotOpenFile(relativePath)
        } catch (e: FileManagerException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}", e)
            throw FileManagerException.ReadError(relativePath, e)
        }
    }

    override fun write(rootUri: Uri, relativePath: String, offset: Long, data: ByteArray) {
        // Handle file:// URIs with native File I/O
        if (isFileUri(rootUri)) {
            return writeNative(rootUri, relativePath, offset, data)
        }

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
                FileOutputStream(pfd.fileDescriptor).use { fos ->
                    val channel = fos.channel
                    channel.position(offset)
                    channel.write(ByteBuffer.wrap(data))
                }
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
        if (isFileUri(rootUri)) {
            return existsNative(rootUri, relativePath)
        }
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

    override fun stat(rootUri: Uri, relativePath: String): FileStat? {
        if (isFileUri(rootUri)) {
            return statNative(rootUri, relativePath)
        }
        val doc = resolvePath(rootUri, relativePath) ?: return null
        return FileStat(
            size = doc.length(),
            mtime = doc.lastModified(),
            isDirectory = doc.isDirectory,
            isFile = doc.isFile,
        )
    }

    override fun mkdir(rootUri: Uri, relativePath: String): Boolean {
        if (isFileUri(rootUri)) {
            return mkdirNative(rootUri, relativePath)
        }
        if (relativePath.isEmpty() || relativePath == "/") {
            // Root already exists
            return true
        }

        var current = DocumentFile.fromTreeUri(context, rootUri) ?: return false

        val segments = relativePath.trimStart('/').split('/').filter { it.isNotEmpty() }
        for (segment in segments) {
            val existing = current.findFile(segment)
            current = when {
                existing?.isDirectory == true -> existing
                existing != null -> return false // File exists, not a directory
                else -> current.createDirectory(segment) ?: return false
            }
        }
        return true
    }

    override fun readdir(rootUri: Uri, relativePath: String): List<String> {
        if (isFileUri(rootUri)) {
            return readdirNative(rootUri, relativePath)
        }
        val doc = resolvePath(rootUri, relativePath) ?: return emptyList()
        if (!doc.isDirectory) return emptyList()
        return doc.listFiles().mapNotNull { it.name }
    }

    override fun delete(rootUri: Uri, relativePath: String): Boolean {
        if (isFileUri(rootUri)) {
            return deleteNative(rootUri, relativePath)
        }
        val doc = resolvePath(rootUri, relativePath) ?: return false
        val deleted = doc.delete()
        if (deleted) {
            // Invalidate cache entries for this path and descendants
            val cachePrefix = "$rootUri|$relativePath"
            synchronized(cacheLock) {
                documentFileCache.keys.removeAll { it.startsWith(cachePrefix) }
            }
        }
        return deleted
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
     * Resolve a relative path under a SAF tree URI to a DocumentFile (file only).
     * Returns null if path doesn't exist or is not a file.
     */
    private fun resolveFile(rootUri: Uri, relativePath: String): DocumentFile? {
        val doc = resolvePath(rootUri, relativePath) ?: return null
        return if (doc.isFile) doc else null
    }

    /**
     * Resolve a relative path under a SAF tree URI to a DocumentFile (file or directory).
     * Returns null if path doesn't exist.
     */
    private fun resolvePath(rootUri: Uri, relativePath: String): DocumentFile? {
        var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null

        if (relativePath.isEmpty() || relativePath == "/") {
            return current
        }

        val segments = relativePath.trimStart('/').split('/').filter { it.isNotEmpty() }
        for (segment in segments) {
            current = current.findFile(segment) ?: return null
        }

        return current
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

    // =========================================================================
    // Native File I/O helpers (for file:// URIs)
    // =========================================================================

    /**
     * Resolve a file:// URI + relative path to a File object.
     */
    private fun resolveNativeFile(rootUri: Uri, relativePath: String): File {
        val root = uriToFile(rootUri) ?: throw FileManagerException.CannotOpenFile(relativePath)
        return if (relativePath.isEmpty() || relativePath == "/") {
            root
        } else {
            File(root, relativePath.trimStart('/'))
        }
    }

    /**
     * Get or create a pooled file handle for the given file.
     * Creates parent directories and file if needed.
     */
    private fun getPooledHandle(file: File, createIfMissing: Boolean): PooledFileHandle {
        val path = file.absolutePath

        fileHandleLock.withLock {
            // Check if already in pool
            fileHandlePool[path]?.let { return it }

            // Evict idle handles if pool is full
            maybeEvictHandles()

            // Create parent directories if needed
            if (createIfMissing) {
                file.parentFile?.mkdirs()
            }

            // Open new handle
            val raf = RandomAccessFile(file, "rw")
            val handle = PooledFileHandle(path, raf)
            fileHandlePool[path] = handle
            return handle
        }
    }

    /**
     * Pre-allocate file to avoid per-write block allocation overhead.
     * This is a no-op if the file is already at least the requested size.
     */
    fun preallocate(rootUri: Uri, relativePath: String, size: Long) {
        if (!isFileUri(rootUri)) {
            // SAF doesn't support pre-allocation
            return
        }
        val file = resolveNativeFile(rootUri, relativePath)
        try {
            file.parentFile?.mkdirs()
            val handle = getPooledHandle(file, createIfMissing = true)
            if (file.length() < size) {
                handle.raf.setLength(size)
                Log.d(TAG, "Pre-allocated ${size / (1024 * 1024)}MB for ${file.name}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Pre-allocation failed for $relativePath: ${e.message}")
        }
    }

    /**
     * Evict handles that haven't been used recently or if pool is too large.
     */
    private fun maybeEvictHandles() {
        val now = System.currentTimeMillis()

        // Only check every second
        if (now - lastEvictionCheck < 1000) return
        lastEvictionCheck = now

        val toEvict = mutableListOf<String>()

        for ((path, handle) in fileHandlePool) {
            // Evict if idle too long
            if (now - handle.lastAccessTime > handleIdleTimeoutMs) {
                toEvict.add(path)
            }
        }

        // Also evict oldest if over capacity
        while (fileHandlePool.size - toEvict.size >= maxFileHandles) {
            val oldest = fileHandlePool.entries.firstOrNull { it.key !in toEvict }
            if (oldest != null) {
                toEvict.add(oldest.key)
            } else {
                break
            }
        }

        for (path in toEvict) {
            fileHandlePool.remove(path)?.close()
        }

        if (toEvict.isNotEmpty()) {
            Log.d(TAG, "Evicted ${toEvict.size} file handles, pool size: ${fileHandlePool.size}")
        }
    }

    /**
     * Close all pooled file handles.
     */
    fun closeAllHandles() {
        fileHandleLock.withLock {
            for ((_, handle) in fileHandlePool) {
                handle.close()
            }
            fileHandlePool.clear()
            Log.d(TAG, "Closed all file handles")
        }
    }

    private fun readNative(rootUri: Uri, relativePath: String, offset: Long, length: Int): ByteArray {
        val file = resolveNativeFile(rootUri, relativePath)
        if (!file.exists()) {
            throw FileManagerException.FileNotFound(relativePath)
        }
        try {
            // Use pooled handle for reads too
            val handle = getPooledHandle(file, createIfMissing = false)
            return handle.readAt(offset, length)
        } catch (e: FileManagerException) {
            throw e
        } catch (e: IllegalStateException) {
            throw FileManagerException.InsufficientData(relativePath, length, 0)
        } catch (e: Exception) {
            Log.e(TAG, "Native read failed: ${e.message}", e)
            throw FileManagerException.ReadError(relativePath, e)
        }
    }

    private fun writeNative(rootUri: Uri, relativePath: String, offset: Long, data: ByteArray) {
        val file = resolveNativeFile(rootUri, relativePath)
        try {
            val handle = getPooledHandle(file, createIfMissing = true)
            handle.writeAt(offset, data)
        } catch (e: Exception) {
            Log.e(TAG, "Native write failed: ${e.message}", e)
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

    private fun existsNative(rootUri: Uri, relativePath: String): Boolean {
        return resolveNativeFile(rootUri, relativePath).exists()
    }

    private fun statNative(rootUri: Uri, relativePath: String): FileStat? {
        val file = resolveNativeFile(rootUri, relativePath)
        if (!file.exists()) return null
        return FileStat(
            size = file.length(),
            mtime = file.lastModified(),
            isDirectory = file.isDirectory,
            isFile = file.isFile,
        )
    }

    private fun mkdirNative(rootUri: Uri, relativePath: String): Boolean {
        if (relativePath.isEmpty() || relativePath == "/") {
            return true
        }
        val dir = resolveNativeFile(rootUri, relativePath)
        return dir.exists() || dir.mkdirs()
    }

    private fun readdirNative(rootUri: Uri, relativePath: String): List<String> {
        val dir = resolveNativeFile(rootUri, relativePath)
        if (!dir.isDirectory) return emptyList()
        return dir.listFiles()?.mapNotNull { it.name } ?: emptyList()
    }

    private fun deleteNative(rootUri: Uri, relativePath: String): Boolean {
        val file = resolveNativeFile(rootUri, relativePath)
        if (!file.exists()) return false
        return if (file.isDirectory) {
            file.deleteRecursively()
        } else {
            file.delete()
        }
    }
}
