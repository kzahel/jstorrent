import { Client } from './client'
import { IFileSystem } from '../interfaces/filesystem'

export interface TorrentState {
  infoHash: string
  name?: string
  savePath: string
  paused: boolean
  // We might need more info to resume, like magnet link or path to .torrent file
  magnetLink?: string
  torrentFilePath?: string
}

export interface SessionState {
  torrents: TorrentState[]
}

export class SessionManager {
  private stateFile = 'session.json'

  constructor(
    private client: Client,
    private fileSystem: IFileSystem,
  ) {}

  async save() {
    const state: SessionState = {
      torrents: this.client.torrents.map((t) => {
        const hex = Array.from(t.infoHash)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        return {
          infoHash: hex,
          savePath: '/downloads', // Placeholder, Torrent should have savePath
          paused: false, // Placeholder
        }
      }),
    }

    const data = new TextEncoder().encode(JSON.stringify(state, null, 2))
    const handle = await this.fileSystem.open(this.stateFile, 'w')
    await handle.write(data, 0, data.length, 0)
    await handle.close()
  }

  async load() {
    try {
      const stat = await this.fileSystem.stat(this.stateFile)
      const handle = await this.fileSystem.open(this.stateFile, 'r')
      const data = new Uint8Array(stat.size)
      await handle.read(data, 0, stat.size, 0)
      await handle.close()

      const json = new TextDecoder().decode(data)
      const state: SessionState = JSON.parse(json)

      for (const tState of state.torrents) {
        // Resume torrent
        // We need addTorrent to support resuming from state
        // For now, we just log
        console.log('Resuming torrent', tState.infoHash)
      }
    } catch (err) {
      // Ignore error if file doesn't exist
      console.log('No session file found or error loading', err)
    }
  }
}
