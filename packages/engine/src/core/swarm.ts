import { EventEmitter } from '../utils/event-emitter'
import { toHex } from '../utils/buffer'
import type { PeerConnection } from './peer-connection'
import type { Logger } from '../logging/logger'

// ============================================================================
// Types
// ============================================================================

export type AddressFamily = 'ipv4' | 'ipv6'

export interface PeerAddress {
  ip: string // Canonical form: "1.2.3.4" or "2001:db8::1" (no brackets)
  port: number
  family: AddressFamily
}

export type DiscoverySource = 'tracker' | 'pex' | 'dht' | 'lpd' | 'incoming' | 'manual'

export type ConnectionState =
  | 'idle' // Known but never tried, or recovered from failed
  | 'connecting' // Connection in progress
  | 'connected' // Active connection
  | 'failed' // Last attempt failed (in backoff)
  | 'banned' // Bad behavior - only for data corruption, not connection failures

export interface SwarmPeer {
  // Address (key is addressKey(this))
  ip: string
  port: number
  family: AddressFamily

  // How we first discovered this peer
  source: DiscoverySource
  discoveredAt: number

  // Connection state
  state: ConnectionState
  connection: PeerConnection | null

  // Identity (populated after successful handshake)
  peerId: Uint8Array | null
  clientName: string | null // Parsed from peerId, e.g. "µTorrent 3.5.5"

  // Connection history
  connectAttempts: number
  connectFailures: number
  lastConnectAttempt: number | null
  lastConnectSuccess: number | null
  lastConnectError: string | null

  // Ban info (null if not banned)
  banReason: string | null

  // Lifetime stats (persisted across connections)
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
  }
  // Unique peer identities (by peerId)
  identifiedPeers: number
  // Peers with multiple addresses (same peerId, different ip:port)
  multiAddressPeers: PeerIdentity[]
}

export interface PeerIdentity {
  peerId: string // hex
  clientName: string | null
  addresses: Array<{
    key: string // "[::1]:6881" or "1.2.3.4:6881"
    family: AddressFamily
    state: ConnectionState
  }>
  // Aggregated stats
  totalDownloaded: number
  totalUploaded: number
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * Create canonical address key for Map.
 * IPv6 needs brackets to disambiguate from port.
 */
export function addressKey(addr: PeerAddress): string {
  return addr.family === 'ipv6' ? `[${addr.ip}]:${addr.port}` : `${addr.ip}:${addr.port}`
}

/**
 * Parse address key back to PeerAddress.
 */
export function parseAddressKey(key: string): PeerAddress {
  if (key.startsWith('[')) {
    // IPv6: [ip]:port
    const match = key.match(/^\[([^\]]+)\]:(\d+)$/)
    if (!match) throw new Error(`Invalid address key: ${key}`)
    return { ip: match[1], port: parseInt(match[2], 10), family: 'ipv6' }
  } else {
    // IPv4: ip:port
    const lastColon = key.lastIndexOf(':')
    if (lastColon === -1) throw new Error(`Invalid address key: ${key}`)
    const ip = key.slice(0, lastColon)
    const port = parseInt(key.slice(lastColon + 1), 10)
    return { ip, port, family: 'ipv4' }
  }
}

/**
 * Detect address family from string.
 */
export function detectAddressFamily(ip: string): AddressFamily {
  return ip.includes(':') ? 'ipv6' : 'ipv4'
}

/**
 * Normalize an IP address to canonical form.
 * - IPv4: as-is
 * - IPv6: lowercase, compressed
 * - IPv4-mapped IPv6: optionally extract IPv4
 */
export function normalizeAddress(
  ip: string,
  extractMappedIPv4: boolean = true,
): { ip: string; family: AddressFamily } {
  if (!ip.includes(':')) {
    // Plain IPv4
    return { ip, family: 'ipv4' }
  }

  // IPv6
  const lower = ip.toLowerCase()

  // Check for IPv4-mapped IPv6 (::ffff:1.2.3.4)
  if (extractMappedIPv4) {
    const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mappedMatch) {
      return { ip: mappedMatch[1], family: 'ipv4' }
    }
  }

  // Compress IPv6
  return { ip: compressIPv6(lower), family: 'ipv6' }
}

/**
 * Compress IPv6 address (collapse longest run of zeros).
 * "2001:0db8:0000:0000:0000:0000:0000:0001" → "2001:db8::1"
 */
export function compressIPv6(ip: string): string {
  // Remove leading zeros from each group
  const parts = ip.split(':').map((p) => p.replace(/^0+/, '') || '0')

  // Find longest run of zeros
  let bestStart = -1,
    bestLen = 0
  let curStart = -1,
    curLen = 0

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '0') {
      if (curStart === -1) curStart = i
      curLen++
    } else {
      if (curLen > bestLen) {
        bestStart = curStart
        bestLen = curLen
      }
      curStart = -1
      curLen = 0
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart
    bestLen = curLen
  }

  // Replace longest run with ::
  if (bestLen > 1) {
    const before = parts.slice(0, bestStart)
    const after = parts.slice(bestStart + bestLen)
    if (before.length === 0 && after.length === 0) {
      return '::'
    } else if (before.length === 0) {
      return '::' + after.join(':')
    } else if (after.length === 0) {
      return before.join(':') + '::'
    } else {
      return before.join(':') + '::' + after.join(':')
    }
  }

  return parts.join(':')
}

/**
 * Parse compact peer format from tracker/PEX.
 */
export function parseCompactPeers(data: Uint8Array, family: AddressFamily): PeerAddress[] {
  const peers: PeerAddress[] = []
  const bytesPerPeer = family === 'ipv4' ? 6 : 18

  for (let i = 0; i + bytesPerPeer <= data.length; i += bytesPerPeer) {
    if (family === 'ipv4') {
      const ip = `${data[i]}.${data[i + 1]}.${data[i + 2]}.${data[i + 3]}`
      const port = (data[i + 4] << 8) | data[i + 5]
      if (port > 0) {
        peers.push({ ip, port, family: 'ipv4' })
      }
    } else {
      // IPv6: 16 bytes for address
      const parts: string[] = []
      for (let j = 0; j < 16; j += 2) {
        const word = (data[i + j] << 8) | data[i + j + 1]
        parts.push(word.toString(16))
      }
      const rawIp = parts.join(':')
      const ip = compressIPv6(rawIp)
      const port = (data[i + 16] << 8) | data[i + 17]
      if (port > 0) {
        peers.push({ ip, port, family: 'ipv6' })
      }
    }
  }

  return peers
}

// ============================================================================
// Swarm Class
// ============================================================================

export interface SwarmEvents {
  peersAdded: (count: number) => void
  peerConnected: (key: string, peer: SwarmPeer) => void
  peerDisconnected: (key: string, peer: SwarmPeer) => void
}

export class Swarm extends EventEmitter {
  // All peers by address key
  private peers: Map<string, SwarmPeer> = new Map()

  // Indexes for efficient state-based queries (store keys, not peers)
  private connectedKeys: Set<string> = new Set()
  private connectingKeys: Set<string> = new Set()

  // PeerId index for identity grouping
  private peerIdIndex: Map<string, Set<string>> = new Map() // peerId hex → Set of address keys

  constructor(private logger: Logger) {
    super()
  }

  // --- Discovery Integration ---

  /**
   * Check if a peer exists in the swarm by key.
   */
  hasPeer(key: string): boolean {
    return this.peers.has(key)
  }

  /**
   * Add a peer address from any discovery source.
   * If already known, does nothing (first discovery wins).
   * Returns the peer (new or existing).
   */
  addPeer(address: PeerAddress, source: DiscoverySource): SwarmPeer {
    const key = addressKey(address)
    let peer = this.peers.get(key)

    if (peer) {
      // Already known - first source wins, nothing to update
      return peer
    }

    // New peer
    peer = {
      ip: address.ip,
      port: address.port,
      family: address.family,
      source,
      discoveredAt: Date.now(),
      state: 'idle',
      connection: null,
      peerId: null,
      clientName: null,
      connectAttempts: 0,
      connectFailures: 0,
      lastConnectAttempt: null,
      lastConnectSuccess: null,
      lastConnectError: null,
      banReason: null,
      totalDownloaded: 0,
      totalUploaded: 0,
    }
    this.peers.set(key, peer)

    return peer
  }

  /**
   * Bulk add peers (e.g., from tracker response or PEX).
   */
  addPeers(addresses: PeerAddress[], source: DiscoverySource): number {
    let added = 0
    for (const addr of addresses) {
      const key = addressKey(addr)
      if (!this.peers.has(key)) {
        this.addPeer(addr, source)
        added++
      }
    }
    if (added > 0) {
      this.emit('peersAdded', added)
    }
    return added
  }

  /**
   * Add peers from compact format (tracker response or PEX).
   */
  addCompactPeers(data: Uint8Array, family: AddressFamily, source: DiscoverySource): number {
    const addresses = parseCompactPeers(data, family)
    return this.addPeers(addresses, source)
  }

  // --- Connection Management ---

  /**
   * Get peers eligible for connection attempts.
   * Filters out: connected, connecting, in backoff, banned.
   * Returns shuffled list limited to `limit` peers for efficiency.
   */
  getConnectablePeers(limit: number): SwarmPeer[] {
    const now = Date.now()
    const candidates: SwarmPeer[] = []

    // Early exit once we have enough candidates
    // (shuffle happens after, so we over-collect slightly for randomness)
    const collectLimit = Math.min(limit * 3, 500)

    for (const peer of this.peers.values()) {
      if (candidates.length >= collectLimit) break

      if (peer.state === 'connected' || peer.state === 'connecting') continue
      if (peer.state === 'banned') continue

      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures)
        if (now - peer.lastConnectAttempt < backoffMs) continue
      }

      candidates.push(peer)
    }

    // Shuffle for fairness
    this.shuffle(candidates)

    return candidates.slice(0, limit)
  }

  /**
   * Mark connection attempt started.
   */
  markConnecting(key: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      peer.state = 'connecting'
      peer.connectAttempts++
      peer.lastConnectAttempt = Date.now()
      this.connectingKeys.add(key)
    }
  }

  /**
   * Mark connection successful.
   */
  markConnected(key: string, connection: PeerConnection): void {
    const peer = this.peers.get(key)
    if (peer) {
      peer.state = 'connected'
      peer.connection = connection
      peer.lastConnectSuccess = Date.now()
      peer.connectFailures = 0 // Reset on success
      peer.lastConnectError = null

      this.connectingKeys.delete(key)
      this.connectedKeys.add(key)

      this.emit('peerConnected', key, peer)
    }
  }

  /**
   * Update peer identity after handshake.
   * Also updates the peerId index for grouping.
   */
  setIdentity(key: string, peerId: Uint8Array, clientName: string | null): void {
    const peer = this.peers.get(key)
    if (!peer) return

    // Remove from old peerId index if changing
    if (peer.peerId) {
      const oldPidHex = toHex(peer.peerId)
      const oldSet = this.peerIdIndex.get(oldPidHex)
      if (oldSet) {
        oldSet.delete(key)
        if (oldSet.size === 0) {
          this.peerIdIndex.delete(oldPidHex)
        }
      }
    }

    peer.peerId = peerId
    peer.clientName = clientName

    // Add to new peerId index
    const pidHex = toHex(peerId)
    let indexSet = this.peerIdIndex.get(pidHex)
    if (!indexSet) {
      indexSet = new Set()
      this.peerIdIndex.set(pidHex, indexSet)
    }
    indexSet.add(key)
  }

  /**
   * Mark connection failed.
   */
  markConnectFailed(key: string, reason: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      peer.state = 'failed'
      peer.connection = null
      peer.connectFailures++
      peer.lastConnectError = reason

      this.connectingKeys.delete(key)
    }
  }

  /**
   * Mark peer disconnected (was connected, now isn't).
   */
  markDisconnected(key: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      // Accumulate stats from the connection before clearing
      if (peer.connection) {
        peer.totalDownloaded += peer.connection.downloaded
        peer.totalUploaded += peer.connection.uploaded
      }
      peer.state = 'idle' // Can try again
      peer.connection = null

      this.connectedKeys.delete(key)

      this.emit('peerDisconnected', key, peer)
    }
  }

  /**
   * Handle incoming connection (peer connected to us).
   */
  addIncomingConnection(
    ip: string,
    port: number,
    family: AddressFamily,
    connection: PeerConnection,
  ): SwarmPeer {
    const peer = this.addPeer({ ip, port, family }, 'incoming')
    const key = addressKey(peer)

    peer.state = 'connected'
    peer.connection = connection
    peer.lastConnectSuccess = Date.now()
    this.connectedKeys.add(key)

    this.emit('peerConnected', key, peer)

    return peer
  }

  /**
   * Ban a peer (bad behavior, corrupt data, etc).
   */
  ban(key: string, reason: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      if (peer.connection) {
        peer.connection.close()
      }
      peer.state = 'banned'
      peer.connection = null
      peer.banReason = reason

      this.connectedKeys.delete(key)
      this.connectingKeys.delete(key)

      this.logger.info(`Banned peer ${key}: ${reason}`)
    }
  }

  /**
   * Unban a peer (e.g., if swarm is tiny and we need peers).
   */
  unban(key: string): void {
    const peer = this.peers.get(key)
    if (peer && peer.state === 'banned') {
      peer.state = 'idle'
      peer.banReason = null
      peer.connectFailures = 0 // Give them a fresh start
      this.logger.info(`Unbanned peer ${key}`)
    }
  }

  /**
   * Unban all peers that weren't banned for data corruption.
   * Useful when swarm is very small and we're desperate.
   */
  unbanRecoverable(): number {
    let count = 0
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned' && !peer.banReason?.includes('corrupt')) {
        peer.state = 'idle'
        peer.banReason = null
        peer.connectFailures = 0
        count++
      }
    }
    if (count > 0) {
      this.logger.info(`Unbanned ${count} recoverable peers`)
    }
    return count
  }

  // --- Efficient Queries ---

  get size(): number {
    return this.peers.size
  }

  get connectedCount(): number {
    return this.connectedKeys.size
  }

  get connectingCount(): number {
    return this.connectingKeys.size
  }

  get bannedCount(): number {
    let count = 0
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned') count++
    }
    return count
  }

  /**
   * Get all connected peers efficiently.
   */
  getConnectedPeers(): PeerConnection[] {
    const result: PeerConnection[] = []
    for (const key of this.connectedKeys) {
      const peer = this.peers.get(key)
      if (peer?.connection) {
        result.push(peer.connection)
      }
    }
    return result
  }

  /**
   * Get SwarmPeer by address.
   */
  getPeer(ip: string, port: number, family: AddressFamily): SwarmPeer | undefined {
    return this.peers.get(addressKey({ ip, port, family }))
  }

  getPeerByKey(key: string): SwarmPeer | undefined {
    return this.peers.get(key)
  }

  /**
   * Get all peers for a specific peer identity.
   */
  getPeersByPeerId(peerIdHex: string): SwarmPeer[] {
    const keys = this.peerIdIndex.get(peerIdHex)
    if (!keys) return []
    const result: SwarmPeer[] = []
    for (const key of keys) {
      const peer = this.peers.get(key)
      if (peer) result.push(peer)
    }
    return result
  }

  /**
   * Count peers by family.
   */
  countByFamily(family: AddressFamily): number {
    let count = 0
    for (const peer of this.peers.values()) {
      if (peer.family === family) count++
    }
    return count
  }

  /**
   * Get stats summary for debugging/UI.
   */
  getStats(): SwarmStats {
    const stats: SwarmStats = {
      total: this.peers.size,
      byState: { idle: 0, connecting: 0, connected: 0, failed: 0, banned: 0 },
      byFamily: { ipv4: 0, ipv6: 0 },
      bySource: { tracker: 0, pex: 0, dht: 0, lpd: 0, incoming: 0, manual: 0 },
      identifiedPeers: this.peerIdIndex.size,
      multiAddressPeers: [],
    }

    for (const peer of this.peers.values()) {
      stats.byState[peer.state]++
      stats.byFamily[peer.family]++
      stats.bySource[peer.source]++
    }

    // Find peers with multiple addresses
    for (const [peerId, keys] of this.peerIdIndex) {
      if (keys.size > 1) {
        const peerList: SwarmPeer[] = []
        for (const key of keys) {
          const p = this.peers.get(key)
          if (p) peerList.push(p)
        }

        const firstPeer = peerList[0]
        if (firstPeer) {
          stats.multiAddressPeers.push({
            peerId,
            clientName: firstPeer.clientName,
            addresses: peerList.map((p) => ({
              key: addressKey(p),
              family: p.family,
              state: p.state,
            })),
            totalDownloaded: peerList.reduce((sum, p) => sum + p.totalDownloaded, 0),
            totalUploaded: peerList.reduce((sum, p) => sum + p.totalUploaded, 0),
          })
        }
      }
    }

    return stats
  }

  /**
   * Get all peers (for debugging). Returns iterator to avoid copying.
   */
  allPeers(): IterableIterator<SwarmPeer> {
    return this.peers.values()
  }

  // --- Helpers ---

  private calculateBackoff(failures: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 5 minutes
    return Math.min(1000 * Math.pow(2, failures), 5 * 60 * 1000)
  }

  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }

  /**
   * Clear all peers (on torrent removal).
   */
  clear(): void {
    for (const peer of this.peers.values()) {
      if (peer.connection) {
        peer.connection.close()
      }
    }
    this.peers.clear()
    this.connectedKeys.clear()
    this.connectingKeys.clear()
    this.peerIdIndex.clear()
  }
}
