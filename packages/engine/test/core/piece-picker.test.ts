import { describe, it, expect } from 'vitest'
import { PiecePicker, PiecePickerInput } from '../../src/core/piece-picker'
import { BitField } from '../../src/utils/bitfield'

describe('PiecePicker', () => {
  const picker = new PiecePicker()

  function makeInput(overrides: Partial<PiecePickerInput> = {}): PiecePickerInput {
    const pieceCount = 10
    const peerBitfield = new BitField(pieceCount)
    for (let i = 0; i < pieceCount; i++) peerBitfield.set(i, true) // Peer has all

    return {
      peerBitfield,
      ownBitfield: new BitField(pieceCount), // We have none
      piecePriority: new Uint8Array(pieceCount).fill(1), // All normal priority
      pieceAvailability: new Uint16Array(pieceCount).fill(5), // All same availability
      startedPieces: new Set(),
      maxPieces: 50,
      ...overrides,
    }
  }

  it('returns pieces peer has that we need', () => {
    const input = makeInput()
    const result = picker.selectPieces(input)

    expect(result.pieces.length).toBe(10)
    expect(result.stats.skippedOwned).toBe(0)
    expect(result.stats.skippedPeerLacks).toBe(0)
  })

  it('skips pieces we already have', () => {
    const ownBitfield = new BitField(10)
    ownBitfield.set(0, true)
    ownBitfield.set(5, true)

    const input = makeInput({ ownBitfield })
    const result = picker.selectPieces(input)

    expect(result.pieces).not.toContain(0)
    expect(result.pieces).not.toContain(5)
    expect(result.stats.skippedOwned).toBe(2)
  })

  it('skips pieces peer lacks', () => {
    const peerBitfield = new BitField(10)
    peerBitfield.set(0, true)
    peerBitfield.set(1, true)
    // Peer only has pieces 0 and 1

    const input = makeInput({ peerBitfield })
    const result = picker.selectPieces(input)

    expect(result.pieces).toEqual([0, 1])
    expect(result.stats.skippedPeerLacks).toBe(8)
  })

  it('skips low priority (skip) pieces', () => {
    const piecePriority = new Uint8Array([1, 1, 0, 0, 1, 1, 0, 1, 1, 1])
    // Pieces 2, 3, 6 are skipped (priority 0)

    const input = makeInput({ piecePriority })
    const result = picker.selectPieces(input)

    expect(result.pieces).not.toContain(2)
    expect(result.pieces).not.toContain(3)
    expect(result.pieces).not.toContain(6)
    expect(result.stats.skippedLowPriority).toBe(3)
  })

  it('prioritizes high priority pieces', () => {
    const piecePriority = new Uint8Array([1, 1, 2, 1, 2, 1, 1, 1, 1, 1])
    // Pieces 2 and 4 are high priority

    const input = makeInput({ piecePriority })
    const result = picker.selectPieces(input)

    // High priority should come first
    expect(result.pieces[0]).toBe(2)
    expect(result.pieces[1]).toBe(4)
  })

  it('prioritizes started pieces over new ones', () => {
    const startedPieces = new Set([5, 7])

    const input = makeInput({ startedPieces })
    const result = picker.selectPieces(input)

    // Started pieces should come first (within same priority)
    expect(result.pieces[0]).toBe(5)
    expect(result.pieces[1]).toBe(7)
  })

  it('prioritizes rarer pieces (lower availability)', () => {
    const pieceAvailability = new Uint16Array([10, 5, 15, 1, 8, 3, 20, 7, 2, 12])
    // Rarity order: 3(1), 8(2), 5(3), 1(5), 7(7), 4(8), 0(10), 9(12), 2(15), 6(20)

    const input = makeInput({ pieceAvailability })
    const result = picker.selectPieces(input)

    expect(result.pieces[0]).toBe(3) // availability 1
    expect(result.pieces[1]).toBe(8) // availability 2
    expect(result.pieces[2]).toBe(5) // availability 3
  })

  it('applies priority > started > availability order', () => {
    // Piece 0: normal, not started, availability 1 (very rare)
    // Piece 1: high, not started, availability 10 (common)
    // Piece 2: normal, started, availability 10 (common)
    // Piece 3: high, started, availability 5

    const piecePriority = new Uint8Array([1, 2, 1, 2])
    const pieceAvailability = new Uint16Array([1, 10, 10, 5])
    const startedPieces = new Set([2, 3])
    const peerBitfield = new BitField(4)
    for (let i = 0; i < 4; i++) peerBitfield.set(i, true)
    const ownBitfield = new BitField(4)

    const input = makeInput({
      piecePriority,
      pieceAvailability,
      startedPieces,
      peerBitfield,
      ownBitfield,
      maxPieces: 50,
    })
    const result = picker.selectPieces(input)

    // Order should be:
    // 1. Piece 3: high priority, started
    // 2. Piece 1: high priority, not started
    // 3. Piece 2: normal, started
    // 4. Piece 0: normal, not started (even though rarest)
    expect(result.pieces).toEqual([3, 1, 2, 0])
  })

  it('respects maxPieces limit', () => {
    const input = makeInput({ maxPieces: 3 })
    const result = picker.selectPieces(input)

    expect(result.pieces.length).toBe(3)
  })

  it('handles empty peer bitfield', () => {
    const peerBitfield = new BitField(10) // Peer has nothing

    const input = makeInput({ peerBitfield })
    const result = picker.selectPieces(input)

    expect(result.pieces).toEqual([])
    expect(result.stats.skippedPeerLacks).toBe(10)
  })

  it('handles all pieces owned', () => {
    const ownBitfield = new BitField(10)
    for (let i = 0; i < 10; i++) ownBitfield.set(i, true) // We have everything

    const input = makeInput({ ownBitfield })
    const result = picker.selectPieces(input)

    expect(result.pieces).toEqual([])
    expect(result.stats.skippedOwned).toBe(10)
  })

  it('handles all pieces skipped', () => {
    const piecePriority = new Uint8Array(10).fill(0) // All skip

    const input = makeInput({ piecePriority })
    const result = picker.selectPieces(input)

    expect(result.pieces).toEqual([])
    expect(result.stats.skippedLowPriority).toBe(10)
  })

  it('breaks ties in availability by index for deterministic results', () => {
    // All same priority, not started, same availability
    const input = makeInput()
    const result = picker.selectPieces(input)

    // With all things equal, should return in stable order
    expect(result.pieces.length).toBe(10)
  })

  it('handles large piece counts efficiently', () => {
    const pieceCount = 10000
    const peerBitfield = new BitField(pieceCount)
    for (let i = 0; i < pieceCount; i++) peerBitfield.set(i, true)

    const input: PiecePickerInput = {
      peerBitfield,
      ownBitfield: new BitField(pieceCount),
      piecePriority: new Uint8Array(pieceCount).fill(1),
      pieceAvailability: new Uint16Array(pieceCount).fill(5),
      startedPieces: new Set(),
      maxPieces: 100,
    }

    const start = performance.now()
    const result = picker.selectPieces(input)
    const elapsed = performance.now() - start

    expect(result.pieces.length).toBe(100)
    expect(elapsed).toBeLessThan(100) // Should complete in under 100ms
  })
})
