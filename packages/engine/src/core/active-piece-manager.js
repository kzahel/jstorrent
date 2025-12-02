import { ActivePiece } from './active-piece'
import { EngineComponent } from '../logging/logger'
const DEFAULT_CONFIG = {
  requestTimeoutMs: 30000,
  maxActivePieces: 20,
  maxBufferedBytes: 16 * 1024 * 1024, // 16MB
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
  constructor(engine, pieceLengthFn, config = {}) {
    super(engine)
    this.pieces = new Map()
    this.pieceLengthFn = pieceLengthFn
    this.config = { ...DEFAULT_CONFIG, ...config }
    // Start periodic cleanup of timed-out requests
    this.cleanupInterval = setInterval(() => this.checkTimeouts(), this.config.cleanupIntervalMs)
  }
  // --- Lazy Instantiation ---
  /**
   * Get or create an ActivePiece for the given index.
   * Returns null if at capacity limits.
   */
  getOrCreate(index) {
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
    piece = new ActivePiece(index, length)
    this.pieces.set(index, piece)
    this.logger.debug(`Created active piece ${index}`)
    return piece
  }
  /**
   * Get existing ActivePiece without creating.
   */
  get(index) {
    return this.pieces.get(index)
  }
  has(index) {
    return this.pieces.has(index)
  }
  /**
   * Remove an ActivePiece (after verification or abandonment).
   */
  remove(index) {
    const piece = this.pieces.get(index)
    if (piece) {
      piece.clear()
      this.pieces.delete(index)
      this.logger.debug(`Removed active piece ${index}`)
    }
  }
  // --- Iteration ---
  get activeIndices() {
    return Array.from(this.pieces.keys())
  }
  get activePieces() {
    return Array.from(this.pieces.values())
  }
  get activeCount() {
    return this.pieces.size
  }
  // --- Memory Tracking ---
  get totalBufferedBytes() {
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
  clearRequestsForPeer(peerId) {
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
   */
  checkTimeouts() {
    let totalCleared = 0
    for (const piece of this.pieces.values()) {
      totalCleared += piece.checkTimeouts(this.config.requestTimeoutMs)
    }
    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} timed-out requests`)
    }
    return totalCleared
  }
  /**
   * Remove stale pieces that have no activity and no data.
   */
  cleanupStale() {
    const now = Date.now()
    const staleThreshold = this.config.requestTimeoutMs * 2
    for (const [index, piece] of this.pieces) {
      // Remove pieces that have no activity and no data
      if (now - piece.lastActivity > staleThreshold && piece.blocksReceived === 0) {
        this.logger.debug(`Removing stale piece ${index}`)
        piece.clear()
        this.pieces.delete(index)
      }
    }
  }
  /**
   * Cleanup on destroy.
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    for (const piece of this.pieces.values()) {
      piece.clear()
    }
    this.pieces.clear()
  }
}
ActivePieceManager.logName = 'active-pieces'
