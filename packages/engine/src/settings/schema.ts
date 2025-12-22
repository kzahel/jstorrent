/**
 * Settings Schema
 *
 * Single source of truth for all application settings.
 * Defines type, default value, validation, and storage class for each setting.
 *
 * IMPORTANT: When adding settings that affect engine behavior at runtime
 * (e.g., rate limits, connection limits), ensure they are applied during
 * engine initialization in packages/client/src/chrome/engine-manager.ts
 * (see the "Apply rate limits and connection limits from settings" section).
 */

// ============================================================================
// Schema Definition Types
// ============================================================================

interface BooleanSettingDef {
  type: 'boolean'
  storage: 'sync' | 'local'
  default: boolean
  restartRequired?: boolean
  /** Setting only works in Chrome extension, not standalone Android */
  extensionOnly?: boolean
}

interface NumberSettingDef {
  type: 'number'
  storage: 'sync' | 'local'
  default: number
  min?: number
  max?: number
  restartRequired?: boolean
  /** Setting only works in Chrome extension, not standalone Android */
  extensionOnly?: boolean
}

interface StringSettingDef {
  type: 'string'
  storage: 'sync' | 'local'
  default: string | null
  restartRequired?: boolean
  /** Setting only works in Chrome extension, not standalone Android */
  extensionOnly?: boolean
}

interface EnumSettingDef<T extends readonly string[]> {
  type: 'enum'
  storage: 'sync' | 'local'
  values: T
  default: T[number]
  restartRequired?: boolean
  /** Setting only works in Chrome extension, not standalone Android */
  extensionOnly?: boolean
}

type SettingDef =
  | BooleanSettingDef
  | NumberSettingDef
  | StringSettingDef
  | EnumSettingDef<readonly string[]>

// ============================================================================
// The Schema
// ============================================================================

export const settingsSchema = {
  // -------------------------------------------------------------------------
  // Interface
  // -------------------------------------------------------------------------
  theme: {
    type: 'enum',
    storage: 'sync',
    values: ['system', 'dark', 'light'] as const,
    default: 'system',
  },
  maxFps: {
    type: 'number',
    storage: 'sync',
    default: 60,
    min: 0,
    max: 240,
  },
  progressBarStyle: {
    type: 'enum',
    storage: 'sync',
    values: ['text', 'bar'] as const,
    default: 'bar',
  },

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  /**
   * Notification settings are extension-only because they use chrome.notifications API.
   * Android standalone: Would require Android NotificationManager via JsBridge.
   * Could wire up torrent-complete/error events to Android Activity for native notifications.
   */
  'notifications.onTorrentComplete': {
    type: 'boolean',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },
  'notifications.onAllComplete': {
    type: 'boolean',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },
  'notifications.onError': {
    type: 'boolean',
    storage: 'sync',
    default: true,
    extensionOnly: true,
  },
  'notifications.progressWhenBackgrounded': {
    type: 'boolean',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },

  // -------------------------------------------------------------------------
  // Behavior
  // -------------------------------------------------------------------------
  /**
   * Keep system awake while downloading.
   * Extension: Uses chrome.power.requestKeepAwake() API. Requires permission grant.
   * Android standalone: Would require WAKE_LOCK permission and PowerManager.WakeLock via JsBridge.
   */
  keepAwake: {
    type: 'boolean',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },
  /**
   * Prevent Chrome from throttling the tab when backgrounded.
   * Chrome limits setTimeout/setInterval to 1-second minimum for background tabs.
   * Extension: Plays silent audio or uses WebRTC to prevent throttling.
   * Android standalone: Not needed - foreground service prevents Android from throttling.
   */
  preventBackgroundThrottling: {
    type: 'boolean',
    storage: 'sync',
    default: false,
    extensionOnly: true,
  },

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------
  downloadSpeedLimit: {
    type: 'number',
    storage: 'sync',
    default: 1024 * 100, // 100 KB/s
    min: 0,
  },
  downloadSpeedLimitUnlimited: {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  uploadSpeedLimit: {
    type: 'number',
    storage: 'sync',
    default: 1024 * 50, // 50 KB/s
    min: 0,
  },
  uploadSpeedLimitUnlimited: {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  maxPeersPerTorrent: {
    type: 'number',
    storage: 'sync',
    default: 20,
    min: 1,
    max: 500,
  },
  maxGlobalPeers: {
    type: 'number',
    storage: 'sync',
    default: 200,
    min: 1,
    max: 2000,
  },
  listeningPort: {
    type: 'number',
    storage: 'local', // Local storage: each device gets its own port
    default: 0, // 0 = generate random on first run
    min: 1024,
    max: 65535,
    restartRequired: true,
  },
  maxUploadSlots: {
    type: 'number',
    storage: 'sync',
    default: 4,
    min: 0, // 0 = no uploads (pure leecher mode)
    max: 50,
  },
  'upnp.enabled': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  /**
   * MSE/PE (Protocol Encryption) policy.
   * - 'disabled': No encryption, plain BitTorrent connections only
   * - 'allow': Accept encryption if peer requests, but don't initiate (default)
   * - 'prefer': Initiate encryption, fall back to plain if peer doesn't support
   * - 'required': Only accept encrypted connections
   */
  encryptionPolicy: {
    type: 'enum',
    storage: 'sync',
    values: ['disabled', 'allow', 'prefer', 'required'] as const,
    default: 'allow',
  },

  // -------------------------------------------------------------------------
  // DHT (Distributed Hash Table)
  // -------------------------------------------------------------------------
  /**
   * Enable DHT for trackerless peer discovery.
   */
  'dht.enabled': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------
  /**
   * Global log level. Messages below this level are not captured.
   */
  'logging.level': {
    type: 'enum',
    storage: 'sync',
    values: ['debug', 'info', 'warn', 'error'] as const,
    default: 'info',
  },
  /**
   * Per-component log level overrides.
   * 'default' means use the global logging.level setting.
   */
  'logging.level.client': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.torrent': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.peer': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.active-pieces': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.content-storage': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.parts-file': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.tracker-manager': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.http-tracker': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.udp-tracker': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },
  'logging.level.dht': {
    type: 'enum',
    storage: 'sync',
    values: ['default', 'debug', 'info', 'warn', 'error'] as const,
    default: 'default',
  },

  // -------------------------------------------------------------------------
  // Advanced: Daemon Rate Limiting
  // -------------------------------------------------------------------------
  /**
   * Maximum daemon operations per second (connections, announces).
   * Controls how fast we initiate new connections to peers/trackers.
   */
  daemonOpsPerSecond: {
    type: 'number',
    storage: 'sync',
    default: 2,
    min: 1,
    max: 20,
  },
  /**
   * Burst capacity for daemon operations.
   * Allows this many operations immediately before rate limiting kicks in.
   */
  daemonOpsBurst: {
    type: 'number',
    storage: 'sync',
    default: 2,
    min: 1,
    max: 40,
  },

  // -------------------------------------------------------------------------
  // Machine-Local Settings
  // -------------------------------------------------------------------------
  defaultRootKey: {
    type: 'string',
    storage: 'local',
    default: null,
  },
} as const satisfies Record<string, SettingDef>

export type SettingsSchema = typeof settingsSchema

// ============================================================================
// Derived Types
// ============================================================================

/** All setting keys */
export type SettingKey = keyof SettingsSchema

/** Infer the value type from a setting definition */
type InferSettingType<S extends SettingDef> = S extends { type: 'boolean' }
  ? boolean
  : S extends { type: 'number' }
    ? number
    : S extends { type: 'string' }
      ? string | null
      : S extends { type: 'enum'; values: infer V }
        ? V extends readonly (infer U)[]
          ? U
          : never
        : never

/** Map of setting key to value type */
export type Settings = {
  [K in SettingKey]: InferSettingType<SettingsSchema[K]>
}

/** Settings that use sync storage */
export type SyncSettingKey = {
  [K in SettingKey]: SettingsSchema[K]['storage'] extends 'sync' ? K : never
}[SettingKey]

/** Settings that use local storage */
export type LocalSettingKey = {
  [K in SettingKey]: SettingsSchema[K]['storage'] extends 'local' ? K : never
}[SettingKey]

// ============================================================================
// Schema Utilities
// ============================================================================

/** Get the schema definition for a setting */
export function getSettingDef<K extends SettingKey>(key: K): SettingsSchema[K] {
  return settingsSchema[key]
}

/** Get the default value for a setting */
export function getDefaultValue<K extends SettingKey>(key: K): Settings[K] {
  return settingsSchema[key].default as Settings[K]
}

/** Get the storage class for a setting */
export function getStorageClass(key: SettingKey): 'sync' | 'local' {
  return settingsSchema[key].storage
}

/** Check if a setting requires restart */
export function requiresRestart(key: SettingKey): boolean {
  return 'restartRequired' in settingsSchema[key] && settingsSchema[key].restartRequired === true
}

/** Check if a setting is extension-only (not available in standalone Android) */
export function isExtensionOnly(key: SettingKey): boolean {
  return 'extensionOnly' in settingsSchema[key] && settingsSchema[key].extensionOnly === true
}

/** Validate and coerce a value according to its schema */
export function validateValue<K extends SettingKey>(key: K, value: unknown): Settings[K] {
  const def = settingsSchema[key]
  const type = def.type

  if (type === 'boolean') {
    return (typeof value === 'boolean' ? value : def.default) as Settings[K]
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return def.default as Settings[K]
    }
    let v = value
    if ('min' in def && def.min !== undefined) v = Math.max(def.min, v)
    if ('max' in def && def.max !== undefined) v = Math.min(def.max, v)
    return v as Settings[K]
  }

  if (type === 'string') {
    if (value === null || typeof value === 'string') {
      return value as Settings[K]
    }
    return def.default as Settings[K]
  }

  // type === 'enum'
  const enumDef = def as EnumSettingDef<readonly string[]>
  const values = enumDef.values as readonly unknown[]
  return (values.includes(value) ? value : enumDef.default) as Settings[K]
}

/** Get all default settings */
export function getDefaults(): Settings {
  const defaults = {} as Record<string, unknown>
  for (const key of Object.keys(settingsSchema) as SettingKey[]) {
    defaults[key] = settingsSchema[key].default
  }
  return defaults as Settings
}

/** Storage key prefix */
export const SETTINGS_KEY_PREFIX = 'settings:'

/** Get the storage key for a setting */
export function getStorageKey(key: SettingKey): string {
  return SETTINGS_KEY_PREFIX + key
}
