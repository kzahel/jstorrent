package com.jstorrent.app.cache

import org.junit.Assert.*
import org.junit.Test

class TorrentSummaryCacheTest {

    // =========================================================================
    // Bitfield progress calculation tests
    // =========================================================================

    @Test
    fun `calculate progress from empty bitfield`() {
        val progress = calculateProgress("00", pieceLength = 16384, totalSize = 16384)
        assertEquals(0.0, progress, 0.001)
    }

    @Test
    fun `calculate progress from full bitfield`() {
        // 8 pieces, all complete (0xff = 11111111)
        val progress = calculateProgress("ff", pieceLength = 16384, totalSize = 8 * 16384L)
        assertEquals(1.0, progress, 0.001)
    }

    @Test
    fun `calculate progress from half complete bitfield`() {
        // 8 pieces, 4 complete (0xf0 = 11110000)
        val progress = calculateProgress("f0", pieceLength = 16384, totalSize = 8 * 16384L)
        assertEquals(0.5, progress, 0.001)
    }

    @Test
    fun `calculate progress with multi-byte bitfield`() {
        // 16 pieces, 12 complete (0xff = 8 bits, 0xf0 = 4 bits)
        val progress = calculateProgress("fff0", pieceLength = 16384, totalSize = 16 * 16384L)
        assertEquals(0.75, progress, 0.001)
    }

    @Test
    fun `calculate progress handles padding bits`() {
        // 5 pieces, all complete
        // Bitfield would be 0xf8 = 11111000 (5 pieces + 3 padding bits)
        // Only first 5 bits count
        val progress = calculateProgress("f8", pieceLength = 16384, totalSize = 5 * 16384L)
        assertEquals(1.0, progress, 0.001)
    }

    @Test
    fun `calculate progress with zero total size`() {
        val progress = calculateProgress("ff", pieceLength = 16384, totalSize = 0)
        assertEquals(0.0, progress, 0.001)
    }

    @Test
    fun `calculate progress with zero piece length`() {
        val progress = calculateProgress("ff", pieceLength = 0, totalSize = 1000)
        assertEquals(0.0, progress, 0.001)
    }

    // Helper function that mirrors TorrentSummaryCache's private method
    private fun calculateProgress(
        bitfieldHex: String,
        pieceLength: Int,
        totalSize: Long
    ): Double {
        if (totalSize == 0L || pieceLength == 0) return 0.0

        val pieceCount = ((totalSize + pieceLength - 1) / pieceLength).toInt()
        if (pieceCount == 0) return 0.0

        var completedPieces = 0
        for (i in bitfieldHex.indices step 2) {
            if (i + 1 < bitfieldHex.length) {
                val byte = bitfieldHex.substring(i, i + 2).toIntOrNull(16) ?: 0
                completedPieces += Integer.bitCount(byte)
            }
        }

        val actualCompleted = minOf(completedPieces, pieceCount)
        return actualCompleted.toDouble() / pieceCount
    }

    // =========================================================================
    // Magnet URI display name parsing tests
    // =========================================================================

    @Test
    fun `parse display name from magnet URI`() {
        val magnet = "magnet:?xt=urn:btih:abc123&dn=Ubuntu+20.04&tr=http://tracker.example.com"
        val name = TorrentSummaryCache.parseDisplayName(magnet)
        assertEquals("Ubuntu 20.04", name)
    }

    @Test
    fun `parse URL-encoded display name`() {
        val magnet = "magnet:?xt=urn:btih:abc123&dn=My%20Cool%20Torrent%21"
        val name = TorrentSummaryCache.parseDisplayName(magnet)
        assertEquals("My Cool Torrent!", name)
    }

    @Test
    fun `parse display name at end of URI`() {
        val magnet = "magnet:?xt=urn:btih:abc123&dn=TestFile"
        val name = TorrentSummaryCache.parseDisplayName(magnet)
        assertEquals("TestFile", name)
    }

    @Test
    fun `return null when no display name`() {
        val magnet = "magnet:?xt=urn:btih:abc123&tr=http://tracker.example.com"
        val name = TorrentSummaryCache.parseDisplayName(magnet)
        assertNull(name)
    }

    @Test
    fun `handle empty display name`() {
        val magnet = "magnet:?xt=urn:btih:abc123&dn=&tr=http://tracker.example.com"
        val name = TorrentSummaryCache.parseDisplayName(magnet)
        assertEquals("", name)
    }

    // =========================================================================
    // Active incomplete torrent detection tests (Stage 4)
    // =========================================================================
    // These tests verify the logic for detecting if a torrent needs engine to run

    @Test
    fun `isComplete returns true for all-FF bitfield`() {
        // A bitfield with all 0xFF bytes indicates all pieces complete
        assertTrue(isLikelyComplete("ffffffff"))
        assertTrue(isLikelyComplete("FFFFFFFF"))
        assertTrue(isLikelyComplete("ff"))
        assertTrue(isLikelyComplete("FF"))
    }

    @Test
    fun `isComplete returns false for partial bitfield`() {
        // A bitfield with non-FF bytes is incomplete
        assertFalse(isLikelyComplete("f0"))  // Half complete
        assertFalse(isLikelyComplete("00"))  // Empty
        assertFalse(isLikelyComplete("fe"))  // Missing last bit
        assertFalse(isLikelyComplete("ffff00"))  // Partial
    }

    @Test
    fun `isComplete returns false for empty bitfield`() {
        assertFalse(isLikelyComplete(""))
        assertFalse(isLikelyComplete(null))
    }

    /**
     * Quick check if bitfield is likely complete (all 0xFF bytes).
     * This mirrors TorrentSummaryCache.hasActiveIncompleteTorrents logic.
     */
    private fun isLikelyComplete(bitfield: String?): Boolean {
        if (bitfield.isNullOrEmpty()) return false
        return bitfield.all { it == 'f' || it == 'F' }
    }

    // =========================================================================
    // Stage 5: Edge case tests for magnet without metadata
    // =========================================================================

    @Test
    fun `CachedTorrentSummary toTorrentSummary preserves hasMetadata`() {
        val cache = TorrentSummaryCache(null)

        // Test with hasMetadata = true
        val withMetadata = CachedTorrentSummary(
            infoHash = "abc123",
            name = "Test Torrent",
            progress = 0.5,
            status = "downloading",
            totalSize = 1000L,
            downloaded = 500L,
            uploaded = 100L,
            fileCount = 1,
            addedAt = System.currentTimeMillis(),
            hasMetadata = true,
            userState = "active"
        )
        val summaryWithMetadata = with(cache) { withMetadata.toTorrentSummary() }
        assertTrue(summaryWithMetadata.hasMetadata)

        // Test with hasMetadata = false
        val withoutMetadata = CachedTorrentSummary(
            infoHash = "def456",
            name = "Magnet Torrent",
            progress = 0.0,
            status = "stopped",
            totalSize = 0L,
            downloaded = 0L,
            uploaded = 0L,
            fileCount = 0,
            addedAt = System.currentTimeMillis(),
            hasMetadata = false,
            userState = "active"
        )
        val summaryWithoutMetadata = with(cache) { withoutMetadata.toTorrentSummary() }
        assertFalse(summaryWithoutMetadata.hasMetadata)
    }

    @Test
    fun `TorrentSummary default hasMetadata is true`() {
        // When coming from engine, hasMetadata should default to true
        val summary = com.jstorrent.quickjs.model.TorrentSummary(
            infoHash = "abc123",
            name = "Test",
            progress = 0.5,
            downloadSpeed = 1000L,
            uploadSpeed = 100L,
            status = "downloading"
        )
        assertTrue(summary.hasMetadata)
    }

    @Test
    fun `magnet with display name but no metadata shows correct values`() {
        // This tests the expected behavior when a magnet has dn= but no info dict
        val cache = TorrentSummaryCache(null)

        // Simulate a magnet-sourced torrent without metadata
        val summary = CachedTorrentSummary(
            infoHash = "abc123",
            name = "Ubuntu 22.04", // Extracted from dn= parameter
            progress = 0.0,        // Unknown - no metadata
            status = "stopped",
            totalSize = 0L,        // Unknown - no metadata
            downloaded = 0L,
            uploaded = 0L,
            fileCount = 0,         // Unknown - no metadata
            addedAt = System.currentTimeMillis(),
            hasMetadata = false,   // Key flag!
            userState = "active"
        )

        val torrentSummary = with(cache) { summary.toTorrentSummary() }

        // Verify the summary correctly indicates no metadata
        assertFalse(torrentSummary.hasMetadata)
        assertEquals("Ubuntu 22.04", torrentSummary.name)
        assertEquals(0.0, torrentSummary.progress, 0.001)
    }

    @Test
    fun `special characters in magnet display name are decoded`() {
        // Test URL-encoded special characters in dn= parameter
        val magnetWithSpecialChars = "magnet:?xt=urn:btih:abc&dn=Test%20%26%20Demo%21"
        val name = TorrentSummaryCache.parseDisplayName(magnetWithSpecialChars)
        assertEquals("Test & Demo!", name)
    }

    @Test
    fun `unicode in magnet display name is handled`() {
        // Test UTF-8 encoded characters
        val magnetWithUnicode = "magnet:?xt=urn:btih:abc&dn=%E4%B8%AD%E6%96%87%E6%B5%8B%E8%AF%95"
        val name = TorrentSummaryCache.parseDisplayName(magnetWithUnicode)
        assertEquals("中文测试", name)
    }
}
