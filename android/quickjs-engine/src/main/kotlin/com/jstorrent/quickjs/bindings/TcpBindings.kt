package com.jstorrent.quickjs.bindings

import android.util.Log
import com.jstorrent.io.socket.TcpSocketCallback
import com.jstorrent.io.socket.TcpSocketManager
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext

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

        // Throughput tracking
        @Volatile private var bytesReceived = 0L
        @Volatile private var lastLogTime = System.currentTimeMillis()
        @Volatile private var maxQueueDepth = 0

        /**
         * Get current callback queue depth.
         * This is the number of TCP data callbacks waiting to be processed by JS.
         */
        fun getQueueDepth(): Int = pendingCallbacks.get()

        /**
         * Get max queue depth since last reset (resets every 5 seconds during logging).
         */
        fun getMaxQueueDepth(): Int = maxQueueDepth
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

        // __jstorrent_tcp_close(socketId: number): void
        ctx.setGlobalFunction("__jstorrent_tcp_close") { args ->
            val socketId = args.getOrNull(0)?.toIntOrNull()
            socketId?.let { tcpManager.close(it) }
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

                // Track throughput before posting to JS (this is raw network speed)
                bytesReceived += data.size
                val now = System.currentTimeMillis()
                val elapsed = now - lastLogTime
                if (elapsed >= 5000) {
                    val mbps = (bytesReceived / (elapsed / 1000.0)) / (1024 * 1024)
                    Log.i(TAG, "TCP recv: %.2f MB/s (raw), queue depth: %d (max: %d)".format(
                        mbps, pendingCallbacks.get(), maxQueueDepth))
                    bytesReceived = 0
                    maxQueueDepth = 0
                    lastLogTime = now
                }

                // Track queue depth for backpressure detection
                val queueDepth = pendingCallbacks.incrementAndGet()
                if (queueDepth > maxQueueDepth) {
                    maxQueueDepth = queueDepth
                }
                if (queueDepth > 50) {
                    Log.w(TAG, "JS callback queue depth: $queueDepth (BACKPRESSURE)")
                }

                jsThread.post {
                    pendingCallbacks.decrementAndGet()
                    ctx.callGlobalFunctionWithBinary(
                        "__jstorrent_tcp_dispatch_data",
                        data,
                        1,
                        socketId.toString(),
                        null
                    )
                    jsThread.scheduleJobPump(ctx)
                }
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
