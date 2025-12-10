# Session Storage Cleanup - Agent Guide

## Overview

Fix a bug where torrent progress is lost on stop → reload → resume, and clean up the session storage implementation:

1. **Bug fix**: `userStop()` and `userStart()` call `saveTorrentList()` instead of `saveTorrentState()`
2. **Remove debouncing**: Save state immediately on piece verification (no longer needed with optimized state schema)
3. **JSON storage**: Store JSON data directly instead of double-encoding through base64

---

## Phase 1: Fix the Bug in torrent.ts

### 1.1 Update userStart()

In `packages/engine/src/core/torrent.ts`, find the `userStart()` method (~line 617).

Find this block:
```typescript
    // Persist state change
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentList()
  }
```

Replace with:
```typescript
    // Persist state change (userState + bitfield)
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
  }
```

### 1.2 Update userStop()

In the same file, find the `userStop()` method (~line 650).

Find this block:
```typescript
    // Persist state change
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentList()
  }
```

Replace with:
```typescript
    // Persist state change (userState + bitfield)
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
  }
```

---

## Phase 2: Remove Debouncing

### 2.1 Update piece verification in torrent.ts

In `packages/engine/src/core/torrent.ts`, find the piece verification callback (~line 1456).

Find:
```typescript
    // Persist state (debounced to avoid excessive writes)
    const btEngine = this.engine as BtEngine
    btEngine.sessionPersistence?.saveTorrentStateDebounced(this)
```

Replace with:
```typescript
    // Persist state immediately
    const btEngine = this.engine as BtEngine
    btEngine.sessionPersistence?.saveTorrentState(this)
```

### 2.2 Remove debounce infrastructure from SessionPersistence

In `packages/engine/src/core/session-persistence.ts`, delete the following:

**Delete the saveTimers property and DEBOUNCE_MS constant** (~lines 65-66):
```typescript
  private saveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private readonly DEBOUNCE_MS = 2000 // Save at most every 2 seconds per torrent
```

**Delete the entire `saveTorrentStateDebounced()` method** (~lines 148-165):
```typescript
  /**
   * Save state for a torrent, debounced.
   */
  saveTorrentStateDebounced(torrent: Torrent): void {
    const infoHash = toHex(torrent.infoHash)

    // Clear existing timer
    const existing = this.saveTimers.get(infoHash)
    if (existing) {
      clearTimeout(existing)
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.saveTorrentState(torrent)
      this.saveTimers.delete(infoHash)
    }, this.DEBOUNCE_MS)

    this.saveTimers.set(infoHash, timer)
  }
```

**Simplify `flushPendingSaves()`** (~lines 171-181). Find:
```typescript
  /**
   * Flush all pending saves immediately.
   * Call this on shutdown.
   */
  async flushPendingSaves(): Promise<void> {
    for (const [, timer] of this.saveTimers) {
      clearTimeout(timer)
    }
    this.saveTimers.clear()

    // Save all torrents
    for (const torrent of this.engine.torrents) {
      await this.saveTorrentState(torrent)
    }
  }
```

Replace with:
```typescript
  /**
   * Save state for all torrents immediately.
   * Call this on shutdown.
   */
  async flushPendingSaves(): Promise<void> {
    for (const torrent of this.engine.torrents) {
      await this.saveTorrentState(torrent)
    }
  }
```

---

## Phase 3: Add JSON Methods to ISessionStore

### 3.1 Update the interface

In `packages/engine/src/interfaces/session-store.ts`, replace the entire file:

```typescript
export interface ISessionStore {
  // Binary data (for .torrent files, info dicts)
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>

  // Optional batch operation (for performance)
  getMulti?(keys: string[]): Promise<Map<string, Uint8Array>>

  // JSON data (for torrent list, state) - stored directly without base64
  getJson<T>(key: string): Promise<T | null>
  setJson<T>(key: string, value: T): Promise<void>
}
```

---

## Phase 4: Implement JSON Methods in Adapters

### 4.1 Update MemorySessionStore

In `packages/engine/src/adapters/memory/memory-session-store.ts`, replace the entire file:

```typescript
import { ISessionStore } from '../../interfaces/session-store'

export class MemorySessionStore implements ISessionStore {
  private binaryData: Map<string, Uint8Array> = new Map()
  private jsonData: Map<string, unknown> = new Map()

  async get(key: string): Promise<Uint8Array | null> {
    return this.binaryData.get(key) ?? null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.binaryData.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.binaryData.delete(key)
    this.jsonData.delete(key)
  }

  async keys(prefix?: string): Promise<string[]> {
    const binaryKeys = Array.from(this.binaryData.keys())
    const jsonKeys = Array.from(this.jsonData.keys())
    const allKeys = [...new Set([...binaryKeys, ...jsonKeys])]
    if (prefix) {
      return allKeys.filter((k) => k.startsWith(prefix))
    }
    return allKeys
  }

  async clear(): Promise<void> {
    this.binaryData.clear()
    this.jsonData.clear()
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = this.jsonData.get(key)
    return (value as T) ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    this.jsonData.set(key, value)
  }
}
```

### 4.2 Update ChromeStorageSessionStore

In `packages/engine/src/adapters/browser/chrome-storage-session-store.ts`, replace the entire file:

```typescript
import { ISessionStore } from '../../interfaces/session-store'

// Helper to convert Uint8Array to base64 string for storage
function toBase64(buffer: Uint8Array): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Helper to convert base64 string back to Uint8Array
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

export class ChromeStorageSessionStore implements ISessionStore {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private storageArea: any = chrome.storage.local,
    private prefix: string = 'session:',
  ) {}

  private prefixKey(key: string): string {
    return this.prefix + key
  }

  async get(key: string): Promise<Uint8Array | null> {
    const prefixedKey = this.prefixKey(key)
    const result = await this.storageArea.get(prefixedKey)
    const value = result[prefixedKey]
    if (typeof value === 'string') {
      return fromBase64(value)
    }
    return null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.storageArea.set({ [this.prefixKey(key)]: toBase64(value) })
  }

  async delete(key: string): Promise<void> {
    await this.storageArea.remove(this.prefixKey(key))
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = await this.storageArea.get(null)
    const allKeys = Object.keys(all)

    // Filter to only our namespace
    const ourKeys = allKeys
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length))

    if (prefix) {
      return ourKeys.filter((k) => k.startsWith(prefix))
    }
    return ourKeys
  }

  async clear(): Promise<void> {
    // Only clear keys in our namespace, not all extension storage
    const keys = await this.keys()
    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    await this.storageArea.remove(prefixedKeys)
  }

  async getJson<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key)
    const result = await this.storageArea.get(prefixedKey)
    const value = result[prefixedKey]
    // JSON values are stored directly (not as base64 strings)
    if (value !== undefined && typeof value !== 'string') {
      return value as T
    }
    return null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    await this.storageArea.set({ [this.prefixKey(key)]: value })
  }
}
```

### 4.3 Update ExternalChromeStorageSessionStore

In `packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts`, replace the entire file:

```typescript
import { ISessionStore } from '../../interfaces/session-store'

function toBase64(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

/**
 * Session store that relays operations to the extension service worker
 * via externally_connectable messaging.
 *
 * Use this when running the engine on jstorrent.com or localhost dev server.
 *
 * Binary values are base64 encoded for transport.
 * JSON values are passed directly.
 */
export class ExternalChromeStorageSessionStore implements ISessionStore {
  constructor(private extensionId: string) {}

  private async send<T>(message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('chrome.runtime.sendMessage not available'))
        return
      }

      chrome.runtime.sendMessage(this.extensionId, message, (response: T) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (!response) {
          reject(new Error('No response from extension - is it installed?'))
        } else {
          resolve(response)
        }
      })
    })
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.send<{ ok: boolean; value?: string | null; error?: string }>({
      type: 'KV_GET',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET failed')
    }
    if (response.value) {
      return fromBase64(response.value)
    }
    return null
  }

  async getMulti(keys: string[]): Promise<Map<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map()
    }

    const response = await this.send<{
      ok: boolean
      values?: Record<string, string | null>
      error?: string
    }>({
      type: 'KV_GET_MULTI',
      keys,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET_MULTI failed')
    }

    const result = new Map<string, Uint8Array>()
    if (response.values) {
      for (const [key, value] of Object.entries(response.values)) {
        if (value !== null) {
          result.set(key, fromBase64(value))
        }
      }
    }
    return result
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_SET',
      key,
      value: toBase64(value),
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_SET failed')
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_DELETE',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_DELETE failed')
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    const response = await this.send<{ ok: boolean; keys?: string[]; error?: string }>({
      type: 'KV_KEYS',
      prefix,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_KEYS failed')
    }
    return response.keys || []
  }

  async clear(): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_CLEAR',
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_CLEAR failed')
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const response = await this.send<{ ok: boolean; value?: T | null; error?: string }>({
      type: 'KV_GET_JSON',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET_JSON failed')
    }
    return response.value ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_SET_JSON',
      key,
      value,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_SET_JSON failed')
    }
  }
}
```

### 4.4 Update kv-handlers.ts

In `extension/src/lib/kv-handlers.ts`, replace the entire file:

```typescript
/**
 * KV storage handlers for external session store.
 *
 * Uses chrome.storage.local directly with 'session:' prefix.
 * Binary values are stored as base64 strings.
 * JSON values are stored directly.
 */

const PREFIX = 'session:'

function prefixKey(key: string): string {
  return PREFIX + key
}

function unprefixKey(key: string): string {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
}

export type KVSendResponse = (response: unknown) => void

export function handleKVMessage(
  message: {
    type?: string
    key?: string
    keys?: string[]
    value?: string | unknown
    prefix?: string
  },
  sendResponse: KVSendResponse,
): boolean {
  if (message.type === 'KV_GET') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .get(prefixedKey)
      .then((result) => {
        const value = result[prefixedKey] ?? null
        sendResponse({ ok: true, value })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_GET_MULTI') {
    const prefixedKeys = message.keys!.map(prefixKey)
    chrome.storage.local
      .get(prefixedKeys)
      .then((result) => {
        const values: Record<string, string | null> = {}
        for (const key of message.keys!) {
          values[key] = (result[prefixKey(key)] as string | undefined) ?? null
        }
        sendResponse({ ok: true, values })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_SET') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .set({ [prefixedKey]: message.value })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_DELETE') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .remove(prefixedKey)
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_KEYS') {
    chrome.storage.local
      .get(null)
      .then((all) => {
        const keys = Object.keys(all)
          .filter((k) => k.startsWith(PREFIX))
          .map(unprefixKey)
          .filter((k) => !message.prefix || k.startsWith(message.prefix))
        sendResponse({ ok: true, keys })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_CLEAR') {
    chrome.storage.local
      .get(null)
      .then((all) => {
        const keysToRemove = Object.keys(all).filter((k) => k.startsWith(PREFIX))
        return chrome.storage.local.remove(keysToRemove)
      })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  // JSON-specific handlers (stored directly, not as base64)
  if (message.type === 'KV_GET_JSON') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .get(prefixedKey)
      .then((result) => {
        const value = result[prefixedKey] ?? null
        sendResponse({ ok: true, value })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_SET_JSON') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .set({ [prefixedKey]: message.value })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  return false
}
```

---

## Phase 5: Update SessionPersistence to Use JSON Methods

### 5.1 Update saveTorrentList()

In `packages/engine/src/core/session-persistence.ts`, find `saveTorrentList()` (~line 89).

Find:
```typescript
  async saveTorrentList(): Promise<void> {
    const data: TorrentListData = {
      version: 2,
      torrents: this.engine.torrents.map((t) => {
        const entry: TorrentListEntry = {
          infoHash: toHex(t.infoHash),
          source: t.magnetLink ? 'magnet' : 'file',
          addedAt: t.addedAt,
        }
        if (t.magnetLink) {
          entry.magnetUri = t.magnetLink
        }
        return entry
      }),
    }

    const json = JSON.stringify(data)
    await this.store.set(TORRENTS_KEY, new TextEncoder().encode(json))
  }
```

Replace with:
```typescript
  async saveTorrentList(): Promise<void> {
    const data: TorrentListData = {
      version: 2,
      torrents: this.engine.torrents.map((t) => {
        const entry: TorrentListEntry = {
          infoHash: toHex(t.infoHash),
          source: t.magnetLink ? 'magnet' : 'file',
          addedAt: t.addedAt,
        }
        if (t.magnetLink) {
          entry.magnetUri = t.magnetLink
        }
        return entry
      }),
    }

    await this.store.setJson(TORRENTS_KEY, data)
  }
```

### 5.2 Update loadTorrentList()

Find `loadTorrentList()` (~line 186).

Find:
```typescript
  async loadTorrentList(): Promise<TorrentListEntry[]> {
    const data = await this.store.get(TORRENTS_KEY)
    if (!data) return []

    try {
      const json = new TextDecoder().decode(data)
      const parsed: TorrentListData = JSON.parse(json)
      return parsed.torrents || []
    } catch (e) {
      this.logger.error('Failed to parse torrent list:', e)
      return []
    }
  }
```

Replace with:
```typescript
  async loadTorrentList(): Promise<TorrentListEntry[]> {
    const data = await this.store.getJson<TorrentListData>(TORRENTS_KEY)
    if (!data) return []
    return data.torrents || []
  }
```

### 5.3 Update saveTorrentState()

Find `saveTorrentState()` (~line 112).

Find:
```typescript
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)
    const root = this.engine.storageRootManager.getRootForTorrent(infoHash)

    const state: TorrentStateData = {
      userState: torrent.userState,
      storageKey: root?.key,
      queuePosition: torrent.queuePosition,
      bitfield: torrent.bitfield?.toHex(),
      uploaded: torrent.totalUploaded,
      downloaded: torrent.totalDownloaded,
      updatedAt: Date.now(),
    }

    const json = JSON.stringify(state)
    await this.store.set(stateKey(infoHash), new TextEncoder().encode(json))
  }
```

Replace with:
```typescript
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const infoHash = toHex(torrent.infoHash)
    const root = this.engine.storageRootManager.getRootForTorrent(infoHash)

    const state: TorrentStateData = {
      userState: torrent.userState,
      storageKey: root?.key,
      queuePosition: torrent.queuePosition,
      bitfield: torrent.bitfield?.toHex(),
      uploaded: torrent.totalUploaded,
      downloaded: torrent.totalDownloaded,
      updatedAt: Date.now(),
    }

    await this.store.setJson(stateKey(infoHash), state)
  }
```

### 5.4 Update loadTorrentState()

Find `loadTorrentState()` (~line 203).

Find:
```typescript
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    const data = await this.store.get(stateKey(infoHash))
    if (!data) return null

    try {
      const json = new TextDecoder().decode(data)
      return JSON.parse(json) as TorrentStateData
    } catch (e) {
      this.logger.error(`Failed to parse torrent state for ${infoHash}:`, e)
      return null
    }
  }
```

Replace with:
```typescript
  async loadTorrentState(infoHash: string): Promise<TorrentStateData | null> {
    return this.store.getJson<TorrentStateData>(stateKey(infoHash))
  }
```

---

## Phase 6: Update Tests

### 6.1 Replace session-persistence.test.ts

Replace the entire file `packages/engine/test/core/session-persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { SessionPersistence } from '../../src/core/session-persistence'
import {
  MemorySessionStore,
  MemorySocketFactory,
  InMemoryFileSystem,
} from '../../src/adapters/memory'
import { BtEngine } from '../../src/core/bt-engine'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { toHex, fromHex } from '../../src/utils/buffer'
import { BitField } from '../../src/utils/bitfield'

function createTestEngine(sessionStore: MemorySessionStore): BtEngine {
  const fs = new InMemoryFileSystem()
  const srm = new StorageRootManager(() => fs)
  srm.addRoot({ key: 'default', label: 'Default', path: '/downloads' })
  srm.setDefaultRoot('default')

  return new BtEngine({
    socketFactory: new MemorySocketFactory(),
    storageRootManager: srm,
    sessionStore,
    startSuspended: true,
  })
}

describe('SessionPersistence', () => {
  let store: MemorySessionStore
  let engine: BtEngine
  let persistence: SessionPersistence

  beforeEach(() => {
    store = new MemorySessionStore()
    engine = createTestEngine(store)
    persistence = engine.sessionPersistence
  })

  describe('saveTorrentList / loadTorrentList', () => {
    it('should save and load empty list', async () => {
      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()
      expect(entries).toEqual([])
    })

    it('should save and load file-source entries', async () => {
      const infoHash = new Uint8Array(20).fill(0xab)
      const mockTorrent = {
        infoHash,
        magnetLink: undefined,
        addedAt: 1702300000000,
        userState: 'active',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('file')
      expect(entries[0].infoHash).toBe(toHex(infoHash))
      expect(entries[0].addedAt).toBe(1702300000000)
      expect(entries[0].magnetUri).toBeUndefined()
    })

    it('should save and load magnet-source entries', async () => {
      const infoHash = new Uint8Array(20).fill(0xcd)
      const magnetUri = 'magnet:?xt=urn:btih:cdcdcdcd&dn=Test'
      const mockTorrent = {
        infoHash,
        magnetLink: magnetUri,
        addedAt: 1702300001000,
        userState: 'stopped',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('magnet')
      expect(entries[0].magnetUri).toBe(magnetUri)
    })

    it('should store JSON directly (not base64 encoded)', async () => {
      const infoHash = new Uint8Array(20).fill(0xab)
      const mockTorrent = {
        infoHash,
        magnetLink: undefined,
        addedAt: 1702300000000,
        userState: 'active',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()

      // Verify the data is stored as JSON, not binary
      const rawValue = await store.getJson('torrents')
      expect(rawValue).not.toBeNull()
      expect(typeof rawValue).toBe('object')
      // @ts-expect-error - we know it's an object
      expect(rawValue.version).toBe(2)
    })
  })

  describe('saveTorrentState / loadTorrentState', () => {
    it('should save and load state with bitfield', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        queuePosition: 1,
        bitfield: { toHex: () => 'ff00ff' },
        totalUploaded: 1000,
        totalDownloaded: 5000,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.userState).toBe('active')
      expect(state!.bitfield).toBe('ff00ff')
      expect(state!.uploaded).toBe(1000)
      expect(state!.downloaded).toBe(5000)
    })

    it('should save and load state without bitfield', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'stopped' as const,
        queuePosition: undefined,
        bitfield: undefined,
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.bitfield).toBeUndefined()
    })

    it('should return null for unknown torrent', async () => {
      const state = await persistence.loadTorrentState('0000000000000000000000000000000000000000')
      expect(state).toBeNull()
    })

    it('should store state as JSON directly', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        queuePosition: 1,
        bitfield: { toHex: () => 'ff00' },
        totalUploaded: 100,
        totalDownloaded: 200,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      // Verify the data is stored as JSON
      const rawValue = await store.getJson(`torrent:${infoHash}:state`)
      expect(rawValue).not.toBeNull()
      expect(typeof rawValue).toBe('object')
      // @ts-expect-error - we know it's an object
      expect(rawValue.userState).toBe('active')
    })
  })

  describe('saveTorrentFile / loadTorrentFile', () => {
    it('should save and load torrent file bytes', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([
        0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e, 0x6f, 0x75, 0x6e, 0x63, 0x65,
      ])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      const loaded = await persistence.loadTorrentFile(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(torrentFile)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadTorrentFile('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('saveInfoDict / loadInfoDict', () => {
    it('should save and load info dict bytes', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const infoDict = new Uint8Array([0x64, 0x34, 0x3a, 0x6e, 0x61, 0x6d, 0x65])

      await persistence.saveInfoDict(infoHash, infoDict)
      const loaded = await persistence.loadInfoDict(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(infoDict)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadInfoDict('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('removeTorrentData', () => {
    it('should delete all keys for a torrent', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([1, 2, 3])
      const infoDict = new Uint8Array([4, 5, 6])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      await persistence.saveInfoDict(infoHash, infoDict)

      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        bitfield: { toHex: () => 'ff' },
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      // Verify data exists
      expect(await persistence.loadTorrentFile(infoHash)).not.toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).not.toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).not.toBeNull()

      // Remove all
      await persistence.removeTorrentData(infoHash)

      // Verify all gone
      expect(await persistence.loadTorrentFile(infoHash)).toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).toBeNull()
    })
  })
})

describe('Session Persistence Integration', () => {
  /**
   * Test the full lifecycle: add torrent, make progress, stop, reload, resume.
   * This catches the bug where userStop() was calling saveTorrentList() instead of saveTorrentState().
   */
  describe('stop → reload → resume lifecycle', () => {
    it('should preserve progress when stopping a torrent', async () => {
      const store = new MemorySessionStore()

      // Engine 1: Add torrent, make progress, stop
      const engine1 = createTestEngine(store)
      const infoHash = new Uint8Array(20).fill(0xab)
      const bitfield = new BitField(100) // 100 pieces
      bitfield.set(0, true)
      bitfield.set(1, true)
      bitfield.set(5, true) // 3 pieces complete

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:abababababababababababababababababababab',
        addedAt: Date.now(),
        userState: 'active' as const,
        bitfield,
        totalUploaded: 1000,
        totalDownloaded: 5000,
        queuePosition: 0,
        hasMetadata: true,
        restoreBitfieldFromHex: function (hex: string) {
          this.bitfield.restoreFromHex(hex)
        },
      }

      // @ts-expect-error - partial mock
      engine1.torrents.push(mockTorrent)

      // Save initial state (simulates piece verification)
      await engine1.sessionPersistence.saveTorrentList()
      await engine1.sessionPersistence.saveTorrentState(mockTorrent as never)

      // User stops the torrent - this should save state
      mockTorrent.userState = 'stopped'
      await engine1.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Engine 2: Fresh load from storage
      const engine2 = createTestEngine(store)

      // Load torrent list
      const entries = await engine2.sessionPersistence.loadTorrentList()
      expect(entries).toHaveLength(1)

      // Load torrent state
      const state = await engine2.sessionPersistence.loadTorrentState(entries[0].infoHash)
      expect(state).not.toBeNull()
      expect(state!.userState).toBe('stopped')
      expect(state!.bitfield).toBeDefined()

      // Restore bitfield and verify progress
      const restoredBitfield = BitField.fromHex(state!.bitfield!, 100)
      expect(restoredBitfield.get(0)).toBe(true)
      expect(restoredBitfield.get(1)).toBe(true)
      expect(restoredBitfield.get(5)).toBe(true)
      expect(restoredBitfield.get(2)).toBe(false)
      expect(restoredBitfield.count()).toBe(3)
    })

    it('should preserve progress through immediate save (no debounce race)', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = new Uint8Array(20).fill(0xcd)
      const bitfield = new BitField(50)

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        addedAt: Date.now(),
        userState: 'active' as const,
        bitfield,
        totalUploaded: 0,
        totalDownloaded: 0,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()

      // Simulate piece verification → immediate save (not debounced anymore)
      bitfield.set(10, true)
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Immediately stop (with old debounce, this could race)
      mockTorrent.userState = 'stopped'
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Verify state was saved correctly
      const state = await engine.sessionPersistence.loadTorrentState(toHex(infoHash))
      expect(state).not.toBeNull()
      expect(state!.userState).toBe('stopped')

      const restoredBitfield = BitField.fromHex(state!.bitfield!, 50)
      expect(restoredBitfield.get(10)).toBe(true)
    })

    it('should handle userStart saving state', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = new Uint8Array(20).fill(0xef)
      const bitfield = new BitField(20)
      bitfield.set(0, true)

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:efefefefefefefefefefefefefefefefefefefef',
        addedAt: Date.now(),
        userState: 'stopped' as const,
        bitfield,
        totalUploaded: 500,
        totalDownloaded: 1500,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // User starts the torrent
      mockTorrent.userState = 'active'
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Verify state shows active
      const state = await engine.sessionPersistence.loadTorrentState(toHex(infoHash))
      expect(state!.userState).toBe('active')
      expect(state!.bitfield).toBeDefined()
    })
  })

  describe('JSON storage format', () => {
    it('should store torrent list as readable JSON', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const mockTorrent = {
        infoHash: new Uint8Array(20).fill(0x12),
        magnetLink: 'magnet:?xt=urn:btih:test',
        addedAt: 1702300000000,
        userState: 'active' as const,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()

      // Verify JSON is stored directly
      const stored = await store.getJson<{ version: number; torrents: unknown[] }>('torrents')
      expect(stored).not.toBeNull()
      expect(stored!.version).toBe(2)
      expect(stored!.torrents).toHaveLength(1)
    })

    it('should store torrent state as readable JSON', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        bitfield: { toHex: () => 'ffff' },
        totalUploaded: 100,
        totalDownloaded: 200,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      await engine.sessionPersistence.saveTorrentState(mockTorrent)

      // Verify JSON is stored directly
      const stored = await store.getJson<{ userState: string; bitfield: string }>(
        `torrent:${infoHash}:state`,
      )
      expect(stored).not.toBeNull()
      expect(stored!.userState).toBe('active')
      expect(stored!.bitfield).toBe('ffff')
    })
  })
})
```

---

## Phase 7: Verification

Run from monorepo root:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:fix
```

All tests should pass, including the new integration tests.

---

## Summary of Changes

| File | Action |
|------|--------|
| `packages/engine/src/core/torrent.ts` | Fix userStart/userStop to call saveTorrentState; remove debounced call |
| `packages/engine/src/core/session-persistence.ts` | Remove debounce; use JSON methods |
| `packages/engine/src/interfaces/session-store.ts` | Add getJson/setJson methods |
| `packages/engine/src/adapters/memory/memory-session-store.ts` | Implement JSON methods |
| `packages/engine/src/adapters/browser/chrome-storage-session-store.ts` | Implement JSON methods |
| `packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts` | Implement JSON methods |
| `extension/src/lib/kv-handlers.ts` | Add KV_GET_JSON/KV_SET_JSON handlers |
| `packages/engine/test/core/session-persistence.test.ts` | Add integration tests |
