import { BtEngineOptions, StorageResolver } from '../core/bt-engine'
import { NodeSocketFactory, ScopedNodeFileSystem } from '../adapters/node'
import * as path from 'path'

class DefaultStorageResolver implements StorageResolver {
  constructor(private root: string) { }

  resolve(_rootKey: string, torrentId: string): string {
    // Simple implementation: join root with torrentId (or rootKey if provided)
    // For now, let's just use torrentId as a subfolder in root
    return path.join(this.root, torrentId)
  }
}

export function createNodeEngineEnvironment(
  overrides: Partial<BtEngineOptions> = {},
): BtEngineOptions {
  const downloadPath = overrides.downloadPath || process.cwd()

  return {
    downloadPath,
    socketFactory: new NodeSocketFactory(),
    fileSystem: new ScopedNodeFileSystem(downloadPath),
    storageResolver: overrides.storageResolver || new DefaultStorageResolver(downloadPath),
    port: 0, // Default to auto-assign port for testing; override with specific port if needed
    ...overrides,
  }
}
