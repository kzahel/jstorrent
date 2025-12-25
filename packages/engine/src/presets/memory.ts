import { BtEngine } from '../core/bt-engine'
import { MemorySocketFactory, InMemoryFileSystem, MemorySessionStore } from '../adapters/memory'
import { StorageRootManager } from '../storage/storage-root-manager'
import { ISessionStore } from '../interfaces/session-store'
import { LogEntry } from '../logging/logger'
import type { ConfigHub } from '../config/config-hub'
import { MemoryConfigHub } from '../config/memory-config-hub'

export interface MemoryEngineConfig {
  sessionStore?: ISessionStore
  onLog?: (entry: LogEntry) => void
  /**
   * Optional ConfigHub. If not provided, a MemoryConfigHub is created.
   */
  config?: ConfigHub
}

export function createMemoryEngine(config: MemoryEngineConfig = {}): BtEngine {
  const sessionStore = config.sessionStore ?? new MemorySessionStore()

  // Create ConfigHub if not provided
  const configHub = config.config ?? new MemoryConfigHub()

  const storageRootManager = new StorageRootManager((_root) => {
    return new InMemoryFileSystem()
  })

  storageRootManager.addRoot({
    key: 'memory',
    label: 'Memory',
    path: '/memory',
  })
  storageRootManager.setDefaultRoot('memory')

  return new BtEngine({
    socketFactory: new MemorySocketFactory(),
    storageRootManager,
    sessionStore,
    onLog: config.onLog,
    config: configHub,
  })
}
