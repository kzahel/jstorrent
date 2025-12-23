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

/// Profile configuration loaded from rpc-info.json
pub struct ProfileConfig {
    pub download_roots: Vec<DownloadRoot>,
    pub extension_id: Option<String>,
}

pub fn load_config(install_id: &str) -> Result<ProfileConfig> {
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
        Some(p) => Ok(ProfileConfig {
            download_roots: p.download_roots.clone(),
            extension_id: p.extension_id.clone(),
        }),
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

    let config = match load_config(&state.install_id) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to reload config: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    {
        let mut roots_guard = state.download_roots.write().unwrap();
        *roots_guard = config.download_roots;
    }

    {
        let mut ext_guard = state.extension_id.write().unwrap();
        *ext_guard = config.extension_id;
    }

    tracing::info!("Config reloaded successfully");
    Ok(Json(serde_json::json!({})))
}
