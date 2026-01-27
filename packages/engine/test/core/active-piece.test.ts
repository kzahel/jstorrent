import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ActivePiece, BLOCK_SIZE } from '../../src/core/active-piece'
import { ChunkedBuffer } from '../../src/core/chunked-buffer'

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

  // === Phase 3: Pre-allocated Buffer Tests ===

  describe('pre-allocated buffer', () => {
    it('should accept a pre-allocated buffer in constructor', () => {
      const buffer = new Uint8Array(PIECE_LENGTH)
      const pieceWithBuffer = new ActivePiece(0, PIECE_LENGTH, buffer)

      expect(pieceWithBuffer.getBuffer()).toBe(buffer) // Same reference
    })

    it('should allocate a new buffer if none provided', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)
      const buffer = piece.getBuffer()

      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBe(PIECE_LENGTH)
    })

    it('should write blocks directly to the buffer at correct offsets', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH) // 4 blocks

      // Add blocks with unique data
      for (let i = 0; i < 4; i++) {
        const data = new Uint8Array(BLOCK_SIZE)
        data.fill(i * 10 + 5) // 5, 15, 25, 35
        piece.addBlock(i, data, 'peer1')
      }

      const buffer = piece.getBuffer()

      // Check each block's position
      expect(buffer[0]).toBe(5)
      expect(buffer[BLOCK_SIZE]).toBe(15)
      expect(buffer[2 * BLOCK_SIZE]).toBe(25)
      expect(buffer[3 * BLOCK_SIZE]).toBe(35)
    })

    it('should support out-of-order block receipt', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      // Add blocks in reverse order
      for (let i = 3; i >= 0; i--) {
        const data = new Uint8Array(BLOCK_SIZE)
        data.fill(i)
        piece.addBlock(i, data, 'peer1')
      }

      expect(piece.haveAllBlocks).toBe(true)

      const buffer = piece.getBuffer()
      expect(buffer[0]).toBe(0)
      expect(buffer[BLOCK_SIZE]).toBe(1)
      expect(buffer[2 * BLOCK_SIZE]).toBe(2)
      expect(buffer[3 * BLOCK_SIZE]).toBe(3)
    })

    it('should return the same buffer reference from assemble()', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      for (let i = 0; i < 4; i++) {
        piece.addBlock(i, new Uint8Array(BLOCK_SIZE), 'peer1')
      }

      const assembled = piece.assemble()
      const buffer = piece.getBuffer()

      expect(assembled).toBe(buffer) // Same reference - no copy!
    })

    it('should return allocated size for bufferedBytes', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      // bufferedBytes returns the allocated buffer size, not received bytes
      expect(piece.bufferedBytes).toBe(PIECE_LENGTH)

      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.bufferedBytes).toBe(PIECE_LENGTH) // Still the full allocation

      piece.addBlock(2, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.bufferedBytes).toBe(PIECE_LENGTH) // Still the full allocation
    })

    it('should calculate receivedBytes correctly', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      expect(piece.receivedBytes).toBe(0)

      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.receivedBytes).toBe(BLOCK_SIZE)

      piece.addBlock(2, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.receivedBytes).toBe(2 * BLOCK_SIZE)
    })

    it('should handle last block being smaller', () => {
      // 3.5 blocks = 57344 bytes
      const oddLength = 3 * BLOCK_SIZE + BLOCK_SIZE / 2
      const piece = new ActivePiece(0, oddLength)

      expect(piece.blocksNeeded).toBe(4)

      // Add all blocks
      for (let i = 0; i < 4; i++) {
        const blockLength = Math.min(BLOCK_SIZE, oddLength - i * BLOCK_SIZE)
        const data = new Uint8Array(blockLength)
        data.fill(i)
        piece.addBlock(i, data, 'peer1')
      }

      // bufferedBytes = allocated size, receivedBytes = actual data received
      expect(piece.bufferedBytes).toBe(oddLength)
      expect(piece.receivedBytes).toBe(oddLength)
      expect(piece.haveAllBlocks).toBe(true)
    })
  })

  describe('addBlockFromChunked', () => {
    it('should copy block data directly from ChunkedBuffer', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)
      const chunked = new ChunkedBuffer()

      // Simulate a PIECE message: 4-byte length + 1-byte type + 4-byte index + 4-byte begin + block data
      const blockData = new Uint8Array(BLOCK_SIZE)
      blockData.fill(42)
      chunked.push(blockData)

      const isNew = piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')

      expect(isNew).toBe(true)
      expect(piece.hasBlock(0)).toBe(true)

      // Verify data was copied correctly
      const buffer = piece.getBuffer()
      expect(buffer[0]).toBe(42)
      expect(buffer[BLOCK_SIZE - 1]).toBe(42)
    })

    it('should reject duplicate blocks from ChunkedBuffer', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)
      const chunked = new ChunkedBuffer()

      const blockData = new Uint8Array(BLOCK_SIZE)
      chunked.push(blockData)

      piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')
      const isNew = piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer2')

      expect(isNew).toBe(false)
      expect(piece.blocksReceived).toBe(1)
    })

    it('should copy from correct offset in ChunkedBuffer', () => {
      const piece = new ActivePiece(0, 32768) // 2 blocks
      const chunked = new ChunkedBuffer()

      // Push header bytes then block data
      const header = new Uint8Array([0, 0, 0, 9]) // 4-byte length prefix
      const blockData = new Uint8Array(BLOCK_SIZE)
      blockData.fill(99)

      chunked.push(header)
      chunked.push(blockData)

      // Copy skipping the 4-byte header
      piece.addBlockFromChunked(0, chunked, 4, BLOCK_SIZE, 'peer1')

      const buffer = piece.getBuffer()
      expect(buffer[0]).toBe(99)
    })

    it('should track peer sender for blocks from ChunkedBuffer', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)
      const chunked = new ChunkedBuffer()

      chunked.push(new Uint8Array(BLOCK_SIZE))
      piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')

      const peers = piece.getContributingPeers()
      expect(peers.has('peer1')).toBe(true)
    })

    it('should clear request for block when received from ChunkedBuffer', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)
      const chunked = new ChunkedBuffer()

      piece.addRequest(0, 'peer1')
      expect(piece.isBlockRequested(0)).toBe(true)

      chunked.push(new Uint8Array(BLOCK_SIZE))
      piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')

      expect(piece.isBlockRequested(0)).toBe(false)
    })
  })

  describe('clear', () => {
    it('should reset blockReceived array without clearing buffer', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      // Add some blocks
      const data = new Uint8Array(BLOCK_SIZE)
      data.fill(42)
      piece.addBlock(0, data, 'peer1')
      piece.addBlock(1, data, 'peer1')

      expect(piece.blocksReceived).toBe(2)

      // Clear
      piece.clear()

      expect(piece.blocksReceived).toBe(0)
      expect(piece.hasBlock(0)).toBe(false)
      expect(piece.hasBlock(1)).toBe(false)

      // Buffer still exists and has the old data (for pooling)
      const buffer = piece.getBuffer()
      expect(buffer[0]).toBe(42) // Data still there
    })

    it('should reset exclusive peer on clear', () => {
      const piece = new ActivePiece(0, PIECE_LENGTH)

      piece.claimExclusive('fast-peer')
      expect(piece.exclusivePeer).toBe('fast-peer')

      piece.clear()

      expect(piece.exclusivePeer).toBeNull()
    })
  })

  describe('Phase 4: Speed Affinity / Exclusive Ownership', () => {
    it('should start with no exclusive owner', () => {
      expect(piece.exclusivePeer).toBeNull()
    })

    it('should allow claiming exclusive ownership', () => {
      piece.claimExclusive('fast-peer')

      expect(piece.exclusivePeer).toBe('fast-peer')
    })

    it('should allow clearing exclusive ownership', () => {
      piece.claimExclusive('fast-peer')
      piece.clearExclusivePeer()

      expect(piece.exclusivePeer).toBeNull()
    })

    describe('canRequestFrom', () => {
      it('should allow any peer when no exclusive owner', () => {
        expect(piece.canRequestFrom('peer1', true)).toBe(true)
        expect(piece.canRequestFrom('peer1', false)).toBe(true)
        expect(piece.canRequestFrom('peer2', true)).toBe(true)
        expect(piece.canRequestFrom('peer2', false)).toBe(true)
      })

      it('should always allow the exclusive owner', () => {
        piece.claimExclusive('fast-peer')

        // Owner can request regardless of speed
        expect(piece.canRequestFrom('fast-peer', true)).toBe(true)
        expect(piece.canRequestFrom('fast-peer', false)).toBe(true)
      })

      it('should allow fast peers to join fast-owned pieces', () => {
        // Fast peer owns the piece (only fast peers claim exclusive)
        piece.claimExclusive('fast-peer-1')

        // Another fast peer CAN join (fast+fast sharing is fine, no fragmentation)
        expect(piece.canRequestFrom('fast-peer-2', true)).toBe(true)
      })

      it('should block slow peers from fast-owned pieces', () => {
        // Fast peer owns the piece
        piece.claimExclusive('fast-peer')

        // Slow peer CANNOT join fast-owned piece (prevents fragmentation)
        // The fragmentation problem: slow peer delays piece completion for fast owner
        expect(piece.canRequestFrom('slow-peer', false)).toBe(false)
      })

      it('should explain the fragmentation prevention', () => {
        // This test documents the design rationale:
        //
        // Fragmentation problem:
        // - Fast peer A (1MB/s) requests blocks 0-7 of piece X
        // - Slow peer B (10KB/s) requests blocks 8-15 of piece X
        // - Fast peer finishes in 2 seconds, but waits 200+ seconds for slow peer
        // - Piece X is stuck at 50% for 200 seconds due to fragmentation
        //
        // Solution: block slow peers from joining fast-owned pieces
        // Fast peers can share with each other (both fast, no waiting)
        piece.claimExclusive('fast-owner')

        // Fast peer can join
        expect(piece.canRequestFrom('another-fast', true)).toBe(true)

        // Slow peer is blocked to prevent fragmentation
        expect(piece.canRequestFrom('slow-peer', false)).toBe(false)
      })
    })

    it('should track activation time', () => {
      const before = Date.now()
      const newPiece = new ActivePiece(1, PIECE_LENGTH)
      const after = Date.now()

      expect(newPiece.activatedAt).toBeGreaterThanOrEqual(before)
      expect(newPiece.activatedAt).toBeLessThanOrEqual(after)
    })
  })

  // === Phase 5: Piece Health Management Tests ===

  describe('Phase 5: Piece Health Management', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('getStaleRequests', () => {
      it('should return requests older than timeout', () => {
        piece.addRequest(0, 'peer1')
        piece.addRequest(1, 'peer2')

        // Advance time past timeout
        vi.advanceTimersByTime(15000)

        const stale = piece.getStaleRequests(10000) // 10s timeout

        expect(stale).toHaveLength(2)
        expect(stale).toContainEqual({ blockIndex: 0, peerId: 'peer1' })
        expect(stale).toContainEqual({ blockIndex: 1, peerId: 'peer2' })
      })

      it('should not return requests that have not timed out', () => {
        piece.addRequest(0, 'peer1')

        vi.advanceTimersByTime(5000) // Only 5 seconds

        const stale = piece.getStaleRequests(10000)

        expect(stale).toHaveLength(0)
      })

      it('should only return stale requests, keeping fresh ones', () => {
        piece.addRequest(0, 'peer1')

        vi.advanceTimersByTime(8000) // 8 seconds

        piece.addRequest(1, 'peer2') // Fresh request at T=8s

        vi.advanceTimersByTime(5000) // Now peer1 at 13s, peer2 at 5s

        const stale = piece.getStaleRequests(10000)

        expect(stale).toHaveLength(1)
        expect(stale[0]).toEqual({ blockIndex: 0, peerId: 'peer1' })
      })

      it('should return multiple stale requests for same block in endgame', () => {
        piece.addRequest(0, 'peer1')
        piece.addRequest(0, 'peer2') // Duplicate in endgame

        vi.advanceTimersByTime(15000)

        const stale = piece.getStaleRequests(10000)

        expect(stale).toHaveLength(2)
        expect(stale).toContainEqual({ blockIndex: 0, peerId: 'peer1' })
        expect(stale).toContainEqual({ blockIndex: 0, peerId: 'peer2' })
      })
    })

    describe('shouldAbandon', () => {
      it('should not abandon piece before timeout', () => {
        const newPiece = new ActivePiece(1, PIECE_LENGTH)

        vi.advanceTimersByTime(20000) // 20 seconds

        expect(newPiece.shouldAbandon(30000, 0.5)).toBe(false)
      })

      it('should abandon stuck piece with low progress after timeout', () => {
        const newPiece = new ActivePiece(1, PIECE_LENGTH)

        // Add only 1 block (25% progress)
        newPiece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')

        vi.advanceTimersByTime(35000) // 35 seconds

        expect(newPiece.shouldAbandon(30000, 0.5)).toBe(true)
      })

      it('should not abandon piece with sufficient progress', () => {
        const newPiece = new ActivePiece(1, PIECE_LENGTH) // 4 blocks

        // Add 3 blocks (75% progress)
        newPiece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
        newPiece.addBlock(1, new Uint8Array(BLOCK_SIZE), 'peer1')
        newPiece.addBlock(2, new Uint8Array(BLOCK_SIZE), 'peer1')

        vi.advanceTimersByTime(35000)

        expect(newPiece.shouldAbandon(30000, 0.5)).toBe(false)
      })

      it('should not abandon piece at exactly 50% progress', () => {
        const newPiece = new ActivePiece(1, PIECE_LENGTH) // 4 blocks

        // Add 2 blocks (50% progress)
        newPiece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
        newPiece.addBlock(1, new Uint8Array(BLOCK_SIZE), 'peer1')

        vi.advanceTimersByTime(35000)

        expect(newPiece.shouldAbandon(30000, 0.5)).toBe(false)
      })

      it('should abandon piece with no progress after timeout', () => {
        const newPiece = new ActivePiece(1, PIECE_LENGTH)

        vi.advanceTimersByTime(35000)

        expect(newPiece.shouldAbandon(30000, 0.5)).toBe(true)
      })
    })

    describe('cancelRequest', () => {
      it('should remove specific request from block', () => {
        piece.addRequest(0, 'peer1')
        piece.addRequest(0, 'peer2') // Duplicate

        piece.cancelRequest(0, 'peer1')

        expect(piece.outstandingRequests).toBe(1)
        expect(piece.isBlockRequested(0)).toBe(true) // peer2 still has request
      })

      it('should remove block from requests map when last request cancelled', () => {
        piece.addRequest(0, 'peer1')

        piece.cancelRequest(0, 'peer1')

        expect(piece.outstandingRequests).toBe(0)
        expect(piece.isBlockRequested(0)).toBe(false)
      })

      it('should clear exclusive owner if they timed out', () => {
        piece.claimExclusive('slow-peer')
        piece.addRequest(0, 'slow-peer')

        piece.cancelRequest(0, 'slow-peer')

        expect(piece.exclusivePeer).toBeNull()
      })

      it('should not clear exclusive owner if different peer cancelled', () => {
        piece.claimExclusive('fast-peer')
        piece.addRequest(0, 'slow-peer')
        piece.addRequest(1, 'fast-peer')

        piece.cancelRequest(0, 'slow-peer')

        expect(piece.exclusivePeer).toBe('fast-peer')
      })

      it('should handle cancelling non-existent request gracefully', () => {
        // Should not throw
        piece.cancelRequest(0, 'nonexistent-peer')
        expect(piece.outstandingRequests).toBe(0)
      })
    })
  })

  // === Phase 7: hasUnrequestedBlocks Caching Tests ===

  describe('Phase 7: hasUnrequestedBlocks Caching (O(1))', () => {
    it('should start with all blocks unrequested', () => {
      const newPiece = new ActivePiece(0, PIECE_LENGTH) // 4 blocks

      expect(newPiece.hasUnrequestedBlocks).toBe(true)
      expect(newPiece.unrequestedCount).toBe(4)
    })

    it('should decrement count when first request is added to a block', () => {
      expect(piece.unrequestedCount).toBe(4)

      piece.addRequest(0, 'peer1')

      expect(piece.unrequestedCount).toBe(3)
      expect(piece.hasUnrequestedBlocks).toBe(true)
    })

    it('should not change count for duplicate requests on same block', () => {
      piece.addRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      // Duplicate request (endgame mode)
      piece.addRequest(0, 'peer2')

      expect(piece.unrequestedCount).toBe(3) // Still 3, not 2
    })

    it('should become false when all blocks requested', () => {
      for (let i = 0; i < 4; i++) {
        piece.addRequest(i, 'peer1')
      }

      expect(piece.hasUnrequestedBlocks).toBe(false)
      expect(piece.unrequestedCount).toBe(0)
    })

    it('should increment count when last request is cancelled', () => {
      piece.addRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      piece.cancelRequest(0, 'peer1')

      expect(piece.unrequestedCount).toBe(4)
      expect(piece.hasUnrequestedBlocks).toBe(true)
    })

    it('should not change count when one of multiple requests is cancelled', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2') // Duplicate
      expect(piece.unrequestedCount).toBe(3)

      piece.cancelRequest(0, 'peer1')

      expect(piece.unrequestedCount).toBe(3) // Still 3, block still has peer2 request
      expect(piece.hasUnrequestedBlocks).toBe(true)
    })

    it('should decrement count when unrequested block is received', () => {
      expect(piece.unrequestedCount).toBe(4)

      // Receive block without prior request
      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')

      expect(piece.unrequestedCount).toBe(3)
    })

    it('should not change count when requested block is received', () => {
      piece.addRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      // Receive the requested block
      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')

      expect(piece.unrequestedCount).toBe(3) // Still 3, was already decremented by request
    })

    it('should reach 0 when all blocks received', () => {
      for (let i = 0; i < 4; i++) {
        piece.addBlock(i, new Uint8Array(BLOCK_SIZE), 'peer1')
      }

      expect(piece.unrequestedCount).toBe(0)
      expect(piece.hasUnrequestedBlocks).toBe(false)
    })

    it('should handle clearRequestsForPeer correctly', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addRequest(2, 'peer2')
      expect(piece.unrequestedCount).toBe(1) // Only block 3 unrequested

      piece.clearRequestsForPeer('peer1')

      expect(piece.unrequestedCount).toBe(3) // Blocks 0, 1, 3 unrequested (2 still has peer2)
    })

    it('should handle checkTimeouts correctly', () => {
      vi.useFakeTimers()
      try {
        piece.addRequest(0, 'peer1')
        piece.addRequest(1, 'peer1')
        expect(piece.unrequestedCount).toBe(2)

        vi.advanceTimersByTime(35000) // Past timeout

        piece.checkTimeouts(30000)

        expect(piece.unrequestedCount).toBe(4) // All blocks unrequested again
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reset count on clear()', () => {
      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')
      piece.addBlock(2, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.unrequestedCount).toBe(1)

      piece.clear()

      expect(piece.unrequestedCount).toBe(4)
      expect(piece.hasUnrequestedBlocks).toBe(true)
    })

    it('should not increment count for cancelled request on received block', () => {
      // Request a block
      piece.addRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      // Receive the block (clears request)
      piece.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      // Cancel should do nothing (no request to cancel)
      piece.cancelRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)
    })

    it('should be O(1) performance', () => {
      // Create a large piece (1000 blocks)
      const largePiece = new ActivePiece(0, 1000 * BLOCK_SIZE)

      const start = performance.now()
      // Call hasUnrequestedBlocks many times
      for (let i = 0; i < 100000; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        largePiece.hasUnrequestedBlocks
      }
      const elapsed = performance.now() - start

      // Should be very fast (under 50ms for 100k iterations)
      expect(elapsed).toBeLessThan(50)
    })

    it('should handle addBlockFromChunked correctly', () => {
      const chunked = new ChunkedBuffer()
      chunked.push(new Uint8Array(BLOCK_SIZE))

      expect(piece.unrequestedCount).toBe(4)

      // Receive unrequested block via ChunkedBuffer
      piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')

      expect(piece.unrequestedCount).toBe(3)
    })

    it('should handle addBlockFromChunked for requested block', () => {
      const chunked = new ChunkedBuffer()
      chunked.push(new Uint8Array(BLOCK_SIZE))

      piece.addRequest(0, 'peer1')
      expect(piece.unrequestedCount).toBe(3)

      // Receive requested block via ChunkedBuffer
      piece.addBlockFromChunked(0, chunked, 0, BLOCK_SIZE, 'peer1')

      expect(piece.unrequestedCount).toBe(3) // No change, was already decremented
    })
  })
})
