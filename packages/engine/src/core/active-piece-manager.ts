import { ActivePiece } from './active-piece'
import { PieceBufferPool } from './piece-buffer-pool'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export interface ActivePieceConfig {
  requestTimeoutMs: number
  maxActivePieces: number
  maxBufferedBytes: number
  /** Standard piece length for buffer pooling. If not set, buffer pooling is disabled. */
  standardPieceLength?: number
  /** Maximum number of buffers to keep in pool (default: 64) */
  maxPoolSize?: number
}

// Detect if running in native/QuickJS environment (Android/iOS)
// QuickJS is much slower at iteration than V8, so we need tighter limits
const isNativeRuntime =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>).__jstorrent_tcp_connect === 'function'

const DEFAULT_CONFIG: ActivePieceConfig = {
  requestTimeoutMs: 30000,
  // Allow unlimited active pieces - the haveAllBlocks check is now O(1)
  // and hasUnrequestedBlocks uses allocation-free iteration.
  // Memory is the real constraint, handled by maxBufferedBytes.
  maxActivePieces: 10000,
  maxBufferedBytes: isNativeRuntime ? 128 * 1024 * 1024 : 256 * 1024 * 1024,
}

/**
 * Manages ActivePiece objects for pieces being downloaded.
 *
 * Uses lazy instantiation pattern:
 * - Objects created on first access via getOrCreate()
 * - Objects removed explicitly via remove() when piece is verified or abandoned
 *
 * Key responsibility: clearRequestsForPeer() - when a peer disconnects,
 * remove all pending requests from that peer so blocks can be re-requested
 * from other peers. This fixes the "stall on peer disconnect" bug.
 *
 * Piece State Model (matching libtorrent):
 * - Partial pieces: has unrequested blocks (counts against cap)
 * - Full pieces: all blocks requested but not all received (does NOT count against cap)
 * - Pending pieces: all blocks received, awaiting verification
 *
 * The partial cap (peers × 1.5) only applies to partial pieces, not full or pending.
 * This allows single-peer scenarios to fill the pipeline without stalling.
 */
export class ActivePieceManager extends EngineComponent {
  static logName = 'active-pieces'

  /** Pieces with unrequested blocks (partial) - counts against cap */
  private _partialPieces: Map<number, ActivePiece> = new Map()
  /** Pieces with all blocks requested but not all received (full) - does NOT count against cap */
  private _fullPieces: Map<number, ActivePiece> = new Map()
  /** Pieces with all blocks received, awaiting verification (pending) */
  private _pendingPieces: Map<number, ActivePiece> = new Map()
  private config: ActivePieceConfig
  private pieceLengthFn: (index: number) => number
  private bufferPool: PieceBufferPool | null = null
  /** Standard block size for calculating block cap (typically 16KB) */
  private readonly blocksPerPiece: number

  constructor(
    engine: ILoggingEngine,
    pieceLengthFn: (index: number) => number,
    config: Partial<ActivePieceConfig> = {},
  ) {
    super(engine)
    this.pieceLengthFn = pieceLengthFn
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Calculate blocks per piece for cap calculation (16KB blocks)
    const BLOCK_SIZE = 16384
    this.blocksPerPiece = this.config.standardPieceLength
      ? Math.ceil(this.config.standardPieceLength / BLOCK_SIZE)
      : 16 // Default assumption: 256KB pieces = 16 blocks

    // Initialize buffer pool if standard piece length is configured
    if (this.config.standardPieceLength) {
      this.bufferPool = new PieceBufferPool(
        this.config.standardPieceLength,
        this.config.maxPoolSize ?? 64,
      )
      this.logger.debug(
        `Buffer pool initialized for ${this.config.standardPieceLength} byte pieces`,
      )
    }

    // Note: Request timeout checking is handled by Torrent.cleanupStuckPieces()
    // which runs every 500ms with a 10s timeout. This is more aggressive and
    // properly sends CANCEL messages to peers, making a separate interval here redundant.
  }

  // --- Lazy Instantiation ---

  /**
   * Get or create an ActivePiece for the given index.
   * Returns null if at capacity limits.
   * New pieces are added to the partial map (still downloading).
   */
  getOrCreate(index: number): ActivePiece | null {
    // Check partial map first
    let piece = this._partialPieces.get(index)
    if (piece) return piece

    // Check full map (all blocks requested)
    piece = this._fullPieces.get(index)
    if (piece) return piece

    // Also check pending (shouldn't happen but defensive)
    piece = this._pendingPieces.get(index)
    if (piece) return piece

    // Check piece count limit before creating
    const totalActive = this._partialPieces.size + this._fullPieces.size + this._pendingPieces.size
    if (totalActive >= this.config.maxActivePieces) {
      // Try to clean up stale pieces first
      this.cleanupStale()
      const newTotal = this._partialPieces.size + this._fullPieces.size + this._pendingPieces.size
      if (newTotal >= this.config.maxActivePieces) {
        this.logger.debug(`Cannot create piece ${index}: at capacity (${newTotal})`)
        return null
      }
    }

    // Check memory limit
    if (this.totalBufferedBytes >= this.config.maxBufferedBytes) {
      this.logger.debug(`Cannot create piece ${index}: memory limit reached`)
      return null
    }

    const length = this.pieceLengthFn(index)

    // Try to acquire a buffer from the pool (only if size matches standard)
    let buffer: Uint8Array | undefined
    if (this.bufferPool && length === this.config.standardPieceLength) {
      buffer = this.bufferPool.acquire()
    }

    piece = new ActivePiece(index, length, buffer)
    this._partialPieces.set(index, piece)
    this.logger.debug(`Created active piece ${index}`)
    return piece
  }

  /**
   * Get existing ActivePiece without creating.
   * Checks all three maps: partial, full, and pending.
   */
  get(index: number): ActivePiece | undefined {
    return (
      this._partialPieces.get(index) ??
      this._fullPieces.get(index) ??
      this._pendingPieces.get(index)
    )
  }

  /**
   * Check if a piece is active (in partial, full, or pending state).
   */
  has(index: number): boolean {
    return (
      this._partialPieces.has(index) ||
      this._fullPieces.has(index) ||
      this._pendingPieces.has(index)
    )
  }

  /**
   * Check if a piece is in partial state (has unrequested blocks).
   */
  isPartial(index: number): boolean {
    return this._partialPieces.has(index)
  }

  /**
   * Check if a piece is in full state (all blocks requested but not all received).
   */
  isFull(index: number): boolean {
    return this._fullPieces.has(index)
  }

  /**
   * Check if a piece is in pending state (awaiting verification).
   */
  isPending(index: number): boolean {
    return this._pendingPieces.has(index)
  }

  /**
   * Remove an ActivePiece (after verification or abandonment).
   * Removes from partial, full, or pending map.
   */
  remove(index: number): void {
    let piece = this._partialPieces.get(index)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._partialPieces.delete(index)
      this.logger.debug(`Removed partial piece ${index}`)
      return
    }

    piece = this._fullPieces.get(index)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._fullPieces.delete(index)
      this.logger.debug(`Removed full piece ${index}`)
      return
    }

    piece = this._pendingPieces.get(index)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._pendingPieces.delete(index)
      this.logger.debug(`Removed pending piece ${index}`)
    }
  }

  // --- Piece State Lifecycle ---

  /**
   * Move a piece from partial to full state.
   * Called when all blocks have been requested but not all received yet.
   * Full pieces don't count against the partial cap, allowing the pipeline to stay full.
   */
  promoteToFull(pieceIndex: number): void {
    const piece = this._partialPieces.get(pieceIndex)
    if (piece && !piece.hasUnrequestedBlocks) {
      this._partialPieces.delete(pieceIndex)
      this._fullPieces.set(pieceIndex, piece)
      this.logger.debug(
        `Piece ${pieceIndex} promoted to full (all blocks requested), ` +
          `partials: ${this._partialPieces.size}, full: ${this._fullPieces.size}`,
      )
    }
  }

  /**
   * Move a piece from full back to partial state.
   * Called when a request is cancelled (timeout, peer disconnect) and the piece
   * now has unrequested blocks again.
   */
  demoteToPartial(pieceIndex: number): void {
    const piece = this._fullPieces.get(pieceIndex)
    if (piece && piece.hasUnrequestedBlocks) {
      this._fullPieces.delete(pieceIndex)
      this._partialPieces.set(pieceIndex, piece)
      this.logger.debug(
        `Piece ${pieceIndex} demoted to partial (has unrequested blocks), ` +
          `partials: ${this._partialPieces.size}, full: ${this._fullPieces.size}`,
      )
    }
  }

  /**
   * Move a piece from partial or full to pending state.
   * Called when all blocks have been received and piece is awaiting verification.
   */
  promoteToPending(pieceIndex: number): void {
    // Check full pieces first (most likely path when piece completes)
    let piece = this._fullPieces.get(pieceIndex)
    if (piece) {
      this._fullPieces.delete(pieceIndex)
      this._pendingPieces.set(pieceIndex, piece)
      this.logger.debug(
        `Piece ${pieceIndex} promoted to pending (awaiting verification), ` +
          `full: ${this._fullPieces.size}, pending: ${this._pendingPieces.size}`,
      )
      return
    }

    // Also check partials (edge case: received blocks without requesting, or rapid completion)
    piece = this._partialPieces.get(pieceIndex)
    if (piece) {
      this._partialPieces.delete(pieceIndex)
      this._pendingPieces.set(pieceIndex, piece)
      this.logger.debug(
        `Piece ${pieceIndex} promoted to pending (awaiting verification), ` +
          `partials: ${this._partialPieces.size}, pending: ${this._pendingPieces.size}`,
      )
    }
  }

  /**
   * Remove a piece from pending state after verification completes.
   * Also checks full map defensively in case state got out of sync.
   * Returns the piece for buffer reuse if needed.
   */
  removePending(pieceIndex: number): ActivePiece | undefined {
    let piece = this._pendingPieces.get(pieceIndex)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._pendingPieces.delete(pieceIndex)
      this.logger.debug(`Removed pending piece ${pieceIndex} after verification`)
      return piece
    }

    // Defensive: also check full map in case promotion was skipped
    piece = this._fullPieces.get(pieceIndex)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._fullPieces.delete(pieceIndex)
      this.logger.debug(`Removed full piece ${pieceIndex} (defensive cleanup)`)
      return piece
    }

    return undefined
  }

  // --- Partial Cap Logic (Phase 2) ---

  /**
   * Check if we should prioritize completing existing partial pieces
   * over starting new ones. Returns true when partials exceed threshold.
   *
   * The threshold is min(peers × 1.5, 2048 / blocksPerPiece).
   * This counts ONLY partial pieces, not pending pieces awaiting verification.
   */
  shouldPrioritizePartials(connectedPeerCount: number): boolean {
    const maxAllowed = this.getMaxPartials(connectedPeerCount)
    return this._partialPieces.size > maxAllowed
  }

  /**
   * Get the maximum number of partial pieces allowed.
   * Based on libtorrent: min(peers × 1.5, 2048 / blocksPerPiece)
   */
  getMaxPartials(connectedPeerCount: number): number {
    const peerThreshold = Math.floor(connectedPeerCount * 1.5)
    const blockCap = Math.floor(2048 / this.blocksPerPiece)
    return Math.max(1, Math.min(peerThreshold, blockCap)) // At least 1
  }

  /**
   * Release a piece's buffer back to the pool if it matches the standard size.
   */
  private releaseBuffer(piece: ActivePiece): void {
    if (this.bufferPool && piece.length === this.config.standardPieceLength) {
      this.bufferPool.release(piece.getBuffer())
    }
  }

  // --- Iteration ---

  get activeIndices(): number[] {
    return [
      ...this._partialPieces.keys(),
      ...this._fullPieces.keys(),
      ...this._pendingPieces.keys(),
    ]
  }

  /**
   * Returns an array of active pieces. Creates a new array each call.
   * Use values() for zero-allocation iteration in hot paths.
   */
  get activePieces(): ActivePiece[] {
    return [
      ...this._partialPieces.values(),
      ...this._fullPieces.values(),
      ...this._pendingPieces.values(),
    ]
  }

  /**
   * Returns an iterator over ALL active pieces (partial, full, and pending).
   * Use partialValues() or downloadingValues() in request loops.
   */
  values(): IterableIterator<ActivePiece> {
    return this.allPiecesIterator()
  }

  /**
   * Generator that yields all pieces from all three maps.
   */
  private *allPiecesIterator(): IterableIterator<ActivePiece> {
    yield* this._partialPieces.values()
    yield* this._fullPieces.values()
    yield* this._pendingPieces.values()
  }

  /**
   * Returns an iterator over ONLY partial pieces (has unrequested blocks).
   * Use this in Phase 1 request loops to find pieces with work to do.
   */
  partialValues(): IterableIterator<ActivePiece> {
    return this._partialPieces.values()
  }

  /**
   * Returns an iterator over ONLY full pieces (all blocks requested, not all received).
   */
  fullValues(): IterableIterator<ActivePiece> {
    return this._fullPieces.values()
  }

  /**
   * Returns an iterator over downloading pieces (partial + full).
   * Use this when you need to check for incoming blocks - both partial and full
   * pieces have outstanding requests that may receive data.
   */
  *downloadingValues(): IterableIterator<ActivePiece> {
    yield* this._partialPieces.values()
    yield* this._fullPieces.values()
  }

  // === Phase 3: Rarest-First Sorting with Priority ===

  /**
   * libtorrent priority levels (from piece_picker.hpp)
   * Priority 0 means "don't download"
   * Priority 7 is highest
   */
  static readonly PRIORITY_DONT_DOWNLOAD = 0
  static readonly PRIORITY_LEVELS = 8
  static readonly PRIO_FACTOR = 3

  /**
   * Get partial pieces sorted by priority using libtorrent's algorithm.
   *
   * Sort order (lower sort key = picked first):
   * 1. Higher piece priority (priority 7 beats priority 4)
   * 2. Lower availability (rarest first)
   * 3. Higher completion ratio (tiebreaker: finish pieces faster)
   *
   * The formula matches libtorrent's piece_picker.hpp:727-755:
   * sortKey = availability × (PRIORITY_LEVELS - piecePriority) × PRIO_FACTOR
   *
   * Note: Only iterates partial pieces, NOT pending (complete but unverified).
   * This is critical because:
   * 1. Pending pieces have all blocks - no requests needed
   * 2. Phase 2 caps partials at peers × 1.5, keeping this list small (~30-50)
   * 3. Sorting 50 items is O(50 log 50) ≈ 280 comparisons - negligible overhead
   *
   * @param pieceAvailability - Per-piece availability count (Uint16Array)
   * @param seedCount - Number of connected seed peers (added to all availability counts)
   * @param piecePriority - Per-piece priority (Uint8Array, 0-7 where 0=skip, 7=highest)
   */
  // Instrumentation for getPartialsRarestFirst
  private _getPartialsCallCount = 0
  private _getPartialsLastLogTime = 0

  getPartialsRarestFirst(
    pieceAvailability: Uint16Array,
    seedCount: number,
    piecePriority: Uint8Array,
  ): ActivePiece[] {
    const startTime = Date.now()
    const partials = [...this._partialPieces.values()]

    partials.sort((a, b) => {
      const prioA = piecePriority[a.index]
      const prioB = piecePriority[b.index]

      // Filtered pieces (priority 0) go last
      if (prioA === ActivePieceManager.PRIORITY_DONT_DOWNLOAD) {
        if (prioB !== ActivePieceManager.PRIORITY_DONT_DOWNLOAD) return 1
        // Both filtered - compare by index for stability
        return a.index - b.index
      }
      if (prioB === ActivePieceManager.PRIORITY_DONT_DOWNLOAD) return -1

      // Calculate combined sort key using libtorrent formula
      // Lower key = picked first
      const availA = pieceAvailability[a.index] + seedCount
      const availB = pieceAvailability[b.index] + seedCount

      const sortKeyA =
        availA * (ActivePieceManager.PRIORITY_LEVELS - prioA) * ActivePieceManager.PRIO_FACTOR
      const sortKeyB =
        availB * (ActivePieceManager.PRIORITY_LEVELS - prioB) * ActivePieceManager.PRIO_FACTOR

      if (sortKeyA !== sortKeyB) {
        return sortKeyA - sortKeyB
      }

      // Tiebreaker: most complete first (higher completion ratio wins)
      const completionA = a.blocksReceived / a.blocksNeeded
      const completionB = b.blocksReceived / b.blocksNeeded
      if (completionA !== completionB) {
        return completionB - completionA
      }

      // Final tiebreaker: lower index first (deterministic ordering)
      return a.index - b.index
    })

    const elapsed = Date.now() - startTime

    // Log every 5 seconds
    this._getPartialsCallCount++
    const now = Date.now()
    if (now - this._getPartialsLastLogTime >= 5000) {
      this.logger.info(
        `getPartialsRarestFirst: ${partials.length} partials, ${elapsed}ms, ` +
          `calls=${this._getPartialsCallCount}`,
      )
      this._getPartialsCallCount = 0
      this._getPartialsLastLogTime = now
    }

    return partials
  }

  /**
   * Returns an iterator over ONLY pending pieces (awaiting verification).
   * Useful for verification queue management.
   */
  pendingValues(): IterableIterator<ActivePiece> {
    return this._pendingPieces.values()
  }

  /**
   * Total count of active pieces (partial + full + pending).
   */
  get activeCount(): number {
    return this._partialPieces.size + this._fullPieces.size + this._pendingPieces.size
  }

  /**
   * Count of partial pieces only (has unrequested blocks).
   * This is what the partial cap is based on.
   */
  get partialCount(): number {
    return this._partialPieces.size
  }

  /**
   * Count of full pieces (all blocks requested, not all received).
   * These don't count against the partial cap.
   */
  get fullCount(): number {
    return this._fullPieces.size
  }

  /**
   * Count of pending pieces (awaiting verification).
   */
  get pendingCount(): number {
    return this._pendingPieces.size
  }

  // --- Memory Tracking ---

  get totalBufferedBytes(): number {
    let total = 0
    for (const piece of this._partialPieces.values()) {
      total += piece.bufferedBytes
    }
    for (const piece of this._fullPieces.values()) {
      total += piece.bufferedBytes
    }
    for (const piece of this._pendingPieces.values()) {
      total += piece.bufferedBytes
    }
    return total
  }

  // --- Request Management (THE KEY FIX) ---

  /**
   * Clear all requests from a specific peer across all active pieces.
   * Called when a peer disconnects to allow re-requesting blocks.
   * Returns the total number of requests cleared.
   *
   * Also demotes full pieces back to partial if they now have unrequested blocks.
   */
  clearRequestsForPeer(peerId: string): number {
    let totalCleared = 0

    // Clear from partial pieces
    for (const piece of this._partialPieces.values()) {
      totalCleared += piece.clearRequestsForPeer(peerId)
    }

    // Clear from full pieces and demote if needed
    const toDemote: number[] = []
    for (const piece of this._fullPieces.values()) {
      const cleared = piece.clearRequestsForPeer(peerId)
      totalCleared += cleared
      if (cleared > 0 && piece.hasUnrequestedBlocks) {
        toDemote.push(piece.index)
      }
    }
    for (const index of toDemote) {
      this.demoteToPartial(index)
    }

    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} requests for peer ${peerId}`)
    }
    return totalCleared
  }

  /**
   * Check if any partial piece has unrequested blocks.
   * Used to determine endgame eligibility.
   * Only checks partial pieces (full pieces have all blocks requested,
   * pending pieces have all blocks received).
   */
  hasUnrequestedBlocks(): boolean {
    for (const piece of this._partialPieces.values()) {
      // Use the piece's allocation-free check instead of getNeededBlocks()
      if (piece.hasUnrequestedBlocks) {
        return true
      }
    }
    return false
  }

  /**
   * Remove stale pieces that are not making progress.
   * A piece is considered stale if:
   * - No activity for staleThreshold (2x request timeout = 60s by default)
   * - AND not complete (pieces with all blocks are waiting for disk write)
   * - AND either: no data received, OR no outstanding requests (stuck)
   *
   * Only checks partial pieces - pending pieces are actively being verified.
   */
  private cleanupStale(): void {
    const now = Date.now()
    const staleThreshold = this.config.requestTimeoutMs * 2

    for (const [index, piece] of this._partialPieces) {
      const isStale = now - piece.lastActivity > staleThreshold

      // Never remove pieces that have all blocks - they should be in pending, not here
      // (but check defensively in case promotion was delayed)
      if (piece.haveAllBlocks) continue

      // Remove if stale AND either:
      // - No data received (original condition - piece never got started)
      // - No outstanding requests (piece is stuck - has data but no pending requests)
      if (isStale && (piece.blocksReceived === 0 || piece.outstandingRequests === 0)) {
        this.logger.debug(
          `Removing stale piece ${index} (blocks: ${piece.blocksReceived}, requests: ${piece.outstandingRequests})`,
        )
        // Release buffer back to pool before clearing
        this.releaseBuffer(piece)
        piece.clear()
        this._partialPieces.delete(index)
      }
    }
  }

  /**
   * Cleanup on destroy.
   */
  destroy(): void {
    // Release all buffers back to pool before clearing
    for (const piece of this._partialPieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    for (const piece of this._fullPieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    for (const piece of this._pendingPieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    this._partialPieces.clear()
    this._fullPieces.clear()
    this._pendingPieces.clear()

    // Clear the buffer pool
    if (this.bufferPool) {
      this.bufferPool.clear()
    }
  }

  /**
   * Get buffer pool statistics for debugging/monitoring.
   * Returns null if buffer pooling is not enabled.
   */
  get bufferPoolStats(): {
    acquires: number
    reuses: number
    releases: number
    pooled: number
  } | null {
    return this.bufferPool?.stats ?? null
  }
}
