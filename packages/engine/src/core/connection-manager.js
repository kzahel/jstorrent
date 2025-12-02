import { EventEmitter } from '../utils/event-emitter'
import { peerKey } from './swarm'
import { PeerConnection } from './peer-connection'
export const DEFAULT_CONNECTION_CONFIG = {
  maxPeersPerTorrent: 50,
  connectingHeadroom: 10,
  connectTimeout: 10000, // 10 seconds
  maintenanceInterval: 3000, // 3 seconds (base interval)
  burstConnections: 5,
  // Adaptive maintenance
  maintenanceMinInterval: 1000, // 1 second when urgent
  maintenanceMaxInterval: 10000, // 10 seconds when full
  // Slow peer detection
  slowPeerMinSpeed: 1000, // 1 KB/s minimum
  slowPeerTimeoutMs: 60000, // 60 seconds without data
}
// ============================================================================
// ConnectionManager
// ============================================================================
/**
 * Manages peer connection lifecycle for a torrent.
 *
 * Responsibilities:
 * - Initiating outgoing connections
 * - Managing connection timeouts
 * - Filling available peer slots from swarm
 * - Coordinating with Swarm for state tracking
 */
export class ConnectionManager extends EventEmitter {
  constructor(swarm, socketFactory, engine, logger, config = {}) {
    super()
    // Connection timeout timers
    this.connectTimers = new Map()
    // Adaptive maintenance state
    this.lastMaintenanceRun = 0
    this.pendingMaintenanceTrigger = false
    this.swarm = swarm
    this.socketFactory = socketFactory
    this.engine = engine
    this.logger = logger
    this.config = { ...DEFAULT_CONNECTION_CONFIG, ...config }
  }
  // --- Configuration ---
  /**
   * Update configuration at runtime.
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config }
  }
  /**
   * Get current configuration.
   */
  getConfig() {
    return { ...this.config }
  }
  // --- Connection Budget ---
  /**
   * Calculate available connection slots.
   * Accounts for connected peers, in-flight connections, and headroom.
   */
  get availableSlots() {
    const connected = this.swarm.connectedCount
    const connecting = this.swarm.connectingCount
    const maxWithHeadroom = this.config.maxPeersPerTorrent + this.config.connectingHeadroom
    return Math.max(0, maxWithHeadroom - connected - connecting)
  }
  /**
   * Whether we can accept more connections.
   */
  get canAcceptMoreConnections() {
    return this.swarm.connectedCount < this.config.maxPeersPerTorrent
  }
  // --- Connection Lifecycle ---
  /**
   * Initiate connection to a specific peer.
   * Sets up timeout and handles success/failure.
   */
  async initiateConnection(peer) {
    const key = peerKey(peer.ip, peer.port)
    // Mark connecting in swarm
    this.swarm.markConnecting(key)
    // Set internal timeout (more aggressive than io-daemon's 10s)
    const timer = setTimeout(() => {
      this.handleConnectionTimeout(key)
    }, this.config.connectTimeout)
    this.connectTimers.set(key, timer)
    try {
      this.logger.debug(`[ConnectionManager] Connecting to ${key}`)
      const socket = await this.socketFactory.createTcpSocket(peer.ip, peer.port)
      // Clear timeout on success
      clearTimeout(timer)
      this.connectTimers.delete(key)
      // Create peer connection
      const connection = new PeerConnection(this.engine, socket, {
        remoteAddress: peer.ip,
        remotePort: peer.port,
      })
      // Mark connected in swarm
      this.swarm.markConnected(key, connection)
      // Notify listeners
      this.emit('peerConnected', key, connection)
      this.onPeerConnected?.(key, connection)
    } catch (err) {
      // Clear timeout on failure
      clearTimeout(timer)
      this.connectTimers.delete(key)
      const reason = err instanceof Error ? err.message : String(err)
      this.swarm.markConnectFailed(key, reason)
      this.emit('peerConnectFailed', key, reason)
    }
  }
  /**
   * Handle connection timeout.
   */
  handleConnectionTimeout(key) {
    this.connectTimers.delete(key)
    this.swarm.markConnectFailed(key, 'timeout')
    this.logger.debug(`[ConnectionManager] Connection timeout: ${key}`)
    this.emit('connectionTimeout', key)
  }
  // --- Slot Filling ---
  /**
   * Fill available connection slots from swarm candidates.
   * Uses peer scoring to select the best candidates.
   * Called periodically by maintenance and when new peers are discovered.
   */
  async fillSlots(globalLimitCheck) {
    this.lastMaintenanceRun = Date.now()
    const slots = Math.min(this.availableSlots, this.config.burstConnections)
    if (slots <= 0) return 0
    // Use scored selection instead of random
    const candidates = this.selectCandidates(slots)
    if (candidates.length === 0) return 0
    this.logger.debug(
      `[ConnectionManager] Filling ${candidates.length} slots (available: ${this.availableSlots})`,
    )
    let connectionsInitiated = 0
    for (const peer of candidates) {
      // Check global limit if provided
      if (globalLimitCheck && !globalLimitCheck()) {
        this.logger.debug('[ConnectionManager] Global limit reached, stopping slot filling')
        break
      }
      // Re-check available slots (may change as we connect)
      if (this.availableSlots <= 0) break
      // Initiate connection (async, don't await all)
      this.initiateConnection(peer).catch((err) => {
        this.logger.debug(`[ConnectionManager] Connection failed: ${err}`)
      })
      connectionsInitiated++
    }
    return connectionsInitiated
  }
  // --- Peer Scoring & Selection ---
  /**
   * Select best candidates for connection based on scoring.
   * Fetches more candidates than needed and sorts by score.
   */
  selectCandidates(limit) {
    // Get 3x candidates to have good selection pool
    const candidates = this.swarm.getConnectablePeers(limit * 3)
    if (candidates.length === 0) return []
    // Score each candidate
    const scored = candidates.map((peer) => ({
      key: peerKey(peer.ip, peer.port),
      peer,
      score: this.calculateScore(peer),
    }))
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)
    // Return top candidates
    return scored.slice(0, limit).map((s) => s.peer)
  }
  /**
   * Calculate a score for a peer based on various heuristics.
   * Higher score = better candidate for connection.
   */
  calculateScore(peer) {
    let score = 100
    // Prefer peers with previous successful connections
    if (peer.lastConnectSuccess) {
      score += 50
    }
    // Penalize repeated connection failures
    score -= peer.connectFailures * 20
    // Prefer peers with good download history
    if (peer.totalDownloaded > 0) {
      // Log10-based bonus, capped at 50 points
      // 1KB = +10, 1MB = +30, 1GB = +50 (capped)
      score += Math.min(50, Math.log10(peer.totalDownloaded) * 10)
    }
    // Penalize recently tried peers (backoff-like scoring)
    if (peer.lastConnectAttempt) {
      const timeSince = Date.now() - peer.lastConnectAttempt
      if (timeSince < 30000) {
        score -= 30 // Recently tried
      } else if (timeSince < 60000) {
        score -= 15 // Tried within a minute
      }
    }
    // Prefer different sources (manual > tracker > pex > dht)
    switch (peer.source) {
      case 'manual':
        score += 20
        break
      case 'tracker':
        score += 10
        break
      case 'incoming':
        score += 5
        break
      case 'lpd':
        score += 5
        break
      case 'pex':
        score -= 5
        break
      case 'dht':
        score -= 10
        break
    }
    return score
  }
  // --- Registration ---
  /**
   * Register callback for when a peer connects.
   * Used by Torrent to set up peer listeners.
   */
  setOnPeerConnected(callback) {
    this.onPeerConnected = callback
  }
  // --- Cleanup ---
  /**
   * Cancel all pending connection attempts.
   */
  cancelAllPendingConnections() {
    for (const [key, timer] of this.connectTimers) {
      clearTimeout(timer)
      this.swarm.markConnectFailed(key, 'cancelled')
    }
    this.connectTimers.clear()
  }
  /**
   * Destroy the connection manager.
   */
  destroy() {
    this.cancelAllPendingConnections()
    this.removeAllListeners()
  }
  // --- Slow Peer Detection ---
  /**
   * Check if a peer should be dropped due to poor performance.
   * Returns the reason if peer should be dropped, null otherwise.
   */
  shouldDropPeer(peer) {
    // Check if peer is choking us and hasn't sent data in too long
    if (peer.peerChoking) {
      // If choking and no recent data, this peer isn't useful
      const timeSinceData = Date.now() - (peer.downloadSpeedCalculator.lastActivity || 0)
      if (timeSinceData > this.config.slowPeerTimeoutMs) {
        return `no data for ${Math.round(timeSinceData / 1000)}s while choked`
      }
    }
    // Check download speed if peer is unchoked
    if (!peer.peerChoking) {
      const speed = peer.downloadSpeed
      // Don't check speed too early - need some time to establish connection
      const connectionDuration = Date.now() - (peer.downloadSpeedCalculator.startTime || Date.now())
      if (connectionDuration > 10000) {
        // 10 seconds to establish
        // Check if speed is below minimum threshold
        if (speed < this.config.slowPeerMinSpeed) {
          // Only drop if we have alternatives
          if (this.swarm.getConnectablePeers(1).length > 0) {
            // Calculate average download speed of all connected peers
            const avgSpeed = this.getAverageDownloadSpeed()
            // Drop if below 10% of average and below minimum
            if (speed < avgSpeed * 0.1) {
              return `slow: ${Math.round(speed)} B/s (avg: ${Math.round(avgSpeed)} B/s)`
            }
          }
        }
      }
    }
    return null
  }
  /**
   * Calculate average download speed across all connected peers.
   */
  getAverageDownloadSpeed() {
    const peers = this.swarm.getConnectedPeers()
    if (peers.length === 0) return 0
    let totalSpeed = 0
    for (const peer of peers) {
      totalSpeed += peer.downloadSpeed
    }
    return totalSpeed / peers.length
  }
  /**
   * Check all connected peers for slow performance and emit events for any that should be dropped.
   * Returns list of peer keys that should be dropped.
   */
  detectSlowPeers() {
    const slowPeers = []
    for (const peer of this.swarm.getConnectedPeers()) {
      const reason = this.shouldDropPeer(peer)
      if (reason && peer.remoteAddress && peer.remotePort) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        slowPeers.push(key)
        this.emit('slowPeerDetected', key, reason)
        this.logger.debug(`[ConnectionManager] Slow peer detected: ${key} - ${reason}`)
      }
    }
    return slowPeers
  }
  // --- Adaptive Maintenance ---
  /**
   * Trigger maintenance soon (edge-triggered).
   * Used when new peers are discovered or a peer disconnects.
   * Respects minimum interval to avoid flooding.
   */
  triggerMaintenance(callback) {
    if (this.pendingMaintenanceTrigger) return
    const timeSinceLastRun = Date.now() - this.lastMaintenanceRun
    if (timeSinceLastRun >= this.config.maintenanceMinInterval) {
      // Can run immediately
      callback()
    } else {
      // Schedule for when min interval is reached
      this.pendingMaintenanceTrigger = true
      const delay = this.config.maintenanceMinInterval - timeSinceLastRun
      setTimeout(() => {
        this.pendingMaintenanceTrigger = false
        callback()
      }, delay)
    }
  }
  /**
   * Calculate adaptive maintenance interval based on connection state.
   * Returns shorter intervals when we need more connections.
   */
  getAdaptiveMaintenanceInterval() {
    const connected = this.swarm.connectedCount
    const target = this.config.maxPeersPerTorrent
    // Urgent: no connections
    if (connected === 0) {
      return this.config.maintenanceMinInterval
    }
    // Calculate ratio of connected to target
    const ratio = connected / target
    if (ratio < 0.5) {
      // Less than half connected - urgent
      return this.config.maintenanceMinInterval
    } else if (ratio < 0.8) {
      // Between 50-80% - use base interval
      return this.config.maintenanceInterval
    } else {
      // Over 80% full - can slow down
      return this.config.maintenanceMaxInterval
    }
  }
  // --- Stats ---
  /**
   * Get connection manager stats for debugging.
   */
  getStats() {
    return {
      connected: this.swarm.connectedCount,
      connecting: this.swarm.connectingCount,
      pendingTimers: this.connectTimers.size,
      availableSlots: this.availableSlots,
      config: this.config,
      adaptiveInterval: this.getAdaptiveMaintenanceInterval(),
      averageDownloadSpeed: this.getAverageDownloadSpeed(),
    }
  }
}
