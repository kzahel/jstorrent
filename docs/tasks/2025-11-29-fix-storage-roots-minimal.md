# Fix Storage Root Configuration - Minimal Handshake Fix

## Overview

The extension needs download roots to know where to save torrent data. The roots are already stored in `rpc-info.json` and available in `State.rpc_info`. We just need to include them in the `DaemonInfo` response.

## Task 1: Update ResponsePayload to Include Roots

**Update file**: `native-host/src/protocol.rs`

Add the DownloadRoot import and expand DaemonInfo:

```rust
use jstorrent_common::DownloadRoot;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ResponsePayload {
    Empty,
    DaemonInfo {
        port: u16,
        token: String,
        roots: Vec<DownloadRoot>,
    },
    Path { path: String },
}
```

## Task 2: Pass Roots in Handshake Response

**Update file**: `native-host/src/main.rs`

In the handshake handler, get roots from state.rpc_info and include them:

Find this code (around line 85-90):
```rust
if let (Some(port), Some(token)) = (daemon_manager.port, daemon_manager.token.clone()) {
    Ok(ResponsePayload::DaemonInfo { port, token })
}
```

Replace with:
```rust
if let (Some(port), Some(token)) = (daemon_manager.port, daemon_manager.token.clone()) {
    // Get roots from rpc_info
    let roots = state.rpc_info.lock().unwrap()
        .as_ref()
        .map(|info| info.download_roots.clone())
        .unwrap_or_default();
    
    Ok(ResponsePayload::DaemonInfo { port, token, roots })
}
```

## Task 3: Update Extension DaemonInfo Type

**Update file**: `extension/src/lib/native-connection.ts`

```typescript
export interface DownloadRoot {
  token: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}

export interface DaemonInfo {
  port: number
  token: string
  roots: DownloadRoot[]
}
```

## Task 4: Register Roots in Client

**Update file**: `extension/src/lib/client.ts`

Update the imports:
```typescript
import { INativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'
```

In `ensureDaemonReady()`, after creating the StorageRootManager, register the roots:

Find this code:
```typescript
const conn = new DaemonConnection(daemonInfo.port, daemonInfo.token)
const factory = new DaemonSocketFactory(conn)
const fs = new DaemonFileSystem(conn, 'root')
const srm = new StorageRootManager(() => fs)
const store = new MemorySessionStore()
```

Replace with:
```typescript
const conn = new DaemonConnection(daemonInfo.port, daemonInfo.token)
const factory = new DaemonSocketFactory(conn)
const store = new MemorySessionStore()

// Create StorageRootManager with factory that creates DaemonFileSystem per root
const srm = new StorageRootManager((root) => new DaemonFileSystem(conn, root.token))

// Register download roots from daemon handshake
if (daemonInfo.roots && daemonInfo.roots.length > 0) {
  for (const root of daemonInfo.roots) {
    srm.addRoot({
      token: root.token,
      label: root.display_name,
      path: root.path,
    })
  }
  // Set first root as default (TODO: load user preference)
  srm.setDefaultRoot(daemonInfo.roots[0].token)
  console.log('Registered', daemonInfo.roots.length, 'download roots')
} else {
  console.warn('No download roots configured! Downloads will fail.')
}
```

Also remove the unused `fs` variable that was created before.

## Future Work: UI for Managing Roots

This task only wires up the roots from the handshake. The following UI features are separate future tasks:

1. **Empty roots state** - UI should show "No download location configured" with a button to add one
2. **Add new root** - Extension sends "pickFolder" to native-host → OS folder picker → new root added to rpc-info.json
3. **Set default root** - UI to select which root is default for new torrents
4. **Remove root** - UI to remove a configured root

Until the "Add new root" UI is implemented, users will need to manually add roots to rpc-info.json or the downloads will fail with "No storage root found".

## Verification

```bash
# Build native-host
cd native-host
cargo build

# Build extension  
cd ../extension
pnpm build

# Run e2e tests
pnpm test:e2e
```

Then manually test:
1. Load extension in Chrome
2. Open extension popup/DevTools
3. Check console for "Registered X download roots"
4. Verify `client.engine.storageRootManager.getRoots()` returns the roots
5. Add a torrent - should start downloading to the default root

## Summary

Changes:
- `native-host/src/protocol.rs` - Add roots field to DaemonInfo
- `native-host/src/main.rs` - Include roots in handshake response  
- `extension/src/lib/native-connection.ts` - Add DownloadRoot type, update DaemonInfo
- `extension/src/lib/client.ts` - Register roots from handshake response

Future work (separate tasks):
- UI for empty roots state
- "pickFolder" operation on native-host
- UI for setting default root
