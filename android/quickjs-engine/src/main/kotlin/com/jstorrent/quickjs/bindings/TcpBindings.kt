package com.jstorrent.quickjs.bindings

import android.util.Log
import com.jstorrent.io.socket.TcpSocketCallback
import com.jstorrent.io.socket.TcpSocketManager
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * TCP socket bindings for QuickJS.
 *
 * Implements the following native functions:
 * - __jstorrent_tcp_connect(socketId, host, port)
 * - __jstorrent_tcp_send(socketId, data)
 * - __jstorrent_tcp_close(socketId)
 * - __jstorrent_tcp_on_data(callback)
 * - __jstorrent_tcp_on_close(callback)
 * - __jstorrent_tcp_on_error(callback)
 * - __jstorrent_tcp_on_connected(callback)
 *
 * Threading model:
 * - JS calls to __jstorrent_tcp_* happen on the JS thread
 * - TcpSocketCallback events come from I/O threads
 * - Events are posted back to JS thread before invoking JS callbacks
 */
class TcpBindings(
    private val jsThread: JsThread,
    private val tcpManager: TcpSocketManager
) {
    companion object {
        private const val TAG = "TcpBindings"

        // Backpressure tracking - shared across instances
        private val pendingCallbacks = java.util.concurrent.atomic.AtomicInteger(0)

        // ============================================================
        // Phase 3: Batch TCP data crossing
        // ============================================================

        /**
         * Event holding accumulated TCP data from I/O threads.
         * Stored in queue until flushed to JS at tick boundary.
         */
        data class TcpDataEvent(
            val socketId: Int,
            val data: ByteArray,
            val timestamp: Long = System.currentTimeMillis()
        ) {
            override fun equals(other: Any?): Boolean {
                if (this === other) return true
                if (other !is TcpDataEvent) return false
                return socketId == other.socketId && data.contentEquals(other.data) && timestamp == other.timestamp
            }
            override fun hashCode(): Int = 31 * (31 * socketId + data.contentHashCode()) + timestamp.hashCode()
        }

        /**
         * Pending TCP data from I/O threads, waiting to be flushed to JS.
         * Thread-safe: I/O threads add, JS thread drains via flushTcpData().
         */
        private val pendingTcpData = ConcurrentLinkedQueue<TcpDataEvent>()

        /**
         * Total bytes pending in the queue (for metrics/logging).
         */
        @Volatile private var pendingTcpBytes = 0L

        /**
         * Metrics for batch processing.
         */
        @Volatile private var batchFlushCount = 0
        @Volatile private var batchEventsTotal = 0L
        @Volatile private var batchBytesTotal = 0L
        @Volatile private var batchLogTime = System.currentTimeMillis()

        // Throughput tracking
        @Volatile private var bytesReceived = 0L
        @Volatile private var lastLogTime = System.currentTimeMillis()
        @Volatile private var maxQueueDepth = 0

        // Callback latency tracking
        @Volatile private var callbackLatencyCount = 0
        @Volatile private var callbackLatencyTotalMs = 0L
        @Volatile private var callbackLatencyMaxMs = 0L
        @Volatile private var callbackLatencyLogTime = System.currentTimeMillis()

        /**
         * Get current callback queue depth.
         * This is the number of TCP data callbacks waiting to be processed by JS.
         */
        fun getQueueDepth(): Int = pendingCallbacks.get()

        /**
         * Get max queue depth since last reset (resets every 5 seconds during logging).
         */
        fun getMaxQueueDepth(): Int = maxQueueDepth

        /**
         * Record callback latency and log stats periodically.
         */
        fun recordCallbackLatency(latencyMs: Long) {
            callbackLatencyCount++
            callbackLatencyTotalMs += latencyMs
            if (latencyMs > callbackLatencyMaxMs) {
                callbackLatencyMaxMs = latencyMs
            }

            val now = System.currentTimeMillis()
            if (now - callbackLatencyLogTime >= 5000 && callbackLatencyCount > 0) {
                val avgMs = callbackLatencyTotalMs.toFloat() / callbackLatencyCount
                Log.i(TAG, "Callback latency: %d calls, avg %.1fms, max %dms".format(
                    callbackLatencyCount, avgMs, callbackLatencyMaxMs))
                callbackLatencyCount = 0
                callbackLatencyTotalMs = 0
                callbackLatencyMaxMs = 0
                callbackLatencyLogTime = now
            }
        }

        /**
         * Get number of events pending in the TCP batch queue.
         */
        fun getPendingTcpEventCount(): Int = pendingTcpData.size

        /**
         * Get bytes pending in the TCP batch queue.
         */
        fun getPendingTcpBytes(): Long = pendingTcpBytes

        /**
         * Queue a TCP data event for batch processing.
         * Called from I/O threads, drained by flushTcpData on JS thread.
         */
        fun queueTcpData(socketId: Int, data: ByteArray) {
            pendingTcpData.add(TcpDataEvent(socketId, data))
            pendingTcpBytes += data.size
        }

        /**
         * Drain pending events and pack into binary format.
         * Format: [count: u32 LE] then for each: [socketId: u32 LE] [len: u32 LE] [data: len bytes]
         * Returns null if queue is empty.
         */
        fun drainAndPackTcpBatch(): ByteArray? {
            val batch = mutableListOf<TcpDataEvent>()
            var totalBytes = 0
            while (true) {
                val event = pendingTcpData.poll() ?: break
                batch.add(event)
                totalBytes += event.data.size
            }

            if (batch.isEmpty()) return null

            // Update metrics
            pendingTcpBytes = 0
            batchFlushCount++
            batchEventsTotal += batch.size
            batchBytesTotal += totalBytes

            // Log batch stats periodically
            val now = System.currentTimeMillis()
            if (now - batchLogTime >= 5000 && batchFlushCount > 0) {
                val avgEvents = batchEventsTotal.toFloat() / batchFlushCount
                val avgBytes = batchBytesTotal.toFloat() / batchFlushCount / 1024
                Log.i(TAG, "TCP batch: %d flushes, avg %.1f events/flush, avg %.1f KB/flush".format(
                    batchFlushCount, avgEvents, avgBytes))
                batchFlushCount = 0
                batchEventsTotal = 0
                batchBytesTotal = 0
                batchLogTime = now
            }

            // Pack format: [count: u32 LE] [socketId: u32 LE, len: u32 LE, data: bytes]...
            val packedSize = 4 + batch.sumOf { 8 + it.data.size }
            val buf = ByteBuffer.allocate(packedSize).order(ByteOrder.LITTLE_ENDIAN)
            buf.putInt(batch.size)
            for (event in batch) {
                buf.putInt(event.socketId)
                buf.putInt(event.data.size)
                buf.put(event.data)
            }
            return buf.array()
        }
    }

    // JS callback names - stored when JS registers callbacks
    private var hasDataCallback = false
    private var hasCloseCallback = false
    private var hasErrorCallback = false
    private var hasConnectedCallback = false
    private var hasSecuredCallback = false

    /**
     * Register all TCP bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerCommandFunctions(ctx)
        registerCallbackFunctions(ctx)
        setupNativeCallbacks(ctx)
    }

    private fun registerCommandFunctions(ctx: QuickJsContext) {
        // __jstorrent_tcp_connect(socketId: number, host: string, port: number): void
        ctx.setGlobalFunction("__jstorrent_tcp_connect") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            val host = args.getOrNull(1)
            val port = args.getOrNull(2)?.toIntOrNull()

            if (socketId != null && host != null && port != null) {
                tcpManager.connect(socketId, host, port)
            }
            null
        }

        // __jstorrent_tcp_send(socketId: number, data: ArrayBuffer): void
        ctx.setGlobalFunctionWithBinary("__jstorrent_tcp_send", 1) { args, binary ->
            val socketId = args.getOrNull(0)?.toIntOrNull()

            if (socketId != null && binary != null) {
                tcpManager.send(socketId, binary)
            }
            null
        }

        // __jstorrent_tcp_send_batch(packed: ArrayBuffer): void
        // Packed format: [count: u32 LE] then for each: [socketId: u32 LE] [len: u32 LE] [data: len bytes]
        // This reduces FFI overhead by sending to multiple sockets in one call.
        ctx.setGlobalFunctionWithBinary("__jstorrent_tcp_send_batch", 0) { _, binary ->
            if (binary != null && binary.size >= 4) {
                val buf = java.nio.ByteBuffer.wrap(binary).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                val count = buf.int

                repeat(count) {
                    if (buf.remaining() >= 8) {
                        val socketId = buf.int
                        val len = buf.int
                        if (buf.remaining() >= len) {
                            val data = ByteArray(len)
                            buf.get(data)
                            tcpManager.send(socketId, data)
                        }
                    }
                }
            }
            null
        }

        // __jstorrent_tcp_close(socketId: number): void
        ctx.setGlobalFunction("__jstorrent_tcp_close") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            socketId?.let { tcpManager.close(it) }
            null
        }

        // __jstorrent_tcp_set_backpressure(active: boolean): void
        // Pause/resume reads on all TCP connections for backpressure control.
        // When active=true, Kotlin pauses reads to prevent unbounded buffer growth.
        ctx.setGlobalFunction("__jstorrent_tcp_set_backpressure") { args ->
            val active = args.getOrNull(0)?.toBooleanStrictOrNull() ?: false
            if (active) {
                Log.i(TAG, "Backpressure: pausing all TCP reads")
                tcpManager.pauseAllReads()
            } else {
                Log.i(TAG, "Backpressure: resuming all TCP reads")
                tcpManager.resumeAllReads()
            }
            null
        }

        // __jstorrent_tcp_secure(socketId: number, hostname: string): void
        ctx.setGlobalFunction("__jstorrent_tcp_secure") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            val hostname = args.getOrNull(1) ?: ""

            if (socketId != null) {
                // skipValidation = false for proper certificate validation
                tcpManager.secure(socketId, hostname, skipValidation = false)
            }
            null
        }

        // __jstorrent_tcp_flush(): void
        // Phase 3: Flush accumulated TCP data from I/O threads to JS.
        // Called by JS at start of engine tick to batch all pending data
        // into a single FFI crossing.
        ctx.setGlobalFunction("__jstorrent_tcp_flush") { _ ->
            val packed = drainAndPackTcpBatch()
            if (packed != null) {
                // Dispatch batch to JS - single FFI call for all accumulated data
                ctx.callGlobalFunctionWithBinary(
                    "__jstorrent_tcp_dispatch_batch",
                    packed,
                    0,  // binary is first argument
                    null
                )
                // Note: We don't call scheduleJobPump here because flush is called
                // at the start of tick. The tick will pump jobs at the end.
            }
            null
        }
    }

    private fun registerCallbackFunctions(ctx: QuickJsContext) {
        // __jstorrent_tcp_on_data(callback): void
        // The callback is stored on the JS side. We just track that it was registered.
        ctx.setGlobalFunction("__jstorrent_tcp_on_data") { _ ->
            hasDataCallback = true
            null
        }

        // __jstorrent_tcp_on_close(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_close") { _ ->
            hasCloseCallback = true
            null
        }

        // __jstorrent_tcp_on_error(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_error") { _ ->
            hasErrorCallback = true
            null
        }

        // __jstorrent_tcp_on_connected(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_connected") { _ ->
            hasConnectedCallback = true
            null
        }

        // __jstorrent_tcp_on_secured(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_secured") { _ ->
            hasSecuredCallback = true
            null
        }
    }

    private fun setupNativeCallbacks(ctx: QuickJsContext) {
        tcpManager.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
                if (!hasConnectedCallback) return

                jsThread.post {
                    val errorMessage = if (!success) "Connection failed (code: $errorCode)" else ""
                    ctx.callGlobalFunction(
                        "__jstorrent_tcp_dispatch_connected",
                        socketId.toString(),
                        success.toString(),
                        errorMessage
                    )
                    // Schedule batched job processing to avoid blocking the Handler.
                    // This allows other callbacks to be interleaved with job processing.
                    jsThread.scheduleJobPump(ctx)
                }
            }

            override fun onTcpData(socketId: Int, data: ByteArray) {
                if (!hasDataCallback) return

                // Track raw throughput (before queuing)
                bytesReceived += data.size
                val now = System.currentTimeMillis()
                val elapsed = now - lastLogTime
                if (elapsed >= 5000) {
                    val mbps = (bytesReceived / (elapsed / 1000.0)) / (1024 * 1024)
                    val pendingEvents = getPendingTcpEventCount()
                    val pendingKb = getPendingTcpBytes() / 1024.0
                    Log.i(TAG, "TCP recv: %.2f MB/s (raw), pending: %d events (%.1f KB)".format(
                        mbps, pendingEvents, pendingKb))
                    bytesReceived = 0
                    lastLogTime = now
                }

                // Phase 3: Queue for batch processing at tick boundary
                // Just append to queue - no FFI crossing, no jsThread.post
                queueTcpData(socketId, data)
            }

            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
                Log.d(TAG, "onTcpClose: socket=$socketId, hadError=$hadError, errorCode=$errorCode")
                // Send error callback first if there was an error
                if (hadError && hasErrorCallback) {
                    jsThread.post {
                        ctx.callGlobalFunction(
                            "__jstorrent_tcp_dispatch_error",
                            socketId.toString(),
                            "Socket error (code: $errorCode)"
                        )
                        jsThread.scheduleJobPump(ctx)
                    }
                }

                if (hasCloseCallback) {
                    jsThread.post {
                        ctx.callGlobalFunction(
                            "__jstorrent_tcp_dispatch_close",
                            socketId.toString(),
                            hadError.toString()
                        )
                        jsThread.scheduleJobPump(ctx)
                    }
                }
            }

            override fun onTcpSecured(socketId: Int, success: Boolean) {
                Log.d(TAG, "onTcpSecured: socket=$socketId, success=$success")
                if (!hasSecuredCallback) return

                jsThread.post {
                    ctx.callGlobalFunction(
                        "__jstorrent_tcp_dispatch_secured",
                        socketId.toString(),
                        success.toString()
                    )
                    jsThread.scheduleJobPump(ctx)
                }
            }
        })
    }
}
