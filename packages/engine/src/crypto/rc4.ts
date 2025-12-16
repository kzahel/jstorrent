/**
 * RC4 stream cipher implementation
 * Used for MSE/PE encryption after handshake
 */
export class RC4 {
  private s: Uint8Array = new Uint8Array(256)
  private i = 0
  private j = 0

  constructor(key: Uint8Array) {
    // Key-Scheduling Algorithm (KSA)
    for (let i = 0; i < 256; i++) {
      this.s[i] = i
    }

    let j = 0
    for (let i = 0; i < 256; i++) {
      j = (j + this.s[i] + key[i % key.length]) & 0xff
      ;[this.s[i], this.s[j]] = [this.s[j], this.s[i]]
    }
  }

  /**
   * Generate next keystream byte (PRGA)
   */
  nextByte(): number {
    this.i = (this.i + 1) & 0xff
    this.j = (this.j + this.s[this.i]) & 0xff
    ;[this.s[this.i], this.s[this.j]] = [this.s[this.j], this.s[this.i]]
    return this.s[(this.s[this.i] + this.s[this.j]) & 0xff]
  }

  /**
   * Encrypt/decrypt data in place (XOR with keystream)
   */
  process(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ this.nextByte()
    }
    return result
  }

  /**
   * Discard n bytes from keystream (RC4-drop)
   */
  drop(n: number): void {
    for (let i = 0; i < n; i++) {
      this.nextByte()
    }
  }
}
