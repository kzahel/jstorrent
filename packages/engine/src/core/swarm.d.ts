import { EventEmitter } from '../utils/event-emitter'
import type { PeerConnection } from './peer-connection'
import type { Logger } from '../logging/logger'
export type AddressFamily = 'ipv4' | 'ipv6'
export interface PeerAddress {
  ip: string
  port: number
  family: AddressFamily
}
export type DiscoverySource =
  | 'tracker'
  | 'pex'
  | 'dht'
  | 'lpd'
  | 'incoming'
  | 'manual'
  | 'magnet_hint'
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'banned'
export interface SwarmPeer {
  ip: string
  port: number
  family: AddressFamily
  source: DiscoverySource
  discoveredAt: number
  state: ConnectionState
  connection: PeerConnection | null
  peerId: Uint8Array | null
  clientName: string | null
  connectAttempts: number
  connectFailures: number
  lastConnectAttempt: number | null
  lastConnectSuccess: number | null
  lastConnectError: string | null
  banReason: string | null
  suspiciousPort: boolean
  totalDownloaded: number
  totalUploaded: number
}
export interface SwarmStats {
  total: number
  byState: {
    idle: number
    connecting: number
    connected: number
    failed: number
    banned: number
  }
  byFamily: {
    ipv4: number
    ipv6: number
  }
  bySource: {
    tracker: number
    pex: number
    dht: number
    lpd: number
    incoming: number
    manual: number
    magnet_hint: number
  }
  identifiedPeers: number
  multiAddressPeers: PeerIdentity[]
}
export interface PeerIdentity {
  peerId: string
  clientName: string | null
  addresses: Array<{
    key: string
    family: AddressFamily
    state: ConnectionState
  }>
  totalDownloaded: number
  totalUploaded: number
}
/**
 * Check if a port is valid for BitTorrent connections.
 * Returns false for port 0 (invalid) and other clearly wrong values.
 */
export declare function isValidPort(port: number): boolean
/**
 * Check if a port is suspicious (likely misconfiguration or malicious).
 * These peers should be heavily down-scored or skipped entirely.
 */
export declare function isSuspiciousPort(port: number): boolean
/**
 * Get a score penalty for suspicious ports.
 * Returns 0 for normal ports, negative values for suspicious ones.
 */
export declare function getPortScorePenalty(port: number): number
/**
 * Create canonical address key for Map.
 * IPv6 needs brackets to disambiguate from port.
 */
export declare function addressKey(addr: PeerAddress): string
/**
 * Parse address key back to PeerAddress.
 */
export declare function parseAddressKey(key: string): PeerAddress
/**
 * Detect address family from string.
 */
export declare function detectAddressFamily(ip: string): AddressFamily
/**
 * Create canonical peer key from IP and port.
 * This is the preferred helper for creating keys when you don't have a full PeerAddress.
 * Automatically detects address family.
 */
export declare function peerKey(ip: string, port: number): string
/**
 * Normalize an IP address to canonical form.
 * - IPv4: as-is
 * - IPv6: lowercase, compressed
 * - IPv4-mapped IPv6: optionally extract IPv4
 */
export declare function normalizeAddress(
  ip: string,
  extractMappedIPv4?: boolean,
): {
  ip: string
  family: AddressFamily
}
/**
 * Compress IPv6 address (collapse longest run of zeros).
 * "2001:0db8:0000:0000:0000:0000:0000:0001" → "2001:db8::1"
 */
export declare function compressIPv6(ip: string): string
/**
 * Parse compact peer format from tracker/PEX.
 */
export declare function parseCompactPeers(data: Uint8Array, family: AddressFamily): PeerAddress[]
export interface SwarmEvents {
  peersAdded: (count: number) => void
  peerConnected: (key: string, peer: SwarmPeer) => void
  peerDisconnected: (key: string, peer: SwarmPeer) => void
}
export declare class Swarm extends EventEmitter {
  private logger
  private peers
  private connectedKeys
  private connectingKeys
  private peerIdIndex
  constructor(logger: Logger)
  /**
   * Check if a peer exists in the swarm by key.
   */
  hasPeer(key: string): boolean
  /**
   * Add a peer address from any discovery source.
   * If already known, does nothing (first discovery wins).
   * Returns the peer (new or existing), or null if the address is invalid.
   */
  addPeer(address: PeerAddress, source: DiscoverySource): SwarmPeer | null
  /**
   * Bulk add peers (e.g., from tracker response or PEX).
   * Returns count of newly added valid peers.
   */
  addPeers(addresses: PeerAddress[], source: DiscoverySource): number
  /**
   * Add peers from compact format (tracker response or PEX).
   */
  addCompactPeers(data: Uint8Array, family: AddressFamily, source: DiscoverySource): number
  /**
   * Get peers eligible for connection attempts.
   * Filters out: connected, connecting, in backoff, banned.
   * Returns list sorted by quality score (best first), limited to `limit` peers.
   * Suspicious port peers are returned last (only as last resort).
   */
  getConnectablePeers(limit: number): SwarmPeer[]
  /**
   * Calculate a quality score for peer selection.
   * Higher is better.
   */
  private calculatePeerScore
  /**
   * Mark connection attempt started.
   */
  markConnecting(key: string): void
  /**
   * Mark connection successful.
   */
  markConnected(key: string, connection: PeerConnection): void
  /**
   * Update peer identity after handshake.
   * Also updates the peerId index for grouping.
   */
  setIdentity(key: string, peerId: Uint8Array, clientName: string | null): void
  /**
   * Mark connection failed.
   */
  markConnectFailed(key: string, reason: string): void
  /**
   * Mark peer disconnected (was connected, now isn't).
   */
  markDisconnected(key: string): void
  /**
   * Handle incoming connection (peer connected to us).
   * For incoming connections, we accept even suspicious ports since
   * the connection is already established.
   */
  addIncomingConnection(
    ip: string,
    port: number,
    family: AddressFamily,
    connection: PeerConnection,
  ): SwarmPeer
  /**
   * Ban a peer (bad behavior, corrupt data, etc).
   */
  ban(key: string, reason: string): void
  /**
   * Unban a peer (e.g., if swarm is tiny and we need peers).
   */
  unban(key: string): void
  /**
   * Unban all peers that weren't banned for data corruption.
   * Useful when swarm is very small and we're desperate.
   */
  unbanRecoverable(): number
  get size(): number
  get connectedCount(): number
  get connectingCount(): number
  get bannedCount(): number
  /**
   * Get all connected peers efficiently.
   */
  getConnectedPeers(): PeerConnection[]
  /**
   * Get SwarmPeer by address.
   */
  getPeer(ip: string, port: number, family: AddressFamily): SwarmPeer | undefined
  getPeerByKey(key: string): SwarmPeer | undefined
  /**
   * Get all peers for a specific peer identity.
   */
  getPeersByPeerId(peerIdHex: string): SwarmPeer[]
  /**
   * Count peers by family.
   */
  countByFamily(family: AddressFamily): number
  /**
   * Get stats summary for debugging/UI.
   */
  getStats(): SwarmStats
  /**
   * Get all peers (for debugging). Returns iterator to avoid copying.
   */
  allPeers(): IterableIterator<SwarmPeer>
  private calculateBackoff
  private shuffle
  /**
   * Clear all peers (on torrent removal).
   */
  clear(): void
}
//# sourceMappingURL=swarm.d.ts.map
