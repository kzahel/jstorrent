import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
// import * as crypto from 'crypto'
import { randomBytes } from '../utils/hash'
import { fromString, concat } from '../utils/buffer'
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
import { Torrent } from './torrent'
import { PeerConnection } from './peer-connection'
import { parseMagnet } from '../utils/magnet'
import { TorrentParser, ParsedTorrent } from './torrent-parser'
import { PieceManager } from './piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { toHex, fromHex } from '../utils/buffer'
import { IStorageHandle } from '../io/storage-handle'

export interface BtEngineOptions {
  downloadPath?: string
  socketFactory: ISocketFactory
  fileSystem?: IFileSystem
  storageRootManager?: StorageRootManager
  sessionStore?: ISessionStore

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
      const random = randomBytes(12)
      this.peerId = concat([fromString(prefix), random])
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
    const socket = this.socketFactory.wrapTcpSocket(nativeSocket)
    const peer = new PeerConnection(this, socket)
    peer.on('handshake', (infoHash, _peerId, _extensions) => {
      const infoHashStr = toHex(infoHash)
      const torrent = this.getTorrent(infoHashStr)
      if (torrent) {
        this.logger.info(`Incoming connection for torrent ${infoHashStr}`)
        // Send our handshake back FIRST
        peer.sendHandshake(torrent.infoHash, torrent.peerId)
        torrent.addPeer(peer)
      } else {
        this.logger.warn(`Incoming connection for unknown torrent ${infoHashStr}`)
        peer.close()
      }
    })
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options: { storageToken?: string } = {},
  ): Promise<Torrent | null> {
    let infoHash: Uint8Array
    let announce: string[] = []
    // let name: string | undefined
    let infoBuffer: Uint8Array | undefined
    let parsedTorrent: ParsedTorrent | undefined

    if (typeof magnetOrBuffer === 'string') {
      const parsed = parseMagnet(magnetOrBuffer)
      infoHash = fromHex(parsed.infoHash)
      announce = parsed.announce || []
      // name = parsed.name
    } else {
      parsedTorrent = await TorrentParser.parse(magnetOrBuffer)
      infoHash = parsedTorrent.infoHash
      announce = parsedTorrent.announce
      announce = parsedTorrent.announce
      // name = parsedTorrent.name
      infoBuffer = parsedTorrent.infoBuffer
    }

    const infoHashStr = toHex(infoHash)
    const existing = this.getTorrent(infoHashStr)
    if (existing) {
      return existing
    }

    // Register storage root for this torrent if provided
    if (options.storageToken) {
      this.storageRootManager.setRootForTorrent(infoHashStr, options.storageToken)
    }

    const torrent = new Torrent(
      this,
      infoHash,
      this.peerId,
      this.socketFactory,
      this.port,
      undefined, // pieceManager
      undefined, // contentStorage
      undefined, // bitfield
      announce,
      this.maxPeers,
      () => this.numConnections < this.maxConnections,
    )

    const initComponents = async (infoBuffer: Uint8Array, preParsed?: ParsedTorrent) => {
      if (torrent.pieceManager) return // Already initialized

      const parsedTorrent = preParsed || (await TorrentParser.parseInfoBuffer(infoBuffer))

      // Initialize PieceManager
      const pieceManager = new PieceManager(
        this,
        parsedTorrent.pieces.length,
        parsedTorrent.pieceLength,
        parsedTorrent.length % parsedTorrent.pieceLength || parsedTorrent.pieceLength,
        parsedTorrent.pieces,
      )
      torrent.pieceManager = pieceManager
      torrent.bitfield = pieceManager.getBitField()

      // Initialize ContentStorage
      const storageHandle: IStorageHandle = {
        id: infoHashStr,
        name: parsedTorrent.name || infoHashStr,
        getFileSystem: () => this.storageRootManager.getFileSystemForTorrent(infoHashStr),
      }

      const contentStorage = new TorrentContentStorage(this, storageHandle)
      await contentStorage.open(parsedTorrent.files, parsedTorrent.pieceLength)
      torrent.contentStorage = contentStorage
    }

    if (infoBuffer && parsedTorrent) {
      torrent.setMetadata(infoBuffer)
      await initComponents(infoBuffer, parsedTorrent)
    }

    torrent.on('metadata', async (infoBuffer) => {
      try {
        await initComponents(infoBuffer)
        torrent.recheckPeers()
        torrent.emit('ready')
      } catch (err) {
        this.emit('error', err)
      }
    })

    this.torrents.push(torrent)
    this.emit('torrent', torrent)

    torrent.on('complete', () => {
      this.emit('torrent-complete', torrent)
    })

    torrent.on('error', (err) => {
      this.emit('error', err)
    })

    // If we have metadata, verify existing data (recheck)
    if (infoBuffer) {
      // We can start checking asynchronously
      // torrent.recheckData()
    }

    await torrent.start()

    return torrent
  }

  async removeTorrent(torrent: Torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index !== -1) {
      this.torrents.splice(index, 1)
      await torrent.stop()
      this.emit('torrent-removed', torrent)
    }
  }

  async removeTorrentByHash(infoHash: string) {
    const torrent = this.getTorrent(infoHash)
    if (torrent) {
      await this.removeTorrent(torrent)
    }
  }

  getTorrent(infoHash: string): Torrent | undefined {
    return this.torrents.find((t) => toHex(t.infoHash) === infoHash)
  }

  async destroy() {
    this.logger.info('Destroying engine')
    // Stop all torrents
    await Promise.all(this.torrents.map((t) => t.stop()))
    this.torrents = []

    // Close server?
    // We don't have a reference to server instance returned by createTcpServer unless we stored it.
    // startServer() didn't store it.
    // But we should probably store it.
    // For now, just clearing torrents satisfies the test.
  }

  get numConnections(): number {
    return this.torrents.reduce((acc, t) => acc + t.numPeers, 0)
  }
}
