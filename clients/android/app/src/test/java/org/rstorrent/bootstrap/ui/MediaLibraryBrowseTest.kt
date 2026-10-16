package org.rstorrent.bootstrap.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.LIBRARY_TORRENT_ID
import org.rstorrent.bootstrap.libraryMediaItem
import org.rstorrent.session.uniffi.LibraryArchivedFilter
import org.rstorrent.session.uniffi.LibraryAvailabilityFilter
import org.rstorrent.session.uniffi.LibraryGrouping
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.LibraryMediaSort

class MediaLibraryBrowseTest {
    @Test
    fun presetsMatchTheWebQueries() {
        val all = libraryMediaRequest(LibraryBrowseState()).query
        assertEquals(emptyList<LibraryMediaKind>(), all.kinds)
        assertEquals(emptyList<LibraryMediaRole>(), all.roles)
        assertEquals(LibraryGrouping.UNGROUPED, all.grouping)
        assertEquals(LibraryArchivedFilter.EXCLUDE, all.archived)

        val shows = libraryMediaRequest(LibraryBrowseState(preset = LibraryPreset.SHOWS)).query
        assertEquals(listOf(LibraryMediaKind.VIDEO), shows.kinds)
        assertEquals(listOf(LibraryMediaRole.EPISODE), shows.roles)
        assertEquals(LibraryGrouping.SERIES, shows.grouping)
        val episodes =
            libraryMediaRequest(
                LibraryBrowseState(preset = LibraryPreset.SHOWS, grouped = false),
            ).query
        assertEquals(LibraryGrouping.UNGROUPED, episodes.grouping)

        val movies = libraryMediaRequest(LibraryBrowseState(preset = LibraryPreset.MOVIES)).query
        assertEquals(emptyList<LibraryMediaKind>(), movies.kinds)
        assertEquals(listOf(LibraryMediaRole.MOVIE), movies.roles)
        assertEquals(LibraryGrouping.UNGROUPED, movies.grouping)

        val music = libraryMediaRequest(LibraryBrowseState(preset = LibraryPreset.MUSIC)).query
        assertEquals(listOf(LibraryMediaKind.AUDIO), music.kinds)
        assertEquals(LibraryGrouping.ALBUM, music.grouping)

        // By torrent always groups; the item toggle does not apply.
        val torrents =
            libraryMediaRequest(
                LibraryBrowseState(preset = LibraryPreset.TORRENTS, grouped = false),
            ).query
        assertEquals(LibraryGrouping.TORRENT, torrents.grouping)
        assertFalse(LibraryPreset.TORRENTS.offersItemToggle)
        assertTrue(LibraryPreset.SHOWS.offersItemToggle && LibraryPreset.MUSIC.offersItemToggle)
    }

    @Test
    fun openedShowsReadInTitleOrderWhileTorrentGroupsKeepTheSort() {
        val sorted =
            LibraryBrowseState(sort = LibraryMediaSort.SIZE, descending = true)
        val show =
            libraryMediaRequest(
                sorted.copy(
                    preset = LibraryPreset.SHOWS,
                    group = LibraryGroupSelection("series:show name", "Show Name"),
                ),
            ).query
        assertEquals("series:show name", show.groupId)
        assertNull(show.torrentId)
        assertEquals(LibraryGrouping.UNGROUPED, show.grouping)
        assertEquals(LibraryMediaSort.TITLE, show.sort)
        assertFalse(show.descending)

        val torrent =
            libraryMediaRequest(
                sorted.copy(
                    preset = LibraryPreset.TORRENTS,
                    group = LibraryGroupSelection("torrent:$LIBRARY_TORRENT_ID", "Show Name"),
                ),
            ).query
        assertEquals(LIBRARY_TORRENT_ID, torrent.torrentId)
        assertNull(torrent.groupId)
        assertEquals(LibraryGrouping.UNGROUPED, torrent.grouping)
        assertEquals(LibraryMediaSort.SIZE, torrent.sort)
        assertTrue(torrent.descending)
    }

    @Test
    fun pagesTextAndScopeReachTheRequest() {
        val request =
            libraryMediaRequest(
                LibraryBrowseState(
                    text = "  north shore ",
                    availability = LibraryAvailabilityFilter.INCOMPLETE,
                    includeArchived = true,
                    page = 2,
                ),
            )
        assertEquals("north shore", request.query.text)
        assertEquals(LibraryAvailabilityFilter.INCOMPLETE, request.query.availability)
        assertEquals(LibraryArchivedFilter.INCLUDE, request.query.archived)
        assertEquals(200U, request.offset)
        assertEquals(100U, request.limit)
        // Equal states make equal requests, so a stamped page matches its screen.
        assertEquals(request, libraryMediaRequest(LibraryBrowseState(
            text = "north shore",
            availability = LibraryAvailabilityFilter.INCOMPLETE,
            includeArchived = true,
            page = 2,
        )))
    }

    @Test
    fun searchTextStaysWithinTheHostBounds() {
        assertEquals("North Shore S01", boundedLibrarySearch("North Shore S01"))
        val sixteen = (1..16).joinToString(" ") { "w$it" }
        assertEquals(sixteen, boundedLibrarySearch(sixteen))
        assertEquals("$sixteen ", boundedLibrarySearch("$sixteen w17 w18"))
        // Repeated words count once, as on the host.
        val repeated = (1..40).joinToString(" ") { "same" }
        assertEquals(repeated, boundedLibrarySearch(repeated))
        // Separators split words, so dotted names count each part.
        val dotted = (1..20).joinToString(".") { "p$it" }
        assertEquals((1..16).joinToString(".") { "p$it" } + ".", boundedLibrarySearch(dotted))
        val wide = "é".repeat(200)
        assertEquals(128, boundedLibrarySearch(wide).length)
        assertTrue(boundedLibrarySearch(wide).toByteArray(Charsets.UTF_8).size <= 256)
        // A surrogate pair is never split.
        val emoji = "a" + "😀".repeat(80)
        assertEquals(1 + 63 * 2, boundedLibrarySearch(emoji).length)
    }

    @Test
    fun itemProgressIsVerifiedBytesOverLength() {
        assertEquals(0f, libraryItemProgress(libraryMediaItem(verifiedBytes = "0")))
        assertEquals(0.5f, libraryItemProgress(libraryMediaItem(verifiedBytes = "512")))
        assertEquals(1f, libraryItemProgress(libraryMediaItem(verifiedBytes = "1024")))
    }
}
