package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Mirrors `clients/web/src/inspection/share-link.test.ts`. */
class ShareLinkTest {
    @Test
    fun putsTheMagnetQueryStringInTheFragmentUnchanged() {
        assertEquals(
            "https://jstorrent.com/share/#xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
                "&dn=The%20WIRED%20CD&tr=udp%3A%2F%2Ftracker.example%3A6969",
            shareLinkFromMagnet(
                "magnet:?xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
                    "&dn=The%20WIRED%20CD&tr=udp%3A%2F%2Ftracker.example%3A6969",
            ),
        )
    }

    @Test
    fun keepsV2HashesAndRawTrackerUrls() {
        assertEquals(
            "https://jstorrent.com/share/#xt=urn:btmh:1220abcd&tr=http://tracker.example/announce?k=1",
            shareLinkFromMagnet(
                "MAGNET:?xt=urn:btmh:1220abcd&tr=http://tracker.example/announce?k=1",
            ),
        )
    }

    @Test
    fun escapesCharactersAFragmentCannotCarry() {
        assertEquals(
            "https://jstorrent.com/share/#dn=a%20b%23c%25zz%41%C3%A9",
            shareLinkFromMagnet("magnet:?dn=a b#c%zz%41é"),
        )
    }

    @Test
    fun escapesTrailingPercentAndSupplementaryCharacters() {
        assertEquals(
            "https://jstorrent.com/share/#dn=%25%254%F0%9F%8E%AC",
            shareLinkFromMagnet("magnet:?dn=%%4🎬"),
        )
    }

    @Test
    fun rejectsAnythingThatIsNotAMagnet() {
        assertThrows(IllegalArgumentException::class.java) {
            shareLinkFromMagnet("https://example.com/")
        }
        assertThrows(IllegalArgumentException::class.java) { shareLinkFromMagnet("magnet:") }
    }
}
