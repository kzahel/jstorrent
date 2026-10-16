#![forbid(unsafe_code)]

//! Runtime ownership for the first verified-piece diagnostic.

mod active_seed_content;
mod advertisement;
mod bandwidth;
mod checkpoint;
pub mod dht;
mod direct_content_layout;
mod driver;
mod http_tracker;
mod identity;
mod incoming;
mod metadata_seed;
mod metrics;
mod mse;
mod network;
mod origin_marking;
mod part_file;
pub mod peer;
mod peer_budget;
mod peer_io;
mod peer_runtime;
mod peer_socket;
mod peer_stream;
mod pex;
mod piece_availability;
mod piece_picker;
pub mod port_mapping;
mod positional_io;
mod resume_validation;
mod seed_content;
mod selective_storage;
mod session_resources;
mod session_socket;
mod session_udp;
mod storage_file_pool;
mod streaming;
pub mod swarm;
mod torrent_peer;
mod tracker;
mod udp_fragmentation;
mod upload;
mod upload_scheduler;
mod utp_diagnostic;
mod utp_runtime;
mod v2_hash_scheduler;

pub use active_seed_content::{
    ActiveContentReader, ActiveFileError, ActiveFileReader, MAX_STREAMING_AHEAD_BYTES,
    MAX_STREAMING_AHEAD_PIECES,
};
pub use advertisement::{
    DHT_ANNOUNCE_INTERVAL, DHT_LOOKUP_INTERVAL, DISCOVERY_ADVERTISEMENT_COMMAND_CAPACITY,
    DiscoveryAdvertisementError, DiscoveryAdvertisementHandle, DiscoveryAdvertisementOwnerCounts,
    DiscoveryAdvertisementRegistration, DiscoveryAdvertisementRuntimeSnapshot,
    DiscoveryAdvertisementService, MAX_TRACKER_OPERATIONS, OUTBOUND_ONLY_TRACKER_PORT,
    PeerAdvertisementEndpoint, PeerAdvertisementEndpointScope, PeerAdvertisementFamilyEndpoint,
    TRACKER_STOP_TIMEOUT, TorrentPrivacy, TrackerCounterSnapshot, TrackerCounters,
    UNKNOWN_METADATA_LEFT_BYTES,
};
pub use bandwidth::{
    BandwidthDirectionSnapshot, BandwidthError, BandwidthPermit, MAX_BANDWIDTH_BURST_BYTES,
    MAX_BANDWIDTH_GRANT_BYTES, MAX_BANDWIDTH_REGISTRATIONS, MAX_BANDWIDTH_WAITERS,
    MIN_TRANSFER_RATE_BYTES_PER_SECOND, SessionBandwidth, SessionBandwidthHandle,
    SessionBandwidthSnapshot, TorrentBandwidth, TorrentTransferRateLimits, TransferRateLimit,
    TransferRateLimitError,
};
pub use direct_content_layout::{
    ContentShape, DirectContentLayout, DirectContentLayoutError, LogicalContentFile,
};
pub use driver::{
    CheckerPhase, CheckerProgress, ContentPeerActivitySnapshot, ContentRequestWindowPhase,
    DiskCheckpointStage, DiskPieceRuntimeSnapshot, DiskPieceStage, DiskPressure,
    DiskRuntimeSnapshot, DownloadActivityEvent, DownloadActivitySink, DownloadCheckpointSink,
    DownloadConfig, DownloadControl, DownloadDiagnosticSnapshot, DownloadError, DownloadProgress,
    DownloadReport, DownloadResourceLimits, ExternalMagnetMetadataDownloadConfig,
    FileSelectionUpdate, IntegrityPreparationPhase, IntegrityPreparationProgress,
    MagnetDownloadConfig, MetadataAcquisitionPhase, MetadataAcquisitionProgress,
    MetadataAcquisitionSnapshot, MetadataConnectionLimits, MetadataPeerSnapshot, MetadataPeerStage,
    ResumableMagnetDownloadConfig, ResumableMetainfoDownloadConfig, StreamingDemandLease,
    SwarmActivitySnapshot, download_magnet, download_magnet_metadata_with_control,
    download_magnet_metadata_with_dht, download_magnet_metadata_with_dht_and_peers,
    download_magnet_metadata_with_external_discovery, download_magnet_with_control,
    download_verified_piece, download_verified_piece_with_control,
    download_verified_piece_with_peer_state, resume_magnet, resume_magnet_with_control,
    resume_metainfo_with_control,
};
#[cfg(feature = "descriptor-storage-diagnostics")]
#[doc(hidden)]
pub use driver::{
    download_verified_piece_to_descriptors_with_control, resume_magnet_to_descriptors_with_control,
};
#[cfg(feature = "test-platform-root")]
#[doc(hidden)]
pub use http_tracker::install_test_platform_root;
pub use identity::{
    ContentFingerprint, IdentityLookup, IdentityMutation, IdentityRegistry, IdentityRegistryError,
    MAX_IDENTITY_ALIASES, MAX_TORRENT_OWNERS, TorrentId, TorrentIdError, TorrentIdentityContext,
    TorrentIdentityContextError, WireIdentityLookup,
};
pub use incoming::{
    DEFAULT_INCOMING_HANDSHAKE_TIMEOUT, DEFAULT_INCOMING_INACTIVITY_TIMEOUT,
    DEFAULT_INCOMING_KEEPALIVE_INTERVAL, DEFAULT_INCOMING_NO_REQUEST_TIMEOUT,
    DEFAULT_INCOMING_PEER_ACTIVITY_TIMEOUT, DEFAULT_UPLOAD_READ_JOBS,
    INCOMING_WRITER_NO_PROGRESS_TIMEOUT, IncomingPeerAcceptor, IncomingPeerError,
    IncomingPeerHandle, IncomingPeerRuntime, IncomingPeerService, IncomingPeerServiceConfig,
    IncomingPeerServiceSnapshot, IncomingRejection, IncomingRejectionReason, IncomingTcpBootstrap,
    MAX_CONFIGURED_UPLOAD_READ_JOBS, MAX_DEFERRED_METADATA_REQUESTS, MAX_INCOMING_PENDING,
    MAX_INCOMING_WRITER_BYTES, MAX_SEED_REGISTRATIONS, METADATA_SEND_BUFFER_WATERMARK,
    PeerUploadSnapshot, SeedRegistration, SeedRegistrationToken, TorrentUploadSnapshot,
    UploadTrafficSnapshot,
};
pub use metadata_seed::{
    MetadataSeedConfig, MetadataSeedError, MetadataSeedReport, MetadataSeedServer,
    bind_metadata_seed,
};
pub use metrics::{ByteMetric, ByteMetricSink};
pub use mse::{
    MAX_MSE_DH_JOBS, MseDhWorkError, MseDhWorkOwner, MseDhWorkSnapshot, MseHandshakeFailure,
    MseHandshakeObservation, MseHandshakeOutcome, MseHandshakeSink,
};
pub use network::{
    AddressFamily, AddressFamilyPolicy, AddressFamilyPolicyHandle, ApplicationNetworkPrerequisite,
    DEFAULT_PEER_ID, NetworkConfig, NetworkPolicy, NetworkPrerequisiteError,
    NetworkPrerequisiteHandle, NetworkPrerequisiteSnapshot, PeerEncryptionPolicy,
    PeerEncryptionPolicyHandle, PeerExchangePolicyHandle, PeerTransportPolicy,
};
pub use part_file::{PartFile, PartFileError, PartFileIdentity};
pub use peer_budget::{
    DEFAULT_CONNECTION_LIMIT, DEFAULT_INCOMING_CONNECTION_SLACK, DEFAULT_LISTEN_BACKLOG,
    PeerBudget, PeerBudgetConfig, PeerBudgetDirection, PeerBudgetPermit, PeerBudgetPhase,
    PeerBudgetReconfiguration, PeerBudgetRejection, PeerBudgetSnapshot, effective_connection_limit,
};
pub use peer_runtime::{
    PeerConnectionDirection, PeerConnectionLifecycle, PeerConnectionObservation,
    PeerConnectionRole, PeerContentActivity, PeerRequestWindowPhase, PeerRuntimeError,
    PeerTransport, PeerUploadActivity, PeerUploadGrant,
};
pub use pex::PexError;
pub use piece_availability::{
    AvailabilityCursor, AvailabilityDrain, AvailabilitySnapshot, MAX_AVAILABILITY_CHANGES,
    MAX_AVAILABILITY_DRAIN, MAX_LOCAL_AVAILABILITY_BYTES, MAX_LOCAL_AVAILABILITY_PIECES,
    PieceAvailability,
};
pub use piece_picker::PieceActivationPolicy;
pub use resume_validation::{
    ResumeAdmissionOutcome, ResumeStorageEvidence, ResumeValidationIntent,
    ResumeValidationRejectReason, decide_resume_admission,
};
pub use seed_content::{
    MAX_VERIFIED_FILE_READ_BYTES, SeedContent, SeedContentError, SeedContentSnapshot,
    VerifiedFileError, VerifiedFileReader, VerifiedFileSnapshot,
};
pub use selective_storage::{
    CompletedStorageEvidence, FastResumeValidation, MAX_ACTIVE_FILE_READ_BYTES,
    MAX_UPLOAD_READ_SEGMENTS, PathPartLocation, PlatformStorageSpec, ResumedStorage,
    SelectionReconcileReport, SelectiveFileReadPlan, SelectiveStorage, SelectiveStorageError,
    SelectiveUploadReadPlan, SelectiveWriteStats, TorrentArtifactIdentity, TorrentStoragePaths,
    remove_selective_part_if_present, selective_part_path, torrent_storage_paths,
    torrent_storage_paths_for_metainfo, torrent_storage_paths_with_shape, validate_content_name,
    validate_direct_completed_content_with_path, validate_direct_completed_content_with_platform,
    validate_direct_fast_resume_content_with_path,
    validate_direct_fast_resume_content_with_platform, validate_direct_fast_resume_with_path,
    validate_direct_fast_resume_with_platform,
};
#[cfg(feature = "descriptor-storage-diagnostics")]
#[doc(hidden)]
pub use selective_storage::{
    DescriptorFile, DescriptorFileRole, DescriptorStorage, DescriptorStoragePlan,
    DescriptorStoragePlanFile, plan_descriptor_storage,
};
pub use session_resources::{
    SessionDownloadResourceSnapshot, SessionDownloadResources, SessionStorageRootResourceSnapshot,
    SessionTorrentResources,
};
pub use session_socket::{
    MAX_LISTEN_PORT_RETRIES, SessionSocketConfig, SessionSocketError, SessionSocketFamilySet,
    SessionSocketFamilyState, SessionSocketSet, SessionSocketTransport, eligible_global_ipv6,
    select_global_ipv6,
};
pub use session_udp::{
    SESSION_UDP_DHT_QUEUE, SESSION_UDP_UTP_DATAGRAM_BYTES, SESSION_UDP_UTP_QUEUE, SessionUdpError,
    SessionUdpHandle, SessionUdpRepairRequest, SessionUdpService, SessionUdpSnapshot,
    SessionUdpTransport,
};
pub use storage_file_pool::{
    DEFAULT_STORAGE_FILE_LIMIT, MAX_STORAGE_OBSERVATION_TOKEN_BYTES,
    PLATFORM_STORAGE_REQUEST_CAPACITY, PLATFORM_STORAGE_REQUEST_TIMEOUT, PlatformStorageBroker,
    PlatformStorageClient, PlatformStorageFailure, PlatformStorageFailureKind,
    PlatformStorageOperation, PlatformStorageRequest, PlatformStorageTarget, StorageFileAccess,
    StorageFileHandle, StorageFileKey, StorageFileLease, StorageFileLocator, StorageFilePool,
    StorageFilePoolError, StorageFilePoolSnapshot, StorageFileReference, StorageFileRole,
    StorageObjectKind, StorageObservation, platform_storage_channel,
};
pub use streaming::{
    MAX_STREAMING_CANDIDATE_INSPECTIONS, MAX_STREAMING_DEMANDS, StreamingCandidate,
    StreamingCandidateBatch, StreamingCandidateCursor, StreamingDemand, StreamingDemandError,
    StreamingDemandId, StreamingDemandSet, StreamingDemandSnapshot, StreamingPieceInterval,
    StreamingUrgency,
};
pub use torrent_peer::{
    IncomingPeerAttachment, TorrentPeerActivitySink, TorrentPeerError, TorrentPeerHandle,
};
pub use tracker::{
    TrackerAnnounceEvent, TrackerConfig, TrackerConnectionFamily, TrackerEndpoint,
    TrackerHttpsAuthentication, TrackerNextAction, TrackerRuntimeRecordSnapshot,
    TrackerRuntimeSnapshot, TrackerRuntimeStatus, TrackerSource, TrackerTransport,
};
pub use udp_fragmentation::Ipv4FragmentationProtectionStatus;
pub use upload::{
    MAX_GENERATED_ALLOWED_FAST_PIECES, MAX_QUEUED_UPLOAD_BYTES, MAX_QUEUED_UPLOAD_REQUESTS,
    UploadAction, UploadCloseReason, UploadPeerSnapshot, UploadPeerState, UploadRead,
    generate_allowed_fast_set,
};
pub use upload_scheduler::{
    DEFAULT_OPTIMISTIC_UNCHOKE_INTERVAL, DEFAULT_SEEDING_PIECE_QUOTA, DEFAULT_UNCHOKE_INTERVAL,
    DEFAULT_UNCHOKE_SLOTS, UploadDecision, UploadGrant, UploadPeerId, UploadScheduler,
    UploadSchedulerConfig, UploadSchedulerPeer, UploadSchedulerSnapshot,
};
pub use utp_diagnostic::{
    ControlledUtpDownloadError, ControlledUtpDownloadReport, MAX_CONTROLLED_UTP_DOWNLOAD_BYTES,
    download_controlled_utp,
};
pub use utp_runtime::{
    MAX_INCOMING_UTP_HALF_OPEN, MAX_UTP_APPLICATION_WRITE_BYTES, MAX_UTP_CONNECTIONS,
    UTP_CONNECTION_DATAGRAM_QUEUE, UTP_INCOMING_STREAM_QUEUE, UTP_RUNTIME_DATAGRAM_BYTES,
    UtpHandle, UtpPathMtuProfile, UtpRuntimeConfig, UtpRuntimeError, UtpService,
    UtpServiceSnapshot, UtpStream, UtpTerminalEvidence, UtpTerminalKind,
};
