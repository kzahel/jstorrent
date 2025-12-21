# Research: Web vs Extension UI Behavior & Daemon-Served UI

## Executive Summary

The JSTorrent UI can run from two contexts: Chrome extension (`chrome-extension://...`) or web page (`http://local.jstorrent.com:3001/...`). This document details the behavioral differences and explores the feasibility of serving the UI directly from the daemon for easier debugging and eventual extension-free usage.

---

## 1. Current Surface Area of Differences

### 1.1 Storage Backends

| Context | Settings Storage | Session Storage | Implementation |
|---------|------------------|-----------------|----------------|
| Extension | `chrome.storage.sync/local` | `chrome.storage.local` | `ChromeStorageSettingsStore` |
| Web (jstorrent.com) | `localStorage` | Relayed via extension | `LocalStorageSettingsStore` |

**Key files:**
- [chrome-settings-store.ts](packages/client/src/settings/chrome-settings-store.ts) - Extension settings
- [local-storage-settings-store.ts](packages/engine/src/settings/adapters/local-storage-settings-store.ts) - Web fallback
- [external-chrome-storage-session-store.ts](packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts) - Web session relay

**Behavior:** Web context uses `localStorage` for settings but **must relay session storage through the extension** via `chrome.runtime.sendMessage(extensionId, ...)`.

### 1.2 Context Detection

```typescript
// packages/client/src/chrome/extension-bridge.ts
function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.id.length > 0
  )
}
```

- `bridge.isDevMode = true` → Web/dev context
- `bridge.isDevMode = false` → Extension context

### 1.3 Messaging Patterns

| Context | Message API | Requires |
|---------|-------------|----------|
| Extension | `chrome.runtime.sendMessage(msg)` | Nothing extra |
| Web | `chrome.runtime.sendMessage(extensionId, msg)` | `externally_connectable` |

**Current externally_connectable origins** (from [manifest.json](extension/public/manifest.json)):
```json
"externally_connectable": {
  "matches": [
    "https://new.jstorrent.com/*",
    "https://jstorrent.com/*",
    "http://local.jstorrent.com/*"
  ]
}
```

### 1.4 Daemon Connection

| Context | Connection Method |
|---------|-------------------|
| Extension | Direct WebSocket to daemon |
| Web | **Cannot connect directly** - must relay through extension service worker |

**Critical limitation:** Web pages cannot bypass the extension for daemon communication - all I/O goes through the service worker.

### 1.5 Session Data Persistence (Torrents, Progress, Metadata)

When the UI runs from `http://local.jstorrent.com:3001`:

**All torrent data is relayed through the extension:**

```
Web UI → chrome.runtime.sendMessage(extensionId, {type: 'KV_*', ...})
       → Extension Service Worker (handleKVMessage in sw.ts:376)
       → kv-handlers.ts
       → chrome.storage.local (with 'session:' prefix)
```

**Message types:**
| Type | Purpose |
|------|---------|
| `KV_GET` / `KV_SET` | Binary data (base64 encoded) |
| `KV_GET_JSON` / `KV_SET_JSON` | JSON data (native objects) |
| `KV_GET_MULTI` | Batch retrieve |
| `KV_KEYS` / `KV_DELETE` / `KV_CLEAR` | Key management |

**Storage keys in extension's chrome.storage.local:**
- `session:torrents` - JSON list of all torrents with sources
- `session:torrent:{hash}:state` - Progress, bitfield, uploaded/downloaded
- `session:torrent:{hash}:torrentfile` - Binary .torrent file (base64)
- `session:torrent:{hash}:infodict` - Binary info dictionary (base64)
- `session:settings:defaultRootKey` - Selected download folder

**Port connection for real-time events:**
```typescript
// engine-manager.ts:810-887
this.swPort = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
```
Used for: native event forwarding, bridge state changes, single-UI enforcement.

**Key insight:** The web UI **requires the extension to be installed** - it cannot function independently because all torrent state is stored in extension storage.

### 1.6 Feature Differences

| Feature | Extension | Web Page |
|---------|-----------|----------|
| Native messaging | Direct | Via extension relay |
| File system access | Via daemon | Via daemon (relayed) |
| `chrome.notifications` | Direct | Via notification bridge |
| Session persistence | `chrome.storage.session` | localStorage |
| Cross-tab sync | `chrome.storage.onChanged` | `window.storage` events |
| UI lifecycle mgmt | Enforced single-UI | Independent |



## 6. Implementation Plan: Unified Storage Through SW

### Goal

Remove direct `chrome.storage.*` API usage from UI code. Route ALL chrome.storage operations through the service worker using extended KV message handlers.

### Current State (Problem)

| Data Type | Extension UI | Web UI |
|-----------|--------------|--------|
| Session (KV) | **Direct** `chrome.storage.local` via `ChromeStorageSessionStore` | Relayed via `ExternalChromeStorageSessionStore` → SW |
| Settings | **Direct** `chrome.storage.*` via `ChromeStorageSettingsStore` | `LocalStorageSettingsStore` (localStorage) |

### Proposed Architecture

Extend existing KV handlers with `prefix` and `area` parameters:

```
┌─────────────────────────────────────────────────────────────┐
│                         UI (React)                          │
│  packages/client, packages/engine, packages/ui              │
│                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │ KVSettingsStore (new)   │  │ KVSessionStore (new)    │  │
│  └───────────┬─────────────┘  └───────────┬─────────────┘  │
│              │                            │                 │
│              └────────────┬───────────────┘                 │
│                           │ KV_* messages                   │
│                           │ + prefix + area params          │
└───────────────────────────┼─────────────────────────────────┘
                            │ chrome.runtime.sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker (sw.ts)                   │
│                                                             │
│  handleKVMessage() - extended with prefix/area support      │
│                                                             │
│  chrome.storage.sync (area='sync')                          │
│  chrome.storage.local (area='local', default)               │
└─────────────────────────────────────────────────────────────┘
```

### Files to Modify

#### 1. extension/src/lib/kv-handlers.ts

Extend to support `prefix` and `area` parameters:

```typescript
export function handleKVMessage(
  message: {
    type?: string
    key?: string
    keys?: string[]
    value?: string | unknown
    prefix?: string      // NEW: optional, defaults to 'session:'
    area?: 'sync' | 'local'  // NEW: optional, defaults to 'local'
  },
  sendResponse: KVSendResponse,
): boolean {
  const prefix = message.prefix ?? 'session:'
  const storage = message.area === 'sync' ? chrome.storage.sync : chrome.storage.local

  if (message.type === 'KV_GET') {
    const prefixedKey = prefix + message.key!
    storage.get(prefixedKey).then((result) => {
      sendResponse({ ok: true, value: result[prefixedKey] ?? null })
    }).catch((e) => {
      sendResponse({ ok: false, error: String(e) })
    })
    return true
  }

  // ... similar changes for KV_SET, KV_DELETE, KV_KEYS, etc.
}
```

#### 2. packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts

Modify to support optional extensionId (for internal messaging):

```typescript
export class ExternalChromeStorageSessionStore implements ISessionStore {
  constructor(private extensionId?: string) {}

  private async send<T>(message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback = (response: T) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      }

      if (this.extensionId) {
        chrome.runtime.sendMessage(this.extensionId, message, callback)
      } else {
        chrome.runtime.sendMessage(message, callback)
      }
    })
  }

  // ... rest unchanged, already uses KV_* messages
}
```

#### 3. NEW: packages/client/src/settings/kv-settings-store.ts

Settings store that uses KV messages with `prefix: 'settings:'`:

```typescript
export class KVSettingsStore extends BaseSettingsStore {
  constructor(private extensionId?: string) {
    super()
  }

  private async send<T>(message: unknown): Promise<T> {
    // Same pattern as ExternalChromeStorageSessionStore
  }

  protected async loadFromStorage(): Promise<Partial<Settings>> {
    // For each setting, send KV_GET_JSON with appropriate prefix and area
    const result: Partial<Settings> = {}
    for (const key of Object.keys(settingsSchema) as SettingKey[]) {
      const response = await this.send<{ ok: boolean; value: unknown }>({
        type: 'KV_GET_JSON',
        key,
        prefix: 'settings:',
        area: getStorageClass(key),  // 'sync' or 'local'
      })
      if (response.ok && response.value !== null) {
        result[key] = response.value as Settings[typeof key]
      }
    }
    return result
  }

  protected async saveToStorage<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    await this.send({
      type: 'KV_SET_JSON',
      key,
      value,
      prefix: 'settings:',
      area: getStorageClass(key),
    })
  }
}
```

#### 4. packages/client/src/settings/index.ts

Update to use KVSettingsStore for both contexts:

```typescript
export function getSettingsStore(): ISettingsStore {
  if (settingsStore) return settingsStore

  const bridge = getBridge()

  // Both extension and web UI use KVSettingsStore
  const store = new KVSettingsStore(bridge.isDevMode ? bridge.extensionId : undefined)
  settingsStore = store

  return settingsStore
}
```

#### 5. packages/client/src/chrome/engine-manager.ts

Update createSessionStore to always use external store:

```typescript
function createSessionStore(): ISessionStore {
  const bridge = getBridge()
  // Always relay through SW
  return new ExternalChromeStorageSessionStore(
    bridge.isDevMode ? bridge.extensionId : undefined
  )
}
```

#### 6. NEW: ESLint rule to ban chrome.storage in UI packages

Add to each package's ESLint config (`packages/engine/`, `packages/ui/`, `packages/client/`):

```javascript
{
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.object.name='chrome'][object.property.name='storage']",
        message: 'Direct chrome.storage access is banned. Use KV message handlers via the service worker.',
      },
    ],
  },
}
```

This bans `chrome.storage.*` while still allowing:
- `chrome.runtime.sendMessage()` - needed for message passing
- `chrome.runtime.connect()` - needed for port connections

### Migration Steps

1. Extend `kv-handlers.ts` with `prefix` and `area` parameters (backward compatible)
2. Modify `ExternalChromeStorageSessionStore` to support optional extensionId
3. Create `KVSettingsStore` class
4. Update `getSettingsStore()` to use `KVSettingsStore`
5. Update `createSessionStore()` to always use `ExternalChromeStorageSessionStore`
6. Delete `ChromeStorageSettingsStore` and `ChromeStorageSessionStore`
7. Add ESLint rule to enforce the ban
8. Fix any ESLint violations

### Out of Scope (for now)

- `chrome.storage.onChanged` forwarding to UI (not needed for current use case)
- Cross-tab sync for web UI (can refresh if needed)

### Benefits

- **No chrome.storage in UI code**: Enforced by ESLint
- **Unified architecture**: Single KV handler for all storage
- **Reuses existing infrastructure**: Extends KV handlers, no new message types
- **Backward compatible**: Default prefix/area maintains existing behavior
- **Simpler debugging**: All storage operations go through one handler

---

## Key Files Reference

- [extension-bridge.ts](packages/client/src/chrome/extension-bridge.ts) - Context detection & messaging
- [engine-manager.ts](packages/client/src/chrome/engine-manager.ts) - Engine initialization & daemon connection
- [chrome-settings-store.ts](packages/client/src/settings/chrome-settings-store.ts) - Extension settings storage
- [local-storage-settings-store.ts](packages/engine/src/settings/adapters/local-storage-settings-store.ts) - Web fallback settings
- [external-chrome-storage-session-store.ts](packages/engine/src/adapters/browser/external-chrome-storage-session-store.ts) - Session relay for web
- [manifest.json](extension/public/manifest.json) - externally_connectable config
- [App.tsx](packages/client/src/App.tsx) - Main UI initialization

---

## Sources

- [Chrome Secure Context for localhost](https://chromestatus.com/feature/6269417340010496)
- [MDN Mixed Content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)
- [Chrome Intent: Treat localhost as secure](https://groups.google.com/a/chromium.org/g/blink-dev/c/RC9dSw-O3fE/m/E3_0XaT0BAAJ)
- [Chrome Local Network Access Update](https://developer.chrome.com/blog/local-network-access)
