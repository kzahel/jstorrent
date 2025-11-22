use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Result};
use rfd::AsyncFileDialog;

pub async fn pick_download_directory(state: &State) -> Result<ResponsePayload> {
    let task = AsyncFileDialog::new()
        .set_title("Select Download Directory")
        .pick_folder();

    // rfd's pick_folder is async but might block the thread if not careful on some backends?
    // On Linux/GTK it should be fine.
    
    let handle = task.await;

    match handle {
        Some(path_handle) => {
            let path = path_handle.path().to_path_buf();
            // Canonicalize to ensure we have a clean absolute path
            let canonical = path.canonicalize().unwrap_or(path);
            let path_str = canonical.to_string_lossy().to_string();
            
            // Update state
            *state.download_root.lock().unwrap() = canonical;
            
            Ok(ResponsePayload::Path { path: path_str })
        }
        None => Err(anyhow!("User cancelled folder selection")),
    }
}
