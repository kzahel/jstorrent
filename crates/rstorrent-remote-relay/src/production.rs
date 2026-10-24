use std::collections::BTreeMap;
use std::fmt;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::connect_info::Connected;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::Engine as _;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq as _;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, oneshot};
use tokio::task::JoinSet;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::{
    MAX_ACTIVE_CIRCUITS, MAX_CIRCUIT_LIFETIME, MAX_REGISTERED_ROUTES, MAX_RELAY_MESSAGE_BYTES,
    MAX_USERNAME_BYTES, MIN_USERNAME_BYTES, PAIRED_CONTROL, PREAUTH_MESSAGE_BYTES,
    WAITING_HOST_TIMEOUT,
};

pub const HOST_CHALLENGE_MAGIC: &[u8; 4] = b"RHC1";
pub const HOST_PROOF_MAGIC: &[u8; 4] = b"RHC2";
pub const RELEASE_COMPLETE_MAGIC: &[u8; 4] = b"RMR1";

const STATE_VERSION: u16 = 1;
const STATE_FILE: &str = "relay-state-v1.json";
const MAX_STATE_BYTES: usize = 512 * 1024;
const PUBLIC_KEY_BYTES: usize = 65;
const SIGNATURE_BYTES: usize = 64;
const CHALLENGE_BYTES: usize = 32;
const HOST_TRANSCRIPT_DOMAIN: &[u8] = b"rstorrent.remote.relay.host-claim.v1";
const RELEASE_TRANSCRIPT_DOMAIN: &[u8] = b"rstorrent.remote.relay.release.v1";
const CLOSE_UNAVAILABLE: u16 = 4_004;
const CLOSE_CLAIM_REJECTED: u16 = 4_003;
const RATE_ENTRY_LIFETIME: Duration = Duration::from_secs(10 * 60);
const MAX_RATE_SOURCES: usize = 1_024;
const MAX_RATE_ROUTES: usize = 2_048;
const MAX_CERTIFICATE_BYTES: usize = 64 * 1024;
const MAX_PRIVATE_KEY_BYTES: usize = 16 * 1024;
const MAX_PENDING_TLS_HANDSHAKES: usize = 64;
const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const FORWARDED_SOURCE_HEADER: &str = "x-rstorrent-client-ip";
const MIN_OPERATOR_TOKEN_BYTES: usize = 32;
const MAX_OPERATOR_TOKEN_BYTES: usize = 256;

#[derive(Clone, Eq, PartialEq)]
pub struct ProductRelayOptions {
    allowed_client_origins: Vec<String>,
    trusted_proxy: Option<IpAddr>,
    operator_token: Option<Zeroizing<String>>,
}

impl fmt::Debug for ProductRelayOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProductRelayOptions")
            .field("allowed_client_origins", &self.allowed_client_origins)
            .field("trusted_proxy", &self.trusted_proxy)
            .field(
                "operator_token",
                &self.operator_token.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

impl ProductRelayOptions {
    pub fn validation(allowed_client_origin: impl Into<String>) -> Self {
        Self {
            allowed_client_origins: vec![allowed_client_origin.into()],
            trusted_proxy: None,
            operator_token: None,
        }
    }

    pub fn production(
        trusted_proxy: IpAddr,
        operator_token: String,
    ) -> Result<Self, ProductRelayError> {
        Self::production_with_origins(
            trusted_proxy,
            operator_token,
            vec!["https://jstorrent.com".to_owned()],
        )
    }

    pub fn production_with_origins(
        trusted_proxy: IpAddr,
        operator_token: String,
        origins: Vec<String>,
    ) -> Result<Self, ProductRelayError> {
        if origins.is_empty()
            || origins.len() > 2
            || origins.iter().any(|origin| {
                !matches!(
                    origin.as_str(),
                    "https://jstorrent.com" | "https://remote.jstorrent.com"
                )
            })
            || (origins.len() == 2 && origins[0] == origins[1])
        {
            return Err(ProductRelayError::Configuration(
                "production client origins",
            ));
        }
        let trusted_proxy = normalize_ip(trusted_proxy);
        if !trusted_proxy.is_loopback() {
            return Err(ProductRelayError::Configuration(
                "trusted proxy must be loopback",
            ));
        }
        validate_operator_token(&operator_token)?;
        Ok(Self {
            allowed_client_origins: origins,
            trusted_proxy: Some(trusted_proxy),
            operator_token: Some(Zeroizing::new(operator_token)),
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReserveRouteRequest {
    pub username: String,
    pub public_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReserveRouteResponse {
    pub relay_id: String,
    pub reserved: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ProductRelayMetricsSnapshot {
    pub registered_routes: usize,
    pub registered_routes_high_water: usize,
    pub waiting_hosts: usize,
    pub waiting_hosts_high_water: usize,
    pub active_circuits: usize,
    pub active_circuits_high_water: usize,
    pub reservations: u64,
    pub idempotent_reservations: u64,
    pub released_routes: u64,
    pub accepted_host_claims: u64,
    pub rejected_host_claims: u64,
    pub host_replacements: u64,
    pub unavailable_clients: u64,
    pub busy_clients: u64,
    pub rate_limited: u64,
    pub paired_circuits: u64,
    pub completed_circuits: u64,
    pub forwarded_client_messages: u64,
    pub forwarded_client_bytes: u64,
    pub forwarded_host_messages: u64,
    pub forwarded_host_bytes: u64,
    pub forwarded_message_bytes_high_water: usize,
    pub active_pumps: usize,
    pub active_pumps_high_water: usize,
    pub pending_tls_handshakes: usize,
    pub pending_tls_handshakes_high_water: usize,
    pub rejected_tls_handshakes: u64,
    pub tcp_accept_failures: u64,
}

#[derive(Default)]
struct ProductRelayMetrics {
    registered_routes: AtomicUsize,
    registered_routes_high_water: AtomicUsize,
    waiting_hosts: AtomicUsize,
    waiting_hosts_high_water: AtomicUsize,
    active_circuits: AtomicUsize,
    active_circuits_high_water: AtomicUsize,
    reservations: AtomicU64,
    idempotent_reservations: AtomicU64,
    released_routes: AtomicU64,
    accepted_host_claims: AtomicU64,
    rejected_host_claims: AtomicU64,
    host_replacements: AtomicU64,
    unavailable_clients: AtomicU64,
    busy_clients: AtomicU64,
    rate_limited: AtomicU64,
    paired_circuits: AtomicU64,
    completed_circuits: AtomicU64,
    forwarded_client_messages: AtomicU64,
    forwarded_client_bytes: AtomicU64,
    forwarded_host_messages: AtomicU64,
    forwarded_host_bytes: AtomicU64,
    forwarded_message_bytes_high_water: AtomicUsize,
    active_pumps: AtomicUsize,
    active_pumps_high_water: AtomicUsize,
    pending_tls_handshakes: AtomicUsize,
    pending_tls_handshakes_high_water: AtomicUsize,
    rejected_tls_handshakes: AtomicU64,
    tcp_accept_failures: AtomicU64,
}

impl ProductRelayMetrics {
    fn snapshot(&self) -> ProductRelayMetricsSnapshot {
        ProductRelayMetricsSnapshot {
            registered_routes: self.registered_routes.load(Ordering::Relaxed),
            registered_routes_high_water: self.registered_routes_high_water.load(Ordering::Relaxed),
            waiting_hosts: self.waiting_hosts.load(Ordering::Relaxed),
            waiting_hosts_high_water: self.waiting_hosts_high_water.load(Ordering::Relaxed),
            active_circuits: self.active_circuits.load(Ordering::Relaxed),
            active_circuits_high_water: self.active_circuits_high_water.load(Ordering::Relaxed),
            reservations: self.reservations.load(Ordering::Relaxed),
            idempotent_reservations: self.idempotent_reservations.load(Ordering::Relaxed),
            released_routes: self.released_routes.load(Ordering::Relaxed),
            accepted_host_claims: self.accepted_host_claims.load(Ordering::Relaxed),
            rejected_host_claims: self.rejected_host_claims.load(Ordering::Relaxed),
            host_replacements: self.host_replacements.load(Ordering::Relaxed),
            unavailable_clients: self.unavailable_clients.load(Ordering::Relaxed),
            busy_clients: self.busy_clients.load(Ordering::Relaxed),
            rate_limited: self.rate_limited.load(Ordering::Relaxed),
            paired_circuits: self.paired_circuits.load(Ordering::Relaxed),
            completed_circuits: self.completed_circuits.load(Ordering::Relaxed),
            forwarded_client_messages: self.forwarded_client_messages.load(Ordering::Relaxed),
            forwarded_client_bytes: self.forwarded_client_bytes.load(Ordering::Relaxed),
            forwarded_host_messages: self.forwarded_host_messages.load(Ordering::Relaxed),
            forwarded_host_bytes: self.forwarded_host_bytes.load(Ordering::Relaxed),
            forwarded_message_bytes_high_water: self
                .forwarded_message_bytes_high_water
                .load(Ordering::Relaxed),
            active_pumps: self.active_pumps.load(Ordering::Relaxed),
            active_pumps_high_water: self.active_pumps_high_water.load(Ordering::Relaxed),
            pending_tls_handshakes: self.pending_tls_handshakes.load(Ordering::Relaxed),
            pending_tls_handshakes_high_water: self
                .pending_tls_handshakes_high_water
                .load(Ordering::Relaxed),
            rejected_tls_handshakes: self.rejected_tls_handshakes.load(Ordering::Relaxed),
            tcp_accept_failures: self.tcp_accept_failures.load(Ordering::Relaxed),
        }
    }

    fn registered(&self) {
        let value = self.registered_routes.fetch_add(1, Ordering::Relaxed) + 1;
        self.registered_routes_high_water
            .fetch_max(value, Ordering::Relaxed);
    }

    fn unregistered(&self) {
        self.registered_routes.fetch_sub(1, Ordering::Relaxed);
    }

    fn waiting_started(&self) {
        let value = self.waiting_hosts.fetch_add(1, Ordering::Relaxed) + 1;
        self.waiting_hosts_high_water
            .fetch_max(value, Ordering::Relaxed);
    }

    fn waiting_stopped(&self) {
        self.waiting_hosts.fetch_sub(1, Ordering::Relaxed);
    }

    fn circuit_started(&self) {
        let value = self.active_circuits.fetch_add(1, Ordering::Relaxed) + 1;
        self.active_circuits_high_water
            .fetch_max(value, Ordering::Relaxed);
        self.paired_circuits.fetch_add(1, Ordering::Relaxed);
    }

    fn circuit_stopped(&self) {
        self.active_circuits.fetch_sub(1, Ordering::Relaxed);
        self.completed_circuits.fetch_add(1, Ordering::Relaxed);
    }

    fn pump_started(&self) {
        let value = self.active_pumps.fetch_add(1, Ordering::Relaxed) + 1;
        self.active_pumps_high_water
            .fetch_max(value, Ordering::Relaxed);
    }

    fn pump_stopped(&self) {
        self.active_pumps.fetch_sub(1, Ordering::Relaxed);
    }

    fn tls_handshake_started(&self) {
        let value = self.pending_tls_handshakes.fetch_add(1, Ordering::Relaxed) + 1;
        self.pending_tls_handshakes_high_water
            .fetch_max(value, Ordering::Relaxed);
    }

    fn tls_handshake_stopped(&self) {
        self.pending_tls_handshakes.fetch_sub(1, Ordering::Relaxed);
    }

    fn forwarded(&self, direction: Direction, bytes: usize) {
        match direction {
            Direction::ClientToHost => {
                self.forwarded_client_messages
                    .fetch_add(1, Ordering::Relaxed);
                self.forwarded_client_bytes
                    .fetch_add(bytes as u64, Ordering::Relaxed);
            }
            Direction::HostToClient => {
                self.forwarded_host_messages.fetch_add(1, Ordering::Relaxed);
                self.forwarded_host_bytes
                    .fetch_add(bytes as u64, Ordering::Relaxed);
            }
        }
        self.forwarded_message_bytes_high_water
            .fetch_max(bytes, Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct ProductRelay {
    inner: Arc<ProductRelayInner>,
}

impl fmt::Debug for ProductRelay {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProductRelay")
            .field("deployment_id", &encode(&self.inner.deployment_id))
            .finish_non_exhaustive()
    }
}

struct ProductRelayInner {
    deployment_id: [u8; 32],
    allowed_client_origins: Vec<String>,
    trusted_proxy: Option<IpAddr>,
    operator_token: Option<Zeroizing<String>>,
    admission_enabled: AtomicBool,
    store: RelayStore,
    routes: Mutex<BTreeMap<String, ProductRoute>>,
    next_generation: AtomicU64,
    circuit_slots: Arc<Semaphore>,
    admission: Mutex<AdmissionState>,
    metrics: ProductRelayMetrics,
    shutdown: CancellationToken,
}

struct ProductRoute {
    public_key: [u8; PUBLIC_KEY_BYTES],
    waiting: Option<WaitingHost>,
    active_generation: Option<u64>,
}

struct WaitingHost {
    generation: u64,
    client: oneshot::Sender<PairedClient>,
    cancellation: CancellationToken,
}

struct PairedClient {
    socket: WebSocket,
    _slot: OwnedSemaphorePermit,
}

#[derive(Clone, Copy)]
struct TokenBucket {
    tokens: f64,
    capacity: f64,
    refill_per_second: f64,
    updated: Instant,
}

impl TokenBucket {
    fn new(capacity: u32, refill_per_second: u32, now: Instant) -> Self {
        Self {
            tokens: f64::from(capacity),
            capacity: f64::from(capacity),
            refill_per_second: f64::from(refill_per_second),
            updated: now,
        }
    }

    fn take(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.updated).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_second).min(self.capacity);
        self.updated = now;
        if self.tokens < 1.0 {
            false
        } else {
            self.tokens -= 1.0;
            true
        }
    }
}

struct RateEntry {
    bucket: TokenBucket,
    last_seen: Instant,
}

struct AdmissionState {
    aggregate: TokenBucket,
    sources: BTreeMap<IpAddr, RateEntry>,
    routes: BTreeMap<String, RateEntry>,
}

impl AdmissionState {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            aggregate: TokenBucket::new(512, 128, now),
            sources: BTreeMap::new(),
            routes: BTreeMap::new(),
        }
    }

    fn admit(&mut self, source: IpAddr, route: Option<&str>, now: Instant) -> bool {
        self.prune(now);
        if !self.aggregate.take(now) {
            return false;
        }
        if !self.sources.contains_key(&source) && self.sources.len() >= MAX_RATE_SOURCES {
            return false;
        }
        let source_entry = self.sources.entry(source).or_insert(RateEntry {
            bucket: TokenBucket::new(32, 8, now),
            last_seen: now,
        });
        source_entry.last_seen = now;
        if !source_entry.bucket.take(now) {
            return false;
        }
        let Some(route) = route else {
            return true;
        };
        if !self.routes.contains_key(route) && self.routes.len() >= MAX_RATE_ROUTES {
            return false;
        }
        let route_entry = self.routes.entry(route.to_owned()).or_insert(RateEntry {
            bucket: TokenBucket::new(64, 16, now),
            last_seen: now,
        });
        route_entry.last_seen = now;
        route_entry.bucket.take(now)
    }

    fn prune(&mut self, now: Instant) {
        self.sources.retain(|_, entry| {
            now.saturating_duration_since(entry.last_seen) <= RATE_ENTRY_LIFETIME
        });
        self.routes.retain(|_, entry| {
            now.saturating_duration_since(entry.last_seen) <= RATE_ENTRY_LIFETIME
        });
    }
}

impl ProductRelay {
    pub fn open(
        root: impl Into<PathBuf>,
        allowed_client_origin: impl Into<String>,
    ) -> Result<Self, ProductRelayError> {
        Self::open_with_options(root, ProductRelayOptions::validation(allowed_client_origin))
    }

    pub fn open_with_options(
        root: impl Into<PathBuf>,
        options: ProductRelayOptions,
    ) -> Result<Self, ProductRelayError> {
        for origin in &options.allowed_client_origins {
            validate_origin(origin)?;
        }
        let store = RelayStore::new(root.into());
        let persisted = store.load_or_create()?;
        let mut routes = BTreeMap::new();
        for reservation in persisted.reservations {
            routes.insert(
                reservation.username,
                ProductRoute {
                    public_key: reservation.public_key,
                    waiting: None,
                    active_generation: None,
                },
            );
        }
        let metrics = ProductRelayMetrics::default();
        metrics
            .registered_routes
            .store(routes.len(), Ordering::Relaxed);
        metrics
            .registered_routes_high_water
            .store(routes.len(), Ordering::Relaxed);
        Ok(Self {
            inner: Arc::new(ProductRelayInner {
                deployment_id: persisted.deployment_id,
                allowed_client_origins: options.allowed_client_origins,
                trusted_proxy: options.trusted_proxy,
                operator_token: options.operator_token,
                admission_enabled: AtomicBool::new(true),
                store,
                routes: Mutex::new(routes),
                next_generation: AtomicU64::new(1),
                circuit_slots: Arc::new(Semaphore::new(MAX_ACTIVE_CIRCUITS)),
                admission: Mutex::new(AdmissionState::new()),
                metrics,
                shutdown: CancellationToken::new(),
            }),
        })
    }

    pub fn deployment_id(&self) -> [u8; 32] {
        self.inner.deployment_id
    }

    pub fn metrics(&self) -> ProductRelayMetricsSnapshot {
        self.inner.metrics.snapshot()
    }

    pub fn shutdown(&self) {
        self.inner.shutdown.cancel();
    }

    pub fn router(&self) -> Router {
        Router::new()
            .route("/healthz", get(health))
            .route("/v1/reservations", post(reserve_route))
            .route("/v1/release/{username}", get(release_upgrade))
            .route("/host/{username}", get(host_upgrade))
            .route("/client", get(client_upgrade))
            .route("/operator/v1/status", get(operator_status))
            .route("/operator/v1/admission", put(set_operator_admission))
            .layer(DefaultBodyLimit::max(PREAUTH_MESSAGE_BYTES))
            .with_state(self.inner.clone())
    }
}

pub struct ProductRelayServer {
    listener: TcpListener,
    address: SocketAddr,
    relay: ProductRelay,
}

impl ProductRelayServer {
    pub async fn bind_loopback(
        root: impl Into<PathBuf>,
        allowed_client_origin: impl Into<String>,
    ) -> Result<Self, ProductRelayError> {
        Self::bind(
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            root,
            allowed_client_origin,
        )
        .await
    }

    pub async fn bind(
        address: SocketAddr,
        root: impl Into<PathBuf>,
        allowed_client_origin: impl Into<String>,
    ) -> Result<Self, ProductRelayError> {
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "product relay address must be loopback",
            ));
        }
        let relay = ProductRelay::open(root, allowed_client_origin)?;
        Self::bind_relay(address, relay).await
    }

    pub async fn bind_with_options(
        address: SocketAddr,
        root: impl Into<PathBuf>,
        options: ProductRelayOptions,
    ) -> Result<Self, ProductRelayError> {
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "product relay address must be loopback",
            ));
        }
        let relay = ProductRelay::open_with_options(root, options)?;
        Self::bind_relay(address, relay).await
    }

    async fn bind_relay(
        address: SocketAddr,
        relay: ProductRelay,
    ) -> Result<Self, ProductRelayError> {
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "resolved product relay address must be loopback",
            ));
        }
        Ok(Self {
            listener,
            address,
            relay,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    pub fn relay(&self) -> ProductRelay {
        self.relay.clone()
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let shutdown = self.relay.inner.shutdown.clone();
        axum::serve(
            self.listener,
            self.relay
                .router()
                .into_make_service_with_connect_info::<RelayConnectInfo>(),
        )
        .with_graceful_shutdown(shutdown.cancelled_owned())
        .await
    }
}

/// TLS-only loopback service used by the Tactical 192 local runner.
///
/// The caller supplies a leaf certificate in DER form and its PKCS#8 private
/// key in DER form. The service reads but never creates or installs a local
/// trust authority.
pub struct TlsProductRelayServer {
    listener: TlsListener,
    address: SocketAddr,
    relay: ProductRelay,
}

impl TlsProductRelayServer {
    pub async fn bind(
        address: SocketAddr,
        root: impl Into<PathBuf>,
        allowed_client_origin: impl Into<String>,
        certificate_der: impl AsRef<Path>,
        private_key_der: impl AsRef<Path>,
    ) -> Result<Self, ProductRelayError> {
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "TLS relay address must be loopback",
            ));
        }
        let certificate_der = certificate_der.as_ref();
        let private_key_der = private_key_der.as_ref();
        if !certificate_der.is_absolute() || !private_key_der.is_absolute() {
            return Err(ProductRelayError::Configuration(
                "TLS certificate and key paths must be absolute",
            ));
        }
        let certificate = read_public_file(certificate_der, MAX_CERTIFICATE_BYTES)?;
        let private_key = read_private_file(private_key_der, MAX_PRIVATE_KEY_BYTES)?;
        let mut configuration = ServerConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_protocol_versions(&[&tokio_rustls::rustls::version::TLS13])
        .map_err(|_| ProductRelayError::Configuration("TLS protocol versions"))?
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate)],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(private_key)),
        )
        .map_err(|_| ProductRelayError::Configuration("TLS certificate or private key"))?;
        configuration.alpn_protocols = vec![b"http/1.1".to_vec()];

        let relay = ProductRelay::open(root, allowed_client_origin)?;
        Self::bind_relay(address, relay, configuration).await
    }

    pub async fn bind_with_options(
        address: SocketAddr,
        root: impl Into<PathBuf>,
        options: ProductRelayOptions,
        certificate_der: impl AsRef<Path>,
        private_key_der: impl AsRef<Path>,
    ) -> Result<Self, ProductRelayError> {
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "TLS relay address must be loopback",
            ));
        }
        let certificate_der = certificate_der.as_ref();
        let private_key_der = private_key_der.as_ref();
        if !certificate_der.is_absolute() || !private_key_der.is_absolute() {
            return Err(ProductRelayError::Configuration(
                "TLS certificate and key paths must be absolute",
            ));
        }
        let certificate = read_public_file(certificate_der, MAX_CERTIFICATE_BYTES)?;
        let private_key = read_private_file(private_key_der, MAX_PRIVATE_KEY_BYTES)?;
        let mut configuration = ServerConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_protocol_versions(&[&tokio_rustls::rustls::version::TLS13])
        .map_err(|_| ProductRelayError::Configuration("TLS protocol versions"))?
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate)],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(private_key)),
        )
        .map_err(|_| ProductRelayError::Configuration("TLS certificate or private key"))?;
        configuration.alpn_protocols = vec![b"http/1.1".to_vec()];
        let relay = ProductRelay::open_with_options(root, options)?;
        Self::bind_relay(address, relay, configuration).await
    }

    async fn bind_relay(
        address: SocketAddr,
        relay: ProductRelay,
        configuration: ServerConfig,
    ) -> Result<Self, ProductRelayError> {
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        if !address.ip().is_loopback() {
            return Err(ProductRelayError::Configuration(
                "resolved TLS relay address must be loopback",
            ));
        }
        Ok(Self {
            listener: TlsListener::new(
                listener,
                TlsAcceptor::from(Arc::new(configuration)),
                relay.inner.clone(),
            ),
            address,
            relay,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    pub fn relay(&self) -> ProductRelay {
        self.relay.clone()
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let shutdown = self.relay.inner.shutdown.clone();
        axum::serve(
            self.listener,
            self.relay
                .router()
                .into_make_service_with_connect_info::<RelayConnectInfo>(),
        )
        .with_graceful_shutdown(shutdown.cancelled_owned())
        .await
    }
}

struct TlsListener {
    listener: TcpListener,
    acceptor: TlsAcceptor,
    pending: JoinSet<
        Option<(
            tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
            SocketAddr,
        )>,
    >,
    relay: Arc<ProductRelayInner>,
}

#[derive(Clone, Copy, Debug)]
struct RelayConnectInfo(SocketAddr);

impl Connected<axum::serve::IncomingStream<'_, TcpListener>> for RelayConnectInfo {
    fn connect_info(stream: axum::serve::IncomingStream<'_, TcpListener>) -> Self {
        Self(*stream.remote_addr())
    }
}

impl Connected<axum::serve::IncomingStream<'_, TlsListener>> for RelayConnectInfo {
    fn connect_info(stream: axum::serve::IncomingStream<'_, TlsListener>) -> Self {
        Self(*stream.remote_addr())
    }
}

impl TlsListener {
    fn new(listener: TcpListener, acceptor: TlsAcceptor, relay: Arc<ProductRelayInner>) -> Self {
        Self {
            listener,
            acceptor,
            pending: JoinSet::new(),
            relay,
        }
    }

    fn start_handshake(&mut self, stream: tokio::net::TcpStream, address: SocketAddr) {
        let acceptor = self.acceptor.clone();
        let relay = self.relay.clone();
        relay.metrics.tls_handshake_started();
        self.pending.spawn(async move {
            let _pending = PendingTlsHandshake(relay.clone());
            match tokio::time::timeout(TLS_HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await {
                Ok(Ok(stream)) => Some((stream, address)),
                Ok(Err(_)) | Err(_) => {
                    relay
                        .metrics
                        .rejected_tls_handshakes
                        .fetch_add(1, Ordering::Relaxed);
                    None
                }
            }
        });
    }

    async fn completed_handshake(
        &mut self,
    ) -> Option<(
        tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
        SocketAddr,
    )> {
        match self.pending.join_next().await {
            Some(Ok(connection)) => connection,
            Some(Err(_)) => {
                self.relay
                    .metrics
                    .rejected_tls_handshakes
                    .fetch_add(1, Ordering::Relaxed);
                None
            }
            None => None,
        }
    }
}

struct PendingTlsHandshake(Arc<ProductRelayInner>);

impl Drop for PendingTlsHandshake {
    fn drop(&mut self) {
        self.0.metrics.tls_handshake_stopped();
    }
}

impl axum::serve::Listener for TlsListener {
    type Io = tokio_rustls::server::TlsStream<tokio::net::TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            if self.pending.len() >= MAX_PENDING_TLS_HANDSHAKES {
                if let Some(connection) = self.completed_handshake().await {
                    return connection;
                }
                continue;
            }
            if self.pending.is_empty() {
                match self.listener.accept().await {
                    Ok((stream, address)) => self.start_handshake(stream, address),
                    Err(_) => {
                        self.relay
                            .metrics
                            .tcp_accept_failures
                            .fetch_add(1, Ordering::Relaxed);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
                continue;
            }
            tokio::select! {
                accepted = self.listener.accept() => match accepted {
                    Ok((stream, address)) => self.start_handshake(stream, address),
                    Err(_) => {
                        self.relay.metrics.tcp_accept_failures.fetch_add(1, Ordering::Relaxed);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                },
                joined = self.pending.join_next() => {
                    match joined {
                        Some(Ok(Some(connection))) => return connection,
                        Some(Ok(None)) | None => {}
                        Some(Err(_)) => {
                            self.relay.metrics.rejected_tls_handshakes.fetch_add(
                                1,
                                Ordering::Relaxed,
                            );
                        }
                    }
                }
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

#[derive(Debug)]
pub enum ProductRelayError {
    Configuration(&'static str),
    Corrupt(&'static str),
    Io(std::io::Error),
}

impl fmt::Display for ProductRelayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => write!(formatter, "relay configuration: {message}"),
            Self::Corrupt(message) => write!(formatter, "relay state is invalid: {message}"),
            Self::Io(error) => write!(formatter, "relay persistence: {error}"),
        }
    }
}

impl std::error::Error for ProductRelayError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for ProductRelayError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn host_claim_transcript(
    relay_id: [u8; 32],
    username: &str,
    challenge: [u8; CHALLENGE_BYTES],
    release: bool,
) -> Result<Vec<u8>, ProductRelayError> {
    validate_username(username)?;
    let domain = if release {
        RELEASE_TRANSCRIPT_DOMAIN
    } else {
        HOST_TRANSCRIPT_DOMAIN
    };
    let mut transcript = Vec::with_capacity(128);
    append_field(&mut transcript, domain);
    append_field(&mut transcript, &relay_id);
    append_field(&mut transcript, username.as_bytes());
    append_field(&mut transcript, &challenge);
    Ok(transcript)
}

pub fn encode_host_proof(signature: &[u8]) -> Result<Vec<u8>, ProductRelayError> {
    let signature: [u8; SIGNATURE_BYTES] = signature
        .try_into()
        .map_err(|_| ProductRelayError::Configuration("host proof signature length"))?;
    Signature::from_slice(&signature)
        .map_err(|_| ProductRelayError::Configuration("host proof signature"))?;
    let mut message = Vec::with_capacity(4 + SIGNATURE_BYTES);
    message.extend_from_slice(HOST_PROOF_MAGIC);
    message.extend_from_slice(&signature);
    Ok(message)
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct OperatorStatusResponse {
    status: &'static str,
    accepting: bool,
    metrics: ProductRelayMetricsSnapshot,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperatorAdmissionRequest {
    accepting: bool,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn operator_status(
    State(relay): State<Arc<ProductRelayInner>>,
    headers: HeaderMap,
) -> Response {
    if !operator_authorized(&relay, &headers) {
        return generic_http_failure();
    }
    Json(OperatorStatusResponse {
        status: "ok",
        accepting: relay.admission_enabled.load(Ordering::Acquire),
        metrics: relay.metrics.snapshot(),
    })
    .into_response()
}

async fn set_operator_admission(
    State(relay): State<Arc<ProductRelayInner>>,
    headers: HeaderMap,
    Json(request): Json<OperatorAdmissionRequest>,
) -> Response {
    if !operator_authorized(&relay, &headers) {
        return generic_http_failure();
    }
    relay
        .admission_enabled
        .store(request.accepting, Ordering::Release);
    if !request.accepting {
        let mut routes = relay.routes.lock().await;
        for route in routes.values_mut() {
            if let Some(waiting) = route.waiting.take() {
                waiting.cancellation.cancel();
                relay.metrics.waiting_stopped();
            }
        }
    }
    Json(OperatorStatusResponse {
        status: "ok",
        accepting: request.accepting,
        metrics: relay.metrics.snapshot(),
    })
    .into_response()
}

async fn reserve_route(
    State(relay): State<Arc<ProductRelayInner>>,
    ConnectInfo(source): ConnectInfo<RelayConnectInfo>,
    headers: HeaderMap,
    encoded: Bytes,
) -> Response {
    let Ok(request) = serde_json::from_slice::<ReserveRouteRequest>(&encoded) else {
        return generic_http_failure();
    };
    let Some(source) = public_source(&relay, source.0, &headers) else {
        return generic_http_failure();
    };
    if validate_username(&request.username).is_err()
        || !admit(&relay, source, Some(&request.username)).await
    {
        return generic_http_failure();
    }
    let Ok(public_key) = decode_public_key(&request.public_key) else {
        return generic_http_failure();
    };
    let mut routes = relay.routes.lock().await;
    if let Some(route) = routes.get(&request.username) {
        if route.public_key == public_key {
            relay
                .metrics
                .idempotent_reservations
                .fetch_add(1, Ordering::Relaxed);
            return (
                StatusCode::OK,
                Json(ReserveRouteResponse {
                    relay_id: encode(&relay.deployment_id),
                    reserved: true,
                }),
            )
                .into_response();
        }
        return generic_http_failure();
    }
    if routes.len() >= MAX_REGISTERED_ROUTES {
        return generic_http_failure();
    }
    let mut reservations = reservations(&routes);
    reservations.push(PersistedReservation {
        username: request.username.clone(),
        public_key,
    });
    if relay
        .store
        .save(relay.deployment_id, &reservations)
        .is_err()
    {
        return generic_http_failure();
    }
    routes.insert(
        request.username,
        ProductRoute {
            public_key,
            waiting: None,
            active_generation: None,
        },
    );
    relay.metrics.registered();
    relay.metrics.reservations.fetch_add(1, Ordering::Relaxed);
    (
        StatusCode::CREATED,
        Json(ReserveRouteResponse {
            relay_id: encode(&relay.deployment_id),
            reserved: true,
        }),
    )
        .into_response()
}

async fn host_upgrade(
    State(relay): State<Arc<ProductRelayInner>>,
    ConnectInfo(source): ConnectInfo<RelayConnectInfo>,
    AxumPath(username): AxumPath<String>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    let Some(source) = public_source(&relay, source.0, &headers) else {
        return generic_http_failure();
    };
    if validate_username(&username).is_err() || !admit(&relay, source, Some(&username)).await {
        return generic_http_failure();
    }
    websocket
        .max_message_size(MAX_RELAY_MESSAGE_BYTES)
        .max_frame_size(MAX_RELAY_MESSAGE_BYTES)
        .on_upgrade(move |socket| host_connection(relay, username, socket))
        .into_response()
}

async fn release_upgrade(
    State(relay): State<Arc<ProductRelayInner>>,
    ConnectInfo(source): ConnectInfo<RelayConnectInfo>,
    AxumPath(username): AxumPath<String>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    let Some(source) = public_source(&relay, source.0, &headers) else {
        return generic_http_failure();
    };
    if validate_username(&username).is_err() || !admit(&relay, source, Some(&username)).await {
        return generic_http_failure();
    }
    websocket
        .max_message_size(PREAUTH_MESSAGE_BYTES)
        .max_frame_size(PREAUTH_MESSAGE_BYTES)
        .on_upgrade(move |socket| release_connection(relay, username, socket))
        .into_response()
}

async fn client_upgrade(
    State(relay): State<Arc<ProductRelayInner>>,
    ConnectInfo(source): ConnectInfo<RelayConnectInfo>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    let Some(source) = public_source(&relay, source.0, &headers) else {
        return generic_http_failure();
    };
    if headers.get_all("origin").iter().count() != 1
        || !headers
            .get("origin")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|origin| {
                relay
                    .allowed_client_origins
                    .iter()
                    .any(|allowed| allowed == origin)
            })
        || !admit(&relay, source, None).await
    {
        return generic_http_failure();
    }
    websocket
        .max_message_size(MAX_RELAY_MESSAGE_BYTES)
        .max_frame_size(MAX_RELAY_MESSAGE_BYTES)
        .on_upgrade(move |socket| client_connection(relay, socket))
        .into_response()
}

async fn host_connection(relay: Arc<ProductRelayInner>, username: String, mut socket: WebSocket) {
    let public_key = {
        let routes = relay.routes.lock().await;
        routes.get(&username).map(|route| route.public_key)
    };
    let challenge = match random_array() {
        Ok(challenge) => challenge,
        Err(_) => {
            reject_claim(&relay, &mut socket).await;
            return;
        }
    };
    if send_challenge(&relay, &mut socket, challenge)
        .await
        .is_err()
        || verify_proof(&relay, &username, public_key, challenge, false, &mut socket)
            .await
            .is_err()
    {
        reject_claim(&relay, &mut socket).await;
        return;
    }
    let generation = relay.next_generation.fetch_add(1, Ordering::Relaxed);
    let (client_sender, mut client_receiver) = oneshot::channel();
    let cancellation = CancellationToken::new();
    let installed = {
        let mut routes = relay.routes.lock().await;
        if let Some(route) = routes.get_mut(&username)
            && route.active_generation.is_none()
            && Some(route.public_key) == public_key
        {
            if let Some(previous) = route.waiting.take() {
                previous.cancellation.cancel();
                relay.metrics.waiting_stopped();
                relay
                    .metrics
                    .host_replacements
                    .fetch_add(1, Ordering::Relaxed);
            }
            route.waiting = Some(WaitingHost {
                generation,
                client: client_sender,
                cancellation: cancellation.clone(),
            });
            relay.metrics.waiting_started();
            true
        } else {
            false
        }
    };
    if !installed {
        reject_claim(&relay, &mut socket).await;
        return;
    }
    relay
        .metrics
        .accepted_host_claims
        .fetch_add(1, Ordering::Relaxed);

    let client = tokio::select! {
        client = &mut client_receiver => client.ok(),
        _ = cancellation.cancelled() => None,
        _ = relay.shutdown.cancelled() => None,
        _ = tokio::time::sleep(WAITING_HOST_TIMEOUT) => None,
        incoming = socket.recv() => {
            let _ = incoming;
            None
        }
    };
    let Some(mut client) = client else {
        release_generation(&relay, &username, generation).await;
        close(&mut socket, 1_000, "waiting ended").await;
        return;
    };
    if socket
        .send(Message::Binary(PAIRED_CONTROL.to_vec().into()))
        .await
        .is_err()
        || client
            .socket
            .send(Message::Binary(PAIRED_CONTROL.to_vec().into()))
            .await
            .is_err()
    {
        release_active(&relay, &username, generation).await;
        return;
    }
    let PairedClient {
        socket: client,
        _slot: circuit_slot,
    } = client;
    relay.metrics.circuit_started();
    run_pair(socket, client, relay.clone()).await;
    relay.metrics.circuit_stopped();
    release_active(&relay, &username, generation).await;
    drop(circuit_slot);
}

async fn release_connection(
    relay: Arc<ProductRelayInner>,
    username: String,
    mut socket: WebSocket,
) {
    let public_key = {
        let routes = relay.routes.lock().await;
        routes.get(&username).and_then(|route| {
            (route.waiting.is_none() && route.active_generation.is_none())
                .then_some(route.public_key)
        })
    };
    let challenge = match random_array() {
        Ok(challenge) => challenge,
        Err(_) => {
            reject_claim(&relay, &mut socket).await;
            return;
        }
    };
    if send_challenge(&relay, &mut socket, challenge)
        .await
        .is_err()
        || verify_proof(&relay, &username, public_key, challenge, true, &mut socket)
            .await
            .is_err()
    {
        reject_claim(&relay, &mut socket).await;
        return;
    }
    let mut routes = relay.routes.lock().await;
    if routes.get(&username).is_none_or(|route| {
        route.waiting.is_some()
            || route.active_generation.is_some()
            || Some(route.public_key) != public_key
    }) {
        drop(routes);
        reject_claim(&relay, &mut socket).await;
        return;
    }
    let reservations = reservations(&routes)
        .into_iter()
        .filter(|reservation| reservation.username != username)
        .collect::<Vec<_>>();
    if relay
        .store
        .save(relay.deployment_id, &reservations)
        .is_err()
    {
        drop(routes);
        reject_claim(&relay, &mut socket).await;
        return;
    }
    routes.remove(&username);
    relay.metrics.unregistered();
    relay
        .metrics
        .released_routes
        .fetch_add(1, Ordering::Relaxed);
    drop(routes);
    let _ = socket
        .send(Message::Binary(RELEASE_COMPLETE_MAGIC.to_vec().into()))
        .await;
    let _ = socket.close().await;
}

async fn client_connection(relay: Arc<ProductRelayInner>, mut socket: WebSocket) {
    let Some(select) = receive_initial_binary(&mut socket, &relay.shutdown).await else {
        close(&mut socket, CLOSE_UNAVAILABLE, "unavailable").await;
        return;
    };
    let Ok(username) = parse_client_select(&select) else {
        close(&mut socket, CLOSE_UNAVAILABLE, "unavailable").await;
        return;
    };
    let waiting = {
        let mut routes = relay.routes.lock().await;
        let Some(route) = routes.get_mut(&username) else {
            relay
                .metrics
                .unavailable_clients
                .fetch_add(1, Ordering::Relaxed);
            drop(routes);
            close(&mut socket, CLOSE_UNAVAILABLE, "unavailable").await;
            return;
        };
        if route.active_generation.is_some() {
            relay.metrics.busy_clients.fetch_add(1, Ordering::Relaxed);
            None
        } else if route.waiting.is_some() {
            if let Ok(slot) = relay.circuit_slots.clone().try_acquire_owned() {
                let waiting = route.waiting.take().expect("waiting host checked above");
                relay.metrics.waiting_stopped();
                route.active_generation = Some(waiting.generation);
                Some((waiting, slot))
            } else {
                relay.metrics.busy_clients.fetch_add(1, Ordering::Relaxed);
                None
            }
        } else {
            relay
                .metrics
                .unavailable_clients
                .fetch_add(1, Ordering::Relaxed);
            None
        }
    };
    let Some((waiting, slot)) = waiting else {
        close(&mut socket, CLOSE_UNAVAILABLE, "unavailable").await;
        return;
    };
    let generation = waiting.generation;
    if let Err(mut returned) = waiting.client.send(PairedClient {
        socket,
        _slot: slot,
    }) {
        release_active(&relay, &username, generation).await;
        close(&mut returned.socket, CLOSE_UNAVAILABLE, "unavailable").await;
    }
}

async fn send_challenge(
    relay: &ProductRelayInner,
    socket: &mut WebSocket,
    challenge: [u8; CHALLENGE_BYTES],
) -> Result<(), ()> {
    let mut message = Vec::with_capacity(4 + 32 + CHALLENGE_BYTES);
    message.extend_from_slice(HOST_CHALLENGE_MAGIC);
    message.extend_from_slice(&relay.deployment_id);
    message.extend_from_slice(&challenge);
    socket
        .send(Message::Binary(message.into()))
        .await
        .map_err(|_| ())
}

async fn verify_proof(
    relay: &ProductRelayInner,
    username: &str,
    public_key: Option<[u8; PUBLIC_KEY_BYTES]>,
    challenge: [u8; CHALLENGE_BYTES],
    release: bool,
    socket: &mut WebSocket,
) -> Result<(), ()> {
    let proof = receive_initial_binary(socket, &relay.shutdown)
        .await
        .ok_or(())?;
    let signature = proof.strip_prefix(HOST_PROOF_MAGIC).ok_or(())?;
    let signature = Signature::from_slice(signature).map_err(|_| ())?;
    let key = VerifyingKey::from_sec1_bytes(&public_key.ok_or(())?).map_err(|_| ())?;
    let transcript =
        host_claim_transcript(relay.deployment_id, username, challenge, release).map_err(|_| ())?;
    key.verify(&transcript, &signature).map_err(|_| ())
}

async fn reject_claim(relay: &ProductRelayInner, socket: &mut WebSocket) {
    relay
        .metrics
        .rejected_host_claims
        .fetch_add(1, Ordering::Relaxed);
    close(socket, CLOSE_CLAIM_REJECTED, "claim rejected").await;
}

async fn admit(relay: &ProductRelayInner, source: IpAddr, route: Option<&str>) -> bool {
    let admitted = relay
        .admission
        .lock()
        .await
        .admit(source, route, Instant::now());
    if !admitted {
        relay.metrics.rate_limited.fetch_add(1, Ordering::Relaxed);
    }
    admitted
}

fn public_source(
    relay: &ProductRelayInner,
    immediate: SocketAddr,
    headers: &HeaderMap,
) -> Option<IpAddr> {
    if !relay.admission_enabled.load(Ordering::Acquire) {
        return None;
    }
    derive_source(relay.trusted_proxy, immediate, headers)
}

fn derive_source(
    trusted_proxy: Option<IpAddr>,
    immediate: SocketAddr,
    headers: &HeaderMap,
) -> Option<IpAddr> {
    let immediate = normalize_ip(immediate.ip());
    if trusted_proxy.map(normalize_ip) != Some(immediate) {
        return Some(immediate);
    }
    let mut values = headers.get_all(FORWARDED_SOURCE_HEADER).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    let parsed = normalize_ip(value.parse().ok()?);
    (parsed.to_string() == value).then_some(parsed)
}

fn normalize_ip(source: IpAddr) -> IpAddr {
    match source {
        IpAddr::V6(source) => source
            .to_ipv4_mapped()
            .map_or(IpAddr::V6(source), IpAddr::V4),
        source => source,
    }
}

fn operator_authorized(relay: &ProductRelayInner, headers: &HeaderMap) -> bool {
    let Some(expected) = relay.operator_token.as_ref() else {
        return false;
    };
    let Some(provided) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    provided.len() == expected.len() && bool::from(provided.as_bytes().ct_eq(expected.as_bytes()))
}

fn validate_operator_token(token: &str) -> Result<(), ProductRelayError> {
    if !(MIN_OPERATOR_TOKEN_BYTES..=MAX_OPERATOR_TOKEN_BYTES).contains(&token.len())
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ProductRelayError::Configuration("operator token"));
    }
    Ok(())
}

fn generic_http_failure() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::empty())
        .expect("static generic relay failure")
}

async fn receive_initial_binary(
    socket: &mut WebSocket,
    shutdown: &CancellationToken,
) -> Option<Vec<u8>> {
    let received = tokio::select! {
        _ = shutdown.cancelled() => return None,
        received = tokio::time::timeout(Duration::from_secs(20), socket.recv()) => received,
    };
    match received {
        Ok(Some(Ok(Message::Binary(bytes)))) if bytes.len() <= PREAUTH_MESSAGE_BYTES => {
            Some(bytes.to_vec())
        }
        _ => None,
    }
}

fn parse_client_select(message: &[u8]) -> Result<String, ProductRelayError> {
    if message.len() < 5 || &message[..4] != b"RSC1" {
        return Err(ProductRelayError::Configuration("client selection"));
    }
    let length = usize::from(message[4]);
    if message.len() != 5 + length {
        return Err(ProductRelayError::Configuration("client selection"));
    }
    let username = std::str::from_utf8(&message[5..])
        .map_err(|_| ProductRelayError::Configuration("client selection"))?;
    validate_username(username)?;
    Ok(username.to_owned())
}

async fn release_generation(relay: &ProductRelayInner, username: &str, generation: u64) {
    let mut routes = relay.routes.lock().await;
    let Some(route) = routes.get_mut(username) else {
        return;
    };
    if route
        .waiting
        .as_ref()
        .is_some_and(|waiting| waiting.generation == generation)
    {
        route.waiting = None;
        relay.metrics.waiting_stopped();
    }
    if route.active_generation == Some(generation) {
        route.active_generation = None;
    }
}

async fn release_active(relay: &ProductRelayInner, username: &str, generation: u64) {
    let mut routes = relay.routes.lock().await;
    let Some(route) = routes.get_mut(username) else {
        return;
    };
    if route.active_generation == Some(generation) {
        route.active_generation = None;
    }
}

async fn run_pair(host: WebSocket, client: WebSocket, relay: Arc<ProductRelayInner>) {
    let (host_writer, host_reader) = host.split();
    let (client_writer, client_reader) = client.split();
    let cancellation = CancellationToken::new();
    let mut pumps = JoinSet::new();
    pumps.spawn(run_pump(
        client_reader,
        host_writer,
        Direction::ClientToHost,
        cancellation.clone(),
        relay.clone(),
    ));
    pumps.spawn(run_pump(
        host_reader,
        client_writer,
        Direction::HostToClient,
        cancellation.clone(),
        relay.clone(),
    ));
    let _ = tokio::select! {
        joined = pumps.join_next() => joined,
        _ = relay.shutdown.cancelled() => None,
        _ = tokio::time::sleep(MAX_CIRCUIT_LIFETIME) => None,
    };
    cancellation.cancel();
    while pumps.join_next().await.is_some() {}
}

#[derive(Clone, Copy)]
enum Direction {
    ClientToHost,
    HostToClient,
}

async fn run_pump(
    mut reader: SplitStream<WebSocket>,
    mut writer: SplitSink<WebSocket, Message>,
    direction: Direction,
    cancellation: CancellationToken,
    relay: Arc<ProductRelayInner>,
) {
    relay.metrics.pump_started();
    let lifetime = tokio::time::sleep(MAX_CIRCUIT_LIFETIME);
    tokio::pin!(lifetime);
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = relay.shutdown.cancelled() => break,
            _ = &mut lifetime => break,
            message = reader.next() => {
                let Some(Ok(message)) = message else { break; };
                let bytes = match &message {
                    Message::Binary(bytes) if bytes.len() <= MAX_RELAY_MESSAGE_BYTES => bytes.len(),
                    Message::Ping(bytes) | Message::Pong(bytes)
                        if bytes.len() <= PREAUTH_MESSAGE_BYTES => bytes.len(),
                    Message::Close(_) => {
                        let _ = writer.send(message).await;
                        break;
                    }
                    Message::Text(_) | Message::Binary(_) | Message::Ping(_)
                    | Message::Pong(_) => break,
                };
                relay.metrics.forwarded(direction, bytes);
                if writer.send(message).await.is_err() {
                    break;
                }
            }
        }
    }
    cancellation.cancel();
    let _ = writer.close().await;
    relay.metrics.pump_stopped();
}

async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

fn reservations(routes: &BTreeMap<String, ProductRoute>) -> Vec<PersistedReservation> {
    routes
        .iter()
        .map(|(username, route)| PersistedReservation {
            username: username.clone(),
            public_key: route.public_key,
        })
        .collect()
}

fn validate_username(username: &str) -> Result<(), ProductRelayError> {
    const BLOCKED_LABELS: &[&str] = &[
        "admin",
        "api",
        "client",
        "fuck",
        "host",
        "nazi",
        "operator",
        "relay",
        "remote",
        "root",
        "rstorrent",
        "support",
        "www",
    ];
    let bytes = username.as_bytes();
    if !(MIN_USERNAME_BYTES..=MAX_USERNAME_BYTES).contains(&bytes.len())
        || !bytes
            .first()
            .zip(bytes.last())
            .is_some_and(|(first, last)| {
                first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric()
            })
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        || username
            .split('-')
            .any(|label| BLOCKED_LABELS.binary_search(&label).is_ok())
    {
        return Err(ProductRelayError::Configuration("username"));
    }
    Ok(())
}

fn validate_origin(origin: &str) -> Result<(), ProductRelayError> {
    let url =
        url::Url::parse(origin).map_err(|_| ProductRelayError::Configuration("client origin"))?;
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || url.origin().ascii_serialization() != origin
        || !url.host().is_some_and(|host| match host {
            url::Host::Domain(name) => {
                (matches!(
                    name,
                    "jstorrent.com" | "remote.jstorrent.com" | "rstorrent.com"
                ) && url.port().is_none())
                    || name == "localhost"
            }
            url::Host::Ipv4(address) => address.is_loopback(),
            url::Host::Ipv6(address) => address.is_loopback(),
        })
    {
        return Err(ProductRelayError::Configuration(
            "client origin must be the product or exact loopback HTTPS origin",
        ));
    }
    Ok(())
}

fn decode_public_key(encoded: &str) -> Result<[u8; PUBLIC_KEY_BYTES], ProductRelayError> {
    let bytes: [u8; PUBLIC_KEY_BYTES] = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| ProductRelayError::Configuration("reservation public key"))?
        .try_into()
        .map_err(|_| ProductRelayError::Configuration("reservation public key"))?;
    VerifyingKey::from_sec1_bytes(&bytes)
        .map_err(|_| ProductRelayError::Configuration("reservation public key"))?;
    Ok(bytes)
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn append_field(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&u32::try_from(value.len()).unwrap_or(u32::MAX).to_be_bytes());
    output.extend_from_slice(value);
}

fn random_array() -> Result<[u8; 32], ProductRelayError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| ProductRelayError::Configuration("randomness"))?;
    Ok(bytes)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedRelay {
    version: u16,
    deployment_id: String,
    reservations: Vec<PersistedReservationJson>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedReservationJson {
    username: String,
    public_key: String,
}

struct PersistedState {
    deployment_id: [u8; 32],
    reservations: Vec<PersistedReservation>,
}

#[derive(Clone)]
struct PersistedReservation {
    username: String,
    public_key: [u8; PUBLIC_KEY_BYTES],
}

struct RelayStore {
    root: PathBuf,
    path: PathBuf,
}

impl RelayStore {
    fn new(root: PathBuf) -> Self {
        let path = root.join(STATE_FILE);
        Self { root, path }
    }

    fn load_or_create(&self) -> Result<PersistedState, ProductRelayError> {
        ensure_root(&self.root)?;
        match fs::symlink_metadata(&self.path) {
            Ok(metadata) => {
                validate_file(&metadata)?;
                self.load()
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let state = PersistedState {
                    deployment_id: random_array()?,
                    reservations: Vec::new(),
                };
                self.save(state.deployment_id, &state.reservations)?;
                Ok(state)
            }
            Err(error) => Err(error.into()),
        }
    }

    fn load(&self) -> Result<PersistedState, ProductRelayError> {
        let file = File::open(&self.path)?;
        validate_file(&file.metadata()?)?;
        let mut encoded = Vec::new();
        file.take((MAX_STATE_BYTES + 1) as u64)
            .read_to_end(&mut encoded)?;
        if encoded.len() > MAX_STATE_BYTES {
            return Err(ProductRelayError::Corrupt("state size"));
        }
        let persisted: PersistedRelay = serde_json::from_slice(&encoded)
            .map_err(|_| ProductRelayError::Corrupt("state JSON"))?;
        if persisted.version != STATE_VERSION
            || persisted.reservations.len() > MAX_REGISTERED_ROUTES
        {
            return Err(ProductRelayError::Corrupt("state version or bounds"));
        }
        let deployment_id: [u8; 32] = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(persisted.deployment_id)
            .map_err(|_| ProductRelayError::Corrupt("deployment ID"))?
            .try_into()
            .map_err(|_| ProductRelayError::Corrupt("deployment ID"))?;
        let mut reservations = Vec::with_capacity(persisted.reservations.len());
        let mut previous: Option<String> = None;
        for reservation in persisted.reservations {
            validate_username(&reservation.username)
                .map_err(|_| ProductRelayError::Corrupt("reservation username"))?;
            if previous
                .as_ref()
                .is_some_and(|value| value >= &reservation.username)
            {
                return Err(ProductRelayError::Corrupt("reservation order"));
            }
            let public_key = decode_public_key(&reservation.public_key)
                .map_err(|_| ProductRelayError::Corrupt("reservation public key"))?;
            previous = Some(reservation.username.clone());
            reservations.push(PersistedReservation {
                username: reservation.username,
                public_key,
            });
        }
        Ok(PersistedState {
            deployment_id,
            reservations,
        })
    }

    fn save(
        &self,
        deployment_id: [u8; 32],
        reservations: &[PersistedReservation],
    ) -> Result<(), ProductRelayError> {
        ensure_root(&self.root)?;
        if let Ok(metadata) = fs::symlink_metadata(&self.path) {
            validate_file(&metadata)?;
        }
        let mut reservations = reservations.to_vec();
        reservations.sort_by(|left, right| left.username.cmp(&right.username));
        let persisted = PersistedRelay {
            version: STATE_VERSION,
            deployment_id: encode(&deployment_id),
            reservations: reservations
                .into_iter()
                .map(|reservation| PersistedReservationJson {
                    username: reservation.username,
                    public_key: encode(&reservation.public_key),
                })
                .collect(),
        };
        let mut encoded = serde_json::to_vec_pretty(&persisted)
            .map_err(|_| ProductRelayError::Corrupt("state serialization"))?;
        encoded.push(b'\n');
        if encoded.len() > MAX_STATE_BYTES {
            return Err(ProductRelayError::Corrupt("state size"));
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)?;
        set_file_mode(temporary.path())?;
        temporary.write_all(&encoded)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&self.path)
            .map_err(|error| ProductRelayError::Io(error.error))?;
        File::open(&self.root)?.sync_all()?;
        Ok(())
    }
}

fn read_public_file(path: &Path, maximum: usize) -> Result<Vec<u8>, ProductRelayError> {
    let metadata = fs::symlink_metadata(path)?;
    validate_public_file(&metadata)?;
    read_bounded_file(path, maximum, FileProtection::Public)
}

fn read_private_file(path: &Path, maximum: usize) -> Result<Vec<u8>, ProductRelayError> {
    let metadata = fs::symlink_metadata(path)?;
    validate_secret_file(&metadata)?;
    read_bounded_file(path, maximum, FileProtection::Secret)
}

#[derive(Clone, Copy)]
enum FileProtection {
    Public,
    Secret,
}

fn read_bounded_file(
    path: &Path,
    maximum: usize,
    protection: FileProtection,
) -> Result<Vec<u8>, ProductRelayError> {
    let file = File::open(path)?;
    match protection {
        FileProtection::Public => validate_public_file(&file.metadata()?)?,
        FileProtection::Secret => validate_secret_file(&file.metadata()?)?,
    }
    let mut bytes = Vec::new();
    file.take((maximum + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > maximum {
        return Err(ProductRelayError::Configuration("TLS file size"));
    }
    Ok(bytes)
}

#[cfg(unix)]
fn validate_public_file(metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    use std::os::unix::fs::MetadataExt as _;

    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != rustix::process::getuid().as_raw()
    {
        return Err(ProductRelayError::Corrupt("TLS certificate file"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_public_file(_metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    Err(ProductRelayError::Configuration(
        "protected TLS files are unsupported",
    ))
}

#[cfg(unix)]
fn ensure_root(path: &Path) -> Result<(), ProductRelayError> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && metadata.uid() == rustix::process::getuid().as_raw() => {}
        Ok(_) => return Err(ProductRelayError::Corrupt("state root")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
            let metadata = fs::symlink_metadata(path)?;
            if !metadata.is_dir()
                || metadata.file_type().is_symlink()
                || metadata.uid() != rustix::process::getuid().as_raw()
            {
                return Err(ProductRelayError::Corrupt("state root"));
            }
        }
        Err(error) => return Err(error.into()),
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn ensure_root(_path: &Path) -> Result<(), ProductRelayError> {
    Err(ProductRelayError::Configuration(
        "protected relay persistence is unsupported",
    ))
}

#[cfg(unix)]
fn validate_file(metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || metadata.permissions().mode() & 0o777 != 0o600
    {
        return Err(ProductRelayError::Corrupt("state file"));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_secret_file(metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    let mode = metadata.permissions().mode() & 0o777;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || !matches!(mode, 0o400 | 0o600)
    {
        return Err(ProductRelayError::Corrupt("TLS private key file"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_file(_metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    Err(ProductRelayError::Configuration(
        "protected relay persistence is unsupported",
    ))
}

#[cfg(not(unix))]
fn validate_secret_file(_metadata: &fs::Metadata) -> Result<(), ProductRelayError> {
    Err(ProductRelayError::Configuration(
        "protected TLS files are unsupported",
    ))
}

#[cfg(unix)]
fn set_file_mode(path: &Path) -> Result<(), ProductRelayError> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_file_mode(_path: &Path) -> Result<(), ProductRelayError> {
    Err(ProductRelayError::Configuration(
        "protected relay persistence is unsupported",
    ))
}

#[cfg(test)]
mod tests {
    use std::net::Ipv6Addr;

    use super::*;

    #[test]
    fn admission_tables_stop_at_exact_bounds_and_prune_without_tasks() {
        let now = Instant::now();
        let mut admission = AdmissionState::new();
        admission.aggregate = TokenBucket::new(10_000, 10_000, now);

        for value in 1..=MAX_RATE_SOURCES {
            let source = IpAddr::V6(Ipv6Addr::from(value as u128));
            assert!(admission.admit(source, None, now));
        }
        assert_eq!(admission.sources.len(), MAX_RATE_SOURCES);
        assert!(!admission.admit(
            IpAddr::V6(Ipv6Addr::from((MAX_RATE_SOURCES + 1) as u128)),
            None,
            now
        ));

        admission.routes.clear();
        for value in 0..MAX_RATE_ROUTES {
            admission.routes.insert(
                format!("route-{value}"),
                RateEntry {
                    bucket: TokenBucket::new(1, 1, now),
                    last_seen: now,
                },
            );
        }
        assert_eq!(admission.routes.len(), MAX_RATE_ROUTES);
        let source = IpAddr::V6(Ipv6Addr::LOCALHOST);
        admission.sources.insert(
            source,
            RateEntry {
                bucket: TokenBucket::new(10, 10, now),
                last_seen: now,
            },
        );
        assert!(!admission.admit(source, Some("new-route"), now));

        let expired = now - RATE_ENTRY_LIFETIME - Duration::from_secs(1);
        admission
            .routes
            .values_mut()
            .for_each(|entry| entry.last_seen = expired);
        admission.aggregate = TokenBucket::new(10, 10, now);
        assert!(admission.admit(source, Some("new-route"), now));
        assert_eq!(admission.routes.len(), 1);
    }

    #[test]
    fn trusted_proxy_uses_one_canonical_normalized_header_and_ignores_spoofing() {
        let trusted: IpAddr = "127.0.0.1".parse().unwrap();
        let immediate = SocketAddr::new(trusted, 44321);
        let mut headers = HeaderMap::new();
        assert_eq!(derive_source(Some(trusted), immediate, &headers), None);

        headers.insert(FORWARDED_SOURCE_HEADER, "198.51.100.7".parse().unwrap());
        assert_eq!(
            derive_source(Some(trusted), immediate, &headers),
            Some("198.51.100.7".parse().unwrap())
        );
        headers.append(FORWARDED_SOURCE_HEADER, "198.51.100.8".parse().unwrap());
        assert_eq!(derive_source(Some(trusted), immediate, &headers), None);

        let untrusted: IpAddr = "192.0.2.40".parse().unwrap();
        assert_eq!(
            derive_source(Some(trusted), SocketAddr::new(untrusted, 44321), &headers),
            Some(untrusted)
        );

        let mut noncanonical = HeaderMap::new();
        noncanonical.insert(FORWARDED_SOURCE_HEADER, "2001:0db8::1".parse().unwrap());
        assert_eq!(derive_source(Some(trusted), immediate, &noncanonical), None);
    }

    #[test]
    fn production_origin_transition_is_exact_and_bounded() {
        for origins in [
            vec!["https://remote.jstorrent.com"],
            vec!["https://jstorrent.com", "https://remote.jstorrent.com"],
        ] {
            assert!(
                ProductRelayOptions::production_with_origins(
                    "127.0.0.1".parse().unwrap(),
                    "abcdefghijklmnopqrstuvwxyz012345".to_owned(),
                    origins.into_iter().map(str::to_owned).collect(),
                )
                .is_ok()
            );
        }
        for origins in [
            vec![],
            vec!["https://remote.jstorrent.com/"],
            vec!["https://rstorrent.com"],
            vec!["https://remote.jstorrent.com.evil.test"],
            vec!["https://preview.pages.dev"],
            vec!["https://www.jstorrent.com"],
            vec!["https://jstorrent.com", "https://jstorrent.com"],
            vec![
                "https://jstorrent.com",
                "https://remote.jstorrent.com",
                "https://jstorrent.com",
            ],
        ] {
            assert!(
                ProductRelayOptions::production_with_origins(
                    "127.0.0.1".parse().unwrap(),
                    "abcdefghijklmnopqrstuvwxyz012345".to_owned(),
                    origins.into_iter().map(str::to_owned).collect(),
                )
                .is_err()
            );
        }
    }

    #[test]
    fn product_origin_operator_token_and_route_namespace_are_exact() {
        assert!(validate_origin("https://jstorrent.com").is_ok());
        assert!(validate_origin("https://rstorrent.com").is_ok());
        for origin in [
            "http://jstorrent.com",
            "https://jstorrent.com/",
            "https://jstorrent.com:444",
            "https://www.jstorrent.com",
            "https://evil.jstorrent.com",
            "https://jstorrent.com.evil.test",
        ] {
            assert!(validate_origin(origin).is_err(), "accepted {origin}");
        }
        let production = ProductRelayOptions::production(
            "127.0.0.1".parse().unwrap(),
            "abcdefghijklmnopqrstuvwxyz012345".to_owned(),
        )
        .unwrap();
        assert_eq!(production.allowed_client_origins, ["https://jstorrent.com"]);
        assert!(validate_origin("https://rstorrent.com/").is_err());
        assert!(
            ProductRelayOptions::production(
                "127.0.0.1".parse().unwrap(),
                "abcdefghijklmnopqrstuvwxyz012345".to_owned()
            )
            .is_ok()
        );
        assert!(
            ProductRelayOptions::production(
                "192.0.2.1".parse().unwrap(),
                "abcdefghijklmnopqrstuvwxyz012345".to_owned()
            )
            .is_err()
        );
        for route in ["admin", "my-support", "rstorrent", "nazi-box"] {
            assert!(validate_username(route).is_err(), "accepted {route}");
        }
        assert!(validate_username("my-torrent-box").is_ok());
    }
}
