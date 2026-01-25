/**
 * DHT Node - Main Coordinator
 *
 * Manages DHT operations including sending queries, maintaining routing table,
 * and handling incoming requests.
 *
 * Reference: BEP 5 - DHT Protocol
 */

import { EventEmitter } from '../utils/event-emitter'
import { SleepWakeDetector, WakeEvent } from '../utils/sleep-wake-detector'
import { ISocketFactory } from '../interfaces/socket'
import type { Logger } from '../logging/logger'
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
import type { BandwidthTracker } from '../core/bandwidth-tracker'
import { DHTNodeInfo, CompactPeer, CompactNodeInfo } from './types'
import {
  generateRandomNodeId,
  nodeIdToHex,
  compareDistance,
  generateRandomIdInBucket,
} from './xor-distance'
import {
  NODE_ID_BYTES,
  K,
  BOOTSTRAP_NODES,
  BOOTSTRAP_CONCURRENCY,
  BOOTSTRAP_MAX_ITERATIONS,
  BUCKET_REFRESH_MS,
  PEER_CLEANUP_MS,
} from './constants'
import { iterativeLookup, LookupResult } from './iterative-lookup'

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
 * Result from an announce operation.
 */
export interface AnnounceResult {
  /** Number of nodes we successfully announced to */
  successCount: number
  /** Number of nodes we tried to announce to */
  totalCount: number
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
  /**
   * Skip starting maintenance timers.
   * Useful for tests that use fake timers.
   * @default false
   */
  skipMaintenance?: boolean
  /** Logger for debug output. If not provided, logs are not emitted. */
  logger?: Logger
  /** Bandwidth tracker for recording DHT traffic */
  bandwidthTracker?: BandwidthTracker
}

/**
 * Options for the bootstrap process.
 */
export interface BootstrapOptions {
  /**
   * Bootstrap nodes to contact initially.
   * Defaults to BOOTSTRAP_NODES from constants.
   */
  nodes?: ReadonlyArray<{ host: string; port: number }>

  /**
   * Maximum concurrent queries.
   * Defaults to BOOTSTRAP_CONCURRENCY (3).
   */
  concurrency?: number

  /**
   * Maximum iterations to prevent infinite loops.
   * Defaults to BOOTSTRAP_MAX_ITERATIONS (20).
   */
  maxIterations?: number
}

/**
 * Statistics from the bootstrap process.
 */
export interface BootstrapStats {
  /** Number of nodes queried */
  queriedCount: number
  /** Number of successful responses */
  responsesReceived: number
  /** Number of timeouts/errors */
  failures: number
  /** Final routing table size */
  routingTableSize: number
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * DHT node statistics for UI display.
 */
export interface DHTStats {
  // Basic info
  enabled: boolean
  ready: boolean
  nodeId: string
  nodeCount: number
  bucketCount: number

  // Traffic
  bytesSent: number
  bytesReceived: number

  // Queries sent (attempts)
  pingsSent: number
  findNodesSent: number
  getPeersSent: number
  announcesSent: number

  // Queries succeeded
  pingsSucceeded: number
  findNodesSucceeded: number
  getPeersSucceeded: number
  announcesSucceeded: number

  // Queries received
  pingsReceived: number
  findNodesReceived: number
  getPeersReceived: number
  announcesReceived: number

  // Errors
  timeouts: number
  errors: number

  // Peer discovery
  peersDiscovered: number
}

/**
 * Events emitted by DHTNode.
 */
export interface DHTNodeEvents {
  /** Emitted when ready to send/receive queries */
  ready: () => void
  /** Emitted when bootstrap process completes */
  bootstrapped: (stats: BootstrapStats) => void
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

  /** Whether bootstrap has completed (routing table populated) */
  private _bootstrapped: boolean = false

  /** Bucket refresh timer */
  private bucketRefreshTimer: ReturnType<typeof setTimeout> | null = null

  /** Peer cleanup timer */
  private peerCleanupTimer: ReturnType<typeof setTimeout> | null = null

  /** Sleep/wake detector for automatic refresh on system wake */
  private sleepWakeDetector: SleepWakeDetector | null = null

  /** Skip maintenance timers (for tests) */
  private readonly skipMaintenance: boolean

  /** Optional logger for debug output */
  private readonly logger?: Logger

  // Query counters (sent)
  private _pingsSent = 0
  private _findNodesSent = 0
  private _getPeersSent = 0
  private _announcesSent = 0

  // Query success counters
  private _pingsSucceeded = 0
  private _findNodesSucceeded = 0
  private _getPeersSucceeded = 0
  private _announcesSucceeded = 0

  // Query counters (received) - incremented via callback from query handler
  private _pingsReceived = 0
  private _findNodesReceived = 0
  private _getPeersReceived = 0
  private _announcesReceived = 0

  // Error counters
  private _timeouts = 0
  private _errors = 0

  // Peer discovery counter
  private _peersDiscovered = 0

  // Staleness detection - track recent query results
  private readonly _recentResults: boolean[] = [] // true = success, false = timeout
  private readonly _recentResultsMaxSize = 20
  private _isRebootstrapping = false
  private static readonly STALENESS_THRESHOLD = 0.9 // 90% failure rate triggers re-bootstrap

  constructor(options: DHTNodeOptions) {
    super()

    // Generate or use provided node ID
    this.nodeId = options.nodeId ?? generateRandomNodeId()
    if (this.nodeId.length !== NODE_ID_BYTES) {
      throw new Error(`Node ID must be ${NODE_ID_BYTES} bytes`)
    }

    // Initialize components
    this.routingTable = new RoutingTable(this.nodeId)
    this.krpcSocket = new KRPCSocket(options.socketFactory, {
      ...options.krpcOptions,
      bandwidthTracker: options.bandwidthTracker,
    })
    this.tokenStore = new TokenStore({
      hashFn: options.hashFn,
      ...options.tokenOptions,
    })
    this.peerStore = new PeerStore(options.peerOptions)
    this.skipMaintenance = options.skipMaintenance ?? false
    this.logger = options.logger

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
      onQueryReceived: (queryType) => this.incrementReceivedCounter(queryType),
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
   * Check if bootstrap has completed.
   * Lookups are more efficient after bootstrap populates the routing table.
   */
  get isBootstrapped(): boolean {
    return this._bootstrapped
  }

  /**
   * Get our node ID as hex string.
   */
  get nodeIdHex(): string {
    return nodeIdToHex(this.nodeId)
  }

  /**
   * Start the DHT node (bind socket, start maintenance).
   */
  async start(): Promise<void> {
    if (this._ready) {
      throw new Error('DHTNode already started')
    }

    this.logger?.debug('Starting DHT node...')
    await this.krpcSocket.bind()
    this._ready = true

    // Start maintenance timers (unless skipped for tests)
    if (!this.skipMaintenance) {
      this.startMaintenance()
    }

    this.logger?.info(`DHT node started with ID ${this.nodeIdHex.slice(0, 8)}...`)
    this.emit('ready')
  }

  /**
   * Stop the DHT node (close socket, stop maintenance, cleanup).
   */
  stop(): void {
    this.logger?.info('Stopping DHT node')
    this._ready = false
    this._bootstrapped = false

    // Stop maintenance timers
    this.stopMaintenance()

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
    this._pingsSent++

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

      this._pingsSucceeded++
      this.recordQueryResult(true)
      return true
    } catch {
      // Timeout or error - node did not respond
      this._timeouts++
      this.recordQueryResult(false)
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
    this._findNodesSent++

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
      this._findNodesSucceeded++
      this.recordQueryResult(true)
      return nodes
    } catch {
      // Timeout or error
      this._timeouts++
      this.recordQueryResult(false)
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
    this._getPeersSent++

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

      this._getPeersSucceeded++
      this.recordQueryResult(true)
      return result
    } catch {
      // Timeout or error
      this._timeouts++
      this.recordQueryResult(false)
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
    this._announcesSent++

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

      this._announcesSucceeded++
      this.recordQueryResult(true)
      return true
    } catch {
      // Timeout or KRPC error response
      this._timeouts++
      this.recordQueryResult(false)
      return false
    }
  }

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  /**
   * Bootstrap the DHT by discovering nodes close to ourselves.
   *
   * This implements the Kademlia bootstrap algorithm:
   * 1. Query bootstrap nodes with find_node(our_id)
   * 2. From responses, query nodes closer to us that we haven't queried
   * 3. Repeat until no closer unqueried nodes exist
   *
   * @param options - Bootstrap options
   * @returns Bootstrap statistics
   */
  async bootstrap(options: BootstrapOptions = {}): Promise<BootstrapStats> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    this.logger?.info('Starting DHT bootstrap...')
    const startTime = Date.now()
    const bootstrapNodes = options.nodes ?? BOOTSTRAP_NODES
    const concurrency = options.concurrency ?? BOOTSTRAP_CONCURRENCY
    const maxIterations = options.maxIterations ?? BOOTSTRAP_MAX_ITERATIONS

    // Statistics
    let queriedCount = 0
    let responsesReceived = 0
    let failures = 0

    // Track which nodes we've already queried (by host:port since we don't know IDs yet)
    const queried = new Set<string>()
    const nodeKey = (host: string, port: number) => `${host}:${port}`

    // Candidates to query, sorted by distance to self (closest first)
    // Initially populated with bootstrap nodes (unknown distance)
    const candidates: Array<{ host: string; port: number; id?: Uint8Array }> = [
      ...bootstrapNodes.map((n) => ({ host: n.host, port: n.port })),
    ]

    // Helper to query a single node
    // Note: We use KRPC socket directly instead of findNode() because findNode()
    // catches errors and returns []. We need to distinguish success from failure
    // for accurate statistics.
    const queryNode = async (node: {
      host: string
      port: number
      id?: Uint8Array
    }): Promise<CompactNodeInfo[]> => {
      const key = nodeKey(node.host, node.port)
      if (queried.has(key)) {
        return []
      }
      queried.add(key)
      queriedCount++

      const transactionId = this.krpcSocket.generateTransactionId()
      const queryData = encodeFindNodeQuery(transactionId, this.nodeId, this.nodeId)

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

        responsesReceived++
        return getResponseNodes(response)
      } catch {
        failures++
        return []
      }
    }

    // Process candidates in waves
    let iteration = 0
    let foundCloserNodes = true

    while (foundCloserNodes && iteration < maxIterations && candidates.length > 0) {
      iteration++
      foundCloserNodes = false

      // Get up to `concurrency` unqueried candidates
      const batch: Array<{ host: string; port: number; id?: Uint8Array }> = []
      for (const candidate of candidates) {
        if (!queried.has(nodeKey(candidate.host, candidate.port))) {
          batch.push(candidate)
          if (batch.length >= concurrency) break
        }
      }

      if (batch.length === 0) {
        break
      }

      // Query batch in parallel
      const results = await Promise.all(batch.map(queryNode))

      // Collect all new nodes from responses
      const newNodes: CompactNodeInfo[] = []
      for (const nodes of results) {
        for (const node of nodes) {
          const key = nodeKey(node.host, node.port)
          if (!queried.has(key)) {
            newNodes.push(node)
          }
        }
      }

      // Add new nodes to candidates
      if (newNodes.length > 0) {
        foundCloserNodes = true

        // Add new nodes (they may already be in routing table from findNode responses)
        for (const node of newNodes) {
          // Check if this node is already in candidates
          const existingIdx = candidates.findIndex(
            (c) => c.host === node.host && c.port === node.port,
          )
          if (existingIdx === -1) {
            candidates.push({ host: node.host, port: node.port, id: node.id })
          } else if (!candidates[existingIdx].id && node.id) {
            // Update with ID if we now have it
            candidates[existingIdx].id = node.id
          }
        }

        // Sort candidates by distance to self (closest first)
        // Nodes without ID go to the end
        candidates.sort((a, b) => {
          if (!a.id && !b.id) return 0
          if (!a.id) return 1
          if (!b.id) return -1
          return compareDistance(a.id, b.id, this.nodeId)
        })

        // Keep only the K closest unqueried + some buffer
        const maxCandidates = K * 3
        while (candidates.length > maxCandidates) {
          candidates.pop()
        }
      }
    }

    const stats: BootstrapStats = {
      queriedCount,
      responsesReceived,
      failures,
      routingTableSize: this.routingTable.size(),
      durationMs: Date.now() - startTime,
    }

    this.logger?.info(
      `DHT bootstrap complete: ${stats.routingTableSize} nodes, ` +
        `${stats.responsesReceived}/${stats.queriedCount} responses, ${stats.durationMs}ms`,
    )
    this._bootstrapped = true
    this.emit('bootstrapped', stats)
    return stats
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Start all maintenance timers.
   * Uses setTimeout with self-rescheduling for better test compatibility.
   */
  private startMaintenance(): void {
    // Token rotation
    this.tokenStore.startRotation()

    // Bucket refresh - check every minute, refresh stale buckets
    const scheduleBucketRefresh = () => {
      this.bucketRefreshTimer = setTimeout(() => {
        this.refreshStaleBuckets()
        if (this._ready) {
          scheduleBucketRefresh()
        }
      }, 60 * 1000)
    }
    scheduleBucketRefresh()

    // Peer cleanup
    const schedulePeerCleanup = () => {
      this.peerCleanupTimer = setTimeout(() => {
        this.peerStore.cleanup()
        if (this._ready) {
          schedulePeerCleanup()
        }
      }, PEER_CLEANUP_MS)
    }
    schedulePeerCleanup()

    // Sleep/wake detection for automatic refresh on system wake
    this.sleepWakeDetector = new SleepWakeDetector()
    this.sleepWakeDetector.on('wake', (event: WakeEvent) => {
      this.handleSystemWake(event).catch((err) => {
        this.logger?.warn('Error handling system wake', err)
      })
    })
    this.sleepWakeDetector.start()
  }

  /**
   * Stop all maintenance timers.
   */
  private stopMaintenance(): void {
    if (this.bucketRefreshTimer) {
      clearTimeout(this.bucketRefreshTimer)
      this.bucketRefreshTimer = null
    }

    if (this.peerCleanupTimer) {
      clearTimeout(this.peerCleanupTimer)
      this.peerCleanupTimer = null
    }

    if (this.sleepWakeDetector) {
      this.sleepWakeDetector.stop()
      this.sleepWakeDetector = null
    }
  }

  // ==========================================================================
  // Sleep/Wake Detection
  // ==========================================================================

  /**
   * Handle system wake from sleep.
   * Refreshes the DHT routing table based on sleep duration.
   */
  private async handleSystemWake(event: WakeEvent): Promise<void> {
    const sleepSeconds = Math.round(event.sleepDurationMs / 1000)
    this.logger?.info(`System wake detected after ${sleepSeconds}s sleep, refreshing DHT`)

    // Per BEP 5, buckets become stale after 15 minutes
    if (event.sleepDurationMs > BUCKET_REFRESH_MS) {
      await this.refreshAfterLongSleep()
    } else {
      await this.refreshAfterShortSleep()
    }
  }

  /**
   * Refresh after a long sleep (> 15 minutes).
   * More aggressive pruning since we may have changed networks.
   * 1. Ping a sample of existing nodes
   * 2. Remove any that fail (single failure - no second chances after long sleep)
   * 3. Re-bootstrap with public nodes + remaining existing nodes
   */
  private async refreshAfterLongSleep(): Promise<void> {
    const existingNodes = this.routingTable.getAllNodes()

    // Ping a sample of existing nodes to quickly identify dead ones
    const nodesToTest = existingNodes.slice(0, Math.min(16, existingNodes.length))

    if (nodesToTest.length > 0) {
      this.logger?.debug(`Testing ${nodesToTest.length} existing nodes after long sleep`)

      const results = await Promise.all(
        nodesToTest.map(async (node) => {
          const alive = await this.ping(node).catch(() => false)
          return { node, alive }
        }),
      )

      // After long sleep, remove on first failure (likely changed networks)
      let removed = 0
      for (const { node, alive } of results) {
        if (!alive) {
          this.routingTable.removeNode(node.id)
          removed++
        }
      }

      if (removed > 0) {
        this.logger?.info(`DHT: Removed ${removed} unreachable nodes after long sleep`)
      }
    }

    // Re-bootstrap with public nodes + remaining existing nodes
    const remainingNodes = this.routingTable.getAllNodes()
    const bootstrapSeeds = [
      ...BOOTSTRAP_NODES,
      ...remainingNodes.map((n) => ({ host: n.host, port: n.port })),
    ]

    this.logger?.info(
      `Re-bootstrapping with ${BOOTSTRAP_NODES.length} public + ${remainingNodes.length} remaining nodes`,
    )
    await this.bootstrap({ nodes: bootstrapSeeds })
  }

  /**
   * Refresh after a short sleep (< 15 minutes).
   * Pings a sample of nodes to verify liveness. Removes nodes with 2+ consecutive failures.
   */
  private async refreshAfterShortSleep(): Promise<void> {
    const allNodes = this.routingTable.getAllNodes()
    const nodesToPing = allNodes.slice(0, Math.min(8, allNodes.length))

    if (nodesToPing.length === 0) {
      this.logger?.debug('No nodes to ping after short sleep')
      return
    }

    this.logger?.debug(`Pinging ${nodesToPing.length} nodes after wake`)

    const results = await Promise.all(
      nodesToPing.map(async (node) => {
        const alive = await this.ping(node).catch(() => false)
        return { node, alive }
      }),
    )

    let removed = 0
    for (const { node, alive } of results) {
      if (!alive) {
        const failures = this.routingTable.incrementFailures(node.id)
        if (failures !== undefined && failures >= 2) {
          this.routingTable.removeNode(node.id)
          removed++
        }
      }
      // Success case: ping() already calls addNode() which resets failures
    }

    if (removed > 0) {
      this.logger?.info(`DHT: Removed ${removed} unresponsive nodes after wake`)
    }
  }

  /**
   * Refresh stale buckets by sending find_node with random target.
   * Per BEP 5: "Buckets that have not been changed in 15 minutes should be refreshed"
   * Removes nodes with 2+ consecutive failures.
   */
  private async refreshStaleBuckets(): Promise<void> {
    if (!this._ready) return

    const staleBucketIndices = this.routingTable.getStaleBuckets(BUCKET_REFRESH_MS)
    let removed = 0

    for (const bucketIndex of staleBucketIndices) {
      const bucket = this.routingTable.getBucket(bucketIndex)
      if (!bucket || bucket.nodes.length === 0) continue

      // Generate random target ID in this bucket's range
      const target = generateRandomIdInBucket(bucketIndex, this.nodeId)

      // Query a node from this bucket
      const nodeToQuery = bucket.nodes[0]
      try {
        await this.findNode(nodeToQuery, target)
        // Success: findNode() calls addNode() which resets failures
      } catch {
        // Failed - track consecutive failures
        const failures = this.routingTable.incrementFailures(nodeToQuery.id)
        if (failures !== undefined && failures >= 2) {
          this.routingTable.removeNode(nodeToQuery.id)
          removed++
        }
      }
    }

    if (removed > 0) {
      this.logger?.info(`DHT: Removed ${removed} unresponsive nodes during bucket refresh`)
    }
  }

  // ==========================================================================
  // Staleness Detection
  // ==========================================================================

  /**
   * Record a query result and check if routing table appears stale.
   * If failure rate exceeds threshold, triggers a fresh bootstrap.
   *
   * @param success - Whether the query succeeded
   */
  private recordQueryResult(success: boolean): void {
    // Add result to circular buffer
    this._recentResults.push(success)
    if (this._recentResults.length > this._recentResultsMaxSize) {
      this._recentResults.shift()
    }

    // Need enough samples before checking staleness
    if (this._recentResults.length < 10) {
      return
    }

    // Check failure rate
    const failures = this._recentResults.filter((r) => !r).length
    const failureRate = failures / this._recentResults.length

    if (failureRate >= DHTNode.STALENESS_THRESHOLD && !this._isRebootstrapping) {
      this.handleStaleRoutingTable()
    }
  }

  /**
   * Handle detected stale routing table by re-bootstrapping with public nodes.
   */
  private handleStaleRoutingTable(): void {
    if (this._isRebootstrapping) return

    this._isRebootstrapping = true
    this.logger?.warn(
      `DHT: High failure rate detected (${this._recentResults.filter((r) => !r).length}/${this._recentResults.length}), re-bootstrapping with public nodes`,
    )

    // Clear recent results to reset the detector
    this._recentResults.length = 0

    // Bootstrap with public nodes (not existing nodes which may be stale)
    this.bootstrap()
      .then((stats) => {
        this.logger?.info(`DHT: Re-bootstrap complete - ${stats.routingTableSize} nodes`)
      })
      .catch((err) => {
        this.logger?.error(`DHT: Re-bootstrap failed: ${err}`)
      })
      .finally(() => {
        this._isRebootstrapping = false
      })
  }

  // ==========================================================================
  // High-Level Operations
  // ==========================================================================

  /**
   * Perform an iterative lookup to find peers for an infohash.
   *
   * This is the main method for discovering peers via DHT.
   *
   * @param infoHash - 20-byte torrent infohash
   * @returns Lookup result with peers, closest nodes, and tokens for announce
   */
  async lookup(infoHash: Uint8Array): Promise<LookupResult> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    return iterativeLookup({
      target: infoHash,
      routingTable: this.routingTable,
      sendGetPeers: async (node) => {
        return this.getPeers(node, infoHash)
      },
      localNodeId: this.nodeId,
    })
  }

  /**
   * Announce ourselves as a peer for a torrent to the closest nodes.
   *
   * Should be called after a successful lookup with the tokens from the result.
   *
   * @param infoHash - 20-byte torrent infohash
   * @param port - Port we're listening on for BitTorrent connections
   * @param tokens - Token map from lookup result (node key -> {node, token})
   * @returns Announce result with success/total counts
   */
  async announce(
    infoHash: Uint8Array,
    port: number,
    tokens: Map<string, { node: { host: string; port: number }; token: Uint8Array }>,
  ): Promise<AnnounceResult> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    let successCount = 0
    const totalCount = tokens.size

    // Announce to all nodes that gave us tokens
    const announcePromises = Array.from(tokens.values()).map(async ({ node, token }) => {
      const success = await this.announcePeer(node, infoHash, port, token)
      if (success) {
        successCount++
      }
    })

    await Promise.all(announcePromises)

    return { successCount, totalCount }
  }

  /**
   * Get the serializable state for persistence.
   */
  getState(): import('./types').RoutingTableState {
    return this.routingTable.serialize()
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

  /**
   * Get DHT statistics for UI display.
   */
  getStats(): DHTStats {
    return {
      enabled: true,
      ready: this._ready,
      nodeId: this.nodeIdHex,
      nodeCount: this.routingTable.size(),
      bucketCount: this.routingTable.getBucketCount(),

      bytesSent: this.krpcSocket.bytesSent,
      bytesReceived: this.krpcSocket.bytesReceived,

      pingsSent: this._pingsSent,
      findNodesSent: this._findNodesSent,
      getPeersSent: this._getPeersSent,
      announcesSent: this._announcesSent,

      pingsSucceeded: this._pingsSucceeded,
      findNodesSucceeded: this._findNodesSucceeded,
      getPeersSucceeded: this._getPeersSucceeded,
      announcesSucceeded: this._announcesSucceeded,

      pingsReceived: this._pingsReceived,
      findNodesReceived: this._findNodesReceived,
      getPeersReceived: this._getPeersReceived,
      announcesReceived: this._announcesReceived,

      timeouts: this._timeouts,
      errors: this._errors,

      peersDiscovered: this._peersDiscovered,
    }
  }

  /**
   * Increment received query counter.
   * Called by query handler when processing incoming queries.
   */
  incrementReceivedCounter(queryType: 'ping' | 'find_node' | 'get_peers' | 'announce_peer'): void {
    switch (queryType) {
      case 'ping':
        this._pingsReceived++
        break
      case 'find_node':
        this._findNodesReceived++
        break
      case 'get_peers':
        this._getPeersReceived++
        break
      case 'announce_peer':
        this._announcesReceived++
        break
    }
  }

  /**
   * Record peers discovered via DHT lookup.
   * Called by torrent when peers are added to swarm from DHT.
   */
  recordPeersDiscovered(count: number): void {
    this._peersDiscovered += count
  }
}
