# Task: Add ChromeOS/Android Daemon Support to Extension

## Goal

Modify the extension to work on ChromeOS by connecting to the Android io-daemon instead of the native messaging host. The extension should:

1. Detect if running on ChromeOS
2. If ChromeOS: connect to Android daemon at `http://100.115.92.2:7800`
3. If desktop: use existing native messaging (unchanged)
4. Handle pairing flow to securely share auth token with Android app

## Context

### Current Architecture (Desktop)

```
Extension ──chrome.runtime.connectNative()──► native-host (Rust)
                                                    │
                                                    ▼
                                              io-daemon (Rust)
```

The extension uses `NativeHostConnection` which calls `chrome.runtime.connectNative('com.jstorrent.native')`. The native host returns `DaemonInfo` with port and token.

### New Architecture (ChromeOS)

```
Extension ──HTTP/WebSocket──► android-io-daemon (Kotlin)
              100.115.92.2:7800
```

No native messaging. The extension connects directly to the Android app's HTTP server.

### Key Files

| File | Purpose |
|------|---------|
| `extension/src/lib/native-connection.ts` | `INativeHostConnection` interface, `NativeHostConnection` class |
| `extension/src/lib/daemon-lifecycle-manager.ts` | `DaemonLifecycleManager` - orchestrates connection lifecycle |
| `extension/src/sw.ts` | Service worker - instantiates the manager |
| `extension/public/manifest.json` | Extension manifest |

## Implementation

### Phase 1: Update Manifest

Edit `extension/public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "JSTorrent Extension",
  "version": "0.0.1",
  "description": "JSTorrent MV3 Extension",
  "permissions": [
    "nativeMessaging",
    "storage",
    "notifications",
    "power",
    "unlimitedStorage",
    "tabs"
  ],
  "host_permissions": [
    "http://100.115.92.2/*"
  ],
  "background": {
    "service_worker": "sw.js",
    "type": "module"
  },
  "action": {},
  "icons": {
    "16": "icons/js-16.png",
    "32": "icons/js-32.png",
    "128": "icons/js-128.png"
  },
  "externally_connectable": {
    "matches": [
      "https://new.jstorrent.com/*",
      "https://jstorrent.com/*",
      "http://local.jstorrent.com/*"
    ]
  }
}
```

**Change:** Added `host_permissions` for the Android container IP.

### Phase 2: Create Platform Detection Utility

Create `extension/src/lib/platform.ts`:

```typescript
/**
 * Platform detection utilities.
 */

export type Platform = 'chromeos' | 'desktop'

/**
 * Detect if running on ChromeOS.
 * Uses navigator.userAgent which contains "CrOS" on ChromeOS.
 */
export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('CrOS')) {
    return 'chromeos'
  }
  return 'desktop'
}

/**
 * Check if we can reach the Android daemon.
 * Returns true if the daemon responds to /status.
 */
export async function isAndroidDaemonReachable(
  host: string = '100.115.92.2',
  port: number = 7800,
  timeoutMs: number = 2000
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    const response = await fetch(`http://${host}:${port}/status`, {
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Try multiple ports in case 7800 is taken.
 * Returns the port that responds, or null if none.
 */
export async function findAndroidDaemonPort(
  host: string = '100.115.92.2',
  basePorts: number[] = [7800, 7805, 7814, 7827]
): Promise<number | null> {
  for (const port of basePorts) {
    if (await isAndroidDaemonReachable(host, port)) {
      return port
    }
  }
  return null
}
```

### Phase 3: Create Android Daemon Connection

Create `extension/src/lib/android-connection.ts`:

```typescript
import { INativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'

const ANDROID_HOST = '100.115.92.2'
const ANDROID_BASE_PORT = 7800
const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'

/**
 * Connection to Android io-daemon.
 * Implements same interface as NativeHostConnection for compatibility.
 */
export class AndroidDaemonConnection implements INativeHostConnection {
  private host = ANDROID_HOST
  private port = ANDROID_BASE_PORT
  private token: string | null = null
  private messageCallbacks: Array<(msg: unknown) => void> = []
  private disconnectCallbacks: Array<() => void> = []
  private connected = false

  async connect(): Promise<void> {
    // Try to find the daemon
    const port = await this.findDaemonPort()
    if (!port) {
      throw new Error('Android daemon not reachable. Is the JSTorrent app running?')
    }
    this.port = port

    // Load saved token
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    this.token = stored[STORAGE_KEY_TOKEN] || null

    this.connected = true
    console.log(`[AndroidDaemonConnection] Connected to ${this.host}:${this.port}`)
  }

  send(msg: unknown): void {
    // The Android daemon doesn't use the same message protocol as native host.
    // This is mainly used for handshake which we handle differently.
    // For now, we handle specific ops inline.
    const message = msg as { op?: string; id?: string }
    
    if (message.op === 'handshake') {
      // Respond with DaemonInfo
      this.handleHandshake()
    } else if (message.op === 'pickDownloadDirectory') {
      // Not supported on Android yet - would need SAF integration
      this.notifyMessage({
        id: message.id,
        ok: false,
        error: 'Folder picker not yet supported on ChromeOS',
      })
    }
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.messageCallbacks.push(cb)
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallbacks.push(cb)
  }

  /**
   * Get the auth token, prompting for pairing if needed.
   */
  async getOrCreateToken(): Promise<string> {
    if (this.token) {
      return this.token
    }

    // Generate new token and initiate pairing
    this.token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: this.token })
    
    // Open Android app with pairing intent
    await this.openPairingIntent(this.token)
    
    return this.token
  }

  /**
   * Check if we're paired (have a token and daemon accepts it).
   */
  async isPaired(): Promise<boolean> {
    if (!this.token) {
      return false
    }
    
    // Try to hit an authenticated endpoint
    try {
      const response = await fetch(`http://${this.host}:${this.port}/status`, {
        headers: { 'X-JST-Auth': this.token },
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Clear pairing and token.
   */
  async unpair(): Promise<void> {
    this.token = null
    await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async findDaemonPort(): Promise<number | null> {
    // Check saved port first
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    if (stored[STORAGE_KEY_PORT]) {
      const savedPort = stored[STORAGE_KEY_PORT] as number
      if (await this.isDaemonReachable(savedPort)) {
        return savedPort
      }
    }

    // Try known ports
    const ports = [7800, 7805, 7814, 7827, 7844]
    for (const port of ports) {
      if (await this.isDaemonReachable(port)) {
        await chrome.storage.local.set({ [STORAGE_KEY_PORT]: port })
        return port
      }
    }

    return null
  }

  private async isDaemonReachable(port: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)
      
      const response = await fetch(`http://${this.host}:${port}/status`, {
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }

  private async openPairingIntent(token: string): Promise<void> {
    // Create intent URL
    const intentUrl = `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=jstorrent;package=com.jstorrent;end`
    
    // Open in new tab - Chrome on Android/ChromeOS will handle the intent
    await chrome.tabs.create({ url: intentUrl })
    
    console.log('[AndroidDaemonConnection] Opened pairing intent')
  }

  private async handleHandshake(): Promise<void> {
    // Ensure we have a token
    const token = await this.getOrCreateToken()

    // Build DaemonInfo response
    const daemonInfo: DaemonInfo = {
      port: this.port,
      token: token,
      version: 1,
      roots: await this.fetchRoots(),
    }

    // Notify listeners with DaemonInfo message (same format as native host)
    this.notifyMessage({
      type: 'DaemonInfo',
      payload: daemonInfo,
    })
  }

  private async fetchRoots(): Promise<DownloadRoot[]> {
    // For now, return a single default root
    // The Android app uses its own download directory
    return [
      {
        key: 'default',
        path: '/storage/emulated/0/Download/JSTorrent',
        display_name: 'Downloads',
        removable: false,
        last_stat_ok: true,
        last_checked: Date.now(),
      },
    ]
  }

  private notifyMessage(msg: unknown): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(msg)
      } catch (e) {
        console.error('[AndroidDaemonConnection] Message callback error:', e)
      }
    }
  }

  private notifyDisconnect(): void {
    this.connected = false
    for (const cb of this.disconnectCallbacks) {
      try {
        cb()
      } catch (e) {
        console.error('[AndroidDaemonConnection] Disconnect callback error:', e)
      }
    }
  }
}
```

### Phase 4: Update Service Worker

Edit `extension/src/sw.ts` to use platform detection:

Find this section:
```typescript
const daemonManager = new DaemonLifecycleManager(
  () => new NativeHostConnection(),
  (event) => {
    // ...
  },
)
```

Replace with:
```typescript
import { detectPlatform } from './lib/platform'
import { AndroidDaemonConnection } from './lib/android-connection'

const platform = detectPlatform()
console.log(`[SW] Detected platform: ${platform}`)

const daemonManager = new DaemonLifecycleManager(
  () => {
    if (platform === 'chromeos') {
      return new AndroidDaemonConnection()
    } else {
      return new NativeHostConnection()
    }
  },
  (event) => {
    console.log('[SW] Native event received:', event.event)
    sendToUI(event)
    if (event.event === 'TorrentAdded' || event.event === 'MagnetAdded') {
      openUiTab()
    }
  },
)
```

### Phase 5: Add Pairing Status to UI (Optional)

The UI should show pairing status on ChromeOS. Add a message handler in `sw.ts`:

```typescript
// In the message handler switch statement, add:
case 'GET_PAIRING_STATUS': {
  if (platform === 'chromeos') {
    // Type assertion since we know it's AndroidDaemonConnection on ChromeOS
    const androidConn = /* get connection somehow */
    const isPaired = await androidConn.isPaired()
    sendResponse({ ok: true, paired: isPaired, platform: 'chromeos' })
  } else {
    sendResponse({ ok: true, paired: true, platform: 'desktop' })
  }
  return true
}

case 'INITIATE_PAIRING': {
  if (platform === 'chromeos') {
    try {
      await daemonManager.getDaemonInfo() // This triggers pairing if needed
      sendResponse({ ok: true })
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  } else {
    sendResponse({ ok: false, error: 'Pairing only needed on ChromeOS' })
  }
  return true
}
```

## Testing

### On ChromeOS

1. Install the Android app (`app-debug.apk`)
2. Open the Android app - note it should start the daemon
3. Load the extension
4. Open extension popup or UI
5. Should see pairing intent open (first time)
6. Accept in Android app
7. Extension should now connect

### Verify Connection

In Chrome DevTools (service worker):
```javascript
// Check platform detection
detectPlatform() // Should return 'chromeos'

// Check daemon reachability
await fetch('http://100.115.92.2:7800/status').then(r => r.text())
```

### Debug Logging

All connection classes log with prefixes:
- `[AndroidDaemonConnection]` - Android-specific
- `[DaemonLifecycleManager]` - Lifecycle events
- `[SW]` - Service worker

## Error Handling

### "Android daemon not reachable"

1. Check Android app is installed and running
2. Check app has started its HTTP server (look for notification or log)
3. Try `curl http://100.115.92.2:7800/status` from Chrome DevTools

### Pairing Intent Not Opening

1. Chrome may block the intent URL as a popup
2. User may need to click a button to trigger pairing
3. Add UI button that calls `INITIATE_PAIRING` message

### Token Mismatch After Re-pairing

1. Clear extension storage: `chrome.storage.local.remove('android:authToken')`
2. Clear Android app data
3. Re-pair

## Files Changed/Created

| File | Action |
|------|--------|
| `extension/public/manifest.json` | Modified - add `host_permissions` |
| `extension/src/lib/platform.ts` | Created - platform detection |
| `extension/src/lib/android-connection.ts` | Created - Android daemon connection |
| `extension/src/sw.ts` | Modified - use platform detection |

## Notes

- The `AndroidDaemonConnection` implements `INativeHostConnection` for compatibility, but the underlying protocol is different (HTTP instead of native messaging)
- Folder picker (`pickDownloadDirectory`) is not supported on ChromeOS yet - would need Android SAF integration
- The pairing flow uses Chrome's intent URL handling which should work on ChromeOS
- If the Android app isn't running, `getDaemonInfo()` will throw - UI should handle this gracefully and prompt user to open the app
