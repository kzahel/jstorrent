use std::io::Write as _;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rstorrent_direct_file::{
    DirectFileEndpoint, DirectFileEndpointFactory, DirectFileEndpointSnapshot, ExperimentSource,
    OfferAnswer,
};
use rstorrent_session::{
    ApplicationConfig, ApplicationService, CONTROL_VERSION, Command, CommandResult,
    ConfiguredStorageRoot, MediaUrlOutcome, NetworkConfig, NetworkPolicy, RequestEnvelope,
    SessionStore,
};
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::transport::RTCIceCandidateInit;
use serde::Serialize;
use sha1::{Digest as _, Sha1};
use sha2::Sha256;
use tempfile::TempDir;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const MAX_FIXTURE_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_FIXTURE_MIB: usize = 8;
const PIECE_LENGTH: usize = 256 * 1024;
const HTML: &str = include_str!("experiment.html");
const JAVASCRIPT: &str = include_str!("experiment.js");

#[derive(Clone)]
struct ExperimentState {
    expected_host: Arc<str>,
    udp_ip: IpAddr,
    capability: Arc<str>,
    factory: DirectFileEndpointFactory,
    endpoint: Arc<Mutex<Option<DirectFileEndpoint>>>,
    last_snapshot: Arc<Mutex<Option<DirectFileEndpointSnapshot>>>,
    fixture: FixtureView,
}

#[derive(Clone, Serialize)]
struct FixtureView {
    file_name: String,
    length: usize,
    sha256: String,
    head_sha256: String,
    tail_sha256: String,
    seek_sha256: String,
    overlap_sha256: String,
    head_offset: usize,
    head_length: usize,
    tail_offset: usize,
    tail_length: usize,
    seek_offset: usize,
    seek_length: usize,
    overlap_offset: usize,
    overlap_length: usize,
}

#[derive(Serialize)]
struct ReadyView {
    url: String,
    pid: u32,
    udp_ip: IpAddr,
    fixture: FixtureView,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (mode, send_window_bytes, source_name, raw_buffer_bytes) = parse_mode()?;
    let fixture_mib = match &mode {
        ExperimentMode::Serve { fixture_mib }
        | ExperimentMode::PrepareProfile { fixture_mib, .. } => *fixture_mib,
    };
    let fixture_length = fixture_mib
        .checked_mul(1024 * 1024)
        .filter(|length| *length > 0 && *length <= MAX_FIXTURE_BYTES)
        .ok_or("fixture size must be between 1 and 256 MiB")?;
    if let ExperimentMode::PrepareProfile {
        profile_root,
        payload_root,
        profile_id,
        ..
    } = mode
    {
        let (torrent_id, fixture) =
            persist_fixture(&profile_root, &payload_root, &profile_id, fixture_length)?;
        println!(
            "RSTORRENT_DIRECT_FILE_PROFILE_READY {}",
            serde_json::to_string(&serde_json::json!({
                "torrent_id": torrent_id,
                "fixture": fixture,
            }))?
        );
        return Ok(());
    }
    let udp_ip = discover_private_ipv4();
    let temporary = tempfile::tempdir()?;
    let (application, capability, fixture_view) =
        create_fixture(&temporary, fixture_length).await?;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let origin = format!("http://{address}");
    application.lock().await.configure_media_origin(&origin)?;
    let token = create_capability(&application, &capability).await?;
    let state = ExperimentState {
        expected_host: Arc::from(address.to_string()),
        udp_ip,
        capability: Arc::from(token),
        factory: DirectFileEndpointFactory::with_experiment_source(
            application.clone(),
            send_window_bytes,
            match source_name.as_str() {
                "verified" => ExperimentSource::Verified,
                "generated" => ExperimentSource::GeneratedRanges,
                "raw" => ExperimentSource::Raw {
                    length: fixture_length,
                    buffer_bytes: raw_buffer_bytes,
                },
                _ => unreachable!(),
            },
        )
        .ok_or("window must be 16, 32 or 64 KiB")?,
        endpoint: Arc::new(Mutex::new(None)),
        last_snapshot: Arc::new(Mutex::new(None)),
        fixture: fixture_view,
    };
    let router = Router::new()
        .route("/", get(index))
        .route("/experiment.js", get(javascript))
        .route("/fixture", get(fixture_metadata))
        .route("/offer", post(offer))
        .route("/candidate", post(candidate))
        .route("/close", post(close))
        .route("/status", get(status))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state.clone());
    let cancellation = CancellationToken::new();
    let signal_cancellation = cancellation.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        signal_cancellation.cancel();
    });

    let ready = ReadyView {
        url: format!("{origin}/"),
        pid: std::process::id(),
        udp_ip,
        fixture: state.fixture.clone(),
    };
    println!(
        "RSTORRENT_DIRECT_FILE_READY {}",
        serde_json::to_string(&ready)?
    );
    std::io::stdout().flush()?;
    axum::serve(listener, router)
        .with_graceful_shutdown(cancellation.cancelled_owned())
        .await?;

    if let Some(mut endpoint) = state.endpoint.lock().await.take() {
        endpoint.shutdown().await?;
        *state.last_snapshot.lock().await = Some(endpoint.snapshot());
    }
    application.lock().await.shutdown().await?;
    Ok(())
}

enum ExperimentMode {
    Serve {
        fixture_mib: usize,
    },
    PrepareProfile {
        fixture_mib: usize,
        profile_root: PathBuf,
        payload_root: PathBuf,
        profile_id: String,
    },
}

fn parse_mode() -> Result<(ExperimentMode, usize, String, usize), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let mut fixture_mib = DEFAULT_FIXTURE_MIB;
    let mut source_name = "verified".to_owned();
    let mut raw_buffer_bytes = 512 * 1024;
    let mut send_window_bytes = 64 * 1024;
    let mut profile_root = None;
    let mut payload_root = None;
    let mut profile_id = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--raw-buffer-kib" => {
                let kib: usize = arguments
                    .next()
                    .ok_or("--raw-buffer-kib requires a value")?
                    .parse()?;
                if !matches!(kib, 16 | 32 | 64 | 128 | 256 | 512) {
                    return Err("raw buffer must be 16, 32, 64, 128, 256 or 512 KiB".into());
                }
                raw_buffer_bytes = kib * 1024;
            }
            "--source" => {
                source_name = arguments.next().ok_or("--source requires a value")?;
                if !matches!(source_name.as_str(), "verified" | "generated" | "raw") {
                    return Err("source must be verified, generated or raw".into());
                }
            }
            "--window-kib" => {
                let kib: usize = arguments
                    .next()
                    .ok_or("--window-kib requires a value")?
                    .parse()?;
                if !matches!(kib, 16 | 32 | 64) {
                    return Err("window must be 16, 32 or 64 KiB".into());
                }
                send_window_bytes = kib * 1024;
            }
            "--fixture-mib" => {
                fixture_mib = arguments
                    .next()
                    .ok_or("--fixture-mib requires a value")?
                    .parse()?;
            }
            "--prepare-profile" => {
                profile_root = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or("--prepare-profile requires a path")?,
                ));
            }
            "--payload-root" => {
                payload_root = Some(PathBuf::from(
                    arguments.next().ok_or("--payload-root requires a path")?,
                ));
            }
            "--profile-id" => {
                profile_id = Some(arguments.next().ok_or("--profile-id requires a value")?);
            }
            _ => return Err(format!("unknown argument: {argument}").into()),
        }
    }
    match (profile_root, payload_root, profile_id) {
        (None, None, None) => Ok((
            ExperimentMode::Serve { fixture_mib },
            send_window_bytes,
            source_name,
            raw_buffer_bytes,
        )),
        (Some(profile_root), Some(payload_root), Some(profile_id)) => Ok((
            ExperimentMode::PrepareProfile {
                fixture_mib,
                profile_root,
                payload_root,
                profile_id,
            },
            send_window_bytes,
            source_name,
            raw_buffer_bytes,
        )),
        _ => Err(
            "profile preparation requires --prepare-profile, --payload-root, and --profile-id"
                .into(),
        ),
    }
}

fn discover_private_ipv4() -> IpAddr {
    let discovered = (|| {
        let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
        socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
        let IpAddr::V4(address) = socket.local_addr().ok()?.ip() else {
            return None;
        };
        (address.is_private() && !address.is_loopback()).then_some(IpAddr::V4(address))
    })();
    discovered.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

async fn create_fixture(
    temporary: &TempDir,
    length: usize,
) -> Result<(Arc<Mutex<ApplicationService>>, String, FixtureView), Box<dyn std::error::Error>> {
    let profile_root = temporary.path().join("profile");
    let payload_root = temporary.path().join("payload");
    let profile_id = "webrtc-direct-file-experiment";
    let (torrent_id, fixture) = persist_fixture(&profile_root, &payload_root, profile_id, length)?;
    let roots = vec![ConfiguredStorageRoot::path("downloads", payload_root)];
    let config = ApplicationConfig::new(
        profile_root,
        profile_id.to_owned(),
        roots,
        NetworkConfig::new(
            NetworkPolicy::LoopbackOnly,
            Duration::from_secs(2),
            Duration::from_secs(2),
        ),
    );
    let application = Arc::new(Mutex::new(ApplicationService::open(config).await?));
    Ok((application, torrent_id, fixture))
}

fn persist_fixture(
    profile_root: &Path,
    payload_root: &Path,
    profile_id: &str,
    length: usize,
) -> Result<(String, FixtureView), Box<dyn std::error::Error>> {
    let payload = (0..length)
        .map(|index| {
            let mixed = index
                .wrapping_mul(31)
                .wrapping_add((index >> 8).wrapping_mul(17));
            mixed as u8
        })
        .collect::<Vec<_>>();
    let file_name = "webrtc-direct-file-fixture.bin";
    let raw_info = single_file_info(file_name, &payload, PIECE_LENGTH);
    let info_hash = hex(&Sha1::digest(&raw_info));
    std::fs::create_dir_all(payload_root)?;
    std::fs::write(payload_root.join(file_name), &payload)?;
    let roots = vec![ConfiguredStorageRoot::path(
        "downloads",
        payload_root.to_owned(),
    )];
    let mut store = SessionStore::open(profile_root, profile_id, &roots)?;
    let response = store.handle_durable(&RequestEnvelope {
        version: CONTROL_VERSION,
        request_id: "add-webrtc-direct-file-fixture".to_owned(),
        expected_revision: None,
        command: Command::AddMagnet {
            magnet: format!("magnet:?xt=urn:btih:{info_hash}"),
            storage_root: "downloads".to_owned(),
            start_content: false,
            await_file_selection: false,
            skip_files: Vec::new(),
        },
    })?;
    let torrent_id = match response.result {
        Some(CommandResult::AddTorrent { result }) => result.torrent_id,
        _ => return Err("fixture torrent was not added".into()),
    };
    store.record_metadata(&torrent_id, &raw_info)?;
    let piece_count = payload.len().div_ceil(PIECE_LENGTH);
    let pieces = (0..piece_count).collect::<Vec<_>>();
    store.record_pieces(&torrent_id, &pieces)?;
    store.mark_complete(&torrent_id)?;
    drop(store);

    let head_length = length.min(100_003);
    let tail_length = length.min(97_003);
    let tail_offset = length - tail_length;
    let seek_length = length.min(65_537);
    let seek_offset = (length / 3).min(length - seek_length);
    let overlap_length = length.min(80_003);
    let overlap_offset = (seek_offset + seek_length / 2).min(length - overlap_length);
    Ok((
        torrent_id,
        FixtureView {
            file_name: file_name.to_owned(),
            length,
            sha256: sha256(&payload),
            head_sha256: sha256(&payload[..head_length]),
            tail_sha256: sha256(&payload[tail_offset..]),
            seek_sha256: sha256(&payload[seek_offset..seek_offset + seek_length]),
            overlap_sha256: sha256(&payload[overlap_offset..overlap_offset + overlap_length]),
            head_offset: 0,
            head_length,
            tail_offset,
            tail_length,
            seek_offset,
            seek_length,
            overlap_offset,
            overlap_length,
        },
    ))
}

async fn create_capability(
    application: &Arc<Mutex<ApplicationService>>,
    torrent_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let response = application
        .lock()
        .await
        .create_media_url(torrent_id, 0)
        .await?;
    let MediaUrlOutcome::Created { url, .. } = response.outcome else {
        return Err("fixture media capability was unavailable".into());
    };
    Ok(url
        .rsplit('/')
        .next()
        .ok_or("capability URL missing token")?
        .to_owned())
}

fn single_file_info(name: &str, payload: &[u8], piece_length: usize) -> Vec<u8> {
    let hashes = payload
        .chunks(piece_length)
        .flat_map(|piece| Sha1::digest(piece).to_vec())
        .collect::<Vec<_>>();
    let mut info = format!(
        "d6:lengthi{}e4:name{}:{}12:piece lengthi{}e6:pieces{}:",
        payload.len(),
        name.len(),
        name,
        piece_length,
        hashes.len()
    )
    .into_bytes();
    info.extend_from_slice(&hashes);
    info.push(b'e');
    info
}

fn sha256(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn index(State(state): State<ExperimentState>, headers: HeaderMap) -> Response {
    asset_response(&state, &headers, "text/html; charset=utf-8", HTML)
}

async fn javascript(State(state): State<ExperimentState>, headers: HeaderMap) -> Response {
    asset_response(
        &state,
        &headers,
        "text/javascript; charset=utf-8",
        JAVASCRIPT,
    )
}

async fn fixture_metadata(
    State(state): State<ExperimentState>,
    headers: HeaderMap,
) -> Result<Json<FixtureView>, StatusCode> {
    require_host(&state, &headers)?;
    Ok(Json(state.fixture))
}

async fn offer(
    State(state): State<ExperimentState>,
    headers: HeaderMap,
    Json(offer): Json<RTCSessionDescription>,
) -> Result<Json<OfferAnswer>, (StatusCode, String)> {
    require_host(&state, &headers).map_err(|status| (status, String::new()))?;
    let mut endpoint = state.endpoint.lock().await;
    if endpoint.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "one peer is already active".to_owned(),
        ));
    }
    let (answer, started) = state
        .factory
        .answer_offer(state.capability.to_string(), state.udp_ip, offer)
        .await
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    *endpoint = Some(started);
    Ok(Json(answer))
}

async fn candidate(
    State(state): State<ExperimentState>,
    headers: HeaderMap,
    Json(candidate): Json<RTCIceCandidateInit>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_host(&state, &headers).map_err(|status| (status, String::new()))?;
    let endpoint = state.endpoint.lock().await;
    let endpoint = endpoint
        .as_ref()
        .ok_or((StatusCode::CONFLICT, "no active peer".to_owned()))?;
    endpoint
        .add_remote_candidate(candidate)
        .await
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn close(
    State(state): State<ExperimentState>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, String)> {
    require_host(&state, &headers).map_err(|status| (status, String::new()))?;
    let endpoint = state.endpoint.lock().await.take();
    if let Some(mut endpoint) = endpoint {
        endpoint
            .shutdown()
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        *state.last_snapshot.lock().await = Some(endpoint.snapshot());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn status(
    State(state): State<ExperimentState>,
    headers: HeaderMap,
) -> Result<Json<DirectFileEndpointSnapshot>, StatusCode> {
    require_host(&state, &headers)?;
    let endpoint = state.endpoint.lock().await;
    if let Some(endpoint) = endpoint.as_ref() {
        return Ok(Json(endpoint.snapshot()));
    }
    drop(endpoint);
    Ok(Json(
        state
            .last_snapshot
            .lock()
            .await
            .clone()
            .unwrap_or_else(|| state.factory.idle_snapshot()),
    ))
}

fn require_host(state: &ExperimentState, headers: &HeaderMap) -> Result<(), StatusCode> {
    headers
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
        .is_some_and(|host| host.eq_ignore_ascii_case(&state.expected_host))
        .then_some(())
        .ok_or(StatusCode::NOT_FOUND)
}

fn asset_response(
    state: &ExperimentState,
    headers: &HeaderMap,
    content_type: &'static str,
    body: &'static str,
) -> Response {
    if require_host(state, headers).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut response = Response::new(Body::from(body));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'none'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    response.headers_mut().insert(
        HeaderValueName::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

struct HeaderValueName;

impl HeaderValueName {
    const REFERRER_POLICY: header::HeaderName = header::HeaderName::from_static("referrer-policy");
}
