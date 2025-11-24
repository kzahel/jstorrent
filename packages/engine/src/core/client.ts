import { EventEmitter } from 'events'
import { Torrent } from './torrent'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { TorrentParser } from './torrent-parser'
import { FileSystemStorageHandle } from '../io/filesystem-storage-handle'
import { areInfoHashesEqual, toInfoHashString } from '../utils/infohash'
import { parseMagnet } from '../utils/magnet'
import { PieceManager } from './piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { BitField } from '../utils/bitfield'

export interface ClientOptions {
  downloadPath: string
  socketFactory: ISocketFactory
  fileSystem: IFileSystem
  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
}

export class Client extends EventEmitter {
  public torrents: Torrent[] = []
  private fileSystem: IFileSystem
  //private socketFactory: ISocketFactory

  constructor(options: ClientOptions) {
    super()
    this.fileSystem = options.fileSystem
    //this.socketFactory = options.socketFactory
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
        Math.ceil(parsed.length / parsed.pieceLength),
        parsed.pieceLength,
        parsed.length % parsed.pieceLength || parsed.pieceLength,
        parsed.pieces,
      )

      const storageHandle = new FileSystemStorageHandle(this.fileSystem)
      const contentStorage = new TorrentContentStorage(storageHandle)
      await contentStorage.open(parsed.files, parsed.pieceLength)

      const bitfield = new BitField(pieceManager.getPieceCount())

      const torrent = new Torrent(
        parsed.infoHash,
        pieceManager,
        contentStorage,
        bitfield,
        parsed.announce,
      )

      this.torrents.push(torrent)
      this.emit('torrent', torrent)

      torrent.on('complete', () => {
        this.emit('torrent-complete', torrent)
      })

      torrent.on('error', (err) => {
        this.emit('error', err)
      })

      return torrent
    } else if (magnetInfo) {
      const infoHashBuffer = Buffer.from(magnetInfo.infoHash, 'hex')
      const torrent = new Torrent(
        infoHashBuffer,
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
