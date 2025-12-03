package com.jstorrent.app.benchmark

import java.io.BufferedOutputStream
import java.io.Closeable
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * A mock TCP server that blasts data as fast as possible to simulate
 * a BitTorrent peer seeding data.
 *
 * @param totalBytes Total number of bytes to send
 * @param chunkSize Size of each write chunk
 */
class MockSeeder(
    private val totalBytes: Long,
    private val chunkSize: Int = 16 * 1024
) : Closeable {

    private val server = ServerSocket(0) // random available port
    val port: Int get() = server.localPort

    private var clientThread: Thread? = null

    @Volatile
    var bytesSent: Long = 0
        private set

    @Volatile
    var completed: Boolean = false
        private set

    @Volatile
    var error: Exception? = null
        private set

    /**
     * Start accepting a client connection and sending data asynchronously.
     */
    fun startAsync() {
        clientThread = thread(name = "MockSeeder-$port") {
            try {
                val client = server.accept()
                client.tcpNoDelay = true
                client.sendBufferSize = 256 * 1024

                val out = BufferedOutputStream(client.getOutputStream(), 64 * 1024)
                val chunk = ByteArray(chunkSize) { 0x42.toByte() }

                while (bytesSent < totalBytes) {
                    val toSend = minOf(chunkSize.toLong(), totalBytes - bytesSent).toInt()
                    out.write(chunk, 0, toSend)
                    bytesSent += toSend
                }
                out.flush()
                client.close()
                completed = true
            } catch (e: Exception) {
                error = e
            }
        }
    }

    /**
     * Wait for the seeder to finish sending all data.
     */
    fun awaitCompletion(timeoutMs: Long = 60000) {
        clientThread?.join(timeoutMs)
    }

    override fun close() {
        try {
            server.close()
        } catch (_: Exception) {}
        clientThread?.interrupt()
    }
}
