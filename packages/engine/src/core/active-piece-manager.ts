import { ActivePiece } from './active-piece'
import { PieceBufferPool } from './piece-buffer-pool'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export interface ActivePieceConfig {
  requestTimeoutMs: number
  maxActivePieces: number
  maxBufferedBytes: number
  cleanupIntervalMs: number
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
  cleanupIntervalMs: 10000,
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
 * Phase 2 Enhancement: Separate tracking of partial vs pending pieces
 * - Partial pieces: still downloading blocks (network-bound)
 * - Pending pieces: all blocks received, awaiting verification (I/O-bound)
 *
 * The partial cap (peers × 1.5) only applies to partial pieces, not pending.
 * This ensures disk I/O backups don't starve new downloads.
 */
export class ActivePieceManager extends EngineComponent {
  static logName = 'active-pieces'

  /** Pieces still downloading blocks (partial) */
  private _partialPieces: Map<number, ActivePiece> = new Map()
  /** Pieces with all blocks received, awaiting verification (pending) */
  private _pendingPieces: Map<number, ActivePiece> = new Map()
  private config: ActivePieceConfig
  private cleanupInterval?: ReturnType<typeof setInterval>
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

    // Start periodic cleanup of timed-out requests
    this.cleanupInterval = setInterval(() => this.checkTimeouts(), this.config.cleanupIntervalMs)
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

    // Also check pending (shouldn't happen but defensive)
    piece = this._pendingPieces.get(index)
    if (piece) return piece

    // Check piece count limit before creating
    const totalActive = this._partialPieces.size + this._pendingPieces.size
    if (totalActive >= this.config.maxActivePieces) {
      // Try to clean up stale pieces first
      this.cleanupStale()
      const newTotal = this._partialPieces.size + this._pendingPieces.size
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
   * Checks both partial and pending maps.
   */
  get(index: number): ActivePiece | undefined {
    return this._partialPieces.get(index) ?? this._pendingPieces.get(index)
  }

  /**
   * Check if a piece is active (in either partial or pending state).
   */
  has(index: number): boolean {
    return this._partialPieces.has(index) || this._pendingPieces.has(index)
  }

  /**
   * Check if a piece is in partial state (still downloading).
   */
  isPartial(index: number): boolean {
    return this._partialPieces.has(index)
  }

  /**
   * Check if a piece is in pending state (awaiting verification).
   */
  isPending(index: number): boolean {
    return this._pendingPieces.has(index)
  }

  /**
   * Remove an ActivePiece (after verification or abandonment).
   * Removes from either partial or pending map.
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

    piece = this._pendingPieces.get(index)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._pendingPieces.delete(index)
      this.logger.debug(`Removed pending piece ${index}`)
    }
  }

  // --- Partial/Pending Lifecycle ---

  /**
   * Move a piece from partial to pending state.
   * Called when all blocks have been received and piece is awaiting verification.
   */
  promoteToPending(pieceIndex: number): void {
    const piece = this._partialPieces.get(pieceIndex)
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
   * Returns the piece for buffer reuse if needed.
   */
  removePending(pieceIndex: number): ActivePiece | undefined {
    const piece = this._pendingPieces.get(pieceIndex)
    if (piece) {
      this.releaseBuffer(piece)
      piece.clear()
      this._pendingPieces.delete(pieceIndex)
      this.logger.debug(`Removed pending piece ${pieceIndex} after verification`)
    }
    return piece
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
    return [...this._partialPieces.keys(), ...this._pendingPieces.keys()]
  }

  /**
   * Returns an array of active pieces. Creates a new array each call.
   * Use values() for zero-allocation iteration in hot paths.
   */
  get activePieces(): ActivePiece[] {
    return [...this._partialPieces.values(), ...this._pendingPieces.values()]
  }

  /**
   * Returns an iterator over ALL active pieces (both partial and pending).
   * Use partialValues() in request loops to skip pending pieces.
   */
  values(): IterableIterator<ActivePiece> {
    return this.allPiecesIterator()
  }

  /**
   * Generator that yields all pieces from both maps.
   */
  private *allPiecesIterator(): IterableIterator<ActivePiece> {
    yield* this._partialPieces.values()
    yield* this._pendingPieces.values()
  }

  /**
   * Returns an iterator over ONLY partial pieces (still downloading).
   * Use this in request loops - pending pieces have all blocks and don't need requests.
   */
  partialValues(): IterableIterator<ActivePiece> {
    return this._partialPieces.values()
  }

  /**
   * Returns an iterator over ONLY pending pieces (awaiting verification).
   * Useful for verification queue management.
   */
  pendingValues(): IterableIterator<ActivePiece> {
    return this._pendingPieces.values()
  }

  /**
   * Total count of active pieces (partial + pending).
   */
  get activeCount(): number {
    return this._partialPieces.size + this._pendingPieces.size
  }

  /**
   * Count of partial pieces only (still downloading).
   * This is what the partial cap is based on.
   */
  get partialCount(): number {
    return this._partialPieces.size
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
   */
  clearRequestsForPeer(peerId: string): number {
    let totalCleared = 0
    // Only partial pieces have outstanding requests (pending pieces have all blocks)
    for (const piece of this._partialPieces.values()) {
      totalCleared += piece.clearRequestsForPeer(peerId)
    }
    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} requests for peer ${peerId}`)
    }
    return totalCleared
  }

  /**
   * Check for and clear timed-out requests across all active pieces.
   * Called periodically by the cleanup interval.
   * Emits 'requestsCleared' with a Map<peerId, count> of cleared requests per peer.
   */
  checkTimeouts(): number {
    const clearedByPeer = new Map<string, number>()
    // Only partial pieces have outstanding requests (pending pieces have all blocks)
    for (const piece of this._partialPieces.values()) {
      const pieceClearedByPeer = piece.checkTimeouts(this.config.requestTimeoutMs)
      for (const [peerId, count] of pieceClearedByPeer) {
        clearedByPeer.set(peerId, (clearedByPeer.get(peerId) || 0) + count)
      }
    }
    const totalCleared = [...clearedByPeer.values()].reduce((a, b) => a + b, 0)
    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} timed-out requests`)
      this.emit('requestsCleared', clearedByPeer)
    }
    return totalCleared
  }

  /**
   * Check if any partial piece has unrequested blocks.
   * Used to determine endgame eligibility.
   * Only checks partial pieces (pending pieces have all blocks by definition).
   */
  hasUnrequestedBlocks(): boolean {
    for (const piece of this._partialPieces.values()) {
      // Use the piece's allocation-free check instead of getNeededBlocks()
      if (piece.hasUnrequestedBlocks()) {
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
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    // Release all buffers back to pool before clearing
    for (const piece of this._partialPieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    for (const piece of this._pendingPieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    this._partialPieces.clear()
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
