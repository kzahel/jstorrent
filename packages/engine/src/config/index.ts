/**
 * Config Module
 *
 * Unified configuration system for settings, runtime state, and storage configuration.
 */

// Types
export type { Unsubscribe, ConfigCategory, ConfigStorageClass } from './types'

// ConfigValue interface
export type { ConfigValue, ConfigValueCallback } from './config-value'

// ConfigHub interface
export type { ConfigHub, AnyConfigChangeCallback } from './config-hub'

// Schema and types
export {
  configSchema,
  type ConfigSchema,
  type ConfigKey,
  type ConfigType,
  type SettingConfigKey,
  type RuntimeConfigKey,
  type StorageConfigKey,
  type RestartRequiredKey,
  type Theme,
  type ProgressBarStyle,
  type PlatformType,
  type UPnPStatus,
  getConfigDef,
  getConfigDefault,
  getConfigDefaults,
  configRequiresRestart,
  isConfigExtensionOnly,
  getConfigCategory,
  getConfigStorageClass,
  validateConfigValue,
} from './config-schema'

// Base class (for implementing custom adapters)
export { BaseConfigHub } from './base-config-hub'

// Adapters
export { MemoryConfigHub } from './memory-config-hub'
