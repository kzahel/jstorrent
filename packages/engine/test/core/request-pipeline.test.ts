/**
 * Tests for the request pipeline bug fixes:
 * 1. Choke handler resets peer.requestsPending to 0
 * 2. Timeout handling via Torrent.cleanupStuckPieces() (not tested here - integration level)
 *
 * These tests verify the behavior documented in:
 * docs/tasks/2025-12-12-request-pipeline-bugs.md
 *
 * Note: Request timeout handling was moved from ActivePieceManager.checkTimeouts() (30s interval)
 * to Torrent.cleanupStuckPieces() (500ms interval, 10s timeout). The torrent-level handler
 * properly sends CANCEL messages and decrements peer.requestsPending directly.
 * See active-piece.test.ts for tests of the underlying getStaleRequests() and checkTimeouts() methods.
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

  describe('Timeout Recovery (via ActivePiece.checkTimeouts)', () => {
    /**
     * Note: The manager-level checkTimeouts() has been removed.
     * Timeout handling is now done by Torrent.cleanupStuckPieces() which:
     * - Runs every 500ms (5 request ticks)
     * - Uses 10s timeout (vs old 30s)
     * - Sends CANCEL messages to peers
     * - Decrements peer.requestsPending directly
     *
     * These tests verify the underlying piece-level timeout detection
     * that cleanupStuckPieces() uses via getStaleRequests().
     */
    it('should detect stale requests after timeout', () => {
      const piece = manager.getOrCreate(0)!

      // Simulate requests
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer2')

      // Before timeout - no stale requests
      const staleBefore = piece.getStaleRequests(30000)
      expect(staleBefore.length).toBe(0)

      // Advance time past timeout
      vi.advanceTimersByTime(31000)

      // After timeout - all requests are stale
      const staleAfter = piece.getStaleRequests(30000)
      expect(staleAfter.length).toBe(3)
      expect(staleAfter.filter((r) => r.peerId === 'peer1').length).toBe(2)
      expect(staleAfter.filter((r) => r.peerId === 'peer2').length).toBe(1)
    })

    it('should allow re-requesting blocks after timeout clears them', () => {
      const piece = manager.getOrCreate(0)!

      // Request all blocks
      for (let i = 0; i < 4; i++) {
        piece.addRequest(i, 'peer1')
      }

      // All blocks requested
      expect(piece.getNeededBlocks().length).toBe(0)

      // Timeout clears requests (using piece-level checkTimeouts)
      vi.advanceTimersByTime(31000)
      piece.checkTimeouts(30000)

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

    it('should handle partial timeouts correctly at piece level', () => {
      const piece = manager.getOrCreate(0)!

      // peer1 requests first
      piece.addRequest(0, 'peer1')

      // 20 seconds later, peer2 requests
      vi.advanceTimersByTime(20000)
      piece.addRequest(1, 'peer2')

      // 15 more seconds - peer1 at 35s (timed out), peer2 at 15s (fresh)
      vi.advanceTimersByTime(15000)

      // Get stale requests (30s timeout)
      const stale = piece.getStaleRequests(30000)

      // Only peer1's request should be stale
      expect(stale.length).toBe(1)
      expect(stale[0].peerId).toBe('peer1')

      // peer2's request should still be there
      expect(piece.isBlockRequested(1)).toBe(true)
    })
  })
})
