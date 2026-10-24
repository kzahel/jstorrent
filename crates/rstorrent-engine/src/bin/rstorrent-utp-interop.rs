#![recursion_limit = "256"]

//! Controlled loopback and explicit WAN uTP/libtorrent interoperability roles.

use std::collections::BTreeSet;
use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::io::Write as _;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rstorrent_engine::peer::PeerRegistrySnapshot;
use rstorrent_engine::port_mapping::upnp::{
    UpnpDiscoveryConfig, UpnpError, UpnpMapping, UpnpStage, UpnpTransport, discover_igd_v2,
};
use rstorrent_engine::{
    AddressFamilyPolicy, IncomingPeerHandle, IncomingPeerRuntime, IncomingPeerServiceConfig,
    IncomingPeerServiceSnapshot, IncomingTcpBootstrap, NetworkConfig, NetworkPolicy,
    PeerConnectionObservation, PeerEncryptionPolicy, PeerTransport, SeedContent, SeedRegistration,
    SessionUdpService, SessionUdpSnapshot, TorrentId, TorrentPeerActivitySink, TorrentPeerHandle,
    UtpRuntimeConfig, UtpService, UtpServiceSnapshot, download_controlled_utp,
};
use rstorrent_protocol::metainfo::{BEP9_METAINFO_LIMITS, Metainfo, MetainfoMode};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

const PAYLOAD_BYTES: u64 = 2 * 1024 * 1024 + 731;
const MAX_INTEROP_PAYLOAD_BYTES: u64 = 64 * 1024 * 1024 + 731;
const PIECE_BYTES: u32 = 64 * 1024;
const LOOPBACK_ROLE_TIMEOUT: Duration = Duration::from_secs(30);
const PLATFORM_ROLE_TIMEOUT: Duration = Duration::from_secs(60);
const WAN_ROLE_TIMEOUT: Duration = Duration::from_secs(180);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const PEER_IO_TIMEOUT: Duration = Duration::from_secs(5);
const LEECHER_PEER_ID: [u8; 20] = *b"-RSUTPL-000000000000";
const SEED_PEER_ID: [u8; 20] = *b"-RSUTPS-000000000000";
const MAPPING_DESCRIPTION: &str = "JSTorrent";
const USAGE: &str = "\
Usage:
  rstorrent-utp-interop leecher --metainfo PATH --peer 127.0.0.1:PORT --output PATH
  rstorrent-utp-interop wan-leecher --metainfo PATH --peer PUBLIC_IPV4:PORT --output PATH
  rstorrent-utp-interop seed --metainfo PATH --storage-root PATH
  rstorrent-utp-interop impairment-seed --metainfo PATH --storage-root PATH
  rstorrent-utp-interop product-mtu-seed --metainfo PATH --storage-root PATH
  rstorrent-utp-interop diagnostic-mtu-seed --metainfo PATH --storage-root PATH
  rstorrent-utp-interop platform-mtu-probe
  rstorrent-utp-interop wan-seed --metainfo PATH --storage-root PATH
  rstorrent-utp-interop wan-mapping-audit --local-port PORT --external-port PORT";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LeecherScope {
    Loopback,
    Wan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SeedScope {
    Loopback,
    Impairment,
    ProductMtu,
    DiagnosticMtu,
    Wan,
}

impl SeedScope {
    const fn role(self) -> &'static str {
        match self {
            Self::Loopback => "seed",
            Self::Impairment => "impairment-seed",
            Self::ProductMtu => "product-mtu-seed",
            Self::DiagnosticMtu => "diagnostic-mtu-seed",
            Self::Wan => "wan-seed",
        }
    }
}

impl LeecherScope {
    const fn role(self) -> &'static str {
        match self {
            Self::Loopback => "leecher",
            Self::Wan => "wan-leecher",
        }
    }

    const fn bind_address(self) -> Ipv4Addr {
        match self {
            Self::Loopback => Ipv4Addr::LOCALHOST,
            Self::Wan => Ipv4Addr::UNSPECIFIED,
        }
    }

    const fn network_policy(self) -> NetworkPolicy {
        match self {
            Self::Loopback => NetworkPolicy::LoopbackOnly,
            Self::Wan => NetworkPolicy::Online,
        }
    }
}

#[derive(Debug)]
enum Arguments {
    Leecher {
        scope: LeecherScope,
        metainfo: PathBuf,
        peer: SocketAddr,
        output: PathBuf,
    },
    Seed {
        scope: SeedScope,
        metainfo: PathBuf,
        storage_root: PathBuf,
    },
    MappingAudit {
        local_port: u16,
        external_port: u16,
    },
    PlatformMtuProbe,
}

impl Arguments {
    fn timeout(&self) -> Duration {
        match self {
            Self::Leecher {
                scope: LeecherScope::Wan,
                ..
            } => WAN_ROLE_TIMEOUT,
            Self::Leecher {
                scope: LeecherScope::Loopback,
                ..
            }
            | Self::Seed {
                scope: SeedScope::Loopback,
                ..
            }
            | Self::MappingAudit { .. } => LOOPBACK_ROLE_TIMEOUT,
            Self::PlatformMtuProbe => PLATFORM_ROLE_TIMEOUT,
            Self::Seed {
                scope:
                    SeedScope::Wan
                    | SeedScope::Impairment
                    | SeedScope::ProductMtu
                    | SeedScope::DiagnosticMtu,
                ..
            } => WAN_ROLE_TIMEOUT,
        }
    }

    fn parse(mut values: impl Iterator<Item = OsString>) -> Result<Self, String> {
        let role = values
            .next()
            .ok_or_else(|| "a role is required".to_owned())?;
        let role = role
            .to_str()
            .ok_or_else(|| "the role must be valid UTF-8".to_owned())?;
        let values = values.collect::<Vec<_>>();
        let mut metainfo = None;
        let mut peer = None;
        let mut output = None;
        let mut storage_root = None;
        let mut local_port = None;
        let mut external_port = None;
        let mut index = 0;
        while index < values.len() {
            let flag = values[index]
                .to_str()
                .ok_or_else(|| "flags must be valid UTF-8".to_owned())?;
            index += 1;
            let value = values
                .get(index)
                .ok_or_else(|| format!("{flag} requires a value"))?;
            index += 1;
            match flag {
                "--metainfo" => set_once(&mut metainfo, PathBuf::from(value), flag)?,
                "--peer" => {
                    let value = value
                        .to_str()
                        .ok_or_else(|| "--peer must be valid UTF-8".to_owned())?;
                    let address = value
                        .parse::<SocketAddr>()
                        .map_err(|_| "--peer must be an IP address and port".to_owned())?;
                    set_once(&mut peer, address, flag)?;
                }
                "--output" => set_once(&mut output, PathBuf::from(value), flag)?,
                "--storage-root" => {
                    set_once(&mut storage_root, PathBuf::from(value), flag)?;
                }
                "--local-port" => {
                    set_once(&mut local_port, parse_port(value, flag)?, flag)?;
                }
                "--external-port" => {
                    set_once(&mut external_port, parse_port(value, flag)?, flag)?;
                }
                _ => return Err(format!("unknown argument {flag}")),
            }
        }
        match role {
            "leecher" | "wan-leecher" => {
                if storage_root.is_some() || local_port.is_some() || external_port.is_some() {
                    return Err(format!("{role} received a role-specific argument"));
                }
                let metainfo = metainfo.ok_or_else(|| "--metainfo is required".to_owned())?;
                let peer = peer.ok_or_else(|| format!("{role} requires --peer"))?;
                let scope = if role == "leecher" {
                    LeecherScope::Loopback
                } else {
                    LeecherScope::Wan
                };
                let eligible = match (scope, peer) {
                    (LeecherScope::Loopback, SocketAddr::V4(address)) => {
                        address.ip().is_loopback() && address.port() != 0
                    }
                    (LeecherScope::Wan, SocketAddr::V4(address)) => {
                        eligible_public_ipv4(*address.ip()) && address.port() != 0
                    }
                    (_, SocketAddr::V6(_)) => false,
                };
                if !eligible {
                    return Err(match scope {
                        LeecherScope::Loopback => {
                            "--peer must be a nonzero IPv4 loopback endpoint".to_owned()
                        }
                        LeecherScope::Wan => {
                            "--peer must be a nonzero public IPv4 endpoint".to_owned()
                        }
                    });
                }
                Ok(Self::Leecher {
                    scope,
                    metainfo,
                    peer,
                    output: output.ok_or_else(|| format!("{role} requires --output"))?,
                })
            }
            "seed"
            | "impairment-seed"
            | "product-mtu-seed"
            | "diagnostic-mtu-seed"
            | "wan-seed" => {
                if peer.is_some()
                    || output.is_some()
                    || local_port.is_some()
                    || external_port.is_some()
                {
                    return Err(format!("{role} received a role-specific argument"));
                }
                Ok(Self::Seed {
                    scope: match role {
                        "seed" => SeedScope::Loopback,
                        "impairment-seed" => SeedScope::Impairment,
                        "product-mtu-seed" => SeedScope::ProductMtu,
                        "diagnostic-mtu-seed" => SeedScope::DiagnosticMtu,
                        "wan-seed" => SeedScope::Wan,
                        _ => unreachable!(),
                    },
                    metainfo: metainfo.ok_or_else(|| "--metainfo is required".to_owned())?,
                    storage_root: storage_root
                        .ok_or_else(|| format!("{role} requires --storage-root"))?,
                })
            }
            "wan-mapping-audit" => {
                if metainfo.is_some()
                    || peer.is_some()
                    || output.is_some()
                    || storage_root.is_some()
                {
                    return Err("wan-mapping-audit received a role-specific argument".to_owned());
                }
                Ok(Self::MappingAudit {
                    local_port: local_port
                        .ok_or_else(|| "wan-mapping-audit requires --local-port".to_owned())?,
                    external_port: external_port
                        .ok_or_else(|| "wan-mapping-audit requires --external-port".to_owned())?,
                })
            }
            "platform-mtu-probe" => {
                if metainfo.is_some()
                    || peer.is_some()
                    || output.is_some()
                    || storage_root.is_some()
                    || local_port.is_some()
                    || external_port.is_some()
                {
                    return Err("platform-mtu-probe received an argument".to_owned());
                }
                Ok(Self::PlatformMtuProbe)
            }
            _ => Err(format!("unknown role {role}")),
        }
    }
}

fn parse_port(value: &OsString, flag: &str) -> Result<u16, String> {
    let value = value
        .to_str()
        .ok_or_else(|| format!("{flag} must be valid UTF-8"))?;
    let port = value
        .parse::<u16>()
        .map_err(|_| format!("{flag} must be a nonzero port"))?;
    if port == 0 {
        return Err(format!("{flag} must be a nonzero port"));
    }
    Ok(port)
}

fn set_once<T>(target: &mut Option<T>, value: T, flag: &str) -> Result<(), String> {
    if target.replace(value).is_some() {
        return Err(format!("{flag} may only be supplied once"));
    }
    Ok(())
}

fn eligible_public_ipv4(address: Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !matches!(first, 0 | 10 | 127)
        && !(first == 100 && (64..=127).contains(&second))
        && !(first == 169 && second == 254)
        && !(first == 172 && (16..=31).contains(&second))
        && !(first == 192 && second == 0 && third == 0)
        && !(first == 192 && second == 0 && third == 2)
        && !(first == 192 && second == 88 && third == 99)
        && !(first == 192 && second == 168)
        && !(first == 198 && (second == 18 || second == 19))
        && !(first == 198 && second == 51 && third == 100)
        && !(first == 203 && second == 0 && third == 113)
        && first < 224
}

#[derive(Clone, Debug, Default)]
struct PeerEvidence {
    connection_high_water: usize,
    utp_high_water: usize,
    tcp_high_water: usize,
    endpoints: BTreeSet<SocketAddr>,
}

#[derive(Debug, Default)]
struct RecordingPeerSink {
    evidence: Mutex<PeerEvidence>,
}

impl RecordingPeerSink {
    fn snapshot(&self) -> PeerEvidence {
        self.evidence
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl TorrentPeerActivitySink for RecordingPeerSink {
    fn record_peer_connections(
        &self,
        _captured_at: Duration,
        peers: Vec<PeerConnectionObservation>,
    ) {
        let mut evidence = self
            .evidence
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        evidence.connection_high_water = evidence.connection_high_water.max(peers.len());
        let utp = peers
            .iter()
            .filter(|peer| peer.transport == PeerTransport::Utp)
            .count();
        let tcp = peers
            .iter()
            .filter(|peer| peer.transport == PeerTransport::Tcp)
            .count();
        evidence.utp_high_water = evidence.utp_high_water.max(utp);
        evidence.tcp_high_water = evidence.tcp_high_water.max(tcp);
        evidence
            .endpoints
            .extend(peers.iter().map(|peer| peer.endpoint));
    }

    fn record_peer_registry(&self, _active: bool, _snapshot: PeerRegistrySnapshot) {}
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let arguments = match Arguments::parse(env::args_os().skip(1)) {
        Ok(arguments) => arguments,
        Err(error) => {
            eprintln!("argument error: {error}\n{USAGE}");
            std::process::exit(2);
        }
    };
    let role_timeout = arguments.timeout();
    match timeout(role_timeout, run(arguments)).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            eprintln!("uTP interoperability role failed: {error}");
            std::process::exit(1);
        }
        Err(_) => {
            eprintln!(
                "uTP interoperability role exceeded {} seconds",
                role_timeout.as_secs()
            );
            std::process::exit(1);
        }
    }
}

async fn run(arguments: Arguments) -> Result<(), Box<dyn Error>> {
    match arguments {
        Arguments::Leecher {
            scope,
            metainfo,
            peer,
            output,
        } => run_leecher(scope, &metainfo, peer, &output).await,
        Arguments::Seed {
            scope,
            metainfo,
            storage_root,
        } => run_seed(scope, &metainfo, &storage_root).await,
        Arguments::MappingAudit {
            local_port,
            external_port,
        } => run_mapping_audit(local_port, external_port).await,
        Arguments::PlatformMtuProbe => run_platform_mtu_probe().await,
    }
}

async fn run_leecher(
    scope: LeecherScope,
    metainfo_path: &Path,
    peer: SocketAddr,
    output: &Path,
) -> Result<(), Box<dyn Error>> {
    let (metainfo, _) = read_fixture(metainfo_path).await?;
    let socket = UdpSocket::bind((scope.bind_address(), 0)).await?;
    let (mut udp, dht) = SessionUdpService::start(socket)?;
    let utp = UtpService::start(&mut udp)?;
    let local_address = udp.local_address();
    write_json(json!({
        "event": "ready",
        "role": scope.role(),
        "listen": local_address.to_string(),
    }))?;

    let stream = utp.handle().connect(peer).await?;
    let network = NetworkConfig::new(scope.network_policy(), HANDSHAKE_TIMEOUT, PEER_IO_TIMEOUT)
        .with_address_families(AddressFamilyPolicy::ipv4_only())
        .with_peer_id(LEECHER_PEER_ID)
        .with_encryption(PeerEncryptionPolicy::Disabled);
    let (payload, report) = download_controlled_utp(stream, &metainfo, network).await?;
    let digest = hex(&Sha1::digest(&payload));
    write_new_file(output, &payload).await?;

    let live_utp = utp.snapshot();
    let live_udp = udp.snapshot();
    let terminal_utp = utp.shutdown().await?;
    drop(dht);
    let terminal_udp = udp.shutdown().await?;
    validate_terminal(&terminal_utp, &terminal_udp)?;
    write_json(json!({
        "event": "complete",
        "role": scope.role(),
        "listen": local_address.to_string(),
        "peer": peer.to_string(),
        "payload": {
            "bytes": report.bytes,
            "pieces": report.pieces,
            "requests": report.requests,
            "choke_retries": report.choke_retries,
            "duplicate_blocks": report.duplicate_blocks,
            "sha1": digest,
        },
        "remote_peer_id": hex(&report.peer_id),
        "resources": {
            "live_udp": udp_json(live_udp),
            "live_utp": utp_json(live_utp),
            "terminal_udp": udp_json(terminal_udp),
            "terminal_utp": utp_json(terminal_utp),
        },
    }))?;
    Ok(())
}

struct SeedEvidence {
    live_incoming: IncomingPeerServiceSnapshot,
    peers: PeerEvidence,
    live_utp: UtpServiceSnapshot,
    live_udp: SessionUdpSnapshot,
}

struct SeedMapping {
    gateway: rstorrent_engine::port_mapping::upnp::UpnpGateway,
    mapping: UpnpMapping,
    cancellation: CancellationToken,
}

async fn run_seed(
    scope: SeedScope,
    metainfo_path: &Path,
    storage_root: &Path,
) -> Result<(), Box<dyn Error>> {
    let (metainfo, raw_info) = read_fixture(metainfo_path).await?;
    let bind_address = match scope {
        SeedScope::Loopback
        | SeedScope::Impairment
        | SeedScope::ProductMtu
        | SeedScope::DiagnosticMtu => Ipv4Addr::LOCALHOST,
        SeedScope::Wan => select_local_network_ipv4().await?,
    };
    let socket = UdpSocket::bind((bind_address, 0)).await?;
    let (mut udp, dht) = SessionUdpService::start(socket)?;
    let mut utp = match scope {
        SeedScope::Impairment => {
            UtpService::start_diagnostic(&mut udp, UtpRuntimeConfig::fixed_ipv4())?
        }
        SeedScope::DiagnosticMtu => {
            UtpService::start_diagnostic(&mut udp, UtpRuntimeConfig::diagnostic_ipv4_path_mtu())?
        }
        SeedScope::Loopback | SeedScope::ProductMtu | SeedScope::Wan => {
            UtpService::start(&mut udp)?
        }
    };
    let mut incoming_config = IncomingPeerServiceConfig::new(IncomingTcpBootstrap::Disabled)
        .with_encryption(PeerEncryptionPolicy::Disabled);
    incoming_config.peer_id = SEED_PEER_ID;
    let incoming_runtime = IncomingPeerRuntime::start(incoming_config)?;
    let incoming = incoming_runtime.handle();
    let peer_sink = Arc::new(RecordingPeerSink::default());
    let torrent_peers = TorrentPeerHandle::new(peer_sink.clone())?;
    let torrent_id =
        TorrentId::generate().map_err(|error| std::io::Error::other(error.to_string()))?;
    let content = SeedContent::open_verified(
        storage_root,
        torrent_id,
        &metainfo,
        &vec![true; metainfo.piece_count()],
        &[],
    )
    .await?;
    let token = incoming
        .register(SeedRegistration::new(raw_info, content, torrent_peers)?)
        .await?;
    let local_endpoint = match udp.local_address() {
        SocketAddr::V4(endpoint) => endpoint,
        SocketAddr::V6(_) => return Err("uTP WAN seed requires an IPv4 UDP socket".into()),
    };
    let mut mapping_owner = None;
    if scope == SeedScope::Wan {
        write_json(json!({
            "event": "bound",
            "role": scope.role(),
            "listen": local_endpoint.to_string(),
        }))?;
        let cancellation = CancellationToken::new();
        let gateway = discover_igd_v2(
            UpnpDiscoveryConfig::new(bind_address).map_err(diagnostic_upnp_error)?,
            &cancellation,
        )
        .await
        .map_err(diagnostic_upnp_error)?;
        let existing = gateway
            .query_mapping(
                local_endpoint.port(),
                UpnpTransport::Udp,
                UpnpStage::Add,
                &cancellation,
            )
            .await
            .map_err(diagnostic_upnp_error)?;
        if existing.is_some() {
            return Err("exact diagnostic UDP external port is already occupied".into());
        }
        write_json(json!({
            "event": "mapping-intent",
            "role": scope.role(),
            "local_port": local_endpoint.port(),
            "external_port": local_endpoint.port(),
            "protocol": "UDP",
        }))?;
        let mapping = gateway
            .create_exact_mapping(
                UpnpTransport::Udp,
                local_endpoint.port(),
                local_endpoint.port(),
                &cancellation,
            )
            .await
            .map_err(diagnostic_upnp_error)?;
        write_json(json!({
            "event": "ready",
            "role": scope.role(),
            "listen": local_endpoint.to_string(),
            "external_address": mapping.external_address.to_string(),
            "external_port": mapping.external_port,
            "mapping": {
                "protocol": mapping.transport.as_str(),
                "transport": "UPnP",
                "lease_seconds": mapping.lease_seconds,
            },
        }))?;
        mapping_owner = Some(SeedMapping {
            gateway,
            mapping,
            cancellation,
        });
    } else {
        write_json(json!({
            "event": "ready",
            "role": scope.role(),
            "listen": local_endpoint.to_string(),
        }))?;
    }

    let transfer_result: Result<SeedEvidence, Box<dyn Error>> = async {
        let stream = utp
            .accept()
            .await
            .ok_or("uTP service stopped before accepting a stream")?;
        incoming.admit_utp(stream, HANDSHAKE_TIMEOUT).await?;
        wait_for_stop(scope, &incoming, peer_sink.as_ref(), &utp, &udp).await?;
        let live_incoming = incoming.snapshot();
        let peers = peer_sink.snapshot();
        validate_seed_evidence(scope, metainfo.total_length, &live_incoming, &peers)?;
        Ok(SeedEvidence {
            live_incoming,
            peers,
            live_utp: utp.snapshot(),
            live_udp: udp.snapshot(),
        })
    }
    .await;

    let mut failures = Vec::new();
    let evidence = match transfer_result {
        Ok(evidence) => Some(evidence),
        Err(error) => {
            failures.push(error.to_string());
            None
        }
    };
    match incoming.unregister(token).await {
        Ok(true) => {}
        Ok(false) => failures.push("seed registration disappeared before shutdown".to_owned()),
        Err(error) => failures.push(format!("unregister seed: {error}")),
    }
    let terminal_incoming = match incoming_runtime.shutdown().await {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            failures.push(format!("shutdown incoming owner: {error}"));
            None
        }
    };
    let terminal_utp = match utp.shutdown().await {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            failures.push(format!("shutdown uTP owner: {error}"));
            None
        }
    };
    let mapping_deleted = if let Some(owner) = mapping_owner {
        match owner
            .gateway
            .delete_mapping(&owner.mapping, &owner.cancellation)
            .await
        {
            Ok(()) => true,
            Err(error) => {
                failures.push(format!("delete exact UDP mapping: {error}"));
                false
            }
        }
    } else {
        false
    };
    drop(dht);
    let terminal_udp = match udp.shutdown().await {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            failures.push(format!("shutdown session UDP owner: {error}"));
            None
        }
    };
    if let (Some(terminal_utp), Some(terminal_udp)) = (&terminal_utp, &terminal_udp)
        && let Err(error) = validate_terminal(terminal_utp, terminal_udp)
    {
        failures.push(error.to_string());
    }
    if let Some(terminal_incoming) = &terminal_incoming
        && (terminal_incoming.pending != 0 || terminal_incoming.established != 0)
    {
        failures.push("incoming peer ownership was nonzero after shutdown".to_owned());
    }
    if !failures.is_empty() {
        return Err(failures.join("; ").into());
    }
    let evidence = evidence.ok_or("seed completed without transfer evidence")?;
    let terminal_incoming = terminal_incoming.ok_or("incoming terminal snapshot is missing")?;
    let terminal_utp = terminal_utp.ok_or("uTP terminal snapshot is missing")?;
    let terminal_udp = terminal_udp.ok_or("UDP terminal snapshot is missing")?;
    write_json(json!({
        "event": "complete",
        "role": scope.role(),
        "mapping_deleted": mapping_deleted,
        "payload": {
            "bytes": metainfo.total_length,
            "pieces": metainfo.piece_count(),
        },
        "peer_evidence": peer_evidence_json(&evidence.peers),
        "resources": {
            "live_incoming": incoming_json(&evidence.live_incoming),
            "live_udp": udp_json(evidence.live_udp),
            "live_utp": utp_json(evidence.live_utp),
            "terminal_incoming": incoming_json(&terminal_incoming),
            "terminal_udp": udp_json(terminal_udp),
            "terminal_utp": utp_json(terminal_utp),
        },
    }))?;
    Ok(())
}

async fn select_local_network_ipv4() -> Result<Ipv4Addr, Box<dyn Error>> {
    let probe = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).await?;
    probe
        .connect(SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 1_900))
        .await?;
    let address = match probe.local_addr()? {
        SocketAddr::V4(endpoint) => *endpoint.ip(),
        SocketAddr::V6(_) => return Err("ordinary local route selected IPv6".into()),
    };
    if address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || address.is_broadcast()
    {
        return Err("ordinary local route selected an ineligible IPv4 address".into());
    }
    Ok(address)
}

async fn run_mapping_audit(local_port: u16, external_port: u16) -> Result<(), Box<dyn Error>> {
    let local_address = select_local_network_ipv4().await?;
    let cancellation = CancellationToken::new();
    let gateway = discover_igd_v2(
        UpnpDiscoveryConfig::new(local_address).map_err(diagnostic_upnp_error)?,
        &cancellation,
    )
    .await
    .map_err(diagnostic_upnp_error)?;
    let entry = gateway
        .query_mapping(
            external_port,
            UpnpTransport::Udp,
            UpnpStage::Delete,
            &cancellation,
        )
        .await
        .map_err(diagnostic_upnp_error)?;
    let owned = entry.as_ref().is_some_and(|entry| {
        entry.internal_client == local_address
            && entry.internal_port == local_port
            && entry.enabled
            && entry.description == MAPPING_DESCRIPTION
            && entry.lease_seconds > 0
            && entry.lease_seconds <= 3_600
    });
    let foreign = entry.is_some() && !owned;
    let mut deleted = false;
    if let Some(entry) = entry.filter(|_| owned) {
        let mapping = UpnpMapping {
            local_endpoint: SocketAddrV4::new(local_address, local_port),
            external_address: gateway
                .external_address(&cancellation)
                .await
                .map_err(diagnostic_upnp_error)?,
            external_port,
            lease_seconds: entry.lease_seconds,
            transport: UpnpTransport::Udp,
        };
        gateway
            .delete_mapping(&mapping, &cancellation)
            .await
            .map_err(diagnostic_upnp_error)?;
        deleted = true;
    }
    write_json(json!({
        "event": "mapping-audit",
        "role": "wan-mapping-audit",
        "owned_mapping_found": owned,
        "owned_mapping_deleted": deleted,
        "foreign_mapping_preserved": foreign,
        "owned_mapping_absent": !owned || deleted,
    }))?;
    Ok(())
}

async fn run_platform_mtu_probe() -> Result<(), Box<dyn Error>> {
    const PROBE_PAYLOAD_BYTES: usize = 32 * 1024;

    let left_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let right_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let (mut left_udp, left_dht) = SessionUdpService::start(left_socket)?;
    let (mut right_udp, right_dht) = SessionUdpService::start(right_socket)?;
    let initial_generation = left_udp.generation();
    let initial_endpoint = left_udp.local_address();
    let initial_capability = format!("{:?}", left_udp.snapshot().ipv4_fragmentation_protection);

    let replacement_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    left_udp.replace_socket(replacement_socket).await?;
    let replacement_generation = left_udp.generation();
    let replacement_endpoint = left_udp.local_address();
    let replacement_capability = format!("{:?}", left_udp.snapshot().ipv4_fragmentation_protection);
    if initial_capability != "Verified"
        || replacement_capability != "Verified"
        || replacement_generation == initial_generation
        || replacement_endpoint == initial_endpoint
    {
        return Err(format!(
            "platform MTU replacement was not verified: initial={initial_capability} "
        )
        .into());
    }

    let left_utp = UtpService::start(&mut left_udp)?;
    let mut right_utp = UtpService::start(&mut right_udp)?;
    let right_endpoint = right_udp.local_address();
    let left_handle = left_utp.handle();
    let (left_stream, right_stream) =
        tokio::join!(left_handle.connect(right_endpoint), right_utp.accept());
    let mut left_stream = left_stream?;
    let mut right_stream = right_stream.ok_or("platform probe accepted no uTP stream")?;
    let payload = (0..PROBE_PAYLOAD_BYTES)
        .map(|index| u8::try_from(index % 251).expect("probe byte is bounded"))
        .collect::<Vec<_>>();
    let expected_sha1 = hex(&Sha1::digest(&payload));
    let (_, (received_bytes, received_sha1)) = tokio::try_join!(
        async {
            left_stream.write_all(&payload).await?;
            left_stream.shutdown().await
        },
        async {
            let mut received = Vec::new();
            right_stream.read_to_end(&mut received).await?;
            let digest = hex(&Sha1::digest(&received));
            right_stream.shutdown().await?;
            Ok::<_, std::io::Error>((received.len(), digest))
        }
    )?;
    if received_bytes != payload.len() || received_sha1 != expected_sha1 {
        return Err("platform MTU probe payload verification failed".into());
    }
    drop(left_stream);
    drop(right_stream);

    let live_left_utp = left_utp.snapshot();
    let live_left_udp = left_udp.snapshot();
    if live_left_utp.path_mtu_profile.as_str() != "dynamic_ipv4"
        || live_left_utp
            .selected_mtu_max_bytes
            .is_none_or(|mtu| mtu < 1_010)
        || live_left_utp.mtu_probes_acknowledged_high_water == 0
        || live_left_udp.protected_sends_sent == 0
        || live_left_udp.protected_sends_sent != live_left_utp.mtu_probe_datagrams_sent
        || live_left_udp.fragmentation_restore_failures != 0
    {
        return Err(format!(
            "platform MTU probe did not confirm protected dynamic sends: \
             selected={:?} acknowledged={} protected={} restore_failures={}",
            live_left_utp.selected_mtu_max_bytes,
            live_left_utp.mtu_probes_acknowledged_high_water,
            live_left_udp.protected_sends_sent,
            live_left_udp.fragmentation_restore_failures,
        )
        .into());
    }

    let terminal_left_utp = left_utp.shutdown().await?;
    let terminal_right_utp = right_utp.shutdown().await?;
    drop(left_dht);
    drop(right_dht);
    let terminal_left_udp = left_udp.shutdown().await?;
    let terminal_right_udp = right_udp.shutdown().await?;
    validate_terminal(&terminal_left_utp, &terminal_left_udp)?;
    validate_terminal(&terminal_right_utp, &terminal_right_udp)?;

    write_json(json!({
        "event": "complete",
        "role": "platform-mtu-probe",
        "platform": env::consts::OS,
        "capability": {
            "initial": initial_capability,
            "replacement": replacement_capability,
            "generation_changed": replacement_generation != initial_generation,
            "endpoint_changed": replacement_endpoint != initial_endpoint,
        },
        "payload": {
            "bytes": received_bytes,
            "sha1": received_sha1,
        },
        "resources": {
            "live_udp": udp_json(live_left_udp),
            "live_utp": utp_json(live_left_utp),
            "terminal_udp": udp_json(terminal_left_udp),
            "terminal_utp": utp_json(terminal_left_utp),
            "terminal_peer_udp": udp_json(terminal_right_udp),
            "terminal_peer_utp": utp_json(terminal_right_utp),
        },
    }))?;
    Ok(())
}

fn diagnostic_upnp_error(error: UpnpError) -> Box<dyn Error> {
    format!("UPnP {:?}: {}", error.stage(), error.detail()).into()
}

async fn read_fixture(path: &Path) -> Result<(Metainfo, Vec<u8>), Box<dyn Error>> {
    let outer = tokio::fs::read(path).await?;
    let metainfo = Metainfo::from_bytes_with_limits(&outer, BEP9_METAINFO_LIMITS)?;
    let expected_pieces = metainfo.total_length.div_ceil(u64::from(PIECE_BYTES));
    if metainfo.total_length < PAYLOAD_BYTES
        || metainfo.total_length > MAX_INTEROP_PAYLOAD_BYTES
        || metainfo.piece_length != PIECE_BYTES
        || metainfo.mode != MetainfoMode::SingleFile
        || u64::try_from(metainfo.piece_count())? != expected_pieces
    {
        return Err(format!(
            "fixture must be one {PAYLOAD_BYTES}..={MAX_INTEROP_PAYLOAD_BYTES}-byte file with \
             {PIECE_BYTES}-byte pieces"
        )
        .into());
    }
    let raw_info = Metainfo::info_bytes_with_limits(&outer, BEP9_METAINFO_LIMITS)?.to_vec();
    Ok((metainfo, raw_info))
}

async fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await?;
    output.write_all(bytes).await?;
    output.flush().await?;
    Ok(())
}

async fn wait_for_stop(
    scope: SeedScope,
    incoming: &IncomingPeerHandle,
    peer_sink: &RecordingPeerSink,
    utp: &UtpService,
    udp: &SessionUdpService,
) -> Result<(), Box<dyn Error>> {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let input_thread = std::thread::spawn(move || {
        loop {
            let mut command = String::new();
            let result = std::io::stdin()
                .read_line(&mut command)
                .map(|read| (read, command));
            let terminal = match result.as_ref() {
                Ok((read, command)) => *read == 0 || command.trim() == "stop",
                Err(_) => true,
            };
            if sender.send(result).is_err() || terminal {
                break;
            }
        }
    });
    loop {
        let (read, command) = receiver.recv().await.ok_or("seed input thread stopped")??;
        match command.trim() {
            "stop" if read > 0 => {
                input_thread
                    .join()
                    .map_err(|_| "seed input thread panicked")?;
                return Ok(());
            }
            "snapshot"
                if matches!(
                    scope,
                    SeedScope::Impairment | SeedScope::ProductMtu | SeedScope::DiagnosticMtu
                ) =>
            {
                write_json(json!({
                    "event": "snapshot",
                    "role": scope.role(),
                    "peer_evidence": peer_evidence_json(&peer_sink.snapshot()),
                    "resources": {
                        "live_incoming": incoming_json(&incoming.snapshot()),
                        "live_udp": udp_json(udp.snapshot()),
                        "live_utp": utp_json(utp.snapshot()),
                    },
                }))?;
            }
            _ => {
                return Err("seed requires a final stop command after verified download".into());
            }
        }
    }
}

fn validate_seed_evidence(
    scope: SeedScope,
    payload_bytes: u64,
    incoming: &IncomingPeerServiceSnapshot,
    peers: &PeerEvidence,
) -> Result<(), Box<dyn Error>> {
    if incoming.payload_bytes_sent < payload_bytes {
        return Err(format!(
            "seed uploaded {} of {payload_bytes} required bytes",
            incoming.payload_bytes_sent
        )
        .into());
    }
    if peers.connection_high_water != 1 || peers.utp_high_water != 1 || peers.tcp_high_water != 0 {
        return Err(format!("unexpected peer transport evidence: {peers:?}").into());
    }
    let endpoint_is_eligible = |peer: &SocketAddr| match (scope, peer) {
        (
            SeedScope::Loopback
            | SeedScope::Impairment
            | SeedScope::ProductMtu
            | SeedScope::DiagnosticMtu,
            SocketAddr::V4(endpoint),
        ) => endpoint.ip().is_loopback(),
        (SeedScope::Wan, SocketAddr::V4(endpoint)) => eligible_public_ipv4(*endpoint.ip()),
        (_, SocketAddr::V6(_)) => false,
    };
    if peers.endpoints.len() != 1
        || peers
            .endpoints
            .iter()
            .any(|peer| !endpoint_is_eligible(peer))
    {
        return Err(format!("unexpected peer endpoints: {:?}", peers.endpoints).into());
    }
    Ok(())
}

fn validate_terminal(
    utp: &UtpServiceSnapshot,
    udp: &SessionUdpSnapshot,
) -> Result<(), Box<dyn Error>> {
    if utp.active_connections != 0 || utp.incoming_half_open != 0 || utp.worker_panics != 0 {
        return Err(format!("uTP terminal ownership is not clean: {utp:?}").into());
    }
    if udp.tasks != 0 || udp.queued != 0 || udp.utp_queued != 0 {
        return Err(format!("session UDP terminal ownership is not clean: {udp:?}").into());
    }
    Ok(())
}

fn write_json(value: Value) -> Result<(), Box<dyn Error>> {
    println!("{value}");
    std::io::stdout().flush()?;
    Ok(())
}

fn peer_evidence_json(evidence: &PeerEvidence) -> Value {
    json!({
        "connection_high_water": evidence.connection_high_water,
        "utp_high_water": evidence.utp_high_water,
        "tcp_high_water": evidence.tcp_high_water,
        "endpoints": evidence.endpoints.iter().map(ToString::to_string).collect::<Vec<_>>(),
    })
}

fn incoming_json(snapshot: &IncomingPeerServiceSnapshot) -> Value {
    let rejection_counts = snapshot
        .rejection_counts
        .iter()
        .map(|(reason, count)| (format!("{reason:?}"), *count))
        .collect::<std::collections::BTreeMap<_, _>>();
    json!({
        "registrations": snapshot.registrations,
        "pending": snapshot.pending,
        "pending_high_water": snapshot.pending_high_water,
        "established": snapshot.established,
        "established_high_water": snapshot.established_high_water,
        "connections": snapshot.peer_budget.total,
        "connection_high_water": snapshot.peer_budget.total_high_water,
        "reads": snapshot.reads,
        "read_bytes": snapshot.read_bytes,
        "read_high_water": snapshot.read_high_water,
        "read_bytes_high_water": snapshot.read_bytes_high_water,
        "queued_requests_high_water": snapshot.queued_requests_high_water,
        "queued_bytes_high_water": snapshot.queued_bytes_high_water,
        "writer_send_buffer_high_water": snapshot.writer_send_buffer_high_water,
        "upload_slots_high_water": snapshot.upload_slots_high_water,
        "payload_bytes_sent": snapshot.payload_bytes_sent,
        "rejection_counts": rejection_counts,
    })
}

fn udp_json(snapshot: SessionUdpSnapshot) -> Value {
    json!({
        "tasks": snapshot.tasks,
        "task_high_water": snapshot.task_high_water,
        "dht_queued": snapshot.queued,
        "dht_queue_high_water": snapshot.queue_high_water,
        "utp_queued": snapshot.utp_queued,
        "utp_queue_high_water": snapshot.utp_queue_high_water,
        "datagrams_received": snapshot.datagrams_received,
        "datagram_bytes_received": snapshot.datagram_bytes_received,
        "datagrams_dropped": snapshot.datagrams_dropped,
        "dht_datagrams_dropped": snapshot.dht_datagrams_dropped,
        "utp_datagrams_classified": snapshot.utp_datagrams_classified,
        "utp_datagram_bytes_classified": snapshot.utp_datagram_bytes_classified,
        "utp_datagrams_dropped": snapshot.utp_datagrams_dropped,
        "egress_waiters": snapshot.egress_waiters,
        "egress_waiter_high_water": snapshot.egress_waiter_high_water,
        "retired_egress_rejections": snapshot.retired_egress_rejections,
        "protected_sends_attempted": snapshot.protected_sends_attempted,
        "protected_sends_sent": snapshot.protected_sends_sent,
        "protected_sends_would_block": snapshot.protected_sends_would_block,
        "protected_sends_message_too_large": snapshot.protected_sends_message_too_large,
        "protected_sends_failed": snapshot.protected_sends_failed,
        "fragmentation_restore_failures": snapshot.fragmentation_restore_failures,
        "fragmentation_repairs_requested": snapshot.fragmentation_repairs_requested,
        "fragmentation_repairs_succeeded": snapshot.fragmentation_repairs_succeeded,
        "fragmentation_repairs_failed": snapshot.fragmentation_repairs_failed,
        "maximum_datagram_bytes_sent": snapshot.maximum_datagram_bytes_sent,
        "ipv4_fragmentation_protection": format!("{:?}", snapshot.ipv4_fragmentation_protection),
    })
}

fn utp_terminal_json(failure: &rstorrent_engine::UtpTerminalEvidence) -> Value {
    json!({
            "kind": failure.kind.as_str(),
            "detail": failure.detail,
            "new_data_datagrams_sent": failure.new_data_datagrams_sent,
            "retransmission_data_datagrams_sent": failure.retransmission_data_datagrams_sent,
            "data_datagrams_received": failure.data_datagrams_received,
            "sent_sequence_cycles": failure.sent_sequence_cycles,
            "received_sequence_cycles": failure.received_sequence_cycles,
            "last_data_sequence_sent": failure.last_data_sequence_sent,
            "last_retransmission_sequence_sent": failure.last_retransmission_sequence_sent,
            "last_data_sequence_received": failure.last_data_sequence_received,
            "loss_signals_received": failure.loss_signals_received,
            "duplicate_acknowledgements": failure.duplicate_acknowledgements,
            "stale_acknowledgements": failure.stale_acknowledgements,
            "future_acknowledgements": failure.future_acknowledgements,
            "ambiguous_acknowledgements": failure.ambiguous_acknowledgements,
            "duplicate_data_datagrams": failure.duplicate_data_datagrams,
            "too_far_ahead_data_datagrams": failure.too_far_ahead_data_datagrams,
            "ambiguous_data_datagrams": failure.ambiguous_data_datagrams,
            "fin_datagrams_received": failure.fin_datagrams_received,
            "reset_datagrams_received": failure.reset_datagrams_received,
            "outstanding_packets": failure.outstanding_packets,
            "outstanding_bytes": failure.outstanding_bytes,
            "in_flight_packets": failure.in_flight_packets,
            "in_flight_bytes": failure.in_flight_bytes,
            "pending_retransmissions": failure.pending_retransmissions,
            "congestion_window_bytes": failure.congestion_window_bytes,
            "remote_window_bytes": failure.remote_window_bytes,
            "smoothed_rtt_micros": failure.smoothed_rtt_micros,
            "effective_rto_micros": failure.effective_rto_micros,
            "consecutive_timeouts": failure.consecutive_timeouts,
            "loss_reductions": failure.loss_reductions,
            "timeout_collapses": failure.timeout_collapses,
    })
}

fn utp_json(snapshot: UtpServiceSnapshot) -> Value {
    let first_terminal = snapshot.first_terminal.as_ref().map(utp_terminal_json);
    let last_failure = snapshot.last_failure.as_ref().map(utp_terminal_json);
    json!({
        "path_mtu_profile": snapshot.path_mtu_profile.as_str(),
        "active_connections": snapshot.active_connections,
        "connections_started": snapshot.connections_started,
        "connection_high_water": snapshot.connection_high_water,
        "incoming_half_open": snapshot.incoming_half_open,
        "incoming_half_open_high_water": snapshot.incoming_half_open_high_water,
        "incoming_stream_queue_high_water": snapshot.incoming_stream_queue_high_water,
        "connection_datagram_queue_high_water": snapshot.connection_datagram_queue_high_water,
        "malformed_datagrams": snapshot.malformed_datagrams,
        "unknown_connection_datagrams": snapshot.unknown_connection_datagrams,
        "stale_generation_datagrams": snapshot.stale_generation_datagrams,
        "connection_datagrams_dropped": snapshot.connection_datagrams_dropped,
        "datagrams_sent": snapshot.datagrams_sent,
        "datagram_bytes_sent": snapshot.datagram_bytes_sent,
        "data_datagrams_sent": snapshot.data_datagrams_sent,
        "state_datagrams_sent": snapshot.state_datagrams_sent,
        "retransmission_datagrams_sent": snapshot.retransmission_datagrams_sent,
        "retransmission_bytes_sent": snapshot.retransmission_bytes_sent,
        "retransmission_queue_high_water": snapshot.retransmission_queue_high_water,
        "in_flight_packet_high_water": snapshot.in_flight_packet_high_water,
        "in_flight_byte_high_water": snapshot.in_flight_byte_high_water,
        "congestion_control_acknowledgements_high_water": snapshot.congestion_control_acknowledgements_high_water,
        "congestion_control_acknowledged_bytes_high_water": snapshot.congestion_control_acknowledged_bytes_high_water,
        "congestion_limited_acknowledgements_high_water": snapshot.congestion_limited_acknowledgements_high_water,
        "sender_underfilled_acknowledgements_high_water": snapshot.sender_underfilled_acknowledgements_high_water,
        "remote_window_limited_acknowledgements_high_water": snapshot.remote_window_limited_acknowledgements_high_water,
        "window_growth_acknowledgements_high_water": snapshot.window_growth_acknowledgements_high_water,
        "slow_start_active_observed": snapshot.slow_start_active_observed,
        "slow_start_threshold_byte_high_water": snapshot.slow_start_threshold_byte_high_water,
        "slow_start_acknowledgements_high_water": snapshot.slow_start_acknowledgements_high_water,
        "slow_start_exits_high_water": snapshot.slow_start_exits_high_water,
        "loss_reduction_high_water": snapshot.loss_reduction_high_water,
        "timeout_collapse_high_water": snapshot.timeout_collapse_high_water,
        "delivered_byte_high_water": snapshot.delivered_byte_high_water,
        "receive_reorder_packet_high_water": snapshot.receive_reorder_packet_high_water,
        "receive_buffered_byte_high_water": snapshot.receive_buffered_byte_high_water,
        "receive_window_drop_high_water": snapshot.receive_window_drop_high_water,
        "unsent_byte_high_water": snapshot.unsent_byte_high_water,
        "sent_byte_high_water": snapshot.sent_byte_high_water,
        "application_coalesce_byte_high_water": snapshot.application_coalesce_byte_high_water,
        "smoothed_rtt_min_micros": snapshot.smoothed_rtt_min_micros,
        "smoothed_rtt_max_micros": snapshot.smoothed_rtt_max_micros,
        "effective_rto_min_micros": snapshot.effective_rto_min_micros,
        "effective_rto_max_micros": snapshot.effective_rto_max_micros,
        "base_delay_min_micros": snapshot.base_delay_min_micros,
        "base_delay_max_micros": snapshot.base_delay_max_micros,
        "queue_delay_min_micros": snapshot.queue_delay_min_micros,
        "queue_delay_max_micros": snapshot.queue_delay_max_micros,
        "congestion_window_min_bytes": snapshot.congestion_window_min_bytes,
        "congestion_window_max_bytes": snapshot.congestion_window_max_bytes,
        "advertised_receive_window_min_bytes": snapshot.advertised_receive_window_min_bytes,
        "advertised_receive_window_max_bytes": snapshot.advertised_receive_window_max_bytes,
        "selected_mtu_min_bytes": snapshot.selected_mtu_min_bytes,
        "selected_mtu_max_bytes": snapshot.selected_mtu_max_bytes,
        "mtu_candidate_min_bytes": snapshot.mtu_candidate_min_bytes,
        "mtu_candidate_max_bytes": snapshot.mtu_candidate_max_bytes,
        "mtu_probes_started_high_water": snapshot.mtu_probes_started_high_water,
        "mtu_probes_acknowledged_high_water": snapshot.mtu_probes_acknowledged_high_water,
        "mtu_probes_failed_high_water": snapshot.mtu_probes_failed_high_water,
        "mtu_revalidations_started_high_water": snapshot.mtu_revalidations_started_high_water,
        "mtu_revalidations_acknowledged_high_water": snapshot.mtu_revalidations_acknowledged_high_water,
        "mtu_revalidations_failed_high_water": snapshot.mtu_revalidations_failed_high_water,
        "mtu_downward_recoveries_high_water": snapshot.mtu_downward_recoveries_high_water,
        "mtu_probe_datagrams_sent": snapshot.mtu_probe_datagrams_sent,
        "mtu_fragmentable_retry_datagrams_sent": snapshot.mtu_fragmentable_retry_datagrams_sent,
        "retry_exhausted_connections": snapshot.retry_exhausted_connections,
        "graceful_connections": snapshot.graceful_connections,
        "reset_connections": snapshot.reset_connections,
        "consumer_dropped_connections": snapshot.consumer_dropped_connections,
        "generation_changed_connections": snapshot.generation_changed_connections,
        "service_cancelled_connections": snapshot.service_cancelled_connections,
        "protocol_error_connections": snapshot.protocol_error_connections,
        "io_error_connections": snapshot.io_error_connections,
        "worker_panics": snapshot.worker_panics,
        "first_terminal": first_terminal,
        "last_failure": last_failure,
    })
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize] as char);
        result.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> impl Iterator<Item = OsString> {
        values
            .iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn arguments_are_role_specific_and_network_scoped() {
        assert!(matches!(
            Arguments::parse(strings(&[
                "leecher",
                "--metainfo",
                "fixture.torrent",
                "--peer",
                "127.0.0.1:1",
                "--output",
                "payload.bin",
            ])),
            Ok(Arguments::Leecher { .. })
        ));
        assert!(matches!(
            Arguments::parse(strings(&[
                "seed",
                "--metainfo",
                "fixture.torrent",
                "--storage-root",
                "seed",
            ])),
            Ok(Arguments::Seed { .. })
        ));
        let impairment_seed = Arguments::parse(strings(&[
            "impairment-seed",
            "--metainfo",
            "fixture.torrent",
            "--storage-root",
            "seed",
        ]))
        .unwrap();
        assert_eq!(impairment_seed.timeout(), WAN_ROLE_TIMEOUT);
        assert!(matches!(
            impairment_seed,
            Arguments::Seed {
                scope: SeedScope::Impairment,
                ..
            }
        ));
        let product_mtu_seed = Arguments::parse(strings(&[
            "product-mtu-seed",
            "--metainfo",
            "fixture.torrent",
            "--storage-root",
            "seed",
        ]))
        .unwrap();
        assert_eq!(product_mtu_seed.timeout(), WAN_ROLE_TIMEOUT);
        assert!(matches!(
            product_mtu_seed,
            Arguments::Seed {
                scope: SeedScope::ProductMtu,
                ..
            }
        ));
        let platform_mtu_probe = Arguments::parse(strings(&["platform-mtu-probe"])).unwrap();
        assert_eq!(platform_mtu_probe.timeout(), PLATFORM_ROLE_TIMEOUT);
        assert!(matches!(platform_mtu_probe, Arguments::PlatformMtuProbe));
        assert!(Arguments::parse(strings(&["platform-mtu-probe", "--output", "x"])).is_err());
        let diagnostic_mtu_seed = Arguments::parse(strings(&[
            "diagnostic-mtu-seed",
            "--metainfo",
            "fixture.torrent",
            "--storage-root",
            "seed",
        ]))
        .unwrap();
        assert_eq!(diagnostic_mtu_seed.timeout(), WAN_ROLE_TIMEOUT);
        assert!(matches!(
            diagnostic_mtu_seed,
            Arguments::Seed {
                scope: SeedScope::DiagnosticMtu,
                ..
            }
        ));
        let wan_seed = Arguments::parse(strings(&[
            "wan-seed",
            "--metainfo",
            "fixture.torrent",
            "--storage-root",
            "seed",
        ]))
        .unwrap();
        assert_eq!(wan_seed.timeout(), WAN_ROLE_TIMEOUT);
        assert!(matches!(
            &wan_seed,
            Arguments::Seed {
                scope: SeedScope::Wan,
                ..
            }
        ));
        assert!(matches!(
            Arguments::parse(strings(&[
                "wan-mapping-audit",
                "--local-port",
                "42000",
                "--external-port",
                "42000",
            ])),
            Ok(Arguments::MappingAudit {
                local_port: 42_000,
                external_port: 42_000,
            })
        ));
        assert!(
            Arguments::parse(strings(&[
                "wan-mapping-audit",
                "--local-port",
                "0",
                "--external-port",
                "42000",
            ]))
            .is_err()
        );
        assert!(
            Arguments::parse(strings(&[
                "leecher",
                "--metainfo",
                "fixture.torrent",
                "--peer",
                "192.0.2.1:1",
                "--output",
                "payload.bin",
            ]))
            .is_err()
        );
        assert!(matches!(
            Arguments::parse(strings(&[
                "wan-leecher",
                "--metainfo",
                "fixture.torrent",
                "--peer",
                "8.8.8.8:1",
                "--output",
                "payload.bin",
            ])),
            Ok(Arguments::Leecher {
                scope: LeecherScope::Wan,
                ..
            })
        ));
        let wan = Arguments::parse(strings(&[
            "wan-leecher",
            "--metainfo",
            "fixture.torrent",
            "--peer",
            "8.8.8.8:1",
            "--output",
            "payload.bin",
        ]))
        .unwrap();
        assert_eq!(wan.timeout(), WAN_ROLE_TIMEOUT);
        let loopback = Arguments::parse(strings(&[
            "leecher",
            "--metainfo",
            "fixture.torrent",
            "--peer",
            "127.0.0.1:1",
            "--output",
            "payload.bin",
        ]))
        .unwrap();
        assert_eq!(loopback.timeout(), LOOPBACK_ROLE_TIMEOUT);
        for peer in [
            "0.0.0.0:1",
            "10.0.0.1:1",
            "100.64.0.1:1",
            "127.0.0.1:1",
            "169.254.1.1:1",
            "172.16.0.1:1",
            "192.0.2.1:1",
            "192.168.1.1:1",
            "198.18.0.1:1",
            "198.51.100.1:1",
            "203.0.113.1:1",
            "224.0.0.1:1",
        ] {
            assert!(
                Arguments::parse(strings(&[
                    "wan-leecher",
                    "--metainfo",
                    "fixture.torrent",
                    "--peer",
                    peer,
                    "--output",
                    "payload.bin",
                ]))
                .is_err(),
                "accepted {peer}"
            );
        }
    }
}
