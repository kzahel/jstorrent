import { IFileSystem } from '../interfaces/filesystem'
export type { StorageRoot } from './types'
import { StorageRoot } from './types'

export class MissingStorageRootError extends Error {
  constructor(public readonly torrentId: string) {
    super(`No storage root found for torrent ${torrentId}`)
    this.name = 'MissingStorageRootError'
  }
}

export class StorageRootManager {
  private roots: Map<string, StorageRoot> = new Map()
  private torrentRoots: Map<string, string> = new Map()
  private defaultKey: string | null = null
  private createFileSystem: (root: StorageRoot) => IFileSystem
  private fsCache: Map<string, IFileSystem> = new Map()

  constructor(createFs: (root: StorageRoot) => IFileSystem) {
    this.createFileSystem = createFs
  }

  private normalizeId(id: string): string {
    return id.toLowerCase()
  }

  addRoot(root: StorageRoot): void {
    this.roots.set(root.key, root)
  }

  removeRoot(key: string): void {
    this.roots.delete(key)
    if (this.defaultKey === key) {
      this.defaultKey = null
    }
    this.fsCache.delete(key)
  }

  getRoots(): StorageRoot[] {
    return Array.from(this.roots.values())
  }

  getDefaultRoot(): string | undefined {
    return this.defaultKey ?? undefined
  }

  setDefaultRoot(key: string): void {
    if (!this.roots.has(key)) {
      throw new Error(`Storage root with key ${key} not found`)
    }
    this.defaultKey = key
  }

  /**
   * Set the storage root for a torrent.
   * @returns true if the root was set, false if the root key doesn't exist
   */
  setRootForTorrent(torrentId: string, key: string): boolean {
    if (!this.roots.has(key)) {
      // Don't throw - the torrent can still be added in error state
      // Later, getFileSystemForTorrent() will throw MissingStorageRootError
      return false
    }
    this.torrentRoots.set(this.normalizeId(torrentId), key)
    return true
  }

  getRootForTorrent(torrentId: string): StorageRoot | null {
    const key = this.torrentRoots.get(this.normalizeId(torrentId))
    if (key) {
      return this.roots.get(key) || null
    }
    if (this.defaultKey) {
      return this.roots.get(this.defaultKey) || null
    }
    return null
  }

  getFileSystemForTorrent(torrentId: string): IFileSystem {
    const root = this.getRootForTorrent(torrentId)
    if (!root) {
      throw new MissingStorageRootError(torrentId)
    }

    let fs = this.fsCache.get(root.key)
    if (!fs) {
      fs = this.createFileSystem(root)
      this.fsCache.set(root.key, fs)
    }
    return fs
  }
}
