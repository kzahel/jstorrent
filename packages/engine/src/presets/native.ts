/**
 * Native Engine Preset
 *
 * Factory function to create a BtEngine configured for QuickJS/JSC runtimes.
 */

import { BtEngine } from '../core/bt-engine'
import { NativeSocketFactory } from '../adapters/native/native-socket-factory'
import { NativeFileSystem } from '../adapters/native/native-filesystem'
import { NativeSessionStore } from '../adapters/native/native-session-store'
import { NativeHasher } from '../adapters/native/native-hasher'
import { StorageRootManager, StorageRoot } from '../storage/storage-root-manager'
import type { LogEntry } from '../logging/logger'

export interface NativeEngineConfig {
  /**
   * Content roots for storing downloaded files.
   * Each root has a unique key used by the native filesystem.
   */
  contentRoots: StorageRoot[]

  /**
   * Default content root key for new torrents.
   */
  defaultContentRoot?: string

  /**
   * Listening port to announce to trackers/peers.
   */
  port?: number

  /**
   * Callback for log entries.
   */
  onLog?: (entry: LogEntry) => void
}

/**
 * Create a BtEngine configured for native (QuickJS/JSC) runtime.
 */
export function createNativeEngine(config: NativeEngineConfig): BtEngine {
  const storageRootManager = new StorageRootManager((root) => {
    return new NativeFileSystem(root.key)
  })

  for (const root of config.contentRoots) {
    storageRootManager.addRoot(root)
  }

  if (config.defaultContentRoot) {
    storageRootManager.setDefaultRoot(config.defaultContentRoot)
  }

  return new BtEngine({
    socketFactory: new NativeSocketFactory(),
    storageRootManager,
    sessionStore: new NativeSessionStore(),
    hasher: new NativeHasher(),
    port: config.port,
    onLog: config.onLog,
  })
}
