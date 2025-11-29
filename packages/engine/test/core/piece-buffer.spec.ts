import { describe, it, expect } from 'vitest'
import { PieceBuffer } from '../../src/core/piece-buffer'
import { BLOCK_SIZE } from '../../src/core/piece-manager'

describe('PieceBuffer', () => {
  it('should track blocks correctly', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 4) // 4 blocks

    expect(buffer.isComplete()).toBe(false)
    expect(buffer.blocksReceived).toBe(0)

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.blocksReceived).toBe(1)

    buffer.addBlock(BLOCK_SIZE, new Uint8Array(BLOCK_SIZE), 'peer2')
    expect(buffer.blocksReceived).toBe(2)
    expect(buffer.isComplete()).toBe(false)
  })

  it('should detect duplicates', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)

    expect(buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')).toBe(true)
    expect(buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')).toBe(false)
  })

  it('should assemble complete piece', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)

    const block1 = new Uint8Array(BLOCK_SIZE).fill(1)
    const block2 = new Uint8Array(BLOCK_SIZE).fill(2)

    buffer.addBlock(0, block1, 'peer1')
    buffer.addBlock(BLOCK_SIZE, block2, 'peer2')

    expect(buffer.isComplete()).toBe(true)

    const assembled = buffer.assemble()
    expect(assembled.length).toBe(BLOCK_SIZE * 2)
    expect(assembled[0]).toBe(1)
    expect(assembled[BLOCK_SIZE]).toBe(2)
  })

  it('should track contributing peers', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 3)

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    buffer.addBlock(BLOCK_SIZE, new Uint8Array(BLOCK_SIZE), 'peer2')
    buffer.addBlock(BLOCK_SIZE * 2, new Uint8Array(BLOCK_SIZE), 'peer1')

    const peers = buffer.getContributingPeers()
    expect(peers.size).toBe(2)
    expect(peers.has('peer1')).toBe(true)
    expect(peers.has('peer2')).toBe(true)
  })

  it('should handle last piece with odd size', () => {
    const oddSize = BLOCK_SIZE + 100 // 1.x blocks
    const buffer = new PieceBuffer(0, oddSize)

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.isComplete()).toBe(false)

    buffer.addBlock(BLOCK_SIZE, new Uint8Array(100), 'peer1')
    expect(buffer.isComplete()).toBe(true)

    const assembled = buffer.assemble()
    expect(assembled.length).toBe(oddSize)
  })

  it('should report missing blocks', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 4)

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    buffer.addBlock(BLOCK_SIZE * 2, new Uint8Array(BLOCK_SIZE), 'peer1')

    const missing = buffer.getMissingBlocks()
    expect(missing).toEqual([1, 3])
  })

  it('should clear all data', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.blocksReceived).toBe(1)

    buffer.clear()
    expect(buffer.blocksReceived).toBe(0)
    expect(buffer.isComplete()).toBe(false)
  })

  it('should update lastActivity on addBlock', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)
    const initialTime = buffer.lastActivity

    // Wait a tiny bit
    const start = Date.now()
    while (Date.now() - start < 5) {
      // spin
    }

    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.lastActivity).toBeGreaterThanOrEqual(initialTime)
  })
})
