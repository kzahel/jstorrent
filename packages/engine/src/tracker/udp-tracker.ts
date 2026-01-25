import {
  AnnounceStats,
  ITracker,
  TrackerAnnounceEvent,
  PeerInfo,
  TrackerStats,
  TrackerStatus,
} from '../interfaces/tracker'
import { IUdpSocket, ISocketFactory } from '../interfaces/socket'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { BandwidthTracker } from '../core/bandwidth-tracker'

// BEP 15 Constants
const PROTOCOL_ID = 0x41727101980n // Magic constant
const ACTION_CONNECT = 0
const ACTION_ANNOUNCE = 1
const ACTION_ERROR = 3

// Timeout constants
const CONNECT_TIMEOUT_MS = 5000
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

export class UdpTracker extends EngineComponent implements ITracker {
  static logName = 'udp-tracker'
  private socket: IUdpSocket | null = null
  private connectionId: bigint | null = null
  private connectionIdTime: number = 0
  private transactionId: number = 0
  private _interval: number = 1800
  private _status: TrackerStatus = 'idle'
  private _seeders: number | null = null
  private _leechers: number | null = null
  private _lastPeersReceived: number = 0
  private _knownPeers: Set<string> = new Set()
  private _lastError: string | null = null
  private _lastAnnounceTime: number | null = null
  private _consecutiveFailures: number = 0
  private _lastFailureTime: number | null = null

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
    readonly infoHash: Uint8Array,
    readonly peerId: Uint8Array,
    private socketFactory: ISocketFactory,
    private bandwidthTracker?: BandwidthTracker,
  ) {
    super(engine)
  }

  async announce(event: TrackerAnnounceEvent = 'started', stats?: AnnounceStats): Promise<void> {
    this.logger.info(`UdpTracker: Announcing '${event}' to ${this.announceUrl}`)
    this._status = 'announcing'
    try {
      if (!this.socket) {
        this.logger.debug('UdpTracker: Creating UDP socket')
        this.socket = await this.socketFactory.createUdpSocket()
        this.socket.onMessage((rinfo, msg) => {
          this.onMessage(msg, rinfo)
        })
      }

      // Check if connection ID is valid (less than 60 seconds old)
      if (!this.connectionId || Date.now() - this.connectionIdTime > 60000) {
        const url = new URL(this.announceUrl)
        const host = url.hostname
        const port = parseInt(url.port, 10) || 80
        this.logger.debug(`UdpTracker: Connecting to ${host}:${port}`)
        await this.connect(host, port)
        this.logger.debug('UdpTracker: Connection established')
      }

      await this.sendAnnounce(event, stats)
      this.logger.debug('UdpTracker: Announce packet sent')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this._status = 'error'
      this._lastError = errMsg
      this._consecutiveFailures++
      this._lastFailureTime = Date.now()
      this.emit('error', err)
    }
  }

  private connectPromise: { resolve: () => void; reject: (err: Error) => void } | null = null
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null
  private announcePromise: { resolve: () => void; reject: (err: Error) => void } | null = null
  private announceTimeoutId: ReturnType<typeof setTimeout> | null = null

  private async connect(host: string, port: number): Promise<void> {
    this.transactionId = Math.floor(Math.random() * 0xffffffff)
    const buf = new Uint8Array(16)
    const view = new DataView(buf.buffer)
    view.setBigUint64(0, PROTOCOL_ID, false)
    view.setUint32(8, ACTION_CONNECT, false)
    view.setUint32(12, this.transactionId, false)

    if (this.socket) {
      this.socket.send(host, port, buf)
      this.bandwidthTracker?.record('tracker:udp', buf.length, 'up')

      return new Promise<void>((resolve, reject) => {
        this.connectPromise = { resolve, reject }
        this.connectTimeoutId = setTimeout(() => {
          if (this.connectPromise) {
            this.connectPromise.reject(new Error('Connect timeout'))
            this.connectPromise = null
            this.connectTimeoutId = null
          }
        }, CONNECT_TIMEOUT_MS)
      })
    }
  }

  private async sendAnnounce(event: string, stats?: AnnounceStats): Promise<void> {
    if (!this.socket || this.connectionId === null) return

    const url = new URL(this.announceUrl)
    const host = url.hostname
    const port = parseInt(url.port, 10) || 80

    this.transactionId = Math.floor(Math.random() * 0xffffffff)

    const buf = new Uint8Array(98)
    const view = new DataView(buf.buffer)

    view.setBigUint64(0, this.connectionId, false)
    view.setUint32(8, ACTION_ANNOUNCE, false)
    view.setUint32(12, this.transactionId, false)

    buf.set(this.infoHash, 16)
    buf.set(this.peerId, 36)

    const downloaded = BigInt(stats?.downloaded ?? 0)
    const uploaded = BigInt(stats?.uploaded ?? 0)
    // For UDP, left is required. Use a large value when unknown (magnet before metadata)
    // to indicate we need to download. Using 2^62 as a safe large value.
    const left = stats?.left !== null && stats?.left !== undefined ? BigInt(stats.left) : 1n << 62n

    view.setBigUint64(56, downloaded, false)
    view.setBigUint64(64, left, false)
    view.setBigUint64(72, uploaded, false)

    let eventId = 0
    if (event === 'completed') eventId = 1
    if (event === 'started') eventId = 2
    if (event === 'stopped') eventId = 3
    view.setUint32(80, eventId, false)

    view.setUint32(84, 0, false) // IP
    view.setUint32(88, 0, false) // Key
    view.setInt32(92, -1, false) // Num want
    view.setUint16(96, this.engine.listeningPort, false)

    this.socket.send(host, port, buf)
    this.bandwidthTracker?.record('tracker:udp', buf.length, 'up')

    // Wait for announce response with timeout
    return new Promise<void>((resolve, reject) => {
      this.announcePromise = { resolve, reject }
      this.announceTimeoutId = setTimeout(() => {
        if (this.announcePromise) {
          this.announcePromise.reject(new Error('Announce timeout'))
          this.announcePromise = null
          this.announceTimeoutId = null
        }
      }, ANNOUNCE_TIMEOUT_MS)
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onMessage(msg: Uint8Array, _rinfo: any) {
    this.bandwidthTracker?.record('tracker:udp', msg.length, 'down')

    if (msg.length < 8) return
    const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
    const action = view.getUint32(0, false)
    const transactionId = view.getUint32(4, false)

    if (transactionId !== this.transactionId) return

    if (action === ACTION_CONNECT) {
      this.connectionId = view.getBigUint64(8, false)
      this.connectionIdTime = Date.now()
      if (this.connectTimeoutId) {
        clearTimeout(this.connectTimeoutId)
        this.connectTimeoutId = null
      }
      if (this.connectPromise) {
        this.connectPromise.resolve()
        this.connectPromise = null
      }
    } else if (action === ACTION_ANNOUNCE) {
      // Clear announce timeout
      if (this.announceTimeoutId) {
        clearTimeout(this.announceTimeoutId)
        this.announceTimeoutId = null
      }

      // Success - update status and reset failure tracking
      this._status = 'ok'
      this._lastError = null
      this._lastAnnounceTime = Date.now()
      this._consecutiveFailures = 0
      this._lastFailureTime = null

      const interval = view.getUint32(8, false)
      this._interval = interval

      // BEP 15: leechers at offset 12, seeders at offset 16
      if (msg.length >= 20) {
        this._leechers = view.getUint32(12, false)
        this._seeders = view.getUint32(16, false)
      }

      this.logger.info('UdpTracker: Announce response received', {
        interval,
        seeders: this._seeders,
        leechers: this._leechers,
      })

      const peers: PeerInfo[] = []
      for (let i = 20; i + 6 <= msg.length; i += 6) {
        const ip = `${msg[i]}.${msg[i + 1]}.${msg[i + 2]}.${msg[i + 3]}`
        const port = (msg[i + 4] << 8) | msg[i + 5]
        peers.push({ ip, port })
        this._knownPeers.add(`${ip}:${port}`)
      }
      this._lastPeersReceived = peers.length
      if (peers.length > 0) {
        this.emit('peersDiscovered', peers)
      }

      // Resolve the announce promise
      if (this.announcePromise) {
        this.announcePromise.resolve()
        this.announcePromise = null
      }
    } else if (action === ACTION_ERROR) {
      // Clear timeouts
      if (this.connectTimeoutId) {
        clearTimeout(this.connectTimeoutId)
        this.connectTimeoutId = null
      }
      if (this.announceTimeoutId) {
        clearTimeout(this.announceTimeoutId)
        this.announceTimeoutId = null
      }

      const errorMsg = new TextDecoder().decode(msg.slice(8))
      this.logger.error(`UdpTracker: Error response: ${errorMsg}`)
      this._status = 'error'
      this._lastError = errorMsg
      this._consecutiveFailures++
      this._lastFailureTime = Date.now()
      this.emit('error', new Error(errorMsg))
      if (this.connectPromise) {
        this.connectPromise.reject(new Error(errorMsg))
        this.connectPromise = null
      }
      if (this.announcePromise) {
        this.announcePromise.reject(new Error(errorMsg))
        this.announcePromise = null
      }
    }
  }

  getStats(): TrackerStats {
    // Calculate next announce time based on success or failure
    let nextAnnounce: number | null = null
    if (this._lastAnnounceTime && this._status === 'ok') {
      // Success: use normal interval
      nextAnnounce = this._lastAnnounceTime + this._interval * 1000
    } else if (this._lastFailureTime && this._consecutiveFailures > 0) {
      // Failure: use backoff delay
      nextAnnounce = this._lastFailureTime + calculateBackoffMs(this._consecutiveFailures - 1)
    }

    return {
      url: this.announceUrl,
      type: 'udp',
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
    // Clear timeouts
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId)
      this.connectTimeoutId = null
    }
    if (this.announceTimeoutId) {
      clearTimeout(this.announceTimeoutId)
      this.announceTimeoutId = null
    }

    // Reject any pending promises
    if (this.connectPromise) {
      this.connectPromise.reject(new Error('Tracker destroyed'))
      this.connectPromise = null
    }
    if (this.announcePromise) {
      this.announcePromise.reject(new Error('Tracker destroyed'))
      this.announcePromise = null
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    if (this.timer) clearInterval(this.timer)
  }
}
