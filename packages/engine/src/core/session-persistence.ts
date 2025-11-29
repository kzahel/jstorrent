import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { toHex } from '../utils/buffer'

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
    const data = await this.store.get(TORRENT_PREFIX + infoHash)
    if (!data) return null

    try {
      const json = new TextDecoder().decode(data)
      return JSON.parse(json) as TorrentStateData
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
   * Call this on engine startup.
   * Torrents are added in paused state, bitfields restored, then all started together.
   */
  async restoreSession(): Promise<number> {
    const torrentsData = await this.loadTorrentList()
    const restoredTorrents: Torrent[] = []

    // Phase 1: Add all torrents in paused state and restore their bitfields
    for (const data of torrentsData) {
      try {
        let torrent: Torrent | null = null

        if (data.magnetLink) {
          torrent = await this.engine.addTorrent(data.magnetLink, {
            storageToken: data.storageToken,
            skipPersist: true, // Don't re-save while restoring
            paused: true, // Don't start yet
          })
        } else if (data.torrentFile) {
          // Decode base64 torrent file
          const buffer = this.base64ToUint8Array(data.torrentFile)
          torrent = await this.engine.addTorrent(buffer, {
            storageToken: data.storageToken,
            skipPersist: true, // Don't re-save while restoring
            paused: true, // Don't start yet
          })
        }

        if (torrent) {
          // Restore addedAt timestamp
          torrent.addedAt = data.addedAt

          // Load saved state (bitfield)
          const state = await this.loadTorrentState(data.infoHash)
          if (state && torrent.pieceManager) {
            // Restore bitfield before starting
            torrent.pieceManager.restoreFromHex(state.bitfield)
            // Also update the torrent's bitfield reference
            torrent.bitfield = torrent.pieceManager.getBitField()
          }
          restoredTorrents.push(torrent)
        }
      } catch (e) {
        console.error(`Failed to restore torrent ${data.infoHash}:`, e)
      }
    }

    // Phase 2: Start all torrents after bitfields are restored
    for (const torrent of restoredTorrents) {
      try {
        await torrent.start()
      } catch (e) {
        console.error(`Failed to start restored torrent ${toHex(torrent.infoHash)}:`, e)
      }
    }

    return restoredTorrents.length
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
