import { ITracker, TrackerAnnounceEvent } from '../interfaces/tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
export declare class UdpTracker extends EngineComponent implements ITracker {
  private announceUrl
  readonly infoHash: Uint8Array
  readonly peerId: Uint8Array
  private socketFactory
  private port
  static logName: string
  private socket
  private connectionId
  private connectionIdTime
  private transactionId
  private _interval
  get interval(): number
  private timer
  constructor(
    engine: ILoggingEngine,
    announceUrl: string,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    port?: number,
  )
  announce(event?: TrackerAnnounceEvent): Promise<void>
  private connectPromise
  private connect
  private sendAnnounce
  private onMessage
  destroy(): void
}
//# sourceMappingURL=udp-tracker.d.ts.map
