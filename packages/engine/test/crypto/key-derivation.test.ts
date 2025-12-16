import { describe, it, expect } from 'vitest'
import {
  deriveEncryptionKeys,
  computeReq1Hash,
  computeReq2Xor3,
  recoverInfoHash,
  concat,
  arraysEqual,
} from '../../src/crypto/key-derivation'

// Helper to create SHA1 using SubtleCrypto
async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-1', data)
  return new Uint8Array(hash)
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

describe('key-derivation', () => {
  describe('concat', () => {
    it('should concatenate multiple arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([4, 5])
      const c = new Uint8Array([6, 7, 8, 9])

      const result = concat(a, b, c)

      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    })

    it('should handle empty arrays', () => {
      const a = new Uint8Array([1, 2])
      const b = new Uint8Array(0)
      const c = new Uint8Array([3])

      const result = concat(a, b, c)

      expect(result).toEqual(new Uint8Array([1, 2, 3]))
    })
  })

  describe('arraysEqual', () => {
    it('should return true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 3])

      expect(arraysEqual(a, b)).toBe(true)
    })

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 4])

      expect(arraysEqual(a, b)).toBe(false)
    })

    it('should return false for different lengths', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2])

      expect(arraysEqual(a, b)).toBe(false)
    })
  })

  describe('deriveEncryptionKeys', () => {
    it('should derive different keys for initiator and responder', async () => {
      const sharedSecret = getRandomBytes(96)
      const infoHash = getRandomBytes(20)

      const initiatorKeys = await deriveEncryptionKeys(sharedSecret, infoHash, true, sha1)
      const responderKeys = await deriveEncryptionKeys(sharedSecret, infoHash, false, sha1)

      // Initiator's encrypt should match responder's decrypt
      const testData = getRandomBytes(32)
      const encrypted = initiatorKeys.encrypt.process(testData.slice())
      const decrypted = responderKeys.decrypt.process(encrypted)

      expect(decrypted).toEqual(testData)
    })

    it('should produce deterministic results', async () => {
      const sharedSecret = getRandomBytes(96)
      const infoHash = getRandomBytes(20)

      const keys1 = await deriveEncryptionKeys(sharedSecret, infoHash, true, sha1)
      const keys2 = await deriveEncryptionKeys(sharedSecret, infoHash, true, sha1)

      // Process same data with both
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      const out1 = keys1.encrypt.process(testData.slice())
      const out2 = keys2.encrypt.process(testData.slice())

      expect(out1).toEqual(out2)
    })
  })

  describe('computeReq1Hash', () => {
    it('should produce 20-byte hash', async () => {
      const sharedSecret = getRandomBytes(96)

      const hash = await computeReq1Hash(sharedSecret, sha1)

      expect(hash.length).toBe(20)
    })

    it('should be deterministic', async () => {
      const sharedSecret = getRandomBytes(96)

      const hash1 = await computeReq1Hash(sharedSecret, sha1)
      const hash2 = await computeReq1Hash(sharedSecret, sha1)

      expect(hash1).toEqual(hash2)
    })
  })

  describe('computeReq2Xor3', () => {
    it('should produce 20-byte result', async () => {
      const infoHash = getRandomBytes(20)
      const sharedSecret = getRandomBytes(96)

      const result = await computeReq2Xor3(infoHash, sharedSecret, sha1)

      expect(result.length).toBe(20)
    })
  })

  describe('recoverInfoHash', () => {
    it('should recover known info hash', async () => {
      const infoHash = getRandomBytes(20)
      const sharedSecret = getRandomBytes(96)
      const otherInfoHash = getRandomBytes(20)

      // Compute XOR value as initiator would send
      const xorValue = await computeReq2Xor3(infoHash, sharedSecret, sha1)

      // Responder tries to recover
      const recovered = await recoverInfoHash(
        xorValue,
        sharedSecret,
        [otherInfoHash, infoHash],
        sha1,
      )

      expect(recovered).toEqual(infoHash)
    })

    it('should return null for unknown info hash', async () => {
      const infoHash = getRandomBytes(20)
      const sharedSecret = getRandomBytes(96)
      const otherInfoHash = getRandomBytes(20)

      const xorValue = await computeReq2Xor3(infoHash, sharedSecret, sha1)

      // Responder doesn't have the correct info hash
      const recovered = await recoverInfoHash(xorValue, sharedSecret, [otherInfoHash], sha1)

      expect(recovered).toBeNull()
    })

    it('should work with empty known hashes list', async () => {
      const infoHash = getRandomBytes(20)
      const sharedSecret = getRandomBytes(96)

      const xorValue = await computeReq2Xor3(infoHash, sharedSecret, sha1)

      const recovered = await recoverInfoHash(xorValue, sharedSecret, [], sha1)

      expect(recovered).toBeNull()
    })
  })
})
