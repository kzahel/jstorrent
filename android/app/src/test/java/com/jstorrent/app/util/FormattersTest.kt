package com.jstorrent.app.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for Formatters utility functions.
 */
class FormattersTest {

    // =========================================================================
    // formatBytes tests
    // =========================================================================

    @Test
    fun `formatBytes zero returns 0 B`() {
        assertEquals("0 B", Formatters.formatBytes(0))
    }

    @Test
    fun `formatBytes negative returns 0 B`() {
        assertEquals("0 B", Formatters.formatBytes(-100))
    }

    @Test
    fun `formatBytes bytes under 1KB`() {
        assertEquals("512 B", Formatters.formatBytes(512))
        assertEquals("1 B", Formatters.formatBytes(1))
        assertEquals("1023 B", Formatters.formatBytes(1023))
    }

    @Test
    fun `formatBytes kilobytes`() {
        assertEquals("1.0 KB", Formatters.formatBytes(1024))
        assertEquals("1.5 KB", Formatters.formatBytes(1536))
        assertEquals("999.0 KB", Formatters.formatBytes(1023 * 1024))
    }

    @Test
    fun `formatBytes megabytes`() {
        assertEquals("1.0 MB", Formatters.formatBytes(1024 * 1024))
        assertEquals("1.5 MB", Formatters.formatBytes((1.5 * 1024 * 1024).toLong()))
        assertEquals("512.0 MB", Formatters.formatBytes(512 * 1024 * 1024L))
    }

    @Test
    fun `formatBytes gigabytes`() {
        assertEquals("1.00 GB", Formatters.formatBytes(1024L * 1024 * 1024))
        assertEquals("2.50 GB", Formatters.formatBytes((2.5 * 1024 * 1024 * 1024).toLong()))
    }

    @Test
    fun `formatBytes terabytes`() {
        assertEquals("1.00 TB", Formatters.formatBytes(1024L * 1024 * 1024 * 1024))
        assertEquals("5.25 TB", Formatters.formatBytes((5.25 * 1024 * 1024 * 1024 * 1024).toLong()))
    }

    // =========================================================================
    // formatSpeed tests
    // =========================================================================

    @Test
    fun `formatSpeed zero returns empty`() {
        assertEquals("", Formatters.formatSpeed(0))
    }

    @Test
    fun `formatSpeed negative returns empty`() {
        assertEquals("", Formatters.formatSpeed(-100))
    }

    @Test
    fun `formatSpeed bytes per second`() {
        assertEquals("512 B/s", Formatters.formatSpeed(512))
        assertEquals("1 B/s", Formatters.formatSpeed(1))
    }

    @Test
    fun `formatSpeed kilobytes per second`() {
        assertEquals("1.0 KB/s", Formatters.formatSpeed(1024))
        assertEquals("500.0 KB/s", Formatters.formatSpeed(512 * 1024))
    }

    @Test
    fun `formatSpeed megabytes per second`() {
        assertEquals("1.0 MB/s", Formatters.formatSpeed(1024 * 1024))
        assertEquals("10.5 MB/s", Formatters.formatSpeed((10.5 * 1024 * 1024).toLong()))
    }

    @Test
    fun `formatSpeed gigabytes per second`() {
        assertEquals("1.0 GB/s", Formatters.formatSpeed(1024L * 1024 * 1024))
    }

    // =========================================================================
    // formatEta tests
    // =========================================================================

    @Test
    fun `formatEta zero returns 0s`() {
        assertEquals("0s", Formatters.formatEta(0))
    }

    @Test
    fun `formatEta negative returns infinity`() {
        assertEquals("∞", Formatters.formatEta(-1))
    }

    @Test
    fun `formatEta max value returns infinity`() {
        assertEquals("∞", Formatters.formatEta(Long.MAX_VALUE))
    }

    @Test
    fun `formatEta seconds only`() {
        assertEquals("30s", Formatters.formatEta(30))
        assertEquals("59s", Formatters.formatEta(59))
    }

    @Test
    fun `formatEta minutes and seconds`() {
        assertEquals("1m 0s", Formatters.formatEta(60))
        assertEquals("5m 30s", Formatters.formatEta(330))
        assertEquals("59m 59s", Formatters.formatEta(3599))
    }

    @Test
    fun `formatEta hours and minutes`() {
        assertEquals("1h 0m", Formatters.formatEta(3600))
        assertEquals("2h 30m", Formatters.formatEta(9000))
        assertEquals("23h 59m", Formatters.formatEta(86399))
    }

    @Test
    fun `formatEta days and hours`() {
        assertEquals("1d 0h", Formatters.formatEta(86400))
        assertEquals("2d 12h", Formatters.formatEta(2 * 86400 + 12 * 3600))
        assertEquals("30d 0h", Formatters.formatEta(30 * 86400L))
    }

    // =========================================================================
    // formatRatio tests
    // =========================================================================

    @Test
    fun `formatRatio zero`() {
        assertEquals("0.000", Formatters.formatRatio(0.0))
    }

    @Test
    fun `formatRatio negative returns zero`() {
        assertEquals("0.000", Formatters.formatRatio(-1.0))
    }

    @Test
    fun `formatRatio normal values`() {
        assertEquals("1.000", Formatters.formatRatio(1.0))
        assertEquals("0.500", Formatters.formatRatio(0.5))
        assertEquals("1.234", Formatters.formatRatio(1.234))
        assertEquals("2.568", Formatters.formatRatio(2.5678)) // rounds
    }

    @Test
    fun `formatRatio infinity returns symbol`() {
        assertEquals("∞", Formatters.formatRatio(Double.POSITIVE_INFINITY))
        assertEquals("∞", Formatters.formatRatio(Double.NaN))
    }

    // =========================================================================
    // formatPercent tests
    // =========================================================================

    @Test
    fun `formatPercent zero`() {
        assertEquals("0%", Formatters.formatPercent(0.0))
    }

    @Test
    fun `formatPercent full`() {
        assertEquals("100%", Formatters.formatPercent(1.0))
    }

    @Test
    fun `formatPercent normal values`() {
        assertEquals("50%", Formatters.formatPercent(0.5))
        assertEquals("45%", Formatters.formatPercent(0.45))
        assertEquals("99%", Formatters.formatPercent(0.999)) // floors
    }

    @Test
    fun `formatPercent clamps to 0-100`() {
        assertEquals("0%", Formatters.formatPercent(-0.5))
        assertEquals("100%", Formatters.formatPercent(1.5))
    }

    // =========================================================================
    // formatStatus tests
    // =========================================================================

    @Test
    fun `formatStatus downloading`() {
        assertEquals("Downloading", Formatters.formatStatus("downloading"))
    }

    @Test
    fun `formatStatus downloading_metadata`() {
        assertEquals("Getting metadata...", Formatters.formatStatus("downloading_metadata"))
    }

    @Test
    fun `formatStatus seeding`() {
        assertEquals("Seeding", Formatters.formatStatus("seeding"))
    }

    @Test
    fun `formatStatus stopped`() {
        assertEquals("Paused", Formatters.formatStatus("stopped"))
    }

    @Test
    fun `formatStatus checking`() {
        assertEquals("Checking...", Formatters.formatStatus("checking"))
    }

    @Test
    fun `formatStatus error`() {
        assertEquals("Error", Formatters.formatStatus("error"))
    }

    @Test
    fun `formatStatus queued`() {
        assertEquals("Queued", Formatters.formatStatus("queued"))
    }

    @Test
    fun `formatStatus unknown capitalizes first letter`() {
        assertEquals("Custom", Formatters.formatStatus("custom"))
        assertEquals("Unknown_state", Formatters.formatStatus("unknown_state"))
    }

    // =========================================================================
    // formatPeers tests
    // =========================================================================

    @Test
    fun `formatPeers connected only`() {
        assertEquals("5", Formatters.formatPeers(5))
        assertEquals("0", Formatters.formatPeers(0))
    }

    @Test
    fun `formatPeers with total`() {
        assertEquals("5 (1,341)", Formatters.formatPeers(5, 1341))
        assertEquals("0 (100)", Formatters.formatPeers(0, 100))
    }

    @Test
    fun `formatPeers total equals connected shows connected only`() {
        assertEquals("10", Formatters.formatPeers(10, 10))
    }

    // =========================================================================
    // formatNumber tests
    // =========================================================================

    @Test
    fun `formatNumber adds thousands separators`() {
        assertEquals("1,000", Formatters.formatNumber(1000))
        assertEquals("1,000,000", Formatters.formatNumber(1000000))
        assertEquals("999", Formatters.formatNumber(999))
        assertEquals("0", Formatters.formatNumber(0))
    }

    // =========================================================================
    // formatPieces tests
    // =========================================================================

    @Test
    fun `formatPieces formats correctly`() {
        assertEquals("500/8,152 (256.0 KB)", Formatters.formatPieces(500, 8152, 256 * 1024))
        assertEquals("0/100 (1.0 MB)", Formatters.formatPieces(0, 100, 1024 * 1024))
    }

    // =========================================================================
    // formatProgress tests
    // =========================================================================

    @Test
    fun `formatProgress formats correctly`() {
        assertEquals("500.0 MB / 2.00 GB", Formatters.formatProgress(500 * 1024 * 1024L, 2L * 1024 * 1024 * 1024))
        assertEquals("0 B / 1.0 KB", Formatters.formatProgress(0, 1024))
    }

    // =========================================================================
    // formatDate tests
    // =========================================================================

    @Test
    fun `formatDate zero returns empty`() {
        assertEquals("", Formatters.formatDate(0))
    }

    @Test
    fun `formatDate negative returns empty`() {
        assertEquals("", Formatters.formatDate(-1))
    }

    @Test
    fun `formatDate formats epoch timestamp`() {
        // Known timestamp: January 1, 2024 12:00:00 UTC = 1704110400000
        val result = Formatters.formatDate(1704110400000)
        // Just verify it contains expected patterns (exact output depends on timezone)
        assert(result.contains("/")) { "Date should contain date separator: $result" }
        assert(result.contains(":")) { "Date should contain time separator: $result" }
    }
}
