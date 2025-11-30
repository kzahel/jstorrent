import { ITracker, PeerInfo } from '../interfaces/tracker'
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

  get interval(): number {
    return this._interval
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

    try {
      const responseBody = await this.httpClient.get(url)
      this.logger.debug(`HttpTracker: Received ${responseBody.length} bytes response`)
      this.handleBody(responseBody)
    } catch (err) {
      const errMsg = `Tracker announce failed: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this.emit('error', new Error(errMsg))
    }
  }

  private handleBody(bodyBuffer: Buffer) {
    try {
      const parsed = Bencode.decode(new Uint8Array(bodyBuffer))
      this.handleResponse(parsed)
    } catch (err) {
      const errMsg = `Failed to decode tracker response: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
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
      this.emit('error', new Error(new TextDecoder().decode(data['failure reason'])))
      return
    }

    if (data['interval']) {
      this._interval = data['interval']
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

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
