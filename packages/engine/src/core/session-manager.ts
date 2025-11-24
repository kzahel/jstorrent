import { Client } from './client'
import { IStorageHandle } from '../io/storage-handle'
// import { StorageManager } from '../io/storage-manager'

export interface SessionConfig {
  profile: string
  basePath?: string
}

export interface TorrentState {
  infoHash: string
  name?: string
  savePath: string
  paused: boolean
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
    private metadataStorage: IStorageHandle,
    // private _storageManager: StorageManager,
    _config: SessionConfig,
  ) {
    console.error(`SessionManager initialized with profile: ${_config.profile}`)
  }

  async save() {
    const state: SessionState = {
      torrents: this.client.torrents.map((t) => {
        const hex = Array.from(t.infoHash)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
        return {
          infoHash: hex,
          savePath: '/downloads', // Placeholder
          paused: false,
        }
      }),
    }

    const data = new TextEncoder().encode(JSON.stringify(state, null, 2))
    const fs = this.metadataStorage.getFileSystem()
    const handle = await fs.open(this.stateFile, 'w')
    await handle.write(data, 0, data.length, 0)
    await handle.close()
  }

  async load() {
    try {
      const fs = this.metadataStorage.getFileSystem()
      if (!(await fs.exists(this.stateFile))) {
        console.error('No session file found')
        return
      }

      const stat = await fs.stat(this.stateFile)
      const handle = await fs.open(this.stateFile, 'r')
      const data = new Uint8Array(stat.size)
      await handle.read(data, 0, stat.size, 0)
      await handle.close()

      const json = new TextDecoder().decode(data)
      const state: SessionState = JSON.parse(json)

      for (const tState of state.torrents) {
        console.error('Resuming torrent', tState.infoHash)
        // TODO: Reconstruct torrents using storageManager to resolve savePath
      }
    } catch (err) {
      console.error('Error loading session', err)
    }
  }
}
