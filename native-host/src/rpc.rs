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
    pub version: String,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    /// None = don't update roots, Some(vec) = set roots to vec (even if empty)
    pub download_roots: Option<Vec<DownloadRoot>>,
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
    version: String,
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
        version: env!("CARGO_PKG_VERSION").to_string(),
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

    // Chrome native messaging limits messages to 1MB. Base64 adds ~33% overhead,
    // plus JSON wrapper. Reject files that would exceed this limit.
    const MAX_BASE64_SIZE: usize = 900_000; // ~675KB original, conservative margin
    if payload.contents_base64.len() > MAX_BASE64_SIZE {
        crate::log!(
            "Torrent file too large: {} bytes base64 (limit: {})",
            payload.contents_base64.len(),
            MAX_BASE64_SIZE
        );
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
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
pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<Vec<DownloadRoot>> {
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

    let active_roots;

    if let Some(idx) = found_idx {
        // Update existing entry
        let mut entry = unified_info.profiles[idx].clone();
        entry.pid = info.pid;
        entry.port = info.port;
        entry.token = info.token.clone();
        entry.started = info.started;
        entry.last_used = info.last_used;
        // Update browser info, but preserve existing binary if new one doesn't exist on disk
        // (happens when Chrome updates while running - Linux shows "(deleted)" in /proc/pid/exe)
        let new_binary = &info.browser.binary;
        if !new_binary.is_empty() && std::path::Path::new(new_binary).exists() {
            entry.browser = info.browser.clone();
        } else {
            // Update name and extension_id, but preserve the existing binary path
            entry.browser.name = info.browser.name.clone();
            entry.browser.extension_id = info.browser.extension_id.clone();
        }
        entry.extension_id = info.browser.extension_id.clone();
        
        // Update install_id if we have one
        if info.install_id.is_some() {
            entry.install_id = info.install_id.clone();
        }

        // Only update roots if explicitly provided (Some)
        // None means "don't update" - preserves existing roots on startup
        // Some(vec) means "set to this" - allows removing all roots
        if let Some(roots) = &info.download_roots {
            entry.download_roots = roots.clone();
        }

        active_roots = entry.download_roots.clone();
        
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
        // New entry - use provided roots or empty
        let new_entry = ProfileEntry {
            extension_id: info.browser.extension_id.clone(),
            install_id: info.install_id.clone(),
            pid: info.pid,
            port: info.port,
            token: info.token.clone(),
            started: info.started,
            last_used: info.last_used,
            browser: info.browser.clone(),
            download_roots: info.download_roots.clone().unwrap_or_default(),
        };
        active_roots = new_entry.download_roots.clone();
        unified_info.profiles.push(new_entry);
    }

    // Atomic write
    let temp_file = tempfile::NamedTempFile::new_in(&app_dir)?;
    serde_json::to_writer(&temp_file, &unified_info)?;
    // Sync to ensure data is on disk before rename
    temp_file.as_file().sync_all()?;
    temp_file.persist(&rpc_file).map_err(|e| e.error)?;

    Ok(active_roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn make_test_root(key: &str, path: &str) -> DownloadRoot {
        DownloadRoot {
            key: key.to_string(),
            path: path.to_string(),
            display_name: format!("Test Root {}", key),
            removable: true,
            last_stat_ok: true,
            last_checked: 0,
        }
    }

    fn make_rpc_info(pid: u32, install_id: Option<&str>, roots: Option<Vec<DownloadRoot>>) -> RpcInfo {
        RpcInfo {
            version: "0.1.0".to_string(),
            pid,
            port: 12345,
            token: "test-token".to_string(),
            started: 1000,
            last_used: 1000,
            browser: BrowserInfo {
                name: "Chrome".to_string(),
                binary: "/bin/sh".to_string(), // Use a path that exists on all Unix systems
                extension_id: Some("test-ext-id".to_string()),
            },
            download_roots: roots,
            install_id: install_id.map(|s| s.to_string()),
        }
    }

    /// Test: Startup with existing roots in rpc-info.json preserves them
    /// Simulates the REAL restart scenario:
    /// 1. First run: roots are saved with install_id
    /// 2. Restart: new PID, no install_id, download_roots: None -> returns empty, state becomes Some([])
    /// 3. Handshake: MUST pass None (not Some([])) to preserve existing roots
    #[test]
    #[serial]
    fn test_startup_preserves_existing_roots() {
        let temp_dir = TempDir::new().unwrap();
        std::env::set_var("JSTORRENT_CONFIG_DIR", temp_dir.path());

        // Create the app directory
        let app_dir = temp_dir.path().join("jstorrent-native");
        std::fs::create_dir_all(&app_dir).unwrap();

        let install_id = "test-install-123";
        let test_root = make_test_root("root-key-1", "/home/user/Downloads");

        // Step 1: First run - create entry with roots and install_id
        let info1 = make_rpc_info(1000, Some(install_id), Some(vec![test_root.clone()]));
        let roots1 = write_discovery_file(info1).unwrap();
        assert_eq!(roots1.len(), 1);
        assert_eq!(roots1[0].key, "root-key-1");

        // Step 2: Restart - new PID, no install_id yet, download_roots: None
        // This simulates the native host starting up before handshake
        let info2 = make_rpc_info(2000, None, None);
        let roots2 = write_discovery_file(info2).unwrap();
        // New entry created (no install_id match, no PID match), returns empty
        assert_eq!(roots2.len(), 0);

        // At this point in real code, state.download_roots becomes Some(roots2) = Some([])
        // The handshake handler MUST set download_roots = None before calling write_discovery_file

        // Step 3: Handshake - same install_id, download_roots: None (NOT Some([])!)
        // This should find the OLD entry by install_id and preserve its roots
        let info3 = make_rpc_info(2000, Some(install_id), None); // Critical: None, not Some([])
        let roots3 = write_discovery_file(info3).unwrap();

        // Should return the preserved roots from the original entry
        assert_eq!(roots3.len(), 1, "Roots should be preserved after restart handshake");
        assert_eq!(roots3[0].key, "root-key-1");
        assert_eq!(roots3[0].path, "/home/user/Downloads");

        std::env::remove_var("JSTORRENT_CONFIG_DIR");
    }

    /// Test: Passing Some([]) on handshake WOULD wipe roots (regression test)
    /// This documents the bug we fixed - if handshake passes Some([]) instead of None, roots get wiped
    #[test]
    #[serial]
    fn test_some_empty_wipes_roots_regression() {
        let temp_dir = TempDir::new().unwrap();
        std::env::set_var("JSTORRENT_CONFIG_DIR", temp_dir.path());

        let app_dir = temp_dir.path().join("jstorrent-native");
        std::fs::create_dir_all(&app_dir).unwrap();

        let install_id = "test-install-regression";
        let test_root = make_test_root("root-key-1", "/home/user/Downloads");

        // Step 1: Create entry with roots
        let info1 = make_rpc_info(1000, Some(install_id), Some(vec![test_root]));
        let roots1 = write_discovery_file(info1).unwrap();
        assert_eq!(roots1.len(), 1);

        // Step 2: Startup with new PID, None
        let info2 = make_rpc_info(2000, None, None);
        let _roots2 = write_discovery_file(info2).unwrap();

        // Step 3: If handshake passes Some([]) instead of None, roots get WIPED
        // This is the BUG behavior - main.rs now sets download_roots = None before handshake
        let info3 = make_rpc_info(2000, Some(install_id), Some(vec![])); // BUG: Some([]) wipes roots
        let roots3 = write_discovery_file(info3).unwrap();
        assert_eq!(roots3.len(), 0, "Some([]) wipes roots - main.rs must pass None to preserve");

        std::env::remove_var("JSTORRENT_CONFIG_DIR");
    }

    /// Test: Removing a root actually removes it
    /// Simulates:
    /// 1. Start with a root
    /// 2. Remove the root by passing Some(empty vec)
    /// 3. Verify it's actually gone
    #[test]
    #[serial]
    fn test_removing_root_actually_removes_it() {
        let temp_dir = TempDir::new().unwrap();
        std::env::set_var("JSTORRENT_CONFIG_DIR", temp_dir.path());

        let app_dir = temp_dir.path().join("jstorrent-native");
        std::fs::create_dir_all(&app_dir).unwrap();

        let install_id = "test-install-456";
        let test_root = make_test_root("root-to-remove", "/home/user/Videos");

        // Step 1: Create entry with a root
        let info1 = make_rpc_info(1000, Some(install_id), Some(vec![test_root]));
        let roots1 = write_discovery_file(info1).unwrap();
        assert_eq!(roots1.len(), 1);

        // Step 2: Remove the root by passing Some(empty vec)
        let info2 = make_rpc_info(1000, Some(install_id), Some(vec![])); // Some([]) = explicitly empty
        let roots2 = write_discovery_file(info2).unwrap();
        assert_eq!(roots2.len(), 0, "Root should be removed");

        // Step 3: Verify it's actually gone by reading with None (preserve mode)
        let info3 = make_rpc_info(1000, Some(install_id), None);
        let roots3 = write_discovery_file(info3).unwrap();
        assert_eq!(roots3.len(), 0, "Root should still be gone after preserve-mode read");

        std::env::remove_var("JSTORRENT_CONFIG_DIR");
    }

    /// Test: Adding a root works
    #[test]
    #[serial]
    fn test_adding_root() {
        let temp_dir = TempDir::new().unwrap();
        std::env::set_var("JSTORRENT_CONFIG_DIR", temp_dir.path());

        let app_dir = temp_dir.path().join("jstorrent-native");
        std::fs::create_dir_all(&app_dir).unwrap();

        let install_id = "test-install-789";

        // Step 1: Start with no roots
        let info1 = make_rpc_info(1000, Some(install_id), Some(vec![]));
        let roots1 = write_discovery_file(info1).unwrap();
        assert_eq!(roots1.len(), 0);

        // Step 2: Add a root
        let new_root = make_test_root("new-root", "/home/user/Music");
        let info2 = make_rpc_info(1000, Some(install_id), Some(vec![new_root.clone()]));
        let roots2 = write_discovery_file(info2).unwrap();
        assert_eq!(roots2.len(), 1);
        assert_eq!(roots2[0].key, "new-root");

        // Step 3: Verify it persists with None
        let info3 = make_rpc_info(1000, Some(install_id), None);
        let roots3 = write_discovery_file(info3).unwrap();
        assert_eq!(roots3.len(), 1, "Added root should persist");

        std::env::remove_var("JSTORRENT_CONFIG_DIR");
    }
}
