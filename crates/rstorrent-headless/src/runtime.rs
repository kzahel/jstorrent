use std::fmt;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::future::try_join_all;
use rstorrent_gateway::{
    GatewayAuthentication, GatewayConfig, GatewayError, HostedAccessMode, HostedAssets,
    WebAuthenticationConfig, prepare_hosted,
};
use rstorrent_remote_host::RemoteApplicationRuntime;
use rstorrent_session::{
    ApplicationConfig, ApplicationError, ApplicationService, NetworkConfig, NetworkPolicy,
    PathRootStartupPolicy, ProductIdentity,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::config::{
    AuthenticationConfig, ConfigError, HeadlessConfig, HeadlessEndpoint, HeadlessEndpointKind,
    RemoteAccessConfig, load, load_basic_credentials, load_remote_certificate,
    validate_runtime_paths,
};
use crate::remote_admin::RemoteAdminServer;
use crate::updater::{HeadlessUpdateProvider, UpdateError};
use crate::{PACKAGE_ID, PRODUCT_ID};

pub const MAX_WEB_FILES: usize = 4096;
pub const MAX_WEB_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_IDENTITY_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorClass {
    Configuration,
    Runtime,
}

#[derive(Debug)]
pub struct HeadlessError {
    class: ErrorClass,
    message: String,
}

impl HeadlessError {
    pub fn class(&self) -> ErrorClass {
        self.class
    }

    pub(crate) fn configuration(message: impl Into<String>) -> Self {
        Self {
            class: ErrorClass::Configuration,
            message: message.into(),
        }
    }

    pub(crate) fn runtime(message: impl Into<String>) -> Self {
        Self {
            class: ErrorClass::Runtime,
            message: message.into(),
        }
    }
}

impl fmt::Display for HeadlessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for HeadlessError {}

impl From<ConfigError> for HeadlessError {
    fn from(error: ConfigError) -> Self {
        Self::configuration(error.to_string())
    }
}

impl From<UpdateError> for HeadlessError {
    fn from(error: UpdateError) -> Self {
        Self::runtime(error.to_string())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledLayout {
    pub application_root: PathBuf,
    pub release_root: PathBuf,
    pub web_root: PathBuf,
    pub gateway: PathBuf,
    pub version: String,
}

impl InstalledLayout {
    pub fn discover() -> Result<Self, HeadlessError> {
        let executable = std::env::current_exe()
            .map_err(|error| HeadlessError::configuration(format!("locate executable: {error}")))?;
        Self::discover_from_executable(&executable)
    }

    pub fn discover_from_executable(executable: &Path) -> Result<Self, HeadlessError> {
        let executable = fs::canonicalize(executable).map_err(|error| {
            HeadlessError::configuration(format!(
                "resolve installed executable {}: {error}",
                executable.display()
            ))
        })?;
        let bin_root = executable
            .parent()
            .ok_or_else(|| HeadlessError::configuration("installed executable has no bin root"))?;
        if executable.file_name().and_then(|name| name.to_str()) != Some("rstorrent-headless")
            || bin_root.file_name().and_then(|name| name.to_str()) != Some("bin")
        {
            return Err(HeadlessError::configuration(
                "rstorrent-headless must run from an immutable release bin directory",
            ));
        }
        let release_root = bin_root
            .parent()
            .ok_or_else(|| HeadlessError::configuration("installed release has no root"))?
            .to_path_buf();
        let versions_root = release_root.parent().ok_or_else(|| {
            HeadlessError::configuration("installed release has no versions root")
        })?;
        if versions_root.file_name().and_then(|name| name.to_str()) != Some("versions") {
            return Err(HeadlessError::configuration(
                "installed release must be below versions/",
            ));
        }
        let application_root = versions_root
            .parent()
            .ok_or_else(|| {
                HeadlessError::configuration("installed release has no application root")
            })?
            .to_path_buf();
        validate_directory(&application_root, "application root")?;
        validate_directory(versions_root, "versions root")?;
        validate_directory(&release_root, "release root")?;
        validate_directory(bin_root, "release bin root")?;
        validate_regular_file(&executable, true, "headless executable")?;

        let version = read_identity(&release_root.join("VERSION"), "VERSION")?;
        if release_root.file_name().and_then(|name| name.to_str()) != Some(version.as_str())
            || !valid_version(&version)
        {
            return Err(HeadlessError::configuration(
                "VERSION must match the bounded immutable release directory name",
            ));
        }
        let package_id = read_identity(&release_root.join("PACKAGE_ID"), "PACKAGE_ID")?;
        if package_id != PACKAGE_ID {
            return Err(HeadlessError::configuration(format!(
                "installed PACKAGE_ID must be {PACKAGE_ID}"
            )));
        }
        let gateway = bin_root.join("rstorrent-gateway");
        validate_regular_file(&gateway, true, "gateway executable")?;
        let web_root = release_root.join("web");
        validate_web_tree(&web_root)?;

        let current = application_root.join("current");
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            HeadlessError::configuration(format!(
                "inspect installed current link {}: {error}",
                current.display()
            ))
        })?;
        if !metadata.file_type().is_symlink() {
            return Err(HeadlessError::configuration(
                "installed current entry must be a relative symbolic link",
            ));
        }
        let expected_target = PathBuf::from("versions").join(&version);
        if fs::read_link(&current).map_err(|error| {
            HeadlessError::configuration(format!("read installed current link: {error}"))
        })? != expected_target
            || fs::canonicalize(&current).map_err(|error| {
                HeadlessError::configuration(format!("resolve installed current link: {error}"))
            })? != release_root
        {
            return Err(HeadlessError::configuration(
                "installed current link does not select this immutable release",
            ));
        }

        Ok(Self {
            application_root,
            release_root,
            web_root,
            gateway,
            version,
        })
    }

    pub fn hosted_assets(&self) -> Result<HostedAssets, HeadlessError> {
        HostedAssets::new(self.web_root.clone(), self.version.clone())
            .and_then(|assets| assets.with_product(PRODUCT_ID.to_owned()))
            .map_err(configuration_gateway_error)
    }
}

#[derive(Clone, Debug)]
pub struct ServiceReport {
    pub listeners: Vec<SocketAddr>,
    pub version: String,
    pub remote_access: bool,
    pub shutdown_elapsed: Duration,
}

pub async fn run_installed_service(
    config_path: &Path,
    layout: &InstalledLayout,
    shutdown: CancellationToken,
) -> Result<ServiceReport, HeadlessError> {
    let config = load(config_path)?;
    validate_runtime_paths(
        &config,
        config_path,
        &[&layout.application_root, &layout.release_root],
    )?;
    let remote_certificate = config
        .remote_access
        .as_ref()
        .filter(|remote| matches!(remote, RemoteAccessConfig::Validation(_)))
        .map(|_| load_remote_certificate(&config))
        .transpose()?;
    let access_mode = hosted_access_mode(&config.authentication);
    let browser_sessions = matches!(config.authentication, AuthenticationConfig::LocalBrowser);
    if browser_sessions {
        create_profile_root(&config.profile_root)?;
    }
    let update_provider = Arc::new(HeadlessUpdateProvider::production(layout.version.clone())?);
    let assets = layout
        .hosted_assets()?
        .with_access_mode(access_mode)
        .with_update_provider(update_provider)
        .map_err(configuration_gateway_error)?;
    let mut prepared = Vec::with_capacity(config.endpoints.len());
    for endpoint in &config.endpoints {
        let gateway_config = GatewayConfig {
            bind: endpoint.listen,
            authentication: gateway_authentication(&config, endpoint)?,
            allowed_origin: endpoint.public_origin.clone(),
            max_connections: rstorrent_gateway::MAX_CONNECTIONS,
        };
        prepared.push(
            prepare_hosted(gateway_config, assets.clone())
                .await
                .map_err(configuration_gateway_error)?,
        );
    }
    if !browser_sessions {
        create_profile_root(&config.profile_root)?;
    }
    let application_config = ApplicationConfig::new(
        config.profile_root.clone(),
        "default".to_owned(),
        config.storage_roots.clone(),
        NetworkConfig::new(
            NetworkPolicy::Online,
            Duration::from_secs(15),
            Duration::from_secs(60),
        ),
    )
    .with_fresh_profile_defaults()
    .with_path_root_startup_policy(PathRootStartupPolicy::PreserveUnavailable)
    .with_product(ProductIdentity::for_this_build("headless", &layout.version));
    let application = ApplicationService::open(application_config)
        .await
        .map_err(configuration_application_error)?;
    let application = Arc::new(Mutex::new(application));
    let remote_runtime = if let Some(remote) = &config.remote_access {
        let authority_root = config.profile_root.join("remote-access");
        let host_build = format!("rstorrent-headless/{}", layout.version);
        let opened = match remote {
            RemoteAccessConfig::Product => {
                RemoteApplicationRuntime::open_product(
                    authority_root,
                    host_build,
                    application.clone(),
                )
                .await
            }
            RemoteAccessConfig::Validation(validation) => {
                RemoteApplicationRuntime::open_validation(
                    authority_root,
                    &validation.relay_base,
                    remote_certificate.clone().ok_or_else(|| {
                        HeadlessError::configuration("remote validation certificate missing")
                    })?,
                    host_build,
                    application.clone(),
                )
                .await
            }
        };
        match opened {
            Ok(runtime) => Some(runtime),
            Err(error) => {
                let _ = application.lock().await.shutdown().await;
                return Err(HeadlessError::configuration(format!(
                    "start remote access owner: {error}"
                )));
            }
        }
    } else {
        None
    };
    let remote_admin = match &remote_runtime {
        Some(remote) => match RemoteAdminServer::bind(&config.profile_root, remote.owner()) {
            Ok(admin) => Some(admin),
            Err(error) => {
                let _ = remote.shutdown().await;
                let _ = application.lock().await.shutdown().await;
                return Err(error);
            }
        },
        None => None,
    };
    let first = prepared.remove(0);
    let first_server = match first.attach(application.clone()).await {
        Ok(server) => server,
        Err(error) => {
            if let Some(remote) = &remote_runtime {
                let _ = remote.shutdown().await;
            }
            let _ = application.lock().await.shutdown().await;
            return Err(configuration_gateway_error(error));
        }
    };
    let mut servers = vec![first_server];
    for endpoint in prepared {
        let server = match endpoint
            .attach_to_configured_service(application.clone())
            .await
        {
            Ok(server) => server,
            Err(error) => {
                if let Some(remote) = &remote_runtime {
                    let _ = remote.shutdown().await;
                }
                let _ = application.lock().await.shutdown().await;
                return Err(configuration_gateway_error(error));
            }
        };
        servers.push(server);
    }
    eprintln!("headless {}", config.redacted_summary());
    let listeners = servers
        .iter()
        .map(|server| server.local_addr())
        .collect::<Vec<_>>();
    eprintln!(
        "headless product={} version={} remote_access={} listening={}",
        PRODUCT_ID,
        layout.version,
        remote_runtime.is_some(),
        listeners
            .iter()
            .map(SocketAddr::to_string)
            .collect::<Vec<_>>()
            .join(",")
    );
    if matches!(
        config.authentication,
        AuthenticationConfig::LanNone | AuthenticationConfig::TrustedNetworkNone
    ) {
        eprintln!(
            "headless warning=authentication-disabled every-reachable-client-has-full-owner-control"
        );
    }

    let admin_task = remote_admin.map(|admin| {
        let admin_shutdown = shutdown.clone();
        let failure_shutdown = shutdown.clone();
        tokio::spawn(async move {
            let result = admin.serve(admin_shutdown).await;
            if result.is_err() {
                failure_shutdown.cancel();
            }
            result
        })
    });
    let serve_result = try_join_all(
        servers
            .into_iter()
            .map(|server| server.serve(shutdown.clone())),
    )
    .await;
    shutdown.cancel();
    let admin_result = match admin_task {
        Some(task) => match task.await {
            Ok(result) => result,
            Err(_) => Err(HeadlessError::runtime("remote administration task failed")),
        },
        None => Ok(()),
    };
    let shutdown_started = Instant::now();
    let remote_shutdown = match &remote_runtime {
        Some(remote) => remote.shutdown().await,
        None => Ok(()),
    };
    let application_shutdown = application.lock().await.shutdown().await;
    let shutdown_elapsed = shutdown_started.elapsed();
    if let Err(error) = serve_result {
        return Err(HeadlessError::runtime(error.to_string()));
    }
    admin_result?;
    remote_shutdown.map_err(|error| {
        HeadlessError::runtime(format!("shutdown remote access owner: {error}"))
    })?;
    application_shutdown.map_err(runtime_application_error)?;
    Ok(ServiceReport {
        listeners,
        version: layout.version.clone(),
        remote_access: remote_runtime.is_some(),
        shutdown_elapsed,
    })
}

fn gateway_authentication(
    config: &HeadlessConfig,
    endpoint: &HeadlessEndpoint,
) -> Result<GatewayAuthentication, HeadlessError> {
    match &config.authentication {
        AuthenticationConfig::LocalBrowser => {
            Ok(GatewayAuthentication::Web(WebAuthenticationConfig {
                database: config.profile_root.join("web-auth.sqlite3"),
                pairing_window: false,
                policy_override: None,
            }))
        }
        AuthenticationConfig::Basic { .. } => {
            let credentials = load_basic_credentials(config)?;
            GatewayAuthentication::basic(credentials.username(), credentials.password())
                .map_err(configuration_gateway_error)
        }
        AuthenticationConfig::LanNone => Ok(GatewayAuthentication::PrivateLanNone),
        AuthenticationConfig::TrustedNetworkNone => match endpoint.kind {
            HeadlessEndpointKind::DirectLan => Ok(GatewayAuthentication::PrivateLanNone),
            HeadlessEndpointKind::TailscaleServe => Ok(GatewayAuthentication::TailscaleServeNone),
            HeadlessEndpointKind::Standard => Err(HeadlessError::configuration(
                "trusted-network-none does not accept a standard endpoint",
            )),
        },
    }
}

fn hosted_access_mode(authentication: &AuthenticationConfig) -> HostedAccessMode {
    match authentication {
        AuthenticationConfig::LocalBrowser => HostedAccessMode::BrowserSession,
        AuthenticationConfig::Basic { .. } => HostedAccessMode::Basic,
        AuthenticationConfig::LanNone => HostedAccessMode::LanNone,
        AuthenticationConfig::TrustedNetworkNone => HostedAccessMode::NetworkNone,
    }
}

fn create_profile_root(path: &Path) -> Result<(), HeadlessError> {
    fs::create_dir_all(path).map_err(|error| {
        HeadlessError::configuration(format!("create profile root {}: {error}", path.display()))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            HeadlessError::configuration(format!(
                "protect profile root {}: {error}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

pub(crate) fn validate_web_tree(root: &Path) -> Result<(), HeadlessError> {
    validate_directory(root, "hosted web root")?;
    let mut pending = vec![root.to_path_buf()];
    let mut files = 0usize;
    let mut bytes = 0u64;
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            HeadlessError::configuration(format!(
                "read hosted web directory {}: {error}",
                directory.display()
            ))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                HeadlessError::configuration(format!("read hosted web entry: {error}"))
            })?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                HeadlessError::configuration(format!(
                    "inspect hosted web entry {}: {error}",
                    path.display()
                ))
            })?;
            if metadata.file_type().is_symlink() {
                return Err(HeadlessError::configuration(format!(
                    "hosted web entry {} must not be a symbolic link",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                validate_owned_mode(&path, &metadata, true)?;
                pending.push(path);
            } else if metadata.is_file() {
                validate_owned_mode(&path, &metadata, false)?;
                files = files.saturating_add(1);
                bytes = bytes.saturating_add(metadata.len());
                if files > MAX_WEB_FILES || bytes > MAX_WEB_BYTES {
                    return Err(HeadlessError::configuration(format!(
                        "hosted web tree exceeds {MAX_WEB_FILES} files or {MAX_WEB_BYTES} bytes"
                    )));
                }
            } else {
                return Err(HeadlessError::configuration(format!(
                    "hosted web entry {} is not a regular file or directory",
                    path.display()
                )));
            }
        }
    }
    validate_regular_file(&root.join("index.html"), false, "hosted index")
}

pub(crate) fn validate_directory(path: &Path, label: &str) -> Result<(), HeadlessError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        HeadlessError::configuration(format!("inspect {label} {}: {error}", path.display()))
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(HeadlessError::configuration(format!(
            "{label} {} must be a real directory",
            path.display()
        )));
    }
    validate_owned_mode(path, &metadata, true)
}

pub(crate) fn validate_regular_file(
    path: &Path,
    executable: bool,
    label: &str,
) -> Result<(), HeadlessError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        HeadlessError::configuration(format!("inspect {label} {}: {error}", path.display()))
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(HeadlessError::configuration(format!(
            "{label} {} must be a regular nonsymlink file",
            path.display()
        )));
    }
    validate_owned_mode(path, &metadata, executable)
}

#[cfg(unix)]
fn validate_owned_mode(
    path: &Path,
    metadata: &fs::Metadata,
    executable: bool,
) -> Result<(), HeadlessError> {
    use std::os::unix::fs::MetadataExt;

    if metadata.uid() != rustix::process::getuid().as_raw() {
        return Err(HeadlessError::configuration(format!(
            "installed path {} is not owned by the current user",
            path.display()
        )));
    }
    let mode = metadata.mode() & 0o777;
    if mode & 0o022 != 0 || (executable && mode & 0o100 == 0) || (!executable && mode & 0o111 != 0)
    {
        return Err(HeadlessError::configuration(format!(
            "installed path {} has unsafe mode {:03o}",
            path.display(),
            mode
        )));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_owned_mode(
    path: &Path,
    _metadata: &fs::Metadata,
    _executable: bool,
) -> Result<(), HeadlessError> {
    Err(HeadlessError::configuration(format!(
        "installed ownership validation is supported only on Unix: {}",
        path.display()
    )))
}

pub(crate) fn read_identity(path: &Path, label: &str) -> Result<String, HeadlessError> {
    validate_regular_file(path, false, label)?;
    let value = fs::read(path).map_err(|error| {
        HeadlessError::configuration(format!("read {label} {}: {error}", path.display()))
    })?;
    if value.is_empty()
        || value.len() > MAX_IDENTITY_BYTES + 1
        || value.contains(&b'\r')
        || (value[..value.len().saturating_sub(1)]).contains(&b'\n')
    {
        return Err(HeadlessError::configuration(format!(
            "{label} must contain one bounded line"
        )));
    }
    let value = value.strip_suffix(b"\n").unwrap_or(&value);
    let value = std::str::from_utf8(value)
        .map_err(|_| HeadlessError::configuration(format!("{label} is not valid UTF-8")))?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(HeadlessError::configuration(format!(
            "{label} must contain printable ASCII without spaces"
        )));
    }
    Ok(value.to_owned())
}

pub(crate) fn valid_version(version: &str) -> bool {
    version.len() <= MAX_IDENTITY_BYTES
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-' | b'_'))
}

fn configuration_gateway_error(error: GatewayError) -> HeadlessError {
    HeadlessError::configuration(error.to_string())
}

fn configuration_application_error(error: ApplicationError) -> HeadlessError {
    HeadlessError::configuration(format!("open application: {error}"))
}

fn runtime_application_error(error: ApplicationError) -> HeadlessError {
    HeadlessError::runtime(format!("shutdown application: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    use rcgen::{CertifiedKey, generate_simple_self_signed};
    use rstorrent_remote_relay::TlsProductRelayServer;
    use serde_json::Value;
    use tokio_util::sync::CancellationToken;

    use super::{InstalledLayout, run_installed_service};
    use crate::PACKAGE_ID;
    use crate::remote_admin::{RemoteAdminRequest, admin_socket_path, request as remote_request};

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    fn test_root(label: &str) -> PathBuf {
        let sequence = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        std::fs::canonicalize(std::env::temp_dir())
            .expect("canonical temporary root")
            .join(format!(
                "rstorrent-headless-runtime-{label}-{}-{sequence}",
                std::process::id()
            ))
    }

    #[cfg(unix)]
    fn write_file(path: &Path, value: &[u8], mode: u32) {
        use std::os::unix::fs::PermissionsExt;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, value).expect("write file");
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("set mode");
    }

    #[cfg(unix)]
    fn installed_fixture(root: &Path) -> PathBuf {
        use std::os::unix::fs::{PermissionsExt, symlink};

        let release = root.join("versions/1.2.3");
        write_file(&release.join("bin/rstorrent-headless"), b"headless", 0o755);
        write_file(&release.join("bin/rstorrent-gateway"), b"gateway", 0o755);
        write_file(&release.join("web/index.html"), b"index", 0o644);
        write_file(&release.join("web/assets/app.js"), b"app", 0o644);
        write_file(&release.join("VERSION"), b"1.2.3\n", 0o644);
        write_file(&release.join("PACKAGE_ID"), PACKAGE_ID.as_bytes(), 0o644);
        for directory in [
            root.to_path_buf(),
            root.join("versions"),
            release.clone(),
            release.join("bin"),
            release.join("web"),
            release.join("web/assets"),
        ] {
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o755))
                .expect("set directory mode");
        }
        symlink("versions/1.2.3", root.join("current")).expect("create current link");
        release.join("bin/rstorrent-headless")
    }

    #[cfg(unix)]
    fn basic_configuration(root: &Path, listen: SocketAddr) -> (PathBuf, PathBuf, PathBuf) {
        let config_path = root.join("config/headless.toml");
        let secret = root.join("config/basic-password");
        let profile = root.join("state/profile");
        let payload = root.join("missing-payload");
        write_file(&secret, b"secret\n", 0o600);
        let source = format!(
            "version = 1\n\
             profile_root = {:?}\n\
             listen = \"{listen}\"\n\
             public_origin = \"https://torrent.example.test\"\n\n\
             [[storage_roots]]\n\
             id = \"downloads\"\n\
             label = \"Downloads\"\n\
             path = {:?}\n\n\
             [authentication]\n\
             mode = \"basic\"\n\
             username = \"owner\"\n\
             password_file = {:?}\n",
            profile.to_str().expect("profile path"),
            payload.to_str().expect("payload path"),
            secret.to_str().expect("secret path"),
        );
        write_file(&config_path, source.as_bytes(), 0o600);
        (config_path, profile, payload)
    }

    #[cfg(unix)]
    fn trusted_network_configuration(
        root: &Path,
        endpoints: &[(SocketAddr, &str)],
    ) -> (PathBuf, PathBuf, PathBuf) {
        let config_path = root.join("config/headless.toml");
        let profile = root.join("state/profile");
        let payload = root.join("missing-payload");
        let mut endpoint_source = String::new();
        for (listen, origin) in endpoints {
            endpoint_source.push_str(&format!(
                "[[endpoints]]\nkind = \"tailscale-serve\"\nlisten = \"{listen}\"\npublic_origin = \"{origin}\"\n\n"
            ));
        }
        let source = format!(
            "version = 2\n\
             profile_root = {:?}\n\n\
             {endpoint_source}\
             [[storage_roots]]\n\
             id = \"downloads\"\n\
             label = \"Downloads\"\n\
             path = {:?}\n\n\
             [authentication]\n\
             mode = \"trusted-network-none\"\n",
            profile.to_str().expect("profile path"),
            payload.to_str().expect("payload path"),
        );
        write_file(&config_path, source.as_bytes(), 0o600);
        (config_path, profile, payload)
    }

    #[cfg(unix)]
    fn remote_configuration(
        root: &Path,
        listen: SocketAddr,
        relay_address: SocketAddr,
        certificate: &Path,
    ) -> (PathBuf, PathBuf) {
        let config_path = root.join("config/headless.toml");
        let profile = root.join("state/profile");
        let payload = root.join("missing-payload");
        let source = format!(
            "version = 3\n\
             profile_root = {:?}\n\
             listen = \"{listen}\"\n\
             public_origin = \"http://{listen}\"\n\n\
             [[storage_roots]]\n\
             id = \"downloads\"\n\
             label = \"Downloads\"\n\
             path = {:?}\n\n\
             [authentication]\n\
             mode = \"local-browser\"\n\n\
             [remote_validation]\n\
             relay_base = \"https://127.0.0.1:{}/\"\n\
             certificate_file = {:?}\n",
            profile.to_str().expect("profile path"),
            payload.to_str().expect("payload path"),
            relay_address.port(),
            certificate.to_str().expect("certificate path"),
        );
        write_file(&config_path, source.as_bytes(), 0o600);
        (config_path, profile)
    }

    async fn request_health(
        address: SocketAddr,
        host: String,
        authorization: Option<String>,
    ) -> Option<String> {
        tokio::task::spawn_blocking(move || {
            let mut stream =
                TcpStream::connect_timeout(&address, Duration::from_millis(200)).ok()?;
            stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
            let mut request =
                format!("GET /healthz HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
            if let Some(authorization) = authorization {
                request.push_str("Authorization: ");
                request.push_str(&authorization);
                request.push_str("\r\n");
            }
            request.push_str("\r\n");
            stream.write_all(request.as_bytes()).ok()?;
            let mut response = String::new();
            stream.read_to_string(&mut response).ok()?;
            response.starts_with("HTTP/1.1 200").then_some(response)
        })
        .await
        .expect("health request task")
    }

    #[cfg(unix)]
    #[test]
    fn installed_layout_requires_complete_owned_relative_release() {
        let root = test_root("layout");
        let executable = installed_fixture(&root);
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");
        assert_eq!(layout.application_root, root);
        assert_eq!(layout.version, "1.2.3");
        layout.hosted_assets().expect("hosted assets");

        fs::remove_file(&layout.gateway).expect("remove gateway");
        assert!(InstalledLayout::discover_from_executable(&executable).is_err());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[test]
    fn installed_layout_rejects_web_symlinks_and_wrong_current_target() {
        use std::os::unix::fs::symlink;

        let root = test_root("layout-symlinks");
        let executable = installed_fixture(&root);
        symlink("index.html", root.join("versions/1.2.3/web/linked.html"))
            .expect("create web symlink");
        assert!(InstalledLayout::discover_from_executable(&executable).is_err());
        fs::remove_file(root.join("versions/1.2.3/web/linked.html")).expect("remove web symlink");
        fs::remove_file(root.join("current")).expect("remove current");
        symlink("versions/missing", root.join("current")).expect("replace current");
        assert!(InstalledLayout::discover_from_executable(&executable).is_err());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unavailable_http_bind_fails_before_profile_or_payload_creation() {
        let root = test_root("bind-first");
        let executable = installed_fixture(&root.join("install"));
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");
        let reservation = TcpListener::bind("127.0.0.1:0").expect("reserve listener");
        let listen = reservation.local_addr().expect("listener address");
        let (config_path, profile, payload) = basic_configuration(&root, listen);

        let error = run_installed_service(&config_path, &layout, CancellationToken::new())
            .await
            .expect_err("reserved bind must fail");
        assert_eq!(error.class(), super::ErrorClass::Configuration);
        assert!(!profile.exists());
        assert!(!payload.exists());

        drop(reservation);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn second_endpoint_bind_failure_releases_first_before_profile_creation() {
        let root = test_root("multi-bind-first");
        let executable = installed_fixture(&root.join("install"));
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");
        let first_reservation = TcpListener::bind("127.0.0.1:0").expect("reserve first listener");
        let first = first_reservation
            .local_addr()
            .expect("first listener address");
        drop(first_reservation);
        let second_reservation = TcpListener::bind("127.0.0.1:0").expect("reserve second listener");
        let second = second_reservation
            .local_addr()
            .expect("second listener address");
        let first_origin = format!("https://first.example-tailnet.ts.net:{}", first.port());
        let second_origin = format!("https://second.example-tailnet.ts.net:{}", second.port());
        let (config_path, profile, payload) = trusted_network_configuration(
            &root,
            &[
                (first, first_origin.as_str()),
                (second, second_origin.as_str()),
            ],
        );

        let error = run_installed_service(&config_path, &layout, CancellationToken::new())
            .await
            .expect_err("reserved second bind must fail");
        assert_eq!(error.class(), super::ErrorClass::Configuration);
        assert!(TcpListener::bind(first).is_ok(), "first listener leaked");
        assert!(!profile.exists());
        assert!(!payload.exists());

        drop(second_reservation);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn installed_service_serves_product_health_and_joins_without_creating_missing_root() {
        let root = test_root("service");
        let executable = installed_fixture(&root.join("install"));
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");
        let reservation = TcpListener::bind("127.0.0.1:0").expect("reserve listener");
        let listen = reservation.local_addr().expect("listener address");
        drop(reservation);
        let (config_path, profile, payload) = basic_configuration(&root, listen);
        let shutdown = CancellationToken::new();
        let task_shutdown = shutdown.clone();
        let task = tokio::spawn(async move {
            run_installed_service(&config_path, &layout, task_shutdown).await
        });

        let mut health = None;
        for _ in 0..50 {
            if let Some(response) = request_health(
                listen,
                "torrent.example.test".to_owned(),
                Some("Basic b3duZXI6c2VjcmV0".to_owned()),
            )
            .await
            {
                health = Some(response);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let health = health.expect("headless health became reachable");
        assert!(health.contains("\"product\":\"rstorrent-headless\""));
        assert!(health.contains("\"build_id\":\"1.2.3\""));
        assert!(health.contains("\"access_mode\":\"basic\""));
        assert!(profile.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&profile)
                    .expect("profile metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        assert!(!payload.exists());

        shutdown.cancel();
        let report = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("service shutdown timeout")
            .expect("service task")
            .expect("joined service shutdown");
        assert_eq!(report.listeners, vec![listen]);
        assert!(report.shutdown_elapsed < Duration::from_secs(5));
        assert!(!payload.exists());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trusted_network_endpoints_share_one_joined_application_owner() {
        let root = test_root("trusted-network-service");
        let executable = installed_fixture(&root.join("install"));
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");
        let first_reservation = TcpListener::bind("127.0.0.1:0").expect("reserve first listener");
        let first = first_reservation
            .local_addr()
            .expect("first listener address");
        let second_reservation = TcpListener::bind("127.0.0.1:0").expect("reserve second listener");
        let second = second_reservation
            .local_addr()
            .expect("second listener address");
        drop(first_reservation);
        drop(second_reservation);
        let first_origin = format!("https://first.example-tailnet.ts.net:{}", first.port());
        let second_origin = format!("https://second.example-tailnet.ts.net:{}", second.port());
        let (config_path, profile, payload) = trusted_network_configuration(
            &root,
            &[
                (first, first_origin.as_str()),
                (second, second_origin.as_str()),
            ],
        );
        let shutdown = CancellationToken::new();
        let task_shutdown = shutdown.clone();
        let mut task = tokio::spawn(async move {
            run_installed_service(&config_path, &layout, task_shutdown).await
        });

        for (address, host) in [
            (first, first_origin.trim_start_matches("https://")),
            (second, second_origin.trim_start_matches("https://")),
        ] {
            let mut health = None;
            for _ in 0..50 {
                if let Some(response) = request_health(address, host.to_owned(), None).await {
                    health = Some(response);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            if health.is_none() && task.is_finished() {
                panic!("service ended before health: {:?}", (&mut task).await);
            }
            let health = health.expect("trusted-network endpoint became reachable");
            assert!(health.contains("\"product\":\"rstorrent-headless\""));
            assert!(health.contains("\"access_mode\":\"network_none\""));
        }
        assert!(
            request_health(
                first,
                second_origin.trim_start_matches("https://").to_owned(),
                None,
            )
            .await
            .is_none(),
            "first endpoint accepted the second endpoint Host"
        );
        assert!(profile.is_dir());
        assert!(!payload.exists());

        shutdown.cancel();
        let report = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("service shutdown timeout")
            .expect("service task")
            .expect("joined multi-endpoint shutdown");
        assert_eq!(report.listeners, vec![first, second]);
        assert!(report.shutdown_elapsed < Duration::from_secs(5));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn configured_remote_owner_is_administered_locally_and_survives_restart() {
        let sequence = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        let root = std::fs::canonicalize("/tmp")
            .expect("canonical short temporary root")
            .join(format!("rh-{}-{sequence}", std::process::id()));
        let executable = installed_fixture(&root.join("install"));
        let layout = InstalledLayout::discover_from_executable(&executable)
            .expect("discover installed layout");

        let CertifiedKey { cert, signing_key } =
            generate_simple_self_signed(["localhost".to_owned(), "127.0.0.1".to_owned()])
                .expect("relay certificate");
        let certificate_path = root.join("relay/certificate.der");
        let private_key_path = root.join("relay/private-key.der");
        write_file(&certificate_path, cert.der(), 0o600);
        write_file(&private_key_path, &signing_key.serialize_der(), 0o600);
        let relay_server = TlsProductRelayServer::bind(
            "127.0.0.1:0".parse().unwrap(),
            root.join("relay/state"),
            "https://localhost:7443",
            &certificate_path,
            &private_key_path,
        )
        .await
        .expect("bind relay");
        let relay_address = relay_server.local_addr();
        let relay = relay_server.relay();
        let relay_task = tokio::spawn(async move { relay_server.serve().await });

        let endpoint_reservation = TcpListener::bind("127.0.0.1:0").expect("reserve endpoint");
        let endpoint = endpoint_reservation.local_addr().expect("endpoint");
        drop(endpoint_reservation);
        let (config_path, profile) =
            remote_configuration(&root, endpoint, relay_address, &certificate_path);

        for restart in 0..2 {
            let shutdown = CancellationToken::new();
            let task_shutdown = shutdown.clone();
            let task_config = config_path.clone();
            let task_layout = layout.clone();
            let mut task = tokio::spawn(async move {
                run_installed_service(&task_config, &task_layout, task_shutdown).await
            });
            tokio::time::timeout(Duration::from_secs(5), async {
                while !admin_socket_path(&profile).exists() {
                    if task.is_finished() {
                        panic!(
                            "headless remote service ended early: {:?}",
                            (&mut task).await
                        );
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("remote administration socket");

            let state = if restart == 0 {
                remote_request(
                    &profile,
                    RemoteAdminRequest::Enable {
                        username: "headless-owner".to_owned(),
                        passphrase: "correct horse battery staple".to_owned(),
                    },
                )
                .await
                .expect("enable remote access")
            } else {
                remote_request(&profile, RemoteAdminRequest::Status)
                    .await
                    .expect("inspect restored remote access")
            };
            assert_eq!(state.get("enabled").and_then(Value::as_bool), Some(true));
            tokio::time::timeout(Duration::from_secs(5), async {
                while relay.metrics().waiting_hosts != 1 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("headless host claimed relay route");

            shutdown.cancel();
            let report = tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .expect("headless remote shutdown timeout")
                .expect("headless task")
                .expect("headless remote service");
            assert!(report.remote_access);
            assert!(!admin_socket_path(&profile).exists());
        }

        relay.shutdown();
        tokio::time::timeout(Duration::from_secs(5), relay_task)
            .await
            .expect("relay shutdown timeout")
            .expect("relay task")
            .expect("relay service");
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
