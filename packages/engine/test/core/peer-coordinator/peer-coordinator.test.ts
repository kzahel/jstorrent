import { describe, it, expect, beforeEach } from 'vitest'
import { PeerCoordinator } from '../../../src/core/peer-coordinator/peer-coordinator'
import { PeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('PeerCoordinator', () => {
  let clock: number
  const fakeClock = () => clock
  const fakeRandom = () => 0.5

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Integration: Unchoke + Download Optimizer
  // ---------------------------------------------------------------------------

  describe('algorithm coordination', () => {
    it('should run unchoke first, then optimizer respects protected set', () => {
      const coordinator = new PeerCoordinator(
        { maxUploadSlots: 2 },
        { minSpeedBytes: 500, minConnectionAgeMs: 0, minPeersBeforeDropping: 0 },
        fakeClock,
        fakeRandom,
      )

      const peers: PeerSnapshot[] = [
        // Fast peer - will get tit-for-tat slot
        {
          id: 'fast',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        // Slow interested peer - will get optimistic slot
        {
          id: 'slow_uploader',
          peerInterested: true,
          peerChoking: true,
          amChoking: true,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        // Slow peer not interested (no upload slot, will be dropped)
        {
          id: 'slow_no_slot',
          peerInterested: false,
          peerChoking: false,
          amChoking: true,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const { drop } = coordinator.evaluate(peers, true)

      // fast and slow_uploader should be protected (2 upload slots)
      expect(coordinator.isProtected('fast')).toBe(true)
      expect(coordinator.isProtected('slow_uploader')).toBe(true)

      // slow_uploader should NOT be dropped (protected)
      const dropped = drop.map((d) => d.peerId)
      expect(dropped).not.toContain('slow_uploader')
      expect(dropped).not.toContain('fast')

      // slow_no_slot SHOULD be dropped (not protected, too slow)
      expect(dropped).toContain('slow_no_slot')
    })

    it('should update protected set when upload slots change', () => {
      const coordinator = new PeerCoordinator(
        { maxUploadSlots: 3 }, // Use 3 slots: 2 tit-for-tat + 1 optimistic
        { minConnectionAgeMs: 0 },
        fakeClock,
        fakeRandom,
      )

      // Round 1: A and B are fastest, C gets optimistic
      const peers1: PeerSnapshot[] = [
        {
          id: 'A',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 1000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'B',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 900,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'C',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      coordinator.evaluate(peers1, true)
      // A, B get tit-for-tat slots; C gets optimistic
      expect(coordinator.isProtected('A')).toBe(true)
      expect(coordinator.isProtected('B')).toBe(true)
      expect(coordinator.isProtected('C')).toBe(true)

      // Round 2: C gets fast, A slows down
      clock = 15000
      const peers2: PeerSnapshot[] = [
        {
          id: 'A',
          peerInterested: true,
          peerChoking: false,
          amChoking: false,
          downloadRate: 50, // Now slowest
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'B',
          peerInterested: true,
          peerChoking: false,
          amChoking: false,
          downloadRate: 900,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'C',
          peerInterested: true,
          peerChoking: false,
          amChoking: false,
          downloadRate: 2000, // Now fastest
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      coordinator.evaluate(peers2, true)
      // Now C and B are fastest, A is optimistic candidate
      // C takes top tit-for-tat, B takes second, A becomes optimistic
      // Since optimistic doesn't rotate until 30s, the same optimistic (C) is kept if valid
      // But C is now in tit-for-tat! So A becomes new optimistic
      expect(coordinator.isProtected('A')).toBe(true) // Optimistic
      expect(coordinator.isProtected('B')).toBe(true) // Tit-for-tat
      expect(coordinator.isProtected('C')).toBe(true) // Tit-for-tat
    })
  })

  // ---------------------------------------------------------------------------
  // Peer disconnect
  // ---------------------------------------------------------------------------

  describe('peer disconnect', () => {
    it('should remove peer from protected set on disconnect', () => {
      const coordinator = new PeerCoordinator({ maxUploadSlots: 2 }, {}, fakeClock, fakeRandom)

      const peers: PeerSnapshot[] = [
        {
          id: 'A',
          peerInterested: true,
          peerChoking: false,
          amChoking: true,
          downloadRate: 1000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      coordinator.evaluate(peers, true)
      expect(coordinator.isProtected('A')).toBe(true)

      coordinator.peerDisconnected('A')
      expect(coordinator.isProtected('A')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Config updates
  // ---------------------------------------------------------------------------

  describe('configuration', () => {
    it('should support runtime config updates', () => {
      const coordinator = new PeerCoordinator({}, {}, fakeClock, fakeRandom)

      coordinator.updateUnchokeConfig({ maxUploadSlots: 8 })
      coordinator.updateDownloadConfig({ minSpeedBytes: 5000 })

      const config = coordinator.getConfig()
      expect(config.unchoke.maxUploadSlots).toBe(8)
      expect(config.download.minSpeedBytes).toBe(5000)
    })
  })
})
