use crate::path_safety::validate_path;
use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use sha1::{Digest, Sha1};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};

pub async fn hash_sha1(data_b64: String) -> Result<ResponsePayload> {
    let data = general_purpose::STANDARD
        .decode(data_b64)
        .context("Invalid base64 data")?;
    
    let mut hasher = Sha1::new();
    hasher.update(&data);
    let result = hasher.finalize();
    
    Ok(ResponsePayload::Hash {
        hash: hex::encode(result),
    })
}

pub async fn hash_file(
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
    
    let mut buf = vec![0u8; 64 * 1024]; // 64KB buffer
    let mut hasher = Sha1::new();
    let mut remaining = length;
    
    while remaining > 0 {
        let to_read = std::cmp::min(remaining, buf.len());
        let n = file
            .read(&mut buf[..to_read])
            .await
            .context("Failed to read file")?;
        
        if n == 0 {
            break; // EOF
        }
        
        hasher.update(&buf[..n]);
        remaining -= n;
    }
    
    let result = hasher.finalize();
    
    Ok(ResponsePayload::Hash {
        hash: hex::encode(result),
    })
}
