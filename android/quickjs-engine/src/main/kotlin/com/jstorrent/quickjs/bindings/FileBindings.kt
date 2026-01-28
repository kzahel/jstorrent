package com.jstorrent.quickjs.bindings

import android.content.Context
import android.net.Uri
import android.util.Log
import com.jstorrent.io.file.FileManager
import com.jstorrent.io.file.FileManagerException
import com.jstorrent.io.hash.Hasher
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Write result codes for async verified writes.
 */
object WriteResultCode {
    const val SUCCESS = 0
    const val HASH_MISMATCH = 1
    const val IO_ERROR = 2
    const val INVALID_ARGS = 3
}

/**
 * Phase 4: Event holding disk write result for batch delivery.
 */
data class DiskWriteResultEvent(
    val callbackId: String,
    val bytesWritten: Int,
    val resultCode: Int,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Parsed verified write request from batch.
 */
data class VerifiedWriteRequest(
    val rootKey: String,
    val path: String,
    val position: Long,
    val data: ByteArray,
    val expectedHashHex: String,
    val callbackId: String,
)

/**
 * Unpack a batch of verified write requests from binary format.
 *
 * Format (all multi-byte integers are little-endian):
 *   [count: u32 LE] then for each write:
 *     [rootKeyLen: u8] [rootKey: UTF-8 bytes]
 *     [pathLen: u16 LE] [path: UTF-8 bytes]
 *     [position: u64 LE]
 *     [dataLen: u32 LE] [data: bytes]
 *     [hashHex: 40 bytes] (fixed size - SHA1 hex is always 40 chars)
 *     [callbackIdLen: u8] [callbackId: UTF-8 bytes]
 *
 * @return List of parsed write requests
 * @throws IllegalArgumentException if format is invalid
 */
fun unpackVerifiedWriteBatch(packed: ByteArray): List<VerifiedWriteRequest> {
    val buffer = ByteBuffer.wrap(packed).order(ByteOrder.LITTLE_ENDIAN)

    val count = buffer.int
    if (count < 0 || count > 10000) {
        throw IllegalArgumentException("Invalid batch count: $count")
    }

    val writes = mutableListOf<VerifiedWriteRequest>()

    for (i in 0 until count) {
        // rootKeyLen + rootKey
        val rootKeyLen = buffer.get().toInt() and 0xFF
        val rootKeyBytes = ByteArray(rootKeyLen)
        buffer.get(rootKeyBytes)
        val rootKey = String(rootKeyBytes, Charsets.UTF_8)

        // pathLen + path
        val pathLen = buffer.short.toInt() and 0xFFFF
        val pathBytes = ByteArray(pathLen)
        buffer.get(pathBytes)
        val path = String(pathBytes, Charsets.UTF_8)

        // position (u64 LE) - read as two u32 and combine
        val positionLow = buffer.int.toLong() and 0xFFFFFFFFL
        val positionHigh = buffer.int.toLong() and 0xFFFFFFFFL
        val position = positionLow or (positionHigh shl 32)

        // dataLen + data
        val dataLen = buffer.int
        if (dataLen < 0) {
            throw IllegalArgumentException("Invalid data length: $dataLen")
        }
        val data = ByteArray(dataLen)
        buffer.get(data)

        // hashHex (fixed 40 bytes)
        val hashHexBytes = ByteArray(40)
        buffer.get(hashHexBytes)
        val hashHex = String(hashHexBytes, Charsets.UTF_8)

        // callbackIdLen + callbackId
        val callbackIdLen = buffer.get().toInt() and 0xFF
        val callbackIdBytes = ByteArray(callbackIdLen)
        buffer.get(callbackIdBytes)
        val callbackId = String(callbackIdBytes, Charsets.UTF_8)

        writes.add(VerifiedWriteRequest(rootKey, path, position, data, hashHex, callbackId))
    }

    return writes
}

/**
 * File I/O bindings for QuickJS.
 *
 * Implements stateless file operations using [FileManager]:
 * - __jstorrent_file_read(rootKey, path, offset, length) -> ArrayBuffer
 * - __jstorrent_file_write(rootKey, path, offset, data) -> number (sync)
 * - __jstorrent_file_write_verified(rootKey, path, offset, data, expectedSha1Hex, callbackId) -> void (async)
 * - __jstorrent_file_write_verified_batch(packed) -> void (async batched)
 * - __jstorrent_file_stat(rootKey, path) -> string | null
 * - __jstorrent_file_mkdir(rootKey, path) -> boolean
 * - __jstorrent_file_exists(rootKey, path) -> boolean
 * - __jstorrent_file_readdir(rootKey, path) -> string (JSON array)
 * - __jstorrent_file_delete(rootKey, path) -> boolean
 *
 * Sync operations block the JS thread. The async write_verified operation runs
 * hashing and I/O on a background thread, posting results back to JS via callback.
 * The batch version accepts multiple writes packed in binary format to reduce FFI overhead.
 *
 * Root resolution:
 * - Empty or "default" rootKey resolves to app-private downloads directory
 * - Other rootKeys are resolved via [rootResolver] (for SAF URIs)
 */
class FileBindings(
    private val context: Context,
    private val fileManager: FileManager,
    private val rootResolver: (String) -> Uri?,
    private val jsThread: JsThread? = null,
) {
    // Coroutine scope for async I/O operations (hash + write on background thread)
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    companion object {
        private const val TAG = "FileBindings"

        // Pending callback queue tracking (callbacks waiting to be processed by JS thread)
        private val pendingCallbacks = java.util.concurrent.atomic.AtomicInteger(0)
        @Volatile private var maxQueueDepth = 0
        @Volatile private var queueLogTime = System.currentTimeMillis()

        // Throughput and latency tracking for backpressure detection
        @Volatile private var bytesWritten = 0L
        @Volatile private var writeCount = 0
        @Volatile private var totalWriteTimeMs = 0L
        @Volatile private var maxWriteLatencyMs = 0L
        @Volatile private var lastLogTime = System.currentTimeMillis()

        // ============================================================
        // Phase 4: Batch disk write result crossing
        // ============================================================

        /**
         * Pending disk write results from I/O threads, waiting to be flushed to JS.
         * Thread-safe: I/O threads add, JS thread drains via flushDiskWriteResults().
         */
        private val pendingDiskResults = ConcurrentLinkedQueue<DiskWriteResultEvent>()

        /**
         * Metrics for batch processing.
         */
        @Volatile private var diskBatchFlushCount = 0
        @Volatile private var diskBatchEventsTotal = 0L
        @Volatile private var diskBatchLogTime = System.currentTimeMillis()

        /**
         * Get number of events pending in the disk write result queue.
         */
        fun getPendingDiskEventCount(): Int = pendingDiskResults.size

        /**
         * Queue a disk write result for batch processing.
         * Called from I/O threads, drained by flushDiskWriteResults on JS thread.
         */
        fun queueDiskWriteResult(callbackId: String, bytesWritten: Int, resultCode: Int) {
            pendingDiskResults.add(DiskWriteResultEvent(callbackId, bytesWritten, resultCode))
        }

        /**
         * Drain pending events and pack into binary format.
         * Format: [count: u32 LE] then for each:
         *   [callbackIdLen: u8] [callbackId: bytes] [bytesWritten: i32 LE] [resultCode: u8]
         * Returns null if queue is empty.
         */
        fun drainAndPackDiskBatch(): ByteArray? {
            val batch = mutableListOf<DiskWriteResultEvent>()
            while (true) {
                val event = pendingDiskResults.poll() ?: break
                batch.add(event)
            }

            if (batch.isEmpty()) return null

            // Update metrics
            diskBatchFlushCount++
            diskBatchEventsTotal += batch.size

            // Log batch stats periodically
            val now = System.currentTimeMillis()
            if (now - diskBatchLogTime >= 5000 && diskBatchFlushCount > 0) {
                val avgEvents = diskBatchEventsTotal.toFloat() / diskBatchFlushCount
                Log.i(TAG, "Disk batch: %d flushes, avg %.1f events/flush".format(
                    diskBatchFlushCount, avgEvents))
                diskBatchFlushCount = 0
                diskBatchEventsTotal = 0
                diskBatchLogTime = now
            }

            // Pack format: [count: u32 LE] then for each:
            // [callbackIdLen: u8] [callbackId: bytes] [bytesWritten: i32 LE] [resultCode: u8]
            val packedSize = 4 + batch.sumOf { event ->
                1 + event.callbackId.toByteArray(Charsets.UTF_8).size + 4 + 1
            }
            val buf = ByteBuffer.allocate(packedSize).order(ByteOrder.LITTLE_ENDIAN)
            buf.putInt(batch.size)
            for (event in batch) {
                val idBytes = event.callbackId.toByteArray(Charsets.UTF_8)
                buf.put(idBytes.size.toByte())
                buf.put(idBytes)
                buf.putInt(event.bytesWritten)
                buf.put(event.resultCode.toByte())
            }
            return buf.array()
        }

        /**
         * Get current callback queue depth.
         * This is the number of disk callbacks waiting to be processed by JS.
         */
        fun getQueueDepth(): Int = pendingCallbacks.get()

        /**
         * Get max queue depth since last reset (resets every 5 seconds during logging).
         */
        fun getMaxQueueDepth(): Int = maxQueueDepth

        /**
         * Track queue depth increment and log if needed.
         */
        private fun incrementQueue(): Int {
            val depth = pendingCallbacks.incrementAndGet()
            if (depth > maxQueueDepth) {
                maxQueueDepth = depth
            }
            if (depth > 20) {
                Log.w(TAG, "Disk callback queue depth: $depth (BACKPRESSURE)")
            }
            return depth
        }

        /**
         * Track queue depth decrement and periodic logging.
         */
        private fun decrementQueue() {
            pendingCallbacks.decrementAndGet()
            val now = System.currentTimeMillis()
            if (now - queueLogTime >= 5000 && maxQueueDepth > 0) {
                Log.i(TAG, "Disk callback queue: current=%d, max=%d".format(
                    pendingCallbacks.get(), maxQueueDepth))
                maxQueueDepth = 0
                queueLogTime = now
            }
        }
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
        registerAsyncWrite(ctx)
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

    /**
     * Register async verified write function.
     *
     * This moves hashing and I/O to a background thread, freeing the JS thread
     * to continue processing data callbacks. Results are posted back via callback.
     */
    private fun registerAsyncWrite(ctx: QuickJsContext) {
        // Register the JS dispatch function for write results
        ctx.evaluate("""
            globalThis.__jstorrent_file_write_callbacks = {};
            globalThis.__jstorrent_file_dispatch_write_result = function(callbackId, bytesWritten, resultCode) {
                const callback = globalThis.__jstorrent_file_write_callbacks[callbackId];
                if (callback) {
                    delete globalThis.__jstorrent_file_write_callbacks[callbackId];
                    callback(bytesWritten, resultCode);
                }
            };
        """.trimIndent(), "file-bindings-init.js")

        // __jstorrent_file_flush(): void
        // Phase 4: Flush accumulated disk write results from I/O threads to JS.
        // Called by JS at start of engine tick to batch all pending results
        // into a single FFI crossing.
        ctx.setGlobalFunction("__jstorrent_file_flush") { _ ->
            val packed = drainAndPackDiskBatch()
            if (packed != null) {
                // Dispatch batch to JS - single FFI call for all accumulated results
                ctx.callGlobalFunctionWithBinary(
                    "__jstorrent_file_dispatch_batch",
                    packed,
                    0,  // binary is first argument
                    null
                )
                // Note: We don't call scheduleJobPump here because flush is called
                // at the start of tick. The tick will pump jobs at the end.
            }
            null
        }

        // __jstorrent_file_write_verified(rootKey, path, offset, data, expectedSha1Hex, callbackId): void
        // Async verified write - hashes data, compares to expected, writes if match.
        // Posts result back to JS via __jstorrent_file_dispatch_write_result.
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write_verified", 3) { args, binary ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""
            val offset = args.getOrNull(2)?.toLongOrNull() ?: 0L
            // arg[3] is binary (data)
            val expectedSha1Hex = args.getOrNull(4) ?: ""
            val callbackId = args.getOrNull(5) ?: ""

            if (jsThread == null) {
                Log.e(TAG, "write_verified: jsThread not available")
                return@setGlobalFunctionWithBinary null
            }

            if (path.isEmpty() || binary == null || expectedSha1Hex.isEmpty() || callbackId.isEmpty()) {
                Log.w(TAG, "write_verified: invalid args")
                // Phase 4: Queue error for batch processing at tick boundary
                queueDiskWriteResult(callbackId, -1, WriteResultCode.INVALID_ARGS)
                return@setGlobalFunctionWithBinary null
            }

            val rootUri = resolveRoot(rootKey)
            if (rootUri == null) {
                Log.w(TAG, "write_verified: unknown root key: $rootKey")
                // Phase 4: Queue error for batch processing at tick boundary
                queueDiskWriteResult(callbackId, -1, WriteResultCode.INVALID_ARGS)
                return@setGlobalFunctionWithBinary null
            }

            // Launch async work on I/O dispatcher
            ioScope.launch {
                val startTime = System.currentTimeMillis()

                try {
                    // 1. Hash the data
                    val actualHash = Hasher.sha1(binary)
                    val actualHashHex = actualHash.joinToString("") { "%02x".format(it) }

                    // 2. Compare hashes
                    if (!actualHashHex.equals(expectedSha1Hex, ignoreCase = true)) {
                        Log.w(TAG, "write_verified: hash mismatch for $path")
                        // Phase 4: Queue error for batch processing at tick boundary
                        queueDiskWriteResult(callbackId, -1, WriteResultCode.HASH_MISMATCH)
                        return@launch
                    }

                    // 3. Write the data (hash matched)
                    fileManager.write(rootUri, path, offset, binary)
                    val elapsed = System.currentTimeMillis() - startTime

                    // Track stats
                    synchronized(Companion) {
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
                            Log.i(TAG, "Verified write: %.2f MB/s, %d writes, avg %dms, max %dms".format(
                                mbps, writeCount, avgLatency, maxWriteLatencyMs))
                            bytesWritten = 0
                            writeCount = 0
                            totalWriteTimeMs = 0
                            maxWriteLatencyMs = 0
                            lastLogTime = now
                        }
                    }

                    // 4. Phase 4: Queue success for batch processing at tick boundary
                    queueDiskWriteResult(callbackId, binary.size, WriteResultCode.SUCCESS)

                } catch (e: Exception) {
                    Log.e(TAG, "write_verified failed: $path", e)
                    // Phase 4: Queue error for batch processing at tick boundary
                    queueDiskWriteResult(callbackId, -1, WriteResultCode.IO_ERROR)
                }
            }

            null // Return immediately, result comes via callback
        }

        // __jstorrent_file_write_verified_batch(packed: ArrayBuffer): void
        // Batch verified write - unpacks multiple write requests, runs in parallel.
        // Results queue to pendingDiskResults for batch delivery via __jstorrent_file_flush.
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write_verified_batch", 0) { _, binary ->
            if (jsThread == null) {
                Log.e(TAG, "write_verified_batch: jsThread not available")
                return@setGlobalFunctionWithBinary null
            }

            if (binary == null || binary.isEmpty()) {
                Log.w(TAG, "write_verified_batch: empty batch")
                return@setGlobalFunctionWithBinary null
            }

            val writes = try {
                unpackVerifiedWriteBatch(binary)
            } catch (e: Exception) {
                Log.e(TAG, "write_verified_batch: failed to unpack", e)
                return@setGlobalFunctionWithBinary null
            }

            if (writes.isEmpty()) {
                return@setGlobalFunctionWithBinary null
            }

            Log.d(TAG, "write_verified_batch: processing ${writes.size} writes")

            // Launch all writes in parallel on I/O dispatcher
            for (write in writes) {
                val rootUri = resolveRoot(write.rootKey)
                if (rootUri == null) {
                    Log.w(TAG, "write_verified_batch: unknown root key: ${write.rootKey}")
                    queueDiskWriteResult(write.callbackId, -1, WriteResultCode.INVALID_ARGS)
                    continue
                }

                ioScope.launch {
                    val startTime = System.currentTimeMillis()

                    try {
                        // 1. Hash the data
                        val actualHash = Hasher.sha1(write.data)
                        val actualHashHex = actualHash.joinToString("") { "%02x".format(it) }

                        // 2. Compare hashes
                        if (!actualHashHex.equals(write.expectedHashHex, ignoreCase = true)) {
                            Log.w(TAG, "write_verified_batch: hash mismatch for ${write.path}")
                            queueDiskWriteResult(write.callbackId, -1, WriteResultCode.HASH_MISMATCH)
                            return@launch
                        }

                        // 3. Write the data (hash matched)
                        fileManager.write(rootUri, write.path, write.position, write.data)
                        val elapsed = System.currentTimeMillis() - startTime

                        // Track stats
                        synchronized(Companion) {
                            bytesWritten += write.data.size
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
                                Log.i(TAG, "Batch write: %.2f MB/s, %d writes, avg %dms, max %dms".format(
                                    mbps, writeCount, avgLatency, maxWriteLatencyMs))
                                bytesWritten = 0
                                writeCount = 0
                                totalWriteTimeMs = 0
                                maxWriteLatencyMs = 0
                                lastLogTime = now
                            }
                        }

                        // 4. Queue success for batch processing at tick boundary
                        queueDiskWriteResult(write.callbackId, write.data.size, WriteResultCode.SUCCESS)

                    } catch (e: Exception) {
                        Log.e(TAG, "write_verified_batch failed: ${write.path}", e)
                        queueDiskWriteResult(write.callbackId, -1, WriteResultCode.IO_ERROR)
                    }
                }
            }

            null
        }
    }
}
