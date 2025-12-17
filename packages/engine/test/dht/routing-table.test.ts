import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RoutingTable } from '../../src/dht/routing-table'
import { DHTNodeInfo } from '../../src/dht/types'
import { K, BUCKET_REFRESH_MS, NODE_QUESTIONABLE_MS } from '../../src/dht/constants'
import {
  generateRandomNodeId,
  generateRandomIdInBucket,
  nodeIdToHex,
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
  function makeNodeInBucket(bucketIndex: number): DHTNodeInfo {
    const id = generateRandomIdInBucket(bucketIndex, localId)
    return {
      id,
      host: `192.168.1.${Math.floor(Math.random() * 255)}`,
      port: 6881 + Math.floor(Math.random() * 1000),
    }
  }

  // Helper to create a random node
  function makeRandomNode(): DHTNodeInfo {
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
      const found = nodes.find((n) => nodeIdsEqual(n.id, node1.id))
      expect(found).toBeDefined()
      expect(found!.port).toBe(updatedNode1.port)
    })

    it('emits "ping" event when bucket is full (K nodes)', () => {
      const pingHandler = vi.fn()
      table.on('ping', pingHandler)

      // Fill a bucket that won't contain our local ID (so it won't split)
      // Use bucket 159 (MSB differs) - these nodes are in the opposite half
      // of the keyspace from our local ID, so after the first split they'll
      // be in a bucket that cannot split further.
      const bucketIndex = 159

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

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: node.id,
          host: node.host,
          port: node.port,
        }),
      )
    })

    it('does not add our own local ID', () => {
      const node: DHTNodeInfo = {
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
      // Bucket 159 (MSB differs) = nodes in opposite half of keyspace
      const bucketIndex = 159

      for (let i = 0; i < K + 5; i++) {
        const node = makeNodeInBucket(bucketIndex)
        table.addNode(node)
      }

      // The far bucket should not have split
      // Size should be capped at K
      const nodes = table.getAllNodes().filter((n) => getBucketIndex(localId, n.id) === bucketIndex)
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
          Array.from(closest[i].id).reduce(
            (acc, b, idx) => acc + BigInt(b ^ target[idx]) * (1n << BigInt((19 - idx) * 8)),
            0n,
          ),
        )
        const distNext = Number(
          Array.from(closest[i + 1].id).reduce(
            (acc, b, idx) => acc + BigInt(b ^ target[idx]) * (1n << BigInt((19 - idx) * 8)),
            0n,
          ),
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

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: node.id,
        }),
      )
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
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      return wait(5).then(() => {
        const stale = table.getStaleBuckets(maxAge)
        // After waiting, all buckets should be stale
        expect(stale.length).toBeGreaterThan(0)
      })
    })
  })

  describe('isQuestionable', () => {
    it('returns true for nodes without lastSeen', () => {
      const node: DHTNodeInfo = {
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
      }

      expect(table.isQuestionable(node)).toBe(true)
    })

    it('returns false for recently seen nodes', () => {
      const node: DHTNodeInfo = {
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
        lastSeen: Date.now(),
      }

      expect(table.isQuestionable(node)).toBe(false)
    })

    it('returns true for nodes not seen in NODE_QUESTIONABLE_MS', () => {
      const node: DHTNodeInfo = {
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
      // Add nodes (only track successfully added ones)
      const addedNodes: DHTNodeInfo[] = []
      for (let i = 0; i < 10; i++) {
        const node = makeRandomNode()
        if (table.addNode(node)) {
          addedNodes.push(node)
        }
      }

      const state = table.serialize()
      const restored = RoutingTable.deserialize(state)

      // All successfully added nodes should be in restored table
      for (const node of addedNodes) {
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
          {
            id: nodeIdToHex(generateRandomNodeId()),
            host: '192.168.1.2',
            port: 6882,
          },
        ],
      }

      // Should not throw, just skip invalid nodes
      const restored = RoutingTable.deserialize(badState)
      expect(restored.size()).toBe(1) // Only the valid node
    })
  })

  describe('getAllNodes', () => {
    it('returns all nodes from all buckets', () => {
      // Only track nodes that were successfully added (some may be rejected
      // if a non-splittable bucket fills up with random IDs)
      const addedNodes: DHTNodeInfo[] = []
      for (let i = 0; i < 15; i++) {
        const node = makeRandomNode()
        if (table.addNode(node)) {
          addedNodes.push(node)
        }
      }

      const allNodes = table.getAllNodes()
      expect(allNodes.length).toBe(addedNodes.length)

      // Each successfully added node should be present
      for (const node of addedNodes) {
        const found = allNodes.find((n) => nodeIdsEqual(n.id, node.id))
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
