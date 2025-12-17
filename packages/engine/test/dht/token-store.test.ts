import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenStore } from '../../src/dht/token-store'

// Simple mock hash function for deterministic testing
function createMockHash(): (data: Uint8Array) => Promise<Uint8Array> {
  return async (data: Uint8Array) => {
    // Simple hash: sum all bytes mod 256, repeated 20 times
    let sum = 0
    for (const byte of data) {
      sum = (sum + byte) % 256
    }
    return new Uint8Array(20).fill(sum)
  }
}

describe('TokenStore', () => {
  let store: TokenStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new TokenStore({
      rotationMs: 5 * 60 * 1000, // 5 minutes
      maxAgeMs: 10 * 60 * 1000, // 10 minutes
      hashFn: createMockHash(),
    })
  })

  afterEach(() => {
    store.stopRotation()
    vi.useRealTimers()
  })

  describe('generate', () => {
    it('generates consistent token for same IP', async () => {
      const token1 = await store.generate('192.168.1.1')
      const token2 = await store.generate('192.168.1.1')

      expect(token1).toEqual(token2)
    })

    it('generates different tokens for different IPs', async () => {
      const token1 = await store.generate('192.168.1.1')
      const token2 = await store.generate('192.168.1.2')

      expect(token1).not.toEqual(token2)
    })

    it('returns 20-byte token', async () => {
      const token = await store.generate('10.0.0.1')

      expect(token.length).toBe(20)
    })
  })

  describe('validate', () => {
    it('validates token within current secret', async () => {
      const token = await store.generate('192.168.1.1')
      const isValid = await store.validate('192.168.1.1', token)

      expect(isValid).toBe(true)
    })

    it('validates token from previous secret within max age', async () => {
      const token = await store.generate('192.168.1.1')

      // Rotate secret
      store.rotate()

      // Token should still be valid (within 10 minutes)
      const isValid = await store.validate('192.168.1.1', token)
      expect(isValid).toBe(true)
    })

    it('rejects token after two rotations', async () => {
      const token = await store.generate('192.168.1.1')

      // First rotation - token still valid
      store.rotate()
      expect(await store.validate('192.168.1.1', token)).toBe(true)

      // Second rotation - previous secret is now two generations old
      store.rotate()
      expect(await store.validate('192.168.1.1', token)).toBe(false)
    })

    it('rejects token for wrong IP', async () => {
      const token = await store.generate('192.168.1.1')
      const isValid = await store.validate('192.168.1.2', token)

      expect(isValid).toBe(false)
    })

    it('rejects garbage token', async () => {
      const garbage = new Uint8Array(20).fill(0xff)
      const isValid = await store.validate('192.168.1.1', garbage)

      expect(isValid).toBe(false)
    })

    it('rejects empty token', async () => {
      const isValid = await store.validate('192.168.1.1', new Uint8Array(0))

      expect(isValid).toBe(false)
    })
  })

  describe('rotate', () => {
    it('changes current secret', async () => {
      const tokenBefore = await store.generate('192.168.1.1')
      store.rotate()
      const tokenAfter = await store.generate('192.168.1.1')

      // Tokens should be different after rotation
      expect(tokenBefore).not.toEqual(tokenAfter)
    })

    it('preserves previous secret for validation', async () => {
      const oldToken = await store.generate('192.168.1.1')
      store.rotate()

      // Old token still valid
      expect(await store.validate('192.168.1.1', oldToken)).toBe(true)

      // New token also valid
      const newToken = await store.generate('192.168.1.1')
      expect(await store.validate('192.168.1.1', newToken)).toBe(true)
    })
  })

  describe('automatic rotation', () => {
    it('rotates automatically after interval', async () => {
      store.startRotation()

      const tokenBefore = await store.generate('192.168.1.1')

      // Advance time past rotation interval
      vi.advanceTimersByTime(5 * 60 * 1000 + 100)

      const tokenAfter = await store.generate('192.168.1.1')

      expect(tokenBefore).not.toEqual(tokenAfter)
    })

    it('stops rotation when requested', async () => {
      store.startRotation()
      const tokenBefore = await store.generate('192.168.1.1')

      store.stopRotation()

      // Advance time past multiple rotation intervals
      vi.advanceTimersByTime(20 * 60 * 1000)

      const tokenAfter = await store.generate('192.168.1.1')

      // Should be the same since rotation stopped
      expect(tokenBefore).toEqual(tokenAfter)
    })
  })

  describe('edge cases', () => {
    it('handles invalid IP gracefully', async () => {
      // Should not throw, just produce a token
      const token = await store.generate('invalid')
      expect(token.length).toBe(20)
    })

    it('handles IPv6-like strings gracefully', async () => {
      // Should not throw
      const token = await store.generate('::1')
      expect(token.length).toBe(20)
    })
  })
})
