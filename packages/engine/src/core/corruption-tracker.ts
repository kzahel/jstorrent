/**
 * Tracks peer contributions to failed piece hash checks and decides when to ban.
 *
 * Uses a Bayesian-inspired approach:
 * - Peers who appear in multiple failed pieces are increasingly suspicious
 * - If a peer is the "common denominator" across failures with different co-contributors,
 *   they're very likely the bad actor
 * - Ban threshold adjusts based on swarm health (aggressive when healthy, cautious when sparse)
 *
 * The algorithm is intentionally isolated for testability and easy swapping.
 */

export interface PieceFailure {
  pieceIndex: number
  contributors: Set<string> // All peer IDs that contributed to this piece
  timestamp: number
}

export interface BanDecision {
  peerId: string
  confidence: number // 0-1, how confident we are they're bad
  reason: string
  failureCount: number
  uniqueCoContributors: number
}

export interface SwarmHealth {
  connected: number // Currently connected peers
  total: number // Total known peers (for context)
}

export interface CorruptionTrackerConfig {
  /** Minimum failures before considering a ban in healthy swarm (default: 2) */
  minFailuresForBan: number
  /** Maximum failures required even in very sparse swarm (default: 5) */
  maxFailuresForBan: number
  /** Base confidence threshold for banning (0-1, default: 0.6) */
  banConfidenceThreshold: number
  /** Connected peer count above which we use aggressive thresholds (default: 10) */
  healthySwarmSize: number
  /** Time window for considering failures (ms, default: 5 minutes) */
  failureWindowMs: number
}

const DEFAULT_CONFIG: CorruptionTrackerConfig = {
  minFailuresForBan: 2,
  maxFailuresForBan: 5,
  banConfidenceThreshold: 0.6,
  healthySwarmSize: 10,
  failureWindowMs: 5 * 60 * 1000,
}

export interface PeerSuspicion {
  peerId: string
  failures: PieceFailure[]
  /** Unique peers who co-contributed to failed pieces with this peer */
  coContributors: Set<string>
}

/**
 * Corruption tracker for identifying and banning peers sending bad data.
 */
export class CorruptionTracker {
  private config: CorruptionTrackerConfig
  private peerSuspicion: Map<string, PeerSuspicion> = new Map()

  constructor(config: Partial<CorruptionTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Record a hash failure and get ban recommendations.
   *
   * @param pieceIndex - The piece that failed verification
   * @param contributors - Peer IDs that contributed blocks to this piece
   * @param swarmHealth - Current swarm state for threshold adjustment
   * @param now - Current timestamp (for testing)
   * @returns Array of peers that should be banned
   */
  recordHashFailure(
    pieceIndex: number,
    contributors: string[],
    swarmHealth: SwarmHealth,
    now: number = Date.now(),
  ): BanDecision[] {
    if (contributors.length === 0) {
      return []
    }

    // Clean up old failures first
    this.pruneOldFailures(now)

    // PROOF case: sole contributor to a failed piece = definitive guilt
    if (contributors.length === 1) {
      const peerId = contributors[0]
      return [
        {
          peerId,
          confidence: 1.0,
          reason: `corrupt data: sole contributor to failed piece ${pieceIndex}`,
          failureCount: 1,
          uniqueCoContributors: 0,
        },
      ]
    }

    const contributorSet = new Set(contributors)
    const failure: PieceFailure = {
      pieceIndex,
      contributors: contributorSet,
      timestamp: now,
    }

    // Record this failure for each contributor
    for (const peerId of contributors) {
      let suspicion = this.peerSuspicion.get(peerId)
      if (!suspicion) {
        suspicion = {
          peerId,
          failures: [],
          coContributors: new Set(),
        }
        this.peerSuspicion.set(peerId, suspicion)
      }

      // Check for duplicate piece (shouldn't happen normally, but be safe)
      if (!suspicion.failures.some((f) => f.pieceIndex === pieceIndex)) {
        suspicion.failures.push(failure)

        // Track co-contributors (everyone except this peer)
        for (const other of contributors) {
          if (other !== peerId) {
            suspicion.coContributors.add(other)
          }
        }
      }
    }

    // Evaluate all contributors for potential bans
    return this.evaluateBans(contributors, swarmHealth)
  }

  /**
   * Calculate suspicion score for a peer.
   *
   * Higher score = more likely to be malicious.
   * Score is based on:
   * - Number of failed pieces they contributed to
   * - Diversity of co-contributors (more diverse = stronger signal they're the common cause)
   * - Sole contributor status (if they're the only one contributing to pieces, very suspicious)
   */
  getSuspicionScore(peerId: string): number {
    const suspicion = this.peerSuspicion.get(peerId)
    if (!suspicion || suspicion.failures.length === 0) {
      return 0
    }

    const failureCount = suspicion.failures.length
    const uniqueCoContributors = suspicion.coContributors.size

    // Base score from failure count (exponential growth)
    // 1 failure = 0.3, 2 = 0.6, 3 = 0.8, 4+ = 0.9+
    const failureScore = 1 - Math.exp(-0.35 * failureCount)

    // Boost calculation
    let boost = 0
    const avgContributorsPerPiece = this.getAverageContributorsPerFailure(suspicion)

    if (avgContributorsPerPiece <= 1 && failureCount >= 2) {
      // Sole contributor to multiple failed pieces = very strong signal
      // This is actually stronger evidence than diverse co-contributors
      boost = 0.25
    } else {
      // Boost for diverse co-contributors
      // If failures involve many different other peers, this peer is likely the common cause
      const expectedCoContributors = (avgContributorsPerPiece - 1) * failureCount

      if (expectedCoContributors > 0 && failureCount >= 2) {
        // If co-contributors are diverse (close to expected for independent failures),
        // boost confidence that this peer is the bad actor
        const diversityRatio = Math.min(1, uniqueCoContributors / expectedCoContributors)
        boost = diversityRatio * 0.2 // Up to 0.2 boost
      }
    }

    return Math.min(1, failureScore + boost)
  }

  /**
   * Get the effective minimum failures required based on swarm health.
   * Sparse swarms require more evidence before banning.
   */
  getEffectiveMinFailures(swarmHealth: SwarmHealth): number {
    const { minFailuresForBan, maxFailuresForBan, healthySwarmSize } = this.config

    // healthRatio: 0 = very sparse, 1 = healthy
    const healthRatio = Math.min(1, swarmHealth.connected / healthySwarmSize)

    // Interpolate between max (sparse) and min (healthy)
    // sparse (ratio=0): maxFailures, healthy (ratio=1): minFailures
    const effectiveMin = maxFailuresForBan - healthRatio * (maxFailuresForBan - minFailuresForBan)

    return Math.ceil(effectiveMin)
  }

  /**
   * Get confidence that a peer should be banned.
   * This is the suspicion score adjusted by swarm health.
   */
  getBanConfidence(peerId: string, swarmHealth: SwarmHealth): number {
    const suspicion = this.peerSuspicion.get(peerId)
    if (!suspicion) {
      return 0
    }

    const effectiveMinFailures = this.getEffectiveMinFailures(swarmHealth)

    if (suspicion.failures.length < effectiveMinFailures) {
      return 0 // Not enough evidence yet for this swarm health
    }

    // Once we have enough failures, use suspicion score as confidence
    const suspicionScore = this.getSuspicionScore(peerId)

    // Scale confidence: at threshold failures we need high suspicion,
    // with more failures we're more confident
    const excessFailures = suspicion.failures.length - effectiveMinFailures
    const failureBoost = Math.min(0.3, excessFailures * 0.1) // Up to 0.3 boost for extra failures

    const confidence = (suspicionScore + failureBoost) / this.config.banConfidenceThreshold

    return Math.min(1, confidence)
  }

  /**
   * Get failure history for a peer (for debugging/testing).
   */
  getFailureHistory(peerId: string): PieceFailure[] {
    return this.peerSuspicion.get(peerId)?.failures ?? []
  }

  /**
   * Get all tracked peers and their suspicion data.
   */
  getAllSuspicions(): Map<string, PeerSuspicion> {
    return new Map(this.peerSuspicion)
  }

  /**
   * Clear all tracking data.
   */
  reset(): void {
    this.peerSuspicion.clear()
  }

  /**
   * Remove a peer from tracking (e.g., after banning).
   */
  removePeer(peerId: string): void {
    this.peerSuspicion.delete(peerId)

    // Also remove from co-contributor sets
    for (const suspicion of this.peerSuspicion.values()) {
      suspicion.coContributors.delete(peerId)
    }
  }

  // --- Private methods ---

  private evaluateBans(candidates: string[], swarmHealth: SwarmHealth): BanDecision[] {
    const decisions: BanDecision[] = []

    for (const peerId of candidates) {
      const confidence = this.getBanConfidence(peerId, swarmHealth)
      const suspicion = this.peerSuspicion.get(peerId)

      if (confidence >= 1 && suspicion) {
        decisions.push({
          peerId,
          confidence: Math.min(1, this.getSuspicionScore(peerId)),
          reason: this.formatBanReason(suspicion, swarmHealth),
          failureCount: suspicion.failures.length,
          uniqueCoContributors: suspicion.coContributors.size,
        })
      }
    }

    return decisions
  }

  private formatBanReason(suspicion: PeerSuspicion, swarmHealth: SwarmHealth): string {
    const { failures, coContributors } = suspicion
    const pieces = failures.map((f) => f.pieceIndex).join(', ')
    return (
      `corrupt data: ${failures.length} failed pieces (${pieces}), ` +
      `${coContributors.size} unique co-contributors, ` +
      `swarm: ${swarmHealth.connected}/${swarmHealth.total}`
    )
  }

  private pruneOldFailures(now: number): void {
    const cutoff = now - this.config.failureWindowMs

    for (const [peerId, suspicion] of this.peerSuspicion) {
      // Remove old failures
      suspicion.failures = suspicion.failures.filter((f) => f.timestamp > cutoff)

      // If no failures left, remove the peer from tracking
      if (suspicion.failures.length === 0) {
        this.peerSuspicion.delete(peerId)
      } else {
        // Rebuild co-contributors from remaining failures
        suspicion.coContributors.clear()
        for (const failure of suspicion.failures) {
          for (const contributor of failure.contributors) {
            if (contributor !== peerId) {
              suspicion.coContributors.add(contributor)
            }
          }
        }
      }
    }
  }

  private getAverageContributorsPerFailure(suspicion: PeerSuspicion): number {
    if (suspicion.failures.length === 0) return 0
    const total = suspicion.failures.reduce((sum, f) => sum + f.contributors.size, 0)
    return total / suspicion.failures.length
  }
}
