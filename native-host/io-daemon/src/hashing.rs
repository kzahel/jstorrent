use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use crate::files::MAX_BODY_SIZE;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // File-based hash endpoints (return hex)
        .route("/hash/sha1/*path", get(hash_sha1_file))
        .route("/hash/sha256/*path", get(hash_sha256_file))
        // Bytes-based hash endpoints (return raw bytes)
        .route("/hash/sha1", post(hash_sha1_bytes))
        .route("/hash/sha256", post(hash_sha256_bytes))
        .layer(DefaultBodyLimit::max(MAX_BODY_SIZE))
}

#[derive(Deserialize)]
struct HashParams {
    offset: Option<u64>,
    length: Option<u64>,
    root_token: String,
}


/// Hash arbitrary bytes with SHA1.
/// POST /hash/sha1
/// Body: raw bytes
/// Response: raw 20-byte hash (application/octet-stream)
async fn hash_sha1_bytes(body: Bytes) -> impl IntoResponse {
    let mut hasher = Sha1::new();
    hasher.update(&body);
    let hash = hasher.finalize();
    ([(header::CONTENT_TYPE, "application/octet-stream")], hash.to_vec())
}

/// Hash arbitrary bytes with SHA256.
/// POST /hash/sha256
/// Body: raw bytes
/// Response: raw 32-byte hash (application/octet-stream)
async fn hash_sha256_bytes(body: Bytes) -> impl IntoResponse {
    let mut hasher = Sha256::new();
    hasher.update(&body);
    let hash = hasher.finalize();
    ([(header::CONTENT_TYPE, "application/octet-stream")], hash.to_vec())
}

/// Hash a file with SHA1. Returns hex string.
async fn hash_sha1_file(
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

/// Hash a file with SHA256. Returns hex string.
async fn hash_sha256_file(
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
