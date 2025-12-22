/**
 * KV Settings Store
 *
 * Uses KV message handlers via chrome.runtime.sendMessage to store settings.
 * Routes to chrome.storage.sync or chrome.storage.local based on schema.
 *
 * Works in both extension context (no extensionId) and external context
 * (jstorrent.com / localhost with extensionId).
 */

import {
  type Settings,
  type SettingKey,
  settingsSchema,
  getStorageKey,
  getStorageClass,
  BaseSettingsStore,
} from '@jstorrent/engine'

interface KVResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}

export class KVSettingsStore extends BaseSettingsStore {
  constructor(private extensionId?: string) {
    super()
  }

  private async send<T>(message: unknown): Promise<KVResponse<T>> {
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

      if (this.extensionId) {
        // External context: include extension ID
        chrome.runtime.sendMessage(this.extensionId, message, callback)
      } else {
        // Internal context: message within extension
        chrome.runtime.sendMessage(message, callback)
      }
    })
  }

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    const result = {} as Record<string, unknown>
    const allKeys = Object.keys(settingsSchema) as SettingKey[]

    // Load each setting individually via KV handlers
    // Group by storage area for efficiency
    const syncKeys = allKeys.filter((k) => getStorageClass(k) === 'sync')
    const localKeys = allKeys.filter((k) => getStorageClass(k) === 'local')

    // Load sync settings
    for (const key of syncKeys) {
      try {
        const response = await this.send<Settings[typeof key]>({
          type: 'KV_GET_JSON',
          key: getStorageKey(key),
          keyPrefix: '', // Settings keys already include the prefix
          area: 'sync',
        })
        if (response.ok && response.value !== undefined && response.value !== null) {
          result[key] = response.value
        }
      } catch (e) {
        console.warn(`[KVSettingsStore] Failed to load sync setting '${key}':`, e)
      }
    }

    // Load local settings
    for (const key of localKeys) {
      try {
        const response = await this.send<Settings[typeof key]>({
          type: 'KV_GET_JSON',
          key: getStorageKey(key),
          keyPrefix: '', // Settings keys already include the prefix
          area: 'local',
        })
        if (response.ok && response.value !== undefined && response.value !== null) {
          result[key] = response.value
        }
      } catch (e) {
        console.warn(`[KVSettingsStore] Failed to load local setting '${key}':`, e)
      }
    }

    return result as Partial<Settings>
  }

  protected async saveToStorage<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const storageKey = getStorageKey(key)
    const storageClass = getStorageClass(key)

    const response = await this.send({
      type: 'KV_SET_JSON',
      key: storageKey,
      value,
      keyPrefix: '', // Settings keys already include the prefix
      area: storageClass,
    })

    if (!response.ok) {
      throw new Error(response.error || 'KV_SET_JSON failed')
    }
  }

  protected async deleteFromStorage(key: SettingKey): Promise<void> {
    const storageKey = getStorageKey(key)
    const storageClass = getStorageClass(key)

    const response = await this.send({
      type: 'KV_DELETE',
      key: storageKey,
      keyPrefix: '', // Settings keys already include the prefix
      area: storageClass,
    })

    if (!response.ok) {
      throw new Error(response.error || 'KV_DELETE failed')
    }
  }

  protected async clearStorage(): Promise<void> {
    const allKeys = Object.keys(settingsSchema) as SettingKey[]

    // Delete each setting individually
    for (const key of allKeys) {
      try {
        await this.deleteFromStorage(key)
      } catch (e) {
        console.warn(`[KVSettingsStore] Failed to delete setting '${key}':`, e)
      }
    }
  }

  /**
   * Start listening for changes from other contexts.
   * Note: Cross-context sync via chrome.storage.onChanged is not yet implemented
   * for KV store. Changes from other tabs will not be reflected until reload.
   */
  startListening(): void {
    // TODO: Implement cross-context sync if needed
    // For now, this is a no-op placeholder for API compatibility
  }

  /**
   * Stop listening for changes.
   */
  stopListening(): void {
    // No-op - see startListening()
  }
}
