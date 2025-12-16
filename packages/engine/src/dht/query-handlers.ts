/**
 * DHT Query Handlers
 *
 * Processes incoming KRPC queries (ping, find_node, get_peers, announce_peer)
 * and generates appropriate responses.
 *
 * Reference: BEP 5 - DHT Queries section
 */

import { RoutingTable } from './routing-table'
import { TokenStore } from './token-store'
import { PeerStore } from './peer-store'
import { KRPCSocket } from './krpc-socket'
import {
  KRPCQuery,
  KRPCErrorCode,
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  getQueryNodeId,
  getQueryTarget,
  getQueryInfoHash,
  getQueryToken,
  getQueryPort,
  getQueryImpliedPort,
} from './krpc-messages'
import { DHTNodeInfo } from './types'
import { K, NODE_ID_BYTES } from './constants'

/**
 * Query handler result.
 */
export interface QueryHandlerResult {
  /** Response data to send */
  response: Uint8Array
  /** Node to add to routing table (if any) */
  node?: DHTNodeInfo
}

/**
 * Dependencies for query handlers.
 */
export interface QueryHandlerDeps {
  /** Our node ID */
  nodeId: Uint8Array
  /** Routing table for finding closest nodes */
  routingTable: RoutingTable
  /** Token store for announce validation */
  tokenStore: TokenStore
  /** Peer store for storing/retrieving peers */
  peerStore: PeerStore
}

/**
 * Handle an incoming ping query.
 *
 * @param query - The ping query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handlePing(
  query: KRPCQuery,
  _rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)

  // Validate query
  if (!nodeId) {
    return {
      response: encodeErrorResponse(query.t, KRPCErrorCode.PROTOCOL, 'Invalid ping: missing id'),
    }
  }

  // Build response
  const response = encodePingResponse(query.t, deps.nodeId)

  // Return node for routing table
  return {
    response,
    node: nodeId
      ? {
          id: nodeId,
          host: _rinfo.host,
          port: _rinfo.port,
        }
      : undefined,
  }
}

/**
 * Handle an incoming find_node query.
 *
 * @param query - The find_node query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleFindNode(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const target = getQueryTarget(query)

  // Validate query
  if (!nodeId || !target) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid find_node: missing id or target',
      ),
    }
  }

  // Find closest nodes to target
  const closestNodes = deps.routingTable.closest(target, K)

  // Build response
  const response = encodeFindNodeResponse(query.t, deps.nodeId, closestNodes)

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle an incoming get_peers query.
 *
 * @param query - The get_peers query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleGetPeers(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const infoHash = getQueryInfoHash(query)

  // Validate query
  if (!nodeId || !infoHash) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid get_peers: missing id or info_hash',
      ),
    }
  }

  // Generate token for this IP
  const token = await deps.tokenStore.generate(rinfo.host)

  // Check if we have peers for this infohash
  const peers = deps.peerStore.getPeers(infoHash)

  let response: Uint8Array
  if (peers.length > 0) {
    // Return peers
    response = encodeGetPeersResponseWithPeers(query.t, deps.nodeId, token, peers)
  } else {
    // Return closest nodes
    const closestNodes = deps.routingTable.closest(infoHash, K)
    response = encodeGetPeersResponseWithNodes(query.t, deps.nodeId, token, closestNodes)
  }

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle an incoming announce_peer query.
 *
 * @param query - The announce_peer query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleAnnouncePeer(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const infoHash = getQueryInfoHash(query)
  const token = getQueryToken(query)
  const port = getQueryPort(query)
  const impliedPort = getQueryImpliedPort(query)

  // Validate query
  if (!nodeId || !infoHash || !token) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid announce_peer: missing required fields',
      ),
    }
  }

  // Validate token
  const isValidToken = await deps.tokenStore.validate(rinfo.host, token)
  if (!isValidToken) {
    return {
      response: encodeErrorResponse(query.t, KRPCErrorCode.PROTOCOL, 'Invalid token'),
    }
  }

  // Determine peer port
  let peerPort: number
  if (impliedPort) {
    // Use UDP source port
    peerPort = rinfo.port
  } else {
    // Use specified port
    if (!port) {
      return {
        response: encodeErrorResponse(
          query.t,
          KRPCErrorCode.PROTOCOL,
          'Invalid announce_peer: missing port',
        ),
      }
    }
    peerPort = port
  }

  // Store the peer
  deps.peerStore.addPeer(infoHash, { host: rinfo.host, port: peerPort })

  // Build response
  const response = encodeAnnouncePeerResponse(query.t, deps.nodeId)

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle unknown query method.
 *
 * @param query - The unknown query
 * @returns Error response
 */
export function handleUnknownMethod(query: KRPCQuery): QueryHandlerResult {
  return {
    response: encodeErrorResponse(
      query.t,
      KRPCErrorCode.METHOD_UNKNOWN,
      `Unknown method: ${query.q}`,
    ),
  }
}

/**
 * Route a query to the appropriate handler.
 *
 * @param query - The incoming query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function routeQuery(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  switch (query.q) {
    case 'ping':
      return handlePing(query, rinfo, deps)
    case 'find_node':
      return handleFindNode(query, rinfo, deps)
    case 'get_peers':
      return handleGetPeers(query, rinfo, deps)
    case 'announce_peer':
      return handleAnnouncePeer(query, rinfo, deps)
    default:
      return handleUnknownMethod(query)
  }
}

/**
 * Create a query handler that can be attached to a KRPCSocket.
 *
 * @param socket - The KRPC socket to send responses on
 * @param deps - Handler dependencies
 * @returns Event handler function for 'query' events
 */
export function createQueryHandler(
  socket: KRPCSocket,
  deps: QueryHandlerDeps,
): (query: KRPCQuery, rinfo: { host: string; port: number }) => void {
  return async (query: KRPCQuery, rinfo: { host: string; port: number }) => {
    try {
      const result = await routeQuery(query, rinfo, deps)

      // Send response
      socket.send(rinfo.host, rinfo.port, result.response)

      // Add node to routing table if valid
      if (result.node && result.node.id.length === NODE_ID_BYTES) {
        deps.routingTable.addNode(result.node)
      }
    } catch {
      // Send generic error on unexpected failure
      const errorResponse = encodeErrorResponse(
        query.t,
        KRPCErrorCode.SERVER,
        'Internal server error',
      )
      socket.send(rinfo.host, rinfo.port, errorResponse)
    }
  }
}
