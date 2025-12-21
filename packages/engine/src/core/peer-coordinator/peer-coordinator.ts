import {
  PeerSnapshot,
  CoordinatorDecisions,
  UnchokeAlgorithmConfig,
  DownloadOptimizerConfig,
  DownloadOptimizerContext,
  UnchokeAlgorithmState,
} from './types'
import { UnchokeAlgorithm } from './unchoke-algorithm'
import { DownloadOptimizer } from './download-optimizer'

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
   * @param context Optional runtime context for download optimizer
   * @returns Combined decisions from both algorithms
   */
  evaluate(
    peers: PeerSnapshot[],
    hasSwarmCandidates: boolean,
    context?: DownloadOptimizerContext,
  ): CoordinatorDecisions {
    // 1. Run unchoke algorithm first - it determines who's protected
    const unchokeDecisions = this.unchokeAlgorithm.evaluate(peers)

    // 2. Get protected set (current upload slot holders)
    const protectedIds = this.unchokeAlgorithm.getProtectedPeers()

    // 3. Run download optimizer with protected set
    const dropDecisions = this.downloadOptimizer.evaluate(
      peers,
      protectedIds,
      hasSwarmCandidates,
      context,
    )

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
