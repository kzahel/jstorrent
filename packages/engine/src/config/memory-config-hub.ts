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
   *
   * Unlike other ConfigHub implementations, MemoryConfigHub synchronously
   * applies initial values to the cache in the constructor, making it
   * immediately usable without calling init().
   */
  constructor(initialValues?: Partial<ConfigType>) {
    super()

    if (initialValues) {
      for (const [key, value] of Object.entries(initialValues)) {
        const configKey = key as ConfigKey
        this.storage.set(configKey, value)
        // Also apply directly to cache for immediate availability
        // (no async storage to wait for)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.cache as any)[configKey] = value
      }
      // When initialValues are provided, mark as initialized immediately
      // since values are applied synchronously (no async storage to load from).
      // This allows BtEngine to use the config immediately without awaiting init().
      this.initialized = true
    }
    // When no initialValues, leave initialized = false so tests can use
    // preloadStorage() + init() to simulate async storage loading.
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
