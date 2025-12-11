import { ITracker, PeerInfo, TrackerStats } from '../interfaces/tracker'
import { HttpTracker } from './http-tracker'
import { UdpTracker } from './udp-tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export class TrackerManager extends EngineComponent {
  static logName = 'tracker-manager'
  private trackers: ITracker[] = []
  private knownPeers: Set<string> = new Set()

  constructor(
    engine: ILoggingEngine,
    private announceList: string[][],
    readonly infoHash: Uint8Array,
    readonly peerId: Uint8Array,
    private socketFactory: ISocketFactory,
    private port: number = 6881,
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
            )
          } else {
            this.logger.warn(`TrackerManager: Unsupported tracker protocol: ${url}`)
          }

          if (tracker) {
            this.trackers.push(tracker)
            tracker.on('peersDiscovered', (peers) => this.handlePeersDiscovered(peers))
            tracker.on('error', (err) => this.logger.warn(`Tracker ${url} error: ${err.message}`))
          }
        } catch (_err) {
          // Invalid URL or unsupported protocol
          this.logger.warn(`Failed to create tracker for ${url}`, { err: _err })
        }
      }
    }
    this.logger.info(`TrackerManager: Created ${this.trackers.length} trackers`)
  }

  async announce(event: 'started' | 'stopped' | 'completed' | 'update' = 'started') {
    this.logger.info(`TrackerManager: Announcing '${event}' to ${this.trackers.length} trackers`)
    const promises = this.trackers.map((t) =>
      t.announce(event).catch((err) => {
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
    for (const tracker of this.trackers) {
      tracker.destroy()
    }
    this.trackers = []
  }
}
