import { describe, it, expect, beforeEach } from 'vitest'
import {
  CorruptionTracker,
  CorruptionTrackerConfig,
  SwarmHealth,
} from '../../src/core/corruption-tracker'

describe('CorruptionTracker', () => {
  let tracker: CorruptionTracker
  const healthySwarm: SwarmHealth = { connected: 20, total: 50 }
  const sparseSwarm: SwarmHealth = { connected: 3, total: 5 }

  beforeEach(() => {
    tracker = new CorruptionTracker()
  })

  describe('basic tracking', () => {
    it('should not ban on single failure', () => {
      const decisions = tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)

      expect(decisions).toHaveLength(0)
      expect(tracker.getSuspicionScore('peerA')).toBeGreaterThan(0)
      expect(tracker.getSuspicionScore('peerA')).toBeLessThan(0.5)
    })

    it('should track failure history', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.recordHashFailure(5, ['peerA', 'peerC'], healthySwarm)

      const history = tracker.getFailureHistory('peerA')
      expect(history).toHaveLength(2)
      expect(history.map((f) => f.pieceIndex)).toEqual([0, 5])
    })

    it('should handle empty contributors', () => {
      const decisions = tracker.recordHashFailure(0, [], healthySwarm)
      expect(decisions).toHaveLength(0)
    })

    it('should not duplicate same piece failure', () => {
      // Use 2 contributors to test tracking (sole contributor triggers immediate ban)
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm) // Same piece

      const history = tracker.getFailureHistory('peerA')
      expect(history).toHaveLength(1)
    })
  })

  describe('ban decisions with healthy swarm', () => {
    it('should ban peer with 2 failures in healthy swarm', () => {
      // peerA contributes to two failed pieces with different co-contributors
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      const decisions = tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)

      expect(decisions).toHaveLength(1)
      expect(decisions[0].peerId).toBe('peerA')
      expect(decisions[0].failureCount).toBe(2)
      expect(decisions[0].reason).toContain('corrupt data')
    })

    it('should ban multiple peers if both hit threshold', () => {
      // Both peerA and peerB fail with different partners
      tracker.recordHashFailure(0, ['peerA', 'peerX'], healthySwarm)
      tracker.recordHashFailure(1, ['peerA', 'peerY'], healthySwarm)
      tracker.recordHashFailure(2, ['peerB', 'peerX'], healthySwarm)
      const decisions = tracker.recordHashFailure(3, ['peerB', 'peerZ'], healthySwarm)

      const bannedIds = decisions.map((d) => d.peerId)
      expect(bannedIds).toContain('peerB')
    })

    it('should increase confidence with more failures', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      const score1 = tracker.getSuspicionScore('peerA')

      tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)
      const score2 = tracker.getSuspicionScore('peerA')

      tracker.recordHashFailure(2, ['peerA', 'peerD'], healthySwarm)
      const score3 = tracker.getSuspicionScore('peerA')

      expect(score2).toBeGreaterThan(score1)
      expect(score3).toBeGreaterThan(score2)
    })
  })

  describe('swarm health affects threshold', () => {
    it('should calculate effective min failures based on swarm health', () => {
      // healthySwarmSize=10, min=2, max=5
      // healthy (20 peers): ratio=1, effective=2
      // sparse (3 peers): ratio=0.3, effective=5-0.3*3=4.1 -> 5
      expect(tracker.getEffectiveMinFailures(healthySwarm)).toBe(2)
      expect(tracker.getEffectiveMinFailures(sparseSwarm)).toBe(5)
    })

    it('should require more failures in sparse swarm', () => {
      // 2 failures should NOT ban in sparse swarm (needs 5)
      tracker.recordHashFailure(0, ['peerA', 'peerB'], sparseSwarm)
      const decisions = tracker.recordHashFailure(1, ['peerA', 'peerC'], sparseSwarm)

      expect(decisions).toHaveLength(0)
    })

    it('should eventually ban in sparse swarm with enough failures', () => {
      // Sparse swarm needs 5 failures
      tracker.recordHashFailure(0, ['peerA', 'peerB'], sparseSwarm)
      tracker.recordHashFailure(1, ['peerA', 'peerC'], sparseSwarm)
      tracker.recordHashFailure(2, ['peerA', 'peerD'], sparseSwarm)
      tracker.recordHashFailure(3, ['peerA', 'peerE'], sparseSwarm)
      const decisions = tracker.recordHashFailure(4, ['peerA', 'peerF'], sparseSwarm)

      expect(decisions.some((d) => d.peerId === 'peerA')).toBe(true)
    })

    it('should have lower confidence for same failures in sparse vs healthy swarm', () => {
      const trackerHealthy = new CorruptionTracker()
      const trackerSparse = new CorruptionTracker()

      // Same failures in both
      trackerHealthy.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      trackerHealthy.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)

      trackerSparse.recordHashFailure(0, ['peerA', 'peerB'], sparseSwarm)
      trackerSparse.recordHashFailure(1, ['peerA', 'peerC'], sparseSwarm)

      const confHealthy = trackerHealthy.getBanConfidence('peerA', healthySwarm)
      const confSparse = trackerSparse.getBanConfidence('peerA', sparseSwarm)

      // Healthy swarm should have confidence (met threshold), sparse should have 0
      expect(confHealthy).toBeGreaterThan(0)
      expect(confSparse).toBe(0) // Sparse hasn't met threshold yet
    })
  })

  describe('co-contributor diversity', () => {
    it('should boost confidence when co-contributors are diverse', () => {
      // peerA fails with many different co-contributors
      tracker.recordHashFailure(0, ['peerA', 'peerX'], healthySwarm)
      tracker.recordHashFailure(1, ['peerA', 'peerY'], healthySwarm)
      tracker.recordHashFailure(2, ['peerA', 'peerZ'], healthySwarm)
      const scoreA = tracker.getSuspicionScore('peerA')

      // peerB fails with the same co-contributor each time
      const tracker2 = new CorruptionTracker()
      tracker2.recordHashFailure(0, ['peerB', 'peerX'], healthySwarm)
      tracker2.recordHashFailure(1, ['peerB', 'peerX'], healthySwarm)
      tracker2.recordHashFailure(2, ['peerB', 'peerX'], healthySwarm)
      const scoreB = tracker2.getSuspicionScore('peerB')

      // peerA should have higher score (more diverse co-contributors = stronger signal)
      expect(scoreA).toBeGreaterThan(scoreB)
    })

    it('should track unique co-contributors correctly', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB', 'peerC'], healthySwarm)
      tracker.recordHashFailure(1, ['peerA', 'peerD'], healthySwarm)

      const suspicion = tracker.getAllSuspicions().get('peerA')
      expect(suspicion?.coContributors.size).toBe(3) // peerB, peerC, peerD
      expect(suspicion?.coContributors.has('peerB')).toBe(true)
      expect(suspicion?.coContributors.has('peerC')).toBe(true)
      expect(suspicion?.coContributors.has('peerD')).toBe(true)
    })
  })

  describe('time-based pruning', () => {
    it('should prune old failures', () => {
      const config: Partial<CorruptionTrackerConfig> = {
        failureWindowMs: 1000, // 1 second window for testing
      }
      tracker = new CorruptionTracker(config)

      const now = 10000
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm, now)

      // After window expires, new failure should prune old one
      tracker.recordHashFailure(1, ['peerC'], healthySwarm, now + 2000)

      expect(tracker.getFailureHistory('peerA')).toHaveLength(0)
      expect(tracker.getSuspicionScore('peerA')).toBe(0)
    })

    it('should keep recent failures', () => {
      const config: Partial<CorruptionTrackerConfig> = {
        failureWindowMs: 10000,
      }
      tracker = new CorruptionTracker(config)

      const now = 10000
      // Use 2 contributors to test tracking (sole contributor triggers immediate ban)
      tracker.recordHashFailure(0, ['peerA', 'peerX'], healthySwarm, now)
      tracker.recordHashFailure(1, ['peerA', 'peerY'], healthySwarm, now + 5000)

      expect(tracker.getFailureHistory('peerA')).toHaveLength(2)
    })

    it('should rebuild co-contributors after pruning', () => {
      const config: Partial<CorruptionTrackerConfig> = {
        failureWindowMs: 1000,
      }
      tracker = new CorruptionTracker(config)

      const now = 10000
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm, now)
      tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm, now + 800) // Within window

      // Trigger pruning - first failure (piece 0) should be removed, second kept
      tracker.recordHashFailure(2, ['peerD'], healthySwarm, now + 1200)

      const suspicion = tracker.getAllSuspicions().get('peerA')
      expect(suspicion).toBeDefined()
      // Only peerC should remain (peerB was from pruned failure)
      expect(suspicion!.coContributors.has('peerB')).toBe(false)
      expect(suspicion!.coContributors.has('peerC')).toBe(true)
    })
  })

  describe('removePeer', () => {
    it('should remove peer from tracking', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.removePeer('peerA')

      expect(tracker.getFailureHistory('peerA')).toHaveLength(0)
      expect(tracker.getSuspicionScore('peerA')).toBe(0)
    })

    it('should remove peer from co-contributors of other peers', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.removePeer('peerA')

      const suspicion = tracker.getAllSuspicions().get('peerB')
      expect(suspicion?.coContributors.has('peerA')).toBe(false)
    })
  })

  describe('reset', () => {
    it('should clear all tracking data', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.recordHashFailure(1, ['peerC', 'peerD'], healthySwarm)

      tracker.reset()

      expect(tracker.getAllSuspicions().size).toBe(0)
      expect(tracker.getSuspicionScore('peerA')).toBe(0)
    })
  })

  describe('configuration', () => {
    it('should respect minFailuresForBan', () => {
      tracker = new CorruptionTracker({ minFailuresForBan: 3 })

      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      let decisions = tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)
      expect(decisions).toHaveLength(0) // 2 failures, needs 3

      decisions = tracker.recordHashFailure(2, ['peerA', 'peerD'], healthySwarm)
      expect(decisions.some((d) => d.peerId === 'peerA')).toBe(true) // Now has 3
    })

    it('should respect custom healthySwarmSize', () => {
      // With healthySwarmSize=50, a 20-peer swarm is "unhealthy"
      // ratio = 20/50 = 0.4, effectiveMin = 5 - 0.4*3 = 3.8 -> 4
      tracker = new CorruptionTracker({ healthySwarmSize: 50 })

      expect(tracker.getEffectiveMinFailures(healthySwarm)).toBe(4) // Not 2

      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      const decisions = tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)

      // Should require more failures since 20 < 50 means "unhealthy"
      expect(decisions).toHaveLength(0)
    })
  })

  describe('ban decision details', () => {
    it('should include useful information in ban reason', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      const decisions = tracker.recordHashFailure(5, ['peerA', 'peerC'], healthySwarm)

      expect(decisions).toHaveLength(1)
      const decision = decisions[0]
      expect(decision.reason).toContain('corrupt data')
      expect(decision.reason).toContain('2 failed pieces')
      expect(decision.reason).toContain('0, 5') // piece indices
      expect(decision.reason).toContain('swarm: 20/50')
    })

    it('should report confidence between 0 and 1', () => {
      tracker.recordHashFailure(0, ['peerA', 'peerB'], healthySwarm)
      tracker.recordHashFailure(1, ['peerA', 'peerC'], healthySwarm)
      tracker.recordHashFailure(2, ['peerA', 'peerD'], healthySwarm)
      const decisions = tracker.recordHashFailure(3, ['peerA', 'peerE'], healthySwarm)

      const decision = decisions.find((d) => d.peerId === 'peerA')
      expect(decision?.confidence).toBeGreaterThan(0)
      expect(decision?.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('edge cases', () => {
    it('should immediately ban sole contributor (proof of guilt)', () => {
      // If a peer is the ONLY contributor to a failed piece, that's proof - not evidence
      const decisions = tracker.recordHashFailure(0, ['peerA'], healthySwarm)

      expect(decisions).toHaveLength(1)
      expect(decisions[0].peerId).toBe('peerA')
      expect(decisions[0].confidence).toBe(1.0)
      expect(decisions[0].reason).toContain('sole contributor')
    })

    it('should handle many contributors to single piece', () => {
      const manyPeers = Array.from({ length: 10 }, (_, i) => `peer${i}`)
      const decisions = tracker.recordHashFailure(0, manyPeers, healthySwarm)

      // Single failure shouldn't ban anyone
      expect(decisions).toHaveLength(0)

      // All peers should have same suspicion score
      const scores = manyPeers.map((p) => tracker.getSuspicionScore(p))
      expect(new Set(scores).size).toBe(1)
    })

    it('should handle very tiny swarm (2 peers)', () => {
      const tinySwarm: SwarmHealth = { connected: 2, total: 2 }

      tracker.recordHashFailure(0, ['peerA', 'peerB'], tinySwarm)
      let decisions = tracker.recordHashFailure(1, ['peerA', 'peerB'], tinySwarm)

      // Even with 2 failures, should be very cautious in tiny swarm
      expect(decisions).toHaveLength(0)

      // Eventually should ban
      decisions = tracker.recordHashFailure(2, ['peerA', 'peerB'], tinySwarm)
      decisions = tracker.recordHashFailure(3, ['peerA', 'peerB'], tinySwarm)
      decisions = tracker.recordHashFailure(4, ['peerA', 'peerB'], tinySwarm)

      // At some point one or both get banned
      expect(decisions.length).toBeGreaterThan(0)
    })
  })
})
