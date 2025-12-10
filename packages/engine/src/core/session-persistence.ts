import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { toHex, toBase64, fromBase64 } from '../utils/buffer'
import { TorrentUserState } from './torrent-state'
import { Logger } from '../logging/logger'
import { initializeTorrentMetadata } from './torrent-initializer'

const TORRENTS_KEY = 'torrents'
const TORRENT_PREFIX = 'torrent:'
const STATE_SUFFIX = ':state'
const TORRENTFILE_SUFFIX = ':torrentfile'
const INFODICT_SUFFIX = ':infodict'

function stateKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${STATE_SUFFIX}`
}

function torrentFileKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${TORRENTFILE_SUFFIX}`
}

function infoDictKey(infoHash: string): string {
  return `${TORRENT_PREFIX}${infoHash}${INFODICT_SUFFIX}`
}

/**
 * Entry in the lightweight torrent index.
 */
export interface TorrentListEntry {
  infoHash: string // Hex string
  source: 'file' | 'magnet'
  magnetUri?: string // Only for magnet source
  addedAt: number // Timestamp when added
}

/**
 * The torrent list index.
 */
export interface TorrentListData {
  version: number
  torrents: TorrentListEntry[]
}

/**
 * Per-torrent mutable state.
 */
export interface TorrentStateData {
  // User state
  userState: TorrentUserState
  storageKey?: string
  queuePosition?: number

  // Progress (absent until metadata received)
  bitfield?: string // Hex-encoded bitfield
  uploaded: number
  downloaded: number
  updatedAt: number
}

/**
 * Handles persisting and restoring torrent session state.
 */
export class SessionPersistence {
  private saveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly DEBOUNCE_MS = 2000 // Save at most every 2 seconds per torrent
  private _logger: Logger | null = null

  constructor(
    private store: ISessionStore,
    private engine: BtEngine,
  ) {}

  private get logger(): Logger {
    if (!this._logger) {
      this._logger = this.engine.scopedLoggerFor({
        getLogName: () => 'session',
        getStaticLogName: () => 'session',
        engineInstance: this.engine,
      })
    }
    return this._logger
  }

  /**
   * Save the lightweight torrent index.
   * Only contains identifiers and source info - no large data.
   */
  async saveTorrentList(): Promise<void> {
    const data: TorrentListData = {
      version: 2,
      torrents: this.engine.torrents.map((t) => {
        const entry: TorrentListEntry = {
          infoHash: toHex(t.infoHash),
          source: t.magnetLink ? 'magnet' : 'file',
          addedAt: t.addedAt,
        }
        if (t.magnetLink) {
          entry.magnetUri = t.magnetLink
        }
        return entry
      }),
    }

    const json = JSON.stringify(data)
    await this.store.set(TORRENTS_KEY, new TextEncoder().encode(json))
  }

  /**
   * Save mutable state for a specific torrent (progress, userState, etc).
   */
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)
    const root = this.engine.storageRootManager.getRootForTorrent(infoHash)

    const state: TorrentStateData = {
      userState: torrent.userState,
      storageKey: root?.key,
      queuePosition: torrent.queuePosition,
      bitfield: torrent.bitfield?.toHex(),
      uploaded: torrent.totalUploaded,
      downloaded: torrent.totalDownloaded,
      updatedAt: Date.now(),
    }

    const json = JSON.stringify(state)
    await this.store.set(stateKey(infoHash), new TextEncoder().encode(json))
  }

  /**
   * Save the .torrent file bytes. Called once when adding a file-source torrent.
   */
  async saveTorrentFile(infoHash: string, torrentFile: Uint8Array): Promise<void> {
    const base64 = toBase64(torrentFile)
    await this.store.set(torrentFileKey(infoHash), new TextEncoder().encode(base64))
  }

  /**
   * Save the info dictionary bytes. Called once when a magnet torrent receives metadata.
   */
  async saveInfoDict(infoHash: string, infoDict: Uint8Array): Promise<void> {
    const base64 = toBase64(infoDict)
    await this.store.set(infoDictKey(infoHash), new TextEncoder().encode(base64))
  }

  /**
   * Save state for a torrent, debounced.
   */
  saveTorrentStateDebounced(torrent: Torrent): void {
    const infoHash = toHex(torrent.infoHash)

    // Clear existing timer
    const existing = this.saveTimers.get(infoHash)
    if (existing) {
      clearTimeout(existing)
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.saveTorrentState(torrent)
      this.saveTimers.delete(infoHash)
    }, this.DEBOUNCE_MS)

    this.saveTimers.set(infoHash, timer)
  }

  /**
   * Flush all pending saves immediately.
   * Call this on shutdown.
   */
  async flushPendingSaves(): Promise<void> {
    for (const [, timer] of this.saveTimers) {
      clearTimeout(timer)
    }
    this.saveTimers.clear()

    // Save all torrents
    for (const torrent of this.engine.torrents) {
      await this.saveTorrentState(torrent)
    }
  }

  /**
   * Load the torrent index from storage.
   */
  async loadTorrentList(): Promise<TorrentListEntry[]> {
    const data = await this.store.get(TORRENTS_KEY)
    if (!data) return []

    try {
      const json = new TextDecoder().decode(data)
      const parsed: TorrentListData = JSON.parse(json)
      return parsed.torrents || []
    } catch (e) {
      this.logger.error('Failed to parse torrent list:', e)
      return []
    }
  }

  /**
   * Load mutable state for a specific torrent.
   */
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    const data = await this.store.get(stateKey(infoHash))
    if (!data) return null

    try {
      const json = new TextDecoder().decode(data)
      return JSON.parse(json) as TorrentStateData
    } catch (e) {
      this.logger.error(`Failed to parse torrent state for ${infoHash}:`, e)
      return null
    }
  }

  /**
   * Load the .torrent file bytes for a file-source torrent.
   */
  async loadTorrentFile(infoHash: string): Promise<Uint8Array | null> {
    const data = await this.store.get(torrentFileKey(infoHash))
    if (!data) return null

    try {
      const base64 = new TextDecoder().decode(data)
      return fromBase64(base64)
    } catch (e) {
      this.logger.error(`Failed to load torrent file for ${infoHash}:`, e)
      return null
    }
  }

  /**
   * Load the info dictionary bytes for a magnet-source torrent.
   */
  async loadInfoDict(infoHash: string): Promise<Uint8Array | null> {
    const data = await this.store.get(infoDictKey(infoHash))
    if (!data) return null

    try {
      const base64 = new TextDecoder().decode(data)
      return fromBase64(base64)
    } catch (e) {
      this.logger.error(`Failed to load info dict for ${infoHash}:`, e)
      return null
    }
  }

  /**
   * Remove all persisted data for a torrent.
   */
  async removeTorrentData(infoHash: string): Promise<void> {
    await Promise.all([
      this.store.delete(stateKey(infoHash)),
      this.store.delete(torrentFileKey(infoHash)),
      this.store.delete(infoDictKey(infoHash)),
    ])
  }

  /**
   * Restore all torrents from storage.
   * Call this on engine startup while engine is suspended.
   */
  async restoreSession(): Promise<number> {
    const entries = await this.loadTorrentList()
    let restoredCount = 0

    for (const entry of entries) {
      try {
        const state = await this.loadTorrentState(entry.infoHash)
        let torrent: Torrent | null = null

        if (entry.source === 'file') {
          // File-source: load .torrent file
          const torrentFile = await this.loadTorrentFile(entry.infoHash)
          if (!torrentFile) {
            this.logger.error(`Missing torrent file for ${entry.infoHash}, skipping`)
            continue
          }
          torrent = await this.engine.addTorrent(torrentFile, {
            storageKey: state?.storageKey,
            source: 'restore',
            userState: state?.userState ?? 'active',
          })
        } else {
          // Magnet-source: use magnetUri
          if (!entry.magnetUri) {
            this.logger.error(`Missing magnetUri for ${entry.infoHash}, skipping`)
            continue
          }
          torrent = await this.engine.addTorrent(entry.magnetUri, {
            storageKey: state?.storageKey,
            source: 'restore',
            userState: state?.userState ?? 'active',
          })

          // If we have saved infodict, initialize metadata
          if (torrent && !torrent.hasMetadata) {
            const infoDict = await this.loadInfoDict(entry.infoHash)
            if (infoDict) {
              this.logger.debug(`Initializing torrent ${entry.infoHash} from saved infodict`)
              try {
                await initializeTorrentMetadata(this.engine, torrent, infoDict)
              } catch (e) {
                if (e instanceof Error && e.name === 'MissingStorageRootError') {
                  torrent.errorMessage = `Download location unavailable. Storage root not found.`
                  this.logger.warn(`Torrent ${entry.infoHash} restored with missing storage`)
                } else {
                  throw e
                }
              }
            }
          }
        }

        if (torrent) {
          // Restore progress from state
          if (state) {
            if (state.bitfield && torrent.hasMetadata) {
              torrent.restoreBitfieldFromHex(state.bitfield)
            }
            torrent.totalUploaded = state.uploaded
            torrent.totalDownloaded = state.downloaded
            torrent.queuePosition = state.queuePosition
          }

          // Restore addedAt from list entry
          torrent.addedAt = entry.addedAt

          restoredCount++
        }
      } catch (e) {
        this.logger.error(`Failed to restore torrent ${entry.infoHash}:`, e)
      }
    }

    return restoredCount
  }
}
