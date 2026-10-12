package org.rstorrent.bootstrap.ui

/** A public WebTorrent sample offered by the debug-only library menu. */
internal data class TestTorrent(
    val id: String,
    val label: String,
    val infoHash: String,
    val encodedName: String,
) {
    val magnet: String
        get() =
            "magnet:?xt=urn:btih:$infoHash&dn=$encodedName&$COMMON_WEBTORRENT_PARAMETERS" +
                "&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F$id.torrent"
}

private val COMMON_WEBTORRENT_PARAMETERS =
    listOf(
        "tr=udp%3A%2F%2Fexplodie.org%3A6969",
        "tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969",
        "tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337",
        "tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969",
        "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337",
        "tr=wss%3A%2F%2Ftracker.btorrent.xyz",
        "tr=wss%3A%2F%2Ftracker.fastcast.nz",
        "tr=wss%3A%2F%2Ftracker.openwebtorrent.com",
        "ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F",
    ).joinToString("&")

/** Mirrors `clients/web/src/inspection/testTorrents.ts`; a JVM test checks they match. */
internal val WEBTORRENT_TEST_TORRENTS =
    listOf(
        TestTorrent("big-buck-bunny", "Big Buck Bunny", "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c", "Big+Buck+Bunny"),
        TestTorrent("cosmos-laundromat", "Cosmos Laundromat", "c9e15763f722f23e98a29decdfae341b98d53056", "Cosmos+Laundromat"),
        TestTorrent("sintel", "Sintel", "08ada5a7a6183aae1e09d831df6748d566095a10", "Sintel"),
        TestTorrent("tears-of-steel", "Tears of Steel", "209c8226b299b308beaf2b9cd3fb49212dbd13ec", "Tears+of+Steel"),
        TestTorrent(
            "wired-cd",
            "WIRED CD",
            "a88fda5954e89178c372716a6a78b8180ed4dad3",
            "The+WIRED+CD+-+Rip.+Sample.+Mash.+Share",
        ),
    )
