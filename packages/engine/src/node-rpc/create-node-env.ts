import { BtEngineOptions } from '../core/bt-engine'
import { NodeSocketFactory, ScopedNodeFileSystem } from '../adapters/node'
import { StorageRootManager } from '../storage/storage-root-manager'

export function createNodeEngineEnvironment(
  overrides: Partial<BtEngineOptions> = {},
): BtEngineOptions {
  const downloadPath = overrides.downloadPath || process.cwd()

  const storageRootManager = new StorageRootManager((root) => {
    return new ScopedNodeFileSystem(root.path)
  })

  storageRootManager.addRoot({
    token: downloadPath,
    label: 'Downloads',
    path: downloadPath,
  })
  storageRootManager.setDefaultRoot(downloadPath)

  return {
    downloadPath,
    socketFactory: new NodeSocketFactory(),
    storageRootManager,

    port: 0, // Default to auto-assign port for testing; override with specific port if needed
    ...overrides,
  }
}
