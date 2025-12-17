/**
 * Iterative Lookup for DHT
 *
 * Implements the Kademlia iterative lookup algorithm for finding
 * peers in the DHT. Queries nodes progressively closer to the
 * target until convergence.
 *
 * Reference: BEP 5 - DHT Protocol
 */

import { RoutingTable } from './routing-table'
import { CompactPeer, CompactNodeInfo } from './types'
import { GetPeersResult } from './dht-node'
import { xorDistance, nodeIdsEqual } from './xor-distance'
import { K, ALPHA } from './constants'

/**
 * Options for iterative lookup.
 */
export interface IterativeLookupOptions {
  /** Target infohash to search for (20 bytes) */
  target: Uint8Array

  /** Routing table to seed initial candidates from */
  routingTable: RoutingTable

  /** Function to send get_peers query to a node */
  sendGetPeers: (node: CompactNodeInfo) => Promise<GetPeersResult | null>

  /** Number of parallel queries (default: 3) */
  alpha?: number

  /** Number of closest nodes to track/return (default: 8) */
  k?: number

  /** Our node ID (to exclude from candidates) */
  localNodeId?: Uint8Array
}

/**
 * Result of an iterative lookup.
 */
export interface LookupResult {
  /** Peers found for the infohash */
  peers: CompactPeer[]

  /** K closest nodes to the target that responded */
  closestNodes: CompactNodeInfo[]

  /** Number of nodes queried */
  queriedCount: number

  /** Tokens from responding nodes (node key -> token) for announce */
  tokens: Map<string, { node: CompactNodeInfo; token: Uint8Array }>
}

/**
 * Internal representation of a candidate node during lookup.
 */
interface CandidateNode {
  node: CompactNodeInfo
  distance: bigint
  queried: boolean
  responded: boolean
}

/**
 * Create a unique key for a node (by address, not ID).
 * Two nodes at the same address are considered the same for dedup.
 */
function nodeKey(node: { host: string; port: number }): string {
  return `${node.host}:${node.port}`
}

/**
 * Create a unique key for a peer.
 */
function peerKey(peer: CompactPeer): string {
  return `${peer.host}:${peer.port}`
}

/**
 * Perform an iterative lookup in the DHT.
 *
 * This is the core algorithm for finding peers. It queries nodes
 * progressively closer to the target infohash until it either
 * finds peers or determines no closer nodes exist.
 *
 * @param options - Lookup options
 * @returns Lookup result with peers, closest nodes, and tokens
 */
export async function iterativeLookup(options: IterativeLookupOptions): Promise<LookupResult> {
  const { target, routingTable, sendGetPeers, alpha = ALPHA, k = K, localNodeId } = options

  // Candidate tracking
  const candidates = new Map<string, CandidateNode>()

  // Result accumulators
  const peers = new Map<string, CompactPeer>()
  const tokens = new Map<string, { node: CompactNodeInfo; token: Uint8Array }>()

  let queriedCount = 0

  /**
   * Add a node as a candidate if not already present and not local.
   */
  function addCandidate(node: CompactNodeInfo): void {
    // Skip our own node
    if (localNodeId && nodeIdsEqual(node.id, localNodeId)) {
      return
    }

    const key = nodeKey(node)
    if (candidates.has(key)) {
      return // Already have this candidate
    }

    candidates.set(key, {
      node,
      distance: xorDistance(node.id, target),
      queried: false,
      responded: false,
    })
  }

  /**
   * Get unqueried candidates sorted by distance (closest first).
   */
  function getUnqueriedCandidates(): CandidateNode[] {
    const unqueried: CandidateNode[] = []
    for (const candidate of candidates.values()) {
      if (!candidate.queried) {
        unqueried.push(candidate)
      }
    }
    unqueried.sort((a, b) => {
      if (a.distance < b.distance) return -1
      if (a.distance > b.distance) return 1
      return 0
    })
    return unqueried
  }

  /**
   * Get the K closest nodes that have responded, sorted by distance.
   */
  function getKClosestResponded(): CandidateNode[] {
    const responded: CandidateNode[] = []
    for (const candidate of candidates.values()) {
      if (candidate.responded) {
        responded.push(candidate)
      }
    }
    responded.sort((a, b) => {
      if (a.distance < b.distance) return -1
      if (a.distance > b.distance) return 1
      return 0
    })
    return responded.slice(0, k)
  }

  // Seed candidates from routing table
  const initialNodes = routingTable.closest(target, k)
  for (const node of initialNodes) {
    addCandidate({
      id: node.id,
      host: node.host,
      port: node.port,
    })
  }

  // Main iteration loop
  while (true) {
    const unqueried = getUnqueriedCandidates()

    // No more candidates to query
    if (unqueried.length === 0) {
      break
    }

    // Check for convergence
    const kClosestResponded = getKClosestResponded()
    if (kClosestResponded.length >= k) {
      // All K closest have responded - check if unqueried are farther
      const kthDistance = kClosestResponded[k - 1].distance
      const closestUnqueriedDistance = unqueried[0].distance

      if (closestUnqueriedDistance >= kthDistance) {
        // All unqueried nodes are at least as far as K-th closest
        // responding node - we've converged
        break
      }
    }

    // Select batch of up to alpha candidates to query
    const batch = unqueried.slice(0, alpha)

    // Mark as queried before sending (to prevent re-selection)
    for (const candidate of batch) {
      candidate.queried = true
      queriedCount++
    }

    // Query in parallel
    const queryPromises = batch.map((candidate) => sendGetPeers(candidate.node).catch(() => null))
    const results = await Promise.all(queryPromises)

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const candidate = batch[i]

      if (!result) {
        // Timeout or error - leave responded as false
        continue
      }

      // Mark as responded
      candidate.responded = true

      // Store token for later announce
      tokens.set(nodeKey(candidate.node), {
        node: candidate.node,
        token: result.token,
      })

      // Collect peers
      if (result.peers) {
        for (const peer of result.peers) {
          peers.set(peerKey(peer), peer)
        }
      }

      // Add new candidate nodes
      if (result.nodes) {
        for (const node of result.nodes) {
          addCandidate(node)
        }
      }
    }
  }

  // Build final result
  const closestResponded = getKClosestResponded()

  return {
    peers: Array.from(peers.values()),
    closestNodes: closestResponded.map((c) => c.node),
    queriedCount,
    tokens,
  }
}
