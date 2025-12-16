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
