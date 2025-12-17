/**
 * DHT Type Definitions
 *
 * Based on BEP 5: DHT Protocol
 * Reference: beps_md/accepted/bep_0005.md
 */

/**
 * A DHT node's contact information (not to be confused with a BitTorrent peer).
 * Nodes participate in the DHT, storing peer information.
 */
export interface DHTNodeInfo {
  /** 20-byte node ID (same space as infohashes) */
  id: Uint8Array
  /** IPv4 or IPv6 address */
  host: string
  /** UDP port */
  port: number
  /** Timestamp when we last received a valid response from this node */
  lastSeen?: number
  /** Timestamp when we last sent a query to this node */
  lastQueried?: number
}

/**
 * A K-bucket in the routing table.
 * Each bucket covers a range of the 160-bit ID space.
 */
export interface Bucket {
  /** Minimum ID in this bucket's range (inclusive) */
  min: bigint
  /** Maximum ID in this bucket's range (exclusive) */
  max: bigint
  /** Nodes in this bucket, ordered by last seen (oldest first) */
  nodes: DHTNodeInfo[]
  /** Timestamp when this bucket last changed */
  lastChanged: number
}

/**
 * Serializable routing table state for persistence.
 */
export interface RoutingTableState {
  /** Our node ID in hex */
  nodeId: string
  /** All nodes from all buckets */
  nodes: Array<{
    id: string
    host: string
    port: number
  }>
}

/**
 * Events emitted by the routing table.
 */
export interface RoutingTableEvents {
  /**
   * Emitted when a bucket is full and the least recently seen node
   * should be pinged to verify it's still alive.
   */
  ping: (node: DHTNodeInfo) => void

  /**
   * Emitted when a node is added to the routing table.
   */
  nodeAdded: (node: DHTNodeInfo) => void

  /**
   * Emitted when a node is removed from the routing table.
   */
  nodeRemoved: (node: DHTNodeInfo) => void
}

/**
 * Compact peer info: 6 bytes (4 IP + 2 port)
 */
export interface CompactPeer {
  host: string
  port: number
}

/**
 * Compact node info: 26 bytes (20 ID + 6 peer)
 */
export interface CompactNodeInfo {
  id: Uint8Array
  host: string
  port: number
}
