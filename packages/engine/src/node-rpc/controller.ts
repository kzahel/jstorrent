import { BtEngine, BtEngineOptions } from '../core/bt-engine'
import { Torrent } from '../core/torrent'
import { toInfoHashString } from '../utils/infohash'
import { createNodeEngineEnvironment } from './create-node-env'

export interface EngineStatus {
  ok: boolean
  running: boolean
  version?: string
  port?: number
  torrents?: Array<{ id: string; state: string }>
}

export interface TorrentStatus {
  ok: boolean
  id: string
  state: string
  progress: number
  downloadRate: number
  uploadRate: number
  peers: number
}

export class EngineController {
  private engine: BtEngine | null = null

  constructor() {}

  startEngine(config: Partial<BtEngineOptions> = {}): void {
    if (this.engine) {
      throw new Error('EngineAlreadyRunning')
    }

    const options = createNodeEngineEnvironment(config)
    this.engine = new BtEngine(options)
  }

  stopEngine(): void {
    if (!this.engine) {
      throw new Error('EngineNotRunning')
    }
    this.engine.destroy()
    this.engine = null
  }

  getEngineStatus(): EngineStatus {
    if (!this.engine) {
      return { ok: true, running: false }
    }

    const torrents = this.engine.torrents.map((t) => ({
      id: toInfoHashString(t.infoHash),
      state: 'active', // Simplified for now
    }))

    return {
      ok: true,
      running: true,
      version: '1.0.0', // Placeholder
      port: this.engine.port,
      torrents,
    }
  }

  async addTorrent(params: {
    type: string
    data: string
    storagePath?: string
  }): Promise<{ ok: boolean; id: string }> {
    if (!this.engine) {
      throw new Error('EngineNotRunning')
    }

    let torrent: Torrent
    if (params.type === 'magnet') {
      torrent = await this.engine.addTorrent(params.data)
    } else if (params.type === 'file') {
      // data is base64 encoded buffer
      const buffer = Buffer.from(params.data, 'base64')
      torrent = await this.engine.addTorrent(buffer)
    } else {
      throw new Error('Invalid torrent type')
    }

    return { ok: true, id: toInfoHashString(torrent.infoHash) }
  }

  getTorrentStatus(id: string): TorrentStatus {
    if (!this.engine) {
      throw new Error('EngineNotRunning')
    }

    const torrent = this.engine.getTorrent(id)
    if (!torrent) {
      throw new Error('TorrentNotFound')
    }

    // Get actual status from torrent
    return {
      ok: true,
      id,
      state: torrent.progress >= 1.0 ? 'seeding' : 'downloading',
      progress: torrent.progress,
      downloadRate: 0, // TODO: implement actual rate tracking
      uploadRate: 0, // TODO: implement actual rate tracking
      peers: torrent.numPeers,
    }
  }

  pauseTorrent(id: string): void {
    if (!this.engine) throw new Error('EngineNotRunning')
    const torrent = this.engine.getTorrent(id)
    if (!torrent) throw new Error('TorrentNotFound')
    // torrent.pause() // Not implemented in BtEngine yet?
  }

  resumeTorrent(id: string): void {
    if (!this.engine) throw new Error('EngineNotRunning')
    const torrent = this.engine.getTorrent(id)
    if (!torrent) throw new Error('TorrentNotFound')
    // torrent.resume() // Not implemented in BtEngine yet?
  }

  removeTorrent(id: string): void {
    if (!this.engine) throw new Error('EngineNotRunning')
    this.engine.removeTorrentByHash(id)
  }

  async addPeer(torrentId: string, ip: string, port: number): Promise<void> {
    if (!this.engine) throw new Error('EngineNotRunning')
    const torrent = this.engine.getTorrent(torrentId)
    if (!torrent) throw new Error('TorrentNotFound')

    // Connect to peer
    await torrent.connectToPeer({ ip, port })
  }

  async recheckTorrent(id: string): Promise<void> {
    if (!this.engine) throw new Error('EngineNotRunning')
    const torrent = this.engine.getTorrent(id)
    if (!torrent) throw new Error('TorrentNotFound')

    await torrent.recheckData()
  }
}
