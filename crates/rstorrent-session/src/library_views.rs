//! Cross-torrent Library media index, query evaluation and contract values.
//!
//! The index is derived from the view hub's resident file catalogs and is
//! never persisted. It owns no lock, task, channel or I/O: the hub rebuilds it
//! inside a publish and evaluates queries against current file progress.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use rstorrent_media_catalog::{
    LibraryRole, MediaKind, album_group_key, classify_library, series_group_key,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::file_views::{FileCatalogIdentity, FileProgressModel};
use crate::media::MediaFileAvailability;
use crate::settings::bounded_utf8;
use crate::views::{CatalogPageRequest, CatalogPageView};

pub const MAX_LIBRARY_PAGE_ROWS: u32 = 128;
pub const DEFAULT_LIBRARY_PAGE_ROWS: u32 = 100;
pub const MAX_LIBRARY_QUERY_TEXT_BYTES: usize = 256;
pub const MAX_LIBRARY_QUERY_WORDS: usize = 16;
pub const MAX_LIBRARY_GROUP_ID_BYTES: usize = 512;
pub const MAX_LIBRARY_ROW_TEXT_BYTES: usize = 256;
const MAX_SEARCH_TEXT_BYTES: usize = 1_024;

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema, TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryMediaKind {
    Video,
    Audio,
}

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema, TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryMediaRole {
    Episode,
    Movie,
    Other,
    Track,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryAvailabilityFilter {
    #[default]
    Any,
    /// Every byte verified.
    Offline,
    /// Wanted but not yet verified completely.
    Incomplete,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryArchivedFilter {
    #[default]
    Exclude,
    Include,
    Only,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryGrouping {
    #[default]
    #[serde(rename = "none")]
    Ungrouped,
    Series,
    Album,
    Torrent,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum LibraryMediaSort {
    /// Series, season and episode; album, disc and track; or title.
    #[default]
    Title,
    Size,
    /// Source torrent name, then the torrent's file order.
    Source,
}

/// One Library query. Every field defaults, so a client sends only what it
/// narrows. Empty `kinds` and `roles` select the original video and audio
/// sets; a host never returns a kind or role a client did not ask for.
#[derive(
    Clone,
    Debug,
    Default,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct LibraryMediaQuery {
    /// Words that must all appear in the file path, title, series, album or
    /// source torrent name, ignoring case and separators.
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub kinds: Vec<LibraryMediaKind>,
    #[serde(default)]
    pub roles: Vec<LibraryMediaRole>,
    #[serde(default)]
    pub availability: LibraryAvailabilityFilter,
    /// Ignored when `torrent_id` selects one torrent.
    #[serde(default)]
    pub archived: LibraryArchivedFilter,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: Option<String>,
    /// A `group_id` from a grouped result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default)]
    pub grouping: LibraryGrouping,
    #[serde(default)]
    pub sort: LibraryMediaSort,
    #[serde(default)]
    pub descending: bool,
}

impl LibraryMediaQuery {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.text.len() > MAX_LIBRARY_QUERY_TEXT_BYTES {
            return Err(format!(
                "library search text exceeds {MAX_LIBRARY_QUERY_TEXT_BYTES} bytes"
            ));
        }
        if search_words(&self.text).len() > MAX_LIBRARY_QUERY_WORDS {
            return Err(format!(
                "library search text exceeds {MAX_LIBRARY_QUERY_WORDS} words"
            ));
        }
        if self.kinds.iter().collect::<BTreeSet<_>>().len() != self.kinds.len() {
            return Err("library kinds repeat".to_owned());
        }
        if self.roles.iter().collect::<BTreeSet<_>>().len() != self.roles.len() {
            return Err("library roles repeat".to_owned());
        }
        if let Some(torrent_id) = &self.torrent_id
            && !valid_torrent_id(torrent_id)
        {
            return Err("library torrent ID is invalid".to_owned());
        }
        if let Some(group_id) = &self.group_id
            && (group_id.len() > MAX_LIBRARY_GROUP_ID_BYTES
                || !["series:", "album:", "torrent:"]
                    .iter()
                    .any(|prefix| group_id.starts_with(prefix)))
        {
            return Err("library group ID is invalid".to_owned());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct LibraryMediaItemView {
    /// `<torrent_id>:<file_index>`.
    pub item_id: String,
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub torrent_name: String,
    pub file_index: u32,
    pub file_name: String,
    pub title: String,
    pub kind: LibraryMediaKind,
    pub role: LibraryMediaRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_number: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ending_episode_number: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_number: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    pub extension: String,
    pub length_bytes: String,
    pub verified_bytes: String,
    /// Every byte of the file is verified.
    pub offline: bool,
    pub archived: bool,
    pub media_availability: MediaFileAvailability,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct LibraryGroupView {
    /// `series:`, `album:` or `torrent:` followed by the group key.
    pub group_id: String,
    pub title: String,
    pub item_count: u32,
    pub offline_count: u32,
    pub total_bytes: String,
    /// Distinct seasons of a series; zero for other groups.
    pub season_count: u32,
    pub torrent_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
}

/// Counts over the items selected by text, archived scope and torrent,
/// before the kind, role, availability and group filters.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct LibraryFacetsView {
    pub items: u32,
    pub video: u32,
    pub audio: u32,
    pub episodes: u32,
    pub movies: u32,
    pub other_videos: u32,
    pub tracks: u32,
    pub offline: u32,
    pub incomplete: u32,
    pub series: u32,
    pub albums: u32,
    pub torrents: u32,
    /// Torrents in scope whose metadata is not verified yet.
    pub metadata_pending: u32,
}

/// One evaluated page of a query.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LibraryResult {
    pub(crate) page: CatalogPageView,
    pub(crate) facets: LibraryFacetsView,
    pub(crate) items: Vec<LibraryMediaItemView>,
    pub(crate) groups: Vec<LibraryGroupView>,
}

impl LibraryResult {
    /// Equal page, totals, facets, groups and item order. Rows may differ
    /// only in their progress.
    pub(crate) fn same_shape(&self, other: &Self) -> bool {
        self.page == other.page
            && self.facets == other.facets
            && self.groups == other.groups
            && self.items.len() == other.items.len()
            && self
                .items
                .iter()
                .zip(&other.items)
                .all(|(left, right)| left.item_id == right.item_id)
    }
}

/// The resident facts of one torrent the index is built from.
pub(crate) struct LibraryTorrentInput<'a> {
    pub(crate) torrent_id: &'a str,
    pub(crate) name: &'a str,
    pub(crate) archived: bool,
    pub(crate) files: Option<&'a FileProgressModel>,
}

#[derive(Debug, Default)]
pub(crate) struct LibraryIndex {
    torrents: Vec<Arc<IndexedTorrent>>,
    title_order: OnceLock<Vec<EntryRef>>,
    size_order: OnceLock<Vec<EntryRef>>,
    source_order: OnceLock<Vec<EntryRef>>,
}

#[derive(Debug)]
struct IndexedTorrent {
    torrent_id: String,
    name: String,
    name_search: String,
    archived: bool,
    catalog: Option<FileCatalogIdentity>,
    entries: Vec<IndexedEntry>,
}

#[derive(Debug)]
struct IndexedEntry {
    file_index: u32,
    kind: LibraryMediaKind,
    role: LibraryMediaRole,
    extension: &'static str,
    title: String,
    year: Option<u16>,
    series: Option<Arc<IndexedGroup>>,
    album: Option<Arc<IndexedGroup>>,
    season_number: Option<u16>,
    episode_number: Option<u16>,
    ending_episode_number: Option<u16>,
    disc_number: Option<u16>,
    track_number: Option<u16>,
    length: u64,
    wanted: bool,
    search: String,
}

#[derive(Debug)]
struct IndexedGroup {
    id: String,
    title: String,
}

#[derive(Clone, Copy, Debug)]
struct EntryRef {
    torrent: u32,
    entry: u32,
}

impl LibraryIndex {
    /// Returns a replacement index when any torrent was added, removed, or
    /// changed its catalog, name or archived flag. `inputs` are ordered by
    /// torrent ID. Unchanged torrents are reused without reclassification.
    pub(crate) fn synced<'a>(
        &self,
        inputs: impl IntoIterator<Item = LibraryTorrentInput<'a>>,
    ) -> Option<Self> {
        let mut changed = false;
        let mut torrents = Vec::with_capacity(self.torrents.len());
        for input in inputs {
            let reusable = self
                .torrents
                .binary_search_by(|torrent| torrent.torrent_id.as_str().cmp(input.torrent_id))
                .ok()
                .map(|position| &self.torrents[position])
                .filter(|torrent| torrent.matches(&input));
            match reusable {
                Some(torrent) => torrents.push(Arc::clone(torrent)),
                None => {
                    changed = true;
                    torrents.push(Arc::new(IndexedTorrent::build(&input)));
                }
            }
        }
        if torrents.len() != self.torrents.len() {
            changed = true;
        }
        changed.then(|| Self {
            torrents,
            ..Self::default()
        })
    }

    #[cfg(test)]
    pub(crate) fn entry_count(&self) -> usize {
        self.torrents
            .iter()
            .map(|torrent| torrent.entries.len())
            .sum()
    }

    /// Approximate heap and inline bytes held by the index.
    #[cfg(test)]
    pub(crate) fn approximate_bytes(&self) -> usize {
        let mut groups = HashSet::new();
        let mut group = |group: &Option<Arc<IndexedGroup>>| {
            group.as_ref().map_or(0, |group| {
                // Groups are shared by a torrent's entries; count each once.
                if groups.insert(Arc::as_ptr(group)) {
                    std::mem::size_of::<IndexedGroup>()
                        + group.id.capacity()
                        + group.title.capacity()
                } else {
                    0
                }
            })
        };
        self.torrents
            .iter()
            .map(|torrent| {
                std::mem::size_of::<IndexedTorrent>()
                    + torrent.torrent_id.capacity()
                    + torrent.name.capacity()
                    + torrent.name_search.capacity()
                    + torrent
                        .entries
                        .iter()
                        .map(|entry| {
                            std::mem::size_of::<IndexedEntry>()
                                + entry.title.capacity()
                                + entry.search.capacity()
                                + group(&entry.series)
                                + group(&entry.album)
                        })
                        .sum::<usize>()
            })
            .sum::<usize>()
            + [&self.title_order, &self.size_order, &self.source_order]
                .iter()
                .filter_map(|order| order.get())
                .map(|order| order.capacity() * std::mem::size_of::<EntryRef>())
                .sum::<usize>()
    }

    /// Evaluates one page of `query`. `files` resolves a torrent's current
    /// file progress; a torrent without it contributes no items.
    pub(crate) fn evaluate<'a>(
        &self,
        query: &LibraryMediaQuery,
        page: CatalogPageRequest,
        files: impl Fn(&str) -> Option<&'a FileProgressModel>,
    ) -> LibraryResult {
        let progress = self
            .torrents
            .iter()
            .map(|torrent| {
                // Progress is read only from the catalog the entries index.
                let current = files(&torrent.torrent_id)?;
                torrent
                    .catalog
                    .as_ref()
                    .is_some_and(|catalog| catalog.is_catalog_of(current))
                    .then_some(current)
            })
            .collect::<Vec<_>>();
        let words = search_words(&query.text);
        let all_words = if words.is_empty() {
            0_u32
        } else {
            u32::MAX >> (32 - words.len())
        };
        let in_scope = self
            .torrents
            .iter()
            .map(|torrent| match &query.torrent_id {
                Some(torrent_id) => torrent.torrent_id == *torrent_id,
                None => match query.archived {
                    LibraryArchivedFilter::Exclude => !torrent.archived,
                    LibraryArchivedFilter::Include => true,
                    LibraryArchivedFilter::Only => torrent.archived,
                },
            })
            .collect::<Vec<_>>();
        let torrent_words = self
            .torrents
            .iter()
            .map(|torrent| word_mask(&torrent.name_search, &words))
            .collect::<Vec<_>>();
        // Empty lists mean the v1 sets. A later kind or role must be listed
        // here only when clients request it explicitly.
        let kinds = if query.kinds.is_empty() {
            &[LibraryMediaKind::Video, LibraryMediaKind::Audio][..]
        } else {
            &query.kinds[..]
        };
        let roles = if query.roles.is_empty() {
            &[
                LibraryMediaRole::Episode,
                LibraryMediaRole::Movie,
                LibraryMediaRole::Other,
                LibraryMediaRole::Track,
            ][..]
        } else {
            &query.roles[..]
        };

        let mut facets = LibraryFacetsView {
            metadata_pending: count_u32(
                self.torrents
                    .iter()
                    .zip(&in_scope)
                    .filter(|(torrent, in_scope)| **in_scope && torrent.catalog.is_none())
                    .count(),
            ),
            ..LibraryFacetsView::default()
        };
        let mut series = HashSet::new();
        let mut albums = HashSet::new();
        let mut torrents_with_items = HashSet::new();
        let mut matched = Vec::new();
        for reference in self.order(query.sort, query.descending) {
            let slot = reference.torrent as usize;
            if !in_scope[slot] {
                continue;
            }
            let Some(files) = progress[slot] else {
                continue;
            };
            let torrent = &self.torrents[slot];
            let entry = &torrent.entries[reference.entry as usize];
            let verified = files
                .file_progress(entry.file_index as usize)
                .map_or(0, |(verified, _)| verified);
            let offline = verified == entry.length;
            if !entry.wanted && !offline {
                continue;
            }
            if all_words != 0
                && (torrent_words[slot] | word_mask(&entry.search, &words)) != all_words
            {
                continue;
            }
            facets.items += 1;
            match entry.kind {
                LibraryMediaKind::Video => facets.video += 1,
                LibraryMediaKind::Audio => facets.audio += 1,
            }
            match entry.role {
                LibraryMediaRole::Episode => facets.episodes += 1,
                LibraryMediaRole::Movie => facets.movies += 1,
                LibraryMediaRole::Other => facets.other_videos += 1,
                LibraryMediaRole::Track => facets.tracks += 1,
            }
            if offline {
                facets.offline += 1;
            } else {
                facets.incomplete += 1;
            }
            if let Some(group) = &entry.series {
                series.insert(group.id.as_str());
            }
            if let Some(group) = &entry.album {
                albums.insert(group.id.as_str());
            }
            torrents_with_items.insert(slot);

            if !kinds.contains(&entry.kind)
                || !roles.contains(&entry.role)
                || match query.availability {
                    LibraryAvailabilityFilter::Any => false,
                    LibraryAvailabilityFilter::Offline => !offline,
                    LibraryAvailabilityFilter::Incomplete => offline,
                }
                || query
                    .group_id
                    .as_deref()
                    .is_some_and(|group_id| !entry_in_group(torrent, entry, group_id))
            {
                continue;
            }
            matched.push(Matched { reference, offline });
        }
        facets.series = count_u32(series.len());
        facets.albums = count_u32(albums.len());
        facets.torrents = count_u32(torrents_with_items.len());

        if query.grouping == LibraryGrouping::Ungrouped {
            let bounds = page.bounds(matched.len());
            let items = matched[bounds]
                .iter()
                .filter_map(|matched| {
                    let slot = matched.reference.torrent as usize;
                    let torrent = &self.torrents[slot];
                    let entry = &torrent.entries[matched.reference.entry as usize];
                    progress[slot].map(|files| item_view(torrent, entry, files))
                })
                .collect();
            return LibraryResult {
                page: page.view(matched.len()),
                facets,
                items,
                groups: Vec::new(),
            };
        }

        let groups = self.groups(query, &matched);
        let bounds = page.bounds(groups.len());
        LibraryResult {
            page: page.view(groups.len()),
            facets,
            items: Vec::new(),
            groups: groups[bounds].to_vec(),
        }
    }

    /// The current row of one item, when the item exists in the index.
    pub(crate) fn item(
        &self,
        torrent_id: &str,
        file_index: u32,
        files: &FileProgressModel,
    ) -> Option<LibraryMediaItemView> {
        let torrent = self.torrent(torrent_id)?;
        let entry = torrent.entry(file_index)?;
        Some(item_view(torrent, entry, files))
    }

    /// The length of an indexed item, for deciding whether a progress change
    /// moved it between offline and incomplete.
    pub(crate) fn item_length(&self, torrent_id: &str, file_index: u32) -> Option<u64> {
        Some(self.torrent(torrent_id)?.entry(file_index)?.length)
    }

    fn torrent(&self, torrent_id: &str) -> Option<&IndexedTorrent> {
        self.torrents
            .binary_search_by(|torrent| torrent.torrent_id.as_str().cmp(torrent_id))
            .ok()
            .map(|position| self.torrents[position].as_ref())
    }

    fn groups(&self, query: &LibraryMediaQuery, matched: &[Matched]) -> Vec<LibraryGroupView> {
        struct Aggregate<'a> {
            id: String,
            title: &'a str,
            year: Option<u16>,
            items: u32,
            offline: u32,
            bytes: u64,
            seasons: BTreeSet<u16>,
            torrents: BTreeSet<u32>,
            first: usize,
        }
        let mut aggregates = HashMap::<&str, Aggregate<'_>>::new();
        for (position, matched) in matched.iter().enumerate() {
            let torrent = &self.torrents[matched.reference.torrent as usize];
            let entry = &torrent.entries[matched.reference.entry as usize];
            let (key, title, id) = match query.grouping {
                LibraryGrouping::Ungrouped => unreachable!("grouped queries only"),
                LibraryGrouping::Series => match &entry.series {
                    Some(group) => (group.id.as_str(), group.title.as_str(), None),
                    None => continue,
                },
                LibraryGrouping::Album => match &entry.album {
                    Some(group) => (group.id.as_str(), group.title.as_str(), None),
                    None => continue,
                },
                LibraryGrouping::Torrent => (
                    torrent.torrent_id.as_str(),
                    torrent.name.as_str(),
                    Some(format!("torrent:{}", torrent.torrent_id)),
                ),
            };
            let aggregate = aggregates.entry(key).or_insert_with(|| Aggregate {
                id: id.unwrap_or_else(|| key.to_owned()),
                title,
                year: None,
                items: 0,
                offline: 0,
                bytes: 0,
                seasons: BTreeSet::new(),
                torrents: BTreeSet::new(),
                first: position,
            });
            aggregate.items += 1;
            aggregate.offline += u32::from(matched.offline);
            aggregate.bytes = aggregate.bytes.saturating_add(entry.length);
            if query.grouping == LibraryGrouping::Series
                && let Some(season) = entry.season_number
            {
                aggregate.seasons.insert(season);
            }
            if query.grouping == LibraryGrouping::Album {
                aggregate.year = aggregate.year.or(entry.year);
            }
            aggregate.torrents.insert(matched.reference.torrent);
        }
        let mut groups = aggregates.into_values().collect::<Vec<_>>();
        match query.sort {
            // Title order sorts series and album entries by their group
            // first, so first appearance is the group's title order. By
            // torrent, sort on the name explicitly.
            LibraryMediaSort::Title if query.grouping != LibraryGrouping::Torrent => {
                groups.sort_by_key(|group| group.first);
            }
            LibraryMediaSort::Title | LibraryMediaSort::Source => {
                let mut keyed = groups
                    .into_iter()
                    .map(|group| (natural_key(group.title), group))
                    .collect::<Vec<_>>();
                keyed.sort_by(|(left_key, left), (right_key, right)| {
                    left_key.cmp(right_key).then_with(|| left.id.cmp(&right.id))
                });
                if query.descending {
                    keyed.reverse();
                }
                groups = keyed.into_iter().map(|(_, group)| group).collect();
            }
            LibraryMediaSort::Size => {
                groups.sort_by(|left, right| {
                    left.bytes
                        .cmp(&right.bytes)
                        .then_with(|| left.first.cmp(&right.first))
                });
                if query.descending {
                    groups.reverse();
                }
            }
        }
        groups
            .into_iter()
            .map(|group| LibraryGroupView {
                group_id: group.id,
                title: group.title.to_owned(),
                item_count: group.items,
                offline_count: group.offline,
                total_bytes: group.bytes.to_string(),
                season_count: count_u32(group.seasons.len()),
                torrent_count: count_u32(group.torrents.len()),
                year: group.year,
            })
            .collect()
    }

    fn order(
        &self,
        sort: LibraryMediaSort,
        descending: bool,
    ) -> Box<dyn Iterator<Item = EntryRef> + '_> {
        let order = match sort {
            LibraryMediaSort::Title => self.title_order.get_or_init(|| {
                self.sorted(|torrent, entry| (title_sort_key(entry), natural_key(&torrent.name), 0))
            }),
            LibraryMediaSort::Size => self.size_order.get_or_init(|| {
                self.sorted(|_, entry| (format!("{:020}", entry.length), title_sort_key(entry), 0))
            }),
            LibraryMediaSort::Source => self.source_order.get_or_init(|| {
                self.sorted(|torrent, entry| {
                    (
                        natural_key(&torrent.name),
                        String::new(),
                        u64::from(entry.file_index),
                    )
                })
            }),
        };
        if descending {
            Box::new(order.iter().rev().copied())
        } else {
            Box::new(order.iter().copied())
        }
    }

    /// Every entry ordered by `key`, then torrent ID and file index, so ties
    /// are deterministic. The keys live only while sorting.
    fn sorted(
        &self,
        key: impl Fn(&IndexedTorrent, &IndexedEntry) -> (String, String, u64),
    ) -> Vec<EntryRef> {
        let mut keyed = Vec::with_capacity(self.torrents.iter().map(|t| t.entries.len()).sum());
        for (slot, torrent) in self.torrents.iter().enumerate() {
            for (position, entry) in torrent.entries.iter().enumerate() {
                keyed.push((
                    key(torrent, entry),
                    EntryRef {
                        torrent: u32::try_from(slot).unwrap_or(u32::MAX),
                        entry: u32::try_from(position).unwrap_or(u32::MAX),
                    },
                    entry.file_index,
                ));
            }
        }
        keyed.sort_by(
            |(left_key, left, left_file), (right_key, right, right_file)| {
                left_key
                    .cmp(right_key)
                    .then_with(|| left.torrent.cmp(&right.torrent))
                    .then_with(|| left_file.cmp(right_file))
            },
        );
        keyed
            .into_iter()
            .map(|(_, reference, _)| reference)
            .collect()
    }
}

struct Matched {
    reference: EntryRef,
    offline: bool,
}

impl IndexedTorrent {
    fn matches(&self, input: &LibraryTorrentInput<'_>) -> bool {
        // Compared on every hub publish, so this allocates nothing for
        // names within the row bound.
        let same_name = if input.name.len() <= MAX_LIBRARY_ROW_TEXT_BYTES {
            self.name == input.name
        } else {
            self.name == bounded_text(input.name)
        };
        self.torrent_id == input.torrent_id
            && same_name
            && self.archived == input.archived
            && match (&self.catalog, input.files) {
                (None, None) => true,
                (Some(catalog), Some(files)) => catalog.is_catalog_of(files),
                _ => false,
            }
    }

    fn build(input: &LibraryTorrentInput<'_>) -> Self {
        let name = bounded_text(input.name);
        let Some(files) = input.files else {
            let name_search = search_text(&[input.name]);
            return Self {
                torrent_id: input.torrent_id.to_owned(),
                name,
                name_search,
                archived: input.archived,
                catalog: None,
                entries: Vec::new(),
            };
        };
        let mut details = HashMap::new();
        let paths = files
            .library_files()
            .filter(|(_, _, length, _)| *length != 0)
            .map(|(index, path, length, wanted)| {
                details.insert(index, (length, wanted));
                (index, path)
            })
            .collect::<Vec<_>>();
        let path_of = paths.iter().copied().collect::<HashMap<_, _>>();
        // Folder names shared by many files are searched once per torrent.
        let mut roots = BTreeSet::new();
        for (_, path) in &paths {
            if path.len() > 1 {
                roots.insert(path[0].as_str());
            }
        }
        let mut torrent_parts = vec![input.name];
        torrent_parts.extend(roots.iter().copied());
        let name_search = search_text(&torrent_parts);
        let mut groups = HashMap::<String, Arc<IndexedGroup>>::new();
        let mut group = |id: String, title: &str| {
            Arc::clone(groups.entry(id.clone()).or_insert_with(|| {
                Arc::new(IndexedGroup {
                    id,
                    title: bounded_text(title),
                })
            }))
        };
        let entries = classify_library(paths.iter().copied())
            .into_iter()
            .filter_map(|file| {
                let (length, wanted) = *details.get(&file.file_index)?;
                let path = path_of.get(&file.file_index)?;
                let file_index = u32::try_from(file.file_index).ok()?;
                let mut entry = IndexedEntry {
                    file_index,
                    kind: match file.kind {
                        MediaKind::Video => LibraryMediaKind::Video,
                        MediaKind::Audio => LibraryMediaKind::Audio,
                    },
                    role: LibraryMediaRole::Other,
                    extension: file.extension,
                    title: bounded_text(&file.title),
                    year: file.year,
                    series: None,
                    album: None,
                    season_number: None,
                    episode_number: None,
                    ending_episode_number: None,
                    disc_number: None,
                    track_number: None,
                    length,
                    wanted,
                    search: String::new(),
                };
                match &file.role {
                    LibraryRole::Episode(episode) => {
                        entry.role = LibraryMediaRole::Episode;
                        let key = series_group_key(&episode.series_title_hint);
                        if !key.is_empty() {
                            entry.series =
                                Some(group(format!("series:{key}"), &episode.series_title_hint));
                        }
                        entry.season_number = Some(episode.season_number);
                        entry.episode_number = Some(episode.episode_number);
                        entry.ending_episode_number = episode.ending_episode_number;
                    }
                    LibraryRole::Movie => entry.role = LibraryMediaRole::Movie,
                    LibraryRole::Other => entry.role = LibraryMediaRole::Other,
                    LibraryRole::Track(track) => {
                        entry.role = LibraryMediaRole::Track;
                        if let Some(album) = &track.album_title_hint {
                            let key = album_group_key(album);
                            if !key.is_empty() {
                                entry.album = Some(group(format!("album:{key}"), album));
                            }
                        }
                        entry.disc_number = track.disc_number;
                        entry.track_number = track.track_number;
                    }
                }
                // Titles, series and albums derive from the path, so the path
                // below its root folder is the whole searchable text.
                let below_root = if path.len() > 1 { &path[1..] } else { *path };
                entry.search =
                    search_text(&below_root.iter().map(String::as_str).collect::<Vec<_>>());
                Some(entry)
            })
            .collect();
        Self {
            torrent_id: input.torrent_id.to_owned(),
            name,
            name_search,
            archived: input.archived,
            catalog: Some(files.catalog_identity()),
            entries,
        }
    }

    fn entry(&self, file_index: u32) -> Option<&IndexedEntry> {
        self.entries
            .binary_search_by_key(&file_index, |entry| entry.file_index)
            .ok()
            .map(|position| &self.entries[position])
    }
}

fn entry_in_group(torrent: &IndexedTorrent, entry: &IndexedEntry, group_id: &str) -> bool {
    entry
        .series
        .as_ref()
        .is_some_and(|group| group.id == group_id)
        || entry
            .album
            .as_ref()
            .is_some_and(|group| group.id == group_id)
        || group_id
            .strip_prefix("torrent:")
            .is_some_and(|torrent_id| torrent_id == torrent.torrent_id)
}

fn item_view(
    torrent: &IndexedTorrent,
    entry: &IndexedEntry,
    files: &FileProgressModel,
) -> LibraryMediaItemView {
    let (verified, media_availability) = files
        .file_progress(entry.file_index as usize)
        .unwrap_or((0, MediaFileAvailability::Unverified));
    LibraryMediaItemView {
        item_id: format!("{}:{}", torrent.torrent_id, entry.file_index),
        torrent_id: torrent.torrent_id.clone(),
        torrent_name: torrent.name.clone(),
        file_index: entry.file_index,
        file_name: bounded_text(
            files
                .file_name(entry.file_index as usize)
                .unwrap_or_default(),
        ),
        title: entry.title.clone(),
        kind: entry.kind,
        role: entry.role,
        series_title: entry.series.as_ref().map(|group| group.title.clone()),
        series_id: entry
            .series
            .as_ref()
            .map(|group| bounded_utf8(&group.id, MAX_LIBRARY_GROUP_ID_BYTES)),
        season_number: entry.season_number,
        episode_number: entry.episode_number,
        ending_episode_number: entry.ending_episode_number,
        album_title: entry.album.as_ref().map(|group| group.title.clone()),
        album_id: entry
            .album
            .as_ref()
            .map(|group| bounded_utf8(&group.id, MAX_LIBRARY_GROUP_ID_BYTES)),
        disc_number: entry.disc_number,
        track_number: entry.track_number,
        year: entry.year,
        extension: entry.extension.to_owned(),
        length_bytes: entry.length.to_string(),
        verified_bytes: verified.to_string(),
        offline: verified == entry.length,
        archived: torrent.archived,
        media_availability,
    }
}

/// Episodes sort by series, season and episode; tracks by album, disc and
/// track; everything else by title then year. Numbers inside names compare
/// numerically.
fn title_sort_key(entry: &IndexedEntry) -> String {
    let number = |value: Option<u16>| format!("{:05}", value.unwrap_or(0));
    let primary = entry
        .series
        .as_ref()
        .or(entry.album.as_ref())
        .map_or(entry.title.as_str(), |group| group.title.as_str());
    let mut key = natural_key(primary);
    key.push('\u{1}');
    if entry.series.is_some() {
        key.push_str(&number(entry.season_number));
        key.push_str(&number(entry.episode_number));
        key.push_str(&number(entry.ending_episode_number));
    } else if entry.album.is_some() {
        key.push_str(&number(entry.disc_number));
        key.push_str(&number(entry.track_number));
    } else {
        key.push_str(&number(entry.year));
    }
    key.push('\u{1}');
    key.push_str(&natural_key(&entry.title));
    key
}

/// Lowercase text with every digit run left-padded to a fixed width, so that
/// `Episode 2` orders before `Episode 10`.
fn natural_key(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 8);
    let mut digits = String::new();
    let flush = |digits: &mut String, output: &mut String| {
        if digits.is_empty() {
            return;
        }
        let trimmed = digits.trim_start_matches('0');
        let trimmed = if trimmed.is_empty() { "0" } else { trimmed };
        for _ in trimmed.len()..10 {
            output.push('0');
        }
        output.push_str(trimmed);
        digits.clear();
    };
    for character in value.chars() {
        if character.is_ascii_digit() {
            digits.push(character);
            continue;
        }
        flush(&mut digits, &mut output);
        output.extend(character.to_lowercase());
    }
    flush(&mut digits, &mut output);
    output
}

fn search_words(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    for word in normalized(text).split(' ').filter(|word| !word.is_empty()) {
        if !words.iter().any(|existing| existing == word) {
            words.push(word.to_owned());
        }
    }
    words
}

fn search_text(parts: &[&str]) -> String {
    let mut value = String::new();
    for part in parts {
        let part = normalized(part);
        if part.is_empty() {
            continue;
        }
        if !value.is_empty() {
            value.push(' ');
        }
        value.push_str(&part);
        if value.len() >= MAX_SEARCH_TEXT_BYTES {
            return bounded_utf8(&value, MAX_SEARCH_TEXT_BYTES);
        }
    }
    value
}

/// Lowercase words separated by single spaces; every other character is a
/// separator.
fn normalized(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut space = false;
    for character in value.chars() {
        if character.is_alphanumeric() {
            if space && !output.is_empty() {
                output.push(' ');
            }
            space = false;
            output.extend(character.to_lowercase());
        } else {
            space = true;
        }
    }
    output
}

fn word_mask(haystack: &str, words: &[String]) -> u32 {
    words
        .iter()
        .enumerate()
        .filter(|(_, word)| haystack.contains(word.as_str()))
        .fold(0, |mask, (position, _)| mask | (1 << position))
}

fn bounded_text(value: &str) -> String {
    bounded_utf8(value, MAX_LIBRARY_ROW_TEXT_BYTES)
}

fn count_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn valid_torrent_id(value: &str) -> bool {
    value.len() == 35
        && value.starts_with("t1-")
        && value[3..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
#[path = "library_views/tests.rs"]
mod tests;
