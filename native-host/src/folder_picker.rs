use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Result};
use rfd::AsyncFileDialog;
use jstorrent_common::DownloadRoot;
use std::time::{SystemTime, UNIX_EPOCH};
use sha2::{Sha256, Digest};

pub async fn pick_download_directory(state: &State) -> Result<ResponsePayload> {
    let task = AsyncFileDialog::new()
        .set_title("Select Download Directory")
        .pick_folder();

    let handle = task.await;

    match handle {
        Some(path_handle) => {
            let path = path_handle.path().to_path_buf();
            let canonical = path.canonicalize().unwrap_or(path.clone());
            let path_str = canonical.to_string_lossy().to_string();
            
            // Generate display name from folder name
            let display_name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());

            // Generate stable key: sha256(path)
            let mut hasher = Sha256::new();
            hasher.update(path_str.as_bytes());
            let hash = hasher.finalize();
            // Use first 16 hex chars (64 bits) for consistency with Android
            let key = hex::encode(&hash[..8]);

            // Create new root with unique key
            let new_root = DownloadRoot {
                key,
                path: path_str.clone(),
                display_name,
                removable: false,
                last_stat_ok: true,
                last_checked: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            };

            // Add to rpc_info.download_roots
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(ref mut info) = *info_guard {
                    // Ensure roots vec exists
                    let roots = info.download_roots.get_or_insert_with(Vec::new);
                    // Check if path already exists
                    let exists = roots.iter().any(|r| r.path == path_str);
                    if !exists {
                        roots.push(new_root.clone());
                    }
                    // Note: if exists, return the new_root which has the same key/path
                }
            }

            // Note: The caller (main.rs) calls daemon_manager.refresh_config() 
            // which should persist changes. If not, we need to save rpc_info here.

            Ok(ResponsePayload::RootAdded { root: new_root })
        }
        None => Err(anyhow!("User cancelled folder selection")),
    }
}
