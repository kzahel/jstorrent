import { BtEngine, BtEngineOptions } from '../core/bt-engine'
import {
  NodeSocketFactory,
  ScopedNodeFileSystem,
  JsonFileSessionStore,
  NodeHasher,
} from '../adapters/node'
import { StorageRootManager } from '../storage/storage-root-manager'
import { ISessionStore } from '../interfaces/session-store'
import { LogEntry } from '../logging/logger'
import * as path from 'path'

export interface NodeEngineConfig extends Partial<BtEngineOptions> {
  downloadPath: string
  sessionStore?: ISessionStore
  port?: number
  onLog?: (entry: LogEntry) => void
}

export function createNodeEngine(config: NodeEngineConfig): BtEngine {
  // Use file-based session store by default, located in the download directory
  const sessionStorePath = path.join(config.downloadPath, '.jstorrent-session.json')
  const sessionStore = config.sessionStore ?? new JsonFileSessionStore(sessionStorePath)

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
    hasher: new NodeHasher(),
    ...config, // Pass through other options like maxConnections, peerId, etc.
    port: config.port,
    onLog: config.onLog,
  })
}
