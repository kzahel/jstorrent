import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import {
  ILoggingEngine,
  Logger,
  EngineLoggingConfig,
  ILoggableComponent,
  LogEntry,
} from '../logging/logger'
import { ISessionStore } from '../interfaces/session-store'
import { IHasher } from '../interfaces/hasher'
import { StorageRootManager } from '../storage/storage-root-manager'
import { SessionPersistence } from './session-persistence'
import { Torrent } from './torrent'
import { TorrentUserState } from './torrent-state'
export declare const MAX_PIECE_SIZE: number
export interface BtEngineOptions {
  downloadPath?: string
  socketFactory: ISocketFactory
  fileSystem?: IFileSystem
  storageRootManager?: StorageRootManager
  sessionStore?: ISessionStore
  hasher?: IHasher
  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
  peerId?: string
  port?: number
  logging?: EngineLoggingConfig
  maxPeers?: number
  onLog?: (entry: LogEntry) => void
  /**
   * Start the engine in suspended state (no network activity).
   * Use this when you need to restore session before starting networking.
   * Call resume() after setup/restore is complete.
   */
  startSuspended?: boolean
}
export declare class BtEngine extends EventEmitter implements ILoggingEngine, ILoggableComponent {
  readonly storageRootManager: StorageRootManager
  readonly socketFactory: ISocketFactory
  readonly sessionPersistence: SessionPersistence
  readonly hasher: IHasher
  torrents: Torrent[]
  port: number
  peerId: Uint8Array
  readonly clientId: string
  private logger
  private filterFn
  private onLogCallback?
  maxConnections: number
  maxPeers: number
  /**
   * Whether the engine is suspended (no network activity).
   * By default, engine starts active. Pass `startSuspended: true` to start suspended.
   */
  private _suspended
  static logName: string
  getLogName(): string
  getStaticLogName(): string
  get engineInstance(): ILoggingEngine
  constructor(options: BtEngineOptions)
  scopedLoggerFor(component: ILoggableComponent): Logger
  /**
   * Whether the engine is suspended (no network activity).
   */
  get isSuspended(): boolean
  /**
   * Suspend all network activity.
   * Torrents remain in their user state but stop all networking.
   * Use this during session restore or for "pause all" functionality.
   */
  suspend(): void
  /**
   * Resume network activity.
   * Torrents with userState 'active' will start networking.
   * Torrents with userState 'stopped' or 'queued' remain stopped.
   */
  resume(): void
  private startServer
  private handleIncomingConnection
  addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options?: {
      storageKey?: string
      /** Whether this torrent is being restored from session or added by user action. Default: 'user' */
      source?: 'user' | 'restore'
      userState?: TorrentUserState
    },
  ): Promise<Torrent | null>
  removeTorrent(torrent: Torrent): Promise<void>
  removeTorrentByHash(infoHash: string): Promise<void>
  getTorrent(infoHash: string): Torrent | undefined
  /**
   * Initialize a torrent from saved metadata (info dict).
   * Used during session restore when we have the metadata buffer saved.
   * This avoids needing to re-fetch metadata from peers.
   */
  initTorrentFromSavedMetadata(torrent: Torrent, infoBuffer: Uint8Array): Promise<void>
  destroy(): Promise<void>
  /**
   * Restore torrents from session storage.
   * Call this after engine is initialized.
   */
  restoreSession(): Promise<number>
  get numConnections(): number
  private uint8ArrayToBase64
}
//# sourceMappingURL=bt-engine.d.ts.map
