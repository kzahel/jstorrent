/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleKVMessage } from '../../src/lib/kv-handlers'

describe('KV Handlers', () => {
  const mockSendResponse = vi.fn()
  const mockStorageGet = vi.fn()
  const mockStorageSet = vi.fn()
  const mockStorageRemove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).chrome = {
      storage: {
        local: {
          get: mockStorageGet,
          set: mockStorageSet,
          remove: mockStorageRemove,
        },
      },
    }
  })

  describe('KV_GET', () => {
    it('returns value with session: prefix', async () => {
      mockStorageGet.mockResolvedValue({ 'session:test-key': 'base64-value' })

      const handled = handleKVMessage({ type: 'KV_GET', key: 'test-key' }, mockSendResponse)

      expect(handled).toBe(true)
      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageGet).toHaveBeenCalledWith('session:test-key')
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: true, value: 'base64-value' })
    })

    it('returns null for missing key', async () => {
      mockStorageGet.mockResolvedValue({})

      handleKVMessage({ type: 'KV_GET', key: 'missing-key' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: true, value: null })
    })

    it('returns error on storage failure', async () => {
      mockStorageGet.mockRejectedValue(new Error('Storage error'))

      handleKVMessage({ type: 'KV_GET', key: 'test-key' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: false, error: 'Error: Storage error' })
    })
  })

  describe('KV_GET_MULTI', () => {
    it('returns values for multiple keys', async () => {
      mockStorageGet.mockResolvedValue({
        'session:key1': 'value1',
        'session:key2': 'value2',
      })

      handleKVMessage({ type: 'KV_GET_MULTI', keys: ['key1', 'key2', 'key3'] }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageGet).toHaveBeenCalledWith(['session:key1', 'session:key2', 'session:key3'])
      expect(mockSendResponse).toHaveBeenCalledWith({
        ok: true,
        values: {
          key1: 'value1',
          key2: 'value2',
          key3: null,
        },
      })
    })
  })

  describe('KV_SET', () => {
    it('stores value with session: prefix', async () => {
      mockStorageSet.mockResolvedValue(undefined)

      handleKVMessage({ type: 'KV_SET', key: 'test-key', value: 'base64-data' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageSet).toHaveBeenCalledWith({ 'session:test-key': 'base64-data' })
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: true })
    })

    it('returns error on storage failure', async () => {
      mockStorageSet.mockRejectedValue(new Error('Quota exceeded'))

      handleKVMessage({ type: 'KV_SET', key: 'test-key', value: 'data' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: false, error: 'Error: Quota exceeded' })
    })
  })

  describe('KV_DELETE', () => {
    it('removes key with session: prefix', async () => {
      mockStorageRemove.mockResolvedValue(undefined)

      handleKVMessage({ type: 'KV_DELETE', key: 'test-key' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageRemove).toHaveBeenCalledWith('session:test-key')
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: true })
    })
  })

  describe('KV_KEYS', () => {
    it('returns all session keys without prefix', async () => {
      mockStorageGet.mockResolvedValue({
        'session:torrent:abc': 'data1',
        'session:torrent:def': 'data2',
        'session:settings': 'data3',
        installId: 'non-session-key',
      })

      handleKVMessage({ type: 'KV_KEYS' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageGet).toHaveBeenCalledWith(null)
      expect(mockSendResponse).toHaveBeenCalledWith({
        ok: true,
        keys: ['torrent:abc', 'torrent:def', 'settings'],
      })
    })

    it('filters keys by prefix', async () => {
      mockStorageGet.mockResolvedValue({
        'session:torrent:abc': 'data1',
        'session:torrent:def': 'data2',
        'session:settings': 'data3',
      })

      handleKVMessage({ type: 'KV_KEYS', prefix: 'torrent:' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockSendResponse).toHaveBeenCalledWith({
        ok: true,
        keys: ['torrent:abc', 'torrent:def'],
      })
    })
  })

  describe('KV_CLEAR', () => {
    it('removes only session: prefixed keys', async () => {
      mockStorageGet.mockResolvedValue({
        'session:torrent:abc': 'data1',
        'session:settings': 'data2',
        installId: 'should-keep',
      })
      mockStorageRemove.mockResolvedValue(undefined)

      handleKVMessage({ type: 'KV_CLEAR' }, mockSendResponse)

      await vi.waitFor(() => expect(mockSendResponse).toHaveBeenCalled())
      expect(mockStorageRemove).toHaveBeenCalledWith(['session:torrent:abc', 'session:settings'])
      expect(mockSendResponse).toHaveBeenCalledWith({ ok: true })
    })
  })

  describe('Unknown message types', () => {
    it('returns false for non-KV messages', () => {
      const handled = handleKVMessage({ type: 'OTHER_MESSAGE' }, mockSendResponse)
      expect(handled).toBe(false)
      expect(mockSendResponse).not.toHaveBeenCalled()
    })
  })
})
