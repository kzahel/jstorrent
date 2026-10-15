use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use rstorrent_protocol::content::TorrentContent;
#[cfg(test)]
use rstorrent_protocol::metainfo::Metainfo;
use rstorrent_protocol::storage_layout::{
    ContentLayout, FileSelection, LayoutError, RequiredPayloadGeometry,
};

use crate::MediaFileAvailability;
use crate::media_catalog_views::{DerivedMediaCatalog, MediaItemView};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum FileSelectionView {
    Normal,
    High,
    Skipped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum FileCatalogState {
    MetadataPending,
    Available,
    TorrentMissing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileView {
    pub file_id: String,
    pub file_index: u32,
    pub path: Vec<String>,
    pub length_bytes: String,
    pub torrent_offset_bytes: String,
    pub first_piece: Option<u32>,
    pub last_piece: Option<u32>,
    pub selection: Option<FileSelectionView>,
    pub padding: bool,
    pub done_bytes: String,
    pub verified_bytes: String,
    pub media_availability: MediaFileAvailability,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FileViewChange {
    pub previous: FileView,
    pub current: FileView,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileCatalog {
    layout: ContentLayout,
    /// The folder a multi-file torrent's paths are relative to.
    content_root: Option<String>,
    media: DerivedMediaCatalog,
    selection: FileSelection,
    high_priority_files: BTreeSet<usize>,
    filesystem_content_base: Option<String>,
    media_availability: MediaFileAvailability,
}

#[derive(Clone, Debug)]
pub(crate) struct FileCatalogIdentity(Arc<FileCatalog>);

impl FileCatalogIdentity {
    /// Whether `files` still uses this catalog.
    pub(crate) fn is_catalog_of(&self, files: &FileProgressModel) -> bool {
        Arc::ptr_eq(&self.0, &files.catalog)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct FileCounters {
    done: u64,
    verified: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StoredRange {
    begin: u32,
    end_exclusive: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FileProgressModel {
    catalog: Arc<FileCatalog>,
    counters: Vec<FileCounters>,
    verified_pieces: BTreeSet<u32>,
    unverified: BTreeMap<u32, Vec<StoredRange>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum FileProgressError {
    Layout(LayoutError),
    FileIndexOverflow,
    InvalidPiece(u32),
    CounterOverflow,
    CounterUnderflow,
}

impl fmt::Display for FileProgressError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Layout(error) => write!(formatter, "file progress layout: {error}"),
            Self::FileIndexOverflow => formatter.write_str("file progress index overflows u32"),
            Self::InvalidPiece(piece) => {
                write!(formatter, "file progress piece {piece} is invalid")
            }
            Self::CounterOverflow => formatter.write_str("file progress counter overflow"),
            Self::CounterUnderflow => formatter.write_str("file progress counter underflow"),
        }
    }
}

impl Error for FileProgressError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Layout(error) => Some(error),
            _ => None,
        }
    }
}

impl From<LayoutError> for FileProgressError {
    fn from(error: LayoutError) -> Self {
        Self::Layout(error)
    }
}

impl FileProgressModel {
    #[cfg(test)]
    pub(crate) fn new(
        metainfo: &Metainfo,
        skipped: &[u32],
        verified_pieces: &[u32],
        filesystem_content_base: Option<String>,
    ) -> Result<Self, FileProgressError> {
        Self::new_with_media(
            metainfo,
            skipped,
            verified_pieces,
            filesystem_content_base,
            MediaFileAvailability::Incomplete,
        )
    }

    #[cfg(test)]
    pub(crate) fn new_with_media(
        metainfo: &Metainfo,
        skipped: &[u32],
        verified_pieces: &[u32],
        filesystem_content_base: Option<String>,
        media_availability: MediaFileAvailability,
    ) -> Result<Self, FileProgressError> {
        let content = TorrentContent::from_v1_metainfo(metainfo.clone());
        Self::new_content_with_media(
            &content,
            skipped,
            &[],
            verified_pieces,
            filesystem_content_base,
            media_availability,
        )
    }

    pub(crate) fn new_content_with_media(
        content: &TorrentContent,
        skipped: &[u32],
        high_priority_files: &[u32],
        verified_pieces: &[u32],
        filesystem_content_base: Option<String>,
        media_availability: MediaFileAvailability,
    ) -> Result<Self, FileProgressError> {
        let layout = ContentLayout::from_content(content);
        let media = DerivedMediaCatalog::from_layout(&layout);
        // A single-file torrent's one path is its name; any other layout is
        // relative to a folder of that name.
        let single_file = matches!(
            layout.files().iter().filter(|file| !file.padding).collect::<Vec<_>>()[..],
            [file] if file.path.len() == 1 && file.path[0] == content.name()
        );
        let content_root = (!single_file).then(|| content.name().to_owned());
        let skipped = skipped
            .iter()
            .map(|index| usize::try_from(*index).map_err(|_| FileProgressError::FileIndexOverflow))
            .collect::<Result<Vec<_>, _>>()?;
        let selection = FileSelection::new_content(&layout, &skipped)?;
        let high_priority_files = high_priority_files
            .iter()
            .map(|index| usize::try_from(*index).map_err(|_| FileProgressError::FileIndexOverflow))
            .collect::<Result<BTreeSet<_>, _>>()?;
        let high_priority_files_vec = high_priority_files.iter().copied().collect::<Vec<_>>();
        layout.piece_priorities(&selection, &high_priority_files_vec)?;
        let file_count = layout.files().len();
        u32::try_from(file_count).map_err(|_| FileProgressError::FileIndexOverflow)?;
        let mut model = Self {
            catalog: Arc::new(FileCatalog {
                layout,
                content_root,
                media,
                selection,
                high_priority_files,
                filesystem_content_base,
                media_availability,
            }),
            counters: vec![FileCounters::default(); file_count],
            verified_pieces: BTreeSet::new(),
            unverified: BTreeMap::new(),
        };
        model.reconcile_verified(verified_pieces)?;
        Ok(model)
    }

    pub(crate) fn filesystem_content_base(&self) -> Option<&str> {
        self.catalog.filesystem_content_base.as_deref()
    }

    pub(crate) fn catalog_matches(&self, other: &Self) -> bool {
        self.catalog == other.catalog
    }

    pub(crate) fn patchable_catalog_matches(&self, other: &Self) -> bool {
        self.catalog.layout == other.catalog.layout
            && self.catalog.filesystem_content_base == other.catalog.filesystem_content_base
    }

    pub(crate) fn eta_selection_matches(&self, other: &Self) -> bool {
        self.catalog.layout == other.catalog.layout
            && self.catalog.selection == other.catalog.selection
    }

    pub(crate) fn required_payload_geometry(
        &self,
        have: &[bool],
    ) -> Result<RequiredPayloadGeometry, FileProgressError> {
        Ok(self
            .catalog
            .layout
            .required_payload_geometry(&self.catalog.selection, have)?)
    }

    pub(crate) fn verified_piece_indices(&self) -> Vec<u32> {
        self.verified_pieces.iter().copied().collect()
    }

    #[cfg(test)]
    pub(crate) fn rows(&self) -> Vec<FileView> {
        self.catalog
            .layout
            .files()
            .iter()
            .enumerate()
            .map(|(index, _)| self.row(index))
            .collect()
    }

    pub(crate) fn rows_page(&self, range: std::ops::Range<usize>) -> Vec<FileView> {
        range.map(|index| self.row(index)).collect()
    }

    pub(crate) fn count(&self) -> usize {
        self.catalog.layout.files().len()
    }

    pub(crate) fn total_length(&self) -> u64 {
        self.catalog.layout.total_length()
    }

    pub(crate) fn non_padding_count(&self) -> usize {
        self.catalog
            .layout
            .files()
            .iter()
            .filter(|file| !file.padding)
            .count()
    }

    pub(crate) fn media_rows(&self) -> Vec<MediaItemView> {
        self.catalog
            .media
            .entries()
            .iter()
            .map(|entry| entry.view(self.row(entry.file_index())))
            .collect()
    }

    pub(crate) fn media_row(&self, file_index: usize) -> Option<MediaItemView> {
        self.catalog
            .media
            .entry(file_index)
            .map(|entry| entry.view(self.row(file_index)))
    }

    pub(crate) fn row(&self, index: usize) -> FileView {
        self.row_with_counters(index, self.counters[index])
    }

    fn row_with_counters(&self, index: usize, counters: FileCounters) -> FileView {
        let file = &self.catalog.layout.files()[index];
        let (first_piece, last_piece) = if file.length == 0 {
            (None, None)
        } else {
            let piece_length = u64::from(self.catalog.layout.piece_length());
            let first = file.offset / piece_length;
            let last = file
                .offset
                .checked_add(file.length - 1)
                .expect("validated metainfo file range does not overflow")
                / piece_length;
            (
                Some(u32::try_from(first).expect("piece index fits the supported u32 geometry")),
                Some(u32::try_from(last).expect("piece index fits the supported u32 geometry")),
            )
        };
        FileView {
            file_id: index.to_string(),
            file_index: u32::try_from(index).expect("file index was validated at construction"),
            path: file.path.clone(),
            length_bytes: file.length.to_string(),
            torrent_offset_bytes: file.offset.to_string(),
            first_piece,
            last_piece,
            selection: (!file.padding).then(|| {
                if self.catalog.selection.is_wanted(index) {
                    if self.catalog.high_priority_files.contains(&index) {
                        FileSelectionView::High
                    } else {
                        FileSelectionView::Normal
                    }
                } else {
                    FileSelectionView::Skipped
                }
            }),
            padding: file.padding,
            done_bytes: counters.done.to_string(),
            verified_bytes: counters.verified.to_string(),
            media_availability: self.availability_with_counters(index, counters),
        }
    }

    fn availability_with_counters(
        &self,
        index: usize,
        counters: FileCounters,
    ) -> MediaFileAvailability {
        let file = &self.catalog.layout.files()[index];
        match self.catalog.media_availability {
            _ if file.padding => MediaFileAvailability::Padding,
            MediaFileAvailability::Streamable
                if file.length != 0 && self.catalog.selection.is_wanted(index) =>
            {
                MediaFileAvailability::Streamable
            }
            MediaFileAvailability::Streamable => MediaFileAvailability::Unverified,
            MediaFileAvailability::Available if counters.verified == file.length => {
                MediaFileAvailability::Available
            }
            MediaFileAvailability::Available => MediaFileAvailability::Unverified,
            availability => availability,
        }
    }

    /// Identity of the immutable catalog: equal identities share one layout,
    /// selection and availability. Holding it keeps the catalog alive, so a
    /// pointer cannot be reused while it is compared.
    pub(crate) fn catalog_identity(&self) -> FileCatalogIdentity {
        FileCatalogIdentity(Arc::clone(&self.catalog))
    }

    pub(crate) fn content_root(&self) -> Option<&str> {
        self.catalog.content_root.as_deref()
    }

    /// Non-padding files as `(file index, path, length, wanted)`.
    pub(crate) fn library_files(&self) -> impl Iterator<Item = (usize, &[String], u64, bool)> {
        self.catalog
            .layout
            .files()
            .iter()
            .enumerate()
            .filter(|(_, file)| !file.padding)
            .map(|(index, file)| {
                (
                    index,
                    file.path.as_slice(),
                    file.length,
                    self.catalog.selection.is_wanted(index),
                )
            })
    }

    /// Verified bytes and media availability of one file without building
    /// its row.
    pub(crate) fn file_progress(&self, index: usize) -> Option<(u64, MediaFileAvailability)> {
        let counters = *self.counters.get(index)?;
        Some((
            counters.verified,
            self.availability_with_counters(index, counters),
        ))
    }

    pub(crate) fn file_name(&self, index: usize) -> Option<&str> {
        self.catalog
            .layout
            .files()
            .get(index)
            .and_then(|file| file.path.last())
            .map(String::as_str)
    }

    pub(crate) fn stored_block(
        &mut self,
        piece: u32,
        begin: u32,
        length: u32,
    ) -> Result<Vec<FileViewChange>, FileProgressError> {
        self.validate_piece_interval(piece, begin, length)?;
        if self.verified_pieces.contains(&piece) {
            return Ok(Vec::new());
        }
        let end_exclusive = begin
            .checked_add(length)
            .ok_or(FileProgressError::CounterOverflow)?;
        let ranges = self.unverified.entry(piece).or_default();
        let uncovered = uncovered_ranges(ranges, begin, end_exclusive);
        insert_stored_range(ranges, begin, end_exclusive);
        let mut changed = BTreeMap::new();
        for range in uncovered {
            self.add_interval(
                piece,
                range.begin,
                range.end_exclusive - range.begin,
                false,
                &mut changed,
            )?;
        }
        Ok(self.changed_rows(changed))
    }

    pub(crate) fn piece_verified(
        &mut self,
        piece: u32,
    ) -> Result<Vec<FileViewChange>, FileProgressError> {
        self.validate_piece(piece)?;
        if self.verified_pieces.contains(&piece) {
            return Ok(Vec::new());
        }
        let length = self.catalog.layout.piece_length_at(piece)?;
        let affected = self
            .catalog
            .layout
            .file_segments(piece, 0, length)?
            .into_iter()
            .map(|segment| segment.file_index)
            .collect::<BTreeSet<_>>();
        let mut changed = affected
            .into_iter()
            .map(|index| (index, self.row(index)))
            .collect::<BTreeMap<_, _>>();
        self.verified_pieces.insert(piece);
        if let Some(ranges) = self.unverified.remove(&piece) {
            for range in ranges {
                self.subtract_interval(
                    piece,
                    range.begin,
                    range.end_exclusive - range.begin,
                    &mut changed,
                )?;
            }
        }
        self.add_interval(piece, 0, length, true, &mut changed)?;
        Ok(self.changed_rows(changed))
    }

    pub(crate) fn piece_hash_failed(
        &mut self,
        piece: u32,
    ) -> Result<Vec<FileViewChange>, FileProgressError> {
        self.validate_piece(piece)?;
        if self.verified_pieces.contains(&piece) {
            return Ok(Vec::new());
        }
        let mut changed = BTreeMap::new();
        if let Some(ranges) = self.unverified.remove(&piece) {
            for range in ranges {
                self.subtract_interval(
                    piece,
                    range.begin,
                    range.end_exclusive - range.begin,
                    &mut changed,
                )?;
            }
        }
        Ok(self.changed_rows(changed))
    }

    pub(crate) fn reconcile_verified(
        &mut self,
        verified_pieces: &[u32],
    ) -> Result<Vec<FileViewChange>, FileProgressError> {
        let previous = (0..self.counters.len())
            .map(|index| self.row(index))
            .collect::<Vec<_>>();
        let unverified = std::mem::take(&mut self.unverified);
        self.counters.fill(FileCounters::default());
        self.verified_pieces.clear();
        for &piece in verified_pieces {
            self.validate_piece(piece)?;
            if self.verified_pieces.insert(piece) {
                let length = self.catalog.layout.piece_length_at(piece)?;
                let mut ignored = BTreeMap::new();
                self.add_interval(piece, 0, length, true, &mut ignored)?;
            }
        }
        for (piece, ranges) in unverified {
            if self.verified_pieces.contains(&piece) {
                continue;
            }
            for range in &ranges {
                let mut ignored = BTreeMap::new();
                self.add_interval(
                    piece,
                    range.begin,
                    range.end_exclusive - range.begin,
                    false,
                    &mut ignored,
                )?;
            }
            self.unverified.insert(piece, ranges);
        }
        let changed = previous
            .into_iter()
            .enumerate()
            .filter_map(|(index, old)| (old != self.row(index)).then_some((index, old)))
            .collect::<BTreeMap<_, _>>();
        Ok(self.changed_rows(changed))
    }

    fn validate_piece(&self, piece: u32) -> Result<(), FileProgressError> {
        if usize::try_from(piece)
            .ok()
            .is_none_or(|piece| piece >= self.catalog.layout.piece_count())
        {
            return Err(FileProgressError::InvalidPiece(piece));
        }
        Ok(())
    }

    fn validate_piece_interval(
        &self,
        piece: u32,
        begin: u32,
        length: u32,
    ) -> Result<(), FileProgressError> {
        self.catalog.layout.file_segments(piece, begin, length)?;
        Ok(())
    }

    fn add_interval(
        &mut self,
        piece: u32,
        begin: u32,
        length: u32,
        verified: bool,
        changed: &mut BTreeMap<usize, FileView>,
    ) -> Result<(), FileProgressError> {
        for segment in self.catalog.layout.file_segments(piece, begin, length)? {
            let bytes =
                u64::try_from(segment.length).map_err(|_| FileProgressError::CounterOverflow)?;
            let previous = self.row(segment.file_index);
            let counters = self
                .counters
                .get_mut(segment.file_index)
                .ok_or(FileProgressError::FileIndexOverflow)?;
            changed.entry(segment.file_index).or_insert(previous);
            counters.done = counters
                .done
                .checked_add(bytes)
                .ok_or(FileProgressError::CounterOverflow)?;
            if verified {
                counters.verified = counters
                    .verified
                    .checked_add(bytes)
                    .ok_or(FileProgressError::CounterOverflow)?;
            }
            let length = self.catalog.layout.files()[segment.file_index].length;
            if counters.done > length || counters.verified > counters.done {
                return Err(FileProgressError::CounterOverflow);
            }
        }
        Ok(())
    }

    fn subtract_interval(
        &mut self,
        piece: u32,
        begin: u32,
        length: u32,
        changed: &mut BTreeMap<usize, FileView>,
    ) -> Result<(), FileProgressError> {
        for segment in self.catalog.layout.file_segments(piece, begin, length)? {
            let bytes =
                u64::try_from(segment.length).map_err(|_| FileProgressError::CounterUnderflow)?;
            let previous = self.row(segment.file_index);
            let counters = self
                .counters
                .get_mut(segment.file_index)
                .ok_or(FileProgressError::FileIndexOverflow)?;
            changed.entry(segment.file_index).or_insert(previous);
            counters.done = counters
                .done
                .checked_sub(bytes)
                .ok_or(FileProgressError::CounterUnderflow)?;
            if counters.verified > counters.done {
                return Err(FileProgressError::CounterUnderflow);
            }
        }
        Ok(())
    }

    fn changed_rows(&self, changed: BTreeMap<usize, FileView>) -> Vec<FileViewChange> {
        changed
            .into_iter()
            .map(|(index, previous)| FileViewChange {
                previous,
                current: self.row(index),
            })
            .collect()
    }
}

fn uncovered_ranges(ranges: &[StoredRange], begin: u32, end_exclusive: u32) -> Vec<StoredRange> {
    let mut cursor = begin;
    let mut uncovered = Vec::new();
    for range in ranges {
        if range.end_exclusive <= cursor {
            continue;
        }
        if range.begin >= end_exclusive {
            break;
        }
        if cursor < range.begin {
            uncovered.push(StoredRange {
                begin: cursor,
                end_exclusive: range.begin.min(end_exclusive),
            });
        }
        cursor = cursor.max(range.end_exclusive);
        if cursor >= end_exclusive {
            break;
        }
    }
    if cursor < end_exclusive {
        uncovered.push(StoredRange {
            begin: cursor,
            end_exclusive,
        });
    }
    uncovered
}

fn insert_stored_range(ranges: &mut Vec<StoredRange>, begin: u32, end_exclusive: u32) {
    ranges.push(StoredRange {
        begin,
        end_exclusive,
    });
    ranges.sort_unstable_by_key(|range| range.begin);
    let mut merged = Vec::<StoredRange>::with_capacity(ranges.len());
    for range in ranges.drain(..) {
        if let Some(previous) = merged.last_mut()
            && range.begin <= previous.end_exclusive
        {
            previous.end_exclusive = previous.end_exclusive.max(range.end_exclusive);
        } else {
            merged.push(range);
        }
    }
    *ranges = merged;
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstorrent_protocol::metainfo::{MetainfoFile, MetainfoMode};

    fn fixture() -> Metainfo {
        let lengths = [0, 20, 25, 3, 16];
        let paths = [
            vec!["empty".to_owned()],
            vec!["wanted.bin".to_owned()],
            vec!["nested".to_owned(), "skip.bin".to_owned()],
            vec![".pad".to_owned(), "3".to_owned()],
            vec!["tail.bin".to_owned()],
        ];
        let mut offset = 0;
        let files = lengths
            .into_iter()
            .enumerate()
            .map(|(index, length)| {
                let file = MetainfoFile {
                    path: paths[index].clone(),
                    length,
                    offset,
                    padding: index == 3,
                };
                offset += length;
                file
            })
            .collect();
        Metainfo {
            info_hash: [1; 20],
            piece_hashes: vec![[2; 20]; 4],
            piece_length: 16,
            total_length: 64,
            name: "files".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files,
        }
    }

    fn values(model: &FileProgressModel) -> Vec<(u64, u64)> {
        model
            .rows()
            .iter()
            .map(|file| {
                (
                    file.done_bytes.parse().expect("done"),
                    file.verified_bytes.parse().expect("verified"),
                )
            })
            .collect()
    }

    fn media_fixture() -> Metainfo {
        let paths = [
            vec!["Show.Name.S01E02.mkv".to_owned()],
            vec!["Show.Name.S01E01.mp4".to_owned()],
            vec!["extras".to_owned(), "notes.txt".to_owned()],
            vec![".pad".to_owned(), "1".to_owned()],
        ];
        let lengths = [16, 16, 8, 8];
        let mut offset = 0;
        let files = paths
            .into_iter()
            .zip(lengths)
            .enumerate()
            .map(|(index, (path, length))| {
                let file = MetainfoFile {
                    path,
                    length,
                    offset,
                    padding: index == 3,
                };
                offset += length;
                file
            })
            .collect();
        Metainfo {
            info_hash: [5; 20],
            piece_hashes: vec![[6; 20]; 3],
            piece_length: 16,
            total_length: 48,
            name: "Show Name".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files,
        }
    }

    #[test]
    fn catalog_preserves_geometry_selection_and_padding() {
        let content = TorrentContent::from_v1_metainfo(fixture());
        let model = FileProgressModel::new_content_with_media(
            &content,
            &[2],
            &[1],
            &[],
            Some("/tmp/content".to_owned()),
            MediaFileAvailability::Incomplete,
        )
        .expect("model");
        let rows = model.rows();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0].first_piece, None);
        assert_eq!(rows[1].first_piece, Some(0));
        assert_eq!(rows[1].last_piece, Some(1));
        assert_eq!(rows[2].first_piece, Some(1));
        assert_eq!(rows[2].last_piece, Some(2));
        assert_eq!(rows[1].selection, Some(FileSelectionView::High));
        assert_eq!(rows[2].selection, Some(FileSelectionView::Skipped));
        assert_eq!(rows[4].selection, Some(FileSelectionView::Normal));
        assert_eq!(rows[3].selection, None);
        assert!(rows[3].padding);
        assert_eq!(rows[3].media_availability, MediaFileAvailability::Padding);
        assert_eq!(
            rows[1].media_availability,
            MediaFileAvailability::Incomplete
        );
        assert_eq!(model.filesystem_content_base(), Some("/tmp/content"));
    }

    #[test]
    fn media_catalog_is_filtered_and_retains_exact_file_state() {
        let mut model = FileProgressModel::new_with_media(
            &media_fixture(),
            &[1],
            &[],
            None,
            MediaFileAvailability::Available,
        )
        .expect("media model");
        assert_eq!(model.non_padding_count(), 3);

        let items = model.media_rows();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].file_index, 0);
        assert_eq!(items[0].extension, "mkv");
        assert_eq!(items[1].selection, FileSelectionView::Skipped);
        assert!(matches!(
            items[0].role,
            crate::MediaRoleView::Episode {
                season_number: 1,
                episode_number: 2,
                ..
            }
        ));

        model.piece_verified(0).expect("verified episode");
        let item = model.media_row(0).expect("first media item");
        assert_eq!(item.verified_bytes, "16");
        assert_eq!(item.media_availability, MediaFileAvailability::Available);
        assert!(model.media_row(2).is_none());
    }

    #[test]
    fn media_availability_requires_verified_pieces_but_not_wanted_selection() {
        let model = FileProgressModel::new_with_media(
            &fixture(),
            &[2],
            &[0, 1, 2, 3],
            None,
            MediaFileAvailability::Available,
        )
        .expect("verified model");
        let rows = model.rows();
        assert_eq!(rows[0].media_availability, MediaFileAvailability::Available);
        assert_eq!(rows[1].media_availability, MediaFileAvailability::Available);
        assert_eq!(rows[2].selection, Some(FileSelectionView::Skipped));
        assert_eq!(rows[2].media_availability, MediaFileAvailability::Available);
        assert_eq!(rows[3].media_availability, MediaFileAvailability::Padding);
    }

    #[test]
    fn verification_change_retains_pre_mutation_media_availability() {
        let mut model = FileProgressModel::new_with_media(
            &fixture(),
            &[],
            &[],
            None,
            MediaFileAvailability::Available,
        )
        .expect("verified model");
        model.piece_verified(0).expect("first piece");
        let changes = model.piece_verified(1).expect("second piece");
        let wanted = changes
            .iter()
            .find(|change| change.current.file_index == 1)
            .expect("wanted file change");
        assert_eq!(
            wanted.previous.media_availability,
            MediaFileAvailability::Unverified
        );
        assert_eq!(
            wanted.current.media_availability,
            MediaFileAvailability::Available
        );
    }

    #[test]
    fn active_media_is_streamable_only_for_wanted_non_padding_files() {
        let model = FileProgressModel::new_with_media(
            &fixture(),
            &[2],
            &[],
            None,
            MediaFileAvailability::Streamable,
        )
        .expect("active model");
        let rows = model.rows();
        assert_eq!(
            rows[0].media_availability,
            MediaFileAvailability::Unverified
        );
        assert_eq!(
            rows[1].media_availability,
            MediaFileAvailability::Streamable
        );
        assert_eq!(rows[2].selection, Some(FileSelectionView::Skipped));
        assert_eq!(
            rows[2].media_availability,
            MediaFileAvailability::Unverified
        );
        assert_eq!(rows[3].media_availability, MediaFileAvailability::Padding);
    }

    #[test]
    fn large_catalog_pages_traverse_without_duplicating_geometry() {
        let files = (0..2_050_u64)
            .map(|index| MetainfoFile {
                path: vec![format!("file-{index}")],
                length: 1,
                offset: index,
                padding: false,
            })
            .collect::<Vec<_>>();
        let metainfo = Metainfo {
            info_hash: [3; 20],
            piece_hashes: vec![[4; 20]; files.len()],
            piece_length: 1,
            total_length: files.len() as u64,
            name: "large".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files,
        };
        let model = FileProgressModel::new(&metainfo, &[], &[], None).expect("large model");
        let rows = [0..1_024, 1_024..2_048, 2_048..2_050]
            .into_iter()
            .flat_map(|range| model.rows_page(range))
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 2_050);
        assert!(
            rows.iter()
                .enumerate()
                .all(|(index, row)| row.file_index as usize == index)
        );
        assert_eq!(rows[2_049].path, ["file-2049"]);
    }

    #[test]
    fn stored_verified_and_failed_ranges_cross_file_boundaries() {
        let mut model = FileProgressModel::new(&fixture(), &[2], &[], None).expect("model");
        model.stored_block(1, 0, 16).expect("stored");
        assert_eq!(values(&model), [(0, 0), (4, 0), (12, 0), (0, 0), (0, 0)]);

        model.piece_verified(1).expect("verified");
        assert_eq!(values(&model), [(0, 0), (4, 4), (12, 12), (0, 0), (0, 0)]);

        model.stored_block(2, 0, 16).expect("stored");
        assert_eq!(values(&model), [(0, 0), (4, 4), (25, 12), (3, 0), (0, 0)]);
        model.piece_hash_failed(2).expect("failed");
        assert_eq!(values(&model), [(0, 0), (4, 4), (12, 12), (0, 0), (0, 0)]);
    }

    #[test]
    fn verification_accounts_for_padding_and_is_idempotent() {
        let mut model = FileProgressModel::new(&fixture(), &[2], &[], None).expect("model");
        model.stored_block(2, 0, 13).expect("real data");
        model.piece_verified(2).expect("verified");
        assert_eq!(values(&model), [(0, 0), (0, 0), (13, 13), (3, 3), (0, 0)]);
        assert!(model.piece_verified(2).expect("duplicate").is_empty());
        assert_eq!(values(&model), [(0, 0), (0, 0), (13, 13), (3, 3), (0, 0)]);
    }

    #[test]
    fn duplicate_and_overlapping_blocks_only_count_new_bytes() {
        let mut model = FileProgressModel::new(&fixture(), &[], &[], None).expect("model");
        model.stored_block(0, 0, 12).expect("first");
        model.stored_block(0, 8, 8).expect("overlap");
        model.stored_block(0, 0, 16).expect("duplicate");
        assert_eq!(values(&model), [(0, 0), (16, 0), (0, 0), (0, 0), (0, 0)]);
    }

    #[test]
    fn resume_rebuild_and_recheck_clear_are_exact() {
        let mut model = FileProgressModel::new(&fixture(), &[2], &[0, 3], None).expect("model");
        assert_eq!(values(&model), [(0, 0), (16, 16), (0, 0), (0, 0), (16, 16)]);
        model.stored_block(1, 0, 8).expect("active");
        model.reconcile_verified(&[1]).expect("recheck");
        assert_eq!(values(&model), [(0, 0), (4, 4), (12, 12), (0, 0), (0, 0)]);
    }

    #[test]
    fn rejects_invalid_piece_and_interval() {
        let mut model = FileProgressModel::new(&fixture(), &[], &[], None).expect("model");
        assert!(matches!(
            model.stored_block(4, 0, 1),
            Err(FileProgressError::Layout(
                LayoutError::InvalidPieceIndex { .. }
            )) | Err(FileProgressError::InvalidPiece(4))
        ));
        assert!(matches!(
            model.stored_block(3, 0, 17),
            Err(FileProgressError::Layout(
                LayoutError::IntervalOutOfRange { .. }
            ))
        ));
    }
}
