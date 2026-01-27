import type { Swarm, SwarmPeer } from './swarm'
import { getPortScorePenalty } from './swarm'

// ============================================================================
// PeerSelector
// ============================================================================

/**
 * Handles peer selection for connection attempts.
 *
 * Responsibilities:
 * - Scoring peers based on quality heuristics
 * - Filtering eligible candidates (not connected, not in backoff, not banned)
 * - Returning ranked candidates for ConnectionManager
 *
 * Future: candidate caching, round-robin scanning, score caching
 */
export class PeerSelector {
  constructor(private readonly swarm: Swarm) {}

  /**
   * Get peers eligible for connection attempts.
   * Filters out: connected, connecting, in backoff, banned.
   * Returns list sorted by quality score (best first), limited to `limit` peers.
   * Suspicious port peers are returned last (only as last resort).
   */
  getConnectablePeers(limit: number): SwarmPeer[] {
    const now = Date.now()
    const normalCandidates: SwarmPeer[] = []
    const suspiciousCandidates: SwarmPeer[] = []

    // Collect eligible candidates, separating suspicious ports
    for (const peer of this.swarm.getAllPeersArray()) {
      if (peer.state === 'connected' || peer.state === 'connecting') continue
      if (peer.state === 'banned') continue

      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures)
        if (now - peer.lastConnectAttempt < backoffMs) continue
      }

      // Check backoff for quick disconnects (idle peers that disconnect rapidly)
      if (peer.state === 'idle' && peer.quickDisconnects > 0 && peer.lastDisconnect) {
        const backoffMs = this.calculateBackoff(peer.quickDisconnects)
        if (now - peer.lastDisconnect < backoffMs) continue
      }

      // Separate suspicious ports - they go last
      if (peer.suspiciousPort) {
        suspiciousCandidates.push(peer)
      } else {
        normalCandidates.push(peer)
      }
    }

    // Score and sort normal candidates
    const scoredNormal = normalCandidates.map((peer) => ({
      peer,
      score: this.calculatePeerScore(peer, now),
    }))
    scoredNormal.sort((a, b) => b.score - a.score)

    // Shuffle suspicious candidates (they're all equally bad)
    this.shuffle(suspiciousCandidates)

    // Return normal peers first, then suspicious as last resort
    const result: SwarmPeer[] = []
    for (const { peer } of scoredNormal) {
      if (result.length >= limit) break
      result.push(peer)
    }

    // Only add suspicious peers if we still need more
    for (const peer of suspiciousCandidates) {
      if (result.length >= limit) break
      result.push(peer)
    }

    return result
  }

  /**
   * Check if there are any peers available for connection.
   * More efficient than getConnectablePeers(1).length > 0 when we just need a boolean.
   */
  hasConnectablePeers(): boolean {
    const now = Date.now()

    for (const peer of this.swarm.getAllPeersArray()) {
      if (peer.state === 'connected' || peer.state === 'connecting') continue
      if (peer.state === 'banned') continue

      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures)
        if (now - peer.lastConnectAttempt < backoffMs) continue
      }

      // Check backoff for quick disconnects
      if (peer.state === 'idle' && peer.quickDisconnects > 0 && peer.lastDisconnect) {
        const backoffMs = this.calculateBackoff(peer.quickDisconnects)
        if (now - peer.lastDisconnect < backoffMs) continue
      }

      // Found at least one eligible peer
      return true
    }

    return false
  }

  // --- Scoring ---

  /**
   * Calculate a quality score for peer selection.
   * Higher is better.
   */
  private calculatePeerScore(peer: SwarmPeer, now: number): number {
    let score = 100

    // Port quality
    score += getPortScorePenalty(peer.port)

    // Prefer peers with previous successful connections
    if (peer.lastConnectSuccess) {
      score += 50
    }

    // Penalize repeated failures
    score -= peer.connectFailures * 20

    // Prefer peers with good download history
    if (peer.totalDownloaded > 0) {
      score += Math.min(50, Math.log10(peer.totalDownloaded) * 10)
    }

    // Penalize recently failed peers (even if backoff expired)
    if (peer.lastConnectAttempt) {
      const timeSince = now - peer.lastConnectAttempt
      if (timeSince < 30000) score -= 30
      else if (timeSince < 60000) score -= 15
    }

    // Source quality
    switch (peer.source) {
      case 'manual':
        score += 20
        break
      case 'tracker':
        score += 10
        break
      case 'incoming':
        score += 5 // They found us, probably real
        break
      case 'pex':
        score += 0 // Neutral
        break
      case 'dht':
        score -= 5 // DHT can have more junk
        break
      case 'lpd':
        score += 15 // Local network, usually good
        break
    }

    // Add small random factor to avoid always picking same peers
    score += Math.random() * 10

    return score
  }

  // --- Backoff ---

  /**
   * Calculate backoff time for a peer based on failure count.
   * Exponential backoff: 1s, 2s, 4s, 8s, ... up to 5 minutes.
   */
  private calculateBackoff(failures: number): number {
    return Math.min(1000 * Math.pow(2, failures), 5 * 60 * 1000)
  }

  // --- Helpers ---

  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }
}
