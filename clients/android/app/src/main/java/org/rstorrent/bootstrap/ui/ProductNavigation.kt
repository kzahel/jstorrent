package org.rstorrent.bootstrap.ui

import androidx.annotation.StringRes
import java.util.Locale
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentView

internal object ProductRoutes {
    const val TORRENTS = "torrent_list"
    const val MEDIA_LIBRARY = "media_library"
    const val DETAIL = "torrent_detail/{torrentId}?file={file}"
    const val SPEED = "speed_history"
    const val DHT = "dht_info"
    const val LOGS = "logs"
    const val SETTINGS = "settings"
    const val SETTINGS_STORAGE = "settings/storage"
    const val SETTINGS_SPEED = "settings/speed_connection_limits"
    const val SETTINGS_NOTIFICATIONS = "settings/notifications"
    const val SETTINGS_NETWORK = "settings/network"
    const val SETTINGS_POWER = "settings/power"
    const val SETTINGS_LANGUAGE = "settings/language"
    const val SETTINGS_ADVANCED = "settings/advanced"

    /** With [fileIndex], the detail opens on Files with that file shown. */
    fun detail(
        torrentId: String,
        fileIndex: UInt? = null,
    ): String =
        if (fileIndex == null) "torrent_detail/$torrentId" else "torrent_detail/$torrentId?file=$fileIndex"
}

enum class TorrentFilter(
    @StringRes val labelRes: Int,
) {
    ALL(R.string.library_filter_all),
    ACTIVE(R.string.library_filter_active),
    QUEUED(R.string.library_filter_queued),
    FINISHED(R.string.library_filter_finished),
    ARCHIVED(R.string.library_filter_archived),
    ;

    /** Archived torrents appear only in the Archived tab, never in All. */
    fun matches(torrent: TorrentView): Boolean =
        when (this) {
            ARCHIVED -> torrent.archived
            else -> !torrent.archived && matchesUnarchived(torrent)
        }

    private fun matchesUnarchived(torrent: TorrentView): Boolean =
        when (this) {
            ALL, ARCHIVED -> true
            ACTIVE ->
                torrent.operationalState in
                    setOf(
                        TorrentOperationalState.STARTING,
                        TorrentOperationalState.DOWNLOADING,
                        TorrentOperationalState.CHECKING,
                        TorrentOperationalState.STOPPING,
                        TorrentOperationalState.SEEDING,
                    )
            QUEUED -> torrent.operationalState == TorrentOperationalState.QUEUED
            FINISHED -> torrent.state == TorrentState.COMPLETE
        }
}

enum class TorrentSort(
    @StringRes val labelRes: Int,
) {
    STABLE(R.string.library_sort_stable),
    NAME(R.string.library_sort_name),
    DOWNLOAD_SPEED(R.string.library_sort_download_speed),
}

internal fun filteredAndSortedTorrents(
    torrents: Collection<TorrentView>,
    filter: TorrentFilter,
    sort: TorrentSort,
): List<TorrentView> {
    val comparator =
        when (sort) {
            TorrentSort.STABLE ->
                compareBy<TorrentView> { it.downloadQueuePosition ?: UInt.MAX_VALUE }
                    .thenBy(TorrentView::torrentId)
            TorrentSort.NAME ->
                compareBy<TorrentView> {
                    torrentPresentationName(it).lowercase(Locale.ROOT)
                }.thenBy(TorrentView::torrentId)
            TorrentSort.DOWNLOAD_SPEED ->
                compareByDescending<TorrentView> {
                    it.payloadDownloadRateBytes.toULongOrNull() ?: 0UL
                }.thenBy(::torrentPresentationName)
        }
    return torrents.filter(filter::matches).sortedWith(comparator)
}

enum class TorrentDetailTab(
    @StringRes val labelRes: Int,
) {
    DETAILS(R.string.detail_tab_details),
    STATUS(R.string.detail_tab_status),
    FILES(R.string.detail_tab_files),
    TRACKERS(R.string.detail_tab_trackers),
    PEERS(R.string.detail_tab_peers),
    PIECES(R.string.detail_tab_pieces),
}
