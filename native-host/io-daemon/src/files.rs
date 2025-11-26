use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio::io::{AsyncReadExt, AsyncWriteExt, AsyncSeekExt};
use std::io::SeekFrom;
use crate::AppState;
use jstorrent_common::DownloadRoot;


pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/files/*path", get(read_file).post(write_file))
        .route("/files/ensure_dir", post(ensure_dir))
}

#[derive(Deserialize)]
struct ReadParams {
    offset: Option<u64>,
    length: Option<u64>,
    root_token: String,
}


async fn read_file(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<ReadParams>,
) -> Result<Vec<u8>, (StatusCode, String)> {
    let full_path = validate_path(&state, &params.root_token, &path)?;


    let mut file = File::open(&full_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(offset) = params.offset {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut buffer = Vec::new();
    if let Some(len) = params.length {
        buffer.resize(len as usize, 0);
        let n = file.read(&mut buffer).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        buffer.truncate(n);
    } else {
        file.read_to_end(&mut buffer).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(buffer)
}

#[derive(Deserialize)]
struct WriteParams {
    offset: Option<u64>,
    root_token: String,
}


async fn write_file(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<WriteParams>,
    body: axum::body::Bytes,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &params.root_token, &path)?;


    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .open(&full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(offset) = params.offset {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    file.write_all(&body).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

#[derive(Deserialize)]
struct EnsureDirParams {
    path: String,
    root_token: String,
}


async fn ensure_dir(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EnsureDirParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_token, &payload.path)?;

    fs::create_dir_all(full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(())
}

pub fn validate_path(state: &AppState, root_token: &str, path: &str) -> Result<PathBuf, (StatusCode, String)> {
    // Find root by token
    let roots = state.download_roots.read().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Lock poisoned".to_string()))?;
    let root = roots.iter().find(|r| r.token == root_token)
        .ok_or_else(|| (StatusCode::FORBIDDEN, "Invalid root token".to_string()))?;
    
    let root_path = PathBuf::from(&root.path);

    // Prevent directory traversal
    if path.contains("..") {
        return Err((StatusCode::BAD_REQUEST, "Invalid path".to_string()));
    }
    
    // Sanitize path separators
    let clean_path = path.replace('\\', "/");
    let clean_path = clean_path.trim_start_matches('/');

    Ok(root_path.join(clean_path))
}

