/**
 * JsBridge Settings Store
 *
 * Android SharedPreferences backend via KVBridge.
 * For use in Android standalone WebView mode.
 *
 * Note: This stores ALL settings via KVBridge regardless of their
 * schema-defined storage class. The sync/local distinction only matters
 * in the chrome.storage implementation.
 */

import {
  type Settings,
  type SettingKey,
  settingsSchema,
  getStorageKey,
} from '../../settings/schema'
import { BaseSettingsStore } from '../../settings/base-settings-store'
import { JsBridgeKVStore } from './JsBridgeKVStore'

export class JsBridgeSettingsStore extends BaseSettingsStore {
  private kv = new JsBridgeKVStore()

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    const result: Partial<Settings> = {}

    for (const key of Object.keys(settingsSchema) as SettingKey[]) {
      const storageKey = getStorageKey(key)
      try {
        const raw = this.kv.get(storageKey)
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
      this.kv.set(storageKey, JSON.stringify(value))
    } catch {
      // Ignore errors
    }
  }

  protected async deleteFromStorage(key: SettingKey): Promise<void> {
    const storageKey = getStorageKey(key)
    try {
      this.kv.delete(storageKey)
    } catch {
      // Ignore errors
    }
  }

  protected async clearStorage(): Promise<void> {
    // Only clear settings keys, not other KVBridge data
    for (const key of Object.keys(settingsSchema) as SettingKey[]) {
      const storageKey = getStorageKey(key)
      try {
        this.kv.delete(storageKey)
      } catch {
        // Ignore errors
      }
    }
  }
}
