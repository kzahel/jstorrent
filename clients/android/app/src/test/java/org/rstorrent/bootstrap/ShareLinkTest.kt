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
    fun appendsSingleFileDisplayKeysAfterTheMagnetParameters() {
        assertEquals(
            "https://jstorrent.com/share/#xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
                "&dn=The%20WIRED%20CD&xl=1048576&so=2" +
                "&jst.file=Track%2003%20(live).flac&jst.size=31337",
            shareLinkFromMagnet(
                "magnet:?xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
                    "&dn=The%20WIRED%20CD&xl=1048576&so=2",
                ShareLinkFile("Track 03 (live).flac", "31337"),
            ),
        )
    }

    @Test
    fun encodesTheFileNameLikeEncodeUriComponent() {
        assertEquals(
            "https://jstorrent.com/share/#xt=urn:btih:abcd" +
                "&jst.file=a%26b%3Dc%23d%2Fe%3F%25%2B%C3%A9%20%F0%9F%8E%AC~*'()!-_.txt&jst.size=0",
            shareLinkFromMagnet(
                "magnet:?xt=urn:btih:abcd",
                ShareLinkFile("a&b=c#d/e?%+é 🎬~*'()!-_.txt", "0"),
            ),
        )
        assertEquals("%3A%40%24%2C%3B", encodeUriComponent(":@$,;"))
    }

    @Test
    fun rejectsAFileSizeThatIsNotAByteCount() {
        for (size in listOf("", "-1", "1.5", "12a", " 1")) {
            assertThrows(IllegalArgumentException::class.java) {
                shareLinkFromMagnet("magnet:?xt=urn:btih:abcd", ShareLinkFile("a", size))
            }
        }
    }

    @Test
    fun rejectsAnUnpairedSurrogateInTheFileName() {
        assertThrows(IllegalArgumentException::class.java) {
            shareLinkFromMagnet("magnet:?xt=urn:btih:abcd", ShareLinkFile("a\uD83C", "1"))
        }
    }

    @Test
    fun rejectsAnythingThatIsNotAMagnet() {
        assertThrows(IllegalArgumentException::class.java) {
            shareLinkFromMagnet("https://example.com/")
        }
        assertThrows(IllegalArgumentException::class.java) { shareLinkFromMagnet("magnet:") }
    }
}
