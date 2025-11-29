import { PieceBuffer } from './piece-buffer'

export interface PieceBufferManagerConfig {
  maxActivePieces?: number // Max pieces buffered at once (default: 20)
  staleTimeoutMs?: number // Timeout for inactive pieces (default: 60000)
}

/**
 * Manages in-memory buffers for pieces being downloaded.
 * Limits memory usage by capping active pieces and timing out stale ones.
 */
export class PieceBufferManager {
  private buffers: Map<number, PieceBuffer> = new Map()
  private maxActivePieces: number
  private staleTimeoutMs: number
  private cleanupInterval?: ReturnType<typeof setInterval>

  constructor(
    private pieceLength: number,
    private lastPieceLength: number,
    private totalPieces: number,
    config: PieceBufferManagerConfig = {},
  ) {
    this.maxActivePieces = config.maxActivePieces ?? 20
    this.staleTimeoutMs = config.staleTimeoutMs ?? 60000

    // Periodic cleanup of stale pieces
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 10000)
  }

  /**
   * Get or create a buffer for a piece.
   * Returns null if we've hit the max active pieces limit.
   */
  getOrCreate(pieceIndex: number): PieceBuffer | null {
    let buffer = this.buffers.get(pieceIndex)
    if (buffer) {
      return buffer
    }

    // Check limit
    if (this.buffers.size >= this.maxActivePieces) {
      // Try to clean up stale ones first
      this.cleanupStale()

      if (this.buffers.size >= this.maxActivePieces) {
        return null // Still at limit
      }
    }

    // Create new buffer
    const length =
      pieceIndex === this.totalPieces - 1 ? this.lastPieceLength : this.pieceLength

    buffer = new PieceBuffer(pieceIndex, length)
    this.buffers.set(pieceIndex, buffer)
    return buffer
  }

  /**
   * Get existing buffer for a piece (doesn't create).
   */
  get(pieceIndex: number): PieceBuffer | undefined {
    return this.buffers.get(pieceIndex)
  }

  /**
   * Remove a buffer (after piece is complete or failed).
   */
  remove(pieceIndex: number): void {
    this.buffers.delete(pieceIndex)
  }

  /**
   * Check if a piece is being actively buffered.
   */
  has(pieceIndex: number): boolean {
    return this.buffers.has(pieceIndex)
  }

  /**
   * Get count of active buffers.
   */
  get activeCount(): number {
    return this.buffers.size
  }

  /**
   * Get list of piece indices being buffered.
   */
  getActivePieces(): number[] {
    return Array.from(this.buffers.keys())
  }

  /**
   * Clean up stale buffers that haven't seen activity.
   */
  private cleanupStale(): void {
    const now = Date.now()
    const stale: number[] = []

    for (const [index, buffer] of this.buffers) {
      if (now - buffer.lastActivity > this.staleTimeoutMs) {
        stale.push(index)
      }
    }

    for (const index of stale) {
      this.buffers.delete(index)
    }
  }

  /**
   * Cleanup on destroy.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.buffers.clear()
  }
}
