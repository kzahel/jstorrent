/**
 * Mock DHT Network for Testing
 *
 * Simulates a network of DHT nodes with proper routing behavior.
 * Each mock node maintains a routing table and can respond to get_peers queries.
 */

import { CompactNodeInfo, CompactPeer } from '../../../src/dht/types'
import { GetPeersResult } from '../../../src/dht/dht-node'
import { RoutingTable } from '../../../src/dht/routing-table'
import { generateRandomNodeId, compareDistance } from '../../../src/dht/xor-distance'
import { K } from '../../../src/dht/constants'

/**
 * A simulated DHT node in the mock network.
 */
export interface MockDHTNode {
  id: Uint8Array
  host: string
  port: number
  routingTable: RoutingTable
  /** Peers this node knows about, keyed by infohash hex */
  peers: Map<string, CompactPeer[]>
  /** Whether this node should drop requests (simulate failure) */
  dropRequests: boolean
  /** Artificial delay in ms (0 = no delay) */
  responseDelayMs: number
}

/**
 * Options for creating a mock network.
 */
export interface MockNetworkOptions {
  /** Number of nodes in the network */
  nodeCount: number
  /** Base IP for generated nodes (default: '10.0') */
  baseIp?: string
  /** Base port for generated nodes (default: 6881) */
  basePort?: number
  /** Drop rate for simulating packet loss (0-1, default: 0) */
  dropRate?: number
}

/**
 * Mock DHT network for testing iterative lookup.
 */
export class MockDHTNetwork {
  public readonly nodes: MockDHTNode[] = []
  private dropRate: number = 0

  constructor(options: MockNetworkOptions) {
    const baseIp = options.baseIp ?? '10.0'
    const basePort = options.basePort ?? 6881

    // Create nodes
    for (let i = 0; i < options.nodeCount; i++) {
      const octet3 = Math.floor(i / 256)
      const octet4 = i % 256
      const node: MockDHTNode = {
        id: generateRandomNodeId(),
        host: `${baseIp}.${octet3}.${octet4}`,
        port: basePort + i,
        routingTable: null as unknown as RoutingTable, // Will be set after
        peers: new Map(),
        dropRequests: false,
        responseDelayMs: 0,
      }
      this.nodes.push(node)
    }

    // Initialize routing tables and populate with knowledge of other nodes
    for (const node of this.nodes) {
      node.routingTable = new RoutingTable(node.id)

      // Each node knows about some random subset of other nodes
      // (simulating gradual discovery through DHT operation)
      const otherNodes = this.nodes.filter((n) => n !== node)
      const shuffled = otherNodes.sort(() => Math.random() - 0.5)
      const toAdd = shuffled.slice(0, Math.min(K * 4, shuffled.length))

      for (const other of toAdd) {
        node.routingTable.addNode({
          id: other.id,
          host: other.host,
          port: other.port,
        })
      }
    }

    this.dropRate = options.dropRate ?? 0
  }

  /**
   * Set the drop rate for simulating packet loss.
   * @param rate - Value between 0 (no drops) and 1 (all drops)
   */
  setDropRate(rate: number): void {
    this.dropRate = Math.max(0, Math.min(1, rate))
  }

  /**
   * Plant peers at nodes close to an infohash.
   * This simulates peers being announced to the DHT.
   *
   * @param infoHash - The infohash (20 bytes)
   * @param peers - Peers to plant
   * @param count - Number of nodes to plant at (default: K)
   */
  plantPeers(infoHash: Uint8Array, peers: CompactPeer[], count: number = K): void {
    // Find K closest nodes to the infohash
    const sorted = [...this.nodes].sort((a, b) => compareDistance(a.id, b.id, infoHash))
    const closest = sorted.slice(0, count)

    const infoHashHex = Array.from(infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    for (const node of closest) {
      node.peers.set(infoHashHex, [...peers])
    }
  }

  /**
   * Find a node by host:port.
   */
  findNode(host: string, port: number): MockDHTNode | undefined {
    return this.nodes.find((n) => n.host === host && n.port === port)
  }

  /**
   * Create a sendGetPeers function that properly handles infohash.
   *
   * @param infoHash - The infohash being searched for
   * @param sourceNodeId - Optional source node ID to exclude from results
   * @returns Function that queries a node
   */
  createGetPeersHandlerForInfohash(
    infoHash: Uint8Array,
    sourceNodeId?: Uint8Array,
  ): (node: CompactNodeInfo) => Promise<GetPeersResult | null> {
    const infoHashHex = Array.from(infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return async (queryNode: CompactNodeInfo): Promise<GetPeersResult | null> => {
      // Find the target mock node
      const mockNode = this.findNode(queryNode.host, queryNode.port)
      if (!mockNode) {
        return null
      }

      if (mockNode.dropRequests) {
        return null
      }

      if (Math.random() < this.dropRate) {
        return null
      }

      if (mockNode.responseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, mockNode.responseDelayMs))
      }

      // Generate token
      const token = new Uint8Array(8)
      crypto.getRandomValues(token)

      // Check for peers
      const peers = mockNode.peers.get(infoHashHex)

      if (peers && peers.length > 0) {
        // Node has peers - return them
        return {
          token,
          peers: [...peers],
        }
      }

      // No peers - return closest nodes
      let closestNodes = mockNode.routingTable.closest(infoHash, K)

      // Exclude source node if provided
      if (sourceNodeId) {
        closestNodes = closestNodes.filter((n) => !n.id.every((b, i) => b === sourceNodeId[i]))
      }

      return {
        token,
        nodes: closestNodes.map((n) => ({
          id: n.id,
          host: n.host,
          port: n.port,
        })),
      }
    }
  }

  /**
   * Get a random node from the network.
   */
  getRandomNode(): MockDHTNode {
    return this.nodes[Math.floor(Math.random() * this.nodes.length)]
  }

  /**
   * Get nodes closest to a target.
   */
  getClosestNodes(target: Uint8Array, count: number = K): MockDHTNode[] {
    return [...this.nodes].sort((a, b) => compareDistance(a.id, b.id, target)).slice(0, count)
  }
}

/**
 * Generate random peers for testing.
 */
export function generateMockPeers(count: number, baseIp: string = '192.168'): CompactPeer[] {
  const peers: CompactPeer[] = []
  for (let i = 0; i < count; i++) {
    peers.push({
      host: `${baseIp}.${Math.floor(i / 256)}.${i % 256}`,
      port: 51413 + i,
    })
  }
  return peers
}
