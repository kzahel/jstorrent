/**
 * XOR Distance Utilities for DHT
 *
 * In Kademlia, the distance metric is XOR interpreted as an unsigned integer.
 * distance(A, B) = |A xor B|
 * Smaller values are closer.
 *
 * Reference: BEP 5 - "In Kademlia, the distance metric is XOR and the result
 * is interpreted as an unsigned integer."
 */

import { NODE_ID_BYTES, NODE_ID_BITS } from './constants'

/**
 * Calculate XOR distance between two node IDs as a bigint.
 *
 * @param a - First node ID (20 bytes)
 * @param b - Second node ID (20 bytes)
 * @returns XOR distance as bigint (smaller = closer)
 */
export function xorDistance(a: Uint8Array, b: Uint8Array): bigint {
  if (a.length !== NODE_ID_BYTES || b.length !== NODE_ID_BYTES) {
    throw new Error(`Node IDs must be ${NODE_ID_BYTES} bytes`)
  }

  let result = 0n
  for (let i = 0; i < NODE_ID_BYTES; i++) {
    result = (result << 8n) | BigInt(a[i] ^ b[i])
  }
  return result
}

/**
 * Compare which of two node IDs is closer to a target.
 *
 * @param a - First node ID
 * @param b - Second node ID
 * @param target - Target ID to measure distance to
 * @returns Negative if a is closer, positive if b is closer, 0 if equal
 */
export function compareDistance(a: Uint8Array, b: Uint8Array, target: Uint8Array): number {
  const distA = xorDistance(a, target)
  const distB = xorDistance(b, target)

  if (distA < distB) return -1
  if (distA > distB) return 1
  return 0
}

/**
 * Get the bucket index for a node relative to our local ID.
 *
 * The bucket index is determined by the position of the first differing bit
 * between the local ID and the node ID. This is equivalent to floor(log2(xor_distance)).
 *
 * - Bucket 0: IDs that differ only in the LSB (furthest, most specific)
 * - Bucket 159: IDs that differ in the MSB (closest to half the keyspace)
 *
 * Note: This returns -1 if the IDs are identical (which shouldn't happen
 * for different nodes but is handled for safety).
 *
 * @param localId - Our node ID
 * @param nodeId - The node ID to find the bucket for
 * @returns Bucket index (0-159), or -1 if IDs are identical
 */
export function getBucketIndex(localId: Uint8Array, nodeId: Uint8Array): number {
  if (localId.length !== NODE_ID_BYTES || nodeId.length !== NODE_ID_BYTES) {
    throw new Error(`Node IDs must be ${NODE_ID_BYTES} bytes`)
  }

  // Find the first differing byte
  for (let i = 0; i < NODE_ID_BYTES; i++) {
    const xor = localId[i] ^ nodeId[i]
    if (xor !== 0) {
      // Find the position of the most significant bit in this byte
      const bitPos = 7 - Math.clz32(xor) + 24 // clz32 counts leading zeros in 32-bit
      // Convert to bucket index (0 = LSB differs, 159 = MSB differs)
      return (NODE_ID_BYTES - 1 - i) * 8 + bitPos
    }
  }

  // IDs are identical
  return -1
}

/**
 * Convert a Uint8Array node ID to a bigint.
 * Useful for bucket range comparisons.
 */
export function nodeIdToBigInt(id: Uint8Array): bigint {
  if (id.length !== NODE_ID_BYTES) {
    throw new Error(`Node ID must be ${NODE_ID_BYTES} bytes`)
  }

  let result = 0n
  for (let i = 0; i < NODE_ID_BYTES; i++) {
    result = (result << 8n) | BigInt(id[i])
  }
  return result
}

/**
 * Convert a bigint to a 20-byte node ID.
 */
export function bigIntToNodeId(value: bigint): Uint8Array {
  const result = new Uint8Array(NODE_ID_BYTES)
  let remaining = value

  for (let i = NODE_ID_BYTES - 1; i >= 0; i--) {
    result[i] = Number(remaining & 0xffn)
    remaining = remaining >> 8n
  }

  return result
}

/**
 * Check if two node IDs are equal.
 */
export function nodeIdsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Generate a random node ID.
 * Used for generating our own ID on first startup.
 */
export function generateRandomNodeId(): Uint8Array {
  const id = new Uint8Array(NODE_ID_BYTES)
  crypto.getRandomValues(id)
  return id
}

/**
 * Generate a random ID within a bucket's range.
 * Used for bucket refresh (find_node with random target in bucket).
 *
 * @param bucketIndex - The bucket index (0-159)
 * @param localId - Our local node ID
 * @returns A random node ID that would fall into the given bucket
 */
export function generateRandomIdInBucket(bucketIndex: number, localId: Uint8Array): Uint8Array {
  if (bucketIndex < 0 || bucketIndex >= NODE_ID_BITS) {
    throw new Error(`Bucket index must be 0-${NODE_ID_BITS - 1}`)
  }

  // Start with our local ID
  const result = new Uint8Array(localId)

  // The bucket index tells us which bit position should be the first difference
  // We need to flip that bit and randomize all less significant bits
  const byteIndex = NODE_ID_BYTES - 1 - Math.floor(bucketIndex / 8)
  const bitIndex = bucketIndex % 8

  // Flip the bit at the bucket boundary
  result[byteIndex] ^= 1 << bitIndex

  // Randomize all less significant bits
  for (let i = byteIndex + 1; i < NODE_ID_BYTES; i++) {
    result[i] = Math.floor(Math.random() * 256)
  }

  // Randomize less significant bits in the boundary byte
  const mask = (1 << bitIndex) - 1
  result[byteIndex] = (result[byteIndex] & ~mask) | (Math.floor(Math.random() * 256) & mask)

  return result
}

/**
 * Convert node ID to hex string for display/logging.
 */
export function nodeIdToHex(id: Uint8Array): string {
  return Array.from(id)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert hex string to node ID.
 */
export function hexToNodeId(hex: string): Uint8Array {
  if (hex.length !== NODE_ID_BYTES * 2) {
    throw new Error(`Hex string must be ${NODE_ID_BYTES * 2} characters`)
  }

  const result = new Uint8Array(NODE_ID_BYTES)
  for (let i = 0; i < NODE_ID_BYTES; i++) {
    result[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return result
}
