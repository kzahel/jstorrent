# Minimal Download Roots UI

## Overview

Add minimal UI for managing download roots:
1. Display list of configured roots
2. Show warning when no roots configured
3. Button to add new root (triggers OS folder picker via native-host)
4. Select default root (persisted to chrome.storage.local)

No "remove root" for now - that can come later.

## Prerequisites

This assumes the previous task is complete (handshake returns roots array).

## Task 1: Update Native Host to Add Root to List

The current `PickDownloadDirectory` operation uses an older single-root model. Update it to:
- Generate a unique token for the new root
- Add to `download_roots` in rpc_info
- Persist to rpc-info.json
- Return the new `DownloadRoot`

**Update file**: `native-host/src/protocol.rs`

Add a new response type for the added root:

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
    RootAdded { root: DownloadRoot },
}
```

**Update file**: `native-host/src/folder_picker.rs`

```rust
use crate::protocol::ResponsePayload;
use crate::state::State;
use anyhow::{anyhow, Result};
use rfd::AsyncFileDialog;
use jstorrent_common::DownloadRoot;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};

pub async fn pick_download_directory(state: &State) -> Result<ResponsePayload> {
    let task = AsyncFileDialog::new()
        .set_title("Select Download Directory")
        .pick_folder();

    let handle = task.await;

    match handle {
        Some(path_handle) => {
            let path = path_handle.path().to_path_buf();
            let canonical = path.canonicalize().unwrap_or(path.clone());
            let path_str = canonical.to_string_lossy().to_string();
            
            // Generate display name from folder name
            let display_name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());

            // Create new root with unique token
            let new_root = DownloadRoot {
                token: Uuid::new_v4().to_string(),
                path: path_str.clone(),
                display_name,
                removable: false,
                last_stat_ok: true,
                last_checked: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
            };

            // Add to rpc_info.download_roots
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(ref mut info) = *info_guard {
                    // Check if path already exists
                    let exists = info.download_roots.iter().any(|r| r.path == path_str);
                    if !exists {
                        info.download_roots.push(new_root.clone());
                    }
                }
            }

            // Note: The caller (main.rs) calls daemon_manager.refresh_config() 
            // which should persist changes. If not, we need to save rpc_info here.

            Ok(ResponsePayload::RootAdded { root: new_root })
        }
        None => Err(anyhow!("User cancelled folder selection")),
    }
}
```

**Note**: You may need to add `uuid` to Cargo.toml:
```toml
uuid = { version = "1", features = ["v4"] }
```

**Update file**: `native-host/src/rpc.rs`

Ensure `save_rpc_info` function exists and is called after modifying download_roots. Save to disk. Make sure `daemon_manager.refresh_config()` is called to notify daemon_manager that the
download roots have changed (it will read rpc-info from disk)

## Task 2: Update Extension Types

**Update file**: `extension/src/lib/native-connection.ts`

Add the RootAdded response handling:

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

// Response types from native host
export interface NativeResponse {
  id: string
  ok: boolean
  error?: string
  type?: string
  payload?: unknown
}

export interface RootAddedResponse extends NativeResponse {
  type: 'RootAdded'
  payload: {
    root: DownloadRoot
  }
}
```

## Task 3: Add pickDownloadFolder to Client

**Update file**: `extension/src/lib/client.ts`

Add method to trigger folder picker:

```typescript
/**
 * Open OS folder picker to add a new download root.
 * Returns the newly added root, or null if cancelled.
 */
async pickDownloadFolder(): Promise<DownloadRoot | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    
    const handler = (msg: unknown) => {
      if (typeof msg !== 'object' || msg === null) return
      const response = msg as { id?: string; ok?: boolean; type?: string; payload?: { root?: DownloadRoot }; error?: string }
      
      if (response.id !== requestId) return
      
      if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
        const root = response.payload.root
        // Register with StorageRootManager
        if (this.engine) {
          this.engine.storageRootManager.addRoot({
            token: root.token,
            label: root.display_name,
            path: root.path,
          })
          console.log('Added new download root:', root)
        }
        resolve(root)
      } else {
        console.log('Folder picker cancelled or failed:', response.error)
        resolve(null)
      }
    }
    
    this.native.onMessage(handler)
    this.native.send({
      op: 'pickDownloadDirectory',
      id: requestId,
    })
  })
}

/**
 * Get current download roots.
 */
getRoots(): Array<{ token: string; label: string; path: string }> {
  if (!this.engine) return []
  return this.engine.storageRootManager.getRoots()
}

/**
 * Get the current default root token.
 */
async getDefaultRootToken(): Promise<string | null> {
  const result = await chrome.storage.local.get('defaultRootToken')
  return result.defaultRootToken || null
}

/**
 * Set the default download root.
 */
async setDefaultRoot(token: string): Promise<void> {
  if (!this.engine) {
    throw new Error('Engine not initialized')
  }
  this.engine.storageRootManager.setDefaultRoot(token)
  await chrome.storage.local.set({ defaultRootToken: token })
}
```

## Task 4: Add Message Handlers in Service Worker

**Update file**: `extension/src/sw.ts`

Add handlers for root management:

```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ... existing handlers ...
  
  if (message.type === 'GET_ROOTS') {
    client.ensureDaemonReady().then(() => {
      const roots = client.getRoots()
      client.getDefaultRootToken().then((defaultToken) => {
        sendResponse({ roots, defaultToken })
      })
    })
    return true
  }
  
  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    client.ensureDaemonReady().then(async () => {
      const root = await client.pickDownloadFolder()
      sendResponse({ root })
    })
    return true
  }
  
  if (message.type === 'SET_DEFAULT_ROOT') {
    client.ensureDaemonReady().then(async () => {
      try {
        await client.setDefaultRoot(message.token)
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false, error: String(e) })
      }
    })
    return true
  }
})
```

## Task 5: Create DownloadRootsManager Component

**Create file**: `extension/src/ui/components/DownloadRootsManager.tsx`

```typescript
import React, { useEffect, useState } from 'react'

interface DownloadRoot {
  token: string
  label: string
  path: string
}

export const DownloadRootsManager: React.FC = () => {
  const [roots, setRoots] = useState<DownloadRoot[]>([])
  const [defaultToken, setDefaultToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const loadRoots = () => {
    chrome.runtime.sendMessage({ type: 'GET_ROOTS' }, (response) => {
      if (response) {
        setRoots(response.roots || [])
        setDefaultToken(response.defaultToken || null)
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    loadRoots()
  }, [])

  const handleAddRoot = () => {
    setAdding(true)
    chrome.runtime.sendMessage({ type: 'PICK_DOWNLOAD_FOLDER' }, (response) => {
      setAdding(false)
      if (response?.root) {
        // Reload roots list
        loadRoots()
        // If this is the first root, set it as default
        if (roots.length === 0) {
          handleSetDefault(response.root.token)
        }
      }
    })
  }

  const handleSetDefault = (token: string) => {
    chrome.runtime.sendMessage({ type: 'SET_DEFAULT_ROOT', token }, (response) => {
      if (response?.ok) {
        setDefaultToken(token)
      }
    })
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  return (
    <div style={{ padding: '20px' }}>
      <h3 style={{ marginTop: 0 }}>Download Locations</h3>
      
      {roots.length === 0 ? (
        <div style={{ 
          padding: '20px', 
          background: '#fff3cd', 
          border: '1px solid #ffc107',
          borderRadius: '4px',
          marginBottom: '16px'
        }}>
          <strong>⚠️ No download location configured</strong>
          <p style={{ margin: '8px 0 0 0' }}>
            You need to select a download folder before you can add torrents.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
          {roots.map((root) => (
            <li
              key={root.token}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginBottom: '8px',
                background: root.token === defaultToken ? '#e3f2fd' : 'white',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{root.label}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>{root.path}</div>
              </div>
              
              {root.token === defaultToken ? (
                <span style={{ 
                  padding: '4px 8px', 
                  background: '#2196F3', 
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}>
                  Default
                </span>
              ) : (
                <button
                  onClick={() => handleSetDefault(root.token)}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Set as Default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      
      <button
        onClick={handleAddRoot}
        disabled={adding}
        style={{
          padding: '8px 16px',
          cursor: adding ? 'not-allowed' : 'pointer',
          background: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
        }}
      >
        {adding ? 'Selecting...' : '+ Add Download Location'}
      </button>
    </div>
  )
}
```

## Task 6: Integrate into App

**Update file**: `extension/src/ui/app.tsx`

Add a Settings tab with the DownloadRootsManager:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useEffect, useState } from 'react'
import { LogViewer } from './components/LogViewer'
import { DownloadRootsManager } from './components/DownloadRootsManager'

// ... existing interfaces ...

export const App = () => {
  const [events, setEvents] = useState<TorrentEvent[]>([])
  const [activeTab, setActiveTab] = useState<'torrents' | 'logs' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')

  // ... existing code ...

  return (
    <div style={{ /* ... */ }}>
      {/* Header */}
      <div style={{ /* ... */ }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>JSTorrent</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'torrents' ? '#2196F3' : '#eee',
              color: activeTab === 'torrents' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'logs' ? '#2196F3' : '#eee',
              color: activeTab === 'logs' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Logs
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'settings' ? '#2196F3' : '#eee',
              color: activeTab === 'settings' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <div style={{ padding: '20px' }}>
            {/* ... existing torrents UI ... */}
          </div>
        )}

        {activeTab === 'logs' && <LogViewer />}
        
        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
    </div>
  )
}
```

## Task 7: Persist Default Root on Startup

**Update file**: `extension/src/lib/client.ts`

In `ensureDaemonReady()`, after registering roots, load the saved default:

```typescript
// Register download roots from daemon handshake
if (daemonInfo.roots && daemonInfo.roots.length > 0) {
  for (const root of daemonInfo.roots) {
    srm.addRoot({
      token: root.token,
      label: root.display_name,
      path: root.path,
    })
  }
  
  // Load saved default, or use first root
  const savedDefault = await chrome.storage.local.get('defaultRootToken')
  const defaultToken = savedDefault.defaultRootToken
  
  // Verify saved default still exists
  const validDefault = daemonInfo.roots.some(r => r.token === defaultToken)
  
  if (validDefault) {
    srm.setDefaultRoot(defaultToken)
  } else if (daemonInfo.roots.length > 0) {
    srm.setDefaultRoot(daemonInfo.roots[0].token)
  }
  
  console.log('Registered', daemonInfo.roots.length, 'download roots')
} else {
  console.warn('No download roots configured! Downloads will fail.')
}
```

## Verification

```bash
# Build native-host
cd native-host
cargo build

# Build extension
cd ../extension
pnpm build
```

Then manually test:
1. Load extension, open UI
2. Go to Settings tab - should show "No download location configured" warning
3. Click "Add Download Location" - OS folder picker should open
4. Select a folder - should appear in list as default
5. Add another folder - should appear in list
6. Click "Set as Default" on second folder
7. Close and reopen extension - default should persist
8. Add a torrent - should download to default location

## Summary

**Native host changes:**
- Update `ResponsePayload` to include `RootAdded` variant
- Update `folder_picker.rs` to create `DownloadRoot` with token and persist to rpc_info

**Extension changes:**
- Add `pickDownloadFolder()`, `getRoots()`, `setDefaultRoot()` to Client
- Add message handlers in sw.ts for GET_ROOTS, PICK_DOWNLOAD_FOLDER, SET_DEFAULT_ROOT
- Create `DownloadRootsManager` component
- Add Settings tab to app.tsx
- Load saved default root on startup

**Future improvements:**
- Remove root functionality
- Rename root (custom display_name)
- Show disk space available
- Per-torrent root selection
