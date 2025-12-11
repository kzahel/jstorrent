// Core
export { BtEngine } from './core/bt-engine'
export { Torrent } from './core/torrent'
export { TorrentFileInfo } from './core/torrent-file-info'
export { PeerConnection } from './core/peer-connection'
export { ActivePiece } from './core/active-piece'
export { SessionPersistence } from './core/session-persistence'
export type { TorrentListEntry, TorrentStateData } from './core/session-persistence'
export { ConnectionTimingTracker } from './core/connection-timing'
export type { ConnectionTimingStats } from './core/connection-timing'

// Torrent state
export type { TorrentUserState, TorrentActivityState } from './core/torrent-state'
export { computeActivityState } from './core/torrent-state'

// Interfaces
export type { IFileSystem, IFileHandle, IFileStat } from './interfaces/filesystem'
export type { ISocketFactory, ITcpSocket, IUdpSocket } from './interfaces/socket'
export type { ISessionStore } from './interfaces/session-store'
export type { IHasher } from './interfaces/hasher'

// Logging
export type { Logger, LogEntry, LogLevel } from './logging/logger'
export { LogStore, globalLogStore, defaultLogger } from './logging/logger'

// Adapters
export { MemorySessionStore } from './adapters/memory/memory-session-store'
export { ChromeStorageSessionStore } from './adapters/browser/chrome-storage-session-store'
export { LocalStorageSessionStore } from './adapters/browser/local-storage-session-store'
export { ExternalChromeStorageSessionStore } from './adapters/browser/external-chrome-storage-session-store'
export { SubtleCryptoHasher } from './adapters/browser/subtle-crypto-hasher'
export { DaemonConnection } from './adapters/daemon/daemon-connection'
export type {
  IDaemonConnection,
  DaemonCredentials,
  CredentialsGetter,
} from './adapters/daemon/daemon-connection'
export { DaemonSocketFactory } from './adapters/daemon/daemon-socket-factory'
export { DaemonFileSystem } from './adapters/daemon/daemon-filesystem'
export { DaemonHasher } from './adapters/daemon/daemon-hasher'

// Storage
export { StorageRootManager, MissingStorageRootError } from './storage/storage-root-manager'

// Presets
export { createDaemonEngine } from './presets/daemon'

// Utils
export { generateMagnet, parseMagnet, createTorrentBuffer } from './utils/magnet'
export type { GenerateMagnetOptions, ParsedMagnet } from './utils/magnet'
export { toHex, fromHex, toBase64, fromBase64 } from './utils/buffer'
export type { InfoHashHex } from './utils/infohash'
export { infoHashFromHex, infoHashFromBytes } from './utils/infohash'

// Torrent factory and initialization
export { parseTorrentInput } from './core/torrent-factory'
export type { ParsedTorrentInput } from './core/torrent-factory'
export { initializeTorrentMetadata, initializeTorrentStorage } from './core/torrent-initializer'

// Disk Queue
export {
  TorrentDiskQueue,
  type IDiskQueue,
  type DiskJob,
  type DiskJobType,
  type DiskJobStatus,
  type DiskQueueSnapshot,
  type DiskQueueConfig,
} from './core/disk-queue'
