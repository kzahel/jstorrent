use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::error::Error;
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rstorrent_protocol::content::{
    ExpectedPieceIntegrity, HybridPaddingMap, TorrentContent, TorrentContentProjection,
    TorrentContentWithIntegrity, TorrentIntegrity, V2ExpectedPieceQuery,
};
use rstorrent_protocol::extension::{
    ExtensionAdvertisement, ExtensionHandshake, ExtensionMap, ExtensionUpdate, PexFlags,
    UT_PEX_LOCAL_ID, encode_extension_handshake as encode_recognized_extension_handshake,
    encode_extension_handshake_update,
    parse_extension_handshake as parse_recognized_extension_handshake,
};
use rstorrent_protocol::identity::{FullInfoHash, InfoHashes, SwarmKey};
#[cfg(test)]
use rstorrent_protocol::magnet::UdpTrackerUrl;
use rstorrent_protocol::magnet::{Magnet, MagnetError, PeerHint, TrackerUrl, TrackerUrlTransport};
use rstorrent_protocol::merkle::{MERKLE_BLOCK_SIZE, MerkleTreeShape, Sha256Hash};
use rstorrent_protocol::metadata::{
    MetadataError, MetadataExtensionUpdate, MetadataInstant, MetadataMessage,
    TorrentMetadataDownload, TorrentMetadataEvent, UT_METADATA_LOCAL_ID,
    encode_extension_handshake, encode_metadata_reject, encode_metadata_request,
    parse_extension_handshake, parse_metadata_message,
};
use rstorrent_protocol::metainfo::{
    BEP9_METAINFO_LIMITS, DURABLE_METAINFO_LIMITS, HybridMetainfo, MAX_METAINFO_PIECES, Metainfo,
    MetainfoError, ParsedInfo, ParsedInfoKind, V2Metainfo,
};
use rstorrent_protocol::peer_wire::{
    FrameError, Handshake, HandshakeError, NegotiatedPeerCapabilities, PeerMessage, PeerProtocol,
};
use rstorrent_protocol::piece::{PieceError, VerifiedPiece};
use rstorrent_protocol::storage_layout::{ContentLayout, FileSelection, LayoutError};
use rstorrent_protocol::udp_tracker::{MAX_COMPACT_PEERS, UdpTrackerError};
use rstorrent_protocol::v2_hashes::{HashExchangeError, V2FileHashGeometry};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::Instant as TokioInstant;
use tokio_util::sync::CancellationToken;

use crate::active_seed_content::{ActiveSeedContent, ActiveUploadFailureSignal};
use crate::dht::{DhtError, DhtHandle};
use crate::http_tracker::{HTTP_TRACKER_TIMEOUT, HttpTrackerClients, TrackerRetryDirective};
use crate::identity::{ContentFingerprint, TorrentIdentityContext};
use crate::incoming::{
    IncomingPeerHandle, SeedRegistration, SeedRegistrationToken, SessionUploadMembership,
    V2SeedHashService,
};
use crate::metrics::ByteMetric;
use crate::mse::MseDhWorkOwner;
#[cfg(test)]
use crate::network::DEFAULT_PEER_ID;
use crate::network::{
    NetworkConfig, NetworkPolicy, PeerEncryptionPolicyHandle, PeerExchangePolicyHandle,
};
use crate::peer::{
    DialAttempt, DialAttemptId, DialCandidate, DrySwarmProbeAdmission, DrySwarmProbeState,
    PeerEndpoint, PeerFailure, PeerIntegrityAction, PeerObservation, PeerRegistryCounts,
    PeerRegistryError, PeerSelectionContext, PeerSelector, PeerSource,
};
use crate::peer_budget::PeerBudget;
use crate::peer_runtime::{
    PeerAdmissionOutcome, PeerAdmissionRejection, PeerConnectionRole, PeerContentActivity,
    PeerRequestWindowPhase, PeerRuntimeError, connection_id,
};
use crate::peer_socket::{
    self, PeerConnection, PeerDialServices, PeerSetError, PeerSetEvent, PeerSocketError,
    PeerSocketSet, PeerTaskEvent,
};
use crate::pex::{PexError, PexReceiveContext, PexReceiveDisposition};
use crate::piece_availability::{
    AvailabilityCursor, AvailabilityDrain, AvailabilitySnapshot, MAX_AVAILABILITY_DRAIN,
    PieceAvailability,
};
use crate::piece_picker::picker_seed;
use crate::resume_validation::{
    ResumeAdmissionOutcome, ResumeStorageEvidence, ResumeValidationIntent,
    ResumeValidationRejectReason, decide_resume_admission,
};
use crate::selective_storage::{
    ComputedPieceHash, DescriptorStorage, ResumedStorage, SelectiveStorage, SelectiveStorageError,
    TorrentArtifactIdentity, VERIFICATION_CHUNK_LENGTH, validate_content_name,
};
use crate::streaming::{
    MAX_STREAMING_CANDIDATE_INSPECTIONS, StreamingCandidateCursor, StreamingDemandSnapshot,
};
use crate::swarm::{
    BlockKey, ConnectionId, ConnectionRemoval, ConnectionWindowPhaseSnapshot, PendingDialId,
    PieceHashFailure, PiecePlan, ReceiveDisposition, RejectDisposition, RequestAssignment,
    RequestCancellation, SwarmConfig, SwarmError, SwarmState,
};
use crate::torrent_peer::{
    INCOMING_CONTENT_EVENT_CAPACITY, IncomingContentCommand, IncomingContentEvent,
    IncomingPeerAttachment, TorrentPeerError, TorrentPeerHandle,
};
use crate::tracker::{
    TrackerAcceptedOutcome, TrackerAction, TrackerConfig, TrackerEndpoint,
    TrackerHttpsAuthentication, TrackerId, TrackerSchedule, TrackerWaitKind,
};
use crate::upload::{
    MAX_GENERATED_ALLOWED_FAST_PIECES, UploadAction, UploadCloseReason, UploadPeerState,
    UploadRead, generate_allowed_fast_set,
};
use crate::upload_scheduler::UploadGrant;
use crate::v2_hash_scheduler::{
    AuthenticatedPieces, HashNeedInput, HashRejectDisposition, HashResponseDisposition,
    V2HashScheduler,
};

mod control;
mod storage_pipeline;
mod tracker_operation;

#[cfg(test)]
pub(crate) use tracker_operation::announce_udp_tracker_address;
pub(crate) use tracker_operation::{
    TrackerAnnounceInput, TrackerAnnounceOutcome, TrackerOperationFailure, TrackerOperationSources,
    UdpTrackerTokenCache, execute_tracker_operation, random_nonzero_u32, redacted_tracker_label,
    resolve_host,
};
#[cfg(test)]
pub(crate) use tracker_operation::{
    UdpTrackerAnnounce, UdpTrackerExchange, UdpTrackerTiming, announce_udp_tracker,
};

#[cfg(test)]
const CLIENT_PEER_ID: [u8; 20] = DEFAULT_PEER_ID;

fn admission_rejection_failure(outcome: PeerAdmissionOutcome) -> Option<PeerFailure> {
    match outcome {
        PeerAdmissionOutcome::Admitted { .. } => None,
        PeerAdmissionOutcome::Rejected(PeerAdmissionRejection::SelfConnection) => {
            Some(PeerFailure::SelfConnection)
        }
        PeerAdmissionOutcome::Rejected(PeerAdmissionRejection::DuplicatePeerId { .. }) => {
            Some(PeerFailure::DuplicatePeerId)
        }
    }
}

const MAX_CONCURRENT_TRACKER_OPERATIONS: usize = 8;
const TRACKER_RESULT_QUEUE: usize = 4;
const TRACKER_COMMAND_QUEUE: usize = 1;
const DIRECT_TRACKER_FINISH_TIMEOUT: Duration = Duration::from_secs(5);
const CONTENT_DISCOVERY_QUEUE: usize = 8;
const UNKNOWN_MAGNET_LEFT: u64 = 16 * 1024;
const DHT_RETRY_INITIAL_DELAY: Duration = Duration::from_secs(15);
const DHT_RETRY_MAX_DELAY: Duration = Duration::from_secs(5 * 60);
const DHT_SUCCESS_REQUERY_DELAY: Duration = Duration::from_secs(60);
const CONTENT_SWARM_MAINTENANCE_INTERVAL: Duration = Duration::from_millis(100);
#[cfg(not(test))]
const V2_LEAF_DIAGNOSIS_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(test)]
const V2_LEAF_DIAGNOSIS_TIMEOUT: Duration = Duration::from_millis(250);
const METADATA_SCHEDULER_TICK: Duration = Duration::from_millis(100);
const MAX_ENGINE_PIECES: usize = MAX_METAINFO_PIECES;
const MAX_PLANNED_CONTENT_PIECES: usize = 256;

fn public_pex_extension_handshake() -> Vec<u8> {
    encode_recognized_extension_handshake(ExtensionAdvertisement {
        pex_id: Some(UT_PEX_LOCAL_ID),
        ..ExtensionAdvertisement::default()
    })
    .expect("the stable local PEX extension ID is valid")
}

fn pex_extension_update(enabled: bool) -> Vec<u8> {
    encode_extension_handshake_update(ExtensionHandshake {
        pex: if enabled {
            ExtensionUpdate::Enabled(UT_PEX_LOCAL_ID)
        } else {
            ExtensionUpdate::Disabled
        },
        ..ExtensionHandshake::default()
    })
    .expect("the stable local PEX extension update is valid")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MetadataConnectionLimits {
    pub max_peers: usize,
    pub max_attempts_per_second: u32,
    pub saturated_no_progress_grace: Duration,
}

impl MetadataConnectionLimits {
    pub const MAX_PEERS: usize = 200;
    pub const MAX_ATTEMPTS_PER_SECOND: u32 = 30;
    pub const MAX_SATURATED_NO_PROGRESS_GRACE: Duration = Duration::from_secs(60);
    pub const DEFAULT: Self = Self::new(30, 10);

    pub const fn new(max_peers: usize, max_attempts_per_second: u32) -> Self {
        Self {
            max_peers,
            max_attempts_per_second,
            saturated_no_progress_grace: Duration::from_secs(15),
        }
    }

    pub const fn with_saturated_no_progress_grace(mut self, grace: Duration) -> Self {
        self.saturated_no_progress_grace = grace;
        self
    }

    fn validate(self) -> Result<Self, DownloadError> {
        if self.max_peers == 0 {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata peer count must be nonzero",
            ));
        }
        if self.max_peers > Self::MAX_PEERS {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata peer count exceeds the hard ceiling",
            ));
        }
        if self.max_attempts_per_second == 0 {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata connection attempt rate must be nonzero",
            ));
        }
        if self.max_attempts_per_second > Self::MAX_ATTEMPTS_PER_SECOND {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata connection attempt rate exceeds the hard ceiling",
            ));
        }
        if self.saturated_no_progress_grace.is_zero() {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata saturated no-progress grace must be nonzero",
            ));
        }
        if self.saturated_no_progress_grace > Self::MAX_SATURATED_NO_PROGRESS_GRACE {
            return Err(DownloadError::InvalidResourceLimit(
                "metadata saturated no-progress grace exceeds the hard ceiling",
            ));
        }
        Ok(self)
    }
}

#[cfg(test)]
const MAX_METADATA_PEERS: usize = MetadataConnectionLimits::DEFAULT.max_peers;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MetadataDialPacer {
    interval: Duration,
    next_attempt_at: Duration,
}

impl MetadataDialPacer {
    fn new(max_attempts_per_second: u32) -> Self {
        debug_assert!(max_attempts_per_second > 0);
        let rate = u64::from(max_attempts_per_second.max(1));
        let interval_nanos = 1_000_000_000_u64.div_ceil(rate);
        Self {
            interval: Duration::from_nanos(interval_nanos),
            next_attempt_at: Duration::ZERO,
        }
    }

    fn is_ready(self, now: Duration) -> bool {
        now >= self.next_attempt_at
    }

    fn until_ready(self, now: Duration) -> Duration {
        self.next_attempt_at.saturating_sub(now)
    }

    fn record_attempt(&mut self, now: Duration) {
        self.next_attempt_at = now.saturating_add(self.interval);
    }
}

fn metadata_cohort_has_capacity(pending: usize, workers: usize, maximum: usize) -> bool {
    pending.saturating_add(workers) < maximum
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MetadataWorkerTurnoverState<Id> {
    attempt_id: Id,
    connected_at: Duration,
    turnover_requested: bool,
    contributed: bool,
}

fn select_metadata_turnover_candidate<Id: Copy + Ord>(
    workers: impl IntoIterator<Item = MetadataWorkerTurnoverState<Id>>,
    now: Duration,
    grace: Duration,
) -> Option<Id> {
    workers
        .into_iter()
        .filter(|worker| {
            !worker.turnover_requested
                && !worker.contributed
                && now.saturating_sub(worker.connected_at) >= grace
        })
        .min_by_key(|worker| (worker.connected_at, worker.attempt_id))
        .map(|worker| worker.attempt_id)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DownloadResourceLimits {
    pub max_outstanding_request_bytes: usize,
    pub max_buffered_payload_bytes: usize,
    pub storage_intake_high_watermark_bytes: usize,
    pub max_active_piece_bytes: usize,
    pub max_active_pieces: usize,
    pub metadata_connections: MetadataConnectionLimits,
}

impl DownloadResourceLimits {
    pub const DESKTOP: Self = Self {
        max_outstanding_request_bytes: 256 * 1024 * 1024,
        max_buffered_payload_bytes: 32 * 1024 * 1024,
        storage_intake_high_watermark_bytes: 1024 * 1024,
        max_active_piece_bytes: 256 * 1024 * 1024,
        max_active_pieces: crate::swarm::DEFAULT_MAX_ACTIVE_PIECES,
        metadata_connections: MetadataConnectionLimits::DEFAULT,
    };

    pub const ANDROID: Self = Self {
        max_outstanding_request_bytes: 128 * 1024 * 1024,
        max_buffered_payload_bytes: 16 * 1024 * 1024,
        storage_intake_high_watermark_bytes: 1024 * 1024,
        max_active_piece_bytes: 128 * 1024 * 1024,
        max_active_pieces: crate::swarm::DEFAULT_MAX_ACTIVE_PIECES,
        metadata_connections: MetadataConnectionLimits::DEFAULT,
    };

    pub const fn new(
        max_outstanding_request_bytes: usize,
        max_buffered_payload_bytes: usize,
        max_active_piece_bytes: usize,
    ) -> Self {
        Self {
            max_outstanding_request_bytes,
            max_buffered_payload_bytes,
            storage_intake_high_watermark_bytes: Self::default_storage_intake_high_watermark(
                max_buffered_payload_bytes,
            ),
            max_active_piece_bytes,
            max_active_pieces: crate::swarm::DEFAULT_MAX_ACTIVE_PIECES,
            metadata_connections: MetadataConnectionLimits::DEFAULT,
        }
    }

    pub const fn default_storage_intake_high_watermark(max_buffered_payload_bytes: usize) -> usize {
        if max_buffered_payload_bytes < 1024 * 1024 {
            max_buffered_payload_bytes
        } else {
            1024 * 1024
        }
    }

    fn validate(self) -> Result<Self, DownloadError> {
        if self.max_outstanding_request_bytes < rstorrent_protocol::piece::MIN_PAYLOAD_ALLOWANCE {
            return Err(DownloadError::InvalidResourceLimit(
                "outstanding request allowance must fit one request block",
            ));
        }
        if self.max_buffered_payload_bytes < rstorrent_protocol::piece::MIN_PAYLOAD_ALLOWANCE {
            return Err(DownloadError::InvalidResourceLimit(
                "buffered payload allowance must fit one request block",
            ));
        }
        if self.storage_intake_high_watermark_bytes
            < rstorrent_protocol::piece::MIN_PAYLOAD_ALLOWANCE
        {
            return Err(DownloadError::InvalidResourceLimit(
                "storage intake high watermark must fit one request block",
            ));
        }
        if self.storage_intake_high_watermark_bytes > self.max_buffered_payload_bytes {
            return Err(DownloadError::InvalidResourceLimit(
                "storage intake high watermark must not exceed the buffered payload allowance",
            ));
        }
        if self.max_active_piece_bytes < rstorrent_protocol::piece::MIN_PAYLOAD_ALLOWANCE {
            return Err(DownloadError::InvalidResourceLimit(
                "active piece working set must fit one request block",
            ));
        }
        if self.max_active_pieces == 0 {
            return Err(DownloadError::InvalidResourceLimit(
                "active piece count must be nonzero",
            ));
        }
        self.metadata_connections.validate()?;
        Ok(self)
    }

    fn swarm_config(self) -> SwarmConfig {
        let mut config = SwarmConfig::for_request_limit(self.max_outstanding_request_bytes);
        config.max_active_piece_bytes = self.max_active_piece_bytes;
        config.max_active_pieces = self.max_active_pieces;
        config
    }
}

#[derive(Clone, Debug)]
pub struct DownloadConfig {
    pub identity: TorrentIdentityContext,
    pub metainfo_path: PathBuf,
    pub peer: SocketAddr,
    pub output_path: PathBuf,
    pub network: NetworkConfig,
    pub resource_limits: DownloadResourceLimits,
    pub skip_files: Vec<usize>,
    pub high_priority_files: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct MagnetDownloadConfig {
    pub identity: TorrentIdentityContext,
    pub magnet: String,
    pub output_path: PathBuf,
    pub network: NetworkConfig,
    pub resource_limits: DownloadResourceLimits,
    pub skip_files: Vec<usize>,
    pub high_priority_files: Vec<usize>,
    pub dht: Option<DhtHandle>,
}

#[derive(Clone, Debug)]
pub struct ResumableMagnetDownloadConfig {
    pub identity: TorrentIdentityContext,
    pub magnet: String,
    /// Selected containing directory for direct metainfo-derived content.
    pub storage_root: PathBuf,
    pub network: NetworkConfig,
    /// Session-wide connection ownership shared with the incoming listener.
    pub peer_budget: PeerBudget,
    /// Session-wide owner for bounded MSE Diffie-Hellman work.
    pub mse_dh: MseDhWorkOwner,
    /// Live session policy sampled when each future handshake starts.
    pub encryption: PeerEncryptionPolicyHandle,
    /// Live session-wide BEP 11 participation policy.
    pub peer_exchange: PeerExchangePolicyHandle,
    /// Long-lived per-torrent peer state supplied by the application session.
    /// Diagnostic and standalone callers leave this unset.
    pub torrent_peers: Option<TorrentPeerHandle>,
    pub resource_limits: DownloadResourceLimits,
    pub skip_files: Vec<usize>,
    pub high_priority_files: Vec<usize>,
    pub verified_info: Option<Vec<u8>>,
    pub verified_pieces: Vec<bool>,
    pub resume_validation: ResumeValidationIntent,
    pub download_missing: bool,
    pub dht: Option<DhtHandle>,
    /// Authoritative operational tracker catalog. `None` uses the
    /// independently bounded UDP and HTTP(S) trackers parsed from the magnet URI.
    pub trackers: Option<Vec<TrackerConfig>>,
}

#[derive(Clone, Debug)]
pub struct ResumableMetainfoDownloadConfig {
    pub identity: TorrentIdentityContext,
    /// Exact complete outer metainfo source retained by byte intake.
    pub metainfo_source: Vec<u8>,
    /// Selected containing directory for direct metainfo-derived content.
    pub storage_root: PathBuf,
    pub network: NetworkConfig,
    pub peer_budget: PeerBudget,
    pub mse_dh: MseDhWorkOwner,
    pub encryption: PeerEncryptionPolicyHandle,
    pub peer_exchange: PeerExchangePolicyHandle,
    pub torrent_peers: Option<TorrentPeerHandle>,
    pub resource_limits: DownloadResourceLimits,
    pub skip_files: Vec<usize>,
    pub high_priority_files: Vec<usize>,
    pub verified_pieces: Vec<bool>,
    pub resume_validation: ResumeValidationIntent,
    pub download_missing: bool,
    pub dht: Option<DhtHandle>,
    pub trackers: Option<Vec<TrackerConfig>>,
}

#[derive(Clone, Debug)]
pub struct ExternalMagnetMetadataDownloadConfig {
    pub identity: TorrentIdentityContext,
    pub magnet: String,
    pub network: NetworkConfig,
    pub peer_budget: PeerBudget,
    pub mse_dh: MseDhWorkOwner,
    pub encryption: PeerEncryptionPolicyHandle,
    pub peer_exchange: PeerExchangePolicyHandle,
    pub torrent_peers: TorrentPeerHandle,
    pub resource_limits: DownloadResourceLimits,
}

struct MagnetMetadataRuntimeConfig {
    identity: TorrentIdentityContext,
    magnet: String,
    network: NetworkConfig,
    connections: MetadataConnectionLimits,
}

pub trait DownloadCheckpointSink: Send + Sync {
    fn metadata_verified(&self, raw_info: &[u8]) -> Result<(), String>;
    /// The durable owner may resolve pending selection/policy while accepting
    /// metadata. Read it before constructing storage, retaining the peer.
    fn metadata_file_selection(&self) -> Result<Option<FileSelectionUpdate>, String> {
        Ok(None)
    }
    fn storage_prepared(&self, storage: ResumedStorage) -> Result<(), String>;
    fn storage_discovered(
        &self,
        storage: ResumedStorage,
        _expected_files: usize,
        _present_files: usize,
        _oversized_files: usize,
    ) -> Result<u64, String> {
        self.storage_prepared(storage)?;
        self.recheck_started()
    }
    fn recheck_started(&self) -> Result<u64, String>;
    fn have_rechecked(&self, verified_pieces: &[bool]) -> Result<(), String>;
    fn pieces_invalidated(&self, piece_indices: &[usize]) -> Result<(), String>;
    fn pieces_durable(&self, piece_indices: &[usize]) -> Result<(), String>;
    fn piece_durable(&self, piece_index: usize) -> Result<(), String> {
        self.pieces_durable(&[piece_index])
    }
}

#[derive(Clone, Debug)]
struct ContentDownloadConfig {
    artifact_identity: TorrentArtifactIdentity,
    output_path: PathBuf,
    max_buffered_payload_bytes: usize,
    storage_intake_high_watermark_bytes: usize,
    swarm_config: SwarmConfig,
    skip_files: Vec<usize>,
    high_priority_files: Vec<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ContentStorageLimits {
    resident_payload_bytes: usize,
    intake_high_watermark_bytes: usize,
}

#[derive(Debug, Default)]
struct ContentRequestSchedule {
    assignments: Vec<RequestAssignment>,
    cancellations: Vec<RequestCancellation>,
}

#[cfg(test)]
use control::{
    CONTENT_STORAGE_HASH_CONCURRENCY, CONTENT_STORAGE_WRITE_CONCURRENCY,
    MAX_DIAGNOSTIC_ERROR_LENGTH, MAX_RECENT_METADATA_ATTEMPTS, atomic_saturating_add,
    atomic_saturating_increment,
};
pub use control::{
    CheckerPhase, CheckerProgress, ContentPeerActivitySnapshot, ContentRequestWindowPhase,
    DiscoveryLaneOperation, DiscoveryLanePhase, DiskCheckpointStage, DiskPieceRuntimeSnapshot,
    DiskPieceStage, DiskPressure, DiskRuntimeSnapshot, DownloadActivityEvent, DownloadActivitySink,
    DownloadControl, DownloadDiagnosticSnapshot, DownloadProgress, FileSelectionUpdate,
    IntegrityPreparationPhase, IntegrityPreparationProgress, MetadataAcquisitionPhase,
    MetadataAcquisitionProgress, MetadataAcquisitionSnapshot, MetadataPeerSnapshot,
    MetadataPeerStage, StreamingDemandLease, SwarmActivitySnapshot,
};
use control::{CheckerPieceOutcome, StorageCommandKind};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadReport {
    pub info_hash: [u8; 20],
    pub piece_hash: [u8; 20],
    pub bytes_written: usize,
    pub block_count: usize,
    pub payload_limit: usize,
    pub payload_high_water: usize,
    pub outstanding_request_limit: usize,
    pub outstanding_request_high_water: usize,
    pub active_piece_limit: usize,
    pub verification_buffer: usize,
    pub piece_count: usize,
    pub verified_piece_count: usize,
    pub skipped_piece_count: usize,
    pub selected_file_bytes: u64,
    pub skipped_file_bytes: u64,
    pub padding_bytes: u64,
    pub selected_written_bytes: usize,
    pub part_written_bytes: usize,
    pub part_slots: usize,
    pub part_reopened: bool,
    pub part_path: Option<PathBuf>,
}

#[derive(Debug)]
pub enum DownloadError {
    NetworkDisabled,
    NetworkPolicyDenied {
        address: SocketAddr,
        policy: NetworkPolicy,
    },
    InvalidNetworkTimeout {
        operation: &'static str,
    },
    InvalidResourceLimit(&'static str),
    InvalidTorrentIdentity(&'static str),
    InconsistentHybridHashes {
        piece: u32,
        v1_matched: bool,
        v2_matched: bool,
    },
    MetainfoTooLarge {
        maximum: usize,
    },
    Io {
        operation: &'static str,
        source: io::Error,
    },
    Metainfo(MetainfoError),
    Magnet(MagnetError),
    Entropy(getrandom::Error),
    Dht(DhtError),
    UdpTracker(UdpTrackerError),
    PeerRegistry(PeerRegistryError),
    PeerRuntime(PeerRuntimeError),
    Pex(PexError),
    PeerTask(String),
    StorageTask(String),
    Swarm(SwarmError),
    Metadata(MetadataError),
    Handshake(HandshakeError),
    Frame(FrameError),
    Piece(PieceError),
    Layout(LayoutError),
    SelectiveStorage(SelectiveStorageError),
    PeerClosed,
    NoUsablePeer,
    NoUsableTrackerAddress,
    UdpTrackerResponseTooLarge {
        maximum: usize,
    },
    UdpTrackerTimedOut {
        operation: &'static str,
        timeout: Duration,
    },
    ExtensionProtocolUnsupported,
    MetadataExtensionDisabled,
    InvalidPremetadataState(&'static str),
    Checkpoint(String),
    Cancelled,
    PeerTimedOut {
        operation: &'static str,
        timeout: Duration,
    },
    NetworkTimedOut {
        operation: &'static str,
        timeout: Duration,
    },
    TrackerTask(String),
    PeerCleanup {
        failure: String,
        cleanup: String,
    },
}

impl fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NetworkDisabled => write!(formatter, "outbound networking is disabled"),
            Self::NetworkPolicyDenied { address, policy } => {
                write!(
                    formatter,
                    "outbound address {address} is denied by network policy {policy}"
                )
            }
            Self::InvalidNetworkTimeout { operation } => {
                write!(formatter, "{operation} timeout must be nonzero")
            }
            Self::InvalidResourceLimit(message) => formatter.write_str(message),
            Self::InvalidTorrentIdentity(message) => {
                write!(formatter, "invalid torrent identity context: {message}")
            }
            Self::InconsistentHybridHashes {
                piece,
                v1_matched,
                v2_matched,
            } => write!(
                formatter,
                "hybrid piece {piece} has inconsistent integrity results (v1={v1_matched}, v2={v2_matched})"
            ),
            Self::MetainfoTooLarge { maximum } => {
                write!(formatter, "metainfo exceeds input limit {maximum}")
            }
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
            Self::Metainfo(error) => write!(formatter, "metainfo: {error}"),
            Self::Magnet(error) => write!(formatter, "magnet: {error}"),
            Self::Entropy(error) => write!(formatter, "operating-system randomness: {error}"),
            Self::Dht(error) => write!(formatter, "DHT: {error}"),
            Self::UdpTracker(error) => write!(formatter, "UDP tracker: {error}"),
            Self::PeerRegistry(error) => write!(formatter, "peer registry: {error}"),
            Self::PeerRuntime(error) => write!(formatter, "peer runtime: {error}"),
            Self::Pex(error) => write!(formatter, "peer exchange: {error}"),
            Self::PeerTask(error) => write!(formatter, "peer task set: {error}"),
            Self::StorageTask(error) => write!(formatter, "content storage task: {error}"),
            Self::Swarm(error) => write!(formatter, "swarm state: {error}"),
            Self::Metadata(error) => write!(formatter, "metadata: {error}"),
            Self::Handshake(error) => write!(formatter, "peer handshake: {error}"),
            Self::Frame(error) => write!(formatter, "peer frame: {error}"),
            Self::Piece(error) => write!(formatter, "piece state: {error}"),
            Self::Layout(error) => write!(formatter, "torrent layout: {error}"),
            Self::SelectiveStorage(error) => write!(formatter, "selective storage: {error}"),
            Self::PeerClosed => write!(formatter, "peer closed before piece verification"),
            Self::NoUsablePeer => {
                write!(formatter, "magnet discovery produced no eligible peer")
            }
            Self::NoUsableTrackerAddress => {
                write!(
                    formatter,
                    "UDP tracker has no resolvable address allowed by network policy"
                )
            }
            Self::UdpTrackerResponseTooLarge { maximum } => {
                write!(
                    formatter,
                    "UDP tracker response exceeds the {maximum}-byte limit"
                )
            }
            Self::UdpTrackerTimedOut { operation, timeout } => {
                write!(
                    formatter,
                    "UDP tracker {operation} timed out after {}s",
                    timeout.as_secs()
                )
            }
            Self::ExtensionProtocolUnsupported => {
                write!(formatter, "peer does not advertise the extension protocol")
            }
            Self::MetadataExtensionDisabled => {
                write!(
                    formatter,
                    "peer does not advertise an enabled ut_metadata extension"
                )
            }
            Self::InvalidPremetadataState(reason) => {
                write!(
                    formatter,
                    "peer sent invalid state before metadata: {reason}"
                )
            }
            Self::Checkpoint(message) => write!(formatter, "durable checkpoint: {message}"),
            Self::Cancelled => write!(formatter, "download cancelled"),
            Self::PeerTimedOut { operation, timeout } => {
                write!(
                    formatter,
                    "peer {operation} timed out after {}s",
                    timeout.as_secs()
                )
            }
            Self::NetworkTimedOut { operation, timeout } => {
                write!(
                    formatter,
                    "{operation} timed out after {}s",
                    timeout.as_secs()
                )
            }
            Self::TrackerTask(message) => write!(formatter, "tracker task: {message}"),
            Self::PeerCleanup { failure, cleanup } => {
                write!(
                    formatter,
                    "{failure}; additionally failed to stop peer tasks: {cleanup}"
                )
            }
        }
    }
}

impl Error for DownloadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Metainfo(error) => Some(error),
            Self::Magnet(error) => Some(error),
            Self::Dht(error) => Some(error),
            Self::UdpTracker(error) => Some(error),
            Self::PeerRegistry(error) => Some(error),
            Self::PeerRuntime(error) => Some(error),
            Self::Pex(error) => Some(error),
            Self::Swarm(error) => Some(error),
            Self::Metadata(error) => Some(error),
            Self::Handshake(error) => Some(error),
            Self::Frame(error) => Some(error),
            Self::Piece(error) => Some(error),
            Self::Layout(error) => Some(error),
            Self::SelectiveStorage(error) => Some(error),
            _ => None,
        }
    }
}

impl DownloadError {
    pub fn is_existing_artifact(&self) -> bool {
        preserves_existing_artifact(self)
    }
}

fn map_torrent_peer_error(error: TorrentPeerError) -> DownloadError {
    match error {
        TorrentPeerError::Registry(error) => DownloadError::PeerRegistry(error),
        TorrentPeerError::Runtime(error) => DownloadError::PeerRuntime(error),
        TorrentPeerError::Pex(error) => DownloadError::Pex(error),
        TorrentPeerError::AddressFamilyDenied(_) => DownloadError::NoUsablePeer,
        TorrentPeerError::ConnectionIdentifierOverflow => {
            DownloadError::PeerRegistry(PeerRegistryError::IdentifierOverflow("peer connection"))
        }
    }
}

pub async fn download_verified_piece(
    config: DownloadConfig,
) -> Result<DownloadReport, DownloadError> {
    download_verified_piece_with_control(config, DownloadControl::new()).await
}

pub async fn download_magnet(
    config: MagnetDownloadConfig,
) -> Result<DownloadReport, DownloadError> {
    download_magnet_with_control(config, DownloadControl::new()).await
}

pub async fn resume_magnet(
    config: ResumableMagnetDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
) -> Result<DownloadReport, DownloadError> {
    resume_magnet_with_control(config, checkpoints, DownloadControl::new()).await
}

pub async fn resume_magnet_with_control(
    config: ResumableMagnetDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    resume_magnet_owned(config, checkpoints, control, None).await
}

pub async fn resume_metainfo_with_control(
    config: ResumableMetainfoDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    validate_network_config(config.network)?;
    config.resource_limits.validate()?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_resumable_metainfo_download(config, checkpoints, control.clone()).await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
pub async fn resume_magnet_to_descriptors_with_control(
    config: ResumableMagnetDownloadConfig,
    descriptors: DescriptorStorage,
    initialize_storage: bool,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    if config.verified_info.is_none() {
        return Err(DownloadError::Checkpoint(
            "descriptor storage requires verified metadata".to_owned(),
        ));
    }
    resume_magnet_owned(
        config,
        checkpoints,
        control,
        Some((descriptors, initialize_storage)),
    )
    .await
}

async fn resume_magnet_owned(
    config: ResumableMagnetDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
    descriptors: Option<(DescriptorStorage, bool)>,
) -> Result<DownloadReport, DownloadError> {
    validate_resumable_magnet_download_config(&config)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result =
        run_resumable_magnet_download(config, checkpoints, control.clone(), descriptors).await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

pub async fn download_magnet_metadata_with_control(
    identity: TorrentIdentityContext,
    magnet: String,
    network: NetworkConfig,
    control: DownloadControl,
) -> Result<Vec<u8>, DownloadError> {
    download_magnet_metadata_with_dht(
        identity,
        magnet,
        network,
        control,
        None,
        PeerBudget::system_default(),
    )
    .await
}

pub async fn download_magnet_metadata_with_dht(
    identity: TorrentIdentityContext,
    magnet: String,
    network: NetworkConfig,
    control: DownloadControl,
    dht: Option<DhtHandle>,
    peer_budget: PeerBudget,
) -> Result<Vec<u8>, DownloadError> {
    download_magnet_metadata_with_dht_and_peers(
        identity,
        magnet,
        network,
        control,
        dht,
        peer_budget,
        None,
    )
    .await
}

pub async fn download_magnet_metadata_with_dht_and_peers(
    identity: TorrentIdentityContext,
    magnet: String,
    network: NetworkConfig,
    control: DownloadControl,
    dht: Option<DhtHandle>,
    peer_budget: PeerBudget,
    torrent_peers: Option<TorrentPeerHandle>,
) -> Result<Vec<u8>, DownloadError> {
    validate_network_config(network)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_magnet_metadata(
        MagnetMetadataRuntimeConfig {
            identity,
            magnet,
            network,
            connections: DownloadResourceLimits::DESKTOP.metadata_connections,
        },
        control.clone(),
        dht,
        None,
        TorrentPeerResources {
            peer_budget,
            torrent_peers,
            mse_dh: MseDhWorkOwner::new(),
            encryption: PeerEncryptionPolicyHandle::new(network.encryption),
            peer_exchange: PeerExchangePolicyHandle::new(network.peer_exchange),
        },
    )
    .await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

pub async fn download_magnet_metadata_with_external_discovery(
    config: ExternalMagnetMetadataDownloadConfig,
    control: DownloadControl,
) -> Result<Vec<u8>, DownloadError> {
    validate_network_config(config.network)?;
    config.resource_limits.validate()?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_magnet_metadata(
        MagnetMetadataRuntimeConfig {
            identity: config.identity,
            magnet: config.magnet,
            network: config.network,
            connections: config.resource_limits.metadata_connections,
        },
        control.clone(),
        None,
        Some(Vec::new()),
        TorrentPeerResources {
            peer_budget: config.peer_budget,
            torrent_peers: Some(config.torrent_peers),
            mse_dh: config.mse_dh,
            encryption: config.encryption,
            peer_exchange: config.peer_exchange,
        },
    )
    .await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

pub async fn download_magnet_with_control(
    config: MagnetDownloadConfig,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    validate_magnet_download_config(&config)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_magnet_download(config, control.clone()).await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

pub async fn download_verified_piece_with_control(
    config: DownloadConfig,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    validate_download_config(&config)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }

    let result = run_download(config, control.clone(), None, None).await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();

    result
}

#[doc(hidden)]
pub async fn download_verified_piece_with_peer_state(
    config: DownloadConfig,
    control: DownloadControl,
    peer_budget: PeerBudget,
    torrent_peers: TorrentPeerHandle,
) -> Result<DownloadReport, DownloadError> {
    validate_download_config(&config)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_download(
        config,
        control.clone(),
        None,
        Some((peer_budget, torrent_peers)),
    )
    .await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
pub async fn download_verified_piece_to_descriptors_with_control(
    config: DownloadConfig,
    descriptors: DescriptorStorage,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    validate_download_config(&config)?;
    if control.is_cancelled() {
        return Err(DownloadError::Cancelled);
    }
    let result = run_download(config, control.clone(), Some(descriptors), None).await;
    let result = require_terminal_owner_cleanup(&control, result);
    control.clear_buffered_payload();
    result
}

fn require_terminal_owner_cleanup<T>(
    control: &DownloadControl,
    result: Result<T, DownloadError>,
) -> Result<T, DownloadError> {
    let diagnostics = control.diagnostic_snapshot();
    let progress = diagnostics.progress;
    let mut active = Vec::new();
    if !diagnostics.peer_connections.is_empty() {
        active.push(format!(
            "{} peer connection(s)",
            diagnostics.peer_connections.len()
        ));
    }
    if diagnostics.metadata.pending_dials != 0 {
        active.push(format!(
            "{} metadata dial(s)",
            diagnostics.metadata.pending_dials
        ));
    }
    if diagnostics.metadata.active_workers != 0 {
        active.push(format!(
            "{} metadata worker(s)",
            diagnostics.metadata.active_workers
        ));
    }
    if progress.storage_jobs_pending != 0 {
        active.push(format!("{} storage job(s)", progress.storage_jobs_pending));
    }
    if progress.outstanding_request_bytes != 0 {
        active.push(format!(
            "{} outstanding request byte(s)",
            progress.outstanding_request_bytes
        ));
    }
    if progress.buffered_payload_bytes != 0 {
        active.push(format!(
            "{} buffered payload byte(s)",
            progress.buffered_payload_bytes
        ));
    }
    if active.is_empty() {
        return result;
    }

    let cleanup = format!(
        "download operation returned with active owners: {}",
        active.join(", ")
    );
    match result {
        Ok(_) => Err(DownloadError::PeerCleanup {
            failure: "download operation completed before owner cleanup".to_owned(),
            cleanup,
        }),
        Err(error) => Err(DownloadError::PeerCleanup {
            failure: error.to_string(),
            cleanup,
        }),
    }
}

fn validate_download_config(config: &DownloadConfig) -> Result<(), DownloadError> {
    validate_network_config(config.network)?;
    config.resource_limits.validate()?;
    if matches!(config.network.policy, NetworkPolicy::Offline) {
        return Err(DownloadError::NetworkDisabled);
    }
    if !config.network.policy.allows(config.peer) {
        return Err(DownloadError::NetworkPolicyDenied {
            address: config.peer,
            policy: config.network.policy,
        });
    }
    Ok(())
}

fn validate_magnet_download_config(config: &MagnetDownloadConfig) -> Result<(), DownloadError> {
    validate_network_config(config.network)?;
    config.resource_limits.validate()?;
    Ok(())
}

fn validate_resumable_magnet_download_config(
    config: &ResumableMagnetDownloadConfig,
) -> Result<(), DownloadError> {
    validate_network_config(config.network)?;
    config.resource_limits.validate()?;
    Ok(())
}

fn validate_network_config(config: NetworkConfig) -> Result<(), DownloadError> {
    if config.peer_connect_timeout.is_zero() {
        return Err(DownloadError::InvalidNetworkTimeout {
            operation: "peer connect",
        });
    }
    if config.utp_fallback_timeout.is_zero() {
        return Err(DownloadError::InvalidNetworkTimeout {
            operation: "uTP fallback",
        });
    }
    if config.outgoing_handshake_timeout.is_zero() {
        return Err(DownloadError::InvalidNetworkTimeout {
            operation: "outgoing handshake",
        });
    }
    if config.peer_io_timeout.is_zero() {
        return Err(DownloadError::InvalidNetworkTimeout {
            operation: "peer I/O",
        });
    }
    Ok(())
}

fn validate_v1_runtime_identity(
    identity: TorrentIdentityContext,
    expected: [u8; 20],
) -> Result<(), DownloadError> {
    match identity.swarm_key() {
        SwarmKey::V1(hash)
            if hash.into_bytes() == expected && identity.info_hashes().v1_hash() == Some(hash) =>
        {
            Ok(())
        }
        SwarmKey::V1(_) => Err(DownloadError::InvalidTorrentIdentity(
            "selected v1 key does not match the metainfo or magnet",
        )),
        SwarmKey::V2Truncated(_) => Err(DownloadError::InvalidTorrentIdentity(
            "v2 wire operation is not implemented",
        )),
    }
}

fn validate_magnet_runtime_identity(
    identity: TorrentIdentityContext,
    expected: FullInfoHash,
) -> Result<(), DownloadError> {
    if !identity.info_hashes().contains(expected) {
        return Err(DownloadError::InvalidTorrentIdentity(
            "full identity does not match the magnet",
        ));
    }
    if identity.swarm_key() != expected.swarm_key() {
        return Err(DownloadError::InvalidTorrentIdentity(
            "selected wire key does not match the magnet",
        ));
    }
    Ok(())
}

fn metadata_matches_known_identities(parsed: InfoHashes, known: InfoHashes) -> bool {
    let mut matched = true;
    known.for_each(|identity| matched &= parsed.contains(identity));
    matched
}

fn validate_content_runtime_identity(
    identity: TorrentIdentityContext,
    content: &TorrentContent,
) -> Result<(), DownloadError> {
    let mut known_matches = true;
    identity
        .info_hashes()
        .for_each(|hash| known_matches &= content.info_hashes().contains(hash));
    if !known_matches {
        return Err(DownloadError::InvalidTorrentIdentity(
            "full identity set does not match complete metainfo",
        ));
    }
    if !content
        .swarm_keys()
        .any(|swarm_key| swarm_key == identity.swarm_key())
    {
        return Err(DownloadError::InvalidTorrentIdentity(
            "selected wire key does not match complete metainfo",
        ));
    }
    Ok(())
}

fn preserves_existing_artifact(error: &DownloadError) -> bool {
    matches!(
        error,
        DownloadError::SelectiveStorage(SelectiveStorageError::ExistingPartFile(_))
            | DownloadError::SelectiveStorage(SelectiveStorageError::PartFile(
                crate::part_file::PartFileError::Existing(_)
            ))
    )
}

#[derive(Debug)]
struct PremetadataPeerState {
    fast_extension: bool,
    initial_availability_received: bool,
    choking: bool,
    bitfield: Option<Vec<u8>>,
    have_all: bool,
    have_none: bool,
    haves: Vec<u8>,
    fast_advisories: VecDeque<PeerMessage>,
}

impl PremetadataPeerState {
    fn new(fast_extension: bool) -> Self {
        Self {
            fast_extension,
            initial_availability_received: false,
            choking: true,
            bitfield: None,
            have_all: false,
            have_none: false,
            haves: Vec::new(),
            fast_advisories: VecDeque::new(),
        }
    }

    fn observe(&mut self, message: PeerMessage) -> Result<(), DownloadError> {
        let fast_message = matches!(
            message,
            PeerMessage::SuggestPiece(_)
                | PeerMessage::HaveAll
                | PeerMessage::HaveNone
                | PeerMessage::RejectRequest(_)
                | PeerMessage::AllowedFast(_)
        );
        if fast_message && !self.fast_extension {
            return Err(DownloadError::InvalidPremetadataState(
                "Fast message arrived without negotiated support",
            ));
        }
        if self.fast_extension {
            let initial = matches!(
                message,
                PeerMessage::Bitfield(_) | PeerMessage::HaveAll | PeerMessage::HaveNone
            );
            if !self.initial_availability_received && !initial {
                return Err(DownloadError::InvalidPremetadataState(
                    "Fast initial availability is missing",
                ));
            }
            if self.initial_availability_received && initial {
                return Err(DownloadError::InvalidPremetadataState(
                    "Fast initial availability was repeated",
                ));
            }
            if initial {
                self.initial_availability_received = true;
            }
        }
        match message {
            PeerMessage::KeepAlive | PeerMessage::Interested | PeerMessage::NotInterested => {}
            PeerMessage::Choke => self.choking = true,
            PeerMessage::Unchoke => self.choking = false,
            PeerMessage::Have(index) => {
                let index = usize::try_from(index).map_err(|_| {
                    DownloadError::InvalidPremetadataState("HAVE index does not fit usize")
                })?;
                if index >= MAX_ENGINE_PIECES {
                    return Err(DownloadError::InvalidPremetadataState(
                        "HAVE index exceeds the supported piece-count bound",
                    ));
                }
                let byte = index / 8;
                if self.haves.len() <= byte {
                    self.haves.resize(byte + 1, 0);
                }
                self.haves[byte] |= 1 << (7 - index % 8);
            }
            PeerMessage::Bitfield(bitfield) => {
                if bitfield.len() > MAX_ENGINE_PIECES.div_ceil(8) {
                    return Err(DownloadError::InvalidPremetadataState(
                        "bitfield exceeds the supported piece-count bound",
                    ));
                }
                self.bitfield = Some(bitfield);
            }
            PeerMessage::HaveAll => self.have_all = true,
            PeerMessage::HaveNone => self.have_none = true,
            PeerMessage::SuggestPiece(piece) | PeerMessage::AllowedFast(piece) => {
                if usize::try_from(piece).map_or(true, |piece| piece >= MAX_ENGINE_PIECES) {
                    return Err(DownloadError::InvalidPremetadataState(
                        "Fast advisory index exceeds the supported piece-count bound",
                    ));
                }
                if self.fast_advisories.len() < crate::swarm::MAX_FAST_ADVISORY_PIECES {
                    self.fast_advisories.push_back(message);
                }
            }
            PeerMessage::RejectRequest(_) => {
                return Err(DownloadError::InvalidPremetadataState(
                    "Fast reject arrived before any payload request",
                ));
            }
            PeerMessage::Request(_) | PeerMessage::Cancel(_) | PeerMessage::Piece { .. } => {
                return Err(DownloadError::InvalidPremetadataState(
                    "payload message arrived before verified metadata",
                ));
            }
            PeerMessage::Extended { .. } => {
                return Err(DownloadError::InvalidPremetadataState(
                    "extension message was dispatched as core peer state",
                ));
            }
            PeerMessage::HashRequest(_) | PeerMessage::Hashes(_) | PeerMessage::HashReject(_) => {
                return Err(DownloadError::InvalidPremetadataState(
                    "hash exchange arrived before verified metadata",
                ));
            }
        }
        Ok(())
    }

    fn validated_messages(
        self,
        piece_count: usize,
    ) -> Result<VecDeque<PeerMessage>, DownloadError> {
        let mut messages = VecDeque::new();
        let expected_length = piece_count.div_ceil(8);
        let had_availability =
            self.bitfield.is_some() || self.have_all || self.have_none || !self.haves.is_empty();
        let mut bitfield = if self.have_all {
            vec![u8::MAX; expected_length]
        } else {
            self.bitfield.unwrap_or_else(|| vec![0; expected_length])
        };
        if self.have_all && !piece_count.is_multiple_of(8) {
            let used = piece_count % 8;
            if let Some(last) = bitfield.last_mut() {
                *last &= u8::MAX << (8 - used);
            }
        }
        if had_availability {
            if bitfield.len() != expected_length {
                return Err(DownloadError::InvalidPremetadataState(
                    "bitfield length does not match verified metadata",
                ));
            }
            let remainder = piece_count % 8;
            if remainder != 0 {
                let unused_mask = (1_u8 << (8 - remainder)) - 1;
                if bitfield.last().is_some_and(|byte| byte & unused_mask != 0) {
                    return Err(DownloadError::InvalidPremetadataState(
                        "bitfield sets unused trailing bits",
                    ));
                }
            }
            if self.haves.len() > expected_length
                && self.haves[expected_length..].iter().any(|byte| *byte != 0)
            {
                return Err(DownloadError::InvalidPremetadataState(
                    "HAVE index is outside verified metadata",
                ));
            }
            for (target, haves) in bitfield.iter_mut().zip(self.haves) {
                *target |= haves;
            }
            let remainder = piece_count % 8;
            if remainder != 0 {
                let unused_mask = (1_u8 << (8 - remainder)) - 1;
                if bitfield.last().is_some_and(|byte| byte & unused_mask != 0) {
                    return Err(DownloadError::InvalidPremetadataState(
                        "availability sets unused trailing bits",
                    ));
                }
            }
            messages.push_back(PeerMessage::Bitfield(bitfield));
        }
        for message in self.fast_advisories {
            let piece = match message {
                PeerMessage::SuggestPiece(piece) | PeerMessage::AllowedFast(piece) => piece,
                _ => unreachable!("only Fast advisories are retained"),
            };
            if usize::try_from(piece).map_or(true, |piece| piece >= piece_count) {
                return Err(DownloadError::InvalidPremetadataState(
                    "Fast advisory index is outside verified metadata",
                ));
            }
            messages.push_back(message);
        }
        if !self.choking {
            messages.push_back(PeerMessage::Unchoke);
        }
        Ok(messages)
    }
}

#[derive(Debug)]
enum TrackerUpdate {
    Peers {
        tracker: String,
        peers: Vec<SocketAddr>,
    },
}

#[derive(Debug)]
struct TrackerOperationResult {
    id: TrackerId,
    tracker: String,
    event: rstorrent_protocol::udp_tracker::AnnounceEvent,
    token_cache: Option<UdpTrackerTokenCache>,
    result: Result<TrackerAnnounceOutcome, TrackerOperationFailure>,
}

#[derive(Clone, Copy, Debug)]
enum TrackerManagerCommand {
    Finish,
}

#[derive(Debug)]
struct TrackerManager {
    receiver: mpsc::Receiver<TrackerUpdate>,
    command_sender: mpsc::Sender<TrackerManagerCommand>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl TrackerManager {
    #[cfg(test)]
    fn start(
        trackers: Vec<UdpTrackerUrl>,
        info_hash: [u8; 20],
        network: NetworkConfig,
        control: DownloadControl,
    ) -> Result<Self, DownloadError> {
        Self::start_with_configs(
            configured_udp_trackers(&trackers),
            info_hash,
            network,
            control,
        )
    }

    fn start_with_configs(
        mut trackers: Vec<TrackerConfig>,
        info_hash: [u8; 20],
        network: NetworkConfig,
        control: DownloadControl,
    ) -> Result<Self, DownloadError> {
        shuffle_tracker_configs(&mut trackers)?;
        let tracker_key = random_nonzero_u32()?;
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let (sender, receiver) = mpsc::channel(TRACKER_RESULT_QUEUE);
        let (command_sender, command_receiver) = mpsc::channel(TRACKER_COMMAND_QUEUE);
        let task = tokio::spawn(run_tracker_manager(
            TrackerSchedule::from_configs(trackers),
            info_hash,
            tracker_key,
            network,
            control,
            task_cancellation,
            sender,
            command_receiver,
        ));
        Ok(Self {
            receiver,
            command_sender,
            cancellation,
            task: Some(task),
        })
    }

    async fn next_peers(&mut self) -> Result<(String, Vec<SocketAddr>), DownloadError> {
        enum Outcome {
            Update(Option<TrackerUpdate>),
            Task(Result<(), tokio::task::JoinError>),
        }
        let outcome = {
            let Some(task) = self.task.as_mut() else {
                return Err(DownloadError::TrackerTask(
                    "tracker owner terminated unexpectedly".to_owned(),
                ));
            };
            tokio::select! {
                update = self.receiver.recv() => Outcome::Update(update),
                result = task => Outcome::Task(result),
            }
        };
        match outcome {
            Outcome::Update(Some(TrackerUpdate::Peers { tracker, peers })) => Ok((tracker, peers)),
            Outcome::Update(None) => Err(DownloadError::TrackerTask(
                "tracker result channel closed unexpectedly".to_owned(),
            )),
            Outcome::Task(result) => {
                self.task.take();
                match result {
                    Ok(()) => Err(DownloadError::TrackerTask(
                        "tracker owner terminated unexpectedly".to_owned(),
                    )),
                    Err(error) => Err(DownloadError::TrackerTask(error.to_string())),
                }
            }
        }
    }

    async fn shutdown(mut self) -> Result<(), DownloadError> {
        self.cancellation.cancel();
        self.receiver.close();
        let Some(task) = self.task.take() else {
            return Ok(());
        };
        task.await
            .map_err(|error| DownloadError::TrackerTask(error.to_string()))
    }

    async fn finish(mut self) -> Result<(), DownloadError> {
        let Some(mut task) = self.task.take() else {
            return Ok(());
        };
        if self
            .command_sender
            .send(TrackerManagerCommand::Finish)
            .await
            .is_err()
        {
            return task
                .await
                .map_err(|error| DownloadError::TrackerTask(error.to_string()));
        }
        let deadline = tokio::time::sleep(DIRECT_TRACKER_FINISH_TIMEOUT);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                result = &mut task => {
                    return result
                        .map_err(|error| DownloadError::TrackerTask(error.to_string()));
                }
                _ = &mut deadline => {
                    self.cancellation.cancel();
                    return task
                        .await
                        .map_err(|error| DownloadError::TrackerTask(error.to_string()));
                }
                update = self.receiver.recv() => {
                    if update.is_none() {
                        return task
                            .await
                            .map_err(|error| DownloadError::TrackerTask(error.to_string()));
                    }
                }
            }
        }
    }
}

#[derive(Debug)]
enum ContentDiscoveryEvent {
    Peers {
        swarm_key: SwarmKey,
        source: PeerSource,
        tracker: Option<String>,
        addresses: Vec<SocketAddr>,
    },
    Failed(DownloadError),
}

#[derive(Debug)]
struct ContentDiscovery {
    receiver: mpsc::Receiver<ContentDiscoveryEvent>,
    cancellation: CancellationToken,
    tracker_tasks: Vec<JoinHandle<Result<SwarmTrackerLane, DownloadError>>>,
    tasks: Vec<JoinHandle<Result<(), DownloadError>>>,
}

impl ContentDiscovery {
    fn start(peers: &mut TorrentPeerCoordinator) -> Self {
        let (sender, receiver) = mpsc::channel(CONTENT_DISCOVERY_QUEUE);
        let cancellation = CancellationToken::new();
        let mut tasks = Vec::new();
        let tracker_tasks = std::mem::take(&mut peers.trackers)
            .into_iter()
            .map(|lane| {
                tokio::spawn(run_content_tracker_discovery(
                    lane,
                    sender.clone(),
                    cancellation.clone(),
                ))
            })
            .collect();
        if let Some(dht) = peers.dht.clone() {
            for swarm_key in peers.swarm_keys.iter().copied() {
                tasks.push(tokio::spawn(run_content_dht_discovery(
                    dht.clone(),
                    swarm_key,
                    peers.control.clone(),
                    sender.clone(),
                    cancellation.clone(),
                )));
            }
        }
        if peers.external_discovery {
            tasks.push(tokio::spawn(keep_content_external_discovery_alive(
                sender.clone(),
                cancellation.clone(),
            )));
        }
        drop(sender);
        Self {
            receiver,
            cancellation,
            tracker_tasks,
            tasks,
        }
    }

    fn is_active(&self) -> bool {
        !self.receiver.is_closed()
    }

    async fn next_event(&mut self) -> Option<ContentDiscoveryEvent> {
        self.receiver.recv().await
    }

    async fn shutdown(mut self) -> Result<Vec<SwarmTrackerLane>, DownloadError> {
        self.cancellation.cancel();
        self.receiver.close();
        let mut trackers = Vec::with_capacity(self.tracker_tasks.len());
        for task in self.tracker_tasks {
            trackers.push(
                task.await
                    .map_err(|error| DownloadError::PeerTask(error.to_string()))??,
            );
        }
        for task in self.tasks {
            task.await
                .map_err(|error| DownloadError::PeerTask(error.to_string()))??;
        }
        Ok(trackers)
    }
}

async fn keep_content_external_discovery_alive(
    _sender: mpsc::Sender<ContentDiscoveryEvent>,
    cancellation: CancellationToken,
) -> Result<(), DownloadError> {
    cancellation.cancelled().await;
    Ok(())
}

async fn run_content_tracker_discovery(
    mut lane: SwarmTrackerLane,
    sender: mpsc::Sender<ContentDiscoveryEvent>,
    cancellation: CancellationToken,
) -> Result<SwarmTrackerLane, DownloadError> {
    loop {
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            result = lane.tracker.next_peers() => result,
        };
        let event = match result {
            Ok((tracker, peers)) => ContentDiscoveryEvent::Peers {
                swarm_key: lane.swarm_key,
                source: PeerSource::Tracker,
                tracker: Some(tracker),
                addresses: peers,
            },
            Err(error) => {
                send_content_discovery_event(
                    &sender,
                    ContentDiscoveryEvent::Failed(error),
                    &cancellation,
                )
                .await;
                break;
            }
        };
        if !send_content_discovery_event(&sender, event, &cancellation).await {
            break;
        }
    }
    Ok(lane)
}

async fn run_content_dht_discovery(
    dht: DhtHandle,
    swarm_key: SwarmKey,
    control: DownloadControl,
    sender: mpsc::Sender<ContentDiscoveryEvent>,
    cancellation: CancellationToken,
) -> Result<(), DownloadError> {
    let info_hash = swarm_key.into_bytes();
    let mut retry_delay = DHT_RETRY_INITIAL_DELAY;
    loop {
        control.emit(DownloadActivityEvent::DhtLookupStarted);
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                let _ = dht.cancel_lookup(info_hash).await;
                return Ok(());
            }
            _ = control.cancelled() => {
                let _ = dht.cancel_lookup(info_hash).await;
                return Ok(());
            }
            result = dht.lookup(info_hash) => result,
        };
        match result {
            Ok(addresses) => {
                control.emit(DownloadActivityEvent::DhtLookupSucceeded {
                    peer_count: addresses.len().try_into().unwrap_or(u32::MAX),
                });
                if !send_content_discovery_event(
                    &sender,
                    ContentDiscoveryEvent::Peers {
                        swarm_key,
                        source: PeerSource::Dht,
                        tracker: None,
                        addresses,
                    },
                    &cancellation,
                )
                .await
                {
                    return Ok(());
                }
                retry_delay = DHT_RETRY_INITIAL_DELAY;
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return Ok(()),
                    _ = control.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(DHT_SUCCESS_REQUERY_DELAY) => {}
                }
            }
            Err(
                error @ (DhtError::LookupTimedOut
                | DhtError::NoReachableNodes
                | DhtError::LookupCapacity),
            ) => {
                control.emit(DownloadActivityEvent::DhtLookupFailed {
                    detail: error.to_string(),
                });
                control.emit(DownloadActivityEvent::DhtRetryScheduled {
                    retry_in_seconds: retry_delay.as_secs(),
                });
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return Ok(()),
                    _ = control.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(retry_delay) => {}
                }
                retry_delay = retry_delay.saturating_mul(2).min(DHT_RETRY_MAX_DELAY);
            }
            Err(error) => {
                control.emit(DownloadActivityEvent::DhtLookupFailed {
                    detail: error.to_string(),
                });
                send_content_discovery_event(
                    &sender,
                    ContentDiscoveryEvent::Failed(DownloadError::Dht(error)),
                    &cancellation,
                )
                .await;
                return Ok(());
            }
        }
    }
}

async fn send_content_discovery_event(
    sender: &mpsc::Sender<ContentDiscoveryEvent>,
    event: ContentDiscoveryEvent,
    cancellation: &CancellationToken,
) -> bool {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        result = sender.send(event) => result.is_ok(),
    }
}

impl Drop for TrackerManager {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_tracker_manager(
    mut schedule: TrackerSchedule,
    info_hash: [u8; 20],
    tracker_key: u32,
    network: NetworkConfig,
    control: DownloadControl,
    cancellation: CancellationToken,
    sender: mpsc::Sender<TrackerUpdate>,
    mut command_receiver: mpsc::Receiver<TrackerManagerCommand>,
) {
    let started_at = Instant::now();
    let http_clients = HttpTrackerClients::new_with_authentication(
        network.policy,
        TrackerHttpsAuthentication::SystemTrust,
    )
    .or_else(|_| HttpTrackerClients::http_only(network.policy))
    .ok()
    .map(Arc::new);
    control.emit(DownloadActivityEvent::TrackerState(Box::new(
        schedule.snapshot(started_at.elapsed(), true),
    )));
    run_active_tracker_manager(
        &mut schedule,
        info_hash,
        tracker_key,
        network,
        http_clients,
        &control,
        &cancellation,
        &sender,
        &mut command_receiver,
        started_at,
    )
    .await;
    control.emit(DownloadActivityEvent::TrackerState(Box::new(
        schedule.snapshot(started_at.elapsed(), false),
    )));
}

#[allow(clippy::too_many_arguments)]
async fn run_active_tracker_manager(
    schedule: &mut TrackerSchedule,
    info_hash: [u8; 20],
    tracker_key: u32,
    network: NetworkConfig,
    http_clients: Option<Arc<HttpTrackerClients>>,
    control: &DownloadControl,
    cancellation: &CancellationToken,
    sender: &mpsc::Sender<TrackerUpdate>,
    command_receiver: &mut mpsc::Receiver<TrackerManagerCommand>,
    started_at: Instant,
) {
    let mut token_caches = BTreeMap::new();
    let mut http_tracker_ids = BTreeMap::new();
    let mut operations = JoinSet::new();
    let mut finishing = false;
    loop {
        let mut pending_action = None;
        while operations.len() < MAX_CONCURRENT_TRACKER_OPERATIONS {
            match schedule.next_action(started_at.elapsed()) {
                TrackerAction::Announce {
                    id,
                    url,
                    endpoint,
                    tier,
                    source: _,
                    event,
                    attempt,
                    fallback,
                } => {
                    let tracker = redacted_tracker_label(&url);
                    if fallback {
                        control.emit(DownloadActivityEvent::TrackerFallbackSelected {
                            tracker: tracker.clone(),
                            tier,
                        });
                    }
                    control.emit(DownloadActivityEvent::TrackerAnnounceStarted {
                        tracker: tracker.clone(),
                        tier,
                        attempt,
                        event,
                    });
                    control.emit(DownloadActivityEvent::TrackerState(Box::new(
                        schedule.snapshot(started_at.elapsed(), true),
                    )));
                    let operation_control = control.clone();
                    let operation_cancellation = cancellation.clone();
                    let is_udp = matches!(endpoint, TrackerEndpoint::Udp(_));
                    let mut token_cache = token_caches.remove(&id).unwrap_or_default();
                    let tracker_id = http_tracker_ids.get(&id).cloned();
                    let operation_http_clients = http_clients.clone();
                    let num_want =
                        if event == rstorrent_protocol::udp_tracker::AnnounceEvent::Stopped {
                            0
                        } else {
                            MAX_COMPACT_PEERS as i32
                        };
                    let operation_timeout =
                        if event == rstorrent_protocol::udp_tracker::AnnounceEvent::Stopped {
                            DIRECT_TRACKER_FINISH_TIMEOUT
                        } else {
                            HTTP_TRACKER_TIMEOUT
                        };
                    let session_permit = tokio::select! {
                        biased;
                        _ = cancellation.cancelled() => {
                            shutdown_tracker_operations(&mut operations).await;
                            return;
                        }
                        permit = control.acquire_tracker_operation() => permit,
                    };
                    operations.spawn(async move {
                        let _session_permit = session_permit;
                        let result = execute_tracker_operation(
                            endpoint,
                            &url,
                            &tracker,
                            network,
                            TrackerOperationSources::default(),
                            operation_http_clients,
                            TrackerAnnounceInput {
                                info_hash,
                                peer_id: network.peer_id,
                                key: tracker_key,
                                downloaded: 0,
                                left: UNKNOWN_MAGNET_LEFT,
                                uploaded: 0,
                                event,
                                num_want,
                                port: 1,
                                ipv6_port: 1,
                                support_crypto: network.encryption.accepts_incoming_mse(),
                            },
                            operation_timeout,
                            &mut token_cache,
                            tracker_id,
                            &operation_control,
                            &operation_cancellation,
                        )
                        .await;
                        TrackerOperationResult {
                            id,
                            tracker,
                            event,
                            token_cache: is_udp.then_some(token_cache),
                            result,
                        }
                    });
                }
                action @ TrackerAction::Wait { .. }
                | action @ TrackerAction::Pending
                | action @ TrackerAction::Exhausted => {
                    pending_action = Some(action);
                    break;
                }
            }
        }

        if !operations.is_empty() {
            enum OperationEvent {
                Joined(Option<Result<TrackerOperationResult, tokio::task::JoinError>>),
                Finish,
                CommandsClosed,
            }
            let event = tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    shutdown_tracker_operations(&mut operations).await;
                    return;
                }
                command = command_receiver.recv(), if !finishing => {
                    match command {
                        Some(TrackerManagerCommand::Finish) => OperationEvent::Finish,
                        None => OperationEvent::CommandsClosed,
                    }
                }
                joined = operations.join_next() => OperationEvent::Joined(joined),
            };
            if matches!(event, OperationEvent::Finish) {
                finishing = true;
                let requested = schedule.request_completed();
                if !requested {
                    schedule.request_stop();
                }
                continue;
            }
            if matches!(event, OperationEvent::CommandsClosed) {
                shutdown_tracker_operations(&mut operations).await;
                return;
            }
            let OperationEvent::Joined(joined) = event else {
                unreachable!("finish event handled above")
            };
            let Some(joined) = joined else {
                continue;
            };
            let operation = match joined {
                Ok(operation) => operation,
                Err(_) => {
                    shutdown_tracker_operations(&mut operations).await;
                    return;
                }
            };
            if let Some(token_cache) = operation.token_cache {
                token_caches.insert(operation.id, token_cache);
            }
            let stop_after_result = finishing
                && (matches!(
                    operation.event,
                    rstorrent_protocol::udp_tracker::AnnounceEvent::Completed
                ) || (matches!(
                    operation.event,
                    rstorrent_protocol::udp_tracker::AnnounceEvent::Started
                ) && operation.result.is_err()));
            let now = started_at.elapsed();
            match operation.result {
                Ok(response) => {
                    let peer_count = response.peers.len().try_into().unwrap_or(u32::MAX);
                    let success = schedule.succeeded_outcome(
                        operation.id,
                        now,
                        TrackerAcceptedOutcome {
                            requested_interval: response.interval,
                            peer_count,
                            seeders: response.seeders,
                            leechers: response.leechers,
                            connection_family: response.connection_family,
                        },
                    );
                    if let Some(tracker_id) = response.tracker_id {
                        http_tracker_ids.insert(operation.id, tracker_id);
                    }
                    control.emit(DownloadActivityEvent::TrackerAnnounceSucceeded {
                        tracker: operation.tracker.clone(),
                        peer_count,
                        interval_seconds: success.interval.as_secs(),
                    });
                    for detail in response.warnings {
                        control.emit(DownloadActivityEvent::TrackerWarning {
                            tracker: operation.tracker.clone(),
                            detail,
                        });
                    }
                    control.emit(DownloadActivityEvent::TrackerState(Box::new(
                        schedule.snapshot(now, true),
                    )));
                    let send = sender.send(TrackerUpdate::Peers {
                        tracker: operation.tracker,
                        peers: response.peers,
                    });
                    let sent = tokio::select! {
                        biased;
                        _ = cancellation.cancelled() => false,
                        result = send => result.is_ok(),
                    };
                    if !sent {
                        shutdown_tracker_operations(&mut operations).await;
                        return;
                    }
                }
                Err(TrackerOperationFailure::Cancelled) => {
                    shutdown_tracker_operations(&mut operations).await;
                    return;
                }
                Err(TrackerOperationFailure::Transport(detail)) => {
                    let failure = schedule.failed(operation.id, now, &detail);
                    control.emit(DownloadActivityEvent::TrackerAnnounceFailed {
                        tracker: operation.tracker,
                        failures: failure.failures,
                        retry_in_seconds: failure.retry_in.as_secs(),
                        detail,
                    });
                    control.emit(DownloadActivityEvent::TrackerState(Box::new(
                        schedule.snapshot(now, true),
                    )));
                }
                Err(TrackerOperationFailure::Declared { reason, retry }) => {
                    let (failures, retry_in_seconds) = match retry {
                        Some(TrackerRetryDirective::After(delay)) => {
                            let failure =
                                schedule.failed_with_retry(operation.id, now, &reason, delay);
                            (failure.failures, failure.retry_in.as_secs())
                        }
                        Some(TrackerRetryDirective::Never) => {
                            schedule.disable(operation.id, now, &reason);
                            (0, 0)
                        }
                        None => {
                            let failure = schedule.failed(operation.id, now, &reason);
                            (failure.failures, failure.retry_in.as_secs())
                        }
                    };
                    control.emit(DownloadActivityEvent::TrackerAnnounceFailed {
                        tracker: operation.tracker,
                        failures,
                        retry_in_seconds,
                        detail: reason,
                    });
                    control.emit(DownloadActivityEvent::TrackerState(Box::new(
                        schedule.snapshot(now, true),
                    )));
                }
            }
            if stop_after_result {
                schedule.request_stop();
            }
            continue;
        }

        let pending_action =
            pending_action.unwrap_or_else(|| schedule.next_action(started_at.elapsed()));
        match pending_action {
            TrackerAction::Wait {
                delay, url, kind, ..
            } => {
                let tracker = url;
                emit_tracker_wait(control, tracker, kind, delay);
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return,
                    command = command_receiver.recv(), if !finishing => {
                        if matches!(command, Some(TrackerManagerCommand::Finish)) {
                            finishing = true;
                            let requested = schedule.request_completed();
                            if !requested {
                                schedule.request_stop();
                            }
                        }
                    }
                    _ = tokio::time::sleep(delay) => {}
                }
            }
            TrackerAction::Exhausted => return,
            TrackerAction::Pending => return,
            TrackerAction::Announce { .. } => continue,
        }
    }
}

fn emit_tracker_wait(
    control: &DownloadControl,
    tracker: String,
    kind: TrackerWaitKind,
    delay: Duration,
) {
    match kind {
        TrackerWaitKind::FailureRetry => {
            control.emit(DownloadActivityEvent::TrackerRetryScheduled {
                tracker,
                retry_in_seconds: delay.as_secs(),
            });
        }
        TrackerWaitKind::Reannounce => {
            control.emit(DownloadActivityEvent::TrackerReannounceScheduled {
                tracker,
                announce_in_seconds: delay.as_secs(),
            });
        }
    }
}

async fn shutdown_tracker_operations(operations: &mut JoinSet<TrackerOperationResult>) {
    operations.abort_all();
    while operations.join_next().await.is_some() {}
}

fn shuffle_tracker_configs(trackers: &mut [TrackerConfig]) -> Result<(), DownloadError> {
    let mut first = 0;
    while first < trackers.len() {
        let tier = trackers[first].tier;
        let mut end = first + 1;
        while end < trackers.len() && trackers[end].tier == tier {
            end += 1;
        }
        shuffle_tracker_tier(&mut trackers[first..end])?;
        first = end;
    }
    Ok(())
}

fn shuffle_tracker_tier<T>(trackers: &mut [T]) -> Result<(), DownloadError> {
    for last in (1..trackers.len()).rev() {
        let selected = usize::try_from(random_nonzero_u32()?).unwrap_or(usize::MAX) % (last + 1);
        trackers.swap(last, selected);
    }
    Ok(())
}

#[cfg(test)]
fn udp_tracker_label(tracker: &UdpTrackerUrl) -> String {
    if tracker.host.contains(':') {
        format!("udp://[{}]:{}", tracker.host, tracker.port)
    } else {
        format!("udp://{}:{}", tracker.host, tracker.port)
    }
}

#[derive(Debug)]
struct TorrentPeerCoordinator {
    peers: TorrentPeerHandle,
    owns_peer_sink: bool,
    external_discovery: bool,
    selector: PeerSelector,
    network: NetworkConfig,
    peer_budget: PeerBudget,
    mse_dh: MseDhWorkOwner,
    encryption: PeerEncryptionPolicyHandle,
    peer_exchange: PeerExchangePolicyHandle,
    trackers: Vec<SwarmTrackerLane>,
    tracker_configs: Vec<TrackerConfig>,
    dht: Option<DhtHandle>,
    control: DownloadControl,
    connection: Option<PeerConnection>,
    last_error: Option<DownloadError>,
    next_dht_lookup: Instant,
    next_dht_lane: usize,
    dry_swarm_probe: DrySwarmProbeState,
    hybrid_upgrade_hash: Option<[u8; 20]>,
    swarm_key: Option<SwarmKey>,
    swarm_keys: Vec<SwarmKey>,
}

#[derive(Debug)]
struct SwarmTrackerLane {
    swarm_key: SwarmKey,
    tracker: TrackerManager,
}

struct TorrentPeerResources {
    peer_budget: PeerBudget,
    torrent_peers: Option<TorrentPeerHandle>,
    mse_dh: MseDhWorkOwner,
    encryption: PeerEncryptionPolicyHandle,
    peer_exchange: PeerExchangePolicyHandle,
}

impl TorrentPeerResources {
    fn standalone(network: NetworkConfig) -> Self {
        Self {
            peer_budget: PeerBudget::system_default(),
            torrent_peers: None,
            mse_dh: MseDhWorkOwner::new(),
            encryption: PeerEncryptionPolicyHandle::new(network.encryption),
            peer_exchange: PeerExchangePolicyHandle::new(network.peer_exchange),
        }
    }
}

#[derive(Debug)]
enum MetadataPeerResult {
    Complete {
        connection: PeerConnection,
        raw_info: Vec<u8>,
        metainfo: Box<AcquiredMetainfo>,
    },
    Failed {
        connection: PeerConnection,
        error: DownloadError,
    },
    Cancelled {
        connection: PeerConnection,
        turnover: bool,
    },
}

struct MetadataWorkerControl {
    attempt: DialAttempt,
    cancellation: CancellationToken,
    connected_at: Duration,
    turnover_requested: bool,
    turnover: Arc<AtomicBool>,
}

struct MetadataWorkerRunContext {
    identity: FullInfoHash,
    cancellation: CancellationToken,
    admission_cancellation: Option<CancellationToken>,
    control: DownloadControl,
    metadata: Arc<Mutex<TorrentMetadataDownload>>,
    turnover: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
enum AcquiredMetainfo {
    V1(Metainfo),
    V2(V2Metainfo),
    Hybrid(HybridMetainfo),
}

impl AcquiredMetainfo {
    #[cfg(test)]
    fn v1(&self) -> Option<&Metainfo> {
        match self {
            Self::V1(metainfo) => Some(metainfo),
            Self::V2(_) | Self::Hybrid(_) => None,
        }
    }

    fn private(&self) -> bool {
        match self {
            Self::V1(metainfo) => metainfo.private,
            Self::V2(metainfo) => metainfo.private,
            Self::Hybrid(metainfo) => metainfo.v2.private,
        }
    }

    fn total_length(&self) -> u64 {
        match self {
            Self::V1(metainfo) => metainfo.total_length,
            Self::V2(metainfo) => metainfo.total_length,
            Self::Hybrid(metainfo) => metainfo.v2.total_length,
        }
    }

    fn piece_length(&self) -> u32 {
        match self {
            Self::V1(metainfo) => metainfo.piece_length,
            Self::V2(metainfo) => metainfo.piece_length,
            Self::Hybrid(metainfo) => metainfo.v2.piece_length,
        }
    }

    fn piece_count(&self) -> usize {
        match self {
            Self::V1(metainfo) => metainfo.piece_count(),
            Self::V2(metainfo) => metainfo.layout.piece_count(),
            Self::Hybrid(metainfo) => metainfo.v2.layout.piece_count(),
        }
    }

    fn file_count(&self) -> usize {
        match self {
            Self::V1(metainfo) => metainfo.files.len(),
            Self::V2(metainfo) => metainfo.files.len(),
            Self::Hybrid(metainfo) => metainfo.v2.files.len(),
        }
    }
}

fn runtime_content_from_acquired(
    raw_info: &[u8],
    metainfo: AcquiredMetainfo,
) -> Result<TorrentContentWithIntegrity, DownloadError> {
    match metainfo {
        AcquiredMetainfo::V1(metainfo) => Ok(TorrentContent::from_v1_metainfo(metainfo).into()),
        AcquiredMetainfo::V2(_) => {
            TorrentContent::from_v2_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                .map_err(DownloadError::Metainfo)
        }
        AcquiredMetainfo::Hybrid(_) => {
            TorrentContent::from_hybrid_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                .map_err(DownloadError::Metainfo)
        }
    }
}

impl MetadataPeerResult {
    fn attempt(&self) -> DialAttempt {
        match self {
            Self::Complete { connection, .. }
            | Self::Failed { connection, .. }
            | Self::Cancelled { connection, .. } => connection.attempt(),
        }
    }
}

#[derive(Debug)]
enum MetadataSupervisorEvent {
    Cancelled,
    PolicyCheck,
    Discovery(Result<(), DownloadError>),
    Socket(Result<PeerSetEvent, PeerSetError>),
    Worker(Box<Option<Result<MetadataPeerResult, tokio::task::JoinError>>>),
}

#[derive(Clone, Copy, Debug)]
struct DhtRetryTiming {
    initial_delay: Duration,
    maximum_delay: Duration,
}

impl DhtRetryTiming {
    const PRODUCTION: Self = Self {
        initial_delay: DHT_RETRY_INITIAL_DELAY,
        maximum_delay: DHT_RETRY_MAX_DELAY,
    };
}

async fn retrying_dht_lookup(
    dht: DhtHandle,
    info_hash: [u8; 20],
    control: DownloadControl,
    timing: DhtRetryTiming,
    initial_wait: Duration,
) -> Result<Vec<SocketAddr>, DownloadError> {
    if !initial_wait.is_zero() {
        tokio::select! {
            _ = control.cancelled() => {
                return Err(DownloadError::Cancelled);
            }
            _ = tokio::time::sleep(initial_wait) => {}
        }
    }
    let mut retry_delay = timing.initial_delay;
    loop {
        control.emit(DownloadActivityEvent::DhtLookupStarted);
        let result = tokio::select! {
            _ = control.cancelled() => {
                let _ = dht.cancel_lookup(info_hash).await;
                return Err(DownloadError::Cancelled);
            }
            result = dht.lookup(info_hash) => result,
        };
        match result {
            Ok(peers) => {
                control.emit(DownloadActivityEvent::DhtLookupSucceeded {
                    peer_count: peers.len().try_into().unwrap_or(u32::MAX),
                });
                return Ok(peers);
            }
            Err(
                error @ (DhtError::LookupTimedOut
                | DhtError::NoReachableNodes
                | DhtError::LookupCapacity),
            ) => {
                control.emit(DownloadActivityEvent::DhtLookupFailed {
                    detail: error.to_string(),
                });
                control.emit(DownloadActivityEvent::DhtRetryScheduled {
                    retry_in_seconds: retry_delay.as_secs(),
                });
                tokio::select! {
                    _ = control.cancelled() => {
                        return Err(DownloadError::Cancelled);
                    }
                    _ = tokio::time::sleep(retry_delay) => {}
                }
                retry_delay = retry_delay.saturating_mul(2).min(timing.maximum_delay);
            }
            Err(error) => {
                control.emit(DownloadActivityEvent::DhtLookupFailed {
                    detail: error.to_string(),
                });
                return Err(DownloadError::Dht(error));
            }
        }
    }
}

impl TorrentPeerCoordinator {
    fn new(network: NetworkConfig, control: DownloadControl) -> Result<Self, DownloadError> {
        Self::new_with_peer_budget(network, control, PeerBudget::system_default())
    }

    fn new_with_peer_budget(
        network: NetworkConfig,
        control: DownloadControl,
        peer_budget: PeerBudget,
    ) -> Result<Self, DownloadError> {
        Self::new_with_peer_state(
            network,
            control,
            peer_budget,
            None,
            MseDhWorkOwner::new(),
            PeerEncryptionPolicyHandle::new(network.encryption),
            PeerExchangePolicyHandle::new(network.peer_exchange),
        )
    }

    fn new_with_peer_state(
        network: NetworkConfig,
        control: DownloadControl,
        peer_budget: PeerBudget,
        peers: Option<TorrentPeerHandle>,
        mse_dh: MseDhWorkOwner,
        encryption: PeerEncryptionPolicyHandle,
        peer_exchange: PeerExchangePolicyHandle,
    ) -> Result<Self, DownloadError> {
        validate_network_config(network)?;
        let owns_peer_sink = peers.is_none();
        let external_discovery = peers.is_some();
        let peers = match peers {
            Some(peers) => peers,
            None => {
                TorrentPeerHandle::new(Arc::new(control.clone())).map_err(map_torrent_peer_error)?
            }
        };
        if owns_peer_sink {
            peers
                .enforce_address_families(network.address_families)
                .map_err(map_torrent_peer_error)?;
        }
        Ok(Self {
            peers,
            owns_peer_sink,
            external_discovery,
            selector: PeerSelector,
            network,
            peer_budget,
            mse_dh,
            encryption,
            peer_exchange,
            trackers: Vec::new(),
            tracker_configs: Vec::new(),
            dht: None,
            control,
            connection: None,
            last_error: None,
            next_dht_lookup: Instant::now(),
            next_dht_lane: 0,
            dry_swarm_probe: DrySwarmProbeState::default(),
            hybrid_upgrade_hash: None,
            swarm_key: None,
            swarm_keys: Vec::new(),
        })
    }

    fn set_content_identities(&mut self, hashes: InfoHashes) {
        self.hybrid_upgrade_hash = match (hashes.v1_hash(), hashes.v2_hash()) {
            (Some(_), Some(v2)) => Some(v2.swarm_key().into_bytes()),
            _ => None,
        };
        self.swarm_keys.clear();
        hashes.for_each(|identity| self.swarm_keys.push(identity.swarm_key()));
    }

    fn configure_trackers(&mut self, configs: Vec<TrackerConfig>) -> Result<(), DownloadError> {
        self.tracker_configs = configs;
        self.ensure_tracker_lanes()
    }

    fn ensure_tracker_lanes(&mut self) -> Result<(), DownloadError> {
        if self.tracker_configs.is_empty() {
            return Ok(());
        }
        for swarm_key in self.swarm_keys.iter().copied() {
            if self.trackers.iter().any(|lane| lane.swarm_key == swarm_key) {
                continue;
            }
            self.trackers.push(SwarmTrackerLane {
                swarm_key,
                tracker: TrackerManager::start_with_configs(
                    self.tracker_configs.clone(),
                    swarm_key.into_bytes(),
                    self.network,
                    self.control.clone(),
                )?,
            });
        }
        debug_assert!(self.trackers.len() <= 2);
        Ok(())
    }

    fn begin_dial(
        &mut self,
        candidate: DialCandidate,
        role: PeerConnectionRole,
    ) -> Result<DialAttempt, DownloadError> {
        self.begin_outgoing(candidate, role, false)
    }

    fn begin_failure_limited_probe(
        &mut self,
        candidate: DialCandidate,
        role: PeerConnectionRole,
    ) -> Result<DialAttempt, DownloadError> {
        self.begin_outgoing(candidate, role, true)
    }

    fn begin_outgoing(
        &mut self,
        candidate: DialCandidate,
        role: PeerConnectionRole,
        failure_limited_probe: bool,
    ) -> Result<DialAttempt, DownloadError> {
        let context = PeerSelectionContext {
            now: self.elapsed(),
        };
        let encryption = self.encryption.load();
        let utp_available = self.control.utp_handle().is_some();
        let attempt = self
            .peers
            .with_state(|state| {
                let attempt = if failure_limited_probe {
                    state.begin_failure_limited_probe(candidate, role, context.now)?
                } else {
                    state.begin_dial(candidate, role, context.now)?
                };
                let initial_transport = peer_socket::preferred_transport(
                    attempt.endpoint().address(),
                    encryption,
                    utp_available,
                    attempt.utp_decision(),
                );
                state
                    .runtime
                    .set_transport(connection_id(attempt), initial_transport)
                    .map_err(TorrentPeerError::Runtime)?;
                Ok(attempt)
            })
            .map_err(map_torrent_peer_error)?;
        self.publish_peer_runtime(true)?;
        Ok(attempt)
    }

    fn connection_network(&self) -> NetworkConfig {
        self.network
            .with_encryption(self.encryption.load())
            .with_address_families(self.peers.address_family_policy())
    }

    fn transport_connected(
        &mut self,
        attempt: DialAttempt,
        transport: crate::peer_runtime::PeerTransport,
    ) -> Result<(), DownloadError> {
        let connection = connection_id(attempt);
        let Some(peer) = self
            .peers
            .with_state(|state| state.runtime.observation(connection).cloned())
        else {
            return Ok(());
        };
        if peer.lifecycle != crate::peer_runtime::PeerConnectionLifecycle::TransportConnecting {
            return Ok(());
        }
        let now = self.elapsed();
        self.peers
            .with_state(|state| {
                state
                    .runtime
                    .transport_connected(connection, transport, now)
            })
            .map_err(DownloadError::PeerRuntime)?;
        self.publish_peer_runtime(true)
    }

    fn dial_succeeded(
        &mut self,
        attempt: DialAttempt,
        connection: &PeerConnection,
        handshake: &Handshake,
    ) -> Result<PeerAdmissionOutcome, DownloadError> {
        let connection_id = connection_id(attempt);
        if let Some(cancellation) = connection.budget_cancellation() {
            self.peers
                .register_connection_cancellation(connection_id, cancellation);
        }
        let now = self.elapsed();
        let outcome = self
            .peers
            .with_state(|state| {
                state
                    .runtime
                    .set_transport(connection_id, connection.transport())
                    .map_err(TorrentPeerError::Runtime)?;
                if let Some(endpoint_state) = connection.mse_endpoint_update() {
                    state
                        .registry
                        .update_mse_endpoint(attempt, endpoint_state)?;
                }
                state
                    .runtime
                    .set_mse_method(connection_id, connection.mse_method())
                    .map_err(TorrentPeerError::Runtime)?;
                state.registry.dial_succeeded(attempt, now)?;
                let outcome = state
                    .runtime
                    .handshake_completed(connection_id, handshake, self.network.peer_id, now)
                    .map_err(TorrentPeerError::Runtime)?;
                if matches!(outcome, PeerAdmissionOutcome::Admitted { .. }) {
                    let mut pex_flags = PexFlags::OUTGOING;
                    if connection.transport() == crate::peer_runtime::PeerTransport::Utp {
                        pex_flags |= PexFlags::UTP;
                    }
                    state
                        .pex
                        .peer_established(attempt.endpoint(), PexFlags::from_bits(pex_flags));
                }
                Ok::<_, TorrentPeerError>(outcome)
            })
            .map_err(map_torrent_peer_error);
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                self.peers.unregister_connection_cancellation(connection_id);
                return Err(error);
            }
        };
        self.peers.apply_admission(connection_id, outcome);
        if matches!(outcome, PeerAdmissionOutcome::Admitted { .. }) {
            self.dry_swarm_probe.reset();
        }
        self.publish_peer_runtime(true)?;
        Ok(outcome)
    }

    fn dial_failed(
        &mut self,
        attempt: DialAttempt,
        failure: PeerFailure,
    ) -> Result<(), DownloadError> {
        let connection = connection_id(attempt);
        let now = self.elapsed();
        self.peers
            .with_state(|state| {
                state
                    .runtime
                    .begin_disconnect(connection, Some(failure), now)
            })
            .map_err(DownloadError::PeerRuntime)?;
        self.publish_peer_runtime(true)?;
        self.peers
            .with_state(|state| {
                state.registry.dial_failed(attempt, now, failure)?;
                state.remove_connection(connection)?;
                Ok::<_, TorrentPeerError>(())
            })
            .map_err(map_torrent_peer_error)?;
        self.peers.unregister_connection_cancellation(connection);
        self.publish_peer_runtime(true)
    }

    fn update_mse_endpoint(
        &mut self,
        attempt: DialAttempt,
        endpoint: crate::peer::MseEndpointState,
    ) -> Result<(), DownloadError> {
        self.peers
            .with_state(|state| state.registry.update_mse_endpoint(attempt, endpoint))
            .map_err(DownloadError::PeerRegistry)
    }

    fn record_utp_outcome(
        &mut self,
        attempt: DialAttempt,
        outcome: Option<crate::peer::UtpConnectOutcome>,
    ) -> Result<(), DownloadError> {
        let Some(outcome) = outcome else {
            return Ok(());
        };
        let now = self.elapsed();
        self.peers
            .with_state(|state| state.registry.record_utp_outcome(attempt, now, outcome))
            .map_err(DownloadError::PeerRegistry)
    }

    fn dial_cancelled(&mut self, attempt: DialAttempt) -> Result<(), DownloadError> {
        let connection = connection_id(attempt);
        let now = self.elapsed();
        self.peers
            .with_state(|state| state.runtime.begin_disconnect(connection, None, now))
            .map_err(DownloadError::PeerRuntime)?;
        self.publish_peer_runtime(true)?;
        self.peers
            .with_state(|state| {
                state.registry.dial_cancelled(attempt)?;
                state.remove_connection(connection)?;
                Ok::<_, TorrentPeerError>(())
            })
            .map_err(map_torrent_peer_error)?;
        self.peers.unregister_connection_cancellation(connection);
        self.publish_peer_runtime(true)
    }

    fn begin_disconnect(
        &mut self,
        attempt: DialAttempt,
        failure: Option<PeerFailure>,
    ) -> Result<(), DownloadError> {
        let now = self.elapsed();
        self.peers
            .with_state(|state| {
                state
                    .runtime
                    .begin_disconnect(connection_id(attempt), failure, now)
            })
            .map_err(DownloadError::PeerRuntime)?;
        self.publish_peer_runtime(true)
    }

    fn connection_closed(
        &mut self,
        attempt: DialAttempt,
        failure: Option<PeerFailure>,
    ) -> Result<(), DownloadError> {
        let connection = connection_id(attempt);
        if self.peers.with_state(|state| {
            state.runtime.observation(connection).is_some_and(|peer| {
                peer.lifecycle != crate::peer_runtime::PeerConnectionLifecycle::Disconnecting
            })
        }) {
            self.begin_disconnect(attempt, failure)?;
        }
        let now = self.elapsed();
        self.peers
            .with_state(|state| {
                state.pex.remove_source(connection, &mut state.registry);
                state.pex.peer_dropped(attempt.endpoint());
                state.registry.connection_closed(attempt, now, failure)?;
                state.remove_connection(connection)?;
                Ok::<_, TorrentPeerError>(())
            })
            .map_err(map_torrent_peer_error)?;
        self.peers.unregister_connection_cancellation(connection);
        self.publish_peer_runtime(true)
    }

    fn apply_extension_handshake(
        &mut self,
        connection: ConnectionId,
        payload: &[u8],
    ) -> Result<ExtensionMap, DownloadError> {
        let handshake = parse_recognized_extension_handshake(payload)
            .map_err(|error| DownloadError::Pex(PexError::Extension(error)))?;
        Ok(self.peers.with_state(|state| {
            let map = state.pex.apply_extension_handshake(connection, handshake);
            if !self.peer_exchange_enabled() {
                state.pex.disable_outbound(connection);
            }
            map
        }))
    }

    fn install_extension_map(&mut self, connection: ConnectionId, map: ExtensionMap) {
        let enabled = self.peer_exchange_enabled();
        self.peers.with_state(|state| {
            state.pex.install_extension_map(connection, map);
            if !enabled {
                state.pex.disable_outbound(connection);
            }
        });
    }

    fn receive_pex(
        &mut self,
        connection: ConnectionId,
        payload: &[u8],
        verified_public: bool,
    ) -> Result<PexReceiveDisposition, DownloadError> {
        if !self.peer_exchange_enabled() {
            return Ok(PexReceiveDisposition::PrivacyBlocked);
        }
        let source_endpoint = self
            .peers
            .with_state(|state| {
                state
                    .runtime
                    .observation(connection)
                    .map(|peer| peer.endpoint)
            })
            .ok_or(DownloadError::PeerRuntime(
                PeerRuntimeError::UnknownConnection(connection),
            ))?;
        let now = self.elapsed();
        let disposition = self
            .peers
            .with_state(|state| {
                state.pex.receive(
                    connection,
                    payload,
                    PexReceiveContext {
                        source_endpoint,
                        now,
                        verified_public,
                        network_policy: self.network.policy,
                        address_families: self.peers.address_family_policy(),
                        self_endpoints: &[],
                    },
                    &mut state.registry,
                )
            })
            .map_err(DownloadError::Pex)?;
        self.publish_peer_runtime(true)?;
        Ok(disposition)
    }

    fn next_pex(
        &mut self,
        connection: ConnectionId,
    ) -> Result<Option<(u8, Vec<u8>)>, DownloadError> {
        if !self.peer_exchange_enabled() {
            return Ok(None);
        }
        let now = self.elapsed();
        self.peers.with_state(|state| {
            let remote_id = state.pex.extension_map(connection).pex_id();
            let receiving_peer = state
                .runtime
                .observation(connection)
                .and_then(|peer| PeerEndpoint::new(peer.endpoint).ok());
            match (remote_id, receiving_peer) {
                (Some(remote_id), Some(receiving_peer)) => state
                    .pex
                    .next_outbound(connection, receiving_peer, now)
                    .map(|payload| payload.map(|payload| (remote_id, payload)))
                    .map_err(DownloadError::Pex),
                _ => Ok(None),
            }
        })
    }

    fn purge_pex_for_private(&mut self) -> Result<(), DownloadError> {
        self.peers
            .with_state(|state| state.pex.purge(&mut state.registry));
        self.publish_peer_runtime(true)
    }

    fn peer_exchange_enabled(&self) -> bool {
        self.network.peer_exchange && self.peer_exchange.load()
    }

    fn apply_peer_exchange_policy(&mut self, enabled: bool) -> Result<(), DownloadError> {
        self.peers
            .with_state(|state| state.pex.set_session_enabled(enabled, &mut state.registry));
        self.publish_peer_runtime(true)
    }

    fn handoff_to_content(&mut self, attempt: DialAttempt) -> Result<(), DownloadError> {
        self.peers
            .with_state(|state| {
                state
                    .runtime
                    .set_role(connection_id(attempt), PeerConnectionRole::Content)
            })
            .map_err(DownloadError::PeerRuntime)?;
        self.publish_peer_runtime(true)
    }

    fn observe_content_peers(&mut self, state: &SwarmState) -> Result<(), DownloadError> {
        for peer in state.connection_activity(self.elapsed()) {
            self.peers
                .with_state(|state| {
                    state.runtime.set_content_activity(
                        peer.id,
                        PeerContentActivity {
                            choking: peer.choking,
                            wanted_piece_count: peer.wanted_piece_count,
                            pending_requests: peer.pending_requests,
                            target_requests: peer.target_requests,
                            queued_payload_bytes: peer.queued_payload_bytes,
                            useful_payload_bytes: peer.useful_payload_bytes,
                            observed_payload_rate: peer.observed_payload_rate,
                            connected_age: peer.connected_age,
                            last_useful_age: peer.last_useful_age,
                            last_payload_age: peer.last_payload_age,
                            request_timeout: peer.request_timeout,
                            oldest_request_age: peer.oldest_request_age,
                            request_window_phase: match peer.window_phase {
                                ConnectionWindowPhaseSnapshot::SlowStart => {
                                    PeerRequestWindowPhase::SlowStart
                                }
                                ConnectionWindowPhaseSnapshot::Steady => {
                                    PeerRequestWindowPhase::Steady
                                }
                                ConnectionWindowPhaseSnapshot::Stalled => {
                                    PeerRequestWindowPhase::Stalled
                                }
                            },
                        },
                    )
                })
                .map_err(DownloadError::PeerRuntime)?;
        }
        self.publish_peer_runtime(false)
    }

    fn record_content_error(&mut self, error: DownloadError) {
        self.control.observe_content_error(Some(&error));
        self.last_error = Some(error);
    }

    fn publish_peer_runtime(&mut self, force: bool) -> Result<(), DownloadError> {
        self.peers
            .publish(true, force)
            .map_err(map_torrent_peer_error)
    }

    fn publish_peer_registry(&self, force: bool) {
        let _ = self.peers.publish(true, force);
    }

    #[cfg(test)]
    fn from_endpoint(
        address: SocketAddr,
        source: PeerSource,
        network: NetworkConfig,
    ) -> Result<Self, DownloadError> {
        Self::from_endpoint_with_control(address, source, network, DownloadControl::new())
    }

    fn from_endpoint_with_control(
        address: SocketAddr,
        source: PeerSource,
        network: NetworkConfig,
        control: DownloadControl,
    ) -> Result<Self, DownloadError> {
        let mut peers = Self::new(network, control)?;
        if matches!(network.policy, NetworkPolicy::Offline) {
            return Err(DownloadError::NetworkDisabled);
        }
        peers.observe_address(address, source)?;
        Ok(peers)
    }

    async fn from_magnet(
        magnet: &Magnet,
        network: NetworkConfig,
        control: DownloadControl,
        dht: Option<DhtHandle>,
    ) -> Result<Self, DownloadError> {
        Self::from_magnet_with_trackers(
            magnet,
            None,
            network,
            control,
            dht,
            TorrentPeerResources::standalone(network),
        )
        .await
    }

    async fn from_magnet_with_trackers(
        magnet: &Magnet,
        configured_trackers: Option<Vec<TrackerConfig>>,
        network: NetworkConfig,
        control: DownloadControl,
        dht: Option<DhtHandle>,
        resources: TorrentPeerResources,
    ) -> Result<Self, DownloadError> {
        let mut peers = Self::new_with_peer_state(
            network,
            control,
            resources.peer_budget,
            resources.torrent_peers,
            resources.mse_dh,
            resources.encryption,
            resources.peer_exchange,
        )?;
        peers.set_content_identities(magnet.identities);
        peers.swarm_key = Some(magnet.identity.swarm_key());
        peers.publish_peer_registry(true);
        peers.dht = dht;
        if peers.control.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        if !network.policy.permits_dns() {
            return Err(DownloadError::NetworkDisabled);
        }
        peers.resolve_peer_hints(&magnet.peer_hints).await;
        if peers.control.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let trackers =
            configured_trackers.unwrap_or_else(|| configured_magnet_trackers(&magnet.trackers));
        peers.configure_trackers(trackers)?;
        if peers.registry_is_empty()
            && peers.trackers.is_empty()
            && peers.dht.is_none()
            && !peers.external_discovery
        {
            return Err(peers
                .last_error
                .take()
                .unwrap_or(DownloadError::NoUsablePeer));
        }
        Ok(peers)
    }

    fn from_complete_content(
        swarm_key: SwarmKey,
        info_hashes: InfoHashes,
        trackers: Vec<TrackerConfig>,
        network: NetworkConfig,
        control: DownloadControl,
        dht: Option<DhtHandle>,
        resources: TorrentPeerResources,
    ) -> Result<Self, DownloadError> {
        let mut peers = Self::new_with_peer_state(
            network,
            control,
            resources.peer_budget,
            resources.torrent_peers,
            resources.mse_dh,
            resources.encryption,
            resources.peer_exchange,
        )?;
        peers.set_content_identities(info_hashes);
        peers.swarm_key = Some(swarm_key);
        peers.publish_peer_registry(true);
        peers.dht = dht;
        if peers.control.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        peers.configure_trackers(trackers)?;
        if peers.registry_is_empty()
            && peers.trackers.is_empty()
            && peers.dht.is_none()
            && !peers.external_discovery
        {
            return Err(DownloadError::NoUsablePeer);
        }
        Ok(peers)
    }

    async fn resolve_peer_hints(&mut self, hints: &[PeerHint]) {
        for hint in hints {
            let addresses =
                match resolve_host(&hint.host, hint.port, "resolve magnet peer hint").await {
                    Ok(addresses) => addresses,
                    Err(error) => {
                        self.last_error = Some(error);
                        continue;
                    }
                };
            for address in addresses {
                if let Err(error) = self.observe_address(address, PeerSource::MagnetHint) {
                    self.last_error = Some(error);
                }
            }
        }
    }

    fn observe_address(
        &mut self,
        address: SocketAddr,
        source: PeerSource,
    ) -> Result<(), DownloadError> {
        self.observe_address_on_lane(address, source, None)
    }

    fn observe_address_on_lane(
        &mut self,
        address: SocketAddr,
        source: PeerSource,
        swarm_key: Option<SwarmKey>,
    ) -> Result<(), DownloadError> {
        if !self.network.policy.allows(address) {
            return Err(DownloadError::NetworkPolicyDenied {
                address,
                policy: self.network.policy,
            });
        }
        if !self.peers.address_family_policy().permits(address.ip()) {
            return Err(DownloadError::NoUsablePeer);
        }
        let endpoint = PeerEndpoint::new(address).map_err(DownloadError::PeerRegistry)?;
        let observation = PeerObservation::dialable(endpoint, source);
        match swarm_key {
            Some(swarm_key) => self
                .peers
                .observe_discovered_peer_on_swarm(observation, swarm_key),
            None => self.peers.observe_discovered_peer(observation),
        }
        .map_err(map_torrent_peer_error)?;
        self.publish_peer_runtime(true)
    }

    fn candidate_swarm_key(&self, candidate: DialCandidate) -> SwarmKey {
        let primary = self
            .swarm_key
            .expect("peer coordinator has a selected primary swarm key");
        let keys = self
            .peers
            .discovery_swarm_keys(candidate.endpoint().address());
        if keys.is_empty() {
            return primary;
        }
        if keys.contains(&primary) {
            primary
        } else {
            keys.iter().copied().next().unwrap_or(primary)
        }
    }

    fn elapsed(&self) -> Duration {
        self.peers.elapsed()
    }

    fn registry_is_empty(&self) -> bool {
        self.peers.with_state(|state| state.registry.is_empty())
    }

    #[cfg(test)]
    fn registry_len(&self) -> usize {
        self.peers.with_state(|state| state.registry.len())
    }

    fn select_candidate(&self, context: PeerSelectionContext) -> Option<DialCandidate> {
        let address_families = self.peers.address_family_policy();
        self.peers.with_state(|state| {
            self.selector
                .select_with_address_families(&state.registry, context, address_families)
        })
    }

    fn select_failure_limited_probe(&self, context: PeerSelectionContext) -> Option<DialCandidate> {
        let address_families = self.peers.address_family_policy();
        self.peers.with_state(|state| {
            self.selector
                .select_failure_limited_probe_with_address_families(
                    &state.registry,
                    context,
                    address_families,
                )
        })
    }

    fn registry_counts(&self, context: PeerSelectionContext) -> PeerRegistryCounts {
        self.peers
            .with_state(|state| state.registry.counts(context))
    }

    fn candidate_failure_count(&self, candidate: DialCandidate) -> Option<u32> {
        self.peers.with_state(|state| {
            state
                .registry
                .get(candidate.record_id())
                .map(|record| record.history().consecutive_failures)
        })
    }

    fn dry_swarm_probe_is_ready(&self, now: Duration) -> bool {
        self.dry_swarm_probe.is_ready(now)
    }

    fn admit_dry_swarm_probe(&mut self, now: Duration) -> DrySwarmProbeAdmission {
        self.dry_swarm_probe.admit(now)
    }

    fn registry_snapshot(&self) -> crate::peer::PeerRegistrySnapshot {
        self.peers.registry_snapshot(true)
    }

    async fn receive_tracker_peers(&mut self) -> Result<(), DownloadError> {
        if self.trackers.is_empty() {
            return Err(self
                .last_error
                .take()
                .unwrap_or(DownloadError::NoUsablePeer));
        }
        let (swarm_key, tracker, peers) = match self.trackers.len() {
            1 => {
                let lane = &mut self.trackers[0];
                let (tracker, peers) = lane.tracker.next_peers().await?;
                (lane.swarm_key, tracker, peers)
            }
            2 => {
                let (first, second) = self.trackers.split_at_mut(1);
                let first = &mut first[0];
                let second = &mut second[0];
                tokio::select! {
                    result = first.tracker.next_peers() => {
                        let (tracker, peers) = result?;
                        (first.swarm_key, tracker, peers)
                    }
                    result = second.tracker.next_peers() => {
                        let (tracker, peers) = result?;
                        (second.swarm_key, tracker, peers)
                    }
                }
            }
            _ => {
                return Err(DownloadError::PeerTask(
                    "torrent discovery exceeded two swarm lanes".to_owned(),
                ));
            }
        };
        let peer_count = peers.len().try_into().unwrap_or(u32::MAX);
        for address in peers {
            if let Err(error) =
                self.observe_address_on_lane(address, PeerSource::Tracker, Some(swarm_key))
            {
                self.last_error = Some(error);
            }
        }
        if self
            .select_candidate(PeerSelectionContext {
                now: self.elapsed(),
            })
            .is_none()
        {
            self.control
                .emit(DownloadActivityEvent::TrackerPeersUnavailable {
                    tracker,
                    peer_count,
                });
        }
        Ok(())
    }

    async fn receive_dht_peers(&mut self, swarm_key: SwarmKey) -> Result<(), DownloadError> {
        let dht = self.dht.clone().ok_or(DownloadError::NoUsablePeer)?;
        let peers = retrying_dht_lookup(
            dht,
            swarm_key.into_bytes(),
            self.control.clone(),
            DhtRetryTiming::PRODUCTION,
            self.dht_requery_wait(),
        )
        .await?;
        self.next_dht_lookup = Instant::now() + DHT_SUCCESS_REQUERY_DELAY;
        for address in peers {
            if let Err(error) =
                self.observe_address_on_lane(address, PeerSource::Dht, Some(swarm_key))
            {
                self.last_error = Some(error);
            }
        }
        Ok(())
    }

    fn next_dht_swarm_key(&mut self, fallback: [u8; 20]) -> SwarmKey {
        if self.swarm_keys.is_empty() {
            return SwarmKey::V1(fallback.into());
        }
        let key = self.swarm_keys[self.next_dht_lane % self.swarm_keys.len()];
        self.next_dht_lane = self.next_dht_lane.wrapping_add(1);
        key
    }

    async fn receive_discovery_peers(&mut self, info_hash: [u8; 20]) -> Result<(), DownloadError> {
        match (!self.trackers.is_empty(), self.dht.is_some()) {
            (true, true) => {
                let dht = self.dht.clone().expect("DHT presence checked");
                let dht_wait = self.dht_requery_wait();
                let dht_control = self.control.clone();
                let dht_swarm_key = self.next_dht_swarm_key(info_hash);
                let dht_info_hash = dht_swarm_key.into_bytes();
                let dht_lookup = retrying_dht_lookup(
                    dht,
                    dht_info_hash,
                    dht_control,
                    DhtRetryTiming::PRODUCTION,
                    dht_wait,
                );
                let discovered = tokio::select! {
                    tracker = self.receive_tracker_peers() => {
                        return tracker;
                    }
                    dht = dht_lookup => (dht_swarm_key, dht),
                };
                match discovered {
                    (swarm_key, Ok(peers)) => {
                        self.next_dht_lookup = Instant::now() + DHT_SUCCESS_REQUERY_DELAY;
                        for address in peers {
                            if let Err(error) = self.observe_address_on_lane(
                                address,
                                PeerSource::Dht,
                                Some(swarm_key),
                            ) {
                                self.last_error = Some(error);
                            }
                        }
                        Ok(())
                    }
                    (_, Err(error)) => {
                        self.last_error = Some(error);
                        self.receive_tracker_peers().await
                    }
                }
            }
            (true, false) => self.receive_tracker_peers().await,
            (false, true) => {
                let swarm_key = self.next_dht_swarm_key(info_hash);
                self.receive_dht_peers(swarm_key).await
            }
            (false, false) if self.external_discovery => {
                tokio::select! {
                    _ = self.control.cancelled() => Err(DownloadError::Cancelled),
                    _ = tokio::time::sleep(Duration::from_millis(100)) => Ok(()),
                }
            }
            (false, false) => Err(self
                .last_error
                .take()
                .unwrap_or(DownloadError::NoUsablePeer)),
        }
    }

    fn dht_requery_wait(&self) -> Duration {
        self.next_dht_lookup
            .saturating_duration_since(Instant::now())
    }

    #[cfg(test)]
    async fn connect_next(
        &mut self,
        info_hash: [u8; 20],
        advertise_extensions: bool,
    ) -> Result<Handshake, DownloadError> {
        debug_assert!(self.connection.is_none());
        loop {
            let context = PeerSelectionContext {
                now: self.elapsed(),
            };
            let candidate = match self.select_candidate(context) {
                Some(candidate) => candidate,
                None => {
                    self.receive_discovery_peers(info_hash).await?;
                    continue;
                }
            };
            self.control.emit(DownloadActivityEvent::PeerDialStarted {
                peer: candidate.endpoint().to_string(),
            });
            let attempt = self.begin_dial(candidate, PeerConnectionRole::Content)?;
            match connect_peer(
                attempt,
                info_hash,
                advertise_extensions,
                self.connection_network(),
            )
            .await
            {
                Ok((connection, handshake)) => {
                    let admission = self.dial_succeeded(attempt, &connection, &handshake)?;
                    if let Some(failure) = admission_rejection_failure(admission) {
                        self.connection_closed(attempt, Some(failure))?;
                        continue;
                    }
                    self.connection = Some(connection);
                    return Ok(handshake);
                }
                Err(error) => {
                    self.dial_failed(attempt, peer_failure(&error))?;
                    self.last_error = Some(error);
                }
            }
        }
    }

    async fn acquire_metadata(
        &mut self,
        identity: impl Into<FullInfoHash>,
        limits: MetadataConnectionLimits,
    ) -> Result<(Vec<u8>, AcquiredMetainfo), DownloadError> {
        let limits = limits.validate()?;
        let identity = identity.into();
        self.control.metadata_started();
        let result = self.acquire_metadata_inner(identity, limits).await;
        self.control.observe_metadata_supervisor(
            self.registry_snapshot(),
            0,
            0,
            self.last_error.as_ref(),
        );
        if let Ok((_, metainfo)) = &result {
            self.control.emit(DownloadActivityEvent::MetadataVerified {
                total_length: metainfo.total_length(),
                piece_length: metainfo.piece_length(),
                piece_count: metainfo.piece_count(),
                file_count: metainfo.file_count(),
            });
        }
        self.control.metadata_finished(&result);
        result
    }

    async fn acquire_metadata_inner(
        &mut self,
        identity: FullInfoHash,
        limits: MetadataConnectionLimits,
    ) -> Result<(Vec<u8>, AcquiredMetainfo), DownloadError> {
        debug_assert!(self.connection.is_none());
        let info_hash = identity.swarm_key().into_bytes();
        let mut sockets = PeerSocketSet::with_owners(self.peer_budget.clone(), self.mse_dh.clone())
            .with_bandwidth(self.peers.bandwidth());
        let mut workers = JoinSet::new();
        let mut worker_controls: BTreeMap<DialAttemptId, MetadataWorkerControl> = BTreeMap::new();
        let mut dial_pacer = MetadataDialPacer::new(limits.max_attempts_per_second);
        let mut discovery_failed_while_active = false;
        let metadata = Arc::new(Mutex::new(TorrentMetadataDownload::new(identity)));

        loop {
            let address_families = self.peers.address_family_policy();
            sockets.cancel_disallowed(address_families);
            for worker in worker_controls.values() {
                if !address_families.permits(worker.attempt.endpoint().address().ip()) {
                    worker.cancellation.cancel();
                }
            }
            self.peers
                .enforce_address_families(address_families)
                .map_err(map_torrent_peer_error)?;
            while metadata_cohort_has_capacity(
                sockets.pending_len(),
                workers.len(),
                limits.max_peers,
            ) && dial_pacer.is_ready(self.elapsed())
            {
                if !self.control.try_acquire_outbound_turn() {
                    break;
                }
                let context = PeerSelectionContext {
                    now: self.elapsed(),
                };
                let Some(candidate) = self.select_candidate(context) else {
                    break;
                };
                self.control.emit(DownloadActivityEvent::PeerDialStarted {
                    peer: candidate.endpoint().to_string(),
                });
                let dial_swarm_key = self.candidate_swarm_key(candidate);
                let attempt = self.begin_dial(candidate, PeerConnectionRole::Metadata)?;
                self.control.metadata_dial_started(attempt);
                let services = PeerDialServices {
                    byte_metric_sink: self.control.byte_metric_sink(),
                    mse_handshake_sink: self.control.mse_handshake_sink(),
                    utp: self.control.utp_handle(),
                };
                let dial = match (dial_swarm_key, self.hybrid_upgrade_hash) {
                    (SwarmKey::V1(_), Some(v2_hash)) => sockets.begin_hybrid_dial(
                        attempt,
                        dial_swarm_key.into_bytes(),
                        v2_hash,
                        true,
                        self.connection_network(),
                        services,
                    ),
                    (SwarmKey::V2Truncated(_), _) => sockets.begin_v2_dial(
                        attempt,
                        dial_swarm_key.into_bytes(),
                        true,
                        self.connection_network(),
                        services,
                    ),
                    (SwarmKey::V1(_), None) => sockets.begin_dial(
                        attempt,
                        dial_swarm_key.into_bytes(),
                        true,
                        self.connection_network(),
                        services,
                    ),
                };
                if let Err(error) = dial {
                    self.dial_cancelled(attempt)?;
                    if matches!(error, PeerSetError::ConnectionLimit(_)) {
                        break;
                    }
                    return Err(download_peer_set_error(error));
                }
                dial_pacer.record_attempt(self.elapsed());
            }

            let now = self.elapsed();
            let cohort_is_full = !metadata_cohort_has_capacity(
                sockets.pending_len(),
                workers.len(),
                limits.max_peers,
            );
            let replacement_waiting = cohort_is_full
                && dial_pacer.is_ready(now)
                && self
                    .select_candidate(PeerSelectionContext { now })
                    .is_some();
            let turnover_pending = worker_controls
                .values()
                .any(|worker| worker.turnover_requested);
            if replacement_waiting && !turnover_pending {
                let candidate = {
                    let metadata = metadata
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    select_metadata_turnover_candidate(
                        worker_controls
                            .values()
                            .map(|worker| MetadataWorkerTurnoverState {
                                attempt_id: worker.attempt.id(),
                                connected_at: worker.connected_at,
                                turnover_requested: worker.turnover_requested,
                                contributed: metadata
                                    .received_blocks_for_peer(worker.attempt.id().get())
                                    != 0,
                            }),
                        now,
                        limits.saturated_no_progress_grace,
                    )
                };
                if let Some(candidate) = candidate
                    && let Some(worker) = worker_controls.get_mut(&candidate)
                {
                    worker.turnover_requested = true;
                    worker.turnover.store(true, Ordering::Release);
                    worker.cancellation.cancel();
                }
            }

            self.control.observe_metadata_supervisor(
                self.registry_snapshot(),
                sockets.pending_len(),
                workers.len(),
                self.last_error.as_ref(),
            );

            let pacing_wait = dial_pacer.until_ready(self.elapsed());
            let policy_wait = if pacing_wait.is_zero() {
                CONTENT_SWARM_MAINTENANCE_INTERVAL
            } else {
                pacing_wait.min(CONTENT_SWARM_MAINTENANCE_INTERVAL)
            };
            if sockets.pending_len() == 0 && workers.is_empty() {
                let candidate_waiting = self
                    .select_candidate(PeerSelectionContext {
                        now: self.elapsed(),
                    })
                    .is_some();
                let cancellation = self.control.cancellation_token();
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => {
                        return Err(DownloadError::Cancelled);
                    }
                    result = self.receive_discovery_peers(info_hash), if !candidate_waiting => {
                        result?;
                    }
                    _ = tokio::time::sleep(policy_wait) => {},
                }
                discovery_failed_while_active = false;
                continue;
            }

            let can_discover = !discovery_failed_while_active
                && metadata_cohort_has_capacity(
                    sockets.pending_len(),
                    workers.len(),
                    limits.max_peers,
                )
                && (!self.trackers.is_empty() || self.dht.is_some());
            let cancellation = self.control.cancellation_token();
            let event = tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    MetadataSupervisorEvent::Cancelled
                }
                result = self.receive_discovery_peers(info_hash), if can_discover => {
                    MetadataSupervisorEvent::Discovery(result)
                }
                _ = tokio::time::sleep(policy_wait) => {
                    MetadataSupervisorEvent::PolicyCheck
                }
                event = sockets.next_event() => MetadataSupervisorEvent::Socket(event),
                joined = workers.join_next(), if !workers.is_empty() => {
                    MetadataSupervisorEvent::Worker(Box::new(joined))
                }
            };
            match event {
                MetadataSupervisorEvent::Socket(Ok(PeerSetEvent::DialPhase {
                    attempt,
                    transport,
                })) => {
                    self.transport_connected(attempt, transport)?;
                }
                MetadataSupervisorEvent::Discovery(Ok(())) => {
                    discovery_failed_while_active = false;
                }
                MetadataSupervisorEvent::Discovery(Err(error)) => {
                    self.last_error = Some(error);
                    discovery_failed_while_active = true;
                }
                MetadataSupervisorEvent::Cancelled => {
                    cleanup_metadata_attempts(
                        self,
                        &mut sockets,
                        &mut workers,
                        &mut worker_controls,
                    )
                    .await?;
                    return Err(DownloadError::Cancelled);
                }
                MetadataSupervisorEvent::PolicyCheck => {}
                MetadataSupervisorEvent::Socket(Ok(PeerSetEvent::DialCompleted {
                    attempt,
                    utp_outcome,
                    result,
                })) => {
                    self.record_utp_outcome(attempt, utp_outcome)?;
                    match *result {
                        Ok((connection, handshake)) => {
                            let admission =
                                self.dial_succeeded(attempt, &connection, &handshake)?;
                            if let Some(failure) = admission_rejection_failure(admission) {
                                self.connection_closed(attempt, Some(failure))?;
                                continue;
                            }
                            self.control
                                .metadata_peer_connected(attempt, handshake.supports_extensions());
                            let cancellation = CancellationToken::new();
                            let turnover = Arc::new(AtomicBool::new(false));
                            worker_controls.insert(
                                attempt.id(),
                                MetadataWorkerControl {
                                    attempt,
                                    cancellation: cancellation.clone(),
                                    connected_at: self.elapsed(),
                                    turnover_requested: false,
                                    turnover: turnover.clone(),
                                },
                            );
                            let control = self.control.clone();
                            let metadata = metadata.clone();
                            let admission_cancellation = connection.budget_cancellation();
                            workers.spawn(async move {
                                run_metadata_peer(
                                    connection,
                                    handshake,
                                    MetadataWorkerRunContext {
                                        identity,
                                        cancellation,
                                        admission_cancellation,
                                        control,
                                        metadata,
                                        turnover,
                                    },
                                )
                                .await
                            });
                        }
                        Err(error) => {
                            if matches!(&error, PeerSocketError::Cancelled) {
                                self.dial_cancelled(attempt)?;
                                self.control.metadata_peer_finished(
                                    attempt.id(),
                                    MetadataPeerStage::Cancelled,
                                    Some("metadata dial cancelled"),
                                );
                            } else {
                                let detail = error.to_string();
                                if let Some(endpoint) = error.mse_endpoint_update() {
                                    self.update_mse_endpoint(attempt, endpoint)?;
                                }
                                self.dial_failed(attempt, error.peer_failure())?;
                                self.last_error = Some(download_peer_socket_error(error));
                                self.control.metadata_peer_finished(
                                    attempt.id(),
                                    MetadataPeerStage::Failed,
                                    Some(&detail),
                                );
                            }
                        }
                    }
                }
                MetadataSupervisorEvent::Socket(Ok(PeerSetEvent::Peer(_))) => {
                    cleanup_metadata_attempts(
                        self,
                        &mut sockets,
                        &mut workers,
                        &mut worker_controls,
                    )
                    .await?;
                    return Err(DownloadError::PeerTask(
                        "metadata socket set produced an impossible peer event".to_owned(),
                    ));
                }
                MetadataSupervisorEvent::Socket(Err(error)) => {
                    cleanup_metadata_attempts(
                        self,
                        &mut sockets,
                        &mut workers,
                        &mut worker_controls,
                    )
                    .await?;
                    return Err(download_peer_set_error(error));
                }
                MetadataSupervisorEvent::Worker(joined) => match *joined {
                    Some(Ok(MetadataPeerResult::Complete {
                        connection,
                        raw_info,
                        metainfo,
                    })) => {
                        let metainfo = *metainfo;
                        worker_controls.remove(&connection.attempt().id());
                        cleanup_metadata_attempts(
                            self,
                            &mut sockets,
                            &mut workers,
                            &mut worker_controls,
                        )
                        .await?;
                        self.connection = Some(connection);
                        if metainfo.private() {
                            self.disable_dht_for_private(info_hash).await?;
                        }
                        return Ok((raw_info, metainfo));
                    }
                    Some(Ok(MetadataPeerResult::Failed { connection, error })) => {
                        worker_controls.remove(&connection.attempt().id());
                        let failure = peer_failure(&error);
                        self.connection_closed(connection.attempt(), Some(failure))?;
                        self.last_error = Some(error);
                    }
                    Some(Ok(MetadataPeerResult::Cancelled {
                        connection,
                        turnover,
                    })) => {
                        worker_controls.remove(&connection.attempt().id());
                        self.connection_closed(
                            connection.attempt(),
                            turnover.then_some(PeerFailure::Protocol),
                        )?;
                    }
                    Some(Err(error)) => {
                        cleanup_metadata_attempts(
                            self,
                            &mut sockets,
                            &mut workers,
                            &mut worker_controls,
                        )
                        .await?;
                        return Err(DownloadError::PeerTask(error.to_string()));
                    }
                    None => {
                        cleanup_metadata_attempts(
                            self,
                            &mut sockets,
                            &mut workers,
                            &mut worker_controls,
                        )
                        .await?;
                        return Err(DownloadError::PeerTask(
                            "metadata worker set ended unexpectedly".to_owned(),
                        ));
                    }
                },
            }
        }
    }

    fn close_current(&mut self, failure: Option<PeerFailure>) -> Result<(), DownloadError> {
        let Some(connection) = self.connection.take() else {
            return Ok(());
        };
        self.begin_disconnect(connection.attempt(), failure)?;
        self.connection_closed(connection.attempt(), failure)
    }

    async fn shutdown_tracker(&mut self) -> Result<(), DownloadError> {
        let mut result = Ok(());
        for lane in std::mem::take(&mut self.trackers) {
            if let Err(error) = lane.tracker.shutdown().await
                && result.is_ok()
            {
                result = Err(error);
            }
        }
        self.peers
            .publish(!self.owns_peer_sink, true)
            .map_err(map_torrent_peer_error)?;
        result
    }

    async fn finish_tracker(&mut self) -> Result<(), DownloadError> {
        let mut result = Ok(());
        for lane in std::mem::take(&mut self.trackers) {
            if let Err(error) = lane.tracker.finish().await
                && result.is_ok()
            {
                result = Err(error);
            }
        }
        self.peers
            .publish(!self.owns_peer_sink, true)
            .map_err(map_torrent_peer_error)?;
        result
    }

    async fn disable_dht_for_private(&mut self, info_hash: [u8; 20]) -> Result<(), DownloadError> {
        self.purge_pex_for_private()?;
        let current_is_dht_only = self.connection.as_ref().is_some_and(|connection| {
            self.peers.with_state(|state| {
                state
                    .registry
                    .get(connection.attempt().record_id())
                    .is_some_and(|record| {
                        record.sources().contains(PeerSource::Dht) && record.sources().len() == 1
                    })
            })
        });
        if current_is_dht_only {
            self.close_current(None)?;
        }
        if let Some(dht) = self.dht.take() {
            let keys = if self.swarm_keys.is_empty() {
                vec![SwarmKey::V1(info_hash.into())]
            } else {
                self.swarm_keys.clone()
            };
            for key in keys {
                dht.cancel_lookup(key.into_bytes())
                    .await
                    .map_err(DownloadError::Dht)?;
            }
        }
        self.peers
            .with_state(|state| state.registry.remove_source(PeerSource::Dht));
        self.control
            .emit(DownloadActivityEvent::DhtDisabledForPrivateTorrent);
        Ok(())
    }
}

#[cfg(test)]
fn configured_udp_trackers(trackers: &[UdpTrackerUrl]) -> Vec<TrackerConfig> {
    trackers
        .iter()
        .cloned()
        .enumerate()
        .map(|(position, endpoint)| TrackerConfig {
            url: udp_tracker_label(&endpoint),
            endpoint: TrackerEndpoint::Udp(endpoint),
            tier: 0,
            position: position.try_into().unwrap_or(u32::MAX),
            source: crate::tracker::TrackerSource::Magnet,
        })
        .collect()
}

fn configured_magnet_trackers(trackers: &[TrackerUrl]) -> Vec<TrackerConfig> {
    trackers
        .iter()
        .enumerate()
        .map(|(position, tracker)| TrackerConfig {
            url: tracker.url().to_owned(),
            endpoint: match tracker.transport() {
                TrackerUrlTransport::Udp => TrackerEndpoint::Udp(
                    tracker
                        .udp_endpoint()
                        .expect("parsed UDP tracker retains its endpoint")
                        .clone(),
                ),
                TrackerUrlTransport::Http | TrackerUrlTransport::Https => {
                    TrackerEndpoint::from_http_url(tracker.url())
                        .expect("parsed HTTP tracker retains a supported URL")
                }
            },
            tier: 0,
            position: position.try_into().unwrap_or(u32::MAX),
            source: crate::tracker::TrackerSource::Magnet,
        })
        .collect()
}

async fn run_metadata_peer(
    mut connection: PeerConnection,
    handshake: Handshake,
    context: MetadataWorkerRunContext,
) -> MetadataPeerResult {
    let MetadataWorkerRunContext {
        identity,
        cancellation,
        admission_cancellation,
        control,
        metadata,
        turnover,
    } = context;
    if matches!(identity, FullInfoHash::V2(_)) {
        connection.set_protocol(PeerProtocol::V2);
    }
    let attempt = connection.attempt();
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => None,
        _ = async {
            if let Some(cancellation) = &admission_cancellation {
                cancellation.cancelled().await;
            }
        }, if admission_cancellation.is_some() => None,
        result = acquire_metadata_from_connection(
            &mut connection,
            handshake,
            identity,
            &control,
            &metadata,
        ) => {
            Some(result)
        }
    };
    {
        let mut download = metadata
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        download.remove_peer(attempt.id().get());
        control.observe_metadata_download(&download);
    }
    match &result {
        Some(Ok(_)) => {
            control.metadata_peer_finished(attempt.id(), MetadataPeerStage::Complete, None)
        }
        Some(Err(error)) => {
            let detail = error.to_string();
            control.metadata_peer_finished(attempt.id(), MetadataPeerStage::Failed, Some(&detail));
        }
        None => {
            let detail = if turnover.load(Ordering::Acquire) {
                "metadata peer replaced after saturated no-progress grace"
            } else {
                "metadata attempt cancelled"
            };
            control.metadata_peer_finished(
                attempt.id(),
                MetadataPeerStage::Cancelled,
                Some(detail),
            );
        }
    }
    match result {
        Some(Ok((raw_info, metainfo))) => MetadataPeerResult::Complete {
            connection,
            raw_info,
            metainfo: Box::new(metainfo),
        },
        Some(Err(error)) => MetadataPeerResult::Failed { connection, error },
        None => MetadataPeerResult::Cancelled {
            connection,
            turnover: turnover.load(Ordering::Acquire),
        },
    }
}

async fn cleanup_metadata_attempts(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    workers: &mut JoinSet<MetadataPeerResult>,
    worker_controls: &mut BTreeMap<DialAttemptId, MetadataWorkerControl>,
) -> Result<(), DownloadError> {
    let mut first_error = None;
    for attempt in sockets
        .pending_attempts()
        .into_iter()
        .chain(worker_controls.values().map(|worker| worker.attempt))
    {
        if let Err(error) = peers.begin_disconnect(attempt, None)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    for worker in worker_controls.values() {
        worker.cancellation.cancel();
    }

    match std::mem::take(sockets).shutdown().await {
        Ok(pending) => {
            for (attempt, utp_outcome) in pending {
                if let Err(error) = peers.record_utp_outcome(attempt, utp_outcome)
                    && first_error.is_none()
                {
                    first_error = Some(error);
                }
                if let Err(error) = peers.dial_cancelled(attempt)
                    && first_error.is_none()
                {
                    first_error = Some(error);
                }
            }
        }
        Err(error) => first_error = Some(download_peer_set_error(error)),
    }

    while let Some(joined) = workers.join_next().await {
        match joined {
            Ok(result) => {
                let attempt = result.attempt();
                worker_controls.remove(&attempt.id());
                if let Err(error) = peers.connection_closed(attempt, None)
                    && first_error.is_none()
                {
                    first_error = Some(error);
                }
            }
            Err(error) if first_error.is_none() => {
                first_error = Some(DownloadError::PeerTask(error.to_string()));
            }
            Err(_) => {}
        }
    }
    for (_, worker) in std::mem::take(worker_controls) {
        if let Err(error) = peers.connection_closed(worker.attempt, None)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }

    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn peer_failure(error: &DownloadError) -> PeerFailure {
    match error {
        DownloadError::Io {
            operation: "connect to peer",
            ..
        }
        | DownloadError::PeerTimedOut {
            operation: "connect",
            ..
        } => PeerFailure::Connect,
        DownloadError::PeerTimedOut {
            operation: "handshake read" | "handshake write" | "handshake compute",
            ..
        } => PeerFailure::Handshake,
        DownloadError::Handshake(_) => PeerFailure::Handshake,
        DownloadError::PeerClosed => PeerFailure::RemoteClosed,
        _ => PeerFailure::Protocol,
    }
}

fn content_peer_failure(error: &DownloadError) -> Option<PeerFailure> {
    match error {
        DownloadError::PeerClosed => Some(PeerFailure::RemoteClosed),
        DownloadError::Frame(_)
        | DownloadError::Piece(_)
        | DownloadError::Handshake(_)
        | DownloadError::InvalidPremetadataState(_)
        | DownloadError::Metadata(_)
        | DownloadError::MetadataExtensionDisabled
        | DownloadError::ExtensionProtocolUnsupported
        | DownloadError::PeerTimedOut {
            operation: "message read" | "message write",
            ..
        } => Some(peer_failure(error)),
        DownloadError::Io {
            operation: "read peer message" | "send peer message",
            ..
        } => Some(PeerFailure::RemoteClosed),
        _ => None,
    }
}

async fn run_magnet_download(
    config: MagnetDownloadConfig,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    let magnet = Magnet::parse(&config.magnet).map_err(DownloadError::Magnet)?;
    validate_magnet_runtime_identity(config.identity, magnet.identity)?;
    let mut peers = TorrentPeerCoordinator::from_magnet(
        &magnet,
        config.network,
        control.clone(),
        config.dht.clone(),
    )
    .await?;
    let result = run_magnet_download_with_peers(config, control, magnet, &mut peers).await;
    let tracker_shutdown = if result.is_ok() {
        peers.finish_tracker().await
    } else {
        peers.shutdown_tracker().await
    };
    merge_tracker_shutdown(result, tracker_shutdown)
}

async fn run_magnet_download_with_peers(
    config: MagnetDownloadConfig,
    control: DownloadControl,
    magnet: Magnet,
    peers: &mut TorrentPeerCoordinator,
) -> Result<DownloadReport, DownloadError> {
    let (raw_info, metainfo) = peers
        .acquire_metadata(magnet.identity, config.resource_limits.metadata_connections)
        .await?;
    let content = runtime_content_from_acquired(&raw_info, metainfo)?;
    peers.set_content_identities(content.content.info_hashes());
    peers.ensure_tracker_lanes()?;
    reconnect_v1_metadata_peer_for_hybrid_hashes(peers, &content.content)?;
    let skip_files = effective_magnet_skip_files(&magnet, &content.content, config.skip_files)?;
    let content_config = ContentDownloadConfig {
        artifact_identity: TorrentArtifactIdentity {
            torrent_id: config.identity.torrent_id(),
            content_fingerprint: ContentFingerprint::for_info_bytes(&raw_info),
        },
        output_path: config.output_path,
        max_buffered_payload_bytes: config.resource_limits.max_buffered_payload_bytes,
        storage_intake_high_watermark_bytes: config
            .resource_limits
            .storage_intake_high_watermark_bytes,
        swarm_config: config.resource_limits.swarm_config(),
        skip_files,
        high_priority_files: config.high_priority_files,
    };
    run_content_download(content_config, content, control, None, peers, None).await
}

fn reconnect_v1_metadata_peer_for_hybrid_hashes(
    peers: &mut TorrentPeerCoordinator,
    content: &TorrentContent,
) -> Result<(), DownloadError> {
    if content.info_hashes().is_hybrid()
        && peers
            .connection
            .as_ref()
            .is_some_and(|connection| connection.protocol() == PeerProtocol::V1)
    {
        peers.close_current(None)?;
    }
    Ok(())
}

fn effective_magnet_skip_files(
    magnet: &Magnet,
    content: &TorrentContent,
    configured: Vec<usize>,
) -> Result<Vec<usize>, DownloadError> {
    let Some(selection) = magnet.select_only.as_ref() else {
        return Ok(configured);
    };
    let file_count = content.files().len();
    let file_count_u32 = u32::try_from(file_count)
        .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
    if selection
        .ranges()
        .iter()
        .any(|range| range.end as usize >= file_count)
    {
        return Err(DownloadError::Magnet(
            MagnetError::SelectOnlyIndexOutOfRange {
                maximum_exclusive: file_count_u32,
            },
        ));
    }
    if !configured.is_empty() {
        return Ok(configured);
    }
    Ok(content
        .files()
        .enumerate()
        .filter_map(|(index, file)| {
            let index_u32 = u32::try_from(index).ok()?;
            (!file.padding()
                && !selection
                    .ranges()
                    .iter()
                    .any(|range| range.start <= index_u32 && index_u32 <= range.end))
            .then_some(index)
        })
        .collect())
}

async fn run_magnet_metadata(
    config: MagnetMetadataRuntimeConfig,
    control: DownloadControl,
    dht: Option<DhtHandle>,
    configured_trackers: Option<Vec<TrackerConfig>>,
    resources: TorrentPeerResources,
) -> Result<Vec<u8>, DownloadError> {
    let magnet = Magnet::parse(&config.magnet).map_err(DownloadError::Magnet)?;
    validate_magnet_runtime_identity(config.identity, magnet.identity)?;
    let mut peers = TorrentPeerCoordinator::from_magnet_with_trackers(
        &magnet,
        configured_trackers,
        config.network,
        control,
        dht,
        resources,
    )
    .await?;
    let result = async {
        let (raw_info, _) = peers
            .acquire_metadata(magnet.identity, config.connections)
            .await?;
        peers.close_current(None)?;
        Ok(raw_info)
    }
    .await;
    merge_tracker_shutdown(result, peers.shutdown_tracker().await)
}

fn merge_tracker_shutdown<T>(
    result: Result<T, DownloadError>,
    shutdown: Result<(), DownloadError>,
) -> Result<T, DownloadError> {
    match (result, shutdown) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) | (Err(error), Ok(())) => Err(error),
        (Err(error), Err(cleanup)) => Err(DownloadError::PeerCleanup {
            failure: error.to_string(),
            cleanup: cleanup.to_string(),
        }),
    }
}

#[derive(Clone)]
struct ResumeContext {
    raw_info: Option<Arc<[u8]>>,
    verified_pieces: Vec<bool>,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    initialize_descriptors: bool,
    validation: ResumeValidationIntent,
    download_missing: bool,
}

async fn run_resumable_magnet_download(
    config: ResumableMagnetDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
    descriptors: Option<(DescriptorStorage, bool)>,
) -> Result<DownloadReport, DownloadError> {
    let magnet = Magnet::parse(&config.magnet).map_err(DownloadError::Magnet)?;
    validate_magnet_runtime_identity(config.identity, magnet.identity)?;
    let dht = config.dht.clone();
    let configured_trackers = config.trackers.clone();
    let torrent_peers = config.torrent_peers.clone();
    let mut resume = ResumeContext {
        raw_info: config.verified_info.map(Arc::from),
        verified_pieces: config.verified_pieces,
        checkpoints: checkpoints.clone(),
        validation: config.resume_validation,
        download_missing: config.download_missing,
        initialize_descriptors: descriptors
            .as_ref()
            .is_some_and(|(_, initialize)| *initialize),
    };
    let descriptors = descriptors.map(|(descriptors, _)| descriptors);

    if let Some(raw_info) = resume.raw_info.as_ref() {
        let parsed = ParsedInfo::from_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
            .map_err(DownloadError::Metainfo)?;
        if !metadata_matches_known_identities(parsed.info_hashes(), magnet.identities) {
            return Err(DownloadError::Checkpoint(
                "stored metadata does not match the magnet identity".to_owned(),
            ));
        }
        let runtime_content = match parsed.kind() {
            ParsedInfoKind::V1(metainfo) => {
                TorrentContent::from_v1_metainfo(metainfo.clone()).into()
            }
            ParsedInfoKind::V2(_) => {
                TorrentContent::from_v2_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                    .map_err(DownloadError::Metainfo)?
            }
            ParsedInfoKind::Hybrid(_) => TorrentContent::from_hybrid_info_bytes_with_limits(
                raw_info,
                DURABLE_METAINFO_LIMITS,
            )
            .map_err(DownloadError::Metainfo)?,
        };
        if descriptors.is_some()
            && matches!(
                &runtime_content.content,
                TorrentContent::V2(_) | TorrentContent::Hybrid(_)
            )
        {
            return Err(DownloadError::Checkpoint(
                "descriptor storage does not support v2 content".to_owned(),
            ));
        }
        validate_content_name(runtime_content.content.name())
            .map_err(DownloadError::SelectiveStorage)?;
        let content_dht = if runtime_content.content.private() {
            control.emit(DownloadActivityEvent::DhtDisabledForPrivateTorrent);
            None
        } else {
            dht.clone()
        };
        let mut peers = TorrentPeerCoordinator::from_magnet_with_trackers(
            &magnet,
            configured_trackers,
            config.network,
            control.clone(),
            content_dht,
            TorrentPeerResources {
                peer_budget: config.peer_budget.clone(),
                torrent_peers: torrent_peers.clone(),
                mse_dh: config.mse_dh.clone(),
                encryption: config.encryption.clone(),
                peer_exchange: config.peer_exchange.clone(),
            },
        )
        .await?;
        let output_path = if descriptors.is_some() {
            PathBuf::new()
        } else {
            config.storage_root.join(runtime_content.content.name())
        };
        // Once metadata is durable, the caller's selection is authoritative.
        // Reapplying the magnet's original `so` parameter here would undo a
        // later file-priority promotion on resume.
        let skip_files = config.skip_files;
        let content_config = ContentDownloadConfig {
            artifact_identity: TorrentArtifactIdentity {
                torrent_id: config.identity.torrent_id(),
                content_fingerprint: ContentFingerprint::for_info_bytes(raw_info),
            },
            output_path,
            max_buffered_payload_bytes: config.resource_limits.max_buffered_payload_bytes,
            storage_intake_high_watermark_bytes: config
                .resource_limits
                .storage_intake_high_watermark_bytes,
            swarm_config: config.resource_limits.swarm_config(),
            skip_files,
            high_priority_files: config.high_priority_files,
        };
        let result = run_content_download(
            content_config,
            runtime_content,
            control,
            descriptors,
            &mut peers,
            Some(resume),
        )
        .await;
        let tracker_shutdown = if result.is_ok() {
            peers.finish_tracker().await
        } else {
            peers.shutdown_tracker().await
        };
        return merge_tracker_shutdown(result, tracker_shutdown);
    }

    if descriptors.is_some() {
        return Err(DownloadError::Checkpoint(
            "descriptor storage requires verified metadata".to_owned(),
        ));
    }
    let mut peers = TorrentPeerCoordinator::from_magnet_with_trackers(
        &magnet,
        configured_trackers,
        config.network,
        control.clone(),
        dht,
        TorrentPeerResources {
            peer_budget: config.peer_budget.clone(),
            torrent_peers,
            mse_dh: config.mse_dh,
            encryption: config.encryption,
            peer_exchange: config.peer_exchange,
        },
    )
    .await?;
    let result = async {
        let (raw_info, metainfo) = peers
            .acquire_metadata(magnet.identity, config.resource_limits.metadata_connections)
            .await?;
        let parsed = ParsedInfo::from_bytes_with_limits(&raw_info, DURABLE_METAINFO_LIMITS)
            .map_err(DownloadError::Metainfo)?;
        if !metadata_matches_known_identities(parsed.info_hashes(), magnet.identities) {
            peers.close_current(None)?;
            return Err(DownloadError::InvalidPremetadataState(
                "metadata does not match every known magnet identity",
            ));
        }
        let runtime_content = runtime_content_from_acquired(&raw_info, metainfo)?;
        peers.set_content_identities(runtime_content.content.info_hashes());
        peers.ensure_tracker_lanes()?;
        reconnect_v1_metadata_peer_for_hybrid_hashes(&mut peers, &runtime_content.content)?;
        validate_content_name(runtime_content.content.name())
            .map_err(DownloadError::SelectiveStorage)?;
        if let Err(message) = checkpoints.metadata_verified(&raw_info) {
            peers.close_current(None)?;
            return Err(DownloadError::Checkpoint(message));
        }
        let content_fingerprint = ContentFingerprint::for_info_bytes(&raw_info);
        let resolved = checkpoints
            .metadata_file_selection()
            .map_err(DownloadError::Checkpoint)?;
        let (skip_files, high_priority_files) = match resolved {
            Some(selection) => {
                control.update_file_selection(selection.clone());
                (selection.skip_files, selection.high_priority_files)
            }
            None => (
                effective_magnet_skip_files(&magnet, &runtime_content.content, config.skip_files)?,
                config.high_priority_files,
            ),
        };
        resume.raw_info = Some(raw_info.into());
        let content_config = ContentDownloadConfig {
            artifact_identity: TorrentArtifactIdentity {
                torrent_id: config.identity.torrent_id(),
                content_fingerprint,
            },
            output_path: config.storage_root.join(runtime_content.content.name()),
            max_buffered_payload_bytes: config.resource_limits.max_buffered_payload_bytes,
            storage_intake_high_watermark_bytes: config
                .resource_limits
                .storage_intake_high_watermark_bytes,
            swarm_config: config.resource_limits.swarm_config(),
            skip_files,
            high_priority_files,
        };
        run_content_download(
            content_config,
            runtime_content,
            control,
            None,
            &mut peers,
            Some(resume),
        )
        .await
    }
    .await;
    let tracker_shutdown = if result.is_ok() {
        peers.finish_tracker().await
    } else {
        peers.shutdown_tracker().await
    };
    merge_tracker_shutdown(result, tracker_shutdown)
}

async fn run_resumable_metainfo_download(
    config: ResumableMetainfoDownloadConfig,
    checkpoints: Arc<dyn DownloadCheckpointSink>,
    control: DownloadControl,
) -> Result<DownloadReport, DownloadError> {
    let projection = TorrentContentProjection::from_bytes_with_limits(
        &config.metainfo_source,
        DURABLE_METAINFO_LIMITS,
    )
    .map_err(DownloadError::Metainfo)?;
    let raw_info_span = projection.info_span.clone();
    let content = &projection.content;
    validate_content_runtime_identity(config.identity, content)?;
    validate_content_name(content.name()).map_err(DownloadError::SelectiveStorage)?;
    let raw_info = Arc::<[u8]>::from(
        config.metainfo_source[raw_info_span]
            .to_vec()
            .into_boxed_slice(),
    );
    let swarm_key = config.identity.swarm_key();
    let content_dht = if content.private() {
        control.emit(DownloadActivityEvent::DhtDisabledForPrivateTorrent);
        None
    } else {
        config.dht.clone()
    };
    let trackers = config.trackers.clone().unwrap_or_default();
    let mut peers = TorrentPeerCoordinator::from_complete_content(
        swarm_key,
        content.info_hashes(),
        trackers,
        config.network,
        control.clone(),
        content_dht,
        TorrentPeerResources {
            peer_budget: config.peer_budget,
            torrent_peers: config.torrent_peers,
            mse_dh: config.mse_dh,
            encryption: config.encryption,
            peer_exchange: config.peer_exchange,
        },
    )?;
    let resume = ResumeContext {
        raw_info: Some(raw_info.clone()),
        verified_pieces: config.verified_pieces,
        checkpoints,
        initialize_descriptors: false,
        validation: config.resume_validation,
        download_missing: config.download_missing,
    };
    let content_config = ContentDownloadConfig {
        artifact_identity: TorrentArtifactIdentity {
            torrent_id: config.identity.torrent_id(),
            content_fingerprint: ContentFingerprint::for_info_bytes(&raw_info),
        },
        output_path: config.storage_root.join(content.name()),
        max_buffered_payload_bytes: config.resource_limits.max_buffered_payload_bytes,
        storage_intake_high_watermark_bytes: config
            .resource_limits
            .storage_intake_high_watermark_bytes,
        swarm_config: config.resource_limits.swarm_config(),
        skip_files: config.skip_files,
        high_priority_files: config.high_priority_files,
    };
    let result = run_content_download(
        content_config,
        projection,
        control,
        None,
        &mut peers,
        Some(resume),
    )
    .await;
    let tracker_shutdown = if result.is_ok() {
        peers.finish_tracker().await
    } else {
        peers.shutdown_tracker().await
    };
    merge_tracker_shutdown(result, tracker_shutdown)
}

async fn acquire_metadata_from_connection(
    peer: &mut PeerConnection,
    handshake: Handshake,
    identity: FullInfoHash,
    control: &DownloadControl,
    metadata: &Arc<Mutex<TorrentMetadataDownload>>,
) -> Result<(Vec<u8>, AcquiredMetainfo), DownloadError> {
    if !handshake.supports_extensions() {
        return Err(DownloadError::ExtensionProtocolUnsupported);
    }
    if peer.supports_fast_extension() {
        send_message(peer, &PeerMessage::HaveNone).await?;
    }
    peer.mark_initial_availability_sent();
    send_message(
        peer,
        &PeerMessage::Extended {
            id: 0,
            payload: encode_extension_handshake(None),
        },
    )
    .await?;

    let fast_extension = NegotiatedPeerCapabilities::negotiate(
        peer_socket::advertised_reserved_bits(true),
        &handshake,
    )
    .fast_extension;
    let mut peer_state = PremetadataPeerState::new(fast_extension);
    let mut remote_metadata_id = None;
    let mut received_extension_handshake = false;
    let metadata_progress_timeout = peer.io_timeout();
    let mut progress_deadline = TokioInstant::now() + metadata_progress_timeout;
    loop {
        if !peer.download_rate_limited() && TokioInstant::now() >= progress_deadline {
            return Err(DownloadError::PeerTimedOut {
                operation: "metadata progress",
                timeout: metadata_progress_timeout,
            });
        }
        if let Some(remote_id) = remote_metadata_id {
            let requests_sent = send_torrent_metadata_requests(
                peer,
                remote_id,
                metadata_instant(control.diagnostic_elapsed()),
                metadata,
            )
            .await?;
            let download = metadata
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            control.metadata_requests_sent(peer.attempt().id(), &download, requests_sent);
        }

        let scheduler_wake = TokioInstant::now() + METADATA_SCHEDULER_TICK;
        let message = tokio::select! {
            result = next_peer_message(peer) => Some(result?),
            _ = tokio::time::sleep_until(scheduler_wake) => None,
        };
        let Some(message) = message else {
            if !peer.download_rate_limited() && TokioInstant::now() >= progress_deadline {
                return Err(DownloadError::PeerTimedOut {
                    operation: "metadata progress",
                    timeout: metadata_progress_timeout,
                });
            }
            continue;
        };
        control.metadata_peer_message(peer.attempt().id());
        match message {
            PeerMessage::Extended { id: 0, payload } => {
                let recognized = parse_recognized_extension_handshake(&payload)
                    .map_err(|error| DownloadError::Metadata(error.into()))?;
                peer.apply_extension_handshake(recognized);
                let handshake =
                    parse_extension_handshake(&payload).map_err(DownloadError::Metadata)?;
                if !received_extension_handshake
                    && handshake.metadata_extension == MetadataExtensionUpdate::Unchanged
                {
                    return Err(DownloadError::MetadataExtensionDisabled);
                }
                received_extension_handshake = true;
                match handshake.metadata_extension {
                    MetadataExtensionUpdate::Disabled => {
                        return Err(DownloadError::MetadataExtensionDisabled);
                    }
                    MetadataExtensionUpdate::Enabled(id) => {
                        remote_metadata_id = Some(id);
                        metadata
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .register_peer(peer.attempt().id().get(), handshake.metadata_size)
                            .map_err(DownloadError::Metadata)?;
                    }
                    MetadataExtensionUpdate::Unchanged => {
                        if let Some(size) = handshake.metadata_size {
                            metadata
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner())
                                .accept_peer_size(peer.attempt().id().get(), size)
                                .map_err(DownloadError::Metadata)?;
                        }
                    }
                }
                let requests_sent = match remote_metadata_id {
                    Some(remote_id) => {
                        send_torrent_metadata_requests(
                            peer,
                            remote_id,
                            metadata_instant(control.diagnostic_elapsed()),
                            metadata,
                        )
                        .await?
                    }
                    None => 0,
                };
                let download = metadata
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                control.metadata_extension_handshake(
                    peer.attempt().id(),
                    remote_metadata_id,
                    &download,
                    requests_sent,
                );
                progress_deadline = TokioInstant::now() + metadata_progress_timeout;
            }
            PeerMessage::Extended {
                id: UT_METADATA_LOCAL_ID,
                payload,
            } => {
                let message = parse_metadata_message(&payload).map_err(DownloadError::Metadata)?;
                if let MetadataMessage::Request { piece } = message {
                    if let Some(remote_id) = remote_metadata_id {
                        send_message(
                            peer,
                            &PeerMessage::Extended {
                                id: remote_id,
                                payload: encode_metadata_reject(piece),
                            },
                        )
                        .await?;
                    }
                    continue;
                }
                match message {
                    MetadataMessage::Data {
                        piece,
                        total_size,
                        block,
                    } => {
                        let block_bytes = block.len();
                        let event = metadata
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .on_data(
                                peer.attempt().id().get(),
                                piece,
                                total_size,
                                block,
                                metadata_instant(control.diagnostic_elapsed()),
                            )
                            .map_err(DownloadError::Metadata)?;
                        let completed = match event {
                            TorrentMetadataEvent::Complete(bytes) => Some(bytes),
                            TorrentMetadataEvent::HashMismatch { contributors } => {
                                control.metadata_hash_failed(contributors.len());
                                None
                            }
                            TorrentMetadataEvent::BlockAccepted { .. }
                            | TorrentMetadataEvent::Duplicate { .. } => None,
                        };
                        if let Some(bytes) = completed {
                            let download = metadata
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            control.metadata_block_received(
                                peer.attempt().id(),
                                block_bytes,
                                &download,
                                0,
                            );
                            drop(download);
                            return finish_metadata_acquisition(bytes, identity, peer_state, peer);
                        }
                        let requests_sent = match remote_metadata_id {
                            Some(remote_id) => {
                                send_torrent_metadata_requests(
                                    peer,
                                    remote_id,
                                    metadata_instant(control.diagnostic_elapsed()),
                                    metadata,
                                )
                                .await?
                            }
                            None => 0,
                        };
                        let download = metadata
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        control.metadata_block_received(
                            peer.attempt().id(),
                            block_bytes,
                            &download,
                            requests_sent,
                        );
                        progress_deadline = TokioInstant::now() + metadata_progress_timeout;
                    }
                    MetadataMessage::Reject { piece } => {
                        let mut download = metadata
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        download
                            .on_reject(
                                peer.attempt().id().get(),
                                piece,
                                metadata_instant(control.diagnostic_elapsed()),
                            )
                            .map_err(DownloadError::Metadata)?;
                        control.metadata_rejected(peer.attempt().id(), &download);
                        return Err(DownloadError::Metadata(MetadataError::Rejected {
                            piece: u32::try_from(piece).expect("validated metadata piece"),
                        }));
                    }
                    MetadataMessage::Unknown { .. } => {}
                    MetadataMessage::Request { .. } => unreachable!("request returned above"),
                }
            }
            PeerMessage::Extended { .. } => {}
            message => peer_state.observe(message)?,
        }
    }
}

async fn send_torrent_metadata_requests(
    peer: &mut PeerConnection,
    remote_metadata_id: u8,
    now: MetadataInstant,
    metadata: &Arc<Mutex<TorrentMetadataDownload>>,
) -> Result<usize, DownloadError> {
    let requests = metadata
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .requests_for_peer(peer.attempt().id().get(), now)
        .map_err(DownloadError::Metadata)?;
    for piece in &requests {
        send_message(
            peer,
            &PeerMessage::Extended {
                id: remote_metadata_id,
                payload: encode_metadata_request(*piece),
            },
        )
        .await?;
    }
    Ok(requests.len())
}

fn metadata_instant(elapsed: Duration) -> MetadataInstant {
    MetadataInstant::from_millis(u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
}

fn finish_metadata_acquisition(
    bytes: Vec<u8>,
    identity: FullInfoHash,
    peer_state: PremetadataPeerState,
    peer: &mut PeerConnection,
) -> Result<(Vec<u8>, AcquiredMetainfo), DownloadError> {
    let parsed = ParsedInfo::from_bytes_with_limits(&bytes, BEP9_METAINFO_LIMITS)
        .map_err(DownloadError::Metainfo)?;
    if !parsed.info_hashes().contains(identity) {
        return Err(DownloadError::InvalidPremetadataState(
            "metadata protocol identity does not match the magnet",
        ));
    }
    let metainfo = match parsed.kind() {
        ParsedInfoKind::V1(metainfo) => AcquiredMetainfo::V1(metainfo.clone()),
        ParsedInfoKind::V2(metainfo) => AcquiredMetainfo::V2(metainfo.clone()),
        ParsedInfoKind::Hybrid(metainfo) => AcquiredMetainfo::Hybrid(metainfo.clone()),
    };
    peer.prepend_messages(peer_state.validated_messages(metainfo.piece_count())?);
    Ok((bytes, metainfo))
}

async fn run_download(
    config: DownloadConfig,
    control: DownloadControl,
    descriptors: Option<DescriptorStorage>,
    peer_state: Option<(PeerBudget, TorrentPeerHandle)>,
) -> Result<DownloadReport, DownloadError> {
    let metainfo_bytes = read_bounded_metainfo(&config.metainfo_path).await?;
    let raw_info = Metainfo::info_bytes_with_limits(&metainfo_bytes, BEP9_METAINFO_LIMITS)
        .map_err(DownloadError::Metainfo)?;
    let metainfo = Metainfo::from_bytes_with_limits(&metainfo_bytes, BEP9_METAINFO_LIMITS)
        .map_err(DownloadError::Metainfo)?;
    validate_v1_runtime_identity(config.identity, metainfo.info_hash)?;
    let mut peers = match peer_state {
        Some((peer_budget, torrent_peers)) => {
            let mut peers = TorrentPeerCoordinator::new_with_peer_state(
                config.network,
                control.clone(),
                peer_budget,
                Some(torrent_peers),
                MseDhWorkOwner::new(),
                PeerEncryptionPolicyHandle::new(config.network.encryption),
                PeerExchangePolicyHandle::new(config.network.peer_exchange),
            )?;
            peers.observe_address(config.peer, PeerSource::Manual)?;
            peers
        }
        None => TorrentPeerCoordinator::from_endpoint_with_control(
            config.peer,
            PeerSource::Manual,
            config.network,
            control.clone(),
        )?,
    };
    let content_config = ContentDownloadConfig {
        artifact_identity: TorrentArtifactIdentity {
            torrent_id: config.identity.torrent_id(),
            content_fingerprint: ContentFingerprint::for_info_bytes(raw_info),
        },
        output_path: config.output_path,
        max_buffered_payload_bytes: config.resource_limits.max_buffered_payload_bytes,
        storage_intake_high_watermark_bytes: config
            .resource_limits
            .storage_intake_high_watermark_bytes,
        swarm_config: config.resource_limits.swarm_config(),
        skip_files: config.skip_files,
        high_priority_files: config.high_priority_files,
    };
    let result = run_content_download(
        content_config,
        TorrentContent::from_v1_metainfo(metainfo),
        control,
        descriptors,
        &mut peers,
        None,
    )
    .await;
    merge_tracker_shutdown(result, peers.shutdown_tracker().await)
}

async fn run_content_download(
    config: ContentDownloadConfig,
    content: impl Into<TorrentContentWithIntegrity>,
    control: DownloadControl,
    descriptors: Option<DescriptorStorage>,
    peers: &mut TorrentPeerCoordinator,
    resume: Option<ResumeContext>,
) -> Result<DownloadReport, DownloadError> {
    let content = content.into();
    peers.control = control.clone();
    if peers.owns_peer_sink {
        peers.peers.set_sink(Arc::new(control.clone()));
    }
    peers.publish_peer_registry(true);
    let result = run_selective_download(config, content, control, descriptors, peers, resume).await;
    peers.close_current(result.as_ref().err().and_then(content_peer_failure))?;
    result
}

#[cfg(test)]
use storage_pipeline::{
    CHECKPOINT_MAX_DIRTY_BYTES, CONTENT_STORAGE_WRITE_BATCH_BLOCKS,
    CONTENT_STORAGE_WRITE_BATCH_BYTES, CoalescedContentWrite, ContentCheckpointPipeline,
    ContentWriteStats, PreparedContentWrite, QueuedContentStorageCommand, coalesce_content_writes,
    collect_content_write_batch, content_storage_job_limit, execute_content_storage_verification,
    execute_content_storage_writes,
};
use storage_pipeline::{
    ContentStorage, ContentStorageCommand, ContentStorageCompletion, ContentStoragePipeline,
    content_hash_outcome,
};

struct ContentSwarmDownload<'a> {
    state: SwarmState,
    storage_pipeline: Option<ContentStoragePipeline>,
    completed_storage: Option<ContentStorage>,
    availability: PieceAvailability,
    active_content: ActiveSeedContent,
    active_upload_failure: ActiveUploadFailureSignal,
    active_registration: Option<(IncomingPeerHandle, Vec<SeedRegistrationToken>)>,
    outgoing_uploads: BTreeMap<ConnectionId, OutgoingUploadPeer>,
    incoming_content: BTreeMap<ConnectionId, IncomingContentPeer>,
    content: &'a TorrentContent,
    integrity: &'a mut TorrentIntegrity,
    hash_scheduler: V2HashScheduler,
    v2_hashes: Option<Arc<V2SeedHashService>>,
    leaf_diagnosis: Option<V2LeafDiagnosis>,
    candidate_pieces: BTreeSet<u32>,
    candidate_verifications: BTreeSet<u32>,
    layout: &'a ContentLayout,
    resume: Option<&'a ResumeContext>,
    control: &'a DownloadControl,
    total_blocks: usize,
    total_bytes: usize,
    selected_written_bytes: usize,
    part_written_bytes: usize,
    last_piece: Option<VerifiedPiece>,
    contributor_attempts: BTreeMap<ConnectionId, ContentContributor>,
    selection: FileSelection,
    high_priority_files: Vec<usize>,
    streaming_cursor: StreamingCandidateCursor,
    maximum_planned_bytes: usize,
    storage_limits: ContentStorageLimits,
    selection_revision: u64,
}

struct V2LeafDiagnosis {
    piece: u32,
    generation: crate::swarm::PieceGeneration,
    geometry: V2FileHashGeometry,
    first_leaf: u64,
    scheduler: V2HashScheduler,
    local_leaves: Option<Vec<Sha256Hash>>,
    deadline: Duration,
}

struct IncomingContentPeer {
    attachment: IncomingPeerAttachment,
    protocol: PeerProtocol,
    commands: mpsc::Sender<IncomingContentCommand>,
}

#[derive(Clone, Copy)]
enum ContentContributor {
    Outgoing(DialAttempt),
    Incoming(IncomingPeerAttachment),
}

struct OutgoingUploadPeer {
    state: UploadPeerState,
    piece_lengths: Arc<[u32]>,
    hybrid_padding: Option<Arc<HybridPaddingMap>>,
    cursor: AvailabilityCursor,
    pending_initial_haves: Option<(AvailabilitySnapshot, usize)>,
    membership: Option<SessionUploadMembership>,
    read: Option<OutgoingUploadRead>,
}

struct OutgoingUploadRead {
    pending: UploadRead,
    task: JoinHandle<Result<Vec<u8>, ()>>,
}

struct AppliedFileSelection {
    selection: FileSelection,
    high_priority_files: Vec<usize>,
    revision: u64,
}

struct ContentDownloadContext<'a> {
    content: &'a TorrentContent,
    integrity: &'a mut TorrentIntegrity,
    layout: &'a ContentLayout,
    resume: Option<&'a ResumeContext>,
    control: &'a DownloadControl,
    candidate_pieces: BTreeSet<u32>,
}

#[cfg(test)]
fn build_content_plan_window(
    layout: &ContentLayout,
    selection: &FileSelection,
    pieces: &mut std::vec::IntoIter<u32>,
    maximum_pieces: usize,
    maximum_bytes: usize,
    permit_first_over_limit: bool,
) -> Result<(Vec<PiecePlan>, usize, usize), DownloadError> {
    let mut plans = Vec::with_capacity(maximum_pieces);
    let mut total_blocks = 0_usize;
    let mut total_bytes = 0_usize;
    while plans.len() < maximum_pieces {
        let Some(&piece) = pieces.as_slice().first() else {
            break;
        };
        let (plan, block_count, piece_bytes) = build_content_piece_plan(layout, selection, piece)?;
        let next_total_bytes = total_bytes
            .checked_add(piece_bytes)
            .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        if next_total_bytes > maximum_bytes && (!plans.is_empty() || !permit_first_over_limit) {
            break;
        }
        pieces.next();
        total_blocks = total_blocks
            .checked_add(block_count)
            .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        total_bytes = next_total_bytes;
        plans.push(plan);
    }
    Ok((plans, total_blocks, total_bytes))
}

fn build_content_piece_plan(
    layout: &ContentLayout,
    selection: &FileSelection,
    piece: u32,
) -> Result<(PiecePlan, usize, usize), DownloadError> {
    let ranges = layout
        .request_ranges(piece, selection)
        .map_err(DownloadError::Layout)?;
    let block_count = ranges.len();
    let piece_bytes = ranges.iter().try_fold(0_usize, |total, range| {
        total.checked_add(range.length as usize)
    });
    let piece_bytes = piece_bytes.ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
    let ranges = ranges
        .into_iter()
        .map(|range| (range.begin, range.length))
        .collect::<Vec<_>>();
    let plan = PiecePlan::new(piece, &ranges).map_err(DownloadError::Swarm)?;
    Ok((plan, block_count, piece_bytes))
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ContentMessageDisposition {
    Continue,
    ClosePeer {
        failure: PeerFailure,
        reason: &'static str,
    },
    PieceVerified(Vec<ConnectionId>),
    PieceHashFailed(PieceHashFailure),
}

impl<'a> ContentSwarmDownload<'a> {
    async fn new(
        config: SwarmConfig,
        storage_limits: ContentStorageLimits,
        wanted_pieces: Vec<u32>,
        picker_seed: u64,
        selection: AppliedFileSelection,
        storage: ContentStorage,
        context: ContentDownloadContext<'a>,
    ) -> Result<Self, DownloadError> {
        let ContentDownloadContext {
            content,
            integrity,
            layout,
            resume,
            control,
            candidate_pieces,
        } = context;
        let piece_priorities = layout
            .piece_priorities(&selection.selection, &selection.high_priority_files)
            .map_err(DownloadError::Layout)?;
        let mut requestable_pieces = Vec::new();
        let mut hash_needs = Vec::new();
        let mut ready_candidates = Vec::new();
        for piece in wanted_pieces {
            let piece_index = usize::try_from(piece)
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            let candidate = candidate_pieces.contains(&piece);
            match content {
                TorrentContent::V1(_) => requestable_pieces.push(piece),
                TorrentContent::V2(_) | TorrentContent::Hybrid(_) => match content
                    .v2_expected_piece(&*integrity, piece)
                    .map_err(|error| DownloadError::StorageTask(error.to_string()))?
                {
                    V2ExpectedPieceQuery::Known(_) if candidate => ready_candidates.push(piece),
                    V2ExpectedPieceQuery::Known(_) => requestable_pieces.push(piece),
                    V2ExpectedPieceQuery::Missing { geometry, request } => {
                        hash_needs.push(HashNeedInput {
                            geometry,
                            request,
                            piece,
                            candidate,
                            priority: piece_priorities[piece_index],
                        });
                    }
                },
            }
        }
        let hash_scheduler = V2HashScheduler::new(hash_needs)
            .map_err(|error| DownloadError::StorageTask(error.to_owned()))?;
        ready_candidates
            .sort_unstable_by_key(|piece| (Reverse(piece_priorities[*piece as usize]), *piece));
        let v2_hashes = match &*integrity {
            TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog) => {
                Some(V2SeedHashService::new(content.clone(), catalog.clone()))
            }
            TorrentIntegrity::V1 => None,
        };
        let maximum_planned_bytes = config.max_active_piece_bytes;
        let mut state = SwarmState::new_with_wanted_priorities(
            config,
            layout.piece_count(),
            requestable_pieces,
            piece_priorities,
            Vec::new(),
            picker_seed,
        )
        .map_err(DownloadError::Swarm)?;
        state.set_session_resources(control.session_resources());
        let checkpoints = resume.map(|resume| resume.checkpoints.clone());
        let availability =
            PieceAvailability::new(storage.0.route_epoch(), storage.0.verified_pieces())
                .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        let piece_lengths = (0..layout.piece_count())
            .map(|piece| {
                let piece = u32::try_from(piece)
                    .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                layout.piece_length_at(piece).map_err(DownloadError::Layout)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let storage_pipeline = ContentStoragePipeline::start(
            storage,
            control,
            storage_limits.resident_payload_bytes,
            storage_limits.intake_high_watermark_bytes,
            checkpoints,
        )
        .await?;
        let active_content = ActiveSeedContent::new(
            content.swarm_key().into_bytes(),
            content.private(),
            piece_lengths,
            availability.clone(),
            storage_pipeline.active_upload_planner(),
        );
        let active_reader = active_content.configure_file_access(
            content.name(),
            layout,
            &selection.selection,
            control.cancellation_token(),
            storage_pipeline.active_file_planner(),
        );
        control.set_active_content_reader(active_reader);
        let active_upload_failure = active_content.failure_signal();
        let streaming_cursor = StreamingCandidateCursor::new(&control.streaming_demand_snapshot());
        let mut download = Self {
            state,
            storage_pipeline: Some(storage_pipeline),
            completed_storage: None,
            availability,
            active_content,
            active_upload_failure,
            active_registration: None,
            outgoing_uploads: BTreeMap::new(),
            incoming_content: BTreeMap::new(),
            content,
            integrity,
            hash_scheduler,
            v2_hashes,
            leaf_diagnosis: None,
            candidate_pieces,
            candidate_verifications: BTreeSet::new(),
            layout,
            resume,
            control,
            total_blocks: 0,
            total_bytes: 0,
            selected_written_bytes: 0,
            part_written_bytes: 0,
            last_piece: None,
            contributor_attempts: BTreeMap::new(),
            selection: selection.selection,
            high_priority_files: selection.high_priority_files,
            streaming_cursor,
            maximum_planned_bytes,
            storage_limits,
            selection_revision: selection.revision,
        };
        for piece in ready_candidates {
            download.enqueue_candidate_verification(piece)?;
        }
        Ok(download)
    }

    fn is_complete(&self) -> bool {
        self.state.is_complete()
            && self.hash_scheduler.is_complete()
            && self.leaf_diagnosis.is_none()
            && self.candidate_pieces.is_empty()
            && self.candidate_verifications.is_empty()
    }

    fn schedule_hashes(
        &mut self,
        sockets: &PeerSocketSet,
        now: Duration,
    ) -> Vec<crate::v2_hash_scheduler::HashAssignment> {
        let state = &self.state;
        let incoming_content = &self.incoming_content;
        let v2_connections_with_any_piece = |pieces: &[u32]| {
            state
                .connections_with_any_piece(pieces)
                .into_iter()
                .filter(|connection| {
                    sockets.protocol(*connection) == Some(PeerProtocol::V2)
                        || incoming_content
                            .get(connection)
                            .is_some_and(|peer| peer.protocol == PeerProtocol::V2)
                })
                .collect()
        };
        let leaf_active = self
            .leaf_diagnosis
            .as_ref()
            .map_or(0, |diagnosis| diagnosis.scheduler.active_attempts());
        let leaf_scheduler = self
            .leaf_diagnosis
            .as_ref()
            .map(|diagnosis| &diagnosis.scheduler);
        let mut assignments = self.hash_scheduler.schedule_with_reservations(
            now,
            crate::v2_hash_scheduler::MAX_HASH_ATTEMPTS_PER_TORRENT.saturating_sub(leaf_active),
            &v2_connections_with_any_piece,
            |connection| {
                leaf_scheduler.map_or(0, |scheduler| scheduler.peer_attempt_count(connection))
            },
        );
        let primary_active = self.hash_scheduler.active_attempts();
        if let Some(diagnosis) = self.leaf_diagnosis.as_mut() {
            assignments.extend(
                diagnosis.scheduler.schedule_with_reservations(
                    now,
                    crate::v2_hash_scheduler::MAX_HASH_ATTEMPTS_PER_TORRENT
                        .saturating_sub(primary_active),
                    &v2_connections_with_any_piece,
                    |connection| self.hash_scheduler.peer_attempt_count(connection),
                ),
            );
        }
        assignments
    }

    fn integrity_preparation(&self) -> IntegrityPreparationProgress {
        let primary = self.hash_scheduler.snapshot();
        let leaf = self
            .leaf_diagnosis
            .as_ref()
            .map(|diagnosis| diagnosis.scheduler.snapshot())
            .unwrap_or_default();
        let needed_hash_ranges = primary.logical_needs.saturating_add(leaf.logical_needs);
        let active_requests = primary.active_attempts.saturating_add(leaf.active_attempts);
        let phase = if needed_hash_ranges == 0 {
            IntegrityPreparationPhase::Ready
        } else if active_requests == 0 {
            IntegrityPreparationPhase::WaitingForPeer
        } else {
            IntegrityPreparationPhase::Acquiring
        };
        IntegrityPreparationProgress {
            phase,
            needed_hash_ranges,
            active_requests,
        }
    }

    fn enqueue_candidate_verification(&mut self, piece: u32) -> Result<(), DownloadError> {
        if !self.candidate_pieces.contains(&piece) || !self.candidate_verifications.insert(piece) {
            return Ok(());
        }
        let expected = self
            .content
            .expected_piece(self.integrity, piece)
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        let length = self
            .layout
            .piece_length_at(piece)
            .map_err(DownloadError::Layout)?;
        let durable = self.resume.is_some();
        self.storage_pipeline_mut()?
            .enqueue(ContentStorageCommand::VerifyCandidate {
                piece,
                length,
                expected,
                durable,
            })
    }

    fn adopt_authenticated_pieces(
        &mut self,
        authenticated: AuthenticatedPieces,
    ) -> Result<(), DownloadError> {
        self.state
            .add_wanted_pieces(&authenticated.fresh)
            .map_err(DownloadError::Swarm)?;
        for piece in authenticated.candidates {
            self.enqueue_candidate_verification(piece)?;
        }
        Ok(())
    }

    fn begin_leaf_diagnosis(
        &mut self,
        piece: u32,
        generation: crate::swarm::PieceGeneration,
        length: u32,
        now: Duration,
    ) -> Result<bool, DownloadError> {
        if self.leaf_diagnosis.is_some() {
            return Ok(false);
        }
        let Some(content) = self.content.v2() else {
            return Ok(false);
        };
        let piece_geometry = content
            .metainfo
            .layout
            .piece(piece)
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        let file = content
            .metainfo
            .files
            .get(piece_geometry.file_index)
            .ok_or_else(|| DownloadError::StorageTask("v2 diagnosis file is absent".to_owned()))?;
        let pieces_root = file.pieces_root.ok_or_else(|| {
            DownloadError::StorageTask("v2 diagnosis file root is absent".to_owned())
        })?;
        let geometry = self
            .content
            .v2_hash_geometry_for_root(pieces_root)
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?
            .ok_or_else(|| {
                DownloadError::StorageTask("v2 diagnosis geometry is absent".to_owned())
            })?;
        let piece_layer = geometry
            .piece_layer()
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        if piece_layer == 0 {
            return Ok(false);
        }
        let leaves_per_piece = 1_u64
            .checked_shl(u32::from(piece_layer))
            .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        let first_leaf = u64::from(piece_geometry.local_piece)
            .checked_mul(leaves_per_piece)
            .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        let proof_layers = u32::from(
            MerkleTreeShape::new(
                geometry
                    .leaf_count()
                    .map_err(|error| DownloadError::StorageTask(error.to_string()))?,
            )
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?
            .height(),
        )
        .saturating_sub(1);
        let mut needs = Vec::new();
        let mut offset = 0_u64;
        while offset < leaves_per_piece {
            let count = (leaves_per_piece - offset).min(512);
            let count = u32::try_from(count)
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            let index = u32::try_from(
                first_leaf
                    .checked_add(offset)
                    .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?,
            )
            .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            needs.push(HashNeedInput {
                geometry,
                request: rstorrent_protocol::v2_hashes::HashRequest {
                    pieces_root,
                    base_layer: 0,
                    index,
                    count,
                    proof_layers,
                },
                piece,
                candidate: false,
                priority: rstorrent_protocol::storage_layout::PiecePriority::Normal,
            });
            offset = offset
                .checked_add(u64::from(count))
                .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        }
        let scheduler = V2HashScheduler::new(needs)
            .map_err(|error| DownloadError::StorageTask(error.to_owned()))?;
        self.storage_pipeline_mut()?
            .enqueue(ContentStorageCommand::DiagnoseV2Piece { piece, length })?;
        self.leaf_diagnosis = Some(V2LeafDiagnosis {
            piece,
            generation,
            geometry,
            first_leaf,
            scheduler,
            local_leaves: None,
            deadline: now.saturating_add(V2_LEAF_DIAGNOSIS_TIMEOUT),
        });
        Ok(true)
    }

    fn finish_leaf_diagnosis_if_ready(
        &mut self,
    ) -> Result<Option<PieceHashFailure>, DownloadError> {
        let Some(diagnosis) = self.leaf_diagnosis.as_ref() else {
            return Ok(None);
        };
        let Some(local_leaves) = diagnosis.local_leaves.as_ref() else {
            return Ok(None);
        };
        if !diagnosis.scheduler.is_complete() {
            return Ok(None);
        }
        let (TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog)) = &*self.integrity
        else {
            return Err(DownloadError::StorageTask(
                "v2 leaf diagnosis lost its hash catalog".to_owned(),
            ));
        };
        let mut bad_blocks = Vec::new();
        for (offset, actual) in local_leaves.iter().enumerate() {
            let leaf = diagnosis
                .first_leaf
                .checked_add(offset as u64)
                .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            let expected = catalog
                .leaf_hash(diagnosis.geometry.pieces_root, leaf)
                .ok_or_else(|| {
                    DownloadError::StorageTask(
                        "completed leaf diagnosis is missing an authenticated leaf".to_owned(),
                    )
                })?;
            if *actual == expected {
                continue;
            }
            let begin = u32::try_from(offset.saturating_mul(MERKLE_BLOCK_SIZE))
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            let piece_length = self
                .layout
                .piece_length_at(diagnosis.piece)
                .map_err(DownloadError::Layout)?;
            let block_length = (piece_length - begin).min(MERKLE_BLOCK_SIZE as u32);
            bad_blocks.push(
                BlockKey::new(diagnosis.piece, begin, block_length)
                    .map_err(DownloadError::Swarm)?,
            );
        }
        let piece = diagnosis.piece;
        let generation = diagnosis.generation;
        if bad_blocks.is_empty() {
            return self.fallback_leaf_diagnosis();
        }
        let failure = self
            .state
            .mark_piece_hash_failed_blocks_for_generation(piece, generation, &bad_blocks)
            .map_err(DownloadError::Swarm)?;
        self.leaf_diagnosis = None;
        Ok(Some(failure))
    }

    fn fallback_leaf_diagnosis(&mut self) -> Result<Option<PieceHashFailure>, DownloadError> {
        let Some(diagnosis) = self.leaf_diagnosis.take() else {
            return Ok(None);
        };
        let failure = self
            .state
            .mark_piece_hash_failed_for_generation(diagnosis.piece, diagnosis.generation)
            .map_err(DownloadError::Swarm)?;
        Ok(Some(failure))
    }

    fn piece_failure_disposition(
        &self,
        failure: PieceHashFailure,
        reason: &'static str,
    ) -> ContentMessageDisposition {
        self.control.emit(DownloadActivityEvent::PieceHashFailed {
            piece_index: failure.piece,
            contributor_count: failure.contributors.len(),
            failed_bytes: failure.failed_bytes,
        });
        self.control
            .record_bytes(ByteMetric::PayloadHashFailed, failure.failed_bytes);
        let length = self
            .layout
            .piece_length_at(failure.piece)
            .unwrap_or(u32::MAX);
        self.control
            .disk_piece_failed(failure.piece, length, reason);
        ContentMessageDisposition::PieceHashFailed(failure)
    }

    fn sync_v2_hash_service(&self) {
        if let (Some(service), TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog)) =
            (&self.v2_hashes, &*self.integrity)
        {
            service.replace_catalog(catalog.clone());
        }
    }

    async fn active_v2_hash_response(
        &self,
        request: rstorrent_protocol::v2_hashes::HashRequest,
    ) -> Option<rstorrent_protocol::v2_hashes::HashResponse> {
        let service = self.v2_hashes.as_ref()?;
        let _read_permit = match self.control.incoming_peer_handle() {
            Some(handle) => Some(handle.acquire_upload_read().await?),
            None => None,
        };
        service
            .response_active(&self.active_content, request)
            .await
            .ok()
    }

    async fn send_content_message(
        &self,
        sockets: &PeerSocketSet,
        connection: ConnectionId,
        message: PeerMessage,
    ) -> Result<(), ()> {
        if sockets.contains(connection) {
            return sockets.send(connection, message).await.map_err(|_| ());
        }
        let commands = self
            .incoming_content
            .get(&connection)
            .map(|peer| peer.commands.clone())
            .ok_or(())?;
        commands
            .try_send(IncomingContentCommand::Send(message))
            .map_err(|_| ())
    }

    async fn close_content_peer(
        &mut self,
        peers: &mut TorrentPeerCoordinator,
        sockets: &mut PeerSocketSet,
        connection: ConnectionId,
        failure: Option<PeerFailure>,
        removal: ConnectionRemoval,
    ) -> Result<(), DownloadError> {
        self.hash_scheduler.peer_disconnected(connection);
        if let Some(diagnosis) = self.leaf_diagnosis.as_mut() {
            diagnosis.scheduler.peer_disconnected(connection);
        }
        if let Some(incoming) = self.incoming_content.remove(&connection) {
            peers.peers.cancel_incoming_content(incoming.attachment);
            self.state
                .remove_connection(connection, removal)
                .map_err(DownloadError::Swarm)?;
            self.prune_contributor_attempts();
            return Ok(());
        }
        self.remove_outgoing_upload(connection).await;
        match removal {
            ConnectionRemoval::Replaced => {
                replace_content_connection(peers, sockets, &mut self.state, connection).await
            }
            ConnectionRemoval::Disconnected | ConnectionRemoval::Cancelled => {
                close_content_connection(peers, sockets, &mut self.state, connection, failure).await
            }
        }
    }

    fn shutdown_incoming_content(&mut self, peers: &TorrentPeerHandle) {
        let incoming = std::mem::take(&mut self.incoming_content);
        for (connection, peer) in incoming {
            peers.cancel_incoming_content(peer.attachment);
            self.hash_scheduler.peer_disconnected(connection);
            if let Some(diagnosis) = self.leaf_diagnosis.as_mut() {
                diagnosis.scheduler.peer_disconnected(connection);
            }
            let _ = self
                .state
                .remove_connection(connection, ConnectionRemoval::Disconnected);
        }
    }

    fn prune_closed_incoming_content(&mut self) -> Result<(), DownloadError> {
        let closed = self
            .incoming_content
            .iter()
            .filter_map(|(connection, peer)| peer.commands.is_closed().then_some(*connection))
            .collect::<Vec<_>>();
        for connection in closed {
            self.incoming_content.remove(&connection);
            self.hash_scheduler.peer_disconnected(connection);
            if let Some(diagnosis) = self.leaf_diagnosis.as_mut() {
                diagnosis.scheduler.peer_disconnected(connection);
            }
            self.state
                .remove_connection(connection, ConnectionRemoval::Disconnected)
                .map_err(DownloadError::Swarm)?;
            self.prune_contributor_attempts();
        }
        Ok(())
    }

    fn established_content_connections(&self, sockets: &PeerSocketSet) -> usize {
        sockets
            .established_len()
            .saturating_add(self.incoming_content.len())
    }

    async fn install_outgoing_upload(
        &mut self,
        sockets: &PeerSocketSet,
        connection: ConnectionId,
        remote: std::net::IpAddr,
        supports_fast: bool,
        send_initial_availability: bool,
    ) -> Result<(), DownloadError> {
        let protocol =
            sockets
                .protocol(connection)
                .ok_or(DownloadError::Swarm(SwarmError::Invariant(
                    "outgoing upload socket disappeared",
                )))?;
        let hashes = self.content.info_hashes();
        let swarm_key = match protocol {
            PeerProtocol::V1 => hashes.v1_hash().map(FullInfoHash::V1),
            PeerProtocol::V2 => hashes.v2_hash().map(FullInfoHash::V2),
        }
        .map(FullInfoHash::swarm_key)
        .ok_or(DownloadError::Swarm(SwarmError::Invariant(
            "outgoing upload protocol has no matching torrent identity",
        )))?;
        let hybrid_padding = hashes.is_hybrid().then(|| {
            Arc::new(
                self.content
                    .hybrid_padding()
                    .expect("hybrid content has a padding map")
                    .clone(),
            )
        });
        let piece_lengths: Arc<[u32]> =
            if hybrid_padding.is_some() {
                (0..self.layout.piece_count())
                    .map(|piece| {
                        self.content
                            .hybrid_peer_piece_length_at(u32::try_from(piece).map_err(|_| {
                                DownloadError::Layout(LayoutError::ArithmeticOverflow)
                            })?)
                            .map_err(|error| DownloadError::StorageTask(error.to_string()))
                    })
                    .collect::<Result<Vec<_>, _>>()?
                    .into()
            } else {
                self.active_content.piece_lengths()
            };
        let mut state =
            UploadPeerState::from_availability(piece_lengths.clone(), self.availability.clone())
                .map_err(|error| DownloadError::StorageTask(error.to_owned()))?;
        let allowed_fast = if supports_fast {
            match remote {
                std::net::IpAddr::V4(address) => generate_allowed_fast_set(
                    swarm_key.into_bytes(),
                    address,
                    piece_lengths.len(),
                    MAX_GENERATED_ALLOWED_FAST_PIECES,
                )
                .map_err(|error| DownloadError::StorageTask(error.to_owned()))?,
                std::net::IpAddr::V6(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };
        if supports_fast {
            state
                .enable_fast_extension(allowed_fast.iter().copied())
                .map_err(|error| DownloadError::StorageTask(error.to_owned()))?;
        }
        if send_initial_availability
            && let Some(message) = state.initial_availability_message(supports_fast)
        {
            sockets
                .send(connection, message)
                .await
                .map_err(download_peer_set_error)?;
        }
        let snapshot = self.availability.snapshot();
        let pending_initial_haves = (!send_initial_availability && snapshot.available_count > 0)
            .then_some((snapshot.clone(), 0));
        for piece in allowed_fast {
            sockets
                .send(connection, PeerMessage::AllowedFast(piece))
                .await
                .map_err(download_peer_set_error)?;
        }
        let membership = self
            .control
            .incoming_peer_handle()
            .map(|handle| handle.register_session_upload(swarm_key, self.content.piece_length()));
        self.outgoing_uploads.insert(
            connection,
            OutgoingUploadPeer {
                state,
                piece_lengths,
                hybrid_padding,
                cursor: snapshot.cursor(),
                pending_initial_haves,
                membership,
                read: None,
            },
        );
        Ok(())
    }

    async fn handle_outgoing_upload_message(
        &mut self,
        sockets: &PeerSocketSet,
        connection: ConnectionId,
        message: &PeerMessage,
    ) -> Result<Option<(PeerFailure, &'static str)>, DownloadError> {
        let actions = {
            let Some(peer) = self.outgoing_uploads.get_mut(&connection) else {
                return Ok(None);
            };
            let actions = peer.state.on_message(message);
            let interested = peer.state.snapshot().interested;
            if let Some(membership) = &peer.membership {
                membership.update_interest(interested);
            }
            if peer.membership.is_none() {
                let mut actions = actions;
                actions.extend(peer.state.set_granted(interested));
                actions
            } else {
                actions
            }
        };
        self.apply_outgoing_upload_actions(sockets, connection, actions)
            .await
    }

    async fn apply_outgoing_upload_actions(
        &mut self,
        sockets: &PeerSocketSet,
        connection: ConnectionId,
        actions: Vec<UploadAction>,
    ) -> Result<Option<(PeerFailure, &'static str)>, DownloadError> {
        for action in actions {
            match action {
                UploadAction::Send(message) => {
                    let payload = match &message {
                        PeerMessage::Piece { block, .. } => Some(block.len()),
                        _ => None,
                    };
                    if sockets.send(connection, message).await.is_err() {
                        return Ok(Some((
                            PeerFailure::RemoteClosed,
                            "outgoing upload message send failed",
                        )));
                    }
                    if let Some(payload) = payload
                        && let Some(peer) = self.outgoing_uploads.get_mut(&connection)
                        && let Some(membership) = &mut peer.membership
                    {
                        membership.record_payload(payload);
                    }
                }
                UploadAction::Read(read) => {
                    let peer = self.outgoing_uploads.get_mut(&connection).ok_or({
                        DownloadError::Swarm(SwarmError::Invariant("upload read peer disappeared"))
                    })?;
                    if peer.read.is_some() {
                        return Ok(Some((
                            PeerFailure::Protocol,
                            "outgoing upload read overlapped pending read",
                        )));
                    }
                    let piece_length = peer
                        .piece_lengths
                        .get(usize::try_from(read.request.index).map_err(|_| {
                            DownloadError::StorageTask(
                                "outgoing upload piece index does not fit usize".to_owned(),
                            )
                        })?)
                        .copied()
                        .ok_or_else(|| {
                            DownloadError::StorageTask(
                                "outgoing upload piece index is out of bounds".to_owned(),
                            )
                        })?;
                    let hybrid_padding = peer.hybrid_padding.clone();
                    let content = self.active_content.clone();
                    let handle = self.control.incoming_peer_handle();
                    peer.read = Some(OutgoingUploadRead {
                        pending: read,
                        task: tokio::spawn(async move {
                            let _permit = match handle {
                                Some(handle) => Some(handle.acquire_upload_read().await.ok_or(())?),
                                None => None,
                            };
                            match hybrid_padding {
                                Some(padding) => content
                                    .read_hybrid_aligned_block(read.request, piece_length, &padding)
                                    .await
                                    .map_err(|_| ()),
                                None => content.read_block(read.request).await.map_err(|_| ()),
                            }
                        }),
                    });
                }
                UploadAction::Close(reason) => {
                    return Ok(Some(match reason {
                        UploadCloseReason::InvalidRequest => {
                            (PeerFailure::Protocol, "outgoing upload request was invalid")
                        }
                        UploadCloseReason::RequestLimit => (
                            PeerFailure::Protocol,
                            "outgoing upload request limit was exceeded",
                        ),
                        UploadCloseReason::ReadFailed => (
                            PeerFailure::RemoteClosed,
                            "outgoing upload storage read failed",
                        ),
                        UploadCloseReason::ShortRead => (
                            PeerFailure::RemoteClosed,
                            "outgoing upload storage read was short",
                        ),
                    }));
                }
            }
        }
        Ok(None)
    }

    async fn service_outgoing_uploads(
        &mut self,
        sockets: &PeerSocketSet,
    ) -> Result<Vec<(ConnectionId, PeerFailure, &'static str)>, DownloadError> {
        if let Some(handle) = self.control.incoming_peer_handle() {
            handle.evaluate_uploads();
        }
        let stale = self
            .outgoing_uploads
            .keys()
            .copied()
            .filter(|connection| !sockets.contains(*connection))
            .collect::<Vec<_>>();
        for connection in stale {
            self.remove_outgoing_upload(connection).await;
        }

        let connections = self.outgoing_uploads.keys().copied().collect::<Vec<_>>();
        let mut failures = Vec::new();
        for connection in connections {
            let actions = {
                let peer = self
                    .outgoing_uploads
                    .get_mut(&connection)
                    .expect("collected outgoing upload remains present");
                let granted = peer
                    .membership
                    .as_ref()
                    .is_none_or(|membership| membership.grant() != UploadGrant::Choked);
                peer.state.set_granted(granted)
            };
            if let Some(failure) = self
                .apply_outgoing_upload_actions(sockets, connection, actions)
                .await?
            {
                failures.push((connection, failure.0, failure.1));
                continue;
            }

            let drain = {
                let peer = self
                    .outgoing_uploads
                    .get(&connection)
                    .expect("serviced outgoing upload remains present");
                self.availability.drain(peer.cursor)
            };
            let changes = match drain {
                AvailabilityDrain::Changes { cursor, pieces, .. } => (cursor, pieces),
                AvailabilityDrain::EpochChanged(_) | AvailabilityDrain::Lagged => {
                    failures.push((
                        connection,
                        PeerFailure::RemoteClosed,
                        "outgoing upload availability history was lost",
                    ));
                    continue;
                }
            };

            let initial_haves = {
                let peer = self
                    .outgoing_uploads
                    .get_mut(&connection)
                    .expect("serviced outgoing upload remains present");
                if let Some((snapshot, next)) = peer.pending_initial_haves.as_mut() {
                    let (pieces, finished) = {
                        let mut pieces = Vec::with_capacity(MAX_AVAILABILITY_DRAIN);
                        while *next < snapshot.piece_count && pieces.len() < MAX_AVAILABILITY_DRAIN
                        {
                            if snapshot.is_available(*next) {
                                pieces.push(
                                    u32::try_from(*next).expect("bounded availability piece"),
                                );
                            }
                            *next += 1;
                        }
                        (pieces, *next == snapshot.piece_count)
                    };
                    if finished {
                        peer.pending_initial_haves = None;
                    }
                    Some(pieces)
                } else {
                    None
                }
            };
            let messages = if let Some(pieces) = initial_haves {
                pieces
            } else {
                let (cursor, pieces) = changes;
                self.outgoing_uploads
                    .get_mut(&connection)
                    .expect("serviced outgoing upload remains present")
                    .cursor = cursor;
                pieces
            };
            for piece in messages {
                if sockets
                    .send(connection, PeerMessage::Have(piece))
                    .await
                    .is_err()
                {
                    failures.push((
                        connection,
                        PeerFailure::RemoteClosed,
                        "outgoing upload HAVE send failed",
                    ));
                    break;
                }
            }

            let completed = {
                let peer = self
                    .outgoing_uploads
                    .get_mut(&connection)
                    .expect("serviced outgoing upload remains present");
                if peer
                    .read
                    .as_ref()
                    .is_some_and(|read| read.task.is_finished())
                {
                    peer.read.take()
                } else {
                    None
                }
            };
            if let Some(OutgoingUploadRead {
                pending: read,
                task,
            }) = completed
            {
                let result = task.await.unwrap_or(Err(()));
                let actions = self
                    .outgoing_uploads
                    .get_mut(&connection)
                    .expect("completed outgoing upload remains present")
                    .state
                    .on_read_complete(read, result);
                if let Some(failure) = self
                    .apply_outgoing_upload_actions(sockets, connection, actions)
                    .await?
                {
                    failures.push((connection, failure.0, failure.1));
                }
            }
        }
        Ok(failures)
    }

    async fn remove_outgoing_upload(&mut self, connection: ConnectionId) {
        if let Some(mut peer) = self.outgoing_uploads.remove(&connection)
            && let Some(OutgoingUploadRead { task, .. }) = peer.read.take()
        {
            task.abort();
            let _ = task.await;
        }
    }

    async fn shutdown_outgoing_uploads(&mut self) {
        let connections = self.outgoing_uploads.keys().copied().collect::<Vec<_>>();
        for connection in connections {
            self.remove_outgoing_upload(connection).await;
        }
    }

    fn outgoing_upload_work_pending(&self) -> bool {
        self.outgoing_uploads.values().any(|peer| {
            let snapshot = peer.state.snapshot();
            snapshot.queued_requests != 0 || peer.read.is_some()
        })
    }

    fn advance_plan_window(&mut self, verified_piece: u32) -> Result<(), DownloadError> {
        self.state
            .retire_verified_piece(verified_piece)
            .map_err(DownloadError::Swarm)?;
        Ok(())
    }

    fn prepare_reserved_piece(&mut self, piece: u32) -> Result<bool, DownloadError> {
        let (plan, blocks, bytes) =
            match build_content_piece_plan(self.layout, &self.selection, piece) {
                Ok(plan) => plan,
                Err(error) => {
                    self.state
                        .cancel_piece_planning(piece)
                        .map_err(DownloadError::Swarm)?;
                    return Err(error);
                }
            };
        let planned_bytes = self.state.planned_piece_bytes();
        let fits = planned_bytes
            .checked_add(bytes)
            .is_some_and(|total| total <= self.maximum_planned_bytes);
        if !fits && planned_bytes != 0 {
            self.state
                .cancel_piece_planning(piece)
                .map_err(DownloadError::Swarm)?;
            return Ok(false);
        }
        self.state
            .append_piece_plans(vec![plan])
            .map_err(DownloadError::Swarm)?;
        self.total_blocks = self.total_blocks.saturating_add(blocks);
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        Ok(true)
    }

    fn prepare_next_piece(&mut self) -> Result<bool, DownloadError> {
        let Some(piece) = self
            .state
            .reserve_piece_for_planning(MAX_PLANNED_CONTENT_PIECES)
        else {
            return Ok(false);
        };
        self.prepare_reserved_piece(piece)
    }

    fn prepare_streaming_pieces(
        &mut self,
        snapshot: &StreamingDemandSnapshot,
    ) -> Result<(), DownloadError> {
        if self.streaming_cursor.revision() != snapshot.revision()
            || (self.streaming_cursor.take(0, |_| false).finished && !snapshot.is_empty())
        {
            self.streaming_cursor = StreamingCandidateCursor::new(snapshot);
        }
        let availability = self.availability.snapshot();
        let batch = self
            .streaming_cursor
            .take(MAX_STREAMING_CANDIDATE_INSPECTIONS, |piece| {
                usize::try_from(piece)
                    .ok()
                    .is_some_and(|piece| !availability.is_available(piece))
            });
        for candidate in batch.candidates {
            let Some(preemption) = self
                .state
                .reserve_specific_piece_for_planning(
                    candidate.piece,
                    MAX_PLANNED_CONTENT_PIECES,
                    snapshot,
                )
                .map_err(DownloadError::Swarm)?
            else {
                continue;
            };
            self.total_blocks = self.total_blocks.saturating_sub(preemption.block_count);
            self.total_bytes = self
                .total_bytes
                .saturating_sub(preemption.working_set_bytes);
            if !self.prepare_reserved_piece(candidate.piece)? {
                break;
            }
        }
        Ok(())
    }

    fn schedule(&mut self, now: Duration) -> Result<ContentRequestSchedule, DownloadError> {
        let streaming = self.control.streaming_demand_snapshot();
        self.prepare_streaming_pieces(&streaming)?;
        let cancellations = self
            .state
            .preempt_ordinary_for_streaming(now, &streaming)
            .map_err(DownloadError::Swarm)?;
        if !cancellations.is_empty() {
            self.prepare_streaming_pieces(&streaming)?;
        }
        while self.state.planned_piece_count() < MAX_PLANNED_CONTENT_PIECES {
            if !self.prepare_next_piece()? {
                break;
            }
        }
        let assignments = self
            .state
            .schedule_with_streaming(now, &streaming)
            .map_err(DownloadError::Swarm)?;
        Ok(ContentRequestSchedule {
            assignments,
            cancellations,
        })
    }

    async fn handle_message(
        &mut self,
        peers: &mut TorrentPeerCoordinator,
        sockets: &PeerSocketSet,
        connection: ConnectionId,
        message: PeerMessage,
        now: Duration,
    ) -> Result<ContentMessageDisposition, DownloadError> {
        if self
            .state
            .observe_fast_message(connection, &message)
            .is_err()
        {
            return Ok(ContentMessageDisposition::ClosePeer {
                failure: PeerFailure::Protocol,
                reason: "fast-extension message transition was invalid",
            });
        }
        if let Some((failure, reason)) = self
            .handle_outgoing_upload_message(sockets, connection, &message)
            .await?
        {
            return Ok(ContentMessageDisposition::ClosePeer { failure, reason });
        }
        match message {
            PeerMessage::Choke => {
                self.state
                    .set_choking(connection, true)
                    .map_err(DownloadError::Swarm)?;
            }
            PeerMessage::Unchoke => {
                self.state
                    .set_choking(connection, false)
                    .map_err(DownloadError::Swarm)?;
            }
            PeerMessage::Have(piece) => {
                if self.state.peer_has(connection, piece).is_err() {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "HAVE piece index was invalid",
                    });
                }
            }
            PeerMessage::Bitfield(bitfield) => {
                let Some(availability) =
                    validated_compact_availability(bitfield, self.layout.piece_count())
                else {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "BITFIELD shape was invalid",
                    });
                };
                self.state
                    .set_compact_bitfield(connection, availability)
                    .map_err(DownloadError::Swarm)?;
            }
            PeerMessage::HaveAll => {
                self.state
                    .set_have_all(connection)
                    .map_err(DownloadError::Swarm)?;
            }
            PeerMessage::HaveNone => {
                self.state
                    .set_have_none(connection)
                    .map_err(DownloadError::Swarm)?;
            }
            PeerMessage::RejectRequest(request) => {
                let Ok(block) = BlockKey::new(request.index, request.begin, request.length) else {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "REJECT_REQUEST geometry was invalid",
                    });
                };
                match self
                    .state
                    .reject_request(connection, block)
                    .map_err(DownloadError::Swarm)?
                {
                    RejectDisposition::Accepted { .. } | RejectDisposition::Stale => {}
                    RejectDisposition::NeverRequested => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "REJECT_REQUEST did not match an outstanding request",
                        });
                    }
                }
            }
            PeerMessage::Piece {
                index,
                begin,
                block,
            } => {
                let Ok(length) = u32::try_from(block.len()) else {
                    self.control
                        .record_bytes(ByteMetric::PeerUnclassifiedReceived, block.len());
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "PIECE payload length exceeded protocol geometry",
                    });
                };
                let Ok(key) = BlockKey::new(index, begin, length) else {
                    self.control
                        .record_bytes(ByteMetric::PeerUnclassifiedReceived, block.len());
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "PIECE block geometry was invalid",
                    });
                };
                let disposition = match self.state.receive_block(connection, key, now) {
                    Ok(disposition) => disposition,
                    Err(error) => {
                        self.control
                            .record_bytes(ByteMetric::PeerUnclassifiedReceived, block.len());
                        return Err(DownloadError::Swarm(error));
                    }
                };
                match disposition {
                    ReceiveDisposition::Accept { cancellations, .. } => {
                        if let Some(peer) = self.outgoing_uploads.get_mut(&connection)
                            && let Some(membership) = &mut peer.membership
                        {
                            membership.record_downloaded(block.len());
                        }
                        let source_attempt = if let Some(attempt) = sockets.attempt(connection) {
                            ContentContributor::Outgoing(attempt)
                        } else {
                            ContentContributor::Incoming(
                                self.incoming_content
                                    .get(&connection)
                                    .ok_or(DownloadError::Swarm(SwarmError::Invariant(
                                        "accepted block source route is missing",
                                    )))?
                                    .attachment,
                            )
                        };
                        for cancellation in cancellations {
                            let _ = self
                                .send_content_message(
                                    sockets,
                                    cancellation.connection,
                                    PeerMessage::Cancel(cancellation.block.request()),
                                )
                                .await;
                        }
                        let piece_length = self
                            .layout
                            .piece_length_at(index)
                            .map_err(DownloadError::Layout)?;
                        self.control.disk_block_received(key, piece_length);
                        self.control
                            .record_bytes(ByteMetric::PayloadReceived, block.len());
                        self.control.emit(DownloadActivityEvent::BlockReceived {
                            piece_index: index,
                            begin,
                            length,
                        });
                        self.contributor_attempts.insert(connection, source_attempt);
                        let offset = torrent_payload_offset(self.layout, index, begin)?;
                        let generation = self
                            .state
                            .piece_generation(index)
                            .map_err(DownloadError::Swarm)?;
                        self.storage_pipeline_mut()?
                            .enqueue(ContentStorageCommand::Write {
                                block: key,
                                generation,
                                offset,
                                bytes: block,
                            })?;
                    }
                    ReceiveDisposition::Redundant => {
                        self.control
                            .record_bytes(ByteMetric::PayloadRedundant, block.len());
                        self.control
                            .record_bytes(ByteMetric::PeerUnclassifiedReceived, block.len());
                    }
                    ReceiveDisposition::Unsolicited => {
                        self.control
                            .record_bytes(ByteMetric::PayloadRedundant, block.len());
                        self.control
                            .record_bytes(ByteMetric::PeerUnclassifiedReceived, block.len());
                        if self
                            .state
                            .fast_peer_snapshot(connection)
                            .map_err(DownloadError::Swarm)?
                            .negotiated
                        {
                            return Ok(ContentMessageDisposition::ClosePeer {
                                failure: PeerFailure::Protocol,
                                reason: "fast-extension peer sent an unsolicited PIECE",
                            });
                        }
                    }
                }
            }
            PeerMessage::Extended { id: 0, payload } => {
                if peers
                    .apply_extension_handshake(connection, &payload)
                    .is_err()
                {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "extension handshake update was invalid",
                    });
                }
            }
            PeerMessage::Extended {
                id: UT_PEX_LOCAL_ID,
                payload,
            } => match peers.receive_pex(connection, &payload, !self.content.private()) {
                Ok(PexReceiveDisposition::RateLimited { close: true, .. }) | Err(_) => {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "PEX input required closing the peer",
                    });
                }
                Ok(_) => {}
            },
            PeerMessage::KeepAlive
            | PeerMessage::Interested
            | PeerMessage::NotInterested
            | PeerMessage::Request(_)
            | PeerMessage::Cancel(_)
            | PeerMessage::Extended { .. } => {}
            PeerMessage::SuggestPiece(_) | PeerMessage::AllowedFast(_) => {}
            PeerMessage::HashRequest(request) => {
                if !matches!(
                    &*self.integrity,
                    TorrentIntegrity::V2(_) | TorrentIntegrity::Hybrid(_)
                ) {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "v2 hash request arrived on v1 content",
                    });
                }
                let response = self.active_v2_hash_response(request).await;
                let reply = response.map_or(PeerMessage::HashReject(request), PeerMessage::Hashes);
                if self
                    .send_content_message(sockets, connection, reply)
                    .await
                    .is_err()
                {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::RemoteClosed,
                        reason: "v2 hash response send failed",
                    });
                }
            }
            PeerMessage::Hashes(response) => {
                let leaf_attempt = self.leaf_diagnosis.as_ref().is_some_and(|diagnosis| {
                    diagnosis
                        .scheduler
                        .owns_attempt(connection, response.request)
                });
                let (TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog)) =
                    &mut *self.integrity
                else {
                    return Ok(ContentMessageDisposition::ClosePeer {
                        failure: PeerFailure::Protocol,
                        reason: "v2 hashes arrived on v1 content",
                    });
                };
                let disposition = if leaf_attempt {
                    self.leaf_diagnosis
                        .as_mut()
                        .expect("owned leaf attempt has a diagnosis")
                        .scheduler
                        .receive_response(connection, &response, catalog)
                } else {
                    self.hash_scheduler
                        .receive_response(connection, &response, catalog)
                };
                self.sync_v2_hash_service();
                match disposition {
                    HashResponseDisposition::Accepted(authenticated) => {
                        if leaf_attempt {
                            if let Some(failure) = self.finish_leaf_diagnosis_if_ready()? {
                                return Ok(self.piece_failure_disposition(
                                    failure,
                                    "authenticated leaf mismatch; retrying bad blocks",
                                ));
                            }
                        } else {
                            self.adopt_authenticated_pieces(authenticated)?;
                        }
                    }
                    HashResponseDisposition::BadProof(_) => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "v2 hashes failed authenticated proof validation",
                        });
                    }
                    HashResponseDisposition::Unsolicited => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "v2 hashes were unsolicited",
                        });
                    }
                    HashResponseDisposition::Mismatched => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "v2 hashes did not match the peer attempt",
                        });
                    }
                }
            }
            PeerMessage::HashReject(request) => {
                let leaf_attempt = self
                    .leaf_diagnosis
                    .as_ref()
                    .is_some_and(|diagnosis| diagnosis.scheduler.owns_attempt(connection, request));
                let disposition = if leaf_attempt {
                    self.leaf_diagnosis
                        .as_mut()
                        .expect("owned leaf reject has a diagnosis")
                        .scheduler
                        .receive_reject(connection, request)
                } else {
                    self.hash_scheduler.receive_reject(connection, request)
                };
                match disposition {
                    HashRejectDisposition::Accepted => {}
                    HashRejectDisposition::Unsolicited => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "v2 hash reject was unsolicited",
                        });
                    }
                    HashRejectDisposition::Mismatched => {
                        return Ok(ContentMessageDisposition::ClosePeer {
                            failure: PeerFailure::Protocol,
                            reason: "v2 hash reject did not match the peer attempt",
                        });
                    }
                }
            }
        }
        Ok(ContentMessageDisposition::Continue)
    }

    fn storage_pipeline_mut(&mut self) -> Result<&mut ContentStoragePipeline, DownloadError> {
        self.storage_pipeline.as_mut().ok_or_else(|| {
            DownloadError::StorageTask("content storage owner is not running".to_owned())
        })
    }

    fn flush_pending_storage(&mut self) -> Result<bool, DownloadError> {
        self.storage_pipeline_mut()?.flush_pending()
    }

    fn storage_is_backpressured(&self) -> bool {
        self.storage_pipeline
            .as_ref()
            .is_some_and(ContentStoragePipeline::is_backpressured)
    }

    async fn handle_storage_completion(
        &mut self,
        completion: ContentStorageCompletion,
        now: Duration,
    ) -> Result<ContentMessageDisposition, DownloadError> {
        self.storage_pipeline_mut()?
            .completion_received(&completion);
        let disposition = match completion {
            ContentStorageCompletion::Write {
                block,
                generation,
                result,
            } => {
                if self
                    .state
                    .piece_generation(block.piece)
                    .map_err(DownloadError::Swarm)?
                    != generation
                {
                    return Ok(ContentMessageDisposition::Continue);
                }
                let stats = match result {
                    Ok(stats) => stats,
                    Err(error) => {
                        self.control.disk_storage_error(&error.to_string());
                        self.state
                            .finish_write_for_generation(block, generation, false, now)
                            .map_err(DownloadError::Swarm)?;
                        self.prune_contributor_attempts();
                        return Err(error);
                    }
                };
                self.state
                    .finish_write_for_generation(block, generation, true, now)
                    .map_err(DownloadError::Swarm)?;
                self.selected_written_bytes = self
                    .selected_written_bytes
                    .saturating_add(stats.selected_bytes);
                self.part_written_bytes = self.part_written_bytes.saturating_add(stats.part_bytes);
                let piece_length = self
                    .layout
                    .piece_length_at(block.piece)
                    .map_err(DownloadError::Layout)?;
                self.control.disk_block_stored(block, piece_length);
                self.control.record_streaming_block_progress(block.piece);
                self.control
                    .record_bytes(ByteMetric::StagedWrite, block.length as usize);
                self.control.emit(DownloadActivityEvent::BlockStored {
                    piece_index: block.piece,
                    begin: block.begin,
                    length: block.length,
                });
                if self
                    .state
                    .piece_ready_for_generation(block.piece, generation)
                    .map_err(DownloadError::Swarm)?
                {
                    let length = self
                        .layout
                        .piece_length_at(block.piece)
                        .map_err(DownloadError::Layout)?;
                    let expected = self
                        .content
                        .expected_piece(self.integrity, block.piece)
                        .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
                    let durable = self.resume.is_some();
                    self.state
                        .begin_piece_hash(block.piece, generation)
                        .map_err(DownloadError::Swarm)?;
                    self.storage_pipeline_mut()?
                        .enqueue(ContentStorageCommand::Verify {
                            piece: block.piece,
                            generation,
                            length,
                            expected,
                            durable,
                        })?;
                }
                ContentMessageDisposition::Continue
            }
            ContentStorageCompletion::Verify {
                piece,
                generation,
                length,
                result,
            } => {
                if self
                    .state
                    .piece_generation(piece)
                    .map_err(DownloadError::Swarm)?
                    != generation
                {
                    return Ok(ContentMessageDisposition::Continue);
                }
                let verification = result?;
                let piece_index = usize::try_from(piece)
                    .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                let reported_hash = match verification.actual {
                    ComputedPieceHash::Sha1(hash) => hash,
                    ComputedPieceHash::Sha256 { root, .. } => {
                        let mut truncated = [0_u8; 20];
                        truncated.copy_from_slice(&root[..20]);
                        truncated
                    }
                    ComputedPieceHash::Hybrid { sha1, .. } => sha1,
                };
                self.control
                    .record_bytes(ByteMetric::LogicalHashRead, length as usize);
                self.state
                    .finish_piece_hash(piece, generation, verification.matched)
                    .map_err(DownloadError::Swarm)?;
                if let Some(
                    rstorrent_protocol::content::HybridVerificationOutcome::Inconsistent {
                        v1_matched,
                        v2_matched,
                    },
                ) = verification.hybrid_outcome
                {
                    return Err(DownloadError::InconsistentHybridHashes {
                        piece,
                        v1_matched,
                        v2_matched,
                    });
                }
                if !verification.matched {
                    if self.begin_leaf_diagnosis(piece, generation, length, now)? {
                        self.control.disk_piece_failed(
                            piece,
                            length,
                            "piece hash failed; acquiring authenticated leaf hashes",
                        );
                        return Ok(ContentMessageDisposition::Continue);
                    }
                    let failure = self
                        .state
                        .mark_piece_hash_failed_for_generation(piece, generation)
                        .map_err(DownloadError::Swarm)?;
                    self.piece_failure_disposition(failure, "piece hash failed; retrying")
                } else {
                    if self.resume.is_some() {
                        self.storage_pipeline_mut()?
                            .enqueue_checkpoint(
                                piece_index,
                                length,
                                verification.durability_targets,
                            )
                            .await?;
                    }
                    let contributors = self
                        .state
                        .mark_piece_verified_for_generation(piece, generation)
                        .map_err(DownloadError::Swarm)?;
                    self.availability
                        .publish(piece_index, self.availability.snapshot().epoch)
                        .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
                    self.control.record_streaming_piece_verified(piece);
                    self.last_piece = Some(VerifiedPiece {
                        index: piece,
                        hash: reported_hash,
                        length,
                    });
                    self.control
                        .record_bytes(ByteMetric::PayloadVerified, length as usize);
                    self.control
                        .emit(DownloadActivityEvent::PieceVerified { piece_index: piece });
                    self.advance_plan_window(piece)?;
                    ContentMessageDisposition::PieceVerified(contributors)
                }
            }
            ContentStorageCompletion::VerifyCandidate {
                piece,
                length,
                result,
            } => {
                self.candidate_verifications.remove(&piece);
                let piece_index = usize::try_from(piece)
                    .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                match result {
                    Ok(verification) if verification.matched => {
                        if self.resume.is_some() {
                            self.storage_pipeline_mut()?
                                .enqueue_checkpoint(
                                    piece_index,
                                    length,
                                    verification.durability_targets,
                                )
                                .await?;
                        }
                        self.candidate_pieces.remove(&piece);
                        self.availability
                            .publish(piece_index, self.availability.snapshot().epoch)
                            .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
                        self.control.record_streaming_piece_verified(piece);
                        self.control
                            .record_bytes(ByteMetric::LogicalHashRead, length as usize);
                        self.control
                            .record_bytes(ByteMetric::PayloadVerified, length as usize);
                        self.control
                            .emit(DownloadActivityEvent::PieceVerified { piece_index: piece });
                        ContentMessageDisposition::PieceVerified(Vec::new())
                    }
                    Ok(verification)
                        if matches!(
                            verification.hybrid_outcome,
                            Some(
                                rstorrent_protocol::content::HybridVerificationOutcome::Inconsistent {
                                    ..
                                }
                            )
                        ) =>
                    {
                        let Some(
                            rstorrent_protocol::content::HybridVerificationOutcome::Inconsistent {
                                v1_matched,
                                v2_matched,
                            },
                        ) = verification.hybrid_outcome
                        else {
                            unreachable!("guard checked hybrid inconsistency")
                        };
                        return Err(DownloadError::InconsistentHybridHashes {
                            piece,
                            v1_matched,
                            v2_matched,
                        });
                    }
                    Ok(_) | Err(_) => {
                        self.candidate_pieces.remove(&piece);
                        if let Some(resume) = self.resume {
                            resume
                                .checkpoints
                                .pieces_invalidated(&[piece_index])
                                .map_err(DownloadError::Checkpoint)?;
                        }
                        self.state
                            .add_wanted_pieces(&[piece])
                            .map_err(DownloadError::Swarm)?;
                        self.control.emit(DownloadActivityEvent::PieceHashFailed {
                            piece_index: piece,
                            contributor_count: 0,
                            failed_bytes: length as usize,
                        });
                        self.control
                            .record_bytes(ByteMetric::PayloadHashFailed, length as usize);
                        self.control.disk_piece_failed(
                            piece,
                            length,
                            "candidate payload failed verification; retrying",
                        );
                        ContentMessageDisposition::Continue
                    }
                }
            }
            ContentStorageCompletion::DiagnoseV2Piece {
                piece,
                length,
                result,
            } => {
                self.control
                    .record_bytes(ByteMetric::LogicalHashRead, length as usize);
                let Some(diagnosis) = self.leaf_diagnosis.as_mut() else {
                    return Ok(ContentMessageDisposition::Continue);
                };
                if diagnosis.piece != piece {
                    return Err(DownloadError::StorageTask(
                        "v2 leaf diagnosis completion named another piece".to_owned(),
                    ));
                }
                match result {
                    Ok(leaves) => diagnosis.local_leaves = Some(leaves),
                    Err(_) => {
                        let failure = self
                            .fallback_leaf_diagnosis()?
                            .expect("active diagnosis has a fallback failure");
                        return Ok(self.piece_failure_disposition(
                            failure,
                            "leaf hashing failed; resetting whole piece",
                        ));
                    }
                }
                match self.finish_leaf_diagnosis_if_ready()? {
                    Some(failure) => self.piece_failure_disposition(
                        failure,
                        "authenticated leaf mismatch; retrying bad blocks",
                    ),
                    None => ContentMessageDisposition::Continue,
                }
            }
        };
        Ok(disposition)
    }

    async fn stop_storage(&mut self, cancel: bool) -> Result<(), DownloadError> {
        let pipeline = self.storage_pipeline.take().ok_or_else(|| {
            DownloadError::StorageTask("content storage owner is not running".to_owned())
        })?;
        self.completed_storage = Some(pipeline.shutdown(cancel).await?);
        Ok(())
    }

    async fn restart_storage(&mut self, storage: ContentStorage) -> Result<(), DownloadError> {
        let checkpoints = self.resume.map(|resume| resume.checkpoints.clone());
        self.storage_pipeline = Some(
            ContentStoragePipeline::start(
                storage,
                self.control,
                self.storage_limits.resident_payload_bytes,
                self.storage_limits.intake_high_watermark_bytes,
                checkpoints,
            )
            .await?,
        );
        self.active_content.replace_planner(
            self.storage_pipeline
                .as_ref()
                .expect("restarted storage pipeline is installed")
                .active_upload_planner(),
        );
        self.active_content.replace_file_planner(
            self.storage_pipeline
                .as_ref()
                .expect("restarted storage pipeline is installed")
                .active_file_planner(),
        );
        self.completed_storage = None;
        Ok(())
    }

    async fn reconcile_file_selection(
        &mut self,
        sockets: &PeerSocketSet,
        update: FileSelectionUpdate,
    ) -> Result<(), DownloadError> {
        if update.revision <= self.selection_revision {
            return Ok(());
        }
        if self.leaf_diagnosis.is_some() {
            let _ = self.fallback_leaf_diagnosis()?;
        }
        let next_selection = FileSelection::new_content(self.layout, &update.skip_files)
            .map_err(DownloadError::Layout)?;
        let next_priorities = self
            .layout
            .piece_priorities(&next_selection, &update.high_priority_files)
            .map_err(DownloadError::Layout)?;
        if next_selection == self.selection {
            self.hash_scheduler
                .replace_piece_priorities(&next_priorities)
                .map_err(|error| DownloadError::StorageTask(error.to_owned()))?;
            self.state
                .replace_piece_priorities(next_priorities)
                .map_err(DownloadError::Swarm)?;
            self.high_priority_files = update.high_priority_files;
            self.selection_revision = update.revision;
            self.control.file_selection_applied(update.revision);
            return Ok(());
        }
        let previous_availability_empty = self.availability.snapshot().available_count == 0;
        self.stop_storage(false).await?;
        let mut storage = self.take_storage()?;
        let reconcile = match storage.0.reconcile_selection(next_selection.clone()).await {
            Ok(reconcile) => reconcile,
            Err(error) => {
                self.restart_storage(storage).await?;
                return Err(DownloadError::SelectiveStorage(error));
            }
        };
        if !reconcile.invalidated_pieces.is_empty()
            && let Some(resume) = self.resume
        {
            resume
                .checkpoints
                .pieces_invalidated(&reconcile.invalidated_pieces)
                .map_err(DownloadError::Checkpoint)?;
        }
        let mut requestable = Vec::new();
        let mut hash_needs = Vec::new();
        let mut next_candidates = BTreeSet::new();
        let mut ready_candidates = Vec::new();
        for (piece_index, &priority) in next_priorities.iter().enumerate() {
            let piece_index_u32 = match u32::try_from(piece_index) {
                Ok(piece_index) => piece_index,
                Err(_) => {
                    self.restart_storage(storage).await?;
                    return Err(DownloadError::Layout(LayoutError::ArithmeticOverflow));
                }
            };
            let ranges = match self.layout.request_ranges(piece_index_u32, &next_selection) {
                Ok(ranges) => ranges,
                Err(error) => {
                    self.restart_storage(storage).await?;
                    return Err(DownloadError::Layout(error));
                }
            };
            if ranges.is_empty() || storage.0.verified_pieces()[piece_index] {
                continue;
            }
            match self.content {
                TorrentContent::V1(_) => requestable.push(piece_index_u32),
                TorrentContent::V2(_) | TorrentContent::Hybrid(_) => {
                    let candidate = if self.candidate_pieces.contains(&piece_index_u32) {
                        true
                    } else {
                        match storage.0.has_piece_sources(piece_index_u32).await {
                            Ok(candidate) => candidate,
                            Err(error) => {
                                self.restart_storage(storage).await?;
                                return Err(DownloadError::SelectiveStorage(error));
                            }
                        }
                    };
                    let expected = match self
                        .content
                        .v2_expected_piece(self.integrity, piece_index_u32)
                    {
                        Ok(expected) => expected,
                        Err(error) => {
                            self.restart_storage(storage).await?;
                            return Err(DownloadError::StorageTask(error.to_string()));
                        }
                    };
                    match expected {
                        V2ExpectedPieceQuery::Known(_) if candidate => {
                            next_candidates.insert(piece_index_u32);
                            ready_candidates.push(piece_index_u32);
                        }
                        V2ExpectedPieceQuery::Known(_) => requestable.push(piece_index_u32),
                        V2ExpectedPieceQuery::Missing { geometry, request } => {
                            if candidate {
                                next_candidates.insert(piece_index_u32);
                            }
                            hash_needs.push(HashNeedInput {
                                geometry,
                                request,
                                piece: piece_index_u32,
                                candidate,
                                priority,
                            });
                        }
                    }
                }
            }
        }
        let next_hash_scheduler = match V2HashScheduler::new(hash_needs) {
            Ok(scheduler) => scheduler,
            Err(error) => {
                self.restart_storage(storage).await?;
                return Err(DownloadError::StorageTask(error.to_owned()));
            }
        };
        ready_candidates
            .sort_unstable_by_key(|piece| (Reverse(next_priorities[*piece as usize]), *piece));
        let cancellations = match self
            .state
            .replace_wanted_pieces_with_priorities(requestable, next_priorities)
        {
            Ok(cancellations) => cancellations,
            Err(error) => {
                self.restart_storage(storage).await?;
                return Err(DownloadError::Swarm(error));
            }
        };
        for cancellation in cancellations {
            let _ = self
                .send_content_message(
                    sockets,
                    cancellation.connection,
                    PeerMessage::Cancel(cancellation.block.request()),
                )
                .await;
        }
        self.control.clear_outstanding_requests();
        self.contributor_attempts.clear();
        self.hash_scheduler = next_hash_scheduler;
        self.candidate_pieces = next_candidates;
        self.candidate_verifications.clear();
        self.selection = next_selection;
        self.high_priority_files = update.high_priority_files;
        self.selection_revision = update.revision;
        self.control.file_selection_applied(update.revision);
        let next_availability_empty = !storage.0.verified_pieces().iter().any(|piece| *piece);
        self.availability
            .replace_epoch(storage.0.route_epoch(), storage.0.verified_pieces())
            .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        if previous_availability_empty && next_availability_empty {
            let cursor = self.availability.snapshot().cursor();
            for peer in self.outgoing_uploads.values_mut() {
                peer.cursor = cursor;
            }
        }
        self.restart_storage(storage).await?;
        for piece in ready_candidates {
            self.enqueue_candidate_verification(piece)?;
        }
        self.active_content.update_file_selection(&self.selection);
        Ok(())
    }

    async fn register_active_route(
        &mut self,
        torrent_peers: TorrentPeerHandle,
    ) -> Result<(), DownloadError> {
        let Some(handle) = self.control.incoming_peer_handle() else {
            return Ok(());
        };
        let Some(raw_info) = self.resume.and_then(|resume| resume.raw_info.clone()) else {
            return Ok(());
        };
        let registrations = self
            .content
            .swarm_keys()
            .map(|swarm_key| {
                SeedRegistration::new_active_with_swarm_key(
                    raw_info.clone(),
                    swarm_key,
                    self.active_content.clone(),
                    torrent_peers.clone(),
                    matches!(swarm_key, SwarmKey::V2Truncated(_))
                        .then(|| self.v2_hashes.clone())
                        .flatten(),
                )
                .map(|registration| {
                    match self.control.incoming_payload_metric_sink() {
                        Some(sink) => registration.with_byte_metric_sink(sink),
                        None => registration,
                    }
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| DownloadError::PeerTask(error.to_string()))?;
        let tokens = handle
            .register_all(registrations)
            .await
            .map_err(|error| DownloadError::PeerTask(error.to_string()))?;
        self.active_registration = Some((handle, tokens));
        self.control.set_incoming_content_routable(true);
        Ok(())
    }

    async fn unregister_active_route(&mut self) -> Result<(), DownloadError> {
        self.control.set_incoming_content_routable(false);
        let Some((handle, tokens)) = self.active_registration.take() else {
            return Ok(());
        };
        for token in tokens {
            handle
                .unregister(token)
                .await
                .map_err(|error| DownloadError::PeerTask(error.to_string()))?;
        }
        Ok(())
    }

    fn take_storage(&mut self) -> Result<ContentStorage, DownloadError> {
        self.completed_storage.take().ok_or_else(|| {
            DownloadError::StorageTask("content storage owner did not return storage".to_owned())
        })
    }

    fn contributor_attempt(&self, connection: ConnectionId) -> Option<ContentContributor> {
        self.contributor_attempts.get(&connection).copied()
    }

    fn prune_contributor_attempts(&mut self) {
        let retained = self.state.unverified_contributors();
        self.contributor_attempts
            .retain(|connection, _| retained.contains(connection));
    }
}

fn record_verified_piece_contributors(
    peers: &mut TorrentPeerCoordinator,
    download: &mut ContentSwarmDownload<'_>,
    contributors: &[ConnectionId],
) -> Result<(), DownloadError> {
    for &connection in contributors {
        let attempt = download.contributor_attempt(connection).ok_or({
            DownloadError::Swarm(SwarmError::Invariant(
                "verified piece contributor attempt is missing",
            ))
        })?;
        let result = peers.peers.with_state(|state| match attempt {
            ContentContributor::Outgoing(attempt) => state.registry.record_piece_passed(attempt),
            ContentContributor::Incoming(attachment) => state
                .registry
                .record_incoming_piece_passed(attachment.record_id()),
        });
        match result {
            Ok(())
            | Err(PeerRegistryError::StaleAttempt(_))
            | Err(PeerRegistryError::UnknownRecord(_)) => {}
            Err(error) => return Err(DownloadError::PeerRegistry(error)),
        }
    }
    download.prune_contributor_attempts();
    Ok(())
}

async fn record_failed_piece_contributors(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    download: &mut ContentSwarmDownload<'_>,
    failure: &PieceHashFailure,
) -> Result<(), DownloadError> {
    let known_bad = failure.contributors.len() == 1;
    let mut banned = Vec::new();
    for &connection in &failure.contributors {
        let attempt = download.contributor_attempt(connection).ok_or({
            DownloadError::Swarm(SwarmError::Invariant(
                "failed piece contributor attempt is missing",
            ))
        })?;
        let result = peers.peers.with_state(|state| match attempt {
            ContentContributor::Outgoing(attempt) => {
                state.registry.record_piece_failed(attempt, known_bad)
            }
            ContentContributor::Incoming(attachment) => state
                .registry
                .record_incoming_piece_failed(attachment.record_id(), known_bad),
        });
        match result {
            Ok(PeerIntegrityAction::Retain) => {}
            Ok(PeerIntegrityAction::Ban) => banned.push((connection, attempt)),
            Err(PeerRegistryError::StaleAttempt(_)) | Err(PeerRegistryError::UnknownRecord(_)) => {}
            Err(error) => return Err(DownloadError::PeerRegistry(error)),
        }
    }
    for (connection, attempt) in banned {
        download
            .close_content_peer(
                peers,
                sockets,
                connection,
                None,
                ConnectionRemoval::Disconnected,
            )
            .await?;
        if let ContentContributor::Outgoing(attempt) = attempt {
            peers
                .peers
                .with_state(|state| state.registry.ban(attempt.record_id()))
                .map_err(DownloadError::PeerRegistry)?;
        }
    }
    download.prune_contributor_attempts();
    Ok(())
}

fn torrent_payload_offset(
    layout: &ContentLayout,
    piece: u32,
    begin: u32,
) -> Result<u64, DownloadError> {
    u64::from(piece)
        .checked_mul(u64::from(layout.piece_length()))
        .and_then(|offset| offset.checked_add(u64::from(begin)))
        .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))
}

fn diagnostic_piece_hash(
    content: &TorrentContent,
    integrity: &TorrentIntegrity,
    piece_index: usize,
) -> Result<[u8; 20], DownloadError> {
    let piece = u32::try_from(piece_index)
        .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
    match content
        .expected_piece(integrity, piece)
        .map_err(|error| DownloadError::StorageTask(error.to_string()))?
    {
        ExpectedPieceIntegrity::V1Sha1(hash) => Ok(hash),
        ExpectedPieceIntegrity::V2Merkle { expected_root, .. } => {
            let mut truncated = [0_u8; 20];
            truncated.copy_from_slice(&expected_root[..20]);
            Ok(truncated)
        }
        ExpectedPieceIntegrity::Hybrid { v1_sha1, .. } => Ok(v1_sha1),
    }
}

fn validated_compact_availability(bitfield: Vec<u8>, piece_count: usize) -> Option<Vec<u8>> {
    if bitfield.len() != piece_count.div_ceil(8) {
        return None;
    }
    let remainder = piece_count % 8;
    if remainder != 0 {
        let unused_mask = (1_u8 << (8 - remainder)) - 1;
        if bitfield.last().is_some_and(|byte| byte & unused_mask != 0) {
            return None;
        }
    }
    Some(bitfield)
}

fn pending_dial_id(attempt: DialAttempt) -> PendingDialId {
    PendingDialId::new(attempt.id().get()).expect("dial attempt identifiers are nonzero")
}

fn content_dial_slot_available(
    established: usize,
    pending: usize,
    config: SwarmConfig,
    replacement_available: bool,
) -> bool {
    if pending >= config.max_pending_dials {
        return false;
    }
    established < config.max_established_connections || (pending == 0 && replacement_available)
}

fn dry_swarm_probe_available(
    counts: PeerRegistryCounts,
    established: usize,
    pending: usize,
    discovery_active: bool,
    cadence_ready: bool,
) -> bool {
    discovery_active
        && cadence_ready
        && established == 0
        && pending == 0
        && counts.eligible == 0
        && counts.dialing == 0
        && counts.connected == 0
        && counts.backed_off == 0
        && counts.failure_limited != 0
}

fn fill_content_dials(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    state: &mut SwarmState,
    incoming_established: usize,
    discovery_active: bool,
) -> Result<usize, DownloadError> {
    let mut started = 0;
    while content_dial_slot_available(
        sockets
            .established_len()
            .saturating_add(incoming_established),
        sockets.pending_len(),
        state.config(),
        !peers.peers.download_rate_limited()
            && state.replacement_candidate(peers.elapsed()).is_some(),
    ) {
        let context = PeerSelectionContext {
            now: peers.elapsed(),
        };
        let Some(candidate) = peers.select_candidate(context) else {
            break;
        };
        if !peers.control.try_acquire_outbound_turn() {
            break;
        }
        if !start_content_dial(peers, sockets, state, candidate, false)? {
            break;
        }
        started += 1;
    }

    if started != 0 {
        return Ok(started);
    }
    let established = sockets
        .established_len()
        .saturating_add(incoming_established);
    let context = PeerSelectionContext {
        now: peers.elapsed(),
    };
    let counts = peers.registry_counts(context);
    if !dry_swarm_probe_available(
        counts,
        established,
        sockets.pending_len(),
        discovery_active,
        peers.dry_swarm_probe_is_ready(context.now),
    ) {
        return Ok(started);
    }
    let Some(candidate) = peers.select_failure_limited_probe(context) else {
        return Ok(started);
    };
    if !peers.control.try_acquire_outbound_turn() {
        return Ok(started);
    }
    if start_content_dial(peers, sockets, state, candidate, true)? {
        started += 1;
    }
    Ok(started)
}

fn start_content_dial(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    state: &mut SwarmState,
    candidate: DialCandidate,
    failure_limited_probe: bool,
) -> Result<bool, DownloadError> {
    let failures = failure_limited_probe
        .then(|| peers.candidate_failure_count(candidate))
        .flatten()
        .unwrap_or(0);
    peers.control.emit(DownloadActivityEvent::PeerDialStarted {
        peer: candidate.endpoint().to_string(),
    });
    let dial_swarm_key = peers.candidate_swarm_key(candidate);
    let attempt = if failure_limited_probe {
        peers.begin_failure_limited_probe(candidate, PeerConnectionRole::Content)?
    } else {
        peers.begin_dial(candidate, PeerConnectionRole::Content)?
    };
    if let Err(error) = state.begin_dial(pending_dial_id(attempt)) {
        peers.dial_cancelled(attempt)?;
        return Err(DownloadError::Swarm(error));
    }
    let services = PeerDialServices {
        byte_metric_sink: peers.control.byte_metric_sink(),
        mse_handshake_sink: peers.control.mse_handshake_sink(),
        utp: peers.control.utp_handle(),
    };
    let dial = match (dial_swarm_key, peers.hybrid_upgrade_hash) {
        (SwarmKey::V1(_), Some(v2_hash)) => sockets.begin_hybrid_dial(
            attempt,
            dial_swarm_key.into_bytes(),
            v2_hash,
            true,
            peers.connection_network(),
            services,
        ),
        (SwarmKey::V2Truncated(_), _) => sockets.begin_v2_dial(
            attempt,
            dial_swarm_key.into_bytes(),
            true,
            peers.connection_network(),
            services,
        ),
        (SwarmKey::V1(_), None) => sockets.begin_dial(
            attempt,
            dial_swarm_key.into_bytes(),
            true,
            peers.connection_network(),
            services,
        ),
    };
    if let Err(error) = dial {
        state
            .finish_dial(pending_dial_id(attempt))
            .map_err(DownloadError::Swarm)?;
        peers.dial_cancelled(attempt)?;
        if matches!(error, PeerSetError::ConnectionLimit(_)) {
            return Ok(false);
        }
        return Err(download_peer_set_error(error));
    }
    if failure_limited_probe {
        let admission = peers.admit_dry_swarm_probe(peers.elapsed());
        peers
            .control
            .emit(DownloadActivityEvent::DrySwarmProbeStarted {
                record_id: candidate.record_id().get(),
                failures,
                ordinal: admission.ordinal,
                next_delay_seconds: admission.next_delay.as_secs(),
            });
    }
    Ok(true)
}

async fn close_content_connection(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    state: &mut SwarmState,
    connection: ConnectionId,
    failure: Option<PeerFailure>,
) -> Result<(), DownloadError> {
    if !sockets.contains(connection) {
        return Ok(());
    }
    let attempt =
        sockets
            .attempt(connection)
            .ok_or(DownloadError::Swarm(SwarmError::Invariant(
                "active peer socket has no dial attempt",
            )))?;
    peers.begin_disconnect(attempt, failure)?;
    let attempt = sockets
        .remove_connection(connection)
        .await
        .map_err(download_peer_set_error)?;
    state
        .remove_connection(connection, ConnectionRemoval::Disconnected)
        .map_err(DownloadError::Swarm)?;
    peers.connection_closed(attempt, failure)
}

async fn send_due_pex(
    peers: &mut TorrentPeerCoordinator,
    sockets: &PeerSocketSet,
) -> Result<Vec<ConnectionId>, DownloadError> {
    let mut failed = Vec::new();
    for attempt in sockets.connection_attempts() {
        let connection = connection_id(attempt);
        let Some((remote_id, payload)) = peers.next_pex(connection)? else {
            continue;
        };
        if sockets
            .send(
                connection,
                PeerMessage::Extended {
                    id: remote_id,
                    payload,
                },
            )
            .await
            .is_err()
        {
            failed.push(connection);
        }
    }
    Ok(failed)
}

async fn send_pex_policy_update(
    sockets: &PeerSocketSet,
    connections: &BTreeSet<ConnectionId>,
    enabled: bool,
) -> Vec<ConnectionId> {
    let payload = pex_extension_update(enabled);
    let mut failed = Vec::new();
    for &connection in connections {
        if sockets
            .send(
                connection,
                PeerMessage::Extended {
                    id: 0,
                    payload: payload.clone(),
                },
            )
            .await
            .is_err()
        {
            failed.push(connection);
        }
    }
    failed
}

async fn replace_content_connection(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    state: &mut SwarmState,
    connection: ConnectionId,
) -> Result<(), DownloadError> {
    let attempt =
        sockets
            .attempt(connection)
            .ok_or(DownloadError::Swarm(SwarmError::Invariant(
                "replacement peer socket has no dial attempt",
            )))?;
    peers.begin_disconnect(attempt, None)?;
    let attempt = sockets
        .remove_connection(connection)
        .await
        .map_err(download_peer_set_error)?;
    state
        .remove_connection(connection, ConnectionRemoval::Replaced)
        .map_err(DownloadError::Swarm)?;
    peers.connection_closed(attempt, None)
}

async fn cleanup_content_connections(
    peers: &mut TorrentPeerCoordinator,
    sockets: PeerSocketSet,
    state: &mut SwarmState,
    failure: Option<PeerFailure>,
) -> Result<(), DownloadError> {
    let active = sockets.connection_attempts();
    let pending_before_shutdown = sockets.pending_attempts();
    let mut first_error = None;
    for attempt in active.iter().chain(&pending_before_shutdown).copied() {
        if let Err(error) = peers.begin_disconnect(attempt, failure)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    let pending = match sockets.shutdown().await {
        Ok(pending) => pending,
        Err(error) => {
            if first_error.is_none() {
                first_error = Some(download_peer_set_error(error));
            }
            pending_before_shutdown
                .into_iter()
                .map(|attempt| (attempt, None))
                .collect()
        }
    };
    for attempt in active {
        if let Err(error) = peers.connection_closed(attempt, failure)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    for (attempt, utp_outcome) in pending {
        if let Err(error) = peers.record_utp_outcome(attempt, utp_outcome)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
        if let Err(error) = peers.dial_cancelled(attempt)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    if let Err(error) = state.cancel_all().map_err(DownloadError::Swarm)
        && first_error.is_none()
    {
        first_error = Some(error);
    }
    peers.control.clear_buffered_payload();
    peers.control.clear_outstanding_requests();
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

// This stack-local event is consumed immediately; boxing every peer event would
// add a heap allocation to the peer hot path solely to equalize enum variants.
#[allow(clippy::large_enum_variant)]
enum ContentSupervisorEvent {
    Peer(PeerSetEvent),
    Incoming(IncomingContentEvent),
    Discovery(Option<ContentDiscoveryEvent>),
    Storage(ContentStorageCompletion),
    Selection(FileSelectionUpdate),
    Streaming,
    Deadline,
}

struct ContentSupervisorWait<'a> {
    storage_backpressured: bool,
    until_expiry: Option<Duration>,
    cancellation: &'a CancellationToken,
    active_upload_failure: &'a ActiveUploadFailureSignal,
    selection_updates: &'a mut watch::Receiver<Option<FileSelectionUpdate>>,
    streaming_updates: &'a mut watch::Receiver<StreamingDemandSnapshot>,
    priority: ContentSupervisorOwner,
}

async fn content_shutdown(
    cancellation: &CancellationToken,
    active_upload_failure: &ActiveUploadFailureSignal,
) -> DownloadError {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => DownloadError::Cancelled,
        _ = active_upload_failure.cancelled() => {
            active_upload_failure.take_failure().map_or_else(
                || DownloadError::StorageTask(
                    "active upload storage route failed".to_owned()
                ),
                |(_, error)| DownloadError::SelectiveStorage(error),
            )
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ContentSupervisorOwner {
    Storage,
    Peer,
    Discovery,
}

impl ContentSupervisorOwner {
    const fn next(self) -> Self {
        match self {
            Self::Storage => Self::Peer,
            Self::Peer => Self::Discovery,
            Self::Discovery => Self::Storage,
        }
    }
}

impl ContentSupervisorEvent {
    const fn owner(&self) -> Option<ContentSupervisorOwner> {
        match self {
            Self::Peer(_) | Self::Incoming(_) => Some(ContentSupervisorOwner::Peer),
            Self::Discovery(_) => Some(ContentSupervisorOwner::Discovery),
            Self::Storage(_) => Some(ContentSupervisorOwner::Storage),
            Self::Selection(_) | Self::Streaming | Self::Deadline => None,
        }
    }
}

async fn next_content_supervisor_event(
    sockets: &mut PeerSocketSet,
    incoming: &mut mpsc::Receiver<IncomingContentEvent>,
    discovery: &mut ContentDiscovery,
    storage: &mut ContentStoragePipeline,
    wait: ContentSupervisorWait<'_>,
) -> Result<ContentSupervisorEvent, DownloadError> {
    let ContentSupervisorWait {
        storage_backpressured,
        until_expiry,
        cancellation,
        active_upload_failure,
        selection_updates,
        streaming_updates,
        priority,
    } = wait;
    if selection_updates.has_changed().map_err(|_| {
        DownloadError::StorageTask("file-selection controller stopped unexpectedly".to_owned())
    })? {
        let update = selection_updates
            .borrow_and_update()
            .clone()
            .ok_or_else(|| {
                DownloadError::StorageTask("file-selection update is missing".to_owned())
            })?;
        return Ok(ContentSupervisorEvent::Selection(update));
    }
    if streaming_updates.has_changed().map_err(|_| {
        DownloadError::StorageTask("streaming-demand controller stopped unexpectedly".to_owned())
    })? {
        streaming_updates.borrow_and_update();
        return Ok(ContentSupervisorEvent::Streaming);
    }
    if until_expiry.is_some_and(|wait| wait.is_zero()) {
        return Ok(ContentSupervisorEvent::Deadline);
    }
    if storage_backpressured {
        return match priority {
            ContentSupervisorOwner::Storage => tokio::select! {
                biased;
                error = content_shutdown(cancellation, active_upload_failure) => Err(error),
                changed = streaming_updates.changed() => changed
                    .map(|()| ContentSupervisorEvent::Streaming)
                    .map_err(|_| DownloadError::StorageTask(
                        "streaming-demand controller stopped unexpectedly".to_owned()
                    )),
                completion = storage.next_completion() => {
                    completion.map(ContentSupervisorEvent::Storage)
                }
                event = discovery.next_event(), if discovery.is_active() => {
                    Ok(ContentSupervisorEvent::Discovery(event))
                }
                _ = tokio::time::sleep(CONTENT_SWARM_MAINTENANCE_INTERVAL) => {
                    Ok(ContentSupervisorEvent::Deadline)
                }
            },
            ContentSupervisorOwner::Peer | ContentSupervisorOwner::Discovery => tokio::select! {
                biased;
                error = content_shutdown(cancellation, active_upload_failure) => Err(error),
                changed = streaming_updates.changed() => changed
                    .map(|()| ContentSupervisorEvent::Streaming)
                    .map_err(|_| DownloadError::StorageTask(
                        "streaming-demand controller stopped unexpectedly".to_owned()
                    )),
                event = discovery.next_event(), if discovery.is_active() => {
                    Ok(ContentSupervisorEvent::Discovery(event))
                }
                completion = storage.next_completion() => {
                    completion.map(ContentSupervisorEvent::Storage)
                }
                _ = tokio::time::sleep(CONTENT_SWARM_MAINTENANCE_INTERVAL) => {
                    Ok(ContentSupervisorEvent::Deadline)
                }
            },
        };
    }
    let wait = until_expiry.unwrap_or(Duration::ZERO);
    match priority {
        ContentSupervisorOwner::Storage => tokio::select! {
            biased;
            error = content_shutdown(cancellation, active_upload_failure) => Err(error),
            changed = streaming_updates.changed() => changed
                .map(|()| ContentSupervisorEvent::Streaming)
                .map_err(|_| DownloadError::StorageTask(
                    "streaming-demand controller stopped unexpectedly".to_owned()
                )),
            completion = storage.next_completion() => {
                completion.map(ContentSupervisorEvent::Storage)
            }
            event = sockets.next_event() => event
                .map(ContentSupervisorEvent::Peer)
                .map_err(download_peer_set_error),
            event = incoming.recv() => event
                .map(ContentSupervisorEvent::Incoming)
                .ok_or_else(|| DownloadError::PeerTask(
                    "incoming content route stopped unexpectedly".to_owned()
                )),
            event = discovery.next_event(), if discovery.is_active() => {
                Ok(ContentSupervisorEvent::Discovery(event))
            }
            _ = tokio::time::sleep(wait), if until_expiry.is_some() => {
                Ok(ContentSupervisorEvent::Deadline)
            }
            _ = tokio::time::sleep(CONTENT_SWARM_MAINTENANCE_INTERVAL) => {
                Ok(ContentSupervisorEvent::Deadline)
            }
        },
        ContentSupervisorOwner::Peer => tokio::select! {
            biased;
            error = content_shutdown(cancellation, active_upload_failure) => Err(error),
            changed = streaming_updates.changed() => changed
                .map(|()| ContentSupervisorEvent::Streaming)
                .map_err(|_| DownloadError::StorageTask(
                    "streaming-demand controller stopped unexpectedly".to_owned()
                )),
            event = sockets.next_event() => event
                .map(ContentSupervisorEvent::Peer)
                .map_err(download_peer_set_error),
            event = incoming.recv() => event
                .map(ContentSupervisorEvent::Incoming)
                .ok_or_else(|| DownloadError::PeerTask(
                    "incoming content route stopped unexpectedly".to_owned()
                )),
            event = discovery.next_event(), if discovery.is_active() => {
                Ok(ContentSupervisorEvent::Discovery(event))
            }
            completion = storage.next_completion() => {
                completion.map(ContentSupervisorEvent::Storage)
            }
            _ = tokio::time::sleep(wait), if until_expiry.is_some() => {
                Ok(ContentSupervisorEvent::Deadline)
            }
            _ = tokio::time::sleep(CONTENT_SWARM_MAINTENANCE_INTERVAL) => {
                Ok(ContentSupervisorEvent::Deadline)
            }
        },
        ContentSupervisorOwner::Discovery => tokio::select! {
            biased;
            error = content_shutdown(cancellation, active_upload_failure) => Err(error),
            changed = streaming_updates.changed() => changed
                .map(|()| ContentSupervisorEvent::Streaming)
                .map_err(|_| DownloadError::StorageTask(
                    "streaming-demand controller stopped unexpectedly".to_owned()
                )),
            event = discovery.next_event(), if discovery.is_active() => {
                Ok(ContentSupervisorEvent::Discovery(event))
            }
            completion = storage.next_completion() => {
                completion.map(ContentSupervisorEvent::Storage)
            }
            event = sockets.next_event() => event
                .map(ContentSupervisorEvent::Peer)
                .map_err(download_peer_set_error),
            event = incoming.recv() => event
                .map(ContentSupervisorEvent::Incoming)
                .ok_or_else(|| DownloadError::PeerTask(
                    "incoming content route stopped unexpectedly".to_owned()
                )),
            _ = tokio::time::sleep(wait), if until_expiry.is_some() => {
                Ok(ContentSupervisorEvent::Deadline)
            }
            _ = tokio::time::sleep(CONTENT_SWARM_MAINTENANCE_INTERVAL) => {
                Ok(ContentSupervisorEvent::Deadline)
            }
        },
    }
}

async fn run_selective_swarm_loop(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    incoming_events: &mut mpsc::Receiver<IncomingContentEvent>,
    discovery: &mut ContentDiscovery,
    download: &mut ContentSwarmDownload<'_>,
) -> Result<(), DownloadError> {
    let mut next_owner = ContentSupervisorOwner::Storage;
    let mut selection_updates = download.control.selection_updates();
    let mut streaming_updates = download.control.streaming_demand_updates();
    let mut storage_pressure_started = None;
    let mut rate_limit_started = None;
    let mut next_maintenance_at = Duration::ZERO;
    let mut completion_drain_started = None;
    let mut extension_connections = BTreeSet::new();
    let mut peer_exchange_enabled = peers.peer_exchange_enabled() && !download.content.private();
    if let Some(connection) = peers.connection.take() {
        let attempt = connection.attempt();
        let fast_extension = connection.supports_fast_extension();
        let send_initial_availability = !connection.initial_availability_sent();
        let extension_map = connection.extension_map();
        peers.handoff_to_content(attempt)?;
        let id = sockets
            .add_connection(connection)
            .map_err(download_peer_set_error)?;
        download
            .state
            .add_connection(id, peers.elapsed())
            .map_err(DownloadError::Swarm)?;
        peers.install_extension_map(id, extension_map);
        extension_connections.insert(id);
        download
            .state
            .set_fast_extension(id, fast_extension)
            .map_err(DownloadError::Swarm)?;
        download
            .install_outgoing_upload(
                sockets,
                id,
                attempt.endpoint().address().ip(),
                fast_extension,
                send_initial_availability,
            )
            .await?;
        if peer_exchange_enabled
            && sockets
                .send(
                    id,
                    PeerMessage::Extended {
                        id: 0,
                        payload: public_pex_extension_handshake(),
                    },
                )
                .await
                .is_err()
        {
            close_content_connection(
                peers,
                sockets,
                &mut download.state,
                id,
                Some(PeerFailure::RemoteClosed),
            )
            .await?;
        }
        if sockets.send(id, PeerMessage::Interested).await.is_err() {
            close_content_connection(
                peers,
                sockets,
                &mut download.state,
                id,
                Some(PeerFailure::RemoteClosed),
            )
            .await?;
        } else {
            debug_assert_eq!(id, connection_id(attempt));
        }
    }

    loop {
        let active_connections = sockets
            .connection_attempts()
            .into_iter()
            .map(connection_id)
            .collect::<BTreeSet<_>>();
        extension_connections.retain(|connection| active_connections.contains(connection));
        let next_peer_exchange_enabled =
            peers.peer_exchange_enabled() && !download.content.private();
        if next_peer_exchange_enabled != peer_exchange_enabled {
            peers.apply_peer_exchange_policy(next_peer_exchange_enabled)?;
            for connection in
                send_pex_policy_update(sockets, &extension_connections, next_peer_exchange_enabled)
                    .await
            {
                close_content_connection(
                    peers,
                    sockets,
                    &mut download.state,
                    connection,
                    Some(PeerFailure::RemoteClosed),
                )
                .await?;
            }
            peer_exchange_enabled = next_peer_exchange_enabled;
        }
        download.prune_closed_incoming_content()?;
        let state = &download.state;
        download
            .hash_scheduler
            .retain_connections(|connection| state.has_connection(connection));
        if let Some(diagnosis) = download.leaf_diagnosis.as_mut() {
            diagnosis
                .scheduler
                .retain_connections(|connection| state.has_connection(connection));
        }
        let address_families = peers.peers.address_family_policy();
        sockets.cancel_disallowed(address_families);
        peers
            .peers
            .enforce_address_families(address_families)
            .map_err(map_torrent_peer_error)?;
        let now = peers.elapsed();
        let storage_ready = download.flush_pending_storage()?;
        let storage_backpressured = download.storage_is_backpressured();
        match (storage_pressure_started, storage_backpressured) {
            (None, true) => storage_pressure_started = Some(now),
            (Some(started), false) => {
                download
                    .state
                    .defer_peer_deadlines(now.saturating_sub(started));
                storage_pressure_started = None;
            }
            _ => {}
        }
        let download_rate_limited = peers.peers.download_rate_limited();
        match (rate_limit_started, download_rate_limited) {
            (None, true) => rate_limit_started = Some(now),
            (Some(started), false) => {
                download
                    .state
                    .defer_peer_deadlines(now.saturating_sub(started));
                rate_limit_started = None;
            }
            _ => {}
        }
        peers.publish_peer_registry(false);
        for (connection, failure, reason) in download.service_outgoing_uploads(sockets).await? {
            let diagnostic = DownloadError::PeerTask(format!("content peer rejected: {reason}"));
            peers.control.observe_content_error(Some(&diagnostic));
            download.remove_outgoing_upload(connection).await;
            if sockets.contains(connection) {
                close_content_connection(
                    peers,
                    sockets,
                    &mut download.state,
                    connection,
                    Some(failure),
                )
                .await?;
            }
        }
        if now >= next_maintenance_at {
            if !storage_backpressured && !download_rate_limited {
                download
                    .state
                    .expire_requests(now)
                    .map_err(DownloadError::Swarm)?;
            }
            download.control.observe_swarm(&download.state, now);
            let hash_snapshot = download.hash_scheduler.snapshot();
            let leaf_attempts = download
                .leaf_diagnosis
                .as_ref()
                .map_or(0, |diagnosis| diagnosis.scheduler.active_attempts());
            debug_assert!(
                hash_snapshot.active_attempts.saturating_add(leaf_attempts)
                    <= crate::v2_hash_scheduler::MAX_HASH_ATTEMPTS_PER_TORRENT
            );
            download.control.emit_storage_state();
            peers.observe_content_peers(&download.state)?;
            for connection in send_due_pex(peers, sockets).await? {
                close_content_connection(
                    peers,
                    sockets,
                    &mut download.state,
                    connection,
                    Some(PeerFailure::RemoteClosed),
                )
                .await?;
            }
            next_maintenance_at = now.saturating_add(CONTENT_SWARM_MAINTENANCE_INTERVAL);
        }

        if download
            .leaf_diagnosis
            .as_ref()
            .is_some_and(|diagnosis| now >= diagnosis.deadline)
        {
            let failure = download
                .fallback_leaf_diagnosis()?
                .expect("expired leaf diagnosis has a fallback failure");
            let disposition = download
                .piece_failure_disposition(failure, "leaf proof timed out; resetting whole piece");
            apply_content_disposition(peers, sockets, download, None, disposition).await?;
        }

        let hash_assignments = download.schedule_hashes(sockets, now);
        let mut failed_connections = BTreeSet::new();
        for assignment in hash_assignments {
            if download
                .send_content_message(
                    sockets,
                    assignment.connection,
                    PeerMessage::HashRequest(assignment.request),
                )
                .await
                .is_err()
            {
                if download.leaf_diagnosis.as_ref().is_some_and(|diagnosis| {
                    diagnosis
                        .scheduler
                        .owns_attempt(assignment.connection, assignment.request)
                }) {
                    download
                        .leaf_diagnosis
                        .as_mut()
                        .expect("owned leaf send has a diagnosis")
                        .scheduler
                        .send_failed(assignment.connection, assignment.request);
                } else {
                    download
                        .hash_scheduler
                        .send_failed(assignment.connection, assignment.request);
                }
                failed_connections.insert(assignment.connection);
            }
        }
        download
            .control
            .observe_integrity_preparation(download.integrity_preparation());

        let scheduled = if storage_ready && !storage_backpressured {
            download.schedule(now)?
        } else {
            ContentRequestSchedule::default()
        };
        for cancellation in scheduled.cancellations {
            let _ = download
                .send_content_message(
                    sockets,
                    cancellation.connection,
                    PeerMessage::Cancel(cancellation.block.request()),
                )
                .await;
        }
        for assignment in scheduled.assignments {
            if download
                .send_content_message(
                    sockets,
                    assignment.connection,
                    PeerMessage::Request(assignment.block.request()),
                )
                .await
                .is_err()
            {
                failed_connections.insert(assignment.connection);
                continue;
            }
            let piece_length = download
                .layout
                .piece_length_at(assignment.block.piece)
                .map_err(DownloadError::Layout)?;
            let (attempt, started) = download
                .control
                .disk_block_requested(assignment.block, piece_length);
            if started {
                download.control.emit(DownloadActivityEvent::PieceStarted {
                    piece_index: assignment.block.piece,
                    piece_length,
                    attempt,
                });
            }
            download
                .control
                .emit(DownloadActivityEvent::BlockRequested {
                    piece_index: assignment.block.piece,
                    begin: assignment.block.begin,
                    length: assignment.block.length,
                });
        }
        for connection in failed_connections {
            close_content_connection(
                peers,
                sockets,
                &mut download.state,
                connection,
                Some(PeerFailure::RemoteClosed),
            )
            .await?;
        }
        if download.is_complete() {
            let now = peers.elapsed();
            download.control.observe_swarm(&download.state, now);
            download.control.emit_storage_state_force();
            peers.observe_content_peers(&download.state)?;
            let started = completion_drain_started.get_or_insert(now);
            if !download.outgoing_upload_work_pending()
                || now.saturating_sub(*started) >= Duration::from_secs(5)
            {
                return Ok(());
            }
        }

        if !storage_backpressured {
            fill_content_dials(
                peers,
                sockets,
                &mut download.state,
                download.incoming_content.len(),
                discovery.is_active(),
            )?;
        }
        if sockets.established_len() == 0
            && download.incoming_content.is_empty()
            && sockets.pending_len() == 0
            && !discovery.is_active()
            && download.control.snapshot().storage_jobs_pending == 0
        {
            return Err(peers
                .last_error
                .take()
                .unwrap_or(DownloadError::NoUsablePeer));
        }

        let until_expiry =
            (!storage_backpressured).then(|| next_maintenance_at.saturating_sub(peers.elapsed()));
        let cancellation = peers.control.cancellation_token();
        let active_upload_failure = download.active_upload_failure.clone();
        let event = {
            let storage = download.storage_pipeline_mut()?;
            next_content_supervisor_event(
                sockets,
                incoming_events,
                discovery,
                storage,
                ContentSupervisorWait {
                    storage_backpressured,
                    until_expiry,
                    cancellation: &cancellation,
                    active_upload_failure: &active_upload_failure,
                    selection_updates: &mut selection_updates,
                    streaming_updates: &mut streaming_updates,
                    priority: next_owner,
                },
            )
            .await?
        };
        if let Some(owner) = event.owner() {
            next_owner = owner.next();
        }

        match event {
            ContentSupervisorEvent::Deadline => continue,
            ContentSupervisorEvent::Streaming => continue,
            ContentSupervisorEvent::Selection(update) => {
                while download.control.snapshot().storage_jobs_pending != 0 {
                    download.flush_pending_storage()?;
                    let completion = download.storage_pipeline_mut()?.next_completion().await?;
                    let disposition = download
                        .handle_storage_completion(completion, peers.elapsed())
                        .await?;
                    apply_content_disposition(peers, sockets, download, None, disposition).await?;
                }
                download.reconcile_file_selection(sockets, update).await?;
            }
            ContentSupervisorEvent::Storage(completion) => {
                let disposition = download
                    .handle_storage_completion(completion, peers.elapsed())
                    .await?;
                apply_content_disposition(peers, sockets, download, None, disposition).await?;
            }
            ContentSupervisorEvent::Discovery(Some(ContentDiscoveryEvent::Peers {
                swarm_key,
                source,
                tracker,
                addresses,
            })) => {
                let peer_count = addresses.len().try_into().unwrap_or(u32::MAX);
                for address in addresses {
                    if let Err(error) =
                        peers.observe_address_on_lane(address, source, Some(swarm_key))
                    {
                        peers.last_error = Some(error);
                    }
                }
                if let Some(tracker) = tracker
                    && peers
                        .select_candidate(PeerSelectionContext {
                            now: peers.elapsed(),
                        })
                        .is_none()
                {
                    peers
                        .control
                        .emit(DownloadActivityEvent::TrackerPeersUnavailable {
                            tracker,
                            peer_count,
                        });
                }
            }
            ContentSupervisorEvent::Discovery(Some(ContentDiscoveryEvent::Failed(error))) => {
                peers.last_error = Some(error);
            }
            ContentSupervisorEvent::Discovery(None) => {}
            ContentSupervisorEvent::Incoming(IncomingContentEvent::Connected {
                attachment,
                capabilities,
                commands,
            }) => {
                let id = attachment.connection_id();
                if download.established_content_connections(sockets)
                    >= download.state.config().max_established_connections
                    || download.incoming_content.contains_key(&id)
                    || sockets.contains(id)
                {
                    peers.peers.cancel_incoming_content(attachment);
                    continue;
                }
                download
                    .state
                    .add_connection(id, peers.elapsed())
                    .map_err(DownloadError::Swarm)?;
                download
                    .state
                    .set_fast_extension(id, capabilities.fast)
                    .map_err(DownloadError::Swarm)?;
                download.incoming_content.insert(
                    id,
                    IncomingContentPeer {
                        attachment,
                        protocol: capabilities.protocol,
                        commands,
                    },
                );
                if download
                    .send_content_message(sockets, id, PeerMessage::Interested)
                    .await
                    .is_err()
                {
                    download
                        .close_content_peer(
                            peers,
                            sockets,
                            id,
                            Some(PeerFailure::RemoteClosed),
                            ConnectionRemoval::Disconnected,
                        )
                        .await?;
                }
            }
            ContentSupervisorEvent::Incoming(IncomingContentEvent::Message {
                attachment,
                message,
            }) => {
                let id = attachment.connection_id();
                if !download
                    .incoming_content
                    .get(&id)
                    .is_some_and(|peer| peer.attachment == attachment)
                {
                    continue;
                }
                let disposition = download
                    .handle_message(peers, sockets, id, message, peers.elapsed())
                    .await?;
                apply_content_disposition(peers, sockets, download, Some(id), disposition).await?;
            }
            ContentSupervisorEvent::Incoming(IncomingContentEvent::Stopped {
                attachment,
                failure,
            }) => {
                let id = attachment.connection_id();
                if download
                    .incoming_content
                    .get(&id)
                    .is_some_and(|peer| peer.attachment == attachment)
                {
                    download.incoming_content.remove(&id);
                    download
                        .state
                        .remove_connection(id, ConnectionRemoval::Disconnected)
                        .map_err(DownloadError::Swarm)?;
                    download.prune_contributor_attempts();
                }
                if let Some(failure) = failure {
                    peers.record_content_error(DownloadError::PeerTask(format!(
                        "incoming content peer stopped: {failure:?}"
                    )));
                }
            }
            ContentSupervisorEvent::Peer(PeerSetEvent::DialPhase { attempt, transport }) => {
                peers.transport_connected(attempt, transport)?;
            }
            ContentSupervisorEvent::Peer(PeerSetEvent::DialCompleted {
                attempt,
                utp_outcome,
                result,
            }) => {
                download
                    .state
                    .finish_dial(pending_dial_id(attempt))
                    .map_err(DownloadError::Swarm)?;
                peers.record_utp_outcome(attempt, utp_outcome)?;
                match *result {
                    Ok((connection, handshake)) => {
                        let admission = peers.dial_succeeded(attempt, &connection, &handshake)?;
                        if let Some(failure) = admission_rejection_failure(admission) {
                            peers.connection_closed(attempt, Some(failure))?;
                            continue;
                        }
                        if let PeerAdmissionOutcome::Admitted {
                            evicted: Some(evicted),
                        } = admission
                            && sockets.contains(evicted)
                        {
                            close_content_connection(
                                peers,
                                sockets,
                                &mut download.state,
                                evicted,
                                Some(PeerFailure::DuplicatePeerId),
                            )
                            .await?;
                        }
                        if download.established_content_connections(sockets)
                            >= download.state.config().max_established_connections
                        {
                            if let Some(replaced) = (!peers.peers.download_rate_limited())
                                .then(|| download.state.replacement_candidate(peers.elapsed()))
                                .flatten()
                            {
                                download
                                    .close_content_peer(
                                        peers,
                                        sockets,
                                        replaced,
                                        None,
                                        ConnectionRemoval::Replaced,
                                    )
                                    .await?;
                            } else {
                                peers.begin_disconnect(attempt, None)?;
                                peers.connection_closed(attempt, None)?;
                                continue;
                            }
                        }
                        let id = sockets
                            .add_connection(connection)
                            .map_err(download_peer_set_error)?;
                        if handshake.supports_extensions() {
                            extension_connections.insert(id);
                        }
                        download
                            .state
                            .add_connection(id, peers.elapsed())
                            .map_err(DownloadError::Swarm)?;
                        let capabilities = NegotiatedPeerCapabilities::negotiate(
                            peer_socket::advertised_reserved_bits(true),
                            &handshake,
                        );
                        download
                            .state
                            .set_fast_extension(id, capabilities.fast_extension)
                            .map_err(DownloadError::Swarm)?;
                        if download
                            .install_outgoing_upload(
                                sockets,
                                id,
                                attempt.endpoint().address().ip(),
                                capabilities.fast_extension,
                                true,
                            )
                            .await
                            .is_err()
                        {
                            close_content_connection(
                                peers,
                                sockets,
                                &mut download.state,
                                id,
                                Some(PeerFailure::RemoteClosed),
                            )
                            .await?;
                            continue;
                        }
                        if peer_exchange_enabled
                            && handshake.supports_extensions()
                            && !download.content.private()
                            && sockets
                                .send(
                                    id,
                                    PeerMessage::Extended {
                                        id: 0,
                                        payload: public_pex_extension_handshake(),
                                    },
                                )
                                .await
                                .is_err()
                        {
                            close_content_connection(
                                peers,
                                sockets,
                                &mut download.state,
                                id,
                                Some(PeerFailure::RemoteClosed),
                            )
                            .await?;
                            continue;
                        }
                        if sockets.send(id, PeerMessage::Interested).await.is_err() {
                            close_content_connection(
                                peers,
                                sockets,
                                &mut download.state,
                                id,
                                Some(PeerFailure::RemoteClosed),
                            )
                            .await?;
                        }
                    }
                    Err(error) => {
                        let failure = error.peer_failure();
                        if let Some(endpoint) = error.mse_endpoint_update() {
                            peers.update_mse_endpoint(attempt, endpoint)?;
                        }
                        peers.dial_failed(attempt, failure)?;
                        peers.last_error = Some(download_peer_socket_error(error));
                    }
                }
            }
            ContentSupervisorEvent::Peer(PeerSetEvent::Peer(PeerTaskEvent::Message {
                attempt,
                message,
            })) => {
                let id = connection_id(attempt);
                if !sockets.contains(id) {
                    continue;
                }
                let disposition = download
                    .handle_message(peers, sockets, id, message, peers.elapsed())
                    .await?;
                apply_content_disposition(peers, sockets, download, Some(id), disposition).await?;
            }
            ContentSupervisorEvent::Peer(PeerSetEvent::Peer(PeerTaskEvent::Stopped {
                attempt,
                result,
            })) => {
                let id = connection_id(attempt);
                if !sockets.contains(id) {
                    continue;
                }
                let failure = result.as_ref().err().map(PeerSocketError::peer_failure);
                if let Err(error) = result {
                    peers.record_content_error(download_peer_socket_error(error));
                }
                download.remove_outgoing_upload(id).await;
                close_content_connection(peers, sockets, &mut download.state, id, failure).await?;
            }
        }
    }
}

async fn apply_content_disposition(
    peers: &mut TorrentPeerCoordinator,
    sockets: &mut PeerSocketSet,
    download: &mut ContentSwarmDownload<'_>,
    connection: Option<ConnectionId>,
    disposition: ContentMessageDisposition,
) -> Result<(), DownloadError> {
    match disposition {
        ContentMessageDisposition::Continue => {}
        ContentMessageDisposition::ClosePeer { failure, reason } => {
            let connection = connection.ok_or(DownloadError::Swarm(SwarmError::Invariant(
                "storage completion cannot close a peer",
            )))?;
            let diagnostic = DownloadError::PeerTask(format!("content peer rejected: {reason}"));
            peers.control.observe_content_error(Some(&diagnostic));
            download
                .close_content_peer(
                    peers,
                    sockets,
                    connection,
                    Some(failure),
                    ConnectionRemoval::Disconnected,
                )
                .await?;
        }
        ContentMessageDisposition::PieceVerified(contributors) => {
            record_verified_piece_contributors(peers, download, &contributors)?;
        }
        ContentMessageDisposition::PieceHashFailed(failure) => {
            record_failed_piece_contributors(peers, sockets, download, &failure).await?;
        }
    }
    Ok(())
}

async fn download_content_swarm<'a>(
    peers: &mut TorrentPeerCoordinator,
    mut download: ContentSwarmDownload<'a>,
) -> Result<ContentSwarmDownload<'a>, DownloadError> {
    if peers.swarm_key.is_none() {
        peers.swarm_key = Some(download.content.swarm_key());
        peers.set_content_identities(download.content.info_hashes());
        peers.ensure_tracker_lanes()?;
    }
    let sockets = PeerSocketSet::with_owners(peers.peer_budget.clone(), peers.mse_dh.clone())
        .with_bandwidth(peers.peers.bandwidth());
    let mut sockets = sockets;
    let (incoming_sender, mut incoming_events) = mpsc::channel(INCOMING_CONTENT_EVENT_CAPACITY);
    let incoming_route = peers.peers.install_incoming_content_route(incoming_sender);
    let mut discovery = ContentDiscovery::start(peers);
    let result = match download.register_active_route(peers.peers.clone()).await {
        Ok(()) => {
            run_selective_swarm_loop(
                peers,
                &mut sockets,
                &mut incoming_events,
                &mut discovery,
                &mut download,
            )
            .await
        }
        Err(error) => Err(error),
    };
    let failure = result.as_ref().err().and_then(content_peer_failure);
    peers.peers.remove_incoming_content_route(incoming_route);
    // Nothing reads inbound content events after the loop. Closing the queue
    // fails sends parked on it, so the inbound peer tasks that the
    // unregistration joins can observe their cancellation.
    incoming_events.close();
    let registration_cleanup = download.unregister_active_route().await;
    let discovery_cleanup = discovery.shutdown().await.map(|trackers| {
        peers.trackers = trackers;
    });
    let peer_cleanup =
        cleanup_content_connections(peers, sockets, &mut download.state, failure).await;
    download.shutdown_incoming_content(&peers.peers);
    download.shutdown_outgoing_uploads().await;
    let connection_cleanup = match (discovery_cleanup, peer_cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(first), Err(second)) => Err(DownloadError::PeerTask(format!(
            "{first}; additionally {second}"
        ))),
    };
    let connection_cleanup = match (connection_cleanup, registration_cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(first), Err(second)) => Err(DownloadError::PeerTask(format!(
            "{first}; additionally {second}"
        ))),
    };
    let storage_cleanup = download
        .stop_storage(result.is_err() || connection_cleanup.is_err())
        .await;
    let cleanup = match (connection_cleanup, storage_cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(first), Err(second)) => Err(DownloadError::StorageTask(format!(
            "{first}; additionally {second}"
        ))),
    };
    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(download),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => Err(DownloadError::PeerCleanup {
            failure: error.to_string(),
            cleanup: cleanup.to_string(),
        }),
    }
}

struct FullRecheckResult {
    verified: Vec<bool>,
    recovered: Vec<u32>,
    candidates: BTreeSet<u32>,
}

pub(crate) fn expected_piece_for_recheck(
    content: &TorrentContent,
    integrity: &TorrentIntegrity,
    piece: u32,
) -> Result<Option<ExpectedPieceIntegrity>, DownloadError> {
    match content {
        TorrentContent::V1(_) => content
            .expected_piece(integrity, piece)
            .map(Some)
            .map_err(|error| DownloadError::StorageTask(error.to_string())),
        TorrentContent::V2(_) => content
            .v2_expected_piece(integrity, piece)
            .map(|expected| match expected {
                V2ExpectedPieceQuery::Known(expected) => Some(expected),
                V2ExpectedPieceQuery::Missing { .. } => None,
            })
            .map_err(|error| DownloadError::StorageTask(error.to_string())),
        TorrentContent::Hybrid(_) => content
            .v2_expected_piece(integrity, piece)
            .map_err(|error| DownloadError::StorageTask(error.to_string()))
            .and_then(|expected| match expected {
                V2ExpectedPieceQuery::Known(_) => content
                    .expected_piece(integrity, piece)
                    .map(Some)
                    .map_err(|error| DownloadError::StorageTask(error.to_string())),
                V2ExpectedPieceQuery::Missing { .. } => Ok(None),
            }),
    }
}

async fn wait_for_checking_resume(
    control: &DownloadControl,
    paused: &mut watch::Receiver<bool>,
) -> Result<(), DownloadError> {
    loop {
        let pause_requested = *paused.borrow_and_update();
        if !pause_requested {
            return Ok(());
        }
        control.checker_set_phase(CheckerPhase::Paused);
        tokio::select! {
            _ = control.cancelled() => return Err(DownloadError::Cancelled),
            changed = paused.changed() => {
                if changed.is_err() {
                    return Err(DownloadError::Cancelled);
                }
            }
        }
    }
}

async fn full_recheck_storage(
    storage: &mut SelectiveStorage,
    content: &TorrentContent,
    integrity: &TorrentIntegrity,
    layout: &ContentLayout,
    previous: &[bool],
    selection: &mut AppliedFileSelection,
    control: &DownloadControl,
) -> Result<FullRecheckResult, DownloadError> {
    let mut verified = vec![false; layout.piece_count()];
    for piece_index in 0..layout.piece_count() {
        storage
            .set_verified(piece_index, false)
            .map_err(DownloadError::SelectiveStorage)?;
    }

    let hash_concurrency = control.storage_execution_limits().1;
    let mut running = JoinSet::new();
    let mut recovered = Vec::new();
    let mut candidates = BTreeSet::new();
    let mut cancelled = false;
    let mut first_error = None;
    let mut next_piece_index = 0_usize;
    let mut pause_updates = control.checking_pause_updates();
    let mut heartbeat = tokio::time::interval_at(
        TokioInstant::now() + Duration::from_secs(1),
        Duration::from_secs(1),
    );
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    control.checker_set_phase(CheckerPhase::Hashing);

    loop {
        cancelled |= control.is_cancelled();
        let pause_requested = *pause_updates.borrow_and_update();
        let pending_selection = control
            .latest_file_selection()
            .filter(|update| update.revision > selection.revision);
        if pending_selection.is_some() {
            control.checker_set_phase(CheckerPhase::ReconcilingStorage);
        }
        if running.is_empty()
            && let Some(update) = pending_selection.as_ref()
        {
            let next_selection = FileSelection::new_content(layout, &update.skip_files)
                .map_err(DownloadError::Layout)?;
            layout
                .piece_priorities(&next_selection, &update.high_priority_files)
                .map_err(DownloadError::Layout)?;
            if next_selection != selection.selection {
                let reconcile = storage
                    .reconcile_selection(next_selection.clone())
                    .await
                    .map_err(DownloadError::SelectiveStorage)?;
                for piece_index in reconcile.invalidated_pieces {
                    verified[piece_index] = false;
                    let piece_index = u32::try_from(piece_index)
                        .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                    recovered.retain(|recovered| *recovered != piece_index);
                }
            }
            selection.selection = next_selection;
            selection.high_priority_files = update.high_priority_files.clone();
            selection.revision = update.revision;
            control.file_selection_applied(update.revision);
            control.checker_set_phase(CheckerPhase::Hashing);
            continue;
        }
        if running.is_empty() && pause_requested {
            wait_for_checking_resume(control, &mut pause_updates).await?;
            control.checker_set_phase(CheckerPhase::Hashing);
            continue;
        }
        while !cancelled
            && first_error.is_none()
            && pending_selection.is_none()
            && !pause_requested
            && running.len() < hash_concurrency
        {
            if next_piece_index == layout.piece_count() {
                break;
            }
            let piece_index = u32::try_from(next_piece_index)
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            next_piece_index += 1;
            let piece_length = layout
                .piece_length_at(piece_index)
                .map_err(DownloadError::Layout)?;
            let bytes_hashed = layout
                .file_segments(piece_index, 0, piece_length)
                .map_err(DownloadError::Layout)?
                .into_iter()
                .filter(|segment| !segment.padding)
                .try_fold(0_u64, |total, segment| {
                    total
                        .checked_add(segment.length as u64)
                        .ok_or(DownloadError::Layout(LayoutError::ArithmeticOverflow))
                })?;
            let available = match storage.has_piece_sources(piece_index).await {
                Ok(available) => available,
                Err(error) => {
                    control.disk_storage_error(&error.to_string());
                    first_error = Some(DownloadError::SelectiveStorage(error));
                    break;
                }
            };
            if !available {
                control.checker_piece_processed(piece_index, 0, CheckerPieceOutcome::Absent);
                continue;
            }
            let Some(expected) = expected_piece_for_recheck(content, integrity, piece_index)?
            else {
                // Info-only v2 metadata authenticates the file root but not a
                // multi-piece file's piece layer. Preserve readable bytes as
                // candidates for the runtime hash coordinator instead of
                // treating the persisted have bit as authority.
                candidates.insert(piece_index);
                control.checker_piece_processed(piece_index, 0, CheckerPieceOutcome::Absent);
                continue;
            };
            let operation = match storage.prepare_hash(piece_index) {
                Ok(operation) => operation,
                Err(error) if error.is_missing_or_short_source() => {
                    control.checker_piece_processed(piece_index, 0, CheckerPieceOutcome::Absent);
                    continue;
                }
                Err(error) => {
                    control.disk_storage_error(&error.to_string());
                    first_error = Some(DownloadError::SelectiveStorage(error));
                    break;
                }
            };
            control.disk_piece_hashing(piece_index, piece_length);
            control.checker_hash_started(piece_index);
            control.emit(DownloadActivityEvent::PieceHashing { piece_index });
            let started_at = Instant::now();
            control.storage_command_started(StorageCommandKind::Hash, started_at, started_at);
            let job_control = control.clone();
            running.spawn(async move {
                let _session_permit = job_control.wait_before_storage_hash().await;
                (
                    piece_index,
                    piece_length,
                    bytes_hashed,
                    expected,
                    started_at,
                    operation.execute_content().await,
                )
            });
        }

        if running.is_empty() {
            break;
        }
        let result = tokio::select! {
            result = running.join_next() => result,
            _ = heartbeat.tick() => {
                control.checker_heartbeat();
                continue;
            }
        };
        let Some(result) = result else {
            break;
        };
        match result {
            Ok((piece_index, piece_length, bytes_hashed, expected, started_at, result)) => {
                control.storage_command_completed(
                    StorageCommandKind::Hash,
                    started_at,
                    Instant::now(),
                );
                let piece_index_usize = match usize::try_from(piece_index) {
                    Ok(piece_index) => piece_index,
                    Err(_) => {
                        first_error
                            .get_or_insert(DownloadError::Layout(LayoutError::ArithmeticOverflow));
                        continue;
                    }
                };
                let outcome = match result {
                    Ok(actual) => match content_hash_outcome(actual, expected) {
                        (true, _) => CheckerPieceOutcome::Matched,
                        (
                            false,
                            Some(
                                rstorrent_protocol::content::HybridVerificationOutcome::Inconsistent {
                                    v1_matched,
                                    v2_matched,
                                },
                            ),
                        ) => {
                            first_error.get_or_insert(DownloadError::InconsistentHybridHashes {
                                piece: piece_index,
                                v1_matched,
                                v2_matched,
                            });
                            continue;
                        }
                        (false, _) => CheckerPieceOutcome::Mismatched,
                    },
                    Err(error) if error.is_missing_or_short_source() => CheckerPieceOutcome::Absent,
                    Err(error) => {
                        control.disk_piece_failed(piece_index, piece_length, &error.to_string());
                        control.checker_hash_stopped(piece_index);
                        first_error.get_or_insert(DownloadError::SelectiveStorage(error));
                        continue;
                    }
                };
                control.checker_piece_processed(piece_index, bytes_hashed, outcome);
                if outcome != CheckerPieceOutcome::Matched {
                    control.disk_piece_check_unverified(piece_index, piece_length);
                    continue;
                }
                verified[piece_index_usize] = true;
                if let Err(error) = storage.set_verified(piece_index_usize, true) {
                    first_error.get_or_insert(DownloadError::SelectiveStorage(error));
                    continue;
                }
                if !previous[piece_index_usize] {
                    recovered.push(piece_index);
                }
                control.disk_piece_hash_verified(piece_index, piece_length, false);
            }
            Err(error) => {
                first_error.get_or_insert_with(|| DownloadError::StorageTask(error.to_string()));
            }
        }
    }

    if let Some(error) = first_error {
        return Err(error);
    }
    if cancelled {
        control.checker_set_phase(CheckerPhase::Paused);
        return Err(DownloadError::Cancelled);
    }
    Ok(FullRecheckResult {
        verified,
        recovered,
        candidates,
    })
}

async fn reconstruct_complete_selected_v2_piece_layers(
    content: &TorrentContent,
    integrity: &mut TorrentIntegrity,
    selection: &FileSelection,
    storage: &mut SelectiveStorage,
    control: &DownloadControl,
) -> Result<usize, DownloadError> {
    let Some(metainfo) = content.v2_metainfo() else {
        return Ok(0);
    };
    let (TorrentIntegrity::V2(catalog) | TorrentIntegrity::Hybrid(catalog)) = integrity else {
        return Err(DownloadError::StorageTask(
            "v2 content has non-v2 integrity state".to_owned(),
        ));
    };

    let mut reconstructed_files = 0_usize;
    for (file, file_geometry) in metainfo.files.iter().zip(metainfo.layout.files()) {
        if file_geometry.piece_count() <= 1 || !selection.is_wanted(file_geometry.file_index()) {
            continue;
        }
        if catalog.piece_root(file_geometry.start_piece()).is_some() {
            continue;
        }
        let pieces_root = file.pieces_root.ok_or_else(|| {
            DownloadError::StorageTask("v2 file is missing its authenticated root".to_owned())
        })?;
        let geometry = V2FileHashGeometry::new(
            pieces_root,
            file.length,
            metainfo.piece_length,
            file_geometry.start_piece(),
            file_geometry.piece_count(),
        )
        .map_err(|error| DownloadError::StorageTask(error.to_string()))?;
        let mut roots = Vec::with_capacity(file_geometry.piece_count() as usize);
        for piece in file_geometry.piece_range() {
            if control.is_cancelled() {
                return Err(DownloadError::Cancelled);
            }
            if !storage
                .has_piece_sources(piece)
                .await
                .map_err(DownloadError::SelectiveStorage)?
            {
                roots.clear();
                break;
            }
            let length = metainfo
                .layout
                .piece(piece)
                .map_err(|error| DownloadError::StorageTask(error.to_string()))?
                .payload_length;
            let _session_permit = control.wait_before_storage_hash().await;
            control.disk_piece_hashing(piece, length);
            control.emit(DownloadActivityEvent::PieceHashing { piece_index: piece });
            let started_at = Instant::now();
            control.storage_command_started(StorageCommandKind::Hash, started_at, started_at);
            let actual = storage.hash_piece_content(piece).await;
            control.storage_command_completed(StorageCommandKind::Hash, started_at, Instant::now());
            let actual = actual.map_err(DownloadError::SelectiveStorage)?;
            let root = match actual {
                ComputedPieceHash::Sha256 { root, .. } => root,
                ComputedPieceHash::Hybrid { sha256_root, .. } => sha256_root,
                ComputedPieceHash::Sha1(_) => {
                    return Err(DownloadError::StorageTask(
                        "v2 reconstruction used a non-SHA-256 hash".to_owned(),
                    ));
                }
            };
            control.record_bytes(ByteMetric::LogicalHashRead, length as usize);
            roots.push(root);
        }
        if roots.is_empty() {
            continue;
        }
        match catalog.seed_complete_piece_layer(geometry, &roots) {
            Ok(()) => reconstructed_files += 1,
            Err(HashExchangeError::BadProof) => {
                // Complete local bytes which do not reach the authenticated
                // file root remain non-have candidates and are repaired by
                // the ordinary hash-first download path.
            }
            Err(error) => return Err(DownloadError::StorageTask(error.to_string())),
        }
    }
    Ok(reconstructed_files)
}

async fn run_selective_download(
    config: ContentDownloadConfig,
    runtime_content: TorrentContentWithIntegrity,
    control: DownloadControl,
    descriptors: Option<DescriptorStorage>,
    peers: &mut TorrentPeerCoordinator,
    resume: Option<ResumeContext>,
) -> Result<DownloadReport, DownloadError> {
    let TorrentContentWithIntegrity {
        content,
        mut integrity,
    } = runtime_content;
    let layout = ContentLayout::from_content(&content);
    let selection =
        FileSelection::new_content(&layout, &config.skip_files).map_err(DownloadError::Layout)?;
    layout
        .piece_priorities(&selection, &config.high_priority_files)
        .map_err(DownloadError::Layout)?;
    let mut wanted_pieces = Vec::new();
    let mut skipped_piece_count = 0;
    for piece_index in 0..layout.piece_count() {
        let piece_index_u32 = u32::try_from(piece_index)
            .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        let ranges = layout
            .request_ranges(piece_index_u32, &selection)
            .map_err(DownloadError::Layout)?;
        if ranges.is_empty() {
            skipped_piece_count += 1;
        } else {
            wanted_pieces.push(piece_index_u32);
        }
    }
    let mut last_wanted_piece = wanted_pieces
        .last()
        .copied()
        .map_or(Ok(0), usize::try_from)
        .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;

    let descriptor_backed = descriptors.is_some();
    let platform_storage = control.platform_storage();
    let platform_backed = platform_storage.is_some();
    if descriptor_backed && platform_backed {
        return Err(DownloadError::StorageTask(
            "descriptor and platform storage cannot be combined".to_owned(),
        ));
    }
    let mut verified_pieces = match &resume {
        Some(resume) if resume.verified_pieces.is_empty() => vec![false; layout.piece_count()],
        Some(resume) if resume.verified_pieces.len() == layout.piece_count() => {
            resume.verified_pieces.clone()
        }
        Some(resume) => {
            return Err(DownloadError::Checkpoint(format!(
                "have state has {} pieces, expected {}",
                resume.verified_pieces.len(),
                layout.piece_count()
            )));
        }
        None => vec![false; layout.piece_count()],
    };
    let mut candidate_pieces = BTreeSet::new();
    if resume.is_some() && matches!(content, TorrentContent::V2(_) | TorrentContent::Hybrid(_)) {
        for &piece in &wanted_pieces {
            let piece_index = usize::try_from(piece)
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            if verified_pieces[piece_index]
                && matches!(
                    content
                        .v2_expected_piece(&integrity, piece)
                        .map_err(|error| DownloadError::StorageTask(error.to_string()))?,
                    V2ExpectedPieceQuery::Missing { .. }
                )
            {
                candidate_pieces.insert(piece);
            }
        }
    }
    let storage_creation = if platform_storage.is_some() {
        None
    } else {
        Some(control.enter_safe_cancel_critical()?)
    };
    let (mut storage, resumed_storage) = if let Some(platform) = platform_storage {
        let creation = SelectiveStorage::create_content_with_platform(
            platform,
            config.artifact_identity,
            Arc::new(content.clone()),
            &config.skip_files,
            verified_pieces.clone(),
        );
        tokio::pin!(creation);
        let (storage, resumed) = tokio::select! {
            () = control.cancelled() => return Err(DownloadError::Cancelled),
            result = &mut creation => result.map_err(DownloadError::SelectiveStorage)?,
        };
        (storage, Some(resumed))
    } else {
        let part_location = control.path_part_location();
        match (descriptors, &resume) {
            (Some(descriptors), None) => {
                let v1 =
                    content
                        .v1()
                        .ok_or(DownloadError::Metainfo(MetainfoError::Unsupported(
                            "v2 descriptor storage",
                        )))?;
                (
                    SelectiveStorage::create_with_descriptors(
                        config.artifact_identity,
                        &v1.metainfo,
                        v1.layout.clone(),
                        selection.clone(),
                        descriptors,
                    )
                    .await
                    .map_err(DownloadError::SelectiveStorage)?,
                    None,
                )
            }
            (None, Some(_resume)) => {
                let content = Arc::new(content.clone());
                let (storage, resumed) = match control.storage_file_pool() {
                    Some(pool) => {
                        SelectiveStorage::resume_content_with_pool_and_part_location(
                            config.output_path.clone(),
                            config.artifact_identity,
                            content,
                            &config.skip_files,
                            verified_pieces.clone(),
                            pool,
                            &part_location,
                        )
                        .await
                    }
                    None => {
                        SelectiveStorage::resume_content(
                            config.output_path.clone(),
                            config.artifact_identity,
                            content,
                            &config.skip_files,
                            verified_pieces.clone(),
                        )
                        .await
                    }
                }
                .map_err(DownloadError::SelectiveStorage)?;
                (storage, Some(resumed))
            }
            (None, None) => {
                let content = Arc::new(content.clone());
                let storage = match control.storage_file_pool() {
                    Some(pool) => {
                        SelectiveStorage::create_content_with_pool_and_part_location(
                            config.output_path.clone(),
                            config.artifact_identity,
                            content,
                            &config.skip_files,
                            pool,
                            &part_location,
                        )
                        .await
                    }
                    None => {
                        SelectiveStorage::create_content(
                            config.output_path.clone(),
                            config.artifact_identity,
                            content,
                            &config.skip_files,
                        )
                        .await
                    }
                }
                .map_err(DownloadError::SelectiveStorage)?;
                (storage, None)
            }
            (Some(descriptors), Some(resume)) => {
                let v1 =
                    content
                        .v1()
                        .ok_or(DownloadError::Metainfo(MetainfoError::Unsupported(
                            "v2 descriptor storage",
                        )))?;
                let descriptor_is_empty = descriptors
                    .part_file
                    .metadata()
                    .map_err(|source| DownloadError::Io {
                        operation: "inspect resumable descriptor part file",
                        source,
                    })?
                    .len()
                    == 0;
                let initialize = resume.initialize_descriptors && descriptor_is_empty;
                let storage = if initialize {
                    SelectiveStorage::create_with_descriptors(
                        config.artifact_identity,
                        &v1.metainfo,
                        v1.layout.clone(),
                        selection.clone(),
                        descriptors,
                    )
                    .await
                    .map_err(DownloadError::SelectiveStorage)?
                } else {
                    SelectiveStorage::resume_with_descriptors(
                        config.artifact_identity,
                        &v1.metainfo,
                        v1.layout.clone(),
                        selection.clone(),
                        descriptors,
                        verified_pieces.clone(),
                    )
                    .await
                    .map_err(DownloadError::SelectiveStorage)?
                };
                let resumed = if initialize {
                    ResumedStorage::Created
                } else {
                    ResumedStorage::Existing
                };
                (storage, Some(resumed))
            }
        }
    };
    let discovered_recheck_generation = if let (Some(resume), Some(resumed)) =
        (&resume, resumed_storage)
    {
        if resume.validation == ResumeValidationIntent::Full && resumed != ResumedStorage::Created {
            let discovery = storage
                .inspect_discovered_payload()
                .await
                .map_err(DownloadError::SelectiveStorage)?;
            Some(
                resume
                    .checkpoints
                    .storage_discovered(
                        resumed,
                        discovery.expected_files,
                        discovery.present_files,
                        discovery.oversized_files,
                    )
                    .map_err(DownloadError::Checkpoint)?,
            )
        } else {
            resume
                .checkpoints
                .storage_prepared(resumed)
                .map_err(DownloadError::Checkpoint)?;
            None
        }
    } else {
        None
    };
    drop(storage_creation);

    reconstruct_complete_selected_v2_piece_layers(
        &content,
        &mut integrity,
        &selection,
        &mut storage,
        &control,
    )
    .await?;

    let mut applied_selection = AppliedFileSelection {
        selection,
        high_priority_files: config.high_priority_files.clone(),
        revision: 0,
    };
    if let (Some(resume), Some(resumed)) = (&resume, resumed_storage) {
        let validation_started = Instant::now();
        let validation_intent = resume.validation;
        let validation = if validation_intent == ResumeValidationIntent::FastEligible {
            Some(tokio::select! {
                validation = storage.validate_fast_resume(resumed) => {
                    validation.map_err(DownloadError::SelectiveStorage)?
                }
                _ = control.cancelled() => return Err(DownloadError::Cancelled),
            })
        } else {
            None
        };
        let outcome = decide_resume_admission(
            validation_intent,
            validation
                .as_ref()
                .map_or(ResumeStorageEvidence::Matches, |result| result.evidence),
        );
        let elapsed_millis =
            u64::try_from(validation_started.elapsed().as_millis()).unwrap_or(u64::MAX);
        match outcome {
            ResumeAdmissionOutcome::Accepted => {
                let validation = validation.expect("fast admission has structural evidence");
                control.emit(DownloadActivityEvent::FastResumeAccepted {
                    committed_pieces: validation.committed_pieces,
                    relevant_files: validation.relevant_files,
                    artifact_observations: validation.artifact_observations,
                    part_header_bytes: validation.part_header_bytes,
                    elapsed_millis,
                    payload_bytes_read: validation.payload_bytes_read,
                    hash_jobs: validation.hash_jobs,
                });
                storage
                    .reconcile_after_recheck()
                    .await
                    .map_err(DownloadError::SelectiveStorage)?;
            }
            ResumeAdmissionOutcome::NeedsFullCheck(_) => {}
            ResumeAdmissionOutcome::AwaitingStorage => {
                return Err(DownloadError::SelectiveStorage(
                    SelectiveStorageError::InvalidStorageOperation(
                        "fast resume is awaiting storage",
                    ),
                ));
            }
            ResumeAdmissionOutcome::NeedsRepair => {
                return Err(DownloadError::SelectiveStorage(
                    SelectiveStorageError::InvalidStorageOperation(
                        "fast resume storage evidence needs repair",
                    ),
                ));
            }
        }
        // Accepted state keeps the committed bitmap as runtime authority.
        // Every other reachable outcome enters the existing checker.
        if outcome != ResumeAdmissionOutcome::Accepted {
            let ResumeAdmissionOutcome::NeedsFullCheck(reason) = outcome else {
                unreachable!("non-checking outcomes return before checker admission");
            };
            let generation = match discovered_recheck_generation {
                Some(generation) => generation,
                None if resumed == ResumedStorage::Existing
                    && reason == ResumeValidationRejectReason::PendingVerification =>
                {
                    let discovery = storage
                        .inspect_discovered_payload()
                        .await
                        .map_err(DownloadError::SelectiveStorage)?;
                    resume
                        .checkpoints
                        .storage_discovered(
                            resumed,
                            discovery.expected_files,
                            discovery.present_files,
                            discovery.oversized_files,
                        )
                        .map_err(DownloadError::Checkpoint)?
                }
                None => resume
                    .checkpoints
                    .recheck_started()
                    .map_err(DownloadError::Checkpoint)?,
            };
            control.emit(DownloadActivityEvent::FastResumeRejected {
                generation,
                reason,
                committed_pieces: validation.as_ref().map_or_else(
                    || verified_pieces.iter().filter(|piece| **piece).count(),
                    |validation| validation.committed_pieces,
                ),
                relevant_files: validation
                    .as_ref()
                    .map_or(0, |result| result.relevant_files),
                artifact_observations: validation
                    .as_ref()
                    .map_or(0, |result| result.artifact_observations),
                part_header_bytes: validation
                    .as_ref()
                    .map_or(0, |result| result.part_header_bytes),
                elapsed_millis,
            });
            control.checker_started(generation, layout.piece_count());
            let previous = verified_pieces.clone();
            let checked = if resumed == ResumedStorage::Created {
                let mut pause_updates = control.checking_pause_updates();
                control.checker_set_phase(CheckerPhase::Hashing);
                for piece_index in 0..layout.piece_count() {
                    wait_for_checking_resume(&control, &mut pause_updates).await?;
                    control.checker_set_phase(CheckerPhase::Hashing);
                    if control.is_cancelled() {
                        control.checker_set_phase(CheckerPhase::Paused);
                        return Err(DownloadError::Cancelled);
                    }
                    let piece_index = u32::try_from(piece_index)
                        .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                    control.checker_piece_processed(piece_index, 0, CheckerPieceOutcome::Absent);
                }
                FullRecheckResult {
                    verified: vec![false; layout.piece_count()],
                    recovered: Vec::new(),
                    candidates: BTreeSet::new(),
                }
            } else {
                match full_recheck_storage(
                    &mut storage,
                    &content,
                    &integrity,
                    &layout,
                    &previous,
                    &mut applied_selection,
                    &control,
                )
                .await
                {
                    Ok(checked) => checked,
                    Err(error) => {
                        if !matches!(error, DownloadError::Cancelled) {
                            control.checker_finished(generation);
                        }
                        return Err(error);
                    }
                }
            };
            candidate_pieces = checked.candidates.clone();
            let mut pause_updates = control.checking_pause_updates();
            wait_for_checking_resume(&control, &mut pause_updates).await?;
            control.checker_set_phase(CheckerPhase::ReconcilingStorage);
            verified_pieces = checked.verified;
            if let Err(error) = storage.reconcile_after_recheck().await {
                control.checker_finished(generation);
                return Err(DownloadError::SelectiveStorage(error));
            }
            if resumed == ResumedStorage::Existing
                && let Err(error) = storage.sync_pieces(&checked.recovered).await
            {
                control.checker_finished(generation);
                return Err(DownloadError::SelectiveStorage(error));
            }
            wait_for_checking_resume(&control, &mut pause_updates).await?;
            control.checker_set_phase(CheckerPhase::Finalizing);
            let mut durable_have = verified_pieces.clone();
            for &piece in &candidate_pieces {
                let piece = usize::try_from(piece)
                    .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
                durable_have[piece] = true;
            }
            if let Err(error) = resume.checkpoints.have_rechecked(&durable_have) {
                control.checker_finished(generation);
                return Err(DownloadError::Checkpoint(error));
            }
            control.checker_finished(generation);
            wait_for_checking_resume(&control, &mut pause_updates).await?;
        }
    }

    let AppliedFileSelection {
        mut selection,
        mut high_priority_files,
        revision: mut selection_revision,
    } = applied_selection;

    if let Some(update) = control
        .latest_file_selection()
        .filter(|update| update.revision > selection_revision)
    {
        let next_selection = FileSelection::new_content(&layout, &update.skip_files)
            .map_err(DownloadError::Layout)?;
        layout
            .piece_priorities(&next_selection, &update.high_priority_files)
            .map_err(DownloadError::Layout)?;
        if next_selection != selection {
            let reconcile = storage
                .reconcile_selection(next_selection.clone())
                .await
                .map_err(DownloadError::SelectiveStorage)?;
            if !reconcile.invalidated_pieces.is_empty() {
                if let Some(resume) = &resume {
                    resume
                        .checkpoints
                        .pieces_invalidated(&reconcile.invalidated_pieces)
                        .map_err(DownloadError::Checkpoint)?;
                }
                for piece_index in reconcile.invalidated_pieces {
                    verified_pieces[piece_index] = false;
                }
            }
        }
        selection = next_selection;
        high_priority_files = update.high_priority_files;
        selection_revision = update.revision;
        control.file_selection_applied(update.revision);
        wanted_pieces.clear();
        skipped_piece_count = 0;
        for piece_index in 0..layout.piece_count() {
            let piece_index_u32 = u32::try_from(piece_index)
                .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
            if layout
                .request_ranges(piece_index_u32, &selection)
                .map_err(DownloadError::Layout)?
                .is_empty()
            {
                skipped_piece_count += 1;
            } else {
                wanted_pieces.push(piece_index_u32);
            }
        }
        last_wanted_piece = wanted_pieces
            .last()
            .copied()
            .map_or(Ok(0), usize::try_from)
            .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
    }

    wanted_pieces.retain(|piece_index| {
        candidate_pieces.contains(piece_index)
            || usize::try_from(*piece_index)
                .ok()
                .and_then(|piece_index| verified_pieces.get(piece_index))
                .is_none_or(|verified| !*verified)
    });
    let wanted_piece_set = wanted_pieces.iter().copied().collect::<BTreeSet<_>>();
    candidate_pieces.retain(|piece| wanted_piece_set.contains(piece));
    if matches!(content, TorrentContent::V2(_) | TorrentContent::Hybrid(_)) {
        for &piece in &wanted_pieces {
            if candidate_pieces.contains(&piece) {
                continue;
            }
            if matches!(
                content
                    .v2_expected_piece(&integrity, piece)
                    .map_err(|error| DownloadError::StorageTask(error.to_string()))?,
                V2ExpectedPieceQuery::Missing { .. }
            ) && storage
                .has_piece_sources(piece)
                .await
                .map_err(DownloadError::SelectiveStorage)?
            {
                candidate_pieces.insert(piece);
            }
        }
    }
    for &piece in &candidate_pieces {
        let piece_index = usize::try_from(piece)
            .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        verified_pieces[piece_index] = false;
        storage
            .set_verified(piece_index, false)
            .map_err(DownloadError::SelectiveStorage)?;
    }
    let selected_file_bytes = storage.selected_bytes();
    let skipped_file_bytes = storage.skipped_bytes();
    let padding_bytes = storage.padding_bytes();
    let part_path = storage.part_path().map(Path::to_path_buf);
    let plan_selection = selection.clone();
    if resume
        .as_ref()
        .is_some_and(|resume| !resume.download_missing)
        && !wanted_pieces.is_empty()
    {
        return Ok(DownloadReport {
            info_hash: content.swarm_key().into_bytes(),
            piece_hash: diagnostic_piece_hash(&content, &integrity, last_wanted_piece)?,
            bytes_written: 0,
            block_count: 0,
            payload_limit: config.max_buffered_payload_bytes,
            payload_high_water: control.snapshot().payload_high_water,
            outstanding_request_limit: config.swarm_config.max_outstanding_request_bytes,
            outstanding_request_high_water: 0,
            active_piece_limit: config.swarm_config.max_active_piece_bytes,
            verification_buffer: VERIFICATION_CHUNK_LENGTH,
            piece_count: layout.piece_count(),
            verified_piece_count: verified_pieces.iter().filter(|verified| **verified).count(),
            skipped_piece_count,
            selected_file_bytes,
            skipped_file_bytes,
            padding_bytes,
            selected_written_bytes: 0,
            part_written_bytes: 0,
            part_slots: storage.part_slots(),
            part_reopened: storage.has_part_file(),
            part_path,
        });
    }
    let (
        total_blocks,
        total_bytes,
        selected_written_bytes,
        part_written_bytes,
        outstanding_request_high_water,
    ) = if wanted_pieces.is_empty() {
        (0, 0, 0, 0, 0)
    } else {
        let download = ContentSwarmDownload::new(
            config.swarm_config,
            ContentStorageLimits {
                resident_payload_bytes: config.max_buffered_payload_bytes,
                intake_high_watermark_bytes: config.storage_intake_high_watermark_bytes,
            },
            wanted_pieces,
            picker_seed(content.swarm_key().into_bytes(), peers.network.peer_id),
            AppliedFileSelection {
                selection: plan_selection,
                high_priority_files,
                revision: selection_revision,
            },
            ContentStorage(Box::new(storage)),
            ContentDownloadContext {
                content: &content,
                integrity: &mut integrity,
                layout: &layout,
                resume: resume.as_ref(),
                control: &control,
                candidate_pieces,
            },
        )
        .await?;
        let mut completed = download_content_swarm(peers, download).await?;
        selection = completed.selection.clone();
        let result = (
            completed.total_blocks,
            completed.total_bytes,
            completed.selected_written_bytes,
            completed.part_written_bytes,
            completed
                .state
                .snapshot(peers.elapsed())
                .outstanding_request_high_water,
        );
        let returned_storage = completed.take_storage()?;
        drop(completed);
        storage = *returned_storage.0;
        result
    };

    skipped_piece_count = 0;
    last_wanted_piece = 0;
    for piece_index in 0..layout.piece_count() {
        let piece_index_u32 = u32::try_from(piece_index)
            .map_err(|_| DownloadError::Layout(LayoutError::ArithmeticOverflow))?;
        if layout
            .request_ranges(piece_index_u32, &selection)
            .map_err(DownloadError::Layout)?
            .is_empty()
        {
            skipped_piece_count += 1;
        } else {
            last_wanted_piece = piece_index;
        }
    }
    let selected_file_bytes = storage.selected_bytes();
    let skipped_file_bytes = storage.skipped_bytes();
    let padding_bytes = storage.padding_bytes();
    let part_path = storage.part_path().map(Path::to_path_buf);
    if selected_file_bytes == 0 {
        let part_slots = storage.part_slots();
        return Ok(DownloadReport {
            info_hash: content.swarm_key().into_bytes(),
            piece_hash: diagnostic_piece_hash(&content, &integrity, last_wanted_piece)?,
            bytes_written: total_bytes,
            block_count: total_blocks,
            payload_limit: config.max_buffered_payload_bytes,
            payload_high_water: control.snapshot().payload_high_water,
            outstanding_request_limit: config.swarm_config.max_outstanding_request_bytes,
            outstanding_request_high_water,
            active_piece_limit: config.swarm_config.max_active_piece_bytes,
            verification_buffer: VERIFICATION_CHUNK_LENGTH,
            piece_count: layout.piece_count(),
            verified_piece_count: 0,
            skipped_piece_count,
            selected_file_bytes,
            skipped_file_bytes,
            padding_bytes,
            selected_written_bytes,
            part_written_bytes,
            part_slots,
            part_reopened: storage.has_part_file(),
            part_path,
        });
    }

    storage
        .finish_content()
        .await
        .map_err(DownloadError::SelectiveStorage)?;
    if resume.is_some() {
        control.set_completed_storage_evidence(
            storage
                .completed_storage_evidence()
                .await
                .map_err(DownloadError::SelectiveStorage)?,
        );
    }
    let part_slots = storage.part_slots();
    let part_reopened = storage.has_part_file();
    if content.v1().is_some() {
        storage
            .reopen_part_file()
            .await
            .map_err(DownloadError::SelectiveStorage)?;
    }
    Ok(DownloadReport {
        info_hash: content.swarm_key().into_bytes(),
        // Selective pieces may complete in any order. Keep the diagnostic
        // report stable by naming the highest-index wanted piece rather than
        // whichever verification completion happened to arrive last.
        piece_hash: diagnostic_piece_hash(&content, &integrity, last_wanted_piece)?,
        bytes_written: total_bytes,
        block_count: total_blocks,
        payload_limit: config.max_buffered_payload_bytes,
        payload_high_water: control.snapshot().payload_high_water,
        outstanding_request_limit: config.swarm_config.max_outstanding_request_bytes,
        outstanding_request_high_water,
        active_piece_limit: config.swarm_config.max_active_piece_bytes,
        verification_buffer: VERIFICATION_CHUNK_LENGTH,
        piece_count: layout.piece_count(),
        verified_piece_count: layout.piece_count() - skipped_piece_count,
        skipped_piece_count,
        selected_file_bytes,
        skipped_file_bytes,
        padding_bytes,
        selected_written_bytes,
        part_written_bytes,
        part_slots,
        part_reopened,
        part_path,
    })
}

#[cfg(test)]
async fn connect_peer(
    attempt: DialAttempt,
    info_hash: [u8; 20],
    advertise_extensions: bool,
    network: NetworkConfig,
) -> Result<(PeerConnection, Handshake), DownloadError> {
    peer_socket::connect(attempt, info_hash, advertise_extensions, network)
        .await
        .map_err(download_peer_socket_error)
}

async fn next_peer_message(peer: &mut PeerConnection) -> Result<PeerMessage, DownloadError> {
    peer_socket::next_message(peer)
        .await
        .map_err(download_peer_socket_error)
}

async fn read_bounded_metainfo(path: &Path) -> Result<Vec<u8>, DownloadError> {
    let file = File::open(path).await.map_err(|source| DownloadError::Io {
        operation: "open metainfo",
        source,
    })?;
    let mut bytes = Vec::new();
    file.take((BEP9_METAINFO_LIMITS.max_outer_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|source| DownloadError::Io {
            operation: "read metainfo",
            source,
        })?;
    if bytes.len() > BEP9_METAINFO_LIMITS.max_outer_bytes {
        return Err(DownloadError::MetainfoTooLarge {
            maximum: BEP9_METAINFO_LIMITS.max_outer_bytes,
        });
    }
    Ok(bytes)
}

async fn send_message(
    peer: &mut PeerConnection,
    message: &PeerMessage,
) -> Result<(), DownloadError> {
    peer_socket::send_message(peer, message)
        .await
        .map_err(download_peer_socket_error)
}

fn download_peer_socket_error(error: PeerSocketError) -> DownloadError {
    match error {
        PeerSocketError::Cancelled => DownloadError::Cancelled,
        PeerSocketError::NetworkPolicyDenied { address, policy } => {
            DownloadError::NetworkPolicyDenied { address, policy }
        }
        PeerSocketError::Io { operation, source } => DownloadError::Io { operation, source },
        PeerSocketError::TimedOut { operation, timeout } => {
            DownloadError::PeerTimedOut { operation, timeout }
        }
        PeerSocketError::Closed => DownloadError::PeerClosed,
        PeerSocketError::Handshake(error) => DownloadError::Handshake(error),
        error @ (PeerSocketError::MseHandshake(_)
        | PeerSocketError::MseDh(_)
        | PeerSocketError::Entropy(_)
        | PeerSocketError::UtpEncryptionRequired) => DownloadError::PeerTask(error.to_string()),
        PeerSocketError::MseEndpointUpdate { source, .. } => download_peer_socket_error(*source),
        PeerSocketError::Frame(error) => DownloadError::Frame(error),
    }
}

fn download_peer_set_error(error: PeerSetError) -> DownloadError {
    DownloadError::PeerTask(error.to_string())
}

#[cfg(test)]
mod tests;
