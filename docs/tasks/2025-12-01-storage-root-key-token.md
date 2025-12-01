# Storage Root Key/Token Redesign

## Current State

The current implementation has confusing naming where multiple things are called "token":

### Token Inventory

| Name | Value | Purpose | Where Used |
|------|-------|---------|------------|
| `rpc::start_server()` token | UUID (per session) | Native-host RPC auth (for link-handler) | `/health?token=...`, `/add-magnet?token=...` |
| `DaemonManager.token` | UUID (per session) | io-daemon auth | `--token` CLI arg, stored in `DaemonInfo.token` |
| `DaemonInfo.token` | UUID (per session) | io-daemon auth | `X-JST-Auth` header in all io-daemon requests |
| `ProfileEntry.token` | UUID (per session) | Native-host RPC token (same as first) | Stored in rpc-info.json |
| `DownloadRoot.token` | sha256(salt+path) | **Stable root identifier** | URL path: `/write/{root.token}` |

### The Naming Problem

Four different things are called "token":
1. Native-host's RPC server token (UUID, per-session)
2. io-daemon's auth token (different UUID, per-session)
3. ProfileEntry.token in rpc-info.json (same as #1)
4. DownloadRoot.token (sha256 hash, **stable across sessions**)

Only #4 is stable! It's functioning as a **key** (like Chrome's `retainEntry()` ID), not a token.

### Current Authentication Flow
```
Extension ─────────────────────────────────────────────────► io-daemon
           POST /write/{root.token}
           Headers:
             X-JST-Auth: {daemonInfo.token}  ← session UUID
             X-Path-Base64: {base64(path)}
           
           root.token = sha256(salt + path)  ← stable identifier
```

## Proposed Redesign

### Option A: Naming Fix Only

Just rename for clarity, no security change:

```rust
pub struct DownloadRoot {
    pub key: String,      // sha256(salt + path) - stable identifier
    pub path: String,
    pub display_name: String,
    // ...
}
```

URL becomes: `POST /write/{root_key}` (same value, clearer name)

### Option B: Add Per-Root Authorization

Add a separate secret token for each root:

```rust
pub struct DownloadRoot {
    pub key: String,      // sha256(salt + path) - stable identifier, used in URL
    pub secret: String,   // Random UUID - authorization token for this root
    pub path: String,
    pub display_name: String,
    // ...
}
```

Security model:
- URL path uses `key` (stable, not secret)
- Header `X-Root-Secret: {secret}` authorizes access to that specific root
- Daemon validates both daemon token AND root secret

Benefits:
- Compromising one root's secret doesn't expose others
- Can revoke access to specific roots by regenerating their secret

Drawbacks:
- More complex
- May be overkill for single-user desktop app

## Recommendation

**Start with Option A** (naming fix) since:
1. The daemon token already authenticates all requests
2. This is a single-user local application
3. Per-root secrets add complexity without clear benefit

Can upgrade to Option B later if needed.

## Implementation Plan (Option A)

### Phase 1: Rename in Rust

1. **jstorrent_common/src/lib.rs**
   ```rust
   pub struct DownloadRoot {
       pub key: String,  // was: token
       // ...
   }
   ```

2. **native-host/src/folder_picker.rs**
   ```rust
   let key = hex::encode(hasher.finalize());  // was: token
   let new_root = DownloadRoot {
       key,  // was: token
       // ...
   };
   ```

3. **io-daemon/src/files.rs**
   - Rename `root_token` → `root_key` in routes and handlers
   - Update `validate_path()` to use `r.key` instead of `r.token`

4. **io-daemon routes**
   ```rust
   .route("/write/:root_key", post(write_file_v2))
   .route("/read/:root_key", get(read_file_v2))
   ```

### Phase 2: Rename in TypeScript

1. **packages/engine/src/adapters/daemon/**
   - `DaemonFileSystem`: `rootToken` → `rootKey`
   - `DaemonFileHandle`: `rootToken` → `rootKey`
   - Update URL paths

2. **Extension UI**
   - Any references to `root.token` → `root.key`

### Phase 3: Migration

Since rpc-info.json is persisted, need migration:

```rust
// On load, check for old format and migrate
if root.token.is_some() && root.key.is_none() {
    root.key = root.token.take();
}
```

Or just support both field names during transition.

### Phase 4: Update Deprecated Endpoints

The deprecated `/files/*` endpoints use `root_token` query param:
```rust
struct ReadParams {
    root_token: String,  // → root_key
}
```

Since these are deprecated, could just remove them or keep for backward compat.

## Files to Modify

### Rust
- `native-host/jstorrent-common/src/lib.rs` - DownloadRoot struct
- `native-host/src/folder_picker.rs` - key generation
- `native-host/src/lib.rs` - if DownloadRoot is also here
- `native-host/io-daemon/src/files.rs` - routes and validation
- `native-host/io-daemon/src/config.rs` - if it references token

### TypeScript
- `packages/engine/src/adapters/daemon/daemon-filesystem.ts`
- `packages/engine/src/adapters/daemon/daemon-file-handle.ts`
- `packages/engine/test/integration/daemon-filesystem.spec.ts`
- Extension UI files referencing `DownloadRoot`

## Testing Checklist

- [ ] New folder picker creates roots with `key` field
- [ ] io-daemon accepts `/write/{root_key}` URLs
- [ ] Existing rpc-info.json with `token` field still works (migration)
- [ ] TypeScript engine uses new field name
- [ ] Integration tests pass
