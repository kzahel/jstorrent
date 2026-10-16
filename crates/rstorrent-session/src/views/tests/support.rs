pub(super) use std::collections::BTreeMap;
pub(super) use std::time::Duration;

pub(super) use rstorrent_engine::peer::{
    PeerEndpoint, PeerObservation, PeerRegistry, PeerRegistryConfig, PeerSelectionContext,
    PeerSource,
};
pub(super) use rstorrent_engine::{
    CheckerPhase, CheckerProgress, DiskCheckpointStage, DiskPieceRuntimeSnapshot, DiskPieceStage,
    DiskPressure, DiskRuntimeSnapshot, IntegrityPreparationPhase, IntegrityPreparationProgress,
    MetadataAcquisitionProgress, TrackerNextAction, TrackerRuntimeRecordSnapshot,
    TrackerRuntimeSnapshot, TrackerRuntimeStatus, TrackerSource, TrackerTransport,
};

pub(super) use super::super::{
    ActivePieceStageView, CheckingPhaseView, DeliveryPolicy, DhtInspectionView,
    DiskCheckpointStageView, DiskPressureView, DurableTorrentViewState, IndexRange, ProgressAction,
    ProgressDisposition, ProgressInputs, ProgressReason, ResetReason, SubscriptionSpec,
    SwarmCatalogState, TorrentActivity, ViewHub, ViewPatch, ViewProjection, ViewSelector,
    ViewSnapshot, ViewUpdatePayload, assess_progress, coalesce_patch, ranges_from_pieces,
};
pub(super) use crate::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticProfile, DiagnosticRetention, DiagnosticValue,
    MAX_DIAGNOSTIC_EVENTS, MAX_DIAGNOSTIC_PATCH_EVENTS, category,
};
pub(super) use crate::tracker_views::TrackerViewModel;
pub(super) use crate::{
    DiagnosticFilter, DiagnosticSeverity, ServiceSnapshot, SpeedMetric, SpeedRange, StorageState,
    TorrentSnapshot, TorrentState,
};

pub(super) fn snapshot(revision: u64, piece_count: u32) -> ServiceSnapshot {
    ServiceSnapshot {
        profile_id: "test".to_owned(),
        revision: revision.to_string(),
        storage: Default::default(),
        client_settings: Default::default(),
        torrents: vec![TorrentSnapshot {
            safety_summary: None,
            torrent_id: "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
            protocol_identities: crate::TorrentProtocolIdentities {
                v1: Some("000102030405060708090a0b0c0d0e0f10111213".to_owned()),
                v2: None,
            },
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
            piece_count,
            verified_piece_count: 0,
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

pub(super) fn piece_spec(queue: u32) -> SubscriptionSpec {
    SubscriptionSpec {
        selector: ViewSelector::Torrent {
            torrent_id: "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
        },
        projection: ViewProjection::PieceActivity,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: queue,
        },
        diagnostics: None,
        catalog_page: None,
    }
}

pub(super) fn speed_spec(range: SpeedRange) -> SubscriptionSpec {
    SubscriptionSpec {
        selector: ViewSelector::SessionSpeedHistory {
            range,
            metrics: vec![SpeedMetric::PayloadReceived],
        },
        projection: ViewProjection::SpeedHistory,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: 64 * 1024,
        },
        diagnostics: None,
        catalog_page: None,
    }
}

pub(super) fn dht_spec() -> SubscriptionSpec {
    SubscriptionSpec {
        selector: ViewSelector::SessionDht,
        projection: ViewProjection::Dht,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: 256 * 1024,
        },
        diagnostics: None,
        catalog_page: None,
    }
}

pub(super) fn tracker_snapshot(
    status: TrackerRuntimeStatus,
    attempts: u32,
) -> TrackerRuntimeSnapshot {
    TrackerRuntimeSnapshot {
        captured_at: Duration::from_secs(2),
        active: !matches!(status, TrackerRuntimeStatus::Inactive),
        records: vec![TrackerRuntimeRecordSnapshot {
            tracker_id: "udp://tracker.example:6969".to_owned(),
            url: "udp://tracker.example:6969".to_owned(),
            tier: 0,
            source: TrackerSource::Magnet,
            transport: TrackerTransport::Udp,
            https_authentication: None,
            status,
            announce_event: None,
            total_attempts: attempts,
            consecutive_failures: u8::from(matches!(status, TrackerRuntimeStatus::RetryWait)),
            last_connection_family: None,
            last_peer_count: Some(9),
            seeders: Some(4),
            leechers: Some(5),
            interval: Some(Duration::from_secs(600)),
            next_action: Some(if matches!(status, TrackerRuntimeStatus::RetryWait) {
                TrackerNextAction::Retry
            } else {
                TrackerNextAction::Reannounce
            }),
            next_action_in: Some(Duration::from_secs(15)),
            last_success_age: Some(Duration::from_secs(1)),
            last_failure_age: None,
            last_error: None,
        }],
    }
}

pub(super) fn disk_snapshot(captured_at_millis: u64, received: usize) -> DiskRuntimeSnapshot {
    DiskRuntimeSnapshot {
        captured_at_millis,
        pressure: DiskPressure::Backpressured,
        intake_backpressured: true,
        resident_limit_bytes: 32 * 1024 * 1024,
        resident_high_watermark_bytes: 24 * 1024 * 1024,
        resident_low_watermark_bytes: 16 * 1024 * 1024,
        requested_bytes: 4 * 1024 * 1024,
        resident_bytes: 25 * 1024 * 1024,
        queued_write_bytes: 24 * 1024 * 1024,
        writing_bytes: 256 * 1024,
        hashing_bytes: 0,
        checkpoint_stage: DiskCheckpointStage::Syncing,
        checkpoint_dirty_pieces: 3,
        checkpoint_dirty_bytes: 3 * 16 * 1024,
        checkpoint_dirty_piece_high_water: 5,
        checkpoint_dirty_byte_high_water: 5 * 16 * 1024,
        checkpoint_oldest_dirty_millis: 750,
        checkpoint_batches_started: 2,
        checkpoint_batches_completed: 1,
        checkpoint_pieces_completed: 4,
        checkpoint_sync_operations_completed: 2,
        checkpoint_sync_service_micros: 600,
        checkpoint_sync_service_max_micros: 400,
        checkpoint_commit_service_micros: 300,
        checkpoint_commit_service_max_micros: 300,
        checkpoint_active_micros: Some(200),
        storage_jobs_pending: 96,
        received_bytes_total: received,
        stored_bytes_total: received.saturating_sub(1024),
        verified_bytes_total: received.saturating_sub(2048),
        write_operations_started: 10,
        write_operations_completed: 9,
        hash_operations_started: 2,
        hash_operations_completed: 2,
        write_queue_wait_micros: 4_000,
        write_queue_wait_max_micros: 2_000,
        write_service_micros: 8_000,
        write_service_max_micros: 3_000,
        hash_queue_wait_micros: 500,
        hash_queue_wait_max_micros: 400,
        hash_service_micros: 1_200,
        hash_service_max_micros: 800,
        pressure_transition_count: 1,
        backpressured_millis_total: 900,
        last_error: None,
        pieces: vec![DiskPieceRuntimeSnapshot {
            piece_index: 3,
            piece_length: 16 * 1024,
            attempt: 1,
            stage: DiskPieceStage::Writing,
            requested_bytes: 16 * 1024,
            received_bytes: 16 * 1024,
            stored_bytes: 0,
            age_millis: 100,
            stage_age_millis: 20,
            error: None,
        }],
    }
}
