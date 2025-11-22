use crate::path_safety::validate_path;
use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use std::path::PathBuf;
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};

pub async fn set_download_root(state: &State, path: String) -> Result<ResponsePayload> {
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(anyhow!("Download root does not exist"));
    }
    let canonical = path_buf
        .canonicalize()
        .context("Failed to canonicalize download root")?;
    
    *state.download_root.lock().unwrap() = canonical;
    Ok(ResponsePayload::Empty)
}

pub async fn ensure_dir(state: &State, path: String) -> Result<ResponsePayload> {
    let root_guard = state.download_root.lock().unwrap();
    let root = &*root_guard;
    
    let safe_path = validate_path(&path, root)?;
    
    fs::create_dir_all(&safe_path)
        .await
        .context("Failed to create directory")?;

    Ok(ResponsePayload::Empty)
}

pub async fn read_file(
    state: &State,
    path: String,
    offset: u64,
    length: usize,
) -> Result<ResponsePayload> {
    let root_guard = state.download_root.lock().unwrap();
    let root = &*root_guard;
    
    let safe_path = validate_path(&path, root)?;
    
    let mut file = File::open(&safe_path).await.context("Failed to open file")?;
    
    file.seek(SeekFrom::Start(offset))
        .await
        .context("Failed to seek file")?;
    
    let mut buf = vec![0u8; length];
    let n = file.read(&mut buf).await.context("Failed to read file")?;
    
    // Resize buffer to actual read amount
    buf.truncate(n);
    
    let data = general_purpose::STANDARD.encode(&buf);
    
    Ok(ResponsePayload::Data { data })
}

pub async fn write_file(
    state: &State,
    path: String,
    offset: u64,
    data_b64: String,
) -> Result<ResponsePayload> {
    let root_guard = state.download_root.lock().unwrap();
    let root = &*root_guard;
    
    let safe_path = validate_path(&path, root)?;
    
    let data = general_purpose::STANDARD
        .decode(data_b64)
        .context("Invalid base64 data")?;
    
    // Open for writing, create if not exists.
    // We don't truncate because we might be writing a chunk.
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(&safe_path)
        .await
        .context("Failed to open file for writing")?;
    
    file.seek(SeekFrom::Start(offset))
        .await
        .context("Failed to seek file")?;
    
    file.write_all(&data)
        .await
        .context("Failed to write to file")?;
    
    Ok(ResponsePayload::Empty)
}

pub async fn stat_file(state: &State, path: String) -> Result<ResponsePayload> {
    let root_guard = state.download_root.lock().unwrap();
    let root = &*root_guard;
    
    let safe_path = validate_path(&path, root)?;
    
    let metadata = fs::metadata(&safe_path)
        .await
        .context("Failed to get file metadata")?;
    
    let mtime = metadata
        .modified()
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    
    Ok(ResponsePayload::Stat {
        size: metadata.len(),
        mtime,
        is_dir: metadata.is_dir(),
    })
}
