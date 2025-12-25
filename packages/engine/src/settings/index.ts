/**
 * Settings Module
 *
 * Exports settings schema and types.
 * Note: ISettingsStore and adapters have been removed. Use ConfigHub instead.
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
