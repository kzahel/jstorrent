import { BLOCK_SIZE } from './active-piece'
import { ActivePieceManager } from './active-piece-manager'
import { PieceAvailability } from './piece-availability'
import { EndgameManager } from './endgame-manager'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { BitField } from '../utils/bitfield'

/**
 * Represents a peer connection for piece requesting purposes.
 * This interface extracts only what PieceRequester needs from PeerConnection.
 */
export interface RequestablePeer {
  /** Unique identifier for this peer (may be undefined before handshake) */
  peerId?: Uint8Array
  remoteAddress?: string
  remotePort?: number

  /** Whether peer is choking us (can't request if true) */
  peerChoking: boolean

  /** Peer's bitfield (pieces they have) */
  bitfield: BitField | null

  /** Whether peer is a seed (has all pieces) */
  isSeed: boolean

  /** Whether peer supports Fast Extension */
  isFast: boolean

  /** Adaptive pipeline depth for this peer */
  pipelineDepth: number

  /** Number of outstanding requests to this peer */
  requestsPending: number

  /** Record that a block was received (for adaptive pipeline) */
  recordBlockReceived(): void

  /** Send batched piece requests */
  sendRequests(requests: Array<{ index: number; begin: number; length: number }>): void
}

/**
 * Dependencies injected into PieceRequester.
 * Uses callbacks to avoid tight coupling with Torrent.
 */
export interface PieceRequesterDeps {
  // === State readers ===

  /** Total number of pieces in torrent */
  getPieceCount(): number

  /** Get length of a specific piece */
  getPieceLength(index: number): number

  /** Get piece priority array (0=skip, 1-7 priority) */
  getPiecePriority(): Uint8Array | null

  /** Get our bitfield (pieces we have) */
  getBitfield(): BitField | undefined

  /** Whether download is paused */
  isKillSwitchEnabled(): boolean

  /** Whether network is active */
  isNetworkActive(): boolean

  /** Whether we have metadata */
  hasMetadata(): boolean

  /** Number of connected peers */
  getConnectedPeerCount(): number

  /** Number of completed pieces */
  getCompletedPieceCount(): number

  /** First piece index we still need (optimization hint) */
  getFirstNeededPiece(): number

  // === Managers ===

  /** Get the active pieces manager (may be undefined before metadata) */
  getActivePieces(): ActivePieceManager | undefined

  /** Initialize active pieces manager (lazy init) */
  initActivePieces(): ActivePieceManager

  /** Get piece availability tracker */
  getAvailability(): PieceAvailability

  /** Get endgame manager */
  getEndgameManager(): EndgameManager

  // === Bandwidth ===

  /** Get configured max pipeline depth */
  getMaxPipelineDepth(): number

  /** Check if download rate limiting is enabled */
  isDownloadRateLimited(): boolean

  /** Get current download rate limit (bytes/sec) */
  getDownloadRateLimit(): number

  /** Try to consume bandwidth for a block. Returns false if rate limited. */
  tryConsumeDownloadBandwidth(bytes: number): boolean

  // === Callbacks ===

  /** Remove a piece from all peer indices (called when piece activated) */
  removePieceFromAllIndices(index: number): void

  /** Check if a piece should be included in peer indices */
  shouldAddToIndex(pieceIndex: number): boolean

  /** Schedule a retry when rate limited. Callback will be invoked after delay. */
  scheduleRateLimitRetry(delayMs: number, callback: () => void): boolean

  /** Called when endgame state may have changed */
  onEndgameEvaluate(missingCount: number, activeCount: number, hasUnrequestedBlocks: boolean): void

  /** Get peer ID string for logging/tracking */
  getPeerId(peer: RequestablePeer): string
}

/**
 * Handles piece selection and requesting for a torrent.
 *
 * Extracted from Torrent class to reduce complexity and improve testability.
 * Uses dependency injection to avoid tight coupling with Torrent internals.
 *
 * The request algorithm has two phases:
 * 1. Request blocks from existing partial pieces (rarest-first with speed affinity)
 * 2. Activate new pieces when more work is needed (rarest-first selection)
 *
 * Key features:
 * - Rarest-first piece selection using libtorrent's priority formula
 * - Adaptive pipeline depth per-peer
 * - Speed affinity for fast peers (prevents piece fragmentation)
 * - Endgame mode support (duplicate requests to finish faster)
 * - Download rate limiting integration
 * - Partial piece cap to prevent "active piece death spiral"
 */
export class TorrentPieceRequester extends EngineComponent {
  static logName = 'piece-requester'

  private deps: PieceRequesterDeps

  // Instrumentation for findNewPieceCandidates
  private _findCandidatesCallCount = 0
  private _findCandidatesLastLogTime = 0

  constructor(engine: ILoggingEngine, deps: PieceRequesterDeps) {
    super(engine)
    this.deps = deps
  }

  /**
   * Request pieces from a peer.
   *
   * Main entry point - fills the peer's pipeline with piece requests.
   * Called when:
   * - Peer unchokes us
   * - New pieces become available
   * - Rate limit retry fires
   * - Periodically from game loop
   *
   * @param peer - The peer to request from
   * @param now - Current timestamp for request tracking
   */
  request(peer: RequestablePeer, now: number): void {
    // Early exit conditions
    if (!this.deps.isNetworkActive()) return
    if (this.deps.isKillSwitchEnabled()) return
    if (peer.peerChoking) return
    if (!this.deps.hasMetadata()) return

    // Get or initialize active pieces manager
    let activePieces = this.deps.getActivePieces()
    if (!activePieces) {
      activePieces = this.deps.initActivePieces()
    }

    // Calculate effective pipeline limit
    const pipelineLimit = this.calculatePipelineLimit(peer)

    // Early exit if pipeline is already full
    if (peer.requestsPending >= pipelineLimit) return

    const peerId = this.deps.getPeerId(peer)
    const peerBitfield = peer.bitfield
    const isEndgame = this.deps.getEndgameManager().isEndgame
    const peerIsFast = peer.isFast
    const availability = this.deps.getAvailability()

    // Collect requests for batched sending (reduces FFI overhead)
    const pendingRequests: Array<{ index: number; begin: number; length: number }> = []

    // Helper to flush pending requests before early returns
    const flushPending = () => {
      if (pendingRequests.length > 0) {
        peer.sendRequests(pendingRequests)
        pendingRequests.length = 0
      }
    }

    // PHASE 1: Request from existing partial pieces (rarest-first with speed affinity)
    const rawAvailability = availability.rawAvailability
    const piecePriority = this.deps.getPiecePriority()

    if (rawAvailability && piecePriority) {
      const sortedPartials = activePieces.getPartialsRarestFirst(
        rawAvailability,
        availability.seedCount,
        piecePriority,
      )

      for (const piece of sortedPartials) {
        if (peer.requestsPending >= pipelineLimit) {
          flushPending()
          return
        }

        // Skip if peer doesn't have this piece (seeds have everything)
        if (!peer.isSeed && !peerBitfield?.get(piece.index)) continue

        // Speed affinity - check if this peer can request from this piece
        if (!piece.canRequestFrom(peerId, peerIsFast)) continue

        // Fast path: In normal mode, skip pieces with no unrequested blocks
        if (!isEndgame && !piece.hasUnrequestedBlocks) continue

        // Fast peer claims exclusive ownership
        if (piece.exclusivePeer === null && peerIsFast) {
          piece.claimExclusive(peerId)
        }

        // Get blocks we can request from this piece
        const neededBlocks = isEndgame
          ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
          : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

        for (const block of neededBlocks) {
          if (peer.requestsPending >= pipelineLimit) {
            flushPending()
            return
          }

          // Rate limit check
          if (
            this.deps.isDownloadRateLimited() &&
            !this.deps.tryConsumeDownloadBandwidth(block.length)
          ) {
            flushPending()
            this.deps.scheduleRateLimitRetry(block.length, () => {})
            return
          }

          pendingRequests.push({ index: piece.index, begin: block.begin, length: block.length })
          peer.requestsPending++

          const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
          piece.addRequest(blockIndex, peerId, now)

          // Promote to full if all blocks are now requested
          if (!piece.hasUnrequestedBlocks) {
            activePieces.promoteToFullyRequested(piece.index)
          }
        }
      }
    } else {
      // Fallback: iterate in arbitrary order if availability tracking not ready
      for (const piece of activePieces.partialValues()) {
        if (peer.requestsPending >= pipelineLimit) {
          flushPending()
          return
        }
        if (!peerBitfield?.get(piece.index)) continue
        if (!isEndgame && !piece.hasUnrequestedBlocks) continue

        const neededBlocks = isEndgame
          ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
          : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

        for (const block of neededBlocks) {
          if (peer.requestsPending >= pipelineLimit) {
            flushPending()
            return
          }
          if (
            this.deps.isDownloadRateLimited() &&
            !this.deps.tryConsumeDownloadBandwidth(block.length)
          ) {
            flushPending()
            this.deps.scheduleRateLimitRetry(block.length, () => {})
            return
          }
          pendingRequests.push({ index: piece.index, begin: block.begin, length: block.length })
          peer.requestsPending++
          const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
          piece.addRequest(blockIndex, peerId, now)

          if (!piece.hasUnrequestedBlocks) {
            activePieces.promoteToFullyRequested(piece.index)
          }
        }
      }
    }

    // PHASE 2: Activate new pieces (rarest-first selection)
    if (peer.requestsPending >= pipelineLimit) {
      flushPending()
      return
    }
    if (!peerBitfield || !this.deps.getBitfield() || !piecePriority || !rawAvailability) {
      flushPending()
      return
    }

    // Partial Cap: Don't start new pieces if we have too many partials
    const connectedPeerCount = this.deps.getConnectedPeerCount()
    if (activePieces.shouldPrioritizePartials(connectedPeerCount)) {
      flushPending()
      return
    }

    // Find candidate pieces sorted by rarity
    const candidates = this.findNewPieceCandidates(peer, pipelineLimit - peer.requestsPending)

    for (const pieceIndex of candidates) {
      if (peer.requestsPending >= pipelineLimit) break

      // Create new active piece
      const piece = activePieces.getOrCreate(pieceIndex)
      if (!piece) break // At capacity

      // Remove from peer indices since it's now active
      this.deps.removePieceFromAllIndices(pieceIndex)

      // Fast peer claims exclusive ownership on new pieces
      if (peerIsFast) {
        piece.claimExclusive(peerId)
      }

      const neededBlocks = this.deps.getEndgameManager().isEndgame
        ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
        : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

      for (const block of neededBlocks) {
        if (peer.requestsPending >= pipelineLimit) break

        // Rate limit check
        if (
          this.deps.isDownloadRateLimited() &&
          !this.deps.tryConsumeDownloadBandwidth(block.length)
        ) {
          flushPending()
          this.deps.scheduleRateLimitRetry(block.length, () => {})
          return
        }

        pendingRequests.push({ index: pieceIndex, begin: block.begin, length: block.length })
        peer.requestsPending++

        const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
        piece.addRequest(blockIndex, peerId, now)

        if (!piece.hasUnrequestedBlocks) {
          activePieces.promoteToFullyRequested(piece.index)
        }
      }
    }

    // Flush any remaining pending requests
    flushPending()

    // Check if we should enter/exit endgame mode
    const pieceCount = this.deps.getPieceCount()
    const completedCount = this.deps.getCompletedPieceCount()
    const missingCount = pieceCount - completedCount
    this.deps.onEndgameEvaluate(
      missingCount,
      activePieces.activeCount,
      activePieces.hasUnrequestedBlocks(),
    )
  }

  /**
   * Calculate effective pipeline limit for a peer.
   * Takes into account:
   * - Peer's adaptive pipeline depth
   * - Configured max pipeline depth
   * - Rate limit cap when bandwidth limiting is active
   */
  private calculatePipelineLimit(peer: RequestablePeer): number {
    let pipelineLimit = peer.pipelineDepth

    // Apply configurable pipeline depth cap
    pipelineLimit = Math.min(pipelineLimit, this.deps.getMaxPipelineDepth())

    // Cap pipeline depth when rate limited to prevent fast peers from monopolizing bandwidth
    if (this.deps.isDownloadRateLimited()) {
      const rateLimit = this.deps.getDownloadRateLimit()
      const blockSize = 16384 // 16KB standard block

      // Cap at ~1 second worth of bandwidth, minimum 1
      const rateLimitCap = Math.max(1, Math.floor(rateLimit / blockSize))
      pipelineLimit = Math.min(pipelineLimit, rateLimitCap)
    }

    return pipelineLimit
  }

  /**
   * Find new pieces to activate, sorted by rarity.
   *
   * Uses libtorrent's priority formula:
   * sortKey = availability × (PRIORITY_LEVELS - piecePriority) × PRIO_FACTOR
   *
   * Lower sort key = picked first (rarer + higher priority wins)
   *
   * @param peer - The peer to find pieces for
   * @param maxCount - Maximum number of candidates to return
   * @returns Array of piece indices sorted by rarity (rarest first)
   */
  private findNewPieceCandidates(peer: RequestablePeer, maxCount: number): number[] {
    const availability = this.deps.getAvailability()
    const availabilityArray = availability.rawAvailability
    const bitfield = this.deps.getBitfield()
    const piecePriority = this.deps.getPiecePriority()
    const activePieces = this.deps.getActivePieces()

    if (!bitfield || !piecePriority || !availabilityArray || !activePieces) {
      return []
    }

    const startTime = Date.now()
    const candidates: Array<{ index: number; sortKey: number }> = []
    const collectLimit = maxCount * 2
    let iterations = 0
    let usedIndex = false
    const seedCount = availability.seedCount
    const pieceCount = this.deps.getPieceCount()
    const firstNeededPiece = this.deps.getFirstNeededPiece()

    // Use per-peer index for non-seeds (O(pieces peer has) instead of O(all pieces))
    const peerId = this.deps.getPeerId(peer)
    const peerPieceSet = availability.getPeerPieceSet(peerId)

    if (!peer.isSeed && peerPieceSet && peerPieceSet.size > 0) {
      // Use the pre-computed index - only iterate pieces peer has that we need
      usedIndex = true
      for (const i of peerPieceSet) {
        iterations++
        if (candidates.length >= collectLimit) break

        const prio = piecePriority[i]
        const pieceAvail = availabilityArray[i] + seedCount
        const sortKey = pieceAvail * (8 - prio) * 3 // 8 = PRIORITY_LEVELS, 3 = PRIO_FACTOR

        candidates.push({ index: i, sortKey })
      }
    } else {
      // Seeds or no index: use original linear scan algorithm
      const peerBitfield = peer.bitfield
      for (let i = firstNeededPiece; i < pieceCount && candidates.length < collectLimit; i++) {
        iterations++

        // Skip if we have it
        if (bitfield.get(i)) continue

        // Skip if peer doesn't have it (seeds have everything)
        if (!peer.isSeed && !peerBitfield?.get(i)) continue

        // Skip if priority is 0 (skipped file)
        const prio = piecePriority[i]
        if (prio === 0) continue

        // Skip if already active (handled in phase 1)
        if (activePieces.has(i)) continue

        // Calculate sort key using libtorrent formula
        const pieceAvail = availabilityArray[i] + seedCount
        const sortKey = pieceAvail * (8 - prio) * 3

        candidates.push({ index: i, sortKey })
      }
    }

    // Sort by rarity (lower sortKey = rarer/higher priority = first)
    candidates.sort((a, b) => a.sortKey - b.sortKey)

    const elapsed = Date.now() - startTime

    // Log every 5 seconds
    this._findCandidatesCallCount++
    const now = Date.now()
    if (now - this._findCandidatesLastLogTime >= 5000) {
      this.logger.info(
        `findNewPieceCandidates: ${iterations} iterations, ${candidates.length} found, ` +
          `${elapsed}ms, firstNeeded=${firstNeededPiece}, total=${pieceCount}, ` +
          `calls=${this._findCandidatesCallCount}, maxCount=${maxCount}, usedIndex=${usedIndex}`,
      )
      this._findCandidatesCallCount = 0
      this._findCandidatesLastLogTime = now
    }

    // Return just the indices
    return candidates.slice(0, maxCount).map((c) => c.index)
  }
}
