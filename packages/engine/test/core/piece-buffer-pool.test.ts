import { describe, it, expect, beforeEach } from 'vitest'
import { PieceBufferPool } from '../../src/core/piece-buffer-pool'

describe('PieceBufferPool', () => {
  const BUFFER_SIZE = 16384 // Standard piece size
  let pool: PieceBufferPool

  beforeEach(() => {
    pool = new PieceBufferPool(BUFFER_SIZE)
  })

  describe('constructor', () => {
    it('should create pool with specified buffer size', () => {
      expect(pool.size).toBe(BUFFER_SIZE)
    })

    it('should start with empty pool', () => {
      expect(pool.pooledCount).toBe(0)
    })

    it('should accept custom max pool size', () => {
      const smallPool = new PieceBufferPool(1024, 5)
      expect(smallPool.size).toBe(1024)

      // Acquire and release more than max pool size
      const buffers = []
      for (let i = 0; i < 10; i++) {
        buffers.push(smallPool.acquire())
      }
      for (const buf of buffers) {
        smallPool.release(buf)
      }
      // Should only keep 5
      expect(smallPool.pooledCount).toBe(5)
    })
  })

  describe('acquire', () => {
    it('should return new buffer when pool is empty', () => {
      const buffer = pool.acquire()
      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBe(BUFFER_SIZE)
    })

    it('should return reused buffer when available', () => {
      const buffer1 = pool.acquire()
      pool.release(buffer1)

      const buffer2 = pool.acquire()
      expect(buffer2).toBe(buffer1) // Same object
    })

    it('should increment acquire count', () => {
      expect(pool.stats.acquires).toBe(0)
      pool.acquire()
      expect(pool.stats.acquires).toBe(1)
      pool.acquire()
      expect(pool.stats.acquires).toBe(2)
    })

    it('should track reuse count', () => {
      expect(pool.stats.reuses).toBe(0)

      const buffer = pool.acquire()
      expect(pool.stats.reuses).toBe(0) // First acquire is not a reuse

      pool.release(buffer)
      pool.acquire()
      expect(pool.stats.reuses).toBe(1) // Second acquire from pool is a reuse
    })
  })

  describe('release', () => {
    it('should add buffer to pool', () => {
      const buffer = pool.acquire()
      expect(pool.pooledCount).toBe(0)

      pool.release(buffer)
      expect(pool.pooledCount).toBe(1)
    })

    it('should increment release count', () => {
      const buffer = pool.acquire()
      expect(pool.stats.releases).toBe(0)

      pool.release(buffer)
      expect(pool.stats.releases).toBe(1)
    })

    it('should reject wrong-sized buffers', () => {
      const wrongSize = new Uint8Array(BUFFER_SIZE + 100)
      pool.release(wrongSize)
      expect(pool.pooledCount).toBe(0) // Not pooled
    })

    it('should reject smaller buffers', () => {
      const smallBuffer = new Uint8Array(BUFFER_SIZE - 100)
      pool.release(smallBuffer)
      expect(pool.pooledCount).toBe(0) // Not pooled
    })

    it('should respect max pool size', () => {
      const defaultMaxSize = 64

      // Acquire and release more than max
      const buffers = []
      for (let i = 0; i < defaultMaxSize + 10; i++) {
        buffers.push(pool.acquire())
      }

      for (const buf of buffers) {
        pool.release(buf)
      }

      expect(pool.pooledCount).toBe(defaultMaxSize)
    })
  })

  describe('clear', () => {
    it('should remove all pooled buffers', () => {
      // Acquire several buffers first
      const buffers = []
      for (let i = 0; i < 5; i++) {
        buffers.push(pool.acquire())
      }
      // Then release them all
      for (const buf of buffers) {
        pool.release(buf)
      }
      expect(pool.pooledCount).toBe(5)

      pool.clear()
      expect(pool.pooledCount).toBe(0)
    })
  })

  describe('stats', () => {
    it('should track all operations', () => {
      // Initial state
      expect(pool.stats).toEqual({
        acquires: 0,
        reuses: 0,
        releases: 0,
        pooled: 0,
      })

      // Acquire some buffers
      const b1 = pool.acquire()
      const b2 = pool.acquire()

      expect(pool.stats.acquires).toBe(2)
      expect(pool.stats.reuses).toBe(0)

      // Release them
      pool.release(b1)
      pool.release(b2)

      expect(pool.stats.releases).toBe(2)
      expect(pool.stats.pooled).toBe(2)

      // Acquire again (reuses)
      pool.acquire()
      pool.acquire()

      expect(pool.stats.acquires).toBe(4)
      expect(pool.stats.reuses).toBe(2)
      expect(pool.stats.pooled).toBe(0)
    })
  })

  describe('LIFO behavior', () => {
    it('should return most recently released buffer', () => {
      const b1 = pool.acquire()
      const b2 = pool.acquire()

      // Mark buffers to identify them
      b1[0] = 1
      b2[0] = 2

      pool.release(b1)
      pool.release(b2)

      // LIFO: b2 was released last, should be returned first
      const returned1 = pool.acquire()
      expect(returned1[0]).toBe(2)

      const returned2 = pool.acquire()
      expect(returned2[0]).toBe(1)
    })
  })

  describe('multiple piece sizes', () => {
    it('should work with different buffer sizes', () => {
      const smallPool = new PieceBufferPool(256)
      const largePool = new PieceBufferPool(1024 * 1024)

      const small = smallPool.acquire()
      const large = largePool.acquire()

      expect(small.length).toBe(256)
      expect(large.length).toBe(1024 * 1024)

      smallPool.release(small)
      largePool.release(large)

      expect(smallPool.pooledCount).toBe(1)
      expect(largePool.pooledCount).toBe(1)
    })
  })

  describe('buffer contents', () => {
    it('should not clear buffer contents on release', () => {
      const buffer = pool.acquire()
      buffer.fill(42)

      pool.release(buffer)
      const reused = pool.acquire()

      // Contents should still be there (not zeroed)
      expect(reused[0]).toBe(42)
      expect(reused[BUFFER_SIZE - 1]).toBe(42)
    })
  })
})
