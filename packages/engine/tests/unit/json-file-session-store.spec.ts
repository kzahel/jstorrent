import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { JsonFileSessionStore } from '../../src/adapters/node/json-file-session-store'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

describe('JsonFileSessionStore', () => {
  let store: JsonFileSessionStore
  let tmpDir: string
  let filePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jst-session-test-'))
    filePath = path.join(tmpDir, 'session.json')
    store = new JsonFileSessionStore(filePath)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
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

  it('should persist data after flush', async () => {
    const data = new Uint8Array([5, 6, 7, 8])
    await store.set('persist-key', data)
    await store.flush()

    // Create new store instance pointing to same file
    const store2 = new JsonFileSessionStore(filePath)
    const result = await store2.get('persist-key')
    expect(new Uint8Array(result!)).toEqual(data)
  })

  it('should handle missing file gracefully', async () => {
    const nonexistentPath = path.join(tmpDir, 'nonexistent', 'session.json')
    const newStore = new JsonFileSessionStore(nonexistentPath)
    const result = await newStore.get('any')
    expect(result).toBeNull()
  })

  it('should create directory on flush if needed', async () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'session.json')
    const newStore = new JsonFileSessionStore(nestedPath)
    await newStore.set('key', new Uint8Array([1]))
    await newStore.flush()

    const exists = await fs
      .access(nestedPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('should list keys with prefix filter', async () => {
    await store.set('torrent:abc:bitfield', new Uint8Array([1]))
    await store.set('torrent:def:bitfield', new Uint8Array([2]))
    await store.set('config:x', new Uint8Array([3]))

    const keys = await store.keys('torrent:')
    expect(keys).toHaveLength(2)
    expect(keys.every((k) => k.startsWith('torrent:'))).toBe(true)
  })

  it('should clear all data', async () => {
    await store.set('key1', new Uint8Array([1]))
    await store.set('key2', new Uint8Array([2]))
    await store.clear()

    const keys = await store.keys()
    expect(keys).toHaveLength(0)
  })

  it('should delete a key', async () => {
    await store.set('to-delete', new Uint8Array([1]))
    await store.delete('to-delete')
    const result = await store.get('to-delete')
    expect(result).toBeNull()
  })
})
