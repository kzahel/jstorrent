package com.jstorrent.app.server

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Binary protocol for WebSocket socket multiplexing.
 * All multi-byte integers are little-endian.
 */
object Protocol {
    const val VERSION: Byte = 1

    // Session & Auth opcodes
    const val OP_CLIENT_HELLO: Byte = 0x01
    const val OP_SERVER_HELLO: Byte = 0x02
    const val OP_AUTH: Byte = 0x03
    const val OP_AUTH_RESULT: Byte = 0x04
    const val OP_ERROR: Byte = 0x7F

    // TCP opcodes
    const val OP_TCP_CONNECT: Byte = 0x10
    const val OP_TCP_CONNECTED: Byte = 0x11
    const val OP_TCP_SEND: Byte = 0x12
    const val OP_TCP_RECV: Byte = 0x13
    const val OP_TCP_CLOSE: Byte = 0x14

    // TCP Server opcodes
    const val OP_TCP_LISTEN: Byte = 0x15
    const val OP_TCP_LISTEN_RESULT: Byte = 0x16
    const val OP_TCP_ACCEPT: Byte = 0x17
    const val OP_TCP_STOP_LISTEN: Byte = 0x18

    // TLS upgrade opcodes
    const val OP_TCP_SECURE: Byte = 0x19
    const val OP_TCP_SECURED: Byte = 0x1A

    // UDP opcodes
    const val OP_UDP_BIND: Byte = 0x20
    const val OP_UDP_BOUND: Byte = 0x21
    const val OP_UDP_SEND: Byte = 0x22
    const val OP_UDP_RECV: Byte = 0x23
    const val OP_UDP_CLOSE: Byte = 0x24
    const val OP_UDP_JOIN_MULTICAST: Byte = 0x25
    const val OP_UDP_LEAVE_MULTICAST: Byte = 0x26

    // Control plane opcodes (0xE0-0xEF)
    const val OP_CTRL_ROOTS_CHANGED: Byte = 0xE0.toByte()
    const val OP_CTRL_EVENT: Byte = 0xE1.toByte()
    const val OP_CTRL_OPEN_FOLDER_PICKER: Byte = 0xE2.toByte()

    // Opcode sets for route validation
    val HANDSHAKE_OPCODES = setOf(
        OP_CLIENT_HELLO, OP_SERVER_HELLO, OP_AUTH, OP_AUTH_RESULT, OP_ERROR
    )

    val IO_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_TCP_CONNECT, OP_TCP_CONNECTED, OP_TCP_SEND, OP_TCP_RECV, OP_TCP_CLOSE,
        OP_TCP_LISTEN, OP_TCP_LISTEN_RESULT, OP_TCP_ACCEPT, OP_TCP_STOP_LISTEN,
        OP_TCP_SECURE, OP_TCP_SECURED,
        OP_UDP_BIND, OP_UDP_BOUND, OP_UDP_SEND, OP_UDP_RECV, OP_UDP_CLOSE,
        OP_UDP_JOIN_MULTICAST, OP_UDP_LEAVE_MULTICAST
    )

    val CONTROL_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_CTRL_ROOTS_CHANGED, OP_CTRL_EVENT, OP_CTRL_OPEN_FOLDER_PICKER
    )

    /**
     * Message envelope: 8 bytes
     * [0]: version (u8)
     * [1]: opcode (u8)
     * [2-3]: flags (u16, little-endian)
     * [4-7]: requestId (u32, little-endian)
     */
    data class Envelope(
        val version: Byte,
        val opcode: Byte,
        val flags: Short,
        val requestId: Int
    ) {
        fun toBytes(): ByteArray {
            val buffer = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            buffer.put(version)
            buffer.put(opcode)
            buffer.putShort(flags)
            buffer.putInt(requestId)
            return buffer.array()
        }

        companion object {
            fun fromBytes(data: ByteArray): Envelope? {
                if (data.size < 8) return null
                val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
                return Envelope(
                    version = buffer.get(),
                    opcode = buffer.get(),
                    flags = buffer.short,
                    requestId = buffer.int
                )
            }
        }
    }

    fun createMessage(opcode: Byte, requestId: Int, payload: ByteArray = ByteArray(0)): ByteArray {
        val envelope = Envelope(VERSION, opcode, 0, requestId)
        return envelope.toBytes() + payload
    }

    fun createError(requestId: Int, message: String): ByteArray {
        return createMessage(OP_ERROR, requestId, message.toByteArray())
    }
}

// Extension functions for little-endian byte manipulation
fun ByteArray.getUIntLE(offset: Int): Int {
    return ByteBuffer.wrap(this, offset, 4).order(ByteOrder.LITTLE_ENDIAN).int
}

fun ByteArray.getUShortLE(offset: Int): Int {
    return ByteBuffer.wrap(this, offset, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xFFFF
}

fun Int.toLEBytes(): ByteArray {
    return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(this).array()
}

fun Short.toLEBytes(): ByteArray {
    return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(this).array()
}
