use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use rstorrent_session::{
    API_VERSION, AcknowledgedViewStream, AcknowledgedViewStreamError, AddTorrentBytesRequest,
    ApiEncoding, ApiHello, ApplicationCall, ApplicationCallError, ApplicationCallResult,
    ApplicationService, Command, DeliveryMode, UpdateBatch, ViewSetError, ViewSetOwner,
    application_error_response, validate_add_torrent_bytes_request,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore, mpsc};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use super::{
    GatewayAuthentication, GatewayState, MAX_INCOMING_MESSAGE_BYTES, MAX_TOKEN_BYTES,
    MAX_TORRENT_SOURCE_BYTES, apply_gateway_media_origin, constant_time_equal, valid_view_set_id,
};

pub const MAX_APPLICATION_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_SERVER_ENVELOPE_BYTES: usize = 4 * 1024;
pub const MAX_SERVER_MESSAGE_BYTES: usize =
    MAX_APPLICATION_PAYLOAD_BYTES + MAX_SERVER_ENVELOPE_BYTES;
pub const MAX_PENDING_CALLS: usize = 16;
pub const MAX_ATTACHMENTS_PER_CONNECTION: usize = 8;
pub const MAX_CONTROL_MESSAGES: usize = 32;
pub const MAX_IDENTIFIER_BYTES: usize = 64;
pub const CLIENT_INSTANCE_ID_BYTES: usize = 32;
pub const HANDSHAKE_TIMEOUT_MILLIS: u64 = 5_000;
pub const HEARTBEAT_IDLE_MILLIS: u64 = 15_000;
pub const HEARTBEAT_TIMEOUT_MILLIS: u64 = 10_000;
pub const MAX_INVALID_MESSAGES: u8 = 3;
pub const TORRENT_UPLOAD_TIMEOUT_MILLIS: u64 = 120_000;

const VIEW_STREAM_WAIT_MILLIS: u32 = 20_000;
const DATA_RESERVATIONS: usize = 2;
const CLIENT_FRAME_FAMILIES: [&str; 7] = [
    "connect",
    "call",
    "begin_torrent_upload",
    "attach",
    "ack",
    "detach",
    "choose_download_root",
];
const SERVER_FRAME_FAMILIES: [&str; 10] = [
    "connected",
    "result",
    "call_error",
    "torrent_upload_ready",
    "attached",
    "view_batch",
    "stream_error",
    "detached",
    "connection_error",
    "download_root_chosen",
];

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ApplicationFrameMetrics {
    pub messages: u64,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ApplicationConnectionMetricsSnapshot {
    pub accepted_connections: u64,
    pub rejected_origins: u64,
    pub rejected_authentication: u64,
    pub rejected_handshakes: u64,
    pub active_connections: usize,
    pub active_connections_high_water: usize,
    pub connection_takeovers: u64,
    pub handshake_micros_total: u64,
    pub handshake_micros_max: u64,
    pub pending_calls_high_water: usize,
    pub attachments_high_water: usize,
    pub client_frames: BTreeMap<String, ApplicationFrameMetrics>,
    pub server_frames: BTreeMap<String, ApplicationFrameMetrics>,
    pub view_batches: u64,
    pub empty_view_batches: u64,
    pub acknowledgements: u64,
    pub stream_errors: u64,
    pub reservation_waits: u64,
    pub reservation_wait_micros_total: u64,
    pub reservation_wait_micros_max: u64,
    pub outbound_items_high_water: usize,
    pub outbound_message_bytes_high_water: usize,
    pub delivery_latency_micros_total: u64,
    pub delivery_latency_micros_max: u64,
    pub pings: u64,
    pub pongs: u64,
    pub heartbeat_timeouts: u64,
}

#[derive(Clone, Default)]
pub struct ApplicationConnectionMetrics {
    inner: Arc<ApplicationConnectionMetricAtoms>,
}

#[derive(Default)]
struct ApplicationConnectionMetricAtoms {
    accepted_connections: AtomicU64,
    rejected_origins: AtomicU64,
    rejected_authentication: AtomicU64,
    rejected_handshakes: AtomicU64,
    active_connections: AtomicUsize,
    active_connections_high_water: AtomicUsize,
    connection_takeovers: AtomicU64,
    handshake_micros_total: AtomicU64,
    handshake_micros_max: AtomicU64,
    pending_calls_high_water: AtomicUsize,
    attachments_high_water: AtomicUsize,
    client_frames: [FrameMetricAtoms; CLIENT_FRAME_FAMILIES.len()],
    server_frames: [FrameMetricAtoms; SERVER_FRAME_FAMILIES.len()],
    view_batches: AtomicU64,
    empty_view_batches: AtomicU64,
    acknowledgements: AtomicU64,
    stream_errors: AtomicU64,
    reservation_waits: AtomicU64,
    reservation_wait_micros_total: AtomicU64,
    reservation_wait_micros_max: AtomicU64,
    outbound_items_high_water: AtomicUsize,
    outbound_message_bytes_high_water: AtomicUsize,
    delivery_latency_micros_total: AtomicU64,
    delivery_latency_micros_max: AtomicU64,
    pings: AtomicU64,
    pongs: AtomicU64,
    heartbeat_timeouts: AtomicU64,
}

#[derive(Default)]
struct FrameMetricAtoms {
    messages: AtomicU64,
    bytes: AtomicU64,
}

impl ApplicationConnectionMetrics {
    pub fn snapshot(&self) -> ApplicationConnectionMetricsSnapshot {
        let load_frames = |labels: &[&str], values: &[FrameMetricAtoms]| {
            labels
                .iter()
                .zip(values)
                .map(|(label, value)| {
                    (
                        (*label).to_owned(),
                        ApplicationFrameMetrics {
                            messages: value.messages.load(Ordering::Relaxed),
                            bytes: value.bytes.load(Ordering::Relaxed),
                        },
                    )
                })
                .collect()
        };
        ApplicationConnectionMetricsSnapshot {
            accepted_connections: self.inner.accepted_connections.load(Ordering::Relaxed),
            rejected_origins: self.inner.rejected_origins.load(Ordering::Relaxed),
            rejected_authentication: self.inner.rejected_authentication.load(Ordering::Relaxed),
            rejected_handshakes: self.inner.rejected_handshakes.load(Ordering::Relaxed),
            active_connections: self.inner.active_connections.load(Ordering::Relaxed),
            active_connections_high_water: self
                .inner
                .active_connections_high_water
                .load(Ordering::Relaxed),
            connection_takeovers: self.inner.connection_takeovers.load(Ordering::Relaxed),
            handshake_micros_total: self.inner.handshake_micros_total.load(Ordering::Relaxed),
            handshake_micros_max: self.inner.handshake_micros_max.load(Ordering::Relaxed),
            pending_calls_high_water: self.inner.pending_calls_high_water.load(Ordering::Relaxed),
            attachments_high_water: self.inner.attachments_high_water.load(Ordering::Relaxed),
            client_frames: load_frames(&CLIENT_FRAME_FAMILIES, &self.inner.client_frames),
            server_frames: load_frames(&SERVER_FRAME_FAMILIES, &self.inner.server_frames),
            view_batches: self.inner.view_batches.load(Ordering::Relaxed),
            empty_view_batches: self.inner.empty_view_batches.load(Ordering::Relaxed),
            acknowledgements: self.inner.acknowledgements.load(Ordering::Relaxed),
            stream_errors: self.inner.stream_errors.load(Ordering::Relaxed),
            reservation_waits: self.inner.reservation_waits.load(Ordering::Relaxed),
            reservation_wait_micros_total: self
                .inner
                .reservation_wait_micros_total
                .load(Ordering::Relaxed),
            reservation_wait_micros_max: self
                .inner
                .reservation_wait_micros_max
                .load(Ordering::Relaxed),
            outbound_items_high_water: self.inner.outbound_items_high_water.load(Ordering::Relaxed),
            outbound_message_bytes_high_water: self
                .inner
                .outbound_message_bytes_high_water
                .load(Ordering::Relaxed),
            delivery_latency_micros_total: self
                .inner
                .delivery_latency_micros_total
                .load(Ordering::Relaxed),
            delivery_latency_micros_max: self
                .inner
                .delivery_latency_micros_max
                .load(Ordering::Relaxed),
            pings: self.inner.pings.load(Ordering::Relaxed),
            pongs: self.inner.pongs.load(Ordering::Relaxed),
            heartbeat_timeouts: self.inner.heartbeat_timeouts.load(Ordering::Relaxed),
        }
    }

    fn rejected_origin(&self) {
        self.inner.rejected_origins.fetch_add(1, Ordering::Relaxed);
    }

    fn rejected_authentication(&self) {
        self.inner
            .rejected_authentication
            .fetch_add(1, Ordering::Relaxed);
    }

    fn rejected_handshake(&self) {
        self.inner
            .rejected_handshakes
            .fetch_add(1, Ordering::Relaxed);
    }

    fn accepted(&self, takeover: bool, handshake: Duration) {
        self.inner
            .accepted_connections
            .fetch_add(1, Ordering::Relaxed);
        let active = self
            .inner
            .active_connections
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        observe_high_water(&self.inner.active_connections_high_water, active);
        if takeover {
            self.inner
                .connection_takeovers
                .fetch_add(1, Ordering::Relaxed);
        }
        let micros = duration_micros(handshake);
        self.inner
            .handshake_micros_total
            .fetch_add(micros, Ordering::Relaxed);
        observe_high_water_u64(&self.inner.handshake_micros_max, micros);
    }

    fn connection_closed(&self) {
        self.inner
            .active_connections
            .fetch_sub(1, Ordering::Relaxed);
    }

    fn record_client_frame(&self, frame: &ApplicationClientFrame, bytes: usize) {
        let index = match frame {
            ApplicationClientFrame::Connect { .. } => 0,
            ApplicationClientFrame::Call { .. } => 1,
            ApplicationClientFrame::BeginTorrentUpload { .. } => 2,
            ApplicationClientFrame::Attach { .. } => 3,
            ApplicationClientFrame::Ack { .. } => 4,
            ApplicationClientFrame::Detach { .. } => 5,
            ApplicationClientFrame::ChooseDownloadRoot { .. } => 6,
        };
        record_frame(&self.inner.client_frames[index], bytes);
        if matches!(frame, ApplicationClientFrame::Ack { .. }) {
            self.inner.acknowledgements.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_server_frame(&self, frame: &ApplicationServerFrame, bytes: usize) {
        let index = match frame {
            ApplicationServerFrame::Connected { .. } => 0,
            ApplicationServerFrame::Result { .. } => 1,
            ApplicationServerFrame::CallError { .. } => 2,
            ApplicationServerFrame::TorrentUploadReady { .. } => 3,
            ApplicationServerFrame::Attached { .. } => 4,
            ApplicationServerFrame::ViewBatch { batch, .. } => {
                self.inner.view_batches.fetch_add(1, Ordering::Relaxed);
                if batch.updates.is_empty() {
                    self.inner
                        .empty_view_batches
                        .fetch_add(1, Ordering::Relaxed);
                }
                5
            }
            ApplicationServerFrame::StreamError { .. } => {
                self.inner.stream_errors.fetch_add(1, Ordering::Relaxed);
                6
            }
            ApplicationServerFrame::Detached { .. } => 7,
            ApplicationServerFrame::ConnectionError { .. } => 8,
            ApplicationServerFrame::DownloadRootChosen { .. } => 9,
        };
        record_frame(&self.inner.server_frames[index], bytes);
        observe_high_water(&self.inner.outbound_message_bytes_high_water, bytes);
    }

    fn observe_pending(&self, pending: usize) {
        observe_high_water(&self.inner.pending_calls_high_water, pending);
    }

    fn observe_attachments(&self, attachments: usize) {
        observe_high_water(&self.inner.attachments_high_water, attachments);
    }

    fn observe_outbound_items(&self, items: usize) {
        observe_high_water(&self.inner.outbound_items_high_water, items);
    }

    fn reservation_wait(&self, elapsed: Duration) {
        let micros = duration_micros(elapsed);
        if micros > 0 {
            self.inner.reservation_waits.fetch_add(1, Ordering::Relaxed);
        }
        self.inner
            .reservation_wait_micros_total
            .fetch_add(micros, Ordering::Relaxed);
        observe_high_water_u64(&self.inner.reservation_wait_micros_max, micros);
    }

    fn delivered(&self, elapsed: Duration) {
        let micros = duration_micros(elapsed);
        self.inner
            .delivery_latency_micros_total
            .fetch_add(micros, Ordering::Relaxed);
        observe_high_water_u64(&self.inner.delivery_latency_micros_max, micros);
    }
}

fn record_frame(metric: &FrameMetricAtoms, bytes: usize) {
    metric.messages.fetch_add(1, Ordering::Relaxed);
    metric.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
}

fn observe_high_water(metric: &AtomicUsize, value: usize) {
    metric.fetch_max(value, Ordering::Relaxed);
}

fn observe_high_water_u64(metric: &AtomicU64, value: u64) {
    metric.fetch_max(value, Ordering::Relaxed);
}

fn duration_micros(duration: Duration) -> u64 {
    duration.as_micros().min(u128::from(u64::MAX)) as u64
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApplicationConnectionLimits {
    pub max_attachments: u16,
    pub max_pending_calls: u16,
    pub max_client_message_bytes: u32,
    pub max_application_payload_bytes: u32,
    pub max_torrent_source_bytes: u32,
    pub heartbeat_idle_millis: u32,
    pub heartbeat_timeout_millis: u32,
}

impl Default for ApplicationConnectionLimits {
    fn default() -> Self {
        Self {
            max_attachments: MAX_ATTACHMENTS_PER_CONNECTION as u16,
            max_pending_calls: MAX_PENDING_CALLS as u16,
            max_client_message_bytes: MAX_INCOMING_MESSAGE_BYTES as u32,
            max_application_payload_bytes: MAX_APPLICATION_PAYLOAD_BYTES as u32,
            max_torrent_source_bytes: MAX_TORRENT_SOURCE_BYTES as u32,
            heartbeat_idle_millis: HEARTBEAT_IDLE_MILLIS as u32,
            heartbeat_timeout_millis: HEARTBEAT_TIMEOUT_MILLIS as u32,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApplicationClientFrame {
    ChooseDownloadRoot {
        call_id: String,
        request: super::ChooseDownloadRootRequest,
    },
    Connect {
        api_version: u16,
        encoding: ApiEncoding,
        client_instance_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
    Call {
        call_id: String,
        operation: ApplicationCall,
    },
    BeginTorrentUpload {
        call_id: String,
        upload_id: String,
        request: AddTorrentBytesRequest,
    },
    Attach {
        call_id: String,
        stream_id: String,
        view_set_id: String,
        after: String,
    },
    Ack {
        stream_id: String,
        cursor: String,
    },
    Detach {
        call_id: String,
        stream_id: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApplicationServerFrame {
    DownloadRootChosen {
        call_id: String,
        response: super::ChooseDownloadRootResponse,
    },
    Connected {
        api_version: u16,
        encoding: ApiEncoding,
        hello: Box<ApiHello>,
        connection_limits: ApplicationConnectionLimits,
    },
    Result {
        call_id: String,
        result: ApplicationCallResult,
    },
    CallError {
        call_id: String,
        error: ApplicationConnectionError,
    },
    TorrentUploadReady {
        call_id: String,
        upload_id: String,
    },
    Attached {
        call_id: String,
        stream_id: String,
        view_set_id: String,
    },
    ViewBatch {
        stream_id: String,
        batch: Box<UpdateBatch>,
    },
    StreamError {
        stream_id: String,
        error: ApplicationConnectionError,
    },
    Detached {
        call_id: String,
        stream_id: String,
    },
    ConnectionError {
        error: ApplicationConnectionError,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum ApplicationConnectionErrorCode {
    AuthenticationFailed,
    InvalidVersion,
    InvalidMessage,
    InvalidCall,
    ResourceLimit,
    UnknownViewSet,
    ConsumerBusy,
    ViewSetClosed,
    UnknownStream,
    InvalidCursor,
    ResponseTooLarge,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApplicationConnectionError {
    pub code: ApplicationConnectionErrorCode,
    pub message: String,
}

impl ApplicationConnectionError {
    fn new(code: ApplicationConnectionErrorCode, message: impl Into<String>) -> Self {
        let mut message = message.into();
        message.truncate(message.floor_char_boundary(1_024));
        Self { code, message }
    }
}

#[derive(Clone, Default)]
pub(crate) struct ApplicationConnectionRegistry {
    state: Arc<Mutex<RegistryState>>,
    next_generation: Arc<AtomicU64>,
}

#[derive(Default)]
struct RegistryState {
    connections: BTreeMap<String, RegistryConnection>,
    attachments: BTreeMap<String, RegistryAttachment>,
}

struct RegistryConnection {
    generation: u64,
    cancellation: CancellationToken,
    done: CancellationToken,
}

struct RegistryAttachment {
    owner: String,
    generation: u64,
    cancellation: CancellationToken,
    done: CancellationToken,
}

impl ApplicationConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(RegistryState::default())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    fn generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed)
    }

    async fn activate_connection(
        &self,
        owner: String,
        generation: u64,
        cancellation: CancellationToken,
        done: CancellationToken,
    ) -> bool {
        let previous = self.state.lock().await.connections.insert(
            owner,
            RegistryConnection {
                generation,
                cancellation,
                done,
            },
        );
        let takeover = previous.is_some();
        if let Some(previous) = previous {
            previous.cancellation.cancel();
            previous.done.cancelled().await;
        }
        takeover
    }

    async fn release_connection(&self, owner: &str, generation: u64) {
        let mut state = self.state.lock().await;
        if state
            .connections
            .get(owner)
            .is_some_and(|active| active.generation == generation)
        {
            state.connections.remove(owner);
        }
    }

    async fn claim_attachment(
        &self,
        owner: String,
        view_set_id: String,
        generation: u64,
        cancellation: CancellationToken,
        done: CancellationToken,
    ) -> Result<(), ApplicationConnectionError> {
        let previous = {
            let mut state = self.state.lock().await;
            if state
                .attachments
                .get(&view_set_id)
                .is_some_and(|active| active.owner != owner)
            {
                return Err(ApplicationConnectionError::new(
                    ApplicationConnectionErrorCode::ConsumerBusy,
                    "view set already has an active consumer",
                ));
            }
            state.attachments.insert(
                view_set_id,
                RegistryAttachment {
                    owner,
                    generation,
                    cancellation,
                    done,
                },
            )
        };
        if let Some(previous) = previous {
            previous.cancellation.cancel();
            previous.done.cancelled().await;
        }
        Ok(())
    }

    async fn release_attachment(&self, view_set_id: &str, generation: u64) {
        let mut state = self.state.lock().await;
        if state
            .attachments
            .get(view_set_id)
            .is_some_and(|active| active.generation == generation)
        {
            state.attachments.remove(view_set_id);
        }
    }
}

fn desktop_control_connection(state: &GatewayState) -> bool {
    state
        .hello_backend
        .as_ref()
        .is_some_and(|backend| backend.kind == "desktop")
}

pub(crate) fn application_hello(service: &ApplicationService) -> ApiHello {
    let mut hello = service.api_hello();
    if !hello.deliveries.contains(&DeliveryMode::Stream) {
        hello.deliveries.push(DeliveryMode::Stream);
    }
    hello
}

pub(crate) async fn upgrade_application_connection(
    State(state): State<GatewayState>,
    ConnectInfo(_peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if !origin
        .as_deref()
        .is_some_and(|origin| match state.authentication.as_ref() {
            GatewayAuthentication::ChromeOsCompanion(_) => {
                super::CompanionPairingOwner::origin_allowed(origin)
            }
            GatewayAuthentication::Bearer { .. } if desktop_control_connection(&state) => {
                super::CompanionPairingOwner::origin_allowed(origin)
            }
            _ => origin == state.allowed_origin.as_ref(),
        })
    {
        state.connection_metrics.rejected_origin();
        return StatusCode::FORBIDDEN.into_response();
    }
    let web_session_id = if matches!(state.authentication.as_ref(), GatewayAuthentication::Web(_)) {
        match super::web_auth_http::authenticate_application_request(&state, &headers) {
            Ok(session_id) => session_id,
            Err(_) => {
                state.connection_metrics.rejected_authentication();
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
    } else {
        None
    };
    let Ok(permit) = state.connections.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    websocket
        .max_message_size(MAX_TORRENT_SOURCE_BYTES)
        .max_frame_size(MAX_TORRENT_SOURCE_BYTES)
        .on_upgrade(move |socket| {
            serve_application_connection(
                socket,
                state,
                permit,
                web_session_id,
                origin.expect("validated origin"),
            )
        })
        .into_response()
}

struct OutboundFrame {
    frame: ApplicationServerFrame,
    _reservation: Option<OwnedSemaphorePermit>,
    queued_at: Instant,
}

enum WriterCommand {
    Frame(Box<OutboundFrame>),
    Transport(Message),
}

struct ConnectionAttachment {
    generation: u64,
    acknowledgements: mpsc::Sender<String>,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
}

struct PumpStopped {
    stream_id: String,
    generation: u64,
}

struct PendingTorrentUpload {
    call_id: String,
    request: AddTorrentBytesRequest,
    admitted_at: Instant,
    _permit: OwnedSemaphorePermit,
}

async fn serve_application_connection(
    socket: WebSocket,
    state: GatewayState,
    _permit: OwnedSemaphorePermit,
    web_session_id: Option<String>,
    origin: String,
) {
    let handshake_started = Instant::now();
    let (websocket_writer, mut websocket_reader) = socket.split();
    let connection_cancel = CancellationToken::new();
    let connection_done = CancellationToken::new();
    let (control, control_reader) = mpsc::channel(MAX_CONTROL_MESSAGES);
    let (data, data_reader) = mpsc::channel(MAX_ATTACHMENTS_PER_CONNECTION);
    let writer = tokio::spawn(run_writer(
        websocket_writer,
        control_reader,
        data_reader,
        connection_cancel.clone(),
        state.connection_metrics.clone(),
    ));

    let connected = match tokio::time::timeout(
        Duration::from_millis(HANDSHAKE_TIMEOUT_MILLIS),
        websocket_reader.next(),
    )
    .await
    {
        Ok(Some(Ok(Message::Text(text)))) if text.len() <= MAX_INCOMING_MESSAGE_BYTES => {
            serde_json::from_str::<ApplicationClientFrame>(&text)
                .ok()
                .map(|frame| (frame, text.len()))
        }
        _ => None,
    };
    let Some((
        ApplicationClientFrame::Connect {
            api_version,
            encoding,
            client_instance_id,
            token,
        },
        connect_bytes,
    )) = connected
    else {
        state.connection_metrics.rejected_handshake();
        fatal_connection(
            &control,
            ApplicationConnectionErrorCode::InvalidMessage,
            "connect must be the first application message",
            1002,
        )
        .await;
        finish_writer(control, data, writer).await;
        return;
    };
    state.connection_metrics.record_client_frame(
        &ApplicationClientFrame::Connect {
            api_version,
            encoding,
            client_instance_id: client_instance_id.clone(),
            token: None,
        },
        connect_bytes,
    );
    if api_version != API_VERSION || encoding != ApiEncoding::Json {
        state.connection_metrics.rejected_handshake();
        fatal_connection(
            &control,
            ApplicationConnectionErrorCode::InvalidVersion,
            "application connection version or encoding is unsupported",
            1008,
        )
        .await;
        finish_writer(control, data, writer).await;
        return;
    }
    let companion_lease = match state.authentication.as_ref() {
        GatewayAuthentication::ChromeOsCompanion(owner)
            if valid_client_instance_id(&client_instance_id) =>
        {
            token
                .as_deref()
                .and_then(|credential| owner.authenticate(&origin, &client_instance_id, credential))
        }
        _ => None,
    };
    let authentication_valid = match state.authentication.as_ref() {
        GatewayAuthentication::ChromeOsCompanion(_) => companion_lease.is_some(),
        authentication => {
            valid_client_instance_id(&client_instance_id)
                && connection_token_matches(authentication, token.as_deref())
        }
    };
    if !authentication_valid {
        state.connection_metrics.rejected_authentication();
        fatal_connection(
            &control,
            ApplicationConnectionErrorCode::AuthenticationFailed,
            "application connection authentication failed",
            1008,
        )
        .await;
        finish_writer(control, data, writer).await;
        return;
    }

    let owner_key = format!(
        "gateway-client-{}-{client_instance_id}",
        state.http_owner_namespace
    );
    let owner = ViewSetOwner::trusted(owner_key.clone());
    let connection_generation = state.connection_registry.generation();
    let takeover = state
        .connection_registry
        .activate_connection(
            owner_key.clone(),
            connection_generation,
            connection_cancel.clone(),
            connection_done.clone(),
        )
        .await;
    state
        .connection_metrics
        .accepted(takeover, handshake_started.elapsed());
    let mut hello = {
        let service = state.service.lock().await;
        application_hello(&service)
    };
    hello.backend = state.hello_backend.clone();
    if matches!(
        state.authentication.as_ref(),
        GatewayAuthentication::ChromeOsCompanion(_)
    ) || desktop_control_connection(&state)
    {
        hello
            .capabilities
            .retain(|capability| capability != "torrent_media" && capability != "library_media");
    }
    if send_control(
        &control,
        ApplicationServerFrame::Connected {
            api_version: API_VERSION,
            encoding: ApiEncoding::Json,
            hello: Box::new(hello),
            connection_limits: ApplicationConnectionLimits::default(),
        },
        None,
    )
    .await
    .is_err()
    {
        connection_cancel.cancel();
    }

    let reservations = Arc::new(Semaphore::new(DATA_RESERVATIONS));
    let pending_ids = Arc::new(StdMutex::new(BTreeSet::<String>::new()));
    let mut calls = JoinSet::new();
    let mut removal_calls = JoinSet::new();
    let mut uploads = JoinSet::new();
    let mut attachments = BTreeMap::<String, ConnectionAttachment>::new();
    let (pump_stopped, mut stopped_pumps) =
        mpsc::channel::<PumpStopped>(MAX_ATTACHMENTS_PER_CONNECTION);
    let mut invalid_messages = 0_u8;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(1));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_client_activity = Instant::now();
    let mut outstanding_ping: Option<(Vec<u8>, Instant)> = None;
    let mut pending_upload: Option<PendingTorrentUpload> = None;
    let mut service_shutdown = false;
    let companion_revoked = companion_lease
        .as_ref()
        .map(|lease| lease.cancellation().clone())
        .unwrap_or_default();

    loop {
        tokio::select! {
            biased;
            () = state.gateway_shutdown.cancelled() => {
                service_shutdown = true;
                break;
            }
            () = companion_revoked.cancelled(), if companion_lease.is_some() => break,
            () = connection_cancel.cancelled() => break,
            _ = heartbeat.tick() => {
                if web_session_id.as_deref().is_some_and(|session_id| {
                    !super::web_auth_http::session_is_active(&state, session_id)
                }) {
                    fatal_connection(
                        &control,
                        ApplicationConnectionErrorCode::AuthenticationFailed,
                        "browser session was revoked or expired",
                        1008,
                    ).await;
                    break;
                }
                if pending_upload.as_ref().is_some_and(|upload| {
                    upload.admitted_at.elapsed()
                        >= Duration::from_millis(TORRENT_UPLOAD_TIMEOUT_MILLIS)
                }) && let Some(expired) = pending_upload.take()
                {
                    remove_pending(&pending_ids, &expired.call_id);
                    send_call_error(
                        &control,
                        expired.call_id,
                        ApplicationConnectionErrorCode::InvalidCall,
                        "torrent upload body timed out",
                    ).await;
                }
                if let Some((_, sent)) = &outstanding_ping {
                    if sent.elapsed() >= Duration::from_millis(HEARTBEAT_TIMEOUT_MILLIS) {
                        state
                            .connection_metrics
                            .inner
                            .heartbeat_timeouts
                            .fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                } else if last_client_activity.elapsed()
                    >= Duration::from_millis(HEARTBEAT_IDLE_MILLIS)
                {
                    let nonce = connection_generation.to_be_bytes().to_vec();
                    if control.send(WriterCommand::Transport(Message::Ping(nonce.clone().into())))
                        .await.is_err()
                    {
                        break;
                    }
                    state
                        .connection_metrics
                        .inner
                        .pings
                        .fetch_add(1, Ordering::Relaxed);
                    outstanding_ping = Some((nonce, Instant::now()));
                }
            }
            stopped = stopped_pumps.recv() => {
                if let Some(stopped) = stopped
                    && attachments
                        .get(&stopped.stream_id)
                        .is_some_and(|active| active.generation == stopped.generation)
                    && let Some(active) = attachments.remove(&stopped.stream_id)
                {
                    let _ = active.task.await;
                }
            }
            joined = calls.join_next(), if !calls.is_empty() => {
                if joined.is_some_and(|result| result.is_err()) {
                    break;
                }
            }
            joined = removal_calls.join_next(), if !removal_calls.is_empty() => {
                if joined.is_some_and(|result| result.is_err()) {
                    break;
                }
            }
            joined = uploads.join_next(), if !uploads.is_empty() => {
                if joined.is_some_and(|result| result.is_err()) {
                    break;
                }
            }
            incoming = websocket_reader.next() => {
                let Some(incoming) = incoming else { break; };
                let message = match incoming {
                    Ok(message) => message,
                    Err(_) => break,
                };
                last_client_activity = Instant::now();
                match message {
                    Message::Pong(payload) => {
                        if outstanding_ping
                            .as_ref()
                            .is_some_and(|(expected, _)| expected.as_slice() == payload.as_ref())
                        {
                            outstanding_ping = None;
                            state
                                .connection_metrics
                                .inner
                                .pongs
                                .fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Message::Ping(payload) => {
                        if control.send(WriterCommand::Transport(Message::Pong(payload)))
                            .await.is_err()
                        {
                            break;
                        }
                    }
                    Message::Close(frame) => {
                        let _ = control.send(WriterCommand::Transport(Message::Close(frame))).await;
                        break;
                    }
                    Message::Text(text) if text.len() <= MAX_INCOMING_MESSAGE_BYTES => {
                        let parsed = serde_json::from_str::<ApplicationClientFrame>(&text);
                        let Ok(frame) = parsed else {
                            if let Some(call_id) = unsupported_call_id(&text)
                                .filter(|call_id| !pending_contains(&pending_ids, call_id))
                            {
                                send_call_error(
                                    &control,
                                    call_id,
                                    ApplicationConnectionErrorCode::InvalidCall,
                                    UNSUPPORTED_CALL_MESSAGE,
                                ).await;
                                continue;
                            }
                            invalid_messages = invalid_messages.saturating_add(1);
                            if invalid_messages >= MAX_INVALID_MESSAGES {
                                fatal_connection(
                                    &control,
                                    ApplicationConnectionErrorCode::InvalidMessage,
                                    "too many invalid application messages",
                                    1002,
                                ).await;
                                break;
                            }
                            let _ = send_control(
                                &control,
                                ApplicationServerFrame::ConnectionError {
                                    error: ApplicationConnectionError::new(
                                        ApplicationConnectionErrorCode::InvalidMessage,
                                        "application message is invalid",
                                    ),
                                },
                                None,
                            ).await;
                            continue;
                        };
                        state
                            .connection_metrics
                            .record_client_frame(&frame, text.len());
                        if matches!(frame, ApplicationClientFrame::Connect { .. }) {
                            invalid_messages = invalid_messages.saturating_add(1);
                            if invalid_messages >= MAX_INVALID_MESSAGES {
                                fatal_connection(
                                    &control,
                                    ApplicationConnectionErrorCode::InvalidMessage,
                                    "connect cannot be repeated",
                                    1002,
                                ).await;
                                break;
                            }
                            continue;
                        }
                        if let ApplicationClientFrame::BeginTorrentUpload {
                            call_id,
                            upload_id,
                            request,
                        } = frame
                        {
                            if !valid_identifier(&call_id)
                                || !valid_identifier(&upload_id)
                                || validate_add_torrent_bytes_request(&request).is_err()
                            {
                                send_call_error(
                                    &control,
                                    call_id,
                                    ApplicationConnectionErrorCode::InvalidCall,
                                    "torrent upload declaration is invalid",
                                ).await;
                                continue;
                            }
                            if pending_upload.is_some() {
                                send_call_error(
                                    &control,
                                    call_id,
                                    ApplicationConnectionErrorCode::ResourceLimit,
                                    "connection already has a pending torrent upload",
                                ).await;
                                continue;
                            }
                            let root_available = state
                                .service
                                .lock()
                                .await
                                .storage_snapshot()
                                .ok()
                                .is_some_and(|snapshot| {
                                    snapshot.roots.iter().any(|root| {
                                        root.root_id == request.storage_root
                                            && root.availability
                                                == rstorrent_session::StorageRootAvailability::Available
                                    }) && (!matches!(
                                        state.authentication.as_ref(),
                                        GatewayAuthentication::ChromeOsCompanion(_)
                                    ) || snapshot.default_root.as_deref()
                                        == Some(request.storage_root.as_str()))
                                });
                            if !root_available {
                                send_call_error(
                                    &control,
                                    call_id,
                                    ApplicationConnectionErrorCode::InvalidCall,
                                    "torrent upload storage root is unavailable",
                                ).await;
                                continue;
                            }
                            if !insert_pending(&pending_ids, &call_id) {
                                send_call_error(
                                    &control,
                                    call_id,
                                    ApplicationConnectionErrorCode::ResourceLimit,
                                    "call ID is pending or the pending call limit was reached",
                                ).await;
                                continue;
                            }
                            let permit = match state.torrent_uploads.clone().try_acquire_owned() {
                                Ok(permit) => permit,
                                Err(_) => {
                                    remove_pending(&pending_ids, &call_id);
                                    send_call_error(
                                        &control,
                                        call_id,
                                        ApplicationConnectionErrorCode::ResourceLimit,
                                        "another torrent upload is already in progress",
                                    ).await;
                                    continue;
                                }
                            };
                            if send_control(
                                &control,
                                ApplicationServerFrame::TorrentUploadReady {
                                    call_id: call_id.clone(),
                                    upload_id: upload_id.clone(),
                                },
                                None,
                            ).await.is_err()
                            {
                                remove_pending(&pending_ids, &call_id);
                                break;
                            }
                            pending_upload = Some(PendingTorrentUpload {
                                call_id,
                                request,
                                admitted_at: Instant::now(),
                                _permit: permit,
                            });
                            state
                                .connection_metrics
                                .observe_pending(pending_len(&pending_ids));
                            continue;
                        }
                        handle_client_frame(
                            frame,
                            &state,
                            &owner,
                            &owner_key,
                            &control,
                            &data,
                            &reservations,
                            &pending_ids,
                            &mut calls,
                            &mut removal_calls,
                            &mut attachments,
                            &pump_stopped,
                            &connection_cancel,
                        ).await;
                    }
                    Message::Binary(bytes) if bytes.len() <= MAX_TORRENT_SOURCE_BYTES => {
                        let Some(upload) = pending_upload.take() else {
                            fatal_connection(
                                &control,
                                ApplicationConnectionErrorCode::InvalidMessage,
                                "binary data requires one ready torrent upload",
                                1002,
                            ).await;
                            break;
                        };
                        if bytes.len() != upload.request.source_length as usize {
                            remove_pending(&pending_ids, &upload.call_id);
                            send_call_error(
                                &control,
                                upload.call_id,
                                ApplicationConnectionErrorCode::InvalidCall,
                                "torrent upload body length does not match its declaration",
                            ).await;
                            continue;
                        }
                        let source: Vec<u8> = bytes.into();
                        let service = state.service.clone();
                        let control = control.clone();
                        let reservations = reservations.clone();
                        let pending_ids = pending_ids.clone();
                        let metrics = state.connection_metrics.clone();
                        uploads.spawn(async move {
                            let PendingTorrentUpload {
                                call_id,
                                request,
                                _permit: permit,
                                ..
                            } = upload;
                            let request_id = request.request_id.clone();
                            let reservation_started = Instant::now();
                            let reservation = reservations.acquire_owned().await.ok();
                            metrics.reservation_wait(reservation_started.elapsed());
                            let mut application = service.lock().await;
                            let response = match application
                                .add_torrent_bytes(request, source)
                                .await
                            {
                                Ok(response) => response,
                                Err(error) => application_error_response(
                                    request_id,
                                    application.revision().unwrap_or_default(),
                                    &error,
                                ),
                            };
                            let result = ApplicationCallResult::CommandResponse {
                                response: Box::new(response),
                            };
                            let frame = if semantic_size(&result).is_some() {
                                ApplicationServerFrame::Result {
                                    call_id: call_id.clone(),
                                    result,
                                }
                            } else {
                                ApplicationServerFrame::CallError {
                                    call_id: call_id.clone(),
                                    error: ApplicationConnectionError::new(
                                        ApplicationConnectionErrorCode::ResponseTooLarge,
                                        "application call result exceeds its configured bound",
                                    ),
                                }
                            };
                            let _ = send_control(&control, frame, reservation).await;
                            remove_pending(&pending_ids, &call_id);
                            drop(permit);
                        });
                    }
                    Message::Text(_) | Message::Binary(_) => {
                        fatal_connection(
                            &control,
                            ApplicationConnectionErrorCode::InvalidMessage,
                            "application message exceeds its bound or is not text",
                            1009,
                        ).await;
                        break;
                    }
                }
            }
        }
    }

    connection_cancel.cancel();
    for (_, active) in attachments {
        stop_attachment(active).await;
    }
    calls.abort_all();
    while calls.join_next().await.is_some() {}
    // An executing removal has persisted intent and may already have deleted
    // payload. Retain its owner through finalization even without a response
    // consumer. The connection permit bounds this work until it is joined.
    while removal_calls.join_next().await.is_some() {}
    while uploads.join_next().await.is_some() {}
    // Desktop companion pages rebuild their views on attachment. A departed
    // page cannot resume them, including sets whose open response was lost.
    // Finish before connection_done permits a same-client replacement to open
    // its sets. Headless/remote and ChromeOS retain their resumable leases.
    if desktop_control_connection(&state) {
        state.service.lock().await.close_owner_view_sets(&owner);
    }
    state
        .connection_registry
        .release_connection(&owner_key, connection_generation)
        .await;
    state.connection_metrics.connection_closed();
    connection_done.cancel();
    let (code, reason) = if service_shutdown {
        (1001, "service shutdown")
    } else {
        (1000, "application connection closed")
    };
    let _ = control
        .send(WriterCommand::Transport(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))))
        .await;
    finish_writer(control, data, writer).await;
}

async fn choose_desktop_root(
    state: &GatewayState,
    request: super::ChooseDownloadRootRequest,
    cancellation: &CancellationToken,
) -> Result<Option<rstorrent_session::StorageRootSnapshot>, String> {
    let starting = state
        .service
        .lock()
        .await
        .suggested_storage_root_path(request.repair_root.as_deref())
        .map_err(|error| error.to_string())?
        .or_else(super::home_directory)
        .ok_or("no usable folder-picker starting directory is available")?;
    let selected = state
        .download_directory_picker
        .choose(&starting)
        .await
        .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut service = state.service.lock().await;
    if cancellation.is_cancelled() || state.gateway_shutdown.is_cancelled() {
        return Err("folder request owner closed".into());
    }
    if let Some(root) = request.repair_root.as_deref() {
        service.repair_path_storage_root(root, &selected)
    } else {
        service.install_path_storage_root(&selected)
    }
    .map(Some)
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
async fn handle_client_frame(
    frame: ApplicationClientFrame,
    state: &GatewayState,
    owner: &ViewSetOwner,
    owner_key: &str,
    control: &mpsc::Sender<WriterCommand>,
    data: &mpsc::Sender<OutboundFrame>,
    reservations: &Arc<Semaphore>,
    pending_ids: &Arc<StdMutex<BTreeSet<String>>>,
    calls: &mut JoinSet<()>,
    removal_calls: &mut JoinSet<()>,
    attachments: &mut BTreeMap<String, ConnectionAttachment>,
    pump_stopped: &mpsc::Sender<PumpStopped>,
    connection_cancel: &CancellationToken,
) {
    match frame {
        ApplicationClientFrame::ChooseDownloadRoot { call_id, request } => {
            let supported = state.hello_backend.as_ref().is_some_and(|backend| {
                backend.kind == "desktop"
                    && backend
                        .capability_profile
                        .iter()
                        .any(|c| c == "desktop_root_picker_v1")
            });
            if !supported
                || !valid_identifier(&call_id)
                || request
                    .repair_root
                    .as_ref()
                    .is_some_and(|id| id.len() > 128)
            {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "native folder acquisition is unavailable or invalid",
                )
                .await;
                return;
            }
            if !insert_pending(pending_ids, &call_id) {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::ResourceLimit,
                    "call ID is pending or the pending call limit was reached",
                )
                .await;
                return;
            }
            let state = state.clone();
            let control = control.clone();
            let pending_ids = pending_ids.clone();
            let cancellation = connection_cancel.clone();
            calls.spawn(async move {
                let result = choose_desktop_root(&state, request, &cancellation).await;
                let frame = match result {
                    Ok(root) => ApplicationServerFrame::DownloadRootChosen {
                        call_id: call_id.clone(),
                        response: super::ChooseDownloadRootResponse { root },
                    },
                    Err(message) => ApplicationServerFrame::CallError {
                        call_id: call_id.clone(),
                        error: ApplicationConnectionError::new(
                            ApplicationConnectionErrorCode::InvalidCall,
                            message,
                        ),
                    },
                };
                let _ = send_control(&control, frame, None).await;
                remove_pending(&pending_ids, &call_id);
            });
        }
        ApplicationClientFrame::Call { call_id, operation } => {
            if !valid_identifier(&call_id) {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "call ID is invalid",
                )
                .await;
                return;
            }
            if !valid_application_call(&operation) {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "application call contains an invalid view-set ID",
                )
                .await;
                return;
            }
            if matches!(operation, ApplicationCall::CreateMediaUrl { .. })
                && (matches!(
                    state.authentication.as_ref(),
                    GatewayAuthentication::ChromeOsCompanion(_)
                ) || desktop_control_connection(state))
            {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "media capabilities are unavailable on this companion connection",
                )
                .await;
                return;
            }
            if matches!(
                state.authentication.as_ref(),
                GatewayAuthentication::ChromeOsCompanion(_)
            ) && let ApplicationCall::Dispatch { request } = &operation
                && let Command::AddMagnet { storage_root, .. } = &request.command
            {
                let current = state
                    .service
                    .lock()
                    .await
                    .storage_snapshot()
                    .ok()
                    .and_then(|snapshot| snapshot.default_root);
                if current.as_deref() != Some(storage_root) {
                    send_call_error(
                        control,
                        call_id,
                        ApplicationConnectionErrorCode::InvalidCall,
                        "Android companion adds must use the current download root",
                    )
                    .await;
                    return;
                }
            }
            if !insert_pending(pending_ids, &call_id) {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::ResourceLimit,
                    "call ID is pending or the pending call limit was reached",
                )
                .await;
                return;
            }
            state
                .connection_metrics
                .observe_pending(pending_len(pending_ids));
            let service = state.service.clone();
            let owner = owner.clone();
            let control = control.clone();
            let reservations = reservations.clone();
            let pending_ids = pending_ids.clone();
            let metrics = state.connection_metrics.clone();
            let media_origin = state.media_origin.clone();
            let joined_removal =
                state
                    .companion_platform
                    .clone()
                    .and_then(|platform| match &operation {
                        ApplicationCall::Dispatch { request }
                            if matches!(&request.command, Command::RemoveStorageRoot { .. }) =>
                        {
                            Some((
                                platform,
                                request.as_ref().clone(),
                                connection_cancel.clone(),
                            ))
                        }
                        _ => None,
                    });
            let removal = matches!(
                &operation,
                ApplicationCall::Dispatch { request }
                    if matches!(request.command,
                        Command::RemoveTorrent { .. } | Command::CancelPendingAdd { .. })
            );
            let cancellation = connection_cancel.clone();
            let call = async move {
                let reservation_started = Instant::now();
                let reservation = tokio::select! {
                    biased;
                    () = cancellation.cancelled() => {
                        remove_pending(&pending_ids, &call_id);
                        return;
                    }
                    reservation = reservations.acquire_owned() => reservation.ok(),
                };
                metrics.reservation_wait(reservation_started.elapsed());
                let result = if let Some((platform, request, cancellation)) = joined_removal {
                    platform
                        .request_removal(request, cancellation)
                        .await
                        .map(|response| ApplicationCallResult::CommandResponse {
                            response: Box::new(response),
                        })
                        .map_err(companion_platform_call_error)
                } else {
                    let mut service = tokio::select! {
                        biased;
                        () = cancellation.cancelled() => {
                            remove_pending(&pending_ids, &call_id);
                            return;
                        }
                        service = service.lock() => service,
                    };
                    service
                        .application_call(&owner, operation)
                        .await
                        .map_err(application_call_error)
                };
                let frame = match result {
                    Ok(mut result) => {
                        let media_origin_result = match &mut result {
                            ApplicationCallResult::MediaUrl { response } => {
                                apply_gateway_media_origin(response, &media_origin)
                            }
                            _ => Ok(()),
                        };
                        if media_origin_result.is_err() {
                            ApplicationServerFrame::CallError {
                                call_id: call_id.clone(),
                                error: ApplicationConnectionError::new(
                                    ApplicationConnectionErrorCode::Internal,
                                    "application returned a malformed media capability URL",
                                ),
                            }
                        } else if semantic_size(&result).is_some() {
                            ApplicationServerFrame::Result {
                                call_id: call_id.clone(),
                                result,
                            }
                        } else {
                            ApplicationServerFrame::CallError {
                                call_id: call_id.clone(),
                                error: ApplicationConnectionError::new(
                                    ApplicationConnectionErrorCode::ResponseTooLarge,
                                    "application call result exceeds its configured bound",
                                ),
                            }
                        }
                    }
                    Err(error) => ApplicationServerFrame::CallError {
                        call_id: call_id.clone(),
                        error,
                    },
                };
                tokio::select! {
                    biased;
                    () = cancellation.cancelled() => {}
                    _ = send_control(&control, frame, reservation) => {}
                }
                remove_pending(&pending_ids, &call_id);
            };
            if removal {
                removal_calls.spawn(call);
            } else {
                calls.spawn(call);
            }
        }
        ApplicationClientFrame::Attach {
            call_id,
            stream_id,
            view_set_id,
            after,
        } => {
            if !valid_identifier(&call_id)
                || !valid_identifier(&stream_id)
                || !valid_view_set_id(&view_set_id)
                || !valid_cursor(&after)
            {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "view attachment identifiers or cursor are invalid",
                )
                .await;
                return;
            }
            if attachments.contains_key(&stream_id) || !insert_pending(pending_ids, &call_id) {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::ResourceLimit,
                    "stream or call ID is pending",
                )
                .await;
                return;
            }
            state
                .connection_metrics
                .observe_pending(pending_len(pending_ids));
            if attachments.len() >= MAX_ATTACHMENTS_PER_CONNECTION {
                remove_pending(pending_ids, &call_id);
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::ResourceLimit,
                    "connection attachment limit reached",
                )
                .await;
                return;
            }
            let view_set = state.service.lock().await.view_set(owner, &view_set_id);
            let view_set = match view_set {
                Ok(view_set) => view_set,
                Err(error) => {
                    remove_pending(pending_ids, &call_id);
                    let error = view_set_connection_error(error);
                    let _ = send_control(
                        control,
                        ApplicationServerFrame::CallError { call_id, error },
                        None,
                    )
                    .await;
                    return;
                }
            };
            let generation = state.connection_registry.generation();
            let cancellation = connection_cancel.child_token();
            let done = CancellationToken::new();
            if let Err(error) = state
                .connection_registry
                .claim_attachment(
                    owner_key.to_owned(),
                    view_set_id.clone(),
                    generation,
                    cancellation.clone(),
                    done.clone(),
                )
                .await
            {
                remove_pending(pending_ids, &call_id);
                let _ = send_control(
                    control,
                    ApplicationServerFrame::CallError { call_id, error },
                    None,
                )
                .await;
                return;
            }
            if send_control(
                control,
                ApplicationServerFrame::Attached {
                    call_id: call_id.clone(),
                    stream_id: stream_id.clone(),
                    view_set_id: view_set_id.clone(),
                },
                None,
            )
            .await
            .is_err()
            {
                cancellation.cancel();
            }
            remove_pending(pending_ids, &call_id);
            let (acknowledgements, acknowledgement_receiver) = mpsc::channel(1);
            let task = tokio::spawn(run_attachment(
                AcknowledgedViewStream::new(view_set, after),
                stream_id.clone(),
                generation,
                cancellation.clone(),
                done,
                acknowledgement_receiver,
                control.clone(),
                data.clone(),
                reservations.clone(),
                state.connection_registry.clone(),
                state.connection_metrics.clone(),
                pump_stopped.clone(),
            ));
            if let Some(replaced) = attachments.insert(
                stream_id,
                ConnectionAttachment {
                    generation,
                    acknowledgements,
                    cancellation,
                    task,
                },
            ) {
                stop_attachment(replaced).await;
            }
            state
                .connection_metrics
                .observe_attachments(attachments.len());
        }
        ApplicationClientFrame::Ack { stream_id, cursor } => {
            if !valid_identifier(&stream_id) || !valid_cursor(&cursor) {
                send_stream_error(
                    control,
                    stream_id,
                    ApplicationConnectionErrorCode::InvalidCursor,
                    "stream ID or cursor is invalid",
                )
                .await;
                return;
            }
            let Some(active) = attachments.get(&stream_id) else {
                send_stream_error(
                    control,
                    stream_id,
                    ApplicationConnectionErrorCode::UnknownStream,
                    "view stream is unavailable",
                )
                .await;
                return;
            };
            if active.acknowledgements.try_send(cursor).is_err() {
                active.cancellation.cancel();
                send_stream_error(
                    control,
                    stream_id,
                    ApplicationConnectionErrorCode::InvalidCursor,
                    "view stream already has a pending acknowledgement",
                )
                .await;
            }
        }
        ApplicationClientFrame::Detach { call_id, stream_id } => {
            if !valid_identifier(&call_id)
                || !valid_identifier(&stream_id)
                || !insert_pending(pending_ids, &call_id)
            {
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::InvalidCall,
                    "detach call or stream ID is invalid or pending",
                )
                .await;
                return;
            }
            state
                .connection_metrics
                .observe_pending(pending_len(pending_ids));
            let Some(active) = attachments.remove(&stream_id) else {
                remove_pending(pending_ids, &call_id);
                send_call_error(
                    control,
                    call_id,
                    ApplicationConnectionErrorCode::UnknownStream,
                    "view stream is unavailable",
                )
                .await;
                return;
            };
            stop_attachment(active).await;
            remove_pending(pending_ids, &call_id);
            let _ = send_control(
                control,
                ApplicationServerFrame::Detached { call_id, stream_id },
                None,
            )
            .await;
        }
        ApplicationClientFrame::Connect { .. }
        | ApplicationClientFrame::BeginTorrentUpload { .. } => {
            unreachable!("connection setup and torrent upload begin are handled before routing")
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_attachment(
    mut stream: AcknowledgedViewStream,
    stream_id: String,
    generation: u64,
    cancellation: CancellationToken,
    done: CancellationToken,
    mut acknowledgements: mpsc::Receiver<String>,
    control: mpsc::Sender<WriterCommand>,
    data: mpsc::Sender<OutboundFrame>,
    reservations: Arc<Semaphore>,
    registry: ApplicationConnectionRegistry,
    metrics: ApplicationConnectionMetrics,
    stopped: mpsc::Sender<PumpStopped>,
) {
    let view_set_id = stream.view_set_id().to_owned();
    loop {
        let reservation_started = Instant::now();
        let reservation = tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            reservation = reservations.clone().acquire_owned() => {
                let Ok(reservation) = reservation else { break; };
                reservation
            }
        };
        metrics.reservation_wait(reservation_started.elapsed());
        let batch = tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            batch = stream.next_batch(VIEW_STREAM_WAIT_MILLIS) => {
                match batch {
                    Ok(batch) => batch,
                    Err(error) => {
                        let _ = send_control(
                            &control,
                            ApplicationServerFrame::StreamError {
                                stream_id: stream_id.clone(),
                                error: acknowledged_stream_error(error),
                            },
                            None,
                        ).await;
                        break;
                    }
                }
            }
        };
        if semantic_size(&batch).is_none() {
            let _ = send_stream_error(
                &control,
                stream_id.clone(),
                ApplicationConnectionErrorCode::ResponseTooLarge,
                "view batch exceeds its configured bound",
            )
            .await;
            break;
        }
        let outgoing = OutboundFrame {
            frame: ApplicationServerFrame::ViewBatch {
                stream_id: stream_id.clone(),
                batch: Box::new(batch),
            },
            _reservation: Some(reservation),
            queued_at: Instant::now(),
        };
        let sent = tokio::select! {
            biased;
            () = cancellation.cancelled() => false,
            result = data.send(outgoing) => result.is_ok(),
        };
        if !sent {
            break;
        }
        let acknowledgement = tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            acknowledgement = acknowledgements.recv() => acknowledgement,
        };
        let Some(acknowledgement) = acknowledgement else {
            break;
        };
        if let Err(error) = stream.acknowledge(&acknowledgement) {
            let _ = send_control(
                &control,
                ApplicationServerFrame::StreamError {
                    stream_id: stream_id.clone(),
                    error: acknowledged_stream_error(error),
                },
                None,
            )
            .await;
            break;
        }
    }
    registry.release_attachment(&view_set_id, generation).await;
    done.cancel();
    let _ = stopped.try_send(PumpStopped {
        stream_id,
        generation,
    });
}

async fn stop_attachment(active: ConnectionAttachment) {
    active.cancellation.cancel();
    drop(active.acknowledgements);
    let _ = active.task.await;
}

async fn run_writer(
    mut websocket: futures_util::stream::SplitSink<WebSocket, Message>,
    mut control: mpsc::Receiver<WriterCommand>,
    mut data: mpsc::Receiver<OutboundFrame>,
    cancellation: CancellationToken,
    metrics: ApplicationConnectionMetrics,
) {
    loop {
        metrics.observe_outbound_items(control.len().saturating_add(data.len()));
        let command = match control.try_recv() {
            Ok(command) => Some(command),
            Err(mpsc::error::TryRecvError::Empty) => tokio::select! {
                biased;
                command = control.recv() => command,
                frame = data.recv() => frame.map(|frame| WriterCommand::Frame(Box::new(frame))),
            },
            Err(mpsc::error::TryRecvError::Disconnected) => data
                .recv()
                .await
                .map(|frame| WriterCommand::Frame(Box::new(frame))),
        };
        let Some(command) = command else {
            break;
        };
        metrics.observe_outbound_items(
            1_usize.saturating_add(control.len().saturating_add(data.len())),
        );
        let (message, queued_at) = match command {
            WriterCommand::Frame(outgoing) => {
                let encoded = match serde_json::to_string(&outgoing.frame) {
                    Ok(encoded) if encoded.len() <= MAX_SERVER_MESSAGE_BYTES => {
                        metrics.record_server_frame(&outgoing.frame, encoded.len());
                        encoded
                    }
                    _ => break,
                };
                (Message::Text(encoded.into()), Some(outgoing.queued_at))
            }
            WriterCommand::Transport(message) => (message, None),
        };
        let closing = matches!(message, Message::Close(_));
        if websocket.send(message).await.is_err() || closing {
            break;
        }
        if let Some(queued_at) = queued_at {
            metrics.delivered(queued_at.elapsed());
        }
    }
    cancellation.cancel();
    let _ = websocket.close().await;
}

async fn finish_writer(
    control: mpsc::Sender<WriterCommand>,
    data: mpsc::Sender<OutboundFrame>,
    writer: JoinHandle<()>,
) {
    drop(control);
    drop(data);
    let _ = writer.await;
}

async fn send_control(
    outgoing: &mpsc::Sender<WriterCommand>,
    frame: ApplicationServerFrame,
    reservation: Option<OwnedSemaphorePermit>,
) -> Result<(), ()> {
    outgoing
        .send(WriterCommand::Frame(Box::new(OutboundFrame {
            frame,
            _reservation: reservation,
            queued_at: Instant::now(),
        })))
        .await
        .map_err(|_| ())
}

async fn fatal_connection(
    outgoing: &mpsc::Sender<WriterCommand>,
    code: ApplicationConnectionErrorCode,
    message: &str,
    close_code: u16,
) {
    let _ = send_control(
        outgoing,
        ApplicationServerFrame::ConnectionError {
            error: ApplicationConnectionError::new(code, message),
        },
        None,
    )
    .await;
    let _ = outgoing
        .send(WriterCommand::Transport(Message::Close(Some(CloseFrame {
            code: close_code,
            reason: "application connection rejected".into(),
        }))))
        .await;
}

async fn send_call_error(
    outgoing: &mpsc::Sender<WriterCommand>,
    call_id: String,
    code: ApplicationConnectionErrorCode,
    message: &str,
) {
    let _ = send_control(
        outgoing,
        ApplicationServerFrame::CallError {
            call_id,
            error: ApplicationConnectionError::new(code, message),
        },
        None,
    )
    .await;
}

async fn send_stream_error(
    outgoing: &mpsc::Sender<WriterCommand>,
    stream_id: String,
    code: ApplicationConnectionErrorCode,
    message: &str,
) {
    let _ = send_control(
        outgoing,
        ApplicationServerFrame::StreamError {
            stream_id,
            error: ApplicationConnectionError::new(code, message),
        },
        None,
    )
    .await;
}

fn insert_pending(pending: &StdMutex<BTreeSet<String>>, call_id: &str) -> bool {
    let mut pending = pending.lock().expect("pending call lock poisoned");
    if pending.len() >= MAX_PENDING_CALLS || pending.contains(call_id) {
        return false;
    }
    pending.insert(call_id.to_owned());
    true
}

fn pending_contains(pending: &StdMutex<BTreeSet<String>>, call_id: &str) -> bool {
    pending
        .lock()
        .expect("pending call lock poisoned")
        .contains(call_id)
}

/// Sent for a call this host cannot parse, typically a command or settings
/// key from a newer client. See docs/topics/mixed-version-compatibility.md.
pub const UNSUPPORTED_CALL_MESSAGE: &str =
    "this JSTorrent version does not support this request; update it to use this feature";

/// The call an unparseable frame belongs to. A newer client may send a
/// command, settings key or frame this host predates; answering that call
/// keeps the connection, where a protocol error would close it. Frames
/// without a well-formed call ID, and `connect`, remain protocol errors.
pub fn unsupported_call_id(text: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(text).ok()?;
    let frame = value.as_object()?;
    if frame.get("type")?.as_str()? == "connect" {
        return None;
    }
    let call_id = frame.get("call_id")?.as_str()?;
    valid_identifier(call_id).then(|| call_id.to_owned())
}

fn remove_pending(pending: &StdMutex<BTreeSet<String>>, call_id: &str) {
    pending
        .lock()
        .expect("pending call lock poisoned")
        .remove(call_id);
}

fn pending_len(pending: &StdMutex<BTreeSet<String>>) -> usize {
    pending.lock().expect("pending call lock poisoned").len()
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_client_instance_id(value: &str) -> bool {
    value.len() == CLIENT_INSTANCE_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_cursor(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 20
        && (value.len() == 1 || !value.starts_with('0'))
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_torrent_id(value: &str) -> bool {
    value.len() == 35
        && value.starts_with("t1-")
        && value[3..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_application_call(call: &ApplicationCall) -> bool {
    match call {
        ApplicationCall::UpdateViewSet { view_set_id, .. }
        | ApplicationCall::CloseViewSet { view_set_id } => valid_view_set_id(view_set_id),
        ApplicationCall::CreateMediaUrl {
            torrent_id,
            file_index: _,
        } => valid_torrent_id(torrent_id),
        ApplicationCall::Dispatch { .. } | ApplicationCall::OpenViewSet { .. } => true,
    }
}

fn connection_token_matches(
    authentication: &GatewayAuthentication,
    candidate: Option<&str>,
) -> bool {
    match authentication {
        GatewayAuthentication::Bearer { token } => candidate.is_some_and(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= MAX_TOKEN_BYTES
                && constant_time_equal(candidate.as_bytes(), token.as_bytes())
        }),
        GatewayAuthentication::Basic(_)
        | GatewayAuthentication::PrivateLanNone
        | GatewayAuthentication::TailscaleServeNone
        | GatewayAuthentication::Web(_)
        | GatewayAuthentication::UnauthenticatedLoopbackDevelopment => candidate.is_none(),
        GatewayAuthentication::ChromeOsCompanion(_) => false,
    }
}

fn semantic_size<T: Serialize>(value: &T) -> Option<usize> {
    serde_json::to_vec(value)
        .ok()
        .map(|encoded| encoded.len())
        .filter(|length| *length <= MAX_APPLICATION_PAYLOAD_BYTES)
}

fn application_call_error(error: ApplicationCallError) -> ApplicationConnectionError {
    match error {
        ApplicationCallError::ViewSet(error) => view_set_connection_error(error),
        ApplicationCallError::Application(_) => ApplicationConnectionError::new(
            ApplicationConnectionErrorCode::Internal,
            "application call failed",
        ),
    }
}

fn companion_platform_call_error(
    error: super::CompanionPlatformError,
) -> ApplicationConnectionError {
    let code = match error {
        super::CompanionPlatformError::Busy => ApplicationConnectionErrorCode::ResourceLimit,
        super::CompanionPlatformError::Revoked => {
            ApplicationConnectionErrorCode::AuthenticationFailed
        }
        super::CompanionPlatformError::Expired => ApplicationConnectionErrorCode::InvalidCall,
        super::CompanionPlatformError::Closed
        | super::CompanionPlatformError::Failure(_)
        | super::CompanionPlatformError::Random(_) => ApplicationConnectionErrorCode::Internal,
    };
    ApplicationConnectionError::new(code, "Android root removal did not complete")
}

fn view_set_connection_error(error: ViewSetError) -> ApplicationConnectionError {
    let code = match error {
        ViewSetError::InvalidViewCount { .. }
        | ViewSetError::InvalidViewId
        | ViewSetError::DuplicateViewId(_)
        | ViewSetError::InvalidDeliveryInterval { .. }
        | ViewSetError::InvalidQueueBound { .. }
        | ViewSetError::InvalidView(_)
        | ViewSetError::SnapshotExceedsQueue { .. } => ApplicationConnectionErrorCode::InvalidCall,
        ViewSetError::ResourceLimit => ApplicationConnectionErrorCode::ResourceLimit,
        ViewSetError::UnknownViewSet => ApplicationConnectionErrorCode::UnknownViewSet,
        ViewSetError::ConsumerBusy => ApplicationConnectionErrorCode::ConsumerBusy,
        ViewSetError::Closed => ApplicationConnectionErrorCode::ViewSetClosed,
        ViewSetError::Internal(_) => ApplicationConnectionErrorCode::Internal,
    };
    ApplicationConnectionError::new(code, error.to_string())
}

fn acknowledged_stream_error(error: AcknowledgedViewStreamError) -> ApplicationConnectionError {
    match error {
        AcknowledgedViewStreamError::ViewSet(error) => view_set_connection_error(error),
        AcknowledgedViewStreamError::AcknowledgementOutstanding => ApplicationConnectionError::new(
            ApplicationConnectionErrorCode::ConsumerBusy,
            error.to_string(),
        ),
        AcknowledgedViewStreamError::InvalidAcknowledgement => ApplicationConnectionError::new(
            ApplicationConnectionErrorCode::InvalidCursor,
            error.to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_a_well_formed_call_id_makes_a_call_unsupported() {
        assert_eq!(
            super::unsupported_call_id(
                r#"{"type":"call","call_id":"c-1","operation":{"type":"future"}}"#
            ),
            Some("c-1".to_owned())
        );
        assert_eq!(
            super::unsupported_call_id(r#"{"type":"future_frame","call_id":"c.2"}"#),
            Some("c.2".to_owned())
        );
        for frame in [
            r#"{}"#,
            r#"not json"#,
            r#"[]"#,
            r#"{"type":"call","operation":{}}"#,
            r#"{"type":"call","call_id":""}"#,
            r#"{"type":"call","call_id":"has space"}"#,
            r#"{"type":"call","call_id":7}"#,
            r#"{"type":"connect","call_id":"c-3"}"#,
            r#"{"call_id":"c-4"}"#,
        ] {
            assert_eq!(super::unsupported_call_id(frame), None, "{frame}");
        }
        let long = "a".repeat(super::MAX_IDENTIFIER_BYTES + 1);
        assert_eq!(
            super::unsupported_call_id(&format!(r#"{{"type":"call","call_id":"{long}"}}"#)),
            None
        );
    }
    use super::{
        ApplicationClientFrame, ApplicationConnectionErrorCode, ApplicationConnectionRegistry,
        CLIENT_INSTANCE_ID_BYTES, MAX_PENDING_CALLS, insert_pending, valid_client_instance_id,
        valid_cursor, valid_identifier, valid_torrent_id,
    };
    use std::collections::BTreeSet;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn validates_bounded_wire_identifiers() {
        assert!(valid_identifier("call-1"));
        assert!(!valid_identifier(""));
        assert!(!valid_identifier("contains space"));
        assert!(valid_client_instance_id(
            &"a".repeat(CLIENT_INSTANCE_ID_BYTES)
        ));
        assert!(!valid_client_instance_id(
            &"A".repeat(CLIENT_INSTANCE_ID_BYTES)
        ));
        assert!(valid_cursor("0"));
        assert!(valid_cursor("42"));
        assert!(!valid_cursor("01"));
        assert!(valid_torrent_id("t1-000102030405060708090a0b0c0d0e0f"));
        assert!(!valid_torrent_id("t1-000102030405060708090A0B0C0D0E0F"));
        assert!(!valid_torrent_id(&"0".repeat(40)));
    }

    #[test]
    fn connect_token_is_optional_on_the_wire() {
        let frame: ApplicationClientFrame = serde_json::from_value(serde_json::json!({
            "type": "connect",
            "api_version": 1,
            "encoding": "json",
            "client_instance_id": "00000000000000000000000000000001"
        }))
        .expect("development connect frame");
        assert!(matches!(
            frame,
            ApplicationClientFrame::Connect { token: None, .. }
        ));
        let code = ApplicationConnectionErrorCode::ConsumerBusy;
        assert_eq!(
            serde_json::to_string(&code).expect("error code"),
            "\"consumer_busy\""
        );
    }

    #[test]
    fn torrent_upload_declaration_tolerates_the_retired_digest_field() {
        let frame: ApplicationClientFrame = serde_json::from_value(serde_json::json!({
            "type": "begin_torrent_upload",
            "call_id": "call-1",
            "upload_id": "upload-1",
            "request": {
                "version": 1,
                "request_id": "request-1",
                "storage_root": "downloads",
                "start_content": true,
                "selection": { "type": "all" },
                "source_length": 128,
                "source_sha256": "00".repeat(32),
            },
        }))
        .expect("legacy upload declaration");
        assert!(matches!(
            frame,
            ApplicationClientFrame::BeginTorrentUpload { request, .. }
                if request.source_length == 128
        ));
    }

    #[test]
    fn pending_correlations_reject_duplicates_and_the_seventeenth_id() {
        let pending = std::sync::Mutex::new(BTreeSet::new());
        for index in 0..MAX_PENDING_CALLS {
            assert!(insert_pending(&pending, &format!("call-{index}")));
        }
        assert!(!insert_pending(&pending, "call-0"));
        assert!(!insert_pending(&pending, "call-over-limit"));
        assert_eq!(pending.into_inner().expect("pending IDs").len(), 16);
    }

    #[tokio::test]
    async fn connection_takeover_waits_and_old_cleanup_cannot_remove_replacement() {
        let registry = ApplicationConnectionRegistry::new();
        let first_cancel = CancellationToken::new();
        let first_done = CancellationToken::new();
        let first_takeover = registry
            .activate_connection(
                "owner".to_owned(),
                1,
                first_cancel.clone(),
                first_done.clone(),
            )
            .await;
        assert!(!first_takeover);

        let second_cancel = CancellationToken::new();
        let second_done = CancellationToken::new();
        let takeover_registry = registry.clone();
        let takeover_cancel = second_cancel.clone();
        let takeover_done = second_done.clone();
        let takeover = tokio::spawn(async move {
            takeover_registry
                .activate_connection("owner".to_owned(), 2, takeover_cancel, takeover_done)
                .await
        });
        first_cancel.cancelled().await;
        assert!(!takeover.is_finished());
        first_done.cancel();
        assert!(takeover.await.expect("takeover task"));
        registry.release_connection("owner", 1).await;

        let third_cancel = CancellationToken::new();
        let third_done = CancellationToken::new();
        let third_registry = registry.clone();
        let third = tokio::spawn(async move {
            third_registry
                .activate_connection("owner".to_owned(), 3, third_cancel, third_done)
                .await
        });
        second_cancel.cancelled().await;
        assert!(!third.is_finished());
        second_done.cancel();
        assert!(third.await.expect("third connection"));
    }

    #[tokio::test]
    async fn attachment_takeover_is_generation_safe_and_owner_bounded() {
        let registry = ApplicationConnectionRegistry::new();
        let first_cancel = CancellationToken::new();
        let first_done = CancellationToken::new();
        registry
            .claim_attachment(
                "owner".to_owned(),
                "view-set".to_owned(),
                1,
                first_cancel.clone(),
                first_done.clone(),
            )
            .await
            .expect("first attachment");

        let second_cancel = CancellationToken::new();
        let second_done = CancellationToken::new();
        let takeover_registry = registry.clone();
        let takeover_cancel = second_cancel.clone();
        let takeover_done = second_done.clone();
        let takeover = tokio::spawn(async move {
            takeover_registry
                .claim_attachment(
                    "owner".to_owned(),
                    "view-set".to_owned(),
                    2,
                    takeover_cancel,
                    takeover_done,
                )
                .await
        });
        first_cancel.cancelled().await;
        assert!(!takeover.is_finished());
        first_done.cancel();
        takeover
            .await
            .expect("takeover task")
            .expect("takeover attachment");
        registry.release_attachment("view-set", 1).await;

        let error = registry
            .claim_attachment(
                "other-owner".to_owned(),
                "view-set".to_owned(),
                3,
                CancellationToken::new(),
                CancellationToken::new(),
            )
            .await
            .expect_err("unrelated owner must not take over");
        assert_eq!(error.code, ApplicationConnectionErrorCode::ConsumerBusy);
        second_cancel.cancel();
        second_done.cancel();
    }
}
