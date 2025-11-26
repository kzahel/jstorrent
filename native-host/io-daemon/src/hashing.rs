use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Router,
};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/hash/sha1/*path", get(hash_sha1))
        .route("/hash/sha256/*path", get(hash_sha256))
}

#[derive(Deserialize)]
struct HashParams {
    offset: Option<u64>,
    length: Option<u64>,
    root_token: String,
}


async fn hash_sha1(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashParams>,
) -> Result<String, (StatusCode, String)> {
    let full_path = crate::files::validate_path(&state, &params.root_token, &path)?;

    
    let mut file = File::open(&full_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(offset) = params.offset {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 8192];
    let mut remaining = params.length.unwrap_or(u64::MAX);

    while remaining > 0 {
        let to_read = std::cmp::min(buffer.len() as u64, remaining);
        let n = file.read(&mut buffer[..to_read as usize]).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
        if n == 0 {
            break;
        }

        hasher.update(&buffer[..n]);
        remaining -= n as u64;
    }

    Ok(hex::encode(hasher.finalize()))
}

async fn hash_sha256(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashParams>,
) -> Result<String, (StatusCode, String)> {
    let full_path = crate::files::validate_path(&state, &params.root_token, &path)?;

    
    let mut file = File::open(&full_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(offset) = params.offset {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    let mut remaining = params.length.unwrap_or(u64::MAX);

    while remaining > 0 {
        let to_read = std::cmp::min(buffer.len() as u64, remaining);
        let n = file.read(&mut buffer[..to_read as usize]).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
        if n == 0 {
            break;
        }

        hasher.update(&buffer[..n]);
        remaining -= n as u64;
    }

    Ok(hex::encode(hasher.finalize()))
}
