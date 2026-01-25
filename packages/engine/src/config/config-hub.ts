/**
 * ConfigHub Interface
 *
 * Centralized configuration manager for all reactive configuration:
 * - Settings (persisted, user-editable)
 * - Runtime (ephemeral, discovered)
 * - Storage (platform-specific)
 */

import type { ConfigValue } from './config-value'
import type { Unsubscribe } from './types'
import type {
  ConfigKey,
  ConfigType,
  Theme,
  ProgressBarStyle,
  UiScale,
  PlatformType,
  UPnPStatus,
  ComponentLogLevel,
} from './config-schema'
import type { LogLevel } from '../logging/logger'
import type { EncryptionPolicy } from '../crypto'
import type { StorageRoot } from '../storage/types'

/** Callback for any config change */
export type AnyConfigChangeCallback = (key: ConfigKey, value: unknown, oldValue: unknown) => void

/**
 * ConfigHub interface.
 *
 * Design notes:
 * - All ConfigValue.get() calls are synchronous (read from cache)
 * - set() updates cache immediately, persists asynchronously
 * - Subscribers are notified after cache update, before persistence completes
 * - Must call init() before using (loads persisted values)
 */
export interface ConfigHub {
  // ===========================================================================
  // Settings: Rate Limiting
  // ===========================================================================

  /** Whether download speed is unlimited. */
  readonly downloadSpeedUnlimited: ConfigValue<boolean>

  /** Download speed limit in bytes/sec (used when downloadSpeedUnlimited is false). */
  readonly downloadSpeedLimit: ConfigValue<number>

  /** Whether upload speed is unlimited. */
  readonly uploadSpeedUnlimited: ConfigValue<boolean>

  /** Upload speed limit in bytes/sec (used when uploadSpeedUnlimited is false). */
  readonly uploadSpeedLimit: ConfigValue<number>

  // ===========================================================================
  // Settings: Connection Limits
  // ===========================================================================

  /** Maximum peers per torrent. */
  readonly maxPeersPerTorrent: ConfigValue<number>

  /** Maximum global peers across all torrents. */
  readonly maxGlobalPeers: ConfigValue<number>

  /** Maximum simultaneous upload slots. */
  readonly maxUploadSlots: ConfigValue<number>

  // ===========================================================================
  // Settings: Protocol
  // ===========================================================================

  /** MSE/PE encryption policy. */
  readonly encryptionPolicy: ConfigValue<EncryptionPolicy>

  /** Whether to automatically choose a listening port. Restart required to apply. */
  readonly listeningPortAuto: ConfigValue<boolean>

  /** Listening port for incoming connections (used when listeningPortAuto is false). Restart required to apply. */
  readonly listeningPort: ConfigValue<number>

  // ===========================================================================
  // Settings: Features
  // ===========================================================================

  /** Whether DHT is enabled for trackerless peer discovery. */
  readonly dhtEnabled: ConfigValue<boolean>

  /** Whether UPnP port mapping is enabled. */
  readonly upnpEnabled: ConfigValue<boolean>

  // ===========================================================================
  // Settings: Advanced
  // ===========================================================================

  /** Daemon operations per second (rate limit). */
  readonly daemonOpsPerSecond: ConfigValue<number>

  /** Daemon operations burst capacity. */
  readonly daemonOpsBurst: ConfigValue<number>

  // ===========================================================================
  // Settings: UI
  // ===========================================================================

  /** UI theme. */
  readonly theme: ConfigValue<Theme>

  /** Maximum FPS for UI updates. */
  readonly maxFps: ConfigValue<number>

  /** Progress bar display style. */
  readonly progressBarStyle: ConfigValue<ProgressBarStyle>

  /** UI scale for fonts and spacing. */
  readonly uiScale: ConfigValue<UiScale>

  // ===========================================================================
  // Settings: Notifications (extension-only)
  // ===========================================================================

  /** Notify when a torrent completes. */
  readonly notifyOnTorrentComplete: ConfigValue<boolean>

  /** Notify when all torrents complete. */
  readonly notifyOnAllComplete: ConfigValue<boolean>

  /** Notify on errors. */
  readonly notifyOnError: ConfigValue<boolean>

  /** Show progress notification when UI is backgrounded. */
  readonly notifyProgressWhenBackgrounded: ConfigValue<boolean>

  // ===========================================================================
  // Settings: Behavior
  // ===========================================================================

  /** Keep system awake while downloading. Extension-only. */
  readonly keepAwake: ConfigValue<boolean>

  /** Prevent background throttling. Extension-only. */
  readonly preventBackgroundThrottling: ConfigValue<boolean>

  // ===========================================================================
  // Settings: Logging
  // ===========================================================================

  /** Global logging level. */
  readonly loggingLevel: ConfigValue<LogLevel>

  // ---------------------------------------------------------------------------
  // Per-component logging level overrides
  // ---------------------------------------------------------------------------

  /** Client component log level override. */
  readonly loggingLevelClient: ConfigValue<ComponentLogLevel>

  /** Torrent component log level override. */
  readonly loggingLevelTorrent: ConfigValue<ComponentLogLevel>

  /** Peer component log level override. */
  readonly loggingLevelPeer: ConfigValue<ComponentLogLevel>

  /** Active pieces component log level override. */
  readonly loggingLevelActivePieces: ConfigValue<ComponentLogLevel>

  /** Content storage component log level override. */
  readonly loggingLevelContentStorage: ConfigValue<ComponentLogLevel>

  /** Parts file component log level override. */
  readonly loggingLevelPartsFile: ConfigValue<ComponentLogLevel>

  /** Tracker manager component log level override. */
  readonly loggingLevelTrackerManager: ConfigValue<ComponentLogLevel>

  /** HTTP tracker component log level override. */
  readonly loggingLevelHttpTracker: ConfigValue<ComponentLogLevel>

  /** UDP tracker component log level override. */
  readonly loggingLevelUdpTracker: ConfigValue<ComponentLogLevel>

  /** DHT component log level override. */
  readonly loggingLevelDht: ConfigValue<ComponentLogLevel>

  // ===========================================================================
  // Runtime: Daemon State
  // ===========================================================================

  /** Current daemon port. */
  readonly daemonPort: ConfigValue<number>

  /** Current daemon host. */
  readonly daemonHost: ConfigValue<string | null>

  /** Whether daemon is connected. */
  readonly daemonConnected: ConfigValue<boolean>

  /** Daemon version string. */
  readonly daemonVersion: ConfigValue<string | null>

  /** External IP discovered via UPnP. */
  readonly externalIP: ConfigValue<string | null>

  /** Current UPnP status. */
  readonly upnpStatus: ConfigValue<UPnPStatus>

  /** Platform type. */
  readonly platformType: ConfigValue<PlatformType>

  // ===========================================================================
  // Storage
  // ===========================================================================

  /** Available storage roots. */
  readonly storageRoots: ConfigValue<StorageRoot[]>

  /** Key of the default storage root. */
  readonly defaultRootKey: ConfigValue<string | null>

  // ===========================================================================
  // Mutation API
  // ===========================================================================

  /**
   * Update a config value.
   *
   * For restart-required keys, persists immediately but tracks as pending.
   * Engine subscribers are NOT notified until restart.
   *
   * @throws if key doesn't exist
   */
  set<K extends ConfigKey>(key: K, value: ConfigType[K]): void

  /**
   * Batch update multiple values.
   *
   * Coalesces notifications - each key's subscribers called at most once.
   */
  batch(updates: Partial<ConfigType>): void

  /**
   * Check if a restart-required key has pending changes.
   */
  hasPendingChange(key: ConfigKey): boolean

  /**
   * Get all pending changes (restart-required keys that were changed).
   */
  getPendingChanges(): Map<ConfigKey, unknown>

  // ===========================================================================
  // Global Subscription
  // ===========================================================================

  /**
   * Subscribe to any config change.
   */
  subscribeAll(callback: AnyConfigChangeCallback): Unsubscribe

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize from storage.
   * Must be called before using get/set.
   */
  init(): Promise<void>

  /**
   * Persist any buffered changes.
   * Call on shutdown to ensure all writes complete.
   */
  flush(): Promise<void>
}
