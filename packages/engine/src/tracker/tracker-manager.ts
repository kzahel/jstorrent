import { ITracker, PeerInfo } from '../interfaces/tracker'
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
    for (const tier of this.announceList) {
      for (const url of tier) {
        try {
          let tracker: ITracker | null = null
          if (url.startsWith('http')) {
            tracker = new HttpTracker(
              url,
              this.infoHash,
              this.peerId,
              this.socketFactory,
              this.port,
            )
          } else if (url.startsWith('udp')) {
            tracker = new UdpTracker(
              this.engine,
              url,
              this.infoHash,
              this.peerId,
              this.socketFactory,
              this.port,
            )
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
  }

  async announce(event: 'started' | 'stopped' | 'completed' | 'update' = 'started') {
    const promises = this.trackers.map((t) =>
      t.announce(event).catch((_err) => {
        // Suppress individual tracker errors during announce, they emit 'error' event anyway
      }),
    )
    await Promise.all(promises)
  }

  private handlePeer(peer: PeerInfo) {
    const key = `${peer.ip}:${peer.port}`
    if (!this.knownPeers.has(key)) {
      this.knownPeers.add(key)
      this.emit('peer', peer)
    }
  }

  destroy() {
    for (const tracker of this.trackers) {
      tracker.destroy()
    }
    this.trackers = []
  }
}
