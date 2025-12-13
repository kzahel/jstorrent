/**
 * In-Memory Settings Store
 *
 * For testing. No persistence - settings reset when instance is discarded.
 */

import type { Settings, SettingKey } from '../schema'
import { BaseSettingsStore } from '../base-settings-store'

export class MemorySettingsStore extends BaseSettingsStore {
  /** Simulated "storage" */
  private storage = new Map<SettingKey, unknown>()

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    const result = {} as Record<string, unknown>
    for (const [key, value] of this.storage) {
      result[key] = value
    }
    return result as Partial<Settings>
  }

  protected async saveToStorage<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    this.storage.set(key, value)
  }

  protected async deleteFromStorage(key: SettingKey): Promise<void> {
    this.storage.delete(key)
  }

  protected async clearStorage(): Promise<void> {
    this.storage.clear()
  }

  // ===========================================================================
  // Test helpers
  // ===========================================================================

  /**
   * Pre-populate storage before init() for testing.
   */
  preloadStorage(values: Partial<Settings>): void {
    for (const [key, value] of Object.entries(values)) {
      this.storage.set(key as SettingKey, value)
    }
  }

  /**
   * Get raw storage contents for assertions.
   */
  getStorageContents(): Map<SettingKey, unknown> {
    return new Map(this.storage)
  }
}
