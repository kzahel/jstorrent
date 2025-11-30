import { describe, it, expect } from 'vitest'
import { PieceManager } from '../../src/core/piece-manager'
import { BitField } from '../../src/utils/bitfield'

import { MockEngine } from '../utils/mock-engine'

// Mock torrent with just the bitfield property needed by PieceManager
function createMockTorrent(pieceCount: number) {
  let bitfield: BitField | undefined
  return {
    get bitfield() {
      return bitfield
    },
    initBitfield(count: number) {
      bitfield = new BitField(count)
    },
  }
}

describe('PieceManager', () => {
  const engine = new MockEngine()

  it('should initialize correctly', () => {
    const mockTorrent = createMockTorrent(10)
    mockTorrent.initBitfield(10)
    const pm = new PieceManager(engine, mockTorrent as any, 10, 16384, 16384)
    expect(pm.isComplete()).toBe(false)
    expect(pm.getProgress()).toBe(0)
    expect(pm.getMissingPieces().length).toBe(10)
  })

  it('should track pieces', () => {
    const mockTorrent = createMockTorrent(10)
    mockTorrent.initBitfield(10)
    const pm = new PieceManager(engine, mockTorrent as any, 10, 16384, 16384)
    pm.setPiece(0, true)

    expect(pm.hasPiece(0)).toBe(true)
    expect(pm.hasPiece(1)).toBe(false)
    expect(pm.getProgress()).toBe(0.1)
  })

  it('should detect completion', () => {
    const mockTorrent = createMockTorrent(2)
    mockTorrent.initBitfield(2)
    const pm = new PieceManager(engine, mockTorrent as any, 2, 16384, 16384)
    pm.setPiece(0, true)
    expect(pm.isComplete()).toBe(false)

    pm.setPiece(1, true)
    expect(pm.isComplete()).toBe(true)
  })

  it('should return missing pieces', () => {
    const mockTorrent = createMockTorrent(5)
    mockTorrent.initBitfield(5)
    const pm = new PieceManager(engine, mockTorrent as any, 5, 16384, 16384)
    pm.setPiece(0, true)
    pm.setPiece(2, true)
    pm.setPiece(4, true)

    expect(pm.getMissingPieces()).toEqual([1, 3])
  })
})
