# DHT Phase 4: Outgoing Queries (Client Side) - Agent Task

**Status:** Ready for Implementation  
**Depends on:** Phases 1-3 (complete)  
**Goal:** Send KRPC queries to remote nodes and process responses

---

## Overview

This phase implements the client side of DHT communication - sending queries (`ping`, `find_node`, `get_peers`, `announce_peer`) to remote DHT nodes and processing their responses. This builds on the existing KRPC socket infrastructure from Phase 2 and complements the server-side query handlers from Phase 3.

### Files to Create

```
packages/engine/src/dht/
└── dht-node.ts              # Main DHTNode class with query methods

packages/engine/test/dht/
└── dht-node-queries.test.ts # Tests for outgoing query methods
```

### Files to Modify

```
packages/engine/src/dht/
└── index.ts                 # Add new exports
```

---

## Reference Material

- **BEP 5 Specification:** `beps_md/accepted/bep_0005.md`
- **Existing Message Encoding:** `src/dht/krpc-messages.ts`
- **KRPC Socket:** `src/dht/krpc-socket.ts`
- **Routing Table:** `src/dht/routing-table.ts`
- **Test Patterns:** `test/dht/query-handlers.test.ts`, `test/dht/krpc-socket.test.ts`

---

## Phase 4.1: Create DHTNode Class

Create the main `DHTNode` class that coordinates DHT operations.

### Create `packages/engine/src/dht/dht-node.ts`

```typescript
/**
 * DHT Node - Main Coordinator
 *
 * Manages DHT operations including sending queries, maintaining routing table,
 * and handling incoming requests.
 *
 * Reference: BEP 5 - DHT Protocol
 */

import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { RoutingTable } from './routing-table'
import { KRPCSocket, KRPCSocketOptions } from './krpc-socket'
import { TokenStore, TokenStoreOptions } from './token-store'
import { PeerStore, PeerStoreOptions } from './peer-store'
import { createQueryHandler, QueryHandlerDeps } from './query-handlers'
import {
  KRPCResponse,
  encodePingQuery,
  encodeFindNodeQuery,
  encodeGetPeersQuery,
  encodeAnnouncePeerQuery,
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
} from './krpc-messages'
import { DHTNode as DHTNodeInfo, CompactPeer, CompactNodeInfo } from './types'
import { generateRandomNodeId, nodeIdToHex } from './xor-distance'
import { NODE_ID_BYTES } from './constants'

/**
 * Result from a get_peers query.
 */
export interface GetPeersResult {
  /** Token for future announce_peer (always present in valid response) */
  token: Uint8Array
  /** Peers for the infohash (if the queried node knows any) */
  peers?: CompactPeer[]
  /** Closer nodes to query (if the queried node doesn't have peers) */
  nodes?: CompactNodeInfo[]
}

/**
 * Options for DHTNode.
 */
export interface DHTNodeOptions {
  /** Our node ID (20 bytes). If not provided, one will be generated. */
  nodeId?: Uint8Array
  /** Socket factory for creating UDP sockets */
  socketFactory: ISocketFactory
  /** KRPC socket options */
  krpcOptions?: KRPCSocketOptions
  /** Token store options */
  tokenOptions?: TokenStoreOptions
  /** Peer store options */
  peerOptions?: PeerStoreOptions
  /** Hash function for token generation (defaults to crypto.subtle.digest) */
  hashFn?: (data: Uint8Array) => Promise<Uint8Array>
}

/**
 * Events emitted by DHTNode.
 */
export interface DHTNodeEvents {
  /** Emitted when ready to send/receive queries */
  ready: () => void
  /** Emitted on errors */
  error: (err: Error) => void
  /** Emitted when a node is added to the routing table */
  nodeAdded: (node: DHTNodeInfo) => void
  /** Emitted when a node is removed from the routing table */
  nodeRemoved: (node: DHTNodeInfo) => void
}

/**
 * Main DHT node class.
 *
 * Coordinates all DHT operations:
 * - Maintains routing table
 * - Sends and receives KRPC queries
 * - Stores peer information for torrents
 */
export class DHTNode extends EventEmitter {
  /** Our 20-byte node ID */
  public readonly nodeId: Uint8Array

  /** K-bucket routing table */
  public readonly routingTable: RoutingTable

  /** KRPC socket for UDP communication */
  private readonly krpcSocket: KRPCSocket

  /** Token store for announce validation */
  private readonly tokenStore: TokenStore

  /** Peer store for infohash → peers mapping */
  private readonly peerStore: PeerStore

  /** Whether the node is ready (socket bound) */
  private _ready: boolean = false

  constructor(options: DHTNodeOptions) {
    super()

    // Generate or use provided node ID
    this.nodeId = options.nodeId ?? generateRandomNodeId()
    if (this.nodeId.length !== NODE_ID_BYTES) {
      throw new Error(`Node ID must be ${NODE_ID_BYTES} bytes`)
    }

    // Initialize components
    this.routingTable = new RoutingTable(this.nodeId)
    this.krpcSocket = new KRPCSocket(options.socketFactory, options.krpcOptions)
    this.tokenStore = new TokenStore({
      hashFn: options.hashFn,
      ...options.tokenOptions,
    })
    this.peerStore = new PeerStore(options.peerOptions)

    // Forward routing table events
    this.routingTable.on('nodeAdded', (node: DHTNodeInfo) => this.emit('nodeAdded', node))
    this.routingTable.on('nodeRemoved', (node: DHTNodeInfo) => this.emit('nodeRemoved', node))

    // Handle ping requests for full buckets
    this.routingTable.on('ping', (node: DHTNodeInfo) => {
      this.ping(node).then((alive) => {
        if (!alive) {
          this.routingTable.removeNode(node.id)
        }
      })
    })

    // Set up query handler for incoming queries
    const handlerDeps: QueryHandlerDeps = {
      nodeId: this.nodeId,
      routingTable: this.routingTable,
      tokenStore: this.tokenStore,
      peerStore: this.peerStore,
    }
    const queryHandler = createQueryHandler(this.krpcSocket, handlerDeps)
    this.krpcSocket.on('query', queryHandler)
  }

  /**
   * Check if the node is ready.
   */
  get ready(): boolean {
    return this._ready
  }

  /**
   * Get our node ID as hex string.
   */
  get nodeIdHex(): string {
    return nodeIdToHex(this.nodeId)
  }

  /**
   * Start the DHT node (bind socket).
   */
  async start(): Promise<void> {
    if (this._ready) {
      throw new Error('DHTNode already started')
    }

    await this.krpcSocket.bind()
    this._ready = true
    this.emit('ready')
  }

  /**
   * Stop the DHT node (close socket, cleanup).
   */
  stop(): void {
    this._ready = false
    this.krpcSocket.close()
    this.tokenStore.destroy()
  }

  // ==========================================================================
  // Outgoing Queries
  // ==========================================================================

  /**
   * Send a ping query to a node.
   *
   * Used to verify a node is still alive and to learn its node ID.
   *
   * @param node - Node to ping (must have host and port)
   * @returns true if node responded, false on timeout/error
   */
  async ping(node: { host: string; port: number; id?: Uint8Array }): Promise<boolean> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    const transactionId = this.krpcSocket.generateTransactionId()
    const queryData = encodePingQuery(transactionId, this.nodeId)

    try {
      const response = await this.krpcSocket.query(
        node.host,
        node.port,
        queryData,
        transactionId,
        'ping',
      )

      // Extract responding node's ID
      const responseNodeId = getResponseNodeId(response)
      if (responseNodeId) {
        // Update routing table with the responding node
        this.routingTable.addNode({
          id: responseNodeId,
          host: node.host,
          port: node.port,
          lastSeen: Date.now(),
        })
      }

      return true
    } catch {
      // Timeout or error - node did not respond
      return false
    }
  }

  /**
   * Send a find_node query to discover nodes close to a target.
   *
   * Used for routing table maintenance and bootstrap.
   *
   * @param node - Node to query
   * @param target - 20-byte target ID to find nodes close to
   * @returns Array of nodes close to the target
   */
  async findNode(
    node: { host: string; port: number; id?: Uint8Array },
    target: Uint8Array,
  ): Promise<CompactNodeInfo[]> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (target.length !== NODE_ID_BYTES) {
      throw new Error(`Target must be ${NODE_ID_BYTES} bytes`)
    }

    const transactionId = this.krpcSocket.generateTransactionId()
    const queryData = encodeFindNodeQuery(transactionId, this.nodeId, target)

    try {
      const response = await this.krpcSocket.query(
        node.host,
        node.port,
        queryData,
        transactionId,
        'find_node',
      )

      // Add responding node to routing table
      const responseNodeId = getResponseNodeId(response)
      if (responseNodeId) {
        this.routingTable.addNode({
          id: responseNodeId,
          host: node.host,
          port: node.port,
          lastSeen: Date.now(),
        })
      }

      // Decode and return the nodes from the response
      const nodes = getResponseNodes(response)
      return nodes
    } catch {
      // Timeout or error
      return []
    }
  }

  /**
   * Send a get_peers query to find peers for a torrent.
   *
   * If the queried node has peers, they are returned in `peers`.
   * Otherwise, closer nodes are returned in `nodes`.
   * A `token` is always returned for use in subsequent announce_peer.
   *
   * @param node - Node to query
   * @param infoHash - 20-byte torrent infohash
   * @returns GetPeersResult with token and either peers or nodes
   */
  async getPeers(
    node: { host: string; port: number; id?: Uint8Array },
    infoHash: Uint8Array,
  ): Promise<GetPeersResult | null> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    const transactionId = this.krpcSocket.generateTransactionId()
    const queryData = encodeGetPeersQuery(transactionId, this.nodeId, infoHash)

    try {
      const response = await this.krpcSocket.query(
        node.host,
        node.port,
        queryData,
        transactionId,
        'get_peers',
      )

      // Add responding node to routing table
      const responseNodeId = getResponseNodeId(response)
      if (responseNodeId) {
        this.routingTable.addNode({
          id: responseNodeId,
          host: node.host,
          port: node.port,
          lastSeen: Date.now(),
        })
      }

      // Extract token (required in valid response)
      const token = getResponseToken(response)
      if (!token) {
        // Invalid response - no token
        return null
      }

      // Build result
      const result: GetPeersResult = { token }

      // Check for peers (values)
      const peers = getResponsePeers(response)
      if (peers.length > 0) {
        result.peers = peers
      }

      // Check for nodes
      const nodes = getResponseNodes(response)
      if (nodes.length > 0) {
        result.nodes = nodes
      }

      return result
    } catch {
      // Timeout or error
      return null
    }
  }

  /**
   * Send an announce_peer query to advertise ourselves for a torrent.
   *
   * The token must be one received from a recent get_peers query to the same node.
   *
   * @param node - Node to announce to
   * @param infoHash - 20-byte torrent infohash
   * @param port - Port we're listening on for BitTorrent connections
   * @param token - Token received from previous get_peers to this node
   * @param impliedPort - If true, tell node to use UDP source port instead
   * @returns true on success, false on error/timeout
   */
  async announcePeer(
    node: { host: string; port: number; id?: Uint8Array },
    infoHash: Uint8Array,
    port: number,
    token: Uint8Array,
    impliedPort: boolean = false,
  ): Promise<boolean> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    const transactionId = this.krpcSocket.generateTransactionId()
    const queryData = encodeAnnouncePeerQuery(
      transactionId,
      this.nodeId,
      infoHash,
      port,
      token,
      impliedPort,
    )

    try {
      const response = await this.krpcSocket.query(
        node.host,
        node.port,
        queryData,
        transactionId,
        'announce_peer',
      )

      // Add responding node to routing table
      const responseNodeId = getResponseNodeId(response)
      if (responseNodeId) {
        this.routingTable.addNode({
          id: responseNodeId,
          host: node.host,
          port: node.port,
          lastSeen: Date.now(),
        })
      }

      return true
    } catch {
      // Timeout or KRPC error response
      return false
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Add a node to the routing table.
   * Useful for seeding from known nodes.
   */
  addNode(node: DHTNodeInfo): boolean {
    return this.routingTable.addNode(node)
  }

  /**
   * Get the number of nodes in the routing table.
   */
  getNodeCount(): number {
    return this.routingTable.size()
  }

  /**
   * Get all nodes in the routing table.
   */
  getAllNodes(): DHTNodeInfo[] {
    return this.routingTable.getAllNodes()
  }

  /**
   * Get the closest nodes to a target.
   */
  getClosestNodes(target: Uint8Array, count?: number): DHTNodeInfo[] {
    return this.routingTable.closest(target, count)
  }
}
```

---

## Phase 4.2: Create Tests

Create comprehensive tests for the outgoing query methods.

### Create `packages/engine/test/dht/dht-node-queries.test.ts`

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DHTNode, GetPeersResult } from '../../src/dht/dht-node'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'
import {
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  KRPCErrorCode,
  decodeMessage,
  isQuery,
  getQueryNodeId,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'
import { DHTNode as DHTNodeInfo } from '../../src/dht/types'

// =============================================================================
// Mock UDP Socket
// =============================================================================

class MockUdpSocket implements IUdpSocket {
  public sentData: Array<{ addr: string; port: number; data: Uint8Array }> = []
  private messageCallback:
    | ((rinfo: { addr: string; port: number }, data: Uint8Array) => void)
    | null = null

  send(addr: string, port: number, data: Uint8Array): void {
    this.sentData.push({ addr, port, data: new Uint8Array(data) })
  }

  onMessage(cb: (rinfo: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.messageCallback = cb
  }

  close(): void {
    this.messageCallback = null
  }

  async joinMulticast(_group: string): Promise<void> {}
  async leaveMulticast(_group: string): Promise<void> {}

  /**
   * Simulate receiving a message from a remote node.
   */
  emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
    if (this.messageCallback) {
      this.messageCallback({ addr, port }, data)
    }
  }

  /**
   * Get the last sent query's transaction ID.
   */
  getLastTransactionId(): Uint8Array | null {
    if (this.sentData.length === 0) return null
    const lastMsg = decodeMessage(this.sentData[this.sentData.length - 1].data)
    if (lastMsg && isQuery(lastMsg)) {
      return lastMsg.t
    }
    return null
  }

  /**
   * Clear sent data.
   */
  clear(): void {
    this.sentData = []
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
  // Simple deterministic hash for testing
  let sum = 0
  for (const byte of data) {
    sum = (sum + byte) % 256
  }
  return new Uint8Array(20).fill(sum)
}

// =============================================================================
// Test Fixtures
// =============================================================================

const localNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
const remoteNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x33)
const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x44)

function createTestNode(factory: MockSocketFactory): DHTNode {
  return new DHTNode({
    nodeId: localNodeId,
    socketFactory: factory,
    krpcOptions: { timeout: 100 }, // Short timeout for tests
    hashFn: mockHashFn,
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('DHTNode Outgoing Queries', () => {
  let factory: MockSocketFactory
  let dhtNode: DHTNode

  beforeEach(async () => {
    vi.useFakeTimers()
    factory = new MockSocketFactory()
    dhtNode = createTestNode(factory)
    await dhtNode.start()
  })

  afterEach(() => {
    dhtNode.stop()
    vi.useRealTimers()
  })

  // ===========================================================================
  // ping() Tests
  // ===========================================================================

  describe('ping()', () => {
    it('returns true on response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await pingPromise
      expect(result).toBe(true)
    })

    it('returns false on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Advance past timeout without sending response
      vi.advanceTimersByTime(200)

      const result = await pingPromise
      expect(result).toBe(false)
    })

    it('updates routing table on success', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Simulate response with node ID
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await pingPromise

      // Check routing table was updated
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find(
        (n) => n.host === remoteNode.host && n.port === remoteNode.port,
      )
      expect(found).toBeDefined()
      expect(found!.id).toEqual(remoteNodeId)
    })

    it('does not update routing table on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const initialCount = dhtNode.getNodeCount()

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      await pingPromise

      // Routing table should not have changed
      expect(dhtNode.getNodeCount()).toBe(initialCount)
    })

    it('throws if node not started', async () => {
      const newNode = new DHTNode({
        nodeId: localNodeId,
        socketFactory: factory,
        hashFn: mockHashFn,
      })

      await expect(newNode.ping({ host: '127.0.0.1', port: 6881 })).rejects.toThrow(
        'not started',
      )
    })
  })

  // ===========================================================================
  // findNode() Tests
  // ===========================================================================

  describe('findNode()', () => {
    it('decodes compact node info from response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Create some nodes to return in response
      const responseNodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x31), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x32), host: '10.0.0.3', port: 6883 },
      ]

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeFindNodeResponse(txId, remoteNodeId, responseNodes)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await findPromise

      // Verify decoded nodes
      expect(result.length).toBe(3)
      expect(result[0].host).toBe('10.0.0.1')
      expect(result[0].port).toBe(6881)
      expect(result[1].host).toBe('10.0.0.2')
      expect(result[2].host).toBe('10.0.0.3')
    })

    it('adds responding node to routing table', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeFindNodeResponse(txId, remoteNodeId, [])
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await findPromise

      // Check responding node was added to routing table
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
      expect(found!.id).toEqual(remoteNodeId)
    })

    it('returns empty array on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await findPromise
      expect(result).toEqual([])
    })

    it('returns empty array on error response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate error response
      const txId = factory.mockSocket.getLastTransactionId()!
      const errorData = encodeErrorResponse(txId, KRPCErrorCode.SERVER, 'Server error')
      factory.mockSocket.emitMessage(errorData, remoteNode.host, remoteNode.port)

      const result = await findPromise
      expect(result).toEqual([])
    })

    it('validates target length', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidTarget = new Uint8Array(10) // Wrong length

      await expect(dhtNode.findNode(remoteNode, invalidTarget)).rejects.toThrow('20 bytes')
    })
  })

  // ===========================================================================
  // getPeers() Tests
  // ===========================================================================

  describe('getPeers()', () => {
    it('returns peers when values present', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testPeers = [
        { host: '10.0.0.1', port: 6881 },
        { host: '10.0.0.2', port: 6882 },
      ]
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])

      // Start get_peers
      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Simulate response with peers
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithPeers(
        txId,
        remoteNodeId,
        testToken,
        testPeers,
      )
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await getPeersPromise

      expect(result).not.toBeNull()
      expect(result!.peers).toBeDefined()
      expect(result!.peers!.length).toBe(2)
      expect(result!.peers![0].host).toBe('10.0.0.1')
      expect(result!.peers![1].host).toBe('10.0.0.2')
    })

    it('returns nodes when nodes present', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testNodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x50), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x51), host: '10.0.0.2', port: 6882 },
      ]
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])

      // Start get_peers
      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Simulate response with nodes (no peers)
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithNodes(
        txId,
        remoteNodeId,
        testToken,
        testNodes,
      )
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await getPeersPromise

      expect(result).not.toBeNull()
      expect(result!.nodes).toBeDefined()
      expect(result!.nodes!.length).toBe(2)
      expect(result!.nodes![0].host).toBe('10.0.0.1')
      expect(result!.nodes![1].host).toBe('10.0.0.2')
    })

    it('always returns token', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

      // Test with peers response
      const getPeersPromise1 = dhtNode.getPeers(remoteNode, infoHash)
      const txId1 = factory.mockSocket.getLastTransactionId()!
      const responseData1 = encodeGetPeersResponseWithPeers(txId1, remoteNodeId, testToken, [
        { host: '10.0.0.1', port: 6881 },
      ])
      factory.mockSocket.emitMessage(responseData1, remoteNode.host, remoteNode.port)

      const result1 = await getPeersPromise1
      expect(result1!.token).toEqual(testToken)

      // Test with nodes response
      factory.mockSocket.clear()
      const getPeersPromise2 = dhtNode.getPeers(remoteNode, infoHash)
      const txId2 = factory.mockSocket.getLastTransactionId()!
      const responseData2 = encodeGetPeersResponseWithNodes(txId2, remoteNodeId, testToken, [])
      factory.mockSocket.emitMessage(responseData2, remoteNode.host, remoteNode.port)

      const result2 = await getPeersPromise2
      expect(result2!.token).toEqual(testToken)
    })

    it('returns null on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await getPeersPromise
      expect(result).toBeNull()
    })

    it('adds responding node to routing table', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])

      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithNodes(txId, remoteNodeId, testToken, [])
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await getPeersPromise

      // Check responding node was added
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
    })

    it('validates info_hash length', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidInfoHash = new Uint8Array(10)

      await expect(dhtNode.getPeers(remoteNode, invalidInfoHash)).rejects.toThrow('20 bytes')
    })
  })

  // ===========================================================================
  // announcePeer() Tests
  // ===========================================================================

  describe('announcePeer()', () => {
    it('returns true on success', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(
        remoteNode,
        infoHash,
        testPort,
        testToken,
      )

      // Simulate successful response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeAnnouncePeerResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await announcePromise
      expect(result).toBe(true)
    })

    it('returns false on error response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidToken = new Uint8Array([0xff, 0xfe, 0xfd])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(
        remoteNode,
        infoHash,
        testPort,
        invalidToken,
      )

      // Simulate error response (bad token)
      const txId = factory.mockSocket.getLastTransactionId()!
      const errorData = encodeErrorResponse(txId, KRPCErrorCode.PROTOCOL, 'Invalid token')
      factory.mockSocket.emitMessage(errorData, remoteNode.host, remoteNode.port)

      const result = await announcePromise
      expect(result).toBe(false)
    })

    it('returns false on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(
        remoteNode,
        infoHash,
        testPort,
        testToken,
      )

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await announcePromise
      expect(result).toBe(false)
    })

    it('sends correct query data', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc])
      const testPort = 51413

      dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken)

      // Verify sent data
      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe(remoteNode.host)
      expect(factory.mockSocket.sentData[0].port).toBe(remoteNode.port)

      // Decode and verify query contents
      const sentMsg = decodeMessage(factory.mockSocket.sentData[0].data)
      expect(sentMsg).not.toBeNull()
      expect(isQuery(sentMsg!)).toBe(true)
      const query = sentMsg as any
      expect(query.q).toBe('announce_peer')
      expect(query.a.info_hash).toEqual(infoHash)
      expect(query.a.port).toBe(testPort)
      expect(query.a.token).toEqual(testToken)
    })

    it('sends implied_port flag when requested', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken, true)

      const sentMsg = decodeMessage(factory.mockSocket.sentData[0].data)
      const query = sentMsg as any
      expect(query.a.implied_port).toBe(1)
    })

    it('updates routing table on success', async () => {
      const remoteNode = { host: '192.168.1.100', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(
        remoteNode,
        infoHash,
        testPort,
        testToken,
      )

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeAnnouncePeerResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await announcePromise

      // Check responding node was added
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
    })
  })

  // ===========================================================================
  // General DHTNode Tests
  // ===========================================================================

  describe('DHTNode lifecycle', () => {
    it('can start and stop', async () => {
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
      })

      expect(node.ready).toBe(false)

      await node.start()
      expect(node.ready).toBe(true)

      node.stop()
      expect(node.ready).toBe(false)
    })

    it('throws if started twice', async () => {
      await expect(dhtNode.start()).rejects.toThrow('already started')
    })

    it('generates node ID if not provided', async () => {
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
      })

      expect(node.nodeId.length).toBe(NODE_ID_BYTES)
      // Should be random, not all zeros
      expect(node.nodeId.some((b) => b !== 0)).toBe(true)

      node.stop()
    })

    it('validates provided node ID length', () => {
      expect(
        () =>
          new DHTNode({
            nodeId: new Uint8Array(10), // Wrong length
            socketFactory: new MockSocketFactory(),
            hashFn: mockHashFn,
          }),
      ).toThrow('20 bytes')
    })

    it('exposes nodeIdHex getter', () => {
      expect(dhtNode.nodeIdHex).toBe('1111111111111111111111111111111111111111')
    })
  })

  describe('utility methods', () => {
    it('addNode() adds to routing table', () => {
      const node: DHTNodeInfo = {
        id: new Uint8Array(20).fill(0x50),
        host: '10.0.0.1',
        port: 6881,
      }

      const result = dhtNode.addNode(node)
      expect(result).toBe(true)
      expect(dhtNode.getNodeCount()).toBe(1)
    })

    it('getClosestNodes() returns nodes sorted by distance', () => {
      // Add some nodes
      const nodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x20), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x40), host: '10.0.0.3', port: 6883 },
      ]
      for (const node of nodes) {
        dhtNode.addNode(node)
      }

      const closest = dhtNode.getClosestNodes(targetId, 2)
      expect(closest.length).toBe(2)
    })
  })

  describe('events', () => {
    it('emits nodeAdded when routing table adds node', async () => {
      const nodeAddedHandler = vi.fn()
      dhtNode.on('nodeAdded', nodeAddedHandler)

      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const pingPromise = dhtNode.ping(remoteNode)

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await pingPromise

      expect(nodeAddedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          host: remoteNode.host,
          port: remoteNode.port,
        }),
      )
    })

    it('emits ready when started', async () => {
      const readyHandler = vi.fn()
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
      })
      node.on('ready', readyHandler)

      await node.start()

      expect(readyHandler).toHaveBeenCalled()

      node.stop()
    })
  })
})
```

---

## Phase 4.3: Update Exports

Update the index.ts file to export the new DHTNode class.

### Modify `packages/engine/src/dht/index.ts`

Add the following exports at the end of the file:

```typescript
// ============================================================================
// Phase 4 Exports - DHTNode (Client Side)
// ============================================================================

// DHTNode class and types
export type { DHTNodeOptions, DHTNodeEvents, GetPeersResult } from './dht-node'
export { DHTNode } from './dht-node'
```

The complete index.ts should look like this (showing the new section to add):

**Find this at the end of the file:**

```typescript
// Query Handlers
export type { QueryHandlerResult, QueryHandlerDeps } from './query-handlers'
export {
  handlePing,
  handleFindNode,
  handleGetPeers,
  handleAnnouncePeer,
  handleUnknownMethod,
  routeQuery,
  createQueryHandler,
} from './query-handlers'
```

**Add after it:**

```typescript

// ============================================================================
// Phase 4 Exports - DHTNode (Client Side)
// ============================================================================

// DHTNode class and types
export type { DHTNodeOptions, DHTNodeEvents, GetPeersResult } from './dht-node'
export { DHTNode } from './dht-node'
```

---

## Verification Steps

After implementing, run these commands to verify:

### 1. TypeScript Type Checking

```bash
cd packages/engine
pnpm typecheck
```

Expected: No errors

### 2. Run Tests

```bash
# Run only the new test file
cd packages/engine
pnpm test -- test/dht/dht-node-queries.test.ts

# Run all DHT tests
pnpm test -- test/dht/

# Run all engine tests
pnpm test
```

Expected: All tests pass

### 3. Lint Check

```bash
cd packages/engine
pnpm lint
```

Expected: No errors

### 4. Format Check

```bash
# From monorepo root
pnpm format:fix
```

---

## Test Coverage Summary

The test file covers all requirements from the super-task:

| Requirement | Test |
|-------------|------|
| `ping()` returns true on response | ✅ `returns true on response` |
| `ping()` returns false on timeout | ✅ `returns false on timeout` |
| `ping()` updates routing table on success | ✅ `updates routing table on success` |
| `findNode()` decodes compact node info | ✅ `decodes compact node info from response` |
| `findNode()` adds responding node to routing table | ✅ `adds responding node to routing table` |
| `getPeers()` returns peers when values present | ✅ `returns peers when values present` |
| `getPeers()` returns nodes when nodes present | ✅ `returns nodes when nodes present` |
| `getPeers()` always returns token | ✅ `always returns token` |
| `announcePeer()` returns true on success | ✅ `returns true on success` |
| `announcePeer()` returns false on error response | ✅ `returns false on error response` |

---

## Implementation Notes

### Key Patterns Used

1. **Mock UDP Socket**: Uses the same `MockUdpSocket` pattern as `krpc-socket.test.ts`
2. **Fake Timers**: Uses `vi.useFakeTimers()` for testing timeouts
3. **Transaction ID Extraction**: Helper method `getLastTransactionId()` extracts TxID from sent data
4. **Response Simulation**: Tests simulate responses by calling `emitMessage()` on mock socket

### Error Handling

- All query methods catch errors and return appropriate failure values (false, null, empty array)
- Invalid inputs (wrong ID lengths) throw immediately
- Operations on stopped node throw errors

### Routing Table Integration

- All successful responses update the routing table with the responding node's ID
- The `ping` event from routing table triggers automatic ping to questionable nodes

---

## Dependencies

This phase uses only existing code from Phases 1-3:

- `RoutingTable` from `routing-table.ts`
- `KRPCSocket` from `krpc-socket.ts`
- `TokenStore` from `token-store.ts`
- `PeerStore` from `peer-store.ts`
- Message encoding/decoding from `krpc-messages.ts`
- XOR utilities from `xor-distance.ts`
- Query handlers from `query-handlers.ts`

No external dependencies needed.
