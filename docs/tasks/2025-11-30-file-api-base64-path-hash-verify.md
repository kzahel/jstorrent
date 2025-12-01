# Design: io-daemon File API with Base64 Path and Hash Verification

## Problems

1. **Path encoding edge cases**: Current code uses `new URL(path, baseUrl)` which encodes most characters (spaces, unicode) but has edge cases:
   ```typescript
   `/files/${this.path}`  // passed to new URL()
   
   // Works: spaces, unicode
   new URL('/files/hello world.txt', base)  // → /files/hello%20world.txt ✓
   
   // Breaks: # and ? get interpreted as URL fragments/query
   new URL('/files/file#1.txt', base)   // → /files/file  (truncated!)
   new URL('/files/file?v2.txt', base)  // → /files/file?v2.txt (query string!)
   ```

2. **Hash verification**: Need atomic write+verify for piece finalization to avoid race between write and hash check.

3. **crypto.subtle unavailable**: HTTP origins can't use crypto.subtle, so hash verification must happen in io-daemon.

## Solution

Move path to header (base64 encoded), add optional hash verification header.

## API Design

### Write with optional hash verification

```
POST /write/{root_token}
X-Path-Base64: cGF0aC90by9maWxlLnR4dA==
X-Offset: 0
X-Expected-SHA1: a94a8fe5ccb19ba61c4c0873d391e987982fbbd3  (optional, raw hex)
Content-Type: application/octet-stream
Body: <raw binary data>

Response:
200 OK              - written successfully (hash matched if provided)
409 Conflict        - hash mismatch (body: expected vs actual)
507 Insufficient    - disk full
403 Forbidden       - invalid root token
```

### Read

```
GET /read/{root_token}
X-Path-Base64: cGF0aC90by9maWxlLnR4dA==
X-Offset: 0
X-Length: 16384

Response:
200 OK + body       - raw bytes
404 Not Found       - file doesn't exist
```

## Why Base64 in Header?

| Approach | Pros | Cons |
|----------|------|------|
| new URL() (current) | Works for most cases | Silent corruption on `#` and `?` in filenames |
| Manual URL encoding | Handles all chars | Verbose, easy to forget |
| **Base64 in header** | Handles any bytes, clean URLs | Extra header |
| JSON body | Flexible | Parse overhead, less standard |

Base64 header is most robust. Filenames with `#` or `?` are rare but possible (especially from untrusted torrent metadata). Only used for HTTP transport - rest of codebase keeps string paths.

## Implementation

### io-daemon (Rust)

```rust
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

async fn write_file(
    State(state): State<Arc<AppState>>,
    Path(root_token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    // Decode path from header
    let path_b64 = headers.get("X-Path-Base64")
        .ok_or((StatusCode::BAD_REQUEST, "Missing X-Path-Base64".into()))?
        .to_str()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid header".into()))?;
    
    let path_bytes = BASE64.decode(path_b64)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid base64".into()))?;
    
    let path = String::from_utf8(path_bytes)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid UTF-8 path".into()))?;
    
    let offset: u64 = headers.get("X-Offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    
    // Validate path against root
    let full_path = validate_path(&state, &root_token, &path)?;
    
    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    
    // Write data
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(&full_path)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    file.seek(SeekFrom::Start(offset)).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    file.write_all(&body).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Optional hash verification
    if let Some(expected_hex) = headers.get("X-Expected-SHA1") {
        let expected_hex = expected_hex.to_str()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid hash header".into()))?;
        
        let mut hasher = Sha1::new();
        hasher.update(&body);
        let actual = hex::encode(hasher.finalize());
        
        if actual != expected_hex {
            return Err((
                StatusCode::CONFLICT,
                format!("Hash mismatch: expected {}, got {}", expected_hex, actual)
            ));
        }
    }
    
    Ok(StatusCode::OK)
}
```

### DaemonFileHandle (TypeScript)

```typescript
export class DaemonFileHandle implements IFileHandle {
  private pendingHash: Uint8Array | null = null
  
  constructor(
    private connection: DaemonConnection,
    private path: string,
    private rootToken: string,
  ) {}

  /**
   * Set expected hash for next write.
   * If hash mismatches, write will throw HashMismatchError.
   */
  setExpectedHashForNextWrite(sha1: Uint8Array): void {
    this.pendingHash = sha1
  }

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    const data = buffer.subarray(offset, offset + length)
    const pathB64 = btoa(this.path)
    
    const headers: Record<string, string> = {
      'X-Path-Base64': pathB64,
      'X-Offset': String(position),
    }
    
    // Attach pending hash if set
    if (this.pendingHash) {
      headers['X-Expected-SHA1'] = bytesToHex(this.pendingHash)
      this.pendingHash = null  // Consume it
    }
    
    const response = await this.connection.requestWithHeaders(
      'POST',
      `/write/${this.rootToken}`,
      headers,
      data,
    )
    
    if (response.status === 409) {
      throw new HashMismatchError(await response.text())
    }
    
    if (!response.ok) {
      throw new Error(`Write failed: ${response.status}`)
    }
    
    return { bytesWritten: length }
  }

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    const pathB64 = btoa(this.path)
    
    const data = await this.connection.requestBinaryWithHeaders(
      'GET',
      `/read/${this.rootToken}`,
      {
        'X-Path-Base64': pathB64,
        'X-Offset': String(position),
        'X-Length': String(length),
      },
    )
    
    buffer.set(data, offset)
    return { bytesRead: data.length }
  }
  
  // ... truncate, sync, close unchanged
}
```

### Capability Detection Pattern

Don't modify IFileSystem/IFileHandle interfaces. Instead, use runtime check:

```typescript
// Type guard
function supportsVerifiedWrite(handle: IFileHandle): handle is DaemonFileHandle {
  return 'setExpectedHashForNextWrite' in handle
}

// Usage in piece finalization
async function finalizePiece(
  handle: IFileHandle, 
  data: Uint8Array, 
  expectedHash: Uint8Array,
  hasher: IHasher,
): Promise<void> {
  if (supportsVerifiedWrite(handle)) {
    // Atomic write+verify in io-daemon
    handle.setExpectedHashForNextWrite(expectedHash)
    await handle.write(data, 0, data.length, 0)
    // 200 means verified - done!
  } else {
    // Fallback: verify locally then write
    const actual = await hasher.sha1(data)
    if (!hashesEqual(actual, expectedHash)) {
      throw new HashMismatchError('Piece hash mismatch')
    }
    await handle.write(data, 0, data.length, 0)
  }
}
```

**Benefits:**
- IFileSystem/IFileHandle stay clean and generic
- DaemonFileHandle has extra capability without polluting interface
- Explicit opt-in via capability check
- Works with any IFileHandle implementation

### DaemonConnection additions

```typescript
// Add to daemon-connection.ts

async requestWithHeaders(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Uint8Array,
): Promise<Response> {
  const url = new URL(path, this.baseUrl)
  
  return fetch(url.toString(), {
    method,
    headers: {
      'X-JST-Auth': this.authToken,
      ...headers,
    },
    body,
  })
}

async requestBinaryWithHeaders(
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<Uint8Array> {
  const response = await this.requestWithHeaders(method, path, headers)
  
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  
  return new Uint8Array(await response.arrayBuffer())
}
```

## Migration

### io-daemon routes

Old (keep for compatibility):
```
GET  /files/*path?root_token=...&offset=...&length=...
POST /files/*path?root_token=...&offset=...
```

New (preferred):
```
GET  /read/{root_token}   + X-Path-Base64, X-Offset, X-Length headers
POST /write/{root_token}  + X-Path-Base64, X-Offset, X-Expected-SHA1 headers
```

Can deprecate old routes once TS side migrated.

## Checklist

### io-daemon
- [x] Add `POST /write/{root_token}` endpoint
- [x] Add `GET /read/{root_token}` endpoint
- [x] Parse X-Path-Base64 header (base64 decode → UTF-8 string)
- [x] Parse X-Offset header
- [x] Parse X-Expected-SHA1 header (optional)
- [x] Return 409 on hash mismatch
- [x] Add tests in verify_*.py

### Engine
- [x] Add `setExpectedHashForNextWrite()` to DaemonFileHandle
- [x] Add `requestWithHeaders()` to DaemonConnection
- [x] Update DaemonFileHandle.read() to use new endpoint
- [x] Update DaemonFileHandle.write() to use new endpoint
- [x] Add `supportsVerifiedWrite()` type guard
- [x] Add HashMismatchError class
- [x] Update piece finalization to use verified write when available
