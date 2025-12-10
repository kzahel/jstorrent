package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "SocketHandler"

class SocketSession(
    private val wsSession: DefaultWebSocketServerSession,
    private val tokenStore: TokenStore,
    private val httpServer: HttpServer
) {
    private var authenticated = false

    // Socket management
    private val tcpSockets = ConcurrentHashMap<Int, TcpSocketHandler>()
    private val udpSockets = ConcurrentHashMap<Int, UdpSocketHandler>()

    // Outgoing message queue - large buffer for high throughput
    private val outgoing = Channel<ByteArray>(1000)

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    suspend fun run() {
        // Start sender coroutine
        val senderJob = scope.launch {
            try {
                for (data in outgoing) {
                    wsSession.send(Frame.Binary(true, data))
                }
            } catch (e: Exception) {
                Log.d(TAG, "Sender stopped: ${e.message}")
            }
        }

        try {
            for (frame in wsSession.incoming) {
                if (frame is Frame.Binary) {
                    handleMessage(frame.readBytes())
                }
            }
        } catch (e: ClosedReceiveChannelException) {
            Log.d(TAG, "WebSocket closed normally")
        } catch (e: Exception) {
            Log.e(TAG, "WebSocket error: ${e.message}")
        } finally {
            cleanup()
            senderJob.cancel()
        }
    }

    private suspend fun handleMessage(data: ByteArray) {
        if (data.size < 8) {
            Log.w(TAG, "Message too short: ${data.size} bytes")
            return
        }

        val envelope = Protocol.Envelope.fromBytes(data) ?: run {
            Log.e(TAG, "Failed to parse envelope from ${data.size} bytes")
            return
        }

        Log.d(TAG, "RECV: opcode=0x${envelope.opcode.toString(16)}, reqId=${envelope.requestId}, " +
            "payloadSize=${data.size - 8}, authenticated=$authenticated")

        if (envelope.version != Protocol.VERSION) {
            Log.e(TAG, "Invalid version: ${envelope.version} (expected ${Protocol.VERSION})")
            sendError(envelope.requestId, "Invalid protocol version")
            return
        }

        val payload = data.copyOfRange(8, data.size)

        if (!authenticated) {
            handlePreAuth(envelope, payload)
        } else {
            handlePostAuth(envelope, payload)
        }
    }

    private suspend fun handlePreAuth(envelope: Protocol.Envelope, payload: ByteArray) {
        when (envelope.opcode) {
            Protocol.OP_CLIENT_HELLO -> {
                send(Protocol.createMessage(Protocol.OP_SERVER_HELLO, envelope.requestId))
            }
            Protocol.OP_AUTH -> {
                if (payload.isEmpty()) {
                    sendError(envelope.requestId, "Invalid auth payload")
                    return
                }

                // Parse AUTH payload: authType(1) + token + \0 + extensionId + \0 + installId
                val authType = payload[0]
                val payloadStr = String(payload, 1, payload.size - 1)
                val parts = payloadStr.split('\u0000')

                if (parts.size < 3) {
                    sendError(envelope.requestId, "Invalid auth payload format")
                    return
                }

                val token = parts[0]
                val extensionId = parts[1]
                val installId = parts[2]

                val storedToken = tokenStore.token
                if (storedToken != null &&
                    token == storedToken &&
                    tokenStore.isPairedWith(extensionId, installId)
                ) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    Log.i(TAG, "WebSocket authenticated")
                    httpServer.registerControlSession(this@SocketSession)
                } else {
                    val errorMsg = "Invalid credentials".toByteArray()
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(1) + errorMsg))
                    Log.w(TAG, "WebSocket auth failed: token=${token == storedToken}, paired=${tokenStore.isPairedWith(extensionId, installId)}")
                }
            }
            else -> {
                sendError(envelope.requestId, "Not authenticated")
            }
        }
    }

    private suspend fun handlePostAuth(envelope: Protocol.Envelope, payload: ByteArray) {
        when (envelope.opcode) {
            Protocol.OP_TCP_CONNECT -> handleTcpConnect(envelope.requestId, payload)
            Protocol.OP_TCP_SEND -> handleTcpSend(payload)
            Protocol.OP_TCP_CLOSE -> handleTcpClose(payload)
            Protocol.OP_UDP_BIND -> handleUdpBind(envelope.requestId, payload)
            Protocol.OP_UDP_SEND -> handleUdpSend(payload)
            Protocol.OP_UDP_CLOSE -> handleUdpClose(payload)
            else -> sendError(envelope.requestId, "Unknown opcode: ${envelope.opcode}")
        }
    }

    // TCP handlers

    private fun handleTcpConnect(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val hostname = String(payload, 6, payload.size - 6)

        Log.d(TAG, "TCP_CONNECT: socketId=$socketId, $hostname:$port")

        scope.launch {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress(hostname, port), 30000)

                val handler = TcpSocketHandler(socketId, socket, this@SocketSession)
                tcpSockets[socketId] = handler

                // Send TCP_CONNECTED success
                val response = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))

                // Start reading from socket
                handler.startReading()

            } catch (e: Exception) {
                Log.e(TAG, "TCP connect failed: ${e.message}")
                // Send TCP_CONNECTED failure
                val response = socketId.toLEBytes() + byteArrayOf(1) + 1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
            }
        }
    }

    private fun handleTcpSend(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val data = payload.copyOfRange(4, payload.size)

        tcpSockets[socketId]?.send(data)
    }

    private fun handleTcpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        tcpSockets.remove(socketId)?.close()
    }

    // UDP handlers

    private fun handleUdpBind(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val bindAddr = if (payload.size > 6) String(payload, 6, payload.size - 6) else ""

        Log.d(TAG, "UDP_BIND: socketId=$socketId, port=$port")

        scope.launch {
            try {
                val socket = DatagramSocket(port)
                val boundPort = socket.localPort

                val handler = UdpSocketHandler(socketId, socket, this@SocketSession)
                udpSockets[socketId] = handler

                // Send UDP_BOUND success
                val response = socketId.toLEBytes() +
                    byteArrayOf(0) +
                    boundPort.toShort().toLEBytes() +
                    0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))

                // Start receiving
                handler.startReceiving()

            } catch (e: Exception) {
                Log.e(TAG, "UDP bind failed: ${e.message}")
                // Send UDP_BOUND failure
                val response = socketId.toLEBytes() +
                    byteArrayOf(1) +
                    0.toShort().toLEBytes() +
                    1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))
            }
        }
    }

    private fun handleUdpSend(payload: ByteArray) {
        if (payload.size < 8) return

        val socketId = payload.getUIntLE(0)
        val destPort = payload.getUShortLE(4)
        val addrLen = payload.getUShortLE(6)

        if (payload.size < 8 + addrLen) return

        val destAddr = String(payload, 8, addrLen)
        val data = payload.copyOfRange(8 + addrLen, payload.size)

        udpSockets[socketId]?.send(destAddr, destPort, data)
    }

    private fun handleUdpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        udpSockets.remove(socketId)?.close()
    }

    // Helpers

    internal fun send(data: ByteArray) {
        if (data.size >= 8) {
            val envelope = Protocol.Envelope.fromBytes(data)
            if (envelope != null) {
                Log.d(TAG, "SEND: opcode=0x${envelope.opcode.toString(16)}, reqId=${envelope.requestId}, " +
                    "payloadSize=${data.size - 8}")
            }
        }
        // Use trySend to avoid coroutine overhead - drop if buffer full
        val result = outgoing.trySend(data)
        if (result.isFailure) {
            Log.w(TAG, "Outgoing buffer full, dropping message")
        }
    }

    /**
     * Send a control frame. Only works if authenticated.
     */
    fun sendControl(frame: ByteArray) {
        if (authenticated) {
            send(frame)
        }
    }

    private fun sendError(requestId: Int, message: String) {
        send(Protocol.createError(requestId, message))
    }

    private fun cleanup() {
        httpServer.unregisterControlSession(this)
        tcpSockets.values.forEach { it.close() }
        tcpSockets.clear()
        udpSockets.values.forEach { it.close() }
        udpSockets.clear()
        scope.cancel()
        outgoing.close()
    }
}

class TcpSocketHandler(
    private val socketId: Int,
    private val socket: Socket,
    private val session: SocketSession
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    companion object {
        private const val PERF_TAG = "JSTorrent.Perf"
        // Set to true to enable detailed timing logs
        private const val ENABLE_PERF_LOGGING = false
        // Log interval: only log every N reads to reduce log spam
        private const val LOG_INTERVAL = 100
    }

    fun startReading() {
        scope.launch {
            val buffer = ByteArray(65536)
            var readCount = 0L
            var totalBytesRead = 0L
            val startTime = System.nanoTime()

            try {
                val input = socket.getInputStream()
                while (true) {
                    val t0 = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    val bytesRead = input.read(buffer)
                    if (bytesRead < 0) break

                    val tRead = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    // Build TCP_RECV frame
                    val payload = socketId.toLEBytes() + buffer.copyOf(bytesRead)
                    val frame = Protocol.createMessage(Protocol.OP_TCP_RECV, 0, payload)

                    val tPack = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    // Send to WebSocket
                    session.send(frame)

                    val tSend = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    readCount++
                    totalBytesRead += bytesRead

                    // Performance logging (periodic to reduce overhead)
                    if (ENABLE_PERF_LOGGING && readCount % LOG_INTERVAL == 0L) {
                        Log.d(PERF_TAG,
                            "socket=$socketId " +
                            "read=${(tRead - t0) / 1000}µs " +
                            "pack=${(tPack - tRead) / 1000}µs " +
                            "send=${(tSend - tPack) / 1000}µs " +
                            "bytes=$bytesRead " +
                            "total=${totalBytesRead / 1024}KB"
                        )
                    }
                }
            } catch (e: IOException) {
                Log.d(TAG, "TCP socket $socketId read ended: ${e.message}")
            } finally {
                // Log final stats
                val elapsedMs = (System.nanoTime() - startTime) / 1_000_000
                if (readCount > 0) {
                    val mbps = if (elapsedMs > 0) {
                        (totalBytesRead.toDouble() / 1024 / 1024) / (elapsedMs.toDouble() / 1000)
                    } else 0.0
                    Log.i(TAG, "TCP socket $socketId finished: " +
                        "${totalBytesRead / 1024 / 1024}MB in ${elapsedMs}ms " +
                        "(${String.format("%.2f", mbps)} MB/s, $readCount reads)"
                    )
                }
                sendClose()
            }
        }
    }

    fun send(data: ByteArray) {
        scope.launch {
            try {
                socket.getOutputStream().write(data)
                socket.getOutputStream().flush()
            } catch (e: IOException) {
                Log.e(TAG, "TCP send failed: ${e.message}")
            }
        }
    }

    fun close() {
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }

    private fun sendClose() {
        val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
        session.send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, payload))
    }
}

class UdpSocketHandler(
    private val socketId: Int,
    private val socket: DatagramSocket,
    private val session: SocketSession
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun startReceiving() {
        scope.launch {
            val buffer = ByteArray(65535)
            val packet = DatagramPacket(buffer, buffer.size)

            try {
                while (true) {
                    socket.receive(packet)

                    val srcAddr = packet.address.hostAddress ?: continue
                    val srcPort = packet.port
                    val data = packet.data.copyOf(packet.length)

                    // Build UDP_RECV payload:
                    // socketId(4) + srcPort(2) + addrLen(2) + addr + data
                    val addrBytes = srcAddr.toByteArray()
                    val payload = socketId.toLEBytes() +
                        srcPort.toShort().toLEBytes() +
                        addrBytes.size.toShort().toLEBytes() +
                        addrBytes +
                        data

                    session.send(Protocol.createMessage(Protocol.OP_UDP_RECV, 0, payload))
                }
            } catch (e: Exception) {
                Log.d(TAG, "UDP socket $socketId receive ended: ${e.message}")
            } finally {
                sendClose()
            }
        }
    }

    fun send(destAddr: String, destPort: Int, data: ByteArray) {
        scope.launch {
            try {
                val packet = DatagramPacket(
                    data,
                    data.size,
                    InetSocketAddress(destAddr, destPort)
                )
                socket.send(packet)
            } catch (e: Exception) {
                Log.e(TAG, "UDP send failed: ${e.message}")
            }
        }
    }

    fun close() {
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }

    private fun sendClose() {
        val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
        session.send(Protocol.createMessage(Protocol.OP_UDP_CLOSE, 0, payload))
    }
}
