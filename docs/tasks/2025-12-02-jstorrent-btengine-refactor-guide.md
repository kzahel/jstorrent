# BtEngine Refactoring Guide

## Overview

Refactor `bt-engine.ts` to separate concerns, eliminate code duplication, and fix the peer hints bug. The current 517-line file mixes parsing, creation, initialization, and lifecycle management into one monolithic `addTorrent` method.

**Goals:**
1. Extract input parsing to `torrent-factory.ts`
2. Extract metadata initialization to `torrent-initializer.ts`
3. Move base64 utilities to `utils/buffer.ts`
4. Fix peer hints bug - store on Torrent so they're used on every start
5. Simplify `addTorrent` to ~50 lines of orchestration

**Current problems:**
- `addTorrent` is 170 lines doing parsing, creation, initialization, events
- `initTorrentFromSavedMetadata` duplicates 45 lines from `addTorrent`
- `uint8ArrayToBase64` duplicated in BtEngine and SessionPersistence
- Peer hints stored in local variable, lost after first start
- Hard to reason about "when torrent starts, do X"

---

## File Changes Summary

**Create:**
- `packages/engine/src/core/torrent-factory.ts`
- `packages/engine/src/core/torrent-initializer.ts`

**Modify:**
- `packages/engine/src/utils/buffer.ts` - add base64 utilities
- `packages/engine/src/core/torrent.ts` - add `magnetPeerHints` property, use in `start()`
- `packages/engine/src/core/bt-engine.ts` - slim down, use new modules
- `packages/engine/src/core/session-persistence.ts` - use shared base64 utilities

**Delete:**
- Nothing - just refactoring

---

## Phase 1: Add Base64 Utilities

### 1.1 Update packages/engine/src/utils/buffer.ts

Add these functions at the end of the file:

```ts
/**
 * Convert Uint8Array to base64 string.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to Uint8Array.
 */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
```

---

## Phase 2: Create Torrent Factory

### 2.1 Create packages/engine/src/core/torrent-factory.ts

```ts
import { IHasher } from '../interfaces/hasher'
import { parseMagnet } from '../utils/magnet'
import { TorrentParser, ParsedTorrent } from './torrent-parser'
import { fromHex, toBase64 } from '../utils/buffer'
import type { PeerAddress } from './swarm'

/**
 * Result of parsing a magnet link or torrent file.
 * Contains all the information needed to create a Torrent instance.
 */
export interface ParsedTorrentInput {
  infoHash: Uint8Array
  infoHashStr: string
  announce: string[]

  // Origin info (one of these will be set)
  magnetLink?: string
  torrentFileBase64?: string

  // From magnet link
  magnetDisplayName?: string
  magnetPeerHints?: PeerAddress[]

  // From torrent file (has metadata)
  infoBuffer?: Uint8Array
  parsedTorrent?: ParsedTorrent
}

/**
 * Parse a magnet link or torrent file buffer into a structured format.
 * This extracts all information without creating any Torrent objects.
 */
export async function parseTorrentInput(
  magnetOrBuffer: string | Uint8Array,
  hasher: IHasher,
): Promise<ParsedTorrentInput> {
  if (typeof magnetOrBuffer === 'string') {
    // Parse magnet link
    const parsed = parseMagnet(magnetOrBuffer)
    const infoHash = fromHex(parsed.infoHash)

    return {
      infoHash,
      infoHashStr: parsed.infoHash,
      announce: parsed.announce || [],
      magnetLink: magnetOrBuffer,
      magnetDisplayName: parsed.name,
      magnetPeerHints: parsed.peers,
    }
  } else {
    // Parse torrent file
    const parsedTorrent = await TorrentParser.parse(magnetOrBuffer, hasher)
    const infoHashStr = Array.from(parsedTorrent.infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return {
      infoHash: parsedTorrent.infoHash,
      infoHashStr,
      announce: parsedTorrent.announce,
      torrentFileBase64: toBase64(magnetOrBuffer),
      infoBuffer: parsedTorrent.infoBuffer,
      parsedTorrent,
    }
  }
}
```

---

## Phase 3: Create Torrent Initializer

### 3.1 Create packages/engine/src/core/torrent-initializer.ts

```ts
import { BtEngine, MAX_PIECE_SIZE } from './bt-engine'
import { Torrent } from './torrent'
import { TorrentParser, ParsedTorrent } from './torrent-parser'
import { TorrentContentStorage } from './torrent-content-storage'
import { IStorageHandle } from '../io/storage-handle'
import { toHex } from '../utils/buffer'

/**
 * Initialize a torrent with metadata (info dictionary).
 *
 * This handles:
 * - Parsing the info buffer (if not already parsed)
 * - Validating piece size limits
 * - Initializing bitfield and piece info
 * - Creating content storage
 *
 * Used by:
 * - addTorrent() when adding a .torrent file (has metadata immediately)
 * - metadata event handler when magnet link receives metadata from peers
 * - session restore when we have saved metadata
 */
export async function initializeTorrentMetadata(
  engine: BtEngine,
  torrent: Torrent,
  infoBuffer: Uint8Array,
  preParsed?: ParsedTorrent,
): Promise<void> {
  if (torrent.hasMetadata) {
    return // Already initialized
  }

  const infoHashStr = toHex(torrent.infoHash)

  // Parse if not already parsed
  const parsedTorrent = preParsed || (await TorrentParser.parseInfoBuffer(infoBuffer, engine.hasher))

  // Validate piece size
  if (parsedTorrent.pieceLength > MAX_PIECE_SIZE) {
    const sizeMB = (parsedTorrent.pieceLength / (1024 * 1024)).toFixed(1)
    const maxMB = (MAX_PIECE_SIZE / (1024 * 1024)).toFixed(0)
    const error = new Error(
      `Torrent piece size (${sizeMB}MB) exceeds maximum supported size (${maxMB}MB)`,
    )
    torrent.emit('error', error)
    engine.emit('error', error)
    throw error
  }

  // Set metadata on torrent
  torrent.setMetadata(infoBuffer)

  // Initialize bitfield (torrent owns the bitfield)
  torrent.initBitfield(parsedTorrent.pieces.length)

  // Initialize piece info
  const lastPieceLength =
    parsedTorrent.length % parsedTorrent.pieceLength || parsedTorrent.pieceLength
  torrent.initPieceInfo(parsedTorrent.pieces, parsedTorrent.pieceLength, lastPieceLength)

  // Restore bitfield from saved state if available
  const savedState = await engine.sessionPersistence.loadTorrentState(infoHashStr)
  if (savedState?.bitfield) {
    torrent.restoreBitfieldFromHex(savedState.bitfield)
  }

  // Initialize content storage
  const storageHandle: IStorageHandle = {
    id: infoHashStr,
    name: parsedTorrent.name || infoHashStr,
    getFileSystem: () => engine.storageRootManager.getFileSystemForTorrent(infoHashStr),
  }

  const contentStorage = new TorrentContentStorage(engine, storageHandle)
  await contentStorage.open(parsedTorrent.files, parsedTorrent.pieceLength)
  torrent.contentStorage = contentStorage
}
```

---

## Phase 4: Add Peer Hints to Torrent

### 4.1 Update packages/engine/src/core/torrent.ts

Find the class properties section (near the top of the class) and add:

```ts
/**
 * Peer hints from magnet link (x.pe parameter).
 * These are added to the swarm every time the torrent starts.
 */
public magnetPeerHints: PeerAddress[] = []
```

You'll need to import PeerAddress if not already imported:

```ts
import type { PeerAddress } from './swarm'
```

### 4.2 Update the start() method in torrent.ts

Find the `start()` or `userStart()` method. At the end of the start logic (after swarm is active), add:

```ts
// Add magnet peer hints on every start
if (this.magnetPeerHints.length > 0) {
  this.addPeerHints(this.magnetPeerHints)
}
```

If there's a `resumeNetwork()` method that's called on resume, add it there too:

```ts
// In resumeNetwork() - also add peer hints when resuming
if (this.magnetPeerHints.length > 0) {
  this.addPeerHints(this.magnetPeerHints)
}
```

---

## Phase 5: Refactor BtEngine

### 5.1 Update imports in packages/engine/src/core/bt-engine.ts

Replace the existing imports section with:

```ts
import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { randomBytes } from '../utils/hash'
import { fromString, concat, toHex } from '../utils/buffer'
import {
  ILoggingEngine,
  Logger,
  EngineLoggingConfig,
  createFilter,
  randomClientId,
  withScopeAndFiltering,
  ShouldLogFn,
  ILoggableComponent,
  LogEntry,
  globalLogStore,
} from '../logging/logger'

import { ISessionStore } from '../interfaces/session-store'
import { IHasher } from '../interfaces/hasher'
import { SubtleCryptoHasher } from '../adapters/browser/subtle-crypto-hasher'
import { MemorySessionStore } from '../adapters/memory/memory-session-store'
import { StorageRootManager } from '../storage/storage-root-manager'
import { SessionPersistence } from './session-persistence'
import { Torrent } from './torrent'
import { PeerConnection } from './peer-connection'
import { TorrentUserState } from './torrent-state'

// New imports for refactored code
import { parseTorrentInput } from './torrent-factory'
import { initializeTorrentMetadata } from './torrent-initializer'
```

### 5.2 Replace the addTorrent method

Replace the entire `addTorrent` method (approximately lines 232-401) with:

```ts
async addTorrent(
  magnetOrBuffer: string | Uint8Array,
  options: {
    storageKey?: string
    /** Whether this torrent is being restored from session or added by user action. Default: 'user' */
    source?: 'user' | 'restore'
    userState?: TorrentUserState
  } = {},
): Promise<Torrent | null> {
  // Parse the input (magnet link or torrent file)
  const input = await parseTorrentInput(magnetOrBuffer, this.hasher)

  // Check for existing torrent
  const existing = this.getTorrent(input.infoHashStr)
  if (existing) {
    return existing
  }

  // Register storage root for this torrent if provided
  if (options.storageKey) {
    this.storageRootManager.setRootForTorrent(input.infoHashStr, options.storageKey)
  }

  // Create the torrent instance
  const torrent = new Torrent(
    this,
    input.infoHash,
    this.peerId,
    this.socketFactory,
    this.port,
    undefined, // contentStorage - initialized later with metadata
    input.announce,
    this.maxPeers,
    () => this.numConnections < this.maxConnections,
  )

  // Store magnet display name for fallback naming
  if (input.magnetDisplayName) {
    torrent._magnetDisplayName = input.magnetDisplayName
  }

  // Store magnet peer hints for use on every start
  if (input.magnetPeerHints && input.magnetPeerHints.length > 0) {
    torrent.magnetPeerHints = input.magnetPeerHints
  }

  // Store origin info for persistence
  if (input.magnetLink) {
    torrent.initFromMagnet(input.magnetLink)
  } else if (input.torrentFileBase64) {
    torrent.initFromTorrentFile(input.torrentFileBase64)
  }

  // Set initial user state
  torrent.userState = options.userState ?? 'active'

  // Initialize metadata if we have it (torrent file case)
  if (input.infoBuffer && input.parsedTorrent) {
    await initializeTorrentMetadata(this, torrent, input.infoBuffer, input.parsedTorrent)
  }

  // Set up metadata event handler for magnet links
  torrent.on('metadata', async (infoBuffer) => {
    try {
      await initializeTorrentMetadata(this, torrent, infoBuffer)
      torrent.recheckPeers()
      torrent.emit('ready')
    } catch (err) {
      this.emit('error', err)
    }
  })

  // Register torrent
  this.torrents.push(torrent)
  this.emit('torrent', torrent)

  // Set up event forwarding
  torrent.on('complete', () => {
    this.emit('torrent-complete', torrent)
  })

  torrent.on('error', (err) => {
    this.emit('error', err)
  })

  // Start if engine not suspended AND user wants it active
  if (!this._suspended && torrent.userState === 'active') {
    await torrent.start()
    // Note: peer hints are now added inside torrent.start()
  }

  // Persist torrent list (unless restoring from session)
  if (options.source !== 'restore') {
    await this.sessionPersistence.saveTorrentList()
  }

  return torrent
}
```

### 5.3 Delete initTorrentFromSavedMetadata method

Delete the entire `initTorrentFromSavedMetadata` method (approximately lines 429-475). This functionality is now handled by `initializeTorrentMetadata`.

### 5.4 Delete the private uint8ArrayToBase64 method

Delete the `uint8ArrayToBase64` method at the end of the class (approximately lines 509-515). This is now in `utils/buffer.ts`.

---

## Phase 6: Update Session Persistence

### 6.1 Update imports in packages/engine/src/core/session-persistence.ts

Add the base64 import:

```ts
import { toHex, toBase64, fromBase64 } from '../utils/buffer'
```

### 6.2 Replace uint8ArrayToBase64 usage

Find and replace:
```ts
state.infoBuffer = this.uint8ArrayToBase64(persistedState.infoBuffer)
```

With:
```ts
state.infoBuffer = toBase64(persistedState.infoBuffer)
```

### 6.3 Replace base64ToUint8Array usage

Find all calls to `this.base64ToUint8Array(...)` and replace with `fromBase64(...)`:

```ts
// Before:
const buffer = this.base64ToUint8Array(data.torrentFile)
persistedState.infoBuffer = this.base64ToUint8Array(state.infoBuffer)

// After:
const buffer = fromBase64(data.torrentFile)
persistedState.infoBuffer = fromBase64(state.infoBuffer)
```

### 6.4 Delete the private methods

Delete both private methods from SessionPersistence:
- `uint8ArrayToBase64` (approximately lines 110-116)
- `base64ToUint8Array` (approximately lines 306-312)

### 6.5 Update restoreSession to use initializeTorrentMetadata

In the `restoreSession` method, replace the call to `this.engine.initTorrentFromSavedMetadata`:

```ts
// Before:
if (persistedState.infoBuffer && !torrent.hasMetadata) {
  this.logger.debug(`Initializing torrent ${data.infoHash} from saved metadata`)
  await this.engine.initTorrentFromSavedMetadata(torrent, persistedState.infoBuffer)
}

// After:
if (persistedState.infoBuffer && !torrent.hasMetadata) {
  this.logger.debug(`Initializing torrent ${data.infoHash} from saved metadata`)
  const { initializeTorrentMetadata } = await import('./torrent-initializer')
  await initializeTorrentMetadata(this.engine, torrent, persistedState.infoBuffer)
}
```

Alternatively, add the import at the top of the file:
```ts
import { initializeTorrentMetadata } from './torrent-initializer'
```

And use it directly:
```ts
await initializeTorrentMetadata(this.engine, torrent, persistedState.infoBuffer)
```

---

## Phase 7: Update Exports

### 7.1 Update packages/engine/src/index.ts

Add exports for the new modules:

```ts
// Torrent factory and initialization
export { parseTorrentInput } from './core/torrent-factory'
export type { ParsedTorrentInput } from './core/torrent-factory'
export { initializeTorrentMetadata } from './core/torrent-initializer'

// Buffer utilities (if not already exported)
export { toBase64, fromBase64 } from './utils/buffer'
```

---

## Phase 8: Verification

### 8.1 Type checking

```bash
cd packages/engine
pnpm typecheck
```

Fix any type errors that arise.

### 8.2 Run tests

```bash
cd packages/engine
pnpm test
```

### 8.3 Manual testing

```bash
cd extension
pnpm dev:web
```

Test the following scenarios:

**1. Add torrent from magnet link with peer hints:**
```
magnet:?xt=urn:btih:...&x.pe=192.168.1.100:6881
```
- Verify peer is added on initial start
- Stop the torrent, then start again
- Verify peer is added again (this was broken before)

**2. Add torrent from .torrent file:**
- Should work as before
- Verify download starts

**3. Session restore:**
- Add a torrent, let it download partially
- Reload the page
- Verify torrent is restored with correct progress
- Verify peer hints still work after restore

**4. Reset torrent (remove + re-add stopped):**
- Add a magnet with peer hints
- Use "Reset State" action
- Start the torrent
- Verify peer hints are still used

---

## Checklist

### Phase 1: Base64 Utilities
- [ ] Add `toBase64()` to utils/buffer.ts
- [ ] Add `fromBase64()` to utils/buffer.ts

### Phase 2: Torrent Factory
- [ ] Create torrent-factory.ts
- [ ] Implement `ParsedTorrentInput` interface
- [ ] Implement `parseTorrentInput()` function

### Phase 3: Torrent Initializer
- [ ] Create torrent-initializer.ts
- [ ] Implement `initializeTorrentMetadata()` function

### Phase 4: Peer Hints on Torrent
- [ ] Add `magnetPeerHints` property to Torrent class
- [ ] Add peer hints in `start()` method
- [ ] Add peer hints in `resumeNetwork()` method (if exists)

### Phase 5: Refactor BtEngine
- [ ] Update imports
- [ ] Replace `addTorrent()` with simplified version
- [ ] Delete `initTorrentFromSavedMetadata()`
- [ ] Delete `uint8ArrayToBase64()`

### Phase 6: Update Session Persistence
- [ ] Update imports to use buffer utilities
- [ ] Replace `uint8ArrayToBase64` calls with `toBase64`
- [ ] Replace `base64ToUint8Array` calls with `fromBase64`
- [ ] Delete private base64 methods
- [ ] Update `restoreSession` to use `initializeTorrentMetadata`

### Phase 7: Exports
- [ ] Export new modules from index.ts

### Phase 8: Verification
- [ ] Type checking passes
- [ ] Tests pass
- [ ] Manual testing: magnet with peer hints
- [ ] Manual testing: torrent file
- [ ] Manual testing: session restore
- [ ] Manual testing: reset torrent

---

## Architecture After Refactoring

```
packages/engine/src/
├── core/
│   ├── bt-engine.ts           (~350 lines, down from 517)
│   │   └── Orchestrates lifecycle, delegates to specialized modules
│   │
│   ├── torrent-factory.ts     (~60 lines, NEW)
│   │   └── parseTorrentInput() - parse magnet or torrent file
│   │
│   ├── torrent-initializer.ts (~70 lines, NEW)
│   │   └── initializeTorrentMetadata() - shared init logic
│   │
│   ├── session-persistence.ts (unchanged structure, cleaner)
│   │   └── Uses shared base64 utilities
│   │
│   └── torrent.ts             (+15 lines)
│       └── magnetPeerHints property, used in start()
│
└── utils/
    └── buffer.ts              (+20 lines)
        └── toBase64(), fromBase64()
```

**Benefits:**
1. `addTorrent()` is now ~70 lines of clear orchestration
2. No duplicated metadata initialization logic
3. No duplicated base64 utilities
4. Peer hints work on every start (bug fixed)
5. Easy to reason about "when torrent starts" - just look at `start()`
6. Testable units - can test parsing, initialization, and lifecycle separately
