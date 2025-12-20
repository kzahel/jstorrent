/**
 * LocalStorage Settings Store
 *
 * Browser localStorage backend. No chrome.* APIs.
 * For use in HMR dev mode, jstorrent.com, or any non-extension context.
 *
 * Note: This stores ALL settings in localStorage regardless of their
 * schema-defined storage class. The sync/local distinction only matters
 * in the chrome.storage implementation.
 */

import {
  type Settings,
  type SettingKey,
  settingsSchema,
  getStorageKey,
  SETTINGS_KEY_PREFIX,
} from '../schema'
import { BaseSettingsStore } from '../base-settings-store'

export class LocalStorageSettingsStore extends BaseSettingsStore {
  private storageEventHandler: ((e: StorageEvent) => void) | null = null

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    const result: Partial<Settings> = {}

    for (const key of Object.keys(settingsSchema) as SettingKey[]) {
      const storageKey = getStorageKey(key)
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(result as any)[key] = JSON.parse(raw)
        }
      } catch {
        // Ignore parse errors, will use default
      }
    }

    return result
  }

  protected async saveToStorage<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const storageKey = getStorageKey(key)
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // Ignore quota errors
    }
  }

  protected async deleteFromStorage(key: SettingKey): Promise<void> {
    const storageKey = getStorageKey(key)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Ignore errors
    }
  }

  protected async clearStorage(): Promise<void> {
    // Only clear settings keys, not other localStorage data
    for (const key of Object.keys(settingsSchema) as SettingKey[]) {
      const storageKey = getStorageKey(key)
      try {
        localStorage.removeItem(storageKey)
      } catch {
        // Ignore errors
      }
    }
  }

  // ===========================================================================
  // Cross-tab sync via storage event
  // ===========================================================================

  /**
   * Start listening for changes from other tabs.
   * Call this after init() if you want cross-tab sync.
   */
  startListening(): void {
    if (this.storageEventHandler) return

    this.storageEventHandler = (e: StorageEvent) => {
      // Only handle our keys
      if (!e.key?.startsWith(SETTINGS_KEY_PREFIX)) return

      // Extract setting key
      const settingKey = e.key.slice(SETTINGS_KEY_PREFIX.length) as SettingKey
      if (!(settingKey in settingsSchema)) return

      // Parse new value
      let newValue: unknown
      if (e.newValue === null) {
        // Key was deleted - use default
        newValue = settingsSchema[settingKey].default
      } else {
        try {
          newValue = JSON.parse(e.newValue)
        } catch {
          return // Ignore parse errors
        }
      }

      this.handleExternalChange(settingKey, newValue)
    }

    window.addEventListener('storage', this.storageEventHandler)
  }

  /**
   * Stop listening for changes from other tabs.
   */
  stopListening(): void {
    if (this.storageEventHandler) {
      window.removeEventListener('storage', this.storageEventHandler)
      this.storageEventHandler = null
    }
  }
}
