package org.rstorrent.bootstrap.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.alreadyPresentNotice
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.RemovalState
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit

class TorrentActionsTest {
    @Test
    fun alreadyPresentNoticeCountsDistinctMatchesAndKeepsArchivedOnes() {
        val torrents =
            listOf(torrent("visible"), torrent("archived", archived = true)).associateBy { it.torrentId }

        assertEquals(null, alreadyPresentNotice(1L, emptyList(), torrents, resumeOnRestore = true))
        val notice =
            alreadyPresentNotice(
                2L,
                listOf("visible", "archived", "archived", "unknown"),
                torrents,
                resumeOnRestore = true,
            )!!
        assertEquals(3, notice.count)
        assertEquals(listOf("archived"), notice.archivedTorrentIds)
        assertTrue(notice.resumeOnRestore)
    }

    @Test
    fun archivedTorrentsAppearOnlyInTheArchivedTab() {
        val archivedComplete = torrent("archived", state = TorrentState.COMPLETE, archived = true)
        val complete = torrent("complete", state = TorrentState.COMPLETE)
        val queued = torrent("queued", operational = TorrentOperationalState.QUEUED, queue = 1U)
        val all = listOf(archivedComplete, complete, queued)

        fun ids(filter: LibraryFilter) =
            filteredAndSortedTorrents(all, filter, LibrarySort.NAME).map(TorrentView::torrentId)

        assertEquals(listOf("complete", "queued"), ids(LibraryFilter.ALL))
        assertEquals(listOf("complete"), ids(LibraryFilter.FINISHED))
        assertEquals(listOf("queued"), ids(LibraryFilter.QUEUED))
        assertEquals(listOf("archived"), ids(LibraryFilter.ARCHIVED))
    }

    @Test
    fun archivedTorrentsCanOnlyBeRestoredRecheckedCopiedOrRemoved() {
        val archived =
            torrent("archived", operational = TorrentOperationalState.PAUSED, queue = 2U, archived = true)

        assertEquals(
            setOf(
                TorrentAction.FORCE_RECHECK,
                TorrentAction.RESTORE,
                TorrentAction.COPY_MAGNET,
                TorrentAction.REMOVE,
            ),
            TorrentAction.entries.filter(archived::allows).toSet(),
        )
    }

    @Test
    fun selectionActionsTargetOnlyApplicableTorrents() {
        val paused = torrent("paused", operational = TorrentOperationalState.PAUSED, queue = 1U)
        val running = torrent("running", queue = 2U)
        val seeding = torrent("seeding", operational = TorrentOperationalState.SEEDING)
        val pending = torrent("pending", operational = TorrentOperationalState.PAUSED, awaitingSelection = true)
        val selection = listOf(paused, running, seeding, pending)

        assertEquals(listOf("paused"), selection.targetsFor(TorrentAction.START))
        assertEquals(listOf("running", "seeding"), selection.targetsFor(TorrentAction.PAUSE))
        assertEquals(listOf("paused", "running"), selection.targetsFor(TorrentAction.MOVE_TOP))
        assertEquals(listOf("paused", "running", "seeding"), selection.targetsFor(TorrentAction.ARCHIVE))
        assertEquals(emptyList<String>(), selection.targetsFor(TorrentAction.RESTORE))
    }

    @Test
    fun removalInProgressBlocksEverythingExceptCopy() {
        val removing =
            torrent("removing", operational = TorrentOperationalState.PAUSED, removal = RemovalState.PENDING)
        val failed =
            torrent("failed", operational = TorrentOperationalState.PAUSED, removal = RemovalState.FAILED)

        assertEquals(setOf(TorrentAction.COPY_MAGNET), TorrentAction.entries.filter(removing::allows).toSet())
        assertTrue(failed.allows(TorrentAction.REMOVE))
        assertTrue(removing.removalActive)
        assertTrue(
            torrent("platform", removal = RemovalState.AWAITING_PLATFORM).removalActive,
        )
        assertFalse(failed.removalActive)
        assertFalse(failed.allows(TorrentAction.START))
    }

    private fun torrent(
        id: String,
        state: TorrentState = TorrentState.DOWNLOADING,
        operational: TorrentOperationalState = TorrentOperationalState.DOWNLOADING,
        queue: UInt? = null,
        archived: Boolean = false,
        awaitingSelection: Boolean = false,
        removal: RemovalState? = null,
    ): TorrentView =
        TorrentView(
            torrentId = id,
            protocolIdentities = TorrentProtocolIdentities(v1 = null, v2 = null),
            displayName = id,
            sourceDisplayName = null,
            state = state,
            operationalState = operational,
            downloadQueuePosition = queue,
            transferLimits =
                TorrentTransferLimits(TransferRateLimit.Unlimited, TransferRateLimit.Unlimited),
            storageState = StorageState.AVAILABLE,
            storageRoot = "downloads",
            metadataAvailable = true,
            awaitingFileSelection = awaitingSelection,
            pendingFileSelectionPosition = null,
            fileCatalogId = null,
            selectableFileCount = 0U,
            selectedFileCount = 0U,
            selectableFileBytes = "0",
            selectedFileBytes = "0",
            pieceCount = 10U,
            totalSizeBytes = "100",
            verifiedPieceCount = 0U,
            requestedBytes = "0",
            receivedBytes = "0",
            storedBytes = "0",
            activePeerConnections = 0U,
            configuredTrackerCount = 1U,
            payloadDownloadRateBytes = "0",
            requiredPayloadBytes = "100",
            remainingPayloadBytes = "100",
            etaPayloadDownloadRateBytes = "0",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", "0", "0", "0", "0", "0"),
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null, null),
            progress =
                ProgressAssessment(
                    ProgressDisposition.ACTIVE,
                    ProgressPhase.TRANSFER,
                    ProgressReason.TRANSFERRING_PIECES,
                    emptyList(),
                ),
            checking = null,
            archived = archived,
            removalState = removal,
            deleteDataSupported = true,
            forceRecheckAvailable = true,
            error = null,
        )
}
