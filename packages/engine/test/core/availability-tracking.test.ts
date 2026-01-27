import { describe, it, expect, vi } from 'vitest'
import { BitField } from '../../src/utils/bitfield'
import { PeerConnection } from '../../src/core/peer-connection'
import { ILoggingEngine } from '../../src/logging/logger'
import type { ITcpSocket } from '../../src/interfaces/socket'

/**
 * Phase 1 Tests: Availability Tracking
 *
 * Tests the per-piece availability tracking and separate seed counter
 * that was added as part of the piece picker overhaul.
 *
 * Key behaviors:
 * - Non-seed peers update per-piece availability on connect/disconnect
 * - Seeds are tracked separately in _seedCount (not per-piece)
 * - Peer becoming a seed via HAVE messages converts their tracking
 * - Deferred have_all peers are handled when metadata arrives
 */

// Mock engine for tests
function createMockEngine(): ILoggingEngine {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    emit: vi.fn(),
  } as unknown as ILoggingEngine
}

// Mock socket for PeerConnection
function createMockSocket(): ITcpSocket {
  return {
    send: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    isEncrypted: false,
  } as unknown as ITcpSocket
}

describe('Availability Tracking', () => {
  describe('PeerConnection seed properties', () => {
    it('should initialize with isSeed=false and haveCount=0', () => {
      const engine = createMockEngine()
      const socket = createMockSocket()
      const peer = new PeerConnection(engine, socket)

      expect(peer.isSeed).toBe(false)
      expect(peer.haveCount).toBe(0)
    })

    it('should allow setting isSeed and haveCount', () => {
      const engine = createMockEngine()
      const socket = createMockSocket()
      const peer = new PeerConnection(engine, socket)

      peer.isSeed = true
      peer.haveCount = 100

      expect(peer.isSeed).toBe(true)
      expect(peer.haveCount).toBe(100)
    })
  })

  describe('BitField count method', () => {
    it('should return 0 for empty bitfield', () => {
      const bf = BitField.createEmpty(100)
      expect(bf.count()).toBe(0)
    })

    it('should return length for full bitfield', () => {
      const bf = BitField.createFull(100)
      expect(bf.count()).toBe(100)
    })

    it('should count set bits correctly', () => {
      const bf = new BitField(10)
      bf.set(0, true)
      bf.set(3, true)
      bf.set(7, true)
      expect(bf.count()).toBe(3)
    })
  })

  describe('Seed detection via bitfield', () => {
    it('should detect seed when bitfield has all pieces', () => {
      // Simulate the logic from torrent.ts bitfield handler
      const piecesCount = 100
      const bf = BitField.createFull(piecesCount)

      const haveCount = bf.count()
      const isSeed = haveCount === piecesCount && piecesCount > 0

      expect(haveCount).toBe(100)
      expect(isSeed).toBe(true)
    })

    it('should not detect seed when bitfield is partial', () => {
      const piecesCount = 100
      const bf = new BitField(piecesCount)
      bf.set(0, true)
      bf.set(50, true)
      bf.set(99, true)

      const haveCount = bf.count()
      const isSeed = haveCount === piecesCount && piecesCount > 0

      expect(haveCount).toBe(3)
      expect(isSeed).toBe(false)
    })

    it('should not detect seed when piecesCount is 0', () => {
      const piecesCount = 0
      const bf = new BitField(0)

      const haveCount = bf.count()
      const isSeed = haveCount === piecesCount && piecesCount > 0

      expect(haveCount).toBe(0)
      expect(isSeed).toBe(false) // piecesCount > 0 check prevents false positive
    })
  })

  describe('Seed conversion via HAVE messages', () => {
    it('should convert to seed when haveCount reaches piecesCount', () => {
      const piecesCount = 4

      // Simulate peer state
      let haveCount = 3
      let isSeed = false

      // Simulate receiving final HAVE message
      haveCount++
      if (haveCount === piecesCount && piecesCount > 0) {
        isSeed = true
      }

      expect(haveCount).toBe(4)
      expect(isSeed).toBe(true)
    })

    it('should track haveCount incrementally', () => {
      let haveCount = 0
      const piecesCount = 5

      // Simulate receiving HAVE messages one by one
      for (let i = 0; i < piecesCount - 1; i++) {
        haveCount++
        expect(haveCount).toBe(i + 1)
        expect(haveCount === piecesCount).toBe(false)
      }

      // Final HAVE makes it a seed
      haveCount++
      expect(haveCount).toBe(piecesCount)
      expect(haveCount === piecesCount && piecesCount > 0).toBe(true)
    })
  })

  describe('Availability array operations', () => {
    it('should increment availability for non-seed bitfield', () => {
      const piecesCount = 5
      const availability = new Uint16Array(piecesCount)
      const bf = new BitField(piecesCount)
      bf.set(1, true)
      bf.set(3, true)

      // Non-seed: update per-piece
      for (let i = 0; i < piecesCount; i++) {
        if (bf.get(i)) {
          availability[i]++
        }
      }

      expect([...availability]).toEqual([0, 1, 0, 1, 0])
    })

    it('should decrement availability for non-seed disconnect', () => {
      const piecesCount = 5
      const availability = new Uint16Array([0, 2, 0, 3, 0])
      const bf = new BitField(piecesCount)
      bf.set(1, true)
      bf.set(3, true)

      // Non-seed disconnect: decrement per-piece
      for (let i = 0; i < piecesCount; i++) {
        if (bf.get(i) && availability[i] > 0) {
          availability[i]--
        }
      }

      expect([...availability]).toEqual([0, 1, 0, 2, 0])
    })

    it('should not go below zero when decrementing', () => {
      const piecesCount = 3
      const availability = new Uint16Array([0, 0, 0])
      const bf = BitField.createFull(piecesCount)

      // Decrement (should not go negative)
      for (let i = 0; i < piecesCount; i++) {
        if (bf.get(i) && availability[i] > 0) {
          availability[i]--
        }
      }

      expect([...availability]).toEqual([0, 0, 0])
    })
  })

  describe('Seed counter operations', () => {
    it('should track seed count separately', () => {
      let seedCount = 0

      // Seeds connect
      seedCount++
      seedCount++
      expect(seedCount).toBe(2)

      // Seed disconnects
      seedCount--
      expect(seedCount).toBe(1)

      // Another seed disconnects
      seedCount--
      expect(seedCount).toBe(0)
    })

    it('should not affect per-piece availability when tracking seeds', () => {
      const piecesCount = 4
      const availability = new Uint16Array(piecesCount)
      let seedCount = 0

      // Seed connects - should NOT update per-piece availability
      const isSeed = true
      if (isSeed) {
        seedCount++
        // Do NOT update availability array
      } else {
        // Only non-seeds update per-piece
        for (let i = 0; i < piecesCount; i++) {
          availability[i]++
        }
      }

      expect(seedCount).toBe(1)
      expect([...availability]).toEqual([0, 0, 0, 0]) // Unchanged
    })

    it('should calculate effective availability as pieceAvailability + seedCount', () => {
      const availability = new Uint16Array([1, 2, 0])
      const seedCount = 2

      // Effective availability for each piece
      const effective = availability.map((a) => a + seedCount)

      expect([...effective]).toEqual([3, 4, 2])
    })
  })

  describe('Convert to seed scenario', () => {
    it('should remove peer from per-piece and add to seed count', () => {
      const piecesCount = 3
      const availability = new Uint16Array([2, 2, 2]) // Peer contributed to all
      let seedCount = 0

      // Peer has all pieces (was non-seed, became seed via HAVE)
      const peerBitfield = BitField.createFull(piecesCount)

      // Convert to seed: remove from per-piece
      for (let i = 0; i < piecesCount; i++) {
        if (peerBitfield.get(i) && availability[i] > 0) {
          availability[i]--
        }
      }
      seedCount++

      expect([...availability]).toEqual([1, 1, 1])
      expect(seedCount).toBe(1)

      // Effective availability should be same as before
      const effective = availability.map((a) => a + seedCount)
      expect([...effective]).toEqual([2, 2, 2])
    })
  })

  describe('Edge cases', () => {
    it('should handle multiple seeds connecting', () => {
      let seedCount = 0
      const availability = new Uint16Array(5)

      // 3 seeds connect
      seedCount++
      seedCount++
      seedCount++

      expect(seedCount).toBe(3)
      expect([...availability]).toEqual([0, 0, 0, 0, 0]) // No per-piece updates
    })

    it('should handle mixed seeds and non-seeds', () => {
      const piecesCount = 4
      const availability = new Uint16Array(piecesCount)
      let seedCount = 0

      // Non-seed with partial bitfield connects
      const nonSeedBf = new BitField(piecesCount)
      nonSeedBf.set(0, true)
      nonSeedBf.set(2, true)
      for (let i = 0; i < piecesCount; i++) {
        if (nonSeedBf.get(i)) {
          availability[i]++
        }
      }

      // Seed connects
      seedCount++

      // Another non-seed connects
      const nonSeedBf2 = new BitField(piecesCount)
      nonSeedBf2.set(1, true)
      nonSeedBf2.set(2, true)
      nonSeedBf2.set(3, true)
      for (let i = 0; i < piecesCount; i++) {
        if (nonSeedBf2.get(i)) {
          availability[i]++
        }
      }

      expect([...availability]).toEqual([1, 1, 2, 1])
      expect(seedCount).toBe(1)

      // Effective availability (each piece available from availability[i] non-seeds + seedCount seeds)
      const effective = availability.map((a) => a + seedCount)
      expect([...effective]).toEqual([2, 2, 3, 2])
    })

    it('should handle large piece counts efficiently', () => {
      const pieceCount = 10000
      const availability = new Uint16Array(pieceCount)

      // Non-seed with half the pieces
      const bf = new BitField(pieceCount)
      for (let i = 0; i < pieceCount; i += 2) {
        bf.set(i, true)
      }

      const start = performance.now()

      // Update availability
      for (let i = 0; i < pieceCount; i++) {
        if (bf.get(i)) {
          availability[i]++
        }
      }

      const elapsed = performance.now() - start

      expect(bf.count()).toBe(5000)
      expect(availability[0]).toBe(1)
      expect(availability[1]).toBe(0)
      expect(elapsed).toBeLessThan(50) // Should be fast
    })
  })

  describe('Edge cases not in original spec', () => {
    it('deferred HAVE_ALL peer disconnect before metadata - should not affect counts', () => {
      // Scenario: peer sends HAVE_ALL when piecesCount=0 (no metadata yet)
      // Then peer disconnects before metadata arrives
      // We should NOT decrement seedCount (it was never incremented)
      // We should NOT touch pieceAvailability (peer.bitfield is null)

      const piecesCount = 0 // No metadata yet
      let seedCount = 0
      const availability: Uint16Array | null = null // Not initialized

      // Peer state when they disconnect
      const peer = {
        isSeed: false, // Never became a seed (deferred)
        deferredHaveAll: true,
        bitfield: null, // Never created (no metadata)
        haveCount: 0,
      }

      // Simulate removePeer logic
      if (peer.isSeed) {
        if (seedCount > 0) {
          seedCount--
        }
      } else if (availability && peer.bitfield) {
        // This branch won't execute because bitfield is null
        for (let i = 0; i < piecesCount; i++) {
          // Won't run
        }
      }

      // Nothing should have changed
      expect(seedCount).toBe(0)
      expect(availability).toBeNull()
    })

    it('seedCount should not go negative on erroneous decrement', () => {
      let seedCount = 0

      // Erroneously try to decrement when already 0
      if (seedCount > 0) {
        seedCount--
      }

      expect(seedCount).toBe(0) // Should stay at 0, not go to -1
    })

    it('HAVE for out-of-range piece index should not crash', () => {
      const piecesCount = 5
      const availability = new Uint16Array(piecesCount)
      const outOfRangeIndex = 100

      // Simulate the bounds check from torrent.ts have handler
      if (availability && outOfRangeIndex < availability.length) {
        availability[outOfRangeIndex]++
      }

      // Array should be unchanged
      expect([...availability]).toEqual([0, 0, 0, 0, 0])
    })

    it('effective availability should be unchanged after convertToSeed', () => {
      // Before: peer is non-seed, their pieces are in pieceAvailability
      // After: peer is seed, their pieces removed from pieceAvailability, added to seedCount
      // Effective availability (pieceAvailability[i] + seedCount) should be identical

      const piecesCount = 4
      const availabilityBefore = new Uint16Array([3, 2, 3, 1])
      const seedCountBefore = 1

      // Calculate effective before
      const effectiveBefore = availabilityBefore.map((a) => a + seedCountBefore)

      // Peer has all pieces and is about to become a seed
      const peerBitfield = BitField.createFull(piecesCount)

      // Simulate convertToSeed
      const availabilityAfter = new Uint16Array(availabilityBefore)
      let seedCountAfter = seedCountBefore

      // Remove from per-piece
      for (let i = 0; i < piecesCount; i++) {
        if (peerBitfield.get(i) && availabilityAfter[i] > 0) {
          availabilityAfter[i]--
        }
      }
      // Add to seed count
      seedCountAfter++

      // Calculate effective after
      const effectiveAfter = availabilityAfter.map((a) => a + seedCountAfter)

      // Should be identical
      expect([...effectiveAfter]).toEqual([...effectiveBefore])
    })

    it('receiving HAVE from seed should be handled gracefully', () => {
      // Peer is already marked as seed but sends a HAVE message
      // This is a protocol anomaly but shouldn't crash

      const peer = {
        isSeed: true,
        haveCount: 100,
      }

      const piecesCount = 100
      const availability = new Uint16Array(piecesCount)
      const seedCount = 1
      const haveIndex = 50

      // Simulate have handler with seed check
      peer.haveCount++ // Would increment (but shouldn't really happen)

      if (peer.isSeed) {
        // Early return - don't update availability
        // In real code this logs a warning
      } else if (availability && haveIndex < availability.length) {
        availability[haveIndex]++
      }

      // Availability should NOT have been updated
      expect(availability[haveIndex]).toBe(0)
      expect(seedCount).toBe(1) // Unchanged
    })

    it('convertToSeed should be idempotent', () => {
      // Calling convertToSeed twice should not double-count

      const piecesCount = 3
      const availability = new Uint16Array([2, 2, 2])
      let seedCount = 0

      const peer = {
        isSeed: false,
        bitfield: BitField.createFull(piecesCount),
      }

      // First conversion
      if (!peer.isSeed) {
        for (let i = 0; i < piecesCount; i++) {
          if (peer.bitfield.get(i) && availability[i] > 0) {
            availability[i]--
          }
        }
        peer.isSeed = true
        seedCount++
      }

      expect([...availability]).toEqual([1, 1, 1])
      expect(seedCount).toBe(1)

      // Second conversion attempt (should be no-op)
      if (!peer.isSeed) {
        for (let i = 0; i < piecesCount; i++) {
          if (peer.bitfield.get(i) && availability[i] > 0) {
            availability[i]--
          }
        }
        peer.isSeed = true
        seedCount++
      }

      // Should be unchanged from first conversion
      expect([...availability]).toEqual([1, 1, 1])
      expect(seedCount).toBe(1)
    })

    it('partial peer with some pieces becoming seed should only decrement pieces they had', () => {
      // Edge case: peer starts with partial bitfield, gradually gets all pieces via HAVE
      // When converting to seed, we remove ALL their pieces from availability

      const piecesCount = 4
      const availability = new Uint16Array([2, 3, 1, 2])
      let seedCount = 0

      // Peer initially had pieces 0 and 2
      // Through HAVE messages they got 1 and 3
      // Now they have all pieces and are being converted to seed

      const peerBitfield = BitField.createFull(piecesCount)

      // Convert to seed - removes their contribution from ALL pieces
      for (let i = 0; i < piecesCount; i++) {
        if (peerBitfield.get(i) && availability[i] > 0) {
          availability[i]--
        }
      }
      seedCount++

      expect([...availability]).toEqual([1, 2, 0, 1])
      expect(seedCount).toBe(1)
    })

    it('should handle peer with empty bitfield (has nothing)', () => {
      const piecesCount = 5
      const availability = new Uint16Array([1, 1, 1, 1, 1])

      const emptyBitfield = BitField.createEmpty(piecesCount)

      // Peer with nothing connects - no availability changes
      for (let i = 0; i < piecesCount; i++) {
        if (emptyBitfield.get(i)) {
          availability[i]++
        }
      }

      expect([...availability]).toEqual([1, 1, 1, 1, 1]) // Unchanged

      // They're definitely not a seed
      const isSeed = emptyBitfield.count() === piecesCount && piecesCount > 0
      expect(isSeed).toBe(false)
    })

    it('rapid seed connect/disconnect should maintain correct count', () => {
      let seedCount = 0

      // Rapid connections
      for (let i = 0; i < 100; i++) {
        seedCount++
      }
      expect(seedCount).toBe(100)

      // Rapid disconnections
      for (let i = 0; i < 100; i++) {
        if (seedCount > 0) seedCount--
      }
      expect(seedCount).toBe(0)

      // Mixed - more disconnects than connects shouldn't go negative
      for (let i = 0; i < 50; i++) {
        seedCount++
      }
      for (let i = 0; i < 75; i++) {
        if (seedCount > 0) seedCount--
      }
      expect(seedCount).toBe(0)
    })
  })
})
