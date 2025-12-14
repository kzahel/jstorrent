import { describe, it, expect, beforeEach } from 'vitest'
import { EndgameManager } from '../../src/core/endgame-manager'
import { ActivePiece } from '../../src/core/active-piece'

describe('EndgameManager', () => {
  let manager: EndgameManager

  beforeEach(() => {
    manager = new EndgameManager()
  })

  describe('evaluate', () => {
    it('should not enter endgame when download is complete', () => {
      const decision = manager.evaluate(0, 0, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should not enter endgame when not all pieces are active', () => {
      // 5 missing pieces, only 3 active
      const decision = manager.evaluate(5, 3, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should not enter endgame when there are unrequested blocks', () => {
      // All 3 missing pieces are active, but some blocks unrequested
      const decision = manager.evaluate(3, 3, true)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should enter endgame when all conditions met', () => {
      // 3 missing pieces, all active, no unrequested blocks
      const decision = manager.evaluate(3, 3, false)
      expect(decision).toEqual({ type: 'enter_endgame' })
      expect(manager.isEndgame).toBe(true)
    })

    it('should exit endgame when conditions no longer met', () => {
      // Enter endgame
      manager.evaluate(3, 3, false)
      expect(manager.isEndgame).toBe(true)

      // New piece becomes active (peer sent HAVE)
      const decision = manager.evaluate(4, 3, false)
      expect(decision).toEqual({ type: 'exit_endgame' })
      expect(manager.isEndgame).toBe(false)
    })

    it('should return null when state unchanged', () => {
      // Enter endgame
      manager.evaluate(3, 3, false)

      // Same conditions - no change
      const decision = manager.evaluate(3, 3, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(true)
    })
  })

  describe('getCancels', () => {
    it('should return empty when not in endgame', () => {
      const piece = new ActivePiece(0, 32768) // 2 blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')

      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(0)
    })

    it('should return other peers to cancel in endgame', () => {
      // Enter endgame
      manager.evaluate(1, 1, false)

      const piece = new ActivePiece(5, 32768) // 2 blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')
      piece.addRequest(0, 'peer3')

      // peer1 sent the block - cancel peer2 and peer3
      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(2)
      expect(cancels.map((c) => c.peerId).sort()).toEqual(['peer2', 'peer3'])
      expect(cancels[0].index).toBe(5)
      expect(cancels[0].begin).toBe(0)
      expect(cancels[0].length).toBe(16384)
    })

    it('should not include the sender in cancels', () => {
      manager.evaluate(1, 1, false)

      const piece = new ActivePiece(0, 16384) // 1 block
      piece.addRequest(0, 'peer1')

      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(0)
    })
  })

  describe('shouldSendDuplicateRequest', () => {
    it('should return false when not in endgame', () => {
      expect(manager.shouldSendDuplicateRequest(0)).toBe(false)
    })

    it('should respect maxDuplicateRequests config', () => {
      manager.evaluate(1, 1, false) // Enter endgame

      // Default is 3
      expect(manager.shouldSendDuplicateRequest(0)).toBe(true)
      expect(manager.shouldSendDuplicateRequest(2)).toBe(true)
      expect(manager.shouldSendDuplicateRequest(3)).toBe(false)
    })

    it('should allow unlimited with config 0', () => {
      manager.updateConfig({ maxDuplicateRequests: 0 })
      manager.evaluate(1, 1, false)

      expect(manager.shouldSendDuplicateRequest(100)).toBe(true)
    })
  })

  describe('reset', () => {
    it('should exit endgame mode', () => {
      manager.evaluate(1, 1, false)
      expect(manager.isEndgame).toBe(true)

      manager.reset()
      expect(manager.isEndgame).toBe(false)
    })
  })
})
