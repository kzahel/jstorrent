import { PeerInfo } from '../interfaces/tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
export declare class TrackerManager extends EngineComponent {
  private announceList
  readonly infoHash: Uint8Array
  readonly peerId: Uint8Array
  private socketFactory
  private port
  static logName: string
  private trackers
  private knownPeers
  constructor(
    engine: ILoggingEngine,
    announceList: string[][],
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    port?: number,
  )
  private initTrackers
  announce(event?: 'started' | 'stopped' | 'completed' | 'update'): Promise<void>
  private handlePeersDiscovered
  /**
   * Get all known peers discovered from trackers.
   * Used for peer slot refilling when connections drop.
   */
  getKnownPeers(): PeerInfo[]
  destroy(): void
}
//# sourceMappingURL=tracker-manager.d.ts.map
