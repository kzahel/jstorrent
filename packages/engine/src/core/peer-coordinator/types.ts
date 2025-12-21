// ============================================================================
// Shared Types for Peer Coordination Algorithms
// ============================================================================

/**
 * Snapshot of peer state for unchoke algorithm.
 * Pure data - no methods, no references to PeerConnection.
 */
export interface UnchokePeerSnapshot {
  id: string // Unique identifier (ip:port)
  peerInterested: boolean // They want to download from us
  amChoking: boolean // We are currently choking them
  downloadRate: number // Bytes/sec they're giving US (for tit-for-tat)
  connectedAt: number // Timestamp when connected (for new peer weighting)
}

/**
 * Snapshot of peer state for download optimizer.
 */
export interface DownloadPeerSnapshot {
  id: string
  peerChoking: boolean // They are choking US
  downloadRate: number // Bytes/sec they're giving us
  connectedAt: number // When connected
  lastDataReceived: number // Timestamp of last data from them
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
 * Runtime context for DownloadOptimizer.evaluate().
 * Separate from config since this is dynamic state, not persisted settings.
 */
export interface DownloadOptimizerContext {
  /**
   * Skip speed-based drop checks (too_slow, below_average).
   * Useful when rate-limited so peers aren't dropped for appearing slow.
   * Does NOT affect choked_timeout check.
   */
  skipSpeedChecks?: boolean
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
