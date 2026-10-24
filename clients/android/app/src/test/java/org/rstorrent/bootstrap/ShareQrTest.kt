package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareQrTest {
    @Test
    fun encodesAShareLinkWithAQuietZone() {
        val matrix =
            requireNotNull(
                shareQrMatrix(
                    "https://jstorrent.com/share/#xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
                        "&dn=The%20WIRED%20CD&xl=1048576",
                ),
            )
        assertEquals(matrix.width, matrix.height)
        val zone = QR_QUIET_ZONE_MODULES
        for (i in 0 until matrix.width) {
            for (j in 0 until zone) {
                assertFalse(matrix.get(i, j))
                assertFalse(matrix.get(j, i))
                assertFalse(matrix.get(i, matrix.height - 1 - j))
                assertFalse(matrix.get(matrix.width - 1 - j, i))
            }
        }
        // The top-left finder pattern starts right inside the quiet zone.
        assertTrue(matrix.get(zone, zone))
        // Version 1 is 21 modules; versions grow by 4.
        assertEquals(0, (matrix.width - 2 * zone - 21) % 4)
    }

    @Test
    fun fallsBackToLowCorrectionThenGivesUp() {
        // Byte mode at version 40 holds 2331 bytes at M and 2953 at L.
        val long = "https://jstorrent.com/share/#" + "a".repeat(2_600)
        assertNotNull(shareQrMatrix(long))
        assertNull(shareQrMatrix("https://jstorrent.com/share/#" + "a".repeat(5_000)))
    }
}
