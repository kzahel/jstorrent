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
import { DHTNodeInfo, Bucket, RoutingTableState } from './types'
import { K, NODE_QUESTIONABLE_MS, MAX_NODE_ID } from './constants'
import {
  nodeIdToBigInt,
  nodeIdsEqual,
  nodeIdToHex,
  hexToNodeId,
  compareDistance,
} from './xor-distance'

export class RoutingTable extends EventEmitter {
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
    this.buckets = [
      {
        min: 0n,
        max: MAX_NODE_ID + 1n, // Exclusive upper bound
        nodes: [],
        lastChanged: Date.now(),
      },
    ]
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
  addNode(node: DHTNodeInfo): boolean {
    // Don't add ourselves
    if (nodeIdsEqual(node.id, this.localId)) {
      return false
    }

    const bucket = this.findBucket(node.id)

    // Check if node already exists in bucket
    const existingIndex = bucket.nodes.findIndex((n) => nodeIdsEqual(n.id, node.id))

    if (existingIndex !== -1) {
      // Move to tail (most recently seen) and update
      const existing = bucket.nodes.splice(existingIndex, 1)[0]
      existing.host = node.host
      existing.port = node.port
      existing.lastSeen = node.lastSeen ?? Date.now()
      existing.consecutiveFailures = 0 // Reset on successful contact
      bucket.nodes.push(existing)
      bucket.lastChanged = Date.now()
      return true
    }

    // Node doesn't exist - try to add it
    if (bucket.nodes.length < K) {
      // Bucket has space
      const newNode: DHTNodeInfo = {
        ...node,
        lastSeen: node.lastSeen ?? Date.now(),
      }
      bucket.nodes.push(newNode)
      bucket.lastChanged = Date.now()
      this.emit('test:nodeAdded', newNode)
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
    const index = bucket.nodes.findIndex((n) => nodeIdsEqual(n.id, nodeId))

    if (index !== -1) {
      const removed = bucket.nodes.splice(index, 1)[0]
      bucket.lastChanged = Date.now()
      this.emit('test:nodeRemoved', removed)
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
  closest(target: Uint8Array, count: number = K): DHTNodeInfo[] {
    // Collect all nodes
    const allNodes: DHTNodeInfo[] = []
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
  getAllNodes(): DHTNodeInfo[] {
    const nodes: DHTNodeInfo[] = []
    for (const bucket of this.buckets) {
      nodes.push(...bucket.nodes)
    }
    return nodes
  }

  /**
   * Check if a node is questionable (hasn't responded recently).
   */
  isQuestionable(node: DHTNodeInfo): boolean {
    if (!node.lastSeen) return true
    return Date.now() - node.lastSeen > NODE_QUESTIONABLE_MS
  }

  /**
   * Find a node by ID.
   */
  getNode(nodeId: Uint8Array): DHTNodeInfo | undefined {
    const bucket = this.findBucket(nodeId)
    return bucket.nodes.find((n) => nodeIdsEqual(n.id, nodeId))
  }

  /**
   * Increment consecutive failure count for a node.
   * @returns New failure count, or undefined if node not found
   */
  incrementFailures(nodeId: Uint8Array): number | undefined {
    const node = this.getNode(nodeId)
    if (!node) return undefined
    node.consecutiveFailures = (node.consecutiveFailures ?? 0) + 1
    return node.consecutiveFailures
  }

  /**
   * Reset consecutive failure count for a node (on successful response).
   */
  resetFailures(nodeId: Uint8Array): void {
    const node = this.getNode(nodeId)
    if (node) {
      node.consecutiveFailures = 0
    }
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
