# Implement Session Persistence with ISessionStore

## Overview

The `ISessionStore` interface and `ChromeStorageSessionStore` exist but are unused. We need to:

1. Save torrent list when torrents are added/removed
2. Save bitfield progress when pieces verify
3. Load and restore torrents on engine startup

## Data Model

Store these keys in the session store:

```
session:torrents           -> JSON list of torrent metadata
session:torrent:<infohash> -> Per-torrent state (bitfield, etc.)
```

## Task 1: Create TorrentSessionData Types

**Create file**: `packages/engine/src/core/session-persistence.ts`

```typescript
import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { toHex, fromHex } from '../utils/buffer'

const TORRENTS_KEY = 'torrents'
const TORRENT_PREFIX = 'torrent:'

/**
 * Metadata for a single torrent, persisted to session store.
 */
export interface TorrentSessionData {
  infoHash: string           // Hex string
  magnetLink?: string        // Original magnet link if added via magnet
  torrentFile?: string       // Base64 encoded .torrent file if added via file
  name?: string              // Torrent name (from metadata)
  storageToken?: string      // Which download root to use
  addedAt: number            // Timestamp when added
}

/**
 * Per-torrent state that changes during download.
 */
export interface TorrentStateData {
  bitfield: string           // Hex-encoded bitfield
  uploaded: number           // Total bytes uploaded
  downloaded: number         // Total bytes downloaded (verified)
  updatedAt: number          // Last update timestamp
}

/**
 * List of all torrents.
 */
export interface TorrentListData {
  version: number
  torrents: TorrentSessionData[]
}

/**
 * Handles persisting and restoring torrent session state.
 */
export class SessionPersistence {
  constructor(
    private store: ISessionStore,
    private engine: BtEngine
  ) {}

  /**
   * Save the current list of torrents.
   */
  async saveTorrentList(): Promise<void> {
    const data: TorrentListData = {
      version: 1,
      torrents: this.engine.torrents.map(t => this.torrentToSessionData(t))
    }
    
    const json = JSON.stringify(data)
    await this.store.set(TORRENTS_KEY, new TextEncoder().encode(json))
  }

  /**
   * Save state for a specific torrent (bitfield, stats).
   */
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)
    const bitfield = torrent.pieceManager?.getBitField()
    
    if (!bitfield) return // No piece manager yet
    
    const state: TorrentStateData = {
      bitfield: bitfield.toHex(),
      uploaded: 0,    // TODO: track actual uploaded
      downloaded: 0,  // TODO: track actual downloaded
      updatedAt: Date.now()
    }
    
    const json = JSON.stringify(state)
    await this.store.set(
      TORRENT_PREFIX + infoHash, 
      new TextEncoder().encode(json)
    )
  }

  /**
   * Load the list of torrents from storage.
   */
  async loadTorrentList(): Promise<TorrentSessionData[]> {
    const data = await this.store.get(TORRENTS_KEY)
    if (!data) return []
    
    try {
      const json = new TextDecoder().decode(data)
      const parsed: TorrentListData = JSON.parse(json)
      return parsed.torrents || []
    } catch (e) {
      console.error('Failed to parse torrent list:', e)
      return []
    }
  }

  /**
   * Load state for a specific torrent.
   */
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    const data = await this.store.get(TORRENT_PREFIX + infoHash)
    if (!data) return null
    
    try {
      const json = new TextDecoder().decode(data)
      return JSON.parse(json) as TorrentStateData
    } catch (e) {
      console.error(`Failed to parse torrent state for ${infoHash}:`, e)
      return null
    }
  }

  /**
   * Remove state for a torrent.
   */
  async removeTorrentState(infoHash: string): Promise<void> {
    await this.store.delete(TORRENT_PREFIX + infoHash)
  }

  /**
   * Restore all torrents from storage.
   * Call this on engine startup.
   */
  async restoreSession(): Promise<number> {
    const torrents = await this.loadTorrentList()
    let restored = 0
    
    for (const data of torrents) {
      try {
        // Re-add the torrent
        let torrent: Torrent | null = null
        
        if (data.magnetLink) {
          torrent = await this.engine.addTorrent(data.magnetLink, {
            storageToken: data.storageToken
          })
        } else if (data.torrentFile) {
          // Decode base64 torrent file
          const buffer = this.base64ToUint8Array(data.torrentFile)
          torrent = await this.engine.addTorrent(buffer, {
            storageToken: data.storageToken
          })
        }
        
        if (torrent) {
          // Load saved state (bitfield)
          const state = await this.loadTorrentState(data.infoHash)
          if (state && torrent.pieceManager) {
            // Restore bitfield
            torrent.pieceManager.restoreFromHex(state.bitfield)
          }
          restored++
        }
      } catch (e) {
        console.error(`Failed to restore torrent ${data.infoHash}:`, e)
      }
    }
    
    return restored
  }

  private torrentToSessionData(torrent: Torrent): TorrentSessionData {
    const infoHash = toHex(torrent.infoHash)
    
    // Get storage token for this torrent
    const storageToken = this.engine.storageRootManager.getRootForTorrent(infoHash)
    
    return {
      infoHash,
      magnetLink: torrent.magnetLink,
      torrentFile: torrent.torrentFileBase64,
      name: torrent.name,
      storageToken,
      addedAt: torrent.addedAt || Date.now()
    }
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
```

## Task 2: Add Properties to Torrent Class

**Update file**: `packages/engine/src/core/torrent.ts`

Add these properties to track origin and timestamp:

```typescript
export class Torrent extends EngineComponent {
  // ... existing properties ...
  
  // For session persistence
  public magnetLink?: string           // Original magnet if added via magnet
  public torrentFileBase64?: string    // Base64 .torrent file if added via file
  public addedAt: number = Date.now()
  
  // ... rest of class
}
```

## Task 3: Add restoreFromHex to PieceManager

**Update file**: `packages/engine/src/core/piece-manager.ts`

Add method to restore bitfield from saved hex:

```typescript
/**
 * Restore bitfield from hex string (for session restore).
 */
restoreFromHex(hex: string): void {
  this.bitfield = BitField.fromHex(hex, this.piecesCount)
  
  // Update completed count and piece states
  this.completedPieces = 0
  for (let i = 0; i < this.piecesCount; i++) {
    if (this.bitfield.get(i)) {
      this.completedPieces++
      // Mark all blocks as received for this piece
      const piece = this.pieces[i]
      for (let j = 0; j < piece.blocksCount; j++) {
        piece.setBlock(j, true)
      }
    }
  }
}
```

Also add `fromHex` static method to BitField if not present:

**Update file**: `packages/engine/src/utils/bitfield.ts`

```typescript
static fromHex(hex: string, length: number): BitField {
  const bf = new BitField(length)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  bf.buffer = bytes
  return bf
}
```

## Task 4: Add getRootForTorrent to StorageRootManager

**Update file**: `packages/engine/src/storage/storage-root-manager.ts`

Add method to get assigned root for a torrent:

```typescript
/**
 * Get the storage root token assigned to a torrent.
 * Returns the default root token if none specifically assigned.
 */
getRootForTorrent(infoHash: string): string | undefined {
  const normalized = infoHash.toLowerCase()
  return this.torrentRoots.get(normalized) || this.defaultRoot
}
```

## Task 5: Integrate SessionPersistence into BtEngine

**Update file**: `packages/engine/src/core/bt-engine.ts`

Add imports:
```typescript
import { SessionPersistence } from './session-persistence'
```

Add property:
```typescript
public sessionPersistence?: SessionPersistence
```

In constructor, create SessionPersistence:
```typescript
this.sessionPersistence = new SessionPersistence(this.sessionStore, this)
```

Update `addTorrent` to save the list after adding:
```typescript
async addTorrent(...) {
  // ... existing code to create torrent ...
  
  this.torrents.push(torrent)
  
  // Persist torrent list
  await this.sessionPersistence?.saveTorrentList()
  
  return torrent
}
```

Update `removeTorrent` to save after removing:
```typescript
async removeTorrent(torrent: Torrent) {
  const index = this.torrents.indexOf(torrent)
  if (index !== -1) {
    this.torrents.splice(index, 1)
    const infoHash = toHex(torrent.infoHash)
    
    // Remove persisted state
    await this.sessionPersistence?.removeTorrentState(infoHash)
    await this.sessionPersistence?.saveTorrentList()
  }
  await torrent.stop()
}
```

Store original magnet/torrent file in addTorrent:
```typescript
async addTorrent(magnetOrBuffer: string | Uint8Array, ...) {
  // ... after creating torrent ...
  
  if (typeof magnetOrBuffer === 'string') {
    torrent.magnetLink = magnetOrBuffer
  } else {
    // Store base64 encoded torrent file
    torrent.torrentFileBase64 = this.uint8ArrayToBase64(magnetOrBuffer)
  }
  
  // ... rest of method
}

private uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
```

## Task 6: Save Bitfield on Piece Verification

**Update file**: `packages/engine/src/core/torrent.ts`

In the piece verification handler (where 'verified' event is emitted), also trigger persistence:

```typescript
// After piece is verified and marked
this.emit('verified', { bitfield: this.bitfield?.toHex() })

// Persist state (debounced - see Task 7)
this.engine.sessionPersistence?.saveTorrentState(this)
```

## Task 7: Debounce State Saves

To avoid excessive writes on fast downloads, debounce the state saves.

**Update file**: `packages/engine/src/core/session-persistence.ts`

Add debouncing:

```typescript
export class SessionPersistence {
  private saveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly DEBOUNCE_MS = 2000  // Save at most every 2 seconds per torrent
  
  // ... existing code ...
  
  /**
   * Save state for a torrent, debounced.
   */
  saveTorrentStateDebounced(torrent: Torrent): void {
    const infoHash = toHex(torrent.infoHash)
    
    // Clear existing timer
    const existing = this.saveTimers.get(infoHash)
    if (existing) {
      clearTimeout(existing)
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      this.saveTorrentState(torrent)
      this.saveTimers.delete(infoHash)
    }, this.DEBOUNCE_MS)
    
    this.saveTimers.set(infoHash, timer)
  }
  
  /**
   * Flush all pending saves immediately.
   * Call this on shutdown.
   */
  async flushPendingSaves(): Promise<void> {
    for (const [infoHash, timer] of this.saveTimers) {
      clearTimeout(timer)
    }
    this.saveTimers.clear()
    
    // Save all torrents
    for (const torrent of this.engine.torrents) {
      await this.saveTorrentState(torrent)
    }
  }
}
```

Then in torrent.ts, use the debounced version:
```typescript
this.engine.sessionPersistence?.saveTorrentStateDebounced(this)
```

## Task 8: Add Restore Method to BtEngine

**Update file**: `packages/engine/src/core/bt-engine.ts`

Add method to restore session on startup:

```typescript
/**
 * Restore torrents from session storage.
 * Call this after engine is initialized.
 */
async restoreSession(): Promise<number> {
  if (!this.sessionPersistence) return 0
  
  this.logger.info('Restoring session...')
  const count = await this.sessionPersistence.restoreSession()
  this.logger.info(`Restored ${count} torrents`)
  return count
}
```

## Task 9: Update Extension Client to Restore on Startup

**Update file**: `extension/src/lib/client.ts`

After creating the engine, restore the session:

```typescript
this.engine = new BtEngine({
  socketFactory: factory,
  storageRootManager: srm,
  sessionStore: store,
  onLog: (entry: LogEntry) => {
    this.logBuffer.add(entry)
  },
})

// Restore previous session
const restored = await this.engine.restoreSession()
console.log(`Restored ${restored} torrents from session`)
```

## Task 10: Export SessionPersistence

**Update file**: `packages/engine/src/index.ts`

```typescript
export { SessionPersistence } from './core/session-persistence'
export type { TorrentSessionData, TorrentStateData } from './core/session-persistence'
```

## Task 11: Update ChromeStorageSessionStore with Prefix

As mentioned in the previous task, add prefix support to avoid conflicts:

**Update file**: `packages/engine/src/adapters/browser/chrome-storage-session-store.ts`

(See previous task for full implementation)

**Update file**: `extension/src/lib/client.ts`

```typescript
const store = new ChromeStorageSessionStore(chrome.storage.local, 'jstorrent:')
```

## Verification

```bash
# Build engine
cd packages/engine
pnpm build
pnpm test

# Build extension
cd ../../extension
pnpm build
```

Manual test:
1. Load extension, add a torrent via magnet
2. Let it download a few pieces
3. Check chrome.storage.local in DevTools - should see `jstorrent:torrents` and `jstorrent:torrent:<hash>`
4. Close Chrome completely
5. Reopen Chrome, open extension
6. Torrent should reappear with progress intact

## Summary

**New files:**
- `packages/engine/src/core/session-persistence.ts` - Main persistence logic

**Updated files:**
- `packages/engine/src/core/bt-engine.ts` - Create SessionPersistence, wire up save/restore
- `packages/engine/src/core/torrent.ts` - Add magnetLink, torrentFileBase64, addedAt properties
- `packages/engine/src/core/piece-manager.ts` - Add restoreFromHex method
- `packages/engine/src/utils/bitfield.ts` - Add fromHex static method
- `packages/engine/src/storage/storage-root-manager.ts` - Add getRootForTorrent method
- `packages/engine/src/index.ts` - Export new types
- `extension/src/lib/client.ts` - Use ChromeStorageSessionStore, call restoreSession

**What gets persisted:**
- List of torrents (magnet link or .torrent file, storage root)
- Per-torrent bitfield (which pieces are complete)
- Debounced to avoid excessive writes during fast downloads
