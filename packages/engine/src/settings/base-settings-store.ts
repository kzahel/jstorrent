/**
 * Base Settings Store
 *
 * Abstract implementation with caching and pub/sub.
 * Subclasses implement the actual storage read/write.
 */

import { type Settings, type SettingKey, getDefaults, validateValue } from './schema'
import type {
  ISettingsStore,
  SettingChangeCallback,
  AnySettingChangeCallback,
  Unsubscribe,
} from './settings-store'

export abstract class BaseSettingsStore implements ISettingsStore {
  /** In-memory cache */
  protected cache: Settings

  /** Per-key subscribers */
  private keySubscribers = new Map<SettingKey, Set<SettingChangeCallback<SettingKey>>>()

  /** Global subscribers */
  private allSubscribers = new Set<AnySettingChangeCallback>()

  /** Whether init() has been called */
  private initialized = false

  constructor() {
    // Start with defaults, will be overwritten by init()
    this.cache = getDefaults()
  }

  // ===========================================================================
  // Abstract methods - implemented by subclasses
  // ===========================================================================

  /**
   * Load all settings from storage.
   * Should return partial object (only keys that exist in storage).
   */
  protected abstract loadFromStorage(): Promise<Partial<Settings>>

  /**
   * Save a single setting to storage.
   */
  protected abstract saveToStorage<K extends SettingKey>(key: K, value: Settings[K]): Promise<void>

  /**
   * Delete a single setting from storage (reset to default).
   */
  protected abstract deleteFromStorage(key: SettingKey): Promise<void>

  /**
   * Clear all settings from storage.
   */
  protected abstract clearStorage(): Promise<void>

  // ===========================================================================
  // ISettingsStore implementation
  // ===========================================================================

  async init(): Promise<void> {
    if (this.initialized) return

    const stored = await this.loadFromStorage()

    // Merge stored values into cache (with validation)
    for (const key of Object.keys(stored) as SettingKey[]) {
      const value = stored[key]
      if (value !== undefined) {
        // Type assertion needed: TS can't track key-value relationship in loop
        ;(this.cache as Record<SettingKey, unknown>)[key] = validateValue(key, value)
      }
    }

    this.initialized = true
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    if (!this.initialized) {
      console.warn(`[SettingsStore] get('${key}') called before init(), returning default`)
    }
    return this.cache[key]
  }

  async set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const validated = validateValue(key, value)
    const oldValue = this.cache[key]

    // Skip if no change
    if (validated === oldValue) return

    // Update cache immediately
    this.cache[key] = validated

    // Notify subscribers synchronously
    this.notifySubscribers(key, validated, oldValue)

    // Persist asynchronously
    await this.saveToStorage(key, validated)
  }

  subscribe<K extends SettingKey>(key: K, callback: SettingChangeCallback<K>): Unsubscribe {
    let subscribers = this.keySubscribers.get(key)
    if (!subscribers) {
      subscribers = new Set()
      this.keySubscribers.set(key, subscribers)
    }
    subscribers.add(callback as SettingChangeCallback<SettingKey>)

    return () => {
      subscribers!.delete(callback as SettingChangeCallback<SettingKey>)
      if (subscribers!.size === 0) {
        this.keySubscribers.delete(key)
      }
    }
  }

  subscribeAll(callback: AnySettingChangeCallback): Unsubscribe {
    this.allSubscribers.add(callback)
    return () => {
      this.allSubscribers.delete(callback)
    }
  }

  getAll(): Settings {
    return { ...this.cache }
  }

  async reset<K extends SettingKey>(key: K): Promise<void> {
    const defaults = getDefaults()
    const oldValue = this.cache[key]
    const newValue = defaults[key]

    if (newValue === oldValue) return

    this.cache[key] = newValue
    this.notifySubscribers(key, newValue, oldValue)
    await this.deleteFromStorage(key)
  }

  async resetAll(): Promise<void> {
    const oldCache = { ...this.cache }
    const defaults = getDefaults()

    // Update cache
    this.cache = defaults

    // Notify for each changed value
    for (const key of Object.keys(defaults) as SettingKey[]) {
      if (defaults[key] !== oldCache[key]) {
        this.notifySubscribers(key, defaults[key], oldCache[key])
      }
    }

    await this.clearStorage()
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  private notifySubscribers<K extends SettingKey>(
    key: K,
    value: Settings[K],
    oldValue: Settings[K],
  ): void {
    // Key-specific subscribers
    const keySubscribers = this.keySubscribers.get(key)
    if (keySubscribers) {
      for (const cb of keySubscribers) {
        try {
          cb(value, oldValue)
        } catch (e) {
          console.error(`[SettingsStore] Subscriber error for '${key}':`, e)
        }
      }
    }

    // Global subscribers
    for (const cb of this.allSubscribers) {
      try {
        cb(key, value, oldValue)
      } catch (e) {
        console.error(`[SettingsStore] Global subscriber error for '${key}':`, e)
      }
    }
  }

  /**
   * Handle external storage change (e.g., from another tab).
   * Called by subclasses when they detect external changes.
   */
  protected handleExternalChange<K extends SettingKey>(key: K, newValue: unknown): void {
    const validated = validateValue(key, newValue)
    const oldValue = this.cache[key]

    if (validated === oldValue) return

    this.cache[key] = validated
    this.notifySubscribers(key, validated, oldValue)
  }
}
