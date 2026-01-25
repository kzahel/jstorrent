package com.jstorrent.io.socket

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.net.InetAddress
import java.net.MulticastSocket
import java.util.concurrent.ConcurrentHashMap

/**
 * Implementation of [UdpSocketManager] for UDP socket operations.
 *
 * Uses [MulticastSocket] internally to support both unicast and multicast
 * operations. All sockets are configured with reuseAddress for compatibility.
 *
 * @param scope CoroutineScope for all socket operations
 */
class UdpSocketManagerImpl(
    private val scope: CoroutineScope
) : UdpSocketManager {

    private var callback: UdpSocketCallback? = null
    private val sockets = ConcurrentHashMap<Int, UdpConnection>()

    override fun bind(socketId: Int, port: Int) {
        scope.launch {
            try {
                // Use MulticastSocket instead of DatagramSocket to support multicast
                val socket = MulticastSocket(port)
                socket.reuseAddress = true

                val boundPort = socket.localPort

                val connection = UdpConnection(
                    socketId = socketId,
                    socket = socket,
                    scope = scope,
                    onMessage = { srcAddr, srcPort, data ->
                        callback?.onUdpMessage(socketId, srcAddr, srcPort, data)
                    },
                    onClose = { hadError, errorCode ->
                        sockets.remove(socketId)
                        callback?.onUdpClose(socketId, hadError, errorCode)
                    }
                )
                sockets[socketId] = connection
                connection.start()

                callback?.onUdpBound(socketId, true, boundPort, 0)

            } catch (e: Exception) {
                android.util.Log.e("UdpSocketManager", "Failed to bind socket $socketId to port $port", e)
                callback?.onUdpBound(socketId, false, 0, 1)
            }
        }
    }

    override fun send(socketId: Int, destAddr: String, destPort: Int, data: ByteArray) {
        sockets[socketId]?.send(destAddr, destPort, data)
    }

    override fun close(socketId: Int) {
        sockets.remove(socketId)?.close()
    }

    override fun joinMulticast(socketId: Int, groupAddr: String) {
        sockets[socketId]?.let { connection ->
            try {
                val group = InetAddress.getByName(groupAddr)
                connection.joinMulticast(group)
            } catch (_: Exception) {
                // Failed to join multicast group
            }
        }
    }

    override fun leaveMulticast(socketId: Int, groupAddr: String) {
        sockets[socketId]?.let { connection ->
            try {
                val group = InetAddress.getByName(groupAddr)
                connection.leaveMulticast(group)
            } catch (_: Exception) {
                // Failed to leave multicast group
            }
        }
    }

    override fun setCallback(callback: UdpSocketCallback) {
        this.callback = callback
    }

    /**
     * Shutdown the manager, closing all sockets.
     */
    fun shutdown() {
        sockets.values.forEach { it.close() }
        sockets.clear()
    }
}
