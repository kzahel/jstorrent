/**
 * Config Schema
 *
 * Single source of truth for all configuration keys, types, and defaults.
 * Covers three categories:
 * - Settings: User-editable, persisted values
 * - Runtime: Ephemeral discovered/computed values
 * - Storage: Platform-specific storage configuration
 */

import type { LogLevel } from '../logging/logger'
import type { EncryptionPolicy } from '../crypto'
import type { StorageRoot } from '../storage/types'
import type { ConfigCategory, ConfigStorageClass } from './types'

// ============================================================================
// Enum Types (defined here to avoid circular dependencies)
// ============================================================================

/** UPnP status (matches bt-engine.ts) */
export type UPnPStatus = 'disabled' | 'discovering' | 'mapped' | 'unavailable' | 'failed'

/** UI theme */
export type Theme = 'system' | 'dark' | 'light'

/** Progress bar display style */
export type ProgressBarStyle = 'text' | 'bar'

/** Piece visualization display mode */
export type PieceViewMode = 'summary' | 'bar' | 'grid'

/** UI scale for font and spacing sizes */
export type UiScale = 'small' | 'default' | 'large' | 'larger'

/** Platform type */
export type PlatformType = 'desktop' | 'chromeos' | 'android-standalone'

/** Component log level (includes 'default' to inherit from global level) */
export type ComponentLogLevel = 'default' | 'debug' | 'info' | 'warn' | 'error'

// ============================================================================
// Schema Definition Types
// ============================================================================

interface BooleanConfigDef {
  type: 'boolean'
  category: ConfigCategory
  storage?: ConfigStorageClass // Only for 'setting' category
  default: boolean
  restartRequired?: boolean
  extensionOnly?: boolean
}

interface NumberConfigDef {
  type: 'number'
  category: ConfigCategory
  storage?: ConfigStorageClass
  default: number
  min?: number
  max?: number
  restartRequired?: boolean
  extensionOnly?: boolean
}

interface StringConfigDef {
  type: 'string'
  category: ConfigCategory
  storage?: ConfigStorageClass
  default: string | null
  restartRequired?: boolean
  extensionOnly?: boolean
}

interface EnumConfigDef<T extends readonly string[]> {
  type: 'enum'
  category: ConfigCategory
  storage?: ConfigStorageClass
  values: T
  default: T[number]
  restartRequired?: boolean
  extensionOnly?: boolean
}

interface ArrayConfigDef<T> {
  type: 'array'
  category: ConfigCategory
  storage?: ConfigStorageClass
  itemType: string // For documentation
  default: T[]
  restartRequired?: boolean
  extensionOnly?: boolean
}

type ConfigDef =
  | BooleanConfigDef
  | NumberConfigDef
  | StringConfigDef
  | EnumConfigDef<readonly string[]>
  | ArrayConfigDef<unknown>

// ============================================================================
// The Schema
// ============================================================================

export const configSchema = {
  // ===========================================================================
  // Settings: Rate Limiting
  // ===========================================================================

  /** Whether download speed is unlimited. */
  downloadSpeedUnlimited: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
  },

  /** Download speed limit in bytes/sec (used when downloadSpeedUnlimited is false). */
  downloadSpeedLimit: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 1048576, // 1 MB/s
    min: 1,
  },

  /** Whether upload speed is unlimited. */
  uploadSpeedUnlimited: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
  },

  /** Upload speed limit in bytes/sec (used when uploadSpeedUnlimited is false). */
  uploadSpeedLimit: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 1048576, // 1 MB/s
    min: 1,
  },

  // ===========================================================================
  // Settings: Connection Limits
  // ===========================================================================

  /** Maximum peers per torrent. */
  maxPeersPerTorrent: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 20,
    min: 1,
    max: 500,
  },

  /** Maximum global peers across all torrents. */
  maxGlobalPeers: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 200,
    min: 1,
    max: 2000,
  },

  /** Maximum simultaneous upload slots. */
  maxUploadSlots: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 4,
    min: 0, // 0 = no uploads (pure leecher mode)
    max: 50,
  },

  /** Maximum outstanding block requests per peer (pipeline depth). Higher values improve throughput on high-latency connections. */
  maxPipelineDepth: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 500,
    min: 10,
    max: 500,
  },

  // ===========================================================================
  // Settings: Protocol
  // ===========================================================================

  /** MSE/PE encryption policy. */
  encryptionPolicy: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['disabled', 'allow', 'prefer', 'required'] as const,
    default: 'allow' as EncryptionPolicy,
  },

  /** Whether to automatically choose a listening port. */
  listeningPortAuto: {
    type: 'boolean',
    category: 'setting',
    storage: 'local', // Per-device
    default: true,
    restartRequired: true,
  },

  /** Listening port for incoming connections (used when listeningPortAuto is false). */
  listeningPort: {
    type: 'number',
    category: 'setting',
    storage: 'local', // Per-device
    default: 0, // 0 = not yet assigned, will be populated on first manual toggle
    min: 0, // Allow 0 as "not yet assigned" state
    max: 65535,
    restartRequired: true,
  },

  // ===========================================================================
  // Settings: Features
  // ===========================================================================

  /** Whether DHT is enabled for trackerless peer discovery. */
  dhtEnabled: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
  },

  /** Whether UPnP port mapping is enabled. */
  upnpEnabled: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
  },

  // ===========================================================================
  // Settings: Advanced
  // ===========================================================================

  /** Daemon operations per second (rate limit). */
  daemonOpsPerSecond: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 2,
    min: 1,
    max: 20,
  },

  /** Daemon operations burst capacity. */
  daemonOpsBurst: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 2,
    min: 1,
    max: 40,
  },

  // ===========================================================================
  // Settings: UI
  // ===========================================================================

  /** UI theme. */
  theme: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['system', 'dark', 'light'] as const,
    default: 'system' as Theme,
  },

  /** Maximum FPS for UI updates. */
  maxFps: {
    type: 'number',
    category: 'setting',
    storage: 'sync',
    default: 60,
    min: 0,
    max: 240,
  },

  /** Progress bar display style. */
  progressBarStyle: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['text', 'bar'] as const,
    default: 'bar' as ProgressBarStyle,
  },

  /** UI scale for fonts and spacing. */
  uiScale: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['small', 'default', 'large', 'larger'] as const,
    default: 'large' as UiScale, // Default to 'large' for better readability
  },

  /** Piece visualization display mode. */
  pieceViewMode: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['summary', 'bar', 'grid'] as const,
    default: 'summary' as PieceViewMode,
  },

  // ===========================================================================
  // Settings: Notifications (extension-only)
  // ===========================================================================

  /** Notify when a torrent completes. */
  notifyOnTorrentComplete: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },

  /** Notify when all torrents complete. */
  notifyOnAllComplete: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },

  /** Notify on errors. */
  notifyOnError: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },

  /** Show progress notification when UI is backgrounded. */
  notifyProgressWhenBackgrounded: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },

  // ===========================================================================
  // Settings: Behavior
  // ===========================================================================

  /** Keep system awake while downloading. Extension-only. */
  keepAwake: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },

  /** Prevent background throttling. Extension-only. */
  preventBackgroundThrottling: {
    type: 'boolean',
    category: 'setting',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },

  // ===========================================================================
  // Settings: Logging
  // ===========================================================================

  /** Global logging level. */
  loggingLevel: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['debug', 'info', 'warn', 'error'] as const,
    default: 'info' as LogLevel,
  },

  // ---------------------------------------------------------------------------
  // Per-component logging level overrides
  // 'default' means use the global loggingLevel setting
  // ---------------------------------------------------------------------------

  /** Client component log level override. */
  loggingLevelClient: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Torrent component log level override. */
  loggingLevelTorrent: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Peer component log level override. */
  loggingLevelPeer: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Active pieces component log level override. */
  loggingLevelActivePieces: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Content storage component log level override. */
  loggingLevelContentStorage: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Parts file component log level override. */
  loggingLevelPartsFile: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** Tracker manager component log level override. */
  loggingLevelTrackerManager: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** HTTP tracker component log level override. */
  loggingLevelHttpTracker: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** UDP tracker component log level override. */
  loggingLevelUdpTracker: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  /** DHT component log level override. */
  loggingLevelDht: {
    type: 'enum',
    category: 'setting',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default' as ComponentLogLevel,
  },

  // ===========================================================================
  // Runtime: Daemon State (ephemeral, not persisted)
  // ===========================================================================

  /** Current daemon port. */
  daemonPort: {
    type: 'number',
    category: 'runtime',
    default: 0,
  },

  /** Current daemon host. */
  daemonHost: {
    type: 'string',
    category: 'runtime',
    default: '127.0.0.1',
  },

  /** Whether daemon is connected. */
  daemonConnected: {
    type: 'boolean',
    category: 'runtime',
    default: false,
  },

  /** Daemon version string. */
  daemonVersion: {
    type: 'string',
    category: 'runtime',
    default: null,
  },

  /** External IP discovered via UPnP. */
  externalIP: {
    type: 'string',
    category: 'runtime',
    default: null,
  },

  /** Current UPnP status. */
  upnpStatus: {
    type: 'enum',
    category: 'runtime',
    values: ['disabled', 'discovering', 'mapped', 'unavailable', 'failed'] as const,
    default: 'disabled' as UPnPStatus,
  },

  /** Platform type. */
  platformType: {
    type: 'enum',
    category: 'runtime',
    values: ['desktop', 'chromeos', 'android-standalone'] as const,
    default: 'desktop' as PlatformType,
  },

  // ===========================================================================
  // Storage
  // ===========================================================================

  /** Available storage roots. */
  storageRoots: {
    type: 'array',
    category: 'storage',
    itemType: 'StorageRoot',
    default: [] as StorageRoot[],
  },

  /** Key of the default storage root. */
  defaultRootKey: {
    type: 'string',
    category: 'storage',
    storage: 'local',
    default: null,
  },
} as const satisfies Record<string, ConfigDef>

export type ConfigSchema = typeof configSchema

// ============================================================================
// Derived Types
// ============================================================================

/** All config keys */
export type ConfigKey = keyof ConfigSchema

/** Infer the value type from a config definition */
type InferConfigType<S extends ConfigDef> = S extends { type: 'boolean' }
  ? boolean
  : S extends { type: 'number' }
    ? number
    : S extends { type: 'string' }
      ? string | null
      : S extends { type: 'enum'; values: infer V }
        ? V extends readonly (infer U)[]
          ? U
          : never
        : S extends { type: 'array'; default: infer D }
          ? D
          : never

/** Map of config key to value type */
export type ConfigType = {
  [K in ConfigKey]: InferConfigType<ConfigSchema[K]>
}

/** Keys that are settings (persisted, user-editable) */
export type SettingConfigKey = {
  [K in ConfigKey]: ConfigSchema[K]['category'] extends 'setting' ? K : never
}[ConfigKey]

/** Keys that are runtime (ephemeral) */
export type RuntimeConfigKey = {
  [K in ConfigKey]: ConfigSchema[K]['category'] extends 'runtime' ? K : never
}[ConfigKey]

/** Keys that are storage-related */
export type StorageConfigKey = {
  [K in ConfigKey]: ConfigSchema[K]['category'] extends 'storage' ? K : never
}[ConfigKey]

/** Keys that require restart */
export type RestartRequiredKey = {
  [K in ConfigKey]: ConfigSchema[K] extends { restartRequired: true } ? K : never
}[ConfigKey]

// ============================================================================
// Schema Utilities
// ============================================================================

/** Get the schema definition for a config key */
export function getConfigDef<K extends ConfigKey>(key: K): ConfigSchema[K] {
  return configSchema[key]
}

/** Get the default value for a config key */
export function getConfigDefault<K extends ConfigKey>(key: K): ConfigType[K] {
  return configSchema[key].default as ConfigType[K]
}

/** Get all defaults as an object */
export function getConfigDefaults(): ConfigType {
  const defaults = {} as Record<string, unknown>
  for (const key of Object.keys(configSchema) as ConfigKey[]) {
    defaults[key] = configSchema[key].default
  }
  return defaults as ConfigType
}

/** Check if a key requires restart */
export function configRequiresRestart(key: ConfigKey): boolean {
  const def = configSchema[key]
  return 'restartRequired' in def && def.restartRequired === true
}

/** Check if a key is extension-only */
export function isConfigExtensionOnly(key: ConfigKey): boolean {
  const def = configSchema[key]
  return 'extensionOnly' in def && def.extensionOnly === true
}

/** Get the category for a config key */
export function getConfigCategory(key: ConfigKey): ConfigCategory {
  return configSchema[key].category
}

/** Get the storage class for a config key (undefined for runtime keys) */
export function getConfigStorageClass(key: ConfigKey): ConfigStorageClass | undefined {
  const def = configSchema[key]
  return 'storage' in def ? def.storage : undefined
}

/** Validate and coerce a value according to its schema */
export function validateConfigValue<K extends ConfigKey>(key: K, value: unknown): ConfigType[K] {
  const def = configSchema[key]
  const type = def.type

  if (type === 'boolean') {
    return (typeof value === 'boolean' ? value : def.default) as ConfigType[K]
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return def.default as ConfigType[K]
    }
    let v = value
    if ('min' in def && def.min !== undefined) v = Math.max(def.min, v)
    if ('max' in def && def.max !== undefined) v = Math.min(def.max, v)
    return v as ConfigType[K]
  }

  if (type === 'string') {
    if (value === null || typeof value === 'string') {
      return value as ConfigType[K]
    }
    return def.default as ConfigType[K]
  }

  if (type === 'array') {
    if (Array.isArray(value)) {
      return value as ConfigType[K]
    }
    return def.default as ConfigType[K]
  }

  // type === 'enum'
  const enumDef = def as EnumConfigDef<readonly string[]>
  const values = enumDef.values as readonly unknown[]
  return (values.includes(value) ? value : enumDef.default) as ConfigType[K]
}
