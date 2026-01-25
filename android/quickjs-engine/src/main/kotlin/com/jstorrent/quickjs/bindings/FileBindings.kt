package com.jstorrent.quickjs.bindings

import android.content.Context
import android.net.Uri
import android.util.Log
import com.jstorrent.io.file.FileManager
import com.jstorrent.io.file.FileManagerException
import com.jstorrent.quickjs.QuickJsContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

private const val TAG = "FileBindings"

/**
 * File I/O bindings for QuickJS.
 *
 * Implements stateless file operations using [FileManager]:
 * - __jstorrent_file_read(rootKey, path, offset, length) -> ArrayBuffer
 * - __jstorrent_file_write(rootKey, path, offset, data) -> number
 * - __jstorrent_file_stat(rootKey, path) -> string | null
 * - __jstorrent_file_mkdir(rootKey, path) -> boolean
 * - __jstorrent_file_exists(rootKey, path) -> boolean
 * - __jstorrent_file_readdir(rootKey, path) -> string (JSON array)
 * - __jstorrent_file_delete(rootKey, path) -> boolean
 *
 * All operations are synchronous - they block the JS thread until complete.
 *
 * Root resolution:
 * - Empty or "default" rootKey resolves to app-private downloads directory
 * - Other rootKeys are resolved via [rootResolver] (for SAF URIs)
 */
class FileBindings(
    private val context: Context,
    private val fileManager: FileManager,
    private val rootResolver: (String) -> Uri?,
) {
    companion object {
        // Throughput and latency tracking for backpressure detection
        @Volatile private var bytesWritten = 0L
        @Volatile private var writeCount = 0
        @Volatile private var totalWriteTimeMs = 0L
        @Volatile private var maxWriteLatencyMs = 0L
        @Volatile private var lastLogTime = System.currentTimeMillis()
    }

    // App-private downloads directory (fallback when rootKey is empty/"default")
    private val appPrivateDownloads: File by lazy {
        File(context.filesDir, "downloads").also { it.mkdirs() }
    }

    /**
     * Register all file bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerReadWrite(ctx)
        registerPathFunctions(ctx)
    }

    /**
     * Resolve rootKey to a Uri.
     * - Empty or "default" -> app-private downloads directory
     * - Otherwise -> use rootResolver (for SAF URIs)
     */
    private fun resolveRoot(rootKey: String): Uri? {
        return when {
            rootKey.isEmpty() || rootKey == "default" ->
                Uri.fromFile(appPrivateDownloads)
            else -> rootResolver(rootKey)
        }
    }

    /**
     * Register stateless read/write functions.
     */
    private fun registerReadWrite(ctx: QuickJsContext) {
        // __jstorrent_file_read(rootKey: string, path: string, offset: number, length: number): ArrayBuffer
        ctx.setGlobalFunctionReturnsBinary("__jstorrent_file_read") { args, _ ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""
            val offset = args.getOrNull(2)?.toLongOrNull() ?: 0L
            val length = args.getOrNull(3)?.toIntOrNull() ?: 0

            if (path.isEmpty() || length <= 0) {
                return@setGlobalFunctionReturnsBinary ByteArray(0)
            }

            val rootUri = resolveRoot(rootKey)
            if (rootUri == null) {
                Log.w(TAG, "Unknown root key: $rootKey")
                return@setGlobalFunctionReturnsBinary ByteArray(0)
            }

            try {
                fileManager.read(rootUri, path, offset, length)
            } catch (e: FileManagerException) {
                Log.e(TAG, "Read failed: $path", e)
                ByteArray(0)
            } catch (e: Exception) {
                Log.e(TAG, "Read failed: $path", e)
                ByteArray(0)
            }
        }

        // __jstorrent_file_write(rootKey: string, path: string, offset: number, data: ArrayBuffer): number
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write", 3) { args, binary ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""
            val offset = args.getOrNull(2)?.toLongOrNull() ?: 0L

            if (path.isEmpty() || binary == null) {
                return@setGlobalFunctionWithBinary "-1"
            }

            val rootUri = resolveRoot(rootKey)
            if (rootUri == null) {
                Log.w(TAG, "Unknown root key: $rootKey")
                return@setGlobalFunctionWithBinary "-1"
            }

            try {
                val startTime = System.currentTimeMillis()
                fileManager.write(rootUri, path, offset, binary)
                val elapsed = System.currentTimeMillis() - startTime

                // Track stats
                bytesWritten += binary.size
                writeCount++
                totalWriteTimeMs += elapsed
                if (elapsed > maxWriteLatencyMs) {
                    maxWriteLatencyMs = elapsed
                }

                // Log every 5 seconds
                val now = System.currentTimeMillis()
                val sinceLastLog = now - lastLogTime
                if (sinceLastLog >= 5000) {
                    val mbWritten = bytesWritten / (1024.0 * 1024.0)
                    val mbps = mbWritten / (sinceLastLog / 1000.0)
                    val avgLatency = if (writeCount > 0) totalWriteTimeMs / writeCount else 0
                    Log.i(TAG, "Disk write: %.2f MB/s, %d writes, avg %dms, max %dms".format(
                        mbps, writeCount, avgLatency, maxWriteLatencyMs))
                    bytesWritten = 0
                    writeCount = 0
                    totalWriteTimeMs = 0
                    maxWriteLatencyMs = 0
                    lastLogTime = now
                }

                binary.size.toString()
            } catch (e: FileManagerException) {
                Log.e(TAG, "Write failed: $path", e)
                "-1"
            } catch (e: Exception) {
                Log.e(TAG, "Write failed: $path", e)
                "-1"
            }
        }
    }

    /**
     * Register functions that operate on paths.
     */
    private fun registerPathFunctions(ctx: QuickJsContext) {
        // __jstorrent_file_stat(rootKey: string, path: string): string | null
        ctx.setGlobalFunction("__jstorrent_file_stat") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            val rootUri = resolveRoot(rootKey) ?: return@setGlobalFunction null

            try {
                val stat = fileManager.stat(rootUri, path) ?: return@setGlobalFunction null
                JSONObject().apply {
                    put("size", stat.size)
                    put("mtime", stat.mtime)
                    put("isDirectory", stat.isDirectory)
                    put("isFile", stat.isFile)
                }.toString()
            } catch (e: Exception) {
                Log.e(TAG, "Stat failed: $path", e)
                null
            }
        }

        // __jstorrent_file_mkdir(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_mkdir") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            val rootUri = resolveRoot(rootKey) ?: return@setGlobalFunction "false"

            try {
                fileManager.mkdir(rootUri, path).toString()
            } catch (e: Exception) {
                Log.e(TAG, "Mkdir failed: $path", e)
                "false"
            }
        }

        // __jstorrent_file_exists(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_exists") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            val rootUri = resolveRoot(rootKey) ?: return@setGlobalFunction "false"

            try {
                fileManager.exists(rootUri, path).toString()
            } catch (e: Exception) {
                Log.e(TAG, "Exists failed: $path", e)
                "false"
            }
        }

        // __jstorrent_file_readdir(rootKey: string, path: string): string (JSON array)
        ctx.setGlobalFunction("__jstorrent_file_readdir") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            val rootUri = resolveRoot(rootKey) ?: return@setGlobalFunction "[]"

            try {
                val entries = fileManager.readdir(rootUri, path)
                JSONArray(entries).toString()
            } catch (e: Exception) {
                Log.e(TAG, "Readdir failed: $path", e)
                "[]"
            }
        }

        // __jstorrent_file_delete(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_delete") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            val rootUri = resolveRoot(rootKey) ?: return@setGlobalFunction "false"

            try {
                fileManager.delete(rootUri, path).toString()
            } catch (e: Exception) {
                Log.e(TAG, "Delete failed: $path", e)
                "false"
            }
        }
    }
}
