use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{oneshot, watch};
use tokio_util::sync::CancellationToken;

use super::{
    ApplicationConnectionMetrics, ChooseDownloadRootRequest, ChooseDownloadRootResponse,
    GatewayAuthentication, GatewayError, GatewayState, MAX_INCOMING_MESSAGE_BYTES,
    constant_time_equal,
};
use rstorrent_session::{RequestEnvelope, ResponseEnvelope, StorageRootSnapshot};

pub const ARC_COMPANION_HOST: &str = "100.115.92.2";
const ARC_COMPANION_ADDRESS: Ipv4Addr = Ipv4Addr::new(100, 115, 92, 2);
pub const ANDROID_COMPANION_PORTS: [u16; 5] = [3030, 3031, 3032, 3033, 3034];
pub const BETA_EXTENSION_ORIGIN: &str = "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc";
pub const PRODUCTION_EXTENSION_ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk";
const MAX_PAIRINGS: usize = 4;
const MAX_NONCES: usize = 8;
const MAX_IDENTIFIER_BYTES: usize = 64;
const PAIRING_LIFETIME: Duration = Duration::from_secs(2 * 60);
const FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
const SUPPRESSION_TIME: Duration = Duration::from_secs(10 * 60);
const MAX_FAILURES: usize = 5;
const PLATFORM_REQUEST_LIFETIME: Duration = Duration::from_secs(2 * 60);

#[derive(Debug)]
pub enum CompanionPairingError {
    Configuration(String),
    InvalidRequest,
    Busy,
    Suppressed,
    Capacity,
    NotFound,
    Expired,
    AlreadySettled,
    Store(rusqlite::Error),
    Random(getrandom::Error),
}

impl fmt::Display for CompanionPairingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => formatter.write_str(message),
            Self::InvalidRequest => formatter.write_str("pairing request is invalid"),
            Self::Busy => formatter.write_str("another pairing request is pending"),
            Self::Suppressed => formatter.write_str("pairing requests are temporarily suppressed"),
            Self::Capacity => formatter.write_str("pairing capacity is full"),
            Self::NotFound => formatter.write_str("pairing request was not found"),
            Self::Expired => formatter.write_str("pairing request expired"),
            Self::AlreadySettled => formatter.write_str("pairing request is already settled"),
            Self::Store(error) => write!(formatter, "pairing store: {error}"),
            Self::Random(error) => write!(formatter, "pairing randomness: {error}"),
        }
    }
}

impl std::error::Error for CompanionPairingError {}

impl From<rusqlite::Error> for CompanionPairingError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error)
    }
}

impl From<getrandom::Error> for CompanionPairingError {
    fn from(error: getrandom::Error) -> Self {
        Self::Random(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CompanionHello {
    pub product: String,
    pub backend: String,
    pub protocol_min: u16,
    pub protocol_max: u16,
    pub port: u16,
    pub nonce: String,
    pub paired: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CompanionPairingPending {
    pub request_id: String,
    pub extension_id: String,
    pub extension_name: String,
    pub installation_id: String,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanionPairingPollStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CompanionPairingPoll {
    pub status: CompanionPairingPollStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CompanionRootRequest {
    pub request_id: String,
    pub repair_root: Option<String>,
    pub expires_in_seconds: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompanionRootRemovalRequest {
    pub request_id: String,
    pub application_request: RequestEnvelope,
    pub expires_in_seconds: u64,
}

#[derive(Debug)]
pub enum CompanionPlatformError {
    Busy,
    Expired,
    Revoked,
    Closed,
    Failure(String),
    Random(getrandom::Error),
}

impl fmt::Display for CompanionPlatformError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy => formatter.write_str("another download-root request is pending"),
            Self::Expired => formatter.write_str("download-root request expired"),
            Self::Revoked => formatter.write_str("companion pairing was revoked"),
            Self::Closed => formatter.write_str("download-root request owner closed"),
            Self::Failure(message) => formatter.write_str(message),
            Self::Random(error) => write!(formatter, "download-root randomness: {error}"),
        }
    }
}

impl std::error::Error for CompanionPlatformError {}

#[derive(Clone, Default)]
pub struct CompanionPlatformOwner {
    inner: Arc<Mutex<Option<PendingRootRequest>>>,
    available: Arc<tokio::sync::Notify>,
    removal_inner: Arc<Mutex<Option<PendingRootRemoval>>>,
    removal_available: Arc<tokio::sync::Notify>,
}

impl fmt::Debug for CompanionPlatformOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CompanionPlatformOwner")
            .field(
                "pending",
                &self
                    .inner
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .is_some(),
            )
            .finish()
    }
}

struct PendingRootRequest {
    request_id: String,
    repair_root: Option<String>,
    expires: Instant,
    delivered: bool,
    result: Option<oneshot::Sender<Result<Option<StorageRootSnapshot>, String>>>,
}

struct PendingRootRemoval {
    request_id: String,
    application_request: RequestEnvelope,
    expires: Instant,
    delivered: bool,
    result: Option<oneshot::Sender<Result<ResponseEnvelope, String>>>,
}

impl CompanionPlatformOwner {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn next_request(&self) -> Option<CompanionRootRequest> {
        loop {
            let notified = self.available.notified();
            {
                let now = Instant::now();
                let mut pending = self
                    .inner
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if pending
                    .as_ref()
                    .is_some_and(|request| request.expires <= now)
                    && let Some(mut expired) = pending.take()
                    && let Some(result) = expired.result.take()
                {
                    let _ = result.send(Err("download-root request expired".to_owned()));
                }
                if let Some(request) = pending.as_mut()
                    && !request.delivered
                {
                    request.delivered = true;
                    return Some(CompanionRootRequest {
                        request_id: request.request_id.clone(),
                        repair_root: request.repair_root.clone(),
                        expires_in_seconds: request
                            .expires
                            .saturating_duration_since(now)
                            .as_secs(),
                    });
                }
            }
            notified.await;
        }
    }

    pub fn complete(&self, request_id: &str, root: Option<StorageRootSnapshot>) -> bool {
        self.finish(request_id, Ok(root))
    }

    pub async fn next_removal_request(&self) -> Option<CompanionRootRemovalRequest> {
        loop {
            let notified = self.removal_available.notified();
            {
                let now = Instant::now();
                let mut pending = self
                    .removal_inner
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if pending
                    .as_ref()
                    .is_some_and(|request| request.expires <= now)
                    && let Some(mut expired) = pending.take()
                    && let Some(result) = expired.result.take()
                {
                    let _ = result.send(Err("root-removal request expired".to_owned()));
                }
                if let Some(request) = pending.as_mut()
                    && !request.delivered
                {
                    request.delivered = true;
                    return Some(CompanionRootRemovalRequest {
                        request_id: request.request_id.clone(),
                        application_request: request.application_request.clone(),
                        expires_in_seconds: request
                            .expires
                            .saturating_duration_since(now)
                            .as_secs(),
                    });
                }
            }
            notified.await;
        }
    }

    pub fn complete_removal(&self, request_id: &str, response: ResponseEnvelope) -> bool {
        self.finish_removal(request_id, Ok(response))
    }

    pub fn fail_removal(&self, request_id: &str, message: &str) -> bool {
        let mut bounded = message.to_owned();
        bounded.truncate(bounded.floor_char_boundary(1_024));
        self.finish_removal(request_id, Err(bounded))
    }

    pub fn fail(&self, request_id: &str, message: &str) -> bool {
        let mut bounded = message.to_owned();
        bounded.truncate(bounded.floor_char_boundary(1_024));
        self.finish(request_id, Err(bounded))
    }

    pub fn close(&self) {
        let mut pending = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut request) = pending.take()
            && let Some(result) = request.result.take()
        {
            let _ = result.send(Err("download-root request owner closed".to_owned()));
        }
        self.available.notify_waiters();
        let mut removal = self
            .removal_inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut request) = removal.take()
            && let Some(result) = request.result.take()
        {
            let _ = result.send(Err("root-removal request owner closed".to_owned()));
        }
        self.removal_available.notify_waiters();
    }

    async fn request(
        &self,
        repair_root: Option<String>,
        revocation: CancellationToken,
    ) -> Result<Option<StorageRootSnapshot>, CompanionPlatformError> {
        if repair_root.as_deref().is_some_and(|root| {
            root.is_empty()
                || root.len() > MAX_IDENTIFIER_BYTES
                || !root
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        }) {
            return Err(CompanionPlatformError::Failure(
                "repair root ID is invalid".to_owned(),
            ));
        }
        let request_id = random_token(18).map_err(|error| match error {
            CompanionPairingError::Random(error) => CompanionPlatformError::Random(error),
            _ => unreachable!("random_token only returns randomness errors"),
        })?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if pending.is_some() {
                return Err(CompanionPlatformError::Busy);
            }
            *pending = Some(PendingRootRequest {
                request_id: request_id.clone(),
                repair_root,
                expires: Instant::now() + PLATFORM_REQUEST_LIFETIME,
                delivered: false,
                result: Some(sender),
            });
        }
        self.available.notify_one();
        let outcome = tokio::select! {
            biased;
            () = revocation.cancelled() => Err(CompanionPlatformError::Revoked),
            result = tokio::time::timeout(PLATFORM_REQUEST_LIFETIME, receiver) => match result {
                Ok(Ok(Ok(root))) => Ok(root),
                Ok(Ok(Err(message))) => Err(CompanionPlatformError::Failure(message)),
                Ok(Err(_)) => Err(CompanionPlatformError::Closed),
                Err(_) => Err(CompanionPlatformError::Expired),
            },
        };
        let mut pending = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if pending
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            *pending = None;
        }
        outcome
    }

    pub(crate) async fn request_removal(
        &self,
        application_request: RequestEnvelope,
        revocation: CancellationToken,
    ) -> Result<ResponseEnvelope, CompanionPlatformError> {
        let request_id = random_token(18).map_err(|error| match error {
            CompanionPairingError::Random(error) => CompanionPlatformError::Random(error),
            _ => unreachable!("random_token only returns randomness errors"),
        })?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self
                .removal_inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if pending.is_some() {
                return Err(CompanionPlatformError::Busy);
            }
            *pending = Some(PendingRootRemoval {
                request_id: request_id.clone(),
                application_request,
                expires: Instant::now() + PLATFORM_REQUEST_LIFETIME,
                delivered: false,
                result: Some(sender),
            });
        }
        self.removal_available.notify_one();
        let outcome = tokio::select! {
            biased;
            () = revocation.cancelled() => Err(CompanionPlatformError::Revoked),
            result = tokio::time::timeout(PLATFORM_REQUEST_LIFETIME, receiver) => match result {
                Ok(Ok(Ok(response))) => Ok(response),
                Ok(Ok(Err(message))) => Err(CompanionPlatformError::Failure(message)),
                Ok(Err(_)) => Err(CompanionPlatformError::Closed),
                Err(_) => Err(CompanionPlatformError::Expired),
            },
        };
        let mut pending = self
            .removal_inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if pending
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            *pending = None;
        }
        outcome
    }

    fn finish(
        &self,
        request_id: &str,
        outcome: Result<Option<StorageRootSnapshot>, String>,
    ) -> bool {
        let mut pending = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(mut request) = pending.take() else {
            return false;
        };
        if request.request_id != request_id {
            *pending = Some(request);
            return false;
        }
        request
            .result
            .take()
            .is_some_and(|result| result.send(outcome).is_ok())
    }

    fn finish_removal(&self, request_id: &str, outcome: Result<ResponseEnvelope, String>) -> bool {
        let mut pending = self
            .removal_inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(mut request) = pending.take() else {
            return false;
        };
        if request.request_id != request_id {
            *pending = Some(request);
            return false;
        }
        request
            .result
            .take()
            .is_some_and(|result| result.send(outcome).is_ok())
    }
}

#[derive(Clone)]
pub struct CompanionPairingOwner {
    inner: Arc<PairingInner>,
}

impl fmt::Debug for CompanionPairingOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        formatter
            .debug_struct("CompanionPairingOwner")
            .field("pending", &runtime.pending.is_some())
            .field("active_connections", &runtime.active.len())
            .finish()
    }
}

struct PairingInner {
    database: Mutex<Connection>,
    instance_id: String,
    runtime: Mutex<PairingRuntime>,
    next_connection: AtomicU64,
    active_connections: watch::Sender<usize>,
}

#[derive(Default)]
struct PairingRuntime {
    hello_nonces: VecDeque<HelloNonce>,
    pending: Option<PendingPairing>,
    failures: VecDeque<Instant>,
    suppressed_until: Option<Instant>,
    active: BTreeMap<u64, ActiveConnection>,
}

struct HelloNonce {
    origin: String,
    nonce: String,
    expires: Instant,
}

struct PendingPairing {
    request_id: String,
    origin: String,
    installation_id: String,
    extension_nonce: String,
    expires: Instant,
    state: PendingPairingState,
}

enum PendingPairingState {
    Requested,
    Approved { credential: String },
    Rejected,
}

struct ActiveConnection {
    pairing_key: String,
    cancellation: CancellationToken,
}

pub(crate) struct CompanionPairingLease {
    owner: Weak<PairingInner>,
    connection_id: u64,
    cancellation: CancellationToken,
}

impl CompanionPairingLease {
    pub(crate) fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }
}

impl Drop for CompanionPairingLease {
    fn drop(&mut self) {
        let Some(owner) = self.owner.upgrade() else {
            return;
        };
        let count = {
            let mut runtime = owner
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime
                .active
                .remove(&self.connection_id)
                .map(|_| runtime.active.len())
        };
        if let Some(count) = count {
            owner.active_connections.send_replace(count);
        }
    }
}

impl CompanionPairingOwner {
    pub fn open(path: &Path) -> Result<Arc<Self>, CompanionPairingError> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).map_err(|error| {
                CompanionPairingError::Configuration(format!("create pairing directory: {error}"))
            })?;
        }
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             CREATE TABLE IF NOT EXISTS companion_pairings(
                 origin TEXT NOT NULL,
                 installation_id TEXT NOT NULL,
                 credential_digest BLOB NOT NULL,
                 generation INTEGER NOT NULL,
                 created_unix_seconds INTEGER NOT NULL,
                 PRIMARY KEY(origin, installation_id)
             );
             CREATE TABLE IF NOT EXISTS companion_metadata(
                 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                 instance_id TEXT NOT NULL
             );",
        )?;
        let instance_id = match connection
            .query_row(
                "SELECT instance_id FROM companion_metadata WHERE singleton = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            Some(instance_id) => instance_id,
            None => random_token(18)?,
        };
        if !valid_identifier(&instance_id) {
            return Err(CompanionPairingError::Configuration(
                "persisted companion instance identity is invalid".to_owned(),
            ));
        }
        connection.execute(
            "INSERT OR IGNORE INTO companion_metadata(singleton, instance_id) VALUES (1, ?1)",
            [&instance_id],
        )?;
        let (active_connections, _) = watch::channel(0);
        Ok(Arc::new(Self {
            inner: Arc::new(PairingInner {
                database: Mutex::new(connection),
                instance_id,
                runtime: Mutex::new(PairingRuntime::default()),
                next_connection: AtomicU64::new(1),
                active_connections,
            }),
        }))
    }

    pub fn origin_allowed(origin: &str) -> bool {
        matches!(origin, BETA_EXTENSION_ORIGIN | PRODUCTION_EXTENSION_ORIGIN)
    }

    pub fn instance_id(&self) -> &str {
        &self.inner.instance_id
    }

    /// Observes only the count of currently authenticated companion sessions.
    pub fn active_connection_counts(&self) -> watch::Receiver<usize> {
        self.inner.active_connections.subscribe()
    }

    pub fn hello(&self, origin: &str, port: u16) -> Result<CompanionHello, CompanionPairingError> {
        if !Self::origin_allowed(origin) || !ANDROID_COMPANION_PORTS.contains(&port) {
            return Err(CompanionPairingError::InvalidRequest);
        }
        let nonce = random_token(24)?;
        let now = Instant::now();
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_runtime(&mut runtime, now);
        while runtime.hello_nonces.len() >= MAX_NONCES {
            runtime.hello_nonces.pop_front();
        }
        runtime.hello_nonces.push_back(HelloNonce {
            origin: origin.to_owned(),
            nonce: nonce.clone(),
            expires: now + PAIRING_LIFETIME,
        });
        Ok(CompanionHello {
            product: "rstorrent".to_owned(),
            backend: "android".to_owned(),
            protocol_min: 1,
            protocol_max: 1,
            port,
            nonce,
            paired: false,
        })
    }

    pub fn request_pairing(
        &self,
        origin: &str,
        hello_nonce: &str,
        installation_id: &str,
        extension_nonce: &str,
    ) -> Result<CompanionPairingPending, CompanionPairingError> {
        let now = Instant::now();
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_runtime(&mut runtime, now);
        if runtime.suppressed_until.is_some_and(|until| until > now) {
            return Err(CompanionPairingError::Suppressed);
        }
        let valid = if Self::origin_allowed(origin)
            && valid_identifier(installation_id)
            && valid_identifier(extension_nonce)
        {
            runtime.hello_nonces.iter().position(|candidate| {
                candidate.origin == origin
                    && candidate.nonce == hello_nonce
                    && candidate.expires > now
            })
        } else {
            None
        };
        let Some(nonce_index) = valid else {
            record_failure(&mut runtime, now);
            return Err(CompanionPairingError::InvalidRequest);
        };
        runtime.hello_nonces.remove(nonce_index);
        if runtime.pending.is_some() {
            return Err(CompanionPairingError::Busy);
        }
        let pairing_exists = self.pairing_exists(origin, installation_id)?;
        if !pairing_exists && self.pairing_count()? >= MAX_PAIRINGS {
            return Err(CompanionPairingError::Capacity);
        }
        let request_id = random_token(18)?;
        let expires = now + PAIRING_LIFETIME;
        runtime.pending = Some(PendingPairing {
            request_id: request_id.clone(),
            origin: origin.to_owned(),
            installation_id: installation_id.to_owned(),
            extension_nonce: extension_nonce.to_owned(),
            expires,
            state: PendingPairingState::Requested,
        });
        Ok(pending_snapshot(
            runtime.pending.as_ref().expect("pending inserted"),
            now,
        ))
    }

    pub fn pending(&self) -> Option<CompanionPairingPending> {
        let now = Instant::now();
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_runtime(&mut runtime, now);
        runtime.pending.as_ref().and_then(|pending| {
            matches!(pending.state, PendingPairingState::Requested)
                .then(|| pending_snapshot(pending, now))
        })
    }

    pub fn approve(&self, request_id: &str) -> Result<(), CompanionPairingError> {
        let now = Instant::now();
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_runtime(&mut runtime, now);
        let pending = runtime
            .pending
            .as_mut()
            .ok_or(CompanionPairingError::NotFound)?;
        if pending.request_id != request_id {
            return Err(CompanionPairingError::NotFound);
        }
        if pending.expires <= now {
            runtime.pending = None;
            return Err(CompanionPairingError::Expired);
        }
        if !matches!(pending.state, PendingPairingState::Requested) {
            return Err(CompanionPairingError::AlreadySettled);
        }
        let credential = random_token(32)?;
        let digest = Sha256::digest(credential.as_bytes());
        let database = self
            .inner
            .database
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = database
            .query_row(
                "SELECT generation FROM companion_pairings
                 WHERE origin = ?1 AND installation_id = ?2",
                params![pending.origin, pending.installation_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0_i64)
            .saturating_add(1);
        database.execute(
            "INSERT INTO companion_pairings(
                 origin, installation_id, credential_digest, generation, created_unix_seconds
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(origin, installation_id) DO UPDATE SET
                 credential_digest = excluded.credential_digest,
                 generation = excluded.generation,
                 created_unix_seconds = excluded.created_unix_seconds",
            params![
                pending.origin,
                pending.installation_id,
                digest.as_slice(),
                generation,
                unix_seconds(),
            ],
        )?;
        let key = pairing_key(&pending.origin, &pending.installation_id);
        pending.state = PendingPairingState::Approved { credential };
        for active in runtime.active.values() {
            if active.pairing_key == key {
                active.cancellation.cancel();
            }
        }
        Ok(())
    }

    pub fn reject(&self, request_id: &str) -> Result<(), CompanionPairingError> {
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = runtime
            .pending
            .as_mut()
            .ok_or(CompanionPairingError::NotFound)?;
        if pending.request_id != request_id {
            return Err(CompanionPairingError::NotFound);
        }
        if !matches!(pending.state, PendingPairingState::Requested) {
            return Err(CompanionPairingError::AlreadySettled);
        }
        pending.state = PendingPairingState::Rejected;
        Ok(())
    }

    pub fn poll(
        &self,
        origin: &str,
        request_id: &str,
        installation_id: &str,
        extension_nonce: &str,
    ) -> Result<CompanionPairingPoll, CompanionPairingError> {
        let now = Instant::now();
        let mut runtime = self
            .inner
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(pending) = runtime.pending.as_ref() else {
            return Err(CompanionPairingError::NotFound);
        };
        if pending.request_id != request_id
            || pending.origin != origin
            || pending.installation_id != installation_id
            || pending.extension_nonce != extension_nonce
        {
            record_failure(&mut runtime, now);
            return Err(CompanionPairingError::NotFound);
        }
        if pending.expires <= now {
            runtime.pending = None;
            return Ok(CompanionPairingPoll {
                status: CompanionPairingPollStatus::Expired,
                credential: None,
            });
        }
        let response = match &pending.state {
            PendingPairingState::Requested => CompanionPairingPoll {
                status: CompanionPairingPollStatus::Pending,
                credential: None,
            },
            PendingPairingState::Approved { credential } => CompanionPairingPoll {
                status: CompanionPairingPollStatus::Approved,
                credential: Some(credential.clone()),
            },
            PendingPairingState::Rejected => CompanionPairingPoll {
                status: CompanionPairingPollStatus::Rejected,
                credential: None,
            },
        };
        if !matches!(response.status, CompanionPairingPollStatus::Pending) {
            runtime.pending = None;
        }
        Ok(response)
    }

    pub fn revoke(
        &self,
        origin: &str,
        installation_id: &str,
    ) -> Result<bool, CompanionPairingError> {
        let changed = self
            .inner
            .database
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .execute(
                "DELETE FROM companion_pairings WHERE origin = ?1 AND installation_id = ?2",
                params![origin, installation_id],
            )?
            != 0;
        if changed {
            let key = pairing_key(origin, installation_id);
            let runtime = self
                .inner
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for active in runtime.active.values() {
                if active.pairing_key == key {
                    active.cancellation.cancel();
                }
            }
        }
        Ok(changed)
    }

    pub(crate) fn authenticate(
        &self,
        origin: &str,
        installation_id: &str,
        credential: &str,
    ) -> Option<CompanionPairingLease> {
        if !Self::origin_allowed(origin)
            || !valid_identifier(installation_id)
            || credential.is_empty()
            || credential.len() > 128
        {
            return None;
        }
        let expected = self
            .inner
            .database
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row(
                "SELECT credential_digest FROM companion_pairings
                 WHERE origin = ?1 AND installation_id = ?2",
                params![origin, installation_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .ok()
            .flatten()?;
        let actual = Sha256::digest(credential.as_bytes());
        if !constant_time_equal(&actual, &expected) {
            return None;
        }
        let connection_id = self.inner.next_connection.fetch_add(1, Ordering::Relaxed);
        let cancellation = CancellationToken::new();
        let count = {
            let mut runtime = self
                .inner
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime.active.insert(
                connection_id,
                ActiveConnection {
                    pairing_key: pairing_key(origin, installation_id),
                    cancellation: cancellation.clone(),
                },
            );
            runtime.active.len()
        };
        self.inner.active_connections.send_replace(count);
        Some(CompanionPairingLease {
            owner: Arc::downgrade(&self.inner),
            connection_id,
            cancellation,
        })
    }

    fn pairing_exists(
        &self,
        origin: &str,
        installation_id: &str,
    ) -> Result<bool, CompanionPairingError> {
        Ok(self
            .inner
            .database
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row(
                "SELECT 1 FROM companion_pairings WHERE origin = ?1 AND installation_id = ?2",
                params![origin, installation_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn pairing_count(&self) -> Result<usize, CompanionPairingError> {
        let count = self
            .inner
            .database
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .query_row("SELECT COUNT(*) FROM companion_pairings", [], |row| {
                row.get::<_, i64>(0)
            })?;
        usize::try_from(count).map_err(|_| {
            CompanionPairingError::Configuration("pairing count exceeds usize".to_owned())
        })
    }
}

#[derive(Clone)]
struct CompanionHttpState {
    gateway: GatewayState,
    pairings: Arc<CompanionPairingOwner>,
    platform: Arc<CompanionPlatformOwner>,
    port: u16,
    requests: Arc<tokio::sync::Semaphore>,
}

#[derive(Debug, Deserialize)]
struct PairingRequestBody {
    hello_nonce: String,
    installation_id: String,
    extension_nonce: String,
}

#[derive(Debug, Deserialize)]
struct PairingPollBody {
    request_id: String,
    installation_id: String,
    extension_nonce: String,
}

pub struct CompanionServer {
    listener: tokio::net::TcpListener,
    local_addr: SocketAddr,
    state: CompanionHttpState,
}

impl fmt::Debug for CompanionServer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CompanionServer")
            .field("local_addr", &self.local_addr)
            .finish_non_exhaustive()
    }
}

impl CompanionServer {
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn connection_metrics(&self) -> ApplicationConnectionMetrics {
        self.state.gateway.connection_metrics.clone()
    }

    pub async fn serve(self, shutdown: CancellationToken) -> Result<(), GatewayError> {
        let gateway_shutdown = self.state.gateway.gateway_shutdown.clone();
        let router = Router::new()
            .route(
                "/rstorrent/companion/v1/hello",
                get(companion_hello).options(companion_preflight),
            )
            .route(
                "/rstorrent/companion/v1/pairing/request",
                post(companion_pairing_request).options(companion_preflight),
            )
            .route(
                "/rstorrent/companion/v1/pairing/poll",
                post(companion_pairing_poll).options(companion_preflight),
            )
            .route("/rstorrent/companion/v1/connect", get(companion_websocket))
            .route(
                "/rstorrent/companion/v1/platform/download-root",
                post(companion_download_root).options(companion_preflight),
            )
            .fallback(companion_not_found)
            .layer(axum::extract::DefaultBodyLimit::max(
                MAX_INCOMING_MESSAGE_BYTES,
            ))
            .with_state(self.state);
        axum::serve(
            self.listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            shutdown.cancelled().await;
            gateway_shutdown.cancel();
        })
        .await
        .map_err(GatewayError::Serve)
    }
}

/// Binds the Android companion only to ARC's fixed guest address.
///
/// This is a same-device transport boundary: product callers must never widen
/// it to a wildcard or LAN-reachable listener.
pub async fn bind_companion(
    pairings: Arc<CompanionPairingOwner>,
    platform: Arc<CompanionPlatformOwner>,
    service: Arc<tokio::sync::Mutex<rstorrent_session::ApplicationService>>,
    profile_id: &str,
    product_version: &str,
) -> Result<CompanionServer, GatewayError> {
    bind_companion_on(
        ARC_COMPANION_ADDRESS,
        pairings,
        platform,
        service,
        profile_id,
        product_version,
    )
    .await
}

/// Address-injection seam for deterministic host-side integration tests.
/// Product callers must use [`bind_companion`], which is fixed to the ARC
/// interface.
#[doc(hidden)]
pub async fn bind_companion_on(
    bind_address: Ipv4Addr,
    pairings: Arc<CompanionPairingOwner>,
    platform: Arc<CompanionPlatformOwner>,
    service: Arc<tokio::sync::Mutex<rstorrent_session::ApplicationService>>,
    profile_id: &str,
    product_version: &str,
) -> Result<CompanionServer, GatewayError> {
    let mut last_error = None;
    let mut bound = None;
    for port in ANDROID_COMPANION_PORTS {
        match tokio::net::TcpListener::bind(SocketAddr::from((bind_address, port))).await {
            Ok(listener) => {
                bound = Some((port, listener));
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }
    let (port, listener) = bound.ok_or_else(|| {
        GatewayError::Bind(last_error.unwrap_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no companion port")
        }))
    })?;
    let local_addr = listener.local_addr().map_err(GatewayError::Bind)?;
    let origin = format!("http://{ARC_COMPANION_HOST}:{port}");
    let gateway = GatewayState {
        authentication: Arc::new(GatewayAuthentication::ChromeOsCompanion(pairings.clone())),
        allowed_origin: Arc::from(BETA_EXTENSION_ORIGIN),
        allowed_host: Arc::from(format!("{ARC_COMPANION_HOST}:{port}")),
        media_host: Arc::from(format!("{ARC_COMPANION_HOST}:{port}")),
        media_origin: Arc::from(origin),
        service,
        connections: Arc::new(tokio::sync::Semaphore::new(4)),
        torrent_uploads: Arc::new(tokio::sync::Semaphore::new(1)),
        http_owner_namespace: super::NEXT_HTTP_OWNER.fetch_add(1, Ordering::Relaxed),
        connection_registry: super::application_websocket::ApplicationConnectionRegistry::new(),
        connection_metrics: ApplicationConnectionMetrics::default(),
        gateway_shutdown: CancellationToken::new(),
        hello_backend: Some(rstorrent_session::ApiBackendIdentity {
            kind: "android".to_owned(),
            instance_id: pairings.instance_id().to_owned(),
            profile_id: profile_id.to_owned(),
            product_version: product_version.to_owned(),
            capability_profile: vec![
                "android_saf_acquisition".to_owned(),
                "retained_storage_roots".to_owned(),
                "one_current_root".to_owned(),
                "joined_platform_root_removal".to_owned(),
            ],
        }),
        companion_platform: Some(platform.clone()),
        download_directory_picker: Arc::new(super::UnavailableDownloadDirectoryPicker),
        hosted_assets: None,
        web_auth: None,
    };
    Ok(CompanionServer {
        listener,
        local_addr,
        state: CompanionHttpState {
            gateway,
            pairings,
            platform,
            port,
            requests: Arc::new(tokio::sync::Semaphore::new(8)),
        },
    })
}

async fn companion_hello(State(state): State<CompanionHttpState>, headers: HeaderMap) -> Response {
    let Some((origin, _permit)) = admit_http(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    match state.pairings.hello(origin, state.port) {
        Ok(mut hello) => {
            hello.paired = headers
                .get("x-jstorrent-installation")
                .or_else(|| headers.get("x-rstorrent-installation"))
                .and_then(|value| value.to_str().ok())
                .filter(|installation_id| valid_identifier(installation_id))
                .is_some_and(|installation_id| {
                    state
                        .pairings
                        .pairing_exists(origin, installation_id)
                        .unwrap_or(false)
                });
            companion_json(StatusCode::OK, origin, &hello)
        }
        Err(_) => companion_status(StatusCode::BAD_REQUEST, origin),
    }
}

async fn companion_pairing_request(
    State(state): State<CompanionHttpState>,
    headers: HeaderMap,
    Json(request): Json<PairingRequestBody>,
) -> Response {
    let Some((origin, _permit)) = admit_http(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    match state.pairings.request_pairing(
        origin,
        &request.hello_nonce,
        &request.installation_id,
        &request.extension_nonce,
    ) {
        Ok(pending) => companion_json(StatusCode::ACCEPTED, origin, &pending),
        Err(CompanionPairingError::Busy) => companion_status(StatusCode::CONFLICT, origin),
        Err(CompanionPairingError::Suppressed) => {
            companion_status(StatusCode::TOO_MANY_REQUESTS, origin)
        }
        Err(CompanionPairingError::Capacity) => {
            companion_status(StatusCode::INSUFFICIENT_STORAGE, origin)
        }
        Err(_) => companion_status(StatusCode::BAD_REQUEST, origin),
    }
}

async fn companion_pairing_poll(
    State(state): State<CompanionHttpState>,
    headers: HeaderMap,
    Json(request): Json<PairingPollBody>,
) -> Response {
    let Some((origin, _permit)) = admit_http(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    match state.pairings.poll(
        origin,
        &request.request_id,
        &request.installation_id,
        &request.extension_nonce,
    ) {
        Ok(poll) => companion_json(StatusCode::OK, origin, &poll),
        Err(CompanionPairingError::NotFound) => companion_status(StatusCode::NOT_FOUND, origin),
        Err(_) => companion_status(StatusCode::BAD_REQUEST, origin),
    }
}

async fn companion_websocket(
    State(state): State<CompanionHttpState>,
    connect: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    websocket: axum::extract::ws::WebSocketUpgrade,
) -> Response {
    if admit_http(&state, &headers).is_none() {
        return StatusCode::FORBIDDEN.into_response();
    }
    super::application_websocket::upgrade_application_connection(
        State(state.gateway),
        connect,
        headers,
        websocket,
    )
    .await
}

async fn companion_download_root(
    State(state): State<CompanionHttpState>,
    headers: HeaderMap,
    Json(request): Json<ChooseDownloadRootRequest>,
) -> Response {
    let Some((origin, _permit)) = admit_http(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(installation_id) = headers
        .get("x-jstorrent-installation")
        .or_else(|| headers.get("x-rstorrent-installation"))
        .and_then(|value| value.to_str().ok())
    else {
        return companion_status(StatusCode::UNAUTHORIZED, origin);
    };
    let Some(credential) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return companion_status(StatusCode::UNAUTHORIZED, origin);
    };
    let Some(lease) = state
        .pairings
        .authenticate(origin, installation_id, credential)
    else {
        return companion_status(StatusCode::UNAUTHORIZED, origin);
    };
    match state
        .platform
        .request(request.repair_root, lease.cancellation().clone())
        .await
    {
        Ok(root) => companion_json(StatusCode::OK, origin, &ChooseDownloadRootResponse { root }),
        Err(CompanionPlatformError::Busy) => companion_status(StatusCode::CONFLICT, origin),
        Err(CompanionPlatformError::Revoked) => companion_status(StatusCode::UNAUTHORIZED, origin),
        Err(CompanionPlatformError::Expired) => {
            companion_status(StatusCode::REQUEST_TIMEOUT, origin)
        }
        Err(CompanionPlatformError::Failure(_)) => {
            companion_status(StatusCode::UNPROCESSABLE_ENTITY, origin)
        }
        Err(CompanionPlatformError::Closed | CompanionPlatformError::Random(_)) => {
            companion_status(StatusCode::SERVICE_UNAVAILABLE, origin)
        }
    }
}

async fn companion_not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

async fn companion_preflight(
    State(state): State<CompanionHttpState>,
    headers: HeaderMap,
) -> Response {
    let Some((origin, _permit)) = admit_http(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let mut response = companion_json(StatusCode::NO_CONTENT, origin, &());
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(
            "authorization, content-type, x-jstorrent-installation, x-rstorrent-installation",
        ),
    );
    response
}

fn admit_http<'a>(
    state: &'a CompanionHttpState,
    headers: &'a HeaderMap,
) -> Option<(&'a str, tokio::sync::OwnedSemaphorePermit)> {
    let origin = headers.get(header::ORIGIN)?.to_str().ok()?;
    if !CompanionPairingOwner::origin_allowed(origin)
        || headers.get(header::HOST)?.to_str().ok()? != state.gateway.allowed_host.as_ref()
    {
        return None;
    }
    let permit = state.requests.clone().try_acquire_owned().ok()?;
    Some((origin, permit))
}

fn companion_json<T: Serialize>(status: StatusCode, origin: &str, value: &T) -> Response {
    let mut response = (status, Json(value)).into_response();
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_str(origin).expect("allow-listed extension origin is a header value"),
    );
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Origin"));
    response
}

fn companion_status(status: StatusCode, origin: &str) -> Response {
    let mut response = status.into_response();
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_str(origin).expect("allow-listed extension origin is a header value"),
    );
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Origin"));
    response
}

fn extension_identity(origin: &str) -> (&'static str, &'static str) {
    match origin {
        BETA_EXTENSION_ORIGIN => ("gcgoepclopkgijmclmlheafaglmbjlcc", "JSTorrent Beta"),
        PRODUCTION_EXTENSION_ORIGIN => ("dbokmlpefliilbjldladbimlcfgbolhk", "JSTorrent"),
        _ => ("unknown", "Unknown extension"),
    }
}

fn pending_snapshot(pending: &PendingPairing, now: Instant) -> CompanionPairingPending {
    let (extension_id, extension_name) = extension_identity(&pending.origin);
    CompanionPairingPending {
        request_id: pending.request_id.clone(),
        extension_id: extension_id.to_owned(),
        extension_name: extension_name.to_owned(),
        installation_id: pending.installation_id.clone(),
        expires_in_seconds: pending.expires.saturating_duration_since(now).as_secs(),
    }
}

fn valid_identifier(value: &str) -> bool {
    (16..=MAX_IDENTIFIER_BYTES).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn pairing_key(origin: &str, installation_id: &str) -> String {
    format!("{origin}\0{installation_id}")
}

fn random_token(bytes: usize) -> Result<String, CompanionPairingError> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random)?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .try_into()
        .unwrap_or(i64::MAX)
}

fn prune_runtime(runtime: &mut PairingRuntime, now: Instant) {
    runtime.hello_nonces.retain(|nonce| nonce.expires > now);
    runtime
        .failures
        .retain(|failure| now.duration_since(*failure) <= FAILURE_WINDOW);
    if runtime.suppressed_until.is_some_and(|until| until <= now) {
        runtime.suppressed_until = None;
    }
    if runtime
        .pending
        .as_ref()
        .is_some_and(|pending| pending.expires <= now)
    {
        runtime.pending = None;
    }
}

fn record_failure(runtime: &mut PairingRuntime, now: Instant) {
    runtime.failures.push_back(now);
    runtime
        .failures
        .retain(|failure| now.duration_since(*failure) <= FAILURE_WINDOW);
    if runtime.failures.len() >= MAX_FAILURES {
        runtime.suppressed_until = Some(now + SUPPRESSION_TIME);
        runtime.failures.clear();
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn production_companion_address_is_the_arc_interface() {
        assert_eq!(ARC_COMPANION_ADDRESS.to_string(), ARC_COMPANION_HOST);
        assert!(!ARC_COMPANION_ADDRESS.is_unspecified());
        for port in ANDROID_COMPANION_PORTS {
            assert_eq!(
                SocketAddr::from((ARC_COMPANION_ADDRESS, port)),
                format!("{ARC_COMPANION_HOST}:{port}")
                    .parse()
                    .expect("ARC companion socket"),
            );
        }
    }

    fn owner(label: &str) -> (Arc<CompanionPairingOwner>, std::path::PathBuf) {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "rstorrent-companion-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create pairing fixture");
        let owner =
            CompanionPairingOwner::open(&root.join("pairings.sqlite")).expect("open pairing owner");
        (owner, root)
    }

    fn request(owner: &CompanionPairingOwner, installation_id: &str) -> CompanionPairingPending {
        let hello = owner
            .hello(BETA_EXTENSION_ORIGIN, 3030)
            .expect("companion hello");
        owner
            .request_pairing(
                BETA_EXTENSION_ORIGIN,
                &hello.nonce,
                installation_id,
                "extension_nonce_1234",
            )
            .expect("request pairing")
    }

    #[test]
    fn approval_persists_only_a_digest_and_revocation_cancels_connections() {
        let (owner, root) = owner("approval");
        let mut active_connections = owner.active_connection_counts();
        assert_eq!(*active_connections.borrow_and_update(), 0);
        let pending = request(&owner, "installation_1234");
        owner.approve(&pending.request_id).expect("approve pairing");
        let poll = owner
            .poll(
                BETA_EXTENSION_ORIGIN,
                &pending.request_id,
                "installation_1234",
                "extension_nonce_1234",
            )
            .expect("poll approved pairing");
        assert_eq!(poll.status, CompanionPairingPollStatus::Approved);
        let credential = poll.credential.expect("one-time credential");
        let lease = owner
            .authenticate(BETA_EXTENSION_ORIGIN, "installation_1234", &credential)
            .expect("authenticate pairing");
        assert!(active_connections.has_changed().expect("count sender open"));
        assert_eq!(*active_connections.borrow_and_update(), 1);
        assert!(!lease.cancellation().is_cancelled());
        assert!(
            owner
                .revoke(BETA_EXTENSION_ORIGIN, "installation_1234")
                .expect("revoke pairing")
        );
        assert!(lease.cancellation().is_cancelled());
        assert!(
            owner
                .authenticate(BETA_EXTENSION_ORIGIN, "installation_1234", &credential)
                .is_none()
        );
        drop(lease);
        assert!(active_connections.has_changed().expect("count sender open"));
        assert_eq!(*active_connections.borrow_and_update(), 0);
        drop(owner);

        let database = Connection::open(root.join("pairings.sqlite")).expect("reopen database");
        let rows: i64 = database
            .query_row("SELECT COUNT(*) FROM companion_pairings", [], |row| {
                row.get(0)
            })
            .expect("pairing row count");
        assert_eq!(rows, 0);
        fs::remove_dir_all(root).expect("remove pairing fixture");
    }

    #[tokio::test]
    async fn released_installation_headers_allow_paired_hello_and_folder_selection() {
        use rstorrent_session::{
            ApplicationConfig, ApplicationService, NetworkConfig, NetworkPolicy,
        };

        let (owner, root) = owner("installation-headers");
        let service = Arc::new(tokio::sync::Mutex::new(
            ApplicationService::open(ApplicationConfig::ephemeral(
                "test".to_owned(),
                vec![],
                NetworkConfig::new(
                    NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .expect("open application"),
        ));
        let platform = CompanionPlatformOwner::new();
        let server = bind_companion_on(
            Ipv4Addr::LOCALHOST,
            owner.clone(),
            platform.clone(),
            service.clone(),
            "test",
            "1.0.32",
        )
        .await
        .expect("bind companion");
        let state = server.state.clone();
        let pending = request(&owner, "installation_1234");
        owner.approve(&pending.request_id).expect("approve pairing");
        let credential = owner
            .poll(
                BETA_EXTENSION_ORIGIN,
                &pending.request_id,
                "installation_1234",
                "extension_nonce_1234",
            )
            .expect("poll pairing")
            .credential
            .expect("credential");
        for name in ["x-jstorrent-installation", "x-rstorrent-installation"] {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::ORIGIN,
                HeaderValue::from_static(BETA_EXTENSION_ORIGIN),
            );
            headers.insert(
                header::HOST,
                HeaderValue::from_str(state.gateway.allowed_host.as_ref()).expect("host"),
            );
            headers.insert(name, HeaderValue::from_static("installation_1234"));
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {credential}")).expect("authorization"),
            );
            let preflight = companion_preflight(State(state.clone()), headers.clone()).await;
            assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
            assert!(
                preflight.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS]
                    .to_str()
                    .expect("allowed headers")
                    .split(", ")
                    .any(|value| value == name)
            );
            let hello = companion_hello(State(state.clone()), headers.clone()).await;
            let body = axum::body::to_bytes(hello.into_body(), 16384)
                .await
                .expect("hello body");
            let hello: serde_json::Value = serde_json::from_slice(&body).expect("hello JSON");
            assert_eq!(hello["paired"], true, "{name}");
            let request_state = state.clone();
            let request_headers = headers.clone();
            let response = tokio::spawn(async move {
                companion_download_root(
                    State(request_state),
                    request_headers,
                    Json(ChooseDownloadRootRequest { repair_root: None }),
                )
                .await
            });
            let pending = tokio::time::timeout(Duration::from_secs(2), platform.next_request())
                .await
                .expect("authenticated folder request")
                .expect("pending request");
            assert!(platform.complete(&pending.request_id, None));
            assert_eq!(
                response.await.expect("join folder request").status(),
                StatusCode::OK
            );
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_static("Bearer wrong"),
            );
            assert_eq!(
                companion_download_root(
                    State(state.clone()),
                    headers,
                    Json(ChooseDownloadRootRequest { repair_root: None }),
                )
                .await
                .status(),
                StatusCode::UNAUTHORIZED
            );
        }
        drop(server);
        drop(state);
        service
            .lock()
            .await
            .shutdown()
            .await
            .expect("shutdown application");
        drop(service);
        drop(owner);
        fs::remove_dir_all(root).expect("remove header fixture");
    }

    #[test]
    fn backend_instance_identity_persists_with_the_pairing_store() {
        let (owner, root) = owner("instance-identity");
        let first = owner.instance_id().to_owned();
        drop(owner);

        let reopened = CompanionPairingOwner::open(&root.join("pairings.sqlite"))
            .expect("reopen pairing owner");
        assert_eq!(reopened.instance_id(), first);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove pairing fixture");
    }

    #[test]
    fn pending_pairing_is_single_bounded_and_bound_to_all_nonces() {
        let (owner, root) = owner("pending");
        let pending = request(&owner, "installation_1234");
        assert_eq!(
            owner.pending().expect("pending approval").request_id,
            pending.request_id
        );
        let second_hello = owner
            .hello(PRODUCTION_EXTENSION_ORIGIN, 3031)
            .expect("second hello");
        assert!(matches!(
            owner.request_pairing(
                PRODUCTION_EXTENSION_ORIGIN,
                &second_hello.nonce,
                "installation_5678",
                "extension_nonce_5678",
            ),
            Err(CompanionPairingError::Busy)
        ));
        assert!(matches!(
            owner.poll(
                BETA_EXTENSION_ORIGIN,
                &pending.request_id,
                "installation_wrong",
                "extension_nonce_1234",
            ),
            Err(CompanionPairingError::NotFound)
        ));
        owner.reject(&pending.request_id).expect("reject pairing");
        assert_eq!(
            owner
                .poll(
                    BETA_EXTENSION_ORIGIN,
                    &pending.request_id,
                    "installation_1234",
                    "extension_nonce_1234",
                )
                .expect("poll rejection")
                .status,
            CompanionPairingPollStatus::Rejected
        );
        drop(owner);
        fs::remove_dir_all(root).expect("remove pairing fixture");
    }

    #[tokio::test]
    async fn platform_root_requests_are_single_exact_and_cancellable() {
        let platform = CompanionPlatformOwner::new();
        let request_owner = platform.clone();
        let revocation = CancellationToken::new();
        let request = tokio::spawn(async move {
            request_owner
                .request(Some("root_a".to_owned()), revocation)
                .await
        });
        let pending = platform.next_request().await.expect("pending root request");
        assert_eq!(pending.repair_root.as_deref(), Some("root_a"));
        assert!(pending.expires_in_seconds <= 120);
        assert!(matches!(
            platform.request(None, CancellationToken::new()).await,
            Err(CompanionPlatformError::Busy)
        ));
        let expected = StorageRootSnapshot {
            root_id: "root_a".to_owned(),
            label: "Repaired A".to_owned(),
            display_path: None,
            availability: rstorrent_session::StorageRootAvailability::Available,
        };
        assert!(platform.complete(&pending.request_id, Some(expected.clone())));
        assert_eq!(
            request
                .await
                .expect("join root request")
                .expect("root response"),
            Some(expected)
        );

        let cancelled_owner = platform.clone();
        let cancelled_token = CancellationToken::new();
        let task_token = cancelled_token.clone();
        let cancelled =
            tokio::spawn(async move { cancelled_owner.request(None, task_token).await });
        let _ = platform.next_request().await.expect("cancellable request");
        cancelled_token.cancel();
        assert!(matches!(
            cancelled.await.expect("join cancelled request"),
            Err(CompanionPlatformError::Revoked)
        ));

        let removal_request = rstorrent_session::RequestEnvelope {
            version: rstorrent_session::CONTROL_VERSION,
            request_id: "extension-remove-root-a".to_owned(),
            expected_revision: Some("7".to_owned()),
            command: rstorrent_session::Command::RemoveStorageRoot {
                storage_root: "root_a".to_owned(),
            },
        };
        let removal_owner = platform.clone();
        let expected_request = removal_request.clone();
        let removal = tokio::spawn(async move {
            removal_owner
                .request_removal(removal_request, CancellationToken::new())
                .await
        });
        let pending = platform
            .next_removal_request()
            .await
            .expect("pending removal request");
        assert_eq!(pending.application_request, expected_request);
        let response = rstorrent_session::ResponseEnvelope::error(
            "extension-remove-root-a".to_owned(),
            7,
            rstorrent_session::ErrorCode::StorageRootInUse,
            "root is referenced",
        );
        assert!(platform.complete_removal(&pending.request_id, response.clone()));
        assert_eq!(
            removal
                .await
                .expect("join removal")
                .expect("removal response"),
            response
        );
    }
}
