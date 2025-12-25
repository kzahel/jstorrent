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
    it('should update dhtEnabled state when config changes', async () => {
      // dhtEnabled defaults to true
      expect(engine.dhtEnabled).toBe(true)

      config.set('dhtEnabled', false)
      // Wait for async disableDHT to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(engine.dhtEnabled).toBe(false)
    })

    it('should update upnpStatus when upnpEnabled changes', async () => {
      // upnpEnabled defaults to true, status starts as 'discovering' or 'failed' (no network in test)
      config.set('upnpEnabled', false)
      // Wait for async disableUPnP to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(engine.upnpStatus).toBe('disabled')
    })
  })

  describe('reactive updates - daemon rate limit', () => {
    it('should update daemon rate limiter when daemonOpsPerSecond changes', () => {
      const setLimitSpy = vi.spyOn(engine.daemonRateLimiter, 'setLimit')

      config.set('daemonOpsPerSecond', 10)

      // Should call setLimit with the new rate (10 ops/s) and burst window (burst / rate)
      const burst = config.daemonOpsBurst.get()
      expect(setLimitSpy).toHaveBeenCalledWith(10, burst / 10)
    })

    it('should update daemon rate limiter when daemonOpsBurst changes', () => {
      const setLimitSpy = vi.spyOn(engine.daemonRateLimiter, 'setLimit')

      config.set('daemonOpsBurst', 30)

      // Should call setLimit with current rate and new burst window
      const opsPerSec = config.daemonOpsPerSecond.get()
      expect(setLimitSpy).toHaveBeenCalledWith(opsPerSec, 30 / Math.max(1, opsPerSec))
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

  describe('initial values applied on resume', () => {
    let suspendedEngine: BtEngine

    beforeEach(async () => {
      const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
      storageRootManager.addRoot({ key: 'test', label: 'Test', path: '/test' })
      storageRootManager.setDefaultRoot('test')

      suspendedEngine = new BtEngine({
        socketFactory: new MemorySocketFactory(),
        storageRootManager,
        config,
        startSuspended: true,
      })
    })

    afterEach(async () => {
      await suspendedEngine.destroy()
    })

    it('should call enableDHT when engine resumes if dhtEnabled is true', () => {
      // Disable UPnP to avoid interference with this DHT test
      config.set('upnpEnabled', false)
      config.set('dhtEnabled', true)
      const spy = vi
        .spyOn(suspendedEngine as unknown as { enableDHT: () => Promise<void> }, 'enableDHT')
        .mockResolvedValue(undefined)

      suspendedEngine.resume()

      expect(spy).toHaveBeenCalled()
    })

    it('should NOT call enableDHT when engine resumes if dhtEnabled is false', () => {
      // Disable UPnP to avoid interference with this DHT test
      config.set('upnpEnabled', false)
      config.set('dhtEnabled', false)
      const spy = vi
        .spyOn(suspendedEngine as unknown as { enableDHT: () => Promise<void> }, 'enableDHT')
        .mockResolvedValue(undefined)

      suspendedEngine.resume()

      expect(spy).not.toHaveBeenCalled()
    })

    it('should call enableUPnP when engine resumes if upnpEnabled is true', () => {
      // Disable DHT to avoid interference with this UPnP test
      config.set('dhtEnabled', false)
      config.set('upnpEnabled', true)
      const spy = vi
        .spyOn(suspendedEngine as unknown as { enableUPnP: () => Promise<void> }, 'enableUPnP')
        .mockResolvedValue(undefined)

      suspendedEngine.resume()

      expect(spy).toHaveBeenCalled()
    })

    it('should NOT call enableUPnP when engine resumes if upnpEnabled is false', () => {
      // Disable DHT to avoid interference with this UPnP test
      config.set('dhtEnabled', false)
      config.set('upnpEnabled', false)
      const spy = vi
        .spyOn(suspendedEngine as unknown as { enableUPnP: () => Promise<void> }, 'enableUPnP')
        .mockResolvedValue(undefined)

      suspendedEngine.resume()

      expect(spy).not.toHaveBeenCalled()
    })

    it('should not call applyInitialConfig when engine is not suspended', async () => {
      // Disable DHT and UPnP to avoid them starting automatically
      config.set('dhtEnabled', false)
      config.set('upnpEnabled', false)

      // Engine created without startSuspended should not be suspended
      const normalEngine = new BtEngine({
        socketFactory: new MemorySocketFactory(),
        storageRootManager: suspendedEngine.storageRootManager,
        config,
      })

      const enableDHTSpy = vi
        .spyOn(normalEngine as unknown as { enableDHT: () => Promise<void> }, 'enableDHT')
        .mockResolvedValue(undefined)

      // Calling resume() on non-suspended engine should be a no-op
      normalEngine.resume()

      expect(enableDHTSpy).not.toHaveBeenCalled()

      await normalEngine.destroy()
    })
  })
})

describe('BtEngine with individual options (mapped to internal ConfigHub)', () => {
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
    // Now engine always has a ConfigHub (created internally if not provided)
    expect(engine.config).toBeDefined()
    expect(engine.config!.maxGlobalPeers.get()).toBe(150)

    await engine.destroy()
  })

  it('should use ConfigHub defaults when neither config nor individual options provided', async () => {
    const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
    storageRootManager.addRoot({ key: 'test', label: 'Test', path: '/test' })
    storageRootManager.setDefaultRoot('test')

    const engine = new BtEngine({
      socketFactory: new MemorySocketFactory(),
      storageRootManager,
    })

    // ConfigHub defaults (from config-schema.ts)
    expect(engine.maxConnections).toBe(200) // maxGlobalPeers default
    expect(engine.maxPeers).toBe(20) // maxPeersPerTorrent default
    expect(engine.maxUploadSlots).toBe(4)
    expect(engine.encryptionPolicy).toBe('allow') // ConfigHub default

    await engine.destroy()
  })
})
