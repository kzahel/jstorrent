# Design: Externally Connectable Chrome Storage Session Store

## Problem

When running the engine in a browser page (jstorrent.com or localhost dev), we currently use `LocalStorageSessionStore` for session persistence. This has issues:

1. **Data isolation** - localStorage is per-origin, so data doesn't sync between `chrome-extension://` and `jstorrent.com`
2. **Performance** - localStorage is synchronous/blocking
3. **Persistence semantics** - We want session data to be cleared when user uninstalls the extension, not tied to a website's storage

## Solution

Create a new `ExternalChromeStorageSessionStore` that relays all KV operations through the extension's service worker via `chrome.runtime.sendMessage` with `externally_connectable`.

```
┌─────────────────────────────────────────────────────────────────┐
│  Page (jstorrent.com or localhost)                              │
│                                                                 │
│  ┌───────────────────────────────────┐                          │
│  │ ExternalChromeStorageSessionStore │                          │
│  │   .get(key)                       │                          │
│  │   .set(key, value)                │                          │
│  │   .delete(key)                    │                          │
│  │   .keys(prefix)                   │                          │
│  │   .clear()                        │                          │
│  │   .getMulti(keys)  ← batch        │                          │
│  └───────────────┬───────────────────┘                          │
│                  │ chrome.runtime.sendMessage(EXTENSION_ID, msg)│
│                  │ (base64 values pass through without decode)  │
└──────────────────┼──────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Extension Service Worker                                         │
│                                                                   │
│  onMessageExternal.addListener                                    │
│    ├── KV_GET       → chrome.storage.local.get(prefixedKey)      │
│    ├── KV_GET_MULTI → chrome.storage.local.get(prefixedKeys)     │
│    ├── KV_SET       → chrome.storage.local.set({key: value})     │
│    ├── KV_DELETE    → chrome.storage.local.remove(prefixedKey)   │
│    ├── KV_KEYS      → chrome.storage.local.get(null) + filter    │
│    └── KV_CLEAR     → chrome.storage.local.remove(prefixedKeys)  │
│                                                                   │
│  SW owns the 'session:' prefix                                    │
│  Values stored as base64 strings (no decode/re-encode)            │
└──────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. No Double Encoding

`chrome.storage.local` and `chrome.runtime.sendMessage` both use JSON serialization, so we must encode `Uint8Array` as base64. But we do it **once**:

```
Page:  Uint8Array → base64 → sendMessage ──┐
                                           │
SW:    ─────────────────────── base64 ─────┴──► chrome.storage.local
       (pass through, no decode/re-encode)
```

### 2. SW Owns the Prefix

The service worker adds the `session:` prefix to all keys. The external store sends unprefixed keys. This keeps the prefix logic in one place.

### 3. SW Uses chrome.storage.local Directly

No `ChromeStorageSessionStore` abstraction in the SW - just direct `chrome.storage.local` calls. Less code, same result.

### 4. Batch Operations

Added `KV_GET_MULTI` to fetch multiple keys in one roundtrip. `restoreSession()` calls `keys()` then `get()` for each torrent - with batch support this becomes 2 roundtrips instead of N+1.

## Interface

```typescript
export interface ISessionStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
  
  // Optional batch operation (for performance)
  getMulti?(keys: string[]): Promise<Map<string, Uint8Array>>
}
```

## Implementation

### 1. Message Types

```typescript
type KVMessage =
  | { type: 'KV_GET'; key: string }
  | { type: 'KV_GET_MULTI'; keys: string[] }
  | { type: 'KV_SET'; key: string; value: string }  // value is base64
  | { type: 'KV_DELETE'; key: string }
  | { type: 'KV_KEYS'; prefix?: string }
  | { type: 'KV_CLEAR' }

type KVResponse =
  | { ok: true; value?: string | null }                    // KV_GET
  | { ok: true; values?: Record<string, string | null> }   // KV_GET_MULTI
  | { ok: true; keys?: string[] }                          // KV_KEYS
  | { ok: true }                                           // KV_SET, KV_DELETE, KV_CLEAR
  | { ok: false; error: string }
```

### 2. ExternalChromeStorageSessionStore

**Location:** `packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts`

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
 * Values are base64 encoded for transport and stored as-is in chrome.storage.local.
 * The SW owns the key prefix - this class sends unprefixed keys.
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
      value: toBase64(value),  // Encode once, stored as-is
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
}
```

### 3. Service Worker KV Handlers

**Location:** `extension/src/lib/kv-handlers.ts` (new file)

```typescript
/**
 * KV storage handlers for external session store.
 * 
 * Uses chrome.storage.local directly with 'session:' prefix.
 * Values are stored as base64 strings (passed through from external store).
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
  message: { type?: string; key?: string; keys?: string[]; value?: string; prefix?: string },
  sendResponse: KVSendResponse,
): boolean {
  
  if (message.type === 'KV_GET') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local.get(prefixedKey).then((result) => {
      const value = result[prefixedKey] ?? null  // Already base64 or null
      sendResponse({ ok: true, value })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  if (message.type === 'KV_GET_MULTI') {
    const prefixedKeys = message.keys!.map(prefixKey)
    chrome.storage.local.get(prefixedKeys).then((result) => {
      const values: Record<string, string | null> = {}
      for (const key of message.keys!) {
        values[key] = result[prefixKey(key)] ?? null
      }
      sendResponse({ ok: true, values })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  if (message.type === 'KV_SET') {
    const prefixedKey = prefixKey(message.key!)
    // Store base64 value directly - no decode/re-encode
    chrome.storage.local.set({ [prefixedKey]: message.value }).then(() => {
      sendResponse({ ok: true })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  if (message.type === 'KV_DELETE') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local.remove(prefixedKey).then(() => {
      sendResponse({ ok: true })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  if (message.type === 'KV_KEYS') {
    chrome.storage.local.get(null).then((all) => {
      const keys = Object.keys(all)
        .filter((k) => k.startsWith(PREFIX))
        .map(unprefixKey)
        .filter((k) => !message.prefix || k.startsWith(message.prefix))
      sendResponse({ ok: true, keys })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  if (message.type === 'KV_CLEAR') {
    chrome.storage.local.get(null).then((all) => {
      const keysToRemove = Object.keys(all).filter((k) => k.startsWith(PREFIX))
      return chrome.storage.local.remove(keysToRemove)
    }).then(() => {
      sendResponse({ ok: true })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  return false
}
```

### 4. Update sw.ts

**Location:** `extension/src/sw.ts`

```typescript
import { handleKVMessage } from './lib/kv-handlers'

// In handleMessage function, add at the top:
function handleMessage(
  message: { type?: string; /* ... */ },
  sendResponse: SendResponse,
): boolean {
  // KV operations (external session store)
  if (message.type?.startsWith('KV_')) {
    return handleKVMessage(message, sendResponse)
  }

  // ... existing handlers ...
}
```

### 5. Update engine-manager.ts

**Location:** `extension/src/ui/lib/engine-manager.ts`

```typescript
import {
  // ... existing imports ...
  ChromeStorageSessionStore,
  ExternalChromeStorageSessionStore,
  ISessionStore,
} from '@jstorrent/engine'
import { getBridge } from './extension-bridge'

function createSessionStore(): ISessionStore {
  const bridge = getBridge()
  
  if (!bridge.isDevMode) {
    // Inside extension - use direct chrome.storage.local
    return new ChromeStorageSessionStore(chrome.storage.local, 'session:')
  }
  
  // External (jstorrent.com or localhost) - relay through extension
  if (!bridge.extensionId) {
    throw new Error('Extension ID required for external session store')
  }
  return new ExternalChromeStorageSessionStore(bridge.extensionId)
}
```

### 6. Export from engine package

**Location:** `packages/engine/src/adapters/browser/index.ts`

```typescript
export { ChromeStorageSessionStore } from './chrome-storage-session-store'
export { LocalStorageSessionStore } from './local-storage-session-store'
export { ExternalChromeStorageSessionStore } from './external-chrome-storage-session-store'
```

**Location:** `packages/engine/src/index.ts`

```typescript
export { ExternalChromeStorageSessionStore } from './adapters/browser/external-chrome-storage-session-store'
```

## Error Handling

### Extension Not Installed

If the extension isn't installed or `externally_connectable` doesn't match the origin:

```typescript
// In ExternalChromeStorageSessionStore.send()
if (!chrome?.runtime?.sendMessage) {
  reject(new Error('chrome.runtime.sendMessage not available'))
  return
}

// Also handle no response
if (!response) {
  reject(new Error('No response from extension - is it installed?'))
}
```

### Fallback Strategy (Optional)

For dev mode, could fall back to localStorage if extension unavailable:

```typescript
function createSessionStore(): ISessionStore {
  const bridge = getBridge()
  
  if (!bridge.isDevMode) {
    return new ChromeStorageSessionStore(chrome.storage.local, 'session:')
  }
  
  if (bridge.extensionId) {
    return new ExternalChromeStorageSessionStore(bridge.extensionId)
  }
  
  // Fallback for dev without extension
  console.warn('Extension not available, using localStorage (data will not sync)')
  return new LocalStorageSessionStore('jstorrent:session:')
}
```

## Testing

### Unit Test

```typescript
describe('ExternalChromeStorageSessionStore', () => {
  const mockSendMessage = vi.fn()
  
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.chrome = {
      runtime: {
        sendMessage: mockSendMessage,
        lastError: null,
      },
    }
  })

  it('get() sends KV_GET and decodes base64 response', async () => {
    const testData = new Uint8Array([1, 2, 3, 4])
    const base64 = btoa(String.fromCharCode(...testData))
    
    mockSendMessage.mockImplementation((_id, _msg, cb) => {
      cb({ ok: true, value: base64 })
    })
    
    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.get('test-key')
    
    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'KV_GET', key: 'test-key' },
      expect.any(Function)
    )
    expect(result).toEqual(testData)
  })

  it('set() encodes to base64 and sends KV_SET', async () => {
    mockSendMessage.mockImplementation((_id, _msg, cb) => {
      cb({ ok: true })
    })
    
    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const testData = new Uint8Array([5, 6, 7, 8])
    await store.set('test-key', testData)
    
    expect(mockSendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { 
        type: 'KV_SET', 
        key: 'test-key',
        value: btoa(String.fromCharCode(...testData))
      },
      expect.any(Function)
    )
  })

  it('getMulti() batches multiple keys', async () => {
    mockSendMessage.mockImplementation((_id, _msg, cb) => {
      cb({ 
        ok: true, 
        values: { 
          'key1': btoa('value1'), 
          'key2': btoa('value2'),
          'key3': null 
        } 
      })
    })
    
    const store = new ExternalChromeStorageSessionStore('test-ext-id')
    const result = await store.getMulti(['key1', 'key2', 'key3'])
    
    expect(result.size).toBe(2)
    expect(new TextDecoder().decode(result.get('key1'))).toBe('value1')
    expect(new TextDecoder().decode(result.get('key2'))).toBe('value2')
    expect(result.has('key3')).toBe(false)
  })
})
```

### Integration Test

1. Load extension in Chrome
2. Open localhost dev server (http://local.jstorrent.com:5173)
3. Add a torrent
4. In extension DevTools, run: `chrome.storage.local.get(null)` - should see `session:*` keys with base64 values
5. Open extension UI at `chrome-extension://xxx/src/ui/app.html` - should see the same torrent

## Migration Checklist

- [ ] Create `packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts`
- [ ] Update `packages/engine/src/adapters/browser/index.ts` to export it
- [ ] Update `packages/engine/src/index.ts` to export it
- [ ] Create `extension/src/lib/kv-handlers.ts`
- [ ] Update `extension/src/sw.ts` to use KV handlers
- [ ] Update `extension/src/ui/lib/engine-manager.ts` to use new store
- [ ] Optionally update `ISessionStore` interface to include `getMulti?`
- [ ] Add unit tests
- [ ] Manual integration test
- [ ] Remove `LocalStorageSessionStore` usage from engine-manager

## Future Considerations

### Multi-tab Coordination

If both `chrome-extension://` and `jstorrent.com` are open with engines running:
- Both write to same `chrome.storage.local`
- Could cause conflicts

For now: document that users should use one UI at a time. Future: leader election or single engine in SW.

### Using getMulti in restoreSession

Update `session-persistence.ts` to use `getMulti` if available:

```typescript
async restoreSession(): Promise<number> {
  const keys = await this.sessionStore.keys('torrent:')
  
  // Use batch get if available
  if (this.sessionStore.getMulti) {
    const allData = await this.sessionStore.getMulti(keys)
    // Process allData...
  } else {
    // Fall back to individual gets
    for (const key of keys) {
      const data = await this.sessionStore.get(key)
      // ...
    }
  }
}
```
