package com.jstorrent.app.companion

import android.util.Log
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.io.protocol.Protocol
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
import java.util.concurrent.atomic.AtomicReference

private const val TAG = "WebSocketIOTest"

@RunWith(AndroidJUnit4::class)
class WebSocketIOTest : CompanionTestBase() {

    // =========================================================================
    // Protocol Helpers
    // =========================================================================

    private fun createClientHello(requestId: Int): ByteArray {
        return Protocol.createMessage(Protocol.OP_CLIENT_HELLO, requestId)
    }

    private fun createAuthFrame(requestId: Int, token: String, extensionId: String, installId: String): ByteArray {
        // AUTH payload: authType(1) + token + \0 + extensionId + \0 + installId
        val payload = byteArrayOf(0) +  // authType = 0
            token.toByteArray() + byteArrayOf(0) +
            extensionId.toByteArray() + byteArrayOf(0) +
            installId.toByteArray()
        return Protocol.createMessage(Protocol.OP_AUTH, requestId, payload)
    }

    // =========================================================================
    // Connection & Auth Tests
    // =========================================================================

    @Test
    fun webSocketConnectsAndAuthenticates() {
        val token = setupAuthToken()
        val latch = CountDownLatch(3)  // open, AUTH_RESULT, close
        val messages = mutableListOf<ByteArray>()
        val error = AtomicReference<Throwable>()

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket opened")
                // Send CLIENT_HELLO
                webSocket.send(createClientHello(1).toByteString())
                latch.countDown()
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                Log.i(TAG, "Received ${data.size} bytes, opcode=0x${data.getOrNull(1)?.toInt()?.and(0xFF)?.toString(16)}")
                messages.add(data)

                // Check opcode
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1
                when (opcode) {
                    Protocol.OP_SERVER_HELLO.toInt() and 0xFF -> {
                        Log.i(TAG, "Got SERVER_HELLO, sending AUTH")
                        webSocket.send(createAuthFrame(2, token, "testextensionid", "test-install-id-12345").toByteString())
                    }
                    Protocol.OP_AUTH_RESULT.toInt() and 0xFF -> {
                        Log.i(TAG, "Got AUTH_RESULT")
                        latch.countDown()
                        webSocket.close(1000, "Test complete")
                        latch.countDown()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                error.set(t)
                latch.countDown()
                latch.countDown()
                latch.countDown()
            }
        }

        val ws = httpClient.newWebSocket(request, listener)

        assertTrue("Should complete handshake", latch.await(10, TimeUnit.SECONDS))
        assertNull("Should have no error", error.get())

        // Verify AUTH_RESULT indicates success (status byte = 0)
        val authResult = messages.find {
            it.getOrNull(1)?.toInt()?.and(0xFF) == Protocol.OP_AUTH_RESULT.toInt() and 0xFF
        }
        assertNotNull("Should have AUTH_RESULT", authResult)

        val status = authResult?.getOrNull(8)?.toInt()?.and(0xFF)
        assertEquals("AUTH should succeed (status=0)", 0, status)
    }

    @Test
    fun authFailsWithInvalidToken() {
        val latch = CountDownLatch(2)
        var authStatus: Int = -1

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(createClientHello(1).toByteString())
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1

                when (opcode) {
                    Protocol.OP_SERVER_HELLO.toInt() and 0xFF -> {
                        // Send AUTH with invalid token
                        webSocket.send(createAuthFrame(2, "invalid-token", "ext", "install").toByteString())
                    }
                    Protocol.OP_AUTH_RESULT.toInt() and 0xFF -> {
                        authStatus = data.getOrNull(8)?.toInt()?.and(0xFF) ?: -1
                        latch.countDown()
                        webSocket.close(1000, "Done")
                        latch.countDown()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                latch.countDown()
                latch.countDown()
            }
        }

        httpClient.newWebSocket(request, listener)

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertNotEquals("AUTH should fail (status != 0)", 0, authStatus)
    }
}
