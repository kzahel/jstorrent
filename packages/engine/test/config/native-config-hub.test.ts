import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NativeConfigHub } from '../../src/adapters/native/native-config-hub'

// Mock native storage functions
const mockStorage = new Map<string, string>()

describe('NativeConfigHub', () => {
  let config: NativeConfigHub

  beforeEach(() => {
    // Clear mock storage
    mockStorage.clear()

    // Set up mock functions
    globalThis.__jstorrent_storage_get = (key: string) => {
      return mockStorage.get(key) ?? null
    }

    globalThis.__jstorrent_storage_set = (key: string, value: string) => {
      mockStorage.set(key, value)
    }

    globalThis.__jstorrent_storage_delete = (key: string) => {
      mockStorage.delete(key)
    }

    globalThis.__jstorrent_storage_keys = (prefix: string) => {
      const keys = Array.from(mockStorage.keys()).filter((k) => k.startsWith(prefix))
      return JSON.stringify(keys)
    }

    config = new NativeConfigHub()
  })

  afterEach(() => {
    // Clean up global mocks
    delete (globalThis as Record<string, unknown>).__jstorrent_storage_get
    delete (globalThis as Record<string, unknown>).__jstorrent_storage_set
    delete (globalThis as Record<string, unknown>).__jstorrent_storage_delete
    delete (globalThis as Record<string, unknown>).__jstorrent_storage_keys
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

    it('should load persisted values from storage', async () => {
      // Pre-populate mock storage
      mockStorage.set('config:theme', JSON.stringify('dark'))
      mockStorage.set('config:maxFps', JSON.stringify(120))

      await config.init()

      expect(config.theme.get()).toBe('dark')
      expect(config.maxFps.get()).toBe(120)
    })

    it('should validate loaded values', async () => {
      // Pre-populate with invalid values
      mockStorage.set('config:maxFps', JSON.stringify(999)) // Exceeds max of 240
      mockStorage.set('config:theme', JSON.stringify('invalid')) // Invalid enum value

      await config.init()

      expect(config.maxFps.get()).toBe(240) // Clamped to max
      expect(config.theme.get()).toBe('system') // Reverted to default
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

      expect(mockStorage.get('config:theme')).toBe(JSON.stringify('light'))
    })

    it('should not persist runtime values', () => {
      config.set('daemonPort', 12345)

      // Runtime values are not persisted
      expect(mockStorage.has('config:daemonPort')).toBe(false)
    })

    it('should not persist storageRoots', () => {
      const roots = [{ key: 'root1', label: 'Root 1', path: '/path/1' }]
      config.set('storageRoots', roots)

      // Storage roots are managed by Kotlin, not persisted in JS
      expect(mockStorage.has('config:storageRoots')).toBe(false)
    })
  })

  describe('setRuntime()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should update cache without persistence', () => {
      config.setRuntime('daemonPort', 12345)

      expect(config.daemonPort.get()).toBe(12345)
      expect(mockStorage.has('config:daemonPort')).toBe(false)
    })

    it('should notify subscribers', () => {
      const callback = vi.fn()
      config.daemonPort.subscribe(callback)

      config.setRuntime('daemonPort', 12345)

      expect(callback).toHaveBeenCalledWith(12345, 0)
    })

    it('should not notify when value unchanged', () => {
      const callback = vi.fn()
      config.daemonPort.subscribe(callback)

      config.setRuntime('daemonPort', 0) // Same as default

      expect(callback).not.toHaveBeenCalled()
    })

    it('should handle storageRoots', () => {
      const roots = [
        { key: 'root1', label: 'Root 1', path: '/path/1' },
        { key: 'root2', label: 'Root 2', path: '/path/2' },
      ]

      config.setRuntime('storageRoots', roots)

      expect(config.storageRoots.get()).toEqual(roots)
    })

    it('should handle defaultRootKey', () => {
      config.setRuntime('defaultRootKey', 'my-root')

      expect(config.defaultRootKey.get()).toBe('my-root')
    })

    it('should detect array changes correctly', () => {
      const roots1 = [{ key: 'root1', label: 'Root 1', path: '/path/1' }]
      const roots2 = [{ key: 'root1', label: 'Root 1', path: '/path/1' }] // Same content

      config.setRuntime('storageRoots', roots1)

      const callback = vi.fn()
      config.storageRoots.subscribe(callback)

      config.setRuntime('storageRoots', roots2) // Same content

      expect(callback).not.toHaveBeenCalled()
    })

    it('should notify on actual array changes', () => {
      const roots1 = [{ key: 'root1', label: 'Root 1', path: '/path/1' }]

      config.setRuntime('storageRoots', roots1)

      const callback = vi.fn()
      config.storageRoots.subscribe(callback)

      const roots2 = [
        { key: 'root1', label: 'Root 1', path: '/path/1' },
        { key: 'root2', label: 'Root 2', path: '/path/2' },
      ]
      config.setRuntime('storageRoots', roots2)

      expect(callback).toHaveBeenCalledWith(roots2, roots1)
    })
  })

  describe('subscribe()', () => {
    beforeEach(async () => {
      await config.init()
    })

    it('should call callback with new and old values', () => {
      const callback = vi.fn()
      config.theme.subscribe(callback)

      config.set('theme', 'dark')

      expect(callback).toHaveBeenCalledWith('dark', 'system')
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

    it('should persist all changed values', () => {
      config.batch({
        theme: 'dark',
        maxFps: 120,
      })

      expect(mockStorage.get('config:theme')).toBe(JSON.stringify('dark'))
      expect(mockStorage.get('config:maxFps')).toBe(JSON.stringify(120))
    })
  })

  describe('restart-required settings', () => {
    beforeEach(async () => {
      await config.init()
      config.setEngineRunning(true)
    })

    it('should track pending changes', () => {
      config.set('listeningPort', 12345)

      expect(config.hasPendingChange('listeningPort')).toBe(true)
      expect(config.getPendingChanges().get('listeningPort')).toBe(12345)
    })

    it('should not update cache for pending changes', () => {
      const originalPort = config.listeningPort.get()
      config.set('listeningPort', 12345)

      expect(config.listeningPort.get()).toBe(originalPort)
    })

    it('should persist pending changes to storage', () => {
      config.set('listeningPort', 12345)

      expect(mockStorage.get('config:listeningPort')).toBe(JSON.stringify(12345))
    })

    it('should apply pending changes when engine not running', () => {
      config.setEngineRunning(false)

      config.set('listeningPort', 12345)

      expect(config.listeningPort.get()).toBe(12345)
      expect(config.hasPendingChange('listeningPort')).toBe(false)
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

    it('should receive runtime value changes', () => {
      const callback = vi.fn()
      config.subscribeAll(callback)

      config.setRuntime('daemonPort', 12345)

      expect(callback).toHaveBeenCalledWith('daemonPort', 12345, 0)
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
