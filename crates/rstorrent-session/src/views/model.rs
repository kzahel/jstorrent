//! Current projection mapping from engine and durable session observations.
//!
//! Mapping is deterministic and owns no shared state or task. The hub owns
//! the mutable projection maps and supplies observations to these functions.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use rstorrent_engine::peer::{
    DialEligibility, PeerFailure, PeerRegistrySnapshot, PeerSource, PeerSources,
};
use rstorrent_engine::{
    CheckerPhase, CheckerProgress, DiskCheckpointStage, DiskPieceRuntimeSnapshot, DiskPieceStage,
    DiskPressure, DiskRuntimeSnapshot, IntegrityPreparationPhase, IntegrityPreparationProgress,
    MetadataAcquisitionProgress, PeerConnectionDirection, PeerConnectionLifecycle,
    PeerConnectionObservation, PeerConnectionRole, PeerRequestWindowPhase, PeerTransport,
    PeerUploadGrant,
};
use rstorrent_protocol::mse::MseMethod;
use rstorrent_protocol::peer_id::identify_client;
use rstorrent_protocol::storage_layout::RequiredPayloadGeometry;

use crate::control::{TorrentSnapshot, TorrentState};
use crate::file_views::{FileProgressModel, FileViewChange};
use crate::tracker_views::TrackerViewModel;

use super::eta::TorrentEtaModel;
use super::ranges::{insert_range, range_cardinality, remove_range};
use super::{
    ActivePiece, ActivePieceStageView, CapabilityStatus, CheckingPhaseView, CheckingProgressView,
    DhtAddressFamilyView, DhtBucketView, DhtFamilyInspectionView, DhtInspectionView,
    DhtLifecycleView, DhtNetworkPolicyView, DiskCheckpointStageView, DiskPieceStageView,
    DiskPieceView, DiskPipelineView, DiskPressureView, IndexRange, IntegrityPreparationPhaseView,
    IntegrityPreparationView, MetadataAcquisitionPhaseView, MetadataAcquisitionView, PeerDirection,
    PeerDisconnectReason, PeerFieldCapabilities, PeerFlagView, PeerLifecycle, PeerMseMethodView,
    PeerRequestPhase, PeerRole, PeerSourceView, PeerTransportKind, PeerView, ProgressAction,
    ProgressAssessment, ProgressDisposition, ProgressInputs, ProgressPhase, ProgressReason,
    SeedAdmissionView, SubscriptionError, SwarmCatalogState, SwarmCountsView, SwarmPeerState,
    SwarmPeerView, TorrentEtaView, TorrentLifetimeView, TorrentOperationalState,
    TorrentPreparationView, TorrentSeedingView, TorrentView,
};

impl DhtInspectionView {
    pub(crate) fn inactive() -> Self {
        Self {
            lifecycle: DhtLifecycleView::Inactive,
            network_policy: DhtNetworkPolicyView::Offline,
            captured_millis: "0".to_owned(),
            active_transactions: 0,
            active_lookups: 0,
            queries_sent: "0".to_owned(),
            responses_received: "0".to_owned(),
            queries_received: "0".to_owned(),
            malformed_received: "0".to_owned(),
            family_mismatched: "0".to_owned(),
            rate_limited: "0".to_owned(),
            discovered_peers: "0".to_owned(),
            bootstrap_attempts: "0".to_owned(),
            routing_refreshes: "0".to_owned(),
            datagram_bytes_sent: "0".to_owned(),
            datagram_bytes_received: "0".to_owned(),
            announces_sent: "0".to_owned(),
            announces_succeeded: "0".to_owned(),
            announces_failed: "0".to_owned(),
            families: [DhtAddressFamilyView::Ipv4, DhtAddressFamilyView::Ipv6]
                .into_iter()
                .map(inactive_dht_family)
                .collect(),
            lookups: Vec::new(),
        }
    }

    pub(crate) fn suspended(network_policy: rstorrent_engine::NetworkPolicy) -> Self {
        let mut view = Self::inactive();
        view.lifecycle = DhtLifecycleView::Suspended;
        view.network_policy = match network_policy {
            rstorrent_engine::NetworkPolicy::Offline => DhtNetworkPolicyView::Offline,
            rstorrent_engine::NetworkPolicy::LoopbackOnly => DhtNetworkPolicyView::LoopbackOnly,
            rstorrent_engine::NetworkPolicy::Online => DhtNetworkPolicyView::Online,
        };
        for family in &mut view.families {
            family.lifecycle = DhtLifecycleView::Suspended;
        }
        view
    }
}

fn inactive_dht_family(family: DhtAddressFamilyView) -> DhtFamilyInspectionView {
    DhtFamilyInspectionView {
        family,
        lifecycle: DhtLifecycleView::Inactive,
        local_node_id: "0000000000000000000000000000000000000000".to_owned(),
        local_address: match family {
            DhtAddressFamilyView::Ipv4 => "0.0.0.0:0",
            DhtAddressFamilyView::Ipv6 => "[::]:0",
        }
        .to_owned(),
        observed_external_address: None,
        routing_nodes: 0,
        occupied_buckets: 0,
        deepest_shared_prefix_bits: None,
        active_transactions: 0,
        active_lookups: 0,
        queries_sent: "0".to_owned(),
        responses_received: "0".to_owned(),
        queries_received: "0".to_owned(),
        malformed_received: "0".to_owned(),
        family_mismatched: "0".to_owned(),
        rate_limited: "0".to_owned(),
        discovered_peers: "0".to_owned(),
        bootstrap_attempts: "0".to_owned(),
        routing_refreshes: "0".to_owned(),
        datagram_bytes_sent: "0".to_owned(),
        datagram_bytes_received: "0".to_owned(),
        announces_sent: "0".to_owned(),
        announces_succeeded: "0".to_owned(),
        announces_failed: "0".to_owned(),
        buckets: (0..160)
            .map(|bucket_index| DhtBucketView {
                bucket_index,
                good_nodes: 0,
                questionable_nodes: 0,
                replacement_candidates: 0,
                oldest_live_response_age_millis: None,
            })
            .collect(),
    }
}

pub fn assess_progress(snapshot: &TorrentSnapshot, inputs: ProgressInputs) -> ProgressAssessment {
    use ProgressAction::{EnableDiscovery, EnableNetwork, RepairStorage, Resume, SelectStorage};
    use ProgressDisposition::{Active, Blocked, Inactive, Waiting};
    use ProgressPhase::{Complete as CompletePhase, Discovery, Storage, Transfer, Verification};
    use ProgressReason::{
        AcquiringMetadata, Complete, DiscoveringPeers, Failed, NeedsRepair, NetworkDisabled,
        NoEnabledDiscoverySource, Paused, PreparingIntegrity, PreparingStorage, TransferringPieces,
        VerifyingPieces, WaitingForDiscovery, WaitingForStorage, WaitingForUnmeteredNetwork,
    };

    if snapshot.state == TorrentState::AwaitingMetadata && inputs.network_disabled {
        return ProgressAssessment {
            disposition: Blocked,
            phase: Discovery,
            reason: NetworkDisabled,
            actions: vec![EnableNetwork],
        };
    }
    if inputs.waiting_for_unmetered_network
        && snapshot.desired_running
        && !matches!(
            snapshot.state,
            TorrentState::Paused
                | TorrentState::Complete
                | TorrentState::AwaitingStorage
                | TorrentState::NeedsRepair
                | TorrentState::Error
        )
    {
        return ProgressAssessment {
            disposition: Waiting,
            phase: phase_for(snapshot),
            reason: WaitingForUnmeteredNetwork,
            actions: Vec::new(),
        };
    }

    match snapshot.state {
        TorrentState::Paused => ProgressAssessment {
            disposition: Inactive,
            phase: phase_for(snapshot),
            reason: Paused,
            actions: vec![Resume],
        },
        TorrentState::Complete => ProgressAssessment {
            disposition: Inactive,
            phase: CompletePhase,
            reason: Complete,
            actions: Vec::new(),
        },
        TorrentState::NeedsRepair => ProgressAssessment {
            disposition: Blocked,
            phase: Storage,
            reason: NeedsRepair,
            actions: vec![RepairStorage],
        },
        TorrentState::Error => ProgressAssessment {
            disposition: Inactive,
            phase: phase_for(snapshot),
            reason: Failed,
            actions: Vec::new(),
        },
        TorrentState::AwaitingStorage if inputs.task_active => ProgressAssessment {
            disposition: Active,
            phase: Storage,
            reason: PreparingStorage,
            actions: Vec::new(),
        },
        TorrentState::AwaitingStorage => ProgressAssessment {
            disposition: Blocked,
            phase: Storage,
            reason: WaitingForStorage,
            actions: vec![SelectStorage],
        },
        TorrentState::Checking => ProgressAssessment {
            disposition: if inputs.task_active { Active } else { Waiting },
            phase: Verification,
            reason: VerifyingPieces,
            actions: Vec::new(),
        },
        TorrentState::Downloading => match inputs.integrity_preparation_active {
            Some(active) => ProgressAssessment {
                disposition: if active { Active } else { Waiting },
                phase: Verification,
                reason: PreparingIntegrity,
                actions: Vec::new(),
            },
            None => ProgressAssessment {
                disposition: if inputs.task_active { Active } else { Waiting },
                phase: Transfer,
                reason: TransferringPieces,
                actions: Vec::new(),
            },
        },
        TorrentState::AwaitingMetadata if inputs.task_active || inputs.discovery_active => {
            ProgressAssessment {
                disposition: Active,
                phase: Discovery,
                reason: if inputs.task_active {
                    AcquiringMetadata
                } else {
                    DiscoveringPeers
                },
                actions: Vec::new(),
            }
        }
        TorrentState::AwaitingMetadata
            if inputs.discovery_retry_scheduled || inputs.dht_enabled =>
        {
            ProgressAssessment {
                disposition: Waiting,
                phase: Discovery,
                reason: WaitingForDiscovery,
                actions: Vec::new(),
            }
        }
        TorrentState::AwaitingMetadata if inputs.discovery_exhausted => ProgressAssessment {
            disposition: Blocked,
            phase: Discovery,
            reason: NoEnabledDiscoverySource,
            actions: vec![EnableDiscovery],
        },
        TorrentState::AwaitingMetadata => ProgressAssessment {
            disposition: Waiting,
            phase: Discovery,
            reason: WaitingForDiscovery,
            actions: Vec::new(),
        },
    }
}

pub(crate) fn operational_state(
    snapshot: &TorrentSnapshot,
    inputs: ProgressInputs,
) -> TorrentOperationalState {
    if inputs.stopping {
        return TorrentOperationalState::Stopping;
    }
    if snapshot.desired_running && snapshot.state == TorrentState::Checking {
        return TorrentOperationalState::Checking;
    }
    // Completion/admission can be published while the old content task still
    // owns its cleanup. That task flag must not relabel an admitted seed.
    if snapshot.desired_running && snapshot.state == TorrentState::Complete {
        return match inputs.seed_admission {
            SeedAdmissionView::Active | SeedAdmissionView::InactiveExempt => {
                TorrentOperationalState::Seeding
            }
            SeedAdmissionView::Queued | SeedAdmissionView::Ineligible => {
                TorrentOperationalState::Queued
            }
        };
    }
    if snapshot.desired_running && inputs.task_active {
        return match snapshot.state {
            TorrentState::AwaitingMetadata | TorrentState::AwaitingStorage => {
                TorrentOperationalState::Starting
            }
            TorrentState::Checking => TorrentOperationalState::Checking,
            _ => TorrentOperationalState::Downloading,
        };
    }
    if snapshot.desired_running
        && snapshot.state == TorrentState::AwaitingMetadata
        && !inputs.network_disabled
        && (inputs.discovery_retry_scheduled || (inputs.dht_enabled && !inputs.discovery_exhausted))
    {
        return TorrentOperationalState::Starting;
    }
    if matches!(
        snapshot.state,
        TorrentState::NeedsRepair | TorrentState::Error
    ) {
        return TorrentOperationalState::Error;
    }
    if !snapshot.desired_running {
        return TorrentOperationalState::Paused;
    }
    if snapshot.download_queue_position.is_some() {
        return TorrentOperationalState::Queued;
    }
    TorrentOperationalState::Error
}

fn phase_for(snapshot: &TorrentSnapshot) -> ProgressPhase {
    match snapshot.state {
        TorrentState::AwaitingMetadata => ProgressPhase::Discovery,
        TorrentState::AwaitingStorage | TorrentState::NeedsRepair => ProgressPhase::Storage,
        TorrentState::Checking => ProgressPhase::Verification,
        TorrentState::Downloading => ProgressPhase::Transfer,
        TorrentState::Complete => ProgressPhase::Complete,
        TorrentState::Paused | TorrentState::Error if snapshot.metadata_available => {
            ProgressPhase::Transfer
        }
        TorrentState::Paused | TorrentState::Error => ProgressPhase::Discovery,
    }
}

impl PeerView {
    pub(super) fn from_observation(
        torrent_id: &str,
        captured_at: Duration,
        peer: &PeerConnectionObservation,
    ) -> Self {
        let content = peer.content.as_ref();
        let upload = peer.upload.as_ref();
        let client_name = peer.peer_id.as_ref().and_then(identify_client);
        let client_name_capability = if client_name.is_some() {
            CapabilityStatus::Available
        } else {
            CapabilityStatus::Unavailable
        };
        let mut view = Self {
            connection_id: peer.connection_id.get().to_string(),
            torrent_id: torrent_id.to_owned(),
            peer_record_id: peer.record_id.map(|id| id.get().to_string()),
            direction: match peer.direction {
                PeerConnectionDirection::Incoming => PeerDirection::Incoming,
                PeerConnectionDirection::Outgoing => PeerDirection::Outgoing,
            },
            transport: match peer.transport {
                PeerTransport::Tcp => PeerTransportKind::Tcp,
                PeerTransport::Utp => PeerTransportKind::Utp,
            },
            lifecycle: match peer.lifecycle {
                PeerConnectionLifecycle::TransportConnecting => PeerLifecycle::TransportConnecting,
                PeerConnectionLifecycle::ProtocolHandshaking => PeerLifecycle::ProtocolHandshaking,
                PeerConnectionLifecycle::Connected => PeerLifecycle::Connected,
                PeerConnectionLifecycle::Disconnecting => PeerLifecycle::Disconnecting,
            },
            role: match peer.role {
                PeerConnectionRole::Metadata => PeerRole::Metadata,
                PeerConnectionRole::Content => PeerRole::Content,
            },
            peer_flags: Vec::new(),
            mse_method: peer.mse_method.map(|method| match method {
                MseMethod::PlaintextPayload => PeerMseMethodView::PlaintextPayload,
                MseMethod::Rc4 => PeerMseMethodView::Rc4,
            }),
            lifecycle_age_millis: duration_millis_string(
                captured_at.saturating_sub(peer.lifecycle_changed_at),
            ),
            remote_endpoint: peer.endpoint.to_string(),
            local_endpoint: peer.local_endpoint.map(|endpoint| endpoint.to_string()),
            sources: peer_sources(peer.sources),
            peer_id: peer.peer_id.map(hex_peer_id),
            client_name,
            supports_extensions: peer.supports_extensions,
            supports_ut_metadata: peer.supports_ut_metadata,
            local_interested: content.map(|_| true),
            remote_interested: upload.map(|activity| activity.interested),
            remote_choking: content.map(|activity| activity.choking),
            local_choking: upload.map(|activity| activity.grant == PeerUploadGrant::Choked),
            available_piece_count: None,
            wanted_piece_count: content.map(|activity| bounded_u32(activity.wanted_piece_count)),
            payload_download_rate_bytes: content
                .map(|activity| activity.observed_payload_rate.to_string()),
            payload_downloaded_bytes: content
                .map(|activity| activity.useful_payload_bytes.to_string()),
            protocol_download_rate_bytes: None,
            protocol_downloaded_bytes: None,
            payload_upload_rate_bytes: upload.map(|activity| activity.payload_rate.to_string()),
            payload_uploaded_bytes: upload.map(|activity| activity.payload_bytes.to_string()),
            pending_requests: content
                .map(|activity| bounded_u32(activity.pending_requests))
                .or_else(|| upload.map(|activity| bounded_u32(activity.queued_requests))),
            target_requests: content.map(|activity| bounded_u32(activity.target_requests)),
            queued_payload_bytes: content
                .map(|activity| activity.queued_payload_bytes.to_string())
                .or_else(|| {
                    upload.map(|activity| {
                        activity
                            .queued_bytes
                            .saturating_add(activity.writer_bytes)
                            .to_string()
                    })
                }),
            oldest_request_age_millis: content
                .and_then(|activity| activity.oldest_request_age)
                .map(duration_millis_string),
            request_timeout_millis: content
                .map(|activity| duration_millis_string(activity.request_timeout)),
            request_phase: content.map(|activity| match activity.request_window_phase {
                PeerRequestWindowPhase::SlowStart => PeerRequestPhase::SlowStart,
                PeerRequestWindowPhase::Steady => PeerRequestPhase::Steady,
                PeerRequestWindowPhase::Stalled => PeerRequestPhase::Stalled,
            }),
            connected_age_millis: content
                .map(|activity| duration_millis_string(activity.connected_age))
                .or_else(|| {
                    upload.map(|_| {
                        duration_millis_string(captured_at.saturating_sub(peer.started_at))
                    })
                }),
            last_useful_age_millis: content
                .and_then(|activity| activity.last_useful_age)
                .map(duration_millis_string),
            last_payload_age_millis: content
                .and_then(|activity| activity.last_payload_age)
                .map(duration_millis_string),
            disconnect_reason: peer.close_reason.map(|reason| match reason {
                PeerFailure::Connect => PeerDisconnectReason::Connect,
                PeerFailure::Handshake => PeerDisconnectReason::Handshake,
                PeerFailure::SelfConnection => PeerDisconnectReason::SelfConnection,
                PeerFailure::DuplicatePeerId => PeerDisconnectReason::DuplicatePeerId,
                PeerFailure::Protocol => PeerDisconnectReason::Protocol,
                PeerFailure::RemoteClosed => PeerDisconnectReason::RemoteClosed,
            }),
            capabilities: PeerFieldCapabilities {
                local_endpoint: if peer.local_endpoint.is_some() {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Unavailable
                },
                client_name: client_name_capability,
                ut_metadata: if peer.supports_ut_metadata.is_some() {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Unavailable
                },
                interest_directions: if content.is_some() || upload.is_some() {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Unavailable
                },
                local_choke: if upload.is_some() {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Unsupported
                },
                piece_availability: CapabilityStatus::Unavailable,
                protocol_rates: CapabilityStatus::Unsupported,
                upload: if upload.is_some() {
                    CapabilityStatus::Available
                } else {
                    CapabilityStatus::Unsupported
                },
                metadata_stage: CapabilityStatus::Unavailable,
            },
        };
        view.peer_flags = derive_peer_flags(
            &view,
            upload.is_some_and(|activity| activity.grant == PeerUploadGrant::Optimistic),
        );
        view
    }
}

fn derive_peer_flags(peer: &PeerView, optimistic_unchoke: bool) -> Vec<PeerFlagView> {
    let mut flags = Vec::with_capacity(6);

    if peer.direction == PeerDirection::Incoming {
        flags.push(PeerFlagView::Incoming);
    }
    if peer.mse_method.is_some() {
        flags.push(PeerFlagView::Encrypted);
    }
    if peer.local_interested == Some(true) {
        match peer.remote_choking {
            Some(false) => flags.push(PeerFlagView::DownloadAllowed),
            Some(true) => flags.push(PeerFlagView::DownloadChoked),
            None => {}
        }
    }
    if peer.remote_interested == Some(true) {
        match peer.local_choking {
            Some(false) => flags.push(PeerFlagView::UploadAllowed),
            Some(true) => flags.push(PeerFlagView::UploadChoked),
            None => {}
        }
    }
    if peer.supports_extensions == Some(true) {
        flags.push(PeerFlagView::ExtensionProtocol);
    }
    if peer.supports_ut_metadata == Some(true) {
        flags.push(PeerFlagView::MetadataExtension);
    }
    if peer.transport == PeerTransportKind::Utp {
        flags.push(PeerFlagView::Utp);
    }
    if optimistic_unchoke {
        flags.push(PeerFlagView::OptimisticUnchoke);
    }

    flags.sort_unstable();

    flags
}

pub(super) fn bounded_u32(value: usize) -> u32 {
    value.try_into().unwrap_or(u32::MAX)
}

pub(super) fn duration_millis_string(value: Duration) -> String {
    value.as_millis().to_string()
}

fn hex_peer_id(peer_id: [u8; 20]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(40);
    for byte in peer_id {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn peer_sources(sources: PeerSources) -> Vec<PeerSourceView> {
    [
        (PeerSource::Tracker, PeerSourceView::Tracker),
        (PeerSource::PeerExchange, PeerSourceView::PeerExchange),
        (PeerSource::Dht, PeerSourceView::Dht),
        (PeerSource::LocalDiscovery, PeerSourceView::LocalDiscovery),
        (PeerSource::Incoming, PeerSourceView::Incoming),
        (PeerSource::Manual, PeerSourceView::Manual),
        (PeerSource::MagnetHint, PeerSourceView::MagnetHint),
        (PeerSource::Cache, PeerSourceView::Cache),
    ]
    .into_iter()
    .filter_map(|(source, view)| sources.contains(source).then_some(view))
    .collect()
}

const MAX_SWARM_RECORDS: usize = 1_000;

fn peer_failure_view(failure: PeerFailure) -> PeerDisconnectReason {
    match failure {
        PeerFailure::Connect => PeerDisconnectReason::Connect,
        PeerFailure::Handshake => PeerDisconnectReason::Handshake,
        PeerFailure::SelfConnection => PeerDisconnectReason::SelfConnection,
        PeerFailure::DuplicatePeerId => PeerDisconnectReason::DuplicatePeerId,
        PeerFailure::Protocol => PeerDisconnectReason::Protocol,
        PeerFailure::RemoteClosed => PeerDisconnectReason::RemoteClosed,
    }
}

pub(super) fn swarm_model(
    torrent_id: &str,
    active: bool,
    snapshot: &PeerRegistrySnapshot,
) -> Result<SwarmModel, SubscriptionError> {
    if snapshot.maximum_records > MAX_SWARM_RECORDS
        || snapshot.records.len() > snapshot.maximum_records
        || snapshot.counts.total != snapshot.records.len()
    {
        return Err(SubscriptionError::Internal(
            "peer registry snapshot exceeds its bounded contract".to_owned(),
        ));
    }
    let counts_total = snapshot.counts.eligible
        + snapshot.counts.not_connectable
        + snapshot.counts.dialing
        + snapshot.counts.connected
        + snapshot.counts.banned
        + snapshot.counts.backed_off
        + snapshot.counts.failure_limited;
    if counts_total != snapshot.counts.total {
        return Err(SubscriptionError::Internal(
            "peer registry snapshot counts are inconsistent".to_owned(),
        ));
    }
    let captured_at = snapshot.captured_at;
    let peers = if active {
        snapshot
            .records
            .iter()
            .map(|record| {
                let (state, retry_in_millis) = match record.eligibility {
                    DialEligibility::Eligible => (SwarmPeerState::Eligible, None),
                    DialEligibility::NotConnectable => (SwarmPeerState::NotConnectable, None),
                    DialEligibility::Dialing => (SwarmPeerState::Dialing, None),
                    DialEligibility::Connected => (SwarmPeerState::Connected, None),
                    DialEligibility::Backoff { retry_at } => (
                        SwarmPeerState::BackedOff,
                        Some(duration_millis_string(retry_at.saturating_sub(captured_at))),
                    ),
                    DialEligibility::FailureLimit { .. } => (SwarmPeerState::FailureLimited, None),
                    DialEligibility::Banned => (SwarmPeerState::Banned, None),
                };
                let history = record.history;
                let view = SwarmPeerView {
                    peer_record_id: record.id.get().to_string(),
                    torrent_id: torrent_id.to_owned(),
                    endpoint: record.endpoint.to_string(),
                    sources: peer_sources(record.sources),
                    state,
                    connectable: record.connectable,
                    first_observed_age_millis: duration_millis_string(
                        captured_at.saturating_sub(record.first_observed_at),
                    ),
                    last_observed_age_millis: duration_millis_string(
                        captured_at.saturating_sub(record.last_observed_at),
                    ),
                    retry_in_millis,
                    dial_attempts: history.dial_attempts,
                    consecutive_failures: history.consecutive_failures,
                    total_failures: history.total_failures,
                    last_dial_age_millis: history
                        .last_dial_at
                        .map(|at| duration_millis_string(captured_at.saturating_sub(at))),
                    last_connected_age_millis: history
                        .last_connected_at
                        .map(|at| duration_millis_string(captured_at.saturating_sub(at))),
                    last_failure: history.last_failure.map(peer_failure_view),
                    last_failure_age_millis: history.last_failure.and_then(|_| {
                        history
                            .last_disconnected_at
                            .map(|at| duration_millis_string(captured_at.saturating_sub(at)))
                    }),
                    payload_downloaded_bytes: record.transfers.payload_downloaded_bytes.to_string(),
                    payload_uploaded_bytes: record.transfers.payload_uploaded_bytes.to_string(),
                    trust_points: record.integrity.trust_points,
                    hash_failures: record.integrity.hash_failures,
                    valid_pieces: record.integrity.valid_pieces,
                    on_parole: record.integrity.on_parole,
                };
                (view.peer_record_id.clone(), view)
            })
            .collect()
    } else {
        BTreeMap::new()
    };
    Ok(SwarmModel {
        state: if active {
            SwarmCatalogState::Active
        } else {
            SwarmCatalogState::Inactive
        },
        captured_millis: duration_millis_string(captured_at),
        maximum_records: bounded_u32(snapshot.maximum_records),
        counts: if active {
            SwarmCountsView {
                total: bounded_u32(snapshot.counts.total),
                eligible: bounded_u32(snapshot.counts.eligible),
                not_connectable: bounded_u32(snapshot.counts.not_connectable),
                dialing: bounded_u32(snapshot.counts.dialing),
                connected: bounded_u32(snapshot.counts.connected),
                backed_off: bounded_u32(snapshot.counts.backed_off),
                failure_limited: bounded_u32(snapshot.counts.failure_limited),
                banned: bounded_u32(snapshot.counts.banned),
            }
        } else {
            SwarmCountsView::default()
        },
        peers,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TorrentModel {
    pub(super) view: TorrentView,
    pub(super) preparation: Option<TorrentPreparationView>,
    pub(super) eta: TorrentEtaModel,
    pub(super) snapshot: TorrentSnapshot,
    pub(super) progress_inputs: ProgressInputs,
    pub(super) verified: Vec<IndexRange>,
    pub(super) active: BTreeMap<u32, ActivePiece>,
    pub(super) peers: BTreeMap<String, PeerView>,
    pub(super) swarm: SwarmModel,
    pub(super) files: Option<FileProgressModel>,
    pub(super) trackers: TrackerViewModel,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SwarmModel {
    pub(super) state: SwarmCatalogState,
    pub(super) captured_millis: String,
    pub(super) maximum_records: u32,
    pub(super) counts: SwarmCountsView,
    pub(super) peers: BTreeMap<String, SwarmPeerView>,
}

impl Default for SwarmModel {
    fn default() -> Self {
        Self {
            state: SwarmCatalogState::Inactive,
            captured_millis: "0".to_owned(),
            maximum_records: 1_000,
            counts: SwarmCountsView::default(),
            peers: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct DiskSessionModel {
    pub(super) torrents: BTreeMap<String, DiskTorrentRuntime>,
}

#[derive(Clone, Debug)]
pub(super) struct DiskTorrentRuntime {
    pub(super) snapshot: DiskRuntimeSnapshot,
    pub(super) sample_millis: u64,
    pub(super) receive_rate_bytes: u64,
    pub(super) write_rate_bytes: u64,
    pub(super) hash_rate_bytes: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(super) struct DiskSessionView {
    pub(super) pipeline: DiskPipelineView,
    pub(super) pieces: BTreeMap<String, DiskPieceView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DurableTorrentViewState {
    pub(crate) display_name: Option<String>,
    pub(crate) source_display_name: Option<String>,
    /// The source magnet's `xl` claim; only set before metadata exists.
    pub(crate) source_size_bytes: Option<u64>,
    /// BEP 27 flag from parsed, stored metainfo only.
    pub(crate) private_torrent: bool,
    pub(crate) checking_generation: Option<u64>,
    pub(crate) verified: Vec<IndexRange>,
    pub(crate) files: Option<FileProgressModel>,
    pub(crate) eta_geometry: Option<RequiredPayloadGeometry>,
    pub(crate) trackers: TrackerViewModel,
    pub(crate) total_size: u64,
    pub(crate) lifetime: TorrentLifetimeView,
    pub(crate) seeding: TorrentSeedingView,
}

impl TorrentModel {
    pub(super) fn from_snapshot(snapshot: &TorrentSnapshot) -> Self {
        let progress_inputs = ProgressInputs::default();
        Self {
            view: TorrentView {
                torrent_id: snapshot.torrent_id.clone(),
                protocol_identities: snapshot.protocol_identities.clone(),
                display_name: None,
                source_display_name: None,
                source_size_bytes: None,
                state: snapshot.state,
                operational_state: operational_state(snapshot, progress_inputs),
                download_queue_position: snapshot.download_queue_position,
                transfer_limits: snapshot.transfer_limits,
                storage_state: snapshot.storage_state,
                storage_root: snapshot.storage_root.clone(),
                metadata_available: snapshot.metadata_available,
                private_torrent: false,
                awaiting_file_selection: snapshot.awaiting_file_selection,
                pending_file_selection_position: snapshot.pending_file_selection_position,
                file_catalog_id: snapshot.file_catalog_id.clone(),
                selectable_file_count: snapshot.selectable_file_count,
                selected_file_count: snapshot.selected_file_count,
                selectable_file_bytes: snapshot.selectable_file_bytes.clone(),
                selected_file_bytes: snapshot.selected_file_bytes.clone(),
                piece_count: snapshot.piece_count,
                total_size_bytes: None,
                verified_piece_count: snapshot.verified_piece_count,
                requested_bytes: "0".to_owned(),
                received_bytes: "0".to_owned(),
                stored_bytes: "0".to_owned(),
                active_peer_connections: 0,
                configured_tracker_count: None,
                payload_download_rate_bytes: "0".to_owned(),
                required_payload_bytes: None,
                remaining_payload_bytes: None,
                eta_payload_download_rate_bytes: "0".to_owned(),
                eta: TorrentEtaView::Unavailable,
                lifetime: TorrentLifetimeView::default(),
                seeding: TorrentSeedingView::default(),
                progress: assess_progress(snapshot, progress_inputs),
                checking: None,
                archived: snapshot.archived,
                removal_state: snapshot.removal_state,
                delete_data_supported: snapshot.delete_data_supported,
                force_recheck_available: snapshot.force_recheck_available,
                error: snapshot.error.clone(),
            },
            eta: TorrentEtaModel::default(),
            preparation: None,
            snapshot: snapshot.clone(),
            progress_inputs,
            verified: Vec::new(),
            active: BTreeMap::new(),
            peers: BTreeMap::new(),
            swarm: SwarmModel::default(),
            files: None,
            trackers: TrackerViewModel::default(),
        }
    }

    pub(super) fn apply_metadata_preparation(
        &mut self,
        generation: u64,
        progress: &MetadataAcquisitionProgress,
    ) -> bool {
        if !self.eta.owns_generation(generation) {
            return false;
        }
        let preparation = self
            .preparation
            .get_or_insert_with(|| TorrentPreparationView {
                generation: generation.to_string(),
                metadata: None,
                integrity: None,
            });
        if preparation.generation != generation.to_string() {
            return false;
        }
        preparation.metadata = Some(MetadataAcquisitionView {
            phase: if progress.total_size.is_some() {
                MetadataAcquisitionPhaseView::Downloading
            } else {
                MetadataAcquisitionPhaseView::Discovering
            },
            total_size_bytes: progress.total_size.map(|size| size.to_string()),
            received_bytes: progress.received_bytes.to_string(),
            block_count: bounded_u32(progress.block_count),
            block_states: STANDARD.encode(&progress.packed_block_states),
            active_peers: bounded_u32(progress.active_peers),
            requests_in_flight: bounded_u32(progress.requests_in_flight),
            hash_retries: bounded_u32(progress.hash_failures),
        });
        true
    }

    pub(super) fn finish_metadata_preparation(&mut self, generation: u64) -> bool {
        if !self.eta.owns_generation(generation) {
            return false;
        }
        let Some(preparation) = self.preparation.as_mut() else {
            return false;
        };
        if preparation.generation != generation.to_string() {
            return false;
        }
        preparation.metadata = None;
        if preparation.integrity.is_none() {
            self.preparation = None;
        }
        true
    }

    pub(super) fn apply_integrity_preparation(
        &mut self,
        generation: u64,
        progress: IntegrityPreparationProgress,
    ) -> bool {
        if !self.eta.owns_generation(generation) {
            return false;
        }
        self.progress_inputs.integrity_preparation_active = match progress.phase {
            IntegrityPreparationPhase::Ready => None,
            IntegrityPreparationPhase::Acquiring => Some(true),
            IntegrityPreparationPhase::WaitingForPeer => Some(false),
        };
        match progress.phase {
            IntegrityPreparationPhase::Ready => {
                if let Some(preparation) = self.preparation.as_mut() {
                    if preparation.generation != generation.to_string() {
                        return false;
                    }
                    preparation.integrity = None;
                    if preparation.metadata.is_none() {
                        self.preparation = None;
                    }
                }
            }
            IntegrityPreparationPhase::Acquiring | IntegrityPreparationPhase::WaitingForPeer => {
                let preparation = self
                    .preparation
                    .get_or_insert_with(|| TorrentPreparationView {
                        generation: generation.to_string(),
                        metadata: None,
                        integrity: None,
                    });
                if preparation.generation != generation.to_string() {
                    return false;
                }
                preparation.integrity = Some(IntegrityPreparationView {
                    phase: match progress.phase {
                        IntegrityPreparationPhase::Acquiring => {
                            IntegrityPreparationPhaseView::Acquiring
                        }
                        IntegrityPreparationPhase::WaitingForPeer => {
                            IntegrityPreparationPhaseView::WaitingForPeer
                        }
                        IntegrityPreparationPhase::Ready => unreachable!("handled above"),
                    },
                    needed_hash_ranges: bounded_u32(progress.needed_hash_ranges),
                    active_requests: bounded_u32(progress.active_requests),
                });
            }
        }
        self.view.progress = assess_progress(&self.snapshot, self.progress_inputs);
        true
    }

    pub(super) fn clear_preparation(&mut self, generation: u64) {
        if self
            .preparation
            .as_ref()
            .is_some_and(|preparation| preparation.generation == generation.to_string())
        {
            self.preparation = None;
        }
        self.progress_inputs.integrity_preparation_active = None;
        self.view.progress = assess_progress(&self.snapshot, self.progress_inputs);
    }

    pub(super) fn reset_preparation(&mut self) {
        self.preparation = None;
        self.progress_inputs.integrity_preparation_active = None;
        self.view.progress = assess_progress(&self.snapshot, self.progress_inputs);
    }

    pub(super) fn apply_checker_progress(&mut self, progress: &CheckerProgress) {
        self.view.checking = Some(CheckingProgressView {
            generation: progress.generation.to_string(),
            phase: match progress.phase {
                CheckerPhase::Queued => CheckingPhaseView::Queued,
                CheckerPhase::Preparing => CheckingPhaseView::Preparing,
                CheckerPhase::Hashing => CheckingPhaseView::Hashing,
                CheckerPhase::ReconcilingStorage => CheckingPhaseView::ReconcilingStorage,
                CheckerPhase::Paused => CheckingPhaseView::Paused,
                CheckerPhase::Finalizing => CheckingPhaseView::Finalizing,
            },
            pieces_total: bounded_u32(progress.pieces_total),
            pieces_processed: bounded_u32(progress.pieces_processed),
            pieces_matched: bounded_u32(progress.pieces_matched),
            pieces_absent: bounded_u32(progress.pieces_absent),
            pieces_mismatched: bounded_u32(progress.pieces_mismatched),
            bytes_hashed: progress.bytes_hashed.to_string(),
            active_hash_jobs: bounded_u32(progress.active_hash_jobs),
            queued_hash_jobs: bounded_u32(progress.queued_hash_jobs),
            elapsed_millis: progress.elapsed_millis.to_string(),
            last_advance_age_millis: progress.last_advance_age_millis.to_string(),
            oldest_active_job_age_millis: progress
                .oldest_active_job_age_millis
                .map(|age| age.to_string()),
        });
    }

    pub(super) fn queue_checker(&mut self, generation: u64) {
        self.view.checking = Some(CheckingProgressView {
            generation: generation.to_string(),
            phase: CheckingPhaseView::Queued,
            pieces_total: self.view.piece_count,
            pieces_processed: 0,
            pieces_matched: 0,
            pieces_absent: 0,
            pieces_mismatched: 0,
            bytes_hashed: "0".to_owned(),
            active_hash_jobs: 0,
            queued_hash_jobs: self.view.piece_count,
            elapsed_millis: "0".to_owned(),
            last_advance_age_millis: "0".to_owned(),
            oldest_active_job_age_millis: None,
        });
    }

    pub(super) fn finish_checker(&mut self, generation: u64) {
        if self
            .view
            .checking
            .as_ref()
            .is_some_and(|checking| checking.generation == generation.to_string())
        {
            self.view.checking = None;
        }
    }

    pub(super) fn apply_activity(
        &mut self,
        activity: TorrentActivity,
    ) -> Result<Vec<FileViewChange>, crate::file_views::FileProgressError> {
        let mut file_upsert = Vec::new();
        match activity {
            TorrentActivity::PieceStarted {
                piece_index,
                piece_length,
                attempt,
            } => {
                self.active
                    .entry(piece_index)
                    .or_insert_with(|| ActivePiece {
                        piece_id: active_piece_id(piece_index, attempt),
                        piece_index,
                        attempt,
                        piece_length,
                        stage: ActivePieceStageView::Requested,
                        requested: Vec::new(),
                        received: Vec::new(),
                        stored: Vec::new(),
                        age_millis: "0".to_owned(),
                        error: None,
                    });
            }
            TorrentActivity::BlockRequested {
                piece_index,
                begin,
                length,
            } => {
                add_counter(&mut self.view.requested_bytes, u64::from(length));
                if let Some(active) = self.active.get_mut(&piece_index) {
                    insert_range(&mut active.requested, begin, length);
                    active.stage = ActivePieceStageView::Requested;
                }
            }
            TorrentActivity::BlockReceived {
                piece_index,
                begin,
                length,
            } => {
                add_counter(&mut self.view.received_bytes, u64::from(length));
                if let Some(active) = self.active.get_mut(&piece_index) {
                    remove_range(&mut active.requested, begin, length);
                    insert_range(&mut active.received, begin, length);
                    active.stage = ActivePieceStageView::Received;
                }
            }
            TorrentActivity::BlockStored {
                piece_index,
                begin,
                length,
            } => {
                add_counter(&mut self.view.stored_bytes, u64::from(length));
                if let Some(active) = self.active.get_mut(&piece_index) {
                    remove_range(&mut active.received, begin, length);
                    insert_range(&mut active.stored, begin, length);
                    active.stage =
                        if range_cardinality(&active.stored) >= u64::from(active.piece_length) {
                            ActivePieceStageView::Stored
                        } else {
                            ActivePieceStageView::Received
                        };
                }
                if let Some(files) = &mut self.files {
                    file_upsert = files.stored_block(piece_index, begin, length)?;
                }
            }
            TorrentActivity::PieceVerified { piece_index } => {
                insert_range(&mut self.verified, piece_index, 1);
                self.view.verified_piece_count =
                    range_cardinality(&self.verified).min(u64::from(u32::MAX)) as u32;
                self.active.remove(&piece_index);
                if let Some(files) = &mut self.files {
                    file_upsert = files.piece_verified(piece_index)?;
                }
            }
            TorrentActivity::PieceHashFailed { piece_index, .. } => {
                if let Some(active) = self.active.get_mut(&piece_index) {
                    active.requested.clear();
                    active.received.clear();
                    active.stored.clear();
                    active.stage = ActivePieceStageView::Failed;
                    active.error = Some("Piece hash failed; retrying".to_owned());
                }
                if let Some(files) = &mut self.files {
                    file_upsert = files.piece_hash_failed(piece_index)?;
                }
            }
            TorrentActivity::PieceHashing { piece_index } => {
                if let Some(active) = self.active.get_mut(&piece_index) {
                    active.stage = ActivePieceStageView::Hashing;
                }
            }
        }
        Ok(file_upsert)
    }

    pub(super) fn reconcile_piece_runtime(&mut self, pieces: &[DiskPieceRuntimeSnapshot]) {
        let mut retained = BTreeSet::new();
        for runtime in pieces {
            if runtime.piece_index >= self.view.piece_count {
                continue;
            }
            retained.insert(runtime.piece_index);
            let active = self
                .active
                .entry(runtime.piece_index)
                .or_insert_with(|| active_piece_from_runtime(runtime));
            if active.attempt != runtime.attempt {
                *active = active_piece_from_runtime(runtime);
            } else {
                active.piece_length = runtime.piece_length;
                active.stage = active_stage_from_runtime(runtime);
                active.age_millis = runtime.age_millis.to_string();
                active.error = runtime.error.clone();
            }
        }
        self.active
            .retain(|piece_index, _| retained.contains(piece_index));
    }
}

impl DiskSessionModel {
    pub(super) fn update(&mut self, torrent_id: &str, snapshot: &DiskRuntimeSnapshot) {
        let (sample_millis, receive_rate_bytes, write_rate_bytes, hash_rate_bytes) = self
            .torrents
            .get(torrent_id)
            .and_then(|previous| {
                let elapsed = snapshot
                    .captured_at_millis
                    .checked_sub(previous.snapshot.captured_at_millis)?;
                (elapsed != 0).then(|| {
                    (
                        elapsed,
                        sampled_rate(
                            snapshot.received_bytes_total,
                            previous.snapshot.received_bytes_total,
                            elapsed,
                        ),
                        sampled_rate(
                            snapshot.stored_bytes_total,
                            previous.snapshot.stored_bytes_total,
                            elapsed,
                        ),
                        sampled_rate(
                            snapshot.verified_bytes_total,
                            previous.snapshot.verified_bytes_total,
                            elapsed,
                        ),
                    )
                })
            })
            .unwrap_or_default();
        self.torrents.insert(
            torrent_id.to_owned(),
            DiskTorrentRuntime {
                snapshot: snapshot.clone(),
                sample_millis,
                receive_rate_bytes,
                write_rate_bytes,
                hash_rate_bytes,
            },
        );
    }

    pub(super) fn retain(&mut self, torrent_ids: &BTreeSet<String>) {
        self.torrents
            .retain(|torrent_id, _| torrent_ids.contains(torrent_id));
    }

    pub(super) fn view(&self, torrents: &BTreeMap<String, TorrentModel>) -> DiskSessionView {
        let mut view = DiskSessionView::default();
        let mut pressure_rank = 0_u8;
        let mut checkpoint_rank = 0_u8;
        for (torrent_id, runtime) in &self.torrents {
            let snapshot = &runtime.snapshot;
            let rank = disk_pressure_rank(snapshot.pressure);
            if rank >= pressure_rank {
                pressure_rank = rank;
                view.pipeline.pressure = map_disk_pressure(snapshot.pressure);
            }
            let rank = disk_checkpoint_rank(snapshot.checkpoint_stage);
            if rank >= checkpoint_rank {
                checkpoint_rank = rank;
                view.pipeline.checkpoint_stage =
                    map_disk_checkpoint_stage(snapshot.checkpoint_stage);
            }
            view.pipeline.intake_backpressured |= snapshot.intake_backpressured;
            view.pipeline.sample_millis =
                max_decimal(&view.pipeline.sample_millis, runtime.sample_millis);
            add_decimal(
                &mut view.pipeline.resident_limit_bytes,
                usize_to_u64(snapshot.resident_limit_bytes),
            );
            add_decimal(
                &mut view.pipeline.resident_high_watermark_bytes,
                usize_to_u64(snapshot.resident_high_watermark_bytes),
            );
            add_decimal(
                &mut view.pipeline.resident_low_watermark_bytes,
                usize_to_u64(snapshot.resident_low_watermark_bytes),
            );
            add_decimal(
                &mut view.pipeline.requested_bytes,
                usize_to_u64(snapshot.requested_bytes),
            );
            add_decimal(
                &mut view.pipeline.resident_bytes,
                usize_to_u64(snapshot.resident_bytes),
            );
            add_decimal(
                &mut view.pipeline.queued_write_bytes,
                usize_to_u64(snapshot.queued_write_bytes),
            );
            add_decimal(
                &mut view.pipeline.writing_bytes,
                usize_to_u64(snapshot.writing_bytes),
            );
            add_decimal(
                &mut view.pipeline.hashing_bytes,
                usize_to_u64(snapshot.hashing_bytes),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_dirty_pieces,
                usize_to_u64(snapshot.checkpoint_dirty_pieces),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_dirty_bytes,
                usize_to_u64(snapshot.checkpoint_dirty_bytes),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_dirty_piece_high_water,
                usize_to_u64(snapshot.checkpoint_dirty_piece_high_water),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_dirty_byte_high_water,
                usize_to_u64(snapshot.checkpoint_dirty_byte_high_water),
            );
            view.pipeline.checkpoint_oldest_dirty_millis = max_decimal(
                &view.pipeline.checkpoint_oldest_dirty_millis,
                snapshot.checkpoint_oldest_dirty_millis,
            );
            add_decimal(
                &mut view.pipeline.checkpoint_batches_started,
                usize_to_u64(snapshot.checkpoint_batches_started),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_batches_completed,
                usize_to_u64(snapshot.checkpoint_batches_completed),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_pieces_completed,
                usize_to_u64(snapshot.checkpoint_pieces_completed),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_sync_operations_completed,
                usize_to_u64(snapshot.checkpoint_sync_operations_completed),
            );
            add_decimal(
                &mut view.pipeline.checkpoint_sync_service_micros,
                snapshot.checkpoint_sync_service_micros,
            );
            view.pipeline.checkpoint_sync_service_max_micros = max_decimal(
                &view.pipeline.checkpoint_sync_service_max_micros,
                snapshot.checkpoint_sync_service_max_micros,
            );
            add_decimal(
                &mut view.pipeline.checkpoint_commit_service_micros,
                snapshot.checkpoint_commit_service_micros,
            );
            view.pipeline.checkpoint_commit_service_max_micros = max_decimal(
                &view.pipeline.checkpoint_commit_service_max_micros,
                snapshot.checkpoint_commit_service_max_micros,
            );
            if let Some(active) = snapshot.checkpoint_active_micros {
                view.pipeline.checkpoint_active_micros = Some(max_decimal(
                    view.pipeline
                        .checkpoint_active_micros
                        .as_deref()
                        .unwrap_or("0"),
                    active,
                ));
            }
            add_decimal(
                &mut view.pipeline.storage_jobs_pending,
                usize_to_u64(snapshot.storage_jobs_pending),
            );
            add_decimal(
                &mut view.pipeline.received_bytes_total,
                usize_to_u64(snapshot.received_bytes_total),
            );
            add_decimal(
                &mut view.pipeline.stored_bytes_total,
                usize_to_u64(snapshot.stored_bytes_total),
            );
            add_decimal(
                &mut view.pipeline.verified_bytes_total,
                usize_to_u64(snapshot.verified_bytes_total),
            );
            add_decimal(
                &mut view.pipeline.receive_rate_bytes,
                runtime.receive_rate_bytes,
            );
            add_decimal(
                &mut view.pipeline.write_rate_bytes,
                runtime.write_rate_bytes,
            );
            add_decimal(&mut view.pipeline.hash_rate_bytes, runtime.hash_rate_bytes);
            add_decimal(
                &mut view.pipeline.write_operations_started,
                usize_to_u64(snapshot.write_operations_started),
            );
            add_decimal(
                &mut view.pipeline.write_operations_completed,
                usize_to_u64(snapshot.write_operations_completed),
            );
            add_decimal(
                &mut view.pipeline.hash_operations_started,
                usize_to_u64(snapshot.hash_operations_started),
            );
            add_decimal(
                &mut view.pipeline.hash_operations_completed,
                usize_to_u64(snapshot.hash_operations_completed),
            );
            add_decimal(
                &mut view.pipeline.write_queue_wait_micros,
                snapshot.write_queue_wait_micros,
            );
            view.pipeline.write_queue_wait_max_micros = max_decimal(
                &view.pipeline.write_queue_wait_max_micros,
                snapshot.write_queue_wait_max_micros,
            );
            add_decimal(
                &mut view.pipeline.write_service_micros,
                snapshot.write_service_micros,
            );
            view.pipeline.write_service_max_micros = max_decimal(
                &view.pipeline.write_service_max_micros,
                snapshot.write_service_max_micros,
            );
            add_decimal(
                &mut view.pipeline.hash_queue_wait_micros,
                snapshot.hash_queue_wait_micros,
            );
            view.pipeline.hash_queue_wait_max_micros = max_decimal(
                &view.pipeline.hash_queue_wait_max_micros,
                snapshot.hash_queue_wait_max_micros,
            );
            add_decimal(
                &mut view.pipeline.hash_service_micros,
                snapshot.hash_service_micros,
            );
            view.pipeline.hash_service_max_micros = max_decimal(
                &view.pipeline.hash_service_max_micros,
                snapshot.hash_service_max_micros,
            );
            add_decimal(
                &mut view.pipeline.pressure_transition_count,
                snapshot.pressure_transition_count,
            );
            add_decimal(
                &mut view.pipeline.backpressured_millis_total,
                snapshot.backpressured_millis_total,
            );
            if snapshot.last_error.is_some() {
                view.pipeline.last_error = snapshot.last_error.clone();
            }

            let torrent_name = torrents
                .get(torrent_id)
                .and_then(|torrent| torrent.view.display_name.clone())
                .unwrap_or_else(|| format!("Torrent {}", &torrent_id[..torrent_id.len().min(12)]));
            for piece in &snapshot.pieces {
                let row_id = format!("{torrent_id}:{}:{}", piece.piece_index, piece.attempt);
                view.pieces.insert(
                    row_id.clone(),
                    DiskPieceView {
                        row_id,
                        torrent_id: torrent_id.clone(),
                        torrent_name: torrent_name.clone(),
                        piece_index: piece.piece_index,
                        piece_length: piece.piece_length,
                        attempt: piece.attempt,
                        stage: map_disk_piece_stage(piece.stage),
                        requested_bytes: piece.requested_bytes.to_string(),
                        received_bytes: piece.received_bytes.to_string(),
                        stored_bytes: piece.stored_bytes.to_string(),
                        age_millis: piece.age_millis.to_string(),
                        stage_age_millis: piece.stage_age_millis.to_string(),
                        error: piece.error.clone(),
                    },
                );
            }
        }
        view
    }
}

fn sampled_rate(current: usize, previous: usize, elapsed_millis: u64) -> u64 {
    let bytes = current.saturating_sub(previous) as u128;
    let rate = bytes
        .saturating_mul(1_000)
        .checked_div(u128::from(elapsed_millis))
        .unwrap_or_default();
    u64::try_from(rate).unwrap_or(u64::MAX)
}

fn usize_to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

fn add_decimal(value: &mut String, amount: u64) {
    let current = value.parse::<u64>().unwrap_or_default();
    *value = current.saturating_add(amount).to_string();
}

fn max_decimal(value: &str, candidate: u64) -> String {
    value
        .parse::<u64>()
        .unwrap_or_default()
        .max(candidate)
        .to_string()
}

const fn disk_pressure_rank(pressure: DiskPressure) -> u8 {
    match pressure {
        DiskPressure::Idle => 0,
        DiskPressure::Normal => 1,
        DiskPressure::Draining => 2,
        DiskPressure::Backpressured => 3,
        DiskPressure::Error => 4,
    }
}

const fn disk_checkpoint_rank(stage: DiskCheckpointStage) -> u8 {
    match stage {
        DiskCheckpointStage::Idle => 0,
        DiskCheckpointStage::Syncing => 1,
        DiskCheckpointStage::Committing => 2,
        DiskCheckpointStage::Error => 3,
    }
}

const fn map_disk_pressure(pressure: DiskPressure) -> DiskPressureView {
    match pressure {
        DiskPressure::Idle => DiskPressureView::Idle,
        DiskPressure::Normal => DiskPressureView::Normal,
        DiskPressure::Backpressured => DiskPressureView::Backpressured,
        DiskPressure::Draining => DiskPressureView::Draining,
        DiskPressure::Error => DiskPressureView::Error,
    }
}

const fn map_disk_piece_stage(stage: DiskPieceStage) -> DiskPieceStageView {
    match stage {
        DiskPieceStage::Receiving => DiskPieceStageView::Receiving,
        DiskPieceStage::Queued => DiskPieceStageView::Queued,
        DiskPieceStage::Writing => DiskPieceStageView::Writing,
        DiskPieceStage::Stored => DiskPieceStageView::Stored,
        DiskPieceStage::Hashing => DiskPieceStageView::Hashing,
        DiskPieceStage::CheckpointDirty => DiskPieceStageView::CheckpointDirty,
        DiskPieceStage::CheckpointSyncing => DiskPieceStageView::CheckpointSyncing,
        DiskPieceStage::CheckpointCommitting => DiskPieceStageView::CheckpointCommitting,
        DiskPieceStage::Failed => DiskPieceStageView::Failed,
    }
}

const fn map_disk_checkpoint_stage(stage: DiskCheckpointStage) -> DiskCheckpointStageView {
    match stage {
        DiskCheckpointStage::Idle => DiskCheckpointStageView::Idle,
        DiskCheckpointStage::Syncing => DiskCheckpointStageView::Syncing,
        DiskCheckpointStage::Committing => DiskCheckpointStageView::Committing,
        DiskCheckpointStage::Error => DiskCheckpointStageView::Error,
    }
}

fn active_piece_id(piece_index: u32, attempt: u32) -> String {
    format!("{piece_index}:{attempt}")
}

fn active_piece_from_runtime(runtime: &DiskPieceRuntimeSnapshot) -> ActivePiece {
    ActivePiece {
        piece_id: active_piece_id(runtime.piece_index, runtime.attempt),
        piece_index: runtime.piece_index,
        attempt: runtime.attempt,
        piece_length: runtime.piece_length,
        stage: active_stage_from_runtime(runtime),
        requested: Vec::new(),
        received: Vec::new(),
        stored: Vec::new(),
        age_millis: runtime.age_millis.to_string(),
        error: runtime.error.clone(),
    }
}

fn add_counter(counter: &mut String, increment: u64) {
    let value = counter
        .parse::<u64>()
        .unwrap_or(0)
        .saturating_add(increment);
    *counter = value.to_string();
}

const fn active_stage_from_runtime(runtime: &DiskPieceRuntimeSnapshot) -> ActivePieceStageView {
    match runtime.stage {
        DiskPieceStage::Receiving => {
            if runtime.received_bytes > runtime.stored_bytes {
                ActivePieceStageView::Received
            } else {
                ActivePieceStageView::Requested
            }
        }
        DiskPieceStage::Queued | DiskPieceStage::Writing => ActivePieceStageView::Received,
        DiskPieceStage::Stored => ActivePieceStageView::Stored,
        DiskPieceStage::Hashing => ActivePieceStageView::Hashing,
        DiskPieceStage::CheckpointDirty => ActivePieceStageView::CheckpointDirty,
        DiskPieceStage::CheckpointSyncing => ActivePieceStageView::CheckpointSyncing,
        DiskPieceStage::CheckpointCommitting => ActivePieceStageView::CheckpointCommitting,
        DiskPieceStage::Failed => ActivePieceStageView::Failed,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TorrentActivity {
    PieceStarted {
        piece_index: u32,
        piece_length: u32,
        attempt: u32,
    },
    BlockRequested {
        piece_index: u32,
        begin: u32,
        length: u32,
    },
    BlockReceived {
        piece_index: u32,
        begin: u32,
        length: u32,
    },
    BlockStored {
        piece_index: u32,
        begin: u32,
        length: u32,
    },
    PieceVerified {
        piece_index: u32,
    },
    PieceHashFailed {
        piece_index: u32,
        failed_bytes: usize,
    },
    PieceHashing {
        piece_index: u32,
    },
}
