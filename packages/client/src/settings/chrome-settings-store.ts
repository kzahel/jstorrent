/**
 * Chrome Storage Settings Store
 *
 * Uses chrome.storage.sync for sync-able settings and chrome.storage.local
 * for machine-local settings, based on schema definitions.
 *
 * For use in extension context (service worker, extension pages).
 */

import {
  type Settings,
  type SettingKey,
  settingsSchema,
  getStorageKey,
  getStorageClass,
  SETTINGS_KEY_PREFIX,
} from '@jstorrent/engine'
import { BaseSettingsStore } from '@jstorrent/engine'

export class ChromeStorageSettingsStore extends BaseSettingsStore {
  private changeListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | null = null

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    const result = {} as Record<string, unknown>
    const allKeys = Object.keys(settingsSchema) as SettingKey[]

    // Group keys by storage class
    const syncKeys = allKeys.filter((k) => getStorageClass(k) === 'sync').map(getStorageKey)
    const localKeys = allKeys.filter((k) => getStorageClass(k) === 'local').map(getStorageKey)

    // Load from both storage areas
    const [syncData, localData] = await Promise.all([
      syncKeys.length > 0 ? chrome.storage.sync.get(syncKeys) : Promise.resolve({}),
      localKeys.length > 0 ? chrome.storage.local.get(localKeys) : Promise.resolve({}),
    ])

    // Merge results
    const allData: Record<string, unknown> = { ...syncData, ...localData }

    for (const key of allKeys) {
      const storageKey = getStorageKey(key)
      if (storageKey in allData) {
        result[key] = allData[storageKey]
      }
    }

    return result as Partial<Settings>
  }

  protected async saveToStorage<K extends SettingKey>(
    key: K,
    value: Settings[K],
  ): Promise<void> {
    const storageKey = getStorageKey(key)
    const storageClass = getStorageClass(key)
    const storage = storageClass === 'sync' ? chrome.storage.sync : chrome.storage.local

    await storage.set({ [storageKey]: value })
  }

  protected async deleteFromStorage(key: SettingKey): Promise<void> {
    const storageKey = getStorageKey(key)
    const storageClass = getStorageClass(key)
    const storage = storageClass === 'sync' ? chrome.storage.sync : chrome.storage.local

    await storage.remove(storageKey)
  }

  protected async clearStorage(): Promise<void> {
    const allKeys = Object.keys(settingsSchema) as SettingKey[]

    // Group keys by storage class
    const syncKeys = allKeys.filter((k) => getStorageClass(k) === 'sync').map(getStorageKey)
    const localKeys = allKeys.filter((k) => getStorageClass(k) === 'local').map(getStorageKey)

    await Promise.all([
      syncKeys.length > 0 ? chrome.storage.sync.remove(syncKeys) : Promise.resolve(),
      localKeys.length > 0 ? chrome.storage.local.remove(localKeys) : Promise.resolve(),
    ])
  }

  // ===========================================================================
  // Cross-context sync via chrome.storage.onChanged
  // ===========================================================================

  /**
   * Start listening for changes from other contexts (other tabs, service worker).
   * Call this after init().
   */
  startListening(): void {
    if (this.changeListener) return

    this.changeListener = (changes, areaName) => {
      // We care about both sync and local changes
      if (areaName !== 'sync' && areaName !== 'local') return

      for (const [storageKey, change] of Object.entries(changes)) {
        // Only handle our keys
        if (!storageKey.startsWith(SETTINGS_KEY_PREFIX)) continue

        // Extract setting key
        const settingKey = storageKey.slice(SETTINGS_KEY_PREFIX.length) as SettingKey
        if (!(settingKey in settingsSchema)) continue

        // Verify storage class matches
        const expectedArea = getStorageClass(settingKey)
        if (areaName !== expectedArea) continue

        // Get new value (or default if deleted)
        const newValue = 'newValue' in change 
          ? change.newValue 
          : settingsSchema[settingKey].default

        this.handleExternalChange(settingKey, newValue)
      }
    }

    chrome.storage.onChanged.addListener(this.changeListener)
  }

  /**
   * Stop listening for changes.
   */
  stopListening(): void {
    if (this.changeListener) {
      chrome.storage.onChanged.removeListener(this.changeListener)
      this.changeListener = null
    }
  }
}
