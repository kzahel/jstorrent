import { AnnounceStats, ITracker, PeerInfo, TrackerStats } from '../interfaces/tracker'
import { HttpTracker } from './http-tracker'
import { UdpTracker } from './udp-tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { BandwidthTracker } from '../core/bandwidth-tracker'

export type TrackerAnnounceEvent = 'started' | 'stopped' | 'completed' | 'update'

export class TrackerManager extends EngineComponent {
  static logName = 'tracker-manager'
  private trackers: ITracker[] = []
  private knownPeers: Set<string> = new Set()

  /**
   * Queue of trackers waiting to announce, grouped by protocol.
   */
  private pendingUdpAnnounces: Array<{ tracker: ITracker; event: TrackerAnnounceEvent }> = []
  private pendingHttpAnnounces: Array<{ tracker: ITracker; event: TrackerAnnounceEvent }> = []

  /**
   * Callback to get current announce stats from torrent.
   * Set by Torrent after creating TrackerManager.
   */
  private statsGetter: (() => AnnounceStats) | null = null

  constructor(
    engine: ILoggingEngine,
    private announceList: string[][],
    readonly infoHash: Uint8Array,
    readonly peerId: Uint8Array,
    private socketFactory: ISocketFactory,
    private port: number = 6881,
    private bandwidthTracker?: BandwidthTracker,
  ) {
    super(engine)
    this.initTrackers()
  }

  private initTrackers() {
    // Flatten announce list (tiers not fully supported yet, just add all)
    // BEP 12: Tiers. We should try tier 1, then tier 2.
    // For now, just add all trackers.
    this.logger.info(`TrackerManager: Initializing trackers from ${this.announceList.length} tiers`)
    for (const tier of this.announceList) {
      for (const url of tier) {
        try {
          let tracker: ITracker | null = null
          if (url.startsWith('http')) {
            this.logger.debug(`TrackerManager: Creating HTTP tracker for ${url}`)
            tracker = new HttpTracker(
              this.engine,
              url,
              this.infoHash,
              this.peerId,
              this.socketFactory,
              this.port,
              this.bandwidthTracker,
            )
          } else if (url.startsWith('udp')) {
            this.logger.debug(`TrackerManager: Creating UDP tracker for ${url}`)
            tracker = new UdpTracker(
              this.engine,
              url,
              this.infoHash,
              this.peerId,
              this.socketFactory,
              this.port,
              this.bandwidthTracker,
            )
          } else {
            this.logger.warn(`TrackerManager: Unsupported tracker protocol: ${url}`)
          }

          if (tracker) {
            this.trackers.push(tracker)
            tracker.on('peersDiscovered', (peers) => this.handlePeersDiscovered(peers))
            tracker.on('error', (err) => {
              const msg = `Tracker ${url} error: ${err.message}`
              // Connect timeouts are expected, not exceptional
              if (err.message === 'Connect timeout') {
                this.logger.info(msg)
              } else {
                this.logger.warn(msg)
              }
            })
          }
        } catch (_err) {
          // Invalid URL or unsupported protocol
          this.logger.warn(`Failed to create tracker for ${url}`, { err: _err })
        }
      }
    }
    this.logger.info(`TrackerManager: Created ${this.trackers.length} trackers`)
  }

  /**
   * Set the callback to get current announce stats.
   * Called by Torrent after creating TrackerManager.
   */
  setStatsGetter(getter: () => AnnounceStats): void {
    this.statsGetter = getter
  }

  /**
   * Queue announces for all trackers.
   * Returns counts by protocol type for use with requestDaemonOps().
   * @param event - The announce event type
   */
  queueAnnounces(event: TrackerAnnounceEvent = 'started'): { udp: number; http: number } {
    this.logger.info(
      `TrackerManager: Queueing '${event}' announces for ${this.trackers.length} trackers`,
    )

    // Clear existing pending for this event type
    this.pendingUdpAnnounces = this.pendingUdpAnnounces.filter((p) => p.event !== event)
    this.pendingHttpAnnounces = this.pendingHttpAnnounces.filter((p) => p.event !== event)

    let udp = 0
    let http = 0

    for (const tracker of this.trackers) {
      if (tracker.url.startsWith('udp')) {
        this.pendingUdpAnnounces.push({ tracker, event })
        udp++
      } else if (tracker.url.startsWith('http')) {
        this.pendingHttpAnnounces.push({ tracker, event })
        http++
      }
    }

    this.logger.debug(`TrackerManager: Queued ${udp} UDP, ${http} HTTP announces`)
    return { udp, http }
  }

  /**
   * Process one pending announce.
   * Prefers UDP (typically faster response).
   * @returns The protocol type announced, or null if queue empty
   */
  announceOne(): 'udp_announce' | 'http_announce' | null {
    // Get current stats for the announce
    const stats = this.statsGetter?.()

    // Try UDP first (typically faster)
    const udpPending = this.pendingUdpAnnounces.shift()
    if (udpPending) {
      const { tracker, event } = udpPending
      this.logger.debug(`TrackerManager: Announcing '${event}' to UDP ${tracker.url}`)
      tracker.announce(event, stats).catch((err) => {
        this.logger.warn(
          `TrackerManager: UDP announce failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
      return 'udp_announce'
    }

    // Then HTTP
    const httpPending = this.pendingHttpAnnounces.shift()
    if (httpPending) {
      const { tracker, event } = httpPending
      this.logger.debug(`TrackerManager: Announcing '${event}' to HTTP ${tracker.url}`)
      tracker.announce(event, stats).catch((err) => {
        this.logger.warn(
          `TrackerManager: HTTP announce failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
      return 'http_announce'
    }

    return null
  }

  /**
   * Clear all pending announces.
   * Called when torrent stops.
   */
  clearPendingAnnounces(): void {
    const total = this.pendingUdpAnnounces.length + this.pendingHttpAnnounces.length
    this.pendingUdpAnnounces = []
    this.pendingHttpAnnounces = []
    if (total > 0) {
      this.logger.debug(`TrackerManager: Cleared ${total} pending announces`)
    }
  }

  /**
   * Announce to all trackers immediately (legacy method).
   * For new code, prefer queueAnnounces() + requestDaemonOps().
   */
  async announce(event: TrackerAnnounceEvent = 'started') {
    this.logger.info(`TrackerManager: Announcing '${event}' to ${this.trackers.length} trackers`)
    const stats = this.statsGetter?.()
    const promises = this.trackers.map((t) =>
      t.announce(event, stats).catch((err) => {
        // Log the error - trackers also emit 'error' events
        this.logger.warn(
          `TrackerManager: Tracker announce threw: ${err instanceof Error ? err.message : String(err)}`,
        )
      }),
    )
    await Promise.all(promises)
    this.logger.debug('TrackerManager: All announces completed')
  }

  private handlePeersDiscovered(peers: PeerInfo[]) {
    const newPeers: PeerInfo[] = []
    for (const peer of peers) {
      const key = `${peer.ip}:${peer.port}`
      if (!this.knownPeers.has(key)) {
        this.knownPeers.add(key)
        newPeers.push(peer)
      }
    }
    if (newPeers.length > 0) {
      this.logger.debug(
        `Discovered ${newPeers.length} new peers (${peers.length - newPeers.length} duplicates)`,
      )
      this.emit('peersDiscovered', newPeers)
    }
  }

  /**
   * Get all known peers discovered from trackers.
   * Used for peer slot refilling when connections drop.
   */
  getKnownPeers(): PeerInfo[] {
    return Array.from(this.knownPeers).map((key) => {
      const [ip, portStr] = key.split(':')
      return { ip, port: parseInt(portStr, 10) }
    })
  }

  /**
   * Get stats for all trackers.
   */
  getTrackerStats(): TrackerStats[] {
    return this.trackers.map((t) => t.getStats())
  }

  destroy() {
    this.clearPendingAnnounces()

    for (const tracker of this.trackers) {
      tracker.destroy()
    }
    this.trackers = []
  }
}
