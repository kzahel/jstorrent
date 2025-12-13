# BEP 3 Choke Algorithm Implementation

## Overview

This task implements the BitTorrent BEP 3 choking algorithm as a pure, testable module alongside a download optimizer. Together they form a `PeerCoordinator` that makes all peer lifecycle decisions through explicit, inspectable decisions rather than scattered inline mutations.

### Why This Matters

**Before:** Choke/unchoke logic scattered throughout `torrent.ts` with immediate side effects
```typescript
// Somewhere in handleInterested()
if (peer.amChoking && this.countUnchokedPeers() < this.maxUploadSlots) {
  peer.amChoking = false
  peer.sendMessage(MessageType.UNCHOKE)
}
```

**After:** Pure algorithms produce decisions, Torrent applies them
```typescript
const decisions = this.peerCoordinator.evaluate(snapshots, hasSwarmCandidates)
for (const d of decisions.unchoke) {
  this.applyUnchokeDecision(d)
}
```

### BEP 3 Requirements

The spec defines four principles for the choking algorithm:

1. **Anti-fibrillation** — Only change choke decisions every 10 seconds
2. **Slot cap** — At most 4 interested peers unchoked at any time  
3. **Tit-for-tat** — 3 slots go to interested peers with best download rates to us
4. **Optimistic unchoke** — 1 slot rotates every 30 seconds, new peers weighted 3x

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       PeerCoordinator                           │
│  Owns both algorithms, runs unchoke first to establish          │
│  "blessed" set, then feeds protected IDs to download optimizer  │
├─────────────────────────────────────────────────────────────────┤
│                              │                                  │
│  ┌─────────────────────┐     │     ┌─────────────────────┐      │
│  │  UnchokeAlgorithm   │     │     │  DownloadOptimizer  │      │
│  │                     │     │     │                     │      │
│  │  - 10s evaluation   │     │     │  - Choked timeout   │      │
│  │  - 3 tit-for-tat    │─────┼────►│  - Speed threshold  │      │
│  │  - 1 optimistic     │  protected │  - Below average    │      │
│  │  - 30s rotation     │    IDs    │  - Respects blessed │      │
│  └─────────────────────┘     │     └─────────────────────┘      │
│                              │                                  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    { unchoke: Decision[], drop: Decision[] }
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Torrent        │
                    │  Applies decisions  │
                    │  (sends messages,   │
                    │   closes sockets)   │
                    └─────────────────────┘
```

---

## Phase 1: Core Types

### 1.1 Create `packages/engine/src/core/peer-coordinator/types.ts`

```typescript
// ============================================================================
// Shared Types for Peer Coordination Algorithms
// ============================================================================

/**
 * Snapshot of peer state for unchoke algorithm.
 * Pure data - no methods, no references to PeerConnection.
 */
export interface UnchokePeerSnapshot {
  id: string                    // Unique identifier (ip:port)
  peerInterested: boolean       // They want to download from us
  amChoking: boolean            // We are currently choking them
  downloadRate: number          // Bytes/sec they're giving US (for tit-for-tat)
  connectedAt: number           // Timestamp when connected (for new peer weighting)
}

/**
 * Snapshot of peer state for download optimizer.
 */
export interface DownloadPeerSnapshot {
  id: string
  peerChoking: boolean          // They are choking US
  downloadRate: number          // Bytes/sec they're giving us
  connectedAt: number           // When connected
  lastDataReceived: number      // Timestamp of last data from them
}

/**
 * Combined snapshot for PeerCoordinator.
 */
export interface PeerSnapshot extends UnchokePeerSnapshot, DownloadPeerSnapshot {
  // Union of both interfaces - all fields required
}

/**
 * Decision to change choke state.
 */
export interface ChokeDecision {
  peerId: string
  action: 'choke' | 'unchoke'
  reason: 'tit_for_tat' | 'optimistic' | 'slot_freed' | 'replaced' | 'initial'
}

/**
 * Decision to drop a peer for poor download performance.
 */
export interface DropDecision {
  peerId: string
  reason: 'choked_timeout' | 'too_slow' | 'below_average'
}

/**
 * Combined evaluation result from PeerCoordinator.
 */
export interface CoordinatorDecisions {
  unchoke: ChokeDecision[]
  drop: DropDecision[]
}

/**
 * Configuration for UnchokeAlgorithm.
 */
export interface UnchokeAlgorithmConfig {
  /** Total upload slots (default 4) */
  maxUploadSlots: number
  /** Anti-fibrillation interval in ms (default 10000) */
  chokeIntervalMs: number
  /** Optimistic rotation interval in ms (default 30000) */
  optimisticIntervalMs: number
  /** Age threshold for "new" peer in ms (default 60000) */
  newPeerThresholdMs: number
  /** Weight multiplier for new peers in optimistic selection (default 3) */
  newPeerWeight: number
}

/**
 * Configuration for DownloadOptimizer.
 */
export interface DownloadOptimizerConfig {
  /** Drop if choked with no data for this long in ms (default 60000) */
  chokedTimeoutMs: number
  /** Absolute minimum speed in bytes/sec (default 1000) */
  minSpeedBytes: number
  /** Don't judge speed until connected this long in ms (default 15000) */
  minConnectionAgeMs: number
  /** Drop if below this fraction of average speed (default 0.1) */
  dropBelowAverageRatio: number
  /** Don't drop if we have fewer peers than this (default 4) */
  minPeersBeforeDropping: number
}

/**
 * Internal state of UnchokeAlgorithm (exposed for testing/debugging).
 */
export interface UnchokeAlgorithmState {
  lastChokeEvaluation: number
  lastOptimisticRotation: number
  optimisticPeerId: string | null
  unchokedPeerIds: Set<string>
}
```

---

## Phase 2: Unchoke Algorithm

### 2.1 Create `packages/engine/src/core/peer-coordinator/unchoke-algorithm.ts`

```typescript
import {
  UnchokePeerSnapshot,
  ChokeDecision,
  UnchokeAlgorithmConfig,
  UnchokeAlgorithmState,
} from './types'

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_UNCHOKE_CONFIG: UnchokeAlgorithmConfig = {
  maxUploadSlots: 4,
  chokeIntervalMs: 10_000,
  optimisticIntervalMs: 30_000,
  newPeerThresholdMs: 60_000,
  newPeerWeight: 3,
}

// ============================================================================
// UnchokeAlgorithm
// ============================================================================

/**
 * Pure implementation of BEP 3 choking algorithm.
 *
 * Principles:
 * 1. Anti-fibrillation: Only change decisions every 10 seconds
 * 2. Slot cap: At most N interested peers unchoked
 * 3. Tit-for-tat: N-1 slots go to best downloaders
 * 4. Optimistic: 1 slot rotates every 30s, new peers weighted 3x
 *
 * This class is pure - no I/O, no side effects. Time is injected via clock.
 * Feed it snapshots, get back decisions.
 */
export class UnchokeAlgorithm {
  private config: UnchokeAlgorithmConfig
  private state: UnchokeAlgorithmState
  private clock: () => number
  private random: () => number

  constructor(
    config: Partial<UnchokeAlgorithmConfig> = {},
    clock: () => number = Date.now,
    random: () => number = Math.random,
  ) {
    this.config = { ...DEFAULT_UNCHOKE_CONFIG, ...config }
    this.clock = clock
    this.random = random
    this.state = {
      lastChokeEvaluation: 0,
      lastOptimisticRotation: 0,
      optimisticPeerId: null,
      unchokedPeerIds: new Set(),
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Evaluate choke decisions based on current peer state.
   * Call this as often as you want - algorithm respects its own timing.
   *
   * @param peers Current peer snapshots
   * @returns Array of decisions (empty if no changes needed or not time yet)
   */
  evaluate(peers: UnchokePeerSnapshot[]): ChokeDecision[] {
    const now = this.clock()

    // Anti-fibrillation: only evaluate every N seconds
    const timeSinceChoke = now - this.state.lastChokeEvaluation
    if (timeSinceChoke < this.config.chokeIntervalMs) {
      return []
    }

    this.state.lastChokeEvaluation = now

    // Check if optimistic should rotate
    const timeSinceOptimistic = now - this.state.lastOptimisticRotation
    const shouldRotateOptimistic = timeSinceOptimistic >= this.config.optimisticIntervalMs

    if (shouldRotateOptimistic) {
      this.state.lastOptimisticRotation = now
    }

    // === Core algorithm ===

    const interested = peers.filter((p) => p.peerInterested)

    // 1. Tit-for-tat: top N-1 by download rate
    const regularSlots = this.config.maxUploadSlots - 1
    const byDownloadRate = [...interested].sort((a, b) => b.downloadRate - a.downloadRate)
    const titForTatPeers = byDownloadRate.slice(0, regularSlots)

    // 2. Optimistic peer selection
    let optimisticPeer: UnchokePeerSnapshot | null = null

    if (shouldRotateOptimistic || !this.isValidOptimistic(peers)) {
      optimisticPeer = this.selectOptimisticPeer(peers, titForTatPeers, now)
      this.state.optimisticPeerId = optimisticPeer?.id ?? null
    } else {
      // Keep current optimistic if still valid
      optimisticPeer = interested.find((p) => p.id === this.state.optimisticPeerId) ?? null
    }

    // 3. Build final unchoke set
    const shouldUnchoke = new Set<string>(titForTatPeers.map((p) => p.id))
    if (optimisticPeer) {
      shouldUnchoke.add(optimisticPeer.id)
    }

    // 4. Diff against current state to produce decisions
    const decisions: ChokeDecision[] = []

    for (const peer of peers) {
      const wasUnchoked = this.state.unchokedPeerIds.has(peer.id)
      const shouldBeUnchoked = shouldUnchoke.has(peer.id)

      if (shouldBeUnchoked && !wasUnchoked) {
        const reason = peer.id === this.state.optimisticPeerId ? 'optimistic' : 'tit_for_tat'
        decisions.push({ peerId: peer.id, action: 'unchoke', reason })
      } else if (!shouldBeUnchoked && wasUnchoked) {
        decisions.push({ peerId: peer.id, action: 'choke', reason: 'replaced' })
      }
    }

    // 5. Update internal state
    this.state.unchokedPeerIds = shouldUnchoke

    return decisions
  }

  /**
   * Get the set of peers currently in upload slots.
   * These peers are "blessed" and should not be dropped by other algorithms.
   */
  getProtectedPeers(): Set<string> {
    return new Set(this.state.unchokedPeerIds)
  }

  /**
   * Notify algorithm that a peer disconnected.
   */
  peerDisconnected(peerId: string): void {
    this.state.unchokedPeerIds.delete(peerId)
    if (this.state.optimisticPeerId === peerId) {
      this.state.optimisticPeerId = null
    }
  }

  /**
   * Get current state for debugging/UI.
   */
  getState(): Readonly<UnchokeAlgorithmState> {
    return {
      ...this.state,
      unchokedPeerIds: new Set(this.state.unchokedPeerIds),
    }
  }

  /**
   * Force re-evaluation on next call (e.g., after config change).
   */
  reset(): void {
    this.state.lastChokeEvaluation = 0
    this.state.lastOptimisticRotation = 0
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<UnchokeAlgorithmConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<UnchokeAlgorithmConfig> {
    return { ...this.config }
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Check if current optimistic peer is still valid (connected & interested).
   */
  private isValidOptimistic(peers: UnchokePeerSnapshot[]): boolean {
    if (!this.state.optimisticPeerId) return false
    const peer = peers.find((p) => p.id === this.state.optimisticPeerId)
    return peer?.peerInterested ?? false
  }

  /**
   * Select new optimistic peer with 3x weighting for new connections.
   */
  private selectOptimisticPeer(
    peers: UnchokePeerSnapshot[],
    titForTatPeers: UnchokePeerSnapshot[],
    now: number,
  ): UnchokePeerSnapshot | null {
    const titForTatIds = new Set(titForTatPeers.map((p) => p.id))

    // Candidates: interested peers NOT already in tit-for-tat slots
    const candidates = peers.filter((p) => p.peerInterested && !titForTatIds.has(p.id))

    if (candidates.length === 0) return null

    // Weight by connection age
    const weighted: UnchokePeerSnapshot[] = []
    for (const peer of candidates) {
      const age = now - peer.connectedAt
      const isNew = age < this.config.newPeerThresholdMs
      const weight = isNew ? this.config.newPeerWeight : 1
      for (let i = 0; i < weight; i++) {
        weighted.push(peer)
      }
    }

    // Random selection
    const index = Math.floor(this.random() * weighted.length)
    return weighted[index]
  }
}
```

---

## Phase 3: Download Optimizer

### 3.1 Create `packages/engine/src/core/peer-coordinator/download-optimizer.ts`

```typescript
import { DownloadPeerSnapshot, DropDecision, DownloadOptimizerConfig } from './types'

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_DOWNLOAD_CONFIG: DownloadOptimizerConfig = {
  chokedTimeoutMs: 60_000,
  minSpeedBytes: 1_000,
  minConnectionAgeMs: 15_000,
  dropBelowAverageRatio: 0.1,
  minPeersBeforeDropping: 4,
}

// ============================================================================
// DownloadOptimizer
// ============================================================================

/**
 * Pure algorithm for identifying slow peers to drop.
 *
 * Respects a "protected" set of peers that cannot be dropped
 * (upload slot holders determined by UnchokeAlgorithm).
 *
 * Criteria for dropping:
 * 1. Choked timeout: Peer is choking us and hasn't sent data in too long
 * 2. Too slow: Below absolute minimum speed threshold
 * 3. Below average: Way below the average download rate
 *
 * This class is pure - no I/O, no side effects. Time is injected via clock.
 */
export class DownloadOptimizer {
  private config: DownloadOptimizerConfig
  private clock: () => number

  constructor(
    config: Partial<DownloadOptimizerConfig> = {},
    clock: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_DOWNLOAD_CONFIG, ...config }
    this.clock = clock
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Evaluate which peers should be dropped for poor download performance.
   *
   * @param peers Current peer snapshots
   * @param protectedIds Peers that cannot be dropped (upload slot holders)
   * @param hasSwarmCandidates Whether swarm has peers we could replace with
   * @returns List of peers to drop
   */
  evaluate(
    peers: DownloadPeerSnapshot[],
    protectedIds: Set<string>,
    hasSwarmCandidates: boolean,
  ): DropDecision[] {
    const dominated: DropDecision[] = []

    // Don't drop anyone if we're below minimum peer count
    if (peers.length <= this.config.minPeersBeforeDropping) {
      return []
    }

    // Don't drop if we have no one to replace them with
    if (!hasSwarmCandidates) {
      return []
    }

    const now = this.clock()

    // Calculate average download rate (excluding choked peers)
    const unchokingPeers = peers.filter((p) => !p.peerChoking)
    const avgRate = this.calculateAverageRate(unchokingPeers)

    for (const peer of peers) {
      const decision = this.evaluatePeer(peer, protectedIds, avgRate, now)
      if (decision) {
        dominated.push(decision)
      }
    }

    return dominated
  }

  /**
   * Check a single peer (convenience method for reactive checks).
   *
   * @param peer Peer to evaluate
   * @param protectedIds Protected peer IDs
   * @param avgDownloadRate Current average download rate
   * @param hasSwarmCandidates Whether replacements are available
   * @returns Drop decision or null
   */
  shouldDrop(
    peer: DownloadPeerSnapshot,
    protectedIds: Set<string>,
    avgDownloadRate: number,
    hasSwarmCandidates: boolean,
  ): DropDecision | null {
    if (!hasSwarmCandidates) {
      return null
    }

    return this.evaluatePeer(peer, protectedIds, avgDownloadRate, this.clock())
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<DownloadOptimizerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<DownloadOptimizerConfig> {
    return { ...this.config }
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Evaluate a single peer for potential dropping.
   */
  private evaluatePeer(
    peer: DownloadPeerSnapshot,
    protectedIds: Set<string>,
    avgRate: number,
    now: number,
  ): DropDecision | null {
    // === Never drop protected peers (upload slot holders) ===
    if (protectedIds.has(peer.id)) {
      return null
    }

    const connectionAge = now - peer.connectedAt
    const timeSinceData = now - peer.lastDataReceived

    // === Check 1: Choked timeout ===
    if (peer.peerChoking && timeSinceData > this.config.chokedTimeoutMs) {
      return { peerId: peer.id, reason: 'choked_timeout' }
    }

    // === Check 2: Speed checks (only for established connections) ===
    if (connectionAge < this.config.minConnectionAgeMs) {
      return null // Too new to judge
    }

    // Only check speed for peers that aren't choking us
    if (!peer.peerChoking) {
      // Check 2a: Below absolute minimum
      if (peer.downloadRate < this.config.minSpeedBytes) {
        return { peerId: peer.id, reason: 'too_slow' }
      }

      // Check 2b: Way below average
      if (avgRate > 0) {
        const ratio = peer.downloadRate / avgRate
        if (ratio < this.config.dropBelowAverageRatio) {
          return { peerId: peer.id, reason: 'below_average' }
        }
      }
    }

    return null
  }

  /**
   * Calculate average download rate across peers.
   */
  private calculateAverageRate(peers: DownloadPeerSnapshot[]): number {
    if (peers.length === 0) return 0
    const total = peers.reduce((sum, p) => sum + p.downloadRate, 0)
    return total / peers.length
  }
}
```

---

## Phase 4: Peer Coordinator

### 4.1 Create `packages/engine/src/core/peer-coordinator/peer-coordinator.ts`

```typescript
import {
  PeerSnapshot,
  CoordinatorDecisions,
  UnchokeAlgorithmConfig,
  DownloadOptimizerConfig,
  UnchokeAlgorithmState,
} from './types'
import { UnchokeAlgorithm, DEFAULT_UNCHOKE_CONFIG } from './unchoke-algorithm'
import { DownloadOptimizer, DEFAULT_DOWNLOAD_CONFIG } from './download-optimizer'

// ============================================================================
// PeerCoordinator
// ============================================================================

/**
 * Coordinates peer lifecycle decisions across multiple algorithms.
 *
 * Owns:
 * - UnchokeAlgorithm (BEP 3 choke/unchoke decisions)
 * - DownloadOptimizer (slow peer dropping)
 *
 * Ensures algorithms don't conflict by:
 * 1. Running unchoke algorithm first to establish "blessed" set
 * 2. Passing protected IDs to download optimizer
 *
 * This is the single entry point for all peer lifecycle decisions.
 */
export class PeerCoordinator {
  private unchokeAlgorithm: UnchokeAlgorithm
  private downloadOptimizer: DownloadOptimizer

  constructor(
    unchokeConfig: Partial<UnchokeAlgorithmConfig> = {},
    downloadConfig: Partial<DownloadOptimizerConfig> = {},
    clock: () => number = Date.now,
    random: () => number = Math.random,
  ) {
    this.unchokeAlgorithm = new UnchokeAlgorithm(unchokeConfig, clock, random)
    this.downloadOptimizer = new DownloadOptimizer(downloadConfig, clock)
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run both algorithms and return combined decisions.
   * Call this from maintenance loop.
   *
   * @param peers Current peer snapshots
   * @param hasSwarmCandidates Whether swarm has connectable peers
   * @returns Combined decisions from both algorithms
   */
  evaluate(peers: PeerSnapshot[], hasSwarmCandidates: boolean): CoordinatorDecisions {
    // 1. Run unchoke algorithm first - it determines who's protected
    const unchokeDecisions = this.unchokeAlgorithm.evaluate(peers)

    // 2. Get protected set (current upload slot holders)
    const protectedIds = this.unchokeAlgorithm.getProtectedPeers()

    // 3. Run download optimizer with protected set
    const dropDecisions = this.downloadOptimizer.evaluate(peers, protectedIds, hasSwarmCandidates)

    return {
      unchoke: unchokeDecisions,
      drop: dropDecisions,
    }
  }

  /**
   * Check if a specific peer is protected (in upload slot).
   */
  isProtected(peerId: string): boolean {
    return this.unchokeAlgorithm.getProtectedPeers().has(peerId)
  }

  /**
   * Get the set of all protected peer IDs.
   */
  getProtectedPeers(): Set<string> {
    return this.unchokeAlgorithm.getProtectedPeers()
  }

  /**
   * Notify algorithms of peer disconnect.
   */
  peerDisconnected(peerId: string): void {
    this.unchokeAlgorithm.peerDisconnected(peerId)
  }

  /**
   * Force re-evaluation on next call.
   */
  reset(): void {
    this.unchokeAlgorithm.reset()
  }

  /**
   * Update unchoke algorithm configuration.
   */
  updateUnchokeConfig(config: Partial<UnchokeAlgorithmConfig>): void {
    this.unchokeAlgorithm.updateConfig(config)
  }

  /**
   * Update download optimizer configuration.
   */
  updateDownloadConfig(config: Partial<DownloadOptimizerConfig>): void {
    this.downloadOptimizer.updateConfig(config)
  }

  /**
   * Get unchoke algorithm state for debugging/UI.
   */
  getUnchokeState(): Readonly<UnchokeAlgorithmState> {
    return this.unchokeAlgorithm.getState()
  }

  /**
   * Get current configurations.
   */
  getConfig(): {
    unchoke: Readonly<UnchokeAlgorithmConfig>
    download: Readonly<DownloadOptimizerConfig>
  } {
    return {
      unchoke: this.unchokeAlgorithm.getConfig(),
      download: this.downloadOptimizer.getConfig(),
    }
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { UnchokeAlgorithm, DEFAULT_UNCHOKE_CONFIG } from './unchoke-algorithm'
export { DownloadOptimizer, DEFAULT_DOWNLOAD_CONFIG } from './download-optimizer'
export * from './types'
```

### 4.2 Create `packages/engine/src/core/peer-coordinator/index.ts`

```typescript
// Barrel export for peer-coordinator module
export { PeerCoordinator } from './peer-coordinator'
export { UnchokeAlgorithm, DEFAULT_UNCHOKE_CONFIG } from './unchoke-algorithm'
export { DownloadOptimizer, DEFAULT_DOWNLOAD_CONFIG } from './download-optimizer'
export * from './types'
```

---

## Phase 5: Add Connection Timestamp to PeerConnection

### 5.1 Update `packages/engine/src/core/peer-connection.ts`

Add property to the class:

```typescript
export class PeerConnection extends EngineComponent {
  // ... existing properties ...

  /** Timestamp when this connection was established */
  public connectedAt: number = Date.now()

  // ... rest of class ...
}
```

The `connectedAt` is set at construction time, which happens when the TCP connection succeeds.

---

## Phase 6: Integrate with Torrent

### 6.1 Update `packages/engine/src/core/torrent.ts`

#### 6.1.1 Add imports

At the top of the file, add:

```typescript
import {
  PeerCoordinator,
  PeerSnapshot,
  ChokeDecision,
  DropDecision,
} from './peer-coordinator'
```

#### 6.1.2 Add coordinator property

In the class properties section (near other private properties):

```typescript
/** Coordinates choke/unchoke and peer dropping decisions */
private _peerCoordinator: PeerCoordinator
```

#### 6.1.3 Initialize in constructor

In the constructor, after initializing `_connectionManager`:

```typescript
// Initialize peer coordinator for BEP 3 choke algorithm
this._peerCoordinator = new PeerCoordinator(
  { maxUploadSlots: this.maxUploadSlots },
  {}, // Use default download optimizer config
)
```

#### 6.1.4 Update `setMaxUploadSlots`

Find the `setMaxUploadSlots` method and update it:

```typescript
setMaxUploadSlots(max: number) {
  this.maxUploadSlots = max
  this._peerCoordinator.updateUnchokeConfig({ maxUploadSlots: max })
}
```

#### 6.1.5 Replace `handleInterested`

Find the `handleInterested` method and replace it entirely:

```typescript
private handleInterested(peer: PeerConnection) {
  peer.peerInterested = true
  // Don't unchoke immediately - let the choke algorithm decide on next tick
  // This prevents fibrillation (rapid choke/unchoke cycling)
  this.logger.debug(`Peer ${peer.remoteAddress} is interested (will evaluate on next tick)`)
}
```

#### 6.1.6 Remove `fillUploadSlot` and `countUnchokedPeers`

These methods are now handled by the unchoke algorithm. Delete them:

```typescript
// DELETE this method:
private countUnchokedPeers(): number { ... }

// DELETE this method:
private fillUploadSlot(): void { ... }
```

#### 6.1.7 Add helper methods for applying decisions

Add these new methods after `drainUploadQueue`:

```typescript
/**
 * Build peer snapshots for the coordinator algorithms.
 */
private buildPeerSnapshots(): PeerSnapshot[] {
  const now = Date.now()
  return this.peers.map((peer) => ({
    id: peerKey(peer.remoteAddress!, peer.remotePort!),
    peerInterested: peer.peerInterested,
    peerChoking: peer.peerChoking,
    amChoking: peer.amChoking,
    downloadRate: peer.downloadSpeed,
    connectedAt: peer.connectedAt,
    lastDataReceived: peer.downloadSpeedCalculator.lastActivity || now,
  }))
}

/**
 * Apply an unchoke decision to a peer.
 */
private applyUnchokeDecision(decision: ChokeDecision): void {
  const peer = this.peers.find(
    (p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId,
  )
  if (!peer) return

  if (decision.action === 'unchoke') {
    if (peer.amChoking) {
      peer.amChoking = false
      peer.sendMessage(MessageType.UNCHOKE)
      this.logger.debug(`Unchoked ${decision.peerId} (${decision.reason})`)
    }
  } else {
    this.chokePeer(peer)
    this.logger.debug(`Choked ${decision.peerId} (${decision.reason})`)
  }
}

/**
 * Apply a drop decision to a peer.
 */
private applyDropDecision(decision: DropDecision): void {
  const peer = this.peers.find(
    (p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId,
  )
  if (!peer) return

  this.logger.info(`Dropping slow peer ${decision.peerId}: ${decision.reason}`)
  peer.close()
}

/**
 * Choke a peer and clear their upload queue.
 */
private chokePeer(peer: PeerConnection): void {
  if (peer.amChoking) return

  peer.amChoking = true
  peer.sendMessage(MessageType.CHOKE)

  // Clear queued uploads for this peer
  const before = this.uploadQueue.length
  this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
  const removed = before - this.uploadQueue.length
  if (removed > 0) {
    this.logger.debug(`Cleared ${removed} queued uploads for choked peer`)
  }
}
```

#### 6.1.8 Update `runMaintenance`

Replace the existing `runMaintenance` method:

```typescript
/**
 * Run maintenance: peer coordination and slot filling.
 */
private runMaintenance(): void {
  // Always check invariants regardless of state
  this.checkSwarmInvariants()

  if (!this._networkActive) return
  if (this.isKillSwitchEnabled) return

  // === Run peer coordinator (BEP 3 choke algorithm + download optimizer) ===
  const snapshots = this.buildPeerSnapshots()
  const hasSwarmCandidates = this._swarm.getConnectablePeers(1).length > 0

  const { unchoke, drop } = this._peerCoordinator.evaluate(snapshots, hasSwarmCandidates)

  // Apply unchoke decisions
  for (const decision of unchoke) {
    this.applyUnchokeDecision(decision)
  }

  // Apply drop decisions
  for (const decision of drop) {
    this.applyDropDecision(decision)
  }

  // === Fill peer slots (existing logic) ===
  if (this.isComplete) return // Don't seek peers when complete

  const connected = this.numPeers
  const connecting = this.pendingConnections.size
  const slotsAvailable = this.maxPeers - connected - connecting

  if (slotsAvailable <= 0) return
  if (this._swarm.size === 0) return

  const candidates = this._swarm.getConnectablePeers(slotsAvailable)

  if (candidates.length > 0) {
    this.logger.debug(
      `Maintenance: ${connected} connected, ${connecting} connecting, ` +
        `${slotsAvailable} slots available, trying ${candidates.length} candidates`,
    )

    for (const swarmPeer of candidates) {
      if (!this.globalLimitCheck()) break
      if (this.numPeers + this.pendingConnections.size >= this.maxPeers) break

      this.connectToPeer({ ip: swarmPeer.ip, port: swarmPeer.port })
    }
  }
}
```

#### 6.1.9 Update `removePeer` to notify coordinator

In the `removePeer` method, add after the swarm state update:

```typescript
private removePeer(peer: PeerConnection) {
  // Clear any queued uploads for this peer
  const queueLengthBefore = this.uploadQueue.length
  this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
  const removedUploads = queueLengthBefore - this.uploadQueue.length
  if (removedUploads > 0) {
    this.logger.debug(`Cleared ${removedUploads} queued uploads for disconnected peer`)
  }

  // Notify peer coordinator of disconnect
  if (peer.remoteAddress && peer.remotePort) {
    const key = peerKey(peer.remoteAddress, peer.remotePort)
    this._peerCoordinator.peerDisconnected(key)
  }

  // ... rest of existing removePeer logic ...
}
```

#### 6.1.10 Remove `fillUploadSlot` calls

Find and remove these calls in event handlers:

In peer `'not_interested'` handler:
```typescript
peer.on('not_interested', () => {
  this.logger.debug('Not interested received')
  // DELETE: this.fillUploadSlot()
})
```

In peer `'close'` handler:
```typescript
peer.on('close', () => {
  this.logger.debug('Peer closed')
  this.removePeer(peer)
  // DELETE: this.fillUploadSlot()
})
```

#### 6.1.11 Add public method to get coordinator state (optional, for UI)

```typescript
/**
 * Get peer coordinator state for debugging/UI.
 */
getPeerCoordinatorState(): {
  protectedPeers: string[]
  optimisticPeer: string | null
  config: ReturnType<PeerCoordinator['getConfig']>
} {
  const state = this._peerCoordinator.getUnchokeState()
  return {
    protectedPeers: Array.from(state.unchokedPeerIds),
    optimisticPeer: state.optimisticPeerId,
    config: this._peerCoordinator.getConfig(),
  }
}
```

---

## Phase 7: Tests

### 7.1 Create `packages/engine/test/core/peer-coordinator/unchoke-algorithm.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { UnchokeAlgorithm } from '../../../src/core/peer-coordinator/unchoke-algorithm'
import { UnchokePeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('UnchokeAlgorithm', () => {
  let clock: number
  const fakeClock = () => clock
  const fakeRandom = () => 0.5 // Deterministic for testing

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Anti-fibrillation
  // ---------------------------------------------------------------------------

  describe('anti-fibrillation', () => {
    it('should not produce decisions before 10 second interval', () => {
      const algo = new UnchokeAlgorithm({}, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
      ]

      // First call produces decisions
      const first = algo.evaluate(peers)
      expect(first.length).toBeGreaterThan(0)

      // 5 seconds later: no decisions
      clock = 5000
      const second = algo.evaluate(peers)
      expect(second).toHaveLength(0)

      // 9.9 seconds: still no decisions
      clock = 9900
      const third = algo.evaluate(peers)
      expect(third).toHaveLength(0)

      // 10 seconds: should evaluate
      clock = 10000
      const fourth = algo.evaluate(peers)
      // May or may not have decisions depending on state, but DID evaluate
      expect(algo.getState().lastChokeEvaluation).toBe(10000)
    })
  })

  // ---------------------------------------------------------------------------
  // Slot cap
  // ---------------------------------------------------------------------------

  describe('slot cap', () => {
    it('should never unchoke more than maxUploadSlots interested peers', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const unchokes = decisions.filter((d) => d.action === 'unchoke')
      expect(unchokes.length).toBeLessThanOrEqual(4)
    })

    it('should respect custom maxUploadSlots', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 5 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const unchokes = decisions.filter((d) => d.action === 'unchoke')
      expect(unchokes.length).toBeLessThanOrEqual(2)
    })

    it('should only unchoke interested peers', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'interested1', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'not_interested', peerInterested: false, amChoking: true, downloadRate: 9000, connectedAt: 0 },
        { id: 'interested2', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
      ]

      const decisions = algo.evaluate(peers)
      const unchokedIds = decisions.filter((d) => d.action === 'unchoke').map((d) => d.peerId)

      expect(unchokedIds).toContain('interested1')
      expect(unchokedIds).toContain('interested2')
      expect(unchokedIds).not.toContain('not_interested')
    })
  })

  // ---------------------------------------------------------------------------
  // Tit-for-tat
  // ---------------------------------------------------------------------------

  describe('tit-for-tat', () => {
    it('should unchoke top 3 peers by download rate for tit-for-tat slots', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'slow', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'medium', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
        { id: 'faster', peerInterested: true, amChoking: true, downloadRate: 900, connectedAt: 0 },
        { id: 'fastest', peerInterested: true, amChoking: true, downloadRate: 1100, connectedAt: 0 },
      ]

      const decisions = algo.evaluate(peers)
      const titForTat = decisions.filter((d) => d.action === 'unchoke' && d.reason === 'tit_for_tat')
      const titForTatIds = titForTat.map((d) => d.peerId)

      // Top 3 should be fastest, fast, faster
      expect(titForTatIds).toContain('fastest')
      expect(titForTatIds).toContain('fast')
      expect(titForTatIds).toContain('faster')
      expect(titForTatIds).not.toContain('slow')
      expect(titForTatIds).not.toContain('medium')
    })

    it('should choke peers who fall out of top 3', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)

      // Round 1: A, B, C are fastest
      const peers1: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 900, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: true, downloadRate: 800, connectedAt: 0 },
        { id: 'D', peerInterested: true, amChoking: true, downloadRate: 100, connectedAt: 0 },
      ]

      algo.evaluate(peers1)

      // Round 2: D gets fast, A slows down
      clock = 10000
      const peers2: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: false, downloadRate: 50, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: false, downloadRate: 900, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: false, downloadRate: 800, connectedAt: 0 },
        { id: 'D', peerInterested: true, amChoking: true, downloadRate: 2000, connectedAt: 0 },
      ]

      const decisions = algo.evaluate(peers2)

      // A should be choked, D should be unchoked
      expect(decisions).toContainEqual({ peerId: 'A', action: 'choke', reason: 'replaced' })
      expect(decisions).toContainEqual({ peerId: 'D', action: 'unchoke', reason: 'tit_for_tat' })
    })
  })

  // ---------------------------------------------------------------------------
  // Optimistic unchoke
  // ---------------------------------------------------------------------------

  describe('optimistic unchoke', () => {
    it('should have exactly one optimistic unchoke slot', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const optimistic = decisions.filter((d) => d.action === 'unchoke' && d.reason === 'optimistic')
      expect(optimistic).toHaveLength(1)
    })

    it('should rotate optimistic peer every 30 seconds', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'slow1', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        { id: 'slow2', peerInterested: true, amChoking: true, downloadRate: 20, connectedAt: 0 },
        { id: 'slow3', peerInterested: true, amChoking: true, downloadRate: 30, connectedAt: 0 },
      ]

      // First evaluation
      algo.evaluate(peers)
      const firstOptimistic = algo.getState().optimisticPeerId

      // 10 seconds: no rotation
      clock = 10000
      algo.evaluate(peers.map((p) => ({ ...p, amChoking: !algo.getProtectedPeers().has(p.id) })))
      expect(algo.getState().optimisticPeerId).toBe(firstOptimistic)

      // 30 seconds: rotation
      clock = 30000
      algo.evaluate(peers.map((p) => ({ ...p, amChoking: !algo.getProtectedPeers().has(p.id) })))
      // Optimistic might be the same or different depending on random selection
      // But lastOptimisticRotation should update
      expect(algo.getState().lastOptimisticRotation).toBe(30000)
    })

    it('should weight new peers 3x for optimistic selection', () => {
      // Use deterministic random that cycles through values
      let randomCalls = 0
      const cyclicRandom = () => {
        const values = [0.1, 0.3, 0.5, 0.7, 0.9]
        return values[randomCalls++ % values.length]
      }

      const algo = new UnchokeAlgorithm(
        { maxUploadSlots: 2, newPeerThresholdMs: 60000 },
        fakeClock,
        cyclicRandom,
      )

      clock = 100000 // Well past new peer threshold

      const peers: UnchokePeerSnapshot[] = [
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'old', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        { id: 'new', peerInterested: true, amChoking: true, downloadRate: 20, connectedAt: clock - 1000 }, // New peer
      ]

      // Run multiple times and count how often new peer is selected
      let newSelected = 0
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        algo.reset()
        randomCalls = i // Vary starting point
        algo.evaluate(peers)
        if (algo.getState().optimisticPeerId === 'new') {
          newSelected++
        }
      }

      // With 3x weight, new peer should be selected ~75% of the time (3 out of 4 weighted slots)
      // Allow for some variance
      expect(newSelected).toBeGreaterThan(iterations * 0.5)
    })
  })

  // ---------------------------------------------------------------------------
  // Protected peers
  // ---------------------------------------------------------------------------

  describe('protected peers', () => {
    it('should track unchoked peers as protected', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: true, downloadRate: 100, connectedAt: 0 },
      ]

      algo.evaluate(peers)
      const protected_ = algo.getProtectedPeers()

      expect(protected_.size).toBeLessThanOrEqual(2)
      // A should definitely be protected (highest rate)
      expect(protected_.has('A')).toBe(true)
    })

    it('should remove peer from protected when they disconnect', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
      ]

      algo.evaluate(peers)
      expect(algo.getProtectedPeers().has('A')).toBe(true)

      algo.peerDisconnected('A')
      expect(algo.getProtectedPeers().has('A')).toBe(false)
    })
  })
})
```

### 7.2 Create `packages/engine/test/core/peer-coordinator/download-optimizer.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { DownloadOptimizer } from '../../../src/core/peer-coordinator/download-optimizer'
import { DownloadPeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('DownloadOptimizer', () => {
  let clock: number
  const fakeClock = () => clock

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Protected peers
  // ---------------------------------------------------------------------------

  describe('protected peers', () => {
    it('should never recommend dropping protected peers', () => {
      const optimizer = new DownloadOptimizer({ minConnectionAgeMs: 0 }, fakeClock)
      const peers: DownloadPeerSnapshot[] = [
        { id: 'protected_slow', peerChoking: false, downloadRate: 1, connectedAt: 0, lastDataReceived: clock },
        { id: 'unprotected_fast', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
      ]

      const protectedIds = new Set(['protected_slow'])
      const decisions = optimizer.evaluate(peers, protectedIds, true)

      const droppedIds = decisions.map((d) => d.peerId)
      expect(droppedIds).not.toContain('protected_slow')
    })
  })

  // ---------------------------------------------------------------------------
  // Choked timeout
  // ---------------------------------------------------------------------------

  describe('choked timeout', () => {
    it('should drop peers choked with no data for too long', () => {
      const optimizer = new DownloadOptimizer({ chokedTimeoutMs: 60000 }, fakeClock)

      clock = 70000 // 70 seconds
      const peers: DownloadPeerSnapshot[] = [
        { id: 'choked_stale', peerChoking: true, downloadRate: 0, connectedAt: 0, lastDataReceived: 0 },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'choked_stale', reason: 'choked_timeout' })
    })

    it('should not drop choked peers who recently sent data', () => {
      const optimizer = new DownloadOptimizer({ chokedTimeoutMs: 60000 }, fakeClock)

      clock = 70000
      const peers: DownloadPeerSnapshot[] = [
        { id: 'choked_recent', peerChoking: true, downloadRate: 0, connectedAt: 0, lastDataReceived: 50000 },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Speed thresholds
  // ---------------------------------------------------------------------------

  describe('speed thresholds', () => {
    it('should drop peers below minimum speed', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        { id: 'too_slow', peerChoking: false, downloadRate: 100, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast_enough', peerChoking: false, downloadRate: 5000, connectedAt: 0, lastDataReceived: clock },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'too_slow', reason: 'too_slow' })
      expect(decisions.map((d) => d.peerId)).not.toContain('fast_enough')
    })

    it('should not judge peers until minimum connection age', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 15000 },
        fakeClock,
      )

      clock = 10000 // Only 10 seconds
      const peers: DownloadPeerSnapshot[] = [
        { id: 'new_slow', peerChoking: false, downloadRate: 100, connectedAt: 0, lastDataReceived: clock },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)

      // After 15 seconds, should be judged
      clock = 20000
      const decisions2 = optimizer.evaluate(peers, new Set(), true)
      expect(decisions2).toContainEqual({ peerId: 'new_slow', reason: 'too_slow' })
    })

    it('should drop peers way below average', () => {
      const optimizer = new DownloadOptimizer(
        { dropBelowAverageRatio: 0.1, minSpeedBytes: 0, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        { id: 'fast1', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast2', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
        { id: 'slow', peerChoking: false, downloadRate: 100, connectedAt: 0, lastDataReceived: clock }, // 1% of avg
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'slow', reason: 'below_average' })
    })
  })

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  describe('guards', () => {
    it('should not drop anyone if below minimum peer count', () => {
      const optimizer = new DownloadOptimizer(
        { minPeersBeforeDropping: 4, minSpeedBytes: 1000, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        { id: 'slow1', peerChoking: false, downloadRate: 1, connectedAt: 0, lastDataReceived: clock },
        { id: 'slow2', peerChoking: false, downloadRate: 1, connectedAt: 0, lastDataReceived: clock },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)
    })

    it('should not drop anyone if no swarm candidates available', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        { id: 'slow', peerChoking: false, downloadRate: 1, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast1', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast2', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast3', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
        { id: 'fast4', peerChoking: false, downloadRate: 10000, connectedAt: 0, lastDataReceived: clock },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), false) // No candidates
      expect(decisions).toHaveLength(0)
    })
  })
})
```

### 7.3 Create `packages/engine/test/core/peer-coordinator/peer-coordinator.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PeerCoordinator } from '../../../src/core/peer-coordinator/peer-coordinator'
import { PeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('PeerCoordinator', () => {
  let clock: number
  const fakeClock = () => clock
  const fakeRandom = () => 0.5

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Integration: Unchoke + Download Optimizer
  // ---------------------------------------------------------------------------

  describe('algorithm coordination', () => {
    it('should run unchoke first, then optimizer respects protected set', () => {
      const coordinator = new PeerCoordinator(
        { maxUploadSlots: 2 },
        { minSpeedBytes: 500, minConnectionAgeMs: 0 },
        fakeClock,
        fakeRandom,
      )

      const peers: PeerSnapshot[] = [
        // This peer is slow but interested - will get upload slot
        {
          id: 'slow_uploader',
          peerInterested: true,
          peerChoking: true,
          amChoking: true,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        // Fast peer
        {
          id: 'fast',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        // Slow peer not interested (no upload slot)
        {
          id: 'slow_no_slot',
          peerInterested: false,
          peerChoking: false,
          amChoking: true,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const { unchoke, drop } = coordinator.evaluate(peers, true)

      // slow_uploader should be unchoked (one of 2 slots)
      const unchoked = unchoke.filter((d) => d.action === 'unchoke').map((d) => d.peerId)
      expect(unchoked).toContain('slow_uploader')

      // slow_uploader should NOT be dropped (protected)
      const dropped = drop.map((d) => d.peerId)
      expect(dropped).not.toContain('slow_uploader')

      // slow_no_slot SHOULD be dropped (not protected, too slow)
      expect(dropped).toContain('slow_no_slot')
    })

    it('should update protected set when upload slots change', () => {
      const coordinator = new PeerCoordinator(
        { maxUploadSlots: 2 },
        { minConnectionAgeMs: 0 },
        fakeClock,
        fakeRandom,
      )

      // Round 1: A and B are fastest interested, get slots
      const peers1: PeerSnapshot[] = [
        { id: 'A', peerInterested: true, peerChoking: false, amChoking: true, downloadRate: 1000, connectedAt: 0, lastDataReceived: clock },
        { id: 'B', peerInterested: true, peerChoking: false, amChoking: true, downloadRate: 900, connectedAt: 0, lastDataReceived: clock },
        { id: 'C', peerInterested: true, peerChoking: false, amChoking: true, downloadRate: 100, connectedAt: 0, lastDataReceived: clock },
      ]

      coordinator.evaluate(peers1, true)
      expect(coordinator.isProtected('A')).toBe(true)
      expect(coordinator.isProtected('B')).toBe(true)
      expect(coordinator.isProtected('C')).toBe(false)

      // Round 2: C gets fast, A slows down
      clock = 15000
      const peers2: PeerSnapshot[] = [
        { id: 'A', peerInterested: true, peerChoking: false, amChoking: false, downloadRate: 50, connectedAt: 0, lastDataReceived: clock },
        { id: 'B', peerInterested: true, peerChoking: false, amChoking: false, downloadRate: 900, connectedAt: 0, lastDataReceived: clock },
        { id: 'C', peerInterested: true, peerChoking: false, amChoking: true, downloadRate: 2000, connectedAt: 0, lastDataReceived: clock },
      ]

      coordinator.evaluate(peers2, true)
      expect(coordinator.isProtected('A')).toBe(false) // Lost slot
      expect(coordinator.isProtected('B')).toBe(true)
      expect(coordinator.isProtected('C')).toBe(true) // Gained slot
    })
  })

  // ---------------------------------------------------------------------------
  // Peer disconnect
  // ---------------------------------------------------------------------------

  describe('peer disconnect', () => {
    it('should remove peer from protected set on disconnect', () => {
      const coordinator = new PeerCoordinator(
        { maxUploadSlots: 2 },
        {},
        fakeClock,
        fakeRandom,
      )

      const peers: PeerSnapshot[] = [
        { id: 'A', peerInterested: true, peerChoking: false, amChoking: true, downloadRate: 1000, connectedAt: 0, lastDataReceived: clock },
      ]

      coordinator.evaluate(peers, true)
      expect(coordinator.isProtected('A')).toBe(true)

      coordinator.peerDisconnected('A')
      expect(coordinator.isProtected('A')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Config updates
  // ---------------------------------------------------------------------------

  describe('configuration', () => {
    it('should support runtime config updates', () => {
      const coordinator = new PeerCoordinator({}, {}, fakeClock, fakeRandom)

      coordinator.updateUnchokeConfig({ maxUploadSlots: 8 })
      coordinator.updateDownloadConfig({ minSpeedBytes: 5000 })

      const config = coordinator.getConfig()
      expect(config.unchoke.maxUploadSlots).toBe(8)
      expect(config.download.minSpeedBytes).toBe(5000)
    })
  })
})
```

---

## Phase 8: Cleanup

### 8.1 Remove dead code from `ConnectionManager`

The following methods in `connection-manager.ts` are now superseded by `DownloadOptimizer`:

- `shouldDropPeer()` - Logic moved to DownloadOptimizer
- `detectSlowPeers()` - Logic moved to DownloadOptimizer

These can be removed or marked as deprecated. The slow peer config properties in `ConnectionConfig` can also be removed.

### 8.2 Update exports

Add to `packages/engine/src/index.ts`:

```typescript
export * from './core/peer-coordinator'
```

---

## Verification

### Run Tests

```bash
cd packages/engine
pnpm test
```

All new tests should pass, and existing tests should remain green.

### Manual Testing Checklist

1. **Start a torrent download**
   - Verify peers get unchoked progressively
   - Check logs for "Unchoked peer X (tit_for_tat)" messages

2. **Verify anti-fibrillation**
   - Watch logs for 10 seconds
   - Choke decisions should only appear at ~10 second intervals

3. **Verify optimistic unchoke**
   - With >4 interested peers, verify one gets "optimistic" reason
   - Watch for rotation at ~30 second intervals

4. **Verify protected peers**
   - Slow peers who are interested should not be dropped
   - Call `torrent.getPeerCoordinatorState()` to inspect protected set

5. **Verify slow peer dropping**
   - Connect to many slow peers
   - Non-interested slow peers should be dropped
   - Interested slow peers in upload slots should NOT be dropped

### Integration Test (Optional)

Create a test that runs two JSTorrent instances against each other and verifies:
- Tit-for-tat reciprocation works
- Optimistic unchoke bootstraps new peers
- Slot limits are respected

---

## Summary

This implementation:

1. **Extracts** choke/unchoke logic into pure `UnchokeAlgorithm` class
2. **Extracts** slow peer dropping into pure `DownloadOptimizer` class  
3. **Coordinates** both via `PeerCoordinator` with blessed/protected set
4. **Removes** scattered inline mutations from `torrent.ts`
5. **Enables** deterministic testing via injectable clock/random
6. **Complies** with BEP 3: 10s anti-fibrillation, 4 slots, tit-for-tat, optimistic unchoke

The result is a clean separation of concerns where decisions are first-class data structures that can be inspected, logged, tested, and applied uniformly.
