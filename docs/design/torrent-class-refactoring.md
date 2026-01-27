# Torrent Class Refactoring Analysis

**Date**: 2026-01-27
**File**: `packages/engine/src/core/torrent.ts`
**Current Size**: ~3,938 lines

## Executive Summary

The `Torrent` class has grown to nearly 4,000 lines and handles 12+ distinct responsibilities. This document analyzes the current structure, identifies extraction candidates, and recommends a phased approach to decomposition.

**Key finding**: Many apparent extraction targets (like `setupPeerListeners`) are actually thin dispatch layers with heavy coupling to Torrent state. The best extraction candidates are those with **clear input/output boundaries** rather than the largest code blocks.

---

## Current State Analysis

### Responsibility Breakdown

| Responsibility | ~Lines | Key Methods | Coupling |
|----------------|--------|-------------|----------|
| **Peer Connection Lifecycle** | 500 | `addPeer()`, `removePeer()`, `setupPeerListeners()` | Very High |
| **Piece Selection & Requesting** | 400 | `requestPieces()`, `requestTick()` | High |
| **Block Handling & Finalization** | 300 | `handleBlock()`, `finalizePiece()`, `handleHashMismatch()` | High |
| **File Priority System** | 400 | `setFilePriority()`, `recomputePieceClassification()` | Medium |
| **Upload Management** | 200 | `handleRequest()`, `drainUploadQueue()` | Medium |
| **Network Lifecycle** | 300 | `start()`, `stopNetwork()`, `runMaintenance()` | High |
| **Peer Discovery** | 200 | DHT lookup, tracker init, PEX handling | Medium |
| **Metadata (BEP 9)** | 200 | `handleMetadataData()`, `verifyPeerMetadata()` | Low |
| **Choke/Unchoke Algorithm** | 200 | `applyUnchokeDecision()`, `tryQuickUnchoke()` | Medium |
| **State & Persistence** | 200 | `getPersistedState()`, `restorePersistedState()` | Low |
| **Data Checking** | 150 | `recheckData()`, `verifyPiece()` | Medium |
| **UI/Debug APIs** | 150 | `getPeerInfo()`, `getDisplayPeers()`, stats getters | Low |

### The `setupPeerListeners()` Problem

At ~280 lines, `setupPeerListeners()` looks like a prime extraction target. However, analysis reveals it's mostly **dispatch glue**:

```typescript
peer.on('bitfield', (bf) => {
  // Writes to: this._pieceAvailability, this._seedCount
  // Calls: this.updateInterest()
})

peer.on('have', (index) => {
  // Writes to: this._pieceAvailability
  // Calls: this.convertToSeed(), this.updateInterest()
})

peer.on('handshake', (...) => {
  // Reads: this.peerId, this.isComplete, this.metadataSize
  // Writes to: this._swarm
  // Calls: peer.sendExtendedHandshake(), this.getAdvertisedBitfield()
})

peer.on('message', (msg) => {
  // Routes to: this.handleBlock()
})
```

Extracting this would require passing nearly the entire Torrent interface:

```typescript
interface TorrentPeerContext {
  // Identity
  peerId: Uint8Array
  infoHash: Uint8Array

  // State queries (read-only)
  isComplete: boolean
  isPrivate: boolean
  hasMetadata: boolean
  piecesCount: number
  metadataSize: number | null
  metadataComplete: boolean

  // Mutable state (problematic - need write access)
  _pieceAvailability: Uint16Array | null
  _seedCount: number
  peerMetadataBuffers: Map<PeerConnection, (Uint8Array | null)[]>

  // Methods to call
  updateInterest(peer: PeerConnection): void
  handleBlock(peer: PeerConnection, msg: WireMessage): void
  handleRequest(peer: PeerConnection, ...): void
  handleInterested(peer: PeerConnection): void
  handleMetadataRequest(peer: PeerConnection, piece: number): void
  handleMetadataData(peer: PeerConnection, ...): void
  fillPeerSlots(): void
  getAdvertisedBitfield(): BitField | undefined

  // Subsystems
  _swarm: Swarm
  activePieces: ActivePieceManager | undefined
  btEngine: BtEngine
  logger: Logger
}
```

**Conclusion**: Extracting `setupPeerListeners` moves code but doesn't reduce coupling. It's essentially a 280-line method spread across a class boundary.

---

## Extraction Candidates (Ranked)

### Tier 1: Clear Boundaries (Recommended)

#### 1. FilePriorityManager (~350 lines)

**Why it works**: Pure computation with clear inputs/outputs. No event handling, minimal callbacks.

**What moves out**:
- `_filePriorities: number[]`
- `_pieceClassification: PieceClassification[]`
- `_piecePriority: Uint8Array | null`
- `setFilePriority()`, `setFilePriorities()`
- `initFilePriorities()`, `restoreFilePriorities()`
- `recomputePieceClassification()`, `recomputePiecePriority()`
- `shouldRequestPiece()` (query)
- `clearBlacklistedActivePieces()` (callback on change)

**Interface**:
```typescript
class FilePriorityManager {
  constructor(config: {
    pieceLength: number
    getPieceLength: (index: number) => number
    getPieceCount: () => number
    logger: Logger
  })

  // Initialization
  init(fileCount: number): void
  restore(priorities: number[]): void

  // Mutations
  setPriority(fileIndex: number, priority: number, isFileComplete: (i: number) => boolean): boolean
  setPriorities(priorities: Map<number, number>, isFileComplete: (i: number) => boolean): number
  recompute(files: Array<{ offset: number; length: number }>): void

  // Queries (pure)
  shouldRequestPiece(index: number, hasPiece: boolean): boolean
  getClassification(index: number): PieceClassification
  getPriority(index: number): number
  get filePriorities(): readonly number[]
  get pieceClassification(): readonly PieceClassification[]

  // Stats
  get wantedPiecesCount(): number
  getCompletedWantedCount(bitfield: BitField): number

  // Events
  on(event: 'changed', handler: () => void): void
}
```

**Torrent keeps**:
- `.parts` file handling (storage concern)
- `materializePiece()` (storage + network concern)
- `isFileComplete()` (bitfield concern)

**Coupling**: Low. Manager is initialized with callbacks, emits 'changed' event.

---

#### 2. TorrentUploader (~200 lines)

**Why it works**: Clear request/response flow. Reads from storage, writes to network.

**What moves out**:
- `uploadQueue: QueuedUploadRequest[]`
- `uploadDrainScheduled: boolean`
- `handleRequest()`
- `drainUploadQueue()`
- Queue management in `chokePeer()` and `removePeer()`

**Interface**:
```typescript
class TorrentUploader {
  constructor(config: {
    storage: TorrentContentStorage
    bandwidthTracker: BandwidthTracker
    canServePiece: (index: number) => boolean
    isConnected: (peer: PeerConnection) => boolean
    logger: Logger
  })

  handleRequest(peer: PeerConnection, index: number, begin: number, length: number): void
  clearQueueForPeer(peer: PeerConnection): number

  // Called when peer is choked - discard their queued requests
  onPeerChoked(peer: PeerConnection): void
}
```

**Coupling**: Low. Needs storage read access, bandwidth tracker, peer connection check.

---

#### 3. MetadataFetcher (~180 lines)

**Why it works**: Self-contained BEP 9 protocol handling. Only needs infoHash and hasher.

**What moves out**:
- `peerMetadataBuffers: Map<PeerConnection, (Uint8Array | null)[]>`
- `metadataSize: number | null` (tracking)
- `handleMetadataRequest()`
- `handleMetadataData()`
- `verifyPeerMetadata()`
- Extension handshake metadata request initiation

**Interface**:
```typescript
class MetadataFetcher extends EventEmitter {
  constructor(config: {
    infoHash: Uint8Array
    hasher: { sha1: (data: Uint8Array) => Promise<Uint8Array> }
    logger: Logger
  })

  get metadataSize(): number | null
  get isComplete(): boolean

  // Called from peer event handlers
  onExtensionHandshake(peer: PeerConnection): void
  onMetadataRequest(peer: PeerConnection, piece: number, metadataRaw: Uint8Array | null): void
  onMetadataData(peer: PeerConnection, piece: number, totalSize: number, data: Uint8Array): void
  onMetadataReject(peer: PeerConnection, piece: number): void
  onPeerDisconnected(peer: PeerConnection): void

  // Set when metadata provided externally (.torrent file)
  setMetadata(buffer: Uint8Array): void

  // Events
  // 'metadata' - emitted with verified buffer
}
```

**Coupling**: Very low. Completely isolated protocol handling.

---

### Tier 2: Moderate Boundaries

#### 4. PieceRequester (~400 lines)

**Why it's harder**: Needs access to bitfield, peer bitfields, active pieces, endgame manager, rate limiter.

**What would move**:
- `requestPieces()`
- `requestTick()` game loop
- `_peerRequestRoundRobin`
- `scheduleDownloadRateLimitRetry()`
- Rate limit cap calculations

**Challenge**: Deep integration with `ActivePieceManager`, peer state, and bandwidth tracker.

**Possible approach**: Extract as a stateless "piece selection algorithm" that takes snapshots:
```typescript
interface PieceSelectionContext {
  bitfield: BitField
  peerBitfield: BitField
  piecePriority: Uint8Array
  activePieceIndices: Set<number>
  isEndgame: boolean
  firstNeededPiece: number
}

function selectPiecesToRequest(ctx: PieceSelectionContext, limit: number): number[]
```

---

#### 5. BlockHandler / PieceFinalization (~300 lines)

**Why it's harder**: Interleaved with persistence, events, completion checking.

**What would move**:
- `handleBlock()`
- `finalizePiece()`
- `handleHashMismatch()`
- `verifyPiece()`

**Challenge**: Calls `emit('piece')`, `emit('progress')`, `emit('verified')`, `checkCompletion()`, persistence scheduling.

---

### Tier 3: Not Recommended for Extraction

#### setupPeerListeners / Peer Lifecycle

As analyzed above, this is mostly dispatch glue. Extraction would:
- Move ~500 lines of code
- Require exposing ~20 Torrent methods/properties
- Not meaningfully reduce coupling

**Better approach**: Keep in Torrent but organize into regions with clear comments.

---

## Recommended Implementation Order

### Phase 1: Quick Wins (Low Risk)

1. **MetadataFetcher** - Completely isolated, ~180 lines, clear boundary
2. **TorrentUploader** - Clear request/response, ~200 lines

**Expected outcome**: ~380 lines moved, two clean interfaces established.

### Phase 2: Medium Effort (Medium Risk)

3. **FilePriorityManager** - More complex but well-bounded, ~350 lines

**Expected outcome**: ~730 total lines moved, piece selection simplified.

### Phase 3: Refactor Remainder (Higher Risk)

4. Reorganize remaining code into logical regions
5. Consider extracting piece selection as pure functions
6. Evaluate if `PeerEventRouter` pattern makes sense

---

## Alternative: Internal Organization

If full extraction is too disruptive, consider organizing with clear sections:

```typescript
class Torrent extends EngineComponent {
  // ============================================================
  // REGION: State & Configuration
  // ============================================================

  // ============================================================
  // REGION: Network Lifecycle
  // ============================================================

  // ============================================================
  // REGION: Peer Management
  // ============================================================

  // ============================================================
  // REGION: Piece Selection & Downloading
  // ============================================================

  // ============================================================
  // REGION: Upload Management
  // ============================================================

  // ============================================================
  // REGION: File Priority System
  // ============================================================

  // ============================================================
  // REGION: Metadata (BEP 9)
  // ============================================================

  // ============================================================
  // REGION: Persistence
  // ============================================================

  // ============================================================
  // REGION: UI/Debug APIs
  // ============================================================
}
```

This makes the file navigable without the risk of extraction.

---

## Appendix: Existing Extractions

The codebase already has some good extractions from Torrent:

| Class | Lines | Responsibility |
|-------|-------|----------------|
| `ActivePieceManager` | ~300 | Buffering in-flight pieces |
| `EndgameManager` | ~150 | Endgame mode state machine |
| `PeerCoordinator` | ~400 | Choke/unchoke algorithm |
| `ConnectionManager` | ~300 | Outgoing connection lifecycle |
| `Swarm` | ~400 | Peer address tracking |
| `TorrentDiskQueue` | ~200 | Disk I/O scheduling |
| `CorruptionTracker` | ~150 | Hash failure attribution |
| `PartsFile` | ~200 | Boundary piece storage |
| `TrackerManager` | ~500 | Tracker protocol handling |

These demonstrate the pattern: extract when there's a **clear state boundary** and **minimal callback surface**.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-27 | Document current state | Understand before refactoring |
| | Recommend MetadataFetcher first | Lowest risk, clearest boundary |
| | Defer setupPeerListeners extraction | Too much coupling, insufficient benefit |
