import { ISessionStore } from '../interfaces/session-store'
import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { TorrentUserState } from './torrent-state'
/**
 * Metadata for a single torrent, persisted to session store.
 */
export interface TorrentSessionData {
  infoHash: string
  magnetLink?: string
  torrentFile?: string
  storageKey?: string
  addedAt: number
  userState: TorrentUserState
  queuePosition?: number
}
/**
 * Per-torrent state that changes during download.
 */
export interface TorrentStateData {
  bitfield: string
  uploaded: number
  downloaded: number
  updatedAt: number
  infoBuffer?: string
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
export declare class SessionPersistence {
  private store
  private engine
  private saveTimers
  private readonly DEBOUNCE_MS
  private _logger
  constructor(store: ISessionStore, engine: BtEngine)
  private get logger()
  /**
   * Save the current list of torrents.
   */
  saveTorrentList(): Promise<void>
  /**
   * Save state for a specific torrent (bitfield, stats, metadata).
   */
  saveTorrentState(torrent: Torrent): Promise<void>
  private uint8ArrayToBase64
  /**
   * Save state for a torrent, debounced.
   */
  saveTorrentStateDebounced(torrent: Torrent): void
  /**
   * Flush all pending saves immediately.
   * Call this on shutdown.
   */
  flushPendingSaves(): Promise<void>
  /**
   * Load the list of torrents from storage.
   */
  loadTorrentList(): Promise<TorrentSessionData[]>
  /**
   * Load state for a specific torrent.
   */
  loadTorrentState(infoHash: string): Promise<TorrentStateData | null>
  /**
   * Remove state for a torrent.
   */
  removeTorrentState(infoHash: string): Promise<void>
  /**
   * Restore all torrents from storage.
   * Call this on engine startup while engine is suspended.
   * Torrents are added with their saved userState, metadata, bitfields, and stats restored.
   * Network activity will only start when engine.resume() is called.
   */
  restoreSession(): Promise<number>
  private torrentToSessionData
  private base64ToUint8Array
}
//# sourceMappingURL=session-persistence.d.ts.map
