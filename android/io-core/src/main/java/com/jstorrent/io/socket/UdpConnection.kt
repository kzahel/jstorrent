package com.jstorrent.io.socket

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.SocketTimeoutException

/**
 * Internal handler for a single UDP socket.
 *
 * Manages receive and send loops for a bound UDP socket. Uses MulticastSocket
 * to support both unicast and multicast operations.
 *
 * @param socketId Unique identifier for this socket
 * @param socket The underlying MulticastSocket
 * @param scope CoroutineScope for I/O operations
 * @param onMessage Callback when datagram is received (srcAddr, srcPort, data)
 * @param onClose Callback when socket closes (hadError, errorCode)
 */
internal class UdpConnection(
    val socketId: Int,
    private val socket: MulticastSocket,
    private val scope: CoroutineScope,
    private val onMessage: (String, Int, ByteArray) -> Unit,
    private val onClose: (Boolean, Int) -> Unit
) {
    private val sendQueue = Channel<Triple<String, Int, ByteArray>>(100)
    private var senderJob: Job? = null
    private var receiverJob: Job? = null

    companion object {
        private const val RECEIVE_BUFFER_SIZE = 65535 // Max UDP packet size
        private const val SO_TIMEOUT = 60_000 // 60 seconds
    }

    init {
        socket.soTimeout = SO_TIMEOUT
    }

    /**
     * Start the receive and send loops.
     */
    fun start() {
        startReceiving()
        startSending()
    }

    /**
     * Queue a datagram for transmission.
     */
    fun send(destAddr: String, destPort: Int, data: ByteArray) {
        val result = sendQueue.trySend(Triple(destAddr, destPort, data))
        if (result.isFailure) {
            // Queue full - dropping packet
        }
    }

    /**
     * Join a multicast group.
     */
    @Suppress("DEPRECATION")
    fun joinMulticast(group: InetAddress) {
        socket.joinGroup(group)
    }

    /**
     * Leave a multicast group.
     */
    @Suppress("DEPRECATION")
    fun leaveMulticast(group: InetAddress) {
        socket.leaveGroup(group)
    }

    /**
     * Close the socket and stop I/O loops.
     * Blocks until the receive loop exits and onClose callback fires.
     */
    fun close() {
        sendQueue.close()
        senderJob?.cancel()
        // Close socket first - this causes receive() to throw and exit the loop
        try {
            socket.close()
        } catch (_: Exception) {}
        // Cancel the receiver job (will run finally block with onClose)
        receiverJob?.cancel()
        // Wait for receiver to finish so onClose callback fires before we return
        runBlocking {
            receiverJob?.join()
        }
    }

    private fun startReceiving() {
        receiverJob = scope.launch {
            val buffer = ByteArray(RECEIVE_BUFFER_SIZE)
            val packet = DatagramPacket(buffer, buffer.size)

            try {
                while (isActive) {
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        // Timeout is normal for UDP - just keep waiting
                        if (!scope.isActive) break
                        continue
                    }

                    val srcAddr = packet.address.hostAddress ?: continue
                    val srcPort = packet.port
                    val data = packet.data.copyOf(packet.length)

                    onMessage(srcAddr, srcPort, data)
                }
            } catch (_: Exception) {
                // Socket closed or error
            } finally {
                onClose(false, 0)
            }
        }
    }

    private fun startSending() {
        senderJob = scope.launch {
            try {
                for ((destAddr, destPort, data) in sendQueue) {
                    try {
                        val packet = DatagramPacket(
                            data,
                            data.size,
                            InetSocketAddress(destAddr, destPort)
                        )
                        socket.send(packet)
                    } catch (_: Exception) {
                        // Log but continue - don't let one bad address kill the sender
                        // This happens with unresolvable tracker hostnames
                    }
                }
            } catch (_: Exception) {
                // Sender ended
            }
        }
    }
}
