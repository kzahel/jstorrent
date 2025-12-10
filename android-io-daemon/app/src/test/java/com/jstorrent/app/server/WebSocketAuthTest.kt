package com.jstorrent.app.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for WebSocket AUTH frame parsing.
 * Tests the payload format: authType(1) + token + \0 + extensionId + \0 + installId
 */
class WebSocketAuthTest {

    // =========================================================================
    // AUTH payload parsing tests
    // =========================================================================

    @Test
    fun `parses valid AUTH payload`() {
        val payload = buildAuthPayload("myToken", "myExtId", "myInstallId")
        val parsed = parseAuthPayload(payload)

        assertEquals("myToken", parsed?.token)
        assertEquals("myExtId", parsed?.extensionId)
        assertEquals("myInstallId", parsed?.installId)
    }

    @Test
    fun `parses AUTH payload with empty token`() {
        val payload = buildAuthPayload("", "extId", "installId")
        val parsed = parseAuthPayload(payload)

        assertEquals("", parsed?.token)
        assertEquals("extId", parsed?.extensionId)
        assertEquals("installId", parsed?.installId)
    }

    @Test
    fun `returns null for empty payload`() {
        val parsed = parseAuthPayload(byteArrayOf())
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload with only authType`() {
        val parsed = parseAuthPayload(byteArrayOf(0))
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload missing installId`() {
        // authType + "token" + \0 + "extId" (no second null, no installId)
        val payload = byteArrayOf(0) + "token".toByteArray() + byteArrayOf(0) + "extId".toByteArray()
        val parsed = parseAuthPayload(payload)
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload with only one null separator`() {
        // authType + "token" + \0 + "extIdinstallId" (missing second separator)
        val payload = byteArrayOf(0) + "token".toByteArray() + byteArrayOf(0) + "extIdinstallId".toByteArray()
        val parsed = parseAuthPayload(payload)
        assertNull(parsed)
    }

    @Test
    fun `handles special characters in token`() {
        val token = "token-with-special_chars.123"
        val payload = buildAuthPayload(token, "ext", "install")
        val parsed = parseAuthPayload(payload)

        assertEquals(token, parsed?.token)
    }

    @Test
    fun `handles UUID format values`() {
        val token = "550e8400-e29b-41d4-a716-446655440000"
        val extId = "abcdefghijklmnopqrstuvwxyz123456"
        val installId = "660e8400-f39c-52e5-b827-557766551111"

        val payload = buildAuthPayload(token, extId, installId)
        val parsed = parseAuthPayload(payload)

        assertEquals(token, parsed?.token)
        assertEquals(extId, parsed?.extensionId)
        assertEquals(installId, parsed?.installId)
    }

    // =========================================================================
    // Test helpers - mirror the parsing logic
    // =========================================================================

    data class AuthCredentials(
        val token: String,
        val extensionId: String,
        val installId: String
    )

    private fun buildAuthPayload(token: String, extensionId: String, installId: String): ByteArray {
        val tokenBytes = token.toByteArray(Charsets.UTF_8)
        val extBytes = extensionId.toByteArray(Charsets.UTF_8)
        val installBytes = installId.toByteArray(Charsets.UTF_8)

        return byteArrayOf(0) + // authType
            tokenBytes +
            byteArrayOf(0) + // separator
            extBytes +
            byteArrayOf(0) + // separator
            installBytes
    }

    private fun parseAuthPayload(payload: ByteArray): AuthCredentials? {
        if (payload.isEmpty()) return null

        val payloadStr = String(payload, 1, payload.size - 1, Charsets.UTF_8)
        val parts = payloadStr.split('\u0000')

        if (parts.size < 3) return null

        return AuthCredentials(
            token = parts[0],
            extensionId = parts[1],
            installId = parts[2]
        )
    }
}
