package com.jstorrent.quickjs.bindings

import com.jstorrent.io.socket.TcpServerCallback
import com.jstorrent.io.socket.TcpServerManager
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext

/**
 * TCP server socket bindings for QuickJS.
 *
 * Implements the following native functions:
 * - __jstorrent_tcp_listen(serverId, port)
 * - __jstorrent_tcp_server_close(serverId)
 * - __jstorrent_tcp_on_listening(callback)
 * - __jstorrent_tcp_on_accept(callback)
 *
 * Threading model:
 * - JS calls to __jstorrent_tcp_* happen on the JS thread
 * - TcpServerCallback events come from I/O threads
 * - Events are posted back to JS thread before invoking JS callbacks
 */
class TcpServerBindings(
    private val jsThread: JsThread,
    private val serverManager: TcpServerManager
) {
    // Track whether JS has registered callbacks
    private var hasListeningCallback = false
    private var hasAcceptCallback = false

    /**
     * Register all TCP server bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerCommandFunctions(ctx)
        registerCallbackFunctions(ctx)
        setupNativeCallbacks(ctx)
    }

    private fun registerCommandFunctions(ctx: QuickJsContext) {
        // __jstorrent_tcp_listen(serverId: number, port: number): void
        ctx.setGlobalFunction("__jstorrent_tcp_listen") { args ->
            val serverId = args.getOrNull(0)?.toIntOrNull()
            val port = args.getOrNull(1)?.toIntOrNull() ?: 0

            if (serverId != null) {
                serverManager.listen(serverId, port)
            }
            null
        }

        // __jstorrent_tcp_server_close(serverId: number): void
        ctx.setGlobalFunction("__jstorrent_tcp_server_close") { args ->
            val serverId = args.getOrNull(0)?.toIntOrNull()
            serverId?.let { serverManager.stopListen(it) }
            null
        }
    }

    private fun registerCallbackFunctions(ctx: QuickJsContext) {
        // __jstorrent_tcp_on_listening(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_listening") { _ ->
            hasListeningCallback = true
            null
        }

        // __jstorrent_tcp_on_accept(callback): void
        ctx.setGlobalFunction("__jstorrent_tcp_on_accept") { _ ->
            hasAcceptCallback = true
            null
        }
    }

    private fun setupNativeCallbacks(ctx: QuickJsContext) {
        serverManager.setCallback(object : TcpServerCallback {
            override fun onTcpListenResult(serverId: Int, success: Boolean, boundPort: Int, errorCode: Int) {
                if (!hasListeningCallback) return

                jsThread.post {
                    // Call the JS dispatcher: __jstorrent_tcp_dispatch_listening(serverId, success, port)
                    ctx.callGlobalFunction(
                        "__jstorrent_tcp_dispatch_listening",
                        serverId.toString(),
                        success.toString(),
                        boundPort.toString()
                    )
                    // Schedule job processing for the NEXT message to avoid deadlock
                    jsThread.scheduleJobPump(ctx)
                }
            }

            override fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int) {
                if (!hasAcceptCallback) return

                jsThread.post {
                    // Call the JS dispatcher: __jstorrent_tcp_dispatch_accept(serverId, socketId, remoteAddr, remotePort)
                    ctx.callGlobalFunction(
                        "__jstorrent_tcp_dispatch_accept",
                        serverId.toString(),
                        socketId.toString(),
                        peerAddr,
                        peerPort.toString()
                    )
                    // Schedule job processing for the NEXT message to avoid deadlock
                    jsThread.scheduleJobPump(ctx)
                }
            }
        })
    }
}
