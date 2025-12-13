/**
 * Settings Module
 *
 * Exports schema, types, interface, and adapters.
 */

// Schema and types
export {
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
} from './schema'

// Interface
export {
  type ISettingsStore,
  type SettingChangeCallback,
  type AnySettingChangeCallback,
  type Unsubscribe,
} from './settings-store'

// Base class (for implementing custom adapters)
export { BaseSettingsStore } from './base-settings-store'

// Adapters
export { MemorySettingsStore } from './adapters/memory-settings-store'
export { LocalStorageSettingsStore } from './adapters/local-storage-settings-store'
