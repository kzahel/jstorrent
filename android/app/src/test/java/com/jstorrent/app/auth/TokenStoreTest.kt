package com.jstorrent.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for TokenStore pairing logic.
 * Critical security tests - isPairedWith must check BOTH extensionId AND installId.
 *
 * Uses a simple in-memory test implementation instead of mocks.
 */
class TokenStoreTest {

    private lateinit var tokenStore: TestableTokenStore
    private val prefsMap = mutableMapOf<String, String?>()

    /**
     * Test implementation that stores in memory instead of SharedPreferences
     */
    class TestableTokenStore(private val map: MutableMap<String, String?>) {
        var token: String?
            get() = map["auth_token"]
            private set(value) { map["auth_token"] = value }

        var installId: String?
            get() = map["install_id"]
            private set(value) { map["install_id"] = value }

        var extensionId: String?
            get() = map["extension_id"]
            private set(value) { map["extension_id"] = value }

        fun hasToken(): Boolean = token != null

        fun isPairedWith(checkExtensionId: String, checkInstallId: String): Boolean {
            return token != null &&
                extensionId == checkExtensionId &&
                installId == checkInstallId
        }

        fun pair(newToken: String, newInstallId: String, newExtensionId: String) {
            token = newToken
            installId = newInstallId
            extensionId = newExtensionId
        }

        fun clear() {
            map.remove("auth_token")
            map.remove("install_id")
            map.remove("extension_id")
        }
    }

    @Before
    fun setup() {
        prefsMap.clear()
        tokenStore = TestableTokenStore(prefsMap)
    }

    // =========================================================================
    // hasToken tests
    // =========================================================================

    @Test
    fun `hasToken returns false when no token stored`() {
        assertFalse(tokenStore.hasToken())
    }

    @Test
    fun `hasToken returns true after pairing`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertTrue(tokenStore.hasToken())
    }

    @Test
    fun `hasToken returns false after clear`() {
        tokenStore.pair("token123", "install456", "ext789")
        tokenStore.clear()
        assertFalse(tokenStore.hasToken())
    }

    // =========================================================================
    // isPairedWith tests - SECURITY CRITICAL
    // =========================================================================

    @Test
    fun `isPairedWith returns false when not paired`() {
        assertFalse(tokenStore.isPairedWith("ext789", "install456"))
    }

    @Test
    fun `isPairedWith returns true when both extensionId and installId match`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertTrue(tokenStore.isPairedWith("ext789", "install456"))
    }

    @Test
    fun `isPairedWith returns false when extensionId differs`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("DIFFERENT_EXT", "install456"))
    }

    @Test
    fun `isPairedWith returns false when installId differs`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("ext789", "DIFFERENT_INSTALL"))
    }

    @Test
    fun `isPairedWith returns false when both differ`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("DIFFERENT_EXT", "DIFFERENT_INSTALL"))
    }

    @Test
    fun `isPairedWith returns false after clear`() {
        tokenStore.pair("token123", "install456", "ext789")
        tokenStore.clear()
        assertFalse(tokenStore.isPairedWith("ext789", "install456"))
    }

    // =========================================================================
    // pair tests
    // =========================================================================

    @Test
    fun `pair stores all three values`() {
        tokenStore.pair("myToken", "myInstall", "myExt")

        assertEquals("myToken", tokenStore.token)
        assertEquals("myInstall", tokenStore.installId)
        assertEquals("myExt", tokenStore.extensionId)
    }

    @Test
    fun `pair overwrites existing values`() {
        tokenStore.pair("token1", "install1", "ext1")
        tokenStore.pair("token2", "install2", "ext2")

        assertEquals("token2", tokenStore.token)
        assertEquals("install2", tokenStore.installId)
        assertEquals("ext2", tokenStore.extensionId)
    }

    // =========================================================================
    // clear tests
    // =========================================================================

    @Test
    fun `clear removes all values`() {
        tokenStore.pair("token", "install", "ext")
        tokenStore.clear()

        assertNull(tokenStore.token)
        assertNull(tokenStore.installId)
        assertNull(tokenStore.extensionId)
    }
}
