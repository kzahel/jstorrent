//! Stable session-network composition and joined lifetime ownership.

use std::error::Error;
use std::fmt;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rstorrent_engine::dht::{DhtConfig, DhtError, DhtService, DhtSnapshot};
use rstorrent_engine::{
    AddressFamily, AddressFamilyPolicy, ByteMetricSink, DiscoveryAdvertisementError,
    DiscoveryAdvertisementHandle, DiscoveryAdvertisementService, IncomingPeerAcceptor,
    IncomingPeerError, IncomingPeerHandle, IncomingPeerRuntime, IncomingPeerServiceConfig,
    IncomingPeerServiceSnapshot, MseDhWorkOwner, MseHandshakeObservation, MseHandshakeOutcome,
    MseHandshakeSink, NetworkConfig, PeerAdvertisementEndpoint, PeerBudget, PeerEncryptionPolicy,
    PeerEncryptionPolicyHandle, PeerExchangePolicyHandle, PeerTransportPolicy, SessionSocketConfig,
    SessionSocketError, SessionSocketFamilySet, SessionSocketFamilyState, SessionSocketSet,
    SessionUdpError, SessionUdpHandle, SessionUdpRepairRequest, SessionUdpService,
    TorrentBandwidth, TorrentTransferRateLimits, UtpHandle, UtpRuntimeError, UtpService,
};
use rstorrent_engine::{
    BandwidthDirectionSnapshot, BandwidthError, SessionBandwidth, SessionBandwidthHandle,
    SessionBandwidthSnapshot,
};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::advertised_endpoint::AdvertisedPeerEndpointSelector;
use crate::dht_views::{DhtObservationRuntime, inspection_view};
use crate::diagnostics::{
    DiagnosticCategory, DiagnosticDraft, DiagnosticField, DiagnosticSeverity, category,
};
use crate::incoming_seeding::IncomingSeeding;
use crate::reachability::{
    Ipv6PinholeDiagnosticResult, ReachabilityBlocks, ReachabilityCoordinator,
    ReachabilityEvidenceProbe, ReachabilityFinalShutdown, ReachabilityGenerationShutdown,
    ReachabilityStartInputs, UncertainMappingLease, UncertainPinholeLease,
};
use crate::session_utp::SessionUtpPeerService;
use crate::settings::{
    AdvertisedPeerEndpointStatus, BandwidthDirectionRuntimeView, BandwidthRuntimeView,
    ClientSettings, ClientSettingsApplicationState, ClientSettingsDegradedReason,
    ClientSettingsRuntimeView, EffectiveListenerSettings, EncryptionPolicy,
    HttpsServerAuthenticationPolicy, ListenerBindFailureReason, ListenerPolicy, ListenerStatus,
    PortMappingPolicy, SessionUdpStatus, SettingsAttempt, SettingsConvergenceModel, SettingsDomain,
    SettingsDomainGeneration, TransportAddressFamily, TransportFamilyRuntimeView,
    classify_listener_bind_failure,
};
use crate::shutdown::CleanupCutoff;
use crate::views::{DhtInspectionView, ViewHub};

const PEER_RECONFIGURATION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug)]
struct PendingPeerLimit {
    generation: SettingsDomainGeneration,
    deadline: tokio::time::Instant,
}

#[derive(Clone, Debug)]
struct PendingMappingExpiry {
    attempt: SettingsAttempt,
    deadline: Instant,
}

fn classify_session_socket_bind_failure(error: &SessionSocketError) -> Option<ListenerStatus> {
    let kind = match error {
        SessionSocketError::Bind { source, .. }
        | SessionSocketError::LocalAddress { source, .. } => source.kind(),
        SessionSocketError::GlobalIpv6Address(_)
        | SessionSocketError::IneligibleGlobalIpv6Address(_)
        | SessionSocketError::LocalNetworkAddress(_) => io::ErrorKind::AddrNotAvailable,
        SessionSocketError::InvalidPreferredPort(_)
        | SessionSocketError::InvalidFixedPort(_)
        | SessionSocketError::InvalidUdpFallbackAddress => return None,
    };
    Some(classify_listener_bind_failure(&io::Error::new(
        kind,
        error.to_string(),
    )))
}

#[derive(Clone, Debug)]
pub(crate) struct SessionNetworkConfig {
    pub settings: ClientSettings,
    pub defer_idle_dht: bool,
    pub discovery_demand: bool,
    pub network: NetworkConfig,
    pub network_cancellation: CancellationToken,
    pub dht: DhtConfig,
    pub initial_dht_snapshot: Option<DhtSnapshot>,
    pub byte_metric_sink: Arc<dyn ByteMetricSink>,
    pub upload_read_jobs: usize,
    pub incoming_handshake_timeout: Duration,
    pub incoming_peer_activity_timeout: Duration,
    pub incoming_keepalive_interval: Duration,
    pub incoming_no_request_timeout: Duration,
    pub incoming_inactivity_timeout: Duration,
    pub peer_budget_max_open_files_for_testing: Option<usize>,
    pub peer_transport_policy: PeerTransportPolicy,
}

#[derive(Debug)]
pub(crate) enum SessionNetworkError {
    Configuration(String),
    Dht(DhtError),
    Incoming(IncomingPeerError),
    SessionSocket(SessionSocketError),
    SessionUdp(SessionUdpError),
    Utp(UtpRuntimeError),
    Discovery(DiscoveryAdvertisementError),
}

impl fmt::Display for SessionNetworkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => write!(formatter, "session network: {message}"),
            Self::Dht(error) => write!(formatter, "{error}"),
            Self::Incoming(error) => write!(formatter, "{error}"),
            Self::SessionSocket(error) => write!(formatter, "{error}"),
            Self::SessionUdp(error) => write!(formatter, "{error}"),
            Self::Utp(error) => write!(formatter, "{error}"),
            Self::Discovery(error) => write!(formatter, "{error}"),
        }
    }
}

impl Error for SessionNetworkError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Dht(error) => Some(error),
            Self::Incoming(error) => Some(error),
            Self::SessionSocket(error) => Some(error),
            Self::SessionUdp(error) => Some(error),
            Self::Utp(error) => Some(error),
            Self::Discovery(error) => Some(error),
            Self::Configuration(_) => None,
        }
    }
}

impl From<DhtError> for SessionNetworkError {
    fn from(error: DhtError) -> Self {
        Self::Dht(error)
    }
}

impl From<IncomingPeerError> for SessionNetworkError {
    fn from(error: IncomingPeerError) -> Self {
        Self::Incoming(error)
    }
}

impl From<SessionSocketError> for SessionNetworkError {
    fn from(error: SessionSocketError) -> Self {
        Self::SessionSocket(error)
    }
}

impl From<SessionUdpError> for SessionNetworkError {
    fn from(error: SessionUdpError) -> Self {
        Self::SessionUdp(error)
    }
}

impl From<UtpRuntimeError> for SessionNetworkError {
    fn from(error: UtpRuntimeError) -> Self {
        Self::Utp(error)
    }
}

impl From<DiscoveryAdvertisementError> for SessionNetworkError {
    fn from(error: DiscoveryAdvertisementError) -> Self {
        Self::Discovery(error)
    }
}

#[derive(Debug)]
pub(crate) struct SessionNetworkShutdown {
    pub dht_snapshot: Option<DhtSnapshot>,
    pub dht_error: Option<DhtError>,
    pub join_error: Option<String>,
    /// Torrents whose tracker `stopped` announces the cleanup cutoff ended.
    pub tracker_stops_cut_short: usize,
    /// Port mappings and pinholes whose removal the cleanup cutoff ended.
    pub port_mappings_left: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct SessionNetworkRuntime {
    settings: ClientSettings,
    effective_peer_connection_limit: u32,
    listener_status: ListenerStatus,
    session_udp_status: SessionUdpStatus,
    advertised_endpoint: AdvertisedPeerEndpointSelector,
    peer_budget: PeerBudget,
    mse_dh: MseDhWorkOwner,
    encryption: PeerEncryptionPolicyHandle,
    peer_exchange: PeerExchangePolicyHandle,
    mse_handshake_diagnostics: Arc<SessionMseHandshakeDiagnostics>,
    incoming_handle: IncomingPeerHandle,
    incoming_seeding: IncomingSeeding,
    session_udp_handle: SessionUdpHandle,
    utp_handle: Option<UtpHandle>,
    discovery_handle: DiscoveryAdvertisementHandle,
    reachability_evidence: ReachabilityEvidenceProbe,
    listener_active: Arc<AtomicBool>,
    pending_owner: Option<SessionNetworkOwner>,
    settings_sender: Option<watch::Sender<Option<SettingsAttempt>>>,
    discovery_demand_sender: watch::Sender<bool>,
    discovery_demand_receiver: Option<watch::Receiver<bool>>,
    reconciliation_cancellation: CancellationToken,
    reconciliation_task: Option<JoinHandle<SessionNetworkOwner>>,
    convergence: Arc<Mutex<SettingsConvergenceModel>>,
    initial_mapping_generation: SettingsDomainGeneration,
    initial_transport_application: ClientSettingsApplicationState,
    initial_tracker_https_authentication: Option<HttpsServerAuthenticationPolicy>,
    initial_tracker_https_application: ClientSettingsApplicationState,
    views: Option<ViewHub>,
    bandwidth: Option<SessionBandwidth>,
}

#[derive(Debug, Default)]
struct SessionMseHandshakeDiagnostics {
    views: Mutex<Option<ViewHub>>,
}

impl SessionMseHandshakeDiagnostics {
    fn attach(&self, views: ViewHub) {
        *self
            .views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(views);
    }
}

impl MseHandshakeSink for SessionMseHandshakeDiagnostics {
    fn record(&self, observation: MseHandshakeObservation) {
        let views = self
            .views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let Some(views) = views else {
            return;
        };
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
        let (severity, code, outcome, detail) = match observation.outcome {
            MseHandshakeOutcome::Negotiated(method) => (
                DiagnosticSeverity::Info,
                "mse_handshake_negotiated",
                "negotiated",
                match method {
                    rstorrent_protocol::mse::MseMethod::PlaintextPayload => "plaintext_payload",
                    rstorrent_protocol::mse::MseMethod::Rc4 => "rc4",
                },
            ),
            MseHandshakeOutcome::Failed(failure) => (
                DiagnosticSeverity::Warning,
                "mse_handshake_failed",
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
        let _ = views.record_structured_diagnostic(DiagnosticDraft {
            severity,
            category: DiagnosticCategory::from_static(category::PEER_PROTOCOL),
            code: code.to_owned(),
            torrent_id: None,
            message: "Incoming peer stream obfuscation handshake ended".to_owned(),
            subjects: Vec::new(),
            fields: vec![
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
        });
    }
}

#[derive(Debug)]
struct SessionNetworkOwner {
    defer_idle_dht: bool,
    discovery_demand: bool,
    configured_dht_enabled: bool,
    dht_generation: SettingsDomainGeneration,
    effective_settings: ClientSettings,
    effective_listener: Option<EffectiveListenerSettings>,
    listener_status: ListenerStatus,
    session_udp_status: SessionUdpStatus,
    dht_bind_address: std::net::SocketAddr,
    address_families: AddressFamilyPolicy,
    incoming_handshake_timeout: Duration,
    network_cancellation: CancellationToken,
    advertised_endpoint: AdvertisedPeerEndpointSelector,
    peer_budget: PeerBudget,
    mse_dh: MseDhWorkOwner,
    encryption: PeerEncryptionPolicyHandle,
    peer_exchange_capable: bool,
    peer_exchange: PeerExchangePolicyHandle,
    incoming_runtime: Option<IncomingPeerRuntime>,
    incoming_acceptor: Option<IncomingPeerAcceptor>,
    incoming_ipv6_acceptor: Option<IncomingPeerAcceptor>,
    incoming_seeding: IncomingSeeding,
    session_udp: Option<SessionUdpService>,
    session_utp: Option<SessionUtpPeerService>,
    dht: Option<DhtService>,
    dht_observations: Option<DhtObservationRuntime>,
    discovery_advertisement: Option<DiscoveryAdvertisementService>,
    reachability: Option<ReachabilityCoordinator>,
    reachability_evidence: ReachabilityEvidenceProbe,
    listener_active: Arc<AtomicBool>,
    uncertain_mapping: Option<UncertainMappingLease>,
    uncertain_udp_mapping: Option<UncertainMappingLease>,
    uncertain_pinhole: Option<UncertainPinholeLease>,
    mapping_runtime_error: Option<String>,
    effective_tracker_https_authentication: Option<HttpsServerAuthenticationPolicy>,
    bandwidth: SessionBandwidthHandle,
}

impl SessionNetworkRuntime {
    pub(crate) async fn start(config: SessionNetworkConfig) -> Result<Self, SessionNetworkError> {
        let SessionNetworkConfig {
            settings,
            defer_idle_dht,
            discovery_demand,
            mut network,
            network_cancellation,
            mut dht,
            initial_dht_snapshot,
            byte_metric_sink,
            upload_read_jobs,
            incoming_handshake_timeout,
            incoming_peer_activity_timeout,
            incoming_keepalive_interval,
            incoming_no_request_timeout,
            incoming_inactivity_timeout,
            peer_budget_max_open_files_for_testing,
            peer_transport_policy,
        } = config;
        if network_cancellation.is_cancelled() {
            return Err(SessionNetworkError::Configuration(
                "network prerequisite generation is closed".to_owned(),
            ));
        }
        let requested_address_families = if settings.ipv6_enabled {
            AddressFamilyPolicy::dual_stack()
        } else {
            AddressFamilyPolicy::ipv4_only()
        };
        network = network.with_address_families(requested_address_families);
        let mut peer_budget_config = settings.peer_budget_config();
        if let Some(maximum) = peer_budget_max_open_files_for_testing {
            peer_budget_config.max_open_files = maximum;
        }
        let effective_peer_connection_limit = u32::try_from(peer_budget_config.effective_limit())
            .map_err(|_| {
            SessionNetworkError::Configuration(
                "effective peer connection limit cannot be represented".to_owned(),
            )
        })?;
        let peer_budget = PeerBudget::new(peer_budget_config);
        let mse_dh = MseDhWorkOwner::new();
        let mse_handshake_diagnostics = Arc::new(SessionMseHandshakeDiagnostics::default());
        let encryption = PeerEncryptionPolicyHandle::new(settings.encryption.into_engine());
        let peer_exchange_capable = network.peer_exchange;
        let peer_exchange =
            PeerExchangePolicyHandle::new(peer_exchange_capable && settings.peer_exchange_enabled);
        let mut incoming_config = IncomingPeerServiceConfig::new(settings.incoming_bootstrap())
            .with_peer_budget(peer_budget.clone())
            .with_encryption(settings.encryption.into_engine())
            .with_peer_exchange(peer_exchange.clone())
            .with_mse_dh(mse_dh.clone());
        incoming_config.upload_scheduler = settings.upload_scheduler_config();
        incoming_config.upload_read_jobs = upload_read_jobs;
        incoming_config.handshake_timeout = incoming_handshake_timeout;
        incoming_config.peer_activity_timeout = incoming_peer_activity_timeout;
        incoming_config.keepalive_interval = incoming_keepalive_interval;
        incoming_config.no_request_timeout = incoming_no_request_timeout;
        incoming_config.inactivity_timeout = incoming_inactivity_timeout;
        incoming_config.peer_id = network.peer_id;
        incoming_config.byte_metric_sink = Some(byte_metric_sink.clone());
        incoming_config.mse_handshake_sink = Some(mse_handshake_diagnostics.clone());

        dht.network_policy = network.policy;
        dht.enabled = settings.dht_enabled && (!defer_idle_dht || discovery_demand);
        dht.initial_snapshot = initial_dht_snapshot;
        dht.byte_metric_sink = Some(byte_metric_sink);
        let dht_bind_address = dht.bind_address;
        let socket_config = SessionSocketConfig::new(
            settings.incoming_bootstrap(),
            settings.preferred_listen_port,
            dht.bind_address,
        )
        .with_address_families(requested_address_families);
        let mut listener_failure = None;
        let socket_set = match SessionSocketSet::bind(socket_config).await {
            Ok(sockets) => sockets,
            Err(error) if !matches!(settings.listener, ListenerPolicy::Disabled) => {
                let Some(failure) = classify_session_socket_bind_failure(&error) else {
                    return Err(error.into());
                };
                listener_failure = Some(failure);
                SessionSocketSet::bind(
                    SessionSocketConfig::new(
                        rstorrent_engine::IncomingTcpBootstrap::Disabled,
                        settings.preferred_listen_port,
                        dht.bind_address,
                    )
                    .with_address_families(requested_address_families),
                )
                .await?
            }
            Err(error) => return Err(error.into()),
        };
        if network_cancellation.is_cancelled() {
            return Err(SessionNetworkError::Configuration(
                "network prerequisite generation closed during socket bind".to_owned(),
            ));
        }
        let (ipv4, ipv6) = socket_set.into_families();
        let ipv6_unavailable = ipv6.error().map(ToString::to_string);
        let address_families = if requested_address_families.ipv6_enabled() && ipv6.is_bound() {
            AddressFamilyPolicy::dual_stack()
        } else {
            AddressFamilyPolicy::ipv4_only()
        };
        network = network.with_address_families(address_families);
        let ipv4 = match ipv4 {
            SessionSocketFamilyState::Bound(sockets) => sockets,
            SessionSocketFamilyState::Unavailable(error)
                if !matches!(
                    incoming_config.bootstrap,
                    rstorrent_engine::IncomingTcpBootstrap::Disabled
                ) =>
            {
                let Some(failure) = classify_session_socket_bind_failure(&error) else {
                    return Err(error.into());
                };
                listener_failure = Some(failure);
                let fallback = SessionSocketSet::bind(SessionSocketConfig::new(
                    rstorrent_engine::IncomingTcpBootstrap::Disabled,
                    settings.preferred_listen_port,
                    dht.bind_address,
                ))
                .await?;
                fallback
                    .into_families()
                    .0
                    .into_bound()
                    .expect("IPv4-only fallback binds its IPv4 UDP family")
            }
            SessionSocketFamilyState::Unavailable(error) => return Err(error.into()),
            SessionSocketFamilyState::Disabled => {
                return Err(SessionNetworkError::Configuration(
                    "IPv4 session sockets cannot be disabled".to_owned(),
                ));
            }
        };
        if network_cancellation.is_cancelled() {
            return Err(SessionNetworkError::Configuration(
                "network prerequisite generation closed during fallback bind".to_owned(),
            ));
        }
        let tcp_peer_address = ipv4.tcp_peer_address();
        let udp_address = ipv4.udp_address();
        let coordinated_with_tcp = ipv4.ports_match();
        let (tcp_listener, udp_socket) = ipv4.into_parts();
        let (ipv6_listener, ipv6_udp) = ipv6.into_bound().map_or((None, None), |ipv6| {
            let (listener, udp) = ipv6.into_parts();
            (listener, Some(udp))
        });
        let (mut session_udp, dht_transport) = SessionUdpService::start_with_cancellation(
            udp_socket,
            network_cancellation.child_token(),
        )?;
        if let Some(ipv6_udp) = ipv6_udp {
            session_udp.replace_socket(ipv6_udp).await?;
        }
        let session_udp_handle = session_udp.handle();
        let incoming_runtime = match IncomingPeerRuntime::start_with_cancellation(
            incoming_config,
            network_cancellation.child_token(),
        ) {
            Ok(runtime) => runtime,
            Err(error) => {
                drop(dht_transport);
                let _ = session_udp.shutdown().await;
                return Err(error.into());
            }
        };
        let incoming_ipv6_acceptor = match ipv6_listener {
            Some(listener) => incoming_runtime
                .start_acceptor(
                    settings.incoming_bootstrap(),
                    listener,
                    incoming_handshake_timeout,
                )
                .ok(),
            None => None,
        };
        let (incoming_acceptor, listener_status) = match tcp_listener {
            Some(listener) => match incoming_runtime.start_acceptor(
                settings.incoming_bootstrap(),
                listener,
                incoming_handshake_timeout,
            ) {
                Ok(acceptor) => (
                    Some(acceptor),
                    ListenerStatus::Listening {
                        address: tcp_peer_address
                            .expect("bound TCP listener has an observed address")
                            .ip()
                            .to_string(),
                        port: tcp_peer_address
                            .expect("bound TCP listener has an observed address")
                            .port(),
                    },
                ),
                Err(error) => {
                    drop(dht_transport);
                    let _ = incoming_runtime.shutdown().await;
                    let _ = session_udp.shutdown().await;
                    return Err(error.into());
                }
            },
            None => (None, listener_failure.unwrap_or(ListenerStatus::Disabled)),
        };
        incoming_runtime
            .set_incoming_enabled(incoming_acceptor.is_some() || incoming_ipv6_acceptor.is_some());
        let session_udp_status = SessionUdpStatus::Bound {
            address: udp_address.ip().to_string(),
            port: udp_address.port(),
            coordinated_with_tcp,
        };
        let mut incoming_runtime = Some(incoming_runtime);
        let mut incoming_acceptor = incoming_acceptor;
        let mut incoming_ipv6_acceptor = incoming_ipv6_acceptor;
        let mut session_udp = Some(session_udp);
        let mut session_utp = match peer_transport_policy {
            PeerTransportPolicy::TcpOnly => None,
            PeerTransportPolicy::PreferUtp => {
                let service = match UtpService::start_with_incoming_enabled(
                    session_udp
                        .as_mut()
                        .expect("session UDP exists while starting uTP"),
                    incoming_acceptor.is_some() || incoming_ipv6_acceptor.is_some(),
                ) {
                    Ok(service) => service,
                    Err(error) => {
                        if let Some(acceptor) = incoming_acceptor.take() {
                            let _ = acceptor.shutdown().await;
                        }
                        if let Some(acceptor) = incoming_ipv6_acceptor.take() {
                            let _ = acceptor.shutdown().await;
                        }
                        if let Some(runtime) = incoming_runtime.take() {
                            let _ = runtime.shutdown().await;
                        }
                        if let Some(udp) = session_udp.take() {
                            let _ = udp.shutdown().await;
                        }
                        return Err(error.into());
                    }
                };
                Some(SessionUtpPeerService::start(
                    service,
                    incoming_runtime
                        .as_ref()
                        .expect("incoming runtime exists while starting uTP")
                        .handle(),
                    incoming_handshake_timeout,
                ))
            }
        };
        let utp_handle = session_utp.as_ref().map(SessionUtpPeerService::handle);
        if let Some(handle) = &utp_handle {
            handle.set_incoming_enabled(
                incoming_acceptor.is_some() || incoming_ipv6_acceptor.is_some(),
            );
        }
        let dht = match DhtService::start_with_transport_and_cancellation(
            dht,
            dht_transport,
            network_cancellation.child_token(),
        )
        .await
        {
            Ok(dht) => dht,
            Err(error) => {
                if let Some(acceptor) = incoming_acceptor.take() {
                    let _ = acceptor.shutdown().await;
                }
                if let Some(acceptor) = incoming_ipv6_acceptor.take() {
                    let _ = acceptor.shutdown().await;
                }
                if let Some(utp) = session_utp.take() {
                    let _ = utp.shutdown().await;
                }
                if let Some(runtime) = incoming_runtime.take() {
                    let _ = runtime.shutdown().await;
                }
                if let Some(udp) = session_udp.take() {
                    let _ = udp.shutdown().await;
                }
                return Err(error.into());
            }
        };
        let advertised_endpoint = AdvertisedPeerEndpointSelector::new(&listener_status);
        advertised_endpoint
            .replace_udp_listener(ipv4_udp_endpoint(&session_udp_status, &listener_status));
        advertised_endpoint.replace_ipv6_listener(incoming_ipv6_acceptor.as_ref().and_then(
            |acceptor| match acceptor.listen_address() {
                std::net::SocketAddr::V6(address) => Some(address),
                std::net::SocketAddr::V4(_) => None,
            },
        ));
        let discovery_advertisement =
            DiscoveryAdvertisementService::start_with_https_authentication_and_cancellation(
                network,
                advertised_endpoint.subscribe_wire(),
                dht.handle(),
                settings.tracker_https_authentication(),
                network_cancellation.child_token(),
            )?;
        let initial_tracker_https_authentication = discovery_advertisement
            .initial_https_authentication()
            .map(HttpsServerAuthenticationPolicy::from_engine);
        let initial_tracker_https_application = discovery_advertisement
            .initial_https_error()
            .map_or(ClientSettingsApplicationState::Applied, |detail| {
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TrackerHttpsAuthenticationFailed,
                    detail: detail.to_owned(),
                }
            });
        let discovery_handle = discovery_advertisement.handle();
        let incoming_seeding = IncomingSeeding::new(
            incoming_runtime
                .as_ref()
                .expect("incoming runtime exists after startup")
                .handle(),
        );
        let incoming_handle = incoming_runtime
            .as_ref()
            .expect("incoming runtime exists after startup")
            .handle();
        let listener_active = Arc::new(AtomicBool::new(
            incoming_acceptor.is_some() || incoming_ipv6_acceptor.is_some(),
        ));
        let effective_listener = if matches!(
            listener_status,
            ListenerStatus::Disabled | ListenerStatus::Listening { .. }
        ) {
            Some(EffectiveListenerSettings::from_settings(&settings))
        } else {
            None
        };
        let mut effective_settings = settings.clone();
        effective_settings.ipv6_enabled = address_families.ipv6_enabled();
        effective_settings.dht_enabled =
            settings.dht_enabled && (!defer_idle_dht || discovery_demand);
        effective_settings.peer_exchange_enabled = peer_exchange.load();
        let initial_transport_application = match &listener_status {
            ListenerStatus::BindFailed { detail, .. } => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportBindFailed,
                detail: detail.clone(),
            },
            _ => ipv6_unavailable.map_or(ClientSettingsApplicationState::Applied, |detail| {
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TransportBindFailed,
                    detail,
                }
            }),
        };
        let reachability_evidence = ReachabilityEvidenceProbe::default();
        let bandwidth = SessionBandwidth::start(settings.transfer_limits().into_engine());
        let bandwidth_handle = bandwidth.handle();
        let mut convergence = SettingsConvergenceModel::default();
        let initial_attempt = convergence
            .begin(settings.clone())
            .expect("initial client-settings generation is available");
        let (discovery_demand_sender, discovery_demand_receiver) = watch::channel(discovery_demand);
        let pending_owner = SessionNetworkOwner {
            defer_idle_dht,
            discovery_demand,
            configured_dht_enabled: settings.dht_enabled,
            dht_generation: initial_attempt.domain(SettingsDomain::Dht),
            effective_settings,
            effective_listener,
            listener_status: listener_status.clone(),
            session_udp_status: session_udp_status.clone(),
            dht_bind_address,
            address_families,
            incoming_handshake_timeout,
            network_cancellation: network_cancellation.clone(),
            advertised_endpoint: advertised_endpoint.clone(),
            peer_budget: peer_budget.clone(),
            mse_dh: mse_dh.clone(),
            encryption: encryption.clone(),
            peer_exchange_capable,
            peer_exchange: peer_exchange.clone(),
            incoming_runtime,
            incoming_acceptor,
            incoming_ipv6_acceptor,
            incoming_seeding: incoming_seeding.clone(),
            session_udp,
            session_utp,
            dht: Some(dht),
            dht_observations: None,
            discovery_advertisement: Some(discovery_advertisement),
            reachability: None,
            reachability_evidence: reachability_evidence.clone(),
            listener_active: listener_active.clone(),
            uncertain_mapping: None,
            uncertain_udp_mapping: None,
            uncertain_pinhole: None,
            mapping_runtime_error: None,
            effective_tracker_https_authentication: initial_tracker_https_authentication,
            bandwidth: bandwidth_handle,
        };
        assert!(convergence.apply(
            initial_attempt.domain(SettingsDomain::Transport),
            initial_transport_application.clone(),
        ));
        for domain in [
            SettingsDomain::PortMapping,
            SettingsDomain::PeerConnections,
            SettingsDomain::UploadSlots,
            SettingsDomain::Bandwidth,
            SettingsDomain::Encryption,
            SettingsDomain::Dht,
            SettingsDomain::PeerExchange,
        ] {
            assert!(convergence.apply(
                initial_attempt.domain(domain),
                ClientSettingsApplicationState::Applied,
            ));
        }
        assert!(convergence.apply(
            initial_attempt.domain(SettingsDomain::TrackerHttpsAuthentication),
            initial_tracker_https_application.clone(),
        ));
        let initial_mapping_generation = initial_attempt.domain(SettingsDomain::PortMapping);
        Ok(Self {
            settings,
            effective_peer_connection_limit,
            listener_status,
            session_udp_status,
            advertised_endpoint,
            peer_budget,
            mse_dh,
            encryption,
            peer_exchange,
            mse_handshake_diagnostics,
            incoming_handle,
            incoming_seeding,
            session_udp_handle,
            utp_handle,
            discovery_handle,
            reachability_evidence,
            listener_active,
            pending_owner: Some(pending_owner),
            settings_sender: None,
            discovery_demand_sender,
            discovery_demand_receiver: Some(discovery_demand_receiver),
            reconciliation_cancellation: network_cancellation.child_token(),
            reconciliation_task: None,
            convergence: Arc::new(Mutex::new(convergence)),
            initial_mapping_generation,
            initial_transport_application,
            initial_tracker_https_authentication,
            initial_tracker_https_application,
            views: None,
            bandwidth: Some(bandwidth),
        })
    }

    pub(crate) fn initial_dht_view(&self) -> DhtInspectionView {
        let observations = self
            .pending_owner
            .as_ref()
            .and_then(|owner| owner.dht.as_ref())
            .expect("DHT exists before reconciliation starts")
            .subscribe_observations();
        inspection_view(&observations.borrow())
    }

    pub(crate) fn initial_settings_view(&self) -> ClientSettingsRuntimeView {
        let mut session_udp_status = self.session_udp_status.clone();
        if let SessionUdpStatus::Bound {
            address,
            port,
            coordinated_with_tcp: _,
        } = &mut session_udp_status
        {
            let observed = self.session_udp_handle.local_address();
            *address = observed.ip().to_string();
            *port = observed.port();
        }
        let active = self
            .pending_owner
            .as_ref()
            .expect("session network owner exists before reconciliation")
            .effective_settings
            .clone();
        let mut view = ClientSettingsRuntimeView::from_started(
            self.settings.clone(),
            active,
            self.effective_peer_connection_limit,
            self.listener_status.clone(),
            session_udp_status,
            self.advertised_endpoint.status(Instant::now()),
        );
        let advertised = *self.advertised_endpoint.subscribe_wire().borrow();
        view.transport_families = transport_family_runtime_views(
            if self.settings.ipv6_enabled {
                AddressFamilyPolicy::dual_stack()
            } else {
                AddressFamilyPolicy::ipv4_only()
            },
            &self.listener_status,
            advertised.ipv6.endpoint,
            &self.session_udp_handle,
            advertised,
        );
        view.transport_application = self.initial_transport_application.clone();
        view.ipv6_application = self.initial_transport_application.clone();
        view.effective_tracker_https_server_authentication =
            self.initial_tracker_https_authentication;
        view.tracker_https_authentication_application =
            self.initial_tracker_https_application.clone();
        view.bandwidth = self
            .pending_owner
            .as_ref()
            .expect("session network owner exists before reconciliation")
            .bandwidth
            .snapshot()
            .into();
        view
    }

    pub(crate) fn attach_views(&mut self, views: ViewHub) {
        self.mse_handshake_diagnostics.attach(views.clone());
        views
            .set_client_settings_mapping_generation(self.initial_mapping_generation)
            .expect("view hub accepts initial client-settings generation");
        let observations = self
            .pending_owner
            .as_ref()
            .and_then(|owner| owner.dht.as_ref())
            .expect("DHT exists when views attach")
            .subscribe_observations();
        self.pending_owner
            .as_mut()
            .expect("session network owner exists when views attach")
            .dht_observations = Some(DhtObservationRuntime::start(observations, views.clone()));
        let preferred_port = self.settings.preferred_listen_port.to_string();
        let tcp_endpoint = match &self.listener_status {
            ListenerStatus::Listening { address, port } => format!("{address}:{port}"),
            ListenerStatus::Disabled | ListenerStatus::BindFailed { .. } => "disabled".to_owned(),
        };
        let (udp_endpoint, coordinated) = match &self.session_udp_status {
            SessionUdpStatus::Bound {
                address,
                port,
                coordinated_with_tcp,
            } => (
                format!("{address}:{port}"),
                coordinated_with_tcp.to_string(),
            ),
            SessionUdpStatus::Unavailable => ("unavailable".to_owned(), "false".to_owned()),
        };
        let _ = views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::PEER_CONNECTION,
            "session_listen_sockets_bound",
            None,
            "Session listen sockets resolved to concrete runtime endpoints",
            &[
                ("preferred_port", &preferred_port),
                ("tcp_endpoint", &tcp_endpoint),
                ("udp_endpoint", &udp_endpoint),
                ("coordinated", &coordinated),
            ],
        );
        if let ListenerStatus::BindFailed { reason, detail } = &self.listener_status {
            let reason = match reason {
                ListenerBindFailureReason::AddressInUse => "address_in_use",
                ListenerBindFailureReason::PermissionDenied => "permission_denied",
                ListenerBindFailureReason::AddressUnavailable => "address_unavailable",
                ListenerBindFailureReason::Other => "other",
            };
            let _ = views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::PEER_CONNECTION,
                "incoming_listener_bind_failed",
                None,
                "Incoming listener could not start; settings remain available",
                &[("reason", reason), ("detail", detail)],
            );
        }
        if self.initial_tracker_https_authentication
            == Some(HttpsServerAuthenticationPolicy::Disabled)
        {
            let _ = views.record_diagnostic(
                DiagnosticSeverity::Warning,
                category::TRACKER_ANNOUNCE,
                "tracker_https_authentication_disabled",
                None,
                "HTTPS tracker server authentication is disabled",
                &[("settings_generation", "startup"), ("policy", "disabled")],
            );
        }
        self.views = Some(views);
    }

    pub(crate) fn start_reachability(&mut self, views: ViewHub) {
        let mut owner = self
            .pending_owner
            .take()
            .expect("session network owner starts reconciliation once");
        debug_assert!(owner.reachability.is_none());
        owner.reachability = Some(ReachabilityCoordinator::start(
            &owner.effective_settings,
            &owner.listener_status,
            ReachabilityStartInputs {
                ipv4_udp_listener: ipv4_udp_endpoint(
                    &owner.session_udp_status,
                    &owner.listener_status,
                ),
                ipv6_listener: owner
                    .incoming_ipv6_acceptor
                    .as_ref()
                    .and_then(ipv6_acceptor_address),
                blocks: ReachabilityBlocks::default(),
                evidence: owner.reachability_evidence.clone(),
                cancellation: owner.network_cancellation.clone(),
            },
            views.clone(),
            owner.advertised_endpoint.clone(),
            self.initial_mapping_generation,
        ));
        let (settings_sender, settings_receiver) = watch::channel(None);
        let udp_repairs = owner
            .session_udp
            .as_ref()
            .expect("session UDP exists when reconciliation starts")
            .subscribe_repairs();
        let cancellation = self.reconciliation_cancellation.clone();
        let convergence = self.convergence.clone();
        self.reconciliation_task = Some(tokio::spawn(run_session_network(
            owner,
            settings_receiver,
            self.discovery_demand_receiver
                .take()
                .expect("discovery receiver attaches once"),
            udp_repairs,
            convergence,
            cancellation,
            views,
        )));
        self.settings_sender = Some(settings_sender);
    }

    pub(crate) fn set_discovery_demand(&self, demand: bool) {
        self.discovery_demand_sender.send_if_modified(|current| {
            if *current == demand {
                false
            } else {
                *current = demand;
                true
            }
        });
    }

    pub(crate) fn submit_settings(
        &mut self,
        settings: ClientSettings,
    ) -> Result<(), SessionNetworkError> {
        let attempt = self
            .convergence
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .begin(settings.clone())
            .map_err(|error| SessionNetworkError::Configuration(error.to_string()))?;
        self.views
            .as_ref()
            .expect("views attach before settings submission")
            .begin_client_settings_attempt(attempt.domain(SettingsDomain::PortMapping), settings)
            .map_err(|error| SessionNetworkError::Configuration(error.to_string()))?;
        self.settings_sender
            .as_ref()
            .ok_or_else(|| {
                SessionNetworkError::Configuration("settings reconciler is not running".to_owned())
            })?
            .send_replace(Some(attempt));
        Ok(())
    }

    pub(crate) fn begin_shutdown(&mut self) {
        self.settings_sender.take();
        self.reconciliation_cancellation.cancel();
    }

    pub(crate) fn peer_budget(&self) -> PeerBudget {
        self.peer_budget.clone()
    }

    pub(crate) fn mse_dh(&self) -> MseDhWorkOwner {
        self.mse_dh.clone()
    }

    pub(crate) fn encryption(&self) -> PeerEncryptionPolicyHandle {
        self.encryption.clone()
    }

    pub(crate) fn peer_exchange(&self) -> PeerExchangePolicyHandle {
        self.peer_exchange.clone()
    }

    pub(crate) fn incoming_seeding(&self) -> IncomingSeeding {
        self.incoming_seeding.clone()
    }

    pub(crate) fn incoming_peer_handle(&self) -> IncomingPeerHandle {
        self.incoming_handle.clone()
    }

    pub(crate) fn register_torrent_bandwidth(
        &self,
        limits: TorrentTransferRateLimits,
    ) -> Result<TorrentBandwidth, BandwidthError> {
        self.bandwidth
            .as_ref()
            .ok_or(BandwidthError::Stopped)?
            .register_torrent(limits)
    }

    pub(crate) fn bandwidth_snapshot(&self) -> SessionBandwidthSnapshot {
        self.bandwidth
            .as_ref()
            .map(SessionBandwidth::snapshot)
            .unwrap_or_default()
    }

    pub(crate) fn utp_handle(&self) -> Option<UtpHandle> {
        self.utp_handle.clone()
    }

    pub(crate) fn advertised_endpoint(&self) -> AdvertisedPeerEndpointSelector {
        self.advertised_endpoint.clone()
    }

    pub(crate) fn discovery_handle(&self) -> DiscoveryAdvertisementHandle {
        self.discovery_handle.clone()
    }

    pub(crate) fn incoming_peer_snapshot(&self) -> Option<IncomingPeerServiceSnapshot> {
        self.listener_active
            .load(Ordering::Acquire)
            .then(|| self.incoming_handle.snapshot())
    }

    pub(crate) async fn ipv6_pinhole_packets_for_diagnostics(
        &self,
        deleted: bool,
    ) -> Option<Ipv6PinholeDiagnosticResult> {
        self.reachability_evidence.pinhole_packets(deleted).await
    }

    pub(crate) fn session_udp_snapshot(&self) -> rstorrent_engine::SessionUdpSnapshot {
        self.session_udp_handle.snapshot()
    }

    #[cfg(test)]
    pub(crate) fn session_udp_generation(&self) -> u64 {
        self.session_udp_handle.generation()
    }

    #[cfg(test)]
    pub(crate) fn session_udp_generation_for(&self, family: AddressFamily) -> Option<u64> {
        self.session_udp_handle.generation_for(family)
    }

    #[cfg(test)]
    pub(crate) fn session_udp_local_address_for(
        &self,
        family: AddressFamily,
    ) -> Option<std::net::SocketAddr> {
        self.session_udp_handle.local_address_for(family)
    }

    /// Final shutdown. Tracker `stopped` announces and port-mapping removal
    /// end when `cutoff` is reached.
    pub(crate) async fn shutdown(
        mut self,
        views: &ViewHub,
        cutoff: &CleanupCutoff,
    ) -> SessionNetworkShutdown {
        self.shutdown_inner(views, Some(cutoff)).await
    }

    pub(crate) async fn shutdown_for_network_prerequisite(
        mut self,
        views: &ViewHub,
    ) -> SessionNetworkShutdown {
        self.shutdown_inner(views, None).await
    }

    async fn shutdown_inner(
        &mut self,
        views: &ViewHub,
        cleanup: Option<&CleanupCutoff>,
    ) -> SessionNetworkShutdown {
        self.begin_shutdown();
        let terminal = if let Some(task) = self.reconciliation_task.take() {
            match task.await {
                Ok(owner) => owner.shutdown(views, cleanup).await,
                Err(error) => SessionNetworkShutdown {
                    dht_snapshot: None,
                    dht_error: None,
                    join_error: Some(format!("session network reconciler: {error}")),
                    tracker_stops_cut_short: 0,
                    port_mappings_left: Vec::new(),
                },
            }
        } else {
            self.pending_owner
                .take()
                .expect("pending owner exists before reconciliation starts")
                .shutdown(views, cleanup)
                .await
        };
        if let Some(bandwidth) = self.bandwidth.take() {
            let _ = bandwidth.shutdown().await;
        }
        terminal
    }
}

impl Drop for SessionNetworkRuntime {
    fn drop(&mut self) {
        self.settings_sender.take();
        self.reconciliation_cancellation.cancel();
        if let Some(task) = self.reconciliation_task.take() {
            task.abort();
        }
        self.incoming_seeding.stop();
    }
}

async fn run_session_network(
    mut owner: SessionNetworkOwner,
    mut settings: watch::Receiver<Option<SettingsAttempt>>,
    mut discovery_demand: watch::Receiver<bool>,
    mut udp_repairs: watch::Receiver<Option<SessionUdpRepairRequest>>,
    convergence: Arc<Mutex<SettingsConvergenceModel>>,
    cancellation: CancellationToken,
    views: ViewHub,
) -> SessionNetworkOwner {
    let mut peer_limit_pending = None;
    let mut mapping_expiry_pending: Option<PendingMappingExpiry> = None;
    let mut peer_poll = tokio::time::interval(Duration::from_millis(25));
    peer_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut mapping_poll = tokio::time::interval(Duration::from_millis(100));
    mapping_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut bandwidth_poll = tokio::time::interval(Duration::from_secs(1));
    bandwidth_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            changed = settings.changed() => {
                if changed.is_err() {
                    break;
                }
                let attempt = settings.borrow_and_update().clone();
                if let Some(attempt) = attempt {
                    (peer_limit_pending, mapping_expiry_pending) = owner
                        .reconcile(attempt, &convergence, &views, &cancellation)
                        .await;
                }
            }
            changed = discovery_demand.changed() => {
                if changed.is_err() { break; }
                owner.discovery_demand = *discovery_demand.borrow_and_update();
                owner.reconcile_discovery_demand(&convergence, &views).await;
            }
            changed = udp_repairs.changed() => {
                if changed.is_err() {
                    break;
                }
                let request = {
                    let current = udp_repairs.borrow_and_update();
                    *current
                };
                if let Some(request) = request {
                    match owner
                        .session_udp
                        .as_mut()
                        .expect("session UDP exists during policy repair")
                        .repair_fragmentation_policy(request)
                        .await
                    {
                        Ok(true) => {
                            let generation = owner
                                .session_udp
                                .as_ref()
                                .and_then(|udp| udp.generation_for(request.family))
                                .map_or_else(|| "unavailable".to_owned(), |value| value.to_string());
                            let _ = views.record_diagnostic(
                                DiagnosticSeverity::Warning,
                                category::PEER_CONNECTION,
                                "session_udp_fragmentation_policy_repaired",
                                None,
                                "A contaminated UDP socket generation was retired and rebound",
                                &[
                                    ("family", &request.family.to_string()),
                                    ("retired_generation", &request.generation.to_string()),
                                    ("replacement_generation", &generation),
                                ],
                            );
                        }
                        Ok(false) => {}
                        Err(error) => {
                            let _ = views.record_diagnostic(
                                DiagnosticSeverity::Error,
                                category::PEER_CONNECTION,
                                "session_udp_fragmentation_policy_repair_failed",
                                None,
                                "A contaminated UDP socket generation was retired but could not be rebound",
                                &[
                                    ("family", &request.family.to_string()),
                                    ("retired_generation", &request.generation.to_string()),
                                    ("detail", &error.to_string()),
                                ],
                            );
                        }
                    }
                }
            }
            _ = peer_poll.tick(), if peer_limit_pending.is_some() => {
                let pending = peer_limit_pending.expect("guarded pending generation");
                if !is_current(&convergence, pending.generation) {
                    peer_limit_pending = None;
                } else if owner.peer_budget.within_absolute_limit() {
                    publish_peer_connections(
                        &convergence,
                        pending.generation,
                        owner.peer_budget.snapshot().effective_limit,
                        ClientSettingsApplicationState::Applied,
                        &views,
                    );
                    peer_limit_pending = None;
                } else if tokio::time::Instant::now() >= pending.deadline {
                    publish_peer_connections(
                        &convergence,
                        pending.generation,
                        owner.peer_budget.snapshot().effective_limit,
                        ClientSettingsApplicationState::Degraded {
                            reason: ClientSettingsDegradedReason::PeerConnectionConvergenceFailed,
                            detail: "peer owners did not release cancelled permits before the convergence deadline".to_owned(),
                        },
                        &views,
                    );
                    peer_limit_pending = None;
                }
            }
            _ = mapping_poll.tick(), if mapping_expiry_pending.is_some() => {
                let pending = mapping_expiry_pending
                    .as_ref()
                    .expect("guarded pending mapping expiry");
                let generation = pending.attempt.domain(SettingsDomain::PortMapping);
                if !is_current(&convergence, generation) {
                    mapping_expiry_pending = None;
                } else if Instant::now() >= pending.deadline {
                    let attempt = pending.attempt.clone();
                    mapping_expiry_pending = owner
                        .reconcile_mapping(&attempt, false, &convergence, &views)
                        .await
                        .map(|deadline| PendingMappingExpiry { attempt, deadline });
                }
            }
            _ = bandwidth_poll.tick() => {
                let _ = views.set_bandwidth_runtime(owner.bandwidth.snapshot().into());
            }
        }
    }
    owner
}

impl SessionNetworkOwner {
    fn transport_family_views(
        &self,
        configured_policy: AddressFamilyPolicy,
    ) -> Vec<TransportFamilyRuntimeView> {
        let advertised = *self.advertised_endpoint.subscribe_wire().borrow();
        let udp = self
            .session_udp
            .as_ref()
            .expect("session UDP exists while projecting transport")
            .handle();
        transport_family_runtime_views(
            configured_policy,
            &self.listener_status,
            self.incoming_ipv6_acceptor.as_ref().and_then(|acceptor| {
                acceptor
                    .listen_address()
                    .is_ipv6()
                    .then(|| acceptor.listen_address())
            }),
            &udp,
            advertised,
        )
    }

    fn record_reachability_shutdown(
        &mut self,
        result: Result<ReachabilityGenerationShutdown, String>,
    ) {
        match result {
            Ok(shutdown) => {
                debug_assert_eq!(shutdown.terminal, Default::default());
                if let Some(error) = shutdown.error {
                    self.mapping_runtime_error = Some(error);
                }
                if let Some(uncertain_mapping) = shutdown.uncertain_tcp_mapping {
                    self.uncertain_mapping = Some(uncertain_mapping);
                }
                if let Some(uncertain_mapping) = shutdown.uncertain_udp_mapping {
                    self.uncertain_udp_mapping = Some(uncertain_mapping);
                }
                if let Some(uncertain_pinhole) = shutdown.uncertain_pinhole {
                    self.uncertain_pinhole = Some(uncertain_pinhole);
                }
            }
            Err(error) => self.mapping_runtime_error = Some(error),
        }
    }

    async fn reconcile(
        &mut self,
        attempt: SettingsAttempt,
        convergence: &Arc<Mutex<SettingsConvergenceModel>>,
        views: &ViewHub,
        cancellation: &CancellationToken,
    ) -> (Option<PendingPeerLimit>, Option<PendingMappingExpiry>) {
        let tracker_https_generation = attempt.domain(SettingsDomain::TrackerHttpsAuthentication);
        let tracker_https_state = self
            .discovery_advertisement
            .as_ref()
            .expect("discovery advertisement exists during reconciliation")
            .handle()
            .replace_https_authentication(attempt.settings.tracker_https_authentication())
            .await;
        match tracker_https_state {
            Ok(()) => {
                let effective = attempt.settings.tracker_https_server_authentication;
                self.effective_settings.tracker_https_server_authentication = effective;
                self.effective_tracker_https_authentication = Some(effective);
                publish_tracker_https_authentication(
                    convergence,
                    tracker_https_generation,
                    self.effective_tracker_https_authentication,
                    ClientSettingsApplicationState::Applied,
                    views,
                );
                if effective == HttpsServerAuthenticationPolicy::Disabled {
                    let generation = tracker_https_generation.attempt().to_string();
                    let _ = views.record_diagnostic(
                        DiagnosticSeverity::Warning,
                        category::TRACKER_ANNOUNCE,
                        "tracker_https_authentication_disabled",
                        None,
                        "HTTPS tracker server authentication is disabled",
                        &[("settings_generation", &generation), ("policy", "disabled")],
                    );
                }
            }
            Err(error) => publish_tracker_https_authentication(
                convergence,
                tracker_https_generation,
                self.effective_tracker_https_authentication,
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TrackerHttpsAuthenticationFailed,
                    detail: error.to_string(),
                },
                views,
            ),
        }

        let peer_generation = attempt.domain(SettingsDomain::PeerConnections);
        let peer = self.peer_budget.reconfigure(
            usize::try_from(attempt.settings.peer_connection_limit)
                .expect("validated peer limit fits usize"),
        );
        self.effective_settings.peer_connection_limit = attempt.settings.peer_connection_limit;
        let peer_state = if peer.within_limit {
            ClientSettingsApplicationState::Applied
        } else {
            ClientSettingsApplicationState::Applying
        };
        publish_peer_connections(
            convergence,
            peer_generation,
            peer.effective_limit,
            peer_state,
            views,
        );

        let upload_generation = attempt.domain(SettingsDomain::UploadSlots);
        self.incoming_runtime
            .as_ref()
            .expect("incoming runtime exists during reconciliation")
            .reconfigure_upload_slots(usize::from(attempt.settings.upload_slots));
        self.effective_settings.upload_slots = attempt.settings.upload_slots;
        if apply_state(
            convergence,
            upload_generation,
            ClientSettingsApplicationState::Applied,
        )
        .is_some()
        {
            let slots = attempt.settings.upload_slots;
            let _ = views.update_client_settings_runtime_for(upload_generation, |runtime| {
                runtime.effective_upload_slots = slots;
                runtime.upload_slots_application = ClientSettingsApplicationState::Applied;
            });
        }

        let bandwidth_generation = attempt.domain(SettingsDomain::Bandwidth);
        let limits = attempt.settings.transfer_limits();
        self.bandwidth.set_session_limits(limits.into_engine());
        self.effective_settings.upload_rate_limit = limits.upload;
        self.effective_settings.download_rate_limit = limits.download;
        if apply_state(
            convergence,
            bandwidth_generation,
            ClientSettingsApplicationState::Applied,
        )
        .is_some()
        {
            let _ = views.update_client_settings_runtime_for(bandwidth_generation, |runtime| {
                runtime.effective_upload_rate_limit = limits.upload;
                runtime.effective_download_rate_limit = limits.download;
                runtime.bandwidth_application = ClientSettingsApplicationState::Applied;
                runtime.bandwidth = self.bandwidth.snapshot().into();
            });
        }

        let encryption_generation = attempt.domain(SettingsDomain::Encryption);
        let encryption_policy = attempt.settings.encryption.into_engine();
        let encryption_state = self
            .discovery_advertisement
            .as_ref()
            .expect("discovery advertisement exists during reconciliation")
            .handle()
            .replace_encryption_policy(encryption_policy)
            .await;
        match encryption_state {
            Ok(()) => {
                self.encryption.replace(encryption_policy);
                self.incoming_runtime
                    .as_ref()
                    .expect("incoming runtime exists during reconciliation")
                    .reconfigure_encryption(encryption_policy);
                self.effective_settings.encryption = attempt.settings.encryption;
                publish_encryption(
                    convergence,
                    encryption_generation,
                    attempt.settings.encryption,
                    ClientSettingsApplicationState::Applied,
                    views,
                );
            }
            Err(error) => publish_encryption(
                convergence,
                encryption_generation,
                self.effective_settings.encryption,
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::RuntimeStopped,
                    detail: error.to_string(),
                },
                views,
            ),
        }

        let dht_generation = attempt.domain(SettingsDomain::Dht);
        self.dht_generation = dht_generation;
        self.configured_dht_enabled = attempt.settings.dht_enabled;
        let effective_dht_enabled =
            self.configured_dht_enabled && (!self.defer_idle_dht || self.discovery_demand);
        let dht_state = self
            .dht
            .as_ref()
            .expect("DHT exists during reconciliation")
            .handle()
            .set_enabled(effective_dht_enabled)
            .await;
        match dht_state {
            Ok(()) => {
                self.effective_settings.dht_enabled = effective_dht_enabled;
                if apply_state(
                    convergence,
                    dht_generation,
                    ClientSettingsApplicationState::Applied,
                )
                .is_some()
                {
                    let enabled = effective_dht_enabled;
                    let _ = views.update_client_settings_runtime_for(dht_generation, |runtime| {
                        runtime.effective_dht_enabled = enabled;
                        runtime.dht_application = ClientSettingsApplicationState::Applied;
                    });
                }
            }
            Err(error) => {
                let state = ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::RuntimeStopped,
                    detail: error.to_string(),
                };
                if apply_state(convergence, dht_generation, state.clone()).is_some() {
                    let effective = self.effective_settings.dht_enabled;
                    let _ = views.update_client_settings_runtime_for(dht_generation, |runtime| {
                        runtime.effective_dht_enabled = effective;
                        runtime.dht_application = state;
                    });
                }
            }
        }

        let peer_exchange_generation = attempt.domain(SettingsDomain::PeerExchange);
        let peer_exchange_enabled =
            self.peer_exchange_capable && attempt.settings.peer_exchange_enabled;
        self.peer_exchange.replace(peer_exchange_enabled);
        self.effective_settings.peer_exchange_enabled = peer_exchange_enabled;
        if apply_state(
            convergence,
            peer_exchange_generation,
            ClientSettingsApplicationState::Applied,
        )
        .is_some()
        {
            let enabled = peer_exchange_enabled;
            let _ = views.update_client_settings_runtime_for(peer_exchange_generation, |runtime| {
                runtime.effective_peer_exchange_enabled = enabled;
                runtime.peer_exchange_application = ClientSettingsApplicationState::Applied;
            });
        }

        let transport_changed = self
            .reconcile_transport(&attempt, convergence, views, cancellation)
            .await;
        let mapping_expiry = self
            .reconcile_mapping(&attempt, transport_changed, convergence, views)
            .await;
        let peer_limit = (!peer.within_limit).then(|| PendingPeerLimit {
            generation: peer_generation,
            deadline: tokio::time::Instant::now() + PEER_RECONFIGURATION_TIMEOUT,
        });
        let mapping_expiry =
            mapping_expiry.map(|deadline| PendingMappingExpiry { attempt, deadline });
        (peer_limit, mapping_expiry)
    }

    async fn reconcile_discovery_demand(
        &mut self,
        convergence: &Arc<Mutex<SettingsConvergenceModel>>,
        views: &ViewHub,
    ) {
        if !self.defer_idle_dht {
            return;
        }
        let enabled = self.configured_dht_enabled && self.discovery_demand;
        let outcome = self
            .dht
            .as_ref()
            .expect("DHT owner exists")
            .handle()
            .set_enabled(enabled)
            .await;
        let state = match outcome {
            Ok(()) => {
                self.effective_settings.dht_enabled = enabled;
                ClientSettingsApplicationState::Applied
            }
            Err(error) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::RuntimeStopped,
                detail: error.to_string(),
            },
        };
        if apply_state(convergence, self.dht_generation, state.clone()).is_none() {
            return;
        }
        let effective = self.effective_settings.dht_enabled;
        let _ = views.update_client_settings_runtime_for(self.dht_generation, |runtime| {
            runtime.effective_dht_enabled = effective;
            runtime.dht_application = state;
        });
    }

    async fn reconcile_transport(
        &mut self,
        attempt: &SettingsAttempt,
        convergence: &Arc<Mutex<SettingsConvergenceModel>>,
        views: &ViewHub,
        cancellation: &CancellationToken,
    ) -> bool {
        let generation = attempt.domain(SettingsDomain::Transport);
        let desired = EffectiveListenerSettings::from_settings(&attempt.settings);
        let desired_address_families = if attempt.settings.ipv6_enabled {
            AddressFamilyPolicy::dual_stack()
        } else {
            AddressFamilyPolicy::ipv4_only()
        };
        let transport_families = self.transport_family_views(desired_address_families);
        let _ = views.update_client_settings_runtime_for(generation, |runtime| {
            runtime.transport_families = transport_families;
        });
        if matches!(desired.listener, ListenerPolicy::Disabled) {
            let incoming_changed =
                !matches!(self.effective_settings.listener, ListenerPolicy::Disabled)
                    || !matches!(self.listener_status, ListenerStatus::Disabled);
            let runtime = self
                .incoming_runtime
                .as_ref()
                .expect("incoming owner exists");
            if incoming_changed {
                runtime.disable_listener();
            }
            if let Some(utp) = &self.session_utp {
                utp.handle().set_incoming_enabled(false);
            }
            self.listener_active.store(false, Ordering::Release);
            self.advertised_endpoint
                .replace_listener(&ListenerStatus::Disabled);
            self.advertised_endpoint.replace_udp_listener(None);
            self.advertised_endpoint.replace_ipv6_listener(None);
            let _ =
                views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
            let mut failure = None;
            for acceptor in [
                self.incoming_acceptor.take(),
                self.incoming_ipv6_acceptor.take(),
            ]
            .into_iter()
            .flatten()
            {
                if let Err(error) = acceptor.shutdown().await {
                    failure = Some(error.to_string());
                }
            }
            let handle = runtime.handle();
            if tokio::time::timeout(PEER_RECONFIGURATION_TIMEOUT, async {
                loop {
                    let snapshot = handle.snapshot();
                    if snapshot.pending == 0 && snapshot.established == 0 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .is_err()
            {
                failure = Some("Incoming peers did not stop within five seconds".into());
            }
            self.listener_status = ListenerStatus::Disabled;
            if let SessionUdpStatus::Bound {
                coordinated_with_tcp,
                ..
            } = &mut self.session_udp_status
            {
                *coordinated_with_tcp = false;
            }
            self.effective_listener = Some(desired.clone());
            self.effective_settings.listener = desired.listener;
            self.effective_settings.preferred_listen_port = desired.preferred_listen_port;
            publish_transport(
                convergence,
                generation,
                Some(desired),
                self.listener_status.clone(),
                self.session_udp_status.clone(),
                self.advertised_endpoint.status(Instant::now()),
                self.address_families.ipv6_enabled(),
                failure.map_or(ClientSettingsApplicationState::Applied, |detail| {
                    ClientSettingsApplicationState::Degraded {
                        reason: ClientSettingsDegradedReason::TransportBindFailed,
                        detail,
                    }
                }),
                views,
            );
            // Port preference changes while Off do not disrupt outgoing sockets.
            // A simultaneous family change retains the existing family owner path.
            if self.address_families != desired_address_families {
                self.reconcile_address_families_only(
                    attempt,
                    generation,
                    EffectiveListenerSettings::from_settings(&attempt.settings),
                    desired_address_families,
                    convergence,
                    views,
                    cancellation,
                )
                .await;
            }
            return incoming_changed;
        }
        let transport_rebind_required = transport_rebind_required(
            self.effective_listener.as_ref(),
            &desired,
            &self.listener_status,
        );
        if self.address_families == desired_address_families && !transport_rebind_required {
            self.effective_listener = Some(desired.clone());
            self.effective_settings.listener = desired.listener;
            self.effective_settings.preferred_listen_port = desired.preferred_listen_port;
            self.effective_settings.ipv6_enabled = attempt.settings.ipv6_enabled;
            publish_transport(
                convergence,
                generation,
                Some(desired),
                self.listener_status.clone(),
                self.session_udp_status.clone(),
                self.advertised_endpoint.status(Instant::now()),
                self.address_families.ipv6_enabled(),
                ClientSettingsApplicationState::Applied,
                views,
            );
            return false;
        }
        if self.address_families != desired_address_families && !transport_rebind_required {
            self.reconcile_address_families_only(
                attempt,
                generation,
                desired,
                desired_address_families,
                convergence,
                views,
                cancellation,
            )
            .await;
            return false;
        }

        let candidate = SessionSocketSet::bind(
            SessionSocketConfig::new(
                attempt.settings.incoming_bootstrap(),
                attempt.settings.preferred_listen_port,
                self.dht_bind_address,
            )
            .with_address_families(desired_address_families),
        )
        .await;
        let candidate = match candidate {
            Ok(candidate) => candidate,
            Err(error) => {
                publish_transport(
                    convergence,
                    generation,
                    self.effective_listener.clone(),
                    self.listener_status.clone(),
                    self.session_udp_status.clone(),
                    self.advertised_endpoint.status(Instant::now()),
                    self.address_families.ipv6_enabled(),
                    ClientSettingsApplicationState::Degraded {
                        reason: ClientSettingsDegradedReason::TransportBindFailed,
                        detail: error.to_string(),
                    },
                    views,
                );
                return false;
            }
        };
        if cancellation.is_cancelled() || !is_current(convergence, generation) {
            return false;
        }

        let (ipv4, ipv6) = candidate.into_families();
        let ipv4 = match ipv4 {
            SessionSocketFamilyState::Bound(sockets) => sockets,
            SessionSocketFamilyState::Unavailable(error) => {
                publish_transport(
                    convergence,
                    generation,
                    self.effective_listener.clone(),
                    self.listener_status.clone(),
                    self.session_udp_status.clone(),
                    self.advertised_endpoint.status(Instant::now()),
                    self.address_families.ipv6_enabled(),
                    ClientSettingsApplicationState::Degraded {
                        reason: ClientSettingsDegradedReason::TransportBindFailed,
                        detail: error.to_string(),
                    },
                    views,
                );
                return false;
            }
            SessionSocketFamilyState::Disabled => {
                publish_transport(
                    convergence,
                    generation,
                    self.effective_listener.clone(),
                    self.listener_status.clone(),
                    self.session_udp_status.clone(),
                    self.advertised_endpoint.status(Instant::now()),
                    self.address_families.ipv6_enabled(),
                    ClientSettingsApplicationState::Degraded {
                        reason: ClientSettingsDegradedReason::TransportBindFailed,
                        detail: "IPv4 session sockets cannot be disabled".to_owned(),
                    },
                    views,
                );
                return false;
            }
        };
        let tcp_peer_address = ipv4.tcp_peer_address();
        let udp_address = ipv4.udp_address();
        let coordinated_with_tcp = ipv4.ports_match();
        let (tcp_listener, udp_socket) = ipv4.into_parts();
        let (ipv6_listener, ipv6_udp, mut ipv6_error) = match ipv6 {
            SessionSocketFamilyState::Bound(sockets) => {
                let (listener, udp) = sockets.into_parts();
                (listener, Some(udp), None)
            }
            SessionSocketFamilyState::Disabled => (None, None, None),
            SessionSocketFamilyState::Unavailable(error) => (None, None, Some(error.to_string())),
        };
        self.advertised_endpoint
            .replace_listener(&ListenerStatus::Disabled);
        self.advertised_endpoint.replace_udp_listener(None);
        self.advertised_endpoint.replace_ipv6_listener(None);
        let _ = views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
        if let Some(reachability) = self.reachability.take() {
            self.record_reachability_shutdown(reachability.shutdown_generation().await);
        }
        if cancellation.is_cancelled() || !is_current(convergence, generation) {
            self.advertised_endpoint
                .replace_listener(&self.listener_status);
            self.advertised_endpoint
                .replace_udp_listener(ipv4_udp_endpoint(
                    &self.session_udp_status,
                    &self.listener_status,
                ));
            self.advertised_endpoint.replace_ipv6_listener(
                self.incoming_ipv6_acceptor
                    .as_ref()
                    .and_then(ipv6_acceptor_address),
            );
            let _ =
                views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
            self.reachability = Some(ReachabilityCoordinator::start(
                &self.effective_settings,
                &self.listener_status,
                ReachabilityStartInputs {
                    ipv4_udp_listener: ipv4_udp_endpoint(
                        &self.session_udp_status,
                        &self.listener_status,
                    ),
                    ipv6_listener: self
                        .incoming_ipv6_acceptor
                        .as_ref()
                        .and_then(ipv6_acceptor_address),
                    blocks: ReachabilityBlocks {
                        tcp_mapping: self.uncertain_mapping.is_some(),
                        udp_mapping: self.uncertain_udp_mapping.is_some(),
                        pinhole: self.uncertain_pinhole.is_some(),
                    },
                    evidence: self.reachability_evidence.clone(),
                    cancellation: self.network_cancellation.clone(),
                },
                views.clone(),
                self.advertised_endpoint.clone(),
                attempt.domain(SettingsDomain::PortMapping),
            ));
            return false;
        }

        let candidate_ipv6_acceptor = match ipv6_listener {
            Some(listener) => match self
                .incoming_runtime
                .as_ref()
                .expect("incoming runtime exists during IPv6 handover")
                .start_acceptor(
                    attempt.settings.incoming_bootstrap(),
                    listener,
                    self.incoming_handshake_timeout,
                ) {
                Ok(acceptor) => Some(acceptor),
                Err(error) => {
                    ipv6_error = Some(error.to_string());
                    None
                }
            },
            None => None,
        };
        let candidate_acceptor = match tcp_listener {
            Some(listener) => match self
                .incoming_runtime
                .as_ref()
                .expect("incoming runtime exists during handover")
                .start_acceptor(
                    attempt.settings.incoming_bootstrap(),
                    listener,
                    self.incoming_handshake_timeout,
                ) {
                Ok(acceptor) => Some(acceptor),
                Err(error) => {
                    self.advertised_endpoint
                        .replace_listener(&self.listener_status);
                    self.advertised_endpoint
                        .replace_udp_listener(ipv4_udp_endpoint(
                            &self.session_udp_status,
                            &self.listener_status,
                        ));
                    self.advertised_endpoint.replace_ipv6_listener(
                        self.incoming_ipv6_acceptor
                            .as_ref()
                            .and_then(ipv6_acceptor_address),
                    );
                    if let Some(acceptor) = candidate_ipv6_acceptor {
                        let _ = acceptor.shutdown().await;
                    }
                    let _ = views.set_advertised_peer_endpoint(
                        self.advertised_endpoint.status(Instant::now()),
                    );
                    self.reachability = Some(ReachabilityCoordinator::start(
                        &self.effective_settings,
                        &self.listener_status,
                        ReachabilityStartInputs {
                            ipv4_udp_listener: ipv4_udp_endpoint(
                                &self.session_udp_status,
                                &self.listener_status,
                            ),
                            ipv6_listener: self
                                .incoming_ipv6_acceptor
                                .as_ref()
                                .and_then(ipv6_acceptor_address),
                            blocks: ReachabilityBlocks {
                                tcp_mapping: self.uncertain_mapping.is_some(),
                                udp_mapping: self.uncertain_udp_mapping.is_some(),
                                pinhole: self.uncertain_pinhole.is_some(),
                            },
                            evidence: self.reachability_evidence.clone(),
                            cancellation: self.network_cancellation.clone(),
                        },
                        views.clone(),
                        self.advertised_endpoint.clone(),
                        attempt.domain(SettingsDomain::PortMapping),
                    ));
                    publish_transport(
                        convergence,
                        generation,
                        self.effective_listener.clone(),
                        self.listener_status.clone(),
                        self.session_udp_status.clone(),
                        self.advertised_endpoint.status(Instant::now()),
                        self.address_families.ipv6_enabled(),
                        ClientSettingsApplicationState::Degraded {
                            reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                            detail: error.to_string(),
                        },
                        views,
                    );
                    return false;
                }
            },
            None => None,
        };

        let udp_result = self
            .session_udp
            .as_mut()
            .expect("session UDP exists during handover")
            .replace_socket(udp_socket)
            .await;
        let ipv6_udp_result = match ipv6_udp {
            Some(ipv6_udp) => {
                self.session_udp
                    .as_mut()
                    .expect("session UDP exists during handover")
                    .replace_socket(ipv6_udp)
                    .await
            }
            None => {
                self.session_udp
                    .as_mut()
                    .expect("session UDP exists during handover")
                    .remove_family(AddressFamily::Ipv6)
                    .await
            }
        };
        let listener_status = tcp_peer_address.map_or(ListenerStatus::Disabled, |address| {
            ListenerStatus::Listening {
                address: address.ip().to_string(),
                port: address.port(),
            }
        });
        let session_udp_status = SessionUdpStatus::Bound {
            address: udp_address.ip().to_string(),
            port: udp_address.port(),
            coordinated_with_tcp,
        };
        let previous_acceptor = std::mem::replace(&mut self.incoming_acceptor, candidate_acceptor);
        let previous_ipv6_acceptor =
            std::mem::replace(&mut self.incoming_ipv6_acceptor, candidate_ipv6_acceptor);
        if self.incoming_acceptor.is_none() && self.incoming_ipv6_acceptor.is_none() {
            self.incoming_runtime
                .as_ref()
                .expect("incoming runtime exists during listener disable")
                .disable_listener();
        }
        let incoming_enabled =
            self.incoming_acceptor.is_some() || self.incoming_ipv6_acceptor.is_some();
        self.incoming_runtime
            .as_ref()
            .expect("incoming owner exists")
            .set_incoming_enabled(incoming_enabled);
        if let Some(utp) = &self.session_utp {
            utp.handle().set_incoming_enabled(incoming_enabled);
        }
        self.listener_active.store(
            self.incoming_acceptor.is_some() || self.incoming_ipv6_acceptor.is_some(),
            Ordering::Release,
        );
        self.listener_status = listener_status;
        self.session_udp_status = session_udp_status;
        self.effective_listener = Some(desired.clone());
        self.effective_settings.listener = desired.listener;
        self.effective_settings.preferred_listen_port = desired.preferred_listen_port;
        self.effective_settings.ipv6_enabled = attempt.settings.ipv6_enabled;
        self.address_families = desired_address_families;
        self.advertised_endpoint
            .replace_listener(&self.listener_status);
        self.advertised_endpoint
            .replace_udp_listener(ipv4_udp_endpoint(
                &self.session_udp_status,
                &self.listener_status,
            ));
        self.advertised_endpoint.replace_ipv6_listener(
            self.incoming_ipv6_acceptor
                .as_ref()
                .and_then(ipv6_acceptor_address),
        );
        if let Some(acceptor) = previous_acceptor
            && let Err(error) = acceptor.shutdown().await
        {
            let detail = format!("retire previous incoming acceptor: {error}");
            publish_transport(
                convergence,
                generation,
                Some(desired),
                self.listener_status.clone(),
                self.session_udp_status.clone(),
                self.advertised_endpoint.status(Instant::now()),
                self.address_families.ipv6_enabled(),
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                    detail,
                },
                views,
            );
            return true;
        }
        if let Some(acceptor) = previous_ipv6_acceptor
            && let Err(error) = acceptor.shutdown().await
        {
            ipv6_error = Some(format!("retire previous IPv6 incoming acceptor: {error}"));
        }
        let dht_result = self
            .dht
            .as_ref()
            .expect("DHT exists during transport handover")
            .handle()
            .reconcile_transport()
            .await;
        let address_family_result = self
            .discovery_advertisement
            .as_ref()
            .expect("discovery advertisement exists during transport handover")
            .handle()
            .replace_address_family_policy(desired_address_families)
            .await;
        let state = match (
            udp_result,
            ipv6_udp_result,
            ipv6_error,
            dht_result,
            address_family_result,
        ) {
            (Ok(()), Ok(()), None, Ok(()), Ok(())) => ClientSettingsApplicationState::Applied,
            (_, _, Some(detail), _, _) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                detail,
            },
            (Err(error), _, None, _, _) | (_, Err(error), None, _, _) => {
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                    detail: format!("retire previous UDP generation: {error}"),
                }
            }
            (Ok(()), Ok(()), None, Err(error), _) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                detail: format!("reconcile DHT address families: {error}"),
            },
            (Ok(()), Ok(()), None, Ok(()), Err(error)) => {
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                    detail: format!("apply address-family policy: {error}"),
                }
            }
        };
        publish_transport(
            convergence,
            generation,
            Some(desired),
            self.listener_status.clone(),
            self.session_udp_status.clone(),
            self.advertised_endpoint.status(Instant::now()),
            desired_address_families.ipv6_enabled(),
            state,
            views,
        );
        let transport_families = self.transport_family_views(desired_address_families);
        let _ = views.update_client_settings_runtime_for(generation, |runtime| {
            runtime.transport_families = transport_families;
        });
        true
    }

    #[allow(clippy::too_many_arguments)]
    async fn reconcile_address_families_only(
        &mut self,
        attempt: &SettingsAttempt,
        generation: SettingsDomainGeneration,
        desired: EffectiveListenerSettings,
        desired_address_families: AddressFamilyPolicy,
        convergence: &Arc<Mutex<SettingsConvergenceModel>>,
        views: &ViewHub,
        cancellation: &CancellationToken,
    ) {
        let mut retirement_error = None;
        if desired_address_families.ipv6_enabled() {
            let sockets = SessionSocketFamilySet::bind(
                SessionSocketConfig::new(
                    attempt.settings.incoming_bootstrap(),
                    attempt.settings.preferred_listen_port,
                    self.dht_bind_address,
                )
                .with_address_families(desired_address_families),
                AddressFamily::Ipv6,
            )
            .await;
            let sockets = match sockets {
                Ok(sockets) => sockets,
                Err(error) => {
                    publish_transport(
                        convergence,
                        generation,
                        self.effective_listener.clone(),
                        self.listener_status.clone(),
                        self.session_udp_status.clone(),
                        self.advertised_endpoint.status(Instant::now()),
                        self.address_families.ipv6_enabled(),
                        ClientSettingsApplicationState::Degraded {
                            reason: ClientSettingsDegradedReason::TransportBindFailed,
                            detail: error.to_string(),
                        },
                        views,
                    );
                    return;
                }
            };
            let (listener, udp) = sockets.into_parts();
            let candidate_acceptor = match listener {
                Some(listener) => match self
                    .incoming_runtime
                    .as_ref()
                    .expect("incoming runtime exists during IPv6 handover")
                    .start_acceptor(
                        attempt.settings.incoming_bootstrap(),
                        listener,
                        self.incoming_handshake_timeout,
                    ) {
                    Ok(acceptor) => Some(acceptor),
                    Err(error) => {
                        publish_transport(
                            convergence,
                            generation,
                            self.effective_listener.clone(),
                            self.listener_status.clone(),
                            self.session_udp_status.clone(),
                            self.advertised_endpoint.status(Instant::now()),
                            self.address_families.ipv6_enabled(),
                            ClientSettingsApplicationState::Degraded {
                                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                                detail: error.to_string(),
                            },
                            views,
                        );
                        return;
                    }
                },
                None => None,
            };
            if cancellation.is_cancelled() || !is_current(convergence, generation) {
                if let Some(acceptor) = candidate_acceptor {
                    let _ = acceptor.shutdown().await;
                }
                return;
            }
            if let Err(error) = self
                .session_udp
                .as_mut()
                .expect("session UDP exists during IPv6 handover")
                .replace_socket(udp)
                .await
            {
                if let Some(acceptor) = candidate_acceptor {
                    let _ = acceptor.shutdown().await;
                }
                publish_transport(
                    convergence,
                    generation,
                    self.effective_listener.clone(),
                    self.listener_status.clone(),
                    self.session_udp_status.clone(),
                    self.advertised_endpoint.status(Instant::now()),
                    self.address_families.ipv6_enabled(),
                    ClientSettingsApplicationState::Degraded {
                        reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                        detail: format!("replace IPv6 UDP generation: {error}"),
                    },
                    views,
                );
                return;
            }
            let previous = std::mem::replace(&mut self.incoming_ipv6_acceptor, candidate_acceptor);
            if let Some(previous) = previous
                && let Err(error) = previous.shutdown().await
            {
                retirement_error = Some(format!("retire previous IPv6 acceptor: {error}"));
            }
        } else {
            self.advertised_endpoint.replace_ipv6_listener(None);
            let _ =
                views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
            if let Some(previous) = self.incoming_ipv6_acceptor.take()
                && let Err(error) = previous.shutdown().await
            {
                retirement_error = Some(format!("retire IPv6 acceptor: {error}"));
            }
            if let Err(error) = self
                .session_udp
                .as_mut()
                .expect("session UDP exists during IPv6 handover")
                .remove_family(AddressFamily::Ipv6)
                .await
            {
                retirement_error = Some(format!("retire IPv6 UDP generation: {error}"));
            }
        }

        self.address_families = desired_address_families;
        self.effective_settings.ipv6_enabled = desired_address_families.ipv6_enabled();
        self.advertised_endpoint.replace_ipv6_listener(
            self.incoming_ipv6_acceptor
                .as_ref()
                .and_then(ipv6_acceptor_address),
        );
        let dht_result = self
            .dht
            .as_ref()
            .expect("DHT exists during IPv6 handover")
            .handle()
            .reconcile_transport()
            .await;
        let address_family_result = self
            .discovery_advertisement
            .as_ref()
            .expect("discovery advertisement exists during IPv6 handover")
            .handle()
            .replace_address_family_policy(desired_address_families)
            .await;
        let state = match (retirement_error, dht_result, address_family_result) {
            (None, Ok(()), Ok(())) => ClientSettingsApplicationState::Applied,
            (Some(detail), _, _) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                detail,
            },
            (None, Err(error), _) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                detail: format!("reconcile DHT address families: {error}"),
            },
            (None, Ok(()), Err(error)) => ClientSettingsApplicationState::Degraded {
                reason: ClientSettingsDegradedReason::TransportHandoverFailed,
                detail: format!("apply address-family policy: {error}"),
            },
        };
        publish_transport(
            convergence,
            generation,
            Some(desired),
            self.listener_status.clone(),
            self.session_udp_status.clone(),
            self.advertised_endpoint.status(Instant::now()),
            desired_address_families.ipv6_enabled(),
            state,
            views,
        );
        let transport_families = self.transport_family_views(desired_address_families);
        let _ = views.update_client_settings_runtime_for(generation, |runtime| {
            runtime.transport_families = transport_families;
        });
    }

    async fn reconcile_mapping(
        &mut self,
        attempt: &SettingsAttempt,
        transport_changed: bool,
        convergence: &Arc<Mutex<SettingsConvergenceModel>>,
        views: &ViewHub,
    ) -> Option<Instant> {
        let generation = attempt.domain(SettingsDomain::PortMapping);
        let policy_changed = self.effective_settings.port_mapping != attempt.settings.port_mapping;
        let reachability_finished = self
            .reachability
            .as_ref()
            .is_some_and(ReachabilityCoordinator::is_finished);
        if !policy_changed
            && !transport_changed
            && self.uncertain_mapping.is_none()
            && self.uncertain_udp_mapping.is_none()
            && self.uncertain_pinhole.is_none()
            && self.mapping_runtime_error.is_none()
            && !reachability_finished
        {
            publish_mapping(
                convergence,
                generation,
                self.effective_settings.port_mapping,
                ClientSettingsApplicationState::Applied,
                views,
            );
            return None;
        }
        if self.reachability.is_some() {
            self.advertised_endpoint
                .replace_listener(&ListenerStatus::Disabled);
            self.advertised_endpoint.replace_udp_listener(None);
            let _ =
                views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
            if let Some(reachability) = self.reachability.take() {
                self.record_reachability_shutdown(reachability.shutdown_generation().await);
            }
        }
        self.advertised_endpoint
            .replace_listener(&self.listener_status);
        self.advertised_endpoint
            .replace_udp_listener(ipv4_udp_endpoint(
                &self.session_udp_status,
                &self.listener_status,
            ));
        let _ = views.set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
        let now = Instant::now();
        if self
            .uncertain_mapping
            .as_ref()
            .is_some_and(|mapping| mapping.remaining_lease_seconds(now) == 0)
        {
            self.uncertain_mapping = None;
        }
        if self
            .uncertain_udp_mapping
            .as_ref()
            .is_some_and(|mapping| mapping.remaining_lease_seconds(now) == 0)
        {
            self.uncertain_udp_mapping = None;
        }
        if self
            .uncertain_pinhole
            .as_ref()
            .is_some_and(|pinhole| pinhole.remaining_lease_seconds(now) == 0)
        {
            self.uncertain_pinhole = None;
        }
        if let Some(error) = self.mapping_runtime_error.take() {
            publish_mapping(
                convergence,
                generation,
                self.effective_settings.port_mapping,
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::PortMappingCleanupFailed,
                    detail: error,
                },
                views,
            );
            return None;
        }
        let mapping_blocked = self.uncertain_mapping.is_some();
        let udp_mapping_blocked = self.uncertain_udp_mapping.is_some();
        let pinhole_blocked = self.uncertain_pinhole.is_some();
        let cleanup_blocks_disable = attempt.settings.port_mapping == PortMappingPolicy::Disabled
            && (mapping_blocked || udp_mapping_blocked || pinhole_blocked);
        let mut coordinator_settings = self.effective_settings.clone();
        coordinator_settings.port_mapping = attempt.settings.port_mapping;
        if !cleanup_blocks_disable {
            self.effective_settings.port_mapping = attempt.settings.port_mapping;
        }
        self.reachability = Some(ReachabilityCoordinator::start(
            &coordinator_settings,
            &self.listener_status,
            ReachabilityStartInputs {
                ipv4_udp_listener: ipv4_udp_endpoint(
                    &self.session_udp_status,
                    &self.listener_status,
                ),
                ipv6_listener: self
                    .incoming_ipv6_acceptor
                    .as_ref()
                    .and_then(ipv6_acceptor_address),
                blocks: ReachabilityBlocks {
                    tcp_mapping: mapping_blocked,
                    udp_mapping: udp_mapping_blocked,
                    pinhole: pinhole_blocked,
                },
                evidence: self.reachability_evidence.clone(),
                cancellation: self.network_cancellation.clone(),
            },
            views.clone(),
            self.advertised_endpoint.clone(),
            generation,
        ));
        let mut expiry = None;
        let mut cleanup_application_detail = None;
        if let Some(mapping) = &self.uncertain_mapping {
            let remaining_lease_seconds = mapping.remaining_lease_seconds(now);
            let detail = format!(
                "{}; the prior external lease may remain for {remaining_lease_seconds} seconds",
                mapping.detail,
            );
            let _ = views.set_port_mapping_status_for(
                generation,
                crate::PortMappingStatus::CleanupFailed {
                    external_address: mapping.external_address.to_string(),
                    external_port: mapping.external_port,
                    remaining_lease_seconds,
                    detail: detail.clone(),
                },
            );
            cleanup_application_detail = Some(detail);
            expiry = Some(mapping.expires_at);
        }
        if let Some(mapping) = &self.uncertain_udp_mapping {
            let remaining_lease_seconds = mapping.remaining_lease_seconds(now);
            let detail = format!(
                "{}; the prior external UDP lease may remain for {remaining_lease_seconds} seconds",
                mapping.detail,
            );
            let _ = views.set_udp_port_mapping_status_for(
                generation,
                crate::PortMappingStatus::CleanupFailed {
                    external_address: mapping.external_address.to_string(),
                    external_port: mapping.external_port,
                    remaining_lease_seconds,
                    detail: detail.clone(),
                },
            );
            cleanup_application_detail = Some(match cleanup_application_detail {
                Some(current) => format!("{current}; {detail}"),
                None => detail,
            });
            expiry = Some(expiry.map_or(mapping.expires_at, |current| {
                current.max(mapping.expires_at)
            }));
        }
        if let Some(pinhole) = &self.uncertain_pinhole {
            let remaining_lease_seconds = pinhole.remaining_lease_seconds(now);
            let detail = format!(
                "{}; the prior IPv6 pinhole may remain for {remaining_lease_seconds} seconds",
                pinhole.detail,
            );
            let _ = views.set_ipv6_pinhole_status_for(
                generation,
                crate::Ipv6PinholeStatus::CleanupFailed {
                    internal_address: pinhole.internal_endpoint.ip().to_string(),
                    internal_port: pinhole.internal_endpoint.port(),
                    remaining_lease_seconds,
                    detail: detail.clone(),
                },
            );
            if cleanup_blocks_disable && cleanup_application_detail.is_none() {
                cleanup_application_detail = Some(detail);
            }
            expiry = Some(expiry.map_or(pinhole.expires_at, |current| {
                current.min(pinhole.expires_at)
            }));
        }
        let application =
            cleanup_application_detail.map_or(ClientSettingsApplicationState::Applied, |detail| {
                ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::PortMappingCleanupFailed,
                    detail,
                }
            });
        publish_mapping(
            convergence,
            generation,
            self.effective_settings.port_mapping,
            application,
            views,
        );
        expiry
    }

    async fn shutdown(
        mut self,
        views: &ViewHub,
        cleanup: Option<&CleanupCutoff>,
    ) -> SessionNetworkShutdown {
        let network_cleanup_permitted = cleanup.is_some();
        let mut join_error = None;
        let mut tracker_stops_cut_short = 0;
        let mut port_mappings_left = Vec::new();
        if let Some(discovery) = self.discovery_advertisement.take() {
            let shutdown = match cleanup {
                Some(cutoff) => {
                    discovery
                        .shutdown_within(cutoff.tracker_deadline, cutoff.hurry.clone())
                        .await
                }
                None => discovery.shutdown_without_stopped_announces().await,
            };
            match shutdown {
                Ok(terminal) => {
                    tracker_stops_cut_short = terminal.stops_cut_short;
                    let terminal_counts = format!(
                        "tasks={},registrations={},tracker_operations={},tracker_high_water={},dht_operations={},dht_high_water={},queue_high_water={}",
                        terminal.tasks,
                        terminal.registrations,
                        terminal.tracker_operations,
                        terminal.tracker_operations_high_water,
                        terminal.dht_operations,
                        terminal.dht_operations_high_water,
                        terminal.command_queue_high_water,
                    );
                    let _ = views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::DISCOVERY_PEER,
                        "discovery_advertisement_service_stopped",
                        None,
                        "Discovery and advertisement service stopped with joined owners",
                        &[("terminal_counts", &terminal_counts)],
                    );
                }
                Err(error) => {
                    remember_error(&mut join_error, format!("discovery advertisement: {error}"))
                }
            }
        }
        if let Some(reachability) = self.reachability.take() {
            if let Some(cutoff) = cleanup {
                match reachability.shutdown(cutoff).await {
                    Ok(ReachabilityFinalShutdown {
                        terminal,
                        left_behind,
                    }) => {
                        for detail in &left_behind {
                            let _ = views.record_diagnostic(
                                DiagnosticSeverity::Warning,
                                category::DISCOVERY_REACHABILITY,
                                "port_mapping_cleanup_cut_short",
                                None,
                                "Port mapping removal was cut short by application shutdown",
                                &[("detail", detail)],
                            );
                        }
                        port_mappings_left = left_behind;
                        let terminal_counts = format!(
                            "tasks={},mappings={},pinholes={}",
                            terminal.tasks, terminal.mappings, terminal.pinholes
                        );
                        let _ = views.record_diagnostic(
                            DiagnosticSeverity::Info,
                            category::DISCOVERY_REACHABILITY,
                            "reachability_coordinator_stopped",
                            None,
                            "Incoming reachability coordinator stopped with joined owners",
                            &[("terminal_counts", &terminal_counts)],
                        );
                    }
                    Err(error) => remember_error(
                        &mut join_error,
                        format!("reachability coordinator: {error}"),
                    ),
                }
            } else {
                match reachability.shutdown_without_network_cleanup().await {
                    Ok(shutdown) => {
                        debug_assert_eq!(shutdown.terminal, Default::default());
                        self.uncertain_mapping = shutdown.uncertain_tcp_mapping;
                        self.uncertain_udp_mapping = shutdown.uncertain_udp_mapping;
                        self.uncertain_pinhole = shutdown.uncertain_pinhole;
                        if let Some(error) = shutdown.error {
                            remember_error(
                                &mut join_error,
                                format!("reachability coordinator: {error}"),
                            );
                        }
                    }
                    Err(error) => remember_error(
                        &mut join_error,
                        format!("reachability coordinator: {error}"),
                    ),
                }
            }
        }
        if network_cleanup_permitted && let Some(mapping) = self.uncertain_mapping.take() {
            remember_error(
                &mut join_error,
                format!(
                    "uncertain UPnP mapping {}:{} may remain for {} seconds: {}",
                    mapping.external_address,
                    mapping.external_port,
                    mapping.remaining_lease_seconds(Instant::now()),
                    mapping.detail,
                ),
            );
        }
        if network_cleanup_permitted && let Some(mapping) = self.uncertain_udp_mapping.take() {
            remember_error(
                &mut join_error,
                format!(
                    "uncertain UDP UPnP mapping {}:{} may remain for {} seconds: {}",
                    mapping.external_address,
                    mapping.external_port,
                    mapping.remaining_lease_seconds(Instant::now()),
                    mapping.detail,
                ),
            );
        }
        if network_cleanup_permitted && let Some(pinhole) = self.uncertain_pinhole.take() {
            remember_error(
                &mut join_error,
                format!(
                    "uncertain IPv6 UPnP pinhole {} may remain for {} seconds: {}",
                    pinhole.internal_endpoint,
                    pinhole.remaining_lease_seconds(Instant::now()),
                    pinhole.detail,
                ),
            );
        }
        if let Some(error) = self.mapping_runtime_error.take() {
            remember_error(&mut join_error, format!("reachability generation: {error}"));
        }
        self.incoming_seeding.stop();
        if let Some(acceptor) = self.incoming_acceptor.take()
            && let Err(error) = acceptor.shutdown().await
        {
            remember_error(&mut join_error, format!("incoming acceptor: {error}"));
        }
        if let Some(acceptor) = self.incoming_ipv6_acceptor.take()
            && let Err(error) = acceptor.shutdown().await
        {
            remember_error(&mut join_error, format!("IPv6 incoming acceptor: {error}"));
        }
        self.listener_active.store(false, Ordering::Release);
        if let Some(utp) = self.session_utp.take() {
            match utp.shutdown().await {
                Ok(terminal) => {
                    let terminal_counts = format!(
                        "connections={},half_open={},incoming_queue_high_water={}",
                        terminal.active_connections,
                        terminal.incoming_half_open,
                        terminal.incoming_stream_queue_high_water,
                    );
                    let _ = views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::PEER_CONNECTION,
                        "session_utp_service_stopped",
                        None,
                        "Session uTP service stopped with joined ownership",
                        &[("terminal_counts", &terminal_counts)],
                    );
                }
                Err(error) => remember_error(&mut join_error, error),
            }
        }
        if let Some(runtime) = self.incoming_runtime.take() {
            match runtime.shutdown().await {
                Ok(terminal) => {
                    let terminal_counts = format!(
                        "pending={},established={},reads={},registrations={}",
                        terminal.pending,
                        terminal.established,
                        terminal.reads,
                        terminal.registrations
                    );
                    let _ = views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::PEER_CONNECTION,
                        "incoming_peer_service_stopped",
                        None,
                        "Incoming peer runtime stopped with joined owners",
                        &[("terminal_counts", &terminal_counts)],
                    );
                }
                Err(error) => {
                    remember_error(&mut join_error, format!("incoming peer runtime: {error}"))
                }
            }
        }
        self.mse_dh.shutdown().await;
        let (dht_snapshot, dht_error) = match self.dht.take() {
            Some(dht) => match dht.shutdown().await {
                Ok(snapshot) => (Some(snapshot), None),
                Err(error) => (None, Some(error)),
            },
            None => (None, None),
        };
        if let Some(udp) = self.session_udp.take() {
            match udp.shutdown().await {
                Ok(terminal) => {
                    let terminal_counts = format!(
                        "tasks={},queued={},dropped={}",
                        terminal.tasks, terminal.queued, terminal.datagrams_dropped
                    );
                    let _ = views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::DISCOVERY_DHT,
                        "session_udp_service_stopped",
                        None,
                        "Session UDP service stopped with joined ownership",
                        &[("terminal_counts", &terminal_counts)],
                    );
                }
                Err(error) => {
                    remember_error(&mut join_error, format!("session UDP service: {error}"))
                }
            }
        }
        if let Some(observations) = self.dht_observations.take() {
            match observations.join().await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => remember_error(
                    &mut join_error,
                    format!("DHT observation forwarder: {error}"),
                ),
                Err(error) => remember_error(
                    &mut join_error,
                    format!("DHT observation forwarder: {error}"),
                ),
            }
        }
        SessionNetworkShutdown {
            dht_snapshot,
            dht_error,
            join_error,
            tracker_stops_cut_short,
            port_mappings_left,
        }
    }
}

impl From<SessionBandwidthSnapshot> for BandwidthRuntimeView {
    fn from(snapshot: SessionBandwidthSnapshot) -> Self {
        Self {
            upload: snapshot.upload.into(),
            download: snapshot.download.into(),
        }
    }
}

impl From<BandwidthDirectionSnapshot> for BandwidthDirectionRuntimeView {
    fn from(snapshot: BandwidthDirectionSnapshot) -> Self {
        Self {
            registered_torrents: u32::try_from(snapshot.registered_torrents).unwrap_or(u32::MAX),
            active_waiters: u32::try_from(snapshot.waiting_requests).unwrap_or(u32::MAX),
            queued_requested_bytes: snapshot.queued_bytes.to_string(),
            granted_bytes: snapshot.granted_bytes.to_string(),
            returned_bytes: snapshot.returned_bytes.to_string(),
            cancelled_requests: snapshot.cancelled_requests.to_string(),
            throttle_wait_micros: snapshot.throttle_wait_micros.to_string(),
            throttle_wait_high_water_micros: snapshot.throttle_wait_high_water_micros.to_string(),
            current_burst_credit_bytes: snapshot.current_burst_credit_bytes.to_string(),
        }
    }
}

fn transport_rebind_required(
    effective: Option<&EffectiveListenerSettings>,
    desired: &EffectiveListenerSettings,
    listener_status: &ListenerStatus,
) -> bool {
    let Some(effective) = effective else {
        return true;
    };
    if effective.listener != desired.listener {
        let ListenerStatus::Listening { port, .. } = listener_status else {
            return true;
        };
        let same_scope_adoption = match (effective.listener, desired.listener) {
            (ListenerPolicy::AutomaticLoopback, ListenerPolicy::FixedLoopback { port: fixed })
            | (
                ListenerPolicy::AutomaticLocalNetwork,
                ListenerPolicy::FixedLocalNetwork { port: fixed },
            ) => fixed == *port,
            (ListenerPolicy::FixedLoopback { .. }, ListenerPolicy::AutomaticLoopback)
            | (ListenerPolicy::FixedLocalNetwork { .. }, ListenerPolicy::AutomaticLocalNetwork) => {
                desired.preferred_listen_port == *port
            }
            _ => false,
        };
        return !same_scope_adoption;
    }
    matches!(
        desired.listener,
        ListenerPolicy::AutomaticLoopback | ListenerPolicy::AutomaticLocalNetwork
    ) && effective.preferred_listen_port != desired.preferred_listen_port
}

fn ipv6_acceptor_address(acceptor: &IncomingPeerAcceptor) -> Option<std::net::SocketAddrV6> {
    match acceptor.listen_address() {
        std::net::SocketAddr::V6(address) => Some(address),
        std::net::SocketAddr::V4(_) => None,
    }
}

fn ipv4_udp_endpoint(
    status: &SessionUdpStatus,
    listener_status: &ListenerStatus,
) -> Option<std::net::SocketAddrV4> {
    let SessionUdpStatus::Bound { address, port, .. } = status else {
        return None;
    };
    let bound_address = address.parse::<std::net::Ipv4Addr>().ok()?;
    let address = if bound_address.is_unspecified() {
        let ListenerStatus::Listening { address, .. } = listener_status else {
            return None;
        };
        address.parse::<std::net::Ipv4Addr>().ok()?
    } else {
        bound_address
    };
    (*port != 0).then_some(std::net::SocketAddrV4::new(address, *port))
}

fn transport_family_runtime_views(
    policy: AddressFamilyPolicy,
    ipv4_listener: &ListenerStatus,
    ipv6_listener: Option<std::net::SocketAddr>,
    udp: &SessionUdpHandle,
    advertised: PeerAdvertisementEndpoint,
) -> Vec<TransportFamilyRuntimeView> {
    let ipv4_tcp = match ipv4_listener {
        ListenerStatus::Listening { address, port } => Some(format!("{address}:{port}")),
        ListenerStatus::Disabled | ListenerStatus::BindFailed { .. } => None,
    };
    [
        (
            TransportAddressFamily::Ipv4,
            AddressFamily::Ipv4,
            true,
            ipv4_tcp,
            advertised.ipv4.endpoint,
        ),
        (
            TransportAddressFamily::Ipv6,
            AddressFamily::Ipv6,
            policy.ipv6_enabled(),
            ipv6_listener.map(|address| address.to_string()),
            advertised.ipv6.endpoint,
        ),
    ]
    .into_iter()
    .map(
        |(family, engine_family, configured, tcp_endpoint, advertised_endpoint)| {
            TransportFamilyRuntimeView {
                family,
                configured,
                tcp_endpoint,
                udp_endpoint: udp
                    .local_address_for(engine_family)
                    .map(|address| address.to_string()),
                advertised_endpoint: advertised_endpoint.map(|address| address.to_string()),
            }
        },
    )
    .collect()
}

fn is_current(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
) -> bool {
    convergence
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_current(generation)
}

fn apply_state(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    state: ClientSettingsApplicationState,
) -> Option<ClientSettingsApplicationState> {
    let mut convergence = convergence
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !convergence.is_current(generation) {
        return None;
    }
    convergence.apply(generation, state);
    Some(convergence.state(generation.domain()).clone())
}

fn publish_peer_connections(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    effective_limit: usize,
    state: ClientSettingsApplicationState,
    views: &ViewHub,
) {
    let Some(state) = apply_state(convergence, generation, state) else {
        return;
    };
    let effective_limit = u32::try_from(effective_limit).unwrap_or(u32::MAX);
    let _ = views.update_client_settings_runtime_for(generation, |runtime| {
        runtime.effective_peer_connection_limit = effective_limit;
        runtime.peer_connections_application = state;
    });
}

#[allow(clippy::too_many_arguments)]
fn publish_transport(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    effective_listener: Option<EffectiveListenerSettings>,
    listener_status: ListenerStatus,
    session_udp_status: SessionUdpStatus,
    advertised_endpoint: AdvertisedPeerEndpointStatus,
    effective_ipv6_enabled: bool,
    state: ClientSettingsApplicationState,
    views: &ViewHub,
) {
    let Some(state) = apply_state(convergence, generation, state) else {
        return;
    };
    let _ = views.update_client_settings_runtime_for(generation, |runtime| {
        runtime.effective_listener = effective_listener;
        runtime.listener_status = listener_status;
        runtime.session_udp_status = session_udp_status;
        runtime.advertised_peer_endpoint = advertised_endpoint;
        runtime.transport_application = state;
        runtime.effective_ipv6_enabled = effective_ipv6_enabled;
        runtime.ipv6_application = runtime.transport_application.clone();
    });
}

fn publish_mapping(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    effective_policy: PortMappingPolicy,
    state: ClientSettingsApplicationState,
    views: &ViewHub,
) {
    let Some(state) = apply_state(convergence, generation, state) else {
        return;
    };
    let _ = views.update_client_settings_runtime_for(generation, |runtime| {
        runtime.effective_port_mapping = effective_policy;
        runtime.port_mapping_application = state;
    });
}

fn publish_encryption(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    effective_policy: EncryptionPolicy,
    state: ClientSettingsApplicationState,
    views: &ViewHub,
) {
    let Some(state) = apply_state(convergence, generation, state) else {
        return;
    };
    let _ = views.update_client_settings_runtime_for(generation, |runtime| {
        runtime.effective_encryption = effective_policy;
        runtime.encryption_application = state;
    });
}

fn publish_tracker_https_authentication(
    convergence: &Arc<Mutex<SettingsConvergenceModel>>,
    generation: SettingsDomainGeneration,
    effective_policy: Option<HttpsServerAuthenticationPolicy>,
    state: ClientSettingsApplicationState,
    views: &ViewHub,
) {
    let Some(state) = apply_state(convergence, generation, state) else {
        return;
    };
    let _ = views.update_client_settings_runtime_for(generation, |runtime| {
        runtime.effective_tracker_https_server_authentication = effective_policy;
        runtime.tracker_https_authentication_application = state;
    });
}

fn remember_error(slot: &mut Option<String>, error: String) {
    if slot.is_none() {
        *slot = Some(error);
    }
}

#[cfg(test)]
mod udp_endpoint_tests {
    use super::*;

    #[test]
    fn wildcard_udp_uses_the_concrete_listener_address_and_actual_udp_port() {
        let status = SessionUdpStatus::Bound {
            address: std::net::Ipv4Addr::UNSPECIFIED.to_string(),
            port: 42_001,
            coordinated_with_tcp: false,
        };
        let listener = ListenerStatus::Listening {
            address: "192.168.1.20".to_owned(),
            port: 42_000,
        };

        assert_eq!(
            ipv4_udp_endpoint(&status, &listener),
            Some("192.168.1.20:42001".parse().expect("socket address"))
        );
    }

    #[test]
    fn concrete_udp_address_does_not_borrow_the_listener_address() {
        let status = SessionUdpStatus::Bound {
            address: "192.168.1.21".to_owned(),
            port: 42_001,
            coordinated_with_tcp: false,
        };
        let listener = ListenerStatus::Listening {
            address: "192.168.1.20".to_owned(),
            port: 42_000,
        };

        assert_eq!(
            ipv4_udp_endpoint(&status, &listener),
            Some("192.168.1.21:42001".parse().expect("socket address"))
        );
    }

    #[test]
    fn wildcard_udp_without_a_concrete_listener_is_not_publishable() {
        let status = SessionUdpStatus::Bound {
            address: std::net::Ipv4Addr::UNSPECIFIED.to_string(),
            port: 42_001,
            coordinated_with_tcp: false,
        };

        assert_eq!(ipv4_udp_endpoint(&status, &ListenerStatus::Disabled), None);
    }
}
