import { EventEmitter } from '../utils/event-emitter'
import { toHex } from '../utils/buffer'
import { lookupCountry } from '../geo/geoip'
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

export type DiscoverySource =
  | 'tracker'
  | 'pex'
  | 'dht'
  | 'lpd'
  | 'incoming'
  | 'manual'
  | 'magnet_hint'

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

  // GeoIP (populated on discovery if data available)
  countryCode: string | null // ISO 3166-1 alpha-2, e.g. "US"

  // Connection history
  connectAttempts: number
  connectFailures: number
  lastConnectAttempt: number | null
  lastConnectSuccess: number | null
  lastConnectError: string | null

  // Quick disconnect tracking (for backoff on rapid connect/disconnect cycles)
  quickDisconnects: number
  lastDisconnect: number | null

  // Ban info (null if not banned)
  banReason: string | null

  // Rejection tracking (incoming connections we rejected)
  rejectionCount: number
  lastRejected: number | null
  lastRejectionReason: string | null

  // Port quality indicator (privileged ports, well-known services)
  suspiciousPort: boolean

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
    magnet_hint: number
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
// Port Validation
// ============================================================================

/**
 * Well-known ports that are almost certainly not BitTorrent peers.
 * Connecting to these could be malicious (port scanning) or misconfiguration.
 */
const SUSPICIOUS_PORTS = new Set([
  1, // tcpmux
  7, // echo
  20, // FTP data
  21, // FTP control
  22, // SSH
  23, // Telnet
  25, // SMTP
  53, // DNS
  80, // HTTP
  110, // POP3
  143, // IMAP
  443, // HTTPS
  445, // SMB
  993, // IMAPS
  995, // POP3S
])

/**
 * Check if a port is valid for BitTorrent connections.
 * Returns false for port 0 (invalid) and other clearly wrong values.
 */
export function isValidPort(port: number): boolean {
  return port > 0 && port <= 65535
}

/**
 * Check if a port is suspicious (likely misconfiguration or malicious).
 * These peers should be heavily down-scored or skipped entirely.
 */
export function isSuspiciousPort(port: number): boolean {
  // Port 0 is invalid
  if (port <= 0) return true

  // Privileged ports (require root) - very unlikely for BitTorrent
  if (port < 1024) return true

  // Well-known service ports that definitely aren't BitTorrent
  if (SUSPICIOUS_PORTS.has(port)) return true

  return false
}

/**
 * Get a score penalty for suspicious ports.
 * Returns 0 for normal ports, negative values for suspicious ones.
 */
export function getPortScorePenalty(port: number): number {
  if (port <= 0) return -1000 // Invalid, never use
  if (port < 1024) return -500 // Privileged, almost never use
  if (SUSPICIOUS_PORTS.has(port)) return -500
  return 0
}

/**
 * Check if an IP address is valid for peer connections.
 * Rejects multicast, broadcast, and "this" network addresses.
 */
export function isValidPeerIp(ip: string): boolean {
  // IPv6 - allow all for now
  if (ip.includes(':')) return true

  const parts = ip.split('.')
  if (parts.length !== 4) return false

  const first = parseInt(parts[0], 10)

  // Block 0.0.0.0/8 - "this" network
  if (first === 0) return false

  // Block 224.0.0.0/4 - multicast (224-239)
  if (first >= 224 && first <= 239) return false

  // Block broadcast
  if (ip === '255.255.255.255') return false

  return true
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
 * Create canonical peer key from IP and port.
 * This is the preferred helper for creating keys when you don't have a full PeerAddress.
 * Automatically detects address family.
 */
export function peerKey(ip: string, port: number): string {
  const family = detectAddressFamily(ip)
  return addressKey({ ip, port, family })
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

  // Cached array for efficient UI access (avoids allocation per RAF frame)
  private _allPeersVersion = 0 // Bumped on add/remove
  private _cachedPeersArray: SwarmPeer[] | null = null
  private _cachedPeersVersion = -1 // Version when cache was built

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
   * Returns the peer (new or existing), or null if the address is invalid.
   */
  addPeer(address: PeerAddress, source: DiscoverySource): SwarmPeer | null {
    // Reject invalid ports entirely
    if (!isValidPort(address.port)) {
      this.logger.debug(`Rejecting peer ${address.ip}:${address.port} - invalid port`)
      return null
    }

    // Reject invalid IPs (multicast, broadcast, "this" network)
    if (!isValidPeerIp(address.ip)) {
      this.logger.debug(`Rejecting peer ${address.ip}:${address.port} - invalid IP`)
      return null
    }

    const key = addressKey(address)
    let peer = this.peers.get(key)

    if (peer) {
      // Already known - first source wins, nothing to update
      return peer
    }

    // Check if port is suspicious (privileged or well-known service)
    const suspicious = isSuspiciousPort(address.port)
    if (suspicious) {
      this.logger.debug(`Peer ${address.ip}:${address.port} has suspicious port (privileged/<1024)`)
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
      countryCode: lookupCountry(address.ip),
      connectAttempts: 0,
      connectFailures: 0,
      lastConnectAttempt: null,
      lastConnectSuccess: null,
      lastConnectError: null,
      quickDisconnects: 0,
      lastDisconnect: null,
      banReason: null,
      rejectionCount: 0,
      lastRejected: null,
      lastRejectionReason: null,
      suspiciousPort: suspicious,
      totalDownloaded: 0,
      totalUploaded: 0,
    }
    this.peers.set(key, peer)
    this._allPeersVersion++

    return peer
  }

  /**
   * Bulk add peers (e.g., from tracker response or PEX).
   * Returns count of newly added valid peers.
   */
  addPeers(addresses: PeerAddress[], source: DiscoverySource): number {
    let added = 0
    for (const addr of addresses) {
      // Skip invalid ports
      if (!isValidPort(addr.port)) continue
      // Skip invalid IPs
      if (!isValidPeerIp(addr.ip)) continue

      const key = addressKey(addr)
      if (!this.peers.has(key)) {
        if (this.addPeer(addr, source)) {
          added++
        }
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
   * Returns list sorted by quality score (best first), limited to `limit` peers.
   * Suspicious port peers are returned last (only as last resort).
   */
  getConnectablePeers(limit: number): SwarmPeer[] {
    const now = Date.now()
    const normalCandidates: SwarmPeer[] = []
    const suspiciousCandidates: SwarmPeer[] = []

    // Collect eligible candidates, separating suspicious ports
    for (const peer of this.peers.values()) {
      if (peer.state === 'connected' || peer.state === 'connecting') continue
      if (peer.state === 'banned') continue

      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures)
        if (now - peer.lastConnectAttempt < backoffMs) continue
      }

      // Check backoff for quick disconnects (idle peers that disconnect rapidly)
      if (peer.state === 'idle' && peer.quickDisconnects > 0 && peer.lastDisconnect) {
        const backoffMs = this.calculateBackoff(peer.quickDisconnects)
        if (now - peer.lastDisconnect < backoffMs) continue
      }

      // Separate suspicious ports - they go last
      if (peer.suspiciousPort) {
        suspiciousCandidates.push(peer)
      } else {
        normalCandidates.push(peer)
      }
    }

    // Score and sort normal candidates
    const scoredNormal = normalCandidates.map((peer) => ({
      peer,
      score: this.calculatePeerScore(peer, now),
    }))
    scoredNormal.sort((a, b) => b.score - a.score)

    // Shuffle suspicious candidates (they're all equally bad)
    this.shuffle(suspiciousCandidates)

    // Return normal peers first, then suspicious as last resort
    const result: SwarmPeer[] = []
    for (const { peer } of scoredNormal) {
      if (result.length >= limit) break
      result.push(peer)
    }

    // Only add suspicious peers if we still need more
    for (const peer of suspiciousCandidates) {
      if (result.length >= limit) break
      result.push(peer)
    }

    return result
  }

  /**
   * Calculate a quality score for peer selection.
   * Higher is better.
   */
  private calculatePeerScore(peer: SwarmPeer, now: number): number {
    let score = 100

    // Port quality
    score += getPortScorePenalty(peer.port)

    // Prefer peers with previous successful connections
    if (peer.lastConnectSuccess) {
      score += 50
    }

    // Penalize repeated failures
    score -= peer.connectFailures * 20

    // Prefer peers with good download history
    if (peer.totalDownloaded > 0) {
      score += Math.min(50, Math.log10(peer.totalDownloaded) * 10)
    }

    // Penalize recently failed peers (even if backoff expired)
    if (peer.lastConnectAttempt) {
      const timeSince = now - peer.lastConnectAttempt
      if (timeSince < 30000) score -= 30
      else if (timeSince < 60000) score -= 15
    }

    // Source quality
    switch (peer.source) {
      case 'manual':
        score += 20
        break
      case 'tracker':
        score += 10
        break
      case 'incoming':
        score += 5 // They found us, probably real
        break
      case 'pex':
        score += 0 // Neutral
        break
      case 'dht':
        score -= 5 // DHT can have more junk
        break
      case 'lpd':
        score += 15 // Local network, usually good
        break
    }

    // Add small random factor to avoid always picking same peers
    score += Math.random() * 10

    return score
  }

  /**
   * Mark connection attempt started.
   */
  markConnecting(key: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      const prevState = peer.state
      peer.state = 'connecting'
      peer.connectAttempts++
      peer.lastConnectAttempt = Date.now()
      this.connectingKeys.add(key)
      this.logger.debug(`[${key}] ${prevState} → connecting (attempt #${peer.connectAttempts})`)
    } else {
      this.logger.warn(`markConnecting: peer not found in swarm: ${key}`)
    }
  }

  /**
   * Mark connection successful.
   */
  markConnected(key: string, connection: PeerConnection): void {
    const peer = this.peers.get(key)
    if (peer) {
      const prevState = peer.state
      peer.state = 'connected'
      peer.connection = connection
      peer.lastConnectSuccess = Date.now()
      peer.connectFailures = 0 // Reset on success
      peer.lastConnectError = null

      this.connectingKeys.delete(key)
      this.connectedKeys.add(key)

      this.logger.debug(
        `[${key}] ${prevState} → connected (total: ${this.connectedKeys.size} connected, ${this.connectingKeys.size} connecting)`,
      )

      this.emit('peerConnected', key, peer)
    } else {
      this.logger.warn(`markConnected: peer not found in swarm: ${key}`)
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
      const prevState = peer.state
      peer.state = 'failed'
      peer.connection = null
      peer.connectFailures++
      peer.lastConnectError = reason

      this.connectingKeys.delete(key)

      this.logger.debug(
        `[${key}] ${prevState} → failed: ${reason} (failures: ${peer.connectFailures})`,
      )
    } else {
      this.logger.warn(`markConnectFailed: peer not found in swarm: ${key}`)
    }
  }

  /**
   * Record a rejected incoming connection.
   * Tracks the peer in the swarm so we can detect repeat attempts.
   */
  rejectIncoming(ip: string, port: number, family: AddressFamily, reason: string): void {
    const key = addressKey({ ip, port, family })
    let peer = this.peers.get(key)

    if (!peer) {
      peer = {
        ip,
        port,
        family,
        source: 'incoming',
        discoveredAt: Date.now(),
        state: 'idle',
        connection: null,
        peerId: null,
        clientName: null,
        countryCode: lookupCountry(ip),
        connectAttempts: 0,
        connectFailures: 0,
        lastConnectAttempt: null,
        lastConnectSuccess: null,
        lastConnectError: null,
        quickDisconnects: 0,
        lastDisconnect: null,
        banReason: null,
        rejectionCount: 0,
        lastRejected: null,
        lastRejectionReason: null,
        suspiciousPort: isSuspiciousPort(port),
        totalDownloaded: 0,
        totalUploaded: 0,
      }
      this.peers.set(key, peer)
      this._allPeersVersion++
    }

    peer.rejectionCount++
    peer.lastRejected = Date.now()
    peer.lastRejectionReason = reason

    this.logger.debug(`[${key}] Rejected incoming: ${reason} (count: ${peer.rejectionCount})`)
  }

  /**
   * Mark peer disconnected (was connected, now isn't).
   */
  markDisconnected(key: string): void {
    const peer = this.peers.get(key)
    if (peer) {
      const prevState = peer.state
      // Accumulate stats from the connection before clearing
      if (peer.connection) {
        peer.totalDownloaded += peer.connection.downloaded
        peer.totalUploaded += peer.connection.uploaded
      }

      // Track quick disconnects for backoff purposes
      // If connection lasted < 30s, treat as problematic peer
      const connectionDuration = peer.lastConnectSuccess ? Date.now() - peer.lastConnectSuccess : 0
      if (connectionDuration < 30000) {
        peer.quickDisconnects++
      } else {
        // Long-lived connection - reset quick disconnect counter
        peer.quickDisconnects = 0
      }

      peer.state = 'idle' // Can try again
      peer.connection = null
      peer.lastDisconnect = Date.now()

      this.connectedKeys.delete(key)

      this.logger.debug(
        `[${key}] ${prevState} → idle (disconnected, duration=${connectionDuration}ms, quickDisconnects=${peer.quickDisconnects}) (total: ${this.connectedKeys.size} connected)`,
      )

      this.emit('peerDisconnected', key, peer)
    } else {
      this.logger.warn(`markDisconnected: peer not found in swarm: ${key}`)
    }
  }

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
  ): SwarmPeer {
    // For incoming, we create the peer directly to ensure we accept it
    // even if the port would normally be rejected
    const key = addressKey({ ip, port, family })
    let peer = this.peers.get(key)

    if (!peer) {
      peer = {
        ip,
        port,
        family,
        source: 'incoming',
        discoveredAt: Date.now(),
        state: 'idle',
        connection: null,
        peerId: null,
        clientName: null,
        countryCode: lookupCountry(ip),
        connectAttempts: 0,
        connectFailures: 0,
        lastConnectAttempt: null,
        lastConnectSuccess: null,
        lastConnectError: null,
        quickDisconnects: 0,
        lastDisconnect: null,
        banReason: null,
        rejectionCount: 0,
        lastRejected: null,
        lastRejectionReason: null,
        suspiciousPort: isSuspiciousPort(port),
        totalDownloaded: 0,
        totalUploaded: 0,
      }
      this.peers.set(key, peer)
      this._allPeersVersion++
    }

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

  /**
   * Get all keys of peers currently in connecting state.
   * Used by Torrent.getDisplayPeers() for UI.
   */
  getConnectingKeys(): ReadonlySet<string> {
    return this.connectingKeys
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
      bySource: { tracker: 0, pex: 0, dht: 0, lpd: 0, incoming: 0, manual: 0, magnet_hint: 0 },
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

  /**
   * Get all peers as a stable array (for UI).
   * Caches the array and only rebuilds when peers are added/removed.
   * Property mutations on SwarmPeer objects are visible via references.
   */
  getAllPeersArray(): SwarmPeer[] {
    if (this._cachedPeersVersion !== this._allPeersVersion || !this._cachedPeersArray) {
      this._cachedPeersArray = Array.from(this.peers.values())
      this._cachedPeersVersion = this._allPeersVersion
    }
    return this._cachedPeersArray
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
    this._allPeersVersion++
    this._cachedPeersArray = null
  }

  /**
   * Reset backoff state for all peers.
   * Called when torrent is started to allow immediate reconnection attempts.
   * Preserves peer addresses and stats, only resets connection attempt tracking.
   */
  resetBackoffState(): void {
    for (const peer of this.peers.values()) {
      // Don't reset banned peers
      if (peer.state === 'banned') continue

      // Reset failed peers to idle so they're eligible for connection
      if (peer.state === 'failed') {
        peer.state = 'idle'
      }

      // Reset connection attempt counters
      peer.connectAttempts = 0
      peer.connectFailures = 0
      peer.lastConnectAttempt = null
      peer.lastConnectError = null

      // Reset quick disconnect tracking
      peer.quickDisconnects = 0
      peer.lastDisconnect = null
    }

    this.logger.debug(`Reset backoff state for ${this.peers.size} peers`)
  }
}
