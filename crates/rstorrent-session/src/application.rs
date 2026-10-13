use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rstorrent_engine::dht::{DhtConfig, DhtError};
use rstorrent_engine::{
    ActiveFileError, ApplicationNetworkPrerequisite, ContentShape,
    DEFAULT_INCOMING_HANDSHAKE_TIMEOUT, DEFAULT_INCOMING_INACTIVITY_TIMEOUT,
    DEFAULT_INCOMING_KEEPALIVE_INTERVAL, DEFAULT_INCOMING_NO_REQUEST_TIMEOUT,
    DEFAULT_INCOMING_PEER_ACTIVITY_TIMEOUT, DEFAULT_PEER_ID, DEFAULT_STORAGE_FILE_LIMIT,
    DEFAULT_UPLOAD_READ_JOBS, DirectContentLayout, DiscoveryAdvertisementRegistration,
    DiskCheckpointStage, DownloadActivityEvent, DownloadActivitySink, DownloadCheckpointSink,
    DownloadControl, DownloadError, DownloadResourceLimits, ExternalMagnetMetadataDownloadConfig,
    FileSelectionUpdate, IncomingPeerError, IncomingPeerServiceSnapshot, MseHandshakeObservation,
    MseHandshakeOutcome, MseHandshakeSink, NetworkConfig, NetworkPolicy, NetworkPrerequisiteHandle,
    NetworkPrerequisiteSnapshot, PeerEncryptionPolicy, PeerTransportPolicy, PlatformStorageClient,
    PlatformStorageFailureKind, PlatformStorageSpec, ResumableMagnetDownloadConfig,
    ResumableMetainfoDownloadConfig, ResumeValidationIntent, ResumedStorage, SelectiveStorageError,
    SessionDownloadResourceSnapshot, SessionDownloadResources, SessionSocketError, SessionUdpError,
    StorageFileKey, StorageFileLocator, StorageFilePool, StorageFilePoolSnapshot,
    StorageFileReference, StorageFileRole, StorageObjectKind, TorrentId, TorrentIdentityContext,
    TorrentPrivacy, TrackerConfig, TrackerEndpoint, TrackerSource, TrackerTransport,
    VerifiedFileError, VerifiedFileReader, download_magnet_metadata_with_external_discovery,
    resume_magnet_with_control, resume_metainfo_with_control, torrent_storage_paths,
};
use rstorrent_protocol::content::{TorrentContent, TorrentContentProjection};
use rstorrent_protocol::identity::{InfoHashes, SwarmKey};
use rstorrent_protocol::magnet::{MAX_TRACKER_URL_LENGTH, Magnet, UdpTrackerUrl};
use rstorrent_protocol::metainfo::{
    BEP9_METAINFO_LIMITS, DURABLE_METAINFO_LIMITS, Metainfo, MetainfoError,
};
use rstorrent_protocol::storage_layout::{ContentLayout, FileSelection};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::accounting::{AccountingActivity, TorrentAccountingOwner};
use crate::auto_manager::{
    AdmissionAction, TorrentAdmissionKind, TorrentAdmissionState, TorrentAdmissionType,
    TorrentAutoManager,
};
use crate::control::{
    AddTorrentBytesRequest, AddTorrentDisposition, Command, CommandResult, ErrorCode, FilePriority,
    RemovalDataPolicy, RemovalState, RequestEnvelope, ResponseEnvelope, ResponseOutcome,
    StorageState, TorrentState, parse_revision, validate_request,
};
use crate::diagnostics::{
    DiagnosticCategory, DiagnosticDraft, DiagnosticField, DiagnosticSeverity, DiagnosticSubject,
    category,
};
use crate::file_views::FileProgressModel;
use crate::have::HaveState;
use crate::incoming_seeding::{IncomingSeedingError, SeedReconcileOutcome};
use crate::media::{
    MediaCapabilities, MediaFileAvailability, MediaOriginError, MediaRegistryError,
    MediaResolveError, MediaUrlResponse, VerifiedMediaSource,
};
use crate::product_state::ProductStateOwner;
use crate::seed_policy::{
    AUTO_MANAGE_INTERVAL_SECONDS, HARD_ACTIVE_TORRENT_LIMIT, InactivityState, SeedGoalInput,
    SeedGoalLimits, SeedRankInput, assess_seed_goals, rate_is_inactive, seed_rank,
};
use crate::session_network::{SessionNetworkConfig, SessionNetworkError, SessionNetworkRuntime};
use crate::settings::{StorageRootSnapshot, TorrentTransferLimits};
use crate::speed::{PreparedSpeedHistory, SessionSpeedRecorder, SpeedHistoryRuntime};
use crate::store::{
    ConfiguredStorageRoot, RemovalRecord, ResumeRecord, SessionStore, StorageRootLocation,
    StoreError, StoredStorageRoot, StoredTracker, StoredTrackerSource, StoredTrackerTransport,
    prepare_torrent_bytes,
};
use crate::torrent_runtime::{ActiveDownload, TorrentRuntime};
use crate::tracker_views::TrackerViewModel;

fn parse_durable_metainfo(raw_info: &[u8]) -> Result<Metainfo, MetainfoError> {
    Metainfo::from_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
}

fn parse_peer_metainfo(raw_info: &[u8]) -> Result<Metainfo, MetainfoError> {
    Metainfo::from_info_bytes_with_limits(raw_info, BEP9_METAINFO_LIMITS)
}

fn parse_resume_content(resume: &ResumeRecord) -> Result<TorrentContent, MetainfoError> {
    match (resume.info_hashes.v1_hash(), resume.info_hashes.v2_hash()) {
        (Some(_), None) => resume
            .raw_info
            .as_deref()
            .ok_or(MetainfoError::Unsupported("missing durable v1 info"))
            .and_then(parse_durable_metainfo)
            .map(TorrentContent::from_v1_metainfo),
        (None, Some(_)) => {
            if let Some(source) = resume.metainfo_source.as_deref() {
                let projection = TorrentContentProjection::from_bytes_with_limits(
                    source,
                    DURABLE_METAINFO_LIMITS,
                )?;
                if resume.raw_info.as_deref() != Some(&source[projection.info_span.clone()]) {
                    return Err(MetainfoError::Unsupported(
                        "stored v2 info does not match complete source",
                    ));
                }
                Ok(projection.content)
            } else {
                let raw_info = resume
                    .raw_info
                    .as_deref()
                    .ok_or(MetainfoError::Unsupported("missing durable v2 info"))?;
                TorrentContent::from_v2_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                    .map(|runtime| runtime.content)
            }
        }
        (Some(_), Some(_)) => {
            if let Some(source) = resume.metainfo_source.as_deref() {
                let projection = TorrentContentProjection::from_bytes_with_limits(
                    source,
                    DURABLE_METAINFO_LIMITS,
                )?;
                if resume.raw_info.as_deref() != Some(&source[projection.info_span.clone()]) {
                    return Err(MetainfoError::Unsupported(
                        "stored hybrid info does not match complete source",
                    ));
                }
                Ok(projection.content)
            } else {
                let raw_info = resume
                    .raw_info
                    .as_deref()
                    .ok_or(MetainfoError::Unsupported("missing durable hybrid info"))?;
                TorrentContent::from_hybrid_info_bytes_with_limits(
                    raw_info,
                    DURABLE_METAINFO_LIMITS,
                )
                .map(|runtime| runtime.content)
            }
        }
        (None, None) => Err(MetainfoError::Unsupported("missing torrent identity")),
    }
}

fn runtime_identity(
    torrent_id: TorrentId,
    info_hashes: InfoHashes,
) -> Result<TorrentIdentityContext, ApplicationError> {
    let swarm_key = match (info_hashes.v1_hash(), info_hashes.v2_hash()) {
        (Some(v1), None) => SwarmKey::V1(v1),
        (None, Some(v2)) => v2.swarm_key(),
        (Some(v1), Some(_)) => SwarmKey::V1(v1),
        (None, None) => {
            return Err(ApplicationError::Configuration(format!(
                "torrent {torrent_id} has no runtime identity"
            )));
        }
    };
    TorrentIdentityContext::new(torrent_id, info_hashes, swarm_key)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))
}

fn magnet_runtime_identity(
    identity: TorrentIdentityContext,
    source: &str,
) -> Result<TorrentIdentityContext, ApplicationError> {
    let magnet = Magnet::parse(source)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    TorrentIdentityContext::new(
        identity.torrent_id(),
        identity.info_hashes(),
        magnet.identity.swarm_key(),
    )
    .map_err(|error| ApplicationError::Configuration(error.to_string()))
}

fn media_reader_unavailable_reason(error: &VerifiedFileError) -> MediaFileAvailability {
    match error {
        VerifiedFileError::InvalidFileIndex(_) => MediaFileAvailability::InvalidFile,
        VerifiedFileError::PaddingFile(_) => MediaFileAvailability::Padding,
        VerifiedFileError::UnverifiedFile(_) | VerifiedFileError::InvalidHaveLength { .. } => {
            MediaFileAvailability::Unverified
        }
        VerifiedFileError::UnexpectedArtifact(_)
        | VerifiedFileError::InvalidPlatformContentRoot
        | VerifiedFileError::ReadOwnerClosed
        | VerifiedFileError::Storage { .. }
        | VerifiedFileError::Io { .. } => MediaFileAvailability::StorageUnavailable,
        VerifiedFileError::InvalidRange { .. }
        | VerifiedFileError::ReadTooLarge { .. }
        | VerifiedFileError::ArithmeticOverflow
        | VerifiedFileError::Layout(_)
        | VerifiedFileError::ArtifactLayout(_)
        | VerifiedFileError::StoragePlan(_)
        | VerifiedFileError::TaskJoin(_) => MediaFileAvailability::Incomplete,
    }
}

fn active_media_reader_unavailable_reason(error: &ActiveFileError) -> MediaFileAvailability {
    match error {
        ActiveFileError::InvalidFileIndex(_) => MediaFileAvailability::InvalidFile,
        ActiveFileError::PaddingFile(_) => MediaFileAvailability::Padding,
        ActiveFileError::UnselectedFile(_) => MediaFileAvailability::Unverified,
        ActiveFileError::Closed | ActiveFileError::Unavailable | ActiveFileError::Storage(_) => {
            MediaFileAvailability::StorageUnavailable
        }
        ActiveFileError::InvalidRange { .. }
        | ActiveFileError::ReadTooLarge { .. }
        | ActiveFileError::ArithmeticOverflow => MediaFileAvailability::Incomplete,
    }
}

fn operational_trackers(
    trackers: &[StoredTracker],
) -> Result<Vec<TrackerConfig>, ApplicationError> {
    trackers
        .iter()
        .filter_map(|tracker| {
            if tracker.url.len() > MAX_TRACKER_URL_LENGTH
                || !tracker.url.is_ascii()
                || tracker
                    .url
                    .bytes()
                    .any(|byte| byte.is_ascii_control() || byte == b' ')
                || tracker.url.contains('#')
            {
                return None;
            }
            let endpoint = match tracker.transport {
                StoredTrackerTransport::Udp => {
                    TrackerEndpoint::Udp(UdpTrackerUrl::from_metainfo_url(&tracker.url)?)
                }
                StoredTrackerTransport::Http | StoredTrackerTransport::Https => {
                    TrackerEndpoint::from_http_url(&tracker.url)?
                }
            };
            if !matches!(
                (tracker.transport, endpoint.transport()),
                (StoredTrackerTransport::Udp, TrackerTransport::Udp)
                    | (StoredTrackerTransport::Http, TrackerTransport::Http)
                    | (StoredTrackerTransport::Https, TrackerTransport::Https)
            ) {
                return None;
            }
            Ok(TrackerConfig {
                url: tracker.url.clone(),
                endpoint,
                tier: tracker.tier,
                position: tracker.position,
                source: match tracker.source {
                    StoredTrackerSource::Magnet => TrackerSource::Magnet,
                    StoredTrackerSource::Metainfo => TrackerSource::Metainfo,
                },
            })
            .into()
        })
        .collect()
}

fn allocate_application_peer_id() -> Result<[u8; 20], ApplicationError> {
    let mut peer_id = DEFAULT_PEER_ID;
    getrandom::fill(&mut peer_id[8..])
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    Ok(peer_id)
}

fn prerequisite_view(
    prerequisite: ApplicationNetworkPrerequisite,
) -> crate::ApplicationNetworkPrerequisiteView {
    match prerequisite {
        ApplicationNetworkPrerequisite::Allowed => {
            crate::ApplicationNetworkPrerequisiteView::Allowed
        }
        ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork => {
            crate::ApplicationNetworkPrerequisiteView::WaitingForUnmeteredNetwork
        }
    }
}

fn application_network_runtime_view(
    requested: NetworkPrerequisiteSnapshot,
    effective: NetworkPrerequisiteSnapshot,
    state: crate::ApplicationNetworkRuntimeState,
    degraded_detail: Option<String>,
) -> crate::ApplicationNetworkRuntimeView {
    crate::ApplicationNetworkRuntimeView {
        requested_generation: requested.generation.to_string(),
        requested_prerequisite: prerequisite_view(requested.prerequisite),
        effective_generation: effective.generation.to_string(),
        effective_prerequisite: prerequisite_view(effective.prerequisite),
        state,
        degraded_detail,
    }
}
use crate::views::{
    DhtInspectionView, DurableTorrentViewState, ProgressInputs, SubscriptionError,
    SubscriptionSpec, TorrentActivity, TorrentEtaRuntime, VIEW_SET_REAPER_INTERVAL_MILLIS, ViewHub,
    ViewSetLeaseReaper, ViewSubscription, ranges_from_pieces,
};
use crate::{
    OpenViewSetRequest, OpenViewSetResponse, UpdateViewSetRequest, ViewSet, ViewSetError,
    ViewSetOwner,
};

#[derive(Clone, Debug)]
pub struct ApplicationConfig {
    pub persistence: ApplicationPersistence,
    pub profile_id: String,
    pub storage_roots: Vec<ConfiguredStorageRoot>,
    pub path_root_startup_policy: PathRootStartupPolicy,
    /// Optional caller-owned directory for path-backed selective part files.
    /// Platform-capability roots retain their adapter-owned part placement.
    pub path_part_directory: Option<PathBuf>,
    pub network: NetworkConfig,
    pub initial_network_prerequisite: ApplicationNetworkPrerequisite,
    pub initial_client_settings: crate::ClientSettings,
    pub peer_transport_policy: PeerTransportPolicy,
    pub download_resource_limits: DownloadResourceLimits,
    /// Maximum number of payload descriptors retained by this platform.
    pub storage_file_limit: usize,
    /// Optional platform ceiling applied after the persisted configured limit.
    pub active_download_cap: Option<u16>,
    pub dht: DhtConfig,
    pub upload_read_jobs: usize,
    pub incoming_handshake_timeout: Duration,
    pub incoming_peer_activity_timeout: Duration,
    pub incoming_keepalive_interval: Duration,
    pub incoming_no_request_timeout: Duration,
    pub incoming_inactivity_timeout: Duration,
    pub view_set_lease: Duration,
    pub view_set_reaper_interval: Duration,
    #[doc(hidden)]
    pub peer_budget_max_open_files_for_testing: Option<usize>,
    #[doc(hidden)]
    pub storage_write_delay_for_testing: Duration,
    #[doc(hidden)]
    pub storage_hash_delay_for_testing: Duration,
    #[doc(hidden)]
    pub storage_write_concurrency_for_testing: usize,
    #[doc(hidden)]
    pub storage_hash_concurrency_for_testing: usize,
    #[doc(hidden)]
    pub checkpoint_sync_delay_for_testing: Duration,
    #[doc(hidden)]
    pub checkpoint_commit_delay_for_testing: Duration,
    #[doc(hidden)]
    pub checkpoint_stage_trace_for_testing: bool,
    #[doc(hidden)]
    pub platform_storage_client: Option<PlatformStorageClient>,
    /// Optional platform-owned installation product state. Headless and
    /// stateless configurations omit this owner.
    pub product_state: Option<ProductStateOwner>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ApplicationPersistence {
    Durable { profile_root: PathBuf },
    Ephemeral,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathRootStartupPolicy {
    CreateMissing,
    PreserveUnavailable,
}

impl ApplicationPersistence {
    pub fn durable_profile_root(&self) -> Option<&Path> {
        match self {
            Self::Durable { profile_root } => Some(profile_root),
            Self::Ephemeral => None,
        }
    }

    fn diagnostic_name(&self) -> &'static str {
        match self {
            Self::Durable { .. } => "durable",
            Self::Ephemeral => "ephemeral",
        }
    }
}

impl ApplicationConfig {
    pub fn new(
        profile_root: PathBuf,
        profile_id: String,
        storage_roots: Vec<ConfiguredStorageRoot>,
        network: NetworkConfig,
    ) -> Self {
        Self::with_persistence(
            ApplicationPersistence::Durable { profile_root },
            profile_id,
            storage_roots,
            network,
        )
    }

    pub fn ephemeral(
        profile_id: String,
        storage_roots: Vec<ConfiguredStorageRoot>,
        network: NetworkConfig,
    ) -> Self {
        Self::with_persistence(
            ApplicationPersistence::Ephemeral,
            profile_id,
            storage_roots,
            network,
        )
    }

    fn with_persistence(
        persistence: ApplicationPersistence,
        profile_id: String,
        storage_roots: Vec<ConfiguredStorageRoot>,
        network: NetworkConfig,
    ) -> Self {
        let dht = DhtConfig::for_network(network.policy);
        Self {
            persistence,
            profile_id,
            storage_roots,
            path_root_startup_policy: PathRootStartupPolicy::CreateMissing,
            path_part_directory: None,
            network,
            initial_network_prerequisite: ApplicationNetworkPrerequisite::Allowed,
            initial_client_settings: crate::ClientSettings::default(),
            peer_transport_policy: PeerTransportPolicy::PreferUtp,
            download_resource_limits: DownloadResourceLimits::DESKTOP,
            storage_file_limit: DEFAULT_STORAGE_FILE_LIMIT,
            active_download_cap: None,
            dht,
            upload_read_jobs: DEFAULT_UPLOAD_READ_JOBS,
            incoming_handshake_timeout: DEFAULT_INCOMING_HANDSHAKE_TIMEOUT,
            incoming_peer_activity_timeout: DEFAULT_INCOMING_PEER_ACTIVITY_TIMEOUT,
            incoming_keepalive_interval: DEFAULT_INCOMING_KEEPALIVE_INTERVAL,
            incoming_no_request_timeout: DEFAULT_INCOMING_NO_REQUEST_TIMEOUT,
            incoming_inactivity_timeout: DEFAULT_INCOMING_INACTIVITY_TIMEOUT,
            view_set_lease: Duration::from_millis(crate::views::VIEW_SET_LEASE_MILLIS),
            view_set_reaper_interval: Duration::from_millis(VIEW_SET_REAPER_INTERVAL_MILLIS),
            peer_budget_max_open_files_for_testing: None,
            storage_write_delay_for_testing: Duration::ZERO,
            storage_hash_delay_for_testing: Duration::ZERO,
            storage_write_concurrency_for_testing: 4,
            storage_hash_concurrency_for_testing: 4,
            checkpoint_sync_delay_for_testing: Duration::ZERO,
            checkpoint_commit_delay_for_testing: Duration::ZERO,
            checkpoint_stage_trace_for_testing: false,
            platform_storage_client: None,
            product_state: None,
        }
    }

    pub fn durable_profile_root(&self) -> Option<&Path> {
        self.persistence.durable_profile_root()
    }

    pub fn with_fresh_profile_defaults(mut self) -> Self {
        self.initial_client_settings = match self.network.policy {
            NetworkPolicy::Online => crate::ClientSettings::fresh_profile_default(),
            NetworkPolicy::LoopbackOnly => crate::ClientSettings {
                listener: crate::ListenerPolicy::AutomaticLoopback,
                ..crate::ClientSettings::default()
            },
            NetworkPolicy::Offline => crate::ClientSettings::default(),
        };
        self
    }

    pub fn with_path_root_startup_policy(mut self, policy: PathRootStartupPolicy) -> Self {
        self.path_root_startup_policy = policy;
        self
    }

    pub fn with_path_part_directory(mut self, directory: PathBuf) -> Self {
        self.path_part_directory = Some(directory);
        self
    }

    pub const fn with_initial_network_prerequisite(
        mut self,
        prerequisite: ApplicationNetworkPrerequisite,
    ) -> Self {
        self.initial_network_prerequisite = prerequisite;
        self
    }
}

#[derive(Debug)]
enum ApplicationTaskReport {
    Metadata,
    Download,
}

enum ResumableDownloadConfig {
    Magnet(ResumableMagnetDownloadConfig),
    Metainfo(ResumableMetainfoDownloadConfig),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformRemovalPath {
    pub components: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformRemovalPlan {
    pub operation_id: String,
    pub torrent_id: String,
    pub storage_root: String,
    pub name: String,
    pub tree: bool,
    pub files: Vec<PlatformRemovalPath>,
    pub directories: Vec<PlatformRemovalPath>,
}

/// Result of stopping use of a platform storage root.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformStorageDetach {
    /// The catalog row was deleted because no torrent referenced it.
    pub removed: bool,
    /// Torrents bound to the root, now awaiting storage.
    pub affected_torrent_ids: Vec<String>,
    pub default_root: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformFilePlan {
    pub torrent_id: String,
    pub storage_root: String,
    pub components: Vec<String>,
    pub length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompletedMediaCapability {
    pub token: String,
    pub length: u64,
}

#[derive(Debug)]
pub struct ApplicationService {
    reset_config: ApplicationConfig,
    reset_incomplete: bool,
    store: Arc<Mutex<SessionStore>>,
    storage_roots: Arc<BTreeMap<String, StorageRootLocation>>,
    network: NetworkConfig,
    network_prerequisite: NetworkPrerequisiteHandle,
    effective_network_prerequisite: NetworkPrerequisiteSnapshot,
    session_network_config: SessionNetworkConfig,
    download_resource_limits: DownloadResourceLimits,
    session_download_resources: SessionDownloadResources,
    active_download_cap: Option<u16>,
    storage_write_delay_for_testing: Duration,
    storage_hash_delay_for_testing: Duration,
    storage_write_concurrency_for_testing: usize,
    storage_hash_concurrency_for_testing: usize,
    checkpoint_sync_delay_for_testing: Duration,
    checkpoint_commit_delay_for_testing: Duration,
    checkpoint_stage_trace_for_testing: bool,
    storage_file_pool: StorageFilePool,
    path_part_directory: Option<PathBuf>,
    media: MediaCapabilities,
    healthy_platform_roots: BTreeSet<String>,
    session_network: Option<SessionNetworkRuntime>,
    torrent_runtimes: BTreeMap<String, TorrentRuntime>,
    next_torrent_generation: u64,
    speed_recorder: Arc<SessionSpeedRecorder>,
    speed_history: Option<SpeedHistoryRuntime>,
    eta_runtime: Option<TorrentEtaRuntime>,
    views: ViewHub,
    view_set_reaper: Option<ViewSetLeaseReaper>,
    admission_wake: Arc<Notify>,
    admission_started_at: Instant,
    admission_inactivity: BTreeMap<String, AdmissionInactivityState>,
    admitted_seeds: BTreeSet<String>,
    accounting_wake: Arc<Notify>,
    accounting: TorrentAccountingOwner,
    discovery_wake: Arc<Notify>,
    maintenance_cancellation: CancellationToken,
    maintenance_started: bool,
    maintenance_task: Option<JoinHandle<()>>,
    product_milestone_drain: Option<ProductMilestoneDrain>,
}

#[derive(Debug)]
struct ProductMilestoneDrain {
    wake: Arc<Notify>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct ProductMilestoneDrainOutcome {
    applied: usize,
    dropped: u64,
}

impl ProductMilestoneDrain {
    fn start(
        store: Arc<Mutex<SessionStore>>,
        product_state: ProductStateOwner,
        views: ViewHub,
    ) -> Self {
        let wake = Arc::new(Notify::new());
        let cancellation = CancellationToken::new();
        let task_wake = wake.clone();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            let mut reported_drops = 0_u64;
            loop {
                let stopping = tokio::select! {
                    _ = task_cancellation.cancelled() => true,
                    _ = task_wake.notified() => false,
                };
                let drain_store = store.clone();
                let drain_product_state = product_state.clone();
                match tokio::task::spawn_blocking(move || {
                    drain_product_milestones(&drain_store, &drain_product_state)
                })
                .await
                {
                    Ok(Ok(outcome)) => {
                        if outcome.applied > 0 {
                            let applied = outcome.applied.to_string();
                            let _ = views.record_diagnostic(
                                DiagnosticSeverity::Debug,
                                category::LIFECYCLE_SESSION,
                                "product_milestones_applied",
                                None,
                                "Durable product milestones were applied and acknowledged",
                                &[("applied", &applied)],
                            );
                        }
                        if outcome.dropped > reported_drops {
                            let dropped = outcome.dropped.to_string();
                            let _ = views.record_diagnostic(
                                DiagnosticSeverity::Warning,
                                category::LIFECYCLE_SESSION,
                                "product_milestone_dropped",
                                None,
                                "Product milestone outbox dropped derived counter work at its bound",
                                &[("dropped", &dropped)],
                            );
                            reported_drops = outcome.dropped;
                        }
                    }
                    Ok(Err(detail)) => {
                        let _ = views.record_diagnostic(
                            DiagnosticSeverity::Warning,
                            category::LIFECYCLE_SESSION,
                            "product_milestone_drain_failed",
                            None,
                            "Product milestone drain is degraded; torrent state remains authoritative",
                            &[("detail", &detail)],
                        );
                    }
                    Err(error) => {
                        let detail = error.to_string();
                        let _ = views.record_diagnostic(
                            DiagnosticSeverity::Warning,
                            category::LIFECYCLE_SESSION,
                            "product_milestone_drain_join_failed",
                            None,
                            "Product milestone drain worker failed; torrent state remains authoritative",
                            &[("detail", &detail)],
                        );
                    }
                }
                if stopping {
                    break;
                }
            }
        });
        let drain = Self {
            wake,
            cancellation,
            task: Some(task),
        };
        drain.notify();
        drain
    }

    fn notify(&self) {
        self.wake.notify_one();
    }

    async fn shutdown(&mut self) -> Result<(), String> {
        self.cancellation.cancel();
        self.wake.notify_waiters();
        match self.task.take() {
            Some(task) => task.await.map_err(|error| error.to_string()),
            None => Ok(()),
        }
    }
}

impl Drop for ProductMilestoneDrain {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.wake.notify_waiters();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

fn drain_product_milestones(
    store: &Arc<Mutex<SessionStore>>,
    product_state: &ProductStateOwner,
) -> Result<ProductMilestoneDrainOutcome, String> {
    let (milestones, dropped) = {
        let store = store
            .lock()
            .map_err(|_| "session store lock is poisoned".to_owned())?;
        (
            store
                .pending_product_milestones()
                .map_err(|error| error.to_string())?,
            store
                .dropped_product_milestone_count()
                .map_err(|error| error.to_string())?,
        )
    };
    let Some(last) = milestones.last() else {
        return Ok(ProductMilestoneDrainOutcome {
            applied: 0,
            dropped,
        });
    };
    product_state
        .apply_milestones(&milestones)
        .map_err(|error| error.to_string())?;
    let mut store = store
        .lock()
        .map_err(|_| "session store lock is poisoned".to_owned())?;
    store
        .acknowledge_product_milestones(last.source_epoch, last.sequence)
        .map_err(|error| error.to_string())?;
    Ok(ProductMilestoneDrainOutcome {
        applied: milestones.len(),
        dropped,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MaintenanceAction {
    Admission,
    Discovery,
    Accounting,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct AdmissionInactivityState {
    generation: u64,
    selected_finished: bool,
    state: InactivityState,
}

impl ApplicationService {
    pub async fn open(config: ApplicationConfig) -> Result<Self, ApplicationError> {
        let reset_config = config.clone();
        if config.network.peer_connect_timeout.is_zero() {
            return Err(ApplicationError::Configuration(
                "peer connect timeout must be nonzero".to_owned(),
            ));
        }
        if config.network.utp_fallback_timeout.is_zero() {
            return Err(ApplicationError::Configuration(
                "uTP fallback timeout must be nonzero".to_owned(),
            ));
        }
        if config.network.outgoing_handshake_timeout.is_zero() {
            return Err(ApplicationError::Configuration(
                "outgoing handshake timeout must be nonzero".to_owned(),
            ));
        }
        if config.network.peer_io_timeout.is_zero() {
            return Err(ApplicationError::Configuration(
                "peer I/O timeout must be nonzero".to_owned(),
            ));
        }
        let network = if config.network.peer_id == DEFAULT_PEER_ID {
            config.network.with_peer_id(allocate_application_peer_id()?)
        } else {
            config.network
        };
        let network_prerequisite =
            NetworkPrerequisiteHandle::new(config.initial_network_prerequisite);
        if config.view_set_lease.is_zero()
            || config.view_set_reaper_interval.is_zero()
            || config.view_set_reaper_interval > config.view_set_lease
        {
            return Err(ApplicationError::Configuration(
                "view-set lease timing must be nonzero and the reaper interval cannot exceed the lease"
                    .to_owned(),
            ));
        }
        if config.storage_write_delay_for_testing > Duration::from_secs(10)
            || config.storage_hash_delay_for_testing > Duration::from_secs(10)
            || config.checkpoint_sync_delay_for_testing > Duration::from_secs(60)
            || config.checkpoint_commit_delay_for_testing > Duration::from_secs(60)
        {
            return Err(ApplicationError::Configuration(
                "test storage delay exceeds its fixed maximum".to_owned(),
            ));
        }
        if !(1..=8).contains(&config.storage_write_concurrency_for_testing)
            || !(1..=8).contains(&config.storage_hash_concurrency_for_testing)
        {
            return Err(ApplicationError::Configuration(
                "test storage concurrency must be between 1 and 8".to_owned(),
            ));
        }
        if config
            .path_part_directory
            .as_ref()
            .is_some_and(|directory| !directory.is_absolute())
        {
            return Err(ApplicationError::Configuration(
                "path part directory must be absolute".to_owned(),
            ));
        }
        let mut configured_root_ids = BTreeMap::new();
        for root in &config.storage_roots {
            if configured_root_ids
                .insert(root.id.clone(), root.location.clone())
                .is_some()
            {
                return Err(ApplicationError::Configuration(format!(
                    "storage root {} is duplicated",
                    root.id
                )));
            }
            if config.path_root_startup_policy == PathRootStartupPolicy::CreateMissing
                && let StorageRootLocation::Path(path) = &root.location
            {
                std::fs::create_dir_all(path).map_err(|source| ApplicationError::Io {
                    operation: "create configured storage root",
                    source,
                })?;
            }
        }
        let store = match &config.persistence {
            ApplicationPersistence::Durable { profile_root } => {
                SessionStore::open_with_initial_client_settings(
                    profile_root,
                    &config.profile_id,
                    &config.storage_roots,
                    &config.initial_client_settings,
                )?
            }
            ApplicationPersistence::Ephemeral => {
                SessionStore::open_ephemeral_with_initial_client_settings(
                    &config.profile_id,
                    &config.storage_roots,
                    &config.initial_client_settings,
                )?
            }
        };
        let profile_reset_report = store.pending_profile_reset_report()?;
        let mut snapshot = store.snapshot()?;
        let active_client_settings = snapshot.client_settings.clone();
        let stored_storage_roots = store.storage_roots()?;
        let healthy_platform_roots = BTreeSet::new();
        let storage_roots = available_storage_roots(stored_storage_roots, &healthy_platform_roots);
        apply_runtime_storage_availability(&mut snapshot, &storage_roots);
        let (initial_dht_snapshot, dht_state_warning) = match store.load_dht_snapshot() {
            Ok(snapshot) => (snapshot, None),
            Err(error) => (None, Some(error.to_string())),
        };
        let speed = match &config.persistence {
            ApplicationPersistence::Durable { profile_root } => {
                PreparedSpeedHistory::open_durable(profile_root)
            }
            ApplicationPersistence::Ephemeral => PreparedSpeedHistory::open_ephemeral()
                .map_err(|error| ApplicationError::Persistence(error.to_string()))?,
        };
        let speed_recorder = speed.recorder.clone();
        let admission_wake = Arc::new(Notify::new());
        let accounting_wake = Arc::new(Notify::new());
        let accounting = TorrentAccountingOwner::new(accounting_wake.clone());
        let discovery_wake = Arc::new(Notify::new());
        let storage_file_pool =
            StorageFilePool::new(config.storage_file_limit, config.platform_storage_client)
                .map_err(|error| ApplicationError::Configuration(error.to_owned()))?;
        storage_file_pool.set_platform_health_wake(admission_wake.clone());
        let initial_network_prerequisite = network_prerequisite.load();
        let session_network_config = SessionNetworkConfig {
            settings: active_client_settings.clone(),
            network,
            network_cancellation: network_prerequisite
                .cancellation_token(initial_network_prerequisite),
            dht: config.dht,
            initial_dht_snapshot,
            byte_metric_sink: speed_recorder.clone(),
            upload_read_jobs: config.upload_read_jobs,
            incoming_handshake_timeout: config.incoming_handshake_timeout,
            incoming_peer_activity_timeout: config.incoming_peer_activity_timeout,
            incoming_keepalive_interval: config.incoming_keepalive_interval,
            incoming_no_request_timeout: config.incoming_no_request_timeout,
            incoming_inactivity_timeout: config.incoming_inactivity_timeout,
            peer_budget_max_open_files_for_testing: config.peer_budget_max_open_files_for_testing,
            peer_transport_policy: config.peer_transport_policy,
        };
        let mut session_network = if initial_network_prerequisite.is_allowed() {
            Some(SessionNetworkRuntime::start(session_network_config.clone()).await?)
        } else {
            None
        };
        let initial_dht_view = session_network.as_ref().map_or_else(
            || DhtInspectionView::suspended(network.policy),
            SessionNetworkRuntime::initial_dht_view,
        );
        let initial_settings_view = session_network.as_ref().map_or_else(
            || crate::ClientSettingsRuntimeView::from_configured(active_client_settings.clone()),
            SessionNetworkRuntime::initial_settings_view,
        );
        let views = ViewHub::new_with_runtime_views(
            &snapshot,
            config.view_set_lease,
            speed.history.clone(),
            initial_dht_view,
            initial_settings_view,
        )?;
        let initial_network_state = if initial_network_prerequisite.is_allowed() {
            crate::ApplicationNetworkRuntimeState::Allowed
        } else {
            crate::ApplicationNetworkRuntimeState::Blocked
        };
        views.set_application_network_runtime(application_network_runtime_view(
            initial_network_prerequisite,
            initial_network_prerequisite,
            initial_network_state,
            None,
        ))?;
        views.set_waiting_for_unmetered_network(!initial_network_prerequisite.is_allowed())?;
        if let Some(session_network) = session_network.as_mut() {
            session_network.attach_views(views.clone());
        }
        let eta_runtime = TorrentEtaRuntime::start(views.clone());
        let speed_history = speed.start(views.clone());
        let view_set_reaper =
            ViewSetLeaseReaper::start(views.clone(), config.view_set_reaper_interval);
        let session_download_resources = SessionDownloadResources::new(
            config.download_resource_limits,
            config.storage_write_concurrency_for_testing,
            config.storage_hash_concurrency_for_testing,
        );
        let mut torrent_runtimes = BTreeMap::new();
        let mut next_torrent_generation = 1_u64;
        if let Some(session_network) = session_network.as_ref() {
            let advertised_endpoint = session_network.advertised_endpoint();
            for torrent in &snapshot.torrents {
                let generation = next_torrent_generation;
                next_torrent_generation =
                    next_torrent_generation.checked_add(1).ok_or_else(|| {
                        ApplicationError::Configuration(
                            "torrent runtime generation overflow".to_owned(),
                        )
                    })?;
                let (torrent_id, info_hashes) = store.load_identities(&torrent.torrent_id)?;
                let durable_accounting = store.load_accounting(&torrent_id)?;
                accounting
                    .register(torrent_id, generation, durable_accounting)
                    .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
                let runtime = TorrentRuntime::new(
                    runtime_identity(torrent_id, info_hashes)?,
                    generation,
                    views.clone(),
                    advertised_endpoint.clone(),
                    session_network
                        .register_torrent_bandwidth(torrent.transfer_limits.into_engine())
                        .map_err(|error| ApplicationError::Configuration(error.to_string()))?,
                    accounting.clone(),
                )
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
                torrent_runtimes.insert(torrent.torrent_id.clone(), runtime);
            }
        }
        let store = Arc::new(Mutex::new(store));
        let product_milestone_drain = config
            .product_state
            .clone()
            .map(|owner| ProductMilestoneDrain::start(store.clone(), owner, views.clone()));
        let mut service = Self {
            reset_config,
            reset_incomplete: false,
            store,
            storage_roots: Arc::new(storage_roots),
            network,
            network_prerequisite,
            effective_network_prerequisite: initial_network_prerequisite,
            session_network_config,
            download_resource_limits: config.download_resource_limits,
            session_download_resources,
            active_download_cap: config.active_download_cap,
            storage_write_delay_for_testing: config.storage_write_delay_for_testing,
            storage_hash_delay_for_testing: config.storage_hash_delay_for_testing,
            storage_write_concurrency_for_testing: config.storage_write_concurrency_for_testing,
            storage_hash_concurrency_for_testing: config.storage_hash_concurrency_for_testing,
            checkpoint_sync_delay_for_testing: config.checkpoint_sync_delay_for_testing,
            checkpoint_commit_delay_for_testing: config.checkpoint_commit_delay_for_testing,
            checkpoint_stage_trace_for_testing: config.checkpoint_stage_trace_for_testing,
            storage_file_pool,
            path_part_directory: config.path_part_directory,
            media: MediaCapabilities::new(),
            healthy_platform_roots,
            session_network,
            torrent_runtimes,
            next_torrent_generation,
            speed_recorder,
            speed_history: Some(speed_history),
            eta_runtime: Some(eta_runtime),
            views,
            view_set_reaper: Some(view_set_reaper),
            admission_wake,
            admission_started_at: Instant::now(),
            admission_inactivity: BTreeMap::new(),
            admitted_seeds: BTreeSet::new(),
            accounting_wake,
            accounting,
            discovery_wake,
            maintenance_cancellation: CancellationToken::new(),
            maintenance_started: false,
            maintenance_task: None,
            product_milestone_drain,
        };
        service.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_SESSION,
            "application_opened",
            None,
            "Application profile opened",
            &[
                ("profile", &config.profile_id),
                ("network_policy", network.policy.as_str()),
                ("persistence_mode", config.persistence.diagnostic_name()),
            ],
        )?;
        if let Some(report) = profile_reset_report {
            let previous_schema_version = report.previous_schema_version.to_string();
            let discarded_categories = report.discarded_categories.join(",");
            let database_basenames = report.database_basenames_considered.join(",");
            let external_payload_modified = report.external_payload_modified.to_string();
            service.views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::LIFECYCLE_SESSION,
                "profile_catalog_reset",
                None,
                "Disposable incubation session catalog was reset to the current format epoch",
                &[
                    ("previous_schema", &previous_schema_version),
                    ("discarded", &discarded_categories),
                    ("database_files", &database_basenames),
                    ("external_payload_modified", &external_payload_modified),
                ],
            )?;
            service.store_mut()?.acknowledge_profile_reset_report()?;
        }
        if let Some(detail) = dht_state_warning {
            service.views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::DISCOVERY_DHT,
                "dht_state_rejected",
                None,
                "Saved DHT state was rejected; using cold bootstrap",
                &[("detail", &detail)],
            )?;
        }
        service.refresh_views()?;
        service.restore_removals().await?;
        if initial_network_prerequisite.is_allowed() {
            service.restore_running().await?;
            service.reconcile_incoming_catalog().await?;
            // Completed-seed structural validation may discover one torrent that
            // needs the existing checker. Admit that durable generation before
            // returning the restored session.
            service.reconcile_admission().await?;
            service.reconcile_discovery_catalog().await?;
        }
        service.refresh_views()?;
        if let Some(session_network) = service.session_network.as_mut() {
            session_network.start_reachability(service.views.clone());
        }
        Ok(service)
    }

    fn session_network(&self) -> &SessionNetworkRuntime {
        self.session_network
            .as_ref()
            .expect("session network exists before application shutdown")
    }

    #[must_use]
    pub fn network_prerequisite_handle(&self) -> NetworkPrerequisiteHandle {
        self.network_prerequisite.clone()
    }

    #[must_use]
    pub fn network_prerequisite_snapshot(&self) -> NetworkPrerequisiteSnapshot {
        self.network_prerequisite.load()
    }

    #[must_use]
    pub const fn effective_network_prerequisite(&self) -> NetworkPrerequisiteSnapshot {
        self.effective_network_prerequisite
    }

    /// Converges the long-lived network owners to the newest atomic
    /// application prerequisite generation. Durable torrent intent is not
    /// changed while network ownership is suspended.
    pub async fn reconcile_network_prerequisite(&mut self) -> Result<(), ApplicationError> {
        loop {
            let requested = self.network_prerequisite.load();
            let converged = requested == self.effective_network_prerequisite
                && requested.is_allowed() == self.session_network.is_some();
            if !converged {
                let transition_state = if requested.is_allowed() {
                    crate::ApplicationNetworkRuntimeState::Starting
                } else {
                    crate::ApplicationNetworkRuntimeState::Blocking
                };
                self.views
                    .set_application_network_runtime(application_network_runtime_view(
                        requested,
                        self.effective_network_prerequisite,
                        transition_state,
                        None,
                    ))?;
                self.views
                    .set_waiting_for_unmetered_network(!requested.is_allowed())?;
                let result = if requested.is_allowed() {
                    self.start_network_generation(requested).await
                } else {
                    self.stop_network_generation(requested).await
                };
                if let Err(error) = result {
                    self.views.set_application_network_runtime(
                        application_network_runtime_view(
                            requested,
                            self.effective_network_prerequisite,
                            crate::ApplicationNetworkRuntimeState::Degraded,
                            Some(error.to_string()),
                        ),
                    )?;
                    return Err(error);
                }
            }
            if self.network_prerequisite.load() == requested {
                return Ok(());
            }
        }
    }

    async fn stop_network_generation(
        &mut self,
        requested: NetworkPrerequisiteSnapshot,
    ) -> Result<(), ApplicationError> {
        if let Some(session_network) = self.session_network.as_mut() {
            session_network.begin_shutdown();
        }
        let active_ids = self.active_download_ids();
        for torrent_id in &active_ids {
            if let Some(active) = self.active_download_for(torrent_id) {
                active.control.cancel();
            }
        }

        let terminal = match self.session_network.take() {
            Some(session_network) => Some(
                session_network
                    .shutdown_for_network_prerequisite(&self.views)
                    .await,
            ),
            None => None,
        };
        let mut convergence_error = None;
        for torrent_id in active_ids {
            let Some(active) = self.take_active_download(&torrent_id) else {
                continue;
            };
            let eta_generation = active.eta_generation;
            match active.task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) if convergence_error.is_none() => convergence_error = Some(error),
                Err(error) if error.is_cancelled() => {}
                Err(error) if convergence_error.is_none() => {
                    convergence_error = Some(error.to_string());
                }
                Ok(Err(_)) | Err(_) => {}
            }
            active.control.release_session_resources();
            if let Err(error) = self
                .views
                .deactivate_eta_generation(&torrent_id, eta_generation)
                && convergence_error.is_none()
            {
                convergence_error = Some(format!("torrent ETA deactivation: {error}"));
            }
        }
        for runtime in self.torrent_runtimes.values_mut() {
            if let Err(error) = runtime.handle().forget_seed_registration()
                && convergence_error.is_none()
            {
                convergence_error = Some(format!("torrent seed registration: {error}"));
            }
            if let Err(error) = runtime.publish_inactive()
                && convergence_error.is_none()
            {
                convergence_error = Some(format!("torrent peer state: {error}"));
            }
            runtime.deactivate_peer_events();
        }
        self.torrent_runtimes.clear();

        if let Some(terminal) = terminal {
            if let Some(snapshot) = terminal.dht_snapshot {
                self.session_network_config.initial_dht_snapshot = Some(snapshot.clone());
                self.store_mut()?.save_dht_snapshot(snapshot)?;
            }
            if let Some(error) = terminal.dht_error {
                convergence_error.get_or_insert_with(|| error.to_string());
            }
            if let Some(error) = terminal.join_error {
                convergence_error.get_or_insert(error);
            }
        }
        let settings = self.store_mut()?.snapshot()?.client_settings;
        self.session_network_config.settings = settings.clone();
        self.views.replace_network_runtime_views(
            DhtInspectionView::suspended(self.network.policy),
            crate::ClientSettingsRuntimeView::from_configured(settings),
        )?;
        self.effective_network_prerequisite = requested;
        self.views
            .set_application_network_runtime(application_network_runtime_view(
                requested,
                requested,
                crate::ApplicationNetworkRuntimeState::Blocked,
                None,
            ))?;
        self.refresh_views()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_SESSION,
            "application_network_prerequisite_blocked",
            None,
            "Application network owners stopped for the live prerequisite",
            &[("generation", &requested.generation.to_string())],
        )?;
        if let Some(error) = convergence_error {
            return Err(ApplicationError::Join(error));
        }
        Ok(())
    }

    async fn start_network_generation(
        &mut self,
        requested: NetworkPrerequisiteSnapshot,
    ) -> Result<(), ApplicationError> {
        if self.session_network.is_some() {
            self.effective_network_prerequisite = requested;
            return Ok(());
        }
        let snapshot = self.store_mut()?.snapshot()?;
        self.session_network_config.settings = snapshot.client_settings.clone();
        let mut candidate_config = self.session_network_config.clone();
        candidate_config.network_cancellation =
            self.network_prerequisite.cancellation_token(requested);
        let mut candidate = SessionNetworkRuntime::start(candidate_config).await?;
        if self.network_prerequisite.load() != requested {
            let terminal = candidate
                .shutdown_for_network_prerequisite(&self.views)
                .await;
            if let Some(snapshot) = terminal.dht_snapshot {
                self.session_network_config.initial_dht_snapshot = Some(snapshot);
            }
            if let Some(error) = terminal.dht_error {
                return Err(error.into());
            }
            if let Some(error) = terminal.join_error {
                return Err(ApplicationError::Join(error));
            }
            return Ok(());
        }

        self.views.replace_network_runtime_views(
            candidate.initial_dht_view(),
            candidate.initial_settings_view(),
        )?;
        candidate.attach_views(self.views.clone());
        candidate.start_reachability(self.views.clone());
        self.session_network = Some(candidate);
        self.effective_network_prerequisite = requested;
        self.views
            .set_application_network_runtime(application_network_runtime_view(
                requested,
                requested,
                crate::ApplicationNetworkRuntimeState::Allowed,
                None,
            ))?;

        for torrent in snapshot.torrents {
            self.ensure_torrent_runtime(&torrent.torrent_id)?
                .peers()
                .set_transfer_rate_limits(torrent.transfer_limits.into_engine());
        }
        self.restore_running().await?;
        self.reconcile_incoming_catalog().await?;
        self.reconcile_discovery_catalog().await?;
        self.refresh_views()?;
        self.admission_wake.notify_waiters();
        self.discovery_wake.notify_waiters();
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_SESSION,
            "application_network_prerequisite_allowed",
            None,
            "Application network owners restarted for the live prerequisite",
            &[("generation", &requested.generation.to_string())],
        )?;
        Ok(())
    }

    pub fn configure_media_origin(&mut self, origin: &str) -> Result<(), MediaOriginError> {
        self.media.set_origin(origin)
    }

    pub fn configure_media_origin_for_local_http_host(
        &mut self,
        origin: &str,
        exact_host: &str,
    ) -> Result<(), MediaOriginError> {
        self.media
            .set_origin_for_local_http_host(origin, exact_host)
    }

    pub fn configure_media_origin_for_private_lan_http(
        &mut self,
        origin: &str,
        exact_socket: std::net::SocketAddr,
    ) -> Result<(), MediaOriginError> {
        self.media
            .set_origin_for_private_lan_http(origin, exact_socket)
    }

    pub fn resolve_media_capability(
        &mut self,
        capability: &str,
    ) -> Result<crate::MediaCapabilityLease, MediaResolveError> {
        self.media.resolve(capability)
    }

    pub fn media_resource_snapshot(&self) -> crate::MediaResourceSnapshot {
        self.media.resource_snapshot()
    }

    pub async fn create_media_url(
        &mut self,
        torrent_id: &str,
        file_index: u32,
    ) -> Result<MediaUrlResponse, ApplicationError> {
        let torrent_id = torrent_id.to_ascii_lowercase();
        if torrent_id.parse::<TorrentId>().is_err() {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::MetadataUnavailable,
            ));
        }
        let (resume, removing) = {
            let store = self.store_mut()?;
            let resume = match store.load_resume(&torrent_id) {
                Ok(resume) => resume,
                Err(StoreError::UnknownTorrent(_)) | Err(StoreError::Have(_)) => {
                    return Ok(MediaUrlResponse::unavailable(
                        torrent_id,
                        file_index,
                        MediaFileAvailability::MetadataUnavailable,
                    ));
                }
                Err(error) => return Err(error.into()),
            };
            let removing =
                store.snapshot()?.torrents.iter().any(|torrent| {
                    torrent.torrent_id == torrent_id && torrent.removal_state.is_some()
                });
            (resume, removing)
        };
        if removing {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Removing,
            ));
        }
        if resume.verification.is_pending() || resume.state == TorrentState::Checking {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Checking,
            ));
        }
        if resume.raw_info.is_none() {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::MetadataUnavailable,
            ));
        }
        let content = match parse_resume_content(&resume) {
            Ok(content) => content,
            Err(_) => {
                return Ok(MediaUrlResponse::unavailable(
                    torrent_id,
                    file_index,
                    MediaFileAvailability::MetadataUnavailable,
                ));
            }
        };
        let file_index_usize = usize::try_from(file_index).map_err(|_| {
            ApplicationError::Configuration("media file index overflows usize".to_owned())
        })?;
        let layout = ContentLayout::from_content(&content);
        let Some(file) = layout.files().get(file_index_usize) else {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::InvalidFile,
            ));
        };
        if file.padding {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Padding,
            ));
        }
        if file.length == 0 && self.active_download_for(&torrent_id).is_some() {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Unverified,
            ));
        }
        if let Some(active) = self.active_download_for(&torrent_id) {
            let control = active.control.clone();
            let reader = match control.active_file_reader(file_index_usize) {
                Ok(reader) => reader,
                Err(error) => {
                    return Ok(MediaUrlResponse::unavailable(
                        torrent_id,
                        file_index,
                        active_media_reader_unavailable_reason(&error),
                    ));
                }
            };
            let Some(storage_root) = self.storage_roots.get(&resume.storage_root) else {
                return Ok(MediaUrlResponse::unavailable(
                    torrent_id,
                    file_index,
                    MediaFileAvailability::StorageUnavailable,
                ));
            };
            let verified = match storage_root {
                StorageRootLocation::Path(root) => Some(VerifiedMediaSource::path(
                    root.clone(),
                    content.clone(),
                    file_index_usize,
                    self.storage_file_pool.clone(),
                    resume.torrent_id,
                    self.media.read_jobs(),
                )),
                StorageRootLocation::PlatformCapability => Some(VerifiedMediaSource::platform(
                    PlatformStorageSpec {
                        pool: self.storage_file_pool.clone(),
                        root_id: resume.storage_root.clone(),
                        storage_id: torrent_id.clone(),
                        content_shape: ContentShape::from_content(&content),
                        content_name: content.name().to_owned(),
                        storage_generation: 1,
                    },
                    content.clone(),
                    file_index_usize,
                    self.media.read_jobs(),
                )),
            };
            let outcome = match self.media.create_active(
                torrent_id.clone(),
                file_index,
                reader,
                control,
                verified,
            ) {
                Ok(outcome) => outcome,
                Err(MediaRegistryError::ServerUnavailable) => {
                    return Ok(MediaUrlResponse::unavailable(
                        torrent_id,
                        file_index,
                        MediaFileAvailability::ServerUnavailable,
                    ));
                }
                Err(MediaRegistryError::ResourceLimit) => {
                    return Ok(MediaUrlResponse::unavailable(
                        torrent_id,
                        file_index,
                        MediaFileAvailability::ResourceLimit,
                    ));
                }
                Err(MediaRegistryError::Random(error)) => {
                    return Err(ApplicationError::Configuration(format!(
                        "allocate media capability: {error}"
                    )));
                }
            };
            return Ok(MediaUrlResponse {
                torrent_id,
                file_index,
                outcome,
            });
        }
        if matches!(
            resume.state,
            TorrentState::NeedsRepair | TorrentState::Error
        ) {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Incomplete,
            ));
        }
        let Some(have) = resume.have.as_ref() else {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::Unverified,
            ));
        };
        let Some(storage_root) = self.storage_roots.get(&resume.storage_root) else {
            return Ok(MediaUrlResponse::unavailable(
                torrent_id,
                file_index,
                MediaFileAvailability::StorageUnavailable,
            ));
        };
        let read_jobs = self.media.read_jobs();
        let reader = match storage_root {
            StorageRootLocation::Path(root) => {
                VerifiedFileReader::open_verified_content_with_pool(
                    root,
                    &content,
                    have.pieces(),
                    file_index_usize,
                    self.storage_file_pool.clone(),
                    resume.torrent_id,
                    read_jobs,
                )
                .await
            }
            StorageRootLocation::PlatformCapability => {
                VerifiedFileReader::open_verified_content_with_platform(
                    &PlatformStorageSpec {
                        pool: self.storage_file_pool.clone(),
                        root_id: resume.storage_root,
                        storage_id: torrent_id.clone(),
                        content_shape: ContentShape::from_content(&content),
                        content_name: content.name().to_owned(),
                        storage_generation: 1,
                    },
                    &content,
                    have.pieces(),
                    file_index_usize,
                    read_jobs,
                )
                .await
            }
        };
        let reader = match reader {
            Ok(reader) => reader,
            Err(error) => {
                return Ok(MediaUrlResponse::unavailable(
                    torrent_id,
                    file_index,
                    media_reader_unavailable_reason(&error),
                ));
            }
        };
        let outcome = match self.media.create(torrent_id.clone(), file_index, reader) {
            Ok(outcome) => outcome,
            Err(MediaRegistryError::ServerUnavailable) => {
                return Ok(MediaUrlResponse::unavailable(
                    torrent_id,
                    file_index,
                    MediaFileAvailability::ServerUnavailable,
                ));
            }
            Err(MediaRegistryError::ResourceLimit) => {
                return Ok(MediaUrlResponse::unavailable(
                    torrent_id,
                    file_index,
                    MediaFileAvailability::ResourceLimit,
                ));
            }
            Err(MediaRegistryError::Random(error)) => {
                return Err(ApplicationError::Configuration(format!(
                    "allocate media capability: {error}"
                )));
            }
        };
        Ok(MediaUrlResponse {
            torrent_id,
            file_index,
            outcome,
        })
    }

    #[cfg(test)]
    fn active_download(&self) -> Option<(&str, &ActiveDownload)> {
        self.torrent_runtimes
            .iter()
            .find_map(|(torrent_id, runtime)| {
                runtime
                    .active_download()
                    .map(|active| (torrent_id.as_str(), active))
            })
    }

    fn active_download_for(&self, torrent_id: &str) -> Option<&ActiveDownload> {
        self.torrent_runtimes
            .get(torrent_id)
            .and_then(TorrentRuntime::active_download)
    }

    fn active_download_ids(&self) -> Vec<String> {
        self.torrent_runtimes
            .iter()
            .filter(|(_, runtime)| runtime.active_download().is_some())
            .map(|(torrent_id, _)| torrent_id.clone())
            .collect()
    }

    fn ensure_torrent_runtime(
        &mut self,
        torrent_id: &str,
    ) -> Result<&mut TorrentRuntime, ApplicationError> {
        if !self.torrent_runtimes.contains_key(torrent_id) {
            let generation = self.next_torrent_generation;
            self.next_torrent_generation =
                self.next_torrent_generation.checked_add(1).ok_or_else(|| {
                    ApplicationError::Configuration(
                        "torrent runtime generation overflow".to_owned(),
                    )
                })?;
            let (owner, info_hashes) = self.store_mut()?.load_identities(torrent_id)?;
            let durable_accounting = self.store_mut()?.load_accounting(&owner)?;
            self.accounting
                .register(owner, generation, durable_accounting)
                .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
            let runtime = TorrentRuntime::new(
                runtime_identity(owner, info_hashes)?,
                generation,
                self.views.clone(),
                self.session_network().advertised_endpoint(),
                self.session_network()
                    .register_torrent_bandwidth(TorrentTransferLimits::default().into_engine())
                    .map_err(|error| ApplicationError::Configuration(error.to_string()))?,
                self.accounting.clone(),
            )
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
            self.torrent_runtimes.insert(torrent_id.to_owned(), runtime);
        }
        Ok(self
            .torrent_runtimes
            .get_mut(torrent_id)
            .expect("torrent runtime exists after insertion"))
    }

    fn install_active_download(
        &mut self,
        torrent_id: &str,
        active: ActiveDownload,
    ) -> Result<(), ApplicationError> {
        self.ensure_torrent_runtime(torrent_id)?
            .set_active_download(active);
        Ok(())
    }

    fn take_active_download(&mut self, torrent_id: &str) -> Option<ActiveDownload> {
        self.torrent_runtimes
            .get_mut(torrent_id)
            .and_then(TorrentRuntime::take_active_download)
    }

    pub async fn dispatch(
        &mut self,
        request: RequestEnvelope,
    ) -> Result<ResponseEnvelope, ApplicationError> {
        self.reap_finished().await?;
        if self.reset_incomplete && !matches!(&request.command, Command::ClearAppData) {
            return Ok(ResponseEnvelope::error(
                request.request_id,
                self.store_mut()?.revision()?,
                ErrorCode::InvalidRequest,
                "app data clear is incomplete; retry the clear action".to_owned(),
            ));
        }
        if matches!(&request.command, Command::ClearAppData) {
            if let Err((code, message)) = validate_request(&request) {
                return Ok(ResponseEnvelope::error(
                    request.request_id,
                    self.store_mut()?.revision()?,
                    code,
                    message,
                ));
            }
            let revision = self.store_mut()?.revision()?;
            if request
                .expected_revision
                .as_deref()
                .map(parse_revision)
                .transpose()
                .expect("validated revision")
                .is_some_and(|expected| expected != revision)
            {
                return Ok(ResponseEnvelope::error(
                    request.request_id,
                    revision,
                    ErrorCode::StaleRevision,
                    "app data changed before clear".to_owned(),
                ));
            }
            let snapshot = self.store_mut()?.snapshot()?;
            if !snapshot.torrents.is_empty() {
                return Ok(ResponseEnvelope::error(
                    request.request_id,
                    self.store_mut()?.revision()?,
                    ErrorCode::InvalidTorrentState,
                    "remove every torrent before clearing app data".to_owned(),
                ));
            }
            if self.reset_config.platform_storage_client.is_some() {
                return Ok(ResponseEnvelope::error(
                    request.request_id,
                    self.store_mut()?.revision()?,
                    ErrorCode::InvalidRequest,
                    "platform storage must use its platform-owned clear workflow".to_owned(),
                ));
            }
            self.clear_private_profile().await?;
            let (revision, snapshot) = {
                let store = self.store_mut()?;
                (store.revision()?, store.snapshot()?)
            };
            let mut response = ResponseEnvelope::success(request.request_id, revision, snapshot);
            self.apply_runtime_storage_to_response(&mut response);
            return Ok(response);
        }
        let command = request.command.clone();
        let file_priority_changed = match &command {
            Command::SetFilePriority {
                torrent_id,
                file_indices,
                priority,
            } => self
                .store_mut()?
                .load_resume(&torrent_id.to_ascii_lowercase())
                .map(|resume| {
                    file_indices.iter().any(|file_index| {
                        let current = if resume.skip_files.binary_search(file_index).is_ok() {
                            FilePriority::Skip
                        } else if resume.high_priority_files.binary_search(file_index).is_ok() {
                            FilePriority::High
                        } else {
                            FilePriority::Normal
                        };
                        current != *priority
                    })
                })
                .unwrap_or(true),
            Command::SetFilePriorityRanges { .. } => true,
            Command::DownloadFiles {
                torrent_id,
                file_indices,
            } => self
                .store_mut()?
                .load_resume(&torrent_id.to_ascii_lowercase())
                .map(|resume| {
                    file_indices.iter().any(|file_index| {
                        resume.skip_files.binary_search(file_index).is_ok()
                            || resume.high_priority_files.binary_search(file_index).is_ok()
                    })
                })
                .unwrap_or(true),
            _ => false,
        };
        let download_files_fence = match &command {
            Command::DownloadFiles { torrent_id, .. } if file_priority_changed => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                let active = self.active_download_for(&torrent_id).is_some();
                let state = self
                    .store_mut()?
                    .load_resume(&torrent_id)
                    .ok()
                    .map(|resume| resume.state);
                (active && state == Some(TorrentState::Paused)).then_some(torrent_id)
            }
            _ => None,
        };
        let add_magnet_owner = match &command {
            Command::AddMagnet { magnet, .. } => {
                let target = rstorrent_protocol::magnet::Magnet::parse(magnet)
                    .ok()
                    .map(|magnet| magnet.identity);
                match target {
                    Some(target) => self
                        .store_mut()?
                        .find_owner(target)?
                        .map(|owner| owner.to_string()),
                    None => None,
                }
            }
            _ => None,
        };
        let add_magnet_duplicate = add_magnet_owner.is_some();
        let selected_root = match &command {
            Command::AddMagnet { storage_root, .. } if !add_magnet_duplicate => {
                Some(storage_root.clone())
            }
            Command::SetDefaultStorageRoot { storage_root } => Some(storage_root.clone()),
            Command::ConfirmPendingFileSelection { torrent_id, .. }
            | Command::DownloadAllPendingAdd { torrent_id, .. } => self
                .store_mut()?
                .load_resume(&torrent_id.to_ascii_lowercase())
                .ok()
                .map(|resume| resume.storage_root),
            _ => None,
        };
        if let Some(storage_root) = selected_root.as_deref()
            && !self.storage_roots.contains_key(storage_root)
        {
            let snapshot = self.store_mut()?.snapshot()?;
            let known = snapshot
                .storage
                .roots
                .iter()
                .any(|root| root.root_id == storage_root);
            return Ok(ResponseEnvelope::error(
                request.request_id,
                self.store_mut()?.revision()?,
                if known {
                    ErrorCode::StorageNeedsRepair
                } else {
                    ErrorCode::UnknownStorageRoot
                },
                if known {
                    format!("storage root {storage_root} is unavailable and needs repair")
                } else {
                    format!("storage root {storage_root} is not configured")
                },
            ));
        }
        // Disabling file selection also releases the rest of the add queue in
        // the same transaction; remember it so each release reaches runtime.
        let queued_selection = match &command {
            Command::ConfirmPendingFileSelection {
                torrent_id,
                disable_future: true,
                ..
            }
            | Command::DownloadAllPendingAdd {
                torrent_id,
                disable_future: true,
            } => self
                .store_mut()?
                .snapshot()?
                .torrents
                .into_iter()
                .filter(|torrent| {
                    torrent.awaiting_file_selection
                        && !torrent.torrent_id.eq_ignore_ascii_case(torrent_id)
                })
                .map(|torrent| torrent.torrent_id)
                .collect(),
            _ => Vec::new(),
        };
        let incoming_fence = match &command {
            Command::Pause { torrent_id }
            | Command::ForceRecheck { torrent_id }
            | Command::Archive { torrent_id }
            | Command::RemoveTorrent { torrent_id, .. }
            | Command::CancelPendingAdd { torrent_id } => Some(torrent_id.to_ascii_lowercase()),
            Command::AddMagnet { magnet, .. }
                if rstorrent_protocol::magnet::Magnet::parse(magnet)
                    .is_ok_and(|magnet| magnet.select_only.is_some()) =>
            {
                add_magnet_owner
                    .clone()
                    .filter(|torrent_id| self.torrent_runtimes.contains_key(torrent_id))
            }
            _ => None,
        };
        let media_fence = match &command {
            Command::Pause { torrent_id }
            | Command::ForceRecheck { torrent_id }
            | Command::Archive { torrent_id }
            | Command::RemoveTorrent { torrent_id, .. }
            | Command::CancelPendingAdd { torrent_id } => Some(torrent_id.to_ascii_lowercase()),
            _ => None,
        };
        if let Some(torrent_id) = media_fence.as_deref() {
            self.media.revoke_torrent(torrent_id);
        }
        if let Some(torrent_id) = incoming_fence.as_deref() {
            self.stop_discovery_torrent(torrent_id).await?;
            self.unregister_incoming(torrent_id).await?;
        }
        let force_recheck_fence = match &command {
            Command::ForceRecheck { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                (!self
                    .load_resume_conservative(&torrent_id)?
                    .verification
                    .is_pending())
                .then_some(torrent_id)
            }
            _ => None,
        };
        if let Some(torrent_id) = force_recheck_fence.as_deref() {
            self.join_active_content(torrent_id).await?;
        }
        if let Some(torrent_id) = download_files_fence.as_deref() {
            self.join_active_content(torrent_id).await?;
        }
        let revision_before = self.store_mut()?.revision()?;
        let durable_result = {
            let mut store = self.store_mut()?;
            store.handle_durable(&request)
        };
        if durable_result.is_ok()
            && let Some(drain) = &self.product_milestone_drain
        {
            drain.notify();
        }
        let mut response = match durable_result {
            Ok(response) => response,
            Err(error) => {
                if error.is_resource_limit() {
                    let _ = self.views.record_diagnostic(
                        DiagnosticSeverity::Error,
                        category::STORAGE_IO,
                        "application_state_resource_limit",
                        None,
                        "Application state reached its configured resource limit",
                        &[],
                    );
                }
                if let Some(torrent_id) = incoming_fence.as_deref() {
                    self.reconcile_incoming_torrent(torrent_id).await?;
                    self.reconcile_discovery_torrent(torrent_id).await?;
                }
                if let Some(torrent_id) = force_recheck_fence.as_deref() {
                    self.start_if_possible(torrent_id).await?;
                }
                if let Some(torrent_id) = download_files_fence.as_deref() {
                    self.start_if_possible(torrent_id).await?;
                }
                return Err(error.into());
            }
        };
        self.apply_runtime_storage_to_response(&mut response);
        if !matches!(response.outcome, ResponseOutcome::Success { .. }) {
            if let Some(torrent_id) = incoming_fence.as_deref() {
                self.reconcile_incoming_torrent(torrent_id).await?;
                self.reconcile_discovery_torrent(torrent_id).await?;
            }
            if let Some(torrent_id) = force_recheck_fence.as_deref() {
                self.start_if_possible(torrent_id).await?;
            }
            if let Some(torrent_id) = download_files_fence.as_deref() {
                self.start_if_possible(torrent_id).await?;
            }
            return Ok(response);
        }
        if matches!(&command, Command::ExportMagnet { .. }) {
            return Ok(response);
        }
        let durable_mutation_applied = response.revision.parse::<u64>().map_err(|_| {
            ApplicationError::Configuration(
                "durable response contains an invalid revision".to_owned(),
            )
        })? > revision_before;
        self.refresh_views()?;

        let shutting_down = matches!(&command, Command::Shutdown);
        match command {
            Command::AddMagnet { .. } => {
                let add_result = response.result.as_ref().map(|result| match result {
                    CommandResult::AddTorrent { result } => result,
                    CommandResult::ExportMagnet { .. } => {
                        unreachable!("add-magnet response returned a magnet export")
                    }
                });
                let torrent_id = add_result
                    .map(|result| result.torrent_id.clone())
                    .ok_or_else(|| {
                        ApplicationError::Configuration(
                            "add-magnet response omitted its torrent owner".to_owned(),
                        )
                    })?;
                let disposition = add_result.map(|result| &result.disposition);
                match disposition {
                    Some(AddTorrentDisposition::Added) => {
                        self.views.record_diagnostic(
                            DiagnosticSeverity::Info,
                            category::LIFECYCLE_TORRENT,
                            "torrent_added",
                            Some(&torrent_id),
                            "Torrent added to the session",
                            &[],
                        )?;
                        self.start_if_possible(&torrent_id).await?;
                    }
                    Some(AddTorrentDisposition::SelectionExpanded { .. }) => {
                        self.pause(&torrent_id).await?;
                        self.refresh_views()?;
                        self.start_if_possible(&torrent_id).await?;
                    }
                    Some(AddTorrentDisposition::AlreadyPresent) | None => {
                        self.reconcile_incoming_torrent(&torrent_id).await?;
                        self.reconcile_discovery_torrent(&torrent_id).await?;
                    }
                }
            }
            Command::Resume { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "torrent_resumed",
                    Some(&torrent_id),
                    "Torrent resume requested",
                    &[],
                )?;
                self.start_if_possible(&torrent_id).await?;
                self.reconcile_incoming_torrent(&torrent_id).await?;
            }
            Command::Pause { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "torrent_paused",
                    Some(&torrent_id),
                    "Torrent pause requested",
                    &[],
                )?;
                self.pause(&torrent_id).await?;
            }
            Command::ForceRecheck { torrent_id } => {
                if !durable_mutation_applied {
                    let torrent_id = torrent_id.to_ascii_lowercase();
                    let pending = self
                        .load_resume_conservative(&torrent_id)?
                        .verification
                        .is_pending();
                    if pending {
                        self.start_recheck_if_possible(&torrent_id).await?;
                    } else {
                        self.start_if_possible(&torrent_id).await?;
                        self.reconcile_incoming_torrent(&torrent_id).await?;
                        self.reconcile_discovery_torrent(&torrent_id).await?;
                    }
                    return Ok(response);
                }
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.refresh_views()?;
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::INTEGRITY_HASH,
                    "force_recheck_requested",
                    Some(&torrent_id),
                    "Managed content force recheck requested",
                    &[],
                )?;
                self.start_recheck_if_possible(&torrent_id).await?;
            }
            Command::SetFilePriority { torrent_id, .. }
            | Command::SetFilePriorityRanges { torrent_id, .. } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::STORAGE_IO,
                    "file_priority_changed",
                    Some(&torrent_id),
                    "Torrent file priority changed",
                    &[],
                )?;
                if file_priority_changed {
                    let active_control = self
                        .active_download_for(&torrent_id)
                        .map(|active| active.control.clone());
                    if let Some(control) = active_control {
                        let resume = self.load_resume_conservative(&torrent_id)?;
                        let skip_files = resume
                            .skip_files
                            .into_iter()
                            .map(|index| {
                                usize::try_from(index).map_err(|_| {
                                    ApplicationError::Configuration(
                                        "file selection index overflow".to_owned(),
                                    )
                                })
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        let high_priority_files = resume
                            .high_priority_files
                            .into_iter()
                            .map(|index| {
                                usize::try_from(index).map_err(|_| {
                                    ApplicationError::Configuration(
                                        "file priority index overflow".to_owned(),
                                    )
                                })
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        let revision = response.revision.parse::<u64>().map_err(|_| {
                            ApplicationError::Configuration(
                                "durable response contains an invalid revision".to_owned(),
                            )
                        })?;
                        control.update_file_selection(FileSelectionUpdate {
                            revision,
                            skip_files,
                            high_priority_files,
                        });
                    } else {
                        self.start_if_possible(&torrent_id).await?;
                    }
                }
            }
            Command::DownloadFiles { torrent_id, .. } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "file_download_requested",
                    Some(&torrent_id),
                    "Torrent files requested for download",
                    &[],
                )?;
                let (resume, revision, eligible) = {
                    let store = self.store_mut()?;
                    let resume = store.load_resume(&torrent_id)?;
                    let revision = store.revision()?;
                    let eligible = store.snapshot()?.torrents.iter().any(|torrent| {
                        torrent.torrent_id == torrent_id
                            && !torrent.archived
                            && torrent.removal_state.is_none()
                    });
                    (resume, revision, eligible)
                };
                if eligible && resume.desired_running {
                    if file_priority_changed {
                        let active_control = self
                            .active_download_for(&torrent_id)
                            .map(|active| active.control.clone());
                        if let Some(control) = active_control {
                            let skip_files = resume
                                .skip_files
                                .iter()
                                .copied()
                                .map(|index| {
                                    usize::try_from(index).map_err(|_| {
                                        ApplicationError::Configuration(
                                            "file selection index overflow".to_owned(),
                                        )
                                    })
                                })
                                .collect::<Result<Vec<_>, _>>()?;
                            let high_priority_files = resume
                                .high_priority_files
                                .iter()
                                .copied()
                                .map(|index| {
                                    usize::try_from(index).map_err(|_| {
                                        ApplicationError::Configuration(
                                            "file priority index overflow".to_owned(),
                                        )
                                    })
                                })
                                .collect::<Result<Vec<_>, _>>()?;
                            control.update_file_selection(FileSelectionUpdate {
                                revision,
                                skip_files,
                                high_priority_files,
                            });
                        }
                    }
                    self.start_if_possible(&torrent_id).await?;
                }
            }
            Command::ConfirmPendingFileSelection { torrent_id, .. }
            | Command::DownloadAllPendingAdd { torrent_id, .. } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "pending_file_selection_confirmed",
                    Some(&torrent_id),
                    "Add-time file selection confirmed",
                    &[],
                )?;
                let still_queued: std::collections::BTreeSet<_> = if queued_selection.is_empty() {
                    Default::default()
                } else {
                    self.store_mut()?
                        .snapshot()?
                        .torrents
                        .into_iter()
                        .filter(|torrent| torrent.awaiting_file_selection)
                        .map(|torrent| torrent.torrent_id)
                        .collect()
                };
                let released: Vec<_> = queued_selection
                    .into_iter()
                    .filter(|queued| !still_queued.contains(queued))
                    .collect();
                for queued in &released {
                    self.views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::LIFECYCLE_TORRENT,
                        "pending_file_selection_released",
                        Some(queued),
                        "Queued add released when file selection was turned off",
                        &[],
                    )?;
                }
                self.start_if_possible(&torrent_id).await?;
                self.reconcile_incoming_torrent(&torrent_id).await?;
                for queued in &released {
                    self.reconcile_incoming_torrent(queued).await?;
                }
            }
            Command::Archive { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "torrent_archived",
                    Some(&torrent_id),
                    "Torrent archived",
                    &[],
                )?;
                // Archive persists paused intent. Unlike Pause, a running
                // checker is joined rather than parked: an archived torrent
                // cannot resume it, and a parked checker would hold the only
                // verification slot. Pending verification restarts on Resume.
                self.unregister_incoming(&torrent_id).await?;
                let joined = self.join_active_content(&torrent_id).await;
                let incoming = self.reconcile_incoming_torrent(&torrent_id).await;
                joined.and(incoming)?;
                self.reconcile_admission().await?;
            }
            Command::RestoreArchive { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "torrent_archive_restored",
                    Some(&torrent_id),
                    "Torrent restored from archive",
                    &[],
                )?;
                self.reconcile_incoming_torrent(&torrent_id).await?;
            }
            Command::RemoveTorrent { torrent_id, .. } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "torrent_removal_started",
                    Some(&torrent_id),
                    "Torrent removal started",
                    &[],
                )?;
                self.drive_removal(&torrent_id).await?;
            }
            Command::CancelPendingAdd { torrent_id } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "pending_add_cancelled",
                    Some(&torrent_id),
                    "Pending torrent add cancelled",
                    &[],
                )?;
                self.drive_removal(&torrent_id).await?;
            }
            Command::RemoveStorageRoot { storage_root } => {
                self.media.revoke_all();
                self.healthy_platform_roots.remove(&storage_root);
                self.reload_storage_roots()?;
            }
            Command::SetDefaultStorageRoot { .. }
            | Command::SetShowAddOptions { .. }
            | Command::SetShowFileSelection { .. } => {}
            Command::MoveDownloadToTop { .. } | Command::MoveDownloadToBottom { .. } => {}
            Command::UpdateClientSettings { .. } | Command::ResetClientSettings => {
                let settings = self.store_mut()?.snapshot()?.client_settings;
                self.session_network_config.settings = settings.clone();
                if let Some(session_network) = self.session_network.as_mut() {
                    session_network.submit_settings(settings)?;
                } else {
                    self.views.replace_network_runtime_views(
                        DhtInspectionView::suspended(self.network.policy),
                        crate::ClientSettingsRuntimeView::from_configured(settings),
                    )?;
                }
            }
            Command::UpdateTorrentSettings { torrent_id, .. } => {
                let torrent_id = torrent_id.to_ascii_lowercase();
                let limits = self
                    .store_mut()?
                    .snapshot()?
                    .torrents
                    .into_iter()
                    .find(|torrent| torrent.torrent_id == torrent_id)
                    .map(|torrent| torrent.transfer_limits);
                if self.session_network.is_some()
                    && let Some(limits) = limits
                {
                    self.ensure_torrent_runtime(&torrent_id)?
                        .peers()
                        .set_transfer_rate_limits(limits.into_engine());
                }
            }
            Command::Shutdown => {
                self.shutdown().await?;
            }
            Command::ClearAppData => unreachable!("app data clear returned before store mutation"),
            Command::ExportMagnet { .. } | Command::Snapshot => {}
        }
        if !shutting_down {
            self.reconcile_admission().await?;
            self.reconcile_discovery_catalog().await?;
        }
        Ok(response)
    }

    pub async fn add_torrent_bytes(
        &mut self,
        request: AddTorrentBytesRequest,
        source: Vec<u8>,
    ) -> Result<ResponseEnvelope, ApplicationError> {
        if self.reset_incomplete {
            return Err(ApplicationError::Configuration(
                "app data clear is incomplete; retry the clear action".to_owned(),
            ));
        }
        self.reap_finished().await?;
        let prepare_request = request.clone();
        let prepared = match tokio::task::spawn_blocking(move || {
            prepare_torrent_bytes(&prepare_request, source)
        })
        .await
        .map_err(|error| ApplicationError::Join(error.to_string()))?
        {
            Ok(prepared) => prepared,
            Err((code, message)) => {
                return Ok(ResponseEnvelope::error(
                    request.request_id,
                    self.store_mut()?.revision()?,
                    code,
                    message,
                ));
            }
        };
        let existing_owner = self.store_mut()?.find_owner(prepared.full_identity())?;
        let snapshot = self.store_mut()?.snapshot()?;
        let duplicate = existing_owner.is_some();
        if !duplicate && !self.storage_roots.contains_key(&request.storage_root) {
            let known = snapshot
                .storage
                .roots
                .iter()
                .any(|root| root.root_id == request.storage_root);
            return Ok(ResponseEnvelope::error(
                request.request_id,
                self.store_mut()?.revision()?,
                if known {
                    ErrorCode::StorageNeedsRepair
                } else {
                    ErrorCode::UnknownStorageRoot
                },
                if known {
                    format!(
                        "storage root {} is unavailable and needs repair",
                        request.storage_root
                    )
                } else {
                    format!("storage root {} is not configured", request.storage_root)
                },
            ));
        }
        let durable_result = self
            .store_mut()?
            .handle_prepared_torrent_bytes(&request, &prepared);
        if durable_result.is_ok()
            && let Some(drain) = &self.product_milestone_drain
        {
            drain.notify();
        }
        let mut response = match durable_result {
            Ok(response) => response,
            Err(error) => {
                if error.is_resource_limit() {
                    let _ = self.views.record_diagnostic(
                        DiagnosticSeverity::Error,
                        category::STORAGE_IO,
                        "application_state_resource_limit",
                        None,
                        "Application state reached its configured resource limit",
                        &[],
                    );
                }
                return Err(error.into());
            }
        };
        self.apply_runtime_storage_to_response(&mut response);
        if !matches!(response.outcome, ResponseOutcome::Success { .. }) {
            return Ok(response);
        }
        let add_result = response.result.as_ref().and_then(|result| match result {
            CommandResult::AddTorrent { result } => Some(result),
            CommandResult::ExportMagnet { .. } => None,
        });
        let torrent_id = add_result
            .map(|result| result.torrent_id.clone())
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "add-torrent-bytes response omitted its torrent owner".to_owned(),
                )
            })?;
        self.refresh_views()?;
        self.reconcile_discovery_catalog().await?;
        if matches!(
            add_result.map(|result| &result.disposition),
            Some(AddTorrentDisposition::Added)
        ) {
            self.views.record_diagnostic(
                DiagnosticSeverity::Info,
                category::LIFECYCLE_TORRENT,
                "torrent_bytes_added",
                Some(&torrent_id),
                "Torrent metainfo bytes added to the session",
                &[],
            )?;
            self.start_if_possible(&torrent_id).await?;
        }
        self.reconcile_discovery_torrent(&torrent_id).await?;
        Ok(response)
    }

    pub fn revision(&self) -> Result<u64, ApplicationError> {
        Ok(self.store_mut()?.revision()?)
    }

    fn apply_runtime_storage_to_response(&self, response: &mut ResponseEnvelope) {
        if let ResponseOutcome::Success { snapshot } = &mut response.outcome {
            apply_runtime_storage_availability(snapshot, &self.storage_roots);
        }
    }

    pub fn storage_snapshot(&self) -> Result<crate::StorageSettingsSnapshot, ApplicationError> {
        let mut snapshot = self.store_mut()?.snapshot()?;
        apply_runtime_storage_availability(&mut snapshot, &self.storage_roots);
        Ok(snapshot.storage)
    }

    /// Exercises every configured platform root through the bounded broker
    /// before making it eligible for torrent work.
    pub async fn probe_platform_storage_roots(&mut self) -> Result<bool, ApplicationError> {
        self.reap_finished().await?;
        let configured = self.store_mut()?.storage_roots()?;
        let platform_roots = configured
            .iter()
            .filter(|root| matches!(root.location, StorageRootLocation::PlatformCapability))
            .map(|root| root.id.clone())
            .collect::<Vec<_>>();
        let mut healthy = BTreeSet::new();
        let mut failures = BTreeMap::new();
        for root_id in &platform_roots {
            let storage_id = format!("root-health:{root_id}");
            let reference = StorageFileReference::new(
                self.storage_file_pool.clone(),
                StorageFileKey {
                    storage_id: storage_id.clone(),
                    storage_generation: 0,
                    role: StorageFileRole::ContentRoot,
                },
                StorageFileLocator::Platform(rstorrent_engine::PlatformStorageTarget {
                    root_id: root_id.clone(),
                    storage_id,
                    storage_generation: 0,
                    role: StorageFileRole::ContentRoot,
                    path: Vec::new(),
                }),
            );
            match reference.observe().await {
                Ok(observation)
                    if observation.exists
                        && observation.kind == Some(StorageObjectKind::Directory) =>
                {
                    healthy.insert(root_id.clone());
                }
                Ok(_) => {
                    failures.insert(
                        root_id.clone(),
                        "platform storage root is missing or not a directory".to_owned(),
                    );
                }
                Err(error) => {
                    failures.insert(root_id.clone(), error.to_string());
                }
            }
        }

        let lost = self
            .healthy_platform_roots
            .difference(&healthy)
            .cloned()
            .collect::<BTreeSet<_>>();
        let repaired = healthy
            .difference(&self.healthy_platform_roots)
            .cloned()
            .collect::<BTreeSet<_>>();
        if !repaired.is_empty() {
            let affected = self
                .store_mut()?
                .snapshot()?
                .torrents
                .into_iter()
                .filter(|torrent| repaired.contains(&torrent.storage_root))
                .map(|torrent| torrent.torrent_id)
                .collect::<Vec<_>>();
            for torrent_id in affected {
                self.storage_file_pool.invalidate_storage(&torrent_id);
            }
        }
        if !lost.is_empty() {
            let affected = self
                .store_mut()?
                .snapshot()?
                .torrents
                .into_iter()
                .filter(|torrent| lost.contains(&torrent.storage_root))
                .map(|torrent| torrent.torrent_id)
                .collect::<Vec<_>>();
            for torrent_id in affected {
                let resume = self.load_resume_conservative(&torrent_id)?;
                self.unregister_incoming(&torrent_id).await?;
                self.join_active_content(&torrent_id).await?;
                self.storage_file_pool.invalidate_storage(&torrent_id);
                let detail = failures
                    .get(&resume.storage_root)
                    .map_or("platform storage root is unavailable", String::as_str);
                self.store_mut()?
                    .mark_awaiting_storage(&torrent_id, Some(detail))?;
            }
        }

        self.healthy_platform_roots = healthy;
        self.storage_file_pool.take_platform_root_failures();
        self.storage_roots = Arc::new(available_storage_roots(
            configured,
            &self.healthy_platform_roots,
        ));
        for (root_id, detail) in &failures {
            self.views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::PLATFORM_ADAPTER,
                "platform_storage_root_unavailable",
                None,
                "Platform storage root is unavailable",
                &[("root", root_id), ("detail", detail)],
            )?;
        }
        self.reconcile_admission().await?;
        self.reconcile_incoming_catalog().await?;
        self.reconcile_discovery_catalog().await?;
        self.refresh_views()?;
        Ok(failures.is_empty())
    }

    async fn reconcile_platform_root_failures(&mut self) -> Result<(), ApplicationError> {
        let failures = self.storage_file_pool.take_platform_root_failures();
        if failures.is_empty() {
            return Ok(());
        }
        let lost = failures
            .iter()
            .map(|(root_id, _)| root_id)
            .filter(|root_id| self.healthy_platform_roots.contains(*root_id))
            .cloned()
            .collect::<BTreeSet<_>>();
        if lost.is_empty() {
            return Ok(());
        }
        for root_id in &lost {
            self.healthy_platform_roots.remove(root_id);
        }
        let configured = self.store_mut()?.storage_roots()?;
        self.storage_roots = Arc::new(available_storage_roots(
            configured,
            &self.healthy_platform_roots,
        ));
        let affected = self
            .store_mut()?
            .snapshot()?
            .torrents
            .into_iter()
            .filter(|torrent| lost.contains(&torrent.storage_root))
            .map(|torrent| (torrent.torrent_id, torrent.storage_root))
            .collect::<Vec<_>>();
        for (torrent_id, root_id) in affected {
            self.unregister_incoming(&torrent_id).await?;
            self.join_active_content(&torrent_id).await?;
            self.storage_file_pool.invalidate_storage(&torrent_id);
            let detail = failures
                .iter()
                .find(|(failed_root, _)| failed_root == &root_id)
                .map(|(_, failure)| failure.to_string())
                .unwrap_or_else(|| "platform storage root is unavailable".to_owned());
            self.store_mut()?
                .mark_awaiting_storage(&torrent_id, Some(&detail))?;
        }
        for (root_id, failure) in failures {
            if !lost.contains(&root_id) {
                continue;
            }
            let detail = failure.to_string();
            self.views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::PLATFORM_ADAPTER,
                "platform_storage_root_lost",
                None,
                "Platform storage root became unavailable",
                &[("root", &root_id), ("detail", &detail)],
            )?;
        }
        self.refresh_views()?;
        self.reconcile_discovery_catalog().await?;
        Ok(())
    }

    pub fn incoming_peer_snapshot(&self) -> Option<IncomingPeerServiceSnapshot> {
        self.session_network
            .as_ref()
            .and_then(SessionNetworkRuntime::incoming_peer_snapshot)
    }

    pub fn utp_snapshot(&self) -> Option<rstorrent_engine::UtpServiceSnapshot> {
        self.session_network
            .as_ref()
            .and_then(SessionNetworkRuntime::utp_handle)
            .map(|handle| handle.snapshot())
    }

    pub fn session_udp_snapshot(&self) -> Option<rstorrent_engine::SessionUdpSnapshot> {
        self.session_network
            .as_ref()
            .map(SessionNetworkRuntime::session_udp_snapshot)
    }

    pub fn session_download_resource_snapshot(&self) -> SessionDownloadResourceSnapshot {
        self.session_download_resources.snapshot()
    }

    pub fn peer_budget_snapshot(&self) -> rstorrent_engine::PeerBudgetSnapshot {
        self.session_network
            .as_ref()
            .map(|network| network.peer_budget().snapshot())
            .unwrap_or(rstorrent_engine::PeerBudgetSnapshot {
                configured_limit: 0,
                effective_limit: 0,
                incoming_slack: 0,
                outgoing_connecting: 0,
                outgoing_established: 0,
                incoming_connecting: 0,
                incoming_established: 0,
                total: 0,
                total_high_water: 0,
            })
    }

    pub fn bandwidth_snapshot(&self) -> rstorrent_engine::SessionBandwidthSnapshot {
        self.session_network
            .as_ref()
            .map(SessionNetworkRuntime::bandwidth_snapshot)
            .unwrap_or_default()
    }

    fn accounting_activities(&self) -> Vec<AccountingActivity> {
        self.torrent_runtimes
            .values()
            .map(|runtime| {
                let active_download = runtime.active_download();
                let admitted_download =
                    active_download.is_some_and(|active| !active.control.checking_is_paused());
                let full_seed =
                    active_download.is_none() && runtime.handle().has_seed_registration();
                AccountingActivity {
                    torrent_id: runtime.handle().identity().torrent_id(),
                    generation: runtime.generation(),
                    active: admitted_download || full_seed,
                    finished: full_seed,
                    seeding: full_seed,
                }
            })
            .collect()
    }

    fn maintain_admission_inactivity(&mut self) -> Result<bool, ApplicationError> {
        let now_seconds = self.admission_started_at.elapsed().as_secs();
        let samples = self
            .torrent_runtimes
            .iter()
            .filter_map(|(torrent_id, runtime)| {
                let selected_finished = if runtime
                    .active_download()
                    .is_some_and(|active| active.control.checker_snapshot().is_none())
                {
                    false
                } else if runtime.handle().has_seed_registration() {
                    true
                } else {
                    return None;
                };
                let peers = runtime.peers().connection_snapshot();
                let upload_rate = peers.iter().fold(0_u64, |total, peer| {
                    total.saturating_add(peer.upload.map_or(0, |upload| upload.payload_rate))
                });
                let download_rate = peers.iter().fold(0_u64, |total, peer| {
                    total.saturating_add(
                        peer.content
                            .map_or(0, |content| content.observed_payload_rate)
                            .try_into()
                            .unwrap_or(u64::MAX),
                    )
                });
                Some((
                    torrent_id.clone(),
                    runtime.generation(),
                    selected_finished,
                    rate_is_inactive(selected_finished, upload_rate, download_rate),
                ))
            })
            .collect::<Vec<_>>();
        let active = samples
            .iter()
            .map(|(torrent_id, _, _, _)| torrent_id.clone())
            .collect::<BTreeSet<_>>();
        self.admission_inactivity
            .retain(|torrent_id, _| active.contains(torrent_id));

        let mut changed = false;
        for (torrent_id, generation, selected_finished, observed_inactive) in samples {
            let entry = self.admission_inactivity.entry(torrent_id).or_default();
            if entry.generation != generation || entry.selected_finished != selected_finished {
                *entry = AdmissionInactivityState {
                    generation,
                    selected_finished,
                    state: InactivityState::default(),
                };
            }
            changed |= entry
                .state
                .observe(now_seconds, observed_inactive)
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?
                .is_some();
        }
        Ok(changed)
    }

    fn torrent_inactive(&self, torrent_id: &str, generation: u64) -> bool {
        self.admission_inactivity
            .get(torrent_id)
            .is_some_and(|entry| entry.generation == generation && entry.state.inactive())
    }

    fn maintain_accounting(&mut self, force: bool) -> Result<(), ApplicationError> {
        self.accounting
            .observe_activities(&self.accounting_activities())
            .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
        self.flush_accounting(force)
    }

    fn flush_accounting(&mut self, force: bool) -> Result<(), ApplicationError> {
        let updates = self
            .accounting
            .prepare_flush(force)
            .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
        if updates.is_empty() {
            return Ok(());
        }
        self.store_mut()?.replace_accounting_batch(&updates)?;
        self.accounting
            .acknowledge(&updates)
            .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
        Ok(())
    }

    #[cfg(test)]
    fn accounting_high_water(
        &self,
    ) -> Result<crate::accounting::AccountingHighWater, ApplicationError> {
        self.accounting
            .high_water()
            .map_err(|error| ApplicationError::Persistence(error.to_string()))
    }

    pub async fn ensure_maintenance_owner(service: &Arc<tokio::sync::Mutex<Self>>) {
        let (admission_wake, discovery_wake, accounting_wake, cancellation) = {
            let mut service = service.lock().await;
            if service.maintenance_started {
                return;
            }
            service.maintenance_started = true;
            (
                service.admission_wake.clone(),
                service.discovery_wake.clone(),
                service.accounting_wake.clone(),
                service.maintenance_cancellation.clone(),
            )
        };
        let weak_service = Arc::downgrade(service);
        let task = tokio::spawn(async move {
            let mut accounting_tick = tokio::time::interval(Duration::from_secs(1));
            accounting_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut admission_tick =
                tokio::time::interval(Duration::from_secs(AUTO_MANAGE_INTERVAL_SECONDS));
            admission_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                let action = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    _ = admission_wake.notified() => MaintenanceAction::Admission,
                    _ = discovery_wake.notified() => MaintenanceAction::Discovery,
                    _ = accounting_wake.notified() => MaintenanceAction::Accounting,
                    _ = admission_tick.tick() => MaintenanceAction::Admission,
                    _ = accounting_tick.tick() => MaintenanceAction::Accounting,
                };
                let Some(service) = weak_service.upgrade() else {
                    break;
                };
                let mut service = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    service = service.lock() => service,
                };
                let inactivity_changed = service.maintain_admission_inactivity();
                if matches!(inactivity_changed, Ok(true)) {
                    service.admission_wake.notify_one();
                }
                let result = inactivity_changed.and_then(|_| service.maintain_accounting(false));
                let result = if result.is_err() || service.session_network.is_none() {
                    result
                } else {
                    match action {
                        MaintenanceAction::Admission => service.reconcile_admission().await,
                        MaintenanceAction::Discovery => service.reconcile_discovery_catalog().await,
                        MaintenanceAction::Accounting => Ok(()),
                    }
                };
                let result = result.and_then(|()| service.maintain_accounting(false));
                if let Err(error) = result {
                    let detail = error.to_string();
                    let (code, message) = match action {
                        MaintenanceAction::Admission => (
                            "download_admission_reconcile_failed",
                            "Automatic download admission could not converge",
                        ),
                        MaintenanceAction::Discovery => (
                            "discovery_advertisement_reconcile_failed",
                            "Active-route advertisement could not converge",
                        ),
                        MaintenanceAction::Accounting => (
                            "torrent_accounting_checkpoint_failed",
                            "Durable torrent accounting could not checkpoint",
                        ),
                    };
                    let _ = service.views.record_diagnostic(
                        DiagnosticSeverity::Error,
                        category::LIFECYCLE_SESSION,
                        code,
                        None,
                        message,
                        &[("detail", &detail)],
                    );
                }
            }
        });
        service.lock().await.maintenance_task = Some(task);
    }

    #[doc(hidden)]
    pub async fn ensure_optional_maintenance_owner(
        service: &Arc<tokio::sync::Mutex<Option<Self>>>,
    ) {
        let (admission_wake, discovery_wake, accounting_wake, cancellation) = {
            let mut service = service.lock().await;
            let Some(service) = service.as_mut() else {
                return;
            };
            if service.maintenance_started {
                return;
            }
            service.maintenance_started = true;
            (
                service.admission_wake.clone(),
                service.discovery_wake.clone(),
                service.accounting_wake.clone(),
                service.maintenance_cancellation.clone(),
            )
        };
        let weak_service = Arc::downgrade(service);
        let task = tokio::spawn(async move {
            let mut accounting_tick = tokio::time::interval(Duration::from_secs(1));
            accounting_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut admission_tick =
                tokio::time::interval(Duration::from_secs(AUTO_MANAGE_INTERVAL_SECONDS));
            admission_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                let action = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    _ = admission_wake.notified() => MaintenanceAction::Admission,
                    _ = discovery_wake.notified() => MaintenanceAction::Discovery,
                    _ = accounting_wake.notified() => MaintenanceAction::Accounting,
                    _ = admission_tick.tick() => MaintenanceAction::Admission,
                    _ = accounting_tick.tick() => MaintenanceAction::Accounting,
                };
                let Some(service) = weak_service.upgrade() else {
                    break;
                };
                let mut service = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    service = service.lock() => service,
                };
                let Some(service) = service.as_mut() else {
                    break;
                };
                let inactivity_changed = service.maintain_admission_inactivity();
                if matches!(inactivity_changed, Ok(true)) {
                    service.admission_wake.notify_one();
                }
                let result = inactivity_changed.and_then(|_| service.maintain_accounting(false));
                let result = if result.is_err() || service.session_network.is_none() {
                    result
                } else {
                    match action {
                        MaintenanceAction::Admission => service.reconcile_admission().await,
                        MaintenanceAction::Discovery => service.reconcile_discovery_catalog().await,
                        MaintenanceAction::Accounting => Ok(()),
                    }
                };
                let result = result.and_then(|()| service.maintain_accounting(false));
                if let Err(error) = result {
                    let detail = error.to_string();
                    let (code, message) = match action {
                        MaintenanceAction::Admission => (
                            "download_admission_reconcile_failed",
                            "Automatic download admission could not converge",
                        ),
                        MaintenanceAction::Discovery => (
                            "discovery_advertisement_reconcile_failed",
                            "Active-route advertisement could not converge",
                        ),
                        MaintenanceAction::Accounting => (
                            "torrent_accounting_checkpoint_failed",
                            "Durable torrent accounting could not checkpoint",
                        ),
                    };
                    let _ = service.views.record_diagnostic(
                        DiagnosticSeverity::Error,
                        category::LIFECYCLE_SESSION,
                        code,
                        None,
                        message,
                        &[("detail", &detail)],
                    );
                }
            }
        });
        let mut service = service.lock().await;
        if let Some(service) = service.as_mut() {
            service.maintenance_task = Some(task);
        } else {
            task.abort();
        }
    }

    /// Issues one opt-in interoperability diagnostic against the active or
    /// most recently deleted IPv6 pinhole without exposing its volatile ID.
    #[doc(hidden)]
    pub async fn ipv6_pinhole_packets_for_diagnostics(
        &self,
        deleted: bool,
    ) -> Option<crate::Ipv6PinholeDiagnosticResult> {
        self.session_network
            .as_ref()?
            .ipv6_pinhole_packets_for_diagnostics(deleted)
            .await
    }

    pub fn mse_dh_work_snapshot(&self) -> rstorrent_engine::MseDhWorkSnapshot {
        self.session_network
            .as_ref()
            .map(|network| network.mse_dh().snapshot())
            .unwrap_or(rstorrent_engine::MseDhWorkSnapshot {
                waiting: 0,
                active: 0,
                high_water: 0,
                tracked: 0,
                closed: true,
            })
    }

    pub fn suggested_storage_root_path(
        &self,
        repair_root: Option<&str>,
    ) -> Result<Option<PathBuf>, ApplicationError> {
        let store = self.store_mut()?;
        let snapshot = store.snapshot()?;
        let roots = store.storage_roots()?;
        if let Some(root_id) = repair_root {
            let root = snapshot
                .storage
                .roots
                .iter()
                .find(|root| root.root_id == root_id)
                .ok_or_else(|| {
                    ApplicationError::Configuration(format!(
                        "storage root {root_id} is not configured"
                    ))
                })?;
            if root.availability == crate::StorageRootAvailability::Available {
                return Err(ApplicationError::Configuration(
                    "an available root cannot be re-selected; torrent relocation is not implemented"
                        .to_owned(),
                ));
            }
        }
        let preferred = repair_root
            .map(str::to_owned)
            .or(snapshot.storage.default_root);
        let candidate = preferred
            .as_deref()
            .and_then(|root_id| roots.iter().find(|root| root.id == root_id))
            .or_else(|| {
                roots.iter().find(|root| {
                    matches!(&root.location, StorageRootLocation::Path(path) if path.is_dir())
                })
            });
        Ok(candidate.and_then(|root| match &root.location {
            StorageRootLocation::Path(path) if path.is_dir() => Some(path.clone()),
            StorageRootLocation::Path(path) => path
                .ancestors()
                .skip(1)
                .find(|ancestor| ancestor.is_dir())
                .map(Path::to_path_buf),
            StorageRootLocation::PlatformCapability => None,
        }))
    }

    pub fn install_path_storage_root(
        &mut self,
        selected_path: &Path,
    ) -> Result<StorageRootSnapshot, ApplicationError> {
        if self.reset_incomplete {
            return Err(ApplicationError::Configuration(
                "app data clear is incomplete; retry the clear action".to_owned(),
            ));
        }
        let path = validate_selected_directory(selected_path)?;
        let label = storage_root_label(&path);
        let root_id = self.allocate_storage_root_id()?;
        let (_, installed_id) = self
            .store_mut()?
            .install_path_storage_root(&root_id, &label, &path)?;
        self.reload_storage_roots()?;
        self.refresh_views()?;
        self.storage_snapshot()?
            .roots
            .into_iter()
            .find(|root| root.root_id == installed_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "installed storage root is missing from the durable snapshot".to_owned(),
                )
            })
    }

    pub async fn install_platform_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
        make_default: bool,
    ) -> Result<StorageRootSnapshot, ApplicationError> {
        self.probe_platform_storage_root_candidate(root_id).await?;
        self.store_mut()?
            .install_platform_storage_root(root_id, label, make_default)?;
        self.healthy_platform_roots.insert(root_id.to_owned());
        self.reload_storage_roots()?;
        self.refresh_views()?;
        self.storage_snapshot()?
            .roots
            .into_iter()
            .find(|root| root.root_id == root_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "installed platform root is missing from the durable snapshot".to_owned(),
                )
            })
    }

    pub async fn repair_platform_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
    ) -> Result<(StorageRootSnapshot, Vec<String>), ApplicationError> {
        let root = self
            .storage_snapshot()?
            .roots
            .into_iter()
            .find(|root| root.root_id == root_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(format!("storage root {root_id} is not configured"))
            })?;
        if root.availability == crate::StorageRootAvailability::Available && root.label == label {
            return Ok((root, Vec::new()));
        }
        if root.availability == crate::StorageRootAvailability::Available {
            return Err(ApplicationError::Configuration(
                "an available platform root cannot be repaired".to_owned(),
            ));
        }
        let restarts = self.prepare_platform_storage_replacement(root_id).await?;
        self.probe_platform_storage_root_candidate(root_id).await?;
        self.store_mut()?
            .repair_platform_storage_root(root_id, label)?;
        self.healthy_platform_roots.insert(root_id.to_owned());
        self.reload_storage_roots()?;
        self.refresh_views()?;
        let root = self
            .storage_snapshot()?
            .roots
            .into_iter()
            .find(|root| root.root_id == root_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "repaired platform root is missing from the durable snapshot".to_owned(),
                )
            })?;
        Ok((root, restarts))
    }

    /// Stops all torrent I/O under a platform root before the platform
    /// releases its grant. Torrents bound to it keep their binding and verified
    /// state and wait for the root to be repaired; an unreferenced root is
    /// deleted. A current root is replaced by the first other available root.
    pub async fn detach_platform_storage_root(
        &mut self,
        root_id: &str,
    ) -> Result<PlatformStorageDetach, ApplicationError> {
        self.reap_finished().await?;
        if !self.configured_platform_root(root_id)? {
            return Err(ApplicationError::Configuration(format!(
                "storage root {root_id} is not a platform capability"
            )));
        }
        // Platform deletion of a removed torrent's files needs the grant.
        if let Some(removal) = self
            .store_mut()?
            .load_removals()?
            .into_iter()
            .find(|removal| removal.storage_root == root_id)
        {
            return Err(ApplicationError::Busy(removal.torrent_id));
        }
        // Make the root unavailable first so admission cannot restart its
        // torrents while they are joined.
        self.healthy_platform_roots.remove(root_id);
        self.reload_storage_roots()?;
        let affected = self
            .store_mut()?
            .snapshot()?
            .torrents
            .into_iter()
            .filter(|torrent| torrent.storage_root == root_id)
            .map(|torrent| torrent.torrent_id)
            .collect::<Vec<_>>();
        for torrent_id in &affected {
            self.media.revoke_torrent(torrent_id);
            self.unregister_incoming(torrent_id).await?;
            self.join_active_content(torrent_id).await?;
            self.storage_file_pool.invalidate_storage(torrent_id);
            self.store_mut()?
                .mark_awaiting_storage(torrent_id, Some("download folder was removed"))?;
        }
        let replacement = self
            .storage_roots
            .keys()
            .find(|candidate| candidate.as_str() != root_id)
            .cloned();
        let removed = self
            .store_mut()?
            .detach_platform_storage_root(root_id, replacement.as_deref())?;
        self.storage_file_pool.clear_platform_root_failure(root_id);
        self.reload_storage_roots()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::PLATFORM_ADAPTER,
            "platform_storage_root_detached",
            None,
            "Platform storage root detached",
            &[
                ("root", root_id),
                ("removed", if removed { "true" } else { "false" }),
                ("torrents", &affected.len().to_string()),
            ],
        )?;
        self.reconcile_admission().await?;
        self.reconcile_incoming_catalog().await?;
        self.reconcile_discovery_catalog().await?;
        self.refresh_views()?;
        Ok(PlatformStorageDetach {
            removed,
            affected_torrent_ids: affected,
            default_root: self.storage_snapshot()?.default_root,
        })
    }

    async fn probe_platform_storage_root_candidate(
        &mut self,
        root_id: &str,
    ) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        let storage_id = format!("root-candidate:{root_id}");
        let reference = StorageFileReference::new(
            self.storage_file_pool.clone(),
            StorageFileKey {
                storage_id: storage_id.clone(),
                storage_generation: 0,
                role: StorageFileRole::ContentRoot,
            },
            StorageFileLocator::Platform(rstorrent_engine::PlatformStorageTarget {
                root_id: root_id.to_owned(),
                storage_id,
                storage_generation: 0,
                role: StorageFileRole::ContentRoot,
                path: Vec::new(),
            }),
        );
        let observation = reference.observe().await;
        self.storage_file_pool.clear_platform_root_failure(root_id);
        let observation =
            observation.map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        if !observation.exists || observation.kind != Some(StorageObjectKind::Directory) {
            return Err(ApplicationError::Configuration(
                "selected platform storage root is missing or not a directory".to_owned(),
            ));
        }
        Ok(())
    }

    pub fn repair_path_storage_root(
        &mut self,
        root_id: &str,
        selected_path: &Path,
    ) -> Result<StorageRootSnapshot, ApplicationError> {
        let snapshot = self.storage_snapshot()?;
        let root = snapshot
            .roots
            .iter()
            .find(|root| root.root_id == root_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(format!("storage root {root_id} is not configured"))
            })?;
        if root.availability == crate::StorageRootAvailability::Available {
            return Err(ApplicationError::Configuration(
                "an available root cannot be re-selected; torrent relocation is not implemented"
                    .to_owned(),
            ));
        }
        for active_torrent in self.active_download_ids() {
            let resume = self.store_mut()?.load_resume(&active_torrent)?;
            if resume.storage_root == root_id {
                return Err(ApplicationError::Busy(active_torrent));
            }
        }
        let path = validate_selected_directory(selected_path)?;
        let label = storage_root_label(&path);
        self.store_mut()?
            .repair_path_storage_root(root_id, &label, &path)?;
        self.reload_storage_roots()?;
        self.refresh_views()?;
        self.storage_snapshot()?
            .roots
            .into_iter()
            .find(|root| root.root_id == root_id)
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "repaired storage root is missing from the durable snapshot".to_owned(),
                )
            })
    }

    pub fn allocate_storage_root_id(&self) -> Result<String, ApplicationError> {
        let existing = self
            .store_mut()?
            .storage_roots()?
            .into_iter()
            .map(|root| root.id)
            .collect::<std::collections::BTreeSet<_>>();
        for _ in 0..4 {
            let mut bytes = [0_u8; 16];
            getrandom::fill(&mut bytes)
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
            let mut id = String::with_capacity(37);
            id.push_str("root_");
            for byte in bytes {
                use std::fmt::Write as _;
                write!(&mut id, "{byte:02x}").expect("writing to String cannot fail");
            }
            if !existing.contains(&id) {
                return Ok(id);
            }
        }
        Err(ApplicationError::Configuration(
            "could not allocate a unique storage root ID".to_owned(),
        ))
    }

    fn reload_storage_roots(&mut self) -> Result<(), ApplicationError> {
        let roots = self.store_mut()?.storage_roots()?;
        self.storage_roots = Arc::new(available_storage_roots(roots, &self.healthy_platform_roots));
        Ok(())
    }

    fn configured_platform_root(&self, root_id: &str) -> Result<bool, ApplicationError> {
        Ok(self.store_mut()?.storage_roots()?.into_iter().any(|root| {
            root.id == root_id && matches!(root.location, StorageRootLocation::PlatformCapability)
        }))
    }

    pub fn api_hello(&self) -> crate::ApiHello {
        let mut hello = crate::ApiHello::default();
        hello.limits.lease_millis = self.views.view_set_lease().as_millis().to_string();
        hello
    }

    pub fn subscribe(&self, spec: SubscriptionSpec) -> Result<ViewSubscription, ApplicationError> {
        Ok(self.views.subscribe(spec)?)
    }

    pub fn open_view_set(
        &self,
        owner: ViewSetOwner,
        request: OpenViewSetRequest,
    ) -> Result<OpenViewSetResponse, ViewSetError> {
        self.views.open_view_set(owner, request)
    }

    pub fn update_view_set(
        &self,
        owner: &ViewSetOwner,
        view_set_id: &str,
        request: UpdateViewSetRequest,
    ) -> Result<(), ViewSetError> {
        self.views.update_view_set(owner, view_set_id, request)
    }

    pub fn view_set(
        &self,
        owner: &ViewSetOwner,
        view_set_id: &str,
    ) -> Result<ViewSet, ViewSetError> {
        self.views.view_set(owner, view_set_id)
    }

    pub fn close_view_set(
        &self,
        owner: &ViewSetOwner,
        view_set_id: &str,
    ) -> Result<(), ViewSetError> {
        self.views.close_view_set(owner, view_set_id)
    }

    pub fn close_view_sets(&self) {
        self.views.close_all_view_sets();
    }

    pub fn close_owner_view_sets(&self, owner: &ViewSetOwner) {
        self.views.close_owner_view_sets(owner);
    }

    pub async fn platform_file_plan(
        &mut self,
        torrent_id: &str,
        file_index: u32,
    ) -> Result<PlatformFilePlan, ApplicationError> {
        self.reap_finished().await?;
        let torrent_id = torrent_id.to_ascii_lowercase();
        let resume = self.load_resume_conservative(&torrent_id)?;
        if resume.verification.is_pending()
            || matches!(
                resume.state,
                TorrentState::Checking | TorrentState::NeedsRepair | TorrentState::Error
            )
            || !self.storage_roots.contains_key(&resume.storage_root)
        {
            return Err(ApplicationError::Configuration(
                "torrent has no shareable verified platform file".to_owned(),
            ));
        }
        let content = parse_resume_content(&resume)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        let index = usize::try_from(file_index).map_err(|_| {
            ApplicationError::Configuration("file index exceeds this platform".to_owned())
        })?;
        let layout = ContentLayout::from_content(&content);
        let file = layout.files().get(index).ok_or_else(|| {
            ApplicationError::Configuration("file index is outside verified metadata".to_owned())
        })?;
        if file.padding {
            return Err(ApplicationError::Configuration(
                "padding files cannot be shared".to_owned(),
            ));
        }
        let have = resume.have.ok_or_else(|| {
            ApplicationError::Configuration("torrent has no verified piece state".to_owned())
        })?;
        let pieces = layout
            .file_piece_range(index)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        if pieces.is_some_and(|pieces| {
            pieces.into_iter().any(|piece| {
                !usize::try_from(piece)
                    .ok()
                    .and_then(|index| have.pieces().get(index))
                    .copied()
                    .unwrap_or(false)
            })
        }) {
            return Err(ApplicationError::Configuration(
                "file is not completely verified".to_owned(),
            ));
        }
        let artifact = DirectContentLayout::from_content(&content)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?
            .files
            .into_iter()
            .find(|artifact| artifact.file_index == index)
            .ok_or_else(|| {
                ApplicationError::Configuration("verified file layout is absent".to_owned())
            })?;
        Ok(PlatformFilePlan {
            torrent_id,
            storage_root: resume.storage_root,
            components: artifact.qualified_components,
            length: file.length,
        })
    }

    /// Create one opaque, in-memory verified-file authority without requiring
    /// an HTTP media origin. Remote transports keep this token inside the
    /// native owner and expose only their own circuit-bound signaling.
    pub async fn create_completed_media_capability(
        &mut self,
        torrent_id: &str,
        file_index: u32,
    ) -> Result<CompletedMediaCapability, ApplicationError> {
        let plan = self.platform_file_plan(torrent_id, file_index).await?;
        let resume = self.load_resume_conservative(&plan.torrent_id)?;
        let content = parse_resume_content(&resume)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        let index = usize::try_from(file_index).map_err(|_| {
            ApplicationError::Configuration("file index exceeds this platform".to_owned())
        })?;
        let have = resume.have.as_ref().ok_or_else(|| {
            ApplicationError::Configuration("torrent has no verified piece state".to_owned())
        })?;
        let storage_root = self
            .storage_roots
            .get(&resume.storage_root)
            .ok_or_else(|| {
                ApplicationError::Configuration("storage root is unavailable".to_owned())
            })?;
        let read_jobs = self.media.read_jobs();
        let reader = match storage_root {
            StorageRootLocation::Path(root) => {
                VerifiedFileReader::open_verified_content_with_pool(
                    root,
                    &content,
                    have.pieces(),
                    index,
                    self.storage_file_pool.clone(),
                    resume.torrent_id,
                    read_jobs,
                )
                .await
            }
            StorageRootLocation::PlatformCapability => {
                VerifiedFileReader::open_verified_content_with_platform(
                    &PlatformStorageSpec {
                        pool: self.storage_file_pool.clone(),
                        root_id: resume.storage_root,
                        storage_id: plan.torrent_id.clone(),
                        content_shape: ContentShape::from_content(&content),
                        content_name: content.name().to_owned(),
                        storage_generation: 1,
                    },
                    &content,
                    have.pieces(),
                    index,
                    read_jobs,
                )
                .await
            }
        }
        .map_err(|error| {
            ApplicationError::Configuration(format!("open verified direct file: {error}"))
        })?;
        let token = self
            .media
            .create_internal(plan.torrent_id, file_index, reader)
            .map_err(|error| match error {
                MediaRegistryError::ResourceLimit => {
                    ApplicationError::Configuration("direct-file capability limit".to_owned())
                }
                MediaRegistryError::Random(error) => ApplicationError::Configuration(format!(
                    "allocate direct-file capability: {error}"
                )),
                MediaRegistryError::ServerUnavailable => ApplicationError::Configuration(
                    "internal direct-file capability is unavailable".to_owned(),
                ),
            })?;
        Ok(CompletedMediaCapability {
            token,
            length: plan.length,
        })
    }

    pub fn storage_file_pool_snapshot(&self) -> StorageFilePoolSnapshot {
        self.storage_file_pool.snapshot()
    }

    pub async fn mark_storage_unavailable(
        &mut self,
        torrent_id: &str,
        message: &str,
    ) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        let torrent_id = torrent_id.to_ascii_lowercase();
        if self.active_download_for(&torrent_id).is_some() {
            return Err(ApplicationError::Busy(torrent_id));
        }
        self.load_resume_conservative(&torrent_id)?;
        self.store_mut()?
            .mark_awaiting_storage(&torrent_id, Some(message))?;
        self.storage_file_pool.invalidate_storage(&torrent_id);
        self.refresh_views()?;
        Ok(())
    }

    pub async fn prepare_platform_storage_replacement(
        &mut self,
        root_id: &str,
    ) -> Result<Vec<String>, ApplicationError> {
        self.reap_finished().await?;
        if !matches!(
            self.store_mut()?
                .storage_roots()?
                .into_iter()
                .find(|root| root.id == root_id)
                .map(|root| root.location),
            Some(StorageRootLocation::PlatformCapability),
        ) {
            return Err(ApplicationError::Configuration(format!(
                "storage root {root_id} is not a platform capability"
            )));
        }
        let mut restarts = Vec::new();
        for torrent_id in self.active_download_ids() {
            let resume = self.load_resume_conservative(&torrent_id)?;
            if resume.storage_root == root_id {
                restarts.push(torrent_id);
            }
        }
        for torrent_id in &restarts {
            self.pause(torrent_id).await?;
        }
        self.storage_file_pool.invalidate_all();
        self.healthy_platform_roots.remove(root_id);
        self.reload_storage_roots()?;
        self.refresh_views()?;
        Ok(restarts)
    }

    pub async fn platform_removal_plan(
        &mut self,
        torrent_id: &str,
    ) -> Result<PlatformRemovalPlan, ApplicationError> {
        self.reap_finished().await?;
        let torrent_id = torrent_id.to_ascii_lowercase();
        let removal = self.store_mut()?.load_removal(&torrent_id)?;
        if removal.policy != RemovalDataPolicy::DeleteData
            || removal.state != RemovalState::AwaitingPlatform
            || !self.configured_platform_root(&removal.storage_root)?
        {
            return Err(ApplicationError::Configuration(
                "torrent is not awaiting platform data removal".to_owned(),
            ));
        }
        let resume = self.load_resume_conservative(&torrent_id)?;
        let content = parse_resume_content(&resume)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        self.storage_file_pool.invalidate_storage(&torrent_id);
        let manifest = direct_payload_manifest(&content)?;
        Ok(PlatformRemovalPlan {
            operation_id: removal.operation_id,
            torrent_id,
            storage_root: removal.storage_root,
            name: content.name().to_owned(),
            tree: manifest.tree,
            files: manifest.files,
            directories: manifest.directories,
        })
    }

    pub async fn confirm_platform_removal(
        &mut self,
        torrent_id: &str,
        operation_id: &str,
    ) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        let torrent_id = torrent_id.to_ascii_lowercase();
        let removal = self.store_mut()?.load_removal(&torrent_id)?;
        if removal.state != RemovalState::AwaitingPlatform || removal.operation_id != operation_id {
            return Err(ApplicationError::Configuration(
                "platform removal confirmation is stale".to_owned(),
            ));
        }
        self.prepare_torrent_runtime_removal(&torrent_id)?;
        self.store_mut()?
            .finalize_removal(&torrent_id, operation_id)?;
        self.remove_torrent_runtime(&torrent_id, true)?;
        self.refresh_views()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::PLATFORM_ADAPTER,
            "torrent_removal_completed",
            Some(&torrent_id),
            "Torrent data and catalog entry removed from platform storage",
            &[],
        )?;
        Ok(())
    }

    pub async fn fail_platform_removal(
        &mut self,
        torrent_id: &str,
        operation_id: &str,
        message: &str,
    ) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        let torrent_id = torrent_id.to_ascii_lowercase();
        let removal = self.store_mut()?.load_removal(&torrent_id)?;
        if removal.state != RemovalState::AwaitingPlatform || removal.operation_id != operation_id {
            return Err(ApplicationError::Configuration(
                "platform removal failure is stale".to_owned(),
            ));
        }
        self.store_mut()?.set_removal_state(
            &torrent_id,
            operation_id,
            RemovalState::Failed,
            Some(message),
        )?;
        self.refresh_views()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Error,
            category::PLATFORM_ADAPTER,
            "torrent_removal_failed",
            Some(&torrent_id),
            "Platform torrent data could not be removed",
            &[("detail", message)],
        )?;
        Ok(())
    }

    pub async fn shutdown(&mut self) -> Result<(), ApplicationError> {
        let mut active_join_error = None;
        let mut shutdown_error = None;
        self.media.revoke_all();
        self.media.drain_reads().await;
        self.maintenance_cancellation.cancel();
        self.admission_wake.notify_waiters();
        self.accounting_wake.notify_waiters();
        if let Some(task) = self.maintenance_task.take()
            && let Err(error) = task.await
        {
            active_join_error = Some(format!("download admission owner: {error}"));
        }
        let mut stopped_activities = self.accounting_activities();
        for activity in &mut stopped_activities {
            activity.active = false;
            activity.finished = false;
            activity.seeding = false;
        }
        if let Err(error) = self.accounting.observe_activities(&stopped_activities) {
            shutdown_error = Some(ApplicationError::Persistence(error.to_string()));
        }
        if let Some(session_network) = self.session_network.as_mut() {
            session_network.begin_shutdown();
        }
        let active_ids = self.active_download_ids();
        for torrent_id in &active_ids {
            if let Some(active) = self.active_download_for(torrent_id) {
                active.control.cancel();
            }
        }
        for torrent_id in active_ids {
            let Some(active) = self.take_active_download(&torrent_id) else {
                continue;
            };
            let eta_generation = active.eta_generation;
            match active.task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) if active_join_error.is_none() => active_join_error = Some(error),
                Err(error) if error.is_cancelled() => {}
                Err(error) if active_join_error.is_none() => {
                    active_join_error = Some(error.to_string());
                }
                Ok(Err(_)) | Err(_) => {}
            }
            active.control.release_session_resources();
            if let Err(error) = self
                .views
                .deactivate_eta_generation(&torrent_id, eta_generation)
                && active_join_error.is_none()
            {
                active_join_error = Some(format!("torrent ETA deactivation: {error}"));
            }
        }
        if let Some(session_network) = self.session_network.take() {
            let terminal = session_network.shutdown(&self.views).await;
            if let Some(snapshot) = terminal.dht_snapshot
                && let Err(error) = self
                    .store_mut()
                    .and_then(|mut store| store.save_dht_snapshot(snapshot).map_err(Into::into))
            {
                shutdown_error = Some(error);
            }
            if let Some(error) = terminal.dht_error {
                shutdown_error = Some(error.into());
            }
            if let Some(error) = terminal.join_error
                && active_join_error.is_none()
            {
                active_join_error = Some(error);
            }
        }
        if let Err(error) = self.flush_accounting(true) {
            shutdown_error = Some(error);
        }
        for runtime in self.torrent_runtimes.values_mut() {
            if let Err(error) = runtime.handle().forget_seed_registration()
                && active_join_error.is_none()
            {
                active_join_error = Some(format!("torrent seed registration: {error}"));
            }
            if let Err(error) = runtime.publish_inactive()
                && active_join_error.is_none()
            {
                active_join_error = Some(format!("torrent peer state: {error}"));
            }
            runtime.deactivate_peer_events();
        }
        self.torrent_runtimes.clear();
        if let Err(error) = self.storage_file_pool.shutdown().await
            && active_join_error.is_none()
        {
            active_join_error = Some(format!("storage file pool: {error}"));
        }
        if let Some(mut eta_runtime) = self.eta_runtime.take()
            && let Err(error) = eta_runtime.shutdown().await
            && active_join_error.is_none()
        {
            active_join_error = Some(format!("torrent ETA runtime: {error}"));
        }
        if let Some(speed_history) = self.speed_history.take()
            && let Err(error) = speed_history.shutdown().await
            && active_join_error.is_none()
        {
            active_join_error = Some(format!("speed history: {error}"));
        }
        if let Some(mut drain) = self.product_milestone_drain.take()
            && let Err(error) = drain.shutdown().await
            && active_join_error.is_none()
        {
            active_join_error = Some(format!("product milestone drain: {error}"));
        }
        let _ = self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_TORRENT,
            "application_shutdown",
            None,
            "Application shutdown completed",
            &[],
        );
        if let Some(mut reaper) = self.view_set_reaper.take()
            && let Err(error) = reaper.shutdown().await
            && active_join_error.is_none()
        {
            active_join_error = Some(format!("view-set lease reaper: {error}"));
        }
        self.close_view_sets();
        if let Some(error) = shutdown_error {
            return Err(error);
        }
        if let Some(error) = active_join_error {
            return Err(ApplicationError::Join(error));
        }
        Ok(())
    }

    async fn clear_private_profile(&mut self) -> Result<(), ApplicationError> {
        let mut config = self.reset_config.clone();
        let profile_root = config
            .durable_profile_root()
            .ok_or_else(|| {
                ApplicationError::Configuration(
                    "app data clear requires a durable profile".to_owned(),
                )
            })?
            .to_path_buf();
        crate::profile_reset::preflight_private_profile_clear(&profile_root)?;
        config.storage_roots.clear();
        let placeholder_config = ApplicationConfig::ephemeral(
            "reset-placeholder".to_owned(),
            Vec::new(),
            NetworkConfig::new(
                NetworkPolicy::Offline,
                Duration::from_secs(15),
                Duration::from_secs(60),
            ),
        );
        let placeholder = Self::open(placeholder_config).await?;
        if let Err(error) = self.shutdown().await {
            let mut placeholder = placeholder;
            let _ = placeholder.shutdown().await;
            return Err(error);
        }
        let old = std::mem::replace(self, placeholder);
        drop(old);
        self.reset_config = config.clone();
        self.reset_incomplete = true;
        crate::profile_reset::clear_private_profile(&profile_root)?;
        let fresh = Self::open(config).await?;
        let mut placeholder = std::mem::replace(self, fresh);
        placeholder.shutdown().await?;
        Ok(())
    }

    fn store_mut(&self) -> Result<MutexGuard<'_, SessionStore>, ApplicationError> {
        self.store
            .lock()
            .map_err(|_| ApplicationError::StorePoisoned)
    }

    async fn restore_running(&mut self) -> Result<(), ApplicationError> {
        self.reconcile_admission().await
    }

    async fn restore_removals(&mut self) -> Result<(), ApplicationError> {
        let removals = self.store_mut()?.load_removals()?;
        for removal in removals {
            if removal.state == RemovalState::Pending {
                self.drive_removal(&removal.torrent_id).await?;
            }
        }
        Ok(())
    }

    async fn drive_removal(&mut self, torrent_id: &str) -> Result<(), ApplicationError> {
        let removal = match self.store_mut()?.load_removal(torrent_id) {
            Ok(removal) => removal,
            Err(StoreError::UnknownTorrent(_)) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if removal.state != RemovalState::Pending {
            return Ok(());
        }
        if let Err(error) = self.pause(torrent_id).await {
            return self.fail_removal(&removal, &error.to_string());
        }
        match removal.policy {
            RemovalDataPolicy::Keep => self.complete_removal(&removal),
            RemovalDataPolicy::DeleteData if removal.raw_info.is_none() => {
                self.complete_removal(&removal)
            }
            RemovalDataPolicy::DeleteData => {
                match self.storage_roots.get(&removal.storage_root).cloned() {
                    Some(StorageRootLocation::Path(root)) => {
                        self.storage_file_pool.invalidate_storage(torrent_id);
                        let deletion =
                            match self
                                .load_resume_conservative(torrent_id)
                                .and_then(|resume| {
                                    parse_resume_content(&resume).map_err(|error| {
                                        ApplicationError::Configuration(error.to_string())
                                    })
                                }) {
                                Ok(content) => direct_payload_manifest(&content)
                                    .map(|manifest| (content.name().to_owned(), manifest)),
                                Err(error) => {
                                    return self.fail_removal(&removal, &error.to_string());
                                }
                            };
                        let (content_name, manifest) = match deletion {
                            Ok(deletion) => deletion,
                            Err(error) => return self.fail_removal(&removal, &error.to_string()),
                        };
                        let owned_torrent_id = torrent_id.to_owned();
                        match tokio::task::spawn_blocking(move || {
                            delete_path_artifacts(
                                &root,
                                &owned_torrent_id,
                                &content_name,
                                &manifest,
                            )
                        })
                        .await
                        {
                            Ok(Ok(())) => self.complete_removal(&removal),
                            Ok(Err(error)) => self.fail_removal(&removal, &error.to_string()),
                            Err(error) => self.fail_removal(
                                &removal,
                                &format!("data cleanup task failed: {error}"),
                            ),
                        }
                    }
                    Some(StorageRootLocation::PlatformCapability) => {
                        self.store_mut()?.set_removal_state(
                            torrent_id,
                            &removal.operation_id,
                            RemovalState::AwaitingPlatform,
                            None,
                        )?;
                        self.refresh_views()
                    }
                    None if self.configured_platform_root(&removal.storage_root)? => {
                        self.store_mut()?.set_removal_state(
                            torrent_id,
                            &removal.operation_id,
                            RemovalState::AwaitingPlatform,
                            None,
                        )?;
                        self.refresh_views()
                    }
                    None => self.fail_removal(
                        &removal,
                        "configured storage root is unavailable for removal",
                    ),
                }
            }
        }
    }

    fn complete_removal(&mut self, removal: &RemovalRecord) -> Result<(), ApplicationError> {
        self.prepare_torrent_runtime_removal(&removal.torrent_id)?;
        self.store_mut()?
            .finalize_removal(&removal.torrent_id, &removal.operation_id)?;
        self.remove_torrent_runtime(&removal.torrent_id, true)?;
        self.refresh_views()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_TORRENT,
            "torrent_removal_completed",
            Some(&removal.torrent_id),
            "Torrent removed from the session",
            &[],
        )?;
        Ok(())
    }

    fn prepare_torrent_runtime_removal(
        &mut self,
        torrent_id: &str,
    ) -> Result<(), ApplicationError> {
        if self.active_download_for(torrent_id).is_some() {
            return Err(ApplicationError::Busy(torrent_id.to_owned()));
        }
        let Some(runtime) = self.torrent_runtimes.get(torrent_id) else {
            return Ok(());
        };
        if runtime.handle().has_seed_registration() {
            return Err(ApplicationError::Configuration(format!(
                "torrent {torrent_id} still owns an incoming seed registration"
            )));
        }
        runtime
            .publish_inactive()
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        runtime.deactivate_peer_events();
        Ok(())
    }

    fn remove_torrent_runtime(
        &mut self,
        torrent_id: &str,
        discard_accounting: bool,
    ) -> Result<(), ApplicationError> {
        self.admitted_seeds.remove(torrent_id);
        self.admission_inactivity.remove(torrent_id);
        let Some(runtime) = self.torrent_runtimes.remove(torrent_id) else {
            return Ok(());
        };
        if discard_accounting {
            self.accounting
                .discard(runtime.handle().identity().torrent_id())
                .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
        }
        Ok(())
    }

    fn fail_removal(&self, removal: &RemovalRecord, message: &str) -> Result<(), ApplicationError> {
        self.store_mut()?.set_removal_state(
            &removal.torrent_id,
            &removal.operation_id,
            RemovalState::Failed,
            Some(message),
        )?;
        self.refresh_views()?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Error,
            category::STORAGE_IO,
            "torrent_removal_failed",
            Some(&removal.torrent_id),
            "Torrent data could not be removed",
            &[("detail", message)],
        )?;
        Ok(())
    }

    async fn start_if_possible(&mut self, torrent_id: &str) -> Result<(), ApplicationError> {
        let _ = torrent_id;
        self.reconcile_admission().await
    }

    async fn start_recheck_if_possible(
        &mut self,
        torrent_id: &str,
    ) -> Result<(), ApplicationError> {
        let _ = torrent_id;
        self.reconcile_admission().await
    }

    async fn reconcile_admission(&mut self) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        if self.session_network.is_none() {
            self.refresh_views()?;
            return Ok(());
        }
        self.maintain_admission_inactivity()?;
        self.maintain_accounting(false)?;
        let snapshot = self.store_mut()?.snapshot()?;
        let effective_download_limit = snapshot
            .client_settings
            .active_downloads
            .min(self.active_download_cap.unwrap_or(u16::MAX));
        let effective_seed_limit = snapshot.client_settings.active_seeds.effective();
        let goal_limits = SeedGoalLimits {
            share_ratio_limit_percent: snapshot.client_settings.share_ratio_limit_percent,
            finished_download_ratio_limit_percent: snapshot
                .client_settings
                .finished_download_ratio_limit_percent,
            finished_time_limit_seconds: snapshot.client_settings.finished_time_limit_seconds,
        };
        let incoming_seeding = self.session_network().incoming_seeding();
        for torrent in &snapshot.torrents {
            self.ensure_torrent_runtime(&torrent.torrent_id)?;
        }
        let mut states = Vec::with_capacity(snapshot.torrents.len());
        let mut checking = Vec::new();
        let mut checking_to_resume = Vec::new();
        for torrent in &snapshot.torrents {
            let resume = match self.load_resume_conservative(&torrent.torrent_id) {
                Ok(resume) => resume,
                Err(error) => {
                    self.store_mut()?
                        .mark_needs_repair(&torrent.torrent_id, &error.to_string())?;
                    continue;
                }
            };
            let is_checking = resume.state == TorrentState::Checking;
            let active = self.active_download_for(&torrent.torrent_id).is_some();
            // Archived torrents are inactive: their pending verification waits
            // for Restore instead of occupying the single checker slot.
            if is_checking && !torrent.archived {
                checking.push((
                    resume.download_queue_position.unwrap_or(i64::MAX),
                    torrent.torrent_id.clone(),
                    active,
                ));
                if active && resume.desired_running {
                    checking_to_resume.push(
                        self.active_download_for(&torrent.torrent_id)
                            .expect("active checker exists")
                            .control
                            .clone(),
                    );
                }
            }
            let runtime = self
                .torrent_runtimes
                .get(&torrent.torrent_id)
                .expect("torrent runtime exists during admission");
            let generation = runtime.generation();
            // A completed selection that has been expanded is deliberately
            // put back on the download queue. It still needs one content
            // generation to promote already-verified boundary bytes from the
            // part file (or fetch newly required pieces) before it is a seed
            // again.
            let complete =
                resume.state == TorrentState::Complete && resume.download_queue_position.is_none();
            let active_seed = complete
                && runtime
                    .handle()
                    .has_current_seed_registration(&incoming_seeding);
            let active_generation = if active_seed || !is_checking && active {
                Some(generation)
            } else {
                None
            };
            let kind = if complete {
                let accounting = self
                    .accounting
                    .current(runtime.handle().identity().torrent_id(), generation)
                    .map_err(|error| ApplicationError::Persistence(error.to_string()))?;
                let total_size = parse_resume_content(&resume)
                    .map(|content| ContentLayout::from_content(&content).total_length())
                    .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
                let live_peers =
                    u32::try_from(runtime.peers().connection_snapshot().len()).unwrap_or(u32::MAX);
                let rank = seed_rank(
                    SeedRankInput {
                        selected_finished: true,
                        full_seed: true,
                        paused: !active_seed,
                        goals: SeedGoalInput {
                            total_uploaded: accounting.total_uploaded,
                            total_downloaded: accounting.total_downloaded,
                            total_size,
                            active_seconds: accounting.active_seconds,
                            finished_seconds: accounting.finished_seconds,
                        },
                        tracker_complete: accounting.tracker_complete,
                        tracker_incomplete: accounting.tracker_incomplete,
                        live_seeds: 0,
                        live_peers,
                    },
                    goal_limits,
                )
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
                TorrentAdmissionKind::Seed { rank }
            } else {
                TorrentAdmissionKind::Download {
                    // A pending-selection magnet without verified metadata needs
                    // one bounded download admission slot before it can present a
                    // catalog. Ordinary magnets retain their durable FIFO rank.
                    // Once pending metadata lands, the missing queue position makes
                    // it ineligible again until atomic confirmation appends it.
                    queue_position: resume.download_queue_position.or_else(|| {
                        (torrent.awaiting_file_selection && resume.raw_info.is_none())
                            .then_some(i64::MAX)
                    }),
                }
            };
            states.push(TorrentAdmissionState {
                torrent_id: torrent.torrent_id.clone(),
                desired_running: resume.desired_running || resume.raw_info.is_none(),
                checking: is_checking,
                blocked: torrent.archived
                    || torrent.removal_state.is_some()
                    || resume.state == TorrentState::AwaitingStorage
                    || matches!(
                        resume.state,
                        TorrentState::NeedsRepair | TorrentState::Error
                    ),
                kind,
                active_generation,
                inactive: active_generation
                    .is_some_and(|_| self.torrent_inactive(&torrent.torrent_id, generation)),
            });
        }

        for control in checking_to_resume {
            control.resume_checking();
        }

        checking.sort_unstable_by(|left, right| (left.0, &left.1).cmp(&(right.0, &right.1)));
        if !checking.iter().any(|(_, _, active)| *active)
            && let Some((_, torrent_id, _)) = checking.first()
        {
            self.start_if_possible_with_mode(torrent_id, true).await?;
        }

        let decisions = TorrentAutoManager::reconcile(
            &states,
            usize::from(effective_download_limit),
            usize::from(effective_seed_limit),
            HARD_ACTIVE_TORRENT_LIMIT,
        );
        for decision in &decisions {
            if !matches!(decision.action, AdmissionAction::Stop { .. }) {
                continue;
            }
            match decision.admission_type {
                TorrentAdmissionType::Download => {
                    self.join_active_content(&decision.torrent_id).await?;
                }
                TorrentAdmissionType::Seed => {
                    self.admitted_seeds.remove(&decision.torrent_id);
                    self.stop_discovery_torrent(&decision.torrent_id).await?;
                    self.unregister_incoming(&decision.torrent_id).await?;
                    if let Some(runtime) = self.torrent_runtimes.get(&decision.torrent_id) {
                        runtime
                            .publish_inactive()
                            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
                    }
                    self.storage_file_pool
                        .invalidate_storage(&decision.torrent_id);
                    self.admission_inactivity.remove(&decision.torrent_id);
                }
            }
        }
        for decision in &decisions {
            if decision.admission_type != TorrentAdmissionType::Seed {
                continue;
            }
            match decision.action {
                AdmissionAction::Retain { .. } => {
                    self.admitted_seeds.insert(decision.torrent_id.clone());
                }
                AdmissionAction::Idle | AdmissionAction::Stop { .. } => {
                    self.admitted_seeds.remove(&decision.torrent_id);
                }
                AdmissionAction::Start => {}
            }
        }
        for decision in decisions {
            if decision.action != AdmissionAction::Start {
                continue;
            }
            match decision.admission_type {
                TorrentAdmissionType::Download => {
                    self.start_if_possible_with_mode(&decision.torrent_id, false)
                        .await?;
                }
                TorrentAdmissionType::Seed => {
                    self.admitted_seeds.insert(decision.torrent_id.clone());
                    if let Err(error) = self.reconcile_incoming_torrent(&decision.torrent_id).await
                    {
                        self.admitted_seeds.remove(&decision.torrent_id);
                        return Err(error);
                    }
                    let registered =
                        self.torrent_runtimes
                            .get(&decision.torrent_id)
                            .is_some_and(|runtime| {
                                runtime
                                    .handle()
                                    .has_current_seed_registration(&incoming_seeding)
                            });
                    if registered {
                        self.reconcile_discovery_torrent(&decision.torrent_id)
                            .await?;
                    } else {
                        self.admitted_seeds.remove(&decision.torrent_id);
                    }
                }
            }
        }
        self.refresh_views()?;
        Ok(())
    }

    async fn start_if_possible_with_mode(
        &mut self,
        torrent_id: &str,
        force_recheck: bool,
    ) -> Result<(), ApplicationError> {
        self.reap_finished().await?;
        self.unregister_incoming(torrent_id).await?;
        if let Some(active) = self.active_download_for(torrent_id) {
            active.control.resume_checking();
            return Ok(());
        }
        let runtime = self.ensure_torrent_runtime(torrent_id)?.handle();
        let torrent_peers = runtime.peers();
        let identity = runtime.identity();
        let resume = match self.load_resume_conservative(torrent_id) {
            Ok(resume) => resume,
            Err(error) => {
                self.store_mut()?
                    .mark_needs_repair(torrent_id, &error.to_string())?;
                return Ok(());
            }
        };
        if resume.state == TorrentState::NeedsRepair
            || (!force_recheck
                && resume.raw_info.is_some()
                && (!resume.desired_running || resume.state == TorrentState::Paused))
        {
            return Ok(());
        }
        if resume.raw_info.is_some() {
            let content = match parse_resume_content(&resume) {
                Ok(content) => content,
                Err(error) => {
                    self.store_mut()?
                        .mark_needs_repair(torrent_id, &error.to_string())?;
                    return Ok(());
                }
            };
            if resume.info_hashes != content.info_hashes() {
                self.store_mut()?.mark_needs_repair(
                    torrent_id,
                    "stored metadata does not match torrent identity",
                )?;
                return Ok(());
            }
        }
        let root = match self.storage_roots.get(&resume.storage_root).cloned() {
            Some(root) => root,
            None => {
                self.store_mut()?.mark_awaiting_storage(
                    torrent_id,
                    Some("configured storage root is unavailable"),
                )?;
                return Ok(());
            }
        };
        let platform_root = matches!(root, StorageRootLocation::PlatformCapability);
        if platform_root && resume.raw_info.is_none() {
            let identity = magnet_runtime_identity(identity, &resume.magnet)?;
            let checkpoints = Arc::new(StoreCheckpointSink {
                store: self.store.clone(),
                storage_roots: self.storage_roots.clone(),
                torrent_id: torrent_id.to_owned(),
                views: self.views.clone(),
                recheck_generation: Mutex::new(None),
                product_milestone_wake: self
                    .product_milestone_drain
                    .as_ref()
                    .map(|drain| drain.wake.clone()),
            });
            let (control, eta_generation) = self.download_control(torrent_id)?;
            let task_control = control.clone();
            let magnet = resume.magnet.clone();
            let continue_downloading = resume.desired_running;
            let root_id = resume.storage_root.clone();
            let storage_id = torrent_id.to_owned();
            let storage_pool = self.storage_file_pool.clone();
            let resource_limits = self.download_resource_limits;
            let network = self.network;
            let peer_budget = self.session_network().peer_budget();
            let mse_dh = self.session_network().mse_dh();
            let encryption = self.session_network().encryption();
            let peer_exchange = self.session_network().peer_exchange();
            let pure_v2 =
                resume.info_hashes.v1_hash().is_none() && resume.info_hashes.v2_hash().is_some();
            let operation = async move {
                let raw_info = download_magnet_metadata_with_external_discovery(
                    ExternalMagnetMetadataDownloadConfig {
                        identity,
                        magnet: magnet.clone(),
                        network,
                        peer_budget: peer_budget.clone(),
                        mse_dh: mse_dh.clone(),
                        encryption: encryption.clone(),
                        peer_exchange: peer_exchange.clone(),
                        torrent_peers: torrent_peers.clone(),
                        resource_limits,
                    },
                    task_control.clone(),
                )
                .await?;
                checkpoints
                    .metadata_verified(&raw_info)
                    .map_err(DownloadError::Checkpoint)?;
                if !continue_downloading {
                    return Ok(ApplicationTaskReport::Metadata);
                }
                let (skip_files, high_priority_files) = {
                    let store = checkpoints.store().map_err(DownloadError::Checkpoint)?;
                    let resume = store
                        .load_resume(&checkpoints.torrent_id)
                        .map_err(|error| DownloadError::Checkpoint(error.to_string()))?;
                    let skip_files = resume
                        .skip_files
                        .into_iter()
                        .map(|index| {
                            usize::try_from(index).map_err(|_| {
                                DownloadError::Checkpoint(
                                    "file selection index overflow".to_owned(),
                                )
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let high_priority_files = resume
                        .high_priority_files
                        .into_iter()
                        .map(|index| {
                            usize::try_from(index).map_err(|_| {
                                DownloadError::Checkpoint("file priority index overflow".to_owned())
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    (skip_files, high_priority_files)
                };
                let content = if pure_v2 {
                    TorrentContent::from_v2_info_bytes_with_limits(&raw_info, BEP9_METAINFO_LIMITS)
                        .map_err(DownloadError::Metainfo)?
                        .content
                } else {
                    TorrentContent::from_v1_metainfo(
                        parse_peer_metainfo(&raw_info).map_err(DownloadError::Metainfo)?,
                    )
                };
                task_control.set_platform_storage(PlatformStorageSpec {
                    pool: storage_pool,
                    root_id,
                    storage_id,
                    content_shape: ContentShape::from_content(&content),
                    content_name: content.name().to_owned(),
                    storage_generation: 0,
                });
                resume_magnet_with_control(
                    ResumableMagnetDownloadConfig {
                        identity,
                        magnet,
                        storage_root: PathBuf::new(),
                        network,
                        peer_budget,
                        mse_dh,
                        encryption,
                        peer_exchange,
                        torrent_peers: Some(torrent_peers),
                        resource_limits,
                        skip_files,
                        high_priority_files,
                        verified_info: Some(raw_info),
                        verified_pieces: Vec::new(),
                        resume_validation: ResumeValidationIntent::FastEligible,
                        download_missing: true,
                        dht: None,
                        trackers: Some(Vec::new()),
                    },
                    checkpoints,
                    task_control,
                )
                .await
                .map(|_| ApplicationTaskReport::Download)
            };
            let task = self.spawn_supervised_task(torrent_id, eta_generation, operation)?;
            self.install_active_download(
                torrent_id,
                ActiveDownload {
                    control,
                    task,
                    eta_generation,
                },
            )?;
            return Ok(());
        }
        let root_path = match &root {
            StorageRootLocation::Path(root) => root.clone(),
            StorageRootLocation::PlatformCapability => PathBuf::new(),
        };
        if resume.raw_info.is_none() && !resume.desired_running {
            let checkpoints = Arc::new(StoreCheckpointSink {
                store: self.store.clone(),
                storage_roots: self.storage_roots.clone(),
                torrent_id: torrent_id.to_owned(),
                views: self.views.clone(),
                recheck_generation: Mutex::new(None),
                product_milestone_wake: self
                    .product_milestone_drain
                    .as_ref()
                    .map(|drain| drain.wake.clone()),
            });
            let (control, eta_generation) = self.download_control(torrent_id)?;
            let task_control = control.clone();
            let magnet = resume.magnet;
            let network = self.network;
            let resource_limits = self.download_resource_limits;
            let peer_budget = self.session_network().peer_budget();
            let mse_dh = self.session_network().mse_dh();
            let encryption = self.session_network().encryption();
            let peer_exchange = self.session_network().peer_exchange();
            let operation = async move {
                let raw_info = download_magnet_metadata_with_external_discovery(
                    ExternalMagnetMetadataDownloadConfig {
                        identity,
                        magnet,
                        network,
                        peer_budget,
                        mse_dh,
                        encryption,
                        peer_exchange,
                        torrent_peers,
                        resource_limits,
                    },
                    task_control,
                )
                .await?;
                checkpoints
                    .metadata_verified(&raw_info)
                    .map_err(DownloadError::Checkpoint)?;
                Ok(ApplicationTaskReport::Metadata)
            };
            let task = self.spawn_supervised_task(torrent_id, eta_generation, operation)?;
            self.install_active_download(
                torrent_id,
                ActiveDownload {
                    control,
                    task,
                    eta_generation,
                },
            )?;
            return Ok(());
        }
        let skip_files = resume
            .skip_files
            .iter()
            .map(|index| {
                usize::try_from(*index).map_err(|_| {
                    ApplicationError::Configuration("file selection index overflow".to_owned())
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let high_priority_files = resume
            .high_priority_files
            .iter()
            .map(|index| {
                usize::try_from(*index).map_err(|_| {
                    ApplicationError::Configuration("file priority index overflow".to_owned())
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let verified_pieces = resume
            .have
            .as_ref()
            .map_or_else(Vec::new, |have| have.pieces().to_vec());
        let resume_validation = if resume.verification.is_pending() {
            ResumeValidationIntent::Full
        } else {
            ResumeValidationIntent::FastEligible
        };
        let checkpoints: Arc<dyn DownloadCheckpointSink> = Arc::new(StoreCheckpointSink {
            store: self.store.clone(),
            storage_roots: self.storage_roots.clone(),
            torrent_id: torrent_id.to_owned(),
            views: self.views.clone(),
            recheck_generation: Mutex::new(None),
            product_milestone_wake: self
                .product_milestone_drain
                .as_ref()
                .map(|drain| drain.wake.clone()),
        });
        let (control, eta_generation) = self.download_control(torrent_id)?;
        let parsed_content = resume
            .raw_info
            .as_ref()
            .map(|_| parse_resume_content(&resume))
            .transpose()
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        if platform_root {
            let content = parsed_content
                .as_ref()
                .expect("platform content start requires verified metadata");
            control.set_platform_storage(PlatformStorageSpec {
                pool: self.storage_file_pool.clone(),
                root_id: resume.storage_root.clone(),
                storage_id: torrent_id.to_owned(),
                content_shape: ContentShape::from_content(content),
                content_name: content.name().to_owned(),
                storage_generation: 0,
            });
        }
        let common_peer_budget = self.session_network().peer_budget();
        let common_mse_dh = self.session_network().mse_dh();
        let common_encryption = self.session_network().encryption();
        let common_peer_exchange = self.session_network().peer_exchange();
        let has_v2_metainfo =
            resume.info_hashes.v2_hash().is_some() && resume.metainfo_source.is_some();
        let config = if has_v2_metainfo {
            ResumableDownloadConfig::Metainfo(ResumableMetainfoDownloadConfig {
                identity,
                metainfo_source: resume.metainfo_source.ok_or_else(|| {
                    ApplicationError::Configuration(
                        "v2 runtime requires complete metainfo source".to_owned(),
                    )
                })?,
                storage_root: root_path,
                network: self.network,
                peer_budget: common_peer_budget,
                mse_dh: common_mse_dh,
                encryption: common_encryption,
                peer_exchange: common_peer_exchange,
                torrent_peers: Some(torrent_peers),
                resource_limits: self.download_resource_limits,
                skip_files,
                high_priority_files,
                verified_pieces,
                resume_validation,
                download_missing: resume.desired_running,
                dht: None,
                trackers: Some(Vec::new()),
            })
        } else {
            let identity = magnet_runtime_identity(identity, &resume.magnet)?;
            ResumableDownloadConfig::Magnet(ResumableMagnetDownloadConfig {
                identity,
                magnet: resume.magnet,
                storage_root: root_path,
                network: self.network,
                peer_budget: common_peer_budget,
                mse_dh: common_mse_dh,
                encryption: common_encryption,
                peer_exchange: common_peer_exchange,
                torrent_peers: Some(torrent_peers),
                resource_limits: self.download_resource_limits,
                skip_files,
                high_priority_files,
                verified_info: resume.raw_info,
                verified_pieces,
                resume_validation,
                download_missing: resume.desired_running,
                dht: None,
                trackers: Some(Vec::new()),
            })
        };
        let task_control = control.clone();
        let operation = async move {
            match config {
                ResumableDownloadConfig::Magnet(config) => {
                    resume_magnet_with_control(config, checkpoints, task_control).await
                }
                ResumableDownloadConfig::Metainfo(config) => {
                    resume_metainfo_with_control(config, checkpoints, task_control).await
                }
            }
            .map(|_| ApplicationTaskReport::Download)
        };
        let task = self.spawn_supervised_task(torrent_id, eta_generation, operation)?;
        self.install_active_download(
            torrent_id,
            ActiveDownload {
                control,
                task,
                eta_generation,
            },
        )?;
        Ok(())
    }

    fn download_control(
        &self,
        torrent_id: &str,
    ) -> Result<(DownloadControl, u64), ApplicationError> {
        let eta_generation = self.views.reserve_eta_generation(torrent_id)?;
        let control = DownloadControl::new_with_cancellation(
            self.network_prerequisite
                .cancellation_token(self.effective_network_prerequisite),
        );
        let runtime = self
            .torrent_runtimes
            .get(torrent_id)
            .ok_or_else(|| ApplicationError::Configuration("torrent runtime is absent".into()))?
            .handle();
        let runtime_generation = runtime.generation();
        let storage_root = self.load_resume_conservative(torrent_id)?.storage_root;
        control.set_session_resources(self.session_download_resources.register(
            torrent_id,
            runtime_generation,
            &storage_root,
        ));
        control.set_storage_file_pool(self.storage_file_pool.clone());
        if let Some(directory) = self.path_part_directory.clone() {
            control.set_path_part_directory(directory);
        }
        control.set_incoming_peer_handle(self.session_network().incoming_peer_handle());
        if let Some(utp) = self.session_network().utp_handle() {
            control.set_utp_handle(utp);
        }
        control.set_incoming_route_wake(self.discovery_wake.clone());
        control.set_storage_write_delay(self.storage_write_delay_for_testing);
        control.set_storage_hash_delay(self.storage_hash_delay_for_testing);
        control
            .set_storage_execution_limits_for_testing(
                self.storage_write_concurrency_for_testing,
                self.storage_hash_concurrency_for_testing,
            )
            .expect("application configuration validated diagnostic storage limits");
        control.set_checkpoint_sync_delay_for_testing(self.checkpoint_sync_delay_for_testing);
        control.set_checkpoint_commit_delay_for_testing(self.checkpoint_commit_delay_for_testing);
        let activity = self.view_activity_sink(torrent_id, Some(eta_generation));
        control.set_activity_sink(activity.clone());
        control.set_mse_handshake_sink(activity);
        control.set_byte_metric_sink(
            runtime.accounting_metric_sink(Some(self.speed_recorder.clone())),
        );
        control.set_incoming_payload_metric_sink(runtime.accounting_metric_sink(None));
        Ok((control, eta_generation))
    }

    fn spawn_supervised_task<F>(
        &self,
        torrent_id: &str,
        eta_generation: u64,
        operation: F,
    ) -> Result<JoinHandle<Result<(), String>>, ApplicationError>
    where
        F: Future<Output = Result<ApplicationTaskReport, DownloadError>> + Send + 'static,
    {
        self.views.set_progress_inputs(
            torrent_id,
            ProgressInputs {
                task_active: true,
                ..ProgressInputs::default()
            },
        )?;
        self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::LIFECYCLE_TORRENT,
            "engine_task_started",
            Some(torrent_id),
            "Engine task started",
            &[],
        )?;
        if let Err(error) =
            self.views
                .activate_eta_generation(torrent_id, eta_generation, Instant::now())
        {
            let _ = self
                .views
                .set_progress_inputs(torrent_id, ProgressInputs::default());
            return Err(error.into());
        }
        let store = self.store.clone();
        let storage_roots = self.storage_roots.clone();
        let admission_wake = self.admission_wake.clone();
        let views = self.views.clone();
        let torrent_id = torrent_id.to_owned();
        Ok(tokio::spawn(async move {
            let outcome = operation.await;
            let result = handle_task_outcome(&store, &storage_roots, &views, &torrent_id, outcome);
            admission_wake.notify_one();
            result
        }))
    }

    fn load_resume_conservative(&self, torrent_id: &str) -> Result<ResumeRecord, ApplicationError> {
        let mut store = self.store_mut()?;
        let mut resume = match store.load_resume(torrent_id) {
            Ok(resume) => resume,
            Err(StoreError::Have(_)) => {
                store.reset_have_from_metadata(torrent_id)?;
                store.load_resume(torrent_id)?
            }
            Err(error) => return Err(error.into()),
        };
        drop(store);
        if !self.storage_roots.contains_key(&resume.storage_root)
            && !matches!(
                resume.state,
                TorrentState::AwaitingMetadata | TorrentState::NeedsRepair
            )
        {
            resume.state = TorrentState::AwaitingStorage;
        }
        Ok(resume)
    }

    async fn pause(&mut self, torrent_id: &str) -> Result<(), ApplicationError> {
        self.unregister_incoming(torrent_id).await?;
        let checker_retained = self
            .active_download_for(torrent_id)
            .is_some_and(|active| active.control.pause_checking());
        let result = if checker_retained {
            Ok(())
        } else {
            self.join_active_content(torrent_id).await
        };
        let incoming = self.reconcile_incoming_torrent(torrent_id).await;
        result.and(incoming)
    }

    async fn join_active_content(&mut self, torrent_id: &str) -> Result<(), ApplicationError> {
        if self.active_download_for(torrent_id).is_none() {
            return Ok(());
        }
        self.views.set_stopping(torrent_id, true)?;
        let active = self
            .take_active_download(torrent_id)
            .expect("active download remains installed until it is taken");
        let eta_generation = active.eta_generation;
        active.control.cancel_when_safe();
        let result = match active.task.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(ApplicationError::Join(error)),
            Err(error) if error.is_cancelled() => Ok(()),
            Err(error) => Err(ApplicationError::Join(error.to_string())),
        };
        active.control.release_session_resources();
        let eta_result = self
            .views
            .deactivate_eta_generation(torrent_id, eta_generation)
            .map_err(ApplicationError::from);
        let stopping_result = self
            .views
            .set_stopping(torrent_id, false)
            .map_err(ApplicationError::from);
        result.and(eta_result).and(stopping_result)
    }

    async fn reap_finished(&mut self) -> Result<(), ApplicationError> {
        self.reconcile_platform_root_failures().await?;
        let reconciliations = self.store_mut()?.take_pending_reconciliations();
        for reconciliation in reconciliations {
            self.media.revoke_torrent(&reconciliation.loser);
            self.stop_discovery_torrent(&reconciliation.loser).await?;
            self.unregister_incoming(&reconciliation.loser).await?;
            let _joined = self.join_active_content(&reconciliation.loser).await;
            self.remove_torrent_runtime(&reconciliation.loser, true)?;
            self.stop_discovery_torrent(&reconciliation.winner).await?;
            self.unregister_incoming(&reconciliation.winner).await?;
            let _joined = self.join_active_content(&reconciliation.winner).await;
            self.remove_torrent_runtime(&reconciliation.winner, false)?;
            self.views.record_diagnostic(
                DiagnosticSeverity::Info,
                category::METADATA_EXCHANGE,
                "hybrid_owner_reconciled",
                Some(&reconciliation.winner),
                "Authenticated hybrid aliases reconciled into the older torrent owner",
                &[],
            )?;
        }
        let finished = self
            .torrent_runtimes
            .iter()
            .filter(|(_, runtime)| {
                runtime
                    .active_download()
                    .is_some_and(|active| active.task.is_finished())
            })
            .map(|(torrent_id, _)| torrent_id.clone())
            .collect::<Vec<_>>();
        let mut first_error = None;
        for torrent_id in finished {
            let active = self
                .take_active_download(&torrent_id)
                .expect("finished active task exists");
            let eta_generation = active.eta_generation;
            let result = match active.task.await {
                Ok(Ok(())) => {
                    if let Some(runtime) = self.torrent_runtimes.get(&torrent_id) {
                        runtime.handle().set_completed_storage_evidence(
                            active.control.take_completed_storage_evidence(),
                        );
                    }
                    Ok(())
                }
                Ok(Err(error)) => Err(ApplicationError::Join(error)),
                Err(error) if error.is_cancelled() => Ok(()),
                Err(error) => Err(ApplicationError::Join(error.to_string())),
            };
            active.control.release_session_resources();
            let eta_result = self
                .views
                .deactivate_eta_generation(&torrent_id, eta_generation)
                .map_err(ApplicationError::from);
            if let Err(error) = result.and(eta_result)
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    async fn unregister_incoming(&mut self, torrent_id: &str) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        let runtime = self
            .torrent_runtimes
            .get(torrent_id)
            .map(TorrentRuntime::handle);
        if let Some(runtime) = runtime {
            let incoming = self.session_network().incoming_seeding();
            runtime
                .unregister_seed(&incoming)
                .await
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        }
        Ok(())
    }

    async fn reconcile_incoming_torrent(
        &mut self,
        torrent_id: &str,
    ) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        self.ensure_torrent_runtime(torrent_id)?;
        let runtime = self
            .torrent_runtimes
            .get(torrent_id)
            .expect("torrent runtime exists during seed reconciliation")
            .handle();
        let incoming = self.session_network().incoming_seeding();
        let prepared = {
            let store = self.store_mut()?;
            seed_reconcile_inputs(&store, &self.storage_roots, torrent_id)?
        };
        let Some(prepared) = prepared else {
            runtime
                .unregister_seed(&incoming)
                .await
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
            runtime
                .publish_inactive()
                .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
            return Ok(());
        };
        let active = self.active_download_for(torrent_id).is_some();
        let complete_admitted =
            prepared.0.state != TorrentState::Complete || self.admitted_seeds.contains(torrent_id);
        let outcome = runtime
            .reconcile_seed(
                &incoming,
                &prepared.0,
                prepared.1 && complete_admitted,
                prepared.2.as_ref(),
                active,
                &self.storage_file_pool,
            )
            .await
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        if let Some(outcome) = outcome {
            record_seed_reconcile(&self.views, torrent_id, &outcome)?;
            let start_checker = apply_seed_reconcile_state(
                &self.store,
                &self.storage_roots,
                &self.views,
                torrent_id,
                &outcome,
            )
            .map_err(ApplicationError::Configuration)?;
            if start_checker {
                self.admission_wake.notify_one();
            }
        }
        Ok(())
    }

    async fn reconcile_incoming_catalog(&mut self) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        let torrent_ids = self
            .store_mut()?
            .snapshot()?
            .torrents
            .into_iter()
            .map(|torrent| torrent.torrent_id)
            .collect::<Vec<_>>();
        for torrent_id in torrent_ids {
            self.reconcile_incoming_torrent(&torrent_id).await?;
        }
        Ok(())
    }

    async fn reconcile_discovery_torrent(
        &mut self,
        torrent_id: &str,
    ) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        self.ensure_torrent_runtime(torrent_id)?;
        let (resume, catalog_eligible) = {
            let store = self.store_mut()?;
            let resume = match store.load_resume(torrent_id) {
                Ok(resume) => resume,
                Err(StoreError::UnknownTorrent(_)) => return Ok(()),
                Err(error) => return Err(error.into()),
            };
            let snapshot = store.snapshot()?;
            let eligible = snapshot.torrents.iter().any(|torrent| {
                torrent.torrent_id == torrent_id
                    && !torrent.archived
                    && torrent.removal_state.is_none()
            });
            (resume, eligible)
        };
        let runtime = self
            .torrent_runtimes
            .get(torrent_id)
            .expect("torrent runtime exists during discovery reconciliation");
        let complete = resume.state == TorrentState::Complete;
        if !catalog_eligible || complete && !self.admitted_seeds.contains(torrent_id) {
            return self.stop_discovery_torrent(torrent_id).await;
        }
        let handle = runtime.handle();
        let counters = handle.tracker_counters();
        let (privacy, left) = tracker_metadata_state(&resume)?;
        let admitted_download = !complete
            && resume.state != TorrentState::Checking
            && self.active_download_for(torrent_id).is_some();
        let active_incoming_routable = admitted_download
            && self
                .active_download_for(torrent_id)
                .is_some_and(|active| active.control.incoming_content_routable());
        counters.set_left(left);
        let registration = DiscoveryAdvertisementRegistration {
            generation: runtime.generation(),
            info_hash: handle.identity().swarm_key().into_bytes(),
            info_hashes: handle.identity().info_hashes(),
            trackers: operational_trackers(&resume.trackers)?,
            desired_running: if complete {
                resume.desired_running
            } else {
                admitted_download
            },
            complete,
            incoming_routable: handle.has_seed_registration() || active_incoming_routable,
            privacy,
            counters,
            peers: runtime.peers(),
            activity_sink: self.view_activity_sink(torrent_id, None),
        };
        self.session_network()
            .discovery_handle()
            .upsert(registration)
            .await
            .map_err(|error| {
                ApplicationError::Configuration(format!("discovery advertisement: {error}"))
            })
    }

    async fn reconcile_discovery_catalog(&mut self) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        let torrent_ids = self
            .store_mut()?
            .snapshot()?
            .torrents
            .into_iter()
            .map(|torrent| torrent.torrent_id)
            .collect::<Vec<_>>();
        for torrent_id in torrent_ids {
            self.reconcile_discovery_torrent(&torrent_id).await?;
        }
        Ok(())
    }

    async fn stop_discovery_torrent(&self, torrent_id: &str) -> Result<(), ApplicationError> {
        if self.session_network.is_none() {
            return Ok(());
        }
        let Some(runtime) = self.torrent_runtimes.get(torrent_id) else {
            return Ok(());
        };
        let info_hash = runtime.handle().identity().swarm_key().into_bytes();
        self.session_network()
            .discovery_handle()
            .remove(info_hash, runtime.generation())
            .await
            .map_err(|error| {
                ApplicationError::Configuration(format!("discovery advertisement: {error}"))
            })
    }

    fn refresh_views(&self) -> Result<(), ApplicationError> {
        let (snapshot, mut durable) = {
            let store = self.store_mut()?;
            durable_view_state(&store, &self.storage_roots)?
        };
        let goal_limits = SeedGoalLimits {
            share_ratio_limit_percent: snapshot.client_settings.share_ratio_limit_percent,
            finished_download_ratio_limit_percent: snapshot
                .client_settings
                .finished_download_ratio_limit_percent,
            finished_time_limit_seconds: snapshot.client_settings.finished_time_limit_seconds,
        };
        let mut active_seed_count = 0_usize;
        let mut inactive_seed_count = 0_usize;
        for torrent in &snapshot.torrents {
            let Some(state) = durable.get_mut(&torrent.torrent_id) else {
                continue;
            };
            let accounting = if let Some(runtime) = self.torrent_runtimes.get(&torrent.torrent_id) {
                self.accounting
                    .current(
                        runtime.handle().identity().torrent_id(),
                        runtime.generation(),
                    )
                    .map_err(|error| ApplicationError::Persistence(error.to_string()))?
            } else {
                continue;
            };
            state.lifetime = torrent_lifetime_view(accounting, state.total_size);
            if torrent.state != TorrentState::Complete || torrent.download_queue_position.is_some()
            {
                continue;
            }
            state.seeding.goal = Some(torrent_seed_goal_view(
                accounting,
                state.total_size,
                goal_limits,
            )?);
            state.seeding.admission = if self.admitted_seeds.contains(&torrent.torrent_id) {
                let inactive =
                    self.torrent_runtimes
                        .get(&torrent.torrent_id)
                        .is_some_and(|runtime| {
                            self.torrent_inactive(&torrent.torrent_id, runtime.generation())
                        });
                if inactive {
                    inactive_seed_count = inactive_seed_count.saturating_add(1);
                    crate::SeedAdmissionView::InactiveExempt
                } else {
                    active_seed_count = active_seed_count.saturating_add(1);
                    crate::SeedAdmissionView::Active
                }
            } else if torrent.desired_running
                && !torrent.archived
                && torrent.removal_state.is_none()
            {
                crate::SeedAdmissionView::Queued
            } else {
                crate::SeedAdmissionView::Ineligible
            };
        }
        self.views.replace_durable(&snapshot, &durable)?;
        let configured_limit = snapshot.client_settings.active_downloads;
        let effective_limit = configured_limit.min(self.active_download_cap.unwrap_or(u16::MAX));
        let clamp_reason = (effective_limit != configured_limit)
            .then_some(crate::ActiveDownloadsClampReason::PlatformLimit);
        let mut active_download_count = 0_usize;
        let mut checking_count = 0_usize;
        for torrent in &snapshot.torrents {
            if self.active_download_for(&torrent.torrent_id).is_none() {
                continue;
            }
            if torrent.state == TorrentState::Checking {
                checking_count = checking_count.saturating_add(1);
            } else {
                active_download_count = active_download_count.saturating_add(1);
            }
        }
        self.views.set_download_admission_state(
            effective_limit,
            clamp_reason,
            u16::try_from(active_download_count).unwrap_or(u16::MAX),
            u16::try_from(checking_count).unwrap_or(u16::MAX),
        )?;
        self.views.set_seed_admission_state(
            snapshot.client_settings.active_seeds,
            u16::try_from(active_seed_count).unwrap_or(u16::MAX),
            u16::try_from(inactive_seed_count).unwrap_or(u16::MAX),
        )?;
        self.views
            .set_waiting_for_unmetered_network(!self.network_prerequisite.load().is_allowed())?;
        Ok(())
    }

    fn view_activity_sink(
        &self,
        torrent_id: &str,
        eta_generation: Option<u64>,
    ) -> Arc<ViewActivitySink> {
        let runtime = self
            .torrent_runtimes
            .get(torrent_id)
            .expect("torrent runtime exists before its activity sink")
            .handle();
        Arc::new(ViewActivitySink {
            torrent_id: torrent_id.to_owned(),
            durable_torrent_id: runtime.identity().torrent_id(),
            torrent_generation: runtime.generation(),
            accounting: runtime.accounting(),
            eta_generation,
            views: self.views.clone(),
            trace_checkpoint_stages: self.checkpoint_stage_trace_for_testing,
            last_checkpoint_stage: Mutex::new(None),
        })
    }
}

impl MseHandshakeSink for ViewActivitySink {
    fn record(&self, observation: MseHandshakeObservation) {
        let role = match observation.role {
            rstorrent_protocol::mse::MseRole::Initiator => "initiator",
            rstorrent_protocol::mse::MseRole::Responder => "responder",
        };
        let policy = match observation.policy {
            PeerEncryptionPolicy::Disabled => "disabled",
            PeerEncryptionPolicy::Allow => "allow",
            PeerEncryptionPolicy::Prefer => "prefer",
            PeerEncryptionPolicy::Required => "required",
        };
        let (severity, code, message, outcome, detail) = match observation.outcome {
            MseHandshakeOutcome::Negotiated(method) => {
                let method = match method {
                    rstorrent_protocol::mse::MseMethod::PlaintextPayload => "plaintext_payload",
                    rstorrent_protocol::mse::MseMethod::Rc4 => "rc4",
                };
                (
                    DiagnosticSeverity::Info,
                    "mse_handshake_negotiated",
                    "Peer stream obfuscation negotiated",
                    "negotiated",
                    method,
                )
            }
            MseHandshakeOutcome::Failed(failure) => (
                if observation.fallback_socket_used {
                    DiagnosticSeverity::Info
                } else {
                    DiagnosticSeverity::Warning
                },
                "mse_handshake_failed",
                "Peer stream obfuscation handshake ended",
                "failed",
                failure.code(),
            ),
        };
        let total_wire = observation
            .wire_bytes_sent
            .saturating_add(observation.wire_bytes_received);
        let classified = observation
            .protocol_bytes_sent
            .saturating_add(observation.protocol_bytes_received)
            .saturating_add(observation.carried_wire_bytes);
        self.record_structured(
            severity,
            category::PEER_PROTOCOL,
            code,
            message,
            Vec::new(),
            vec![
                DiagnosticField::text("role", role),
                DiagnosticField::text("policy", policy),
                DiagnosticField::text("outcome", outcome),
                DiagnosticField::text("detail", detail),
                DiagnosticField::text(
                    "fallback_socket_used",
                    observation.fallback_socket_used.to_string(),
                ),
                DiagnosticField::bytes("wire_bytes_sent", observation.wire_bytes_sent),
                DiagnosticField::bytes("wire_bytes_received", observation.wire_bytes_received),
                DiagnosticField::bytes("protocol_bytes_sent", observation.protocol_bytes_sent),
                DiagnosticField::bytes(
                    "protocol_bytes_received",
                    observation.protocol_bytes_received,
                ),
                DiagnosticField::bytes("carried_wire_bytes", observation.carried_wire_bytes),
                DiagnosticField::bytes("mse_overhead_bytes", total_wire.saturating_sub(classified)),
                DiagnosticField::count("exponentiations", u64::from(observation.exponentiations)),
            ],
        );
    }
}

fn tracker_metadata_state(
    resume: &ResumeRecord,
) -> Result<(TorrentPrivacy, u64), ApplicationError> {
    if resume.raw_info.is_none() {
        return Ok((
            TorrentPrivacy::Unknown,
            rstorrent_engine::UNKNOWN_METADATA_LEFT_BYTES,
        ));
    }
    let Ok(content) = parse_resume_content(resume) else {
        // Discovery must not make startup less conservative than the storage
        // recovery path. Corrupt metadata has no trustworthy privacy or size
        // state, so retain tracker-only premetadata behavior and suppress DHT.
        return Ok((
            TorrentPrivacy::Unknown,
            rstorrent_engine::UNKNOWN_METADATA_LEFT_BYTES,
        ));
    };
    let privacy = if content.private() {
        TorrentPrivacy::Private
    } else {
        TorrentPrivacy::Public
    };
    if resume.state == TorrentState::Complete {
        return Ok((privacy, 0));
    }
    let layout = ContentLayout::from_content(&content);
    let skipped = resume
        .skip_files
        .iter()
        .map(|index| usize::try_from(*index))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ApplicationError::Configuration("file index overflow".to_owned()))?;
    let selection = FileSelection::new_content(&layout, &skipped)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    let verified = resume.have.as_ref().map(HaveState::pieces);
    let mut left = 0_u64;
    for piece_index in 0..layout.piece_count() {
        if verified.is_some_and(|pieces| pieces.get(piece_index).copied().unwrap_or(false)) {
            continue;
        }
        let piece_index = u32::try_from(piece_index)
            .map_err(|_| ApplicationError::Configuration("piece index overflow".to_owned()))?;
        for range in layout
            .request_ranges(piece_index, &selection)
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?
        {
            left = left.saturating_add(u64::from(range.length));
        }
    }
    Ok((privacy, left))
}

impl Drop for ApplicationService {
    fn drop(&mut self) {
        self.media.revoke_all();
        self.maintenance_cancellation.cancel();
        if let Some(task) = self.maintenance_task.take() {
            task.abort();
        }
        for runtime in self.torrent_runtimes.values() {
            if let Some(active) = runtime.active_download() {
                active.control.cancel();
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DirectPayloadManifest {
    tree: bool,
    files: Vec<PlatformRemovalPath>,
    directories: Vec<PlatformRemovalPath>,
}

#[derive(Debug)]
struct PreparedDirectPayloadRemoval {
    files: Vec<PathBuf>,
    directories: Vec<PathBuf>,
}

fn direct_payload_manifest(
    content: &TorrentContent,
) -> Result<DirectPayloadManifest, ApplicationError> {
    let layout = DirectContentLayout::from_content(content)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    let tree = layout.shape == ContentShape::Tree;
    let files = layout
        .files
        .into_iter()
        .filter(|file| !file.padding)
        .map(|file| PlatformRemovalPath {
            components: if tree { file.components } else { Vec::new() },
        })
        .collect::<Vec<_>>();
    let mut directories = BTreeSet::new();
    if tree {
        directories.insert(Vec::new());
        for file in &files {
            for length in 1..file.components.len() {
                directories.insert(file.components[..length].to_vec());
            }
        }
    }
    let mut directories = directories
        .into_iter()
        .map(|components| PlatformRemovalPath { components })
        .collect::<Vec<_>>();
    directories.sort_by(|left, right| {
        right
            .components
            .len()
            .cmp(&left.components.len())
            .then_with(|| left.components.cmp(&right.components))
    });
    Ok(DirectPayloadManifest {
        tree,
        files,
        directories,
    })
}

fn delete_path_artifacts(
    root: &Path,
    torrent_id: &str,
    content_name: &str,
    manifest: &DirectPayloadManifest,
) -> Result<(), ApplicationError> {
    let torrent_id = torrent_id
        .parse::<TorrentId>()
        .map_err(|_| ApplicationError::Configuration("invalid torrent identity".to_owned()))?;
    let paths = torrent_storage_paths(root, content_name, torrent_id)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    let prepared_payload = preflight_direct_payload(&paths.content, manifest)?;
    let prepared_part = preflight_direct_file(&paths.part)?;
    if let Some(payload) = prepared_payload {
        remove_preflighted_payload(payload)?;
    }
    if let Some(part) = prepared_part {
        std::fs::remove_file(part).map_err(|source| ApplicationError::Io {
            operation: "remove torrent part file",
            source,
        })?;
    }
    Ok(())
}
fn preflight_direct_payload(
    namespace: &Path,
    manifest: &DirectPayloadManifest,
) -> Result<Option<PreparedDirectPayloadRemoval>, ApplicationError> {
    let metadata = match std::fs::symlink_metadata(namespace) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(ApplicationError::Io {
                operation: "inspect torrent data directory",
                source,
            });
        }
    };
    if metadata.file_type().is_symlink()
        || if manifest.tree {
            !metadata.is_dir()
        } else {
            !metadata.is_file()
        }
    {
        return Err(ApplicationError::Configuration(format!(
            "torrent data artifact has an unexpected type: {}",
            namespace.display()
        )));
    }
    if !manifest.tree {
        return Ok(Some(PreparedDirectPayloadRemoval {
            files: vec![namespace.to_path_buf()],
            directories: Vec::new(),
        }));
    }
    let mut exact_files = Vec::new();
    for file in &manifest.files {
        if let Some(path) = validate_exact_payload_file(namespace, &file.components)? {
            exact_files.push(path);
        }
    }
    let directories = manifest
        .directories
        .iter()
        .map(|directory| {
            directory
                .components
                .iter()
                .fold(namespace.to_path_buf(), |path, component| {
                    path.join(component)
                })
        })
        .collect();
    Ok(Some(PreparedDirectPayloadRemoval {
        files: exact_files,
        directories,
    }))
}

fn remove_preflighted_payload(
    prepared: PreparedDirectPayloadRemoval,
) -> Result<(), ApplicationError> {
    for path in prepared.files {
        std::fs::remove_file(path).map_err(|source| ApplicationError::Io {
            operation: "remove torrent payload file",
            source,
        })?;
    }
    for directory in prepared.directories {
        remove_empty_payload_directory(&directory)?;
    }
    Ok(())
}

fn resolve_expected_payload_path(
    namespace: &Path,
    components: &[String],
) -> Result<Option<PathBuf>, ApplicationError> {
    let mut path = namespace.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        path.push(component);
        if index + 1 == components.len() {
            break;
        }
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err(ApplicationError::Configuration(format!(
                    "torrent payload parent has an unexpected type: {}",
                    path.display()
                )));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(ApplicationError::Io {
                    operation: "inspect torrent payload parent",
                    source,
                });
            }
        }
    }
    Ok(Some(path))
}

fn validate_exact_payload_file(
    namespace: &Path,
    components: &[String],
) -> Result<Option<PathBuf>, ApplicationError> {
    let Some(path) = resolve_expected_payload_path(namespace, components)? else {
        return Ok(None);
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(ApplicationError::Io {
                operation: "inspect torrent payload file",
                source,
            });
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApplicationError::Configuration(format!(
            "torrent payload file has an unexpected type: {}",
            path.display()
        )));
    }
    Ok(Some(path))
}

fn remove_empty_payload_directory(path: &Path) -> Result<(), ApplicationError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(ApplicationError::Io {
                operation: "inspect torrent payload directory",
                source,
            });
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ApplicationError::Configuration(format!(
            "torrent payload directory has an unexpected type: {}",
            path.display()
        )));
    }
    match std::fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(source) => Err(ApplicationError::Io {
            operation: "remove empty torrent payload directory",
            source,
        }),
    }
}

fn preflight_direct_file(path: &Path) -> Result<Option<PathBuf>, ApplicationError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(ApplicationError::Io {
                operation: "inspect torrent part file",
                source,
            });
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApplicationError::Configuration(format!(
            "torrent part-file path has an unexpected type: {}",
            path.display()
        )));
    }
    Ok(Some(path.to_path_buf()))
}

type SeedReconcileInputs = (ResumeRecord, bool, Option<StorageRootLocation>);

fn seed_reconcile_inputs(
    store: &SessionStore,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
    torrent_id: &str,
) -> Result<Option<SeedReconcileInputs>, StoreError> {
    let resume = match store.load_resume(torrent_id) {
        Ok(resume) => resume,
        Err(StoreError::UnknownTorrent(_)) => return Ok(None),
        Err(error) => return Err(error),
    };
    let snapshot = store.snapshot()?;
    let catalog_eligible = snapshot.torrents.iter().any(|torrent| {
        torrent.torrent_id == torrent_id && !torrent.archived && torrent.removal_state.is_none()
    });
    let root = storage_roots.get(&resume.storage_root).cloned();
    Ok(Some((resume, catalog_eligible, root)))
}

fn record_seed_reconcile(
    views: &ViewHub,
    torrent_id: &str,
    outcome: &SeedReconcileOutcome,
) -> Result<(), SubscriptionError> {
    match outcome {
        SeedReconcileOutcome::Registered {
            validation,
            elapsed_millis,
        } => {
            let committed_pieces = validation.committed_pieces.to_string();
            let relevant_files = validation.relevant_files.to_string();
            let artifact_observations = validation.artifact_observations.to_string();
            let part_header_bytes = validation.part_header_bytes.to_string();
            let elapsed_millis = elapsed_millis.to_string();
            views.record_diagnostic(
                DiagnosticSeverity::Info,
                category::PEER_CONNECTION,
                "incoming_seed_fast_resume_accepted",
                Some(torrent_id),
                "Completed torrent structurally validated and registered for incoming seeding",
                &[
                    ("committed_pieces", &committed_pieces),
                    ("relevant_files", &relevant_files),
                    ("artifact_observations", &artifact_observations),
                    ("part_header_bytes", &part_header_bytes),
                    ("validation_elapsed_millis", &elapsed_millis),
                    ("payload_bytes_read", "0"),
                    ("hash_jobs", "0"),
                ],
            )
        }
        SeedReconcileOutcome::Unregistered => views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::PEER_CONNECTION,
            "incoming_seed_unregistered",
            Some(torrent_id),
            "Torrent removed from incoming seeding",
            &[],
        ),
        SeedReconcileOutcome::Unavailable(detail) => views.record_diagnostic(
            DiagnosticSeverity::Warning,
            category::PEER_CONNECTION,
            "incoming_seed_unavailable",
            Some(torrent_id),
            "Completed torrent could not be registered for incoming seeding",
            &[("detail", detail)],
        ),
        SeedReconcileOutcome::NeedsFullCheck {
            reason,
            validation,
            elapsed_millis,
        } => {
            let reason = format!("{reason:?}");
            let committed_pieces = validation.committed_pieces.to_string();
            let artifact_observations = validation.artifact_observations.to_string();
            let elapsed_millis = elapsed_millis.to_string();
            views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::INTEGRITY_HASH,
                "incoming_seed_fast_resume_rejected",
                Some(torrent_id),
                "Completed torrent requires a torrent-local full check before seeding",
                &[
                    ("reason", &reason),
                    ("committed_pieces", &committed_pieces),
                    ("artifact_observations", &artifact_observations),
                    ("validation_elapsed_millis", &elapsed_millis),
                ],
            )
        }
        SeedReconcileOutcome::AwaitingStorage(detail) => views.record_diagnostic(
            DiagnosticSeverity::Warning,
            category::PLATFORM_ADAPTER,
            "incoming_seed_awaiting_storage",
            Some(torrent_id),
            "Completed torrent storage is currently unavailable for seeding",
            &[("detail", detail)],
        ),
        SeedReconcileOutcome::NeedsRepair(detail) => views.record_diagnostic(
            DiagnosticSeverity::Error,
            category::STORAGE_IO,
            "incoming_seed_storage_needs_repair",
            Some(torrent_id),
            "Completed torrent storage is malformed or ambiguously owned",
            &[("detail", detail)],
        ),
        SeedReconcileOutcome::AlreadyRegistered | SeedReconcileOutcome::Ineligible(_) => Ok(()),
    }
}

fn apply_seed_reconcile_state(
    store: &Arc<Mutex<SessionStore>>,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
    views: &ViewHub,
    torrent_id: &str,
    outcome: &SeedReconcileOutcome,
) -> Result<bool, String> {
    let mut store = store
        .lock()
        .map_err(|_| "session store lock is poisoned".to_owned())?;
    let start_checker = match outcome {
        SeedReconcileOutcome::NeedsFullCheck { .. } => {
            store
                .begin_recheck(torrent_id)
                .map_err(|error| error.to_string())?;
            true
        }
        SeedReconcileOutcome::AwaitingStorage(detail) => {
            store
                .mark_awaiting_storage(torrent_id, Some(detail))
                .map_err(|error| error.to_string())?;
            false
        }
        SeedReconcileOutcome::NeedsRepair(detail) => {
            store
                .mark_needs_repair(torrent_id, detail)
                .map_err(|error| error.to_string())?;
            false
        }
        SeedReconcileOutcome::Registered { .. }
        | SeedReconcileOutcome::AlreadyRegistered
        | SeedReconcileOutcome::Unregistered
        | SeedReconcileOutcome::Ineligible(_)
        | SeedReconcileOutcome::Unavailable(_) => return Ok(false),
    };
    let (snapshot, durable) =
        durable_view_state(&store, storage_roots).map_err(|error| error.to_string())?;
    drop(store);
    views
        .replace_durable(&snapshot, &durable)
        .map_err(|error| error.to_string())?;
    Ok(start_checker)
}

fn handle_task_outcome(
    store: &Arc<Mutex<SessionStore>>,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
    views: &ViewHub,
    torrent_id: &str,
    outcome: Result<ApplicationTaskReport, DownloadError>,
) -> Result<(), String> {
    views
        .clear_disk_runtime(torrent_id)
        .map_err(|error| error.to_string())?;
    views
        .clear_piece_runtime(torrent_id)
        .map_err(|error| error.to_string())?;
    match outcome {
        Ok(report) => {
            views
                .set_progress_inputs(torrent_id, ProgressInputs::default())
                .map_err(|error| error.to_string())?;
            let operation = match report {
                ApplicationTaskReport::Metadata => "metadata",
                ApplicationTaskReport::Download => "download",
            };
            views
                .record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "engine_task_completed",
                    Some(torrent_id),
                    "Engine task completed",
                    &[("operation", operation)],
                )
                .map_err(|error| error.to_string())
        }
        Err(DownloadError::Cancelled) => {
            views
                .set_progress_inputs(torrent_id, ProgressInputs::default())
                .map_err(|error| error.to_string())?;
            views
                .record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::LIFECYCLE_TORRENT,
                    "engine_task_cancelled",
                    Some(torrent_id),
                    "Engine task stopped at a cancellation point",
                    &[],
                )
                .map_err(|error| error.to_string())
        }
        Err(DownloadError::NetworkDisabled) => {
            views
                .set_progress_inputs(
                    torrent_id,
                    ProgressInputs {
                        network_disabled: true,
                        ..ProgressInputs::default()
                    },
                )
                .map_err(|error| error.to_string())?;
            views
                .record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::DISCOVERY_PEER,
                    "network_disabled",
                    Some(torrent_id),
                    "Outbound networking is disabled by application policy",
                    &[],
                )
                .map_err(|error| error.to_string())
        }
        Err(error) if is_discovery_exhaustion(&error) => {
            views
                .set_progress_inputs(
                    torrent_id,
                    ProgressInputs {
                        discovery_exhausted: true,
                        ..ProgressInputs::default()
                    },
                )
                .map_err(|error| error.to_string())?;
            let detail = error.to_string();
            if matches!(error, DownloadError::NoUsableTrackerAddress) {
                views
                    .record_diagnostic(
                        DiagnosticSeverity::Warning,
                        category::TRACKER_ANNOUNCE,
                        "tracker_address_rejected",
                        Some(torrent_id),
                        "Tracker supplied no address allowed by the current network policy",
                        &[("detail", &detail)],
                    )
                    .map_err(|error| error.to_string())?;
            }
            views
                .record_diagnostic(
                    DiagnosticSeverity::Warning,
                    category::DISCOVERY_PEER,
                    "discovery_exhausted",
                    Some(torrent_id),
                    "No enabled discovery source can currently supply an eligible peer",
                    &[("detail", &detail)],
                )
                .map_err(|error| error.to_string())
        }
        Err(DownloadError::SelectiveStorage(error))
            if active_storage_failure_is_awaiting(&error) =>
        {
            let failure_kind = error.platform_failure_kind();
            let detail = error.to_string();
            {
                let mut store = store
                    .lock()
                    .map_err(|_| "session store lock is poisoned".to_owned())?;
                store
                    .mark_awaiting_storage(torrent_id, Some(&detail))
                    .map_err(|error| error.to_string())?;
                let (snapshot, durable) =
                    durable_view_state(&store, storage_roots).map_err(|error| error.to_string())?;
                drop(store);
                views
                    .replace_durable(&snapshot, &durable)
                    .map_err(|error| error.to_string())?;
            }
            views
                .set_progress_inputs(torrent_id, ProgressInputs::default())
                .map_err(|error| error.to_string())?;
            views
                .record_diagnostic(
                    DiagnosticSeverity::Warning,
                    category::PLATFORM_ADAPTER,
                    if failure_kind == Some(PlatformStorageFailureKind::GrantUnavailable) {
                        "platform_storage_grant_unavailable"
                    } else {
                        "storage_temporarily_unavailable"
                    },
                    Some(torrent_id),
                    "Torrent storage is temporarily unavailable",
                    &[("detail", &detail)],
                )
                .map_err(|error| error.to_string())
        }
        Err(error) => {
            let cleanup_failed = matches!(&error, DownloadError::PeerCleanup { .. });
            let detail = error.to_string();
            {
                let mut store = store
                    .lock()
                    .map_err(|_| "session store lock is poisoned".to_owned())?;
                if matches!(error, DownloadError::SelectiveStorage(_)) {
                    store
                        .mark_needs_repair(torrent_id, &detail)
                        .map_err(|error| error.to_string())?;
                } else {
                    store
                        .mark_error(torrent_id, &detail)
                        .map_err(|error| error.to_string())?;
                }
                let (snapshot, durable) =
                    durable_view_state(&store, storage_roots).map_err(|error| error.to_string())?;
                drop(store);
                views
                    .replace_durable(&snapshot, &durable)
                    .map_err(|error| error.to_string())?;
            }
            views
                .set_progress_inputs(torrent_id, ProgressInputs::default())
                .map_err(|error| error.to_string())?;
            views
                .record_diagnostic(
                    DiagnosticSeverity::Error,
                    category::LIFECYCLE_TORRENT,
                    "engine_task_failed",
                    Some(torrent_id),
                    "Engine task failed",
                    &[("detail", &detail)],
                )
                .map_err(|error| error.to_string())?;
            if cleanup_failed { Err(detail) } else { Ok(()) }
        }
    }
}

fn active_storage_failure_is_awaiting(error: &SelectiveStorageError) -> bool {
    error.platform_failure_kind().is_some_and(|kind| {
        matches!(
            kind,
            PlatformStorageFailureKind::GrantUnavailable
                | PlatformStorageFailureKind::PermissionDenied
                | PlatformStorageFailureKind::ProviderRefused
                | PlatformStorageFailureKind::NonSeekable
                | PlatformStorageFailureKind::Cancelled
                | PlatformStorageFailureKind::DeadlineExceeded
        )
    }) || matches!(error, SelectiveStorageError::Io { .. })
}

fn is_discovery_exhaustion(error: &DownloadError) -> bool {
    matches!(
        error,
        DownloadError::NetworkPolicyDenied { .. }
            | DownloadError::UdpTracker(_)
            | DownloadError::NoUsablePeer
            | DownloadError::NoUsableTrackerAddress
            | DownloadError::UdpTrackerResponseTooLarge { .. }
            | DownloadError::UdpTrackerTimedOut { .. }
            | DownloadError::NetworkTimedOut { .. }
            | DownloadError::PeerClosed
            | DownloadError::PeerTimedOut { .. }
    )
}

#[derive(Debug)]
struct StoreCheckpointSink {
    store: Arc<Mutex<SessionStore>>,
    storage_roots: Arc<BTreeMap<String, StorageRootLocation>>,
    torrent_id: String,
    views: ViewHub,
    recheck_generation: Mutex<Option<u64>>,
    product_milestone_wake: Option<Arc<Notify>>,
}

impl StoreCheckpointSink {
    fn store(&self) -> Result<MutexGuard<'_, SessionStore>, String> {
        self.store
            .lock()
            .map_err(|_| "session store lock is poisoned".to_owned())
    }

    fn refresh(&self) -> Result<(), String> {
        let (snapshot, durable) = {
            let store = self.store()?;
            durable_view_state(&store, &self.storage_roots).map_err(|error| error.to_string())?
        };
        self.views
            .replace_durable(&snapshot, &durable)
            .map_err(|error| error.to_string())
    }
}

impl DownloadCheckpointSink for StoreCheckpointSink {
    fn metadata_verified(&self, raw_info: &[u8]) -> Result<(), String> {
        self.store().and_then(|mut store| {
            store
                .record_metadata(&self.torrent_id, raw_info)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })?;
        self.refresh()?;
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::METADATA_EXCHANGE,
                "metadata_verified",
                Some(&self.torrent_id),
                "Torrent metadata verified",
                &[],
            )
            .map_err(|error| error.to_string())
    }

    fn storage_prepared(&self, storage: ResumedStorage) -> Result<(), String> {
        let storage_kind = match storage {
            ResumedStorage::Created => "created",
            ResumedStorage::Existing => "existing",
        };
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::STORAGE_IO,
                "storage_prepared",
                Some(&self.torrent_id),
                "Torrent storage prepared",
                &[("storage_kind", storage_kind)],
            )
            .map_err(|error| error.to_string())
    }

    fn storage_discovered(
        &self,
        storage: ResumedStorage,
        expected_files: usize,
        present_files: usize,
        oversized_files: usize,
    ) -> Result<u64, String> {
        match storage {
            ResumedStorage::Created => {
                return Err("new storage cannot be committed as discovered".to_owned());
            }
            ResumedStorage::Existing => {}
        }
        let generation = self.store().and_then(|mut store| {
            store
                .begin_recheck_with_generation(&self.torrent_id)
                .map(|(_, generation)| generation)
                .map_err(|error| error.to_string())
        })?;
        *self
            .recheck_generation
            .lock()
            .map_err(|_| "recheck generation lock is poisoned".to_owned())? = Some(generation);
        self.refresh()?;
        let expected_files = expected_files.to_string();
        let present_files = present_files.to_string();
        let oversized_files = oversized_files.to_string();
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::INTEGRITY_HASH,
                "storage_discovered",
                Some(&self.torrent_id),
                "Existing torrent storage discovered; content recheck started",
                &[
                    ("expected_files", expected_files.as_str()),
                    ("present_files", present_files.as_str()),
                    ("oversized_files", oversized_files.as_str()),
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(generation)
    }

    fn recheck_started(&self) -> Result<u64, String> {
        let generation = self.store().and_then(|mut store| {
            store
                .begin_recheck_with_generation(&self.torrent_id)
                .map(|(_, generation)| generation)
                .map_err(|error| error.to_string())
        })?;
        *self
            .recheck_generation
            .lock()
            .map_err(|_| "recheck generation lock is poisoned".to_owned())? = Some(generation);
        self.refresh()?;
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::INTEGRITY_HASH,
                "recheck_started",
                Some(&self.torrent_id),
                "Content recheck started",
                &[],
            )
            .map_err(|error| error.to_string())?;
        Ok(generation)
    }

    fn have_rechecked(&self, verified_pieces: &[bool]) -> Result<(), String> {
        let generation = self
            .recheck_generation
            .lock()
            .map_err(|_| "recheck generation lock is poisoned".to_owned())?
            .ok_or_else(|| "recheck completion has no admitted generation".to_owned())?;
        let resume = self.store().and_then(|store| {
            store
                .load_resume(&self.torrent_id)
                .map_err(|error| error.to_string())
        })?;
        let have = resume
            .have
            .ok_or_else(|| "metadata checkpoint did not create have state".to_owned())?;
        let replacement = HaveState::from_pieces(
            have.torrent_id(),
            have.content_fingerprint(),
            verified_pieces.to_vec(),
        )
        .map_err(|error| error.to_string())?;
        self.store().and_then(|mut store| {
            store
                .complete_recheck_generation(&self.torrent_id, generation, &replacement)
                .map_err(|error| error.to_string())?;
            if store
                .load_resume(&self.torrent_id)
                .map_err(|error| error.to_string())?
                .state
                == TorrentState::Complete
            {
                store
                    .mark_complete(&self.torrent_id)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })?;
        *self
            .recheck_generation
            .lock()
            .map_err(|_| "recheck generation lock is poisoned".to_owned())? = None;
        self.refresh()?;
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::INTEGRITY_HASH,
                "have_rechecked",
                Some(&self.torrent_id),
                "Existing piece state rechecked",
                &[],
            )
            .map_err(|error| error.to_string())
    }

    fn pieces_durable(&self, piece_indices: &[usize]) -> Result<(), String> {
        if piece_indices.is_empty() {
            return Err("durable piece batch must be nonempty".to_owned());
        }
        let mut durable_indices = piece_indices.to_vec();
        durable_indices.sort_unstable();
        durable_indices.dedup();
        let view_indices = durable_indices
            .iter()
            .copied()
            .map(|piece_index| {
                u32::try_from(piece_index)
                    .map_err(|_| "durable piece index overflows u32".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let revision = self.store().and_then(|mut store| {
            let revision = store
                .record_pieces(&self.torrent_id, &durable_indices)
                .map_err(|error| error.to_string())?;
            if store
                .load_resume(&self.torrent_id)
                .map_err(|error| error.to_string())?
                .state
                == TorrentState::Complete
            {
                store
                    .mark_complete(&self.torrent_id)
                    .map_err(|error| error.to_string())
            } else {
                Ok(revision)
            }
        })?;
        if let Some(wake) = &self.product_milestone_wake {
            wake.notify_one();
        }
        self.views
            .record_pieces_durable(&self.torrent_id, &view_indices, revision)
            .map_err(|error| error.to_string())?;
        let piece_count = durable_indices.len().to_string();
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Debug,
                category::PIECE_BLOCK,
                "pieces_durable",
                Some(&self.torrent_id),
                "Verified pieces became durable",
                &[("piece_count", &piece_count)],
            )
            .map_err(|error| error.to_string())
    }

    fn pieces_invalidated(&self, piece_indices: &[usize]) -> Result<(), String> {
        if piece_indices.is_empty() {
            return Err("invalidated piece batch must be nonempty".to_owned());
        }
        let mut invalidated = piece_indices.to_vec();
        invalidated.sort_unstable();
        invalidated.dedup();
        self.store().and_then(|mut store| {
            store
                .invalidate_pieces(&self.torrent_id, &invalidated)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })?;
        self.refresh()?;
        let piece_count = invalidated.len().to_string();
        self.views
            .record_diagnostic(
                DiagnosticSeverity::Info,
                category::INTEGRITY_HASH,
                "pieces_invalidated_by_selection_route",
                Some(&self.torrent_id),
                "File selection route invalidated uncertain piece evidence",
                &[("piece_count", &piece_count)],
            )
            .map_err(|error| error.to_string())
    }
}

#[derive(Debug)]
struct ViewActivitySink {
    torrent_id: String,
    durable_torrent_id: TorrentId,
    torrent_generation: u64,
    accounting: TorrentAccountingOwner,
    eta_generation: Option<u64>,
    views: ViewHub,
    trace_checkpoint_stages: bool,
    last_checkpoint_stage: Mutex<Option<DiskCheckpointStage>>,
}

const fn checkpoint_stage_name(stage: DiskCheckpointStage) -> &'static str {
    match stage {
        DiskCheckpointStage::Idle => "idle",
        DiskCheckpointStage::Syncing => "syncing",
        DiskCheckpointStage::Committing => "committing",
        DiskCheckpointStage::Error => "error",
    }
}

fn piece_diagnostic_context(
    event: &DownloadActivityEvent,
) -> (Vec<DiagnosticSubject>, Vec<DiagnosticField>) {
    let (piece_index, attempt) = match event {
        DownloadActivityEvent::PieceStarted {
            piece_index,
            attempt,
            ..
        } => (*piece_index, Some(*attempt)),
        DownloadActivityEvent::BlockRequested { piece_index, .. }
        | DownloadActivityEvent::BlockReceived { piece_index, .. }
        | DownloadActivityEvent::BlockStored { piece_index, .. }
        | DownloadActivityEvent::PieceHashing { piece_index }
        | DownloadActivityEvent::PieceVerified { piece_index } => (*piece_index, None),
        _ => return (Vec::new(), Vec::new()),
    };
    let fields = match event {
        DownloadActivityEvent::PieceStarted { piece_length, .. } => {
            vec![DiagnosticField::bytes(
                "piece_length",
                u64::from(*piece_length),
            )]
        }
        DownloadActivityEvent::BlockRequested { begin, length, .. }
        | DownloadActivityEvent::BlockReceived { begin, length, .. }
        | DownloadActivityEvent::BlockStored { begin, length, .. } => vec![
            DiagnosticField::bytes("block_offset", u64::from(*begin)),
            DiagnosticField::bytes("block_length", u64::from(*length)),
        ],
        _ => Vec::new(),
    };
    (
        vec![DiagnosticSubject::Piece {
            piece_index,
            attempt,
        }],
        fields,
    )
}

impl DownloadActivitySink for ViewActivitySink {
    fn record(&self, event: DownloadActivityEvent) {
        if let DownloadActivityEvent::MetadataAcquisitionProgress(progress) = &event {
            let _ = self.views.record_metadata_preparation(
                &self.torrent_id,
                self.eta_generation,
                progress,
            );
            return;
        }
        if matches!(event, DownloadActivityEvent::MetadataAcquisitionFinished) {
            let _ = self
                .views
                .finish_metadata_preparation(&self.torrent_id, self.eta_generation);
            return;
        }
        if let DownloadActivityEvent::IntegrityPreparation(progress) = &event {
            let _ = self.views.record_integrity_preparation(
                &self.torrent_id,
                self.eta_generation,
                *progress,
            );
            return;
        }
        if let DownloadActivityEvent::PeerConnections { captured_at, peers } = &event {
            let _ = self.views.record_peer_connections(
                &self.torrent_id,
                *captured_at,
                peers.as_slice(),
            );
            return;
        }
        if let DownloadActivityEvent::PeerRegistryState { active, snapshot } = &event {
            let _ =
                self.views
                    .record_peer_registry_state(&self.torrent_id, *active, snapshot.as_ref());
            return;
        }
        if let DownloadActivityEvent::TrackerState(snapshot) = &event {
            let captured_at = Instant::now();
            let complete = snapshot
                .records
                .iter()
                .filter_map(|record| record.seeders)
                .max();
            let incomplete = snapshot
                .records
                .iter()
                .filter_map(|record| record.leechers)
                .max();
            let _ = self.accounting.observe_tracker_counts(
                self.durable_torrent_id,
                self.torrent_generation,
                complete,
                incomplete,
            );
            let _ = self
                .views
                .record_tracker_state_at(&self.torrent_id, snapshot, captured_at);
            return;
        }
        if let DownloadActivityEvent::StorageState(snapshot) = &event {
            if self.trace_checkpoint_stages {
                let mut previous = self
                    .last_checkpoint_stage
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if *previous != Some(snapshot.checkpoint_stage) {
                    *previous = Some(snapshot.checkpoint_stage);
                    eprintln!(
                        "checkpoint_stage={} dirty_pieces={} dirty_bytes={} batches_completed={}",
                        checkpoint_stage_name(snapshot.checkpoint_stage),
                        snapshot.checkpoint_dirty_pieces,
                        snapshot.checkpoint_dirty_bytes,
                        snapshot.checkpoint_batches_completed,
                    );
                }
            }
            let _ = self.views.record_disk_runtime(&self.torrent_id, snapshot);
            let _ = self
                .views
                .record_piece_runtime(&self.torrent_id, &snapshot.pieces);
            return;
        }
        if let DownloadActivityEvent::CheckerProgress(progress) = &event {
            let _ = self
                .views
                .record_checker_progress(&self.torrent_id, progress);
            return;
        }
        if let DownloadActivityEvent::CheckerFinished { generation } = &event {
            let _ = self.views.finish_checker(&self.torrent_id, *generation);
            return;
        }
        let piece_activity = match &event {
            DownloadActivityEvent::MetadataVerified { .. } => {
                return self.record_discovery_event(event);
            }
            DownloadActivityEvent::PieceStarted {
                piece_index,
                piece_length,
                attempt,
            } => TorrentActivity::PieceStarted {
                piece_index: *piece_index,
                piece_length: *piece_length,
                attempt: *attempt,
            },
            DownloadActivityEvent::BlockRequested {
                piece_index,
                begin,
                length,
            } => TorrentActivity::BlockRequested {
                piece_index: *piece_index,
                begin: *begin,
                length: *length,
            },
            DownloadActivityEvent::BlockReceived {
                piece_index,
                begin,
                length,
            } => TorrentActivity::BlockReceived {
                piece_index: *piece_index,
                begin: *begin,
                length: *length,
            },
            DownloadActivityEvent::BlockStored {
                piece_index,
                begin,
                length,
            } => TorrentActivity::BlockStored {
                piece_index: *piece_index,
                begin: *begin,
                length: *length,
            },
            DownloadActivityEvent::PieceVerified { piece_index } => {
                TorrentActivity::PieceVerified {
                    piece_index: *piece_index,
                }
            }
            DownloadActivityEvent::PieceHashFailed {
                piece_index,
                failed_bytes,
                ..
            } => TorrentActivity::PieceHashFailed {
                piece_index: *piece_index,
                failed_bytes: *failed_bytes,
            },
            DownloadActivityEvent::PieceHashing { piece_index } => TorrentActivity::PieceHashing {
                piece_index: *piece_index,
            },
            _ => return self.record_discovery_event(event),
        };
        let _ = self.views.record_generation_activity(
            &self.torrent_id,
            self.eta_generation,
            Instant::now(),
            piece_activity,
        );
        if matches!(event, DownloadActivityEvent::PieceHashFailed { .. }) {
            return self.record_discovery_event(event);
        }
        let (severity, category, code, summary) = match event {
            DownloadActivityEvent::PieceStarted { .. } => (
                DiagnosticSeverity::Debug,
                category::SCHEDULER_REQUEST,
                "piece_started",
                "Piece transfer started",
            ),
            DownloadActivityEvent::BlockRequested { .. } => (
                DiagnosticSeverity::Trace,
                category::PEER_PROTOCOL,
                "block_requested",
                "Piece block requested",
            ),
            DownloadActivityEvent::BlockReceived { .. } => (
                DiagnosticSeverity::Trace,
                category::PEER_PROTOCOL,
                "block_received",
                "Piece block received",
            ),
            DownloadActivityEvent::BlockStored { .. } => (
                DiagnosticSeverity::Trace,
                category::STORAGE_IO,
                "block_stored",
                "Piece block stored",
            ),
            DownloadActivityEvent::PieceHashing { .. } => (
                DiagnosticSeverity::Debug,
                category::INTEGRITY_HASH,
                "piece_hashing",
                "Piece hash verification started",
            ),
            DownloadActivityEvent::PieceVerified { .. } => (
                DiagnosticSeverity::Info,
                category::INTEGRITY_HASH,
                "piece_verified",
                "Piece hash verified",
            ),
            _ => unreachable!("discovery events returned before piece diagnostics"),
        };
        let diagnostic_torrent_id = self.torrent_id.clone();
        let _ =
            self.views
                .record_diagnostic_lazy(severity, category, Some(&self.torrent_id), || {
                    let (subjects, fields) = piece_diagnostic_context(&event);
                    DiagnosticDraft {
                        severity,
                        category: DiagnosticCategory::from_static(category),
                        code: code.to_owned(),
                        torrent_id: Some(diagnostic_torrent_id),
                        message: summary.to_owned(),
                        subjects,
                        fields,
                    }
                });
    }
}

impl ViewActivitySink {
    fn record_structured(
        &self,
        severity: DiagnosticSeverity,
        category: &'static str,
        code: &'static str,
        message: &'static str,
        subjects: Vec<DiagnosticSubject>,
        fields: Vec<DiagnosticField>,
    ) {
        let _ = self.views.record_structured_diagnostic(DiagnosticDraft {
            severity,
            category: DiagnosticCategory::from_static(category),
            code: code.to_owned(),
            torrent_id: Some(self.torrent_id.clone()),
            message: message.to_owned(),
            subjects,
            fields,
        });
    }

    fn record_discovery_event(&self, event: DownloadActivityEvent) {
        match event {
            DownloadActivityEvent::MetadataAcquisitionProgress(_)
            | DownloadActivityEvent::MetadataAcquisitionFinished
            | DownloadActivityEvent::IntegrityPreparation(_) => {
                unreachable!("preparation projections are handled before diagnostics")
            }
            DownloadActivityEvent::MetadataVerified {
                total_length,
                piece_length,
                piece_count,
                file_count,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Info,
                    category::METADATA_EXCHANGE,
                    "metadata_verified",
                    "Torrent metadata verified",
                    Vec::new(),
                    vec![
                        DiagnosticField::bytes("total_length", total_length),
                        DiagnosticField::bytes("piece_length", u64::from(piece_length)),
                        DiagnosticField::count(
                            "piece_count",
                            u64::try_from(piece_count).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::count(
                            "file_count",
                            u64::try_from(file_count).unwrap_or(u64::MAX),
                        ),
                    ],
                );
            }
            DownloadActivityEvent::FastResumeAccepted {
                committed_pieces,
                relevant_files,
                artifact_observations,
                part_header_bytes,
                elapsed_millis,
                payload_bytes_read,
                hash_jobs,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Info,
                    category::INTEGRITY_HASH,
                    "fast_resume_accepted",
                    "Committed resume state accepted after structural validation",
                    Vec::new(),
                    vec![
                        DiagnosticField::count(
                            "committed_pieces",
                            u64::try_from(committed_pieces).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::count(
                            "relevant_files",
                            u64::try_from(relevant_files).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::count(
                            "artifact_observations",
                            u64::try_from(artifact_observations).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::bytes("part_header_bytes", part_header_bytes),
                        DiagnosticField::duration_millis("validation_elapsed", elapsed_millis),
                        DiagnosticField::bytes("payload_bytes_read", payload_bytes_read),
                        DiagnosticField::count(
                            "hash_jobs",
                            u64::try_from(hash_jobs).unwrap_or(u64::MAX),
                        ),
                    ],
                );
            }
            DownloadActivityEvent::FastResumeRejected {
                generation,
                reason,
                committed_pieces,
                relevant_files,
                artifact_observations,
                part_header_bytes,
                elapsed_millis,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Info,
                    category::INTEGRITY_HASH,
                    "fast_resume_rejected",
                    "Resume validation selected a complete torrent-local check",
                    Vec::new(),
                    vec![
                        DiagnosticField::count("generation", generation),
                        DiagnosticField::text("reason", format!("{reason:?}")),
                        DiagnosticField::count(
                            "committed_pieces",
                            u64::try_from(committed_pieces).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::count(
                            "relevant_files",
                            u64::try_from(relevant_files).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::count(
                            "artifact_observations",
                            u64::try_from(artifact_observations).unwrap_or(u64::MAX),
                        ),
                        DiagnosticField::bytes("part_header_bytes", part_header_bytes),
                        DiagnosticField::duration_millis("validation_elapsed", elapsed_millis),
                    ],
                );
            }
            DownloadActivityEvent::DiscoveryLane {
                protocol,
                operation,
                phase,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Debug,
                    category::DISCOVERY_DHT,
                    "discovery_lane_operation",
                    "Versioned torrent discovery lane changed state",
                    Vec::new(),
                    vec![
                        DiagnosticField::text("protocol", protocol.as_str()),
                        DiagnosticField::text(
                            "operation",
                            format!("{operation:?}").to_ascii_lowercase(),
                        ),
                        DiagnosticField::text("phase", format!("{phase:?}").to_ascii_lowercase()),
                    ],
                );
            }
            DownloadActivityEvent::TrackerAnnounceStarted {
                tracker,
                tier,
                attempt,
                event,
            } => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, true, false);
                let announce_event = format!("{event:?}").to_ascii_lowercase();
                self.record_structured(
                    DiagnosticSeverity::Info,
                    category::TRACKER_ANNOUNCE,
                    "tracker_announce_started",
                    "Contacting tracker",
                    vec![DiagnosticSubject::Tracker {
                        tracker_id: tracker,
                    }],
                    vec![
                        DiagnosticField::count("tier", u64::from(tier)),
                        DiagnosticField::count("attempt", u64::from(attempt)),
                        DiagnosticField::text("event", announce_event),
                    ],
                );
            }
            DownloadActivityEvent::TrackerUdpRetransmitted { tracker, operation } => {
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Debug,
                    category::TRACKER_ANNOUNCE,
                    "tracker_udp_retransmitted",
                    Some(&self.torrent_id),
                    "UDP tracker request retransmitted after silence",
                    &[("tracker", &tracker), ("operation", operation)],
                );
            }
            DownloadActivityEvent::TrackerAnnounceFailed {
                tracker,
                failures,
                retry_in_seconds,
                detail,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Warning,
                    category::TRACKER_ANNOUNCE,
                    "tracker_announce_failed",
                    "Tracker announce failed temporarily",
                    vec![DiagnosticSubject::Tracker {
                        tracker_id: tracker,
                    }],
                    vec![
                        DiagnosticField::count("failures", u64::from(failures)),
                        DiagnosticField::duration_millis(
                            "retry_in",
                            retry_in_seconds.saturating_mul(1_000),
                        ),
                        DiagnosticField::text("detail", detail),
                    ],
                );
            }
            DownloadActivityEvent::TrackerFallbackSelected { tracker, tier } => {
                let tier = tier.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::TRACKER_ANNOUNCE,
                    "tracker_fallback_selected",
                    Some(&self.torrent_id),
                    "Trying another tracker in the tier",
                    &[("tracker", &tracker), ("tier", &tier)],
                );
            }
            DownloadActivityEvent::TrackerRetryScheduled {
                tracker,
                retry_in_seconds,
            } => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, false, true);
                let retry = retry_in_seconds.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::TRACKER_ANNOUNCE,
                    "tracker_retry_scheduled",
                    Some(&self.torrent_id),
                    "Tracker discovery will retry automatically",
                    &[("tracker", &tracker), ("retry_seconds", &retry)],
                );
            }
            DownloadActivityEvent::TrackerReannounceScheduled {
                tracker,
                announce_in_seconds,
            } => {
                let announce = announce_in_seconds.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Debug,
                    category::TRACKER_ANNOUNCE,
                    "tracker_reannounce_scheduled",
                    Some(&self.torrent_id),
                    "Tracker accepted the announce interval",
                    &[("tracker", &tracker), ("announce_seconds", &announce)],
                );
            }
            DownloadActivityEvent::TrackerAnnounceSucceeded {
                tracker,
                peer_count,
                interval_seconds,
            } => {
                self.record_structured(
                    DiagnosticSeverity::Info,
                    category::TRACKER_ANNOUNCE,
                    "tracker_announce_succeeded",
                    "Tracker announce succeeded",
                    vec![DiagnosticSubject::Tracker {
                        tracker_id: tracker,
                    }],
                    vec![
                        DiagnosticField::count("peers", u64::from(peer_count)),
                        DiagnosticField::duration_millis(
                            "announce_interval",
                            interval_seconds.saturating_mul(1_000),
                        ),
                    ],
                );
            }
            DownloadActivityEvent::TrackerWarning { tracker, detail } => {
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Warning,
                    category::TRACKER_ANNOUNCE,
                    "tracker_warning",
                    Some(&self.torrent_id),
                    "Tracker announce succeeded with a warning",
                    &[("tracker", &tracker), ("detail", &detail)],
                );
            }
            DownloadActivityEvent::TrackerPeersUnavailable {
                tracker,
                peer_count,
            } => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, false, true);
                let peers = peer_count.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::PEER_CONNECTION,
                    "tracker_peers_unavailable",
                    Some(&self.torrent_id),
                    "Tracker response has no currently eligible peer",
                    &[("tracker", &tracker), ("peers", &peers)],
                );
            }
            DownloadActivityEvent::DhtLookupStarted => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, true, false);
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::DISCOVERY_DHT,
                    "dht_lookup_started",
                    Some(&self.torrent_id),
                    "Searching the distributed hash table for peers",
                    &[],
                );
            }
            DownloadActivityEvent::DhtLookupSucceeded { peer_count } => {
                let peers = peer_count.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::DISCOVERY_DHT,
                    "dht_lookup_succeeded",
                    Some(&self.torrent_id),
                    "DHT lookup returned peers",
                    &[("peers", &peers)],
                );
            }
            DownloadActivityEvent::DhtAnnounceCompleted {
                port,
                token_nodes,
                announces_sent,
                announces_succeeded,
                announces_failed,
            } => {
                self.record_structured(
                    if announces_failed == 0 {
                        DiagnosticSeverity::Info
                    } else {
                        DiagnosticSeverity::Warning
                    },
                    category::DISCOVERY_DHT,
                    "dht_announce_completed",
                    "DHT peer announcement traversal completed",
                    Vec::new(),
                    vec![
                        DiagnosticField::count("port", u64::from(port)),
                        DiagnosticField::count("token_nodes", u64::from(token_nodes)),
                        DiagnosticField::count("announces_sent", u64::from(announces_sent)),
                        DiagnosticField::count(
                            "announces_succeeded",
                            u64::from(announces_succeeded),
                        ),
                        DiagnosticField::count("announces_failed", u64::from(announces_failed)),
                    ],
                );
            }
            DownloadActivityEvent::DhtLookupFailed { detail } => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, false, true);
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Warning,
                    category::DISCOVERY_DHT,
                    "dht_lookup_failed",
                    Some(&self.torrent_id),
                    "DHT lookup ended without a peer and may be retried",
                    &[("detail", &detail)],
                );
            }
            DownloadActivityEvent::DhtRetryScheduled { retry_in_seconds } => {
                let retry = retry_in_seconds.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::DISCOVERY_DHT,
                    "dht_retry_scheduled",
                    Some(&self.torrent_id),
                    "DHT lookup will retry after bounded backoff",
                    &[("retry_in_seconds", &retry)],
                );
            }
            DownloadActivityEvent::DhtDisabledForPrivateTorrent => {
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::DISCOVERY_DHT,
                    "dht_disabled_private_torrent",
                    Some(&self.torrent_id),
                    "Verified private metadata disabled decentralized discovery",
                    &[],
                );
            }
            DownloadActivityEvent::PeerDialStarted { peer: _ } => {
                let _ = self
                    .views
                    .set_discovery_activity(&self.torrent_id, true, false);
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::PEER_CONNECTION,
                    "peer_dial_started",
                    Some(&self.torrent_id),
                    "Connecting to discovered peer",
                    &[],
                );
            }
            DownloadActivityEvent::DrySwarmProbeStarted {
                record_id,
                failures,
                ordinal,
                next_delay_seconds,
            } => {
                let record = record_id.to_string();
                let failures = failures.to_string();
                let ordinal = ordinal.to_string();
                let next_delay = next_delay_seconds.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Info,
                    category::PEER_CONNECTION,
                    "dry_swarm_probe_started",
                    Some(&self.torrent_id),
                    "Trying one previously failed peer because no ordinary connection action remains",
                    &[
                        ("record_id", &record),
                        ("failures", &failures),
                        ("probe_ordinal", &ordinal),
                        ("next_delay_seconds", &next_delay),
                    ],
                );
            }
            DownloadActivityEvent::SwarmState(snapshot) => {
                let connected = snapshot.connected_peers.to_string();
                let pending = snapshot.pending_dials.to_string();
                let unchoked = snapshot.unchoked_peers.to_string();
                let missing = snapshot.missing_blocks.to_string();
                let requested = snapshot.requested_blocks.to_string();
                let writing = snapshot.writing_blocks.to_string();
                let reserved = snapshot.outstanding_request_bytes.to_string();
                let oldest = snapshot
                    .oldest_request_age_seconds
                    .map_or_else(|| "none".to_owned(), |value| value.to_string());
                let next_expiry = snapshot
                    .next_request_expiry_seconds
                    .map_or_else(|| "none".to_owned(), |value| value.to_string());
                let next_replacement = snapshot
                    .next_replacement_seconds
                    .map_or_else(|| "none".to_owned(), |value| value.to_string());
                let reason = snapshot
                    .no_request_reason
                    .map_or_else(|| "requestable".to_owned(), |reason| format!("{reason:?}"));
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Debug,
                    category::PERFORMANCE_BACKPRESSURE,
                    "swarm_state_changed",
                    Some(&self.torrent_id),
                    "Torrent request state changed",
                    &[
                        ("connected_peers", &connected),
                        ("pending_dials", &pending),
                        ("unchoked_peers", &unchoked),
                        ("missing_blocks", &missing),
                        ("requested_blocks", &requested),
                        ("writing_blocks", &writing),
                        ("outstanding_request_bytes", &reserved),
                        ("oldest_request_seconds", &oldest),
                        ("next_expiry_seconds", &next_expiry),
                        ("next_replacement_seconds", &next_replacement),
                        ("no_request_reason", &reason),
                    ],
                );
            }
            DownloadActivityEvent::PieceHashFailed {
                piece_index,
                contributor_count,
                failed_bytes,
            } => {
                let piece_index = piece_index.to_string();
                let contributors = contributor_count.to_string();
                let failed_bytes = failed_bytes.to_string();
                let _ = self.views.record_diagnostic(
                    DiagnosticSeverity::Warning,
                    category::INTEGRITY_HASH,
                    "piece_hash_failed",
                    Some(&self.torrent_id),
                    "Piece hash failed; retrying the entire piece",
                    &[
                        ("piece_index", &piece_index),
                        ("contributors", &contributors),
                        ("failed_bytes", &failed_bytes),
                    ],
                );
            }
            DownloadActivityEvent::PieceStarted { .. }
            | DownloadActivityEvent::BlockRequested { .. }
            | DownloadActivityEvent::BlockReceived { .. }
            | DownloadActivityEvent::BlockStored { .. }
            | DownloadActivityEvent::PieceHashing { .. }
            | DownloadActivityEvent::PieceVerified { .. } => {
                unreachable!("piece events are handled before discovery events")
            }
            DownloadActivityEvent::PeerConnections { .. } => {
                unreachable!("peer projections are handled before diagnostic events")
            }
            DownloadActivityEvent::PeerRegistryState { .. } => {
                unreachable!("swarm projections are handled before diagnostic events")
            }
            DownloadActivityEvent::TrackerState(_) => {
                unreachable!("tracker projections are handled before diagnostic events")
            }
            DownloadActivityEvent::StorageState(_) => {
                unreachable!("disk projections are handled before diagnostic events")
            }
            DownloadActivityEvent::CheckerProgress(_)
            | DownloadActivityEvent::CheckerFinished { .. } => {
                unreachable!("checker projections are handled before diagnostic events")
            }
        }
    }
}

fn available_storage_roots(
    roots: Vec<StoredStorageRoot>,
    healthy_platform_roots: &BTreeSet<String>,
) -> BTreeMap<String, StorageRootLocation> {
    roots
        .into_iter()
        .filter(|root| match &root.location {
            StorageRootLocation::Path(path) => path_root_is_available(path),
            StorageRootLocation::PlatformCapability => healthy_platform_roots.contains(&root.id),
        })
        .map(|root| (root.id, root.location))
        .collect()
}

fn path_root_is_available(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        && std::fs::read_dir(path).is_ok()
}

fn apply_runtime_storage_availability(
    snapshot: &mut crate::ServiceSnapshot,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
) {
    for root in &mut snapshot.storage.roots {
        root.availability = if storage_roots.contains_key(&root.root_id) {
            crate::StorageRootAvailability::Available
        } else {
            crate::StorageRootAvailability::Unavailable
        };
    }
    for torrent in &mut snapshot.torrents {
        if !storage_roots.contains_key(&torrent.storage_root)
            && torrent.metadata_available
            && torrent.state != TorrentState::NeedsRepair
        {
            torrent.state = TorrentState::AwaitingStorage;
            torrent.storage_state = StorageState::Unavailable;
            torrent.verified_piece_count = 0;
        }
    }
}

fn validate_selected_directory(path: &Path) -> Result<PathBuf, ApplicationError> {
    let path = std::fs::canonicalize(path).map_err(|source| ApplicationError::Io {
        operation: "resolve selected storage root",
        source,
    })?;
    if !path.is_dir() {
        return Err(ApplicationError::Configuration(
            "selected storage root is not a directory".to_owned(),
        ));
    }
    std::fs::read_dir(&path).map_err(|source| ApplicationError::Io {
        operation: "read selected storage root",
        source,
    })?;
    Ok(path)
}

fn storage_root_label(path: &Path) -> String {
    let mut label = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .or_else(|| path.to_str())
        .unwrap_or("Download folder")
        .to_owned();
    if label.len() > crate::control::MAX_ROOT_LABEL_LENGTH {
        label.truncate(label.floor_char_boundary(crate::control::MAX_ROOT_LABEL_LENGTH));
    }
    label
}

fn torrent_lifetime_view(
    accounting: crate::store::TorrentAccounting,
    total_size: u64,
) -> crate::TorrentLifetimeView {
    let downloaded_base = accounting.total_downloaded.max(total_size);
    crate::TorrentLifetimeView {
        uploaded_payload_bytes: accounting.total_uploaded.to_string(),
        downloaded_payload_bytes: accounting.total_downloaded.to_string(),
        active_seconds: accounting.active_seconds.to_string(),
        finished_seconds: accounting.finished_seconds.to_string(),
        seeding_seconds: accounting.seeding_seconds.to_string(),
        share_ratio_hundredths: (downloaded_base != 0).then(|| {
            (u128::from(accounting.total_uploaded) * 100 / u128::from(downloaded_base)).to_string()
        }),
    }
}

fn torrent_seed_goal_view(
    accounting: crate::store::TorrentAccounting,
    total_size: u64,
    limits: SeedGoalLimits,
) -> Result<crate::SeedGoalView, ApplicationError> {
    let goals = assess_seed_goals(
        SeedGoalInput {
            total_uploaded: accounting.total_uploaded,
            total_downloaded: accounting.total_downloaded,
            total_size,
            active_seconds: accounting.active_seconds,
            finished_seconds: accounting.finished_seconds,
        },
        limits,
    )
    .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
    Ok(crate::SeedGoalView {
        status: if goals.goal_unmet {
            crate::SeedGoalStatusView::Unmet
        } else {
            crate::SeedGoalStatusView::Met
        },
        share_ratio_met: goals.share_ratio_met,
        finished_download_ratio_met: goals.finished_download_ratio_met,
        finished_time_met: goals.finished_time_met,
    })
}

fn durable_view_state(
    store: &SessionStore,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
) -> Result<
    (
        crate::ServiceSnapshot,
        BTreeMap<String, DurableTorrentViewState>,
    ),
    ApplicationError,
> {
    let mut snapshot = store.snapshot()?;
    apply_runtime_storage_availability(&mut snapshot, storage_roots);
    let tracker_https_authentication = store.client_settings()?.tracker_https_server_authentication;
    let goal_limits = SeedGoalLimits {
        share_ratio_limit_percent: snapshot.client_settings.share_ratio_limit_percent,
        finished_download_ratio_limit_percent: snapshot
            .client_settings
            .finished_download_ratio_limit_percent,
        finished_time_limit_seconds: snapshot.client_settings.finished_time_limit_seconds,
    };
    let mut durable = BTreeMap::new();
    for torrent in &snapshot.torrents {
        let Ok(resume) = store.load_resume(&torrent.torrent_id) else {
            durable.insert(
                torrent.torrent_id.clone(),
                DurableTorrentViewState {
                    display_name: None,
                    source_display_name: None,
                    checking_generation: None,
                    verified: Vec::new(),
                    files: None,
                    eta_geometry: None,
                    trackers: TrackerViewModel::default(),
                    total_size: 0,
                    lifetime: crate::TorrentLifetimeView::default(),
                    seeding: crate::TorrentSeedingView::default(),
                },
            );
            continue;
        };
        let verified_pieces = resume.have.as_ref().map_or(&[][..], |have| have.pieces());
        let verified_indices = verified_pieces
            .iter()
            .enumerate()
            .filter(|(_, verified)| **verified)
            .map(|(index, _)| u32::try_from(index))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ApplicationError::Configuration("piece index overflows u32".to_owned()))?;
        let content = resume
            .raw_info
            .as_ref()
            .and_then(|_| parse_resume_content(&resume).ok());
        let display_name = content.as_ref().map(|content| content.name().to_owned());
        let source_display_name = Magnet::parse(&resume.magnet)
            .ok()
            .and_then(|magnet| magnet.display_name);
        let files = if let Some(content) = content.as_ref() {
            let filesystem_content_base = filesystem_content_base(
                storage_roots.get(&resume.storage_root),
                &torrent.torrent_id,
                content.name(),
            )?;
            FileProgressModel::new_content_with_media(
                content,
                &resume.skip_files,
                &resume.high_priority_files,
                &verified_indices,
                filesystem_content_base,
                media_catalog_availability(torrent, &resume, storage_roots),
            )
            .ok()
        } else {
            None
        };
        let trackers =
            TrackerViewModel::from_trackers(&resume.trackers, tracker_https_authentication);
        let eta_geometry = files
            .as_ref()
            .zip(resume.have.as_ref())
            .map(|(files, have)| files.required_payload_geometry(have.pieces()))
            .transpose()
            .map_err(|error| ApplicationError::Configuration(error.to_string()))?;
        let total_size = content
            .as_ref()
            .map(|content| ContentLayout::from_content(content).total_length())
            .unwrap_or(0);
        let seeding = if torrent.state == TorrentState::Complete {
            crate::TorrentSeedingView {
                admission: if torrent.download_queue_position.is_some() {
                    // A selection expansion can leave every newly wanted
                    // piece verified while its bytes still need promotion
                    // out of the part file. The download queue, not stale seed
                    // admission, owns that materialization generation.
                    crate::SeedAdmissionView::Ineligible
                } else if torrent.desired_running
                    && !torrent.archived
                    && torrent.removal_state.is_none()
                {
                    crate::SeedAdmissionView::Queued
                } else {
                    crate::SeedAdmissionView::Ineligible
                },
                goal: Some(torrent_seed_goal_view(
                    resume.accounting,
                    total_size,
                    goal_limits,
                )?),
            }
        } else {
            crate::TorrentSeedingView::default()
        };
        durable.insert(
            torrent.torrent_id.clone(),
            DurableTorrentViewState {
                display_name,
                source_display_name,
                checking_generation: resume
                    .verification
                    .is_pending()
                    .then_some(resume.verification.requested()),
                verified: ranges_from_pieces(verified_pieces),
                files,
                eta_geometry,
                trackers,
                total_size,
                lifetime: torrent_lifetime_view(resume.accounting, total_size),
                seeding,
            },
        );
    }
    Ok((snapshot, durable))
}

fn media_catalog_availability(
    torrent: &crate::TorrentSnapshot,
    resume: &ResumeRecord,
    storage_roots: &BTreeMap<String, StorageRootLocation>,
) -> MediaFileAvailability {
    if torrent.removal_state.is_some() {
        MediaFileAvailability::Removing
    } else if resume.verification.is_pending() || resume.state == TorrentState::Checking {
        MediaFileAvailability::Checking
    } else if !storage_roots.contains_key(&resume.storage_root) {
        MediaFileAvailability::StorageUnavailable
    } else if torrent.state == TorrentState::Downloading {
        MediaFileAvailability::Streamable
    } else if matches!(
        resume.state,
        TorrentState::NeedsRepair | TorrentState::Error
    ) {
        MediaFileAvailability::Incomplete
    } else {
        MediaFileAvailability::Available
    }
}

fn filesystem_content_base(
    storage_root: Option<&StorageRootLocation>,
    torrent_id: &str,
    content_name: &str,
) -> Result<Option<String>, ApplicationError> {
    let Some(StorageRootLocation::Path(root)) = storage_root else {
        return Ok(None);
    };
    let root = if root.is_absolute() {
        root.clone()
    } else {
        std::env::current_dir()
            .map_err(|source| ApplicationError::Io {
                operation: "resolve storage root",
                source,
            })?
            .join(root)
    };
    let torrent_id = torrent_id
        .parse::<TorrentId>()
        .map_err(|_| ApplicationError::Configuration("invalid torrent identity".to_owned()))?;
    let path = torrent_storage_paths(&root, content_name, torrent_id)
        .map_err(|error| ApplicationError::Configuration(error.to_string()))?
        .content;
    path.into_os_string()
        .into_string()
        .map(Some)
        .map_err(|_| ApplicationError::Configuration("storage path is not UTF-8".to_owned()))
}

#[derive(Debug)]
pub enum ApplicationError {
    Store(StoreError),
    Io {
        operation: &'static str,
        source: std::io::Error,
    },
    Configuration(String),
    Persistence(String),
    Busy(String),
    Join(String),
    StorePoisoned,
    Subscription(SubscriptionError),
    Dht(DhtError),
    Incoming(IncomingPeerError),
    SessionSocket(SessionSocketError),
    SessionUdp(SessionUdpError),
    Utp(rstorrent_engine::UtpRuntimeError),
    IncomingSeeding(String),
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
            Self::Configuration(message) => {
                write!(formatter, "application configuration: {message}")
            }
            Self::Persistence(message) => write!(formatter, "application persistence: {message}"),
            Self::Busy(torrent_id) => {
                write!(
                    formatter,
                    "torrent {torrent_id} already owns the download slot"
                )
            }
            Self::Join(message) => write!(formatter, "engine task join: {message}"),
            Self::StorePoisoned => write!(formatter, "session store lock is poisoned"),
            Self::Subscription(error) => write!(formatter, "{error}"),
            Self::Dht(error) => write!(formatter, "{error}"),
            Self::Incoming(error) => write!(formatter, "{error}"),
            Self::SessionSocket(error) => write!(formatter, "{error}"),
            Self::SessionUdp(error) => write!(formatter, "{error}"),
            Self::Utp(error) => write!(formatter, "{error}"),
            Self::IncomingSeeding(error) => write!(formatter, "incoming seeding: {error}"),
        }
    }
}

impl Error for ApplicationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Store(error) => Some(error),
            Self::Io { source, .. } => Some(source),
            Self::Subscription(error) => Some(error),
            Self::Dht(error) => Some(error),
            Self::Incoming(error) => Some(error),
            Self::SessionSocket(error) => Some(error),
            Self::SessionUdp(error) => Some(error),
            Self::Utp(error) => Some(error),
            _ => None,
        }
    }
}

impl From<StoreError> for ApplicationError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<DhtError> for ApplicationError {
    fn from(error: DhtError) -> Self {
        Self::Dht(error)
    }
}

impl From<IncomingPeerError> for ApplicationError {
    fn from(error: IncomingPeerError) -> Self {
        Self::Incoming(error)
    }
}

impl From<SessionSocketError> for ApplicationError {
    fn from(error: SessionSocketError) -> Self {
        Self::SessionSocket(error)
    }
}

impl From<SessionUdpError> for ApplicationError {
    fn from(error: SessionUdpError) -> Self {
        Self::SessionUdp(error)
    }
}

impl From<SessionNetworkError> for ApplicationError {
    fn from(error: SessionNetworkError) -> Self {
        match error {
            SessionNetworkError::Configuration(message) => Self::Configuration(message),
            SessionNetworkError::Discovery(error) => Self::Configuration(error.to_string()),
            SessionNetworkError::Dht(error) => Self::Dht(error),
            SessionNetworkError::Incoming(error) => Self::Incoming(error),
            SessionNetworkError::SessionSocket(error) => Self::SessionSocket(error),
            SessionNetworkError::SessionUdp(error) => Self::SessionUdp(error),
            SessionNetworkError::Utp(error) => Self::Utp(error),
        }
    }
}

impl From<IncomingSeedingError> for ApplicationError {
    fn from(error: IncomingSeedingError) -> Self {
        Self::IncomingSeeding(error.to_string())
    }
}

impl From<SubscriptionError> for ApplicationError {
    fn from(error: SubscriptionError) -> Self {
        Self::Subscription(error)
    }
}

#[cfg(test)]
fn encode_info_hash(info_hash: [u8; 20]) -> String {
    let mut output = String::with_capacity(40);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in info_hash {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

pub fn application_error_response(
    request_id: String,
    revision: u64,
    error: &ApplicationError,
) -> ResponseEnvelope {
    let code = match error {
        ApplicationError::Busy(_) => ErrorCode::Busy,
        ApplicationError::Configuration(_) => ErrorCode::InvalidRequest,
        ApplicationError::Store(error) if error.is_resource_limit() => ErrorCode::ResourceLimit,
        ApplicationError::Store(StoreError::UnknownTorrent(_)) => ErrorCode::UnknownTorrent,
        ApplicationError::Store(StoreError::DurableState(_) | StoreError::Have(_)) => {
            ErrorCode::InvalidDurableState
        }
        _ => ErrorCode::Internal,
    };
    ResponseEnvelope::error(request_id, revision, code, error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use rstorrent_engine::dht::BootstrapNode;
    use rstorrent_engine::peer::{PeerEndpoint, PeerObservation, PeerSource};
    use rstorrent_engine::{
        ApplicationNetworkPrerequisite, ByteMetric, ByteMetricSink, CheckerPhase, DEFAULT_PEER_ID,
        DownloadError, NetworkConfig, NetworkPolicy, PeerBudgetDirection, PlatformStorageFailure,
        PlatformStorageFailureKind, PlatformStorageOperation, StorageFileKey, StorageFileLocator,
        StorageFileReference, StorageFileRole, StorageObjectKind, StorageObservation, TorrentId,
        platform_storage_channel, torrent_storage_paths,
    };
    use rstorrent_protocol::content::TorrentContentProjection;
    use rstorrent_protocol::dht::{
        DhtEndpoint, DhtIp, Message as DhtMessage, NodeId, decode_message as decode_dht,
        encode_response as encode_dht_response,
    };
    use rstorrent_protocol::identity::SwarmKey;
    use rstorrent_protocol::merkle::{file_root_from_data, piece_root_from_data};
    use rstorrent_protocol::metadata::{
        MetadataMessage, encode_extension_handshake, encode_metadata_data, parse_metadata_message,
    };
    use rstorrent_protocol::metainfo::DURABLE_METAINFO_LIMITS;
    use rstorrent_protocol::peer_wire::{
        BlockRequest, EXTENSION_PROTOCOL_RESERVED_BIT, EXTENSION_PROTOCOL_RESERVED_INDEX,
        FrameDecoder, HANDSHAKE_LENGTH, PeerMessage, PeerProtocol, decode_handshake,
        encode_handshake, encode_handshake_with_reserved, encode_message,
    };
    use rusqlite::Connection;
    use sha1::{Digest, Sha1};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream, UdpSocket};

    use super::{
        ApplicationConfig, ApplicationError, ApplicationService, DirectPayloadManifest,
        PathRootStartupPolicy, PlatformRemovalPath, delete_path_artifacts,
        drain_product_milestones, handle_task_outcome, magnet_runtime_identity, runtime_identity,
    };
    use crate::{
        AddTorrentBytesRequest, ApplicationCall, ApplicationCallResult, CONTROL_VERSION,
        CatalogPageRequest, ClientSettings, Command, CommandResult, ConfiguredStorageRoot,
        DeliveryPolicy, DhtLifecycleView, DiagnosticFilter, DiagnosticProfile, DiagnosticSeverity,
        EncryptionPolicy, FilePriority, HttpsServerAuthenticationPolicy, ListenerBindFailureReason,
        ListenerPolicy, ListenerStatus, MediaRangeError, MediaResolveError, MediaUrlOutcome,
        OpenViewSetOptions, OpenViewSetRequest, PeerDirection, PeerFlagView, PeerLifecycle,
        PeerRole, PeerSourceView, PeerTransportKind, PeerView, ProductStateOwner,
        ProgressDisposition, ProgressReason, RemovalDataPolicy, RemovalState, RequestEnvelope,
        ResponseOutcome, SessionStore, StorageState, StoreError, SubscriptionSpec,
        SwarmCatalogState, SwarmPeerState, SwarmPeerView, TorrentState,
        TrackerConnectionFamilyView, TrackerSecurityView, TrackerView, ViewDeliveryPolicy,
        ViewPatch, ViewProjection, ViewSelector, ViewSetError, ViewSetOwner, ViewSetUpdate,
        ViewSnapshot, ViewSpec, ViewUpdatePayload,
    };

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    fn test_root(label: &str) -> PathBuf {
        let sequence = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "rstorrent-application-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn tree_cleanup_manifest(files: &[&[&str]]) -> DirectPayloadManifest {
        let files = files
            .iter()
            .map(|components| PlatformRemovalPath {
                components: components
                    .iter()
                    .map(|component| (*component).to_owned())
                    .collect(),
            })
            .collect::<Vec<_>>();
        let mut directories = BTreeSet::from([Vec::new()]);
        for file in &files {
            for length in 1..file.components.len() {
                directories.insert(file.components[..length].to_vec());
            }
        }
        let mut directories = directories
            .into_iter()
            .map(|components| PlatformRemovalPath { components })
            .collect::<Vec<_>>();
        directories.sort_by_key(|directory| std::cmp::Reverse(directory.components.len()));
        DirectPayloadManifest {
            tree: true,
            files,
            directories,
        }
    }

    fn file_cleanup_manifest() -> DirectPayloadManifest {
        DirectPayloadManifest {
            tree: false,
            files: vec![PlatformRemovalPath {
                components: Vec::new(),
            }],
            directories: Vec::new(),
        }
    }

    fn default_config(root: &Path) -> ApplicationConfig {
        ApplicationConfig::new(
            root.join("profile"),
            "test".to_owned(),
            vec![ConfiguredStorageRoot::path(
                "downloads",
                root.join("payload"),
            )],
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                std::time::Duration::from_secs(5),
                std::time::Duration::from_secs(5),
            ),
        )
    }

    #[test]
    fn product_milestone_drain_replays_after_product_commit_and_preserves_gaps() {
        let root = test_root("product-drain-replay");
        let configured = ConfiguredStorageRoot::path("downloads", root.join("payload"));
        let store = Arc::new(std::sync::Mutex::new(
            SessionStore::open_ephemeral("test", std::slice::from_ref(&configured))
                .expect("open profile"),
        ));
        store
            .lock()
            .expect("lock profile")
            .handle_durable(&add_request(
                "product-drain-first",
                "1010101010101010101010101010101010101010",
            ))
            .expect("add first torrent");
        let product_state = ProductStateOwner::open_ephemeral("0.1.0").expect("open product state");
        let pending = store
            .lock()
            .expect("lock profile")
            .pending_product_milestones()
            .expect("read pending milestone");
        product_state
            .apply_milestones(&pending)
            .expect("simulate product commit before profile acknowledgement");

        let replay = drain_product_milestones(&store, &product_state).expect("replay drain");
        assert_eq!(replay.applied, 1);
        assert_eq!(
            product_state
                .summary()
                .expect("read replayed summary")
                .torrents_added,
            "1"
        );
        assert!(
            store
                .lock()
                .expect("lock profile")
                .pending_product_milestones()
                .expect("read acknowledged outbox")
                .is_empty()
        );

        store
            .lock()
            .expect("lock profile")
            .handle_durable(&add_request(
                "product-drain-second",
                "2020202020202020202020202020202020202020",
            ))
            .expect("add second torrent");
        let fresh_product = ProductStateOwner::open_ephemeral("0.1.0").expect("fresh product");
        let error = drain_product_milestones(&store, &fresh_product)
            .expect_err("a lost product watermark must not guess across a gap");
        assert!(error.contains("sequence gap"));
        assert_eq!(
            store
                .lock()
                .expect("lock profile")
                .snapshot()
                .expect("torrent state remains authoritative")
                .torrents
                .len(),
            2
        );
        assert_eq!(
            store
                .lock()
                .expect("lock profile")
                .pending_product_milestones()
                .expect("failed drain remains pending")
                .len(),
            1
        );
        assert_eq!(
            fresh_product
                .summary()
                .expect("fresh product remains unchanged")
                .torrents_added,
            "0"
        );
    }

    #[tokio::test]
    async fn application_owns_and_joins_the_product_milestone_drain() {
        let root = test_root("product-drain-owner");
        let product_state = ProductStateOwner::open_ephemeral("0.1.0").expect("open product state");
        let mut config = default_config(&root).with_initial_network_prerequisite(
            ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
        );
        config.product_state = Some(product_state.clone());
        let mut application = ApplicationService::open(config)
            .await
            .expect("open application");
        application
            .dispatch(add_request(
                "product-owner-add",
                "3030303030303030303030303030303030303030",
            ))
            .await
            .expect("add through application");
        application.shutdown().await.expect("join application");

        let summary = product_state.summary().expect("read product summary");
        assert_eq!(summary.torrents_added, "1");
        let reopened = SessionStore::open(
            &root.join("profile"),
            "test",
            &[ConfiguredStorageRoot::path(
                "downloads",
                root.join("payload"),
            )],
        )
        .expect("reopen drained profile");
        assert!(
            reopened
                .pending_product_milestones()
                .expect("joined drain acknowledged outbox")
                .is_empty()
        );

        drop(reopened);
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn fresh_profile_defaults_follow_the_network_boundary() {
        let root = test_root("fresh-network-defaults");
        let loopback = default_config(&root).with_fresh_profile_defaults();
        assert_eq!(
            loopback.initial_client_settings.listener,
            ListenerPolicy::AutomaticLoopback
        );
        assert_eq!(
            loopback.initial_client_settings.port_mapping,
            crate::PortMappingPolicy::Disabled
        );

        let mut online = default_config(&root);
        online.network.policy = NetworkPolicy::Online;
        let online = online.with_fresh_profile_defaults();
        assert_eq!(
            online.initial_client_settings.listener,
            ListenerPolicy::AutomaticLocalNetwork
        );
        assert_eq!(
            online.initial_client_settings.port_mapping,
            crate::PortMappingPolicy::Upnp
        );

        let mut offline = default_config(&root);
        offline.network.policy = NetworkPolicy::Offline;
        let offline = offline.with_fresh_profile_defaults();
        assert_eq!(
            offline.initial_client_settings.listener,
            ListenerPolicy::Disabled
        );
        assert_eq!(
            offline.initial_client_settings.port_mapping,
            crate::PortMappingPolicy::Disabled
        );
    }

    #[test]
    fn application_network_prerequisite_defaults_allowed_and_can_start_closed() {
        let root = test_root("network-prerequisite-config");
        let allowed = default_config(&root);
        assert_eq!(
            allowed.initial_network_prerequisite,
            ApplicationNetworkPrerequisite::Allowed
        );

        let closed = allowed.with_initial_network_prerequisite(
            ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
        );
        assert_eq!(
            closed.initial_network_prerequisite,
            ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork
        );
    }

    #[tokio::test]
    async fn application_network_prerequisite_starts_closed_and_restarts_owners() {
        let root = test_root("network-prerequisite-runtime");
        let mut application =
            ApplicationService::open(default_config(&root).with_initial_network_prerequisite(
                ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
            ))
            .await
            .expect("open initially blocked application");

        assert!(application.session_network.is_none());
        assert_eq!(application.peer_budget_snapshot().total, 0);
        assert_eq!(application.mse_dh_work_snapshot().tracked, 0);
        let initial = application.network_prerequisite_snapshot();
        assert!(!initial.is_allowed());
        assert_eq!(application.effective_network_prerequisite(), initial);
        let initially_blocked_view = client_settings_runtime(&application).await;
        assert_eq!(
            initially_blocked_view.application_network.state,
            crate::ApplicationNetworkRuntimeState::Blocked
        );
        assert_eq!(
            initially_blocked_view
                .application_network
                .requested_prerequisite,
            crate::ApplicationNetworkPrerequisiteView::WaitingForUnmeteredNetwork
        );

        let allowed = application
            .network_prerequisite_handle()
            .allow()
            .expect("allow application networking");
        application
            .reconcile_network_prerequisite()
            .await
            .expect("start network owners");
        assert!(application.session_network.is_some());
        assert_eq!(application.effective_network_prerequisite(), allowed);
        assert!(application.session_udp_snapshot().is_some());

        let blocked = application
            .network_prerequisite_handle()
            .close()
            .expect("close application networking");
        application
            .reconcile_network_prerequisite()
            .await
            .expect("stop network owners");
        assert!(application.session_network.is_none());
        assert_eq!(application.effective_network_prerequisite(), blocked);
        assert!(application.session_udp_snapshot().is_none());
        let blocked_view = client_settings_runtime(&application).await;
        assert_eq!(
            blocked_view.application_network.state,
            crate::ApplicationNetworkRuntimeState::Blocked
        );
        assert_eq!(
            application
                .session_download_resource_snapshot()
                .registered_generations,
            0
        );

        application.shutdown().await.expect("shutdown application");
    }

    #[tokio::test]
    async fn blocked_network_preserves_add_and_pause_intent() {
        let root = test_root("network-prerequisite-intent");
        let configuration = default_config(&root).with_initial_network_prerequisite(
            ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
        );
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open blocked intent store");
        let raw_info = single_file_info("paused.bin", b"paused payload", 14);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = add_store_torrent(
            &mut store,
            "add-blocked-intent",
            &super::encode_info_hash(info_hash),
        );
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record blocked intent metadata");
        drop(store);
        let mut application = ApplicationService::open(configuration)
            .await
            .expect("open blocked intent application");
        assert!(application.active_download_ids().is_empty());
        assert!(
            application
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("added blocked torrent")
                .desired_running
        );

        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-while-network-blocked".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause while blocked");
        assert!(
            !application
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("paused blocked torrent")
                .desired_running
        );

        application
            .network_prerequisite_handle()
            .allow()
            .expect("allow paused blocked application");
        application
            .reconcile_network_prerequisite()
            .await
            .expect("start owners around paused torrent");
        assert!(application.active_download_ids().is_empty());
        assert!(
            !application
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("paused torrent after allow")
                .desired_running
        );

        application.shutdown().await.expect("shutdown application");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn path_part_directory_requires_an_absolute_capability() {
        let root = test_root("relative-path-part-directory");
        let error = ApplicationService::open(
            default_config(&root).with_path_part_directory(PathBuf::from("relative-parts")),
        )
        .await
        .expect_err("reject relative part directory");

        assert!(matches!(
            error,
            ApplicationError::Configuration(message)
                if message == "path part directory must be absolute"
        ));
        assert!(!root.exists());
    }

    #[tokio::test]
    async fn preserve_unavailable_policy_does_not_create_a_missing_path_root() {
        let root = test_root("preserve-missing-root");
        let payload = root.join("payload");
        let mut service = ApplicationService::open(
            default_config(&root)
                .with_path_root_startup_policy(PathRootStartupPolicy::PreserveUnavailable),
        )
        .await
        .expect("open application with unavailable storage");

        assert!(!payload.exists());
        let snapshot = service
            .store
            .lock()
            .expect("session store")
            .snapshot()
            .expect("service snapshot");
        assert_eq!(snapshot.storage.roots.len(), 1);
        assert_eq!(
            snapshot.storage.roots[0].availability,
            crate::StorageRootAvailability::Unavailable
        );

        service.shutdown().await.expect("shutdown application");
        assert!(!payload.exists());
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    fn config(root: &Path) -> ApplicationConfig {
        let mut config = default_config(root);
        config.peer_transport_policy = rstorrent_engine::PeerTransportPolicy::TcpOnly;
        config
    }

    fn persist_client_settings(config: &ApplicationConfig, settings: ClientSettings) {
        let mut store = SessionStore::open(
            config
                .durable_profile_root()
                .expect("test configuration is durable"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open settings fixture store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "configure-client-settings".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: settings.into(),
                },
            })
            .expect("configure client settings");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
    }

    fn add_request(request_id: &str, torrent_id: &str) -> RequestEnvelope {
        RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe=127.0.0.1:1"),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        }
    }

    fn add_store_torrent(store: &mut SessionStore, request_id: &str, info_hash: &str) -> String {
        let response = store
            .handle_durable(&add_request(request_id, info_hash))
            .expect("add fixture torrent");
        match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("fixture add response omitted its torrent owner"),
        }
    }

    fn owner_bytes(torrent_id: &str) -> [u8; 16] {
        torrent_id
            .parse::<TorrentId>()
            .expect("valid fixture torrent owner")
            .into_bytes()
    }

    fn multi_file_info() -> Vec<u8> {
        let mut info = b"d5:filesld6:lengthi4e4:pathl5:a.bineed6:lengthi4e4:pathl5:b.bineee4:name5:multi12:piece lengthi4e6:pieces40:".to_vec();
        info.extend_from_slice(&[b'a'; 20]);
        info.extend_from_slice(&[b'b'; 20]);
        info.push(b'e');
        info
    }

    fn single_file_info(name: &str, payload: &[u8], piece_length: usize) -> Vec<u8> {
        let hashes = payload
            .chunks(piece_length)
            .flat_map(|piece| Sha1::digest(piece).to_vec())
            .collect::<Vec<_>>();
        let mut info = format!(
            "d6:lengthi{}e4:name{}:{}12:piece lengthi{}e6:pieces{}:",
            payload.len(),
            name.len(),
            name,
            piece_length,
            hashes.len()
        )
        .into_bytes();
        info.extend_from_slice(&hashes);
        info.push(b'e');
        info
    }

    fn bencode_bytes(output: &mut Vec<u8>, value: &[u8]) {
        output.extend_from_slice(value.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(value);
    }

    fn pure_v2_source_for_payload(payload: &[u8], piece_length: u32) -> Vec<u8> {
        let root = file_root_from_data(payload).expect("nonempty pure-v2 fixture");
        let mut info = format!(
            "d9:file treed1:ad0:d6:lengthi{}e11:pieces root32:",
            payload.len()
        )
        .into_bytes();
        info.extend_from_slice(&root);
        info.extend_from_slice(b"eee12:meta versioni2e4:name4:root12:piece lengthi");
        info.extend_from_slice(piece_length.to_string().as_bytes());
        info.extend_from_slice(b"ee");
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersd");
        if payload.len() > piece_length as usize {
            bencode_bytes(&mut source, &root);
            let piece_roots = payload
                .chunks(piece_length as usize)
                .map(|piece| piece_root_from_data(piece, piece_length).expect("pure-v2 piece root"))
                .collect::<Vec<_>>();
            bencode_bytes(&mut source, &piece_roots.concat());
        }
        source.extend_from_slice(b"ee");
        source
    }

    fn pure_v2_source() -> Vec<u8> {
        pure_v2_source_for_payload(b"x", 16_384)
    }

    fn hybrid_source() -> Vec<u8> {
        let roots = [
            file_root_from_data(&[1]).expect("first hybrid file root"),
            file_root_from_data(&[2]).expect("second hybrid file root"),
        ];
        let mut first_v1_piece = vec![0; 16_384];
        first_v1_piece[0] = 1;
        let v1_piece_hashes = [
            <[u8; 20]>::from(Sha1::digest(&first_v1_piece)),
            <[u8; 20]>::from(Sha1::digest([2])),
        ];
        let mut tree = vec![b'd'];
        for (name, root) in [(b'a', roots[0]), (b'b', roots[1])] {
            bencode_bytes(&mut tree, &[name]);
            tree.extend_from_slice(b"d0:d6:lengthi1e11:pieces root32:");
            tree.extend_from_slice(&root);
            tree.extend_from_slice(b"ee");
        }
        tree.push(b'e');
        let mut info = b"d9:file tree".to_vec();
        info.extend_from_slice(&tree);
        info.extend_from_slice(
            concat!(
                "5:filesl",
                "d6:lengthi1e4:pathl1:aee",
                "d4:attr1:p6:lengthi16383ee",
                "d6:lengthi1e4:pathl1:bee",
                "e12:meta versioni2e4:name4:root12:piece lengthi16384e",
                "6:pieces40:"
            )
            .as_bytes(),
        );
        info.extend_from_slice(&v1_piece_hashes.concat());
        info.push(b'e');
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersdee");
        source
    }

    fn torrent_bytes_request(
        request_id: &str,
        source: &[u8],
        start_content: bool,
    ) -> AddTorrentBytesRequest {
        AddTorrentBytesRequest {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            storage_root: "downloads".to_owned(),
            start_content,
            await_file_selection: false,
            selection: crate::FileSelectionIntent::All,
            source_length: source.len() as u32,
        }
    }

    async fn read_peer_message(
        stream: &mut tokio::net::TcpStream,
        decoder: &mut FrameDecoder,
        pending: &mut std::collections::VecDeque<PeerMessage>,
    ) -> PeerMessage {
        loop {
            if let Some(message) = pending.pop_front() {
                return message;
            }
            let mut bytes = [0_u8; 1024];
            let length = stream.read(&mut bytes).await.expect("read peer message");
            assert_ne!(length, 0, "peer closed before expected message");
            pending.extend(decoder.push(&bytes[..length]).expect("decode peer message"));
        }
    }

    async fn wait_for_seed_registrations(service: &ApplicationService, expected: usize) {
        let mut last = None;
        let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                last = service.incoming_peer_snapshot();
                if last
                    .as_ref()
                    .is_some_and(|snapshot| snapshot.registrations == expected)
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await;
        assert!(
            outcome.is_ok(),
            "incoming seed registration count did not reach {expected}; last={last:?}"
        );
    }

    async fn client_settings_runtime(
        service: &ApplicationService,
    ) -> crate::ClientSettingsRuntimeView {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 8 * 1_024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to client settings");
        let update = subscription
            .next_update()
            .await
            .expect("initial client settings snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::TorrentList {
                client_settings, ..
            },
        } = update.payload
        else {
            panic!("expected torrent-list client settings snapshot");
        };
        client_settings
    }

    async fn torrent_summary(service: &ApplicationService, torrent_id: &str) -> crate::TorrentView {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::Torrent {
                    torrent_id: torrent_id.to_owned(),
                },
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 8 * 1_024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to torrent summary");
        let update = subscription
            .next_update()
            .await
            .expect("initial torrent summary snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Torrent {
                torrent: Some(torrent),
            },
        } = update.payload
        else {
            panic!("expected selected torrent summary snapshot");
        };
        torrent
    }

    async fn dht_runtime(service: &ApplicationService) -> crate::DhtInspectionView {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::SessionDht,
                projection: ViewProjection::Dht,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to DHT runtime");
        let update = subscription
            .next_update()
            .await
            .expect("initial DHT runtime snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::SessionDht { inspection },
        } = update.payload
        else {
            panic!("expected session DHT snapshot");
        };
        inspection
    }

    fn dht_ipv4_node_id(inspection: &crate::DhtInspectionView) -> &str {
        inspection
            .families
            .iter()
            .find(|family| family.family == crate::DhtAddressFamilyView::Ipv4)
            .map(|family| family.local_node_id.as_str())
            .expect("IPv4 DHT family")
    }

    async fn wait_for_client_settings(
        service: &ApplicationService,
        predicate: impl Fn(&crate::ClientSettingsRuntimeView) -> bool,
    ) -> crate::ClientSettingsRuntimeView {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let runtime = client_settings_runtime(service).await;
            if predicate(&runtime) {
                return runtime;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "client settings convergence deadline; last runtime: {runtime:#?}"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn torrent_peer_views(service: &ApplicationService, torrent_id: &str) -> Vec<PeerView> {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::Torrent {
                    torrent_id: torrent_id.to_owned(),
                },
                projection: ViewProjection::Peers,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 4096,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to torrent peers");
        let update = subscription
            .next_update()
            .await
            .expect("initial torrent peer snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Peers { peers, .. },
        } = update.payload
        else {
            panic!("expected torrent peer snapshot");
        };
        peers
    }

    async fn torrent_tracker_views(
        service: &ApplicationService,
        torrent_id: &str,
    ) -> Vec<TrackerView> {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::Torrent {
                    torrent_id: torrent_id.to_owned(),
                },
                projection: ViewProjection::Trackers,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 4096,
                },
                diagnostics: None,
                catalog_page: Some(CatalogPageRequest::default()),
            })
            .expect("subscribe to torrent trackers");
        let update = subscription
            .next_update()
            .await
            .expect("initial torrent tracker snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Trackers { trackers, .. },
        } = update.payload
        else {
            panic!("expected torrent tracker snapshot");
        };
        trackers
    }

    async fn torrent_swarm_view(
        service: &ApplicationService,
        torrent_id: &str,
    ) -> (SwarmCatalogState, Vec<SwarmPeerView>) {
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::Torrent {
                    torrent_id: torrent_id.to_owned(),
                },
                projection: ViewProjection::Swarm,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 4096,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to torrent swarm");
        let update = subscription
            .next_update()
            .await
            .expect("initial torrent swarm snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::Swarm { state, peers, .. },
        } = update.payload
        else {
            panic!("expected torrent swarm snapshot");
        };
        (state, peers)
    }

    async fn connect_application_seed(
        service: &ApplicationService,
        info_hash: [u8; 20],
        peer_id: [u8; 20],
    ) -> (
        tokio::net::TcpStream,
        FrameDecoder,
        std::collections::VecDeque<PeerMessage>,
    ) {
        connect_application_seed_with_extensions(service, info_hash, peer_id, false).await
    }

    async fn connect_application_active(
        service: &ApplicationService,
        info_hash: [u8; 20],
        peer_id: [u8; 20],
    ) -> tokio::net::TcpStream {
        let address = service
            .incoming_peer_snapshot()
            .expect("incoming service enabled")
            .listen_address;
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect application active route");
        stream
            .write_all(&encode_handshake(info_hash, peer_id))
            .await
            .expect("send active-route handshake");
        let mut handshake = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut handshake)
            .await
            .expect("read active-route handshake");
        decode_handshake(&handshake, info_hash).expect("valid active-route handshake");
        stream
    }

    async fn wait_for_active_route(service: &ApplicationService, expected: usize) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let snapshot = service
                    .incoming_peer_snapshot()
                    .expect("incoming service remains active");
                if snapshot.registrations == expected {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("active route registration did not converge");
    }

    async fn wait_for_incoming_established(service: &ApplicationService, expected: usize) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let snapshot = service
                    .incoming_peer_snapshot()
                    .expect("incoming service remains active");
                if snapshot.established == expected {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("incoming peer count did not converge");
    }

    async fn wait_for_incoming_close(stream: &mut tokio::net::TcpStream, label: &str) {
        tokio::time::timeout(Duration::from_secs(2), async {
            let mut tail = [0; 128];
            loop {
                if stream
                    .read(&mut tail)
                    .await
                    .expect("observe active incoming close")
                    == 0
                {
                    break;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{label} did not join the active incoming peer"));
    }

    async fn connect_application_seed_with_extensions(
        service: &ApplicationService,
        info_hash: [u8; 20],
        peer_id: [u8; 20],
        supports_extensions: bool,
    ) -> (
        tokio::net::TcpStream,
        FrameDecoder,
        std::collections::VecDeque<PeerMessage>,
    ) {
        connect_application_seed_with_expected_availability(
            service,
            info_hash,
            peer_id,
            supports_extensions,
            vec![0b1100_0000],
        )
        .await
    }

    async fn connect_application_seed_with_expected_availability(
        service: &ApplicationService,
        info_hash: [u8; 20],
        peer_id: [u8; 20],
        supports_extensions: bool,
        expected_bitfield: Vec<u8>,
    ) -> (
        tokio::net::TcpStream,
        FrameDecoder,
        std::collections::VecDeque<PeerMessage>,
    ) {
        let address = service
            .incoming_peer_snapshot()
            .expect("incoming service enabled")
            .listen_address;
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect application seed");
        let mut reserved = [0; 8];
        if supports_extensions {
            reserved[EXTENSION_PROTOCOL_RESERVED_INDEX] = EXTENSION_PROTOCOL_RESERVED_BIT;
        }
        stream
            .write_all(&encode_handshake_with_reserved(
                info_hash, peer_id, reserved,
            ))
            .await
            .expect("send seed handshake");
        let mut handshake = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut handshake)
            .await
            .expect("read seed handshake");
        decode_handshake(&handshake, info_hash).expect("valid seed handshake");
        let mut decoder = FrameDecoder::new();
        let mut pending = std::collections::VecDeque::new();
        assert_eq!(
            read_peer_message(&mut stream, &mut decoder, &mut pending).await,
            PeerMessage::Bitfield(expected_bitfield)
        );
        if supports_extensions {
            assert!(matches!(
                read_peer_message(&mut stream, &mut decoder, &mut pending).await,
                PeerMessage::Extended { id: 0, .. }
            ));
        }
        (stream, decoder, pending)
    }

    async fn spawn_metadata_peer(raw_info: Vec<u8>) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let (release, released) = tokio::sync::oneshot::channel();
        release.send(()).expect("release ordinary metadata peer");
        spawn_metadata_peer_after_release(raw_info, released).await
    }

    async fn spawn_gated_metadata_peer(
        raw_info: Vec<u8>,
    ) -> (
        SocketAddr,
        tokio::sync::oneshot::Sender<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let (release, released) = tokio::sync::oneshot::channel();
        let (address, task) = spawn_metadata_peer_after_release(raw_info, released).await;
        (address, release, task)
    }

    async fn spawn_metadata_peer_after_release(
        raw_info: Vec<u8>,
        released: tokio::sync::oneshot::Receiver<()>,
    ) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind metadata peer");
        let address = listener.local_addr().expect("metadata peer address");
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept metadata peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read metadata handshake");
            let handshake =
                decode_handshake(&handshake, info_hash).expect("metadata handshake identity");
            assert!(handshake.supports_extensions());
            let mut reserved = [0; 8];
            reserved[EXTENSION_PROTOCOL_RESERVED_INDEX] = EXTENSION_PROTOCOL_RESERVED_BIT;
            stream
                .write_all(&encode_handshake_with_reserved(
                    info_hash,
                    *b"-RS-EPHEMERAL-000000",
                    reserved,
                ))
                .await
                .expect("send metadata handshake");
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            assert!(matches!(
                read_peer_message(&mut stream, &mut decoder, &mut pending).await,
                PeerMessage::Extended { id: 0, .. }
            ));
            stream
                .write_all(
                    &encode_message(&PeerMessage::Extended {
                        id: 0,
                        payload: encode_extension_handshake(Some(raw_info.len())),
                    })
                    .expect("encode extension handshake"),
                )
                .await
                .expect("send extension handshake");
            let PeerMessage::Extended {
                id: 1,
                payload: request,
            } = read_peer_message(&mut stream, &mut decoder, &mut pending).await
            else {
                panic!("metadata request expected");
            };
            assert_eq!(
                parse_metadata_message(&request).expect("parse metadata request"),
                MetadataMessage::Request { piece: 0 }
            );
            released.await.expect("release metadata response");
            stream
                .write_all(
                    &encode_message(&PeerMessage::Extended {
                        id: 1,
                        payload: encode_metadata_data(0, raw_info.len(), &raw_info)
                            .expect("encode metadata"),
                    })
                    .expect("encode metadata message"),
                )
                .await
                .expect("send metadata");
            let mut tail = [0; 32];
            match stream.read(&mut tail).await {
                Ok(0) => {}
                Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
                outcome => panic!("metadata connection did not close: {outcome:?}"),
            }
        });
        (address, task)
    }

    #[tokio::test]
    async fn startup_and_live_limit_changes_admit_only_durable_queue_heads() {
        let root = test_root("automatic-admission-limits");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                active_downloads: 1,
                ..ClientSettings::default()
            },
        );
        let mut listeners = Vec::new();
        for _ in 0..4 {
            listeners.push(
                TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("bind held metadata peer"),
            );
        }
        let info_hashes = (1_u8..=4)
            .map(|value| format!("{value:02x}").repeat(20))
            .collect::<Vec<_>>();
        let mut ids = Vec::new();
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        for (index, listener) in listeners.iter().enumerate() {
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("add-admission-{index}"),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet: format!(
                            "magnet:?xt=urn:btih:{}&x.pe={}",
                            info_hashes[index],
                            listener.local_addr().expect("listener address")
                        ),
                        storage_root: "downloads".to_owned(),
                        start_content: false,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("persist queued magnet");
            let torrent_id = match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("queued magnet add result"),
            };
            ids.push(torrent_id);
        }
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open queued application");
        let (first_stream, _) = tokio::time::timeout(Duration::from_secs(2), listeners[0].accept())
            .await
            .expect("first queue head dials")
            .expect("accept first queue head");
        assert_eq!(service.active_download_ids(), vec![ids[0].clone()]);
        let initial_runtime = service.views.client_settings_for_testing();
        assert_eq!(initial_runtime.configured.active_downloads, 1);
        assert_eq!(initial_runtime.effective_active_downloads, 1);
        assert_eq!(initial_runtime.active_download_count, 1);
        assert_eq!(initial_runtime.checking_count, 0);
        assert_eq!(
            service
                .session_download_resource_snapshot()
                .registered_generations,
            1
        );
        for listener in &listeners[1..] {
            assert!(
                tokio::time::timeout(Duration::from_millis(50), listener.accept())
                    .await
                    .is_err(),
                "queued torrents must not dial"
            );
        }

        let increased = ClientSettings {
            active_downloads: 3,
            ..ClientSettings::default()
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "increase-active-downloads".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: increased.clone().into(),
                },
            })
            .await
            .expect("increase active limit");
        let (second_stream, _) =
            tokio::time::timeout(Duration::from_secs(2), listeners[1].accept())
                .await
                .expect("second queue entry dials")
                .expect("accept second queue entry");
        let (third_stream, _) = tokio::time::timeout(Duration::from_secs(2), listeners[2].accept())
            .await
            .expect("third queue entry dials")
            .expect("accept third queue entry");
        assert_eq!(
            service
                .active_download_ids()
                .into_iter()
                .collect::<BTreeSet<_>>(),
            ids[..3].iter().cloned().collect::<BTreeSet<_>>()
        );
        let increased_runtime = service.views.client_settings_for_testing();
        assert_eq!(increased_runtime.effective_active_downloads, 3);
        assert_eq!(increased_runtime.active_download_count, 3);
        assert_eq!(
            service
                .session_download_resource_snapshot()
                .registered_generations,
            3
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(50), listeners[3].accept())
                .await
                .is_err()
        );

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "decrease-active-downloads".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: ClientSettings {
                        active_downloads: 1,
                        ..increased
                    }
                    .into(),
                },
            })
            .await
            .expect("decrease active limit");
        assert_eq!(service.active_download_ids(), vec![ids[0].clone()]);
        let decreased_runtime = service.views.client_settings_for_testing();
        assert_eq!(decreased_runtime.effective_active_downloads, 1);
        assert_eq!(decreased_runtime.active_download_count, 1);
        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("snapshot");
        assert!(
            snapshot
                .torrents
                .iter()
                .all(|torrent| torrent.download_queue_position.is_some())
        );
        assert_eq!(
            service
                .session_download_resource_snapshot()
                .registered_generations,
            1
        );

        drop((first_stream, second_stream, third_stream));
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn terminal_wake_promotes_the_next_download_without_a_command() {
        let root = test_root("automatic-admission-terminal-wake");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                active_downloads: 1,
                ..ClientSettings::default()
            },
        );
        let first_info = single_file_info("first.bin", b"first", 5);
        let second_info = single_file_info("second.bin", b"second", 6);
        let first_hash = super::encode_info_hash(Sha1::digest(&first_info).into());
        let second_hash = super::encode_info_hash(Sha1::digest(&second_info).into());
        let (first_peer, release_first, first_task) = spawn_gated_metadata_peer(first_info).await;
        let (second_peer, second_task) = spawn_metadata_peer(second_info).await;
        let service = Arc::new(tokio::sync::Mutex::new(
            ApplicationService::open(configuration)
                .await
                .expect("open application"),
        ));
        ApplicationService::ensure_maintenance_owner(&service).await;
        let mut ids = Vec::new();
        for (request_id, info_hash, peer) in [
            ("add-first-metadata", &first_hash, first_peer),
            ("add-second-metadata", &second_hash, second_peer),
        ] {
            let response = service
                .lock()
                .await
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet: format!("magnet:?xt=urn:btih:{info_hash}&x.pe={peer}"),
                        storage_root: "downloads".to_owned(),
                        start_content: false,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .await
                .expect("add metadata acquisition");
            ids.push(match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("metadata acquisition add result"),
            });
        }
        let first_id = ids[0].clone();
        let second_id = ids[1].clone();
        assert_eq!(
            service.lock().await.active_download_ids(),
            vec![first_id.clone()]
        );
        release_first
            .send(())
            .expect("release first metadata response");

        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let complete = {
                    let service = service.lock().await;
                    service
                        .store_mut()
                        .expect("store")
                        .load_resume(&second_id)
                        .expect("second resume")
                        .raw_info
                        .is_some()
                };
                if complete {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("terminal wake did not promote the second torrent");
        first_task.await.expect("first metadata peer");
        second_task.await.expect("second metadata peer");
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if service.lock().await.active_download_ids().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("terminal owner did not reap the final metadata task");
        assert_eq!(
            service
                .lock()
                .await
                .session_download_resource_snapshot()
                .registered_generations,
            0
        );
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn platform_download_cap_is_visible_without_rewriting_configuration() {
        let root = test_root("automatic-admission-platform-cap");
        let mut configuration = config(&root);
        configuration.active_download_cap = Some(2);
        persist_client_settings(
            &configuration,
            ClientSettings {
                active_downloads: 3,
                ..ClientSettings::default()
            },
        );
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open capped application");
        let runtime = service.views.client_settings_for_testing();
        assert_eq!(runtime.configured.active_downloads, 3);
        assert_eq!(runtime.effective_active_downloads, 2);
        assert_eq!(
            runtime.active_downloads_clamp_reason,
            Some(crate::ActiveDownloadsClampReason::PlatformLimit)
        );
        assert_eq!(runtime.active_download_count, 0);
        assert_eq!(runtime.checking_count, 0);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn one_hundred_runnable_torrents_own_only_three_content_generations() {
        let root = test_root("automatic-admission-hundred-runnable");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                active_downloads: 3,
                ..ClientSettings::default()
            },
        );
        let listeners = [
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("listener one"),
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("listener two"),
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("listener three"),
        ];
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let mut ids = Vec::new();
        for sequence in 1_u64..=100 {
            let info_hash = format!("{sequence:040x}");
            let peer = usize::try_from(sequence - 1)
                .ok()
                .and_then(|index| listeners.get(index))
                .map(|listener| listener.local_addr().expect("listener address"));
            let magnet = match peer {
                Some(peer) => format!("magnet:?xt=urn:btih:{info_hash}&x.pe={peer}"),
                None => format!("magnet:?xt=urn:btih:{info_hash}"),
            };
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("add-hundred-{sequence}"),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet,
                        storage_root: "downloads".to_owned(),
                        start_content: false,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("persist runnable magnet");
            ids.push(match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("runnable magnet add result"),
            });
        }
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open hundred-torrent application");
        let mut streams = Vec::new();
        for listener in &listeners {
            streams.push(
                tokio::time::timeout(Duration::from_secs(2), listener.accept())
                    .await
                    .expect("admitted torrent dials")
                    .expect("accept admitted torrent")
                    .0,
            );
        }
        assert_eq!(
            service
                .active_download_ids()
                .into_iter()
                .collect::<BTreeSet<_>>(),
            ids[..3].iter().cloned().collect::<BTreeSet<_>>()
        );
        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("snapshot");
        assert_eq!(snapshot.torrents.len(), 100);
        assert_eq!(
            snapshot
                .torrents
                .iter()
                .filter(|torrent| torrent.download_queue_position.is_some())
                .count(),
            100
        );
        let resources = service.session_download_resource_snapshot();
        assert_eq!(resources.registered_generations, 3);
        assert_eq!(resources.active_storage_writes, 0);
        assert_eq!(resources.active_storage_hashes, 0);
        let runtime = service.views.client_settings_for_testing();
        assert_eq!(runtime.active_download_count, 3);
        assert_eq!(runtime.checking_count, 0);
        let discovery = service
            .session_network()
            .discovery_handle()
            .snapshot()
            .await
            .expect("discovery snapshot");
        assert_eq!(discovery.registrations, 100);
        assert_eq!(discovery.active_registrations, 3);
        assert!(discovery.tracker_operations <= 3);
        assert!(discovery.dht_operations <= 3);

        drop(streams);
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn five_hundred_complete_seeds_share_upload_slots_with_three_downloads() {
        let root = test_root("automatic-admission-five-hundred-seeds");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                port_mapping: crate::PortMappingPolicy::Disabled,
                peer_connection_limit: 200,
                upload_slots: 8,
                active_downloads: 3,
                active_seeds: crate::ActiveSeedLimit::Unlimited,
                ..ClientSettings::default()
            },
        );
        fs::create_dir_all(root.join("payload")).expect("create seed payload root");
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open seed catalog store");
        let payload = b"abcdefg";
        let mut seed_ids = Vec::with_capacity(500);
        let mut seed_identities = Vec::with_capacity(500);
        for sequence in 0..500_u16 {
            let name = format!("seed-{sequence}.bin");
            let raw_info = single_file_info(&name, payload, 4);
            let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
            let torrent_id = super::encode_info_hash(info_hash);
            let torrent_id =
                add_store_torrent(&mut store, &format!("add-seed-{sequence}"), &torrent_id);
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record complete seed metadata");
            store
                .record_pieces(&torrent_id, &[0, 1])
                .expect("record complete seed pieces");
            store.mark_complete(&torrent_id).expect("complete seed row");
            fs::write(root.join("payload").join(name), payload)
                .expect("write complete seed payload");
            seed_identities.push((torrent_id.clone(), info_hash));
            seed_ids.push(torrent_id);
        }

        let listeners = [
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("first active listener"),
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("second active listener"),
            TcpListener::bind("127.0.0.1:0")
                .await
                .expect("third active listener"),
        ];
        for (index, listener) in listeners.iter().enumerate() {
            let torrent_id = format!("{:040x}", 10_000 + index);
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("add-active-{index}"),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet: format!(
                            "magnet:?xt=urn:btih:{torrent_id}&x.pe={}",
                            listener.local_addr().expect("active listener address")
                        ),
                        storage_root: "downloads".to_owned(),
                        start_content: false,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("add active download row");
        }
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open combined seed and download session");
        let mut active_streams = Vec::new();
        for listener in &listeners {
            active_streams.push(
                tokio::time::timeout(Duration::from_secs(2), listener.accept())
                    .await
                    .expect("active download dials")
                    .expect("accept active download")
                    .0,
            );
        }
        wait_for_seed_registrations(&service, 497).await;
        assert_eq!(service.active_download_ids().len(), 3);
        assert_eq!(service.admitted_seeds.len(), 497);
        let admitted_seed = seed_identities
            .iter()
            .find(|(torrent_id, _)| service.admitted_seeds.contains(torrent_id))
            .map(|(_, info_hash)| *info_hash)
            .expect("one ranked seed wins admission");
        let resources = service.session_download_resource_snapshot();
        assert_eq!(resources.registered_generations, 3);
        assert_eq!(resources.active_storage_hashes, 0);
        let accounting = service
            .accounting_high_water()
            .expect("seed-scale accounting high water");
        assert_eq!(accounting.tracked_rows, 503);
        assert_eq!(accounting.uncommitted_payload_bytes, 0);
        assert!(accounting.dirty_rows <= 500);
        {
            let store = service.store_mut().expect("store after seed admission");
            for torrent_id in &seed_ids {
                let resume = store.load_resume(torrent_id).expect("complete seed resume");
                assert_eq!(resume.verification.requested(), 0);
                assert_eq!(resume.verification.completed(), 0);
            }
        }

        let mut incoming_peers = Vec::new();
        for generation in 1_u8..=10 {
            let (mut stream, decoder, pending) =
                connect_application_seed(&service, admitted_seed, [generation; 20]).await;
            stream
                .write_all(&encode_message(&PeerMessage::Interested).expect("encode interest"))
                .await
                .expect("send seed interest");
            incoming_peers.push((stream, decoder, pending));
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = service
                    .incoming_peer_snapshot()
                    .expect("incoming session remains active");
                if snapshot.upload_scheduler.interested == 10
                    && snapshot.upload_scheduler.regular == 7
                    && snapshot.upload_scheduler.optimistic == 1
                {
                    break snapshot;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("global upload grants converge beside downloads");
        let combined = service
            .incoming_peer_snapshot()
            .expect("combined incoming snapshot");
        assert_eq!(combined.registrations, 497);
        assert_eq!(combined.established, 10);
        assert_eq!(combined.upload_scheduler.peers, 10);
        assert_eq!(combined.upload_scheduler.interested, 10);
        assert_eq!(combined.upload_scheduler.regular, 7);
        assert_eq!(combined.upload_scheduler.optimistic, 1);
        assert_eq!(combined.torrent_uploads.len(), 497);
        assert_eq!(
            combined
                .torrent_uploads
                .iter()
                .map(|torrent| torrent.peers)
                .sum::<usize>(),
            10
        );
        assert!(combined.peer_budget.total <= 200);
        assert!(combined.peer_budget.total_high_water <= 200);
        let storage_resources = service.storage_file_pool_snapshot();
        assert!(storage_resources.owned_high_water <= 40);
        assert_eq!(storage_resources.platform_pending, 0);

        service.shutdown().await.expect("shutdown combined session");
        let terminal = service.session_download_resource_snapshot();
        assert_eq!(terminal.registered_generations, 0);
        assert_eq!(terminal.outstanding_request_bytes, 0);
        assert_eq!(terminal.buffered_payload_bytes, 0);
        drop((incoming_peers, active_streams, service));
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn seed_goal_crossing_and_live_limits_reconcile_and_restart_exactly() {
        let root = test_root("seed-goal-admission");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                active_seeds: crate::ActiveSeedLimit::Limited { torrents: 1 },
                ..ClientSettings::default()
            },
        );
        fs::create_dir_all(root.join("payload")).expect("create seed payload root");
        let payload = b"abcdefg";
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open seed-goal store");
        let mut seeds = Vec::new();
        for sequence in 0..2 {
            let name = format!("goal-seed-{sequence}.bin");
            let raw_info = single_file_info(&name, payload, payload.len());
            let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
            let torrent_id = add_store_torrent(
                &mut store,
                &format!("add-goal-seed-{sequence}"),
                &super::encode_info_hash(info_hash),
            );
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record seed metadata");
            store
                .record_pieces(&torrent_id, &[0])
                .expect("record seed piece");
            store.mark_complete(&torrent_id).expect("complete seed");
            fs::write(root.join("payload").join(name), payload).expect("write seed payload");
            seeds.push((torrent_id, info_hash));
        }
        seeds.sort_unstable_by(|left, right| left.0.cmp(&right.0));
        let preferred = seeds[0].clone();
        let initially_goal_unmet = seeds[1].clone();
        store
            .replace_accounting_batch(&[
                crate::store::TorrentAccountingUpdate {
                    torrent_id: preferred.0.parse().expect("preferred owner"),
                    accounting: crate::store::TorrentAccounting {
                        total_uploaded: 14,
                        total_downloaded: 7,
                        active_seconds: 1_801,
                        finished_seconds: 100,
                        seeding_seconds: 100,
                        tracker_complete: Some(2),
                        tracker_incomplete: Some(100),
                    },
                },
                crate::store::TorrentAccountingUpdate {
                    torrent_id: initially_goal_unmet.0.parse().expect("goal-unmet owner"),
                    accounting: crate::store::TorrentAccounting {
                        total_uploaded: 13,
                        total_downloaded: 7,
                        active_seconds: 1_801,
                        finished_seconds: 100,
                        seeding_seconds: 100,
                        tracker_complete: Some(2),
                        tracker_incomplete: Some(0),
                    },
                },
            ])
            .expect("seed rank accounting");
        drop(store);

        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open ranked seed service");
        wait_for_seed_registrations(&service, 1).await;
        assert_eq!(
            service.admitted_seeds,
            [initially_goal_unmet.0.clone()].into_iter().collect()
        );
        let runtime = client_settings_runtime(&service).await;
        assert_eq!(
            runtime.effective_active_seeds,
            crate::ActiveSeedLimit::Limited { torrents: 1 }
        );
        assert_eq!(runtime.active_seed_count, 1);
        assert_eq!(runtime.inactive_seed_count, 0);
        let active_view = torrent_summary(&service, &initially_goal_unmet.0).await;
        assert_eq!(
            active_view.operational_state,
            crate::TorrentOperationalState::Seeding
        );
        assert_eq!(active_view.lifetime.uploaded_payload_bytes, "13");
        assert_eq!(active_view.lifetime.downloaded_payload_bytes, "7");
        assert_eq!(
            active_view.lifetime.share_ratio_hundredths.as_deref(),
            Some("185")
        );
        assert_eq!(
            active_view.seeding.admission,
            crate::SeedAdmissionView::Active
        );
        assert_eq!(
            active_view.seeding.goal.as_ref().map(|goal| goal.status),
            Some(crate::SeedGoalStatusView::Unmet)
        );
        let queued_view = torrent_summary(&service, &preferred.0).await;
        assert_eq!(
            queued_view.operational_state,
            crate::TorrentOperationalState::Queued
        );
        assert_eq!(
            queued_view.seeding.admission,
            crate::SeedAdmissionView::Queued
        );
        let generations = service
            .torrent_runtimes
            .iter()
            .map(|(torrent_id, runtime)| (torrent_id.clone(), runtime.generation()))
            .collect::<BTreeMap<_, _>>();

        let (mut peer, mut decoder, mut pending) =
            connect_application_seed_with_expected_availability(
                &service,
                initially_goal_unmet.1,
                *b"-RS-GOAL-CROSS-00000",
                false,
                vec![0b1000_0000],
            )
            .await;
        peer.write_all(&encode_message(&PeerMessage::Interested).expect("encode interest"))
            .await
            .expect("send interest");
        assert_eq!(
            read_peer_message(&mut peer, &mut decoder, &mut pending).await,
            PeerMessage::Unchoke
        );
        peer.write_all(
            &encode_message(&PeerMessage::Request(BlockRequest {
                index: 0,
                begin: 0,
                length: 1,
            }))
            .expect("encode one-byte request"),
        )
        .await
        .expect("request goal-crossing byte");
        assert_eq!(
            read_peer_message(&mut peer, &mut decoder, &mut pending).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: b"a".to_vec(),
            }
        );
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "reconcile-seed-goal-crossing".to_owned(),
                expected_revision: None,
                command: Command::Snapshot,
            })
            .await
            .expect("reconcile crossed seed goal");
        assert_eq!(peer.read(&mut [0; 1]).await.expect("demoted peer close"), 0);
        wait_for_seed_registrations(&service, 1).await;
        assert_eq!(
            service.admitted_seeds,
            [preferred.0.clone()].into_iter().collect()
        );
        let crossed_view = torrent_summary(&service, &initially_goal_unmet.0).await;
        assert_eq!(
            crossed_view.operational_state,
            crate::TorrentOperationalState::Queued
        );
        assert_eq!(crossed_view.lifetime.uploaded_payload_bytes, "14");
        assert_eq!(
            crossed_view.lifetime.share_ratio_hundredths.as_deref(),
            Some("200")
        );
        assert_eq!(
            crossed_view.seeding.admission,
            crate::SeedAdmissionView::Queued
        );
        let crossed_goal = crossed_view.seeding.goal.expect("completed seed goal");
        assert_eq!(crossed_goal.status, crate::SeedGoalStatusView::Met);
        assert!(crossed_goal.share_ratio_met);
        service
            .maintain_accounting(true)
            .expect("flush crossed seed goal accounting");
        assert_eq!(
            service
                .store_mut()
                .unwrap()
                .load_resume(&initially_goal_unmet.0)
                .unwrap()
                .accounting
                .total_uploaded,
            14
        );

        for (request_id, limit, expected) in [
            (
                "zero-active-seeds",
                crate::ActiveSeedLimit::Limited { torrents: 0 },
                0,
            ),
            (
                "unlimited-active-seeds",
                crate::ActiveSeedLimit::Unlimited,
                2,
            ),
            (
                "one-active-seed",
                crate::ActiveSeedLimit::Limited { torrents: 1 },
                1,
            ),
        ] {
            service
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::UpdateClientSettings {
                        patch: crate::ClientSettingsPatch {
                            active_seeds: Some(limit),
                            ..crate::ClientSettingsPatch::default()
                        },
                    },
                })
                .await
                .expect("apply active-seed limit");
            wait_for_seed_registrations(&service, expected).await;
            assert_eq!(service.admitted_seeds.len(), expected);
            let runtime = client_settings_runtime(&service).await;
            assert_eq!(runtime.effective_active_seeds, limit);
            assert_eq!(runtime.active_seed_count, expected as u16);
            assert_eq!(runtime.inactive_seed_count, 0);
        }
        assert_eq!(
            service.admitted_seeds,
            [preferred.0.clone()].into_iter().collect()
        );
        for (torrent_id, _) in &seeds {
            assert!(
                service
                    .store_mut()
                    .unwrap()
                    .load_resume(torrent_id)
                    .unwrap()
                    .desired_running,
                "queued seed must retain desired-running intent: {torrent_id}"
            );
        }
        assert_eq!(
            service
                .torrent_runtimes
                .iter()
                .map(|(torrent_id, runtime)| (torrent_id.clone(), runtime.generation()))
                .collect::<BTreeMap<_, _>>(),
            generations
        );

        service
            .shutdown()
            .await
            .expect("shutdown ranked seed service");
        drop(service);
        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen ranked seed service");
        wait_for_seed_registrations(&reopened, 1).await;
        assert_eq!(
            reopened.admitted_seeds,
            [preferred.0.clone()].into_iter().collect()
        );
        assert_eq!(
            reopened
                .store_mut()
                .unwrap()
                .load_resume(&initially_goal_unmet.0)
                .unwrap()
                .accounting
                .total_uploaded,
            14
        );
        reopened.shutdown().await.expect("shutdown reopened seeds");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove seed-goal root");
    }

    async fn serve_single_piece_peer(
        listener: TcpListener,
        info_hash: [u8; 20],
        payload: Vec<u8>,
        request_started: tokio::sync::oneshot::Sender<()>,
        payload_release: tokio::sync::oneshot::Receiver<()>,
    ) {
        let (mut stream, _) = listener.accept().await.expect("accept content peer");
        let mut handshake = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut handshake)
            .await
            .expect("read content handshake");
        decode_handshake(&handshake, info_hash).expect("content handshake identity");
        stream
            .write_all(&encode_handshake(info_hash, *b"-RS-HTTP-IPV6-000000"))
            .await
            .expect("send content handshake");
        stream
            .write_all(&encode_message(&PeerMessage::Bitfield(vec![0x80])).expect("bitfield"))
            .await
            .expect("send content bitfield");
        let mut decoder = FrameDecoder::new();
        let mut pending = std::collections::VecDeque::new();
        let mut request_started = Some(request_started);
        let mut payload_release = Some(payload_release);
        loop {
            match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                PeerMessage::Interested => {
                    stream
                        .write_all(&encode_message(&PeerMessage::Unchoke).expect("unchoke"))
                        .await
                        .expect("send unchoke");
                }
                PeerMessage::Request(request) => {
                    assert_eq!(request.index, 0);
                    let begin = usize::try_from(request.begin).expect("request begin");
                    let length = usize::try_from(request.length).expect("request length");
                    let end = begin.checked_add(length).expect("request end");
                    if let Some(started) = request_started.take() {
                        let _ = started.send(());
                    }
                    if let Some(release) = payload_release.take() {
                        release.await.expect("release controlled peer payload");
                    }
                    stream
                        .write_all(
                            &encode_message(&PeerMessage::Piece {
                                index: 0,
                                begin: request.begin,
                                block: payload[begin..end].to_vec(),
                            })
                            .expect("piece"),
                        )
                        .await
                        .expect("send piece");
                    if end == payload.len() {
                        return;
                    }
                }
                PeerMessage::KeepAlive | PeerMessage::NotInterested => {}
                message => panic!("unexpected content message: {message:?}"),
            }
        }
    }

    async fn read_peer_message_or_closed(
        stream: &mut TcpStream,
        decoder: &mut FrameDecoder,
        pending: &mut std::collections::VecDeque<PeerMessage>,
    ) -> Option<PeerMessage> {
        loop {
            if let Some(message) = pending.pop_front() {
                return Some(message);
            }
            let mut bytes = [0_u8; 1_024];
            let length = stream.read(&mut bytes).await.expect("read peer message");
            if length == 0 {
                return None;
            }
            pending.extend(decoder.push(&bytes[..length]).expect("decode peer message"));
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn serve_restartable_two_piece_peer(
        listener: TcpListener,
        info_hash: [u8; 20],
        payload: Vec<u8>,
        piece_length: usize,
        withheld_request: tokio::sync::oneshot::Sender<()>,
        first_connection_closed: tokio::sync::oneshot::Sender<()>,
        connections: Arc<AtomicU64>,
        wire_writes: Arc<AtomicU64>,
    ) {
        let mut first_piece = None;
        let mut withheld_request = Some(withheld_request);
        let mut first_connection_closed = Some(first_connection_closed);
        for connection_index in 0..2 {
            let (mut stream, _) = listener.accept().await.expect("accept restartable peer");
            connections.fetch_add(1, Ordering::Relaxed);
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read restartable peer handshake");
            decode_handshake(&handshake, info_hash).expect("restartable peer identity");
            stream
                .write_all(&encode_handshake(info_hash, *b"-RS-NET-GATE-0000000"))
                .await
                .expect("send restartable peer handshake");
            wire_writes.fetch_add(1, Ordering::Relaxed);
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).expect("bitfield"))
                .await
                .expect("send restartable peer bitfield");
            wire_writes.fetch_add(1, Ordering::Relaxed);
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            loop {
                let Some(message) =
                    read_peer_message_or_closed(&mut stream, &mut decoder, &mut pending).await
                else {
                    assert_eq!(connection_index, 0, "resumed peer closed before completion");
                    first_connection_closed
                        .take()
                        .expect("first close signal")
                        .send(())
                        .ok();
                    break;
                };
                match message {
                    PeerMessage::Interested => {
                        stream
                            .write_all(&encode_message(&PeerMessage::Unchoke).expect("unchoke"))
                            .await
                            .expect("send restartable peer unchoke");
                        wire_writes.fetch_add(1, Ordering::Relaxed);
                    }
                    PeerMessage::Request(request) => {
                        let selected = *first_piece.get_or_insert(request.index);
                        if connection_index == 0 && request.index != selected {
                            if let Some(signal) = withheld_request.take() {
                                signal.send(()).ok();
                            }
                            continue;
                        }
                        let piece_index = usize::try_from(request.index).expect("piece index");
                        let piece_start =
                            piece_index.checked_mul(piece_length).expect("piece start");
                        let piece_end = piece_start.saturating_add(piece_length).min(payload.len());
                        let begin = usize::try_from(request.begin).expect("request begin");
                        let length = usize::try_from(request.length).expect("request length");
                        let end = begin.checked_add(length).expect("request end");
                        assert!(piece_start + end <= piece_end);
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Piece {
                                    index: request.index,
                                    begin: request.begin,
                                    block: payload[piece_start + begin..piece_start + end].to_vec(),
                                })
                                .expect("piece"),
                            )
                            .await
                            .expect("send restartable peer piece");
                        wire_writes.fetch_add(1, Ordering::Relaxed);
                        if connection_index == 1
                            && request.index != selected
                            && end == piece_end - piece_start
                        {
                            return;
                        }
                    }
                    PeerMessage::KeepAlive
                    | PeerMessage::NotInterested
                    | PeerMessage::Have(_)
                    | PeerMessage::Bitfield(_) => {}
                    message => panic!("unexpected restartable peer message: {message:?}"),
                }
            }
        }
    }

    #[tokio::test]
    async fn live_network_prerequisite_resumes_verified_controlled_transfer() {
        let root = test_root("live-network-controlled-transfer");
        let configuration = config(&root);
        let piece_length = 16 * 1_024;
        let payload = (0..piece_length * 2)
            .map(|index| u8::try_from(index % 251).expect("fixture byte"))
            .collect::<Vec<_>>();
        let raw_info = single_file_info("network-gate.bin", &payload, piece_length);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash_hex = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind restartable controlled peer");
        let peer = listener.local_addr().expect("restartable peer address");
        let (withheld_sender, withheld_receiver) = tokio::sync::oneshot::channel();
        let (closed_sender, closed_receiver) = tokio::sync::oneshot::channel();
        let connections = Arc::new(AtomicU64::new(0));
        let wire_writes = Arc::new(AtomicU64::new(0));
        let peer_task = tokio::spawn(serve_restartable_two_piece_peer(
            listener,
            info_hash,
            payload.clone(),
            piece_length,
            withheld_sender,
            closed_sender,
            connections.clone(),
            wire_writes.clone(),
        ));

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open controlled transfer store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-network-gate-transfer".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{info_hash_hex}&x.pe={peer}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add controlled network-gate torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("controlled network-gate add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record controlled network-gate metadata");
        drop(store);

        let service = Arc::new(tokio::sync::Mutex::new(
            ApplicationService::open(configuration)
                .await
                .expect("open controlled network-gate application"),
        ));
        ApplicationService::ensure_maintenance_owner(&service).await;
        tokio::time::timeout(Duration::from_secs(5), withheld_receiver)
            .await
            .expect("second piece request deadline")
            .expect("second piece request signal");
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let verified = {
                    let service = service.lock().await;
                    service
                        .store_mut()
                        .expect("store")
                        .load_resume(&torrent_id)
                        .expect("controlled resume")
                        .have
                        .as_ref()
                        .map_or(0, |have| {
                            have.pieces().iter().filter(|piece| **piece).count()
                        })
                };
                if verified == 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("first controlled piece was not verified");

        let prerequisite = service.lock().await.network_prerequisite_handle();
        let close_started = Instant::now();
        let blocked = prerequisite.close().expect("close controlled generation");
        assert!(close_started.elapsed() < Duration::from_millis(50));
        assert!(
            service
                .lock()
                .await
                .active_download_for(&torrent_id)
                .expect("controlled download exists at synchronous close")
                .control
                .is_cancelled()
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            service.lock().await.reconcile_network_prerequisite().await
        })
        .await
        .expect("network close convergence deadline")
        .expect("network close convergence");
        tokio::time::timeout(Duration::from_secs(1), closed_receiver)
            .await
            .expect("controlled peer close deadline")
            .expect("controlled peer close signal");
        let writes_after_close = wire_writes.load(Ordering::Acquire);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(wire_writes.load(Ordering::Acquire), writes_after_close);
        assert_eq!(connections.load(Ordering::Acquire), 1);

        {
            let service = service.lock().await;
            assert_eq!(service.effective_network_prerequisite(), blocked);
            assert!(service.session_network.is_none());
            let resume = service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("blocked controlled resume");
            assert!(resume.desired_running);
            assert_eq!(
                resume
                    .have
                    .as_ref()
                    .expect("verified pieces")
                    .pieces()
                    .iter()
                    .filter(|piece| **piece)
                    .count(),
                1
            );
            assert_eq!(
                service
                    .session_download_resource_snapshot()
                    .registered_generations,
                0
            );
        }

        let allowed = prerequisite.allow().expect("allow controlled generation");
        tokio::time::timeout(Duration::from_secs(5), async {
            service.lock().await.reconcile_network_prerequisite().await
        })
        .await
        .expect("network allow convergence deadline")
        .expect("network allow convergence");
        assert_eq!(
            service.lock().await.effective_network_prerequisite(),
            allowed
        );
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let complete = {
                    let service = service.lock().await;
                    service
                        .store_mut()
                        .expect("store")
                        .load_resume(&torrent_id)
                        .expect("resumed controlled transfer")
                        .state
                        == TorrentState::Complete
                };
                if complete {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("controlled transfer did not resume automatically");
        peer_task.await.expect("restartable peer task");
        assert_eq!(connections.load(Ordering::Acquire), 2);
        assert_eq!(
            fs::read(root.join("payload/network-gate.bin")).expect("read completed payload"),
            payload
        );

        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn three_payload_downloads_progress_and_completion_promotes_the_fourth() {
        let root = test_root("automatic-admission-three-payloads");
        let configuration = config(&root);
        let limits = configuration.download_resource_limits;
        persist_client_settings(
            &configuration,
            ClientSettings {
                active_downloads: 3,
                ..ClientSettings::default()
            },
        );
        let fixtures = [
            ("small.bin", vec![0x11; 4 * 1024]),
            ("large-a.bin", vec![0x22; 128 * 1024]),
            ("large-b.bin", vec![0x33; 96 * 1024]),
            ("promoted.bin", vec![0x44; 64 * 1024]),
        ];
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let mut torrent_ids = Vec::new();
        let mut request_started = Vec::new();
        let mut payload_releases = Vec::new();
        let mut peer_tasks = Vec::new();
        for (index, (name, payload)) in fixtures.iter().enumerate() {
            let raw_info = single_file_info(name, payload, payload.len());
            let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
            let torrent_id = super::encode_info_hash(info_hash);
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind controlled content peer");
            let peer = listener.local_addr().expect("controlled peer address");
            let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
            let (release_sender, release_receiver) = tokio::sync::oneshot::channel();
            peer_tasks.push(tokio::spawn(serve_single_piece_peer(
                listener,
                info_hash,
                payload.clone(),
                started_sender,
                release_receiver,
            )));
            request_started.push(started_receiver);
            payload_releases.push(Some(release_sender));
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("add-controlled-payload-{index}"),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={peer}"),
                        storage_root: "downloads".to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("add controlled payload torrent");
            let torrent_id = match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("controlled payload add result"),
            };
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record controlled metadata");
            torrent_ids.push(torrent_id);
        }
        drop(store);

        let service = Arc::new(tokio::sync::Mutex::new(
            ApplicationService::open(configuration)
                .await
                .expect("open controlled application"),
        ));
        ApplicationService::ensure_maintenance_owner(&service).await;
        for started in &mut request_started[..3] {
            tokio::time::timeout(Duration::from_secs(3), started)
                .await
                .expect("admitted payload request deadline")
                .expect("admitted payload peer remains connected");
        }
        let mut expected_active = torrent_ids[..3].to_vec();
        expected_active.sort_unstable();
        assert_eq!(service.lock().await.active_download_ids(), expected_active);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut request_started[3],)
                .await
                .is_err(),
            "the fourth payload owner must remain queued"
        );

        payload_releases[0]
            .take()
            .expect("small payload release")
            .send(())
            .expect("release small payload");
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let promoted = {
                    let service = service.lock().await;
                    let complete = service
                        .store_mut()
                        .expect("store")
                        .load_resume(&torrent_ids[0])
                        .expect("small resume")
                        .state
                        == TorrentState::Complete;
                    complete
                        && service
                            .active_download_ids()
                            .iter()
                            .any(|torrent_id| torrent_id == &torrent_ids[3])
                };
                if promoted {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("small completion did not promote the fourth payload");
        tokio::time::timeout(Duration::from_secs(3), &mut request_started[3])
            .await
            .expect("promoted payload request deadline")
            .expect("promoted payload peer remains connected");

        for release in payload_releases.iter_mut().skip(1) {
            release
                .take()
                .expect("payload release")
                .send(())
                .expect("release controlled payload");
        }
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let complete = {
                    let service = service.lock().await;
                    torrent_ids.iter().all(|torrent_id| {
                        service
                            .store_mut()
                            .expect("store")
                            .load_resume(torrent_id)
                            .expect("controlled resume")
                            .state
                            == TorrentState::Complete
                    }) && service.active_download_ids().is_empty()
                };
                if complete {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("controlled payloads did not converge");
        for task in peer_tasks {
            task.await.expect("controlled peer task");
        }

        let resources = service.lock().await.session_download_resource_snapshot();
        assert_eq!(resources.registered_generations, 0);
        assert_eq!(resources.registered_generations_high_water, 3);
        assert_eq!(resources.outstanding_request_bytes, 0);
        assert_eq!(resources.buffered_payload_bytes, 0);
        assert_eq!(resources.active_piece_bytes, 0);
        assert_eq!(resources.active_pieces, 0);
        assert!(resources.outstanding_request_high_water <= limits.max_outstanding_request_bytes);
        assert!(resources.buffered_payload_high_water <= limits.max_buffered_payload_bytes);
        assert!(resources.active_piece_bytes_high_water <= limits.max_active_piece_bytes);
        assert!(resources.active_pieces_high_water <= limits.max_active_pieces);
        for (name, payload) in &fixtures {
            assert_eq!(
                fs::read(root.join("payload").join(name)).expect("read direct payload"),
                *payload
            );
        }

        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    async fn read_http_request<S>(stream: &mut S) -> String
    where
        S: tokio::io::AsyncRead + Unpin,
    {
        read_http_request_or_closed(stream)
            .await
            .expect("HTTP request ended before headers")
    }

    async fn read_http_request_or_closed<S>(stream: &mut S) -> Option<String>
    where
        S: tokio::io::AsyncRead + Unpin,
    {
        let mut request = Vec::new();
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let mut chunk = [0_u8; 1_024];
            let length = stream.read(&mut chunk).await.expect("read HTTP request");
            if length == 0 {
                return None;
            }
            request.extend_from_slice(&chunk[..length]);
            assert!(request.len() <= 16 * 1_024, "HTTP request is bounded");
        }
        Some(String::from_utf8(request).expect("HTTP request is ASCII"))
    }

    fn untrusted_tls_acceptor() -> tokio_rustls::TlsAcceptor {
        use base64::Engine as _;
        use std::sync::Arc;
        use tokio_rustls::rustls::ServerConfig;
        use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

        const CERT: &str = concat!(
            "MIIDETCCAfmgAwIBAgIUaGe1xp9QWaOq2j9MBVoYJQHxQjUwDQYJKoZIhvcNAQELBQAwGDEW",
            "MBQGA1UEAwwNd3JvbmcuZXhhbXBsZTAeFw0yNjA4MDUxODMxMDNaFw0zNjA4MDIxODMxMDNa",
            "MBgxFjAUBgNVBAMMDXdyb25nLmV4YW1wbGUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK",
            "AoIBAQDfQV9T9lOopJtynnl+v0lzgusiA5zeYE20tSlD04EtdJ8SakjrEC1cbfGQN9azRSNA",
            "oVKdazKOQpGib+cwbXd4snw/CE2qKVZ6j5grp8QZvSqm8gjHwp3WwlfVbmOJPXLsSjvCU36j",
            "qI5s5VWfWiPAxDYklfUn4hz4aR5oabP+poMgsXxq411UEclqr+s6fv1TVPO95hT9CeTyNXtN",
            "1T1Wq1tVMLm3ULI7oGVLhdZJGEyLLdricnIda+YOZEeoUslfzuV3rQMQJyDRWdajNdpbPJL/",
            "nBzVTAaGpe+O+JIj0hP1jdDNzdODTJ6b0JfrngB9mDYKGw4tnaLz8i0Tcpc/AgMBAAGjUzBR",
            "MB0GA1UdDgQWBBQ5BQU9ptEzvoQqvmi6fnGKh3GdMDAfBgNVHSMEGDAWgBQ5BQU9ptEzvoQq",
            "vmi6fnGKh3GdMDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBfpwTOEGer",
            "XsgIPC5kVDTdQI0d5XmVuAbxCWQZCsRbrn65hW3E+uaWr2W7SMUAczYpWi3W/Q+YWXz/F19",
            "3IBVLUL7zohyQP06vYIsQUAgKpWDwPMHTtzLKAy2wtn50Y83CR/FMEXQpSFsFxZEO7rupEAL",
            "E3oA/jzaApcIuqMOJbGFcrsuRy3HVS6g+T1wabFZGts9XdXmHoXc6zXL8fxUVvdI4Sdl39co",
            "nd7TayWPpdy+pD//z0qsoTkHEuKwd9dgiIU2bg7kh7AilXQM9ncze4IxkZyQfM87YAb3bMG",
            "Nwrd/DjbA2yWPWUmGV4+laMESgYDrXRFemNrNgif1v4eM5"
        );
        const KEY: &str = concat!(
            "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDfQV9T9lOopJtynnl+v0lz",
            "gusiA5zeYE20tSlD04EtdJ8SakjrEC1cbfGQN9azRSNAoVKdazKOQpGib+cwbXd4snw/CE2q",
            "KVZ6j5grp8QZvSqm8gjHwp3WwlfVbmOJPXLsSjvCU36jqI5s5VWfWiPAxDYklfUn4hz4aR5",
            "oabP+poMgsXxq411UEclqr+s6fv1TVPO95hT9CeTyNXtN1T1Wq1tVMLm3ULI7oGVLhdZJGE",
            "yLLdricnIda+YOZEeoUslfzuV3rQMQJyDRWdajNdpbPJL/nBzVTAaGpe+O+JIj0hP1jdDNzd",
            "ODTJ6b0JfrngB9mDYKGw4tnaLz8i0Tcpc/AgMBAAECggEASQLPgp1diZrfbVIPSJiVFE4d",
            "yF9nF0BmWTEfwBs0tSFc/kA8/YaqVv5rj+7662CyYSoA4xNSEr0JdJZlBGzgM9wnDtQP1hSz",
            "v9wi9y/jzUkUYElp/q4SQVAIOnfh3Fl4snaqaWg1057FiS5M3JK1e46PaFKUPIlRURnLhHkB",
            "EMdWNcCozrzihkLoJ5rTBQSGdmMFThGoF5MaK0MN4AxU1o0rWbI8GVnua4Cm4FuR3Eaqqsb",
            "b0mUl1JWykLo7FoO60tWCiD6mv5bhKNtkFpMMHBSWj9W9jX0n5pprsnfSYh0I8WHQKRBwqF",
            "KAxz3RDpo7LKS9RM1eqmos4FsW+L68IQKBgQD6TB/LeQa6kk45T5lJ6coABm1x66bves1L/",
            "8/PSE8XV3gBobSs4jG00bd9Mh1ulmEzd1oey62F5Dky/z4o6Fs/uj03dZjynsc0I9D3oykKB",
            "w7XkKdb7F5UYCVxAR818/bKZM1gbWqkWoo6pRA9bj8pNzvrRhbb8Rj959ZJtxOf4QKBgQDk",
            "V4Yg0u3pCtvlEp0x8+v4WbiQIrqgaJ6UwAAwpt4XS2yW6YU2x813McUXsqf3CiYCUurhxtZP",
            "q50llvXFZXKpzO8fekR5q7vgSFu9UrplCsDqkTcWqyGaGNuFBfr8TzSyc2zKkhrpWLn36sy/",
            "jxMgprk+uaQV2+CVdyHBQuWbHwKBgBLugRUl0VF5UXtaPvDtQv8ffVW5ikXg1vhhn/lAseL",
            "FFemhroXJEhNoLWXFzZ4Yt79pzqI3q6dN7NmjnrL/aC94ybqRJYFsawrRjrO8XpVIlWHOqi",
            "n0xenB3/MdL5woGMmUOEiL3h4STxRCeej7lsFqURjpkz8NjGNgDsBCnbRhAoGBALA0bje0LY",
            "0xKQE7fPyIO2bZbZgkhJm2QfGNvFfO3QFi3bgTGg5s3rwFNw+TeRQky7HtZH2337d5OfpA5",
            "QVfxL0NfNVwl5jAkml/zPNq/JVuV/Jq/vTKOFLerb+YHtdHE+ZFNgWX+5ZoNpH+qeOEuADx",
            "R3AE9386vrL4TJ8DTYWH AoGAb7l64MdxbuMZnzRpYMOg4n8aUQOD9QxX9WKtVwbcCfBskW",
            "p44v/NxFnLaJjqdg9zioAL8hL1PO1z0ya5mvAYkCV6ti80T8JZi144iV7yaciKXorCcvNqX",
            "ljY3cEmel5PhjJTLCn1+cVe/seZJwrrd5zP5Jlb+jvZxUQIzUmkAXw="
        );
        let cert = base64::engine::general_purpose::STANDARD
            .decode(CERT)
            .expect("certificate DER");
        let key = base64::engine::general_purpose::STANDARD
            .decode(KEY.replace(' ', ""))
            .expect("private key DER");
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(cert)],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)),
            )
            .expect("TLS server config");
        tokio_rustls::TlsAcceptor::from(Arc::new(config))
    }

    fn only_peers6_http_response(peer: SocketAddr) -> Vec<u8> {
        let IpAddr::V6(address) = peer.ip() else {
            panic!("fixture peer must be IPv6");
        };
        let mut body = b"d8:intervali900e6:peers618:".to_vec();
        body.extend_from_slice(&address.octets());
        body.extend_from_slice(&peer.port().to_be_bytes());
        body.push(b'e');
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(&body);
        response
    }

    fn compact_ipv4_http_response(peer: SocketAddr) -> Vec<u8> {
        let IpAddr::V4(address) = peer.ip() else {
            panic!("fixture peer must be IPv4");
        };
        let mut body = b"d8:intervali900e5:peers6:".to_vec();
        body.extend_from_slice(&address.octets());
        body.extend_from_slice(&peer.port().to_be_bytes());
        body.push(b'e');
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(&body);
        response
    }

    async fn serve_tracker_stream<S>(mut stream: S, peer: SocketAddr) -> Option<(String, bool)>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let request = read_http_request_or_closed(&mut stream).await?;
        let stopped = request.contains("&event=stopped ");
        stream
            .write_all(&only_peers6_http_response(peer))
            .await
            .expect("write tracker response");
        stream.shutdown().await.expect("close tracker response");
        Some((request, stopped))
    }

    fn percent_encode_magnet_value(value: &str) -> String {
        let mut encoded = String::with_capacity(value.len() * 3);
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        for byte in value.bytes() {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                encoded.push(char::from(byte));
            } else {
                encoded.push('%');
                encoded.push(char::from(HEX[usize::from(byte >> 4)]));
                encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
            }
        }
        encoded
    }

    fn dht_endpoint(address: SocketAddr) -> DhtEndpoint {
        let port = address.port();
        match address.ip() {
            IpAddr::V4(address) => DhtEndpoint::new(DhtIp::V4(address.octets()), port),
            IpAddr::V6(address) => DhtEndpoint::new(DhtIp::V6(address.octets()), port),
        }
    }

    async fn run_tracker_only_peers6_application_transfer(https: bool) {
        let root = test_root(if https {
            "https-tracker-ipv6-transfer"
        } else {
            "http-tracker-ipv6-transfer"
        });
        let payload = b"hash verified HTTP tracker IPv6 payload".to_vec();
        let raw_info = single_file_info("tracker-ipv6.bin", &payload, payload.len());
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash_hex = super::encode_info_hash(info_hash);

        let peer_listener = match TcpListener::bind("[::1]:0").await {
            Ok(listener) => listener,
            Err(_) => return,
        };
        let peer_address = peer_listener.local_addr().expect("IPv6 peer address");
        let (request_started_sender, request_started) = tokio::sync::oneshot::channel();
        let (payload_release, payload_release_receiver) = tokio::sync::oneshot::channel();
        let peer_task = tokio::spawn(serve_single_piece_peer(
            peer_listener,
            info_hash,
            payload.clone(),
            request_started_sender,
            payload_release_receiver,
        ));

        let tracker = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind HTTP tracker");
        let scheme = if https { "https" } else { "http" };
        let tracker_url = format!(
            "{scheme}://{}/announce?passkey=fixture",
            tracker.local_addr().expect("tracker address")
        );
        let tls_acceptor = https.then(untrusted_tls_acceptor);
        let (announce_sender, mut announce_receiver) =
            tokio::sync::mpsc::unbounded_channel::<String>();
        let tracker_task = tokio::spawn(async move {
            let mut requests = Vec::new();
            loop {
                let (stream, _) = tracker.accept().await.expect("accept tracker announce");
                let served = if let Some(acceptor) = tls_acceptor.as_ref() {
                    let Ok(stream) = acceptor.accept(stream).await else {
                        continue;
                    };
                    serve_tracker_stream(stream, peer_address).await
                } else {
                    serve_tracker_stream(stream, peer_address).await
                };
                let Some((request, stopped)) = served else {
                    continue;
                };
                announce_sender
                    .send(request.clone())
                    .expect("report tracker request");
                requests.push(request);
                if stopped {
                    return requests;
                }
            }
        });

        let configuration = config(&root);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open fixture store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-http-tracker-ipv6".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{info_hash_hex}&tr={}",
                        percent_encode_magnet_value(&tracker_url)
                    ),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add tracker-only magnet");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("tracker-only add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record verified metadata");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "configure-tracker-ipv6-loopback".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: ClientSettings {
                        listener: ListenerPolicy::AutomaticLoopback,
                        tracker_https_server_authentication: if https {
                            HttpsServerAuthenticationPolicy::Disabled
                        } else {
                            HttpsServerAuthenticationPolicy::SystemTrust
                        },
                        ..ClientSettings::default()
                    }
                    .into(),
                },
            })
            .expect("persist loopback IPv6 and HTTPS policy");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open application");
        let first_announce = tokio::time::timeout(Duration::from_secs(2), announce_receiver.recv())
            .await
            .expect("first tracker announce deadline")
            .expect("tracker server ended before first announce");
        assert!(first_announce.contains("&event=started "));
        tokio::time::timeout(Duration::from_secs(2), request_started)
            .await
            .expect("outgoing payload request deadline")
            .expect("outgoing peer ended before payload request");
        let live_port = available_port_on(Ipv4Addr::LOCALHOST)
            .await
            .expect("find live listener port during download");
        let live_settings = ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port: live_port },
            tracker_https_server_authentication: if https {
                HttpsServerAuthenticationPolicy::Disabled
            } else {
                HttpsServerAuthenticationPolicy::SystemTrust
            },
            ..ClientSettings::default()
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: format!("live-listener-during-{scheme}-download"),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: live_settings.clone().into(),
                },
            })
            .await
            .expect("apply listener while outgoing download is active");
        wait_for_client_settings(&service, |runtime| {
            runtime.configured == live_settings
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert!(service.active_download().is_some());
        let active_control = service
            .active_download()
            .expect("active tracker transfer")
            .1
            .control
            .clone();
        let live_port_parameter = format!("&port={live_port}&");
        let routed_announce = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let request = announce_receiver
                    .recv()
                    .await
                    .expect("tracker stopped before active route correction");
                if request.contains(&live_port_parameter) {
                    break request;
                }
            }
        })
        .await
        .expect("active route corrective tracker announce");
        assert!(!routed_announce.contains("event=completed"));
        assert!(routed_announce.contains(&format!("&left={}&", payload.len())));
        payload_release
            .send(())
            .expect("release controlled outgoing payload");
        let snapshot = tokio::time::timeout(Duration::from_secs(5), async {
            let mut sequence = 0_u64;
            loop {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("tracker-transfer-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("snapshot transfer");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot should succeed");
                };
                if snapshot.torrents[0].state == TorrentState::Complete {
                    return snapshot;
                }
                sequence = sequence.saturating_add(1);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        let snapshot = match snapshot {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: "tracker-transfer-timeout".to_owned(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("timeout snapshot");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("timeout snapshot should succeed");
                };
                let peers = torrent_peer_views(&service, &torrent_id).await;
                let trackers = torrent_tracker_views(&service, &torrent_id).await;
                panic!(
                    "tracker IPv6 transfer deadline; torrent={:?}; peers={peers:?}; trackers={trackers:?}; peer_finished={}; tracker_finished={}",
                    snapshot.torrents[0],
                    peer_task.is_finished(),
                    tracker_task.is_finished()
                );
            }
        };
        assert_eq!(snapshot.torrents[0].verified_piece_count, 1);
        assert!(!active_control.incoming_content_routable());
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                service
                    .reap_finished()
                    .await
                    .expect("reap completed tracker transfer");
                if service.active_download().is_none() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("completed tracker transfer did not join");
        service
            .reconcile_admission()
            .await
            .expect("admit completed tracker seed");
        wait_for_active_route(&service, 1).await;
        let (mut completed_peer, mut completed_decoder, mut completed_pending) =
            connect_application_seed_with_expected_availability(
                &service,
                info_hash,
                *b"-RS-COMPLETED---0000",
                false,
                vec![0b1000_0000],
            )
            .await;
        completed_peer
            .write_all(&encode_message(&PeerMessage::Interested).expect("encode interest"))
            .await
            .expect("send completed interest");
        assert_eq!(
            read_peer_message(
                &mut completed_peer,
                &mut completed_decoder,
                &mut completed_pending,
            )
            .await,
            PeerMessage::Unchoke
        );
        completed_peer
            .write_all(
                &encode_message(&PeerMessage::Request(
                    rstorrent_protocol::peer_wire::BlockRequest {
                        index: 0,
                        begin: 0,
                        length: u32::try_from(payload.len()).expect("completed request length"),
                    },
                ))
                .expect("encode completed request"),
            )
            .await
            .expect("request completed payload");
        assert_eq!(
            read_peer_message(
                &mut completed_peer,
                &mut completed_decoder,
                &mut completed_pending,
            )
            .await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: payload.clone(),
            }
        );
        let summary = service
            .subscribe(SubscriptionSpec {
                selector: crate::ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                projection: crate::ViewProjection::Summary,
                delivery: crate::DeliveryPolicy::default(),
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe completed ETA summary");
        let completed_view = summary.next_update().await.expect("completed ETA summary");
        let payload_bytes = payload.len().to_string();
        assert!(matches!(
            completed_view.payload,
            crate::ViewUpdatePayload::Snapshot {
                snapshot: crate::ViewSnapshot::Torrent {
                    torrent: Some(ref torrent),
                },
            } if torrent.required_payload_bytes.as_deref() == Some(payload_bytes.as_str())
                && torrent.remaining_payload_bytes.as_deref() == Some("0")
                && torrent.eta_payload_download_rate_bytes == "0"
                && torrent.eta == crate::TorrentEtaView::Unavailable
        ));
        assert_eq!(
            fs::read(root.join("payload/tracker-ipv6.bin")).expect("direct payload"),
            payload
        );
        let trackers = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let trackers = torrent_tracker_views(&service, &torrent_id).await;
                if trackers
                    .first()
                    .is_some_and(|tracker| tracker.last_peer_count == Some(1))
                {
                    break trackers;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("completed tracker view restores its peer count");
        assert_eq!(trackers.len(), 1);
        assert_eq!(trackers[0].last_peer_count, Some(1));
        assert_eq!(
            trackers[0].last_connection_family,
            Some(TrackerConnectionFamilyView::Ipv4)
        );
        assert_eq!(
            trackers[0].security,
            if https {
                TrackerSecurityView::EncryptedUnauthenticated
            } else {
                TrackerSecurityView::Unencrypted
            }
        );

        drop(completed_peer);
        service.shutdown().await.expect("shutdown application");
        drop(service);
        peer_task.await.expect("IPv6 peer task");
        let requests = tracker_task.await.expect("HTTP tracker task");
        assert!(
            requests
                .iter()
                .any(|request| request.contains("&event=started "))
        );
        assert!(
            requests
                .iter()
                .any(|request| request.contains("&event=stopped "))
        );
        assert!(
            requests
                .iter()
                .all(|request| request.starts_with("GET /announce?passkey=fixture&"))
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn http_tracker_only_peers6_completes_hash_verified_application_transfer() {
        run_tracker_only_peers6_application_transfer(false).await;
    }

    #[tokio::test]
    async fn unauthenticated_https_tracker_completes_hash_verified_application_transfer() {
        run_tracker_only_peers6_application_transfer(true).await;
    }

    #[tokio::test]
    #[ignore = "opt-in pinned-libtorrent HTTPS interoperability harness"]
    async fn authenticated_https_tracker_introduces_pinned_libtorrent_peer() {
        let tracker_url = std::env::var("RSTORRENT_INTEROP_TRACKER_URL")
            .expect("RSTORRENT_INTEROP_TRACKER_URL is required");
        assert!(tracker_url.starts_with("https://127.0.0.1:"));
        let torrent_id = std::env::var("RSTORRENT_INTEROP_INFO_HASH")
            .expect("RSTORRENT_INTEROP_INFO_HASH is required");
        assert_eq!(torrent_id.len(), 40);
        assert!(torrent_id.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let root_pem = fs::read(
            std::env::var("RSTORRENT_INTEROP_ROOT_PEM")
                .expect("RSTORRENT_INTEROP_ROOT_PEM is required"),
        )
        .expect("read controlled root certificate");
        rstorrent_engine::install_test_platform_root(&root_pem)
            .expect("install one test-only platform root");
        let root = PathBuf::from(
            std::env::var("RSTORRENT_INTEROP_APPLICATION_ROOT")
                .expect("RSTORRENT_INTEROP_APPLICATION_ROOT is required"),
        );
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open controlled application");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "authenticated-https-interop-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{torrent_id}&tr={}",
                        percent_encode_magnet_value(&tracker_url)
                    ),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add authenticated HTTPS tracker magnet");

        let snapshot = tokio::time::timeout(Duration::from_secs(45), async {
            for sequence in 0_u64.. {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("authenticated-https-interop-snapshot-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("snapshot authenticated transfer");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot should succeed");
                };
                if snapshot.torrents[0].state == TorrentState::Complete {
                    return snapshot;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            unreachable!()
        })
        .await
        .expect("authenticated transfer deadline");
        assert!(snapshot.torrents[0].metadata_available);
        assert!(snapshot.torrents[0].verified_piece_count > 0);
        let trackers = torrent_tracker_views(&service, &torrent_id).await;
        assert_eq!(trackers.len(), 1);
        assert_eq!(
            trackers[0].security,
            TrackerSecurityView::EncryptedSystemTrust
        );
        assert_eq!(trackers[0].last_peer_count, Some(1));
        assert_eq!(trackers[0].last_error, None);

        service.shutdown().await.expect("shutdown application");
    }

    #[tokio::test]
    async fn metadata_only_add_activates_tracker_until_metadata_is_verified() {
        let root = test_root("metadata-only-tracker");
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let (peer, peer_task) = spawn_metadata_peer(raw_info).await;

        let tracker = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind metadata tracker");
        let tracker_url = format!(
            "http://{}/announce",
            tracker.local_addr().expect("tracker address")
        );
        let response = compact_ipv4_http_response(peer);
        let (announce_sender, mut announce_receiver) =
            tokio::sync::mpsc::unbounded_channel::<String>();
        let tracker_task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = tracker.accept().await.expect("accept tracker announce");
                let request = read_http_request(&mut stream).await;
                stream
                    .write_all(&response)
                    .await
                    .expect("write tracker response");
                stream.shutdown().await.expect("close tracker response");
                let stopped = request.contains("&event=stopped ");
                announce_sender
                    .send(request)
                    .expect("report tracker request");
                if stopped {
                    break;
                }
            }
        });

        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "metadata-only-tracker-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{torrent_id}&tr={}",
                        percent_encode_magnet_value(&tracker_url)
                    ),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add metadata-only tracker magnet");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("metadata-only tracker add result"),
        };

        let started = tokio::time::timeout(Duration::from_secs(2), announce_receiver.recv())
            .await
            .expect("started announce deadline")
            .expect("tracker ended before started announce");
        assert!(started.contains("&event=started "), "{started}");

        let snapshot = tokio::time::timeout(Duration::from_secs(5), async {
            for sequence in 0_u64..500 {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("metadata-only-tracker-snapshot-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("metadata snapshot");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot should succeed");
                };
                if snapshot.torrents[0].metadata_available {
                    return snapshot;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("metadata did not become available");
        })
        .await
        .expect("metadata-only tracker deadline");
        assert_eq!(snapshot.torrents[0].state, TorrentState::Paused);
        assert_eq!(snapshot.torrents[0].storage_state, StorageState::Available);

        let stopped = tokio::time::timeout(Duration::from_secs(2), announce_receiver.recv())
            .await
            .expect("stopped announce deadline")
            .expect("tracker ended before stopped announce");
        assert!(stopped.contains("&event=stopped "), "{stopped}");
        let trackers = torrent_tracker_views(&service, &torrent_id).await;
        assert_eq!(trackers.len(), 1);
        assert_eq!(trackers[0].total_attempts, 2);
        assert_eq!(
            trackers[0].last_connection_family,
            Some(TrackerConnectionFamilyView::Ipv4)
        );

        let owner = snapshot.torrents[0]
            .torrent_id
            .parse::<TorrentId>()
            .expect("opaque owner");
        let paths =
            torrent_storage_paths(&root.join("payload"), "multi", owner).expect("storage paths");
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());

        peer_task.await.expect("metadata peer task");
        tracker_task.await.expect("metadata tracker task");
        service.shutdown().await.expect("shutdown application");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn application_shutdown_closes_view_sets_and_wakes_waiters() {
        let root = test_root("view-set-shutdown");
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        let owner = ViewSetOwner::trusted("test-owner");
        let opened = service
            .open_view_set(
                owner.clone(),
                OpenViewSetRequest {
                    views: vec![ViewSpec::TorrentList {
                        view_id: "library".to_owned(),
                        delivery: ViewDeliveryPolicy::default(),
                    }],
                    options: OpenViewSetOptions::default(),
                },
            )
            .expect("open view set");
        let view_set = service
            .view_set(&owner, &opened.view_set_id)
            .expect("view set handle");
        let cursor = opened.initial.cursor;
        let waiter = tokio::spawn(async move { view_set.next_updates(&cursor, 20_000).await });
        tokio::task::yield_now().await;

        service.shutdown().await.expect("shutdown");
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("waiter timed out")
            .expect("waiter task");
        assert_eq!(result, Err(ViewSetError::Closed));
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pending_torrent_bytes_restarts_without_payload_artifacts() {
        let root = test_root("pending-torrent-bytes");
        let raw_info = multi_file_info();
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&raw_info);
        source.push(b'e');
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");

        let mut request = torrent_bytes_request("pending-torrent-bytes", &source, true);
        request.await_file_selection = true;
        let response = service
            .add_torrent_bytes(request, source)
            .await
            .expect("add torrent bytes");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("torrent bytes add result"),
        };
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("load imported torrent");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.state, TorrentState::Paused);
        assert!(!resume.desired_running);
        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("snapshot");
        assert!(snapshot.torrents[0].awaiting_file_selection);
        let paths = torrent_storage_paths(
            &root.join("payload"),
            "multi",
            torrent_id.parse().expect("opaque owner"),
        )
        .expect("storage paths");
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        service.shutdown().await.expect("shutdown application");
        drop(service);

        let mut reopened = ApplicationService::open(config(&root))
            .await
            .expect("reopen application");
        let resume = reopened
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("restart imported torrent");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.state, TorrentState::Paused);
        let snapshot = reopened
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("restart snapshot");
        assert!(snapshot.torrents[0].awaiting_file_selection);
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        reopened.shutdown().await.expect("shutdown reopened");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn disabling_file_selection_releases_the_queued_adds() {
        let root = test_root("pending-release-queue");
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        let mut torrent_ids = Vec::new();
        for (request_id, raw_info) in [
            ("pending-current", multi_file_info()),
            ("pending-queued", single_file_info("queued", b"data", 4)),
        ] {
            let mut source = b"d4:info".to_vec();
            source.extend_from_slice(&raw_info);
            source.push(b'e');
            let mut request = torrent_bytes_request(request_id, &source, true);
            request.await_file_selection = true;
            let response = service
                .add_torrent_bytes(request, source)
                .await
                .expect("add pending torrent bytes");
            torrent_ids.push(match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("pending torrent bytes add result"),
            });
        }
        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("pending snapshot");
        let catalog_id = snapshot
            .torrents
            .iter()
            .find(|torrent| torrent.torrent_id == torrent_ids[0])
            .and_then(|torrent| torrent.file_catalog_id.clone())
            .expect("pending file catalog");
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "confirm-disable-future".to_owned(),
                expected_revision: None,
                command: Command::ConfirmPendingFileSelection {
                    torrent_id: torrent_ids[0].clone(),
                    catalog_id,
                    base: crate::PendingFileSelectionBase::Current,
                    overrides: Vec::new(),
                    disable_future: true,
                },
            })
            .await
            .expect("confirm with disable future");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));

        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("released snapshot");
        assert!(!snapshot.storage.show_file_selection);
        for torrent in &snapshot.torrents {
            assert!(!torrent.awaiting_file_selection);
            assert!(torrent.desired_running);
            assert!(torrent.download_queue_position.is_some());
        }
        service.shutdown().await.expect("shutdown application");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn download_files_publishes_normal_selection_from_skipped_default() {
        let root = test_root("download-files-view-selection");
        let raw_info = multi_file_info();
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&raw_info);
        source.push(b'e');
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");

        let mut request = torrent_bytes_request("pending-file-view", &source, true);
        request.await_file_selection = true;
        let response = service
            .add_torrent_bytes(request, source)
            .await
            .expect("add pending torrent bytes");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("pending torrent bytes add result"),
        };
        let catalog_id = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("pending snapshot")
            .torrents[0]
            .file_catalog_id
            .clone()
            .expect("pending file catalog");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "confirm-skipped-default".to_owned(),
                expected_revision: None,
                command: Command::ConfirmPendingFileSelection {
                    torrent_id: torrent_id.clone(),
                    catalog_id,
                    base: crate::PendingFileSelectionBase::None,
                    overrides: vec![crate::FileSelectionOverride {
                        range: crate::FileIndexRange {
                            start: 1,
                            end_exclusive: 2,
                        },
                        selected: true,
                    }],
                    disable_future: false,
                },
            })
            .await
            .expect("confirm one wanted file");

        let owner = ViewSetOwner::trusted("file-view-test");
        let opened = service
            .open_view_set(
                owner.clone(),
                OpenViewSetRequest {
                    views: vec![ViewSpec::TorrentFiles {
                        view_id: "files".to_owned(),
                        torrent_id: torrent_id.clone(),
                        page: Some(CatalogPageRequest::default()),
                        delivery: ViewDeliveryPolicy::default(),
                    }],
                    options: OpenViewSetOptions::default(),
                },
            )
            .expect("open files view set");
        let initial = opened
            .initial
            .updates
            .iter()
            .find_map(|update| match update {
                ViewSetUpdate::Snapshot {
                    snapshot: ViewSnapshot::Files { files, .. },
                    ..
                } => Some(files),
                _ => None,
            })
            .expect("initial files snapshot");
        assert_eq!(
            initial[0].selection,
            Some(crate::FileSelectionView::Skipped)
        );
        assert_eq!(initial[1].selection, Some(crate::FileSelectionView::Normal));
        let view_set = service
            .view_set(&owner, &opened.view_set_id)
            .expect("files view set");

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-skipped-file-view".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id,
                    file_indices: vec![0],
                },
            })
            .await
            .expect("download skipped file");
        let update = view_set
            .next_updates(&opened.initial.cursor, 1_000)
            .await
            .expect("selection update");
        assert!(update.updates.iter().any(|update| matches!(
            update,
            ViewSetUpdate::Patch {
                patch: ViewPatch::Files { updates, .. },
                ..
            } if updates.iter().any(|update| {
                update.file_id == "0"
                    && update.fields.iter().any(|field| matches!(
                        field,
                        crate::FileFieldUpdate::Selection {
                            value: Some(crate::FileSelectionView::Normal)
                        }
                    ))
            })
        )));

        service.shutdown().await.expect("shutdown application");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pure_v2_paused_add_uses_full_identity_and_verbatim_restart_source() {
        let root = test_root("pure-v2-paused-add");
        let source = pure_v2_source();
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");

        let response = service
            .add_torrent_bytes(
                torrent_bytes_request("pure-v2-paused", &source, false),
                source.clone(),
            )
            .await
            .expect("add pure-v2 source");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("pure-v2 bytes add result"),
        };
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("load pure-v2 row");
        assert!(resume.info_hashes.v1_hash().is_none());
        assert!(resume.info_hashes.v2_hash().is_some());
        assert_eq!(resume.metainfo_source.as_deref(), Some(source.as_slice()));
        assert_eq!(resume.state, TorrentState::Paused);
        service.shutdown().await.expect("shutdown application");
        drop(service);

        let mut reopened = ApplicationService::open(config(&root))
            .await
            .expect("reopen application");
        let resumed = reopened
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("restart pure-v2 row");
        assert_eq!(resumed.metainfo_source, Some(source));
        assert_eq!(resumed.state, TorrentState::Paused);
        reopened.shutdown().await.expect("shutdown reopened");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pure_v2_application_download_publishes_and_restarts_without_part_file() {
        let root = test_root("pure-v2-application-download");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        );
        let source = pure_v2_source();
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("pure-v2 application fixture");
        let wire_hash = projection.content.swarm_key().into_bytes();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind pure-v2 application peer");
        let address = listener.local_addr().expect("pure-v2 peer address");
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept pure-v2 peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read pure-v2 handshake");
            decode_handshake(&handshake, wire_hash).expect("pure-v2 wire identity");
            stream
                .write_all(&encode_handshake(wire_hash, *b"-RS-APP-V2-000000000"))
                .await
                .expect("send pure-v2 handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0x80])).unwrap())
                .await
                .expect("send pure-v2 availability");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).unwrap())
                .await
                .expect("unchoke pure-v2 client");
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            loop {
                match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                    PeerMessage::Interested | PeerMessage::Extended { id: 0, .. } => {}
                    PeerMessage::Request(request) => {
                        assert_eq!(request.index, 0);
                        assert_eq!(request.begin, 0);
                        assert_eq!(request.length, 1);
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Piece {
                                    index: 0,
                                    begin: 0,
                                    block: b"x".to_vec(),
                                })
                                .unwrap(),
                            )
                            .await
                            .expect("send pure-v2 payload");
                    }
                    PeerMessage::Have(0) => break,
                    message => panic!("unexpected pure-v2 client message {message:?}"),
                }
            }
        });
        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open application");
        let response = service
            .add_torrent_bytes(
                torrent_bytes_request("pure-v2-download", &source, true),
                source.clone(),
            )
            .await
            .expect("add running pure-v2 source");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("pure-v2 running add result"),
        };
        let runtime_peers = service
            .torrent_runtimes
            .get(&torrent_id)
            .expect("pure-v2 torrent runtime")
            .handle()
            .peers();
        runtime_peers
            .observe_discovered_peer(PeerObservation::dialable(
                PeerEndpoint::new(address).expect("pure-v2 peer endpoint"),
                PeerSource::Manual,
            ))
            .expect("observe pure-v2 application peer");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "pure-v2-complete",
        )
        .await;
        peer_task.await.expect("pure-v2 application peer task");
        let owner = torrent_id.parse::<TorrentId>().expect("pure-v2 owner");
        let paths = torrent_storage_paths(&root.join("payload"), "root", owner)
            .expect("pure-v2 storage paths");
        assert_eq!(fs::read(paths.content.join("a")).unwrap(), b"x");
        assert!(!paths.part.exists());
        service.shutdown().await.expect("shutdown application");
        drop(service);

        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen pure-v2 application");
        let resumed = reopened
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("reopen pure-v2 row");
        assert_eq!(resumed.state, TorrentState::Complete);
        assert_eq!(resumed.metainfo_source, Some(source));
        assert_eq!(resumed.accounting.total_downloaded, 1);
        assert!(!paths.part.exists());
        reopened
            .configure_media_origin("http://127.0.0.1:43121")
            .expect("configure v2 media origin");
        let media = reopened
            .create_media_url(&torrent_id, 0)
            .await
            .expect("create v2 media URL");
        let MediaUrlOutcome::Created { url, .. } = media.outcome else {
            panic!("verified v2 direct file was unavailable")
        };
        let capability = url.rsplit('/').next().expect("v2 capability path");
        let mut lease = reopened
            .resolve_media_capability(capability)
            .expect("resolve v2 media capability");
        assert_eq!(lease.read_range(0, 1).await.expect("read v2 media"), b"x");
        drop(lease);
        wait_for_seed_registrations(&reopened, 1).await;
        let (mut seed_peer, mut decoder, mut pending) =
            connect_application_seed_with_expected_availability(
                &reopened,
                wire_hash,
                *b"-RS-V2-SEED-00000000",
                false,
                vec![0x80],
            )
            .await;
        seed_peer
            .write_all(&encode_message(&PeerMessage::Interested).expect("encode interest"))
            .await
            .expect("send v2 seed interest");
        assert_eq!(
            read_peer_message(&mut seed_peer, &mut decoder, &mut pending).await,
            PeerMessage::Unchoke
        );
        seed_peer
            .write_all(
                &encode_message(&PeerMessage::Request(
                    rstorrent_protocol::peer_wire::BlockRequest {
                        index: 0,
                        begin: 0,
                        length: 1,
                    },
                ))
                .expect("encode v2 seed request"),
            )
            .await
            .expect("send v2 seed request");
        assert_eq!(
            read_peer_message(&mut seed_peer, &mut decoder, &mut pending).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: b"x".to_vec(),
            }
        );
        drop(seed_peer);
        reopened
            .maintain_accounting(true)
            .expect("checkpoint v2 lifetime upload");
        assert_eq!(
            reopened
                .store_mut()
                .unwrap()
                .load_resume(&torrent_id)
                .unwrap()
                .accounting
                .total_uploaded,
            1
        );
        reopened.shutdown().await.expect("shutdown reopened");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove pure-v2 application root");
    }

    #[tokio::test]
    async fn hybrid_selective_wanted_completion_restarts_without_full_seeding() {
        let root = test_root("hybrid-application-download");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        );
        let source = hybrid_source();
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("hybrid application fixture");
        let hashes = projection.content.info_hashes();
        assert!(hashes.is_hybrid());
        let v1_swarm = rstorrent_protocol::identity::SwarmKey::V1(
            hashes.v1_hash().expect("hybrid v1 identity"),
        );
        let v1_key = v1_swarm.into_bytes();
        let v2_swarm = hashes.v2_hash().expect("hybrid v2 identity").swarm_key();
        let v2_key = v2_swarm.into_bytes();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind hybrid application peer");
        let address = listener.local_addr().expect("hybrid peer address");
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept hybrid peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read hybrid handshake");
            let request = decode_handshake(&handshake, v1_key).expect("hybrid v1 dial identity");
            assert!(request.supports_hybrid_v2());
            stream
                .write_all(&encode_handshake(v2_key, *b"-RS-APP-HYBRID-00000"))
                .await
                .expect("accept hybrid v2 upgrade");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).unwrap())
                .await
                .expect("send hybrid availability");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).unwrap())
                .await
                .expect("unchoke hybrid client");
            let mut decoder = FrameDecoder::new();
            decoder.set_protocol(PeerProtocol::V2);
            let mut pending = std::collections::VecDeque::new();
            loop {
                match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                    PeerMessage::Interested | PeerMessage::Extended { id: 0, .. } => {}
                    PeerMessage::Request(request) => {
                        assert_eq!(
                            request,
                            BlockRequest {
                                index: 0,
                                begin: 0,
                                length: 1,
                            }
                        );
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Piece {
                                    index: 0,
                                    begin: 0,
                                    block: vec![1],
                                })
                                .unwrap(),
                            )
                            .await
                            .expect("send selected hybrid payload");
                    }
                    PeerMessage::Have(0) => break,
                    message => panic!("unexpected hybrid client message {message:?}"),
                }
            }
        });
        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open hybrid application");
        let mut request = torrent_bytes_request("hybrid-download", &source, true);
        request.selection = crate::FileSelectionIntent::WantedRanges {
            ranges: vec![crate::FileIndexRange {
                start: 0,
                end_exclusive: 1,
            }],
        };
        let response = service
            .add_torrent_bytes(request, source.clone())
            .await
            .expect("add running hybrid source");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("hybrid running add result"),
        };
        service
            .torrent_runtimes
            .get(&torrent_id)
            .expect("hybrid torrent runtime")
            .handle()
            .peers()
            .observe_discovered_peer(PeerObservation::dialable(
                PeerEndpoint::new(address).expect("hybrid peer endpoint"),
                PeerSource::Manual,
            ))
            .expect("observe hybrid application peer");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "hybrid-complete",
        )
        .await;
        peer_task.await.expect("hybrid application peer task");
        let owner = torrent_id.parse::<TorrentId>().expect("hybrid owner");
        let paths = torrent_storage_paths(&root.join("payload"), "root", owner)
            .expect("hybrid storage paths");
        assert_eq!(fs::read(paths.content.join("a")).unwrap(), [1]);
        assert!(!paths.content.join("b").exists());
        assert!(!paths.part.exists());
        let snapshot = service.store_mut().expect("store").snapshot().unwrap();
        assert_eq!(snapshot.torrents.len(), 1);
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("hybrid resume row");
        assert!(resume.info_hashes.is_hybrid());
        assert_eq!(resume.metainfo_source.as_deref(), Some(source.as_slice()));
        service
            .shutdown()
            .await
            .expect("shutdown hybrid application");
        drop(service);

        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen hybrid application");
        let resumed = reopened
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("reopen hybrid row");
        assert_eq!(resumed.state, TorrentState::Complete);
        assert!(resumed.info_hashes.is_hybrid());
        assert_eq!(resumed.metainfo_source, Some(source));
        assert!(!paths.part.exists());
        tokio::task::yield_now().await;
        assert_eq!(
            reopened
                .incoming_peer_snapshot()
                .map_or(0, |snapshot| snapshot.registrations),
            0,
            "wanted completion must not advertise unavailable unwanted pieces"
        );
        reopened.shutdown().await.expect("shutdown reopened hybrid");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove hybrid application root");
    }

    #[tokio::test]
    async fn hybrid_reconciliation_restarts_survivor_with_both_identities() {
        let root = test_root("hybrid-runtime-reconciliation");
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open hybrid reconciliation application");
        let source = hybrid_source();
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("hybrid reconciliation fixture");
        let raw_info = source[projection.info_span.clone()].to_vec();
        let hashes = projection.content.info_hashes();
        let v1 = hashes.v1_hash().expect("hybrid v1 identity");
        let v2 = hashes.v2_hash().expect("hybrid v2 identity");
        let add = |request_id: &str, magnet: String| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet,
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let first = service
            .dispatch(add(
                "hybrid-runtime-v1",
                format!("magnet:?xt=urn:btih:{v1}"),
            ))
            .await
            .expect("add first provisional hybrid owner");
        let first_id = match first.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("first provisional add result"),
        };
        let second = service
            .dispatch(add(
                "hybrid-runtime-v2",
                format!("magnet:?xt=urn:btmh:1220{v2}"),
            ))
            .await
            .expect("add second provisional hybrid owner");
        let second_id = match second.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("second provisional add result"),
        };
        assert_ne!(first_id, second_id);
        let reconciliation = service
            .store_mut()
            .expect("hybrid reconciliation store")
            .record_metadata(&second_id, &raw_info)
            .expect_err("second owner reconciles into first");
        assert!(matches!(
            reconciliation,
            StoreError::Reconciled {
                ref winner,
                ref loser,
            } if winner == &first_id && loser == &second_id
        ));

        service
            .reconcile_admission()
            .await
            .expect("restart reconciled survivor");
        let snapshot = service
            .store_mut()
            .expect("hybrid reconciliation store")
            .snapshot()
            .expect("hybrid reconciliation snapshot");
        assert_eq!(snapshot.torrents.len(), 1);
        assert_eq!(snapshot.torrents[0].torrent_id, first_id);
        assert!(!service.torrent_runtimes.contains_key(&second_id));
        let survivor = service
            .torrent_runtimes
            .get(&first_id)
            .expect("reconciled survivor runtime");
        assert!(survivor.handle().identity().info_hashes().is_hybrid());
        assert!(survivor.active_download().is_some());

        service
            .shutdown()
            .await
            .expect("shutdown hybrid reconciliation application");
        drop(service);
        fs::remove_dir_all(root).expect("remove hybrid reconciliation root");
    }

    #[test]
    fn hybrid_magnet_runtime_preserves_its_entry_lane_after_metadata() {
        let source = hybrid_source();
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("hybrid entry-lane fixture");
        let hashes = projection.content.info_hashes();
        let v1 = hashes.v1_hash().expect("hybrid v1 identity");
        let v2 = hashes.v2_hash().expect("hybrid v2 identity");
        let owner = TorrentId::new([0x56; 16]).expect("hybrid entry-lane owner");
        let default = runtime_identity(owner, hashes).expect("default hybrid identity");

        let v1_entry = magnet_runtime_identity(default, &format!("magnet:?xt=urn:btih:{v1}"))
            .expect("v1 hybrid entry lane");
        assert_eq!(v1_entry.swarm_key(), SwarmKey::V1(v1));
        assert_eq!(v1_entry.info_hashes(), hashes);

        let v2_entry = magnet_runtime_identity(default, &format!("magnet:?xt=urn:btmh:1220{v2}"))
            .expect("v2 hybrid entry lane");
        assert_eq!(v2_entry.swarm_key(), v2.swarm_key());
        assert_eq!(v2_entry.info_hashes(), hashes);
    }

    #[tokio::test]
    async fn pure_v2_magnet_download_restarts_from_info_only_metadata() {
        let root = test_root("pure-v2-magnet-download");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        );
        let piece_length = 32 * 1024_u32;
        let payload = (0..2 * piece_length as usize)
            .map(|index| ((index * 19 + 7) % 251) as u8)
            .collect::<Vec<_>>();
        let source = pure_v2_source_for_payload(&payload, piece_length);
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("pure-v2 magnet application fixture");
        let raw_info = source[projection.info_span.clone()].to_vec();
        let identity = projection
            .content
            .info_hashes()
            .v2_hash()
            .expect("pure-v2 magnet identity");
        let wire_hash = projection.content.swarm_key().into_bytes();
        let piece_roots = payload
            .chunks(piece_length as usize)
            .map(|piece| piece_root_from_data(piece, piece_length).expect("v2 magnet piece root"))
            .collect::<Vec<_>>();
        assert_eq!(piece_roots.len(), 2);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind pure-v2 magnet application peer");
        let address = listener.local_addr().expect("v2 magnet peer address");
        let peer_payload = payload.clone();
        let peer_info = raw_info.clone();
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept v2 magnet peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read v2 magnet handshake");
            decode_handshake(&handshake, wire_hash).expect("v2 magnet wire identity");
            let mut reserved = [0; 8];
            reserved[EXTENSION_PROTOCOL_RESERVED_INDEX] = EXTENSION_PROTOCOL_RESERVED_BIT;
            stream
                .write_all(&encode_handshake_with_reserved(
                    wire_hash,
                    *b"-RS-APP-MAG-V2-00000",
                    reserved,
                ))
                .await
                .expect("send v2 magnet handshake");
            stream
                .write_all(
                    &encode_message(&PeerMessage::Extended {
                        id: 0,
                        payload: encode_extension_handshake(Some(peer_info.len())),
                    })
                    .expect("encode v2 metadata handshake"),
                )
                .await
                .expect("advertise v2 metadata");
            let mut decoder = FrameDecoder::new();
            decoder.set_protocol(PeerProtocol::V2);
            let mut pending = std::collections::VecDeque::new();
            loop {
                match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                    PeerMessage::Extended { id: 0, .. } => {}
                    PeerMessage::Extended { id: 1, payload } => {
                        assert!(matches!(
                            parse_metadata_message(&payload).expect("parse v2 metadata request"),
                            MetadataMessage::Request { piece: 0 }
                        ));
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Extended {
                                    id: 1,
                                    payload: encode_metadata_data(0, peer_info.len(), &peer_info)
                                        .expect("encode v2 metadata"),
                                })
                                .expect("encode v2 metadata response"),
                            )
                            .await
                            .expect("send v2 metadata");
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Bitfield(vec![0xc0]))
                                    .expect("encode v2 magnet availability"),
                            )
                            .await
                            .expect("send v2 magnet availability");
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Unchoke)
                                    .expect("encode v2 magnet unchoke"),
                            )
                            .await
                            .expect("unchoke v2 magnet client");
                        break;
                    }
                    message => panic!("unexpected v2 metadata message {message:?}"),
                }
            }
            let mut authenticated_hashes = false;
            let mut completed = BTreeSet::new();
            while completed.len() != 2 {
                match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                    PeerMessage::HashRequest(request) => {
                        assert_eq!(request.base_layer, 1);
                        assert_eq!((request.index, request.count), (0, 2));
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Hashes(
                                    rstorrent_protocol::v2_hashes::HashResponse {
                                        request,
                                        hashes: piece_roots.clone(),
                                    },
                                ))
                                .expect("encode v2 piece roots"),
                            )
                            .await
                            .expect("send authenticated v2 piece roots");
                        authenticated_hashes = true;
                    }
                    PeerMessage::Request(request) => {
                        assert!(
                            authenticated_hashes,
                            "application payload must wait for authenticated piece roots"
                        );
                        let start =
                            request.index as usize * piece_length as usize + request.begin as usize;
                        let end = start + request.length as usize;
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Piece {
                                    index: request.index,
                                    begin: request.begin,
                                    block: peer_payload[start..end].to_vec(),
                                })
                                .expect("encode v2 magnet payload"),
                            )
                            .await
                            .expect("send v2 magnet payload");
                    }
                    PeerMessage::Have(piece) => {
                        completed.insert(piece);
                    }
                    PeerMessage::Interested
                    | PeerMessage::KeepAlive
                    | PeerMessage::Extended { id: 0, .. } => {}
                    message => panic!("unexpected v2 magnet content message {message:?}"),
                }
            }
        });
        let magnet = format!("magnet:?xt=urn:btmh:1220{identity}&x.pe={address}");
        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open v2 magnet application");
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-pure-v2-magnet".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: magnet.clone(),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add pure-v2 magnet");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("pure-v2 magnet add result"),
        };
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "pure-v2-magnet-complete",
        )
        .await;
        peer_task.await.expect("pure-v2 magnet peer task");
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("load completed v2 magnet");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.metainfo_source, None);
        assert_eq!(resume.magnet, magnet);
        service.shutdown().await.expect("shutdown v2 magnet app");
        drop(service);

        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen v2 magnet application");
        let resumed = reopened
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("restart info-only v2 magnet");
        assert_eq!(resumed.state, TorrentState::Complete);
        assert_eq!(resumed.raw_info, Some(raw_info));
        assert_eq!(resumed.metainfo_source, None);
        wait_for_seed_registrations(&reopened, 1).await;
        reopened
            .shutdown()
            .await
            .expect("shutdown reopened v2 magnet");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove pure-v2 magnet application root");
    }

    #[tokio::test]
    async fn pure_v2_active_generation_uploads_only_verified_piece_before_completion() {
        let root = test_root("pure-v2-active-upload");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        );
        let piece_length = 16_384_u32;
        let payload = (0..usize::try_from(piece_length).unwrap() + 17)
            .map(|index| ((index * 37 + 11) % 251) as u8)
            .collect::<Vec<_>>();
        let source = pure_v2_source_for_payload(&payload, piece_length);
        let projection =
            TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
                .expect("active pure-v2 fixture");
        assert_eq!(projection.content.piece_count(), 2);
        let wire_hash = projection.content.swarm_key().into_bytes();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind active pure-v2 source");
        let address = listener.local_addr().expect("active source address");
        let (first_verified, first_verified_rx) = tokio::sync::oneshot::channel();
        let (release_final, release_final_rx) = tokio::sync::oneshot::channel();
        let source_payload = payload.clone();
        let source_task = tokio::spawn(async move {
            let mut first_verified = Some(first_verified);
            let mut release_final_rx = Box::pin(release_final_rx);
            let mut final_requested = false;
            let mut final_released = false;
            let (mut stream, _) = listener.accept().await.expect("accept v2 downloader");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read active v2 handshake");
            decode_handshake(&handshake, wire_hash).expect("active v2 wire identity");
            stream
                .write_all(&encode_handshake(wire_hash, *b"-RS-V2-SOURCE-000000"))
                .await
                .expect("send active v2 handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).unwrap())
                .await
                .expect("advertise active v2 pieces");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).unwrap())
                .await
                .expect("unchoke active v2 downloader");
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            loop {
                tokio::select! {
                    released = &mut release_final_rx, if !final_released => {
                        released.expect("release final v2 piece");
                        final_released = true;
                        if final_requested {
                            stream
                                .write_all(
                                    &encode_message(&PeerMessage::Piece {
                                        index: 1,
                                        begin: 0,
                                        block: source_payload[piece_length as usize..].to_vec(),
                                    })
                                    .unwrap(),
                                )
                                .await
                                .expect("send released final v2 piece");
                            break;
                        }
                    }
                    message = read_peer_message(&mut stream, &mut decoder, &mut pending) => match message {
                        PeerMessage::Interested
                        | PeerMessage::KeepAlive
                        | PeerMessage::Have(0)
                        | PeerMessage::Extended { id: 0, .. } => {}
                        PeerMessage::Request(request) if request.index == 0 => {
                            assert_eq!(request.begin, 0);
                            assert_eq!(request.length, piece_length);
                            stream
                                .write_all(
                                    &encode_message(&PeerMessage::Piece {
                                        index: 0,
                                        begin: 0,
                                        block: source_payload[..piece_length as usize].to_vec(),
                                    })
                                    .unwrap(),
                                )
                                .await
                                .expect("send first v2 piece");
                            if let Some(first_verified) = first_verified.take() {
                                first_verified
                                    .send(())
                                    .expect("report first delivered piece");
                            }
                        }
                        PeerMessage::Request(request) if request.index == 1 => {
                            assert_eq!(request.begin, 0);
                            assert_eq!(request.length, 17);
                            final_requested = true;
                            if final_released {
                                stream
                                    .write_all(
                                        &encode_message(&PeerMessage::Piece {
                                            index: 1,
                                            begin: 0,
                                            block: source_payload[piece_length as usize..].to_vec(),
                                        })
                                        .unwrap(),
                                    )
                                    .await
                                    .expect("send final v2 piece");
                                break;
                            }
                        }
                        message => panic!("unexpected active v2 source message {message:?}"),
                    }
                }
            }
        });

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open active v2 application");
        let response = service
            .add_torrent_bytes(
                torrent_bytes_request("pure-v2-active-upload", &source, true),
                source,
            )
            .await
            .expect("add active pure-v2 source");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("active pure-v2 add result"),
        };
        service
            .torrent_runtimes
            .get(&torrent_id)
            .expect("active pure-v2 runtime")
            .handle()
            .peers()
            .observe_discovered_peer(PeerObservation::dialable(
                PeerEndpoint::new(address).expect("active source endpoint"),
                PeerSource::Manual,
            ))
            .expect("observe active pure-v2 source");
        if tokio::time::timeout(Duration::from_secs(5), first_verified_rx)
            .await
            .is_err()
        {
            let response = service
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: "pure-v2-active-delivery-timeout".to_owned(),
                    expected_revision: None,
                    command: Command::Snapshot,
                })
                .await
                .expect("snapshot timed-out pure-v2 delivery");
            let peers = torrent_peer_views(&service, &torrent_id).await;
            panic!(
                "first pure-v2 piece delivery deadline; source_finished={}; response={response:?}; peers={peers:?}",
                source_task.is_finished()
            );
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            for sequence in 0_u64.. {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("pure-v2-active-verified-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("snapshot active pure-v2 verification");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("active pure-v2 snapshot must succeed");
                };
                let torrent = snapshot
                    .torrents
                    .iter()
                    .find(|torrent| torrent.torrent_id == torrent_id)
                    .expect("active pure-v2 torrent");
                if torrent.verified_piece_count == 1 && torrent.state == TorrentState::Downloading {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("first pure-v2 piece verification deadline");
        wait_for_seed_registrations(&service, 1).await;

        let (mut active_peer, mut decoder, mut pending) =
            connect_application_seed_with_expected_availability(
                &service,
                wire_hash,
                *b"-RS-V2-ACTIVE-000000",
                false,
                vec![0x80],
            )
            .await;
        active_peer
            .write_all(&encode_message(&PeerMessage::Interested).unwrap())
            .await
            .expect("interest active pure-v2 upload");
        assert_eq!(
            read_peer_message(&mut active_peer, &mut decoder, &mut pending).await,
            PeerMessage::Interested
        );
        assert_eq!(
            read_peer_message(&mut active_peer, &mut decoder, &mut pending).await,
            PeerMessage::Unchoke
        );
        active_peer
            .write_all(
                &encode_message(&PeerMessage::Request(BlockRequest {
                    index: 0,
                    begin: 0,
                    length: piece_length,
                }))
                .unwrap(),
            )
            .await
            .expect("request active pure-v2 piece");
        assert_eq!(
            read_peer_message(&mut active_peer, &mut decoder, &mut pending).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: payload[..piece_length as usize].to_vec(),
            }
        );
        let active_snapshot = service
            .incoming_peer_snapshot()
            .expect("active pure-v2 incoming snapshot");
        assert_eq!(active_snapshot.registrations, 1);
        assert_eq!(active_snapshot.established, 1);
        assert_eq!(active_snapshot.payload_bytes_sent, u64::from(piece_length));

        release_final.send(()).expect("release final pure-v2 piece");
        // Observe completion without driving application maintenance. This
        // forces the ordering where the final download snapshot precedes the
        // old generation's termination and completed-seed reconciliation.
        tokio::time::timeout(Duration::from_secs(5), async {
            while !service
                .active_download_for(&torrent_id)
                .expect("completed content generation awaits application maintenance")
                .task
                .is_finished()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("active pure-v2 generation termination deadline");
        source_task.await.expect("active pure-v2 source task");
        wait_for_incoming_close(&mut active_peer, "pure-v2 completion").await;
        assert_eq!(
            service
                .store_mut()
                .unwrap()
                .load_resume(&torrent_id)
                .unwrap()
                .state,
            TorrentState::Complete,
        );
        assert_eq!(service.incoming_peer_snapshot().unwrap().registrations, 0);
        // Real hosts run the maintenance owner. This directly owned test
        // service must drive it through a command after the task terminates;
        // merely polling incoming_peer_snapshot cannot install a new seed.
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pure-v2-completed-seed-reconcile".to_owned(),
                expected_revision: None,
                command: Command::Snapshot,
            })
            .await
            .expect("reap completed v2 generation and reconcile seed admission");
        assert!(service.active_download_for(&torrent_id).is_none());
        wait_for_seed_registrations(&service, 1).await;
        let owner = torrent_id
            .parse::<TorrentId>()
            .expect("active pure-v2 owner");
        let paths = torrent_storage_paths(&root.join("payload"), "root", owner)
            .expect("active pure-v2 storage paths");
        assert_eq!(fs::read(paths.content.join("a")).unwrap(), payload);
        assert!(!paths.part.exists());
        let terminal = service
            .incoming_peer_snapshot()
            .expect("completed pure-v2 incoming snapshot");
        assert_eq!(terminal.established, 0);
        assert_eq!(terminal.payload_bytes_sent, u64::from(piece_length));
        service
            .maintain_accounting(true)
            .expect("checkpoint active pure-v2 accounting");
        let accounting = service
            .store_mut()
            .unwrap()
            .load_resume(&torrent_id)
            .unwrap()
            .accounting;
        assert_eq!(accounting.total_downloaded, payload.len() as u64);
        assert_eq!(accounting.total_uploaded, u64::from(piece_length));
        service
            .shutdown()
            .await
            .expect("shutdown active v2 application");
        drop(service);
        fs::remove_dir_all(root).expect("remove active pure-v2 application root");
    }

    async fn assert_metadata_only_add(await_file_selection: bool) {
        let root = test_root(if await_file_selection {
            "pending-selection-metadata-add"
        } else {
            "metadata-only-add"
        });
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind metadata peer");
        let address = listener.local_addr().expect("metadata peer address");
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept metadata peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read metadata handshake");
            let handshake =
                decode_handshake(&handshake, info_hash).expect("metadata handshake identity");
            assert!(handshake.supports_extensions());
            let mut reserved = [0; 8];
            reserved[EXTENSION_PROTOCOL_RESERVED_INDEX] = EXTENSION_PROTOCOL_RESERVED_BIT;
            stream
                .write_all(&encode_handshake_with_reserved(
                    info_hash,
                    *b"-RS-META-ONLY-000000",
                    reserved,
                ))
                .await
                .expect("send metadata handshake");
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            assert!(matches!(
                read_peer_message(&mut stream, &mut decoder, &mut pending).await,
                PeerMessage::Extended { id: 0, .. }
            ));
            stream
                .write_all(
                    &encode_message(&PeerMessage::Extended {
                        id: 0,
                        payload: encode_extension_handshake(Some(raw_info.len())),
                    })
                    .expect("encode extension handshake"),
                )
                .await
                .expect("send extension handshake");
            let PeerMessage::Extended {
                id: 1,
                payload: request,
            } = read_peer_message(&mut stream, &mut decoder, &mut pending).await
            else {
                panic!("metadata request expected");
            };
            assert_eq!(
                parse_metadata_message(&request).expect("parse metadata request"),
                MetadataMessage::Request { piece: 0 }
            );
            stream
                .write_all(
                    &encode_message(&PeerMessage::Extended {
                        id: 1,
                        payload: encode_metadata_data(0, raw_info.len(), &raw_info)
                            .expect("encode metadata"),
                    })
                    .expect("encode metadata message"),
                )
                .await
                .expect("send metadata");
            let mut tail = [0; 32];
            match stream.read(&mut tail).await {
                Ok(0) => {}
                Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
                outcome => panic!("metadata connection did not close: {outcome:?}"),
            }
        });

        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: format!("metadata-only-add-{await_file_selection}"),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: await_file_selection,
                    await_file_selection,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add metadata-only torrent");
        let snapshot = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut ready = None;
            for sequence in 0..100 {
                tokio::task::yield_now().await;
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("metadata-snapshot-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("metadata snapshot");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot failed");
                };
                if snapshot.torrents[0].metadata_available {
                    ready = Some(snapshot);
                    break;
                }
            }
            ready.expect("metadata did not become available")
        })
        .await
        .expect("metadata-only add timed out");
        assert_eq!(snapshot.torrents[0].state, TorrentState::Paused);
        assert_eq!(snapshot.torrents[0].storage_state, StorageState::Available);
        assert_eq!(
            snapshot.torrents[0].awaiting_file_selection,
            await_file_selection
        );
        let owner = snapshot.torrents[0]
            .torrent_id
            .parse::<TorrentId>()
            .expect("opaque owner");
        let paths = torrent_storage_paths(&root.join("payload"), "multi", owner)
            .expect("plan content paths");
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        tokio::time::timeout(std::time::Duration::from_secs(1), peer_task)
            .await
            .expect("metadata peer did not join")
            .expect("metadata peer task");
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn metadata_only_add_verifies_metadata_without_content_artifacts() {
        assert_metadata_only_add(false).await;
    }

    #[tokio::test]
    async fn download_all_pending_add_admits_late_metadata_without_another_confirmation() {
        let root = test_root("pending-all-late-metadata");
        let raw_info = multi_file_info();
        let hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let (peer, release, peer_task) = spawn_gated_metadata_peer(raw_info).await;
        let mut service = ApplicationService::open(config(&root)).await.unwrap();
        let added = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pending-add".into(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{}&x.pe={peer}&so=1",
                        super::encode_info_hash(hash)
                    ),
                    storage_root: "downloads".into(),
                    start_content: true,
                    await_file_selection: true,
                    skip_files: vec![],
                },
            })
            .await
            .unwrap();
        let Some(CommandResult::AddTorrent { result }) = added.result else {
            panic!("add result")
        };
        let id = result.torrent_id;
        let paths =
            torrent_storage_paths(&root.join("payload"), "multi", id.parse().unwrap()).unwrap();
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        let confirmed = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-all".into(),
                expected_revision: None,
                command: Command::DownloadAllPendingAdd {
                    torrent_id: id.clone(),
                    disable_future: false,
                },
            })
            .await
            .unwrap();
        assert!(matches!(confirmed.outcome, ResponseOutcome::Success { .. }));
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: "all-snapshot".into(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .unwrap();
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot")
                };
                if snapshot.torrents[0].metadata_available {
                    assert!(!snapshot.torrents[0].awaiting_file_selection);
                    assert!(snapshot.torrents[0].desired_running);
                    assert_eq!(
                        snapshot.torrents[0].selected_file_count,
                        snapshot.torrents[0].selectable_file_count
                    );
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("late metadata admitted");
        tokio::time::timeout(Duration::from_secs(2), peer_task)
            .await
            .unwrap()
            .unwrap();
        service.shutdown().await.unwrap();
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pending_selection_add_verifies_metadata_without_content_artifacts() {
        assert_metadata_only_add(true).await;
    }

    #[tokio::test]
    async fn ephemeral_application_owns_loopback_state_until_joined_shutdown() {
        let root = test_root("ephemeral-loopback");
        let payload_root = root.join("payload");
        fs::create_dir_all(&payload_root).expect("pre-provision payload root");
        let absent_profile = root.join("profile-was-never-configured");
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let (address, peer_task) = spawn_metadata_peer(raw_info).await;
        let mut application_config = ApplicationConfig::ephemeral(
            "ephemeral-test".to_owned(),
            vec![ConfiguredStorageRoot::path(
                "downloads",
                payload_root.clone(),
            )],
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                std::time::Duration::from_secs(5),
                std::time::Duration::from_secs(5),
            ),
        );
        application_config.peer_transport_policy = rstorrent_engine::PeerTransportPolicy::TcpOnly;
        let mut service = ApplicationService::open(application_config.clone())
            .await
            .expect("open ephemeral application");
        assert!(!absent_profile.exists());
        let usage = service
            .store
            .lock()
            .expect("session store")
            .page_usage()
            .expect("session page usage");
        assert!(usage.page_count <= usage.maximum_page_count);

        let diagnostics = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Diagnostics,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: Some(DiagnosticFilter::default()),
                catalog_page: None,
            })
            .expect("diagnostic subscription")
            .next_update()
            .await
            .expect("diagnostic snapshot");
        assert!(
            serde_json::to_string(&diagnostics)
                .expect("encode diagnostics")
                .contains("ephemeral")
        );

        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "ephemeral-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add ephemeral metadata-only torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("ephemeral add result"),
        };
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                tokio::task::yield_now().await;
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: "ephemeral-wait".to_owned(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("ephemeral snapshot");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("snapshot failed");
                };
                if snapshot.torrents[0].metadata_available {
                    break;
                }
            }
        })
        .await
        .expect("ephemeral metadata timed out");
        tokio::time::timeout(std::time::Duration::from_secs(1), peer_task)
            .await
            .expect("ephemeral peer did not join")
            .expect("ephemeral peer task");

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "ephemeral-selection".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                    priority: FilePriority::Skip,
                },
            })
            .await
            .expect("change ephemeral selection");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "ephemeral-setting".to_owned(),
                expected_revision: None,
                command: Command::SetShowAddOptions { show: false },
            })
            .await
            .expect("change ephemeral setting");
        service
            .speed_recorder
            .record(ByteMetric::PayloadReceived, 4096);

        let owner = ViewSetOwner::trusted("ephemeral-client");
        let opened = service
            .open_view_set(
                owner.clone(),
                OpenViewSetRequest {
                    views: vec![ViewSpec::TorrentList {
                        view_id: "library".to_owned(),
                        delivery: ViewDeliveryPolicy::default(),
                    }],
                    options: OpenViewSetOptions::default(),
                },
            )
            .expect("open ephemeral view set");
        service
            .close_view_set(&owner, &opened.view_set_id)
            .expect("close last ephemeral view set");
        let snapshot = service
            .store
            .lock()
            .expect("session store")
            .snapshot()
            .expect("snapshot after detachment");
        assert_eq!(snapshot.torrents[0].skip_files, vec![1]);
        assert!(!snapshot.storage.show_add_options);
        assert!(!absent_profile.exists());
        assert_eq!(
            fs::read_dir(&payload_root)
                .expect("read payload root")
                .count(),
            0
        );

        service.shutdown().await.expect("joined ephemeral shutdown");
        assert!(
            service
                .store
                .lock()
                .expect("session store after shutdown")
                .load_dht_snapshot()
                .expect("load in-memory DHT snapshot")
                .is_some()
        );
        drop(service);
        assert!(!absent_profile.exists());
        assert_eq!(
            fs::read_dir(&payload_root)
                .expect("read payload root")
                .count(),
            0
        );

        let mut fresh = ApplicationService::open(application_config)
            .await
            .expect("open fresh ephemeral application");
        let fresh_snapshot = fresh
            .store
            .lock()
            .expect("fresh session store")
            .snapshot()
            .expect("fresh snapshot");
        assert_eq!(fresh_snapshot.revision, "0");
        assert!(fresh_snapshot.torrents.is_empty());
        assert!(fresh_snapshot.storage.show_add_options);
        assert!(
            fresh
                .store
                .lock()
                .expect("fresh session store")
                .load_dht_snapshot()
                .expect("load fresh DHT snapshot")
                .is_none()
        );
        fresh.shutdown().await.expect("shutdown fresh application");
        drop(fresh);
        fs::remove_dir_all(root).expect("remove ephemeral test root");
    }

    #[tokio::test]
    async fn ephemeral_application_opens_and_closes_offline_without_a_profile() {
        let root = test_root("ephemeral-offline");
        let payload_root = root.join("payload");
        fs::create_dir_all(&payload_root).expect("pre-provision payload root");
        let absent_profile = root.join("profile-was-never-configured");
        let mut application_config = ApplicationConfig::ephemeral(
            "offline-ephemeral".to_owned(),
            vec![ConfiguredStorageRoot::path(
                "downloads",
                payload_root.clone(),
            )],
            NetworkConfig::new(
                NetworkPolicy::Offline,
                std::time::Duration::from_secs(1),
                std::time::Duration::from_secs(1),
            ),
        );
        application_config.dht.bootstrap_nodes.clear();
        let mut service = ApplicationService::open(application_config)
            .await
            .expect("open offline ephemeral application");
        assert_eq!(service.revision().expect("offline revision"), 0);
        assert!(!absent_profile.exists());
        let settings = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            peer_connection_limit: 17,
            upload_slots: 0,
            upload_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: 12 * 1_024,
            },
            download_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: 48 * 1_024,
            },
            ..ClientSettings::default()
        };
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "ephemeral-live-client-settings".to_owned(),
                expected_revision: Some("0".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: settings.clone().into(),
                },
            })
            .await
            .expect("apply ephemeral client settings");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        let runtime = wait_for_client_settings(&service, |runtime| {
            runtime.configured == settings
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.upload_slots_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.bandwidth_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(runtime.effective_peer_connection_limit, 17);
        assert_eq!(runtime.effective_upload_slots, 0);
        assert_eq!(
            runtime.effective_upload_rate_limit,
            settings.upload_rate_limit
        );
        assert_eq!(
            runtime.effective_download_rate_limit,
            settings.download_rate_limit
        );
        assert!(service.incoming_peer_snapshot().is_some());
        assert_eq!(service.revision().expect("ephemeral revision"), 1);
        assert!(!absent_profile.exists());
        service
            .shutdown()
            .await
            .expect("shutdown offline ephemeral application");
        assert!(service.incoming_peer_snapshot().is_none());
        drop(service);
        assert!(!absent_profile.exists());
        assert_eq!(
            fs::read_dir(&payload_root)
                .expect("read payload root")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("remove offline ephemeral test root");
    }

    #[tokio::test]
    async fn reset_client_settings_converges_to_configured_defaults_live() {
        let root = test_root("reset-client-settings-runtime");
        let configuration = config(&root).with_fresh_profile_defaults();
        let reset_target = configuration.initial_client_settings.clone();
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open application");
        let added = service
            .dispatch(add_request("add-reset-runtime-target", &"ab".repeat(20)))
            .await
            .expect("add torrent before reset");
        let torrent_id = match added.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("reset fixture add result"),
        };
        let changed = ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port: 7_101 },
            preferred_listen_port: 7_102,
            peer_connection_limit: 17,
            upload_slots: 0,
            active_downloads: 4,
            active_seeds: crate::ActiveSeedLimit::Unlimited,
            share_ratio_limit_percent: 101,
            finished_download_ratio_limit_percent: 102,
            finished_time_limit_seconds: 103,
            upload_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: 12 * 1_024,
            },
            download_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: 48 * 1_024,
            },
            encryption: crate::EncryptionPolicy::Required,
            ipv6_enabled: false,
            dht_enabled: false,
            peer_exchange_enabled: false,
            tracker_https_server_authentication: crate::HttpsServerAuthenticationPolicy::Disabled,
            ..ClientSettings::default()
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "change-runtime-before-reset".to_owned(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: changed.clone().into(),
                },
            })
            .await
            .expect("change client settings");
        wait_for_client_settings(&service, |runtime| runtime.configured == changed).await;

        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "reset-runtime-client-settings".to_owned(),
                expected_revision: Some("2".to_owned()),
                command: Command::ResetClientSettings,
            })
            .await
            .expect("reset client settings");
        let ResponseOutcome::Success { snapshot } = response.outcome else {
            panic!("reset command must succeed");
        };
        assert_eq!(snapshot.client_settings, reset_target);
        assert_eq!(snapshot.torrents.len(), 1);
        assert_eq!(snapshot.torrents[0].torrent_id, torrent_id);
        assert_eq!(snapshot.storage.roots.len(), 1);

        let runtime = wait_for_client_settings(&service, |runtime| {
            runtime.configured == reset_target
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && runtime.port_mapping_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.upload_slots_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.bandwidth_application == crate::ClientSettingsApplicationState::Applied
                && runtime.encryption_application == crate::ClientSettingsApplicationState::Applied
                && runtime.ipv6_application == crate::ClientSettingsApplicationState::Applied
                && runtime.dht_application == crate::ClientSettingsApplicationState::Applied
                && runtime.peer_exchange_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.tracker_https_authentication_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(runtime.configured, reset_target);

        service.shutdown().await.expect("shutdown application");
        drop(service);
        fs::remove_dir_all(root).expect("remove reset runtime root");
    }

    #[tokio::test]
    async fn clear_app_data_reopens_empty_profile_and_preserves_external_files() {
        let root = test_root("clear-app-data");
        let payload = root.join("payload");
        fs::create_dir_all(&payload).expect("create payload root");
        let external_file = payload.join("unrelated.txt");
        fs::write(&external_file, b"keep").expect("write unrelated file");
        let mut configuration = config(&root);
        configuration.storage_roots.clear();
        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open application");
        service
            .install_path_storage_root(&payload)
            .expect("register selected root");
        let profile_root = root.join("profile");
        let private_sentinel = profile_root.join("unrelated-private.txt");
        fs::write(&private_sentinel, b"keep").expect("write private sentinel");
        let invalid = service
            .dispatch(RequestEnvelope {
                version: 0,
                request_id: "clear-invalid-version".to_owned(),
                expected_revision: None,
                command: Command::ClearAppData,
            })
            .await
            .expect("invalid version response");
        assert!(matches!(invalid.outcome, ResponseOutcome::Error { .. }));
        assert_eq!(service.storage_snapshot().unwrap().roots.len(), 1);
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "clear-empty-app-data".to_owned(),
                expected_revision: None,
                command: Command::ClearAppData,
            })
            .await
            .expect("clear app data");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        assert!(service.storage_snapshot().unwrap().roots.is_empty());
        assert_eq!(service.revision().unwrap(), 0);
        assert_eq!(fs::read(&external_file).unwrap(), b"keep");
        assert_eq!(fs::read(&private_sentinel).unwrap(), b"keep");
        service.shutdown().await.expect("shutdown cleared service");
        drop(service);
        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen cleared profile");
        assert!(reopened.storage_snapshot().unwrap().roots.is_empty());
        reopened
            .shutdown()
            .await
            .expect("shutdown reopened service");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn clear_app_data_rejects_retained_torrents_without_mutation() {
        let root = test_root("clear-app-data-retained");
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        let added = service
            .dispatch(add_request("clear-retained-add", &"ac".repeat(20)))
            .await
            .expect("add torrent");
        assert!(matches!(added.outcome, ResponseOutcome::Success { .. }));
        let refused = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "clear-retained-refused".to_owned(),
                expected_revision: None,
                command: Command::ClearAppData,
            })
            .await
            .expect("clear response");
        assert!(matches!(refused.outcome, ResponseOutcome::Error { .. }));
        assert_eq!(service.storage_snapshot().unwrap().roots.len(), 1);
        assert_eq!(
            service
                .store_mut()
                .unwrap()
                .snapshot()
                .unwrap()
                .torrents
                .len(),
            1
        );
        service.shutdown().await.expect("shutdown application");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn torrent_transfer_limits_apply_live_and_restore_with_the_registration() {
        let root = test_root("torrent-transfer-limit-runtime");
        let configuration = config(&root);
        let torrent_id = "ab".repeat(20);
        let mut service = ApplicationService::open(configuration.clone())
            .await
            .expect("open application");
        let response = service
            .dispatch(add_request("add-transfer-limit-runtime", &torrent_id))
            .await
            .expect("add torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("transfer-limit add result"),
        };
        let limits = crate::TorrentTransferLimits {
            upload: crate::TransferRateLimit::Limited {
                bytes_per_second: 24 * 1_024,
            },
            download: crate::TransferRateLimit::Limited {
                bytes_per_second: 96 * 1_024,
            },
        };
        let initial_request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "update-transfer-limit-runtime".to_owned(),
            expected_revision: None,
            command: Command::UpdateTorrentSettings {
                torrent_id: torrent_id.clone(),
                patch: limits.into(),
            },
        };
        let response = service
            .dispatch(initial_request.clone())
            .await
            .expect("set live torrent limits");
        let ResponseOutcome::Success { snapshot } = response.outcome else {
            panic!("torrent limit command must succeed");
        };
        assert_eq!(snapshot.torrents[0].transfer_limits, limits);
        let active = service
            .torrent_runtimes
            .get(&torrent_id)
            .expect("torrent runtime")
            .peers()
            .transfer_rate_limits();
        assert_eq!(active.upload.bytes_per_second(), Some(24 * 1_024));
        assert_eq!(active.download.bytes_per_second(), Some(96 * 1_024));

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "update-download-limit-runtime".to_owned(),
                expected_revision: None,
                command: Command::UpdateTorrentSettings {
                    torrent_id: torrent_id.clone(),
                    patch: crate::TorrentSettingsPatch {
                        upload_rate_limit: None,
                        download_rate_limit: Some(crate::TransferRateLimit::Limited {
                            bytes_per_second: 128 * 1_024,
                        }),
                    },
                },
            })
            .await
            .expect("update only the live download limit");
        service
            .dispatch(initial_request)
            .await
            .expect("replay the older accepted request");
        let after_replay = service
            .torrent_runtimes
            .get(&torrent_id)
            .expect("torrent runtime after replay")
            .peers()
            .transfer_rate_limits();
        assert_eq!(after_replay.upload.bytes_per_second(), Some(24 * 1_024));
        assert_eq!(after_replay.download.bytes_per_second(), Some(128 * 1_024));
        let observed = wait_for_client_settings(&service, |runtime| {
            runtime.bandwidth.upload.registered_torrents == 1
                && runtime.bandwidth.download.registered_torrents == 1
        })
        .await;
        assert_eq!(observed.bandwidth.upload.active_waiters, 0);
        assert_eq!(observed.bandwidth.download.active_waiters, 0);
        assert_eq!(observed.bandwidth.upload.queued_requested_bytes, "0");
        service.shutdown().await.expect("shutdown application");
        drop(service);

        let mut reopened = ApplicationService::open(configuration)
            .await
            .expect("reopen application");
        let restored = reopened
            .torrent_runtimes
            .get(&torrent_id)
            .expect("restored torrent runtime")
            .peers()
            .transfer_rate_limits();
        assert_eq!(restored.upload.bytes_per_second(), Some(24 * 1_024));
        assert_eq!(restored.download.bytes_per_second(), Some(128 * 1_024));
        reopened
            .shutdown()
            .await
            .expect("shutdown reopened application");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    async fn answer_dht_query(router: &UdpSocket) -> SocketAddr {
        let mut packet = [0_u8; 1024];
        let (length, client) = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            router.recv_from(&mut packet),
        )
        .await
        .expect("DHT query timed out")
        .expect("receive DHT query");
        let DhtMessage::Query(query) = decode_dht(&packet[..length]).expect("decode DHT query")
        else {
            panic!("DHT query expected");
        };
        let response = encode_dht_response(
            &query.transaction,
            NodeId([9; 20]),
            &[],
            &[],
            None,
            dht_endpoint(client),
        )
        .expect("encode DHT response");
        router
            .send_to(&response, client)
            .await
            .expect("send DHT response");
        client
    }

    async fn local_network_ipv4() -> Option<Ipv4Addr> {
        let probe = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).await.ok()?;
        probe
            .connect((Ipv4Addr::new(239, 255, 255, 250), 1_900))
            .await
            .ok()?;
        let SocketAddr::V4(address) = probe.local_addr().ok()? else {
            return None;
        };
        let address = *address.ip();
        (!address.is_unspecified()
            && !address.is_loopback()
            && !address.is_multicast()
            && !address.is_broadcast())
        .then_some(address)
    }

    async fn available_port_on(address: Ipv4Addr) -> Option<u16> {
        for _ in 0..16 {
            let tcp = TcpListener::bind((address, 0)).await.ok()?;
            let port = tcp.local_addr().ok()?.port();
            if UdpSocket::bind((address, port)).await.is_ok() {
                return Some(port);
            }
        }
        None
    }

    #[tokio::test]
    async fn application_coordinates_tcp_and_dht_udp_endpoints() {
        let root = test_root("coordinated-session-sockets");
        let preferred_probe = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind preferred-port probe");
        let preferred_port = preferred_probe.local_addr().unwrap().port();
        let preferred_udp_probe = UdpSocket::bind((Ipv4Addr::LOCALHOST, preferred_port))
            .await
            .expect("bind preferred UDP-port probe");
        drop(preferred_probe);
        drop(preferred_udp_probe);
        let router = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind DHT router");
        let router_address = router.local_addr().expect("DHT router address");
        let mut configuration = config(&root);
        configuration.dht.bootstrap_nodes = vec![BootstrapNode::Address(router_address)];
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                preferred_listen_port: preferred_port,
                ..ClientSettings::default()
            },
        );
        let mut application = ApplicationService::open(configuration)
            .await
            .expect("open coordinated application");
        let runtime = client_settings_runtime(&application).await;
        let ListenerStatus::Listening {
            address: tcp_address,
            port: tcp_port,
        } = runtime.listener_status
        else {
            panic!("coordinated TCP listener must be active");
        };
        let crate::SessionUdpStatus::Bound {
            address: udp_address,
            port: udp_port,
            coordinated_with_tcp,
        } = runtime.session_udp_status
        else {
            panic!("session UDP endpoint must be active");
        };
        assert_eq!(tcp_address, "127.0.0.1");
        assert_eq!(udp_address, tcp_address);
        assert_eq!(tcp_port, preferred_port);
        assert_eq!(udp_port, tcp_port);
        assert!(coordinated_with_tcp);
        assert_eq!(
            application
                .session_network()
                .session_udp_local_address_for(rstorrent_engine::AddressFamily::Ipv6),
            Some(SocketAddr::from((Ipv6Addr::LOCALHOST, preferred_port)))
        );
        assert_eq!(
            application.session_network().session_udp_snapshot().tasks,
            2
        );
        assert_eq!(
            application
                .session_network()
                .session_udp_snapshot()
                .task_high_water,
            2
        );
        let ipv6_generation = application
            .session_network()
            .session_udp_generation_for(rstorrent_engine::AddressFamily::Ipv6)
            .expect("IPv6 UDP generation exists");

        let observed_dht_source = answer_dht_query(&router).await;
        assert_eq!(observed_dht_source.ip().to_string(), udp_address);
        assert_eq!(observed_dht_source.port(), udp_port);
        let tcp = TcpStream::connect((tcp_address.as_str(), tcp_port))
            .await
            .expect("connect observed TCP endpoint");
        drop(tcp);
        let advertised = *application
            .session_network()
            .advertised_endpoint()
            .subscribe_wire()
            .borrow();
        assert_eq!(
            advertised.ipv6.endpoint,
            Some(SocketAddr::from((Ipv6Addr::LOCALHOST, preferred_port)))
        );
        TcpStream::connect((Ipv6Addr::LOCALHOST, preferred_port))
            .await
            .expect("IPv6 TCP endpoint accepts");
        let dht_before = dht_runtime(&application).await;
        let dht_node_id = dht_ipv4_node_id(&dht_before).to_owned();
        let replacement_port = available_port_on(Ipv4Addr::LOCALHOST)
            .await
            .expect("find replacement coordinated port");
        let replacement = ClientSettings {
            listener: ListenerPolicy::FixedLoopback {
                port: replacement_port,
            },
            preferred_listen_port: preferred_port,
            ..ClientSettings::default()
        };
        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "replace-coordinated-session-sockets".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: replacement.clone().into(),
                },
            })
            .await
            .expect("replace coordinated session sockets");
        let replaced = wait_for_client_settings(&application, |runtime| {
            runtime.configured == replacement
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && matches!(
                    runtime.listener_status,
                    ListenerStatus::Listening { port, .. } if port == replacement_port
                )
        })
        .await;
        assert!(matches!(
            replaced.session_udp_status,
            crate::SessionUdpStatus::Bound {
                port,
                coordinated_with_tcp: true,
                ..
            } if port == replacement_port
        ));
        assert_eq!(
            dht_ipv4_node_id(&dht_runtime(&application).await),
            dht_node_id
        );
        assert_eq!(
            application
                .session_network()
                .session_udp_local_address_for(rstorrent_engine::AddressFamily::Ipv6),
            Some(SocketAddr::from((Ipv6Addr::LOCALHOST, replacement_port)))
        );
        assert!(
            application
                .session_network()
                .session_udp_generation_for(rstorrent_engine::AddressFamily::Ipv6)
                .expect("replacement IPv6 UDP generation exists")
                > ipv6_generation
        );
        TcpStream::connect((Ipv4Addr::LOCALHOST, replacement_port))
            .await
            .expect("new TCP endpoint accepts after handover");
        TcpStream::connect((Ipv6Addr::LOCALHOST, replacement_port))
            .await
            .expect("new IPv6 TCP endpoint accepts after handover");
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, tcp_port))
                .await
                .is_err()
        );
        assert_eq!(
            application
                .session_network()
                .session_udp_snapshot()
                .task_high_water,
            3
        );
        let ipv4_only = ClientSettings {
            ipv6_enabled: false,
            ..replacement.clone()
        };
        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "disable-ipv6-session-sockets".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: ipv4_only.clone().into(),
                },
            })
            .await
            .expect("disable IPv6");
        let disabled = wait_for_client_settings(&application, |runtime| {
            runtime.configured == ipv4_only
                && !runtime.effective_ipv6_enabled
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert!(!disabled.effective_ipv6_enabled);
        assert_eq!(
            application
                .session_network()
                .session_udp_local_address_for(rstorrent_engine::AddressFamily::Ipv6),
            None
        );
        assert_eq!(
            application.session_network().session_udp_snapshot().tasks,
            1
        );
        assert!(
            TcpStream::connect((Ipv6Addr::LOCALHOST, replacement_port))
                .await
                .is_err()
        );
        TcpStream::connect((Ipv4Addr::LOCALHOST, replacement_port))
            .await
            .expect("IPv4 remains serving while IPv6 is disabled");

        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "reenable-ipv6-session-sockets".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: replacement.clone().into(),
                },
            })
            .await
            .expect("re-enable IPv6");
        wait_for_client_settings(&application, |runtime| {
            runtime.configured == replacement
                && runtime.effective_ipv6_enabled
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(
            application.session_network().session_udp_snapshot().tasks,
            2
        );
        TcpStream::connect((Ipv6Addr::LOCALHOST, replacement_port))
            .await
            .expect("IPv6 listener returns after re-enable");
        application.shutdown().await.expect("joined shutdown");
        assert!(application.session_network.is_none());
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn session_utp_default_and_tcp_override_have_joined_lifecycles() {
        let default_root = test_root("session-utp-default-on");
        let default_config = default_config(&default_root);
        assert_eq!(
            default_config.peer_transport_policy,
            rstorrent_engine::PeerTransportPolicy::PreferUtp
        );
        let ephemeral_config = ApplicationConfig::ephemeral(
            "utp-default-ephemeral".to_owned(),
            Vec::new(),
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                Duration::from_secs(5),
                Duration::from_secs(5),
            ),
        );
        assert_eq!(
            ephemeral_config.peer_transport_policy,
            rstorrent_engine::PeerTransportPolicy::PreferUtp
        );
        let mut default_application = ApplicationService::open(default_config)
            .await
            .expect("open default application");
        let default_utp = default_application
            .session_network()
            .utp_handle()
            .expect("default policy starts uTP");
        assert_eq!(default_utp.snapshot().active_connections, 0);
        assert_eq!(default_utp.snapshot().incoming_half_open, 0);
        assert_eq!(default_utp.snapshot().worker_panics, 0);
        default_application
            .shutdown()
            .await
            .expect("default application shutdown");
        assert_eq!(default_utp.snapshot().active_connections, 0);
        assert_eq!(default_utp.snapshot().incoming_half_open, 0);
        assert_eq!(default_utp.snapshot().worker_panics, 0);
        drop(default_application);
        fs::remove_dir_all(default_root).expect("remove default root");

        let tcp_root = test_root("session-utp-tcp-override");
        let mut tcp_config = config(&tcp_root);
        tcp_config.peer_transport_policy = rstorrent_engine::PeerTransportPolicy::TcpOnly;
        let mut tcp_application = ApplicationService::open(tcp_config)
            .await
            .expect("open TCP-only application");
        assert!(tcp_application.session_network().utp_handle().is_none());
        tcp_application
            .shutdown()
            .await
            .expect("TCP-only application shutdown");
        drop(tcp_application);
        fs::remove_dir_all(tcp_root).expect("remove TCP-only root");
    }

    #[tokio::test]
    async fn rapid_client_settings_changes_converge_only_to_latest_generation() {
        let root = test_root("rapid-client-settings");
        let mut reservations = Vec::new();
        while reservations.len() < 3 {
            let tcp = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .expect("reserve rapid-settings TCP port");
            let port = tcp.local_addr().expect("reserved TCP address").port();
            if let Ok(udp) = UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).await {
                reservations.push((tcp, udp, port));
            }
        }
        let ports = reservations
            .iter()
            .map(|(_, _, port)| *port)
            .collect::<Vec<_>>();
        drop(reservations);
        let mut configuration = config(&root);
        configuration.initial_client_settings = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            ..ClientSettings::default()
        };
        let mut application = ApplicationService::open(configuration)
            .await
            .expect("open rapid-settings application");
        let dht_before = dht_runtime(&application).await;
        let dht_node_id = dht_ipv4_node_id(&dht_before).to_owned();
        let attempts = [
            ClientSettings {
                listener: ListenerPolicy::FixedLoopback { port: ports[0] },
                preferred_listen_port: ports[0],
                peer_connection_limit: 101,
                upload_slots: 1,
                ..ClientSettings::default()
            },
            ClientSettings {
                listener: ListenerPolicy::FixedLoopback { port: ports[1] },
                preferred_listen_port: ports[1],
                peer_connection_limit: 102,
                upload_slots: 2,
                ..ClientSettings::default()
            },
            ClientSettings {
                listener: ListenerPolicy::FixedLoopback { port: ports[2] },
                preferred_listen_port: ports[2],
                peer_connection_limit: 103,
                upload_slots: 3,
                ..ClientSettings::default()
            },
        ];
        for (index, settings) in attempts.iter().enumerate() {
            application
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("rapid-settings-{index}"),
                    expected_revision: None,
                    command: Command::UpdateClientSettings {
                        patch: settings.clone().into(),
                    },
                })
                .await
                .expect("accept rapid settings generation");
        }
        let final_settings = attempts.last().expect("final settings").clone();
        let final_runtime = wait_for_client_settings(&application, |runtime| {
            runtime.configured == final_settings
                && runtime.effective_listener
                    == Some(crate::EffectiveListenerSettings::from_settings(
                        &final_settings,
                    ))
                && runtime.effective_peer_connection_limit == 103
                && runtime.effective_upload_slots == 3
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && runtime.port_mapping_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.upload_slots_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert!(matches!(
            final_runtime.listener_status,
            ListenerStatus::Listening { port, .. } if port == ports[2]
        ));
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            client_settings_runtime(&application).await.configured,
            final_settings
        );
        assert_eq!(
            dht_ipv4_node_id(&dht_runtime(&application).await),
            dht_node_id
        );
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, ports[0]))
                .await
                .is_err()
        );
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, ports[1]))
                .await
                .is_err()
        );
        TcpStream::connect((Ipv4Addr::LOCALHOST, ports[2]))
            .await
            .expect("latest listener accepts");
        assert_eq!(
            application
                .session_network()
                .session_udp_snapshot()
                .task_high_water,
            3
        );
        application.shutdown().await.expect("joined shutdown");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn live_peer_limit_decrease_cancels_to_absolute_bound_then_increases() {
        let root = test_root("live-peer-limit");
        let mut application = ApplicationService::open(config(&root))
            .await
            .expect("open peer-limit application");
        let budget = application.session_network().peer_budget();
        let mut permits = Vec::new();
        for index in 0..14 {
            let direction = if index % 2 == 0 {
                PeerBudgetDirection::Outgoing
            } else {
                PeerBudgetDirection::Incoming
            };
            let mut permit = budget.try_acquire(direction).expect("acquire test permit");
            if index < 7 {
                permit.mark_established();
            }
            permits.push(permit);
        }
        let expected_cancelled = permits[11..]
            .iter()
            .map(|permit| permit.generation())
            .collect::<Vec<_>>();
        let reduced = ClientSettings {
            peer_connection_limit: 1,
            ..ClientSettings::default()
        };
        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "decrease-live-peer-limit".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: reduced.clone().into(),
                },
            })
            .await
            .expect("decrease live peer limit");
        let cancelled = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let cancelled = permits
                    .iter()
                    .filter(|permit| permit.cancellation_token().is_cancelled())
                    .map(|permit| permit.generation())
                    .collect::<Vec<_>>();
                if cancelled.len() == 3 {
                    break cancelled;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("peer cancellation requests");
        assert_eq!(cancelled, expected_cancelled);
        permits.retain(|permit| !permit.cancellation_token().is_cancelled());
        let runtime = wait_for_client_settings(&application, |runtime| {
            runtime.configured == reduced
                && runtime.effective_peer_connection_limit == 1
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(runtime.effective_peer_connection_limit, 1);
        assert_eq!(budget.snapshot().total, 11);

        let increased = ClientSettings {
            peer_connection_limit: 20,
            ..reduced
        };
        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "increase-live-peer-limit".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: increased.clone().into(),
                },
            })
            .await
            .expect("increase live peer limit");
        wait_for_client_settings(&application, |runtime| {
            runtime.configured == increased
                && runtime.effective_peer_connection_limit == 20
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        let admitted = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("increased limit admits immediately");
        drop(admitted);
        drop(permits);
        application.shutdown().await.expect("joined shutdown");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn live_encryption_policy_changes_without_restarting_the_listener() {
        let root = test_root("live-encryption-policy");
        let mut configuration = config(&root);
        configuration.initial_client_settings = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            encryption: EncryptionPolicy::Allow,
            ..ClientSettings::default()
        };
        let mut application = ApplicationService::open(configuration)
            .await
            .expect("open encryption-policy application");
        let before = application
            .incoming_peer_snapshot()
            .expect("loopback listener snapshot")
            .listen_address;
        let policy = application.session_network().encryption();
        let required = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            encryption: EncryptionPolicy::Required,
            ..ClientSettings::default()
        };
        application
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "require-mse-live".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: required.clone().into(),
                },
            })
            .await
            .expect("set encryption policy");
        let runtime = wait_for_client_settings(&application, |runtime| {
            runtime.configured == required
                && runtime.effective_encryption == EncryptionPolicy::Required
                && runtime.encryption_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(runtime.effective_encryption, EncryptionPolicy::Required);
        assert_eq!(
            policy.load(),
            rstorrent_engine::PeerEncryptionPolicy::Required
        );
        assert_eq!(
            application
                .incoming_peer_snapshot()
                .expect("retained listener snapshot")
                .listen_address,
            before
        );

        application.shutdown().await.expect("joined shutdown");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn application_coordinates_local_network_endpoints_when_available() {
        let Some(local_address) = local_network_ipv4().await else {
            return;
        };
        let Some(preferred_port) = available_port_on(local_address).await else {
            return;
        };
        let root = test_root("coordinated-local-network-sockets");
        let router = UdpSocket::bind((local_address, 0))
            .await
            .expect("bind local-network DHT router");
        let router_address = router.local_addr().expect("DHT router address");
        let network = NetworkConfig::new(
            NetworkPolicy::Online,
            std::time::Duration::from_secs(5),
            std::time::Duration::from_secs(5),
        );
        let mut configuration = ApplicationConfig::new(
            root.join("profile"),
            "test".to_owned(),
            vec![ConfiguredStorageRoot::path(
                "downloads",
                root.join("payload"),
            )],
            network,
        );
        configuration.dht.bootstrap_nodes = vec![BootstrapNode::Address(router_address)];
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLocalNetwork,
                preferred_listen_port: preferred_port,
                ..ClientSettings::default()
            },
        );
        let mut application = ApplicationService::open(configuration)
            .await
            .expect("open local-network application");
        let runtime = client_settings_runtime(&application).await;
        let ListenerStatus::Listening { address, port } = runtime.listener_status else {
            panic!("local-network TCP listener must be active");
        };
        let crate::SessionUdpStatus::Bound {
            address: udp_address,
            port: udp_port,
            coordinated_with_tcp,
        } = runtime.session_udp_status
        else {
            panic!("local-network session UDP endpoint must be active");
        };
        assert_eq!(address, local_address.to_string());
        assert_eq!(udp_address, Ipv4Addr::UNSPECIFIED.to_string());
        // Automatic binding may advance if the probed port is claimed before
        // the application opens its sockets; the live endpoints must still pair.
        assert_eq!(udp_port, port);
        assert!(coordinated_with_tcp);

        let observed_dht_source = answer_dht_query(&router).await;
        assert_eq!(
            observed_dht_source,
            SocketAddr::from((local_address, udp_port))
        );
        let tcp = TcpStream::connect((local_address, port))
            .await
            .expect("connect local-network TCP endpoint");
        drop(tcp);
        application.shutdown().await.expect("joined shutdown");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn application_shutdown_persists_and_revalidates_warm_dht_node() {
        let root = test_root("dht-warm-restart");
        let router = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind DHT router");
        let router_address = router.local_addr().expect("DHT router address");
        let mut first_config = config(&root);
        first_config.dht.bootstrap_nodes = vec![BootstrapNode::Address(router_address)];
        let mut first = ApplicationService::open(first_config)
            .await
            .expect("open first application");
        answer_dht_query(&router).await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        first.shutdown().await.expect("first shutdown");
        drop(first);

        let mut persisted = config(&root);
        persisted.dht.bootstrap_nodes.clear();
        let store = SessionStore::open(
            persisted
                .durable_profile_root()
                .expect("durable profile root"),
            &persisted.profile_id,
            &persisted.storage_roots,
        )
        .expect("open persisted store");
        let snapshot = store
            .load_dht_snapshot()
            .expect("load DHT snapshot")
            .expect("saved DHT snapshot");
        assert_eq!(snapshot.nodes_v4[0].address, dht_endpoint(router_address));
        drop(store);

        let mut second = ApplicationService::open(persisted)
            .await
            .expect("open second application");
        answer_dht_query(&router).await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        second.shutdown().await.expect("second shutdown");
        drop(second);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn application_shutdown_joins_terminal_dht_view_forwarding() {
        let root = test_root("dht-terminal-view");
        let mut application = ApplicationService::open(config(&root))
            .await
            .expect("open application");
        let subscription = application
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::SessionDht,
                projection: ViewProjection::Dht,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe to DHT view");
        subscription
            .next_update()
            .await
            .expect("initial DHT snapshot");

        application.shutdown().await.expect("shutdown application");

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let update = subscription
                    .next_update()
                    .await
                    .expect("terminal DHT update");
                if let ViewUpdatePayload::Patch {
                    patch: ViewPatch::SessionDht { inspection },
                } = update.payload
                    && inspection.lifecycle == DhtLifecycleView::Inactive
                {
                    assert_eq!(inspection.active_transactions, 0);
                    assert_eq!(inspection.active_lookups, 0);
                    assert!(inspection.lookups.is_empty());
                    break;
                }
            }
        })
        .await
        .expect("terminal DHT view timed out");
        drop(application);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn command_mutation_publishes_a_typed_view_patch() {
        let root = test_root("view-patch");
        let info_hash = "000102030405060708090a0b0c0d0e0f10111213";
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open service");
        let subscription = service
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
            .expect("subscribe");
        assert!(matches!(
            subscription.next_update().await.expect("initial").payload,
            ViewUpdatePayload::Snapshot { .. }
        ));

        let response = service
            .dispatch(add_request("add", info_hash))
            .await
            .expect("add");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("view-patch add result"),
        };
        let update = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            subscription.next_update(),
        )
        .await
        .expect("view update timed out")
        .expect("view update");
        let base_revision = update
            .base_revision
            .parse::<u64>()
            .expect("numeric patch base revision");
        let revision = update
            .revision
            .parse::<u64>()
            .expect("numeric patch revision");
        assert!(base_revision <= revision);
        let ViewUpdatePayload::Patch { patch } = update.payload else {
            panic!("mutation must publish a patch");
        };
        assert!(
            serde_json::to_string(&patch)
                .expect("serialize patch")
                .contains(&torrent_id)
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn client_settings_mutation_publishes_configured_and_applying_state() {
        let root = test_root("client-settings-view-patch");
        let initial_settings = ClientSettings {
            ipv6_enabled: false,
            ..ClientSettings::default()
        };
        let mut configuration = config(&root);
        configuration.initial_client_settings = initial_settings.clone();
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        let subscription = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 4096,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("subscribe");
        let initial = subscription.next_update().await.expect("initial");
        let ViewUpdatePayload::Snapshot {
            snapshot:
                ViewSnapshot::TorrentList {
                    client_settings: initial,
                    ..
                },
        } = initial.payload
        else {
            panic!("expected settings snapshot");
        };
        assert_eq!(
            initial.transport_application,
            crate::ClientSettingsApplicationState::Applied
        );

        let configured = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            preferred_listen_port: 6_881,
            port_mapping: crate::PortMappingPolicy::Disabled,
            peer_connection_limit: 321,
            upload_slots: 3,
            active_downloads: 3,
            upload_rate_limit: Default::default(),
            download_rate_limit: Default::default(),
            encryption: Default::default(),
            ipv6_enabled: true,
            tracker_https_server_authentication: Default::default(),
            ..ClientSettings::default()
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "set-client-settings-view".to_owned(),
                expected_revision: Some("0".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: configured.clone().into(),
                },
            })
            .await
            .expect("set settings");
        let update = subscription.next_update().await.expect("settings patch");
        let ViewUpdatePayload::Patch {
            patch:
                ViewPatch::TorrentList {
                    client_settings: Some(runtime),
                    ..
                },
        } = update.payload
        else {
            panic!("expected settings replacement patch");
        };
        assert_eq!(runtime.configured, configured);
        assert_eq!(
            runtime.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(
                &initial_settings
            ))
        );
        assert_eq!(
            runtime.transport_application,
            crate::ClientSettingsApplicationState::Applying
        );

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "revert-client-settings-view".to_owned(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: initial_settings.clone().into(),
                },
            })
            .await
            .expect("revert settings to active values");
        let update = subscription.next_update().await.expect("revert patch");
        let ViewUpdatePayload::Patch {
            patch:
                ViewPatch::TorrentList {
                    client_settings: Some(runtime),
                    ..
                },
        } = update.payload
        else {
            panic!("expected reverted settings replacement patch");
        };
        assert_eq!(runtime.configured, initial_settings);
        assert_eq!(
            runtime.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(
                &initial_settings
            ))
        );
        assert_eq!(
            runtime.transport_application,
            crate::ClientSettingsApplicationState::Applying
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    async fn wait_for_torrent_state(
        service: &mut ApplicationService,
        torrent_id: &str,
        expected: TorrentState,
        label: &str,
    ) {
        tokio::time::timeout(Duration::from_secs(5), async {
            for sequence in 0_u64.. {
                let response = service
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("{label}-snapshot-{sequence}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await
                    .expect("poll torrent state");
                let ResponseOutcome::Success { snapshot } = response.outcome else {
                    panic!("state poll must succeed");
                };
                let torrent = snapshot
                    .torrents
                    .iter()
                    .find(|torrent| torrent.torrent_id == torrent_id)
                    .expect("polled torrent");
                if torrent.state == expected {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("torrent {torrent_id} did not reach {expected:?}"));
    }

    #[tokio::test]
    async fn media_capability_reads_verified_direct_file_and_force_recheck_revokes_it() {
        let root = test_root("media-capability");
        let configuration = config(&root);
        let payload = b"verified media bytes";
        let raw_info = single_file_info("media.bin", payload, 7);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-media", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record media metadata");
        store
            .record_pieces(&torrent_id, &[0, 1, 2])
            .expect("record verified media pieces");
        store
            .mark_complete(&torrent_id)
            .expect("mark media complete");
        drop(store);
        fs::create_dir_all(root.join("payload")).expect("create payload root");
        fs::write(root.join("payload/media.bin"), payload).expect("write direct media file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open media application");
        service
            .configure_media_origin("http://127.0.0.1:43121")
            .expect("configure media origin");
        let owner = ViewSetOwner::trusted("media-test");
        let first = service
            .application_call(
                &owner,
                ApplicationCall::CreateMediaUrl {
                    torrent_id: torrent_id.clone(),
                    file_index: 0,
                },
            )
            .await
            .expect("create media URL");
        let ApplicationCallResult::MediaUrl { response } = first else {
            panic!("wrong media result")
        };
        let MediaUrlOutcome::Created { url, .. } = response.outcome else {
            panic!("verified direct file was unavailable")
        };
        let capability = url.rsplit('/').next().expect("capability path").to_owned();
        let mut lease = service
            .resolve_media_capability(&capability)
            .expect("resolve media capability");
        assert!(lease.is_live());
        assert_eq!(
            lease.read_range(9, 5).await.expect("read media range"),
            b"media"
        );
        drop(lease);

        let repeated = service
            .create_media_url(&torrent_id, 0)
            .await
            .expect("repeat media URL");
        let MediaUrlOutcome::Created {
            url: repeated_url, ..
        } = repeated.outcome
        else {
            panic!("repeated capability was unavailable")
        };
        assert_eq!(repeated_url, url);

        let active_leases = (0..4)
            .map(|_| {
                service
                    .resolve_media_capability(&capability)
                    .expect("admit bounded media request")
            })
            .collect::<Vec<_>>();
        assert!(matches!(
            service.resolve_media_capability(&capability),
            Err(MediaResolveError::Busy)
        ));

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "recheck-media".to_owned(),
                expected_revision: None,
                command: Command::ForceRecheck {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("force media recheck");
        assert!(matches!(
            service.resolve_media_capability(&capability),
            Err(MediaResolveError::NotFound)
        ));
        assert!(
            active_leases
                .iter()
                .all(|lease| lease.cancellation().is_cancelled())
        );
        drop(active_leases);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn active_media_waits_for_verified_range_and_pause_revokes_it() {
        let root = test_root("active-media-capability");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 19 + offset / 7) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("active-media.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind active media peer");
        let address = listener.local_addr().expect("active media address");
        let release_first = Arc::new(tokio::sync::Notify::new());
        let peer_release = Arc::clone(&release_first);
        let peer_payload = payload.clone();
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept active media peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read active media handshake");
            decode_handshake(&handshake, info_hash).expect("active media identity");
            stream
                .write_all(&encode_handshake(info_hash, [0x4d; 20]))
                .await
                .expect("write active media handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).expect("bitfield"))
                .await
                .expect("write active media bitfield");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).expect("unchoke"))
                .await
                .expect("write active media unchoke");
            let mut decoder = FrameDecoder::new();
            let mut input = [0_u8; 64 * 1024];
            let mut pending = Vec::<BlockRequest>::new();
            let mut released = false;
            loop {
                tokio::select! {
                    _ = peer_release.notified(), if !released => {
                        released = true;
                        for request in pending.drain(..) {
                            let start = request.begin as usize;
                            let end = start + request.length as usize;
                            stream.write_all(&encode_message(&PeerMessage::Piece {
                                index: 0,
                                begin: request.begin,
                                block: peer_payload[start..end].to_vec(),
                            }).expect("piece response")).await.expect("write active media piece");
                        }
                    }
                    read = stream.read(&mut input) => {
                        let read = read.expect("read active media message");
                        if read == 0 {
                            break;
                        }
                        for message in decoder.push(&input[..read]).expect("decode active media message") {
                            if let PeerMessage::Request(request) = message
                                && request.index == 0
                            {
                                if released {
                                    let start = request.begin as usize;
                                    let end = start + request.length as usize;
                                    stream.write_all(&encode_message(&PeerMessage::Piece {
                                        index: 0,
                                        begin: request.begin,
                                        block: peer_payload[start..end].to_vec(),
                                    }).expect("piece response")).await.expect("write active media piece");
                                } else {
                                    pending.push(request);
                                }
                            }
                        }
                    }
                }
            }
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open active media store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-active-media".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add active media torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("active media add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record active media metadata");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open active media application");
        service
            .configure_media_origin("http://127.0.0.1:43121")
            .expect("configure active media origin");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let url = loop {
            let response = service
                .create_media_url(&torrent_id, 0)
                .await
                .expect("probe active media URL");
            if let MediaUrlOutcome::Created { url, .. } = response.outcome {
                break url;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "active media did not become streamable"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        let capability = url
            .rsplit('/')
            .next()
            .expect("active capability")
            .to_owned();
        let mut first = service
            .resolve_media_capability(&capability)
            .expect("resolve active capability");
        let first_task = tokio::spawn(async move {
            first
                .wait_for_range(0, 8)
                .await
                .expect("wait for first active range");
            first
                .read_range(0, 8)
                .await
                .expect("read first active range")
        });
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!first_task.is_finished());
        release_first.notify_one();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), first_task)
                .await
                .expect("first active range timed out")
                .expect("join first active range"),
            payload[..8]
        );

        let mut second = service
            .resolve_media_capability(&capability)
            .expect("resolve second active capability");
        let second_task = tokio::spawn(async move { second.wait_for_range(16_384, 8).await });
        tokio::time::sleep(Duration::from_millis(25)).await;
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-active-media".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause active media");
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(2), second_task)
                .await
                .expect("revoked active range timed out")
                .expect("join revoked active range"),
            Err(MediaRangeError::Revoked)
        ));
        tokio::time::timeout(Duration::from_secs(2), peer_task)
            .await
            .expect("active media peer did not close")
            .expect("join active media peer");
        service.shutdown().await.expect("shutdown active media");
        drop(service);
        fs::remove_dir_all(root).expect("remove active media root");
    }

    #[tokio::test]
    async fn active_media_capability_hands_off_to_verified_direct_file() {
        let root = test_root("active-media-direct-handoff");
        let configuration = config(&root);
        let payload = (0..16_384)
            .map(|offset| ((offset * 23 + offset / 11) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("handoff.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind handoff peer");
        let address = listener.local_addr().expect("handoff peer address");
        let release = Arc::new(tokio::sync::Notify::new());
        let peer_release = Arc::clone(&release);
        let peer_payload = payload.clone();
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept handoff peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read handoff handshake");
            decode_handshake(&handshake, info_hash).expect("handoff peer identity");
            stream
                .write_all(&encode_handshake(info_hash, [0x5e; 20]))
                .await
                .expect("write handoff handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0x80])).expect("bitfield"))
                .await
                .expect("write handoff bitfield");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).expect("unchoke"))
                .await
                .expect("write handoff unchoke");
            let mut decoder = FrameDecoder::new();
            let mut input = [0_u8; 64 * 1024];
            let mut pending = Vec::<BlockRequest>::new();
            let mut released = false;
            loop {
                tokio::select! {
                    _ = peer_release.notified(), if !released => {
                        released = true;
                        for request in pending.drain(..) {
                            let start = request.begin as usize;
                            let end = start + request.length as usize;
                            stream.write_all(&encode_message(&PeerMessage::Piece {
                                index: 0,
                                begin: request.begin,
                                block: peer_payload[start..end].to_vec(),
                            }).expect("handoff piece response")).await.expect("write handoff piece");
                        }
                    }
                    read = stream.read(&mut input) => {
                        let read = read.expect("read handoff message");
                        if read == 0 {
                            break;
                        }
                        for message in decoder.push(&input[..read]).expect("decode handoff message") {
                            if let PeerMessage::Request(request) = message {
                                if released {
                                    let start = request.begin as usize;
                                    let end = start + request.length as usize;
                                    stream.write_all(&encode_message(&PeerMessage::Piece {
                                        index: 0,
                                        begin: request.begin,
                                        block: peer_payload[start..end].to_vec(),
                                    }).expect("handoff piece response")).await.expect("write handoff piece");
                                } else {
                                    pending.push(request);
                                }
                            }
                        }
                    }
                }
            }
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open handoff store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-media-handoff".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add handoff torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("media handoff add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record handoff metadata");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open handoff application");
        service
            .configure_media_origin("http://127.0.0.1:43121")
            .expect("configure handoff media origin");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let url = loop {
            let response = service
                .create_media_url(&torrent_id, 0)
                .await
                .expect("probe handoff media URL");
            if let MediaUrlOutcome::Created { url, .. } = response.outcome {
                break url;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "handoff media did not become streamable"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        let capability = url
            .rsplit('/')
            .next()
            .expect("handoff capability")
            .to_owned();
        let mut active = service
            .resolve_media_capability(&capability)
            .expect("resolve active handoff capability");
        let active_task = tokio::spawn(async move {
            active
                .wait_for_range(0, 64)
                .await
                .expect("wait for handoff range");
            tokio::time::sleep(Duration::from_millis(50)).await;
            active
                .read_range(0, 64)
                .await
                .expect("read active handoff range")
        });
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!active_task.is_finished());
        let waiting_resources = service.media_resource_snapshot();
        assert_eq!(waiting_resources.active_bodies, 1);
        assert_eq!(waiting_resources.active_streaming_leases, 1);
        assert_eq!(waiting_resources.streaming_lease_high_water, 1);
        release.notify_one();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), active_task)
                .await
                .expect("active handoff range timed out")
                .expect("join active handoff range"),
            payload[..64]
        );

        let completion_deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while service
            .active_download_for(&torrent_id)
            .is_some_and(|active| !active.task.is_finished())
        {
            assert!(
                tokio::time::Instant::now() < completion_deadline,
                "handoff torrent did not complete"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        service
            .reap_finished()
            .await
            .expect("reap handoff download");
        let mut verified = service
            .resolve_media_capability(&capability)
            .expect("resolve verified handoff capability");
        assert!(verified.is_active());
        verified
            .wait_for_range(100, 64)
            .await
            .expect("handoff to verified reader");
        assert!(!verified.is_active());
        assert_eq!(
            verified
                .read_range(100, 64)
                .await
                .expect("read verified handoff range"),
            payload[100..164]
        );
        verified.touch_served(64);
        let completed_resources = service.media_resource_snapshot();
        assert_eq!(completed_resources.body_high_water, 1);
        assert_eq!(completed_resources.active_streaming_leases, 0);
        assert_eq!(completed_resources.active_streaming_reads, 0);
        assert_eq!(completed_resources.streaming_read_high_water, 0);
        assert_eq!(completed_resources.demanded_bytes_read, 128);
        assert_eq!(completed_resources.demanded_bytes_served, 64);
        assert_eq!(completed_resources.verified_handoffs, 2);
        drop(verified);
        assert_eq!(service.media_resource_snapshot().active_bodies, 0);
        tokio::time::timeout(Duration::from_secs(2), peer_task)
            .await
            .expect("handoff peer did not close")
            .expect("join handoff peer");
        service.shutdown().await.expect("shutdown handoff service");
        drop(service);
        fs::remove_dir_all(root).expect("remove handoff root");
    }

    #[tokio::test]
    async fn unowned_existing_direct_file_is_checked() {
        let root = test_root("existing-direct-file-check");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 23 + offset / 17) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("existing.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-existing", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record existing metadata");
        drop(store);
        let output = root.join("payload/existing.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload).expect("write existing direct file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open application with existing direct file");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "existing-direct-file-check",
        )
        .await;
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("load adopted resume");
        assert_eq!(resume.storage_state, StorageState::Available);
        assert_eq!(resume.have.expect("adopted have").pieces(), &[true, true]);
        assert_eq!(resume.verification.requested(), 1);
        assert_eq!(resume.verification.completed(), 1);
        assert_eq!(fs::read(&output).expect("read adopted output"), payload);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn complete_startup_and_force_recheck_rebuild_have_without_network() {
        let root = test_root("complete-force-recheck");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 31 + offset / 13) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("complete.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-complete-recheck", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record complete metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record old complete have");
        store.mark_complete(&torrent_id).expect("mark complete");
        drop(store);
        let output = root.join("payload/complete.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload).expect("write complete direct file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open complete application");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "startup-recheck",
        )
        .await;
        assert_eq!(
            service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("startup result")
                .have
                .expect("startup have")
                .pieces(),
            &[true, true]
        );
        let startup_verification = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("startup verification")
            .verification;
        assert_eq!(startup_verification.requested(), 0);
        assert_eq!(startup_verification.completed(), 0);

        let force = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "force-complete-recheck".to_owned(),
            expected_revision: None,
            command: Command::ForceRecheck {
                torrent_id: torrent_id.clone(),
            },
        };
        service
            .dispatch(force.clone())
            .await
            .expect("force recheck");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "forced-recheck",
        )
        .await;
        let revision = service
            .store_mut()
            .expect("store")
            .revision()
            .expect("completed revision");
        service.dispatch(force).await.expect("replay force recheck");
        assert_eq!(
            service
                .store_mut()
                .expect("store")
                .revision()
                .expect("replayed revision"),
            revision,
            "replaying one request must not start another generation"
        );
        assert_eq!(fs::read(&output).expect("read rechecked output"), payload);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn restarted_pending_recheck_repairs_a_corrupt_piece_from_the_saved_peer_hint() {
        let root = test_root("pending-recheck-repair");
        let configuration = config(&root);
        let piece_length = 16_384;
        let payload = (0..(2 * piece_length))
            .map(|offset| ((offset * 31 + offset / 13) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("repair.bin", &payload, piece_length);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind recheck repair peer");
        let address = listener.local_addr().expect("recheck repair peer address");
        let peer_payload = payload.clone();
        let (request_started_sender, request_started_receiver) = tokio::sync::oneshot::channel();
        let (payload_release_sender, payload_release_receiver) = tokio::sync::oneshot::channel();
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept repair peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read repair handshake");
            decode_handshake(&handshake, info_hash).expect("repair handshake identity");
            stream
                .write_all(&encode_handshake(info_hash, *b"-RS-RECHECK-REPAIR-0"))
                .await
                .expect("write repair handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).expect("bitfield"))
                .await
                .expect("write repair bitfield");
            stream
                .write_all(&encode_message(&PeerMessage::Unchoke).expect("unchoke"))
                .await
                .expect("write repair unchoke");
            let mut decoder = FrameDecoder::new();
            let mut pending = std::collections::VecDeque::new();
            let mut uploaded = 0_usize;
            let mut request_started_sender = Some(request_started_sender);
            let mut payload_release_receiver = Some(payload_release_receiver);
            while uploaded < piece_length {
                match read_peer_message(&mut stream, &mut decoder, &mut pending).await {
                    PeerMessage::Interested | PeerMessage::KeepAlive | PeerMessage::Bitfield(_) => {
                    }
                    PeerMessage::Request(request) => {
                        assert_eq!(request.index, 1, "only the corrupt piece is reacquired");
                        if let Some(sender) = request_started_sender.take() {
                            sender.send(()).expect("report repair request");
                        }
                        if let Some(receiver) = payload_release_receiver.take() {
                            receiver.await.expect("release repair payload");
                        }
                        let begin = usize::try_from(request.begin).expect("request begin");
                        let length = usize::try_from(request.length).expect("request length");
                        let start = piece_length.checked_add(begin).expect("payload start");
                        let end = start.checked_add(length).expect("payload end");
                        stream
                            .write_all(
                                &encode_message(&PeerMessage::Piece {
                                    index: request.index,
                                    begin: request.begin,
                                    block: peer_payload[start..end].to_vec(),
                                })
                                .expect("piece response"),
                            )
                            .await
                            .expect("write repair piece");
                        uploaded += length;
                    }
                    message => panic!("unexpected repair peer message: {message:?}"),
                }
            }
            uploaded
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-pending-recheck-repair".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add repair torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("repair add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record repair metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record stale complete have");
        store.mark_complete(&torrent_id).expect("mark complete");
        store
            .begin_recheck(&torrent_id)
            .expect("begin pending recheck");
        drop(store);

        let output = root.join("payload/repair.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        let mut corrupt = payload.clone();
        corrupt[piece_length] ^= 0xff;
        fs::write(&output, &corrupt).expect("write corrupt direct payload");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("restart pending recheck");
        tokio::time::timeout(Duration::from_secs(5), request_started_receiver)
            .await
            .expect("repair request did not start")
            .expect("repair request sender dropped");
        let repair = service
            .load_resume_conservative(&torrent_id)
            .expect("load admitted repair");
        assert_eq!(repair.state, TorrentState::Downloading);
        assert!(repair.download_queue_position.is_some());
        service
            .reconcile_admission()
            .await
            .expect("reconcile active repair admission");
        assert!(service.active_download_for(&torrent_id).is_some());
        payload_release_sender
            .send(())
            .expect("release repair payload");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "pending-recheck-repair",
        )
        .await;
        assert_eq!(fs::read(&output).expect("read repaired payload"), payload);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), peer_task)
                .await
                .expect("repair peer timed out")
                .expect("repair peer task"),
            piece_length
        );
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("repaired resume");
        assert_eq!(resume.verification.requested(), 1);
        assert_eq!(resume.verification.completed(), 1);
        assert_eq!(resume.have.expect("repaired have").pieces(), &[true, true]);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn complete_startup_structural_mismatch_runs_only_its_full_checker() {
        let root = test_root("complete-fast-resume-mismatch");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 17 + offset / 7) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("mismatch.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-complete-mismatch", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record complete metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record old complete have");
        store.mark_complete(&torrent_id).expect("mark complete");
        drop(store);
        let output = root.join("payload/mismatch.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload[..payload.len() - 1]).expect("write short direct file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open mismatched application");
        for sequence in 0..200 {
            let _ = service
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: format!("reap-mismatch-{sequence}"),
                    expected_revision: None,
                    command: Command::Snapshot,
                })
                .await
                .expect("reap mismatch checker");
            let resume = service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("mismatch resume");
            if resume.verification.completed() == 1 {
                assert_eq!(resume.verification.requested(), 1);
                assert_eq!(resume.have.expect("checked have").pieces(), &[false, false]);
                break;
            }
            tokio::task::yield_now().await;
            if sequence == 199 {
                panic!("mismatched complete torrent did not finish its checker");
            }
        }

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn startup_restarts_interrupted_check_even_with_paused_intent() {
        let root = test_root("paused-interrupted-recheck");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 23 + offset / 11) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("paused-check.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-paused-check", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record old have");
        store.mark_complete(&torrent_id).expect("mark complete");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-interrupted-check".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("persist paused intent");
        store
            .begin_recheck(&torrent_id)
            .expect("begin interrupted check");
        drop(store);
        let output = root.join("payload/paused-check.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload).expect("write direct payload");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("restart application");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Paused,
            "paused-interrupted-check",
        )
        .await;
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("completed resume");
        assert!(!resume.desired_running);
        assert_eq!(
            resume.have.expect("replacement have").pieces(),
            &[true, true]
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn archive_joins_a_running_checker_instead_of_parking_it() {
        let root = test_root("archive-running-checker");
        let mut configuration = config(&root);
        configuration.storage_hash_delay_for_testing = Duration::from_millis(150);
        configuration.storage_hash_concurrency_for_testing = 1;
        let piece_length = 16_384;
        let payload = (0..(8 * piece_length))
            .map(|offset| ((offset * 31 + offset / 13) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("archive-checker.bin", &payload, piece_length);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-archive-checker", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        store
            .record_pieces(&torrent_id, &(0..8).collect::<Vec<_>>())
            .expect("record old have");
        store.mark_complete(&torrent_id).expect("mark complete");
        store.begin_recheck(&torrent_id).expect("begin recheck");
        drop(store);
        let output = root.join("payload/archive-checker.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload).expect("write direct payload");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open checking application");
        tokio::time::timeout(Duration::from_secs(2), async {
            while !service.active_download().is_some_and(|active| {
                active
                    .1
                    .control
                    .checker_snapshot()
                    .is_some_and(|progress| progress.active_hash_jobs == 1)
            }) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("checker hash did not start");

        let dispatch = |request_id: &str, command: Command| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command,
        };
        service
            .dispatch(dispatch(
                "archive-running-checker",
                Command::Archive {
                    torrent_id: torrent_id.clone(),
                },
            ))
            .await
            .expect("archive checker");
        // The checker is joined, not parked, so it cannot hold the
        // verification slot while the torrent stays archived.
        assert!(service.active_download().is_none());
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("archived resume");
        assert!(!resume.desired_running);
        assert!(resume.verification.is_pending());

        service
            .dispatch(dispatch(
                "restore-checker",
                Command::RestoreArchive {
                    torrent_id: torrent_id.clone(),
                },
            ))
            .await
            .expect("restore checker");
        service
            .dispatch(dispatch(
                "resume-checker",
                Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            ))
            .await
            .expect("resume checker");
        tokio::time::timeout(Duration::from_secs(2), async {
            while service.active_download().is_none() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("pending verification did not restart after restore");

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pause_and_resume_retain_the_active_checker_generation_and_cursor() {
        let root = test_root("pause-running-checker");
        let mut configuration = config(&root);
        configuration.storage_hash_delay_for_testing = Duration::from_millis(150);
        configuration.storage_hash_concurrency_for_testing = 1;
        let piece_length = 16_384;
        let payload = (0..(8 * piece_length))
            .map(|offset| ((offset * 31 + offset / 13) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("pause-checker.bin", &payload, piece_length);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-pause-checker", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        store
            .record_pieces(&torrent_id, &(0..8).collect::<Vec<_>>())
            .expect("record old have");
        store.mark_complete(&torrent_id).expect("mark complete");
        store.begin_recheck(&torrent_id).expect("begin recheck");
        drop(store);
        let output = root.join("payload/pause-checker.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        fs::write(&output, &payload).expect("write direct payload");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open checking application");
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let active = service
                    .active_download()
                    .expect("checker remains active while waiting");
                if active
                    .1
                    .control
                    .checker_snapshot()
                    .is_some_and(|progress| progress.active_hash_jobs == 1)
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("checker hash did not start");
        let control = service
            .active_download()
            .expect("active checker")
            .1
            .control
            .clone();
        let generation = control
            .checker_snapshot()
            .expect("checker progress")
            .generation;

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-running-checker".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause checker");
        tokio::time::timeout(Duration::from_secs(2), async {
            while control
                .checker_snapshot()
                .is_none_or(|progress| progress.phase != CheckerPhase::Paused)
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("checker did not drain into paused phase");
        let paused = control.checker_snapshot().expect("paused checker");
        assert_eq!(paused.generation, generation);
        assert_eq!(paused.pieces_processed, 1);
        assert_eq!(paused.active_hash_jobs, 0);
        assert!(service.active_download().is_some());
        assert!(
            !service
                .active_download()
                .expect("retained task")
                .1
                .task
                .is_finished()
        );
        assert!(
            !service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("paused resume")
                .desired_running
        );

        let download_request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "download-file-resume-running-checker".to_owned(),
            expected_revision: None,
            command: Command::DownloadFiles {
                torrent_id: torrent_id.clone(),
                file_indices: vec![0],
            },
        };
        let download_response = service
            .dispatch(download_request.clone())
            .await
            .expect("resume checker");
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                service.reap_finished().await.expect("reap checker");
                if service.active_download().is_none() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("resumed checker did not finish");
        assert!(control.checker_snapshot().is_none());
        assert_eq!(control.snapshot().storage_hash_operations_started, 8);
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("completed resume");
        assert!(resume.desired_running);
        assert_eq!(resume.have.expect("replacement have").pieces(), &[true; 8]);

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-after-download-file".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause after completed checker");
        assert_eq!(
            service
                .dispatch(download_request)
                .await
                .expect("replay download request"),
            download_response
        );
        assert!(service.active_download().is_none());
        assert!(
            !service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("resume after replay")
                .desired_running
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn paused_force_recheck_clears_corruption_without_starting_repair() {
        let root = test_root("paused-force-recheck");
        let configuration = config(&root);
        let payload = (0..32_768)
            .map(|offset| ((offset * 17 + offset / 7) & 0xff) as u8)
            .collect::<Vec<_>>();
        let raw_info = single_file_info("paused.bin", &payload, 16_384);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-paused-recheck", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record paused metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record stale complete have");
        store.mark_complete(&torrent_id).expect("mark complete");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-before-force".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("persist paused intent");
        drop(store);
        let output = root.join("payload/paused.bin");
        fs::create_dir_all(output.parent().expect("payload parent")).expect("create payload root");
        let mut corrupt = payload.clone();
        corrupt[16_384] ^= 0xff;
        fs::write(&output, &corrupt).expect("write corrupt direct file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open paused application");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "force-paused-recheck".to_owned(),
                expected_revision: None,
                command: Command::ForceRecheck {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("force paused recheck");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Paused,
            "paused-recheck",
        )
        .await;
        assert_eq!(
            service
                .store_mut()
                .expect("store")
                .load_resume(&torrent_id)
                .expect("paused result")
                .have
                .expect("paused have")
                .pieces(),
            &[true, false]
        );
        assert_eq!(
            fs::read(&output).expect("read unrepaired direct file"),
            corrupt,
            "paused intent must not admit repair writes"
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pause_is_durable_and_prevents_restart() {
        let root = test_root("pause");
        let info_hash = "000102030405060708090a0b0c0d0e0f10111213";
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open service");
        let response = service
            .dispatch(add_request("add", info_hash))
            .await
            .expect("add");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("pause add result"),
        };
        let paused = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause");
        let ResponseOutcome::Success { snapshot } = paused.outcome else {
            panic!("pause should succeed");
        };
        assert_eq!(snapshot.torrents[0].state, TorrentState::Paused);
        service.shutdown().await.expect("shutdown");
        drop(service);

        let mut reopened = ApplicationService::open(config(&root))
            .await
            .expect("reopen service");
        let snapshot = reopened
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "snapshot".to_owned(),
                expected_revision: None,
                command: Command::Snapshot,
            })
            .await
            .expect("snapshot");
        let ResponseOutcome::Success { snapshot } = snapshot.outcome else {
            panic!("snapshot should succeed");
        };
        assert_eq!(snapshot.torrents[0].state, TorrentState::Paused);
        reopened.shutdown().await.expect("shutdown reopened");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn pause_joins_content_peer_before_view_set_removal() {
        let root = test_root("pause-peer-cleanup");
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        );
        let payload = b"view";
        let mut raw_info =
            b"d5:filesld6:lengthi4e4:pathl4:testeee4:name4:root12:piece lengthi4e6:pieces20:"
                .to_vec();
        raw_info.extend_from_slice(&Sha1::digest(payload));
        raw_info.push(b'e');
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind paused content peer");
        let address = listener.local_addr().expect("content peer address");
        let (closed_sender, mut closed_receiver) = tokio::sync::mpsc::unbounded_channel();
        let peer_task = tokio::spawn(async move {
            for generation in 0..4 {
                let (mut stream, _) = listener.accept().await.expect("accept content peer");
                let mut handshake = [0; HANDSHAKE_LENGTH];
                stream
                    .read_exact(&mut handshake)
                    .await
                    .expect("read content handshake");
                decode_handshake(&handshake, info_hash).expect("content handshake identity");
                stream
                    .write_all(&encode_handshake(info_hash, *b"-RS-APP-PAUSE-000000"))
                    .await
                    .expect("send content handshake");
                stream
                    .write_all(
                        &encode_message(&PeerMessage::Bitfield(vec![0x80])).expect("bitfield"),
                    )
                    .await
                    .expect("send content bitfield");
                let mut buffer = [0; 128];
                loop {
                    if stream
                        .read(&mut buffer)
                        .await
                        .expect("wait for lifecycle fence")
                        == 0
                    {
                        break;
                    }
                }
                closed_sender
                    .send(generation)
                    .expect("report closed content generation");
            }
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-paused-content".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add content torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("content add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record content metadata");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open content service");
        wait_for_active_route(&service, 1).await;
        let active_control = service
            .active_download()
            .expect("active content generation")
            .1
            .control
            .clone();
        assert!(active_control.incoming_content_routable());
        let mut incoming_peer =
            connect_application_active(&service, info_hash, *b"-RS-ACTIVE-PAUSE-000").await;
        wait_for_incoming_established(&service, 1).await;
        let owner = ViewSetOwner::trusted("pause-peer-owner");
        let opened = service
            .open_view_set(
                owner.clone(),
                OpenViewSetRequest {
                    views: vec![
                        ViewSpec::TorrentPeers {
                            view_id: "peers".to_owned(),
                            torrent_id: torrent_id.clone(),
                            delivery: ViewDeliveryPolicy::default(),
                        },
                        ViewSpec::TorrentSummary {
                            view_id: "summary".to_owned(),
                            torrent_id: torrent_id.clone(),
                            delivery: ViewDeliveryPolicy::default(),
                        },
                    ],
                    options: OpenViewSetOptions::default(),
                },
            )
            .expect("open peer view set");
        let view_set = service
            .view_set(&owner, &opened.view_set_id)
            .expect("peer view set handle");
        let mut cursor = opened.initial.cursor.clone();
        let mut summary_torrent = opened
            .initial
            .updates
            .iter()
            .find_map(|update| match update {
                ViewSetUpdate::Snapshot {
                    snapshot: ViewSnapshot::Torrent { torrent, .. },
                    ..
                } => torrent.clone(),
                _ => None,
            })
            .expect("initial selected torrent");
        let mut active_peer = opened
            .initial
            .updates
            .iter()
            .find_map(|update| match update {
                ViewSetUpdate::Snapshot {
                    snapshot: ViewSnapshot::Peers { peers, .. },
                    ..
                } => peers
                    .iter()
                    .find(|peer| peer.lifecycle == crate::PeerLifecycle::Connected)
                    .map(|peer| peer.connection_id.clone()),
                _ => None,
            });
        if active_peer.is_none() {
            active_peer = tokio::time::timeout(std::time::Duration::from_secs(1), async {
                loop {
                    let batch = view_set
                        .next_updates(&cursor, 1_000)
                        .await
                        .expect("connected peer update");
                    cursor = batch.cursor.clone();
                    if let Some(connection_id) =
                        batch.updates.iter().find_map(|update| match update {
                            ViewSetUpdate::Snapshot {
                                snapshot: ViewSnapshot::Peers { peers, .. },
                                ..
                            } => peers
                                .iter()
                                .find(|peer| peer.lifecycle == crate::PeerLifecycle::Connected)
                                .map(|peer| peer.connection_id.clone()),
                            ViewSetUpdate::Patch {
                                patch:
                                    ViewPatch::Peers {
                                        upsert, updates, ..
                                    },
                                ..
                            } => upsert
                                .iter()
                                .find(|peer| peer.lifecycle == crate::PeerLifecycle::Connected)
                                .map(|peer| peer.connection_id.clone())
                                .or_else(|| {
                                    updates.iter().find_map(|update| {
                                        update
                                            .fields
                                            .iter()
                                            .any(|field| {
                                                matches!(
                                                    field,
                                                    crate::PeerFieldUpdate::Lifecycle {
                                                        value: crate::PeerLifecycle::Connected
                                                    }
                                                )
                                            })
                                            .then(|| update.connection_id.clone())
                                    })
                                }),
                            _ => None,
                        })
                    {
                        break Some(connection_id);
                    }
                }
            })
            .await
            .expect("content peer never became visible");
        }
        let active_peer = active_peer.expect("connected content peer row");

        let paused = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-content".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause content torrent");
        let ResponseOutcome::Success { snapshot } = paused.outcome else {
            panic!("pause should succeed");
        };
        assert_eq!(snapshot.torrents[0].state, TorrentState::Paused);
        wait_for_incoming_close(&mut incoming_peer, "pause").await;
        assert!(!active_control.incoming_content_routable());
        let incoming_terminal = service
            .incoming_peer_snapshot()
            .expect("incoming listener remains active");
        assert_eq!(incoming_terminal.registrations, 0);
        assert_eq!(incoming_terminal.established, 0);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), closed_receiver.recv())
                .await
                .expect("content peer did not close before pause receipt"),
            Some(0)
        );

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            let mut removed = false;
            let mut summary_is_terminal = false;
            while !removed || !summary_is_terminal {
                let batch = view_set
                    .next_updates(&cursor, 1_000)
                    .await
                    .expect("terminal peer updates");
                cursor = batch.cursor.clone();
                for update in batch.updates {
                    match update {
                        ViewSetUpdate::Patch {
                            patch: ViewPatch::Peers { removed: ids, .. },
                            ..
                        } => removed |= ids.contains(&active_peer),
                        ViewSetUpdate::Patch {
                            patch:
                                ViewPatch::Torrent {
                                    change: crate::TorrentViewChange::Update { update },
                                },
                            ..
                        } => {
                            update
                                .apply(&mut summary_torrent)
                                .expect("selected torrent update");
                            summary_is_terminal |= summary_torrent.active_peer_connections == 0
                                && summary_torrent.payload_download_rate_bytes == "0";
                        }
                        ViewSetUpdate::Patch {
                            patch:
                                ViewPatch::Torrent {
                                    change:
                                        crate::TorrentViewChange::Replace {
                                            torrent: Some(torrent),
                                        },
                                },
                            ..
                        } => {
                            summary_torrent = torrent;
                            summary_is_terminal |= summary_torrent.active_peer_connections == 0
                                && summary_torrent.payload_download_rate_bytes == "0";
                        }
                        ViewSetUpdate::Snapshot {
                            snapshot:
                                ViewSnapshot::Torrent {
                                    torrent: Some(torrent),
                                },
                            ..
                        } => {
                            summary_is_terminal |= torrent.active_peer_connections == 0
                                && torrent.payload_download_rate_bytes == "0";
                        }
                        _ => {}
                    }
                }
            }
        })
        .await
        .expect("pause did not publish terminal peer views");

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "resume-content-lifecycle".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("resume active content");
        wait_for_active_route(&service, 1).await;
        let recheck_control = service
            .active_download()
            .expect("resumed content generation")
            .1
            .control
            .clone();
        assert!(recheck_control.incoming_content_routable());
        let mut recheck_peer =
            connect_application_active(&service, info_hash, *b"-RS-ACTIVE-RECHECK-0").await;
        wait_for_incoming_established(&service, 1).await;
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "force-recheck-active-content".to_owned(),
                expected_revision: None,
                command: Command::ForceRecheck {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("force recheck active content");
        wait_for_incoming_close(&mut recheck_peer, "force recheck").await;
        assert!(!recheck_control.incoming_content_routable());
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), closed_receiver.recv())
                .await
                .expect("rechecked content peer did not close"),
            Some(1)
        );

        wait_for_active_route(&service, 1).await;
        let archive_control = service
            .active_download()
            .expect("rechecked content generation")
            .1
            .control
            .clone();
        assert!(archive_control.incoming_content_routable());
        let mut archive_peer =
            connect_application_active(&service, info_hash, *b"-RS-ACTIVE-ARCHIVE-0").await;
        wait_for_incoming_established(&service, 1).await;
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "archive-active-content".to_owned(),
                expected_revision: None,
                command: Command::Archive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("archive active content");
        wait_for_incoming_close(&mut archive_peer, "archive").await;
        assert!(!archive_control.incoming_content_routable());
        wait_for_active_route(&service, 0).await;
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), closed_receiver.recv())
                .await
                .expect("archived content peer did not close"),
            Some(2)
        );

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "restore-active-content".to_owned(),
                expected_revision: None,
                command: Command::RestoreArchive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("restore active content");
        // Restore leaves the archived torrent paused until it is started again.
        wait_for_active_route(&service, 0).await;
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "resume-restored-content".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("resume restored content");
        wait_for_active_route(&service, 1).await;
        let removal_control = service
            .active_download()
            .expect("restored content generation")
            .1
            .control
            .clone();
        assert!(removal_control.incoming_content_routable());
        let mut removal_peer =
            connect_application_active(&service, info_hash, *b"-RS-ACTIVE-REMOVE-00").await;
        wait_for_incoming_established(&service, 1).await;
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-active-content".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::Keep,
                },
            })
            .await
            .expect("remove active content");
        wait_for_incoming_close(&mut removal_peer, "removal").await;
        assert!(!removal_control.incoming_content_routable());
        wait_for_active_route(&service, 0).await;
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), closed_receiver.recv())
                .await
                .expect("removed content peer did not close"),
            Some(3)
        );
        tokio::time::timeout(Duration::from_secs(1), peer_task)
            .await
            .expect("content lifecycle generations did not join")
            .expect("content lifecycle peer task");
        assert!(!service.torrent_runtimes.contains_key(&torrent_id));

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn download_files_restarts_all_skipped_running_intent() {
        let root = test_root("download-files-generation");
        let configuration = config(&root);
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind content peer");
        let address = listener.local_addr().expect("content peer address");
        let (accepted_sender, mut accepted_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (closed_sender, mut closed_receiver) = tokio::sync::mpsc::unbounded_channel();
        let peer_task = tokio::spawn(async move {
            for generation in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("accept content peer");
                let mut handshake = [0; HANDSHAKE_LENGTH];
                stream
                    .read_exact(&mut handshake)
                    .await
                    .expect("read content handshake");
                decode_handshake(&handshake, info_hash).expect("content handshake identity");
                stream
                    .write_all(&encode_handshake(info_hash, *b"-RS-FILE-PRIO-000000"))
                    .await
                    .expect("send content handshake");
                stream
                    .write_all(
                        &encode_message(&PeerMessage::Bitfield(vec![0xc0])).expect("bitfield"),
                    )
                    .await
                    .expect("send content bitfield");
                accepted_sender
                    .send(generation)
                    .expect("report accepted generation");
                let mut buffer = [0; 128];
                loop {
                    match stream.read(&mut buffer).await {
                        Ok(0) => break,
                        Ok(_) => {}
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::ConnectionReset
                                    | std::io::ErrorKind::BrokenPipe
                            ) =>
                        {
                            break;
                        }
                        Err(error) => panic!("wait for joined generation: {error}"),
                    }
                }
                closed_sender
                    .send(generation)
                    .expect("report closed generation");
            }
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-file-priority".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add content torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("file-priority add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record content metadata");
        let blocked_raw_info = single_file_info("blocked.bin", b"blocked", 7);
        let blocked_info_hash: [u8; 20] = Sha1::digest(&blocked_raw_info).into();
        let blocked_torrent_id = super::encode_info_hash(blocked_info_hash);
        let blocked_response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-blocked-download-file".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{blocked_torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add blocked content torrent");
        let blocked_torrent_id = match blocked_response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("blocked content add result"),
        };
        store
            .record_metadata(&blocked_torrent_id, &blocked_raw_info)
            .expect("record blocked content metadata");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "skip-blocked-download-file".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: blocked_torrent_id.clone(),
                    file_indices: vec![0],
                    priority: FilePriority::Skip,
                },
            })
            .expect("skip blocked content file");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open content service");
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), accepted_receiver.recv())
                .await
                .expect("first generation did not connect"),
            Some(0)
        );
        let revision_before_download = service
            .store_mut()
            .expect("access store before download command")
            .revision()
            .expect("load revision before download command");
        let blocked_before = service
            .load_resume_conservative(&blocked_torrent_id)
            .expect("load blocked torrent before command");
        let accepted = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-file-while-other-active".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: blocked_torrent_id.clone(),
                    file_indices: vec![0],
                },
            })
            .await
            .expect("accept queued download command");
        assert!(matches!(accepted.outcome, ResponseOutcome::Success { .. }));
        assert!(
            accepted.revision.parse::<u64>().expect("response revision") > revision_before_download
        );
        assert_eq!(
            service
                .store_mut()
                .expect("access store after busy command")
                .revision()
                .expect("load revision after busy command"),
            accepted.revision.parse::<u64>().expect("response revision")
        );
        let blocked_after = service
            .load_resume_conservative(&blocked_torrent_id)
            .expect("load blocked torrent after command");
        assert!(!blocked_before.desired_running);
        assert_eq!(blocked_before.skip_files, vec![0]);
        assert!(blocked_after.desired_running);
        assert!(blocked_after.skip_files.is_empty());
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "skip-every-file".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![0, 1],
                    priority: FilePriority::Skip,
                },
            })
            .await
            .expect("skip all files");
        let idle = service
            .load_resume_conservative(&torrent_id)
            .expect("load all-skipped state");
        assert!(idle.desired_running);
        assert_eq!(idle.state, TorrentState::Paused);
        assert_eq!(idle.skip_files, vec![0, 1]);
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), closed_receiver.recv())
                .await
                .expect("all-skipped generation did not become idle"),
            Some(0)
        );

        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-skipped-file".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                },
            })
            .await
            .expect("restore normal file");
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), accepted_receiver.recv())
                .await
                .expect("replacement generation did not connect"),
            Some(1)
        );
        let paths = torrent_storage_paths(
            &root.join("payload"),
            "multi",
            torrent_id.parse().expect("opaque owner"),
        )
        .expect("plan storage paths");
        assert!(!paths.part.exists());
        service.shutdown().await.expect("shutdown");
        tokio::time::timeout(std::time::Duration::from_secs(1), peer_task)
            .await
            .expect("peer generations did not join")
            .expect("peer task");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn live_file_priority_updates_do_not_replace_the_peer_generation() {
        let root = test_root("file-priority-live-reconcile");
        let configuration = config(&root);
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind content peer");
        let address = listener.local_addr().expect("content peer address");
        let (accepted_sender, mut accepted_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (closed_sender, mut closed_receiver) = tokio::sync::mpsc::unbounded_channel();
        let peer_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept content peer");
            let mut handshake = [0; HANDSHAKE_LENGTH];
            stream
                .read_exact(&mut handshake)
                .await
                .expect("read content handshake");
            decode_handshake(&handshake, info_hash).expect("content handshake identity");
            stream
                .write_all(&encode_handshake(info_hash, *b"-RS-FILE-LIVE-000000"))
                .await
                .expect("send content handshake");
            stream
                .write_all(&encode_message(&PeerMessage::Bitfield(vec![0xc0])).expect("bitfield"))
                .await
                .expect("send content bitfield");
            accepted_sender.send(()).expect("report accepted peer");
            let mut buffer = [0; 128];
            loop {
                match stream.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                        ) =>
                    {
                        break;
                    }
                    Err(error) => panic!("wait for retained generation: {error}"),
                }
            }
            closed_sender.send(()).expect("report peer closure");
        });

        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-live-file-priority".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe={address}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add content torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("live file-priority add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record content metadata");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open content service");
        tokio::time::timeout(std::time::Duration::from_secs(1), accepted_receiver.recv())
            .await
            .expect("content generation did not connect")
            .expect("accepted peer signal");
        let verification_before = service
            .load_resume_conservative(&torrent_id)
            .expect("load initial verification")
            .verification;
        let control = service
            .active_download()
            .expect("active content generation")
            .1
            .control
            .clone();

        let raised = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "raise-one-live-file".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![0],
                    priority: FilePriority::High,
                },
            })
            .await
            .expect("raise one file");
        let raised_revision = raised.revision.parse::<u64>().expect("raise revision");
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while control.applied_file_selection_revision() < raised_revision {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("raised priority did not apply live");
        assert!(closed_receiver.try_recv().is_err());
        assert_eq!(
            service
                .load_resume_conservative(&torrent_id)
                .expect("load raised priority")
                .high_priority_files,
            vec![0]
        );

        let skipped = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "skip-one-live-file".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                    priority: FilePriority::Skip,
                },
            })
            .await
            .expect("skip one file");
        let skipped_revision = skipped.revision.parse::<u64>().expect("skip revision");
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while control.applied_file_selection_revision() < skipped_revision {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("skipped selection did not reconcile");
        assert!(closed_receiver.try_recv().is_err());

        let restored = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-one-live-file".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                },
            })
            .await
            .expect("restore one file");
        let restored_revision = restored.revision.parse::<u64>().expect("restore revision");
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while control.applied_file_selection_revision() < restored_revision {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("restored selection did not reconcile");
        assert!(closed_receiver.try_recv().is_err());
        assert_eq!(
            service
                .load_resume_conservative(&torrent_id)
                .expect("load reconciled verification")
                .verification,
            verification_before
        );

        service.shutdown().await.expect("shutdown");
        tokio::time::timeout(std::time::Duration::from_secs(1), closed_receiver.recv())
            .await
            .expect("retained peer did not close on shutdown")
            .expect("peer closure signal");
        tokio::time::timeout(std::time::Duration::from_secs(1), peer_task)
            .await
            .expect("peer task did not join")
            .expect("peer task");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn owner_cleanup_failure_is_not_accepted_as_joined_pause() {
        let root = test_root("pause-cleanup-failure");
        let configuration = config(&root);
        let info_hash = "000102030405060708090a0b0c0d0e0f10111213";
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-cleanup-failure", info_hash);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-cleanup-failure".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("persist paused intent");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open paused service");
        let result = handle_task_outcome(
            &service.store,
            &service.storage_roots,
            &service.views,
            &torrent_id,
            Err(DownloadError::PeerCleanup {
                failure: "download cancelled".to_owned(),
                cleanup: "one peer connection remains".to_owned(),
            }),
        );
        assert!(
            result
                .expect_err("cleanup failure must propagate")
                .contains("one peer connection remains")
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn delete_data_removal_joins_and_deletes_only_exact_path_artifacts() {
        let root = test_root("remove-path");
        let config = config(&root);
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let info_hash_hex = crate::control::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("durable profile root"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-remove-path", &info_hash_hex);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        drop(store);

        let payload = root.join("payload");
        let output = payload.join("test");
        let staging = payload.join(format!(".{torrent_id}.rstorrent-staging"));
        let part = payload.join(format!(".{torrent_id}.rstorrent-parts"));
        let sibling = payload.join("keep-me");
        fs::create_dir_all(&payload).expect("create payload root");
        fs::write(&output, b"payload").expect("write output");
        fs::write(&part, b"parts").expect("write part file");
        fs::write(&sibling, b"sibling").expect("write sibling");

        let mut service = ApplicationService::open(config)
            .await
            .expect("open service");
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "remove-with-data".to_owned(),
            expected_revision: None,
            command: Command::RemoveTorrent {
                torrent_id: torrent_id.clone(),
                data: RemovalDataPolicy::DeleteData,
            },
        };
        service.dispatch(request.clone()).await.expect("remove");
        assert!(!output.exists());
        assert!(!staging.exists());
        assert!(!part.exists());
        assert_eq!(fs::read(&sibling).expect("preserved sibling"), b"sibling");
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );
        service.dispatch(request).await.expect("idempotent replay");

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn direct_single_file_cleanup_removes_exact_file_and_part() {
        let root = test_root("direct-single-cleanup");
        let payload = root.join("payload");
        let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
        let paths = torrent_storage_paths(
            &payload,
            "named.bin",
            torrent_id.parse().expect("torrent ID"),
        )
        .expect("direct paths");
        fs::create_dir_all(paths.content.parent().expect("content parent"))
            .expect("create content parent");
        fs::write(&paths.content, b"downloaded").expect("write direct content");
        fs::create_dir_all(paths.part.parent().expect("part parent")).expect("create part parent");
        fs::write(&paths.part, b"boundary").expect("write part");

        delete_path_artifacts(&payload, torrent_id, "named.bin", &file_cleanup_manifest())
            .expect("delete exact direct artifacts");

        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn direct_tree_cleanup_preserves_unrelated_descendants() {
        let root = test_root("direct-tree-cleanup");
        let payload = root.join("payload");
        let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
        let content = payload.join("named");
        fs::create_dir_all(content.join("season")).expect("create direct tree");
        fs::write(content.join("season/episode.bin"), b"downloaded").expect("write expected file");
        fs::create_dir_all(content.join("unrelated")).expect("create unrelated directory");
        fs::write(content.join("unrelated/sentinel"), b"preserve").expect("write sentinel");

        delete_path_artifacts(
            &payload,
            torrent_id,
            "named",
            &tree_cleanup_manifest(&[&["season", "episode.bin"]]),
        )
        .expect("delete exact direct tree files");

        assert!(!content.join("season/episode.bin").exists());
        assert_eq!(
            fs::read(content.join("unrelated/sentinel")).unwrap(),
            b"preserve"
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn direct_cleanup_preflights_all_expected_files_before_mutation() {
        use std::os::unix::fs::symlink;

        let root = test_root("direct-cleanup-preflight");
        let payload = root.join("payload");
        let content = payload.join("named");
        let outside = root.join("outside.bin");
        let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
        fs::create_dir_all(&content).expect("create direct tree");
        fs::write(content.join("first.bin"), b"downloaded").expect("write first file");
        fs::write(&outside, b"foreign").expect("write outside file");
        symlink(&outside, content.join("linked.bin")).expect("create hostile expected link");

        let error = delete_path_artifacts(
            &payload,
            torrent_id,
            "named",
            &tree_cleanup_manifest(&[&["first.bin"], &["linked.bin"]]),
        )
        .expect_err("expected-path link must fail closed");

        assert!(error.to_string().contains("unexpected type"));
        assert_eq!(fs::read(content.join("first.bin")).unwrap(), b"downloaded");
        assert_eq!(fs::read(outside).unwrap(), b"foreign");
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn delete_data_removal_does_not_adopt_legacy_hash_named_artifacts() {
        let root = test_root("remove-legacy-path");
        let config = config(&root);
        let raw_info = b"d5:filesld6:lengthi4e4:pathl8:file.bineee4:name5:named12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let legacy_id = crate::control::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("durable profile root"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-remove-legacy-path", &legacy_id);
        drop(store);

        let payload = root.join("payload");
        let output = payload.join(&legacy_id);
        let staging = payload.join(format!(".{legacy_id}.rstorrent-staging"));
        let part = payload.join(format!(".{legacy_id}.rstorrent-parts"));
        fs::create_dir_all(&output).expect("create legacy output");
        fs::write(output.join("payload.bin"), b"payload").expect("write output");
        fs::create_dir_all(&staging).expect("create legacy staging");
        fs::write(staging.join("partial.bin"), b"partial").expect("write staging");
        fs::write(&part, b"parts").expect("write part file");

        let mut service = ApplicationService::open(config)
            .await
            .expect("open legacy service");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-legacy-with-data".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id,
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("remove legacy torrent");
        assert!(output.exists());
        assert!(staging.exists());
        assert!(part.exists());
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn keep_data_removal_preserves_path_artifacts() {
        let root = test_root("remove-keep");
        let info_hash = "000102030405060708090a0b0c0d0e0f10111213";
        let payload = root.join("payload");
        let output = payload.join(info_hash);
        let staging = payload.join(format!(".{info_hash}.rstorrent-staging"));
        let part = payload.join(format!(".{info_hash}.rstorrent-parts"));
        fs::create_dir_all(&output).expect("create output");
        fs::create_dir_all(&staging).expect("create staging");
        fs::write(output.join("payload.bin"), b"payload").expect("write output");
        fs::write(staging.join("partial.bin"), b"partial").expect("write staging");
        fs::write(&part, b"parts").expect("write part file");

        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open service");
        let response = service
            .dispatch(add_request("add-remove-keep", info_hash))
            .await
            .expect("add");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("keep-data add result"),
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-keep".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id,
                    data: RemovalDataPolicy::Keep,
                },
            })
            .await
            .expect("remove while keeping data");
        assert_eq!(
            fs::read(output.join("payload.bin")).expect("output"),
            b"payload"
        );
        assert_eq!(
            fs::read(staging.join("partial.bin")).expect("staging"),
            b"partial"
        );
        assert_eq!(fs::read(&part).expect("part"), b"parts");

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn failed_path_cleanup_stays_visible_and_retries_with_a_new_generation() {
        let root = test_root("remove-failure");
        let config = config(&root);
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("durable profile root"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-remove-failure", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        drop(store);
        let part = root
            .join("payload")
            .join(format!(".{torrent_id}.rstorrent-parts"));
        fs::create_dir_all(&part).expect("create invalid part directory");

        let mut service = ApplicationService::open(config)
            .await
            .expect("open service");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-fails".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("accept failed cleanup intent");
        let failed = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("failed snapshot")
            .torrents
            .remove(0);
        assert_eq!(failed.removal_state, Some(RemovalState::Failed));
        assert!(failed.error.is_some());

        fs::remove_dir(&part).expect("repair invalid part path");
        fs::write(&part, b"part").expect("create valid part file");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-retry".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("retry cleanup");
        assert!(!part.exists());
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn startup_resumes_a_durable_pending_path_removal() {
        let root = test_root("remove-restart");
        let config = config(&root);
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("durable profile root"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-remove-restart", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-before-restart".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .expect("persist pending removal");
        drop(store);
        let output = root.join("payload").join("test");
        fs::create_dir_all(output.parent().expect("output parent")).expect("create payload root");
        fs::write(&output, b"payload").expect("write interrupted output");

        let mut service = ApplicationService::open(config)
            .await
            .expect("resume application");
        assert!(!output.exists());
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn platform_removal_requires_matching_generation_confirmation() {
        let root = test_root("remove-platform");
        let mut config = config(&root);
        config.storage_roots = vec![ConfiguredStorageRoot::platform("downloads")];
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(info_hash);
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("durable profile root"),
            &config.profile_id,
            &config.storage_roots,
        )
        .expect("open setup store");
        let torrent_id = add_store_torrent(&mut store, "add-remove-platform", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        drop(store);

        let mut service = ApplicationService::open(config.clone())
            .await
            .expect("open service");
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-platform".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("request platform removal");
        let initial_plan = service
            .platform_removal_plan(&torrent_id)
            .await
            .expect("platform plan");
        assert_eq!(initial_plan.name, "test");
        assert_eq!(initial_plan.storage_root, "downloads");
        assert!(
            service
                .confirm_platform_removal(&torrent_id, "stale-operation")
                .await
                .is_err()
        );
        assert_eq!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents[0]
                .removal_state,
            Some(RemovalState::AwaitingPlatform)
        );
        service
            .fail_platform_removal(
                &torrent_id,
                &initial_plan.operation_id,
                "provider permission was revoked",
            )
            .await
            .expect("record platform failure");
        let failed = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("failed snapshot")
            .torrents
            .remove(0);
        assert_eq!(failed.removal_state, Some(RemovalState::Failed));
        assert_eq!(
            failed.error.as_deref(),
            Some("provider permission was revoked")
        );
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "retry-platform-removal".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("retry platform removal");
        let plan = service
            .platform_removal_plan(&torrent_id)
            .await
            .expect("retry platform plan");
        assert_ne!(plan.operation_id, initial_plan.operation_id);
        service
            .shutdown()
            .await
            .expect("shutdown before confirmation");
        drop(service);

        let mut service = ApplicationService::open(config)
            .await
            .expect("reopen awaiting platform removal");
        let resumed_plan = service
            .platform_removal_plan(&torrent_id)
            .await
            .expect("resume platform plan");
        assert_eq!(resumed_plan, plan);
        service
            .confirm_platform_removal(&torrent_id, &plan.operation_id)
            .await
            .expect("confirm current operation");
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );

        let metadata_pending = "000102030405060708090a0b0c0d0e0f10111213";
        let response = service
            .store_mut()
            .expect("store")
            .handle_durable(&add_request(
                "add-platform-without-metadata",
                metadata_pending,
            ))
            .expect("add metadata-pending platform torrent");
        let metadata_pending = match response.result.as_ref() {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id.clone(),
            _ => panic!("metadata-pending platform add result"),
        };
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-platform-without-metadata".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: metadata_pending,
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("remove metadata-pending torrent");
        assert!(
            service
                .store_mut()
                .expect("store")
                .snapshot()
                .expect("snapshot")
                .torrents
                .is_empty()
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn tracker_retry_waiting_is_observed_without_another_command() {
        let root = test_root("tracker-retry-waiting");
        let info_hash = "000102030405060708090a0b0c0d0e0f10111213";
        let mut service = ApplicationService::open(config(&root))
            .await
            .expect("open service");
        let summary = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("summary");
        summary.next_update().await.expect("summary snapshot");
        let diagnostics = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Diagnostics,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: Some(DiagnosticFilter {
                    profile: DiagnosticProfile::Normal,
                    minimum_severity: DiagnosticSeverity::Info,
                    categories: Vec::new(),
                }),
                catalog_page: None,
            })
            .expect("diagnostics");
        diagnostics
            .next_update()
            .await
            .expect("diagnostic snapshot");

        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "blocked-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{info_hash}&tr=udp%3A%2F%2F192.0.2.1%3A6969%2Fannounce"
                    ),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .await
            .expect("add");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("tracker retry add result"),
        };

        let waiting = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut observed = None;
            loop {
                let update = summary.next_update().await.expect("summary update");
                match update.payload {
                    ViewUpdatePayload::Snapshot {
                        snapshot: ViewSnapshot::TorrentList { torrents, .. },
                    } => observed = torrents.into_iter().next(),
                    ViewUpdatePayload::Patch {
                        patch:
                            ViewPatch::TorrentList {
                                mut upsert,
                                updates,
                                ..
                            },
                    } => {
                        if let Some(torrent) = upsert.pop() {
                            observed = Some(torrent);
                        }
                        if let Some(torrent) = observed.as_mut() {
                            for update in updates {
                                if update.torrent_id == torrent.torrent_id {
                                    update.apply(torrent).expect("torrent list update");
                                }
                            }
                        }
                    }
                    _ => {}
                }
                if observed.as_ref().is_some_and(|torrent| {
                    torrent.progress.disposition == ProgressDisposition::Waiting
                        && torrent.progress.reason == ProgressReason::WaitingForDiscovery
                }) {
                    break;
                }
            }
        })
        .await;
        assert!(
            waiting.is_ok(),
            "tracker owner did not publish scheduled discovery waiting"
        );

        let diagnostic = tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let update = diagnostics.next_update().await.expect("diagnostic update");
                if serde_json::to_string(&update)
                    .expect("serialize diagnostic")
                    .contains("tracker_retry_scheduled")
                {
                    break;
                }
            }
        })
        .await;
        assert!(
            diagnostic.is_ok(),
            "missing scheduled tracker retry diagnostic"
        );
        let resume = service
            .load_resume_conservative(&torrent_id)
            .expect("resume state");
        assert!(resume.desired_running);
        assert_eq!(resume.state, TorrentState::AwaitingMetadata);

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn offline_policy_reports_network_blockage_without_torrent_error() {
        let root = test_root("network-offline");
        let torrent_id = "000102030405060708090a0b0c0d0e0f10111213";
        let mut application_config = config(&root);
        application_config.network.policy = NetworkPolicy::Offline;
        let mut service = ApplicationService::open(application_config)
            .await
            .expect("open offline service");
        let summary = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("summary");
        summary.next_update().await.expect("initial summary");

        service
            .dispatch(add_request("offline-add", torrent_id))
            .await
            .expect("add while offline");

        let torrent = tokio::time::timeout(std::time::Duration::from_secs(1), async {
            let mut observed = None;
            loop {
                let update = summary.next_update().await.expect("summary update");
                match update.payload {
                    ViewUpdatePayload::Snapshot {
                        snapshot: ViewSnapshot::TorrentList { torrents, .. },
                    } => observed = torrents.into_iter().next(),
                    ViewUpdatePayload::Patch {
                        patch:
                            ViewPatch::TorrentList {
                                mut upsert,
                                updates,
                                ..
                            },
                    } => {
                        if let Some(torrent) = upsert.pop() {
                            observed = Some(torrent);
                        }
                        if let Some(torrent) = observed.as_mut() {
                            for update in updates {
                                if update.torrent_id == torrent.torrent_id {
                                    update.apply(torrent).expect("torrent list update");
                                }
                            }
                        }
                    }
                    _ => {}
                }
                if observed.as_ref().is_some_and(|torrent| {
                    torrent.progress.reason == ProgressReason::NetworkDisabled
                }) {
                    break observed.expect("network-disabled torrent");
                }
            }
        })
        .await
        .expect("network-disabled progress");

        assert_eq!(torrent.state, TorrentState::AwaitingMetadata);
        assert!(torrent.error.is_none());
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove offline test root");
    }

    #[tokio::test]
    async fn startup_projects_provisional_magnet_display_name() {
        let root = test_root("magnet-display-name");
        let configuration = config(&root);
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &configuration.storage_roots,
        )
        .expect("open store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-named-magnet".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213&dn=Waiting+for+metadata".to_owned(),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add named magnet");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("named magnet add omitted its torrent owner"),
        };
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        let summary = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("summary");
        let update = summary.next_update().await.expect("summary snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::TorrentList { torrents, .. },
        } = update.payload
        else {
            panic!("expected torrent-list snapshot");
        };
        let torrent = torrents
            .iter()
            .find(|torrent| torrent.torrent_id == torrent_id)
            .expect("named torrent row");
        assert!(torrent.display_name.is_none());
        assert_eq!(
            torrent.source_display_name.as_deref(),
            Some("Waiting for metadata")
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove magnet-name test root");
    }

    #[tokio::test]
    async fn startup_projects_verified_metadata_name() {
        let root = test_root("metadata-name");
        let configuration = config(&root);
        let raw_info = b"d5:filesld6:lengthi4e4:pathl8:file.bineee4:name5:named12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let configured_root = configuration.storage_roots[0].clone();
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &[configured_root],
        )
        .expect("open store");
        let torrent_id = add_store_torrent(&mut store, "add", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        drop(store);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        let summary = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Summary,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: None,
            })
            .expect("summary");
        let update = summary.next_update().await.expect("summary snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot: ViewSnapshot::TorrentList { torrents, .. },
        } = update.payload
        else {
            panic!("expected torrent-list snapshot");
        };
        assert_eq!(torrents[0].display_name.as_deref(), Some("named"));

        let files = service
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                projection: ViewProjection::Files,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: None,
                catalog_page: Some(crate::CatalogPageRequest::default()),
            })
            .expect("files");
        let update = files.next_update().await.expect("files snapshot");
        let ViewUpdatePayload::Snapshot {
            snapshot:
                ViewSnapshot::Files {
                    filesystem_content_base,
                    ..
                },
        } = update.payload
        else {
            panic!("expected files snapshot");
        };
        assert_eq!(
            filesystem_content_base.as_deref(),
            root.join("payload").join("named").to_str()
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove metadata-name test root");
    }

    #[tokio::test]
    async fn corrupt_metadata_enters_repair_before_storage() {
        let root = test_root("metadata-corruption");
        let configuration = config(&root);
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let configured_root = configuration.storage_roots[0].clone();
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &[configured_root],
        )
        .expect("open store");
        let torrent_id = add_store_torrent(&mut store, "add", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        let healthy_id = add_store_torrent(
            &mut store,
            "add-healthy-neighbor",
            "ffffffffffffffffffffffffffffffffffffffff",
        );
        let database = store
            .database_path()
            .expect("durable database path")
            .to_owned();
        drop(store);

        let connection = Connection::open(database).expect("open raw database");
        let torrent_owner = owner_bytes(&torrent_id);
        connection
            .execute(
                "UPDATE torrents SET raw_info = x'00' WHERE torrent_id = ?1",
                [torrent_owner.as_slice()],
            )
            .expect("corrupt raw metadata");
        drop(connection);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service with corrupt metadata");
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "snapshot".to_owned(),
                expected_revision: None,
                command: Command::Snapshot,
            })
            .await
            .expect("snapshot");
        let ResponseOutcome::Success { snapshot } = response.outcome else {
            panic!("snapshot should succeed");
        };
        assert_eq!(snapshot.torrents.len(), 2);
        assert_eq!(
            snapshot
                .torrents
                .iter()
                .find(|torrent| torrent.torrent_id == torrent_id)
                .expect("quarantined torrent")
                .state,
            TorrentState::NeedsRepair
        );
        assert_eq!(
            snapshot
                .torrents
                .iter()
                .find(|torrent| torrent.torrent_id == healthy_id)
                .expect("healthy torrent")
                .state,
            TorrentState::AwaitingMetadata
        );
        assert_eq!(
            fs::read_dir(root.join("payload"))
                .expect("read empty payload root")
                .count(),
            0
        );
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn malformed_have_state_is_cleared_conservatively() {
        let root = test_root("have-corruption");
        let configuration = config(&root);
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let configured_root = configuration.storage_roots[0].clone();
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            &[configured_root],
        )
        .expect("open store");
        let torrent_id = add_store_torrent(&mut store, "add", &torrent_id);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        let database = store
            .database_path()
            .expect("durable database path")
            .to_owned();
        drop(store);

        let connection = Connection::open(database).expect("open raw database");
        let torrent_owner = owner_bytes(&torrent_id);
        let mut have: Vec<u8> = connection
            .query_row(
                "SELECT have_state FROM torrents WHERE torrent_id = ?1",
                [torrent_owner.as_slice()],
                |row| row.get(0),
            )
            .expect("read have state");
        *have.last_mut().expect("bitfield byte") = 1;
        connection
            .execute(
                "UPDATE torrents SET have_state = ?2 WHERE torrent_id = ?1",
                rusqlite::params![torrent_owner.as_slice(), have],
            )
            .expect("corrupt have padding");
        drop(connection);

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service with malformed have state");
        let response = service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "snapshot".to_owned(),
                expected_revision: None,
                command: Command::Snapshot,
            })
            .await
            .expect("snapshot");
        let ResponseOutcome::Success { snapshot } = response.outcome else {
            panic!("snapshot should succeed");
        };
        assert_eq!(snapshot.torrents[0].verified_piece_count, 0);
        assert_ne!(snapshot.torrents[0].state, TorrentState::NeedsRepair);
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn unowned_existing_tree_rechecks_and_ignores_unrelated_file() {
        let root = test_root("storage-repair");
        let configuration = config(&root);
        let payload = b"data";
        let mut raw_info = b"d5:filesld6:lengthi4e4:pathl6:season7:episodeeee4:name4:root12:piece lengthi4e6:pieces20:".to_vec();
        raw_info.extend_from_slice(&Sha1::digest(payload));
        raw_info.push(b'e');
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = super::encode_info_hash(info_hash);
        let configured_root = configuration.storage_roots[0].clone();
        let mut store = SessionStore::open(
            configuration
                .durable_profile_root()
                .expect("durable profile root"),
            &configuration.profile_id,
            std::slice::from_ref(&configured_root),
        )
        .expect("open store");
        let torrent_id = add_store_torrent(&mut store, "add", &torrent_id);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        drop(store);

        let crate::StorageRootLocation::Path(payload_root) = &configured_root.location else {
            unreachable!("test root is path-backed")
        };
        let incomplete_output = payload_root.join("root");
        fs::create_dir_all(&incomplete_output).expect("create incomplete output");
        fs::write(incomplete_output.join("preserve"), b"user artifact")
            .expect("write preserved artifact");
        fs::create_dir(incomplete_output.join("season")).expect("create existing season");
        fs::write(incomplete_output.join("season/episode"), payload)
            .expect("write existing payload");
        fs::write(incomplete_output.join("season/notes"), b"episode notes")
            .expect("write unrelated nested file");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service with incomplete storage");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "existing-tree-payload",
        )
        .await;
        let resume = service
            .store_mut()
            .expect("store")
            .load_resume(&torrent_id)
            .expect("load adopted partial tree");
        assert_eq!(resume.storage_state, StorageState::Available);
        assert_eq!(resume.have.expect("adopted have").pieces(), &[true]);
        assert_eq!(resume.verification.requested(), 1);
        assert_eq!(resume.verification.completed(), 1);
        assert_eq!(
            fs::read(incomplete_output.join("preserve"))
                .expect("read preserved incomplete artifact"),
            b"user artifact"
        );
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-adopted-tree".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id,
                    data: RemovalDataPolicy::DeleteData,
                },
            })
            .await
            .expect("remove adopted tree");
        assert!(!incomplete_output.join("season/episode").exists());
        assert_eq!(
            fs::read(incomplete_output.join("season/notes"))
                .expect("preserve unrelated nested content after removal"),
            b"episode notes"
        );
        assert_eq!(
            fs::read(incomplete_output.join("preserve"))
                .expect("preserve unrelated destination content after removal"),
            b"user artifact"
        );
        service.shutdown().await.expect("shutdown");
        assert_eq!(
            fs::read(incomplete_output.join("preserve"))
                .expect("preserve unrelated destination content"),
            b"user artifact"
        );
        drop(service);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn platform_roots_install_and_repair_independently() {
        let root = test_root("platform-root-registry");
        let mut configuration = config(&root);
        configuration.storage_roots.clear();
        let (client, broker) = platform_storage_channel();
        configuration.platform_storage_client = Some(client);
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service without a platform root");

        let installs = tokio::spawn(async move {
            for expected_root in ["root_a", "root_b"] {
                let request = broker.next_request().await.expect("candidate probe");
                assert_eq!(request.root_id, expected_root);
                assert_eq!(request.operation, PlatformStorageOperation::Observe);
                assert!(request.path.is_empty());
                assert!(
                    broker.complete_observation(
                        request.request_id,
                        StorageObservation::present(StorageObjectKind::Directory, None, None)
                            .expect("root observation"),
                    )
                );
            }
            broker
        });
        let first = service
            .install_platform_storage_root("root_a", "Folder A", false)
            .await
            .expect("install first root");
        assert_eq!(
            first.availability,
            crate::StorageRootAvailability::Available
        );
        let second = service
            .install_platform_storage_root("root_b", "Folder B", true)
            .await
            .expect("install current root");
        assert_eq!(
            second.availability,
            crate::StorageRootAvailability::Available
        );
        let broker = installs.await.expect("join install provider");
        let storage = service.storage_snapshot().expect("installed roots");
        assert_eq!(storage.default_root.as_deref(), Some("root_b"));
        assert_eq!(storage.roots.len(), 2);

        let probe_broker = broker.clone();
        let revoke = tokio::spawn(async move {
            let first = probe_broker
                .next_request()
                .await
                .expect("first health probe");
            assert_eq!(first.root_id, "root_a");
            assert!(probe_broker.complete_error(
                first.request_id,
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::GrantUnavailable,
                    "test first grant revoked",
                ),
            ));
            let second = probe_broker
                .next_request()
                .await
                .expect("second health probe");
            assert_eq!(second.root_id, "root_b");
            assert!(
                probe_broker.complete_observation(
                    second.request_id,
                    StorageObservation::present(StorageObjectKind::Directory, None, None)
                        .expect("root observation"),
                )
            );
        });
        assert!(
            !service
                .probe_platform_storage_roots()
                .await
                .expect("probe independent roots")
        );
        revoke.await.expect("join revoke provider");
        let storage = service.storage_snapshot().expect("root availability");
        assert_eq!(storage.default_root.as_deref(), Some("root_b"));
        assert_eq!(
            storage
                .roots
                .iter()
                .find(|root| root.root_id == "root_a")
                .expect("first root")
                .availability,
            crate::StorageRootAvailability::Unavailable
        );
        assert_eq!(
            storage
                .roots
                .iter()
                .find(|root| root.root_id == "root_b")
                .expect("second root")
                .availability,
            crate::StorageRootAvailability::Available
        );

        let repair_broker = broker.clone();
        let repair = tokio::spawn(async move {
            let request = repair_broker.next_request().await.expect("repair probe");
            assert_eq!(request.root_id, "root_a");
            assert!(
                repair_broker.complete_observation(
                    request.request_id,
                    StorageObservation::present(StorageObjectKind::Directory, None, None)
                        .expect("root observation"),
                )
            );
        });
        let (repaired, restarts) = service
            .repair_platform_storage_root("root_a", "Repaired A")
            .await
            .expect("repair first root");
        repair.await.expect("join repair provider");
        assert!(restarts.is_empty());
        assert_eq!(repaired.label, "Repaired A");
        assert_eq!(
            repaired.availability,
            crate::StorageRootAvailability::Available
        );
        assert_eq!(
            service
                .storage_snapshot()
                .expect("repaired storage")
                .default_root
                .as_deref(),
            Some("root_b")
        );
        let (replayed, replay_restarts) = service
            .repair_platform_storage_root("root_a", "Repaired A")
            .await
            .expect("replay completed repair");
        assert_eq!(replayed, repaired);
        assert!(replay_restarts.is_empty());

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn platform_root_requires_broker_health_and_transitions_on_grant_loss() {
        let root = test_root("platform-root-health");
        let mut configuration = config(&root);
        configuration.storage_roots = vec![ConfiguredStorageRoot::platform("downloads")];
        let (client, broker) = platform_storage_channel();
        configuration.platform_storage_client = Some(client);
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        assert_eq!(
            service.storage_snapshot().expect("initial storage").roots[0].availability,
            crate::StorageRootAvailability::Unavailable
        );

        let provider = tokio::spawn(async move {
            let healthy = broker.next_request().await.expect("health request");
            assert_eq!(healthy.operation, PlatformStorageOperation::Observe);
            assert!(healthy.path.is_empty());
            assert!(
                broker.complete_observation(
                    healthy.request_id,
                    StorageObservation::present(StorageObjectKind::Directory, None, None)
                        .expect("root observation"),
                )
            );
            let revoked = broker
                .next_request()
                .await
                .expect("ordinary storage request");
            assert_eq!(revoked.operation, PlatformStorageOperation::Observe);
            assert!(broker.complete_error(
                revoked.request_id,
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::GrantUnavailable,
                    "test grant revoked",
                ),
            ));
        });
        assert!(
            service
                .probe_platform_storage_roots()
                .await
                .expect("healthy probe")
        );
        assert_eq!(
            service.storage_snapshot().expect("healthy storage").roots[0].availability,
            crate::StorageRootAvailability::Available
        );
        let reference = StorageFileReference::new(
            service.storage_file_pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 1,
                role: StorageFileRole::Payload(0),
            },
            StorageFileLocator::Platform(rstorrent_engine::PlatformStorageTarget {
                root_id: "downloads".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 1,
                role: StorageFileRole::Payload(0),
                path: vec!["payload.bin".to_owned()],
            }),
        );
        assert!(reference.observe().await.is_err());
        service.reap_finished().await.expect("reconcile root loss");
        assert_eq!(
            service.storage_snapshot().expect("revoked storage").roots[0].availability,
            crate::StorageRootAvailability::Unavailable
        );
        provider.await.expect("provider task");
        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    /// Answers every platform probe with a healthy directory.
    fn healthy_platform_provider(
        broker: Arc<rstorrent_engine::PlatformStorageBroker>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            while let Some(request) = broker.next_request().await {
                assert_eq!(request.operation, PlatformStorageOperation::Observe);
                broker.complete_observation(
                    request.request_id,
                    StorageObservation::present(StorageObjectKind::Directory, None, None)
                        .expect("root observation"),
                );
            }
        })
    }

    #[tokio::test]
    async fn detaching_platform_root_keeps_bound_torrents_and_replaces_default() {
        let root = test_root("platform-root-detach");
        let mut configuration = config(&root);
        configuration.storage_roots = vec![ConfiguredStorageRoot::platform("downloads")];
        let (client, broker) = platform_storage_channel();
        configuration.platform_storage_client = Some(client);
        let torrent_id = {
            let mut store = SessionStore::open(
                configuration
                    .durable_profile_root()
                    .expect("durable profile"),
                &configuration.profile_id,
                &configuration.storage_roots,
            )
            .expect("open fixture store");
            add_store_torrent(&mut store, "add", &"d".repeat(40))
        };
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        let provider = healthy_platform_provider(broker);
        assert!(service.probe_platform_storage_roots().await.expect("probe"));
        service
            .install_platform_storage_root("root_b", "Folder B", false)
            .await
            .expect("install second root");
        assert_eq!(
            service
                .storage_snapshot()
                .expect("storage")
                .default_root
                .as_deref(),
            Some("downloads")
        );

        let detached = service
            .detach_platform_storage_root("downloads")
            .await
            .expect("detach referenced current root");
        assert!(!detached.removed);
        assert_eq!(detached.affected_torrent_ids, vec![torrent_id.clone()]);
        assert_eq!(detached.default_root.as_deref(), Some("root_b"));
        let storage = service.storage_snapshot().expect("detached storage");
        assert_eq!(storage.roots.len(), 2);
        let downloads = storage
            .roots
            .iter()
            .find(|root| root.root_id == "downloads")
            .expect("retained root");
        assert_eq!(
            downloads.availability,
            crate::StorageRootAvailability::Unavailable
        );
        let snapshot = service
            .store_mut()
            .expect("store")
            .snapshot()
            .expect("snapshot");
        let torrent = snapshot
            .torrents
            .iter()
            .find(|torrent| torrent.torrent_id == torrent_id)
            .expect("torrent remains bound");
        assert_eq!(torrent.storage_root, "downloads");
        assert!(service.active_download_for(&torrent_id).is_none());

        let removed = service
            .detach_platform_storage_root("root_b")
            .await
            .expect("detach unreferenced current root");
        assert!(removed.removed);
        assert!(removed.affected_torrent_ids.is_empty());
        assert_eq!(removed.default_root, None);
        let storage = service.storage_snapshot().expect("removed storage");
        assert_eq!(storage.roots.len(), 1);
        assert_eq!(storage.default_root, None);

        service.shutdown().await.expect("shutdown");
        provider.abort();
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn detaching_platform_root_waits_for_pending_platform_removal() {
        let root = test_root("platform-root-detach-removal");
        let mut configuration = config(&root);
        configuration.storage_roots = vec![ConfiguredStorageRoot::platform("downloads")];
        let (client, broker) = platform_storage_channel();
        configuration.platform_storage_client = Some(client);
        let raw_info = single_file_info("seed.bin", b"abcdefg", 4);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = {
            let mut store = SessionStore::open(
                configuration
                    .durable_profile_root()
                    .expect("durable profile"),
                &configuration.profile_id,
                &configuration.storage_roots,
            )
            .expect("open fixture store");
            let torrent_id = add_store_torrent(
                &mut store,
                "add",
                &crate::control::encode_info_hash(info_hash),
            );
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record metadata");
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: "remove".to_owned(),
                    expected_revision: None,
                    command: Command::RemoveTorrent {
                        torrent_id: torrent_id.clone(),
                        data: RemovalDataPolicy::DeleteData,
                    },
                })
                .expect("begin removal");
            torrent_id
        };
        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open service");
        let provider = healthy_platform_provider(broker);
        assert!(service.probe_platform_storage_roots().await.expect("probe"));
        let error = service
            .detach_platform_storage_root("downloads")
            .await
            .expect_err("pending platform removal needs the root");
        assert!(matches!(error, ApplicationError::Busy(owner) if owner == torrent_id));
        assert_eq!(
            service
                .storage_snapshot()
                .expect("storage")
                .default_root
                .as_deref(),
            Some("downloads")
        );

        service.shutdown().await.expect("shutdown");
        provider.abort();
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn platform_file_handoff_requires_verified_direct_content() {
        let root = test_root("platform-file-handoff");
        let payload = b"abcdefg";
        let raw_info = single_file_info("seed.bin", payload, 4);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash_hex = crate::control::encode_info_hash(info_hash);
        let mut configuration = config(&root);
        configuration.storage_roots = vec![ConfiguredStorageRoot::platform("downloads")];
        let (client, broker) = platform_storage_channel();
        configuration.platform_storage_client = Some(client);
        let torrent_id = {
            let mut store = SessionStore::open(
                configuration
                    .durable_profile_root()
                    .expect("durable profile"),
                &configuration.profile_id,
                &configuration.storage_roots,
            )
            .expect("open fixture store");
            let torrent_id = add_store_torrent(&mut store, "add", &info_hash_hex);
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record metadata");
            store
                .record_pieces(&torrent_id, &[0, 1])
                .expect("record verified pieces");
            store.mark_complete(&torrent_id).expect("record completion");
            torrent_id
        };

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open application");
        let provider = tokio::spawn(async move {
            let healthy = broker.next_request().await.expect("health request");
            assert_eq!(healthy.operation, PlatformStorageOperation::Observe);
            assert!(healthy.path.is_empty());
            assert!(
                broker.complete_observation(
                    healthy.request_id,
                    StorageObservation::present(StorageObjectKind::Directory, None, None)
                        .expect("root observation"),
                )
            );
        });
        assert!(
            service
                .probe_platform_storage_roots()
                .await
                .expect("healthy root")
        );
        provider.await.expect("provider task");
        let plan = service
            .platform_file_plan(&torrent_id, 0)
            .await
            .expect("direct platform file plan");
        assert_eq!(plan.torrent_id, torrent_id);
        assert_eq!(plan.storage_root, "downloads");
        assert_eq!(plan.components, ["seed.bin"]);
        assert_eq!(plan.length, payload.len() as u64);
        assert!(service.platform_file_plan(&torrent_id, 1).await.is_err());

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn path_file_handoff_returns_the_direct_content_path() {
        let root = test_root("path-file-handoff");
        let payload = b"abcdefg";
        let raw_info = single_file_info("seed.bin", payload, 4);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash_hex = crate::control::encode_info_hash(info_hash);
        let configuration = config(&root);
        fs::create_dir_all(root.join("payload")).expect("create payload root");
        let torrent_id = {
            let mut store = SessionStore::open(
                configuration
                    .durable_profile_root()
                    .expect("durable profile"),
                &configuration.profile_id,
                &configuration.storage_roots,
            )
            .expect("open fixture store");
            let torrent_id = add_store_torrent(&mut store, "add", &info_hash_hex);
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record metadata");
            store
                .record_pieces(&torrent_id, &[0, 1])
                .expect("record verified pieces");
            store.mark_complete(&torrent_id).expect("record completion");
            torrent_id
        };
        fs::write(root.join("payload/seed.bin"), payload).expect("write direct payload");

        let mut service = ApplicationService::open(configuration)
            .await
            .expect("open application");
        wait_for_torrent_state(
            &mut service,
            &torrent_id,
            TorrentState::Complete,
            "path-file-handoff",
        )
        .await;
        let plan = service
            .platform_file_plan(&torrent_id, 0)
            .await
            .expect("direct path file plan");
        assert_eq!(plan.torrent_id, torrent_id);
        assert_eq!(plan.storage_root, "downloads");
        assert_eq!(plan.components, ["seed.bin"]);
        assert_eq!(plan.length, payload.len() as u64);
        let internal = service
            .create_completed_media_capability(&torrent_id, 0)
            .await
            .expect("internal verified capability");
        assert_eq!(internal.length, payload.len() as u64);
        assert!(!internal.token.is_empty());
        let mut lease = service
            .resolve_media_capability(&internal.token)
            .expect("resolve internal capability");
        assert_eq!(
            lease
                .read_range(0, payload.len())
                .await
                .expect("read internal capability"),
            payload
        );

        service.shutdown().await.expect("shutdown");
        drop(service);
        fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn durable_complete_torrent_applies_slots_live_and_fences_lifecycle() {
        let root = test_root("incoming-seed-lifecycle");
        let payload = b"abcdefg";
        let raw_info = single_file_info("seed.bin", payload, 4);
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash_hex = crate::control::encode_info_hash(info_hash);
        // Keep the preferred port occupied so automatic selection uses a fresh
        // OS-assigned port, isolated from installed clients on the public default.
        let preferred_blocker = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("reserve preferred listener port");
        let preferred_port = preferred_blocker
            .local_addr()
            .expect("preferred address")
            .port();
        let configuration = config(&root);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                preferred_listen_port: preferred_port,
                port_mapping: crate::PortMappingPolicy::Disabled,
                peer_connection_limit: 1,
                upload_slots: 1,
                active_downloads: 3,
                upload_rate_limit: Default::default(),
                download_rate_limit: Default::default(),
                encryption: Default::default(),
                ipv6_enabled: true,
                tracker_https_server_authentication: Default::default(),
                ..ClientSettings::default()
            },
        );
        fs::create_dir_all(root.join("payload")).expect("create payload root");
        fs::write(root.join("payload/seed.bin"), payload).expect("write direct payload");
        let torrent_id = {
            let mut store = SessionStore::open(
                configuration
                    .durable_profile_root()
                    .expect("durable profile"),
                &configuration.profile_id,
                &configuration.storage_roots,
            )
            .expect("open fixture store");
            let torrent_id = add_store_torrent(&mut store, "add-seed", &info_hash_hex);
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record seed metadata");
            store
                .record_pieces(&torrent_id, &[0, 1])
                .expect("record verified pieces");
            store.mark_complete(&torrent_id).expect("complete seed");
            torrent_id
        };

        let mut first = ApplicationService::open(configuration.clone())
            .await
            .expect("open first application lifetime");
        let first_runtime = client_settings_runtime(&first).await;
        assert_eq!(first_runtime.effective_peer_connection_limit, 1);
        assert_eq!(first_runtime.effective_upload_slots, 1);
        assert_eq!(first_runtime.effective_peer_connection_limit, 1);
        let first_incoming = first
            .incoming_peer_snapshot()
            .expect("configured listener is active");
        assert_eq!(first_incoming.peer_budget.configured_limit, 1);
        assert_eq!(first_incoming.peer_budget.effective_limit, 1);
        assert!(
            first.admitted_seeds.contains(&torrent_id),
            "completed seed must win the default seed limit"
        );
        assert!(
            first
                .torrent_runtimes
                .get(&torrent_id)
                .unwrap()
                .handle()
                .has_seed_registration(),
            "admitted completed seed must own its registration"
        );
        assert!(
            first
                .torrent_runtimes
                .get(&torrent_id)
                .unwrap()
                .handle()
                .has_current_seed_registration(&first.session_network().incoming_seeding()),
            "admitted completed seed token must remain current"
        );
        wait_for_seed_registrations(&first, 1).await;
        let (mut peer, mut decoder, mut pending) =
            connect_application_seed_with_extensions(&first, info_hash, DEFAULT_PEER_ID, true)
                .await;
        let peer_endpoint = peer.local_addr().expect("incoming peer endpoint");
        let listener_endpoint = peer.peer_addr().expect("listener endpoint");
        peer.write_all(
            &encode_message(&PeerMessage::Extended {
                id: 0,
                payload: encode_extension_handshake(None),
            })
            .expect("encode remote extension handshake"),
        )
        .await
        .expect("send remote extension handshake");
        peer.write_all(&encode_message(&PeerMessage::Interested).expect("encode interested"))
            .await
            .expect("send interest");
        assert_eq!(
            read_peer_message(&mut peer, &mut decoder, &mut pending).await,
            PeerMessage::Unchoke
        );
        peer.write_all(
            &encode_message(&PeerMessage::Request(
                rstorrent_protocol::peer_wire::BlockRequest {
                    index: 1,
                    begin: 0,
                    length: 3,
                },
            ))
            .expect("encode payload request"),
        )
        .await
        .expect("send payload request");
        assert_eq!(
            read_peer_message(&mut peer, &mut decoder, &mut pending).await,
            PeerMessage::Piece {
                index: 1,
                begin: 0,
                block: b"efg".to_vec(),
            }
        );

        let incoming_peer = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(peer) = torrent_peer_views(&first, &torrent_id)
                    .await
                    .into_iter()
                    .find(|peer| {
                        peer.remote_interested == Some(true)
                            && peer.supports_ut_metadata == Some(true)
                            && peer.payload_uploaded_bytes.as_deref() == Some("3")
                    })
                {
                    break peer;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("incoming upload reaches the Peers projection");
        assert_eq!(incoming_peer.direction, PeerDirection::Incoming);
        assert_eq!(incoming_peer.transport, PeerTransportKind::Tcp);
        assert_eq!(incoming_peer.lifecycle, PeerLifecycle::Connected);
        assert_eq!(incoming_peer.role, PeerRole::Content);
        assert_eq!(incoming_peer.remote_endpoint, peer_endpoint.to_string());
        assert_eq!(
            incoming_peer.local_endpoint.as_deref(),
            Some(listener_endpoint.to_string().as_str())
        );
        assert_eq!(incoming_peer.sources, [PeerSourceView::Incoming]);
        assert_eq!(incoming_peer.supports_extensions, Some(true));
        assert_eq!(incoming_peer.remote_interested, Some(true));
        assert_eq!(incoming_peer.local_choking, Some(false));
        assert!(incoming_peer.peer_record_id.is_some());
        assert!(incoming_peer.peer_id.is_some());
        assert!(incoming_peer.client_name.is_some());
        assert!(incoming_peer.payload_upload_rate_bytes.is_some());
        assert_eq!(
            incoming_peer.peer_flags,
            [
                PeerFlagView::Incoming,
                PeerFlagView::UploadAllowed,
                PeerFlagView::ExtensionProtocol,
                PeerFlagView::MetadataExtension,
                PeerFlagView::OptimisticUnchoke,
            ]
        );
        assert_eq!(
            incoming_peer.capabilities.local_endpoint,
            crate::CapabilityStatus::Available
        );
        assert_eq!(
            incoming_peer.capabilities.ut_metadata,
            crate::CapabilityStatus::Available
        );
        assert_eq!(
            incoming_peer.capabilities.interest_directions,
            crate::CapabilityStatus::Available
        );
        assert_eq!(
            incoming_peer.capabilities.local_choke,
            crate::CapabilityStatus::Available
        );
        assert_eq!(
            incoming_peer.capabilities.upload,
            crate::CapabilityStatus::Available
        );

        let connected_swarm_peer = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let (state, peers) = torrent_swarm_view(&first, &torrent_id).await;
                assert_eq!(state, SwarmCatalogState::Active);
                if let Some(peer) = peers
                    .into_iter()
                    .find(|peer| peer.endpoint == peer_endpoint.to_string())
                {
                    break peer;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("incoming peer reaches the Swarm projection");
        assert_eq!(connected_swarm_peer.sources, [PeerSourceView::Incoming]);
        assert_eq!(connected_swarm_peer.state, SwarmPeerState::Connected);
        assert!(!connected_swarm_peer.connectable);
        assert_eq!(connected_swarm_peer.payload_downloaded_bytes, "0");
        assert!(
            connected_swarm_peer
                .payload_uploaded_bytes
                .parse::<u64>()
                .expect("exact live Swarm upload total")
                >= 3
        );

        let handover_port = available_port_on(Ipv4Addr::LOCALHOST)
            .await
            .expect("find incoming handover port");
        let handover_settings = ClientSettings {
            listener: ListenerPolicy::FixedLoopback {
                port: handover_port,
            },
            preferred_listen_port: preferred_port,
            port_mapping: crate::PortMappingPolicy::Disabled,
            peer_connection_limit: 1,
            upload_slots: 1,
            active_downloads: 3,
            upload_rate_limit: Default::default(),
            download_rate_limit: Default::default(),
            encryption: Default::default(),
            ipv6_enabled: true,
            tracker_https_server_authentication: Default::default(),
            ..ClientSettings::default()
        };
        first
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "handover-established-incoming-upload".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: handover_settings.clone().into(),
                },
            })
            .await
            .expect("handover established incoming upload");
        wait_for_client_settings(&first, |runtime| {
            runtime.configured == handover_settings
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        let handover_snapshot = first
            .incoming_peer_snapshot()
            .expect("incoming runtime remains active after handover");
        assert_eq!(handover_snapshot.listen_address.port(), handover_port);
        assert_eq!(handover_snapshot.registrations, 1);
        assert_eq!(handover_snapshot.established, 1);
        assert_eq!(handover_snapshot.payload_bytes_sent, 3);
        peer.write_all(
            &encode_message(&PeerMessage::Request(
                rstorrent_protocol::peer_wire::BlockRequest {
                    index: 0,
                    begin: 0,
                    length: 4,
                },
            ))
            .expect("encode post-handover payload request"),
        )
        .await
        .expect("send post-handover payload request");
        assert_eq!(
            read_peer_message(&mut peer, &mut decoder, &mut pending).await,
            PeerMessage::Piece {
                index: 0,
                begin: 0,
                block: b"abcd".to_vec(),
            }
        );
        TcpStream::connect((Ipv4Addr::LOCALHOST, handover_port))
            .await
            .expect("replacement listener accepts");
        assert!(TcpStream::connect(listener_endpoint).await.is_err());
        assert_eq!(
            first
                .incoming_peer_snapshot()
                .expect("incoming runtime remains observable")
                .payload_bytes_sent,
            7
        );

        drop(peer);
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if torrent_peer_views(&first, &torrent_id).await.is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("closed incoming peer leaves the Peers projection");
        let closed_swarm_peer = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let (_, peers) = torrent_swarm_view(&first, &torrent_id).await;
                if let Some(peer) = peers.into_iter().find(|peer| {
                    peer.endpoint == peer_endpoint.to_string()
                        && peer.state == SwarmPeerState::NotConnectable
                }) {
                    break peer;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("closed incoming peer remains as non-connectable swarm history");
        assert_eq!(closed_swarm_peer.sources, [PeerSourceView::Incoming]);
        assert!(!closed_swarm_peer.connectable);
        assert_eq!(closed_swarm_peer.payload_downloaded_bytes, "0");
        assert_eq!(closed_swarm_peer.payload_uploaded_bytes, "7");
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                first
                    .maintain_accounting(true)
                    .expect("force exact accounting checkpoint");
                if first
                    .store_mut()
                    .unwrap()
                    .load_resume(&torrent_id)
                    .unwrap()
                    .accounting
                    .total_uploaded
                    == 7
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("final incoming payload reaches durable accounting");
        assert_eq!(
            first
                .accounting_high_water()
                .unwrap()
                .uncommitted_payload_bytes,
            7
        );

        let zero_slots = ClientSettings {
            upload_slots: 0,
            active_downloads: 3,
            upload_rate_limit: Default::default(),
            download_rate_limit: Default::default(),
            ..handover_settings
        };
        first
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "configure-zero-upload-slots".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: zero_slots.clone().into(),
                },
            })
            .await
            .expect("persist zero upload slots");
        let configured = wait_for_client_settings(&first, |runtime| {
            runtime.effective_upload_slots == 0
                && runtime.upload_slots_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(configured.configured, zero_slots);
        assert_eq!(configured.effective_upload_slots, 0);
        assert_eq!(
            configured.upload_slots_application,
            crate::ClientSettingsApplicationState::Applied
        );
        assert_eq!(
            configured.configured.active_seeds,
            crate::ActiveSeedLimit::Limited { torrents: 5 }
        );
        assert!(first.admitted_seeds.contains(&torrent_id));
        assert!(
            first
                .torrent_runtimes
                .get(&torrent_id)
                .unwrap()
                .handle()
                .has_current_seed_registration(&first.session_network().incoming_seeding())
        );
        let mut second = first;
        let second_runtime = client_settings_runtime(&second).await;
        assert_eq!(second_runtime.configured, zero_slots);
        assert_eq!(second_runtime.effective_upload_slots, 0);
        assert_eq!(
            second_runtime.upload_slots_application,
            crate::ClientSettingsApplicationState::Applied
        );
        wait_for_seed_registrations(&second, 1).await;
        let runtime_generation = second
            .torrent_runtimes
            .get(&torrent_id)
            .expect("complete torrent owns one runtime")
            .generation();
        let (mut choked_peer, mut choked_decoder, mut choked_pending) =
            connect_application_seed(&second, info_hash, *b"-RS-CHOKED--00000000").await;
        choked_peer
            .write_all(&encode_message(&PeerMessage::Interested).expect("encode interested"))
            .await
            .expect("send zero-slot interest");
        assert!(
            tokio::time::timeout(
                Duration::from_millis(100),
                read_peer_message(&mut choked_peer, &mut choked_decoder, &mut choked_pending,),
            )
            .await
            .is_err(),
            "zero upload slots must not unchoke an interested peer"
        );
        let choked_snapshot = second
            .incoming_peer_snapshot()
            .expect("incoming service remains active");
        assert_eq!(choked_snapshot.upload_scheduler.interested, 1);
        assert_eq!(choked_snapshot.upload_scheduler.regular, 0);
        assert_eq!(choked_snapshot.upload_scheduler.optimistic, 0);
        drop(choked_peer);
        let (mut archived_peer, _, _) =
            connect_application_seed(&second, info_hash, *b"-RS-ARCHIVE-00000000").await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "archive-seed".to_owned(),
                expected_revision: None,
                command: Command::Archive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("archive seed");
        assert_eq!(
            archived_peer
                .read(&mut [0; 1])
                .await
                .expect("observe archive close"),
            0
        );
        wait_for_seed_registrations(&second, 0).await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "restore-seed".to_owned(),
                expected_revision: None,
                command: Command::RestoreArchive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("restore seed");
        wait_for_seed_registrations(&second, 0).await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "resume-restored-seed".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("resume restored seed");
        wait_for_seed_registrations(&second, 1).await;
        assert_eq!(
            second
                .torrent_runtimes
                .get(&torrent_id)
                .expect("restored seed retains its runtime")
                .generation(),
            runtime_generation
        );

        let (mut recheck_peer, _, _) =
            connect_application_seed(&second, info_hash, *b"-RS-RECHECK-00000000").await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "recheck-seed".to_owned(),
                expected_revision: None,
                command: Command::ForceRecheck {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("force recheck seed");
        assert_eq!(
            recheck_peer
                .read(&mut [0; 1])
                .await
                .expect("observe recheck close"),
            0
        );
        // Force checker termination before any application maintenance. A
        // persisted Complete snapshot can precede completed-seed admission.
        tokio::time::timeout(Duration::from_secs(5), async {
            while !second
                .active_download_for(&torrent_id)
                .expect("recheck generation awaits application maintenance")
                .task
                .is_finished()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("recheck generation termination deadline");
        assert_eq!(
            second
                .store_mut()
                .unwrap()
                .load_resume(&torrent_id)
                .unwrap()
                .state,
            TorrentState::Complete,
        );
        assert_eq!(second.incoming_peer_snapshot().unwrap().registrations, 0);
        // This directly owned service has no background maintenance owner.
        // Drive the ordinary command path after termination to join the
        // checker and restore admission before observing its registration.
        wait_for_torrent_state(
            &mut second,
            &torrent_id,
            TorrentState::Complete,
            "rechecked-seed-complete",
        )
        .await;
        wait_for_seed_registrations(&second, 1).await;
        assert_eq!(
            second
                .torrent_runtimes
                .get(&torrent_id)
                .expect("rechecked seed retains its runtime")
                .generation(),
            runtime_generation
        );

        let (mut paused_peer, _, _) =
            connect_application_seed(&second, info_hash, *b"-RS-PAUSED--00000000").await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-seed".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("pause seed");
        assert_eq!(
            paused_peer
                .read(&mut [0; 1])
                .await
                .expect("observe pause close"),
            0
        );
        wait_for_seed_registrations(&second, 0).await;
        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "resume-seed".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .await
            .expect("resume seed");
        wait_for_seed_registrations(&second, 1).await;
        assert_eq!(
            second
                .torrent_runtimes
                .get(&torrent_id)
                .expect("resumed seed retains its runtime")
                .generation(),
            runtime_generation
        );

        second
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-seed".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.clone(),
                    data: RemovalDataPolicy::Keep,
                },
            })
            .await
            .expect("remove seed");
        wait_for_seed_registrations(&second, 0).await;
        assert!(!second.torrent_runtimes.contains_key(&torrent_id));
        let terminal = second
            .incoming_peer_snapshot()
            .expect("incoming service remains enabled");
        assert_eq!(terminal.pending, 0);
        assert_eq!(terminal.established, 0);
        assert_eq!(terminal.reads, 0);
        second.shutdown().await.expect("shutdown second lifetime");
        drop(second);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn application_incoming_bootstrap_is_disabled_or_exactly_fixed() {
        let disabled_root = test_root("incoming-disabled");
        let mut disabled = ApplicationService::open(config(&disabled_root))
            .await
            .expect("open disabled incoming service");
        assert!(disabled.incoming_peer_snapshot().is_none());
        assert_eq!(
            client_settings_runtime(&disabled).await.listener_status,
            ListenerStatus::Disabled
        );
        disabled
            .shutdown()
            .await
            .expect("shutdown disabled service");
        drop(disabled);
        fs::remove_dir_all(disabled_root).expect("remove disabled root");

        let ineligible_root = test_root("incoming-loopback-upnp-ineligible");
        let ineligible_config = config(&ineligible_root);
        persist_client_settings(
            &ineligible_config,
            ClientSettings {
                listener: ListenerPolicy::AutomaticLoopback,
                port_mapping: crate::PortMappingPolicy::Upnp,
                ..ClientSettings::default()
            },
        );
        let mut ineligible = ApplicationService::open(ineligible_config)
            .await
            .expect("open ineligible loopback mapping policy");
        assert_eq!(
            client_settings_runtime(&ineligible)
                .await
                .port_mapping_status,
            crate::PortMappingStatus::Ineligible
        );
        let mapping_disabled = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            port_mapping: crate::PortMappingPolicy::Disabled,
            ..ClientSettings::default()
        };
        ineligible
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "disable-ineligible-live-mapping".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: mapping_disabled.clone().into(),
                },
            })
            .await
            .expect("disable mapping live");
        let disabled_mapping = wait_for_client_settings(&ineligible, |runtime| {
            runtime.configured == mapping_disabled
                && runtime.port_mapping_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.port_mapping_status == crate::PortMappingStatus::Disabled
        })
        .await;
        assert_eq!(
            disabled_mapping.effective_port_mapping,
            crate::PortMappingPolicy::Disabled
        );
        let mapping_enabled = ClientSettings {
            port_mapping: crate::PortMappingPolicy::Upnp,
            ..mapping_disabled
        };
        ineligible
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "reenable-ineligible-live-mapping".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: mapping_enabled.clone().into(),
                },
            })
            .await
            .expect("reenable mapping live");
        let enabled_mapping = wait_for_client_settings(&ineligible, |runtime| {
            runtime.configured == mapping_enabled
                && runtime.port_mapping_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.port_mapping_status == crate::PortMappingStatus::Ineligible
        })
        .await;
        assert_eq!(
            enabled_mapping.effective_port_mapping,
            crate::PortMappingPolicy::Upnp
        );
        ineligible
            .shutdown()
            .await
            .expect("shutdown ineligible app");
        drop(ineligible);
        fs::remove_dir_all(ineligible_root).expect("remove ineligible root");

        let fixed_root = test_root("incoming-fixed-conflict");
        let blocker = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind incoming port blocker");
        let port = blocker.local_addr().expect("blocker address").port();
        let mut configuration = config(&fixed_root);
        configuration.peer_budget_max_open_files_for_testing = Some(25);
        persist_client_settings(
            &configuration,
            ClientSettings {
                listener: ListenerPolicy::FixedLoopback { port },
                ..ClientSettings::default()
            },
        );
        let mut conflicted = ApplicationService::open(configuration.clone())
            .await
            .expect("fixed bind conflict keeps application available");
        let active_incoming = conflicted.incoming_peer_snapshot();
        let runtime = client_settings_runtime(&conflicted).await;
        let ipv6_listener = runtime
            .transport_families
            .iter()
            .find(|family| family.family == crate::TransportAddressFamily::Ipv6)
            .and_then(|family| family.tcp_endpoint.as_ref());
        assert_eq!(active_incoming.is_some(), ipv6_listener.is_some());
        if let Some(active_incoming) = active_incoming {
            assert!(active_incoming.listen_address.is_ipv6());
        }
        assert_eq!(runtime.effective_listener, None);
        assert!(matches!(
            runtime.transport_application,
            crate::ClientSettingsApplicationState::Degraded {
                reason: crate::ClientSettingsDegradedReason::TransportBindFailed,
                ..
            }
        ));
        assert!(matches!(
            runtime.listener_status,
            ListenerStatus::BindFailed {
                reason: ListenerBindFailureReason::AddressInUse,
                ref detail,
            } if !detail.is_empty() && detail.len() <= 512
        ));
        assert!(matches!(
            runtime.session_udp_status,
            crate::SessionUdpStatus::Bound {
                port: active_udp_port,
                coordinated_with_tcp: false,
                ..
            } if active_udp_port != 0
        ));
        let diagnostics = conflicted
            .subscribe(SubscriptionSpec {
                selector: ViewSelector::TorrentList,
                projection: ViewProjection::Diagnostics,
                delivery: DeliveryPolicy {
                    min_interval_millis: 0,
                    max_queue_bytes: 256 * 1024,
                },
                diagnostics: Some(DiagnosticFilter::default()),
                catalog_page: None,
            })
            .expect("subscribe to bind diagnostics")
            .next_update()
            .await
            .expect("bind diagnostic snapshot");
        let diagnostics = serde_json::to_string(&diagnostics).expect("encode bind diagnostics");
        assert!(diagnostics.contains("incoming_listener_bind_failed"));
        assert!(diagnostics.contains("address_in_use"));

        let repaired = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            preferred_listen_port: port,
            port_mapping: crate::PortMappingPolicy::Disabled,
            peer_connection_limit: 321,
            upload_slots: 0,
            active_downloads: 3,
            upload_rate_limit: Default::default(),
            download_rate_limit: Default::default(),
            encryption: Default::default(),
            ipv6_enabled: true,
            tracker_https_server_authentication: Default::default(),
            ..ClientSettings::default()
        };
        let response = conflicted
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "repair-fixed-listener".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: repaired.clone().into(),
                },
            })
            .await
            .expect("repair listener settings through command path");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        let configured = wait_for_client_settings(&conflicted, |runtime| {
            runtime.configured == repaired
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && runtime.peer_connections_application
                    == crate::ClientSettingsApplicationState::Applied
                && runtime.upload_slots_application
                    == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(configured.configured, repaired);
        assert_eq!(
            configured.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(&repaired))
        );
        assert_eq!(configured.effective_peer_connection_limit, 5);
        assert_eq!(configured.effective_upload_slots, 0);
        let incoming = conflicted
            .incoming_peer_snapshot()
            .expect("automatic listener starts through live repair");
        assert_eq!(
            incoming.listen_address.ip(),
            "127.0.0.1".parse::<IpAddr>().unwrap()
        );
        assert_ne!(incoming.listen_address.port(), 0);
        assert_eq!(incoming.peer_budget.configured_limit, 321);
        assert_eq!(incoming.peer_budget.effective_limit, 5);
        assert_eq!(incoming.peer_budget.incoming_slack, 10);
        let automatic_port = incoming.listen_address.port();
        let fixed = ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port },
            ..repaired.clone()
        };
        conflicted
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "select-blocked-fixed-listener".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: fixed.clone().into(),
                },
            })
            .await
            .expect("select blocked fixed port");
        let blocked_fixed = wait_for_client_settings(&conflicted, |runtime| {
            runtime.configured == fixed
                && matches!(
                    runtime.transport_application,
                    crate::ClientSettingsApplicationState::Degraded {
                        reason: crate::ClientSettingsDegradedReason::TransportBindFailed,
                        ..
                    }
                )
        })
        .await;
        assert_eq!(
            blocked_fixed.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(&repaired))
        );
        assert_eq!(
            blocked_fixed.listener_status,
            ListenerStatus::Listening {
                address: "127.0.0.1".to_owned(),
                port: automatic_port,
            }
        );
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, automatic_port))
                .await
                .is_ok()
        );

        drop(blocker);
        conflicted
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "retry-released-fixed-listener".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: fixed.clone().into(),
                },
            })
            .await
            .expect("retry unchanged fixed settings");
        let runtime = wait_for_client_settings(&conflicted, |runtime| {
            runtime.configured == fixed
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
                && matches!(
                    runtime.listener_status,
                    ListenerStatus::Listening {
                        port: active_port,
                        ..
                    } if active_port == port
                )
        })
        .await;
        let incoming = conflicted
            .incoming_peer_snapshot()
            .expect("fixed listener starts after same-value retry");
        assert_eq!(incoming.listen_address.port(), port);
        assert_eq!(runtime.configured, fixed);
        assert_eq!(
            runtime.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(&fixed))
        );
        assert_eq!(
            runtime.transport_application,
            crate::ClientSettingsApplicationState::Applied
        );
        assert_eq!(
            runtime.listener_status,
            ListenerStatus::Listening {
                address: "127.0.0.1".to_owned(),
                port,
            }
        );
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, automatic_port))
                .await
                .is_err()
        );
        let fixed_future_preference = ClientSettings {
            preferred_listen_port: 6_882,
            ..fixed.clone()
        };
        let udp_generation = conflicted.session_network().session_udp_generation();
        conflicted
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "change-fixed-future-preference".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: fixed_future_preference.clone().into(),
                },
            })
            .await
            .expect("change fixed listener future preference");
        let runtime = wait_for_client_settings(&conflicted, |runtime| {
            runtime.configured == fixed_future_preference
                && runtime.transport_application == crate::ClientSettingsApplicationState::Applied
        })
        .await;
        assert_eq!(
            runtime.effective_listener,
            Some(crate::EffectiveListenerSettings::from_settings(
                &fixed_future_preference
            ))
        );
        assert!(matches!(
            runtime.listener_status,
            ListenerStatus::Listening { port: active, .. } if active == port
        ));
        assert_eq!(
            conflicted.session_network().session_udp_generation(),
            udp_generation,
            "fixed future preference must not churn transport"
        );
        conflicted
            .shutdown()
            .await
            .expect("shutdown live-reconfigured service");
        drop(conflicted);
        fs::remove_dir_all(fixed_root).expect("remove fixed-conflict root");
    }
}
