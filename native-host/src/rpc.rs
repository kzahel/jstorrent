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
pub struct UnifiedRpcInfo {
    pub version: u32,
    pub profiles: Vec<ProfileEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileEntry {
    pub profile_dir: String,
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub salt: String,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    pub download_roots: Vec<DownloadRoot>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadRoot {
    pub token: String,
    pub path: String,
    pub display_name: String,
    pub removable: bool,
    pub last_stat_ok: bool,
    pub last_checked: u64,
}

// Legacy struct used by main.rs, updated to carry necessary info
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RpcInfo {
    // version is now file-level, but we keep it here for compatibility or remove it?
    // main.rs sets it to 1.
    pub version: u32, 
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    // New fields
    pub salt: String,
    pub download_roots: Vec<DownloadRoot>,
    pub install_id: Option<String>,
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
        crate::log!("Refused add-magnet request: Invalid token");
        return Err(StatusCode::FORBIDDEN);
    }

    crate::log!("Received add-magnet request: {}", payload.magnet);

    if let Some(sender) = &state.event_sender {
         let event = Event::MagnetAdded { link: payload.magnet.clone() };
         let _ = sender.send(event).await;
    }

    crate::log!("Magnet link queued successfully");

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
        crate::log!("Refused add-torrent request: Invalid token");
        return Err(StatusCode::FORBIDDEN);
    }

    crate::log!("Received add-torrent request: {} ({} bytes)", payload.file_name, payload.contents_base64.len());

    if let Some(sender) = &state.event_sender {
        let event = Event::TorrentAdded {
            name: payload.file_name,
            infohash: "".to_string(), // Extension will calculate this
            contents_base64: payload.contents_base64,
        };
        
        let _ = sender.send(event).await;
    }

    crate::log!("Torrent file queued successfully");

    Ok(Json(StatusResponse {
        status: "queued".to_string(),
        message: "Torrent file queued".to_string(),
    }))
}

pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<()> {
    let config_dir = dirs::config_dir().ok_or_else(|| anyhow::anyhow!("No config dir"))?;
    let app_dir = config_dir.join("jstorrent-native");
    fs::create_dir_all(&app_dir)?;
    
    let path = app_dir.join("rpc-info.json");
    
    // Read existing file
    let mut unified_info = if path.exists() {
        match fs::File::open(&path) {
            Ok(file) => {
                match serde_json::from_reader::<_, UnifiedRpcInfo>(file) {
                    Ok(mut u) => {
                        // Clean up old profiles? 
                        // For now, just keep them.
                        u
                    },
                    Err(_) => {
                        // If parse fails, start fresh
                        UnifiedRpcInfo {
                            version: 1,
                            profiles: Vec::new(),
                        }
                    }
                }
            },
            Err(_) => UnifiedRpcInfo {
                version: 1,
                profiles: Vec::new(),
            }
        }
    } else {
        UnifiedRpcInfo {
            version: 1,
            profiles: Vec::new(),
        }
    };
    
    // Update or insert profile
    // Logic:
    // 1. If info.install_id is Some, try to find entry with same install_id.
    // 2. If not found (or info.install_id is None), try to find entry with same PID (temp entry).
    
    let mut found_idx = None;
    
    if let Some(ref install_id) = info.install_id {
        found_idx = unified_info.profiles.iter().position(|p| p.install_id.as_ref() == Some(install_id));
    }
    
    if found_idx.is_none() {
        found_idx = unified_info.profiles.iter().position(|p| p.pid == info.pid);
    }
    
    if let Some(idx) = found_idx {
        // Update existing entry, preserving salt and download_roots
        let mut entry = unified_info.profiles[idx].clone();
        entry.pid = info.pid;
        entry.port = info.port;
        entry.token = info.token.clone();
        entry.started = info.started;
        entry.last_used = info.last_used;
        entry.browser = info.browser.clone();
        entry.extension_id = info.browser.extension_id.clone();
        
        // Update install_id if we have one and entry doesn't (or even if it does)
        if info.install_id.is_some() {
            entry.install_id = info.install_id.clone();
        }
        
        // salt and download_roots are preserved from `entry`
        
        unified_info.profiles[idx] = entry;
    } else {
        // New entry
        let new_entry = ProfileEntry {
            profile_dir: info.browser.profile_id.clone(),
            extension_id: info.browser.extension_id.clone(),
            install_id: info.install_id.clone(),
            salt: info.salt.clone(),
            pid: info.pid,
            port: info.port,
            token: info.token.clone(),
            started: info.started,
            last_used: info.last_used,
            browser: info.browser.clone(),
            download_roots: info.download_roots.clone(),
        };
        unified_info.profiles.push(new_entry);
    }
    
    // Atomic write
    let temp_file = tempfile::NamedTempFile::new_in(&app_dir)?;
    serde_json::to_writer(&temp_file, &unified_info)?;
    temp_file.persist(path)?;
    
    Ok(())
}
