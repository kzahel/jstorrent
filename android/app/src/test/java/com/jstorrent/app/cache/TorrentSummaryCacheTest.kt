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
}
