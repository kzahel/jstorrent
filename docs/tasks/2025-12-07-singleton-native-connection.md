# Singleton Native Host Connection

## Problem

Multiple native host connections are being created, causing message routing failures. When `pickDownloadFolder()` sends a request, the response arrives on a different port than where the handler is listening.

**Root cause:** Nothing enforces that there's only one `chrome.runtime.connectNative()` port. The code creates connections in multiple places:

1. `sw.ts` line 123: Direct `connectNative()` call in `onInstalled` handler
2. `desktop-adapter.ts` line 53: `probe()` creates new connection via `this.config.createConnection()`

When probe() runs after onInstalled, it creates a second connection. The native host from connection #1 has already exited. Messages sent on connection #1's port go nowhere or spawn a new process that sends responses to a different listener.

## Invariant to Enforce

**There is exactly ONE `chrome.runtime.connectNative()` port per extension lifecycle.**

This must be enforced in code, not just documented.

## Changes Required

### 1. Make NativeHostConnection a Singleton

**File:** `extension/src/lib/native-connection.ts`

Add module-level singleton enforcement:

```typescript
// At top of file, after imports
let singletonInstance: NativeHostConnection | null = null
let singletonCreated = false

export function getNativeConnection(): NativeHostConnection {
  if (!singletonInstance) {
    singletonInstance = new NativeHostConnection()
  }
  return singletonInstance
}

export function resetNativeConnection(): void {
  // Only for testing - allows test cleanup
  singletonInstance = null
  singletonCreated = false
}
```

Modify the class to enforce singleton and support reconnection:

```typescript
export class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null
  private connected = false
  private disconnected = false
  private disconnectCallbacks: Array<() => void> = []

  constructor() {
    if (singletonCreated) {
      throw new Error(
        'NativeHostConnection is a singleton. Use getNativeConnection() instead of new NativeHostConnection()'
      )
    }
    singletonCreated = true
  }

  /**
   * Reset internal state to allow reconnection.
   * Call this before connect() if previous connection died.
   */
  private resetState(): void {
    this.port = null
    this.connected = false
    this.disconnected = false
    // Clear callbacks - probe() will register fresh ones
    this.disconnectCallbacks = []
  }
  
  async connect(): Promise<void> {
    // Allow reconnection if previous connection died
    if (this.disconnected) {
      console.log('[NativeHostConnection] Reconnecting after previous disconnect')
      this.resetState()
    }
    
    // ... rest of connect() unchanged ...
  }
  
  // ... rest of class unchanged ...
}
```

### 2. Update DesktopAdapter to Use Singleton

**File:** `extension/src/lib/io-bridge/adapters/desktop-adapter.ts`

Remove the `createConnection` config option entirely. The adapter should always use the singleton.

**Before:**
```typescript
export interface DesktopAdapterConfig {
  /** Factory for creating native host connections (for testing) */
  createConnection?: () => INativeHostConnection
  handshakeTimeoutMs?: number
}

export class DesktopAdapter implements IIOBridgeAdapter {
  private config: Required<DesktopAdapterConfig>
  private connection: INativeHostConnection | null = null
  
  constructor(config: DesktopAdapterConfig = {}) {
    this.config = {
      createConnection: config.createConnection ?? (() => new NativeHostConnection()),
      handshakeTimeoutMs: config.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    }
  }

  async probe(): Promise<ProbeResult> {
    // ...
    this.connection = this.config.createConnection()
    // ...
  }
}
```

**After:**
```typescript
import { getNativeConnection, type INativeHostConnection } from '../../native-connection'

export interface DesktopAdapterConfig {
  handshakeTimeoutMs?: number
}

export class DesktopAdapter implements IIOBridgeAdapter {
  private config: Required<DesktopAdapterConfig>
  private connection: INativeHostConnection | null = null
  
  constructor(config: DesktopAdapterConfig = {}) {
    this.config = {
      handshakeTimeoutMs: config.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    }
  }

  async probe(): Promise<ProbeResult> {
    try {
      // Get singleton connection
      this.connection = getNativeConnection()
      
      // Connect (or reconnect if previous connection died)
      // NativeHostConnection.connect() handles the reconnection logic internally
      if (!this.connection.isConnected()) {
        await this.connection.connect()
      }
      
      // ... rest of probe unchanged ...
    }
  }
}
```

### 3. Remove Direct connectNative Call from sw.ts

**File:** `extension/src/sw.ts`

Delete the entire `onInstalled` handler's native connection code (lines 122-152). The initial handshake is unnecessary - the IOBridgeService will handle connection when the UI opens.

**Before:**
```typescript
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[SW] onInstalled fired at ${new Date().toISOString()} - reason: ${details.reason}`)
  const installId = await getOrGenerateInstallId()
  console.log('Generated/Retrieved Install ID:', installId)

  // Perform immediate handshake to register install ID with native host
  try {
    const port = chrome.runtime.connectNative('com.jstorrent.native')
    // ... 30 lines of connection code ...
  } catch (e) {
    console.error('[SW] Failed to perform initial handshake:', e)
  }
})
```

**After:**
```typescript
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[SW] onInstalled fired at ${new Date().toISOString()} - reason: ${details.reason}`)
  // Just ensure install ID exists - connection happens via IOBridgeService when UI opens
  const installId = await getOrGenerateInstallId()
  console.log('Generated/Retrieved Install ID:', installId)
})
```

### 4. Update ARCHITECTURE.md

**File:** `docs/project/ARCHITECTURE.md`

Add new section after "## What Won't Change":

```markdown
## Invariants

Hard constraints. Violating these causes subtle bugs that are difficult to diagnose.

### Single Native Host Connection

There is exactly ONE `chrome.runtime.connectNative()` port per extension lifecycle. Never create a second connection. All native host communication goes through this single port.

**Why:** Chrome's native messaging spawns a new host process per port. Multiple ports means multiple processes. Responses go to the port that made the request - if handlers are registered on a different port, messages are lost. The native host is stateful (auth token, download roots) - a second process starts with none of that state.

**Enforcement:** `NativeHostConnection` is a singleton. The constructor throws if called twice. Use `getNativeConnection()` to obtain the instance.

**Reconnection:** If the native host crashes, the singleton can reconnect by calling `connect()` again. It resets internal state and creates a fresh `connectNative()` port. This spawns a new native host process. The IOBridgeService state machine handles triggering reconnection attempts.
```

## Verification

After making these changes:

1. **Build succeeds:**
   ```bash
   cd extension && pnpm build
   ```

2. **No duplicate connections in logs:**
   - Load extension
   - Open service worker console
   - Should see exactly ONE "[NativeHostConnection] connected" log
   - Click "Add Download Location"
   - Should see response handled correctly

3. **Singleton throws on second instantiation:**
   ```typescript
   // In browser console (for manual testing)
   import { NativeHostConnection } from './lib/native-connection'
   new NativeHostConnection() // should throw
   ```

4. **Download root selection works:**
   - Click "Add Download Location"
   - Select folder in native picker
   - Folder appears in UI

5. **Reconnection after crash works:**
   - With extension connected and working
   - Kill native host process (`pkill jstorrent-native` or similar)
   - Extension should detect disconnect, transition to appropriate state
   - Click retry or reopen UI
   - Should reconnect successfully without extension reload

## Files Modified

- `extension/src/lib/native-connection.ts` - Singleton enforcement
- `extension/src/lib/io-bridge/adapters/desktop-adapter.ts` - Use singleton, remove factory
- `extension/src/sw.ts` - Remove direct connectNative call
- `docs/project/ARCHITECTURE.md` - Document invariant
