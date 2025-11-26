use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    Json,
    routing::post,
    Router,
};
use jstorrent_common::{UnifiedRpcInfo, DownloadRoot, get_config_dir};
use std::sync::Arc;
use std::fs;
use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/read-rpc-info-from-disk", post(refresh_handler))
}

pub fn load_config(install_id: &str) -> Result<Vec<DownloadRoot>> {
    let config_dir = get_config_dir().context("Could not find config directory")?;
    let rpc_file = config_dir.join("jstorrent-native").join("rpc-info.json");

    if !rpc_file.exists() {
        // If file doesn't exist, return empty list (or error? Design says native-host creates it)
        // native-host should have created it before launching us.
        return Err(anyhow::anyhow!("rpc-info.json not found at {:?}", rpc_file));
    }

    let file = fs::File::open(&rpc_file).context("Failed to open rpc-info.json")?;
    let info: UnifiedRpcInfo = serde_json::from_reader(file).context("Failed to parse rpc-info.json")?;

    let profile = info.profiles.iter().find(|p| p.install_id.as_deref() == Some(install_id));

    match profile {
        Some(p) => Ok(p.download_roots.clone()),
        None => {
            // If install_id not found, maybe return empty or error.
            // Design says: "Logs a warning, Returns a 404-like failure code"
            Err(anyhow::anyhow!("Profile with install_id {} not found", install_id))
        }
    }
}

async fn refresh_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    tracing::info!("Received refresh request");

    // We need to reload config and update state.
    // Since AppState is Arc, we need interior mutability for the roots if we want to update them in place.
    // However, AppState currently has `root: PathBuf` which seems to be a single root.
    // The design says "Supports multiple independent download roots; each request specifies which root to operate on."
    // So we should probably store the list of allowed roots in AppState.
    
    // For now, let's assume we update the list of roots.
    // But wait, AppState definition in main.rs needs to change to hold Vec<DownloadRoot> or similar.
    // And it needs a Mutex/RwLock to be updatable.

    // Let's reload and print for now, and we'll fix AppState in main.rs next.
    let roots = match load_config(&state.install_id) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to reload config: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    {
        let mut roots_guard = state.download_roots.write().unwrap();
        *roots_guard = roots;
    }

    tracing::info!("Config reloaded successfully");
    Ok(Json(serde_json::json!({})))
}
