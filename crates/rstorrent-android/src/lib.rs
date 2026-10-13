//! Coarse Android control plane for an in-process RSTorrent engine.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::net::{Ipv4Addr, SocketAddr};
#[cfg(unix)]
use std::os::fd::FromRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rstorrent_engine::{
    DescriptorFile, DescriptorFileRole, DescriptorStorage, DescriptorStoragePlan, DownloadConfig,
    DownloadControl, DownloadError, DownloadProgress, DownloadReport, DownloadResourceLimits,
    NetworkConfig, NetworkPolicy, PlatformStorageBroker, PlatformStorageFailure,
    PlatformStorageFailureKind, PlatformStorageOperation, StorageFileAccess, StorageFileRole,
    StorageObjectKind, StorageObservation, TorrentId, TorrentIdentityContext,
    download_verified_piece_to_descriptors_with_control, download_verified_piece_with_control,
    plan_descriptor_storage, platform_storage_channel,
};
use rstorrent_gateway::{CompanionPairingOwner, CompanionPlatformOwner};
use rstorrent_media::LoopbackMediaServer;
use rstorrent_protocol::identity::V1InfoHash;
use rstorrent_protocol::metainfo::{BEP9_METAINFO_LIMITS, Metainfo};
use rstorrent_session::{
    AddTorrentBytesRequest, ApplicationConfig, ApplicationNetworkPrerequisite, ApplicationService,
    ConfiguredStorageRoot, LegacyAndroidRootBinding, MAX_STORAGE_ROOTS, MediaUrlResponse,
    NetworkPrerequisiteHandle, PathRootStartupPolicy, PlatformRemovalPlan,
    ProductFeedbackEnvironment, ProductFeedbackPreview, ProductStateOwner, ProductSummary,
    RequestEnvelope, ResponseEnvelope, SessionStore, StorageRootSnapshot, StorageSettingsSnapshot,
    SubscriptionSpec, ViewSubscription, ViewUpdate, build_product_feedback_preview,
};
use sha1::{Digest, Sha1};
use tokio::sync::{Mutex as AsyncMutex, watch};
use tokio::task::JoinHandle as TaskJoinHandle;
use tokio_util::sync::CancellationToken;

const INTERFACE_VERSION: &str = "rstorrent-android/0.5.0;uniffi/0.31.0";
const MIN_PAYLOAD_BYTES: u64 = 16 * 1024;
const MAX_PAYLOAD_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS: u64 = 5 * 60;
const MAX_JOIN_MILLIS: u64 = 5 * 60 * 1_000;
const MAX_FILE_SELECTIONS: usize = 1_024;
const MAX_STORAGE_WRITE_DELAY_MILLIS: u64 = 5_000;
const DESCRIPTOR_HASH_BUFFER: usize = 16 * 1024;
const MAX_ANDROID_PATH_BYTES: usize = 4 * 1024;
// Hosted privacy, forms and bounded parser verified in Tactical 321.
const HOSTED_PRODUCT_CONTEXT_READY: bool = true;

uniffi::setup_scaffolding!();

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_org_rstorrent_bootstrap_PlatformTrustBootstrap_initializeNative<
    'local,
>(
    mut unowned_env: jni::EnvUnowned<'local>,
    _class: jni::objects::JClass<'local>,
    context: jni::objects::JObject<'local>,
) {
    unowned_env
        .with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<jni::errors::ThrowRuntimeExAndDefault>();
}

/// Private startup boundary, before any engine/session owner exists.
#[uniffi::export]
pub fn migrate_legacy_android(
    profile_root: String,
    source_database: String,
    source_files: String,
    snapshot_directory: String,
    preferences_json: String,
    current_bindings_json: String,
) -> Result<String, AndroidClientError> {
    if current_bindings_json.len() > 1024 * 1024 {
        return Err(AndroidClientError::message("legacy bindings exceed bound"));
    }
    let bindings: Vec<LegacyAndroidRootBinding> = serde_json::from_str(&current_bindings_json)
        .map_err(|_| AndroidClientError::message("invalid legacy bindings"))?;
    let result = SessionStore::migrate_legacy_android(
        &android_path(profile_root, "profile root")?,
        "default",
        &android_path(source_database, "source database")?,
        &android_path(source_files, "source files")?,
        &android_path(snapshot_directory, "snapshot directory")?,
        &preferences_json,
        &bindings,
    )
    .map_err(|error| AndroidClientError::message(error.to_string()))?;
    serde_json::to_string(&result)
        .map_err(|_| AndroidClientError::message("invalid migration result"))
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidApplicationConfig {
    pub product_data_root: String,
    pub product_version: String,
    pub profile_root: String,
    pub profile_id: String,
    pub storage_root: String,
    pub platform_storage: bool,
    pub platform_storage_roots: Vec<AndroidPlatformStorageRoot>,
    pub network_policy: AndroidNetworkPolicy,
    pub initial_network_prerequisite: AndroidApplicationNetworkPrerequisite,
    pub peer_connect_timeout_seconds: u64,
    pub peer_io_timeout_seconds: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidPlatformStorageRoot {
    pub root_id: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, uniffi::Enum)]
pub enum AndroidNetworkPolicy {
    Offline,
    LoopbackOnly,
    Online,
}

#[derive(Clone, Copy, Debug, uniffi::Enum)]
pub enum AndroidApplicationNetworkPrerequisite {
    Allowed,
    WaitingForUnmeteredNetwork,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidNetworkPrerequisiteResult {
    pub requested_generation: String,
    pub effective_generation: String,
    pub allowed: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidMseDhWorkSnapshot {
    pub waiting: u64,
    pub active: u64,
    pub high_water: u64,
    pub tracked: u64,
    pub closed: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidDownloadResourceSnapshot {
    pub registered_generations: u64,
    pub registered_generations_high_water: u64,
    pub outstanding_request_bytes: u64,
    pub outstanding_request_high_water: u64,
    pub buffered_payload_bytes: u64,
    pub buffered_payload_high_water: u64,
    pub active_piece_bytes: u64,
    pub active_piece_bytes_high_water: u64,
    pub active_pieces: u64,
    pub active_pieces_high_water: u64,
    pub active_storage_writes: u64,
    pub active_storage_writes_high_water: u64,
    pub active_storage_hashes: u64,
    pub active_storage_hashes_high_water: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidIncomingRejectionCount {
    pub reason: String,
    pub count: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidIncomingRejection {
    pub reason: String,
    pub info_hash: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidIncomingPeerSnapshot {
    pub listen_port: u16,
    pub registrations: u64,
    pub pending: u64,
    pub established: u64,
    pub payload_bytes_sent: u64,
    pub rejection_counts: Vec<AndroidIncomingRejectionCount>,
    pub rejection_counts_truncated: bool,
    pub recent_rejections: Vec<AndroidIncomingRejection>,
    pub recent_rejections_truncated: bool,
}

fn incoming_peer_snapshot_view(
    snapshot: rstorrent_engine::IncomingPeerServiceSnapshot,
) -> AndroidIncomingPeerSnapshot {
    AndroidIncomingPeerSnapshot {
        listen_port: snapshot.listen_address.port(),
        registrations: snapshot.registrations as u64,
        pending: snapshot.pending as u64,
        established: snapshot.established as u64,
        payload_bytes_sent: snapshot.payload_bytes_sent,
        rejection_counts_truncated: snapshot.rejection_counts.len() > 32,
        rejection_counts: snapshot
            .rejection_counts
            .into_iter()
            .take(32)
            .map(|(reason, count)| AndroidIncomingRejectionCount {
                reason: format!("{reason:?}"),
                count,
            })
            .collect(),
        recent_rejections_truncated: snapshot.recent_rejections.len() > 4,
        recent_rejections: snapshot
            .recent_rejections
            .into_iter()
            .rev()
            .take(4)
            .map(|entry| AndroidIncomingRejection {
                reason: format!("{:?}", entry.reason),
                info_hash: entry.info_hash.map(|hash| hex(&hash)),
            })
            .collect(),
    }
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidCompanionPairingPending {
    pub request_id: String,
    pub extension_id: String,
    pub extension_name: String,
    pub installation_id: String,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidCompanionRootRequest {
    pub request_id: String,
    pub repair_root: Option<String>,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct AndroidCompanionRootRemovalRequest {
    pub request_id: String,
    pub application_request: RequestEnvelope,
    pub expires_in_seconds: u64,
}

#[derive(Debug, uniffi::Error)]
pub enum AndroidClientError {
    Failure { detail: String },
}

impl std::fmt::Display for AndroidClientError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failure { detail } => formatter.write_str(detail),
        }
    }
}

impl std::error::Error for AndroidClientError {}

impl AndroidClientError {
    fn message(message: impl Into<String>) -> Self {
        Self::Failure {
            detail: message.into(),
        }
    }
}

#[derive(Debug, uniffi::Object)]
pub struct AndroidApplicationClient {
    service: Arc<AsyncMutex<ApplicationService>>,
    product_state: ProductStateOwner,
    product_version: String,
    network_prerequisite: NetworkPrerequisiteHandle,
    shutdown: AtomicBool,
    platform_storage: Arc<PlatformStorageBroker>,
    companion_pairings: Arc<CompanionPairingOwner>,
    companion_platform: Arc<CompanionPlatformOwner>,
    companion_profile_id: String,
    companion: AsyncMutex<Option<AndroidCompanionRuntime>>,
    media_server: AsyncMutex<Option<LoopbackMediaServer>>,
}

#[derive(Debug)]
struct AndroidCompanionRuntime {
    port: u16,
    shutdown: CancellationToken,
    task: TaskJoinHandle<Result<(), rstorrent_gateway::GatewayError>>,
}

#[derive(Debug, uniffi::Object)]
pub struct AndroidViewSubscription {
    subscription: ViewSubscription,
}

#[derive(Debug, uniffi::Object)]
pub struct AndroidCompanionConnectionSubscription {
    receiver: AsyncMutex<watch::Receiver<usize>>,
    initial: AtomicBool,
    closed: CancellationToken,
}

impl AndroidCompanionConnectionSubscription {
    fn new(receiver: watch::Receiver<usize>) -> Arc<Self> {
        Arc::new(Self {
            receiver: AsyncMutex::new(receiver),
            initial: AtomicBool::new(true),
            closed: CancellationToken::new(),
        })
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl AndroidApplicationClient {
    #[uniffi::constructor]
    pub async fn open(config: AndroidApplicationConfig) -> Result<Arc<Self>, AndroidClientError> {
        let product_data_root =
            android_path(config.product_data_root.clone(), "product data root")?;
        let product_version = config.product_version.clone();
        let product_state = ProductStateOwner::open(&product_data_root, &product_version, None)
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        let (platform_client, platform_storage) = platform_storage_channel();
        let platform_enabled = config.platform_storage;
        let companion_profile_id = config.profile_id.clone();
        let companion_database = PathBuf::from(&config.profile_root)
            .join(&config.profile_id)
            .join("companion.sqlite");
        let mut application_config = validate_application_config(config)?;
        application_config.product_state = Some(product_state.clone());
        if platform_enabled {
            application_config.platform_storage_client = Some(platform_client);
        }
        let service = ApplicationService::open(application_config)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        let network_prerequisite = service.network_prerequisite_handle();
        let service = Arc::new(AsyncMutex::new(service));
        ApplicationService::ensure_maintenance_owner(&service).await;
        let companion_pairings = CompanionPairingOwner::open(&companion_database)
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        Ok(Arc::new(Self {
            service,
            product_state,
            product_version,
            network_prerequisite,
            shutdown: AtomicBool::new(false),
            platform_storage,
            companion_pairings,
            companion_platform: CompanionPlatformOwner::new(),
            companion_profile_id,
            companion: AsyncMutex::new(None),
            media_server: AsyncMutex::new(None),
        }))
    }

    fn ensure_running(&self) -> Result<(), AndroidClientError> {
        if self.shutdown.load(Ordering::Acquire) {
            Err(AndroidClientError::message(
                "application client is shut down",
            ))
        } else {
            Ok(())
        }
    }

    pub fn product_summary(&self) -> Result<ProductSummary, AndroidClientError> {
        self.ensure_running()?;
        self.product_state
            .summary()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn acknowledge_product_disclosure(
        &self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, AndroidClientError> {
        self.ensure_running()?;
        self.product_state
            .acknowledge_disclosure(statistics_enabled)
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn set_product_statistics_enabled(
        &self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, AndroidClientError> {
        self.ensure_running()?;
        self.product_state
            .set_statistics_enabled(statistics_enabled)
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn reset_product_statistics(&self) -> Result<ProductSummary, AndroidClientError> {
        self.ensure_running()?;
        self.product_state
            .reset_statistics()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn record_product_foreground_session(&self) -> Result<ProductSummary, AndroidClientError> {
        self.ensure_running()?;
        self.product_state
            .record_foreground_session()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn product_feedback_preview(
        &self,
        android_release: String,
        device: String,
        include_statistics: bool,
    ) -> Result<ProductFeedbackPreview, AndroidClientError> {
        self.ensure_running()?;
        let summary = self.product_summary()?;
        build_product_feedback_preview(
            &summary,
            &ProductFeedbackEnvironment::android(&self.product_version, android_release, device),
            include_statistics,
            HOSTED_PRODUCT_CONTEXT_READY,
        )
        .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn confirm_product_feedback(
        &self,
        android_release: String,
        device: String,
        include_statistics: bool,
        expected_url: String,
    ) -> Result<String, AndroidClientError> {
        let preview = self.product_feedback_preview(android_release, device, include_statistics)?;
        if preview.url != expected_url {
            return Err(AndroidClientError::message(
                "product feedback context changed; review the current preview before opening",
            ));
        }
        Ok(preview.url)
    }

    pub async fn dispatch(
        &self,
        request: RequestEnvelope,
    ) -> Result<ResponseEnvelope, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .dispatch(request)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn create_media_url(
        &self,
        torrent_id: String,
        file_index: u32,
    ) -> Result<MediaUrlResponse, AndroidClientError> {
        self.ensure_running()?;
        {
            let mut media_server = self.media_server.lock().await;
            self.ensure_running()?;
            if media_server.is_none() {
                let mut server = LoopbackMediaServer::bind(self.service.clone())
                    .await
                    .map_err(|error| AndroidClientError::message(error.to_string()))?;
                if let Err(error) = self.ensure_running() {
                    let _ = server.shutdown().await;
                    return Err(error);
                }
                *media_server = Some(server);
            }
        }
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .create_media_url(&torrent_id, file_index)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn set_network_prerequisite(
        &self,
        prerequisite: AndroidApplicationNetworkPrerequisite,
    ) -> Result<AndroidNetworkPrerequisiteResult, AndroidClientError> {
        self.ensure_running()?;
        let prerequisite = match prerequisite {
            AndroidApplicationNetworkPrerequisite::Allowed => {
                ApplicationNetworkPrerequisite::Allowed
            }
            AndroidApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork => {
                ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork
            }
        };
        let requested = self
            .network_prerequisite
            .replace(prerequisite)
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        let mut service = self.service.lock().await;
        service
            .reconcile_network_prerequisite()
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        let effective = service.effective_network_prerequisite();
        Ok(AndroidNetworkPrerequisiteResult {
            requested_generation: requested.generation.to_string(),
            effective_generation: effective.generation.to_string(),
            allowed: effective.is_allowed(),
        })
    }

    /// Closes the active network generation without waiting for the
    /// application mutex or joined owner convergence.
    pub fn close_network_prerequisite(&self) -> Result<String, AndroidClientError> {
        self.ensure_running()?;
        self.network_prerequisite
            .close()
            .map(|snapshot| snapshot.generation.to_string())
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn add_torrent_bytes(
        &self,
        request: AddTorrentBytesRequest,
        source: Vec<u8>,
    ) -> Result<ResponseEnvelope, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .add_torrent_bytes(request, source)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn subscribe(
        &self,
        spec: SubscriptionSpec,
    ) -> Result<Arc<AndroidViewSubscription>, AndroidClientError> {
        self.ensure_running()?;
        let subscription = self
            .service
            .lock()
            .await
            .subscribe(spec)
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        Ok(Arc::new(AndroidViewSubscription { subscription }))
    }

    pub async fn incoming_peer_snapshot(
        &self,
    ) -> Result<Option<AndroidIncomingPeerSnapshot>, AndroidClientError> {
        self.ensure_running()?;
        Ok(self
            .service
            .lock()
            .await
            .incoming_peer_snapshot()
            .map(incoming_peer_snapshot_view))
    }

    pub async fn mse_dh_work_snapshot(
        &self,
    ) -> Result<AndroidMseDhWorkSnapshot, AndroidClientError> {
        self.ensure_running()?;
        let snapshot = self.service.lock().await.mse_dh_work_snapshot();
        Ok(AndroidMseDhWorkSnapshot {
            waiting: snapshot.waiting as u64,
            active: snapshot.active as u64,
            high_water: snapshot.high_water as u64,
            tracked: snapshot.tracked as u64,
            closed: snapshot.closed,
        })
    }

    pub async fn download_resource_snapshot(
        &self,
    ) -> Result<AndroidDownloadResourceSnapshot, AndroidClientError> {
        self.ensure_running()?;
        let snapshot = self
            .service
            .lock()
            .await
            .session_download_resource_snapshot();
        Ok(AndroidDownloadResourceSnapshot {
            registered_generations: snapshot.registered_generations as u64,
            registered_generations_high_water: snapshot.registered_generations_high_water as u64,
            outstanding_request_bytes: snapshot.outstanding_request_bytes as u64,
            outstanding_request_high_water: snapshot.outstanding_request_high_water as u64,
            buffered_payload_bytes: snapshot.buffered_payload_bytes as u64,
            buffered_payload_high_water: snapshot.buffered_payload_high_water as u64,
            active_piece_bytes: snapshot.active_piece_bytes as u64,
            active_piece_bytes_high_water: snapshot.active_piece_bytes_high_water as u64,
            active_pieces: snapshot.active_pieces as u64,
            active_pieces_high_water: snapshot.active_pieces_high_water as u64,
            active_storage_writes: snapshot.active_storage_writes as u64,
            active_storage_writes_high_water: snapshot.active_storage_writes_high_water as u64,
            active_storage_hashes: snapshot.active_storage_hashes as u64,
            active_storage_hashes_high_water: snapshot.active_storage_hashes_high_water as u64,
        })
    }

    pub async fn probe_saf_storage_roots(&self) -> Result<bool, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .probe_platform_storage_roots()
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn saf_storage_snapshot(
        &self,
    ) -> Result<StorageSettingsSnapshot, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .storage_snapshot()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn allocate_saf_storage_root_id(&self) -> Result<String, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .allocate_storage_root_id()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn install_saf_storage_root(
        &self,
        root_id: String,
        label: String,
        make_default: bool,
    ) -> Result<StorageRootSnapshot, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .install_platform_storage_root(&root_id, &label, make_default)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn repair_saf_storage_root(
        &self,
        root_id: String,
        label: String,
    ) -> Result<SafStorageRootMutation, AndroidClientError> {
        self.ensure_running()?;
        let (root, restart_torrent_ids) = self
            .service
            .lock()
            .await
            .repair_platform_storage_root(&root_id, &label)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        Ok(SafStorageRootMutation {
            root,
            restart_torrent_ids,
        })
    }

    pub async fn detach_saf_storage_root(
        &self,
        root_id: String,
    ) -> Result<SafStorageRootDetach, AndroidClientError> {
        self.ensure_running()?;
        let detach = self
            .service
            .lock()
            .await
            .detach_platform_storage_root(&root_id)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        Ok(SafStorageRootDetach {
            removed: detach.removed,
            affected_torrent_ids: detach.affected_torrent_ids,
            default_root: detach.default_root,
        })
    }

    pub async fn mark_saf_unavailable(
        &self,
        torrent_id: String,
        message: String,
    ) -> Result<(), AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .mark_storage_unavailable(&torrent_id, &message)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn prepare_saf_tree_replacement(
        &self,
        root_id: String,
    ) -> Result<Vec<String>, AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .prepare_platform_storage_replacement(&root_id)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn saf_removal_plan(
        &self,
        torrent_id: String,
    ) -> Result<SafRemovalPlan, AndroidClientError> {
        self.ensure_running()?;
        let plan = self
            .service
            .lock()
            .await
            .platform_removal_plan(&torrent_id)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?;
        Ok(map_saf_removal_plan(plan))
    }

    pub async fn confirm_saf_removal(
        &self,
        torrent_id: String,
        operation_id: String,
    ) -> Result<(), AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .confirm_platform_removal(&torrent_id, &operation_id)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn fail_saf_removal(
        &self,
        torrent_id: String,
        operation_id: String,
        message: String,
    ) -> Result<(), AndroidClientError> {
        self.ensure_running()?;
        self.service
            .lock()
            .await
            .fail_platform_removal(&torrent_id, &operation_id, &message)
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn next_saf_storage_request(&self) -> Option<SafStorageRequest> {
        self.platform_storage.next_request().await.map(|request| {
            let (role, file_index) = match request.role {
                StorageFileRole::ContentRoot => (SafDynamicFileRole::ContentRoot, 0),
                StorageFileRole::Payload(file_index) => (
                    SafDynamicFileRole::Payload,
                    u32::try_from(file_index).unwrap_or(u32::MAX),
                ),
                StorageFileRole::Part => (SafDynamicFileRole::Part, 0),
            };
            SafStorageRequest {
                request_id: request.request_id,
                root_id: request.root_id,
                storage_id: request.storage_id,
                storage_generation: request.storage_generation,
                role,
                file_index,
                path: request.path,
                operation: match request.operation {
                    PlatformStorageOperation::Open => SafStorageOperation::Open,
                    PlatformStorageOperation::Observe => SafStorageOperation::Observe,
                    PlatformStorageOperation::Delete => SafStorageOperation::Delete,
                },
                access: match request.access {
                    StorageFileAccess::ReadExisting => SafStorageAccess::ReadExisting,
                    StorageFileAccess::ReadWriteExisting => SafStorageAccess::ReadWriteExisting,
                    StorageFileAccess::ReadWriteCreate => SafStorageAccess::ReadWriteCreate,
                },
                timeout_millis: request.timeout_millis,
            }
        })
    }

    pub async fn saf_storage_pool_snapshot(
        &self,
    ) -> Result<SafStoragePoolSnapshot, AndroidClientError> {
        self.ensure_running()?;
        let snapshot = self.service.lock().await.storage_file_pool_snapshot();
        Ok(SafStoragePoolSnapshot {
            limit: snapshot.limit as u64,
            current_owned: snapshot.current_owned as u64,
            owned_high_water: snapshot.owned_high_water as u64,
            cached_entries: snapshot.cached_entries as u64,
            hits: snapshot.hits,
            misses: snapshot.misses,
            evictions: snapshot.evictions,
            singleflight_waits: snapshot.singleflight_waits,
            mode_upgrades: snapshot.mode_upgrades,
            open_failures: snapshot.open_failures,
            resource_retries: snapshot.resource_retries,
            platform_pending: snapshot.platform_pending as u64,
            platform_pending_high_water: snapshot.platform_pending_high_water as u64,
        })
    }

    pub fn complete_saf_storage_request(
        &self,
        request_id: u64,
        fd: i32,
        access: SafStorageAccess,
    ) -> Result<bool, AndroidClientError> {
        if !self.platform_storage.is_pending(request_id) {
            return Ok(false);
        }
        let mut file = match duplicate_descriptor(fd) {
            Ok(file) => file,
            Err(message) => {
                self.platform_storage.complete_error(
                    request_id,
                    PlatformStorageFailure::new(PlatformStorageFailureKind::Internal, message),
                );
                return Ok(false);
            }
        };
        if let Err(message) = validate_descriptor_access(fd, access) {
            self.platform_storage.complete_error(
                request_id,
                PlatformStorageFailure::new(PlatformStorageFailureKind::ProviderRefused, message),
            );
            return Ok(false);
        }
        if let Err(error) = file.stream_position() {
            self.platform_storage.complete_error(
                request_id,
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::NonSeekable,
                    error.to_string(),
                ),
            );
            return Ok(false);
        }
        Ok(self.platform_storage.complete_file(request_id, file))
    }

    pub fn fail_saf_storage_request(
        &self,
        request_id: u64,
        kind: SafStorageFailureKind,
        message: String,
    ) -> bool {
        let kind = match kind {
            SafStorageFailureKind::Missing => PlatformStorageFailureKind::Missing,
            SafStorageFailureKind::GrantUnavailable => PlatformStorageFailureKind::GrantUnavailable,
            SafStorageFailureKind::PermissionDenied => PlatformStorageFailureKind::PermissionDenied,
            SafStorageFailureKind::WrongKind => PlatformStorageFailureKind::WrongKind,
            SafStorageFailureKind::NameCollision => PlatformStorageFailureKind::NameCollision,
            SafStorageFailureKind::StaleGeneration => PlatformStorageFailureKind::StaleGeneration,
            SafStorageFailureKind::ProviderRefused => PlatformStorageFailureKind::ProviderRefused,
            SafStorageFailureKind::NonSeekable => PlatformStorageFailureKind::NonSeekable,
            SafStorageFailureKind::Cancelled => PlatformStorageFailureKind::Cancelled,
            SafStorageFailureKind::DeadlineExceeded => PlatformStorageFailureKind::DeadlineExceeded,
            SafStorageFailureKind::Internal => PlatformStorageFailureKind::Internal,
        };
        self.platform_storage
            .complete_error(request_id, PlatformStorageFailure::new(kind, message))
    }

    pub fn complete_saf_storage_delete(&self, request_id: u64) -> bool {
        self.platform_storage.complete_deleted(request_id)
    }

    pub fn complete_saf_storage_observation(
        &self,
        request_id: u64,
        observation: SafStorageObservation,
    ) -> Result<bool, AndroidClientError> {
        let observation = if observation.exists {
            let kind = observation.kind.ok_or_else(|| {
                AndroidClientError::message("present SAF observation has no kind")
            })?;
            StorageObservation::present(
                match kind {
                    SafStorageObjectKind::File => StorageObjectKind::File,
                    SafStorageObjectKind::Directory => StorageObjectKind::Directory,
                    SafStorageObjectKind::Other => StorageObjectKind::Other,
                },
                observation.length,
                observation.opaque_token,
            )
            .map_err(|error| AndroidClientError::message(error.to_string()))?
        } else {
            if observation.kind.is_some()
                || observation.length.is_some()
                || observation.opaque_token.is_some()
            {
                return Err(AndroidClientError::message(
                    "missing SAF observation contains present-only fields",
                ));
            }
            StorageObservation::missing()
        };
        Ok(self
            .platform_storage
            .complete_observation(request_id, observation))
    }

    pub async fn start_chromeos_companion(&self) -> Result<u16, AndroidClientError> {
        self.start_chromeos_companion_on(None).await
    }

    pub async fn stop_chromeos_companion(&self) -> Result<(), AndroidClientError> {
        self.stop_companion_inner().await
    }

    pub fn observe_chromeos_companion_connections(
        &self,
    ) -> Result<Arc<AndroidCompanionConnectionSubscription>, AndroidClientError> {
        self.ensure_running()?;
        Ok(AndroidCompanionConnectionSubscription::new(
            self.companion_pairings.active_connection_counts(),
        ))
    }

    pub fn pending_companion_pairing(&self) -> Option<AndroidCompanionPairingPending> {
        self.companion_pairings
            .pending()
            .map(|pending| AndroidCompanionPairingPending {
                request_id: pending.request_id,
                extension_id: pending.extension_id,
                extension_name: pending.extension_name,
                installation_id: pending.installation_id,
                expires_in_seconds: pending.expires_in_seconds,
            })
    }

    pub fn approve_companion_pairing(&self, request_id: String) -> Result<(), AndroidClientError> {
        self.companion_pairings
            .approve(&request_id)
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub fn reject_companion_pairing(&self, request_id: String) -> Result<(), AndroidClientError> {
        self.companion_pairings
            .reject(&request_id)
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }

    pub async fn next_companion_root_request(&self) -> Option<AndroidCompanionRootRequest> {
        self.companion_platform
            .next_request()
            .await
            .map(|request| AndroidCompanionRootRequest {
                request_id: request.request_id,
                repair_root: request.repair_root,
                expires_in_seconds: request.expires_in_seconds,
            })
    }

    pub async fn next_companion_root_removal_request(
        &self,
    ) -> Option<AndroidCompanionRootRemovalRequest> {
        self.companion_platform
            .next_removal_request()
            .await
            .map(|request| AndroidCompanionRootRemovalRequest {
                request_id: request.request_id,
                application_request: request.application_request,
                expires_in_seconds: request.expires_in_seconds,
            })
    }

    pub fn complete_companion_root_removal_request(
        &self,
        request_id: String,
        response: ResponseEnvelope,
    ) -> bool {
        self.companion_platform
            .complete_removal(&request_id, response)
    }

    pub fn fail_companion_root_removal_request(&self, request_id: String, message: String) -> bool {
        self.companion_platform.fail_removal(&request_id, &message)
    }

    pub fn complete_companion_root_request(
        &self,
        request_id: String,
        root: Option<StorageRootSnapshot>,
    ) -> bool {
        self.companion_platform.complete(&request_id, root)
    }

    pub fn fail_companion_root_request(&self, request_id: String, message: String) -> bool {
        self.companion_platform.fail(&request_id, &message)
    }

    pub async fn shutdown(&self) -> Result<(), AndroidClientError> {
        if self.shutdown.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let companion_result = self.stop_companion_inner().await;
        self.companion_platform.close();
        self.platform_storage.cancel_all();
        let mut media_server = self.media_server.lock().await.take();
        let service_result = self
            .service
            .lock()
            .await
            .shutdown()
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()));
        let product_result = self
            .product_state
            .record_clean_shutdown()
            .map_err(|error| AndroidClientError::message(error.to_string()));
        let media_result = match &mut media_server {
            Some(server) => server
                .shutdown()
                .await
                .map_err(|error| AndroidClientError::message(error.to_string())),
            None => Ok(()),
        };
        let mut failures = Vec::new();
        if let Err(error) = companion_result {
            failures.push(format!("companion shutdown: {error}"));
        }
        if let Err(error) = service_result {
            failures.push(format!("application shutdown: {error}"));
        }
        if let Err(error) = product_result {
            failures.push(format!("product-state shutdown: {error}"));
        }
        if let Err(error) = media_result {
            failures.push(format!("media shutdown: {error}"));
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AndroidClientError::message(failures.join("; ")))
        }
    }

    async fn stop_companion_inner(&self) -> Result<(), AndroidClientError> {
        let active = self.companion.lock().await.take();
        let Some(active) = active else {
            return Ok(());
        };
        active.shutdown.cancel();
        active
            .task
            .await
            .map_err(|error| AndroidClientError::message(error.to_string()))?
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }
}

impl AndroidApplicationClient {
    async fn start_chromeos_companion_on(
        &self,
        bind_address: Option<Ipv4Addr>,
    ) -> Result<u16, AndroidClientError> {
        self.ensure_running()?;
        let mut active = self.companion.lock().await;
        if active
            .as_ref()
            .is_some_and(|runtime| !runtime.task.is_finished())
        {
            return Ok(active.as_ref().expect("active companion").port);
        }
        if let Some(previous) = active.take() {
            previous.shutdown.cancel();
            let _ = previous.task.await;
        }
        let server = match bind_address {
            Some(bind_address) => {
                rstorrent_gateway::bind_companion_on(
                    bind_address,
                    self.companion_pairings.clone(),
                    self.companion_platform.clone(),
                    self.service.clone(),
                    &self.companion_profile_id,
                    env!("CARGO_PKG_VERSION"),
                )
                .await
            }
            None => {
                rstorrent_gateway::bind_companion(
                    self.companion_pairings.clone(),
                    self.companion_platform.clone(),
                    self.service.clone(),
                    &self.companion_profile_id,
                    env!("CARGO_PKG_VERSION"),
                )
                .await
            }
        }
        .map_err(|error| AndroidClientError::message(error.to_string()))?;
        let port = server.local_addr().port();
        let shutdown = CancellationToken::new();
        let task_shutdown = shutdown.clone();
        let task = tokio::spawn(server.serve(task_shutdown));
        *active = Some(AndroidCompanionRuntime {
            port,
            shutdown,
            task,
        });
        Ok(port)
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl AndroidViewSubscription {
    pub fn stream_id(&self) -> String {
        self.subscription.stream_id()
    }

    pub async fn next_update(&self) -> Option<ViewUpdate> {
        self.subscription.next_update().await
    }

    pub fn resync(&self) -> Result<(), AndroidClientError> {
        self.subscription
            .resync()
            .map_err(|error| AndroidClientError::message(error.to_string()))
    }
}

impl Drop for AndroidViewSubscription {
    fn drop(&mut self) {
        self.subscription.close();
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl AndroidCompanionConnectionSubscription {
    pub async fn next_count(&self) -> Option<u32> {
        if self.closed.is_cancelled() {
            return None;
        }
        let mut receiver = self.receiver.lock().await;
        if self.initial.swap(false, Ordering::AcqRel) {
            return Some(
                u32::try_from(*receiver.borrow())
                    .expect("authenticated companion count exceeds u32"),
            );
        }
        tokio::select! {
            _ = self.closed.cancelled() => None,
            changed = receiver.changed() => changed.ok().map(|()| {
                u32::try_from(*receiver.borrow_and_update())
                    .expect("authenticated companion count exceeds u32")
            }),
        }
    }
}

impl Drop for AndroidCompanionConnectionSubscription {
    fn drop(&mut self) {
        self.closed.cancel();
    }
}

fn validate_application_config(
    config: AndroidApplicationConfig,
) -> Result<ApplicationConfig, AndroidClientError> {
    if config.peer_connect_timeout_seconds == 0
        || config.peer_connect_timeout_seconds > MAX_TIMEOUT_SECONDS
    {
        return Err(AndroidClientError::message(format!(
            "peer connect timeout must be 1..={MAX_TIMEOUT_SECONDS} seconds"
        )));
    }
    if config.peer_io_timeout_seconds == 0 || config.peer_io_timeout_seconds > MAX_TIMEOUT_SECONDS {
        return Err(AndroidClientError::message(format!(
            "peer I/O timeout must be 1..={MAX_TIMEOUT_SECONDS} seconds"
        )));
    }
    let storage_roots = if config.platform_storage {
        if config.platform_storage_roots.len() > MAX_STORAGE_ROOTS {
            return Err(AndroidClientError::message(format!(
                "platform storage root count exceeds {MAX_STORAGE_ROOTS}"
            )));
        }
        let mut root_ids = BTreeSet::new();
        config
            .platform_storage_roots
            .into_iter()
            .map(|root| {
                if !root_ids.insert(root.root_id.clone()) {
                    return Err(AndroidClientError::message(format!(
                        "platform storage root {} is duplicated",
                        root.root_id
                    )));
                }
                Ok(ConfiguredStorageRoot::platform(root.root_id).with_label(root.label))
            })
            .collect::<Result<Vec<_>, AndroidClientError>>()?
    } else {
        if !config.platform_storage_roots.is_empty() {
            return Err(AndroidClientError::message(
                "path storage cannot include platform storage roots",
            ));
        }
        vec![ConfiguredStorageRoot::path(
            "downloads",
            android_path(config.storage_root, "storage root")?,
        )]
    };
    let network_policy = match config.network_policy {
        AndroidNetworkPolicy::Offline => NetworkPolicy::Offline,
        AndroidNetworkPolicy::LoopbackOnly => NetworkPolicy::LoopbackOnly,
        AndroidNetworkPolicy::Online => NetworkPolicy::Online,
    };
    let mut application = ApplicationConfig::new(
        android_path(config.profile_root, "profile root")?,
        config.profile_id,
        storage_roots,
        NetworkConfig::new(
            network_policy,
            Duration::from_secs(config.peer_connect_timeout_seconds),
            Duration::from_secs(config.peer_io_timeout_seconds),
        ),
    );
    application =
        application.with_initial_network_prerequisite(match config.initial_network_prerequisite {
            AndroidApplicationNetworkPrerequisite::Allowed => {
                ApplicationNetworkPrerequisite::Allowed
            }
            AndroidApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork => {
                ApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork
            }
        });
    if network_policy == NetworkPolicy::Online {
        application = application.with_fresh_profile_defaults();
    }
    if config.platform_storage {
        application =
            application.with_path_root_startup_policy(PathRootStartupPolicy::PreserveUnavailable);
    }
    application.download_resource_limits = DownloadResourceLimits::ANDROID;
    application.active_download_cap = Some(2);
    Ok(application)
}

fn android_path(value: String, label: &str) -> Result<PathBuf, AndroidClientError> {
    if value.is_empty() || value.len() > MAX_ANDROID_PATH_BYTES || value.as_bytes().contains(&0) {
        return Err(AndroidClientError::message(format!(
            "{label} must be 1..={MAX_ANDROID_PATH_BYTES} bytes without NUL"
        )));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(AndroidClientError::message(format!(
            "{label} must be absolute"
        )));
    }
    Ok(path)
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct EngineConfig {
    pub metainfo_path: String,
    pub output_path: String,
    pub peer_port: u16,
    pub timeout_seconds: u64,
    pub max_buffered_payload_bytes: u64,
    pub storage_write_delay_millis: u64,
    pub skip_files: Vec<u32>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafDescriptor {
    pub file_index: u32,
    pub fd: i32,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStorage {
    pub wanted_files: Vec<SafDescriptor>,
    pub part_fd: i32,
    pub reopened_part_fd: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafDynamicFileRole {
    ContentRoot,
    Payload,
    Part,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafStorageAccess {
    ReadExisting,
    ReadWriteExisting,
    ReadWriteCreate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafStorageOperation {
    Open,
    Observe,
    Delete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafStorageObjectKind {
    File,
    Directory,
    Other,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStorageObservation {
    pub exists: bool,
    pub kind: Option<SafStorageObjectKind>,
    pub length: Option<u64>,
    pub opaque_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafStorageFailureKind {
    Missing,
    GrantUnavailable,
    PermissionDenied,
    WrongKind,
    NameCollision,
    StaleGeneration,
    ProviderRefused,
    NonSeekable,
    Cancelled,
    DeadlineExceeded,
    Internal,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStorageRequest {
    pub request_id: u64,
    pub root_id: String,
    pub storage_id: String,
    pub storage_generation: u64,
    pub role: SafDynamicFileRole,
    pub file_index: u32,
    pub path: Vec<String>,
    pub operation: SafStorageOperation,
    pub access: SafStorageAccess,
    pub timeout_millis: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStorageRootMutation {
    pub root: StorageRootSnapshot,
    pub restart_torrent_ids: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStorageRootDetach {
    /// The root was deleted because no torrent used it.
    pub removed: bool,
    pub affected_torrent_ids: Vec<String>,
    pub default_root: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStoragePoolSnapshot {
    pub limit: u64,
    pub current_owned: u64,
    pub owned_high_water: u64,
    pub cached_entries: u64,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub singleflight_waits: u64,
    pub mode_upgrades: u64,
    pub open_failures: u64,
    pub resource_retries: u64,
    pub platform_pending: u64,
    pub platform_pending_high_water: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SafFileRole {
    Wanted,
    Skipped,
    Padding,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafPlanFile {
    pub file_index: u32,
    pub path: Vec<String>,
    pub length: u64,
    pub role: SafFileRole,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafStoragePlan {
    pub valid: bool,
    pub message: Option<String>,
    pub info_hash_hex: String,
    pub name: String,
    pub tree: bool,
    pub files: Vec<SafPlanFile>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafRemovalPath {
    pub components: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SafRemovalPlan {
    pub operation_id: String,
    pub torrent_id: String,
    pub storage_root: String,
    pub name: String,
    pub tree: bool,
    pub files: Vec<SafRemovalPath>,
    pub directories: Vec<SafRemovalPath>,
}

fn map_saf_removal_plan(plan: PlatformRemovalPlan) -> SafRemovalPlan {
    SafRemovalPlan {
        operation_id: plan.operation_id,
        torrent_id: plan.torrent_id,
        storage_root: plan.storage_root,
        name: plan.name,
        tree: plan.tree,
        files: plan
            .files
            .into_iter()
            .map(|path| SafRemovalPath {
                components: path.components,
            })
            .collect(),
        directories: plan
            .directories
            .into_iter()
            .map(|path| SafRemovalPath {
                components: path.components,
            })
            .collect(),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum StartDisposition {
    Started,
    Busy,
    NeedsJoin,
    Rejected,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct StartResult {
    pub disposition: StartDisposition,
    pub generation: u64,
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum SessionState {
    Idle,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum TerminalOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum FailureKind {
    Peer,
    Timeout,
    Configuration,
    Protocol,
    PreexistingArtifact,
    Storage,
    Cleanup,
    Runtime,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct EngineReport {
    pub info_hash_hex: String,
    pub final_piece_hash_hex: String,
    pub bytes_written: u64,
    pub block_count: u64,
    pub payload_limit: u64,
    pub payload_high_water: u64,
    pub outstanding_request_limit: u64,
    pub outstanding_request_high_water: u64,
    pub active_piece_limit: u64,
    pub verification_buffer: u64,
    pub piece_count: u64,
    pub verified_piece_count: u64,
    pub skipped_piece_count: u64,
    pub selected_file_bytes: u64,
    pub skipped_file_bytes: u64,
    pub padding_bytes: u64,
    pub selected_written_bytes: u64,
    pub part_written_bytes: u64,
    pub part_slots: u64,
    pub part_reopened: bool,
    pub part_path: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct DescriptorInspection {
    pub success: bool,
    pub message: Option<String>,
    pub length: u64,
    pub allocated_bytes: u64,
    pub sha1_hex: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct TerminalResult {
    pub outcome: TerminalOutcome,
    pub failure_kind: Option<FailureKind>,
    pub failure_message: Option<String>,
    pub report: Option<EngineReport>,
    pub elapsed_millis: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SessionSnapshot {
    pub interface_version: String,
    pub state: SessionState,
    pub generation: u64,
    pub task_alive: bool,
    pub cancellation_requested: bool,
    pub buffered_payload_bytes: u64,
    pub payload_high_water: u64,
    pub outstanding_request_bytes: u64,
    pub outstanding_request_high_water: u64,
    pub requested_bytes: u64,
    pub received_bytes: u64,
    pub stored_bytes: u64,
    pub terminal: Option<TerminalResult>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct JoinResult {
    pub joined: bool,
    pub terminal: Option<TerminalResult>,
}

#[derive(Debug, uniffi::Object)]
pub struct EngineSession {
    shared: Arc<Shared>,
}

#[derive(Debug)]
struct Shared {
    inner: Mutex<Inner>,
    changed: Condvar,
}

#[derive(Debug)]
struct Inner {
    state: SessionState,
    generation: u64,
    started: Option<Instant>,
    control: Option<DownloadControl>,
    progress: DownloadProgress,
    cancellation_requested: bool,
    worker: Option<JoinHandle<()>>,
    terminal: Option<TerminalResult>,
}

impl EngineSession {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.shared
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn join_until(&self, timeout: Duration) -> JoinResult {
        let deadline = Instant::now() + timeout;
        let mut inner = self.lock();
        loop {
            if inner.terminal.is_some() {
                let terminal = inner.terminal.clone();
                let worker = inner.worker.take();
                drop(inner);
                if let Some(worker) = worker
                    && worker.join().is_err()
                {
                    let failure = runtime_failure("engine worker panicked");
                    let mut inner = self.lock();
                    inner.state = SessionState::Failed;
                    inner.terminal = Some(failure.clone());
                    return JoinResult {
                        joined: true,
                        terminal: Some(failure),
                    };
                }
                return JoinResult {
                    joined: true,
                    terminal,
                };
            }
            if inner.worker.is_none() {
                return JoinResult {
                    joined: true,
                    terminal: None,
                };
            }

            let now = Instant::now();
            if now >= deadline {
                return JoinResult {
                    joined: false,
                    terminal: None,
                };
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next, wait) = self
                .shared
                .changed
                .wait_timeout(inner, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            inner = next;
            if wait.timed_out() && inner.terminal.is_none() {
                return JoinResult {
                    joined: false,
                    terminal: None,
                };
            }
        }
    }

    fn start_owned(
        &self,
        config: DownloadConfig,
        storage_write_delay: Duration,
        descriptors: Option<DescriptorStorage>,
    ) -> StartResult {
        let mut inner = self.lock();
        if matches!(
            inner.state,
            SessionState::Running | SessionState::Cancelling
        ) {
            return StartResult {
                disposition: StartDisposition::Busy,
                generation: inner.generation,
                message: Some("an engine task is already active".to_owned()),
            };
        }
        if inner.worker.is_some() {
            return StartResult {
                disposition: StartDisposition::NeedsJoin,
                generation: inner.generation,
                message: Some("the previous engine task must be joined".to_owned()),
            };
        }

        inner.generation += 1;
        let generation = inner.generation;
        let started = Instant::now();
        let control = DownloadControl::new();
        control.set_storage_write_delay(storage_write_delay);
        inner.state = SessionState::Running;
        inner.started = Some(started);
        inner.control = Some(control.clone());
        inner.progress = DownloadProgress::default();
        inner.cancellation_requested = false;
        inner.terminal = None;

        let shared = Arc::clone(&self.shared);
        let worker = std::thread::Builder::new()
            .name(format!("rstorrent-engine-{generation}"))
            .spawn(move || run_worker(shared, config, descriptors, control, started));
        match worker {
            Ok(worker) => {
                inner.worker = Some(worker);
                StartResult {
                    disposition: StartDisposition::Started,
                    generation,
                    message: None,
                }
            }
            Err(error) => {
                inner.state = SessionState::Idle;
                inner.started = None;
                inner.control = None;
                StartResult {
                    disposition: StartDisposition::Rejected,
                    generation,
                    message: Some(format!("failed to start engine worker: {error}")),
                }
            }
        }
    }
}

#[uniffi::export]
impl EngineSession {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            shared: Arc::new(Shared {
                inner: Mutex::new(Inner {
                    state: SessionState::Idle,
                    generation: 0,
                    started: None,
                    control: None,
                    progress: DownloadProgress::default(),
                    cancellation_requested: false,
                    worker: None,
                    terminal: None,
                }),
                changed: Condvar::new(),
            }),
        })
    }

    pub fn start(&self, config: EngineConfig) -> StartResult {
        let (config, storage_write_delay) = match validate_config(config) {
            Ok(config) => config,
            Err(message) => {
                let inner = self.lock();
                return StartResult {
                    disposition: StartDisposition::Rejected,
                    generation: inner.generation,
                    message: Some(message),
                };
            }
        };
        self.start_owned(config, storage_write_delay, None)
    }

    pub fn start_saf(&self, config: EngineConfig, storage: SafStorage) -> StartResult {
        let (config, storage_write_delay) = match validate_config(config) {
            Ok(config) => config,
            Err(message) => {
                let inner = self.lock();
                return StartResult {
                    disposition: StartDisposition::Rejected,
                    generation: inner.generation,
                    message: Some(message),
                };
            }
        };
        let descriptors = match duplicate_saf_storage(storage) {
            Ok(descriptors) => descriptors,
            Err(message) => {
                let inner = self.lock();
                return StartResult {
                    disposition: StartDisposition::Rejected,
                    generation: inner.generation,
                    message: Some(message),
                };
            }
        };
        self.start_owned(config, storage_write_delay, Some(descriptors))
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let inner = self.lock();
        let progress = inner
            .control
            .as_ref()
            .map(DownloadControl::snapshot)
            .unwrap_or(inner.progress);
        SessionSnapshot {
            interface_version: INTERFACE_VERSION.to_owned(),
            state: inner.state,
            generation: inner.generation,
            task_alive: inner
                .worker
                .as_ref()
                .is_some_and(|worker| !worker.is_finished()),
            cancellation_requested: inner.cancellation_requested,
            buffered_payload_bytes: progress.buffered_payload_bytes as u64,
            payload_high_water: progress.payload_high_water as u64,
            outstanding_request_bytes: progress.outstanding_request_bytes as u64,
            outstanding_request_high_water: progress.outstanding_request_high_water as u64,
            requested_bytes: progress.requested_bytes as u64,
            received_bytes: progress.received_bytes as u64,
            stored_bytes: progress.stored_bytes as u64,
            terminal: inner.terminal.clone(),
        }
    }

    pub fn wait_for_terminal(&self, timeout_millis: u64) -> JoinResult {
        self.join_until(join_timeout(timeout_millis))
    }

    pub fn cancel_and_join(&self, timeout_millis: u64) -> JoinResult {
        let control = {
            let mut inner = self.lock();
            if inner.state == SessionState::Running {
                inner.state = SessionState::Cancelling;
            }
            if inner.control.is_some() {
                inner.cancellation_requested = true;
            }
            inner.control.clone()
        };
        if let Some(control) = control {
            control.cancel();
        }
        self.join_until(join_timeout(timeout_millis))
    }
}

impl Drop for EngineSession {
    fn drop(&mut self) {
        if let Some(control) = self.lock().control.clone() {
            control.cancel();
        }
    }
}

#[uniffi::export]
pub fn interface_version() -> String {
    INTERFACE_VERSION.to_owned()
}

#[uniffi::export]
pub fn saf_storage_plan(metainfo_bytes: Vec<u8>, skip_files: Vec<u32>) -> SafStoragePlan {
    let result = (|| {
        if metainfo_bytes.len() > BEP9_METAINFO_LIMITS.max_outer_bytes {
            return Err(format!(
                "metainfo exceeds input limit {}",
                BEP9_METAINFO_LIMITS.max_outer_bytes
            ));
        }
        if skip_files.len() > MAX_FILE_SELECTIONS {
            return Err(format!(
                "file selection lists may contain at most {MAX_FILE_SELECTIONS} entries"
            ));
        }
        let metainfo = Metainfo::from_bytes_with_limits(&metainfo_bytes, BEP9_METAINFO_LIMITS)
            .map_err(|error| error.to_string())?;
        let skip_files: Vec<usize> = skip_files.into_iter().map(|index| index as usize).collect();
        let plan =
            plan_descriptor_storage(&metainfo, &skip_files).map_err(|error| error.to_string())?;
        map_saf_storage_plan(plan).map_err(|error| error.to_string())
    })();
    result.unwrap_or_else(|message| SafStoragePlan {
        valid: false,
        message: Some(message),
        info_hash_hex: String::new(),
        name: String::new(),
        tree: false,
        files: Vec::new(),
    })
}

fn map_saf_storage_plan(plan: DescriptorStoragePlan) -> Result<SafStoragePlan, AndroidClientError> {
    let files = plan
        .files
        .into_iter()
        .map(|file| {
            Ok(SafPlanFile {
                file_index: u32::try_from(file.file_index)
                    .map_err(|_| AndroidClientError::message("file index exceeds u32"))?,
                path: file.path,
                length: file.length,
                role: match file.role {
                    DescriptorFileRole::Wanted => SafFileRole::Wanted,
                    DescriptorFileRole::Skipped => SafFileRole::Skipped,
                    DescriptorFileRole::Padding => SafFileRole::Padding,
                },
            })
        })
        .collect::<Result<Vec<_>, AndroidClientError>>()?;
    Ok(SafStoragePlan {
        valid: true,
        message: None,
        info_hash_hex: hex(&plan.info_hash),
        name: plan.name,
        tree: plan.content_shape == rstorrent_engine::ContentShape::Tree,
        files,
    })
}

#[uniffi::export]
pub fn inspect_borrowed_descriptor(
    fd: i32,
    expected_length: u64,
    expected_sha1_hex: String,
) -> DescriptorInspection {
    match inspect_descriptor(fd, expected_length, &expected_sha1_hex) {
        Ok((length, allocated_bytes, sha1_hex)) => DescriptorInspection {
            success: true,
            message: None,
            length,
            allocated_bytes,
            sha1_hex,
        },
        Err(message) => DescriptorInspection {
            success: false,
            message: Some(message),
            length: 0,
            allocated_bytes: 0,
            sha1_hex: String::new(),
        },
    }
}

fn duplicate_saf_storage(storage: SafStorage) -> Result<DescriptorStorage, String> {
    if storage.wanted_files.len() > MAX_FILE_SELECTIONS {
        return Err(format!(
            "SAF descriptor lists may contain at most {MAX_FILE_SELECTIONS} entries"
        ));
    }
    fn files(descriptors: Vec<SafDescriptor>) -> Result<Vec<DescriptorFile>, String> {
        descriptors
            .into_iter()
            .map(|descriptor| {
                Ok(DescriptorFile {
                    file_index: descriptor.file_index as usize,
                    file: duplicate_descriptor(descriptor.fd)?,
                })
            })
            .collect()
    }
    Ok(DescriptorStorage {
        wanted_files: files(storage.wanted_files)?,
        part_file: duplicate_descriptor(storage.part_fd)?,
        reopened_part_file: duplicate_descriptor(storage.reopened_part_fd)?,
    })
}

#[cfg(unix)]
fn duplicate_descriptor(fd: i32) -> Result<File, String> {
    if fd < 0 {
        return Err(format!("descriptor {fd} is invalid"));
    }
    // SAF owns the borrowed descriptor. F_DUPFD_CLOEXEC creates an independent
    // Rust-owned descriptor without transferring or closing the caller's one.
    let owned_fd = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if owned_fd < 0 {
        return Err(format!(
            "duplicate descriptor {fd}: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: fcntl returned a new descriptor owned by this call.
    Ok(unsafe { File::from_raw_fd(owned_fd) })
}

#[cfg(unix)]
fn validate_descriptor_access(fd: i32, access: SafStorageAccess) -> Result<(), String> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(format!(
            "inspect descriptor access: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mode = flags & libc::O_ACCMODE;
    let compatible = match access {
        SafStorageAccess::ReadExisting => mode != libc::O_WRONLY,
        SafStorageAccess::ReadWriteExisting | SafStorageAccess::ReadWriteCreate => {
            mode == libc::O_RDWR
        }
    };
    compatible
        .then_some(())
        .ok_or_else(|| "provider descriptor mode is incompatible with the request".to_owned())
}

#[cfg(not(unix))]
fn duplicate_descriptor(_fd: i32) -> Result<File, String> {
    Err("descriptor storage requires a Unix platform".to_owned())
}

#[cfg(not(unix))]
fn validate_descriptor_access(_fd: i32, _access: SafStorageAccess) -> Result<(), String> {
    Err("SAF descriptors require a Unix target".to_owned())
}

fn inspect_descriptor(
    fd: i32,
    expected_length: u64,
    expected_sha1_hex: &str,
) -> Result<(u64, u64, String), String> {
    if expected_sha1_hex.len() != 40
        || !expected_sha1_hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("expected SHA-1 must contain exactly 40 hexadecimal characters".to_owned());
    }
    let mut file = duplicate_descriptor(fd)?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("inspect descriptor metadata: {error}"))?;
    let length = metadata.len();
    if length != expected_length {
        return Err(format!(
            "descriptor length {length} does not match expected {expected_length}"
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("seek descriptor for verification: {error}"))?;
    let mut remaining = length;
    let mut buffer = [0_u8; DESCRIPTOR_HASH_BUFFER];
    let mut hasher = Sha1::new();
    while remaining != 0 {
        let read_length = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| "descriptor length exceeds address space".to_owned())?;
        file.read_exact(&mut buffer[..read_length])
            .map_err(|error| format!("read descriptor for verification: {error}"))?;
        hasher.update(&buffer[..read_length]);
        remaining -= read_length as u64;
    }
    let actual = hex(&hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha1_hex) {
        return Err(format!(
            "descriptor SHA-1 {actual} does not match expected {}",
            expected_sha1_hex.to_ascii_lowercase()
        ));
    }
    Ok((length, allocated_bytes(&metadata), actual))
}

#[cfg(unix)]
fn allocated_bytes(metadata: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blocks().saturating_mul(512)
}

#[cfg(not(unix))]
fn allocated_bytes(_metadata: &std::fs::Metadata) -> u64 {
    0
}

fn validate_config(config: EngineConfig) -> Result<(DownloadConfig, Duration), String> {
    if config.metainfo_path.is_empty() || config.output_path.is_empty() {
        return Err("metainfo and output paths must be nonempty".to_owned());
    }
    if config.peer_port == 0 {
        return Err("peer port must be nonzero".to_owned());
    }
    if !(1..=MAX_TIMEOUT_SECONDS).contains(&config.timeout_seconds) {
        return Err(format!(
            "timeout must be between 1 and {MAX_TIMEOUT_SECONDS} seconds"
        ));
    }
    if !(MIN_PAYLOAD_BYTES..=MAX_PAYLOAD_BYTES).contains(&config.max_buffered_payload_bytes) {
        return Err(format!(
            "payload allowance must be between {MIN_PAYLOAD_BYTES} and \
             {MAX_PAYLOAD_BYTES} bytes"
        ));
    }
    if config.skip_files.len() > MAX_FILE_SELECTIONS {
        return Err(format!(
            "file selection lists may contain at most {MAX_FILE_SELECTIONS} entries"
        ));
    }
    if config.storage_write_delay_millis > MAX_STORAGE_WRITE_DELAY_MILLIS {
        return Err(format!(
            "storage write delay may be at most \
             {MAX_STORAGE_WRITE_DELAY_MILLIS} milliseconds"
        ));
    }

    let metainfo_path = PathBuf::from(config.metainfo_path);
    let metainfo_bytes = std::fs::read(&metainfo_path)
        .map_err(|error| format!("read metainfo for identity: {error}"))?;
    let metainfo = Metainfo::from_bytes_with_limits(&metainfo_bytes, BEP9_METAINFO_LIMITS)
        .map_err(|error| format!("parse metainfo for identity: {error}"))?;
    let torrent_id = TorrentId::generate()
        .map_err(|error| format!("allocate diagnostic torrent owner: {error}"))?;

    Ok((
        DownloadConfig {
            identity: TorrentIdentityContext::v1(torrent_id, V1InfoHash::new(metainfo.info_hash)),
            metainfo_path,
            peer: SocketAddr::from((Ipv4Addr::LOCALHOST, config.peer_port)),
            output_path: PathBuf::from(config.output_path),
            network: NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                Duration::from_secs(config.timeout_seconds),
                Duration::from_secs(config.timeout_seconds),
            ),
            resource_limits: DownloadResourceLimits::new(
                config.max_buffered_payload_bytes as usize,
                config.max_buffered_payload_bytes as usize,
                config.max_buffered_payload_bytes as usize,
            ),
            skip_files: config
                .skip_files
                .into_iter()
                .map(|index| index as usize)
                .collect(),
            high_priority_files: Vec::new(),
        },
        Duration::from_millis(config.storage_write_delay_millis),
    ))
}

fn run_worker(
    shared: Arc<Shared>,
    config: DownloadConfig,
    descriptors: Option<DescriptorStorage>,
    control: DownloadControl,
    started: Instant,
) {
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| WorkerFailure::Runtime(format!("failed to build Tokio runtime: {error}")))
        .and_then(|runtime| {
            match descriptors {
                Some(descriptors) => {
                    runtime.block_on(download_verified_piece_to_descriptors_with_control(
                        config,
                        descriptors,
                        control.clone(),
                    ))
                }
                None => runtime.block_on(download_verified_piece_with_control(
                    config,
                    control.clone(),
                )),
            }
            .map_err(WorkerFailure::Engine)
        });

    let terminal = match result {
        Ok(report) => success_result(report, started.elapsed()),
        Err(WorkerFailure::Engine(DownloadError::Cancelled)) => TerminalResult {
            outcome: TerminalOutcome::Cancelled,
            failure_kind: None,
            failure_message: None,
            report: None,
            elapsed_millis: millis(started.elapsed()),
        },
        Err(WorkerFailure::Engine(error)) => TerminalResult {
            outcome: TerminalOutcome::Failed,
            failure_kind: Some(classify_failure(&error)),
            failure_message: Some(error.to_string()),
            report: None,
            elapsed_millis: millis(started.elapsed()),
        },
        Err(WorkerFailure::Runtime(message)) => TerminalResult {
            outcome: TerminalOutcome::Failed,
            failure_kind: Some(FailureKind::Runtime),
            failure_message: Some(message),
            report: None,
            elapsed_millis: millis(started.elapsed()),
        },
    };
    let mut inner = shared
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    inner.state = match terminal.outcome {
        TerminalOutcome::Succeeded => SessionState::Succeeded,
        TerminalOutcome::Failed => SessionState::Failed,
        TerminalOutcome::Cancelled => SessionState::Cancelled,
    };
    inner.progress = control.snapshot();
    inner.control = None;
    inner.terminal = Some(terminal);
    drop(inner);
    shared.changed.notify_all();
}

#[derive(Debug)]
enum WorkerFailure {
    Engine(DownloadError),
    Runtime(String),
}

fn classify_failure(error: &DownloadError) -> FailureKind {
    if error.is_existing_artifact() {
        return FailureKind::PreexistingArtifact;
    }
    match error {
        DownloadError::PeerClosed
        | DownloadError::Handshake(_)
        | DownloadError::Frame(_)
        | DownloadError::PeerRegistry(_)
        | DownloadError::PeerTask(_)
        | DownloadError::UdpTracker(_)
        | DownloadError::NoUsablePeer
        | DownloadError::NoUsableTrackerAddress
        | DownloadError::UdpTrackerResponseTooLarge { .. } => FailureKind::Peer,
        DownloadError::Io { operation, .. }
            if operation.contains("peer") || operation.contains("UDP tracker") =>
        {
            FailureKind::Peer
        }
        DownloadError::PeerTimedOut { .. }
        | DownloadError::NetworkTimedOut { .. }
        | DownloadError::UdpTrackerTimedOut { .. }
        | DownloadError::Dht(rstorrent_engine::dht::DhtError::LookupTimedOut) => {
            FailureKind::Timeout
        }
        DownloadError::NetworkDisabled
        | DownloadError::NetworkPolicyDenied { .. }
        | DownloadError::InvalidNetworkTimeout { .. }
        | DownloadError::InvalidResourceLimit(_)
        | DownloadError::InvalidTorrentIdentity(_)
        | DownloadError::Dht(rstorrent_engine::dht::DhtError::NetworkDisabled)
        | DownloadError::MetainfoTooLarge { .. }
        | DownloadError::Magnet(_)
        | DownloadError::Metainfo(_)
        | DownloadError::Layout(_) => FailureKind::Configuration,
        DownloadError::Metadata(_)
        | DownloadError::Pex(_)
        | DownloadError::ExtensionProtocolUnsupported
        | DownloadError::MetadataExtensionDisabled
        | DownloadError::InvalidPremetadataState(_)
        | DownloadError::InconsistentHybridHashes { .. }
        | DownloadError::Piece(_) => FailureKind::Protocol,
        DownloadError::SelectiveStorage(_) | DownloadError::Io { .. } => FailureKind::Storage,
        DownloadError::PeerCleanup { .. } => FailureKind::Cleanup,
        DownloadError::Entropy(_)
        | DownloadError::Dht(_)
        | DownloadError::Checkpoint(_)
        | DownloadError::PeerRuntime(_)
        | DownloadError::Swarm(_)
        | DownloadError::StorageTask(_)
        | DownloadError::TrackerTask(_)
        | DownloadError::Cancelled => FailureKind::Runtime,
    }
}

fn success_result(report: DownloadReport, elapsed: Duration) -> TerminalResult {
    TerminalResult {
        outcome: TerminalOutcome::Succeeded,
        failure_kind: None,
        failure_message: None,
        report: Some(EngineReport {
            info_hash_hex: hex(&report.info_hash),
            final_piece_hash_hex: hex(&report.piece_hash),
            bytes_written: report.bytes_written as u64,
            block_count: report.block_count as u64,
            payload_limit: report.payload_limit as u64,
            payload_high_water: report.payload_high_water as u64,
            outstanding_request_limit: report.outstanding_request_limit as u64,
            outstanding_request_high_water: report.outstanding_request_high_water as u64,
            active_piece_limit: report.active_piece_limit as u64,
            verification_buffer: report.verification_buffer as u64,
            piece_count: report.piece_count as u64,
            verified_piece_count: report.verified_piece_count as u64,
            skipped_piece_count: report.skipped_piece_count as u64,
            selected_file_bytes: report.selected_file_bytes,
            skipped_file_bytes: report.skipped_file_bytes,
            padding_bytes: report.padding_bytes,
            selected_written_bytes: report.selected_written_bytes as u64,
            part_written_bytes: report.part_written_bytes as u64,
            part_slots: report.part_slots as u64,
            part_reopened: report.part_reopened,
            part_path: report.part_path.map(|path| path.display().to_string()),
        }),
        elapsed_millis: millis(elapsed),
    }
}

fn runtime_failure(message: &str) -> TerminalResult {
    TerminalResult {
        outcome: TerminalOutcome::Failed,
        failure_kind: Some(FailureKind::Runtime),
        failure_message: Some(message.to_owned()),
        report: None,
        elapsed_millis: 0,
    }
}

fn millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

fn join_timeout(timeout_millis: u64) -> Duration {
    Duration::from_millis(timeout_millis.min(MAX_JOIN_MILLIS))
}

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{Read, Write};
    #[cfg(unix)]
    use std::os::fd::AsRawFd;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;

    use super::*;

    #[test]
    fn maps_exact_platform_removal_manifest() {
        let plan = map_saf_removal_plan(PlatformRemovalPlan {
            operation_id: "remove-1".to_owned(),
            torrent_id: "t1-owner".to_owned(),
            storage_root: "downloads".to_owned(),
            name: "show".to_owned(),
            tree: true,
            files: vec![rstorrent_session::PlatformRemovalPath {
                components: vec!["Season 01".to_owned(), "Episode 01.mkv".to_owned()],
            }],
            directories: vec![rstorrent_session::PlatformRemovalPath {
                components: vec!["Season 01".to_owned()],
            }],
        });

        assert!(plan.tree);
        assert_eq!(plan.files[0].components, ["Season 01", "Episode 01.mkv"]);
        assert_eq!(plan.directories[0].components, ["Season 01"]);
    }

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[tokio::test]
    async fn companion_connection_subscription_is_latest_value_and_closable() {
        let (sender, receiver) = watch::channel(0_usize);
        let subscription = AndroidCompanionConnectionSubscription::new(receiver);
        assert_eq!(subscription.next_count().await, Some(0));

        sender.send_replace(1);
        sender.send_replace(2);
        assert_eq!(subscription.next_count().await, Some(2));

        drop(sender);
        assert_eq!(subscription.next_count().await, None);
    }

    fn test_path(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "rstorrent-android-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn config(metainfo_path: String, output_path: String, peer_port: u16) -> EngineConfig {
        EngineConfig {
            metainfo_path,
            output_path,
            peer_port,
            timeout_seconds: 30,
            max_buffered_payload_bytes: 32 * 1024,
            storage_write_delay_millis: 0,
            skip_files: Vec::new(),
        }
    }

    async fn companion_http(port: u16, host: String, origin: String) -> String {
        tokio::task::spawn_blocking(move || {
            let mut stream = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                .expect("connect companion listener");
            stream
                .write_all(
                    format!(
                        "GET /rstorrent/companion/v1/hello HTTP/1.1\r\n\
                         Host: {host}\r\nOrigin: {origin}\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .expect("write companion request");
            let mut response = String::new();
            stream
                .read_to_string(&mut response)
                .expect("read companion response");
            response
        })
        .await
        .expect("join companion HTTP request")
    }

    #[test]
    fn product_application_policy_maps_online_explicitly() {
        let root = test_path("application-network");
        let config = validate_application_config(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: String::new(),
            platform_storage: true,
            platform_storage_roots: vec![AndroidPlatformStorageRoot {
                root_id: "downloads".to_owned(),
                label: "Downloads".to_owned(),
            }],
            network_policy: AndroidNetworkPolicy::Online,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .expect("valid Android application config");

        assert_eq!(config.network.policy, NetworkPolicy::Online);
        assert_eq!(
            config.peer_transport_policy,
            rstorrent_session::PeerTransportPolicy::PreferUtp
        );
        assert_eq!(
            config.initial_client_settings,
            rstorrent_session::ClientSettings::fresh_profile_default()
        );
        assert_eq!(config.network.peer_connect_timeout, Duration::from_secs(15));
        assert_eq!(config.network.peer_io_timeout, Duration::from_secs(60));
        assert_eq!(
            config.download_resource_limits,
            DownloadResourceLimits::ANDROID
        );
        assert_eq!(config.active_download_cap, Some(2));
        assert_eq!(
            config.initial_network_prerequisite,
            ApplicationNetworkPrerequisite::Allowed
        );
    }

    #[tokio::test]
    async fn product_application_converges_live_network_prerequisites() {
        let root = test_path("application-live-network-prerequisite");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite:
                AndroidApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open initially blocked product application");

        assert!(
            client
                .incoming_peer_snapshot()
                .await
                .expect("observe offline application")
                .is_none()
        );
        let allowed = client
            .set_network_prerequisite(AndroidApplicationNetworkPrerequisite::Allowed)
            .await
            .expect("allow product network owners");
        assert!(allowed.allowed);
        assert_eq!(allowed.requested_generation, allowed.effective_generation);
        let synchronously_closed = client
            .close_network_prerequisite()
            .expect("close product network permit without application lock");
        let blocked = client
            .set_network_prerequisite(
                AndroidApplicationNetworkPrerequisite::WaitingForUnmeteredNetwork,
            )
            .await
            .expect("block product network owners");
        assert!(!blocked.allowed);
        assert_eq!(blocked.requested_generation, blocked.effective_generation);
        assert_eq!(blocked.requested_generation, synchronously_closed);

        client
            .shutdown()
            .await
            .expect("shutdown product application");
        assert!(client.incoming_peer_snapshot().await.is_err());
        drop(client);
        fs::remove_dir_all(root).expect("remove product fixture");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn incoming_peer_observer_reports_real_rejections_with_bounded_history() {
        let root = test_path("application-incoming-observer");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::LoopbackOnly,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open loopback application");
        client
            .dispatch(RequestEnvelope {
                version: rstorrent_session::CONTROL_VERSION,
                request_id: "enable-owned-loopback-observer".to_owned(),
                expected_revision: None,
                command: rstorrent_session::Command::UpdateClientSettings {
                    patch: rstorrent_session::ClientSettingsPatch {
                        listener: Some(rstorrent_session::ListenerPolicy::AutomaticLoopback),
                        ..Default::default()
                    },
                },
            })
            .await
            .expect("enable only the owned loopback listener");
        // Settings dispatch persists the request; the maintenance owner applies
        // the listener asynchronously. Observe readiness rather than assuming
        // dispatch completion also means the listener has converged.
        let initial = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(snapshot) = client
                    .incoming_peer_snapshot()
                    .await
                    .expect("observe incoming")
                {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("listener becomes active within the readiness deadline");
        assert_ne!(initial.listen_port, 0);
        assert_eq!(initial.registrations, 0);
        assert_eq!(initial.pending, 0);
        assert_eq!(initial.established, 0);
        assert_eq!(initial.payload_bytes_sent, 0);
        for _ in 0..6 {
            let mut stream = std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([127, 0, 0, 1], initial.listen_port)),
                Duration::from_secs(2),
            )
            .expect("connect bounded unknown peer");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("bound peer read");
            stream
                .write_all(&rstorrent_protocol::peer_wire::encode_handshake(
                    [0xab; 20], [7; 20],
                ))
                .expect("send unknown hash");
            assert_eq!(
                stream.read(&mut [0; 1]).expect("receive rejected peer EOF"),
                0
            );
        }
        let observed = client
            .incoming_peer_snapshot()
            .await
            .expect("observe rejection")
            .expect("listener remains active");
        assert_eq!(observed.listen_port, initial.listen_port);
        assert_eq!(observed.rejection_counts.len(), 1);
        assert_eq!(observed.rejection_counts[0].reason, "UnknownTorrent");
        assert_eq!(observed.rejection_counts[0].count, 6);
        assert!(!observed.rejection_counts_truncated);
        assert_eq!(observed.recent_rejections.len(), 4);
        assert!(observed.recent_rejections_truncated);
        assert!(
            observed
                .recent_rejections
                .iter()
                .all(|entry| entry.reason == "UnknownTorrent"
                    && entry.info_hash.as_deref()
                        == Some("abababababababababababababababababababab"))
        );
        assert!(!format!("{observed:?}").contains("127.0.0.1"));
        client.shutdown().await.expect("join incoming application");
        assert!(client.incoming_peer_snapshot().await.is_err());
        drop(client);
        fs::remove_dir_all(root).expect("remove incoming fixture");
    }

    #[tokio::test]
    async fn product_privacy_boundary_requires_disclosure_and_report_consent() {
        let root = test_path("application-product-privacy");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open product application");

        assert_eq!(
            client
                .product_summary()
                .expect("summary")
                .disclosure_version,
            0
        );
        let undisclosed = client
            .product_feedback_preview("15".to_owned(), "Google Pixel 9".to_owned(), true)
            .expect("undisclosed preview");
        assert!(undisclosed.hosted_context_ready);
        assert!(!undisclosed.statistics_available);
        assert!(!undisclosed.statistics_included);
        let acknowledged = client
            .acknowledge_product_disclosure(true)
            .expect("acknowledge disclosure");
        assert!(acknowledged.transmission_allowed);
        assert_eq!(
            client
                .record_product_foreground_session()
                .expect("record foreground")
                .foreground_sessions,
            "1"
        );
        let preview = client
            .product_feedback_preview("15".to_owned(), "Google Pixel 9".to_owned(), true)
            .expect("preview feedback");
        assert!(preview.hosted_context_ready);
        assert!(preview.statistics_available);
        assert!(preview.statistics_included);
        assert_eq!(
            preview.url,
            format!(
                "https://jstorrent.com/feedback.html?platform=android&v=0.1-test&android=15&device=Google+Pixel+9&id={}&days=0&added=0&completed=0&sessions=1",
                acknowledged.installation_id
            )
        );
        assert_eq!(
            client
                .confirm_product_feedback(
                    "15".to_owned(),
                    "Google Pixel 9".to_owned(),
                    true,
                    preview.url.clone(),
                )
                .expect("confirm exact preview"),
            preview.url
        );
        assert!(
            client
                .confirm_product_feedback(
                    "15".to_owned(),
                    "Google Pixel 9".to_owned(),
                    true,
                    "https://jstorrent.com/feedback.html".to_owned(),
                )
                .is_err()
        );
        let omitted = client
            .product_feedback_preview("15".to_owned(), "Google Pixel 9".to_owned(), false)
            .expect("omit for this report");
        assert!(omitted.statistics_available);
        assert!(!omitted.statistics_included);
        assert_eq!(omitted.url, undisclosed.url);
        assert!(client.product_summary().unwrap().statistics_enabled);
        assert!(
            client
                .confirm_product_feedback(
                    "15".to_owned(),
                    "Google Pixel 9".to_owned(),
                    false,
                    preview.url,
                )
                .is_err()
        );
        client.set_product_statistics_enabled(false).unwrap();
        let disabled = client
            .product_feedback_preview("15".to_owned(), "Google Pixel 9".to_owned(), true)
            .expect("durable opt-out");
        assert!(!disabled.statistics_available);
        assert!(!disabled.statistics_included);
        assert_eq!(disabled.url, undisclosed.url);
        client
            .shutdown()
            .await
            .expect("shutdown product application");
        drop(client);
        fs::remove_dir_all(root).expect("remove product fixture");
    }

    #[tokio::test]
    async fn product_media_server_starts_once_on_demand_and_stops_with_application() {
        let root = test_path("application-media-server");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open product application");

        assert!(client.media_server.lock().await.is_none());
        let (first, second) = tokio::join!(
            client.create_media_url("not-a-torrent".to_owned(), 0),
            client.create_media_url("also-not-a-torrent".to_owned(), 1),
        );
        assert!(matches!(
            first.expect("first media request").outcome,
            rstorrent_session::MediaUrlOutcome::Unavailable {
                reason: rstorrent_session::MediaFileAvailability::MetadataUnavailable
            }
        ));
        assert!(matches!(
            second.expect("second media request").outcome,
            rstorrent_session::MediaUrlOutcome::Unavailable {
                reason: rstorrent_session::MediaFileAvailability::MetadataUnavailable
            }
        ));
        let media_addr = client
            .media_server
            .lock()
            .await
            .as_ref()
            .expect("media listener after first request")
            .local_addr();
        assert_eq!(media_addr.ip(), Ipv4Addr::LOCALHOST);
        client
            .create_media_url("third-invalid-torrent".to_owned(), 2)
            .await
            .expect("reuse media listener");
        assert_eq!(
            client
                .media_server
                .lock()
                .await
                .as_ref()
                .expect("same media listener")
                .local_addr(),
            media_addr
        );

        client
            .shutdown()
            .await
            .expect("shutdown product application");
        assert!(client.media_server.lock().await.is_none());
        assert!(tokio::net::TcpStream::connect(media_addr).await.is_err());
        assert!(
            client
                .create_media_url("post-shutdown".to_owned(), 0)
                .await
                .is_err()
        );
        drop(client);
        fs::remove_dir_all(root).expect("remove product fixture");
    }

    #[tokio::test]
    async fn product_application_accepts_bounded_torrent_bytes() {
        let root = test_path("application-torrent-bytes");
        let profile = root.join("profile");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: profile.display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open product application");
        let source = two_file_metainfo();
        let response = client
            .add_torrent_bytes(
                AddTorrentBytesRequest {
                    version: 1,
                    request_id: "android-file-1".to_owned(),
                    expected_revision: None,
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    selection: rstorrent_session::FileSelectionIntent::All,
                    source_length: u32::try_from(source.len()).expect("fixture fits u32"),
                },
                source,
            )
            .await
            .expect("submit torrent bytes");

        assert!(matches!(
            response.outcome,
            rstorrent_session::ResponseOutcome::Success { .. }
        ));
        assert!(matches!(
            response.result,
            Some(rstorrent_session::CommandResult::AddTorrent { .. })
        ));
        client
            .shutdown()
            .await
            .expect("shutdown product application");
        fs::remove_dir_all(root).expect("remove product fixture");
    }

    #[tokio::test]
    async fn product_shutdown_cancels_probe_queued_without_a_provider() {
        let root = test_path("application-platform-shutdown");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: String::new(),
            platform_storage: true,
            platform_storage_roots: vec![AndroidPlatformStorageRoot {
                root_id: "downloads".to_owned(),
                label: "Downloads".to_owned(),
            }],
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open platform product application");
        let probe_client = client.clone();
        let probe = tokio::spawn(async move { probe_client.probe_saf_storage_roots().await });
        tokio::task::yield_now().await;

        tokio::time::timeout(Duration::from_secs(2), client.shutdown())
            .await
            .expect("platform shutdown timed out")
            .expect("shutdown platform application");
        assert!(
            !probe
                .await
                .expect("join platform probe")
                .expect("cancelled probe result")
        );
        fs::remove_dir_all(root).expect("remove platform product fixture");
    }

    #[tokio::test]
    async fn product_companion_uses_the_shared_application_owner() {
        let root = test_path("application-companion-owner");
        let content = root.join("content");
        fs::create_dir_all(&content).expect("create content root");
        let client = AndroidApplicationClient::open(AndroidApplicationConfig {
            product_data_root: root.join("product").display().to_string(),
            product_version: "0.1-test".to_owned(),
            profile_root: root.join("profile").display().to_string(),
            profile_id: "test".to_owned(),
            storage_root: content.display().to_string(),
            platform_storage: false,
            platform_storage_roots: Vec::new(),
            network_policy: AndroidNetworkPolicy::Offline,
            initial_network_prerequisite: AndroidApplicationNetworkPrerequisite::Allowed,
            peer_connect_timeout_seconds: 15,
            peer_io_timeout_seconds: 60,
        })
        .await
        .expect("open product application");
        let port = client
            .start_chromeos_companion_on(Some(Ipv4Addr::LOCALHOST))
            .await
            .expect("start companion");
        assert!(rstorrent_gateway::ANDROID_COMPANION_PORTS.contains(&port));
        assert_eq!(
            client
                .start_chromeos_companion()
                .await
                .expect("reuse companion"),
            port
        );
        let accepted = companion_http(
            port,
            format!("{}:{port}", rstorrent_gateway::ARC_COMPANION_HOST),
            rstorrent_gateway::BETA_EXTENSION_ORIGIN.to_owned(),
        )
        .await;
        assert!(accepted.starts_with("HTTP/1.1 200"), "{accepted}");
        assert!(accepted.contains("\"backend\":\"android\""));
        let wrong_host = companion_http(
            port,
            format!("127.0.0.1:{port}"),
            rstorrent_gateway::BETA_EXTENSION_ORIGIN.to_owned(),
        )
        .await;
        assert!(wrong_host.starts_with("HTTP/1.1 403"), "{wrong_host}");
        let wrong_origin = companion_http(
            port,
            format!("{}:{port}", rstorrent_gateway::ARC_COMPANION_HOST),
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
        )
        .await;
        assert!(wrong_origin.starts_with("HTTP/1.1 403"), "{wrong_origin}");
        assert_eq!(
            client
                .saf_storage_snapshot()
                .await
                .expect("shared storage while listener is active")
                .default_root
                .as_deref(),
            Some("downloads")
        );

        let hello = client
            .companion_pairings
            .hello(rstorrent_gateway::BETA_EXTENSION_ORIGIN, port)
            .expect("companion hello");
        let requested = client
            .companion_pairings
            .request_pairing(
                rstorrent_gateway::BETA_EXTENSION_ORIGIN,
                &hello.nonce,
                "installation_1234",
                "extension_nonce_1234",
            )
            .expect("pairing request");
        assert_eq!(
            client
                .pending_companion_pairing()
                .expect("Android pending pairing")
                .request_id,
            requested.request_id
        );
        client
            .approve_companion_pairing(requested.request_id.clone())
            .expect("approve from Android owner");
        assert!(
            client
                .companion_pairings
                .poll(
                    rstorrent_gateway::BETA_EXTENSION_ORIGIN,
                    &requested.request_id,
                    "installation_1234",
                    "extension_nonce_1234",
                )
                .expect("poll pairing")
                .credential
                .is_some()
        );

        client
            .stop_chromeos_companion()
            .await
            .expect("stop companion before application");
        assert_eq!(
            client
                .saf_storage_snapshot()
                .await
                .expect("application remains after listener stop")
                .default_root
                .as_deref(),
            Some("downloads")
        );
        client
            .shutdown()
            .await
            .expect("shutdown product application");
        fs::remove_dir_all(root).expect("remove companion product fixture");
    }

    fn two_file_metainfo() -> Vec<u8> {
        let mut metainfo = b"d4:infod5:filesld6:lengthi1e4:pathl1:aee\
d6:lengthi32768e4:pathl1:beee4:name7:fixture12:piece lengthi32768e\
6:pieces40:"
            .to_vec();
        metainfo.extend_from_slice(&[1; 40]);
        metainfo.extend_from_slice(b"ee");
        metainfo
    }

    #[test]
    fn plans_exact_direct_saf_roles() {
        let plan = saf_storage_plan(two_file_metainfo(), vec![1]);
        assert!(plan.valid, "{:?}", plan.message);
        assert_eq!(plan.name, "fixture");
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.files[0].role, SafFileRole::Wanted);
        assert_eq!(plan.files[1].role, SafFileRole::Skipped);
    }

    #[cfg(unix)]
    #[test]
    fn duplicates_borrowed_descriptors_and_hashes_with_a_fixed_buffer() {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "rstorrent-android-descriptor-test-{}-{sequence}",
            std::process::id()
        ));
        let mut caller = fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .expect("create descriptor fixture");
        caller
            .write_all(b"descriptor bytes")
            .expect("write fixture");
        caller.sync_all().expect("sync fixture");
        let mut owned = duplicate_descriptor(caller.as_raw_fd()).expect("duplicate descriptor");
        drop(caller);
        owned
            .seek(SeekFrom::Start(0))
            .expect("seek owned descriptor");
        let mut bytes = Vec::new();
        owned
            .read_to_end(&mut bytes)
            .expect("read owned descriptor");
        assert_eq!(bytes, b"descriptor bytes");
        let expected = hex(&Sha1::digest(&bytes));
        let inspection =
            inspect_borrowed_descriptor(owned.as_raw_fd(), bytes.len() as u64, expected.clone());
        assert!(inspection.success, "{:?}", inspection.message);
        assert_eq!(inspection.sha1_hex, expected);
        drop(owned);
        fs::remove_file(path).expect("remove descriptor fixture");
    }

    #[test]
    fn rejects_invalid_saf_descriptors_without_starting() {
        let session = EngineSession::new();
        let result = session.start_saf(
            config("/does/not/matter".to_owned(), "saf".to_owned(), 1),
            SafStorage {
                wanted_files: Vec::new(),
                part_fd: -1,
                reopened_part_fd: -1,
            },
        );
        assert_eq!(result.disposition, StartDisposition::Rejected);
        assert_eq!(session.snapshot().state, SessionState::Idle);
        assert!(!session.snapshot().task_alive);
    }

    #[test]
    fn rejects_unbounded_configuration_before_starting() {
        let session = EngineSession::new();
        let mut invalid = config(
            "/does/not/matter".to_owned(),
            "/does/not/matter".to_owned(),
            1,
        );
        invalid.max_buffered_payload_bytes = MAX_PAYLOAD_BYTES + 1;
        let result = session.start(invalid);
        assert_eq!(result.disposition, StartDisposition::Rejected);
        assert_eq!(session.snapshot().state, SessionState::Idle);
        assert!(!session.snapshot().task_alive);
    }

    #[test]
    fn rejects_duplicate_start_and_joins_cancellation() {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "rstorrent-android-test-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("create test root");
        let metainfo_path = root.join("fixture.torrent");
        let output_path = root.join("output.bin");
        let mut metainfo =
            b"d4:infod6:lengthi1e4:name1:x12:piece lengthi16384e6:pieces20:".to_vec();
        metainfo.extend_from_slice(&[1; 20]);
        metainfo.extend_from_slice(b"ee");
        fs::write(&metainfo_path, metainfo).expect("write metainfo");

        let listener =
            std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind controlled peer");
        let peer_port = listener.local_addr().expect("peer address").port();
        let (accepted_sender, accepted_receiver) = mpsc::channel();
        let peer = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept engine");
            accepted_sender.send(()).expect("signal accept");
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).expect("read until cancel");
        });

        let config = config(
            metainfo_path.display().to_string(),
            output_path.display().to_string(),
            peer_port,
        );
        let session = EngineSession::new();
        let first = session.start(config.clone());
        assert_eq!(first.disposition, StartDisposition::Started);
        accepted_receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("engine connected");
        let second = session.start(config);
        assert_eq!(second.disposition, StartDisposition::Busy);

        let joined = session.cancel_and_join(5_000);
        assert!(joined.joined);
        assert_eq!(
            joined.terminal.expect("terminal result").outcome,
            TerminalOutcome::Cancelled
        );
        let snapshot = session.snapshot();
        assert_eq!(snapshot.state, SessionState::Cancelled);
        assert!(!snapshot.task_alive);
        assert_eq!(snapshot.buffered_payload_bytes, 0);
        assert_eq!(snapshot.requested_bytes, 0);
        assert_eq!(snapshot.received_bytes, 0);
        assert_eq!(snapshot.stored_bytes, 0);

        let repeated = session.cancel_and_join(1);
        assert!(repeated.joined);
        assert_eq!(
            repeated.terminal.expect("terminal result").outcome,
            TerminalOutcome::Cancelled
        );
        peer.join().expect("peer thread");
        assert!(!output_path.exists());
        fs::remove_dir_all(root).expect("remove test root");
    }
}
