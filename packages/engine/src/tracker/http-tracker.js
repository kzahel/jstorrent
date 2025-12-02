import { Bencode } from '../utils/bencode'
import { MinimalHttpClient } from '../utils/minimal-http-client'
import { EngineComponent } from '../logging/logger'
export class HttpTracker extends EngineComponent {
  get interval() {
    return this._interval
  }
  constructor(engine, announceUrl, infoHash, peerId, socketFactory, port = 6881) {
    super(engine)
    this.announceUrl = announceUrl
    this.port = port
    this._interval = 1800
    this.timer = null
    this._infoHash = infoHash
    this._peerId = peerId
    this.httpClient = new MinimalHttpClient(socketFactory, this.logger)
    this.logger.debug(`HttpTracker created for ${announceUrl}`)
  }
  async announce(event = 'started') {
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
  handleBody(bodyBuffer) {
    try {
      const parsed = Bencode.decode(bodyBuffer)
      this.handleResponse(parsed)
    } catch (err) {
      const errMsg = `Failed to decode tracker response: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this.emit('error', new Error(errMsg))
    }
  }
  // Removed handleRawResponse as it is replaced by streaming logic above
  escapeInfoHash(buffer) {
    return Array.from(buffer)
      .map((b) => '%' + b.toString(16).padStart(2, '0'))
      .join('')
  }
  buildQuery(event) {
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
  handleResponse(data) {
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
  parsePeers(peersData) {
    const peers = []
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
  destroy() {
    if (this.timer) clearInterval(this.timer)
  }
}
HttpTracker.logName = 'http-tracker'
