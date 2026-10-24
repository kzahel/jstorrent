use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use p256::ecdsa::SigningKey;
use p256::elliptic_curve::Generate;
use rand::rngs::OsRng;
use rstorrent_remote_access::{
    AuthenticationMethod, AuthorityStore, EventId, ProvisioningMaterial, RemoteAuthority,
    SecuritySnapshot, Timestamp,
};
#[cfg(feature = "direct-file-webrtc")]
use rstorrent_remote_access::{DirectFileAuditView, EventKind, EventResult};
use rstorrent_remote_crypto::{
    ClientId, HostId, OperationSeed, RelayId, RngCompat, Username, random_operation_seed,
};
use rstorrent_remote_relay::{ReserveRouteRequest, ReserveRouteResponse};
use rustls_platform_verifier::BuilderVerifierExt as _;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_rustls::rustls::pki_types::CertificateDer;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_tungstenite::Connector;
use tokio_tungstenite::connect_async_tls_with_config;
use tokio_tungstenite::tungstenite::Message;
use url::Url;
use zeroize::Zeroizing;

use crate::error::Result;
use crate::runtime::run_host;
use crate::{RemoteHostError, wire};
use rstorrent_remote_relay::{
    HOST_CHALLENGE_MAGIC, RELEASE_COMPLETE_MAGIC, encode_host_proof, host_claim_transcript,
};

const PROTOCOL_FLOOR: u16 = 1;
const MAX_RELAY_CERTIFICATE_BYTES: usize = 64 * 1024;
const MIN_PASSPHRASE_BYTES: usize = 12;
const MAX_PASSPHRASE_BYTES: usize = 256;
const RESERVATION_ATTEMPTS: usize = 5;
const RESERVATION_RETRY_DELAY: Duration = Duration::from_millis(50);
pub const PRODUCT_RELAY_BASE: &str = "https://relay.rstorrent.com/";

pub struct RemoteHostConfig {
    relay_base: Url,
    relay_connector: Connector,
    relay_http: reqwest::Client,
    gateway_websocket_url: String,
    gateway_origin: String,
    gateway_token: Zeroizing<String>,
    host_build: String,
}

impl RemoteHostConfig {
    #[allow(clippy::too_many_arguments)]
    pub fn validation(
        relay_base: &str,
        relay_certificate_der: Vec<u8>,
        gateway_websocket_url: impl Into<String>,
        gateway_origin: impl Into<String>,
        gateway_token: String,
        host_build: impl Into<String>,
    ) -> Result<Self> {
        let relay_base = parse_relay_base(relay_base, RelayProfile::Validation)?;
        if relay_certificate_der.is_empty()
            || relay_certificate_der.len() > MAX_RELAY_CERTIFICATE_BYTES
        {
            return Err(RemoteHostError::Configuration("relay certificate"));
        }
        let certificate = CertificateDer::from(relay_certificate_der.clone());
        let mut roots = RootCertStore::empty();
        roots
            .add(certificate.clone())
            .map_err(|_| RemoteHostError::Configuration("relay certificate"))?;
        let relay_tls = ClientConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| RemoteHostError::Configuration("relay TLS protocol versions"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
        Self::finish(
            relay_base,
            relay_tls,
            gateway_websocket_url,
            gateway_origin,
            gateway_token,
            host_build,
        )
    }

    pub fn product(
        gateway_websocket_url: impl Into<String>,
        gateway_origin: impl Into<String>,
        gateway_token: String,
        host_build: impl Into<String>,
    ) -> Result<Self> {
        let relay_base = parse_relay_base(PRODUCT_RELAY_BASE, RelayProfile::Product)?;
        let relay_tls = ClientConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| RemoteHostError::Configuration("relay TLS protocol versions"))?
        .with_platform_verifier()
        .map_err(|_| RemoteHostError::Configuration("platform relay certificate trust"))?
        .with_no_client_auth();
        Self::finish(
            relay_base,
            relay_tls,
            gateway_websocket_url,
            gateway_origin,
            gateway_token,
            host_build,
        )
    }

    fn finish(
        relay_base: Url,
        relay_tls: ClientConfig,
        gateway_websocket_url: impl Into<String>,
        gateway_origin: impl Into<String>,
        gateway_token: String,
        host_build: impl Into<String>,
    ) -> Result<Self> {
        let relay_http = reqwest::Client::builder()
            .tls_backend_preconfigured(relay_tls.clone())
            .https_only(true)
            .build()
            .map_err(|_| RemoteHostError::Configuration("relay HTTP client"))?;

        let gateway_websocket_url = gateway_websocket_url.into();
        let gateway_url = Url::parse(&gateway_websocket_url)
            .map_err(|_| RemoteHostError::Configuration("gateway URL"))?;
        if gateway_url.scheme() != "ws"
            || !gateway_url.host().is_some_and(|host| match host {
                url::Host::Domain(name) => name == "localhost",
                url::Host::Ipv4(address) => address.is_loopback(),
                url::Host::Ipv6(address) => address.is_loopback(),
            })
            || gateway_url.path() != "/api/v1/connect"
            || gateway_url.query().is_some()
            || gateway_url.fragment().is_some()
        {
            return Err(RemoteHostError::Configuration(
                "gateway must be one exact loopback WebSocket",
            ));
        }
        let gateway_origin = gateway_origin.into();
        let origin = Url::parse(&gateway_origin)
            .map_err(|_| RemoteHostError::Configuration("gateway origin"))?;
        if origin.scheme() != "http"
            || origin.path() != "/"
            || !origin.host().is_some_and(|host| match host {
                url::Host::Domain(name) => name == "localhost",
                url::Host::Ipv4(address) => address.is_loopback(),
                url::Host::Ipv6(address) => address.is_loopback(),
            })
        {
            return Err(RemoteHostError::Configuration("gateway origin"));
        }
        if gateway_token.is_empty() || gateway_token.len() > 128 {
            return Err(RemoteHostError::Configuration("gateway token"));
        }
        let host_build = host_build.into();
        if host_build.is_empty() || host_build.len() > 160 {
            return Err(RemoteHostError::Configuration("host build"));
        }
        Ok(Self {
            relay_base,
            relay_connector: Connector::Rustls(Arc::new(relay_tls)),
            relay_http,
            gateway_websocket_url,
            gateway_origin,
            gateway_token: Zeroizing::new(gateway_token),
            host_build,
        })
    }

    pub(crate) fn relay_websocket_url(&self, path: &str) -> Result<String> {
        let mut url = self.relay_base.clone();
        url.set_scheme("wss")
            .map_err(|_| RemoteHostError::Configuration("relay URL scheme"))?;
        url.set_path(path);
        Ok(url.into())
    }

    pub(crate) fn relay_http_url(&self, path: &str) -> String {
        let mut url = self.relay_base.clone();
        url.set_path(path);
        url.into()
    }

    pub(crate) fn relay_connector(&self) -> Connector {
        self.relay_connector.clone()
    }

    pub(crate) fn gateway_websocket_url(&self) -> &str {
        &self.gateway_websocket_url
    }

    pub(crate) fn gateway_origin(&self) -> &str {
        &self.gateway_origin
    }

    pub(crate) fn gateway_token(&self) -> &str {
        &self.gateway_token
    }

    pub(crate) fn host_build(&self) -> &str {
        &self.host_build
    }
}

#[derive(Clone, Copy)]
enum RelayProfile {
    Product,
    Validation,
}

fn parse_relay_base(source: &str, profile: RelayProfile) -> Result<Url> {
    let relay = Url::parse(source).map_err(|_| RemoteHostError::Configuration("relay URL"))?;
    let common = relay.scheme() == "https"
        && relay.username().is_empty()
        && relay.password().is_none()
        && relay.path() == "/"
        && relay.query().is_none()
        && relay.fragment().is_none()
        && relay.origin().ascii_serialization() + "/" == source;
    let host_matches = match profile {
        RelayProfile::Product => relay.host_str() == Some("relay.rstorrent.com"),
        RelayProfile::Validation => relay.host().is_some_and(|host| match host {
            url::Host::Domain(name) => name == "localhost",
            url::Host::Ipv4(address) => address.is_loopback(),
            url::Host::Ipv6(address) => address.is_loopback(),
        }),
    };
    if !common || !host_matches {
        return Err(RemoteHostError::Configuration(match profile {
            RelayProfile::Product => "product relay origin",
            RelayProfile::Validation => "validation relay origin",
        }));
    }
    Ok(relay)
}

pub(crate) struct SharedOwner {
    pub(crate) store: AuthorityStore,
    pub(crate) state: Mutex<OwnerState>,
    pub(crate) config: RemoteHostConfig,
    pub(crate) shutdown: tokio_util::sync::CancellationToken,
    pub(crate) next_connection_generation: AtomicU64,
    #[cfg(feature = "direct-file-webrtc")]
    pub(crate) direct_file: Option<Arc<crate::direct_file::DirectFileSupervisor>>,
}

pub(crate) struct OwnerState {
    pub(crate) authority: Option<RemoteAuthority>,
    pub(crate) circuits: BTreeMap<[u8; 16], LiveCircuit>,
}

pub(crate) struct LiveCircuit {
    pub(crate) client_id: Option<ClientId>,
    pub(crate) authentication_method: AuthenticationMethod,
    pub(crate) connection_generation: u64,
    pub(crate) started: Timestamp,
    pub(crate) last_activity: Timestamp,
    pub(crate) route: String,
    pub(crate) cancellation: tokio_util::sync::CancellationToken,
}

struct HostLifecycle {
    cancellation: tokio_util::sync::CancellationToken,
    task: JoinHandle<()>,
}

pub struct RemoteAccessOwner {
    pub(crate) shared: Arc<SharedOwner>,
    lifecycle: Mutex<Option<HostLifecycle>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveCircuitView {
    pub circuit_id: String,
    pub client_id: Option<String>,
    pub authentication_method: AuthenticationMethod,
    pub connection_generation: u64,
    pub started: Timestamp,
    pub last_activity: Timestamp,
    pub route: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteSecurityView {
    pub enabled: bool,
    pub username: Option<String>,
    pub route: Option<String>,
    pub relay_id: Option<String>,
    pub host_pin: Option<String>,
    pub authority: Option<SecuritySnapshot>,
    pub retained_history: Option<SecuritySnapshot>,
    pub live_circuits: Vec<LiveCircuitView>,
    pub direct_file: DirectFileSecurityView,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectFileSecurityView {
    pub compiled: bool,
    pub enabled: bool,
    pub state: String,
    pub active_circuit_id: Option<String>,
    pub bytes_sent: u64,
    pub candidate_class: Option<String>,
    pub active_tasks: usize,
    pub open_sockets: usize,
    pub active_requests: usize,
    pub queued_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisableRemoteAccessOutcome {
    pub authority_file_removed: bool,
    pub route_released: bool,
}

fn unavailable_direct_file_view() -> DirectFileSecurityView {
    DirectFileSecurityView {
        compiled: false,
        enabled: false,
        state: "unavailable".to_owned(),
        active_circuit_id: None,
        bytes_sent: 0,
        candidate_class: None,
        active_tasks: 0,
        open_sockets: 0,
        active_requests: 0,
        queued_bytes: 0,
    }
}

impl RemoteAccessOwner {
    pub async fn open(root: impl Into<PathBuf>, config: RemoteHostConfig) -> Result<Self> {
        Self::open_inner(
            root.into(),
            config,
            #[cfg(feature = "direct-file-webrtc")]
            None,
        )
        .await
    }

    #[cfg(feature = "direct-file-webrtc")]
    pub async fn open_with_direct_file(
        root: impl Into<PathBuf>,
        config: RemoteHostConfig,
        application: Arc<Mutex<rstorrent_session::ApplicationService>>,
    ) -> Result<Self> {
        Self::open_inner(
            root.into(),
            config,
            Some(Arc::new(crate::direct_file::DirectFileSupervisor::new(
                application,
            ))),
        )
        .await
    }

    async fn open_inner(
        root: PathBuf,
        config: RemoteHostConfig,
        #[cfg(feature = "direct-file-webrtc")] direct_file: Option<
            Arc<crate::direct_file::DirectFileSupervisor>,
        >,
    ) -> Result<Self> {
        let store = AuthorityStore::new(root);
        let authority = store.load()?;
        let owner = Self {
            shared: Arc::new(SharedOwner {
                store,
                state: Mutex::new(OwnerState {
                    authority,
                    circuits: BTreeMap::new(),
                }),
                config,
                shutdown: tokio_util::sync::CancellationToken::new(),
                next_connection_generation: AtomicU64::new(1),
                #[cfg(feature = "direct-file-webrtc")]
                direct_file,
            }),
            lifecycle: Mutex::new(None),
        };
        #[cfg(feature = "direct-file-webrtc")]
        if let Some(supervisor) = &owner.shared.direct_file {
            let enabled = owner
                .shared
                .state
                .lock()
                .await
                .authority
                .as_ref()
                .is_some_and(RemoteAuthority::direct_file_transfers_enabled);
            supervisor.set_enabled(enabled).await;
        }
        if owner.shared.state.lock().await.authority.is_some() {
            owner.start_host().await;
        }
        Ok(owner)
    }

    pub async fn enable(&self, username: &str, passphrase: &[u8]) -> Result<RemoteSecurityView> {
        if !(MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len()) {
            return Err(RemoteHostError::Configuration("passphrase length"));
        }
        let username =
            Username::parse(username).map_err(|_| RemoteHostError::Configuration("username"))?;
        {
            let state = self.shared.state.lock().await;
            if state.authority.is_some() {
                return Err(RemoteHostError::Configuration(
                    "remote access is already enabled",
                ));
            }
        }
        let relay_key = SigningKey::generate_from_rng(&mut RngCompat::new(OsRng));
        let relay_secret: [u8; 32] = relay_key.to_bytes().into();
        let relay_public = relay_key.verifying_key().to_sec1_point(false);
        let reservation = ReserveRouteRequest {
            username: username.as_str().to_owned(),
            public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(relay_public.as_bytes()),
        };
        let reservation =
            serde_json::to_vec(&reservation).map_err(|_| RemoteHostError::Protocol)?;
        let mut response = None;
        for attempt in 0..RESERVATION_ATTEMPTS {
            match self
                .shared
                .config
                .relay_http
                .post(self.shared.config.relay_http_url("/v1/reservations"))
                .header("content-type", "application/json")
                .body(reservation.clone())
                .send()
                .await
            {
                Ok(candidate) => {
                    response = Some(candidate);
                    break;
                }
                Err(_) if attempt + 1 < RESERVATION_ATTEMPTS => {
                    tokio::time::sleep(RESERVATION_RETRY_DELAY).await;
                }
                Err(_) => return Err(RemoteHostError::Relay),
            }
        }
        let response = response.ok_or(RemoteHostError::Relay)?;
        if !response.status().is_success() {
            return Err(RemoteHostError::Relay);
        }
        let response: ReserveRouteResponse =
            serde_json::from_slice(&response.bytes().await.map_err(|_| RemoteHostError::Relay)?)
                .map_err(|_| RemoteHostError::Relay)?;
        let relay_id = RelayId::new(wire::decode_id(&response.relay_id)?);
        let authority = RemoteAuthority::provision(
            username.clone(),
            passphrase,
            username.as_str(),
            PROTOCOL_FLOOR,
            now(),
            random_event_id()?,
            ProvisioningMaterial::new(
                HostId::new(random_array()?),
                relay_id,
                relay_secret,
                random_operation_seed().map_err(|_| RemoteHostError::Protocol)?,
                random_operation_seed().map_err(|_| RemoteHostError::Protocol)?,
                random_operation_seed().map_err(|_| RemoteHostError::Protocol)?,
                random_operation_seed().map_err(|_| RemoteHostError::Protocol)?,
            ),
        )?;
        if let Err(error) = self.shared.store.create(&authority) {
            let _ = release_route(&self.shared.config, &authority).await;
            return Err(error.into());
        }
        self.shared.state.lock().await.authority = Some(authority);
        #[cfg(feature = "direct-file-webrtc")]
        if let Some(supervisor) = &self.shared.direct_file {
            supervisor.set_enabled(true).await;
        }
        self.start_host().await;
        self.security_view().await
    }

    pub async fn security_view(&self) -> Result<RemoteSecurityView> {
        self.shared.security_view().await
    }

    pub async fn revoke(&self, encoded_client_id: &str) -> Result<()> {
        self.shared.revoke(encoded_client_id).await
    }

    pub async fn revoke_all_other(&self, retained_client_id: &str) -> Result<usize> {
        self.shared.revoke_all_other(retained_client_id).await
    }

    pub async fn close_circuit(&self, encoded_circuit_id: &str) -> Result<()> {
        self.shared.close_circuit(encoded_circuit_id).await
    }

    pub async fn rename(&self, encoded_client_id: &str, label: &str) -> Result<()> {
        self.shared.rename(encoded_client_id, label).await
    }

    pub async fn require_password_everywhere(&self) -> Result<usize> {
        self.shared.require_password_everywhere().await
    }

    pub async fn change_passphrase(&self, passphrase: &[u8]) -> Result<usize> {
        if !(MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len()) {
            return Err(RemoteHostError::Configuration("passphrase length"));
        }
        let mut state = self.shared.state.lock().await;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        let count = authority.security_snapshot().clients.len();
        let event_id = random_event_id()?;
        let tombstone_events = random_event_ids(count)?;
        let start_seed = random_seed()?;
        let finish_seed = random_seed()?;
        let revoked = self.shared.store.update(authority, |candidate| {
            candidate.change_passphrase(
                passphrase,
                start_seed,
                finish_seed,
                now(),
                event_id,
                tombstone_events,
            )
        })?;
        state
            .circuits
            .values()
            .for_each(|circuit| circuit.cancellation.cancel());
        Ok(revoked)
    }

    pub async fn clear_history(&self) -> Result<bool> {
        self.shared.clear_history()
    }

    pub async fn set_direct_file_transfers_enabled(
        &self,
        enabled: bool,
    ) -> Result<RemoteSecurityView> {
        self.shared
            .set_direct_file_transfers_enabled(enabled)
            .await?;
        self.security_view().await
    }

    pub async fn stop_direct_file_transfers(&self) -> Result<RemoteSecurityView> {
        self.shared
            .stop_direct_file_transfers("operator_stop")
            .await?;
        self.security_view().await
    }

    pub async fn disable(&self) -> Result<DisableRemoteAccessOutcome> {
        self.stop_host().await;
        self.shared
            .stop_direct_file_transfers("remote_access_disabled")
            .await?;
        let authority = {
            let mut state = self.shared.state.lock().await;
            if !state.circuits.is_empty() {
                return Err(RemoteHostError::Configuration(
                    "remote circuits did not stop",
                ));
            }
            state
                .authority
                .take()
                .ok_or(RemoteHostError::Configuration("remote access is disabled"))?
        };
        let route_released = release_route(&self.shared.config, &authority).await.is_ok();
        let disabled = self
            .shared
            .store
            .disable(authority, now(), random_event_id()?);
        match disabled {
            Ok(outcome) => Ok(DisableRemoteAccessOutcome {
                authority_file_removed: outcome.authority_file_removed,
                route_released,
            }),
            Err(error) => {
                let restored = self.shared.store.load()?;
                let should_restart = restored.is_some();
                self.shared.state.lock().await.authority = restored;
                if should_restart {
                    self.start_host().await;
                }
                Err(error.into())
            }
        }
    }

    pub async fn recover(&self, username: &str, passphrase: &[u8]) -> Result<RemoteSecurityView> {
        if self.shared.state.lock().await.authority.is_some() {
            self.disable().await?;
        }
        self.enable(username, passphrase).await
    }

    pub async fn shutdown(&self) {
        self.shared.shutdown.cancel();
        self.stop_host().await;
        let _ = self
            .shared
            .stop_direct_file_transfers("application_shutdown")
            .await;
    }

    async fn start_host(&self) {
        let mut lifecycle = self.lifecycle.lock().await;
        if lifecycle.is_some() || self.shared.shutdown.is_cancelled() {
            return;
        }
        let cancellation = tokio_util::sync::CancellationToken::new();
        let shared = self.shared.clone();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move { run_host(shared, task_cancellation).await });
        *lifecycle = Some(HostLifecycle { cancellation, task });
    }

    async fn stop_host(&self) {
        let lifecycle = self.lifecycle.lock().await.take();
        if let Some(lifecycle) = lifecycle {
            lifecycle.cancellation.cancel();
            let _ = lifecycle.task.await;
        }
    }
}

pub(crate) fn now() -> Timestamp {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Timestamp::from_millis(u64::try_from(millis).unwrap_or(u64::MAX))
}

pub(crate) fn random_array<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|_| RemoteHostError::Protocol)?;
    Ok(bytes)
}

pub(crate) fn random_event_id() -> Result<EventId> {
    Ok(EventId::new(random_array()?))
}

fn random_event_ids(count: usize) -> Result<Vec<EventId>> {
    (0..count).map(|_| random_event_id()).collect()
}

pub(crate) fn random_seed() -> Result<OperationSeed> {
    Ok(OperationSeed::new(random_array()?))
}

impl SharedOwner {
    pub(crate) fn connection_generation(&self) -> u64 {
        self.next_connection_generation
            .fetch_add(1, Ordering::Relaxed)
    }

    pub(crate) async fn set_direct_file_transfers_enabled(&self, enabled: bool) -> Result<()> {
        #[cfg(not(feature = "direct-file-webrtc"))]
        {
            let _ = enabled;
            Err(RemoteHostError::Configuration(
                "direct-file transport is not compiled",
            ))
        }
        #[cfg(feature = "direct-file-webrtc")]
        {
            let supervisor = self
                .direct_file
                .as_ref()
                .ok_or(RemoteHostError::Configuration(
                    "direct-file transport is unavailable",
                ))?;
            if !enabled {
                let closed = supervisor.set_enabled(false).await;
                self.record_closed_direct_files(closed, "direct_transfer_disabled")
                    .await;
            }
            let event_id = random_event_id()?;
            let mut state = self.state.lock().await;
            let authority = state
                .authority
                .as_mut()
                .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
            self.store.update(authority, |candidate| {
                candidate.set_direct_file_transfers_enabled(enabled, now(), event_id)
            })?;
            drop(state);
            if enabled {
                supervisor.set_enabled(true).await;
            }
            Ok(())
        }
    }

    pub(crate) async fn stop_direct_file_transfers(&self, reason: &str) -> Result<()> {
        #[cfg(feature = "direct-file-webrtc")]
        if let Some(supervisor) = &self.direct_file {
            let closed = supervisor.close_all().await;
            self.record_closed_direct_files(closed, reason).await;
        }
        #[cfg(not(feature = "direct-file-webrtc"))]
        let _ = reason;
        Ok(())
    }

    #[cfg(feature = "direct-file-webrtc")]
    pub(crate) async fn record_direct_file_started(
        &self,
        client_id: Option<ClientId>,
        circuit_id: [u8; 16],
        torrent_id: String,
        file_index: u32,
    ) -> Result<()> {
        let event_id = random_event_id()?;
        let mut state = self.state.lock().await;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        self.store.update(authority, |candidate| {
            candidate.record_direct_file_event(
                EventKind::DirectFileStarted,
                EventResult::Succeeded,
                client_id,
                circuit_id,
                now(),
                event_id,
                DirectFileAuditView {
                    torrent_id,
                    file_index,
                    byte_count: 0,
                    candidate_class: None,
                },
                None,
            )
        })?;
        Ok(())
    }

    #[cfg(feature = "direct-file-webrtc")]
    pub(crate) async fn record_closed_direct_file(
        &self,
        closed: crate::direct_file::ClosedDirectFile,
        reason: &str,
    ) {
        let Ok(event_id) = random_event_id() else {
            return;
        };
        let (kind, result) = if reason == "complete" {
            (EventKind::DirectFileCompleted, EventResult::Succeeded)
        } else if matches!(
            reason,
            "cancelled" | "operator_stop" | "direct_transfer_disabled"
        ) {
            (EventKind::DirectFileCancelled, EventResult::Succeeded)
        } else {
            (EventKind::DirectFileFailed, EventResult::Rejected)
        };
        let mut state = self.state.lock().await;
        let client_id = state
            .circuits
            .get(&closed.circuit_id)
            .and_then(|circuit| circuit.client_id);
        let Some(authority) = state.authority.as_mut() else {
            return;
        };
        let _ = self.store.update(authority, |candidate| {
            candidate.record_direct_file_event(
                kind,
                result,
                client_id,
                closed.circuit_id,
                now(),
                event_id,
                DirectFileAuditView {
                    torrent_id: closed.torrent_id,
                    file_index: closed.file_index,
                    byte_count: closed.snapshot.bytes_sent.min(closed.file_length),
                    candidate_class: closed.snapshot.selected_candidate_class,
                },
                Some(reason.to_owned()),
            )
        });
    }

    #[cfg(feature = "direct-file-webrtc")]
    async fn record_closed_direct_files(
        &self,
        closed: Vec<crate::direct_file::ClosedDirectFile>,
        reason: &str,
    ) {
        for closed in closed {
            self.record_closed_direct_file(closed, reason).await;
        }
    }

    pub(crate) async fn security_view(&self) -> Result<RemoteSecurityView> {
        self.expire_authorizations().await?;
        let retained_history = self.store.load_history()?;
        let (
            enabled,
            direct_enabled,
            username,
            route,
            relay_id,
            host_pin,
            authority,
            live_circuits,
        ) = {
            let state = self.state.lock().await;
            let (direct_enabled, username, route, relay_id, host_pin, authority) =
                match &state.authority {
                    Some(authority) => (
                        authority.direct_file_transfers_enabled(),
                        Some(authority.binding().username().as_str().to_owned()),
                        Some(authority.route().to_owned()),
                        Some(wire::encode_id(authority.binding().relay_id().as_bytes())),
                        Some(wire::encode_id(&authority.host_pin().to_bytes())),
                        Some(authority.security_snapshot()),
                    ),
                    None => (false, None, None, None, None, None),
                };
            let live_circuits = state
                .circuits
                .iter()
                .map(|(circuit_id, circuit)| LiveCircuitView {
                    circuit_id: wire::encode_id(circuit_id),
                    client_id: circuit
                        .client_id
                        .map(|client_id| wire::encode_id(client_id.as_bytes())),
                    authentication_method: circuit.authentication_method,
                    connection_generation: circuit.connection_generation,
                    started: circuit.started,
                    last_activity: circuit.last_activity,
                    route: circuit.route.clone(),
                })
                .collect();
            (
                state.authority.is_some(),
                direct_enabled,
                username,
                route,
                relay_id,
                host_pin,
                authority,
                live_circuits,
            )
        };
        #[cfg(feature = "direct-file-webrtc")]
        let direct_file = match &self.direct_file {
            Some(supervisor) => {
                let snapshot = supervisor.snapshot().await;
                DirectFileSecurityView {
                    compiled: true,
                    enabled: direct_enabled,
                    state: snapshot.state,
                    active_circuit_id: snapshot.active_circuit.map(|id| wire::encode_id(&id)),
                    bytes_sent: snapshot.bytes_sent,
                    candidate_class: snapshot.candidate_class,
                    active_tasks: snapshot.active_tasks,
                    open_sockets: snapshot.open_sockets,
                    active_requests: snapshot.active_requests,
                    queued_bytes: snapshot.queued_bytes,
                }
            }
            None => unavailable_direct_file_view(),
        };
        #[cfg(not(feature = "direct-file-webrtc"))]
        let _ = direct_enabled;
        #[cfg(not(feature = "direct-file-webrtc"))]
        let direct_file = unavailable_direct_file_view();
        Ok(RemoteSecurityView {
            enabled,
            username,
            route,
            relay_id,
            host_pin,
            authority,
            retained_history,
            live_circuits,
            direct_file,
        })
    }

    pub(crate) async fn revoke(&self, encoded_client_id: &str) -> Result<()> {
        let client_id = ClientId::new(wire::decode_id(encoded_client_id)?);
        let mut state = self.state.lock().await;
        let event_id = random_event_id()?;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        self.store.update(authority, |candidate| {
            candidate.revoke_client(client_id, now(), event_id)
        })?;
        for circuit in state
            .circuits
            .values()
            .filter(|circuit| circuit.client_id == Some(client_id))
        {
            circuit.cancellation.cancel();
        }
        Ok(())
    }

    pub(crate) async fn revoke_all_other(&self, retained_client_id: &str) -> Result<usize> {
        let retained_client_id = ClientId::new(wire::decode_id(retained_client_id)?);
        let mut state = self.state.lock().await;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        let client_ids = authority
            .security_snapshot()
            .clients
            .into_iter()
            .map(|client| wire::decode_id(&client.client_id).map(ClientId::new))
            .collect::<Result<Vec<_>>>()?;
        let revoked_ids = client_ids
            .iter()
            .copied()
            .filter(|client_id| *client_id != retained_client_id)
            .collect::<Vec<_>>();
        let event_ids = random_event_ids(revoked_ids.len())?;
        let revoked = self.store.update(authority, |candidate| {
            candidate.revoke_all_except(retained_client_id, now(), event_ids)
        })?;
        for circuit in state.circuits.values().filter(|circuit| {
            circuit
                .client_id
                .is_some_and(|client_id| revoked_ids.contains(&client_id))
        }) {
            circuit.cancellation.cancel();
        }
        Ok(revoked)
    }

    pub(crate) async fn close_circuit(&self, encoded_circuit_id: &str) -> Result<()> {
        let circuit_id = wire::decode_id(encoded_circuit_id)?;
        let state = self.state.lock().await;
        let circuit = state
            .circuits
            .get(&circuit_id)
            .ok_or(RemoteHostError::Configuration("live circuit not found"))?;
        circuit.cancellation.cancel();
        Ok(())
    }

    pub(crate) async fn rename(&self, encoded_client_id: &str, label: &str) -> Result<()> {
        let client_id = ClientId::new(wire::decode_id(encoded_client_id)?);
        let event_id = random_event_id()?;
        let mut state = self.state.lock().await;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        self.store.update(authority, |candidate| {
            candidate.rename_client(client_id, label, now(), event_id)
        })?;
        Ok(())
    }

    pub(crate) async fn require_password_everywhere(&self) -> Result<usize> {
        let mut state = self.state.lock().await;
        let authority = state
            .authority
            .as_mut()
            .ok_or(RemoteHostError::Configuration("remote access is disabled"))?;
        let count = authority.security_snapshot().clients.len();
        let event_id = random_event_id()?;
        let tombstone_events = random_event_ids(count)?;
        let revoked = self.store.update(authority, |candidate| {
            candidate.require_password_everywhere(now(), event_id, tombstone_events)
        })?;
        state
            .circuits
            .values()
            .filter(|circuit| circuit.client_id.is_some())
            .for_each(|circuit| circuit.cancellation.cancel());
        Ok(revoked)
    }

    pub(crate) fn clear_history(&self) -> Result<bool> {
        Ok(self.store.clear_history()?)
    }

    async fn expire_authorizations(&self) -> Result<usize> {
        let current = now();
        let mut state = self.state.lock().await;
        let Some(authority) = state.authority.as_mut() else {
            return Ok(0);
        };
        let count = authority
            .security_snapshot()
            .clients
            .iter()
            .filter(|client| current >= client.idle_expires || current >= client.absolute_expires)
            .count();
        if count == 0 {
            return Ok(0);
        }
        let event_ids = random_event_ids(count)?;
        let expired = self.store.update(authority, |candidate| {
            candidate.expire_clients(current, event_ids)
        })?;
        let current_ids = authority
            .security_snapshot()
            .clients
            .into_iter()
            .map(|client| client.client_id)
            .collect::<std::collections::BTreeSet<_>>();
        state
            .circuits
            .values()
            .filter(|circuit| {
                circuit
                    .client_id
                    .is_some_and(|id| !current_ids.contains(&wire::encode_id(id.as_bytes())))
            })
            .for_each(|circuit| circuit.cancellation.cancel());
        Ok(expired)
    }
}

async fn release_route(config: &RemoteHostConfig, authority: &RemoteAuthority) -> Result<()> {
    let path = format!("/v1/release/{}", authority.route());
    let url = config.relay_websocket_url(&path)?;
    for _ in 0..10 {
        let connected =
            connect_async_tls_with_config(url.clone(), None, false, Some(config.relay_connector()))
                .await;
        let Ok((mut socket, _)) = connected else {
            return Err(RemoteHostError::Relay);
        };
        let Some(Ok(Message::Binary(challenge))) = socket.next().await else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        if challenge.len() != 68 || &challenge[..4] != HOST_CHALLENGE_MAGIC {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        }
        let relay_id: [u8; 32] = challenge[4..36]
            .try_into()
            .map_err(|_| RemoteHostError::Relay)?;
        if authority.binding().relay_id().as_bytes() != &relay_id {
            return Err(RemoteHostError::Relay);
        }
        let nonce: [u8; 32] = challenge[36..]
            .try_into()
            .map_err(|_| RemoteHostError::Relay)?;
        let transcript = host_claim_transcript(relay_id, authority.route(), nonce, true)
            .map_err(|_| RemoteHostError::Relay)?;
        let signature = authority.sign_relay_transcript(&transcript);
        socket
            .send(Message::Binary(
                encode_host_proof(signature.as_bytes())
                    .map_err(|_| RemoteHostError::Relay)?
                    .into(),
            ))
            .await
            .map_err(|_| RemoteHostError::Relay)?;
        if matches!(socket.next().await, Some(Ok(Message::Binary(message))) if message.as_ref() == RELEASE_COMPLETE_MAGIC)
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(RemoteHostError::Relay)
}
