/**
 * Native Engine Preset
 *
 * Factory function to create a BtEngine configured for QuickJS/JSC runtimes.
 */

import { BtEngine } from '../core/bt-engine'
import { NativeSocketFactory } from '../adapters/native/native-socket-factory'
import { NativeFileSystem } from '../adapters/native/native-filesystem'
import { NullFileSystem } from '../adapters/null/null-filesystem'
import { NativeSessionStore } from '../adapters/native/native-session-store'
import { NativeHasher } from '../adapters/native/native-hasher'
import { StorageRootManager, StorageRoot } from '../storage/storage-root-manager'
import type { LogEntry } from '../logging/logger'
import type { ConfigHub } from '../config/config-hub'

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

  /**
   * Start the engine in suspended state (no network activity).
   * Use this when you need to restore session before starting networking.
   * Call engine.resume() after setup/restore is complete.
   */
  startSuspended?: boolean

  /**
   * Storage mode: 'native' uses NativeFileSystem, 'null' discards all writes.
   * Use 'null' for performance testing without I/O overhead.
   * Default: 'native'
   */
  storageMode?: 'native' | 'null'

  /**
   * Optional ConfigHub for reactive configuration.
   */
  config?: ConfigHub
}

/**
 * Create a BtEngine configured for native (QuickJS/JSC) runtime.
 */
export function createNativeEngine(config: NativeEngineConfig): BtEngine {
  const storageRootManager = new StorageRootManager((root) => {
    if (config.storageMode === 'null') {
      return new NullFileSystem()
    }
    return new NativeFileSystem(root.key)
  })

  // In null mode, add a synthetic root so the engine has a valid storage target
  // (all writes will be discarded by NullFileSystem anyway)
  if (config.storageMode === 'null') {
    const nullRoot = { key: '__null__', label: 'Null Storage', path: '/dev/null' }
    storageRootManager.addRoot(nullRoot)
    storageRootManager.setDefaultRoot('__null__')
  }

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
    startSuspended: config.startSuspended,
    config: config.config,
  })
}
