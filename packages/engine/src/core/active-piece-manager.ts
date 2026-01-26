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
 */
export class ActivePieceManager extends EngineComponent {
  static logName = 'active-pieces'

  private pieces: Map<number, ActivePiece> = new Map()
  private config: ActivePieceConfig
  private cleanupInterval?: ReturnType<typeof setInterval>
  private pieceLengthFn: (index: number) => number
  private bufferPool: PieceBufferPool | null = null

  constructor(
    engine: ILoggingEngine,
    pieceLengthFn: (index: number) => number,
    config: Partial<ActivePieceConfig> = {},
  ) {
    super(engine)
    this.pieceLengthFn = pieceLengthFn
    this.config = { ...DEFAULT_CONFIG, ...config }

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
   */
  getOrCreate(index: number): ActivePiece | null {
    let piece = this.pieces.get(index)
    if (piece) return piece

    // Check piece count limit before creating
    if (this.pieces.size >= this.config.maxActivePieces) {
      // Try to clean up stale pieces first
      this.cleanupStale()
      if (this.pieces.size >= this.config.maxActivePieces) {
        this.logger.debug(`Cannot create piece ${index}: at capacity (${this.pieces.size})`)
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
    this.pieces.set(index, piece)
    this.logger.debug(`Created active piece ${index}`)
    return piece
  }

  /**
   * Get existing ActivePiece without creating.
   */
  get(index: number): ActivePiece | undefined {
    return this.pieces.get(index)
  }

  has(index: number): boolean {
    return this.pieces.has(index)
  }

  /**
   * Remove an ActivePiece (after verification or abandonment).
   */
  remove(index: number): void {
    const piece = this.pieces.get(index)
    if (piece) {
      // Release buffer back to pool if applicable
      this.releaseBuffer(piece)
      piece.clear()
      this.pieces.delete(index)
      this.logger.debug(`Removed active piece ${index}`)
    }
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
    return Array.from(this.pieces.keys())
  }

  /**
   * Returns an array of active pieces. Creates a new array each call.
   * Use values() for zero-allocation iteration in hot paths.
   */
  get activePieces(): ActivePiece[] {
    return Array.from(this.pieces.values())
  }

  /**
   * Returns an iterator over active pieces. Zero allocation - use this in hot paths.
   */
  values(): IterableIterator<ActivePiece> {
    return this.pieces.values()
  }

  get activeCount(): number {
    return this.pieces.size
  }

  // --- Memory Tracking ---

  get totalBufferedBytes(): number {
    let total = 0
    for (const piece of this.pieces.values()) {
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
    for (const piece of this.pieces.values()) {
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
    for (const piece of this.pieces.values()) {
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
   * Check if any active piece has unrequested blocks.
   * Used to determine endgame eligibility.
   */
  hasUnrequestedBlocks(): boolean {
    for (const piece of this.pieces.values()) {
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
   */
  private cleanupStale(): void {
    const now = Date.now()
    const staleThreshold = this.config.requestTimeoutMs * 2

    for (const [index, piece] of this.pieces) {
      const isStale = now - piece.lastActivity > staleThreshold

      // Never remove pieces that have all blocks - they're waiting for disk write/verification
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
        this.pieces.delete(index)
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
    for (const piece of this.pieces.values()) {
      this.releaseBuffer(piece)
      piece.clear()
    }
    this.pieces.clear()

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
