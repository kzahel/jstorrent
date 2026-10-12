package org.rstorrent.bootstrap.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TestTorrentsTest {
    @Test
    fun androidTestTorrentsMatchTheWebList() {
        // Gradle runs unit tests from the app module directory.
        val web = File("../../web/src/inspection/testTorrents.ts").readText()
        val sources =
            Regex(
                """id: "([^"]+)",\s*name: "[^"]*",\s*menuLabel: "[^"]*",\s*""" +
                    """infoHash: "([0-9a-f]{40})",\s*encodedName: "([^"]+)"""",
            ).findAll(web).map { Triple(it.groupValues[1], it.groupValues[2], it.groupValues[3]) }.toList()

        assertEquals(
            sources,
            WEBTORRENT_TEST_TORRENTS.map { Triple(it.id, it.infoHash, it.encodedName) },
        )
        WEBTORRENT_TEST_TORRENTS.forEach {
            assertTrue(it.magnet.startsWith("magnet:?xt=urn:btih:${it.infoHash}&dn="))
        }
    }
}
