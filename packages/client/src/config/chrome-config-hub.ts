/**
 * Chrome Extension ConfigHub Implementation
 *
 * Extends BaseConfigHub to persist settings via chrome.storage (through KV handlers)
 * and receive runtime values from DaemonBridge.
 */

import {
  BaseConfigHub,
  type ConfigKey,
  type ConfigType,
  getConfigCategory,
  getConfigStorageClass,
  configSchema,
} from '@jstorrent/engine'

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

// KV response type
interface KVResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}

// Settings key prefix (must match kv-settings-store.ts)
const SETTINGS_KEY_PREFIX = 'settings:'

/**
 * Map from ConfigHub keys to old settings schema keys.
 * Only keys that differ need to be mapped.
 */
const CONFIG_TO_SETTINGS_KEY: Partial<Record<ConfigKey, string>> = {
  dhtEnabled: 'dht.enabled',
  upnpEnabled: 'upnp.enabled',
  notifyOnTorrentComplete: 'notifications.onTorrentComplete',
  notifyOnAllComplete: 'notifications.onAllComplete',
  notifyOnError: 'notifications.onError',
  loggingLevel: 'logging.level',
}

/**
 * Keys that use paired "unlimited" booleans in old settings.
 * When unlimited is true, the ConfigHub value is 0.
 */
const UNLIMITED_PAIRS: Record<string, string> = {
  downloadSpeedLimit: 'downloadSpeedLimitUnlimited',
  uploadSpeedLimit: 'uploadSpeedLimitUnlimited',
}

/**
 * Send a KV message to the service worker.
 */
async function sendKVMessage<T>(
  extensionId: string | undefined,
  message: unknown,
): Promise<KVResponse<T>> {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error('chrome.runtime.sendMessage not available'))
      return
    }

    const callback = (response: KVResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (!response) {
        reject(new Error('No response from extension - is it installed?'))
      } else {
        resolve(response)
      }
    }

    if (extensionId) {
      chrome.runtime.sendMessage(extensionId, message, callback)
    } else {
      chrome.runtime.sendMessage(message, callback)
    }
  })
}

/**
 * ChromeConfigHub - Chrome extension implementation of ConfigHub.
 *
 * Storage:
 * - Settings are persisted to chrome.storage via KV message handlers
 * - Runtime values are ephemeral (not persisted)
 * - Storage roots come from DaemonBridge
 *
 * Key mapping:
 * - Translates between ConfigHub keys and old settings schema keys for backward compatibility
 * - Handles "unlimited" boolean pairs (downloadSpeedLimitUnlimited → downloadSpeedLimit: 0)
 */
export class ChromeConfigHub extends BaseConfigHub {
  private extensionId?: string

  constructor(extensionId?: string) {
    super()
    this.extensionId = extensionId
  }

  /**
   * Load all persisted settings from chrome.storage.
   */
  protected async loadFromStorage(): Promise<Partial<ConfigType>> {
    const result: Partial<ConfigType> = {}

    // Get all setting keys (category === 'setting' or has storage class)
    const settingKeys = (Object.keys(configSchema) as ConfigKey[]).filter(
      (key) => getConfigCategory(key) === 'setting',
    )

    // Build list of old settings keys to fetch
    const keysToFetch: string[] = []
    for (const configKey of settingKeys) {
      const settingsKey = this.getSettingsKey(configKey)
      keysToFetch.push(SETTINGS_KEY_PREFIX + settingsKey)

      // Also fetch unlimited boolean if this key has one
      if (configKey in UNLIMITED_PAIRS) {
        keysToFetch.push(SETTINGS_KEY_PREFIX + UNLIMITED_PAIRS[configKey])
      }
    }

    // Also fetch defaultRootKey (storage category)
    keysToFetch.push(SETTINGS_KEY_PREFIX + 'defaultRootKey')

    // Fetch all values in one request
    // Use KV_GET_MULTI with empty prefix since we include the prefix ourselves
    const response = await sendKVMessage<Record<string, unknown>>(this.extensionId, {
      type: 'KV_GET_MULTI',
      keys: keysToFetch,
      keyPrefix: '',
    })

    if (!response.ok || !response.value) {
      console.warn('[ChromeConfigHub] Failed to load settings:', response.error)
      return result
    }

    const stored = response.value

    // Map stored values back to ConfigHub keys
    for (const configKey of settingKeys) {
      const settingsKey = this.getSettingsKey(configKey)
      const storageKey = SETTINGS_KEY_PREFIX + settingsKey
      const value = stored[storageKey]

      // Handle unlimited pairs
      if (configKey in UNLIMITED_PAIRS) {
        const unlimitedKey = SETTINGS_KEY_PREFIX + UNLIMITED_PAIRS[configKey]
        const unlimited = stored[unlimitedKey]
        if (unlimited === true) {
          ;(result as Record<string, unknown>)[configKey] = 0
          continue
        }
      }

      if (value !== undefined) {
        ;(result as Record<string, unknown>)[configKey] = value
      }
    }

    // Handle defaultRootKey (storage category)
    const defaultRootKey = stored[SETTINGS_KEY_PREFIX + 'defaultRootKey']
    if (defaultRootKey !== undefined) {
      result.defaultRootKey = defaultRootKey as string | null
    }

    return result
  }

  /**
   * Save a single value to chrome.storage.
   */
  protected async saveToStorage<K extends ConfigKey>(key: K, value: ConfigType[K]): Promise<void> {
    const category = getConfigCategory(key)

    // Runtime values are never persisted
    if (category === 'runtime') {
      return
    }

    // Storage roots are managed by DaemonBridge, not persisted here
    if (key === 'storageRoots') {
      return
    }

    const storageClass = getConfigStorageClass(key) ?? 'local'
    const settingsKey = this.getSettingsKey(key)

    // Handle unlimited pairs - write both the value and the unlimited flag
    if (key in UNLIMITED_PAIRS) {
      const unlimitedKey = UNLIMITED_PAIRS[key]
      const unlimited = value === 0

      // Write unlimited flag
      await sendKVMessage(this.extensionId, {
        type: 'KV_SET_JSON',
        key: SETTINGS_KEY_PREFIX + unlimitedKey,
        value: unlimited,
        keyPrefix: '',
        area: storageClass,
      })

      // Write the value (use default non-zero value if unlimited)
      const numValue = unlimited ? this.getDefaultNonZeroValue(key) : value
      await sendKVMessage(this.extensionId, {
        type: 'KV_SET_JSON',
        key: SETTINGS_KEY_PREFIX + settingsKey,
        value: numValue,
        keyPrefix: '',
        area: storageClass,
      })
    } else {
      // Normal value - just write it
      await sendKVMessage(this.extensionId, {
        type: 'KV_SET_JSON',
        key: SETTINGS_KEY_PREFIX + settingsKey,
        value,
        keyPrefix: '',
        area: storageClass,
      })
    }
  }

  /**
   * Update a runtime value (no persistence, just cache + notify).
   * Used by DaemonBridge integration to push runtime state changes.
   */
  setRuntime<K extends ConfigKey>(key: K, value: ConfigType[K]): void {
    const category = getConfigCategory(key)
    if (category !== 'runtime' && key !== 'storageRoots') {
      console.warn(`[ChromeConfigHub] setRuntime called for non-runtime key: ${key}`)
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
   * Get the old settings schema key for a ConfigHub key.
   */
  private getSettingsKey(configKey: ConfigKey): string {
    return CONFIG_TO_SETTINGS_KEY[configKey] ?? configKey
  }

  /**
   * Get a reasonable non-zero default for rate limit keys.
   * Used when saving unlimited (0) to also write a non-zero value for old UI compatibility.
   */
  private getDefaultNonZeroValue(key: ConfigKey): number {
    if (key === 'downloadSpeedLimit') return 1024 * 100 // 100 KB/s
    if (key === 'uploadSpeedLimit') return 1024 * 50 // 50 KB/s
    return 0
  }

  /**
   * Notify subscribers of a runtime value change.
   */
  private notifyRuntimeSubscribers(key: ConfigKey, value: unknown, oldValue: unknown): void {
    // Access the private keySubscribers via protected method
    const subscribers = this.getKeySubscribers(key)
    if (subscribers) {
      for (const cb of subscribers) {
        try {
          cb(value, oldValue)
        } catch (e) {
          console.error(`[ChromeConfigHub] Subscriber error for '${key}':`, e)
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
          console.error(`[ChromeConfigHub] Global subscriber error for '${key}':`, e)
        }
      }
    }
  }
}
