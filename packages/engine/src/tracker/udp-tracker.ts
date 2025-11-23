import { ITracker, TrackerAnnounceEvent } from '../interfaces/tracker'
import { IUdpSocket, ISocketFactory } from '../interfaces/socket'
import { EventEmitter } from 'events'

// BEP 15 Constants
const PROTOCOL_ID = 0x41727101980n // Magic constant
const ACTION_CONNECT = 0
const ACTION_ANNOUNCE = 1
const ACTION_ERROR = 3

export class UdpTracker extends EventEmitter implements ITracker {
  private socket: IUdpSocket | null = null
  private connectionId: bigint | null = null
  private transactionId: number = 0
  private _interval: number = 1800

  get interval(): number {
    return this._interval
  }
  private timer: NodeJS.Timeout | null = null

  constructor(
    private announceUrl: string,
    private infoHash: Uint8Array,
    private peerId: Uint8Array,
    private socketFactory: ISocketFactory,
    private port: number = 6881,
  ) {
    super()
  }

  async announce(event: TrackerAnnounceEvent = 'started'): Promise<void> {
    try {
      if (!this.socket) {
        // Parse host/port from URL
        const url = new URL(this.announceUrl)
        // UDP tracker URL format: udp://tracker.example.com:80
        const host = url.hostname
        const port = parseInt(url.port, 10) || 80

        this.socket = await this.socketFactory.createUdpSocket()
        // Bind? Usually we bind to 0.0.0.0:0 (random port) or specific port if we want to listen
        // For tracker client, random port is fine.
        // But we need to send to the tracker.

        // We need to listen for responses.
        this.socket.onMessage((rinfo, msg) => {
          this.onMessage(msg, rinfo)
        })

        // Connect phase
        await this.connect(host, port)
      }

      // Announce phase
      await this.sendAnnounce(event)
    } catch (err) {
      this.emit('error', err)
    }
  }

  private connectPromise: { resolve: () => void; reject: (err: Error) => void } | null = null

  private async connect(host: string, port: number): Promise<void> {
    // Send Connect Request
    // Offset  Size    Name            Value
    // 0       64-bit integer  protocol_id     0x41727101980
    // 8       32-bit integer  action          0 // connect
    // 12      32-bit integer  transaction_id

    this.transactionId = Math.floor(Math.random() * 0xffffffff)
    const buf = new Uint8Array(16)
    const view = new DataView(buf.buffer)
    view.setBigUint64(0, PROTOCOL_ID, false) // Big-endian
    view.setUint32(8, ACTION_CONNECT, false)
    view.setUint32(12, this.transactionId, false)

    if (this.socket) {
      this.socket.send(host, port, buf)

      // Wait for response (simplified)
      // In real implementation we need a proper state machine to handle timeouts and retries
      // For now, we assume handleMessage sets connectionId
      // We can wrap this in a promise that resolves when connectionId is set
      return new Promise<void>((resolve, reject) => {
        this.connectPromise = { resolve, reject }
        // Timeout
        setTimeout(() => {
          if (this.connectPromise) {
            this.connectPromise.reject(new Error('Connect timeout'))
            this.connectPromise = null
          }
        }, 5000)
      })
    }
  }

  private async sendAnnounce(event: string) {
    if (!this.socket || this.connectionId === null) return

    const url = new URL(this.announceUrl)
    const host = url.hostname
    const port = parseInt(url.port, 10) || 80

    // Offset  Size    Name            Value
    // 0       64-bit integer  connection_id
    // 8       32-bit integer  action          1 // announce
    // 12      32-bit integer  transaction_id
    // 16      20-byte string  info_hash
    // 36      20-byte string  peer_id
    // 56      64-bit integer  downloaded
    // 64      64-bit integer  left
    // 72      64-bit integer  uploaded
    // 80      32-bit integer  event           0: none; 1: completed; 2: started; 3: stopped
    // 84      32-bit integer  IP address      0 // default
    // 88      32-bit integer  key
    // 92      32-bit integer  num_want        -1 // default
    // 96      16-bit integer  port

    const buf = new Uint8Array(98)
    const view = new DataView(buf.buffer)

    view.setBigUint64(0, this.connectionId, false)
    view.setUint32(8, ACTION_ANNOUNCE, false)
    view.setUint32(12, this.transactionId, false)

    buf.set(this.infoHash, 16)
    buf.set(this.peerId, 36)

    view.setBigUint64(56, 0n, false) // downloaded
    view.setBigUint64(64, 0n, false) // left
    view.setBigUint64(72, 0n, false) // uploaded

    let eventId = 0
    if (event === 'completed') eventId = 1
    if (event === 'started') eventId = 2
    if (event === 'stopped') eventId = 3
    view.setUint32(80, eventId, false)

    view.setUint32(84, 0, false) // IP
    view.setUint32(88, 0, false) // Key
    view.setInt32(92, -1, false) // Num want
    view.setUint16(96, this.port, false)

    this.socket.send(host, port, buf)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onMessage(msg: Uint8Array, _rinfo: any) {
    if (msg.length < 8) return
    const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
    const action = view.getUint32(0, false)
    const transactionId = view.getUint32(4, false)

    if (transactionId !== this.transactionId) return // Ignore mismatch

    if (action === ACTION_CONNECT) {
      this.connectionId = view.getBigUint64(8, false)
      if (this.connectPromise) {
        this.connectPromise.resolve()
        this.connectPromise = null
      }
    } else if (action === ACTION_ANNOUNCE) {
      const interval = view.getUint32(8, false)
      view.getUint32(12, false)
      view.getUint32(16, false)
      this._interval = interval

      // Peers start at offset 20
      // Each peer is 6 bytes (IP + Port)
      for (let i = 20; i < msg.length; i += 6) {
        if (i + 6 > msg.length) break
        const ip = `${msg[i]}.${msg[i + 1]}.${msg[i + 2]}.${msg[i + 3]}`
        const port = (msg[i + 4] << 8) | msg[i + 5]
        this.emit('peer', { ip, port })
      }
    } else if (action === ACTION_ERROR) {
      const errorMsg = new TextDecoder().decode(msg.slice(8))
      this.emit('error', new Error(errorMsg))
    }
  }

  destroy(): void {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    if (this.timer) clearInterval(this.timer)
  }
}
