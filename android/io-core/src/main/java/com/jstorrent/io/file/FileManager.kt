package com.jstorrent.io.file

import android.net.Uri
import androidx.documentfile.provider.DocumentFile

/**
 * File statistics returned by [FileManager.stat].
 */
data class FileStat(
    val size: Long,
    val mtime: Long,
    val isDirectory: Boolean,
    val isFile: Boolean,
)

/**
 * Manages file read/write operations using Android's Storage Access Framework (SAF).
 *
 * This interface abstracts file I/O operations, allowing different implementations
 * for HTTP/WebSocket server (companion mode) and JSI bindings (standalone mode).
 *
 * All paths are relative to a SAF tree root URI. The implementation handles:
 * - DocumentFile traversal and caching
 * - Creating parent directories as needed
 * - Random-access read/write via ParcelFileDescriptor
 *
 * Thread safety: Implementations must be thread-safe.
 */
interface FileManager {
    /**
     * Read bytes from a file at the specified offset.
     *
     * @param rootUri SAF tree URI for the download root
     * @param relativePath Path relative to root (e.g., "Movies/film.mp4")
     * @param offset Byte offset to start reading from
     * @param length Number of bytes to read
     * @return Byte array containing exactly [length] bytes
     * @throws FileManagerException.FileNotFound if file doesn't exist
     * @throws FileManagerException.CannotOpenFile if file can't be opened for reading
     * @throws FileManagerException.InsufficientData if fewer than [length] bytes available
     * @throws FileManagerException.ReadError on I/O error
     */
    fun read(rootUri: Uri, relativePath: String, offset: Long, length: Int): ByteArray

    /**
     * Write bytes to a file at the specified offset.
     *
     * Creates the file and parent directories if they don't exist.
     *
     * @param rootUri SAF tree URI for the download root
     * @param relativePath Path relative to root (e.g., "Movies/film.mp4")
     * @param offset Byte offset to start writing at
     * @param data Bytes to write
     * @throws FileManagerException.CannotCreateFile if file/directories can't be created
     * @throws FileManagerException.CannotOpenFile if file can't be opened for writing
     * @throws FileManagerException.DiskFull if storage is full
     * @throws FileManagerException.WriteError on I/O error
     */
    fun write(rootUri: Uri, relativePath: String, offset: Long, data: ByteArray)

    /**
     * Check if a file exists at the given path.
     *
     * @param rootUri SAF tree URI for the download root
     * @param relativePath Path relative to root
     * @return true if file exists, false otherwise
     */
    fun exists(rootUri: Uri, relativePath: String): Boolean

    /**
     * Get or create a DocumentFile at the given path.
     *
     * Creates parent directories as needed. Useful when the caller needs
     * direct access to the DocumentFile (e.g., for URI access).
     *
     * @param rootUri SAF tree URI for the download root
     * @param relativePath Path relative to root
     * @return DocumentFile for the file, or null if creation failed
     */
    fun getOrCreateFile(rootUri: Uri, relativePath: String): DocumentFile?

    /**
     * Clear the internal DocumentFile cache.
     *
     * Call this if you know files have been modified externally or
     * if you want to free memory.
     */
    fun clearCache()

    /**
     * Get file or directory statistics.
     *
     * @param rootUri SAF tree URI for the root
     * @param relativePath Path relative to root (empty string for root itself)
     * @return File statistics, or null if path doesn't exist
     */
    fun stat(rootUri: Uri, relativePath: String): FileStat?

    /**
     * Create a directory at the given path.
     *
     * Creates parent directories as needed.
     *
     * @param rootUri SAF tree URI for the root
     * @param relativePath Path relative to root
     * @return true if directory was created or already exists, false on failure
     */
    fun mkdir(rootUri: Uri, relativePath: String): Boolean

    /**
     * List contents of a directory.
     *
     * @param rootUri SAF tree URI for the root
     * @param relativePath Path relative to root (empty string for root itself)
     * @return List of filenames (not full paths), or empty list if path doesn't exist or isn't a directory
     */
    fun readdir(rootUri: Uri, relativePath: String): List<String>

    /**
     * Delete a file or directory.
     *
     * For directories, deletes recursively.
     *
     * @param rootUri SAF tree URI for the root
     * @param relativePath Path relative to root
     * @return true if deleted successfully, false if doesn't exist or deletion failed
     */
    fun delete(rootUri: Uri, relativePath: String): Boolean
}
