use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use crate::AppState;

#[derive(Serialize)]
pub struct StatsResponse {
    /// Number of active TCP sockets
    tcp_sockets: u32,
    /// Number of pending TCP connections
    pending_connects: u32,
    /// Number of pending TCP streams (connected but not activated)
    pending_tcp: u32,
    /// Number of active UDP sockets
    udp_sockets: u32,
    /// Number of active TCP servers (listeners)
    tcp_servers: u32,
    /// Number of active WebSocket connections
    ws_connections: u32,
    /// Total bytes sent
    bytes_sent: u64,
    /// Total bytes received
    bytes_received: u64,
    /// Uptime in seconds
    uptime_secs: u64,
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/control/shutdown", post(shutdown))
        .route("/control/ping", post(ping))
        .route("/stats", get(stats))
}

async fn shutdown() {
    tracing::info!("Shutdown requested via API");
    std::process::exit(0);
}

async fn ping() -> &'static str {
    "pong"
}

async fn stats(State(state): State<Arc<AppState>>) -> Json<StatsResponse> {
    let stats = &state.stats;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let start_time = stats.start_time.load(Ordering::Relaxed);

    Json(StatsResponse {
        tcp_sockets: stats.tcp_sockets.load(Ordering::Relaxed),
        pending_connects: stats.pending_connects.load(Ordering::Relaxed),
        pending_tcp: stats.pending_tcp.load(Ordering::Relaxed),
        udp_sockets: stats.udp_sockets.load(Ordering::Relaxed),
        tcp_servers: stats.tcp_servers.load(Ordering::Relaxed),
        ws_connections: stats.ws_connections.load(Ordering::Relaxed),
        bytes_sent: stats.bytes_sent.load(Ordering::Relaxed),
        bytes_received: stats.bytes_received.load(Ordering::Relaxed),
        uptime_secs: now.saturating_sub(start_time),
    })
}
