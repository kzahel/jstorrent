use axum::{
    routing::{get, post},
    Router,
};
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;
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
    pub download_roots: Arc<std::sync::RwLock<Vec<jstorrent_common::DownloadRoot>>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let args = Args::parse();
    
    // Load initial config
    let roots = config::load_config(&args.install_id).unwrap_or_else(|e| {
        tracing::warn!("Failed to load initial config: {}", e);
        Vec::new()
    });

    let state = Arc::new(AppState {
        token: args.token.clone(),
        install_id: args.install_id.clone(),
        download_roots: Arc::new(std::sync::RwLock::new(roots)),
    });

    // Monitor parent process if specified
    if let Some(pid) = args.parent_pid {
        tokio::spawn(async move {
            monitor_parent(pid).await;
        });
    }

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(files::routes())
        .merge(hashing::routes())
        .merge(ws::routes())
        .merge(control::routes())
        .merge(config::routes())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::middleware))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

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


async fn monitor_parent(pid: u32) {
    use tokio::time::{sleep, Duration};
    use std::process::Command;

    loop {
        sleep(Duration::from_secs(1)).await;
        
        // Simple check if process exists (works on Linux)
        let output = Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .output();

        match output {
            Ok(output) => {
                if !output.status.success() {
                    tracing::info!("Parent process {} exited, shutting down", pid);
                    std::process::exit(0);
                }
            }
            Err(_) => {
                // If we can't check, assume it's gone or something is wrong
                tracing::warn!("Failed to check parent process, shutting down");
                std::process::exit(1);
            }
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
