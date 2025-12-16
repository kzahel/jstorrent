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
  encodePingQuery,
  encodeFindNodeQuery,
  encodeGetPeersQuery,
  encodeAnnouncePeerQuery,
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
} from './krpc-messages'
import { DHTNodeInfo, CompactPeer, CompactNodeInfo } from './types'
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
    this.tokenStore.stopRotation()
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
