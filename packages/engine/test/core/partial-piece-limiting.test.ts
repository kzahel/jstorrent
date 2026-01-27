import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivePieceManager, ActivePieceConfig } from '../../src/core/active-piece-manager'
import { MockEngine } from '../utils/mock-engine'

/**
 * Phase 2 Tests: Partial Piece Limiting (Option A - Three-State Model)
 *
 * Tests the three-state piece model matching libtorrent:
 * - Partial: has unrequested blocks (counts against cap)
 * - Full: all blocks requested but not all received (does NOT count against cap)
 * - Pending: all blocks received, awaiting verification
 *
 * Key behaviors:
 * - Partial cap is min(peers × 1.5, 2048 / blocksPerPiece)
 * - shouldPrioritizePartials() returns true when partials exceed threshold
 * - promoteToFull() moves piece when all blocks requested
 * - demoteToPartial() moves piece when request cancelled
 * - promoteToPending() moves piece when all blocks received
 * - Full pieces don't count against the partial cap
 */

describe('Partial Piece Limiting', () => {
  let engine: MockEngine
  let pieceLengthFn: (index: number) => number
  const PIECE_LENGTH = 262144 // 256KB

  beforeEach(() => {
    vi.useFakeTimers()
    engine = new MockEngine()
    pieceLengthFn = () => PIECE_LENGTH
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getMaxPartials threshold calculation', () => {
    it('should return peers × 1.5 when below block cap', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // 10 peers × 1.5 = 15, block cap = 2048/16 = 128
      // min(15, 128) = 15
      expect(manager.getMaxPartials(10)).toBe(15)

      // 20 peers × 1.5 = 30
      expect(manager.getMaxPartials(20)).toBe(30)

      manager.destroy()
    })

    it('should respect block cap (2048 / blocksPerPiece)', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Block cap = 2048/16 = 128
      // 100 peers × 1.5 = 150, but cap is 128
      expect(manager.getMaxPartials(100)).toBe(128)

      // 1000 peers × 1.5 = 1500, still capped at 128
      expect(manager.getMaxPartials(1000)).toBe(128)

      manager.destroy()
    })

    it('should return at least 1', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // 0 peers × 1.5 = 0, but minimum is 1
      expect(manager.getMaxPartials(0)).toBe(1)

      manager.destroy()
    })

    it('should handle small pieces (more blocks per piece)', () => {
      // 64KB pieces = 4 blocks per piece
      const smallPieceLength = 65536
      const smallPieceLengthFn = () => smallPieceLength
      const config: Partial<ActivePieceConfig> = { standardPieceLength: smallPieceLength }
      const manager = new ActivePieceManager(engine, smallPieceLengthFn, config)

      // Block cap = 2048/4 = 512
      // 10 peers × 1.5 = 15, min(15, 512) = 15
      expect(manager.getMaxPartials(10)).toBe(15)

      // 500 peers × 1.5 = 750, but block cap = 512
      expect(manager.getMaxPartials(500)).toBe(512)

      manager.destroy()
    })
  })

  describe('shouldPrioritizePartials', () => {
    it('should return false when under threshold', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // No pieces - definitely under threshold
      expect(manager.shouldPrioritizePartials(10)).toBe(false)

      // Add some pieces below threshold (10 peers × 1.5 = 15)
      for (let i = 0; i < 10; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.shouldPrioritizePartials(10)).toBe(false)

      manager.destroy()
    })

    it('should return true when over threshold', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // 10 peers × 1.5 = 15
      // Create 16 pieces (over threshold)
      for (let i = 0; i < 16; i++) {
        manager.getOrCreate(i)
      }

      expect(manager.shouldPrioritizePartials(10)).toBe(true)

      manager.destroy()
    })

    it('should count only partial pieces, not pending', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 16 partial pieces (10 peers × 1.5 = 15 threshold)
      for (let i = 0; i < 16; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.shouldPrioritizePartials(10)).toBe(true)

      // Move half to pending - should now be under threshold
      for (let i = 0; i < 8; i++) {
        manager.promoteToPending(i)
      }
      expect(manager.partialCount).toBe(8)
      expect(manager.pendingCount).toBe(8)
      expect(manager.shouldPrioritizePartials(10)).toBe(false) // 8 < 15

      manager.destroy()
    })
  })

  describe('promoteToPending', () => {
    it('should move piece from partial to pending', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      manager.getOrCreate(0)
      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isPending(0)).toBe(false)
      expect(manager.partialCount).toBe(1)
      expect(manager.pendingCount).toBe(0)

      manager.promoteToPending(0)

      expect(manager.isPartial(0)).toBe(false)
      expect(manager.isPending(0)).toBe(true)
      expect(manager.partialCount).toBe(0)
      expect(manager.pendingCount).toBe(1)

      // Should still be accessible via get() and has()
      expect(manager.has(0)).toBe(true)
      expect(manager.get(0)).toBeDefined()

      manager.destroy()
    })

    it('should preserve piece state during promotion', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!
      piece.addBlock(0, new Uint8Array(16384), 'peer1')
      piece.addBlock(1, new Uint8Array(16384), 'peer1')

      const originalBlocksReceived = piece.blocksReceived

      manager.promoteToPending(0)

      const promotedPiece = manager.get(0)!
      expect(promotedPiece).toBe(piece) // Same object
      expect(promotedPiece.blocksReceived).toBe(originalBlocksReceived)

      manager.destroy()
    })

    it('should be idempotent for already-pending pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      manager.getOrCreate(0)
      manager.promoteToPending(0)

      expect(manager.pendingCount).toBe(1)

      // Promote again - should be no-op
      manager.promoteToPending(0)

      expect(manager.pendingCount).toBe(1)
      expect(manager.partialCount).toBe(0)

      manager.destroy()
    })

    it('should handle non-existent pieces gracefully', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Should not throw
      manager.promoteToPending(999)

      expect(manager.partialCount).toBe(0)
      expect(manager.pendingCount).toBe(0)

      manager.destroy()
    })
  })

  describe('removePending', () => {
    it('should remove piece from pending', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      manager.getOrCreate(0)
      manager.promoteToPending(0)
      expect(manager.pendingCount).toBe(1)

      manager.removePending(0)

      expect(manager.pendingCount).toBe(0)
      expect(manager.has(0)).toBe(false)

      manager.destroy()
    })

    it('should return the removed piece', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const originalPiece = manager.getOrCreate(0)!
      manager.promoteToPending(0)

      const removed = manager.removePending(0)
      expect(removed).toBe(originalPiece)

      manager.destroy()
    })

    it('should return undefined for non-pending pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Partial piece (not promoted)
      manager.getOrCreate(0)
      expect(manager.removePending(0)).toBeUndefined()

      // Non-existent piece
      expect(manager.removePending(999)).toBeUndefined()

      manager.destroy()
    })
  })

  describe('remove (generic)', () => {
    it('should remove from partial map', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      manager.getOrCreate(0)
      expect(manager.partialCount).toBe(1)

      manager.remove(0)

      expect(manager.partialCount).toBe(0)
      expect(manager.has(0)).toBe(false)

      manager.destroy()
    })

    it('should remove from pending map', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      manager.getOrCreate(0)
      manager.promoteToPending(0)
      expect(manager.pendingCount).toBe(1)

      manager.remove(0)

      expect(manager.pendingCount).toBe(0)
      expect(manager.has(0)).toBe(false)

      manager.destroy()
    })
  })

  describe('partialValues', () => {
    it('should iterate only partial pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 5 pieces
      for (let i = 0; i < 5; i++) {
        manager.getOrCreate(i)
      }

      // Promote 2 to pending
      manager.promoteToPending(1)
      manager.promoteToPending(3)

      const partialIndices: number[] = []
      for (const piece of manager.partialValues()) {
        partialIndices.push(piece.index)
      }

      expect(partialIndices.sort()).toEqual([0, 2, 4])

      manager.destroy()
    })
  })

  describe('pendingValues', () => {
    it('should iterate only pending pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 5 pieces
      for (let i = 0; i < 5; i++) {
        manager.getOrCreate(i)
      }

      // Promote 2 to pending
      manager.promoteToPending(1)
      manager.promoteToPending(3)

      const pendingIndices: number[] = []
      for (const piece of manager.pendingValues()) {
        pendingIndices.push(piece.index)
      }

      expect(pendingIndices.sort()).toEqual([1, 3])

      manager.destroy()
    })
  })

  describe('values (all pieces)', () => {
    it('should iterate both partial and pending pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 5 pieces
      for (let i = 0; i < 5; i++) {
        manager.getOrCreate(i)
      }

      // Promote 2 to pending
      manager.promoteToPending(1)
      manager.promoteToPending(3)

      const allIndices: number[] = []
      for (const piece of manager.values()) {
        allIndices.push(piece.index)
      }

      expect(allIndices.sort()).toEqual([0, 1, 2, 3, 4])

      manager.destroy()
    })
  })

  describe('counts', () => {
    it('should track partialCount and pendingCount separately', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      expect(manager.partialCount).toBe(0)
      expect(manager.pendingCount).toBe(0)
      expect(manager.activeCount).toBe(0)

      // Add 3 partial pieces
      for (let i = 0; i < 3; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.partialCount).toBe(3)
      expect(manager.pendingCount).toBe(0)
      expect(manager.activeCount).toBe(3)

      // Promote 1 to pending
      manager.promoteToPending(1)
      expect(manager.partialCount).toBe(2)
      expect(manager.pendingCount).toBe(1)
      expect(manager.activeCount).toBe(3)

      // Remove pending
      manager.removePending(1)
      expect(manager.partialCount).toBe(2)
      expect(manager.pendingCount).toBe(0)
      expect(manager.activeCount).toBe(2)

      manager.destroy()
    })
  })

  describe('clearRequestsForPeer', () => {
    it('should only clear requests from partial pieces (not pending)', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece0 = manager.getOrCreate(0)!
      const piece1 = manager.getOrCreate(1)!

      // Add requests to both pieces
      piece0.addRequest(0, 'peer1')
      piece0.addRequest(1, 'peer1')
      piece1.addRequest(0, 'peer1')

      // Promote piece1 to pending
      manager.promoteToPending(1)

      // Clear requests for peer1 - should only affect partial piece (piece0)
      const cleared = manager.clearRequestsForPeer('peer1')

      // Only 2 requests from partial piece should be cleared
      // (pending piece1 has all blocks and shouldn't have requests cleared)
      expect(cleared).toBe(2)

      manager.destroy()
    })
  })

  describe('hasUnrequestedBlocks', () => {
    it('should only check partial pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece0 = manager.getOrCreate(0)!
      manager.getOrCreate(1) // Create piece1, don't need the reference

      // piece0: no requests, has unrequested blocks
      // piece1: will be promoted to pending
      expect(manager.hasUnrequestedBlocks()).toBe(true)

      // Promote piece1 to pending
      manager.promoteToPending(1)

      // piece0 still has unrequested blocks
      expect(manager.hasUnrequestedBlocks()).toBe(true)

      // Request all blocks of piece0
      for (let i = 0; i < piece0.blocksNeeded; i++) {
        piece0.addRequest(i, 'peer1')
      }

      // Now no partial has unrequested blocks
      expect(manager.hasUnrequestedBlocks()).toBe(false)

      manager.destroy()
    })
  })

  describe('totalBufferedBytes', () => {
    it('should include bytes from both partial and pending pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece0 = manager.getOrCreate(0)!
      const piece1 = manager.getOrCreate(1)!

      // Add blocks to both pieces
      piece0.addBlock(0, new Uint8Array(16384), 'peer1')
      piece1.addBlock(0, new Uint8Array(16384), 'peer1')
      piece1.addBlock(1, new Uint8Array(16384), 'peer1')

      expect(manager.totalBufferedBytes).toBe(16384 * 3)

      // Promote piece1 to pending
      manager.promoteToPending(1)

      // Total should still include both
      expect(manager.totalBufferedBytes).toBe(16384 * 3)

      manager.destroy()
    })
  })

  // ==========================================================================
  // Option A: Three-State Model (partial -> full -> pending)
  // ==========================================================================

  describe('promoteToFull', () => {
    it('should move piece from partial to full when all blocks requested', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!
      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isFull(0)).toBe(false)
      expect(manager.partialCount).toBe(1)
      expect(manager.fullCount).toBe(0)

      // Request all blocks
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }

      manager.promoteToFull(0)

      expect(manager.isPartial(0)).toBe(false)
      expect(manager.isFull(0)).toBe(true)
      expect(manager.partialCount).toBe(0)
      expect(manager.fullCount).toBe(1)

      // Should still be accessible
      expect(manager.has(0)).toBe(true)
      expect(manager.get(0)).toBe(piece)

      manager.destroy()
    })

    it('should not promote if piece still has unrequested blocks', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Request only some blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')

      manager.promoteToFull(0)

      // Should remain partial because it has unrequested blocks
      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isFull(0)).toBe(false)

      manager.destroy()
    })

    it('should be idempotent for non-existent pieces', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Should not throw
      manager.promoteToFull(999)

      expect(manager.partialCount).toBe(0)
      expect(manager.fullCount).toBe(0)

      manager.destroy()
    })
  })

  describe('demoteToPartial', () => {
    it('should move piece from full back to partial when request cancelled', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Request all blocks and promote to full
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)
      expect(manager.isFull(0)).toBe(true)

      // Cancel a request
      piece.cancelRequest(0, 'peer1')

      // Now demote
      manager.demoteToPartial(0)

      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isFull(0)).toBe(false)
      expect(manager.partialCount).toBe(1)
      expect(manager.fullCount).toBe(0)

      manager.destroy()
    })

    it('should not demote if piece has no unrequested blocks', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Request all blocks and promote to full
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)

      // Try to demote without cancelling any requests
      manager.demoteToPartial(0)

      // Should still be full
      expect(manager.isFull(0)).toBe(true)
      expect(manager.isPartial(0)).toBe(false)

      manager.destroy()
    })
  })

  describe('three-state transitions', () => {
    it('should transition partial -> full -> pending correctly', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // State 1: Partial
      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isFull(0)).toBe(false)
      expect(manager.isPending(0)).toBe(false)

      // Request all blocks -> Full
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)

      // State 2: Full
      expect(manager.isPartial(0)).toBe(false)
      expect(manager.isFull(0)).toBe(true)
      expect(manager.isPending(0)).toBe(false)

      // Receive all blocks -> Pending
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addBlock(i, new Uint8Array(16384), 'peer1')
      }
      manager.promoteToPending(0)

      // State 3: Pending
      expect(manager.isPartial(0)).toBe(false)
      expect(manager.isFull(0)).toBe(false)
      expect(manager.isPending(0)).toBe(true)

      manager.destroy()
    })

    it('should transition partial -> full -> partial (on timeout)', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Request all blocks and promote to full
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)
      expect(manager.isFull(0)).toBe(true)

      // Simulate peer disconnect clearing requests
      manager.clearRequestsForPeer('peer1')

      // Should be back to partial
      expect(manager.isPartial(0)).toBe(true)
      expect(manager.isFull(0)).toBe(false)

      manager.destroy()
    })

    it('should allow direct partial -> pending transition (rapid completion)', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Receive all blocks directly (simulates very fast peer)
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addBlock(i, new Uint8Array(16384), 'peer1')
      }

      // Promote directly to pending (skipping full state)
      manager.promoteToPending(0)

      expect(manager.isPartial(0)).toBe(false)
      expect(manager.isFull(0)).toBe(false)
      expect(manager.isPending(0)).toBe(true)

      manager.destroy()
    })
  })

  describe('full pieces and partial cap', () => {
    it('should not count full pieces against partial cap', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // 1 peer = cap of 1 partial piece
      expect(manager.getMaxPartials(1)).toBe(1)
      expect(manager.shouldPrioritizePartials(1)).toBe(false)

      // Create piece 0 and fully request it
      const piece0 = manager.getOrCreate(0)!
      for (let i = 0; i < piece0.blocksNeeded; i++) {
        piece0.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)

      // Still under cap because full pieces don't count
      expect(manager.shouldPrioritizePartials(1)).toBe(false)
      expect(manager.partialCount).toBe(0)
      expect(manager.fullCount).toBe(1)

      // Can create another piece
      const piece1 = manager.getOrCreate(1)!
      expect(piece1).not.toBeNull()
      expect(manager.partialCount).toBe(1)

      // Now at cap (1 partial)
      // Still not over because cap is 1 and we have exactly 1
      expect(manager.shouldPrioritizePartials(1)).toBe(false)

      // Create a second partial piece
      manager.getOrCreate(2)
      expect(manager.partialCount).toBe(2)

      // Now over cap (2 partials > 1)
      expect(manager.shouldPrioritizePartials(1)).toBe(true)

      manager.destroy()
    })

    it('should allow filling pipeline with single peer', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const pipelineDepth = 500
      const blocksPerPiece = 16 // 256KB / 16KB
      const piecesNeeded = Math.ceil(pipelineDepth / blocksPerPiece) // 32 pieces

      for (let p = 0; p < piecesNeeded; p++) {
        const piece = manager.getOrCreate(p)
        expect(piece).not.toBeNull()

        // Request all blocks
        for (let b = 0; b < piece!.blocksNeeded; b++) {
          piece!.addRequest(b, 'peer1')
        }
        manager.promoteToFull(p)

        // Should never be blocked by cap (all promoted to full)
        expect(manager.shouldPrioritizePartials(1)).toBe(false)
      }

      expect(manager.fullCount).toBe(piecesNeeded)
      expect(manager.partialCount).toBe(0)

      manager.destroy()
    })
  })

  describe('fullValues and downloadingValues iterators', () => {
    it('should iterate only full pieces with fullValues()', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 5 pieces
      for (let i = 0; i < 5; i++) {
        const piece = manager.getOrCreate(i)!
        // Fully request pieces 1 and 3
        if (i === 1 || i === 3) {
          for (let b = 0; b < piece.blocksNeeded; b++) {
            piece.addRequest(b, 'peer1')
          }
          manager.promoteToFull(i)
        }
      }

      const fullIndices: number[] = []
      for (const piece of manager.fullValues()) {
        fullIndices.push(piece.index)
      }

      expect(fullIndices.sort()).toEqual([1, 3])

      manager.destroy()
    })

    it('should iterate partial and full pieces with downloadingValues()', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Create 5 pieces
      for (let i = 0; i < 5; i++) {
        const piece = manager.getOrCreate(i)!
        // Fully request pieces 1 and 3
        if (i === 1 || i === 3) {
          for (let b = 0; b < piece.blocksNeeded; b++) {
            piece.addRequest(b, 'peer1')
          }
          manager.promoteToFull(i)
        }
        // Promote piece 4 to pending
        if (i === 4) {
          for (let b = 0; b < piece.blocksNeeded; b++) {
            piece.addBlock(b, new Uint8Array(16384), 'peer1')
          }
          manager.promoteToPending(i)
        }
      }

      const downloadingIndices: number[] = []
      for (const piece of manager.downloadingValues()) {
        downloadingIndices.push(piece.index)
      }

      // Should include partial (0, 2) and full (1, 3), but not pending (4)
      expect(downloadingIndices.sort()).toEqual([0, 1, 2, 3])

      manager.destroy()
    })
  })

  describe('clearRequestsForPeer with full pieces', () => {
    it('should demote full pieces to partial when requests cleared', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const piece = manager.getOrCreate(0)!

      // Request all blocks and promote to full
      for (let i = 0; i < piece.blocksNeeded; i++) {
        piece.addRequest(i, 'peer1')
      }
      manager.promoteToFull(0)

      expect(manager.fullCount).toBe(1)
      expect(manager.partialCount).toBe(0)

      // Clear requests for peer1
      const cleared = manager.clearRequestsForPeer('peer1')
      expect(cleared).toBe(piece.blocksNeeded)

      // Piece should now be partial again
      expect(manager.fullCount).toBe(0)
      expect(manager.partialCount).toBe(1)
      expect(manager.isPartial(0)).toBe(true)

      manager.destroy()
    })
  })

  describe('edge cases', () => {
    it('should handle rapid promotions and removals', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      for (let i = 0; i < 100; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.partialCount).toBe(100)

      // Promote all to pending
      for (let i = 0; i < 100; i++) {
        manager.promoteToPending(i)
      }
      expect(manager.partialCount).toBe(0)
      expect(manager.pendingCount).toBe(100)

      // Remove all pending
      for (let i = 0; i < 100; i++) {
        manager.removePending(i)
      }
      expect(manager.partialCount).toBe(0)
      expect(manager.pendingCount).toBe(0)

      manager.destroy()
    })

    it('should handle mixed promotions and new piece creation', () => {
      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      // Simulate real usage pattern:
      // - Create pieces 0-4
      // - Promote 0-2 to pending (verification in progress)
      // - Create pieces 5-7 (new downloads)
      // - Promote 3-4 to pending
      // - Remove 0-2 (verification complete)

      for (let i = 0; i < 5; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.partialCount).toBe(5)
      expect(manager.pendingCount).toBe(0)

      for (let i = 0; i < 3; i++) {
        manager.promoteToPending(i)
      }
      expect(manager.partialCount).toBe(2)
      expect(manager.pendingCount).toBe(3)

      for (let i = 5; i < 8; i++) {
        manager.getOrCreate(i)
      }
      expect(manager.partialCount).toBe(5)
      expect(manager.pendingCount).toBe(3)
      expect(manager.activeCount).toBe(8)

      for (let i = 3; i < 5; i++) {
        manager.promoteToPending(i)
      }
      expect(manager.partialCount).toBe(3)
      expect(manager.pendingCount).toBe(5)

      for (let i = 0; i < 3; i++) {
        manager.removePending(i)
      }
      expect(manager.partialCount).toBe(3)
      expect(manager.pendingCount).toBe(2)
      expect(manager.activeCount).toBe(5)

      manager.destroy()
    })

    it('should maintain correct threshold behavior during disk I/O backup', () => {
      // Scenario: Disk I/O is slow, pieces queue up in pending state
      // The partial cap should NOT prevent new downloads just because
      // pending pieces are waiting for verification

      const config: Partial<ActivePieceConfig> = { standardPieceLength: PIECE_LENGTH }
      const manager = new ActivePieceManager(engine, pieceLengthFn, config)

      const connectedPeerCount = 10 // Threshold = 15

      // Create 20 pieces
      for (let i = 0; i < 20; i++) {
        manager.getOrCreate(i)
      }

      // Over threshold
      expect(manager.shouldPrioritizePartials(connectedPeerCount)).toBe(true)

      // Simulate disk backup: promote 10 pieces to pending (still verifying)
      for (let i = 0; i < 10; i++) {
        manager.promoteToPending(i)
      }

      // Now only 10 partials - under threshold again!
      // This means new pieces can start downloading even though
      // the pending queue is backed up
      expect(manager.partialCount).toBe(10)
      expect(manager.pendingCount).toBe(10)
      expect(manager.shouldPrioritizePartials(connectedPeerCount)).toBe(false) // 10 < 15

      manager.destroy()
    })
  })
})
