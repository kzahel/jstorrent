import type { BtEngine, LogStore, EngineLoggingConfig } from '@jstorrent/engine'

/**
 * Storage root representing a download location.
 */
export interface StorageRoot {
  key: string
  label: string
  path: string
}

/**
 * Result of file operations.
 */
export interface FileOperationResult {
  ok: boolean
  error?: string
}

/**
 * Interface for engine lifecycle management.
 * Implementations handle platform-specific concerns like:
 * - Chrome extension: service worker messaging, native host bridge
 * - Android standalone: JS bridges, SAF storage
 */
export interface IEngineManager {
  // Current state
  readonly engine: BtEngine | null
  readonly logStore: LogStore

  /**
   * Whether this implementation supports file operations
   * (open file, reveal in folder, pick download folder).
   * Chrome extension: true
   * Android standalone: false (handled by Android Activity)
   */
  readonly supportsFileOperations: boolean

  // Lifecycle
  init(): Promise<BtEngine>
  shutdown(): void
  reset(): void

  // Settings application
  setRateLimits(downloadLimit: number, uploadLimit: number): void
  setConnectionLimits(
    maxPeersPerTorrent: number,
    maxGlobalPeers: number,
    maxUploadSlots: number,
  ): void
  setDaemonRateLimit(opsPerSecond: number, burstSize: number): void
  setEncryptionPolicy(policy: 'disabled' | 'allow' | 'prefer' | 'required'): void
  setDHTEnabled(enabled: boolean): Promise<void>
  setUPnPEnabled(enabled: boolean): Promise<void>
  setLoggingConfig(config: EngineLoggingConfig): void

  // Storage roots
  getRoots(): StorageRoot[]
  getDefaultRootKey(): Promise<string | null>
  setDefaultRoot(key: string): Promise<void>

  // File operations (optional - check supportsFileOperations first)
  openFile?(torrentHash: string, filePath: string): Promise<FileOperationResult>
  revealInFolder?(torrentHash: string, filePath: string): Promise<FileOperationResult>
  openTorrentFolder?(torrentHash: string): Promise<FileOperationResult>
  getFilePath?(torrentHash: string, filePath: string): string | null
  pickDownloadFolder?(): Promise<StorageRoot | null>
  removeDownloadRoot?(key: string): Promise<boolean>

  // Event handling
  handleNativeEvent(event: string, payload: unknown): Promise<void>
}
