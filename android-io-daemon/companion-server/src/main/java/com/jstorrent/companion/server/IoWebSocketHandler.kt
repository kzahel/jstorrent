@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.jstorrent.companion.server

import android.util.Log
import com.jstorrent.io.protocol.Protocol
import com.jstorrent.io.protocol.getUIntLE
import com.jstorrent.io.protocol.getUShortLE
import com.jstorrent.io.protocol.toLEBytes
import com.jstorrent.io.socket.TcpServerCallback
import com.jstorrent.io.socket.TcpSocketCallback
import com.jstorrent.io.socket.TcpSocketService
import com.jstorrent.io.socket.UdpSocketCallback
import com.jstorrent.io.socket.UdpSocketManagerImpl
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "IoWebSocketHandler"

/**
 * WebSocket handler for I/O operations (TCP/UDP sockets).
 *
 * This handler implements io-core callback interfaces and translates
 * socket events into WebSocket protocol messages. It uses io-core's
 * TcpSocketService and UdpSocketManagerImpl for actual socket operations.
 *
 * Per-session lifecycle:
 * 1. Created when WebSocket connects
 * 2. Runs authentication handshake
 * 3. Dispatches socket operations to io-core managers
 * 4. Receives callbacks and sends WS frames
 * 5. Cleans up when WebSocket disconnects
 */
class IoWebSocketHandler(
    private val wsSession: DefaultWebSocketServerSession,
    private val deps: CompanionServerDeps,
    private val onControlSessionRegistered: (IoWebSocketHandler) -> Unit = {},
    private val onControlSessionUnregistered: (IoWebSocketHandler) -> Unit = {}
) : TcpSocketCallback, UdpSocketCallback, TcpServerCallback {

    private var authenticated = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Socket managers - created per session, share global semaphore
    private val tcpService = SocketManagerFactory.createTcpService(scope)
    private val udpManager = SocketManagerFactory.createUdpManager(scope)

    // RequestId tracking for async responses
    private val tcpConnectRequests = ConcurrentHashMap<Int, Int>() // socketId → requestId
    private val tcpSecureRequests = ConcurrentHashMap<Int, Int>()  // socketId → requestId
    private val tcpListenRequests = ConcurrentHashMap<Int, Int>()  // serverId → requestId
    private val udpBindRequests = ConcurrentHashMap<Int, Int>()    // socketId → requestId

    // Outgoing message queue - large buffer for high throughput
    // At 65KB frames, 2000 frames = ~130MB buffer capacity
    private val outgoing = Channel<ByteArray>(2000)

    // Expose the WebSocket session for external close (e.g., unpair)
    val webSocketSession: DefaultWebSocketServerSession get() = wsSession

    // Session statistics
    private val dropCount = AtomicLong(0)
    private val queueDepth = AtomicInteger(0)
    private val bytesReceived = AtomicLong(0)
    private val bytesSent = AtomicLong(0)
    private val framesReceived = AtomicLong(0)
    private val framesSent = AtomicLong(0)
    private val connectTime = System.currentTimeMillis()

    companion object {
        private const val ENABLE_SEND_LOGGING = true
    }

    init {
        // Register this handler as callback for all io-core managers
        // Explicit casts needed to resolve overload ambiguity
        tcpService.setCallback(this as TcpSocketCallback)
        tcpService.setCallback(this as TcpServerCallback)
        udpManager.setCallback(this)
    }

    // ==========================================================================
    // Main run loop
    // ==========================================================================

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

    // ==========================================================================
    // Message handling
    // ==========================================================================

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

        // Validate opcode is allowed for IO endpoint
        if (envelope.opcode !in Protocol.IO_OPCODES) {
            Log.w(TAG, "Opcode 0x${envelope.opcode.toString(16)} not allowed on IO endpoint")
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

                // For extension auth, also verify pairing
                val isExtensionAuth = deps.tokenStore.token != null &&
                    token == deps.tokenStore.token &&
                    deps.tokenStore.isPairedWith(extensionId, installId)
                // For standalone mode, just the standalone token is enough
                val isStandaloneAuth = token == deps.tokenStore.standaloneToken

                if (isExtensionAuth || isStandaloneAuth) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    val authTypeStr = if (isStandaloneAuth) "standalone" else "extension"
                    Log.i(TAG, "WebSocket authenticated ($authTypeStr, IO)")
                } else {
                    val errorMsg = "Invalid credentials".toByteArray()
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(1) + errorMsg))
                    Log.w(TAG, "WebSocket auth failed: extensionAuth=$isExtensionAuth, standaloneAuth=$isStandaloneAuth")
                }
            }
            else -> {
                sendError(envelope.requestId, "Not authenticated")
            }
        }
    }

    private fun handlePostAuth(envelope: Protocol.Envelope, payload: ByteArray) {
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

    // ==========================================================================
    // TCP handlers - delegate to io-core
    // ==========================================================================

    private fun handleTcpConnect(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val hostname = String(payload, 6, payload.size - 6)

        Log.d(TAG, "TCP_CONNECT: socketId=$socketId, $hostname:$port")

        // Track requestId for response
        tcpConnectRequests[socketId] = requestId

        // Delegate to io-core
        tcpService.connect(socketId, hostname, port)
    }

    private fun handleTcpSend(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val data = payload.copyOfRange(4, payload.size)

        Log.d(TAG, "TCP_SEND: socketId=$socketId, ${data.size} bytes")

        // Activate and send - TcpSocketService handles pending sockets
        tcpService.activate(socketId)
        tcpService.send(socketId, data)
    }

    private fun handleTcpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        Log.d(TAG, "TCP_CLOSE: socketId=$socketId")

        // Clean up request tracking
        tcpConnectRequests.remove(socketId)
        tcpSecureRequests.remove(socketId)

        tcpService.close(socketId)
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

        // Track requestId for response
        tcpSecureRequests[socketId] = requestId

        tcpService.secure(socketId, hostname, skipValidation)
    }

    private fun handleTcpListen(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val serverId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)

        Log.d(TAG, "TCP_LISTEN: serverId=$serverId, port=$port")

        // Track requestId for response
        tcpListenRequests[serverId] = requestId

        tcpService.listen(serverId, port)
    }

    private fun handleTcpStopListen(payload: ByteArray) {
        if (payload.size < 4) return

        val serverId = payload.getUIntLE(0)
        Log.d(TAG, "TCP_STOP_LISTEN: serverId=$serverId")

        tcpListenRequests.remove(serverId)
        tcpService.stopListen(serverId)
    }

    // ==========================================================================
    // UDP handlers - delegate to io-core
    // ==========================================================================

    private fun handleUdpBind(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)

        Log.d(TAG, "UDP_BIND: socketId=$socketId, port=$port")

        // Track requestId for response
        udpBindRequests[socketId] = requestId

        udpManager.bind(socketId, port)
    }

    private fun handleUdpSend(payload: ByteArray) {
        if (payload.size < 8) return

        val socketId = payload.getUIntLE(0)
        val destPort = payload.getUShortLE(4)
        val addrLen = payload.getUShortLE(6)

        if (payload.size < 8 + addrLen) return

        val destAddr = String(payload, 8, addrLen)
        val data = payload.copyOfRange(8 + addrLen, payload.size)

        udpManager.send(socketId, destAddr, destPort, data)
    }

    private fun handleUdpClose(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        udpBindRequests.remove(socketId)
        udpManager.close(socketId)
    }

    private fun handleUdpJoinMulticast(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val groupAddr = String(payload, 4, payload.size - 4)

        Log.d(TAG, "UDP_JOIN_MULTICAST: socketId=$socketId, group=$groupAddr")
        udpManager.joinMulticast(socketId, groupAddr)
    }

    private fun handleUdpLeaveMulticast(payload: ByteArray) {
        if (payload.size < 4) return

        val socketId = payload.getUIntLE(0)
        val groupAddr = String(payload, 4, payload.size - 4)

        Log.d(TAG, "UDP_LEAVE_MULTICAST: socketId=$socketId, group=$groupAddr")
        udpManager.leaveMulticast(socketId, groupAddr)
    }

    // ==========================================================================
    // TcpSocketCallback implementation - translate io-core events to WS frames
    // ==========================================================================

    override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
        val requestId = tcpConnectRequests.remove(socketId) ?: 0
        Log.i(TAG, "TCP_CONNECTED: socketId=$socketId, success=$success, errorCode=$errorCode")

        val response = socketId.toLEBytes() +
            byteArrayOf(if (success) 0 else 1) +
            errorCode.toLEBytes()
        send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))

        // Don't auto-activate here - leave socket in pending state.
        // This allows TLS upgrade via TCP_SECURE before activation.
        // Socket will be activated on first send() or explicit activate().
    }

    override fun onTcpData(socketId: Int, data: ByteArray) {
        // Build TCP_RECV frame with minimal allocations
        // Frame structure: [header:8][socketId:4][data:N]
        val frameSize = 8 + 4 + data.size
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
        System.arraycopy(data, 0, frame, 12, data.size)

        send(frame)
    }

    override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
        Log.d(TAG, "TCP_CLOSE: socketId=$socketId, hadError=$hadError, errorCode=$errorCode")

        val payload = socketId.toLEBytes() +
            byteArrayOf(if (hadError) 1 else 0) +
            errorCode.toLEBytes()
        send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, payload))
    }

    override fun onTcpSecured(socketId: Int, success: Boolean) {
        val requestId = tcpSecureRequests.remove(socketId) ?: 0
        Log.i(TAG, "TCP_SECURED: socketId=$socketId, success=$success")

        val response = socketId.toLEBytes() + byteArrayOf(if (success) 0 else 1)
        send(Protocol.createMessage(Protocol.OP_TCP_SECURED, requestId, response))

        // Auto-activate on success
        if (success) {
            tcpService.activate(socketId)
        }
    }

    // ==========================================================================
    // TcpServerCallback implementation
    // ==========================================================================

    override fun onTcpListenResult(serverId: Int, success: Boolean, boundPort: Int, errorCode: Int) {
        val requestId = tcpListenRequests.remove(serverId) ?: 0
        Log.i(TAG, "TCP_LISTEN_RESULT: serverId=$serverId, success=$success, boundPort=$boundPort")

        val response = serverId.toLEBytes() +
            byteArrayOf(if (success) 0 else 1) +
            boundPort.toShort().toLEBytes() +
            errorCode.toLEBytes()
        send(Protocol.createMessage(Protocol.OP_TCP_LISTEN_RESULT, requestId, response))
    }

    override fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int) {
        Log.d(TAG, "TCP_ACCEPT: serverId=$serverId, socketId=$socketId, peer=$peerAddr:$peerPort")

        val addrBytes = peerAddr.toByteArray()
        val payload = serverId.toLEBytes() +
            socketId.toLEBytes() +
            peerPort.toShort().toLEBytes() +
            addrBytes
        send(Protocol.createMessage(Protocol.OP_TCP_ACCEPT, 0, payload))
    }

    // ==========================================================================
    // UdpSocketCallback implementation
    // ==========================================================================

    override fun onUdpBound(socketId: Int, success: Boolean, boundPort: Int, errorCode: Int) {
        val requestId = udpBindRequests.remove(socketId) ?: 0
        Log.i(TAG, "UDP_BOUND: socketId=$socketId, success=$success, boundPort=$boundPort")

        val response = socketId.toLEBytes() +
            byteArrayOf(if (success) 0 else 1) +
            boundPort.toShort().toLEBytes() +
            errorCode.toLEBytes()
        send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))
    }

    override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
        Log.d(TAG, "UDP_RECV: socketId=$socketId, from=$srcAddr:$srcPort, ${data.size} bytes")

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

        send(Protocol.createMessage(Protocol.OP_UDP_RECV, 0, payload))
    }

    override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
        Log.d(TAG, "UDP_CLOSE: socketId=$socketId, hadError=$hadError, errorCode=$errorCode")

        val payload = socketId.toLEBytes() +
            byteArrayOf(if (hadError) 1 else 0) +
            errorCode.toLEBytes()
        send(Protocol.createMessage(Protocol.OP_UDP_CLOSE, 0, payload))
    }

    // ==========================================================================
    // Send helpers
    // ==========================================================================

    internal fun send(data: ByteArray) {
        framesSent.incrementAndGet()
        bytesSent.addAndGet(data.size.toLong())

        if (data.size >= 8 && ENABLE_SEND_LOGGING) {
            val envelope = Protocol.Envelope.fromBytes(data)
            if (envelope != null) {
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

    // ==========================================================================
    // Cleanup
    // ==========================================================================

    private fun cleanup() {
        // Log session statistics
        val duration = (System.currentTimeMillis() - connectTime) / 1000.0
        val recvMB = bytesReceived.get() / 1024.0 / 1024.0
        val sentMB = bytesSent.get() / 1024.0 / 1024.0
        Log.i(TAG, "Session closed after ${String.format("%.1f", duration)}s: " +
            "recv=${String.format("%.1f", recvMB)}MB/${framesReceived.get()} frames, " +
            "sent=${String.format("%.1f", sentMB)}MB/${framesSent.get()} frames, " +
            "dropped=${dropCount.get()}")

        // Clean up request tracking
        tcpConnectRequests.clear()
        tcpSecureRequests.clear()
        tcpListenRequests.clear()
        udpBindRequests.clear()

        // Shutdown io-core managers
        tcpService.shutdown()
        udpManager.shutdown()

        scope.cancel()
        outgoing.close()
    }
}
