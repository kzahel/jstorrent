/**
 * Settings Store Interface
 *
 * Platform-agnostic interface for settings storage with pub/sub support.
 * Implementations handle the actual storage backend (localStorage, chrome.storage, etc.)
 */

import type { Settings, SettingKey } from './schema'

/** Callback for setting change notifications */
export type SettingChangeCallback<K extends SettingKey> = (
  value: Settings[K],
  oldValue: Settings[K],
) => void

/** Callback for any setting change */
export type AnySettingChangeCallback = <K extends SettingKey>(
  key: K,
  value: Settings[K],
  oldValue: Settings[K],
) => void

/** Unsubscribe function returned by subscribe methods */
export type Unsubscribe = () => void

/**
 * Settings store interface.
 *
 * Design notes:
 * - `get()` is synchronous, reading from an in-memory cache
 * - `set()` is async (storage write) but cache updates immediately
 * - Subscribers are notified after cache update, before write completes
 * - Implementations must hydrate cache before first use (via `init()` or constructor)
 */
export interface ISettingsStore {
  /**
   * Initialize the store, loading settings from storage.
   * Must be called (and awaited) before using get/set/subscribe.
   */
  init(): Promise<void>

  /**
   * Get a setting value (sync read from cache).
   */
  get<K extends SettingKey>(key: K): Settings[K]

  /**
   * Set a setting value.
   * Updates cache immediately, then persists asynchronously.
   * Subscribers are notified synchronously after cache update.
   */
  set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void>

  /**
   * Subscribe to changes for a specific setting.
   * Returns unsubscribe function.
   */
  subscribe<K extends SettingKey>(key: K, callback: SettingChangeCallback<K>): Unsubscribe

  /**
   * Subscribe to changes for any setting.
   * Returns unsubscribe function.
   */
  subscribeAll(callback: AnySettingChangeCallback): Unsubscribe

  /**
   * Get all settings as an object.
   * Returns a shallow copy of the cache.
   */
  getAll(): Settings

  /**
   * Reset a setting to its default value.
   */
  reset<K extends SettingKey>(key: K): Promise<void>

  /**
   * Reset all settings to defaults.
   */
  resetAll(): Promise<void>
}
