import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ActivePiece, BLOCK_SIZE } from '../../src/core/active-piece'

describe('ActivePiece', () => {
  let piece: ActivePiece
  const PIECE_LENGTH = 64 * 1024 // 64KB = 4 blocks of 16KB

  beforeEach(() => {
    piece = new ActivePiece(0, PIECE_LENGTH)
  })

  describe('constructor', () => {
    it('should initialize with correct values', () => {
      expect(piece.index).toBe(0)
      expect(piece.length).toBe(PIECE_LENGTH)
      expect(piece.blocksNeeded).toBe(4)
      expect(piece.haveAllBlocks).toBe(false)
      expect(piece.blocksReceived).toBe(0)
    })
  })

  describe('addRequest', () => {
    it('should track requests with peer association', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer2')

      expect(piece.outstandingRequests).toBe(2)
      expect(piece.isBlockRequested(0)).toBe(true)
      expect(piece.isBlockRequested(1)).toBe(true)
      expect(piece.isBlockRequested(2)).toBe(false)
    })

    it('should allow multiple requests for same block (endgame mode)', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')

      expect(piece.outstandingRequests).toBe(2)
    })
  })

  describe('addBlock', () => {
    it('should store block data and clear requests', () => {
      piece.addRequest(0, 'peer1')
      const data = new Uint8Array(BLOCK_SIZE)
      data.fill(42)

      const isNew = piece.addBlock(0, data, 'peer1')

      expect(isNew).toBe(true)
      expect(piece.hasBlock(0)).toBe(true)
      expect(piece.blocksReceived).toBe(1)
      expect(piece.isBlockRequested(0)).toBe(false) // Request cleared
    })

    it('should return false for duplicate blocks', () => {
      const data = new Uint8Array(BLOCK_SIZE)
      piece.addBlock(0, data, 'peer1')

      const isNew = piece.addBlock(0, data, 'peer2')

      expect(isNew).toBe(false)
      expect(piece.blocksReceived).toBe(1)
    })

    it('should detect when all blocks received', () => {
      for (let i = 0; i < 4; i++) {
        const data = new Uint8Array(BLOCK_SIZE)
        piece.addBlock(i, data, 'peer1')
      }

      expect(piece.haveAllBlocks).toBe(true)
    })
  })

  describe('clearRequestsForPeer', () => {
    it('should clear only requests from specified peer', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer2')

      const cleared = piece.clearRequestsForPeer('peer1')

      expect(cleared).toBe(2) // 2 requests from peer1
      expect(piece.outstandingRequests).toBe(2) // 2 requests from peer2 remain
      expect(piece.isBlockRequested(0)).toBe(true) // peer2 still has request
      expect(piece.isBlockRequested(1)).toBe(false) // peer1 request cleared
      expect(piece.isBlockRequested(2)).toBe(true) // peer2 request remains
    })

    it('should return 0 when peer has no requests', () => {
      piece.addRequest(0, 'peer1')

      const cleared = piece.clearRequestsForPeer('peer2')

      expect(cleared).toBe(0)
      expect(piece.outstandingRequests).toBe(1)
    })
  })

  describe('checkTimeouts', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return Map of cleared requests per peer', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer2')

      // Advance time past timeout
      vi.advanceTimersByTime(31000)

      const clearedByPeer = piece.checkTimeouts(30000)

      expect(clearedByPeer.size).toBe(2)
      expect(clearedByPeer.get('peer1')).toBe(2)
      expect(clearedByPeer.get('peer2')).toBe(1)
      expect(piece.outstandingRequests).toBe(0)
    })

    it('should not clear requests that havent timed out', () => {
      piece.addRequest(0, 'peer1')

      vi.advanceTimersByTime(10000) // Only 10 seconds

      const clearedByPeer = piece.checkTimeouts(30000)

      expect(clearedByPeer.size).toBe(0)
      expect(piece.outstandingRequests).toBe(1)
    })

    it('should only clear timed-out requests, keeping fresh ones', () => {
      piece.addRequest(0, 'peer1')

      vi.advanceTimersByTime(25000) // 25 seconds

      piece.addRequest(1, 'peer2') // Fresh request

      vi.advanceTimersByTime(10000) // Now peer1 at 35s, peer2 at 10s

      const clearedByPeer = piece.checkTimeouts(30000)

      expect(clearedByPeer.size).toBe(1)
      expect(clearedByPeer.get('peer1')).toBe(1)
      expect(clearedByPeer.has('peer2')).toBe(false)
      expect(piece.outstandingRequests).toBe(1) // peer2 remains
    })
  })

  describe('getNeededBlocks', () => {
    it('should return unrequested, unreceived blocks', () => {
      piece.addRequest(0, 'peer1')
      piece.addBlock(1, new Uint8Array(BLOCK_SIZE), 'peer1')

      const needed = piece.getNeededBlocks()

      expect(needed).toHaveLength(2) // blocks 2 and 3
      expect(needed[0].begin).toBe(2 * BLOCK_SIZE)
      expect(needed[1].begin).toBe(3 * BLOCK_SIZE)
    })

    it('should respect maxBlocks limit', () => {
      const needed = piece.getNeededBlocks(2)

      expect(needed).toHaveLength(2)
    })

    it('should return empty when all blocks requested or received', () => {
      for (let i = 0; i < 4; i++) {
        piece.addRequest(i, 'peer1')
      }

      const needed = piece.getNeededBlocks()

      expect(needed).toHaveLength(0)
    })
  })

  describe('assemble', () => {
    it('should assemble all blocks in order', () => {
      for (let i = 0; i < 4; i++) {
        const data = new Uint8Array(BLOCK_SIZE)
        data.fill(i)
        piece.addBlock(i, data, 'peer1')
      }

      const assembled = piece.assemble()

      expect(assembled.length).toBe(PIECE_LENGTH)
      // Check first byte of each block
      expect(assembled[0]).toBe(0)
      expect(assembled[BLOCK_SIZE]).toBe(1)
      expect(assembled[2 * BLOCK_SIZE]).toBe(2)
      expect(assembled[3 * BLOCK_SIZE]).toBe(3)
    })

    it('should throw if blocks are missing', () => {
      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')

      expect(() => piece.assemble()).toThrow('missing blocks')
    })
  })

  describe('getContributingPeers', () => {
    it('should return set of peers that sent blocks', () => {
      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
      piece.addBlock(1, new Uint8Array(BLOCK_SIZE), 'peer2')
      piece.addBlock(2, new Uint8Array(BLOCK_SIZE), 'peer1')

      const peers = piece.getContributingPeers()

      expect(peers.size).toBe(2)
      expect(peers.has('peer1')).toBe(true)
      expect(peers.has('peer2')).toBe(true)
    })
  })

  describe('endgame methods', () => {
    describe('getNeededBlocksEndgame', () => {
      it('should return blocks not requested by this specific peer', () => {
        const piece = new ActivePiece(0, 32768) // 2 blocks

        // peer1 requests block 0
        piece.addRequest(0, 'peer1')

        // peer2 should be able to request block 0 (duplicate) and block 1
        const needed = piece.getNeededBlocksEndgame('peer2')
        expect(needed).toHaveLength(2)
        expect(needed[0].begin).toBe(0)
        expect(needed[1].begin).toBe(16384)
      })

      it('should not return blocks already requested by this peer', () => {
        const piece = new ActivePiece(0, 32768)

        piece.addRequest(0, 'peer1')
        piece.addRequest(1, 'peer1')

        // peer1 already requested everything
        const needed = piece.getNeededBlocksEndgame('peer1')
        expect(needed).toHaveLength(0)
      })

      it('should not return blocks we already have', () => {
        const piece = new ActivePiece(0, 32768)

        // Receive block 0
        piece.addBlock(0, new Uint8Array(16384), 'peer1')

        // peer2 should only get block 1
        const needed = piece.getNeededBlocksEndgame('peer2')
        expect(needed).toHaveLength(1)
        expect(needed[0].begin).toBe(16384)
      })

      it('should respect maxBlocks limit', () => {
        const piece = new ActivePiece(0, 65536) // 4 blocks

        const needed = piece.getNeededBlocksEndgame('peer1', 2)
        expect(needed).toHaveLength(2)
      })
    })

    describe('getOtherRequesters', () => {
      it('should return peers that requested the block excluding one', () => {
        const piece = new ActivePiece(0, 16384)

        piece.addRequest(0, 'peer1')
        piece.addRequest(0, 'peer2')
        piece.addRequest(0, 'peer3')

        const others = piece.getOtherRequesters(0, 'peer1')
        expect(others.sort()).toEqual(['peer2', 'peer3'])
      })

      it('should return empty array if no other requesters', () => {
        const piece = new ActivePiece(0, 16384)

        piece.addRequest(0, 'peer1')

        const others = piece.getOtherRequesters(0, 'peer1')
        expect(others).toHaveLength(0)
      })

      it('should return empty array for unrequested block', () => {
        const piece = new ActivePiece(0, 16384)

        const others = piece.getOtherRequesters(0, 'peer1')
        expect(others).toHaveLength(0)
      })
    })
  })
})
