import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemorySettingsStore } from '../../src/settings/adapters/memory-settings-store'
import { getDefaults } from '../../src/settings/schema'

describe('MemorySettingsStore', () => {
  let store: MemorySettingsStore

  beforeEach(() => {
    store = new MemorySettingsStore()
  })

  describe('init', () => {
    it('should load defaults when storage is empty', async () => {
      await store.init()
      const settings = store.getAll()
      expect(settings).toEqual(getDefaults())
    })

    it('should load preloaded values', async () => {
      store.preloadStorage({ theme: 'dark', maxFps: 120 })
      await store.init()
      expect(store.get('theme')).toBe('dark')
      expect(store.get('maxFps')).toBe(120)
    })

    it('should validate preloaded values', async () => {
      store.preloadStorage({
        maxFps: 999, // Exceeds max of 240
        theme: 'invalid' as 'dark', // Invalid enum value
      })
      await store.init()
      expect(store.get('maxFps')).toBe(240) // Clamped to max
      expect(store.get('theme')).toBe('system') // Reverted to default
    })
  })

  describe('get/set', () => {
    beforeEach(async () => {
      await store.init()
    })

    it('should get default values', () => {
      expect(store.get('theme')).toBe('system')
      expect(store.get('maxFps')).toBe(60)
      expect(store.get('downloadSpeedLimit')).toBe(0)
    })

    it('should set and get values', async () => {
      await store.set('theme', 'dark')
      expect(store.get('theme')).toBe('dark')
    })

    it('should validate values on set', async () => {
      await store.set('maxFps', -10) // Below min of 0
      expect(store.get('maxFps')).toBe(0)

      await store.set('maxFps', 500) // Above max of 240
      expect(store.get('maxFps')).toBe(240)
    })

    it('should persist values to storage', async () => {
      await store.set('theme', 'light')
      const storage = store.getStorageContents()
      expect(storage.get('theme')).toBe('light')
    })
  })

  describe('subscribe', () => {
    beforeEach(async () => {
      await store.init()
    })

    it('should call callback when setting changes', async () => {
      const callback = vi.fn()
      store.subscribe('theme', callback)

      await store.set('theme', 'dark')

      expect(callback).toHaveBeenCalledWith('dark', 'system')
    })

    it('should not call callback when value unchanged', async () => {
      const callback = vi.fn()
      store.subscribe('theme', callback)

      await store.set('theme', 'system') // Same as default

      expect(callback).not.toHaveBeenCalled()
    })

    it('should unsubscribe correctly', async () => {
      const callback = vi.fn()
      const unsubscribe = store.subscribe('theme', callback)

      unsubscribe()
      await store.set('theme', 'dark')

      expect(callback).not.toHaveBeenCalled()
    })

    it('should support multiple subscribers', async () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      store.subscribe('theme', cb1)
      store.subscribe('theme', cb2)

      await store.set('theme', 'dark')

      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
    })
  })

  describe('subscribeAll', () => {
    beforeEach(async () => {
      await store.init()
    })

    it('should call callback for any setting change', async () => {
      const callback = vi.fn()
      store.subscribeAll(callback)

      await store.set('theme', 'dark')
      await store.set('maxFps', 120)

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith('theme', 'dark', 'system')
      expect(callback).toHaveBeenCalledWith('maxFps', 120, 60)
    })
  })

  describe('reset', () => {
    beforeEach(async () => {
      await store.init()
    })

    it('should reset a single setting to default', async () => {
      await store.set('theme', 'dark')
      expect(store.get('theme')).toBe('dark')

      await store.reset('theme')
      expect(store.get('theme')).toBe('system')
    })

    it('should notify subscribers on reset', async () => {
      await store.set('theme', 'dark')

      const callback = vi.fn()
      store.subscribe('theme', callback)

      await store.reset('theme')

      expect(callback).toHaveBeenCalledWith('system', 'dark')
    })

    it('should remove value from storage', async () => {
      await store.set('theme', 'dark')
      await store.reset('theme')

      const storage = store.getStorageContents()
      expect(storage.has('theme')).toBe(false)
    })
  })

  describe('resetAll', () => {
    beforeEach(async () => {
      await store.init()
    })

    it('should reset all settings to defaults', async () => {
      await store.set('theme', 'dark')
      await store.set('maxFps', 120)

      await store.resetAll()

      expect(store.getAll()).toEqual(getDefaults())
    })

    it('should clear storage', async () => {
      await store.set('theme', 'dark')
      await store.set('maxFps', 120)

      await store.resetAll()

      const storage = store.getStorageContents()
      expect(storage.size).toBe(0)
    })
  })
})
