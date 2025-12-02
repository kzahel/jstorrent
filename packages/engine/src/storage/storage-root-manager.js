export class StorageRootManager {
  constructor(createFs) {
    this.roots = new Map()
    this.torrentRoots = new Map()
    this.defaultKey = null
    this.fsCache = new Map()
    this.createFileSystem = createFs
  }
  normalizeId(id) {
    return id.toLowerCase()
  }
  addRoot(root) {
    this.roots.set(root.key, root)
  }
  removeRoot(key) {
    this.roots.delete(key)
    if (this.defaultKey === key) {
      this.defaultKey = null
    }
    this.fsCache.delete(key)
  }
  getRoots() {
    return Array.from(this.roots.values())
  }
  getDefaultRoot() {
    return this.defaultKey ?? undefined
  }
  setDefaultRoot(key) {
    if (!this.roots.has(key)) {
      throw new Error(`Storage root with key ${key} not found`)
    }
    this.defaultKey = key
  }
  setRootForTorrent(torrentId, key) {
    if (!this.roots.has(key)) {
      throw new Error(`Storage root with key ${key} not found`)
    }
    this.torrentRoots.set(this.normalizeId(torrentId), key)
  }
  getRootForTorrent(torrentId) {
    const key = this.torrentRoots.get(this.normalizeId(torrentId))
    if (key) {
      return this.roots.get(key) || null
    }
    if (this.defaultKey) {
      return this.roots.get(this.defaultKey) || null
    }
    return null
  }
  getFileSystemForTorrent(torrentId) {
    const root = this.getRootForTorrent(torrentId)
    if (!root) {
      throw new Error(`No storage root found for torrent ${torrentId}`)
    }
    let fs = this.fsCache.get(root.key)
    if (!fs) {
      fs = this.createFileSystem(root)
      this.fsCache.set(root.key, fs)
    }
    return fs
  }
}
