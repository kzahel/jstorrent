import { toHex, fromHex } from './buffer'

// Module-level popcount lookup table (computed once at load)
const POPCOUNT = new Uint8Array(256)
for (let i = 0; i < 256; i++) {
  let n = i
  let count = 0
  while (n) {
    count += n & 1
    n >>= 1
  }
  POPCOUNT[i] = count
}

/**
 * A bitfield for tracking piece availability.
 *
 * INVARIANT: count() caching
 * --------------------------
 * The count of set bits is cached for O(1) repeated access. The cache is kept
 * in sync by:
 * - set(): incrementally updates count when cache is valid
 * - restoreFromHex(): invalidates cache
 * - Static factories: set count directly when known
 *
 * IMPORTANT: The cache can become stale if the underlying buffer is mutated
 * externally (via toBuffer() or the buffer passed to constructor). This is
 * acceptable because:
 * - toBuffer() is used for wire protocol encoding (read-only)
 * - Buffer constructor is for parsing incoming messages (read-only after init)
 *
 * If you must mutate the buffer externally, call invalidateCount() afterward.
 */
export class BitField {
  private buffer: Uint8Array
  private length: number
  private _count: number = 0
  private _countValid: boolean = false

  static fromHex(hex: string, length: number): BitField {
    const bf = new BitField(length)
    const bytes = fromHex(hex)
    // Copy bytes into the bitfield's buffer (up to its size)
    const copyLen = Math.min(bytes.length, bf.buffer.length)
    for (let i = 0; i < copyLen; i++) {
      bf.buffer[i] = bytes[i]
    }
    // Count will be computed on first access
    return bf
  }

  /**
   * Create a bitfield with all bits set (BEP 6 Have All).
   */
  static createFull(length: number): BitField {
    const bf = new BitField(length)
    // Set all bytes to 0xFF
    bf.buffer.fill(0xff)
    // Clear spare bits at the end (bits beyond length should be 0)
    const remainingBits = length % 8
    if (remainingBits > 0) {
      // Mask to keep only the first 'remainingBits' bits of last byte
      const mask = (0xff << (8 - remainingBits)) & 0xff
      bf.buffer[bf.buffer.length - 1] = mask
    }
    bf._count = length
    bf._countValid = true
    return bf
  }

  /**
   * Create a bitfield with no bits set (BEP 6 Have None).
   */
  static createEmpty(length: number): BitField {
    const bf = new BitField(length) // Buffer is already zeroed
    bf._count = 0
    bf._countValid = true
    return bf
  }

  /**
   * Create a bitfield.
   * @param lengthOrBuffer - Number of bits, or an existing buffer (taken by reference, not copied).
   *   If passing a buffer, do not mutate it afterward without calling invalidateCount().
   */
  constructor(lengthOrBuffer: number | Uint8Array) {
    if (typeof lengthOrBuffer === 'number') {
      this.length = lengthOrBuffer
      this.buffer = new Uint8Array(Math.ceil(this.length / 8))
    } else {
      // Buffer is stored by reference for zero-copy parsing of wire messages.
      // External mutation will desync count cache - call invalidateCount() if needed.
      this.buffer = lengthOrBuffer
      this.length = this.buffer.length * 8
    }
  }

  get size(): number {
    return this.length
  }

  get(index: number): boolean {
    if (index < 0 || index >= this.length) {
      return false
    }
    const byteIndex = Math.floor(index / 8)
    const bitIndex = 7 - (index % 8)
    return ((this.buffer[byteIndex] >> bitIndex) & 1) === 1
  }

  set(index: number, value: boolean = true): void {
    if (index < 0 || index >= this.length) {
      return // Silently ignore out of bounds
    }
    const byteIndex = Math.floor(index / 8)
    const bitIndex = 7 - (index % 8)
    const wasSet = ((this.buffer[byteIndex] >> bitIndex) & 1) === 1

    if (value && !wasSet) {
      this.buffer[byteIndex] |= 1 << bitIndex
      if (this._countValid) this._count++
    } else if (!value && wasSet) {
      this.buffer[byteIndex] &= ~(1 << bitIndex)
      if (this._countValid) this._count--
    }
  }

  hasAll(): boolean {
    // Check full bytes
    const fullBytes = Math.floor(this.length / 8)
    for (let i = 0; i < fullBytes; i++) {
      if (this.buffer[i] !== 0xff) return false
    }

    // Check remaining bits
    const remainingBits = this.length % 8
    if (remainingBits > 0) {
      const lastByte = this.buffer[fullBytes]
      // Create a mask for the remaining bits (e.g., 3 bits -> 11100000)
      const mask = (0xff << (8 - remainingBits)) & 0xff
      if ((lastByte & mask) !== mask) return false
    }

    return true
  }

  hasNone(): boolean {
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] !== 0) return false
    }
    return true
  }

  /**
   * Get the underlying buffer (by reference, not copied).
   * WARNING: Do not mutate the returned buffer without calling invalidateCount().
   */
  toBuffer(): Uint8Array {
    return this.buffer
  }

  toHex(): string {
    return toHex(this.buffer)
  }

  /**
   * Restore bitfield data from hex string in-place.
   */
  restoreFromHex(hex: string): void {
    const bytes = fromHex(hex)
    const copyLen = Math.min(bytes.length, this.buffer.length)
    for (let i = 0; i < copyLen; i++) {
      this.buffer[i] = bytes[i]
    }
    this._countValid = false
  }

  private _computeCount(): number {
    let total = 0
    for (let i = 0; i < this.buffer.length; i++) {
      total += POPCOUNT[this.buffer[i]]
    }
    // Subtract spare bits in last byte that shouldn't be counted
    const remainingBits = this.length % 8
    if (remainingBits > 0) {
      const lastByte = this.buffer[this.buffer.length - 1]
      const spareBitsMask = (1 << (8 - remainingBits)) - 1
      total -= POPCOUNT[lastByte & spareBitsMask]
    }
    return total
  }

  count(): number {
    if (!this._countValid) {
      this._count = this._computeCount()
      this._countValid = true
    }
    return this._count
  }

  cardinality(): number {
    return this.count()
  }

  /**
   * Invalidate the cached count. Call this after externally mutating the buffer
   * (via toBuffer() or the buffer passed to constructor).
   */
  invalidateCount(): void {
    this._countValid = false
  }

  /**
   * Get indices of all set bits.
   * Used for persistence to store completed pieces as an array.
   */
  getSetIndices(): number[] {
    const indices: number[] = []
    for (let i = 0; i < this.length; i++) {
      if (this.get(i)) {
        indices.push(i)
      }
    }
    return indices
  }

  /**
   * Create a deep copy of this bitfield.
   */
  clone(): BitField {
    const cloned = new BitField(this.length)
    cloned.buffer.set(this.buffer)
    cloned._count = this._count
    cloned._countValid = this._countValid
    return cloned
  }
}
