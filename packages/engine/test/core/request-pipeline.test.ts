/**
 * Tests for the request pipeline bug fixes:
 * 1. Choke handler resets peer.requestsPending to 0
 * 2. Timeout handler decrements peer.requestsPending per-peer
 *
 * These tests verify the behavior documented in:
 * docs/tasks/2025-12-12-request-pipeline-bugs.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ActivePieceManager } from '../../src/core/active-piece-manager'
import { MockEngine } from '../utils/mock-engine'

describe('Request Pipeline Recovery', () => {
  let manager: ActivePieceManager
  let mockEngine: MockEngine
  const PIECE_LENGTH = 64 * 1024

  beforeEach(() => {
    vi.useFakeTimers()
    mockEngine = new MockEngine()
    manager = new ActivePieceManager(mockEngine, () => PIECE_LENGTH, {
      requestTimeoutMs: 30000,
      maxActivePieces: 100,
      maxBufferedBytes: 16 * 1024 * 1024,
      cleanupIntervalMs: 10000,
    })
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  describe('Choke Recovery (Primary Bug Fix)', () => {
    /**
     * Scenario: When a peer chokes us, they discard our pending requests.
     * We must reset peer.requestsPending = 0 so new requests can be made after unchoke.
     *
     * Without this fix:
     * 1. Send 500 requests → requestsPending = 500
     * 2. Peer chokes → requestsPending stays 500 (BUG!)
     * 3. Peer unchokes → requestPieces() called
     * 4. requestsPending >= MAX_PIPELINE → no new requests → STALL
     */
    it('should clear requests for peer when choked', () => {
      const piece = manager.getOrCreate(0)!

      // Simulate sending requests to a peer
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer1')

      // When peer chokes, torrent.ts calls clearRequestsForPeer()
      const cleared = manager.clearRequestsForPeer('peer1')

      expect(cleared).toBe(3)
      expect(piece.outstandingRequests).toBe(0)
    })

    it('should allow re-requesting blocks after choke clears them', () => {
      const piece = manager.getOrCreate(0)!

      // Request all blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer1')
      piece.addRequest(3, 'peer1')

      // All blocks requested - getNeededBlocks should return empty
      expect(piece.getNeededBlocks().length).toBe(0)

      // Choke happens - clear requests
      manager.clearRequestsForPeer('peer1')

      // Now blocks are available for re-requesting
      const needed = piece.getNeededBlocks()
      expect(needed.length).toBe(4)
    })
  })

  describe('Timeout Recovery (Secondary Bug Fix)', () => {
    /**
     * Scenario: When requests timeout, we must decrement peer.requestsPending.
     *
     * Without this fix:
     * 1. Send 500 requests → requestsPending = 500
     * 2. Peer stops responding
     * 3. After 30s, checkTimeouts() clears requests from tracking
     * 4. But requestsPending stays 500 (BUG!)
     * 5. requestPieces() sees requestsPending >= MAX_PIPELINE → no requests
     */
    it('should emit per-peer counts so requestsPending can be decremented', () => {
      const piece0 = manager.getOrCreate(0)!
      const piece1 = manager.getOrCreate(1)!

      // Simulate requests to two peers
      piece0.addRequest(0, 'peer1')
      piece0.addRequest(1, 'peer1')
      piece0.addRequest(2, 'peer2')
      piece1.addRequest(0, 'peer1')

      // Set up listener BEFORE advancing time (cleanup interval fires automatically)
      const receivedMap = new Map<string, number>()
      manager.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        for (const [peerId, count] of clearedByPeer) {
          receivedMap.set(peerId, (receivedMap.get(peerId) || 0) + count)
        }
      })

      // Advance time past timeout - automatic interval will fire
      vi.advanceTimersByTime(31000)

      expect(receivedMap.get('peer1')).toBe(3) // 2 from piece0, 1 from piece1
      expect(receivedMap.get('peer2')).toBe(1)
    })

    it('should allow re-requesting blocks after timeout clears them', () => {
      const piece = manager.getOrCreate(0)!

      // Request all blocks
      for (let i = 0; i < 4; i++) {
        piece.addRequest(i, 'peer1')
      }

      // All blocks requested
      expect(piece.getNeededBlocks().length).toBe(0)

      // Timeout clears requests
      vi.advanceTimersByTime(31000)
      manager.checkTimeouts()

      // Blocks now available for re-requesting
      expect(piece.getNeededBlocks().length).toBe(4)
    })
  })

  describe('Mixed Peer Scenarios', () => {
    it('should only clear requests for specific peer on choke', () => {
      const piece = manager.getOrCreate(0)!

      // Two peers have requests
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer2')
      piece.addRequest(2, 'peer1')

      // Only peer1 chokes
      manager.clearRequestsForPeer('peer1')

      // peer2's request should remain
      expect(piece.outstandingRequests).toBe(1)
      expect(piece.isBlockRequested(1)).toBe(true) // peer2's block
      expect(piece.isBlockRequested(0)).toBe(false) // peer1's cleared
    })

    it('should handle partial timeouts correctly', () => {
      const piece = manager.getOrCreate(0)!

      // Set up listener BEFORE any time advances
      const receivedMap = new Map<string, number>()
      manager.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        for (const [peerId, count] of clearedByPeer) {
          receivedMap.set(peerId, (receivedMap.get(peerId) || 0) + count)
        }
      })

      // peer1 requests first
      piece.addRequest(0, 'peer1')

      // 20 seconds later, peer2 requests
      vi.advanceTimersByTime(20000)
      piece.addRequest(1, 'peer2')

      // 15 more seconds - peer1 at 35s (timed out), peer2 at 15s (fresh)
      vi.advanceTimersByTime(15000)

      // Only peer1's request should have timed out
      expect(receivedMap.get('peer1')).toBe(1)
      expect(receivedMap.has('peer2')).toBe(false)

      // peer2's request should still be there
      expect(piece.isBlockRequested(1)).toBe(true)
    })
  })

  describe('Integration: requestsPending Synchronization', () => {
    /**
     * This test demonstrates how the event handler in torrent.ts should work:
     *
     * manager.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
     *   for (const peer of this.connectedPeers) {
     *     const peerId = getPeerId(peer)
     *     const cleared = clearedByPeer.get(peerId)
     *     if (cleared) {
     *       peer.requestsPending = Math.max(0, peer.requestsPending - cleared)
     *     }
     *   }
     * })
     */
    it('should provide correct counts for requestsPending decrements', () => {
      // Simulate the state: peer has 100 pending requests
      const mockPeer = { requestsPending: 100 }
      const peerId = 'peer1'

      // Set up listener BEFORE adding requests and advancing time
      let clearedCount = 0
      manager.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        clearedCount += clearedByPeer.get(peerId) || 0
      })

      // Add 100 requests to tracking
      for (let pieceIdx = 0; pieceIdx < 10; pieceIdx++) {
        const piece = manager.getOrCreate(pieceIdx)!
        for (let blockIdx = 0; blockIdx < 10; blockIdx++) {
          piece.addRequest(blockIdx, peerId)
        }
      }

      // Advance past timeout - automatic interval fires
      vi.advanceTimersByTime(31000)

      // Update the mock peer's requestsPending like torrent.ts would
      mockPeer.requestsPending = Math.max(0, mockPeer.requestsPending - clearedCount)

      expect(clearedCount).toBe(100)
      expect(mockPeer.requestsPending).toBe(0)
    })
  })
})
