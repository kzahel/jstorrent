package com.jstorrent.app.companion

import android.util.Log
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.io.protocol.Protocol
import com.jstorrent.io.protocol.toLEBytes
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "TcpSocketTest"

@RunWith(AndroidJUnit4::class)
class TcpSocketTest : CompanionTestBase() {

    /**
     * Helper to get an authenticated WebSocket.
     */
    private fun connectAndAuth(onAuthenticated: (WebSocket) -> Unit, onMessage: (WebSocket, ByteArray) -> Unit) {
        val token = setupAuthToken()
        val latch = CountDownLatch(1)

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            private var authenticated = false

            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(Protocol.createMessage(Protocol.OP_CLIENT_HELLO, 1).toByteString())
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1

                if (!authenticated) {
                    when (opcode) {
                        Protocol.OP_SERVER_HELLO.toInt() and 0xFF -> {
                            val payload = byteArrayOf(0) +
                                token.toByteArray() + byteArrayOf(0) +
                                "testextensionid".toByteArray() + byteArrayOf(0) +
                                "test-install-id-12345".toByteArray()
                            webSocket.send(Protocol.createMessage(Protocol.OP_AUTH, 2, payload).toByteString())
                        }
                        Protocol.OP_AUTH_RESULT.toInt() and 0xFF -> {
                            val status = data.getOrNull(8)?.toInt()?.and(0xFF)
                            if (status == 0) {
                                authenticated = true
                                latch.countDown()
                                onAuthenticated(webSocket)
                            }
                        }
                    }
                } else {
                    onMessage(webSocket, data)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                latch.countDown()
            }
        }

        httpClient.newWebSocket(request, listener)
        assertTrue("Should authenticate", latch.await(10, TimeUnit.SECONDS))
    }

    @Test
    fun tcpConnectToValidHost() {
        val connectLatch = CountDownLatch(1)
        val socketIdHolder = AtomicInteger(-1)
        var connectSuccess = false

        connectAndAuth(
            onAuthenticated = { ws ->
                // TCP_CONNECT to google.com:80
                val socketId = 1
                val port: Short = 80
                val host = "google.com"

                val payload = socketId.toLEBytes() +
                    port.toLEBytes() +
                    host.toByteArray()

                ws.send(Protocol.createMessage(Protocol.OP_TCP_CONNECT, 100, payload).toByteString())
                socketIdHolder.set(socketId)
            },
            onMessage = { ws, data ->
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1

                if (opcode == Protocol.OP_TCP_CONNECTED.toInt() and 0xFF) {
                    // Parse response: envelope(8) + [socketId:4][status:1]
                    val status = data.getOrNull(12)?.toInt()?.and(0xFF)
                    Log.i(TAG, "TCP_CONNECTED: status=$status")
                    connectSuccess = (status == 0)

                    // Close the socket
                    val socketId = socketIdHolder.get()
                    val closePayload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
                    ws.send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, closePayload).toByteString())

                    ws.close(1000, "Done")
                    connectLatch.countDown()
                }
            }
        )

        assertTrue("Should receive TCP_CONNECTED", connectLatch.await(15, TimeUnit.SECONDS))
        assertTrue("Connect should succeed", connectSuccess)
    }

    @Test
    fun tcpConnectToInvalidHostFails() {
        val connectLatch = CountDownLatch(1)
        var connectFailed = false

        connectAndAuth(
            onAuthenticated = { ws ->
                val socketId = 1
                val port: Short = 12345
                val host = "invalid.nonexistent.host.test"

                val payload = socketId.toLEBytes() +
                    port.toLEBytes() +
                    host.toByteArray()

                ws.send(Protocol.createMessage(Protocol.OP_TCP_CONNECT, 100, payload).toByteString())
            },
            onMessage = { ws, data ->
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1

                if (opcode == Protocol.OP_TCP_CONNECTED.toInt() and 0xFF) {
                    val status = data.getOrNull(12)?.toInt()?.and(0xFF)
                    Log.i(TAG, "TCP_CONNECTED: status=$status")
                    connectFailed = (status != 0)
                    ws.close(1000, "Done")
                    connectLatch.countDown()
                }
            }
        )

        assertTrue("Should receive response", connectLatch.await(15, TimeUnit.SECONDS))
        assertTrue("Connect should fail for invalid host", connectFailed)
    }
}
