/**
 * Native ConfigHub Implementation
 *
 * Extends BaseConfigHub to persist settings via native storage bindings
 * (__jstorrent_storage_*) and receive runtime values from Kotlin/Swift.
 *
 * Used by the QuickJS (Android) and JavaScriptCore (iOS) engine bundles.
 */

import {
  BaseConfigHub,
  type ConfigKey,
  type ConfigType,
  getConfigCategory,
  configSchema,
} from '../../config'
import './bindings.d.ts'

// Storage key prefix
const CONFIG_KEY_PREFIX = 'config:'

/**
 * Deep equality check for config values (handles arrays and objects).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }

  return false
}

/**
 * NativeConfigHub - Native platform implementation of ConfigHub.
 *
 * Storage:
 * - Settings are persisted to SharedPreferences (Android) / UserDefaults (iOS)
 *   via __jstorrent_storage_* native bindings
 * - Runtime values are ephemeral (not persisted)
 * - Storage roots are pushed from Kotlin/Swift (RootStore is source of truth)
 */
export class NativeConfigHub extends BaseConfigHub {
  /**
   * Load all persisted settings from native storage.
   */
  protected async loadFromStorage(): Promise<Partial<ConfigType>> {
    const result: Partial<ConfigType> = {}

    // Get all setting keys (category === 'setting')
    const settingKeys = (Object.keys(configSchema) as ConfigKey[]).filter(
      (key) => getConfigCategory(key) === 'setting',
    )

    // Load each setting from native storage
    for (const key of settingKeys) {
      const storageKey = CONFIG_KEY_PREFIX + key
      try {
        const stored = __jstorrent_storage_get(storageKey)
        if (stored !== null) {
          const value = JSON.parse(stored)
          ;(result as Record<string, unknown>)[key] = value
        }
      } catch (e) {
        console.warn(`[NativeConfigHub] Failed to load '${key}':`, e)
      }
    }

    // Also load defaultRootKey (storage category, persisted)
    try {
      const stored = __jstorrent_storage_get(CONFIG_KEY_PREFIX + 'defaultRootKey')
      if (stored !== null) {
        result.defaultRootKey = JSON.parse(stored) as string | null
      }
    } catch (e) {
      console.warn('[NativeConfigHub] Failed to load defaultRootKey:', e)
    }

    console.log('[NativeConfigHub] Loaded from storage:', Object.keys(result).length, 'keys')
    return result
  }

  /**
   * Save a single value to native storage.
   */
  protected async saveToStorage<K extends ConfigKey>(key: K, value: ConfigType[K]): Promise<void> {
    const category = getConfigCategory(key)

    // Runtime values are never persisted
    if (category === 'runtime') {
      return
    }

    // Storage roots are managed by Kotlin/Swift RootStore, not persisted here
    if (key === 'storageRoots') {
      return
    }

    const storageKey = CONFIG_KEY_PREFIX + key

    try {
      const json = JSON.stringify(value)
      __jstorrent_storage_set(storageKey, json)
    } catch (e) {
      console.error(`[NativeConfigHub] Failed to save '${key}':`, e)
    }
  }

  /**
   * Update a runtime value (no persistence, just cache + notify).
   * Used by controller when Kotlin/Swift pushes config changes.
   */
  setRuntime<K extends ConfigKey>(key: K, value: ConfigType[K]): void {
    const category = getConfigCategory(key)
    if (category !== 'runtime' && key !== 'storageRoots' && key !== 'defaultRootKey') {
      console.warn(`[NativeConfigHub] setRuntime called for non-runtime key: ${key}`)
    }

    const oldValue = this.cache[key]

    // Skip if unchanged (use deep equality for arrays)
    if (deepEqual(value, oldValue)) {
      return
    }

    // Update cache
    ;(this.cache as Record<ConfigKey, unknown>)[key] = value

    // Notify subscribers
    this.notifyRuntimeSubscribers(key, value, oldValue)
  }

  /**
   * Notify subscribers of a runtime value change.
   */
  private notifyRuntimeSubscribers(key: ConfigKey, value: unknown, oldValue: unknown): void {
    // Access the private keySubscribers via workaround
    const subscribers = this.getKeySubscribers(key)
    if (subscribers) {
      for (const cb of subscribers) {
        try {
          cb(value, oldValue)
        } catch (e) {
          console.error(`[NativeConfigHub] Subscriber error for '${key}':`, e)
        }
      }
    }

    // Also notify global subscribers
    this.notifyGlobalSubscribers(key, value, oldValue)
  }

  /**
   * Get subscribers for a key (access to protected base class state).
   */
  private getKeySubscribers(
    key: ConfigKey,
  ): Set<(value: unknown, oldValue: unknown) => void> | undefined {
    // We need to access the private keySubscribers from BaseConfigHub
    // This is a workaround - ideally BaseConfigHub would expose a protected method
    return (
      this as unknown as { keySubscribers: Map<ConfigKey, Set<unknown>> }
    ).keySubscribers?.get(key) as Set<(value: unknown, oldValue: unknown) => void> | undefined
  }

  /**
   * Notify global subscribers.
   */
  private notifyGlobalSubscribers(key: ConfigKey, value: unknown, oldValue: unknown): void {
    const allSubscribers = (this as unknown as { allSubscribers: Set<unknown> }).allSubscribers
    if (allSubscribers) {
      for (const cb of allSubscribers) {
        try {
          ;(cb as (key: ConfigKey, value: unknown, oldValue: unknown) => void)(key, value, oldValue)
        } catch (e) {
          console.error(`[NativeConfigHub] Global subscriber error for '${key}':`, e)
        }
      }
    }
  }
}
