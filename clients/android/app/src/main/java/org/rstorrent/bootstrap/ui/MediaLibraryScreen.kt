package org.rstorrent.bootstrap.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Album
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.VideoFile
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.rstorrent.bootstrap.AndroidMediaPlaybackPolicy
import org.rstorrent.bootstrap.LibraryMediaRequest
import org.rstorrent.bootstrap.LibraryMediaViewState
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.LibraryAvailabilityFilter
import org.rstorrent.session.uniffi.LibraryGroupView
import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.LibraryMediaSort

private const val SEARCH_DEBOUNCE_MILLIS = 300L

/**
 * Video and audio across every torrent (Tactical 376). The screen leases one
 * page for its current request and shows a page only when it answers that
 * request, so an earlier preset or search is never presented as current.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MediaLibraryScreen(
    state: ProductState,
    presentationOwner: Any?,
    onPresent: (LibraryMediaRequest) -> Unit,
    onOpenTorrent: (String) -> Unit,
    onPlay: (LibraryMediaItemView) -> Unit,
    onAdd: () -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onSelectStorage: () -> Unit,
    onAddTestTorrents: ((List<TestTorrent>) -> Unit)?,
    onSpeed: () -> Unit,
    onDht: () -> Unit,
    onLogs: () -> Unit,
    onSettings: () -> Unit,
    onShutdown: () -> Unit,
) {
    var browse by rememberSaveable(stateSaver = LibraryBrowseSaver) {
        mutableStateOf(LibraryBrowseState())
    }
    var searchOpen by rememberSaveable { mutableStateOf(browse.text.isNotEmpty()) }
    var searchInput by rememberSaveable { mutableStateOf(browse.text) }
    var optionsOpen by remember { mutableStateOf(false) }
    var overflowOpen by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LaunchedEffect(searchInput) {
        if (searchInput.trim() == browse.text.trim()) return@LaunchedEffect
        delay(SEARCH_DEBOUNCE_MILLIS)
        browse = browse.copy(text = searchInput, page = 0)
    }
    val request = libraryMediaRequest(browse)
    LaunchedEffect(presentationOwner, request) { onPresent(request) }
    // A new query starts at the top; returning from a torrent keeps the position.
    var shownRequest by remember { mutableStateOf(request) }
    LaunchedEffect(request) {
        if (request != shownRequest) {
            shownRequest = request
            listState.scrollToItem(0)
        }
    }
    val page = state.libraryMedia?.takeIf { it.request == request }
    BackHandler(enabled = browse.group != null) {
        browse = browse.copy(group = null, page = 0)
    }
    BackHandler(enabled = browse.group == null && searchOpen) {
        searchOpen = false
        searchInput = ""
    }

    Scaffold(
        topBar = {
            val group = browse.group
            when {
                group != null ->
                    TopAppBar(
                        navigationIcon = {
                            IconButton(onClick = { browse = browse.copy(group = null, page = 0) }) {
                                Icon(
                                    Icons.AutoMirrored.Outlined.ArrowBack,
                                    contentDescription = stringResource(R.string.action_back),
                                )
                            }
                        },
                        title = {
                            Text(group.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        actions = {
                            libraryTorrentId(group)?.let { torrentId ->
                                IconButton(onClick = { onOpenTorrent(torrentId) }) {
                                    Icon(
                                        Icons.Outlined.Info,
                                        contentDescription =
                                            stringResource(R.string.a11y_torrent_details),
                                    )
                                }
                            }
                            LibraryOptionsMenu(
                                browse = browse,
                                expanded = optionsOpen,
                                onExpand = { optionsOpen = it },
                                onChange = { browse = it.copy(page = 0) },
                            )
                        },
                    )
                searchOpen ->
                    TopAppBar(
                        navigationIcon = {
                            IconButton(onClick = {
                                searchOpen = false
                                searchInput = ""
                            }) {
                                Icon(
                                    Icons.AutoMirrored.Outlined.ArrowBack,
                                    contentDescription = stringResource(R.string.a11y_close_search),
                                )
                            }
                        },
                        title = {
                            val focus = remember { FocusRequester() }
                            LaunchedEffect(Unit) { focus.requestFocus() }
                            TextField(
                                value = searchInput,
                                onValueChange = { searchInput = boundedLibrarySearch(it) },
                                placeholder = { Text(stringResource(R.string.media_library_search)) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                                colors =
                                    TextFieldDefaults.colors(
                                        focusedContainerColor = Color.Transparent,
                                        unfocusedContainerColor = Color.Transparent,
                                    ),
                                modifier =
                                    Modifier.fillMaxWidth().focusRequester(focus)
                                        .testTag("library-search"),
                            )
                        },
                        actions = {
                            if (searchInput.isNotEmpty()) {
                                IconButton(onClick = { searchInput = "" }) {
                                    Icon(
                                        Icons.Outlined.Close,
                                        contentDescription =
                                            stringResource(R.string.a11y_clear_search),
                                    )
                                }
                            }
                        },
                    )
                else ->
                    TopAppBar(
                        title = { PrimaryTitle(state, onSpeed) },
                        actions = {
                            IconButton(onClick = { searchOpen = true }) {
                                Icon(
                                    Icons.Outlined.Search,
                                    contentDescription = stringResource(R.string.a11y_search_library),
                                )
                            }
                            LibraryOptionsMenu(
                                browse = browse,
                                expanded = optionsOpen,
                                onExpand = { optionsOpen = it },
                                onChange = { browse = it.copy(page = 0) },
                            )
                            Box {
                                IconButton(onClick = { overflowOpen = true }) {
                                    Icon(
                                        Icons.Outlined.MoreVert,
                                        contentDescription = stringResource(R.string.a11y_more_options),
                                    )
                                }
                                PrimaryOverflowMenu(
                                    expanded = overflowOpen,
                                    onDismiss = { overflowOpen = false },
                                    onPauseAll = {
                                        state.torrents.values
                                            .targetsFor(TorrentAction.PAUSE)
                                            .forEach(onPause)
                                    },
                                    onResumeAll = {
                                        state.torrents.values
                                            .targetsFor(TorrentAction.START)
                                            .forEach(onResume)
                                    },
                                    onSelectStorage = onSelectStorage,
                                    onAddTestTorrents = onAddTestTorrents,
                                    onSpeed = onSpeed,
                                    onDht = onDht,
                                    onLogs = onLogs,
                                    onSettings = onSettings,
                                    onShutdown = onShutdown,
                                )
                            }
                        },
                    )
            }
        },
        floatingActionButton = {
            val addDescription = stringResource(R.string.a11y_add_torrent)
            ExtendedFloatingActionButton(
                onClick = onAdd,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text(stringResource(R.string.action_add)) },
                modifier = Modifier.semantics { contentDescription = addDescription },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (browse.group == null) {
                ScrollableTabRow(selectedTabIndex = browse.preset.ordinal, edgePadding = 12.dp) {
                    LibraryPreset.entries.forEach { preset ->
                        Tab(
                            selected = preset == browse.preset,
                            onClick = { browse = browse.copy(preset = preset, page = 0) },
                            text = { Text(stringResource(preset.labelRes)) },
                        )
                    }
                }
                if (browse.preset.offersItemToggle) {
                    GroupingToggle(browse) { browse = browse.copy(grouped = it, page = 0) }
                }
            }
            if (page == null) {
                LinearProgressIndicator(
                    Modifier.fillMaxWidth().padding(16.dp).testTag("library-loading"),
                )
            } else {
                LibraryPage(
                    browse = browse,
                    page = page,
                    listState = listState,
                    mediaLaunchPending = state.mediaLaunchPending,
                    onOpenGroup = { group ->
                        browse =
                            browse.copy(
                                group = LibraryGroupSelection(group.groupId, group.title),
                                page = 0,
                            )
                    },
                    onOpenTorrent = onOpenTorrent,
                    onPlay = onPlay,
                    onPage = { offset ->
                        browse = browse.copy(page = (offset / LIBRARY_PAGE_SIZE.toUInt()).toInt())
                    },
                    onShowAll = {
                        searchOpen = false
                        searchInput = ""
                        browse =
                            LibraryBrowseState(
                                sort = browse.sort,
                                descending = browse.descending,
                            )
                    },
                )
            }
        }
    }
}

private fun libraryTorrentId(group: LibraryGroupSelection): String? =
    group.id.takeIf { it.startsWith("torrent:") }?.removePrefix("torrent:")

@Composable
private fun GroupingToggle(
    browse: LibraryBrowseState,
    onGrouped: (Boolean) -> Unit,
) {
    val labels =
        if (browse.preset == LibraryPreset.SHOWS) {
            R.string.media_library_shows to R.string.media_library_episodes
        } else {
            R.string.media_library_albums to R.string.media_library_tracks
        }
    SingleChoiceSegmentedButtonRow(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        listOf(true to labels.first, false to labels.second).forEachIndexed { index, (grouped, label) ->
            SegmentedButton(
                selected = browse.grouped == grouped,
                onClick = { if (browse.grouped != grouped) onGrouped(grouped) },
                shape = SegmentedButtonDefaults.itemShape(index, 2),
            ) {
                Text(stringResource(label), maxLines = 1)
            }
        }
    }
}

@Composable
private fun LibraryOptionsMenu(
    browse: LibraryBrowseState,
    expanded: Boolean,
    onExpand: (Boolean) -> Unit,
    onChange: (LibraryBrowseState) -> Unit,
) {
    Box {
        IconButton(onClick = { onExpand(true) }) {
            Icon(
                Icons.Outlined.Tune,
                contentDescription = stringResource(R.string.a11y_library_options),
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { onExpand(false) }) {
            @Composable
            fun Choice(label: Int, selected: Boolean, choose: () -> Unit) {
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        choose()
                        onExpand(false)
                    },
                    leadingIcon = {
                        if (selected) Text(stringResource(R.string.selection_mark))
                    },
                )
            }

            @Composable
            fun Toggle(label: Int, checked: Boolean, toggle: () -> Unit) {
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = toggle,
                    leadingIcon = { Checkbox(checked = checked, onCheckedChange = null) },
                )
            }

            if (browse.sortApplies) {
                MenuSection(R.string.media_library_section_sort)
                listOf(
                    LibraryMediaSort.TITLE to R.string.media_library_sort_title,
                    LibraryMediaSort.SIZE to R.string.media_library_sort_size,
                    LibraryMediaSort.SOURCE to R.string.media_library_sort_source,
                ).forEach { (sort, label) ->
                    Choice(label, browse.sort == sort) { onChange(browse.copy(sort = sort)) }
                }
                Toggle(R.string.media_library_sort_reverse, browse.descending) {
                    onChange(browse.copy(descending = !browse.descending))
                }
                HorizontalDivider()
            }
            MenuSection(R.string.media_library_section_show)
            listOf(
                LibraryAvailabilityFilter.ANY to R.string.media_library_availability_any,
                LibraryAvailabilityFilter.OFFLINE to R.string.media_library_availability_offline,
                LibraryAvailabilityFilter.INCOMPLETE to R.string.media_library_availability_incomplete,
            ).forEach { (availability, label) ->
                Choice(label, browse.availability == availability) {
                    onChange(browse.copy(availability = availability))
                }
            }
            Toggle(R.string.media_library_include_archived, browse.includeArchived) {
                onChange(browse.copy(includeArchived = !browse.includeArchived))
            }
        }
    }
}

@Composable
private fun MenuSection(label: Int) {
    Text(
        stringResource(label),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun LibraryPage(
    browse: LibraryBrowseState,
    page: LibraryMediaViewState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    mediaLaunchPending: Boolean,
    onOpenGroup: (LibraryGroupView) -> Unit,
    onOpenTorrent: (String) -> Unit,
    onPlay: (LibraryMediaItemView) -> Unit,
    onPage: (UInt) -> Unit,
    onShowAll: () -> Unit,
) {
    val pending = page.facets.metadataPending.toInt()
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 96.dp),
    ) {
        if (pending > 0) {
            item("metadata-pending") {
                Text(
                    pluralStringResource(R.plurals.media_library_metadata_pending, pending, pending),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
        if (page.items.isEmpty() && page.groups.isEmpty()) {
            item("empty") {
                val libraryEmpty = page.facets.items == 0U && browse.text.isBlank() &&
                    !browse.includeArchived
                EmptyMediaLibrary(libraryEmpty, onShowAll)
            }
        }
        items(page.groups, key = { "group-${it.groupId}" }) { group ->
            LibraryGroupRow(group) { onOpenGroup(group) }
            HorizontalDivider()
        }
        items(page.items, key = { "item-${it.itemId}" }) { item ->
            LibraryItemRow(
                item = item,
                playEnabled =
                    AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(item, mediaLaunchPending),
                onOpen = { onOpenTorrent(item.torrentId) },
                onPlay = { onPlay(item) },
            )
            HorizontalDivider()
        }
        item("pager") { CatalogPager(page.page, onPage) }
    }
}

@Composable
private fun EmptyMediaLibrary(
    libraryEmpty: Boolean,
    onShowAll: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.VideoLibrary,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(
                if (libraryEmpty) R.string.media_library_empty else R.string.media_library_no_matches,
            ),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        if (libraryEmpty) {
            Text(
                stringResource(R.string.media_library_empty_hint),
                modifier = Modifier.padding(top = 4.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            TextButton(onClick = onShowAll, modifier = Modifier.padding(top = 4.dp)) {
                Text(stringResource(R.string.media_library_show_all))
            }
        }
    }
}

@Composable
private fun LibraryGroupRow(
    group: LibraryGroupView,
    onOpen: () -> Unit,
) {
    val count = group.itemCount.toInt()
    val (icon, detail) =
        when {
            group.groupId.startsWith("series:") -> {
                val seasons = group.seasonCount.toInt()
                val episodes = pluralStringResource(R.plurals.media_library_episode_count, count, count)
                Icons.Outlined.Tv to
                    if (seasons > 0) {
                        stringResource(
                            R.string.media_library_detail_pair,
                            episodes,
                            pluralStringResource(R.plurals.media_library_season_count, seasons, seasons),
                        )
                    } else {
                        episodes
                    }
            }
            group.groupId.startsWith("album:") -> {
                val tracks = pluralStringResource(R.plurals.media_library_track_count, count, count)
                Icons.Outlined.Album to
                    (
                        group.year?.let {
                            stringResource(R.string.media_library_detail_pair, tracks, it.toString())
                        } ?: tracks
                    )
            }
            else ->
                Icons.Outlined.Folder to pluralStringResource(R.plurals.file_count, count, count)
        }
    ListItem(
        headlineContent = { Text(group.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Text(stringResource(R.string.media_library_detail_pair, detail, formatBytes(group.totalBytes)))
        },
        leadingContent = { Icon(icon, contentDescription = null) },
        modifier = Modifier.clickable(onClick = onOpen).testTag("library-group-${group.groupId}"),
    )
}

@Composable
private fun LibraryItemRow(
    item: LibraryMediaItemView,
    playEnabled: Boolean,
    onOpen: () -> Unit,
    onPlay: () -> Unit,
) {
    val description = libraryItemDescription(item)
    val size = formatBytes(item.lengthBytes)
    // Partial files show how much is verified, never just their size.
    val progress =
        if (item.offline) {
            null
        } else {
            stringResource(R.string.media_library_progress, percentLabel(libraryItemProgress(item)))
        }
    val supporting =
        listOfNotNull(
            description,
            progress,
            size,
            stringResource(R.string.library_filter_archived).takeIf { item.archived },
        ).joinToString(stringResource(R.string.media_library_separator))
    ListItem(
        headlineContent = { Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(supporting, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        leadingContent = { Icon(libraryItemIcon(item), contentDescription = null) },
        trailingContent = {
            if (item.kind == LibraryMediaKind.VIDEO) {
                IconButton(onClick = onPlay, enabled = playEnabled) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = stringResource(R.string.action_play),
                    )
                }
            }
        },
        modifier = Modifier.clickable(onClick = onOpen).testTag("library-item-${item.itemId}"),
    )
}

private fun libraryItemIcon(item: LibraryMediaItemView): ImageVector =
    when (item.role) {
        LibraryMediaRole.EPISODE -> Icons.Outlined.Tv
        LibraryMediaRole.MOVIE -> Icons.Outlined.Movie
        LibraryMediaRole.TRACK -> Icons.Outlined.MusicNote
        LibraryMediaRole.OTHER ->
            if (item.kind == LibraryMediaKind.AUDIO) Icons.Outlined.MusicNote else Icons.Outlined.VideoFile
    }

/** Verified bytes over length; a zero-length item is never listed by the host. */
internal fun libraryItemProgress(item: LibraryMediaItemView): Float {
    val length = item.lengthBytes.toDoubleOrNull()?.takeIf { it > 0.0 } ?: return 0f
    val verified = item.verifiedBytes.toDoubleOrNull() ?: 0.0
    return (verified / length).coerceIn(0.0, 1.0).toFloat()
}

@Composable
private fun libraryItemDescription(item: LibraryMediaItemView): String {
    val separator = stringResource(R.string.media_library_separator)
    return when (item.role) {
        LibraryMediaRole.EPISODE -> {
            val season = item.seasonNumber?.toInt()
            val episode = item.episodeNumber?.toInt()
            val ending = item.endingEpisodeNumber?.toInt()
            val code =
                when {
                    season != null && episode != null && ending != null ->
                        stringResource(R.string.media_library_episode_range, season, episode, ending)
                    season != null && episode != null ->
                        stringResource(R.string.media_library_episode_code, season, episode)
                    episode != null -> stringResource(R.string.media_library_episode_number, episode)
                    else -> null
                }
            // Titles taken from a release name already carry the series.
            val series = item.seriesTitle?.takeUnless { item.title.contains(it, ignoreCase = true) }
            listOfNotNull(code, series).joinToString(separator).ifEmpty { item.torrentName }
        }
        LibraryMediaRole.TRACK ->
            listOfNotNull(
                item.albumTitle,
                item.trackNumber?.let { stringResource(R.string.media_library_track, it.toInt()) },
            ).joinToString(separator).ifEmpty { item.torrentName }
        LibraryMediaRole.MOVIE -> item.year?.toString() ?: item.torrentName
        LibraryMediaRole.OTHER -> item.torrentName
    }
}
