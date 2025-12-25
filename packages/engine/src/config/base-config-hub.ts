/**
 * Base ConfigHub Implementation
 *
 * Abstract base class with caching, subscriptions, and pending change tracking.
 * Subclasses implement persistence.
 */

import type { ConfigHub, AnyConfigChangeCallback } from './config-hub'
import type { ConfigValue, ConfigValueCallback } from './config-value'
import type { Unsubscribe } from './types'
import {
  type ConfigKey,
  type ConfigType,
  getConfigDefaults,
  validateConfigValue,
  configRequiresRestart,
} from './config-schema'

/**
 * Creates a ConfigValue for a given key backed by the hub's cache.
 */
function createConfigValue<K extends ConfigKey>(
  hub: BaseConfigHub,
  key: K,
): ConfigValue<ConfigType[K]> {
  return {
    get: () => hub.getValue(key),
    getLazy: () => () => hub.getValue(key),
    subscribe: (callback: ConfigValueCallback<ConfigType[K]>) => hub.subscribeKey(key, callback),
  }
}

export abstract class BaseConfigHub implements ConfigHub {
  /** In-memory cache of all values */
  protected cache: ConfigType

  /** Pending changes for restart-required keys */
  protected pendingChanges = new Map<ConfigKey, unknown>()

  /** Whether engine is running (affects restart-required behavior) */
  protected engineRunning = false

  /** Per-key subscribers */
  private keySubscribers = new Map<ConfigKey, Set<ConfigValueCallback<unknown>>>()

  /** Global subscribers */
  private allSubscribers = new Set<AnyConfigChangeCallback>()

  /** Init state */
  private initialized = false
  protected initPromise: Promise<void> | null = null

  constructor() {
    this.cache = getConfigDefaults()
  }

  // ===========================================================================
  // Abstract methods for persistence
  // ===========================================================================

  /** Load persisted values */
  protected abstract loadFromStorage(): Promise<Partial<ConfigType>>

  /** Save a single value */
  protected abstract saveToStorage<K extends ConfigKey>(key: K, value: ConfigType[K]): Promise<void>

  // ===========================================================================
  // ConfigValue properties
  // ===========================================================================

  // Settings: Rate Limiting
  readonly downloadSpeedLimit = createConfigValue(this, 'downloadSpeedLimit')
  readonly uploadSpeedLimit = createConfigValue(this, 'uploadSpeedLimit')

  // Settings: Connection Limits
  readonly maxPeersPerTorrent = createConfigValue(this, 'maxPeersPerTorrent')
  readonly maxGlobalPeers = createConfigValue(this, 'maxGlobalPeers')
  readonly maxUploadSlots = createConfigValue(this, 'maxUploadSlots')

  // Settings: Protocol
  readonly encryptionPolicy = createConfigValue(this, 'encryptionPolicy')
  readonly listeningPort = createConfigValue(this, 'listeningPort')

  // Settings: Features
  readonly dhtEnabled = createConfigValue(this, 'dhtEnabled')
  readonly upnpEnabled = createConfigValue(this, 'upnpEnabled')

  // Settings: Advanced
  readonly daemonOpsPerSecond = createConfigValue(this, 'daemonOpsPerSecond')
  readonly daemonOpsBurst = createConfigValue(this, 'daemonOpsBurst')

  // Settings: UI
  readonly theme = createConfigValue(this, 'theme')
  readonly maxFps = createConfigValue(this, 'maxFps')
  readonly progressBarStyle = createConfigValue(this, 'progressBarStyle')

  // Settings: Notifications
  readonly notifyOnTorrentComplete = createConfigValue(this, 'notifyOnTorrentComplete')
  readonly notifyOnAllComplete = createConfigValue(this, 'notifyOnAllComplete')
  readonly notifyOnError = createConfigValue(this, 'notifyOnError')
  readonly notifyProgressWhenBackgrounded = createConfigValue(
    this,
    'notifyProgressWhenBackgrounded',
  )

  // Settings: Behavior
  readonly keepAwake = createConfigValue(this, 'keepAwake')
  readonly preventBackgroundThrottling = createConfigValue(this, 'preventBackgroundThrottling')

  // Settings: Logging
  readonly loggingLevel = createConfigValue(this, 'loggingLevel')

  // Settings: Per-component logging level overrides
  readonly loggingLevelClient = createConfigValue(this, 'loggingLevelClient')
  readonly loggingLevelTorrent = createConfigValue(this, 'loggingLevelTorrent')
  readonly loggingLevelPeer = createConfigValue(this, 'loggingLevelPeer')
  readonly loggingLevelActivePieces = createConfigValue(this, 'loggingLevelActivePieces')
  readonly loggingLevelContentStorage = createConfigValue(this, 'loggingLevelContentStorage')
  readonly loggingLevelPartsFile = createConfigValue(this, 'loggingLevelPartsFile')
  readonly loggingLevelTrackerManager = createConfigValue(this, 'loggingLevelTrackerManager')
  readonly loggingLevelHttpTracker = createConfigValue(this, 'loggingLevelHttpTracker')
  readonly loggingLevelUdpTracker = createConfigValue(this, 'loggingLevelUdpTracker')
  readonly loggingLevelDht = createConfigValue(this, 'loggingLevelDht')

  // Runtime
  readonly daemonPort = createConfigValue(this, 'daemonPort')
  readonly daemonHost = createConfigValue(this, 'daemonHost')
  readonly daemonConnected = createConfigValue(this, 'daemonConnected')
  readonly daemonVersion = createConfigValue(this, 'daemonVersion')
  readonly externalIP = createConfigValue(this, 'externalIP')
  readonly upnpStatus = createConfigValue(this, 'upnpStatus')
  readonly platformType = createConfigValue(this, 'platformType')

  // Storage
  readonly storageRoots = createConfigValue(this, 'storageRoots')
  readonly defaultRootKey = createConfigValue(this, 'defaultRootKey')

  // ===========================================================================
  // Internal helpers for ConfigValue
  // ===========================================================================

  /** Get value from cache (used by ConfigValue.get()) */
  getValue<K extends ConfigKey>(key: K): ConfigType[K] {
    if (!this.initialized) {
      console.warn(`[ConfigHub] getValue('${key}') called before init()`)
    }
    return this.cache[key]
  }

  /** Subscribe to key changes (used by ConfigValue.subscribe()) */
  subscribeKey<K extends ConfigKey>(
    key: K,
    callback: ConfigValueCallback<ConfigType[K]>,
  ): Unsubscribe {
    let subscribers = this.keySubscribers.get(key)
    if (!subscribers) {
      subscribers = new Set()
      this.keySubscribers.set(key, subscribers)
    }
    subscribers.add(callback as ConfigValueCallback<unknown>)

    return () => {
      subscribers!.delete(callback as ConfigValueCallback<unknown>)
      if (subscribers!.size === 0) {
        this.keySubscribers.delete(key)
      }
    }
  }

  // ===========================================================================
  // ConfigHub implementation
  // ===========================================================================

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit()
    }
    return this.initPromise
  }

  protected async doInit(): Promise<void> {
    if (this.initialized) return

    const stored = await this.loadFromStorage()

    // Merge stored values with validation
    for (const key of Object.keys(stored) as ConfigKey[]) {
      const value = stored[key]
      if (value !== undefined) {
        ;(this.cache as Record<ConfigKey, unknown>)[key] = validateConfigValue(key, value)
      }
    }

    this.initialized = true
  }

  set<K extends ConfigKey>(key: K, value: ConfigType[K]): void {
    const validated = validateConfigValue(key, value)
    const oldValue = this.cache[key]

    // Skip if unchanged
    if (this.valuesEqual(validated, oldValue)) return

    // Handle restart-required keys
    if (configRequiresRestart(key) && this.engineRunning) {
      // Store new value (will be persisted)
      this.pendingChanges.set(key, validated)
      // Persist immediately so it takes effect on restart
      this.saveToStorage(key, validated).catch((e) => {
        console.error(`[ConfigHub] Failed to save '${key}':`, e)
      })
      // Don't update cache or notify - value not effective until restart
      return
    }

    // Update cache
    ;(this.cache as Record<ConfigKey, unknown>)[key] = validated

    // Notify subscribers
    this.notifySubscribers(key, validated, oldValue)

    // Persist asynchronously
    this.saveToStorage(key, validated).catch((e) => {
      console.error(`[ConfigHub] Failed to save '${key}':`, e)
    })
  }

  batch(updates: Partial<ConfigType>): void {
    const changes: Array<{ key: ConfigKey; value: unknown; oldValue: unknown }> = []

    for (const [key, value] of Object.entries(updates) as [ConfigKey, unknown][]) {
      if (value === undefined) continue

      const validated = validateConfigValue(key, value)
      const oldValue = this.cache[key]

      if (this.valuesEqual(validated, oldValue)) continue

      if (configRequiresRestart(key) && this.engineRunning) {
        this.pendingChanges.set(key, validated)
        this.saveToStorage(key, validated as ConfigType[typeof key]).catch((e) => {
          console.error(`[ConfigHub] Failed to save '${key}':`, e)
        })
        continue
      }

      ;(this.cache as Record<ConfigKey, unknown>)[key] = validated
      changes.push({ key, value: validated, oldValue })

      this.saveToStorage(key, validated as ConfigType[typeof key]).catch((e) => {
        console.error(`[ConfigHub] Failed to save '${key}':`, e)
      })
    }

    // Notify after all changes applied (coalesced)
    for (const { key, value, oldValue } of changes) {
      this.notifySubscribers(key, value, oldValue)
    }
  }

  hasPendingChange(key: ConfigKey): boolean {
    return this.pendingChanges.has(key)
  }

  getPendingChanges(): Map<ConfigKey, unknown> {
    return new Map(this.pendingChanges)
  }

  subscribeAll(callback: AnyConfigChangeCallback): Unsubscribe {
    this.allSubscribers.add(callback)
    return () => {
      this.allSubscribers.delete(callback)
    }
  }

  async flush(): Promise<void> {
    // Default implementation - subclasses can override if needed
  }

  // ===========================================================================
  // Lifecycle helpers (for engine integration)
  // ===========================================================================

  /** Mark engine as running (affects restart-required behavior) */
  setEngineRunning(running: boolean): void {
    this.engineRunning = running
    if (!running) {
      // Engine stopped - clear pending changes
      this.pendingChanges.clear()
    }
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  private notifySubscribers(key: ConfigKey, value: unknown, oldValue: unknown): void {
    // Key-specific subscribers
    const keySubscribers = this.keySubscribers.get(key)
    if (keySubscribers) {
      for (const cb of keySubscribers) {
        try {
          cb(value, oldValue)
        } catch (e) {
          console.error(`[ConfigHub] Subscriber error for '${key}':`, e)
        }
      }
    }

    // Global subscribers
    for (const cb of this.allSubscribers) {
      try {
        cb(key, value, oldValue)
      } catch (e) {
        console.error(`[ConfigHub] Global subscriber error for '${key}':`, e)
      }
    }
  }

  /** Deep equality check for values (handles arrays and objects) */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (typeof a !== typeof b) return false

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((v, i) => this.valuesEqual(v, b[i]))
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object)
      const keysB = Object.keys(b as object)
      if (keysA.length !== keysB.length) return false
      return keysA.every((k) =>
        this.valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    }

    return false
  }
}
