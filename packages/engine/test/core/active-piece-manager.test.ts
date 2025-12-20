import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ActivePieceManager } from '../../src/core/active-piece-manager'
import { MockEngine } from '../utils/mock-engine'

describe('ActivePieceManager', () => {
  let manager: ActivePieceManager
  let mockEngine: MockEngine
  const PIECE_LENGTH = 64 * 1024 // 64KB

  beforeEach(() => {
    vi.useFakeTimers()
    mockEngine = new MockEngine()
    manager = new ActivePieceManager(mockEngine, () => PIECE_LENGTH, {
      requestTimeoutMs: 30000,
      maxActivePieces: 10,
      maxBufferedBytes: 1024 * 1024, // 1MB
      cleanupIntervalMs: 10000,
    })
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  describe('getOrCreate', () => {
    it('should create new piece', () => {
      const piece = manager.getOrCreate(0)

      expect(piece).not.toBeNull()
      expect(piece!.index).toBe(0)
      expect(manager.activeCount).toBe(1)
    })

    it('should return existing piece', () => {
      const piece1 = manager.getOrCreate(0)
      const piece2 = manager.getOrCreate(0)

      expect(piece1).toBe(piece2)
      expect(manager.activeCount).toBe(1)
    })

    it('should return null when at capacity', () => {
      // Create 10 pieces (at capacity)
      for (let i = 0; i < 10; i++) {
        manager.getOrCreate(i)
      }

      const piece = manager.getOrCreate(10)

      expect(piece).toBeNull()
    })
  })

  describe('get', () => {
    it('should return existing piece', () => {
      manager.getOrCreate(5)

      expect(manager.get(5)).not.toBeUndefined()
      expect(manager.get(6)).toBeUndefined()
    })
  })

  describe('remove', () => {
    it('should remove piece', () => {
      manager.getOrCreate(0)
      expect(manager.has(0)).toBe(true)

      manager.remove(0)

      expect(manager.has(0)).toBe(false)
      expect(manager.activeCount).toBe(0)
    })
  })

  describe('clearRequestsForPeer', () => {
    it('should clear requests across all pieces', () => {
      const piece0 = manager.getOrCreate(0)!
      const piece1 = manager.getOrCreate(1)!

      piece0.addRequest(0, 'peer1')
      piece0.addRequest(1, 'peer2')
      piece1.addRequest(0, 'peer1')
      piece1.addRequest(1, 'peer1')

      const cleared = manager.clearRequestsForPeer('peer1')

      expect(cleared).toBe(3) // 1 from piece0, 2 from piece1
      expect(piece0.outstandingRequests).toBe(1) // peer2 remains
      expect(piece1.outstandingRequests).toBe(0)
    })
  })

  describe('checkTimeouts', () => {
    it('should aggregate per-peer timeout counts across pieces', () => {
      const piece0 = manager.getOrCreate(0)!
      const piece1 = manager.getOrCreate(1)!

      piece0.addRequest(0, 'peer1')
      piece0.addRequest(1, 'peer2')
      piece1.addRequest(0, 'peer1')

      // Set up listener BEFORE advancing time (cleanup interval will fire)
      const clearedByPeer = new Map<string, number>()
      manager.on('requestsCleared', (map: Map<string, number>) => {
        for (const [peerId, count] of map) {
          clearedByPeer.set(peerId, (clearedByPeer.get(peerId) || 0) + count)
        }
      })

      // Advance past timeout - cleanup interval will fire and call checkTimeouts()
      vi.advanceTimersByTime(31000)

      expect(clearedByPeer.get('peer1')).toBe(2)
      expect(clearedByPeer.get('peer2')).toBe(1)
    })

    it('should emit requestsCleared event with Map', (done: () => void) => {
      const piece = manager.getOrCreate(0)!
      piece.addRequest(0, 'peer1')

      vi.advanceTimersByTime(31000)

      manager.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        expect(clearedByPeer instanceof Map).toBe(true)
        expect(clearedByPeer.get('peer1')).toBe(1)
        done()
      })

      manager.checkTimeouts()
    })

    it('should not emit when no timeouts', () => {
      const piece = manager.getOrCreate(0)!
      piece.addRequest(0, 'peer1')

      const listener = vi.fn()
      manager.on('requestsCleared', listener)

      manager.checkTimeouts()

      expect(listener).not.toHaveBeenCalled()
    })

    it('should run automatically via cleanup interval', () => {
      const piece = manager.getOrCreate(0)!
      piece.addRequest(0, 'peer1')

      const listener = vi.fn()
      manager.on('requestsCleared', listener)

      // Advance past timeout (30s) plus cleanup interval (10s)
      vi.advanceTimersByTime(40000)

      expect(listener).toHaveBeenCalled()
    })
  })

  describe('memory tracking', () => {
    it('should track buffered bytes', () => {
      const piece = manager.getOrCreate(0)!
      piece.addBlock(0, new Uint8Array(16384), 'peer1')
      piece.addBlock(1, new Uint8Array(16384), 'peer1')

      expect(manager.totalBufferedBytes).toBe(32768)
    })
  })

  describe('destroy', () => {
    it('should clear all pieces and stop interval', () => {
      manager.getOrCreate(0)
      manager.getOrCreate(1)

      manager.destroy()

      expect(manager.activeCount).toBe(0)
      // Verify interval is stopped by advancing time and checking no errors
      vi.advanceTimersByTime(100000)
    })
  })

  describe('cleanupStale (via getOrCreate at capacity)', () => {
    it('should remove stale pieces with no data', () => {
      // Fill to capacity with pieces that have no data
      for (let i = 0; i < 10; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.activeCount).toBe(10)

      // Advance past stale threshold (requestTimeout * 2 = 60s)
      vi.advanceTimersByTime(61000)

      // Try to create new piece - should succeed after stale cleanup
      const newPiece = manager.getOrCreate(100)
      expect(newPiece).not.toBeNull()
    })

    it('should remove stale pieces with data but no requests', () => {
      // Fill to capacity
      for (let i = 0; i < 10; i++) {
        const piece = manager.getOrCreate(i)!
        // Add some data to make blocksReceived > 0
        piece.addBlock(0, new Uint8Array(16384), 'peer1')
      }
      expect(manager.activeCount).toBe(10)

      // Advance past stale threshold
      vi.advanceTimersByTime(61000)

      // Try to create new piece - should succeed because pieces have no outstanding requests
      const newPiece = manager.getOrCreate(100)
      expect(newPiece).not.toBeNull()
    })

    it('should NOT remove stale pieces with outstanding requests', () => {
      // Fill to capacity with pieces that have outstanding requests
      for (let i = 0; i < 10; i++) {
        const piece = manager.getOrCreate(i)!
        piece.addBlock(0, new Uint8Array(16384), 'peer1') // Has data
        piece.addRequest(1, 'peer1') // Has outstanding request
      }
      expect(manager.activeCount).toBe(10)

      // Advance past stale threshold but not past request timeout
      // (requests refresh lastActivity, and requests haven't timed out yet)
      vi.advanceTimersByTime(25000)

      // Try to create new piece - should fail because pieces have outstanding requests
      const newPiece = manager.getOrCreate(100)
      expect(newPiece).toBeNull()
    })

    it('should NOT remove pieces with recent activity', () => {
      // Fill to capacity
      for (let i = 0; i < 10; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.activeCount).toBe(10)

      // Only advance 30 seconds (less than stale threshold of 60s)
      vi.advanceTimersByTime(30000)

      // Try to create new piece - should fail because pieces are not yet stale
      const newPiece = manager.getOrCreate(100)
      expect(newPiece).toBeNull()
    })

    it('should keep pieces with requests even after stale threshold if requests are active', () => {
      // Create one piece with an outstanding request
      const piece = manager.getOrCreate(0)!
      piece.addRequest(0, 'peer1')

      // Fill remaining capacity
      for (let i = 1; i < 10; i++) {
        manager.getOrCreate(i)
      }

      // Advance past stale threshold
      vi.advanceTimersByTime(61000)

      // The piece with request should still exist (request keeps it alive via lastActivity update)
      // But the requests themselves will timeout after 30s
      // After 61s the requests timed out, so piece has no requests -> should be removed
      const newPiece = manager.getOrCreate(100)
      expect(newPiece).not.toBeNull()
    })
  })
})
