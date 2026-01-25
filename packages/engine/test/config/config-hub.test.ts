import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryConfigHub } from '../../src/config/memory-config-hub'

describe('MemoryConfigHub', () => {
  let config: MemoryConfigHub

  beforeEach(() => {
    config = new MemoryConfigHub()
  })

  describe('init', () => {
    it('should load defaults when storage is empty', async () => {
      await config.init()

      // Speed limits default to 1 MB/s (1048576 bytes) with unlimited flag true
      expect(config.downloadSpeedUnlimited.get()).toBe(true)
      expect(config.downloadSpeedLimit.get()).toBe(1048576)
      expect(config.uploadSpeedUnlimited.get()).toBe(true)
      expect(config.uploadSpeedLimit.get()).toBe(1048576)
      expect(config.maxPeersPerTorrent.get()).toBe(20)
      expect(config.theme.get()).toBe('system')
      expect(config.dhtEnabled.get()).toBe(true)
    })

    it('should load preloaded values', async () => {
      config.preloadStorage({ theme: 'dark', maxFps: 120 })
      await config.init()

      expect(config.theme.get()).toBe('dark')
      expect(config.maxFps.get()).toBe(120)
    })

    it('should validate preloaded values', async () => {
      config.preloadStorage({
        maxFps: 999, // Exceeds max of 240
        theme: 'invalid' as 'dark', // Invalid enum value
      })
      await config.init()

      expect(config.maxFps.get()).toBe(240) // Clamped
      expect(config.theme.get()).toBe('system') // Reverted to default
    })

    it('should accept initial values in constructor', async () => {
      config = new MemoryConfigHub({ theme: 'light', maxFps: 30 })
      await config.init()

      expect(config.theme.get()).toBe('light')
      expect(config.maxFps.get()).toBe(30)
    })
  })

  describe('ConfigValue.get()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should return current value', () => {
      expect(config.theme.get()).toBe('system')
      expect(config.maxPeersPerTorrent.get()).toBe(20)
    })

    it('should return updated value after set', () => {
      config.set('theme', 'dark')
      expect(config.theme.get()).toBe('dark')
    })
  })

  describe('ConfigValue.getLazy()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should return a function that gets current value', () => {
      const getTheme = config.theme.getLazy()
      expect(getTheme()).toBe('system')
    })

    it('should return fresh value when called after changes', () => {
      const getTheme = config.theme.getLazy()
      expect(getTheme()).toBe('system')

      config.set('theme', 'dark')
      expect(getTheme()).toBe('dark')
    })
  })

  describe('ConfigValue.subscribe()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should call callback with new and old values', () => {
      const callback = vi.fn()
      config.theme.subscribe(callback)

      config.set('theme', 'dark')

      expect(callback).toHaveBeenCalledWith('dark', 'system')
    })

    it('should not call callback when value unchanged', () => {
      const callback = vi.fn()
      config.theme.subscribe(callback)

      config.set('theme', 'system') // Same as default

      expect(callback).not.toHaveBeenCalled()
    })

    it('should unsubscribe correctly', () => {
      const callback = vi.fn()
      const unsubscribe = config.theme.subscribe(callback)

      unsubscribe()
      config.set('theme', 'dark')

      expect(callback).not.toHaveBeenCalled()
    })

    it('should support multiple subscribers', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      config.theme.subscribe(cb1)
      config.theme.subscribe(cb2)

      config.set('theme', 'dark')

      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
    })

    it('should handle subscriber errors gracefully', () => {
      const errorCb = vi.fn(() => {
        throw new Error('Test error')
      })
      const normalCb = vi.fn()

      config.theme.subscribe(errorCb)
      config.theme.subscribe(normalCb)

      // Should not throw
      config.set('theme', 'dark')

      expect(errorCb).toHaveBeenCalled()
      expect(normalCb).toHaveBeenCalled()
    })
  })

  describe('set()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should update cache immediately', () => {
      config.set('downloadSpeedLimit', 1024)
      expect(config.downloadSpeedLimit.get()).toBe(1024)
    })

    it('should validate values', () => {
      config.set('maxFps', -10) // Below min
      expect(config.maxFps.get()).toBe(0)

      config.set('maxFps', 500) // Above max
      expect(config.maxFps.get()).toBe(240)
    })

    it('should persist to storage', () => {
      config.set('theme', 'light')

      const storage = config.getStorageContents()
      expect(storage.get('theme')).toBe('light')
    })
  })

  describe('batch()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should update multiple values', () => {
      config.batch({
        theme: 'dark',
        maxFps: 120,
        downloadSpeedLimit: 1024,
      })

      expect(config.theme.get()).toBe('dark')
      expect(config.maxFps.get()).toBe(120)
      expect(config.downloadSpeedLimit.get()).toBe(1024)
    })

    it('should coalesce notifications', () => {
      const allCallback = vi.fn()
      config.subscribeAll(allCallback)

      config.batch({
        theme: 'dark',
        maxFps: 120,
      })

      // Each key notified once, not twice
      expect(allCallback).toHaveBeenCalledTimes(2)
      expect(allCallback).toHaveBeenCalledWith('theme', 'dark', 'system')
      expect(allCallback).toHaveBeenCalledWith('maxFps', 120, 60)
    })

    it('should skip unchanged values', () => {
      const callback = vi.fn()
      config.theme.subscribe(callback)

      config.batch({
        theme: 'system', // Unchanged
        maxFps: 120,
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('subscribeAll()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should receive all config changes', () => {
      const callback = vi.fn()
      config.subscribeAll(callback)

      config.set('theme', 'dark')
      config.set('maxFps', 120)

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith('theme', 'dark', 'system')
      expect(callback).toHaveBeenCalledWith('maxFps', 120, 60)
    })

    it('should unsubscribe correctly', () => {
      const callback = vi.fn()
      const unsubscribe = config.subscribeAll(callback)

      unsubscribe()
      config.set('theme', 'dark')

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('restart-required settings', () => {
    beforeEach(async () => {
      await config.init()
      config.setEngineRunning(true) // Simulate running engine
    })

    it('should track pending changes', () => {
      config.set('listeningPort', 12345)

      expect(config.hasPendingChange('listeningPort')).toBe(true)
      expect(config.getPendingChanges().get('listeningPort')).toBe(12345)
    })

    it('should not update cache for pending changes', () => {
      const originalPort = config.listeningPort.get()
      config.set('listeningPort', 12345)

      // Value should remain unchanged until restart
      expect(config.listeningPort.get()).toBe(originalPort)
    })

    it('should not notify subscribers for pending changes', () => {
      const callback = vi.fn()
      config.listeningPort.subscribe(callback)

      config.set('listeningPort', 12345)

      expect(callback).not.toHaveBeenCalled()
    })

    it('should persist pending changes to storage', () => {
      config.set('listeningPort', 12345)

      const storage = config.getStorageContents()
      expect(storage.get('listeningPort')).toBe(12345)
    })

    it('should apply pending changes when engine not running', async () => {
      config.setEngineRunning(false)

      config.set('listeningPort', 12345)

      expect(config.listeningPort.get()).toBe(12345)
      expect(config.hasPendingChange('listeningPort')).toBe(false)
    })

    it('should clear pending changes when engine stops', () => {
      config.set('listeningPort', 12345)
      expect(config.hasPendingChange('listeningPort')).toBe(true)

      config.setEngineRunning(false)

      expect(config.getPendingChanges().size).toBe(0)
    })
  })

  describe('array values (storageRoots)', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should handle empty array default', () => {
      expect(config.storageRoots.get()).toEqual([])
    })

    it('should update array values', () => {
      const roots = [
        { key: 'root1', label: 'Root 1', path: '/path/1' },
        { key: 'root2', label: 'Root 2', path: '/path/2' },
      ]

      config.set('storageRoots', roots)

      expect(config.storageRoots.get()).toEqual(roots)
    })

    it('should notify on array changes', () => {
      const callback = vi.fn()
      config.storageRoots.subscribe(callback)

      const roots = [{ key: 'root1', label: 'Root 1', path: '/path/1' }]
      config.set('storageRoots', roots)

      expect(callback).toHaveBeenCalledWith(roots, [])
    })

    it('should not notify when array content unchanged', () => {
      const roots = [{ key: 'root1', label: 'Root 1', path: '/path/1' }]
      config.set('storageRoots', roots)

      const callback = vi.fn()
      config.storageRoots.subscribe(callback)

      // Set identical array
      config.set('storageRoots', [{ key: 'root1', label: 'Root 1', path: '/path/1' }])

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('nullable string values', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should handle null defaults', () => {
      expect(config.defaultRootKey.get()).toBe(null)
      expect(config.daemonVersion.get()).toBe(null)
      expect(config.externalIP.get()).toBe(null)
    })

    it('should set and clear nullable values', () => {
      config.set('defaultRootKey', 'my-root')
      expect(config.defaultRootKey.get()).toBe('my-root')

      config.set('defaultRootKey', null)
      expect(config.defaultRootKey.get()).toBe(null)
    })
  })

  describe('init() idempotency', () => {
    it('should only initialize once', async () => {
      config.preloadStorage({ theme: 'dark' })

      await config.init()
      expect(config.theme.get()).toBe('dark')

      // Preload different value
      config.preloadStorage({ theme: 'light' })

      // Second init should be no-op
      await config.init()
      expect(config.theme.get()).toBe('dark')
    })

    it('should handle concurrent init calls', async () => {
      const p1 = config.init()
      const p2 = config.init()

      await Promise.all([p1, p2])

      // Should complete without error
      expect(config.theme.get()).toBe('system')
    })
  })

  describe('flush()', () => {
    it('should complete without error', async () => {
      await config.init()
      config.set('theme', 'dark')

      // Should not throw
      await config.flush()
    })
  })
})
