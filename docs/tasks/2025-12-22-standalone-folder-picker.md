# Standalone Android Folder Picker Support

## Overview

Enable download folder management in the standalone Android UI. Currently `AndroidStandaloneEngineManager` sets `supportsFileOperations = false`, which hides the Download Locations section in Settings. 

The infrastructure exists but isn't wired up:
- Android has SAF folder picker (`StandaloneActivity.folderPickerLauncher`)
- Android intercepts `jstorrent://add-root` URLs
- Android broadcasts `ROOTS_CHANGED` via `/control` WebSocket
- **But**: Standalone auth connections are excluded from broadcasts (bug)
- **And**: No `/control` WebSocket connection from standalone TypeScript

This task adds a lightweight `ControlConnection` class and wires up folder management.

## Architecture

```
Current:
  AndroidStandaloneEngineManager
    └── DaemonConnection ──► ws://.../io (data only)

After:
  AndroidStandaloneEngineManager
    ├── DaemonConnection ──► ws://.../io (data)
    └── ControlConnection ──► ws://.../control (roots, events)
```

The `/control` connection is analogous to `chrome.runtime.connectNative()` on desktop - a persistent control channel that receives broadcasts.

---

## Phase 1: Fix Android Broadcast Registration

### 1.1 Update SocketHandler.kt

The current code excludes standalone sessions from broadcast registration. Fix this.

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`

Find this block (around line 225):

```kotlin
                if (isExtensionAuth || isStandaloneAuth) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    val authType = if (isStandaloneAuth) "standalone" else "extension"
                    Log.i(TAG, "WebSocket authenticated ($authType, ${sessionType.name})")

                    // Only register control sessions for broadcasts (not standalone)
                    if (sessionType == SessionType.CONTROL && isExtensionAuth) {
                        httpServer.registerControlSession(this@SocketSession)
                        // Notify PendingLinkManager that a control connection is available
                        com.jstorrent.app.link.PendingLinkManager.notifyConnectionEstablished()
                    }
                }
```

Replace with:

```kotlin
                if (isExtensionAuth || isStandaloneAuth) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    val authType = if (isStandaloneAuth) "standalone" else "extension"
                    Log.i(TAG, "WebSocket authenticated ($authType, ${sessionType.name})")

                    // Register all control sessions for broadcasts (ROOTS_CHANGED, EVENT)
                    if (sessionType == SessionType.CONTROL) {
                        httpServer.registerControlSession(this@SocketSession)
                        // Extension-only: notify PendingLinkManager for intent handling
                        if (isExtensionAuth) {
                            com.jstorrent.app.link.PendingLinkManager.notifyConnectionEstablished()
                        }
                    }
                }
```

---

## Phase 2: Create ControlConnection Class

### 2.1 Create control-connection.ts

**File:** `packages/engine/src/adapters/daemon/control-connection.ts`

```typescript
/**
 * Control Connection
 *
 * Lightweight WebSocket connection to /control endpoint.
 * Receives ROOTS_CHANGED and EVENT broadcasts from the daemon.
 *
 * Unlike ChromeOSBootstrap, this assumes:
 * - Port is already known (injected via config)
 * - Token is pre-shared (no pairing dance)
 * - Host is localhost (127.0.0.1 for standalone)
 */

export interface ControlRoot {
  key: string
  uri?: string
  displayName?: string
  available?: boolean
}

export interface ControlEvent {
  event: string
  payload: unknown
}

export type RootsChangedCallback = (roots: ControlRoot[]) => void
export type EventCallback = (event: ControlEvent) => void

export class ControlConnection {
  private ws: WebSocket | null = null
  private rootsChangedCallbacks = new Set<RootsChangedCallback>()
  private eventCallbacks = new Set<EventCallback>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true

  constructor(
    private host: string,
    private port: number,
    private token: string,
  ) {}

  /**
   * Connect to /control WebSocket and authenticate.
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true

    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}/control`
      console.log(`[ControlConnection] Connecting to ${url}`)

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timeout'))
      }, 10000)

      ws.onopen = () => {
        // Send CLIENT_HELLO
        ws.send(this.buildFrame(0x01, 0, new Uint8Array(0)))
      }

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === 0x02) {
          // SERVER_HELLO - send AUTH
          // Format: authType(1) + token + \0 + extensionId + \0 + installId
          // For standalone, extensionId and installId can be placeholder values
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(this.token)
          const extIdBytes = encoder.encode('standalone')
          const installIdBytes = encoder.encode('standalone')

          const payload = new Uint8Array(
            1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
          )
          payload[0] = 0 // authType
          let offset = 1
          payload.set(tokenBytes, offset)
          offset += tokenBytes.length
          payload[offset++] = 0 // null separator
          payload.set(extIdBytes, offset)
          offset += extIdBytes.length
          payload[offset++] = 0 // null separator
          payload.set(installIdBytes, offset)

          ws.send(this.buildFrame(0x03, 0, payload))
        } else if (opcode === 0x04) {
          // AUTH_RESULT
          clearTimeout(timeout)
          const status = data[8]
          if (status === 0) {
            console.log('[ControlConnection] Authenticated')
            this.ws = ws
            this.setupMessageHandler(ws)
            resolve()
          } else {
            ws.close()
            reject(new Error('Auth failed'))
          }
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket error'))
      }

      ws.onclose = () => {
        clearTimeout(timeout)
        if (this.ws === ws) {
          this.ws = null
          this.scheduleReconnect()
        }
      }
    })
  }

  /**
   * Close the connection and stop reconnecting.
   */
  close(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Send request to open folder picker.
   * The daemon will trigger SAF picker and broadcast ROOTS_CHANGED when done.
   */
  requestFolderPicker(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ControlConnection] Cannot request folder picker: not connected')
      return
    }
    console.log('[ControlConnection] Requesting folder picker')
    this.ws.send(this.buildFrame(0xe2, 0, new Uint8Array(0)))
  }

  /**
   * Subscribe to ROOTS_CHANGED events.
   */
  onRootsChanged(callback: RootsChangedCallback): () => void {
    this.rootsChangedCallbacks.add(callback)
    return () => this.rootsChangedCallbacks.delete(callback)
  }

  /**
   * Subscribe to native events (TorrentAdded, MagnetAdded, etc).
   */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.add(callback)
    return () => this.eventCallbacks.delete(callback)
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  private setupMessageHandler(ws: WebSocket): void {
    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const opcode = data[1]

      if (opcode === 0xe0) {
        // ROOTS_CHANGED
        this.handleRootsChanged(data)
      } else if (opcode === 0xe1) {
        // EVENT
        this.handleEvent(data)
      }
    }

    ws.onclose = () => {
      console.log('[ControlConnection] Disconnected')
      if (this.ws === ws) {
        this.ws = null
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      console.error('[ControlConnection] WebSocket error')
    }
  }

  private handleRootsChanged(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const roots = JSON.parse(json) as ControlRoot[]
      console.log('[ControlConnection] Roots changed:', roots.length)

      for (const callback of this.rootsChangedCallbacks) {
        try {
          callback(roots)
        } catch (e) {
          console.error('[ControlConnection] Callback error:', e)
        }
      }
    } catch (e) {
      console.error('[ControlConnection] Failed to parse ROOTS_CHANGED:', e)
    }
  }

  private handleEvent(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const event = JSON.parse(json) as ControlEvent
      console.log('[ControlConnection] Event:', event.event)

      for (const callback of this.eventCallbacks) {
        try {
          callback(event)
        } catch (e) {
          console.error('[ControlConnection] Callback error:', e)
        }
      }
    } catch (e) {
      console.error('[ControlConnection] Failed to parse EVENT:', e)
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return

    console.log('[ControlConnection] Scheduling reconnect in 2s')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) {
        this.connect().catch((e) => {
          console.error('[ControlConnection] Reconnect failed:', e)
        })
      }
    }, 2000)
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    // bytes 2-3: flags (0)
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true) // little-endian
    frame.set(payload, 8)
    return frame.buffer
  }
}
```

### 2.2 Export from adapters/daemon index

**File:** `packages/engine/src/adapters/daemon/index.ts`

Add export:

```typescript
export { ControlConnection } from './control-connection'
export type { ControlRoot, ControlEvent } from './control-connection'
```

---

## Phase 3: Update AndroidStandaloneEngineManager

### 3.1 Add imports and properties

**File:** `packages/client/src/engine-manager/android-standalone-engine-manager.ts`

Add import at top:

```typescript
import { ControlConnection } from '@jstorrent/engine/adapters/daemon'
import type { ControlRoot } from '@jstorrent/engine/adapters/daemon'
```

Update class properties (around line 41):

```typescript
export class AndroidStandaloneEngineManager implements IEngineManager {
  engine: BtEngine | null = null
  logStore: LogStore = globalLogStore
  readonly supportsFileOperations = true  // Changed from false

  private daemonConnection: DaemonConnection | null = null
  private controlConnection: ControlConnection | null = null  // Add this
  private sessionStore: JsBridgeSessionStore | null = null
  // ... rest unchanged
```

### 3.2 Connect to /control in doInit()

In the `doInit()` method, after creating the daemon connection and before creating the engine, add the control connection setup.

Find this section (around line 97):

```typescript
    // 2. Create daemon connection
    this.daemonConnection = new DaemonConnection(port, host, undefined, authToken)
    await this.daemonConnection.connectWebSocket()
    console.log('[AndroidStandaloneEngineManager] WebSocket connected')
```

Add after it:

```typescript
    // 2b. Create control connection for ROOTS_CHANGED broadcasts
    this.controlConnection = new ControlConnection(host, port, authToken)
    this.controlConnection.onRootsChanged((roots) => {
      this.handleRootsChanged(roots)
    })
    this.controlConnection.onEvent((event) => {
      this.handleNativeEvent(event.event, event.payload).catch(console.error)
    })
    await this.controlConnection.connect()
    console.log('[AndroidStandaloneEngineManager] Control connection established')
```

### 3.3 Add handleRootsChanged method

Add this method to the class (after handleIoReconnect):

```typescript
  /**
   * Handle ROOTS_CHANGED broadcast from control connection.
   */
  private handleRootsChanged(roots: ControlRoot[]): void {
    if (!this.engine) return

    const srm = this.engine.storageRootManager
    const existingKeys = new Set(srm.getRoots().map((r) => r.key))
    const newKeys = new Set(roots.map((r) => r.key))

    // Add new roots
    for (const root of roots) {
      if (!existingKeys.has(root.key)) {
        srm.addRoot({
          key: root.key,
          label: root.displayName || root.key,
          path: root.uri || root.key,
        })
        console.log('[AndroidStandaloneEngineManager] Added root:', root.key)
      }
    }

    // Remove deleted roots
    for (const key of existingKeys) {
      if (!newKeys.has(key)) {
        srm.removeRoot(key)
        console.log('[AndroidStandaloneEngineManager] Removed root:', key)
      }
    }

    // Notify any waiting promises
    this.emitRootsChanged(roots)
  }
```

### 3.4 Add roots change subscription infrastructure

Add these properties and methods for the folder picker to wait on:

```typescript
  // Add to class properties (around line 51)
  private rootsChangedResolvers: Array<(roots: ControlRoot[]) => void> = []

  // Add method
  private emitRootsChanged(roots: ControlRoot[]): void {
    const resolvers = this.rootsChangedResolvers
    this.rootsChangedResolvers = []
    for (const resolve of resolvers) {
      resolve(roots)
    }
  }

  private waitForRootsChanged(timeoutMs: number): Promise<ControlRoot[] | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.rootsChangedResolvers.indexOf(resolve as (roots: ControlRoot[]) => void)
        if (idx >= 0) this.rootsChangedResolvers.splice(idx, 1)
        resolve(null)
      }, timeoutMs)

      this.rootsChangedResolvers.push((roots) => {
        clearTimeout(timer)
        resolve(roots)
      })
    })
  }
```

### 3.5 Implement pickDownloadFolder()

Add this method:

```typescript
  /**
   * Open SAF folder picker.
   * Triggers native picker via URL navigation, waits for ROOTS_CHANGED.
   */
  async pickDownloadFolder(): Promise<StorageRoot | null> {
    const existingKeys = new Set(this.getRoots().map((r) => r.key))

    // Option 1: Use control connection to request picker (if connected)
    if (this.controlConnection?.isConnected()) {
      this.controlConnection.requestFolderPicker()
    } else {
      // Option 2: Trigger via URL navigation (always works)
      window.location.href = 'jstorrent://add-root'
    }

    // Wait for ROOTS_CHANGED broadcast (up to 60s for user to pick)
    const roots = await this.waitForRootsChanged(60000)
    if (!roots) {
      console.log('[AndroidStandaloneEngineManager] Folder picker timed out or cancelled')
      return null
    }

    // Find the new root
    const newRoot = roots.find((r) => !existingKeys.has(r.key))
    if (!newRoot) {
      console.log('[AndroidStandaloneEngineManager] No new root found after picker')
      return null
    }

    // Auto-set as default if this is the first root
    if (existingKeys.size === 0) {
      await this.setDefaultRoot(newRoot.key)
    }

    return {
      key: newRoot.key,
      label: newRoot.displayName || newRoot.key,
      path: newRoot.uri || newRoot.key,
    }
  }
```

### 3.6 Implement removeDownloadRoot()

Add this method:

```typescript
  /**
   * Remove a download root.
   */
  async removeDownloadRoot(key: string): Promise<boolean> {
    if (!this.config) return false

    const url = new URL(this.config.daemonUrl)
    const port = url.port || '7800'
    const token = url.searchParams.get('token') || ''

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/roots/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
          headers: { 'X-JST-Auth': token },
        },
      )

      if (response.ok) {
        // StorageRootManager will be updated via ROOTS_CHANGED broadcast
        console.log('[AndroidStandaloneEngineManager] Root removal requested:', key)
        return true
      } else {
        console.error('[AndroidStandaloneEngineManager] Root removal failed:', response.status)
        return false
      }
    } catch (e) {
      console.error('[AndroidStandaloneEngineManager] Root removal error:', e)
      return false
    }
  }
```

### 3.7 Add stub file operation methods

Add these stub methods that return errors (since we set `supportsFileOperations = true`):

```typescript
  // File operations - not supported on Android standalone
  async openFile(_torrentHash: string, _filePath: string): Promise<FileOperationResult> {
    return { ok: false, error: 'Not supported on Android' }
  }

  async revealInFolder(_torrentHash: string, _filePath: string): Promise<FileOperationResult> {
    return { ok: false, error: 'Not supported on Android' }
  }

  async openTorrentFolder(_torrentHash: string): Promise<FileOperationResult> {
    return { ok: false, error: 'Not supported on Android' }
  }

  getFilePath(_torrentHash: string, _filePath: string): string | null {
    return null
  }
```

### 3.8 Update shutdown() to close control connection

Find the `shutdown()` method and update it:

```typescript
  shutdown(): void {
    console.log('[AndroidStandaloneEngineManager] Shutting down...')

    if (this.controlConnection) {
      this.controlConnection.close()
      this.controlConnection = null
    }

    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    this.pendingNativeEvents = []
    this.rootsChangedResolvers = []
    this.daemonConnection = null
    this.initPromise = null
  }
```

### 3.9 Update reset() similarly

```typescript
  reset(): void {
    console.log('[AndroidStandaloneEngineManager] Resetting for reconnection...')

    if (this.controlConnection) {
      this.controlConnection.close()
      this.controlConnection = null
    }

    if (this.daemonConnection) {
      this.daemonConnection.close()
      this.daemonConnection = null
    }

    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    this.pendingNativeEvents = []
    this.rootsChangedResolvers = []
    this.initPromise = null
  }
```

### 3.10 Add import for FileOperationResult

Make sure the import includes `FileOperationResult`:

```typescript
import type { IEngineManager, StorageRoot, FileOperationResult } from './types'
```

---

## Phase 4: Export ControlConnection from engine package

### 4.1 Update main engine exports

**File:** `packages/engine/src/index.ts`

Check if daemon adapters are exported. If not, add:

```typescript
export { ControlConnection } from './adapters/daemon/control-connection'
export type { ControlRoot, ControlEvent } from './adapters/daemon/control-connection'
```

Or if there's already a daemon adapter barrel export, add to that instead.

---

## Verification

### Build Check

```bash
cd /path/to/jstorrent-monorepo
pnpm typecheck
pnpm build
```

### Android Build

```bash
cd android-io-daemon
./gradlew assembleDebug
```

### Manual Testing

1. Install updated APK on Android device/emulator
2. Launch app in standalone mode (`ui_mode=full`)
3. Open Settings → General tab
4. Verify "Download Locations" section is visible
5. Click "+ Add Download Location"
6. Verify SAF folder picker opens
7. Select a folder
8. Verify the new root appears in the list
9. Verify it's set as default (if first root)
10. Test removing a root

### Log Verification

Check logcat for:
```
[ControlConnection] Connecting to ws://127.0.0.1:7800/control
[ControlConnection] Authenticated
WebSocket authenticated (standalone, CONTROL)
Control session registered, total: 1
[ControlConnection] Roots changed: 1
[AndroidStandaloneEngineManager] Added root: abc123
```

---

## Notes

- The `ControlConnection` class is intentionally lightweight - no discovery, no pairing, no complex state machine
- Standalone mode uses `127.0.0.1` (loopback), not `100.115.92.2` (ARC bridge)
- The `extensionId` and `installId` in AUTH payload are placeholder strings for standalone
- Reconnection is handled automatically by `ControlConnection`
- The same infrastructure could potentially be reused for a future web-based client at jstorrent.com
