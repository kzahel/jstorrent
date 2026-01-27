# Piece Picker Overhaul: Master Implementation Plan

**Created**: 2025-01-26
**Status**: Planning
**Goal**: Get game tick logic under 100ms budget on Android/QuickJS

## Table of Contents

1. [Glossary](#glossary)
2. [Problem Statement](#problem-statement)
3. [Root Cause Analysis](#root-cause-analysis)
4. [libtorrent Reference Implementation](#libtorrent-reference-implementation)
5. [Design Principles](#design-principles)
6. [Implementation Phases](#implementation-phases)
   - Phase 1: Availability Tracking
   - Phase 2: Partial Piece Limiting
   - Phase 3: Rarest-First Sorting with Priority
   - Phase 4: Request Algorithm with Speed Affinity
   - Phase 5: Piece Health Management
   - Phase 6: Seed Fast Path
   - Phase 7: hasUnrequestedBlocks Caching
   - Phase 8: Phase 2 Index (Optional)
   - Phase 9: End-Game Mode
   - Phase 10: Peer Disconnect Cleanup
   - Phase 11: Hash Check Failure Recovery
7. [Test Strategy](#test-strategy)
8. [Success Criteria](#success-criteria)
9. [References](#references)

---

## Glossary

| Term | Definition |
|------|------------|
| **Piece** | A chunk of the torrent file, typically 256KB. The unit of hash verification. |
| **Block** | A subdivision of a piece, typically 16KB. The unit of network transfer (REQUEST/PIECE messages). A 256KB piece has 16 blocks. |
| **Partial piece** | A piece still being downloaded—some blocks received, some still needed from peers. These are network-bound. |
| **Pending piece** | A piece with all blocks received but not yet SHA1-verified and flushed to disk. These are I/O-bound. |
| **Active piece** | Either a partial or pending piece. Currently tracked together in `ActivePieceManager`, but the partial cap (Phase 2) should only count partials. |
| **Seed** | A peer that has all pieces of the torrent. |
| **Availability** | The number of connected peers that have a given piece. Higher = more common, lower = rarer. |

**Important distinction**: The `peers × 1.5` cap applies to **partial pieces only**, not pending pieces. If disk I/O backs up, pending pieces queue separately and don't block new downloads from starting.

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

### 7. Separate Partials from Pending

Partial pieces (downloading) and pending pieces (awaiting verification) have different constraints:
- **Partials** are network-bound → cap at `peers × 1.5` to prevent fragmentation
- **Pending** are I/O-bound → queue separately, don't count against partial cap

This ensures disk I/O backups don't starve new downloads. The piece picker should only iterate partials when making requests.

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

**Goal**: Auto-cap **partial** pieces at `peers × 1.5`

**Important**: The cap applies only to partial pieces (still downloading), NOT pending pieces (complete but unverified). This ensures disk I/O backups don't starve the network—we can keep downloading while pieces queue for verification.

**Files to modify**:
- `packages/engine/src/core/active-piece-manager.ts`
- `packages/engine/src/core/torrent.ts`

**Code structure consideration**: Currently `ActivePieceManager` uses a single `Map<number, ActivePiece>` for all pieces. The code filters at runtime (`if (piece.haveAllBlocks) continue`) but counts both partial and pending toward limits.

**Recommended approach: Separate maps in ActivePieceManager**

Keep `ActivePieceManager` as the single class but split internal storage:

| Current | Proposed |
|---------|----------|
| `pieces: Map<number, ActivePiece>` | `_partialPieces: Map<number, ActivePiece>` |
| | `_pendingPieces: Map<number, ActivePiece>` |
| `activeCount` (counts all) | `partialCount` (O(1) - just map size) |
| | `pendingCount` (O(1) - just map size) |
| | `activeCount` (sum of both) |

**Why this approach:**
1. **O(1) partial count** - no filtering needed for cap check
2. **Matches libtorrent** - `m_downloads[piece_downloading]` vs `m_downloads[piece_full]`
3. **Single class** - keeps buffer pooling, timeout cleanup, and memory tracking together
4. **Clear lifecycle**: `getOrCreate()` → partial map → `promoteToPending()` → pending map → `removePending()`
5. **Minimal ActivePiece changes** - `haveAllBlocks` already distinguishes state; optionally add `state` field for logging

**Alternative considered: Separate PendingPieceManager class**
- More separation but over-engineering for this use case
- Would duplicate buffer pooling and cleanup logic
- Not recommended

**Changes to ActivePieceManager**:

```typescript
// ============================================
// ActivePieceManager - Recommended Changes
// ============================================

// Replace single map with two maps
private _partialPieces: Map<number, ActivePiece> = new Map()  // still downloading
private _pendingPieces: Map<number, ActivePiece> = new Map()  // awaiting verification

// --- Counts (all O(1)) ---

get partialCount(): number {
  return this._partialPieces.size
}

get pendingCount(): number {
  return this._pendingPieces.size
}

get activeCount(): number {
  return this._partialPieces.size + this._pendingPieces.size
}

// --- Cap Logic ---

// Add threshold check - counts PARTIALS only, not pending
shouldPrioritizePartials(connectedPeerCount: number): boolean {
  const threshold = Math.floor(connectedPeerCount * 1.5)
  const blockCap = Math.floor(2048 / this.blocksPerPiece)
  const maxAllowed = Math.min(threshold, blockCap)

  return this.partialCount > maxAllowed  // NOT activeCount
}

getMaxPartials(connectedPeerCount: number): number {
  const threshold = Math.floor(connectedPeerCount * 1.5)
  const blockCap = Math.floor(2048 / this.blocksPerPiece)
  return Math.min(threshold, blockCap)
}

// --- Lifecycle Methods ---

// Create goes to partial map (unchanged signature)
getOrCreate(index: number): ActivePiece | null {
  // Check partial map first
  let piece = this._partialPieces.get(index)
  if (piece) return piece

  // Also check pending (shouldn't happen but defensive)
  piece = this._pendingPieces.get(index)
  if (piece) return piece

  // Check limits...
  // Create and add to PARTIAL map
  piece = new ActivePiece(index, length, buffer)
  this._partialPieces.set(index, piece)
  return piece
}

// Get checks both maps
get(index: number): ActivePiece | undefined {
  return this._partialPieces.get(index) ?? this._pendingPieces.get(index)
}

has(index: number): boolean {
  return this._partialPieces.has(index) || this._pendingPieces.has(index)
}

// Move piece from partial to pending when all blocks received
promoteToPending(pieceIndex: number): void {
  const piece = this._partialPieces.get(pieceIndex)
  if (piece) {
    this._partialPieces.delete(pieceIndex)
    this._pendingPieces.set(pieceIndex, piece)
    this.logger.debug(`Piece ${pieceIndex} promoted to pending (awaiting verification)`)
  }
}

// Remove from pending after verification completes (success or failure)
removePending(pieceIndex: number): ActivePiece | undefined {
  const piece = this._pendingPieces.get(pieceIndex)
  if (piece) {
    this.releaseBuffer(piece)
    piece.clear()
    this._pendingPieces.delete(pieceIndex)
  }
  return piece
}

// Remove from either map (for abandonment, hash failure reset)
remove(index: number): void {
  const piece = this._partialPieces.get(index) ?? this._pendingPieces.get(index)
  if (piece) {
    this.releaseBuffer(piece)
    piece.clear()
    this._partialPieces.delete(index)
    this._pendingPieces.delete(index)
  }
}

// --- Iteration (critical for request loop) ---

// Iterate ONLY partial pieces (for request loop)
partialValues(): IterableIterator<ActivePiece> {
  return this._partialPieces.values()
}

// Iterate ONLY pending pieces (for verification queue)
pendingValues(): IterableIterator<ActivePiece> {
  return this._pendingPieces.values()
}

// Iterate all (for cleanup, memory tracking)
values(): IterableIterator<ActivePiece> {
  // Use generator to combine both without allocation
  return this.allPiecesIterator()
}

private *allPiecesIterator(): IterableIterator<ActivePiece> {
  yield* this._partialPieces.values()
  yield* this._pendingPieces.values()
}
```

**Changes to Torrent.requestPieces()**:

```typescript
private requestPieces(peer: PeerConnection): void {
  const peerCount = this.connectedPeers.length
  const prioritizePartials = this.activePieces.shouldPrioritizePartials(peerCount)

  // PHASE 1: Always try to complete existing partials first
  // Use partialValues() - ONLY iterates partial pieces, not pending
  for (const piece of this.activePieces.partialValues()) {
    // No need to check piece.haveAllBlocks - partialValues() only has partials
    if (!peerBitfield?.get(piece.index)) continue
    if (!piece.hasUnrequestedBlocks()) continue
    // ... request blocks
  }

  // PHASE 2: Only activate new pieces if under threshold
  if (prioritizePartials) {
    return  // Don't start new pieces when over limit
  }

  // ... existing phase 2 logic
}

// When a piece receives its final block:
private handleBlock(peer: PeerConnection, msg: WireMessage): void {
  const piece = this.activePieces.get(msg.index)
  // ... add block to piece ...

  if (piece.haveAllBlocks) {
    // Move to pending queue - no longer counts toward partial cap
    this.activePieces.promoteToPending(msg.index)
    // Queue for verification (async)
    this.verificationQueue.enqueue(msg.index)
  }
}

// After verification completes:
private async onVerificationComplete(index: number, success: boolean): Promise<void> {
  if (success) {
    this.activePieces.removePending(index)
    this._bitfield.set(index)
    // ... announce HAVE, etc.
  } else {
    // Hash failed - move back to partial for re-download
    // (handled in Phase 11)
  }
}
```

**libtorrent reference**: `piece_picker.cpp:1997-2008`

**Tests**: See [Phase 2 Tests](#phase-2-tests-partial-piece-limiting)

---

### Phase 3: Rarest-First Partial Sorting with Priority

**Goal**: Sort active pieces by priority, availability, then completion

**Files to modify**:
- `packages/engine/src/core/active-piece-manager.ts`
- `packages/engine/src/core/torrent.ts`

**libtorrent Priority Formula** (from `piece_picker.hpp:727-755`):

libtorrent uses: `availability × (8 - piece_priority) × 3 + adjustment`

- Priority levels: 0 (don't download) to 7 (highest)
- Default priority: 4
- Adjustment: -3 for downloading pieces, -2 for open pieces

This inverts priority: higher numeric priority (7) → lower sort key → picked first.

**Simplified Implementation for JSTorrent**:

```typescript
// Priority levels (matching libtorrent)
const PRIORITY_DONT_DOWNLOAD = 0
const PRIORITY_LOW = 1
const PRIORITY_DEFAULT = 4
const PRIORITY_HIGH = 7
const PRIORITY_LEVELS = 8
const PRIO_FACTOR = 3

// Calculate sort priority (lower = picked first)
function calculatePiecePriority(
  availability: number,
  piecePriority: number,
  isDownloading: boolean
): number {
  if (piecePriority === PRIORITY_DONT_DOWNLOAD) return Infinity

  const adjustment = isDownloading ? -3 : -2
  return availability * (PRIORITY_LEVELS - piecePriority) * PRIO_FACTOR + adjustment
}
```

**Changes to ActivePieceManager**:

```typescript
// Add sorting method with priority support
// Note: Only iterates partial pieces, NOT pending (complete but unverified)
getPartialsRarestFirst(
  availability: Uint16Array,
  seedCount: number,
  piecePriority: Uint8Array
): ActivePiece[] {
  const partials = [...this._partialPieces.values()]  // NOT _pendingPieces

  partials.sort((a, b) => {
    const prioA = piecePriority[a.index]
    const prioB = piecePriority[b.index]

    // Filtered pieces go last
    if (prioA === 0 && prioB !== 0) return 1
    if (prioB === 0 && prioA !== 0) return -1

    // Calculate combined priority (lower = better)
    const availA = availability[a.index] + seedCount
    const availB = availability[b.index] + seedCount

    const sortKeyA = availA * (PRIORITY_LEVELS - prioA) * PRIO_FACTOR
    const sortKeyB = availB * (PRIORITY_LEVELS - prioB) * PRIO_FACTOR

    if (sortKeyA !== sortKeyB) {
      return sortKeyA - sortKeyB
    }

    // Tiebreaker: most complete first (higher completion ratio)
    const completionA = a.blocksReceived / a.blocksNeeded
    const completionB = b.blocksReceived / b.blocksNeeded
    return completionB - completionA
  })

  return partials
}
```

**Priority Behavior Examples**:

| Scenario | Priority | Availability | Sort Key | Order |
|----------|----------|--------------|----------|-------|
| High priority, rare | 7 | 2 | 2×1×3 = 6 | First |
| High priority, common | 7 | 10 | 10×1×3 = 30 | Second |
| Default priority, rare | 4 | 2 | 2×4×3 = 24 | Third |
| Low priority, rare | 1 | 2 | 2×7×3 = 42 | Last |

**libtorrent reference**: `piece_picker.hpp:727-755`, `piece_picker.cpp:1934-1947`

**Sorting Performance Note**:

`getPartialsRarestFirst()` sorts the partial piece list on every tick. This is acceptable because:
1. Phase 2 caps partials at `peers × 1.5` (typically 30-50 pieces)
2. Pending pieces (awaiting verification) are in a separate list and not sorted here
3. Sorting 50 items is O(50 log 50) ≈ 280 comparisons per tick—negligible overhead

A heap structure would add complexity for minimal gain at this scale.

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

  // Piece has a fast owner (only fast peers claim exclusive ownership)
  // Fast peers CAN share with each other (no fragmentation concern)
  // Slow peers CANNOT join fast-owned pieces (prevents fragmentation)
  //
  // The fragmentation problem:
  // - Fast peer A (1MB/s) requests blocks 0-7 of piece X
  // - Slow peer B (10KB/s) requests blocks 8-15 of piece X
  // - Fast peer finishes in 2 seconds, but waits 200+ seconds for slow peer
  // - Piece X is stuck at 50% for 200 seconds due to fragmentation
  return peerIsFast
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

### Phase 9: End-Game Mode

**Goal**: Speed up final piece completion by requesting duplicate blocks

End-game mode activates when all remaining pieces are already being downloaded and a peer still has request capacity. Blocks are requested from multiple peers simultaneously, with immediate cancellation when received.

**libtorrent reference**: `request_blocks.cpp:264-281`, `piece_picker.cpp:2356-2468`

**Trigger condition**:

```typescript
// End-game triggers when:
// 1. We tried to pick blocks but got none (all needed pieces are active)
// 2. Peer still has room in their pipeline
// 3. Peer is not choked

private requestPieces(peer: PeerConnection): void {
  // ... normal Phase 1 & 2 logic ...

  // If we couldn't fill the pipeline and there are active pieces
  if (peer.requestsPending < pipelineLimit && this.activePieces.activeCount > 0) {
    this.requestEndgameBlocks(peer)
  }
}
```

**End-game block selection**:

```typescript
private requestEndgameBlocks(peer: PeerConnection): void {
  const pipelineLimit = peer.pipelineDepth
  const peerId = peer.id

  // Find blocks already requested from OTHER peers
  const busyBlocks: Array<{piece: ActivePiece, blockIndex: number}> = []

  for (const piece of this.activePieces.values()) {
    // Skip if peer doesn't have this piece
    if (!peer.isSeed && !peer.bitfield?.get(piece.index)) continue

    for (let blockIndex = 0; blockIndex < piece.blocksNeeded; blockIndex++) {
      // Skip received blocks
      if (piece.blockReceived[blockIndex]) continue

      // Get peers that have requested this block
      const requesters = piece.blockRequests.get(blockIndex)
      if (!requesters || requesters.length === 0) continue

      // Skip if WE already requested it
      if (requesters.includes(peerId)) continue

      // This is a "busy" block - requested by others but not us
      busyBlocks.push({ piece, blockIndex })
    }
  }

  if (busyBlocks.length === 0) return

  // Request ONE random busy block per call (libtorrent pattern)
  const idx = Math.floor(Math.random() * busyBlocks.length)
  const { piece, blockIndex } = busyBlocks[idx]

  this.sendBlockRequest(peer, piece, { index: blockIndex })
  piece.addRequest(blockIndex, peerId)
  piece.markBusyBlock(blockIndex)  // Track for cancel logic
}
```

**Cancel duplicates on block receive**:

```typescript
// In block receive handler
private onBlockReceived(peer: PeerConnection, pieceIndex: number, blockOffset: number, data: Uint8Array): void {
  const blockIndex = blockOffset / BLOCK_SIZE
  const piece = this.activePieces.get(pieceIndex)
  if (!piece) return

  // Check if multiple peers have this block
  const requesters = piece.blockRequests.get(blockIndex)
  if (requesters && requesters.length > 1) {
    // Cancel from all OTHER peers
    for (const otherPeerId of requesters) {
      if (otherPeerId === peer.id) continue

      const otherPeer = this.getPeerById(otherPeerId)
      if (otherPeer) {
        otherPeer.sendCancel(pieceIndex, blockOffset, BLOCK_SIZE)
      }
    }
  }

  // ... rest of block handling ...
}
```

**Configuration constants**:

```typescript
const ENDGAME_MAX_PARTIALS_TO_CHECK = 200  // Limit CPU in end-game
```

**Tests**: See [Phase 9 Tests](#phase-9-tests-end-game-mode)

---

### Phase 10: Peer Disconnect Cleanup

**Goal**: Properly clean up state when peers disconnect

When a peer disconnects, their pending requests must be cleared so blocks can be reassigned to other peers.

**libtorrent reference**: `peer_connection.cpp:4501-4512`, `piece_picker.cpp:3807-3876`

**Changes to PeerConnection**:

```typescript
// Track all pending requests for this peer
private pendingRequests: Set<string> = new Set()  // "pieceIndex:blockIndex"

addPendingRequest(pieceIndex: number, blockIndex: number): void {
  this.pendingRequests.add(`${pieceIndex}:${blockIndex}`)
}

removePendingRequest(pieceIndex: number, blockIndex: number): void {
  this.pendingRequests.delete(`${pieceIndex}:${blockIndex}`)
}

// Called on disconnect
clearAllRequests(): Array<{pieceIndex: number, blockIndex: number}> {
  const requests: Array<{pieceIndex: number, blockIndex: number}> = []
  for (const key of this.pendingRequests) {
    const [pieceIndex, blockIndex] = key.split(':').map(Number)
    requests.push({ pieceIndex, blockIndex })
  }
  this.pendingRequests.clear()
  return requests
}
```

**Changes to Torrent**:

```typescript
private onPeerDisconnect(peer: PeerConnection): void {
  const peerId = peer.id

  // 1. Clear all pending requests from active pieces
  const clearedRequests = peer.clearAllRequests()
  for (const { pieceIndex, blockIndex } of clearedRequests) {
    const piece = this.activePieces.get(pieceIndex)
    if (piece) {
      piece.cancelRequest(blockIndex, peerId)
      // Clear ownership if this peer owned the piece
      if (piece.exclusivePeer === peerId) {
        piece.exclusivePeer = null
      }
    }
  }

  // 2. Update availability (already in Phase 1)
  this.updateAvailability(peer, -1)

  // 3. Remove from connected peers list
  this.connectedPeers = this.connectedPeers.filter(p => p.id !== peerId)

  this.logger.debug(`Peer ${peerId} disconnected, cleared ${clearedRequests.length} pending requests`)
}
```

**Tests**: See [Phase 10 Tests](#phase-10-tests-peer-disconnect-cleanup)

---

### Phase 11: Hash Check Failure Recovery

**Goal**: Handle failed piece verification and ban bad peers

When a piece fails hash verification, it must be reset for re-downloading and the responsible peer(s) tracked.

**libtorrent reference**: `torrent.cpp:4540-4665`, `piece_picker.cpp:1088-1163`

**Configuration constants**:

```typescript
const PEER_TRUST_MIN = -7           // Minimum trust points (ban threshold)
const PEER_TRUST_MAX = 8            // Maximum trust points
const PEER_TRUST_PENALTY = 2        // Points lost per hash failure
const PEER_MAX_HASHFAILS = 255      // Cap on tracked failures
```

**Changes to PeerConnection**:

```typescript
// Trust and ban tracking
trustPoints: number = 0           // Range: [-7, 8]
hashFailures: number = 0          // Count of pieces that failed hash
banned: boolean = false
onParole: boolean = false         // Restricted to full pieces only

recordHashFailure(): void {
  this.trustPoints = Math.max(PEER_TRUST_MIN, this.trustPoints - PEER_TRUST_PENALTY)
  this.hashFailures = Math.min(PEER_MAX_HASHFAILS, this.hashFailures + 1)

  // Put on parole after first failure
  this.onParole = true
}

shouldBan(): boolean {
  return this.trustPoints <= PEER_TRUST_MIN
}
```

**Changes to ActivePiece**:

```typescript
// Track which peers contributed blocks
private blockPeers: Map<number, string> = new Map()  // blockIndex -> peerId

recordBlockPeer(blockIndex: number, peerId: string): void {
  this.blockPeers.set(blockIndex, peerId)
}

// Get all peers who contributed to this piece
getContributingPeers(): Set<string> {
  return new Set(this.blockPeers.values())
}

// Reset piece for re-download
reset(): void {
  this.blockReceived.fill(false)
  this.blockRequests.clear()
  this.blockRequestTimes.clear()
  this.blockPeers.clear()
  this._unrequestedCount = this.blocksNeeded
  this.exclusivePeer = null
  this.activatedAt = Date.now()
}
```

**Changes to Torrent**:

```typescript
private async onPieceComplete(pieceIndex: number): Promise<void> {
  const piece = this.activePieces.get(pieceIndex)
  if (!piece) return

  // Verify hash
  const data = piece.assembleData()
  const hash = await this.hashPiece(data)
  const expected = this.pieceHashes[pieceIndex]

  if (hash === expected) {
    // Success - mark as complete
    this._bitfield.set(pieceIndex)
    this.activePieces.remove(pieceIndex)
    // ... announce HAVE, check completion, etc.
  } else {
    // Hash failed - penalize peers and reset piece
    this.onPieceHashFailed(pieceIndex, piece)
  }
}

private onPieceHashFailed(pieceIndex: number, piece: ActivePiece): void {
  this.logger.warn(`Piece ${pieceIndex} failed hash verification`)

  // Penalize all contributing peers
  const contributors = piece.getContributingPeers()
  for (const peerId of contributors) {
    const peer = this.getPeerById(peerId)
    if (!peer) continue

    peer.recordHashFailure()

    if (peer.shouldBan()) {
      this.logger.info(`Banning peer ${peerId} for too many hash failures`)
      peer.banned = true
      peer.disconnect('too_many_hash_failures')
    }
  }

  // Reset piece for re-download
  piece.reset()

  // Emit event for UI/logging
  this.emit('hashFailed', { pieceIndex, contributors: [...contributors] })
}
```

**Tests**: See [Phase 11 Tests](#phase-11-tests-hash-check-failure-recovery)

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

### Phase 9 Tests: End-Game Mode

```typescript
describe('End-Game Mode', () => {
  test('activates when all pieces are active and peer has capacity', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      peers: [{ id: 'peer1', bitfield: allTrue(5) }]
    })

    // Activate all needed pieces
    for (let i = 0; i < 5; i++) {
      activePieces.getOrCreate(i)
    }

    // Request all blocks from first peer
    torrent.requestPieces(peer1)

    // Add second peer with capacity
    torrent.addPeer(peer2, allTrue(5))

    const requestsBefore = peer2.requestsPending
    torrent.requestPieces(peer2)

    // Should have made end-game requests (duplicates)
    expect(peer2.requestsPending).toBeGreaterThan(requestsBefore)
  })

  test('requests blocks already requested by other peers', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 1,
      blocksPerPiece: 4,
      peers: [
        { id: 'peer1', bitfield: [true] },
        { id: 'peer2', bitfield: [true] }
      ]
    })

    const piece = activePieces.getOrCreate(0)!

    // Peer1 requests all blocks
    piece.addRequest(0, 'peer1')
    piece.addRequest(1, 'peer1')
    piece.addRequest(2, 'peer1')
    piece.addRequest(3, 'peer1')

    // Peer2 should be able to request duplicates in end-game
    torrent.requestEndgameBlocks(peer2)

    // At least one block should be requested from both peers
    const requests = piece.blockRequests
    const hasSharedBlock = [...requests.values()].some(
      peers => peers.includes('peer1') && peers.includes('peer2')
    )
    expect(hasSharedBlock).toBe(true)
  })

  test('cancels duplicate requests when block received', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 1,
      blocksPerPiece: 4,
      peers: [
        { id: 'peer1', bitfield: [true] },
        { id: 'peer2', bitfield: [true] }
      ]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.addRequest(0, 'peer1')
    piece.addRequest(0, 'peer2')  // duplicate

    const cancelSpy = jest.spyOn(peer2, 'sendCancel')

    // Peer1 delivers the block
    torrent.onBlockReceived(peer1, 0, 0, new Uint8Array(BLOCK_SIZE))

    expect(cancelSpy).toHaveBeenCalledWith(0, 0, BLOCK_SIZE)
  })

  test('limits partial pieces checked to 200', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 300,
      peers: [{ id: 'peer1', bitfield: allTrue(300) }]
    })

    // Create 250 partial pieces
    for (let i = 0; i < 250; i++) {
      const piece = activePieces.getOrCreate(i)!
      piece.addRequest(0, 'other')  // Mark as busy
    }

    const start = performance.now()
    torrent.requestEndgameBlocks(peer1)
    const elapsed = performance.now() - start

    // Should complete quickly due to 200 limit
    expect(elapsed).toBeLessThan(10)
  })
})
```

### Phase 10 Tests: Peer Disconnect Cleanup

```typescript
describe('Peer Disconnect Cleanup', () => {
  test('clears pending requests from active pieces', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      peers: [{ id: 'peer1', bitfield: allTrue(5) }]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.addRequest(0, 'peer1')
    piece.addRequest(1, 'peer1')

    expect(piece.blockRequests.size).toBe(2)

    torrent.onPeerDisconnect(peer1)

    expect(piece.blockRequests.size).toBe(0)
  })

  test('clears exclusive ownership on disconnect', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      peers: [{ id: 'peer1', bitfield: allTrue(5), isFast: true }]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.claimExclusive('peer1')

    expect(piece.exclusivePeer).toBe('peer1')

    torrent.onPeerDisconnect(peer1)

    expect(piece.exclusivePeer).toBeNull()
  })

  test('updates availability on disconnect', () => {
    const { torrent } = setupPicker({ pieceCount: 4 })

    torrent.addPeer(peer1, bitfield([true, true, false, false]))

    expect(torrent.pieceAvailability).toEqual([1, 1, 0, 0])

    torrent.onPeerDisconnect(peer1)

    expect(torrent.pieceAvailability).toEqual([0, 0, 0, 0])
  })

  test('blocks become available for other peers after disconnect', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 1,
      blocksPerPiece: 4,
      peers: [
        { id: 'peer1', bitfield: [true] },
        { id: 'peer2', bitfield: [true] }
      ]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.addRequest(0, 'peer1')
    piece.addRequest(1, 'peer1')

    expect(piece.hasUnrequestedBlocks).toBe(true)  // blocks 2,3

    // Disconnect peer1
    torrent.onPeerDisconnect(peer1)

    // Now blocks 0,1 are also unrequested
    expect(piece.blockRequests.size).toBe(0)

    // Peer2 can request them
    const requests = collectRequests(peer2, torrent)
    expect(requests.length).toBe(4)  // All 4 blocks available
  })
})
```

### Phase 11 Tests: Hash Check Failure Recovery

```typescript
describe('Hash Check Failure Recovery', () => {
  test('resets piece state on hash failure', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      blocksPerPiece: 4
    })

    const piece = activePieces.getOrCreate(0)!
    piece.blockReceived[0] = true
    piece.blockReceived[1] = true
    piece.blockReceived[2] = true
    piece.blockReceived[3] = true

    torrent.onPieceHashFailed(0, piece)

    expect(piece.blockReceived.every(b => b === false)).toBe(true)
    expect(piece.hasUnrequestedBlocks).toBe(true)
  })

  test('penalizes contributing peers', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      peers: [
        { id: 'peer1', bitfield: allTrue(5) },
        { id: 'peer2', bitfield: allTrue(5) }
      ]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.recordBlockPeer(0, 'peer1')
    piece.recordBlockPeer(1, 'peer1')
    piece.recordBlockPeer(2, 'peer2')
    piece.recordBlockPeer(3, 'peer2')

    torrent.onPieceHashFailed(0, piece)

    expect(peer1.trustPoints).toBe(-2)
    expect(peer2.trustPoints).toBe(-2)
    expect(peer1.hashFailures).toBe(1)
    expect(peer2.hashFailures).toBe(1)
  })

  test('bans peer at trust threshold', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 10,
      peers: [{ id: 'badpeer', bitfield: allTrue(10) }]
    })

    // Simulate 4 hash failures (trust goes -2, -4, -6, -8 -> capped at -7)
    for (let i = 0; i < 4; i++) {
      const piece = activePieces.getOrCreate(i)!
      piece.recordBlockPeer(0, 'badpeer')
      piece.blockReceived[0] = true
      torrent.onPieceHashFailed(i, piece)
    }

    expect(badpeer.banned).toBe(true)
    expect(badpeer.trustPoints).toBe(-7)
  })

  test('puts peer on parole after first failure', () => {
    const { torrent, activePieces } = setupPicker({
      pieceCount: 5,
      peers: [{ id: 'peer1', bitfield: allTrue(5) }]
    })

    const piece = activePieces.getOrCreate(0)!
    piece.recordBlockPeer(0, 'peer1')

    expect(peer1.onParole).toBe(false)

    torrent.onPieceHashFailed(0, piece)

    expect(peer1.onParole).toBe(true)
  })

  test('tracks contributing peers per block', () => {
    const piece = new ActivePiece(0, 4)

    piece.recordBlockPeer(0, 'peer1')
    piece.recordBlockPeer(1, 'peer2')
    piece.recordBlockPeer(2, 'peer1')
    piece.recordBlockPeer(3, 'peer3')

    const contributors = piece.getContributingPeers()

    expect(contributors.size).toBe(3)
    expect(contributors.has('peer1')).toBe(true)
    expect(contributors.has('peer2')).toBe(true)
    expect(contributors.has('peer3')).toBe(true)
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

**Core Phases (1-7)**:
- [ ] Partial pieces capped at `peers × 1.5` (max 2048 blocks)
- [ ] Rarest-first selection with priority integration and completion tiebreaker
- [ ] Seeds tracked separately, skip bitfield checks
- [ ] Fast peers own pieces exclusively
- [ ] Stuck requests timeout after 10s
- [ ] Abandoned pieces removed after 30s with <50% progress

**End-Game Mode (Phase 9)**:
- [ ] Activates when all needed pieces are active
- [ ] Requests blocks from multiple peers simultaneously
- [ ] Cancels duplicate requests immediately on block receive
- [ ] Limits partial pieces checked to 200 for performance

**Peer Disconnect (Phase 10)**:
- [ ] Clears pending requests from active pieces
- [ ] Clears exclusive ownership
- [ ] Updates availability counters
- [ ] Blocks become available for other peers

**Hash Failure Recovery (Phase 11)**:
- [ ] Resets piece state for re-download
- [ ] Penalizes contributing peers (trust points)
- [ ] Bans peers at trust threshold (-7)
- [ ] Puts peers on parole after first failure

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
| `src/piece_picker.cpp` | Main picker logic, partial limiting, sorting, abort_download |
| `include/libtorrent/piece_picker.hpp` | Data structures, piece_pos, downloading_piece, priority formula |
| `src/peer_connection.cpp` | Request timeout, per-peer handling, disconnect cleanup |
| `src/request_blocks.cpp` | End-game mode trigger and busy block selection |
| `src/torrent.cpp` | Hash failure handling, peer banning, availability updates |
| `src/smart_ban.cpp` | Smart ban plugin for identifying bad peers via CRC |
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
| End-game trigger | `request_blocks.cpp:264-281` |
| End-game block picking | `piece_picker.cpp:2356-2468` |
| End-game cancel duplicates | `peer_connection.cpp:3035-3057` |
| Peer disconnect cleanup | `peer_connection.cpp:4501-4512` |
| Abort download | `piece_picker.cpp:3807-3876` |
| Availability decrement | `torrent.cpp:6201-6213` |
| Hash failure handling | `torrent.cpp:4540-4665` |
| Piece restore | `piece_picker.cpp:1088-1163` |
| Peer trust/ban | `torrent.cpp:4667-4738` |
| Smart ban plugin | `smart_ban.cpp:131-256` |
| Piece state enum | `piece_picker.hpp:171-233` |
| Piece full transition | `piece_picker.cpp:2985-2990` |
| prioritize_partials flag | `piece_picker.cpp:1997-2008` |

### Related Documents

| Document | Purpose |
|----------|---------|
| [piece-state-transitions.md](./piece-state-transitions.md) | Fix for single-peer stalls: align with libtorrent's piece state model |

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

1. **Phases 1-2**: Foundation (availability tracking, partial limits)
2. **Phases 3-4**: Sorting and algorithm rewrite (interdependent)
3. **Phase 5**: Health management (needs ownership model from Phase 4)
4. **Phases 6-7**: Optimizations (build on working system)
5. **Phase 8** (optional): Phase 2 index—only if Phase 2 performance is still insufficient
6. **Phases 9-11**: End-game, disconnect, hash failure (can be any order among themselves)

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

---

## Edge Cases and Fixes

This section documents edge cases discovered during implementation and testing, particularly scenarios not well-covered by the libtorrent reference design.

### Single-Peer Download Stalls (Fixed)

**Scenario**: Downloading from a single LAN seeder on Android. Download would stall for seconds, then burst briefly, then stall again.

**Root Cause**: The partial piece cap formula `peers × 1.5` yields a cap of **1** for a single peer. With pipeline depths of 250-500 requests, this creates a severe mismatch:

1. Piece 0 activated, all 16 blocks requested
2. Phase 2 blocked (1 partial >= cap of 1)
3. Peer has 484 unused request slots but can't start new pieces
4. Download stalls until a piece completes

**The Fix** (`torrent.ts`): When over the partial cap, only block Phase 2 if existing partials have unrequested blocks:

```typescript
if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
  // Check if existing partials can still provide work
  if (this.activePieces.hasUnrequestedBlocks()) {
    return // Existing partials have unrequested blocks - prioritize completion
  }
  // Fall through: existing partials are fully requested, need new pieces
}
```

**Why libtorrent doesn't have this problem**: libtorrent tracks a `piece_full` state for pieces where all blocks are requested but not all received. These pieces **don't count against the partial cap**. When you request the last block of a piece, it moves from `piece_downloading` → `piece_full`, immediately freeing a slot for a new piece. libtorrent's default `max_out_request_queue` is also 500, similar to ours.

### Speed Affinity Logic Inversion (Fixed)

**Scenario**: The `canRequestFrom()` logic for speed affinity was preventing fast peers from sharing pieces instead of slow peers.

**Original (wrong)**:
```typescript
// Fast peers don't share with others - prevents fragmentation
if (peerIsFast) {
  return false  // WRONG: blocks fast peers
}
return true  // Allows slow peers - causes fragmentation!
```

**Fixed**:
```typescript
// Piece has a fast owner (only fast peers claim exclusive ownership)
// Fast peers CAN join: fast+fast sharing doesn't cause fragmentation
// Slow peers CANNOT join: prevents fragmentation
return peerIsFast
```

**The fragmentation problem this prevents**:
- Fast peer A (1MB/s) requests blocks 0-7 of piece X
- Slow peer B (10KB/s) requests blocks 8-15 of piece X
- Fast peer finishes in 2 seconds, waits 200+ seconds for slow peer
- Piece X stuck at 50% completion for 200 seconds

### Cold Start Speed Classification

**Observation**: New peers have 0 download speed, so `isFast` returns false. They are initially treated as "slow".

**Impact**: Minimal. Slow peers can still request blocks from any unclaimed piece. They can't claim exclusive ownership, but they can start pieces. Speed is measured over time and peers are reclassified as data arrives.

**Potential improvement**: Consider an initial speed assumption based on connection type (LAN IP ranges vs internet) or round-trip time.

### Partial Cap vs Pipeline Depth Mismatch

**Observation**: The partial cap formula from libtorrent (`peers × 1.5`) assumes conservative pipeline depths. With aggressive pipeline depths (500), a single peer with cap=1 can only utilize 16 blocks (one piece) without the fix above.

**Current mitigation**: The `hasUnrequestedBlocks()` check allows starting new pieces when existing partials are fully requested.

**Proper fix**: See [piece-state-transitions.md](./piece-state-transitions.md) for aligning with libtorrent's three-state model (`piece_downloading` → `piece_full` → `piece_finished`). libtorrent doesn't count `piece_full` pieces against the partial cap, which is the correct solution.

### Endgame Mode with Single Peer

**Observation**: Endgame mode requests duplicate blocks from multiple peers, but with a single peer this is meaningless.

**Impact**: None. Endgame checks `isEndgame` flag which only activates when appropriate. Single-peer downloads complete normally without endgame.

### Design Principle: Prefer Falling Through Over Hard Blocks

A key lesson from these fixes: when blocking an operation based on a cap or threshold, always check if the reason for the cap still applies:

1. **Partial cap**: Blocks Phase 2 to prioritize completion, but only if there ARE blocks to complete
2. **Speed affinity**: Blocks slow peers to prevent fragmentation, but fast+fast sharing is fine
3. **Memory limit**: Blocks new pieces, but should allow existing pieces to complete

The pattern:
```typescript
if (shouldBlock(reason)) {
  if (canStillMakeProgress()) {
    return  // Block operation
  }
  // Fall through: blocking would cause a stall
}
```
