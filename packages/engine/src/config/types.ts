/**
 * Config Module Types
 *
 * Fundamental types for the configuration system.
 */

/** Unsubscribe function returned by subscribe methods */
export type Unsubscribe = () => void

/** Category for config values */
export type ConfigCategory = 'setting' | 'runtime' | 'storage'

/** Storage class for persisted settings */
export type ConfigStorageClass = 'sync' | 'local'
