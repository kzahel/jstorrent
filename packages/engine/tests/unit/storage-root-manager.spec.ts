import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { InMemoryFileSystem } from '../../src/adapters/memory/memory-filesystem'

describe('StorageRootManager', () => {
    let manager: StorageRootManager
    let fsFactory: Mock

    beforeEach(() => {
        fsFactory = vi.fn((_root) => new InMemoryFileSystem())
        manager = new StorageRootManager(fsFactory)
    })

    it('should add and retrieve roots', () => {
        const root = { token: 'test', label: 'Test', path: '/test' }
        manager.addRoot(root)
        expect(manager.getRoots()).toContain(root)
    })

    it('should set and get default root', () => {
        const root = { token: 'test', label: 'Test', path: '/test' }
        manager.addRoot(root)
        manager.setDefaultRoot('test')
        expect(manager.getRootForTorrent('any')).toBe(root)
    })

    it('should set and get root for specific torrent', () => {
        const root1 = { token: 'root1', label: 'Root 1', path: '/root1' }
        const root2 = { token: 'root2', label: 'Root 2', path: '/root2' }
        manager.addRoot(root1)
        manager.addRoot(root2)
        manager.setDefaultRoot('root1')

        const torrentId = 'abcdef'
        manager.setRootForTorrent(torrentId, 'root2')

        expect(manager.getRootForTorrent(torrentId)).toBe(root2)
        expect(manager.getRootForTorrent('other')).toBe(root1)
    })

    it('should create filesystem using factory', () => {
        const root = { token: 'test', label: 'Test', path: '/test' }
        manager.addRoot(root)
        manager.setDefaultRoot('test')

        const fs = manager.getFileSystemForTorrent('any')
        expect(fs).toBeInstanceOf(InMemoryFileSystem)
        expect(fsFactory).toHaveBeenCalledWith(root)
    })

    it('should cache filesystem instances', () => {
        const root = { token: 'test', label: 'Test', path: '/test' }
        manager.addRoot(root)
        manager.setDefaultRoot('test')

        const fs1 = manager.getFileSystemForTorrent('any')
        const fs2 = manager.getFileSystemForTorrent('any')

        expect(fs1).toBe(fs2)
        expect(fsFactory).toHaveBeenCalledTimes(1)
    })
})
