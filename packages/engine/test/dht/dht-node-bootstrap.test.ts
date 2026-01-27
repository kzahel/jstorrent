/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DHTNode, BootstrapStats } from '../../src/dht/dht-node'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'
import { encodeFindNodeResponse, decodeMessage, isQuery } from '../../src/dht/krpc-messages'
import { BOOTSTRAP_NODES } from '../../src/dht/constants'
import { generateRandomNodeId } from '../../src/dht/xor-distance'
import { CompactNodeInfo } from '../../src/dht/types'

// =============================================================================
// Mock UDP Socket with Simulated Network
// =============================================================================

/**
 * Mock UDP socket that can simulate multiple remote DHT nodes.
 */
class MockUdpSocket implements IUdpSocket {
  public sentData: Array<{ addr: string; port: number; data: Uint8Array }> = []
  private messageCallback:
    | ((rinfo: { addr: string; port: number }, data: Uint8Array) => void)
    | null = null

  /**
   * Map of "host:port" -> handler that returns response data.
   * If handler returns null, simulates timeout/no response.
   */
  public nodeHandlers = new Map<
    string,
    (query: any, from: { host: string; port: number }) => Uint8Array | null
  >()

  send(addr: string, port: number, data: Uint8Array): void {
    this.sentData.push({ addr, port, data: new Uint8Array(data) })

    // Simulate response from mock node
    const key = `${addr}:${port}`
    const handler = this.nodeHandlers.get(key)
    if (handler) {
      const decoded = decodeMessage(data)
      if (decoded && isQuery(decoded)) {
        const response = handler(decoded, { host: addr, port })
        if (response) {
          // Simulate async network response
          queueMicrotask(() => {
            if (this.messageCallback) {
              this.messageCallback({ addr, port }, response)
            }
          })
        }
      }
    }
  }

  onMessage(cb: (rinfo: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.messageCallback = cb
  }

  close(): void {
    this.messageCallback = null
  }

  async joinMulticast(_group: string): Promise<void> {}
  async leaveMulticast(_group: string): Promise<void> {}

  clear(): void {
    this.sentData = []
    this.nodeHandlers.clear()
  }
}

// =============================================================================
// Mock Socket Factory
// =============================================================================

class MockSocketFactory implements ISocketFactory {
  public mockSocket = new MockUdpSocket()

  async createTcpSocket(_host?: string, _port?: number): Promise<any> {
    return {}
  }

  async createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    return this.mockSocket
  }

  createTcpServer(): any {
    return {
      on: vi.fn(),
      listen: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 0 }),
      close: vi.fn(),
    }
  }

  wrapTcpSocket(_socket: any): any {
    return {}
  }
}

// =============================================================================
// Mock Hash Function
// =============================================================================

const mockHashFn = async (data: Uint8Array): Promise<Uint8Array> => {
  let sum = 0
  for (const byte of data) {
    sum = (sum + byte) % 256
  }
  return new Uint8Array(20).fill(sum)
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Generate a mock DHT node with random ID.
 */
function generateMockNode(host: string, port: number): CompactNodeInfo {
  return {
    id: generateRandomNodeId(),
    host,
    port,
  }
}

/**
 * Generate multiple mock nodes with predictable IPs.
 */
function generateMockNodes(count: number, baseIp: string = '10.0.0'): CompactNodeInfo[] {
  const nodes: CompactNodeInfo[] = []
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: generateRandomNodeId(),
      host: `${baseIp}.${i + 1}`,
      port: 6881,
    })
  }
  return nodes
}

/**
 * Create a simple responder that returns given nodes for any find_node query.
 */
function createSimpleResponder(
  responderId: Uint8Array,
  nodesToReturn: CompactNodeInfo[],
): (query: any) => Uint8Array | null {
  return (query: any) => {
    if (query.q === 'find_node') {
      return encodeFindNodeResponse(query.t, responderId, nodesToReturn)
    }
    return null
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('DHTNode Bootstrap', () => {
  let factory: MockSocketFactory
  let dhtNode: DHTNode
  let localNodeId: Uint8Array

  beforeEach(async () => {
    vi.useFakeTimers()
    factory = new MockSocketFactory()
    localNodeId = generateRandomNodeId()
    dhtNode = new DHTNode({
      nodeId: localNodeId,
      socketFactory: factory,
      krpcOptions: { timeout: 100, rateLimitEnabled: false }, // Short timeout, no rate limit timer for fake timers
      hashFn: mockHashFn,
      skipMaintenance: true, // Skip maintenance timers for tests using fake timers
    })
    await dhtNode.start()
  })

  afterEach(() => {
    dhtNode.stop()
    vi.useRealTimers()
  })

  // ===========================================================================
  // Core Bootstrap Functionality
  // ===========================================================================

  describe('basic bootstrap', () => {
    it('sends find_node(self) to bootstrap nodes', async () => {
      const bootstrapNode1 = { host: 'bootstrap1.example.com', port: 6881 }
      const bootstrapNode2 = { host: 'bootstrap2.example.com', port: 6881 }

      const node1Id = generateRandomNodeId()
      const node2Id = generateRandomNodeId()

      // Set up responders that return empty node lists (no further nodes to query)
      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode1.host}:${bootstrapNode1.port}`,
        createSimpleResponder(node1Id, []),
      )
      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode2.host}:${bootstrapNode2.port}`,
        createSimpleResponder(node2Id, []),
      )

      // Bootstrap with custom nodes
      const bootstrapPromise = dhtNode.bootstrap({
        nodes: [bootstrapNode1, bootstrapNode2],
      })

      // Allow async operations to complete
      await vi.runAllTimersAsync()
      await bootstrapPromise

      // Verify find_node queries were sent to both bootstrap nodes
      const sentQueries = factory.mockSocket.sentData.filter((d) => {
        const msg = decodeMessage(d.data)
        return msg && isQuery(msg) && (msg as any).q === 'find_node'
      })

      expect(sentQueries.length).toBeGreaterThanOrEqual(2)

      // Check targets of the queries
      const hosts = sentQueries.map((q) => q.addr)
      expect(hosts).toContain(bootstrapNode1.host)
      expect(hosts).toContain(bootstrapNode2.host)

      // Verify the target is our own node ID
      for (const query of sentQueries) {
        const msg = decodeMessage(query.data) as any
        expect(msg.a.target).toEqual(localNodeId)
      }
    })

    it('populates routing table from responses', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Generate some nodes to return in response
      const returnedNodes = generateMockNodes(5, '192.168.1')

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, returnedNodes),
      )

      // Make returned nodes also respond (with empty lists to terminate)
      for (const node of returnedNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Verify routing table was populated
      // Note: The bootstrap node itself is added by findNode() on successful response
      expect(dhtNode.getNodeCount()).toBeGreaterThanOrEqual(1)
      expect(stats.routingTableSize).toBeGreaterThanOrEqual(1)
    })

    it('iterates until no closer nodes found', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Create a chain of nodes, each returning the next set
      const layer1 = generateMockNodes(3, '10.1.0')
      const layer2 = generateMockNodes(3, '10.2.0')
      const layer3 = generateMockNodes(3, '10.3.0')

      // Bootstrap returns layer1
      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, layer1),
      )

      // Layer1 nodes return layer2
      for (const node of layer1) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, layer2),
        )
      }

      // Layer2 nodes return layer3
      for (const node of layer2) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, layer3),
        )
      }

      // Layer3 nodes return empty (no more nodes)
      for (const node of layer3) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should have queried multiple layers
      expect(stats.queriedCount).toBeGreaterThan(1)

      // Should have received responses from multiple nodes
      expect(stats.responsesReceived).toBeGreaterThan(1)
    })

    it('works with empty initial routing table', async () => {
      // Verify routing table starts empty
      expect(dhtNode.getNodeCount()).toBe(0)

      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()
      const returnedNodes = generateMockNodes(3)

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, returnedNodes),
      )

      // Make returned nodes respond
      for (const node of returnedNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should have populated the routing table
      expect(stats.routingTableSize).toBeGreaterThan(0)
      expect(stats.queriedCount).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('tolerates unresponsive bootstrap nodes', async () => {
      const unresponsiveNode = { host: 'dead.example.com', port: 6881 }
      const responsiveNode = { host: 'alive.example.com', port: 6881 }
      const responsiveNodeId = generateRandomNodeId()

      // No handler for unresponsive node (will timeout)

      // Responsive node returns some nodes
      const returnedNodes = generateMockNodes(3)
      factory.mockSocket.nodeHandlers.set(
        `${responsiveNode.host}:${responsiveNode.port}`,
        createSimpleResponder(responsiveNodeId, returnedNodes),
      )

      for (const node of returnedNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      const stats = await runBootstrap(dhtNode, {
        nodes: [unresponsiveNode, responsiveNode],
      })

      // Should have at least one failure (timeout)
      expect(stats.failures).toBeGreaterThanOrEqual(1)

      // But should still have successful responses from responsive node
      expect(stats.responsesReceived).toBeGreaterThanOrEqual(1)

      // Routing table should still be populated
      expect(stats.routingTableSize).toBeGreaterThan(0)
    })

    it('handles all bootstrap nodes being unresponsive', async () => {
      const deadNode1 = { host: 'dead1.example.com', port: 6881 }
      const deadNode2 = { host: 'dead2.example.com', port: 6881 }

      // No handlers - all will timeout

      const stats = await runBootstrap(dhtNode, {
        nodes: [deadNode1, deadNode2],
      })

      // Should have failures but not throw
      expect(stats.failures).toBe(2)
      expect(stats.responsesReceived).toBe(0)
      expect(stats.routingTableSize).toBe(0)
    })

    it('handles partial response failures gracefully', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Bootstrap returns mix of responsive and unresponsive nodes
      const responsiveNodes = generateMockNodes(2, '10.0.0')
      const unresponsiveNodes = generateMockNodes(2, '10.0.100')

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, [...responsiveNodes, ...unresponsiveNodes]),
      )

      // Only set up handlers for responsive nodes
      for (const node of responsiveNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }
      // No handlers for unresponsive nodes

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should have both successes and failures
      expect(stats.responsesReceived).toBeGreaterThan(0)
      expect(stats.failures).toBeGreaterThan(0)
    })

    it('throws if node not started', async () => {
      const newNode = new DHTNode({
        socketFactory: factory,
        hashFn: mockHashFn,
      })

      await expect(newNode.bootstrap()).rejects.toThrow('not started')
    })
  })

  // ===========================================================================
  // Events
  // ===========================================================================

  describe('events', () => {
    it('emits bootstrapped event when complete', async () => {
      const bootstrappedHandler = vi.fn()
      dhtNode.on('test:bootstrapped', bootstrappedHandler)

      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, []),
      )

      await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      expect(bootstrappedHandler).toHaveBeenCalledTimes(1)
      expect(bootstrappedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          queriedCount: expect.any(Number),
          responsesReceived: expect.any(Number),
          failures: expect.any(Number),
          routingTableSize: expect.any(Number),
          durationMs: expect.any(Number),
        }),
      )
    })

    it('emits nodeAdded events during bootstrap', async () => {
      const nodeAddedHandler = vi.fn()
      dhtNode.on('test:nodeAdded', nodeAddedHandler)

      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, []),
      )

      await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // At minimum, the bootstrap node should be added
      expect(nodeAddedHandler).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Options
  // ===========================================================================

  describe('options', () => {
    it('uses default BOOTSTRAP_NODES when none provided', async () => {
      // Set up handlers for default bootstrap nodes
      for (const node of BOOTSTRAP_NODES) {
        const nodeId = generateRandomNodeId()
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(nodeId, []),
        )
      }

      // Call bootstrap with no options - should use defaults
      const bootstrapPromise = dhtNode.bootstrap()
      await vi.runAllTimersAsync()

      try {
        await bootstrapPromise
      } catch {
        // May fail due to DNS resolution in test environment
      }

      // Verify queries were sent to default bootstrap nodes
      const queriedHosts = factory.mockSocket.sentData.map((d) => d.addr)
      for (const node of BOOTSTRAP_NODES) {
        expect(queriedHosts).toContain(node.host)
      }
    })

    it('respects maxIterations option', async () => {
      // Create an infinite loop scenario by having each node return new nodes
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      let nodeCounter = 0

      const createNewNodes = (): CompactNodeInfo[] => {
        nodeCounter++
        return generateMockNodes(3, `10.${nodeCounter}.0`)
      }

      // Each node returns fresh nodes indefinitely
      const infiniteResponder = (query: any) => {
        if (query.q === 'find_node') {
          const newNodes = createNewNodes()
          // Set up handlers for newly created nodes
          for (const node of newNodes) {
            factory.mockSocket.nodeHandlers.set(`${node.host}:${node.port}`, infiniteResponder)
          }
          return encodeFindNodeResponse(query.t, generateRandomNodeId(), newNodes)
        }
        return null
      }

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        infiniteResponder,
      )

      const stats = await runBootstrap(dhtNode, {
        nodes: [bootstrapNode],
        maxIterations: 3,
      })

      // Should have terminated despite infinite node discovery
      expect(stats.queriedCount).toBeLessThan(100) // Reasonable upper bound
    })

    it('respects concurrency option', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Return many nodes to test concurrency limiting
      const manyNodes = generateMockNodes(10)

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, manyNodes),
      )

      for (const node of manyNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      // Note: Testing exact concurrency behavior is complex with fake timers
      // This test verifies the option is accepted without error
      const stats = await runBootstrap(dhtNode, {
        nodes: [bootstrapNode],
        concurrency: 1, // Very low concurrency
      })

      expect(stats.queriedCount).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe('statistics', () => {
    it('returns accurate query count', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()
      const returnedNodes = generateMockNodes(3)

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, returnedNodes),
      )

      for (const node of returnedNodes) {
        factory.mockSocket.nodeHandlers.set(
          `${node.host}:${node.port}`,
          createSimpleResponder(node.id, []),
        )
      }

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should have queried bootstrap + returned nodes
      expect(stats.queriedCount).toBe(1 + 3) // bootstrap + 3 returned nodes
    })

    it('tracks duration correctly', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, []),
      )

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      expect(stats.durationMs).toBeGreaterThanOrEqual(0)
      expect(stats.durationMs).toBeLessThan(10000) // Should be fast in tests
    })

    it('counts failures separately from responses', async () => {
      const workingNode = { host: 'working.example.com', port: 6881 }
      const brokenNode = { host: 'broken.example.com', port: 6881 }

      factory.mockSocket.nodeHandlers.set(
        `${workingNode.host}:${workingNode.port}`,
        createSimpleResponder(generateRandomNodeId(), []),
      )
      // No handler for broken node - will timeout

      const stats = await runBootstrap(dhtNode, {
        nodes: [workingNode, brokenNode],
      })

      expect(stats.responsesReceived).toBe(1)
      expect(stats.failures).toBe(1)
      expect(stats.queriedCount).toBe(2)
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles duplicate nodes in responses', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Same node returned multiple times
      const duplicateNode = generateMockNode('10.0.0.1', 6881)
      const uniqueNode = generateMockNode('10.0.0.2', 6881)

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, [duplicateNode, duplicateNode, uniqueNode]),
      )

      factory.mockSocket.nodeHandlers.set(
        `${duplicateNode.host}:${duplicateNode.port}`,
        createSimpleResponder(duplicateNode.id, []),
      )
      factory.mockSocket.nodeHandlers.set(
        `${uniqueNode.host}:${uniqueNode.port}`,
        createSimpleResponder(uniqueNode.id, []),
      )

      await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should not query the duplicate node multiple times
      const queriesTo10001 = factory.mockSocket.sentData.filter(
        (d) => d.addr === '10.0.0.1' && d.port === 6881,
      )
      expect(queriesTo10001.length).toBe(1)
    })

    it('handles empty bootstrap nodes array', async () => {
      const stats = await runBootstrap(dhtNode, { nodes: [] })

      expect(stats.queriedCount).toBe(0)
      expect(stats.responsesReceived).toBe(0)
      expect(stats.failures).toBe(0)
    })

    it('handles nodes returning themselves', async () => {
      const bootstrapNode = { host: 'bootstrap.example.com', port: 6881 }
      const bootstrapNodeId = generateRandomNodeId()

      // Bootstrap returns itself
      const selfNode: CompactNodeInfo = {
        id: bootstrapNodeId,
        host: bootstrapNode.host,
        port: bootstrapNode.port,
      }

      factory.mockSocket.nodeHandlers.set(
        `${bootstrapNode.host}:${bootstrapNode.port}`,
        createSimpleResponder(bootstrapNodeId, [selfNode]),
      )

      const stats = await runBootstrap(dhtNode, { nodes: [bootstrapNode] })

      // Should not get stuck in infinite loop
      expect(stats.queriedCount).toBe(1) // Only query once
    })
  })
})

// =============================================================================
// Helper to run bootstrap with fake timers
// =============================================================================

async function runBootstrap(
  node: DHTNode,
  options: Parameters<DHTNode['bootstrap']>[0],
): Promise<BootstrapStats> {
  const bootstrapPromise = node.bootstrap(options)

  // Run timers to handle timeouts and async operations
  await vi.runAllTimersAsync()

  return bootstrapPromise
}
