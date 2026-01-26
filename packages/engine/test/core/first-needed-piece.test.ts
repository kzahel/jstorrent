import { describe, test, expect, beforeEach } from 'vitest'
import { BitField } from '../../src/utils/bitfield'

/**
 * Test the firstNeededPiece optimization logic in isolation.
 * This mirrors the implementation in Torrent class.
 */
describe('firstNeededPiece optimization', () => {
  let bitfield: BitField
  let firstNeededPiece: number
  const pieceCount = 100

  function markPieceVerified(index: number) {
    bitfield.set(index, true)
    // Advance firstNeededPiece if this was it (or earlier)
    if (index <= firstNeededPiece) {
      while (firstNeededPiece < pieceCount && bitfield.get(firstNeededPiece)) {
        firstNeededPiece++
      }
    }
  }

  function recalculateFirstNeededPiece() {
    firstNeededPiece = 0
    while (firstNeededPiece < pieceCount && bitfield.get(firstNeededPiece)) {
      firstNeededPiece++
    }
  }

  beforeEach(() => {
    bitfield = new BitField(pieceCount)
    firstNeededPiece = 0
  })

  test('starts at 0 for empty bitfield', () => {
    expect(firstNeededPiece).toBe(0)
  })

  test('advances when completing piece 0', () => {
    markPieceVerified(0)
    expect(firstNeededPiece).toBe(1)
  })

  test('advances through consecutive completions', () => {
    markPieceVerified(0)
    markPieceVerified(1)
    markPieceVerified(2)
    expect(firstNeededPiece).toBe(3)
  })

  test('does not advance for non-consecutive completion', () => {
    markPieceVerified(5)
    expect(firstNeededPiece).toBe(0) // Still 0 because piece 0 not complete
  })

  test('advances past gap when gap is filled', () => {
    // Complete pieces 0, 1, 3 (leaving gap at 2)
    markPieceVerified(0)
    markPieceVerified(1)
    markPieceVerified(3)
    expect(firstNeededPiece).toBe(2) // Stuck at gap

    // Fill the gap
    markPieceVerified(2)
    expect(firstNeededPiece).toBe(4) // Now advances past all completed
  })

  test('handles completing piece before current firstNeededPiece', () => {
    // Complete pieces out of order
    markPieceVerified(0)
    markPieceVerified(1)
    expect(firstNeededPiece).toBe(2)

    // Complete piece 2 and 3
    markPieceVerified(3)
    expect(firstNeededPiece).toBe(2) // Still at 2

    markPieceVerified(2)
    expect(firstNeededPiece).toBe(4) // Now at 4
  })

  test('recalculate works for restored bitfield', () => {
    // Simulate restoring a 50% complete bitfield
    for (let i = 0; i < 50; i++) {
      bitfield.set(i)
    }
    recalculateFirstNeededPiece()
    expect(firstNeededPiece).toBe(50)
  })

  test('recalculate handles fully complete bitfield', () => {
    for (let i = 0; i < pieceCount; i++) {
      bitfield.set(i)
    }
    recalculateFirstNeededPiece()
    expect(firstNeededPiece).toBe(pieceCount)
  })

  test('recalculate handles sparse bitfield', () => {
    // Complete every other piece
    for (let i = 0; i < pieceCount; i += 2) {
      bitfield.set(i)
    }
    recalculateFirstNeededPiece()
    expect(firstNeededPiece).toBe(1) // First incomplete is piece 1
  })
})
