import { describe, it, expect, beforeEach } from 'vitest'
import { UnchokeAlgorithm } from '../../../src/core/peer-coordinator/unchoke-algorithm'
import { UnchokePeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('UnchokeAlgorithm', () => {
  let clock: number
  const fakeClock = () => clock
  const fakeRandom = () => 0.5 // Deterministic for testing

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Anti-fibrillation
  // ---------------------------------------------------------------------------

  describe('anti-fibrillation', () => {
    it('should not produce decisions before 10 second interval', () => {
      const algo = new UnchokeAlgorithm({}, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
      ]

      // First call produces decisions
      const first = algo.evaluate(peers)
      expect(first.length).toBeGreaterThan(0)

      // 5 seconds later: no decisions
      clock = 5000
      const second = algo.evaluate(peers)
      expect(second).toHaveLength(0)

      // 9.9 seconds: still no decisions
      clock = 9900
      const third = algo.evaluate(peers)
      expect(third).toHaveLength(0)

      // 10 seconds: should evaluate
      clock = 10000
      algo.evaluate(peers)
      // May or may not have decisions depending on state, but DID evaluate
      expect(algo.getState().lastChokeEvaluation).toBe(10000)
    })
  })

  // ---------------------------------------------------------------------------
  // Slot cap
  // ---------------------------------------------------------------------------

  describe('slot cap', () => {
    it('should never unchoke more than maxUploadSlots interested peers', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const unchokes = decisions.filter((d) => d.action === 'unchoke')
      expect(unchokes.length).toBeLessThanOrEqual(4)
    })

    it('should respect custom maxUploadSlots', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 5 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const unchokes = decisions.filter((d) => d.action === 'unchoke')
      expect(unchokes.length).toBeLessThanOrEqual(2)
    })

    it('should only unchoke interested peers', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        {
          id: 'interested1',
          peerInterested: true,
          amChoking: true,
          downloadRate: 1000,
          connectedAt: 0,
        },
        {
          id: 'not_interested',
          peerInterested: false,
          amChoking: true,
          downloadRate: 9000,
          connectedAt: 0,
        },
        {
          id: 'interested2',
          peerInterested: true,
          amChoking: true,
          downloadRate: 500,
          connectedAt: 0,
        },
      ]

      const decisions = algo.evaluate(peers)
      const unchokedIds = decisions.filter((d) => d.action === 'unchoke').map((d) => d.peerId)

      expect(unchokedIds).toContain('interested1')
      expect(unchokedIds).toContain('interested2')
      expect(unchokedIds).not.toContain('not_interested')
    })
  })

  // ---------------------------------------------------------------------------
  // Tit-for-tat
  // ---------------------------------------------------------------------------

  describe('tit-for-tat', () => {
    it('should unchoke top 3 peers by download rate for tit-for-tat slots', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'slow', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'medium', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
        { id: 'faster', peerInterested: true, amChoking: true, downloadRate: 900, connectedAt: 0 },
        { id: 'fastest', peerInterested: true, amChoking: true, downloadRate: 1100, connectedAt: 0 },
      ]

      const decisions = algo.evaluate(peers)
      const titForTat = decisions.filter((d) => d.action === 'unchoke' && d.reason === 'tit_for_tat')
      const titForTatIds = titForTat.map((d) => d.peerId)

      // Top 3 should be fastest, fast, faster
      expect(titForTatIds).toContain('fastest')
      expect(titForTatIds).toContain('fast')
      expect(titForTatIds).toContain('faster')
      expect(titForTatIds).not.toContain('slow')
      expect(titForTatIds).not.toContain('medium')
    })

    it('should choke peers who fall out of top 3', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)

      // Round 1: A, B, C are fastest (3 tit-for-tat slots)
      // E gets the optimistic slot, D is choked
      const peers1: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 900, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: true, downloadRate: 800, connectedAt: 0 },
        { id: 'D', peerInterested: true, amChoking: true, downloadRate: 100, connectedAt: 0 },
        { id: 'E', peerInterested: true, amChoking: true, downloadRate: 50, connectedAt: 0 },
      ]

      const round1 = algo.evaluate(peers1)
      // Verify D is NOT unchoked in round 1 (E gets optimistic slot via random selection)
      const round1Unchoked = round1.filter((d) => d.action === 'unchoke').map((d) => d.peerId)
      // D should not be in the unchoked set
      expect(round1Unchoked).not.toContain('D')

      // Round 2: D gets fast, A slows down
      clock = 10000
      const peers2: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: false, downloadRate: 50, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: false, downloadRate: 900, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: false, downloadRate: 800, connectedAt: 0 },
        { id: 'D', peerInterested: true, amChoking: true, downloadRate: 2000, connectedAt: 0 },
        { id: 'E', peerInterested: true, amChoking: false, downloadRate: 50, connectedAt: 0 },
      ]

      const decisions = algo.evaluate(peers2)

      // A should be choked (fell out of top 3), D should be unchoked (now in top 3)
      expect(decisions).toContainEqual({ peerId: 'A', action: 'choke', reason: 'replaced' })
      expect(decisions).toContainEqual({ peerId: 'D', action: 'unchoke', reason: 'tit_for_tat' })
    })
  })

  // ---------------------------------------------------------------------------
  // Optimistic unchoke
  // ---------------------------------------------------------------------------

  describe('optimistic unchoke', () => {
    it('should have exactly one optimistic unchoke slot', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 4 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
        id: `peer${i}`,
        peerInterested: true,
        amChoking: true,
        downloadRate: i * 100,
        connectedAt: 0,
      }))

      const decisions = algo.evaluate(peers)
      const optimistic = decisions.filter((d) => d.action === 'unchoke' && d.reason === 'optimistic')
      expect(optimistic).toHaveLength(1)
    })

    it('should rotate optimistic peer every 30 seconds', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'slow1', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        { id: 'slow2', peerInterested: true, amChoking: true, downloadRate: 20, connectedAt: 0 },
        { id: 'slow3', peerInterested: true, amChoking: true, downloadRate: 30, connectedAt: 0 },
      ]

      // First evaluation
      algo.evaluate(peers)
      const firstOptimistic = algo.getState().optimisticPeerId

      // 10 seconds: no rotation
      clock = 10000
      algo.evaluate(peers.map((p) => ({ ...p, amChoking: !algo.getProtectedPeers().has(p.id) })))
      expect(algo.getState().optimisticPeerId).toBe(firstOptimistic)

      // 30 seconds: rotation
      clock = 30000
      algo.evaluate(peers.map((p) => ({ ...p, amChoking: !algo.getProtectedPeers().has(p.id) })))
      // Optimistic might be the same or different depending on random selection
      // But lastOptimisticRotation should update
      expect(algo.getState().lastOptimisticRotation).toBe(30000)
    })

    it('should weight new peers 3x for optimistic selection', () => {
      // Use deterministic random that cycles through values
      let randomCalls = 0
      const cyclicRandom = () => {
        const values = [0.1, 0.3, 0.5, 0.7, 0.9]
        return values[randomCalls++ % values.length]
      }

      const algo = new UnchokeAlgorithm(
        { maxUploadSlots: 2, newPeerThresholdMs: 60000 },
        fakeClock,
        cyclicRandom,
      )

      clock = 100000 // Well past new peer threshold

      const peers: UnchokePeerSnapshot[] = [
        { id: 'fast', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'old', peerInterested: true, amChoking: true, downloadRate: 10, connectedAt: 0 },
        {
          id: 'new',
          peerInterested: true,
          amChoking: true,
          downloadRate: 20,
          connectedAt: clock - 1000,
        }, // New peer
      ]

      // Run multiple times and count how often new peer is selected
      let newSelected = 0
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        algo.reset()
        randomCalls = i // Vary starting point
        algo.evaluate(peers)
        if (algo.getState().optimisticPeerId === 'new') {
          newSelected++
        }
      }

      // With 3x weight, new peer should be selected ~75% of the time (3 out of 4 weighted slots)
      // Allow for some variance
      expect(newSelected).toBeGreaterThan(iterations * 0.5)
    })
  })

  // ---------------------------------------------------------------------------
  // Protected peers
  // ---------------------------------------------------------------------------

  describe('protected peers', () => {
    it('should track unchoked peers as protected', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
        { id: 'C', peerInterested: true, amChoking: true, downloadRate: 100, connectedAt: 0 },
      ]

      algo.evaluate(peers)
      const protected_ = algo.getProtectedPeers()

      expect(protected_.size).toBeLessThanOrEqual(2)
      // A should definitely be protected (highest rate)
      expect(protected_.has('A')).toBe(true)
    })

    it('should remove peer from protected when they disconnect', () => {
      const algo = new UnchokeAlgorithm({ maxUploadSlots: 2 }, fakeClock, fakeRandom)
      const peers: UnchokePeerSnapshot[] = [
        { id: 'A', peerInterested: true, amChoking: true, downloadRate: 1000, connectedAt: 0 },
        { id: 'B', peerInterested: true, amChoking: true, downloadRate: 500, connectedAt: 0 },
      ]

      algo.evaluate(peers)
      expect(algo.getProtectedPeers().has('A')).toBe(true)

      algo.peerDisconnected('A')
      expect(algo.getProtectedPeers().has('A')).toBe(false)
    })
  })
})
