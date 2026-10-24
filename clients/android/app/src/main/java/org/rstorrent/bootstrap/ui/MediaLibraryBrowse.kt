package org.rstorrent.bootstrap.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import org.rstorrent.bootstrap.LibraryMediaRequest
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.LibraryArchivedFilter
import org.rstorrent.session.uniffi.LibraryAvailabilityFilter
import org.rstorrent.session.uniffi.LibraryGrouping
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaQuery
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.LibraryMediaSort

/** Library views are presets of one query (Tactical 363). */
enum class LibraryPreset(
    @StringRes val labelRes: Int,
) {
    ALL(R.string.media_library_preset_all),
    SHOWS(R.string.media_library_preset_shows),
    MOVIES(R.string.media_library_preset_movies),
    MUSIC(R.string.media_library_preset_music),
    TORRENTS(R.string.media_library_preset_torrents),
    ;

    /** Shows and Music may list their items instead of groups; By torrent always groups. */
    val offersItemToggle: Boolean
        get() = this == SHOWS || this == MUSIC
}

const val LIBRARY_PAGE_SIZE = 100

/** An opened show, album or torrent. */
data class LibraryGroupSelection(
    val id: String,
    val title: String,
)

data class LibraryBrowseState(
    val preset: LibraryPreset = LibraryPreset.ALL,
    val text: String = "",
    val availability: LibraryAvailabilityFilter = LibraryAvailabilityFilter.ANY,
    val includeArchived: Boolean = false,
    val sort: LibraryMediaSort = LibraryMediaSort.TITLE,
    val descending: Boolean = false,
    /** Shows and Music list groups first; false lists their items. */
    val grouped: Boolean = true,
    val group: LibraryGroupSelection? = null,
    val page: Int = 0,
) {
    /** A show or album reads in its natural order whatever the chosen sort. */
    val sortApplies: Boolean
        get() = group == null || preset == LibraryPreset.TORRENTS
}

/** The host query and page for the current Library presentation. */
internal fun libraryMediaRequest(browse: LibraryBrowseState): LibraryMediaRequest {
    var kinds = emptyList<LibraryMediaKind>()
    var roles = emptyList<LibraryMediaRole>()
    var grouping = LibraryGrouping.UNGROUPED
    when (browse.preset) {
        LibraryPreset.ALL -> Unit
        LibraryPreset.SHOWS -> {
            kinds = listOf(LibraryMediaKind.VIDEO)
            roles = listOf(LibraryMediaRole.EPISODE)
            if (browse.grouped && browse.group == null) grouping = LibraryGrouping.SERIES
        }
        LibraryPreset.MOVIES -> roles = listOf(LibraryMediaRole.MOVIE)
        LibraryPreset.MUSIC -> {
            kinds = listOf(LibraryMediaKind.AUDIO)
            if (browse.grouped && browse.group == null) grouping = LibraryGrouping.ALBUM
        }
        LibraryPreset.TORRENTS -> if (browse.group == null) grouping = LibraryGrouping.TORRENT
    }
    val torrentId =
        browse.group?.id
            ?.takeIf { it.startsWith(TORRENT_GROUP_PREFIX) }
            ?.removePrefix(TORRENT_GROUP_PREFIX)
    val groupId = browse.group?.id?.takeIf { torrentId == null }
    return LibraryMediaRequest(
        query =
            LibraryMediaQuery(
                text = browse.text.trim(),
                kinds = kinds,
                roles = roles,
                availability = browse.availability,
                archived =
                    if (browse.includeArchived) {
                        LibraryArchivedFilter.INCLUDE
                    } else {
                        LibraryArchivedFilter.EXCLUDE
                    },
                torrentId = torrentId,
                groupId = groupId,
                grouping = grouping,
                sort = if (browse.sortApplies) browse.sort else LibraryMediaSort.TITLE,
                descending = browse.sortApplies && browse.descending,
            ),
        offset = (browse.page * LIBRARY_PAGE_SIZE).toUInt(),
        limit = LIBRARY_PAGE_SIZE.toUInt(),
    )
}

private const val TORRENT_GROUP_PREFIX = "torrent:"

/** The host refuses search text over 256 UTF-8 bytes or 16 distinct words. */
private const val MAX_SEARCH_BYTES = 256
private const val MAX_SEARCH_WORDS = 16

/** The longest prefix of [input] that the host accepts as search text. */
internal fun boundedLibrarySearch(input: String): String {
    var bytes = 0
    val words = mutableSetOf<String>()
    val word = StringBuilder()
    var end = 0
    var index = 0
    fun closeWord(): Boolean {
        if (word.isNotEmpty()) words += word.toString()
        word.clear()
        return words.size <= MAX_SEARCH_WORDS
    }
    while (index < input.length) {
        val codePoint = input.codePointAt(index)
        val next = index + Character.charCount(codePoint)
        bytes += String(Character.toChars(codePoint)).toByteArray(Charsets.UTF_8).size
        if (bytes > MAX_SEARCH_BYTES) break
        // The host's words are runs of Unicode alphanumerics, lowercased.
        if (Character.isAlphabetic(codePoint) || isNumeric(codePoint)) {
            word.append(String(Character.toChars(codePoint)).lowercase())
            if (words.size + 1 > MAX_SEARCH_WORDS && word.toString() !in words) break
        } else if (!closeWord()) {
            break
        }
        end = next
        index = next
    }
    return input.substring(0, end)
}

private fun isNumeric(codePoint: Int): Boolean =
    when (Character.getType(codePoint).toByte()) {
        Character.DECIMAL_DIGIT_NUMBER,
        Character.LETTER_NUMBER,
        Character.OTHER_NUMBER,
        -> true
        else -> false
    }

/** Saved state keeps the browse position across recreation; nothing is persisted. */
internal val LibraryBrowseSaver: Saver<LibraryBrowseState, Any> =
    listSaver(
        save = {
            listOf(
                it.preset.name,
                it.text,
                it.availability.name,
                it.includeArchived,
                it.sort.name,
                it.descending,
                it.grouped,
                it.group?.id,
                it.group?.title,
                it.page,
            )
        },
        restore = { saved ->
            val groupId = saved[7] as String?
            LibraryBrowseState(
                preset = LibraryPreset.valueOf(saved[0] as String),
                text = saved[1] as String,
                availability = LibraryAvailabilityFilter.valueOf(saved[2] as String),
                includeArchived = saved[3] as Boolean,
                sort = LibraryMediaSort.valueOf(saved[4] as String),
                descending = saved[5] as Boolean,
                grouped = saved[6] as Boolean,
                group = groupId?.let { LibraryGroupSelection(it, saved[8] as String) },
                page = saved[9] as Int,
            )
        },
    )
