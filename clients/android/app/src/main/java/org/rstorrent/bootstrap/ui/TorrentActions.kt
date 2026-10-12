package org.rstorrent.bootstrap.ui

import org.rstorrent.session.uniffi.RemovalState
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentView

/**
 * Torrent commands offered by the library selection bar and the detail menu.
 * Each command applies only to the torrents whose current view state allows
 * it, so a mixed selection does not send commands the engine would reject.
 */
internal enum class TorrentAction {
    START,
    PAUSE,
    MOVE_TOP,
    MOVE_BOTTOM,
    FORCE_RECHECK,
    ARCHIVE,
    RESTORE,
    COPY_MAGNET,
    REMOVE,
}

internal fun TorrentView.allows(action: TorrentAction): Boolean {
    if (action == TorrentAction.COPY_MAGNET) return true
    if (action == TorrentAction.REMOVE) {
        return removalState != RemovalState.PENDING && removalState != RemovalState.AWAITING_PLATFORM
    }
    if (removalState != null) return false
    val paused = operationalState == TorrentOperationalState.PAUSED
    return when (action) {
        // Archived torrents stay paused; the engine rejects starting or
        // queueing them until they are restored.
        TorrentAction.START -> !archived && paused && !awaitingFileSelection
        TorrentAction.PAUSE -> !archived && !paused
        TorrentAction.MOVE_TOP,
        TorrentAction.MOVE_BOTTOM,
        -> !archived && downloadQueuePosition != null
        TorrentAction.FORCE_RECHECK -> forceRecheckAvailable
        TorrentAction.ARCHIVE -> !archived && !awaitingFileSelection
        TorrentAction.RESTORE -> archived
        TorrentAction.COPY_MAGNET,
        TorrentAction.REMOVE,
        -> error("handled above")
    }
}

internal fun Collection<TorrentView>.targetsFor(action: TorrentAction): List<String> =
    filter { it.allows(action) }.map(TorrentView::torrentId)

/**
 * Whether the torrent is running in a way Archive would pause, so Undo should
 * resume it. Checking and stopping torrents may already have paused intent.
 */
internal fun TorrentView.runningBeforeArchive(): Boolean =
    !archived &&
        removalState == null &&
        operationalState in
        setOf(
            TorrentOperationalState.QUEUED,
            TorrentOperationalState.STARTING,
            TorrentOperationalState.DOWNLOADING,
            TorrentOperationalState.SEEDING,
        )
