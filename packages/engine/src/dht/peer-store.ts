/**
 * Peer Store for DHT
 *
 * Stores peer contact information by infohash.
 * Peers expire after a TTL and are capped per infohash to prevent memory exhaustion.
 *
 * Reference: BEP 5 - "the queried node should store the IP address of the querying
 * node and the supplied port number under the infohash in its store of peer contact information"
 */

import { CompactPeer } from './types'

/**
 * Default peer TTL: 30 minutes.
 * Peers should re-announce periodically; if they don't, they're probably gone.
 */
export const DEFAULT_PEER_TTL_MS = 30 * 60 * 1000

/**
 * Default max peers per infohash.
 * Prevents memory exhaustion from popular torrents.
 */
export const DEFAULT_MAX_PEERS_PER_INFOHASH = 100

/**
 * Default max infohashes to track.
 * Prevents memory exhaustion from many different torrents.
 */
export const DEFAULT_MAX_INFOHASHES = 10000

/**
 * Options for PeerStore.
 */
export interface PeerStoreOptions {
  /** Peer TTL in ms (default: 30 minutes) */
  peerTtlMs?: number
  /** Max peers per infohash (default: 100) */
  maxPeersPerInfohash?: number
  /** Max infohashes to track (default: 10000) */
  maxInfohashes?: number
}

/**
 * Internal peer entry with timestamp.
 */
interface PeerEntry {
  host: string
  port: number
  addedAt: number
}

/**
 * Stores peers by infohash with TTL expiration.
 */
export class PeerStore {
  /** Map of infohash (hex) → peer entries */
  private store: Map<string, PeerEntry[]> = new Map()

  private readonly peerTtlMs: number
  private readonly maxPeersPerInfohash: number
  private readonly maxInfohashes: number

  constructor(options: PeerStoreOptions = {}) {
    this.peerTtlMs = options.peerTtlMs ?? DEFAULT_PEER_TTL_MS
    this.maxPeersPerInfohash = options.maxPeersPerInfohash ?? DEFAULT_MAX_PEERS_PER_INFOHASH
    this.maxInfohashes = options.maxInfohashes ?? DEFAULT_MAX_INFOHASHES
  }

  /**
   * Add a peer for an infohash.
   * If the peer already exists, updates its timestamp.
   *
   * @param infoHash - 20-byte infohash
   * @param peer - Peer contact info
   */
  addPeer(infoHash: Uint8Array, peer: CompactPeer): void {
    const key = this.hashToKey(infoHash)
    let peers = this.store.get(key)

    if (!peers) {
      // Check if we're at max infohashes
      if (this.store.size >= this.maxInfohashes) {
        // Evict oldest infohash (first entry in map)
        const oldestKey = this.store.keys().next().value
        if (oldestKey) {
          this.store.delete(oldestKey)
        }
      }

      peers = []
      this.store.set(key, peers)
    }

    // Check if peer already exists
    const existing = peers.find((p) => p.host === peer.host && p.port === peer.port)

    if (existing) {
      // Update timestamp
      existing.addedAt = Date.now()
    } else {
      // Add new peer
      if (peers.length >= this.maxPeersPerInfohash) {
        // Remove oldest peer
        peers.shift()
      }

      peers.push({
        host: peer.host,
        port: peer.port,
        addedAt: Date.now(),
      })
    }
  }

  /**
   * Get peers for an infohash.
   * Returns only non-expired peers.
   *
   * @param infoHash - 20-byte infohash
   * @returns Array of peers (may be empty)
   */
  getPeers(infoHash: Uint8Array): CompactPeer[] {
    const key = this.hashToKey(infoHash)
    const peers = this.store.get(key)

    if (!peers) {
      return []
    }

    const now = Date.now()
    const validPeers: CompactPeer[] = []

    for (const peer of peers) {
      if (now - peer.addedAt < this.peerTtlMs) {
        validPeers.push({ host: peer.host, port: peer.port })
      }
    }

    return validPeers
  }

  /**
   * Check if we have any peers for an infohash.
   *
   * @param infoHash - 20-byte infohash
   * @returns true if we have at least one non-expired peer
   */
  hasPeers(infoHash: Uint8Array): boolean {
    return this.getPeers(infoHash).length > 0
  }

  /**
   * Remove expired peers from all infohashes.
   * Call this periodically to free memory.
   */
  cleanup(): void {
    const now = Date.now()

    for (const [key, peers] of this.store.entries()) {
      // Filter out expired peers
      const validPeers = peers.filter((p) => now - p.addedAt < this.peerTtlMs)

      if (validPeers.length === 0) {
        // Remove empty infohash entry
        this.store.delete(key)
      } else if (validPeers.length !== peers.length) {
        // Update with filtered list
        this.store.set(key, validPeers)
      }
    }
  }

  /**
   * Get the number of infohashes being tracked.
   */
  infohashCount(): number {
    return this.store.size
  }

  /**
   * Get the total number of peers stored (including possibly expired).
   */
  totalPeerCount(): number {
    let count = 0
    for (const peers of this.store.values()) {
      count += peers.length
    }
    return count
  }

  /**
   * Clear all stored peers.
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Convert infohash to map key.
   */
  private hashToKey(infoHash: Uint8Array): string {
    return Array.from(infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
