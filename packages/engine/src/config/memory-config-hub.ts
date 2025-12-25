/**
 * Memory ConfigHub
 *
 * In-memory implementation for testing.
 * No persistence - values reset when instance is discarded.
 */

import type { ConfigKey, ConfigType } from './config-schema'
import { BaseConfigHub } from './base-config-hub'

export class MemoryConfigHub extends BaseConfigHub {
  /** Simulated storage */
  private storage = new Map<ConfigKey, unknown>()

  /**
   * Create a MemoryConfigHub.
   * @param initialValues Optional initial values (applied after defaults)
   */
  constructor(initialValues?: Partial<ConfigType>) {
    super()

    if (initialValues) {
      for (const [key, value] of Object.entries(initialValues)) {
        this.storage.set(key as ConfigKey, value)
      }
    }
  }

  protected async loadFromStorage(): Promise<Partial<ConfigType>> {
    const result = {} as Record<string, unknown>
    for (const [key, value] of this.storage) {
      result[key] = value
    }
    return result as Partial<ConfigType>
  }

  protected async saveToStorage<K extends ConfigKey>(key: K, value: ConfigType[K]): Promise<void> {
    this.storage.set(key, value)
  }

  // ===========================================================================
  // Test helpers
  // ===========================================================================

  /**
   * Pre-populate storage before init().
   */
  preloadStorage(values: Partial<ConfigType>): void {
    for (const [key, value] of Object.entries(values)) {
      this.storage.set(key as ConfigKey, value)
    }
  }

  /**
   * Get raw storage contents for assertions.
   */
  getStorageContents(): Map<ConfigKey, unknown> {
    return new Map(this.storage)
  }

  /**
   * Directly set a value without validation (for testing edge cases).
   */
  setRaw<K extends ConfigKey>(key: K, value: unknown): void {
    this.storage.set(key, value)
    ;(this.cache as Record<ConfigKey, unknown>)[key] = value
  }
}
