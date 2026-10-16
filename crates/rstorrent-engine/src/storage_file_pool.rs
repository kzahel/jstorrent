use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;
use std::fs::OpenOptions;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Mutex as AsyncMutex, Notify, OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_STORAGE_FILE_LIMIT: usize = 40;
pub const PLATFORM_STORAGE_REQUEST_CAPACITY: usize = 16;
pub const PLATFORM_STORAGE_RELEASE_CAPACITY: usize = 64;
pub const PLATFORM_STORAGE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_STORAGE_OBSERVATION_TOKEN_BYTES: usize = 256;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct StorageFileKey {
    pub storage_id: String,
    pub storage_generation: u64,
    pub role: StorageFileRole,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StorageFileRole {
    ContentRoot,
    Payload(usize),
    Part,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageFileAccess {
    ReadExisting,
    ReadWriteExisting,
    ReadWriteCreate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageObjectKind {
    File,
    Directory,
    Other,
}

/// Backend-neutral evidence about one exact logical storage artifact.
///
/// This value can disqualify a later trusting decision, but cannot establish
/// payload validity by itself. Unsupported tokens remain `None`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageObservation {
    pub exists: bool,
    pub kind: Option<StorageObjectKind>,
    pub length: Option<u64>,
    pub opaque_token: Option<String>,
}

impl StorageObservation {
    pub fn missing() -> Self {
        Self {
            exists: false,
            kind: None,
            length: None,
            opaque_token: None,
        }
    }

    pub fn present(
        kind: StorageObjectKind,
        length: Option<u64>,
        opaque_token: Option<String>,
    ) -> Result<Self, StorageFilePoolError> {
        let observation = Self {
            exists: true,
            kind: Some(kind),
            length,
            opaque_token,
        };
        observation.validate()?;
        Ok(observation)
    }

    pub fn validate(&self) -> Result<(), StorageFilePoolError> {
        if self.exists != self.kind.is_some() {
            return Err(StorageFilePoolError::InvalidObservation(
                "existence and object kind disagree",
            ));
        }
        if !self.exists && (self.length.is_some() || self.opaque_token.is_some()) {
            return Err(StorageFilePoolError::InvalidObservation(
                "missing artifact contains present-only fields",
            ));
        }
        if self
            .kind
            .is_some_and(|kind| kind != StorageObjectKind::File)
            && self.length.is_some()
        {
            return Err(StorageFilePoolError::InvalidObservation(
                "non-file artifact contains a file length",
            ));
        }
        if self
            .opaque_token
            .as_ref()
            .is_some_and(|token| token.len() > MAX_STORAGE_OBSERVATION_TOKEN_BYTES)
        {
            return Err(StorageFilePoolError::InvalidObservation(
                "opaque storage observation token exceeds 256 bytes",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformStorageOperation {
    Open,
    Observe,
    Delete,
}

impl StorageFileAccess {
    fn writable(self) -> bool {
        !matches!(self, Self::ReadExisting)
    }

    fn creates(self) -> bool {
        matches!(self, Self::ReadWriteCreate)
    }

    fn satisfies(self, requested: Self) -> bool {
        self.writable() || !requested.writable()
    }
}

#[derive(Clone, Debug)]
pub enum StorageFileLocator {
    Path(PathBuf),
    Platform(PlatformStorageTarget),
}

#[derive(Clone, Debug)]
pub struct PlatformStorageTarget {
    pub root_id: String,
    pub storage_id: String,
    pub storage_generation: u64,
    pub role: StorageFileRole,
    pub path: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct StorageFileReference {
    origin_boundary_depth: Option<usize>,
    pool: StorageFilePool,
    key: StorageFileKey,
    locator: StorageFileLocator,
}

impl StorageFileReference {
    pub fn new(pool: StorageFilePool, key: StorageFileKey, locator: StorageFileLocator) -> Self {
        Self {
            origin_boundary_depth: None,
            pool,
            key,
            locator,
        }
    }

    pub(crate) fn with_origin_boundary(mut self, boundary: &std::path::Path) -> Self {
        self.origin_boundary_depth = Some(boundary.components().count());
        self
    }

    pub fn key(&self) -> &StorageFileKey {
        &self.key
    }

    pub fn pool(&self) -> &StorageFilePool {
        &self.pool
    }

    pub async fn open(
        &self,
        access: StorageFileAccess,
    ) -> Result<Arc<StorageFileHandle>, StorageFilePoolError> {
        self.pool.open(self, access).await
    }

    pub async fn delete(&self) -> Result<(), StorageFilePoolError> {
        self.pool.invalidate_key(&self.key);
        match &self.locator {
            StorageFileLocator::Path(path) => match tokio::fs::remove_file(path).await {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(source) => Err(StorageFilePoolError::Io {
                    operation: "delete storage file",
                    source,
                }),
            },
            StorageFileLocator::Platform(target) => {
                self.pool
                    .inner
                    .platform
                    .as_ref()
                    .ok_or(StorageFilePoolError::PlatformUnavailable)?
                    .delete(target)
                    .await
            }
        }
    }

    pub async fn observe(&self) -> Result<StorageObservation, StorageFilePoolError> {
        self.pool.observe(self).await
    }
}

#[derive(Debug)]
pub struct StorageFileHandle {
    file: std::fs::File,
    _permit: OwnedSemaphorePermit,
    _platform_release: Option<PlatformStorageReleaseGuard>,
}

impl StorageFileHandle {
    pub fn file(&self) -> &std::fs::File {
        &self.file
    }
}

#[derive(Clone, Debug)]
pub enum StorageFileLease {
    Pooled(Arc<StorageFileHandle>),
    Fixed(Arc<std::fs::File>),
}

impl StorageFileLease {
    pub fn fixed(file: std::fs::File) -> Self {
        Self::Fixed(Arc::new(file))
    }

    pub fn file(&self) -> &std::fs::File {
        match self {
            Self::Pooled(handle) => handle.file(),
            Self::Fixed(file) => file,
        }
    }
}

impl From<Arc<StorageFileHandle>> for StorageFileLease {
    fn from(handle: Arc<StorageFileHandle>) -> Self {
        Self::Pooled(handle)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct StorageFilePoolSnapshot {
    pub limit: usize,
    pub current_owned: usize,
    pub owned_high_water: usize,
    pub cached_entries: usize,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub singleflight_waits: u64,
    pub mode_upgrades: u64,
    pub open_failures: u64,
    pub resource_retries: u64,
    pub platform_pending: usize,
    pub platform_pending_high_water: usize,
}

#[derive(Debug)]
pub enum StorageFilePoolError {
    Closed,
    Invalidated,
    InvalidPath,
    PlatformUnavailable,
    PlatformFailure(PlatformStorageFailure),
    InvalidObservation(&'static str),
    Io {
        operation: &'static str,
        source: io::Error,
    },
}

impl fmt::Display for StorageFilePoolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => formatter.write_str("storage file pool is closed"),
            Self::Invalidated => formatter.write_str("storage file acquisition was invalidated"),
            Self::InvalidPath => formatter.write_str("storage file path has no parent"),
            Self::PlatformUnavailable => {
                formatter.write_str("platform storage broker is unavailable")
            }
            Self::PlatformFailure(error) => write!(formatter, "platform storage: {error}"),
            Self::InvalidObservation(detail) => {
                write!(formatter, "invalid storage observation: {detail}")
            }
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
        }
    }
}

impl Error for StorageFilePoolError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::PlatformFailure(error) => Some(error),
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl StorageFilePoolError {
    pub fn platform_failure_kind(&self) -> Option<PlatformStorageFailureKind> {
        match self {
            Self::PlatformUnavailable => Some(PlatformStorageFailureKind::Cancelled),
            Self::PlatformFailure(failure) => Some(failure.kind),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformStorageFailureKind {
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformStorageFailure {
    pub kind: PlatformStorageFailureKind,
    pub detail: String,
}

impl PlatformStorageFailure {
    pub fn new(kind: PlatformStorageFailureKind, detail: impl Into<String>) -> Self {
        let mut detail = detail.into();
        detail.truncate(1024);
        Self { kind, detail }
    }
}

impl fmt::Display for PlatformStorageFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.detail)
    }
}

impl Error for PlatformStorageFailure {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformStorageRequest {
    pub request_id: u64,
    pub root_id: String,
    pub storage_id: String,
    pub storage_generation: u64,
    pub role: StorageFileRole,
    pub path: Vec<String>,
    pub operation: PlatformStorageOperation,
    pub access: StorageFileAccess,
    pub timeout_millis: u64,
}

#[derive(Debug)]
enum PlatformStorageResponse {
    File(AcquiredStorageFile),
    Observation(StorageObservation),
    Deleted,
}

#[derive(Debug)]
struct AcquiredStorageFile {
    file: std::fs::File,
    release: Option<PlatformStorageReleaseGuard>,
}

#[derive(Debug)]
struct PlatformStorageReleases {
    sender: mpsc::Sender<u64>,
    ids: Mutex<HashSet<u64>>,
    outstanding: AtomicUsize,
}

impl PlatformStorageReleases {
    fn acknowledge(&self, release_id: u64) -> bool {
        let removed = self
            .ids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&release_id);
        if removed {
            let previous = self.outstanding.fetch_sub(1, Ordering::AcqRel);
            debug_assert!(previous > 0, "platform release count underflowed");
        }
        removed
    }
}

#[derive(Debug)]
struct PlatformStorageReleaseGuard {
    release_id: u64,
    releases: Arc<PlatformStorageReleases>,
}

impl Drop for PlatformStorageReleaseGuard {
    fn drop(&mut self) {
        if self.releases.sender.try_send(self.release_id).is_err() {
            self.releases.acknowledge(self.release_id);
        }
    }
}

struct PendingPlatformStorageRequest {
    request: PlatformStorageRequest,
    reply: oneshot::Sender<Result<PlatformStorageResponse, PlatformStorageFailure>>,
}

#[derive(Clone, Debug)]
pub struct PlatformStorageClient {
    sender: mpsc::Sender<PendingPlatformStorageRequest>,
    next_request_id: Arc<AtomicU64>,
    pending: Arc<AtomicUsize>,
    pending_high_water: Arc<AtomicUsize>,
    root_failures: Arc<Mutex<HashMap<String, PlatformStorageFailure>>>,
    health_wake: Arc<Mutex<Option<Arc<Notify>>>>,
}

struct PlatformPendingGuard {
    pending: Arc<AtomicUsize>,
}

impl PlatformPendingGuard {
    fn begin(client: &PlatformStorageClient) -> Self {
        let pending = client.pending.fetch_add(1, Ordering::AcqRel) + 1;
        update_high_water(&client.pending_high_water, pending);
        Self {
            pending: client.pending.clone(),
        }
    }
}

impl Drop for PlatformPendingGuard {
    fn drop(&mut self) {
        let previous = self.pending.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "platform pending request count underflowed");
    }
}

impl PlatformStorageClient {
    async fn open(
        &self,
        target: &PlatformStorageTarget,
        access: StorageFileAccess,
    ) -> Result<AcquiredStorageFile, StorageFilePoolError> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = PlatformStorageRequest {
            request_id,
            root_id: target.root_id.clone(),
            storage_id: target.storage_id.clone(),
            storage_generation: target.storage_generation,
            role: target.role,
            path: target.path.clone(),
            operation: PlatformStorageOperation::Open,
            access,
            timeout_millis: u64::try_from(PLATFORM_STORAGE_REQUEST_TIMEOUT.as_millis())
                .expect("platform timeout fits u64 milliseconds"),
        };
        let (reply, response) = oneshot::channel();
        self.sender
            .send(PendingPlatformStorageRequest { request, reply })
            .await
            .map_err(|_| StorageFilePoolError::PlatformUnavailable)?;
        let _pending = PlatformPendingGuard::begin(self);
        let result = timeout(PLATFORM_STORAGE_REQUEST_TIMEOUT, response).await;
        match result {
            Ok(Ok(Ok(PlatformStorageResponse::File(file)))) => Ok(file),
            Ok(Ok(Ok(PlatformStorageResponse::Deleted))) => Err(
                StorageFilePoolError::PlatformFailure(PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned deletion for an open request",
                )),
            ),
            Ok(Ok(Ok(PlatformStorageResponse::Observation(_)))) => Err(
                StorageFilePoolError::PlatformFailure(PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned an observation for an open request",
                )),
            ),
            Ok(Ok(Err(error))) => {
                self.record_root_failure(&target.root_id, &error);
                Err(StorageFilePoolError::PlatformFailure(error))
            }
            Ok(Err(_)) => Err(StorageFilePoolError::PlatformUnavailable),
            Err(_) => Err(StorageFilePoolError::PlatformFailure(
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::DeadlineExceeded,
                    "platform storage request exceeded its deadline",
                ),
            )),
        }
    }

    async fn observe(
        &self,
        target: &PlatformStorageTarget,
    ) -> Result<StorageObservation, StorageFilePoolError> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = PlatformStorageRequest {
            request_id,
            root_id: target.root_id.clone(),
            storage_id: target.storage_id.clone(),
            storage_generation: target.storage_generation,
            role: target.role,
            path: target.path.clone(),
            operation: PlatformStorageOperation::Observe,
            access: StorageFileAccess::ReadExisting,
            timeout_millis: u64::try_from(PLATFORM_STORAGE_REQUEST_TIMEOUT.as_millis())
                .expect("platform timeout fits u64 milliseconds"),
        };
        let response = self.request(request).await?;
        match response {
            PlatformStorageResponse::Observation(observation) => Ok(observation),
            PlatformStorageResponse::File(_) => Err(StorageFilePoolError::PlatformFailure(
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned a file for an observation request",
                ),
            )),
            PlatformStorageResponse::Deleted => Err(StorageFilePoolError::PlatformFailure(
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned deletion for an observation request",
                ),
            )),
        }
    }

    async fn delete(&self, target: &PlatformStorageTarget) -> Result<(), StorageFilePoolError> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = PlatformStorageRequest {
            request_id,
            root_id: target.root_id.clone(),
            storage_id: target.storage_id.clone(),
            storage_generation: target.storage_generation,
            role: target.role,
            path: target.path.clone(),
            operation: PlatformStorageOperation::Delete,
            access: StorageFileAccess::ReadWriteExisting,
            timeout_millis: u64::try_from(PLATFORM_STORAGE_REQUEST_TIMEOUT.as_millis())
                .expect("platform timeout fits u64 milliseconds"),
        };
        let (reply, response) = oneshot::channel();
        self.sender
            .send(PendingPlatformStorageRequest { request, reply })
            .await
            .map_err(|_| StorageFilePoolError::PlatformUnavailable)?;
        let _pending = PlatformPendingGuard::begin(self);
        let result = timeout(PLATFORM_STORAGE_REQUEST_TIMEOUT, response).await;
        match result {
            Ok(Ok(Ok(PlatformStorageResponse::Deleted))) => Ok(()),
            Ok(Ok(Ok(PlatformStorageResponse::File(_)))) => Err(
                StorageFilePoolError::PlatformFailure(PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned a file for a deletion request",
                )),
            ),
            Ok(Ok(Ok(PlatformStorageResponse::Observation(_)))) => Err(
                StorageFilePoolError::PlatformFailure(PlatformStorageFailure::new(
                    PlatformStorageFailureKind::Internal,
                    "platform returned an observation for a deletion request",
                )),
            ),
            Ok(Ok(Err(error))) => {
                self.record_root_failure(&target.root_id, &error);
                Err(StorageFilePoolError::PlatformFailure(error))
            }
            Ok(Err(_)) => Err(StorageFilePoolError::PlatformUnavailable),
            Err(_) => Err(StorageFilePoolError::PlatformFailure(
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::DeadlineExceeded,
                    "platform storage deletion exceeded its deadline",
                ),
            )),
        }
    }

    async fn request(
        &self,
        request: PlatformStorageRequest,
    ) -> Result<PlatformStorageResponse, StorageFilePoolError> {
        let root_id = request.root_id.clone();
        let (reply, response) = oneshot::channel();
        self.sender
            .send(PendingPlatformStorageRequest { request, reply })
            .await
            .map_err(|_| StorageFilePoolError::PlatformUnavailable)?;
        let _pending = PlatformPendingGuard::begin(self);
        let result = timeout(PLATFORM_STORAGE_REQUEST_TIMEOUT, response).await;
        match result {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(error))) => {
                self.record_root_failure(&root_id, &error);
                Err(StorageFilePoolError::PlatformFailure(error))
            }
            Ok(Err(_)) => Err(StorageFilePoolError::PlatformUnavailable),
            Err(_) => Err(StorageFilePoolError::PlatformFailure(
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::DeadlineExceeded,
                    "platform storage request exceeded its deadline",
                ),
            )),
        }
    }

    pub fn pending(&self) -> usize {
        self.pending.load(Ordering::Acquire)
    }

    pub fn pending_high_water(&self) -> usize {
        self.pending_high_water.load(Ordering::Acquire)
    }

    fn record_root_failure(&self, root_id: &str, failure: &PlatformStorageFailure) {
        if !matches!(
            failure.kind,
            PlatformStorageFailureKind::GrantUnavailable
                | PlatformStorageFailureKind::PermissionDenied
                | PlatformStorageFailureKind::ProviderRefused
                | PlatformStorageFailureKind::NonSeekable
        ) {
            return;
        }
        self.root_failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(root_id.to_owned(), failure.clone());
        if let Some(wake) = self
            .health_wake
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
        {
            wake.notify_one();
        }
    }

    fn take_root_failures(&self) -> Vec<(String, PlatformStorageFailure)> {
        std::mem::take(
            &mut *self
                .root_failures
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
        .into_iter()
        .collect()
    }

    fn clear_root_failure(&self, root_id: &str) {
        self.root_failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(root_id);
    }

    fn set_health_wake(&self, wake: Arc<Notify>) {
        *self
            .health_wake
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(wake);
    }
}

#[derive(Debug)]
pub struct PlatformStorageBroker {
    receiver: AsyncMutex<mpsc::Receiver<PendingPlatformStorageRequest>>,
    pending: Mutex<
        HashMap<u64, oneshot::Sender<Result<PlatformStorageResponse, PlatformStorageFailure>>>,
    >,
    cancellation: CancellationToken,
    releases: Arc<PlatformStorageReleases>,
    release_receiver: AsyncMutex<mpsc::Receiver<u64>>,
    release_cancellation: CancellationToken,
}

impl PlatformStorageBroker {
    pub async fn next_request(&self) -> Option<PlatformStorageRequest> {
        loop {
            let mut receiver = tokio::select! {
                biased;
                _ = self.cancellation.cancelled() => return None,
                receiver = self.receiver.lock() => receiver,
            };
            let pending = tokio::select! {
                biased;
                _ = self.cancellation.cancelled() => {
                    receiver.close();
                    while let Ok(pending) = receiver.try_recv() {
                        cancel_platform_reply(pending.reply);
                    }
                    return None;
                }
                pending = receiver.recv() => pending?,
            };
            drop(receiver);
            self.pending_guard().retain(|_, reply| !reply.is_closed());
            if pending.reply.is_closed() {
                continue;
            }
            self.pending_guard()
                .insert(pending.request.request_id, pending.reply);
            return Some(pending.request);
        }
    }

    pub fn complete_file(&self, request_id: u64, file: std::fs::File) -> bool {
        self.pending_guard()
            .remove(&request_id)
            .is_some_and(|reply| {
                reply
                    .send(Ok(PlatformStorageResponse::File(AcquiredStorageFile {
                        file,
                        release: None,
                    })))
                    .is_ok()
            })
    }

    /// Completes an open with a file whose platform coordination must remain
    /// alive until the pooled Rust handle is finally released.
    pub fn complete_leased_file(
        &self,
        request_id: u64,
        file: std::fs::File,
        release_id: u64,
    ) -> bool {
        let Some(reply) = self.pending_guard().remove(&request_id) else {
            return false;
        };
        let rejected = {
            let mut ids = self
                .releases
                .ids
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if release_id == 0 {
                Some("platform storage release ID must be nonzero")
            } else if ids.contains(&release_id) {
                Some("platform storage release ID is already outstanding")
            } else if ids.len() >= PLATFORM_STORAGE_RELEASE_CAPACITY {
                Some("platform storage release capacity is exhausted")
            } else {
                ids.insert(release_id);
                self.releases.outstanding.fetch_add(1, Ordering::AcqRel);
                None
            }
        };
        if let Some(detail) = rejected {
            let _ = reply.send(Err(PlatformStorageFailure::new(
                PlatformStorageFailureKind::Internal,
                detail,
            )));
            return false;
        }
        let release = PlatformStorageReleaseGuard {
            release_id,
            releases: self.releases.clone(),
        };
        reply
            .send(Ok(PlatformStorageResponse::File(AcquiredStorageFile {
                file,
                release: Some(release),
            })))
            .is_ok()
    }

    pub async fn next_release(&self) -> Option<u64> {
        let mut receiver = tokio::select! {
            biased;
            _ = self.release_cancellation.cancelled() => return None,
            receiver = self.release_receiver.lock() => receiver,
        };
        let release_id = tokio::select! {
            biased;
            _ = self.release_cancellation.cancelled() => return None,
            release_id = receiver.recv() => release_id?,
        };
        Some(release_id)
    }

    pub fn acknowledge_release(&self, release_id: u64) -> bool {
        self.releases.acknowledge(release_id)
    }

    pub fn pending_releases(&self) -> usize {
        self.releases.outstanding.load(Ordering::Acquire)
    }

    pub fn is_pending(&self, request_id: u64) -> bool {
        self.pending_guard().contains_key(&request_id)
    }

    pub fn complete_deleted(&self, request_id: u64) -> bool {
        self.pending_guard()
            .remove(&request_id)
            .is_some_and(|reply| reply.send(Ok(PlatformStorageResponse::Deleted)).is_ok())
    }

    pub fn complete_observation(&self, request_id: u64, observation: StorageObservation) -> bool {
        if let Err(error) = observation.validate() {
            return self.complete_error(
                request_id,
                PlatformStorageFailure::new(
                    PlatformStorageFailureKind::ProviderRefused,
                    error.to_string(),
                ),
            );
        }
        self.pending_guard()
            .remove(&request_id)
            .is_some_and(|reply| {
                reply
                    .send(Ok(PlatformStorageResponse::Observation(observation)))
                    .is_ok()
            })
    }

    pub fn complete_error(&self, request_id: u64, failure: PlatformStorageFailure) -> bool {
        self.pending_guard()
            .remove(&request_id)
            .is_some_and(|reply| reply.send(Err(failure)).is_ok())
    }

    pub fn cancel_pending(&self) {
        self.cancellation.cancel();
        if let Ok(mut receiver) = self.receiver.try_lock() {
            receiver.close();
            while let Ok(pending) = receiver.try_recv() {
                cancel_platform_reply(pending.reply);
            }
        }
        let pending = std::mem::take(&mut *self.pending_guard());
        for (_, reply) in pending {
            cancel_platform_reply(reply);
        }
    }

    pub fn close_release_stream(&self) {
        self.release_cancellation.cancel();
        if let Ok(mut receiver) = self.release_receiver.try_lock() {
            receiver.close();
            while let Ok(release_id) = receiver.try_recv() {
                self.releases.acknowledge(release_id);
            }
        }
    }

    pub fn cancel_all(&self) {
        self.cancel_pending();
        self.close_release_stream();
    }

    fn pending_guard(
        &self,
    ) -> MutexGuard<
        '_,
        HashMap<u64, oneshot::Sender<Result<PlatformStorageResponse, PlatformStorageFailure>>>,
    > {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub fn platform_storage_channel() -> (PlatformStorageClient, Arc<PlatformStorageBroker>) {
    let (sender, receiver) = mpsc::channel(PLATFORM_STORAGE_REQUEST_CAPACITY);
    let (release_sender, release_receiver) = mpsc::channel(PLATFORM_STORAGE_RELEASE_CAPACITY);
    let releases = Arc::new(PlatformStorageReleases {
        sender: release_sender,
        ids: Mutex::new(HashSet::new()),
        outstanding: AtomicUsize::new(0),
    });
    (
        PlatformStorageClient {
            sender,
            next_request_id: Arc::new(AtomicU64::new(1)),
            pending: Arc::new(AtomicUsize::new(0)),
            pending_high_water: Arc::new(AtomicUsize::new(0)),
            root_failures: Arc::new(Mutex::new(HashMap::new())),
            health_wake: Arc::new(Mutex::new(None)),
        },
        Arc::new(PlatformStorageBroker {
            receiver: AsyncMutex::new(receiver),
            pending: Mutex::new(HashMap::new()),
            cancellation: CancellationToken::new(),
            releases,
            release_receiver: AsyncMutex::new(release_receiver),
            release_cancellation: CancellationToken::new(),
        }),
    )
}

fn cancel_platform_reply(
    reply: oneshot::Sender<Result<PlatformStorageResponse, PlatformStorageFailure>>,
) {
    let _ = reply.send(Err(PlatformStorageFailure::new(
        PlatformStorageFailureKind::Cancelled,
        "platform storage broker stopped",
    )));
}

#[derive(Debug)]
struct PoolEntry {
    access: StorageFileAccess,
    last_used: u64,
    handle: Arc<StorageFileHandle>,
}

#[derive(Debug, Default)]
struct PoolState {
    entries: HashMap<StorageFileKey, PoolEntry>,
    key_locks: HashMap<StorageFileKey, Weak<AsyncMutex<()>>>,
    storage_versions: HashMap<String, u64>,
    clock: u64,
    closed: bool,
}

#[derive(Debug)]
struct PoolMetrics {
    hits: AtomicU64,
    misses: AtomicU64,
    evictions: AtomicU64,
    singleflight_waits: AtomicU64,
    mode_upgrades: AtomicU64,
    open_failures: AtomicU64,
    resource_retries: AtomicU64,
    owned_high_water: AtomicUsize,
}

impl Default for PoolMetrics {
    fn default() -> Self {
        Self {
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
            singleflight_waits: AtomicU64::new(0),
            mode_upgrades: AtomicU64::new(0),
            open_failures: AtomicU64::new(0),
            resource_retries: AtomicU64::new(0),
            owned_high_water: AtomicUsize::new(0),
        }
    }
}

#[derive(Debug)]
struct StorageFilePoolInner {
    mark_internet_origin: AtomicBool,
    origin_marking_failures: Arc<AtomicU64>,
    limit: usize,
    permits: Arc<Semaphore>,
    state: Mutex<PoolState>,
    platform: Option<PlatformStorageClient>,
    metrics: PoolMetrics,
}

#[derive(Clone, Debug)]
pub struct StorageFilePool {
    inner: Arc<StorageFilePoolInner>,
}

impl StorageFilePool {
    pub fn new(
        limit: usize,
        platform: Option<PlatformStorageClient>,
    ) -> Result<Self, &'static str> {
        if limit == 0 {
            return Err("storage file limit must be nonzero");
        }
        Ok(Self {
            inner: Arc::new(StorageFilePoolInner {
                mark_internet_origin: AtomicBool::new(false),
                origin_marking_failures: Arc::new(AtomicU64::new(0)),
                limit,
                permits: Arc::new(Semaphore::new(limit)),
                state: Mutex::new(PoolState::default()),
                platform,
                metrics: PoolMetrics::default(),
            }),
        })
    }

    async fn open(
        &self,
        reference: &StorageFileReference,
        access: StorageFileAccess,
    ) -> Result<Arc<StorageFileHandle>, StorageFilePoolError> {
        if let Some(handle) = self.cached(&reference.key, access)? {
            self.inner.metrics.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(handle);
        }
        self.inner.metrics.misses.fetch_add(1, Ordering::Relaxed);
        let key_lock = self.key_lock(&reference.key)?;
        if key_lock.try_lock().is_err() {
            self.inner
                .metrics
                .singleflight_waits
                .fetch_add(1, Ordering::Relaxed);
        }
        let _key_guard = key_lock.lock().await;
        if let Some(handle) = self.cached(&reference.key, access)? {
            self.inner.metrics.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(handle);
        }

        let removed = {
            let mut state = self.state_guard();
            if state.closed {
                return Err(StorageFilePoolError::Closed);
            }
            match state.entries.get(&reference.key) {
                Some(entry) if !entry.access.satisfies(access) => {
                    self.inner
                        .metrics
                        .mode_upgrades
                        .fetch_add(1, Ordering::Relaxed);
                    state.entries.remove(&reference.key)
                }
                _ => None,
            }
        };
        drop(removed);

        let storage_version = self.storage_version(&reference.key.storage_id)?;

        let permit = self.acquire_permit().await?;
        let acquired = match self
            .acquire_file(
                &reference.locator,
                access,
                matches!(reference.key.role, StorageFileRole::Payload(_)),
                reference.origin_boundary_depth,
            )
            .await
        {
            Ok(file) => file,
            Err(first) if is_descriptor_exhaustion(&first) => {
                self.inner
                    .metrics
                    .resource_retries
                    .fetch_add(1, Ordering::Relaxed);
                self.evict_one();
                self.acquire_file(
                    &reference.locator,
                    access,
                    matches!(reference.key.role, StorageFileRole::Payload(_)),
                    reference.origin_boundary_depth,
                )
                .await?
            }
            Err(error) => {
                self.inner
                    .metrics
                    .open_failures
                    .fetch_add(1, Ordering::Relaxed);
                return Err(error);
            }
        };
        let handle = Arc::new(StorageFileHandle {
            file: acquired.file,
            _permit: permit,
            _platform_release: acquired.release,
        });
        self.observe_owned_high_water();
        let replaced = {
            let mut state = self.state_guard();
            if state.closed {
                return Err(StorageFilePoolError::Closed);
            }
            if state
                .storage_versions
                .get(&reference.key.storage_id)
                .copied()
                .unwrap_or_default()
                != storage_version
            {
                return Err(StorageFilePoolError::Invalidated);
            }
            state.clock = state.clock.wrapping_add(1);
            let last_used = state.clock;
            state.entries.insert(
                reference.key.clone(),
                PoolEntry {
                    access,
                    last_used,
                    handle: handle.clone(),
                },
            )
        };
        drop(replaced);
        Ok(handle)
    }

    async fn observe(
        &self,
        reference: &StorageFileReference,
    ) -> Result<StorageObservation, StorageFilePoolError> {
        let storage_version = self.storage_version(&reference.key.storage_id)?;
        let observation = match &reference.locator {
            StorageFileLocator::Path(path) => observe_path(path.clone()).await?,
            StorageFileLocator::Platform(target) => {
                self.inner
                    .platform
                    .as_ref()
                    .ok_or(StorageFilePoolError::PlatformUnavailable)?
                    .observe(target)
                    .await?
            }
        };
        let current_version = self.storage_version(&reference.key.storage_id)?;
        if current_version != storage_version {
            return Err(StorageFilePoolError::Invalidated);
        }
        Ok(observation)
    }

    pub fn set_mark_internet_origin(&self, enabled: bool) {
        self.inner
            .mark_internet_origin
            .store(enabled, Ordering::Release);
    }

    pub fn take_origin_marking_failures(&self) -> u64 {
        self.inner.origin_marking_failures.swap(0, Ordering::AcqRel)
    }

    pub fn snapshot(&self) -> StorageFilePoolSnapshot {
        let state = self.state_guard();
        let platform_pending = self
            .inner
            .platform
            .as_ref()
            .map_or(0, PlatformStorageClient::pending);
        let platform_pending_high_water = self
            .inner
            .platform
            .as_ref()
            .map_or(0, PlatformStorageClient::pending_high_water);
        StorageFilePoolSnapshot {
            limit: self.inner.limit,
            current_owned: self
                .inner
                .limit
                .saturating_sub(self.inner.permits.available_permits()),
            owned_high_water: self.inner.metrics.owned_high_water.load(Ordering::Acquire),
            cached_entries: state.entries.len(),
            hits: self.inner.metrics.hits.load(Ordering::Relaxed),
            misses: self.inner.metrics.misses.load(Ordering::Relaxed),
            evictions: self.inner.metrics.evictions.load(Ordering::Relaxed),
            singleflight_waits: self
                .inner
                .metrics
                .singleflight_waits
                .load(Ordering::Relaxed),
            mode_upgrades: self.inner.metrics.mode_upgrades.load(Ordering::Relaxed),
            open_failures: self.inner.metrics.open_failures.load(Ordering::Relaxed),
            resource_retries: self.inner.metrics.resource_retries.load(Ordering::Relaxed),
            platform_pending,
            platform_pending_high_water,
        }
    }

    pub fn take_platform_root_failures(&self) -> Vec<(String, PlatformStorageFailure)> {
        self.inner
            .platform
            .as_ref()
            .map_or_else(Vec::new, PlatformStorageClient::take_root_failures)
    }

    pub fn clear_platform_root_failure(&self, root_id: &str) {
        if let Some(platform) = &self.inner.platform {
            platform.clear_root_failure(root_id);
        }
    }

    pub fn set_platform_health_wake(&self, wake: Arc<Notify>) {
        if let Some(platform) = &self.inner.platform {
            platform.set_health_wake(wake);
        }
    }

    pub fn invalidate_storage(&self, storage_id: &str) {
        let removed = {
            let mut state = self.state_guard();
            let version = state
                .storage_versions
                .entry(storage_id.to_owned())
                .or_default();
            *version = version.wrapping_add(1);
            let keys = state
                .entries
                .keys()
                .filter(|key| key.storage_id == storage_id)
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| state.entries.remove(&key))
                .collect::<Vec<_>>()
        };
        drop(removed);
    }

    pub fn invalidate_key(&self, key: &StorageFileKey) {
        let removed = {
            let mut state = self.state_guard();
            let version = state
                .storage_versions
                .entry(key.storage_id.clone())
                .or_default();
            *version = version.wrapping_add(1);
            state.entries.remove(key)
        };
        drop(removed);
    }

    pub fn invalidate_all(&self) {
        let removed = {
            let mut state = self.state_guard();
            for version in state.storage_versions.values_mut() {
                *version = version.wrapping_add(1);
            }
            state
                .entries
                .drain()
                .map(|(_, entry)| entry)
                .collect::<Vec<_>>()
        };
        drop(removed);
    }

    fn storage_version(&self, storage_id: &str) -> Result<u64, StorageFilePoolError> {
        let mut state = self.state_guard();
        if state.closed {
            return Err(StorageFilePoolError::Closed);
        }
        Ok(*state
            .storage_versions
            .entry(storage_id.to_owned())
            .or_default())
    }

    pub async fn shutdown(&self) -> Result<(), StorageFilePoolError> {
        let removed = {
            let mut state = self.state_guard();
            state.closed = true;
            state.key_locks.clear();
            state
                .entries
                .drain()
                .map(|(_, entry)| entry)
                .collect::<Vec<_>>()
        };
        drop(removed);
        let permits = self
            .inner
            .permits
            .clone()
            .acquire_many_owned(
                u32::try_from(self.inner.limit).map_err(|_| StorageFilePoolError::Closed)?,
            )
            .await
            .map_err(|_| StorageFilePoolError::Closed)?;
        drop(permits);
        Ok(())
    }

    fn cached(
        &self,
        key: &StorageFileKey,
        access: StorageFileAccess,
    ) -> Result<Option<Arc<StorageFileHandle>>, StorageFilePoolError> {
        let mut state = self.state_guard();
        if state.closed {
            return Err(StorageFilePoolError::Closed);
        }
        state.clock = state.clock.wrapping_add(1);
        let last_used = state.clock;
        Ok(state.entries.get_mut(key).and_then(|entry| {
            entry.access.satisfies(access).then(|| {
                entry.last_used = last_used;
                entry.handle.clone()
            })
        }))
    }

    fn key_lock(&self, key: &StorageFileKey) -> Result<Arc<AsyncMutex<()>>, StorageFilePoolError> {
        let mut state = self.state_guard();
        if state.closed {
            return Err(StorageFilePoolError::Closed);
        }
        if let Some(lock) = state.key_locks.get(key).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        let lock = Arc::new(AsyncMutex::new(()));
        state.key_locks.insert(key.clone(), Arc::downgrade(&lock));
        Ok(lock)
    }

    async fn acquire_permit(&self) -> Result<OwnedSemaphorePermit, StorageFilePoolError> {
        loop {
            match self.inner.permits.clone().try_acquire_owned() {
                Ok(permit) => return Ok(permit),
                Err(tokio::sync::TryAcquireError::Closed) => {
                    return Err(StorageFilePoolError::Closed);
                }
                Err(tokio::sync::TryAcquireError::NoPermits) => {
                    if !self.evict_one() {
                        return self
                            .inner
                            .permits
                            .clone()
                            .acquire_owned()
                            .await
                            .map_err(|_| StorageFilePoolError::Closed);
                    }
                }
            }
        }
    }

    fn evict_one(&self) -> bool {
        let removed = {
            let mut state = self.state_guard();
            let key = state
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone());
            key.and_then(|key| state.entries.remove(&key))
        };
        if removed.is_some() {
            self.inner.metrics.evictions.fetch_add(1, Ordering::Relaxed);
        }
        let evicted = removed.is_some();
        drop(removed);
        evicted
    }

    async fn acquire_file(
        &self,
        locator: &StorageFileLocator,
        access: StorageFileAccess,
        payload: bool,
        origin_boundary_depth: Option<usize>,
    ) -> Result<AcquiredStorageFile, StorageFilePoolError> {
        match locator {
            StorageFileLocator::Path(path) => open_path(
                path.clone(),
                access,
                origin_boundary_depth,
                payload && self.inner.mark_internet_origin.load(Ordering::Acquire),
                self.inner.origin_marking_failures.clone(),
            )
            .await
            .map(|file| AcquiredStorageFile {
                file,
                release: None,
            }),
            StorageFileLocator::Platform(target) => {
                let platform = self
                    .inner
                    .platform
                    .as_ref()
                    .ok_or(StorageFilePoolError::PlatformUnavailable)?;
                platform.open(target, access).await
            }
        }
    }

    fn observe_owned_high_water(&self) {
        let current = self
            .inner
            .limit
            .saturating_sub(self.inner.permits.available_permits());
        update_high_water(&self.inner.metrics.owned_high_water, current);
    }

    fn state_guard(&self) -> MutexGuard<'_, PoolState> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

async fn open_path(
    path: PathBuf,
    access: StorageFileAccess,
    origin_boundary_depth: Option<usize>,
    mark_origin: bool,
    marking_failures: Arc<AtomicU64>,
) -> Result<std::fs::File, StorageFilePoolError> {
    tokio::task::spawn_blocking(move || {
        if access.creates() {
            let parent = path.parent().ok_or(StorageFilePoolError::InvalidPath)?;
            std::fs::create_dir_all(parent).map_err(|source| StorageFilePoolError::Io {
                operation: "create storage file parent",
                source,
            })?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(access.writable());
        if access.creates() {
            options.create(true);
        }
        let file = options
            .open(&path)
            .map_err(|source| StorageFilePoolError::Io {
                operation: "open storage file",
                source,
            })?;
        // Check/recheck uses read-only handles and does not relabel existing
        // data on upgrade. A writable payload open may receive internet bytes.
        if mark_origin
            && access.writable()
            && crate::origin_marking::mark(&file, &path)
                .and_then(|()| crate::origin_marking::mark_containers(&path, origin_boundary_depth))
                .is_err()
        {
            marking_failures.fetch_add(1, Ordering::Relaxed);
        }
        Ok(file)
    })
    .await
    .map_err(|source| StorageFilePoolError::Io {
        operation: "join storage file open",
        source: io::Error::other(source),
    })?
}

async fn observe_path(path: PathBuf) -> Result<StorageObservation, StorageFilePoolError> {
    tokio::task::spawn_blocking(move || {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(source) if source.kind() == io::ErrorKind::NotFound => {
                return Ok(StorageObservation::missing());
            }
            Err(source) => {
                return Err(StorageFilePoolError::Io {
                    operation: "observe storage artifact",
                    source,
                });
            }
        };
        let kind = if metadata.file_type().is_symlink() {
            StorageObjectKind::Other
        } else if metadata.is_file() {
            StorageObjectKind::File
        } else if metadata.is_dir() {
            StorageObjectKind::Directory
        } else {
            StorageObjectKind::Other
        };
        let length = (kind == StorageObjectKind::File).then_some(metadata.len());
        let opaque_token = metadata.modified().ok().and_then(|modified| {
            modified
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|duration| {
                    format!(
                        "mtime-v1:{}:{}",
                        duration.as_secs(),
                        duration.subsec_nanos()
                    )
                })
        });
        StorageObservation::present(kind, length, opaque_token)
    })
    .await
    .map_err(|source| StorageFilePoolError::Io {
        operation: "join storage artifact observation",
        source: io::Error::other(source),
    })?
}

fn is_descriptor_exhaustion(error: &StorageFilePoolError) -> bool {
    let StorageFilePoolError::Io { source, .. } = error else {
        return false;
    };
    matches!(source.raw_os_error(), Some(23 | 24))
}

fn update_high_water(high_water: &AtomicUsize, value: usize) {
    let mut observed = high_water.load(Ordering::Relaxed);
    while value > observed {
        match high_water.compare_exchange_weak(
            observed,
            value,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(next) => observed = next,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PlatformStorageFailure, PlatformStorageFailureKind, PlatformStorageOperation,
        StorageFileAccess, StorageFileKey, StorageFileLocator, StorageFilePool,
        StorageFileReference, StorageFileRole, StorageObjectKind, StorageObservation,
        platform_storage_channel,
    };
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::time::timeout;

    fn temp_root(name: &str) -> PathBuf {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).expect("random temp suffix");
        std::env::temp_dir().join(format!(
            "rstorrent-pool-{name}-{}",
            u64::from_be_bytes(random)
        ))
    }

    fn reference(
        pool: StorageFilePool,
        root: &std::path::Path,
        index: usize,
    ) -> StorageFileReference {
        StorageFileReference::new(
            pool,
            StorageFileKey {
                storage_id: "test".to_owned(),
                storage_generation: 0,
                role: StorageFileRole::Payload(index),
            },
            StorageFileLocator::Path(root.join(format!("{index}.bin"))),
        )
    }

    #[tokio::test]
    async fn enforces_actual_handle_limit_across_in_flight_eviction() {
        let root = temp_root("limit");
        let pool = StorageFilePool::new(2, None).expect("pool");
        let first = reference(pool.clone(), &root, 0)
            .open(StorageFileAccess::ReadWriteCreate)
            .await
            .expect("first");
        let second = reference(pool.clone(), &root, 1)
            .open(StorageFileAccess::ReadWriteCreate)
            .await
            .expect("second");
        let third_reference = reference(pool.clone(), &root, 2);
        let third = tokio::spawn(async move {
            third_reference
                .open(StorageFileAccess::ReadWriteCreate)
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(pool.snapshot().current_owned, 2);
        assert!(!third.is_finished());
        drop(first);
        let third = third.await.expect("third task").expect("third handle");
        assert_eq!(pool.snapshot().current_owned, 2);
        assert!(pool.snapshot().evictions >= 2);
        drop(second);
        drop(third);
        pool.shutdown().await.expect("shutdown");
        assert_eq!(pool.snapshot().current_owned, 0);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn compatible_concurrent_opens_singleflight_and_hit() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "singleflight".to_owned(),
                storage_generation: 0,
                role: StorageFileRole::Payload(0),
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "singleflight".to_owned(),
                storage_generation: 0,
                role: StorageFileRole::Payload(0),
                path: vec!["0.bin".to_owned()],
            }),
        );
        let first_reference = reference.clone();
        let first = tokio::spawn(async move {
            first_reference
                .open(StorageFileAccess::ReadWriteCreate)
                .await
        });
        let request = broker.next_request().await.expect("first open request");
        let second =
            tokio::spawn(async move { reference.open(StorageFileAccess::ReadWriteCreate).await });
        timeout(Duration::from_secs(1), async {
            while pool.snapshot().singleflight_waits != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("second open waits on the first");
        assert!(
            timeout(Duration::from_millis(10), broker.next_request())
                .await
                .is_err(),
            "singleflight issued a duplicate provider open"
        );

        let path = temp_root("singleflight");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("platform file");
        assert!(broker.complete_file(request.request_id, file));
        let first = first.await.expect("first task").expect("first open");
        let second = second.await.expect("second task").expect("second open");
        assert!(Arc::ptr_eq(&first, &second));
        let snapshot = pool.snapshot();
        assert_eq!(snapshot.current_owned, 1);
        assert_eq!(snapshot.misses, 2);
        assert_eq!(snapshot.hits, 1);
        assert_eq!(snapshot.singleflight_waits, 1);
        drop(first);
        drop(second);
        pool.shutdown().await.expect("shutdown");
        broker.cancel_all();
        std::fs::remove_file(path).expect("cleanup");
    }

    #[tokio::test]
    async fn read_existing_never_creates_and_writable_open_upgrades() {
        let root = temp_root("mode");
        std::fs::create_dir_all(&root).expect("root");
        let pool = StorageFilePool::new(2, None).expect("pool");
        let reference = reference(pool.clone(), &root, 0);
        let missing = reference
            .open(StorageFileAccess::ReadExisting)
            .await
            .expect_err("missing read");
        assert!(missing.to_string().contains("open storage file"));
        assert!(!root.join("0.bin").exists());

        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join("0.bin"))
            .expect("seed file");
        file.write_all(b"hello").expect("seed bytes");
        drop(file);
        let read = reference
            .open(StorageFileAccess::ReadExisting)
            .await
            .expect("read handle");
        drop(read);
        let writable = reference
            .open(StorageFileAccess::ReadWriteExisting)
            .await
            .expect("writable handle");
        assert_eq!(pool.snapshot().mode_upgrades, 1);
        drop(writable);
        pool.shutdown().await.expect("shutdown");
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn platform_completion_and_late_response_are_bounded() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let target = super::PlatformStorageTarget {
            root_id: "root".to_owned(),
            storage_id: "torrent".to_owned(),
            storage_generation: 7,
            role: StorageFileRole::Part,
            path: vec!["part".to_owned()],
        };
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 7,
                role: StorageFileRole::Part,
            },
            StorageFileLocator::Platform(target),
        );
        let open =
            tokio::spawn(async move { reference.open(StorageFileAccess::ReadWriteCreate).await });
        let request = broker.next_request().await.expect("request");
        assert_eq!(request.path, vec!["part"]);
        let root = temp_root("platform");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&root)
            .expect("platform file");
        assert!(broker.complete_file(request.request_id, file));
        let handle = open.await.expect("open task").expect("platform handle");
        assert!(!broker.complete_error(
            request.request_id,
            PlatformStorageFailure::new(PlatformStorageFailureKind::Internal, "late response",),
        ));
        drop(handle);
        pool.shutdown().await.expect("shutdown");
        std::fs::remove_file(root).expect("cleanup");
    }

    #[tokio::test]
    async fn leased_platform_file_releases_after_final_pooled_handle() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 3,
                role: StorageFileRole::Part,
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 3,
                role: StorageFileRole::Part,
                path: vec!["part".to_owned()],
            }),
        );
        let open =
            tokio::spawn(async move { reference.open(StorageFileAccess::ReadWriteCreate).await });
        let request = broker.next_request().await.expect("request");
        let path = temp_root("leased-platform");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("platform file");
        assert!(broker.complete_leased_file(request.request_id, file, 41));
        let handle = open.await.expect("open task").expect("platform handle");
        assert_eq!(broker.pending_releases(), 1);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), broker.next_release())
                .await
                .is_err()
        );

        drop(handle);
        pool.invalidate_storage("torrent");
        assert_eq!(broker.next_release().await, Some(41));
        assert_eq!(broker.pending_releases(), 1);
        assert!(broker.acknowledge_release(41));
        assert!(!broker.acknowledge_release(41));
        assert_eq!(broker.pending_releases(), 0);
        pool.shutdown().await.expect("shutdown");
        broker.cancel_all();
        std::fs::remove_file(path).expect("cleanup");
    }

    #[tokio::test]
    async fn three_leased_platform_files_coexist_and_release_exactly_once() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(8, Some(client)).expect("pool");
        let mut opens = Vec::new();
        for index in 0..3 {
            let reference = StorageFileReference::new(
                pool.clone(),
                StorageFileKey {
                    storage_id: "multifile".to_owned(),
                    storage_generation: 9,
                    role: StorageFileRole::Payload(index),
                },
                StorageFileLocator::Platform(super::PlatformStorageTarget {
                    root_id: "root".to_owned(),
                    storage_id: "multifile".to_owned(),
                    storage_generation: 9,
                    role: StorageFileRole::Payload(index),
                    path: vec!["content".to_owned(), format!("{index}.bin")],
                }),
            );
            opens.push(tokio::spawn(async move {
                reference.open(StorageFileAccess::ReadWriteCreate).await
            }));
        }

        let root = temp_root("three-leased-platform");
        std::fs::create_dir_all(&root).expect("platform root");
        let mut paths = Vec::new();
        for _ in 0..3 {
            let request = broker.next_request().await.expect("platform request");
            let path = root.join(format!("{}.bin", request.request_id));
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&path)
                .expect("platform file");
            let StorageFileRole::Payload(index) = request.role else {
                panic!("expected payload request");
            };
            let release_id = 50 + u64::try_from(index).expect("payload index");
            assert!(broker.complete_leased_file(request.request_id, file, release_id));
            paths.push(path);
        }

        let mut handles = Vec::new();
        for open in opens {
            handles.push(open.await.expect("join open").expect("platform handle"));
        }
        assert_eq!(pool.snapshot().current_owned, 3);
        assert_eq!(pool.snapshot().cached_entries, 3);
        assert_eq!(pool.snapshot().owned_high_water, 3);
        assert_eq!(broker.pending_releases(), 3);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), broker.next_release())
                .await
                .is_err()
        );

        drop(handles);
        pool.invalidate_storage("multifile");
        let mut released = std::collections::BTreeSet::new();
        for _ in 0..3 {
            let release_id = broker.next_release().await.expect("release");
            assert!(released.insert(release_id));
            assert!(broker.acknowledge_release(release_id));
            assert!(!broker.acknowledge_release(release_id));
        }
        assert_eq!(released, [50, 51, 52].into_iter().collect());
        assert_eq!(broker.pending_releases(), 0);
        assert_eq!(pool.snapshot().current_owned, 0);
        assert_eq!(pool.snapshot().cached_entries, 0);

        pool.shutdown().await.expect("shutdown");
        broker.cancel_all();
        for path in paths {
            std::fs::remove_file(path).expect("remove platform file");
        }
        std::fs::remove_dir(root).expect("cleanup platform root");
    }

    #[tokio::test]
    async fn invalidation_fences_an_in_flight_platform_completion() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 0,
                role: StorageFileRole::Part,
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 0,
                role: StorageFileRole::Part,
                path: vec!["part".to_owned()],
            }),
        );
        let open =
            tokio::spawn(async move { reference.open(StorageFileAccess::ReadWriteCreate).await });
        let request = broker.next_request().await.expect("request");
        pool.invalidate_storage("torrent");
        let path = temp_root("invalidation");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("platform file");
        assert!(broker.complete_file(request.request_id, file));
        assert!(matches!(
            open.await.expect("open task"),
            Err(super::StorageFilePoolError::Invalidated)
        ));
        assert_eq!(pool.snapshot().cached_entries, 0);
        pool.shutdown().await.expect("shutdown");
        std::fs::remove_file(path).expect("cleanup");
    }

    #[tokio::test]
    async fn broker_cancellation_rejects_open_without_materializing_or_leaking() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
                path: vec!["content".to_owned(), "payload.bin".to_owned()],
            }),
        );
        let open =
            tokio::spawn(async move { reference.open(StorageFileAccess::ReadExisting).await });
        let request = broker.next_request().await.expect("platform request");
        assert_eq!(request.access, StorageFileAccess::ReadExisting);
        assert_eq!(request.operation, PlatformStorageOperation::Open);
        assert_eq!(
            request.path,
            ["content".to_owned(), "payload.bin".to_owned()]
        );
        assert_eq!(pool.snapshot().platform_pending, 1);

        broker.cancel_all();
        let error = open.await.expect("open task").expect_err("cancelled open");
        assert_eq!(
            error.platform_failure_kind(),
            Some(PlatformStorageFailureKind::Cancelled)
        );
        assert_eq!(pool.snapshot().platform_pending, 0);
        assert_eq!(pool.snapshot().current_owned, 0);
        assert_eq!(pool.snapshot().cached_entries, 0);
        pool.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn broker_cancellation_drains_requests_queued_before_provider_receive() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
                path: vec!["content".to_owned(), "payload.bin".to_owned()],
            }),
        );
        let observation = tokio::spawn(async move { reference.observe().await });
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while pool.snapshot().platform_pending == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("observation was not queued");

        broker.cancel_all();
        let error = observation
            .await
            .expect("join queued observation")
            .expect_err("queued observation was cancelled");
        assert_eq!(
            error.platform_failure_kind(),
            Some(PlatformStorageFailureKind::Cancelled)
        );
        assert_eq!(pool.snapshot().platform_pending, 0);
        assert!(broker.next_request().await.is_none());
        pool.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn broker_cancellation_wakes_all_waiting_provider_receivers() {
        let (_client, broker) = platform_storage_channel();
        let mut providers = Vec::new();
        for _ in 0..4 {
            let broker = broker.clone();
            providers.push(tokio::spawn(async move { broker.next_request().await }));
        }
        tokio::task::yield_now().await;
        broker.cancel_all();
        for provider in providers {
            assert!(
                tokio::time::timeout(std::time::Duration::from_secs(1), provider)
                    .await
                    .expect("provider receiver did not wake")
                    .expect("join provider receiver")
                    .is_none()
            );
        }
    }

    #[tokio::test]
    async fn dropping_platform_observation_releases_pending_and_is_pruned() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 4,
                role: StorageFileRole::Payload(2),
                path: vec!["content".to_owned(), "payload.bin".to_owned()],
            }),
        );
        let observation = tokio::spawn({
            let reference = reference.clone();
            async move { reference.observe().await }
        });
        let abandoned = broker.next_request().await.expect("abandoned observation");
        assert_eq!(pool.snapshot().platform_pending, 1);
        observation.abort();
        assert!(
            observation
                .await
                .expect_err("observation aborted")
                .is_cancelled()
        );
        assert_eq!(pool.snapshot().platform_pending, 0);

        let next = tokio::spawn(async move { reference.observe().await });
        let active = broker.next_request().await.expect("active observation");
        assert!(!broker.is_pending(abandoned.request_id));
        assert!(
            broker.complete_observation(
                active.request_id,
                StorageObservation::present(StorageObjectKind::File, Some(5), None)
                    .expect("observation"),
            )
        );
        assert_eq!(
            next.await
                .expect("join active observation")
                .expect("active observation")
                .length,
            Some(5),
        );
        assert_eq!(pool.snapshot().platform_pending, 0);
        pool.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn path_observation_is_bounded_and_never_creates() {
        let root = temp_root("observe-path");
        std::fs::create_dir_all(&root).expect("root");
        let pool = StorageFilePool::new(2, None).expect("pool");
        let reference = reference(pool.clone(), &root, 0);
        assert_eq!(
            reference.observe().await.expect("missing observation"),
            StorageObservation::missing()
        );
        assert!(!root.join("0.bin").exists());

        std::fs::write(root.join("0.bin"), b"hello").expect("payload");
        let observed = reference.observe().await.expect("file observation");
        assert!(observed.exists);
        assert_eq!(observed.kind, Some(StorageObjectKind::File));
        assert_eq!(observed.length, Some(5));
        assert!(
            observed
                .opaque_token
                .as_ref()
                .is_none_or(|token| token.len() <= super::MAX_STORAGE_OBSERVATION_TOKEN_BYTES)
        );
        assert_eq!(pool.snapshot().current_owned, 0);
        pool.shutdown().await.expect("shutdown");
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn platform_observation_uses_typed_response_without_opening_a_handle() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 7,
                role: StorageFileRole::Payload(1),
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 7,
                role: StorageFileRole::Payload(1),
                path: vec!["content".to_owned(), "file.bin".to_owned()],
            }),
        );
        let observation = tokio::spawn(async move { reference.observe().await });
        let request = broker.next_request().await.expect("observation request");
        assert_eq!(request.operation, PlatformStorageOperation::Observe);
        assert_eq!(request.storage_generation, 7);
        assert_eq!(request.path, ["content", "file.bin"]);
        let expected = StorageObservation::present(
            StorageObjectKind::File,
            Some(23),
            Some("provider-v1:opaque".to_owned()),
        )
        .expect("valid observation");
        assert!(broker.complete_observation(request.request_id, expected.clone()));
        assert_eq!(
            observation
                .await
                .expect("observation task")
                .expect("result"),
            expected
        );
        assert_eq!(pool.snapshot().current_owned, 0);
        pool.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn invalidation_rejects_a_late_platform_observation() {
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(2, Some(client)).expect("pool");
        let reference = StorageFileReference::new(
            pool.clone(),
            StorageFileKey {
                storage_id: "torrent".to_owned(),
                storage_generation: 3,
                role: StorageFileRole::ContentRoot,
            },
            StorageFileLocator::Platform(super::PlatformStorageTarget {
                root_id: "root".to_owned(),
                storage_id: "torrent".to_owned(),
                storage_generation: 3,
                role: StorageFileRole::ContentRoot,
                path: vec!["content".to_owned()],
            }),
        );
        let observation = tokio::spawn(async move { reference.observe().await });
        let request = broker.next_request().await.expect("observation request");
        pool.invalidate_storage("torrent");
        assert!(
            broker.complete_observation(
                request.request_id,
                StorageObservation::present(StorageObjectKind::Directory, None, None)
                    .expect("directory observation"),
            )
        );
        assert!(matches!(
            observation.await.expect("observation task"),
            Err(super::StorageFilePoolError::Invalidated)
        ));
        pool.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn bounds_ten_thousand_logical_files_across_hundred_torrents() {
        let root = temp_root("logical-scale");
        let pool = StorageFilePool::new(8, None).expect("pool");
        for logical_index in 0..10_000 {
            let file_index = logical_index % 100;
            let reference = StorageFileReference::new(
                pool.clone(),
                StorageFileKey {
                    storage_id: format!("torrent-{}", logical_index / 100),
                    storage_generation: 0,
                    role: StorageFileRole::Payload(file_index),
                },
                StorageFileLocator::Path(root.join(format!("{file_index}.bin"))),
            );
            drop(
                reference
                    .open(StorageFileAccess::ReadWriteCreate)
                    .await
                    .expect("open logical file"),
            );
        }
        let snapshot = pool.snapshot();
        assert_eq!(snapshot.owned_high_water, 8);
        assert_eq!(snapshot.cached_entries, 8);
        assert!(snapshot.evictions >= 9_992);
        pool.shutdown().await.expect("shutdown");
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
