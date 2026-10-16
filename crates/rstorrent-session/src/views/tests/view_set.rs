use super::super::*;
use super::*;
use crate::diagnostics::{MAX_DIAGNOSTIC_PATCH_EVENTS, category};
use crate::views::contract::{
    MAX_VIEW_SETS, MAX_VIEW_SETS_PER_OWNER, MIN_VIEW_SET_EVICTION_IDLE_MILLIS,
};
use crate::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticFilter, DiagnosticRetention, DiagnosticSeverity,
    FileCatalogState, FileSelectionView, FileView, MediaCatalogState, MediaFileAvailability,
    MediaItemView, MediaRoleView, ProgressAction, ProgressAssessment, ProgressDisposition,
    ProgressPhase, ProgressReason, ServiceSnapshot, SpeedMetric, SpeedRange, StorageState,
    TorrentSnapshot, TorrentState, TorrentView,
};
use rstorrent_engine::peer::{PeerSource, PeerSources};
use rstorrent_engine::swarm::ConnectionId;
use rstorrent_engine::{
    PeerConnectionDirection, PeerConnectionLifecycle, PeerConnectionObservation,
    PeerConnectionRole, PeerContentActivity, PeerRequestWindowPhase, PeerTransport,
    PeerUploadActivity, PeerUploadGrant,
};

const TORRENT_ID: &str = "t1-000102030405060708090a0b0c0d0e0f";
const V1_INFO_HASH: &str = "000102030405060708090a0b0c0d0e0f10111213";

#[tokio::test]
async fn removed_torrent_piece_view_replays_empty_snapshot_and_reappears() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(
            owner.clone(),
            open_request(vec![ViewSpec::PieceActivity {
                view_id: "pieces".into(),
                torrent_id: TORRENT_ID.into(),
                delivery: ViewDeliveryPolicy::default(),
            }]),
        )
        .expect("open pieces");
    let set = hub.view_set(&owner, &opened.view_set_id).expect("set");
    hub.record_pieces_durable(TORRENT_ID, &[0, 2], 1)
        .expect("durable pieces");
    hub.record_activity(
        TORRENT_ID,
        TorrentActivity::PieceStarted {
            piece_index: 1,
            piece_length: 16384,
            attempt: 1,
        },
    )
    .expect("active attempt");
    let mut removed = service_snapshot(2, 0);
    removed.torrents.clear();
    hub.replace_durable(&removed, &BTreeMap::new())
        .expect("remove torrent");
    let batch = set
        .next_updates(&opened.initial.cursor, 0)
        .await
        .expect("removed");
    assert_eq!(batch.durable_revision, "2");
    assert!(
        matches!(batch.updates.as_slice(), [ViewSetUpdate::Snapshot {
        view_id, snapshot: ViewSnapshot::PieceActivity {
            piece_count: 0, verified, active, ..
        }
    }] if view_id == "pieces" && verified.is_empty() && active.is_empty())
    );
    assert_eq!(
        set.next_updates(&opened.initial.cursor, 0)
            .await
            .expect("replay"),
        batch
    );
    hub.replace_durable(&service_snapshot(3, 0), &BTreeMap::new())
        .expect("reappear");
    let reappeared = set
        .next_updates(&batch.cursor, 0)
        .await
        .expect("new geometry");
    assert!(
        matches!(reappeared.updates.as_slice(), [ViewSetUpdate::Snapshot {
        snapshot: ViewSnapshot::PieceActivity { piece_count: 3, verified, active, .. }, ..
    }] if verified.is_empty() && active.is_empty())
    );
}

fn protocol_identities() -> crate::TorrentProtocolIdentities {
    crate::TorrentProtocolIdentities {
        v1: Some(V1_INFO_HASH.to_owned()),
        v2: None,
    }
}

fn torrent_view(id: &str, verified: u32) -> TorrentView {
    TorrentView {
        safety_summary: None,
        torrent_id: id.to_owned(),
        protocol_identities: protocol_identities(),
        display_name: Some("Fixture torrent".to_owned()),
        source_display_name: None,
        source_size_bytes: None,
        state: TorrentState::Downloading,
        operational_state: TorrentOperationalState::Downloading,
        download_queue_position: None,
        transfer_limits: Default::default(),
        storage_state: StorageState::Available,
        storage_root: "downloads".to_owned(),
        metadata_available: true,
        private_torrent: false,
        awaiting_file_selection: false,
        pending_file_selection_position: None,
        file_catalog_id: None,
        selectable_file_count: 0,
        selected_file_count: 0,
        selectable_file_bytes: "0".to_owned(),
        selected_file_bytes: "0".to_owned(),
        piece_count: 3,
        total_size_bytes: Some("32771".to_owned()),
        verified_piece_count: verified,
        requested_bytes: "0".to_owned(),
        received_bytes: "0".to_owned(),
        stored_bytes: "0".to_owned(),
        active_peer_connections: 0,
        configured_tracker_count: Some(2),
        payload_download_rate_bytes: "0".to_owned(),
        required_payload_bytes: None,
        remaining_payload_bytes: None,
        eta_payload_download_rate_bytes: "0".to_owned(),
        eta: TorrentEtaView::Unavailable,
        lifetime: Default::default(),
        seeding: Default::default(),
        progress: ProgressAssessment {
            disposition: ProgressDisposition::Active,
            phase: ProgressPhase::Transfer,
            reason: ProgressReason::TransferringPieces,
            actions: Vec::<ProgressAction>::new(),
        },
        checking: None,
        archived: false,
        removal_state: None,
        delete_data_supported: true,
        force_recheck_available: true,
        error: None,
    }
}

fn spec() -> ViewSpec {
    ViewSpec::TorrentList {
        view_id: "library".to_owned(),
        delivery: ViewDeliveryPolicy::default(),
    }
}

fn service_snapshot(revision: u64, verified: u32) -> ServiceSnapshot {
    ServiceSnapshot {
        profile_id: "test".to_owned(),
        revision: revision.to_string(),
        storage: Default::default(),
        client_settings: Default::default(),
        torrents: vec![TorrentSnapshot {
            safety_summary: None,
            torrent_id: TORRENT_ID.to_owned(),
            protocol_identities: protocol_identities(),
            storage_root: "downloads".to_owned(),
            state: TorrentState::Downloading,
            storage_state: StorageState::Available,
            metadata_available: true,
            awaiting_file_selection: false,
            pending_file_selection_position: None,
            file_catalog_id: None,
            selectable_file_count: 0,
            selected_file_count: 0,
            selectable_file_bytes: "0".to_owned(),
            selected_file_bytes: "0".to_owned(),
            piece_count: 3,
            verified_piece_count: verified,
            desired_running: true,
            download_queue_position: None,
            transfer_limits: Default::default(),
            seed_stop_limits: Default::default(),
            seed_limit_stopped: false,
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            selection_default: Default::default(),
            selection_exceptions: Vec::new(),
            archived: false,
            removal_state: None,
            delete_data_supported: true,
            force_recheck_available: true,
            error: None,
        }],
    }
}

fn open_request(views: Vec<ViewSpec>) -> OpenViewSetRequest {
    OpenViewSetRequest {
        views,
        options: OpenViewSetOptions::default(),
    }
}

fn inner(now: Instant) -> Arc<ViewSetInner> {
    let views = BTreeMap::from([("library".to_owned(), spec())]);
    ViewSetInner::new(
        "vs_test".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views,
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![ViewSetUpdate::Snapshot {
                view_id: "library".to_owned(),
                snapshot: ViewSnapshot::TorrentList {
                    torrents: vec![torrent_view("aa", 0)],
                    storage: Default::default(),
                    client_settings: Default::default(),
                },
            }],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("view set")
}

fn multi_view_inner(now: Instant) -> Arc<ViewSetInner> {
    let delivery = ViewDeliveryPolicy {
        min_interval_millis: 1_000,
    };
    let library = ViewSpec::TorrentList {
        view_id: "library".to_owned(),
        delivery,
    };
    let summary = ViewSpec::TorrentSummary {
        view_id: "summary".to_owned(),
        torrent_id: TORRENT_ID.to_owned(),
        delivery,
    };
    ViewSetInner::new(
        "vs_multi".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views: BTreeMap::from([
                ("library".to_owned(), library),
                ("summary".to_owned(), summary),
            ]),
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![
                ViewSetUpdate::Snapshot {
                    view_id: "library".to_owned(),
                    snapshot: ViewSnapshot::TorrentList {
                        torrents: vec![torrent_view(TORRENT_ID, 0)],
                        storage: Default::default(),
                        client_settings: Default::default(),
                    },
                },
                ViewSetUpdate::Snapshot {
                    view_id: "summary".to_owned(),
                    snapshot: ViewSnapshot::Torrent {
                        torrent: Some(torrent_view(TORRENT_ID, 0)),
                    },
                },
            ],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("multi-view set")
}

fn library_patch(verified: u32) -> ViewPatch {
    ViewPatch::TorrentList {
        upsert: vec![torrent_view(TORRENT_ID, verified)],
        updates: Vec::new(),
        removed: Vec::new(),
        storage: None,
        client_settings: None,
    }
}

fn summary_patch(verified: u32) -> ViewPatch {
    ViewPatch::Torrent {
        change: TorrentViewChange::Replace {
            torrent: Some(torrent_view(TORRENT_ID, verified)),
        },
    }
}

fn diagnostic_event(sequence: u32) -> DiagnosticEvent {
    DiagnosticEvent {
        sequence: sequence.to_string(),
        timestamp_millis: sequence.to_string(),
        severity: DiagnosticSeverity::Info,
        category: DiagnosticCategory::from_static(category::LIFECYCLE_TORRENT),
        code: "coalesce".to_owned(),
        torrent_id: None,
        message: format!("event {sequence}"),
        subjects: Vec::new(),
        fields: Vec::new(),
    }
}

fn diagnostic_patch(events: Vec<DiagnosticEvent>) -> ViewPatch {
    let retained_from_sequence = events
        .first()
        .map_or_else(|| "0".to_owned(), |event| event.sequence.clone());
    ViewPatch::Diagnostics {
        events,
        retention: DiagnosticRetention {
            source_evicted_count: "0".to_owned(),
            retained_from_sequence,
        },
    }
}

#[test]
fn validates_ids_counts_and_queue_bounds() {
    let duplicate = OpenViewSetRequest {
        views: vec![spec(), spec()],
        options: OpenViewSetOptions::default(),
    };
    assert!(matches!(
        validated_open(&duplicate),
        Err(ViewSetError::DuplicateViewId(_))
    ));
    let invalid = OpenViewSetRequest {
        views: vec![ViewSpec::TorrentList {
            view_id: "bad id".to_owned(),
            delivery: ViewDeliveryPolicy::default(),
        }],
        options: OpenViewSetOptions::default(),
    };
    assert_eq!(validated_open(&invalid), Err(ViewSetError::InvalidViewId));
    let queue = OpenViewSetRequest {
        views: vec![spec()],
        options: OpenViewSetOptions {
            requested_queue_bytes: Some(1),
        },
    };
    assert!(matches!(
        validated_open(&queue),
        Err(ViewSetError::InvalidQueueBound { .. })
    ));
}

#[test]
fn maximum_file_page_is_separate_from_steady_queue_pressure() {
    let now = Instant::now();
    let files = (0..1_024_u32)
        .map(|index| FileView {
            safety: None,
            file_id: index.to_string(),
            file_index: index,
            path: vec![format!("directory-{index:04}"), "x".repeat(128)],
            length_bytes: "16384".to_owned(),
            torrent_offset_bytes: (u64::from(index) * 16_384).to_string(),
            first_piece: Some(index),
            last_piece: Some(index),
            selection: Some(FileSelectionView::Normal),
            padding: false,
            done_bytes: "0".to_owned(),
            verified_bytes: "0".to_owned(),
            media_availability: MediaFileAvailability::Unverified,
        })
        .collect::<Vec<_>>();
    let snapshot = ViewSnapshot::Files {
        torrent_id: TORRENT_ID.to_owned(),
        state: FileCatalogState::Available,
        filesystem_content_base: Some("/tmp/rstorrent/content".to_owned()),
        page: CatalogPageView {
            offset: 0,
            limit: 1_024,
            total: 4_096,
            next_offset: Some(1_024),
        },
        files,
    };
    let encoded_snapshot = serde_json::to_vec(&snapshot)
        .expect("encode snapshot")
        .len();
    assert!(encoded_snapshot > DEFAULT_VIEW_SET_QUEUE_BYTES as usize);
    assert!(encoded_snapshot < MAX_VIEW_SET_SNAPSHOT_BYTES as usize);
    let spec = ViewSpec::TorrentFiles {
        view_id: "files".to_owned(),
        torrent_id: TORRENT_ID.to_owned(),
        page: Some(CatalogPageRequest::default()),
        delivery: ViewDeliveryPolicy::default(),
    };
    let inner = ViewSetInner::new(
        "vs_files".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views: BTreeMap::from([("files".to_owned(), spec)]),
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![ViewSetUpdate::Snapshot {
                view_id: "files".to_owned(),
                snapshot,
            }],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("large file view set");
    inner
        .enqueue_patch(
            "files",
            ViewPatch::Files {
                torrent_id: TORRENT_ID.to_owned(),
                upsert: vec![FileView {
                    safety: None,
                    file_id: "0".to_owned(),
                    file_index: 0,
                    path: vec!["updated".to_owned()],
                    length_bytes: "16384".to_owned(),
                    torrent_offset_bytes: "0".to_owned(),
                    first_piece: Some(0),
                    last_piece: Some(0),
                    selection: Some(FileSelectionView::Normal),
                    padding: false,
                    done_bytes: "16384".to_owned(),
                    verified_bytes: "0".to_owned(),
                    media_availability: MediaFileAvailability::Unverified,
                }],
                updates: Vec::new(),
                removed: Vec::new(),
            },
            8,
        )
        .expect("patch behind in-flight snapshot");
    assert!(inner.state().expect("state").reset_pending.is_none());
}

#[test]
fn maximum_media_catalog_is_separate_from_steady_queue_pressure() {
    let now = Instant::now();
    let items = (0..4_096_u32)
        .map(|index| MediaItemView {
            media_id: index.to_string(),
            file_index: index,
            path: vec![
                format!("Season-{:02}", index % 100),
                format!("episode-{index:04}-{}.mkv", "x".repeat(96)),
            ],
            extension: "mkv".to_owned(),
            length_bytes: "16777216".to_owned(),
            selection: FileSelectionView::Normal,
            done_bytes: "8388608".to_owned(),
            verified_bytes: "4194304".to_owned(),
            media_availability: MediaFileAvailability::Unverified,
            role: MediaRoleView::Episode {
                series_title_hint: "Bounded catalog fixture".to_owned(),
                season_number: u16::try_from(index % 100).expect("bounded season"),
                episode_number: u16::try_from(index % 1_000).expect("bounded episode"),
                ending_episode_number: None,
            },
        })
        .collect::<Vec<_>>();
    let snapshot = ViewSnapshot::Media {
        torrent_id: TORRENT_ID.to_owned(),
        state: MediaCatalogState::Available,
        total_non_padding_files: 4_096,
        items,
    };
    let encoded_snapshot = serde_json::to_vec(&snapshot)
        .expect("encode media snapshot")
        .len();
    assert!(encoded_snapshot > DEFAULT_VIEW_SET_QUEUE_BYTES as usize);
    assert!(encoded_snapshot < MAX_VIEW_SET_SNAPSHOT_BYTES as usize);
    let spec = ViewSpec::TorrentMedia {
        view_id: "media".to_owned(),
        torrent_id: TORRENT_ID.to_owned(),
        delivery: ViewDeliveryPolicy::default(),
    };
    let inner = ViewSetInner::new(
        "vs_media".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views: BTreeMap::from([("media".to_owned(), spec)]),
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![ViewSetUpdate::Snapshot {
                view_id: "media".to_owned(),
                snapshot,
            }],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("large media view set");
    let stats = inner.stats().expect("view stats");
    assert!(stats.queue_high_water > encoded_snapshot);
    assert!(stats.queue_high_water < MAX_VIEW_SET_SNAPSHOT_BYTES as usize);
    eprintln!(
        "media_view_scale rows=4096 encoded_bytes={} queue_high_water={}",
        encoded_snapshot, stats.queue_high_water,
    );
}

#[test]
fn replays_until_acknowledged_then_emits_accumulated_patch() {
    let now = Instant::now();
    let inner = inner(now);
    let first = match inner.poll_state(0, now).expect("poll") {
        PollState::Ready(batch) => batch,
        _ => panic!("initial batch missing"),
    };
    assert_eq!(first.cursor, "1");
    let replay = match inner.poll_state(0, now).expect("poll") {
        PollState::Ready(batch) => batch,
        _ => panic!("replay missing"),
    };
    assert_eq!(replay, first);
    inner
        .enqueue_patch(
            "library",
            ViewPatch::TorrentList {
                upsert: vec![torrent_view("aa", 1)],
                updates: Vec::new(),
                removed: Vec::new(),
                storage: None,
                client_settings: None,
            },
            8,
        )
        .expect("patch");
    let next = match inner.poll_state(1, Instant::now()).expect("poll") {
        PollState::Ready(batch) => batch,
        _ => panic!("next batch missing"),
    };
    assert_eq!(next.base_cursor, "1");
    assert_eq!(next.cursor, "2");
    assert_eq!(next.durable_revision, "8");
    assert_eq!(next.updates.len(), 1);
}

#[test]
fn mismatched_cursor_requests_reset() {
    let now = Instant::now();
    let inner = inner(now);
    assert!(matches!(
        inner.poll_state(99, now).expect("poll"),
        PollState::Reset(ResetReason::CursorMismatch)
    ));
}

#[test]
fn nonzero_delivery_interval_defers_accumulated_patch_without_a_task() {
    let now = Instant::now();
    let delayed = ViewSpec::TorrentList {
        view_id: "library".to_owned(),
        delivery: ViewDeliveryPolicy {
            min_interval_millis: 1_000,
        },
    };
    let inner = ViewSetInner::new(
        "vs_delayed".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views: BTreeMap::from([("library".to_owned(), delayed)]),
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![ViewSetUpdate::Snapshot {
                view_id: "library".to_owned(),
                snapshot: ViewSnapshot::TorrentList {
                    torrents: vec![torrent_view("aa", 0)],
                    storage: Default::default(),
                    client_settings: Default::default(),
                },
            }],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("view set");
    assert!(matches!(
        inner.poll_state(1, now).expect("acknowledge initial"),
        PollState::Wait(None)
    ));
    inner
        .enqueue_patch(
            "library",
            ViewPatch::TorrentList {
                upsert: vec![torrent_view("aa", 1)],
                updates: Vec::new(),
                removed: Vec::new(),
                storage: None,
                client_settings: None,
            },
            8,
        )
        .expect("patch");
    let ready_at = match inner.poll_state(1, Instant::now()).expect("poll") {
        PollState::Wait(Some(ready_at)) => ready_at,
        _ => panic!("patch should wait for its delivery interval"),
    };
    assert!(matches!(
        inner.poll_state(1, ready_at).expect("poll at deadline"),
        PollState::Ready(_)
    ));
}

#[test]
fn compatible_patches_coalesce_per_view_across_interleaved_ids() {
    let now = Instant::now();
    let inner = multi_view_inner(now);
    assert!(matches!(
        inner.poll_state(1, now).expect("acknowledge initial"),
        PollState::Wait(None)
    ));

    for (view_id, patch, revision) in [
        ("library", library_patch(1), 8),
        ("summary", summary_patch(1), 9),
        ("library", library_patch(2), 10),
        ("summary", summary_patch(2), 11),
    ] {
        inner
            .enqueue_patch(view_id, patch, revision)
            .expect("enqueue interleaved patch");
    }

    {
        let state = inner.state().expect("state");
        assert_eq!(state.pending.len(), 2);
        assert_eq!(
            state.pending_bytes,
            state
                .pending
                .iter()
                .map(|queued| queued.encoded_bytes)
                .sum::<usize>()
        );
    }
    let batch = match inner
        .poll_state(1, now + Duration::from_secs(2))
        .expect("poll coalesced patches")
    {
        PollState::Ready(batch) => batch,
        _ => panic!("coalesced patches were not ready"),
    };
    assert_eq!(batch.durable_revision, "11");
    assert_eq!(batch.updates.len(), 2);
    assert!(batch.updates.iter().any(|update| matches!(
        update,
        ViewSetUpdate::Patch {
            view_id,
            patch: ViewPatch::TorrentList { upsert, .. },
        } if view_id == "library" && upsert[0].verified_piece_count == 2
    )));
    assert!(batch.updates.iter().any(|update| matches!(
        update,
        ViewSetUpdate::Patch {
            view_id,
            patch: ViewPatch::Torrent {
                change: TorrentViewChange::Replace {
                    torrent: Some(torrent),
                },
            },
        } if view_id == "summary" && torrent.verified_piece_count == 2
    )));
}

#[test]
fn speed_history_appends_coalesce_without_losing_completed_buckets() {
    let now = Instant::now();
    let captured = 1_000_000;
    let mut rates = crate::speed::SessionRateHistory::new();
    let first = rates.view(
        SpeedRange::Seconds30,
        &[SpeedMetric::PayloadReceived, SpeedMetric::PayloadUploaded],
        captured,
    );
    let speed_spec = ViewSpec::SessionSpeedHistory {
        view_id: "speed".to_owned(),
        range: SpeedRange::Seconds30,
        metrics: vec![SpeedMetric::PayloadReceived, SpeedMetric::PayloadUploaded],
        delivery: ViewDeliveryPolicy {
            min_interval_millis: 1_000,
        },
    };
    let inner = ViewSetInner::new(
        "vs_speed".to_owned(),
        ViewSetOwner::trusted("owner"),
        ViewSetInitialState {
            clock_origin: now,
            revision: 7,
            views: BTreeMap::from([("speed".to_owned(), speed_spec)]),
            queue_bytes_limit: DEFAULT_VIEW_SET_QUEUE_BYTES,
            snapshots: vec![ViewSetUpdate::Snapshot {
                view_id: "speed".to_owned(),
                snapshot: ViewSnapshot::SessionSpeedHistory {
                    history: first.clone(),
                },
            }],
            now,
            lease: Duration::from_millis(VIEW_SET_LEASE_MILLIS),
        },
    )
    .expect("speed view set");
    assert!(matches!(
        inner.poll_state(1, now).expect("acknowledge snapshot"),
        PollState::Wait(None)
    ));

    rates.record_at(SpeedMetric::PayloadReceived, 100, captured + 50);
    let second = rates.view(
        SpeedRange::Seconds30,
        &[SpeedMetric::PayloadReceived, SpeedMetric::PayloadUploaded],
        captured + 200,
    );
    inner
        .enqueue_speed_history("speed", second, 8)
        .expect("first append");
    rates.record_at(SpeedMetric::PayloadUploaded, 200, captured + 250);
    let third = rates.view(
        SpeedRange::Seconds30,
        &[SpeedMetric::PayloadReceived, SpeedMetric::PayloadUploaded],
        captured + 400,
    );
    inner
        .enqueue_speed_history("speed", third.clone(), 9)
        .expect("second append");

    let batch = match inner
        .poll_state(1, now + Duration::from_secs(1))
        .expect("poll merged append")
    {
        PollState::Ready(batch) => batch,
        _ => panic!("merged append missing"),
    };
    assert_eq!(batch.updates.len(), 1);
    let ViewSetUpdate::Patch {
        patch: ViewPatch::SessionSpeedHistory { append },
        ..
    } = &batch.updates[0]
    else {
        panic!("expected speed history append");
    };
    assert_eq!(append.series.len(), 2);
    assert_eq!(append.series[0].values.len(), 4);
    let mut reconstructed = first;
    reconstructed
        .apply_append(append)
        .expect("merged append applies");
    assert_eq!(reconstructed, third);
}

#[test]
fn same_view_replacement_is_a_coalescing_barrier() {
    let now = Instant::now();
    let inner = multi_view_inner(now);
    let mut state = inner.state().expect("state");
    state.in_flight = None;
    state.acknowledged_cursor = 1;

    enqueue_update(
        &mut state,
        ViewSetUpdate::Patch {
            view_id: "library".to_owned(),
            patch: library_patch(1),
        },
        now,
    )
    .expect("first library patch");
    enqueue_update(
        &mut state,
        ViewSetUpdate::Patch {
            view_id: "summary".to_owned(),
            patch: summary_patch(1),
        },
        now,
    )
    .expect("interleaved summary patch");
    enqueue_update(
        &mut state,
        ViewSetUpdate::Snapshot {
            view_id: "library".to_owned(),
            snapshot: ViewSnapshot::TorrentList {
                torrents: vec![torrent_view(TORRENT_ID, 2)],
                storage: Default::default(),
                client_settings: Default::default(),
            },
        },
        now,
    )
    .expect("replacement snapshot");
    enqueue_update(
        &mut state,
        ViewSetUpdate::Patch {
            view_id: "library".to_owned(),
            patch: library_patch(3),
        },
        now,
    )
    .expect("patch after replacement");

    assert!(matches!(
        state.pending.iter().collect::<Vec<_>>().as_slice(),
        [
            QueuedViewSetUpdate {
                update: ViewSetUpdate::Patch { view_id: summary, .. },
                ..
            },
            QueuedViewSetUpdate {
                update: ViewSetUpdate::Snapshot { view_id: snapshot, .. },
                ..
            },
            QueuedViewSetUpdate {
                update: ViewSetUpdate::Patch { view_id: patch, .. },
                ..
            }
        ] if summary == "summary" && snapshot == "library" && patch == "library"
    ));
}

#[test]
fn diagnostics_preserve_order_and_do_not_merge_past_a_full_segment() {
    let now = Instant::now();
    let inner = multi_view_inner(now);
    let mut state = inner.state().expect("state");
    state.in_flight = None;
    state.acknowledged_cursor = 1;

    let first_segment = (1..=MAX_DIAGNOSTIC_PATCH_EVENTS as u32)
        .map(diagnostic_event)
        .collect();
    for (view_id, patch) in [
        ("logs", diagnostic_patch(first_segment)),
        ("library", library_patch(1)),
        (
            "logs",
            diagnostic_patch(vec![diagnostic_event(
                MAX_DIAGNOSTIC_PATCH_EVENTS as u32 + 1,
            )]),
        ),
        ("summary", summary_patch(1)),
        (
            "logs",
            diagnostic_patch(vec![diagnostic_event(
                MAX_DIAGNOSTIC_PATCH_EVENTS as u32 + 2,
            )]),
        ),
    ] {
        enqueue_update(
            &mut state,
            ViewSetUpdate::Patch {
                view_id: view_id.to_owned(),
                patch,
            },
            now,
        )
        .expect("enqueue diagnostic sequence");
    }

    let diagnostic_segments = state
        .pending
        .iter()
        .filter_map(|queued| match &queued.update {
            ViewSetUpdate::Patch {
                view_id,
                patch: ViewPatch::Diagnostics { events, .. },
            } if view_id == "logs" => Some(events),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(diagnostic_segments.len(), 2);
    assert_eq!(diagnostic_segments[0].len(), MAX_DIAGNOSTIC_PATCH_EVENTS);
    assert_eq!(
        diagnostic_segments[1]
            .iter()
            .map(|event| event.sequence.as_str())
            .collect::<Vec<_>>(),
        ["129", "130"]
    );
    assert_eq!(
        state.pending_bytes,
        state
            .pending
            .iter()
            .map(|queued| queued.encoded_bytes)
            .sum::<usize>()
    );
}

#[test]
fn expiry_and_close_are_observable() {
    let now = Instant::now();
    let inner = inner(now);
    assert!(!inner.is_expired(now));
    assert!(inner.is_expired(now + Duration::from_millis(VIEW_SET_LEASE_MILLIS)));
    inner.close();
    assert!(matches!(
        inner.poll_state(0, now).expect("poll"),
        PollState::Closed
    ));
}

#[tokio::test]
async fn hub_publishes_independent_replayable_batches() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let first = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("first view set");
    let second = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("second view set");
    let first_set = hub
        .view_set(&owner, &first.view_set_id)
        .expect("first handle");
    let second_set = hub
        .view_set(&owner, &second.view_set_id)
        .expect("second handle");

    hub.replace_durable(&service_snapshot(1, 1), &BTreeMap::new())
        .expect("replace durable state");
    let first_batch = first_set
        .next_updates(&first.initial.cursor, 0)
        .await
        .expect("first patch");
    let replay = first_set
        .next_updates(&first.initial.cursor, 0)
        .await
        .expect("replay");
    let second_batch = second_set
        .next_updates(&second.initial.cursor, 0)
        .await
        .expect("second patch");

    assert_eq!(replay, first_batch);
    assert_eq!(first_batch.durable_revision, "1");
    assert_eq!(second_batch.durable_revision, "1");
    assert_ne!(first_batch.view_set_id, second_batch.view_set_id);
    assert!(matches!(
        first_batch.updates.as_slice(),
        [ViewSetUpdate::Patch { view_id, .. }] if view_id == "library"
    ));
}

#[tokio::test]
async fn view_replacement_is_atomic_and_reports_removal() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("view set");
    let details = ViewSpec::TorrentSummary {
        view_id: "details".to_owned(),
        torrent_id: TORRENT_ID.to_owned(),
        delivery: ViewDeliveryPolicy::default(),
    };
    hub.update_view_set(
        &owner,
        &opened.view_set_id,
        UpdateViewSetRequest {
            views: vec![details.clone()],
        },
    )
    .expect("replace views");
    let view_set = hub
        .view_set(&owner, &opened.view_set_id)
        .expect("view set handle");
    let batch = view_set
        .next_updates(&opened.initial.cursor, 0)
        .await
        .expect("replacement batch");

    assert_eq!(batch.updates.len(), 2);
    assert!(batch.updates.contains(&ViewSetUpdate::ViewRemoved {
        view_id: "library".to_owned(),
    }));
    assert!(matches!(
        batch.updates.as_slice(),
        [_, ViewSetUpdate::Snapshot { view_id, .. }] if view_id == details.view_id()
    ));
}

#[test]
fn owners_cannot_observe_or_mutate_each_others_sets() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner-a");
    let stranger = ViewSetOwner::trusted("owner-b");
    let opened = hub
        .open_view_set(owner, open_request(vec![spec()]))
        .expect("view set");

    assert!(matches!(
        hub.view_set(&stranger, &opened.view_set_id),
        Err(ViewSetError::UnknownViewSet)
    ));
    assert!(matches!(
        hub.close_view_set(&stranger, &opened.view_set_id),
        Err(ViewSetError::UnknownViewSet)
    ));
}

#[tokio::test]
async fn queue_overflow_rotates_epoch_and_restores_snapshots() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(
            owner.clone(),
            OpenViewSetRequest {
                views: vec![ViewSpec::Diagnostics {
                    view_id: "logs".to_owned(),
                    torrent_id: None,
                    filter: DiagnosticFilter::default(),
                    delivery: ViewDeliveryPolicy::default(),
                }],
                options: OpenViewSetOptions {
                    requested_queue_bytes: Some(MIN_VIEW_SET_QUEUE_BYTES),
                },
            },
        )
        .expect("view set");
    let view_set = hub
        .view_set(&owner, &opened.view_set_id)
        .expect("view set handle");
    view_set
        .inner
        .enqueue_patch(
            "logs",
            ViewPatch::Diagnostics {
                events: vec![DiagnosticEvent {
                    sequence: "1".to_owned(),
                    timestamp_millis: "1".to_owned(),
                    severity: DiagnosticSeverity::Info,
                    category: DiagnosticCategory::from_static(category::LIFECYCLE_TORRENT),
                    code: "oversized".to_owned(),
                    torrent_id: None,
                    message: "x".repeat(MIN_VIEW_SET_QUEUE_BYTES as usize),
                    subjects: Vec::new(),
                    fields: Vec::new(),
                }],
                retention: DiagnosticRetention {
                    source_evicted_count: "0".to_owned(),
                    retained_from_sequence: "1".to_owned(),
                },
            },
            1,
        )
        .expect("overflow is converted to reset");

    let reset = view_set
        .next_updates(&opened.initial.cursor, 0)
        .await
        .expect("reset batch");
    assert_ne!(reset.epoch, opened.initial.epoch);
    assert!(
        parse_decimal(&reset.cursor).expect("reset cursor")
            > parse_decimal(&opened.initial.cursor).expect("initial cursor")
    );
    assert!(matches!(
        reset.updates.first(),
        Some(ViewSetUpdate::ResetRequired {
            reason: ResetReason::QueueOverflow,
            ..
        })
    ));
    assert!(matches!(
        reset.updates.get(1),
        Some(ViewSetUpdate::Snapshot { view_id, .. }) if view_id == "logs"
    ));
    assert_eq!(view_set.stats().expect("stats").reset_count, 1);
}

#[test]
fn expired_sets_are_pruned_from_owner_capacity() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("view set");
    hub.expire_view_sets_at(Instant::now() + Duration::from_millis(VIEW_SET_LEASE_MILLIS));

    assert!(matches!(
        hub.view_set(&owner, &opened.view_set_id),
        Err(ViewSetError::UnknownViewSet)
    ));
    hub.open_view_set(owner, open_request(vec![spec()]))
        .expect("expired capacity is reclaimed");
}

#[test]
fn abandoned_sets_are_evicted_least_recent_first_at_the_application_limit() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let start = Instant::now();
    let opened = (0..MAX_VIEW_SETS)
        .map(|index| {
            let owner = ViewSetOwner::trusted(format!("page-{index}"));
            let at = start + Duration::from_millis(index as u64);
            let set = hub
                .open_view_set_at(owner.clone(), open_request(vec![spec()]), at)
                .expect("view set");
            (owner, set.view_set_id)
        })
        .collect::<Vec<_>>();
    let newcomer = ViewSetOwner::trusted("reloaded page");
    let floor = Duration::from_millis(MIN_VIEW_SET_EVICTION_IDLE_MILLIS);

    assert!(matches!(
        hub.open_view_set_at(
            newcomer.clone(),
            open_request(vec![spec()]),
            start + floor - Duration::from_millis(1),
        ),
        Err(ViewSetError::ResourceLimit)
    ));
    hub.open_view_set_at(
        newcomer,
        open_request(vec![spec()]),
        start + floor + Duration::from_millis(1),
    )
    .expect("oldest abandoned set yields capacity");

    let (oldest_owner, oldest) = &opened[0];
    assert!(matches!(
        hub.view_set(oldest_owner, oldest),
        Err(ViewSetError::UnknownViewSet)
    ));
    for (owner, id) in &opened[1..] {
        assert!(hub.view_set(owner, id).is_ok());
    }
}

#[test]
fn owner_limit_evicts_only_that_owners_abandoned_sets() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let start = Instant::now();
    let bystander = ViewSetOwner::trusted("other page");
    let retained = hub
        .open_view_set_at(bystander.clone(), open_request(vec![spec()]), start)
        .expect("bystander set");
    let owner = ViewSetOwner::trusted("page");
    let opened = (1..=MAX_VIEW_SETS_PER_OWNER)
        .map(|index| {
            hub.open_view_set_at(
                owner.clone(),
                open_request(vec![spec()]),
                start + Duration::from_millis(index as u64),
            )
            .expect("owner set")
            .view_set_id
        })
        .collect::<Vec<_>>();

    let later = start + Duration::from_millis(MIN_VIEW_SET_EVICTION_IDLE_MILLIS + 1_000);
    hub.open_view_set_at(owner.clone(), open_request(vec![spec()]), later)
        .expect("owner's oldest set yields capacity");

    assert!(hub.view_set(&bystander, &retained.view_set_id).is_ok());
    assert!(matches!(
        hub.view_set(&owner, &opened[0]),
        Err(ViewSetError::UnknownViewSet)
    ));
    for id in &opened[1..] {
        assert!(hub.view_set(&owner, id).is_ok());
    }
}

#[tokio::test]
async fn polled_and_recently_active_sets_are_never_evicted() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let start = Instant::now();
    let owner = ViewSetOwner::trusted("page");
    let polled = hub
        .open_view_set_at(owner.clone(), open_request(vec![spec()]), start)
        .expect("polled set");
    let handle = hub.view_set(&owner, &polled.view_set_id).expect("handle");
    let waiting = handle.clone();
    let cursor = polled.initial.cursor.clone();
    let waiter = tokio::spawn(async move { waiting.next_updates(&cursor, 20_000).await });
    while !handle.inner.polling.load(Ordering::Acquire) {
        tokio::task::yield_now().await;
    }
    let floor = Duration::from_millis(MIN_VIEW_SET_EVICTION_IDLE_MILLIS);
    let later = start + floor + Duration::from_secs(1);
    for _ in 1..MAX_VIEW_SETS_PER_OWNER {
        hub.open_view_set_at(owner.clone(), open_request(vec![spec()]), later)
            .expect("recent set");
    }

    // The only silent set is being polled; the rest are recent.
    assert!(matches!(
        hub.open_view_set_at(owner.clone(), open_request(vec![spec()]), later),
        Err(ViewSetError::ResourceLimit)
    ));
    assert!(hub.view_set(&owner, &polled.view_set_id).is_ok());

    hub.close_view_set(&owner, &polled.view_set_id)
        .expect("close polled set");
    let _ = waiter.await;
}

#[tokio::test]
async fn close_wakes_a_waiting_long_poll() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("view set");
    let view_set = hub
        .view_set(&owner, &opened.view_set_id)
        .expect("view set handle");
    let cursor = opened.initial.cursor.clone();
    let waiting_view_set = view_set.clone();
    let waiter = tokio::spawn(async move { waiting_view_set.next_updates(&cursor, 20_000).await });
    while !view_set.inner.polling.load(Ordering::Acquire) {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        view_set.next_updates(&opened.initial.cursor, 0).await,
        Err(ViewSetError::ConsumerBusy)
    );
    hub.close_view_set(&owner, &opened.view_set_id)
        .expect("close");
    let result = tokio::time::timeout(Duration::from_secs(1), waiter)
        .await
        .expect("waiter timed out")
        .expect("waiter task");
    assert_eq!(result, Err(ViewSetError::Closed));
}

#[tokio::test]
async fn retiring_one_owner_reclaims_all_sets_and_wakes_only_its_waiter() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).unwrap();
    let owner = ViewSetOwner::trusted("departed page");
    let other = ViewSetOwner::trusted("native window");
    let retained = hub
        .open_view_set(other.clone(), open_request(vec![spec()]))
        .unwrap();
    let mut opened = Vec::new();
    for _ in 0..MAX_VIEW_SETS_PER_OWNER {
        opened.push(
            hub.open_view_set(owner.clone(), open_request(vec![spec()]))
                .unwrap(),
        );
    }
    let handle = hub.view_set(&owner, &opened[0].view_set_id).unwrap();
    let waiting = handle.clone();
    let cursor = opened[0].initial.cursor.clone();
    let waiter = tokio::spawn(async move { waiting.next_updates(&cursor, 20_000).await });
    while !handle.inner.polling.load(Ordering::Acquire) {
        tokio::task::yield_now().await;
    }
    hub.close_owner_view_sets(&owner);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap(),
        Err(ViewSetError::Closed)
    );
    for set in opened {
        assert!(matches!(
            hub.view_set(&owner, &set.view_set_id),
            Err(ViewSetError::UnknownViewSet)
        ));
    }
    assert!(hub.view_set(&other, &retained.view_set_id).is_ok());
    // Repeated cleanup cannot retire another owner, and capacity is immediate.
    hub.close_owner_view_sets(&owner);
    for _ in 0..MAX_VIEW_SETS_PER_OWNER {
        hub.open_view_set(owner.clone(), open_request(vec![spec()]))
            .unwrap();
    }
}

#[tokio::test]
async fn lease_reaper_closes_silent_set_and_wakes_long_poll() {
    let lease = Duration::from_millis(40);
    let hub = ViewHub::new_with_view_set_lease(&service_snapshot(0, 0), lease).expect("hub");
    let mut reaper = ViewSetLeaseReaper::start(hub.clone(), Duration::from_millis(5));
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(owner.clone(), open_request(vec![spec()]))
        .expect("view set");
    let view_set = hub
        .view_set(&owner, &opened.view_set_id)
        .expect("view set handle");
    let cursor = opened.initial.cursor.clone();
    let waiter = tokio::spawn(async move { view_set.next_updates(&cursor, 20_000).await });

    tokio::time::sleep(Duration::from_millis(20)).await;
    hub.record_diagnostic(
        DiagnosticSeverity::Info,
        category::LIFECYCLE_TORRENT,
        "producer_activity",
        None,
        "Producer publication must not renew a client lease",
        &[],
    )
    .expect("record producer activity");

    let result = tokio::time::timeout(Duration::from_millis(300), waiter)
        .await
        .expect("reaper did not wake waiter")
        .expect("waiter task");
    assert_eq!(result, Err(ViewSetError::Closed));
    assert!(matches!(
        hub.view_set(&owner, &opened.view_set_id),
        Err(ViewSetError::UnknownViewSet)
    ));
    reaper.shutdown().await.expect("join reaper");
}

#[tokio::test]
async fn peer_view_updates_generations_and_removes_only_on_cleanup() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let owner = ViewSetOwner::trusted("owner");
    let opened = hub
        .open_view_set(
            owner.clone(),
            open_request(vec![ViewSpec::TorrentPeers {
                view_id: "peers".to_owned(),
                torrent_id: TORRENT_ID.to_owned(),
                delivery: ViewDeliveryPolicy::default(),
            }]),
        )
        .expect("view set");
    let view_set = hub
        .view_set(&owner, &opened.view_set_id)
        .expect("view set handle");
    assert!(matches!(
        opened.initial.updates.as_slice(),
        [ViewSetUpdate::Snapshot {
            snapshot: ViewSnapshot::Peers { peers, .. },
            ..
        }] if peers.is_empty()
    ));

    let mut peer = PeerConnectionObservation {
        connection_id: ConnectionId::new(7).expect("connection"),
        record_id: None,
        endpoint: "127.0.0.1:6881".parse().expect("endpoint"),
        local_endpoint: None,
        sources: PeerSources::from_source(PeerSource::Manual),
        direction: PeerConnectionDirection::Incoming,
        transport: PeerTransport::Utp,
        lifecycle: PeerConnectionLifecycle::TransportConnecting,
        role: PeerConnectionRole::Metadata,
        started_at: Duration::from_millis(5),
        lifecycle_changed_at: Duration::from_millis(5),
        peer_id: None,
        supports_extensions: Some(true),
        supports_ut_metadata: None,
        mse_method: Some(rstorrent_protocol::mse::MseMethod::PlaintextPayload),
        content: None,
        upload: None,
        close_reason: None,
    };
    hub.record_peer_connections(TORRENT_ID, Duration::from_millis(10), &[peer.clone()])
        .expect("connecting row");
    let connecting = view_set
        .next_updates(&opened.initial.cursor, 0)
        .await
        .expect("connecting patch");
    assert!(matches!(
        connecting.updates.as_slice(),
        [ViewSetUpdate::Patch {
            patch: ViewPatch::Peers { upsert, removed, .. },
            ..
        }] if upsert.len() == 1
            && upsert[0].lifecycle == crate::PeerLifecycle::TransportConnecting
            && upsert[0].client_name.is_none()
            && upsert[0].capabilities.client_name == crate::CapabilityStatus::Unavailable
            && upsert[0].mse_method == Some(crate::PeerMseMethodView::PlaintextPayload)
            && upsert[0].peer_flags == [
                crate::PeerFlagView::Incoming,
                crate::PeerFlagView::Encrypted,
                crate::PeerFlagView::ExtensionProtocol,
                crate::PeerFlagView::Utp,
            ]
            && removed.is_empty()
    ));
    let mut projected_peer = match connecting.updates.as_slice() {
        [
            ViewSetUpdate::Patch {
                patch: ViewPatch::Peers { upsert, .. },
                ..
            },
        ] => upsert[0].clone(),
        _ => panic!("expected connecting peer upsert"),
    };

    peer.lifecycle = PeerConnectionLifecycle::Connected;
    peer.role = PeerConnectionRole::Content;
    peer.mse_method = Some(rstorrent_protocol::mse::MseMethod::Rc4);
    peer.lifecycle_changed_at = Duration::from_millis(12);
    peer.peer_id = Some(*b"-UT3550-abcdefghijkl");
    peer.content = Some(PeerContentActivity {
        choking: true,
        wanted_piece_count: 8,
        pending_requests: 2,
        target_requests: 4,
        queued_payload_bytes: 32 * 1_024,
        useful_payload_bytes: 0,
        observed_payload_rate: 0,
        connected_age: Duration::from_millis(3),
        last_useful_age: None,
        last_payload_age: None,
        request_timeout: Duration::from_secs(8),
        oldest_request_age: Some(Duration::from_millis(2)),
        request_window_phase: PeerRequestWindowPhase::SlowStart,
    });
    hub.record_peer_connections(TORRENT_ID, Duration::from_millis(15), &[peer.clone()])
        .expect("connected row");
    let connected = view_set
        .next_updates(&connecting.cursor, 0)
        .await
        .expect("connected patch");
    match connected.updates.as_slice() {
        [
            ViewSetUpdate::Patch {
                patch:
                    ViewPatch::Peers {
                        upsert,
                        updates,
                        removed,
                        ..
                    },
                ..
            },
        ] => {
            assert!(upsert.is_empty());
            assert!(removed.is_empty());
            assert_eq!(updates.len(), 1);
            updates[0].apply(&mut projected_peer).expect("peer update");
        }
        _ => panic!("expected connected peer update"),
    }
    assert_eq!(
        projected_peer.client_name.as_deref(),
        Some("µTorrent 3.5.5")
    );
    assert_eq!(
        projected_peer.capabilities.client_name,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.mse_method,
        Some(crate::PeerMseMethodView::Rc4)
    );
    assert_eq!(
        projected_peer.peer_flags,
        [
            crate::PeerFlagView::Incoming,
            crate::PeerFlagView::Encrypted,
            crate::PeerFlagView::DownloadChoked,
            crate::PeerFlagView::ExtensionProtocol,
            crate::PeerFlagView::Utp,
        ]
    );

    peer.content = None;
    peer.local_endpoint = Some("127.0.0.1:6882".parse().expect("local endpoint"));
    peer.supports_ut_metadata = Some(true);
    peer.upload = Some(PeerUploadActivity {
        interested: true,
        grant: PeerUploadGrant::Optimistic,
        queued_requests: 3,
        queued_bytes: 4_096,
        read_active: true,
        writer_bytes: 512,
        payload_bytes: 16_384,
        payload_rate: 8_192,
    });
    hub.record_peer_connections(TORRENT_ID, Duration::from_millis(18), &[peer.clone()])
        .expect("upload row");
    let uploading = view_set
        .next_updates(&connected.cursor, 0)
        .await
        .expect("upload patch");
    match uploading.updates.as_slice() {
        [
            ViewSetUpdate::Patch {
                patch:
                    ViewPatch::Peers {
                        upsert,
                        updates,
                        removed,
                        ..
                    },
                ..
            },
        ] => {
            assert!(upsert.is_empty());
            assert!(removed.is_empty());
            assert_eq!(updates.len(), 1);
            updates[0].apply(&mut projected_peer).expect("peer update");
        }
        _ => panic!("expected uploading peer update"),
    }
    assert_eq!(
        projected_peer.local_endpoint.as_deref(),
        Some("127.0.0.1:6882")
    );
    assert_eq!(projected_peer.supports_ut_metadata, Some(true));
    assert_eq!(projected_peer.remote_interested, Some(true));
    assert_eq!(projected_peer.local_choking, Some(false));
    assert_eq!(
        projected_peer.payload_upload_rate_bytes.as_deref(),
        Some("8192")
    );
    assert_eq!(
        projected_peer.payload_uploaded_bytes.as_deref(),
        Some("16384")
    );
    assert_eq!(projected_peer.pending_requests, Some(3));
    assert_eq!(projected_peer.queued_payload_bytes.as_deref(), Some("4608"));
    assert_eq!(projected_peer.connected_age_millis.as_deref(), Some("13"));
    assert_eq!(
        projected_peer.capabilities.local_endpoint,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.capabilities.ut_metadata,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.capabilities.interest_directions,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.capabilities.local_choke,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.capabilities.upload,
        crate::CapabilityStatus::Available
    );
    assert_eq!(
        projected_peer.peer_flags,
        [
            crate::PeerFlagView::Incoming,
            crate::PeerFlagView::Encrypted,
            crate::PeerFlagView::UploadAllowed,
            crate::PeerFlagView::ExtensionProtocol,
            crate::PeerFlagView::MetadataExtension,
            crate::PeerFlagView::Utp,
            crate::PeerFlagView::OptimisticUnchoke,
        ]
    );

    peer.lifecycle = PeerConnectionLifecycle::Disconnecting;
    peer.lifecycle_changed_at = Duration::from_millis(20);
    hub.record_peer_connections(TORRENT_ID, Duration::from_millis(25), &[peer])
        .expect("disconnecting row");
    let disconnecting = view_set
        .next_updates(&uploading.cursor, 0)
        .await
        .expect("disconnecting patch");
    match disconnecting.updates.as_slice() {
        [
            ViewSetUpdate::Patch {
                patch:
                    ViewPatch::Peers {
                        upsert,
                        updates,
                        removed,
                        ..
                    },
                ..
            },
        ] => {
            assert!(upsert.is_empty());
            assert!(removed.is_empty());
            assert_eq!(updates.len(), 1);
            updates[0].apply(&mut projected_peer).expect("peer update");
        }
        _ => panic!("expected disconnecting peer update"),
    }
    assert_eq!(
        projected_peer.lifecycle,
        crate::PeerLifecycle::Disconnecting
    );
    assert!(
        projected_peer
            .peer_flags
            .contains(&crate::PeerFlagView::UploadAllowed)
    );

    hub.record_peer_connections(TORRENT_ID, Duration::from_millis(30), &[])
        .expect("remove row");
    let removed = view_set
        .next_updates(&disconnecting.cursor, 0)
        .await
        .expect("removal patch");
    assert!(matches!(
        removed.updates.as_slice(),
        [ViewSetUpdate::Patch {
            patch: ViewPatch::Peers { upsert, removed, .. },
            ..
        }] if upsert.is_empty() && removed == &["7"]
    ));
}

#[test]
fn sixty_active_peer_snapshot_stays_inside_default_queue_bound() {
    let hub = ViewHub::new(&service_snapshot(0, 0)).expect("hub");
    let peers = (1..=60)
        .map(|value| {
            let connected = value > 30;
            PeerConnectionObservation {
                connection_id: ConnectionId::new(value).expect("connection"),
                record_id: None,
                endpoint: format!("127.0.0.1:{}", 6_000 + value)
                    .parse()
                    .expect("endpoint"),
                local_endpoint: None,
                sources: PeerSources::from_source(PeerSource::Manual),
                direction: PeerConnectionDirection::Outgoing,
                transport: PeerTransport::Tcp,
                lifecycle: if connected {
                    PeerConnectionLifecycle::Connected
                } else {
                    PeerConnectionLifecycle::TransportConnecting
                },
                role: if connected {
                    PeerConnectionRole::Content
                } else {
                    PeerConnectionRole::Metadata
                },
                started_at: Duration::from_secs(1),
                lifecycle_changed_at: Duration::from_secs(2),
                peer_id: connected.then_some([value as u8; 20]),
                supports_extensions: connected.then_some(true),
                supports_ut_metadata: None,
                mse_method: None,
                content: connected.then_some(PeerContentActivity {
                    choking: false,
                    wanted_piece_count: 8,
                    pending_requests: 2,
                    target_requests: 4,
                    queued_payload_bytes: 32 * 1_024,
                    useful_payload_bytes: 16 * 1_024,
                    observed_payload_rate: 8 * 1_024,
                    connected_age: Duration::from_secs(3),
                    last_useful_age: Some(Duration::from_millis(20)),
                    last_payload_age: Some(Duration::from_millis(10)),
                    request_timeout: Duration::from_secs(8),
                    oldest_request_age: Some(Duration::from_millis(50)),
                    request_window_phase: PeerRequestWindowPhase::Steady,
                }),
                upload: None,
                close_reason: None,
            }
        })
        .collect::<Vec<_>>();
    let projection_started = Instant::now();
    hub.record_peer_connections(TORRENT_ID, Duration::from_secs(5), &peers)
        .expect("peer projection");
    let projection_elapsed = projection_started.elapsed();
    let owner = ViewSetOwner::trusted("pressure-owner");
    let snapshot_started = Instant::now();
    let opened = hub
        .open_view_set(
            owner.clone(),
            open_request(vec![ViewSpec::TorrentPeers {
                view_id: "peers".to_owned(),
                torrent_id: TORRENT_ID.to_owned(),
                delivery: ViewDeliveryPolicy::default(),
            }]),
        )
        .expect("peer view set");
    let snapshot_elapsed = snapshot_started.elapsed();
    let encoded_bytes = serde_json::to_vec(&opened.initial)
        .expect("encode snapshot")
        .len();
    let view_set = hub.view_set(&owner, &opened.view_set_id).expect("view set");
    let stats = view_set.stats().expect("view stats");
    assert!(matches!(
        opened.initial.updates.as_slice(),
        [ViewSetUpdate::Snapshot {
            snapshot: ViewSnapshot::Peers { peers, .. },
            ..
        }] if peers.len() == 60
    ));
    assert!(encoded_bytes < DEFAULT_VIEW_SET_QUEUE_BYTES as usize);
    assert!(stats.queue_high_water < DEFAULT_VIEW_SET_QUEUE_BYTES as usize);
    assert_eq!(stats.reset_count, 0);
    eprintln!(
        "peer_view_pressure rows=60 projection_micros={} snapshot_micros={} encoded_bytes={} queue_high_water={} resets={}",
        projection_elapsed.as_micros(),
        snapshot_elapsed.as_micros(),
        encoded_bytes,
        stats.queue_high_water,
        stats.reset_count,
    );
}

#[test]
fn replay_refreshes_server_clock_without_changing_cursor_or_updates() {
    let now = Instant::now();
    let inner = inner(now);
    let initial = inner.open_response().expect("open").initial;
    assert_eq!(initial.server_now_millis, "0");
    let PollState::Ready(replay) = inner
        .poll_state(0, now + Duration::from_secs(5))
        .expect("replay")
    else {
        panic!("initial retained batch must replay");
    };
    assert_eq!(replay.server_now_millis, "5000");
    assert_eq!(replay.cursor, initial.cursor);
    assert_eq!(replay.updates, initial.updates);
    let empty = inner
        .empty_batch(1, now + Duration::from_secs(6))
        .expect("empty");
    assert_eq!(empty.server_now_millis, "6000");
}
