use std::env;
use std::error::Error;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rstorrent_gateway::{
    CROSTINI_HOST, GatewayAuthentication, GatewayConfig, HostedAssets, JSTORRENT_BETA_EXTENSION_ID,
    MAX_BASIC_PASSWORD_BYTES, WebAccessPolicy, WebAuthenticationConfig, prepare,
    prepare_crostini_hosted, prepare_hosted, prepare_local_hosted,
};
use rstorrent_session::{
    ApplicationConfig, ApplicationService, ConfiguredStorageRoot, DownloadResourceLimits,
    NetworkConfig, NetworkPolicy, PeerTransportPolicy, ProductIdentity, ShutdownOptions,
    ShutdownProgress,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.as_slice() == ["--version"] {
        println!("rstorrent-gateway {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let cli = CliOptions::parse(arguments)?;
    if cli.help {
        print_help();
        return Ok(());
    }
    let profile_root = cli
        .profile_root
        .clone()
        .map(Ok)
        .unwrap_or_else(|| required_path("RSTORRENT_PROFILE_ROOT"))?;
    let storage_roots = optional_path("RSTORRENT_STORAGE_ROOT")?
        .map(|path| vec![ConfiguredStorageRoot::path("downloads", path)])
        .unwrap_or_default();
    let authentication_name = cli.auth.clone().unwrap_or_else(|| {
        env::var("RSTORRENT_GATEWAY_AUTH").unwrap_or_else(|_| {
            if cli.product_cli {
                "auto".to_owned()
            } else {
                "bearer".to_owned()
            }
        })
    });
    let configured_bind = cli
        .listen
        .clone()
        .or_else(|| env::var("RSTORRENT_GATEWAY_BIND").ok());
    let product_default_bind = if cli.chromeos_crostini {
        "0.0.0.0:3030"
    } else {
        "127.0.0.1:3030"
    };
    let (bind_addr, authentication) = match authentication_name.as_str() {
        "bearer" => (
            configured_bind
                .unwrap_or_else(|| product_default_bind.to_owned())
                .parse::<SocketAddr>()?,
            GatewayAuthentication::Bearer {
                token: match cli.bearer_token_file.as_ref() {
                    Some(path) => {
                        read_secret_file(path, rstorrent_gateway::MAX_TOKEN_BYTES, "bearer token")?
                    }
                    None => required_string("RSTORRENT_GATEWAY_TOKEN")?,
                },
            },
        ),
        "development-none" | "unauthenticated_loopback_development" => (
            configured_bind
                .unwrap_or_else(|| "127.0.0.1:0".to_owned())
                .parse::<SocketAddr>()?,
            GatewayAuthentication::UnauthenticatedLoopbackDevelopment,
        ),
        "basic" => (
            configured_bind
                .ok_or("--listen or RSTORRENT_GATEWAY_BIND is required for Basic auth")?
                .parse::<SocketAddr>()?,
            GatewayAuthentication::basic(
                &cli.basic_username
                    .clone()
                    .map(Ok)
                    .unwrap_or_else(|| required_string("RSTORRENT_GATEWAY_BASIC_USERNAME"))?,
                &match cli.basic_password_file.as_ref() {
                    Some(path) => read_password_file(path, "basic password file")?,
                    None => required_password_file("RSTORRENT_GATEWAY_BASIC_PASSWORD_FILE")?,
                },
            )?,
        ),
        "auto" | "local-open" | "paired" => {
            let bind = configured_bind
                .unwrap_or_else(|| product_default_bind.to_owned())
                .parse::<SocketAddr>()?;
            let policy_override = match authentication_name.as_str() {
                "local-open" => Some(WebAccessPolicy::LocalOpen),
                "paired" => Some(WebAccessPolicy::Paired),
                _ => None,
            };
            (
                bind,
                GatewayAuthentication::Web(WebAuthenticationConfig {
                    database: profile_root.join("web-auth.sqlite3"),
                    pairing_window: cli.pairing_window,
                    policy_override,
                }),
            )
        }
        value => {
            return Err(format!(
                "gateway auth must be auto, local-open, paired, basic, bearer, or development-none; got {value}"
            )
            .into());
        }
    };
    if cli.pairing_window && !matches!(authentication, GatewayAuthentication::Web(_)) {
        return Err("--pairing-window is accepted only with browser-session authentication".into());
    }
    let origin = cli.origin.clone().unwrap_or_else(|| {
        env::var("RSTORRENT_GATEWAY_ORIGIN").unwrap_or_else(|_| {
            if cli.chromeos_crostini {
                format!("http://{CROSTINI_HOST}:{}", bind_addr.port())
            } else if matches!(authentication, GatewayAuthentication::Web(_)) {
                format!("http://{bind_addr}")
            } else {
                "http://127.0.0.1:5173".to_owned()
            }
        })
    });
    let test_view_set_lease = env::var("RSTORRENT_TEST_VIEW_SET_LEASE_MILLIS")
        .ok()
        .map(|value| value.parse::<u64>())
        .transpose()?;
    let test_storage_write_delay = env::var("RSTORRENT_TEST_STORAGE_WRITE_DELAY_MILLIS")
        .ok()
        .map(|value| value.parse::<u64>())
        .transpose()?;
    let test_buffered_payload_bytes = env::var("RSTORRENT_TEST_BUFFERED_PAYLOAD_BYTES")
        .ok()
        .map(|value| value.parse::<usize>())
        .transpose()?;
    let test_peer_transport = env::var("RSTORRENT_TEST_PEER_TRANSPORT").ok();
    if test_peer_transport
        .as_deref()
        .is_some_and(|value| value != "tcp_only")
    {
        return Err("RSTORRENT_TEST_PEER_TRANSPORT must be tcp_only".into());
    }
    if (test_view_set_lease.is_some()
        || test_storage_write_delay.is_some()
        || test_buffered_payload_bytes.is_some()
        || test_peer_transport.is_some())
        && !matches!(
            authentication,
            GatewayAuthentication::UnauthenticatedLoopbackDevelopment
        )
    {
        return Err(
            "RSTORRENT_TEST_* controls are accepted only in unauthenticated development mode"
                .into(),
        );
    }
    if test_view_set_lease.is_some_and(|millis| !(250..=60_000).contains(&millis)) {
        return Err("test view-set lease must be within 250..=60000 milliseconds".into());
    }
    if test_storage_write_delay.is_some_and(|millis| millis > 10_000) {
        return Err("test storage write delay cannot exceed 10000 milliseconds".into());
    }
    if test_buffered_payload_bytes
        .is_some_and(|bytes| !(16 * 1024..=32 * 1024 * 1024).contains(&bytes))
    {
        return Err("test buffered payload limit must be within 16384..=33554432 bytes".into());
    }
    let network_policy = match env::var("RSTORRENT_NETWORK_POLICY")
        .unwrap_or_else(|_| "loopback_only".to_owned())
        .as_str()
    {
        "offline" => NetworkPolicy::Offline,
        "loopback_only" => NetworkPolicy::LoopbackOnly,
        "online" => NetworkPolicy::Online,
        value => {
            return Err(format!(
                "RSTORRENT_NETWORK_POLICY must be offline, loopback_only, or online; got {value}"
            )
            .into());
        }
    };
    let web_root = cli
        .web_root
        .clone()
        .map(Some)
        .unwrap_or(optional_path("RSTORRENT_WEB_ROOT")?);
    let build_id = cli
        .build_id
        .clone()
        .or_else(|| env::var("RSTORRENT_BUILD_ID").ok());
    let mut product = ProductIdentity::for_this_build(
        if cli.chromeos_crostini {
            "crostini"
        } else {
            "gateway"
        },
        env!("CARGO_PKG_VERSION"),
    );
    if let Some(build_id) = &build_id {
        product.build_id = build_id.clone();
    }
    let hosted_assets = match (web_root, build_id) {
        (Some(web_root), Some(build_id)) => {
            let assets = HostedAssets::new(web_root, build_id)?;
            Some(if cli.chromeos_crostini {
                assets.with_chromeos_handoff(JSTORRENT_BETA_EXTENSION_ID.to_owned())?
            } else {
                assets
            })
        }
        (None, None) => None,
        _ => {
            return Err(
                "RSTORRENT_WEB_ROOT and RSTORRENT_BUILD_ID must be configured together".into(),
            );
        }
    };
    if cli.open_browser && hosted_assets.is_none() {
        return Err("--open requires --web-root and --build-id".into());
    }

    let mut application_config = ApplicationConfig::new(
        profile_root.clone(),
        "default".to_owned(),
        storage_roots,
        NetworkConfig::new(
            network_policy,
            Duration::from_secs(15),
            Duration::from_secs(60),
        ),
    )
    .with_fresh_profile_defaults()
    .with_product(product);
    if let Some(lease_millis) = test_view_set_lease {
        application_config.view_set_lease = Duration::from_millis(lease_millis);
        application_config.view_set_reaper_interval =
            Duration::from_millis((lease_millis / 5).clamp(10, 100));
    }
    if let Some(delay_millis) = test_storage_write_delay {
        application_config.storage_write_delay_for_testing = Duration::from_millis(delay_millis);
    }
    if let Some(buffered_bytes) = test_buffered_payload_bytes {
        application_config.download_resource_limits = DownloadResourceLimits::new(
            buffered_bytes.saturating_mul(8),
            buffered_bytes,
            buffered_bytes.saturating_mul(8),
        );
    }
    if test_peer_transport.is_some() {
        application_config.peer_transport_policy = PeerTransportPolicy::TcpOnly;
    }
    let config = GatewayConfig {
        bind: bind_addr,
        authentication,
        allowed_origin: origin.clone(),
        max_connections: rstorrent_gateway::MAX_CONNECTIONS,
    };
    let local_hosted = matches!(
        config.authentication,
        GatewayAuthentication::UnauthenticatedLoopbackDevelopment
    );
    let hosts_web = hosted_assets.is_some();
    if matches!(config.authentication, GatewayAuthentication::Web(_)) {
        std::fs::create_dir_all(&profile_root)?;
    }
    let prepared = match hosted_assets {
        Some(assets) if cli.chromeos_crostini => prepare_crostini_hosted(config, assets).await?,
        Some(assets) if local_hosted => prepare_local_hosted(config, assets).await?,
        Some(assets) => prepare_hosted(config, assets).await?,
        None => prepare(config).await?,
    };
    let application = ApplicationService::open(application_config).await?;
    let application = Arc::new(Mutex::new(application));
    let server = prepared.attach(application.clone()).await?;
    let browser_url = if cli.chromeos_crostini {
        format!("{}/", origin.trim_end_matches('/'))
    } else {
        browser_application_url(server.local_addr())
    };
    eprintln!("gateway listening on {}", server.local_addr());
    if hosts_web {
        eprintln!("web UI: {browser_url}");
    }
    if cli.pairing_window {
        eprintln!(
            "browser pairing window open for 10 minutes; the first explicit approval consumes it"
        );
    }
    if cli.open_browser {
        open_browser(&browser_url)?;
    }
    let connection_metrics = server.connection_metrics();
    let shutdown = CancellationToken::new();
    let hurry = CancellationToken::new();
    tokio::spawn(escalate_shutdown_signals(shutdown.clone(), hurry.clone()));
    let mut serving = tokio::spawn(server.serve(shutdown.clone()));
    let served_before_signal = tokio::select! {
        served = &mut serving => Some(served),
        () = shutdown.cancelled() => None,
    };
    let shutdown_began = Instant::now();
    match served_before_signal {
        Some(served) => served??,
        None => tokio::select! {
            served = &mut serving => served??,
            () = hurry.cancelled() => {
                serving.abort();
                report_shutdown(shutdown_began, "stopped waiting for HTTP connections to close");
            }
        },
    }
    report_shutdown(shutdown_began, "HTTP server stopped");
    eprintln!(
        "gateway_connection_metrics {}",
        serde_json::to_string(&connection_metrics.snapshot())?
    );
    let mut application = application.lock().await;
    let incoming_before_shutdown = application.incoming_peer_snapshot();
    let storage_before_shutdown = application.storage_file_pool_snapshot();
    application
        .shutdown_with(ShutdownOptions {
            hurry,
            progress: Some(Arc::new(move |progress| {
                report_shutdown(shutdown_began, &describe_shutdown_progress(&progress));
            })),
            ..ShutdownOptions::default()
        })
        .await?;
    let storage_after_shutdown = application.storage_file_pool_snapshot();
    let incoming_metrics = incoming_before_shutdown.map_or(serde_json::Value::Null, |snapshot| {
        serde_json::json!({
            "listen": snapshot.listen_address.to_string(),
            "registrations_before_shutdown": snapshot.registrations,
            "pending_before_shutdown": snapshot.pending,
            "established_before_shutdown": snapshot.established,
            "reads_before_shutdown": snapshot.reads,
            "read_bytes_before_shutdown": snapshot.read_bytes,
            "peer_budget_total_before_shutdown": snapshot.peer_budget.total,
            "outgoing_connecting_before_shutdown": snapshot.peer_budget.outgoing_connecting,
            "outgoing_established_before_shutdown": snapshot.peer_budget.outgoing_established,
            "incoming_connecting_before_shutdown": snapshot.peer_budget.incoming_connecting,
            "incoming_established_before_shutdown": snapshot.peer_budget.incoming_established,
            "upload_peers_before_shutdown": snapshot.upload_scheduler.peers,
            "upload_interested_before_shutdown": snapshot.upload_scheduler.interested,
            "upload_regular_before_shutdown": snapshot.upload_scheduler.regular,
            "upload_optimistic_before_shutdown": snapshot.upload_scheduler.optimistic,
            "torrent_upload_records_before_shutdown": snapshot.torrent_uploads.len(),
            "peer_upload_records_before_shutdown": snapshot.peer_uploads.len(),
            "configured_connection_limit": snapshot.peer_budget.configured_limit,
            "effective_connection_limit": snapshot.peer_budget.effective_limit,
            "incoming_connection_slack": snapshot.peer_budget.incoming_slack,
            "pending_high_water": snapshot.pending_high_water,
            "established_high_water": snapshot.established_high_water,
            "connection_high_water": snapshot.peer_budget.total_high_water,
            "upload_regular_high_water": snapshot.upload_regular_high_water,
            "upload_optimistic_high_water": snapshot.upload_optimistic_high_water,
            "upload_slots_high_water": snapshot.upload_slots_high_water,
            "queued_requests_high_water": snapshot.queued_requests_high_water,
            "queued_bytes_high_water": snapshot.queued_bytes_high_water,
            "read_high_water": snapshot.read_high_water,
            "read_bytes_high_water": snapshot.read_bytes_high_water,
            "writer_send_buffer_high_water": snapshot.writer_send_buffer_high_water,
            "payload_bytes_sent": snapshot.payload_bytes_sent,
        })
    });
    eprintln!(
        "gateway_application_metrics {}",
        serde_json::to_string(&serde_json::json!({
            "incoming": incoming_metrics,
            "incoming_owner_after_shutdown": application.incoming_peer_snapshot().is_some(),
            "storage_limit": storage_before_shutdown.limit,
            "storage_owned_before_shutdown": storage_before_shutdown.current_owned,
            "storage_owned_high_water": storage_before_shutdown.owned_high_water,
            "storage_cached_before_shutdown": storage_before_shutdown.cached_entries,
            "platform_pending_high_water": storage_before_shutdown.platform_pending_high_water,
            "storage_owned_after_shutdown": storage_after_shutdown.current_owned,
            "storage_cached_after_shutdown": storage_after_shutdown.cached_entries,
            "platform_pending_after_shutdown": storage_after_shutdown.platform_pending,
        }))?
    );
    Ok(())
}

#[derive(Default)]
struct CliOptions {
    product_cli: bool,
    help: bool,
    profile_root: Option<PathBuf>,
    listen: Option<String>,
    origin: Option<String>,
    auth: Option<String>,
    basic_username: Option<String>,
    basic_password_file: Option<PathBuf>,
    bearer_token_file: Option<PathBuf>,
    web_root: Option<PathBuf>,
    build_id: Option<String>,
    pairing_window: bool,
    open_browser: bool,
    chromeos_crostini: bool,
}

impl CliOptions {
    fn parse(arguments: impl IntoIterator<Item = String>) -> Result<Self, Box<dyn Error>> {
        let mut arguments = arguments.into_iter().peekable();
        let mut options = Self::default();
        if arguments.peek().is_some_and(|argument| argument == "serve") {
            options.product_cli = true;
            arguments.next();
        } else if arguments.peek().is_some() {
            options.product_cli = true;
        }
        while let Some(argument) = arguments.next() {
            let value = |arguments: &mut std::iter::Peekable<_>| {
                arguments
                    .next()
                    .filter(|value: &String| !value.is_empty())
                    .ok_or_else(|| format!("{argument} requires a value"))
            };
            match argument.as_str() {
                "-h" | "--help" => options.help = true,
                "--profile-root" => {
                    options.profile_root = Some(PathBuf::from(value(&mut arguments)?))
                }
                "--listen" => options.listen = Some(value(&mut arguments)?),
                "--origin" => options.origin = Some(value(&mut arguments)?),
                "--auth" => options.auth = Some(value(&mut arguments)?),
                "--basic-username" => options.basic_username = Some(value(&mut arguments)?),
                "--basic-password-file" => {
                    options.basic_password_file = Some(PathBuf::from(value(&mut arguments)?))
                }
                "--bearer-token-file" => {
                    options.bearer_token_file = Some(PathBuf::from(value(&mut arguments)?))
                }
                "--web-root" => options.web_root = Some(PathBuf::from(value(&mut arguments)?)),
                "--build-id" => options.build_id = Some(value(&mut arguments)?),
                "--pairing-window" => options.pairing_window = true,
                "--chromeos-crostini" => options.chromeos_crostini = true,
                "--open" => options.open_browser = true,
                "--no-open" => options.open_browser = false,
                value => return Err(format!("unknown gateway argument {value:?}").into()),
            }
        }
        Ok(options)
    }
}

fn print_help() {
    println!(
        "RSTorrent headless web gateway\n\n\
         Usage: rstorrent-gateway serve [OPTIONS]\n\n\
         Options:\n\
           --profile-root PATH         Profile and web-auth state root\n\
           --listen ADDRESS            Listener address (default 127.0.0.1:3030)\n\
           --origin URL                Exact browser Origin\n\
           --auth MODE                 auto, local-open, paired, basic, bearer, or development-none\n\
           --pairing-window            Recover one browser during a 10-minute restart window\n\
           --basic-username NAME       Basic deployment username\n\
           --basic-password-file PATH  Basic deployment password file\n\
           --bearer-token-file PATH    Bearer automation token file\n\
           --web-root PATH             Production web bundle directory\n\
           --build-id ID               Hosted build identity\n\
           --chromeos-crostini         Exact jstorrent.localhost product mode\n\
           --open | --no-open          Open or do not open the browser\n\
           -h, --help                  Show this help\n\n\
         Secret values are accepted from files, not literal command arguments."
    );
}

fn open_browser(url: &str) -> Result<(), Box<dyn Error>> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(url).status()?;
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open").arg(url).status()?;
    if !status.success() {
        return Err(format!("browser opener exited with {status}").into());
    }
    Ok(())
}

fn browser_application_url(address: SocketAddr) -> String {
    format!("http://{address}/")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShutdownTier {
    Graceful,
    Hurry,
    Exit,
}

/// The first Ctrl+C or SIGTERM stops gracefully, the second skips the
/// remaining tracker and port-mapping cleanup, and any later one exits.
fn shutdown_tier(signals_received: usize) -> ShutdownTier {
    match signals_received {
        0 | 1 => ShutdownTier::Graceful,
        2 => ShutdownTier::Hurry,
        _ => ShutdownTier::Exit,
    }
}

async fn escalate_shutdown_signals(shutdown: CancellationToken, hurry: CancellationToken) {
    #[cfg(unix)]
    let (mut interrupt, mut terminate) = {
        use tokio::signal::unix::{SignalKind, signal};
        (
            signal(SignalKind::interrupt()).expect("install interrupt signal handler"),
            signal(SignalKind::terminate()).expect("install terminate signal handler"),
        )
    };
    let mut began = Instant::now();
    for signals_received in 1.. {
        #[cfg(unix)]
        tokio::select! {
            _ = interrupt.recv() => {}
            _ = terminate.recv() => {}
        }
        #[cfg(not(unix))]
        if tokio::signal::ctrl_c().await.is_err() {
            return;
        }
        match shutdown_tier(signals_received) {
            ShutdownTier::Graceful => {
                began = Instant::now();
                eprintln!(
                    "shutdown: stopping; signal again to skip tracker and port-mapping cleanup"
                );
                shutdown.cancel();
            }
            ShutdownTier::Hurry => {
                report_shutdown(
                    began,
                    "skipping remaining network cleanup; signal again to exit immediately",
                );
                hurry.cancel();
            }
            ShutdownTier::Exit => {
                report_shutdown(
                    began,
                    "exiting immediately; saved state is kept, unsaved progress is lost",
                );
                std::process::exit(130);
            }
        }
    }
}

fn report_shutdown(began: Instant, message: &str) {
    eprintln!("shutdown: {message} (+{} ms)", began.elapsed().as_millis());
}

fn describe_shutdown_progress(progress: &ShutdownProgress) -> String {
    match progress {
        ShutdownProgress::StoppingTorrents { count: 0 } => "no active torrents".to_owned(),
        ShutdownProgress::StoppingTorrents { count: 1 } => "stopping 1 torrent".to_owned(),
        ShutdownProgress::StoppingTorrents { count } => format!("stopping {count} torrents"),
        ShutdownProgress::NetworkCleanup { budget } => format!(
            "announcing stop to trackers and removing port mappings (up to {} ms)",
            budget.as_millis()
        ),
        ShutdownProgress::TrackerStopsCutShort { torrents } => format!(
            "tracker stop announces for {torrents} torrent(s) did not finish; trackers will time them out"
        ),
        ShutdownProgress::PortMappingLeft { detail } => {
            format!("port mapping left on the router: {detail}")
        }
        ShutdownProgress::NetworkStopped => "network stopped".to_owned(),
        ShutdownProgress::SavingState => "saving state".to_owned(),
        ShutdownProgress::Finished => "stopped".to_owned(),
    }
}

fn required_string(name: &str) -> Result<String, Box<dyn Error>> {
    let value = env::var(name).map_err(|_| format!("{name} is required"))?;
    if value.is_empty() {
        return Err(format!("{name} must be nonempty").into());
    }
    Ok(value)
}

fn required_path(name: &str) -> Result<PathBuf, Box<dyn Error>> {
    Ok(PathBuf::from(required_string(name)?))
}

fn optional_path(name: &str) -> Result<Option<PathBuf>, Box<dyn Error>> {
    match env::var_os(name) {
        None => Ok(None),
        Some(value) if value.is_empty() => Err(format!("{name} must be nonempty").into()),
        Some(value) => Ok(Some(PathBuf::from(value))),
    }
}

fn required_password_file(name: &str) -> Result<String, Box<dyn Error>> {
    let path = required_path(name)?;
    read_password_file(&path, name)
}

fn read_password_file(path: &std::path::Path, label: &str) -> Result<String, Box<dyn Error>> {
    read_secret_file(path, MAX_BASIC_PASSWORD_BYTES, label)
}

fn read_secret_file(
    path: &std::path::Path,
    maximum_bytes: usize,
    label: &str,
) -> Result<String, Box<dyn Error>> {
    let bytes = std::fs::read(path)?;
    if bytes.len() > maximum_bytes + 2 {
        return Err(format!("{label} exceeds its configured bound").into());
    }
    let mut secret = String::from_utf8(bytes)?;
    if secret.ends_with("\r\n") {
        secret.truncate(secret.len() - 2);
    } else if secret.ends_with('\n') {
        secret.pop();
    }
    if secret.contains(['\r', '\n']) {
        return Err(format!("{label} must contain one secret line").into());
    }
    if secret.is_empty() || secret.len() > maximum_bytes {
        return Err(format!("{label} must contain 1..={maximum_bytes} bytes").into());
    }
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    use super::{CliOptions, ShutdownTier, browser_application_url, shutdown_tier};

    #[test]
    fn product_cli_parses_listener_auth_and_recovery() {
        let options = CliOptions::parse(
            [
                "serve",
                "--profile-root",
                "/tmp/profile",
                "--listen",
                "127.0.0.1:4040",
                "--auth",
                "paired",
                "--pairing-window",
                "--no-open",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .expect("parse");
        assert!(options.product_cli);
        assert_eq!(options.listen.as_deref(), Some("127.0.0.1:4040"));
        assert_eq!(options.auth.as_deref(), Some("paired"));
        assert!(options.pairing_window);
        assert!(!options.open_browser);
    }

    #[test]
    fn product_cli_rejects_literal_or_unknown_secret_flags() {
        let error = CliOptions::parse(
            ["serve", "--password", "secret"]
                .into_iter()
                .map(str::to_owned),
        )
        .err()
        .expect("reject literal password");
        assert!(error.to_string().contains("unknown gateway argument"));
    }

    #[test]
    fn repeated_signals_escalate_from_graceful_to_hurry_to_exit() {
        assert_eq!(shutdown_tier(1), ShutdownTier::Graceful);
        assert_eq!(shutdown_tier(2), ShutdownTier::Hurry);
        assert_eq!(shutdown_tier(3), ShutdownTier::Exit);
        assert_eq!(shutdown_tier(4), ShutdownTier::Exit);
    }

    #[test]
    fn browser_url_selects_the_same_origin_live_application() {
        assert_eq!(
            browser_application_url(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3030)),
            "http://127.0.0.1:3030/"
        );
    }
}
