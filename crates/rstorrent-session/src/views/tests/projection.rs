//! Projection mapping and typed-patch behavior.

use super::support::*;
use std::time::Instant;

use rstorrent_protocol::metainfo::{Metainfo, MetainfoFile, MetainfoMode};
use rstorrent_protocol::storage_layout::RequiredPayloadGeometry;

use crate::file_views::FileProgressModel;
use crate::settings::{
    ClientSettings, ClientSettingsApplicationState, Ipv6PinholeStatus, PortMappingStatus,
    SettingsConvergenceModel, SettingsDomain,
};
use crate::{ActivePieceFieldUpdate, TorrentEtaView, TorrentFieldUpdate, TorrentViewChange};

const TORRENT_ID: &str = "t1-000102030405060708090a0b0c0d0e0f";

fn current_torrent(hub: &ViewHub) -> crate::TorrentView {
    hub.inner
        .lock()
        .expect("hub state")
        .torrents
        .get(TORRENT_ID)
        .expect("torrent view")
        .view
        .clone()
}

fn preparation_spec() -> SubscriptionSpec {
    SubscriptionSpec {
        selector: ViewSelector::Torrent {
            torrent_id: TORRENT_ID.to_owned(),
        },
        projection: ViewProjection::Preparation,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: 4 * 1024,
        },
        diagnostics: None,
        catalog_page: None,
    }
}

#[tokio::test]
async fn preparation_projection_is_compact_generation_fenced_and_separate_from_summary() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let generation = hub.reserve_eta_generation(TORRENT_ID).expect("reserve");
    hub.activate_eta_generation(TORRENT_ID, generation, Instant::now())
        .expect("activate");
    let subscription = hub.subscribe(preparation_spec()).expect("subscribe");
    assert!(matches!(
        subscription
            .next_update()
            .await
            .expect("initial preparation")
            .payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::TorrentPreparation {
                preparation: None,
                ..
            }
        }
    ));

    hub.record_metadata_preparation(
        TORRENT_ID,
        Some(generation),
        &MetadataAcquisitionProgress {
            total_size: Some(32_771),
            received_bytes: 16_384,
            block_count: 3,
            packed_block_states: vec![0b0001_0110],
            active_peers: 2,
            requests_in_flight: 1,
            hash_failures: 1,
        },
    )
    .expect("metadata progress");
    let metadata = subscription.next_update().await.expect("metadata patch");
    let ViewUpdatePayload::Patch {
        patch:
            ViewPatch::TorrentPreparation {
                preparation: Some(preparation),
                ..
            },
    } = metadata.payload
    else {
        panic!("expected preparation patch");
    };
    let metadata = preparation.metadata.expect("metadata state");
    assert_eq!(metadata.total_size_bytes.as_deref(), Some("32771"));
    assert_eq!(metadata.received_bytes, "16384");
    assert_eq!(metadata.block_count, 3);
    assert_eq!(metadata.block_states, "Fg==");

    hub.record_integrity_preparation(
        TORRENT_ID,
        Some(generation),
        IntegrityPreparationProgress {
            phase: IntegrityPreparationPhase::WaitingForPeer,
            needed_hash_ranges: 2,
            active_requests: 0,
        },
    )
    .expect("waiting for hashes");
    subscription.next_update().await.expect("integrity patch");
    assert_eq!(
        current_torrent(&hub).progress.reason,
        ProgressReason::PreparingIntegrity
    );
    assert_eq!(
        current_torrent(&hub).progress.disposition,
        ProgressDisposition::Waiting
    );

    hub.finish_metadata_preparation(TORRENT_ID, Some(generation))
        .expect("finish metadata");
    let finished = subscription.next_update().await.expect("metadata cleared");
    let ViewUpdatePayload::Patch {
        patch:
            ViewPatch::TorrentPreparation {
                preparation: Some(preparation),
                ..
            },
    } = finished.payload
    else {
        panic!("expected retained integrity preparation");
    };
    assert!(preparation.metadata.is_none());
    assert!(preparation.integrity.is_some());

    hub.record_integrity_preparation(
        TORRENT_ID,
        Some(generation),
        IntegrityPreparationProgress {
            phase: IntegrityPreparationPhase::Ready,
            needed_hash_ranges: 0,
            active_requests: 0,
        },
    )
    .expect("hashes ready");
    let ready = subscription.next_update().await.expect("ready patch");
    assert!(matches!(
        ready.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::TorrentPreparation {
                preparation: None,
                ..
            }
        }
    ));
    assert_eq!(
        current_torrent(&hub).progress.reason,
        ProgressReason::TransferringPieces
    );

    hub.deactivate_eta_generation(TORRENT_ID, generation)
        .expect("deactivate");
    hub.record_metadata_preparation(
        TORRENT_ID,
        Some(generation),
        &MetadataAcquisitionProgress::default(),
    )
    .expect("ignore stale metadata");
    assert!(
        hub.inner
            .lock()
            .expect("hub")
            .torrents
            .get(TORRENT_ID)
            .expect("torrent")
            .preparation
            .is_none()
    );
}

#[test]
fn completed_seed_projection_survives_content_task_cleanup() {
    for (admission, expected) in [
        (
            crate::SeedAdmissionView::Active,
            crate::TorrentOperationalState::Seeding,
        ),
        (
            crate::SeedAdmissionView::InactiveExempt,
            crate::TorrentOperationalState::Seeding,
        ),
        (
            crate::SeedAdmissionView::Queued,
            crate::TorrentOperationalState::Queued,
        ),
    ] {
        let mut current = snapshot(0, 1);
        let hub = ViewHub::new(&current).expect("hub");
        hub.set_progress_inputs(
            TORRENT_ID,
            ProgressInputs {
                task_active: true,
                ..ProgressInputs::default()
            },
        )
        .expect("content task");
        current.revision = "1".to_owned();
        current.torrents[0].state = TorrentState::Complete;
        current.torrents[0].download_queue_position = None;
        let mut durable = eta_durable(None, 1, 1);
        durable.get_mut(TORRENT_ID).unwrap().seeding.admission = admission;
        hub.replace_durable(&current, &durable)
            .expect("completed admission");
        assert_eq!(current_torrent(&hub).operational_state, expected);
        hub.set_progress_inputs(TORRENT_ID, ProgressInputs::default())
            .expect("old content task cleanup");
        let view = current_torrent(&hub);
        assert_eq!(view.seeding.admission, admission);
        assert_eq!(view.operational_state, expected);
    }
}

#[test]
fn operational_state_and_queue_position_are_authoritative() {
    let mut queued = snapshot(0, 1);
    queued.torrents[0].download_queue_position = Some(3);
    let hub = ViewHub::new(&queued).expect("queued hub");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Queued
    );
    assert_eq!(current_torrent(&hub).download_queue_position, Some(3));

    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            task_active: true,
            ..ProgressInputs::default()
        },
    )
    .expect("activate torrent");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Downloading
    );
    hub.set_stopping(TORRENT_ID, true).expect("stop torrent");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Stopping
    );

    let mut checking = queued.clone();
    checking.revision = "1".to_owned();
    checking.torrents[0].state = TorrentState::Checking;
    hub.set_stopping(TORRENT_ID, false)
        .expect("finish stopping torrent");
    hub.replace_durable(&checking, &BTreeMap::new())
        .expect("checking snapshot");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Checking
    );

    let mut complete = queued.clone();
    complete.revision = "2".to_owned();
    complete.torrents[0].state = TorrentState::Complete;
    complete.torrents[0].download_queue_position = None;
    hub.set_progress_inputs(TORRENT_ID, ProgressInputs::default())
        .expect("clear runtime state");
    hub.replace_durable(&complete, &BTreeMap::new())
        .expect("complete snapshot");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Queued
    );
    let mut durable = eta_durable(None, 1, 1);
    durable.get_mut(TORRENT_ID).unwrap().seeding.admission = crate::SeedAdmissionView::Active;
    hub.replace_durable(&complete, &durable)
        .expect("admit complete seed");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Seeding
    );

    complete.revision = "3".to_owned();
    complete.torrents[0].desired_running = false;
    hub.replace_durable(&complete, &BTreeMap::new())
        .expect("paused complete snapshot");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Paused
    );

    complete.revision = "4".to_owned();
    complete.torrents[0].desired_running = true;
    complete.torrents[0].state = TorrentState::Error;
    hub.replace_durable(&complete, &BTreeMap::new())
        .expect("error snapshot");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Error
    );
}

#[test]
fn metadata_discovery_retry_remains_starting_while_retaining_queue_position() {
    let mut service = snapshot(0, 0);
    service.torrents[0].state = TorrentState::AwaitingMetadata;
    service.torrents[0].metadata_available = false;
    service.torrents[0].download_queue_position = Some(1);
    let hub = ViewHub::new(&service).expect("hub");

    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            task_active: true,
            ..ProgressInputs::default()
        },
    )
    .expect("start metadata task");
    hub.set_discovery_activity(TORRENT_ID, false, true)
        .expect("schedule discovery retry");

    let torrent = current_torrent(&hub);
    assert_eq!(
        torrent.operational_state,
        crate::TorrentOperationalState::Starting
    );
    assert_eq!(torrent.download_queue_position, Some(1));

    service.revision = "1".to_owned();
    service.torrents[0].desired_running = false;
    hub.replace_durable(&service, &BTreeMap::new())
        .expect("pause torrent");
    hub.set_discovery_activity(TORRENT_ID, true, false)
        .expect("receive late discovery activity");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Paused
    );

    service.revision = "2".to_owned();
    service.torrents[0].desired_running = true;
    hub.replace_durable(&service, &BTreeMap::new())
        .expect("resume torrent");
    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            discovery_exhausted: true,
            ..ProgressInputs::default()
        },
    )
    .expect("exhaust discovery");
    assert_eq!(
        current_torrent(&hub).operational_state,
        crate::TorrentOperationalState::Queued
    );
}

#[test]
fn checker_progress_projects_exactly_and_rejects_stale_completion() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    hub.record_checker_progress(
        TORRENT_ID,
        &CheckerProgress {
            generation: 2,
            phase: CheckerPhase::Hashing,
            pieces_total: 4,
            pieces_processed: 2,
            pieces_matched: 1,
            pieces_absent: 1,
            pieces_mismatched: 0,
            bytes_hashed: 16_384,
            active_hash_jobs: 1,
            queued_hash_jobs: 1,
            elapsed_millis: 1_500,
            last_advance_age_millis: 300,
            oldest_active_job_age_millis: Some(700),
        },
    )
    .expect("record checker progress");

    let checking = current_torrent(&hub).checking.expect("checking projection");
    assert_eq!(checking.generation, "2");
    assert_eq!(checking.phase, CheckingPhaseView::Hashing);
    assert_eq!(checking.pieces_processed, 2);
    assert_eq!(checking.pieces_matched, 1);
    assert_eq!(checking.pieces_absent, 1);
    assert_eq!(checking.bytes_hashed, "16384");
    assert_eq!(
        checking.oldest_active_job_age_millis.as_deref(),
        Some("700")
    );

    hub.finish_checker(TORRENT_ID, 1)
        .expect("ignore stale checker completion");
    assert!(current_torrent(&hub).checking.is_some());
    hub.finish_checker(TORRENT_ID, 2)
        .expect("finish current checker");
    assert!(current_torrent(&hub).checking.is_none());
}

fn eta_durable(
    files: Option<FileProgressModel>,
    required_payload_bytes: u64,
    verified_required_payload_bytes: u64,
) -> BTreeMap<String, DurableTorrentViewState> {
    BTreeMap::from([(
        TORRENT_ID.to_owned(),
        DurableTorrentViewState {
            display_name: Some("ETA fixture".to_owned()),
            source_display_name: None,
            checking_generation: None,
            verified: Vec::new(),
            files,
            eta_geometry: Some(RequiredPayloadGeometry {
                required_payload_bytes,
                verified_required_payload_bytes,
            }),
            trackers: TrackerViewModel::default(),
            total_size: 0,
            lifetime: Default::default(),
            seeding: Default::default(),
        },
    )])
}

fn one_piece_boundary_fixture() -> Metainfo {
    Metainfo {
        info_hash: [1; 20],
        piece_hashes: vec![[2; 20]],
        piece_length: 16,
        total_length: 16,
        name: "boundary".to_owned(),
        private: false,
        mode: MetainfoMode::MultiFile,
        files: vec![
            MetainfoFile {
                path: vec!["first.bin".to_owned()],
                length: 8,
                offset: 0,
                padding: false,
            },
            MetainfoFile {
                path: vec!["second.bin".to_owned()],
                length: 8,
                offset: 8,
                padding: false,
            },
        ],
    }
}

fn media_projection_fixture() -> Metainfo {
    Metainfo {
        info_hash: [3; 20],
        piece_hashes: vec![[4; 20]],
        piece_length: 16,
        total_length: 16,
        name: "Show Name".to_owned(),
        private: false,
        mode: MetainfoMode::MultiFile,
        files: vec![
            MetainfoFile {
                path: vec!["Show.Name.S01E02.mkv".to_owned()],
                length: 8,
                offset: 0,
                padding: false,
            },
            MetainfoFile {
                path: vec!["notes.txt".to_owned()],
                length: 8,
                offset: 8,
                padding: false,
            },
        ],
    }
}

#[tokio::test]
async fn media_projection_filters_rows_and_patches_verified_availability() {
    let files = FileProgressModel::new_with_media(
        &media_projection_fixture(),
        &[],
        &[],
        None,
        crate::MediaFileAvailability::Available,
    )
    .expect("media files");
    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    hub.replace_durable(&snapshot(1, 1), &eta_durable(Some(files), 16, 0))
        .expect("install files");
    assert_eq!(
        current_torrent(&hub).total_size_bytes.as_deref(),
        Some("16")
    );
    let subscription = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: TORRENT_ID.to_owned(),
            },
            projection: ViewProjection::Media,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 64 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("media subscription");
    let initial = subscription.next_update().await.expect("media snapshot");
    assert!(matches!(
        initial.payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Media {
                total_non_padding_files: 2,
                ref items,
                ..
            }
        } if items.len() == 1
            && items[0].file_index == 0
            && items[0].verified_bytes == "0"
    ));

    hub.record_pieces_durable(TORRENT_ID, &[0], 2)
        .expect("verify media piece");
    let update = subscription.next_update().await.expect("media patch");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Media { ref upsert, ref removed, .. }
        } if removed.is_empty()
            && upsert.len() == 1
            && upsert[0].verified_bytes == "8"
            && upsert[0].media_availability == crate::MediaFileAvailability::Available
    ));
}

#[test]
fn torrent_eta_projects_exact_work_and_generation_accounting() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    hub.replace_durable(&snapshot(1, 4), &eta_durable(None, 16_384, 4_096))
        .expect("install geometry");
    let durable = current_torrent(&hub);
    assert_eq!(durable.required_payload_bytes.as_deref(), Some("16384"));
    assert_eq!(durable.remaining_payload_bytes.as_deref(), Some("12288"));
    assert_eq!(durable.eta_payload_download_rate_bytes, "0");
    assert_eq!(durable.eta, TorrentEtaView::Unavailable);

    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            task_active: true,
            ..ProgressInputs::default()
        },
    )
    .expect("mark task active");
    let now = Instant::now();
    let generation = hub
        .reserve_eta_generation(TORRENT_ID)
        .expect("reserve generation");
    hub.activate_eta_generation(TORRENT_ID, generation, now)
        .expect("activate generation");
    assert_eq!(current_torrent(&hub).eta, TorrentEtaView::WarmingUp);

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_millis(500),
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 0,
            length: 4_096,
        },
    )
    .expect("receive block");
    assert_eq!(
        current_torrent(&hub).remaining_payload_bytes.as_deref(),
        Some("8192")
    );

    hub.record_eta_tick(now + Duration::from_secs(1))
        .expect("rate tick");
    let estimated = current_torrent(&hub);
    assert_eq!(estimated.eta_payload_download_rate_bytes, "4096");
    assert_eq!(
        estimated.eta,
        TorrentEtaView::Estimate {
            seconds: "2".to_owned()
        }
    );

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_millis(1_100),
        TorrentActivity::PieceHashFailed {
            piece_index: 0,
            failed_bytes: 4_096,
        },
    )
    .expect("restore failed work");
    assert_eq!(
        current_torrent(&hub).remaining_payload_bytes.as_deref(),
        Some("12288")
    );

    hub.deactivate_eta_generation(TORRENT_ID, generation)
        .expect("deactivate generation");
    let inactive = current_torrent(&hub);
    assert_eq!(inactive.remaining_payload_bytes.as_deref(), Some("12288"));
    assert_eq!(inactive.eta_payload_download_rate_bytes, "0");
    assert_eq!(inactive.eta, TorrentEtaView::Unavailable);
}

#[test]
fn controlled_eta_activity_runs_warm_stall_recovery_failure_and_completion() {
    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    hub.replace_durable(&snapshot(1, 1), &eta_durable(None, 10_000, 0))
        .expect("install geometry");
    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            task_active: true,
            ..ProgressInputs::default()
        },
    )
    .expect("mark task active");

    let now = Instant::now();
    let generation = hub
        .reserve_eta_generation(TORRENT_ID)
        .expect("reserve generation");
    hub.activate_eta_generation(TORRENT_ID, generation, now)
        .expect("activate generation");
    assert_eq!(current_torrent(&hub).eta, TorrentEtaView::WarmingUp);

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_millis(500),
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 0,
            length: 1_000,
        },
    )
    .expect("paced first block");
    hub.record_eta_tick(now + Duration::from_secs(1))
        .expect("first rate tick");
    assert_eq!(
        current_torrent(&hub).eta,
        TorrentEtaView::Estimate {
            seconds: "9".to_owned(),
        }
    );

    hub.record_eta_tick(now + Duration::from_millis(10_500))
        .expect("stall tick");
    let stalled = current_torrent(&hub);
    assert_eq!(stalled.eta_payload_download_rate_bytes, "0");
    assert_eq!(stalled.eta, TorrentEtaView::Stalled);

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_secs(11),
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 1_000,
            length: 1_000,
        },
    )
    .expect("recovery block");
    hub.record_eta_tick(now + Duration::from_millis(11_500))
        .expect("recovery tick");
    assert!(matches!(
        current_torrent(&hub).eta,
        TorrentEtaView::Estimate { .. }
    ));

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_millis(11_600),
        TorrentActivity::PieceHashFailed {
            piece_index: 0,
            failed_bytes: 2_000,
        },
    )
    .expect("restore failed payload");
    assert_eq!(
        current_torrent(&hub).remaining_payload_bytes.as_deref(),
        Some("10000")
    );

    hub.record_generation_activity(
        TORRENT_ID,
        Some(generation),
        now + Duration::from_secs(12),
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 0,
            length: 10_000,
        },
    )
    .expect("clean retry completes network work");
    let complete = current_torrent(&hub);
    assert_eq!(complete.remaining_payload_bytes.as_deref(), Some("0"));
    assert_eq!(complete.eta_payload_download_rate_bytes, "0");
    assert_eq!(complete.eta, TorrentEtaView::Unavailable);
}

#[test]
fn same_size_selection_replacement_fences_late_eta_activity() {
    let metainfo = one_piece_boundary_fixture();
    let wanted = FileProgressModel::new(&metainfo, &[], &[], None).expect("wanted files");
    let skipped_boundary =
        FileProgressModel::new(&metainfo, &[0], &[], None).expect("skipped boundary file");
    assert!(!wanted.eta_selection_matches(&skipped_boundary));
    assert_eq!(
        wanted.required_payload_geometry(&[false]),
        skipped_boundary.required_payload_geometry(&[false])
    );

    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    hub.replace_durable(&snapshot(1, 1), &eta_durable(Some(wanted), 16, 0))
        .expect("install first selection");
    hub.set_progress_inputs(
        TORRENT_ID,
        ProgressInputs {
            task_active: true,
            ..ProgressInputs::default()
        },
    )
    .expect("mark task active");
    let now = Instant::now();
    let old_generation = hub
        .reserve_eta_generation(TORRENT_ID)
        .expect("reserve old generation");
    hub.activate_eta_generation(TORRENT_ID, old_generation, now)
        .expect("activate old generation");
    hub.record_generation_activity(
        TORRENT_ID,
        Some(old_generation),
        now,
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 0,
            length: 4,
        },
    )
    .expect("old selection block");
    assert_eq!(
        current_torrent(&hub).remaining_payload_bytes.as_deref(),
        Some("12")
    );

    hub.replace_durable(&snapshot(2, 1), &eta_durable(Some(skipped_boundary), 16, 0))
        .expect("replace selection");
    let replaced = current_torrent(&hub);
    assert_eq!(replaced.remaining_payload_bytes.as_deref(), Some("16"));
    assert_eq!(replaced.eta, TorrentEtaView::Unavailable);

    hub.record_generation_activity(
        TORRENT_ID,
        Some(old_generation),
        now + Duration::from_secs(1),
        TorrentActivity::BlockReceived {
            piece_index: 0,
            begin: 4,
            length: 4,
        },
    )
    .expect("ignore late old-generation ETA activity");
    assert_eq!(
        current_torrent(&hub).remaining_payload_bytes.as_deref(),
        Some("16")
    );
    let new_generation = hub
        .reserve_eta_generation(TORRENT_ID)
        .expect("reserve replacement generation");
    assert!(new_generation > old_generation);
}

#[tokio::test]
async fn dht_view_replaces_and_coalesces_one_complete_observation() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub.subscribe(dht_spec()).expect("DHT subscription");
    let initial = subscription
        .next_update()
        .await
        .expect("initial DHT snapshot");
    let ViewUpdatePayload::Snapshot {
        snapshot: ViewSnapshot::SessionDht { inspection },
    } = initial.payload
    else {
        panic!("expected DHT snapshot");
    };
    assert_eq!(inspection.families.len(), 2);
    assert!(
        inspection
            .families
            .iter()
            .all(|family| family.buckets.len() == 160)
    );

    let mut first = DhtInspectionView::inactive();
    first.captured_millis = "1".to_owned();
    first.queries_sent = "10".to_owned();
    hub.publish_dht(first).expect("first observation");
    let mut latest = DhtInspectionView::inactive();
    latest.captured_millis = "2".to_owned();
    latest.queries_sent = "11".to_owned();
    hub.publish_dht(latest).expect("latest observation");

    let update = subscription
        .next_update()
        .await
        .expect("coalesced DHT patch");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::SessionDht { inspection },
    } = update.payload
    else {
        panic!("expected DHT replacement patch");
    };
    assert_eq!(inspection.captured_millis, "2");
    assert_eq!(inspection.queries_sent, "11");
    assert_eq!(inspection.families.len(), 2);
    assert!(
        inspection
            .families
            .iter()
            .all(|family| family.buckets.len() == 160)
    );
}

#[test]
fn speed_clock_uses_the_fastest_current_or_history_interest() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    assert_eq!(hub.speed_tick_interval(), None);
    let current = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::SessionCurrentRates {
                metrics: vec![SpeedMetric::PayloadReceived],
            },
            projection: ViewProjection::CurrentRates,
            delivery: DeliveryPolicy {
                min_interval_millis: 750,
                max_queue_bytes: 64 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("current-rate subscription");
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(750)));
    let historical = hub
        .subscribe(speed_spec(SpeedRange::Hours24))
        .expect("historical subscription");
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(750)));
    let short = hub
        .subscribe(speed_spec(SpeedRange::Minutes2))
        .expect("short subscription");
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(500)));
    let recent = hub
        .subscribe(speed_spec(SpeedRange::Seconds30))
        .expect("recent subscription");
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(100)));
    drop(recent);
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(500)));
    drop(short);
    drop(historical);
    assert_eq!(hub.speed_tick_interval(), Some(Duration::from_millis(750)));
    drop(current);
    assert_eq!(hub.speed_tick_interval(), None);
}

#[tokio::test]
async fn session_disk_view_publishes_pipeline_rates_and_keyed_piece_changes() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::TorrentList,
            projection: ViewProjection::Disk,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 64 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("disk subscription");
    let initial = subscription.next_update().await.expect("initial disk");
    assert!(matches!(
        initial.payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::SessionDisk { ref pieces, ref pipeline }
        } if pieces.is_empty()
            && pipeline.pressure == DiskPressureView::Idle
            && pipeline.checkpoint_stage == DiskCheckpointStageView::Idle
    ));

    hub.record_disk_runtime(torrent_id, &disk_snapshot(1_000, 4_096))
        .expect("first disk sample");
    let first = subscription.next_update().await.expect("first disk patch");
    assert!(matches!(
        first.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::SessionDisk { ref pipeline, ref upsert, ref removed }
        } if pipeline.intake_backpressured
            && pipeline.checkpoint_stage == DiskCheckpointStageView::Syncing
            && pipeline.checkpoint_dirty_pieces == "3"
            && pipeline.checkpoint_dirty_bytes == (3 * 16 * 1024).to_string()
            && pipeline.checkpoint_sync_service_micros == "600"
            && pipeline.checkpoint_active_micros.as_deref() == Some("200")
            && pipeline.receive_rate_bytes == "0"
            && upsert.len() == 1
            && removed.is_empty()
    ));

    let mut next = disk_snapshot(2_000, 8_192);
    next.pressure = DiskPressure::Draining;
    next.intake_backpressured = false;
    next.checkpoint_stage = DiskCheckpointStage::Idle;
    next.checkpoint_dirty_pieces = 0;
    next.checkpoint_dirty_bytes = 0;
    next.checkpoint_batches_completed = 2;
    next.checkpoint_active_micros = None;
    next.pieces.clear();
    hub.record_disk_runtime(torrent_id, &next)
        .expect("second disk sample");
    let second = subscription.next_update().await.expect("second disk patch");
    assert!(matches!(
        second.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::SessionDisk { ref pipeline, ref upsert, ref removed }
        } if pipeline.pressure == DiskPressureView::Draining
            && pipeline.checkpoint_stage == DiskCheckpointStageView::Idle
            && pipeline.checkpoint_dirty_pieces == "0"
            && pipeline.checkpoint_batches_completed == "2"
            && pipeline.checkpoint_active_micros.is_none()
            && pipeline.receive_rate_bytes == "4096"
            && upsert.is_empty()
            && removed == &[format!("{torrent_id}:3:1")]
    ));

    hub.clear_disk_runtime(torrent_id)
        .expect("clear terminal disk runtime");
    let terminal = subscription
        .next_update()
        .await
        .expect("terminal disk patch");
    assert!(matches!(
        terminal.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::SessionDisk { ref pipeline, ref upsert, ref removed }
        } if pipeline.pressure == DiskPressureView::Idle
            && upsert.is_empty()
            && removed.is_empty()
    ));
}

#[tokio::test]
async fn tracker_state_publishes_complete_keyed_rows_and_terminal_inactive_state() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.to_owned(),
            },
            projection: ViewProjection::Trackers,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 16 * 1024,
            },
            diagnostics: None,
            catalog_page: Some(crate::CatalogPageRequest::default()),
        })
        .expect("tracker subscription");
    let summary = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.to_owned(),
            },
            projection: ViewProjection::Summary,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 16 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("summary subscription");
    let initial = subscription.next_update().await.expect("initial snapshot");
    summary.next_update().await.expect("initial summary");
    assert!(matches!(
        initial.payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Trackers { trackers, .. }
        } if trackers.is_empty()
    ));

    hub.record_tracker_state(
        torrent_id,
        &tracker_snapshot(TrackerRuntimeStatus::ReannounceWait, 1),
    )
    .expect("tracker success state");
    let update = subscription.next_update().await.expect("success patch");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Trackers { ref upsert, ref removed, .. }
        } if upsert.len() == 1
            && removed.is_empty()
            && upsert[0].last_peer_count == Some(9)
    ));
    let summary_update = summary.next_update().await.expect("summary count patch");
    assert!(matches!(
        summary_update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Torrent {
                change: TorrentViewChange::Update { ref update }
            }
        } if update.fields.iter().any(|field| matches!(
            field,
            TorrentFieldUpdate::ConfiguredTrackerCount { value: Some(1) }
        ))
    ));

    hub.record_tracker_state(
        torrent_id,
        &tracker_snapshot(TrackerRuntimeStatus::Inactive, 2),
    )
    .expect("tracker terminal state");
    let terminal = subscription.next_update().await.expect("terminal patch");
    assert!(matches!(
        terminal.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Trackers { ref upsert, .. }
        } if upsert.len() == 1
            && matches!(
                upsert[0].status,
                crate::tracker_views::TrackerStatusView::Inactive
            )
    ));
}

#[tokio::test]
async fn swarm_projection_keeps_registry_rows_after_connections_and_clears_terminally() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.to_owned(),
            },
            projection: ViewProjection::Swarm,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 64 * 1024,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("swarm subscription");
    let initial = subscription.next_update().await.expect("initial snapshot");
    assert!(matches!(
        initial.payload,
        ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Swarm {
                state: SwarmCatalogState::Inactive,
                ref peers,
                ..
            }
        } if peers.is_empty()
    ));

    let mut registry = PeerRegistry::new(PeerRegistryConfig {
        max_records: 1,
        ..PeerRegistryConfig::default()
    })
    .expect("registry");
    let endpoint = PeerEndpoint::new("127.0.0.1:6881".parse().expect("address")).expect("endpoint");
    registry
        .observe(
            PeerObservation::dialable(endpoint, PeerSource::Tracker),
            Duration::from_secs(1),
        )
        .expect("tracker candidate");
    registry
        .observe(
            PeerObservation::dialable(endpoint, PeerSource::Dht),
            Duration::from_secs(2),
        )
        .expect("merged source");
    let active = registry.snapshot(PeerSelectionContext {
        now: Duration::from_secs(3),
    });
    hub.record_peer_registry_state(torrent_id, true, &active)
        .expect("active registry");
    let update = subscription.next_update().await.expect("active patch");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Swarm {
                state: SwarmCatalogState::Active,
                ref counts,
                ref upsert,
                ref removed,
                ..
            }
        } if counts.total == 1
            && counts.eligible == 1
            && upsert.len() == 1
            && upsert[0].sources.len() == 2
            && removed.is_empty()
    ));

    let replacement_endpoint =
        PeerEndpoint::new("127.0.0.1:6882".parse().expect("address")).expect("endpoint");
    registry
        .observe(
            PeerObservation::dialable(replacement_endpoint, PeerSource::Tracker),
            Duration::from_secs(4),
        )
        .expect("capacity replacement");
    let replacement = registry.snapshot(PeerSelectionContext {
        now: Duration::from_secs(5),
    });
    hub.record_peer_registry_state(torrent_id, true, &replacement)
        .expect("replacement registry");
    let update = subscription.next_update().await.expect("replacement patch");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Swarm {
                ref counts,
                ref upsert,
                ref removed,
                ..
            }
        } if counts.total == 1
            && upsert.len() == 1
            && upsert[0].peer_record_id == "2"
            && removed == &["1".to_owned()]
    ));

    hub.record_peer_connections(torrent_id, Duration::from_secs(6), &[])
        .expect("empty connection projection");
    let current = hub
        .inner
        .lock()
        .expect("hub state")
        .snapshot_for(&SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.to_owned(),
            },
            projection: ViewProjection::Swarm,
            delivery: DeliveryPolicy::default(),
            diagnostics: None,
            catalog_page: None,
        });
    assert!(matches!(
        current,
        ViewSnapshot::Swarm { ref peers, .. } if peers.len() == 1
    ));

    let terminal = PeerRegistry::new(PeerRegistryConfig::default())
        .expect("terminal registry")
        .snapshot(PeerSelectionContext {
            now: Duration::from_secs(7),
        });
    hub.record_peer_registry_state(torrent_id, false, &terminal)
        .expect("terminal registry state");
    let update = subscription.next_update().await.expect("terminal patch");
    assert!(matches!(
        update.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::Swarm {
                state: SwarmCatalogState::Inactive,
                ref counts,
                ref upsert,
                ref removed,
                ..
            }
        } if counts.total == 0
            && upsert.is_empty()
            && removed == &["2".to_owned()]
    ));
}

#[tokio::test]
async fn piece_hash_failure_clears_unverified_active_ranges() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    let subscription = hub.subscribe(piece_spec(4096)).expect("subscribe");
    subscription.next_update().await.expect("snapshot");
    hub.record_activity(
        torrent_id,
        TorrentActivity::PieceStarted {
            piece_index: 0,
            piece_length: 16 * 1024,
            attempt: 1,
        },
    )
    .expect("start piece");
    let start = subscription.next_update().await.expect("start patch");
    let mut active = match start.payload {
        ViewUpdatePayload::Patch {
            patch: ViewPatch::PieceActivity { active_upsert, .. },
        } => active_upsert.into_iter().next().expect("started piece"),
        _ => panic!("expected active-piece start patch"),
    };
    hub.record_activity(
        torrent_id,
        TorrentActivity::BlockStored {
            piece_index: 0,
            begin: 0,
            length: 16 * 1024,
        },
    )
    .expect("stored block");
    let stored = subscription.next_update().await.expect("stored patch");
    match stored.payload {
        ViewUpdatePayload::Patch {
            patch: ViewPatch::PieceActivity { active_updates, .. },
        } => active_updates[0]
            .apply(&mut active)
            .expect("stored piece update"),
        _ => panic!("expected active-piece stored patch"),
    }
    hub.record_activity(
        torrent_id,
        TorrentActivity::PieceHashFailed {
            piece_index: 0,
            failed_bytes: 32,
        },
    )
    .expect("failed piece");
    let update = subscription.next_update().await.expect("reset patch");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::PieceActivity {
            ref active_updates, ..
        },
    } = update.payload
    else {
        panic!("expected active-piece reset patch");
    };
    assert_eq!(active_updates.len(), 1);
    assert!(active_updates[0].fields.iter().any(|field| matches!(
        field,
        ActivePieceFieldUpdate::Stage {
            value: ActivePieceStageView::Failed
        }
    )));
    active_updates[0]
        .apply(&mut active)
        .expect("failed piece update");
    assert!(active.requested.is_empty());
    assert!(active.received.is_empty());
    assert!(active.stored.is_empty());
    assert_eq!(active.stage, ActivePieceStageView::Failed);
}

#[tokio::test]
async fn piece_runtime_tracks_simultaneous_attempts_and_keyed_retry_cleanup() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub.subscribe(piece_spec(16 * 1024)).expect("subscribe");
    subscription.next_update().await.expect("snapshot");
    let piece = |piece_index, attempt, stage| DiskPieceRuntimeSnapshot {
        piece_index,
        piece_length: 16 * 1024,
        attempt,
        stage,
        requested_bytes: 16 * 1024,
        received_bytes: 0,
        stored_bytes: 0,
        age_millis: 50,
        stage_age_millis: 10,
        error: (stage == DiskPieceStage::Failed).then(|| "piece hash failed; retrying".to_owned()),
    };
    hub.record_piece_runtime(
        torrent_id,
        &[
            piece(0, 1, DiskPieceStage::Receiving),
            piece(2, 1, DiskPieceStage::Hashing),
        ],
    )
    .expect("simultaneous runtime");
    let first = subscription.next_update().await.expect("active patch");
    assert!(matches!(
        first.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::PieceActivity { ref active_upsert, ref active_removed, .. }
        } if active_upsert.len() == 2 && active_removed.is_empty()
    ));

    hub.record_piece_runtime(torrent_id, &[piece(0, 1, DiskPieceStage::Failed)])
        .expect("failed attempt");
    subscription.next_update().await.expect("failed patch");
    hub.record_piece_runtime(torrent_id, &[piece(0, 2, DiskPieceStage::Receiving)])
        .expect("retry attempt");
    let retry = subscription.next_update().await.expect("retry patch");
    assert!(matches!(
        retry.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::PieceActivity { ref active_upsert, ref active_removed, .. }
        } if active_upsert.len() == 1
            && active_upsert[0].piece_id == "0:2"
            && active_removed == &["0:1".to_owned()]
    ));

    hub.clear_piece_runtime(torrent_id)
        .expect("terminal cleanup");
    let terminal = subscription.next_update().await.expect("terminal patch");
    assert!(matches!(
        terminal.payload,
        ViewUpdatePayload::Patch {
            patch: ViewPatch::PieceActivity { ref active_upsert, ref active_removed, .. }
        } if active_upsert.is_empty() && active_removed == &["0:2".to_owned()]
    ));
}

#[test]
fn durable_replacement_preserves_exact_have_ranges() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    hub.replace_durable(
        &snapshot(1, 4),
        &BTreeMap::from([(
            "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
            DurableTorrentViewState {
                display_name: Some("Verified fixture".to_owned()),
                source_display_name: None,
                checking_generation: None,
                verified: vec![IndexRange {
                    start: 1,
                    end_exclusive: 3,
                }],
                files: None,
                eta_geometry: None,
                trackers: TrackerViewModel::default(),
                total_size: 0,
                lifetime: Default::default(),
                seeding: Default::default(),
            },
        )]),
    )
    .expect("replace");
}

#[tokio::test]
async fn source_name_is_provisional_until_verified_metadata_patches_both_summaries() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let list = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::TorrentList,
            projection: ViewProjection::Summary,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 8192,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("list subscription");
    let summary = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::Torrent {
                torrent_id: torrent_id.to_owned(),
            },
            projection: ViewProjection::Summary,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 8192,
            },
            diagnostics: None,
            catalog_page: None,
        })
        .expect("summary subscription");
    list.next_update().await.expect("list snapshot");
    summary.next_update().await.expect("summary snapshot");

    hub.replace_durable(
        &snapshot(1, 4),
        &BTreeMap::from([(
            torrent_id.to_owned(),
            DurableTorrentViewState {
                display_name: None,
                source_display_name: Some("Magnet fixture".to_owned()),
                checking_generation: None,
                verified: Vec::new(),
                files: None,
                eta_geometry: None,
                trackers: TrackerViewModel::default(),
                total_size: 0,
                lifetime: Default::default(),
                seeding: Default::default(),
            },
        )]),
    )
    .expect("replace");

    let list_update = list.next_update().await.expect("list patch");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::TorrentList { updates, .. },
    } = list_update.payload
    else {
        panic!("expected torrent-list patch");
    };
    assert!(updates[0].fields.iter().any(|field| matches!(
        field,
        TorrentFieldUpdate::SourceDisplayName { value: Some(value) }
            if value == "Magnet fixture"
    )));

    let summary_update = summary.next_update().await.expect("summary patch");
    let ViewUpdatePayload::Patch {
        patch:
            ViewPatch::Torrent {
                change: TorrentViewChange::Update { update },
            },
    } = summary_update.payload
    else {
        panic!("expected selected-summary patch");
    };
    assert!(update.fields.iter().any(|field| matches!(
        field,
        TorrentFieldUpdate::SourceDisplayName { value: Some(value) }
            if value == "Magnet fixture"
    )));

    hub.replace_durable(
        &snapshot(2, 4),
        &BTreeMap::from([(
            torrent_id.to_owned(),
            DurableTorrentViewState {
                display_name: Some("Verified fixture".to_owned()),
                source_display_name: Some("Magnet fixture".to_owned()),
                checking_generation: None,
                verified: Vec::new(),
                files: None,
                eta_geometry: None,
                trackers: TrackerViewModel::default(),
                total_size: 0,
                lifetime: Default::default(),
                seeding: Default::default(),
            },
        )]),
    )
    .expect("replace with verified name");

    let list_update = list.next_update().await.expect("verified list patch");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::TorrentList { updates, .. },
    } = list_update.payload
    else {
        panic!("expected verified torrent-list patch");
    };
    assert!(updates[0].fields.iter().any(|field| matches!(
        field,
        TorrentFieldUpdate::DisplayName { value: Some(value) }
            if value == "Verified fixture"
    )));

    let summary_update = summary.next_update().await.expect("verified summary patch");
    let ViewUpdatePayload::Patch {
        patch:
            ViewPatch::Torrent {
                change: TorrentViewChange::Update { update },
            },
    } = summary_update.payload
    else {
        panic!("expected verified selected-summary patch");
    };
    assert!(update.fields.iter().any(|field| matches!(
        field,
        TorrentFieldUpdate::DisplayName { value: Some(value) }
            if value == "Verified fixture"
    )));
}

#[test]
fn discovery_exhaustion_waits_when_another_mechanism_can_act() {
    let mut torrent = snapshot(0, 0).torrents.remove(0);
    torrent.state = TorrentState::AwaitingMetadata;
    torrent.metadata_available = false;
    let blocked = assess_progress(
        &torrent,
        ProgressInputs {
            discovery_exhausted: true,
            ..ProgressInputs::default()
        },
    );
    assert_eq!(blocked.disposition, ProgressDisposition::Blocked);
    assert_eq!(blocked.reason, ProgressReason::NoEnabledDiscoverySource);

    let waiting = assess_progress(
        &torrent,
        ProgressInputs {
            discovery_exhausted: true,
            dht_enabled: true,
            ..ProgressInputs::default()
        },
    );
    assert_eq!(waiting.disposition, ProgressDisposition::Waiting);
    assert_eq!(waiting.reason, ProgressReason::WaitingForDiscovery);
}

#[test]
fn disabled_network_is_blocked_without_changing_torrent_intent() {
    let mut torrent = snapshot(0, 0).torrents.remove(0);
    torrent.state = TorrentState::AwaitingMetadata;
    torrent.metadata_available = false;
    let assessment = assess_progress(
        &torrent,
        ProgressInputs {
            network_disabled: true,
            discovery_exhausted: true,
            ..ProgressInputs::default()
        },
    );

    assert_eq!(assessment.disposition, ProgressDisposition::Blocked);
    assert_eq!(assessment.reason, ProgressReason::NetworkDisabled);
    assert_eq!(assessment.actions, vec![ProgressAction::EnableNetwork]);
}

#[test]
fn live_network_prerequisite_waits_without_offering_a_policy_action() {
    let mut torrent = snapshot(0, 0).torrents.remove(0);
    torrent.state = TorrentState::AwaitingMetadata;
    torrent.metadata_available = false;
    let assessment = assess_progress(
        &torrent,
        ProgressInputs {
            waiting_for_unmetered_network: true,
            discovery_exhausted: true,
            ..ProgressInputs::default()
        },
    );

    assert_eq!(assessment.disposition, ProgressDisposition::Waiting);
    assert_eq!(
        assessment.reason,
        ProgressReason::WaitingForUnmeteredNetwork
    );
    assert!(assessment.actions.is_empty());

    let fixed_policy = assess_progress(
        &torrent,
        ProgressInputs {
            network_disabled: true,
            waiting_for_unmetered_network: true,
            ..ProgressInputs::default()
        },
    );
    assert_eq!(fixed_policy.reason, ProgressReason::NetworkDisabled);
    assert_eq!(fixed_policy.actions, vec![ProgressAction::EnableNetwork]);
}

#[test]
fn stale_settings_attempts_cannot_publish_runtime_or_mapping_facts() {
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let mut convergence = SettingsConvergenceModel::default();
    let first = convergence
        .begin(ClientSettings::default())
        .expect("first attempt");
    hub.set_client_settings_mapping_generation(first.domain(SettingsDomain::PortMapping))
        .expect("install first generation");
    let second = convergence
        .begin(ClientSettings::default())
        .expect("second attempt");
    hub.begin_client_settings_attempt(
        second.domain(SettingsDomain::PortMapping),
        ClientSettings::default(),
    )
    .expect("install second generation");

    assert!(
        !hub.set_port_mapping_status_for(
            first.domain(SettingsDomain::PortMapping),
            PortMappingStatus::Mapping,
        )
        .expect("reject stale mapping status")
    );
    assert!(
        hub.set_port_mapping_status_for(
            second.domain(SettingsDomain::PortMapping),
            PortMappingStatus::Mapping,
        )
        .expect("accept current mapping status")
    );
    assert!(
        !hub.set_ipv6_pinhole_status_for(
            first.domain(SettingsDomain::PortMapping),
            Ipv6PinholeStatus::ServiceUnavailable,
        )
        .expect("reject stale pinhole status")
    );
    assert!(
        hub.set_ipv6_pinhole_status_for(
            second.domain(SettingsDomain::PortMapping),
            Ipv6PinholeStatus::ServiceUnavailable,
        )
        .expect("accept current pinhole status")
    );
    let runtime = hub.client_settings_for_testing();
    assert_eq!(
        runtime.port_mapping_application,
        ClientSettingsApplicationState::Applying,
        "optional IPv6 service absence must not degrade IPv4 policy convergence",
    );
    let stale_transport = first.domain(SettingsDomain::Transport);
    assert!(
        !hub.update_client_settings_runtime_for(stale_transport, |runtime| {
            runtime.effective_upload_slots = 50;
        })
        .expect("ignore stale runtime patch")
    );
}

#[test]
fn reopened_tracker_snapshot_uses_stable_deadlines_and_current_application_clock() {
    use crate::{OpenViewSetRequest, ViewDeliveryPolicy, ViewSetOwner, ViewSetUpdate, ViewSpec};
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let origin = hub.inner.lock().expect("hub state").clock_origin;
    let snapshot = tracker_snapshot(TrackerRuntimeStatus::ReannounceWait, 1);
    hub.record_tracker_state_at(TORRENT_ID, &snapshot, origin + Duration::from_secs(2))
        .expect("state");
    let spec = ViewSpec::TorrentTrackers {
        view_id: "trackers".to_owned(),
        torrent_id: TORRENT_ID.to_owned(),
        page: Some(crate::CatalogPageRequest::default()),
        delivery: ViewDeliveryPolicy::default(),
    };
    let open = |seconds| {
        hub.open_view_set_at(
            ViewSetOwner::trusted("timing"),
            OpenViewSetRequest {
                views: vec![spec.clone()],
                options: Default::default(),
            },
            origin + Duration::from_secs(seconds),
        )
        .expect("open")
    };
    let first = open(3).initial;
    let reopened = open(8).initial;
    assert_eq!(first.server_now_millis, "3000");
    assert_eq!(reopened.server_now_millis, "8000");
    let ViewSetUpdate::Snapshot {
        snapshot:
            ViewSnapshot::Trackers {
                trackers: first_rows,
                ..
            },
        ..
    } = &first.updates[0]
    else {
        panic!("tracker snapshot")
    };
    let ViewSetUpdate::Snapshot {
        snapshot:
            ViewSnapshot::Trackers {
                trackers: reopened_rows,
                ..
            },
        ..
    } = &reopened.updates[0]
    else {
        panic!("tracker snapshot")
    };
    assert_eq!(first_rows, reopened_rows);
    assert_eq!(
        reopened_rows[0].next_action_at_millis.as_deref(),
        Some("17000")
    );
    assert_eq!(
        reopened_rows[0].last_success_at_millis.as_deref(),
        Some("1000")
    );
}
