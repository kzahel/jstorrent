// Core
export { BtEngine } from './core/bt-engine'
export { Torrent } from './core/torrent'
export { SessionPersistence } from './core/session-persistence'
export type { TorrentSessionData, TorrentStateData } from './core/session-persistence'

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
export { defaultLogger } from './logging/logger'
export { RingBufferLogger } from './logging/ring-buffer-logger'
export type { LogFilter } from './logging/ring-buffer-logger'

// Adapters
export { MemorySessionStore } from './adapters/memory/memory-session-store'
export { ChromeStorageSessionStore } from './adapters/browser/chrome-storage-session-store'
export { LocalStorageSessionStore } from './adapters/browser/local-storage-session-store'
export { ExternalChromeStorageSessionStore } from './adapters/browser/external-chrome-storage-session-store'
export { SubtleCryptoHasher } from './adapters/browser/subtle-crypto-hasher'
export { DaemonConnection } from './adapters/daemon/daemon-connection'
export { DaemonSocketFactory } from './adapters/daemon/daemon-socket-factory'
export { DaemonFileSystem } from './adapters/daemon/daemon-filesystem'
export { DaemonHasher } from './adapters/daemon/daemon-hasher'

// Storage
export { StorageRootManager } from './storage/storage-root-manager'

// Presets
export { createDaemonEngine } from './presets/daemon'

// Utils
export { generateMagnet, parseMagnet, createTorrentBuffer } from './utils/magnet'
export type { GenerateMagnetOptions, ParsedMagnet } from './utils/magnet'
export { toHex, fromHex } from './utils/buffer'
