use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use std::io::SeekFrom;
use crate::AppState;

// 64MB limit for piece writes (must match MAX_PIECE_SIZE in engine)
pub const MAX_BODY_SIZE: usize = 64 * 1024 * 1024;

#[allow(deprecated)]
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // New header-based endpoints (preferred) - use base64-encoded path in headers
        .route("/write/:root_key", post(write_file_v2))
        .route("/read/:root_key", get(read_file_v2))
        // DEPRECATED: Legacy path-based endpoints - path in URL breaks on # and ? characters
        // These are no longer used by the TypeScript engine as of 2024-12
        .route("/files/*path", get(read_file_deprecated).post(write_file_deprecated))
        .route("/files/ensure_dir", post(ensure_dir))
        .route("/ops/stat", get(stat_file))
        .route("/ops/list", get(list_dir))
        .route("/ops/delete", post(delete_file))
        .route("/ops/truncate", post(truncate_file))
        .layer(DefaultBodyLimit::max(MAX_BODY_SIZE))
}

// ============================================================================
// DEPRECATED: Legacy path-based endpoints
// These use the file path in the URL which breaks on # and ? characters.
// Use /read/:root_key and /write/:root_key with X-Path-Base64 header instead.
// ============================================================================

#[derive(Deserialize)]
struct ReadParams {
    offset: Option<u64>,
    length: Option<u64>,
    root_key: String,
}

#[deprecated(since = "0.1.0", note = "Use read_file_v2 with X-Path-Base64 header instead")]
async fn read_file_deprecated(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<ReadParams>,
) -> Result<Vec<u8>, (StatusCode, String)> {
    tracing::warn!("DEPRECATED: /files/* endpoint called for read. Use /read/:root_key with X-Path-Base64 header instead.");

    let full_path = validate_path(&state, &params.root_key, &path)?;

    let mut file = File::open(&full_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(offset) = params.offset {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut buffer = Vec::new();
    if let Some(len) = params.length {
        buffer.resize(len as usize, 0);
        file.read_exact(&mut buffer).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        file.read_to_end(&mut buffer).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(buffer)
}

#[derive(Deserialize)]
struct WriteParams {
    offset: Option<u64>,
    root_key: String,
}

#[deprecated(since = "0.1.0", note = "Use write_file_v2 with X-Path-Base64 header instead")]
async fn write_file_deprecated(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<WriteParams>,
    body: axum::body::Bytes,
) -> Result<(), (StatusCode, String)> {
    tracing::warn!("DEPRECATED: /files/* endpoint called for write. Use /write/:root_key with X-Path-Base64 header instead.");

    let full_path = validate_path(&state, &params.root_key, &path)?;

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

// ============================================================================
// Current API: Header-based endpoints
// ============================================================================

/// Helper to extract path from X-Path-Base64 header
fn extract_path_from_header(headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let path_b64 = headers
        .get("X-Path-Base64")
        .ok_or((StatusCode::BAD_REQUEST, "Missing X-Path-Base64 header".into()))?
        .to_str()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid X-Path-Base64 header".into()))?;

    let path_bytes = BASE64
        .decode(path_b64)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid base64 in X-Path-Base64".into()))?;

    String::from_utf8(path_bytes)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid UTF-8 in path".into()))
}

/// Helper to extract optional u64 from header
fn extract_u64_header(headers: &HeaderMap, name: &str) -> Result<Option<u64>, (StatusCode, String)> {
    match headers.get(name) {
        Some(value) => {
            let s = value
                .to_str()
                .map_err(|_| (StatusCode::BAD_REQUEST, format!("Invalid {} header", name)))?;
            let n = s
                .parse()
                .map_err(|_| (StatusCode::BAD_REQUEST, format!("Invalid {} value", name)))?;
            Ok(Some(n))
        }
        None => Ok(None),
    }
}

/// New write endpoint with base64 path in header and optional hash verification.
/// POST /write/{root_key}
/// Headers:
///   X-Path-Base64: <base64 encoded path>
///   X-Offset: <optional offset>
///   X-Expected-SHA1: <optional hex SHA1 hash for verification>
/// Body: raw bytes
/// Returns: 200 OK, 409 Conflict (hash mismatch), 507 Insufficient (disk full)
async fn write_file_v2(
    State(state): State<Arc<AppState>>,
    Path(root_key): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<(), (StatusCode, String)> {
    let path = extract_path_from_header(&headers)?;
    let offset = extract_u64_header(&headers, "X-Offset")?.unwrap_or(0);

    let full_path = validate_path(&state, &root_key, &path)?;

    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::StorageFull {
                (StatusCode::INSUFFICIENT_STORAGE, e.to_string())
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
        })?;
    }

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .open(&full_path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if offset > 0 {
        file.seek(SeekFrom::Start(offset)).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    file.write_all(&body).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::StorageFull {
            (StatusCode::INSUFFICIENT_STORAGE, e.to_string())
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    })?;

    // Optional hash verification
    if let Some(expected_hex) = headers.get("X-Expected-SHA1") {
        let expected_hex = expected_hex
            .to_str()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid X-Expected-SHA1 header".into()))?;

        let mut hasher = Sha1::new();
        hasher.update(&body);
        let actual = hex::encode(hasher.finalize());

        if actual != expected_hex {
            return Err((
                StatusCode::CONFLICT,
                format!("Hash mismatch: expected {}, got {}", expected_hex, actual),
            ));
        }
    }

    Ok(())
}

/// New read endpoint with base64 path in header.
/// GET /read/{root_key}
/// Headers:
///   X-Path-Base64: <base64 encoded path>
///   X-Offset: <optional offset>
///   X-Length: <optional length>
/// Returns: raw bytes
async fn read_file_v2(
    State(state): State<Arc<AppState>>,
    Path(root_key): Path<String>,
    headers: HeaderMap,
) -> Result<Vec<u8>, (StatusCode, String)> {
    let path = extract_path_from_header(&headers)?;
    let offset = extract_u64_header(&headers, "X-Offset")?;
    let length = extract_u64_header(&headers, "X-Length")?;

    let full_path = validate_path(&state, &root_key, &path)?;

    let mut file = File::open(&full_path)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(off) = offset {
        file.seek(SeekFrom::Start(off))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let mut buffer = Vec::new();
    if let Some(len) = length {
        buffer.resize(len as usize, 0);
        file.read_exact(&mut buffer)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        file.read_to_end(&mut buffer)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(buffer)
}

#[derive(Deserialize)]
struct EnsureDirParams {
    path: String,
    root_key: String,
}


async fn ensure_dir(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EnsureDirParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_key, &payload.path)?;

    fs::create_dir_all(full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(())
}

#[derive(Deserialize)]
struct StatParams {
    path: String,
    root_key: String,
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
    let full_path = validate_path(&state, &params.root_key, &params.path)?;

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
    root_key: String,
}

async fn list_dir(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<ListParams>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let full_path = validate_path(&state, &params.root_key, &params.path)?;

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
    root_key: String,
}

async fn delete_file(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_key, &payload.path)?;

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
    root_key: String,
    length: u64,
}

async fn truncate_file(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TruncateParams>,
) -> Result<(), (StatusCode, String)> {
    let full_path = validate_path(&state, &payload.root_key, &payload.path)?;

    let file = fs::OpenOptions::new()
        .write(true)
        .open(&full_path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    file.set_len(payload.length).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(())
}

pub fn validate_path(state: &AppState, root_key: &str, path: &str) -> Result<PathBuf, (StatusCode, String)> {
    // Find root by key
    let roots = state.download_roots.read().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Lock poisoned".to_string()))?;
    let root = roots.iter().find(|r| r.key == root_key)
        .ok_or_else(|| (StatusCode::FORBIDDEN, "Invalid root key".to_string()))?;
    
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

