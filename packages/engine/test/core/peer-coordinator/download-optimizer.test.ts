import { describe, it, expect, beforeEach } from 'vitest'
import { DownloadOptimizer } from '../../../src/core/peer-coordinator/download-optimizer'
import { DownloadPeerSnapshot } from '../../../src/core/peer-coordinator/types'

describe('DownloadOptimizer', () => {
  let clock: number
  const fakeClock = () => clock

  beforeEach(() => {
    clock = 0
  })

  // ---------------------------------------------------------------------------
  // Protected peers
  // ---------------------------------------------------------------------------

  describe('protected peers', () => {
    it('should never recommend dropping protected peers', () => {
      const optimizer = new DownloadOptimizer(
        { minConnectionAgeMs: 0, minPeersBeforeDropping: 0 },
        fakeClock,
      )
      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'protected_slow',
          peerChoking: false,
          downloadRate: 1,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'unprotected_fast',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const protectedIds = new Set(['protected_slow'])
      const decisions = optimizer.evaluate(peers, protectedIds, true)

      const droppedIds = decisions.map((d) => d.peerId)
      expect(droppedIds).not.toContain('protected_slow')
    })
  })

  // ---------------------------------------------------------------------------
  // Choked timeout
  // ---------------------------------------------------------------------------

  describe('choked timeout', () => {
    it('should drop peers choked with no data for too long', () => {
      const optimizer = new DownloadOptimizer(
        { chokedTimeoutMs: 60000, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      clock = 70000 // 70 seconds
      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'choked_stale',
          peerChoking: true,
          downloadRate: 0,
          connectedAt: 0,
          lastDataReceived: 0,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'choked_stale', reason: 'choked_timeout' })
    })

    it('should not drop choked peers who recently sent data', () => {
      const optimizer = new DownloadOptimizer(
        { chokedTimeoutMs: 60000, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      clock = 70000
      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'choked_recent',
          peerChoking: true,
          downloadRate: 0,
          connectedAt: 0,
          lastDataReceived: 50000,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Speed thresholds
  // ---------------------------------------------------------------------------

  describe('speed thresholds', () => {
    it('should drop peers below minimum speed', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'too_slow',
          peerChoking: false,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast_enough',
          peerChoking: false,
          downloadRate: 5000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'too_slow', reason: 'too_slow' })
      expect(decisions.map((d) => d.peerId)).not.toContain('fast_enough')
    })

    it('should not judge peers until minimum connection age', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 15000, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      clock = 10000 // Only 10 seconds
      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'new_slow',
          peerChoking: false,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)

      // After 15 seconds, should be judged
      clock = 20000
      const decisions2 = optimizer.evaluate(peers, new Set(), true)
      expect(decisions2).toContainEqual({ peerId: 'new_slow', reason: 'too_slow' })
    })

    it('should drop peers way below average', () => {
      const optimizer = new DownloadOptimizer(
        {
          dropBelowAverageRatio: 0.1,
          minSpeedBytes: 0,
          minConnectionAgeMs: 0,
          minPeersBeforeDropping: 0,
        },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'fast1',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast2',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'slow',
          peerChoking: false,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        }, // 1% of avg
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toContainEqual({ peerId: 'slow', reason: 'below_average' })
    })
  })

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  describe('guards', () => {
    it('should not drop anyone if below minimum peer count', () => {
      const optimizer = new DownloadOptimizer(
        { minPeersBeforeDropping: 4, minSpeedBytes: 1000, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'slow1',
          peerChoking: false,
          downloadRate: 1,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'slow2',
          peerChoking: false,
          downloadRate: 1,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), true)
      expect(decisions).toHaveLength(0)
    })

    it('should not drop anyone if no swarm candidates available', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'slow',
          peerChoking: false,
          downloadRate: 1,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast1',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast2',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast3',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast4',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      const decisions = optimizer.evaluate(peers, new Set(), false) // No candidates
      expect(decisions).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Rate limiting context (skipSpeedChecks)
  // ---------------------------------------------------------------------------

  describe('rate limiting context', () => {
    it('should skip too_slow check when skipSpeedChecks is true', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'slow_peer',
          peerChoking: false,
          downloadRate: 100, // Below minSpeedBytes
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'another_peer',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
      ]

      // Without context - should drop slow peer
      const decisions1 = optimizer.evaluate(peers, new Set(), true)
      expect(decisions1).toContainEqual({ peerId: 'slow_peer', reason: 'too_slow' })

      // With skipSpeedChecks - should NOT drop slow peer
      const decisions2 = optimizer.evaluate(peers, new Set(), true, { skipSpeedChecks: true })
      expect(decisions2).toHaveLength(0)
    })

    it('should skip below_average check when skipSpeedChecks is true', () => {
      const optimizer = new DownloadOptimizer(
        {
          dropBelowAverageRatio: 0.1,
          minSpeedBytes: 0,
          minConnectionAgeMs: 0,
          minPeersBeforeDropping: 0,
        },
        fakeClock,
      )

      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'fast1',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'fast2',
          peerChoking: false,
          downloadRate: 10000,
          connectedAt: 0,
          lastDataReceived: clock,
        },
        {
          id: 'slow',
          peerChoking: false,
          downloadRate: 100,
          connectedAt: 0,
          lastDataReceived: clock,
        }, // 1% of avg
      ]

      // Without context - should drop slow peer for below_average
      const decisions1 = optimizer.evaluate(peers, new Set(), true)
      expect(decisions1).toContainEqual({ peerId: 'slow', reason: 'below_average' })

      // With skipSpeedChecks - should NOT drop
      const decisions2 = optimizer.evaluate(peers, new Set(), true, { skipSpeedChecks: true })
      expect(decisions2).toHaveLength(0)
    })

    it('should still enforce choked_timeout when skipSpeedChecks is true', () => {
      const optimizer = new DownloadOptimizer(
        { chokedTimeoutMs: 60000, minPeersBeforeDropping: 0 },
        fakeClock,
      )

      clock = 70000 // 70 seconds
      const peers: DownloadPeerSnapshot[] = [
        {
          id: 'choked_stale',
          peerChoking: true,
          downloadRate: 0,
          connectedAt: 0,
          lastDataReceived: 0,
        },
      ]

      // Even with skipSpeedChecks, choked_timeout should still work
      const decisions = optimizer.evaluate(peers, new Set(), true, { skipSpeedChecks: true })
      expect(decisions).toContainEqual({ peerId: 'choked_stale', reason: 'choked_timeout' })
    })

    it('should work with shouldDrop method as well', () => {
      const optimizer = new DownloadOptimizer(
        { minSpeedBytes: 1000, minConnectionAgeMs: 0 },
        fakeClock,
      )

      const slowPeer: DownloadPeerSnapshot = {
        id: 'slow_peer',
        peerChoking: false,
        downloadRate: 100,
        connectedAt: 0,
        lastDataReceived: clock,
      }

      // Without context - should recommend dropping
      const decision1 = optimizer.shouldDrop(slowPeer, new Set(), 10000, true)
      expect(decision1).toEqual({ peerId: 'slow_peer', reason: 'too_slow' })

      // With skipSpeedChecks - should NOT recommend dropping
      const decision2 = optimizer.shouldDrop(slowPeer, new Set(), 10000, true, {
        skipSpeedChecks: true,
      })
      expect(decision2).toBeNull()
    })
  })
})
