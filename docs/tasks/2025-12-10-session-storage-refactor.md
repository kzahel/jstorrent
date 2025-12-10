# Session Storage Refactor - Agent Guide

## Overview

Refactor `SessionPersistence` to use a cleaner multi-key storage schema. The current implementation stores entire .torrent files inside the torrent list, causing bloat and inefficient writes.

### New Schema

| Key | Contents | Write Frequency |
|-----|----------|-----------------|
| `session:torrents` | Lightweight index (infoHash, source, magnetUri, addedAt) | Add/remove only |
| `session:torrent:{hash}:state` | userState, storageKey, queuePosition, bitfield, uploaded, downloaded | Per piece (debounced) |
| `session:torrent:{hash}:torrentfile` | Full .torrent file bytes (file source only) | Once on add |
| `session:torrent:{hash}:infodict` | Info dictionary bytes (magnet source only) | Once on metadata received |

---

## Phase 1: Delete Dead Code

### 1.1 Delete SessionManager

Delete `packages/engine/src/core/session-manager.ts` (entire file).

### 1.2 Delete SessionManager Test

Delete `packages/engine/test/core/session-manager.test.ts` (entire file).

### 1.3 Remove SessionManager Export

In `packages/engine/src/index.ts`, find and remove:

```typescript
export { SessionManager } from './core/session-manager'
```

---

## Phase 2: Update Types and Constants

### 2.1 Replace Interfaces in session-persistence.ts

In `packages/engine/src/core/session-persistence.ts`, replace the existing interfaces (lines ~14-44) with:

```typescript
/**
 * Entry in the lightweight torrent index.
 */
export interface TorrentListEntry {
  infoHash: string // Hex string
  source: 'file' | 'magnet'
  magnetUri?: string // Only for magnet source
  addedAt: number // Timestamp when added
}

/**
 * The torrent list index.
 */
export interface TorrentListData {
  version: number
  torrents: TorrentListEntry[]
}

/**
 * Per-torrent mutable state.
 */
export interface TorrentStateData {
  // User state
  userState: TorrentUserState
  storageKey?: string
  queuePosition?: number

  // Progress (absent until metadata received)
  bitfield?: string // Hex-encoded bitfield
  uploaded: number
  downloaded: number
  updatedAt: number
}
```

### 2.2 Update Key Constants

Replace the existing constants with:

```typescript
const TORRENTS_KEY = 'torrents'
const TORRENT_PREFIX = 'torrent:'
const STATE_SUFFIX = ':state'
const TORRENTFILE_SUFFIX = ':torrentfile'
const INFODICT_SUFFIX = ':infodict'

function stateKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${STATE_SUFFIX}`
}

function torrentFileKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${TORRENTFILE_SUFFIX}`
}

function infoDictKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${INFODICT_SUFFIX}`
}
```

---

## Phase 3: Refactor Save Methods

### 3.1 Update saveTorrentList()

Replace the existing `saveTorrentList()` method:

```typescript
/**
 * Save the lightweight torrent index.
 * Only contains identifiers and source info - no large data.
 */
async saveTorrentList(): Promise<void> {
  const data: TorrentListData = {
    version: 2,
    torrents: this.engine.torrents.map((t) => {
      const entry: TorrentListEntry = {
        infoHash: toHex(t.infoHash),
        source: t.magnetLink ? 'magnet' : 'file',
        addedAt: t.addedAt,
      }
      if (t.magnetLink) {
        entry.magnetUri = t.magnetLink
      }
      return entry
    }),
  }

  const json = JSON.stringify(data)
  await this.store.set(TORRENTS_KEY, new TextEncoder().encode(json))
}
```

### 3.2 Update saveTorrentState()

Replace the existing `saveTorrentState()` method:

```typescript
/**
 * Save mutable state for a specific torrent (progress, userState, etc).
 */
async saveTorrentState(torrent: Torrent): Promise<void> {
  const infoHash = toHex(torrent.infoHash)
  const root = this.engine.storageRootManager.getRootForTorrent(infoHash)

  const state: TorrentStateData = {
    userState: torrent.userState,
    storageKey: root?.key,
    queuePosition: torrent.queuePosition,
    bitfield: torrent.bitfield?.toHex(),
    uploaded: torrent.totalUploaded,
    downloaded: torrent.totalDownloaded,
    updatedAt: Date.now(),
  }

  const json = JSON.stringify(state)
  await this.store.set(stateKey(infoHash), new TextEncoder().encode(json))
}
```

### 3.3 Add saveTorrentFile()

Add new method:

```typescript
/**
 * Save the .torrent file bytes. Called once when adding a file-source torrent.
 */
async saveTorrentFile(infoHash: string, torrentFile: Uint8Array): Promise<void> {
  const base64 = toBase64(torrentFile)
  await this.store.set(torrentFileKey(infoHash), new TextEncoder().encode(base64))
}
```

### 3.4 Add saveInfoDict()

Add new method:

```typescript
/**
 * Save the info dictionary bytes. Called once when a magnet torrent receives metadata.
 */
async saveInfoDict(infoHash: string, infoDict: Uint8Array): Promise<void> {
  const base64 = toBase64(infoDict)
  await this.store.set(infoDictKey(infoHash), new TextEncoder().encode(base64))
}
```

---

## Phase 4: Refactor Load Methods

### 4.1 Update loadTorrentList()

Replace the existing method:

```typescript
/**
 * Load the torrent index from storage.
 */
async loadTorrentList(): Promise<TorrentListEntry[]> {
  const data = await this.store.get(TORRENTS_KEY)
  if (!data) return []

  try {
    const json = new TextDecoder().decode(data)
    const parsed: TorrentListData = JSON.parse(json)
    return parsed.torrents || []
  } catch (e) {
    this.logger.error('Failed to parse torrent list:', e)
    return []
  }
}
```

### 4.2 Update loadTorrentState()

Replace the existing method:

```typescript
/**
 * Load mutable state for a specific torrent.
 */
async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
  const data = await this.store.get(stateKey(infoHash))
  if (!data) return null

  try {
    const json = new TextDecoder().decode(data)
    return JSON.parse(json) as TorrentStateData
  } catch (e) {
    this.logger.error(`Failed to parse torrent state for ${infoHash}:`, e)
    return null
  }
}
```

### 4.3 Add loadTorrentFile()

Add new method:

```typescript
/**
 * Load the .torrent file bytes for a file-source torrent.
 */
async loadTorrentFile(infoHash: string): Promise<Uint8Array | null> {
  const data = await this.store.get(torrentFileKey(infoHash))
  if (!data) return null

  try {
    const base64 = new TextDecoder().decode(data)
    return fromBase64(base64)
  } catch (e) {
    this.logger.error(`Failed to load torrent file for ${infoHash}:`, e)
    return null
  }
}
```

### 4.4 Add loadInfoDict()

Add new method:

```typescript
/**
 * Load the info dictionary bytes for a magnet-source torrent.
 */
async loadInfoDict(infoHash: string): Promise<Uint8Array | null> {
  const data = await this.store.get(infoDictKey(infoHash))
  if (!data) return null

  try {
    const base64 = new TextDecoder().decode(data)
    return fromBase64(base64)
  } catch (e) {
    this.logger.error(`Failed to load info dict for ${infoHash}:`, e)
    return null
  }
}
```

---

## Phase 5: Update restoreSession()

Replace the existing `restoreSession()` method:

```typescript
/**
 * Restore all torrents from storage.
 * Call this on engine startup while engine is suspended.
 */
async restoreSession(): Promise<number> {
  const entries = await this.loadTorrentList()
  let restoredCount = 0

  for (const entry of entries) {
    try {
      const state = await this.loadTorrentState(entry.infoHash)
      let torrent: Torrent | null = null

      if (entry.source === 'file') {
        // File-source: load .torrent file
        const torrentFile = await this.loadTorrentFile(entry.infoHash)
        if (!torrentFile) {
          this.logger.error(`Missing torrent file for ${entry.infoHash}, skipping`)
          continue
        }
        torrent = await this.engine.addTorrent(torrentFile, {
          storageKey: state?.storageKey,
          source: 'restore',
          userState: state?.userState ?? 'active',
        })
      } else {
        // Magnet-source: use magnetUri
        if (!entry.magnetUri) {
          this.logger.error(`Missing magnetUri for ${entry.infoHash}, skipping`)
          continue
        }
        torrent = await this.engine.addTorrent(entry.magnetUri, {
          storageKey: state?.storageKey,
          source: 'restore',
          userState: state?.userState ?? 'active',
        })

        // If we have saved infodict, initialize metadata
        if (torrent && !torrent.hasMetadata) {
          const infoDict = await this.loadInfoDict(entry.infoHash)
          if (infoDict) {
            this.logger.debug(`Initializing torrent ${entry.infoHash} from saved infodict`)
            try {
              await initializeTorrentMetadata(this.engine, torrent, infoDict)
            } catch (e) {
              if (e instanceof Error && e.name === 'MissingStorageRootError') {
                torrent.errorMessage = `Download location unavailable. Storage root not found.`
                this.logger.warn(`Torrent ${entry.infoHash} restored with missing storage`)
              } else {
                throw e
              }
            }
          }
        }
      }

      if (torrent) {
        // Restore progress from state
        if (state) {
          if (state.bitfield && torrent.hasMetadata) {
            torrent.restoreBitfieldFromHex(state.bitfield)
          }
          torrent.totalUploaded = state.uploaded
          torrent.totalDownloaded = state.downloaded
          torrent.queuePosition = state.queuePosition
        }

        // Restore addedAt from list entry
        torrent.addedAt = entry.addedAt

        restoredCount++
      }
    } catch (e) {
      this.logger.error(`Failed to restore torrent ${entry.infoHash}:`, e)
    }
  }

  return restoredCount
}
```

---

## Phase 6: Update removeTorrentState()

Replace the existing method:

```typescript
/**
 * Remove all persisted data for a torrent.
 */
async removeTorrentData(infoHash: string): Promise<void> {
  await Promise.all([
    this.store.delete(stateKey(infoHash)),
    this.store.delete(torrentFileKey(infoHash)),
    this.store.delete(infoDictKey(infoHash)),
  ])
}
```

Note: This renames `removeTorrentState` to `removeTorrentData` since it now removes all keys.

---

## Phase 7: Update bt-engine.ts

### 7.1 Update addTorrent() to Save Torrent File

In `packages/engine/src/core/bt-engine.ts`, in the `addTorrent()` method, after the torrent is created and registered, add logic to save the torrent file.

Find the section after `this.torrents.push(torrent)` and before the persistence save. Add:

```typescript
// Save torrent file for file-source torrents (write once)
if (options.source !== 'restore' && input.torrentFileBuffer) {
  await this.sessionPersistence.saveTorrentFile(input.infoHashStr, input.torrentFileBuffer)
}
```

### 7.2 Update Metadata Event Handler to Save InfoDict

In the metadata event handler (around line 307-315), update to save the infodict:

```typescript
// Set up metadata event handler for magnet links
torrent.on('metadata', async (infoBuffer) => {
  try {
    await initializeTorrentMetadata(this, torrent, infoBuffer)
    
    // Save infodict for future restores
    await this.sessionPersistence.saveInfoDict(input.infoHashStr, infoBuffer)
    
    torrent.recheckPeers()
    torrent.emit('ready')
  } catch (err) {
    this.emit('error', err)
  }
})
```

### 7.3 Update removeTorrent() Call

Find the call to `removeTorrentState` and change it to `removeTorrentData`:

```typescript
// Remove persisted data
await this.sessionPersistence.removeTorrentData(infoHash)
```

---

## Phase 8: Update torrent-factory.ts

### 8.1 Expose Raw Torrent File Buffer

In `packages/engine/src/core/torrent-factory.ts`, the `ParsedTorrentInput` interface needs to include the raw buffer for saving.

Update the interface:

```typescript
export interface ParsedTorrentInput {
  infoHash: Uint8Array
  infoHashStr: string
  infoBuffer?: Uint8Array // The info dictionary (for .torrent files)
  torrentFileBuffer?: Uint8Array // The entire .torrent file (for saving)
  parsedTorrent?: ParsedTorrent
  announce: string[]
  magnetLink?: string
  magnetDisplayName?: string
  magnetPeerHints?: Array<{ host: string; port: number }>
  torrentFileBase64?: string
}
```

In the `parseTorrentInput()` function, when handling a Uint8Array (torrent file), store the raw buffer:

```typescript
// For torrent file input
return {
  infoHash: parsedTorrent.infoHash,
  infoHashStr: toHex(parsedTorrent.infoHash),
  infoBuffer,
  torrentFileBuffer: magnetOrBuffer, // Store raw buffer for persistence
  parsedTorrent,
  announce: parsedTorrent.announce,
  torrentFileBase64: toBase64(magnetOrBuffer),
}
```

---

## Phase 9: Create Tests

Create new file `packages/engine/test/core/session-persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionPersistence } from '../../src/core/session-persistence'
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory/memory-socket-factory'
import { InMemoryFileSystem } from '../../src/adapters/memory/in-memory-filesystem'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { toHex, fromHex } from '../../src/utils/buffer'

function createTestEngine(sessionStore: MemorySessionStore): BtEngine {
  const fs = new InMemoryFileSystem()
  const srm = new StorageRootManager(() => fs)
  srm.addRoot({ key: 'default', label: 'Default', path: '/downloads' })
  srm.setDefaultRoot('default')

  return new BtEngine({
    socketFactory: new MemorySocketFactory(),
    storageRootManager: srm,
    sessionStore,
    startSuspended: true,
  })
}

describe('SessionPersistence', () => {
  let store: MemorySessionStore
  let engine: BtEngine
  let persistence: SessionPersistence

  beforeEach(() => {
    store = new MemorySessionStore()
    engine = createTestEngine(store)
    persistence = engine.sessionPersistence
  })

  describe('saveTorrentList / loadTorrentList', () => {
    it('should save and load empty list', async () => {
      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()
      expect(entries).toEqual([])
    })

    it('should save and load file-source entries', async () => {
      // Manually add a torrent to engine for testing
      const infoHash = new Uint8Array(20).fill(0xab)
      const mockTorrent = {
        infoHash,
        magnetLink: undefined,
        addedAt: 1702300000000,
        userState: 'active',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('file')
      expect(entries[0].infoHash).toBe(toHex(infoHash))
      expect(entries[0].addedAt).toBe(1702300000000)
      expect(entries[0].magnetUri).toBeUndefined()
    })

    it('should save and load magnet-source entries', async () => {
      const infoHash = new Uint8Array(20).fill(0xcd)
      const magnetUri = 'magnet:?xt=urn:btih:cdcdcdcd&dn=Test'
      const mockTorrent = {
        infoHash,
        magnetLink: magnetUri,
        addedAt: 1702300001000,
        userState: 'stopped',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('magnet')
      expect(entries[0].magnetUri).toBe(magnetUri)
    })
  })

  describe('saveTorrentState / loadTorrentState', () => {
    it('should save and load state with bitfield', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        queuePosition: 1,
        bitfield: { toHex: () => 'ff00ff' },
        totalUploaded: 1000,
        totalDownloaded: 5000,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.userState).toBe('active')
      expect(state!.bitfield).toBe('ff00ff')
      expect(state!.uploaded).toBe(1000)
      expect(state!.downloaded).toBe(5000)
    })

    it('should save and load state without bitfield', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'stopped' as const,
        queuePosition: undefined,
        bitfield: undefined,
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.bitfield).toBeUndefined()
    })

    it('should return null for unknown torrent', async () => {
      const state = await persistence.loadTorrentState('0000000000000000000000000000000000000000')
      expect(state).toBeNull()
    })
  })

  describe('saveTorrentFile / loadTorrentFile', () => {
    it('should save and load torrent file bytes', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e, 0x6f, 0x75, 0x6e, 0x63, 0x65])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      const loaded = await persistence.loadTorrentFile(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(torrentFile)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadTorrentFile('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('saveInfoDict / loadInfoDict', () => {
    it('should save and load info dict bytes', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const infoDict = new Uint8Array([0x64, 0x34, 0x3a, 0x6e, 0x61, 0x6d, 0x65])

      await persistence.saveInfoDict(infoHash, infoDict)
      const loaded = await persistence.loadInfoDict(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(infoDict)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadInfoDict('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('removeTorrentData', () => {
    it('should delete all keys for a torrent', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([1, 2, 3])
      const infoDict = new Uint8Array([4, 5, 6])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      await persistence.saveInfoDict(infoHash, infoDict)
      
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        bitfield: { toHex: () => 'ff' },
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      // Verify data exists
      expect(await persistence.loadTorrentFile(infoHash)).not.toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).not.toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).not.toBeNull()

      // Remove all
      await persistence.removeTorrentData(infoHash)

      // Verify all gone
      expect(await persistence.loadTorrentFile(infoHash)).toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).toBeNull()
    })
  })
})
```

---

## Phase 10: Verification

Run from monorepo root:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:fix
```

All tests should pass. The new `session-persistence.test.ts` tests should be discovered and run.

---

## Summary of Changes

| File | Action |
|------|--------|
| `packages/engine/src/core/session-persistence.ts` | Major refactor - new schema |
| `packages/engine/src/core/bt-engine.ts` | Update addTorrent, removeTorrent |
| `packages/engine/src/core/torrent-factory.ts` | Expose torrentFileBuffer |
| `packages/engine/src/core/session-manager.ts` | Delete |
| `packages/engine/src/index.ts` | Remove SessionManager export |
| `packages/engine/test/core/session-manager.test.ts` | Delete |
| `packages/engine/test/core/session-persistence.test.ts` | Create |
