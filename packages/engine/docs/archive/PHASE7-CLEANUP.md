# Post-Phase 7 Cleanup Tasks

## Overview

Phase 7 of the engine v2 architecture is complete but needs cleanup. Complete these tasks in order. Run tests after each section to verify nothing breaks.

## Task 1: Fix Critical Bug - Commented Out storageRootManager

Two files have `storageRootManager` commented out when creating BtEngine. This is a critical bug.

### 1.1 Fix daemon preset

**File**: `packages/engine/src/presets/daemon.ts`

Find this code (around line 37-43):
```typescript
return new BtEngine({
  socketFactory: new DaemonSocketFactory(connection),
  // storageRootManager,
  sessionStore: config.sessionStore,
```

Change to:
```typescript
return new BtEngine({
  socketFactory: new DaemonSocketFactory(connection),
  storageRootManager,
  sessionStore: config.sessionStore,
```

### 1.2 Fix extension client

**File**: `extension/src/lib/client.ts`

Find this code (around line 50-54):
```typescript
this.engine = new BtEngine({
  socketFactory: factory,
  // storageRootManager: srm,
  sessionStore: store,
})
```

Change to:
```typescript
this.engine = new BtEngine({
  socketFactory: factory,
  storageRootManager: srm,
  sessionStore: store,
})
```

### Verify

```bash
pnpm build
pnpm test
```

## Task 2: Add Missing Tests

### 2.1 Add MemorySessionStore tests

**Create file**: `packages/engine/tests/unit/memory-session-store.spec.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'

describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => {
    store = new MemorySessionStore()
  })

  it('should return null for non-existent key', async () => {
    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })

  it('should set and get a value', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    await store.set('test-key', data)
    const result = await store.get('test-key')
    expect(result).toEqual(data)
  })

  it('should delete a value', async () => {
    const data = new Uint8Array([1, 2, 3])
    await store.set('test-key', data)
    await store.delete('test-key')
    const result = await store.get('test-key')
    expect(result).toBeNull()
  })

  it('should list all keys', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.set('other', new Uint8Array([3]))
    
    const keys = await store.keys()
    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
    expect(keys).toContain('other')
  })

  it('should list keys with prefix filter', async () => {
    await store.set('torrent:abc:bitfield', new Uint8Array([1]))
    await store.set('torrent:abc:peers', new Uint8Array([2]))
    await store.set('torrent:def:bitfield', new Uint8Array([3]))
    await store.set('config:setting', new Uint8Array([4]))
    
    const torrentKeys = await store.keys('torrent:abc')
    expect(torrentKeys).toHaveLength(2)
    expect(torrentKeys).toContain('torrent:abc:bitfield')
    expect(torrentKeys).toContain('torrent:abc:peers')
  })

  it('should clear all data', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.clear()
    
    const keys = await store.keys()
    expect(keys).toHaveLength(0)
  })
})
```

### 2.2 Add JsonFileSessionStore tests

**Create file**: `packages/engine/tests/unit/json-file-session-store.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { JsonFileSessionStore } from '../../src/adapters/node/json-file-session-store'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

describe('JsonFileSessionStore', () => {
  let store: JsonFileSessionStore
  let tmpDir: string
  let filePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jst-session-test-'))
    filePath = path.join(tmpDir, 'session.json')
    store = new JsonFileSessionStore(filePath)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should return null for non-existent key', async () => {
    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })

  it('should set and get a value', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    await store.set('test-key', data)
    const result = await store.get('test-key')
    expect(result).toEqual(data)
  })

  it('should persist data after flush', async () => {
    const data = new Uint8Array([5, 6, 7, 8])
    await store.set('persist-key', data)
    await store.flush()

    // Create new store instance pointing to same file
    const store2 = new JsonFileSessionStore(filePath)
    const result = await store2.get('persist-key')
    expect(result).toEqual(data)
  })

  it('should handle missing file gracefully', async () => {
    const nonexistentPath = path.join(tmpDir, 'nonexistent', 'session.json')
    const newStore = new JsonFileSessionStore(nonexistentPath)
    const result = await newStore.get('any')
    expect(result).toBeNull()
  })

  it('should create directory on flush if needed', async () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'session.json')
    const newStore = new JsonFileSessionStore(nestedPath)
    await newStore.set('key', new Uint8Array([1]))
    await newStore.flush()

    const exists = await fs.access(nestedPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('should list keys with prefix filter', async () => {
    await store.set('torrent:abc:bitfield', new Uint8Array([1]))
    await store.set('torrent:def:bitfield', new Uint8Array([2]))
    await store.set('config:x', new Uint8Array([3]))

    const keys = await store.keys('torrent:')
    expect(keys).toHaveLength(2)
    expect(keys.every(k => k.startsWith('torrent:'))).toBe(true)
  })

  it('should clear all data', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.clear()

    const keys = await store.keys()
    expect(keys).toHaveLength(0)
  })

  it('should delete a key', async () => {
    await store.set('to-delete', new Uint8Array([1]))
    await store.delete('to-delete')
    const result = await store.get('to-delete')
    expect(result).toBeNull()
  })
})
```

### 2.3 Add StorageRootManager error case tests

**File**: `packages/engine/tests/unit/storage-root-manager.spec.ts`

Add these test cases to the existing file:

```typescript
it('should throw when setting default to non-existent root', () => {
  expect(() => manager.setDefaultRoot('nonexistent')).toThrow('not found')
})

it('should throw when setting torrent root to non-existent token', () => {
  expect(() => manager.setRootForTorrent('abc', 'nonexistent')).toThrow('not found')
})

it('should throw when getting filesystem with no root configured', () => {
  expect(() => manager.getFileSystemForTorrent('abc')).toThrow('No storage root found')
})

it('should remove root and clear default if it was default', () => {
  const root = { token: 'test', label: 'Test', path: '/test' }
  manager.addRoot(root)
  manager.setDefaultRoot('test')
  manager.removeRoot('test')
  
  expect(manager.getRoots()).toHaveLength(0)
  expect(manager.getRootForTorrent('any')).toBeNull()
})

it('should normalize torrent IDs to lowercase', () => {
  const root = { token: 'test', label: 'Test', path: '/test' }
  manager.addRoot(root)
  manager.setDefaultRoot('test')
  
  manager.setRootForTorrent('ABCDEF', 'test')
  
  // Should find it regardless of case
  expect(manager.getRootForTorrent('abcdef')).toBe(root)
  expect(manager.getRootForTorrent('ABCDEF')).toBe(root)
  expect(manager.getRootForTorrent('AbCdEf')).toBe(root)
})
```

### Verify

```bash
pnpm test
```

## Task 3: Remove Dead/Deprecated Code

### 3.1 Remove StorageResolver from BtEngine

**File**: `packages/engine/src/core/bt-engine.ts`

Remove the deprecated interface and option:

```typescript
// DELETE this interface (around line 32-35):
/** @deprecated Use StorageRootManager instead */
export interface StorageResolver {
  resolve(rootKey: string, torrentId: string): string
}

// DELETE storageResolver from BtEngineOptions interface:
storageResolver?: StorageResolver
```

### 3.2 Remove commented-out addTorrentInstance

**File**: `packages/engine/src/core/bt-engine.ts`

Delete the entire commented-out block (around line 307-324):

```typescript
// DELETE this entire commented block:
/*
// Simplified add for testing/verification with existing components
addTorrentInstance(torrent: Torrent) {
  this.torrents.push(torrent)
  ...
}
*/
```

### 3.3 Remove IndexedDBSessionStore

**Delete file**: `packages/engine/src/adapters/browser/indexeddb-session-store.ts`

**Update file**: `packages/engine/src/adapters/browser/index.ts`

Remove the export for IndexedDBSessionStore. The file should only export ChromeStorageSessionStore:

```typescript
export { ChromeStorageSessionStore } from './chrome-storage-session-store'
```

### 3.4 Check for any imports of removed code

```bash
grep -r "StorageResolver\|addTorrentInstance\|IndexedDBSessionStore" packages/engine/src --include="*.ts"
grep -r "StorageResolver\|addTorrentInstance\|IndexedDBSessionStore" packages/engine/test --include="*.ts"
grep -r "IndexedDBSessionStore" extension/src --include="*.ts"
```

Fix any remaining imports found.

### Verify

```bash
pnpm build
pnpm test
```

## Task 4: Final Verification

Run the full test suite:

```bash
pnpm test
```

Run Python integration tests:

```bash
cd packages/engine/tests/python
pytest -v
```

Run lint:

```bash
pnpm lint
```

## Summary of Changes

1. **Bug fix**: Uncommented `storageRootManager` in daemon preset and extension client
2. **New tests**: 
   - `tests/unit/memory-session-store.spec.ts`
   - `tests/unit/json-file-session-store.spec.ts`
   - Additional cases in `storage-root-manager.spec.ts`
3. **Removed**:
   - `StorageResolver` interface (deprecated)
   - `storageResolver` option from BtEngineOptions
   - Commented-out `addTorrentInstance` method
   - `IndexedDBSessionStore` (unimplemented stub)
