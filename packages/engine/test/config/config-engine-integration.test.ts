/**
 * ConfigHub Engine Integration Tests
 *
 * Tests that ConfigHub changes propagate correctly to BtEngine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { MemoryConfigHub } from '../../src/config/memory-config-hub'
import { InMemoryFileSystem, MemorySocketFactory } from '../../src/adapters/memory'
import { StorageRootManager } from '../../src/storage/storage-root-manager'

describe('ConfigHub Engine Integration', () => {
  let config: MemoryConfigHub
  let engine: BtEngine

  beforeEach(async () => {
    config = new MemoryConfigHub()
    await config.init()

    const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
    storageRootManager.addRoot({ key: 'test', label: 'Test', path: '/test' })
    storageRootManager.setDefaultRoot('test')

    engine = new BtEngine({
      socketFactory: new MemorySocketFactory(),
      storageRootManager,
      config,
    })
  })

  afterEach(async () => {
    await engine.destroy()
  })

  describe('initial values from ConfigHub', () => {
    it('should read maxGlobalPeers from config', () => {
      expect(engine.maxConnections).toBe(config.maxGlobalPeers.get())
    })

    it('should read maxPeersPerTorrent from config', () => {
      expect(engine.maxPeers).toBe(config.maxPeersPerTorrent.get())
    })

    it('should read maxUploadSlots from config', () => {
      expect(engine.maxUploadSlots).toBe(config.maxUploadSlots.get())
    })

    it('should read encryptionPolicy from config', () => {
      expect(engine.encryptionPolicy).toBe(config.encryptionPolicy.get())
    })

    it('should read download speed limit from config', () => {
      expect(engine.bandwidthTracker.getDownloadLimit()).toBe(config.downloadSpeedLimit.get())
    })

    it('should read upload speed limit from config', () => {
      expect(engine.bandwidthTracker.getUploadLimit()).toBe(config.uploadSpeedLimit.get())
    })
  })

  describe('reactive updates - rate limits', () => {
    it('should update download speed limit when config changes', () => {
      const setLimitSpy = vi.spyOn(engine.bandwidthTracker, 'setDownloadLimit')

      config.set('downloadSpeedLimit', 1000000)

      expect(setLimitSpy).toHaveBeenCalledWith(1000000)
      expect(engine.bandwidthTracker.getDownloadLimit()).toBe(1000000)
    })

    it('should update upload speed limit when config changes', () => {
      const setLimitSpy = vi.spyOn(engine.bandwidthTracker, 'setUploadLimit')

      config.set('uploadSpeedLimit', 500000)

      expect(setLimitSpy).toHaveBeenCalledWith(500000)
      expect(engine.bandwidthTracker.getUploadLimit()).toBe(500000)
    })
  })

  describe('reactive updates - connection limits', () => {
    it('should update maxGlobalPeers when config changes', () => {
      config.set('maxGlobalPeers', 500)
      expect(engine.maxConnections).toBe(500)
    })

    it('should update maxPeersPerTorrent when config changes', () => {
      config.set('maxPeersPerTorrent', 50)
      expect(engine.maxPeers).toBe(50)
    })

    it('should update maxUploadSlots when config changes', () => {
      config.set('maxUploadSlots', 8)
      expect(engine.maxUploadSlots).toBe(8)
    })
  })

  describe('reactive updates - encryption policy', () => {
    it('should update encryption policy when config changes', () => {
      config.set('encryptionPolicy', 'required')
      expect(engine.encryptionPolicy).toBe('required')
    })
  })

  describe('reactive updates - DHT and UPnP', () => {
    it('should call setDHTEnabled when dhtEnabled changes', () => {
      const spy = vi.spyOn(engine, 'setDHTEnabled')

      config.set('dhtEnabled', false)

      expect(spy).toHaveBeenCalledWith(false)
    })

    it('should call setUPnPEnabled when upnpEnabled changes', () => {
      const spy = vi.spyOn(engine, 'setUPnPEnabled')

      // upnpEnabled defaults to true, so we need to toggle it to false first
      config.set('upnpEnabled', false)
      expect(spy).toHaveBeenCalledWith(false)

      spy.mockClear()
      config.set('upnpEnabled', true)
      expect(spy).toHaveBeenCalledWith(true)
    })
  })

  describe('reactive updates - daemon rate limit', () => {
    it('should call setDaemonRateLimit when daemonOpsPerSecond changes', () => {
      const spy = vi.spyOn(engine, 'setDaemonRateLimit')

      config.set('daemonOpsPerSecond', 10)

      expect(spy).toHaveBeenCalledWith(10, config.daemonOpsBurst.get())
    })

    it('should call setDaemonRateLimit when daemonOpsBurst changes', () => {
      const spy = vi.spyOn(engine, 'setDaemonRateLimit')

      config.set('daemonOpsBurst', 30)

      expect(spy).toHaveBeenCalledWith(config.daemonOpsPerSecond.get(), 30)
    })
  })

  describe('storage roots sync', () => {
    it('should add new storage roots from config', () => {
      const newRoot = { key: 'new-root', label: 'New Root', path: '/new' }

      config.set('storageRoots', [{ key: 'test', label: 'Test', path: '/test' }, newRoot])

      const roots = engine.storageRootManager.getRoots()
      expect(roots.some((r) => r.key === 'new-root')).toBe(true)
    })

    it('should remove storage roots when removed from config', () => {
      // First add a second root
      engine.storageRootManager.addRoot({ key: 'temp', label: 'Temp', path: '/temp' })
      expect(engine.storageRootManager.getRoots().length).toBe(2)

      // Update config to only have the original root
      config.set('storageRoots', [{ key: 'test', label: 'Test', path: '/test' }])

      const roots = engine.storageRootManager.getRoots()
      expect(roots.some((r) => r.key === 'temp')).toBe(false)
    })

    it('should update default root when config changes', () => {
      const root2 = { key: 'root2', label: 'Root 2', path: '/root2' }
      engine.storageRootManager.addRoot(root2)

      config.set('defaultRootKey', 'root2')

      expect(engine.storageRootManager.getDefaultRoot()).toBe('root2')
    })
  })

  describe('cleanup on destroy', () => {
    it('should unsubscribe from config on destroy', async () => {
      // Verify engine has subscriptions
      expect(
        (engine as unknown as { configUnsubscribers: unknown[] }).configUnsubscribers.length,
      ).toBeGreaterThan(0)

      await engine.destroy()

      // After destroy, configUnsubscribers should be empty
      expect(
        (engine as unknown as { configUnsubscribers: unknown[] }).configUnsubscribers.length,
      ).toBe(0)
    })
  })
})

describe('BtEngine without ConfigHub (backward compatibility)', () => {
  it('should use individual options when config not provided', async () => {
    const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
    storageRootManager.addRoot({ key: 'test', label: 'Test', path: '/test' })
    storageRootManager.setDefaultRoot('test')

    const engine = new BtEngine({
      socketFactory: new MemorySocketFactory(),
      storageRootManager,
      maxConnections: 150,
      maxPeers: 30,
      maxUploadSlots: 6,
      encryptionPolicy: 'prefer',
    })

    expect(engine.maxConnections).toBe(150)
    expect(engine.maxPeers).toBe(30)
    expect(engine.maxUploadSlots).toBe(6)
    expect(engine.encryptionPolicy).toBe('prefer')
    expect(engine.config).toBeUndefined()

    await engine.destroy()
  })

  it('should use defaults when neither config nor individual options provided', async () => {
    const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
    storageRootManager.addRoot({ key: 'test', label: 'Test', path: '/test' })
    storageRootManager.setDefaultRoot('test')

    const engine = new BtEngine({
      socketFactory: new MemorySocketFactory(),
      storageRootManager,
    })

    // Default values
    expect(engine.maxConnections).toBe(100)
    expect(engine.maxPeers).toBe(20)
    expect(engine.maxUploadSlots).toBe(4)
    expect(engine.encryptionPolicy).toBe('disabled')

    await engine.destroy()
  })
})
