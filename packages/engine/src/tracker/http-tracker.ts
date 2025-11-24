import { ITracker } from '../interfaces/tracker'
import { EventEmitter } from 'events'
import { Bencode } from '../utils/bencode'
import { ISocketFactory } from '../interfaces/socket'
import { MinimalHttpClient } from '../utils/minimal-http-client'

export class HttpTracker extends EventEmitter implements ITracker {
  private _interval: number = 1800
  private httpClient: MinimalHttpClient

  get interval(): number {
    return this._interval
  }
  private timer: NodeJS.Timeout | null = null

  constructor(
    private announceUrl: string,
    private infoHash: Uint8Array,
    private peerId: Uint8Array,
    socketFactory: ISocketFactory,
    private port: number = 6881,
  ) {
    super()
    this.httpClient = new MinimalHttpClient(socketFactory)
  }

  async announce(event: 'started' | 'stopped' | 'completed' | 'update' = 'started'): Promise<void> {
    const query = this.buildQuery(event)
    const url = `${this.announceUrl}?${query}`

    try {
      const responseBody = await this.httpClient.get(url)
      this.handleBody(responseBody)
    } catch (err) {
      this.emit(
        'warning',
        `Tracker announce failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private handleBody(bodyBuffer: Buffer) {
    try {
      const parsed = Bencode.decode(new Uint8Array(bodyBuffer))
      this.handleResponse(parsed)
    } catch (err) {
      this.emit(
        'warning',
        `Failed to decode tracker response: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Removed handleRawResponse as it is replaced by streaming logic above

  private escapeInfoHash(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map((b) => '%' + b.toString(16).padStart(2, '0'))
      .join('')
  }

  private buildQuery(event: string): string {
    let q = `info_hash=${this.escapeInfoHash(this.infoHash)}`
    q += `&peer_id=${this.escapeInfoHash(this.peerId)}` // PeerID is also binary usually
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
      const peers = data['peers']
      if (peers instanceof Uint8Array) {
        // Compact response
        for (let i = 0; i < peers.length; i += 6) {
          const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`
          const port = (peers[i + 4] << 8) | peers[i + 5]
          this.emit('peer', { ip, port })
        }
      } else if (Array.isArray(peers)) {
        // Dictionary list
        // ...
      }
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
