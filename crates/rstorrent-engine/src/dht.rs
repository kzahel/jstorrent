//! Session-owned, bounded Mainline DHT runtime.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::error::Error;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use rstorrent_protocol::dht::{
    ALPHA, DhtEndpoint, DhtIp, K, MAX_DATAGRAM_SIZE, Message, NodeContact, NodeId, Query,
    ResponseMessage, RoutingBucketInspection, RoutingTable, Want, decode_message, encode_error,
    encode_query, encode_response, generate_bep42_id, verify_bep42_id,
};
use sha1::{Digest, Sha1};
use tokio::net::{UdpSocket, lookup_host};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior, interval};
use tokio_util::sync::CancellationToken;

use crate::network::{AddressFamily, NetworkPolicy, is_valid_outbound_address};
use crate::{ByteMetric, ByteMetricSink, SessionUdpHandle, SessionUdpService, SessionUdpTransport};

pub const DHT_SNAPSHOT_VERSION: u32 = 2;
pub const MAX_PERSISTED_NODES_PER_FAMILY: usize = 64;
pub const MAX_PERSISTED_IDENTITIES_PER_FAMILY: usize = 8;
pub const MAX_ACTIVE_TRANSACTIONS: usize = 256;
pub const MAX_ACTIVE_LOOKUPS: usize = 16;
pub const MAX_LOOKUP_CANDIDATES: usize = 256;
pub const MAX_LOOKUP_PEERS: usize = 200;
pub const MAX_PEER_STORE_HASHES: usize = 256;
pub const MAX_PEERS_PER_HASH: usize = 100;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DhtAnnouncePorts {
    pub ipv4: u16,
    pub ipv6: u16,
}

impl DhtAnnouncePorts {
    #[must_use]
    pub const fn same(port: u16) -> Self {
        Self {
            ipv4: port,
            ipv6: port,
        }
    }

    #[must_use]
    pub const fn for_family(self, family: AddressFamily) -> Option<u16> {
        let port = match family {
            AddressFamily::Ipv4 => self.ipv4,
            AddressFamily::Ipv6 => self.ipv6,
        };
        if port == 0 { None } else { Some(port) }
    }

    fn validate(self) -> Result<Self, DhtError> {
        if self.ipv4 == 0 && self.ipv6 == 0 {
            return Err(DhtError::Configuration(
                "DHT peer announcement requires at least one nonzero TCP port",
            ));
        }
        Ok(self)
    }
}
pub const MAX_RATE_SOURCES: usize = 1024;
pub const MAX_QUERIES_PER_SOURCE_MINUTE: u16 = 30;
pub const MAX_GLOBAL_QUERIES_PER_SECOND: u16 = 250;
pub const DHT_COMMAND_QUEUE: usize = 64;
pub const DEFAULT_QUERY_TIMEOUT: Duration = Duration::from_secs(5);
pub const DEFAULT_LOOKUP_TIMEOUT: Duration = Duration::from_secs(30);
pub const DEFAULT_BOOTSTRAP_RETRY_INTERVAL: Duration = Duration::from_secs(60);
pub const DEFAULT_ROUTING_REFRESH_INTERVAL: Duration = Duration::from_secs(15 * 60);
pub const DHT_OBSERVATION_INTERVAL: Duration = Duration::from_millis(500);
pub const MAX_ANNOUNCE_PEER_NODES: usize = K;
const PEER_TTL: Duration = Duration::from_secs(30 * 60);
const TOKEN_ROTATION: Duration = Duration::from_secs(5 * 60);
const EXTERNAL_ADDRESS_VOTES: usize = 3;
const MAX_EXTERNAL_ADDRESS_CANDIDATES: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BootstrapNode {
    Address(SocketAddr),
    Host { host: String, port: u16 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DhtIdentity {
    pub address: IpAddr,
    pub node_id: NodeId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DhtSnapshot {
    pub version: u32,
    pub identities_v4: Vec<DhtIdentity>,
    pub identities_v6: Vec<DhtIdentity>,
    pub nodes_v4: Vec<NodeContact>,
    pub nodes_v6: Vec<NodeContact>,
}

impl DhtSnapshot {
    pub fn validate(mut self) -> Result<Self, DhtError> {
        if self.version != DHT_SNAPSHOT_VERSION {
            return Err(DhtError::UnsupportedSnapshotVersion(self.version));
        }
        if self.nodes_v4.len() > MAX_PERSISTED_NODES_PER_FAMILY
            || self.nodes_v6.len() > MAX_PERSISTED_NODES_PER_FAMILY
        {
            return Err(DhtError::InvalidSnapshot("too many saved nodes"));
        }
        if self.identities_v4.len() > MAX_PERSISTED_IDENTITIES_PER_FAMILY
            || self.identities_v6.len() > MAX_PERSISTED_IDENTITIES_PER_FAMILY
        {
            return Err(DhtError::InvalidSnapshot("too many saved identities"));
        }
        validate_identities(&mut self.identities_v4, AddressFamily::Ipv4)?;
        validate_identities(&mut self.identities_v6, AddressFamily::Ipv6)?;
        self.nodes_v4
            .retain(|node| node.address.is_ipv4() && valid_node_contact(*node));
        self.nodes_v6
            .retain(|node| node.address.is_ipv6() && valid_node_contact(*node));
        deduplicate_contacts(&mut self.nodes_v4);
        deduplicate_contacts(&mut self.nodes_v6);
        Ok(self)
    }
}

fn validate_identities(
    identities: &mut Vec<DhtIdentity>,
    family: AddressFamily,
) -> Result<(), DhtError> {
    if identities.iter().any(|identity| {
        AddressFamily::of(identity.address) != family
            || identity.address.is_unspecified()
            || identity.node_id == NodeId::ZERO
            || !verify_bep42_id(identity.node_id, dht_ip(identity.address))
    }) {
        return Err(DhtError::InvalidSnapshot("invalid saved identity"));
    }
    let mut addresses = HashSet::new();
    identities.retain(|identity| addresses.insert(identity.address));
    Ok(())
}

#[derive(Clone, Debug)]
pub struct DhtConfig {
    /// Whether the long-lived DHT owner participates on the wire.
    pub enabled: bool,
    pub network_policy: NetworkPolicy,
    pub bind_address: SocketAddr,
    pub bootstrap_nodes: Vec<BootstrapNode>,
    pub initial_snapshot: Option<DhtSnapshot>,
    pub query_timeout: Duration,
    pub lookup_timeout: Duration,
    pub bootstrap_retry_interval: Duration,
    pub routing_refresh_interval: Duration,
    pub peer_ttl: Duration,
    pub read_only: bool,
    pub byte_metric_sink: Option<Arc<dyn ByteMetricSink>>,
}

impl DhtConfig {
    pub fn for_network(network_policy: NetworkPolicy) -> Self {
        let bind_address = if matches!(network_policy, NetworkPolicy::Online) {
            SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0))
        } else {
            SocketAddr::from((Ipv4Addr::LOCALHOST, 0))
        };
        Self {
            enabled: true,
            network_policy,
            bind_address,
            bootstrap_nodes: vec![
                BootstrapNode::Host {
                    host: "dht.libtorrent.org".to_owned(),
                    port: 25401,
                },
                BootstrapNode::Host {
                    host: "router.bittorrent.com".to_owned(),
                    port: 6881,
                },
                BootstrapNode::Host {
                    host: "dht.transmissionbt.com".to_owned(),
                    port: 6881,
                },
            ],
            initial_snapshot: None,
            query_timeout: DEFAULT_QUERY_TIMEOUT,
            lookup_timeout: DEFAULT_LOOKUP_TIMEOUT,
            bootstrap_retry_interval: DEFAULT_BOOTSTRAP_RETRY_INTERVAL,
            routing_refresh_interval: DEFAULT_ROUTING_REFRESH_INTERVAL,
            peer_ttl: PEER_TTL,
            read_only: false,
            byte_metric_sink: None,
        }
    }

    fn validate(&self) -> Result<(), DhtError> {
        if !self.bind_address.is_ipv4() {
            return Err(DhtError::Configuration(
                "initial DHT runtime requires an IPv4 bind address",
            ));
        }
        if self.bind_address.port() != 0 || self.bind_address.ip().is_multicast() {
            return Err(DhtError::Configuration(
                "DHT bind address must use an ephemeral non-multicast port",
            ));
        }
        if self.query_timeout.is_zero() || self.lookup_timeout < self.query_timeout {
            return Err(DhtError::Configuration(
                "DHT timeouts must be nonzero and lookup timeout must cover a query",
            ));
        }
        if self.bootstrap_retry_interval.is_zero()
            || self.routing_refresh_interval.is_zero()
            || self.peer_ttl.is_zero()
        {
            return Err(DhtError::Configuration(
                "DHT bootstrap, refresh, and peer TTL intervals must be nonzero",
            ));
        }
        if self.bootstrap_nodes.len() > 64 {
            return Err(DhtError::Configuration("too many DHT bootstrap nodes"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DhtStats {
    pub routing_nodes_v4: u32,
    pub routing_nodes_v6: u32,
    pub active_transactions: u32,
    pub active_lookups: u32,
    pub queries_sent: u64,
    pub responses_received: u64,
    pub queries_received: u64,
    pub malformed_received: u64,
    pub family_mismatched: u64,
    pub rate_limited: u64,
    pub discovered_peers: u64,
    pub bootstrap_attempts: u64,
    pub routing_refreshes: u64,
    pub datagram_bytes_sent: u64,
    pub datagram_bytes_received: u64,
    pub announces_sent: u64,
    pub announces_succeeded: u64,
    pub announces_failed: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DhtAnnounceResult {
    pub peers: Vec<SocketAddr>,
    pub token_nodes: u8,
    pub announces_sent: u8,
    pub announces_succeeded: u8,
    pub announces_failed: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DhtLifecycle {
    Disabled,
    Offline,
    BootstrapEmpty,
    Participating,
    Inactive,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DhtLookupObservation {
    pub family: AddressFamily,
    pub lookup_id: u64,
    pub target: NodeId,
    pub age_millis: u64,
    pub deadline_in_millis: u64,
    pub unqueried_candidates: u16,
    pub in_flight_candidates: u16,
    pub responded_candidates: u16,
    pub failed_candidates: u16,
    pub discovered_peers: u16,
    pub closest_responded_prefix_bits: Option<u16>,
    pub last_convergence_improvement_age_millis: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DhtFamilyObservation {
    pub family: AddressFamily,
    pub lifecycle: DhtLifecycle,
    pub local_node_id: NodeId,
    pub local_address: SocketAddr,
    pub observed_external_address: Option<IpAddr>,
    pub routing_nodes: u16,
    pub occupied_buckets: u16,
    pub deepest_shared_prefix_bits: Option<u16>,
    pub stats: DhtStats,
    pub buckets: Vec<RoutingBucketInspection>,
    pub lookups: Vec<DhtLookupObservation>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DhtObservation {
    pub lifecycle: DhtLifecycle,
    pub network_policy: NetworkPolicy,
    pub captured_millis: u64,
    pub stats: DhtStats,
    pub families: Vec<DhtFamilyObservation>,
}

impl DhtObservation {
    fn initial(
        enabled: bool,
        network_policy: NetworkPolicy,
        nodes: &BTreeMap<AddressFamily, DhtNode>,
    ) -> Self {
        let lifecycle = if !enabled {
            DhtLifecycle::Disabled
        } else if matches!(network_policy, NetworkPolicy::Offline) {
            DhtLifecycle::Offline
        } else {
            DhtLifecycle::BootstrapEmpty
        };
        Self {
            lifecycle,
            network_policy,
            captured_millis: 0,
            stats: DhtStats::default(),
            families: nodes
                .iter()
                .map(|(&family, node)| {
                    let routing = node.routing.inspection(0);
                    DhtFamilyObservation {
                        family,
                        lifecycle,
                        local_node_id: node.node_id,
                        local_address: node.local_address,
                        observed_external_address: node.observed_external_address,
                        routing_nodes: routing.routing_nodes,
                        occupied_buckets: routing.occupied_buckets,
                        deepest_shared_prefix_bits: routing.deepest_shared_prefix_bits,
                        stats: DhtStats::default(),
                        buckets: routing.buckets,
                        lookups: Vec::new(),
                    }
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DhtError {
    Configuration(&'static str),
    Io(String),
    ActorStopped,
    NetworkDisabled,
    LookupCapacity,
    LookupTimedOut,
    NoReachableNodes,
    Cancelled,
    UnsupportedSnapshotVersion(u32),
    InvalidSnapshot(&'static str),
}

impl fmt::Display for DhtError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => {
                write!(formatter, "invalid DHT configuration: {message}")
            }
            Self::Io(message) => write!(formatter, "DHT I/O failed: {message}"),
            Self::ActorStopped => write!(formatter, "DHT owner stopped unexpectedly"),
            Self::NetworkDisabled => write!(formatter, "DHT networking is disabled"),
            Self::LookupCapacity => write!(formatter, "DHT lookup capacity is exhausted"),
            Self::LookupTimedOut => write!(formatter, "DHT peer lookup timed out"),
            Self::NoReachableNodes => write!(formatter, "DHT has no reachable nodes"),
            Self::Cancelled => write!(formatter, "DHT lookup was cancelled"),
            Self::UnsupportedSnapshotVersion(version) => {
                write!(formatter, "unsupported DHT snapshot version {version}")
            }
            Self::InvalidSnapshot(message) => write!(formatter, "invalid DHT snapshot: {message}"),
        }
    }
}

impl Error for DhtError {}

/// Receives peers from each `get_peers` reply while a lookup runs. Delivery is
/// best effort and deduplicated per lookup; the final result stays complete.
pub type DhtPeerProgress = mpsc::Sender<Vec<SocketAddr>>;

#[derive(Clone, Debug)]
pub struct DhtHandle {
    sender: mpsc::Sender<Command>,
    observations: watch::Receiver<DhtObservation>,
}

impl DhtHandle {
    pub async fn lookup(&self, info_hash: [u8; 20]) -> Result<Vec<SocketAddr>, DhtError> {
        self.lookup_inner(info_hash, None).await
    }

    pub async fn lookup_with_progress(
        &self,
        info_hash: [u8; 20],
        progress: DhtPeerProgress,
    ) -> Result<Vec<SocketAddr>, DhtError> {
        self.lookup_inner(info_hash, Some(progress)).await
    }

    async fn lookup_inner(
        &self,
        info_hash: [u8; 20],
        progress: Option<DhtPeerProgress>,
    ) -> Result<Vec<SocketAddr>, DhtError> {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Command::Lookup {
                info_hash: NodeId(info_hash),
                progress,
                result: sender,
            })
            .await
            .map_err(|_| DhtError::ActorStopped)?;
        receiver.await.map_err(|_| DhtError::ActorStopped)?
    }

    pub async fn lookup_and_announce(
        &self,
        info_hash: [u8; 20],
        port: u16,
    ) -> Result<DhtAnnounceResult, DhtError> {
        self.lookup_and_announce_ports(info_hash, DhtAnnouncePorts::same(port))
            .await
    }

    pub async fn lookup_and_announce_ports(
        &self,
        info_hash: [u8; 20],
        ports: DhtAnnouncePorts,
    ) -> Result<DhtAnnounceResult, DhtError> {
        self.lookup_and_announce_inner(info_hash, ports, None).await
    }

    pub async fn lookup_and_announce_ports_with_progress(
        &self,
        info_hash: [u8; 20],
        ports: DhtAnnouncePorts,
        progress: DhtPeerProgress,
    ) -> Result<DhtAnnounceResult, DhtError> {
        self.lookup_and_announce_inner(info_hash, ports, Some(progress))
            .await
    }

    async fn lookup_and_announce_inner(
        &self,
        info_hash: [u8; 20],
        ports: DhtAnnouncePorts,
        progress: Option<DhtPeerProgress>,
    ) -> Result<DhtAnnounceResult, DhtError> {
        let ports = ports.validate()?;
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Command::LookupAndAnnounce {
                info_hash: NodeId(info_hash),
                ports,
                progress,
                result: sender,
            })
            .await
            .map_err(|_| DhtError::ActorStopped)?;
        receiver.await.map_err(|_| DhtError::ActorStopped)?
    }

    pub async fn cancel_lookup(&self, info_hash: [u8; 20]) -> Result<(), DhtError> {
        self.sender
            .send(Command::CancelLookup(NodeId(info_hash)))
            .await
            .map_err(|_| DhtError::ActorStopped)
    }

    pub async fn stats(&self) -> Result<DhtStats, DhtError> {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Command::Stats(sender))
            .await
            .map_err(|_| DhtError::ActorStopped)?;
        receiver.await.map_err(|_| DhtError::ActorStopped)
    }

    pub async fn reconcile_transport(&self) -> Result<(), DhtError> {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Command::ReconcileTransport(sender))
            .await
            .map_err(|_| DhtError::ActorStopped)?;
        receiver.await.map_err(|_| DhtError::ActorStopped)?
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<(), DhtError> {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Command::SetEnabled {
                enabled,
                result: sender,
            })
            .await
            .map_err(|_| DhtError::ActorStopped)?;
        receiver.await.map_err(|_| DhtError::ActorStopped)?
    }

    pub fn subscribe_observations(&self) -> watch::Receiver<DhtObservation> {
        self.observations.clone()
    }
}

#[derive(Debug)]
pub struct DhtService {
    handle: DhtHandle,
    cancellation: CancellationToken,
    task: Option<JoinHandle<Result<DhtSnapshot, DhtError>>>,
    transport: SessionUdpHandle,
    observations: watch::Receiver<DhtObservation>,
    owned_udp: Option<SessionUdpService>,
}

impl DhtService {
    pub async fn start(config: DhtConfig) -> Result<Self, DhtError> {
        config.validate()?;
        let socket = UdpSocket::bind(config.bind_address)
            .await
            .map_err(|error| DhtError::Io(error.to_string()))?;
        let (udp, transport) =
            SessionUdpService::start(socket).map_err(|error| DhtError::Io(error.to_string()))?;
        match Self::start_inner(config, transport, CancellationToken::new()).await {
            Ok(mut dht) => {
                dht.owned_udp = Some(udp);
                Ok(dht)
            }
            Err(error) => {
                let _ = udp.shutdown().await;
                Err(error)
            }
        }
    }

    pub async fn start_with_transport(
        config: DhtConfig,
        transport: SessionUdpTransport,
    ) -> Result<Self, DhtError> {
        Self::start_inner(config, transport, CancellationToken::new()).await
    }

    pub async fn start_with_transport_and_cancellation(
        config: DhtConfig,
        transport: SessionUdpTransport,
        cancellation: CancellationToken,
    ) -> Result<Self, DhtError> {
        Self::start_inner(config, transport, cancellation).await
    }

    async fn start_inner(
        mut config: DhtConfig,
        transport: SessionUdpTransport,
        cancellation: CancellationToken,
    ) -> Result<Self, DhtError> {
        config.validate()?;
        validate_transport(&config, transport.local_address())?;
        let snapshot = config
            .initial_snapshot
            .take()
            .map(DhtSnapshot::validate)
            .transpose()?;
        let transport_handle = transport.handle();
        let bootstrap = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(DhtError::Cancelled),
            bootstrap = resolve_bootstrap(&config, snapshot.as_ref(), config.enabled) => bootstrap,
        };
        let now = Instant::now();
        let mut nodes = BTreeMap::new();
        let mut identity_hints = BTreeMap::from([
            (
                AddressFamily::Ipv4,
                snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.identities_v4.clone())
                    .unwrap_or_default(),
            ),
            (
                AddressFamily::Ipv6,
                snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.identities_v6.clone())
                    .unwrap_or_default(),
            ),
        ]);
        for family in [AddressFamily::Ipv4, AddressFamily::Ipv6] {
            let Some(local_address) = transport.local_address_for(family) else {
                continue;
            };
            let family_bootstrap = bootstrap.families.get(&family).cloned().unwrap_or_default();
            let node = DhtNode::new(
                local_address,
                identity_hints
                    .get(&family)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
                family_bootstrap,
                now,
            );
            let node = node?;
            identity_hints.insert(family, node.identities.clone());
            nodes.insert(family, node);
        }
        if nodes.is_empty() {
            return Err(DhtError::Configuration(
                "DHT transport has no active family",
            ));
        }
        let (sender, receiver) = mpsc::channel(DHT_COMMAND_QUEUE);
        let (observation_sender, observations) = watch::channel(DhtObservation::initial(
            config.enabled,
            config.network_policy,
            &nodes,
        ));
        let task_cancellation = cancellation.clone();
        let actor = Actor::new(
            config,
            transport,
            nodes,
            bootstrap.families,
            identity_hints,
            receiver,
            task_cancellation,
            observation_sender,
        )?;
        let task = tokio::spawn(async move { actor.run().await });
        Ok(Self {
            handle: DhtHandle {
                sender,
                observations: observations.clone(),
            },
            cancellation,
            task: Some(task),
            transport: transport_handle,
            observations,
            owned_udp: None,
        })
    }

    pub fn handle(&self) -> DhtHandle {
        self.handle.clone()
    }

    pub fn local_address(&self) -> SocketAddr {
        self.transport.local_address()
    }

    pub fn subscribe_observations(&self) -> watch::Receiver<DhtObservation> {
        self.observations.clone()
    }

    pub async fn shutdown(mut self) -> Result<DhtSnapshot, DhtError> {
        let (sender, receiver) = oneshot::channel();
        if self
            .handle
            .sender
            .send(Command::Shutdown(sender))
            .await
            .is_ok()
        {
            let _ = receiver.await;
        } else {
            self.cancellation.cancel();
        }
        let Some(task) = self.task.take() else {
            return Err(DhtError::ActorStopped);
        };
        let actor_result = task
            .await
            .map_err(|error| DhtError::Io(error.to_string()))?;
        let udp_result = if let Some(udp) = self.owned_udp.take() {
            udp.shutdown()
                .await
                .map(|_| ())
                .map_err(|error| DhtError::Io(error.to_string()))
        } else {
            Ok(())
        };
        let snapshot = actor_result?;
        udp_result?;
        Ok(snapshot)
    }
}

impl Drop for DhtService {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

fn validate_transport(config: &DhtConfig, address: SocketAddr) -> Result<(), DhtError> {
    if !address.is_ipv4()
        || address.port() == 0
        || (!config.bind_address.ip().is_unspecified() && config.bind_address.ip() != address.ip())
    {
        return Err(DhtError::Configuration(
            "session UDP transport does not match the DHT bind policy",
        ));
    }
    Ok(())
}

#[derive(Debug)]
enum Command {
    SetEnabled {
        enabled: bool,
        result: oneshot::Sender<Result<(), DhtError>>,
    },
    Lookup {
        info_hash: NodeId,
        progress: Option<DhtPeerProgress>,
        result: oneshot::Sender<Result<Vec<SocketAddr>, DhtError>>,
    },
    LookupAndAnnounce {
        info_hash: NodeId,
        ports: DhtAnnouncePorts,
        progress: Option<DhtPeerProgress>,
        result: oneshot::Sender<Result<DhtAnnounceResult, DhtError>>,
    },
    CancelLookup(NodeId),
    Stats(oneshot::Sender<DhtStats>),
    ReconcileTransport(oneshot::Sender<Result<(), DhtError>>),
    Shutdown(oneshot::Sender<()>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CandidateState {
    Unqueried,
    InFlight,
    Responded,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Candidate {
    contact: Option<NodeContact>,
    address: SocketAddr,
    state: CandidateState,
}

#[derive(Debug)]
struct Lookup {
    id: u64,
    target: NodeId,
    family: AddressFamily,
    candidates: Vec<Candidate>,
    peers: BTreeSet<SocketAddr>,
    announce_port: Option<u16>,
    token_responders: Vec<TokenResponder>,
    announce_started: bool,
    announce_pending: BTreeSet<SocketAddr>,
    announce_token_nodes: u8,
    announce_sent: u8,
    announce_succeeded: u8,
    announce_failed: u8,
    deadline: Instant,
    started_at: Instant,
    closest_responded_prefix_bits: Option<u16>,
    last_convergence_improvement_at: Option<Instant>,
}

#[derive(Debug)]
struct Announcement {
    ports: DhtAnnouncePorts,
    result: oneshot::Sender<Result<DhtAnnounceResult, DhtError>>,
}

#[derive(Debug)]
struct LookupGroup {
    waiters: Vec<oneshot::Sender<Result<Vec<SocketAddr>, DhtError>>>,
    announcement: Option<Announcement>,
    progress: Vec<DhtPeerProgress>,
    /// Peers already sent to `progress`, at most `MAX_LOOKUP_PEERS` per family.
    streamed: BTreeSet<SocketAddr>,
    pending: BTreeSet<AddressFamily>,
    peers: BTreeSet<SocketAddr>,
    failures: Vec<DhtError>,
    reached: bool,
    token_nodes: u8,
    announces_sent: u8,
    announces_succeeded: u8,
    announces_failed: u8,
}

#[derive(Debug)]
struct FamilyLookupResult {
    peers: BTreeSet<SocketAddr>,
    result: Result<(), DhtError>,
    reached: bool,
    token_nodes: u8,
    announces_sent: u8,
    announces_succeeded: u8,
    announces_failed: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TokenResponder {
    contact: NodeContact,
    address: SocketAddr,
    token: Vec<u8>,
}

impl Lookup {
    fn new(
        id: u64,
        target: NodeId,
        family: AddressFamily,
        seeds: impl IntoIterator<Item = Candidate>,
        deadline: Instant,
        now: Instant,
    ) -> Self {
        let mut lookup = Self {
            id,
            target,
            family,
            candidates: Vec::new(),
            peers: BTreeSet::new(),
            announce_port: None,
            token_responders: Vec::new(),
            announce_started: false,
            announce_pending: BTreeSet::new(),
            announce_token_nodes: 0,
            announce_sent: 0,
            announce_succeeded: 0,
            announce_failed: 0,
            deadline,
            started_at: now,
            closest_responded_prefix_bits: None,
            last_convergence_improvement_at: None,
        };
        for seed in seeds {
            lookup.add_candidate(seed.contact, seed.address);
        }
        lookup
    }

    fn add_token_responder(&mut self, contact: NodeContact, address: SocketAddr, token: Vec<u8>) {
        if token.is_empty() {
            return;
        }
        if let Some(existing) = self
            .token_responders
            .iter_mut()
            .find(|responder| responder.address == address || responder.contact.id == contact.id)
        {
            *existing = TokenResponder {
                contact,
                address,
                token,
            };
            return;
        }
        if self.token_responders.len() < MAX_LOOKUP_CANDIDATES {
            self.token_responders.push(TokenResponder {
                contact,
                address,
                token,
            });
        }
    }

    fn closest_token_responders(&self) -> Vec<TokenResponder> {
        let mut responders = self.token_responders.clone();
        responders.sort_by(|left, right| {
            NodeId::compare_distance(left.contact.id, right.contact.id, self.target)
                .then_with(|| left.address.cmp(&right.address))
        });
        responders.truncate(MAX_ANNOUNCE_PEER_NODES);
        responders
    }

    fn add_candidate(&mut self, contact: Option<NodeContact>, address: SocketAddr) {
        if self.candidates.len() >= MAX_LOOKUP_CANDIDATES
            || self.candidates.iter().any(|candidate| {
                candidate.address == address
                    || contact.is_some_and(|contact| candidate.contact == Some(contact))
            })
        {
            return;
        }
        self.candidates.push(Candidate {
            contact,
            address,
            state: CandidateState::Unqueried,
        });
        self.sort_candidates();
    }

    fn sort_candidates(&mut self) {
        self.candidates
            .sort_by(|left, right| match (left.contact, right.contact) {
                (Some(left), Some(right)) => {
                    NodeId::compare_distance(left.id, right.id, self.target)
                }
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => left.address.cmp(&right.address),
            });
    }

    fn next_queries(&mut self) -> Vec<SocketAddr> {
        let in_flight = self
            .candidates
            .iter()
            .filter(|candidate| candidate.state == CandidateState::InFlight)
            .count();
        let slots = ALPHA.saturating_sub(in_flight);
        let mut addresses = Vec::with_capacity(slots);
        for candidate in self
            .candidates
            .iter_mut()
            .filter(|candidate| candidate.state == CandidateState::Unqueried)
            .take(slots)
        {
            candidate.state = CandidateState::InFlight;
            addresses.push(candidate.address);
        }
        addresses
    }

    fn mark(&mut self, address: SocketAddr, state: CandidateState, contact: Option<NodeContact>) {
        if let Some(candidate) = self
            .candidates
            .iter_mut()
            .find(|candidate| candidate.address == address)
        {
            candidate.state = state;
            if contact.is_some() {
                candidate.contact = contact;
            }
            if state == CandidateState::Responded
                && let Some(contact) = candidate.contact
            {
                let prefix = self.target.shared_prefix_bits(contact.id);
                if self
                    .closest_responded_prefix_bits
                    .is_none_or(|closest| prefix > closest)
                {
                    self.closest_responded_prefix_bits = Some(prefix);
                    self.last_convergence_improvement_at = Some(Instant::now());
                }
            }
        }
        self.sort_candidates();
    }

    fn observation(&self, now: Instant) -> DhtLookupObservation {
        let count = |state| {
            self.candidates
                .iter()
                .filter(|candidate| candidate.state == state)
                .count() as u16
        };
        DhtLookupObservation {
            family: self.family,
            lookup_id: self.id,
            target: self.target,
            age_millis: duration_millis(now.saturating_duration_since(self.started_at)),
            deadline_in_millis: duration_millis(self.deadline.saturating_duration_since(now)),
            unqueried_candidates: count(CandidateState::Unqueried),
            in_flight_candidates: count(CandidateState::InFlight),
            responded_candidates: count(CandidateState::Responded),
            failed_candidates: count(CandidateState::Failed),
            discovered_peers: self.peers.len() as u16,
            closest_responded_prefix_bits: self.closest_responded_prefix_bits,
            last_convergence_improvement_age_millis: self
                .last_convergence_improvement_at
                .map(|at| duration_millis(now.saturating_duration_since(at))),
        }
    }

    fn has_work(&self) -> bool {
        if self.announce_started {
            return !self.announce_pending.is_empty();
        }
        self.candidates.iter().any(|candidate| {
            matches!(
                candidate.state,
                CandidateState::Unqueried | CandidateState::InFlight
            )
        })
    }

    fn completed_result(&self) -> Option<Result<Vec<SocketAddr>, DhtError>> {
        if self.announce_port.is_some() || self.has_work() {
            return None;
        }
        if self.peers.is_empty() {
            Some(Err(DhtError::NoReachableNodes))
        } else {
            Some(Ok(self.peers.iter().copied().collect()))
        }
    }

    fn timeout_result(&self) -> Result<Vec<SocketAddr>, DhtError> {
        if self.peers.is_empty() {
            Err(DhtError::LookupTimedOut)
        } else {
            Ok(self.peers.iter().copied().collect())
        }
    }

    fn finish(self, result: Result<Vec<SocketAddr>, DhtError>) -> FamilyLookupResult {
        FamilyLookupResult {
            reached: self
                .candidates
                .iter()
                .any(|candidate| candidate.state == CandidateState::Responded),
            peers: self.peers,
            result: result.map(|_| ()),
            token_nodes: self.announce_token_nodes,
            announces_sent: self.announce_sent,
            announces_succeeded: self.announce_succeeded,
            announces_failed: self.announce_failed,
        }
    }
}

impl LookupGroup {
    fn with_waiter(waiter: oneshot::Sender<Result<Vec<SocketAddr>, DhtError>>) -> Self {
        let mut group = Self::empty();
        group.waiters.push(waiter);
        group
    }

    fn with_announcement(announcement: Announcement) -> Self {
        let mut group = Self::empty();
        group.announcement = Some(announcement);
        group
    }

    fn empty() -> Self {
        Self {
            waiters: Vec::new(),
            announcement: None,
            progress: Vec::new(),
            streamed: BTreeSet::new(),
            pending: BTreeSet::new(),
            peers: BTreeSet::new(),
            failures: Vec::new(),
            reached: false,
            token_nodes: 0,
            announces_sent: 0,
            announces_succeeded: 0,
            announces_failed: 0,
        }
    }

    /// A requester joining a running lookup first receives what was already streamed.
    fn add_progress(&mut self, progress: Option<DhtPeerProgress>) {
        let Some(progress) = progress else {
            return;
        };
        if !self.streamed.is_empty() {
            let _ = progress.try_send(self.streamed.iter().copied().collect());
        }
        self.progress.push(progress);
    }

    /// Never blocks the actor: a full or closed channel loses only this early
    /// copy, because the final result still carries every peer.
    fn stream(&mut self, peers: impl IntoIterator<Item = SocketAddr>) {
        let fresh = peers
            .into_iter()
            .filter(|peer| self.streamed.insert(*peer))
            .collect::<Vec<_>>();
        if fresh.is_empty() {
            return;
        }
        self.progress.retain(|progress| !progress.is_closed());
        for progress in &self.progress {
            let _ = progress.try_send(fresh.clone());
        }
    }

    fn record(&mut self, family: AddressFamily, outcome: FamilyLookupResult) {
        self.pending.remove(&family);
        self.peers.extend(outcome.peers);
        self.reached |= outcome.reached;
        self.token_nodes = self.token_nodes.saturating_add(outcome.token_nodes);
        self.announces_sent = self.announces_sent.saturating_add(outcome.announces_sent);
        self.announces_succeeded = self
            .announces_succeeded
            .saturating_add(outcome.announces_succeeded);
        self.announces_failed = self
            .announces_failed
            .saturating_add(outcome.announces_failed);
        if let Err(error) = outcome.result {
            self.failures.push(error);
        }
    }

    fn finish(self) {
        let successful = !self.peers.is_empty()
            || (self.announcement.is_some() && self.reached)
            || self.failures.is_empty();
        let error = self
            .failures
            .first()
            .cloned()
            .unwrap_or(DhtError::NoReachableNodes);
        let peers = self.peers.into_iter().collect::<Vec<_>>();
        let result = if successful {
            Ok(peers.clone())
        } else {
            Err(error)
        };
        for waiter in self.waiters {
            let _ = waiter.send(result.clone());
        }
        if let Some(announcement) = self.announcement {
            let _ = announcement.result.send(result.map(|_| DhtAnnounceResult {
                peers,
                token_nodes: self.token_nodes,
                announces_sent: self.announces_sent,
                announces_succeeded: self.announces_succeeded,
                announces_failed: self.announces_failed,
            }));
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TransactionOwner {
    Bootstrap {
        family: AddressFamily,
        target: NodeId,
    },
    Lookup {
        family: AddressFamily,
        info_hash: NodeId,
    },
    Announce {
        family: AddressFamily,
        info_hash: NodeId,
    },
}

impl TransactionOwner {
    fn family(self) -> AddressFamily {
        match self {
            Self::Bootstrap { family, .. }
            | Self::Lookup { family, .. }
            | Self::Announce { family, .. } => family,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Transaction {
    endpoint: SocketAddr,
    contact: Option<NodeContact>,
    owner: TransactionOwner,
    logical_family: AddressFamily,
    wire_family: AddressFamily,
    deadline: Instant,
}

#[derive(Clone, Copy, Debug)]
struct StoredPeer {
    address: SocketAddr,
    expires_at: Instant,
}

#[derive(Clone, Copy, Debug)]
struct RateWindow {
    started: Instant,
    count: u16,
}

#[derive(Debug, Default)]
struct ExternalAddressVotes {
    candidates: HashMap<IpAddr, HashSet<IpAddr>>,
}

impl ExternalAddressVotes {
    fn observe(&mut self, address: IpAddr, voter: IpAddr) -> bool {
        if !self.candidates.contains_key(&address)
            && self.candidates.len() == MAX_EXTERNAL_ADDRESS_CANDIDATES
        {
            self.candidates.clear();
        }
        let voters = self.candidates.entry(address).or_default();
        voters.insert(voter);
        if voters.len() < EXTERNAL_ADDRESS_VOTES {
            return false;
        }
        self.candidates.clear();
        true
    }

    fn clear(&mut self) {
        self.candidates.clear();
    }
}

#[derive(Debug)]
struct Tokens {
    current: [u8; 20],
    previous: [u8; 20],
    rotated_at: Instant,
}

impl Tokens {
    fn new(now: Instant) -> Result<Self, DhtError> {
        Ok(Self {
            current: random_bytes()?,
            previous: random_bytes()?,
            rotated_at: now,
        })
    }

    fn rotate_if_due(&mut self, now: Instant) -> Result<(), DhtError> {
        if now.duration_since(self.rotated_at) >= TOKEN_ROTATION {
            self.previous = self.current;
            self.current = random_bytes()?;
            self.rotated_at = now;
        }
        Ok(())
    }

    fn generate(&self, source: IpAddr, info_hash: NodeId) -> Vec<u8> {
        token_digest(source, &self.current, info_hash)[..8].to_vec()
    }

    fn verify(&self, token: &[u8], source: IpAddr, info_hash: NodeId) -> bool {
        if token.len() != 8 {
            return false;
        }
        [self.current, self.previous]
            .iter()
            .any(|secret| token_digest(source, secret, info_hash)[..8] == *token)
    }
}

#[derive(Debug)]
struct DhtNode {
    local_address: SocketAddr,
    node_id: NodeId,
    identities: Vec<DhtIdentity>,
    routing: RoutingTable,
    warm_bootstrap: Vec<SocketAddr>,
    fallback_bootstrap: Vec<SocketAddr>,
    fallback_pending: bool,
    bootstrap_queried: HashSet<SocketAddr>,
    last_bootstrap: Instant,
    last_refresh: Instant,
    source_rates: HashMap<IpAddr, RateWindow>,
    global_rate: RateWindow,
    tokens: Tokens,
    external_votes: ExternalAddressVotes,
    observed_external_address: Option<IpAddr>,
}

impl DhtNode {
    fn new(
        local_address: SocketAddr,
        identities: &[DhtIdentity],
        bootstrap: FamilyBootstrap,
        now: Instant,
    ) -> Result<Self, DhtError> {
        let identity = select_identity(identities, local_address.ip());
        let node_id = identity
            .map(|identity| identity.node_id)
            .unwrap_or(generate_bep42_id(
                dht_ip(local_address.ip()),
                random_bytes()?,
            ));
        let identities = identity
            .cloned()
            .or_else(|| {
                (!local_address.ip().is_unspecified()).then_some(DhtIdentity {
                    address: local_address.ip(),
                    node_id,
                })
            })
            .into_iter()
            .collect();
        Ok(Self {
            local_address,
            node_id,
            identities,
            routing: RoutingTable::new(node_id),
            warm_bootstrap: bootstrap.warm,
            fallback_bootstrap: bootstrap.fallback,
            fallback_pending: false,
            bootstrap_queried: HashSet::new(),
            last_bootstrap: now,
            last_refresh: now,
            source_rates: HashMap::new(),
            global_rate: RateWindow {
                started: now,
                count: 0,
            },
            tokens: Tokens::new(now)?,
            external_votes: ExternalAddressVotes::default(),
            observed_external_address: None,
        })
    }

    fn remember_identity(&mut self, address: IpAddr, node_id: NodeId) {
        self.identities
            .retain(|identity| identity.address != address);
        self.identities.push(DhtIdentity { address, node_id });
        if self.identities.len() > MAX_PERSISTED_IDENTITIES_PER_FAMILY {
            self.identities.remove(0);
        }
    }
}

fn select_identity(identities: &[DhtIdentity], address: IpAddr) -> Option<&DhtIdentity> {
    identities
        .iter()
        .find(|identity| identity.address == address)
}

#[derive(Debug)]
struct Actor {
    config: DhtConfig,
    enabled: bool,
    transport: SessionUdpTransport,
    started: Instant,
    nodes: BTreeMap<AddressFamily, DhtNode>,
    bootstrap_templates: BTreeMap<AddressFamily, FamilyBootstrap>,
    identity_hints: BTreeMap<AddressFamily, Vec<DhtIdentity>>,
    transactions: HashMap<(u16, SocketAddr), Transaction>,
    lookups: HashMap<(NodeId, AddressFamily), Lookup>,
    lookup_groups: HashMap<NodeId, LookupGroup>,
    peer_store: HashMap<(NodeId, AddressFamily), Vec<StoredPeer>>,
    commands: mpsc::Receiver<Command>,
    cancellation: CancellationToken,
    stats: DhtStats,
    family_stats: BTreeMap<AddressFamily, DhtStats>,
    observations: watch::Sender<DhtObservation>,
    last_observation: Instant,
    next_lookup_id: u64,
}

impl Actor {
    #[allow(clippy::too_many_arguments)]
    fn new(
        config: DhtConfig,
        transport: SessionUdpTransport,
        nodes: BTreeMap<AddressFamily, DhtNode>,
        bootstrap_templates: BTreeMap<AddressFamily, FamilyBootstrap>,
        identity_hints: BTreeMap<AddressFamily, Vec<DhtIdentity>>,
        commands: mpsc::Receiver<Command>,
        cancellation: CancellationToken,
        observations: watch::Sender<DhtObservation>,
    ) -> Result<Self, DhtError> {
        let now = Instant::now();
        let family_stats = nodes
            .keys()
            .copied()
            .map(|family| (family, DhtStats::default()))
            .collect();
        Ok(Self {
            enabled: config.enabled,
            config,
            transport,
            started: now,
            nodes,
            bootstrap_templates,
            identity_hints,
            transactions: HashMap::new(),
            lookups: HashMap::new(),
            lookup_groups: HashMap::new(),
            peer_store: HashMap::new(),
            commands,
            cancellation,
            stats: DhtStats::default(),
            family_stats,
            observations,
            last_observation: now,
            next_lookup_id: 1,
        })
    }

    fn record_stats(&mut self, family: AddressFamily, update: impl Fn(&mut DhtStats)) {
        update(&mut self.stats);
        update(self.family_stats.entry(family).or_default());
    }

    async fn run(mut self) -> Result<DhtSnapshot, DhtError> {
        let result = self.run_active().await;
        if result.is_err() {
            self.cancel_all(DhtError::ActorStopped);
        }
        self.publish_observation(Some(DhtLifecycle::Inactive));
        result.map(|()| self.snapshot())
    }

    async fn run_active(&mut self) -> Result<(), DhtError> {
        if self.enabled {
            let _ = self.bootstrap().await;
        }
        self.publish_observation(None);
        let mut maintenance = interval(Duration::from_millis(200));
        maintenance.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                _ = self.cancellation.cancelled() => {
                    self.cancel_all(DhtError::Cancelled);
                    return Ok(());
                }
                command = self.commands.recv() => {
                    match command {
                        Some(Command::Shutdown(acknowledge)) => {
                            self.cancel_all(DhtError::Cancelled);
                            let _ = acknowledge.send(());
                            return Ok(());
                        }
                        Some(command) => self.handle_command(command).await?,
                        None => {
                            self.cancel_all(DhtError::ActorStopped);
                            return Ok(());
                        }
                    }
                }
                received = self.transport.receive() => {
                    match received {
                        Ok((bytes, source, wire_family)) => {
                            if !self.enabled {
                                continue;
                            }
                            if AddressFamily::of(source.ip()) != wire_family
                                || !self.nodes.contains_key(&wire_family)
                            {
                                self.record_stats(wire_family, |stats| {
                                    stats.family_mismatched =
                                        stats.family_mismatched.saturating_add(1);
                                });
                                continue;
                            }
                            let length = bytes.len();
                            self.record_stats(wire_family, |stats| {
                                stats.datagram_bytes_received = stats
                                    .datagram_bytes_received
                                    .saturating_add(length as u64);
                            });
                            if let Some(sink) = &self.config.byte_metric_sink {
                                sink.record(ByteMetric::DhtReceived, length as u64);
                            }
                            if length <= MAX_DATAGRAM_SIZE {
                                self.handle_datagram(&bytes, source, wire_family).await?;
                            } else {
                                self.record_stats(wire_family, |stats| {
                                    stats.malformed_received =
                                        stats.malformed_received.saturating_add(1);
                                });
                            }
                        }
                        Err(error) => return Err(DhtError::Io(error.to_string())),
                    }
                }
                _ = maintenance.tick() => {
                    if self.enabled {
                        self.maintain().await?;
                    }
                    if Instant::now().saturating_duration_since(self.last_observation)
                        >= DHT_OBSERVATION_INTERVAL
                    {
                        self.publish_observation(None);
                    }
                },
            }
        }
    }

    async fn bootstrap(&mut self) -> Result<(), DhtError> {
        if matches!(self.config.network_policy, NetworkPolicy::Offline) {
            return Ok(());
        }
        let families = self.nodes.keys().copied().collect::<Vec<_>>();
        for family in families {
            self.bootstrap_family(family).await?;
        }
        Ok(())
    }

    async fn bootstrap_family(&mut self, family: AddressFamily) -> Result<(), DhtError> {
        let Some(node) = self.nodes.get_mut(&family) else {
            return Ok(());
        };
        let endpoints = if node.warm_bootstrap.is_empty() {
            node.fallback_pending = false;
            node.fallback_bootstrap.clone()
        } else {
            node.fallback_pending = !node.fallback_bootstrap.is_empty();
            node.warm_bootstrap.clone()
        };
        self.start_bootstrap(family, endpoints).await
    }

    async fn bootstrap_fallback(&mut self, family: AddressFamily) -> Result<(), DhtError> {
        let Some(node) = self.nodes.get_mut(&family) else {
            return Ok(());
        };
        node.fallback_pending = false;
        let endpoints = node.fallback_bootstrap.clone();
        self.start_bootstrap(family, endpoints).await
    }

    async fn start_bootstrap(
        &mut self,
        family: AddressFamily,
        endpoints: Vec<SocketAddr>,
    ) -> Result<(), DhtError> {
        let Some(node) = self.nodes.get_mut(&family) else {
            return Ok(());
        };
        node.bootstrap_queried.clear();
        node.last_bootstrap = Instant::now();
        let target = node.node_id;
        self.record_stats(family, |stats| {
            stats.bootstrap_attempts = stats.bootstrap_attempts.saturating_add(1);
        });
        for endpoint in endpoints {
            if self.transaction_count(family) == MAX_ACTIVE_TRANSACTIONS {
                break;
            }
            if !self
                .nodes
                .get_mut(&family)
                .expect("bootstrap family remains")
                .bootstrap_queried
                .insert(endpoint)
            {
                continue;
            }
            let query = Query::FindNode {
                target,
                want: outgoing_want(family, endpoint),
            };
            let _ = self
                .send_query(
                    endpoint,
                    None,
                    query,
                    TransactionOwner::Bootstrap { family, target },
                )
                .await;
        }
        Ok(())
    }

    async fn refresh(&mut self, family: AddressFamily) -> Result<(), DhtError> {
        let target = random_node_id()?;
        let contacts = self
            .nodes
            .get(&family)
            .map(|node| {
                node.routing
                    .closest(target, K, self.started.elapsed().as_secs())
            })
            .unwrap_or_default();
        if contacts.is_empty() {
            return self.bootstrap_family(family).await;
        }
        let node = self.nodes.get_mut(&family).expect("refresh family remains");
        node.bootstrap_queried.clear();
        node.last_refresh = Instant::now();
        self.record_stats(family, |stats| {
            stats.routing_refreshes = stats.routing_refreshes.saturating_add(1);
        });
        for contact in contacts.into_iter().take(ALPHA) {
            let endpoint = socket_endpoint(contact.address);
            self.nodes
                .get_mut(&family)
                .expect("refresh family remains")
                .bootstrap_queried
                .insert(endpoint);
            let query = Query::FindNode {
                target,
                want: outgoing_want(family, endpoint),
            };
            let _ = self
                .send_query(
                    endpoint,
                    Some(contact),
                    query,
                    TransactionOwner::Bootstrap { family, target },
                )
                .await;
        }
        Ok(())
    }

    async fn handle_command(&mut self, command: Command) -> Result<(), DhtError> {
        match command {
            Command::SetEnabled { enabled, result } => {
                let outcome = self.set_enabled(enabled).await;
                let _ = result.send(outcome.clone());
                outcome?;
            }
            Command::Lookup {
                info_hash,
                progress,
                result,
            } => {
                if !self.enabled || matches!(self.config.network_policy, NetworkPolicy::Offline) {
                    let _ = result.send(Err(DhtError::NetworkDisabled));
                    return Ok(());
                }
                if let Some(group) = self.lookup_groups.get_mut(&info_hash) {
                    group.waiters.push(result);
                    group.add_progress(progress);
                    return Ok(());
                }
                let mut group = LookupGroup::with_waiter(result);
                group.add_progress(progress);
                self.start_lookup_group(info_hash, group).await?;
            }
            Command::LookupAndAnnounce {
                info_hash,
                ports,
                progress,
                result,
            } => {
                if !self.enabled || matches!(self.config.network_policy, NetworkPolicy::Offline) {
                    let _ = result.send(Err(DhtError::NetworkDisabled));
                    return Ok(());
                }
                if let Some(group) = self.lookup_groups.get_mut(&info_hash) {
                    if group.announcement.is_some() {
                        let _ = result.send(Err(DhtError::LookupCapacity));
                        return Ok(());
                    }
                    group.announcement = Some(Announcement { ports, result });
                    group.add_progress(progress);
                    let families = group.pending.iter().copied().collect::<Vec<_>>();
                    for family in &families {
                        if let Some(lookup) = self.lookups.get_mut(&(info_hash, *family)) {
                            lookup.announce_port = ports.for_family(*family);
                        }
                    }
                    for family in families {
                        self.advance_lookup((info_hash, family)).await?;
                    }
                    return Ok(());
                }
                let mut group = LookupGroup::with_announcement(Announcement { ports, result });
                group.add_progress(progress);
                self.start_lookup_group(info_hash, group).await?;
            }
            Command::CancelLookup(info_hash) => {
                self.cancel_group(info_hash, DhtError::Cancelled);
            }
            Command::Stats(sender) => {
                let mut stats = self.stats;
                stats.routing_nodes_v4 = self
                    .nodes
                    .get(&AddressFamily::Ipv4)
                    .map(|node| node.routing.len())
                    .unwrap_or(0)
                    .try_into()
                    .unwrap_or(u32::MAX);
                stats.routing_nodes_v6 = self
                    .nodes
                    .get(&AddressFamily::Ipv6)
                    .map(|node| node.routing.len())
                    .unwrap_or(0)
                    .try_into()
                    .unwrap_or(u32::MAX);
                stats.active_transactions = self.transactions.len().try_into().unwrap_or(u32::MAX);
                stats.active_lookups = self.lookups.len().try_into().unwrap_or(u32::MAX);
                let _ = sender.send(stats);
            }
            Command::ReconcileTransport(sender) => {
                let result = self.reconcile_transport_families(Instant::now()).await;
                let _ = sender.send(result.clone());
                result?;
                self.publish_observation(None);
            }
            Command::Shutdown(_) => unreachable!("shutdown handled by run loop"),
        }
        Ok(())
    }

    async fn set_enabled(&mut self, enabled: bool) -> Result<(), DhtError> {
        if self.enabled == enabled {
            self.publish_observation(None);
            return Ok(());
        }
        if !enabled {
            self.enabled = false;
            self.cancel_all(DhtError::NetworkDisabled);
            self.peer_store.clear();
            for node in self.nodes.values_mut() {
                node.bootstrap_queried.clear();
                node.fallback_pending = false;
            }
            self.publish_observation(Some(DhtLifecycle::Disabled));
            return Ok(());
        }

        let snapshot = self.snapshot();
        let bootstrap = resolve_bootstrap(&self.config, Some(&snapshot), true).await;
        self.bootstrap_templates = bootstrap.families.clone();
        for (&family, node) in &mut self.nodes {
            let family_bootstrap = bootstrap.families.get(&family).cloned().unwrap_or_default();
            node.warm_bootstrap = family_bootstrap.warm;
            node.fallback_bootstrap = family_bootstrap.fallback;
            node.fallback_pending = false;
            node.bootstrap_queried.clear();
        }
        self.enabled = true;
        self.bootstrap().await?;
        self.publish_observation(None);
        Ok(())
    }

    async fn start_lookup_group(
        &mut self,
        info_hash: NodeId,
        mut group: LookupGroup,
    ) -> Result<(), DhtError> {
        let families = self.nodes.keys().copied().collect::<Vec<_>>();
        let now = Instant::now();
        for family in families {
            if self.lookup_count(family) >= MAX_ACTIVE_LOOKUPS {
                group.failures.push(DhtError::LookupCapacity);
                continue;
            }
            let seeds = self.lookup_seeds(info_hash, family);
            let mut lookup = Lookup::new(
                self.next_lookup_id,
                info_hash,
                family,
                seeds,
                now + self.config.lookup_timeout,
                now,
            );
            lookup.announce_port = group
                .announcement
                .as_ref()
                .and_then(|announcement| announcement.ports.for_family(family));
            self.next_lookup_id = self.next_lookup_id.checked_add(1).unwrap_or(1);
            self.lookups.insert((info_hash, family), lookup);
            group.pending.insert(family);
        }
        if group.pending.is_empty() {
            group.finish();
            return Ok(());
        }
        let pending = group.pending.iter().copied().collect::<Vec<_>>();
        self.lookup_groups.insert(info_hash, group);
        for family in pending {
            self.advance_lookup((info_hash, family)).await?;
        }
        Ok(())
    }

    fn lookup_seeds(&self, info_hash: NodeId, family: AddressFamily) -> Vec<Candidate> {
        let elapsed = self.started.elapsed().as_secs();
        let Some(node) = self.nodes.get(&family) else {
            return Vec::new();
        };
        let mut seeds = node
            .routing
            .closest(info_hash, K, elapsed)
            .into_iter()
            .map(|contact| Candidate {
                contact: Some(contact),
                address: socket_endpoint(contact.address),
                state: CandidateState::Unqueried,
            })
            .collect::<Vec<_>>();
        let bootstrap = if node.fallback_pending
            || (node.fallback_bootstrap.is_empty() && !node.warm_bootstrap.is_empty())
        {
            &node.warm_bootstrap
        } else {
            &node.fallback_bootstrap
        };
        for address in bootstrap {
            seeds.push(Candidate {
                contact: None,
                address: *address,
                state: CandidateState::Unqueried,
            });
        }
        seeds
    }

    async fn fill_lookup(&mut self, key: (NodeId, AddressFamily)) -> Result<(), DhtError> {
        let (info_hash, family) = key;
        let addresses = self
            .lookups
            .get_mut(&key)
            .map(Lookup::next_queries)
            .unwrap_or_default();
        for address in addresses {
            if self.transaction_count(family) == MAX_ACTIVE_TRANSACTIONS {
                if let Some(lookup) = self.lookups.get_mut(&key) {
                    lookup.mark(address, CandidateState::Unqueried, None);
                }
                break;
            }
            let contact = self
                .lookups
                .get(&key)
                .and_then(|lookup| {
                    lookup
                        .candidates
                        .iter()
                        .find(|candidate| candidate.address == address)
                })
                .and_then(|candidate| candidate.contact);
            let query = Query::GetPeers {
                info_hash,
                want: outgoing_want(family, address),
            };
            if self
                .send_query(
                    address,
                    contact,
                    query,
                    TransactionOwner::Lookup { family, info_hash },
                )
                .await
                .is_err()
                && let Some(lookup) = self.lookups.get_mut(&key)
            {
                lookup.mark(address, CandidateState::Failed, contact);
            }
        }
        Ok(())
    }

    async fn advance_lookup(&mut self, key: (NodeId, AddressFamily)) -> Result<(), DhtError> {
        let (info_hash, family) = key;
        let announcing = self
            .lookups
            .get(&key)
            .is_some_and(|lookup| lookup.announce_started);
        if !announcing {
            self.fill_lookup(key).await?;
        }

        if let Some(result) = self.lookups.get(&key).and_then(Lookup::completed_result) {
            self.finish_lookup(key, result);
            return Ok(());
        }

        let ready = self.lookups.get(&key).is_some_and(|lookup| {
            lookup.announce_port.is_some() && !lookup.announce_started && !lookup.has_work()
        });
        if !ready {
            return Ok(());
        }
        let (port, responders, responded) = {
            let lookup = self
                .lookups
                .get(&key)
                .expect("ready lookup remains installed");
            (
                lookup.announce_port.expect("ready lookup has announcement"),
                lookup.closest_token_responders(),
                lookup
                    .candidates
                    .iter()
                    .any(|candidate| candidate.state == CandidateState::Responded),
            )
        };
        if responders.is_empty() {
            let peers = self
                .lookups
                .get(&key)
                .map(|lookup| lookup.peers.iter().copied().collect())
                .unwrap_or_default();
            self.finish_lookup(
                key,
                if responded {
                    Ok(peers)
                } else {
                    Err(DhtError::NoReachableNodes)
                },
            );
            return Ok(());
        }

        if let Some(lookup) = self.lookups.get_mut(&key) {
            lookup.announce_started = true;
            lookup.announce_token_nodes = responders.len().try_into().unwrap_or(u8::MAX);
            lookup.deadline = Instant::now() + self.config.query_timeout;
        }
        for responder in responders {
            let query = Query::AnnouncePeer {
                info_hash,
                port,
                implied_port: false,
                token: responder.token,
            };
            match self
                .send_query(
                    responder.address,
                    Some(responder.contact),
                    query,
                    TransactionOwner::Announce { family, info_hash },
                )
                .await
            {
                Ok(()) => {
                    self.record_stats(family, |stats| {
                        stats.announces_sent = stats.announces_sent.saturating_add(1);
                    });
                    if let Some(lookup) = self.lookups.get_mut(&key) {
                        lookup.announce_pending.insert(responder.address);
                        lookup.announce_sent = lookup.announce_sent.saturating_add(1);
                    }
                }
                Err(_) => {
                    self.record_stats(family, |stats| {
                        stats.announces_failed = stats.announces_failed.saturating_add(1);
                    });
                    if let Some(lookup) = self.lookups.get_mut(&key) {
                        lookup.announce_failed = lookup.announce_failed.saturating_add(1);
                    }
                }
            }
        }
        self.finish_announcement_if_complete(key);
        Ok(())
    }

    async fn send_query(
        &mut self,
        endpoint: SocketAddr,
        contact: Option<NodeContact>,
        query: Query,
        owner: TransactionOwner,
    ) -> Result<(), DhtError> {
        if !self.config.network_policy.allows(endpoint) {
            return Err(DhtError::NoReachableNodes);
        }
        let logical_family = owner.family();
        let wire_family = AddressFamily::of(endpoint.ip());
        let Some(node_id) = self.nodes.get(&logical_family).map(|node| node.node_id) else {
            return Err(DhtError::NoReachableNodes);
        };
        if self.transport.local_address_for(wire_family).is_none() {
            return Err(DhtError::NoReachableNodes);
        }
        if self.transaction_count(logical_family) >= MAX_ACTIVE_TRANSACTIONS {
            return Err(DhtError::LookupCapacity);
        }
        let transaction_id = self.allocate_transaction_id(endpoint)?;
        let transaction_bytes = transaction_id.to_be_bytes();
        let bytes = encode_query(&transaction_bytes, node_id, &query, self.config.read_only)
            .map_err(|error| DhtError::Io(error.to_string()))?;
        let sent = self
            .transport
            .send_to(&bytes, endpoint)
            .await
            .map_err(|error| DhtError::Io(error.to_string()))?;
        if let Some(sink) = &self.config.byte_metric_sink {
            sink.record(ByteMetric::DhtSent, sent as u64);
        }
        self.record_stats(wire_family, |stats| {
            stats.datagram_bytes_sent = stats.datagram_bytes_sent.saturating_add(sent as u64);
        });
        self.transactions.insert(
            (transaction_id, endpoint),
            Transaction {
                endpoint,
                contact,
                owner,
                logical_family,
                wire_family,
                deadline: Instant::now() + self.config.query_timeout,
            },
        );
        self.record_stats(logical_family, |stats| {
            stats.queries_sent = stats.queries_sent.saturating_add(1);
        });
        Ok(())
    }

    fn allocate_transaction_id(&mut self, endpoint: SocketAddr) -> Result<u16, DhtError> {
        for _ in 0..=u16::MAX {
            let mut bytes = [0_u8; 2];
            getrandom::fill(&mut bytes).map_err(|error| DhtError::Io(error.to_string()))?;
            let transaction = u16::from_be_bytes(bytes);
            if !self.transactions.contains_key(&(transaction, endpoint)) {
                return Ok(transaction);
            }
        }
        Err(DhtError::LookupCapacity)
    }

    fn transaction_count(&self, family: AddressFamily) -> usize {
        self.transactions
            .values()
            .filter(|transaction| transaction.logical_family == family)
            .count()
    }

    fn lookup_count(&self, family: AddressFamily) -> usize {
        self.lookups
            .values()
            .filter(|lookup| lookup.family == family)
            .count()
    }

    async fn handle_datagram(
        &mut self,
        bytes: &[u8],
        source: SocketAddr,
        wire_family: AddressFamily,
    ) -> Result<(), DhtError> {
        if !self.config.network_policy.allows(source)
            || AddressFamily::of(source.ip()) != wire_family
        {
            return Ok(());
        }
        let message = match decode_message(bytes) {
            Ok(message) => message,
            Err(_) => {
                self.record_stats(wire_family, |stats| {
                    stats.malformed_received = stats.malformed_received.saturating_add(1);
                });
                return Ok(());
            }
        };
        match message {
            Message::Response(response) => {
                self.handle_response(response, source, wire_family).await
            }
            Message::Error(error) => {
                self.handle_error(
                    &error.transaction,
                    error.observed_address,
                    source,
                    wire_family,
                )
                .await
            }
            Message::Query(query) => self.handle_incoming_query(query, source, wire_family).await,
        }
    }

    async fn handle_response(
        &mut self,
        response: ResponseMessage,
        source: SocketAddr,
        wire_family: AddressFamily,
    ) -> Result<(), DhtError> {
        let ResponseMessage {
            transaction,
            id,
            mut nodes,
            mut nodes6,
            peers,
            token,
            observed_address,
        } = response;
        let Some(transaction_id) = decode_transaction_id(&transaction) else {
            return Ok(());
        };
        let Some(transaction) = self.transactions.get(&(transaction_id, source)).copied() else {
            return Ok(());
        };
        if transaction.wire_family != wire_family || !verify_bep42_id(id, dht_ip(source.ip())) {
            return Ok(());
        }
        self.transactions.remove(&(transaction_id, source));
        self.observe_external(wire_family, observed_address, source)?;
        nodes.retain(|node| {
            valid_node_contact(*node)
                && self
                    .config
                    .network_policy
                    .allows(socket_endpoint(node.address))
        });
        nodes6.retain(|node| {
            valid_node_contact(*node)
                && self
                    .config
                    .network_policy
                    .allows(socket_endpoint(node.address))
        });
        let contact = NodeContact {
            id,
            address: dht_endpoint(source),
        };
        if let Some(node) = self.nodes.get_mut(&wire_family) {
            node.routing
                .record_response(contact, self.started.elapsed().as_secs());
            node.fallback_pending = false;
        }
        for node in &nodes {
            if let Some(family_node) = self.nodes.get_mut(&AddressFamily::Ipv4) {
                family_node
                    .routing
                    .heard_about(*node, self.started.elapsed().as_secs());
            }
        }
        for node in &nodes6 {
            if let Some(family_node) = self.nodes.get_mut(&AddressFamily::Ipv6) {
                family_node
                    .routing
                    .heard_about(*node, self.started.elapsed().as_secs());
            }
        }
        self.record_stats(transaction.logical_family, |stats| {
            stats.responses_received = stats.responses_received.saturating_add(1);
        });
        match transaction.owner {
            TransactionOwner::Bootstrap { family, target } => {
                let returned = match family {
                    AddressFamily::Ipv4 => nodes,
                    AddressFamily::Ipv6 => nodes6,
                };
                for node in returned.into_iter().take(ALPHA) {
                    let endpoint = socket_endpoint(node.address);
                    if self.transaction_count(family) >= MAX_ACTIVE_TRANSACTIONS
                        || self.nodes.get(&family).is_none_or(|node| {
                            node.bootstrap_queried.len() >= MAX_LOOKUP_CANDIDATES
                        })
                    {
                        break;
                    }
                    if !self
                        .nodes
                        .get_mut(&family)
                        .expect("transaction owner family remains")
                        .bootstrap_queried
                        .insert(endpoint)
                    {
                        continue;
                    }
                    let query = Query::FindNode {
                        target,
                        want: outgoing_want(family, endpoint),
                    };
                    let _ = self
                        .send_query(
                            endpoint,
                            Some(node),
                            query,
                            TransactionOwner::Bootstrap { family, target },
                        )
                        .await;
                }
            }
            TransactionOwner::Lookup { family, info_hash } => {
                let key = (info_hash, family);
                let mut fresh = Vec::new();
                if let Some(lookup) = self.lookups.get_mut(&key) {
                    lookup.mark(source, CandidateState::Responded, Some(contact));
                    if AddressFamily::of(source.ip()) == family
                        && let Some(token) = token
                    {
                        lookup.add_token_responder(contact, source, token);
                    }
                    let returned = match family {
                        AddressFamily::Ipv4 => nodes,
                        AddressFamily::Ipv6 => nodes6,
                    };
                    for node in returned {
                        lookup.add_candidate(Some(node), socket_endpoint(node.address));
                    }
                    for peer in peers.into_iter().map(socket_endpoint) {
                        if lookup.peers.len() == MAX_LOOKUP_PEERS {
                            break;
                        }
                        if AddressFamily::of(peer.ip()) == family
                            && self.config.network_policy.allows(peer)
                            && lookup.peers.insert(peer)
                        {
                            fresh.push(peer);
                        }
                    }
                }
                if !fresh.is_empty()
                    && let Some(group) = self.lookup_groups.get_mut(&info_hash)
                {
                    group.stream(fresh);
                }
                self.advance_lookup(key).await?;
            }
            TransactionOwner::Announce { family, info_hash } => {
                let key = (info_hash, family);
                if let Some(lookup) = self.lookups.get_mut(&key)
                    && lookup.announce_pending.remove(&source)
                {
                    lookup.announce_succeeded = lookup.announce_succeeded.saturating_add(1);
                    self.record_stats(family, |stats| {
                        stats.announces_succeeded = stats.announces_succeeded.saturating_add(1);
                    });
                }
                self.finish_announcement_if_complete(key);
            }
        }
        Ok(())
    }

    async fn handle_error(
        &mut self,
        transaction: &[u8],
        observed_address: Option<DhtEndpoint>,
        source: SocketAddr,
        wire_family: AddressFamily,
    ) -> Result<(), DhtError> {
        let Some(transaction) =
            take_correlated_transaction(&mut self.transactions, transaction, source)
        else {
            return Ok(());
        };
        if transaction.wire_family != wire_family {
            return Ok(());
        }
        self.observe_external(wire_family, observed_address, source)?;
        self.fail_transaction(transaction).await
    }

    async fn handle_incoming_query(
        &mut self,
        query: rstorrent_protocol::dht::QueryMessage,
        source: SocketAddr,
        wire_family: AddressFamily,
    ) -> Result<(), DhtError> {
        self.record_stats(wire_family, |stats| {
            stats.queries_received = stats.queries_received.saturating_add(1);
        });
        if self.config.read_only || !self.allow_query(wire_family, source.ip()) {
            return Ok(());
        }
        if !query.read_only
            && verify_bep42_id(query.id, dht_ip(source.ip()))
            && let Some(node) = self.nodes.get_mut(&wire_family)
        {
            node.routing.heard_about(
                NodeContact {
                    id: query.id,
                    address: dht_endpoint(source),
                },
                self.started.elapsed().as_secs(),
            );
        }
        let node_id = self
            .nodes
            .get(&wire_family)
            .expect("ingress family has a DHT node")
            .node_id;
        let observed_address = dht_endpoint(source);
        let result = match query.query {
            Query::Ping => encode_response(
                &query.transaction,
                node_id,
                &[],
                &[],
                None,
                observed_address,
            ),
            Query::FindNode { target, want } => {
                let nodes = self.response_nodes(target, &want, wire_family);
                encode_response(
                    &query.transaction,
                    node_id,
                    &nodes,
                    &[],
                    None,
                    observed_address,
                )
            }
            Query::GetPeers { info_hash, want } => {
                let nodes = self.response_nodes(info_hash, &want, wire_family);
                let peers = self
                    .stored_peers(info_hash, wire_family)
                    .into_iter()
                    .map(dht_endpoint)
                    .collect::<Vec<_>>();
                let token = self
                    .nodes
                    .get(&wire_family)
                    .expect("ingress family has a DHT node")
                    .tokens
                    .generate(source.ip(), info_hash);
                encode_response(
                    &query.transaction,
                    node_id,
                    &nodes,
                    &peers,
                    Some(&token),
                    observed_address,
                )
            }
            Query::AnnouncePeer {
                info_hash,
                port,
                implied_port,
                token,
            } => {
                if !self
                    .nodes
                    .get(&wire_family)
                    .expect("ingress family has a DHT node")
                    .tokens
                    .verify(&token, source.ip(), info_hash)
                {
                    encode_error(&query.transaction, 203, b"invalid token", observed_address)
                } else {
                    let address = SocketAddr::new(
                        source.ip(),
                        if implied_port { source.port() } else { port },
                    );
                    if !is_valid_outbound_address(address) {
                        encode_error(&query.transaction, 203, b"invalid port", observed_address)
                    } else {
                        self.store_peer(info_hash, wire_family, address);
                        encode_response(
                            &query.transaction,
                            node_id,
                            &[],
                            &[],
                            None,
                            observed_address,
                        )
                    }
                }
            }
            Query::Unknown(_) => {
                encode_error(&query.transaction, 204, b"method unknown", observed_address)
            }
        };
        if let Ok(bytes) = result
            && let Ok(sent) = self.transport.send_to(&bytes, source).await
        {
            self.record_stats(wire_family, |stats| {
                stats.datagram_bytes_sent = stats.datagram_bytes_sent.saturating_add(sent as u64);
            });
            if let Some(sink) = &self.config.byte_metric_sink {
                sink.record(ByteMetric::DhtSent, sent as u64);
            }
        }
        Ok(())
    }

    fn response_nodes(
        &self,
        target: NodeId,
        want: &[Want],
        wire_family: AddressFamily,
    ) -> Vec<NodeContact> {
        let requested = if want.is_empty() {
            vec![wire_family]
        } else {
            let mut families = Vec::with_capacity(2);
            if want.contains(&Want::Ipv4) {
                families.push(AddressFamily::Ipv4);
            }
            if want.contains(&Want::Ipv6) {
                families.push(AddressFamily::Ipv6);
            }
            families
        };
        let elapsed = self.started.elapsed().as_secs();
        let mut contacts = Vec::with_capacity(K * requested.len());
        for family in requested {
            if let Some(node) = self.nodes.get(&family) {
                contacts.extend(node.routing.closest(target, K, elapsed));
            }
        }
        contacts
    }

    fn allow_query(&mut self, family: AddressFamily, source: IpAddr) -> bool {
        let now = Instant::now();
        let node = self
            .nodes
            .get_mut(&family)
            .expect("ingress family has a DHT node");
        if now.duration_since(node.global_rate.started) >= Duration::from_secs(1) {
            node.global_rate = RateWindow {
                started: now,
                count: 0,
            };
        }
        if node.global_rate.count >= MAX_GLOBAL_QUERIES_PER_SECOND {
            self.stats.rate_limited = self.stats.rate_limited.saturating_add(1);
            let stats = self.family_stats.entry(family).or_default();
            stats.rate_limited = stats.rate_limited.saturating_add(1);
            return false;
        }
        node.global_rate.count += 1;

        if !node.source_rates.contains_key(&source)
            && node.source_rates.len() == MAX_RATE_SOURCES
            && let Some(oldest) = node
                .source_rates
                .iter()
                .min_by_key(|(_, rate)| rate.started)
                .map(|(source, _)| *source)
        {
            node.source_rates.remove(&oldest);
        }
        let rate = node.source_rates.entry(source).or_insert(RateWindow {
            started: now,
            count: 0,
        });
        if now.duration_since(rate.started) >= Duration::from_secs(60) {
            *rate = RateWindow {
                started: now,
                count: 0,
            };
        }
        if rate.count >= MAX_QUERIES_PER_SOURCE_MINUTE {
            self.stats.rate_limited = self.stats.rate_limited.saturating_add(1);
            let stats = self.family_stats.entry(family).or_default();
            stats.rate_limited = stats.rate_limited.saturating_add(1);
            return false;
        }
        rate.count += 1;
        true
    }

    fn store_peer(&mut self, info_hash: NodeId, family: AddressFamily, address: SocketAddr) {
        let key = (info_hash, family);
        let family_hashes = self
            .peer_store
            .keys()
            .filter(|(_, stored_family)| *stored_family == family)
            .count();
        if !self.peer_store.contains_key(&key)
            && family_hashes == MAX_PEER_STORE_HASHES
            && let Some(oldest_hash) = self
                .peer_store
                .iter()
                .filter(|((_, stored_family), _)| *stored_family == family)
                .min_by_key(|(_, peers)| {
                    peers
                        .iter()
                        .map(|peer| peer.expires_at)
                        .min()
                        .unwrap_or_else(Instant::now)
                })
                .map(|(key, _)| *key)
        {
            self.peer_store.remove(&oldest_hash);
        }
        let peers = self.peer_store.entry(key).or_default();
        let expires_at = Instant::now() + self.config.peer_ttl;
        if let Some(peer) = peers.iter_mut().find(|peer| peer.address == address) {
            peer.expires_at = expires_at;
            return;
        }
        if peers.len() == MAX_PEERS_PER_HASH {
            let oldest = peers
                .iter()
                .enumerate()
                .min_by_key(|(_, peer)| peer.expires_at)
                .map(|(index, _)| index)
                .expect("full peer store has oldest peer");
            peers.swap_remove(oldest);
        }
        peers.push(StoredPeer {
            address,
            expires_at,
        });
    }

    fn stored_peers(&mut self, info_hash: NodeId, family: AddressFamily) -> Vec<SocketAddr> {
        let now = Instant::now();
        let Some(peers) = self.peer_store.get_mut(&(info_hash, family)) else {
            return Vec::new();
        };
        peers.retain(|peer| peer.expires_at > now);
        peers
            .iter()
            .map(|peer| peer.address)
            .filter(|address| self.config.network_policy.allows(*address))
            .take(50)
            .collect()
    }

    async fn maintain(&mut self) -> Result<(), DhtError> {
        let now = Instant::now();
        self.reconcile_transport_families(now).await?;
        for node in self.nodes.values_mut() {
            node.tokens.rotate_if_due(now)?;
            node.source_rates
                .retain(|_, rate| now.duration_since(rate.started) < Duration::from_secs(2 * 60));
        }
        self.peer_store.retain(|_, peers| {
            peers.retain(|peer| peer.expires_at > now);
            !peers.is_empty()
        });

        let expired = self
            .transactions
            .iter()
            .filter(|(_, transaction)| transaction.deadline <= now)
            .map(|(id, transaction)| (*id, *transaction))
            .collect::<Vec<_>>();
        for (id, transaction) in expired {
            self.transactions.remove(&id);
            self.fail_transaction(transaction).await?;
        }

        for group in self.lookup_groups.values_mut() {
            group.waiters.retain(|waiter| !waiter.is_closed());
            if group
                .announcement
                .as_ref()
                .is_some_and(|announcement| announcement.result.is_closed())
            {
                group.announcement = None;
            }
        }
        let abandoned = self
            .lookup_groups
            .iter()
            .filter(|(_, group)| group.waiters.is_empty() && group.announcement.is_none())
            .map(|(hash, _)| *hash)
            .collect::<Vec<_>>();
        for hash in abandoned {
            self.cancel_group(hash, DhtError::Cancelled);
        }

        let timed_out = self
            .lookups
            .iter()
            .filter(|(_, lookup)| lookup.deadline <= now)
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        for key @ (info_hash, family) in timed_out {
            let announce_started = self
                .lookups
                .get(&key)
                .is_some_and(|lookup| lookup.announce_started);
            if announce_started {
                self.transactions.retain(|_, transaction| {
                    !matches!(
                        transaction.owner,
                        TransactionOwner::Announce {
                            family: owner_family,
                            info_hash: owner_hash,
                        } if owner_family == family && owner_hash == info_hash
                    )
                });
                if let Some(lookup) = self.lookups.get_mut(&key) {
                    let failed = lookup.announce_pending.len();
                    lookup.announce_pending.clear();
                    lookup.announce_failed = lookup
                        .announce_failed
                        .saturating_add(failed.try_into().unwrap_or(u8::MAX));
                    self.stats.announces_failed = self
                        .stats
                        .announces_failed
                        .saturating_add(failed.try_into().unwrap_or(u64::MAX));
                    let stats = self.family_stats.entry(family).or_default();
                    stats.announces_failed = stats
                        .announces_failed
                        .saturating_add(failed.try_into().unwrap_or(u64::MAX));
                }
                self.finish_announcement_if_complete(key);
                continue;
            }
            let has_announcement = self
                .lookups
                .get(&key)
                .is_some_and(|lookup| lookup.announce_port.is_some());
            if has_announcement {
                self.transactions.retain(|_, transaction| {
                    !matches!(
                        transaction.owner,
                        TransactionOwner::Lookup {
                            family: owner_family,
                            info_hash: owner_hash,
                        } if owner_family == family && owner_hash == info_hash
                    )
                });
                if let Some(lookup) = self.lookups.get_mut(&key) {
                    for candidate in &mut lookup.candidates {
                        if matches!(
                            candidate.state,
                            CandidateState::Unqueried | CandidateState::InFlight
                        ) {
                            candidate.state = CandidateState::Failed;
                        }
                    }
                }
                self.advance_lookup(key).await?;
            } else {
                let result = self
                    .lookups
                    .get(&key)
                    .map(Lookup::timeout_result)
                    .unwrap_or(Err(DhtError::LookupTimedOut));
                self.finish_lookup(key, result);
                self.transactions.retain(|_, transaction| {
                    !matches!(
                        transaction.owner,
                        TransactionOwner::Lookup {
                            family: owner_family,
                            info_hash: owner_hash,
                        } if owner_family == family && owner_hash == info_hash
                    )
                });
            }
        }

        let families = self.nodes.keys().copied().collect::<Vec<_>>();
        for family in families {
            let maintenance_in_flight = self.transactions.values().any(|transaction| {
                matches!(
                    transaction.owner,
                    TransactionOwner::Bootstrap {
                        family: owner_family,
                        ..
                    } if owner_family == family
                )
            });
            if maintenance_in_flight {
                continue;
            }
            let Some(node) = self.nodes.get(&family) else {
                continue;
            };
            if node.routing.is_empty() && node.fallback_pending {
                self.bootstrap_fallback(family).await?;
            } else if node.routing.is_empty()
                && now.duration_since(node.last_bootstrap) >= self.config.bootstrap_retry_interval
            {
                self.bootstrap_family(family).await?;
            } else if !node.routing.is_empty()
                && now.duration_since(node.last_refresh) >= self.config.routing_refresh_interval
            {
                self.refresh(family).await?;
            }
        }
        Ok(())
    }

    async fn reconcile_transport_families(&mut self, now: Instant) -> Result<(), DhtError> {
        for family in [AddressFamily::Ipv4, AddressFamily::Ipv6] {
            let transport_address = self.transport.local_address_for(family);
            let node_address = self.nodes.get(&family).map(|node| node.local_address);
            match (node_address, transport_address) {
                (Some(current), Some(replacement)) if current.ip() == replacement.ip() => {
                    self.nodes
                        .get_mut(&family)
                        .expect("family remains")
                        .local_address = replacement;
                }
                (Some(_), Some(replacement)) => {
                    self.deactivate_family(family, DhtError::Cancelled).await?;
                    self.activate_family(family, replacement, now).await?;
                }
                (None, Some(address)) => {
                    self.activate_family(family, address, now).await?;
                }
                (Some(_), None) => {
                    self.deactivate_family(family, DhtError::Cancelled).await?;
                }
                (None, None) => {}
            }
        }
        Ok(())
    }

    async fn activate_family(
        &mut self,
        family: AddressFamily,
        local_address: SocketAddr,
        now: Instant,
    ) -> Result<(), DhtError> {
        let identities = self
            .identity_hints
            .get(&family)
            .cloned()
            .unwrap_or_default();
        let bootstrap = self
            .bootstrap_templates
            .get(&family)
            .cloned()
            .unwrap_or_default();
        let node = DhtNode::new(local_address, &identities, bootstrap, now)?;
        self.identity_hints.insert(family, node.identities.clone());
        self.nodes.insert(family, node);
        if self.enabled {
            self.bootstrap_family(family).await
        } else {
            Ok(())
        }
    }

    async fn deactivate_family(
        &mut self,
        family: AddressFamily,
        error: DhtError,
    ) -> Result<(), DhtError> {
        if let Some(node) = self.nodes.remove(&family) {
            self.identity_hints.insert(family, node.identities);
        }
        self.peer_store
            .retain(|(_, stored_family), _| *stored_family != family);
        let removed_transactions = self
            .transactions
            .iter()
            .filter(|(_, transaction)| {
                transaction.logical_family == family || transaction.wire_family == family
            })
            .map(|(key, transaction)| (*key, *transaction))
            .collect::<Vec<_>>();
        for (key, transaction) in removed_transactions {
            self.transactions.remove(&key);
            if transaction.logical_family != family {
                self.fail_transaction(transaction).await?;
            }
        }
        let lookups = self
            .lookups
            .keys()
            .filter(|(_, lookup_family)| *lookup_family == family)
            .copied()
            .collect::<Vec<_>>();
        for key in lookups {
            self.finish_lookup(key, Err(error.clone()));
        }
        Ok(())
    }

    async fn fail_transaction(&mut self, transaction: Transaction) -> Result<(), DhtError> {
        if let Some(contact) = transaction.contact
            && let Some(node) = self.nodes.get_mut(&transaction.wire_family)
        {
            node.routing.record_failure(contact);
        }
        match transaction.owner {
            TransactionOwner::Lookup { family, info_hash } => {
                let key = (info_hash, family);
                if let Some(lookup) = self.lookups.get_mut(&key) {
                    lookup.mark(
                        transaction.endpoint,
                        CandidateState::Failed,
                        transaction.contact,
                    );
                }
                self.advance_lookup(key).await?;
            }
            TransactionOwner::Announce { family, info_hash } => {
                let key = (info_hash, family);
                if let Some(lookup) = self.lookups.get_mut(&key)
                    && lookup.announce_pending.remove(&transaction.endpoint)
                {
                    lookup.announce_failed = lookup.announce_failed.saturating_add(1);
                    self.stats.announces_failed = self.stats.announces_failed.saturating_add(1);
                    let stats = self.family_stats.entry(family).or_default();
                    stats.announces_failed = stats.announces_failed.saturating_add(1);
                }
                self.finish_announcement_if_complete(key);
            }
            TransactionOwner::Bootstrap { .. } => {}
        }
        Ok(())
    }

    fn finish_announcement_if_complete(&mut self, key: (NodeId, AddressFamily)) {
        let complete = self
            .lookups
            .get(&key)
            .is_some_and(|lookup| lookup.announce_started && lookup.announce_pending.is_empty());
        if !complete {
            return;
        }
        let peers = self
            .lookups
            .get(&key)
            .map(|lookup| lookup.peers.iter().copied().collect())
            .unwrap_or_default();
        self.finish_lookup(key, Ok(peers));
    }

    fn finish_lookup(
        &mut self,
        key @ (info_hash, family): (NodeId, AddressFamily),
        result: Result<Vec<SocketAddr>, DhtError>,
    ) {
        let Some(lookup) = self.lookups.remove(&key) else {
            return;
        };
        let outcome = lookup.finish(result);
        let discovered = outcome.peers.len().try_into().unwrap_or(u64::MAX);
        let family_stats = self.family_stats.entry(family).or_default();
        family_stats.discovered_peers = family_stats.discovered_peers.saturating_add(discovered);
        let Some(group) = self.lookup_groups.get_mut(&info_hash) else {
            return;
        };
        group.record(family, outcome);
        if group.pending.is_empty()
            && let Some(group) = self.lookup_groups.remove(&info_hash)
        {
            self.stats.discovered_peers = self
                .stats
                .discovered_peers
                .saturating_add(group.peers.len() as u64);
            group.finish();
        }
    }

    fn cancel_group(&mut self, info_hash: NodeId, error: DhtError) {
        self.lookups.retain(|(hash, _), _| *hash != info_hash);
        self.transactions.retain(|_, transaction| {
            !matches!(
                transaction.owner,
                TransactionOwner::Lookup { info_hash: hash, .. }
                    | TransactionOwner::Announce { info_hash: hash, .. }
                    if hash == info_hash
            )
        });
        if let Some(group) = self.lookup_groups.remove(&info_hash) {
            for waiter in group.waiters {
                let _ = waiter.send(Err(error.clone()));
            }
            if let Some(announcement) = group.announcement {
                let _ = announcement.result.send(Err(error));
            }
        }
    }

    fn cancel_all(&mut self, error: DhtError) {
        self.transactions.clear();
        self.lookups.clear();
        for (_, group) in self.lookup_groups.drain() {
            for waiter in group.waiters {
                let _ = waiter.send(Err(error.clone()));
            }
            if let Some(announcement) = group.announcement {
                let _ = announcement.result.send(Err(error.clone()));
            }
        }
    }

    fn publish_observation(&mut self, lifecycle: Option<DhtLifecycle>) {
        let now = Instant::now();
        let elapsed = self.started.elapsed();
        let mut stats = self.stats;
        stats.routing_nodes_v4 = self
            .nodes
            .get(&AddressFamily::Ipv4)
            .map(|node| node.routing.len())
            .unwrap_or(0)
            .try_into()
            .unwrap_or(u32::MAX);
        stats.routing_nodes_v6 = self
            .nodes
            .get(&AddressFamily::Ipv6)
            .map(|node| node.routing.len())
            .unwrap_or(0)
            .try_into()
            .unwrap_or(u32::MAX);
        stats.active_transactions = self.transactions.len().try_into().unwrap_or(u32::MAX);
        stats.active_lookups = self.lookups.len().try_into().unwrap_or(u32::MAX);
        let default_lifecycle = if !self.enabled {
            DhtLifecycle::Disabled
        } else if matches!(self.config.network_policy, NetworkPolicy::Offline) {
            DhtLifecycle::Offline
        } else if self.nodes.values().all(|node| node.routing.is_empty()) {
            DhtLifecycle::BootstrapEmpty
        } else {
            DhtLifecycle::Participating
        };
        let aggregate_lifecycle = lifecycle.unwrap_or(default_lifecycle);
        let families = self
            .nodes
            .iter()
            .map(|(&family, node)| {
                let routing = node.routing.inspection(elapsed.as_secs());
                let mut family_stats = self.family_stats.get(&family).copied().unwrap_or_default();
                match family {
                    AddressFamily::Ipv4 => {
                        family_stats.routing_nodes_v4 = u32::from(routing.routing_nodes);
                    }
                    AddressFamily::Ipv6 => {
                        family_stats.routing_nodes_v6 = u32::from(routing.routing_nodes);
                    }
                }
                family_stats.active_transactions = self
                    .transactions
                    .values()
                    .filter(|transaction| transaction.logical_family == family)
                    .count()
                    .try_into()
                    .unwrap_or(u32::MAX);
                family_stats.active_lookups = self
                    .lookups
                    .values()
                    .filter(|lookup| lookup.family == family)
                    .count()
                    .try_into()
                    .unwrap_or(u32::MAX);
                let mut lookups = self
                    .lookups
                    .values()
                    .filter(|lookup| lookup.family == family)
                    .map(|lookup| lookup.observation(now))
                    .collect::<Vec<_>>();
                lookups.sort_by_key(|lookup| lookup.lookup_id);
                DhtFamilyObservation {
                    family,
                    lifecycle: lifecycle.unwrap_or({
                        if !self.enabled {
                            DhtLifecycle::Disabled
                        } else if matches!(self.config.network_policy, NetworkPolicy::Offline) {
                            DhtLifecycle::Offline
                        } else if routing.routing_nodes == 0 {
                            DhtLifecycle::BootstrapEmpty
                        } else {
                            DhtLifecycle::Participating
                        }
                    }),
                    local_node_id: node.node_id,
                    local_address: node.local_address,
                    observed_external_address: node.observed_external_address,
                    routing_nodes: routing.routing_nodes,
                    occupied_buckets: routing.occupied_buckets,
                    deepest_shared_prefix_bits: routing.deepest_shared_prefix_bits,
                    stats: family_stats,
                    buckets: routing.buckets,
                    lookups,
                }
            })
            .collect();
        self.observations.send_replace(DhtObservation {
            lifecycle: aggregate_lifecycle,
            network_policy: self.config.network_policy,
            captured_millis: duration_millis(elapsed),
            stats,
            families,
        });
        self.last_observation = now;
    }

    fn observe_external(
        &mut self,
        family: AddressFamily,
        observed: Option<DhtEndpoint>,
        source: SocketAddr,
    ) -> Result<(), DhtError> {
        let Some(observed) =
            observed.filter(|address| AddressFamily::of(socket_endpoint(*address).ip()) == family)
        else {
            return Ok(());
        };
        let observed_address = socket_endpoint(observed);
        if observed_address.ip().is_loopback() || observed_address.ip().is_unspecified() {
            return Ok(());
        }
        let node = self
            .nodes
            .get_mut(&family)
            .expect("response family has a DHT node");
        node.observed_external_address = Some(observed_address.ip());
        if verify_bep42_id(node.node_id, observed.ip) {
            node.remember_identity(observed_address.ip(), node.node_id);
            self.identity_hints.insert(family, node.identities.clone());
            node.external_votes.clear();
            return Ok(());
        }
        if !node
            .external_votes
            .observe(observed_address.ip(), source.ip())
        {
            return Ok(());
        }
        node.node_id = generate_bep42_id(observed.ip, random_bytes()?);
        node.routing = RoutingTable::new(node.node_id);
        node.remember_identity(observed_address.ip(), node.node_id);
        self.identity_hints.insert(family, node.identities.clone());
        node.external_votes.clear();
        Ok(())
    }

    fn snapshot(&self) -> DhtSnapshot {
        let elapsed = self.started.elapsed().as_secs();
        DhtSnapshot {
            version: DHT_SNAPSHOT_VERSION,
            identities_v4: self
                .identity_hints
                .get(&AddressFamily::Ipv4)
                .cloned()
                .unwrap_or_default(),
            identities_v6: self
                .identity_hints
                .get(&AddressFamily::Ipv6)
                .cloned()
                .unwrap_or_default(),
            nodes_v4: self
                .nodes
                .get(&AddressFamily::Ipv4)
                .map(|node| {
                    node.routing
                        .responsive_sample(false, MAX_PERSISTED_NODES_PER_FAMILY, elapsed)
                })
                .unwrap_or_default(),
            nodes_v6: self
                .nodes
                .get(&AddressFamily::Ipv6)
                .map(|node| {
                    node.routing
                        .responsive_sample(true, MAX_PERSISTED_NODES_PER_FAMILY, elapsed)
                })
                .unwrap_or_default(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct FamilyBootstrap {
    warm: Vec<SocketAddr>,
    fallback: Vec<SocketAddr>,
}

#[derive(Debug)]
struct ResolvedBootstrap {
    families: BTreeMap<AddressFamily, FamilyBootstrap>,
}

async fn resolve_bootstrap(
    config: &DhtConfig,
    snapshot: Option<&DhtSnapshot>,
    resolve_hosts: bool,
) -> ResolvedBootstrap {
    let mut families = BTreeMap::from([
        (AddressFamily::Ipv4, FamilyBootstrap::default()),
        (AddressFamily::Ipv6, FamilyBootstrap::default()),
    ]);
    if matches!(config.network_policy, NetworkPolicy::Offline) {
        return ResolvedBootstrap { families };
    }
    if let Some(snapshot) = snapshot {
        for (family, contacts) in [
            (AddressFamily::Ipv4, &snapshot.nodes_v4),
            (AddressFamily::Ipv6, &snapshot.nodes_v6),
        ] {
            families
                .get_mut(&family)
                .expect("family exists")
                .warm
                .extend(
                    contacts
                        .iter()
                        .map(|node| socket_endpoint(node.address))
                        .filter(|address| {
                            config.network_policy.allows(*address)
                                && AddressFamily::of(address.ip()) == family
                        }),
                );
        }
    }

    for address in config.bootstrap_nodes.iter().filter_map(|node| match node {
        BootstrapNode::Address(address) => Some(*address),
        BootstrapNode::Host { .. } => None,
    }) {
        if config.network_policy.allows(address) {
            families
                .get_mut(&AddressFamily::of(address.ip()))
                .expect("family exists")
                .fallback
                .push(address);
        }
    }

    if resolve_hosts && matches!(config.network_policy, NetworkPolicy::Online) {
        let mut tasks = tokio::task::JoinSet::new();
        for node in &config.bootstrap_nodes {
            let BootstrapNode::Host { host, port } = node else {
                continue;
            };
            let host = host.clone();
            let port = *port;
            tasks.spawn(async move {
                tokio::time::timeout(Duration::from_secs(5), lookup_host((host, port)))
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .map(|resolved| resolved.take(16).collect::<Vec<_>>())
                    .unwrap_or_default()
            });
        }
        while let Some(Ok(resolved)) = tasks.join_next().await {
            for address in resolved
                .into_iter()
                .filter(|address| config.network_policy.allows(*address))
            {
                families
                    .get_mut(&AddressFamily::of(address.ip()))
                    .expect("family exists")
                    .fallback
                    .push(address);
            }
        }
    }
    for bootstrap in families.values_mut() {
        bootstrap.warm.sort_unstable();
        bootstrap.warm.dedup();
        bootstrap.warm.truncate(MAX_PERSISTED_NODES_PER_FAMILY);
        bootstrap.fallback.sort_unstable();
        bootstrap.fallback.dedup();
        bootstrap
            .fallback
            .retain(|address| !bootstrap.warm.contains(address));
        bootstrap.fallback.truncate(64);
    }
    ResolvedBootstrap { families }
}

fn outgoing_want(logical_family: AddressFamily, endpoint: SocketAddr) -> Vec<Want> {
    if AddressFamily::of(endpoint.ip()) == logical_family {
        Vec::new()
    } else {
        vec![match logical_family {
            AddressFamily::Ipv4 => Want::Ipv4,
            AddressFamily::Ipv6 => Want::Ipv6,
        }]
    }
}

fn random_node_id() -> Result<NodeId, DhtError> {
    let mut bytes = random_bytes()?;
    if bytes == [0; 20] {
        bytes[19] = 1;
    }
    Ok(NodeId(bytes))
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

fn random_bytes() -> Result<[u8; 20], DhtError> {
    let mut bytes = [0; 20];
    getrandom::fill(&mut bytes).map_err(|error| DhtError::Io(error.to_string()))?;
    Ok(bytes)
}

fn token_digest(source: IpAddr, secret: &[u8; 20], info_hash: NodeId) -> [u8; 20] {
    let mut hasher = Sha1::new();
    match source {
        IpAddr::V4(address) => hasher.update(address.octets()),
        IpAddr::V6(address) => hasher.update(address.octets()),
    }
    hasher.update(secret);
    hasher.update(info_hash.0);
    hasher.finalize().into()
}

fn decode_transaction_id(transaction: &[u8]) -> Option<u16> {
    Some(u16::from_be_bytes(transaction.try_into().ok()?))
}

fn take_correlated_transaction(
    transactions: &mut HashMap<(u16, SocketAddr), Transaction>,
    transaction: &[u8],
    source: SocketAddr,
) -> Option<Transaction> {
    let transaction_id = decode_transaction_id(transaction)?;
    transactions.remove(&(transaction_id, source))
}

fn dht_ip(address: IpAddr) -> DhtIp {
    match address {
        IpAddr::V4(address) => DhtIp::V4(address.octets()),
        IpAddr::V6(address) => DhtIp::V6(address.octets()),
    }
}

fn dht_endpoint(address: SocketAddr) -> DhtEndpoint {
    DhtEndpoint::new(dht_ip(address.ip()), address.port())
}

fn socket_endpoint(address: DhtEndpoint) -> SocketAddr {
    match address.ip {
        DhtIp::V4(octets) => SocketAddr::from((Ipv4Addr::from(octets), address.port)),
        DhtIp::V6(octets) => SocketAddr::from((Ipv6Addr::from(octets), address.port)),
    }
}

fn valid_node_contact(contact: NodeContact) -> bool {
    contact.id != NodeId::ZERO
        && is_valid_outbound_address(socket_endpoint(contact.address))
        && verify_bep42_id(contact.id, contact.address.ip)
}

fn deduplicate_contacts(contacts: &mut Vec<NodeContact>) {
    let mut ids = HashSet::new();
    let mut endpoints = HashSet::new();
    contacts.retain(|contact| ids.insert(contact.id) && endpoints.insert(contact.address));
}

/// Scripted DHT nodes for tests in this crate.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// Answers every query; `get_peers` replies carry `nodes` and `peers`.
    /// With `hold`, the first `get_peers` reply waits until released.
    pub(crate) async fn scripted_peer_node(
        socket: UdpSocket,
        id: NodeId,
        nodes: Vec<NodeContact>,
        peers: Vec<SocketAddr>,
        mut hold: Option<oneshot::Receiver<()>>,
    ) {
        let peers = peers.into_iter().map(dht_endpoint).collect::<Vec<_>>();
        let mut buffer = [0_u8; MAX_DATAGRAM_SIZE];
        loop {
            let Ok((length, source)) = socket.recv_from(&mut buffer).await else {
                return;
            };
            let Ok(Message::Query(query)) = decode_message(&buffer[..length]) else {
                continue;
            };
            let get_peers = matches!(query.query, Query::GetPeers { .. });
            if get_peers && let Some(release) = hold.take() {
                let _ = release.await;
            }
            let response = if get_peers {
                encode_response(
                    &query.transaction,
                    id,
                    &nodes,
                    &peers,
                    Some(b"tk"),
                    dht_endpoint(source),
                )
            } else {
                encode_response(&query.transaction, id, &[], &[], None, dht_endpoint(source))
            }
            .expect("encode scripted response");
            let _ = socket.send_to(&response, source).await;
        }
    }

    pub(crate) fn loopback_peer(port: u16) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn family_observation(
        observation: &DhtObservation,
        family: AddressFamily,
    ) -> &DhtFamilyObservation {
        observation
            .families
            .iter()
            .find(|observation| observation.family == family)
            .expect("address-family observation")
    }

    #[tokio::test]
    async fn live_disable_stops_wire_cancels_lookup_and_reenables_same_owner() {
        let bootstrap = UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bootstrap socket");
        let mut config = loopback_config(vec![BootstrapNode::Address(
            bootstrap.local_addr().expect("bootstrap address"),
        )]);
        config.enabled = false;
        let service = DhtService::start(config).await.expect("start disabled DHT");
        let handle = service.handle();
        let observations = service.subscribe_observations();
        let initial_node_id = observations.borrow().families[0].local_node_id;
        assert_eq!(observations.borrow().lifecycle, DhtLifecycle::Disabled);
        assert!(
            tokio::time::timeout(
                Duration::from_millis(100),
                bootstrap.recv_from(&mut [0; 2048])
            )
            .await
            .is_err(),
            "disabled startup must not emit bootstrap traffic"
        );
        assert_eq!(handle.lookup([9; 20]).await, Err(DhtError::NetworkDisabled));

        handle.set_enabled(true).await.expect("enable DHT");
        tokio::time::timeout(Duration::from_secs(2), bootstrap.recv_from(&mut [0; 2048]))
            .await
            .expect("enabled bootstrap timeout")
            .expect("enabled bootstrap packet");

        let (result, lookup) = oneshot::channel();
        handle
            .sender
            .send(Command::Lookup {
                info_hash: NodeId([7; 20]),
                progress: None,
                result,
            })
            .await
            .expect("queue lookup");
        handle.set_enabled(false).await.expect("disable DHT");
        assert_eq!(
            lookup.await.expect("lookup result"),
            Err(DhtError::NetworkDisabled)
        );
        let stats = handle.stats().await.expect("disabled stats");
        assert_eq!(stats.active_lookups, 0);
        assert_eq!(stats.active_transactions, 0);

        handle.set_enabled(true).await.expect("re-enable DHT");
        tokio::time::timeout(Duration::from_secs(2), bootstrap.recv_from(&mut [0; 2048]))
            .await
            .expect("re-enabled bootstrap timeout")
            .expect("re-enabled bootstrap packet");
        assert_eq!(
            service.subscribe_observations().borrow().families[0].local_node_id,
            initial_node_id
        );
        service.shutdown().await.expect("shutdown DHT");
    }

    #[test]
    fn external_address_votes_are_distinct_bounded_and_consumed() {
        let mut votes = ExternalAddressVotes::default();
        let voter = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
        let candidate = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 1));
        assert!(!votes.observe(candidate, voter));
        assert!(!votes.observe(candidate, voter));
        assert_eq!(votes.candidates[&candidate].len(), 1);

        for suffix in 2..=MAX_EXTERNAL_ADDRESS_CANDIDATES as u8 {
            let address = IpAddr::V4(Ipv4Addr::new(198, 51, 100, suffix));
            assert!(!votes.observe(address, voter));
        }
        assert_eq!(votes.candidates.len(), MAX_EXTERNAL_ADDRESS_CANDIDATES);

        let replacement = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 1));
        assert!(!votes.observe(replacement, voter));
        assert_eq!(votes.candidates.len(), 1);
        assert!(votes.candidates.contains_key(&replacement));

        assert!(!votes.observe(replacement, IpAddr::V4(Ipv4Addr::new(192, 0, 2, 2)),));
        assert!(votes.observe(replacement, IpAddr::V4(Ipv4Addr::new(192, 0, 2, 3)),));
        assert!(votes.candidates.is_empty());
    }

    #[test]
    fn error_transactions_require_an_exact_source_match() {
        let endpoint = SocketAddr::from((Ipv4Addr::LOCALHOST, 6881));
        let transaction = Transaction {
            endpoint,
            contact: None,
            owner: TransactionOwner::Bootstrap {
                family: AddressFamily::Ipv4,
                target: NodeId([1; 20]),
            },
            logical_family: AddressFamily::Ipv4,
            wire_family: AddressFamily::Ipv4,
            deadline: Instant::now(),
        };
        let mut transactions = HashMap::from([((0x7a7a, endpoint), transaction)]);
        assert!(take_correlated_transaction(&mut transactions, b"bad", endpoint).is_none());
        assert!(
            take_correlated_transaction(
                &mut transactions,
                b"zz",
                SocketAddr::from((Ipv4Addr::LOCALHOST, 6882)),
            )
            .is_none()
        );
        assert_eq!(transactions.len(), 1);
        let matched = take_correlated_transaction(&mut transactions, b"zz", endpoint)
            .expect("matching transaction");
        assert_eq!(matched.endpoint, endpoint);
        assert!(transactions.is_empty());
    }

    #[test]
    fn lookup_observation_advances_only_for_closer_responded_ids() {
        let target = NodeId::ZERO;
        let candidate = |prefix: u8, port: u16| {
            let mut id = [0_u8; 20];
            id[0] = prefix;
            Candidate {
                contact: Some(NodeContact {
                    id: NodeId(id),
                    address: dht_endpoint(SocketAddr::from((Ipv4Addr::LOCALHOST, port))),
                }),
                address: SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
                state: CandidateState::Unqueried,
            }
        };
        let now = Instant::now();
        let mut lookup = Lookup::new(
            7,
            target,
            AddressFamily::Ipv4,
            [candidate(0x80, 6201), candidate(0x20, 6202)],
            now + Duration::from_secs(30),
            now,
        );
        let first = lookup.candidates[0];
        lookup.mark(first.address, CandidateState::Responded, first.contact);
        let first_prefix = lookup
            .closest_responded_prefix_bits
            .expect("first convergence prefix");
        let first_improvement = lookup
            .last_convergence_improvement_at
            .expect("first convergence instant");

        let farther = lookup
            .candidates
            .iter()
            .copied()
            .find(|candidate| {
                candidate
                    .contact
                    .is_some_and(|contact| target.shared_prefix_bits(contact.id) < first_prefix)
            })
            .expect("farther candidate");
        lookup.mark(farther.address, CandidateState::Responded, farther.contact);
        assert_eq!(lookup.closest_responded_prefix_bits, Some(first_prefix));
        assert_eq!(
            lookup.last_convergence_improvement_at,
            Some(first_improvement)
        );
        let observation = lookup.observation(Instant::now());
        assert_eq!(observation.lookup_id, 7);
        assert_eq!(observation.responded_candidates, 2);
        assert_eq!(
            observation.closest_responded_prefix_bits,
            Some(first_prefix)
        );
    }

    #[test]
    fn announce_selects_only_the_eight_closest_token_responders() {
        let now = Instant::now();
        let mut lookup = Lookup::new(
            8,
            NodeId::ZERO,
            AddressFamily::Ipv4,
            [],
            now + Duration::from_secs(30),
            now,
        );
        for distance in (1_u8..=10).rev() {
            let mut id = [0_u8; 20];
            id[19] = distance;
            let address = SocketAddr::from((Ipv4Addr::LOCALHOST, 6300 + u16::from(distance)));
            lookup.add_token_responder(
                NodeContact {
                    id: NodeId(id),
                    address: dht_endpoint(address),
                },
                address,
                vec![distance],
            );
        }

        let selected = lookup.closest_token_responders();
        assert_eq!(selected.len(), K);
        assert_eq!(
            selected
                .iter()
                .map(|responder| responder.contact.id.0[19])
                .collect::<Vec<_>>(),
            (1_u8..=8).collect::<Vec<_>>()
        );
    }
    use rstorrent_protocol::dht::{ResponseMessage, decode_message};

    fn loopback_config(bootstrap: Vec<BootstrapNode>) -> DhtConfig {
        DhtConfig {
            enabled: true,
            network_policy: NetworkPolicy::LoopbackOnly,
            bind_address: SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
            bootstrap_nodes: bootstrap,
            initial_snapshot: None,
            query_timeout: Duration::from_millis(500),
            lookup_timeout: Duration::from_secs(3),
            bootstrap_retry_interval: Duration::from_secs(1),
            routing_refresh_interval: Duration::from_secs(60),
            peer_ttl: PEER_TTL,
            read_only: false,
            byte_metric_sink: None,
        }
    }

    #[tokio::test]
    async fn stable_dht_observes_replaced_session_udp_without_losing_identity() {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind initial session UDP");
        let (mut udp, transport) = SessionUdpService::start(socket).expect("start session UDP");
        let dht = DhtService::start_with_transport(loopback_config(Vec::new()), transport)
            .await
            .expect("start stable DHT");
        let before_address = dht.local_address();
        let before = dht.subscribe_observations().borrow().clone();

        let replacement = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind replacement session UDP");
        let replacement_address = replacement.local_addr().expect("replacement address");
        udp.replace_socket(replacement)
            .await
            .expect("replace session UDP generation");
        assert_ne!(before_address, replacement_address);
        assert_eq!(dht.local_address(), replacement_address);
        dht.handle()
            .reconcile_transport()
            .await
            .expect("reconcile replacement");
        let after = dht.subscribe_observations().borrow().clone();
        let before_v4 = family_observation(&before, AddressFamily::Ipv4);
        let after_v4 = family_observation(&after, AddressFamily::Ipv4);
        assert_eq!(after_v4.local_node_id, before_v4.local_node_id);
        assert_eq!(after_v4.routing_nodes, before_v4.routing_nodes);
        assert_eq!(
            dht.handle()
                .stats()
                .await
                .expect("DHT remains responsive")
                .active_lookups,
            0
        );

        let snapshot = dht.shutdown().await.expect("shutdown DHT");
        assert_eq!(snapshot.identities_v4[0].node_id, before_v4.local_node_id);
        let terminal = udp.shutdown().await.expect("shutdown session UDP");
        assert_eq!(terminal.tasks, 0);
    }

    #[tokio::test]
    async fn ipv6_wire_datagrams_are_answered_by_the_ipv6_node() {
        let ipv4 = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind IPv4 session UDP");
        let (mut udp, transport) = SessionUdpService::start(ipv4).expect("start session UDP");
        let ipv6 = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0))
            .await
            .expect("bind IPv6 session UDP");
        let ipv6_address = ipv6.local_addr().expect("IPv6 session address");
        udp.replace_socket(ipv6).await.expect("add IPv6 receiver");
        let dht = DhtService::start_with_transport(loopback_config(Vec::new()), transport)
            .await
            .expect("start dual-family DHT");
        let remote = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0))
            .await
            .expect("bind IPv6 DHT probe");
        let ping =
            encode_query(b"v6", NodeId([6; 20]), &Query::Ping, true).expect("encode IPv6 ping");
        remote
            .send_to(&ping, ipv6_address)
            .await
            .expect("send IPv6 ping");
        let mut response = [0_u8; MAX_DATAGRAM_SIZE];
        let (length, source) =
            tokio::time::timeout(Duration::from_secs(1), remote.recv_from(&mut response))
                .await
                .expect("IPv6 ping response timed out")
                .expect("receive IPv6 ping response");
        assert_eq!(source, ipv6_address);
        assert!(matches!(
            decode_message(&response[..length]).expect("decode IPv6 ping response"),
            Message::Response(ResponseMessage { transaction, .. }) if transaction == b"v6"
        ));
        let stats = dht.handle().stats().await.expect("read DHT stats");
        assert_eq!(stats.family_mismatched, 0);
        dht.shutdown().await.expect("shutdown DHT");
        let terminal = udp.shutdown().await.expect("shutdown session UDP");
        assert_eq!(terminal.tasks, 0);
        assert_eq!(terminal.task_high_water, 2);
    }

    async fn dual_stack_dht(
        config: DhtConfig,
    ) -> (SessionUdpService, DhtService, SocketAddr, SocketAddr) {
        let ipv4 = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind IPv4 DHT socket");
        let (mut udp, transport) = SessionUdpService::start(ipv4).expect("start session UDP");
        let ipv6 = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0))
            .await
            .expect("bind IPv6 DHT socket");
        udp.replace_socket(ipv6).await.expect("add IPv6 DHT socket");
        let ipv4_address = udp
            .local_address_for(AddressFamily::Ipv4)
            .expect("IPv4 DHT address");
        let ipv6_address = udp
            .local_address_for(AddressFamily::Ipv6)
            .expect("IPv6 DHT address");
        let dht = DhtService::start_with_transport(config, transport)
            .await
            .expect("start dual-stack DHT");
        (udp, dht, ipv4_address, ipv6_address)
    }

    #[tokio::test]
    async fn bep32_want_selects_receiving_requested_or_both_tables() {
        let (oracle_udp, oracle, oracle_v4, oracle_v6) =
            dual_stack_dht(loopback_config(Vec::new())).await;
        let (udp, dht, ipv4_address, ipv6_address) = dual_stack_dht(loopback_config(vec![
            BootstrapNode::Address(oracle_v4),
            BootstrapNode::Address(oracle_v6),
        ]))
        .await;
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if dht.handle().stats().await.unwrap().responses_received >= 2 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("both family bootstrap responses");
        let ipv4_remote = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let ipv6_remote = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let v4_id = NodeId([4; 20]);
        let v6_id = NodeId([6; 20]);
        let ping4 = encode_query(b"p4", v4_id, &Query::Ping, false).unwrap();
        let ping6 = encode_query(b"p6", v6_id, &Query::Ping, false).unwrap();
        assert!(matches!(
            exchange(&ipv4_remote, ipv4_address, &ping4).await,
            Message::Response(_)
        ));
        assert!(matches!(
            exchange(&ipv6_remote, ipv6_address, &ping6).await,
            Message::Response(_)
        ));

        let query = |transaction: &'static [u8], want| {
            encode_query(
                transaction,
                NodeId([8; 20]),
                &Query::FindNode {
                    target: NodeId::ZERO,
                    want,
                },
                true,
            )
            .unwrap()
        };
        let Message::Response(receiving) =
            exchange(&ipv4_remote, ipv4_address, &query(b"r4", Vec::new())).await
        else {
            panic!("find_node response expected");
        };
        assert!(!receiving.nodes.is_empty());
        assert!(receiving.nodes6.is_empty());

        let Message::Response(requested) =
            exchange(&ipv4_remote, ipv4_address, &query(b"r6", vec![Want::Ipv6])).await
        else {
            panic!("find_node response expected");
        };
        assert!(requested.nodes.is_empty());
        assert!(!requested.nodes6.is_empty());

        let Message::Response(both) = exchange(
            &ipv4_remote,
            ipv4_address,
            &query(b"rb", vec![Want::Ipv4, Want::Ipv6]),
        )
        .await
        else {
            panic!("find_node response expected");
        };
        assert!(!both.nodes.is_empty());
        assert!(!both.nodes6.is_empty());

        dht.shutdown().await.unwrap();
        udp.shutdown().await.unwrap();
        oracle.shutdown().await.unwrap();
        oracle_udp.shutdown().await.unwrap();
    }

    #[test]
    fn outgoing_want_is_absent_natively_and_requests_our_cross_family() {
        assert!(
            outgoing_want(
                AddressFamily::Ipv4,
                SocketAddr::from((Ipv4Addr::LOCALHOST, 1)),
            )
            .is_empty()
        );
        assert!(
            outgoing_want(
                AddressFamily::Ipv6,
                SocketAddr::from((Ipv6Addr::LOCALHOST, 1)),
            )
            .is_empty()
        );
        assert_eq!(
            outgoing_want(
                AddressFamily::Ipv6,
                SocketAddr::from((Ipv4Addr::LOCALHOST, 1)),
            ),
            vec![Want::Ipv6]
        );
    }

    #[tokio::test]
    async fn product_lookup_merges_family_peers_without_hybrid_responses() {
        let (server_udp, server, server_v4, server_v6) =
            dual_stack_dht(loopback_config(Vec::new())).await;
        let info_hash = NodeId([13; 20]);
        let v6_announcer = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let get_peers = encode_query(
            b"g6",
            NodeId([6; 20]),
            &Query::GetPeers {
                info_hash,
                want: Vec::new(),
            },
            false,
        )
        .unwrap();
        let Message::Response(ResponseMessage {
            token: Some(token),
            peers,
            ..
        }) = exchange(&v6_announcer, server_v6, &get_peers).await
        else {
            panic!("IPv6 get_peers response expected");
        };
        assert!(peers.is_empty());
        let announce = encode_query(
            b"a6",
            NodeId([6; 20]),
            &Query::AnnouncePeer {
                info_hash,
                port: 56_666,
                implied_port: false,
                token,
            },
            false,
        )
        .unwrap();
        assert!(matches!(
            exchange(&v6_announcer, server_v6, &announce).await,
            Message::Response(_)
        ));

        let v4_probe = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let Message::Response(v4_response) = exchange(&v4_probe, server_v4, &get_peers).await
        else {
            panic!("IPv4 get_peers response expected");
        };
        assert!(v4_response.peers.is_empty());

        let config = loopback_config(vec![
            BootstrapNode::Address(server_v4),
            BootstrapNode::Address(server_v6),
        ]);
        let (client_udp, client, _, _) = dual_stack_dht(config).await;
        let peers = client.handle().lookup(info_hash.0).await.unwrap();
        assert_eq!(peers, vec![SocketAddr::from((Ipv6Addr::LOCALHOST, 56_666))]);

        client.shutdown().await.unwrap();
        client_udp.shutdown().await.unwrap();
        server.shutdown().await.unwrap();
        server_udp.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn product_announcement_uses_each_familys_port() {
        let (server_udp, server, server_v4, server_v6) =
            dual_stack_dht(loopback_config(Vec::new())).await;
        let (client_udp, client, _, _) = dual_stack_dht(loopback_config(vec![
            BootstrapNode::Address(server_v4),
            BootstrapNode::Address(server_v6),
        ]))
        .await;
        let info_hash = NodeId([14; 20]);
        let report = client
            .handle()
            .lookup_and_announce_ports(
                info_hash.0,
                DhtAnnouncePorts {
                    ipv4: 44_444,
                    ipv6: 46_666,
                },
            )
            .await
            .expect("dual-family announcement");
        assert_eq!(report.announces_succeeded, 2);

        let query = encode_query(
            b"gp",
            NodeId([8; 20]),
            &Query::GetPeers {
                info_hash,
                want: Vec::new(),
            },
            true,
        )
        .unwrap();
        let ipv4_probe = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let Message::Response(ipv4) = exchange(&ipv4_probe, server_v4, &query).await else {
            panic!("IPv4 get_peers response expected");
        };
        assert_eq!(ipv4.peers.len(), 1);
        assert_eq!(socket_endpoint(ipv4.peers[0]).port(), 44_444);

        let ipv6_probe = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let Message::Response(ipv6) = exchange(&ipv6_probe, server_v6, &query).await else {
            panic!("IPv6 get_peers response expected");
        };
        assert_eq!(ipv6.peers.len(), 1);
        assert_eq!(socket_endpoint(ipv6.peers[0]).port(), 46_666);

        let ipv4_only_hash = NodeId([15; 20]);
        let report = client
            .handle()
            .lookup_and_announce_ports(
                ipv4_only_hash.0,
                DhtAnnouncePorts {
                    ipv4: 48_888,
                    ipv6: 0,
                },
            )
            .await
            .expect("single-family announcement");
        assert_eq!(report.announces_succeeded, 1);
        let single_family_query = encode_query(
            b"sf",
            NodeId([8; 20]),
            &Query::GetPeers {
                info_hash: ipv4_only_hash,
                want: Vec::new(),
            },
            true,
        )
        .unwrap();
        let Message::Response(ipv4) = exchange(&ipv4_probe, server_v4, &single_family_query).await
        else {
            panic!("single-family IPv4 response expected");
        };
        assert_eq!(ipv4.peers.len(), 1);
        assert_eq!(socket_endpoint(ipv4.peers[0]).port(), 48_888);
        let Message::Response(ipv6) = exchange(&ipv6_probe, server_v6, &single_family_query).await
        else {
            panic!("single-family IPv6 response expected");
        };
        assert!(ipv6.peers.is_empty());

        client.shutdown().await.unwrap();
        client_udp.shutdown().await.unwrap();
        server.shutdown().await.unwrap();
        server_udp.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn ipv6_node_retires_and_restores_by_bound_address() {
        let (mut udp, dht, _, first_address) = dual_stack_dht(loopback_config(Vec::new())).await;
        let remote = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let ping = encode_query(b"id", NodeId([7; 20]), &Query::Ping, true).unwrap();
        let Message::Response(first) = exchange(&remote, first_address, &ping).await else {
            panic!("first IPv6 response expected");
        };

        udp.remove_family(AddressFamily::Ipv6).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        let replacement = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let replacement_address = replacement.local_addr().unwrap();
        udp.replace_socket(replacement).await.unwrap();
        let second = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                remote.send_to(&ping, replacement_address).await.unwrap();
                let mut bytes = [0_u8; MAX_DATAGRAM_SIZE];
                if let Ok(Ok((length, source))) =
                    tokio::time::timeout(Duration::from_millis(250), remote.recv_from(&mut bytes))
                        .await
                {
                    assert_eq!(source, replacement_address);
                    if let Message::Response(response) = decode_message(&bytes[..length]).unwrap() {
                        break response;
                    }
                }
            }
        })
        .await
        .expect("replacement IPv6 node response");
        assert_eq!(second.id, first.id);

        let snapshot = dht.shutdown().await.unwrap();
        assert_eq!(snapshot.identities_v6.len(), 1);
        assert_eq!(snapshot.identities_v6[0].node_id, first.id);
        udp.shutdown().await.unwrap();
    }

    async fn exchange(socket: &UdpSocket, server: SocketAddr, bytes: &[u8]) -> Message {
        socket.send_to(bytes, server).await.expect("send query");
        let mut response = [0_u8; MAX_DATAGRAM_SIZE];
        let (length, source) =
            tokio::time::timeout(Duration::from_secs(1), socket.recv_from(&mut response))
                .await
                .expect("response timeout")
                .expect("receive response");
        assert_eq!(source, server);
        decode_message(&response[..length]).expect("decode response")
    }

    #[tokio::test]
    async fn lookup_streams_new_peers_per_reply_before_finishing() {
        let node_a = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let node_b = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let a_address = node_a.local_addr().unwrap();
        let b_contact = NodeContact {
            id: NodeId([0x22; 20]),
            address: dht_endpoint(node_b.local_addr().unwrap()),
        };
        let (release_b, hold_b) = oneshot::channel();
        let a = tokio::spawn(test_support::scripted_peer_node(
            node_a,
            NodeId([0x11; 20]),
            vec![b_contact],
            vec![
                test_support::loopback_peer(50_001),
                test_support::loopback_peer(50_002),
            ],
            None,
        ));
        let b = tokio::spawn(test_support::scripted_peer_node(
            node_b,
            b_contact.id,
            Vec::new(),
            vec![
                test_support::loopback_peer(50_002),
                test_support::loopback_peer(50_003),
            ],
            Some(hold_b),
        ));
        let mut config = loopback_config(vec![BootstrapNode::Address(a_address)]);
        config.query_timeout = Duration::from_secs(5);
        config.lookup_timeout = Duration::from_secs(10);
        let client = DhtService::start(config).await.expect("start client");
        let handle = client.handle();
        let (progress, mut batches) = mpsc::channel(8);
        let lookup =
            tokio::spawn(async move { handle.lookup_with_progress([0x33; 20], progress).await });

        let first = tokio::time::timeout(Duration::from_secs(3), batches.recv())
            .await
            .expect("first batch before node B replies")
            .expect("first batch");
        assert_eq!(
            first.into_iter().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                test_support::loopback_peer(50_001),
                test_support::loopback_peer(50_002)
            ])
        );
        assert!(!lookup.is_finished(), "lookup still waits for node B");

        release_b.send(()).unwrap();
        let second = tokio::time::timeout(Duration::from_secs(3), batches.recv())
            .await
            .expect("second batch")
            .expect("second batch");
        assert_eq!(
            second,
            vec![test_support::loopback_peer(50_003)],
            "duplicates are not resent"
        );
        let peers = lookup.await.unwrap().expect("lookup result");
        assert_eq!(
            peers.into_iter().collect::<BTreeSet<_>>(),
            BTreeSet::from([
                test_support::loopback_peer(50_001),
                test_support::loopback_peer(50_002),
                test_support::loopback_peer(50_003)
            ])
        );
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), batches.recv())
                .await
                .expect("progress closes with the lookup"),
            None
        );

        client.shutdown().await.unwrap();
        a.abort();
        b.abort();
    }

    #[tokio::test]
    async fn full_progress_channel_never_stalls_the_lookup() {
        let node = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = node.local_addr().unwrap();
        let server = tokio::spawn(test_support::scripted_peer_node(
            node,
            NodeId([0x11; 20]),
            Vec::new(),
            vec![test_support::loopback_peer(50_011)],
            None,
        ));
        let client = DhtService::start(loopback_config(vec![BootstrapNode::Address(address)]))
            .await
            .expect("start client");
        let (progress, mut batches) = mpsc::channel(1);
        progress
            .try_send(Vec::new())
            .expect("fill progress channel");

        let peers = client
            .handle()
            .lookup_with_progress([0x34; 20], progress)
            .await
            .expect("lookup completes");
        assert_eq!(peers, vec![test_support::loopback_peer(50_011)]);
        assert_eq!(
            batches.recv().await,
            Some(Vec::new()),
            "only the filler was queued"
        );

        client.shutdown().await.unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn lookup_uses_incoming_announce_and_warm_restart_hint() {
        let server = DhtService::start(loopback_config(Vec::new()))
            .await
            .expect("start server");
        let server_address = server.local_address();
        let announcer = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind announcer");
        let announcer_id = NodeId([7; 20]);
        let info_hash = NodeId([9; 20]);
        let get_peers = encode_query(
            b"aa",
            announcer_id,
            &Query::GetPeers {
                info_hash,
                want: vec![Want::Ipv4],
            },
            false,
        )
        .expect("encode get_peers");
        let Message::Response(ResponseMessage {
            token: Some(token), ..
        }) = exchange(&announcer, server_address, &get_peers).await
        else {
            panic!("get_peers response with token expected");
        };
        let announced_peer = SocketAddr::from((Ipv4Addr::LOCALHOST, 55_555));
        let announce = encode_query(
            b"ab",
            announcer_id,
            &Query::AnnouncePeer {
                info_hash,
                port: announced_peer.port(),
                implied_port: false,
                token,
            },
            false,
        )
        .expect("encode announce");
        assert!(matches!(
            exchange(&announcer, server_address, &announce).await,
            Message::Response(_)
        ));

        let client = DhtService::start(loopback_config(vec![BootstrapNode::Address(
            server_address,
        )]))
        .await
        .expect("start client");
        let peers = client
            .handle()
            .lookup(info_hash.0)
            .await
            .expect("lookup peer");
        assert_eq!(peers, vec![announced_peer]);
        let snapshot = client.shutdown().await.expect("client snapshot");
        assert_eq!(snapshot.nodes_v4.len(), 1);
        assert_eq!(snapshot.nodes_v4[0].address, dht_endpoint(server_address));

        let mut warm_config = loopback_config(Vec::new());
        warm_config.initial_snapshot = Some(snapshot);
        let warm = DhtService::start(warm_config).await.expect("warm client");
        let warm_peers = warm
            .handle()
            .lookup(info_hash.0)
            .await
            .expect("warm lookup peer");
        assert_eq!(warm_peers, vec![announced_peer]);
        warm.shutdown().await.expect("warm shutdown");
        server.shutdown().await.expect("server shutdown");
    }

    #[tokio::test]
    async fn lookup_and_announce_uses_the_explicit_tcp_port_and_correlated_token() {
        let server = DhtService::start(loopback_config(Vec::new()))
            .await
            .expect("start server");
        let server_address = server.local_address();
        let client = DhtService::start(loopback_config(vec![BootstrapNode::Address(
            server_address,
        )]))
        .await
        .expect("start client");
        let info_hash = [11; 20];

        let report = client
            .handle()
            .lookup_and_announce(info_hash, 55_555)
            .await
            .expect("announce peer");
        assert_eq!(report.token_nodes, 1);
        assert_eq!(report.announces_sent, 1);
        assert_eq!(report.announces_succeeded, 1);
        assert_eq!(report.announces_failed, 0);

        let peers = client
            .handle()
            .lookup(info_hash)
            .await
            .expect("lookup announced peer");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].port(), 55_555);
        assert_ne!(peers[0].port(), client.local_address().port());

        client.shutdown().await.expect("client shutdown");
        server.shutdown().await.expect("server shutdown");
    }

    #[tokio::test]
    async fn offline_lookup_fails_without_sending() {
        let mut config = loopback_config(Vec::new());
        config.network_policy = NetworkPolicy::Offline;
        let service = DhtService::start(config).await.expect("offline service");
        assert_eq!(
            service.handle().lookup([1; 20]).await,
            Err(DhtError::NetworkDisabled)
        );
        service.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn observations_are_latest_value_bounded_and_terminal() {
        let router = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind silent router");
        let router_address = router.local_addr().expect("router address");
        let mut config = loopback_config(vec![BootstrapNode::Address(router_address)]);
        config.query_timeout = Duration::from_secs(2);
        let service = DhtService::start(config).await.expect("start DHT");
        let service_address = service.local_address();
        let mut observations = service.subscribe_observations();
        assert_eq!(
            family_observation(&observations.borrow(), AddressFamily::Ipv4)
                .buckets
                .len(),
            160
        );
        observations.borrow_and_update();

        let handle = service.handle();
        let lookup_handle = handle.clone();
        let lookup = tokio::spawn(async move { lookup_handle.lookup([5; 20]).await });
        let malformed = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind malformed sender");
        malformed
            .send_to(b"x", service_address)
            .await
            .expect("send malformed datagram");
        let mut received_bytes = 1_u64;
        for transaction in 0..=MAX_QUERIES_PER_SOURCE_MINUTE {
            let ping = encode_query(
                &[u8::try_from(transaction).expect("bounded transaction")],
                NodeId([4; 20]),
                &Query::Ping,
                true,
            )
            .expect("encode ping");
            received_bytes = received_bytes.saturating_add(ping.len() as u64);
            malformed
                .send_to(&ping, service_address)
                .await
                .expect("send rate-limit probe");
        }

        let active = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                observations.changed().await.expect("active observation");
                let observation = observations.borrow_and_update().clone();
                if observation
                    .families
                    .iter()
                    .any(|family| !family.lookups.is_empty())
                    && observation.stats.malformed_received == 1
                    && observation.stats.rate_limited == 1
                    && observation.stats.datagram_bytes_sent > 0
                {
                    break observation;
                }
            }
        })
        .await
        .expect("active observation timeout");
        assert_eq!(active.lifecycle, DhtLifecycle::BootstrapEmpty);
        assert_eq!(active.stats.datagram_bytes_received, received_bytes);
        assert_eq!(
            active.stats.queries_received,
            u64::from(MAX_QUERIES_PER_SOURCE_MINUTE) + 1
        );
        assert_eq!(
            active
                .families
                .iter()
                .map(|family| family.lookups.len())
                .sum::<usize>(),
            1
        );
        assert!(active.stats.active_transactions <= MAX_ACTIVE_TRANSACTIONS as u32);

        service.shutdown().await.expect("shutdown");
        let terminal = loop {
            let observation = observations.borrow_and_update().clone();
            if observation.lifecycle == DhtLifecycle::Inactive {
                break observation;
            }
            if observations.changed().await.is_err() {
                break observations.borrow_and_update().clone();
            }
        };
        assert_eq!(terminal.lifecycle, DhtLifecycle::Inactive);
        assert_eq!(terminal.stats.active_transactions, 0);
        assert!(
            terminal
                .families
                .iter()
                .all(|family| family.lookups.is_empty())
        );
        assert_eq!(lookup.await.expect("lookup task"), Err(DhtError::Cancelled));
    }

    #[tokio::test]
    async fn unreachable_bootstrap_is_retried() {
        let router = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind silent router");
        let router_address = router.local_addr().expect("router address");
        let mut config = loopback_config(vec![BootstrapNode::Address(router_address)]);
        config.query_timeout = Duration::from_millis(100);
        config.lookup_timeout = Duration::from_secs(1);
        config.bootstrap_retry_interval = Duration::from_millis(300);
        let service = DhtService::start(config).await.expect("start DHT");
        let mut packet = [0_u8; MAX_DATAGRAM_SIZE];
        tokio::time::timeout(Duration::from_secs(1), router.recv_from(&mut packet))
            .await
            .expect("initial bootstrap timed out")
            .expect("initial bootstrap");
        tokio::time::timeout(Duration::from_secs(2), router.recv_from(&mut packet))
            .await
            .expect("bootstrap retry timed out")
            .expect("bootstrap retry");
        assert!(
            service
                .handle()
                .stats()
                .await
                .expect("DHT stats")
                .bootstrap_attempts
                >= 2
        );
        service.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn warm_nodes_are_attempted_before_cold_fallback() {
        let warm = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind warm node");
        let warm_address = warm.local_addr().expect("warm address");
        let fallback = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind fallback node");
        let fallback_address = fallback.local_addr().expect("fallback address");
        let mut config = loopback_config(vec![BootstrapNode::Address(fallback_address)]);
        config.query_timeout = Duration::from_millis(100);
        config.lookup_timeout = Duration::from_secs(1);
        config.initial_snapshot = Some(DhtSnapshot {
            version: DHT_SNAPSHOT_VERSION,
            identities_v4: Vec::new(),
            identities_v6: Vec::new(),
            nodes_v4: vec![NodeContact {
                id: NodeId([2; 20]),
                address: dht_endpoint(warm_address),
            }],
            nodes_v6: Vec::new(),
        });
        let service = DhtService::start(config).await.expect("start DHT");
        let mut packet = [0_u8; MAX_DATAGRAM_SIZE];
        tokio::time::timeout(Duration::from_secs(1), warm.recv_from(&mut packet))
            .await
            .expect("warm bootstrap timed out")
            .expect("warm bootstrap");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), fallback.recv_from(&mut packet),)
                .await
                .is_err(),
            "cold fallback must wait for the warm attempt to expire"
        );
        tokio::time::timeout(Duration::from_secs(1), fallback.recv_from(&mut packet))
            .await
            .expect("cold fallback timed out")
            .expect("cold fallback");
        service.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn dropped_lookup_receiver_releases_actor_work() {
        let router = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind silent router");
        let router_address = router.local_addr().expect("router address");
        let mut config = loopback_config(vec![BootstrapNode::Address(router_address)]);
        config.query_timeout = Duration::from_secs(1);
        config.lookup_timeout = Duration::from_secs(2);
        let service = DhtService::start(config).await.expect("start DHT");
        let handle = service.handle();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), handle.lookup([5; 20]))
                .await
                .is_err()
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(handle.stats().await.expect("DHT stats").active_lookups, 0);
        service.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn responsive_table_is_refreshed_periodically() {
        let router = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind router");
        let router_address = router.local_addr().expect("router address");
        let mut config = loopback_config(vec![BootstrapNode::Address(router_address)]);
        config.routing_refresh_interval = Duration::from_millis(300);
        let service = DhtService::start(config).await.expect("start DHT");
        let mut packet = [0_u8; MAX_DATAGRAM_SIZE];
        let (length, client) =
            tokio::time::timeout(Duration::from_secs(1), router.recv_from(&mut packet))
                .await
                .expect("initial bootstrap timed out")
                .expect("initial bootstrap");
        let Message::Query(query) = decode_message(&packet[..length]).expect("bootstrap query")
        else {
            panic!("bootstrap must be a query");
        };
        let response = encode_response(
            &query.transaction,
            NodeId([4; 20]),
            &[],
            &[],
            None,
            dht_endpoint(client),
        )
        .expect("bootstrap response");
        router
            .send_to(&response, client)
            .await
            .expect("send bootstrap response");
        tokio::time::timeout(Duration::from_secs(2), router.recv_from(&mut packet))
            .await
            .expect("routing refresh timed out")
            .expect("routing refresh");
        assert!(
            service
                .handle()
                .stats()
                .await
                .expect("DHT stats")
                .routing_refreshes
                >= 1
        );
        service.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    #[ignore = "uses changing public Mainline DHT bootstrap routers"]
    async fn live_public_bootstrap_reaches_bep42_node() {
        let service = DhtService::start(DhtConfig::for_network(NetworkPolicy::Online))
            .await
            .expect("start public DHT");
        let handle = service.handle();
        let reached = tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let stats = handle.stats().await.expect("public DHT stats");
                if stats.responses_received > 0 && stats.routing_nodes_v4 > 0 {
                    return stats;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await;
        if reached.is_err() {
            let stats = handle.stats().await.expect("timed-out public DHT stats");
            service.shutdown().await.expect("public DHT shutdown");
            panic!("public bootstrap did not reach a BEP 42-valid node; stats={stats:?}");
        }
        service.shutdown().await.expect("public DHT shutdown");
    }

    #[test]
    fn snapshot_validation_bounds_and_filters_contacts() {
        let snapshot = DhtSnapshot {
            version: DHT_SNAPSHOT_VERSION,
            identities_v4: vec![DhtIdentity {
                address: IpAddr::V4(Ipv4Addr::LOCALHOST),
                node_id: NodeId([1; 20]),
            }],
            identities_v6: Vec::new(),
            nodes_v4: vec![NodeContact {
                id: NodeId([2; 20]),
                address: dht_endpoint(SocketAddr::from((Ipv4Addr::LOCALHOST, 6881))),
            }],
            nodes_v6: Vec::new(),
        }
        .validate()
        .expect("valid snapshot");
        assert_eq!(snapshot.nodes_v4.len(), 1);
        assert!(matches!(
            DhtSnapshot {
                version: 1,
                ..snapshot
            }
            .validate(),
            Err(DhtError::UnsupportedSnapshotVersion(1))
        ));
    }

    #[test]
    fn snapshot_identity_restore_is_address_and_family_exact() {
        let v4 = DhtIdentity {
            address: IpAddr::V4(Ipv4Addr::new(198, 51, 100, 9)),
            node_id: NodeId([4; 20]),
        };
        let v6 = DhtIdentity {
            address: "2001:db8::9".parse().unwrap(),
            node_id: NodeId([6; 20]),
        };
        assert_eq!(
            select_identity(std::slice::from_ref(&v4), v4.address),
            Some(&v4)
        );
        assert_eq!(
            select_identity(std::slice::from_ref(&v6), v6.address),
            Some(&v6)
        );
        assert_eq!(select_identity(std::slice::from_ref(&v4), v6.address), None);
        assert_eq!(
            select_identity(std::slice::from_ref(&v6), "2001:db8::10".parse().unwrap(),),
            None
        );

        let now = Instant::now();
        let ipv4 = DhtNode::new(
            SocketAddr::new(v4.address, 1),
            std::slice::from_ref(&v4),
            FamilyBootstrap::default(),
            now,
        )
        .unwrap();
        let ipv6 = DhtNode::new(
            SocketAddr::from((Ipv6Addr::LOCALHOST, 1)),
            &[],
            FamilyBootstrap::default(),
            now,
        )
        .unwrap();
        assert_eq!(ipv4.node_id, v4.node_id);
        assert_eq!(ipv4.identities, vec![v4]);
        assert_eq!(ipv6.identities[0].address, IpAddr::V6(Ipv6Addr::LOCALHOST));
    }
}
