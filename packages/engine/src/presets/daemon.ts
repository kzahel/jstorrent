import { BtEngine } from '../core/bt-engine'
import { DaemonConnection } from '../adapters/daemon/daemon-connection'
import { DaemonFileSystem } from '../adapters/daemon/daemon-filesystem'
import { DaemonSocketFactory } from '../adapters/daemon/daemon-socket-factory'
import { StorageRootManager, StorageRoot } from '../storage/storage-root-manager'
import { ISessionStore } from '../interfaces/session-store'
import { LogEntry } from '../logging/logger'
import type { ConfigHub } from '../config/config-hub'

export interface DaemonEngineConfig {
  daemon: {
    port: number
    authToken: string
  }
  contentRoots: StorageRoot[]
  defaultContentRoot?: string
  sessionStore: ISessionStore
  onLog?: (entry: LogEntry) => void
  port?: number
  /**
   * Optional ConfigHub for reactive configuration.
   */
  config?: ConfigHub
}

export async function createDaemonEngine(config: DaemonEngineConfig): Promise<BtEngine> {
  const connection = await DaemonConnection.connect(config.daemon.port, config.daemon.authToken)
  await connection.connectWebSocket()

  const storageRootManager = new StorageRootManager((root) => {
    return new DaemonFileSystem(connection, root.key)
  })

  for (const root of config.contentRoots) {
    storageRootManager.addRoot(root)
  }

  if (config.defaultContentRoot) {
    storageRootManager.setDefaultRoot(config.defaultContentRoot)
  }

  return new BtEngine({
    socketFactory: new DaemonSocketFactory(connection),
    storageRootManager,
    sessionStore: config.sessionStore,
    port: config.port,
    onLog: config.onLog,
    config: config.config,
  })
}
