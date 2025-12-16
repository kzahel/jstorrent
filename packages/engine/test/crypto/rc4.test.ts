import { describe, it, expect } from 'vitest'
import { RC4 } from '../../src/crypto/rc4'

describe('RC4', () => {
  it('should encrypt and decrypt data', () => {
    const key = new Uint8Array([1, 2, 3, 4, 5])
    const encryptor = new RC4(key)
    const decryptor = new RC4(key)

    const plaintext = new TextEncoder().encode('Hello, World!')
    const ciphertext = encryptor.process(plaintext)
    const decrypted = decryptor.process(ciphertext)

    expect(decrypted).toEqual(plaintext)
  })

  it('should produce different output with different keys', () => {
    const rc1 = new RC4(new Uint8Array([1, 2, 3]))
    const rc2 = new RC4(new Uint8Array([4, 5, 6]))

    const data = new Uint8Array([1, 2, 3, 4, 5])
    const out1 = rc1.process(data)
    const out2 = rc2.process(data)

    expect(out1).not.toEqual(out2)
  })

  it('should support RC4-drop1024', () => {
    const key = new Uint8Array([1, 2, 3, 4])
    const rc4 = new RC4(key)

    // Drop first 1024 bytes
    rc4.drop(1024)

    // The next byte should be deterministic
    const byte = rc4.nextByte()

    // Create another instance and verify
    const rc4b = new RC4(key)
    rc4b.drop(1024)
    expect(rc4b.nextByte()).toBe(byte)
  })

  // Test vector from RFC 6229 (for verification)
  it('should match known test vectors', () => {
    // Key = 0x0102030405
    const key = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])
    const rc4 = new RC4(key)

    // First few keystream bytes should be:
    // b2 39 63 05 f0 3d c0 27 cc c3 52 4a 0a 11 18 a8
    const expected = [0xb2, 0x39, 0x63, 0x05, 0xf0, 0x3d, 0xc0, 0x27]

    for (const e of expected) {
      expect(rc4.nextByte()).toBe(e)
    }
  })

  it('should process empty data', () => {
    const key = new Uint8Array([1, 2, 3])
    const rc4 = new RC4(key)

    const result = rc4.process(new Uint8Array(0))
    expect(result.length).toBe(0)
  })

  it('should encrypt data in chunks consistently', () => {
    const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80])

    // Encrypt all at once
    const rc4a = new RC4(key)
    const allAtOnce = rc4a.process(data)

    // Encrypt in chunks
    const rc4b = new RC4(key)
    const chunk1 = rc4b.process(data.slice(0, 4))
    const chunk2 = rc4b.process(data.slice(4))
    const inChunks = new Uint8Array([...chunk1, ...chunk2])

    expect(inChunks).toEqual(allAtOnce)
  })
})
