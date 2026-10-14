#![forbid(unsafe_code)]

//! Bounded HTTP and WebSocket adapter for the application contract.

mod application_websocket;
mod chromeos_companion;
pub mod desktop_control;
mod web_auth;
mod web_auth_http;

pub use application_websocket::{
    ApplicationClientFrame, ApplicationConnectionError, ApplicationConnectionErrorCode,
    ApplicationConnectionLimits, ApplicationConnectionMetrics,
    ApplicationConnectionMetricsSnapshot, ApplicationFrameMetrics, ApplicationServerFrame,
};
pub use chromeos_companion::{
    ANDROID_COMPANION_PORTS, ARC_COMPANION_HOST, BETA_EXTENSION_ORIGIN, CompanionPairingError,
    CompanionPairingOwner, CompanionPairingPending, CompanionPairingPoll,
    CompanionPairingPollStatus, CompanionPlatformError, CompanionPlatformOwner,
    CompanionRootRemovalRequest, CompanionRootRequest, CompanionServer,
    PRODUCTION_EXTENSION_ORIGIN, bind_companion, bind_companion_on,
};
pub use web_auth::{
    AuthorizedWebSession, INITIAL_WINDOW_SECONDS, IssuedWebSession, PairingTicket, WebAccessPolicy,
    WebAuthError, WebAuthStore,
};

use std::error::Error;
use std::fmt;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::body::Bytes;
use axum::extract::Request;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rstorrent_platform::{DownloadDirectoryPicker, NativeDownloadDirectoryPicker, PickerError};
use rstorrent_session::{
    AddTorrentBytesRequest, ApplicationService, CONTROL_VERSION, FileIndexRange,
    FileSelectionIntent, MediaUrlOutcome, MediaUrlResponse, OpenViewSetRequest, RequestEnvelope,
    StorageRootSnapshot, UpdateViewSetRequest, ViewSetError, ViewSetOwner,
    application_error_response,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use ts_rs::TS;

pub const MAX_INCOMING_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_TORRENT_SOURCE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_HTTP_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_CONNECTIONS: usize = 8;
pub const MAX_TOKEN_BYTES: usize = 128;
pub const MAX_ORIGIN_BYTES: usize = 512;
pub const MAX_BASIC_USERNAME_BYTES: usize = 64;
pub const MAX_BASIC_PASSWORD_BYTES: usize = 128;
pub const MAX_BASIC_AUTHORIZATION_BYTES: usize = 512;
pub const MAX_BUILD_ID_BYTES: usize = 128;
pub const MAX_PRODUCT_ID_BYTES: usize = 128;
pub const MAX_UPDATE_FIELD_BYTES: usize = 1024;
pub const HTTP_OWNER_HEX_BYTES: usize = 32;
pub const CROSTINI_HOST: &str = "jstorrent.localhost";
pub const CROSTINI_PRODUCT: &str = "rstorrent-crostini";
pub const CROSTINI_LAUNCH_PROTOCOL_VERSION: u16 = 1;
pub const JSTORRENT_BETA_EXTENSION_ID: &str = "gcgoepclopkgijmclmlheafaglmbjlcc";

static NEXT_HTTP_OWNER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct GatewayConfig {
    pub bind: SocketAddr,
    pub authentication: GatewayAuthentication,
    pub allowed_origin: String,
    pub max_connections: usize,
}

#[derive(Clone)]
pub enum GatewayAuthentication {
    Bearer { token: String },
    Basic(BasicCredentials),
    PrivateLanNone,
    TailscaleServeNone,
    Web(WebAuthenticationConfig),
    ChromeOsCompanion(Arc<CompanionPairingOwner>),
    UnauthenticatedLoopbackDevelopment,
}

#[derive(Clone, Debug)]
pub struct WebAuthenticationConfig {
    pub database: PathBuf,
    pub pairing_window: bool,
    pub policy_override: Option<WebAccessPolicy>,
}

#[derive(Clone)]
pub struct BasicCredentials {
    authorization: String,
}

impl GatewayAuthentication {
    pub fn basic(username: &str, password: &str) -> Result<Self, GatewayError> {
        if username.is_empty()
            || username.len() > MAX_BASIC_USERNAME_BYTES
            || username.contains(':')
        {
            return Err(GatewayError::Configuration(format!(
                "basic username must be 1..={MAX_BASIC_USERNAME_BYTES} bytes and contain no colon"
            )));
        }
        if password.is_empty() || password.len() > MAX_BASIC_PASSWORD_BYTES {
            return Err(GatewayError::Configuration(format!(
                "basic password must be 1..={MAX_BASIC_PASSWORD_BYTES} bytes"
            )));
        }
        let encoded = BASE64_STANDARD.encode(format!("{username}:{password}"));
        let authorization = format!("Basic {encoded}");
        if authorization.len() > MAX_BASIC_AUTHORIZATION_BYTES {
            return Err(GatewayError::Configuration(
                "encoded basic credential exceeds its configured bound".to_owned(),
            ));
        }
        Ok(Self::Basic(BasicCredentials { authorization }))
    }
}

impl fmt::Debug for GatewayAuthentication {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bearer { .. } => formatter.write_str("Bearer { token: [redacted] }"),
            Self::Basic(_) => formatter.write_str("Basic { credential: [redacted] }"),
            Self::PrivateLanNone => formatter.write_str("PrivateLanNone"),
            Self::TailscaleServeNone => formatter.write_str("TailscaleServeNone"),
            Self::Web(config) => formatter.debug_tuple("Web").field(config).finish(),
            Self::ChromeOsCompanion(_) => formatter.write_str("ChromeOsCompanion([redacted])"),
            Self::UnauthenticatedLoopbackDevelopment => {
                formatter.write_str("UnauthenticatedLoopbackDevelopment")
            }
        }
    }
}

impl fmt::Debug for GatewayConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GatewayConfig")
            .field("bind", &self.bind)
            .field("authentication", &self.authentication)
            .field("allowed_origin", &self.allowed_origin)
            .field("max_connections", &self.max_connections)
            .finish()
    }
}

impl GatewayConfig {
    pub fn loopback(token: String, allowed_origin: String) -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 3030)),
            authentication: GatewayAuthentication::Bearer { token },
            allowed_origin,
            max_connections: MAX_CONNECTIONS,
        }
    }

    pub fn unauthenticated_loopback_development(allowed_origin: String) -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 0)),
            authentication: GatewayAuthentication::UnauthenticatedLoopbackDevelopment,
            allowed_origin,
            max_connections: MAX_CONNECTIONS,
        }
    }

    pub fn validate(&self) -> Result<(), GatewayError> {
        if !matches!(
            self.authentication,
            GatewayAuthentication::Basic(_)
                | GatewayAuthentication::PrivateLanNone
                | GatewayAuthentication::Web(_)
        ) && !self.bind.ip().is_loopback()
        {
            return Err(GatewayError::Configuration(
                "the proof gateway only binds a loopback address".to_owned(),
            ));
        }
        if matches!(self.authentication, GatewayAuthentication::Basic(_))
            && (self.bind.ip().is_unspecified() || self.bind.ip().is_multicast())
        {
            return Err(GatewayError::Configuration(
                "the authenticated host requires one explicit unicast bind address".to_owned(),
            ));
        }
        if matches!(self.authentication, GatewayAuthentication::PrivateLanNone) {
            let IpAddr::V4(address) = self.bind.ip() else {
                return Err(GatewayError::Configuration(
                    "credential-free LAN hosting requires one RFC 1918 IPv4 address".to_owned(),
                ));
            };
            if self.bind.port() == 0 || address.is_loopback() || !address.is_private() {
                return Err(GatewayError::Configuration(
                    "credential-free LAN hosting requires one exact non-loopback RFC 1918 IPv4 socket"
                        .to_owned(),
                ));
            }
            let expected_origin = format!("http://{}", self.bind);
            if self.allowed_origin != expected_origin {
                return Err(GatewayError::Configuration(format!(
                    "credential-free LAN origin must be exactly {expected_origin}"
                )));
            }
        }
        if matches!(
            self.authentication,
            GatewayAuthentication::TailscaleServeNone
        ) && (!self.bind.is_ipv4()
            || !self.bind.ip().is_loopback()
            || self.bind.port() == 0
            || !is_tailscale_https_origin(&self.allowed_origin))
        {
            return Err(GatewayError::Configuration(
                "credential-free Tailscale Serve hosting requires one exact IPv4 loopback bind and HTTPS *.ts.net origin"
                    .to_owned(),
            ));
        }
        if matches!(self.authentication, GatewayAuthentication::Web(_))
            && !self.bind.ip().is_loopback()
        {
            return Err(GatewayError::Configuration(
                "browser-session authentication is loopback-only".to_owned(),
            ));
        }
        match &self.authentication {
            GatewayAuthentication::Bearer { token }
                if token.is_empty() || token.len() > MAX_TOKEN_BYTES =>
            {
                return Err(GatewayError::Configuration(format!(
                    "gateway token must be 1..={MAX_TOKEN_BYTES} bytes"
                )));
            }
            _ => {}
        }
        if self.allowed_origin.is_empty() || self.allowed_origin.len() > MAX_ORIGIN_BYTES {
            return Err(GatewayError::Configuration(format!(
                "allowed origin must be 1..={MAX_ORIGIN_BYTES} bytes"
            )));
        }
        if HeaderValue::from_str(&self.allowed_origin).is_err() {
            return Err(GatewayError::Configuration(
                "allowed origin is not a valid HTTP header value".to_owned(),
            ));
        }
        if matches!(
            self.authentication,
            GatewayAuthentication::UnauthenticatedLoopbackDevelopment
                | GatewayAuthentication::Web(_)
        ) && !is_loopback_http_origin(&self.allowed_origin)
        {
            return Err(GatewayError::Configuration(
                "local browser authentication requires an exact HTTP loopback origin with a port"
                    .to_owned(),
            ));
        }
        if matches!(self.authentication, GatewayAuthentication::Basic(_))
            && !is_https_origin(&self.allowed_origin)
        {
            return Err(GatewayError::Configuration(
                "basic authentication requires one exact HTTPS public origin".to_owned(),
            ));
        }
        if self.max_connections == 0 || self.max_connections > MAX_CONNECTIONS {
            return Err(GatewayError::Configuration(format!(
                "connection limit must be 1..={MAX_CONNECTIONS}"
            )));
        }
        Ok(())
    }

    fn validate_crostini(&self) -> Result<(), GatewayError> {
        if !matches!(self.authentication, GatewayAuthentication::Web(_)) {
            return Err(GatewayError::Configuration(
                "ChromeOS Linux hosting requires browser-session authentication".to_owned(),
            ));
        }
        if !self.bind.is_ipv4() || !self.bind.ip().is_unspecified() || self.bind.port() == 0 {
            return Err(GatewayError::Configuration(
                "ChromeOS Linux hosting requires one fixed IPv4 wildcard listener".to_owned(),
            ));
        }
        let expected_origin = format!("http://{CROSTINI_HOST}:{}", self.bind.port());
        if self.allowed_origin != expected_origin {
            return Err(GatewayError::Configuration(format!(
                "ChromeOS Linux origin must be exactly {expected_origin}"
            )));
        }
        if self.max_connections == 0 || self.max_connections > MAX_CONNECTIONS {
            return Err(GatewayError::Configuration(format!(
                "connection limit must be 1..={MAX_CONNECTIONS}"
            )));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct HostedAssets {
    root: PathBuf,
    build_id: String,
    product: Option<String>,
    chromeos_handoff: Option<ChromeOsHandoff>,
    access_mode: Option<HostedAccessMode>,
    update_provider: Option<Arc<dyn HostedUpdateProvider>>,
}

impl fmt::Debug for HostedAssets {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostedAssets")
            .field("root", &self.root)
            .field("build_id", &self.build_id)
            .field("product", &self.product)
            .field("chromeos_handoff", &self.chromeos_handoff)
            .field("access_mode", &self.access_mode)
            .field("update_provider", &self.update_provider.is_some())
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostedAccessMode {
    Basic,
    BrowserSession,
    LanNone,
    NetworkNone,
}

impl HostedAccessMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::BrowserSession => "browser_session",
            Self::LanNone => "lan_none",
            Self::NetworkNone => "network_none",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct HostedUpdateInfo {
    pub version: String,
    pub build_id: String,
    pub target: String,
    pub arch: String,
    pub package: String,
    pub check_privacy: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct HostedUpdateCandidate {
    pub version: String,
    pub release_url: String,
    pub apply_command: String,
}

pub type HostedUpdateCheckFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<HostedUpdateCandidate>, String>> + Send + 'a>>;

pub trait HostedUpdateProvider: Send + Sync {
    fn info(&self) -> HostedUpdateInfo;
    fn check(&self) -> HostedUpdateCheckFuture<'_>;
}

#[derive(Clone, Debug)]
struct ChromeOsHandoff {
    extension_id: String,
}

impl HostedAssets {
    pub fn new(root: PathBuf, build_id: String) -> Result<Self, GatewayError> {
        if !root.is_absolute() || !root.is_dir() || !root.join("index.html").is_file() {
            return Err(GatewayError::Configuration(
                "hosted web root must be an absolute directory containing index.html".to_owned(),
            ));
        }
        if build_id.is_empty()
            || build_id.len() > MAX_BUILD_ID_BYTES
            || !build_id.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(GatewayError::Configuration(format!(
                "hosted build ID must be 1..={MAX_BUILD_ID_BYTES} printable ASCII bytes"
            )));
        }
        Ok(Self {
            root,
            build_id,
            product: None,
            chromeos_handoff: None,
            access_mode: None,
            update_provider: None,
        })
    }

    pub fn with_product(mut self, product: String) -> Result<Self, GatewayError> {
        if product.is_empty()
            || product.len() > MAX_PRODUCT_ID_BYTES
            || !product.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(GatewayError::Configuration(format!(
                "hosted product ID must be 1..={MAX_PRODUCT_ID_BYTES} printable ASCII bytes"
            )));
        }
        self.product = Some(product);
        Ok(self)
    }

    pub fn with_chromeos_handoff(mut self, extension_id: String) -> Result<Self, GatewayError> {
        if extension_id.len() != 32 || !extension_id.bytes().all(|byte| matches!(byte, b'a'..=b'p'))
        {
            return Err(GatewayError::Configuration(
                "ChromeOS extension ID must contain exactly 32 lowercase a-p characters".to_owned(),
            ));
        }
        if self
            .product
            .as_deref()
            .is_some_and(|product| product != CROSTINI_PRODUCT)
        {
            return Err(GatewayError::Configuration(
                "ChromeOS hosting cannot replace its product identity".to_owned(),
            ));
        }
        self.product = Some(CROSTINI_PRODUCT.to_owned());
        self.chromeos_handoff = Some(ChromeOsHandoff { extension_id });
        Ok(self)
    }

    pub fn with_access_mode(mut self, access_mode: HostedAccessMode) -> Self {
        self.access_mode = Some(access_mode);
        self
    }

    pub fn with_update_provider(
        mut self,
        provider: Arc<dyn HostedUpdateProvider>,
    ) -> Result<Self, GatewayError> {
        validate_update_info(&provider.info())?;
        self.update_provider = Some(provider);
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    AuthenticationFailed,
    InvalidRequest,
    ResourceLimit,
    UnknownViewSet,
    ConcurrentPull,
    ViewSetClosed,
    ResponseTooLarge,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiErrorEnvelope {
    pub error: ApiError,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ChooseDownloadRootRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_root: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ChooseDownloadRootResponse {
    pub root: Option<StorageRootSnapshot>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct CreateMediaUrlRequest {
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub file_index: u32,
}

#[derive(Debug)]
pub enum GatewayError {
    Configuration(String),
    Bind(std::io::Error),
    Serve(std::io::Error),
}

impl fmt::Display for GatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Configuration(message) => write!(formatter, "gateway configuration: {message}"),
            Self::Bind(error) => write!(formatter, "bind gateway: {error}"),
            Self::Serve(error) => write!(formatter, "serve gateway: {error}"),
        }
    }
}

impl Error for GatewayError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Bind(error) | Self::Serve(error) => Some(error),
            Self::Configuration(_) => None,
        }
    }
}

#[derive(Clone)]
struct GatewayState {
    authentication: Arc<GatewayAuthentication>,
    allowed_origin: Arc<str>,
    allowed_host: Arc<str>,
    media_host: Arc<str>,
    media_origin: Arc<str>,
    service: Arc<Mutex<ApplicationService>>,
    connections: Arc<Semaphore>,
    torrent_uploads: Arc<Semaphore>,
    http_owner_namespace: u64,
    connection_registry: application_websocket::ApplicationConnectionRegistry,
    connection_metrics: ApplicationConnectionMetrics,
    gateway_shutdown: CancellationToken,
    hello_backend: Option<rstorrent_session::ApiBackendIdentity>,
    companion_platform: Option<Arc<CompanionPlatformOwner>>,
    download_directory_picker: Arc<dyn DownloadDirectoryPicker>,
    hosted_assets: Option<Arc<HostedAssets>>,
    web_auth: Option<Arc<std::sync::Mutex<web_auth_http::WebAuthRuntime>>>,
}

impl fmt::Debug for GatewayState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GatewayState")
            .field("authentication", &self.authentication)
            .field("allowed_origin", &self.allowed_origin)
            .field(
                "available_connections",
                &self.connections.available_permits(),
            )
            .finish_non_exhaustive()
    }
}

pub async fn bind(
    config: GatewayConfig,
    service: Arc<Mutex<ApplicationService>>,
) -> Result<GatewayServer, GatewayError> {
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        None,
        GatewayValidation::Standard,
    )
    .await?
    .attach(service)
    .await
}

pub async fn prepare(config: GatewayConfig) -> Result<PreparedGateway, GatewayError> {
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        None,
        GatewayValidation::Standard,
    )
    .await
}

pub async fn bind_hosted(
    config: GatewayConfig,
    service: Arc<Mutex<ApplicationService>>,
    assets: HostedAssets,
) -> Result<GatewayServer, GatewayError> {
    if !matches!(
        config.authentication,
        GatewayAuthentication::Basic(_)
            | GatewayAuthentication::PrivateLanNone
            | GatewayAuthentication::TailscaleServeNone
            | GatewayAuthentication::Web(_)
    ) {
        return Err(GatewayError::Configuration(
            "hosted web assets require basic, credential-free trusted-network, or browser-session authentication"
                .to_owned(),
        ));
    }
    prepare_with_picker_and_assets(
        config,
        Arc::new(UnavailableDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::Standard,
    )
    .await?
    .attach(service)
    .await
}

pub async fn prepare_hosted(
    config: GatewayConfig,
    assets: HostedAssets,
) -> Result<PreparedGateway, GatewayError> {
    if !matches!(
        config.authentication,
        GatewayAuthentication::Basic(_)
            | GatewayAuthentication::PrivateLanNone
            | GatewayAuthentication::TailscaleServeNone
            | GatewayAuthentication::Web(_)
    ) {
        return Err(GatewayError::Configuration(
            "hosted web assets require basic, credential-free trusted-network, or browser-session authentication"
                .to_owned(),
        ));
    }
    prepare_with_picker_and_assets(
        config,
        Arc::new(UnavailableDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::Standard,
    )
    .await
}

pub async fn bind_local_hosted(
    config: GatewayConfig,
    service: Arc<Mutex<ApplicationService>>,
    assets: HostedAssets,
) -> Result<GatewayServer, GatewayError> {
    if !matches!(
        config.authentication,
        GatewayAuthentication::UnauthenticatedLoopbackDevelopment
    ) {
        return Err(GatewayError::Configuration(
            "local hosted web assets require unauthenticated loopback development mode".to_owned(),
        ));
    }
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::Standard,
    )
    .await?
    .attach(service)
    .await
}

pub async fn prepare_local_hosted(
    config: GatewayConfig,
    assets: HostedAssets,
) -> Result<PreparedGateway, GatewayError> {
    if !matches!(
        config.authentication,
        GatewayAuthentication::UnauthenticatedLoopbackDevelopment
    ) {
        return Err(GatewayError::Configuration(
            "local hosted web assets require unauthenticated loopback development mode".to_owned(),
        ));
    }
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::Standard,
    )
    .await
}

pub async fn bind_crostini_hosted(
    config: GatewayConfig,
    service: Arc<Mutex<ApplicationService>>,
    assets: HostedAssets,
) -> Result<GatewayServer, GatewayError> {
    if assets.chromeos_handoff.is_none() {
        return Err(GatewayError::Configuration(
            "ChromeOS Linux hosting requires an exact extension handoff".to_owned(),
        ));
    }
    config.validate_crostini()?;
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::CrostiniValidated,
    )
    .await?
    .attach(service)
    .await
}

pub async fn prepare_crostini_hosted(
    config: GatewayConfig,
    assets: HostedAssets,
) -> Result<PreparedGateway, GatewayError> {
    if assets.chromeos_handoff.is_none() {
        return Err(GatewayError::Configuration(
            "ChromeOS Linux hosting requires an exact extension handoff".to_owned(),
        ));
    }
    config.validate_crostini()?;
    prepare_with_picker_and_assets(
        config,
        Arc::new(NativeDownloadDirectoryPicker),
        Some(assets),
        GatewayValidation::CrostiniValidated,
    )
    .await
}

#[derive(Clone, Copy)]
enum GatewayValidation {
    Standard,
    CrostiniValidated,
    #[cfg(test)]
    PrevalidatedForTest,
}

struct UnavailableDownloadDirectoryPicker;

impl DownloadDirectoryPicker for UnavailableDownloadDirectoryPicker {
    fn choose<'a>(
        &'a self,
        _starting_directory: &'a std::path::Path,
    ) -> rstorrent_platform::PickerFuture<'a> {
        Box::pin(async { Err(PickerError::Unsupported) })
    }
}

#[cfg(test)]
async fn bind_with_picker(
    config: GatewayConfig,
    service: Arc<Mutex<ApplicationService>>,
    download_directory_picker: Arc<dyn DownloadDirectoryPicker>,
) -> Result<GatewayServer, GatewayError> {
    prepare_with_picker_and_assets(
        config,
        download_directory_picker,
        None,
        GatewayValidation::Standard,
    )
    .await?
    .attach(service)
    .await
}

async fn prepare_with_picker_and_assets(
    config: GatewayConfig,
    download_directory_picker: Arc<dyn DownloadDirectoryPicker>,
    hosted_assets: Option<HostedAssets>,
    validation: GatewayValidation,
) -> Result<PreparedGateway, GatewayError> {
    if matches!(validation, GatewayValidation::Standard) {
        config.validate()?;
    }
    let web_auth = match &config.authentication {
        GatewayAuthentication::Web(config) => Some(Arc::new(std::sync::Mutex::new(
            web_auth_http::WebAuthRuntime::open(config)?,
        ))),
        _ => None,
    };
    let listener = TcpListener::bind(config.bind)
        .await
        .map_err(GatewayError::Bind)?;
    let local_addr = listener.local_addr().map_err(GatewayError::Bind)?;
    let media_origin = match &config.authentication {
        GatewayAuthentication::Basic(_)
        | GatewayAuthentication::PrivateLanNone
        | GatewayAuthentication::TailscaleServeNone
        | GatewayAuthentication::Web(_) => config.allowed_origin.trim_end_matches('/').to_owned(),
        GatewayAuthentication::Bearer { .. }
        | GatewayAuthentication::ChromeOsCompanion(_)
        | GatewayAuthentication::UnauthenticatedLoopbackDevelopment => {
            format!("http://{local_addr}")
        }
    };
    let media_host = media_origin
        .parse::<Uri>()
        .ok()
        .and_then(|uri| uri.authority().map(ToString::to_string))
        .ok_or_else(|| GatewayError::Configuration("media origin has no authority".to_owned()))?;
    Ok(PreparedGateway {
        config,
        listener,
        local_addr,
        media_origin,
        media_host,
        download_directory_picker,
        hosted_assets,
        validation,
        web_auth,
    })
}

pub struct PreparedGateway {
    config: GatewayConfig,
    listener: TcpListener,
    local_addr: SocketAddr,
    media_origin: String,
    media_host: String,
    download_directory_picker: Arc<dyn DownloadDirectoryPicker>,
    hosted_assets: Option<HostedAssets>,
    validation: GatewayValidation,
    web_auth: Option<Arc<std::sync::Mutex<web_auth_http::WebAuthRuntime>>>,
}

impl PreparedGateway {
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub async fn attach(
        self,
        service: Arc<Mutex<ApplicationService>>,
    ) -> Result<GatewayServer, GatewayError> {
        self.attach_inner(service, true).await
    }

    pub async fn attach_to_configured_service(
        self,
        service: Arc<Mutex<ApplicationService>>,
    ) -> Result<GatewayServer, GatewayError> {
        self.attach_inner(service, false).await
    }

    async fn attach_inner(
        self,
        service: Arc<Mutex<ApplicationService>>,
        configure_media_origin: bool,
    ) -> Result<GatewayServer, GatewayError> {
        ApplicationService::ensure_maintenance_owner(&service).await;
        #[cfg(test)]
        let prevalidated_for_test =
            matches!(self.validation, GatewayValidation::PrevalidatedForTest);
        #[cfg(not(test))]
        let prevalidated_for_test = false;
        let media_configuration = if !configure_media_origin {
            Ok(())
        } else if prevalidated_for_test {
            service
                .lock()
                .await
                .configure_media_origin(&self.media_origin)
        } else if matches!(
            self.config.authentication,
            GatewayAuthentication::PrivateLanNone
        ) {
            service
                .lock()
                .await
                .configure_media_origin_for_private_lan_http(&self.media_origin, self.config.bind)
        } else if matches!(self.validation, GatewayValidation::CrostiniValidated) {
            service
                .lock()
                .await
                .configure_media_origin_for_local_http_host(&self.media_origin, CROSTINI_HOST)
        } else {
            service
                .lock()
                .await
                .configure_media_origin(&self.media_origin)
        };
        media_configuration.map_err(|error| GatewayError::Configuration(error.to_string()))?;
        let state = GatewayState {
            authentication: Arc::new(self.config.authentication),
            allowed_origin: Arc::from(self.config.allowed_origin),
            allowed_host: Arc::from(self.local_addr.to_string()),
            media_host: Arc::from(self.media_host),
            media_origin: Arc::from(self.media_origin),
            service,
            connections: Arc::new(Semaphore::new(self.config.max_connections)),
            torrent_uploads: Arc::new(Semaphore::new(1)),
            http_owner_namespace: NEXT_HTTP_OWNER.fetch_add(1, Ordering::Relaxed),
            connection_registry: application_websocket::ApplicationConnectionRegistry::new(),
            connection_metrics: ApplicationConnectionMetrics::default(),
            gateway_shutdown: CancellationToken::new(),
            hello_backend: None,
            companion_platform: None,
            download_directory_picker: self.download_directory_picker,
            hosted_assets: self.hosted_assets.map(Arc::new),
            web_auth: self.web_auth,
        };
        Ok(GatewayServer {
            listener: self.listener,
            local_addr: self.local_addr,
            state,
        })
    }
}

pub struct GatewayServer {
    listener: TcpListener,
    local_addr: SocketAddr,
    state: GatewayState,
}

struct GatewayServeGuard(CancellationToken);

impl Drop for GatewayServeGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl fmt::Debug for GatewayServer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GatewayServer")
            .field("local_addr", &self.local_addr)
            .finish_non_exhaustive()
    }
}

impl GatewayServer {
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn connection_metrics(&self) -> ApplicationConnectionMetrics {
        self.state.connection_metrics.clone()
    }

    pub async fn serve(self, shutdown: CancellationToken) -> Result<(), GatewayError> {
        let service = self.state.service.clone();
        let gateway_shutdown = self.state.gateway_shutdown.clone();
        let _serve_guard = GatewayServeGuard(gateway_shutdown.clone());
        let allowed_origin =
            HeaderValue::from_str(&self.state.allowed_origin).expect("validated allowed origin");
        let cors = CorsLayer::new()
            .allow_origin(allowed_origin)
            .allow_credentials(true)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers([
                header::ACCEPT,
                header::AUTHORIZATION,
                header::CONTENT_TYPE,
                HeaderName::from_static("x-rstorrent-owner"),
                HeaderName::from_static("x-check-reason"),
            ]);
        let torrent_upload = post(api_torrent_upload)
            .layer(axum::extract::DefaultBodyLimit::max(
                MAX_TORRENT_SOURCE_BYTES,
            ))
            .layer(middleware::from_fn_with_state(
                self.state.clone(),
                admit_torrent_upload,
            ));
        let torrent_list_import = post(api_torrent_list_import)
            .layer(axum::extract::DefaultBodyLimit::max(
                rstorrent_session::MAX_TORRENT_LIST_BUNDLE_BYTES,
            ))
            .layer(middleware::from_fn_with_state(
                self.state.clone(),
                admit_torrent_list_import,
            ));
        let mut router = Router::new()
            // POST, not GET: browsers omit Origin on same-origin GETs, and
            // every authenticated route requires it.
            .route("/api/v1/torrent-list/export", post(api_torrent_list_export))
            .route("/api/v1/torrent-list/import", torrent_list_import)
            .route(
                "/api/v1/connect",
                get(application_websocket::upgrade_application_connection),
            )
            .route("/api/v1/hello", get(api_hello))
            .route("/api/v1/commands", post(api_command))
            .route("/api/v1/media-urls", post(create_media_url))
            .route("/api/v1/torrents", torrent_upload)
            .route("/api/v1/platform/download-root", post(choose_download_root))
            .route("/api/v1/view-sets", post(open_view_set))
            .route(
                "/api/v1/view-sets/{id}/views",
                axum::routing::put(update_view_set),
            )
            .route("/api/v1/view-sets/{id}/updates", get(view_set_updates))
            .route(
                "/api/v1/view-sets/{id}",
                axum::routing::delete(close_view_set),
            )
            .route("/healthz", get(healthz))
            .route("/api/v1/web-auth/status", get(web_auth_http::status))
            .route("/api/v1/web-auth/policy", post(web_auth_http::set_policy))
            .route(
                "/api/v1/web-auth/recovery",
                post(web_auth_http::claim_recovery_window),
            )
            .route(
                "/api/v1/web-auth/pairing-ticket",
                post(web_auth_http::create_pairing_ticket),
            )
            .route(
                "/api/v1/web-auth/pairing-ticket/redeem",
                post(web_auth_http::redeem_pairing_ticket),
            )
            .route("/api/v1/web-auth/sessions", get(web_auth_http::sessions))
            .route(
                "/api/v1/web-auth/sessions/others",
                axum::routing::delete(web_auth_http::revoke_other_sessions),
            )
            .route(
                "/api/v1/web-auth/sessions/{id}",
                axum::routing::delete(web_auth_http::revoke_session),
            )
            .route("/api/v1/web-auth/logout", post(web_auth_http::logout))
            .route(
                "/api/v1/web-auth/clear-access",
                post(web_auth_http::clear_access),
            )
            .layer(axum::extract::DefaultBodyLimit::max(
                MAX_INCOMING_MESSAGE_BYTES,
            ))
            .layer(cors)
            .with_state(self.state.clone());
        router = router.merge(rstorrent_media::media_router(
            self.state.service.clone(),
            self.state.media_host.clone(),
        ));
        if let Some(assets) = &self.state.hosted_assets {
            if assets.chromeos_handoff.is_some() {
                router = router.merge(
                    Router::new()
                        .route("/launch-chromeos", get(chromeos_launch_page))
                        .route("/launch-chromeos.js", get(chromeos_launch_script))
                        .route("/launch-chromeos.css", get(chromeos_launch_style))
                        .route("/launch-chromeos.png", get(chromeos_launch_icon))
                        .with_state(self.state.clone()),
                );
            }
            if assets.update_provider.is_some() {
                router = router.merge(
                    Router::new()
                        .route(
                            "/api/v1/product-update",
                            get(product_update_info).post(product_update_check),
                        )
                        .with_state(self.state.clone()),
                );
            }
            router = router.fallback_service(ServeDir::new(&assets.root));
            router = router.layer(middleware::from_fn(hosted_asset_cache_policy));
        }
        router = router.layer(middleware::from_fn_with_state(
            self.state.clone(),
            require_host_and_basic_auth,
        ));
        axum::serve(
            self.listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            shutdown.cancelled().await;
            gateway_shutdown.cancel();
            service.lock().await.close_view_sets();
        })
        .await
        .map_err(GatewayError::Serve)
    }
}

async fn hosted_asset_cache_policy(request: Request, next: Next) -> Response {
    let cache_control = match (request.method(), request.uri().path()) {
        (&Method::GET | &Method::HEAD, "/" | "/index.html" | "/rstorrent-boot.js") => {
            Some(HeaderValue::from_static("no-store"))
        }
        (&Method::GET | &Method::HEAD, path) if path.starts_with("/assets/") => Some(
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ),
        _ => None,
    };
    let mut response = next.run(request).await;
    if response.status().is_success()
        && let Some(cache_control) = cache_control
    {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, cache_control);
    }
    response
}

async fn require_host_and_basic_auth(
    State(state): State<GatewayState>,
    request: Request,
    next: Next,
) -> Response {
    if matches!(state.authentication.as_ref(), GatewayAuthentication::Web(_))
        && !web_auth_http::host_matches_origin(&state, request.headers())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if matches!(
        state.authentication.as_ref(),
        GatewayAuthentication::Basic(_)
            | GatewayAuthentication::PrivateLanNone
            | GatewayAuthentication::TailscaleServeNone
    ) && request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        != Some(state.media_host.as_ref())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let GatewayAuthentication::Basic(credentials) = state.authentication.as_ref() else {
        return next.run(request).await;
    };
    let accepted = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= MAX_BASIC_AUTHORIZATION_BYTES)
        .is_some_and(|value| {
            constant_time_equal(value.as_bytes(), credentials.authorization.as_bytes())
        });
    if accepted {
        next.run(request).await
    } else {
        basic_auth_rejection()
    }
}

async fn admit_torrent_upload(
    State(state): State<GatewayState>,
    request: Request,
    next: Next,
) -> Response {
    if let Err(error) = authenticate_http(&state, request.headers()) {
        return error.into_response();
    }
    if request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/x-bittorrent")
    {
        return invalid_request("torrent upload content type must be application/x-bittorrent");
    }
    let Ok(permit) = state.torrent_uploads.clone().try_acquire_owned() else {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            ApiErrorCode::ResourceLimit,
            "another torrent upload is already in progress",
        );
    };
    let response = next.run(request).await;
    drop(permit);
    response
}

fn basic_auth_rejection() -> Response {
    let mut response = api_error(
        StatusCode::UNAUTHORIZED,
        ApiErrorCode::AuthenticationFailed,
        "gateway credential was rejected",
    );
    response.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"JSTorrent\", charset=\"UTF-8\""),
    );
    response
}

#[derive(Serialize)]
struct HealthResponse<'a> {
    status: &'static str,
    build_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    launch_protocol: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_mode: Option<&'a str>,
}

async fn healthz(State(state): State<GatewayState>) -> Response {
    let Some(assets) = &state.hosted_assets else {
        return StatusCode::NOT_FOUND.into_response();
    };
    json_response(
        StatusCode::OK,
        &HealthResponse {
            status: "ok",
            build_id: &assets.build_id,
            product: assets.product.as_deref(),
            launch_protocol: assets
                .chromeos_handoff
                .as_ref()
                .map(|_| CROSTINI_LAUNCH_PROTOCOL_VERSION),
            access_mode: assets.access_mode.map(HostedAccessMode::as_str),
        },
    )
}

async fn product_update_info(State(state): State<GatewayState>) -> Response {
    let Some(provider) = state
        .hosted_assets
        .as_ref()
        .and_then(|assets| assets.update_provider.as_ref())
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    json_response(StatusCode::OK, &provider.info())
}

async fn product_update_check(State(state): State<GatewayState>, headers: HeaderMap) -> Response {
    if headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        != Some(state.allowed_origin.as_ref())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if matches!(state.authentication.as_ref(), GatewayAuthentication::Web(_))
        && web_auth_http::authenticate_application_request(&state, &headers).is_err()
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !matches!(
        headers
            .get("x-check-reason")
            .and_then(|value| value.to_str().ok()),
        Some("startup" | "periodic" | "manual")
    ) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(provider) = state
        .hosted_assets
        .as_ref()
        .and_then(|assets| assets.update_provider.as_ref())
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match provider.check().await {
        Ok(candidate) if candidate.as_ref().is_none_or(valid_update_candidate) => {
            json_response(StatusCode::OK, &candidate)
        }
        Ok(_) | Err(_) => api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::Internal,
            "signed update check is unavailable",
        ),
    }
}

async fn chromeos_launch_page(State(state): State<GatewayState>) -> Response {
    let Some(handoff) = state
        .hosted_assets
        .as_ref()
        .and_then(|assets| assets.chromeos_handoff.as_ref())
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let document = format!(
        "<!doctype html>\n\
         <html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <meta name=\"color-scheme\" content=\"light dark\">\
         <link rel=\"stylesheet\" href=\"/launch-chromeos.css\">\
         <link rel=\"icon\" href=\"/launch-chromeos.png\">\
         <title>Opening JSTorrent</title></head>\
         <body data-extension-id=\"{}\" data-protocol-version=\"{}\">\
         <main><img src=\"/launch-chromeos.png\" width=\"64\" height=\"64\" alt=\"\">\
         <h1>Opening JSTorrent…</h1>\
         <p id=\"status\" role=\"status\">Connecting to JSTorrent Beta.</p>\
         <p>If this page stays open, install or enable JSTorrent Beta, then choose \
         JSTorrent for ChromeOS Linux from the Launcher again.</p></main>\
         <script src=\"/launch-chromeos.js\"></script></body></html>",
        handoff.extension_id, CROSTINI_LAUNCH_PROTOCOL_VERSION
    );
    let mut response = Html(document).into_response();
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'",
        ),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn chromeos_launch_style() -> Response {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../resources/launch-chromeos.css"),
    )
        .into_response()
}

async fn chromeos_launch_icon() -> Response {
    (
        [(header::CONTENT_TYPE, "image/png")],
        include_bytes!("../resources/jstorrent.png").as_slice(),
    )
        .into_response()
}

async fn chromeos_launch_script() -> Response {
    const SCRIPT: &str = r##"(() => {
  const body = document.body;
  const status = document.querySelector("#status");
  const extensionId = body?.dataset.extensionId;
  const protocolVersion = Number(body?.dataset.protocolVersion);
  const fail = () => {
    if (status) status.textContent = "JSTorrent Beta is unavailable. Enable it and launch JSTorrent for ChromeOS Linux again.";
  };
  if (!extensionId || protocolVersion !== 1 || !globalThis.chrome?.runtime?.sendMessage) {
    fail();
    return;
  }
  chrome.runtime.sendMessage(
    extensionId,
    { type: "openCrostiniUi", protocolVersion },
    (response) => {
      if (chrome.runtime.lastError || response?.ok !== true) {
        fail();
      } else if (status) {
        status.textContent = "JSTorrent is opening.";
      }
    },
  );
})();
"##;
    let mut response = (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        SCRIPT,
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn is_loopback_http_origin(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    if uri.scheme_str() != Some("http") {
        return false;
    }
    let Some(authority) = uri.authority() else {
        return false;
    };
    if authority.port_u16().is_none() || !matches!(authority.host(), "127.0.0.1" | "[::1]" | "::1")
    {
        return false;
    }
    uri.path_and_query()
        .is_none_or(|path| path.as_str().is_empty() || path.as_str() == "/")
}

fn is_https_origin(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    if uri.scheme_str() != Some("https") {
        return false;
    }
    let Some(authority) = uri.authority() else {
        return false;
    };
    if authority.host().is_empty() {
        return false;
    }
    uri.path_and_query()
        .is_none_or(|path| path.as_str().is_empty() || path.as_str() == "/")
}

fn is_tailscale_https_origin(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    is_https_origin(origin)
        && authority
            .host()
            .strip_suffix(".ts.net")
            .is_some_and(|prefix| !prefix.is_empty())
}

fn validate_update_info(info: &HostedUpdateInfo) -> Result<(), GatewayError> {
    let fields = [
        info.version.as_str(),
        info.build_id.as_str(),
        info.target.as_str(),
        info.arch.as_str(),
        info.package.as_str(),
        info.check_privacy.as_str(),
    ];
    if fields.iter().any(|value| {
        value.is_empty()
            || value.len() > MAX_UPDATE_FIELD_BYTES
            || !value.bytes().all(|byte| byte.is_ascii_graphic())
    }) || !valid_final_release_version(&info.version)
        || info.target != "linux-gnu"
        || !matches!(info.arch.as_str(), "x86_64" | "aarch64")
        || info.package != "headless"
        || info.check_privacy != "anonymous"
    {
        return Err(GatewayError::Configuration(
            "hosted update identity is invalid".to_owned(),
        ));
    }
    Ok(())
}

fn valid_update_candidate(candidate: &HostedUpdateCandidate) -> bool {
    valid_final_release_version(&candidate.version)
        && candidate.release_url
            == format!(
                "https://github.com/kzahel/jstorrent/releases/tag/headless-v{}",
                candidate.version
            )
        && candidate.apply_command == "$HOME/.local/bin/rstorrent-headless update --apply"
}

fn valid_final_release_version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 20
                && (part.len() == 1 || !part.starts_with('0'))
                && part.bytes().all(|byte| byte.is_ascii_digit())
        })
}

#[derive(Debug, Deserialize)]
struct UpdatesQuery {
    after: String,
    #[serde(default)]
    wait_ms: u32,
}

#[derive(Debug, Deserialize)]
struct TorrentUploadQuery {
    request_id: String,
    storage_root: String,
    #[serde(default)]
    expected_revision: Option<String>,
    #[serde(default = "default_true")]
    start_content: bool,
    #[serde(default)]
    selection: Option<String>,
    wanted_ranges: Option<String>,
}

fn default_true() -> bool {
    true
}

async fn api_hello(State(state): State<GatewayState>, headers: HeaderMap) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let hello = {
        let service = state.service.lock().await;
        application_websocket::application_hello(&service)
    };
    json_response(StatusCode::OK, &hello)
}

async fn api_command(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    request: Result<Json<RequestEnvelope>, JsonRejection>,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return invalid_request(error.body_text()),
    };
    let request_id = request.request_id.clone();
    let mut service = state.service.lock().await;
    let response = match service.dispatch(request).await {
        Ok(response) => response,
        Err(error) => {
            application_error_response(request_id, service.revision().unwrap_or(0), &error)
        }
    };
    json_response(StatusCode::OK, &response)
}

async fn create_media_url(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    request: Result<Json<CreateMediaUrlRequest>, JsonRejection>,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return invalid_request(error.body_text()),
    };
    let mut service = state.service.lock().await;
    match service
        .create_media_url(&request.torrent_id, request.file_index)
        .await
    {
        Ok(mut response) => match apply_gateway_media_origin(&mut response, &state.media_origin) {
            Ok(()) => json_response(StatusCode::OK, &response),
            Err(message) => api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiErrorCode::Internal,
                message,
            ),
        },
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiErrorCode::Internal,
            &error.to_string(),
        ),
    }
}

fn apply_gateway_media_origin(
    response: &mut MediaUrlResponse,
    media_origin: &str,
) -> Result<(), &'static str> {
    let MediaUrlOutcome::Created { url, .. } = &mut response.outcome else {
        return Ok(());
    };
    let Some((_, capability)) = url.rsplit_once("/media/v1/") else {
        return Err("application returned a malformed media capability URL");
    };
    *url = format!("{media_origin}/media/v1/{capability}");
    Ok(())
}

async fn api_torrent_upload(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    query: Result<Query<TorrentUploadQuery>, QueryRejection>,
    body: Result<Bytes, axum::extract::rejection::BytesRejection>,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let Query(query) = match query {
        Ok(query) => query,
        Err(error) => return invalid_request(error.body_text()),
    };
    let body = match body {
        Ok(body) => body,
        Err(error) => return invalid_request(error.body_text()),
    };
    let selection =
        match parse_upload_selection(query.selection.as_deref(), query.wanted_ranges.as_deref()) {
            Ok(selection) => selection,
            Err(message) => return invalid_request(message),
        };
    let request = AddTorrentBytesRequest {
        version: CONTROL_VERSION,
        request_id: query.request_id,
        expected_revision: query.expected_revision,
        storage_root: query.storage_root,
        start_content: query.start_content,
        await_file_selection: false,
        selection,
        source_length: body.len() as u32,
    };
    let request_id = request.request_id.clone();
    let mut service = state.service.lock().await;
    let response = match service.add_torrent_bytes(request, body.into()).await {
        Ok(response) => response,
        Err(error) => {
            application_error_response(request_id, service.revision().unwrap_or(0), &error)
        }
    };
    json_response(StatusCode::OK, &response)
}

/// Tactical 348: the whole torrent list as a portable bundle.
async fn api_torrent_list_export(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let mut service = state.service.lock().await;
    match service.export_torrent_list().await {
        Ok(bundle) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/zip"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"jstorrent-torrents.zip\"",
                ),
            ],
            bundle,
        )
            .into_response(),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiErrorCode::Internal,
            &error.to_string(),
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TorrentListImportQuery {
    storage_root: String,
    #[serde(default)]
    keep_matching_locations: bool,
}

async fn admit_torrent_list_import(
    State(state): State<GatewayState>,
    request: Request,
    next: Next,
) -> Response {
    if let Err(error) = authenticate_http(&state, request.headers()) {
        return error.into_response();
    }
    if request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/zip")
    {
        return invalid_request("torrent list import content type must be application/zip");
    }
    let Ok(permit) = state.torrent_uploads.clone().try_acquire_owned() else {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            ApiErrorCode::ResourceLimit,
            "another torrent upload is already in progress",
        );
    };
    let response = next.run(request).await;
    drop(permit);
    response
}

async fn api_torrent_list_import(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    query: Result<Query<TorrentListImportQuery>, QueryRejection>,
    body: Result<Bytes, axum::extract::rejection::BytesRejection>,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let Query(query) = match query {
        Ok(query) => query,
        Err(error) => return invalid_request(error.body_text()),
    };
    let body = match body {
        Ok(body) => body,
        Err(error) => return invalid_request(error.body_text()),
    };
    let target = rstorrent_session::TorrentListImportTarget {
        storage_root: query.storage_root,
        keep_matching_locations: query.keep_matching_locations,
    };
    let mut service = state.service.lock().await;
    match service.import_torrent_bundle(body.into(), target).await {
        Ok(report) => json_response(StatusCode::OK, &report),
        Err(error) => invalid_request(error.to_string()),
    }
}

fn parse_upload_selection(
    mode: Option<&str>,
    ranges: Option<&str>,
) -> Result<FileSelectionIntent, String> {
    match mode.unwrap_or("all") {
        "all" if ranges.is_none() => Ok(FileSelectionIntent::All),
        "none" if ranges.is_none() => Ok(FileSelectionIntent::None),
        "ranges" => Ok(FileSelectionIntent::WantedRanges {
            ranges: parse_upload_file_ranges(ranges.unwrap_or(""))?,
        }),
        "all" | "none" => Err("wanted_ranges is only valid with selection=ranges".to_owned()),
        _ => Err("selection must be all, none, or ranges".to_owned()),
    }
}

fn parse_upload_file_ranges(value: &str) -> Result<Vec<FileIndexRange>, String> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    value
        .split(',')
        .map(|part| {
            let (start, end) = part
                .split_once('-')
                .ok_or_else(|| "wanted_ranges must use canonical start-end pairs".to_owned())?;
            Ok(FileIndexRange {
                start: parse_canonical_u32(start, "wanted range start")?,
                end_exclusive: parse_canonical_u32(end, "wanted range end")?,
            })
        })
        .collect()
}

fn parse_canonical_u32(value: &str, label: &str) -> Result<u32, String> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(format!("{label} must be a canonical integer"));
    }
    value
        .parse()
        .map_err(|_| format!("{label} exceeds unsigned 32-bit range"))
}

async fn choose_download_root(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    request: Result<Json<ChooseDownloadRootRequest>, JsonRejection>,
) -> Response {
    if let Err(error) = authenticate_http(&state, &headers) {
        return error.into_response();
    }
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return invalid_request(error.body_text()),
    };
    let suggested = {
        let service = state.service.lock().await;
        match service.suggested_storage_root_path(request.repair_root.as_deref()) {
            Ok(suggested) => suggested,
            Err(error) => return invalid_request(error.to_string()),
        }
    };
    let Some(starting_directory) = suggested.or_else(home_directory) else {
        return api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            ApiErrorCode::Internal,
            "no usable folder-picker starting directory is available",
        );
    };
    let selected = match state
        .download_directory_picker
        .choose(&starting_directory)
        .await
    {
        Ok(selected) => selected,
        Err(PickerError::Unsupported) => {
            return api_error(
                StatusCode::NOT_IMPLEMENTED,
                ApiErrorCode::Internal,
                "download folder picker is not implemented on this platform",
            );
        }
        Err(error) => {
            return api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiErrorCode::Internal,
                &error.to_string(),
            );
        }
    };
    let root = if let Some(selected) = selected {
        let mut service = state.service.lock().await;
        let result = if let Some(root_id) = request.repair_root.as_deref() {
            service.repair_path_storage_root(root_id, &selected)
        } else {
            service.install_path_storage_root(&selected)
        };
        match result {
            Ok(root) => Some(root),
            Err(error) => {
                return api_error(
                    StatusCode::CONFLICT,
                    ApiErrorCode::InvalidRequest,
                    &error.to_string(),
                );
            }
        }
    } else {
        None
    };
    json_response(StatusCode::OK, &ChooseDownloadRootResponse { root })
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

async fn open_view_set(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    request: Result<Json<OpenViewSetRequest>, JsonRejection>,
) -> Response {
    let owner = match authenticate_http(&state, &headers) {
        Ok(owner) => owner,
        Err(error) => return error.into_response(),
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return invalid_request(error.body_text()),
    };
    let result = state.service.lock().await.open_view_set(owner, request);
    match result {
        Ok(response) => json_response(StatusCode::CREATED, &response),
        Err(error) => view_set_error(error),
    }
}

async fn update_view_set(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    request: Result<Json<UpdateViewSetRequest>, JsonRejection>,
) -> Response {
    let owner = match authenticate_http(&state, &headers) {
        Ok(owner) => owner,
        Err(error) => return error.into_response(),
    };
    if !valid_view_set_id(&id) {
        return invalid_request("view-set ID is invalid");
    }
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return invalid_request(error.body_text()),
    };
    let result = state
        .service
        .lock()
        .await
        .update_view_set(&owner, &id, request);
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => view_set_error(error),
    }
}

async fn view_set_updates(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    query: Result<Query<UpdatesQuery>, QueryRejection>,
) -> Response {
    let owner = match authenticate_http(&state, &headers) {
        Ok(owner) => owner,
        Err(error) => return error.into_response(),
    };
    if !valid_view_set_id(&id) {
        return invalid_request("view-set ID is invalid");
    }
    let Query(query) = match query {
        Ok(query) => query,
        Err(error) => return invalid_request(error.body_text()),
    };
    if query.after.len() > 20 {
        return invalid_request("view-set cursor exceeds its bound");
    }
    let view_set = {
        let service = state.service.lock().await;
        service.view_set(&owner, &id)
    };
    let view_set = match view_set {
        Ok(view_set) => view_set,
        Err(error) => return view_set_error(error),
    };
    match view_set.next_updates(&query.after, query.wait_ms).await {
        Ok(batch) => json_response(StatusCode::OK, &batch),
        Err(error) => view_set_error(error),
    }
}

async fn close_view_set(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let owner = match authenticate_http(&state, &headers) {
        Ok(owner) => owner,
        Err(error) => return error.into_response(),
    };
    if !valid_view_set_id(&id) {
        return invalid_request("view-set ID is invalid");
    }
    match state.service.lock().await.close_view_set(&owner, &id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => view_set_error(error),
    }
}

#[derive(Clone, Copy)]
enum HttpAuthError {
    Origin,
    Credential,
    Owner,
}

impl HttpAuthError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Origin => StatusCode::FORBIDDEN,
            Self::Credential | Self::Owner => StatusCode::UNAUTHORIZED,
        };
        api_error(
            status,
            ApiErrorCode::AuthenticationFailed,
            "gateway credential was rejected",
        )
    }
}

fn authenticate_http(
    state: &GatewayState,
    headers: &HeaderMap,
) -> Result<ViewSetOwner, HttpAuthError> {
    if headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        != Some(state.allowed_origin.as_ref())
    {
        return Err(HttpAuthError::Origin);
    }
    if let GatewayAuthentication::Bearer { token } = state.authentication.as_ref() {
        let credential = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        if credential.is_none_or(|credential| {
            credential.len() > MAX_TOKEN_BYTES
                || !constant_time_equal(credential.as_bytes(), token.as_bytes())
        }) {
            return Err(HttpAuthError::Credential);
        }
    }
    if matches!(state.authentication.as_ref(), GatewayAuthentication::Web(_)) {
        web_auth_http::authenticate_application_request(state, headers)?;
    }
    let owner = headers
        .get("x-rstorrent-owner")
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            value.len() == HTTP_OWNER_HEX_BYTES
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        })
        .ok_or(HttpAuthError::Owner)?;
    Ok(ViewSetOwner::trusted(format!(
        "gateway-client-{}-{owner}",
        state.http_owner_namespace
    )))
}

fn view_set_error(error: ViewSetError) -> Response {
    let (status, code) = match error {
        ViewSetError::InvalidViewCount { .. }
        | ViewSetError::InvalidViewId
        | ViewSetError::DuplicateViewId(_)
        | ViewSetError::InvalidDeliveryInterval { .. }
        | ViewSetError::InvalidQueueBound { .. }
        | ViewSetError::InvalidView(_)
        | ViewSetError::SnapshotExceedsQueue { .. } => {
            (StatusCode::BAD_REQUEST, ApiErrorCode::InvalidRequest)
        }
        ViewSetError::ResourceLimit => (StatusCode::TOO_MANY_REQUESTS, ApiErrorCode::ResourceLimit),
        ViewSetError::UnknownViewSet => (StatusCode::NOT_FOUND, ApiErrorCode::UnknownViewSet),
        ViewSetError::ConsumerBusy => (StatusCode::CONFLICT, ApiErrorCode::ConcurrentPull),
        ViewSetError::Closed => (StatusCode::GONE, ApiErrorCode::ViewSetClosed),
        ViewSetError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, ApiErrorCode::Internal),
    };
    api_error(status, code, &error.to_string())
}

fn invalid_request(message: impl AsRef<str>) -> Response {
    api_error(
        StatusCode::BAD_REQUEST,
        ApiErrorCode::InvalidRequest,
        message.as_ref(),
    )
}

fn api_error(status: StatusCode, code: ApiErrorCode, message: &str) -> Response {
    let mut message = message.to_owned();
    message.truncate(message.floor_char_boundary(1024));
    json_response(
        status,
        &ApiErrorEnvelope {
            error: ApiError { code, message },
        },
    )
}

fn json_response<T: Serialize>(status: StatusCode, value: &T) -> Response {
    let body = match serde_json::to_vec(value) {
        Ok(body) if body.len() <= MAX_HTTP_RESPONSE_BYTES => body,
        Ok(_) => {
            return api_error_unchecked(
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiErrorCode::ResponseTooLarge,
                "gateway response exceeds its configured bound",
            );
        }
        Err(_) => {
            return api_error_unchecked(
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiErrorCode::Internal,
                "gateway response serialization failed",
            );
        }
    };
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

fn api_error_unchecked(status: StatusCode, code: ApiErrorCode, message: &str) -> Response {
    let body = serde_json::to_vec(&ApiErrorEnvelope {
        error: ApiError {
            code,
            message: message.to_owned(),
        },
    })
    .expect("fixed API error must serialize");
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

fn valid_view_set_id(value: &str) -> bool {
    value.len() == 35
        && value.starts_with("vs_")
        && value[3..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or(0) ^ right.get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use futures_util::{SinkExt, StreamExt};
    use rstorrent_platform::DownloadDirectoryPicker;
    use rstorrent_session::{
        AddTorrentBytesRequest, ApplicationCall, ApplicationCallResult, ApplicationConfig,
        ApplicationService, Command, CommandResult, ConfiguredStorageRoot, FileSelectionIntent,
        MediaUrlOutcome, MediaUrlResponse, NetworkConfig, NetworkPolicy, OpenViewSetOptions,
        OpenViewSetRequest, OpenViewSetResponse, RequestEnvelope, ResponseOutcome, SessionStore,
        UpdateBatch, UpdateViewSetRequest, ViewDeliveryPolicy, ViewSetUpdate, ViewSnapshot,
        ViewSpec,
    };
    use sha1::{Digest, Sha1};
    use tokio::sync::Mutex;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_util::sync::CancellationToken;

    use super::{
        ApplicationClientFrame, ApplicationConnectionErrorCode, ApplicationServerFrame,
        CROSTINI_LAUNCH_PROTOCOL_VERSION, CROSTINI_PRODUCT, ChooseDownloadRootResponse,
        GatewayAuthentication, GatewayConfig, GatewayValidation, HostedAccessMode, HostedAssets,
        HostedUpdateCandidate, HostedUpdateCheckFuture, HostedUpdateInfo, HostedUpdateProvider,
        JSTORRENT_BETA_EXTENSION_ID, MAX_TORRENT_SOURCE_BYTES, UnavailableDownloadDirectoryPicker,
        WebAccessPolicy, WebAuthenticationConfig, apply_gateway_media_origin, bind,
        bind_crostini_hosted, bind_hosted, bind_local_hosted, bind_with_picker,
        constant_time_equal, prepare_with_picker_and_assets,
    };

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    struct FixedDirectoryPicker {
        selected: Option<PathBuf>,
        calls: AtomicU64,
    }

    struct FixedUpdateProvider;

    impl HostedUpdateProvider for FixedUpdateProvider {
        fn info(&self) -> HostedUpdateInfo {
            HostedUpdateInfo {
                version: "0.1.0".to_owned(),
                build_id: "lan-test".to_owned(),
                target: "linux-gnu".to_owned(),
                arch: "x86_64".to_owned(),
                package: "headless".to_owned(),
                check_privacy: "anonymous".to_owned(),
            }
        }

        fn check(&self) -> HostedUpdateCheckFuture<'_> {
            Box::pin(async {
                Ok(Some(HostedUpdateCandidate {
                    version: "0.1.1".to_owned(),
                    release_url: "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.1"
                        .to_owned(),
                    apply_command: "$HOME/.local/bin/rstorrent-headless update --apply".to_owned(),
                }))
            })
        }
    }

    impl DownloadDirectoryPicker for FixedDirectoryPicker {
        fn choose<'a>(
            &'a self,
            starting_directory: &'a Path,
        ) -> rstorrent_platform::PickerFuture<'a> {
            Box::pin(async move {
                assert!(starting_directory.is_dir());
                self.calls.fetch_add(1, Ordering::Relaxed);
                Ok(self.selected.clone())
            })
        }
    }

    fn test_root(label: &str) -> PathBuf {
        let sequence = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "rstorrent-gateway-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    async fn test_service(root: &Path) -> Arc<Mutex<ApplicationService>> {
        Arc::new(Mutex::new(
            ApplicationService::open(ApplicationConfig::new(
                root.join("profile"),
                "test".to_owned(),
                vec![ConfiguredStorageRoot::path(
                    "downloads",
                    root.join("payload"),
                )],
                NetworkConfig::new(
                    NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .expect("open service"),
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

    async fn verified_media_service(
        root: &Path,
    ) -> (Arc<Mutex<ApplicationService>>, String, Vec<u8>) {
        let payload = b"gateway verified media".to_vec();
        let raw_info = single_file_info("gateway.mp4", &payload, 7);
        let torrent_id = encode_info_hash(Sha1::digest(&raw_info).into());
        let roots = vec![ConfiguredStorageRoot::path(
            "downloads",
            root.join("payload"),
        )];
        let profile = root.join("profile");
        let mut store = SessionStore::open(&profile, "test", &roots).expect("open media store");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: rstorrent_session::CONTROL_VERSION,
                request_id: "add-gateway-media".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add media torrent");
        let torrent_id = match response.result {
            Some(CommandResult::AddTorrent { result }) => result.torrent_id,
            _ => panic!("missing media add result"),
        };
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record media metadata");
        store
            .record_pieces(&torrent_id, &[0, 1, 2, 3])
            .expect("record media pieces");
        store.mark_complete(&torrent_id).expect("complete media");
        drop(store);
        std::fs::create_dir_all(root.join("payload")).expect("create media root");
        std::fs::write(root.join("payload/gateway.mp4"), &payload).expect("write media");
        let service = Arc::new(Mutex::new(
            ApplicationService::open(ApplicationConfig::new(
                profile,
                "test".to_owned(),
                roots,
                NetworkConfig::new(
                    NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .expect("open media service"),
        ));
        (service, torrent_id, payload)
    }

    async fn read_application_message(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> ApplicationServerFrame {
        let message = tokio::time::timeout(Duration::from_secs(1), socket.next())
            .await
            .expect("application response timed out")
            .expect("application connection closed")
            .expect("application websocket response");
        let Message::Text(text) = message else {
            panic!("expected application text response");
        };
        serde_json::from_str(&text).expect("decode application response")
    }

    async fn send_application_message(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        frame: &ApplicationClientFrame,
    ) {
        socket
            .send(Message::Text(
                serde_json::to_string(frame)
                    .expect("encode application frame")
                    .into(),
            ))
            .await
            .expect("send application frame");
    }

    #[test]
    fn accepted_removal_finishes_after_websocket_disconnect() {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(removal_disconnect_scenario(true));
    }

    #[tokio::test]
    async fn queued_removal_is_cancelled_before_entering_service() {
        removal_disconnect_scenario(false).await;
    }

    async fn removal_disconnect_scenario(accepted: bool) {
        let root = test_root(if accepted {
            "accepted-removal-close"
        } else {
            "queued-removal-close"
        });
        let (service, torrent_id, payload) = verified_media_service(&root).await;
        std::fs::write(root.join("payload/sentinel"), b"keep sibling").expect("sentinel");
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".into(),
                },
                allowed_origin: origin.into(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let metrics = server.connection_metrics();
        let shutdown = CancellationToken::new();
        let server_task = tokio::spawn(server.serve(shutdown.clone()));
        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".into(),
                token: Some("correct-token".into()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));

        let service_guard = if accepted {
            None
        } else {
            Some(service.lock().await)
        };
        let (release, blocked) = std::sync::mpsc::channel();
        let blocker = if accepted {
            // Hold the only blocking worker so deletion cannot finish until
            // the server has acknowledged the client's WebSocket Close.
            let (started, ready) = tokio::sync::oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).expect("worker started");
                blocked
                    .recv_timeout(Duration::from_secs(10))
                    .expect("release worker");
            });
            ready.await.expect("blocking worker ready");
            Some(blocker)
        } else {
            None
        };
        let database = rusqlite::Connection::open_with_flags(
            root.join("profile/session.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .expect("read-only database");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "remove".into(),
                operation: ApplicationCall::Dispatch {
                    request: Box::new(RequestEnvelope {
                        version: rstorrent_session::CONTROL_VERSION,
                        request_id: "remove-disconnect".into(),
                        expected_revision: None,
                        command: Command::RemoveTorrent {
                            torrent_id,
                            data: rstorrent_session::RemovalDataPolicy::DeleteData,
                        },
                    }),
                },
            },
        )
        .await;
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let ready = if accepted {
                    database
                        .query_row(
                            "SELECT count(*) FROM removal_jobs WHERE state = 'pending'",
                            [],
                            |row| row.get::<_, u32>(0),
                        )
                        .expect("pending job")
                        == 1
                } else {
                    metrics.snapshot().pending_calls_high_water == 1
                };
                if ready {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("removal reached fence");
        assert_eq!(
            std::fs::read(root.join("payload/gateway.mp4")).expect("payload"),
            payload
        );
        socket.close(None).await.expect("client close");
        let response = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("close timed out")
            .expect("close frame")
            .expect("close response");
        assert!(matches!(response, Message::Close(_)));
        if let Some(blocker) = blocker {
            release.send(()).expect("release deletion");
            blocker.await.expect("blocking worker joined");
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            while metrics.snapshot().active_connections != 0 {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("connection joined");
        assert_eq!(
            database
                .query_row("SELECT count(*) FROM removal_jobs", [], |row| row
                    .get::<_, u32>(0))
                .expect("terminal jobs"),
            0
        );
        assert_eq!(
            database
                .query_row("SELECT count(*) FROM torrents", [], |row| row
                    .get::<_, u32>(0))
                .expect("catalog"),
            u32::from(!accepted)
        );
        assert_eq!(root.join("payload/gateway.mp4").exists(), !accepted);
        assert_eq!(
            std::fs::read(root.join("payload/sentinel")).expect("sibling"),
            b"keep sibling"
        );
        assert_eq!(metrics.snapshot().pending_calls_high_water, 1);
        assert_eq!(metrics.snapshot().active_connections_high_water, 1);
        drop(service_guard);
        drop(database);
        shutdown.cancel();
        server_task
            .await
            .expect("server join")
            .expect("server termination");
        service
            .lock()
            .await
            .shutdown()
            .await
            .expect("service shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    async fn http_request(
        address: SocketAddr,
        method: &str,
        path: &str,
        token: Option<&str>,
        origin: Option<&str>,
        body: Option<String>,
    ) -> (u16, Vec<u8>) {
        http_request_as(
            address,
            method,
            path,
            token,
            origin,
            Some("00000000000000000000000000000001"),
            body,
        )
        .await
    }

    async fn http_request_as(
        address: SocketAddr,
        method: &str,
        path: &str,
        token: Option<&str>,
        origin: Option<&str>,
        owner: Option<&str>,
        body: Option<String>,
    ) -> (u16, Vec<u8>) {
        let authorization = token.map(|token| format!("Bearer {token}"));
        let (status, _, body) = raw_http_request(
            address,
            method,
            path,
            authorization.as_deref(),
            origin,
            owner,
            None,
            body,
        )
        .await;
        (status, body)
    }

    #[allow(clippy::too_many_arguments)]
    async fn raw_http_request(
        address: SocketAddr,
        method: &str,
        path: &str,
        authorization: Option<&str>,
        origin: Option<&str>,
        owner: Option<&str>,
        cookie: Option<&str>,
        body: Option<String>,
    ) -> (u16, String, Vec<u8>) {
        raw_http_request_with_host(
            address,
            &address.to_string(),
            method,
            path,
            authorization,
            origin,
            owner,
            cookie,
            body,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn raw_http_request_with_host(
        address: SocketAddr,
        host: &str,
        method: &str,
        path: &str,
        authorization: Option<&str>,
        origin: Option<&str>,
        owner: Option<&str>,
        cookie: Option<&str>,
        body: Option<String>,
    ) -> (u16, String, Vec<u8>) {
        let host = host.to_owned();
        let method = method.to_owned();
        let path = path.to_owned();
        let authorization = authorization.map(str::to_owned);
        let origin = origin.map(str::to_owned);
        let owner = owner.map(str::to_owned);
        let cookie = cookie.map(str::to_owned);
        tokio::task::spawn_blocking(move || {
            let body = body.unwrap_or_default();
            let mut request = format!(
                "{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Length: {}\r\n",
                body.len()
            );
            if let Some(authorization) = authorization {
                request.push_str(&format!("Authorization: {authorization}\r\n"));
            }
            if let Some(origin) = origin {
                request.push_str(&format!("Origin: {origin}\r\n"));
            }
            if let Some(owner) = owner {
                request.push_str(&format!("X-RSTorrent-Owner: {owner}\r\n"));
            }
            if let Some(cookie) = cookie {
                request.push_str(&format!("Cookie: {cookie}\r\n"));
            }
            if !body.is_empty() {
                request.push_str("Content-Type: application/json\r\n");
            }
            request.push_str("\r\n");
            request.push_str(&body);
            let mut stream = TcpStream::connect(address).expect("connect HTTP gateway");
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .expect("set HTTP timeout");
            stream
                .write_all(request.as_bytes())
                .expect("write HTTP request");
            let mut response = Vec::new();
            stream
                .read_to_end(&mut response)
                .expect("read HTTP response");
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("HTTP header terminator");
            let headers = std::str::from_utf8(&response[..split]).expect("HTTP response headers");
            let status = headers
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|status| status.parse().ok())
                .expect("HTTP response status");
            (status, headers.to_owned(), response[(split + 4)..].to_vec())
        })
        .await
        .expect("HTTP request task")
    }

    async fn raw_get_with_host(
        address: SocketAddr,
        host: &str,
        path: &str,
    ) -> (u16, String, Vec<u8>) {
        let host = host.to_owned();
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let request =
                format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
            let mut stream = TcpStream::connect(address).expect("connect HTTP gateway");
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .expect("set HTTP timeout");
            stream
                .write_all(request.as_bytes())
                .expect("write HTTP request");
            let mut response = Vec::new();
            stream
                .read_to_end(&mut response)
                .expect("read HTTP response");
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("HTTP response headers");
            let headers = String::from_utf8(response[..split].to_vec()).expect("HTTP headers");
            let status = headers
                .lines()
                .next()
                .and_then(|line| line.split_ascii_whitespace().nth(1))
                .and_then(|value| value.parse::<u16>().ok())
                .expect("HTTP response status");
            (status, headers, response[split + 4..].to_vec())
        })
        .await
        .expect("HTTP request task")
    }

    async fn raw_product_update_check(
        address: SocketAddr,
        host: &str,
        origin: &str,
        reason: &str,
    ) -> (u16, Vec<u8>) {
        let host = host.to_owned();
        let origin = origin.to_owned();
        let reason = reason.to_owned();
        tokio::task::spawn_blocking(move || {
            let request = format!(
                "POST /api/v1/product-update HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nX-Check-Reason: {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let mut stream = TcpStream::connect(address).expect("connect update route");
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .expect("set update timeout");
            stream
                .write_all(request.as_bytes())
                .expect("write update request");
            let mut response = Vec::new();
            stream.read_to_end(&mut response).expect("read update response");
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("update response headers");
            let status = std::str::from_utf8(&response[..split])
                .expect("update response headers")
                .lines()
                .next()
                .and_then(|line| line.split_ascii_whitespace().nth(1))
                .and_then(|value| value.parse::<u16>().ok())
                .expect("update response status");
            (status, response[split + 4..].to_vec())
        })
        .await
        .expect("update request task")
    }

    async fn web_auth_request(
        address: SocketAddr,
        method: &str,
        path: &str,
        origin: Option<&str>,
        cookie: Option<&str>,
        body: Option<String>,
    ) -> (u16, String, Vec<u8>) {
        raw_http_request(
            address,
            method,
            path,
            None,
            origin,
            Some("00000000000000000000000000000001"),
            cookie,
            body,
        )
        .await
    }

    fn response_cookie(headers: &str) -> String {
        headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("set-cookie").then(|| {
                    value
                        .trim()
                        .split(';')
                        .next()
                        .expect("cookie pair")
                        .to_owned()
                })
            })
            .expect("response session cookie")
    }

    async fn raw_torrent_request(
        address: SocketAddr,
        path: &str,
        token: &str,
        origin: &str,
        content_type: &str,
        body: Vec<u8>,
    ) -> (u16, Vec<u8>) {
        let path = path.to_owned();
        let token = token.to_owned();
        let origin = origin.to_owned();
        let content_type = content_type.to_owned();
        tokio::task::spawn_blocking(move || {
            let headers = format!(
                "POST {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Length: {}\r\nContent-Type: {content_type}\r\nAuthorization: Bearer {token}\r\nOrigin: {origin}\r\nX-RSTorrent-Owner: 00000000000000000000000000000001\r\n\r\n",
                body.len()
            );
            let mut stream = TcpStream::connect(address).expect("connect torrent HTTP route");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set torrent HTTP timeout");
            stream.write_all(headers.as_bytes()).expect("write headers");
            stream.write_all(&body).expect("write torrent body");
            let mut response = Vec::new();
            if let Err(error) = stream.read_to_end(&mut response) {
                assert_eq!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset,
                    "read torrent HTTP response"
                );
                assert!(!response.is_empty(), "server reset without a response");
            }
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("HTTP header terminator");
            let headers = std::str::from_utf8(&response[..split]).expect("response headers");
            let status = headers
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|status| status.parse().ok())
                .expect("response status");
            (status, response[(split + 4)..].to_vec())
        })
        .await
        .expect("torrent HTTP task")
    }

    fn torrent_source(ignored_bytes: usize) -> Vec<u8> {
        let mut source = format!("d7:comment{ignored_bytes}:").into_bytes();
        source.resize(source.len() + ignored_bytes, b'x');
        source.extend_from_slice(
            b"4:infod6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaaee",
        );
        source
    }

    fn torrent_source_with_exact_length(length: usize) -> Vec<u8> {
        let mut ignored_bytes = length.saturating_sub(128);
        loop {
            let source = torrent_source(ignored_bytes);
            match source.len().cmp(&length) {
                std::cmp::Ordering::Equal => return source,
                std::cmp::Ordering::Less => ignored_bytes += length - source.len(),
                std::cmp::Ordering::Greater => ignored_bytes -= source.len() - length,
            }
        }
    }

    fn torrent_upload_request(request_id: &str, source: &[u8]) -> AddTorrentBytesRequest {
        AddTorrentBytesRequest {
            version: rstorrent_session::CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            storage_root: "downloads".to_owned(),
            start_content: false,
            await_file_selection: false,
            selection: FileSelectionIntent::All,
            source_length: source.len() as u32,
        }
    }

    #[test]
    fn credential_comparison_includes_length_and_content() {
        assert!(constant_time_equal(b"token", b"token"));
        assert!(!constant_time_equal(b"token", b"taken"));
        assert!(!constant_time_equal(b"token", b"token-longer"));
    }

    #[test]
    fn basic_credentials_are_bounded_and_redacted() {
        let authentication =
            GatewayAuthentication::basic("preview", "doorstop").expect("valid basic credential");
        assert_eq!(
            format!("{authentication:?}"),
            "Basic { credential: [redacted] }"
        );
        assert!(GatewayAuthentication::basic("", "doorstop").is_err());
        assert!(GatewayAuthentication::basic("bad:name", "doorstop").is_err());
        assert!(GatewayAuthentication::basic("preview", "").is_err());
    }

    #[tokio::test]
    async fn loopback_gateway_mounts_capability_media_without_api_bearer_or_cors() {
        let root = test_root("gateway-media");
        let (service, torrent_id, payload) = verified_media_service(&root).await;
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "application-token".to_owned(),
                },
                allowed_origin: "http://127.0.0.1:5173".to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind gateway");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let (status, _, body) = raw_http_request(
            address,
            "POST",
            "/api/v1/media-urls",
            Some("Bearer application-token"),
            Some("http://127.0.0.1:5173"),
            Some("00000000000000000000000000000001"),
            None,
            Some(serde_json::json!({ "torrent_id": torrent_id, "file_index": 0 }).to_string()),
        )
        .await;
        assert_eq!(status, 200);
        let response: MediaUrlResponse = serde_json::from_slice(&body).expect("media URL response");
        let MediaUrlOutcome::Created { url, .. } = response.outcome else {
            panic!("gateway media unavailable")
        };
        assert!(url.starts_with(&format!("http://{address}/media/v1/")));
        let path = url
            .strip_prefix(&format!("http://{address}"))
            .expect("same listener URL")
            .to_owned();
        let (status, headers, body) =
            raw_http_request(address, "GET", &path, None, None, None, None, None).await;
        assert_eq!(status, 200);
        assert_eq!(body, payload);
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("accept-ranges: bytes")
        );
        assert!(
            !headers
                .to_ascii_lowercase()
                .contains("access-control-allow-origin")
        );

        let (status, _, _) = raw_http_request(
            address,
            "GET",
            "/media/v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(status, 404);

        shutdown.cancel();
        task.await.expect("gateway task").expect("gateway shutdown");
        service
            .lock()
            .await
            .shutdown()
            .await
            .expect("shutdown service");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn raw_http_torrent_upload_uses_route_only_binary_limit() {
        let root = test_root("http-torrent-upload");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let source = torrent_source_with_exact_length(MAX_TORRENT_SOURCE_BYTES);
        assert_eq!(source.len(), MAX_TORRENT_SOURCE_BYTES);
        let path =
            "/api/v1/torrents?request_id=http-upload&storage_root=downloads&start_content=false";

        let (status, body) = raw_torrent_request(
            address,
            path,
            "correct-token",
            origin,
            "application/x-bittorrent",
            source.clone(),
        )
        .await;
        assert_eq!(status, 200);
        let accepted: rstorrent_session::ResponseEnvelope =
            serde_json::from_slice(&body).expect("torrent response");
        assert!(matches!(accepted.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(accepted.revision, "1");

        let (status, _) = raw_torrent_request(
            address,
            path,
            "correct-token",
            origin,
            "application/octet-stream",
            torrent_source(1),
        )
        .await;
        assert_eq!(status, 400);
        let snapshot = service
            .lock()
            .await
            .storage_snapshot()
            .expect("storage snapshot");
        assert_eq!(snapshot.roots.len(), 1);
        assert_eq!(service.lock().await.revision().expect("revision"), 1);

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn torrent_list_exports_and_imports_over_http() {
        let root = test_root("http-torrent-list");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let (status, _) = raw_torrent_request(
            address,
            "/api/v1/torrents?request_id=list-source&storage_root=downloads&start_content=false",
            "correct-token",
            origin,
            "application/x-bittorrent",
            torrent_source(1),
        )
        .await;
        assert_eq!(status, 200);

        let bundle = tokio::task::spawn_blocking(move || {
            let mut stream = TcpStream::connect(address).expect("connect export route");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("timeout");
            stream
                .write_all(
                    format!(
                        "POST /api/v1/torrent-list/export HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Length: 0\r\nAuthorization: Bearer correct-token\r\nOrigin: {origin}\r\nX-RSTorrent-Owner: 00000000000000000000000000000001\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .expect("write export request");
            let mut response = Vec::new();
            stream.read_to_end(&mut response).expect("read export");
            let split = response
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("header terminator");
            let headers = String::from_utf8_lossy(&response[..split]).to_ascii_lowercase();
            assert!(headers.starts_with("http/1.1 200"), "{headers}");
            assert!(headers.contains("content-type: application/zip"), "{headers}");
            response[split + 4..].to_vec()
        })
        .await
        .expect("export task");
        assert_eq!(&bundle[..2], b"PK");

        let import = "/api/v1/torrent-list/import?storage_root=downloads";
        let (status, body) = raw_torrent_request(
            address,
            import,
            "correct-token",
            origin,
            "application/zip",
            bundle.clone(),
        )
        .await;
        assert_eq!(status, 200, "{}", String::from_utf8_lossy(&body));
        let report: rstorrent_session::TorrentListImportReport =
            serde_json::from_slice(&body).expect("import report");
        assert_eq!(report.already_present, 1);
        assert_eq!(report.added, 0);

        let (status, _) = raw_torrent_request(
            address,
            import,
            "correct-token",
            origin,
            "application/octet-stream",
            bundle,
        )
        .await;
        assert_eq!(status, 400);
        let (status, _) = raw_torrent_request(
            address,
            import,
            "wrong-token",
            origin,
            "application/zip",
            b"PK".to_vec(),
        )
        .await;
        assert_eq!(status, 401);

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn websocket_torrent_upload_requires_ready_and_correlates_result() {
        let root = test_root("websocket-torrent-upload");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: Some("correct-token".to_owned()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        let source = torrent_source_with_exact_length(MAX_TORRENT_SOURCE_BYTES);
        assert_eq!(source.len(), MAX_TORRENT_SOURCE_BYTES);
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::BeginTorrentUpload {
                call_id: "upload-call".to_owned(),
                upload_id: "upload-body".to_owned(),
                request: torrent_upload_request("ws-upload", &source),
            },
        )
        .await;
        assert_eq!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::TorrentUploadReady {
                call_id: "upload-call".to_owned(),
                upload_id: "upload-body".to_owned(),
            }
        );
        let upload_started = Instant::now();
        socket
            .send(Message::Binary(source.into()))
            .await
            .expect("send torrent bytes");
        socket
            .send(Message::Ping(b"after-maximum-upload".to_vec().into()))
            .await
            .expect("queue post-upload control frame");
        let mut upload_result = None;
        let mut control_elapsed = None;
        while upload_result.is_none() || control_elapsed.is_none() {
            let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .expect("maximum upload response timed out")
                .expect("application connection closed")
                .expect("maximum upload websocket response");
            match message {
                Message::Pong(payload) if payload.as_ref() == b"after-maximum-upload" => {
                    control_elapsed = Some(upload_started.elapsed());
                }
                Message::Text(text) => {
                    let frame: ApplicationServerFrame =
                        serde_json::from_str(&text).expect("decode maximum upload result");
                    let ApplicationServerFrame::Result {
                        call_id,
                        result: ApplicationCallResult::CommandResponse { response },
                    } = frame
                    else {
                        panic!("expected correlated torrent result");
                    };
                    upload_result = Some((call_id, response, upload_started.elapsed()));
                }
                other => panic!("unexpected maximum upload response: {other:?}"),
            }
        }
        let (call_id, response, result_elapsed) = upload_result.expect("upload result");
        let control_elapsed = control_elapsed.expect("queued control response");
        assert_eq!(call_id, "upload-call");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(response.revision, "1");
        println!(
            "maximum WebSocket torrent result: {} ms; queued control: {} ms",
            result_elapsed.as_millis(),
            control_elapsed.as_millis()
        );
        socket.close(None).await.expect("close socket");

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn hosted_assets_require_basic_auth_and_exact_origin() {
        let root = test_root("hosted-assets");
        let web_root = root.join("web");
        std::fs::create_dir_all(web_root.join("assets")).expect("create web root");
        std::fs::write(web_root.join("index.html"), b"private-preview-index").expect("write index");
        std::fs::write(web_root.join("assets/app.js"), b"private-preview-asset")
            .expect("write asset");
        let service = test_service(&root).await;
        let origin = "https://preview.example";
        let authentication =
            GatewayAuthentication::basic("preview", "doorstop").expect("basic auth");
        let authorization = match &authentication {
            GatewayAuthentication::Basic(credentials) => credentials.authorization.clone(),
            _ => unreachable!("constructed basic authentication"),
        };
        let server = bind_hosted(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication,
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            service.clone(),
            HostedAssets::new(web_root, "test-build".to_owned()).expect("hosted assets"),
        )
        .await
        .expect("bind hosted server");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        let (status, headers, _) = raw_http_request_with_host(
            address,
            "preview.example",
            "GET",
            "/",
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(status, 401);
        assert!(headers.contains("www-authenticate: Basic realm=\"JSTorrent\""));
        assert_eq!(
            raw_http_request_with_host(
                address,
                "preview.example",
                "GET",
                "/",
                Some("Basic wrong"),
                None,
                None,
                None,
                None,
            )
            .await
            .0,
            401
        );
        let (status, _, body) = raw_http_request_with_host(
            address,
            "preview.example",
            "GET",
            "/",
            Some(&authorization),
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body, b"private-preview-index");
        let (status, _, body) = raw_http_request_with_host(
            address,
            "preview.example",
            "GET",
            "/healthz",
            Some(&authorization),
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("health JSON"),
            serde_json::json!({"status": "ok", "build_id": "test-build"})
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                "preview.example",
                "GET",
                "/assets/missing.js",
                Some(&authorization),
                None,
                None,
                None,
                None,
            )
            .await
            .0,
            404
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                "wrong.example",
                "GET",
                "/healthz",
                Some(&authorization),
                None,
                None,
                None,
                None,
            )
            .await
            .0,
            403
        );

        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        request.headers_mut().insert(
            "Authorization",
            authorization.parse().expect("authorization"),
        );
        request
            .headers_mut()
            .insert("Host", "preview.example".parse().expect("host"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: None,
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        socket.close(None).await.expect("close socket");

        let mut wrong_origin = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        wrong_origin
            .headers_mut()
            .insert("Origin", "https://wrong.example".parse().expect("origin"));
        wrong_origin.headers_mut().insert(
            "Authorization",
            authorization.parse().expect("authorization"),
        );
        wrong_origin
            .headers_mut()
            .insert("Host", "preview.example".parse().expect("host"));
        assert!(connect_async(wrong_origin).await.is_err());

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn application_connection_multiplexes_calls_and_acknowledged_views() {
        let root = test_root("application-websocket");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: Some("correct-token".to_owned()),
            },
        )
        .await;
        let ApplicationServerFrame::Connected { hello, .. } =
            read_application_message(&mut socket).await
        else {
            panic!("expected connected response");
        };
        assert!(
            hello
                .deliveries
                .contains(&rstorrent_session::DeliveryMode::Stream)
        );

        let library = ViewSpec::TorrentList {
            view_id: "library".to_owned(),
            delivery: ViewDeliveryPolicy::default(),
        };
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "open".to_owned(),
                operation: ApplicationCall::OpenViewSet {
                    request: OpenViewSetRequest {
                        views: vec![library.clone()],
                        options: OpenViewSetOptions::default(),
                    },
                },
            },
        )
        .await;
        let ApplicationServerFrame::Result {
            call_id,
            result: ApplicationCallResult::ViewSetOpened { response },
        } = read_application_message(&mut socket).await
        else {
            panic!("expected open result");
        };
        assert_eq!(call_id, "open");
        let opened = *response;
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Attach {
                call_id: "attach".to_owned(),
                stream_id: "general".to_owned(),
                view_set_id: opened.view_set_id.clone(),
                after: opened.initial.cursor.clone(),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Attached { ref stream_id, .. } if stream_id == "general"
        ));

        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "update-one".to_owned(),
                operation: ApplicationCall::UpdateViewSet {
                    view_set_id: opened.view_set_id.clone(),
                    request: UpdateViewSetRequest {
                        views: vec![
                            library.clone(),
                            ViewSpec::SessionDisk {
                                view_id: "disk".to_owned(),
                                delivery: ViewDeliveryPolicy::default(),
                            },
                        ],
                    },
                },
            },
        )
        .await;
        let mut first_batch = None;
        let mut update_result = false;
        while first_batch.is_none() || !update_result {
            match read_application_message(&mut socket).await {
                ApplicationServerFrame::ViewBatch { stream_id, batch }
                    if stream_id == "general" =>
                {
                    first_batch = Some(*batch);
                }
                ApplicationServerFrame::Result {
                    call_id,
                    result: ApplicationCallResult::ViewSetUpdated,
                } if call_id == "update-one" => update_result = true,
                other => panic!("unexpected application frame: {other:?}"),
            }
        }
        let first_batch = first_batch.expect("first batch");

        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "snapshot".to_owned(),
                operation: ApplicationCall::Dispatch {
                    request: Box::new(RequestEnvelope {
                        version: rstorrent_session::CONTROL_VERSION,
                        request_id: "snapshot-command".to_owned(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    }),
                },
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Result {
                ref call_id,
                result: ApplicationCallResult::CommandResponse { .. },
            } if call_id == "snapshot"
        ));

        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Ack {
                stream_id: "general".to_owned(),
                cursor: first_batch.cursor,
            },
        )
        .await;
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "update-two".to_owned(),
                operation: ApplicationCall::UpdateViewSet {
                    view_set_id: opened.view_set_id,
                    request: UpdateViewSetRequest {
                        views: vec![library],
                    },
                },
            },
        )
        .await;
        let mut second_cursor = None;
        while second_cursor.is_none() {
            if let ApplicationServerFrame::ViewBatch { stream_id, batch } =
                read_application_message(&mut socket).await
                && stream_id == "general"
            {
                second_cursor = Some(batch.cursor.clone());
            }
        }
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Ack {
                stream_id: "general".to_owned(),
                cursor: "999".to_owned(),
            },
        )
        .await;
        loop {
            if matches!(
                read_application_message(&mut socket).await,
                ApplicationServerFrame::StreamError {
                    ref stream_id,
                    ref error,
                } if stream_id == "general"
                    && error.code == ApplicationConnectionErrorCode::InvalidCursor
            ) {
                break;
            }
        }

        socket.close(None).await.expect("close");
        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn application_connection_rejects_bad_handshakes_and_repeated_invalid_input() {
        let root = test_root("application-websocket-rejections");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 4,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let metrics = server.connection_metrics();
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        let mut wrong_origin = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        wrong_origin.headers_mut().insert(
            "Origin",
            "https://attacker.invalid".parse().expect("origin"),
        );
        let error = connect_async(wrong_origin)
            .await
            .expect_err("wrong origin must not upgrade");
        assert!(matches!(
            error,
            tokio_tungstenite::tungstenite::Error::Http(response)
                if response.status() == axum::http::StatusCode::FORBIDDEN
        ));

        for (api_version, token, expected) in [
            (
                rstorrent_session::API_VERSION,
                Some("wrong-token"),
                ApplicationConnectionErrorCode::AuthenticationFailed,
            ),
            (
                rstorrent_session::API_VERSION + 1,
                Some("correct-token"),
                ApplicationConnectionErrorCode::InvalidVersion,
            ),
        ] {
            let mut request = format!("ws://{address}/api/v1/connect")
                .into_client_request()
                .expect("request");
            request
                .headers_mut()
                .insert("Origin", origin.parse().expect("origin"));
            let (mut socket, _) = connect_async(request).await.expect("connect");
            send_application_message(
                &mut socket,
                &ApplicationClientFrame::Connect {
                    api_version,
                    encoding: rstorrent_session::ApiEncoding::Json,
                    client_instance_id: "00000000000000000000000000000001".to_owned(),
                    token: token.map(str::to_owned),
                },
            )
            .await;
            assert!(matches!(
                read_application_message(&mut socket).await,
                ApplicationServerFrame::ConnectionError { error }
                    if error.code == expected
            ));
        }

        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut silent_socket, _) = connect_async(request).await.expect("connect");
        let timeout_message = tokio::time::timeout(Duration::from_secs(6), silent_socket.next())
            .await
            .expect("handshake rejection timed out")
            .expect("handshake socket closed without an error")
            .expect("read handshake rejection");
        let Message::Text(timeout_text) = timeout_message else {
            panic!("expected handshake rejection text");
        };
        assert!(matches!(
            serde_json::from_str::<ApplicationServerFrame>(&timeout_text)
                .expect("decode handshake rejection"),
            ApplicationServerFrame::ConnectionError { error }
                if error.code == ApplicationConnectionErrorCode::InvalidMessage
        ));

        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: Some("correct-token".to_owned()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        for _ in 0..3 {
            socket
                .send(Message::Text("{}".into()))
                .await
                .expect("send invalid frame");
            assert!(matches!(
                read_application_message(&mut socket).await,
                ApplicationServerFrame::ConnectionError { error }
                    if error.code == ApplicationConnectionErrorCode::InvalidMessage
            ));
        }
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), socket.next())
                .await
                .expect("protocol close timed out")
                .expect("connection ended before close")
                .expect("read close"),
            Message::Close(_)
        ));

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.rejected_origins, 1);
        assert_eq!(snapshot.rejected_authentication, 1);
        assert_eq!(snapshot.rejected_handshakes, 2);
        assert_eq!(snapshot.accepted_connections, 1);
        assert_eq!(snapshot.active_connections, 0);
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn large_file_snapshot_keeps_command_latency_bounded() {
        let root = test_root("large-application-frame");
        let profile = root.join("profile");
        let payload = root.join("payload");
        let configured = ConfiguredStorageRoot::path("downloads", payload.clone());
        let raw_info = large_file_raw_info();
        let info_hash = hex_digest(Sha1::digest(&raw_info).as_slice());
        let magnet = format!("magnet:?xt=urn:btih:{info_hash}&x.pe=127.0.0.1:1");
        let torrent_id = {
            let mut store = SessionStore::open(&profile, "test", std::slice::from_ref(&configured))
                .expect("open seeded store");
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: rstorrent_session::CONTROL_VERSION,
                    request_id: "seed-large-files".to_owned(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet,
                        storage_root: "downloads".to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("seed torrent");
            let torrent_id = match response.result {
                Some(CommandResult::AddTorrent { result }) => result.torrent_id,
                _ => panic!("missing large-file add result"),
            };
            store
                .record_metadata(&torrent_id, &raw_info)
                .expect("record large metadata");
            torrent_id
        };
        let service = Arc::new(Mutex::new(
            ApplicationService::open(ApplicationConfig::new(
                profile,
                "test".to_owned(),
                vec![configured],
                NetworkConfig::new(
                    NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            ))
            .await
            .expect("open application"),
        ));
        let origin = "http://127.0.0.1:5173";
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: origin.to_owned(),
                max_connections: 1,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let metrics = server.connection_metrics();
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: Some("correct-token".to_owned()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "large-open".to_owned(),
                operation: ApplicationCall::OpenViewSet {
                    request: OpenViewSetRequest {
                        views: vec![ViewSpec::TorrentFiles {
                            view_id: "files".to_owned(),
                            torrent_id: torrent_id.clone(),
                            page: None,
                            delivery: ViewDeliveryPolicy::default(),
                        }],
                        options: OpenViewSetOptions::default(),
                    },
                },
            },
        )
        .await;
        let command_started = std::time::Instant::now();
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "small-command".to_owned(),
                operation: ApplicationCall::Dispatch {
                    request: Box::new(RequestEnvelope {
                        version: rstorrent_session::CONTROL_VERSION,
                        request_id: "large-frame-snapshot".to_owned(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    }),
                },
            },
        )
        .await;
        let mut large_bytes = None;
        let mut command_latency = None;
        while large_bytes.is_none() || command_latency.is_none() {
            match read_application_message(&mut socket).await {
                ApplicationServerFrame::Result {
                    call_id,
                    result: ApplicationCallResult::ViewSetOpened { response },
                } if call_id == "large-open" => {
                    let catalog = response
                        .initial
                        .updates
                        .iter()
                        .find_map(|update| match update {
                            ViewSetUpdate::Snapshot {
                                snapshot: ViewSnapshot::Files { files, page, .. },
                                ..
                            } => Some((files.len(), page.total)),
                            _ => None,
                        });
                    assert_eq!(catalog, Some((1_024, 4_096)));
                    large_bytes = Some(
                        serde_json::to_vec(&response)
                            .expect("encode large response")
                            .len(),
                    );
                }
                ApplicationServerFrame::Result {
                    call_id,
                    result: ApplicationCallResult::CommandResponse { .. },
                } if call_id == "small-command" => {
                    command_latency = Some(command_started.elapsed());
                }
                other => panic!("unexpected application frame: {other:?}"),
            }
        }
        let large_bytes = large_bytes.expect("large response bytes");
        let command_latency = command_latency.expect("command latency");
        assert!(
            large_bytes > 256 * 1_024,
            "catalog page response was {large_bytes} bytes"
        );
        assert!(
            command_latency < Duration::from_secs(2),
            "small command took {command_latency:?} beside the large frame"
        );

        socket.close(None).await.expect("close");
        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        let snapshot = metrics.snapshot();
        assert!(snapshot.outbound_message_bytes_high_water > 256 * 1_024);
        assert_eq!(snapshot.active_connections, 0);
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
        eprintln!(
            "large_application_frame encoded_bytes={large_bytes} command_latency_micros={}",
            command_latency.as_micros()
        );
    }

    fn large_file_raw_info() -> Vec<u8> {
        let mut output = Vec::new();
        output.extend_from_slice(b"d5:filesl");
        for index in 0..4_096_u32 {
            output.extend_from_slice(b"d6:lengthi1e4:pathl");
            push_bencode_bytes(&mut output, format!("directory-{index:04}").as_bytes());
            push_bencode_bytes(&mut output, "x".repeat(128).as_bytes());
            output.extend_from_slice(b"ee");
        }
        output.extend_from_slice(b"e4:name13:large-fixture12:piece lengthi16384e6:pieces20:");
        output.extend_from_slice(&[0_u8; 20]);
        output.push(b'e');
        output
    }

    fn push_bencode_bytes(output: &mut Vec<u8>, value: &[u8]) {
        output.extend_from_slice(value.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(value);
    }

    fn hex_digest(bytes: &[u8]) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            output.push(char::from(HEX[usize::from(byte >> 4)]));
            output.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
        output
    }

    #[tokio::test]
    async fn enforces_origin_and_authentication_before_dispatch() {
        let root = test_root("auth");
        let service = test_service(&root).await;
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: "http://127.0.0.1:5173".to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task_shutdown = shutdown.clone();
        let task = tokio::spawn(server.serve(task_shutdown));
        let url = format!("ws://{address}/api/v1/connect");

        let mut bad_origin = url.clone().into_client_request().expect("request");
        bad_origin.headers_mut().insert(
            "Origin",
            "https://attacker.invalid".parse().expect("origin"),
        );
        assert!(connect_async(bad_origin).await.is_err());

        let mut request = url.clone().into_client_request().expect("request");
        request
            .headers_mut()
            .insert("Origin", "http://127.0.0.1:5173".parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: Some("wrong-token".to_owned()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::ConnectionError { error }
                if error.code == ApplicationConnectionErrorCode::AuthenticationFailed
        ));

        let mut request = url.into_client_request().expect("request");
        request
            .headers_mut()
            .insert("Origin", "http://127.0.0.1:5173".parse().expect("origin"));
        let (mut socket, _) = connect_async(request).await.expect("reconnect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000002".to_owned(),
                token: Some("correct-token".to_owned()),
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Call {
                call_id: "snapshot-call".to_owned(),
                operation: ApplicationCall::Dispatch {
                    request: Box::new(RequestEnvelope {
                        version: rstorrent_session::CONTROL_VERSION,
                        request_id: "snapshot".to_owned(),
                        expected_revision: None,
                        command: Command::Snapshot,
                    }),
                },
            },
        )
        .await;
        let ApplicationServerFrame::Result {
            result: ApplicationCallResult::CommandResponse { response },
            ..
        } = read_application_message(&mut socket).await
        else {
            panic!("expected command response");
        };
        assert!(matches!(
            response.outcome,
            rstorrent_session::ResponseOutcome::Success { ref snapshot }
                if snapshot.torrents.is_empty()
        ));
        assert_eq!(
            http_request(
                address,
                "GET",
                "/control",
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                None,
            )
            .await
            .0,
            404
        );

        socket.close(None).await.expect("close");
        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn folder_picker_requires_http_auth_and_installs_selected_root() {
        let root = test_root("folder-picker");
        let service = test_service(&root).await;
        let selected = root.join("selected downloads");
        std::fs::create_dir_all(&selected).expect("create selection");
        let picker = Arc::new(FixedDirectoryPicker {
            selected: Some(selected.clone()),
            calls: AtomicU64::new(0),
        });
        let server = bind_with_picker(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: "http://127.0.0.1:5173".to_owned(),
                max_connections: 2,
            },
            service.clone(),
            picker.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        assert_eq!(
            http_request(
                address,
                "POST",
                "/api/v1/platform/download-root",
                Some("correct-token"),
                Some("https://attacker.invalid"),
                Some("{}".to_owned()),
            )
            .await
            .0,
            403
        );
        assert_eq!(picker.calls.load(Ordering::Relaxed), 0);

        let (status, body) = http_request(
            address,
            "POST",
            "/api/v1/platform/download-root",
            Some("correct-token"),
            Some("http://127.0.0.1:5173"),
            Some("{}".to_owned()),
        )
        .await;
        assert_eq!(status, 200);
        let response: ChooseDownloadRootResponse =
            serde_json::from_slice(&body).expect("folder picker response");
        let installed = response.root.expect("installed root");
        assert_eq!(installed.label, "selected downloads");
        assert_eq!(
            installed.display_path.as_deref(),
            selected
                .canonicalize()
                .expect("canonical selected path")
                .to_str()
        );
        assert_eq!(picker.calls.load(Ordering::Relaxed), 1);

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn http_view_sets_enforce_auth_replay_bounds_and_shutdown() {
        let root = test_root("http-view-set");
        let service = test_service(&root).await;
        let server = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "correct-token".to_owned(),
                },
                allowed_origin: "http://127.0.0.1:5173".to_owned(),
                max_connections: 2,
            },
            service.clone(),
        )
        .await
        .expect("bind");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        assert_eq!(
            http_request(address, "GET", "/api/v1/hello", None, None, None)
                .await
                .0,
            403
        );
        assert_eq!(
            http_request(
                address,
                "GET",
                "/api/v1/hello",
                None,
                Some("http://127.0.0.1:5173"),
                None,
            )
            .await
            .0,
            401
        );
        assert_eq!(
            http_request(
                address,
                "GET",
                "/api/v1/hello",
                Some("correct-token"),
                Some("https://attacker.invalid"),
                None,
            )
            .await
            .0,
            403
        );
        assert_eq!(
            http_request(
                address,
                "GET",
                "/api/v1/hello",
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                None,
            )
            .await
            .0,
            200
        );
        assert_eq!(
            http_request_as(
                address,
                "GET",
                "/api/v1/hello",
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                None,
                None,
            )
            .await
            .0,
            401
        );

        let open_body = serde_json::json!({
            "views": [{
                "type": "torrent_list",
                "view_id": "library",
                // Keep ordinary background patches pending while the long
                // poll proves that gateway shutdown wakes it with 410.
                "delivery": { "min_interval_millis": 60_000 }
            }],
            "options": {}
        })
        .to_string();
        let (status, body) = http_request(
            address,
            "POST",
            "/api/v1/view-sets",
            Some("correct-token"),
            Some("http://127.0.0.1:5173"),
            Some(open_body),
        )
        .await;
        assert_eq!(status, 201);
        let opened: OpenViewSetResponse = serde_json::from_slice(&body).expect("open response");

        let replay_path = format!(
            "/api/v1/view-sets/{}/updates?after=0&wait_ms=0",
            opened.view_set_id
        );
        assert_eq!(
            http_request_as(
                address,
                "GET",
                &replay_path,
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                Some("00000000000000000000000000000002"),
                None,
            )
            .await
            .0,
            404,
            "another browser owner must not acquire a view set by ID"
        );
        let (status, body) = http_request(
            address,
            "GET",
            &replay_path,
            Some("correct-token"),
            Some("http://127.0.0.1:5173"),
            None,
        )
        .await;
        assert_eq!(status, 200);
        let replay: UpdateBatch = serde_json::from_slice(&body).expect("replay response");
        assert!(
            replay
                .server_now_millis
                .parse::<u64>()
                .expect("replay clock")
                >= opened
                    .initial
                    .server_now_millis
                    .parse::<u64>()
                    .expect("initial clock")
        );
        let expected_replay = UpdateBatch {
            server_now_millis: replay.server_now_millis.clone(),
            ..opened.initial.clone()
        };
        assert_eq!(replay, expected_replay);

        let invalid_wait = format!(
            "/api/v1/view-sets/{}/updates?after={}&wait_ms=20001",
            opened.view_set_id, opened.initial.cursor
        );
        assert_eq!(
            http_request(
                address,
                "GET",
                &invalid_wait,
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                None,
            )
            .await
            .0,
            400
        );
        let oversized = format!("{{\"views\":[],\"future\":\"{}\"}}", "x".repeat(70_000));
        assert_eq!(
            http_request(
                address,
                "POST",
                "/api/v1/view-sets",
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                Some(oversized),
            )
            .await
            .0,
            400
        );

        let wait_path = format!(
            "/api/v1/view-sets/{}/updates?after={}&wait_ms=20000",
            opened.view_set_id, opened.initial.cursor
        );
        let waiter = tokio::spawn(async move {
            http_request(
                address,
                "GET",
                &wait_path,
                Some("correct-token"),
                Some("http://127.0.0.1:5173"),
                None,
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        shutdown.cancel();
        let (status, _) = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("long poll did not wake")
            .expect("long poll task");
        assert_eq!(status, 410);
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn unauthenticated_development_mode_is_loopback_and_origin_bounded() {
        let root = test_root("http-development");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:4177";
        let mut fixed = GatewayConfig::unauthenticated_loopback_development(origin.to_owned());
        fixed.bind = "127.0.0.1:4177".parse().expect("fixed address");
        fixed.validate().expect("fixed development loopback");
        let server = bind(
            GatewayConfig::unauthenticated_loopback_development(origin.to_owned()),
            service.clone(),
        )
        .await
        .expect("bind development gateway");
        assert_ne!(server.local_addr().port(), 0);
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        assert_eq!(
            http_request(address, "GET", "/api/v1/hello", None, Some(origin), None)
                .await
                .0,
            200
        );
        assert_eq!(
            http_request(
                address,
                "GET",
                "/api/v1/hello",
                None,
                Some("http://127.0.0.1:4178"),
                None,
            )
            .await
            .0,
            403
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn crostini_hosting_is_explicit_exact_and_serves_the_extension_handoff() {
        let root = test_root("crostini-hosted");
        let web_root = root.join("web");
        std::fs::create_dir_all(&web_root).expect("create web root");
        std::fs::write(web_root.join("index.html"), b"crostini-index").expect("write index");
        let service = test_service(&root).await;
        let reservation = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve port");
        let port = reservation.local_addr().expect("reserved address").port();
        drop(reservation);
        let origin = format!("http://jstorrent.localhost:{port}");
        let config = GatewayConfig {
            bind: format!("0.0.0.0:{port}").parse().expect("address"),
            authentication: GatewayAuthentication::Web(WebAuthenticationConfig {
                database: root.join("profile/web-auth.sqlite3"),
                pairing_window: false,
                policy_override: None,
            }),
            allowed_origin: origin.clone(),
            max_connections: 2,
        };
        let assets = HostedAssets::new(web_root, "crostini-test".to_owned())
            .expect("hosted assets")
            .with_chromeos_handoff(JSTORRENT_BETA_EXTENSION_ID.to_owned())
            .expect("handoff identity");
        let server = bind_crostini_hosted(config, service.clone(), assets)
            .await
            .expect("bind Crostini gateway");
        let address = SocketAddr::from(([127, 0, 0, 1], server.local_addr().port()));
        let host = format!("jstorrent.localhost:{}", address.port());
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        assert_eq!(
            raw_get_with_host(address, "attacker.example", "/").await.0,
            403
        );
        for rejected in [
            format!("localhost:{port}"),
            format!("127.0.0.1:{port}"),
            format!("other.localhost:{port}"),
            format!("penguin.linux.test:{port}"),
            format!("jstorrent.localhost.evil:{port}"),
        ] {
            assert_eq!(raw_get_with_host(address, &rejected, "/").await.0, 403);
        }
        // Pair a browser at the dedicated origin. The cookie remains host-only;
        // even possession of it does not permit a foreign Origin to mutate state.
        let (status, headers, _) = raw_http_request_with_host(
            address,
            &host,
            "POST",
            "/api/v1/web-auth/policy",
            None,
            Some(&origin),
            None,
            None,
            Some(r#"{"policy":"paired","label":"Crostini browser"}"#.to_owned()),
        )
        .await;
        assert_eq!(status, 201);
        let cookie_header = headers
            .lines()
            .find(|line| line.starts_with("set-cookie:"))
            .expect("session cookie");
        assert!(cookie_header.contains("HttpOnly; SameSite=Strict; Path=/"));
        assert!(!cookie_header.to_ascii_lowercase().contains("domain="));
        let cookie = cookie_header
            .trim_start_matches("set-cookie: ")
            .split(';')
            .next()
            .expect("cookie value");
        for rejected in [
            format!("http://localhost:{port}"),
            format!("http://other.localhost:{port}"),
            format!("http://penguin.linux.test:{port}"),
            format!("http://jstorrent.localhost:{}", port ^ 1),
        ] {
            assert_eq!(
                raw_http_request_with_host(
                    address,
                    &host,
                    "POST",
                    "/api/v1/web-auth/logout",
                    None,
                    Some(&rejected),
                    None,
                    Some(cookie),
                    None
                )
                .await
                .0,
                403
            );
        }
        assert_eq!(
            raw_http_request_with_host(
                address,
                &host,
                "GET",
                "/api/v1/web-auth/sessions",
                None,
                Some(&origin),
                None,
                None,
                None
            )
            .await
            .0,
            401
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                &host,
                "GET",
                "/api/v1/web-auth/sessions",
                None,
                Some(&origin),
                None,
                Some(cookie),
                None
            )
            .await
            .0,
            200
        );
        let (status, _, body) = raw_get_with_host(address, &host, "/healthz").await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("health JSON"),
            serde_json::json!({
                "status": "ok",
                "build_id": "crostini-test",
                "product": CROSTINI_PRODUCT,
                "launch_protocol": CROSTINI_LAUNCH_PROTOCOL_VERSION,
            })
        );
        let (status, headers, body) = raw_get_with_host(address, &host, "/launch-chromeos").await;
        assert_eq!(status, 200);
        assert!(headers.contains("content-security-policy: default-src 'none'"));
        let body = String::from_utf8(body).expect("handoff HTML");
        assert!(body.contains(JSTORRENT_BETA_EXTENSION_ID));
        assert!(body.contains("data-protocol-version=\"1\""));
        assert!(body.contains("Opening JSTorrent"));
        assert!(!body.contains("RSTorrent"));
        assert!(headers.contains("style-src 'self'; img-src 'self'"));
        let (style_status, style_headers, style) =
            raw_get_with_host(address, &host, "/launch-chromeos.css").await;
        assert_eq!(style_status, 200);
        assert!(style_headers.contains("text/css"));
        assert!(
            String::from_utf8(style)
                .unwrap()
                .contains("prefers-color-scheme")
        );
        let (icon_status, icon_headers, icon) =
            raw_get_with_host(address, &host, "/launch-chromeos.png").await;
        assert_eq!(icon_status, 200);
        assert!(icon_headers.contains("image/png"));
        assert!(icon.starts_with(b"\x89PNG"));
        assert!(!body.contains("chrome-extension://"));
        let (status, _, script) = raw_get_with_host(address, &host, "/launch-chromeos.js").await;
        assert_eq!(status, 200);
        let script = String::from_utf8(script).expect("handoff script");
        assert!(script.contains("openCrostiniUi"));
        assert!(!script.contains("fetch("));
        assert_eq!(
            raw_get_with_host(address, &host, "/").await.2,
            b"crostini-index"
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn crostini_configuration_rejects_implicit_or_broader_networks() {
        let root = test_root("crostini-config");
        let valid = || GatewayConfig {
            bind: "0.0.0.0:3030".parse().expect("address"),
            authentication: GatewayAuthentication::Web(WebAuthenticationConfig {
                database: root.join("web-auth.sqlite3"),
                pairing_window: false,
                policy_override: Some(WebAccessPolicy::LocalOpen),
            }),
            allowed_origin: "http://jstorrent.localhost:3030".to_owned(),
            max_connections: 2,
        };
        assert!(valid().validate_crostini().is_ok());

        let mut wrong_host = valid();
        wrong_host.allowed_origin = "http://100.115.92.2:3030".to_owned();
        assert!(wrong_host.validate_crostini().is_err());
        let mut wrong_port = valid();
        wrong_port.allowed_origin = "http://jstorrent.localhost:4040".to_owned();
        assert!(wrong_port.validate_crostini().is_err());
        let mut loopback = valid();
        loopback.bind = "127.0.0.1:3030".parse().expect("address");
        assert!(loopback.validate_crostini().is_err());
        let mut bearer = valid();
        bearer.authentication = GatewayAuthentication::Bearer {
            token: "secret".to_owned(),
        };
        assert!(bearer.validate_crostini().is_err());
        assert!(
            HostedAssets::new(root, "build".to_owned())
                .expect_err("missing index is rejected")
                .to_string()
                .contains("index.html")
        );
    }

    #[tokio::test]
    async fn local_hosted_development_serves_one_same_origin_application() {
        let root = test_root("local-hosted-development");
        let web_root = root.join("web");
        std::fs::create_dir_all(web_root.join("assets")).expect("create web root");
        std::fs::write(web_root.join("index.html"), b"local-hosted-index").expect("write index");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:4177";
        let mut config = GatewayConfig::unauthenticated_loopback_development(origin.to_owned());
        config.bind = "127.0.0.1:0".parse().expect("address");
        let server = bind_local_hosted(
            config,
            service.clone(),
            HostedAssets::new(web_root, "local-build".to_owned()).expect("hosted assets"),
        )
        .await
        .expect("bind local hosted gateway");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        let (status, _, body) =
            raw_http_request(address, "GET", "/", None, None, None, None, None).await;
        assert_eq!(status, 200);
        assert_eq!(body, b"local-hosted-index");
        let (status, _, body) =
            raw_http_request(address, "GET", "/healthz", None, None, None, None, None).await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("health JSON"),
            serde_json::json!({"status": "ok", "build_id": "local-build"})
        );
        assert_eq!(
            http_request(address, "GET", "/api/v1/hello", None, Some(origin), None)
                .await
                .0,
            200
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn browser_sessions_pair_revoke_and_recover_end_to_end() {
        let root = test_root("browser-auth");
        let service = test_service(&root).await;
        let origin = "http://127.0.0.1:4177";
        let database = root.join("profile/web-auth.sqlite3");
        let config = |pairing_window| GatewayConfig {
            bind: "127.0.0.1:0".parse().expect("address"),
            authentication: GatewayAuthentication::Web(WebAuthenticationConfig {
                database: database.clone(),
                pairing_window,
                policy_override: None,
            }),
            allowed_origin: origin.to_owned(),
            max_connections: 2,
        };
        let server = bind(config(false), service.clone())
            .await
            .expect("bind browser-auth gateway");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        let (status, _, body) =
            web_auth_request(address, "GET", "/api/v1/web-auth/status", None, None, None).await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("status JSON")["state"],
            "initial_window_open"
        );
        assert_eq!(
            web_auth_request(address, "GET", "/api/v1/hello", Some(origin), None, None,)
                .await
                .0,
            200
        );

        let (status, headers, _) = web_auth_request(
            address,
            "POST",
            "/api/v1/web-auth/policy",
            Some(origin),
            None,
            Some(r#"{"policy":"paired","label":"First browser"}"#.to_owned()),
        )
        .await;
        assert_eq!(status, 201);
        let first_cookie = response_cookie(&headers);
        assert_eq!(
            web_auth_request(address, "GET", "/api/v1/hello", Some(origin), None, None,)
                .await
                .0,
            401
        );
        assert_eq!(
            web_auth_request(
                address,
                "GET",
                "/api/v1/hello",
                Some(origin),
                Some(&first_cookie),
                None,
            )
            .await
            .0,
            200
        );

        let (status, _, body) = web_auth_request(
            address,
            "POST",
            "/api/v1/web-auth/pairing-ticket",
            Some(origin),
            Some(&first_cookie),
            None,
        )
        .await;
        assert_eq!(status, 201);
        let code = serde_json::from_slice::<serde_json::Value>(&body).expect("ticket JSON")["code"]
            .as_str()
            .expect("pairing code")
            .to_owned();
        assert_eq!(code.len(), 4);
        let (status, headers, _) = web_auth_request(
            address,
            "POST",
            "/api/v1/web-auth/pairing-ticket/redeem",
            Some(origin),
            None,
            Some(format!(
                "{{\"code\":\"{code}\",\"label\":\"Second browser\"}}"
            )),
        )
        .await;
        assert_eq!(status, 201);
        let second_cookie = response_cookie(&headers);

        let (status, _, body) = web_auth_request(
            address,
            "GET",
            "/api/v1/web-auth/sessions",
            None,
            Some(&first_cookie),
            None,
        )
        .await;
        assert_eq!(status, 200);
        let sessions = serde_json::from_slice::<serde_json::Value>(&body).expect("sessions JSON");
        let sessions = sessions["sessions"].as_array().expect("session array");
        assert_eq!(sessions.len(), 2);
        let second_id = sessions
            .iter()
            .find(|session| session["label"] == "Second browser")
            .and_then(|session| session["id"].as_str())
            .expect("second session")
            .to_owned();

        let mut request = format!("ws://{address}/api/v1/connect")
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        request
            .headers_mut()
            .insert("Cookie", second_cookie.parse().expect("cookie"));
        let (mut socket, _) = connect_async(request).await.expect("connect");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000009".to_owned(),
                token: None,
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));

        assert_eq!(
            web_auth_request(
                address,
                "DELETE",
                &format!("/api/v1/web-auth/sessions/{second_id}"),
                Some(origin),
                Some(&first_cookie),
                None,
            )
            .await
            .0,
            204
        );
        let mut typed_authentication_failure = false;
        let close = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                match socket.next().await {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        let frame = serde_json::from_str::<ApplicationServerFrame>(&text)
                            .expect("application frame");
                        if matches!(
                            frame,
                            ApplicationServerFrame::ConnectionError { error }
                                if error.code
                                    == ApplicationConnectionErrorCode::AuthenticationFailed
                        ) {
                            typed_authentication_failure = true;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        })
        .await;
        assert!(close.is_ok(), "revoked WebSocket stayed open");
        assert!(
            typed_authentication_failure,
            "revoked WebSocket omitted its typed authentication failure"
        );
        assert_eq!(
            web_auth_request(
                address,
                "GET",
                "/api/v1/hello",
                Some(origin),
                Some(&second_cookie),
                None,
            )
            .await
            .0,
            401
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");

        let server = bind(config(true), service.clone())
            .await
            .expect("bind recovery gateway");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let (status, headers, _) = web_auth_request(
            address,
            "POST",
            "/api/v1/web-auth/recovery",
            Some(origin),
            None,
            Some(r#"{"label":"Recovered browser"}"#.to_owned()),
        )
        .await;
        assert_eq!(status, 201);
        let recovered_cookie = response_cookie(&headers);
        assert_eq!(
            web_auth_request(
                address,
                "POST",
                "/api/v1/web-auth/recovery",
                Some(origin),
                None,
                Some(r#"{"label":"Racing browser"}"#.to_owned()),
            )
            .await
            .0,
            401
        );
        assert_eq!(
            web_auth_request(
                address,
                "GET",
                "/api/v1/hello",
                Some(origin),
                Some(&recovered_cookie),
                None,
            )
            .await
            .0,
            200
        );
        assert_eq!(
            web_auth_request(
                address,
                "POST",
                "/api/v1/web-auth/clear-access",
                None,
                Some(&recovered_cookie),
                None,
            )
            .await
            .0,
            403
        );
        assert_eq!(
            web_auth_request(
                address,
                "POST",
                "/api/v1/web-auth/clear-access",
                Some(origin),
                Some(&recovered_cookie),
                None,
            )
            .await
            .0,
            204
        );
        let (_, _, status_body) =
            web_auth_request(address, "GET", "/api/v1/web-auth/status", None, None, None).await;
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&status_body).expect("cleared status JSON")
                ["state"],
            "local_open"
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn unauthenticated_development_configuration_rejects_remote_scope() {
        let remote_origin = GatewayConfig::unauthenticated_loopback_development(
            "https://example.invalid".to_owned(),
        );
        assert!(remote_origin.validate().is_err());
    }

    #[test]
    fn private_lan_none_configuration_is_exact_and_rfc1918_only() {
        let valid = |socket: &str| GatewayConfig {
            bind: socket.parse().expect("private socket"),
            authentication: GatewayAuthentication::PrivateLanNone,
            allowed_origin: format!("http://{socket}"),
            max_connections: 2,
        };
        for socket in ["10.20.30.40:3030", "172.16.2.3:3030", "192.168.1.20:3030"] {
            valid(socket).validate().expect("RFC 1918 LAN mode");
        }
        for socket in [
            "127.0.0.1:3030",
            "0.0.0.0:3030",
            "8.8.8.8:3030",
            "[fd00::20]:3030",
            "192.168.1.20:0",
        ] {
            assert!(valid(socket).validate().is_err(), "accepted {socket}");
        }
        let mut wrong_origin = valid("192.168.1.20:3030");
        wrong_origin.allowed_origin = "http://192.168.1.21:3030".to_owned();
        assert!(wrong_origin.validate().is_err());
        let mut secure_proxy = valid("192.168.1.20:3030");
        secure_proxy.allowed_origin = "https://192.168.1.20:3030".to_owned();
        assert!(secure_proxy.validate().is_err());
    }

    #[test]
    fn tailscale_serve_none_requires_exact_loopback_and_ts_net_https() {
        let valid = GatewayConfig {
            bind: "127.0.0.1:3031".parse().expect("loopback socket"),
            authentication: GatewayAuthentication::TailscaleServeNone,
            allowed_origin: "https://rstorrent.example-tailnet.ts.net:8445".to_owned(),
            max_connections: 2,
        };
        valid.validate().expect("exact Tailscale Serve endpoint");
        for (bind, origin) in [
            ("0.0.0.0:3031", valid.allowed_origin.as_str()),
            ("127.0.0.1:0", valid.allowed_origin.as_str()),
            ("192.168.1.20:3031", valid.allowed_origin.as_str()),
            ("[::1]:3031", valid.allowed_origin.as_str()),
            (
                "127.0.0.1:3031",
                "http://rstorrent.example-tailnet.ts.net:8445",
            ),
            ("127.0.0.1:3031", "https://rstorrent.example.com:8445"),
        ] {
            let mut candidate = valid.clone();
            candidate.bind = bind.parse().expect("candidate socket");
            candidate.allowed_origin = origin.to_owned();
            assert!(candidate.validate().is_err(), "accepted {bind} {origin}");
        }
    }

    #[test]
    fn media_capability_response_uses_the_serving_gateway_origin() {
        let mut response = MediaUrlResponse {
            torrent_id: "t1-00000000000000000000000000000000".to_owned(),
            file_index: 0,
            outcome: MediaUrlOutcome::Created {
                url: "http://192.168.1.20:3030/media/v1/capability-token".to_owned(),
                idle_timeout_millis: "1000".to_owned(),
                absolute_timeout_millis: "2000".to_owned(),
            },
        };
        apply_gateway_media_origin(
            &mut response,
            "https://rstorrent.example-tailnet.ts.net:8445",
        )
        .expect("replace media origin");
        let MediaUrlOutcome::Created { url, .. } = response.outcome else {
            panic!("created outcome changed")
        };
        assert_eq!(
            url,
            "https://rstorrent.example-tailnet.ts.net:8445/media/v1/capability-token"
        );
    }

    #[tokio::test]
    async fn tailscale_serve_none_requires_endpoint_local_host_and_origin() {
        let root = test_root("tailscale-serve-none");
        let web_root = root.join("web");
        std::fs::create_dir_all(&web_root).expect("create web root");
        std::fs::write(web_root.join("index.html"), b"tailnet-index").expect("write index");
        let service = test_service(&root).await;
        let origin = "https://rstorrent.example-tailnet.ts.net:8445";
        let host = "rstorrent.example-tailnet.ts.net:8445";
        let reservation = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve port");
        let bind = reservation.local_addr().expect("reserved address");
        drop(reservation);
        let assets = HostedAssets::new(web_root, "tailnet-test".to_owned())
            .expect("hosted assets")
            .with_access_mode(HostedAccessMode::NetworkNone);
        let prepared = prepare_with_picker_and_assets(
            GatewayConfig {
                bind,
                authentication: GatewayAuthentication::TailscaleServeNone,
                allowed_origin: origin.to_owned(),
                max_connections: 2,
            },
            Arc::new(UnavailableDownloadDirectoryPicker),
            Some(assets),
            GatewayValidation::Standard,
        )
        .await
        .expect("prepare tailnet endpoint");
        let server = prepared
            .attach(service.clone())
            .await
            .expect("attach tailnet endpoint");
        let address = server.local_addr();
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));

        assert_eq!(raw_get_with_host(address, host, "/").await.0, 200);
        assert_eq!(
            raw_get_with_host(address, "wrong.example:8445", "/")
                .await
                .0,
            403
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                host,
                "GET",
                "/api/v1/hello",
                None,
                Some(origin),
                Some("00000000000000000000000000000001"),
                None,
                None,
            )
            .await
            .0,
            200
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                host,
                "GET",
                "/api/v1/hello",
                None,
                Some("https://wrong.example.ts.net:8445"),
                Some("00000000000000000000000000000001"),
                None,
                None,
            )
            .await
            .0,
            403
        );
        let (_, _, health) = raw_get_with_host(address, host, "/healthz").await;
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&health).expect("health JSON"),
            serde_json::json!({
                "status": "ok",
                "build_id": "tailnet-test",
                "access_mode": "network_none",
            })
        );

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn private_lan_none_requires_exact_host_and_http_websocket_origin() {
        let root = test_root("private-lan-none");
        let web_root = root.join("web");
        std::fs::create_dir_all(web_root.join("assets")).expect("create web root");
        std::fs::write(web_root.join("index.html"), b"private-lan-index").expect("write index");
        std::fs::write(web_root.join("rstorrent-boot.js"), b"boot").expect("write boot script");
        std::fs::write(web_root.join("assets/app-deadbeef.js"), b"asset")
            .expect("write immutable asset");
        let service = test_service(&root).await;
        let reservation = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve port");
        let port = reservation.local_addr().expect("reserved address").port();
        drop(reservation);
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let origin = format!("http://{address}");
        let assets = HostedAssets::new(web_root, "lan-test".to_owned())
            .expect("hosted assets")
            .with_access_mode(HostedAccessMode::LanNone)
            .with_update_provider(Arc::new(FixedUpdateProvider))
            .expect("update provider");
        let prepared = prepare_with_picker_and_assets(
            GatewayConfig {
                bind: address,
                authentication: GatewayAuthentication::PrivateLanNone,
                allowed_origin: origin.clone(),
                max_connections: 2,
            },
            Arc::new(UnavailableDownloadDirectoryPicker),
            Some(assets),
            GatewayValidation::PrevalidatedForTest,
        )
        .await
        .expect("prepare test-private server");
        let server = prepared
            .attach(service.clone())
            .await
            .expect("attach server");
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(server.serve(shutdown.clone()));
        let host = address.to_string();

        let (status, headers, body) = raw_get_with_host(address, &host, "/").await;
        assert_eq!(status, 200);
        assert_eq!(body, b"private-lan-index");
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("cache-control: no-store")
        );
        let (status, headers, body) = raw_get_with_host(address, &host, "/rstorrent-boot.js").await;
        assert_eq!(status, 200);
        assert_eq!(body, b"boot");
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("cache-control: no-store")
        );
        let (status, headers, body) =
            raw_get_with_host(address, &host, "/assets/app-deadbeef.js").await;
        assert_eq!(status, 200);
        assert_eq!(body, b"asset");
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("cache-control: public, max-age=31536000, immutable")
        );
        assert_eq!(
            raw_get_with_host(address, "wrong.example", "/").await.0,
            403
        );
        let (status, _, info) = raw_get_with_host(address, &host, "/api/v1/product-update").await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&info).expect("update info JSON"),
            serde_json::json!({
                "version": "0.1.0",
                "build_id": "lan-test",
                "target": "linux-gnu",
                "arch": "x86_64",
                "package": "headless",
                "check_privacy": "anonymous",
            })
        );
        let (status, _, _) = raw_http_request_with_host(
            address,
            &host,
            "POST",
            "/api/v1/product-update",
            None,
            Some(&origin),
            None,
            None,
            None,
        )
        .await;
        assert_eq!(status, 400, "a check reason is mandatory");

        let candidate = raw_product_update_check(address, &host, &origin, "manual").await;
        assert_eq!(candidate.0, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&candidate.1).expect("candidate JSON"),
            serde_json::json!({
                "version": "0.1.1",
                "release_url": "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.1",
                "apply_command": "$HOME/.local/bin/rstorrent-headless update --apply",
            })
        );
        assert_eq!(
            raw_product_update_check(address, &host, "http://wrong.example", "manual")
                .await
                .0,
            403
        );
        let (status, _, health) = raw_get_with_host(address, &host, "/healthz").await;
        assert_eq!(status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&health).expect("health JSON"),
            serde_json::json!({
                "status": "ok",
                "build_id": "lan-test",
                "access_mode": "lan_none",
            })
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                &host,
                "GET",
                "/api/v1/hello",
                None,
                Some(&origin),
                Some("00000000000000000000000000000001"),
                None,
                None,
            )
            .await
            .0,
            200
        );
        assert_eq!(
            raw_http_request_with_host(
                address,
                &host,
                "GET",
                "/api/v1/hello",
                None,
                Some("http://wrong.example"),
                Some("00000000000000000000000000000001"),
                None,
                None,
            )
            .await
            .0,
            403
        );

        let websocket_url = format!("ws://{address}/api/v1/connect");
        let mut request = websocket_url
            .clone()
            .into_client_request()
            .expect("request");
        request
            .headers_mut()
            .insert("Origin", origin.parse().expect("origin"));
        request
            .headers_mut()
            .insert("Host", host.parse().expect("host"));
        let (mut socket, _) = connect_async(request)
            .await
            .expect("connect without credential");
        send_application_message(
            &mut socket,
            &ApplicationClientFrame::Connect {
                api_version: rstorrent_session::API_VERSION,
                encoding: rstorrent_session::ApiEncoding::Json,
                client_instance_id: "00000000000000000000000000000001".to_owned(),
                token: None,
            },
        )
        .await;
        assert!(matches!(
            read_application_message(&mut socket).await,
            ApplicationServerFrame::Connected { .. }
        ));
        socket.close(None).await.expect("close socket");

        for (header, value) in [
            ("Origin", "http://wrong.example"),
            ("Host", "wrong.example"),
        ] {
            let mut request = websocket_url
                .clone()
                .into_client_request()
                .expect("request");
            request
                .headers_mut()
                .insert("Origin", origin.parse().expect("origin"));
            request
                .headers_mut()
                .insert("Host", host.parse().expect("host"));
            request
                .headers_mut()
                .insert(header, value.parse().expect("header value"));
            assert!(
                connect_async(request).await.is_err(),
                "accepted wrong {header}"
            );
        }

        shutdown.cancel();
        task.await
            .expect("server join")
            .expect("server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }

    #[tokio::test]
    async fn http_view_sets_are_isolated_between_gateway_owners() {
        let root = test_root("http-owner");
        let service = test_service(&root).await;
        let first = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "first-token".to_owned(),
                },
                allowed_origin: "http://first.invalid".to_owned(),
                max_connections: 1,
            },
            service.clone(),
        )
        .await
        .expect("bind first");
        let second = bind(
            GatewayConfig {
                bind: "127.0.0.1:0".parse().expect("address"),
                authentication: GatewayAuthentication::Bearer {
                    token: "second-token".to_owned(),
                },
                allowed_origin: "http://second.invalid".to_owned(),
                max_connections: 1,
            },
            service.clone(),
        )
        .await
        .expect("bind second");
        let first_address = first.local_addr();
        let second_address = second.local_addr();
        let first_shutdown = CancellationToken::new();
        let second_shutdown = CancellationToken::new();
        let first_task = tokio::spawn(first.serve(first_shutdown.clone()));
        let second_task = tokio::spawn(second.serve(second_shutdown.clone()));
        let body = serde_json::json!({
            "views": [{
                "type": "torrent_list",
                "view_id": "library",
                "delivery": { "min_interval_millis": 0 }
            }],
            "options": {}
        })
        .to_string();
        let (_, body) = http_request(
            first_address,
            "POST",
            "/api/v1/view-sets",
            Some("first-token"),
            Some("http://first.invalid"),
            Some(body),
        )
        .await;
        let opened: OpenViewSetResponse = serde_json::from_slice(&body).expect("open response");
        let path = format!(
            "/api/v1/view-sets/{}/updates?after=0&wait_ms=0",
            opened.view_set_id
        );
        assert_eq!(
            http_request(
                second_address,
                "GET",
                &path,
                Some("second-token"),
                Some("http://second.invalid"),
                None,
            )
            .await
            .0,
            404
        );

        first_shutdown.cancel();
        second_shutdown.cancel();
        first_task
            .await
            .expect("first server join")
            .expect("first server termination");
        second_task
            .await
            .expect("second server join")
            .expect("second server termination");
        service.lock().await.shutdown().await.expect("shutdown");
        drop(service);
        std::fs::remove_dir_all(root).expect("remove root");
    }
}
