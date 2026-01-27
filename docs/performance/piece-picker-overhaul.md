# Piece Picker Overhaul: Master Implementation Plan

**Created**: 2025-01-26
**Status**: Planning
**Goal**: Get game tick logic under 100ms budget on Android/QuickJS

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Root Cause Analysis](#root-cause-analysis)
3. [libtorrent Reference Implementation](#libtorrent-reference-implementation)
4. [Design Principles](#design-principles)
5. [Implementation Phases](#implementation-phases)
6. [Test Strategy](#test-strategy)
7. [Success Criteria](#success-criteria)
8. [References](#references)

---

## Problem Statement

### Observed Behavior

From `2025-01-26-fixed-tick-rate-analysis.md`:

| Metric | LAN (healthy) | Real Torrent (degraded) |
|--------|---------------|-------------------------|
| Active pieces | 9-13 | 500-626 |
| Peers/tick | 1 | 5-18 |
| RequestTick avg | 3.7-9ms | 89-148ms |
| RequestTick max | 8-26ms | 169-499ms |
| TCP callback latency | 2.8ms avg | 230-1632ms avg |
| TCP queue depth | 2 | 104 (BACKPRESSURE) |
| JS thread latency | - | 215-526ms |
| Throughput | ~25 MB/s | 3-5 MB/s |

### The Death Spiral

1. Tick takes 150ms, next tick already 50ms overdue
2. Callbacks queue up while tick runs (no yield to event loop)
3. Queue depth grows, latency compounds
4. TCP backpressure triggers, throughput drops
5. More pieces stay active longer, making ticks even slower

---

## Root Cause Analysis

### Current Algorithm Complexity

```
requestTick():
  for each peer:                           // O(P) where P = peers
    requestPieces(peer):
      PHASE 1: for each active piece:      // O(A) where A = active pieces
        if peer.bitfield.has(piece):       // O(1)
          if piece.hasUnrequestedBlocks(): // O(B) where B = blocks/piece
            request blocks...

      PHASE 2: for i in range(firstNeeded, pieceCount):  // O(N) where N = total pieces
        if !have && peerHas && !active:
          activate and request...
```

**Total complexity**: O(P × A × B) + O(P × N)

With real numbers:
- P = 5-18 peers
- A = 600 active pieces
- B = 16 blocks/piece
- N = 4000 total pieces

Phase 1: 5 × 600 × 16 = **48,000 operations**
Phase 2: 5 × 3000 = **15,000 operations**

### Why 600 Active Pieces?

Active pieces accumulate because:
1. **No cap** on concurrent partial pieces
2. **Slow peers** hold blocks hostage, preventing completion
3. **No timeout/reassignment** of stuck blocks
4. **Fragmentation** - fast and slow peers share same pieces

### Healthy Target

For 40 MB/s throughput with 256KB pieces:
- Pieces completing: 160/second
- Time in flight: ~130ms
- Active pieces needed: **~20-60** (not 600)

---

## libtorrent Reference Implementation

libtorrent is the gold standard for BitTorrent implementations. Key source files in `~/code/libtorrent/`:

### Core Files

| File | Purpose |
|------|---------|
| `src/piece_picker.cpp` | Main piece picker logic (~3500 lines) |
| `include/libtorrent/piece_picker.hpp` | Data structures and interfaces |
| `src/peer_connection.cpp` | Per-peer request handling |
| `test/test_piece_picker.cpp` | Comprehensive test suite (~2800 lines) |

### Key Algorithm 1: Partial Piece Limiting

**Location**: `src/piece_picker.cpp:1997-2008`

```cpp
const int num_partials = int(m_downloads[piece_pos::piece_downloading].size());
if (num_partials > num_peers * 3 / 2
    || num_partials * blocks_per_piece() > 2048)
{
    options |= prioritize_partials;
    prefer_contiguous_blocks = 0;
    ret |= picker_log_alert::partial_ratio;
}
```

**Rules**:
- Max partial pieces = `peers × 1.5`
- Hard cap: 2048 blocks total (~32 MiB)
- When exceeded: force completing existing partials before starting new

### Key Algorithm 2: Partial Piece Sorting

**Location**: `src/piece_picker.cpp:1934-1947`

```cpp
bool piece_picker::partial_compare_rarest_first(
    downloading_piece const* lhs, downloading_piece const* rhs) const
{
    int lhs_availability = m_piece_map[lhs->index].peer_count;
    int rhs_availability = m_piece_map[rhs->index].peer_count;
    if (lhs_availability != rhs_availability)
        return lhs_availability < rhs_availability;  // rarest first

    // tiebreaker: most complete first
    int lhs_blocks = lhs->finished + lhs->writing + lhs->requested;
    int rhs_blocks = rhs->finished + rhs->writing + rhs->requested;
    return lhs_blocks > rhs_blocks;
}
```

**Sort order**:
1. Lowest availability (rarest) first
2. Tiebreaker: highest completion percentage first

### Key Algorithm 3: Seed Handling

**Location**: `include/libtorrent/piece_picker.hpp:850-852`

```cpp
// the number of seeds. These are not added to
// the availability counters of the pieces
int m_seeds = 0;
```

Seeds use a separate counter, not added to per-piece availability. This avoids O(pieces) updates when a seed connects/disconnects.

### Key Algorithm 4: Speed Affinity / Exclusive Pieces

**Location**: `src/piece_picker.cpp:2596-2639`

```cpp
std::tuple<bool, bool, int, int> piece_picker::requested_from(
    downloading_piece const& p, int num_blocks, torrent_peer* peer) const
{
    bool exclusive = true;           // only this peer has requested
    bool exclusive_active = true;    // only this peer has active requests
    int contiguous_blocks = 0;       // longest run of unrequested
    int max_contiguous = 0;

    for (auto const& info : blocks_for_piece(p)) {
        // ... tracking logic
        if (info.peer != peer) {
            exclusive = false;
            if (info.state == block_info::state_requested)
                exclusive_active = false;
        }
    }
    return {exclusive, exclusive_active, max_contiguous, first_block};
}
```

**Behavior**:
- Fast peers (can finish piece in <30s) request whole pieces
- Track which peer "owns" each piece
- Prevent slow peers from fragmenting fast peer's pieces

### Key Algorithm 5: Priority Formula

**Location**: `include/libtorrent/piece_picker.hpp:727-755`

```cpp
int priority(piece_picker const* picker) const
{
    if (filtered() || have() || state() == piece_full)
        return -1;  // not eligible

    int adjustment = -2;  // open piece
    if (reverse()) adjustment = -1;
    else if (state() != piece_open) adjustment = -3;  // downloading

    int availability = int(peer_count) + 1;
    return availability * int(priority_levels - piece_priority)
        * prio_factor + adjustment;
}
```

Lower priority value = picked first. Downloading pieces (-3 adjustment) beat open pieces (-2).

### Key Data Structures

**piece_pos** (per-piece state):
- `peer_count`: 26 bits - how many peers have this piece
- `downloading`: is this piece currently being downloaded?
- `priority`: user-set priority level (0-7)

**downloading_piece** (active/partial piece):
- `index`: piece index
- `finished`: blocks received and verified
- `writing`: blocks being written to disk
- `requested`: blocks requested but not received
- Block-level state in separate `m_block_info` array

**m_seeds**: separate counter for seeds (not in per-piece counts)

---

## Design Principles

Based on libtorrent's battle-tested approach:

### 1. Bound the Problem Space

Don't optimize for 600 pieces - cap at ~30 and keep them healthy.

```
max_partials = min(peers × 1.5, 2048 / blocks_per_piece)
```

### 2. Prioritize Completion Over Starts

A partial piece is waste until complete. Always prefer finishing existing pieces.

### 3. Prevent Fragmentation

Fast peers should own pieces exclusively. Don't let slow peers create "stuck" blocks.

### 4. Separate Seeds

Seeds are special - they have everything. Track them separately, skip bitfield checks.

### 5. Rarest First (with caveats)

Pick rarest pieces, but completion trumps rarity. A 90% complete common piece beats a 10% complete rare piece.

### 6. Aggressive Health Management

Timeout stuck requests quickly. Reassign to faster peers. Abandon hopeless pieces.

---

## Implementation Phases

### Phase 1: Availability Tracking

**Goal**: Track per-piece availability with separate seed counter

**Files to modify**:
- `packages/engine/src/core/torrent.ts`

**Changes**:

```typescript
// Add to Torrent class
private _pieceAvailability: Uint16Array  // peer count per piece
private _seedCount: number = 0           // separate seed counter

// Update availability on peer events
private updateAvailability(peer: PeerConnection, delta: 1 | -1): void {
  if (peer.isSeed) {
    this._seedCount += delta
    return  // seeds don't update per-piece counts
  }

  const bitfield = peer.bitfield
  if (!bitfield) return

  for (let i = 0; i < this.piecesCount; i++) {
    if (bitfield.get(i)) {
      this._pieceAvailability[i] += delta
    }
  }
}

// On HAVE message (single piece)
private onPeerHave(peer: PeerConnection, pieceIndex: number): void {
  if (!peer.isSeed) {
    this._pieceAvailability[pieceIndex]++
  }
  // Check if peer became a seed
  peer.haveCount++
  if (peer.haveCount === this.piecesCount) {
    this.convertToSeed(peer)
  }
}

private convertToSeed(peer: PeerConnection): void {
  // Remove from per-piece counts, add to seed count
  const bitfield = peer.bitfield
  for (let i = 0; i < this.piecesCount; i++) {
    if (bitfield.get(i)) {
      this._pieceAvailability[i]--
    }
  }
  peer.isSeed = true
  this._seedCount++
}
```

**libtorrent reference**: `piece_picker.hpp:850-852`, `piece_picker.cpp:1160-1220`

**Tests**: See [Phase 1 Tests](#phase-1-tests-availability-tracking)

---

### Phase 2: Partial Piece Limiting

**Goal**: Auto-cap active pieces at `peers × 1.5`

**Files to modify**:
- `packages/engine/src/core/active-piece-manager.ts`
- `packages/engine/src/core/torrent.ts`

**Changes to ActivePieceManager**:

```typescript
// Add threshold check
shouldPrioritizePartials(connectedPeerCount: number): boolean {
  const threshold = Math.floor(connectedPeerCount * 1.5)
  const blockCap = Math.floor(2048 / this.blocksPerPiece)
  const maxAllowed = Math.min(threshold, blockCap)

  return this.activeCount > maxAllowed
}

// Add getter for the limit
getMaxPartials(connectedPeerCount: number): number {
  const threshold = Math.floor(connectedPeerCount * 1.5)
  const blockCap = Math.floor(2048 / this.blocksPerPiece)
  return Math.min(threshold, blockCap)
}
```

**Changes to Torrent.requestPieces()**:

```typescript
private requestPieces(peer: PeerConnection): void {
  const peerCount = this.connectedPeers.length
  const prioritizePartials = this.activePieces.shouldPrioritizePartials(peerCount)

  // PHASE 1: Always try to complete existing partials first
  // (implementation in Phase 4)

  // PHASE 2: Only activate new pieces if under threshold
  if (prioritizePartials) {
    return  // Don't start new pieces when over limit
  }

  // ... existing phase 2 logic
}
```

**libtorrent reference**: `piece_picker.cpp:1997-2008`

**Tests**: See [Phase 2 Tests](#phase-2-tests-partial-piece-limiting)

---

### Phase 3: Rarest-First Partial Sorting

**Goal**: Sort active pieces by availability, then completion

**Files to modify**:
- `packages/engine/src/core/active-piece-manager.ts`

**Changes**:

```typescript
// Add sorting method
getPartialsRarestFirst(availability: Uint16Array, seedCount: number): ActivePiece[] {
  const partials = [...this.pieces.values()]

  partials.sort((a, b) => {
    // Primary: rarest first (lower availability)
    const availA = availability[a.index] + seedCount
    const availB = availability[b.index] + seedCount
    if (availA !== availB) {
      return availA - availB
    }

    // Secondary: most complete first (higher completion ratio)
    const completionA = a.blocksReceived / a.blocksNeeded
    const completionB = b.blocksReceived / b.blocksNeeded
    return completionB - completionA
  })

  return partials
}
```

**libtorrent reference**: `piece_picker.cpp:1934-1947`

**Tests**: See [Phase 3 Tests](#phase-3-tests-rarest-first-sorting)

---

### Phase 4: Request Algorithm with Speed Affinity

**Goal**: Piece-centric requesting, fast peers own whole pieces

**Files to modify**:
- `packages/engine/src/core/active-piece.ts`
- `packages/engine/src/core/peer-connection.ts`
- `packages/engine/src/core/torrent.ts`

**Changes to ActivePiece**:

```typescript
// Add ownership tracking
exclusivePeer: string | null = null  // peer ID that "owns" this piece
lastBlockTime: number = 0            // timestamp of last block received
activatedAt: number = 0              // when piece became active

// Check if peer can request from this piece
canRequestFrom(peerId: string, peerIsFast: boolean): boolean {
  // No owner yet - anyone can claim
  if (this.exclusivePeer === null) {
    return true
  }

  // Owner can always request
  if (this.exclusivePeer === peerId) {
    return true
  }

  // Fast peers don't share with others
  if (peerIsFast) {
    return false
  }

  // Slow peers can share with other slow peers
  // (exclusivePeer is also slow if we got here)
  return true
}

// Claim ownership
claimExclusive(peerId: string): void {
  this.exclusivePeer = peerId
}
```

**Changes to PeerConnection**:

```typescript
// Add speed tracking
private _downloadedBytes: number = 0
private _downloadStartTime: number = 0
private _downloadRate: number = 0  // bytes per second

get isFast(): boolean {
  // Can finish a piece in < 30 seconds
  const pieceSize = this.torrent.pieceLength
  return this._downloadRate > 0 && (pieceSize / this._downloadRate) < 30
}

recordBlockReceived(blockSize: number): void {
  this._downloadedBytes += blockSize
  const elapsed = (Date.now() - this._downloadStartTime) / 1000
  if (elapsed > 0) {
    this._downloadRate = this._downloadedBytes / elapsed
  }
}
```

**Changes to Torrent.requestPieces() - Complete Rewrite**:

```typescript
private requestPieces(peer: PeerConnection): void {
  const pipelineLimit = peer.pipelineDepth
  if (peer.requestsPending >= pipelineLimit) return

  const peerCount = this.connectedPeers.length
  const prioritizePartials = this.activePieces.shouldPrioritizePartials(peerCount)
  const peerIsFast = peer.isFast
  const peerId = peer.id
  const peerBitfield = peer.bitfield

  // PHASE 1: Request from existing active pieces (rarest first)
  const partials = this.activePieces.getPartialsRarestFirst(
    this._pieceAvailability,
    this._seedCount
  )

  for (const piece of partials) {
    if (peer.requestsPending >= pipelineLimit) return

    // Skip if peer doesn't have this piece (seeds handled separately)
    if (!peer.isSeed && !peerBitfield?.get(piece.index)) continue

    // Skip if piece is complete
    if (piece.haveAllBlocks) continue

    // Speed affinity: check if peer can request from this piece
    if (!piece.canRequestFrom(peerId, peerIsFast)) continue

    // Skip if no unrequested blocks
    if (!piece.hasUnrequestedBlocks) continue

    // Claim ownership if unclaimed and peer is fast
    if (piece.exclusivePeer === null && peerIsFast) {
      piece.claimExclusive(peerId)
    }

    // Request blocks
    const needed = peerIsFast
      ? piece.getAllUnrequestedBlocks()  // fast peers take whole piece
      : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

    for (const block of needed) {
      if (peer.requestsPending >= pipelineLimit) return
      this.sendBlockRequest(peer, piece, block)
    }
  }

  // PHASE 2: Activate new pieces (only if under threshold)
  if (prioritizePartials) return
  if (peer.requestsPending >= pipelineLimit) return

  const maxNew = this.activePieces.getMaxPartials(peerCount) - this.activePieces.activeCount
  if (maxNew <= 0) return

  // Find new pieces to activate (rarest first among pieces peer has)
  const candidates = this.findNewPieceCandidates(peer, maxNew)

  for (const pieceIndex of candidates) {
    if (peer.requestsPending >= pipelineLimit) return

    const piece = this.activePieces.getOrCreate(pieceIndex)
    if (!piece) break

    piece.activatedAt = Date.now()
    if (peerIsFast) {
      piece.claimExclusive(peerId)
    }

    const needed = piece.getNeededBlocks(pipelineLimit - peer.requestsPending)
    for (const block of needed) {
      if (peer.requestsPending >= pipelineLimit) return
      this.sendBlockRequest(peer, piece, block)
    }
  }
}

// Find new pieces to activate, sorted by rarity
private findNewPieceCandidates(peer: PeerConnection, maxCount: number): number[] {
  const candidates: Array<{index: number, availability: number}> = []
  const bitfield = peer.bitfield

  for (let i = this._firstNeededPiece; i < this.piecesCount && candidates.length < maxCount * 2; i++) {
    if (this._bitfield.get(i)) continue           // we have it
    if (!peer.isSeed && !bitfield?.get(i)) continue  // peer doesn't have it
    if (this._piecePriority[i] === 0) continue    // skipped
    if (this.activePieces.has(i)) continue        // already active

    candidates.push({
      index: i,
      availability: this._pieceAvailability[i] + this._seedCount
    })
  }

  // Sort by rarity
  candidates.sort((a, b) => a.availability - b.availability)

  return candidates.slice(0, maxCount).map(c => c.index)
}
```

**libtorrent reference**: `piece_picker.cpp:2596-2639`, `piece_picker.cpp:1978-2470`

**Tests**: See [Phase 4 Tests](#phase-4-tests-request-algorithm-with-speed-affinity)

---

### Phase 5: Piece Health Management

**Goal**: Timeout and reassign stuck blocks, abandon hopeless pieces

**Files to modify**:
- `packages/engine/src/core/active-piece.ts`
- `packages/engine/src/core/torrent.ts`

**Configuration constants**:

```typescript
const BLOCK_REQUEST_TIMEOUT_MS = 10_000    // 10 seconds
const PIECE_ABANDON_TIMEOUT_MS = 30_000    // 30 seconds
const PIECE_ABANDON_MIN_PROGRESS = 0.5     // 50% complete to keep
```

**Changes to ActivePiece**:

```typescript
// Track per-block request times
private blockRequestTimes: Map<number, number> = new Map()

addRequest(blockIndex: number, peerId: string): void {
  // existing logic...
  this.blockRequestTimes.set(blockIndex, Date.now())
}

// Get stale requests (older than timeout)
getStaleRequests(timeoutMs: number): Array<{blockIndex: number, peerId: string}> {
  const now = Date.now()
  const stale: Array<{blockIndex: number, peerId: string}> = []

  for (const [blockIndex, requestTime] of this.blockRequestTimes) {
    if (now - requestTime > timeoutMs) {
      const requests = this.blockRequests.get(blockIndex)
      if (requests) {
        for (const peerId of requests) {
          stale.push({ blockIndex, peerId })
        }
      }
    }
  }

  return stale
}

// Check if piece should be abandoned
shouldAbandon(timeoutMs: number, minProgress: number): boolean {
  const age = Date.now() - this.activatedAt
  if (age < timeoutMs) return false

  const progress = this.blocksReceived / this.blocksNeeded
  return progress < minProgress
}

// Cancel a specific request
cancelRequest(blockIndex: number, peerId: string): void {
  const requests = this.blockRequests.get(blockIndex)
  if (requests) {
    const idx = requests.indexOf(peerId)
    if (idx !== -1) {
      requests.splice(idx, 1)
    }
    if (requests.length === 0) {
      this.blockRequests.delete(blockIndex)
      this.blockRequestTimes.delete(blockIndex)
    }
  }
  // Clear exclusive owner if they timed out
  if (this.exclusivePeer === peerId) {
    this.exclusivePeer = null
  }
}
```

**Changes to Torrent**:

```typescript
// Call this every tick or every few ticks
private cleanupStuckPieces(): void {
  const piecesToRemove: number[] = []

  for (const piece of this.activePieces.values()) {
    // Check for stale requests
    const staleRequests = piece.getStaleRequests(BLOCK_REQUEST_TIMEOUT_MS)
    for (const { blockIndex, peerId } of staleRequests) {
      this.logger.debug(`Canceling stale request: piece ${piece.index} block ${blockIndex} from ${peerId}`)

      // Send cancel to peer
      const peer = this.getPeerById(peerId)
      if (peer) {
        peer.sendCancel(piece.index, blockIndex * BLOCK_SIZE, BLOCK_SIZE)
      }

      piece.cancelRequest(blockIndex, peerId)
    }

    // Check if piece should be abandoned
    if (piece.shouldAbandon(PIECE_ABANDON_TIMEOUT_MS, PIECE_ABANDON_MIN_PROGRESS)) {
      this.logger.info(`Abandoning stuck piece ${piece.index} (${Math.round(piece.blocksReceived / piece.blocksNeeded * 100)}% complete)`)
      piecesToRemove.push(piece.index)
    }
  }

  // Remove abandoned pieces
  for (const index of piecesToRemove) {
    this.activePieces.remove(index)
  }
}

// Update requestTick to include cleanup
private requestTick(): void {
  if (!this._networkActive) return

  // Periodic cleanup (every 5 ticks = 500ms)
  this._tickCount++
  if (this._tickCount % 5 === 0) {
    this.cleanupStuckPieces()
  }

  // ... rest of tick logic
}
```

**libtorrent reference**: `peer_connection.cpp:4565-4588` (request timeout)

**Tests**: See [Phase 5 Tests](#phase-5-tests-piece-health-management)

---

### Phase 6: Seed Fast Path

**Goal**: Skip bitfield checks for seeds

**Files to modify**:
- `packages/engine/src/core/peer-connection.ts`
- `packages/engine/src/core/torrent.ts`

**Changes to PeerConnection**:

```typescript
// Add seed detection
isSeed: boolean = false
haveCount: number = 0

onBitfieldReceived(bitfield: Bitfield): void {
  this.bitfield = bitfield
  this.haveCount = bitfield.popcount()
  this.isSeed = this.haveCount === this.torrent.piecesCount
}

onHaveReceived(pieceIndex: number): void {
  if (!this.bitfield.get(pieceIndex)) {
    this.bitfield.set(pieceIndex)
    this.haveCount++
    if (this.haveCount === this.torrent.piecesCount) {
      this.isSeed = true
      this.torrent.onPeerBecameSeed(this)
    }
  }
}
```

**Changes to Torrent.requestTick()**:

```typescript
private requestTick(): void {
  if (!this._networkActive) return

  const startTime = Date.now()

  // Cleanup (every 5 ticks)
  if (this._tickCount % 5 === 0) {
    this.cleanupStuckPieces()
  }

  // Separate seeds and non-seeds
  const seeds: PeerConnection[] = []
  const partials: PeerConnection[] = []

  for (const peer of this.connectedPeers) {
    if (peer.peerChoking) continue
    if (peer.requestsPending >= peer.pipelineDepth) continue

    if (peer.isSeed) {
      seeds.push(peer)
    } else {
      partials.push(peer)
    }
  }

  // Process seeds first (fast path - no bitfield checks)
  for (const peer of seeds) {
    this.requestPiecesFromSeed(peer)
  }

  // Process partial peers
  for (const peer of partials) {
    this.requestPieces(peer)
  }

  // ... timing stats
}

private requestPiecesFromSeed(peer: PeerConnection): void {
  // Simplified version - no bitfield checks needed
  const pipelineLimit = peer.pipelineDepth
  const peerIsFast = peer.isFast
  const peerId = peer.id

  const partials = this.activePieces.getPartialsRarestFirst(
    this._pieceAvailability,
    this._seedCount
  )

  for (const piece of partials) {
    if (peer.requestsPending >= pipelineLimit) return
    if (piece.haveAllBlocks) continue
    if (!piece.canRequestFrom(peerId, peerIsFast)) continue
    if (!piece.hasUnrequestedBlocks) continue

    if (piece.exclusivePeer === null && peerIsFast) {
      piece.claimExclusive(peerId)
    }

    const needed = peerIsFast
      ? piece.getAllUnrequestedBlocks()
      : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

    for (const block of needed) {
      if (peer.requestsPending >= pipelineLimit) return
      this.sendBlockRequest(peer, piece, block)
    }
  }

  // Phase 2 for seeds (also no bitfield checks)
  // ... similar simplification
}
```

**Tests**: See [Phase 6 Tests](#phase-6-tests-seed-fast-path)

---

### Phase 7: hasUnrequestedBlocks Caching

**Goal**: O(1) check instead of O(blocks) scan

**Files to modify**:
- `packages/engine/src/core/active-piece.ts`

**Changes**:

```typescript
// Add cached state
private _hasUnrequestedBlocks: boolean = true

get hasUnrequestedBlocks(): boolean {
  return this._hasUnrequestedBlocks
}

// Update cache when state changes
private updateUnrequestedState(): void {
  for (let i = 0; i < this.blocksNeeded; i++) {
    if (this.blockReceived[i]) continue
    if (this.blockRequests.has(i) && this.blockRequests.get(i)!.length > 0) continue
    this._hasUnrequestedBlocks = true
    return
  }
  this._hasUnrequestedBlocks = false
}

addRequest(blockIndex: number, peerId: string): void {
  // existing logic...
  this.updateUnrequestedState()
}

addBlock(blockIndex: number, data: Uint8Array): void {
  // existing logic...
  this.updateUnrequestedState()
}

cancelRequest(blockIndex: number, peerId: string): void {
  // existing logic...
  this.updateUnrequestedState()
}
```

**Optimization**: Instead of full scan, track count of unrequested blocks:

```typescript
private _unrequestedCount: number

constructor(blocksNeeded: number) {
  this._unrequestedCount = blocksNeeded
}

get hasUnrequestedBlocks(): boolean {
  return this._unrequestedCount > 0
}

addRequest(blockIndex: number, peerId: string): void {
  const wasUnrequested = !this.blockReceived[blockIndex] &&
    (!this.blockRequests.has(blockIndex) || this.blockRequests.get(blockIndex)!.length === 0)

  // existing logic...

  if (wasUnrequested) {
    this._unrequestedCount--
  }
}
```

**Tests**: See [Phase 7 Tests](#phase-7-tests-hasunrequestedblocks-caching)

---

### Phase 8: Phase 2 Index (Optional)

**Goal**: O(1) lookup for "pieces this peer has that we need"

This phase is optional - only implement if Phase 2 (new piece selection) is still slow after other optimizations.

**Concept**:

```typescript
// Per-peer index
peer.neededHavePieces: Set<number>  // pieces peer has that we need and aren't active

// Maintenance:
// - Peer connects: populate from bitfield
// - Peer HAVE: add to set if we need it
// - We complete piece: remove from all peers
// - Piece activated: remove from all peers (moved to active tracking)
```

**libtorrent reference**: This is implicit in their piece-centric design where they iterate pieces and look up peers, rather than iterating peers and scanning pieces.

---

## Test Strategy

### Test Notation (from libtorrent)

Use string-based notation for readable test setup:

```typescript
// Availability string: "1234" = piece 0 has 1 peer, piece 1 has 2, etc.
// Have string: "* * " = we have pieces 0 and 2, not 1 and 3
// Priority string: "1234" = priority levels
// Partial string: "0f37" = hex blocks complete (0=none, f=all 16 blocks)

function setupPicker(
  availability: string,
  have: string,
  priority: string,
  partial: string
): TestPicker
```

### Test Helpers

```typescript
// Create test picker with given state
function setupPicker(opts: {
  pieceCount: number
  blocksPerPiece: number
  availability?: number[]
  have?: boolean[]
  partials?: Array<{index: number, blocksComplete: number}>
  peers?: Array<{id: string, bitfield: boolean[], isFast?: boolean}>
  seeds?: number
}): { torrent: MockTorrent, activePieces: ActivePieceManager }

// Collect all requests that would be made
function collectRequests(peer: PeerConnection, torrent: Torrent): BlockRequest[]

// Verify availability state
function verifyAvailability(torrent: Torrent, expected: number[]): void
```

### Phase 1 Tests: Availability Tracking

```typescript
describe('Availability Tracking', () => {
  test('tracks peer count per piece', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })

    torrent.addPeer(peer1, bitfield([true, true, false, false]))
    torrent.addPeer(peer2, bitfield([true, true, true, false]))

    expect(torrent.pieceAvailability).toEqual([2, 2, 1, 0])
  })

  test('decrements on peer disconnect', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })
    torrent.addPeer(peer1, bitfield([true, true, false, false]))

    torrent.removePeer(peer1)

    expect(torrent.pieceAvailability).toEqual([0, 0, 0, 0])
  })

  test('seeds use separate counter', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })

    torrent.addPeer(seed, bitfield([true, true, true, true]))  // complete

    expect(torrent.seedCount).toBe(1)
    expect(torrent.pieceAvailability).toEqual([0, 0, 0, 0])  // not in per-piece
  })

  test('converts to seed on final HAVE', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })
    torrent.addPeer(peer1, bitfield([true, true, true, false]))

    expect(peer1.isSeed).toBe(false)
    expect(torrent.seedCount).toBe(0)

    torrent.onPeerHave(peer1, 3)  // now has all pieces

    expect(peer1.isSeed).toBe(true)
    expect(torrent.seedCount).toBe(1)
    expect(torrent.pieceAvailability).toEqual([0, 0, 0, 0])  // removed from per-piece
  })
})
```

### Phase 2 Tests: Partial Piece Limiting

```typescript
describe('Partial Piece Limiting', () => {
  test('threshold is peers × 1.5', () => {
    const { activePieces } = setupPicker({ pieceCount: 100 })

    expect(activePieces.shouldPrioritizePartials(10)).toBe(false)  // 0 < 15

    for (let i = 0; i < 16; i++) {
      activePieces.getOrCreate(i)
    }

    expect(activePieces.shouldPrioritizePartials(10)).toBe(true)  // 16 > 15
  })

  test('hard cap at 2048 blocks', () => {
    const { activePieces } = setupPicker({
      pieceCount: 200,
      blocksPerPiece: 16
    })

    // 129 pieces × 16 blocks = 2064 > 2048
    for (let i = 0; i < 129; i++) {
      activePieces.getOrCreate(i)
    }

    expect(activePieces.shouldPrioritizePartials(1000)).toBe(true)
  })

  test('does not activate new pieces when over threshold', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 100,
      peers: [{ id: 'peer1', bitfield: allTrue(100) }]
    })

    // Create 16 partials (exceeds 10 peers × 1.5 = 15)
    for (let i = 0; i < 16; i++) {
      activePieces.getOrCreate(i)
    }

    const requestsBefore = collectRequests(peer1, torrent)

    // All requests should be for existing partials (0-15), not new pieces
    for (const req of requestsBefore) {
      expect(req.pieceIndex).toBeLessThan(16)
    }
  })
})
```

### Phase 3 Tests: Rarest-First Sorting

```typescript
describe('Rarest-First Sorting', () => {
  test('sorts by availability ascending', () => {
    const { activePieces } = setupPicker({
      pieceCount: 4,
      availability: [3, 1, 2, 4]
    })

    activePieces.getOrCreate(0)
    activePieces.getOrCreate(1)
    activePieces.getOrCreate(2)
    activePieces.getOrCreate(3)

    const sorted = activePieces.getPartialsRarestFirst(availability, 0)

    expect(sorted.map(p => p.index)).toEqual([1, 2, 0, 3])
  })

  test('tiebreaker: most complete first', () => {
    const { activePieces } = setupPicker({
      pieceCount: 3,
      availability: [2, 2, 2],  // same availability
      blocksPerPiece: 16
    })

    const p0 = activePieces.getOrCreate(0)!
    const p1 = activePieces.getOrCreate(1)!
    const p2 = activePieces.getOrCreate(2)!

    p0.blocksReceived = 4   // 25%
    p1.blocksReceived = 12  // 75%
    p2.blocksReceived = 8   // 50%

    const sorted = activePieces.getPartialsRarestFirst(availability, 0)

    expect(sorted.map(p => p.index)).toEqual([1, 2, 0])  // most complete first
  })

  test('includes seed count in availability', () => {
    const { activePieces } = setupPicker({
      pieceCount: 2,
      availability: [1, 0],  // piece 0: 1 partial peer, piece 1: 0 partial peers
      seeds: 2               // but 2 seeds have everything
    })

    activePieces.getOrCreate(0)
    activePieces.getOrCreate(1)

    const sorted = activePieces.getPartialsRarestFirst(availability, 2)

    // piece 0: 1 + 2 = 3, piece 1: 0 + 2 = 2
    expect(sorted.map(p => p.index)).toEqual([1, 0])  // piece 1 is rarer
  })
})
```

### Phase 4 Tests: Request Algorithm with Speed Affinity

```typescript
describe('Request Algorithm with Speed Affinity', () => {
  test('fast peer claims exclusive ownership', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [{ id: 'fast1', bitfield: allTrue(10), isFast: true }]
    })

    const piece = activePieces.getOrCreate(0)!

    torrent.requestPieces(fastPeer)

    expect(piece.exclusivePeer).toBe('fast1')
  })

  test('fast peer requests all blocks of owned piece', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      blocksPerPiece: 16,
      peers: [{ id: 'fast1', bitfield: allTrue(10), isFast: true }]
    })

    activePieces.getOrCreate(0)

    const requests = collectRequests(fastPeer, torrent)
    const piece0Requests = requests.filter(r => r.pieceIndex === 0)

    expect(piece0Requests.length).toBe(16)  // all blocks
  })

  test('slow peer cannot fragment fast peer piece', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [
        { id: 'fast1', bitfield: allTrue(10), isFast: true },
        { id: 'slow1', bitfield: allTrue(10), isFast: false }
      ]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.claimExclusive('fast1')

    const requests = collectRequests(slowPeer, torrent)

    expect(requests.filter(r => r.pieceIndex === 0)).toHaveLength(0)
  })

  test('slow peers share pieces with each other', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [
        { id: 'slow1', bitfield: allTrue(10), isFast: false },
        { id: 'slow2', bitfield: allTrue(10), isFast: false }
      ]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.claimExclusive('slow1')

    const requests = collectRequests(slow2, torrent)

    // slow2 CAN request from piece owned by slow1
    expect(requests.filter(r => r.pieceIndex === 0).length).toBeGreaterThan(0)
  })

  test('requests rarest partial first', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      availability: [5, 1, 3, 5, 5, 5, 5, 5, 5, 5],
      peers: [{ id: 'peer1', bitfield: allTrue(10) }]
    })

    activePieces.getOrCreate(0)  // availability 5
    activePieces.getOrCreate(1)  // availability 1 (rarest)
    activePieces.getOrCreate(2)  // availability 3

    const requests = collectRequests(peer1, torrent)

    expect(requests[0].pieceIndex).toBe(1)  // rarest first
  })
})
```

### Phase 5 Tests: Piece Health Management

```typescript
describe('Piece Health Management', () => {
  test('cancels requests older than timeout', () => {
    const { torrent, activePieces } = setupPicker({ pieceCount: 10 })
    const piece = activePieces.getOrCreate(0)!

    // Add request 15 seconds ago
    piece.addRequest(0, 'peer1')
    piece.blockRequestTimes.set(0, Date.now() - 15000)

    torrent.cleanupStuckPieces()

    expect(piece.blockRequests.has(0)).toBe(false)
  })

  test('clears exclusive owner on timeout', () => {
    const { torrent, activePieces } = setupPicker({ pieceCount: 10 })
    const piece = activePieces.getOrCreate(0)!

    piece.claimExclusive('slow1')
    piece.addRequest(0, 'slow1')
    piece.blockRequestTimes.set(0, Date.now() - 15000)

    torrent.cleanupStuckPieces()

    expect(piece.exclusivePeer).toBeNull()
  })

  test('abandons piece stuck with low progress', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      blocksPerPiece: 16
    })
    const piece = activePieces.getOrCreate(0)!

    piece.activatedAt = Date.now() - 35000  // 35 seconds old
    piece.blocksReceived = 4                 // only 25% complete

    torrent.cleanupStuckPieces()

    expect(activePieces.has(0)).toBe(false)
  })

  test('keeps stuck piece with high progress', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      blocksPerPiece: 16
    })
    const piece = activePieces.getOrCreate(0)!

    piece.activatedAt = Date.now() - 35000  // 35 seconds old
    piece.blocksReceived = 12               // 75% complete - worth keeping

    torrent.cleanupStuckPieces()

    expect(activePieces.has(0)).toBe(true)
  })

  test('sends CANCEL message to peer', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [{ id: 'peer1', bitfield: allTrue(10) }]
    })
    const piece = activePieces.getOrCreate(0)!

    piece.addRequest(5, 'peer1')
    piece.blockRequestTimes.set(5, Date.now() - 15000)

    const cancelSpy = jest.spyOn(peer1, 'sendCancel')

    torrent.cleanupStuckPieces()

    expect(cancelSpy).toHaveBeenCalledWith(0, 5 * BLOCK_SIZE, BLOCK_SIZE)
  })
})
```

### Phase 6 Tests: Seed Fast Path

```typescript
describe('Seed Fast Path', () => {
  test('detects seed from complete bitfield', () => {
    const { torrent } = setupPicker({ pieceCount: 10 })

    const peer = torrent.addPeer('peer1', allTrue(10))

    expect(peer.isSeed).toBe(true)
  })

  test('detects seed after final HAVE', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })

    const peer = torrent.addPeer('peer1', [true, true, true, false])
    expect(peer.isSeed).toBe(false)

    torrent.onPeerHave(peer, 3)

    expect(peer.isSeed).toBe(true)
  })

  test('seed requests skip bitfield lookup', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [{ id: 'seed1', bitfield: allTrue(10) }]
    })

    activePieces.getOrCreate(0)

    const bitfieldSpy = jest.spyOn(seed1.bitfield, 'get')

    torrent.requestPiecesFromSeed(seed1)

    expect(bitfieldSpy).not.toHaveBeenCalled()
  })

  test('seeds processed before partial peers', () => {
    const { torrent } = setupPicker({
      pieceCount: 10,
      peers: [
        { id: 'partial1', bitfield: [true, false, true, false, ...] },
        { id: 'seed1', bitfield: allTrue(10) }
      ]
    })

    const order: string[] = []
    jest.spyOn(torrent, 'requestPiecesFromSeed').mockImplementation((p) => {
      order.push(p.id)
    })
    jest.spyOn(torrent, 'requestPieces').mockImplementation((p) => {
      order.push(p.id)
    })

    torrent.requestTick()

    expect(order).toEqual(['seed1', 'partial1'])
  })
})
```

### Phase 7 Tests: hasUnrequestedBlocks Caching

```typescript
describe('hasUnrequestedBlocks Caching', () => {
  test('starts true for new piece', () => {
    const piece = new ActivePiece(0, 16)

    expect(piece.hasUnrequestedBlocks).toBe(true)
  })

  test('becomes false when all blocks requested', () => {
    const piece = new ActivePiece(0, 4)

    piece.addRequest(0, 'peer1')
    piece.addRequest(1, 'peer1')
    piece.addRequest(2, 'peer1')
    expect(piece.hasUnrequestedBlocks).toBe(true)

    piece.addRequest(3, 'peer1')
    expect(piece.hasUnrequestedBlocks).toBe(false)
  })

  test('becomes true when request canceled', () => {
    const piece = new ActivePiece(0, 2)

    piece.addRequest(0, 'peer1')
    piece.addRequest(1, 'peer1')
    expect(piece.hasUnrequestedBlocks).toBe(false)

    piece.cancelRequest(1, 'peer1')
    expect(piece.hasUnrequestedBlocks).toBe(true)
  })

  test('O(1) performance', () => {
    const piece = new ActivePiece(0, 10000)  // many blocks

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      piece.hasUnrequestedBlocks
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50)  // should be nearly instant
  })
})
```

---

## Success Criteria

### Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Active pieces | 500-600 | <50 |
| RequestTick avg | 89-148ms | <10ms |
| RequestTick max | 169-499ms | <50ms |
| TCP callback latency | 230-1632ms | <50ms |
| TCP queue depth | 104 | <10 |
| Throughput | 3-5 MB/s | >20 MB/s |

### Functional Requirements

- [ ] Partial pieces capped at `peers × 1.5` (max 2048 blocks)
- [ ] Rarest-first selection with completion tiebreaker
- [ ] Seeds tracked separately, skip bitfield checks
- [ ] Fast peers own pieces exclusively
- [ ] Stuck requests timeout after 10s
- [ ] Abandoned pieces removed after 30s with <50% progress
- [ ] All tests passing

### Monitoring

Add logging to verify healthy operation:

```typescript
// Every 5 seconds
logger.info(`PiecePicker: ${activePieces} active (max ${maxPartials}), ` +
  `${seedCount} seeds, ${partialPeers} partial peers, ` +
  `tick avg ${avgTickMs}ms max ${maxTickMs}ms`)
```

---

## References

### libtorrent Source Files

| File | Key Content |
|------|-------------|
| `src/piece_picker.cpp` | Main picker logic, partial limiting, sorting |
| `include/libtorrent/piece_picker.hpp` | Data structures, piece_pos, downloading_piece |
| `src/peer_connection.cpp` | Request timeout, per-peer handling |
| `test/test_piece_picker.cpp` | Comprehensive test suite |

### libtorrent Documentation

- [Writing a Fast Piece Picker](https://blog.libtorrent.org/2011/11/writing-a-fast-piece-picker/)
- [Requesting Pieces](https://blog.libtorrent.org/2011/11/requesting-pieces/)
- [Settings Reference](https://www.libtorrent.org/reference-Settings.html)

### Key Line References

| Feature | File:Line |
|---------|-----------|
| Partial limit threshold | `piece_picker.cpp:1997-2008` |
| Partial sorting | `piece_picker.cpp:1934-1947` |
| Priority formula | `piece_picker.hpp:727-755` |
| Seed counter | `piece_picker.hpp:850-852` |
| Exclusive piece detection | `piece_picker.cpp:2596-2639` |
| Request timeout | `peer_connection.cpp:4565-4588` |
| Test notation/setup | `test_piece_picker.cpp:115-218` |

### Our Codebase

| File | Current Role |
|------|--------------|
| `packages/engine/src/core/torrent.ts` | Torrent management, requestTick, requestPieces |
| `packages/engine/src/core/active-piece.ts` | ActivePiece class |
| `packages/engine/src/core/active-piece-manager.ts` | ActivePieceManager |
| `packages/engine/src/core/peer-connection.ts` | PeerConnection class |

---

## Implementation Notes

### Order of Operations

1. **Phase 1-2 first**: These provide the foundation (availability tracking, limits)
2. **Phase 3-4 together**: Sorting and algorithm rewrite are interdependent
3. **Phase 5 after 4**: Health management needs the new ownership model
4. **Phase 6-7 last**: Optimizations that build on the working system

### Testing Strategy

1. Write tests BEFORE implementation (TDD)
2. Run existing tests after each phase to catch regressions
3. Performance test with real torrents on Android after Phase 4
4. Monitor production metrics after deployment

### Rollback Plan

Keep old `requestPieces()` behind a feature flag:

```typescript
private requestPieces(peer: PeerConnection): void {
  if (this._useNewPiecePicker) {
    this.requestPiecesNew(peer)
  } else {
    this.requestPiecesLegacy(peer)
  }
}
```

Can disable new implementation if issues discovered in production.
