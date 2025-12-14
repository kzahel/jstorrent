/**
 * Settings Schema
 *
 * Single source of truth for all application settings.
 * Defines type, default value, validation, and storage class for each setting.
 */

// ============================================================================
// Schema Definition Types
// ============================================================================

interface BooleanSettingDef {
  type: 'boolean'
  storage: 'sync' | 'local'
  default: boolean
  restartRequired?: boolean
}

interface NumberSettingDef {
  type: 'number'
  storage: 'sync' | 'local'
  default: number
  min?: number
  max?: number
  restartRequired?: boolean
}

interface StringSettingDef {
  type: 'string'
  storage: 'sync' | 'local'
  default: string | null
  restartRequired?: boolean
}

interface EnumSettingDef<T extends readonly string[]> {
  type: 'enum'
  storage: 'sync' | 'local'
  values: T
  default: T[number]
  restartRequired?: boolean
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
  'notifications.onTorrentComplete': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  'notifications.onAllComplete': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  'notifications.onError': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
  'notifications.progressWhenBackgrounded': {
    type: 'boolean',
    storage: 'sync',
    default: false,
  },

  // -------------------------------------------------------------------------
  // Behavior
  // -------------------------------------------------------------------------
  keepAwake: {
    type: 'boolean',
    storage: 'sync',
    default: false,
    // Note: Requires permission grant before enabling
  },

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------
  downloadSpeedLimit: {
    type: 'number',
    storage: 'sync',
    default: 0, // 0 = unlimited
    min: 0,
  },
  uploadSpeedLimit: {
    type: 'number',
    storage: 'sync',
    default: 0, // 0 = unlimited
    min: 0,
  },
  maxPeersPerTorrent: {
    type: 'number',
    storage: 'sync',
    default: 50,
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
    storage: 'sync',
    default: 6881,
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
