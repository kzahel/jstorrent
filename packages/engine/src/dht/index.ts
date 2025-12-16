/**
 * DHT Module - BEP 5 Implementation
 *
 * Distributed Hash Table for trackerless peer discovery.
 */

// Types
export type {
  DHTNodeInfo,
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
  BOOTSTRAP_NODES,
  BOOTSTRAP_CONCURRENCY,
  BOOTSTRAP_MAX_ITERATIONS,
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
export type { KRPCQuery, KRPCResponse, KRPCError, KRPCMessage } from './krpc-messages'

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

// ============================================================================
// Phase 3 Exports - Query Handlers (Server Side)
// ============================================================================

// Token Store
export type { TokenStoreOptions } from './token-store'
export { TokenStore } from './token-store'

// Peer Store
export type { PeerStoreOptions } from './peer-store'
export {
  PeerStore,
  DEFAULT_PEER_TTL_MS,
  DEFAULT_MAX_PEERS_PER_INFOHASH,
  DEFAULT_MAX_INFOHASHES,
} from './peer-store'

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

// ============================================================================
// Phase 4 Exports - DHTNode (Client Side)
// ============================================================================

// DHTNode class and types
export type {
  DHTNodeOptions,
  DHTNodeEvents,
  GetPeersResult,
  BootstrapOptions,
  BootstrapStats,
} from './dht-node'
export { DHTNode } from './dht-node'
