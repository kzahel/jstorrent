# Large Torrent File Size Check

## Overview

Chrome's native messaging protocol limits messages from native-host → extension to 1MB. Large .torrent files (>750KB) exceed this after base64 encoding. Add a size check with a helpful error message directing users to drag-and-drop as a workaround.

## Background

- Native messaging limit: 1MB (1,048,576 bytes) for host → extension messages
- Base64 overhead: ~33%, so ~750KB original file → ~1MB encoded
- Most .torrent files are small (few KB), but large ones with many files can exceed this
- Drag-and-drop into extension UI bypasses native messaging entirely (FileReader API)

## Changes

### 1. native-host/src/rpc.rs

Add size check in `add_torrent_handler`, before sending the event.

Find this (around line 124):

```rust
async fn add_torrent_handler(
    State((state, server_token)): State<(Arc<AppState>, String)>,
    Query(query): Query<TokenQuery>,
    Json(payload): Json<AddTorrentRequest>,
) -> Result<Json<StatusResponse>, StatusCode> {
    if query.token != server_token {
        crate::log!("Refused add-torrent request: Invalid token");
        return Err(StatusCode::FORBIDDEN);
    }

    crate::log!("Received add-torrent request: {} ({} bytes)", payload.file_name, payload.contents_base64.len());
```

Replace with:

```rust
async fn add_torrent_handler(
    State((state, server_token)): State<(Arc<AppState>, String)>,
    Query(query): Query<TokenQuery>,
    Json(payload): Json<AddTorrentRequest>,
) -> Result<Json<StatusResponse>, StatusCode> {
    if query.token != server_token {
        crate::log!("Refused add-torrent request: Invalid token");
        return Err(StatusCode::FORBIDDEN);
    }

    // Chrome native messaging limits messages to 1MB. Base64 adds ~33% overhead,
    // plus JSON wrapper. Reject files that would exceed this limit.
    const MAX_BASE64_SIZE: usize = 900_000; // ~675KB original, conservative margin
    if payload.contents_base64.len() > MAX_BASE64_SIZE {
        crate::log!(
            "Torrent file too large: {} bytes base64 (limit: {})",
            payload.contents_base64.len(),
            MAX_BASE64_SIZE
        );
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    crate::log!("Received add-torrent request: {} ({} bytes)", payload.file_name, payload.contents_base64.len());
```

### 2. native-host/src/bin/link-handler.rs

Update `send_payload` to detect 413 and show a helpful message.

Find this (around line 300):

```rust
fn send_payload(info: &ProfileEntry, mode: &Mode) -> Result<()> {
    let client = Client::new();
    let base_url = format!("http://127.0.0.1:{}", info.port);

    let (url, body) = match mode {
        Mode::Magnet(magnet) => (
            format!("{}/add-magnet?token={}", base_url, info.token),
            serde_json::json!({ "magnet": magnet }),
        ),
        Mode::Torrent { file_name, contents_base64 } => (
            format!("{}/add-torrent?token={}", base_url, info.token),
            serde_json::json!({ "file_name": file_name, "contents_base64": contents_base64 }),
        ),
    };

    log!("DEBUG: Posting to URL: {}", url);
    let resp = client.post(&url).json(&body).send()?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Failed to add request: {}", resp.status()))
    }
}
```

Replace with:

```rust
fn send_payload(info: &ProfileEntry, mode: &Mode) -> Result<()> {
    let client = Client::new();
    let base_url = format!("http://127.0.0.1:{}", info.port);

    let (url, body) = match mode {
        Mode::Magnet(magnet) => (
            format!("{}/add-magnet?token={}", base_url, info.token),
            serde_json::json!({ "magnet": magnet }),
        ),
        Mode::Torrent { file_name, contents_base64 } => (
            format!("{}/add-torrent?token={}", base_url, info.token),
            serde_json::json!({ "file_name": file_name, "contents_base64": contents_base64 }),
        ),
    };

    log!("DEBUG: Posting to URL: {}", url);
    let resp = client.post(&url).json(&body).send()?;

    if resp.status().is_success() {
        Ok(())
    } else if resp.status() == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
        Err(anyhow::anyhow!(
            "This torrent file is too large to open via file association.\n\n\
             Please drag and drop it directly into JSTorrent instead."
        ))
    } else {
        Err(anyhow::anyhow!("Failed to add request: {}", resp.status()))
    }
}
```

## Verification

```bash
cd native-host
cargo build --workspace
cargo test --workspace
```

Manual test (if you have a large .torrent file):
1. Find or create a .torrent file > 750KB
2. Double-click it (or run `./target/debug/jstorrent-link-handler /path/to/large.torrent`)
3. Should see error dialog with helpful message about drag-and-drop

## Future Consideration

If users hit this frequently, implement inbox-based passing:
- native-host writes large torrents to `~/.config/jstorrent-native/inbox/`
- Extension fetches via io-daemon HTTP endpoint (no 1MB limit)
- See chat history for design discussion
