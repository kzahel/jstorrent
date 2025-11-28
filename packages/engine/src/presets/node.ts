import { BtEngine, BtEngineOptions } from '../core/bt-engine'
import { NodeSocketFactory, ScopedNodeFileSystem } from '../adapters/node'
import { MemorySessionStore } from '../adapters/memory'
import { StorageRootManager } from '../storage/storage-root-manager'
import { ISessionStore } from '../interfaces/session-store'
import { LogEntry } from '../logging/logger'

export interface NodeEngineConfig extends Partial<BtEngineOptions> {
  downloadPath: string
  sessionStore?: ISessionStore
  port?: number
  onLog?: (entry: LogEntry) => void
}

export function createNodeEngine(config: NodeEngineConfig): BtEngine {
  const sessionStore = config.sessionStore ?? new MemorySessionStore()

  const storageRootManager = new StorageRootManager((root) => {
    return new ScopedNodeFileSystem(root.path)
  })

  // Register downloadPath as default root
  storageRootManager.addRoot({
    token: config.downloadPath,
    label: 'Downloads',
    path: config.downloadPath,
  })
  storageRootManager.setDefaultRoot(config.downloadPath)

  return new BtEngine({
    socketFactory: new NodeSocketFactory(),
    storageRootManager,
    sessionStore,
    ...config, // Pass through other options like maxConnections, peerId, etc.
    port: config.port,
    onLog: config.onLog,
  })
}
