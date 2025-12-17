import { ITracker, PeerInfo, TrackerStats, TrackerStatus } from '../interfaces/tracker'
import { Bencode } from '../utils/bencode'
import { ISocketFactory } from '../interfaces/socket'
import { MinimalHttpClient } from '../utils/minimal-http-client'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export class HttpTracker extends EngineComponent implements ITracker {
  static logName = 'http-tracker'
  private _interval: number = 1800
  private httpClient: MinimalHttpClient
  private _infoHash: Uint8Array
  private _peerId: Uint8Array
  private _status: TrackerStatus = 'idle'
  private _seeders: number | null = null
  private _leechers: number | null = null
  private _lastError: string | null = null
  private _lastAnnounceTime: number | null = null

  get interval(): number {
    return this._interval
  }
  get url(): string {
    return this.announceUrl
  }
  private timer: NodeJS.Timeout | null = null

  constructor(
    engine: ILoggingEngine,
    private announceUrl: string,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    private port: number = 6881,
  ) {
    super(engine)
    this._infoHash = infoHash
    this._peerId = peerId
    this.httpClient = new MinimalHttpClient(socketFactory, this.logger)
    this.logger.debug(`HttpTracker created for ${announceUrl}`)
  }

  async announce(event: 'started' | 'stopped' | 'completed' | 'update' = 'started'): Promise<void> {
    const query = this.buildQuery(event)
    const url = `${this.announceUrl}?${query}`

    this.logger.info(`HttpTracker: Announcing '${event}' to ${this.announceUrl}`)
    this._status = 'announcing'

    try {
      const responseBody = await this.httpClient.get(url)
      this.logger.debug(`HttpTracker: Received ${responseBody.length} bytes response`)
      this.handleBody(responseBody)
    } catch (err) {
      const errMsg = `Tracker announce failed: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this._status = 'error'
      this._lastError = errMsg
      this.emit('error', new Error(errMsg))
    }
  }

  private handleBody(bodyBuffer: Uint8Array) {
    try {
      const parsed = Bencode.decode(bodyBuffer)
      this.handleResponse(parsed)
    } catch (err) {
      const errMsg = `Failed to decode tracker response: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this._status = 'error'
      this._lastError = errMsg
      this.emit('error', new Error(errMsg))
    }
  }

  // Removed handleRawResponse as it is replaced by streaming logic above

  private escapeInfoHash(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map((b) => '%' + b.toString(16).padStart(2, '0'))
      .join('')
  }

  private buildQuery(event: string): string {
    let q = `info_hash=${this.escapeInfoHash(this._infoHash)}`
    q += `&peer_id=${this.escapeInfoHash(this._peerId)}` // PeerID is also binary usually
    q += `&port=${this.port}`
    q += `&uploaded=0` // TODO: Track stats
    q += `&downloaded=0`
    q += `&left=0`
    q += `&compact=1`
    q += `&event=${event}`
    return q
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleResponse(data: any) {
    if (data['failure reason']) {
      const errMsg = new TextDecoder().decode(data['failure reason'])
      this._status = 'error'
      this._lastError = errMsg
      this.emit('error', new Error(errMsg))
      return
    }

    // Success - update status and clear error
    this._status = 'ok'
    this._lastError = null
    this._lastAnnounceTime = Date.now()

    if (data['interval']) {
      this._interval = data['interval']
    }

    // Store seeders/leechers from response
    if (typeof data['complete'] === 'number') {
      this._seeders = data['complete']
    }
    if (typeof data['incomplete'] === 'number') {
      this._leechers = data['incomplete']
    }

    if (data['peers']) {
      const peers = this.parsePeers(data['peers'])
      if (peers.length > 0) {
        this.emit('peersDiscovered', peers)
      }
    }
  }

  private parsePeers(peersData: unknown): PeerInfo[] {
    const peers: PeerInfo[] = []
    if (peersData instanceof Uint8Array) {
      // Compact format: 6 bytes per peer (4 IP + 2 port)
      for (let i = 0; i + 6 <= peersData.length; i += 6) {
        const ip = `${peersData[i]}.${peersData[i + 1]}.${peersData[i + 2]}.${peersData[i + 3]}`
        const port = (peersData[i + 4] << 8) | peersData[i + 5]
        peers.push({ ip, port })
      }
    } else if (Array.isArray(peersData)) {
      // Dictionary format (rare)
      for (const p of peersData) {
        if (p.ip && p.port) {
          peers.push({ ip: String(p.ip), port: Number(p.port) })
        }
      }
    }
    return peers
  }

  getStats(): TrackerStats {
    return {
      url: this.announceUrl,
      type: 'http',
      status: this._status,
      interval: this._interval,
      seeders: this._seeders,
      leechers: this._leechers,
      lastError: this._lastError,
      nextAnnounce: this._lastAnnounceTime ? this._lastAnnounceTime + this._interval * 1000 : null,
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
