import { describe, it, expect } from 'vitest'
import {
  xorDistance,
  compareDistance,
  getBucketIndex,
  nodeIdToBigInt,
  bigIntToNodeId,
  nodeIdsEqual,
  generateRandomNodeId,
  generateRandomIdInBucket,
  nodeIdToHex,
  hexToNodeId,
} from '../../src/dht/xor-distance'
import { NODE_ID_BYTES } from '../../src/dht/constants'

describe('XOR Distance Utilities', () => {
  // Helper to create a node ID from a hex string (padded to 40 chars)
  function makeId(hexPrefix: string): Uint8Array {
    const padded = hexPrefix.padStart(NODE_ID_BYTES * 2, '0')
    return hexToNodeId(padded)
  }

  describe('xorDistance', () => {
    it('returns zero for identical IDs', () => {
      const id = generateRandomNodeId()
      expect(xorDistance(id, id)).toBe(0n)
    })

    it('is commutative: distance(a,b) === distance(b,a)', () => {
      const a = makeId('0123456789abcdef0123456789abcdef01234567')
      const b = makeId('fedcba9876543210fedcba9876543210fedcba98')

      expect(xorDistance(a, b)).toBe(xorDistance(b, a))
    })

    it('calculates correct distance for known values', () => {
      // IDs differ only in last byte: 0x00 vs 0x01
      const a = makeId('00')
      const b = makeId('01')
      expect(xorDistance(a, b)).toBe(1n)

      // IDs differ only in last byte: 0x00 vs 0xFF
      const c = makeId('00')
      const d = makeId('ff')
      expect(xorDistance(c, d)).toBe(255n)
    })

    it('throws for invalid ID lengths', () => {
      const short = new Uint8Array(19)
      const normal = new Uint8Array(20)

      expect(() => xorDistance(short, normal)).toThrow()
      expect(() => xorDistance(normal, short)).toThrow()
    })
  })

  describe('compareDistance', () => {
    it('returns negative when a is closer to target', () => {
      const target = makeId('10')
      const a = makeId('11') // distance 1
      const b = makeId('20') // distance 0x30 = 48

      expect(compareDistance(a, b, target)).toBeLessThan(0)
    })

    it('returns positive when b is closer to target', () => {
      const target = makeId('10')
      const a = makeId('20') // distance 0x30 = 48
      const b = makeId('11') // distance 1

      expect(compareDistance(a, b, target)).toBeGreaterThan(0)
    })

    it('returns zero when distances are equal', () => {
      const target = makeId('10')
      const a = makeId('11') // distance 1
      const b = makeId('11') // same distance

      expect(compareDistance(a, b, target)).toBe(0)
    })

    it('correctly orders multiple IDs by distance', () => {
      const target = makeId('00')
      const ids = [
        makeId('ff'), // furthest
        makeId('01'), // closest
        makeId('10'), // middle
      ]

      ids.sort((a, b) => compareDistance(a, b, target))

      // Should be sorted closest to furthest
      expect(nodeIdToHex(ids[0]).slice(-2)).toBe('01')
      expect(nodeIdToHex(ids[1]).slice(-2)).toBe('10')
      expect(nodeIdToHex(ids[2]).slice(-2)).toBe('ff')
    })
  })

  describe('getBucketIndex', () => {
    it('returns 159 for 1-bit MSB difference', () => {
      // IDs differ in the most significant bit
      const local = makeId('00'.repeat(20))
      const other = makeId('80' + '00'.repeat(19))

      expect(getBucketIndex(local, other)).toBe(159)
    })

    it('returns 0 for 1-bit LSB difference', () => {
      // IDs differ only in the least significant bit
      const local = makeId('00')
      const other = makeId('01')

      expect(getBucketIndex(local, other)).toBe(0)
    })

    it('returns correct index for various bit positions', () => {
      const local = makeId('00'.repeat(20))

      // Difference in bit 7 (0x80 in last byte)
      expect(getBucketIndex(local, makeId('80'))).toBe(7)

      // Difference in bit 8 (0x01 in second-to-last byte)
      expect(getBucketIndex(local, makeId('0100'))).toBe(8)

      // Difference in bit 15 (0x80 in second-to-last byte)
      expect(getBucketIndex(local, makeId('8000'))).toBe(15)
    })

    it('returns -1 for identical IDs', () => {
      const id = generateRandomNodeId()
      expect(getBucketIndex(id, id)).toBe(-1)
    })

    it('throws for invalid ID lengths', () => {
      const short = new Uint8Array(19)
      const normal = new Uint8Array(20)

      expect(() => getBucketIndex(short, normal)).toThrow()
    })
  })

  describe('nodeIdToBigInt / bigIntToNodeId', () => {
    it('roundtrips correctly', () => {
      const original = generateRandomNodeId()
      const asBigInt = nodeIdToBigInt(original)
      const restored = bigIntToNodeId(asBigInt)

      expect(nodeIdsEqual(original, restored)).toBe(true)
    })

    it('converts known values correctly', () => {
      const id = makeId('ff')
      expect(nodeIdToBigInt(id)).toBe(255n)

      const id2 = makeId('0100')
      expect(nodeIdToBigInt(id2)).toBe(256n)
    })

    it('handles maximum value', () => {
      const maxId = new Uint8Array(20).fill(0xff)
      const asBigInt = nodeIdToBigInt(maxId)
      const expected = (1n << 160n) - 1n

      expect(asBigInt).toBe(expected)
    })
  })

  describe('nodeIdsEqual', () => {
    it('returns true for identical IDs', () => {
      const id = generateRandomNodeId()
      const copy = new Uint8Array(id)

      expect(nodeIdsEqual(id, copy)).toBe(true)
    })

    it('returns false for different IDs', () => {
      const a = makeId('00')
      const b = makeId('01')

      expect(nodeIdsEqual(a, b)).toBe(false)
    })

    it('returns false for different lengths', () => {
      const a = new Uint8Array(20)
      const b = new Uint8Array(19)

      expect(nodeIdsEqual(a, b)).toBe(false)
    })
  })

  describe('generateRandomNodeId', () => {
    it('generates 20-byte IDs', () => {
      const id = generateRandomNodeId()
      expect(id.length).toBe(NODE_ID_BYTES)
    })

    it('generates unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(nodeIdToHex(generateRandomNodeId()))
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('generateRandomIdInBucket', () => {
    it('generates IDs that fall into the correct bucket', () => {
      const localId = generateRandomNodeId()

      for (let bucketIndex = 0; bucketIndex < 160; bucketIndex++) {
        const randomId = generateRandomIdInBucket(bucketIndex, localId)
        const actualBucket = getBucketIndex(localId, randomId)

        // The generated ID should fall into the expected bucket
        expect(actualBucket).toBe(bucketIndex)
      }
    })

    it('throws for invalid bucket indices', () => {
      const localId = generateRandomNodeId()

      expect(() => generateRandomIdInBucket(-1, localId)).toThrow()
      expect(() => generateRandomIdInBucket(160, localId)).toThrow()
    })
  })

  describe('nodeIdToHex / hexToNodeId', () => {
    it('roundtrips correctly', () => {
      const original = generateRandomNodeId()
      const hex = nodeIdToHex(original)
      const restored = hexToNodeId(hex)

      expect(nodeIdsEqual(original, restored)).toBe(true)
    })

    it('produces lowercase hex', () => {
      const id = new Uint8Array(20).fill(0xab)
      const hex = nodeIdToHex(id)

      expect(hex).toBe('ab'.repeat(20))
    })

    it('handles case insensitivity on input', () => {
      const lower = hexToNodeId('ab'.repeat(20))
      const upper = hexToNodeId('AB'.repeat(20))

      expect(nodeIdsEqual(lower, upper)).toBe(true)
    })

    it('throws for invalid hex length', () => {
      expect(() => hexToNodeId('abc')).toThrow()
      expect(() => hexToNodeId('a'.repeat(42))).toThrow()
    })
  })
})
