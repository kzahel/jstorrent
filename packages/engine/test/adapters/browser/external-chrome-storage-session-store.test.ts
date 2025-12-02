/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExternalChromeStorageSessionStore } from '../../../src/adapters/browser/external-chrome-storage-session-store'

describe('ExternalChromeStorageSessionStore', () => {
  const mockSendMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        lastError: null,
      },
    }
  })

  it('get() sends KV_GET and decodes base64 response', async () => {
    const testData = new Uint8Array([1, 2, 3, 4])
    const base64 = btoa(String.fromCharCode(...testData))

    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true, value: base64 })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.get('test-key')

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_GET', key: 'test-key' },
      expect.any(Function),
    )
    expect(result).toEqual(testData)
  })

  it('get() returns null when value is not found', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true, value: null })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.get('nonexistent-key')

    expect(result).toBeNull()
  })

  it('set() encodes to base64 and sends KV_SET', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const testData = new Uint8Array([5, 6, 7, 8])
    await store.set('test-key', testData)

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      {
        type: 'KV_SET',
        key: 'test-key',
        value: btoa(String.fromCharCode(...testData)),
      },
      expect.any(Function),
    )
  })

  it('delete() sends KV_DELETE', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    await store.delete('test-key')

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_DELETE', key: 'test-key' },
      expect.any(Function),
    )
  })

  it('keys() sends KV_KEYS with optional prefix', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true, keys: ['torrent:abc', 'torrent:def'] })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.keys('torrent:')

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_KEYS', prefix: 'torrent:' },
      expect.any(Function),
    )
    expect(result).toEqual(['torrent:abc', 'torrent:def'])
  })

  it('clear() sends KV_CLEAR', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: true })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    await store.clear()

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_CLEAR' },
      expect.any(Function),
    )
  })

  it('getMulti() batches multiple keys', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({
          ok: true,
          values: {
            key1: btoa('value1'),
            key2: btoa('value2'),
            key3: null,
          },
        })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.getMulti(['key1', 'key2', 'key3'])

    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_GET_MULTI', keys: ['key1', 'key2', 'key3'] },
      expect.any(Function),
    )
    expect(result.size).toBe(2)
    expect(new TextDecoder().decode(result.get('key1'))).toBe('value1')
    expect(new TextDecoder().decode(result.get('key2'))).toBe('value2')
    expect(result.has('key3')).toBe(false)
  })

  it('getMulti() returns empty map for empty keys array', async () => {
    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.getMulti([])

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('throws error when chrome.runtime.sendMessage is not available', async () => {
    ;(globalThis as any).chrome = {}

    const store = new ExternalChromeStorageSessionStore('test-ext-id')

    await expect(store.get('test-key')).rejects.toThrow('chrome.runtime.sendMessage not available')
  })

  it('throws error when chrome.runtime.lastError is set', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        ;(globalThis as any).chrome.runtime.lastError = { message: 'Connection failed' }
        cb(null)
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')

    await expect(store.get('test-key')).rejects.toThrow('Connection failed')
  })

  it('throws error when no response is received', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb(null)
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')

    await expect(store.get('test-key')).rejects.toThrow(
      'No response from extension - is it installed?',
    )
  })

  it('throws error when response indicates failure', async () => {
    mockSendMessage.mockImplementation(
      (_id: string, _msg: unknown, cb: (response: any) => void) => {
        cb({ ok: false, error: 'Storage quota exceeded' })
      },
    )

    const store = new ExternalChromeStorageSessionStore('test-ext-id')

    await expect(store.set('test-key', new Uint8Array([1]))).rejects.toThrow(
      'Storage quota exceeded',
    )
  })
})
