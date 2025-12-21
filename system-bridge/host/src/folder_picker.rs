use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Result};
#[cfg(not(target_os = "macos"))]
use rfd::AsyncFileDialog;
use jstorrent_common::DownloadRoot;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use sha2::{Sha256, Digest};

/// Determine the best starting directory for the folder picker.
/// Falls back through: most recent download root -> system downloads -> home directory
fn get_starting_directory(state: &State) -> Option<PathBuf> {
    // 1. Try most recently used download root (by last_checked timestamp)
    if let Ok(info_guard) = state.rpc_info.lock() {
        if let Some(ref info) = *info_guard {
            if let Some(ref roots) = info.download_roots {
                if let Some(best) = roots.iter()
                    .filter(|r| r.last_stat_ok)
                    .max_by_key(|r| r.last_checked)
                {
                    let path = PathBuf::from(&best.path);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
    }

    // 2. Fall back to home directory (avoids TCC permission prompt on macOS)
    // Using Downloads would trigger "would like to access files in your Downloads folder"
    dirs::home_dir()
}

/// macOS: Use osascript to show folder picker (works without NSApplication)
#[cfg(target_os = "macos")]
async fn pick_folder_platform(start_dir: Option<PathBuf>) -> Option<PathBuf> {
    let start_path = start_dir
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "~".to_string());

    let script = format!(
        r#"set defaultFolder to POSIX file "{}"
try
    set chosenFolder to choose folder with prompt "Select Download Directory" default location defaultFolder
    return POSIX path of chosenFolder
on error
    return ""
end try"#,
        start_path
    );

    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
    })
    .await
    .ok()?
    .ok()?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            return Some(PathBuf::from(path_str));
        }
    }
    None
}

/// Non-macOS: Use rfd
#[cfg(not(target_os = "macos"))]
async fn pick_folder_platform(start_dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut dialog = AsyncFileDialog::new()
        .set_title("Select Download Directory");

    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(&dir);
    }

    #[cfg(target_os = "windows")]
    crate::win_foreground::prepare_for_foreground();

    let result = dialog.pick_folder().await.map(|h| h.path().to_path_buf());

    #[cfg(target_os = "windows")]
    crate::win_foreground::dismiss_menu();

    result
}

pub async fn pick_download_directory(state: &State) -> Result<ResponsePayload> {
    let start_dir = get_starting_directory(state);
    let path_opt = pick_folder_platform(start_dir).await;

    match path_opt {
        Some(path) => {
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
