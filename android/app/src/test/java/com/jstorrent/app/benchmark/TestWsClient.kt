package com.jstorrent.app.benchmark

import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.io.Closeable
import java.net.URI
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * A minimal WebSocket client for testing the binary protocol.
 *
 * @param uri WebSocket URI (e.g., "ws://localhost:7800/io")
 */
class TestWsClient(uri: String) : Closeable {

    private val receiveQueue = LinkedBlockingQueue<ByteArray>()
    private val connectLatch = CountDownLatch(1)

    @Volatile
    private var connectError: Exception? = null

    @Volatile
    var isConnected: Boolean = false
        private set

    private val client = object : WebSocketClient(URI(uri)) {
        override fun onOpen(handshakedata: ServerHandshake?) {
            isConnected = true
            connectLatch.countDown()
        }

        override fun onMessage(message: String?) {
            // Text messages not expected in this protocol
        }

        override fun onMessage(bytes: ByteBuffer?) {
            bytes?.let {
                val data = ByteArray(it.remaining())
                it.get(data)
                receiveQueue.offer(data)
            }
        }

        override fun onClose(code: Int, reason: String?, remote: Boolean) {
            isConnected = false
            connectLatch.countDown()
        }

        override fun onError(ex: Exception?) {
            connectError = ex
            isConnected = false
            connectLatch.countDown()
        }
    }

    /**
     * Connect to the WebSocket server.
     * @param timeoutMs Maximum time to wait for connection
     * @throws Exception if connection fails
     */
    fun connect(timeoutMs: Long = 5000) {
        client.connect()
        if (!connectLatch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            throw Exception("Connection timeout")
        }
        connectError?.let { throw it }
        if (!isConnected) {
            throw Exception("Connection failed")
        }
    }

    /**
     * Send a protocol frame.
     */
    fun sendFrame(opcode: Int, requestId: Int, payload: ByteArray = ByteArray(0)) {
        val frame = Protocol.createFrame(opcode, requestId, payload)
        client.send(frame)
    }

    /**
     * Receive a protocol frame with timeout.
     * @return Parsed frame or null if timeout
     */
    fun receiveFrame(timeoutMs: Long = 5000): ReceivedFrame? {
        val data = receiveQueue.poll(timeoutMs, TimeUnit.MILLISECONDS) ?: return null
        return ReceivedFrame.parse(data)
    }

    /**
     * Drain all pending frames from the queue without blocking.
     */
    fun drainFrames(): List<ReceivedFrame> {
        val frames = mutableListOf<ReceivedFrame>()
        while (true) {
            val data = receiveQueue.poll() ?: break
            ReceivedFrame.parse(data)?.let { frames.add(it) }
        }
        return frames
    }

    /**
     * Get the number of frames waiting in the queue.
     */
    fun pendingFrameCount(): Int = receiveQueue.size

    override fun close() {
        try {
            client.closeBlocking()
        } catch (_: Exception) {}
    }
}
