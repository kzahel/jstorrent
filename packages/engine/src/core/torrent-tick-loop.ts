import { PeerConnection } from './peer-connection'
import { BLOCK_SIZE } from './active-piece'
import { PeerSnapshot, ChokeDecision, DropDecision } from './peer-coordinator'
import { MessageType } from '../protocol/wire-protocol'
import { toHex } from '../utils/buffer'
import { peerKey } from './swarm'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { ActivePieceManager } from './active-piece-manager'
import type { PeerCoordinator } from './peer-coordinator'
import type { PeerSelector } from './peer-selector'
import type { Swarm } from './swarm'
import type { TorrentUploader } from './torrent-uploader'
import type { TorrentDiskQueue } from './disk-queue'
import type { TrafficCategory } from './bandwidth-tracker'

// === Constants ===

/**
 * Timeout for individual block requests.
 * Requests older than this are cancelled and the blocks become available
 * for reassignment to other peers.
 */
export const BLOCK_REQUEST_TIMEOUT_MS = 10_000 // 10 seconds

/**
 * Timeout for piece abandonment.
 * Pieces older than this with less than PIECE_ABANDON_MIN_PROGRESS
 * are abandoned and removed from the active set.
 */
export const PIECE_ABANDON_TIMEOUT_MS = 30_000 // 30 seconds

/**
 * Minimum progress ratio (0-1) to keep a stuck piece.
 * Pieces with >= 50% completion are worth keeping even if stuck.
 */
export const PIECE_ABANDON_MIN_PROGRESS = 0.5 // 50%

/**
 * How often to run piece health cleanup (every N ticks).
 * With 100ms tick interval, 5 = every 500ms.
 */
export const CLEANUP_TICK_INTERVAL = 5

/**
 * Adaptive maintenance intervals.
 * Starts frequent (500ms) for quick connection establishment,
 * then backs off to 5s steady-state.
 */
export const MAINTENANCE_INTERVALS = [500, 1000, 1000, 2000, 2000, 5000]

/**
 * Callback interface for TorrentTickLoop to communicate with Torrent.
 * This provides access to torrent state and methods needed by the tick loops.
 */
export interface TickLoopCallbacks {
  // State queries
  isNetworkActive(): boolean
  isKillSwitchEnabled(): boolean
  isComplete(): boolean
  getMaxPeers(): number
  getNumPeers(): number
  getInfoHashStr(): string

  // Peer access
  getConnectedPeers(): PeerConnection[]
  getPeers(): PeerConnection[]

  // Managers
  getSwarm(): Swarm
  getPeerSelector(): PeerSelector
  getPeerCoordinator(): PeerCoordinator
  getUploader(): TorrentUploader
  getActivePieces(): ActivePieceManager | undefined
  getDiskQueue(): TorrentDiskQueue

  // Bandwidth
  isDownloadRateLimited(): boolean
  getCategoryRate(direction: 'down' | 'up', category: TrafficCategory): number

  // Actions
  requestPieces(peer: PeerConnection, now: number): void
  requestConnections(infoHashStr: string, count: number): void

  // Event emission
  emitInvariantViolation(data: {
    type: string
    context?: string
    total: number
    max: number
    peers: number
    connecting: number
    message: string
  }): void

  /**
   * Optional batch flush function for all peers in a single FFI call.
   * When provided, used instead of per-peer flush() calls.
   * On native (Android/iOS), this reduces FFI overhead significantly.
   */
  batchFlushPeers?(peers: PeerConnection[]): void
}

/**
 * Tick statistics for health monitoring.
 */
export interface TickStats {
  tickCount: number
  tickTotalMs: number
  tickMaxMs: number
  activePieces: number
  connectedPeers: number
}

/**
 * Handles periodic tick loops for torrent operations.
 *
 * This class manages two critical periodic tasks:
 *
 * 1. **Request Tick** (~100ms): Fills peer request pipelines, runs piece health cleanup
 * 2. **Maintenance** (adaptive 500ms→5s): Peer coordination, choke/unchoke, slot filling
 *
 * These are the "hot paths" of the torrent engine - understanding and optimizing
 * them is critical for download performance.
 *
 * Extracted from Torrent class for:
 * - Easier performance profiling and optimization
 * - Clearer separation of periodic vs event-driven logic
 * - Better testability of timing-sensitive code
 */
export class TorrentTickLoop extends EngineComponent {
  static logName = 'tick-loop'

  // === Request Tick State ===
  private _tickCount = 0
  private _tickTotalMs = 0
  private _tickMaxMs = 0
  private _lastTickLogTime = 0
  private _cleanupTickCounter = 0

  // === Maintenance State ===
  private _maintenanceInterval: ReturnType<typeof setTimeout> | null = null
  private _maintenanceStep = 0
  private _maintCount = 0
  private _maintTotalMs = 0
  private _maintMaxMs = 0
  private _lastMaintLogTime = 0
  private _maintSnapshotMs = 0
  private _maintCoordinatorMs = 0
  private _maintApplyMs = 0
  private _lastBackpressureLogTime = 0

  constructor(
    engineInstance: ILoggingEngine,
    private callbacks: TickLoopCallbacks,
  ) {
    super(engineInstance)
  }

  /**
   * Flush all pending sends for the given peers.
   * Uses batch flush if available (single FFI call on native), otherwise per-peer flush.
   */
  private flushPeers(peers: PeerConnection[]): void {
    if (this.callbacks.batchFlushPeers) {
      this.callbacks.batchFlushPeers(peers)
    } else {
      for (const peer of peers) {
        peer.flush()
      }
    }
  }

  // ==========================================================================
  // Request Tick (Game Loop)
  // ==========================================================================

  /**
   * Process one tick for this torrent.
   * Called by BtEngine.engineTick() at 100ms intervals.
   *
   * Game loop pattern:
   * 1. GATHER - drain all input buffers (TCP data accumulated since last tick)
   * 2. PROCESS - protocol parsing, piece state updates, cleanup
   * 3. REQUEST - request pieces from eligible peers
   * 4. OUTPUT - flush all pending sends
   */
  tick(): void {
    if (!this.callbacks.isNetworkActive()) return

    const startTime = Date.now()
    const connectedPeers = this.callbacks.getConnectedPeers()

    // === Phase 1: GATHER - drain all input buffers ===
    // Process all accumulated TCP data before any other work.
    // This moves processing from unpredictable callbacks to this controlled tick.
    for (const peer of connectedPeers) {
      peer.drainBuffer()
    }

    // === Phase 2: PROCESS - periodic cleanup of stuck pieces ===
    this._cleanupTickCounter++
    if (this._cleanupTickCounter >= CLEANUP_TICK_INTERVAL) {
      this._cleanupTickCounter = 0
      this.cleanupStuckPieces()
    }

    // === Phase 3: REQUEST - fill peer request pipelines ===
    let peersProcessed = 0
    for (const peer of connectedPeers) {
      if (!peer.peerChoking && peer.requestsPending < peer.pipelineDepth) {
        this.callbacks.requestPieces(peer, startTime)
        peersProcessed++
      }
    }

    // === Phase 4: OUTPUT - flush all queued sends ===
    // Batch all protocol messages into single FFI call (reduces overhead on Android)
    this.flushPeers(connectedPeers)

    const endTime = Date.now()
    const elapsed = endTime - startTime
    this._tickCount++
    this._tickTotalMs += elapsed
    if (elapsed > this._tickMaxMs) {
      this._tickMaxMs = elapsed
    }

    // Log tick stats every 5 seconds
    if (endTime - this._lastTickLogTime >= 5000 && this._tickCount > 0) {
      const avgMs = (this._tickTotalMs / this._tickCount).toFixed(1)
      const activePieces = this.callbacks.getActivePieces()?.activeCount ?? 0
      this.logger.info(
        `Tick: ${this._tickCount} ticks, avg ${avgMs}ms, max ${this._tickMaxMs}ms, ` +
          `${activePieces} active pieces, ${peersProcessed} peers/tick`,
      )
      this._tickCount = 0
      this._tickTotalMs = 0
      this._tickMaxMs = 0
      this._lastTickLogTime = endTime
    }
  }

  /**
   * Get current tick statistics for health monitoring.
   * Returns stats from the current logging window (resets every 5 seconds).
   */
  getTickStats(): TickStats {
    return {
      tickCount: this._tickCount,
      tickTotalMs: this._tickTotalMs,
      tickMaxMs: this._tickMaxMs,
      activePieces: this.callbacks.getActivePieces()?.activeCount ?? 0,
      connectedPeers: this.callbacks.getConnectedPeers().length,
    }
  }

  // ==========================================================================
  // Piece Health Management
  // ==========================================================================

  /**
   * Clean up stuck pieces: timeout stale requests and abandon hopeless pieces.
   *
   * This method:
   * 1. Finds and cancels stale block requests (>10s old)
   * 2. Sends CANCEL messages to peers for those requests
   * 3. Clears exclusive ownership when the owner times out
   * 4. Demotes full pieces back to partial if they now have unrequested blocks
   * 5. Abandons pieces that are stuck (>30s old with <50% progress)
   *
   * libtorrent reference: peer_connection.cpp:4565-4588
   */
  private cleanupStuckPieces(): void {
    const activePieces = this.callbacks.getActivePieces()
    if (!activePieces) return

    const piecesToRemove: number[] = []
    const piecesToDemote: number[] = []
    let staleRequestsCleared = 0
    let piecesAbandoned = 0

    // Check partial pieces for stale requests and abandonment
    for (const piece of activePieces.partialValues()) {
      // Step 1: Check for stale requests
      const staleRequests = piece.getStaleRequests(BLOCK_REQUEST_TIMEOUT_MS)
      for (const { blockIndex, peerId } of staleRequests) {
        // Find the peer to send CANCEL
        const peer = this.findPeerById(peerId)
        if (peer) {
          const begin = blockIndex * BLOCK_SIZE
          const length = Math.min(BLOCK_SIZE, piece.length - begin)
          peer.sendCancel(piece.index, begin, length)

          // Decrement peer's pending request count
          peer.requestsPending = Math.max(0, peer.requestsPending - 1)
        }

        // Clean up the request from the piece
        piece.cancelRequest(blockIndex, peerId)
        staleRequestsCleared++
      }

      // Step 2: Check if piece should be abandoned
      if (piece.shouldAbandon(PIECE_ABANDON_TIMEOUT_MS, PIECE_ABANDON_MIN_PROGRESS)) {
        const progress = Math.round((piece.blocksReceived / piece.blocksNeeded) * 100)
        this.logger.info(`Abandoning stuck piece ${piece.index} (${progress}% complete)`)
        piecesToRemove.push(piece.index)
        piecesAbandoned++
      }
    }

    // Also check fullyRequested pieces for stale requests
    // FullyRequested pieces have all blocks requested but not all received
    for (const piece of activePieces.fullyRequestedValues()) {
      const staleRequests = piece.getStaleRequests(BLOCK_REQUEST_TIMEOUT_MS)
      for (const { blockIndex, peerId } of staleRequests) {
        // Find the peer to send CANCEL
        const peer = this.findPeerById(peerId)
        if (peer) {
          const begin = blockIndex * BLOCK_SIZE
          const length = Math.min(BLOCK_SIZE, piece.length - begin)
          peer.sendCancel(piece.index, begin, length)

          // Decrement peer's pending request count
          peer.requestsPending = Math.max(0, peer.requestsPending - 1)
        }

        // Clean up the request from the piece
        piece.cancelRequest(blockIndex, peerId)
        staleRequestsCleared++
      }

      // If full piece now has unrequested blocks, mark for demotion
      if (piece.hasUnrequestedBlocks) {
        piecesToDemote.push(piece.index)
      }
    }

    // Demote full pieces back to partial if they have unrequested blocks
    for (const index of piecesToDemote) {
      activePieces.demoteToPartial(index)
    }

    // Remove abandoned pieces
    for (const index of piecesToRemove) {
      activePieces.remove(index)
    }

    // Log if we did any cleanup
    if (staleRequestsCleared > 0 || piecesAbandoned > 0 || piecesToDemote.length > 0) {
      this.logger.debug(
        `Piece health cleanup: ${staleRequestsCleared} stale requests cancelled, ` +
          `${piecesAbandoned} pieces abandoned, ${piecesToDemote.length} demoted to partial`,
      )
    }
  }

  /**
   * Find a connected peer by their ID string.
   * Used by cleanupStuckPieces to send CANCEL messages.
   */
  private findPeerById(peerId: string): PeerConnection | undefined {
    for (const peer of this.callbacks.getConnectedPeers()) {
      const pId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
      if (pId === peerId) {
        return peer
      }
    }
    return undefined
  }

  // ==========================================================================
  // Maintenance Loop
  // ==========================================================================

  /**
   * Start adaptive maintenance - runs frequently at first, then backs off.
   * Intervals: 500ms, 1s, 1s, 2s, 2s, then 5s steady-state
   */
  startMaintenance(): void {
    if (this._maintenanceInterval) return

    this._maintenanceStep = 0
    this.scheduleNextMaintenance()
  }

  /**
   * Schedule the next maintenance cycle with adaptive interval.
   */
  private scheduleNextMaintenance(): void {
    const delay =
      MAINTENANCE_INTERVALS[Math.min(this._maintenanceStep, MAINTENANCE_INTERVALS.length - 1)]

    this._maintenanceInterval = setTimeout(() => {
      this.runMaintenance()
      this._maintenanceStep++

      if (this.callbacks.isNetworkActive()) {
        this.scheduleNextMaintenance()
      }
    }, delay)
  }

  /**
   * Stop periodic maintenance.
   */
  stopMaintenance(): void {
    if (this._maintenanceInterval) {
      clearTimeout(this._maintenanceInterval)
      this._maintenanceInterval = null
    }
    this._maintenanceStep = 0
  }

  /**
   * Run maintenance: peer coordination and slot filling.
   * Instrumented for performance monitoring - logs timing every 5s.
   */
  runMaintenance(): void {
    const maintStart = Date.now()

    // Always check invariants regardless of state
    this.checkSwarmInvariants()

    if (!this.callbacks.isNetworkActive()) return
    if (this.callbacks.isKillSwitchEnabled()) return

    const swarm = this.callbacks.getSwarm()
    const peerSelector = this.callbacks.getPeerSelector()
    const coordinator = this.callbacks.getPeerCoordinator()
    const peers = this.callbacks.getPeers()

    // === Phase 1: Build peer snapshots ===
    const snapshotStart = Date.now()
    const snapshots = this.buildPeerSnapshots(peers)
    const snapshotMs = Date.now() - snapshotStart
    this._maintSnapshotMs += snapshotMs

    // === Phase 2: Run peer coordinator (BEP 3 choke algorithm + download optimizer) ===
    const coordStart = Date.now()
    // Skip speed-based peer drops when we're heavily rate-limited
    const skipSpeedChecks = this.callbacks.isDownloadRateLimited()

    // Check candidates ONCE (fix: was calling getConnectablePeers twice)
    const connected = this.callbacks.getNumPeers()
    const connecting = swarm.connectingCount
    const maxPeers = this.callbacks.getMaxPeers()
    const slotsAvailable = maxPeers - connected - connecting
    const swarmSize = swarm.size

    // Get candidates once, reuse for both hasSwarmCandidates and candidateCount
    const candidates = slotsAvailable > 0 ? peerSelector.getConnectablePeers(slotsAvailable) : []
    const hasSwarmCandidates = candidates.length > 0

    const { unchoke, drop } = coordinator.evaluate(snapshots, hasSwarmCandidates, {
      skipSpeedChecks,
    })
    const coordMs = Date.now() - coordStart
    this._maintCoordinatorMs += coordMs

    // === Phase 3: Apply decisions ===
    const applyStart = Date.now()
    for (const decision of unchoke) {
      this.applyUnchokeDecision(peers, decision)
    }

    // Apply drop decisions (only when downloading - don't drop peers for slow download when seeding)
    if (!this.callbacks.isComplete()) {
      for (const decision of drop) {
        this.applyDropDecision(peers, decision)
      }
    }
    const applyMs = Date.now() - applyStart
    this._maintApplyMs += applyMs

    // Flush all queued sends (CHOKE/UNCHOKE messages from above)
    this.flushPeers(peers)

    // === Phase 4: Request connection slots from engine ===
    if (this.callbacks.isComplete()) {
      this.logMaintenanceStats(maintStart, swarm)
      return // Don't seek peers when complete
    }

    if (slotsAvailable <= 0) {
      this.logger.debug(
        `Maintenance: no slots (connected=${connected}, connecting=${connecting}, max=${maxPeers})`,
      )
      this.logMaintenanceStats(maintStart, swarm)
      return
    }

    const candidateCount = candidates.length
    if (candidateCount === 0) {
      this.logger.warn(
        `Maintenance: 0 candidates! swarm=${swarmSize}, connected=${connected}, connecting=${connecting}`,
      )
      this.logMaintenanceStats(maintStart, swarm)
      return
    }

    // Request slots from engine (will be granted fairly via round-robin)
    const slotsToRequest = Math.min(slotsAvailable, candidateCount)
    this.callbacks.requestConnections(this.callbacks.getInfoHashStr(), slotsToRequest)

    this.logger.info(
      `Maintenance: swarm=${swarmSize}, connected=${connected}, connecting=${connecting}, ` +
        `requested ${slotsToRequest} slots (${candidateCount} candidates)`,
    )

    // Log backpressure stats periodically (every 5s in steady state)
    this.logBackpressureStats()
    this.logMaintenanceStats(maintStart, swarm)
  }

  /**
   * Build peer snapshots for the coordinator algorithms.
   */
  private buildPeerSnapshots(peers: PeerConnection[]): PeerSnapshot[] {
    const now = Date.now()
    return peers.map((peer) => ({
      id: peerKey(peer.remoteAddress!, peer.remotePort!),
      peerInterested: peer.peerInterested,
      peerChoking: peer.peerChoking,
      amChoking: peer.amChoking,
      downloadRate: peer.downloadSpeed,
      connectedAt: peer.connectedAt,
      lastDataReceived: peer.downloadSpeedCalculator.lastActivity || now,
      isIncoming: peer.isIncoming,
      totalBytesReceived: peer.downloadSpeedCalculator.totalBytes,
    }))
  }

  /**
   * Apply an unchoke decision to a peer.
   */
  private applyUnchokeDecision(peers: PeerConnection[], decision: ChokeDecision): void {
    const peer = peers.find((p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId)
    if (!peer) return

    if (decision.action === 'unchoke') {
      if (peer.amChoking) {
        peer.amChoking = false
        peer.sendMessage(MessageType.UNCHOKE)
        this.logger.debug(`Unchoked ${decision.peerId} (${decision.reason})`)
      }
    } else {
      this.chokePeer(peer)
      this.logger.debug(`Choked ${decision.peerId} (${decision.reason})`)
    }
  }

  /**
   * Apply a drop decision to a peer.
   */
  private applyDropDecision(peers: PeerConnection[], decision: DropDecision): void {
    const peer = peers.find((p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId)
    if (!peer) return

    this.logger.info(`Dropping slow peer ${decision.peerId}: ${decision.reason}`)
    peer.close()
  }

  /**
   * Choke a peer and clear their upload queue.
   */
  private chokePeer(peer: PeerConnection): void {
    if (peer.amChoking) return

    peer.amChoking = true
    peer.sendMessage(MessageType.CHOKE)

    // Clear queued uploads for this peer
    const removed = this.callbacks.getUploader().removeQueuedUploads(peer)
    if (removed > 0) {
      this.logger.debug(`Cleared ${removed} queued uploads for choked peer`)
    }
  }

  /**
   * Log maintenance performance stats every 5 seconds.
   */
  private logMaintenanceStats(maintStart: number, swarm: Swarm): void {
    const elapsed = Date.now() - maintStart
    this._maintCount++
    this._maintTotalMs += elapsed
    if (elapsed > this._maintMaxMs) {
      this._maintMaxMs = elapsed
    }

    const now = Date.now()
    if (now - this._lastMaintLogTime >= 5000 && this._maintCount > 0) {
      const avgMs = (this._maintTotalMs / this._maintCount).toFixed(1)
      const avgSnapshotMs = (this._maintSnapshotMs / this._maintCount).toFixed(1)
      const avgCoordMs = (this._maintCoordinatorMs / this._maintCount).toFixed(1)
      const avgApplyMs = (this._maintApplyMs / this._maintCount).toFixed(1)

      this.logger.info(
        `Maintenance: ${this._maintCount} runs, avg ${avgMs}ms (snapshot=${avgSnapshotMs}ms, ` +
          `coord=${avgCoordMs}ms, apply=${avgApplyMs}ms), max ${this._maintMaxMs}ms, ` +
          `swarm=${swarm.size}, peers=${this.callbacks.getNumPeers()}`,
      )

      // Reset counters
      this._maintCount = 0
      this._maintTotalMs = 0
      this._maintMaxMs = 0
      this._maintSnapshotMs = 0
      this._maintCoordinatorMs = 0
      this._maintApplyMs = 0
      this._lastMaintLogTime = now
    }
  }

  /**
   * Log backpressure-related stats for debugging download performance.
   * Logs: active pieces, buffered bytes, outstanding requests.
   */
  private logBackpressureStats(): void {
    const now = Date.now()
    if (now - this._lastBackpressureLogTime < 5000) return
    this._lastBackpressureLogTime = now

    const activePieces = this.callbacks.getActivePieces()
    if (!activePieces) return

    const activeCount = activePieces.activeCount
    const bufferedBytes = activePieces.totalBufferedBytes
    const bufferedMB = (bufferedBytes / (1024 * 1024)).toFixed(2)

    // Sum outstanding requests across all active pieces
    let totalRequests = 0
    for (const piece of activePieces.values()) {
      totalRequests += piece.outstandingRequests
    }

    // Get disk queue stats
    const diskSnapshot = this.callbacks.getDiskQueue().getSnapshot()
    const diskPending = diskSnapshot.pending.length
    const diskRunning = diskSnapshot.running.length

    // Get disk write rate
    const diskRate = this.callbacks.getCategoryRate('down', 'disk')
    const diskRateMB = (diskRate / (1024 * 1024)).toFixed(1)

    this.logger.info(
      `Backpressure: ${activeCount} active pieces, ${bufferedMB}MB buffered, ${totalRequests} outstanding requests, disk queue: ${diskPending} pending/${diskRunning} running, disk write: ${diskRateMB}MB/s`,
    )
  }

  // ==========================================================================
  // Invariant Checking
  // ==========================================================================

  /**
   * Validate connection state invariants.
   * Swarm is single source of truth for connection state.
   */
  private checkSwarmInvariants(): void {
    const swarm = this.callbacks.getSwarm()
    const swarmStats = swarm.getStats()
    const numPeers = this.callbacks.getNumPeers()
    const maxPeers = this.callbacks.getMaxPeers()

    // Total active connections should not exceed maxPeers (with headroom for in-flight)
    const total = numPeers + swarmStats.byState.connecting
    const maxWithHeadroom = maxPeers + 10 // Allow headroom for in-flight connections
    if (total > maxWithHeadroom) {
      const msg = `total connections (${total}) > maxPeers+headroom (${maxWithHeadroom})`
      this.logger.error(`INVARIANT VIOLATION: ${msg}`)
      this.callbacks.emitInvariantViolation({
        type: 'limit_exceeded',
        total,
        max: maxWithHeadroom,
        peers: numPeers,
        connecting: swarmStats.byState.connecting,
        message: msg,
      })
    }
  }

  /**
   * Assert connection limit immediately after state changes.
   * Allows headroom for in-flight connections.
   */
  assertConnectionLimit(context: string): void {
    const swarm = this.callbacks.getSwarm()
    const numPeers = this.callbacks.getNumPeers()
    const maxPeers = this.callbacks.getMaxPeers()
    const connecting = swarm.connectingCount
    const total = numPeers + connecting
    const maxWithHeadroom = maxPeers + 10
    if (total > maxWithHeadroom) {
      const msg = `${numPeers} peers + ${connecting} connecting = ${total} > ${maxWithHeadroom} max`
      this.logger.error(`LIMIT EXCEEDED [${context}]: ${msg}`)
      this.callbacks.emitInvariantViolation({
        type: 'limit_exceeded',
        context,
        total,
        max: maxWithHeadroom,
        peers: numPeers,
        connecting,
        message: msg,
      })
    }
  }
}
