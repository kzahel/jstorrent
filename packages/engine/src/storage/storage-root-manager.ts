import { IFileSystem } from '../interfaces/filesystem'
import { StorageRoot } from './types'

export class StorageRootManager {
    private roots: Map<string, StorageRoot> = new Map()
    private torrentRoots: Map<string, string> = new Map()
    private defaultToken: string | null = null
    private createFileSystem: (root: StorageRoot) => IFileSystem
    private fsCache: Map<string, IFileSystem> = new Map()

    constructor(createFs: (root: StorageRoot) => IFileSystem) {
        this.createFileSystem = createFs
    }

    private normalizeId(id: string): string {
        return id.toLowerCase()
    }

    addRoot(root: StorageRoot): void {
        this.roots.set(root.token, root)
    }

    removeRoot(token: string): void {
        this.roots.delete(token)
        if (this.defaultToken === token) {
            this.defaultToken = null
        }
        this.fsCache.delete(token)
    }

    getRoots(): StorageRoot[] {
        return Array.from(this.roots.values())
    }

    setDefaultRoot(token: string): void {
        if (!this.roots.has(token)) {
            throw new Error(`Storage root with token ${token} not found`)
        }
        this.defaultToken = token
    }

    setRootForTorrent(torrentId: string, token: string): void {
        if (!this.roots.has(token)) {
            throw new Error(`Storage root with token ${token} not found`)
        }
        this.torrentRoots.set(this.normalizeId(torrentId), token)
    }

    getRootForTorrent(torrentId: string): StorageRoot | null {
        const token = this.torrentRoots.get(this.normalizeId(torrentId))
        if (token) {
            return this.roots.get(token) || null
        }
        if (this.defaultToken) {
            return this.roots.get(this.defaultToken) || null
        }
        return null
    }

    getFileSystemForTorrent(torrentId: string): IFileSystem {
        const root = this.getRootForTorrent(torrentId)
        if (!root) {
            throw new Error(`No storage root found for torrent ${torrentId}`)
        }

        let fs = this.fsCache.get(root.token)
        if (!fs) {
            fs = this.createFileSystem(root)
            this.fsCache.set(root.token, fs)
        }
        return fs
    }
}
