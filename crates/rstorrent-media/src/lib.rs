#![forbid(unsafe_code)]

use std::io;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use axum::routing::any;
use futures_util::stream;
use rstorrent_session::{
    ApplicationService, MediaCapabilityLease, MediaRangeError, MediaReadError, MediaResolveError,
};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub const MEDIA_ROUTE: &str = "/media/v1/{capability}";
pub const MAX_RANGE_HEADER_BYTES: usize = 256;

type SharedApplication = Arc<Mutex<ApplicationService>>;

#[derive(Debug)]
pub enum MediaServerError {
    Bind(io::Error),
    Configure(String),
    Serve(io::Error),
    Join(String),
}

impl std::fmt::Display for MediaServerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bind(error) => write!(formatter, "bind media listener: {error}"),
            Self::Configure(error) => write!(formatter, "configure media listener: {error}"),
            Self::Serve(error) => write!(formatter, "serve media listener: {error}"),
            Self::Join(error) => write!(formatter, "join media listener: {error}"),
        }
    }
}

impl std::error::Error for MediaServerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Bind(error) | Self::Serve(error) => Some(error),
            Self::Configure(_) | Self::Join(_) => None,
        }
    }
}

#[derive(Debug)]
pub struct LoopbackMediaServer {
    local_addr: SocketAddr,
    cancellation: CancellationToken,
    task: Option<JoinHandle<Result<(), io::Error>>>,
}

impl LoopbackMediaServer {
    pub async fn bind(service: SharedApplication) -> Result<Self, MediaServerError> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(MediaServerError::Bind)?;
        let local_addr = listener.local_addr().map_err(MediaServerError::Bind)?;
        let origin = format!("http://{local_addr}");
        service
            .lock()
            .await
            .configure_media_origin(&origin)
            .map_err(|error| MediaServerError::Configure(error.to_string()))?;
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let router = media_router(service, Arc::<str>::from(local_addr.to_string()));
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(task_cancellation.cancelled_owned())
                .await
        });
        Ok(Self {
            local_addr,
            cancellation,
            task: Some(task),
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub async fn shutdown(&mut self) -> Result<(), MediaServerError> {
        self.cancellation.cancel();
        let Some(task) = self.task.take() else {
            return Ok(());
        };
        task.await
            .map_err(|error| MediaServerError::Join(error.to_string()))?
            .map_err(MediaServerError::Serve)
    }
}

impl Drop for LoopbackMediaServer {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[derive(Clone)]
struct MediaState {
    service: SharedApplication,
    expected_host: Arc<str>,
}

pub fn media_router(service: SharedApplication, expected_host: impl Into<Arc<str>>) -> Router {
    Router::new()
        .route(MEDIA_ROUTE, any(media_request))
        .with_state(MediaState {
            service,
            expected_host: expected_host.into(),
        })
}

async fn media_request(
    State(state): State<MediaState>,
    Path(capability): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if !headers
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
        .is_some_and(|host| host.eq_ignore_ascii_case(&state.expected_host))
    {
        return empty_response(StatusCode::NOT_FOUND);
    }
    let mut lease = {
        let mut service = state.service.lock().await;
        match service.resolve_media_capability(&capability) {
            Ok(lease) => lease,
            Err(MediaResolveError::NotFound) => return empty_response(StatusCode::NOT_FOUND),
            Err(MediaResolveError::Busy) => {
                let mut response = empty_response(StatusCode::SERVICE_UNAVAILABLE);
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
                return response;
            }
        }
    };
    if method != Method::GET && method != Method::HEAD {
        let mut response = empty_response(StatusCode::METHOD_NOT_ALLOWED);
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return response;
    }
    let file_length = lease.length();
    let range = match requested_range(&headers, file_length) {
        Ok(range) => range,
        Err(()) => return range_not_satisfiable(file_length),
    };
    let content_length = range.end_exclusive - range.start;
    let content_type = mime_type(lease.file_name());
    let status = if range.partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let body = if method == Method::HEAD || content_length == 0 {
        Body::empty()
    } else if lease.is_active() {
        let first_length =
            usize::try_from(content_length.min(64 * 1024)).expect("chunk fits usize");
        if let Err(error) = lease.wait_for_range(range.start, first_length).await {
            return active_preflight_range_error(error);
        }
        let first = match lease.read_range(range.start, first_length).await {
            Ok(bytes) if bytes.len() == first_length => bytes,
            Ok(_) => return empty_response(StatusCode::NOT_FOUND),
            Err(error) => return active_preflight_read_error(error),
        };
        media_body(lease, range.start, content_length, Some(first))
    } else {
        media_body(lease, range.start, content_length, None)
    };
    let mut response = Response::new(body);
    *response.status_mut() = status;
    common_headers(response.headers_mut());
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    insert_u64_header(
        response.headers_mut(),
        header::CONTENT_LENGTH,
        content_length,
    );
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    if range.partial
        && let Ok(value) = HeaderValue::from_str(&format!(
            "bytes {}-{}/{file_length}",
            range.start,
            range.end_exclusive - 1
        ))
    {
        response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    response
}

fn active_preflight_range_error(error: MediaRangeError) -> Response {
    match error {
        MediaRangeError::NoProgress => empty_response(StatusCode::GATEWAY_TIMEOUT),
        MediaRangeError::Saturated => {
            let mut response = empty_response(StatusCode::SERVICE_UNAVAILABLE);
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
            response
        }
        MediaRangeError::Revoked | MediaRangeError::Active(_) => {
            empty_response(StatusCode::NOT_FOUND)
        }
    }
}

fn active_preflight_read_error(error: MediaReadError) -> Response {
    match error {
        MediaReadError::Closed | MediaReadError::Active(_) | MediaReadError::Verified(_) => {
            empty_response(StatusCode::NOT_FOUND)
        }
    }
}

fn media_body(
    lease: MediaCapabilityLease,
    offset: u64,
    length: u64,
    first: Option<Vec<u8>>,
) -> Body {
    struct BodyState {
        lease: MediaCapabilityLease,
        offset: u64,
        remaining: u64,
        first: Option<Vec<u8>>,
    }

    let state = BodyState {
        lease,
        offset,
        remaining: length,
        first,
    };
    Body::from_stream(stream::unfold(Some(state), |state| async move {
        let mut state = state?;
        if state.remaining == 0 || !state.lease.is_live() {
            return None;
        }
        if let Some(bytes) = state.first.take() {
            state.lease.touch_served(bytes.len());
            state.offset += bytes.len() as u64;
            state.remaining -= bytes.len() as u64;
            return Some((Ok::<Bytes, io::Error>(Bytes::from(bytes)), Some(state)));
        }
        let length = usize::try_from(state.remaining.min(64 * 1024)).expect("chunk fits usize");
        let cancellation = state.lease.cancellation().clone();
        let ready = state.lease.wait_for_range(state.offset, length);
        let ready = tokio::select! {
            _ = cancellation.cancelled() => return None,
            result = ready => result,
        };
        if let Err(error) = ready {
            return Some((
                Err(io::Error::other(format!(
                    "active media range unavailable: {error:?}"
                ))),
                None,
            ));
        }
        let read = state.lease.read_range(state.offset, length);
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return None,
            result = read => match result {
                Ok(bytes) => bytes,
                Err(error) => {
                    return Some((
                        Err(io::Error::other(error.to_string())),
                        None,
                    ));
                }
            },
        };
        if bytes.len() != length {
            return Some((
                Err(io::Error::other("media read returned a short range")),
                None,
            ));
        }
        state.lease.touch_served(bytes.len());
        state.offset += bytes.len() as u64;
        state.remaining -= bytes.len() as u64;
        Some((Ok::<Bytes, io::Error>(Bytes::from(bytes)), Some(state)))
    }))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ByteRange {
    start: u64,
    end_exclusive: u64,
    partial: bool,
}

fn requested_range(headers: &HeaderMap, file_length: u64) -> Result<ByteRange, ()> {
    let values = headers.get_all(header::RANGE);
    let mut values = values.iter();
    let Some(value) = values.next() else {
        return Ok(ByteRange {
            start: 0,
            end_exclusive: file_length,
            partial: false,
        });
    };
    if values.next().is_some() || value.as_bytes().len() > MAX_RANGE_HEADER_BYTES {
        return Err(());
    }
    parse_range(value.to_str().map_err(|_| ())?, file_length)
}

fn parse_range(value: &str, file_length: u64) -> Result<ByteRange, ()> {
    if file_length == 0 || value.contains(',') {
        return Err(());
    }
    let (unit, interval) = value.trim().split_once('=').ok_or(())?;
    if !unit.eq_ignore_ascii_case("bytes") || interval.is_empty() {
        return Err(());
    }
    let (start, end) = interval.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = parse_decimal(end)?;
        if suffix == 0 {
            return Err(());
        }
        let length = suffix.min(file_length);
        return Ok(ByteRange {
            start: file_length - length,
            end_exclusive: file_length,
            partial: true,
        });
    }
    let start = parse_decimal(start)?;
    if start >= file_length {
        return Err(());
    }
    let inclusive_end = if end.is_empty() {
        file_length - 1
    } else {
        let end = parse_decimal(end)?;
        if end < start {
            return Err(());
        }
        end.min(file_length - 1)
    };
    Ok(ByteRange {
        start,
        end_exclusive: inclusive_end.checked_add(1).ok_or(())?,
        partial: true,
    })
}

fn parse_decimal(value: &str) -> Result<u64, ()> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    value.parse().map_err(|_| ())
}

fn range_not_satisfiable(file_length: u64) -> Response {
    let mut response = empty_response(StatusCode::RANGE_NOT_SATISFIABLE);
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(value) = HeaderValue::from_str(&format!("bytes */{file_length}")) {
        response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    response
}

fn empty_response(status: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    common_headers(response.headers_mut());
    response
}

fn common_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
}

fn insert_u64_header(headers: &mut HeaderMap, name: HeaderName, value: u64) {
    if let Ok(value) = HeaderValue::from_str(&value.to_string()) {
        headers.insert(name, value);
    }
}

fn mime_type(file_name: &str) -> &'static str {
    let extension = file_name.rsplit_once('.').map(|(_, extension)| extension);
    match extension
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("ogv") => "video/ogg",
        Some("mp3") => "audio/mpeg",
        Some("m4a" | "m4b") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("ogg" | "oga" | "opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("txt" | "srt" | "vtt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    use axum::body::to_bytes;
    use axum::extract::{Path, State};
    use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
    use rstorrent_session::{
        ApplicationConfig, ApplicationService, CONTROL_VERSION, Command, CommandResult,
        ConfiguredStorageRoot, MediaRangeError, MediaUrlOutcome, NetworkConfig, NetworkPolicy,
        RequestEnvelope, SessionStore,
    };
    use sha1::{Digest, Sha1};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    use tokio::sync::Mutex;

    use super::{
        ByteRange, LoopbackMediaServer, MediaState, active_preflight_range_error, media_request,
        mime_type, parse_range,
    };

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rstorrent-media-{label}-{}-{}",
            std::process::id(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ))
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

    fn encode_info_hash(info_hash: [u8; 20]) -> String {
        info_hash.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    async fn media_fixture() -> (MediaState, String, String, PathBuf) {
        let root = test_root("http");
        let payload_root = root.join("payload");
        std::fs::create_dir_all(&payload_root).expect("create payload root");
        let payload = b"0123456789-media-payload";
        let raw_info = single_file_info("movie.MP4", payload, 7);
        let info_hash = encode_info_hash(Sha1::digest(&raw_info).into());
        let roots = vec![ConfiguredStorageRoot::path(
            "downloads",
            payload_root.clone(),
        )];
        let config = ApplicationConfig::new(
            root.join("profile"),
            "media-test".to_owned(),
            roots.clone(),
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                Duration::from_secs(2),
                Duration::from_secs(2),
            ),
        );
        let mut store = SessionStore::open(
            config.durable_profile_root().expect("profile root"),
            &config.profile_id,
            &roots,
        )
        .expect("open fixture store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-media-http".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{info_hash}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add fixture torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("missing media add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        store
            .record_pieces(&torrent_id, &[0, 1, 2, 3])
            .expect("record pieces");
        store.mark_complete(&torrent_id).expect("complete fixture");
        drop(store);
        std::fs::write(payload_root.join("movie.MP4"), payload).expect("write payload");

        let service = Arc::new(Mutex::new(
            ApplicationService::open(config)
                .await
                .expect("open application"),
        ));
        service
            .lock()
            .await
            .configure_media_origin("http://127.0.0.1:43121")
            .expect("configure origin");
        let response = service
            .lock()
            .await
            .create_media_url(&torrent_id, 0)
            .await
            .expect("create URL");
        let MediaUrlOutcome::Created { url, .. } = response.outcome else {
            panic!("fixture media unavailable")
        };
        let token = url.rsplit('/').next().expect("capability").to_owned();
        (
            MediaState {
                service,
                expected_host: Arc::from("127.0.0.1:43121"),
            },
            token,
            torrent_id,
            root,
        )
    }

    fn request_headers(range: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:43121"));
        if let Some(range) = range {
            headers.insert(header::RANGE, range.parse().expect("range header"));
        }
        headers
    }

    #[test]
    fn parses_full_open_bounded_and_suffix_ranges() {
        assert_eq!(
            parse_range("bytes=0-0", 10),
            Ok(ByteRange {
                start: 0,
                end_exclusive: 1,
                partial: true,
            })
        );
        assert_eq!(
            parse_range("bytes=4-", 10),
            Ok(ByteRange {
                start: 4,
                end_exclusive: 10,
                partial: true,
            })
        );
        assert_eq!(
            parse_range("bytes=4-99", 10),
            Ok(ByteRange {
                start: 4,
                end_exclusive: 10,
                partial: true,
            })
        );
        assert_eq!(
            parse_range("bytes=-3", 10),
            Ok(ByteRange {
                start: 7,
                end_exclusive: 10,
                partial: true,
            })
        );
        assert_eq!(
            parse_range("bytes=-99", 10),
            Ok(ByteRange {
                start: 0,
                end_exclusive: 10,
                partial: true,
            })
        );
    }

    #[test]
    fn rejects_malformed_multiple_overflowed_empty_and_unsatisfied_ranges() {
        for value in [
            "items=0-1",
            "bytes=",
            "bytes=-0",
            "bytes=3-2",
            "bytes=10-",
            "bytes=0-1,3-4",
            "bytes=18446744073709551616-",
            "bytes=0-18446744073709551616",
            "bytes=+-1",
        ] {
            assert!(parse_range(value, 10).is_err(), "accepted {value}");
        }
        assert!(parse_range("bytes=0-0", 0).is_err());
    }

    #[test]
    fn maps_a_bounded_extension_set_without_sniffing() {
        assert_eq!(mime_type("MOVIE.MP4"), "video/mp4");
        assert_eq!(mime_type("captions.vtt"), "text/plain; charset=utf-8");
        assert_eq!(mime_type("Book.M4B"), "audio/mp4");
        assert_eq!(mime_type("song.opus"), "audio/ogg");
        assert_eq!(mime_type("song.aac"), "audio/aac");
        assert_eq!(mime_type("unknown.bin"), "application/octet-stream");
        assert_eq!(mime_type("no-extension"), "application/octet-stream");
    }

    #[test]
    fn maps_active_preflight_timeout_saturation_and_revocation() {
        assert_eq!(
            active_preflight_range_error(MediaRangeError::NoProgress).status(),
            StatusCode::GATEWAY_TIMEOUT
        );
        let saturated = active_preflight_range_error(MediaRangeError::Saturated);
        assert_eq!(saturated.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(saturated.headers()[header::RETRY_AFTER], "1");
        assert_eq!(
            active_preflight_range_error(MediaRangeError::Revoked).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn serves_exact_full_range_and_head_responses_with_security_headers() {
        let (state, token, _, root) = media_fixture().await;
        let full = media_request(
            State(state.clone()),
            Path(token.clone()),
            Method::GET,
            request_headers(None),
        )
        .await;
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.headers()[header::CONTENT_LENGTH], "24");
        assert_eq!(full.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(full.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(full.headers()[header::CACHE_CONTROL], "private, no-store");
        assert_eq!(full.headers()["referrer-policy"], "no-referrer");
        assert_eq!(
            to_bytes(full.into_body(), 64 * 1024)
                .await
                .expect("full body"),
            "0123456789-media-payload"
        );

        let partial = media_request(
            State(state.clone()),
            Path(token.clone()),
            Method::GET,
            request_headers(Some("bytes=10-14")),
        )
        .await;
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers()[header::CONTENT_LENGTH], "5");
        assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 10-14/24");
        assert_eq!(
            to_bytes(partial.into_body(), 64 * 1024)
                .await
                .expect("partial body"),
            "-medi"
        );

        let head = media_request(
            State(state.clone()),
            Path(token),
            Method::HEAD,
            request_headers(Some("bytes=-7")),
        )
        .await;
        assert_eq!(head.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(head.headers()[header::CONTENT_LENGTH], "7");
        assert_eq!(head.headers()[header::CONTENT_RANGE], "bytes 17-23/24");
        assert!(
            to_bytes(head.into_body(), 1)
                .await
                .expect("head body")
                .is_empty()
        );

        state
            .service
            .lock()
            .await
            .shutdown()
            .await
            .expect("shutdown");
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn rejects_bad_ranges_methods_hosts_and_capabilities_without_reads() {
        let (state, token, _, root) = media_fixture().await;
        let invalid_range = media_request(
            State(state.clone()),
            Path(token.clone()),
            Method::GET,
            request_headers(Some("bytes=0-1,4-5")),
        )
        .await;
        assert_eq!(invalid_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(invalid_range.headers()[header::CONTENT_RANGE], "bytes */24");

        let method = media_request(
            State(state.clone()),
            Path(token.clone()),
            Method::POST,
            request_headers(None),
        )
        .await;
        assert_eq!(method.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(method.headers()[header::ALLOW], "GET, HEAD");

        let mut wrong_host = request_headers(None);
        wrong_host.insert(header::HOST, HeaderValue::from_static("attacker.test"));
        assert_eq!(
            media_request(State(state.clone()), Path(token), Method::GET, wrong_host,)
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            media_request(
                State(state.clone()),
                Path("a".repeat(43)),
                Method::GET,
                request_headers(None),
            )
            .await
            .status(),
            StatusCode::NOT_FOUND
        );

        state
            .service
            .lock()
            .await
            .shutdown()
            .await
            .expect("shutdown");
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn loopback_server_binds_ephemeral_ipv4_and_serves_only_media_route() {
        let (state, _, torrent_id, root) = media_fixture().await;
        let mut server = LoopbackMediaServer::bind(state.service.clone())
            .await
            .expect("bind loopback media server");
        assert_eq!(server.local_addr().ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(server.local_addr().port(), 0);
        let response = state
            .service
            .lock()
            .await
            .create_media_url(&torrent_id, 0)
            .await
            .expect("create loopback URL");
        let MediaUrlOutcome::Created { url, .. } = response.outcome else {
            panic!("loopback media unavailable")
        };
        let token = url.rsplit('/').next().expect("capability");
        let mut stream = TcpStream::connect(server.local_addr())
            .await
            .expect("connect media server");
        stream
            .write_all(
                format!(
                    "GET /media/v1/{token} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
                    server.local_addr()
                )
                .as_bytes(),
            )
            .await
            .expect("write media request");
        let mut received = Vec::new();
        stream
            .read_to_end(&mut received)
            .await
            .expect("read media response");
        let received = String::from_utf8(received).expect("HTTP text fixture");
        assert!(received.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(received.ends_with("\r\n\r\n0123456789-media-payload"));

        state
            .service
            .lock()
            .await
            .shutdown()
            .await
            .expect("shutdown application");
        server.shutdown().await.expect("shutdown media listener");
        std::fs::remove_dir_all(root).expect("remove root");
    }
}
