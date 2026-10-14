package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.MagnetPeerHint
import org.rstorrent.session.uniffi.MagnetPeerHintOmission
import org.rstorrent.session.uniffi.MagnetPeerHintScope
import org.rstorrent.session.uniffi.MediaFileAvailability

class ShareFlowTest {
    @Test
    fun choiceRoundTripsItsStoredValueAndDefaultsToAsk() {
        for (choice in SharePeerHintChoice.entries) {
            assertEquals(choice, SharePeerHintChoice.decode(choice.persistedValue))
        }
        assertEquals(listOf("ask", "include", "omit"), SharePeerHintChoice.entries.map { it.persistedValue })
        assertEquals(SharePeerHintChoice.ASK, SharePeerHintChoice.decode(null))
        assertEquals(SharePeerHintChoice.ASK, SharePeerHintChoice.decode("INCLUDE"))
        assertEquals(SharePeerHintChoice.ASK, SharePeerHintChoice.decode(""))
    }

    @Test
    fun privateTorrentsNeverAskOrIncludeAHint() {
        for (choice in SharePeerHintChoice.entries) {
            for (metadata in listOf(true, false)) {
                assertEquals(
                    SharePeerHintDecision.OMIT,
                    sharePeerHintDecision(privateTorrent = true, metadataAvailable = metadata, choice = choice),
                )
            }
        }
    }

    @Test
    fun rememberedChoicesApplyAndAskPromptsOnlyWithMetadata() {
        assertEquals(
            SharePeerHintDecision.PROMPT,
            sharePeerHintDecision(false, metadataAvailable = true, choice = SharePeerHintChoice.ASK),
        )
        assertEquals(
            SharePeerHintDecision.OMIT,
            sharePeerHintDecision(false, metadataAvailable = false, choice = SharePeerHintChoice.ASK),
        )
        for (metadata in listOf(true, false)) {
            assertEquals(
                SharePeerHintDecision.INCLUDE,
                sharePeerHintDecision(false, metadata, SharePeerHintChoice.INCLUDE),
            )
            assertEquals(
                SharePeerHintDecision.OMIT,
                sharePeerHintDecision(false, metadata, SharePeerHintChoice.OMIT),
            )
        }
    }

    @Test
    fun fileShareUsesSortedUniqueNonPaddingIndices() {
        val request =
            requireNotNull(
                fileShareRequest(
                    "t",
                    "Album",
                    privateTorrent = false,
                    files = listOf(file(4U), file(1U, padding = true), file(2U), file(4U)),
                ),
            )
        assertEquals(listOf(2U, 4U), request.fileIndices)
        assertEquals("Album", request.title)
        assertNull(request.file)
        assertEquals("t", request.torrentId)
    }

    @Test
    fun singleFileShareCarriesItsBaseNameAndSize() {
        val request =
            requireNotNull(
                fileShareRequest(
                    "t",
                    "Album",
                    privateTorrent = true,
                    files = listOf(file(3U, path = listOf("Disc 1", "03 Song.flac"), length = "31337")),
                ),
            )
        assertEquals(listOf(3U), request.fileIndices)
        assertEquals(ShareLinkFile("03 Song.flac", "31337"), request.file)
        assertEquals("03 Song.flac", request.title)
        assertEquals(true, request.privateTorrent)
        assertEquals(true, request.metadataAvailable)
    }

    @Test
    fun fileShareRejectsNothingOrTooMany() {
        assertNull(fileShareRequest("t", "A", false, emptyList()))
        assertNull(fileShareRequest("t", "A", false, listOf(file(0U, padding = true))))
        assertNull(fileShareRequest("t", "A", false, (0U until 4097U).map { file(it) }))
        assertEquals(
            4096,
            fileShareRequest("t", "A", false, (0U until 4096U).map { file(it) })?.fileIndices?.size,
        )
    }

    @Test
    fun noticesSayWhetherTheAddressWasAddedAndWhyNot() {
        assertNull(shareLinkNoticeRes(export(requested = false)))
        assertEquals(
            R.string.share_private_notice,
            shareLinkNoticeRes(export(requested = false, privateTorrent = true)),
        )
        assertEquals(
            R.string.share_hint_included,
            shareLinkNoticeRes(
                export(
                    hints =
                        listOf(
                            MagnetPeerHint("192.168.1.2:6881", MagnetPeerHintScope.LOCAL_NETWORK),
                            MagnetPeerHint("203.0.113.9:6881", MagnetPeerHintScope.INTERNET),
                        ),
                ),
            ),
        )
        assertEquals(
            R.string.share_hint_included_local,
            shareLinkNoticeRes(
                export(hints = listOf(MagnetPeerHint("192.168.1.2:6881", MagnetPeerHintScope.LOCAL_NETWORK))),
            ),
        )
        val omissions =
            mapOf(
                MagnetPeerHintOmission.PRIVATE_TORRENT to R.string.share_private_notice,
                MagnetPeerHintOmission.METADATA_PENDING to R.string.share_hint_omitted_metadata_pending,
                MagnetPeerHintOmission.INCOMING_DISABLED to R.string.share_hint_omitted_incoming_off,
                MagnetPeerHintOmission.NOT_REACHABLE to R.string.share_hint_omitted_not_reachable,
                MagnetPeerHintOmission.NO_ADDRESS to R.string.share_hint_omitted_no_address,
            )
        assertEquals(MagnetPeerHintOmission.entries.toSet(), omissions.keys)
        for ((omission, message) in omissions) {
            assertEquals(message, peerHintOmissionRes(omission))
            assertEquals(message, shareLinkNoticeRes(export(omission = omission)))
        }
        assertNull(shareLinkNoticeRes(export()))
    }

    private fun export(
        requested: Boolean = true,
        privateTorrent: Boolean = false,
        hints: List<MagnetPeerHint> = emptyList(),
        omission: MagnetPeerHintOmission? = null,
    ): ShareLinkExport =
        ShareLinkExport(
            request = ShareLinkRequest("t", "Name", privateTorrent, metadataAvailable = true),
            link = "https://jstorrent.com/share/#xt=urn:btih:abcd",
            peerHintRequested = requested,
            peerHints = hints,
            peerHintOmission = omission,
        )

    private fun file(
        index: UInt,
        padding: Boolean = false,
        path: List<String> = listOf("file-$index.bin"),
        length: String = "1024",
    ): FileView =
        FileView(
            fileId = "f$index",
            fileIndex = index,
            path = path,
            lengthBytes = length,
            torrentOffsetBytes = "0",
            firstPiece = index,
            lastPiece = index,
            selection = if (padding) null else FileSelectionView.NORMAL,
            padding = padding,
            doneBytes = "0",
            verifiedBytes = "0",
            mediaAvailability = MediaFileAvailability.UNVERIFIED,
        )
}
