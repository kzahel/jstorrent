import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransactionManager } from '../../src/dht/transaction-manager'

describe('TransactionManager', () => {
  let manager: TransactionManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new TransactionManager(1000) // 1 second timeout for tests
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  describe('generateTransactionId', () => {
    it('generates unique 2-byte transaction IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const id = manager.generateTransactionId()
        expect(id.length).toBe(2)

        const hex = Array.from(id)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        ids.add(hex)
      }

      expect(ids.size).toBe(100) // All unique
    })

    it('wraps around at 0xFFFF', () => {
      // Generate many IDs to ensure wrap-around works
      for (let i = 0; i < 0x10000 + 10; i++) {
        const id = manager.generateTransactionId()
        expect(id.length).toBe(2)
      }
    })
  })

  describe('track', () => {
    it('tracks pending query with callback', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      expect(manager.size()).toBe(1)
      expect(manager.get(id)).toBeDefined()
      expect(manager.get(id)?.method).toBe('ping')
    })
  })

  describe('resolve', () => {
    it('resolves correct callback on response', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()
      const response = { r: { id: new Uint8Array(20) } }

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)
      const found = manager.resolve(id, response)

      expect(found).toBe(true)
      expect(callback).toHaveBeenCalledWith(null, response)
      expect(manager.size()).toBe(0)
    })

    it('ignores responses with unknown transaction ID', () => {
      const unknownId = new Uint8Array([0xff, 0xff])
      const found = manager.resolve(unknownId, {})

      expect(found).toBe(false)
    })

    it('routes responses to correct callback among multiple pending', () => {
      const id1 = manager.generateTransactionId()
      const id2 = manager.generateTransactionId()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      manager.track(id1, 'ping', { host: '1.1.1.1', port: 6881 }, callback1)
      manager.track(id2, 'find_node', { host: '2.2.2.2', port: 6881 }, callback2)

      const response = { test: 'data' }
      manager.resolve(id2, response)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith(null, response)
      expect(manager.size()).toBe(1)
    })
  })

  describe('reject', () => {
    it('calls callback with error on KRPC error', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'announce_peer', { host: '127.0.0.1', port: 6881 }, callback)
      manager.reject(id, 203, 'Bad token')

      expect(callback).toHaveBeenCalledWith(expect.any(Error), null)
      expect(callback.mock.calls[0][0].message).toContain('203')
      expect(callback.mock.calls[0][0].message).toContain('Bad token')
    })
  })

  describe('timeout', () => {
    it('times out after configured duration', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      // Not yet timed out
      vi.advanceTimersByTime(500)
      expect(callback).not.toHaveBeenCalled()

      // Now timed out
      vi.advanceTimersByTime(600) // Total 1100ms > 1000ms timeout
      expect(callback).toHaveBeenCalledWith(expect.any(Error), null)
      expect(callback.mock.calls[0][0].message).toContain('timed out')
    })

    it('cleans up on timeout', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)
      expect(manager.size()).toBe(1)

      vi.advanceTimersByTime(1100)

      expect(manager.size()).toBe(0)
      expect(manager.get(id)).toBeUndefined()
    })

    it('does not timeout if resolved first', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      // Resolve before timeout
      manager.resolve(id, { success: true })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(null, { success: true })

      // Advance past timeout
      vi.advanceTimersByTime(2000)

      // Should not be called again
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroy', () => {
    it('cleans up all pending queries', () => {
      const callbacks = [vi.fn(), vi.fn(), vi.fn()]

      for (const cb of callbacks) {
        const id = manager.generateTransactionId()
        manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, cb)
      }

      expect(manager.size()).toBe(3)

      manager.destroy()

      expect(manager.size()).toBe(0)
      for (const cb of callbacks) {
        expect(cb).toHaveBeenCalledWith(expect.any(Error), null)
      }
    })
  })
})
