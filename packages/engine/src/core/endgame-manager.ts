import { ActivePiece, BLOCK_SIZE } from './active-piece'

/**
 * Decision to enter or exit endgame mode.
 */
export interface EndgameDecision {
  type: 'enter_endgame' | 'exit_endgame'
}

/**
 * Decision to send a CANCEL message to a peer.
 */
export interface CancelDecision {
  peerId: string
  index: number
  begin: number
  length: number
}

/**
 * Configuration for endgame mode.
 */
export interface EndgameConfig {
  /**
   * Maximum number of duplicate requests per block.
   * 0 = unlimited (request from all peers that have the piece)
   * Default: 3
   */
  maxDuplicateRequests: number
}

const DEFAULT_CONFIG: EndgameConfig = {
  maxDuplicateRequests: 3,
}

/**
 * Manages endgame mode for accelerating download completion.
 *
 * Endgame mode activates when:
 * - All remaining pieces have been activated (we're working on them)
 * - Every block in every active piece has at least one outstanding request
 *
 * In endgame mode:
 * - Duplicate block requests are sent to multiple peers
 * - CANCEL messages are sent when blocks arrive to avoid waste
 *
 * This class is pure - no I/O, no side effects. Produces decisions for caller to execute.
 */
export class EndgameManager {
  private _inEndgame = false
  private config: EndgameConfig

  constructor(config: Partial<EndgameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Whether we're currently in endgame mode.
   */
  get isEndgame(): boolean {
    return this._inEndgame
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<EndgameConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<EndgameConfig> {
    return { ...this.config }
  }

  /**
   * Evaluate whether to enter or exit endgame mode.
   *
   * @param missingPieceCount Number of pieces we don't have yet
   * @param activePieceCount Number of pieces currently being downloaded
   * @param hasUnrequestedBlocks Whether any active piece has blocks with no requests
   * @returns Decision to enter/exit endgame, or null if no change
   */
  evaluate(
    missingPieceCount: number,
    activePieceCount: number,
    hasUnrequestedBlocks: boolean,
  ): EndgameDecision | null {
    // Endgame conditions:
    // 1. We have missing pieces (not complete)
    // 2. All missing pieces are active (we're working on all of them)
    // 3. No unrequested blocks (everything has at least one request)
    const shouldBeEndgame =
      missingPieceCount > 0 && missingPieceCount === activePieceCount && !hasUnrequestedBlocks

    if (shouldBeEndgame && !this._inEndgame) {
      this._inEndgame = true
      return { type: 'enter_endgame' }
    }

    if (!shouldBeEndgame && this._inEndgame) {
      this._inEndgame = false
      return { type: 'exit_endgame' }
    }

    return null
  }

  /**
   * Force exit endgame mode (e.g., when torrent completes or stops).
   */
  reset(): void {
    this._inEndgame = false
  }

  /**
   * Get CANCEL decisions for a received block.
   * Called when a block arrives to cancel duplicate requests from other peers.
   *
   * @param piece The ActivePiece containing the block
   * @param blockIndex Index of the block within the piece
   * @param receivedFromPeerId Peer that sent us this block (don't cancel them)
   * @returns List of CANCEL messages to send
   */
  getCancels(piece: ActivePiece, blockIndex: number, receivedFromPeerId: string): CancelDecision[] {
    if (!this._inEndgame) return []

    const otherPeers = piece.getOtherRequesters(blockIndex, receivedFromPeerId)
    if (otherPeers.length === 0) return []

    const begin = blockIndex * BLOCK_SIZE
    const length = Math.min(BLOCK_SIZE, piece.length - begin)

    return otherPeers.map((peerId) => ({
      peerId,
      index: piece.index,
      begin,
      length,
    }))
  }

  /**
   * Check if we should send a duplicate request to a peer for a block.
   * Respects maxDuplicateRequests config.
   *
   * @param currentRequestCount How many requests are already out for this block
   * @returns Whether to send another duplicate request
   */
  shouldSendDuplicateRequest(currentRequestCount: number): boolean {
    if (!this._inEndgame) return false
    if (this.config.maxDuplicateRequests === 0) return true // Unlimited
    return currentRequestCount < this.config.maxDuplicateRequests
  }
}
