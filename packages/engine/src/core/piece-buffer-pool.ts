/**
 * PieceBufferPool - Reusable buffer pool for piece data.
 *
 * Reduces allocation/GC overhead by reusing Uint8Array buffers for pieces.
 * Buffers are pooled by size - only exact-size matches are reused.
 *
 * The last piece in a torrent is often smaller than the standard piece size.
 * Strategy: Pool buffers of the standard piece size; allocate fresh for the
 * last (smaller) piece since it only happens once.
 */
export class PieceBufferPool {
  private available: Uint8Array[] = []
  private readonly bufferSize: number
  private readonly maxPoolSize: number

  // Statistics for debugging/monitoring
  private _acquireCount = 0
  private _reuseCount = 0
  private _releaseCount = 0

  /**
   * Create a buffer pool for a specific buffer size.
   * @param bufferSize - Size of buffers to pool (typically pieceLength)
   * @param maxPoolSize - Maximum number of buffers to keep in pool (default: 64)
   */
  constructor(bufferSize: number, maxPoolSize: number = 64) {
    this.bufferSize = bufferSize
    this.maxPoolSize = maxPoolSize
  }

  /**
   * Acquire a buffer from the pool.
   * Returns a pooled buffer if available, otherwise allocates a new one.
   *
   * Note: The returned buffer may contain stale data from previous use.
   * For piece downloads this is fine since blocks overwrite the entire buffer.
   */
  acquire(): Uint8Array {
    this._acquireCount++
    const buffer = this.available.pop()
    if (buffer) {
      this._reuseCount++
      return buffer
    }
    return new Uint8Array(this.bufferSize)
  }

  /**
   * Release a buffer back to the pool.
   * Buffer is only pooled if it matches the pool size and pool isn't full.
   * Otherwise the buffer is left for GC.
   *
   * @param buffer - Buffer to release
   */
  release(buffer: Uint8Array): void {
    this._releaseCount++
    // Only pool exact-size buffers, and respect max pool size
    if (buffer.length === this.bufferSize && this.available.length < this.maxPoolSize) {
      this.available.push(buffer)
    }
    // Otherwise let GC handle it (wrong size or pool full)
  }

  /**
   * Clear all pooled buffers (useful for cleanup or memory pressure).
   */
  clear(): void {
    this.available.length = 0
  }

  /**
   * Get the number of buffers currently available in the pool.
   */
  get pooledCount(): number {
    return this.available.length
  }

  /**
   * Get the configured buffer size for this pool.
   */
  get size(): number {
    return this.bufferSize
  }

  /**
   * Get pool statistics for debugging.
   */
  get stats(): { acquires: number; reuses: number; releases: number; pooled: number } {
    return {
      acquires: this._acquireCount,
      reuses: this._reuseCount,
      releases: this._releaseCount,
      pooled: this.available.length,
    }
  }
}
