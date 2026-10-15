#![forbid(unsafe_code)]

//! Durable application control and torrent-session ownership.

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();

mod accounting;
mod advertised_endpoint;
mod application;
mod application_connection;
mod auto_manager;
mod catalog_recovery;
mod control;
mod dht_views;
mod diagnostics;
mod download_queue;
mod durable_state;
mod file_views;
pub mod foreground_download;
mod have;
mod host_capabilities;
mod incoming_seeding;
mod library_views;
mod media;
mod media_catalog_views;
mod product_state;
mod profile_reset;
mod reachability;
mod seed_policy;
mod session_network;
mod session_utp;
mod settings;
mod share_peer_hints;
mod shutdown;
mod speed;
mod store;
mod store_migration;
mod store_schema;
mod torrent_list;
pub use torrent_list::MAX_BUNDLE_BYTES as MAX_TORRENT_LIST_BUNDLE_BYTES;
mod torrent_runtime;
mod tracker_views;
mod views;

pub use application::{
    ApplicationConfig, ApplicationError, ApplicationPersistence, ApplicationService,
    CompletedMediaCapability, PathRootStartupPolicy, PlatformFilePlan, PlatformRemovalPath,
    PlatformRemovalPlan, PlatformStorageDetach, ProductIdentity, application_error_response,
    source_build_id,
};
pub use application_connection::{
    AcknowledgedViewStream, AcknowledgedViewStreamError, ApplicationCall, ApplicationCallError,
    ApplicationCallResult,
};
pub use catalog_recovery::{
    CatalogExportError, CatalogRecoveryReason, CatalogRecoveryStatus, diagnose_catalog,
    export_torrent_list_read_only,
};
pub use control::{
    AddTorrentBytesRequest, AddTorrentDisposition, AddTorrentResult, CONTROL_VERSION, Command,
    CommandResult, ErrorCode, ErrorResponse, FileIndexRange, FilePriority, FileSelectionIntent,
    FileSelectionOverride, MAX_ROOT_ID_LENGTH, MAX_ROOT_LABEL_LENGTH, MagnetExportOptions,
    MagnetExportResult, MagnetExportSource, MagnetPeerHint, MagnetPeerHintOmission,
    MagnetPeerHintScope, PendingFileSelectionBase, RemovalDataPolicy, RemovalState,
    RequestEnvelope, ResponseEnvelope, ResponseOutcome, ServiceSnapshot, StorageState,
    TorrentListImportFailure, TorrentListImportReport, TorrentListImportTarget,
    TorrentProtocolIdentities, TorrentSnapshot, TorrentState, validate_add_torrent_bytes_request,
};
pub use diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticField, DiagnosticFilter, DiagnosticProfile,
    DiagnosticRetention, DiagnosticSeverity, DiagnosticSubject, DiagnosticValue,
};
pub use file_views::{FileCatalogState, FileSelectionView, FileView};
pub use have::{HaveError, HaveState};
pub use host_capabilities::{
    CLIENT_IDENTITY, HOST_CAPABILITIES, HostCapability, HostCapabilityDefinition,
    HostCapabilityLifecycle, MAGNET_EXPORT_OPTIONS, SEED_STOP_LIMITS, host_capability_definitions,
};
pub use library_views::{
    DEFAULT_LIBRARY_PAGE_ROWS, LibraryArchivedFilter, LibraryAvailabilityFilter, LibraryFacetsView,
    LibraryGroupView, LibraryGrouping, LibraryMediaItemView, LibraryMediaKind, LibraryMediaQuery,
    LibraryMediaRole, LibraryMediaSort, MAX_LIBRARY_PAGE_ROWS,
};
pub use media::{
    MAX_MEDIA_CAPABILITIES, MAX_MEDIA_READ_JOBS, MAX_MEDIA_REQUESTS,
    MAX_MEDIA_REQUESTS_PER_CAPABILITY, MEDIA_CAPABILITY_ABSOLUTE_TIMEOUT,
    MEDIA_CAPABILITY_IDLE_TIMEOUT, MEDIA_CAPABILITY_LENGTH, MEDIA_STREAMING_NO_PROGRESS_TIMEOUT,
    MediaCapabilityLease, MediaFileAvailability, MediaOriginError, MediaRangeError, MediaReadError,
    MediaResolveError, MediaResourceSnapshot, MediaUrlOutcome, MediaUrlResponse,
};
pub use media_catalog_views::{MediaCatalogState, MediaItemView, MediaRoleView};
pub use product_state::{
    CURRENT_PRODUCT_DISCLOSURE_VERSION, DesktopShellPreferences, MAX_PRODUCT_FEEDBACK_URL_BYTES,
    MAX_PRODUCT_SOURCES, PRODUCT_FEEDBACK_URL, PRODUCT_PRIVACY_URL, ProductFeedbackEnvironment,
    ProductFeedbackField, ProductFeedbackPlatform, ProductFeedbackPreview, ProductMilestone,
    ProductMilestoneKind, ProductStateError, ProductStateOwner, ProductStatePageUsage,
    ProductStateStore, ProductSummary, build_product_feedback_preview,
};
pub use profile_reset::ProfileResetReport;
pub use reachability::Ipv6PinholeDiagnosticResult;
pub use rstorrent_engine::{
    ApplicationNetworkPrerequisite, DownloadResourceLimits, IncomingPeerServiceSnapshot,
    IncomingTcpBootstrap, NetworkConfig, NetworkPolicy, NetworkPrerequisiteError,
    NetworkPrerequisiteHandle, NetworkPrerequisiteSnapshot, PeerTransportPolicy,
};
pub use settings::{
    ActiveDownloadsClampReason, ActiveSeedLimit, AdvertisedPeerEndpointScope,
    AdvertisedPeerEndpointStatus, AdvertisedPeerEndpointUnavailableReason,
    ApplicationNetworkPrerequisiteView, ApplicationNetworkRuntimeState,
    ApplicationNetworkRuntimeView, BandwidthDirectionRuntimeView, BandwidthRuntimeView,
    ClientSettings, ClientSettingsApplicationState, ClientSettingsDegradedReason,
    ClientSettingsError, ClientSettingsPatch, ClientSettingsRuntimeView, DEFAULT_ACTIVE_DOWNLOADS,
    DEFAULT_ACTIVE_SEEDS, DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT,
    DEFAULT_FINISHED_TIME_LIMIT_SECONDS, DEFAULT_SHARE_RATIO_LIMIT_PERCENT,
    EffectiveListenerSettings, EncryptionPolicy, HttpsServerAuthenticationPolicy,
    Ipv6PinholeFailureStage, Ipv6PinholeStatus, ListenerBindFailureReason, ListenerPolicy,
    ListenerStatus, MAX_ACTIVE_DOWNLOADS, MAX_ACTIVE_SEEDS, MAX_SEED_GOAL_VALUE,
    MIN_ACTIVE_DOWNLOADS, PortMappingFailureStage, PortMappingMechanism, PortMappingPolicy,
    PortMappingStatus, SeedStopLimit, SessionUdpStatus, StorageRootAvailability,
    StorageRootSnapshot, StorageSettingsSnapshot, TorrentSeedStopLimit, TorrentSeedStopLimits,
    TorrentSettingsPatch, TorrentTransferLimits, TransferRateLimit, TransportAddressFamily,
    TransportFamilyRuntimeView,
};
pub use shutdown::{
    DEFAULT_NETWORK_CLEANUP_BUDGET, ShutdownOptions, ShutdownProgress, ShutdownProgressSink,
};
pub use speed::{
    SessionCurrentRatesView, SpeedCurrentRate, SpeedHistoryAppend, SpeedHistoryAppendError,
    SpeedHistoryView, SpeedMetric, SpeedMetricAvailability, SpeedPersistenceState, SpeedRange,
    SpeedSeriesAppend, SpeedSeriesView,
};
pub use store::{
    ConfiguredStorageRoot, LegacyAndroidBootstrap, LegacyAndroidRootBinding,
    LegacyDesktopImportReport, LegacyDesktopRecordOutcome, MAX_STORAGE_ROOT_LOCATOR_LENGTH,
    MAX_STORAGE_ROOTS, RemovalRecord, ResumeRecord, SessionStore, StorageRootLocation, StoreError,
    StoredStorageRoot, StoredTracker, StoredTrackerSource, StoredTrackerTransport,
    TorrentAccounting,
};
pub use tracker_views::{
    TrackerAnnounceEventView, TrackerCatalogState, TrackerConnectionFamilyView,
    TrackerNextActionView, TrackerSecurityView, TrackerSourceView, TrackerStatusView,
    TrackerTransportView, TrackerView,
};
pub use views::{
    API_VERSION, ActivePiece, ActivePieceFieldUpdate, ActivePieceStageView, ActivePieceUpdate,
    ApiBackendIdentity, ApiClientInfo, ApiEncoding, ApiHello, ApiLimits, ApiProductInfo,
    ApiVersion, CapabilityStatus, CatalogPageRequest, CatalogPageView, CheckingPhaseView,
    CheckingProgressView, DeliveryMode, DeliveryPolicy, DhtAddressFamilyView, DhtBucketView,
    DhtFamilyInspectionView, DhtInspectionView, DhtLifecycleView, DhtLookupView,
    DhtNetworkPolicyView, DiskCheckpointStageView, DiskPieceStageView, DiskPieceView,
    DiskPipelineView, DiskPressureView, FileFieldUpdate, FileRowUpdate, IndexRange,
    IntegrityPreparationPhaseView, IntegrityPreparationView, MetadataAcquisitionPhaseView,
    MetadataAcquisitionView, OpenViewSetOptions, OpenViewSetRequest, OpenViewSetResponse,
    PeerDirection, PeerDisconnectReason, PeerFieldCapabilities, PeerFieldUpdate, PeerFlagView,
    PeerLifecycle, PeerMseMethodView, PeerRequestPhase, PeerRole, PeerRowUpdate, PeerSourceView,
    PeerTransportKind, PeerView, ProgressAction, ProgressAssessment, ProgressDisposition,
    ProgressInputs, ProgressPhase, ProgressReason, ResetReason, RowUpdateError, SeedAdmissionView,
    SeedGoalStatusView, SeedGoalView, SeedStopView, SubscriptionError, SubscriptionSpec,
    SubscriptionStats, SwarmCatalogState, SwarmCountsView, SwarmPeerState, SwarmPeerView,
    TorrentEtaView, TorrentFieldUpdate, TorrentLifetimeView, TorrentOperationalState,
    TorrentPreparationView, TorrentRowUpdate, TorrentSeedingView, TorrentView, TorrentViewChange,
    UpdateBatch, UpdateViewSetRequest, VIEW_CONTRACT_VERSION, ViewDeliveryPolicy, ViewHub,
    ViewPatch, ViewProjection, ViewSelector, ViewSet, ViewSetError, ViewSetOwner, ViewSetStats,
    ViewSetUpdate, ViewSnapshot, ViewSpec, ViewSubscription, ViewUpdate, ViewUpdatePayload,
    assess_progress, deserialize_client_info,
};
