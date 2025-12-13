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

  constructor(config: Partial<DownloadOptimizerConfig> = {}, clock: () => number = Date.now) {
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
