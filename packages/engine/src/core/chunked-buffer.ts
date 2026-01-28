/**
 * ChunkedBuffer - A zero-copy receive buffer for network data.
 *
 * Instead of concatenating incoming packets into a single growing buffer (O(n) per packet),
 * this stores chunks by reference and provides efficient cross-chunk operations.
 *
 * Key operations:
 * - push(): O(1) - just stores reference
 * - peekUint32(): O(1) - reads 4 bytes, handles chunk boundaries
 * - copyTo(): O(n) - the ONE copy we allow, directly to destination
 * - discard(): O(chunks discarded) - removes consumed data from front
 */
export class ChunkedBuffer {
  private chunks: Uint8Array[] = []
  private _length = 0
  private consumedInFirstChunk = 0 // bytes already consumed from chunks[0]

  /**
   * Total available bytes in the buffer.
   */
  get length(): number {
    return this._length
  }

  /**
   * Push a new chunk to the buffer. O(1) operation.
   * The chunk is stored by reference, not copied.
   */
  push(data: Uint8Array): void {
    if (data.length === 0) return
    this.chunks.push(data)
    this._length += data.length
  }

  /**
   * Read a single byte at the given offset without consuming.
   * Returns null if insufficient data.
   * O(chunks) to find the right chunk, but typically O(1) for small offsets.
   */
  peekByte(offset: number): number | null {
    if (this._length <= offset) return null

    // Find the chunk containing this offset
    let chunkIndex = 0
    let posInChunk = this.consumedInFirstChunk + offset

    while (chunkIndex < this.chunks.length && posInChunk >= this.chunks[chunkIndex].length) {
      posInChunk -= this.chunks[chunkIndex].length
      chunkIndex++
    }

    if (chunkIndex >= this.chunks.length) return null
    return this.chunks[chunkIndex][posInChunk]
  }

  /**
   * Read a big-endian uint32 at the given offset without consuming.
   * Returns null if insufficient data.
   * Allocation-free: reads bytes directly from chunks.
   */
  peekUint32(offset: number): number | null {
    if (this._length < offset + 4) return null

    // Find starting chunk and position
    let chunkIndex = 0
    let posInChunk = this.consumedInFirstChunk + offset
    while (chunkIndex < this.chunks.length && posInChunk >= this.chunks[chunkIndex].length) {
      posInChunk -= this.chunks[chunkIndex].length
      chunkIndex++
    }

    if (chunkIndex >= this.chunks.length) return null

    const chunk = this.chunks[chunkIndex]
    const remaining = chunk.length - posInChunk

    if (remaining >= 4) {
      // Fast path: all 4 bytes in same chunk (zero allocation)
      return (
        ((chunk[posInChunk] << 24) |
          (chunk[posInChunk + 1] << 16) |
          (chunk[posInChunk + 2] << 8) |
          chunk[posInChunk + 3]) >>>
        0
      )
    }

    // Slow path: spans chunks (rare for small offsets)
    let result = 0
    for (let i = 0; i < 4; i++) {
      if (posInChunk >= this.chunks[chunkIndex].length) {
        chunkIndex++
        posInChunk = 0
      }
      result = (result << 8) | this.chunks[chunkIndex][posInChunk++]
    }
    return result >>> 0
  }

  /**
   * Peek at bytes without consuming. Returns a new Uint8Array with the data.
   * For small peeks (headers), allocation is acceptable.
   */
  peekBytes(offset: number, length: number): Uint8Array | null {
    if (this._length < offset + length) return null

    const result = new Uint8Array(length)
    this.copyToInternal(result, 0, offset, length)
    return result
  }

  /**
   * Copy bytes directly to a destination buffer. This is THE copy operation.
   * Use this to copy block data directly to its final destination (piece buffer).
   */
  copyTo(dest: Uint8Array, destOffset: number, srcOffset: number, length: number): void {
    if (this._length < srcOffset + length) {
      throw new Error(
        `ChunkedBuffer.copyTo: insufficient data (have ${this._length}, need ${srcOffset + length})`,
      )
    }
    if (dest.length < destOffset + length) {
      throw new Error(
        `ChunkedBuffer.copyTo: destination too small (have ${dest.length}, need ${destOffset + length})`,
      )
    }
    this.copyToInternal(dest, destOffset, srcOffset, length)
  }

  /**
   * Internal copy implementation that handles cross-chunk reads.
   */
  private copyToInternal(
    dest: Uint8Array,
    destOffset: number,
    srcOffset: number,
    length: number,
  ): void {
    let remaining = length
    let destPos = destOffset

    // Find starting chunk and position within it
    let chunkIndex = 0
    let posInChunk = this.consumedInFirstChunk + srcOffset

    // Skip to the right chunk
    while (chunkIndex < this.chunks.length && posInChunk >= this.chunks[chunkIndex].length) {
      posInChunk -= this.chunks[chunkIndex].length
      chunkIndex++
    }

    // Copy from chunks
    while (remaining > 0 && chunkIndex < this.chunks.length) {
      const chunk = this.chunks[chunkIndex]
      const availableInChunk = chunk.length - posInChunk
      const toCopy = Math.min(remaining, availableInChunk)

      dest.set(chunk.subarray(posInChunk, posInChunk + toCopy), destPos)

      destPos += toCopy
      remaining -= toCopy
      chunkIndex++
      posInChunk = 0 // subsequent chunks start at 0
    }
  }

  /**
   * Discard bytes from the front of the buffer (after consuming a message).
   */
  discard(length: number): void {
    if (length === 0) return
    if (length > this._length) {
      throw new Error(
        `ChunkedBuffer.discard: cannot discard ${length} bytes, only have ${this._length}`,
      )
    }

    this._length -= length
    let remaining = length

    while (remaining > 0 && this.chunks.length > 0) {
      const chunk = this.chunks[0]
      const availableInChunk = chunk.length - this.consumedInFirstChunk

      if (remaining >= availableInChunk) {
        // Discard entire chunk
        remaining -= availableInChunk
        this.chunks.shift()
        this.consumedInFirstChunk = 0
      } else {
        // Partial discard from first chunk
        this.consumedInFirstChunk += remaining
        remaining = 0
      }
    }
  }

  /**
   * Consume bytes from the front: returns the data and discards it.
   * Allocates a new buffer. Use for small messages; for large data prefer copyTo().
   */
  consume(length: number): Uint8Array {
    if (length > this._length) {
      throw new Error(
        `ChunkedBuffer.consume: insufficient data (have ${this._length}, need ${length})`,
      )
    }

    const result = new Uint8Array(length)
    this.copyToInternal(result, 0, 0, length)
    this.discard(length)
    return result
  }

  /**
   * Check if buffer has at least n bytes available.
   */
  hasBytes(n: number): boolean {
    return this._length >= n
  }

  /**
   * Clear all data from the buffer.
   */
  clear(): void {
    this.chunks = []
    this._length = 0
    this.consumedInFirstChunk = 0
  }
}
