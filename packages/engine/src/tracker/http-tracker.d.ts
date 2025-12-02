import { ITracker } from '../interfaces/tracker'
import { ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
export declare class HttpTracker extends EngineComponent implements ITracker {
  private announceUrl
  private port
  static logName: string
  private _interval
  private httpClient
  private _infoHash
  private _peerId
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
  announce(event?: 'started' | 'stopped' | 'completed' | 'update'): Promise<void>
  private handleBody
  private escapeInfoHash
  private buildQuery
  private handleResponse
  private parsePeers
  destroy(): void
}
//# sourceMappingURL=http-tracker.d.ts.map
