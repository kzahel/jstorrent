import { EngineComponent } from '../logging/logger'
// BEP 15 Constants
const PROTOCOL_ID = 0x41727101980n // Magic constant
const ACTION_CONNECT = 0
const ACTION_ANNOUNCE = 1
const ACTION_ERROR = 3
export class UdpTracker extends EngineComponent {
  get interval() {
    return this._interval
  }
  constructor(engine, announceUrl, infoHash, peerId, socketFactory, port = 6881) {
    super(engine)
    this.announceUrl = announceUrl
    this.infoHash = infoHash
    this.peerId = peerId
    this.socketFactory = socketFactory
    this.port = port
    this.socket = null
    this.connectionId = null
    this.connectionIdTime = 0
    this.transactionId = 0
    this._interval = 1800
    this.timer = null
    this.connectPromise = null
  }
  async announce(event = 'started') {
    this.logger.info(`UdpTracker: Announcing '${event}' to ${this.announceUrl}`)
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
      await this.sendAnnounce(event)
      this.logger.debug('UdpTracker: Announce packet sent')
    } catch (err) {
      this.emit('error', err)
    }
  }
  async connect(host, port) {
    this.transactionId = Math.floor(Math.random() * 0xffffffff)
    const buf = new Uint8Array(16)
    const view = new DataView(buf.buffer)
    view.setBigUint64(0, PROTOCOL_ID, false)
    view.setUint32(8, ACTION_CONNECT, false)
    view.setUint32(12, this.transactionId, false)
    if (this.socket) {
      this.socket.send(host, port, buf)
      return new Promise((resolve, reject) => {
        this.connectPromise = { resolve, reject }
        setTimeout(() => {
          if (this.connectPromise) {
            this.connectPromise.reject(new Error('Connect timeout'))
            this.connectPromise = null
          }
        }, 5000) // 5 second timeout
      })
    }
  }
  async sendAnnounce(event) {
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
  onMessage(msg, _rinfo) {
    if (msg.length < 8) return
    const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
    const action = view.getUint32(0, false)
    const transactionId = view.getUint32(4, false)
    if (transactionId !== this.transactionId) return
    if (action === ACTION_CONNECT) {
      this.connectionId = view.getBigUint64(8, false)
      this.connectionIdTime = Date.now()
      if (this.connectPromise) {
        this.connectPromise.resolve()
        this.connectPromise = null
      }
    } else if (action === ACTION_ANNOUNCE) {
      const interval = view.getUint32(8, false)
      this._interval = interval
      this.logger.info('UdpTracker: Announce response received', { interval })
      const peers = []
      for (let i = 20; i + 6 <= msg.length; i += 6) {
        const ip = `${msg[i]}.${msg[i + 1]}.${msg[i + 2]}.${msg[i + 3]}`
        const port = (msg[i + 4] << 8) | msg[i + 5]
        peers.push({ ip, port })
      }
      if (peers.length > 0) {
        this.emit('peersDiscovered', peers)
      }
    } else if (action === ACTION_ERROR) {
      const errorMsg = new TextDecoder().decode(msg.slice(8))
      this.logger.error(`UdpTracker: Error response: ${errorMsg}`)
      this.emit('error', new Error(errorMsg))
      if (this.connectPromise) {
        this.connectPromise.reject(new Error(errorMsg))
        this.connectPromise = null
      }
    }
  }
  destroy() {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    if (this.timer) clearInterval(this.timer)
  }
}
UdpTracker.logName = 'udp-tracker'
