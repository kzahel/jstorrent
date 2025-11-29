# Design: Move BTEngine from Service Worker to UI Thread

## Overview

This document describes the architectural change to move the BitTorrent engine (`BtEngine`) from the Chrome extension service worker to the UI thread (tab). The primary motivation is UI responsiveness—sharing the same heap eliminates serialization overhead when rendering thousands of torrents, files, and peers with TanStack/Solid.js.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker Thread                     │
│  ┌─────────┐    ┌────────────┐    ┌───────────────────────┐ │
│  │ Client  │───▶│ BTEngine   │───▶│ DaemonSocketFactory   │ │
│  └─────────┘    └────────────┘    └───────────────────────┘ │
│       │                                      │               │
│       │ connectNative                        │ WebSocket     │
│       ▼                                      ▼               │
│  ┌────────────────┐               ┌──────────────────────┐  │
│  │ native-host    │──subprocess──▶│ io-daemon            │  │
│  └────────────────┘               └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ chrome.runtime.sendMessage (polling every 1s)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                      UI Thread (Tab)                         │
│  ┌──────────────────┐    ┌─────────────────────────────┐    │
│  │ React UI         │───▶│ useEngineState (polls SW)   │    │
│  └──────────────────┘    └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Current Data Flow

1. UI polls service worker every 1 second via `chrome.runtime.sendMessage({ type: 'GET_STATE' })`
2. Service worker serializes entire engine state via `getEngineState(engine)`
3. Serialized state sent back to UI
4. UI deserializes and renders

### Problems with Current Architecture

- **Serialization overhead**: Every state read requires full serialization/deserialization
- **Polling latency**: 1-second update granularity
- **Memory duplication**: State exists in both threads
- **Limited scalability**: Thousands of peers/files = large serialized payloads

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker Thread                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ DaemonLifecycleManager                                  ││
│  │  - Keeps connectNative alive while UI tabs exist        ││
│  │  - Returns DaemonInfo on request                        ││
│  │  - Handles pickDownloadFolder (needs native host)       ││
│  │  - Tracks active UI count                               ││
│  │  - Closes connectNative when all UIs close              ││
│  └─────────────────────────────────────────────────────────┘│
│       │                                                      │
│       │ connectNative (open only while UI exists)            │
│       ▼                                                      │
│  ┌────────────────┐               ┌──────────────────────┐  │
│  │ native-host    │──subprocess──▶│ io-daemon            │  │
│  └────────────────┘               └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                                     ▲
         │ GET_DAEMON_INFO (once)              │ WebSocket (direct)
         │ UI_CLOSING                          │
         │ PICK_DOWNLOAD_FOLDER                │
┌────────┼─────────────────────────────────────┼──────────────┐
│        │            UI Thread (Tab)          │              │
│        ▼                                     │              │
│  ┌──────────────┐   ┌────────────┐   ┌──────┴───────────┐  │
│  │ Solid.js UI  │◀──│ BTEngine   │──▶│ DaemonConnection │  │
│  │ TanStack     │   └────────────┘   └──────────────────┘  │
│  └──────────────┘         │                                 │
│        ▲                  │                                 │
│        └──────────────────┘                                 │
│         Same heap - zero serialization                      │
└─────────────────────────────────────────────────────────────┘
```

### Target Data Flow

1. UI requests daemon info once from SW: `GET_DAEMON_INFO`
2. SW opens `connectNative`, performs handshake, returns `DaemonInfo`
3. UI creates `DaemonConnection` (WebSocket) directly to daemon
4. UI creates `BtEngine` in its own thread
5. UI accesses `engine.torrents`, `engine.peers`, etc. directly—zero serialization
6. UI subscribes to engine events for reactive updates
7. On tab close, UI sends `UI_CLOSING` to SW
8. SW closes `connectNative` when no UIs remain (with grace period)

## Service Worker Lifecycle State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SW State Machine                             │
│                                                                      │
│   ┌─────────┐   launch-ping      ┌──────────┐  GET_DAEMON  ┌──────┐ │
│   │ DORMANT │ ────────────────▶  │ WAKING   │ ──────────▶  │ACTIVE│ │
│   │         │   magnetAdded      │          │  _INFO       │      │ │
│   │         │   torrentAdded     │          │              │      │ │
│   └─────────┘   UI tab opens     └──────────┘              └──────┘ │
│        ▲                                                       │     │
│        │         activeUICount=0 + grace period expires        │     │
│        └───────────────────────────────────────────────────────┘     │
│                                                                      │
│   DORMANT: connectNative closed, SW can suspend                      │
│   WAKING:  Received trigger, opening UI tab                          │
│   ACTIVE:  connectNative open, serving UI(s)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### State Transitions

| Current State | Event | Action | Next State |
|---------------|-------|--------|------------|
| DORMANT | `launch-ping` | Open UI tab | WAKING |
| DORMANT | `magnetAdded` / `torrentAdded` | Open UI tab | WAKING |
| WAKING | `GET_DAEMON_INFO` | Open connectNative, handshake, return info | ACTIVE |
| ACTIVE | `GET_DAEMON_INFO` | Return cached info, increment UI count | ACTIVE |
| ACTIVE | `UI_CLOSING` | Decrement UI count, maybe start grace timer | ACTIVE or start timer |
| ACTIVE | Grace timer expires & count=0 | Close connectNative | DORMANT |
| ACTIVE | `PICK_DOWNLOAD_FOLDER` | Forward to native host, return result | ACTIVE |

## Detailed Implementation Plan

### Phase 1: Create DaemonLifecycleManager in Service Worker

**File: `extension/src/lib/daemon-lifecycle-manager.ts` (NEW)**

```typescript
import { NativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'

export class DaemonLifecycleManager {
  private nativeConn: NativeHostConnection | null = null
  private daemonInfo: DaemonInfo | null = null
  private activeUICount = 0
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null
  private readonly GRACE_PERIOD_MS = 5000

  /**
   * Get daemon info, opening native connection if needed.
   * Called when UI requests GET_DAEMON_INFO.
   */
  async getDaemonInfo(): Promise<DaemonInfo> {
    // Clear any pending grace period shutdown
    if (this.gracePeriodTimer) {
      clearTimeout(this.gracePeriodTimer)
      this.gracePeriodTimer = null
    }

    this.activeUICount++
    console.log(`[DaemonLifecycleManager] UI connected, count: ${this.activeUICount}`)

    if (this.daemonInfo) {
      return this.daemonInfo
    }

    // Open native connection and perform handshake
    this.nativeConn = new NativeHostConnection()
    await this.nativeConn.connect()

    const installId = await this.getInstallId()

    this.nativeConn.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: crypto.randomUUID(),
    })

    this.daemonInfo = await this.waitForDaemonInfo()
    console.log('[DaemonLifecycleManager] Daemon ready:', this.daemonInfo)

    // Set up disconnect handler
    this.nativeConn.onDisconnect(() => {
      console.log('[DaemonLifecycleManager] Native connection disconnected')
      this.daemonInfo = null
      this.nativeConn = null
    })

    return this.daemonInfo
  }

  /**
   * Called when a UI tab closes.
   */
  onUIClosing(): void {
    this.activeUICount = Math.max(0, this.activeUICount - 1)
    console.log(`[DaemonLifecycleManager] UI disconnected, count: ${this.activeUICount}`)

    if (this.activeUICount === 0) {
      this.startGracePeriod()
    }
  }

  /**
   * Pick a download folder via native host dialog.
   * Must be called while native connection is active.
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    if (!this.nativeConn) {
      throw new Error('Native connection not active')
    }

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()

      const handler = (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { root?: DownloadRoot }
          error?: string
        }

        if (response.id !== requestId) return

        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          resolve(response.payload.root)
        } else {
          console.log('Folder picker cancelled or failed:', response.error)
          resolve(null)
        }
      }

      this.nativeConn!.onMessage(handler)
      this.nativeConn!.send({
        op: 'pickDownloadDirectory',
        id: requestId,
      })
    })
  }

  private startGracePeriod(): void {
    console.log(`[DaemonLifecycleManager] Starting ${this.GRACE_PERIOD_MS}ms grace period`)

    this.gracePeriodTimer = setTimeout(() => {
      if (this.activeUICount === 0) {
        console.log('[DaemonLifecycleManager] Grace period expired, closing native connection')
        this.shutdown()
      }
    }, this.GRACE_PERIOD_MS)
  }

  private shutdown(): void {
    // Note: We don't explicitly disconnect - just let the reference go
    // The native host will detect disconnect and terminate daemon
    this.nativeConn = null
    this.daemonInfo = null
    this.gracePeriodTimer = null
  }

  private async getInstallId(): Promise<string> {
    const result = await chrome.storage.local.get('installId')
    if (result.installId) {
      return result.installId as string
    }
    const newId = crypto.randomUUID()
    await chrome.storage.local.set({ installId: newId })
    return newId
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve) => {
      const handler = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'type' in msg &&
          (msg as { type: string }).type === 'DaemonInfo'
        ) {
          resolve((msg as { payload: DaemonInfo }).payload)
        }
      }
      this.nativeConn!.onMessage(handler)
    })
  }
}
```

### Phase 2: Simplify Service Worker

**File: `extension/src/sw.ts` (MODIFY)**

Replace the current implementation with:

```typescript
console.log('Service Worker loaded')

import { DaemonLifecycleManager } from './lib/daemon-lifecycle-manager'

const daemonManager = new DaemonLifecycleManager()

// ============================================================================
// Installation handler - generate install ID
// ============================================================================
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed')
  const installId = await getOrGenerateInstallId()
  console.log('Generated/Retrieved Install ID:', installId)
})

async function getOrGenerateInstallId(): Promise<string> {
  const result = await chrome.storage.local.get('installId')
  if (result.installId) {
    return result.installId as string
  }
  const newId = crypto.randomUUID()
  await chrome.storage.local.set({ installId: newId })
  return newId
}

// ============================================================================
// UI Tab Management
// ============================================================================
async function openUiTab() {
  const url = chrome.runtime.getURL('src/ui/app.html')
  const tabs = await chrome.tabs.query({ url })
  if (tabs.length > 0 && tabs[0].id) {
    // Focus existing tab
    await chrome.tabs.update(tabs[0].id, { active: true })
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true })
    }
  } else {
    // Create new tab
    await chrome.tabs.create({ url })
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(() => {
  openUiTab()
})

// ============================================================================
// External messages (from jstorrent.com launch page)
// ============================================================================
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('Received external message:', message, sender)
  if (message.type === 'launch-ping') {
    openUiTab().then(() => sendResponse({ ok: true }))
    return true
  }
})

// ============================================================================
// Internal messages (from UI)
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received internal message:', message.type)

  // UI startup: get daemon connection info
  if (message.type === 'GET_DAEMON_INFO') {
    daemonManager
      .getDaemonInfo()
      .then((info) => sendResponse({ ok: true, daemonInfo: info }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // UI shutdown: decrement UI count
  if (message.type === 'UI_CLOSING') {
    daemonManager.onUIClosing()
    sendResponse({ ok: true })
    return true
  }

  // Folder picker (requires native host)
  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    daemonManager
      .pickDownloadFolder()
      .then((root) => sendResponse({ ok: true, root }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // Magnet/torrent added (from content script or other source)
  if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
    openUiTab()
    return false
  }
})
```

### Phase 3: Create UI Engine Manager

**File: `extension/src/ui/lib/engine-manager.ts` (NEW)**

```typescript
import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  StorageRootManager,
  ChromeStorageSessionStore,
  RingBufferLogger,
  LogEntry,
} from '@jstorrent/engine'

export interface DaemonInfo {
  port: number
  token: string
  version?: number
  roots: Array<{
    token: string
    path: string
    display_name: string
    removable: boolean
    last_stat_ok: boolean
    last_checked: number
  }>
}

/**
 * Manages the BtEngine lifecycle in the UI thread.
 * Singleton - one engine per tab.
 */
class EngineManager {
  engine: BtEngine | null = null
  daemonConnection: DaemonConnection | null = null
  logBuffer: RingBufferLogger = new RingBufferLogger(500)
  private initPromise: Promise<BtEngine> | null = null

  /**
   * Initialize the engine. Safe to call multiple times - returns cached engine.
   */
  async init(): Promise<BtEngine> {
    if (this.engine) {
      return this.engine
    }

    // Prevent concurrent initialization
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<BtEngine> {
    console.log('[EngineManager] Initializing...')

    // 1. Get daemon info from service worker
    const response = await chrome.runtime.sendMessage({ type: 'GET_DAEMON_INFO' })
    if (!response.ok) {
      throw new Error(`Failed to get daemon info: ${response.error}`)
    }
    const daemonInfo: DaemonInfo = response.daemonInfo
    console.log('[EngineManager] Got daemon info:', daemonInfo)

    // 2. Create direct WebSocket connection to daemon
    this.daemonConnection = new DaemonConnection(daemonInfo.port, daemonInfo.token)
    await this.daemonConnection.connectWebSocket()
    console.log('[EngineManager] WebSocket connected')

    // 3. Set up storage root manager
    const srm = new StorageRootManager(
      (root) => new DaemonFileSystem(this.daemonConnection!, root.token)
    )

    // Register download roots from daemon
    if (daemonInfo.roots && daemonInfo.roots.length > 0) {
      for (const root of daemonInfo.roots) {
        srm.addRoot({
          token: root.token,
          label: root.display_name,
          path: root.path,
        })
      }

      // Load saved default root
      const savedDefault = await chrome.storage.local.get('defaultRootToken')
      const defaultToken = savedDefault.defaultRootToken
      const validDefault = daemonInfo.roots.some((r) => r.token === defaultToken)

      if (validDefault && typeof defaultToken === 'string') {
        srm.setDefaultRoot(defaultToken)
      } else if (daemonInfo.roots.length > 0) {
        srm.setDefaultRoot(daemonInfo.roots[0].token)
      }
      console.log('[EngineManager] Registered', daemonInfo.roots.length, 'download roots')
    } else {
      console.warn('[EngineManager] No download roots configured!')
    }

    // 4. Create session store
    const sessionStore = new ChromeStorageSessionStore(chrome.storage.local, 'session:')

    // 5. Create engine (suspended)
    this.engine = new BtEngine({
      socketFactory: new DaemonSocketFactory(this.daemonConnection),
      storageRootManager: srm,
      sessionStore,
      startSuspended: true,
      onLog: (entry: LogEntry) => {
        this.logBuffer.add(entry)
      },
    })
    console.log('[EngineManager] Engine created (suspended)')

    // 6. Restore session
    const restored = await this.engine.restoreSession()
    console.log(`[EngineManager] Restored ${restored} torrents`)

    // 7. Resume engine
    this.engine.resume()
    console.log('[EngineManager] Engine resumed')

    // 8. Set up beforeunload handler
    window.addEventListener('beforeunload', () => {
      this.shutdown()
    })

    return this.engine
  }

  /**
   * Clean shutdown - notify SW that this UI is closing.
   */
  shutdown(): void {
    console.log('[EngineManager] Shutting down...')

    // Notify service worker
    chrome.runtime.sendMessage({ type: 'UI_CLOSING' }).catch(() => {
      // SW might already be inactive, ignore
    })

    // Clean up engine
    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    // Clean up connection
    if (this.daemonConnection) {
      this.daemonConnection.close()
      this.daemonConnection = null
    }

    this.initPromise = null
  }

  /**
   * Pick a download folder via native host.
   * Returns the new root, or null if cancelled.
   */
  async pickDownloadFolder(): Promise<DaemonInfo['roots'][0] | null> {
    const response = await chrome.runtime.sendMessage({ type: 'PICK_DOWNLOAD_FOLDER' })
    if (!response.ok || !response.root) {
      return null
    }

    // Register with StorageRootManager
    if (this.engine) {
      const root = response.root
      this.engine.storageRootManager.addRoot({
        token: root.token,
        label: root.display_name,
        path: root.path,
      })
    }

    return response.root
  }

  /**
   * Set the default download root.
   */
  async setDefaultRoot(token: string): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized')
    }
    this.engine.storageRootManager.setDefaultRoot(token)
    await chrome.storage.local.set({ defaultRootToken: token })
  }

  /**
   * Get current download roots.
   */
  getRoots(): Array<{ token: string; label: string; path: string }> {
    if (!this.engine) return []
    return this.engine.storageRootManager.getRoots()
  }

  /**
   * Get current default root token.
   */
  async getDefaultRootToken(): Promise<string | null> {
    const result = await chrome.storage.local.get('defaultRootToken')
    return (result.defaultRootToken as string) || null
  }
}

// Singleton export
export const engineManager = new EngineManager()
```

### Phase 4: Create React Context for Engine

**File: `extension/src/ui/context/EngineContext.tsx` (NEW)**

```typescript
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { BtEngine } from '@jstorrent/engine'
import { engineManager } from '../lib/engine-manager'

interface EngineContextValue {
  engine: BtEngine | null
  loading: boolean
  error: string | null
}

const EngineContext = createContext<EngineContextValue>({
  engine: null,
  loading: true,
  error: null,
})

export function EngineProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to initialize engine:', e)
        setError(String(e))
        setLoading(false)
      })
  }, [])

  return (
    <EngineContext.Provider value={{ engine, loading, error }}>
      {children}
    </EngineContext.Provider>
  )
}

export function useEngine(): EngineContextValue {
  return useContext(EngineContext)
}
```

### Phase 5: Create Engine State Hook (Direct Access)

**File: `extension/src/ui/hooks/useEngineState.ts` (REPLACE)**

Replace the polling implementation with direct engine access:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { BtEngine, Torrent } from '@jstorrent/engine'
import { useEngine } from '../context/EngineContext'

/**
 * Hook for reactive engine state updates.
 * Uses direct heap access + event subscriptions instead of polling.
 */
export function useEngineState() {
  const { engine, loading, error } = useEngine()
  const [, forceUpdate] = useState({})

  // Force re-render on engine events
  const refresh = useCallback(() => {
    forceUpdate({})
  }, [])

  useEffect(() => {
    if (!engine) return

    // Subscribe to engine events that affect UI
    const events = [
      'torrentAdded',
      'torrentRemoved',
      'torrentStateChanged',
      'peerConnected',
      'peerDisconnected',
      'pieceCompleted',
      'torrentCompleted',
    ] as const

    for (const event of events) {
      engine.on(event, refresh)
    }

    // Also refresh periodically for stats (download/upload rates)
    const interval = setInterval(refresh, 1000)

    return () => {
      for (const event of events) {
        engine.off(event, refresh)
      }
      clearInterval(interval)
    }
  }, [engine, refresh])

  return {
    engine,
    loading,
    error,
    // Direct access to engine data - no serialization!
    torrents: engine?.torrents ?? [],
    globalStats: engine ? {
      totalDownloadRate: engine.getTotalDownloadRate(),
      totalUploadRate: engine.getTotalUploadRate(),
    } : { totalDownloadRate: 0, totalUploadRate: 0 },
  }
}

/**
 * Hook for a single torrent's state.
 * More efficient for detail views.
 */
export function useTorrentState(infoHash: string) {
  const { engine } = useEngine()
  const [, forceUpdate] = useState({})

  useEffect(() => {
    if (!engine) return

    const refresh = () => forceUpdate({})

    // Subscribe to events for this specific torrent
    const handler = (torrent: Torrent) => {
      if (torrent.infoHash === infoHash) {
        refresh()
      }
    }

    engine.on('torrentStateChanged', handler)
    engine.on('pieceCompleted', handler)
    engine.on('peerConnected', handler)
    engine.on('peerDisconnected', handler)

    const interval = setInterval(refresh, 1000)

    return () => {
      engine.off('torrentStateChanged', handler)
      engine.off('pieceCompleted', handler)
      engine.off('peerConnected', handler)
      engine.off('peerDisconnected', handler)
      clearInterval(interval)
    }
  }, [engine, infoHash])

  return engine?.getTorrent(infoHash) ?? null
}
```

### Phase 6: Update App Entry Point

**File: `extension/src/ui/app.tsx` (MODIFY)**

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import { LogViewer } from './components/LogViewer'
import { DownloadRootsManager } from './components/DownloadRootsManager'
import { EngineProvider, useEngine } from './context/EngineContext'
import { useEngineState } from './hooks/useEngineState'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'logs' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const { engine, loading, error, torrents, globalStats } = useEngineState()

  const handleAddTorrent = async () => {
    if (!magnetInput || !engine) return
    try {
      await engine.addTorrent(magnetInput)
      setMagnetInput('')
    } catch (e) {
      console.error('Failed to add torrent:', e)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #ccc',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px' }}>JSTorrent</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'torrents' ? '#2196F3' : '#eee',
              color: activeTab === 'torrents' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'logs' ? '#2196F3' : '#eee',
              color: activeTab === 'logs' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Logs
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'settings' ? '#2196F3' : '#eee',
              color: activeTab === 'settings' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddTorrent()
                  }
                }}
                placeholder="Enter magnet link or URL"
                style={{ flex: 1, padding: '8px' }}
              />
              <button onClick={handleAddTorrent} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                Add
              </button>
            </div>

            {loading && <p>Loading...</p>}
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}

            {engine && (
              <>
                <div style={{ marginBottom: '16px', color: '#666' }}>
                  {torrents.length} torrents | {engine.currentConnections} connections |{' '}
                  {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
                  {formatBytes(globalStats.totalUploadRate)}/s
                </div>

                {torrents.length === 0 ? (
                  <p>No torrents. Add a magnet link to get started.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {torrents.map((torrent) => (
                      <li
                        key={torrent.infoHash}
                        style={{
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          padding: '12px',
                          marginBottom: '8px',
                        }}
                      >
                        <div style={{ fontWeight: 'bold' }}>{torrent.name}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {torrent.state} | {(torrent.progress * 100).toFixed(1)}% |{' '}
                          {torrent.connectedPeers.length} peers | {torrent.files.length} files |{' '}
                          {formatBytes(torrent.totalSize)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {formatBytes(torrent.downloadRate)}/s | {formatBytes(torrent.uploadRate)}
                          /s
                        </div>
                        <div
                          style={{
                            height: '4px',
                            background: '#eee',
                            borderRadius: '2px',
                            marginTop: '8px',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${torrent.progress * 100}%`,
                              background: torrent.state === 'seeding' ? '#4CAF50' : '#2196F3',
                              borderRadius: '2px',
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'logs' && <LogViewer />}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
    </div>
  )
}

export const App = () => {
  return (
    <EngineProvider>
      <AppContent />
    </EngineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

### Phase 7: Update LogViewer Component

**File: `extension/src/ui/components/LogViewer.tsx` (MODIFY)**

Update to use `engineManager.logBuffer` directly:

```typescript
import { useState, useEffect } from 'react'
import { engineManager } from '../lib/engine-manager'
import type { LogEntry } from '@jstorrent/engine'

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    // Get initial logs
    setLogs(engineManager.logBuffer.getRecent(100, filter || undefined))

    // Subscribe to new logs
    const unsubscribe = engineManager.logBuffer.subscribe((entry) => {
      if (!filter || entry.message.includes(filter) || entry.context?.includes(filter)) {
        setLogs((prev) => [...prev.slice(-99), entry])
      }
    })

    return unsubscribe
  }, [filter])

  // ... rest of component
}
```

### Phase 8: Update DownloadRootsManager Component

**File: `extension/src/ui/components/DownloadRootsManager.tsx` (MODIFY)**

Update to use `engineManager` directly:

```typescript
import { useState, useEffect } from 'react'
import { engineManager } from '../lib/engine-manager'

export function DownloadRootsManager() {
  const [roots, setRoots] = useState<Array<{ token: string; label: string; path: string }>>([])
  const [defaultToken, setDefaultToken] = useState<string | null>(null)

  useEffect(() => {
    setRoots(engineManager.getRoots())
    engineManager.getDefaultRootToken().then(setDefaultToken)
  }, [])

  const handlePickFolder = async () => {
    const root = await engineManager.pickDownloadFolder()
    if (root) {
      setRoots(engineManager.getRoots())
    }
  }

  const handleSetDefault = async (token: string) => {
    await engineManager.setDefaultRoot(token)
    setDefaultToken(token)
  }

  // ... rest of component
}
```

## Files to Delete

| File | Reason |
|------|--------|
| `extension/src/lib/client.ts` | Replaced by `DaemonLifecycleManager` (SW) + `EngineManager` (UI) |
| `extension/src/lib/sockets.ts` | If only used by Client |

## Files Summary

| File | Action |
|------|--------|
| `extension/src/sw.ts` | SIMPLIFY - Remove engine logic, keep daemon lifecycle |
| `extension/src/lib/client.ts` | DELETE |
| `extension/src/lib/daemon-lifecycle-manager.ts` | CREATE |
| `extension/src/lib/native-connection.ts` | KEEP (no changes) |
| `extension/src/ui/lib/engine-manager.ts` | CREATE |
| `extension/src/ui/context/EngineContext.tsx` | CREATE |
| `extension/src/ui/hooks/useEngineState.ts` | REPLACE (direct access) |
| `extension/src/ui/app.tsx` | MODIFY (use context, direct access) |
| `extension/src/ui/components/LogViewer.tsx` | MODIFY (use engineManager) |
| `extension/src/ui/components/DownloadRootsManager.tsx` | MODIFY (use engineManager) |

## Engine API Requirements

The implementation assumes the following `BtEngine` APIs exist. Verify these are available:

```typescript
interface BtEngine {
  // Properties
  torrents: Torrent[]
  currentConnections: number
  socketFactory: ISocketFactory
  storageRootManager: StorageRootManager

  // Methods
  addTorrent(magnetOrUrl: string): Promise<Torrent>
  getTorrent(infoHash: string): Torrent | undefined
  restoreSession(): Promise<number>
  resume(): void
  suspend(): void
  destroy(): void
  getTotalDownloadRate(): number
  getTotalUploadRate(): number

  // Events
  on(event: 'torrentAdded', handler: (torrent: Torrent) => void): void
  on(event: 'torrentRemoved', handler: (torrent: Torrent) => void): void
  on(event: 'torrentStateChanged', handler: (torrent: Torrent) => void): void
  on(event: 'pieceCompleted', handler: (torrent: Torrent) => void): void
  on(event: 'peerConnected', handler: (torrent: Torrent) => void): void
  on(event: 'peerDisconnected', handler: (torrent: Torrent) => void): void
  on(event: 'torrentCompleted', handler: (torrent: Torrent) => void): void
  off(event: string, handler: Function): void
}

interface Torrent {
  infoHash: string
  name: string
  state: string
  progress: number
  connectedPeers: Peer[]
  files: File[]
  totalSize: number
  downloadRate: number
  uploadRate: number
  userStart(): void
  userStop(): void
}
```

## Testing Checklist

### Unit Tests

- [ ] `DaemonLifecycleManager` opens native connection on first `getDaemonInfo()`
- [ ] `DaemonLifecycleManager` reuses cached daemon info on subsequent calls
- [ ] `DaemonLifecycleManager` decrements UI count on `onUIClosing()`
- [ ] `DaemonLifecycleManager` starts grace period when count reaches 0
- [ ] `DaemonLifecycleManager` closes native connection after grace period
- [ ] `DaemonLifecycleManager` cancels grace period if new UI connects
- [ ] `EngineManager` creates engine on first `init()`
- [ ] `EngineManager` returns cached engine on subsequent `init()`
- [ ] `EngineManager` sends `UI_CLOSING` on `shutdown()`

### Integration Tests

- [ ] UI tab opens → engine initializes → torrents display
- [ ] Add magnet link → torrent appears in list
- [ ] Close tab → SW receives `UI_CLOSING` → grace period starts
- [ ] Reopen tab within grace period → same daemon reused
- [ ] Close tab → wait for grace period → daemon terminates
- [ ] Multiple rapid tab opens/closes → no crashes
- [ ] `launch-ping` from website → UI tab opens

### Manual Tests

- [ ] Extension icon click opens UI tab
- [ ] Clicking icon when tab exists focuses existing tab
- [ ] Adding torrent shows real-time progress
- [ ] Peer count updates without page refresh
- [ ] Download/upload rates update smoothly
- [ ] Closing tab and reopening restores torrents from session
- [ ] Folder picker opens native dialog
- [ ] Selected folder appears in roots list

## Rollback Plan

If issues are discovered:

1. Revert to previous `sw.ts` and `client.ts`
2. Revert `useEngineState.ts` to polling version
3. Remove new files: `daemon-lifecycle-manager.ts`, `engine-manager.ts`, `EngineContext.tsx`

## Future Enhancements

### Background Downloading (Not in scope)

When background downloading is needed:

1. Add setting: `enableBackgroundDownloading: boolean`
2. If enabled and active torrents exist when UI closes:
   - SW creates its own engine instance
   - Or SW spawns offscreen document with engine
3. When UI reopens:
   - Transfer engine state from background to UI
   - Or sync torrent list between engines

### Peer List Persistence (Not in scope)

To persist peer lists across sessions:

1. On `beforeunload`, save connected peer addresses to session store
2. On session restore, attempt to reconnect to saved peers
3. Consider TTL for saved peers (e.g., 24 hours)

## Questions for Implementer

1. Does `BtEngine` have the event system (`on`/`off`) as described? If not, what's the current mechanism for state change notifications?

2. Does `DaemonConnection` have a `close()` method for clean shutdown?

3. Are there any other message types currently handled by `sw.ts` that need to be preserved?

4. Does `RingBufferLogger` have a `subscribe()` method that returns an unsubscribe function?
