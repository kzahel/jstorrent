package org.rstorrent.bootstrap

import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.MediaFileAvailability

internal const val LIBRARY_TORRENT_ID = "t1-0123456789abcdef0123456789abcdef"

internal fun libraryMediaItem(
    index: UInt = 0U,
    fileName: String = "Show.Name.S01E0${index + 1U}.mkv",
    extension: String = "mkv",
    kind: LibraryMediaKind = LibraryMediaKind.VIDEO,
    role: LibraryMediaRole = LibraryMediaRole.EPISODE,
    verifiedBytes: String = "0",
    availability: MediaFileAvailability = MediaFileAvailability.UNVERIFIED,
): LibraryMediaItemView =
    LibraryMediaItemView(
        itemId = "$LIBRARY_TORRENT_ID:$index",
        torrentId = LIBRARY_TORRENT_ID,
        torrentName = "Show Name",
        fileIndex = index,
        fileName = fileName,
        title = "Episode ${index + 1U}",
        kind = kind,
        role = role,
        seriesTitle = "Show Name",
        seriesId = "series:show name",
        seasonNumber = 1U.toUShort(),
        episodeNumber = (index + 1U).toUShort(),
        endingEpisodeNumber = null,
        albumTitle = null,
        albumId = null,
        discNumber = null,
        trackNumber = null,
        year = null,
        extension = extension,
        lengthBytes = "1024",
        verifiedBytes = verifiedBytes,
        offline = verifiedBytes == "1024",
        archived = false,
        mediaAvailability = availability,
    )
