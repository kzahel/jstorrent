@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

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
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.sync.Semaphore

private const val TAG = "SocketHandler"

// Limit concurrent pending TCP connections to prevent resource exhaustion
// when connecting to many unreachable peers on internet torrents.
// Using kotlinx.coroutines Semaphore (suspending) instead of java.util.concurrent
// Semaphore (blocking) to avoid starving the IO dispatcher thread pool.
private val connectSemaphore = Semaphore(30)
// Track pending connections for diagnostics
private val pendingConnects = java.util.concurrent.atomic.AtomicInteger(0)
private val waitingForSemaphore = java.util.concurrent.atomic.AtomicInteger(0)

enum class SessionType {
    IO,      // /io endpoint - socket operations
    CONTROL  // /control endpoint - control broadcasts
}

class SocketSession(
    private val wsSession: DefaultWebSocketServerSession,
    private val tokenStore: TokenStore,
    private val httpServer: HttpServer,
    private val sessionType: SessionType = SessionType.IO
) {
    private var authenticated = false

    // Socket management
    private val tcpSockets = ConcurrentHashMap<Int, TcpSocketHandler>()
    private val udpSockets = ConcurrentHashMap<Int, UdpSocketHandler>()
    private val tcpServers = ConcurrentHashMap<Int, TcpServerHandler>()
    private val nextSocketId = AtomicInteger(0x10000) // Start high to avoid collision with client-assigned IDs
    // Track pending TCP connect jobs so they can be cancelled when TCP_CLOSE arrives
    private val pendingTcpConnects = ConcurrentHashMap<Int, Job>()
    // Connected sockets that haven't started reading/writing yet (for TLS upgrade)
    private val pendingTcpSockets = ConcurrentHashMap<Int, Socket>()

    // Outgoing message queue - large buffer for high throughput
    // At 65KB frames, 2000 frames = ~130MB buffer capacity
    private val outgoing = Channel<ByteArray>(2000)

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    // Track dropped messages for diagnostics
    private val dropCount = java.util.concurrent.atomic.AtomicLong(0)
    // Track queue depth for diagnostics
    private val queueDepth = java.util.concurrent.atomic.AtomicInteger(0)
    // Connection statistics
    private val bytesReceived = java.util.concurrent.atomic.AtomicLong(0)
    private val bytesSent = java.util.concurrent.atomic.AtomicLong(0)
    private val framesReceived = java.util.concurrent.atomic.AtomicLong(0)
    private val framesSent = java.util.concurrent.atomic.AtomicLong(0)
    private val connectTime = System.currentTimeMillis()

    companion object {
        // Reduce log spam - only log sends when debugging
        private const val ENABLE_SEND_LOGGING = true
    }

    suspend fun run() {
        // Start sender coroutine
        val senderJob = scope.launch {
            var sendCount = 0L
            var totalSendTimeNs = 0L
            try {
                for (data in outgoing) {
                    val depth = queueDepth.decrementAndGet()
                    val t0 = System.nanoTime()
                    wsSession.send(Frame.Binary(true, data))
                    val sendTimeNs = System.nanoTime() - t0
                    totalSendTimeNs += sendTimeNs
                    sendCount++

                    // Log slow sends and queue depth
                    val sendTimeMs = sendTimeNs / 1_000_000
                    if (sendTimeMs > 50) {
                        // Parse opcode for context
                        val opcode = if (data.size >= 2) data[1].toInt() and 0xFF else -1
                        Log.w(TAG, "SLOW SEND: ${sendTimeMs}ms, opcode=0x${opcode.toString(16)}, " +
                            "size=${data.size}, queueDepth=$depth")
                    }

                    // Periodic stats every 1000 sends
                    if (sendCount % 1000 == 0L) {
                        val avgSendUs = totalSendTimeNs / sendCount / 1000
                        Log.i(TAG, "Sender stats: $sendCount sends, avg=${avgSendUs}µs/send, queueDepth=$depth")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "WebSocket sender failed: ${e.message}")
                // Sender failed - close the WebSocket to trigger cleanup
                // This will cause the receiver loop to exit and call cleanup()
                try {
                    wsSession.close(CloseReason(CloseReason.Codes.GOING_AWAY, "Sender failed"))
                } catch (_: Exception) {}
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
        framesReceived.incrementAndGet()
        bytesReceived.addAndGet(data.size.toLong())

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

        // Validate opcode is allowed for this session type
        val allowedOpcodes = when (sessionType) {
            SessionType.IO -> Protocol.IO_OPCODES
            SessionType.CONTROL -> Protocol.CONTROL_OPCODES
        }
        if (envelope.opcode !in allowedOpcodes) {
            Log.w(TAG, "Opcode 0x${envelope.opcode.toString(16)} not allowed on ${sessionType.name} endpoint")
            sendError(envelope.requestId, "Opcode not allowed on this endpoint")
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
                    Log.i(TAG, "WebSocket authenticated (${sessionType.name})")

                    // Only register control sessions for broadcasts
                    if (sessionType == SessionType.CONTROL) {
                        httpServer.registerControlSession(this@SocketSession)
                    }
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
            Protocol.OP_TCP_SECURE -> handleTcpSecure(envelope.requestId, payload)
            Protocol.OP_TCP_LISTEN -> handleTcpListen(envelope.requestId, payload)
            Protocol.OP_TCP_STOP_LISTEN -> handleTcpStopListen(payload)
            Protocol.OP_UDP_BIND -> handleUdpBind(envelope.requestId, payload)
            Protocol.OP_UDP_SEND -> handleUdpSend(payload)
            Protocol.OP_UDP_CLOSE -> handleUdpClose(payload)
            Protocol.OP_UDP_JOIN_MULTICAST -> handleUdpJoinMulticast(payload)
            Protocol.OP_UDP_LEAVE_MULTICAST -> handleUdpLeaveMulticast(payload)
            else -> sendError(envelope.requestId, "Unknown opcode: ${envelope.opcode}")
        }
    }

    // TCP handlers

    private fun handleTcpConnect(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val hostname = String(payload, 6, payload.size - 6)

        // Fast-fail if too many connects are already pending
        // This prevents unbounded queue growth when extension floods with connect requests
        val currentPending = pendingConnects.get()
        if (currentPending >= 60) {
            Log.w(TAG, "TCP_CONNECT rejected (queue full): socketId=$socketId, pending=$currentPending")
            val response = socketId.toLEBytes() + byteArrayOf(1) + 1.toLEBytes()
            send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
            return
        }

        val waiting = waitingForSemaphore.incrementAndGet()
        val pending = pendingConnects.incrementAndGet()
        Log.d(TAG, "TCP_CONNECT: socketId=$socketId, $hostname:$port (waiting=$waiting, pending=$pending)")

        val job = scope.launch {
            var acquiredSemaphore = false
            try {
                // Limit concurrent pending connections to prevent resource exhaustion
                // Use withTimeout to prevent indefinite waiting when many connects queue up
                val acquired = withTimeoutOrNull(5000L) {
                    connectSemaphore.acquire()
                    true
                }
                if (acquired != true) {
                    Log.w(TAG, "TCP_CONNECT timeout waiting for semaphore: socketId=$socketId")
                    waitingForSemaphore.decrementAndGet()
                    // Send failure to extension
                    val response = socketId.toLEBytes() + byteArrayOf(1) + 1.toLEBytes()
                    send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
                    return@launch
                }
                acquiredSemaphore = true
                waitingForSemaphore.decrementAndGet()

                // Check if we were cancelled while waiting for semaphore
                if (!isActive) {
                    Log.d(TAG, "TCP_CONNECT cancelled while waiting: socketId=$socketId")
                    return@launch
                }

                val socket = Socket()
                try {
                    // Performance: disable Nagle's algorithm for lower latency
                    socket.tcpNoDelay = true
                    // Performance: larger receive buffer for better throughput
                    socket.receiveBufferSize = 256 * 1024
                    // Reliability: detect zombie connections that stop responding
                    socket.soTimeout = 60_000 // 60 second read timeout
                    // Reliability: TCP keep-alive for connection health
                    socket.setKeepAlive(true)
                    // 10s connect timeout - balance between resource usage and reaching slow peers
                    socket.connect(InetSocketAddress(hostname, port), 10000)

                    // Check if we were cancelled during connect
                    if (!isActive) {
                        Log.d(TAG, "TCP_CONNECT cancelled during connect: socketId=$socketId")
                        socket.close()
                        return@launch
                    }

                    // Store in pending - don't start read/write tasks yet
                    // This allows for TLS upgrade before activation
                    pendingTcpSockets[socketId] = socket

                    // Send TCP_CONNECTED success
                    Log.i(TAG, "TCP_CONNECTED SUCCESS: socketId=$socketId, $hostname:$port")
                    val response = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
                    send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
                } catch (e: Exception) {
                    socket.close()
                    throw e
                }

            } catch (e: CancellationException) {
                Log.d(TAG, "TCP_CONNECT cancelled: socketId=$socketId, hadSemaphore=$acquiredSemaphore")
                // Don't send failure - socket was intentionally closed
                // Decrement waiting counter if we were cancelled before acquiring
                if (!acquiredSemaphore) {
                    waitingForSemaphore.decrementAndGet()
                }
                throw e  // Re-throw to properly propagate cancellation
            } catch (e: Exception) {
                Log.e(TAG, "TCP connect failed: ${e.message}")
                // Send TCP_CONNECTED failure
                val response = socketId.toLEBytes() + byteArrayOf(1) + 1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
            } finally {
                if (acquiredSemaphore) {
                    connectSemaphore.release()
                }
                pendingConnects.decrementAndGet()
                pendingTcpConnects.remove(socketId)
            }
        }

        // Track the job so it can be cancelled by TCP_CLOSE
        pendingTcpConnects[socketId] = job
    }

    private fun handleTcpSend(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val data = payload.copyOfRange(4, payload.size)

        Log.d(TAG, "TCP_SEND: socketId=$socketId, ${data.size} bytes")

        // Check if socket is pending (not yet activated)
        val pendingSocket = pendingTcpSockets.remove(socketId)
        if (pendingSocket != null) {
            // Auto-activate as plain TCP socket
            val handler = TcpSocketHandler(socketId, pendingSocket, this@SocketSession) { id ->
                tcpSockets.remove(id)
            }
            tcpSockets[socketId] = handler
            handler.startReading()
            handler.startSending()
            handler.send(data)
            return
        }

        val socket = tcpSockets[socketId]
        if (socket != null) {
            socket.send(data)
        } else {
            // Socket was closed but engine doesn't know yet
            // This can happen during cleanup races - log but don't spam
            Log.w(TAG, "TCP_SEND to unknown socket $socketId (${data.size} bytes)")
        }
    }

    private fun handleTcpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)

        // Cancel any pending connect for this socket - this frees up semaphore permits
        // for new connections when torrents are stopped
        val pendingJob = pendingTcpConnects.remove(socketId)
        if (pendingJob != null) {
            Log.d(TAG, "TCP_CLOSE cancelling pending connect: socketId=$socketId")
            pendingJob.cancel()
        }

        // Remove pending socket (connected but not yet activated)
        pendingTcpSockets.remove(socketId)?.close()

        tcpSockets.remove(socketId)?.close()
    }

    private fun handleTcpSecure(requestId: Int, payload: ByteArray) {
        // Payload: socketId(4) + flags(1) + hostname(utf8)
        // flags bit 0: skipValidation
        if (payload.size < 5) return

        val socketId = payload.getUIntLE(0)
        val flags = payload[4].toInt()
        val skipValidation = (flags and 1) != 0
        val hostname = String(payload, 5, payload.size - 5)

        Log.d(TAG, "TCP_SECURE: socketId=$socketId, hostname=$hostname, skipValidation=$skipValidation")

        // Must be a pending socket (not yet active)
        val socket = pendingTcpSockets.remove(socketId)
        if (socket == null) {
            Log.e(TAG, "TCP_SECURE: socket $socketId not pending")
            val response = socketId.toLEBytes() + byteArrayOf(1)
            send(Protocol.createMessage(Protocol.OP_TCP_SECURED, requestId, response))
            return
        }

        scope.launch {
            try {
                // Create SSLSocketFactory
                val sslSocketFactory = if (skipValidation) {
                    createInsecureSocketFactory()
                } else {
                    SSLSocketFactory.getDefault() as SSLSocketFactory
                }

                // Create SSLSocket wrapping the existing socket
                val sslSocket = sslSocketFactory.createSocket(
                    socket,
                    hostname,
                    socket.port,
                    true  // autoClose
                ) as SSLSocket

                // Configure and start handshake
                sslSocket.useClientMode = true
                sslSocket.startHandshake()

                // Create handler and start read/write tasks
                val handler = TcpSocketHandler(socketId, sslSocket, this@SocketSession) { id ->
                    tcpSockets.remove(id)
                }
                tcpSockets[socketId] = handler
                handler.startReading()
                handler.startSending()

                // Send success
                Log.i(TAG, "TCP_SECURED SUCCESS: socketId=$socketId, hostname=$hostname")
                val response = socketId.toLEBytes() + byteArrayOf(0)
                send(Protocol.createMessage(Protocol.OP_TCP_SECURED, requestId, response))

            } catch (e: Exception) {
                Log.e(TAG, "TLS upgrade failed for socketId=$socketId: ${e.message}")
                try {
                    socket.close()
                } catch (_: Exception) {}
                val response = socketId.toLEBytes() + byteArrayOf(1)
                send(Protocol.createMessage(Protocol.OP_TCP_SECURED, requestId, response))
            }
        }
    }

    private fun createInsecureSocketFactory(): SSLSocketFactory {
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, trustAllCerts, SecureRandom())
        return sslContext.socketFactory
    }

    // TCP Server handlers

    private fun handleTcpListen(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val serverId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        // bindAddr (string) is ignored for now - always binds to 0.0.0.0

        Log.d(TAG, "TCP_LISTEN: serverId=$serverId, port=$port")

        scope.launch {
            try {
                val serverSocket = ServerSocket(port)
                val boundPort = serverSocket.localPort

                val handler = TcpServerHandler(
                    serverId,
                    serverSocket,
                    this@SocketSession,
                    nextSocketId,
                    tcpSockets
                )
                tcpServers[serverId] = handler

                // Send TCP_LISTEN_RESULT success
                // Payload: serverId(4), status(1), boundPort(2), errno(4)
                val response = serverId.toLEBytes() +
                    byteArrayOf(0) +
                    boundPort.toShort().toLEBytes() +
                    0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_LISTEN_RESULT, requestId, response))

                // Start accepting connections
                handler.startAccepting()

            } catch (e: Exception) {
                Log.e(TAG, "TCP listen failed: ${e.message}")
                // Send TCP_LISTEN_RESULT failure
                val response = serverId.toLEBytes() +
                    byteArrayOf(1) +
                    0.toShort().toLEBytes() +
                    1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_LISTEN_RESULT, requestId, response))
            }
        }
    }

    private fun handleTcpStopListen(payload: ByteArray) {
        if (payload.size < 4) return

        val serverId = payload.getUIntLE(0)
        tcpServers.remove(serverId)?.close()
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
                // Use MulticastSocket instead of DatagramSocket to support multicast operations
                // MulticastSocket works for both unicast and multicast
                val socket = MulticastSocket(port)
                socket.reuseAddress = true
                socket.timeToLive = 1  // LAN only for multicast
                val boundPort = socket.localPort

                val handler = UdpSocketHandler(socketId, socket, this@SocketSession)
                udpSockets[socketId] = handler

                // Send UDP_BOUND success
                val response = socketId.toLEBytes() +
                    byteArrayOf(0) +
                    boundPort.toShort().toLEBytes() +
                    0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))

                // Start receiving and sending
                handler.startReceiving()
                handler.startSending()

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

        val socket = udpSockets[socketId]
        if (socket != null) {
            socket.send(destAddr, destPort, data)
        } else {
            Log.d(TAG, "UDP_SEND to unknown socket $socketId (${data.size} bytes to $destAddr:$destPort)")
        }
    }

    private fun handleUdpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        udpSockets.remove(socketId)?.close()
    }

    private fun handleUdpJoinMulticast(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val groupAddr = String(payload, 4, payload.size - 4)

        udpSockets[socketId]?.let { handler ->
            try {
                val group = InetAddress.getByName(groupAddr)
                handler.joinMulticast(group)
                Log.d(TAG, "UDP socket $socketId joined multicast $groupAddr")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to join multicast $groupAddr: ${e.message}")
            }
        }
    }

    private fun handleUdpLeaveMulticast(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val groupAddr = String(payload, 4, payload.size - 4)

        udpSockets[socketId]?.let { handler ->
            try {
                val group = InetAddress.getByName(groupAddr)
                handler.leaveMulticast(group)
                Log.d(TAG, "UDP socket $socketId left multicast $groupAddr")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to leave multicast $groupAddr: ${e.message}")
            }
        }
    }

    // Helpers

    internal fun send(data: ByteArray) {
        framesSent.incrementAndGet()
        bytesSent.addAndGet(data.size.toLong())

        if (data.size >= 8) {
            val envelope = Protocol.Envelope.fromBytes(data)
            if (envelope != null && ENABLE_SEND_LOGGING) {
                Log.d(TAG, "SEND: opcode=0x${envelope.opcode.toString(16)}, reqId=${envelope.requestId}, " +
                    "payloadSize=${data.size - 8}")
            }
        }
        // Use trySend for non-blocking send
        val result = outgoing.trySend(data)
        if (result.isSuccess) {
            val depth = queueDepth.incrementAndGet()
            // Log when queue is building up
            if (depth > 100 && depth % 100 == 0) {
                val opcode = if (data.size >= 2) data[1].toInt() and 0xFF else -1
                Log.w(TAG, "Queue building: depth=$depth, opcode=0x${opcode.toString(16)}")
            }
        } else {
            // Channel is full - this indicates backpressure
            // Log at warning level but don't spam
            if (dropCount.incrementAndGet() % 100 == 1L) {
                Log.w(TAG, "Outgoing buffer full, dropped ${dropCount.get()} messages total")
            }
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
        // Log session statistics
        val duration = (System.currentTimeMillis() - connectTime) / 1000.0
        val recvMB = bytesReceived.get() / 1024.0 / 1024.0
        val sentMB = bytesSent.get() / 1024.0 / 1024.0
        val pendingCount = pendingTcpConnects.size
        Log.i(TAG, "Session closed after ${String.format("%.1f", duration)}s: " +
            "recv=${String.format("%.1f", recvMB)}MB/${framesReceived.get()} frames, " +
            "sent=${String.format("%.1f", sentMB)}MB/${framesSent.get()} frames, " +
            "dropped=${dropCount.get()}, pendingConnects=$pendingCount")

        httpServer.unregisterControlSession(this)

        // Cancel all pending TCP connects to release semaphore permits
        if (pendingCount > 0) {
            Log.i(TAG, "Cancelling $pendingCount pending TCP connects")
            pendingTcpConnects.values.forEach { it.cancel() }
            pendingTcpConnects.clear()
        }

        // Close pending sockets (connected but not yet activated)
        pendingTcpSockets.values.forEach { it.close() }
        pendingTcpSockets.clear()

        tcpSockets.values.forEach { it.close() }
        tcpSockets.clear()
        udpSockets.values.forEach { it.close() }
        udpSockets.clear()
        tcpServers.values.forEach { it.close() }
        tcpServers.clear()
        scope.cancel()
        outgoing.close()
    }
}

class TcpServerHandler(
    private val serverId: Int,
    private val serverSocket: ServerSocket,
    private val session: SocketSession,
    private val nextSocketId: AtomicInteger,
    private val tcpSockets: ConcurrentHashMap<Int, TcpSocketHandler>
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun startAccepting() {
        scope.launch {
            try {
                while (true) {
                    val socket = serverSocket.accept()
                    // Apply same socket options as outgoing connections
                    // CRITICAL for internet peers: tcpNoDelay prevents Nagle buffering
                    socket.tcpNoDelay = true
                    socket.receiveBufferSize = 256 * 1024
                    socket.soTimeout = 60_000
                    socket.setKeepAlive(true)

                    val socketId = nextSocketId.getAndIncrement()
                    val peerAddr = socket.inetAddress.hostAddress ?: "unknown"
                    val peerPort = socket.port

                    Log.d(TAG, "TCP_ACCEPT: serverId=$serverId, socketId=$socketId, peer=$peerAddr:$peerPort")

                    // Create handler for accepted connection
                    val handler = TcpSocketHandler(socketId, socket, session) { id ->
                        tcpSockets.remove(id)
                    }
                    tcpSockets[socketId] = handler

                    // Send TCP_ACCEPT
                    // Payload: serverId(4), socketId(4), remotePort(2), remoteAddr(string)
                    val addrBytes = peerAddr.toByteArray()
                    val payload = serverId.toLEBytes() +
                        socketId.toLEBytes() +
                        peerPort.toShort().toLEBytes() +
                        addrBytes
                    session.send(Protocol.createMessage(Protocol.OP_TCP_ACCEPT, 0, payload))

                    // Start reading and sending
                    handler.startReading()
                    handler.startSending()
                }
            } catch (e: IOException) {
                Log.d(TAG, "TCP server $serverId accept ended: ${e.message}")
            }
        }
    }

    fun close() {
        scope.cancel()
        try {
            serverSocket.close()
        } catch (e: Exception) {}

        // Note: We don't close accepted connections here because they're
        // tracked in the session's tcpSockets map and will be cleaned up
        // when the session closes. Closing them here would cause double-close.
    }
}

class TcpSocketHandler(
    private val socketId: Int,
    private val socket: Socket,
    private val session: SocketSession,
    private val onClosed: (Int) -> Unit = {}  // Callback to remove from map when peer closes
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    // Dedicated send queue for ordered, batched writes
    private val sendQueue = Channel<ByteArray>(100)
    private var senderJob: Job? = null

    companion object {
        private const val PERF_TAG = "JSTorrent.Perf"
        // Set to true to enable detailed timing logs
        private const val ENABLE_PERF_LOGGING = false
        // Log interval: only log every N reads to reduce log spam
        private const val LOG_INTERVAL = 100
    }

    fun startReading() {
        scope.launch {
            val buffer = ByteArray(128 * 1024) // 128KB - optimal based on benchmarks
            var readCount = 0L
            var totalBytesRead = 0L
            val startTime = System.nanoTime()

            try {
                val input = socket.getInputStream()
                while (true) {
                    val t0 = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    val bytesRead = try {
                        input.read(buffer)
                    } catch (e: java.net.SocketTimeoutException) {
                        // Read timeout - connection may still be alive but idle
                        // For BitTorrent, idle connections are normal (peer has no data to send)
                        // Check if scope is still active, then keep waiting
                        if (!scope.isActive) break
                        continue
                    }
                    if (bytesRead < 0) break

                    val tRead = if (ENABLE_PERF_LOGGING) System.nanoTime() else 0L

                    // Build TCP_RECV frame with minimal allocations
                    // Frame structure: [header:8][socketId:4][data:bytesRead]
                    val frameSize = 8 + 4 + bytesRead
                    val frame = ByteArray(frameSize)

                    // Write header directly
                    frame[0] = Protocol.VERSION
                    frame[1] = Protocol.OP_TCP_RECV
                    // flags = 0 (bytes 2-3 already zero)
                    // requestId = 0 (bytes 4-7 already zero)

                    // Write socketId (little-endian)
                    frame[8] = (socketId and 0xFF).toByte()
                    frame[9] = ((socketId shr 8) and 0xFF).toByte()
                    frame[10] = ((socketId shr 16) and 0xFF).toByte()
                    frame[11] = ((socketId shr 24) and 0xFF).toByte()

                    // Copy data
                    System.arraycopy(buffer, 0, frame, 12, bytesRead)

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
                // Notify engine that socket closed
                sendClose()
                // Clean up handler and remove from session's map
                // This prevents queue buildup when engine sends to closed socket
                close()
                onClosed(socketId)
            }
        }
    }

    fun startSending() {
        senderJob = scope.launch {
            try {
                val output = socket.getOutputStream().buffered(64 * 1024)
                var pendingBytes = 0

                for (data in sendQueue) {
                    output.write(data)
                    pendingBytes += data.size

                    // Flush when queue is empty, accumulated enough, or small control message
                    // Small messages (<1KB) are likely protocol control (handshake, interested,
                    // unchoke, have, request) and must be sent immediately for peers to respond
                    if (sendQueue.isEmpty || pendingBytes >= 32 * 1024 || data.size < 1024) {
                        output.flush()
                        pendingBytes = 0
                    }
                }
                // Final flush
                output.flush()
            } catch (e: IOException) {
                Log.d(TAG, "TCP socket $socketId send ended: ${e.message}")
            }
        }
    }

    fun send(data: ByteArray) {
        // Non-blocking enqueue - will drop if queue full (connection overwhelmed)
        val result = sendQueue.trySend(data)
        if (result.isFailure) {
            Log.w(TAG, "TCP socket $socketId send queue full, dropping")
        }
    }

    fun close() {
        sendQueue.close()
        senderJob?.cancel()
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }

    private fun sendClose() {
        try {
            val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
            session.send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, payload))
        } catch (e: Exception) {
            // Session may already be closed - that's fine
            Log.d(TAG, "Could not send TCP_CLOSE for socket $socketId: ${e.message}")
        }
    }
}

class UdpSocketHandler(
    private val socketId: Int,
    private val socket: MulticastSocket,
    private val session: SocketSession
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val sendQueue = Channel<Triple<String, Int, ByteArray>>(100)
    private var senderJob: Job? = null

    init {
        // Set socket timeout to detect idle connections
        socket.soTimeout = 60_000 // 60 seconds
    }

    @Suppress("DEPRECATION")
    fun joinMulticast(group: InetAddress) {
        socket.joinGroup(group)
    }

    @Suppress("DEPRECATION")
    fun leaveMulticast(group: InetAddress) {
        socket.leaveGroup(group)
    }

    fun startReceiving() {
        scope.launch {
            val buffer = ByteArray(65535)
            val packet = DatagramPacket(buffer, buffer.size)

            try {
                while (true) {
                    try {
                        socket.receive(packet)
                    } catch (e: java.net.SocketTimeoutException) {
                        // Timeout is normal for UDP - just keep waiting
                        // Check if we should stop
                        if (!scope.isActive) break
                        continue
                    }

                    val srcAddr = packet.address.hostAddress ?: continue
                    val srcPort = packet.port
                    val data = packet.data.copyOf(packet.length)

                    Log.d(TAG, "UDP_RECV: socketId=$socketId, from=$srcAddr:$srcPort, ${data.size} bytes")

                    // Build UDP_RECV payload with minimal allocations
                    val addrBytes = srcAddr.toByteArray()
                    val payloadSize = 4 + 2 + 2 + addrBytes.size + data.size
                    val payload = ByteArray(payloadSize)
                    var offset = 0

                    // socketId (4 bytes, little-endian)
                    payload[offset++] = (socketId and 0xFF).toByte()
                    payload[offset++] = ((socketId shr 8) and 0xFF).toByte()
                    payload[offset++] = ((socketId shr 16) and 0xFF).toByte()
                    payload[offset++] = ((socketId shr 24) and 0xFF).toByte()

                    // srcPort (2 bytes, little-endian)
                    payload[offset++] = (srcPort and 0xFF).toByte()
                    payload[offset++] = ((srcPort shr 8) and 0xFF).toByte()

                    // addrLen (2 bytes, little-endian)
                    payload[offset++] = (addrBytes.size and 0xFF).toByte()
                    payload[offset++] = ((addrBytes.size shr 8) and 0xFF).toByte()

                    // addr + data
                    System.arraycopy(addrBytes, 0, payload, offset, addrBytes.size)
                    offset += addrBytes.size
                    System.arraycopy(data, 0, payload, offset, data.size)

                    session.send(Protocol.createMessage(Protocol.OP_UDP_RECV, 0, payload))
                }
            } catch (e: Exception) {
                Log.d(TAG, "UDP socket $socketId receive ended: ${e.message}")
            } finally {
                sendClose()
            }
        }
    }

    fun startSending() {
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
                    } catch (e: Exception) {
                        // Log but continue - don't let one bad address kill the sender
                        // This happens with unresolvable tracker hostnames
                        Log.w(TAG, "UDP socket $socketId send to $destAddr:$destPort failed: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.d(TAG, "UDP socket $socketId send ended: ${e.message}")
            }
        }
    }

    fun send(destAddr: String, destPort: Int, data: ByteArray) {
        val result = sendQueue.trySend(Triple(destAddr, destPort, data))
        if (result.isFailure) {
            Log.w(TAG, "UDP socket $socketId send queue full, dropping")
        }
    }

    fun close() {
        sendQueue.close()
        senderJob?.cancel()
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }

    private fun sendClose() {
        try {
            val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
            session.send(Protocol.createMessage(Protocol.OP_UDP_CLOSE, 0, payload))
        } catch (e: Exception) {
            // Session may already be closed - that's fine
            Log.d(TAG, "Could not send UDP_CLOSE for socket $socketId: ${e.message}")
        }
    }
}
