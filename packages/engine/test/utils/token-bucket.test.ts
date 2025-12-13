import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket } from '../../src/utils/token-bucket'

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('unlimited mode', () => {
    it('always allows consumption when refillRate is 0', () => {
      const bucket = new TokenBucket(0)
      expect(bucket.isLimited).toBe(false)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
    })

    it('returns 0 for msUntilAvailable', () => {
      const bucket = new TokenBucket(0)
      expect(bucket.msUntilAvailable(1_000_000)).toBe(0)
    })
  })

  describe('limited mode', () => {
    it('starts with full capacity', () => {
      const bucket = new TokenBucket(1000, 2000) // 1000/sec, 2000 capacity
      expect(bucket.available).toBe(2000)
    })

    it('consumes tokens', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.tryConsume(500)).toBe(true)
      expect(bucket.available).toBe(1500)
    })

    it('rejects when insufficient tokens', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.tryConsume(2500)).toBe(false)
      expect(bucket.available).toBe(2000) // unchanged
    })

    it('refills over time', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty it
      expect(bucket.available).toBe(0)

      vi.advanceTimersByTime(500) // 0.5 seconds
      expect(bucket.available).toBe(500)

      vi.advanceTimersByTime(500) // another 0.5 seconds
      expect(bucket.available).toBe(1000)
    })

    it('does not exceed capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      vi.advanceTimersByTime(10000) // 10 seconds
      expect(bucket.available).toBe(2000) // capped at capacity
    })

    it('calculates msUntilAvailable correctly', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty

      // Need 500 tokens at 1000/sec = 500ms
      expect(bucket.msUntilAvailable(500)).toBe(500)

      // Need 1000 tokens = 1000ms
      expect(bucket.msUntilAvailable(1000)).toBe(1000)
    })

    it('returns 0 for msUntilAvailable when tokens available', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.msUntilAvailable(1000)).toBe(0)
    })
  })

  describe('setLimit', () => {
    it('updates rate and capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.setLimit(500) // 500/sec, default 2x = 1000 capacity

      expect(bucket.refillRate).toBe(500)
      expect(bucket.capacity).toBe(1000)
    })

    it('clamps tokens to new capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.available).toBe(2000)

      bucket.setLimit(100) // capacity becomes 200
      expect(bucket.available).toBe(200)
    })

    it('can disable limiting', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty

      bucket.setLimit(0) // unlimited
      expect(bucket.isLimited).toBe(false)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
    })
  })
})
