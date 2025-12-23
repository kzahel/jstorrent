package com.jstorrent.quickjs.bindings

import com.jstorrent.io.socket.UdpSocketCallback
import com.jstorrent.io.socket.UdpSocketManager
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext

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
 *
 * Threading model:
 * - JS calls to __jstorrent_udp_* happen on the JS thread
 * - UdpSocketCallback events come from I/O threads
 * - Events are posted back to JS thread before invoking JS callbacks
 */
class UdpBindings(
    private val jsThread: JsThread,
    private val udpManager: UdpSocketManager
) {
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
                if (!hasBoundCallback) return

                jsThread.post {
                    // Call the JS dispatcher: __jstorrent_udp_dispatch_bound(socketId, success, port)
                    ctx.callGlobalFunction(
                        "__jstorrent_udp_dispatch_bound",
                        socketId.toString(),
                        success.toString(),
                        boundPort.toString()
                    )
                }
            }

            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
                if (!hasMessageCallback) return

                jsThread.post {
                    // Call the JS dispatcher with binary data
                    ctx.callGlobalFunctionWithBinary(
                        "__jstorrent_udp_dispatch_message",
                        data,
                        3,  // binary arg index
                        socketId.toString(),
                        srcAddr,
                        srcPort.toString()
                    )
                }
            }

            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
                // UDP close is not exposed to JS - sockets just go away
                // Could add if needed in the future
            }
        })
    }
}
