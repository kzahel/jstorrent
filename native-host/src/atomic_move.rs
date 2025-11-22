use crate::path_safety::validate_path;
use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Context, Result};
use tokio::fs;

pub async fn atomic_move(
    state: &State,
    from: String,
    to: String,
    overwrite: Option<bool>,
) -> Result<ResponsePayload> {
    let root_guard = state.download_root.lock().unwrap();
    let root = &*root_guard;

    let safe_from = validate_path(&from, root)?;
    let safe_to = validate_path(&to, root)?;

    if !safe_from.exists() {
        return Err(anyhow!("Source file does not exist"));
    }

    if safe_to.exists() {
        if !overwrite.unwrap_or(false) {
            return Err(anyhow!("Destination file exists"));
        }
    }

    // Attempt rename
    match fs::rename(&safe_from, &safe_to).await {
        Ok(_) => Ok(ResponsePayload::Empty),
        Err(e) => {
            // Check for cross-device error (EXDEV)
            // In Rust std, this is usually ErrorKind::CrossesDevices or OS error 18
            if let Some(os_error) = e.raw_os_error() {
                // EXDEV is 18 on Linux/Mac
                if os_error == 18 {
                    return Err(anyhow!("Cross-device link not permitted"));
                }
            }
            Err(anyhow!("Failed to rename file: {}", e))
        }
    }
}
