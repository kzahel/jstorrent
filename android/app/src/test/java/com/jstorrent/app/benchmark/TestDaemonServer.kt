package com.jstorrent.app.benchmark

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.io.Closeable
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Standalone JVM WebSocket server that mimics the Android io-daemon protocol.
 * Used for benchmarking without Android dependencies.
 *
 * Implements:
 * - CLIENT_HELLO / SERVER_HELLO handshake
 * - AUTH / AUTH_RESULT authentication
 * - TCP_CONNECT / TCP_CONNECTED
 * - TCP_RECV (data from TCP → WebSocket)
 * - TCP_CLOSE
 */
class TestDaemonServer(
    port: Int = 0,
    private val authToken: String = "test-token",
    private val tcpReadBufferSize: Int = 64 * 1024
) : Closeable {

    private val server: WebSocketServer
    private val startLatch = CountDownLatch(1)
    private val executor = Executors.newCachedThreadPool()

    val port: Int get() = server.port
    val uri: String get() = "ws://localhost:$port"

    // Stats
    val totalBytesRelayed = AtomicLong(0)
    val totalFramesSent = AtomicLong(0)

    init {
        server = object : WebSocketServer(InetSocketAddress(port)) {
            private val sessions = ConcurrentHashMap<WebSocket, DaemonSession>()

            override fun onStart() {
                startLatch.countDown()
            }

            override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
                sessions[conn] = DaemonSession(conn, authToken, executor, tcpReadBufferSize,
                    totalBytesRelayed, totalFramesSent)
            }

            override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
                sessions.remove(conn)?.close()
            }

            override fun onMessage(conn: WebSocket, message: ByteBuffer) {
                val data = ByteArray(message.remaining())
                message.get(data)
                sessions[conn]?.handleMessage(data)
            }

            override fun onMessage(conn: WebSocket, message: String) {
                // Text messages not used
            }

            override fun onError(conn: WebSocket?, ex: Exception) {
                ex.printStackTrace()
            }
        }
    }

    fun start(timeoutMs: Long = 5000) {
        server.start()
        if (!startLatch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            throw Exception("Server failed to start within ${timeoutMs}ms")
        }
    }

    override fun close() {
        try {
            server.stop(1000)
        } catch (_: Exception) {}
        executor.shutdownNow()
    }
}

/**
 * Per-connection session state.
 */
private class DaemonSession(
    private val ws: WebSocket,
    private val expectedToken: String,
    private val executor: java.util.concurrent.ExecutorService,
    private val tcpReadBufferSize: Int,
    private val totalBytesRelayed: AtomicLong,
    private val totalFramesSent: AtomicLong
) : Closeable {

    private var authenticated = false
    private val tcpSockets = ConcurrentHashMap<Int, TcpBridge>()

    fun handleMessage(data: ByteArray) {
        if (data.size < 8) return

        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val version = buf.get().toInt() and 0xFF
        val opcode = buf.get().toInt() and 0xFF
        val flags = buf.short.toInt()
        val requestId = buf.int
        val payload = data.copyOfRange(8, data.size)

        if (version != 1) {
            sendError(requestId, "Invalid version")
            return
        }

        if (!authenticated) {
            handlePreAuth(opcode, requestId, payload)
        } else {
            handlePostAuth(opcode, requestId, payload)
        }
    }

    private fun handlePreAuth(opcode: Int, requestId: Int, payload: ByteArray) {
        when (opcode) {
            Protocol.CLIENT_HELLO -> {
                send(Protocol.createFrame(Protocol.SERVER_HELLO, requestId))
            }
            Protocol.AUTH -> {
                if (payload.isEmpty()) {
                    sendAuthResult(requestId, false)
                    return
                }
                val authType = payload[0].toInt()
                val token = String(payload, 1, payload.size - 1, Charsets.UTF_8)

                if (token == expectedToken) {
                    authenticated = true
                    sendAuthResult(requestId, true)
                } else {
                    sendAuthResult(requestId, false)
                }
            }
            else -> {
                sendError(requestId, "Not authenticated")
            }
        }
    }

    private fun handlePostAuth(opcode: Int, requestId: Int, payload: ByteArray) {
        when (opcode) {
            Protocol.TCP_CONNECT -> handleTcpConnect(requestId, payload)
            Protocol.TCP_CLOSE -> handleTcpClose(payload)
        }
    }

    private fun handleTcpConnect(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return

        val buf = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN)
        val socketId = buf.int
        val port = buf.short.toInt() and 0xFFFF
        val hostname = String(payload, 6, payload.size - 6, Charsets.UTF_8)

        executor.submit {
            try {
                val socket = Socket()
                socket.tcpNoDelay = true
                socket.receiveBufferSize = 256 * 1024
                socket.connect(InetSocketAddress(hostname, port), 30000)

                val bridge = TcpBridge(socketId, socket, this, tcpReadBufferSize,
                    totalBytesRelayed, totalFramesSent)
                tcpSockets[socketId] = bridge

                // Send TCP_CONNECTED success: [socketId:4][status:1][errno:4]
                val response = ByteBuffer.allocate(9).order(ByteOrder.LITTLE_ENDIAN)
                response.putInt(socketId)
                response.put(0) // success
                response.putInt(0) // errno
                send(Protocol.createFrame(Protocol.TCP_CONNECTED, requestId, response.array()))

                // Start reading
                bridge.startReading(executor)

            } catch (e: Exception) {
                // Send TCP_CONNECTED failure
                val response = ByteBuffer.allocate(9).order(ByteOrder.LITTLE_ENDIAN)
                response.putInt(socketId)
                response.put(1) // failure
                response.putInt(1) // errno
                send(Protocol.createFrame(Protocol.TCP_CONNECTED, requestId, response.array()))
            }
        }
    }

    private fun handleTcpClose(payload: ByteArray) {
        if (payload.size < 4) return
        val socketId = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).int
        tcpSockets.remove(socketId)?.close()
    }

    fun send(data: ByteArray) {
        try {
            ws.send(data)
        } catch (_: Exception) {}
    }

    private fun sendError(requestId: Int, message: String) {
        send(Protocol.createFrame(Protocol.ERROR, requestId, message.toByteArray()))
    }

    private fun sendAuthResult(requestId: Int, success: Boolean) {
        val status = if (success) 0.toByte() else 1.toByte()
        send(Protocol.createFrame(Protocol.AUTH_RESULT, requestId, byteArrayOf(status)))
    }

    fun sendTcpClose(socketId: Int) {
        val payload = ByteBuffer.allocate(9).order(ByteOrder.LITTLE_ENDIAN)
        payload.putInt(socketId)
        payload.put(0) // reason
        payload.putInt(0) // errno
        send(Protocol.createFrame(Protocol.TCP_CLOSE, 0, payload.array()))
    }

    override fun close() {
        tcpSockets.values.forEach { it.close() }
        tcpSockets.clear()
    }
}

/**
 * Bridges a TCP socket to WebSocket TCP_RECV frames.
 */
private class TcpBridge(
    private val socketId: Int,
    private val socket: Socket,
    private val session: DaemonSession,
    private val bufferSize: Int,
    private val totalBytesRelayed: AtomicLong,
    private val totalFramesSent: AtomicLong
) : Closeable {

    @Volatile
    private var running = true

    fun startReading(executor: java.util.concurrent.ExecutorService) {
        executor.submit {
            val buffer = ByteArray(bufferSize)
            try {
                val input = socket.getInputStream()
                while (running) {
                    val bytesRead = input.read(buffer)
                    if (bytesRead < 0) break

                    // Build TCP_RECV: [socketId:4][data...]
                    val payload = ByteBuffer.allocate(4 + bytesRead).order(ByteOrder.LITTLE_ENDIAN)
                    payload.putInt(socketId)
                    payload.put(buffer, 0, bytesRead)

                    session.send(Protocol.createFrame(Protocol.TCP_RECV, 0, payload.array()))

                    totalBytesRelayed.addAndGet(bytesRead.toLong())
                    totalFramesSent.incrementAndGet()
                }
            } catch (e: IOException) {
                // Socket closed
            } finally {
                session.sendTcpClose(socketId)
            }
        }
    }

    override fun close() {
        running = false
        try {
            socket.close()
        } catch (_: Exception) {}
    }
}
