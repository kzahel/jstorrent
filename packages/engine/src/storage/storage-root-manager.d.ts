import { IFileSystem } from '../interfaces/filesystem'
export type { StorageRoot } from './types'
import { StorageRoot } from './types'
export declare class StorageRootManager {
  private roots
  private torrentRoots
  private defaultKey
  private createFileSystem
  private fsCache
  constructor(createFs: (root: StorageRoot) => IFileSystem)
  private normalizeId
  addRoot(root: StorageRoot): void
  removeRoot(key: string): void
  getRoots(): StorageRoot[]
  getDefaultRoot(): string | undefined
  setDefaultRoot(key: string): void
  setRootForTorrent(torrentId: string, key: string): void
  getRootForTorrent(torrentId: string): StorageRoot | null
  getFileSystemForTorrent(torrentId: string): IFileSystem
}
//# sourceMappingURL=storage-root-manager.d.ts.map
