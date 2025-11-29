# Use ChromeStorageSessionStore for Session Persistence

## Overview

Replace `MemorySessionStore` with `ChromeStorageSessionStore` in the extension so torrent state persists across browser restarts.

## Task 1: Export ChromeStorageSessionStore from Engine

**Update file**: `packages/engine/src/index.ts`

Add export for ChromeStorageSessionStore:

```typescript
// Adapters
export { MemorySessionStore } from './adapters/memory/memory-session-store'
export { ChromeStorageSessionStore } from './adapters/browser/chrome-storage-session-store'
export { DaemonConnection } from './adapters/daemon/daemon-connection'
export { DaemonSocketFactory } from './adapters/daemon/daemon-socket-factory'
export { DaemonFileSystem } from './adapters/daemon/daemon-filesystem'
```

## Task 2: Update Extension Client

**Update file**: `extension/src/lib/client.ts`

Change the import:
```typescript
import {
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  BtEngine,
  StorageRootManager,
  ChromeStorageSessionStore,  // Changed from MemorySessionStore
  RingBufferLogger,
  LogEntry,
} from '@jstorrent/engine'
```

Change the store instantiation (around line 50):
```typescript
const store = new ChromeStorageSessionStore(chrome.storage.local)
```

## Task 3: Namespace Session Keys (Optional but Recommended)

To avoid conflicts with other extension data (like `installId`, `defaultRootToken`), consider using a prefix for session store keys.

**Update file**: `packages/engine/src/adapters/browser/chrome-storage-session-store.ts`

Add optional prefix support:

```typescript
export class ChromeStorageSessionStore implements ISessionStore {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private storageArea: any = chrome.storage.local,
    private prefix: string = 'session:'
  ) {}

  private prefixKey(key: string): string {
    return this.prefix + key
  }

  async get(key: string): Promise<Uint8Array | null> {
    const prefixedKey = this.prefixKey(key)
    const result = await this.storageArea.get(prefixedKey)
    const value = result[prefixedKey]
    if (typeof value === 'string') {
      return fromBase64(value)
    }
    return null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.storageArea.set({ [this.prefixKey(key)]: toBase64(value) })
  }

  async delete(key: string): Promise<void> {
    await this.storageArea.remove(this.prefixKey(key))
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = await this.storageArea.get(null)
    const allKeys = Object.keys(all)
    
    // Filter to only our namespace
    const ourKeys = allKeys
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length))
    
    if (prefix) {
      return ourKeys.filter((k) => k.startsWith(prefix))
    }
    return ourKeys
  }

  async clear(): Promise<void> {
    // Only clear keys in our namespace, not all extension storage
    const keys = await this.keys()
    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    await this.storageArea.remove(prefixedKeys)
  }
}
```

Then in client.ts:
```typescript
const store = new ChromeStorageSessionStore(chrome.storage.local, 'session:')
```

## Verification

```bash
# Build engine
cd packages/engine
pnpm build

# Build extension
cd ../../extension
pnpm build
```

Then manually test:
1. Load extension, add a torrent
2. Let it download a few pieces
3. Close and reopen Chrome
4. Open extension - torrent state should be restored

## What Gets Persisted

The session store is used by `SessionManager` (if enabled) to persist:
- Torrent metadata (infohash, name, files)
- Download progress (bitfield)

**Note**: The actual piece data is stored on disk via `DaemonFileSystem`. The session store only tracks metadata and progress.

## Summary

Changes:
- `packages/engine/src/index.ts` - Export `ChromeStorageSessionStore`
- `packages/engine/src/adapters/browser/chrome-storage-session-store.ts` - Add prefix support (optional)
- `extension/src/lib/client.ts` - Use `ChromeStorageSessionStore` instead of `MemorySessionStore`
