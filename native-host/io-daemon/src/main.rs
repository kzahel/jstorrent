use axum::{
    http::{header::{AUTHORIZATION, CONTENT_TYPE}, HeaderName, Method},
    routing::get,
    Router,
};

// Custom headers for file API
const X_PATH_BASE64: HeaderName = HeaderName::from_static("x-path-base64");
const X_OFFSET: HeaderName = HeaderName::from_static("x-offset");
const X_LENGTH: HeaderName = HeaderName::from_static("x-length");
const X_EXPECTED_SHA1: HeaderName = HeaderName::from_static("x-expected-sha1");
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

mod auth;
mod control;
mod files;
mod hashing;
mod http;
mod ws;
mod config;




#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 0)]
    port: u16,

    /// Authentication token
    #[arg(short, long)]
    token: String,

    /// Parent PID to monitor
    #[arg(long)]
    parent_pid: Option<u32>,

    /// Installation ID
    #[arg(long)]
    install_id: String,
}

#[derive(Clone)]
pub struct AppState {
    pub token: String,
    pub install_id: String,
    pub extension_id: Arc<std::sync::RwLock<Option<String>>>,
    pub download_roots: Arc<std::sync::RwLock<Vec<jstorrent_common::DownloadRoot>>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Set up logging to both stderr and file
    let log_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let file_appender = tracing_appender::rolling::never(&log_dir, "io-daemon.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::EnvFilter;

    // Default to INFO level, but allow override via RUST_LOG env var
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking).with_ansi(false))
        .init();

    tracing::info!("io-daemon starting, logging to {:?}", log_dir.join("io-daemon.log"));

    // Log binary mtime to help diagnose stale binary issues
    if let Ok(exe_path) = std::env::current_exe() {
        if let Ok(metadata) = std::fs::metadata(&exe_path) {
            if let Ok(mtime) = metadata.modified() {
                let datetime: chrono::DateTime<chrono::Local> = mtime.into();
                tracing::info!("binary: {:?}, mtime: {}", exe_path, datetime.format("%Y-%m-%d %H:%M:%S"));
            }
        }
    }

    let args = Args::parse();

    // Load initial config from rpc-info.json
    let (roots, extension_id) = config::load_config(&args.install_id)
        .map(|c| (c.download_roots, c.extension_id))
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to load initial config: {}", e);
            (Vec::new(), None)
        });

    let state = Arc::new(AppState {
        token: args.token.clone(),
        install_id: args.install_id.clone(),
        extension_id: Arc::new(std::sync::RwLock::new(extension_id.clone())),
        download_roots: Arc::new(std::sync::RwLock::new(roots)),
    });

    // Monitor parent process if specified
    if let Some(pid) = args.parent_pid {
        tokio::spawn(async move {
            monitor_parent(pid).await;
        });
    }

    // CORS layer - allow extension origin + dev origins from environment
    // max_age caches preflight responses for 24 hours to reduce OPTIONS requests
    let cors = {
        let mut allowed_origins: Vec<axum::http::HeaderValue> = vec![];

        // Add Chrome extension origin if available
        if let Some(ref ext_id) = extension_id {
            let origin = format!("chrome-extension://{}", ext_id);
            tracing::info!("CORS: Adding extension origin: {}", origin);
            if let Ok(val) = origin.parse() {
                allowed_origins.push(val);
            }
        }

        // Add dev origins from environment (set by native-host from jstorrent-native.env)
        if let Ok(dev_origins) = std::env::var("JSTORRENT_DEV_ORIGINS") {
            for origin in dev_origins.split(',') {
                let origin = origin.trim();
                if !origin.is_empty() {
                    tracing::info!("CORS: Adding dev origin: {}", origin);
                    if let Ok(val) = origin.parse() {
                        allowed_origins.push(val);
                    }
                }
            }
        }

        let allowed_headers = [
            CONTENT_TYPE,
            AUTHORIZATION,
            HeaderName::from_static("x-jst-auth"),
            X_PATH_BASE64,
            X_OFFSET,
            X_LENGTH,
            X_EXPECTED_SHA1,
        ];

        if allowed_origins.is_empty() {
            tracing::warn!("CORS: No origins configured, allowing any origin");
            CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
                .allow_headers(allowed_headers)
                .max_age(Duration::from_secs(86400))
        } else {
            CorsLayer::new()
                .allow_origin(allowed_origins)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
                .allow_headers(allowed_headers)
                .max_age(Duration::from_secs(86400))
        }
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(files::routes())
        .merge(hashing::routes())
        .merge(ws::routes())
        .merge(control::routes())
        .merge(config::routes())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::middleware))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    
    // Print the bound port to stdout so the parent can read it
    println!("{}", local_addr.port());

    tracing::info!("listening on {}", local_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}


#[cfg(unix)]
async fn monitor_parent(pid: u32) {
    use std::process::Command;
    use tokio::time::{sleep, Duration};

    loop {
        sleep(Duration::from_secs(1)).await;

        let output = Command::new("kill").arg("-0").arg(pid.to_string()).output();

        match output {
            Ok(output) => {
                if !output.status.success() {
                    tracing::info!("Parent process {} exited, shutting down", pid);
                    std::process::exit(0);
                }
            }
            Err(_) => {
                tracing::warn!("Failed to check parent process, shutting down");
                std::process::exit(1);
            }
        }
    }
}

#[cfg(windows)]
async fn monitor_parent(pid: u32) {
    use tokio::time::{sleep, Duration};
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    loop {
        sleep(Duration::from_secs(1)).await;

        // HANDLE is isize in windows-sys, 0 means failure
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle == 0 {
            tracing::info!("Parent process {} no longer exists, shutting down", pid);
            std::process::exit(0);
        }

        let mut exit_code: u32 = 0;
        let success = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
        unsafe { CloseHandle(handle) };

        if success == 0 {
            tracing::warn!("Failed to get parent process exit code, shutting down");
            std::process::exit(1);
        }

        if exit_code != STILL_ACTIVE as u32 {
            tracing::info!(
                "Parent process {} exited with code {}, shutting down",
                pid,
                exit_code
            );
            std::process::exit(0);
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("signal received, starting graceful shutdown");
}
