use axum::{
    extract::{DefaultBodyLimit, Path, State},
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

// 64MB limit for piece writes (must match MAX_PIECE_SIZE in engine)
pub const MAX_BODY_SIZE: usize = 64 * 1024 * 1024;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/files/*path", get(read_file).post(write_file))
        .route("/files/ensure_dir", post(ensure_dir))
        .route("/ops/stat", get(stat_file))
        .route("/ops/list", get(list_dir))
        .route("/ops/delete", post(delete_file))
        .route("/ops/truncate", post(truncate_file))
        .layer(DefaultBodyLimit::max(MAX_BODY_SIZE))
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

#[derive(Deserialize)]
struct StatParams {
    path: String,
    root_token: String,
}

#[derive(Serialize)]
struct FileStat {
    size: u64,
    mtime: u64, // milliseconds since epoch
    is_directory: bool,
    is_file: bool,
}

async fn stat_file(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<StatParams>,
) -> Result<Json<FileStat>, (StatusCode, String)> {
    let full_path = validate_path(&state, &params.root_token, &params.path)?;

    let metadata = fs::metadata(&full_path).await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                (StatusCode::NOT_FOUND, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;

    let mtime = metadata.modified()
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(Json(FileStat {
        size: metadata.len(),
        mtime,
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
    }))
}

#[derive(Deserialize)]
struct ListParams {
    path: String,
    root_token: String,
}

async fn list_dir(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<ListParams>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let full_path = validate_path(&state, &params.root_token, &params.path)?;

    let mut entries = fs::read_dir(&full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut filenames = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(name) = entry.file_name().into_string() {
            filenames.push(name);
        }
    }

    Ok(Json(filenames))
}

#[derive(Deserialize)]
struct DeleteParams {
    path: String,
    root_token: String,
}

async fn delete_file(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_token, &payload.path)?;

    if full_path.is_dir() {
        fs::remove_dir_all(full_path).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        fs::remove_file(full_path).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(())
}

#[derive(Deserialize)]
struct TruncateParams {
    path: String,
    root_token: String,
    length: u64,
}

async fn truncate_file(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TruncateParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_token, &payload.path)?;

    let file = fs::OpenOptions::new()
        .write(true)
        .open(&full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    file.set_len(payload.length).await
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

