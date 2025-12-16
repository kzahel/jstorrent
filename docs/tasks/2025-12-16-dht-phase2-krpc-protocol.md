# DHT Phase 2: KRPC Protocol Layer - Agent Task Document

**Status:** Ready for Implementation  
**Prerequisite:** Phase 1 Complete (types.ts, constants.ts, xor-distance.ts, routing-table.ts)  
**Goal:** Encode/decode KRPC messages, manage transactions with timeouts, wrap UDP socket with KRPC semantics.

---

## Overview

This phase implements the KRPC (Kademlia RPC) protocol layer for DHT communication. KRPC messages are bencoded dictionaries sent over UDP. We need three components:

1. **krpc-messages.ts** - Encode queries/responses, decode responses, compact node/peer encoding
2. **transaction-manager.ts** - Track pending queries, handle timeouts, route responses to callbacks
3. **krpc-socket.ts** - Combine IUdpSocket with KRPC encoding/decoding and transaction management

All code follows patterns established in Phase 1 and existing codebase (see `src/tracker/udp-tracker.ts` for UDP patterns, `src/utils/bencode.ts` for bencode).

---

## Reference Material

- **BEP 5 Specification:** `beps_md/accepted/bep_0005.md`
- **Bencode Utility:** `src/utils/bencode.ts` (use `Bencode.encode()` and `Bencode.decode()`)
- **UDP Socket Pattern:** `src/tracker/udp-tracker.ts`
- **Socket Interface:** `src/interfaces/socket.ts` (IUdpSocket)
- **Existing DHT Code:** `src/dht/` (types.ts, constants.ts, xor-distance.ts, routing-table.ts)
- **Test Patterns:** `test/dht/xor-distance.test.ts`, `test/tracker/udp-tracker.test.ts`

---

## File Structure

Create these files:

```
packages/engine/src/dht/
├── krpc-messages.ts        # NEW - Message encoding/decoding
├── transaction-manager.ts  # NEW - Pending query tracking
└── krpc-socket.ts          # NEW - KRPC over UDP

packages/engine/test/dht/
├── krpc-messages.test.ts   # NEW
├── transaction-manager.test.ts # NEW
└── krpc-socket.test.ts     # NEW
```

Update existing file:
```
packages/engine/src/dht/index.ts  # Add new exports
```

---

## Phase 2.1: KRPC Messages (krpc-messages.ts)

### 2.1.1 Create `src/dht/krpc-messages.ts`

```typescript
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
  target: Uint8Array
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
  infoHash: Uint8Array
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
  impliedPort: boolean = false
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
  nodes: DHTNode[]
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
  peers: CompactPeer[]
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
  nodes: DHTNode[]
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
  nodeId: Uint8Array
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
  message: string
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
```

### 2.1.2 Create `test/dht/krpc-messages.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Bencode } from '../../src/utils/bencode'
import {
  // Encoding
  encodePingQuery,
  encodeFindNodeQuery,
  encodeGetPeersQuery,
  encodeAnnouncePeerQuery,
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  // Decoding
  decodeMessage,
  isQuery,
  isResponse,
  isError,
  // Compact encoding
  encodeCompactPeer,
  decodeCompactPeer,
  decodeCompactPeers,
  encodeCompactNode,
  encodeCompactNodes,
  decodeCompactNode,
  decodeCompactNodes,
  // Response helpers
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
  getQueryNodeId,
  getQueryTarget,
  getQueryInfoHash,
  getQueryToken,
  getQueryPort,
  getQueryImpliedPort,
  KRPCErrorCode,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES, COMPACT_PEER_BYTES, COMPACT_NODE_BYTES } from '../../src/dht/constants'

describe('KRPC Messages', () => {
  // Test data
  const transactionId = new Uint8Array([0xaa, 0xbb])
  const nodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
  const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
  const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x33)
  const token = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

  describe('Encoding Queries', () => {
    describe('encodePingQuery', () => {
      it('encodes ping query correctly', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('q')
        expect(new TextDecoder().decode(decoded.q)).toBe('ping')
        expect(decoded.a.id).toEqual(nodeId)
      })

      it('includes client version', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.v).toBeDefined()
        expect(decoded.v.length).toBe(4) // "JS01"
      })
    })

    describe('encodeFindNodeQuery', () => {
      it('encodes find_node with target', () => {
        const encoded = encodeFindNodeQuery(transactionId, nodeId, targetId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('find_node')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.target).toEqual(targetId)
      })
    })

    describe('encodeGetPeersQuery', () => {
      it('encodes get_peers with info_hash', () => {
        const encoded = encodeGetPeersQuery(transactionId, nodeId, infoHash)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('get_peers')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.info_hash).toEqual(infoHash)
      })
    })

    describe('encodeAnnouncePeerQuery', () => {
      it('encodes announce_peer with token and port', () => {
        const port = 6881
        const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, port, token, false)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('announce_peer')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.info_hash).toEqual(infoHash)
        expect(decoded.a.port).toBe(port)
        expect(decoded.a.token).toEqual(token)
        expect(decoded.a.implied_port).toBe(0)
      })

      it('sets implied_port when requested', () => {
        const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token, true)
        const decoded = Bencode.decode(encoded)

        expect(decoded.a.implied_port).toBe(1)
      })
    })
  })

  describe('Encoding Responses', () => {
    describe('encodePingResponse', () => {
      it('encodes ping response correctly', () => {
        const encoded = encodePingResponse(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('r')
        expect(decoded.r.id).toEqual(nodeId)
      })
    })

    describe('encodeFindNodeResponse', () => {
      it('encodes find_node response with nodes', () => {
        const nodes = [
          { id: new Uint8Array(20).fill(0x01), host: '192.168.1.1', port: 6881 },
          { id: new Uint8Array(20).fill(0x02), host: '192.168.1.2', port: 6882 },
        ]
        const encoded = encodeFindNodeResponse(transactionId, nodeId, nodes)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.nodes.length).toBe(nodes.length * COMPACT_NODE_BYTES)
      })
    })

    describe('encodeGetPeersResponseWithPeers', () => {
      it('encodes get_peers response with peers', () => {
        const peers = [
          { host: '1.2.3.4', port: 8080 },
          { host: '5.6.7.8', port: 9090 },
        ]
        const encoded = encodeGetPeersResponseWithPeers(transactionId, nodeId, token, peers)
        const decoded = Bencode.decode(encoded)

        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.token).toEqual(token)
        expect(Array.isArray(decoded.r.values)).toBe(true)
        expect(decoded.r.values.length).toBe(2)
      })
    })

    describe('encodeGetPeersResponseWithNodes', () => {
      it('encodes get_peers response with nodes', () => {
        const nodes = [{ id: new Uint8Array(20).fill(0x01), host: '192.168.1.1', port: 6881 }]
        const encoded = encodeGetPeersResponseWithNodes(transactionId, nodeId, token, nodes)
        const decoded = Bencode.decode(encoded)

        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.token).toEqual(token)
        expect(decoded.r.nodes).toBeDefined()
        expect(decoded.r.values).toBeUndefined()
      })
    })

    describe('encodeErrorResponse', () => {
      it('encodes error response correctly', () => {
        const encoded = encodeErrorResponse(transactionId, KRPCErrorCode.PROTOCOL, 'Bad token')
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('e')
        expect(Array.isArray(decoded.e)).toBe(true)
        expect(decoded.e[0]).toBe(203)
      })
    })
  })

  describe('Decoding Messages', () => {
    describe('decodeMessage', () => {
      it('decodes response extracting r dict', () => {
        const encoded = encodePingResponse(transactionId, nodeId)
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isResponse(msg!)).toBe(true)
        if (isResponse(msg!)) {
          expect(msg.r.id).toEqual(nodeId)
        }
      })

      it('decodes error extracting code and message', () => {
        const encoded = encodeErrorResponse(transactionId, 201, 'Generic Error')
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isError(msg!)).toBe(true)
        if (isError(msg!)) {
          expect(msg.e[0]).toBe(201)
          expect(msg.e[1]).toBe('Generic Error')
        }
      })

      it('decodes query messages', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isQuery(msg!)).toBe(true)
        if (isQuery(msg!)) {
          expect(msg.q).toBe('ping')
        }
      })

      it('handles malformed input gracefully (returns null)', () => {
        expect(decodeMessage(new Uint8Array([]))).toBeNull()
        expect(decodeMessage(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull()
        expect(decodeMessage(new Uint8Array([0x64, 0x65]))).toBeNull() // "de" - empty dict
      })

      it('handles missing required fields', () => {
        // Message without 't' field
        const noT = Bencode.encode({ y: 'r', r: { id: nodeId } })
        expect(decodeMessage(noT)).toBeNull()

        // Message without 'y' field
        const noY = Bencode.encode({ t: transactionId, r: { id: nodeId } })
        expect(decodeMessage(noY)).toBeNull()
      })
    })
  })

  describe('Compact Encoding', () => {
    describe('encodeCompactPeer / decodeCompactPeer', () => {
      it('roundtrips peer correctly', () => {
        const peer = { host: '192.168.1.100', port: 51413 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded.length).toBe(COMPACT_PEER_BYTES)

        const decoded = decodeCompactPeer(encoded)
        expect(decoded).toEqual(peer)
      })

      it('encodes IP in network byte order', () => {
        const peer = { host: '1.2.3.4', port: 256 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded[0]).toBe(1)
        expect(encoded[1]).toBe(2)
        expect(encoded[2]).toBe(3)
        expect(encoded[3]).toBe(4)
      })

      it('encodes port in network byte order (big-endian)', () => {
        const peer = { host: '0.0.0.0', port: 0x1234 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded[4]).toBe(0x12)
        expect(encoded[5]).toBe(0x34)
      })

      it('returns null for invalid data length', () => {
        expect(decodeCompactPeer(new Uint8Array(5))).toBeNull()
      })

      it('returns null for port 0', () => {
        const data = new Uint8Array([1, 2, 3, 4, 0, 0])
        expect(decodeCompactPeer(data)).toBeNull()
      })
    })

    describe('decodeCompactPeers', () => {
      it('decodes array of compact peer Uint8Arrays', () => {
        const peers = [
          { host: '1.2.3.4', port: 8080 },
          { host: '5.6.7.8', port: 9090 },
        ]
        const values = peers.map((p) => encodeCompactPeer(p))

        const decoded = decodeCompactPeers(values)
        expect(decoded).toEqual(peers)
      })

      it('skips invalid entries', () => {
        const validPeer = encodeCompactPeer({ host: '1.2.3.4', port: 8080 })
        const values = [
          validPeer,
          new Uint8Array([1, 2, 3]), // too short
          'not a uint8array', // wrong type
        ]

        const decoded = decodeCompactPeers(values)
        expect(decoded.length).toBe(1)
      })
    })

    describe('encodeCompactNode / decodeCompactNode', () => {
      it('decodes compact node info (26 bytes → DHTNode)', () => {
        const node = {
          id: new Uint8Array(20).fill(0xab),
          host: '10.20.30.40',
          port: 6881,
        }
        const encoded = encodeCompactNode(node)

        expect(encoded.length).toBe(COMPACT_NODE_BYTES)

        const decoded = decodeCompactNode(encoded)
        expect(decoded).not.toBeNull()
        expect(decoded!.id).toEqual(node.id)
        expect(decoded!.host).toBe(node.host)
        expect(decoded!.port).toBe(node.port)
      })

      it('returns null for invalid data length', () => {
        expect(decodeCompactNode(new Uint8Array(25))).toBeNull()
      })
    })

    describe('encodeCompactNodes / decodeCompactNodes', () => {
      it('encodes/decodes multiple nodes', () => {
        const nodes = [
          { id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 },
          { id: new Uint8Array(20).fill(0x02), host: '2.2.2.2', port: 2222 },
          { id: new Uint8Array(20).fill(0x03), host: '3.3.3.3', port: 3333 },
        ]

        const encoded = encodeCompactNodes(nodes)
        expect(encoded.length).toBe(nodes.length * COMPACT_NODE_BYTES)

        const decoded = decodeCompactNodes(encoded)
        expect(decoded.length).toBe(nodes.length)

        for (let i = 0; i < nodes.length; i++) {
          expect(decoded[i].id).toEqual(nodes[i].id)
          expect(decoded[i].host).toBe(nodes[i].host)
          expect(decoded[i].port).toBe(nodes[i].port)
        }
      })

      it('handles partial data (ignores incomplete nodes)', () => {
        const nodes = [{ id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 }]
        const encoded = encodeCompactNodes(nodes)

        // Add 10 extra bytes (incomplete second node)
        const partial = new Uint8Array(encoded.length + 10)
        partial.set(encoded)

        const decoded = decodeCompactNodes(partial)
        expect(decoded.length).toBe(1)
      })
    })
  })

  describe('Response Parsing Helpers', () => {
    it('getResponseNodeId extracts node ID', () => {
      const encoded = encodePingResponse(transactionId, nodeId)
      const msg = decodeMessage(encoded)

      expect(isResponse(msg!)).toBe(true)
      const id = getResponseNodeId(msg as any)
      expect(id).toEqual(nodeId)
    })

    it('getResponseNodes extracts nodes array', () => {
      const nodes = [
        { id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 },
        { id: new Uint8Array(20).fill(0x02), host: '2.2.2.2', port: 2222 },
      ]
      const encoded = encodeFindNodeResponse(transactionId, nodeId, nodes)
      const msg = decodeMessage(encoded)

      const decoded = getResponseNodes(msg as any)
      expect(decoded.length).toBe(2)
    })

    it('getResponsePeers extracts peers array', () => {
      const peers = [
        { host: '1.2.3.4', port: 8080 },
        { host: '5.6.7.8', port: 9090 },
      ]
      const encoded = encodeGetPeersResponseWithPeers(transactionId, nodeId, token, peers)
      const msg = decodeMessage(encoded)

      const decoded = getResponsePeers(msg as any)
      expect(decoded).toEqual(peers)
    })

    it('getResponseToken extracts token', () => {
      const encoded = encodeGetPeersResponseWithNodes(transactionId, nodeId, token, [])
      const msg = decodeMessage(encoded)

      const decoded = getResponseToken(msg as any)
      expect(decoded).toEqual(token)
    })
  })

  describe('Query Parsing Helpers', () => {
    it('getQueryNodeId extracts sender node ID', () => {
      const encoded = encodePingQuery(transactionId, nodeId)
      const msg = decodeMessage(encoded)

      expect(isQuery(msg!)).toBe(true)
      const id = getQueryNodeId(msg as any)
      expect(id).toEqual(nodeId)
    })

    it('getQueryTarget extracts find_node target', () => {
      const encoded = encodeFindNodeQuery(transactionId, nodeId, targetId)
      const msg = decodeMessage(encoded)

      const target = getQueryTarget(msg as any)
      expect(target).toEqual(targetId)
    })

    it('getQueryInfoHash extracts info_hash', () => {
      const encoded = encodeGetPeersQuery(transactionId, nodeId, infoHash)
      const msg = decodeMessage(encoded)

      const hash = getQueryInfoHash(msg as any)
      expect(hash).toEqual(infoHash)
    })

    it('getQueryToken extracts announce_peer token', () => {
      const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token)
      const msg = decodeMessage(encoded)

      const decoded = getQueryToken(msg as any)
      expect(decoded).toEqual(token)
    })

    it('getQueryPort extracts announce_peer port', () => {
      const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token)
      const msg = decodeMessage(encoded)

      const port = getQueryPort(msg as any)
      expect(port).toBe(6881)
    })

    it('getQueryImpliedPort detects implied_port flag', () => {
      const withImplied = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token, true)
      const withoutImplied = encodeAnnouncePeerQuery(
        transactionId,
        nodeId,
        infoHash,
        6881,
        token,
        false
      )

      const msgWith = decodeMessage(withImplied)
      const msgWithout = decodeMessage(withoutImplied)

      expect(getQueryImpliedPort(msgWith as any)).toBe(true)
      expect(getQueryImpliedPort(msgWithout as any)).toBe(false)
    })
  })
})
```

---

## Phase 2.2: Transaction Manager (transaction-manager.ts)

### 2.2.1 Create `src/dht/transaction-manager.ts`

```typescript
/**
 * Transaction Manager for KRPC
 *
 * Tracks pending queries and routes responses to callbacks.
 * Handles timeouts for unresponsive nodes.
 */

import { QUERY_TIMEOUT_MS } from './constants'

/**
 * Pending query state.
 */
export interface PendingQuery {
  /** 2-byte transaction ID */
  transactionId: Uint8Array
  /** Query method (ping, find_node, etc.) */
  method: string
  /** Target node address */
  target: { host: string; port: number }
  /** Time query was sent */
  sentAt: number
  /** Callback for response or error */
  callback: (err: Error | null, response: unknown) => void
  /** Timeout handle */
  timeoutHandle: ReturnType<typeof setTimeout>
}

/**
 * Transaction Manager for tracking KRPC queries.
 */
export class TransactionManager {
  /** Map of transaction ID (hex) to pending query */
  private pending: Map<string, PendingQuery> = new Map()

  /** Counter for generating unique transaction IDs */
  private counter: number = Math.floor(Math.random() * 0xffff)

  /** Timeout duration in ms */
  private readonly timeoutMs: number

  constructor(timeoutMs: number = QUERY_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  /**
   * Generate a unique 2-byte transaction ID.
   */
  generateTransactionId(): Uint8Array {
    this.counter = (this.counter + 1) & 0xffff
    const id = new Uint8Array(2)
    id[0] = (this.counter >> 8) & 0xff
    id[1] = this.counter & 0xff
    return id
  }

  /**
   * Track a new pending query.
   *
   * @param transactionId - The transaction ID
   * @param method - Query method name
   * @param target - Target node address
   * @param callback - Callback to invoke on response or timeout
   */
  track(
    transactionId: Uint8Array,
    method: string,
    target: { host: string; port: number },
    callback: (err: Error | null, response: unknown) => void
  ): void {
    const key = this.idToKey(transactionId)

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(key)
    }, this.timeoutMs)

    const pending: PendingQuery = {
      transactionId,
      method,
      target,
      sentAt: Date.now(),
      callback,
      timeoutHandle,
    }

    this.pending.set(key, pending)
  }

  /**
   * Handle a response by resolving the corresponding query.
   *
   * @param transactionId - Transaction ID from response
   * @param response - The response object
   * @returns true if a pending query was found, false otherwise
   */
  resolve(transactionId: Uint8Array, response: unknown): boolean {
    const key = this.idToKey(transactionId)
    const pending = this.pending.get(key)

    if (!pending) {
      // Unknown transaction ID - ignore
      return false
    }

    // Clean up
    clearTimeout(pending.timeoutHandle)
    this.pending.delete(key)

    // Invoke callback with response
    pending.callback(null, response)
    return true
  }

  /**
   * Handle an error response.
   *
   * @param transactionId - Transaction ID from error
   * @param code - Error code
   * @param message - Error message
   * @returns true if a pending query was found, false otherwise
   */
  reject(transactionId: Uint8Array, code: number, message: string): boolean {
    const key = this.idToKey(transactionId)
    const pending = this.pending.get(key)

    if (!pending) {
      return false
    }

    // Clean up
    clearTimeout(pending.timeoutHandle)
    this.pending.delete(key)

    // Invoke callback with error
    pending.callback(new Error(`KRPC error ${code}: ${message}`), null)
    return true
  }

  /**
   * Get a pending query by transaction ID.
   */
  get(transactionId: Uint8Array): PendingQuery | undefined {
    return this.pending.get(this.idToKey(transactionId))
  }

  /**
   * Get the number of pending queries.
   */
  size(): number {
    return this.pending.size
  }

  /**
   * Clean up all pending queries (call on shutdown).
   */
  destroy(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle)
      pending.callback(new Error('Transaction manager destroyed'), null)
    }
    this.pending.clear()
  }

  /**
   * Handle timeout for a query.
   */
  private handleTimeout(key: string): void {
    const pending = this.pending.get(key)
    if (!pending) return

    this.pending.delete(key)
    pending.callback(new Error('Query timed out'), null)
  }

  /**
   * Convert transaction ID to map key.
   */
  private idToKey(id: Uint8Array): string {
    return Array.from(id)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
```

### 2.2.2 Create `test/dht/transaction-manager.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransactionManager } from '../../src/dht/transaction-manager'

describe('TransactionManager', () => {
  let manager: TransactionManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new TransactionManager(1000) // 1 second timeout for tests
  })

  afterEach(() => {
    manager.destroy()
    vi.useRealTimers()
  })

  describe('generateTransactionId', () => {
    it('generates unique 2-byte transaction IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const id = manager.generateTransactionId()
        expect(id.length).toBe(2)

        const hex = Array.from(id)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        ids.add(hex)
      }

      expect(ids.size).toBe(100) // All unique
    })

    it('wraps around at 0xFFFF', () => {
      // Generate many IDs to ensure wrap-around works
      for (let i = 0; i < 0x10000 + 10; i++) {
        const id = manager.generateTransactionId()
        expect(id.length).toBe(2)
      }
    })
  })

  describe('track', () => {
    it('tracks pending query with callback', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      expect(manager.size()).toBe(1)
      expect(manager.get(id)).toBeDefined()
      expect(manager.get(id)?.method).toBe('ping')
    })
  })

  describe('resolve', () => {
    it('resolves correct callback on response', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()
      const response = { r: { id: new Uint8Array(20) } }

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)
      const found = manager.resolve(id, response)

      expect(found).toBe(true)
      expect(callback).toHaveBeenCalledWith(null, response)
      expect(manager.size()).toBe(0)
    })

    it('ignores responses with unknown transaction ID', () => {
      const unknownId = new Uint8Array([0xff, 0xff])
      const found = manager.resolve(unknownId, {})

      expect(found).toBe(false)
    })

    it('routes responses to correct callback among multiple pending', () => {
      const id1 = manager.generateTransactionId()
      const id2 = manager.generateTransactionId()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      manager.track(id1, 'ping', { host: '1.1.1.1', port: 6881 }, callback1)
      manager.track(id2, 'find_node', { host: '2.2.2.2', port: 6881 }, callback2)

      const response = { test: 'data' }
      manager.resolve(id2, response)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith(null, response)
      expect(manager.size()).toBe(1)
    })
  })

  describe('reject', () => {
    it('calls callback with error on KRPC error', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'announce_peer', { host: '127.0.0.1', port: 6881 }, callback)
      manager.reject(id, 203, 'Bad token')

      expect(callback).toHaveBeenCalledWith(expect.any(Error), null)
      expect(callback.mock.calls[0][0].message).toContain('203')
      expect(callback.mock.calls[0][0].message).toContain('Bad token')
    })
  })

  describe('timeout', () => {
    it('times out after configured duration', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      // Not yet timed out
      vi.advanceTimersByTime(500)
      expect(callback).not.toHaveBeenCalled()

      // Now timed out
      vi.advanceTimersByTime(600) // Total 1100ms > 1000ms timeout
      expect(callback).toHaveBeenCalledWith(expect.any(Error), null)
      expect(callback.mock.calls[0][0].message).toContain('timed out')
    })

    it('cleans up on timeout', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)
      expect(manager.size()).toBe(1)

      vi.advanceTimersByTime(1100)

      expect(manager.size()).toBe(0)
      expect(manager.get(id)).toBeUndefined()
    })

    it('does not timeout if resolved first', () => {
      const id = manager.generateTransactionId()
      const callback = vi.fn()

      manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, callback)

      // Resolve before timeout
      manager.resolve(id, { success: true })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(null, { success: true })

      // Advance past timeout
      vi.advanceTimersByTime(2000)

      // Should not be called again
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroy', () => {
    it('cleans up all pending queries', () => {
      const callbacks = [vi.fn(), vi.fn(), vi.fn()]

      for (const cb of callbacks) {
        const id = manager.generateTransactionId()
        manager.track(id, 'ping', { host: '127.0.0.1', port: 6881 }, cb)
      }

      expect(manager.size()).toBe(3)

      manager.destroy()

      expect(manager.size()).toBe(0)
      for (const cb of callbacks) {
        expect(cb).toHaveBeenCalledWith(expect.any(Error), null)
      }
    })
  })
})
```

---

## Phase 2.3: KRPC Socket (krpc-socket.ts)

### 2.3.1 Create `src/dht/krpc-socket.ts`

```typescript
/**
 * KRPC Socket
 *
 * Wraps IUdpSocket with KRPC message encoding/decoding and transaction management.
 * Emits 'query' events for incoming queries that need handling.
 */

import { EventEmitter } from '../utils/event-emitter'
import { IUdpSocket, ISocketFactory } from '../interfaces/socket'
import { TransactionManager, PendingQuery } from './transaction-manager'
import {
  KRPCQuery,
  KRPCResponse,
  KRPCError,
  decodeMessage,
  isQuery,
  isResponse,
  isError,
} from './krpc-messages'
import { QUERY_TIMEOUT_MS } from './constants'

/**
 * Options for KRPCSocket.
 */
export interface KRPCSocketOptions {
  /** Query timeout in ms (default: 5000) */
  timeout?: number
  /** Bind address (default: '0.0.0.0') */
  bindAddr?: string
  /** Bind port (default: 0 for random) */
  bindPort?: number
}

/**
 * Events emitted by KRPCSocket.
 */
export interface KRPCSocketEvents {
  /**
   * Emitted when an incoming query is received.
   * Handler should process and send a response.
   */
  query: (query: KRPCQuery, rinfo: { host: string; port: number }) => void

  /**
   * Emitted on socket errors.
   */
  error: (err: Error) => void
}

/**
 * KRPC Socket for DHT communication.
 */
export class KRPCSocket extends EventEmitter {
  private socket: IUdpSocket | null = null
  private transactions: TransactionManager
  private socketFactory: ISocketFactory
  private options: Required<KRPCSocketOptions>

  constructor(socketFactory: ISocketFactory, options: KRPCSocketOptions = {}) {
    super()
    this.socketFactory = socketFactory
    this.options = {
      timeout: options.timeout ?? QUERY_TIMEOUT_MS,
      bindAddr: options.bindAddr ?? '0.0.0.0',
      bindPort: options.bindPort ?? 0,
    }
    this.transactions = new TransactionManager(this.options.timeout)
  }

  /**
   * Initialize the socket and start listening.
   */
  async bind(): Promise<void> {
    if (this.socket) {
      throw new Error('Socket already bound')
    }

    this.socket = await this.socketFactory.createUdpSocket(
      this.options.bindAddr,
      this.options.bindPort
    )

    this.socket.onMessage((rinfo, data) => {
      this.handleMessage(data, rinfo)
    })
  }

  /**
   * Send a query and wait for response.
   *
   * @param host - Target host
   * @param port - Target port
   * @param data - Encoded KRPC query (must include transaction ID)
   * @param transactionId - Transaction ID used in the query
   * @param method - Query method name (for tracking)
   * @returns Promise resolving to the response or rejecting on error/timeout
   */
  query(
    host: string,
    port: number,
    data: Uint8Array,
    transactionId: Uint8Array,
    method: string
  ): Promise<KRPCResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not bound'))
        return
      }

      this.transactions.track(transactionId, method, { host, port }, (err, response) => {
        if (err) {
          reject(err)
        } else {
          resolve(response as KRPCResponse)
        }
      })

      this.socket.send(host, port, data)
    })
  }

  /**
   * Send raw data (for responses).
   */
  send(host: string, port: number, data: Uint8Array): void {
    if (!this.socket) {
      throw new Error('Socket not bound')
    }
    this.socket.send(host, port, data)
  }

  /**
   * Generate a new transaction ID.
   */
  generateTransactionId(): Uint8Array {
    return this.transactions.generateTransactionId()
  }

  /**
   * Get the number of pending queries.
   */
  pendingCount(): number {
    return this.transactions.size()
  }

  /**
   * Get timeout configuration.
   */
  getTimeout(): number {
    return this.options.timeout
  }

  /**
   * Close the socket and clean up.
   */
  close(): void {
    this.transactions.destroy()
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  /**
   * Handle incoming UDP message.
   */
  private handleMessage(data: Uint8Array, rinfo: { addr: string; port: number }): void {
    const msg = decodeMessage(data)
    if (!msg) {
      // Invalid message - ignore
      return
    }

    if (isResponse(msg)) {
      // Route to pending query
      this.transactions.resolve(msg.t, msg)
    } else if (isError(msg)) {
      // Route error to pending query
      this.transactions.reject(msg.t, msg.e[0], msg.e[1])
    } else if (isQuery(msg)) {
      // Emit for handler to process
      this.emit('query', msg, { host: rinfo.addr, port: rinfo.port })
    }
  }
}
```

### 2.3.2 Create `test/dht/krpc-socket.test.ts`

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KRPCSocket } from '../../src/dht/krpc-socket'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'
import {
  encodePingQuery,
  encodePingResponse,
  encodeErrorResponse,
  KRPCErrorCode,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'

// Mock UDP Socket
class MockUdpSocket implements IUdpSocket {
  public sentData: Array<{ addr: string; port: number; data: Uint8Array }> = []
  private messageCallback: ((rinfo: { addr: string; port: number }, data: Uint8Array) => void) | null = null

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

  // Test helper: simulate incoming message
  emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
    if (this.messageCallback) {
      this.messageCallback({ addr, port }, data)
    }
  }
}

// Mock Socket Factory
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

describe('KRPCSocket', () => {
  let factory: MockSocketFactory
  let krpcSocket: KRPCSocket
  const nodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)

  beforeEach(async () => {
    vi.useFakeTimers()
    factory = new MockSocketFactory()
    krpcSocket = new KRPCSocket(factory, { timeout: 1000 })
    await krpcSocket.bind()
  })

  afterEach(() => {
    krpcSocket.close()
    vi.useRealTimers()
  })

  describe('bind', () => {
    it('creates UDP socket via factory', async () => {
      // Already bound in beforeEach
      expect(factory.mockSocket).toBeDefined()
    })

    it('throws if already bound', async () => {
      await expect(krpcSocket.bind()).rejects.toThrow('already bound')
    })
  })

  describe('query', () => {
    it('sends encoded query via IUdpSocket', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      // Start query (won't resolve until we send response)
      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Verify data was sent
      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe('192.168.1.1')
      expect(factory.mockSocket.sentData[0].port).toBe(6881)

      // Send response
      const responseData = encodePingResponse(transactionId, new Uint8Array(20).fill(0x22))
      factory.mockSocket.emitMessage(responseData, '192.168.1.1', 6881)

      const response = await queryPromise
      expect(response.y).toBe('r')
    })

    it('routes responses to transaction manager', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Send response
      const responseId = new Uint8Array(20).fill(0x22)
      const responseData = encodePingResponse(transactionId, responseId)
      factory.mockSocket.emitMessage(responseData)

      const response = await queryPromise
      expect(response.r.id).toEqual(responseId)
    })

    it('respects query timeout configuration', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Advance time past timeout
      vi.advanceTimersByTime(1100)

      await expect(queryPromise).rejects.toThrow('timed out')
    })
  })

  describe('incoming queries', () => {
    it('emits query event for incoming queries', async () => {
      const queryHandler = vi.fn()
      krpcSocket.on('query', queryHandler)

      // Simulate incoming ping query
      const transactionId = new Uint8Array([0xaa, 0xbb])
      const senderId = new Uint8Array(20).fill(0x33)
      const queryData = encodePingQuery(transactionId, senderId)

      factory.mockSocket.emitMessage(queryData, '10.0.0.1', 12345)

      expect(queryHandler).toHaveBeenCalledTimes(1)
      expect(queryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          y: 'q',
          q: 'ping',
        }),
        { host: '10.0.0.1', port: 12345 }
      )
    })
  })

  describe('incoming errors', () => {
    it('rejects pending query with KRPC error', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Send error response
      const errorData = encodeErrorResponse(transactionId, KRPCErrorCode.PROTOCOL, 'Bad request')
      factory.mockSocket.emitMessage(errorData)

      await expect(queryPromise).rejects.toThrow('203')
      await expect(queryPromise).rejects.toThrow('Bad request')
    })
  })

  describe('send', () => {
    it('sends raw data for responses', () => {
      const responseData = encodePingResponse(new Uint8Array([0x01, 0x02]), nodeId)

      krpcSocket.send('192.168.1.1', 6881, responseData)

      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].data).toEqual(responseData)
    })

    it('throws if socket not bound', () => {
      const unboundSocket = new KRPCSocket(factory)

      expect(() => unboundSocket.send('127.0.0.1', 6881, new Uint8Array([]))).toThrow('not bound')
    })
  })

  describe('generateTransactionId', () => {
    it('generates unique transaction IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const id = krpcSocket.generateTransactionId()
        ids.add(Array.from(id).join(','))
      }

      expect(ids.size).toBe(100)
    })
  })

  describe('close', () => {
    it('cleans up socket and transactions', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      krpcSocket.close()

      await expect(queryPromise).rejects.toThrow()
      expect(krpcSocket.pendingCount()).toBe(0)
    })
  })

  describe('malformed messages', () => {
    it('ignores malformed incoming data', () => {
      const queryHandler = vi.fn()
      krpcSocket.on('query', queryHandler)

      // Send garbage data
      factory.mockSocket.emitMessage(new Uint8Array([0x00, 0x01, 0x02, 0x03]))

      expect(queryHandler).not.toHaveBeenCalled()
    })

    it('ignores responses with unknown transaction ID', () => {
      // Send response with unknown transaction ID
      const unknownTxId = new Uint8Array([0xff, 0xfe])
      const responseData = encodePingResponse(unknownTxId, nodeId)

      // Should not throw
      factory.mockSocket.emitMessage(responseData)

      expect(krpcSocket.pendingCount()).toBe(0)
    })
  })
})
```

---

## Phase 2.4: Update Index Exports

### 2.4.1 Update `src/dht/index.ts`

Add the new exports to the existing file. Find the existing content and add after it:

```typescript
/**
 * DHT Module - BEP 5 Implementation
 *
 * Distributed Hash Table for trackerless peer discovery.
 */

// Types
export type {
  DHTNode,
  Bucket,
  RoutingTableState,
  RoutingTableEvents,
  CompactPeer,
  CompactNodeInfo,
} from './types'

// Constants
export {
  K,
  ALPHA,
  NODE_ID_BYTES,
  NODE_ID_BITS,
  QUERY_TIMEOUT_MS,
  BUCKET_REFRESH_MS,
  NODE_QUESTIONABLE_MS,
  TOKEN_ROTATION_MS,
  TOKEN_MAX_AGE_MS,
  COMPACT_PEER_BYTES,
  COMPACT_NODE_BYTES,
  CLIENT_VERSION,
  MAX_NODE_ID,
} from './constants'

// XOR Distance Utilities
export {
  xorDistance,
  compareDistance,
  getBucketIndex,
  nodeIdToBigInt,
  bigIntToNodeId,
  nodeIdsEqual,
  generateRandomNodeId,
  generateRandomIdInBucket,
  nodeIdToHex,
  hexToNodeId,
} from './xor-distance'

// Routing Table
export { RoutingTable } from './routing-table'

// ============================================================================
// Phase 2 Exports - KRPC Protocol Layer
// ============================================================================

// KRPC Message Types
export type {
  KRPCQuery,
  KRPCResponse,
  KRPCError,
  KRPCMessage,
} from './krpc-messages'

// KRPC Message Encoding
export {
  // Encoding queries
  encodePingQuery,
  encodeFindNodeQuery,
  encodeGetPeersQuery,
  encodeAnnouncePeerQuery,
  // Encoding responses
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  // Decoding
  decodeMessage,
  isQuery,
  isResponse,
  isError,
  // Compact encoding
  encodeCompactPeer,
  decodeCompactPeer,
  decodeCompactPeers,
  encodeCompactNode,
  encodeCompactNodes,
  decodeCompactNode,
  decodeCompactNodes,
  // Response helpers
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
  getQueryNodeId,
  getQueryTarget,
  getQueryInfoHash,
  getQueryToken,
  getQueryPort,
  getQueryImpliedPort,
  // Error codes
  KRPCErrorCode,
} from './krpc-messages'

// Transaction Manager
export type { PendingQuery } from './transaction-manager'
export { TransactionManager } from './transaction-manager'

// KRPC Socket
export type { KRPCSocketOptions, KRPCSocketEvents } from './krpc-socket'
export { KRPCSocket } from './krpc-socket'
```

---

## Verification Steps

After implementing all files, run these verification steps:

### Step 1: TypeScript Compilation

```bash
cd packages/engine
pnpm typecheck
```

**Expected:** No type errors.

### Step 2: Run Tests

```bash
# From monorepo root
pnpm test

# Or specifically DHT tests
cd packages/engine
pnpm test -- --grep "KRPC\|Transaction"
```

**Expected:** All new tests pass.

### Step 3: Lint

```bash
pnpm lint
```

**Expected:** No lint errors (may need `pnpm lint --fix` for formatting).

### Step 4: Format

```bash
pnpm format:fix
```

**Expected:** Files formatted according to project standards.

---

## Test Summary

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `krpc-messages.test.ts` | ~25 | Encode/decode all message types, compact encoding |
| `transaction-manager.test.ts` | ~12 | Transaction ID generation, tracking, timeout, cleanup |
| `krpc-socket.test.ts` | ~12 | Send/receive, query routing, error handling |

---

## Checklist Before Moving to Phase 3

- [ ] `src/dht/krpc-messages.ts` created with all encode/decode functions
- [ ] `src/dht/transaction-manager.ts` created with timeout handling
- [ ] `src/dht/krpc-socket.ts` created combining socket + transactions
- [ ] `src/dht/index.ts` updated with new exports
- [ ] `test/dht/krpc-messages.test.ts` passes
- [ ] `test/dht/transaction-manager.test.ts` passes
- [ ] `test/dht/krpc-socket.test.ts` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` (full suite) passes

---

## Notes for Agent

1. **Use existing Bencode utility** at `src/utils/bencode.ts` - don't implement your own
2. **Follow test patterns** from existing DHT tests and `test/tracker/udp-tracker.test.ts`
3. **Transaction IDs are 2 bytes** - this is standard KRPC per BEP 5
4. **The mock socket pattern** is shown in `test/tracker/udp-tracker.test.ts` - follow it
5. **Run tests frequently** - after each file is created, run `pnpm test` to catch issues early
6. **TypeScript strict mode** - ensure all types are correct, no `any` unless necessary
7. **Event emitter** - use `src/utils/event-emitter.ts`, same pattern as RoutingTable
