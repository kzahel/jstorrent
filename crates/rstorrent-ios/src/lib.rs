//! Coarse Apple control plane for an in-process RSTorrent engine.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek};
use std::os::fd::FromRawFd;
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rstorrent_engine::{
    DownloadResourceLimits, NetworkConfig, NetworkPolicy, PlatformStorageBroker,
    PlatformStorageFailure, PlatformStorageFailureKind, PlatformStorageOperation,
    StorageFileAccess, StorageFileKey, StorageFileLocator, StorageFilePool, StorageFileReference,
    StorageFileRole, StorageObjectKind, StorageObservation, platform_storage_channel,
};
use rstorrent_session::{
    AddTorrentBytesRequest, ApplicationConfig, ApplicationService, ConfiguredStorageRoot,
    PlatformFilePlan, PlatformRemovalPlan, RequestEnvelope, ResponseEnvelope,
    StorageRootAvailability, SubscriptionSpec, ViewSubscription, ViewUpdate,
};
use sha1::{Digest, Sha1};
use tokio::sync::Mutex as AsyncMutex;

const INTERFACE_VERSION: &str = "rstorrent-ios/0.1.0;uniffi/0.31.0";
const MAX_PATH_BYTES: usize = 4 * 1024;
const MAX_ROOTS: usize = 8;
const MAX_ROOT_ID_BYTES: usize = 128;
const MAX_ROOT_LABEL_BYTES: usize = 256;
const MAX_TIMEOUT_SECONDS: u64 = 5 * 60;
const IOS_STORAGE_FILE_LIMIT: usize = 8;
const QUALIFICATION_DIRECTORY: &str = ".rstorrent-ios-qualification";

uniffi::setup_scaffolding!();

#[derive(Clone, Copy, Debug, uniffi::Enum)]
pub enum IosNetworkPolicy {
    Offline,
    LoopbackOnly,
    Online,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosStorageRootConfig {
    pub id: String,
    pub label: String,
    /// Absolute path for app-owned roots; absent for bookmark-backed roots.
    pub path: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosApplicationConfig {
    pub profile_root: String,
    pub profile_id: String,
    pub storage_roots: Vec<IosStorageRootConfig>,
    pub network_policy: IosNetworkPolicy,
    pub peer_connect_timeout_seconds: u64,
    pub peer_io_timeout_seconds: u64,
}

#[derive(Debug, uniffi::Error)]
pub enum IosClientError {
    Failure { detail: String },
}

impl std::fmt::Display for IosClientError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failure { detail } => formatter.write_str(detail),
        }
    }
}

impl std::error::Error for IosClientError {}

impl IosClientError {
    fn message(message: impl Into<String>) -> Self {
        Self::Failure {
            detail: message.into(),
        }
    }
}

#[derive(Debug, uniffi::Object)]
pub struct IosApplicationClient {
    service: Arc<AsyncMutex<Option<ApplicationService>>>,
    platform_storage: Arc<PlatformStorageBroker>,
}

#[derive(Debug, uniffi::Object)]
pub struct IosViewSubscription {
    subscription: ViewSubscription,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum IosDynamicFileRole {
    ContentRoot,
    Payload,
    Part,
    /// The PlaysVideo sidecar; an opener truncates it for an in-place rewrite.
    DownloadManifest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum IosStorageAccess {
    ReadExisting,
    ReadWriteExisting,
    ReadWriteCreate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum IosStorageOperation {
    Open,
    Observe,
    Delete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum IosStorageObjectKind {
    File,
    Directory,
    Other,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosStorageObservation {
    pub exists: bool,
    pub kind: Option<IosStorageObjectKind>,
    pub length: Option<u64>,
    pub opaque_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, uniffi::Enum)]
pub enum IosStorageFailureKind {
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
pub struct IosStorageRequest {
    pub request_id: u64,
    pub root_id: String,
    pub storage_id: String,
    pub storage_generation: u64,
    pub role: IosDynamicFileRole,
    pub file_index: u32,
    pub path: Vec<String>,
    pub operation: IosStorageOperation,
    pub access: IosStorageAccess,
    pub timeout_millis: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosStoragePoolSnapshot {
    pub limit: u64,
    pub current_owned: u64,
    pub owned_high_water: u64,
    pub cached_entries: u64,
    pub platform_pending: u64,
    pub platform_pending_high_water: u64,
    pub pending_releases: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosRemovalPath {
    pub components: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosRemovalPlan {
    pub operation_id: String,
    pub torrent_id: String,
    pub storage_root: String,
    pub name: String,
    pub tree: bool,
    pub files: Vec<IosRemovalPath>,
    pub directories: Vec<IosRemovalPath>,
    /// Exact PlaysVideo sidecar names: beside a single file, or inside the
    /// content directory of a tree.
    pub download_manifests: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosFilePlan {
    pub torrent_id: String,
    pub storage_root: String,
    pub components: Vec<String>,
    pub length: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosRootQualification {
    pub sha1_hex: String,
    pub initial_length: u64,
    pub truncated_length: u64,
    pub name_collision_rejected: bool,
    pub handle_high_water: u64,
    pub cached_after_shutdown: u64,
    pub owned_after_shutdown: u64,
    pub cleanup_complete: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IosStorageRootHealth {
    pub root_id: String,
    pub available: bool,
}

#[uniffi::export(async_runtime = "tokio")]
impl IosApplicationClient {
    #[uniffi::constructor]
    pub async fn open(config: IosApplicationConfig) -> Result<Arc<Self>, IosClientError> {
        let (platform_client, platform_storage) = platform_storage_channel();
        let mut application_config = validate_application_config(config)?;
        let platform_enabled = application_config.storage_roots.iter().any(|root| {
            matches!(
                root.location,
                rstorrent_session::StorageRootLocation::PlatformCapability
            )
        });
        if platform_enabled {
            application_config.platform_storage_client = Some(platform_client);
        }
        let service = ApplicationService::open(application_config)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))?;
        let service = Arc::new(AsyncMutex::new(Some(service)));
        ApplicationService::ensure_optional_maintenance_owner(&service).await;
        Ok(Arc::new(Self {
            service,
            platform_storage,
        }))
    }

    pub async fn dispatch(
        &self,
        request: RequestEnvelope,
    ) -> Result<ResponseEnvelope, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .dispatch(request)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn add_torrent_bytes(
        &self,
        request: AddTorrentBytesRequest,
        source: Vec<u8>,
    ) -> Result<ResponseEnvelope, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .add_torrent_bytes(request, source)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn subscribe(
        &self,
        spec: SubscriptionSpec,
    ) -> Result<Arc<IosViewSubscription>, IosClientError> {
        let subscription = self
            .service
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .subscribe(spec)
            .map_err(|error| IosClientError::message(error.to_string()))?;
        Ok(Arc::new(IosViewSubscription { subscription }))
    }

    pub async fn probe_platform_storage_roots(&self) -> Result<bool, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .probe_platform_storage_roots()
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn storage_root_health(&self) -> Result<Vec<IosStorageRootHealth>, IosClientError> {
        self.service
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .storage_snapshot()
            .map(|storage| {
                storage
                    .roots
                    .into_iter()
                    .map(|root| IosStorageRootHealth {
                        root_id: root.root_id,
                        available: root.availability == StorageRootAvailability::Available,
                    })
                    .collect()
            })
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn prepare_platform_root_replacement(
        &self,
        root_id: String,
    ) -> Result<Vec<String>, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .prepare_platform_storage_replacement(&root_id)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn removal_plan(&self, torrent_id: String) -> Result<IosRemovalPlan, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .platform_removal_plan(&torrent_id)
            .await
            .map(map_removal_plan)
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn file_plan(
        &self,
        torrent_id: String,
        file_index: u32,
    ) -> Result<IosFilePlan, IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .platform_file_plan(&torrent_id, file_index)
            .await
            .map(map_file_plan)
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn confirm_removal(
        &self,
        torrent_id: String,
        operation_id: String,
    ) -> Result<(), IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .confirm_platform_removal(&torrent_id, &operation_id)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn fail_removal(
        &self,
        torrent_id: String,
        operation_id: String,
        message: String,
    ) -> Result<(), IosClientError> {
        self.service
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .fail_platform_removal(&torrent_id, &operation_id, &message)
            .await
            .map_err(|error| IosClientError::message(error.to_string()))
    }

    pub async fn next_storage_request(&self) -> Option<IosStorageRequest> {
        self.platform_storage.next_request().await.map(map_request)
    }

    pub async fn next_storage_release(&self) -> Option<u64> {
        self.platform_storage.next_release().await
    }

    pub fn acknowledge_storage_release(&self, release_id: u64) -> bool {
        self.platform_storage.acknowledge_release(release_id)
    }

    pub fn complete_storage_request(
        &self,
        request_id: u64,
        fd: i32,
        access: IosStorageAccess,
        release_id: u64,
    ) -> Result<bool, IosClientError> {
        if !self.platform_storage.is_pending(request_id) {
            return Ok(false);
        }
        validate_descriptor_access(fd, access).map_err(IosClientError::message)?;
        let mut file = duplicate_descriptor(fd).map_err(IosClientError::message)?;
        file.stream_position()
            .map_err(|error| IosClientError::message(error.to_string()))?;
        Ok(self
            .platform_storage
            .complete_leased_file(request_id, file, release_id))
    }

    pub fn complete_storage_delete(&self, request_id: u64) -> bool {
        self.platform_storage.complete_deleted(request_id)
    }

    pub fn complete_storage_observation(
        &self,
        request_id: u64,
        observation: IosStorageObservation,
    ) -> Result<bool, IosClientError> {
        let observation = map_observation(observation)?;
        Ok(self
            .platform_storage
            .complete_observation(request_id, observation))
    }

    pub fn fail_storage_request(
        &self,
        request_id: u64,
        kind: IosStorageFailureKind,
        message: String,
    ) -> bool {
        self.platform_storage.complete_error(
            request_id,
            PlatformStorageFailure::new(map_failure_kind(kind), message),
        )
    }

    pub async fn storage_pool_snapshot(&self) -> Result<IosStoragePoolSnapshot, IosClientError> {
        let snapshot = self
            .service
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| IosClientError::message("application client is shut down"))?
            .storage_file_pool_snapshot();
        Ok(IosStoragePoolSnapshot {
            limit: snapshot.limit as u64,
            current_owned: snapshot.current_owned as u64,
            owned_high_water: snapshot.owned_high_water as u64,
            cached_entries: snapshot.cached_entries as u64,
            platform_pending: snapshot.platform_pending as u64,
            platform_pending_high_water: snapshot.platform_pending_high_water as u64,
            pending_releases: self.platform_storage.pending_releases() as u64,
        })
    }

    pub async fn shutdown(&self) -> Result<(), IosClientError> {
        self.platform_storage.cancel_pending();
        let service = self.service.lock().await.take();
        if let Some(mut service) = service {
            service
                .shutdown()
                .await
                .map_err(|error| IosClientError::message(error.to_string()))?;
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while self.platform_storage.pending_releases() != 0
            && tokio::time::Instant::now() < deadline
        {
            tokio::task::yield_now().await;
        }
        if self.platform_storage.pending_releases() != 0 {
            return Err(IosClientError::message(
                "platform storage releases did not drain during shutdown",
            ));
        }
        self.platform_storage.close_release_stream();
        Ok(())
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl IosViewSubscription {
    pub fn stream_id(&self) -> String {
        self.subscription.stream_id()
    }

    pub async fn next_update(&self) -> Option<ViewUpdate> {
        self.subscription.next_update().await
    }

    pub fn resync(&self) -> Result<(), IosClientError> {
        self.subscription
            .resync()
            .map_err(|error| IosClientError::message(error.to_string()))
    }
}

impl Drop for IosViewSubscription {
    fn drop(&mut self) {
        self.subscription.close();
    }
}

#[uniffi::export]
pub fn interface_version() -> String {
    INTERFACE_VERSION.to_owned()
}

#[uniffi::export]
pub fn qualify_root(root_path: String) -> Result<IosRootQualification, IosClientError> {
    let root = absolute_path(root_path, "qualification root")?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            IosClientError::message(format!("build qualification runtime: {error}"))
        })?;
    runtime
        .block_on(run_root_qualification(root))
        .map_err(IosClientError::message)
}

async fn run_root_qualification(root: PathBuf) -> Result<IosRootQualification, String> {
    const INITIAL_LENGTH: u64 = 64 * 1024;
    const TRUNCATED_LENGTH: u64 = 40 * 1024;
    let workspace = root.join(QUALIFICATION_DIRECTORY);
    remove_owned_workspace(&workspace)?;
    let nested = workspace.join("nested").join("deeper");
    fs::create_dir_all(&nested).map_err(|error| format!("create qualification tree: {error}"))?;
    let source = nested.join("payload.bin");
    let pool = StorageFilePool::new(IOS_STORAGE_FILE_LIMIT, None).map_err(str::to_owned)?;
    let source_reference = qualification_reference(&pool, source.clone(), 0, 0);
    let handle = source_reference
        .open(StorageFileAccess::ReadWriteCreate)
        .await
        .map_err(|error| format!("open qualification source: {error}"))?;
    handle
        .file()
        .set_len(INITIAL_LENGTH)
        .map_err(|error| format!("size qualification source: {error}"))?;
    let first = qualification_pattern(4096, 17);
    let second = qualification_pattern(8192, 91);
    handle
        .file()
        .write_all_at(&first, 3072)
        .map_err(|error| format!("positioned first write: {error}"))?;
    handle
        .file()
        .write_all_at(&second, 37 * 1024)
        .map_err(|error| format!("positioned second write: {error}"))?;
    handle
        .file()
        .sync_all()
        .map_err(|error| format!("sync qualification source: {error}"))?;
    let mut first_read = vec![0; first.len()];
    let mut second_read = vec![0; second.len()];
    handle
        .file()
        .read_exact_at(&mut first_read, 3072)
        .map_err(|error| format!("positioned first read: {error}"))?;
    handle
        .file()
        .read_exact_at(&mut second_read, 37 * 1024)
        .map_err(|error| format!("positioned second read: {error}"))?;
    if first_read != first || second_read != second {
        return Err("positioned qualification read changed bytes".to_owned());
    }
    drop(handle);
    pool.invalidate_storage("ios-root-qualification");
    let sha1_hex = qualification_sha1(&source)?;

    let name_collision_rejected = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&source)
        .is_err();
    if !name_collision_rejected {
        return Err("exclusive create replaced the qualification file".to_owned());
    }

    let direct_reference = qualification_reference(&pool, source.clone(), 0, 1);
    let direct_handle = direct_reference
        .open(StorageFileAccess::ReadWriteExisting)
        .await
        .map_err(|error| format!("reopen qualification file: {error}"))?;
    let mut reopened = vec![0; second.len()];
    direct_handle
        .file()
        .read_exact_at(&mut reopened, 37 * 1024)
        .map_err(|error| format!("read qualification file: {error}"))?;
    if reopened != second {
        return Err("reopened qualification file changed bytes".to_owned());
    }
    direct_handle
        .file()
        .set_len(TRUNCATED_LENGTH)
        .map_err(|error| format!("truncate qualification file: {error}"))?;
    direct_handle
        .file()
        .sync_all()
        .map_err(|error| format!("sync qualification file: {error}"))?;
    drop(direct_handle);
    pool.invalidate_storage("ios-root-qualification");
    direct_reference
        .delete()
        .await
        .map_err(|error| format!("delete qualification file: {error}"))?;

    let before_shutdown = pool.snapshot();
    pool.shutdown()
        .await
        .map_err(|error| format!("shutdown qualification pool: {error}"))?;
    let after_shutdown = pool.snapshot();
    remove_owned_workspace(&workspace)?;
    let cleanup_complete = !workspace.exists();
    if !cleanup_complete {
        return Err("qualification workspace remained after cleanup".to_owned());
    }
    Ok(IosRootQualification {
        sha1_hex,
        initial_length: INITIAL_LENGTH,
        truncated_length: TRUNCATED_LENGTH,
        name_collision_rejected,
        handle_high_water: before_shutdown.owned_high_water as u64,
        cached_after_shutdown: after_shutdown.cached_entries as u64,
        owned_after_shutdown: after_shutdown.current_owned as u64,
        cleanup_complete,
    })
}

fn qualification_reference(
    pool: &StorageFilePool,
    path: PathBuf,
    file_index: usize,
    generation: u64,
) -> StorageFileReference {
    StorageFileReference::new(
        pool.clone(),
        StorageFileKey {
            storage_id: "ios-root-qualification".to_owned(),
            storage_generation: generation,
            role: StorageFileRole::Payload(file_index),
        },
        StorageFileLocator::Path(path),
    )
}

fn qualification_pattern(length: usize, seed: u8) -> Vec<u8> {
    (0..length)
        .map(|index| seed.wrapping_add((index as u8).wrapping_mul(31)))
        .collect()
}

fn qualification_sha1(path: &std::path::Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("open for SHA-1: {error}"))?;
    let mut digest = Sha1::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read for SHA-1: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn remove_owned_workspace(path: &std::path::Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove qualification workspace: {error}")),
    }
}

fn validate_application_config(
    config: IosApplicationConfig,
) -> Result<ApplicationConfig, IosClientError> {
    if config.storage_roots.is_empty() || config.storage_roots.len() > MAX_ROOTS {
        return Err(IosClientError::message(format!(
            "storage roots must contain 1..={MAX_ROOTS} entries"
        )));
    }
    if config.peer_connect_timeout_seconds == 0
        || config.peer_connect_timeout_seconds > MAX_TIMEOUT_SECONDS
        || config.peer_io_timeout_seconds == 0
        || config.peer_io_timeout_seconds > MAX_TIMEOUT_SECONDS
    {
        return Err(IosClientError::message(format!(
            "peer timeouts must be 1..={MAX_TIMEOUT_SECONDS} seconds"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let roots = config
        .storage_roots
        .into_iter()
        .map(|root| {
            validate_text(&root.id, "root ID", MAX_ROOT_ID_BYTES)?;
            validate_text(&root.label, "root label", MAX_ROOT_LABEL_BYTES)?;
            if !seen.insert(root.id.clone()) {
                return Err(IosClientError::message("storage root IDs must be unique"));
            }
            Ok(match root.path {
                Some(path) => {
                    ConfiguredStorageRoot::path(root.id, absolute_path(path, "storage root path")?)
                        .with_label(root.label)
                }
                None => ConfiguredStorageRoot::platform(root.id).with_label(root.label),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let network_policy = match config.network_policy {
        IosNetworkPolicy::Offline => NetworkPolicy::Offline,
        IosNetworkPolicy::LoopbackOnly => NetworkPolicy::LoopbackOnly,
        IosNetworkPolicy::Online => NetworkPolicy::Online,
    };
    let mut application = ApplicationConfig::new(
        absolute_path(config.profile_root, "profile root")?,
        config.profile_id,
        roots,
        NetworkConfig::new(
            network_policy,
            Duration::from_secs(config.peer_connect_timeout_seconds),
            Duration::from_secs(config.peer_io_timeout_seconds),
        ),
    );
    if network_policy == NetworkPolicy::Online {
        application = application.with_fresh_profile_defaults();
    }
    application.download_resource_limits = DownloadResourceLimits::ANDROID;
    application.active_download_cap = Some(2);
    application.storage_file_limit = IOS_STORAGE_FILE_LIMIT;
    Ok(application)
}

fn validate_text(value: &str, label: &str, maximum: usize) -> Result<(), IosClientError> {
    if value.is_empty() || value.len() > maximum || value.as_bytes().contains(&0) {
        return Err(IosClientError::message(format!(
            "{label} must be 1..={maximum} bytes without NUL"
        )));
    }
    Ok(())
}

fn absolute_path(value: String, label: &str) -> Result<PathBuf, IosClientError> {
    validate_text(&value, label, MAX_PATH_BYTES)?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(IosClientError::message(format!("{label} must be absolute")));
    }
    Ok(path)
}

fn map_request(request: rstorrent_engine::PlatformStorageRequest) -> IosStorageRequest {
    let (role, file_index) = match request.role {
        StorageFileRole::ContentRoot => (IosDynamicFileRole::ContentRoot, 0),
        StorageFileRole::Payload(file_index) => (
            IosDynamicFileRole::Payload,
            u32::try_from(file_index).unwrap_or(u32::MAX),
        ),
        StorageFileRole::Part => (IosDynamicFileRole::Part, 0),
        StorageFileRole::DownloadManifest => (IosDynamicFileRole::DownloadManifest, 0),
    };
    IosStorageRequest {
        request_id: request.request_id,
        root_id: request.root_id,
        storage_id: request.storage_id,
        storage_generation: request.storage_generation,
        role,
        file_index,
        path: request.path,
        operation: match request.operation {
            PlatformStorageOperation::Open => IosStorageOperation::Open,
            PlatformStorageOperation::Observe => IosStorageOperation::Observe,
            PlatformStorageOperation::Delete => IosStorageOperation::Delete,
        },
        access: match request.access {
            StorageFileAccess::ReadExisting => IosStorageAccess::ReadExisting,
            StorageFileAccess::ReadWriteExisting => IosStorageAccess::ReadWriteExisting,
            StorageFileAccess::ReadWriteCreate => IosStorageAccess::ReadWriteCreate,
        },
        timeout_millis: request.timeout_millis,
    }
}

fn map_observation(
    observation: IosStorageObservation,
) -> Result<StorageObservation, IosClientError> {
    if !observation.exists {
        if observation.kind.is_some()
            || observation.length.is_some()
            || observation.opaque_token.is_some()
        {
            return Err(IosClientError::message(
                "missing observation contains present-only fields",
            ));
        }
        return Ok(StorageObservation::missing());
    }
    let kind = observation
        .kind
        .ok_or_else(|| IosClientError::message("present observation has no kind"))?;
    StorageObservation::present(
        match kind {
            IosStorageObjectKind::File => StorageObjectKind::File,
            IosStorageObjectKind::Directory => StorageObjectKind::Directory,
            IosStorageObjectKind::Other => StorageObjectKind::Other,
        },
        observation.length,
        observation.opaque_token,
    )
    .map_err(|error| IosClientError::message(error.to_string()))
}

fn map_failure_kind(kind: IosStorageFailureKind) -> PlatformStorageFailureKind {
    match kind {
        IosStorageFailureKind::Missing => PlatformStorageFailureKind::Missing,
        IosStorageFailureKind::GrantUnavailable => PlatformStorageFailureKind::GrantUnavailable,
        IosStorageFailureKind::PermissionDenied => PlatformStorageFailureKind::PermissionDenied,
        IosStorageFailureKind::WrongKind => PlatformStorageFailureKind::WrongKind,
        IosStorageFailureKind::NameCollision => PlatformStorageFailureKind::NameCollision,
        IosStorageFailureKind::StaleGeneration => PlatformStorageFailureKind::StaleGeneration,
        IosStorageFailureKind::ProviderRefused => PlatformStorageFailureKind::ProviderRefused,
        IosStorageFailureKind::NonSeekable => PlatformStorageFailureKind::NonSeekable,
        IosStorageFailureKind::Cancelled => PlatformStorageFailureKind::Cancelled,
        IosStorageFailureKind::DeadlineExceeded => PlatformStorageFailureKind::DeadlineExceeded,
        IosStorageFailureKind::Internal => PlatformStorageFailureKind::Internal,
    }
}

fn map_removal_plan(plan: PlatformRemovalPlan) -> IosRemovalPlan {
    IosRemovalPlan {
        operation_id: plan.operation_id,
        torrent_id: plan.torrent_id,
        storage_root: plan.storage_root,
        name: plan.name,
        tree: plan.tree,
        files: plan
            .files
            .into_iter()
            .map(|path| IosRemovalPath {
                components: path.components,
            })
            .collect(),
        directories: plan
            .directories
            .into_iter()
            .map(|path| IosRemovalPath {
                components: path.components,
            })
            .collect(),
        download_manifests: plan.download_manifests,
    }
}

fn map_file_plan(plan: PlatformFilePlan) -> IosFilePlan {
    IosFilePlan {
        torrent_id: plan.torrent_id,
        storage_root: plan.storage_root,
        components: plan.components,
        length: plan.length,
    }
}

fn duplicate_descriptor(fd: i32) -> Result<File, String> {
    if fd < 0 {
        return Err(format!("descriptor {fd} is invalid"));
    }
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

fn validate_descriptor_access(fd: i32, access: IosStorageAccess) -> Result<(), String> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(format!(
            "inspect descriptor access: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mode = flags & libc::O_ACCMODE;
    let compatible = match access {
        IosStorageAccess::ReadExisting => mode != libc::O_WRONLY,
        IosStorageAccess::ReadWriteExisting | IosStorageAccess::ReadWriteCreate => {
            mode == libc::O_RDWR
        }
    };
    compatible
        .then_some(())
        .ok_or_else(|| "descriptor mode is incompatible with the request".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_exact_platform_removal_manifest() {
        let plan = map_removal_plan(PlatformRemovalPlan {
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
            download_manifests: vec![".abab.jstorrent.json".to_owned()],
        });

        assert!(plan.tree);
        assert_eq!(plan.files[0].components, ["Season 01", "Episode 01.mkv"]);
        assert_eq!(plan.directories[0].components, ["Season 01"]);
        assert_eq!(plan.download_manifests, [".abab.jstorrent.json"]);
    }

    #[test]
    fn validates_bounded_mixed_roots_and_ios_pool_limit() {
        let root = std::env::temp_dir().join("rstorrent-ios-config");
        let config = IosApplicationConfig {
            profile_root: root.join("profile").display().to_string(),
            profile_id: "ios".to_owned(),
            storage_roots: vec![
                IosStorageRootConfig {
                    id: "documents".to_owned(),
                    label: "On My iPhone".to_owned(),
                    path: Some(root.join("documents").display().to_string()),
                },
                IosStorageRootConfig {
                    id: "selected-1".to_owned(),
                    label: "Downloads".to_owned(),
                    path: None,
                },
            ],
            network_policy: IosNetworkPolicy::Offline,
            peer_connect_timeout_seconds: 5,
            peer_io_timeout_seconds: 5,
        };
        let validated = validate_application_config(config).expect("valid config");
        assert_eq!(validated.storage_roots.len(), 2);
        assert_eq!(validated.storage_file_limit, IOS_STORAGE_FILE_LIMIT);
    }

    #[test]
    fn rejects_duplicate_root_ids() {
        let root = std::env::temp_dir().join("rstorrent-ios-duplicate");
        let config = IosApplicationConfig {
            profile_root: root.display().to_string(),
            profile_id: "ios".to_owned(),
            storage_roots: vec![
                IosStorageRootConfig {
                    id: "same".to_owned(),
                    label: "First".to_owned(),
                    path: None,
                },
                IosStorageRootConfig {
                    id: "same".to_owned(),
                    label: "Second".to_owned(),
                    path: None,
                },
            ],
            network_policy: IosNetworkPolicy::Offline,
            peer_connect_timeout_seconds: 5,
            peer_io_timeout_seconds: 5,
        };
        assert!(validate_application_config(config).is_err());
    }

    #[test]
    fn root_qualification_is_exact_and_self_cleaning() {
        let root = std::env::temp_dir().join(format!(
            "rstorrent-ios-qualification-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create root");
        let report = qualify_root(root.display().to_string()).expect("qualification");
        assert_eq!(report.sha1_hex, "48b6fdf2fd3b77c14cc54f54891dc6aed1eeec3a");
        assert_eq!(report.handle_high_water, 1);
        assert_eq!(report.cached_after_shutdown, 0);
        assert_eq!(report.owned_after_shutdown, 0);
        assert!(report.name_collision_rejected);
        assert!(report.cleanup_complete);
        std::fs::remove_dir(root).expect("remove root");
    }
}
