import { describe, it, expect, beforeEach } from 'vitest'
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'

describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => {
    store = new MemorySessionStore()
  })

  it('should set and get values', async () => {
    const key = 'test-key'
    const value = new Uint8Array([1, 2, 3])
    await store.set(key, value)
    const result = await store.get(key)
    expect(result).toEqual(value)
  })

  it('should return null for non-existent keys', async () => {
    const result = await store.get('non-existent')
    expect(result).toBeNull()
  })

  it('should delete values', async () => {
    const key = 'test-key'
    const value = new Uint8Array([1, 2, 3])
    await store.set(key, value)
    await store.delete(key)
    const result = await store.get(key)
    expect(result).toBeNull()
  })

  it('should list keys with prefix', async () => {
    await store.set('prefix:1', new Uint8Array([1]))
    await store.set('prefix:2', new Uint8Array([2]))
    await store.set('other:1', new Uint8Array([3]))

    const keys = await store.keys('prefix:')
    expect(keys).toHaveLength(2)
    expect(keys).toContain('prefix:1')
    expect(keys).toContain('prefix:2')
  })

  it('should clear all values', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.clear()
    const keys = await store.keys()
    expect(keys).toHaveLength(0)
  })
})
