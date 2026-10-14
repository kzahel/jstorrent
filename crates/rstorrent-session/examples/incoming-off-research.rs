//! Bounded application-service research on owned local fixtures, not product policy.
use std::error::Error;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rstorrent_engine::{
    AddressFamilyPolicy, PeerEncryptionPolicy, SessionUdpService, UtpService,
    download_controlled_utp,
};
use rstorrent_protocol::content::TorrentContentProjection;
use rstorrent_protocol::metainfo::BEP9_METAINFO_LIMITS;
use rstorrent_session::{
    AddTorrentBytesRequest, ApplicationConfig, ApplicationService, CONTROL_VERSION, ClientSettings,
    Command, CommandResult, ConfiguredStorageRoot, DeliveryPolicy, EncryptionPolicy,
    FileSelectionIntent, ListenerPolicy, NetworkConfig, NetworkPolicy, PeerTransportPolicy,
    RequestEnvelope, ResponseOutcome, SeedAdmissionView, SessionStore, SessionUdpStatus,
    SubscriptionSpec, ViewProjection, ViewSelector, ViewSnapshot, ViewUpdatePayload,
};
use serde_json::json;
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("server") if args.len() == 5 => {
            server(Path::new(&args[1]), Path::new(&args[2]), &args[3], &args[4]).await
        }
        Some("client" | "handshake" | "wire-utp" | "wire-tcp" | "wire-fast" | "wire-fast-missing") if args.len() == 5 || args.len() == 6 => {
            if args[0].starts_with("wire-") {
                let peer_ip = args.get(5).map(|s| s.parse()).transpose()?.unwrap_or(Ipv4Addr::LOCALHOST);
                return wire_client(Path::new(&args[1]), args[2].parse()?, args[3].parse()?, Path::new(&args[4]), &args[0], peer_ip).await;
            }
            client(Path::new(&args[1]), args[2].parse()?, args[3].parse()?, Path::new(&args[4]), args[0] == "handshake").await
        }
        _ => Err("server CASE_ROOT FIXTURE_ROOT off|on|tcp EXCLUDED_PORTS; client FIXTURE_ROOT SERVER_PORT CLIENT_PORT OUTPUT".into()),
    }
}

// Independent wire framing separates a diagnostic helper failure from transport
// and admission. This bounded research path is deliberately outside PeerIo.
async fn wire_client(
    fixture: &Path,
    server_port: u16,
    client_port: u16,
    output: &Path,
    mode: &str,
    peer_ip: Ipv4Addr,
) -> Result<()> {
    let tcp = mode == "wire-tcp";
    let fast = mode.starts_with("wire-fast");
    let source = read_bounded(&fixture.join("fixture.torrent"), 65_536)?;
    let projection =
        TorrentContentProjection::from_bytes_with_limits(&source, BEP9_METAINFO_LIMITS)?;
    let metainfo = &projection
        .content
        .v1()
        .ok_or("v1 fixture required")?
        .metainfo;
    if metainfo.total_length > 1_048_576
        || server_port < 1024
        || client_port < 1024
        || server_port == client_port
        || (!peer_ip.is_loopback() && !peer_ip.is_private())
    {
        return Err("bounded fixture and distinct unprivileged ports required".into());
    }
    let peer = SocketAddr::from((peer_ip, server_port));
    let bind_ip = if peer_ip.is_loopback() {
        Ipv4Addr::LOCALHOST
    } else {
        Ipv4Addr::UNSPECIFIED
    };
    let payload = if tcp {
        let socket = tokio::net::TcpSocket::new_v4()?;
        socket.bind(SocketAddr::from((bind_ip, client_port)))?;
        let mut stream =
            tokio::time::timeout(Duration::from_secs(5), socket.connect(peer)).await??;
        tokio::time::timeout(
            Duration::from_secs(30),
            wire_transfer(&mut stream, metainfo, true, false, false),
        )
        .await??
    } else {
        let socket = UdpSocket::bind((bind_ip, client_port)).await?;
        let (mut udp, dht) = SessionUdpService::start(socket)?;
        let utp = UtpService::start(&mut udp)?;
        let transfer = tokio::time::timeout(Duration::from_secs(30), async {
            let mut stream = utp.handle().connect(peer).await?;
            wire_transfer(&mut stream, metainfo, false, fast, mode == "wire-fast").await
        })
        .await;
        let terminal = utp.shutdown().await?;
        drop(dht);
        let udp_terminal = udp.shutdown().await?;
        emit(
            json!({"event":"wire_terminal","connections":terminal.active_connections,"udp_tasks":udp_terminal.tasks}),
        )?;
        transfer??
    };
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    file.write_all(&payload)?;
    emit(json!({"event":"wire_complete","tcp":tcp,"bytes":payload.len()}))
}

async fn wire_transfer<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    stream: &mut S,
    metainfo: &rstorrent_protocol::metainfo::Metainfo,
    tcp: bool,
    fast: bool,
    initial_availability: bool,
) -> Result<Vec<u8>> {
    let mut handshake = [0_u8; 68];
    handshake[0] = 19;
    handshake[1..20].copy_from_slice(b"BitTorrent protocol");
    handshake[28..48].copy_from_slice(&metainfo.info_hash);
    if fast {
        handshake[27] = 4;
    }
    handshake[48..68].copy_from_slice(if tcp {
        b"-RSREWT-000000000001"
    } else {
        b"-RSREWI-000000000001"
    });
    stream.write_all(&handshake).await?;
    stream.flush().await?;
    let mut reply = [0_u8; 68];
    stream.read_exact(&mut reply).await?;
    if reply[0..20] != handshake[0..20]
        || reply[28..48] != metainfo.info_hash
        || &reply[48..68] != b"-RSRESV-000000000001"
    {
        return Err("wire handshake mismatch".into());
    }
    emit(json!({"event":"wire_handshake"}))?;
    if initial_availability {
        stream.write_all(&[0, 0, 0, 1, 15]).await?;
    }
    stream.write_all(&[0, 0, 0, 1, 2]).await?;
    stream.flush().await?;
    let mut messages = 0;
    loop {
        let frame = wire_frame(stream, &mut messages).await?;
        if frame.first() == Some(&1) {
            break;
        }
    }
    let mut payload = Vec::with_capacity(metainfo.total_length as usize);
    for (index, expected) in metainfo.piece_hashes.iter().enumerate() {
        let length = metainfo
            .piece_length_at(index as u32)
            .ok_or("piece geometry")?;
        let mut piece = Vec::with_capacity(length as usize);
        while piece.len() < length as usize {
            let begin = piece.len() as u32;
            let block_length = (length - begin).min(16_384);
            let mut request = vec![0, 0, 0, 13, 6];
            request.extend_from_slice(&(index as u32).to_be_bytes());
            request.extend_from_slice(&begin.to_be_bytes());
            request.extend_from_slice(&block_length.to_be_bytes());
            stream.write_all(&request).await?;
            stream.flush().await?;
            loop {
                let frame = wire_frame(stream, &mut messages).await?;
                if frame.first() == Some(&7) {
                    if frame.len() != 9 + block_length as usize
                        || frame[1..5] != (index as u32).to_be_bytes()
                        || frame[5..9] != begin.to_be_bytes()
                    {
                        return Err("unexpected wire block".into());
                    }
                    piece.extend_from_slice(&frame[9..]);
                    break;
                }
                if frame.first() == Some(&0) {
                    return Err("wire peer choked".into());
                }
            }
        }
        if Sha1::digest(&piece).as_slice() != expected {
            return Err("wire piece hash mismatch".into());
        }
        payload.extend(piece);
    }
    Ok(payload)
}

async fn wire_frame<S: tokio::io::AsyncRead + Unpin>(
    stream: &mut S,
    messages: &mut usize,
) -> Result<Vec<u8>> {
    *messages += 1;
    if *messages > 128 {
        return Err("wire message count bound".into());
    }
    let length = stream.read_u32().await? as usize;
    if length > 16_393 {
        return Err("wire frame length bound".into());
    }
    let mut frame = vec![0; length];
    stream.read_exact(&mut frame).await?;
    emit(json!({"event":"wire_frame","length":length,"id":frame.first()}))?;
    Ok(frame)
}

fn emit(value: serde_json::Value) -> Result<()> {
    println!("{value}");
    std::io::stdout().flush()?;
    Ok(())
}

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(maximum + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > maximum {
        return Err("fixture size bound".into());
    }
    Ok(bytes)
}

async fn server(root: &Path, fixture: &Path, mode: &str, excluded: &str) -> Result<()> {
    if !matches!(mode, "off" | "on" | "tcp" | "interactive") || root.exists() {
        return Err("require valid mode and a fresh case directory".into());
    }
    let mut guards = Vec::new();
    for value in excluded.split(',').filter(|value| !value.is_empty()) {
        if guards.len() == 64 {
            return Err("at most 64 excluded ports".into());
        }
        let port: u16 = value.parse()?;
        if port < 1024 {
            return Err("excluded port must be at least 1024".into());
        }
        guards.push(UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).await?);
    }
    let source = read_bounded(&fixture.join("fixture.torrent"), 65_536)?;
    let payload = read_bounded(&fixture.join("fixture.bin"), 1_048_576)?;
    let projection =
        TorrentContentProjection::from_bytes_with_limits(&source, BEP9_METAINFO_LIMITS)?;
    let metainfo = &projection
        .content
        .v1()
        .ok_or("require v1 fixture")?
        .metainfo;
    if metainfo.name != "fixture.bin"
        || metainfo.files.len() != 1
        || !metainfo.private
        || payload.len() as u64 != metainfo.total_length
    {
        return Err("require one private fixture.bin of the correct size".into());
    }
    for (bytes, expected) in payload
        .chunks(metainfo.piece_length as usize)
        .zip(&metainfo.piece_hashes)
    {
        if Sha1::digest(bytes).as_slice() != expected {
            return Err("fixture piece hash mismatch".into());
        }
    }
    let storage = root.join("downloads");
    std::fs::create_dir_all(&storage)?;
    std::fs::copy(fixture.join("fixture.bin"), storage.join("fixture.bin"))?;
    let roots = vec![ConfiguredStorageRoot::path("downloads", storage)];
    let candidate = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let preferred_listen_port = candidate.local_addr()?.port();
    drop(candidate);
    let settings = ClientSettings {
        listener: if mode == "off" || mode == "interactive" {
            ListenerPolicy::Disabled
        } else {
            ListenerPolicy::AutomaticLoopback
        },
        port_mapping: rstorrent_session::PortMappingPolicy::Disabled,
        preferred_listen_port,
        ipv6_enabled: false,
        dht_enabled: false,
        peer_exchange_enabled: false,
        encryption: EncryptionPolicy::Disabled,
        ..ClientSettings::default()
    };
    {
        let mut store = SessionStore::open(&root.join("profile"), "default", &roots)?;
        let response = store.handle_durable(&RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "research-settings".into(),
            expected_revision: None,
            command: Command::UpdateClientSettings {
                patch: settings.clone().into(),
            },
        })?;
        if !matches!(response.outcome, ResponseOutcome::Success { .. }) {
            return Err("settings rejected".into());
        }
        let response = store.handle_torrent_bytes(
            &AddTorrentBytesRequest {
                version: CONTROL_VERSION,
                request_id: "research-add".into(),
                expected_revision: None,
                storage_root: "downloads".into(),
                start_content: true,
                await_file_selection: false,
                selection: FileSelectionIntent::All,
                source_length: source.len() as u32,
            },
            source.clone(),
        )?;
        let Some(CommandResult::AddTorrent { result }) = response.result else {
            return Err("add rejected".into());
        };
        store.record_pieces(
            &result.torrent_id,
            &(0..metainfo.piece_count()).collect::<Vec<_>>(),
        )?;
        store.mark_complete(&result.torrent_id)?;
    }
    let mut config = ApplicationConfig::new(
        root.join("profile"),
        "default".into(),
        roots,
        NetworkConfig::new(
            if mode == "interactive" {
                NetworkPolicy::Online
            } else {
                NetworkPolicy::LoopbackOnly
            },
            Duration::from_secs(3),
            Duration::from_secs(3),
        )
        .with_peer_id(*b"-RSRESV-000000000001"),
    );
    config.dht.bootstrap_nodes.clear();
    config.peer_transport_policy = if mode == "tcp" {
        PeerTransportPolicy::TcpOnly
    } else {
        PeerTransportPolicy::PreferUtp
    };
    let service = Arc::new(tokio::sync::Mutex::new(
        ApplicationService::open(config).await?,
    ));
    ApplicationService::ensure_maintenance_owner(&service).await;
    let ready = async {
        let client_settings = tokio::time::timeout(Duration::from_secs(10), async {
            let mut index = 0;
            loop {
                service
                    .lock()
                    .await
                    .dispatch(RequestEnvelope {
                        version: CONTROL_VERSION,
                        request_id: format!("research-snapshot-{index}"),
                        expected_revision: None,
                        command: Command::Snapshot,
                    })
                    .await?;
                let subscription = service.lock().await.subscribe(SubscriptionSpec {
                    selector: ViewSelector::TorrentList,
                    projection: ViewProjection::Summary,
                    delivery: DeliveryPolicy {
                        min_interval_millis: 0,
                        max_queue_bytes: 256 * 1024,
                    },
                    diagnostics: None,
                    catalog_page: None,
                })?;
                let update = subscription.next_update().await.ok_or("no view")?;
                let ViewUpdatePayload::Snapshot {
                    snapshot:
                        ViewSnapshot::TorrentList {
                            torrents,
                            client_settings,
                            ..
                        },
                } = update.payload
                else {
                    return Err("wrong view".into());
                };
                if torrents.len() == 1
                    && matches!(
                        torrents[0].seeding.admission,
                        SeedAdmissionView::Active | SeedAdmissionView::InactiveExempt
                    )
                {
                    return Ok::<_, Box<dyn Error>>(client_settings);
                }
                index += 1;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await??;
        let SessionUdpStatus::Bound { address, port, .. } = client_settings.session_udp_status
        else {
            return Err("UDP not bound".into());
        };
        let utp_snapshot = service.lock().await.utp_snapshot();
        let ready = json!({"event":"ready", "pid":std::process::id(), "mode":mode, "udp_address":address,
            "udp_port":port, "listener_status":client_settings.listener_status,
            "utp_enabled":utp_snapshot.is_some(), "excluded_ports":excluded,
            "connections_before_probe":utp_snapshot.map(|s|s.connections_started)});
        std::fs::write(root.join("ready.json"), serde_json::to_vec(&ready)?)?;
        emit(ready)
    }
    .await;
    if let Err(error) = ready {
        service.lock().await.shutdown().await?;
        return Err(error);
    }
    let deadline =
        Instant::now() + Duration::from_secs(if mode == "interactive" { 240 } else { 90 });
    let mut incoming_enabled = false;
    let mut upnp_enabled = false;
    loop {
        if root.join("stop").exists() || Instant::now() >= deadline {
            break;
        }
        if mode == "interactive" {
            for (trigger, applied) in [
                ("enable-incoming", &mut incoming_enabled),
                ("enable-upnp", &mut upnp_enabled),
            ] {
                if !*applied && root.join(trigger).exists() {
                    let mut selected = settings.clone();
                    selected.listener = ListenerPolicy::AutomaticLocalNetwork;
                    if trigger == "enable-upnp" {
                        selected.port_mapping = rstorrent_session::PortMappingPolicy::Upnp;
                    }
                    let response = service
                        .lock()
                        .await
                        .dispatch(RequestEnvelope {
                            version: CONTROL_VERSION,
                            request_id: trigger.into(),
                            expected_revision: None,
                            command: Command::UpdateClientSettings {
                                patch: selected.into(),
                            },
                        })
                        .await;
                    let evidence = match response {
                        Ok(response) => {
                            json!({"event":trigger,"success":matches!(response.outcome, ResponseOutcome::Success { .. })})
                        }
                        Err(error) => {
                            json!({"event":trigger,"success":false,"error":error.to_string()})
                        }
                    };
                    std::fs::write(
                        root.join(format!("{trigger}.json")),
                        serde_json::to_vec(&evidence)?,
                    )?;
                    emit(evidence)?;
                    *applied = true;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let before = service.lock().await.utp_snapshot();
    let before_udp = service.lock().await.session_udp_snapshot();
    service.lock().await.shutdown().await?;
    let service = service.lock().await;
    let stopped = json!({"event":"stopped", "utp_started":before.as_ref().map(|s|s.connections_started),
        "udp_datagrams_received":before_udp.map(|s|s.datagrams_received),
        "utp_datagrams_classified":before_udp.map(|s|s.utp_datagrams_classified),
        "utp_owner_after_shutdown":service.utp_snapshot().is_some(),
        "udp_owner_after_shutdown":service.session_udp_snapshot().is_some()});
    std::fs::write(root.join("stopped.json"), serde_json::to_vec(&stopped)?)?;
    emit(stopped)?;
    drop(guards);
    Ok(())
}

async fn client(
    fixture: &Path,
    server_port: u16,
    client_port: u16,
    output: &Path,
    handshake_only: bool,
) -> Result<()> {
    if server_port < 1024 || client_port < 1024 || server_port == client_port {
        return Err("distinct unprivileged ports required".into());
    }
    let source = read_bounded(&fixture.join("fixture.torrent"), 65_536)?;
    let projection =
        TorrentContentProjection::from_bytes_with_limits(&source, BEP9_METAINFO_LIMITS)?;
    let metainfo = &projection
        .content
        .v1()
        .ok_or("v1 fixture required")?
        .metainfo;
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, client_port)).await?;
    let (mut udp, dht) = SessionUdpService::start(socket)?;
    let utp = UtpService::start(&mut udp)?;
    let peer = SocketAddr::from((Ipv4Addr::LOCALHOST, server_port));
    emit(json!({"event":"client_ready","client_port":client_port,"server_port":server_port}))?;
    if handshake_only {
        let result = tokio::time::timeout(Duration::from_secs(5), async {
            let mut stream = utp.handle().connect(peer).await?;
            emit(json!({"event":"transport_connected"}))?;
            let mut request = [0_u8; 68];
            request[0] = 19;
            request[1..20].copy_from_slice(b"BitTorrent protocol");
            request[28..48].copy_from_slice(&metainfo.info_hash);
            request[48..68].copy_from_slice(b"-RSREHS-000000000001");
            stream.write_all(&request).await?;
            stream.flush().await?;
            let mut reply = [0_u8; 68];
            stream.read_exact(&mut reply).await?;
            if reply[0] != 19
                || &reply[1..20] != b"BitTorrent protocol"
                || reply[28..48] != metainfo.info_hash
                || &reply[48..68] != b"-RSRESV-000000000001"
            {
                return Err("BitTorrent handshake identity mismatch".into());
            }
            // The handshake is the evidence boundary. Explicit service shutdown
            // below joins the transport; FIN drain is not part of this check.
            Ok::<_, Box<dyn Error>>(())
        })
        .await;
        let terminal_utp = utp.shutdown().await?;
        drop(dht);
        let terminal_udp = udp.shutdown().await?;
        result??;
        return emit(
            json!({"event":"handshake", "protocol_checked":true,"info_hash_checked":true,
            "peer_id_checked":true,"terminal_connections":terminal_utp.active_connections,
            "terminal_udp_tasks":terminal_udp.tasks}),
        );
    }
    let transfer = tokio::time::timeout(Duration::from_secs(35), async {
        let stream = utp.handle().connect(peer).await?;
        let network = NetworkConfig::new(
            NetworkPolicy::LoopbackOnly,
            Duration::from_secs(3),
            Duration::from_secs(20),
        )
        .with_address_families(AddressFamilyPolicy::ipv4_only())
        .with_encryption(PeerEncryptionPolicy::Disabled)
        .with_peer_id(*b"-RSRECL-000000000001");
        download_controlled_utp(stream, metainfo, network)
            .await
            .map_err(Box::<dyn Error>::from)
    })
    .await;
    let terminal_utp = utp.shutdown().await?;
    drop(dht);
    let terminal_udp = udp.shutdown().await?;
    let (payload, report) = transfer??;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    file.write_all(&payload)?;
    emit(
        json!({"event":"complete", "bytes":report.bytes,"pieces":report.pieces,
        "remote_peer_id":report.peer_id, "terminal_connections":terminal_utp.active_connections,
        "terminal_udp_tasks":terminal_udp.tasks}),
    )
}
