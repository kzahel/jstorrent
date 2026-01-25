@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.jstorrent.io.socket

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import java.io.IOException
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Internal handler for a single TCP connection.
 *
 * Manages read and write loops for a connected socket. Data received
 * is delivered via callback; data sent is queued for batched transmission.
 *
 * @param socketId Unique identifier for this socket
 * @param socket The underlying connected socket
 * @param scope CoroutineScope for I/O operations
 * @param onData Callback when data is received
 * @param onClose Callback when socket closes (hadError, errorCode)
 */
internal class TcpConnection(
    val socketId: Int,
    private var socket: Socket,
    private val scope: CoroutineScope,
    private val onData: (ByteArray) -> Unit,
    private val onClose: (Boolean, Int) -> Unit
) {
    // Dedicated send queue for ordered, batched writes
    private val sendQueue = Channel<ByteArray>(100)
    private var senderJob: Job? = null
    private var readerJob: Job? = null
    private var isActive = false

    companion object {
        private const val READ_BUFFER_SIZE = 128 * 1024 // 128KB per read
        private const val WRITE_BUFFER_SIZE = 64 * 1024 // 64KB buffered output
        private const val FLUSH_THRESHOLD = 32 * 1024   // Flush when accumulated >= 32KB
        private const val SMALL_MESSAGE_SIZE = 1024     // Flush immediately for small control messages

        // Batching parameters for high-throughput peers
        private const val BATCH_MAX_SIZE = 1024 * 1024  // 1MB max batch
        private const val BATCH_MAX_TIME_MS = 100       // 100ms max batch window
        private const val BATCH_READ_TIMEOUT_MS = 20    // 20ms timeout between reads in batch
    }

    /**
     * Activate the connection to start I/O loops.
     *
     * Must be called after connection is established (and optionally after TLS upgrade).
     */
    fun activate() {
        if (isActive) return
        isActive = true
        startReading()
        startSending()
    }

    /**
     * Replace the underlying socket.
     *
     * Used for TLS upgrade - must be called before [activate].
     */
    fun replaceSocket(newSocket: Socket) {
        require(!isActive) { "Cannot replace socket on active connection" }
        socket = newSocket
    }

    /**
     * Queue data for transmission.
     *
     * Non-blocking enqueue - will drop if queue full (connection overwhelmed).
     */
    fun send(data: ByteArray) {
        val result = sendQueue.trySend(data)
        if (result.isFailure) {
            // Queue full - connection can't keep up
            // Logged at caller level if needed
        }
    }

    /**
     * Close the connection.
     *
     * Stops I/O loops and closes the underlying socket.
     * Uses shutdownInput/Output to immediately unblock any pending I/O
     * before closing, preventing socket.close() from blocking.
     */
    fun close() {
        isActive = false
        sendQueue.close()
        senderJob?.cancel()
        readerJob?.cancel()
        try {
            // Shutdown streams first to unblock any pending I/O operations.
            // This prevents socket.close() from blocking on read/write completion.
            if (!socket.isInputShutdown) {
                socket.shutdownInput()
            }
            if (!socket.isOutputShutdown) {
                socket.shutdownOutput()
            }
            socket.close()
        } catch (_: Exception) {}
    }

    private fun startReading() {
        readerJob = scope.launch {
            val buffer = ByteArray(READ_BUFFER_SIZE)
            var totalBytesRead = 0L

            try {
                val input = socket.getInputStream()
                val originalTimeout = socket.soTimeout

                while (isActive) {
                    // First read - blocks until data arrives (with original SO_TIMEOUT)
                    socket.soTimeout = originalTimeout
                    val bytesRead = try {
                        input.read(buffer)
                    } catch (_: SocketTimeoutException) {
                        // Read timeout - connection may still be alive but idle
                        // For BitTorrent, idle connections are normal (peer has no data to send)
                        if (!scope.isActive) break
                        continue
                    }
                    if (bytesRead < 0) break

                    totalBytesRead += bytesRead

                    // Check if this is a small read (control message) - deliver immediately
                    if (bytesRead < SMALL_MESSAGE_SIZE) {
                        val data = buffer.copyOf(bytesRead)
                        onData(data)
                        continue
                    }

                    // For larger reads, try to batch with subsequent data
                    // Use short blocking timeout to let data accumulate from fast peers
                    val batchBuffer = java.io.ByteArrayOutputStream(BATCH_MAX_SIZE)
                    batchBuffer.write(buffer, 0, bytesRead)
                    val batchStartTime = System.currentTimeMillis()

                    // Switch to short timeout for batching
                    socket.soTimeout = BATCH_READ_TIMEOUT_MS

                    // Accumulate more data with short blocking reads
                    while (isActive &&
                           batchBuffer.size() < BATCH_MAX_SIZE &&
                           (System.currentTimeMillis() - batchStartTime) < BATCH_MAX_TIME_MS) {
                        val moreBytesRead = try {
                            input.read(buffer)
                        } catch (_: SocketTimeoutException) {
                            // No more data within timeout - deliver what we have
                            break
                        }
                        if (moreBytesRead < 0) {
                            // EOF - deliver batch then exit
                            break
                        }
                        totalBytesRead += moreBytesRead
                        batchBuffer.write(buffer, 0, moreBytesRead)
                    }

                    // Deliver accumulated batch
                    onData(batchBuffer.toByteArray())
                }
            } catch (_: IOException) {
                // Connection closed or error
            } finally {
                // Notify that socket closed (from peer side)
                if (isActive) {
                    onClose(false, 0)
                }
                close()
            }
        }
    }

    private fun startSending() {
        senderJob = scope.launch {
            try {
                val output = socket.getOutputStream().buffered(WRITE_BUFFER_SIZE)
                var pendingBytes = 0

                for (data in sendQueue) {
                    output.write(data)
                    pendingBytes += data.size

                    // Flush when queue is empty, accumulated enough, or small control message
                    // Small messages (<1KB) are likely protocol control (handshake, interested,
                    // unchoke, have, request) and must be sent immediately for peers to respond
                    if (sendQueue.isEmpty || pendingBytes >= FLUSH_THRESHOLD || data.size < SMALL_MESSAGE_SIZE) {
                        output.flush()
                        pendingBytes = 0
                    }
                }
                // Final flush
                output.flush()
            } catch (_: IOException) {
                // Connection closed during send
            }
        }
    }
}
