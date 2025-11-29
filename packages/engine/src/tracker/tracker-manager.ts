import { ITracker, PeerInfo } from '../interfaces/tracker'
import { HttpTracker } from './http-tracker'
import { UdpTracker } from './udp-tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export class TrackerManager extends EngineComponent {
  static logName = 'tracker-manager'
  private trackers: ITracker[] = []
  private knownPeers: Set<string> = new Set()
  private _stopped: boolean = false

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
            tracker.on('peer', (peer) => this.handlePeer(peer))
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

  private handlePeer(peer: PeerInfo) {
    const key = `${peer.ip}:${peer.port}`
    if (!this.knownPeers.has(key)) {
      this.knownPeers.add(key)
      this.emit('peer', peer)
    }
  }

  /**
   * Stop announcing to trackers.
   * Sends 'stopped' event and prevents future announces.
   */
  stop(): void {
    if (this._stopped) return
    this._stopped = true
    this.announce('stopped').catch((err) => {
      this.logger.warn(`Failed to send stopped announce: ${err}`)
    })
  }

  /**
   * Resume announcing to trackers.
   * Sends 'started' event.
   */
  start(): void {
    if (!this._stopped) return
    this._stopped = false
    this.announce('started').catch((err) => {
      this.logger.warn(`Failed to send started announce: ${err}`)
    })
  }

  destroy() {
    for (const tracker of this.trackers) {
      tracker.destroy()
    }
    this.trackers = []
  }
}
