import {
  AnnounceStats,
  ITracker,
  PeerInfo,
  TrackerStats,
  TrackerStatus,
} from '../interfaces/tracker'
import { Bencode } from '../utils/bencode'
import { ISocketFactory } from '../interfaces/socket'
import { MinimalHttpClient } from '../utils/minimal-http-client'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { BandwidthTracker } from '../core/bandwidth-tracker'
import { parseCompactPeers } from '../core/swarm'

const ANNOUNCE_TIMEOUT_MS = 30000

// Backoff constants (in seconds)
const BACKOFF_BASE_S = 5 // 5 seconds initial retry
const BACKOFF_MAX_S = 300 // 5 minutes max

/**
 * Calculate backoff delay for retry based on consecutive failures.
 * Uses exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s, 300s (capped)
 */
function calculateBackoffMs(consecutiveFailures: number): number {
  const delayS = Math.min(BACKOFF_BASE_S * Math.pow(2, consecutiveFailures), BACKOFF_MAX_S)
  return delayS * 1000
}

export class HttpTracker extends EngineComponent implements ITracker {
  static logName = 'http-tracker'
  private _interval: number = 1800
  private httpClient: MinimalHttpClient
  private _infoHash: Uint8Array
  private _peerId: Uint8Array
  private _status: TrackerStatus = 'idle'
  private _seeders: number | null = null
  private _leechers: number | null = null
  private _lastPeersReceived: number = 0
  private _knownPeers: Set<string> = new Set()
  private _lastError: string | null = null
  private _lastAnnounceTime: number | null = null
  private announceTimeoutId: ReturnType<typeof setTimeout> | null = null
  private _consecutiveFailures: number = 0
  private _lastFailureTime: number | null = null
  /** BEP 31: Tracker-specified retry delay in seconds (overrides backoff) */
  private _retryIn: number | null = null

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
    private bandwidthTracker?: BandwidthTracker,
  ) {
    super(engine)
    this._infoHash = infoHash
    this._peerId = peerId
    this.httpClient = new MinimalHttpClient(socketFactory, this.logger)
    this.logger.debug(`HttpTracker created for ${announceUrl}`)
  }

  async announce(
    event: 'started' | 'stopped' | 'completed' | 'update' = 'started',
    stats?: AnnounceStats,
  ): Promise<void> {
    const query = this.buildQuery(event, stats)
    const url = `${this.announceUrl}?${query}`

    this.logger.info(`HttpTracker: Announcing '${event}' to ${this.announceUrl}`)
    this._status = 'announcing'

    // Estimate request size (URL + headers, approximate)
    const requestSize = url.length + 200 // rough estimate for HTTP headers
    this.bandwidthTracker?.record('tracker:http', requestSize, 'up')

    // Create a timeout promise that aborts the request
    let timedOut = false
    const timeoutPromise = new Promise<never>((_, reject) => {
      this.announceTimeoutId = setTimeout(() => {
        timedOut = true
        this.httpClient.abort()
        this.announceTimeoutId = null
        reject(new Error('Announce timeout'))
      }, ANNOUNCE_TIMEOUT_MS)
    })

    try {
      const responseBody = await Promise.race([this.httpClient.get(url), timeoutPromise])

      // Clear timeout on success
      if (this.announceTimeoutId) {
        clearTimeout(this.announceTimeoutId)
        this.announceTimeoutId = null
      }

      this.logger.debug(`HttpTracker: Received ${responseBody.length} bytes response`)

      // Record tracker download bytes
      this.bandwidthTracker?.record('tracker:http', responseBody.length, 'down')

      this.handleBody(responseBody)
    } catch (err) {
      // Clear timeout on error
      if (this.announceTimeoutId) {
        clearTimeout(this.announceTimeoutId)
        this.announceTimeoutId = null
      }

      const errMsg = timedOut
        ? 'Announce timeout'
        : `Tracker announce failed: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this._status = 'error'
      this._lastError = errMsg
      this._consecutiveFailures++
      this._lastFailureTime = Date.now()
      this._retryIn = null // Clear any previous retry-in
      this.emit('error', new Error(errMsg))
    }
  }

  private handleBody(bodyBuffer: Uint8Array) {
    try {
      const parsed = Bencode.decode(bodyBuffer)
      this.handleResponse(parsed)
    } catch (err) {
      // Bdecode failed - check if this is an HTML error page
      const errorDetails = this.tryParseErrorResponse(bodyBuffer)
      const errMsg = errorDetails
        ? `Tracker returned error: ${errorDetails}`
        : `Failed to decode tracker response: ${err instanceof Error ? err.message : String(err)}`
      this.logger.error(`HttpTracker: ${errMsg}`)
      this._status = 'error'
      this._lastError = errMsg
      this._consecutiveFailures++
      this._lastFailureTime = Date.now()
      this._retryIn = null
      this.emit('error', new Error(errMsg))
    }
  }

  /**
   * Try to extract useful info from a non-bencoded response (likely HTML error page)
   */
  private tryParseErrorResponse(bodyBuffer: Uint8Array): string | null {
    // Check if it looks like HTML (starts with < or whitespace then <)
    const firstByte = bodyBuffer[0]
    const looksLikeHtml =
      firstByte === 0x3c || // '<'
      (firstByte <= 0x20 && bodyBuffer.length > 1 && bodyBuffer.slice(0, 100).includes(0x3c))

    if (!looksLikeHtml && bodyBuffer.length > 0) {
      // Not HTML, might be plain text - show first 200 bytes
      try {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bodyBuffer.slice(0, 200))
        if (text.length > 0) {
          return `Unexpected response: ${text}${bodyBuffer.length > 200 ? '...' : ''}`
        }
      } catch {
        return null
      }
    }

    if (!looksLikeHtml) return null

    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bodyBuffer)

      // Try to extract HTTP status from <title> tag (e.g., "503 Service Unavailable")
      const titleMatch = text.match(/<title>(\d{3}\s+[^<]+)<\/title>/i)
      const httpStatus = titleMatch ? titleMatch[1].trim() : null

      // Try to extract main message from <h1> tag
      const h1Match = text.match(/<h1>([^<]+)<\/h1>/i)
      const h1Text = h1Match ? h1Match[1].trim() : null

      // Build error message
      if (httpStatus) {
        return h1Text && h1Text !== httpStatus ? `${httpStatus} - ${h1Text}` : httpStatus
      }

      if (h1Text) {
        return h1Text
      }

      // Fall back to showing first 200 chars of the text content
      const plainText = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
      if (plainText.length > 0) {
        return `HTML response: ${plainText}${plainText.length >= 200 ? '...' : ''}`
      }
    } catch {
      // Decoding failed, return null
    }
    return null
  }

  // Removed handleRawResponse as it is replaced by streaming logic above

  private escapeInfoHash(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map((b) => '%' + b.toString(16).padStart(2, '0'))
      .join('')
  }

  private buildQuery(event: string, stats?: AnnounceStats): string {
    const uploaded = stats?.uploaded ?? 0
    const downloaded = stats?.downloaded ?? 0

    let q = `info_hash=${this.escapeInfoHash(this._infoHash)}`
    q += `&peer_id=${this.escapeInfoHash(this._peerId)}` // PeerID is also binary usually
    q += `&port=${this.engine.listeningPort}`
    q += `&uploaded=${uploaded}`
    q += `&downloaded=${downloaded}`
    // left is required by most trackers (BEP 3); use 0 for magnets before metadata
    const left = stats?.left ?? 0
    q += `&left=${left}`
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
      this._consecutiveFailures++
      this._lastFailureTime = Date.now()

      // BEP 31: Check for 'retry in' field (seconds until retry allowed)
      if (typeof data['retry in'] === 'number') {
        this._retryIn = data['retry in']
        this.logger.debug(`HttpTracker: Tracker specified retry in ${this._retryIn}s`)
      } else {
        this._retryIn = null
      }

      this.emit('error', new Error(errMsg))
      return
    }

    // Success - update status, clear error, and reset failure tracking
    this._status = 'ok'
    this._lastError = null
    this._lastAnnounceTime = Date.now()
    this._consecutiveFailures = 0
    this._lastFailureTime = null
    this._retryIn = null

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

    // Track peers received in this response
    let peersThisResponse = 0

    if (data['peers']) {
      const peers = this.parsePeers(data['peers'])
      peersThisResponse += peers.length
      for (const p of peers) {
        this._knownPeers.add(`${p.ip}:${p.port}`)
      }
      if (peers.length > 0) {
        this.logger.debug(`Tracker ${this.announceUrl}: Discovered ${peers.length} IPv4 peers`)
        this.emit('peersDiscovered', peers)
      }
    }

    // BEP 7: IPv6 peers in 'peers6' field (compact format: 18 bytes per peer)
    if (data['peers6'] && data['peers6'] instanceof Uint8Array) {
      const peers6 = parseCompactPeers(data['peers6'], 'ipv6')
      peersThisResponse += peers6.length
      for (const p of peers6) {
        this._knownPeers.add(`${p.ip}:${p.port}`)
      }
      this.logger.debug(
        `Tracker ${this.announceUrl}: peers6 field present, ${data['peers6'].length} bytes -> ${peers6.length} IPv6 peers`,
      )
      if (peers6.length > 0) {
        this.emit(
          'peersDiscovered',
          peers6.map((p) => ({ ip: p.ip, port: p.port })),
        )
      }
    } else if (data['peers6']) {
      this.logger.debug(
        `Tracker ${this.announceUrl}: peers6 field present but not Uint8Array: ${typeof data['peers6']}`,
      )
    }

    this._lastPeersReceived = peersThisResponse
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
      // Dictionary format (non-compact) - IP is a string or Uint8Array of ASCII bytes
      for (const p of peersData) {
        if (p.ip && p.port) {
          const ipStr = p.ip instanceof Uint8Array ? new TextDecoder().decode(p.ip) : String(p.ip)
          peers.push({ ip: ipStr, port: Number(p.port) })
        }
      }
    }
    return peers
  }

  getStats(): TrackerStats {
    // Calculate next announce time based on success or failure
    let nextAnnounce: number | null = null
    if (this._lastAnnounceTime && this._status === 'ok') {
      // Success: use normal interval
      nextAnnounce = this._lastAnnounceTime + this._interval * 1000
    } else if (this._lastFailureTime && this._consecutiveFailures > 0) {
      // Failure: use BEP 31 retry-in if provided, otherwise exponential backoff
      if (this._retryIn !== null) {
        nextAnnounce = this._lastFailureTime + this._retryIn * 1000
      } else {
        nextAnnounce = this._lastFailureTime + calculateBackoffMs(this._consecutiveFailures - 1)
      }
    }

    return {
      url: this.announceUrl,
      type: 'http',
      status: this._status,
      interval: this._interval,
      seeders: this._seeders,
      leechers: this._leechers,
      lastPeersReceived: this._lastPeersReceived,
      uniquePeersDiscovered: this._knownPeers.size,
      lastError: this._lastError,
      nextAnnounce,
    }
  }

  destroy(): void {
    // Clear timeout
    if (this.announceTimeoutId) {
      clearTimeout(this.announceTimeoutId)
      this.announceTimeoutId = null
    }
    if (this.timer) clearInterval(this.timer)
    // Abort any in-flight HTTP requests
    this.httpClient.abort()
  }
}
