//! Library media delivery: snapshots on shape changes, row patches on
//! progress, and the per-query memo.

use super::support::*;

use rstorrent_protocol::metainfo::{Metainfo, MetainfoFile, MetainfoMode};

use crate::file_views::FileProgressModel;
use crate::{
    CatalogPageRequest, LibraryArchivedFilter, LibraryMediaQuery, OpenViewSetOptions,
    OpenViewSetRequest, SubscriptionError, UpdateViewSetRequest, ViewDeliveryPolicy, ViewSetOwner,
    ViewSetUpdate, ViewSpec,
};

const TORRENT_ID: &str = "t1-000102030405060708090a0b0c0d0e0f";

/// Two episodes of two pieces each and a text file.
fn metainfo() -> Metainfo {
    let files = [
        ("Show.S01E01.mkv", 32),
        ("Show.S01E02.mkv", 32),
        ("notes.txt", 16),
    ]
    .into_iter()
    .scan(0, |offset, (name, length)| {
        let file = MetainfoFile {
            path: vec!["Show Season 1".to_owned(), name.to_owned()],
            length,
            offset: *offset,
            padding: false,
        };
        *offset += length;
        Some(file)
    })
    .collect();
    Metainfo {
        info_hash: [7; 20],
        piece_hashes: vec![[8; 20]; 5],
        piece_length: 16,
        total_length: 80,
        name: "Show Season 1".to_owned(),
        private: false,
        mode: MetainfoMode::MultiFile,
        files,
    }
}

fn durable(name: &str) -> BTreeMap<String, DurableTorrentViewState> {
    let files = FileProgressModel::new_with_media(
        &metainfo(),
        &[],
        &[],
        None,
        crate::MediaFileAvailability::Available,
    )
    .expect("library files");
    BTreeMap::from([(
        TORRENT_ID.to_owned(),
        DurableTorrentViewState {
            display_name: Some(name.to_owned()),
            source_display_name: None,
            source_size_bytes: None,
            private_torrent: false,
            checking_generation: None,
            verified: Vec::new(),
            files: Some(files),
            eta_geometry: None,
            trackers: TrackerViewModel::default(),
            total_size: 80,
            lifetime: Default::default(),
            seeding: Default::default(),
        },
    )])
}

fn installed_hub() -> ViewHub {
    let hub = ViewHub::new(&snapshot(0, 5)).expect("hub");
    hub.replace_durable(&snapshot(1, 5), &durable("Show Season 1"))
        .expect("install files");
    hub
}

fn library_spec(query: LibraryMediaQuery, limit: u32) -> SubscriptionSpec {
    SubscriptionSpec {
        selector: ViewSelector::Library { query },
        projection: ViewProjection::LibraryMedia,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: 256 * 1024,
        },
        diagnostics: None,
        catalog_page: Some(CatalogPageRequest { offset: 0, limit }),
    }
}

#[tokio::test]
async fn progress_patches_rows_and_offline_changes_replace_the_page() {
    let hub = installed_hub();
    let subscription = hub
        .subscribe(library_spec(LibraryMediaQuery::default(), 10))
        .expect("library subscription");
    let initial = subscription.next_update().await.expect("library snapshot");
    let ViewUpdatePayload::Snapshot {
        snapshot:
            ViewSnapshot::LibraryMedia {
                page,
                facets,
                items,
                groups,
            },
    } = initial.payload
    else {
        panic!("library snapshot expected");
    };
    assert_eq!(page.total, 2);
    assert_eq!(facets.episodes, 2);
    assert!(groups.is_empty());
    assert_eq!(
        items
            .iter()
            .map(|item| (item.item_id.as_str(), item.verified_bytes.as_str()))
            .collect::<Vec<_>>(),
        [
            (&*format!("{TORRENT_ID}:0"), "0"),
            (&*format!("{TORRENT_ID}:1"), "0")
        ]
    );

    // Half of the first episode verifies: a row patch, not a new page.
    hub.record_pieces_durable(TORRENT_ID, &[0], 2)
        .expect("verify first half");
    let update = subscription.next_update().await.expect("row patch");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::LibraryMedia { upsert },
    } = update.payload
    else {
        panic!("library patch expected, got {:?}", update.payload);
    };
    assert_eq!(upsert.len(), 1);
    assert_eq!(upsert[0].verified_bytes, "16");
    assert!(!upsert[0].offline);

    // The text file's piece changes nothing in the Library.
    hub.record_pieces_durable(TORRENT_ID, &[4], 3)
        .expect("verify text file");
    // Completing the episode changes facets, so the page is replaced.
    hub.record_pieces_durable(TORRENT_ID, &[1], 4)
        .expect("verify second half");
    let update = subscription.next_update().await.expect("replacement page");
    let ViewUpdatePayload::Snapshot {
        snapshot: ViewSnapshot::LibraryMedia { facets, items, .. },
    } = update.payload
    else {
        panic!("library snapshot expected, got {:?}", update.payload);
    };
    assert_eq!(facets.offline, 1);
    assert!(items[0].offline);
    assert_eq!(
        items[0].media_availability,
        crate::MediaFileAvailability::Available
    );
    assert_eq!(hub.library_memo_len(), 1);

    // Archiving removes the torrent's items from the default scope.
    let mut archived = snapshot(5, 5);
    archived.torrents[0].archived = true;
    hub.replace_durable(&archived, &durable("Show Season 1"))
        .expect("archive");
    let update = subscription.next_update().await.expect("archived page");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::LibraryMedia { ref items, ref page, .. }
        } if items.is_empty() && page.total == 0
    ));

    drop(subscription);
    hub.replace_durable(&snapshot(6, 5), &durable("Renamed"))
        .expect("publish without consumers");
    assert_eq!(hub.library_memo_len(), 0);
}

#[tokio::test]
async fn renaming_a_torrent_rebuilds_its_rows() {
    let hub = installed_hub();
    let subscription = hub
        .subscribe(library_spec(LibraryMediaQuery::default(), 10))
        .expect("library subscription");
    subscription.next_update().await.expect("library snapshot");
    hub.replace_durable(&snapshot(2, 5), &durable("Renamed Show"))
        .expect("rename");
    let update = subscription.next_update().await.expect("renamed rows");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::LibraryMedia { upsert },
    } = update.payload
    else {
        panic!("library patch expected, got {:?}", update.payload);
    };
    assert_eq!(upsert.len(), 2);
    assert!(
        upsert
            .iter()
            .all(|item| item.torrent_name == "Renamed Show")
    );
}

#[test]
fn library_specs_are_validated() {
    let hub = installed_hub();
    for (spec, expected) in [
        (
            library_spec(LibraryMediaQuery::default(), 129),
            SubscriptionError::InvalidCatalogPage { maximum: 128 },
        ),
        (
            SubscriptionSpec {
                catalog_page: None,
                ..library_spec(LibraryMediaQuery::default(), 10)
            },
            SubscriptionError::InvalidProjection,
        ),
        (
            SubscriptionSpec {
                projection: ViewProjection::Files,
                ..library_spec(LibraryMediaQuery::default(), 10)
            },
            SubscriptionError::InvalidProjection,
        ),
        (
            SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                ..library_spec(LibraryMediaQuery::default(), 10)
            },
            SubscriptionError::InvalidProjection,
        ),
    ] {
        assert_eq!(hub.subscribe(spec).err(), Some(expected));
    }
    let invalid = LibraryMediaQuery {
        group_id: Some("elsewhere:x".to_owned()),
        ..LibraryMediaQuery::default()
    };
    assert!(matches!(
        hub.subscribe(library_spec(invalid, 10)),
        Err(SubscriptionError::InvalidQuery(_))
    ));
}

#[tokio::test]
async fn view_sets_lease_library_pages_and_replace_them_on_query_change() {
    let hub = installed_hub();
    let owner = ViewSetOwner::trusted("library-owner");
    let spec = |archived| ViewSpec::LibraryMedia {
        view_id: "library-media".to_owned(),
        query: LibraryMediaQuery {
            archived,
            ..LibraryMediaQuery::default()
        },
        page: None,
        delivery: ViewDeliveryPolicy::default(),
    };
    let response = hub
        .open_view_set(
            owner.clone(),
            OpenViewSetRequest {
                views: vec![spec(LibraryArchivedFilter::Exclude)],
                options: OpenViewSetOptions::default(),
            },
        )
        .expect("open library view set");
    assert_eq!(
        response.effective_views,
        vec![spec(LibraryArchivedFilter::Exclude)]
    );
    assert!(matches!(
        &response.initial.updates[..],
        [ViewSetUpdate::Snapshot {
            snapshot: ViewSnapshot::LibraryMedia { page, .. },
            ..
        }] if page.limit == crate::DEFAULT_LIBRARY_PAGE_ROWS && page.total == 2
    ));

    hub.update_view_set(
        &owner,
        &response.view_set_id,
        UpdateViewSetRequest {
            views: vec![spec(LibraryArchivedFilter::Only)],
        },
    )
    .expect("change query");
    let view_set = hub
        .view_set(&owner, &response.view_set_id)
        .expect("view set");
    let batch = view_set
        .next_updates(&response.initial.cursor, 0)
        .await
        .expect("query change");
    assert!(matches!(
        &batch.updates[..],
        [ViewSetUpdate::Snapshot {
            snapshot: ViewSnapshot::LibraryMedia { page, .. },
            ..
        }] if page.total == 0
    ));

    hub.record_pieces_durable(TORRENT_ID, &[0], 2)
        .expect("progress outside the archived query");
    assert_eq!(hub.library_memo_len(), 1);
}
