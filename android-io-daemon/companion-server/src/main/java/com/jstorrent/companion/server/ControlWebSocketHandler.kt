@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.jstorrent.companion.server

import android.util.Log
import com.jstorrent.io.protocol.Protocol
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "ControlWebSocketHandler"

/**
 * WebSocket handler for control plane operations.
 *
 * This handler manages:
 * - Authentication handshake
 * - Control plane broadcasts (ROOTS_CHANGED, EVENT)
 * - Folder picker requests (OP_CTRL_OPEN_FOLDER_PICKER)
 *
 * Unlike IoWebSocketHandler, this doesn't manage sockets - it's for
 * out-of-band communication between extension and daemon.
 */
class ControlWebSocketHandler(
    private val wsSession: DefaultWebSocketServerSession,
    private val deps: CompanionServerDeps,
    private val onSessionRegistered: (ControlWebSocketHandler) -> Unit,
    private val onSessionUnregistered: (ControlWebSocketHandler) -> Unit
) {
    private var authenticated = false
    private var isExtensionAuth = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Outgoing message queue
    private val outgoing = Channel<ByteArray>(100)

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

    // ==========================================================================
    // Main run loop
    // ==========================================================================

    suspend fun run() {
        // Start sender coroutine
        val senderJob = scope.launch {
            try {
                for (data in outgoing) {
                    queueDepth.decrementAndGet()
                    wsSession.send(Frame.Binary(true, data))
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

        // Validate opcode is allowed for CONTROL endpoint
        if (envelope.opcode !in Protocol.CONTROL_OPCODES) {
            Log.w(TAG, "Opcode 0x${envelope.opcode.toString(16)} not allowed on CONTROL endpoint")
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
                isExtensionAuth = deps.tokenStore.token != null &&
                    token == deps.tokenStore.token &&
                    deps.tokenStore.isPairedWith(extensionId, installId)
                // For standalone mode, just the standalone token is enough
                val isStandaloneAuth = token == deps.tokenStore.standaloneToken

                if (isExtensionAuth || isStandaloneAuth) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    val authTypeStr = if (isStandaloneAuth) "standalone" else "extension"
                    Log.i(TAG, "WebSocket authenticated ($authTypeStr, CONTROL)")

                    // Register for broadcasts
                    onSessionRegistered(this)

                    // Extension-only: notify for intent handling (pending magnet links)
                    if (isExtensionAuth) {
                        deps.notifyConnectionEstablished()
                    }
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
            Protocol.OP_CTRL_OPEN_FOLDER_PICKER -> {
                deps.openFolderPicker()
            }
            else -> {
                sendError(envelope.requestId, "Unknown opcode: ${envelope.opcode}")
            }
        }
    }

    // ==========================================================================
    // Send helpers
    // ==========================================================================

    internal fun send(data: ByteArray) {
        framesSent.incrementAndGet()
        bytesSent.addAndGet(data.size.toLong())

        val result = outgoing.trySend(data)
        if (result.isSuccess) {
            queueDepth.incrementAndGet()
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
        val duration = (System.currentTimeMillis() - connectTime) / 1000.0
        Log.i(TAG, "Session closed after ${String.format("%.1f", duration)}s: " +
            "recv=${framesReceived.get()} frames, sent=${framesSent.get()} frames")

        onSessionUnregistered(this)
        scope.cancel()
        outgoing.close()
    }
}
