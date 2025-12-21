/**
 * Settings Module
 *
 * Creates and exports the appropriate settings store based on context.
 * Uses KV message handlers to relay all storage operations through the
 * service worker, providing a unified storage architecture.
 */

import { type ISettingsStore } from '@jstorrent/engine'
import { KVSettingsStore } from './kv-settings-store'
import { getBridge } from '../chrome/extension-bridge'

let settingsStore: ISettingsStore | null = null

/**
 * Get or create the settings store singleton.
 * Must call init() on the returned store before using.
 *
 * Both extension and external contexts use KVSettingsStore, which
 * relays operations to the service worker via chrome.runtime.sendMessage.
 */
export function getSettingsStore(): ISettingsStore {
  if (settingsStore) return settingsStore

  const bridge = getBridge()

  // Both contexts use KVSettingsStore
  // - Extension context: no extensionId, uses internal messaging
  // - External context: includes extensionId for external messaging
  // Convert null to undefined for type compatibility
  const store = new KVSettingsStore(
    bridge.isDevMode ? (bridge.extensionId ?? undefined) : undefined,
  )
  store.startListening()
  settingsStore = store

  return settingsStore
}

export { KVSettingsStore } from './kv-settings-store'
