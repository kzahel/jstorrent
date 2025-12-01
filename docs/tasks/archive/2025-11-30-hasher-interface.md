# Design: IHasher Interface and io-daemon Hash Endpoint

## Problem

The engine needs SHA1 hashing for:
1. **Piece verification** - hash downloaded piece data, compare to expected
2. **Metadata verification** - hash info dict to verify info_hash
3. **Piece recheck** - hash existing file data on resume

Currently using `crypto.subtle.digest()`, which is unavailable on HTTP origins (localhost dev).

## Solution

1. Add `POST /hash/sha1` endpoint to io-daemon for hashing arbitrary bytes
2. Create `IHasher` interface with two implementations:
   - `DaemonHasher` - sends bytes to io-daemon
   - `SubtleCryptoHasher` - uses `crypto.subtle` (for contexts where available)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Engine                                                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ IHasher                                           │   │
│  │   sha1(data: Uint8Array): Promise<Uint8Array>    │   │
│  └──────────────────────────────────────────────────┘   │
│           │                            │                 │
│           ▼                            ▼                 │
│  ┌─────────────────┐        ┌──────────────────────┐    │
│  │ DaemonHasher    │        │ SubtleCryptoHasher   │    │
│  │ (io-daemon)     │        │ (crypto.subtle)      │    │
│  └────────┬────────┘        └──────────────────────┘    │
│           │                                              │
└───────────┼──────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  io-daemon                                               │
│                                                          │
│  POST /hash/sha1                                         │
│  Authorization: Bearer {token}                           │
│  Body: <raw bytes>                                       │
│  Response: <raw 20 bytes> (application/octet-stream)    │
└─────────────────────────────────────────────────────────┘
```

## Implementation

### 1. IHasher Interface

**Location:** `packages/engine/src/interfaces/hasher.ts`

```typescript
/**
 * Interface for cryptographic hashing.
 */
export interface IHasher {
  /**
   * Compute SHA1 hash of data.
   * @returns 20-byte hash as Uint8Array
   */
  sha1(data: Uint8Array): Promise<Uint8Array>
}
```

### 2. SubtleCryptoHasher

**Location:** `packages/engine/src/adapters/browser/subtle-crypto-hasher.ts`

```typescript
import { IHasher } from '../../interfaces/hasher'

/**
 * Hasher using Web Crypto API.
 * Only works in secure contexts (HTTPS, extensions, localhost in some browsers).
 */
export class SubtleCryptoHasher implements IHasher {
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    if (!crypto?.subtle) {
      throw new Error('crypto.subtle not available (requires secure context)')
    }
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return new Uint8Array(hashBuffer)
  }
}
```

### 3. DaemonHasher

**Location:** `packages/engine/src/adapters/daemon/daemon-hasher.ts`

```typescript
import { IHasher } from '../../interfaces/hasher'
import { DaemonConnection } from './daemon-connection'

/**
 * Hasher that delegates to io-daemon.
 * Works in any context since hashing happens in Rust.
 */
export class DaemonHasher implements IHasher {
  constructor(private connection: DaemonConnection) {}

  async sha1(data: Uint8Array): Promise<Uint8Array> {
    // Returns raw 20 bytes, not hex
    return this.connection.requestBinary('POST', '/hash/sha1', undefined, data)
  }
}
```

Uses existing `requestBinary()` - no new methods needed on `DaemonConnection`.

### 4. io-daemon: POST /hash/sha1 Endpoint

**Location:** `native-host/io-daemon/src/hashing.rs`

```rust
use axum::{
    body::Bytes,
    http::header,
    response::IntoResponse,
    routing::{get, post},
    // ... existing imports
};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // Existing file-based hash endpoints
        .route("/hash/sha1/*path", get(hash_sha1_file))
        .route("/hash/sha256/*path", get(hash_sha256_file))
        // New: hash arbitrary bytes (returns raw bytes, not hex)
        .route("/hash/sha1", post(hash_sha1_bytes))
        .route("/hash/sha256", post(hash_sha256_bytes))
}

/// Hash arbitrary bytes with SHA1.
/// 
/// POST /hash/sha1
/// Body: raw bytes
/// Response: raw 20-byte hash (application/octet-stream)
async fn hash_sha1_bytes(body: Bytes) -> impl IntoResponse {
    let mut hasher = Sha1::new();
    hasher.update(&body);
    let hash = hasher.finalize();
    
    (
        [(header::CONTENT_TYPE, "application/octet-stream")],
        hash.to_vec()
    )
}

/// Hash arbitrary bytes with SHA256.
/// Response: raw 32-byte hash
async fn hash_sha256_bytes(body: Bytes) -> impl IntoResponse {
    let mut hasher = Sha256::new();
    hasher.update(&body);
    let hash = hasher.finalize();
    
    (
        [(header::CONTENT_TYPE, "application/octet-stream")],
        hash.to_vec()
    )
}

// Rename existing functions to clarify they're file-based
// (these still return hex for backwards compat / human readability)
async fn hash_sha1_file(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
    axum::extract::Query(params): axum::extract::Query<HashParams>,
) -> Result<String, (StatusCode, String)> {
    // ... existing implementation
}

async fn hash_sha256_file(
    // ... existing implementation
}
```

Note: Auth is already handled by the middleware in `main.rs` - all routes go through `auth::middleware`.

### 6. Engine Integration

**Location:** `packages/engine/src/core/bt-engine.ts` (or options)

```typescript
export interface BtEngineOptions {
  // ... existing
  hasher?: IHasher
}

// In engine initialization
this.hasher = options.hasher ?? new SubtleCryptoHasher()
```

**Location:** `extension/src/ui/lib/engine-manager.ts`

```typescript
import { DaemonHasher } from '@jstorrent/engine'

// In doInit(), after creating daemonConnection:
const hasher = new DaemonHasher(this.daemonConnection)

this.engine = new BtEngine({
  // ... existing options
  hasher,
})
```

### 7. Exports

**Location:** `packages/engine/src/interfaces/index.ts`

```typescript
export { IHasher } from './hasher'
```

**Location:** `packages/engine/src/adapters/daemon/index.ts`

```typescript
export { DaemonHasher } from './daemon-hasher'
```

**Location:** `packages/engine/src/adapters/browser/index.ts`

```typescript
export { SubtleCryptoHasher } from './subtle-crypto-hasher'
```

**Location:** `packages/engine/src/index.ts`

```typescript
export { IHasher } from './interfaces/hasher'
export { DaemonHasher } from './adapters/daemon/daemon-hasher'
export { SubtleCryptoHasher } from './adapters/browser/subtle-crypto-hasher'
```

## Testing

### Python Test for io-daemon

**Location:** `native-host/verify_hashing.py`

```python
#!/usr/bin/env python3
"""
Verify io-daemon hash endpoints.
"""

import subprocess
import requests
import hashlib
import os
import sys

IO_DAEMON_BINARY = "./target/debug/io-daemon"

def main():
    # Generate a random token
    token = "test-token-12345"
    install_id = "test-install-id"
    
    # Start io-daemon
    proc = subprocess.Popen(
        [IO_DAEMON_BINARY, "--token", token, "--install-id", install_id],
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
    )
    
    try:
        # Read port from stdout
        port_line = proc.stdout.readline().decode().strip()
        port = int(port_line)
        print(f"io-daemon started on port {port}")
        
        base_url = f"http://127.0.0.1:{port}"
        headers = {"X-JST-Auth": token}
        
        # Test 1: Hash empty bytes
        print("Test 1: Hash empty bytes...")
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=b"")
        assert resp.status_code == 200
        assert len(resp.content) == 20, f"Expected 20 bytes, got {len(resp.content)}"
        expected = hashlib.sha1(b"").digest()
        assert resp.content == expected, f"Hash mismatch"
        print(f"  ✓ Empty hash: {resp.content.hex()}")
        
        # Test 2: Hash known string
        print("Test 2: Hash 'hello world'...")
        test_data = b"hello world"
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        assert len(resp.content) == 20
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  ✓ Hash: {resp.content.hex()}")
        
        # Test 3: Hash binary data
        print("Test 3: Hash binary data (256 bytes)...")
        test_data = bytes(range(256))
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  ✓ Hash: {resp.content.hex()}")
        
        # Test 4: Hash larger data (1MB)
        print("Test 4: Hash 1MB of random data...")
        test_data = os.urandom(1024 * 1024)
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  ✓ Hash: {resp.content.hex()}")
        
        # Test 5: Auth required
        print("Test 5: Verify auth is required...")
        resp = requests.post(f"{base_url}/hash/sha1", data=b"test")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("  ✓ Unauthorized without token")
        
        # Test 6: SHA256 endpoint (32 bytes)
        print("Test 6: SHA256 endpoint...")
        test_data = b"hello sha256"
        resp = requests.post(f"{base_url}/hash/sha256", headers=headers, data=test_data)
        assert resp.status_code == 200
        assert len(resp.content) == 32
        expected = hashlib.sha256(test_data).digest()
        assert resp.content == expected
        print(f"  ✓ SHA256: {resp.content.hex()}")
        
        print("\n✓ All hash tests passed!")
        
    finally:
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    main()
```

### TypeScript Unit Test

**Location:** `packages/engine/tests/unit/daemon-hasher.spec.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DaemonHasher } from '../../src/adapters/daemon/daemon-hasher'

describe('DaemonHasher', () => {
  const mockConnection = {
    requestBinary: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sha1() sends POST to /hash/sha1 and returns raw bytes', async () => {
    const testData = new Uint8Array([1, 2, 3, 4])
    const mockHash = new Uint8Array(20).fill(0xab)  // 20 bytes
    
    mockConnection.requestBinary.mockResolvedValue(mockHash)
    
    const hasher = new DaemonHasher(mockConnection as any)
    const result = await hasher.sha1(testData)
    
    expect(mockConnection.requestBinary).toHaveBeenCalledWith(
      'POST', 
      '/hash/sha1', 
      undefined, 
      testData
    )
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(20)
    expect(result).toEqual(mockHash)
  })
})
```

## Migration Checklist

### io-daemon (Rust)
- [ ] Add `post` import to `hashing.rs`
- [ ] Add `response::IntoResponse` import
- [ ] Add `/hash/sha1` POST route
- [ ] Add `/hash/sha256` POST route  
- [ ] Add `hash_sha1_bytes` handler (returns raw bytes)
- [ ] Add `hash_sha256_bytes` handler (returns raw bytes)
- [ ] Create `verify_hashing.py` test
- [ ] Run test to verify

### Engine (TypeScript)
- [ ] Create `packages/engine/src/interfaces/hasher.ts`
- [ ] Create `packages/engine/src/adapters/browser/subtle-crypto-hasher.ts`
- [ ] Create `packages/engine/src/adapters/daemon/daemon-hasher.ts`
- [ ] Export from index files
- [ ] Add `hasher?: IHasher` to `BtEngineOptions`
- [ ] Update engine to use `this.hasher.sha1()` instead of direct crypto.subtle
- [ ] Update `engine-manager.ts` to create `DaemonHasher`

### Cleanup
- [ ] Remove/update old `hash.ts` that uses crypto.subtle directly
- [ ] Update any direct crypto.subtle usage to go through IHasher

## Threading Consideration

The hash endpoints use `axum::body::Bytes` which is extracted asynchronously. The actual SHA1 computation is CPU-bound but fast (~microseconds for small data, ~milliseconds for MB-scale).

For typical piece sizes (16KB-4MB), blocking is negligible. If we see throughput issues with many concurrent large hashes, we can wrap in `spawn_blocking`:

```rust
async fn hash_sha1_bytes(body: Bytes) -> String {
    tokio::task::spawn_blocking(move || {
        let mut hasher = Sha1::new();
        hasher.update(&body);
        hex::encode(hasher.finalize())
    }).await.unwrap()
}
```

For now, keep it simple and optimize if needed.

## TODO

- [ ] Handle OS errors for filenames with null bytes or invalid chars (surface to engine)
- [ ] Consider batched hash endpoint if needed: `POST /hash/sha1/batch` with multiple chunks
