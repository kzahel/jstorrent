// Core
export { BtEngine } from './core/bt-engine'
export type { DaemonOpType, PendingOpCounts, UPnPStatus } from './core/bt-engine'
export { Torrent } from './core/torrent'
export type { DisplayPeer } from './core/torrent'
export { BandwidthTracker, ALL_TRAFFIC_CATEGORIES } from './core/bandwidth-tracker'
export type { BandwidthTrackerConfig, TrafficCategory } from './core/bandwidth-tracker'
export { TorrentFileInfo } from './core/torrent-file-info'
export { PeerConnection } from './core/peer-connection'
export { ActivePiece } from './core/active-piece'
export { SessionPersistence } from './core/session-persistence'
export type { SwarmPeer, ConnectionState, DiscoverySource, AddressFamily } from './core/swarm'
export { addressKey } from './core/swarm'
export * from './core/peer-coordinator'
export type { TorrentListEntry, TorrentStateData } from './core/session-persistence'
export { ConnectionTimingTracker } from './core/connection-timing'
export type { ConnectionTimingStats } from './core/connection-timing'
export { EndgameManager } from './core/endgame-manager'
export type { EndgameDecision, CancelDecision, EndgameConfig } from './core/endgame-manager'

// Torrent state
export type { TorrentUserState, TorrentActivityState } from './core/torrent-state'
export { computeActivityState } from './core/torrent-state'

// Interfaces
export type { IFileSystem, IFileHandle, IFileStat } from './interfaces/filesystem'
export type { ISocketFactory, ITcpSocket, IUdpSocket } from './interfaces/socket'
export type { ISessionStore } from './interfaces/session-store'
export type { IHasher } from './interfaces/hasher'
export type { TrackerStats, TrackerStatus } from './interfaces/tracker'

// Logging
export type { Logger, LogEntry, LogLevel, EngineLoggingConfig } from './logging/logger'
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
export { RrdHistory, DEFAULT_RRD_TIERS } from './utils/rrd-history'
export type { RrdTierConfig, RrdSample, RrdSamplesResult } from './utils/rrd-history'
export { toHex, fromHex, toBase64, fromBase64 } from './utils/buffer'
export { TokenBucket } from './utils/token-bucket'
export type { InfoHashHex } from './utils/infohash'
export { infoHashFromHex, infoHashFromBytes } from './utils/infohash'
export { SleepWakeDetector } from './utils/sleep-wake-detector'
export type { SleepWakeDetectorOptions, WakeEvent } from './utils/sleep-wake-detector'

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

// UPnP
export { UPnPManager, SSDPClient, GatewayDevice } from './upnp'
export type { NetworkInterface, UPnPMapping, SSDPDevice } from './upnp'

// LPD (Local Peer Discovery)
export { LPDService } from './lpd'

// DHT
export type { DHTStats, DHTNodeInfo } from './dht'

// Settings
export {
  // Schema and types
  settingsSchema,
  type SettingsSchema,
  type SettingKey,
  type Settings,
  type SyncSettingKey,
  type LocalSettingKey,
  getSettingDef,
  getDefaultValue,
  getStorageClass,
  requiresRestart,
  validateValue,
  getDefaults,
  SETTINGS_KEY_PREFIX,
  getStorageKey,
  // Interface
  type ISettingsStore,
  type SettingChangeCallback,
  type AnySettingChangeCallback,
  type Unsubscribe,
  // Base class
  BaseSettingsStore,
  // Adapters
  MemorySettingsStore,
  LocalStorageSettingsStore,
} from './settings'

// Version
export { VERSION, versionToAzureusCode, azureusCodeToVersion } from './version'
