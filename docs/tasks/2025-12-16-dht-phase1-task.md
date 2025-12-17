# DHT Phase 1: XOR Distance & Routing Table - Agent Task

**Status:** Ready for Implementation  
**Estimated Complexity:** Medium  
**Prerequisites:** None (foundational phase)

---

## Overview

Implement the core data structures for DHT node organization: XOR distance calculations and the K-bucket routing table. These form the foundation for all subsequent DHT operations.

**Goal:** Create fully tested, type-safe implementations of:
1. Type definitions (`types.ts`)
2. Protocol constants (`constants.ts`)  
3. XOR distance utilities (`xor-distance.ts`)
4. K-bucket routing table (`routing-table.ts`)

**Reference:** BEP 5 specification at `beps_md/accepted/bep_0005.md`

---

## File Structure

Create the following files:

```
packages/engine/src/dht/
├── index.ts                 # Public exports
├── types.ts                 # Interfaces and type definitions
├── constants.ts             # Protocol constants
├── xor-distance.ts          # XOR distance utilities
└── routing-table.ts         # K-bucket routing table

packages/engine/test/dht/
├── xor-distance.test.ts     # XOR distance tests
└── routing-table.test.ts    # Routing table tests
```

---

## Phase 1.1: Create Type Definitions

### File: `packages/engine/src/dht/types.ts`

```typescript
/**
 * DHT Type Definitions
 * 
 * Based on BEP 5: DHT Protocol
 * Reference: beps_md/accepted/bep_0005.md
 */

/**
 * A DHT node (not to be confused with a BitTorrent peer).
 * Nodes participate in the DHT, storing peer information.
 */
export interface DHTNode {
  /** 20-byte node ID (same space as infohashes) */
  id: Uint8Array
  /** IPv4 or IPv6 address */
  host: string
  /** UDP port */
  port: number
  /** Timestamp when we last received a valid response from this node */
  lastSeen?: number
  /** Timestamp when we last sent a query to this node */
  lastQueried?: number
}

/**
 * A K-bucket in the routing table.
 * Each bucket covers a range of the 160-bit ID space.
 */
export interface Bucket {
  /** Minimum ID in this bucket's range (inclusive) */
  min: bigint
  /** Maximum ID in this bucket's range (exclusive) */
  max: bigint
  /** Nodes in this bucket, ordered by last seen (oldest first) */
  nodes: DHTNode[]
  /** Timestamp when this bucket last changed */
  lastChanged: number
}

/**
 * Serializable routing table state for persistence.
 */
export interface RoutingTableState {
  /** Our node ID in hex */
  nodeId: string
  /** All nodes from all buckets */
  nodes: Array<{
    id: string
    host: string
    port: number
  }>
}

/**
 * Events emitted by the routing table.
 */
export interface RoutingTableEvents {
  /**
   * Emitted when a bucket is full and the least recently seen node
   * should be pinged to verify it's still alive.
   */
  ping: (node: DHTNode) => void
  
  /**
   * Emitted when a node is added to the routing table.
   */
  nodeAdded: (node: DHTNode) => void
  
  /**
   * Emitted when a node is removed from the routing table.
   */
  nodeRemoved: (node: DHTNode) => void
}

/**
 * Compact peer info: 6 bytes (4 IP + 2 port)
 */
export interface CompactPeer {
  host: string
  port: number
}

/**
 * Compact node info: 26 bytes (20 ID + 6 peer)
 */
export interface CompactNodeInfo {
  id: Uint8Array
  host: string
  port: number
}
```

---

## Phase 1.2: Create Constants

### File: `packages/engine/src/dht/constants.ts`

```typescript
/**
 * DHT Protocol Constants
 * 
 * Based on BEP 5: DHT Protocol
 * Reference: beps_md/accepted/bep_0005.md
 */

/** 
 * K: Maximum nodes per bucket and replication factor.
 * From BEP 5: "Each bucket can only hold K nodes, currently eight"
 */
export const K = 8

/**
 * Alpha: Number of parallel queries during lookup.
 * Standard Kademlia value for concurrent queries.
 */
export const ALPHA = 3

/**
 * Node ID size in bytes (160 bits = 20 bytes).
 * Same as infohash size.
 */
export const NODE_ID_BYTES = 20

/**
 * Node ID size in bits.
 */
export const NODE_ID_BITS = 160

/**
 * Query timeout in milliseconds.
 * Time to wait for a response before considering the query failed.
 */
export const QUERY_TIMEOUT_MS = 5000

/**
 * Bucket refresh interval in milliseconds (15 minutes).
 * From BEP 5: "Buckets that have not been changed in 15 minutes should be refreshed"
 */
export const BUCKET_REFRESH_MS = 15 * 60 * 1000

/**
 * Node becomes questionable after this many milliseconds of inactivity.
 * From BEP 5: "After 15 minutes of inactivity, a node becomes questionable"
 */
export const NODE_QUESTIONABLE_MS = 15 * 60 * 1000

/**
 * Token rotation interval in milliseconds (5 minutes).
 * From BEP 5: "a secret that changes every five minutes"
 */
export const TOKEN_ROTATION_MS = 5 * 60 * 1000

/**
 * Maximum token age in milliseconds (10 minutes).
 * From BEP 5: "tokens up to ten minutes old are accepted"
 */
export const TOKEN_MAX_AGE_MS = 10 * 60 * 1000

/**
 * Compact peer info size in bytes (4 IP + 2 port).
 */
export const COMPACT_PEER_BYTES = 6

/**
 * Compact node info size in bytes (20 ID + 6 peer).
 */
export const COMPACT_NODE_BYTES = 26

/**
 * Client version string for KRPC messages.
 * "JS" = JSTorrent, "01" = version 0.1
 */
export const CLIENT_VERSION = new Uint8Array([0x4a, 0x53, 0x30, 0x31]) // "JS01"

/**
 * Maximum ID value (2^160 - 1) as bigint.
 */
export const MAX_NODE_ID = (1n << 160n) - 1n
```

---

## Phase 1.3: Implement XOR Distance Utilities

### File: `packages/engine/src/dht/xor-distance.ts`

```typescript
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
  result[byteIndex] ^= (1 << bitIndex)
  
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
    .map(b => b.toString(16).padStart(2, '0'))
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
```

---

## Phase 1.4: Implement Routing Table

### File: `packages/engine/src/dht/routing-table.ts`

```typescript
/**
 * K-Bucket Routing Table for DHT
 * 
 * The routing table covers the entire 160-bit ID space and is subdivided into
 * buckets. Each bucket can hold up to K (8) nodes. When a bucket containing
 * our own ID is full, it splits into two.
 * 
 * Reference: BEP 5 - Routing Table section
 */

import { EventEmitter } from '../utils/event-emitter'
import { DHTNode, Bucket, RoutingTableState, RoutingTableEvents } from './types'
import { K, NODE_ID_BITS, NODE_QUESTIONABLE_MS, MAX_NODE_ID } from './constants'
import {
  xorDistance,
  compareDistance,
  getBucketIndex,
  nodeIdToBigInt,
  bigIntToNodeId,
  nodeIdsEqual,
  nodeIdToHex,
  hexToNodeId,
} from './xor-distance'

export class RoutingTable extends EventEmitter<RoutingTableEvents> {
  /** Our local node ID */
  private readonly localId: Uint8Array
  /** K-buckets covering the ID space */
  private buckets: Bucket[]
  
  constructor(localId: Uint8Array) {
    super()
    
    if (localId.length !== 20) {
      throw new Error('Local ID must be 20 bytes')
    }
    
    this.localId = localId
    
    // Start with a single bucket covering the entire ID space
    this.buckets = [{
      min: 0n,
      max: MAX_NODE_ID + 1n, // Exclusive upper bound
      nodes: [],
      lastChanged: Date.now(),
    }]
  }
  
  /**
   * Get our local node ID.
   */
  getLocalId(): Uint8Array {
    return this.localId
  }
  
  /**
   * Add or update a node in the routing table.
   * 
   * If the node already exists, it's moved to the tail (most recently seen).
   * If the bucket is full and can be split (contains our ID), split it.
   * If the bucket is full and can't be split, emit 'ping' event for LRU node.
   * 
   * @param node - The node to add
   * @returns true if the node was added/updated, false if bucket is full
   */
  addNode(node: DHTNode): boolean {
    // Don't add ourselves
    if (nodeIdsEqual(node.id, this.localId)) {
      return false
    }
    
    const bucket = this.findBucket(node.id)
    
    // Check if node already exists in bucket
    const existingIndex = bucket.nodes.findIndex(n => nodeIdsEqual(n.id, node.id))
    
    if (existingIndex !== -1) {
      // Move to tail (most recently seen) and update
      const existing = bucket.nodes.splice(existingIndex, 1)[0]
      existing.host = node.host
      existing.port = node.port
      existing.lastSeen = node.lastSeen ?? Date.now()
      bucket.nodes.push(existing)
      bucket.lastChanged = Date.now()
      return true
    }
    
    // Node doesn't exist - try to add it
    if (bucket.nodes.length < K) {
      // Bucket has space
      const newNode: DHTNode = {
        ...node,
        lastSeen: node.lastSeen ?? Date.now(),
      }
      bucket.nodes.push(newNode)
      bucket.lastChanged = Date.now()
      this.emit('nodeAdded', newNode)
      return true
    }
    
    // Bucket is full - check if we can split
    if (this.canSplit(bucket)) {
      this.splitBucket(bucket)
      // Retry adding after split
      return this.addNode(node)
    }
    
    // Bucket is full and can't split - emit ping for least recently seen
    const lruNode = bucket.nodes[0]
    this.emit('ping', lruNode)
    return false
  }
  
  /**
   * Remove a node from the routing table.
   * Called when a node fails to respond to queries.
   */
  removeNode(nodeId: Uint8Array): boolean {
    const bucket = this.findBucket(nodeId)
    const index = bucket.nodes.findIndex(n => nodeIdsEqual(n.id, nodeId))
    
    if (index !== -1) {
      const removed = bucket.nodes.splice(index, 1)[0]
      bucket.lastChanged = Date.now()
      this.emit('nodeRemoved', removed)
      return true
    }
    
    return false
  }
  
  /**
   * Get the K closest nodes to a target ID.
   * Used for responding to find_node and get_peers queries.
   * 
   * @param target - Target ID to find closest nodes to
   * @param count - Number of nodes to return (default K)
   * @returns Array of nodes sorted by distance to target
   */
  closest(target: Uint8Array, count: number = K): DHTNode[] {
    // Collect all nodes
    const allNodes: DHTNode[] = []
    for (const bucket of this.buckets) {
      allNodes.push(...bucket.nodes)
    }
    
    // Sort by distance to target
    allNodes.sort((a, b) => compareDistance(a.id, b.id, target))
    
    // Return the closest ones
    return allNodes.slice(0, count)
  }
  
  /**
   * Get all buckets that haven't changed in the specified time.
   * Used for bucket refresh.
   * 
   * @param maxAge - Maximum age in milliseconds
   * @returns Array of bucket indices that need refresh
   */
  getStaleBuckets(maxAge: number): number[] {
    const now = Date.now()
    const stale: number[] = []
    
    for (let i = 0; i < this.buckets.length; i++) {
      if (now - this.buckets[i].lastChanged > maxAge) {
        stale.push(i)
      }
    }
    
    return stale
  }
  
  /**
   * Get a bucket by index.
   */
  getBucket(index: number): Bucket | undefined {
    return this.buckets[index]
  }
  
  /**
   * Get total number of buckets.
   */
  getBucketCount(): number {
    return this.buckets.length
  }
  
  /**
   * Get total number of nodes in the routing table.
   */
  size(): number {
    return this.buckets.reduce((sum, b) => sum + b.nodes.length, 0)
  }
  
  /**
   * Get all nodes in the routing table.
   */
  getAllNodes(): DHTNode[] {
    const nodes: DHTNode[] = []
    for (const bucket of this.buckets) {
      nodes.push(...bucket.nodes)
    }
    return nodes
  }
  
  /**
   * Check if a node is questionable (hasn't responded recently).
   */
  isQuestionable(node: DHTNode): boolean {
    if (!node.lastSeen) return true
    return Date.now() - node.lastSeen > NODE_QUESTIONABLE_MS
  }
  
  /**
   * Serialize the routing table for persistence.
   */
  serialize(): RoutingTableState {
    const nodes: RoutingTableState['nodes'] = []
    
    for (const bucket of this.buckets) {
      for (const node of bucket.nodes) {
        nodes.push({
          id: nodeIdToHex(node.id),
          host: node.host,
          port: node.port,
        })
      }
    }
    
    return {
      nodeId: nodeIdToHex(this.localId),
      nodes,
    }
  }
  
  /**
   * Restore routing table from persisted state.
   * Creates a new RoutingTable with the saved nodes.
   */
  static deserialize(state: RoutingTableState): RoutingTable {
    const localId = hexToNodeId(state.nodeId)
    const table = new RoutingTable(localId)
    
    for (const nodeData of state.nodes) {
      try {
        table.addNode({
          id: hexToNodeId(nodeData.id),
          host: nodeData.host,
          port: nodeData.port,
        })
      } catch {
        // Skip invalid nodes
      }
    }
    
    return table
  }
  
  /**
   * Find the bucket that should contain the given node ID.
   */
  private findBucket(nodeId: Uint8Array): Bucket {
    const idValue = nodeIdToBigInt(nodeId)
    
    for (const bucket of this.buckets) {
      if (idValue >= bucket.min && idValue < bucket.max) {
        return bucket
      }
    }
    
    // Should never happen if buckets cover the entire space
    throw new Error('No bucket found for node ID')
  }
  
  /**
   * Check if a bucket can be split.
   * A bucket can only be split if it contains our local ID.
   */
  private canSplit(bucket: Bucket): boolean {
    const localIdValue = nodeIdToBigInt(this.localId)
    return localIdValue >= bucket.min && localIdValue < bucket.max
  }
  
  /**
   * Split a bucket into two halves.
   */
  private splitBucket(bucket: Bucket): void {
    const midpoint = (bucket.min + bucket.max) / 2n
    
    const lowerBucket: Bucket = {
      min: bucket.min,
      max: midpoint,
      nodes: [],
      lastChanged: Date.now(),
    }
    
    const upperBucket: Bucket = {
      min: midpoint,
      max: bucket.max,
      nodes: [],
      lastChanged: Date.now(),
    }
    
    // Distribute nodes to new buckets
    for (const node of bucket.nodes) {
      const nodeValue = nodeIdToBigInt(node.id)
      if (nodeValue < midpoint) {
        lowerBucket.nodes.push(node)
      } else {
        upperBucket.nodes.push(node)
      }
    }
    
    // Replace old bucket with new buckets
    const index = this.buckets.indexOf(bucket)
    this.buckets.splice(index, 1, lowerBucket, upperBucket)
  }
}
```

---

## Phase 1.5: Create Index File

### File: `packages/engine/src/dht/index.ts`

```typescript
/**
 * DHT Module - BEP 5 Implementation
 * 
 * Distributed Hash Table for trackerless peer discovery.
 */

// Types
export type {
  DHTNode,
  Bucket,
  RoutingTableState,
  RoutingTableEvents,
  CompactPeer,
  CompactNodeInfo,
} from './types'

// Constants
export {
  K,
  ALPHA,
  NODE_ID_BYTES,
  NODE_ID_BITS,
  QUERY_TIMEOUT_MS,
  BUCKET_REFRESH_MS,
  NODE_QUESTIONABLE_MS,
  TOKEN_ROTATION_MS,
  TOKEN_MAX_AGE_MS,
  COMPACT_PEER_BYTES,
  COMPACT_NODE_BYTES,
  CLIENT_VERSION,
  MAX_NODE_ID,
} from './constants'

// XOR Distance Utilities
export {
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
} from './xor-distance'

// Routing Table
export { RoutingTable } from './routing-table'
```

---

## Phase 1.6: Create XOR Distance Tests

### File: `packages/engine/test/dht/xor-distance.test.ts`

```typescript
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
```

---

## Phase 1.7: Create Routing Table Tests

### File: `packages/engine/test/dht/routing-table.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoutingTable } from '../../src/dht/routing-table'
import { DHTNode } from '../../src/dht/types'
import { K, BUCKET_REFRESH_MS, NODE_QUESTIONABLE_MS } from '../../src/dht/constants'
import {
  generateRandomNodeId,
  generateRandomIdInBucket,
  nodeIdToHex,
  hexToNodeId,
  nodeIdsEqual,
  getBucketIndex,
} from '../../src/dht/xor-distance'

describe('RoutingTable', () => {
  let localId: Uint8Array
  let table: RoutingTable
  
  beforeEach(() => {
    localId = generateRandomNodeId()
    table = new RoutingTable(localId)
  })
  
  // Helper to create a node with specific bucket distance
  function makeNodeInBucket(bucketIndex: number): DHTNode {
    const id = generateRandomIdInBucket(bucketIndex, localId)
    return {
      id,
      host: `192.168.1.${Math.floor(Math.random() * 255)}`,
      port: 6881 + Math.floor(Math.random() * 1000),
    }
  }
  
  // Helper to create a random node
  function makeRandomNode(): DHTNode {
    return {
      id: generateRandomNodeId(),
      host: `192.168.1.${Math.floor(Math.random() * 255)}`,
      port: 6881 + Math.floor(Math.random() * 1000),
    }
  }
  
  describe('constructor', () => {
    it('initializes with a single bucket covering entire space', () => {
      expect(table.getBucketCount()).toBe(1)
      expect(table.size()).toBe(0)
    })
    
    it('throws for invalid local ID length', () => {
      expect(() => new RoutingTable(new Uint8Array(19))).toThrow()
      expect(() => new RoutingTable(new Uint8Array(21))).toThrow()
    })
  })
  
  describe('addNode', () => {
    it('adds node to correct bucket based on XOR distance', () => {
      const node = makeNodeInBucket(50)
      expect(table.addNode(node)).toBe(true)
      expect(table.size()).toBe(1)
      
      // Verify the node is in the table
      const closest = table.closest(node.id, 1)
      expect(closest.length).toBe(1)
      expect(nodeIdsEqual(closest[0].id, node.id)).toBe(true)
    })
    
    it('moves existing node to tail on update (LRU)', () => {
      const node1 = makeNodeInBucket(50)
      const node2 = makeNodeInBucket(50)
      
      table.addNode(node1)
      table.addNode(node2)
      
      // Update node1 - should move to tail
      const updatedNode1 = { ...node1, port: node1.port + 1 }
      table.addNode(updatedNode1)
      
      // Node1 should still be in the table with updated port
      const nodes = table.getAllNodes()
      const found = nodes.find(n => nodeIdsEqual(n.id, node1.id))
      expect(found).toBeDefined()
      expect(found!.port).toBe(updatedNode1.port)
    })
    
    it('emits "ping" event when bucket is full (K nodes)', () => {
      const pingHandler = vi.fn()
      table.on('ping', pingHandler)
      
      // Fill a bucket that won't contain our local ID (so it won't split)
      // Use a distant bucket (bucket 0 or low index)
      const bucketIndex = 0
      
      // Add K nodes
      for (let i = 0; i < K; i++) {
        const node = makeNodeInBucket(bucketIndex)
        table.addNode(node)
      }
      
      // Adding one more should trigger ping event
      const extraNode = makeNodeInBucket(bucketIndex)
      table.addNode(extraNode)
      
      expect(pingHandler).toHaveBeenCalled()
    })
    
    it('emits "nodeAdded" event when node is added', () => {
      const handler = vi.fn()
      table.on('nodeAdded', handler)
      
      const node = makeRandomNode()
      table.addNode(node)
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: node.id,
        host: node.host,
        port: node.port,
      }))
    })
    
    it('does not add our own local ID', () => {
      const node: DHTNode = {
        id: localId,
        host: '127.0.0.1',
        port: 6881,
      }
      
      expect(table.addNode(node)).toBe(false)
      expect(table.size()).toBe(0)
    })
  })
  
  describe('bucket splitting', () => {
    it('splits bucket containing local ID when full', () => {
      const initialBuckets = table.getBucketCount()
      expect(initialBuckets).toBe(1)
      
      // Add many nodes - buckets containing our ID will split
      for (let i = 0; i < K * 10; i++) {
        const node = makeRandomNode()
        table.addNode(node)
      }
      
      // Should have split into multiple buckets
      expect(table.getBucketCount()).toBeGreaterThan(1)
    })
    
    it('does not split far buckets (prevents unbounded growth)', () => {
      // Fill a bucket that doesn't contain our local ID
      const bucketIndex = 0 // Furthest bucket
      
      for (let i = 0; i < K + 5; i++) {
        const node = makeNodeInBucket(bucketIndex)
        table.addNode(node)
      }
      
      // The far bucket should not have split
      // Size should be capped at K
      const nodes = table.getAllNodes().filter(n => 
        getBucketIndex(localId, n.id) === bucketIndex
      )
      expect(nodes.length).toBeLessThanOrEqual(K)
    })
  })
  
  describe('closest', () => {
    it('returns nodes sorted by XOR distance to target', () => {
      // Add several nodes
      for (let i = 0; i < 20; i++) {
        table.addNode(makeRandomNode())
      }
      
      const target = generateRandomNodeId()
      const closest = table.closest(target, K)
      
      // Verify sorted order
      for (let i = 0; i < closest.length - 1; i++) {
        const distI = Number(
          Array.from(closest[i].id).reduce((acc, b, idx) => 
            acc + BigInt(b ^ target[idx]) * (1n << BigInt((19 - idx) * 8)), 0n
          )
        )
        const distNext = Number(
          Array.from(closest[i + 1].id).reduce((acc, b, idx) => 
            acc + BigInt(b ^ target[idx]) * (1n << BigInt((19 - idx) * 8)), 0n
          )
        )
        expect(distI).toBeLessThanOrEqual(distNext)
      }
    })
    
    it('returns at most K nodes by default', () => {
      // Add more than K nodes
      for (let i = 0; i < K * 3; i++) {
        table.addNode(makeRandomNode())
      }
      
      const target = generateRandomNodeId()
      const closest = table.closest(target)
      
      expect(closest.length).toBeLessThanOrEqual(K)
    })
    
    it('returns fewer nodes if table has fewer', () => {
      table.addNode(makeRandomNode())
      table.addNode(makeRandomNode())
      
      const target = generateRandomNodeId()
      const closest = table.closest(target)
      
      expect(closest.length).toBe(2)
    })
    
    it('respects custom count parameter', () => {
      for (let i = 0; i < 20; i++) {
        table.addNode(makeRandomNode())
      }
      
      const target = generateRandomNodeId()
      const closest = table.closest(target, 3)
      
      expect(closest.length).toBe(3)
    })
  })
  
  describe('removeNode', () => {
    it('removes existing node from table', () => {
      const node = makeRandomNode()
      table.addNode(node)
      expect(table.size()).toBe(1)
      
      const removed = table.removeNode(node.id)
      expect(removed).toBe(true)
      expect(table.size()).toBe(0)
    })
    
    it('returns false for non-existent node', () => {
      const node = makeRandomNode()
      const removed = table.removeNode(node.id)
      expect(removed).toBe(false)
    })
    
    it('emits "nodeRemoved" event', () => {
      const handler = vi.fn()
      table.on('nodeRemoved', handler)
      
      const node = makeRandomNode()
      table.addNode(node)
      table.removeNode(node.id)
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: node.id,
      }))
    })
  })
  
  describe('getStaleBuckets', () => {
    it('identifies buckets needing refresh', () => {
      // Add a node to create activity
      table.addNode(makeRandomNode())
      
      // No stale buckets immediately
      const stale = table.getStaleBuckets(BUCKET_REFRESH_MS)
      
      // All buckets were just created, so none should be stale
      // (unless the test takes > 15 minutes!)
      expect(stale.length).toBe(0)
    })
    
    it('returns buckets older than maxAge', () => {
      // Use a very short maxAge for testing
      const maxAge = 1 // 1ms
      
      // Wait a bit
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
      
      return wait(5).then(() => {
        const stale = table.getStaleBuckets(maxAge)
        // After waiting, all buckets should be stale
        expect(stale.length).toBeGreaterThan(0)
      })
    })
  })
  
  describe('isQuestionable', () => {
    it('returns true for nodes without lastSeen', () => {
      const node: DHTNode = {
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
      }
      
      expect(table.isQuestionable(node)).toBe(true)
    })
    
    it('returns false for recently seen nodes', () => {
      const node: DHTNode = {
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
        lastSeen: Date.now(),
      }
      
      expect(table.isQuestionable(node)).toBe(false)
    })
    
    it('returns true for nodes not seen in NODE_QUESTIONABLE_MS', () => {
      const node: DHTNode = {
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
        lastSeen: Date.now() - NODE_QUESTIONABLE_MS - 1000,
      }
      
      expect(table.isQuestionable(node)).toBe(true)
    })
  })
  
  describe('serialization', () => {
    it('serializes routing table to JSON-compatible format', () => {
      // Add some nodes
      for (let i = 0; i < 5; i++) {
        table.addNode(makeRandomNode())
      }
      
      const state = table.serialize()
      
      expect(state.nodeId).toBe(nodeIdToHex(localId))
      expect(state.nodes.length).toBe(5)
      expect(typeof state.nodes[0].id).toBe('string')
      expect(typeof state.nodes[0].host).toBe('string')
      expect(typeof state.nodes[0].port).toBe('number')
    })
    
    it('deserializes from JSON format', () => {
      // Add some nodes
      for (let i = 0; i < 5; i++) {
        table.addNode(makeRandomNode())
      }
      
      const state = table.serialize()
      const restored = RoutingTable.deserialize(state)
      
      expect(nodeIdsEqual(restored.getLocalId(), localId)).toBe(true)
      expect(restored.size()).toBe(5)
    })
    
    it('roundtrips correctly', () => {
      // Add nodes
      const originalNodes: DHTNode[] = []
      for (let i = 0; i < 10; i++) {
        const node = makeRandomNode()
        table.addNode(node)
        originalNodes.push(node)
      }
      
      const state = table.serialize()
      const restored = RoutingTable.deserialize(state)
      
      // All original nodes should be in restored table
      for (const node of originalNodes) {
        const found = restored.closest(node.id, 1)
        expect(found.length).toBe(1)
        expect(nodeIdsEqual(found[0].id, node.id)).toBe(true)
      }
    })
    
    it('handles corrupted state gracefully', () => {
      const badState = {
        nodeId: nodeIdToHex(localId),
        nodes: [
          { id: 'invalid', host: '192.168.1.1', port: 6881 },
          { id: nodeIdToHex(generateRandomNodeId()), host: '192.168.1.2', port: 6882 },
        ],
      }
      
      // Should not throw, just skip invalid nodes
      const restored = RoutingTable.deserialize(badState)
      expect(restored.size()).toBe(1) // Only the valid node
    })
  })
  
  describe('getAllNodes', () => {
    it('returns all nodes from all buckets', () => {
      const nodes: DHTNode[] = []
      for (let i = 0; i < 15; i++) {
        const node = makeRandomNode()
        table.addNode(node)
        nodes.push(node)
      }
      
      const allNodes = table.getAllNodes()
      expect(allNodes.length).toBe(15)
      
      // Each original node should be present
      for (const node of nodes) {
        const found = allNodes.find(n => nodeIdsEqual(n.id, node.id))
        expect(found).toBeDefined()
      }
    })
  })
  
  describe('getLocalId', () => {
    it('returns the local node ID', () => {
      expect(nodeIdsEqual(table.getLocalId(), localId)).toBe(true)
    })
  })
})
```

---

## Verification

After implementing all files, run the following commands from the monorepo root:

### 1. Type Check

```bash
pnpm typecheck
```

Expected: No errors

### 2. Run Tests

```bash
cd packages/engine
pnpm test -- test/dht/
```

Expected: All tests pass

```
 ✓ test/dht/xor-distance.test.ts
 ✓ test/dht/routing-table.test.ts
```

### 3. Lint

```bash
pnpm lint
```

Expected: No errors

### 4. Format

```bash
pnpm format:fix
```

### 5. Run Full Test Suite

```bash
pnpm test
```

Expected: All existing tests still pass, plus new DHT tests

---

## Implementation Checklist

- [ ] Create `packages/engine/src/dht/` directory
- [ ] Create `packages/engine/test/dht/` directory
- [ ] Implement `src/dht/types.ts`
- [ ] Implement `src/dht/constants.ts`
- [ ] Implement `src/dht/xor-distance.ts`
- [ ] Implement `src/dht/routing-table.ts`
- [ ] Implement `src/dht/index.ts`
- [ ] Implement `test/dht/xor-distance.test.ts`
- [ ] Implement `test/dht/routing-table.test.ts`
- [ ] Run `pnpm typecheck` - passes
- [ ] Run `pnpm test` in packages/engine - all tests pass
- [ ] Run `pnpm lint` - no errors
- [ ] Run `pnpm format:fix`

---

## Notes for Agent

1. **Follow existing patterns:** Look at `src/utils/` and `src/tracker/` for code style examples
2. **Use existing utilities:** `EventEmitter` from `src/utils/event-emitter.ts`, `Bencode` will be used in Phase 2
3. **Test patterns:** Follow the structure in `test/tracker/udp-tracker.test.ts` for mocking
4. **No external dependencies:** Implement from the BEP 5 spec, don't use external DHT libraries
5. **BigInt for IDs:** Node IDs are 160-bit, use bigint for distance calculations
6. **Error handling:** Throw descriptive errors for invalid inputs
