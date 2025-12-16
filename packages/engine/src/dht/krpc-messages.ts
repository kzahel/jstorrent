/**
 * KRPC Message Encoding/Decoding
 *
 * KRPC is a simple RPC mechanism using bencoded dictionaries over UDP.
 * Reference: BEP 5 - KRPC Protocol section
 */

import { Bencode } from '../utils/bencode'
import { DHTNode, CompactPeer, CompactNodeInfo } from './types'
import { NODE_ID_BYTES, COMPACT_PEER_BYTES, COMPACT_NODE_BYTES, CLIENT_VERSION } from './constants'

// ============================================================================
// Message Types
// ============================================================================

/**
 * KRPC Query message (y = 'q')
 */
export interface KRPCQuery {
  /** Transaction ID (2 bytes typically) */
  t: Uint8Array
  /** Message type: 'q' for query */
  y: 'q'
  /** Query method name */
  q: string
  /** Query arguments */
  a: Record<string, unknown>
  /** Client version (optional) */
  v?: Uint8Array
}

/**
 * KRPC Response message (y = 'r')
 */
export interface KRPCResponse {
  /** Transaction ID */
  t: Uint8Array
  /** Message type: 'r' for response */
  y: 'r'
  /** Response values */
  r: Record<string, unknown>
  /** Client version (optional) */
  v?: Uint8Array
}

/**
 * KRPC Error message (y = 'e')
 */
export interface KRPCError {
  /** Transaction ID */
  t: Uint8Array
  /** Message type: 'e' for error */
  y: 'e'
  /** Error: [code, message] */
  e: [number, string]
  /** Client version (optional) */
  v?: Uint8Array
}

/** Union of all KRPC message types */
export type KRPCMessage = KRPCQuery | KRPCResponse | KRPCError

/**
 * KRPC Error codes (from BEP 5)
 */
export const KRPCErrorCode = {
  GENERIC: 201,
  SERVER: 202,
  PROTOCOL: 203, // Malformed packet, invalid arguments, or bad token
  METHOD_UNKNOWN: 204,
} as const

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Encode a ping query.
 *
 * @param transactionId - 2-byte transaction ID
 * @param nodeId - Our 20-byte node ID
 * @returns Bencoded message bytes
 */
export function encodePingQuery(transactionId: Uint8Array, nodeId: Uint8Array): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'q',
    q: 'ping',
    a: {
      id: nodeId,
    },
    v: CLIENT_VERSION,
  }
  return Bencode.encode(msg)
}

/**
 * Encode a find_node query.
 *
 * @param transactionId - 2-byte transaction ID
 * @param nodeId - Our 20-byte node ID
 * @param target - 20-byte target node ID to find
 * @returns Bencoded message bytes
 */
export function encodeFindNodeQuery(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  target: Uint8Array,
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'q',
    q: 'find_node',
    a: {
      id: nodeId,
      target: target,
    },
    v: CLIENT_VERSION,
  }
  return Bencode.encode(msg)
}

/**
 * Encode a get_peers query.
 *
 * @param transactionId - 2-byte transaction ID
 * @param nodeId - Our 20-byte node ID
 * @param infoHash - 20-byte infohash of the torrent
 * @returns Bencoded message bytes
 */
export function encodeGetPeersQuery(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  infoHash: Uint8Array,
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'q',
    q: 'get_peers',
    a: {
      id: nodeId,
      info_hash: infoHash,
    },
    v: CLIENT_VERSION,
  }
  return Bencode.encode(msg)
}

/**
 * Encode an announce_peer query.
 *
 * @param transactionId - 2-byte transaction ID
 * @param nodeId - Our 20-byte node ID
 * @param infoHash - 20-byte infohash of the torrent
 * @param port - Port we're listening on
 * @param token - Token received from previous get_peers response
 * @param impliedPort - If true, use UDP source port instead of specified port
 * @returns Bencoded message bytes
 */
export function encodeAnnouncePeerQuery(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  infoHash: Uint8Array,
  port: number,
  token: Uint8Array,
  impliedPort: boolean = false,
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'q',
    q: 'announce_peer',
    a: {
      id: nodeId,
      implied_port: impliedPort ? 1 : 0,
      info_hash: infoHash,
      port: port,
      token: token,
    },
    v: CLIENT_VERSION,
  }
  return Bencode.encode(msg)
}

/**
 * Encode a ping response.
 *
 * @param transactionId - Transaction ID from the query
 * @param nodeId - Our 20-byte node ID
 * @returns Bencoded message bytes
 */
export function encodePingResponse(transactionId: Uint8Array, nodeId: Uint8Array): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'r',
    r: {
      id: nodeId,
    },
  }
  return Bencode.encode(msg)
}

/**
 * Encode a find_node response.
 *
 * @param transactionId - Transaction ID from the query
 * @param nodeId - Our 20-byte node ID
 * @param nodes - Array of closest nodes
 * @returns Bencoded message bytes
 */
export function encodeFindNodeResponse(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  nodes: DHTNode[],
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'r',
    r: {
      id: nodeId,
      nodes: encodeCompactNodes(nodes),
    },
  }
  return Bencode.encode(msg)
}

/**
 * Encode a get_peers response with peers.
 *
 * @param transactionId - Transaction ID from the query
 * @param nodeId - Our 20-byte node ID
 * @param token - Token for future announce_peer
 * @param peers - Array of peers
 * @returns Bencoded message bytes
 */
export function encodeGetPeersResponseWithPeers(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  token: Uint8Array,
  peers: CompactPeer[],
): Uint8Array {
  // values is a list of compact peer strings
  const values = peers.map((p) => encodeCompactPeer(p))
  const msg = {
    t: transactionId,
    y: 'r',
    r: {
      id: nodeId,
      token: token,
      values: values,
    },
  }
  return Bencode.encode(msg)
}

/**
 * Encode a get_peers response with nodes (no peers known).
 *
 * @param transactionId - Transaction ID from the query
 * @param nodeId - Our 20-byte node ID
 * @param token - Token for future announce_peer
 * @param nodes - Array of closest nodes
 * @returns Bencoded message bytes
 */
export function encodeGetPeersResponseWithNodes(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
  token: Uint8Array,
  nodes: DHTNode[],
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'r',
    r: {
      id: nodeId,
      token: token,
      nodes: encodeCompactNodes(nodes),
    },
  }
  return Bencode.encode(msg)
}

/**
 * Encode an announce_peer response.
 *
 * @param transactionId - Transaction ID from the query
 * @param nodeId - Our 20-byte node ID
 * @returns Bencoded message bytes
 */
export function encodeAnnouncePeerResponse(
  transactionId: Uint8Array,
  nodeId: Uint8Array,
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'r',
    r: {
      id: nodeId,
    },
  }
  return Bencode.encode(msg)
}

/**
 * Encode an error response.
 *
 * @param transactionId - Transaction ID from the query
 * @param code - Error code (201-204)
 * @param message - Error message
 * @returns Bencoded message bytes
 */
export function encodeErrorResponse(
  transactionId: Uint8Array,
  code: number,
  message: string,
): Uint8Array {
  const msg = {
    t: transactionId,
    y: 'e',
    e: [code, message],
  }
  return Bencode.encode(msg)
}

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Decode a KRPC message from bytes.
 *
 * @param data - Raw UDP packet data
 * @returns Decoded message or null if invalid
 */
export function decodeMessage(data: Uint8Array): KRPCMessage | null {
  try {
    const decoded = Bencode.decode(data)
    if (!decoded || typeof decoded !== 'object') return null

    // Extract common fields
    const t = decoded.t
    if (!(t instanceof Uint8Array)) return null

    const y = decoded.y
    if (!(y instanceof Uint8Array) || y.length !== 1) return null
    const messageType = String.fromCharCode(y[0])

    // Optional version
    const v = decoded.v instanceof Uint8Array ? decoded.v : undefined

    if (messageType === 'q') {
      // Query
      const q = decoded.q
      if (!(q instanceof Uint8Array)) return null
      const methodName = new TextDecoder().decode(q)

      const a = decoded.a
      if (!a || typeof a !== 'object') return null

      return {
        t,
        y: 'q',
        q: methodName,
        a: a as Record<string, unknown>,
        v,
      }
    } else if (messageType === 'r') {
      // Response
      const r = decoded.r
      if (!r || typeof r !== 'object') return null

      return {
        t,
        y: 'r',
        r: r as Record<string, unknown>,
        v,
      }
    } else if (messageType === 'e') {
      // Error
      const e = decoded.e
      if (!Array.isArray(e) || e.length < 2) return null

      const code = typeof e[0] === 'number' ? e[0] : 0
      const message = e[1] instanceof Uint8Array ? new TextDecoder().decode(e[1]) : String(e[1])

      return {
        t,
        y: 'e',
        e: [code, message],
        v,
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check if a message is a query.
 */
export function isQuery(msg: KRPCMessage): msg is KRPCQuery {
  return msg.y === 'q'
}

/**
 * Check if a message is a response.
 */
export function isResponse(msg: KRPCMessage): msg is KRPCResponse {
  return msg.y === 'r'
}

/**
 * Check if a message is an error.
 */
export function isError(msg: KRPCMessage): msg is KRPCError {
  return msg.y === 'e'
}

// ============================================================================
// Compact Encoding/Decoding
// ============================================================================

/**
 * Encode a peer to compact format (6 bytes: 4 IP + 2 port).
 *
 * @param peer - Peer with host (IPv4) and port
 * @returns 6-byte compact representation
 */
export function encodeCompactPeer(peer: CompactPeer): Uint8Array {
  const result = new Uint8Array(COMPACT_PEER_BYTES)
  const parts = peer.host.split('.')
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${peer.host}`)
  }

  for (let i = 0; i < 4; i++) {
    result[i] = parseInt(parts[i], 10)
  }
  // Port in network byte order (big-endian)
  result[4] = (peer.port >> 8) & 0xff
  result[5] = peer.port & 0xff

  return result
}

/**
 * Decode compact peer info (6 bytes) to peer object.
 *
 * @param data - 6-byte compact peer info
 * @param offset - Offset into data (default 0)
 * @returns Decoded peer or null if invalid
 */
export function decodeCompactPeer(data: Uint8Array, offset: number = 0): CompactPeer | null {
  if (data.length < offset + COMPACT_PEER_BYTES) return null

  const host = `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`
  const port = (data[offset + 4] << 8) | data[offset + 5]

  // Validate
  if (port === 0) return null

  return { host, port }
}

/**
 * Decode multiple compact peers from a values list.
 *
 * @param values - Array of 6-byte Uint8Arrays (compact peer info)
 * @returns Array of decoded peers
 */
export function decodeCompactPeers(values: unknown[]): CompactPeer[] {
  const peers: CompactPeer[] = []

  for (const value of values) {
    if (value instanceof Uint8Array && value.length === COMPACT_PEER_BYTES) {
      const peer = decodeCompactPeer(value)
      if (peer) peers.push(peer)
    }
  }

  return peers
}

/**
 * Encode a node to compact format (26 bytes: 20 ID + 6 peer).
 *
 * @param node - DHT node with id, host, port
 * @returns 26-byte compact representation
 */
export function encodeCompactNode(node: DHTNode | CompactNodeInfo): Uint8Array {
  const result = new Uint8Array(COMPACT_NODE_BYTES)

  // Copy 20-byte node ID
  result.set(node.id.slice(0, NODE_ID_BYTES), 0)

  // Encode peer info
  const peerInfo = encodeCompactPeer({ host: node.host, port: node.port })
  result.set(peerInfo, NODE_ID_BYTES)

  return result
}

/**
 * Encode multiple nodes to compact format.
 *
 * @param nodes - Array of DHT nodes
 * @returns Concatenated compact node info
 */
export function encodeCompactNodes(nodes: DHTNode[]): Uint8Array {
  const result = new Uint8Array(nodes.length * COMPACT_NODE_BYTES)

  for (let i = 0; i < nodes.length; i++) {
    const compact = encodeCompactNode(nodes[i])
    result.set(compact, i * COMPACT_NODE_BYTES)
  }

  return result
}

/**
 * Decode compact node info (26 bytes) to node object.
 *
 * @param data - Uint8Array containing compact node info
 * @param offset - Offset into data (default 0)
 * @returns Decoded node or null if invalid
 */
export function decodeCompactNode(data: Uint8Array, offset: number = 0): CompactNodeInfo | null {
  if (data.length < offset + COMPACT_NODE_BYTES) return null

  const id = data.slice(offset, offset + NODE_ID_BYTES)
  const peer = decodeCompactPeer(data, offset + NODE_ID_BYTES)

  if (!peer) return null

  return {
    id,
    host: peer.host,
    port: peer.port,
  }
}

/**
 * Decode multiple compact nodes from a nodes string.
 *
 * @param data - Concatenated compact node info (multiple of 26 bytes)
 * @returns Array of decoded nodes
 */
export function decodeCompactNodes(data: Uint8Array): CompactNodeInfo[] {
  const nodes: CompactNodeInfo[] = []

  for (let offset = 0; offset + COMPACT_NODE_BYTES <= data.length; offset += COMPACT_NODE_BYTES) {
    const node = decodeCompactNode(data, offset)
    if (node) nodes.push(node)
  }

  return nodes
}

// ============================================================================
// Response Parsing Helpers
// ============================================================================

/**
 * Extract node ID from a response.
 */
export function getResponseNodeId(response: KRPCResponse): Uint8Array | null {
  const id = response.r.id
  if (id instanceof Uint8Array && id.length === NODE_ID_BYTES) {
    return id
  }
  return null
}

/**
 * Extract nodes from a find_node or get_peers response.
 */
export function getResponseNodes(response: KRPCResponse): CompactNodeInfo[] {
  const nodes = response.r.nodes
  if (nodes instanceof Uint8Array) {
    return decodeCompactNodes(nodes)
  }
  return []
}

/**
 * Extract peers from a get_peers response.
 */
export function getResponsePeers(response: KRPCResponse): CompactPeer[] {
  const values = response.r.values
  if (Array.isArray(values)) {
    return decodeCompactPeers(values)
  }
  return []
}

/**
 * Extract token from a get_peers response.
 */
export function getResponseToken(response: KRPCResponse): Uint8Array | null {
  const token = response.r.token
  if (token instanceof Uint8Array) {
    return token
  }
  return null
}

/**
 * Extract query arguments from a query message.
 */
export function getQueryNodeId(query: KRPCQuery): Uint8Array | null {
  const id = query.a.id
  if (id instanceof Uint8Array && id.length === NODE_ID_BYTES) {
    return id
  }
  return null
}

/**
 * Extract target from a find_node query.
 */
export function getQueryTarget(query: KRPCQuery): Uint8Array | null {
  const target = query.a.target
  if (target instanceof Uint8Array && target.length === NODE_ID_BYTES) {
    return target
  }
  return null
}

/**
 * Extract info_hash from a get_peers or announce_peer query.
 */
export function getQueryInfoHash(query: KRPCQuery): Uint8Array | null {
  const infoHash = query.a.info_hash
  if (infoHash instanceof Uint8Array && infoHash.length === NODE_ID_BYTES) {
    return infoHash
  }
  return null
}

/**
 * Extract token from an announce_peer query.
 */
export function getQueryToken(query: KRPCQuery): Uint8Array | null {
  const token = query.a.token
  if (token instanceof Uint8Array) {
    return token
  }
  return null
}

/**
 * Extract port from an announce_peer query.
 */
export function getQueryPort(query: KRPCQuery): number | null {
  const port = query.a.port
  if (typeof port === 'number' && port > 0 && port <= 65535) {
    return port
  }
  return null
}

/**
 * Check if implied_port is set in an announce_peer query.
 */
export function getQueryImpliedPort(query: KRPCQuery): boolean {
  const impliedPort = query.a.implied_port
  return impliedPort === 1
}
