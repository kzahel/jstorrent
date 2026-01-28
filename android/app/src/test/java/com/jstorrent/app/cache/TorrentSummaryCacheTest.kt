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
}
