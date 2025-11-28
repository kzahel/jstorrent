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
  ShouldLogFn,
  ILoggableComponent,
  LogEntry,
} from '../logging/logger'

import { ISessionStore } from '../interfaces/session-store'
import { MemorySessionStore } from '../adapters/memory/memory-session-store'
import { StorageRootManager } from '../storage/storage-root-manager'

/** @deprecated Use StorageRootManager instead */
export interface StorageResolver {
  resolve(rootKey: string, torrentId: string): string
}

export interface BtEngineOptions {
  downloadPath?: string
  socketFactory: ISocketFactory
  fileSystem?: IFileSystem
  storageRootManager?: StorageRootManager
  sessionStore?: ISessionStore
  storageResolver?: StorageResolver
  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
  peerId?: string // Optional custom peerId
  port?: number // Listening port to announce
  logging?: EngineLoggingConfig
  maxPeers?: number
  onLog?: (entry: LogEntry) => void
}

export class BtEngine extends EventEmitter implements ILoggingEngine, ILoggableComponent {
  public readonly storageRootManager: StorageRootManager
  public readonly socketFactory: ISocketFactory
  public readonly sessionStore: ISessionStore
  public torrents: Torrent[] = []
  public port: number
  public peerId: Uint8Array

  public readonly clientId: string
  private rootLogger: Logger
  private logger: Logger
  private filterFn: ShouldLogFn
  public maxConnections: number
  public maxPeers: number

  // ILoggableComponent implementation
  static logName = 'client'
  getLogName(): string {
    return BtEngine.logName
  }
  getStaticLogName(): string {
    return BtEngine.logName
  }
  get engineInstance(): ILoggingEngine {
    return this
  }

  constructor(options: BtEngineOptions) {
    super()
    this.socketFactory = options.socketFactory

    if (options.storageRootManager) {
      this.storageRootManager = options.storageRootManager
    } else if (options.fileSystem && options.downloadPath) {
      // Legacy support: wrap single filesystem in StorageRootManager
      this.storageRootManager = new StorageRootManager(() => options.fileSystem!)
      this.storageRootManager.addRoot({
        token: 'default',
        label: 'Default',
        path: options.downloadPath,
      })
      this.storageRootManager.setDefaultRoot('default')
    } else {
      throw new Error('BtEngine requires storageRootManager or fileSystem + downloadPath')
    }
    this.sessionStore = options.sessionStore ?? new MemorySessionStore()
    this.port = options.port ?? 6881 // Use nullish coalescing to allow port 0

    this.clientId = randomClientId()

    let logger = defaultLogger()
    if (options.onLog) {
      const base = logger
      const onLog = options.onLog
      logger = {
        debug: (msg, ...args) => {
          onLog({ timestamp: Date.now(), level: 'debug', message: msg, args })
          base.debug(msg, ...args)
        },
        info: (msg, ...args) => {
          onLog({ timestamp: Date.now(), level: 'info', message: msg, args })
          base.info(msg, ...args)
        },
        warn: (msg, ...args) => {
          onLog({ timestamp: Date.now(), level: 'warn', message: msg, args })
          base.warn(msg, ...args)
        },
        error: (msg, ...args) => {
          onLog({ timestamp: Date.now(), level: 'error', message: msg, args })
          base.error(msg, ...args)
        },
      }
    }
    this.rootLogger = logger

    this.filterFn = createFilter(options.logging ?? { level: 'info' })
    this.maxConnections = options.maxConnections ?? 100
    this.maxPeers = options.maxPeers ?? 50

    // Initialize logger for BtEngine itself
    this.logger = this.scopedLoggerFor(this)

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

  scopedLoggerFor(component: ILoggableComponent): Logger {
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
          this.logger.info(`BtEngine listening on port ${this.port}`)
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        server.on('connection', (socket: any) => {
          this.handleIncomingConnection(socket)
        })
      }
    } catch (err) {
      this.logger.warn('Failed to start server:', { error: err })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleIncomingConnection(nativeSocket: any) {
    try {
      if (this.numConnections >= this.maxConnections) {
        this.logger.warn('BtEngine: Rejecting incoming connection, max connections reached')
        if (nativeSocket.destroy) nativeSocket.destroy()
        else if (nativeSocket.end) nativeSocket.end()
        return
      }

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
          this.logger.info(`BtEngine: Incoming connection for torrent ${hex}`)
          torrent.addPeer(peer)
          // Send handshake back
          peer.sendHandshake(torrent.infoHash, torrent.peerId)
          // Send bitfield
          if (torrent.bitfield) {
            peer.sendMessage(5, torrent.bitfield.toBuffer()) // 5 = BITFIELD
          }
        } else {
          this.logger.warn(`BtEngine: Incoming connection for unknown torrent ${hex}`)
          peer.close()
        }
      })

      // Timeout if no handshake?
    } catch (err) {
      this.logger.error('BtEngine: Error handling incoming connection', { error: err })
    }
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options: { storageToken?: string } = {},
  ): Promise<Torrent> {
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

      const infoHashStr = Buffer.from(parsed.infoHash).toString('hex')

      if (options.storageToken) {
        this.storageRootManager.setRootForTorrent(infoHashStr, options.storageToken)
      }

      const fileSystem = this.storageRootManager.getFileSystemForTorrent(infoHashStr)
      const storageHandle = new FileSystemStorageHandle(fileSystem)
      const contentStorage = new TorrentContentStorage(this, storageHandle)
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
        this.maxPeers,
        () => this.numConnections < this.maxConnections,
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

      if (options.storageToken) {
        this.storageRootManager.setRootForTorrent(magnetInfo.infoHash, options.storageToken)
      }

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
        this.maxPeers,
        () => this.numConnections < this.maxConnections,
      )

      this.torrents.push(torrent)
      this.emit('torrent', torrent)

      torrent.on('error', (err) => {
        this.emit('error', err)
      })

      torrent.on('metadata', async (metadataBuffer: Uint8Array) => {
        try {
          this.logger.info('BtEngine: Metadata received, initializing torrent')
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
          const infoHashStr = Buffer.from(torrent.infoHash).toString('hex')

          // Note: storageToken from options is not available here in the callback easily unless we capture it.
          // But we set it in setRootForTorrent above if provided.
          // Wait, we didn't set it for magnet flow yet.
          // We should set it before creating torrent.

          const fileSystem = this.storageRootManager.getFileSystemForTorrent(infoHashStr)
          const storageHandle = new FileSystemStorageHandle(fileSystem)
          const contentStorage = new TorrentContentStorage(this, storageHandle)
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

          this.logger.info('BtEngine: Torrent initialized from metadata')
          this.emit('torrent-ready', torrent) // New event?

          // Start verification or download?
          // We should probably check existing files if any.
          await torrent.recheckData()
        } catch (err) {
          this.logger.error('BtEngine: Error initializing torrent from metadata', { error: err })
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
    for (const torrent of this.torrents) {
      torrent.stop()
    }
    this.torrents = []
  }

  get numConnections(): number {
    return this.torrents.reduce((acc, t) => acc + t.numPeers, 0)
  }
}
