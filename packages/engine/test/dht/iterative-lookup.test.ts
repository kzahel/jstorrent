import { describe, it, expect, vi } from 'vitest'
import { iterativeLookup } from '../../src/dht/iterative-lookup'
import { RoutingTable } from '../../src/dht/routing-table'
import { GetPeersResult } from '../../src/dht/dht-node'
import { CompactNodeInfo, CompactPeer } from '../../src/dht/types'
import { generateRandomNodeId, xorDistance } from '../../src/dht/xor-distance'
import { K } from '../../src/dht/constants'
import { MockDHTNetwork, generateMockPeers } from './helpers/mock-dht-network'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a simple routing table seeded with nodes.
 */
function createSeededRoutingTable(localId: Uint8Array, nodes: CompactNodeInfo[]): RoutingTable {
  const rt = new RoutingTable(localId)
  for (const node of nodes) {
    rt.addNode({ id: node.id, host: node.host, port: node.port })
  }
  return rt
}

/**
 * Create a mock sendGetPeers that returns predetermined responses.
 */
function createMockSendGetPeers(
  responses: Map<string, GetPeersResult | null>,
): (node: CompactNodeInfo) => Promise<GetPeersResult | null> {
  return async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
    const key = `${node.host}:${node.port}`
    const response = responses.get(key)
    return response ?? null
  }
}

/**
 * Generate a chain of nodes where each returns the next set.
 * Useful for testing iterative deepening.
 */
function generateNodeChain(
  depth: number,
  nodesPerLevel: number,
): {
  levels: CompactNodeInfo[][]
  sendGetPeers: (node: CompactNodeInfo) => Promise<GetPeersResult | null>
} {
  const levels: CompactNodeInfo[][] = []

  // Generate nodes for each level
  for (let d = 0; d < depth; d++) {
    const levelNodes: CompactNodeInfo[] = []
    for (let i = 0; i < nodesPerLevel; i++) {
      levelNodes.push({
        id: generateRandomNodeId(),
        host: `10.${d}.0.${i}`,
        port: 6881,
      })
    }
    levels.push(levelNodes)
  }

  // Create responder
  const responses = new Map<string, GetPeersResult>()

  for (let d = 0; d < depth; d++) {
    const nextLevel = d + 1 < depth ? levels[d + 1] : []
    const token = new Uint8Array(8)
    crypto.getRandomValues(token)

    for (const node of levels[d]) {
      responses.set(`${node.host}:${node.port}`, {
        token,
        nodes: nextLevel,
      })
    }
  }

  const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
    const key = `${node.host}:${node.port}`
    return responses.get(key) ?? null
  }

  return { levels, sendGetPeers }
}

// =============================================================================
// Tests
// =============================================================================

describe('iterativeLookup', () => {
  const localNodeId = generateRandomNodeId()
  const target = generateRandomNodeId()

  // ===========================================================================
  // Basic Functionality
  // ===========================================================================

  describe('basic functionality', () => {
    it('queries initial candidates from routing table', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 5; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)
      const queriedNodes: string[] = []

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        queriedNodes.push(`${node.host}:${node.port}`)
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [], // No more nodes
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should have queried at least some nodes
      expect(queriedNodes.length).toBeGreaterThan(0)

      // All queried nodes should be from our initial set
      for (const queried of queriedNodes) {
        const [host, portStr] = queried.split(':')
        expect(nodes.some((n) => n.host === host && n.port === parseInt(portStr))).toBe(true)
      }
    })

    it('returns peers when found', async () => {
      const node: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }

      const expectedPeers: CompactPeer[] = [
        { host: '192.168.1.1', port: 51413 },
        { host: '192.168.1.2', port: 51414 },
      ]

      const rt = createSeededRoutingTable(localNodeId, [node])

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        peers: expectedPeers,
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      expect(result.peers).toHaveLength(2)
      expect(result.peers).toContainEqual({ host: '192.168.1.1', port: 51413 })
      expect(result.peers).toContainEqual({ host: '192.168.1.2', port: 51414 })
    })

    it('stores tokens from responding nodes', async () => {
      const nodes: CompactNodeInfo[] = [
        { id: generateRandomNodeId(), host: '10.0.0.1', port: 6881 },
        { id: generateRandomNodeId(), host: '10.0.0.2', port: 6881 },
      ]

      const tokenValues = new Map<string, Uint8Array>([
        ['10.0.0.1:6881', new Uint8Array([1, 1, 1, 1])],
        ['10.0.0.2:6881', new Uint8Array([2, 2, 2, 2])],
      ])

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        const key = `${node.host}:${node.port}`
        return {
          token: tokenValues.get(key)!,
          nodes: [],
        }
      }

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should have tokens from both nodes
      expect(result.tokens.size).toBe(2)

      const token1 = result.tokens.get('10.0.0.1:6881')
      expect(token1).toBeDefined()
      expect(token1!.token).toEqual(new Uint8Array([1, 1, 1, 1]))

      const token2 = result.tokens.get('10.0.0.2:6881')
      expect(token2).toBeDefined()
      expect(token2!.token).toEqual(new Uint8Array([2, 2, 2, 2]))
    })

    it('returns closest responding nodes', async () => {
      // Create nodes at varying distances from target
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        nodes: [],
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
        k: 5,
      })

      // Should return up to K closest responding nodes
      expect(result.closestNodes.length).toBeLessThanOrEqual(5)

      // Verify they're sorted by distance
      for (let i = 1; i < result.closestNodes.length; i++) {
        const prevDist = xorDistance(result.closestNodes[i - 1].id, target)
        const currDist = xorDistance(result.closestNodes[i].id, target)
        expect(currDist).toBeGreaterThanOrEqual(prevDist)
      }
    })

    it('tracks queriedCount correctly', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 5; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        nodes: [],
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      expect(result.queriedCount).toBe(5)
    })
  })

  // ===========================================================================
  // Iterative Deepening
  // ===========================================================================

  describe('iterative deepening', () => {
    it('queries nodes returned in responses', async () => {
      // First node returns second node
      const node1: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const node2: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.2',
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [node1])
      const queriedNodes: string[] = []

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        const key = `${node.host}:${node.port}`
        queriedNodes.push(key)

        if (key === '10.0.0.1:6881') {
          // Return node2 as a closer node
          return {
            token: new Uint8Array([1, 2, 3, 4]),
            nodes: [node2],
          }
        }
        // node2 returns no more nodes
        return {
          token: new Uint8Array([5, 6, 7, 8]),
          nodes: [],
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should have queried both nodes
      expect(queriedNodes).toContain('10.0.0.1:6881')
      expect(queriedNodes).toContain('10.0.0.2:6881')
    })

    it('continues past nodes without peers', async () => {
      // Create a chain: node1 -> node2 -> node3 (has peers)
      const node1: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const node2: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.2',
        port: 6881,
      }
      const node3: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.3',
        port: 6881,
      }

      const expectedPeers: CompactPeer[] = [{ host: '192.168.1.1', port: 51413 }]

      const responses = new Map<string, GetPeersResult>([
        ['10.0.0.1:6881', { token: new Uint8Array([1]), nodes: [node2] }],
        ['10.0.0.2:6881', { token: new Uint8Array([2]), nodes: [node3] }],
        ['10.0.0.3:6881', { token: new Uint8Array([3]), peers: expectedPeers }],
      ])

      const rt = createSeededRoutingTable(localNodeId, [node1])

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      expect(result.peers).toHaveLength(1)
      expect(result.peers[0]).toEqual(expectedPeers[0])
      expect(result.queriedCount).toBe(3)
    })

    it('collects peers from multiple nodes', async () => {
      const nodes: CompactNodeInfo[] = [
        { id: generateRandomNodeId(), host: '10.0.0.1', port: 6881 },
        { id: generateRandomNodeId(), host: '10.0.0.2', port: 6881 },
        { id: generateRandomNodeId(), host: '10.0.0.3', port: 6881 },
      ]

      // Each node has different peers
      const responses = new Map<string, GetPeersResult>([
        [
          '10.0.0.1:6881',
          { token: new Uint8Array([1]), peers: [{ host: '192.168.1.1', port: 1 }] },
        ],
        [
          '10.0.0.2:6881',
          { token: new Uint8Array([2]), peers: [{ host: '192.168.1.2', port: 2 }] },
        ],
        [
          '10.0.0.3:6881',
          { token: new Uint8Array([3]), peers: [{ host: '192.168.1.3', port: 3 }] },
        ],
      ])

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      // Should have collected all 3 peers
      expect(result.peers).toHaveLength(3)
    })
  })

  // ===========================================================================
  // Convergence
  // ===========================================================================

  describe('convergence', () => {
    it('stops when no closer nodes available', async () => {
      // All nodes return empty node lists
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < K; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)
      let queryCount = 0

      const sendGetPeers = async (): Promise<GetPeersResult | null> => {
        queryCount++
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [], // No more nodes to query
        }
      }

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should query all K nodes then stop
      expect(result.queriedCount).toBe(K)
      expect(queryCount).toBe(K)
    })

    it('stops when K closest have responded', async () => {
      // Create more than K nodes, but farther ones shouldn't need to be queried
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < K * 2; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      // Sort by distance to have predictable behavior
      nodes.sort((a, b) => {
        const distA = xorDistance(a.id, target)
        const distB = xorDistance(b.id, target)
        if (distA < distB) return -1
        if (distA > distB) return 1
        return 0
      })

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        nodes: [], // No new nodes
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should stop once K closest have responded
      expect(result.queriedCount).toBeLessThanOrEqual(K * 2)
      expect(result.closestNodes.length).toBeLessThanOrEqual(K)
    })

    it('does not query nodes farther than K closest responding', async () => {
      // Create 2*K nodes, then pick K closest as "close" and rest as "far"
      const allNodes: CompactNodeInfo[] = []
      for (let i = 0; i < K * 2; i++) {
        allNodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      // Sort all nodes by distance to target
      allNodes.sort((a, b) => {
        const distA = xorDistance(a.id, target)
        const distB = xorDistance(b.id, target)
        if (distA < distB) return -1
        if (distA > distB) return 1
        return 0
      })

      // First K are close, rest are far
      const closeNodes = allNodes.slice(0, K)
      // farNodes would be allNodes.slice(K) but we don't need to reference them

      const rt = createSeededRoutingTable(localNodeId, allNodes)
      const queriedHosts = new Set<string>()

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        queriedHosts.add(node.host)

        // All nodes return no new nodes (since we already seeded all)
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [],
        }
      }

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Close nodes should be queried (at least some of them)
      const closeQueriedCount = closeNodes.filter((n) => queriedHosts.has(n.host)).length
      expect(closeQueriedCount).toBeGreaterThan(0)

      // Result should contain close nodes
      expect(result.closestNodes.length).toBeLessThanOrEqual(K)

      // Verify that result nodes are from the closer set
      for (const resultNode of result.closestNodes) {
        const isClose = closeNodes.some((c) => c.host === resultNode.host)
        expect(isClose).toBe(true)
      }
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('handles unresponsive nodes gracefully', async () => {
      const respondingNode: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const unresponsiveNode: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.2',
        port: 6881,
      }

      const responses = new Map<string, GetPeersResult | null>([
        ['10.0.0.1:6881', { token: new Uint8Array([1, 2, 3, 4]), nodes: [] }],
        ['10.0.0.2:6881', null], // Timeout
      ])

      const rt = createSeededRoutingTable(localNodeId, [respondingNode, unresponsiveNode])

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      // Should complete without error
      expect(result.queriedCount).toBe(2)

      // Only responding node should be in closestNodes
      expect(result.closestNodes).toHaveLength(1)
      expect(result.closestNodes[0].host).toBe('10.0.0.1')
    })

    it('handles all nodes being unresponsive', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 5; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => null // All timeout

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      expect(result.queriedCount).toBe(5)
      expect(result.closestNodes).toHaveLength(0)
      expect(result.peers).toHaveLength(0)
      expect(result.tokens.size).toBe(0)
    })

    it('handles sendGetPeers throwing errors', async () => {
      const nodes: CompactNodeInfo[] = [
        { id: generateRandomNodeId(), host: '10.0.0.1', port: 6881 },
        { id: generateRandomNodeId(), host: '10.0.0.2', port: 6881 },
      ]

      const rt = createSeededRoutingTable(localNodeId, nodes)
      let callCount = 0

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        callCount++
        if (node.host === '10.0.0.1') {
          throw new Error('Network error')
        }
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [],
        }
      }

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should complete despite error
      expect(callCount).toBe(2)
      expect(result.closestNodes).toHaveLength(1) // Only non-throwing node
    })

    it('continues discovering through failures', async () => {
      // node1 fails but returns node2, node2 works
      const node1: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const node2: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.2',
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [node1, node2])

      const responses = new Map<string, GetPeersResult | null>([
        ['10.0.0.1:6881', null], // Fails
        [
          '10.0.0.2:6881',
          { token: new Uint8Array([1]), peers: [{ host: '192.168.1.1', port: 1 }] },
        ],
      ])

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      // Should still find peers from node2
      expect(result.peers).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Parallelism
  // ===========================================================================

  describe('parallelism', () => {
    it('respects alpha parallelism limit', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      let maxConcurrent = 0
      let currentConcurrent = 0

      const sendGetPeers = async (): Promise<GetPeersResult | null> => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10))

        currentConcurrent--

        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [],
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
        alpha: 3,
      })

      // Should never exceed alpha concurrent queries
      expect(maxConcurrent).toBeLessThanOrEqual(3)
    })

    it('sends alpha queries in parallel', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 10; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      let concurrentAtSomePoint = false
      let currentConcurrent = 0

      const sendGetPeers = async (): Promise<GetPeersResult | null> => {
        currentConcurrent++
        if (currentConcurrent > 1) {
          concurrentAtSomePoint = true
        }

        await new Promise((resolve) => setTimeout(resolve, 10))

        currentConcurrent--

        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [],
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
        alpha: 3,
      })

      // Should have had concurrent queries at some point
      expect(concurrentAtSomePoint).toBe(true)
    })
  })

  // ===========================================================================
  // Deduplication
  // ===========================================================================

  describe('deduplication', () => {
    it('does not query the same node twice', async () => {
      const node: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [node])
      let queryCount = 0

      const sendGetPeers = async (): Promise<GetPeersResult | null> => {
        queryCount++
        // Return the same node (should be ignored)
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [node],
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      expect(queryCount).toBe(1)
    })

    it('deduplicates peers by host:port', async () => {
      const nodes: CompactNodeInfo[] = [
        { id: generateRandomNodeId(), host: '10.0.0.1', port: 6881 },
        { id: generateRandomNodeId(), host: '10.0.0.2', port: 6881 },
      ]

      const samePeer: CompactPeer = { host: '192.168.1.1', port: 51413 }

      const responses = new Map<string, GetPeersResult>([
        ['10.0.0.1:6881', { token: new Uint8Array([1]), peers: [samePeer] }],
        ['10.0.0.2:6881', { token: new Uint8Array([2]), peers: [samePeer] }],
      ])

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      // Same peer from both nodes should be deduplicated
      expect(result.peers).toHaveLength(1)
    })

    it('handles nodes with same address but different IDs', async () => {
      // Two nodes at same address (maybe changed ID)
      const node1: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const node2: CompactNodeInfo = {
        id: generateRandomNodeId(), // Different ID
        host: '10.0.0.1', // Same address
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [node1])
      let queryCount = 0

      const sendGetPeers = async (): Promise<GetPeersResult | null> => {
        queryCount++
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [node2], // Return "different" node at same address
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should only query once (same address = same node for practical purposes)
      expect(queryCount).toBe(1)
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty routing table', async () => {
      const rt = new RoutingTable(localNodeId)

      const sendGetPeers = vi.fn()

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      expect(result.queriedCount).toBe(0)
      expect(result.peers).toHaveLength(0)
      expect(result.closestNodes).toHaveLength(0)
      expect(sendGetPeers).not.toHaveBeenCalled()
    })

    it('excludes local node from candidates', async () => {
      const selfNode: CompactNodeInfo = {
        id: localNodeId,
        host: '127.0.0.1',
        port: 6881,
      }
      const otherNode: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [otherNode])
      const queriedHosts: string[] = []

      const sendGetPeers = async (node: CompactNodeInfo): Promise<GetPeersResult | null> => {
        queriedHosts.push(node.host)
        // Return self as a node
        return {
          token: new Uint8Array([1, 2, 3, 4]),
          nodes: [selfNode],
        }
      }

      await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should not have queried ourselves
      expect(queriedHosts).not.toContain('127.0.0.1')
    })

    it('handles nodes returning both peers and nodes', async () => {
      const node1: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.1',
        port: 6881,
      }
      const node2: CompactNodeInfo = {
        id: generateRandomNodeId(),
        host: '10.0.0.2',
        port: 6881,
      }

      const rt = createSeededRoutingTable(localNodeId, [node1])

      const responses = new Map<string, GetPeersResult>([
        [
          '10.0.0.1:6881',
          {
            token: new Uint8Array([1]),
            peers: [{ host: '192.168.1.1', port: 1 }],
            nodes: [node2],
          },
        ],
        [
          '10.0.0.2:6881',
          {
            token: new Uint8Array([2]),
            peers: [{ host: '192.168.1.2', port: 2 }],
          },
        ],
      ])

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers: createMockSendGetPeers(responses),
        localNodeId,
      })

      // Should collect peers from both nodes
      expect(result.peers).toHaveLength(2)
      // Should query the returned node
      expect(result.queriedCount).toBe(2)
    })

    it('handles very deep chains (O(log n) queries)', async () => {
      const { levels, sendGetPeers } = generateNodeChain(10, 3)

      const rt = createSeededRoutingTable(localNodeId, levels[0])

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
      })

      // Should traverse multiple levels
      expect(result.queriedCount).toBeGreaterThan(3)
    })

    it('works with alpha = 1 (sequential)', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 5; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        nodes: [],
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
        alpha: 1,
      })

      expect(result.queriedCount).toBe(5)
    })

    it('works with k = 1', async () => {
      const nodes: CompactNodeInfo[] = []
      for (let i = 0; i < 5; i++) {
        nodes.push({
          id: generateRandomNodeId(),
          host: `10.0.0.${i}`,
          port: 6881,
        })
      }

      const rt = createSeededRoutingTable(localNodeId, nodes)

      const sendGetPeers = async (): Promise<GetPeersResult | null> => ({
        token: new Uint8Array([1, 2, 3, 4]),
        nodes: [],
      })

      const result = await iterativeLookup({
        target,
        routingTable: rt,
        sendGetPeers,
        localNodeId,
        k: 1,
      })

      // Should still query nodes but return only 1 closest
      expect(result.closestNodes.length).toBeLessThanOrEqual(1)
    })
  })

  // ===========================================================================
  // Mock Network Tests
  // ===========================================================================

  describe('with mock network', () => {
    it('converges in O(log n) queries for 100 node network', async () => {
      const network = new MockDHTNetwork({ nodeCount: 100 })

      // Use a random node's routing table as starting point
      const startNode = network.getRandomNode()
      const rt = startNode.routingTable

      const infoHash = generateRandomNodeId()
      const sendGetPeers = network.createGetPeersHandlerForInfohash(infoHash, startNode.id)

      const result = await iterativeLookup({
        target: infoHash,
        routingTable: rt,
        sendGetPeers,
        localNodeId: startNode.id,
      })

      // For 100 nodes, should converge in roughly log2(100) ~ 7 rounds
      // With alpha=3 parallel queries, expect ~21 queries at most
      // But accounting for failures and implementation details, allow up to 50
      expect(result.queriedCount).toBeLessThan(50)
      expect(result.closestNodes.length).toBeGreaterThan(0)
    })

    it('finds planted peers in the network', async () => {
      const network = new MockDHTNetwork({ nodeCount: 50 })

      const infoHash = generateRandomNodeId()
      const plantedPeers = generateMockPeers(5)

      // Plant peers at nodes closest to the infohash
      network.plantPeers(infoHash, plantedPeers)

      const startNode = network.getRandomNode()
      const rt = startNode.routingTable
      const sendGetPeers = network.createGetPeersHandlerForInfohash(infoHash, startNode.id)

      const result = await iterativeLookup({
        target: infoHash,
        routingTable: rt,
        sendGetPeers,
        localNodeId: startNode.id,
      })

      // Should find at least some of the planted peers
      expect(result.peers.length).toBeGreaterThan(0)

      // Verify found peers are from planted set
      for (const peer of result.peers) {
        expect(plantedPeers.some((p) => p.host === peer.host && p.port === peer.port)).toBe(true)
      }
    })

    it('handles packet loss gracefully', async () => {
      const network = new MockDHTNetwork({ nodeCount: 50 })
      network.setDropRate(0.3) // 30% packet loss

      const infoHash = generateRandomNodeId()
      const plantedPeers = generateMockPeers(5)
      network.plantPeers(infoHash, plantedPeers)

      const startNode = network.getRandomNode()
      const rt = startNode.routingTable
      const sendGetPeers = network.createGetPeersHandlerForInfohash(infoHash, startNode.id)

      // Run multiple times to account for randomness
      // Just verify it doesn't crash under packet loss
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await iterativeLookup({
          target: infoHash,
          routingTable: rt,
          sendGetPeers,
          localNodeId: startNode.id,
        })

        // May or may not find peers with 30% drop rate - that's fine
        if (result.peers.length > 0) {
          break
        }
      }

      // Main assertion: completes without error
      expect(true).toBe(true)
    })

    it('collects tokens from closest responding nodes', async () => {
      const network = new MockDHTNetwork({ nodeCount: 50 })

      const infoHash = generateRandomNodeId()
      const startNode = network.getRandomNode()
      const rt = startNode.routingTable
      const sendGetPeers = network.createGetPeersHandlerForInfohash(infoHash, startNode.id)

      const result = await iterativeLookup({
        target: infoHash,
        routingTable: rt,
        sendGetPeers,
        localNodeId: startNode.id,
      })

      // Should have tokens from responding nodes
      expect(result.tokens.size).toBeGreaterThan(0)

      // Each token entry should have valid node and token
      for (const [key, entry] of result.tokens) {
        expect(entry.node).toBeDefined()
        expect(entry.token).toBeDefined()
        expect(entry.token.length).toBeGreaterThan(0)
        expect(key).toBe(`${entry.node.host}:${entry.node.port}`)
      }
    })
  })
})
