package com.jstorrent.app.storage

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLDecoder
import java.security.MessageDigest

/**
 * Unit tests for RootStore logic.
 * Tests pure functions without Android dependencies.
 */
class RootStoreTest {

    @Test
    fun `key generation is deterministic`() {
        val salt = "abc123"
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"

        val key1 = generateTestKey(salt, uri)
        val key2 = generateTestKey(salt, uri)

        assertEquals(key1, key2)
    }

    @Test
    fun `key generation produces different keys for different URIs`() {
        val salt = "abc123"
        val uri1 = "content://documents/tree/primary%3ADownload"
        val uri2 = "content://documents/tree/primary%3AMovies"

        val key1 = generateTestKey(salt, uri1)
        val key2 = generateTestKey(salt, uri2)

        assertNotEquals(key1, key2)
    }

    @Test
    fun `key generation produces different keys for different salts`() {
        val uri = "content://documents/tree/primary%3ADownload"

        val key1 = generateTestKey("salt1", uri)
        val key2 = generateTestKey("salt2", uri)

        assertNotEquals(key1, key2)
    }

    @Test
    fun `key is 16 hex characters`() {
        val key = generateTestKey("salt", "content://test")

        assertEquals(16, key.length)
        assertTrue(key.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `label extraction from primary storage URI`() {
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FJSTorrent"
        val label = extractTestLabel(uri)

        assertEquals("Download/JSTorrent", label)
    }

    @Test
    fun `label extraction from simple path`() {
        val uri = "content://documents/tree/primary%3AMovies"
        val label = extractTestLabel(uri)

        assertEquals("Movies", label)
    }

    @Test
    fun `label extraction with deeply nested path`() {
        val uri = "content://documents/tree/primary%3ADownload%2FTorrents%2FMovies%2F2025"
        val label = extractTestLabel(uri)

        assertEquals("Download/Torrents/Movies/2025", label)
    }

    @Test
    fun `removable storage detection - primary is not removable`() {
        val uri = "content://documents/tree/primary%3ADownload"
        assertFalse(isTestRemovable(uri))
    }

    @Test
    fun `removable storage detection - SD card is removable`() {
        val uri = "content://documents/tree/17FC-2B04%3ATorrents"
        assertTrue(isTestRemovable(uri))
    }

    @Test
    fun `removable storage detection - USB drive is removable`() {
        val uri = "content://documents/tree/USB_DRIVE_1234%3AMedia"
        assertTrue(isTestRemovable(uri))
    }

    @Test
    fun `DownloadRoot JSON serialization uses snake_case`() {
        val root = DownloadRoot(
            key = "abc123",
            uri = "content://test",
            displayName = "Test",
            removable = false,
            lastStatOk = false, // Use non-default to ensure it's encoded
            lastChecked = 1234567890
        )

        // encodeDefaults = true ensures all properties are serialized
        val jsonConfig = Json { encodeDefaults = true }
        val json = jsonConfig.encodeToString(DownloadRoot.serializer(), root)

        assertTrue("display_name should be snake_case", json.contains("\"display_name\""))
        assertTrue("last_stat_ok should be snake_case", json.contains("\"last_stat_ok\""))
        assertTrue("last_checked should be snake_case", json.contains("\"last_checked\""))
        assertFalse("displayName should not appear", json.contains("displayName"))
        assertFalse("lastStatOk should not appear", json.contains("lastStatOk"))
    }

    @Test
    fun `DownloadRoot JSON deserialization from snake_case`() {
        val json = """
            {
                "key": "abc123",
                "uri": "content://test",
                "display_name": "Test Folder",
                "removable": true,
                "last_stat_ok": false,
                "last_checked": 9876543210
            }
        """.trimIndent()

        val root = Json.decodeFromString(DownloadRoot.serializer(), json)

        assertEquals("abc123", root.key)
        assertEquals("content://test", root.uri)
        assertEquals("Test Folder", root.displayName)
        assertTrue(root.removable)
        assertFalse(root.lastStatOk)
        assertEquals(9876543210L, root.lastChecked)
    }

    @Test
    fun `local provider detection - externalstorage is allowed`() {
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"
        assertTrue(isAllowedProvider(uri))
    }

    @Test
    fun `local provider detection - downloads is allowed`() {
        val uri = "content://com.android.providers.downloads.documents/tree/downloads"
        assertTrue(isAllowedProvider(uri))
    }

    @Test
    fun `local provider detection - google drive is rejected`() {
        val uri = "content://com.google.android.apps.docs.storage/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }

    @Test
    fun `local provider detection - dropbox is rejected`() {
        val uri = "content://com.dropbox.android.document/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }

    @Test
    fun `local provider detection - onedrive is rejected`() {
        val uri = "content://com.microsoft.skydrive.content.StorageAccessProvider/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }

    @Test
    fun `local provider detection - box is rejected`() {
        val uri = "content://com.box.android.documents/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }

    // =========================================================================
    // Test helpers - mirrors RootStore private methods
    // =========================================================================

    private fun generateTestKey(salt: String, uri: String): String {
        val input = salt + uri
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }

    /**
     * Extract label from URI string without Android dependencies.
     * Uses java.net.URI for parsing.
     *
     * Important: Must use rawPath to get URL-encoded form, then decode after
     * extracting the last segment. Using decoded path directly would split
     * on decoded slashes within the segment.
     */
    private fun extractTestLabel(uriString: String): String {
        val uri = java.net.URI(uriString)
        // Use rawPath to preserve URL encoding
        val rawPath = uri.rawPath ?: return "Downloads"

        // Get last segment (still URL encoded, e.g., "primary%3ADownload%2FJSTorrent")
        val lastSegment = rawPath.substringAfterLast('/')

        // URL decode to get "primary:Download/JSTorrent"
        val decoded = URLDecoder.decode(lastSegment, "UTF-8")

        // Extract path after colon (e.g., "Download/JSTorrent")
        val colonIndex = decoded.indexOf(':')
        return if (colonIndex >= 0) {
            decoded.substring(colonIndex + 1)
        } else {
            decoded
        }
    }

    private fun isTestRemovable(uriString: String): Boolean {
        if (uriString.contains("primary")) return false
        return uriString.contains("/tree/") && !uriString.contains("primary")
    }

    private val ALLOWED_PROVIDERS = setOf(
        "com.android.externalstorage.documents",
        "com.android.providers.downloads.documents",
    )

    private fun isAllowedProvider(uriString: String): Boolean {
        val uri = java.net.URI(uriString)
        val authority = uri.authority ?: return false
        return authority in ALLOWED_PROVIDERS
    }
}
