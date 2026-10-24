use std::collections::{HashMap, VecDeque};
use std::error::Error;
use std::fmt;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use crate::range_protocol::{self as v2, Admission, CreditWindow};
use crate::range_stream::RangeProducer;
use bytes::BytesMut;
use rstorrent_session::{ApplicationService, MediaRangeError, MediaReadError, MediaResolveError};
use rtc::data_channel::RTCDataChannelId;
use rtc::ice::mdns::MulticastDnsMode;
use rtc::mdns::{MDNS_DEST_ADDR, MulticastSocket};
use rtc::peer_connection::RTCPeerConnectionBuilder;
use rtc::peer_connection::configuration::setting_engine::SettingEngineBuilder;
use rtc::peer_connection::event::{RTCDataChannelEvent, RTCPeerConnectionEvent};
use rtc::peer_connection::message::RTCMessage;
use rtc::peer_connection::sdp::{RTCSdpType, RTCSessionDescription};
use rtc::peer_connection::state::RTCPeerConnectionState;
use rtc::peer_connection::transport::{
    CandidateConfig, CandidateHostConfig, CandidateServerReflexiveConfig, RTCIceCandidate,
    RTCIceCandidateInit, RTCIceCandidateType,
};
use rtc::sansio::Protocol;
use rtc::shared::{TaggedBytesMut, TransportContext, TransportProtocol};
use rtc::statistics::StatsSelector;
use rtc::statistics::report::RTCStatsReportEntry;
use rtc::statistics::stats::ice_candidate_pair::RTCStatsIceCandidatePairState;
use rtc::stun::agent::StunEvent;
use rtc::stun::client::{ClientBuilder as StunClientBuilder, TaggedMessage as TaggedStunMessage};
use rtc::stun::message::{BINDING_REQUEST, Getter, Message as StunMessage, TransactionId};
use rtc::stun::xoraddr::XorMappedAddress;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::UdpSocket;
use tokio::sync::{Mutex, mpsc, oneshot, watch};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

use crate::codec::{
    ControlFrame, MAX_CHUNK_BYTES, MAX_RANGE_REQUESTS, RangeErrorCode, decode_control,
    encode_range_accepted, encode_range_chunk, encode_range_complete, encode_range_error,
    encoded_chunk_payload_bytes,
};

pub const MAX_REMOTE_CANDIDATES: usize = 32;
pub const MAX_SIGNALING_BYTES: usize = 64 * 1024;
pub const STUN_SERVER: &str = "stun.cloudflare.com";
pub const STUN_PORT: u16 = 3478;
pub const MAX_STUN_ADDRESSES: usize = 8;
pub const STUN_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(3);
pub const STUN_BINDING_TIMEOUT: Duration = Duration::from_secs(4);
pub const MDNS_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(4);
pub const NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(20);
pub const REQUEST_INACTIVE_TIMEOUT: Duration = Duration::from_secs(60);
pub const PEER_MAX_LIFETIME: Duration = Duration::from_secs(12 * 60 * 60);
pub const MAX_APPLICATION_QUEUE_BYTES: usize = 512 * 1024;
pub const MAX_TRANSPORT_QUEUE_BYTES: usize = 512 * 1024;
const TRANSPORT_QUEUE_LOW_BYTES: u32 = 256 * 1024;
const MAX_DATAGRAM_BYTES: usize = 2_000;
const DRIVER_FALLBACK_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const STATS_INTERVAL: Duration = Duration::from_millis(250);
const DATA_CHANNEL_LABEL: &str = "rstorrent-direct-file-v1";

use crate::send_window::{MAX_SEND_WINDOW_BYTES, SendWindow, valid_window_bytes};

// Four chunks overlap disk/network/write-credit latency without changing v1.
const SEND_WINDOW_BYTES: usize = MAX_SEND_WINDOW_BYTES;

pub(crate) type SharedApplication = Arc<Mutex<ApplicationService>>;

#[derive(Debug)]
pub enum DirectFileEndpointError {
    InvalidOffer(&'static str),
    SignalingLimit,
    CapabilityUnavailable,
    Bind(std::io::Error),
    WebRtc(String),
    DriverClosed,
    Driver(String),
    Join(String),
}

impl fmt::Display for DirectFileEndpointError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOffer(reason) => write!(formatter, "invalid WebRTC offer: {reason}"),
            Self::SignalingLimit => formatter.write_str("WebRTC signaling input exceeds its limit"),
            Self::CapabilityUnavailable => formatter.write_str("media capability is unavailable"),
            Self::Bind(error) => write!(formatter, "bind direct-file UDP socket: {error}"),
            Self::WebRtc(error) => write!(formatter, "WebRTC setup failed: {error}"),
            Self::DriverClosed => formatter.write_str("direct-file driver is closed"),
            Self::Driver(error) => write!(formatter, "direct-file driver failed: {error}"),
            Self::Join(error) => write!(formatter, "join direct-file driver: {error}"),
        }
    }
}

impl Error for DirectFileEndpointError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Bind(error) => Some(error),
            Self::InvalidOffer(_)
            | Self::SignalingLimit
            | Self::CapabilityUnavailable
            | Self::WebRtc(_)
            | Self::DriverClosed
            | Self::Driver(_)
            | Self::Join(_) => None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct OfferAnswer {
    pub answer: RTCSessionDescription,
    pub udp_address: SocketAddr,
    pub local_candidates: Vec<RTCIceCandidateInit>,
    pub server_reflexive_candidate: bool,
    pub local_fingerprint: String,
    pub remote_fingerprint: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DirectFileEndpointSnapshot {
    pub state: String,
    pub terminal_reason: Option<String>,
    pub active_tasks: usize,
    pub open_sockets: usize,
    pub active_requests: usize,
    pub request_high_water: usize,
    pub queued_bytes: usize,
    pub credit_reserved_bytes: usize,
    pub credit_high_water: usize,
    pub queue_high_water: usize,
    pub transport_buffered_bytes: usize,
    pub transport_high_water: usize,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub network_dropped: usize,
    pub network_queue_high_water: usize,
    pub network_overflow: usize,
    pub remote_candidates: usize,
    pub signaling_bytes: usize,
    pub fingerprint_verified: bool,
    pub selected_candidate_class: Option<String>,
    pub rtt_micros: Option<u64>,
}

#[derive(Debug, Default)]
pub(crate) struct EndpointMetrics {
    state: StdMutex<String>,
    terminal_reason: StdMutex<Option<String>>,
    active_tasks: AtomicUsize,
    open_sockets: AtomicUsize,
    active_requests: AtomicUsize,
    request_high_water: AtomicUsize,
    queued_bytes: AtomicUsize,
    credit_reserved_bytes: AtomicUsize,
    credit_high_water: AtomicUsize,
    queue_space: tokio::sync::Notify,
    queue_high_water: AtomicUsize,
    transport_buffered_bytes: AtomicUsize,
    transport_high_water: AtomicUsize,
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
    network_dropped: AtomicUsize,
    network_queue_high_water: AtomicUsize,
    network_overflow: AtomicUsize,
    remote_candidates: AtomicUsize,
    signaling_bytes: AtomicUsize,
    fingerprint_verified: AtomicBool,
    selected_candidate_class: StdMutex<Option<String>>,
    rtt_micros: AtomicU64,
    has_rtt: AtomicBool,
}

impl EndpointMetrics {
    fn snapshot(&self) -> DirectFileEndpointSnapshot {
        DirectFileEndpointSnapshot {
            state: lock_unpoisoned(&self.state).clone(),
            terminal_reason: lock_unpoisoned(&self.terminal_reason).clone(),
            active_tasks: self.active_tasks.load(Ordering::Acquire),
            open_sockets: self.open_sockets.load(Ordering::Acquire),
            active_requests: self.active_requests.load(Ordering::Acquire),
            request_high_water: self.request_high_water.load(Ordering::Acquire),
            queued_bytes: self.queued_bytes.load(Ordering::Acquire),
            credit_reserved_bytes: self.credit_reserved_bytes.load(Ordering::Acquire),
            credit_high_water: self.credit_high_water.load(Ordering::Acquire),
            queue_high_water: self.queue_high_water.load(Ordering::Acquire),
            transport_buffered_bytes: self.transport_buffered_bytes.load(Ordering::Acquire),
            transport_high_water: self.transport_high_water.load(Ordering::Acquire),
            bytes_sent: self.bytes_sent.load(Ordering::Acquire),
            bytes_received: self.bytes_received.load(Ordering::Acquire),
            network_dropped: self.network_dropped.load(Ordering::Acquire),
            network_queue_high_water: self.network_queue_high_water.load(Ordering::Acquire),
            network_overflow: self.network_overflow.load(Ordering::Acquire),
            remote_candidates: self.remote_candidates.load(Ordering::Acquire),
            signaling_bytes: self.signaling_bytes.load(Ordering::Acquire),
            fingerprint_verified: self.fingerprint_verified.load(Ordering::Acquire),
            selected_candidate_class: lock_unpoisoned(&self.selected_candidate_class).clone(),
            rtt_micros: self
                .has_rtt
                .load(Ordering::Acquire)
                .then(|| self.rtt_micros.load(Ordering::Acquire)),
        }
    }

    fn set_state(&self, state: &str) {
        *lock_unpoisoned(&self.state) = state.to_owned();
    }

    fn set_terminal(&self, reason: &str) {
        *lock_unpoisoned(&self.terminal_reason) = Some(reason.to_owned());
    }
}

fn lock_unpoisoned<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Clone)]
pub struct DirectFileEndpointFactory {
    starter: Arc<dyn LazyEndpointStarter>,
}

type EndpointStartFuture = Pin<
    Box<
        dyn Future<Output = Result<(OfferAnswer, DirectFileEndpoint), DirectFileEndpointError>>
            + Send,
    >,
>;

type ProductEndpointStartFuture = Pin<
    Box<
        dyn Future<Output = Result<(OfferAnswer, DirectFileEndpoint), DirectFileEndpointError>>
            + Send,
    >,
>;

trait LazyEndpointStarter: Send + Sync {
    fn answer_offer(
        &self,
        capability: String,
        bind_ip: IpAddr,
        offer: RTCSessionDescription,
    ) -> EndpointStartFuture;

    fn answer_product_offer(
        &self,
        capability: String,
        offer: RTCSessionDescription,
    ) -> ProductEndpointStartFuture;
}

#[derive(Clone, Copy, Default)]
pub enum ExperimentSource {
    #[default]
    Verified,
    #[cfg(feature = "experiment")]
    GeneratedRanges,
    #[cfg(feature = "experiment")]
    LegacyVerified,
    #[cfg(feature = "experiment")]
    Network {
        delay_ms: u64,
        loss_every: u32,
        rate_mib: u32,
    },
    #[cfg(feature = "experiment")]
    Raw { length: usize, buffer_bytes: usize },
}

#[cfg(feature = "experiment")]
pub(crate) fn generated_bytes(offset: u64, length: usize) -> Vec<u8> {
    (offset..offset + length as u64)
        .map(|index| {
            index
                .wrapping_mul(31)
                .wrapping_add((index >> 8).wrapping_mul(17)) as u8
        })
        .collect()
}

struct RtcEndpointStarter {
    application: SharedApplication,
    send_window_bytes: usize,
    source: ExperimentSource,
}

impl LazyEndpointStarter for RtcEndpointStarter {
    fn answer_offer(
        &self,
        capability: String,
        bind_ip: IpAddr,
        offer: RTCSessionDescription,
    ) -> EndpointStartFuture {
        Box::pin(answer_offer(
            self.application.clone(),
            capability,
            bind_ip,
            Vec::new(),
            offer,
            self.send_window_bytes,
            self.source,
        ))
    }

    fn answer_product_offer(
        &self,
        capability: String,
        offer: RTCSessionDescription,
    ) -> ProductEndpointStartFuture {
        let application = self.application.clone();
        let send_window_bytes = self.send_window_bytes;
        let source = self.source;
        Box::pin(async move {
            validate_offer(&offer)?;
            let (bind_ip, stun_addresses) = match resolve_stun_route().await {
                Ok(route) => route,
                Err(stun_error) => match bind_ip_from_offer(&offer.sdp).await {
                    Some(bind_ip) => (bind_ip, Vec::new()),
                    None => return Err(stun_error),
                },
            };
            answer_offer(
                application,
                capability,
                bind_ip,
                stun_addresses,
                offer,
                send_window_bytes,
                source,
            )
            .await
        })
    }
}

impl DirectFileEndpointFactory {
    pub fn new(application: SharedApplication) -> Self {
        Self {
            // The dynamic lazy boundary makes the actual start path part of a
            // feature-on product binary while leaving all WebRTC resources
            // unopened until signaling supplies an offer.
            starter: Arc::new(RtcEndpointStarter {
                application,
                send_window_bytes: SEND_WINDOW_BYTES,
                source: ExperimentSource::Verified,
            }),
        }
    }

    /// Bounded experiment control; product hosts use the measured constant.
    #[cfg(feature = "experiment")]
    pub fn with_send_window(application: SharedApplication, bytes: usize) -> Option<Self> {
        Self::with_experiment_source(application, bytes, ExperimentSource::Verified)
    }

    /// Local diagnostic sources are never selected by product factories.
    #[cfg(feature = "experiment")]
    pub fn with_experiment_source(
        application: SharedApplication,
        bytes: usize,
        source: ExperimentSource,
    ) -> Option<Self> {
        if let ExperimentSource::Raw {
            length,
            buffer_bytes,
        } = source
            && (!(1..=256 * 1024 * 1024).contains(&length)
                || !(MAX_CHUNK_BYTES..=MAX_TRANSPORT_QUEUE_BYTES).contains(&buffer_bytes))
        {
            return None;
        }
        if let ExperimentSource::Network {
            delay_ms,
            loss_every,
            rate_mib,
        } = source
            && (delay_ms > 250 || (loss_every > 0 && loss_every < 20) || rate_mib > 128)
        {
            return None;
        }
        valid_window_bytes(bytes).then(|| Self {
            starter: Arc::new(RtcEndpointStarter {
                application,
                send_window_bytes: bytes,
                source,
            }),
        })
    }

    pub fn idle_snapshot(&self) -> DirectFileEndpointSnapshot {
        DirectFileEndpointSnapshot {
            state: "idle".to_owned(),
            ..DirectFileEndpointSnapshot::default()
        }
    }

    pub async fn answer_offer(
        &self,
        capability: String,
        bind_ip: IpAddr,
        offer: RTCSessionDescription,
    ) -> Result<(OfferAnswer, DirectFileEndpoint), DirectFileEndpointError> {
        self.starter.answer_offer(capability, bind_ip, offer).await
    }

    pub async fn answer_product_offer(
        &self,
        capability: String,
        offer: RTCSessionDescription,
    ) -> Result<(OfferAnswer, DirectFileEndpoint), DirectFileEndpointError> {
        self.starter.answer_product_offer(capability, offer).await
    }
}

#[allow(clippy::too_many_arguments)]
async fn answer_offer(
    application: SharedApplication,
    capability: String,
    bind_ip: IpAddr,
    stun_addresses: Vec<SocketAddr>,
    offer: RTCSessionDescription,
    send_window_bytes: usize,
    source: ExperimentSource,
) -> Result<(OfferAnswer, DirectFileEndpoint), DirectFileEndpointError> {
    debug_assert!(valid_window_bytes(send_window_bytes));
    let remote_fingerprint = validate_offer(&offer)?;
    {
        let mut application = application.lock().await;
        let lease = application
            .resolve_media_capability(&capability)
            .map_err(|_| DirectFileEndpointError::CapabilityUnavailable)?;
        drop(lease);
    }

    let socket = UdpSocket::bind(SocketAddr::new(bind_ip, 0))
        .await
        .map_err(DirectFileEndpointError::Bind)?;
    let local_addr = socket.local_addr().map_err(DirectFileEndpointError::Bind)?;
    let server_reflexive = gather_server_reflexive(&socket, local_addr, &stun_addresses).await;
    let host_candidate = CandidateHostConfig {
        base_config: CandidateConfig {
            network: "udp".to_owned(),
            address: local_addr.ip().to_string(),
            port: local_addr.port(),
            component: 1,
            ..CandidateConfig::default()
        },
        ..CandidateHostConfig::default()
    }
    .new_candidate_host()
    .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;

    let mdns_socket = UdpSocket::from_std(
        MulticastSocket::new()
            .into_std()
            .map_err(DirectFileEndpointError::Bind)?,
    )
    .map_err(DirectFileEndpointError::Bind)?;
    let setting_engine = SettingEngineBuilder::new()
        .with_multicast_dns_mode(MulticastDnsMode::QueryOnly)
        .with_multicast_dns_timeout(Some(MDNS_RESOLUTION_TIMEOUT))
        .with_sctp_max_receive_buffer_size(MAX_TRANSPORT_QUEUE_BYTES as u32)
        .build();
    let mut peer = RTCPeerConnectionBuilder::new()
        .with_setting_engine(setting_engine)
        .build(Instant::now())
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    let host_candidate = RTCIceCandidate::from(&host_candidate)
        .to_json()
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    peer.add_local_candidate(host_candidate.clone())
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    let mut local_candidates = vec![host_candidate];
    if let Some(mapped) = server_reflexive {
        let candidate = CandidateServerReflexiveConfig {
            base_config: CandidateConfig {
                network: "udp".to_owned(),
                address: mapped.ip.to_string(),
                port: mapped.port,
                component: 1,
                ..CandidateConfig::default()
            },
            rel_addr: local_addr.ip().to_string(),
            rel_port: local_addr.port(),
            url: Some(format!("stun:{STUN_SERVER}:{STUN_PORT}")),
        }
        .new_candidate_server_reflexive()
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
        let candidate = RTCIceCandidate::from(&candidate)
            .to_json()
            .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
        peer.add_local_candidate(candidate.clone())
            .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
        local_candidates.push(candidate);
    }
    peer.set_remote_description(Instant::now(), offer.clone())
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    let answer = peer
        .create_answer(None)
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    peer.set_local_description(Instant::now(), answer.clone())
        .map_err(|error| DirectFileEndpointError::WebRtc(error.to_string()))?;
    let local_fingerprint = fingerprint_from_sdp(&answer.sdp)?;

    let metrics = Arc::new(EndpointMetrics::default());
    metrics.set_state("negotiating");
    metrics.open_sockets.store(2, Ordering::Release);
    metrics.active_tasks.store(1, Ordering::Release);
    metrics
        .signaling_bytes
        .store(offer.sdp.len(), Ordering::Release);
    let (command_tx, command_rx) = mpsc::channel(64);
    let cancellation = CancellationToken::new();
    let driver_cancellation = cancellation.clone();
    let driver_metrics = metrics.clone();
    let application = application.clone();
    let task = tokio::spawn(async move {
        let result = run_driver(
            peer,
            socket,
            mdns_socket,
            local_addr,
            application,
            capability,
            command_rx,
            driver_cancellation,
            driver_metrics.clone(),
            send_window_bytes,
            source,
        )
        .await;
        driver_metrics.active_tasks.store(0, Ordering::Release);
        driver_metrics.open_sockets.store(0, Ordering::Release);
        if let Err(error) = &result {
            driver_metrics.set_terminal(&error.to_string());
            driver_metrics.set_state("failed");
        }
        result
    });
    Ok((
        OfferAnswer {
            answer,
            udp_address: local_addr,
            server_reflexive_candidate: local_candidates.len() > 1,
            local_candidates,
            local_fingerprint,
            remote_fingerprint,
        },
        DirectFileEndpoint {
            command_tx,
            cancellation,
            task: Some(task),
            metrics,
        },
    ))
}

pub struct DirectFileEndpoint {
    command_tx: mpsc::Sender<EndpointCommand>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<Result<(), DirectFileEndpointError>>>,
    metrics: Arc<EndpointMetrics>,
}

impl DirectFileEndpoint {
    pub fn snapshot(&self) -> DirectFileEndpointSnapshot {
        self.metrics.snapshot()
    }

    pub async fn add_remote_candidate(
        &self,
        candidate: RTCIceCandidateInit,
    ) -> Result<(), DirectFileEndpointError> {
        let candidate_bytes = candidate.candidate.len()
            + candidate.sdp_mid.as_ref().map_or(0, String::len)
            + candidate.username_fragment.as_ref().map_or(0, String::len);
        if !direct_udp_candidate(&candidate.candidate) || candidate_bytes > MAX_SIGNALING_BYTES {
            return Err(DirectFileEndpointError::SignalingLimit);
        }
        let count = self
            .metrics
            .remote_candidates
            .fetch_add(1, Ordering::AcqRel)
            + 1;
        if count > MAX_REMOTE_CANDIDATES {
            self.metrics
                .remote_candidates
                .fetch_sub(1, Ordering::AcqRel);
            return Err(DirectFileEndpointError::SignalingLimit);
        }
        if reserve_counter(
            &self.metrics.signaling_bytes,
            candidate_bytes,
            MAX_SIGNALING_BYTES,
        )
        .is_err()
        {
            self.metrics
                .remote_candidates
                .fetch_sub(1, Ordering::AcqRel);
            return Err(DirectFileEndpointError::SignalingLimit);
        }
        let (response_tx, response_rx) = oneshot::channel();
        if self
            .command_tx
            .send(EndpointCommand::Candidate(candidate, response_tx))
            .await
            .is_err()
        {
            self.metrics
                .remote_candidates
                .fetch_sub(1, Ordering::AcqRel);
            self.metrics
                .signaling_bytes
                .fetch_sub(candidate_bytes, Ordering::AcqRel);
            return Err(DirectFileEndpointError::DriverClosed);
        }
        response_rx
            .await
            .map_err(|_| DirectFileEndpointError::DriverClosed)?
            .map_err(DirectFileEndpointError::WebRtc)
    }

    pub async fn shutdown(&mut self) -> Result<(), DirectFileEndpointError> {
        self.cancellation.cancel();
        let Some(task) = self.task.take() else {
            return Ok(());
        };
        task.await
            .map_err(|error| DirectFileEndpointError::Join(error.to_string()))?
    }
}

impl Drop for DirectFileEndpoint {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

enum EndpointCommand {
    Candidate(RTCIceCandidateInit, oneshot::Sender<Result<(), String>>),
}

pub(crate) struct OutboundFrame {
    bytes: Vec<u8>,
    bulk: bool,
    request_id: u32,
    priority: u8,
}

struct ActiveRequest {
    cancellation: CancellationToken,
    ack: mpsc::Sender<u64>,
    stream: Option<ActiveStream>,
}

struct ActiveStream {
    state: Arc<StdMutex<CreditWindow>>,
    updates: watch::Sender<()>,
    reservation: usize,
}

#[allow(clippy::too_many_arguments)]
async fn run_driver(
    mut peer: rtc::peer_connection::RTCPeerConnection,
    socket: UdpSocket,
    mdns_socket: UdpSocket,
    local_addr: SocketAddr,
    application: SharedApplication,
    capability: String,
    mut commands: mpsc::Receiver<EndpointCommand>,
    cancellation: CancellationToken,
    metrics: Arc<EndpointMetrics>,
    send_window_bytes: usize,
    source: ExperimentSource,
) -> Result<(), DirectFileEndpointError> {
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<OutboundFrame>(8);
    let mut pending = VecDeque::<OutboundFrame>::new();
    let mut requests = HashMap::<u32, ActiveRequest>::new();
    let mut request_tasks = JoinSet::<(u32, &'static str)>::new();
    let mut channel_id: Option<RTCDataChannelId> = None;
    let mut bulk_id: Option<RTCDataChannelId> = None;
    let mut admission: Option<Admission> = None;
    let mut stream_transport_limit = v2::MIN_TRANSPORT;
    let mut last_scheduled = 0;
    let mut urgent_run = 0;
    let mut receive_buffer = vec![0; MAX_DATAGRAM_BYTES];
    let mut mdns_receive_buffer = vec![0; MAX_DATAGRAM_BYTES];
    let negotiation_deadline = tokio::time::Instant::now() + NEGOTIATION_TIMEOUT;
    let lifetime_deadline = tokio::time::Instant::now() + PEER_MAX_LIFETIME;
    let mut stats_tick = tokio::time::interval(STATS_INTERVAL);
    stats_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    #[cfg(feature = "experiment")]
    let mut raw_sent = 0usize;
    let allow_v2 = {
        #[cfg(feature = "experiment")]
        {
            !matches!(source, ExperimentSource::LegacyVerified)
        }
        #[cfg(not(feature = "experiment"))]
        {
            true
        }
    };
    #[cfg(feature = "experiment")]
    let mut impairment = crate::impairment::Impairment::new(source);
    let outcome = async {
    let terminal = 'driver: loop {
        // A saturated diagnostic producer must still respond to cancellation.
        if cancellation.is_cancelled() {
            break 'driver "shutdown";
        }
        #[cfg(feature = "experiment")]
        while let Some(datagram) = impairment.pop_due() {
            if datagram.incoming {
                peer.handle_read(TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr,
                        peer_addr: datagram.address,
                        ecn: None,
                        transport_protocol: TransportProtocol::UDP,
                    },
                    message: BytesMut::from(datagram.bytes.as_slice()),
                })
                .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            } else {
                socket
                    .send_to(&datagram.bytes, datagram.address)
                    .await
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            }
        }
        while let Some(transmit) = peer.poll_write() {
            let transmit_socket = if transmit.transport.peer_addr == MDNS_DEST_ADDR {
                &mdns_socket
            } else {
                &socket
            };
            #[cfg(feature = "experiment")]
            if impairment.enabled() && transmit.transport.peer_addr != MDNS_DEST_ADDR {
                impairment.enqueue(false, transmit.transport.peer_addr, &transmit.message);
                continue;
            }
            transmit_socket
                .send_to(&transmit.message, transmit.transport.peer_addr)
                .await
                .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
        }

        while let Some(event) = peer.poll_event() {
            match event {
                RTCPeerConnectionEvent::OnConnectionStateChangeEvent(state) => match state {
                    RTCPeerConnectionState::Connected => {
                        metrics.set_state("connected");
                        metrics.fingerprint_verified.store(true, Ordering::Release);
                    }
                    RTCPeerConnectionState::Failed => {
                        break 'driver "connection_failed";
                    }
                    RTCPeerConnectionState::Closed => {
                        break 'driver "peer_closed";
                    }
                    _ => {}
                },
                RTCPeerConnectionEvent::OnDataChannel(data_event) => match data_event {
                    RTCDataChannelEvent::OnOpen(id) => {
                        let mut channel = peer.data_channel(id).ok_or_else(|| {
                            DirectFileEndpointError::Driver(
                                "opened DataChannel disappeared".to_owned(),
                            )
                        })?;
                        if !channel.ordered()
                            || channel.max_packet_life_time().is_some()
                            || channel.max_retransmits().is_some()
                        {
                            break 'driver "unsupported_data_channel";
                        }
                        match channel.label() {
                            DATA_CHANNEL_LABEL if channel_id.is_none() => channel_id = Some(id),
                            v2::BULK_LABEL if admission.is_some() && bulk_id.is_none() => {
                                bulk_id = Some(id)
                            }
                            _ => break 'driver "unsupported_data_channel",
                        }
                        channel.set_buffered_amount_low_threshold(TRANSPORT_QUEUE_LOW_BYTES);
                        channel.set_buffered_amount_high_threshold(v2::MAX_BUDGET as u32);
                        metrics.set_state("ready");
                    }
                    RTCDataChannelEvent::OnClose(id) | RTCDataChannelEvent::OnError(id)
                        if Some(id) == channel_id || Some(id) == bulk_id =>
                    {
                        break 'driver "data_channel_closed";
                    }
                    _ => {}
                },
                _ => {}
            }
        }

        while let Some(message) = peer.poll_read() {
            let RTCMessage::DataChannelMessage(id, message) = message.message else {
                continue;
            };
            if Some(id) != channel_id || message.is_string {
                try_queue_frame(
                    &outbound_tx,
                    &metrics,
                    encode_range_error(0, RangeErrorCode::Malformed),
                );
                continue;
            }
            metrics.bytes_received.fetch_add(
                u64::try_from(message.data.len()).unwrap_or(u64::MAX),
                Ordering::AcqRel,
            );
            #[cfg(feature = "experiment")]
            if matches!(source, ExperimentSource::Raw { .. }) {
                break 'driver "unexpected_raw_input";
            }
            if allow_v2 && admission.is_none()
                && requests.is_empty()
                && let Some((budget, transport_limit)) = v2::hello(&message.data)
            {
                let length = {
                    let lease = application
                        .lock()
                        .await
                        .resolve_media_capability(&capability);
                    match lease {
                        Ok(lease) => lease.length(),
                        Err(_) => break 'driver "capability_unavailable",
                    }
                };
                let version: [u8; 32] = Sha256::digest(capability.as_bytes()).into();
                try_queue_frame(
                    &outbound_tx,
                    &metrics,
                    v2::opened(length, budget, transport_limit, &version),
                );
                admission = Some(Admission::new(budget));
                stream_transport_limit = transport_limit;
                update_transport_metrics(&mut peer, &metrics);
                continue;
            }
            if let Some(pool) = admission.as_mut() {
                match v2::decode(&message.data) {
                    Ok(v2::Control::Read {
                        id,
                        start,
                        end,
                        window,
                        priority,
                    }) => {
                        if bulk_id.is_none()
                            || requests.len() >= MAX_RANGE_REQUESTS
                            || pool.reserve(id, window as usize).is_err()
                        {
                            break 'driver "invalid_range_admission";
                        }
                        metrics.credit_reserved_bytes.store(pool.reserved, Ordering::Release);
                        metrics.credit_high_water.fetch_max(pool.reserved, Ordering::AcqRel);
                        let cancel = cancellation.child_token();
                        let state = Arc::new(StdMutex::new(CreditWindow::new(start, end, window)));
                        let (updates, receiver) = watch::channel(());
                        let (ack, _) = mpsc::channel(1);
                        requests.insert(
                            id,
                            ActiveRequest {
                                cancellation: cancel.clone(),
                                ack,
                                stream: Some(ActiveStream {
                                    state: state.clone(),
                                    updates,
                                    reservation: window as usize,
                                }),
                            },
                        );
                        let active = metrics.active_requests.fetch_add(1, Ordering::AcqRel) + 1;
                        metrics
                            .request_high_water
                            .fetch_max(active, Ordering::AcqRel);
                        let producer = RangeProducer {
                            application: application.clone(),
                            capability: capability.clone(),
                            id,
                            state,
                            updates: receiver,
                            outbound: outbound_tx.clone(),
                            cancel,
                            connection_cancel: cancellation.clone(),
                            metrics: metrics.clone(),
                            source,
                            priority,
                        };
                        request_tasks.spawn(async move { (id, producer.run().await) });
                    }
                    Ok(v2::Control::Credit {
                        id,
                        consumed,
                        limit,
                    }) => {
                        if let Some(stream) = requests.get(&id).and_then(|r| r.stream.as_ref()) {
                            match stream.state.lock().unwrap().update(consumed, limit) {
                                Ok(true) => { stream.updates.send_replace(()); },
                                Ok(false) => {},
                                Err(_) => break 'driver "invalid_consumption_credit",
                            }
                        } else if !pool.has_seen(id) {
                            break 'driver "unknown_range_credit";
                        }
                    }
                    Ok(v2::Control::Cancel { id }) => {
                        if let Some(request) = requests.get(&id) {
                            request.cancellation.cancel();
                        }
                    }
                    Err(_) => break 'driver "malformed_stream_control",
                }
                continue;
            }
            match decode_control(&message.data) {
                Ok(ControlFrame::RangeRequest {
                    request_id,
                    offset,
                    length,
                }) => {
                    if requests.contains_key(&request_id) {
                        try_queue_frame(
                            &outbound_tx,
                            &metrics,
                            encode_range_error(request_id, RangeErrorCode::DuplicateRequest),
                        );
                    } else if requests.len() >= MAX_RANGE_REQUESTS {
                        try_queue_frame(
                            &outbound_tx,
                            &metrics,
                            encode_range_error(request_id, RangeErrorCode::TooManyRequests),
                        );
                    } else {
                        let request_cancellation = cancellation.child_token();
                        let (ack_tx, ack_rx) =
                            mpsc::channel(MAX_SEND_WINDOW_BYTES / MAX_CHUNK_BYTES + 1);
                        requests.insert(
                            request_id,
                            ActiveRequest {
                                cancellation: request_cancellation.clone(),
                                ack: ack_tx,
                                stream: None,
                            },
                        );
                        let active = metrics.active_requests.fetch_add(1, Ordering::AcqRel) + 1;
                        metrics
                            .request_high_water
                            .fetch_max(active, Ordering::AcqRel);
                        let application = application.clone();
                        let capability = capability.clone();
                        let outbound = outbound_tx.clone();
                        let request_metrics = metrics.clone();
                        request_tasks.spawn(async move {
                            let terminal = run_range_request(
                                application,
                                capability,
                                request_id,
                                offset,
                                length,
                                ack_rx,
                                outbound,
                                request_cancellation,
                                request_metrics,
                                send_window_bytes,
                                source,
                            )
                            .await;
                            (request_id, terminal)
                        });
                    }
                }
                Ok(ControlFrame::CancelRequest { request_id }) => {
                    if let Some(request) = requests.get(&request_id) {
                        request.cancellation.cancel();
                    }
                }
                Ok(ControlFrame::ChunkAck {
                    request_id,
                    next_offset,
                }) => {
                    if let Some(request) = requests.get(&request_id) {
                        if request.cancellation.is_cancelled() {
                            continue;
                        }
                        if matches!(
                            request.ack.try_send(next_offset),
                            Err(mpsc::error::TrySendError::Full(_))
                        ) {
                            // An honest peer has at most four unacknowledged chunks.
                            // Never silently drop the last credit or grow a flood queue.
                            request.cancellation.cancel();
                            try_queue_frame(
                                &outbound_tx,
                                &metrics,
                                encode_range_error(request_id, RangeErrorCode::Malformed),
                            );
                        }
                    }
                }
                Err(_) => try_queue_frame(
                    &outbound_tx,
                    &metrics,
                    encode_range_error(0, RangeErrorCode::Malformed),
                ),
            }
        }

        while let Ok(frame) = outbound_rx.try_recv() {
            pending.push_back(frame);
        }

        // Keep control responsive and rotate among ready range owners. Urgent
        // probes get up to three turns before an available bulk owner.
        let index = pending.iter().position(|f| !f.bulk).or_else(|| {
            let preferred = if urgent_run < 3 { 1 } else { 0 };
            pending
                .iter()
                .position(|f| f.priority == preferred && f.request_id != last_scheduled)
                .or_else(|| pending.iter().position(|f| f.priority == preferred))
                .or_else(|| pending.iter().position(|f| f.request_id != last_scheduled))
                .or_else(|| (!pending.is_empty()).then_some(0))
        });
        if let Some(index) = index {
            let frame = &pending[index];
            let selected = if frame.bulk { bulk_id } else { channel_id };
            if let Some(id) = selected {
                let control_buffered = channel_id
                    .and_then(|c| peer.data_channel(c))
                    .map_or(0, |c| c.outstanding_bytes());
                let bulk_buffered = bulk_id
                    .and_then(|c| peer.data_channel(c))
                    .map_or(0, |c| c.outstanding_bytes());
                let buffered = control_buffered + bulk_buffered;
                metrics
                    .transport_buffered_bytes
                    .store(buffered, Ordering::Release);
                metrics
                    .transport_high_water
                    .fetch_max(buffered, Ordering::AcqRel);
                let limit = if admission.is_some() {
                    v2::transport_window(
                        stream_transport_limit,
                        metrics.rtt_micros.load(Ordering::Acquire),
                    )
                } else {
                    MAX_TRANSPORT_QUEUE_BYTES
                };
                // Reserve a small independent control allowance; bulk never fills it.
                let fits = if frame.bulk {
                    bulk_buffered.saturating_add(frame.bytes.len()) <= limit
                } else {
                    control_buffered.saturating_add(frame.bytes.len()) <= MAX_TRANSPORT_QUEUE_BYTES
                };
                if fits {
                    let frame = pending.remove(index).expect("selected frame exists");
                    if frame.bulk {
                        last_scheduled = frame.request_id;
                        urgent_run = if frame.priority == 1 {
                            urgent_run + 1
                        } else {
                            0
                        };
                    }
                    let payload_bytes =
                        if frame.bytes.first() == Some(&2) && frame.bytes.get(1) == Some(&0x82) {
                            frame.bytes.len().saturating_sub(14)
                        } else {
                            encoded_chunk_payload_bytes(&frame.bytes)
                        };
                    let mut channel = peer.data_channel(id).ok_or_else(|| {
                        DirectFileEndpointError::Driver("active DataChannel disappeared".to_owned())
                    })?;
                    channel
                        .send(Instant::now(), BytesMut::from(frame.bytes.as_slice()))
                        .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
                    let buffered = buffered + frame.bytes.len();
                    metrics
                        .transport_buffered_bytes
                        .store(buffered, Ordering::Release);
                    metrics
                        .transport_high_water
                        .fetch_max(buffered, Ordering::AcqRel);
                    metrics
                        .queued_bytes
                        .fetch_sub(frame.bytes.len(), Ordering::AcqRel);
                    metrics.queue_space.notify_waiters();
                    metrics
                        .bytes_sent
                        .fetch_add(payload_bytes as u64, Ordering::AcqRel);
                    continue;
                }
            }
        }

        #[cfg(feature = "experiment")]
        if let (
            Some(id),
            ExperimentSource::Raw {
                length,
                buffer_bytes,
            },
        ) = (channel_id, source)
            && raw_sent < length
        {
            let mut channel = peer.data_channel(id).ok_or_else(|| {
                DirectFileEndpointError::Driver("raw DataChannel disappeared".to_owned())
            })?;
            let size = MAX_CHUNK_BYTES.min(length - raw_sent);
            if channel.outstanding_bytes().saturating_add(size) <= buffer_bytes {
                let bytes = generated_bytes(raw_sent as u64, size);
                channel
                    .send(Instant::now(), BytesMut::from(bytes.as_slice()))
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
                raw_sent += size;
                let buffered = channel.outstanding_bytes();
                metrics
                    .transport_buffered_bytes
                    .store(buffered, Ordering::Release);
                metrics
                    .transport_high_water
                    .fetch_max(buffered, Ordering::AcqRel);
                metrics.bytes_sent.fetch_add(size as u64, Ordering::AcqRel);
                continue;
            }
        }

        let timeout_at = peer
            .poll_timeout()
            .unwrap_or_else(|| Instant::now() + DRIVER_FALLBACK_TIMEOUT);
        let timeout_delay = timeout_at
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::ZERO);
        if timeout_delay.is_zero() {
            peer.handle_timeout(Instant::now())
                .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            continue;
        }
        #[cfg(feature = "experiment")]
        let impairment_timer = tokio::time::sleep_until(impairment.deadline());
        let protocol_timer = tokio::time::sleep(timeout_delay);
        tokio::pin!(protocol_timer);

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                break 'driver "shutdown";
            }
            _ = tokio::time::sleep_until(lifetime_deadline) => {
                break 'driver "peer_lifetime";
            }
            _ = tokio::time::sleep_until(negotiation_deadline), if channel_id.is_none() => {
                break 'driver "negotiation_timeout";
            }
            Some(command) = commands.recv() => match command {
                EndpointCommand::Candidate(candidate, response) => {
                    let result = peer
                        .add_remote_candidate(candidate)
                        .map_err(|error| error.to_string());
                    let _ = response.send(result);
                }
            },
            Some(frame) = outbound_rx.recv() => pending.push_back(frame),
            Some(joined) = request_tasks.join_next(), if !request_tasks.is_empty() => {
                if let Ok((request_id, request_terminal)) = joined {
                    if matches!(request_terminal, "queue_closed" | "driver_closed") && !cancellation.is_cancelled() { break 'driver "range_producer_failed"; }
                    if let Some(request) = requests.remove(&request_id)
                        && let Some(stream) = request.stream
                        && let Some(pool) = admission.as_mut()
                    {
                        let state = stream.state.lock().unwrap();
                        if state.consumed != state.sent { break 'driver "unconsumed_range_terminal"; }
                        pool.release(stream.reservation);
                        metrics.credit_reserved_bytes.store(pool.reserved, Ordering::Release);
                        let mut bytes = vec![2, 0x85]; bytes.extend(request_id.to_be_bytes());
                        if reserve_queue(&metrics, bytes.len()).is_err() { break 'driver "control_queue_full"; }
                        pending.push_back(OutboundFrame { bytes, bulk: false, request_id, priority: 0 });
                    }
                    metrics.active_requests.fetch_sub(1, Ordering::AcqRel);
                } else { break 'driver "range_producer_panicked"; }
            }
            _ = stats_tick.tick() => update_transport_metrics(&mut peer, &metrics),
            _ = async {
                #[cfg(feature = "experiment")]
                impairment_timer.await;
                #[cfg(not(feature = "experiment"))]
                std::future::pending::<()>().await;
            } => {},
            _ = &mut protocol_timer => {
                peer.handle_timeout(Instant::now())
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            }
            received = socket.recv_from(&mut receive_buffer) => {
                let (length, peer_addr) = received
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
                #[cfg(feature = "experiment")]
                if impairment.enabled() {
                    impairment.enqueue(true, peer_addr, &receive_buffer[..length]);
                    continue;
                }
                peer.handle_read(TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr,
                        peer_addr,
                        ecn: None,
                        transport_protocol: TransportProtocol::UDP,
                    },
                    message: BytesMut::from(&receive_buffer[..length]),
                })
                .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            }
            received = mdns_socket.recv_from(&mut mdns_receive_buffer) => {
                let (length, peer_addr) = received
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
                let mdns_local_addr = mdns_socket
                    .local_addr()
                    .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
                peer.handle_read(TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr: mdns_local_addr,
                        peer_addr,
                        ecn: None,
                        transport_protocol: TransportProtocol::UDP,
                    },
                    message: BytesMut::from(&mdns_receive_buffer[..length]),
                })
                .map_err(|error| DirectFileEndpointError::Driver(error.to_string()))?;
            }
        }
    };

    Ok::<_, DirectFileEndpointError>(terminal)
    }.await;
    let terminal = match &outcome {
        Ok(terminal) => *terminal,
        Err(_) => "driver_failed",
    };
    #[cfg(feature = "experiment")]
    {
        metrics
            .network_dropped
            .store(impairment.dropped, Ordering::Release);
        metrics
            .network_queue_high_water
            .store(impairment.high_water, Ordering::Release);
        metrics
            .network_overflow
            .store(impairment.overflow, Ordering::Release);
    }
    metrics.set_state("closing");
    metrics.set_terminal(terminal);
    cancellation.cancel();
    for request in requests.values() {
        request.cancellation.cancel();
    }
    outbound_rx.close();
    while request_tasks.join_next().await.is_some() {}
    requests.clear();
    metrics.active_requests.store(0, Ordering::Release);
    pending.clear();
    while outbound_rx.try_recv().is_ok() {}
    metrics.queued_bytes.store(0, Ordering::Release);
    metrics.credit_reserved_bytes.store(0, Ordering::Release);
    let close_result = peer
        .close()
        .map_err(|error| DirectFileEndpointError::Driver(error.to_string()));
    while let Some(transmit) = peer.poll_write() {
        let transmit_socket = if transmit.transport.peer_addr == MDNS_DEST_ADDR {
            &mdns_socket
        } else {
            &socket
        };
        let _ = transmit_socket
            .send_to(&transmit.message, transmit.transport.peer_addr)
            .await;
    }
    metrics.transport_buffered_bytes.store(0, Ordering::Release);
    metrics.set_state("closed");
    outcome.map(|_| ()).and(close_result)
}

#[allow(clippy::too_many_arguments)]
async fn run_range_request(
    application: SharedApplication,
    capability: String,
    request_id: u32,
    offset: u64,
    length: u32,
    mut acknowledgements: mpsc::Receiver<u64>,
    outbound: mpsc::Sender<OutboundFrame>,
    cancellation: CancellationToken,
    metrics: Arc<EndpointMetrics>,
    send_window_bytes: usize,
    source: ExperimentSource,
) -> &'static str {
    let lease = {
        let mut application = application.lock().await;
        application.resolve_media_capability(&capability)
    };
    let mut lease = match lease {
        Ok(lease) => lease,
        Err(MediaResolveError::NotFound | MediaResolveError::Busy) => {
            queue_frame(
                &outbound,
                &metrics,
                encode_range_error(request_id, RangeErrorCode::CapabilityUnavailable),
            )
            .await;
            return "capability_unavailable";
        }
    };
    let Some(end) = offset.checked_add(u64::from(length)) else {
        queue_frame(
            &outbound,
            &metrics,
            encode_range_error(request_id, RangeErrorCode::InvalidRange),
        )
        .await;
        return "invalid_range";
    };
    if end > lease.length() {
        queue_frame(
            &outbound,
            &metrics,
            encode_range_error(request_id, RangeErrorCode::InvalidRange),
        )
        .await;
        return "invalid_range";
    }
    if !queue_frame(
        &outbound,
        &metrics,
        encode_range_accepted(request_id, lease.length(), offset, length),
    )
    .await
    {
        return "queue_closed";
    }

    let mut window = SendWindow::new(offset, end, send_window_bytes);
    while !window.complete() {
        let Some((current, chunk_length)) = window.next_chunk() else {
            let acknowledged = tokio::select! {
                _ = cancellation.cancelled() => return "cancelled",
                result = tokio::time::timeout(REQUEST_INACTIVE_TIMEOUT, acknowledgements.recv()) => result,
            };
            match acknowledged {
                Ok(Some(next)) => match window.acknowledge(next) {
                    Ok(released) => lease.touch_served(released),
                    Err(()) => {
                        queue_frame(
                            &outbound,
                            &metrics,
                            encode_range_error(request_id, RangeErrorCode::Malformed),
                        )
                        .await;
                        return "invalid_ack";
                    }
                },
                Ok(None) => return "driver_closed",
                Err(_) => {
                    queue_frame(
                        &outbound,
                        &metrics,
                        encode_range_error(request_id, RangeErrorCode::Inactive),
                    )
                    .await;
                    return "inactive";
                }
            }
            continue;
        };
        let ready = lease.wait_for_range(current, chunk_length);
        let ready = tokio::select! {
            _ = cancellation.cancelled() => return "cancelled",
            result = ready => result,
        };
        if let Err(error) = ready {
            let code = match error {
                MediaRangeError::NoProgress
                | MediaRangeError::Revoked
                | MediaRangeError::Active(_) => RangeErrorCode::ReadUnavailable,
                MediaRangeError::Saturated => RangeErrorCode::Inactive,
            };
            queue_frame(&outbound, &metrics, encode_range_error(request_id, code)).await;
            return "range_unavailable";
        }
        let read = async {
            #[cfg(feature = "experiment")]
            if matches!(source, ExperimentSource::GeneratedRanges) {
                return Ok(generated_bytes(current, chunk_length));
            }
            #[cfg(not(feature = "experiment"))]
            let _ = source;
            lease.read_range(current, chunk_length).await
        };
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return "cancelled",
            result = read => match result {
                Ok(bytes) if bytes.len() == chunk_length => bytes,
                Ok(_) | Err(MediaReadError::Closed | MediaReadError::Verified(_) | MediaReadError::Active(_)) => {
                    queue_frame(
                        &outbound,
                        &metrics,
                        encode_range_error(request_id, RangeErrorCode::ReadUnavailable),
                    ).await;
                    return "read_unavailable";
                }
            },
        };
        let frame = match encode_range_chunk(request_id, current, &bytes) {
            Ok(frame) => frame,
            Err(_) => return "codec_error",
        };
        if !queue_frame(&outbound, &metrics, frame).await {
            return "queue_closed";
        }
        window.record_sent(chunk_length);
    }
    queue_frame(&outbound, &metrics, encode_range_complete(request_id)).await;
    "complete"
}

pub(crate) async fn queue_frame_to(
    outbound: &mpsc::Sender<OutboundFrame>,
    metrics: &EndpointMetrics,
    bytes: Vec<u8>,
    bulk: bool,
    request_id: u32,
    priority: u8,
) -> bool {
    let Ok(permit) = outbound.reserve().await else {
        return false;
    };
    loop {
        let notified = metrics.queue_space.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if reserve_counter(
            &metrics.queued_bytes,
            bytes.len(),
            MAX_APPLICATION_QUEUE_BYTES - 4096,
        )
        .is_ok()
        {
            metrics.queue_high_water.fetch_max(
                metrics.queued_bytes.load(Ordering::Acquire),
                Ordering::AcqRel,
            );
            break;
        }
        if tokio::time::timeout(REQUEST_INACTIVE_TIMEOUT, notified)
            .await
            .is_err()
        {
            return false;
        }
    }
    permit.send(OutboundFrame {
        bytes,
        bulk,
        request_id,
        priority,
    });
    true
}

async fn queue_frame(
    outbound: &mpsc::Sender<OutboundFrame>,
    metrics: &EndpointMetrics,
    bytes: Vec<u8>,
) -> bool {
    if reserve_queue(metrics, bytes.len()).is_err() {
        return false;
    }
    let length = bytes.len();
    if outbound
        .send(OutboundFrame {
            bytes,
            bulk: false,
            request_id: 0,
            priority: 0,
        })
        .await
        .is_err()
    {
        metrics.queued_bytes.fetch_sub(length, Ordering::AcqRel);
        return false;
    }
    true
}

fn try_queue_frame(
    outbound: &mpsc::Sender<OutboundFrame>,
    metrics: &EndpointMetrics,
    bytes: Vec<u8>,
) {
    if reserve_queue(metrics, bytes.len()).is_err() {
        return;
    }
    let length = bytes.len();
    if outbound
        .try_send(OutboundFrame {
            bytes,
            bulk: false,
            request_id: 0,
            priority: 0,
        })
        .is_err()
    {
        metrics.queued_bytes.fetch_sub(length, Ordering::AcqRel);
    }
}

fn reserve_queue(metrics: &EndpointMetrics, bytes: usize) -> Result<(), ()> {
    reserve_counter(&metrics.queued_bytes, bytes, MAX_APPLICATION_QUEUE_BYTES)?;
    metrics.queue_high_water.fetch_max(
        metrics.queued_bytes.load(Ordering::Acquire),
        Ordering::AcqRel,
    );
    Ok(())
}

fn reserve_counter(counter: &AtomicUsize, amount: usize, limit: usize) -> Result<(), ()> {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        let next = current.checked_add(amount).ok_or(())?;
        if next > limit {
            return Err(());
        }
        match counter.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return Ok(()),
            Err(observed) => current = observed,
        }
    }
}

fn update_transport_metrics(
    peer: &mut rtc::peer_connection::RTCPeerConnection,
    metrics: &EndpointMetrics,
) {
    let report = peer.get_stats(Instant::now(), StatsSelector::None);
    if let Some(pair) = report
        .candidate_pairs()
        .find(|pair| pair.nominated && pair.state == RTCStatsIceCandidatePairState::Succeeded)
    {
        let candidate_class = match report.get(&pair.local_candidate_id) {
            Some(RTCStatsReportEntry::LocalCandidate(candidate)) => {
                match candidate.candidate_type {
                    RTCIceCandidateType::Host => Some("host"),
                    RTCIceCandidateType::Srflx => Some("server_reflexive"),
                    RTCIceCandidateType::Prflx => Some("peer_reflexive"),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(candidate_class) = candidate_class {
            *lock_unpoisoned(&metrics.selected_candidate_class) = Some(candidate_class.to_owned());
        }
        let micros = if pair.current_round_trip_time.is_sign_negative()
            || !pair.current_round_trip_time.is_finite()
        {
            0
        } else {
            (pair.current_round_trip_time * 1_000_000.0).round() as u64
        };
        metrics.rtt_micros.store(micros, Ordering::Release);
        metrics.has_rtt.store(true, Ordering::Release);
    }
}

fn direct_udp_candidate(candidate: &str) -> bool {
    let fields = candidate.split_ascii_whitespace().collect::<Vec<_>>();
    if fields.len() < 8 || !fields[2].eq_ignore_ascii_case("udp") {
        return false;
    }
    let Some(candidate_type) = fields
        .windows(2)
        .find(|fields| fields[0].eq_ignore_ascii_case("typ"))
        .map(|fields| fields[1].to_ascii_lowercase())
    else {
        return false;
    };
    let Some(address) = fields.get(4) else {
        return false;
    };
    match candidate_type.as_str() {
        "host" => valid_direct_ip(address) || valid_mdns_host(address),
        "srflx" | "prflx" => valid_direct_ip(address),
        _ => false,
    }
}

fn valid_direct_ip(address: &str) -> bool {
    address
        .parse::<IpAddr>()
        .is_ok_and(|address| !address.is_unspecified() && !address.is_multicast())
}

fn valid_mdns_host(address: &str) -> bool {
    let Some(label) = address
        .get(..address.len().saturating_sub(".local".len()))
        .filter(|_| address.ends_with(".local"))
    else {
        return false;
    };
    let bytes = label.as_bytes();
    bytes.len() == 36
        && bytes[14] == b'4'
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

async fn bind_ip_from_offer(sdp: &str) -> Option<IpAddr> {
    for candidate in direct_candidate_addresses(sdp) {
        if candidate.ip().is_unspecified() || candidate.ip().is_multicast() {
            continue;
        }
        let wildcard = if candidate.is_ipv4() {
            SocketAddr::from(([0, 0, 0, 0], 0))
        } else {
            SocketAddr::from(([0_u16; 8], 0))
        };
        let Ok(socket) = UdpSocket::bind(wildcard).await else {
            continue;
        };
        if socket.connect(candidate).await.is_ok() {
            let Ok(local_addr) = socket.local_addr() else {
                continue;
            };
            let local_ip = local_addr.ip();
            if !local_ip.is_unspecified() {
                return Some(local_ip);
            }
        }
    }
    None
}

fn direct_candidate_addresses(sdp: &str) -> Vec<SocketAddr> {
    sdp.lines()
        .filter_map(|line| line.trim_end().strip_prefix("a=candidate:"))
        .filter(|candidate| direct_udp_candidate(candidate))
        .filter_map(|candidate| {
            let fields = candidate.split_ascii_whitespace().collect::<Vec<_>>();
            Some(SocketAddr::new(
                fields.get(4)?.parse().ok()?,
                fields.get(5)?.parse().ok()?,
            ))
        })
        .take(MAX_REMOTE_CANDIDATES)
        .collect()
}

async fn resolve_stun_route() -> Result<(IpAddr, Vec<SocketAddr>), DirectFileEndpointError> {
    let addresses = tokio::time::timeout(
        STUN_RESOLUTION_TIMEOUT,
        tokio::net::lookup_host((STUN_SERVER, STUN_PORT)),
    )
    .await
    .map_err(|_| DirectFileEndpointError::WebRtc("STUN DNS timed out".to_owned()))?
    .map_err(|error| DirectFileEndpointError::WebRtc(format!("STUN DNS failed: {error}")))?
    .take(MAX_STUN_ADDRESSES)
    .collect::<Vec<_>>();
    for address in &addresses {
        let wildcard = if address.is_ipv4() {
            SocketAddr::from(([0, 0, 0, 0], 0))
        } else {
            SocketAddr::from(([0_u16; 8], 0))
        };
        let socket = UdpSocket::bind(wildcard)
            .await
            .map_err(DirectFileEndpointError::Bind)?;
        if socket.connect(address).await.is_ok() {
            let bind_ip = socket
                .local_addr()
                .map_err(DirectFileEndpointError::Bind)?
                .ip();
            let compatible = addresses
                .iter()
                .copied()
                .filter(|candidate| candidate.is_ipv4() == bind_ip.is_ipv4())
                .collect();
            return Ok((bind_ip, compatible));
        }
    }
    Err(DirectFileEndpointError::WebRtc(
        "no routable STUN address".to_owned(),
    ))
}

async fn gather_server_reflexive(
    socket: &UdpSocket,
    local_addr: SocketAddr,
    servers: &[SocketAddr],
) -> Option<XorMappedAddress> {
    tokio::time::timeout(STUN_BINDING_TIMEOUT, async {
        for server in servers.iter().copied().take(MAX_STUN_ADDRESSES) {
            if let Some(mapped) = gather_one_server_reflexive(socket, local_addr, server).await {
                return Some(mapped);
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

async fn gather_one_server_reflexive(
    socket: &UdpSocket,
    local_addr: SocketAddr,
    server: SocketAddr,
) -> Option<XorMappedAddress> {
    let mut client = StunClientBuilder::new()
        .with_rto(Duration::from_millis(500))
        .build(Instant::now(), local_addr, server, TransportProtocol::UDP)
        .ok()?;
    let mut request = StunMessage::new();
    request
        .build(&[Box::<TransactionId>::default(), Box::new(BINDING_REQUEST)])
        .ok()?;
    client
        .handle_write(TaggedStunMessage {
            now: Instant::now(),
            message: request,
        })
        .ok()?;
    let mut buffer = [0_u8; MAX_DATAGRAM_BYTES];
    loop {
        while let Some(transmit) = client.poll_write() {
            socket
                .send_to(&transmit.message, transmit.transport.peer_addr)
                .await
                .ok()?;
        }
        if let Some(event) = client.poll_event() {
            match event {
                StunEvent::Message(message) => {
                    let mut mapped = XorMappedAddress::default();
                    mapped.get_from(&message).ok()?;
                    return Some(mapped);
                }
                _ => return None,
            }
        }
        let timeout = client.poll_timeout()?;
        let delay = timeout.saturating_duration_since(Instant::now());
        tokio::select! {
            () = tokio::time::sleep(delay) => {
                client.handle_timeout(Instant::now()).ok()?;
            }
            received = socket.recv_from(&mut buffer) => {
                let (length, peer_addr) = received.ok()?;
                if peer_addr != server {
                    continue;
                }
                client.handle_read(TaggedBytesMut {
                    now: Instant::now(),
                    transport: TransportContext {
                        local_addr,
                        peer_addr,
                        ecn: None,
                        transport_protocol: TransportProtocol::UDP,
                    },
                    message: BytesMut::from(&buffer[..length]),
                }).ok()?;
            }
        }
    }
}

fn validate_offer(offer: &RTCSessionDescription) -> Result<String, DirectFileEndpointError> {
    if offer.sdp_type != RTCSdpType::Offer {
        return Err(DirectFileEndpointError::InvalidOffer("description type"));
    }
    if offer.sdp.is_empty() || offer.sdp.len() > MAX_SIGNALING_BYTES {
        return Err(DirectFileEndpointError::SignalingLimit);
    }
    let candidates = offer
        .sdp
        .lines()
        .filter_map(|line| line.trim_end().strip_prefix("a=candidate:"))
        .collect::<Vec<_>>();
    if candidates.len() > MAX_REMOTE_CANDIDATES {
        return Err(DirectFileEndpointError::SignalingLimit);
    }
    if candidates
        .iter()
        .any(|candidate| !direct_udp_candidate(candidate))
    {
        return Err(DirectFileEndpointError::InvalidOffer(
            "non-direct ICE candidate",
        ));
    }
    fingerprint_from_sdp(&offer.sdp)
}

fn fingerprint_from_sdp(sdp: &str) -> Result<String, DirectFileEndpointError> {
    let mut fingerprints = sdp.lines().filter_map(|line| {
        line.trim_end()
            .strip_prefix("a=fingerprint:sha-256 ")
            .map(str::trim)
    });
    let fingerprint = fingerprints
        .next()
        .ok_or(DirectFileEndpointError::InvalidOffer(
            "missing SHA-256 fingerprint",
        ))?;
    if fingerprint.len() != 95
        || fingerprint.split(':').count() != 32
        || !fingerprint
            .bytes()
            .all(|byte| byte == b':' || byte.is_ascii_hexdigit())
    {
        return Err(DirectFileEndpointError::InvalidOffer(
            "malformed SHA-256 fingerprint",
        ));
    }
    if fingerprints.any(|candidate| !candidate.eq_ignore_ascii_case(fingerprint)) {
        return Err(DirectFileEndpointError::InvalidOffer(
            "conflicting SHA-256 fingerprints",
        ));
    }
    Ok(fingerprint.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FINGERPRINT: &str = "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";

    #[test]
    fn validates_one_consistent_sha256_fingerprint() {
        let sdp = format!(
            "v=0\r\na=fingerprint:sha-256 {FINGERPRINT}\r\na=fingerprint:sha-256 {}\r\n",
            FINGERPRINT.to_ascii_lowercase()
        );
        assert_eq!(
            fingerprint_from_sdp(&sdp).expect("fingerprint"),
            FINGERPRINT
        );
    }

    #[test]
    fn rejects_missing_malformed_and_conflicting_fingerprints() {
        assert!(fingerprint_from_sdp("v=0\r\n").is_err());
        assert!(fingerprint_from_sdp("a=fingerprint:sha-256 00:11\r\n").is_err());
        let conflicting = format!(
            "a=fingerprint:sha-256 {FINGERPRINT}\r\na=fingerprint:sha-256 {}\r\n",
            FINGERPRINT.replace("00", "01")
        );
        assert!(fingerprint_from_sdp(&conflicting).is_err());
    }

    #[test]
    fn queue_reservation_is_atomic_and_bounded() {
        let metrics = EndpointMetrics::default();
        assert!(reserve_queue(&metrics, MAX_APPLICATION_QUEUE_BYTES).is_ok());
        assert!(reserve_queue(&metrics, 1).is_err());
        assert_eq!(
            metrics.queue_high_water.load(Ordering::Acquire),
            MAX_APPLICATION_QUEUE_BYTES
        );
    }

    #[test]
    fn accepts_only_direct_udp_candidate_classes() {
        assert!(direct_udp_candidate(
            "candidate:1 1 UDP 2130706431 192.0.2.1 5000 typ host"
        ));
        assert!(direct_udp_candidate(
            "candidate:1 1 UDP 2113939711 61b445d2-6503-41ac-96ce-ee3edac00e9f.local 61163 typ host"
        ));
        assert!(direct_udp_candidate(
            "candidate:2 1 udp 1694498815 198.51.100.2 5001 typ srflx raddr 10.0.0.2 rport 4000"
        ));
        assert!(direct_udp_candidate(
            "candidate:3 1 udp 1677734911 198.51.100.3 5002 typ prflx"
        ));
        assert!(!direct_udp_candidate(
            "candidate:4 1 udp 1677729535 203.0.113.4 5003 typ relay"
        ));
        assert!(!direct_udp_candidate(
            "candidate:5 1 tcp 1518280447 192.0.2.5 9 typ host tcptype active"
        ));
        assert!(!direct_udp_candidate(
            "candidate:6 1 udp 2113939711 attacker.example 61163 typ host"
        ));
        assert!(!direct_udp_candidate(
            "candidate:7 1 udp 2113939711 not-a-uuid.local 61163 typ host"
        ));
        assert!(!direct_udp_candidate(
            "candidate:8 1 udp 2113939711 224.0.0.251 5353 typ host"
        ));
        assert!(!direct_udp_candidate("candidate:short"));
    }

    #[test]
    fn offer_rejects_relay_and_tcp_candidates_before_peer_creation() {
        for candidate in [
            "candidate:4 1 udp 1677729535 203.0.113.4 5003 typ relay",
            "candidate:5 1 tcp 1518280447 192.0.2.5 9 typ host tcptype active",
        ] {
            let offer = RTCSessionDescription::offer(format!(
                concat!(
                    "v=0\r\n",
                    "o=- 0 0 IN IP4 127.0.0.1\r\n",
                    "s=-\r\n",
                    "t=0 0\r\n",
                    "a=fingerprint:sha-256 {}\r\n",
                    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
                    "c=IN IP4 0.0.0.0\r\n",
                    "a=mid:0\r\n",
                    "a=sctp-port:5000\r\n",
                    "a={}\r\n"
                ),
                FINGERPRINT, candidate
            ))
            .expect("offer");
            assert!(matches!(
                validate_offer(&offer),
                Err(DirectFileEndpointError::InvalidOffer(
                    "non-direct ICE candidate"
                ))
            ));
        }
    }

    #[tokio::test]
    async fn offer_candidate_supplies_a_host_route_when_stun_is_unavailable() {
        let sdp = "v=0\r\na=candidate:1 1 UDP 2130706431 127.0.0.1 5000 typ host\r\n";
        assert_eq!(
            direct_candidate_addresses(sdp),
            vec![SocketAddr::from(([127, 0, 0, 1], 5000))]
        );
        assert_eq!(
            bind_ip_from_offer(sdp).await,
            Some(IpAddr::from([127, 0, 0, 1]))
        );
    }

    #[tokio::test]
    #[ignore = "contacts the selected public STUN service"]
    async fn cloudflare_stun_returns_one_bounded_server_reflexive_address() {
        let (bind_ip, addresses) = resolve_stun_route().await.expect("resolve STUN route");
        assert!(!addresses.is_empty());
        assert!(addresses.len() <= MAX_STUN_ADDRESSES);
        let socket = UdpSocket::bind(SocketAddr::new(bind_ip, 0))
            .await
            .expect("bind exact route address");
        let local_addr = socket.local_addr().expect("local address");
        let mapped = gather_server_reflexive(&socket, local_addr, &addresses)
            .await
            .expect("server-reflexive address");
        assert!(!mapped.ip.is_unspecified());
        assert_ne!(mapped.port, 0);
    }
}
