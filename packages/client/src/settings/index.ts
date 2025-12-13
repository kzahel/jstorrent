/**
 * Settings Module
 *
 * Creates and exports the appropriate settings store based on context.
 */

import { LocalStorageSettingsStore, type ISettingsStore } from '@jstorrent/engine'
import { ChromeStorageSettingsStore } from './chrome-settings-store'
import { getBridge } from '../chrome/extension-bridge'

let settingsStore: ISettingsStore | null = null

/**
 * Get or create the settings store singleton.
 * Must call init() on the returned store before using.
 */
export function getSettingsStore(): ISettingsStore {
  if (settingsStore) return settingsStore

  const bridge = getBridge()

  if (bridge.isDevMode) {
    // HMR / jstorrent.com - use localStorage
    const store = new LocalStorageSettingsStore()
    store.startListening()
    settingsStore = store
  } else {
    // Extension context - use chrome.storage
    const store = new ChromeStorageSettingsStore()
    store.startListening()
    settingsStore = store
  }

  return settingsStore
}

export { ChromeStorageSettingsStore } from './chrome-settings-store'
