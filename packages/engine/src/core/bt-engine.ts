import { EventEmitter } from 'events'
import { Torrent } from './torrent'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { TorrentParser } from './torrent-parser'
import { Bencode } from '../utils/bencode'
import { FileSystemStorageHandle } from '../io/filesystem-storage-handle'
import { areInfoHashesEqual, toInfoHashString } from '../utils/infohash'
import { parseMagnet } from '../utils/magnet'
import { PieceManager } from './piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { PeerConnection } from './peer-connection'
import * as crypto from 'crypto'
import {
  ILoggingEngine,
  Logger,
  EngineLoggingConfig,
  defaultLogger,
  createFilter,
  randomClientId,
  withScopeAndFiltering,
  EngineComponent,
  ShouldLogFn,
} from '../logging/logger'

export interface StorageResolver {
  resolve(rootKey: string, torrentId: string): string
}

export interface BtEngineOptions {
  downloadPath: string
  socketFactory: ISocketFactory
  fileSystem: IFileSystem
  storageResolver?: StorageResolver
  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
  peerId?: string // Optional custom peerId
  port?: number // Listening port to announce
  logging?: EngineLoggingConfig
}

export class BtEngine extends EventEmitter implements ILoggingEngine {
  public torrents: Torrent[] = []
  private fileSystem: IFileSystem
  private socketFactory: ISocketFactory
  public peerId: Uint8Array
  public port: number

  public readonly clientId: string
  private rootLogger: Logger
  private filterFn: ShouldLogFn

  constructor(options: BtEngineOptions) {
    super()
    this.fileSystem = options.fileSystem
    this.socketFactory = options.socketFactory
    this.port = options.port ?? 6881 // Use nullish coalescing to allow port 0

    this.clientId = randomClientId()
    this.rootLogger = defaultLogger()
    this.filterFn = createFilter(options.logging ?? { level: 'info' })

    if (options.peerId) {
      this.peerId = Buffer.from(options.peerId)
    } else {
      // Generate random peerId: -JS0001- + 12 random bytes
      const prefix = '-JS0001-'
      const random = crypto.randomBytes(12)
      this.peerId = Buffer.concat([Buffer.from(prefix), random])
    }

    this.startServer()
  }

  scopedLoggerFor(component: EngineComponent): Logger {
    return withScopeAndFiltering(this.rootLogger, component, this.filterFn)
  }

  private startServer() {
    try {
      const server = this.socketFactory.createTcpServer()
      if (server && typeof server.listen === 'function') {
        server.listen(this.port, () => {
          // Get the actual bound port (important when port was 0 for auto-assign)
          const addr = server.address()
          if (addr && typeof addr === 'object' && 'port' in addr) {
            this.port = addr.port
          }
          console.log(`BtEngine listening on port ${this.port}`)
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        server.on('connection', (socket: any) => {
          this.handleIncomingConnection(socket)
        })
      }
    } catch (err) {
      console.warn('Failed to start server:', err)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleIncomingConnection(nativeSocket: any) {
    try {
      const socket = this.socketFactory.wrapTcpSocket(nativeSocket)
      // We don't know the remote address/port easily from ITcpSocket interface if not exposed.
      // But PeerConnection might need it.
      // NodeTcpSocket doesn't expose it.
      // However, PeerConnection uses it for logging mostly.
      // Let's try to extract it if possible or use placeholders.
      const remoteAddress = nativeSocket.remoteAddress || 'unknown'
      const remotePort = nativeSocket.remotePort || 0

      const peer = new PeerConnection(this, socket, {
        remoteAddress,
        remotePort,
      })

      // Wait for handshake
      peer.on('handshake', (infoHash: Uint8Array, _peerId: Uint8Array) => {
        const hex = toInfoHashString(infoHash)
        const torrent = this.getTorrent(hex)
        if (torrent) {
          console.log(`BtEngine: Incoming connection for torrent ${hex}`)
          torrent.addPeer(peer)
          // Send handshake back
          peer.sendHandshake(torrent.infoHash, torrent.peerId)
          // Send bitfield
          if (torrent.bitfield) {
            peer.sendMessage(5, torrent.bitfield.toBuffer()) // 5 = BITFIELD
          }
        } else {
          console.warn(`BtEngine: Incoming connection for unknown torrent ${hex}`)
          peer.close()
        }
      })

      // Timeout if no handshake?
    } catch (err) {
      console.error('BtEngine: Error handling incoming connection', err)
    }
  }

  async addTorrent(magnetOrBuffer: string | Uint8Array, _options: unknown = {}): Promise<Torrent> {
    let parsed
    let magnetInfo
    if (magnetOrBuffer instanceof Uint8Array) {
      parsed = TorrentParser.parse(magnetOrBuffer)
    } else if (typeof magnetOrBuffer === 'string' && magnetOrBuffer.startsWith('magnet:')) {
      magnetInfo = parseMagnet(magnetOrBuffer)
    } else {
      throw new Error('Invalid torrent source')
    }

    if (parsed) {
      const pieceManager = new PieceManager(
        this,
        Math.ceil(parsed.length / parsed.pieceLength),
        parsed.pieceLength,
        parsed.length % parsed.pieceLength || parsed.pieceLength,
        parsed.pieces,
      )

      const storageHandle = new FileSystemStorageHandle(this.fileSystem)
      const contentStorage = new TorrentContentStorage(storageHandle)
      await contentStorage.open(parsed.files, parsed.pieceLength)

      const bitfield = pieceManager.getBitField()

      const torrent = new Torrent(
        this,
        parsed.infoHash,
        this.peerId,
        this.socketFactory,
        this.port,
        pieceManager,
        contentStorage,
        bitfield,
        parsed.announce,
      )

      if (parsed.infoBuffer) {
        torrent.setMetadata(parsed.infoBuffer)
      }

      this.torrents.push(torrent)
      this.emit('torrent', torrent)

      torrent.on('complete', () => {
        this.emit('torrent-complete', torrent)
      })

      torrent.on('error', (err) => {
        this.emit('error', err)
      })

      // Start the torrent (starts tracker)
      torrent.start()

      return torrent
    } else if (magnetInfo) {
      const infoHashBuffer = Buffer.from(magnetInfo.infoHash, 'hex')
      const torrent = new Torrent(
        this,
        infoHashBuffer,
        this.peerId,
        this.socketFactory,
        this.port,
        undefined,
        undefined,
        undefined,
        magnetInfo.announce,
      )

      this.torrents.push(torrent)
      this.emit('torrent', torrent)

      torrent.on('error', (err) => {
        this.emit('error', err)
      })

      torrent.on('metadata', async (metadataBuffer: Uint8Array) => {
        try {
          console.error('BtEngine: Metadata received, initializing torrent')
          const info = Bencode.decode(metadataBuffer)
          const parsed = TorrentParser.parseInfoDictionary(
            info,
            torrent.infoHash,
            undefined,
            undefined,
          )

          // Initialize PieceManager
          const pieceManager = new PieceManager(
            this,
            Math.ceil(parsed.length / parsed.pieceLength),
            parsed.pieceLength,
            parsed.length % parsed.pieceLength || parsed.pieceLength,
            parsed.pieces,
          )

          // Initialize ContentStorage
          const storageHandle = new FileSystemStorageHandle(this.fileSystem)
          const contentStorage = new TorrentContentStorage(storageHandle)
          await contentStorage.open(parsed.files, parsed.pieceLength)

          const bitfield = pieceManager.getBitField()

          // Update torrent
          torrent.pieceManager = pieceManager
          torrent.contentStorage = contentStorage
          torrent.bitfield = bitfield

          // If we had announce URLs from magnet, we keep them.
          // If metadata has announce, we might want to merge or prefer magnet?
          // Usually magnet takes precedence or we merge.
          // For now, keep existing.

          console.error('BtEngine: Torrent initialized from metadata')
          this.emit('torrent-ready', torrent) // New event?

          // Start verification or download?
          // We should probably check existing files if any.
          await torrent.recheckData()
        } catch (err) {
          console.error('BtEngine: Error initializing torrent from metadata', err)
          this.emit('error', err)
        }
      })

      // Start the torrent (starts tracker)
      torrent.start()

      return torrent
    }

    throw new Error('Should not happen')
  }

  // Simplified add for testing/verification with existing components
  addTorrentInstance(torrent: Torrent) {
    this.torrents.push(torrent)
    this.emit('torrent', torrent)

    torrent.on('complete', () => {
      this.emit('torrent-complete', torrent)
    })

    torrent.on('error', (err) => {
      this.emit('error', err)
    })

    // Start if not already started?
    // torrent.start()
  }

  removeTorrent(torrent: Torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index !== -1) {
      this.torrents.splice(index, 1)
      torrent.stop() // Assuming Torrent has a stop method
      this.emit('torrent-removed', torrent)
    }
  }

  removeTorrentByHash(infoHash: string) {
    const torrent = this.getTorrent(infoHash)
    if (torrent) {
      this.removeTorrent(torrent)
    }
  }

  getTorrent(infoHash: string): Torrent | undefined {
    // infoHash string hex
    return this.torrents.find((t) => {
      const hex = toInfoHashString(t.infoHash)
      return areInfoHashesEqual(hex, infoHash)
    })
  }

  destroy() {
    this.torrents.forEach((t) => t.stop())
    this.torrents = []
  }
}
