use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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
use crate::protocol::Event;



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

pub use jstorrent_common::{UnifiedRpcInfo, ProfileEntry, DownloadRoot, BrowserInfo, get_config_dir};
pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<()> {
    let config_dir = get_config_dir().ok_or_else(|| anyhow::anyhow!("Could not find config directory"))?;
    let app_dir = config_dir.join("jstorrent-native");
    
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)?;
    }

    let rpc_file = app_dir.join("rpc-info.json");

    // Lock file? For now just read-modify-write.
    // In a real scenario we might want file locking, but atomic write helps.

    let mut unified_info = if rpc_file.exists() {
        let file = fs::File::open(&rpc_file)?;
        serde_json::from_reader(file).unwrap_or_else(|_| UnifiedRpcInfo {
            version: 1,
            profiles: Vec::new(),
        })
    } else {
        UnifiedRpcInfo {
            version: 1,
            profiles: Vec::new(),
        }
    };

    // Find existing entry
    // Strategy:
    // 1. Find by install_id (persistent identity)
    // 2. Find by PID (temporary identity for this run)
    
    let mut found_idx = None;
    
    if let Some(ref iid) = info.install_id {
        found_idx = unified_info.profiles.iter().position(|p| p.install_id.as_ref() == Some(iid));
    }
    
    if found_idx.is_none() {
        // If not found by install_id, look for PID.
        // This handles the case where we started (wrote PID entry) and then received handshake (now have install_id).
        // We want to update the PID entry.
        // Verification: Ensure extension_id matches if present in both.
        found_idx = unified_info.profiles.iter().position(|p| {
            if p.pid == info.pid {
                // Check extension_id match
                if let (Some(ref a), Some(ref b)) = (&p.extension_id, &info.browser.extension_id) {
                    if a != b {
                        return false; // PID match but extension ID mismatch? Should be rare/impossible for same process, but safe to ignore.
                    }
                }
                return true;
            }
            false
        });
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
        
        // Update install_id if we have one
        if info.install_id.is_some() {
            entry.install_id = info.install_id.clone();
        }
        
        // salt and download_roots are preserved from `entry`
        
        unified_info.profiles[idx] = entry;

        // Cleanup: Remove any other entries with the same PID (temporary entries)
        if info.install_id.is_some() {
             unified_info.profiles.retain(|p| {
                 // Remove if PID matches current PID AND it has no install_id (temp entry)
                 if p.pid == info.pid && p.install_id.is_none() {
                     return false;
                 }
                 true
             });
        }
    } else {
        // New entry
        let new_entry = ProfileEntry {
            // Removed profile_dir
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
    temp_file.persist(&rpc_file).map_err(|e| e.error)?;

    Ok(())
}
