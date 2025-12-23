package com.jstorrent.app.benchmark

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Protocol helpers for benchmark testing.
 * All multi-byte integers are little-endian.
 */
object Protocol {
    const val VERSION: Byte = 1

    // Session & Auth opcodes
    const val CLIENT_HELLO: Int = 0x01
    const val SERVER_HELLO: Int = 0x02
    const val AUTH: Int = 0x03
    const val AUTH_RESULT: Int = 0x04
    const val ERROR: Int = 0x7F

    // TCP opcodes
    const val TCP_CONNECT: Int = 0x10
    const val TCP_CONNECTED: Int = 0x11
    const val TCP_SEND: Int = 0x12
    const val TCP_RECV: Int = 0x13
    const val TCP_CLOSE: Int = 0x14

    /**
     * Build an 8-byte envelope + payload message.
     */
    fun createFrame(opcode: Int, requestId: Int, payload: ByteArray = ByteArray(0)): ByteArray {
        val frame = ByteBuffer.allocate(8 + payload.size).order(ByteOrder.LITTLE_ENDIAN)
        frame.put(VERSION)
        frame.put(opcode.toByte())
        frame.putShort(0) // flags
        frame.putInt(requestId)
        frame.put(payload)
        return frame.array()
    }

    /**
     * Build AUTH payload: [authType:1][token...]
     */
    fun authPayload(token: String): ByteArray {
        val tokenBytes = token.toByteArray(Charsets.UTF_8)
        return ByteArray(1 + tokenBytes.size).also {
            it[0] = 1 // auth type = token
            tokenBytes.copyInto(it, 1)
        }
    }

    /**
     * Build TCP_CONNECT payload: [socketId:4][port:2][hostname...]
     */
    fun tcpConnectPayload(socketId: Int, host: String, port: Int): ByteArray {
        val hostBytes = host.toByteArray(Charsets.UTF_8)
        val buf = ByteBuffer.allocate(4 + 2 + hostBytes.size).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(socketId)
        buf.putShort(port.toShort())
        buf.put(hostBytes)
        return buf.array()
    }

    /**
     * Extract socketId from first 4 bytes of payload (little-endian).
     */
    fun extractSocketId(payload: ByteArray): Int {
        return ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).int
    }
}

/**
 * Parsed frame received from WebSocket.
 */
data class ReceivedFrame(
    val version: Int,
    val opcode: Int,
    val flags: Int,
    val requestId: Int,
    val payload: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ReceivedFrame) return false
        return version == other.version &&
            opcode == other.opcode &&
            flags == other.flags &&
            requestId == other.requestId &&
            payload.contentEquals(other.payload)
    }

    override fun hashCode(): Int {
        var result = version
        result = 31 * result + opcode
        result = 31 * result + flags
        result = 31 * result + requestId
        result = 31 * result + payload.contentHashCode()
        return result
    }

    companion object {
        fun parse(data: ByteArray): ReceivedFrame? {
            if (data.size < 8) return null
            val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
            return ReceivedFrame(
                version = buf.get().toInt() and 0xFF,
                opcode = buf.get().toInt() and 0xFF,
                flags = buf.short.toInt() and 0xFFFF,
                requestId = buf.int,
                payload = data.copyOfRange(8, data.size)
            )
        }
    }
}
