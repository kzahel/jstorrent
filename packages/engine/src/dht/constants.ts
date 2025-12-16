/**
 * DHT Protocol Constants
 *
 * Based on BEP 5: DHT Protocol
 * Reference: beps_md/accepted/bep_0005.md
 */

/**
 * K: Maximum nodes per bucket and replication factor.
 * From BEP 5: "Each bucket can only hold K nodes, currently eight"
 */
export const K = 8

/**
 * Alpha: Number of parallel queries during lookup.
 * Standard Kademlia value for concurrent queries.
 */
export const ALPHA = 3

/**
 * Node ID size in bytes (160 bits = 20 bytes).
 * Same as infohash size.
 */
export const NODE_ID_BYTES = 20

/**
 * Node ID size in bits.
 */
export const NODE_ID_BITS = 160

/**
 * Query timeout in milliseconds.
 * Time to wait for a response before considering the query failed.
 */
export const QUERY_TIMEOUT_MS = 5000

/**
 * Bucket refresh interval in milliseconds (15 minutes).
 * From BEP 5: "Buckets that have not been changed in 15 minutes should be refreshed"
 */
export const BUCKET_REFRESH_MS = 15 * 60 * 1000

/**
 * Node becomes questionable after this many milliseconds of inactivity.
 * From BEP 5: "After 15 minutes of inactivity, a node becomes questionable"
 */
export const NODE_QUESTIONABLE_MS = 15 * 60 * 1000

/**
 * Token rotation interval in milliseconds (5 minutes).
 * From BEP 5: "a secret that changes every five minutes"
 */
export const TOKEN_ROTATION_MS = 5 * 60 * 1000

/**
 * Maximum token age in milliseconds (10 minutes).
 * From BEP 5: "tokens up to ten minutes old are accepted"
 */
export const TOKEN_MAX_AGE_MS = 10 * 60 * 1000

/**
 * Compact peer info size in bytes (4 IP + 2 port).
 */
export const COMPACT_PEER_BYTES = 6

/**
 * Compact node info size in bytes (20 ID + 6 peer).
 */
export const COMPACT_NODE_BYTES = 26

/**
 * Client version string for KRPC messages.
 * "JS" = JSTorrent, "01" = version 0.1
 */
export const CLIENT_VERSION = new Uint8Array([0x4a, 0x53, 0x30, 0x31]) // "JS01"

/**
 * Maximum ID value (2^160 - 1) as bigint.
 */
export const MAX_NODE_ID = (1n << 160n) - 1n

/**
 * Well-known DHT bootstrap nodes.
 * Used to populate initial routing table when starting fresh.
 * These are operated by major BitTorrent clients.
 */
export const BOOTSTRAP_NODES: ReadonlyArray<{ host: string; port: number }> = [
  { host: 'router.bittorrent.com', port: 6881 },
  { host: 'router.utorrent.com', port: 6881 },
  { host: 'dht.transmissionbt.com', port: 6881 },
]

/**
 * Maximum number of concurrent queries during bootstrap.
 * Same as ALPHA for iterative lookups.
 */
export const BOOTSTRAP_CONCURRENCY = ALPHA

/**
 * Maximum iterations during bootstrap to prevent infinite loops.
 * Should be enough to traverse the DHT depth.
 */
export const BOOTSTRAP_MAX_ITERATIONS = 20
