import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent, TorrentPersistedState } from './torrent'
import { toHex, toBase64, fromBase64 } from '../utils/buffer'
import { TorrentUserState } from './torrent-state'
import { Logger } from '../logging/logger'
import { initializeTorrentMetadata } from './torrent-initializer'

const TORRENTS_KEY = 'torrents'
const TORRENT_PREFIX = 'torrent:'

/**
 * Metadata for a single torrent, persisted to session store.
 */
export interface TorrentSessionData {
  infoHash: string // Hex string
  magnetLink?: string // Original magnet link if added via magnet
  torrentFile?: string // Base64 encoded .torrent file if added via file
  storageKey?: string // Which download root to use
  addedAt: number // Timestamp when added

  // User state
  userState: TorrentUserState
  queuePosition?: number
}

/**
 * Per-torrent state that changes during download.
 */
export interface TorrentStateData {
  bitfield: string // Hex-encoded bitfield
  uploaded: number // Total bytes uploaded
  downloaded: number // Total bytes downloaded (verified)
  updatedAt: number // Last update timestamp
  infoBuffer?: string // Base64-encoded info dictionary (for magnet links that have received metadata)
}

/**
 * List of all torrents.
 */
export interface TorrentListData {
  version: number
  torrents: TorrentSessionData[]
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
   * Save the current list of torrents.
   */
  async saveTorrentList(): Promise<void> {
    const data: TorrentListData = {
      version: 1,
      torrents: this.engine.torrents.map((t) => this.torrentToSessionData(t)),
    }

    const json = JSON.stringify(data)
    await this.store.set(TORRENTS_KEY, new TextEncoder().encode(json))
  }

  /**
   * Save state for a specific torrent (bitfield, stats, metadata).
   */
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)

    if (!torrent.bitfield) return // No bitfield yet (no metadata)

    // Get persisted state from torrent
    const persistedState = torrent.getPersistedState()

    // Convert to storage format (TorrentStateData)
    const state: TorrentStateData = {
      bitfield: torrent.bitfield.toHex(),
      uploaded: persistedState.totalUploaded,
      downloaded: persistedState.totalDownloaded,
      updatedAt: Date.now(),
    }

    // Save the info buffer (metadata) so we don't need to re-fetch from peers
    if (persistedState.infoBuffer) {
      state.infoBuffer = toBase64(persistedState.infoBuffer)
    }

    const json = JSON.stringify(state)
    await this.store.set(TORRENT_PREFIX + infoHash, new TextEncoder().encode(json))
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
   * Load the list of torrents from storage.
   */
  async loadTorrentList(): Promise<TorrentSessionData[]> {
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
   * Load state for a specific torrent.
   */
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    this.logger.debug(`Loading state for ${infoHash}`)
    const data = await this.store.get(TORRENT_PREFIX + infoHash)
    if (!data) {
      this.logger.debug(`No saved state found for ${infoHash}`)
      return null
    }

    try {
      const json = new TextDecoder().decode(data)
      const parsed = JSON.parse(json) as TorrentStateData
      this.logger.debug(`Found state for ${infoHash}, bitfield length=${parsed.bitfield?.length}`)
      return parsed
    } catch (e) {
      this.logger.error(`Failed to parse torrent state for ${infoHash}:`, e)
      return null
    }
  }

  /**
   * Remove state for a torrent.
   */
  async removeTorrentState(infoHash: string): Promise<void> {
    await this.store.delete(TORRENT_PREFIX + infoHash)
  }

  /**
   * Restore all torrents from storage.
   * Call this on engine startup while engine is suspended.
   * Torrents are added with their saved userState, metadata, bitfields, and stats restored.
   * Network activity will only start when engine.resume() is called.
   */
  async restoreSession(): Promise<number> {
    const torrentsData = await this.loadTorrentList()
    let restoredCount = 0

    for (const data of torrentsData) {
      try {
        // Load saved state FIRST - we need infoBuffer before adding torrent for magnet links
        const state = await this.loadTorrentState(data.infoHash)

        let torrent: Torrent | null = null

        if (data.magnetLink) {
          torrent = await this.engine.addTorrent(data.magnetLink, {
            storageKey: data.storageKey,
            source: 'restore',
            userState: data.userState || 'active',
          })
        } else if (data.torrentFile) {
          // Decode base64 torrent file
          const buffer = fromBase64(data.torrentFile)
          torrent = await this.engine.addTorrent(buffer, {
            storageKey: data.storageKey,
            source: 'restore',
            userState: data.userState || 'active',
          })
        }

        if (torrent) {
          // Build persisted state from saved data
          const persistedState: TorrentPersistedState = {
            magnetLink: data.magnetLink,
            torrentFileBase64: data.torrentFile,
            addedAt: data.addedAt,
            userState: data.userState || 'active',
            queuePosition: data.queuePosition,
            totalDownloaded: state?.downloaded ?? 0,
            totalUploaded: state?.uploaded ?? 0,
            completedPieces: [], // Will be restored from bitfield below
            infoBuffer: state?.infoBuffer ? fromBase64(state.infoBuffer) : undefined,
          }

          // If we have saved metadata (info buffer), initialize the torrent with it
          // This is crucial for magnet links - avoids needing to re-fetch metadata from peers
          if (persistedState.infoBuffer && !torrent.hasMetadata) {
            this.logger.debug(`Initializing torrent ${data.infoHash} from saved metadata`)
            await initializeTorrentMetadata(this.engine, torrent, persistedState.infoBuffer)
          }

          // Restore bitfield if we have saved state and metadata is now available
          // Note: We still use hex bitfield for storage efficiency, but restore via restoreBitfieldFromHex
          if (state?.bitfield && torrent.hasMetadata) {
            this.logger.debug(
              `Restoring bitfield for ${data.infoHash}, length=${state.bitfield?.length}`,
            )
            torrent.restoreBitfieldFromHex(state.bitfield)
            this.logger.debug(`Restored bitfield, completedPieces=${torrent.completedPiecesCount}`)
          }

          // Restore the rest of the persisted state (stats, timestamps, etc.)
          // Don't overwrite bitfield since we just restored it from hex
          torrent.addedAt = persistedState.addedAt
          torrent.queuePosition = persistedState.queuePosition
          torrent.totalDownloaded = persistedState.totalDownloaded
          torrent.totalUploaded = persistedState.totalUploaded

          restoredCount++
        }
      } catch (e) {
        this.logger.error(`Failed to restore torrent ${data.infoHash}:`, e)
      }
    }

    // Note: Torrents will NOT start yet because engine is suspended.
    // Caller should call engine.resume() after restore completes.

    return restoredCount
  }

  private torrentToSessionData(torrent: Torrent): TorrentSessionData {
    const infoHash = toHex(torrent.infoHash)
    const persistedState = torrent.getPersistedState()

    // Get storage key for this torrent
    const root = this.engine.storageRootManager.getRootForTorrent(infoHash)
    const storageKey = root?.key

    return {
      infoHash,
      magnetLink: persistedState.magnetLink,
      torrentFile: persistedState.torrentFileBase64,
      storageKey,
      addedAt: persistedState.addedAt,

      // Persist user state
      userState: persistedState.userState,
      queuePosition: persistedState.queuePosition,
    }
  }
}
