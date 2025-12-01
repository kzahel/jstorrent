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
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    expect(manager.getRoots()).toContain(root)
  })

  it('should set and get default root', () => {
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    manager.setDefaultRoot('test')
    expect(manager.getRootForTorrent('any')).toBe(root)
  })

  it('should set and get root for specific torrent', () => {
    const root1 = { key: 'root1', label: 'Root 1', path: '/root1' }
    const root2 = { key: 'root2', label: 'Root 2', path: '/root2' }
    manager.addRoot(root1)
    manager.addRoot(root2)
    manager.setDefaultRoot('root1')

    const torrentId = 'abcdef'
    manager.setRootForTorrent(torrentId, 'root2')

    expect(manager.getRootForTorrent(torrentId)).toBe(root2)
    expect(manager.getRootForTorrent('other')).toBe(root1)
  })

  it('should create filesystem using factory', () => {
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    manager.setDefaultRoot('test')

    const fs = manager.getFileSystemForTorrent('any')
    expect(fs).toBeInstanceOf(InMemoryFileSystem)
    expect(fsFactory).toHaveBeenCalledWith(root)
  })

  it('should cache filesystem instances', () => {
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    manager.setDefaultRoot('test')

    const fs1 = manager.getFileSystemForTorrent('any')
    const fs2 = manager.getFileSystemForTorrent('any')

    expect(fs1).toBe(fs2)
    expect(fsFactory).toHaveBeenCalledTimes(1)
  })

  it('should throw when setting default to non-existent root', () => {
    expect(() => manager.setDefaultRoot('nonexistent')).toThrow('not found')
  })

  it('should throw when setting torrent root to non-existent token', () => {
    expect(() => manager.setRootForTorrent('abc', 'nonexistent')).toThrow('not found')
  })

  it('should throw when getting filesystem with no root configured', () => {
    expect(() => manager.getFileSystemForTorrent('abc')).toThrow('No storage root found')
  })

  it('should remove root and clear default if it was default', () => {
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    manager.setDefaultRoot('test')
    manager.removeRoot('test')

    expect(manager.getRoots()).toHaveLength(0)
    expect(manager.getRootForTorrent('any')).toBeNull()
  })

  it('should normalize torrent IDs to lowercase', () => {
    const root = { key: 'test', label: 'Test', path: '/test' }
    manager.addRoot(root)
    manager.setDefaultRoot('test')

    manager.setRootForTorrent('ABCDEF', 'test')

    // Should find it regardless of case
    expect(manager.getRootForTorrent('abcdef')).toBe(root)
    expect(manager.getRootForTorrent('ABCDEF')).toBe(root)
    expect(manager.getRootForTorrent('AbCdEf')).toBe(root)
  })
})
