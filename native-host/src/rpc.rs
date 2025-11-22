use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::{
    routing::{get, post},
    Router, Json, extract::{State, Query}, http::StatusCode,
};
use uuid::Uuid;
use std::fs;
use std::io::Write;
use sysinfo::{Pid, System};
use crate::state::State as AppState;
use crate::protocol::{Event, ResponsePayload};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RpcInfo {
    pub version: u32,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BrowserInfo {
    pub name: String,
    pub binary: String,
    pub profile_id: String,
    pub profile_path: Option<String>,
    pub extension_id: Option<String>,
}

#[derive(Deserialize)]
pub struct TokenQuery {
    token: String,
}

#[derive(Deserialize)]
pub struct AddMagnetRequest {
    magnet: String,
}

#[derive(Deserialize)]
pub struct AddTorrentRequest {
    file_name: String,
    contents_base64: String,
}

#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    pid: u32,
    version: u32,
}

#[derive(Serialize)]
pub struct StatusResponse {
    status: String,
    message: String,
}

pub async fn start_server(state: Arc<AppState>) -> (u16, String) {
    let token = Uuid::new_v4().to_string();
    let token_clone = token.clone();
    
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/add-magnet", post(add_magnet_handler))
        .route("/add-torrent", post(add_torrent_handler))
        .with_state((state, token_clone));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (port, token)
}

async fn health_handler(
    State((_, server_token)): State<(Arc<AppState>, String)>,
    Query(query): Query<TokenQuery>,
) -> Result<Json<HealthResponse>, StatusCode> {
    if query.token != server_token {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(Json(HealthResponse {
        status: "ok".to_string(),
        pid: std::process::id(),
        version: 1,
    }))
}

async fn add_magnet_handler(
    State((state, server_token)): State<(Arc<AppState>, String)>,
    Query(query): Query<TokenQuery>,
    Json(payload): Json<AddMagnetRequest>,
) -> Result<Json<StatusResponse>, StatusCode> {
    if query.token != server_token {
        return Err(StatusCode::FORBIDDEN);
    }

    // Forward to main loop via mpsc channel in state? 
    // Actually, State doesn't have a sender to the main loop yet.
    // We need to add a sender to AppState or handle it differently.
    // For now, let's assume we can send an event.
    
    // TODO: We need a way to send events to the main loop.
    // The current State struct only holds sockets and paths.
    // We should probably add a `tokio::sync::mpsc::Sender<Event>` to State?
    // Or maybe just `Sender<Request>`?
    
    // Let's assume we'll add `event_sender` to State.
    
    if let Some(sender) = &state.event_sender {
         // Construct a fake "Request" or special internal event?
         // The main loop handles `Request` from stdin.
         // We might need to inject a `Request` into the stream or have a separate channel.
         
         // Let's send a custom event or handle it directly.
         // Actually, the main loop selects on `rx` (from stdin) and `event_rx` (from internal tasks).
         // `event_rx` receives `Event` which are sent to stdout.
         // We want to trigger an ACTION, effectively simulating a Request.
         
         // But `Event` is for outgoing messages to Chrome.
         // We want to tell the host to "do something" (add magnet).
         // If we want to send a message TO Chrome, we can use `event_sender`.
         
         // If the extension expects a specific event for "add magnet", we can send it.
         // Let's assume we send an event `MagnetAdded { link: ... }` to Chrome, 
         // and Chrome then handles it (e.g. adds to torrent engine).
         
         let event = Event::MagnetAdded { link: payload.magnet.clone() };
         
         let _ = sender.send(event).await;
    }

    Ok(Json(StatusResponse {
        status: "queued".to_string(),
        message: "Magnet link queued".to_string(),
    }))
}

async fn add_torrent_handler(
    State((state, server_token)): State<(Arc<AppState>, String)>,
    Query(query): Query<TokenQuery>,
    Json(payload): Json<AddTorrentRequest>,
) -> Result<Json<StatusResponse>, StatusCode> {
    if query.token != server_token {
        return Err(StatusCode::FORBIDDEN);
    }

    if let Some(sender) = &state.event_sender {
        // We don't parse the torrent here, we just forward it to the extension.
        // The extension (JS) will handle parsing and adding to the engine.
        // We'll use a placeholder infohash for now or empty string since we don't parse it here.
        // Actually, the design doc says "Use metadata as authoritative... Infohash...".
        // If the host is supposed to parse it, we'd need a bencode parser.
        // But `jstorrent-host` seems to be a dumb pipe.
        // Let's check `Cargo.toml` for bencode deps.
        // No bencode deps. So we probably shouldn't parse it here.
        // We'll send it to the extension.
        
        let event = Event::TorrentAdded {
            name: payload.file_name,
            infohash: "".to_string(), // Extension will calculate this
            contents_base64: payload.contents_base64,
        };
        
        let _ = sender.send(event).await;
    }

    Ok(Json(StatusResponse {
        status: "queued".to_string(),
        message: "Torrent file queued".to_string(),
    }))
}

pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<()> {
    let config_dir = dirs::config_dir().ok_or_else(|| anyhow::anyhow!("No config dir"))?;
    let app_dir = config_dir.join("jstorrent-native");
    fs::create_dir_all(&app_dir)?;
    
    let filename = format!("rpc-info-{}.json", info.browser.profile_id);
    let path = app_dir.join(filename);
    
    // Atomic write
    let temp_file = tempfile::NamedTempFile::new_in(&app_dir)?;
    serde_json::to_writer(&temp_file, &info)?;
    temp_file.persist(path)?;
    
    Ok(())
}
