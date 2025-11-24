import { EventEmitter } from 'events'
import { Torrent } from './torrent'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { TorrentParser } from './torrent-parser'
import { FileSystemStorageHandle } from '../io/filesystem-storage-handle'

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

  async addTorrent(magnetOrBuffer: string | Uint8Array, _options: any = {}): Promise<Torrent> {
    let parsed
    if (magnetOrBuffer instanceof Uint8Array) {
      parsed = TorrentParser.parse(magnetOrBuffer)
    } else if (typeof magnetOrBuffer === 'string' && magnetOrBuffer.startsWith('magnet:')) {
      throw new Error('Magnet links not yet supported')
    } else {
      throw new Error('Invalid torrent source')
    }

    const { PieceManager } = await import('./piece-manager')
    const { TorrentContentStorage } = await import('./torrent-content-storage')
    const { BitField } = await import('../utils/bitfield')

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

    const torrent = new Torrent(parsed.infoHash, pieceManager, contentStorage, bitfield)

    this.torrents.push(torrent)
    this.emit('torrent', torrent)

    torrent.on('complete', () => {
      this.emit('torrent-complete', torrent)
    })

    torrent.on('error', (err) => {
      this.emit('error', err)
    })

    return torrent
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

  getTorrent(infoHash: string): Torrent | undefined {
    // infoHash string hex
    return this.torrents.find((t) => {
      const hex = Array.from(t.infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      return hex === infoHash
    })
  }

  destroy() {
    this.torrents.forEach((t) => t.stop())
    this.torrents = []
  }
}
