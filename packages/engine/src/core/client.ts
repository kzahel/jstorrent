import { EventEmitter } from 'events'
import { Torrent } from './torrent'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'

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

  constructor(_options: ClientOptions) {
    super()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addTorrent(_magnetOrBuffer: string | Uint8Array, _options: any = {}): Promise<Torrent> {
    // For now, we assume magnet link or buffer is handled by Torrent constructor or a factory
    // But Torrent constructor takes infoHash, etc.
    // We need a way to parse metadata first.
    // For this phase, let's assume we pass a Torrent instance or enough info to create one.
    // Actually, `Torrent` class currently takes `peerId`, `infoHash`, `pieceManager`, `diskManager`, `socketFactory`.
    // The Client should probably orchestrate the creation of these dependencies.

    // We need a Metadata parser (magnet or .torrent file).
    // That's missing from our current implementation plan/codebase.
    // For now, I'll create a placeholder for adding a torrent where we pass pre-calculated infoHash and piece count.
    // In a real app, we'd parse the .torrent file here.

    throw new Error('Not implemented: Metadata parsing needed')
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
