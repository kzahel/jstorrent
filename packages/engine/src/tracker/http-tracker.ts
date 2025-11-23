import { ITracker } from '../interfaces/tracker'
import { EventEmitter } from 'events'
import { Bencode } from '../utils/bencode'
// We might need a cross-platform fetch or abstract HTTP
// Since we are in 'engine', we should probably use 'fetch' if available (Node 18+ / Browser)
// or abstract it. For now, let's assume global fetch is available or use a polyfill if needed.
// But `http` module is Node specific.
// The plan said "Node.js Adapters" for Phase 4.
// For Phase 5, `HttpTracker` should ideally be platform agnostic.
// We can use `fetch`.

export class HttpTracker extends EventEmitter implements ITracker {
  private _interval: number = 1800

  get interval(): number {
    return this._interval
  }
  private timer: NodeJS.Timeout | null = null

  constructor(
    private announceUrl: string,
    private infoHash: Uint8Array,
    private peerId: Uint8Array,
    private port: number = 6881,
  ) {
    super()
  }

  async announce(event: 'started' | 'stopped' | 'completed' | 'update' = 'started'): Promise<void> {
    const params = new URLSearchParams()
    params.set('info_hash', this.escapeInfoHash(this.infoHash))
    params.set('peer_id', new TextDecoder().decode(this.peerId)) // This might be binary, need careful encoding
    // Actually, URLSearchParams encodes values. But info_hash needs to be %-encoded bytes.
    // Standard URLSearchParams might not handle binary strings correctly if they contain invalid UTF-8.
    // We usually need to manually construct the query string for binary data.

    // Let's implement a custom query builder for binary data
    const query = this.buildQuery(event)
    const url = `${this.announceUrl}?${query}`

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = (await fetch(url)) as any
      if (!response.ok) {
        throw new Error(`Tracker returned ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      const data = new Uint8Array(buffer)

      // Parse Bencoded response
      // We need a Bencode parser!
      // I haven't implemented a Bencode parser yet in this plan.
      // I should have.
      // Let's assume I need to implement a Bencode parser first or use a simple one here.
      // For now, I'll implement a basic Bencode parser in `utils/bencode.ts`.

      const parsed = Bencode.decode(data)
      this.handleResponse(parsed)
    } catch (err) {
      this.emit('error', err)
    }
  }

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
