# JS Thread Bottleneck Analysis

**Date:** 2025-01-26
**Context:** Sawtooth download pattern observed on Pixel 9 downloading Ubuntu Server torrent (3.3GB, ~12,800 pieces)

## Observed Behavior

- Download speed oscillates between ~5-30 MB/s with frequent dips to near-zero
- JS thread latency: 150-900ms observed
- Pattern is characteristic of JS thread blocking - when busy processing, can't schedule new peer requests

## Torrent Characteristics (Ubuntu Server)

- Size: 3.3 GB
- Piece size: 256 KB
- Piece count: ~12,800
- Active peers: 17
- Progress when observed: 71% complete (~3,700 pieces remaining)

## Identified Bottlenecks

### 1. Phase 2 Linear Scan (CRITICAL)

**Location:** `packages/engine/src/core/torrent.ts:2864-2902`

```typescript
// PHASE 2: If still room, select new pieces sequentially (no sorting)
const pieceCount = this.piecesCount
for (let i = 0; i < pieceCount; i++) {
  if (peer.requestsPending >= pipelineLimit) break
  if (this._bitfield.get(i)) continue        // Already have it
  if (!peerBitfield.get(i)) continue         // Peer doesn't have it
  if (this._piecePriority[i] === 0) continue // Skipped file
  if (this.activePieces.has(i)) continue     // Already active
  // ... create piece and send requests
}
```

**Problem:** Scans ALL pieces (12,800) to find new ones to request. Called via `scheduleRequestPieces()` after every block arrives.

**Frequency estimate:**
- 17 peers × ~10 MB/s ÷ 16KB blocks = ~640 blocks/sec
- Microtask batching coalesces to ~50-100 batches/sec
- Each batch processes multiple peers, each triggering Phase 2
- Result: ~10-20M piece checks per second

**Optimization:** Track `_firstNeededPiece` index. Since pieces complete roughly in order (sequential mode), start loop there instead of 0. For 71% complete torrent: 12,800 → 3,700 iterations.

### 2. updateInterest Bitfield Scan (HIGH)

**Location:** `packages/engine/src/core/torrent.ts:2706-2712`

```typescript
for (let i = 0; i < this.bitfield.size; i++) {
  if (this.shouldRequestPiece(i) && peer.bitfield.get(i)) {
    interested = true
    break  // Has early exit, but worst case is O(n)
  }
}
```

**Problem:** Called on every `have`, `bitfield`, `have_all` event from peers. Worst case scans all pieces.

**Optimization:** Cache "interested in peer" state, invalidate only when our needs change (piece completes) or peer's bitfield changes meaningfully.

### 3. Piece Availability Updates (HIGH)

**Location:** `packages/engine/src/core/torrent.ts:2266-2270, 2294-2296`

```typescript
// On BITFIELD event
for (let i = 0; i < this.piecesCount; i++) {
  if (bf.get(i)) {
    this._pieceAvailability[i]++
  }
}

// On HAVE_ALL event
for (let i = 0; i < this.piecesCount; i++) {
  this._pieceAvailability[i]++
}
```

**Problem:** Full O(n) loop on every peer handshake. With many peers connecting, causes burst of thread stalls.

**Optimization:** For `have_all`, just track count separately. For bitfield, consider lazy/deferred updates.

### 4. shouldRequestPiece() Per-Piece Overhead (MODERATE)

**Location:** `packages/engine/src/core/torrent.ts:1210-1220`

```typescript
shouldRequestPiece(index: number): boolean {
  if (this._bitfield?.get(index)) return false           // Lookup 1
  if (this._piecePriority && this._piecePriority[index] === 0) return false  // Lookup 2
  if (this._pieceClassification.length > 0) {
    if (this._pieceClassification[index] === 'blacklisted') return false  // Lookup 3
  }
  return true
}
```

**Problem:** 3 array/bitfield lookups per piece. Called millions of times.

**Optimization:** Inline checks in hot loops, or precompute a combined "requestable" bitfield.

## Why QuickJS is Affected More Than V8

V8's JIT compiler optimizes tight loops extremely well:
- Inline caching for property accesses
- Loop unrolling
- Type specialization

QuickJS is a pure interpreter:
- Every operation has interpreter overhead
- No speculative optimization
- Array access is slower

A loop that takes 1μs per iteration on V8 might take 10-50μs on QuickJS.

## Benchmarking Strategy

### Goal

Create a reproducible benchmark that:
1. Uses similar torrent characteristics to Ubuntu Server
2. Runs in Node.js with JIT disabled to approximate QuickJS
3. Measures time spent in critical functions
4. Validates optimization impact before deploying to Android

### Node.js JIT-less Mode

```bash
node --jitless script.js
```

The `--jitless` flag disables V8's optimizing compilers (TurboFan, Sparkplug), leaving only the interpreter. This approximates QuickJS performance characteristics.

**Caveats:**
- Still faster than QuickJS (V8's interpreter is highly optimized)
- Memory behavior differs
- Good for relative comparisons, not absolute numbers

### Benchmark Torrent Specification

Create a synthetic torrent matching Ubuntu Server characteristics:

| Property | Value |
|----------|-------|
| Total size | 3.3 GB |
| Piece size | 256 KB |
| Piece count | 12,881 |
| File count | 1 (single file simplifies testing) |

### Benchmark Scenarios

#### Scenario 1: Phase 2 Piece Selection

Measure `requestPieces()` with varying completion percentages:

```typescript
// Synthetic setup
const pieceCount = 12881
const scenarios = [
  { name: '0% complete', completedPieces: 0 },
  { name: '50% complete', completedPieces: 6440 },
  { name: '71% complete', completedPieces: 9145 },  // Match observed
  { name: '95% complete', completedPieces: 12237 },
]

// For each scenario, simulate:
// - Set bitfield to mark completed pieces
// - Create mock peer with full bitfield
// - Call requestPieces() 1000 times
// - Measure total time
```

#### Scenario 2: Sustained Download Simulation

Simulate realistic download with multiple peers:

```typescript
// Setup
const peers = 20
const blocksPerSecond = 1000  // ~16 MB/s total
const testDurationMs = 10000

// Simulate block arrivals triggering:
// - handleBlock()
// - scheduleRequestPieces()
// - requestPieces()

// Measure:
// - Total JS execution time
// - Time spent in requestPieces()
// - Time spent in updateInterest()
// - Simulated download rate vs theoretical max
```

#### Scenario 3: Peer Churn

Simulate peers connecting/disconnecting:

```typescript
// Simulate 50 peer connections over 10 seconds
// Each triggers:
// - bitfield/have_all processing
// - updateInterest()
// - piece availability updates

// Measure thread blocking time during peer churn
```

### Implementation Approach

#### Option A: Isolated Function Benchmarks

Extract critical functions into standalone benchmark:

```typescript
// benchmark/piece-selection.bench.ts
import { Bench } from 'tinybench'
import { BitField } from '../src/core/bitfield'

const bench = new Bench({ time: 5000 })

// Create realistic state
const pieceCount = 12881
const bitfield = new BitField(pieceCount)
const peerBitfield = new BitField(pieceCount)
const piecePriority = new Uint8Array(pieceCount).fill(1)
const activePieces = new Set<number>()

// Mark 71% complete
for (let i = 0; i < 9145; i++) bitfield.set(i)
// Peer has all
for (let i = 0; i < pieceCount; i++) peerBitfield.set(i)

bench.add('phase2-current', () => {
  // Current implementation
  for (let i = 0; i < pieceCount; i++) {
    if (bitfield.get(i)) continue
    if (!peerBitfield.get(i)) continue
    if (piecePriority[i] === 0) continue
    if (activePieces.has(i)) continue
    break // Found one
  }
})

bench.add('phase2-optimized', () => {
  // With firstNeededPiece optimization
  const firstNeeded = 9145 // Track this incrementally
  for (let i = firstNeeded; i < pieceCount; i++) {
    if (bitfield.get(i)) continue
    if (!peerBitfield.get(i)) continue
    if (piecePriority[i] === 0) continue
    if (activePieces.has(i)) continue
    break
  }
})

await bench.run()
console.table(bench.table())
```

Run with:
```bash
node --jitless benchmark/piece-selection.bench.ts
```

#### Option B: Integration Test with Mock I/O

Use existing engine with mock network/storage adapters:

```typescript
// test/perf/download-simulation.test.ts
import { BtEngine } from '../../src/bt-engine'
import { MockNetworkAdapter, MockStorageAdapter } from './mocks'

test('sustained download performance', async () => {
  const engine = new BtEngine({
    network: new MockNetworkAdapter(),
    storage: new MockStorageAdapter(),
  })

  // Load torrent metadata (pre-generated .torrent file)
  await engine.addTorrent(ubuntuServerTorrent)

  // Simulate 20 peers sending blocks
  const startTime = performance.now()
  await simulateDownload(engine, {
    peers: 20,
    targetSpeed: 16 * 1024 * 1024, // 16 MB/s
    duration: 10000,
  })
  const elapsed = performance.now() - startTime

  // Assert JS overhead is acceptable
  expect(elapsed).toBeLessThan(12000) // <20% overhead
})
```

### Metrics to Track

1. **requestPieces() time per call** - Target: <1ms in jitless mode
2. **updateInterest() time per call** - Target: <0.5ms
3. **Piece availability update time** - Target: <5ms per peer
4. **Total JS overhead %** - Target: <10% of wall clock time
5. **Simulated vs theoretical throughput** - Target: >90%

### Creating Test Torrent

```bash
# Generate 3.3GB test file
dd if=/dev/urandom of=test-3.3gb.bin bs=1M count=3300

# Create torrent with 256KB pieces
# (use mktorrent or similar)
mktorrent -p -l 18 -a http://localhost:6969/announce test-3.3gb.bin
# -l 18 = 2^18 = 256KB pieces
```

Or generate programmatically:
```typescript
import { createTorrent } from '../src/core/torrent-creator'

const torrent = createTorrent({
  name: 'perf-test-3.3gb',
  pieceLength: 256 * 1024,
  files: [{ path: 'test.bin', length: 3.3 * 1024 * 1024 * 1024 }],
  // Use zero-filled pieces for deterministic hashes
})
```

## Proposed Optimizations

### Priority 1: First Needed Piece Tracking

```typescript
// Add to Torrent class
private _firstNeededPiece: number = 0

// Update when piece completes
private onPieceComplete(index: number) {
  if (index === this._firstNeededPiece) {
    // Scan forward to find next needed
    while (this._firstNeededPiece < this.piecesCount &&
           this._bitfield.get(this._firstNeededPiece)) {
      this._firstNeededPiece++
    }
  }
}

// Use in Phase 2
for (let i = this._firstNeededPiece; i < pieceCount; i++) {
  // ...
}
```

**Expected impact:** 70% reduction in Phase 2 iterations for 70% complete torrent.

### Priority 2: Batch updateInterest

```typescript
private _pendingInterestUpdates = new Set<PeerConnection>()
private _interestUpdateScheduled = false

private scheduleInterestUpdate(peer: PeerConnection) {
  this._pendingInterestUpdates.add(peer)
  if (!this._interestUpdateScheduled) {
    this._interestUpdateScheduled = true
    queueMicrotask(() => {
      for (const p of this._pendingInterestUpdates) {
        this.updateInterest(p)
      }
      this._pendingInterestUpdates.clear()
      this._interestUpdateScheduled = false
    })
  }
}
```

### Priority 3: Skip Phase 2 When Saturated

```typescript
// In requestPieces(), before Phase 2:
const unchokedPeers = this.connectedPeers.filter(p => !p.peerChoking)
const totalPipelineCapacity = unchokedPeers.length * avgPipelineLimit
const activeBlocksNeeded = this.activePieces.totalUnrequestedBlocks()

if (activeBlocksNeeded >= totalPipelineCapacity) {
  // Active pieces have enough work, skip Phase 2
  return
}
```

## Benchmark Results

Benchmarks were implemented and run to validate the optimization impact.

### Benchmark Files

- `packages/engine/benchmark/piece-selection.bench.ts` - Vitest benchmark for CI
- `packages/engine/benchmark/piece-selection-standalone.ts` - Standalone script for `--jitless` testing

### Running Benchmarks

```bash
# With V8 JIT (fast, for CI)
cd packages/engine && pnpm bench

# With JIT disabled (approximates QuickJS performance)
cd packages/engine && npx tsx benchmark/piece-selection-standalone.ts
node --jitless --import tsx benchmark/piece-selection-standalone.ts
```

### Results: V8 with JIT Enabled

| Completion | Current | Optimized | Speedup |
|------------|---------|-----------|---------|
| 50% | 0.105ms/batch | 0.006ms/batch | **17x** |
| 71% | 0.143ms/batch | 0.006ms/batch | **23x** |
| 90% | 0.197ms/batch | 0.006ms/batch | **33x** |
| 99% | 0.201ms/batch | 0.006ms/batch | **33x** |

Sustained (100 batches = 1 second of download activity):
- 71% complete: 14.7ms → 0.6ms (**25x faster**)
- 99% complete: 20.2ms → 0.6ms (**33x faster**)

### Results: V8 with JIT Disabled (--jitless, approximating QuickJS)

| Completion | Current | Optimized | Speedup |
|------------|---------|-----------|---------|
| 50% | 6.5ms/batch | 0.16ms/batch | **40x** |
| 71% | 9.2ms/batch | 0.16ms/batch | **57x** |
| 90% | 11.7ms/batch | 0.16ms/batch | **72x** |
| 99% | 12.9ms/batch | 0.16ms/batch | **79x** |

Sustained (100 batches = 1 second of download activity):
- 71% complete: **933ms → 16ms** (**57x faster**)
- 99% complete: **1304ms → 17ms** (**78x faster**)

### Key Finding

Without optimization, the JS thread was spending **93% of every second** on piece selection alone at 71% completion. This explains the sawtooth download pattern - the thread is almost entirely blocked by piece selection, leaving no time for other work.

With the `_firstNeededPiece` optimization, piece selection drops to ~1.6% of CPU time.

## Implementation Status

### Completed

1. [x] Create benchmark harness with jitless mode support
2. [x] Implement "first needed piece" optimization (`torrent.ts`)
3. [x] Measure improvement (57-78x faster in jitless mode)
4. [x] Add unit tests (`test/core/first-needed-piece.test.ts`)
5. [x] **Phase 1 zero-allocation iteration** - Use `values()` iterator instead of `Array.from()` in `activePieces` getter
6. [x] **Fast unrequested block check** - Add `hasUnrequestedBlocks()` to skip pieces with all blocks in-flight
7. [x] **Reduce active piece limit** - Lower from 10000 to 150 pieces max
8. [x] **Test on actual device** - Validated on Pixel 9

### Device Testing Results (2025-01-26)

**Before optimizations (500+ active pieces, 128MB):**
- JS thread latency: 675ms typical, up to 3066ms max
- Download pattern: Severe sawtooth, peaks ~45 MB/s with drops to near-zero
- Active pieces creating massive Phase 1 iteration overhead

**After optimizations (150 active pieces, 64MB):**
- JS thread latency: 105-211ms (3-6x improvement)
- Download pattern: Much smoother, less severe drops
- Sawtooth significantly reduced

**Key insight:** The `activePieces.activePieces` getter was calling `Array.from()` on every Phase 1 iteration (per peer, per scheduling batch), creating 500+ element arrays thousands of times per second. Combined with the active piece count limit, this reduced JS thread blocking substantially.

### Remaining Optimizations

1. [ ] Batch `updateInterest` calls (Priority 2)
2. [ ] Skip Phase 2 when saturated (Priority 3)
3. [ ] Investigate if higher piece limits can work with further optimizations
