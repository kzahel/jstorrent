package com.jstorrent.io.socket

import kotlinx.coroutines.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for [UdpSocketManagerImpl].
 *
 * Uses real loopback sockets for reliable testing of actual UDP behavior.
 */
class UdpSocketManagerImplTest {

    private lateinit var scope: CoroutineScope
    private lateinit var manager: UdpSocketManagerImpl

    @Before
    fun setUp() {
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        manager = UdpSocketManagerImpl(scope)
    }

    @After
    fun tearDown() {
        manager.shutdown()
        scope.cancel()
    }

    @Test
    fun `bind creates socket on port 0 returns assigned port`() {
        val boundResult = CountDownLatch(1)
        val success = AtomicBoolean(false)
        val boundPort = AtomicInteger(0)

        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, successFlag: Boolean, port: Int, errorCode: Int) {
                success.set(successFlag)
                boundPort.set(port)
                boundResult.countDown()
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {}
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        manager.bind(1, 0) // System-assigned port
        assertTrue(boundResult.await(5, TimeUnit.SECONDS))
        assertTrue(success.get(), "Bind should succeed")
        assertTrue(boundPort.get() > 0, "Should return valid port")
    }

    @Test
    fun `send delivers datagram to destination`() {
        val receivedData = AtomicReference<ByteArray>()
        val dataReceived = CountDownLatch(1)

        // Create a receiver socket
        val receiver = DatagramSocket(0)
        val receiverPort = receiver.localPort

        // Receive in background
        Thread {
            try {
                val buffer = ByteArray(1024)
                val packet = DatagramPacket(buffer, buffer.size)
                receiver.soTimeout = 5000
                receiver.receive(packet)
                receivedData.set(packet.data.copyOf(packet.length))
                dataReceived.countDown()
            } catch (_: Exception) {}
            receiver.close()
        }.start()

        // Bind our UDP socket
        val boundResult = CountDownLatch(1)
        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundResult.countDown()
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {}
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        manager.bind(1, 0)
        assertTrue(boundResult.await(5, TimeUnit.SECONDS))

        // Send data
        val testData = "Hello UDP".toByteArray()
        manager.send(1, "127.0.0.1", receiverPort, testData)

        assertTrue(dataReceived.await(5, TimeUnit.SECONDS), "Data should be received")
        assertEquals("Hello UDP", String(receivedData.get()))
    }

    @Test
    fun `receive triggers onUdpMessage callback`() {
        val messageReceived = CountDownLatch(1)
        val receivedData = AtomicReference<ByteArray>()
        val boundPort = AtomicInteger(0)

        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundPort.set(port)
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
                receivedData.set(data)
                messageReceived.countDown()
            }
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        val boundResult = CountDownLatch(1)
        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundPort.set(port)
                boundResult.countDown()
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {
                receivedData.set(data)
                messageReceived.countDown()
            }
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        manager.bind(1, 0)
        assertTrue(boundResult.await(5, TimeUnit.SECONDS))

        // Send from another socket
        val sender = DatagramSocket()
        val testData = "Incoming message".toByteArray()
        val packet = DatagramPacket(
            testData,
            testData.size,
            InetSocketAddress("127.0.0.1", boundPort.get())
        )
        sender.send(packet)
        sender.close()

        assertTrue(messageReceived.await(5, TimeUnit.SECONDS), "Message should be received")
        assertEquals("Incoming message", String(receivedData.get()))
    }

    @Test
    fun `close stops receive loop`() {
        val boundResult = CountDownLatch(1)
        val closeResult = CountDownLatch(1)

        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundResult.countDown()
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {}
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {
                closeResult.countDown()
            }
        })

        manager.bind(1, 0)
        assertTrue(boundResult.await(5, TimeUnit.SECONDS))

        // Close the socket
        manager.close(1)

        // Should get close callback
        assertTrue(closeResult.await(5, TimeUnit.SECONDS), "Should receive close callback")
    }

    @Test
    fun `multiple sockets can coexist`() {
        val bound1 = CountDownLatch(1)
        val bound2 = CountDownLatch(1)
        val port1 = AtomicInteger(0)
        val port2 = AtomicInteger(0)

        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                when (socketId) {
                    1 -> {
                        port1.set(port)
                        bound1.countDown()
                    }
                    2 -> {
                        port2.set(port)
                        bound2.countDown()
                    }
                }
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {}
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        manager.bind(1, 0)
        manager.bind(2, 0)

        assertTrue(bound1.await(5, TimeUnit.SECONDS))
        assertTrue(bound2.await(5, TimeUnit.SECONDS))
        assertTrue(port1.get() > 0)
        assertTrue(port2.get() > 0)
        assertTrue(port1.get() != port2.get(), "Ports should be different")
    }

    @Test
    fun `send to invalid address does not crash`() {
        val boundResult = CountDownLatch(1)

        manager.setCallback(object : UdpSocketCallback {
            override fun onUdpBound(socketId: Int, success: Boolean, port: Int, errorCode: Int) {
                boundResult.countDown()
            }
            override fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray) {}
            override fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int) {}
        })

        manager.bind(1, 0)
        assertTrue(boundResult.await(5, TimeUnit.SECONDS))

        // Send to unresolvable address - should not throw
        manager.send(1, "invalid.hostname.that.does.not.exist.local", 12345, "test".toByteArray())

        // Give it time to process
        Thread.sleep(100)

        // Socket should still be functional
        manager.send(1, "127.0.0.1", 12345, "test2".toByteArray())
    }
}
