import { describe, it, expect, beforeEach } from 'vitest'
import { MemorySessionStore } from '../../../src/adapters/memory/memory-session-store'

describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => {
    store = new MemorySessionStore()
  })

  it('should return null for non-existent key', async () => {
    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })

  it('should set and get a value', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    await store.set('test-key', data)
    const result = await store.get('test-key')
    expect(result).toEqual(data)
  })

  it('should delete a value', async () => {
    const data = new Uint8Array([1, 2, 3])
    await store.set('test-key', data)
    await store.delete('test-key')
    const result = await store.get('test-key')
    expect(result).toBeNull()
  })

  it('should list all keys', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.set('other', new Uint8Array([3]))

    const keys = await store.keys()
    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
    expect(keys).toContain('other')
  })

  it('should list keys with prefix filter', async () => {
    await store.set('torrent:abc:bitfield', new Uint8Array([1]))
    await store.set('torrent:abc:peers', new Uint8Array([2]))
    await store.set('torrent:def:bitfield', new Uint8Array([3]))
    await store.set('config:setting', new Uint8Array([4]))

    const torrentKeys = await store.keys('torrent:abc')
    expect(torrentKeys).toHaveLength(2)
    expect(torrentKeys).toContain('torrent:abc:bitfield')
    expect(torrentKeys).toContain('torrent:abc:peers')
  })

  it('should clear all data', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.clear()

    const keys = await store.keys()
    expect(keys).toHaveLength(0)
  })
})
