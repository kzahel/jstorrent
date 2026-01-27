package com.jstorrent.quickjs.bindings

import android.util.Log
import com.jstorrent.io.socket.UdpSocketCallback
import com.jstorrent.io.socket.UdpSocketManager
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * UDP socket bindings for QuickJS.
 *
 * Implements the following native functions:
 * - __jstorrent_udp_bind(socketId, addr, port)
 * - __jstorrent_udp_send(socketId, addr, port, data)
 * - __jstorrent_udp_close(socketId)
 * - __jstorrent_udp_join_multicast(socketId, group)
 * - __jstorrent_udp_leave_multicast(socketId, group)
 * - __jstorrent_udp_on_bound(callback)
 * - __jstorrent_udp_on_message(callback)
 * - __jstorrent_udp_flush() - Phase 4 batch flush
 *
 * Threading model:
 * - JS calls to __jstorrent_udp_* happen on the JS thread
 * - UdpSocketCallback events come from I/O threads
 * - Events are queued and flushed to JS at tick boundary (Phase 4)
 */
class UdpBindings(
    private val jsThread: JsThread,
    private val udpManager: UdpSocketManager
) {
    companion object {
        private const val TAG = "UdpBindings"

        // ============================================================
        // Phase 4: Batch UDP data crossing
        // ============================================================

        /**
         * Event holding accumulated UDP message from I/O threads.
         * Stored in queue until flushed to JS at tick boundary.
         */
        data class UdpMessageEvent(
            val socketId: Int,
            val srcAddr: String,
            val srcPort: Int,
            val data: ByteArray,
            val timestamp: Long = System.currentTimeMillis()
        ) {
            override fun equals(other: Any?): Boolean {
                if (this === other) return true
                if (other !is UdpMessageEvent) return false
                return socketId == other.socketId && srcAddr == other.srcAddr &&
                    srcPort == other.srcPort && data.contentEquals(other.data) &&
                    timestamp == other.timestamp
            }
            override fun hashCode(): Int =
                31 * (31 * (31 * (31 * socketId + srcAddr.hashCode()) + srcPort) + data.contentHashCode()) + timestamp.hashCode()
        }

        /**
         * Pending UDP messages from I/O threads, waiting to be flushed to JS.
         * Thread-safe: I/O threads add, JS thread drains via flushUdpData().
         */
        private val pendingUdpMessages = ConcurrentLinkedQueue<UdpMessageEvent>()

        /**
         * Total bytes pending in the queue (for metrics/logging).
         */
        @Volatile private var pendingUdpBytes = 0L

        /**
         * Metrics for batch processing.
         */
        @Volatile private var batchFlushCount = 0
        @Volatile private var batchEventsTotal = 0L
        @Volatile private var batchBytesTotal = 0L
        @Volatile private var batchLogTime = System.currentTimeMillis()

        /**
         * Get number of events pending in the UDP batch queue.
         */
        fun getPendingUdpEventCount(): Int = pendingUdpMessages.size

        /**
         * Get bytes pending in the UDP batch queue.
         */
        fun getPendingUdpBytes(): Long = pendingUdpBytes

        /**
         * Queue a UDP message event for batch processing.
         * Called from I/O threads, drained by flushUdpData on JS thread.
         */
        fun queueUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
            pendingUdpMessages.add(UdpMessageEvent(socketId, srcAddr, srcPort, data))
            pendingUdpBytes += data.size
        }

        /**
         * Drain pending events and pack into binary format.
         * Format: [count: u32 LE] then for each:
         *   [socketId: u32 LE] [srcPort: u16 LE] [addrLen: u8] [addr: bytes] [dataLen: u32 LE] [data: bytes]
         * Returns null if queue is empty.
         */
        fun drainAndPackUdpBatch(): ByteArray? {
            val batch = mutableListOf<UdpMessageEvent>()
            var totalBytes = 0
            while (true) {
                val event = pendingUdpMessages.poll() ?: break
                batch.add(event)
                totalBytes += event.data.size
            }

            if (batch.isEmpty()) return null

            // Update metrics
            pendingUdpBytes = 0
            batchFlushCount++
            batchEventsTotal += batch.size
            batchBytesTotal += totalBytes

            // Log batch stats periodically
            val now = System.currentTimeMillis()
            if (now - batchLogTime >= 5000 && batchFlushCount > 0) {
                val avgEvents = batchEventsTotal.toFloat() / batchFlushCount
                val avgBytes = batchBytesTotal.toFloat() / batchFlushCount / 1024
                Log.i(TAG, "UDP batch: %d flushes, avg %.1f events/flush, avg %.1f KB/flush".format(
                    batchFlushCount, avgEvents, avgBytes))
                batchFlushCount = 0
                batchEventsTotal = 0
                batchBytesTotal = 0
                batchLogTime = now
            }

            // Pack format: [count: u32 LE] then for each:
            // [socketId: u32 LE] [srcPort: u16 LE] [addrLen: u8] [addr: bytes] [dataLen: u32 LE] [data: bytes]
            val packedSize = 4 + batch.sumOf { event ->
                4 + 2 + 1 + event.srcAddr.toByteArray(Charsets.UTF_8).size + 4 + event.data.size
            }
            val buf = ByteBuffer.allocate(packedSize).order(ByteOrder.LITTLE_ENDIAN)
            buf.putInt(batch.size)
            for (event in batch) {
                val addrBytes = event.srcAddr.toByteArray(Charsets.UTF_8)
                buf.putInt(event.socketId)
                buf.putShort(event.srcPort.toShort())
                buf.put(addrBytes.size.toByte())
                buf.put(addrBytes)
                buf.putInt(event.data.size)
                buf.put(event.data)
            }
            return buf.array()
        }
    }

    // Track whether JS has registered callbacks
    private var hasBoundCallback = false
    private var hasMessageCallback = false

    /**
     * Register all UDP bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerCommandFunctions(ctx)
        registerCallbackFunctions(ctx)
        setupNativeCallbacks(ctx)
    }

    private fun registerCommandFunctions(ctx: QuickJsContext) {
        // __jstorrent_udp_bind(socketId: number, addr: string, port: number): void
        // Note: addr is accepted but ignored on Android (we always bind to all interfaces)
        ctx.setGlobalFunction("__jstorrent_udp_bind") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            // args[1] is addr - ignored on Android
            val port = args.getOrNull(2)?.toIntOrNull() ?: 0

            if (socketId != null) {
                udpManager.bind(socketId, port)
            }
            null
        }

        // __jstorrent_udp_flush(): void
        // Phase 4: Flush accumulated UDP messages from I/O threads to JS.
        // Called by JS at start of engine tick to batch all pending data
        // into a single FFI crossing.
        ctx.setGlobalFunction("__jstorrent_udp_flush") { _ ->
            val packed = drainAndPackUdpBatch()
            if (packed != null) {
                // Dispatch batch to JS - single FFI call for all accumulated messages
                ctx.callGlobalFunctionWithBinary(
                    "__jstorrent_udp_dispatch_batch",
                    packed,
                    0,  // binary is first argument
                    null
                )
                // Note: We don't call scheduleJobPump here because flush is called
                // at the start of tick. The tick will pump jobs at the end.
            }
            null
        }

        // __jstorrent_udp_send(socketId: number, addr: string, port: number, data: ArrayBuffer): void
        ctx.setGlobalFunctionWithBinary("__jstorrent_udp_send", 3) { args, binary ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            val destAddr = args.getOrNull(1)
            val destPort = args.getOrNull(2)?.toIntOrNull()

            if (socketId != null && destAddr != null && destPort != null && binary != null) {
                udpManager.send(socketId, destAddr, destPort, binary)
            }
            null
        }

        // __jstorrent_udp_close(socketId: number): void
        ctx.setGlobalFunction("__jstorrent_udp_close") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            socketId?.let { udpManager.close(it) }
            null
        }

        // __jstorrent_udp_join_multicast(socketId: number, group: string): void
        ctx.setGlobalFunction("__jstorrent_udp_join_multicast") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            val group = args.getOrNull(1)

            if (socketId != null && group != null) {
                udpManager.joinMulticast(socketId, group)
            }
            null
        }

        // __jstorrent_udp_leave_multicast(socketId: number, group: string): void
        ctx.setGlobalFunction("__jstorrent_udp_leave_multicast") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            val group = args.getOrNull(1)

            if (socketId != null && group != null) {
                udpManager.leaveMulticast(socketId, group)
            }
            null
        }
    }

    private fun registerCallbackFunctions(ctx: QuickJsContext) {
        // __jstorrent_udp_on_bound(callback): void
        // The callback is stored on the JS side. We just track that it was registered.
        ctx.setGlobalFunction("__jstorrent_udp_on_bound") { _ ->
            hasBoundCallback = true
            null
        }

        // __jstorrent_udp_on_message(callback): void
        ctx.setGlobalFunction("__jstorrent_udp_on_message") { _ ->
            hasMessageCallback = true
            null
        }
    }

    private fun setupNativeCallbacks(ctx: QuickJsContext) {
        udpManager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, boundPort: Int, errorCode: Int) {
                Log.d(TAG, "onUdpBound: socket=$socketId, success=$success, port=$boundPort, errorCode=$errorCode")
                if (!hasBoundCallback) return

                jsThread.post {
                    // Call the JS dispatcher: __jstorrent_udp_dispatch_bound(socketId, success, port)
                    ctx.callGlobalFunction(
                        "__jstorrent_udp_dispatch_bound",
                        socketId.toString(),
                        success.toString(),
                        boundPort.toString()
                    )
                    // Schedule job processing for the NEXT message to avoid deadlock
                    jsThread.scheduleJobPump(ctx)
                }
            }

            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
                Log.d(TAG, "onUdpMessage: socket=$socketId, from=$srcAddr:$srcPort, bytes=${data.size}")
                if (!hasMessageCallback) return

                // Phase 4: Queue for batch processing at tick boundary
                // Just append to queue - no FFI crossing, no jsThread.post
                queueUdpMessage(socketId, srcAddr, srcPort, data)
            }

            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
                // UDP close is not exposed to JS - sockets just go away
                // Could add if needed in the future
            }
        })
    }
}
