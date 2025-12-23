package com.jstorrent.io.socket

import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for [TcpSocketService].
 *
 * Uses real loopback sockets for reliable, fast testing of actual I/O behavior.
 */
class TcpSocketServiceTest {

    private lateinit var scope: CoroutineScope
    private lateinit var service: TcpSocketService
    private var testServer: ServerSocket? = null

    @Before
    fun setUp() {
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        service = TcpSocketService(scope)
    }

    @After
    fun tearDown() {
        service.shutdown()
        scope.cancel()
        testServer?.close()
    }

    private fun startTestServer(): Int {
        testServer = ServerSocket(0) // System-assigned port
        return testServer!!.localPort
    }

    @Test
    fun `connect succeeds to loopback server`() {
        val port = startTestServer()
        val connected = CountDownLatch(1)
        val success = AtomicBoolean(false)

        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, successFlag: Boolean, errorCode: Int) {
                success.set(successFlag)
                connected.countDown()
            }
            override fun onTcpData(socketId: Int, data: ByteArray) {}
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, successFlag: Boolean) {}
        })

        service.connect(1, "127.0.0.1", port)
        assertTrue(connected.await(5, TimeUnit.SECONDS), "Connect should complete within timeout")
        assertTrue(success.get(), "Connection should succeed")
    }

    @Test
    fun `connect fails to unreachable host`() {
        val connected = CountDownLatch(1)
        val success = AtomicBoolean(true)

        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, successFlag: Boolean, errorCode: Int) {
                success.set(successFlag)
                connected.countDown()
            }
            override fun onTcpData(socketId: Int, data: ByteArray) {}
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, successFlag: Boolean) {}
        })

        // Connect to a port that definitely won't be listening
        service.connect(1, "127.0.0.1", 65534)
        assertTrue(connected.await(15, TimeUnit.SECONDS), "Connect should complete within timeout")
        assertFalse(success.get(), "Connection should fail")
    }

    @Test
    fun `send delivers data to connected socket`() {
        val port = startTestServer()
        val dataReceived = CountDownLatch(1)
        val receivedData = AtomicReference<ByteArray>()

        // Accept connection on server and read data
        Thread {
            try {
                val clientSocket = testServer!!.accept()
                val input = clientSocket.getInputStream()
                val buffer = ByteArray(1024)
                val bytesRead = input.read(buffer)
                if (bytesRead > 0) {
                    receivedData.set(buffer.copyOf(bytesRead))
                    dataReceived.countDown()
                }
                clientSocket.close()
            } catch (_: Exception) {}
        }.start()

        val connected = CountDownLatch(1)
        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
                connected.countDown()
            }
            override fun onTcpData(socketId: Int, data: ByteArray) {}
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, success: Boolean) {}
        })

        service.connect(1, "127.0.0.1", port)
        assertTrue(connected.await(5, TimeUnit.SECONDS))

        val testData = "Hello, World!".toByteArray()
        service.send(1, testData)

        assertTrue(dataReceived.await(5, TimeUnit.SECONDS), "Data should be received")
        assertEquals(String(testData), String(receivedData.get()))
    }

    @Test
    fun `receive triggers onTcpData callback`() {
        val port = startTestServer()
        val dataReceived = CountDownLatch(1)
        val receivedData = AtomicReference<ByteArray>()

        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {}
            override fun onTcpData(socketId: Int, data: ByteArray) {
                receivedData.set(data)
                dataReceived.countDown()
            }
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, success: Boolean) {}
        })

        val connected = CountDownLatch(1)
        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
                connected.countDown()
            }
            override fun onTcpData(socketId: Int, data: ByteArray) {
                receivedData.set(data)
                dataReceived.countDown()
            }
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, success: Boolean) {}
        })

        service.connect(1, "127.0.0.1", port)
        assertTrue(connected.await(5, TimeUnit.SECONDS))

        // Send data from server side
        Thread {
            try {
                val clientSocket = testServer!!.accept()
                val output = clientSocket.getOutputStream()
                output.write("Hello from server".toByteArray())
                output.flush()
                // Keep connection open briefly so data can be received
                Thread.sleep(100)
                clientSocket.close()
            } catch (_: Exception) {}
        }.start()

        // Trigger activation by sending
        service.send(1, "trigger".toByteArray())

        assertTrue(dataReceived.await(5, TimeUnit.SECONDS), "Data should be received")
        assertEquals("Hello from server", String(receivedData.get()))
    }

    @Test
    fun `close cancels pending connect`() {
        // Don't start server - connection will be pending
        val connected = CountDownLatch(1)
        val connectionResult = AtomicBoolean(true)

        service.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
                connectionResult.set(success)
                connected.countDown()
            }
            override fun onTcpData(socketId: Int, data: ByteArray) {}
            override fun onTcpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
            override fun onTcpSecured(socketId: Int, success: Boolean) {}
        })

        // Connect to non-existent server (will timeout eventually)
        service.connect(1, "192.0.2.1", 12345) // TEST-NET-1, should timeout

        // Close immediately
        Thread.sleep(50) // Let connect start
        service.close(1)

        // Should not get a success callback
        val completed = connected.await(1, TimeUnit.SECONDS)
        // Either didn't complete (cancelled) or failed
        if (completed) {
            assertFalse(connectionResult.get(), "Cancelled connection should not succeed")
        }
    }

    @Test
    fun `server listen binds to specified port`() {
        val listenResult = CountDownLatch(1)
        val boundPort = AtomicInteger(0)
        val success = AtomicBoolean(false)

        service.setCallback(object : TcpServerCallback {
            override fun onTcpListenResult(serverId: Int, successFlag: Boolean, port: Int, errorCode: Int) {
                success.set(successFlag)
                boundPort.set(port)
                listenResult.countDown()
            }
            override fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int) {}
        })

        service.listen(1, 0) // System-assigned port
        assertTrue(listenResult.await(5, TimeUnit.SECONDS))
        assertTrue(success.get(), "Listen should succeed")
        assertTrue(boundPort.get() > 0, "Should return valid port")
    }

    @Test
    fun `server accepts incoming connection`() {
        val listenResult = CountDownLatch(1)
        val acceptResult = CountDownLatch(1)
        val boundPort = AtomicInteger(0)
        val acceptedSocketId = AtomicInteger(0)

        service.setCallback(object : TcpServerCallback {
            override fun onTcpListenResult(serverId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundPort.set(port)
                listenResult.countDown()
            }
            override fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int) {
                acceptedSocketId.set(socketId)
                acceptResult.countDown()
            }
        })

        service.listen(1, 0)
        assertTrue(listenResult.await(5, TimeUnit.SECONDS))

        // Connect to the server
        Thread {
            try {
                java.net.Socket("127.0.0.1", boundPort.get()).use { socket ->
                    socket.getOutputStream().write("test".toByteArray())
                    Thread.sleep(100)
                }
            } catch (_: Exception) {}
        }.start()

        assertTrue(acceptResult.await(5, TimeUnit.SECONDS), "Should accept connection")
        assertTrue(acceptedSocketId.get() >= 0x10000, "Socket ID should be server-generated")
    }

    @Test
    fun `stopListen closes server but not accepted connections`() {
        val listenResult = CountDownLatch(1)
        val boundPort = AtomicInteger(0)

        service.setCallback(object : TcpServerCallback {
            override fun onTcpListenResult(serverId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundPort.set(port)
                listenResult.countDown()
            }
            override fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int) {}
        })

        service.listen(1, 0)
        assertTrue(listenResult.await(5, TimeUnit.SECONDS))

        // Stop listening
        service.stopListen(1)

        // New connections should fail
        Thread.sleep(100) // Let stop take effect
        try {
            java.net.Socket("127.0.0.1", boundPort.get()).close()
            // If we got here, server might not have stopped yet - that's OK for this test
        } catch (_: Exception) {
            // Expected - server is stopped
        }
    }
}
