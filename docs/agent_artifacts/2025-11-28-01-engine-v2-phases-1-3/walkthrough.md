# Phase 3: Implement StorageRootManager

## Overview
This walkthrough covers the implementation of `StorageRootManager`, a key component of the Engine v2 Architecture. It enables the engine to manage multiple storage locations (roots) and resolves where torrents should be stored.

## Changes

### 1. StorageRootManager
We implemented the `StorageRootManager` class and `StorageRoot` type.

- **Type**: `packages/engine/src/storage/types.ts`
- **Manager**: `packages/engine/src/storage/storage-root-manager.ts`

```typescript
// packages/engine/src/storage/storage-root-manager.ts
export class StorageRootManager {
  // ...
  addRoot(root: StorageRoot): void
  setDefaultRoot(token: string): void
  setRootForTorrent(torrentId: string, token: string): void
  getFileSystemForTorrent(torrentId: string): IFileSystem
  // ...
}
```

### 2. Engine Integration
We updated `BtEngine` to use `StorageRootManager` instead of a single `fileSystem`.

- **Updated `BtEngineOptions`**: Added `storageRootManager`, deprecated `fileSystem` (but kept for backward compatibility).
- **Updated `BtEngine`**:
    - Constructor now initializes `StorageRootManager`.
    - `addTorrent` uses `StorageRootManager` to resolve the filesystem for the torrent.
    - `addTorrent` now accepts `storageToken` in options to specify where to store the torrent.

```typescript
// packages/engine/src/core/bt-engine.ts
async addTorrent(magnetOrBuffer: string | Uint8Array, options: { storageToken?: string } = {}): Promise<Torrent> {
  // ...
  if (options.storageToken) {
    this.storageRootManager.setRootForTorrent(infoHashStr, options.storageToken)
  }
  const fileSystem = this.storageRootManager.getFileSystemForTorrent(infoHashStr)
  // ...
}
```

### 3. Node Environment
We updated `createNodeEngineEnvironment` to set up `StorageRootManager` with a default root pointing to the download path.

```typescript
// packages/engine/src/node-rpc/create-node-env.ts
const storageRootManager = new StorageRootManager((root) => {
  return new ScopedNodeFileSystem(root.path)
})
// ...
```

## Verification Results

### Automated Tests
- **Typecheck**: `pnpm typecheck` ✅
- **Lint**: `pnpm lint` ✅
- **Unit Tests**: `vitest run "tests/unit/storage-root-manager.spec.ts"` ✅
- **Integration Tests**: `pnpm run test:python` ✅ (Verified existing functionality is preserved)
