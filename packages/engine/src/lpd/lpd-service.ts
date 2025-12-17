import { ISocketFactory, IUdpSocket } from '../interfaces/socket'
import { Logger } from '../logging/logger'
import { InfoHashHex, infoHashFromHex } from '../utils/infohash'

const LPD_MULTICAST = '239.192.152.143'
const LPD_PORT = 6771
const ANNOUNCE_INTERVAL = 5 * 60 * 1000 // 5 minutes

export class LPDService {
  private socket: IUdpSocket | null = null
  private announceInterval: ReturnType<typeof setInterval> | null = null
  private port = 0
  private infoHashes: Set<string> = new Set()
  private onPeerDiscovered: ((infoHash: InfoHashHex, host: string, port: number) => void) | null =
    null

  constructor(
    private socketFactory: ISocketFactory,
    private logger?: Logger,
  ) {}

  async start(listenPort: number): Promise<void> {
    this.port = listenPort
    this.socket = await this.socketFactory.createUdpSocket('0.0.0.0', LPD_PORT)
    await this.socket.joinMulticast(LPD_MULTICAST)

    this.socket.onMessage((src, data) => {
      this.handleMessage(src.addr, data)
    })

    // Start periodic announcements
    this.announceInterval = setInterval(() => {
      this.announceAll()
    }, ANNOUNCE_INTERVAL)

    this.logger?.info(`LPD: Started on port ${listenPort}`)
  }

  stop(): void {
    if (this.announceInterval) {
      clearInterval(this.announceInterval)
      this.announceInterval = null
    }
    if (this.socket) {
      this.socket.leaveMulticast(LPD_MULTICAST)
      this.socket.close()
      this.socket = null
    }
  }

  addInfoHash(infoHash: InfoHashHex): void {
    this.infoHashes.add(infoHash)
    this.announce(infoHash)
  }

  removeInfoHash(infoHash: InfoHashHex): void {
    this.infoHashes.delete(infoHash)
  }

  onPeer(cb: (infoHash: InfoHashHex, host: string, port: number) => void): void {
    this.onPeerDiscovered = cb
  }

  private announce(infoHash: InfoHashHex): void {
    if (!this.socket) return

    const message = [
      'BT-SEARCH * HTTP/1.1',
      `Host: ${LPD_MULTICAST}:${LPD_PORT}`,
      `Port: ${this.port}`,
      `Infohash: ${infoHash}`,
      '',
      '',
    ].join('\r\n')

    this.socket.send(LPD_MULTICAST, LPD_PORT, new TextEncoder().encode(message))
  }

  private announceAll(): void {
    for (const infoHash of this.infoHashes) {
      this.announce(infoHash as InfoHashHex)
    }
  }

  private handleMessage(fromHost: string, data: Uint8Array): void {
    const message = new TextDecoder().decode(data)

    if (!message.startsWith('BT-SEARCH')) return

    const headers: Record<string, string> = {}
    for (const line of message.split('\r\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/)
      if (match) {
        headers[match[1].toLowerCase()] = match[2]
      }
    }

    const infoHashRaw = headers.infohash
    const portStr = headers.port
    const port = parseInt(portStr, 10)

    if (!infoHashRaw || !portStr || isNaN(port)) return

    // Validate and normalize the info hash
    let infoHash: InfoHashHex
    try {
      infoHash = infoHashFromHex(infoHashRaw)
    } catch {
      // Invalid info hash format, ignore
      return
    }

    // Only notify if we're interested in this torrent
    if (this.infoHashes.has(infoHash) && this.onPeerDiscovered) {
      this.logger?.debug(`LPD: Discovered peer ${fromHost}:${port} for ${infoHash.slice(0, 8)}`)
      this.onPeerDiscovered(infoHash, fromHost, port)
    }
  }
}
