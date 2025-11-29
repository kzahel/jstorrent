import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { toHex } from '../utils/buffer'
import { TorrentUserState } from './torrent-state'

const TORRENTS_KEY = 'torrents'
const TORRENT_PREFIX = 'torrent:'

/**
 * Metadata for a single torrent, persisted to session store.
 */
export interface TorrentSessionData {
  infoHash: string // Hex string
  magnetLink?: string // Original magnet link if added via magnet
  torrentFile?: string // Base64 encoded .torrent file if added via file
  name?: string // Torrent name (from metadata)
  storageToken?: string // Which download root to use
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

  constructor(
    private store: ISessionStore,
    private engine: BtEngine,
  ) {}

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
   * Save state for a specific torrent (bitfield, stats).
   */
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)
    const bitfield = torrent.pieceManager?.getBitField()

    if (!bitfield) return // No piece manager yet

    const state: TorrentStateData = {
      bitfield: bitfield.toHex(),
      uploaded: torrent.totalUploaded,
      downloaded: torrent.totalDownloaded,
      updatedAt: Date.now(),
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
      console.error('Failed to parse torrent list:', e)
      return []
    }
  }

  /**
   * Load state for a specific torrent.
   */
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    console.error(`SessionPersistence.loadTorrentState: Loading state for ${infoHash}`)
    const data = await this.store.get(TORRENT_PREFIX + infoHash)
    if (!data) {
      console.error(`SessionPersistence.loadTorrentState: No data found for ${infoHash}`)
      return null
    }

    try {
      const json = new TextDecoder().decode(data)
      const parsed = JSON.parse(json) as TorrentStateData
      console.error(`SessionPersistence.loadTorrentState: Found state for ${infoHash}, bitfield length=${parsed.bitfield?.length}`)
      return parsed
    } catch (e) {
      console.error(`Failed to parse torrent state for ${infoHash}:`, e)
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
   * Torrents are added with their saved userState and bitfields restored.
   * Network activity will only start when engine.resume() is called.
   */
  async restoreSession(): Promise<number> {
    const torrentsData = await this.loadTorrentList()
    let restoredCount = 0

    for (const data of torrentsData) {
      try {
        let torrent: Torrent | null = null

        if (data.magnetLink) {
          torrent = await this.engine.addTorrent(data.magnetLink, {
            storageToken: data.storageToken,
            skipPersist: true, // Don't re-save while restoring
            userState: data.userState || 'active', // Restore user state
          })
        } else if (data.torrentFile) {
          // Decode base64 torrent file
          const buffer = this.base64ToUint8Array(data.torrentFile)
          torrent = await this.engine.addTorrent(buffer, {
            storageToken: data.storageToken,
            skipPersist: true, // Don't re-save while restoring
            userState: data.userState || 'active', // Restore user state
          })
        }

        if (torrent) {
          // Restore addedAt timestamp
          torrent.addedAt = data.addedAt

          // Restore queue position
          torrent.queuePosition = data.queuePosition

          // Load saved state (bitfield)
          const state = await this.loadTorrentState(data.infoHash)
          if (state && torrent.pieceManager) {
            // Restore bitfield
            console.error(`SessionPersistence: Restoring bitfield for ${data.infoHash}, state.bitfield length=${state.bitfield?.length}`)
            torrent.pieceManager.restoreFromHex(state.bitfield)
            // Also update the torrent's bitfield reference
            torrent.bitfield = torrent.pieceManager.getBitField()
            console.error(`SessionPersistence: Restored bitfield, completedPieces=${torrent.pieceManager.getCompletedCount()}`)
          } else {
            console.error(`SessionPersistence: No state to restore for ${data.infoHash} (state=${!!state}, pieceManager=${!!torrent.pieceManager})`)
          }

          restoredCount++
        }
      } catch (e) {
        console.error(`Failed to restore torrent ${data.infoHash}:`, e)
      }
    }

    // Note: Torrents will NOT start yet because engine is suspended.
    // Caller should call engine.resume() after restore completes.

    return restoredCount
  }

  private torrentToSessionData(torrent: Torrent): TorrentSessionData {
    const infoHash = toHex(torrent.infoHash)

    // Get storage token for this torrent
    const root = this.engine.storageRootManager.getRootForTorrent(infoHash)
    const storageToken = root?.token

    return {
      infoHash,
      magnetLink: torrent.magnetLink,
      torrentFile: torrent.torrentFileBase64,
      name: torrent.name,
      storageToken,
      addedAt: torrent.addedAt || Date.now(),

      // Persist user state
      userState: torrent.userState,
      queuePosition: torrent.queuePosition,
    }
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
