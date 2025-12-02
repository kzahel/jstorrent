import { EventEmitter } from '../utils/event-emitter'
import { Swarm, SwarmPeer } from './swarm'
import { PeerConnection } from './peer-connection'
import { ISocketFactory } from '../interfaces/socket'
import type { Logger, ILoggingEngine } from '../logging/logger'
export interface ConnectionConfig {
  maxPeersPerTorrent: number
  connectingHeadroom: number
  connectTimeout: number
  maintenanceInterval: number
  burstConnections: number
  maintenanceMinInterval: number
  maintenanceMaxInterval: number
  slowPeerMinSpeed: number
  slowPeerTimeoutMs: number
}
export declare const DEFAULT_CONNECTION_CONFIG: ConnectionConfig
export interface ConnectionManagerEvents {
  peerConnected: (key: string, connection: PeerConnection) => void
  peerConnectFailed: (key: string, reason: string) => void
  connectionTimeout: (key: string) => void
  slowPeerDetected: (key: string, reason: string) => void
}
/**
 * Manages peer connection lifecycle for a torrent.
 *
 * Responsibilities:
 * - Initiating outgoing connections
 * - Managing connection timeouts
 * - Filling available peer slots from swarm
 * - Coordinating with Swarm for state tracking
 */
export declare class ConnectionManager extends EventEmitter {
  private config
  private swarm
  private socketFactory
  private engine
  private logger
  private connectTimers
  private onPeerConnected?
  private lastMaintenanceRun
  private pendingMaintenanceTrigger
  constructor(
    swarm: Swarm,
    socketFactory: ISocketFactory,
    engine: ILoggingEngine,
    logger: Logger,
    config?: Partial<ConnectionConfig>,
  )
  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<ConnectionConfig>): void
  /**
   * Get current configuration.
   */
  getConfig(): ConnectionConfig
  /**
   * Calculate available connection slots.
   * Accounts for connected peers, in-flight connections, and headroom.
   */
  get availableSlots(): number
  /**
   * Whether we can accept more connections.
   */
  get canAcceptMoreConnections(): boolean
  /**
   * Initiate connection to a specific peer.
   * Sets up timeout and handles success/failure.
   */
  initiateConnection(peer: SwarmPeer): Promise<void>
  /**
   * Handle connection timeout.
   */
  private handleConnectionTimeout
  /**
   * Fill available connection slots from swarm candidates.
   * Uses peer scoring to select the best candidates.
   * Called periodically by maintenance and when new peers are discovered.
   */
  fillSlots(globalLimitCheck?: () => boolean): Promise<number>
  /**
   * Select best candidates for connection based on scoring.
   * Fetches more candidates than needed and sorts by score.
   */
  private selectCandidates
  /**
   * Calculate a score for a peer based on various heuristics.
   * Higher score = better candidate for connection.
   */
  private calculateScore
  /**
   * Register callback for when a peer connects.
   * Used by Torrent to set up peer listeners.
   */
  setOnPeerConnected(callback: (key: string, connection: PeerConnection) => void): void
  /**
   * Cancel all pending connection attempts.
   */
  cancelAllPendingConnections(): void
  /**
   * Destroy the connection manager.
   */
  destroy(): void
  /**
   * Check if a peer should be dropped due to poor performance.
   * Returns the reason if peer should be dropped, null otherwise.
   */
  shouldDropPeer(peer: PeerConnection): string | null
  /**
   * Calculate average download speed across all connected peers.
   */
  getAverageDownloadSpeed(): number
  /**
   * Check all connected peers for slow performance and emit events for any that should be dropped.
   * Returns list of peer keys that should be dropped.
   */
  detectSlowPeers(): string[]
  /**
   * Trigger maintenance soon (edge-triggered).
   * Used when new peers are discovered or a peer disconnects.
   * Respects minimum interval to avoid flooding.
   */
  triggerMaintenance(callback: () => void): void
  /**
   * Calculate adaptive maintenance interval based on connection state.
   * Returns shorter intervals when we need more connections.
   */
  getAdaptiveMaintenanceInterval(): number
  /**
   * Get connection manager stats for debugging.
   */
  getStats(): {
    connected: number
    connecting: number
    pendingTimers: number
    availableSlots: number
    config: ConnectionConfig
    adaptiveInterval: number
    averageDownloadSpeed: number
  }
}
//# sourceMappingURL=connection-manager.d.ts.map
