# Control Plane & Bridge Simplification

## Overview

This task adds a control plane to the Android daemon and dramatically simplifies the extension's connection management. The current IOBridge state machine is over-engineered - eight states, history tracking, timeout management - all to answer "is the daemon connected?"

**Root cause:** The Android daemon was built as a pure I/O worker with no control channel. Desktop has native messaging for control; ChromeOS had nothing, leading to polling and intent workarounds.

**Solution:** Piggyback control frames on the existing `/io` WebSocket, then collapse the state machine to three states.

## Goals

1. Android daemon can push events to extension (roots changed, torrent added)
2. Extension connection management reduces to: `connecting | connected | disconnected`
3. UI receives updates automatically via port (no polling, no manual refetch)
4. Desktop and ChromeOS architectures feel identical from SW's perspective

## Non-Goals

- Changing the data plane (TCP/UDP/file I/O)
- Adding new features beyond control plane parity

---

## Phase 1: Android Control Plane

Add control frame support to the Android daemon's WebSocket.

### 1.1 Add Protocol Constants

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/Protocol.kt`

Add after existing opcode constants:

```kotlin
// Control plane opcodes (0xE0-0xEF)
const val OP_CTRL_ROOTS_CHANGED: Byte = 0xE0.toByte()
const val OP_CTRL_EVENT: Byte = 0xE1.toByte()
```

### 1.2 Add Control Broadcast to IoDaemonService

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/service/IoDaemonService.kt`

Replace entire file:

```kotlin
package com.jstorrent.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jstorrent.app.MainActivity
import com.jstorrent.app.R
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.server.HttpServer
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.storage.RootStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val TAG = "IoDaemonService"
private const val NOTIFICATION_ID = 1
private const val CHANNEL_ID = "jstorrent_daemon"

@Serializable
data class ControlEvent(
    val event: String,
    val payload: kotlinx.serialization.json.JsonElement? = null
)

class IoDaemonService : Service() {

    private lateinit var tokenStore: TokenStore
    private lateinit var rootStore: RootStore
    private var httpServer: HttpServer? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        tokenStore = TokenStore(this)
        rootStore = RootStore(this)
        createNotificationChannel()
        
        // Set singleton for static access
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        startForeground(NOTIFICATION_ID, createNotification("Starting..."))
        startServer()

        val port = httpServer?.port ?: 0
        updateNotification("Running on port $port")

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        instance = null
        stopServer()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startServer() {
        if (httpServer?.isRunning == true) {
            Log.w(TAG, "Server already running")
            return
        }

        httpServer = HttpServer(tokenStore, rootStore, this)

        try {
            httpServer?.start()
            Log.i(TAG, "HTTP server started on port ${httpServer?.port}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start server", e)
        }
    }

    private fun stopServer() {
        httpServer?.stop()
        httpServer = null
    }

    // =========================================================================
    // Control Plane
    // =========================================================================

    /**
     * Broadcast ROOTS_CHANGED to all connected WebSocket clients.
     * Call this after AddRootActivity adds a new root.
     */
    fun broadcastRootsChanged() {
        val roots = rootStore.refreshAvailability()
        httpServer?.broadcastRootsChanged(roots)
        Log.i(TAG, "Broadcast ROOTS_CHANGED with ${roots.size} roots")
    }

    /**
     * Broadcast a generic event to all connected WebSocket clients.
     */
    fun broadcastEvent(event: String, payload: kotlinx.serialization.json.JsonElement? = null) {
        httpServer?.broadcastEvent(event, payload)
        Log.i(TAG, "Broadcast event: $event")
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JSTorrent Daemon",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when JSTorrent daemon is running"
            setShowBadge(false)
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("JSTorrent")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(status: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(status))
    }

    companion object {
        // Singleton for static access from AddRootActivity
        @Volatile
        var instance: IoDaemonService? = null
            private set

        fun start(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.stopService(intent)
        }
    }
}
```

### 1.3 Add Control Broadcast to HttpServer

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

Add imports at top:

```kotlin
import com.jstorrent.app.server.Protocol
import kotlinx.serialization.json.JsonElement
```

Add after `private var actualPort: Int = 0`:

```kotlin
// Connected WebSocket sessions for control broadcasts
private val controlSessions = java.util.concurrent.CopyOnWriteArrayList<SocketSession>()
```

Add public methods before `companion object`:

```kotlin
/**
 * Register a WebSocket session for control broadcasts.
 */
fun registerControlSession(session: SocketSession) {
    controlSessions.add(session)
    Log.d(TAG, "Control session registered, total: ${controlSessions.size}")
}

/**
 * Unregister a WebSocket session.
 */
fun unregisterControlSession(session: SocketSession) {
    controlSessions.remove(session)
    Log.d(TAG, "Control session unregistered, total: ${controlSessions.size}")
}

/**
 * Broadcast ROOTS_CHANGED to all authenticated sessions.
 */
fun broadcastRootsChanged(roots: List<DownloadRoot>) {
    val jsonPayload = json.encodeToString(roots).toByteArray()
    val frame = Protocol.createMessage(Protocol.OP_CTRL_ROOTS_CHANGED, 0, jsonPayload)
    
    controlSessions.forEach { session ->
        session.sendControl(frame)
    }
}

/**
 * Broadcast generic event to all authenticated sessions.
 */
fun broadcastEvent(event: String, payload: JsonElement?) {
    val eventObj = mapOf("event" to event, "payload" to payload)
    val jsonPayload = json.encodeToString(eventObj).toByteArray()
    val frame = Protocol.createMessage(Protocol.OP_CTRL_EVENT, 0, jsonPayload)
    
    controlSessions.forEach { session ->
        session.sendControl(frame)
    }
}
```

### 1.4 Update SocketSession for Control Registration

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`

Add to `SocketSession` class, new constructor parameter:

```kotlin
class SocketSession(
    private val wsSession: DefaultWebSocketServerSession,
    private val tokenStore: TokenStore,
    private val httpServer: HttpServer  // NEW
) {
```

Add method to `SocketSession`:

```kotlin
/**
 * Send a control frame. Only works if authenticated.
 */
fun sendControl(frame: ByteArray) {
    if (authenticated) {
        send(frame)
    }
}
```

In `handlePreAuth`, after successful auth (after `Log.i(TAG, "WebSocket authenticated")`):

```kotlin
// Register for control broadcasts now that we're authenticated
httpServer.registerControlSession(this@SocketSession)
```

In `cleanup()` method, add at the beginning:

```kotlin
httpServer.unregisterControlSession(this)
```

### 1.5 Update WebSocket Route to Pass HttpServer

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

Change the webSocket route in `configureRouting()`:

```kotlin
webSocket("/io") {
    Log.i(TAG, "WebSocket connected")
    val session = SocketSession(this, tokenStore, this@HttpServer)  // Pass this
    session.run()
    Log.i(TAG, "WebSocket disconnected")
}
```

### 1.6 Trigger Broadcast from AddRootActivity

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/AddRootActivity.kt`

In `handleFolderSelected`, after `val root = rootStore.addRoot(uri)`:

```kotlin
// Notify connected clients about new root
IoDaemonService.instance?.broadcastRootsChanged()
```

Add import at top:

```kotlin
import com.jstorrent.app.service.IoDaemonService
```

---

## Phase 2: Extension Control Frame Handling

Handle incoming control frames in the extension.

### 2.1 Create New Simplified Bridge

**File:** `extension/src/lib/daemon-bridge.ts` (NEW FILE)

```typescript
/**
 * Daemon Bridge
 * 
 * Simplified connection management for both desktop and ChromeOS.
 * Replaces the complex IOBridge state machine.
 */

import type { Platform } from './platform'
import { detectPlatform } from './platform'

// ============================================================================
// Types
// ============================================================================

export interface DownloadRoot {
  key: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}

export interface DaemonInfo {
  port: number
  token: string
  version: number
  host?: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface DaemonBridgeState {
  status: ConnectionStatus
  platform: Platform
  daemonInfo: DaemonInfo | null
  roots: DownloadRoot[]
  lastError: string | null
}

export interface NativeEvent {
  event: string
  payload: unknown
}

export type StateListener = (state: DaemonBridgeState) => void
export type EventListener = (event: NativeEvent) => void

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'
const STORAGE_KEY_HAS_CONNECTED = 'daemon:hasConnectedSuccessfully'

// ============================================================================
// DaemonBridge Class
// ============================================================================

export class DaemonBridge {
  private state: DaemonBridgeState
  private stateListeners = new Set<StateListener>()
  private eventListeners = new Set<EventListener>()
  
  // Platform-specific
  private nativePort: chrome.runtime.Port | null = null
  private ws: WebSocket | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  
  constructor() {
    const platform = detectPlatform()
    this.state = {
      status: 'disconnected',
      platform,
      daemonInfo: null,
      roots: [],
      lastError: null,
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  getState(): DaemonBridgeState {
    return this.state
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Attempt to connect to the daemon.
   * Returns true if connection succeeded.
   */
  async connect(): Promise<boolean> {
    this.updateState({ status: 'connecting', lastError: null })

    try {
      if (this.state.platform === 'desktop') {
        await this.connectDesktop()
      } else {
        await this.connectChromeos()
      }
      
      await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })
      return true
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error'
      this.updateState({ status: 'disconnected', lastError: error })
      return false
    }
  }

  /**
   * Disconnect from the daemon.
   */
  disconnect(): void {
    this.cleanup()
    this.updateState({ 
      status: 'disconnected', 
      daemonInfo: null,
      roots: [],
    })
  }

  /**
   * Check if we've ever successfully connected (for install prompt logic).
   */
  async hasEverConnected(): Promise<boolean> {
    const result = await chrome.storage.local.get(STORAGE_KEY_HAS_CONNECTED)
    return result[STORAGE_KEY_HAS_CONNECTED] === true
  }

  /**
   * Trigger Android app launch (ChromeOS only).
   */
  async triggerLaunch(): Promise<boolean> {
    if (this.state.platform !== 'chromeos') return false

    try {
      const token = await this.getOrCreateToken()
      const intentUrl = `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }
      return true
    } catch (e) {
      console.error('[DaemonBridge] Failed to trigger launch:', e)
      return false
    }
  }

  /**
   * Trigger folder picker.
   * Desktop: via native messaging
   * ChromeOS: via Android intent, returns when ROOTS_CHANGED received
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    if (this.state.platform === 'desktop') {
      return this.pickFolderDesktop()
    } else {
      return this.pickFolderChromeos()
    }
  }

  // ==========================================================================
  // Desktop Implementation
  // ==========================================================================

  private async connectDesktop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative('com.anthropic.jstorrent')
      
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          port.disconnect()
          reject(new Error('Handshake timeout'))
        }
      }, 10000)

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          const error = chrome.runtime.lastError?.message || 'Disconnected'
          reject(new Error(error))
        } else {
          // Disconnected after successful connection
          this.handleDisconnect()
        }
      })

      port.onMessage.addListener((msg: unknown) => {
        if (!resolved && this.isDaemonInfoMessage(msg)) {
          resolved = true
          clearTimeout(timeout)
          
          const payload = (msg as { payload: DaemonInfo & { roots: DownloadRoot[] } }).payload
          this.nativePort = port
          this.updateState({
            status: 'connected',
            daemonInfo: {
              port: payload.port,
              token: payload.token,
              version: payload.version ?? 1,
            },
            roots: payload.roots || [],
          })
          
          // Continue listening for events
          this.setupDesktopEventListener(port)
          resolve()
        } else if (resolved) {
          // Post-connection messages
          this.handleDesktopMessage(msg)
        }
      })

      // Send handshake
      port.postMessage({
        op: 'handshake',
        extensionId: chrome.runtime.id,
        id: crypto.randomUUID(),
      })
    })
  }

  private setupDesktopEventListener(port: chrome.runtime.Port): void {
    // Already set up in connectDesktop's onMessage handler
  }

  private handleDesktopMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return

    // Handle native events (TorrentAdded, MagnetAdded, etc.)
    if ('event' in msg) {
      this.emitEvent(msg as NativeEvent)
    }

    // Handle RootAdded response
    if ('type' in msg && (msg as { type: string }).type === 'RootAdded') {
      const payload = (msg as { payload?: { root?: DownloadRoot } }).payload
      if (payload?.root) {
        this.addRoot(payload.root)
      }
    }
  }

  private async pickFolderDesktop(): Promise<DownloadRoot | null> {
    if (!this.nativePort) return null

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      
      const handler = (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as { id?: string; ok?: boolean; type?: string; payload?: { root?: DownloadRoot } }
        
        if (response.id !== requestId) return
        
        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          resolve(response.payload.root)
        } else {
          resolve(null)
        }
      }

      // Note: Native messaging doesn't support removing listeners easily,
      // but responses are keyed by requestId so this is safe
      this.nativePort!.onMessage.addListener(handler)
      this.nativePort!.postMessage({ op: 'pickDownloadDirectory', id: requestId })
    })
  }

  // ==========================================================================
  // ChromeOS Implementation
  // ==========================================================================

  private async connectChromeos(): Promise<void> {
    const port = await this.findDaemonPort()
    if (!port) {
      throw new Error('Android daemon not reachable')
    }

    const token = await this.getOrCreateToken()
    const paired = await this.checkPaired(port)
    if (!paired) {
      throw new Error('Daemon not paired')
    }

    // Fetch initial roots
    const roots = await this.fetchRoots(port, token)

    // Connect WebSocket for control plane
    await this.connectWebSocket(port, token)

    this.updateState({
      status: 'connected',
      daemonInfo: { port, token, version: 1, host: '100.115.92.2' },
      roots,
    })

    // Start health check
    this.startHealthCheck(port)
  }

  private async connectWebSocket(port: number, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://100.115.92.2:${port}/io`)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket timeout'))
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
          const authPayload = new Uint8Array([0, ...new TextEncoder().encode(token)])
          ws.send(this.buildFrame(0x03, 0, authPayload))
        } else if (opcode === 0x04) {
          // AUTH_RESULT
          const status = data[8]
          if (status === 0) {
            clearTimeout(timeout)
            this.ws = ws
            resolve()
          } else {
            clearTimeout(timeout)
            ws.close()
            reject(new Error('Auth failed'))
          }
        } else if (opcode === 0xE0) {
          // ROOTS_CHANGED
          this.handleRootsChanged(data)
        } else if (opcode === 0xE1) {
          // EVENT
          this.handleControlEvent(data)
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket error'))
      }

      ws.onclose = () => {
        if (this.ws === ws) {
          this.handleDisconnect()
        }
      }
    })
  }

  private handleRootsChanged(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const roots = JSON.parse(json) as DownloadRoot[]
      
      // Map Android format to extension format
      const mapped = roots.map(r => ({
        key: r.key,
        path: (r as unknown as { uri?: string }).uri || r.path,
        display_name: (r as unknown as { displayName?: string }).displayName || r.display_name,
        removable: r.removable,
        last_stat_ok: (r as unknown as { lastStatOk?: boolean }).lastStatOk ?? r.last_stat_ok,
        last_checked: (r as unknown as { lastChecked?: number }).lastChecked ?? r.last_checked,
      }))
      
      this.updateState({ roots: mapped })
      console.log('[DaemonBridge] Roots updated:', mapped.length)
    } catch (e) {
      console.error('[DaemonBridge] Failed to parse ROOTS_CHANGED:', e)
    }
  }

  private handleControlEvent(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const event = JSON.parse(json) as NativeEvent
      this.emitEvent(event)
    } catch (e) {
      console.error('[DaemonBridge] Failed to parse EVENT:', e)
    }
  }

  private async pickFolderChromeos(): Promise<DownloadRoot | null> {
    const existingKeys = new Set(this.state.roots.map(r => r.key))

    // Open intent
    const intentUrl = 'intent://add-root#Intent;scheme=jstorrent;package=com.jstorrent.app;end'
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: intentUrl })
    } else {
      await chrome.tabs.create({ url: intentUrl })
    }

    // Wait for ROOTS_CHANGED with new root (via WebSocket)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        resolve(null)
      }, 60000) // 60s timeout for user to pick folder

      const unsubscribe = this.subscribe((state) => {
        const newRoot = state.roots.find(r => !existingKeys.has(r.key))
        if (newRoot) {
          clearTimeout(timeout)
          unsubscribe()
          resolve(newRoot)
        }
      })
    })
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    // flags at 2-3 (0)
    // requestId at 4-7 (little endian)
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true)
    frame.set(payload, 8)
    return frame.buffer
  }

  private async findDaemonPort(): Promise<number | null> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    const ports = [stored[STORAGE_KEY_PORT], 7800, 7805, 7814, 7827, 7844].filter(Boolean) as number[]

    for (const port of ports) {
      try {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 2000)
        
        const response = await fetch(`http://100.115.92.2:${port}/status`, {
          signal: controller.signal,
        })
        
        if (response.ok) {
          await chrome.storage.local.set({ [STORAGE_KEY_PORT]: port })
          return port
        }
      } catch {
        // Try next port
      }
    }
    return null
  }

  private async checkPaired(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://100.115.92.2:${port}/status`)
      const data = await response.json() as { paired: boolean }
      return data.paired
    } catch {
      return false
    }
  }

  private async fetchRoots(port: number, token: string): Promise<DownloadRoot[]> {
    try {
      const response = await fetch(`http://100.115.92.2:${port}/roots`, {
        headers: { 'X-JST-Auth': token },
      })
      
      if (!response.ok) return []
      
      const data = await response.json() as { roots: Array<{
        key: string
        uri: string
        display_name?: string
        displayName?: string
        removable: boolean
        last_stat_ok?: boolean
        lastStatOk?: boolean
        last_checked?: number
        lastChecked?: number
      }> }
      
      return data.roots.map(r => ({
        key: r.key,
        path: r.uri,
        display_name: r.display_name || r.displayName || '',
        removable: r.removable,
        last_stat_ok: r.last_stat_ok ?? r.lastStatOk ?? true,
        last_checked: r.last_checked ?? r.lastChecked ?? Date.now(),
      }))
    } catch {
      return []
    }
  }

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }
    const token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token })
    return token
  }

  private startHealthCheck(port: number): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://100.115.92.2:${port}/health`)
        if (!response.ok) throw new Error('Health check failed')
      } catch {
        this.handleDisconnect()
      }
    }, 5000)
  }

  // ==========================================================================
  // Shared Helpers
  // ==========================================================================

  private isDaemonInfoMessage(msg: unknown): boolean {
    return (
      typeof msg === 'object' &&
      msg !== null &&
      'type' in msg &&
      (msg as { type: string }).type === 'DaemonInfo' &&
      'payload' in msg
    )
  }

  private handleDisconnect(): void {
    this.cleanup()
    this.updateState({ 
      status: 'disconnected', 
      lastError: 'Connection lost',
    })
  }

  private cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.nativePort) {
      this.nativePort.disconnect()
      this.nativePort = null
    }
  }

  private updateState(partial: Partial<DaemonBridgeState>): void {
    this.state = { ...this.state, ...partial }
    this.notifyStateListeners()
  }

  private addRoot(root: DownloadRoot): void {
    const exists = this.state.roots.some(r => r.key === root.key)
    if (!exists) {
      this.updateState({ roots: [...this.state.roots, root] })
    }
  }

  private notifyStateListeners(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(this.state)
      } catch (e) {
        console.error('[DaemonBridge] Listener error:', e)
      }
    }
  }

  private emitEvent(event: NativeEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('[DaemonBridge] Event listener error:', e)
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let bridge: DaemonBridge | null = null

export function getDaemonBridge(): DaemonBridge {
  if (!bridge) {
    bridge = new DaemonBridge()
  }
  return bridge
}
```

### 2.2 Update Service Worker

**File:** `extension/src/sw.ts`

Replace imports at top:

```typescript
const SW_START_TIME = new Date().toISOString()
console.log(`[SW] Service Worker loaded at ${SW_START_TIME}`)

import { getDaemonBridge, type NativeEvent, type DaemonBridgeState } from './lib/daemon-bridge'
import { handleKVMessage } from './lib/kv-handlers'
import { NotificationManager, ProgressStats } from './lib/notifications'
```

Replace IOBridge section with:

```typescript
// ============================================================================
// Daemon Bridge (replaces IOBridge state machine)
// ============================================================================

const bridge = getDaemonBridge()

// Start connection attempt
bridge.connect().then((success) => {
  console.log(`[SW] Initial connection: ${success ? 'success' : 'failed'}`)
})

// Forward native events to UI
bridge.onEvent((event: NativeEvent) => {
  console.log('[SW] Native event received:', event.event)
  sendToUI(event)
  if (event.event === 'TorrentAdded' || event.event === 'MagnetAdded') {
    openUiTab()
  }
})

// Forward state changes to UI
bridge.subscribe((state: DaemonBridgeState) => {
  if (primaryUIPort) {
    console.log('[SW] Forwarding state change to UI:', state.status)
    bridge.hasEverConnected().then((hasConnected) => {
      primaryUIPort?.postMessage({
        type: 'BRIDGE_STATE_CHANGED',
        state,
        hasEverConnected: hasConnected,
      })
    })
  }
})

console.log(`[SW] Daemon Bridge started, platform: ${bridge.getState().platform}`)
```

Update message handler - replace the entire `handleMessage` function:

```typescript
function handleMessage(
  message: {
    type?: string
    event?: string
    key?: string
    keys?: string[]
    value?: string
    prefix?: string
  },
  sendResponse: SendResponse,
): boolean {
  // Notification messages
  if (message.type?.startsWith('notification:')) {
    handleNotificationMessage(message as NotificationMessage)
    sendResponse({ ok: true })
    return true
  }

  // KV operations
  if (message.type?.startsWith('KV_')) {
    return handleKVMessage(message, sendResponse)
  }

  // Get bridge state
  if (message.type === 'GET_BRIDGE_STATE') {
    const state = bridge.getState()
    bridge.hasEverConnected().then((hasConnected) => {
      sendResponse({ ok: true, state, hasEverConnected: hasConnected })
    })
    return true
  }

  // Get daemon info (for engine initialization)
  if (message.type === 'GET_DAEMON_INFO') {
    const state = bridge.getState()

    if (state.status === 'connected' && state.daemonInfo) {
      sendResponse({
        ok: true,
        daemonInfo: state.daemonInfo,
        roots: state.roots,
      })
    } else {
      sendResponse({
        ok: false,
        status: state.status,
        error: state.lastError || `Not connected: ${state.status}`,
      })
    }
    return true
  }

  // Trigger launch (ChromeOS)
  if (message.type === 'TRIGGER_LAUNCH') {
    bridge.triggerLaunch().then((success) => {
      sendResponse({ ok: success })
    })
    return true
  }

  // Retry connection
  if (message.type === 'RETRY_CONNECTION') {
    bridge.connect().then((success) => {
      sendResponse({ ok: success })
    })
    return true
  }

  // Folder picker
  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    bridge
      .pickDownloadFolder()
      .then((root) => sendResponse({ ok: true, root }))
      .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // UI closing - no longer need to track UI count with simplified bridge
  if (message.type === 'UI_CLOSING') {
    sendResponse({ ok: true })
    return true
  }

  // Magnet/torrent added
  if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
    openUiTab()
    return false
  }

  return false
}
```

Update UI port connect to send initial state:

```typescript
function handleUIPortConnect(port: chrome.runtime.Port): void {
  console.log('[SW] UI connected via port')

  if (primaryUIPort) {
    console.log('[SW] Closing existing UI')
    try {
      primaryUIPort.postMessage({ type: 'CLOSE' })
    } catch {
      // Port may already be disconnected
    }
  }

  primaryUIPort = port

  // Send current bridge state immediately
  const state = bridge.getState()
  bridge.hasEverConnected().then((hasConnected) => {
    port.postMessage({
      type: 'BRIDGE_STATE_CHANGED',
      state,
      hasEverConnected: hasConnected,
    })
  })

  // Send pending event if any
  chrome.storage.session
    .get(PENDING_EVENT_KEY)
    .then((result) => {
      const pendingEvent = result[PENDING_EVENT_KEY] as NativeEvent | undefined
      if (pendingEvent) {
        console.log('[SW] Sending pending event from storage:', pendingEvent.event)
        port.postMessage(pendingEvent)
        chrome.storage.session.remove(PENDING_EVENT_KEY)
      }
    })
    .catch((e) => {
      console.error('[SW] Failed to get pending event from storage:', e)
    })

  port.onDisconnect.addListener(() => {
    console.log('[SW] UI port disconnected')
    if (primaryUIPort === port) {
      primaryUIPort = null
    }
  })
}
```

---

## Phase 3: Delete Old IOBridge

### 3.1 Delete Files

Remove these files/directories:

```
extension/src/lib/io-bridge/
├── __tests__/                    # DELETE entire directory
├── adapters/                     # DELETE entire directory  
├── index.ts                      # DELETE
├── io-bridge-adapter.ts          # DELETE
├── io-bridge-effects.ts          # DELETE
├── io-bridge-service.ts          # DELETE
├── io-bridge-state.ts            # DELETE
├── io-bridge-store.ts            # DELETE
├── readiness.ts                  # KEEP (may still be useful, review)
├── types.ts                      # DELETE (types now in daemon-bridge.ts)
└── version-status.ts             # KEEP (may still be useful, review)
```

### 3.2 Update Client Code

**File:** `packages/client/src/chrome/engine-manager.ts`

Update `DaemonInfo` interface and imports. The `GET_DAEMON_INFO` response now includes `roots` separately:

```typescript
// Update the response handling in doInit()
const response = await bridge.sendMessage<{
  ok: boolean
  daemonInfo?: DaemonInfo
  roots?: DownloadRoot[]
  error?: string
}>({ type: 'GET_DAEMON_INFO' })

if (!response.ok) {
  throw new Error(`Failed to get daemon info: ${response.error}`)
}

const daemonInfo: DaemonInfo = response.daemonInfo!
const roots = response.roots || []

// Later, use `roots` instead of `daemonInfo.roots`
if (roots.length > 0) {
  for (const root of roots) {
    // ...
  }
}
```

### 3.3 Update UI Components

Any component using `useIOBridgeState` or similar hooks needs updating to use the new simplified state shape. The key changes:

- `state.name` → `state.status` 
- States like `INSTALL_PROMPT`, `LAUNCH_PROMPT` → UI decides based on `status + hasEverConnected + platform`
- `IOBRIDGE_STATE_CHANGED` → `BRIDGE_STATE_CHANGED`

---

## Phase 4: Verification

### 4.1 Android Build

```bash
cd android-io-daemon
./gradlew assembleDebug
```

### 4.2 Extension Build

```bash
cd extension
pnpm build
```

### 4.3 Manual Testing

1. **Fresh install flow (ChromeOS):**
   - Install extension
   - Should see "Install Android app" prompt
   - Install Android app, pair
   - Should connect

2. **Add folder (ChromeOS):**
   - Click "Add Folder"
   - SAF picker opens
   - Select folder
   - Folder appears in UI immediately (no refresh needed)

3. **Reconnection:**
   - Force-stop Android app
   - Extension should show disconnected state
   - Restart Android app
   - Click retry
   - Should reconnect

4. **Desktop parity:**
   - Same flows should work on desktop via native host

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| Android `IoDaemonService` | Add `broadcastRootsChanged()`, singleton instance |
| Android `HttpServer` | Track control sessions, `broadcastRootsChanged()` |
| Android `SocketSession` | Register/unregister for control, `sendControl()` |
| Android `AddRootActivity` | Call `broadcastRootsChanged()` after adding root |
| Android `Protocol` | Add `OP_CTRL_ROOTS_CHANGED`, `OP_CTRL_EVENT` |
| Extension `daemon-bridge.ts` | NEW - simplified bridge, 3 states |
| Extension `sw.ts` | Use new bridge, simplified message handling |
| Extension `io-bridge/*` | DELETE most files |
| Client `engine-manager.ts` | Update response handling |

## Files to Create

- `extension/src/lib/daemon-bridge.ts`

## Files to Delete

- `extension/src/lib/io-bridge/__tests__/*`
- `extension/src/lib/io-bridge/adapters/*`
- `extension/src/lib/io-bridge/index.ts`
- `extension/src/lib/io-bridge/io-bridge-adapter.ts`
- `extension/src/lib/io-bridge/io-bridge-effects.ts`
- `extension/src/lib/io-bridge/io-bridge-service.ts`
- `extension/src/lib/io-bridge/io-bridge-state.ts`
- `extension/src/lib/io-bridge/io-bridge-store.ts`
- `extension/src/lib/io-bridge/types.ts`
