import { describe, it, expect } from 'vitest'
import { PieceManager } from '../../src/core/piece-manager'

describe('PieceManager', () => {
  it('should initialize correctly', () => {
    const pm = new PieceManager(10)
    expect(pm.isComplete()).toBe(false)
    expect(pm.getProgress()).toBe(0)
    expect(pm.getMissingPieces().length).toBe(10)
  })

  it('should track pieces', () => {
    const pm = new PieceManager(10)
    pm.setPiece(0, true)

    expect(pm.hasPiece(0)).toBe(true)
    expect(pm.hasPiece(1)).toBe(false)
    expect(pm.getProgress()).toBe(0.1)
  })

  it('should detect completion', () => {
    const pm = new PieceManager(2)
    pm.setPiece(0, true)
    expect(pm.isComplete()).toBe(false)

    pm.setPiece(1, true)
    expect(pm.isComplete()).toBe(true)
  })

  it('should return missing pieces', () => {
    const pm = new PieceManager(5)
    pm.setPiece(0, true)
    pm.setPiece(2, true)
    pm.setPiece(4, true)

    expect(pm.getMissingPieces()).toEqual([1, 3])
  })
})
