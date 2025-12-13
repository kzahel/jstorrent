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
      lastChokeEvaluation: -1, // -1 indicates never evaluated
      lastOptimisticRotation: -1, // -1 indicates never rotated
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
    // lastChokeEvaluation starts at -1 to indicate never evaluated
    const isFirstEvaluation = this.state.lastChokeEvaluation < 0
    const timeSinceChoke = now - this.state.lastChokeEvaluation
    if (!isFirstEvaluation && timeSinceChoke < this.config.chokeIntervalMs) {
      return []
    }

    this.state.lastChokeEvaluation = now

    // Check if optimistic should rotate
    // lastOptimisticRotation starts at -1 to indicate never rotated
    const isFirstOptimistic = this.state.lastOptimisticRotation < 0
    const timeSinceOptimistic = now - this.state.lastOptimisticRotation
    const shouldRotateOptimistic =
      isFirstOptimistic || timeSinceOptimistic >= this.config.optimisticIntervalMs

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
    const titForTatIds = new Set(titForTatPeers.map((p) => p.id))

    // Need new optimistic if: rotation due, invalid, or current optimistic is now in tit-for-tat
    const currentOptimisticInTitForTat = titForTatIds.has(this.state.optimisticPeerId ?? '')
    const needNewOptimistic =
      shouldRotateOptimistic || !this.isValidOptimistic(peers) || currentOptimisticInTitForTat

    if (needNewOptimistic) {
      optimisticPeer = this.selectOptimisticPeer(peers, titForTatPeers, now)
      this.state.optimisticPeerId = optimisticPeer?.id ?? null
    } else {
      // Keep current optimistic if still valid and not promoted to tit-for-tat
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
    this.state.lastChokeEvaluation = -1
    this.state.lastOptimisticRotation = -1
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
