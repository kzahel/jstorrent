package com.jstorrent.app.server

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for WebSocket route opcode validation.
 * Ensures /io and /control routes only accept their designated opcodes.
 */
class WebSocketRouteTest {

    // =========================================================================
    // IO route opcode tests
    // =========================================================================

    @Test
    fun `IO route accepts handshake opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_CLIENT_HELLO))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_SERVER_HELLO))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_AUTH))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_AUTH_RESULT))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_ERROR))
    }

    @Test
    fun `IO route accepts TCP opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CONNECT))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CONNECTED))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_SEND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_RECV))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CLOSE))
    }

    @Test
    fun `IO route accepts UDP opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_BIND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_BOUND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_SEND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_RECV))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_CLOSE))
    }

    @Test
    fun `IO route rejects control opcodes`() {
        assertFalse(isOpcodeAllowedForIO(Protocol.OP_CTRL_ROOTS_CHANGED))
        assertFalse(isOpcodeAllowedForIO(Protocol.OP_CTRL_EVENT))
    }

    // =========================================================================
    // Control route opcode tests
    // =========================================================================

    @Test
    fun `Control route accepts handshake opcodes`() {
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CLIENT_HELLO))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_SERVER_HELLO))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_AUTH))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_AUTH_RESULT))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_ERROR))
    }

    @Test
    fun `Control route accepts control opcodes`() {
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CTRL_ROOTS_CHANGED))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CTRL_EVENT))
    }

    @Test
    fun `Control route rejects TCP opcodes`() {
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CONNECT))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CONNECTED))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_SEND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_RECV))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CLOSE))
    }

    @Test
    fun `Control route rejects UDP opcodes`() {
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_BIND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_BOUND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_SEND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_RECV))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_CLOSE))
    }

    // =========================================================================
    // Test helpers - use actual Protocol opcode sets
    // =========================================================================

    private fun isOpcodeAllowedForIO(opcode: Byte): Boolean = opcode in Protocol.IO_OPCODES
    private fun isOpcodeAllowedForControl(opcode: Byte): Boolean = opcode in Protocol.CONTROL_OPCODES
}
