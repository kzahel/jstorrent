use std::collections::BTreeMap;
use std::time::Instant;

use rstorrent_protocol::metainfo::{Metainfo, MetainfoFile, MetainfoMode};

use super::*;

const PIECE: u64 = 16;

struct Fixture {
    torrents: BTreeMap<String, (String, bool, Option<FileProgressModel>)>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            torrents: BTreeMap::new(),
        }
    }

    /// Adds a torrent whose files are each one piece long. `verified` lists
    /// the indices of files whose piece is verified; `skipped` those not
    /// wanted.
    fn torrent(
        &mut self,
        number: u32,
        name: &str,
        paths: &[&str],
        verified: &[u32],
        skipped: &[u32],
    ) -> String {
        let torrent_id = format!("t1-{number:032x}");
        let files = paths
            .iter()
            .enumerate()
            .map(|(index, path)| MetainfoFile {
                path: path.split('/').map(ToOwned::to_owned).collect(),
                length: PIECE,
                offset: index as u64 * PIECE,
                padding: false,
            })
            .collect::<Vec<_>>();
        let metainfo = Metainfo {
            info_hash: [(number % 256) as u8; 20],
            piece_hashes: vec![[0; 20]; files.len()],
            piece_length: PIECE as u32,
            total_length: files.len() as u64 * PIECE,
            name: name.to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files,
        };
        let model = FileProgressModel::new_with_media(
            &metainfo,
            skipped,
            verified,
            None,
            MediaFileAvailability::Available,
        )
        .expect("fixture model");
        self.torrents
            .insert(torrent_id.clone(), (name.to_owned(), false, Some(model)));
        torrent_id
    }

    fn pending(&mut self, number: u32, name: &str) {
        self.torrents
            .insert(format!("t1-{number:032x}"), (name.to_owned(), false, None));
    }

    fn archive(&mut self, torrent_id: &str) {
        self.torrents.get_mut(torrent_id).expect("torrent").1 = true;
    }

    fn index(&self) -> LibraryIndex {
        LibraryIndex::default()
            .synced(self.inputs())
            .expect("first build changes the index")
    }

    fn inputs(&self) -> impl Iterator<Item = LibraryTorrentInput<'_>> {
        self.torrents.iter().map(
            |(torrent_id, (name, archived, files))| LibraryTorrentInput {
                torrent_id,
                name,
                archived: *archived,
                files: files.as_ref(),
            },
        )
    }

    fn evaluate(&self, index: &LibraryIndex, query: LibraryMediaQuery) -> LibraryResult {
        self.page(index, query, 0, MAX_LIBRARY_PAGE_ROWS)
    }

    fn page(
        &self,
        index: &LibraryIndex,
        query: LibraryMediaQuery,
        offset: u32,
        limit: u32,
    ) -> LibraryResult {
        index.evaluate(&query, CatalogPageRequest { offset, limit }, |torrent_id| {
            self.torrents
                .get(torrent_id)
                .and_then(|(_, _, files)| files.as_ref())
        })
    }
}

fn titles(result: &LibraryResult) -> Vec<&str> {
    result
        .items
        .iter()
        .map(|item| item.title.as_str())
        .collect()
}

/// A small library with a season pack, a lone episode of the same show from
/// another torrent, an album, a movie with its sample, an archived movie and
/// a magnet still fetching metadata.
fn library() -> (Fixture, [String; 5]) {
    let mut fixture = Fixture::new();
    let pack = fixture.torrent(
        1,
        "Sample Show Season 1",
        &[
            "Sample Show S01/Sample.Show.S01E10.Finale.mkv",
            "Sample Show S01/Sample.Show.S01E02.Second.mkv",
            "Sample Show S01/Sample.Show.S01E02.Second.nfo",
        ],
        &[0],
        &[],
    );
    let single = fixture.torrent(
        2,
        "Sample.Show.S01E03",
        &["Sample.Show.S01E03.mkv"],
        &[],
        &[],
    );
    let album = fixture.torrent(
        3,
        "Artist - Album (2019) [FLAC]",
        &[
            "Artist - Album (2019) [FLAC]/02 - Second Song.flac",
            "Artist - Album (2019) [FLAC]/01 - First Song.flac",
            "Artist - Album (2019) [FLAC]/cover.jpg",
            "Artist - Album (2019) [FLAC]/03 - Skipped Song.flac",
        ],
        &[0, 1],
        &[3],
    );
    let movie = fixture.torrent(
        4,
        "Tears of Steel",
        &[
            "Tears.of.Steel.2012/Tears.of.Steel.2012.1080p.mkv",
            "Tears.of.Steel.2012/Sample/tos-sample.mkv",
        ],
        &[0],
        &[],
    );
    let archived = fixture.torrent(5, "Big Buck Bunny", &["Big Buck Bunny/bbb.mp4"], &[0], &[]);
    fixture.archive(&archived);
    fixture.pending(6, "Fetching");
    (fixture, [pack, single, album, movie, archived])
}

#[test]
fn default_query_lists_wanted_media_across_unarchived_torrents_in_title_order() {
    let (fixture, _) = library();
    let index = fixture.index();
    let result = fixture.evaluate(&index, LibraryMediaQuery::default());
    assert_eq!(
        titles(&result),
        [
            "First Song",
            "Second Song",
            "Second",
            "Sample Show S01E03",
            "Finale",
            "Tears of Steel",
        ]
    );
    assert_eq!(result.page.total, 6);
    assert_eq!(
        result.facets,
        LibraryFacetsView {
            items: 6,
            video: 4,
            audio: 2,
            episodes: 3,
            movies: 1,
            other_videos: 0,
            tracks: 2,
            offline: 4,
            incomplete: 2,
            series: 1,
            albums: 1,
            torrents: 4,
            metadata_pending: 1,
        }
    );
    let finale = &result.items[4];
    assert_eq!(finale.series_title.as_deref(), Some("Sample Show"));
    assert_eq!(finale.series_id.as_deref(), Some("series:sample show"));
    assert_eq!(
        (finale.season_number, finale.episode_number),
        (Some(1), Some(10))
    );
    assert!(finale.offline);
    assert_eq!(finale.verified_bytes, "16");
    assert_eq!(finale.media_availability, MediaFileAvailability::Available);
    assert_eq!(finale.file_name, "Sample.Show.S01E10.Finale.mkv");
    let second = &result.items[2];
    assert!(!second.offline);
    assert_eq!(second.media_availability, MediaFileAvailability::Unverified);
    assert_eq!(
        result.items[0].album_title.as_deref(),
        Some("Artist - Album")
    );
    assert_eq!(result.items[0].year, Some(2019));
    assert_eq!(result.items[0].track_number, Some(1));
}

#[test]
fn filters_narrow_after_facets() {
    let (fixture, [pack, _, _, _, archived]) = library();
    let index = fixture.index();
    let query = |change: fn(&mut LibraryMediaQuery)| {
        let mut query = LibraryMediaQuery::default();
        change(&mut query);
        query
    };
    let audio = fixture.evaluate(
        &index,
        query(|query| query.kinds = vec![LibraryMediaKind::Audio]),
    );
    assert_eq!(titles(&audio), ["First Song", "Second Song"]);
    assert_eq!(audio.facets.items, 6);

    let movies = fixture.evaluate(
        &index,
        query(|query| query.roles = vec![LibraryMediaRole::Movie]),
    );
    assert_eq!(titles(&movies), ["Tears of Steel"]);
    assert_eq!(movies.items[0].year, Some(2012));

    let incomplete = fixture.evaluate(
        &index,
        query(|query| query.availability = LibraryAvailabilityFilter::Incomplete),
    );
    assert_eq!(titles(&incomplete), ["Second", "Sample Show S01E03"]);

    let only_archived = fixture.evaluate(
        &index,
        query(|query| query.archived = LibraryArchivedFilter::Only),
    );
    assert_eq!(titles(&only_archived), ["bbb"]);
    assert!(only_archived.items[0].archived);
    assert_eq!(only_archived.facets.metadata_pending, 0);
    let including = fixture.evaluate(
        &index,
        query(|query| query.archived = LibraryArchivedFilter::Include),
    );
    assert_eq!(including.page.total, 7);

    let mut by_torrent = LibraryMediaQuery {
        torrent_id: Some(archived.clone()),
        ..LibraryMediaQuery::default()
    };
    assert_eq!(
        titles(&fixture.evaluate(&index, by_torrent.clone())),
        ["bbb"]
    );
    by_torrent.torrent_id = Some(pack);
    assert_eq!(
        titles(&fixture.evaluate(&index, by_torrent)),
        ["Second", "Finale"]
    );

    let show = LibraryMediaQuery {
        group_id: Some("series:sample show".to_owned()),
        ..LibraryMediaQuery::default()
    };
    assert_eq!(
        titles(&fixture.evaluate(&index, show)),
        ["Second", "Sample Show S01E03", "Finale"]
    );
}

#[test]
fn every_word_must_match_the_item_or_its_torrent() {
    let (fixture, _) = library();
    let index = fixture.index();
    let search = |text: &str| {
        fixture.evaluate(
            &index,
            LibraryMediaQuery {
                text: text.to_owned(),
                ..LibraryMediaQuery::default()
            },
        )
    };
    assert_eq!(titles(&search("SAMPLE   e03")), ["Sample Show S01E03"]);
    assert_eq!(titles(&search("artist song first")), ["First Song"]);
    assert_eq!(titles(&search("season 1 fin")), ["Finale"]);
    assert_eq!(search("steel").page.total, 1);
    assert_eq!(search("nothing-matches").page.total, 0);
    assert_eq!(search("sample").facets.series, 1);
    assert_eq!(search("sample").facets.albums, 0);
}

#[test]
fn groupings_merge_across_torrents_and_page_groups() {
    let (fixture, [pack, single, album, _, _]) = library();
    let index = fixture.index();
    let series = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Series,
            ..LibraryMediaQuery::default()
        },
    );
    assert!(series.items.is_empty());
    assert_eq!(
        series.groups,
        [LibraryGroupView {
            group_id: "series:sample show".to_owned(),
            title: "Sample Show".to_owned(),
            item_count: 3,
            offline_count: 1,
            total_bytes: "48".to_owned(),
            season_count: 1,
            torrent_count: 2,
            year: None,
        }]
    );
    let albums = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Album,
            ..LibraryMediaQuery::default()
        },
    );
    assert_eq!(albums.groups.len(), 1);
    assert_eq!(albums.groups[0].group_id, "album:artist album");
    assert_eq!(albums.groups[0].year, Some(2019));
    let torrents = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Torrent,
            ..LibraryMediaQuery::default()
        },
    );
    assert_eq!(
        torrents
            .groups
            .iter()
            .map(|group| group.group_id.as_str())
            .collect::<Vec<_>>(),
        [
            format!("torrent:{album}"),
            format!("torrent:{pack}"),
            format!("torrent:{single}"),
            format!("torrent:t1-{:032x}", 4),
        ]
    );
    let page = fixture.page(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Torrent,
            ..LibraryMediaQuery::default()
        },
        1,
        2,
    );
    assert_eq!(page.groups.len(), 2);
    assert_eq!(page.page.total, 4);
    assert_eq!(page.page.next_offset, Some(3));
}

#[test]
fn sorts_are_deterministic_and_reversible() {
    let (fixture, _) = library();
    let index = fixture.index();
    let sorted = |sort, descending| {
        titles(&fixture.evaluate(
            &index,
            LibraryMediaQuery {
                sort,
                descending,
                ..LibraryMediaQuery::default()
            },
        ))
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>()
    };
    let title = sorted(LibraryMediaSort::Title, false);
    let mut reversed = sorted(LibraryMediaSort::Title, true);
    reversed.reverse();
    assert_eq!(title, reversed);
    assert_eq!(
        sorted(LibraryMediaSort::Source, false),
        [
            "Second Song",
            "First Song",
            "Finale",
            "Second",
            "Sample Show S01E03",
            "Tears of Steel",
        ]
    );
    assert_eq!(sorted(LibraryMediaSort::Size, false), title);
}

#[test]
fn pages_bound_rows_and_report_the_next_offset() {
    let (fixture, _) = library();
    let index = fixture.index();
    let page = fixture.page(&index, LibraryMediaQuery::default(), 2, 3);
    assert_eq!(titles(&page), ["Second", "Sample Show S01E03", "Finale"]);
    assert_eq!(page.page.next_offset, Some(5));
    let past = fixture.page(&index, LibraryMediaQuery::default(), 50, 3);
    assert!(past.items.is_empty());
    assert_eq!(past.page.total, 6);
}

#[test]
fn unchanged_inputs_reuse_the_index_and_changes_rebuild_it() {
    let (mut fixture, [_, _, _, movie, _]) = library();
    let index = fixture.index();
    assert!(index.synced(fixture.inputs()).is_none());
    fixture.archive(&movie);
    let rebuilt = index
        .synced(fixture.inputs())
        .expect("archived flag changed");
    assert_eq!(rebuilt.entry_count(), index.entry_count());
    fixture.torrents.remove(&movie);
    assert!(rebuilt.synced(fixture.inputs()).is_some());
}

#[test]
fn hostile_names_are_bounded() {
    let mut fixture = Fixture::new();
    let long = "é".repeat(400);
    let path = format!("{long}/{long}.mkv");
    fixture.torrent(1, &long, &[&path], &[], &[]);
    let index = fixture.index();
    let result = fixture.evaluate(&index, LibraryMediaQuery::default());
    let item = &result.items[0];
    assert!(item.torrent_name.len() <= MAX_LIBRARY_ROW_TEXT_BYTES);
    assert!(item.title.len() <= MAX_LIBRARY_ROW_TEXT_BYTES);
    assert!(item.file_name.len() <= MAX_LIBRARY_ROW_TEXT_BYTES);
    assert!(item.torrent_name.chars().all(|character| character == 'é'));
}

#[test]
fn queries_are_validated() {
    let valid = LibraryMediaQuery {
        text: "a b".to_owned(),
        kinds: vec![LibraryMediaKind::Video],
        group_id: Some("series:x".to_owned()),
        torrent_id: Some(format!("t1-{:032x}", 1)),
        ..LibraryMediaQuery::default()
    };
    assert_eq!(valid.validate(), Ok(()));
    let invalid = [
        LibraryMediaQuery {
            text: "x".repeat(257),
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            text: (0..17).map(|word| format!("w{word} ")).collect(),
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            kinds: vec![LibraryMediaKind::Video, LibraryMediaKind::Video],
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            roles: vec![LibraryMediaRole::Track, LibraryMediaRole::Track],
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            torrent_id: Some("t1-XYZ".to_owned()),
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            group_id: Some("show:x".to_owned()),
            ..LibraryMediaQuery::default()
        },
        LibraryMediaQuery {
            group_id: Some(format!("series:{}", "x".repeat(600))),
            ..LibraryMediaQuery::default()
        },
    ];
    for query in invalid {
        assert!(query.validate().is_err(), "{query:?}");
    }
}

/// The consumer scale envelope: 1,000 torrents of 100 files each.
#[test]
fn hundred_thousand_files_build_and_query_within_bounds() {
    let mut fixture = Fixture::new();
    let mut paths = Vec::new();
    for torrent in 0..1_000_u32 {
        let names = (0..100_u32)
            .map(|file| match torrent % 3 {
                0 => format!("Show {torrent}/Show.{torrent}.S01E{file:02}.1080p.mkv"),
                1 => format!("Artist {torrent} - Album/{file:02} - Song {file}.flac"),
                _ => format!("Lectures {torrent}/{file:03} Lecture about topic {file}.mp4"),
            })
            .collect::<Vec<_>>();
        paths.push(names);
    }
    for (torrent, names) in paths.iter().enumerate() {
        let refs = names.iter().map(String::as_str).collect::<Vec<_>>();
        let verified = (0..50).collect::<Vec<_>>();
        let number = u32::try_from(torrent).expect("small number");
        fixture.torrent(number, &format!("Torrent {torrent}"), &refs, &verified, &[]);
    }

    let started = Instant::now();
    let index = fixture.index();
    let build = started.elapsed();
    assert_eq!(index.entry_count(), 100_000);

    let started = Instant::now();
    let first = fixture.evaluate(&index, LibraryMediaQuery::default());
    let first_query = started.elapsed();
    assert_eq!(first.page.total, 100_000);

    let started = Instant::now();
    let repeated = fixture.evaluate(&index, LibraryMediaQuery::default());
    let sorted_query = started.elapsed();
    assert_eq!(repeated, first);

    let started = Instant::now();
    let search = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            text: "lecture topic 42".to_owned(),
            ..LibraryMediaQuery::default()
        },
    );
    let search_query = started.elapsed();
    assert!(search.page.total > 0);

    let started = Instant::now();
    let grouped = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Series,
            ..LibraryMediaQuery::default()
        },
    );
    let grouped_query = started.elapsed();
    assert_eq!(grouped.page.total, 334);

    let bytes = index.approximate_bytes();
    eprintln!(
        "library scale: 100000 files, index {bytes} bytes ({} per file), build {build:?}, \
         first title query {first_query:?}, sorted query {sorted_query:?}, \
         three-word search {search_query:?}, series grouping {grouped_query:?}",
        bytes / 100_000
    );
    assert!(bytes / 100_000 < 1_024, "index grew to {bytes} bytes");
}

#[test]
fn a_multi_file_torrent_folder_names_its_album() {
    let mut fixture = Fixture::new();
    fixture.torrent(
        1,
        "The WIRED CD - Rip. Sample. Mash. Share.",
        &[
            "01 - Beastie Boys - Now Get Busy.mp3",
            "02 - David Byrne - My Fair Lady.mp3",
        ],
        &[0, 1],
        &[],
    );
    // A single-file torrent's path is its name, so it has no folder.
    fixture.torrent(2, "Loose Song.mp3", &["Loose Song.mp3"], &[0], &[]);
    let index = fixture.index();
    let albums = fixture.evaluate(
        &index,
        LibraryMediaQuery {
            grouping: LibraryGrouping::Album,
            ..LibraryMediaQuery::default()
        },
    );
    assert_eq!(albums.groups.len(), 1);
    assert_eq!(
        albums.groups[0].title,
        "The WIRED CD - Rip. Sample. Mash. Share"
    );
    assert_eq!(albums.groups[0].item_count, 2);
    assert_eq!(albums.facets.tracks, 3);
    assert_eq!(albums.facets.albums, 1);
}
