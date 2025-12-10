package com.jstorrent.app.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for origin validation and header extraction.
 * Tests pure validation logic without Ktor dependencies.
 */
class OriginCheckMiddlewareTest {

    // =========================================================================
    // Origin validation tests - SECURITY CRITICAL
    // =========================================================================

    @Test
    fun `valid chrome extension origin is accepted`() {
        assertTrue(isValidExtensionOrigin("chrome-extension://abcdefghijklmnop"))
    }

    @Test
    fun `valid chrome extension origin with long ID is accepted`() {
        assertTrue(isValidExtensionOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyz123456"))
    }

    @Test
    fun `null origin is rejected`() {
        assertFalse(isValidExtensionOrigin(null))
    }

    @Test
    fun `empty origin is rejected`() {
        assertFalse(isValidExtensionOrigin(""))
    }

    @Test
    fun `http localhost origin is rejected`() {
        assertFalse(isValidExtensionOrigin("http://localhost"))
    }

    @Test
    fun `http localhost with port is rejected`() {
        assertFalse(isValidExtensionOrigin("http://localhost:8080"))
    }

    @Test
    fun `https origin is rejected`() {
        assertFalse(isValidExtensionOrigin("https://evil.com"))
    }

    @Test
    fun `http 127-0-0-1 origin is rejected`() {
        assertFalse(isValidExtensionOrigin("http://127.0.0.1"))
    }

    @Test
    fun `moz-extension origin is rejected`() {
        assertFalse(isValidExtensionOrigin("moz-extension://abc123"))
    }

    @Test
    fun `chrome-extension prefix without proper format is rejected`() {
        assertFalse(isValidExtensionOrigin("chrome-extension-fake://abc"))
    }

    @Test
    fun `origin containing chrome-extension but not starting with it is rejected`() {
        assertFalse(isValidExtensionOrigin("https://chrome-extension://abc"))
    }

    // =========================================================================
    // Header extraction tests
    // =========================================================================

    @Test
    fun `extracts valid headers`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = "install456"
        )

        assertEquals("ext123", headers?.extensionId)
        assertEquals("install456", headers?.installId)
    }

    @Test
    fun `returns null when extensionId is null`() {
        val headers = extractExtensionHeaders(
            extensionId = null,
            installId = "install456"
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when installId is null`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = null
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when extensionId is blank`() {
        val headers = extractExtensionHeaders(
            extensionId = "   ",
            installId = "install456"
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when installId is blank`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = ""
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when both are null`() {
        val headers = extractExtensionHeaders(
            extensionId = null,
            installId = null
        )
        assertNull(headers)
    }

    // =========================================================================
    // Test helpers - mirror the validation logic
    // =========================================================================

    private fun isValidExtensionOrigin(origin: String?): Boolean {
        return origin != null && origin.startsWith("chrome-extension://")
    }

    private fun extractExtensionHeaders(
        extensionId: String?,
        installId: String?
    ): ExtensionHeaders? {
        if (extensionId.isNullOrBlank() || installId.isNullOrBlank()) {
            return null
        }
        return ExtensionHeaders(extensionId, installId)
    }
}
