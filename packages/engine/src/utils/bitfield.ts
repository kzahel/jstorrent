import { toHex, fromHex } from './buffer'

export class BitField {
  private buffer: Uint8Array
  private length: number

  static fromHex(hex: string, length: number): BitField {
    const bf = new BitField(length)
    const bytes = fromHex(hex)
    // Copy bytes into the bitfield's buffer (up to its size)
    const copyLen = Math.min(bytes.length, bf.buffer.length)
    for (let i = 0; i < copyLen; i++) {
      bf.buffer[i] = bytes[i]
    }
    return bf
  }

  constructor(lengthOrBuffer: number | Uint8Array) {
    if (typeof lengthOrBuffer === 'number') {
      this.length = lengthOrBuffer
      this.buffer = new Uint8Array(Math.ceil(this.length / 8))
    } else {
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
    if (value) {
      this.buffer[byteIndex] |= 1 << bitIndex
    } else {
      this.buffer[byteIndex] &= ~(1 << bitIndex)
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

  toBuffer(): Uint8Array {
    return this.buffer
  }

  toHex(): string {
    return toHex(this.buffer)
  }

  count(): number {
    let count = 0
    for (let i = 0; i < this.length; i++) {
      if (this.get(i)) {
        count++
      }
    }
    return count
  }

  cardinality(): number {
    return this.count()
  }
}
