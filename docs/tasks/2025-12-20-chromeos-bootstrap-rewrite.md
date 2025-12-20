# ChromeOS Bootstrap Rewrite

## Overview

Replace the tangled ChromeOS connection logic in `daemon-bridge.ts` with a clean, simple polling loop in a dedicated module. The current code has recursive timeouts, 30s lockouts, and failure modes that are hard to reason about.

**Goals:**
- Simple state machine with clear phases
- Background polling that runs continuously
- User can click "Launch" anytime (no lockouts)
- State is always accurate and up-to-date

**Depends on:** `/status` endpoint returning `tokenValid` (see `status-token-validation.md`)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  chromeos-bootstrap.ts                                          │
│                                                                 │
│  Exports:                                                       │
│    - ChromeOSBootstrap class                                    │
│    - start() / stop()                                           │
│    - openIntent() / resetPairing()                              │
│    - subscribe(listener)                                        │
│    - getState()                                                 │
│                                                                 │
│  Responsibilities:                                              │
│    - Poll /health to detect daemon                              │
│    - Check /status for pairing state                            │
│    - POST /pair when needed                                     │
│    - Connect WebSocket and authenticate                         │
│    - Report state to subscribers                                │
│                                                                 │
│  Does NOT handle:                                               │
│    - Download roots (after connected, use existing code)        │
│    - File operations                                            │
│    - Control messages                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ once connected
┌─────────────────────────────────────────────────────────────────┐
│  daemon-bridge.ts (existing)                                    │
│                                                                 │
│  ChromeOS path now:                                             │
│    - Receives port + token from ChromeOSBootstrap               │
│    - Manages WebSocket lifecycle                                │
│    - Handles ROOTS_CHANGED, events                              │
│    - Provides pickDownloadFolder, etc.                          │
└─────────────────────────────────────────────────────────────────┘
```

## Phase 1: Create chromeos-bootstrap.ts

Create `extension/src/lib/chromeos-bootstrap.ts`:

```typescript
/**
 * ChromeOS Bootstrap
 * 
 * Simple polling loop to get from "nothing" to "connected WebSocket".
 * Replaces the complex recursive timeout logic in daemon-bridge.ts.
 */

// ============================================================================
// Types
// ============================================================================

export type BootstrapPhase = 
  | 'idle'        // Not started
  | 'probing'     // Looking for daemon (/health)
  | 'pairing'     // Daemon found, need pairing approval
  | 'connecting'  // Paired, establishing WebSocket
  | 'connected'   // Done - WebSocket authenticated

export type BootstrapProblem =
  | null                  // No problem
  | 'not_reachable'       // Can't reach /health
  | 'not_paired'          // /status says not paired
  | 'token_invalid'       // /status says token doesn't match
  | 'pair_rejected'       // User rejected pairing dialog
  | 'pair_conflict'       // Another dialog showing
  | 'auth_failed'         // WebSocket AUTH failed
  | 'connection_lost'     // Was connected, lost connection

export interface BootstrapState {
  phase: BootstrapPhase
  port: number | null
  problem: BootstrapProblem
  /** User-friendly message for current state */
  message: string
}

export interface BootstrapResult {
  port: number
  token: string
  ws: WebSocket
}

type StateListener = (state: BootstrapState) => void

// ============================================================================
// Constants
// ============================================================================

const CHROMEOS_HOST = '100.115.92.2'
const PROBE_PORTS = [7800, 7805, 7814, 7827, 7844]
const POLL_INTERVAL_MS = 2000
const PROBE_TIMEOUT_MS = 2000
const WS_TIMEOUT_MS = 10000

const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'

// ============================================================================
// ChromeOSBootstrap Class
// ============================================================================

export class ChromeOSBootstrap {
  private state: BootstrapState = {
    phase: 'idle',
    port: null,
    problem: null,
    message: 'Not started',
  }
  
  private listeners = new Set<StateListener>()
  private running = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private ws: WebSocket | null = null

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  getState(): BootstrapState {
    return this.state
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Start the bootstrap loop. Polls continuously until connected.
   * Returns a promise that resolves when connected (or rejects on stop).
   */
  start(): Promise<BootstrapResult> {
    if (this.running) {
      return Promise.reject(new Error('Already running'))
    }

    this.running = true
    this.updateState({ phase: 'probing', problem: null, message: 'Looking for Android app...' })

    return new Promise((resolve, reject) => {
      this.runLoop(resolve, reject)
    })
  }

  /**
   * Stop the bootstrap loop.
   */
  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.updateState({ phase: 'idle', problem: null, message: 'Stopped' })
  }

  /**
   * Open the Android app via intent. Can be called anytime.
   * Does not block or change state - just opens the intent.
   */
  async openIntent(): Promise<void> {
    const intentUrl = 'intent://launch#Intent;scheme=jstorrent;package=com.jstorrent.app;' +
      'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.jstorrent.app;end'

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }
    } catch (e) {
      console.error('[ChromeOSBootstrap] Failed to open intent:', e)
    }
  }

  /**
   * Clear stored token and restart pairing flow.
   */
  async resetPairing(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
    console.log('[ChromeOSBootstrap] Pairing reset')
    
    // If running, the next poll iteration will detect we need to pair
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main Loop
  // ─────────────────────────────────────────────────────────────────────────

  private async runLoop(
    resolve: (result: BootstrapResult) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    while (this.running) {
      try {
        const result = await this.tryConnect()
        if (result) {
          this.updateState({ 
            phase: 'connected', 
            port: result.port, 
            problem: null, 
            message: 'Connected' 
          })
          resolve(result)
          return
        }
      } catch (e) {
        console.error('[ChromeOSBootstrap] Loop error:', e)
      }

      // Wait before next attempt
      await this.sleep(POLL_INTERVAL_MS)
    }

    reject(new Error('Stopped'))
  }

  /**
   * Single attempt to connect. Returns result if successful, null to retry.
   */
  private async tryConnect(): Promise<BootstrapResult | null> {
    // Step 1: Find daemon
    const port = await this.findDaemonPort()
    if (!port) {
      this.updateState({
        phase: 'probing',
        port: null,
        problem: 'not_reachable',
        message: 'Android app not running',
      })
      return null
    }

    // Step 2: Check pairing status
    const token = await this.getOrCreateToken()
    const status = await this.fetchStatus(port, token)

    if (!status.paired) {
      // Need to initiate pairing
      this.updateState({
        phase: 'pairing',
        port,
        problem: 'not_paired',
        message: 'Approve pairing in Android app',
      })
      
      const pairResult = await this.requestPairing(port, token)
      if (pairResult === 'conflict') {
        this.updateState({
          phase: 'pairing',
          port,
          problem: 'pair_conflict',
          message: 'Dismiss existing pairing dialog',
        })
      }
      // Either way, next iteration will check status again
      return null
    }

    // Paired, but is our token valid?
    if (status.tokenValid === false) {
      this.updateState({
        phase: 'pairing',
        port,
        problem: 'token_invalid',
        message: 'Token expired, re-pairing...',
      })
      // Clear token and re-pair
      await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
      return null
    }

    // Step 3: Connect WebSocket
    this.updateState({
      phase: 'connecting',
      port,
      problem: null,
      message: 'Connecting...',
    })

    try {
      const ws = await this.connectWebSocket(port, token)
      return { port, token, ws }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'WebSocket failed'
      
      if (msg.includes('Auth failed')) {
        // Token mismatch - clear and re-pair
        await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
        this.updateState({
          phase: 'pairing',
          port,
          problem: 'auth_failed',
          message: 'Authentication failed, re-pairing...',
        })
      } else {
        this.updateState({
          phase: 'probing',
          port,
          problem: 'not_reachable',
          message: 'Connection failed',
        })
      }
      return null
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Network Operations
  // ─────────────────────────────────────────────────────────────────────────

  private async findDaemonPort(): Promise<number | null> {
    // Check cached port first
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    const ports = [stored[STORAGE_KEY_PORT], ...PROBE_PORTS].filter(Boolean) as number[]
    const seen = new Set<number>()

    for (const port of ports) {
      if (seen.has(port)) continue
      seen.add(port)

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

        const response = await fetch(`http://${CHROMEOS_HOST}:${port}/health`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)

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

  private async fetchStatus(port: number, token: string): Promise<{
    paired: boolean
    extensionId: string | null
    installId: string | null
    tokenValid: boolean | null
  }> {
    const installId = await this.getInstallId()
    
    const response = await fetch(`http://${CHROMEOS_HOST}:${port}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JST-ExtensionId': chrome.runtime.id,
        'X-JST-InstallId': installId,
      },
      body: JSON.stringify({ token }),
    })

    if (!response.ok) {
      throw new Error(`Status failed: ${response.status}`)
    }

    return response.json()
  }

  private async requestPairing(port: number, token: string): Promise<'approved' | 'pending' | 'conflict'> {
    const installId = await this.getInstallId()

    try {
      const response = await fetch(`http://${CHROMEOS_HOST}:${port}/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-JST-ExtensionId': chrome.runtime.id,
          'X-JST-InstallId': installId,
        },
        body: JSON.stringify({ token }),
      })

      if (response.ok) {
        const data = await response.json() as { status: string }
        return data.status as 'approved' | 'pending'
      } else if (response.status === 409) {
        return 'conflict'
      }
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  private async connectWebSocket(port: number, token: string): Promise<WebSocket> {
    const installId = await this.getInstallId()

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${CHROMEOS_HOST}:${port}/control`)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket timeout'))
      }, WS_TIMEOUT_MS)

      ws.onopen = () => {
        // Send CLIENT_HELLO
        ws.send(this.buildFrame(0x01, 0, new Uint8Array(0)))
      }

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === 0x02) {
          // SERVER_HELLO - send AUTH
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(token)
          const extIdBytes = encoder.encode(chrome.runtime.id)
          const installIdBytes = encoder.encode(installId)

          const payload = new Uint8Array(
            1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length
          )
          payload[0] = 0 // authType
          let offset = 1
          payload.set(tokenBytes, offset); offset += tokenBytes.length
          payload[offset++] = 0
          payload.set(extIdBytes, offset); offset += extIdBytes.length
          payload[offset++] = 0
          payload.set(installIdBytes, offset)

          ws.send(this.buildFrame(0x03, 0, payload))
        } else if (opcode === 0x04) {
          // AUTH_RESULT
          clearTimeout(timeout)
          const status = data[8]
          if (status === 0) {
            this.ws = ws
            resolve(ws)
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
        // Only reject if we haven't resolved yet
      }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }
    const token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token })
    return token
  }

  private async getInstallId(): Promise<string> {
    const stored = await chrome.storage.local.get(['installId'])
    if (stored.installId) {
      return stored.installId as string
    }
    const id = crypto.randomUUID()
    await chrome.storage.local.set({ installId: id })
    return id
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true)
    frame.set(payload, 8)
    return frame.buffer
  }

  private updateState(partial: Partial<BootstrapState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) {
      try {
        listener(this.state)
      } catch (e) {
        console.error('[ChromeOSBootstrap] Listener error:', e)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollTimer = setTimeout(resolve, ms)
    })
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ChromeOSBootstrap | null = null

export function getChromeOSBootstrap(): ChromeOSBootstrap {
  if (!instance) {
    instance = new ChromeOSBootstrap()
  }
  return instance
}
```

## Phase 2: Create SystemBridgePanelChromeos.tsx

Create `packages/client/src/components/SystemBridgePanelChromeos.tsx`:

```typescript
import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import type { BootstrapState, BootstrapProblem } from '../../../../extension/src/lib/chromeos-bootstrap'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jstorrent.app'

export interface SystemBridgePanelChromeosProps {
  state: BootstrapState
  daemonVersion?: string
  roots: Array<{ key: string; display_name: string }>
  defaultRootKey: string | null
  hasEverConnected: boolean
  onClose: () => void
  onLaunch: () => void
  onResetPairing: () => void
  onAddFolder: () => void
  onOpenSettings?: () => void
  anchorRef?: RefObject<HTMLElement | null>
}

interface StateDisplay {
  title: string
  message: string
  showLaunchButton: boolean
  showResetButton: boolean
  showPlayStoreLink: boolean
}

function getStateDisplay(
  phase: BootstrapState['phase'],
  problem: BootstrapProblem,
  hasEverConnected: boolean
): StateDisplay {
  if (phase === 'connected') {
    return {
      title: 'Connected',
      message: '',
      showLaunchButton: false,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  if (phase === 'connecting') {
    return {
      title: 'Connecting...',
      message: 'Establishing connection',
      showLaunchButton: false,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  if (phase === 'pairing') {
    if (problem === 'pair_conflict') {
      return {
        title: 'Pairing Blocked',
        message: 'Another pairing dialog is open. Dismiss it in the Android app and try again.',
        showLaunchButton: true,
        showResetButton: true,
        showPlayStoreLink: false,
      }
    }
    if (problem === 'token_invalid' || problem === 'auth_failed') {
      return {
        title: 'Re-pairing Required',
        message: 'The connection token expired. Approve the new pairing request in the Android app.',
        showLaunchButton: true,
        showResetButton: true,
        showPlayStoreLink: false,
      }
    }
    return {
      title: 'Pairing Required',
      message: 'Approve the pairing request in the Android app.',
      showLaunchButton: true,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  // probing or idle with not_reachable
  if (!hasEverConnected) {
    return {
      title: 'Setup Required',
      message: 'Install the JSTorrent companion app from the Play Store, then tap Launch.',
      showLaunchButton: true,
      showResetButton: false,
      showPlayStoreLink: true,
    }
  }

  return {
    title: 'Android App Not Running',
    message: 'Tap Launch to start the companion app.',
    showLaunchButton: true,
    showResetButton: false,
    showPlayStoreLink: false,
  }
}

export function SystemBridgePanelChromeos({
  state,
  daemonVersion,
  roots,
  defaultRootKey,
  hasEverConnected,
  onClose,
  onLaunch,
  onResetPairing,
  onAddFolder,
  onOpenSettings,
  anchorRef,
}: SystemBridgePanelChromeosProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const display = getStateDisplay(state.phase, state.problem, hasEverConnected)

  // Click-outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (anchorRef?.current && anchorRef.current.contains(target)) {
          return
        }
        onClose()
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, anchorRef])

  // Escape to close
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isConnected = state.phase === 'connected'

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '4px',
        width: '320px',
        background: 'var(--bg-primary, white)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '14px' }}>System Bridge</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '4px',
            color: 'var(--text-secondary)',
          }}
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {isConnected ? (
          <ConnectedContent
            port={state.port!}
            daemonVersion={daemonVersion}
            roots={roots}
            defaultRootKey={defaultRootKey}
            onAddFolder={onAddFolder}
            onOpenSettings={onOpenSettings}
            onClose={onClose}
          />
        ) : (
          <DisconnectedContent
            display={display}
            stateMessage={state.message}
            onLaunch={onLaunch}
            onResetPairing={onResetPairing}
          />
        )}
      </div>
    </div>
  )
}

function DisconnectedContent({
  display,
  stateMessage,
  onLaunch,
  onResetPairing,
}: {
  display: StateDisplay
  stateMessage: string
  onLaunch: () => void
  onResetPairing: () => void
}) {
  return (
    <div>
      <div style={{ marginBottom: '8px', fontWeight: 500 }}>{display.title}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        {display.message}
      </div>

      {/* Debug: show actual state message */}
      {stateMessage && stateMessage !== display.message && (
        <div style={{ 
          color: 'var(--text-tertiary)', 
          fontSize: '11px', 
          marginBottom: '12px',
          fontFamily: 'monospace',
        }}>
          {stateMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {display.showLaunchButton && (
          <button
            onClick={onLaunch}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            Launch App
          </button>
        )}

        {display.showPlayStoreLink && (
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              textDecoration: 'none',
              color: 'var(--text-secondary)',
            }}
          >
            Get from Play Store
          </a>
        )}

        {display.showResetButton && (
          <button
            onClick={onResetPairing}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
            }}
          >
            Reset Pairing
          </button>
        )}
      </div>
    </div>
  )
}

function ConnectedContent({
  port,
  daemonVersion,
  roots,
  defaultRootKey,
  onAddFolder,
  onOpenSettings,
  onClose,
}: {
  port: number
  daemonVersion?: string
  roots: Array<{ key: string; display_name: string }>
  defaultRootKey: string | null
  onAddFolder: () => void
  onOpenSettings?: () => void
  onClose: () => void
}) {
  return (
    <>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Android App</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <div>&#x25CF; Connected {daemonVersion && `— v${daemonVersion}`}</div>
          <div style={{ marginTop: '4px' }}>100.115.92.2:{port}</div>
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 500, marginBottom: '4px' }}>Download Location</div>
        {roots.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            No download folder configured.
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {roots.find((r) => r.key === defaultRootKey)?.display_name ?? 'None selected'}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
          <button onClick={onAddFolder} style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}>
            Add Folder...
          </button>
          {onOpenSettings && (
            <button
              onClick={() => { onOpenSettings(); onClose() }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '13px',
                cursor: 'pointer',
                padding: '6px 0',
              }}
            >
              Manage in Settings
            </button>
          )}
        </div>
      </div>
    </>
  )
}
```

## Phase 3: Wire Up in Service Worker

Update `extension/src/sw.ts` to use ChromeOSBootstrap on ChromeOS:

### 3.1 Add imports at top

```typescript
import { detectPlatform } from './lib/platform'
import { getChromeOSBootstrap, type BootstrapState } from './lib/chromeos-bootstrap'
```

### 3.2 Add bootstrap handling after bridge initialization

```typescript
// ============================================================================
// ChromeOS Bootstrap (if on ChromeOS)
// ============================================================================

const platform = detectPlatform()
let chromeosBootstrap: ReturnType<typeof getChromeOSBootstrap> | null = null

if (platform === 'chromeos') {
  chromeosBootstrap = getChromeOSBootstrap()
  
  // Forward state to UI
  chromeosBootstrap.subscribe((state: BootstrapState) => {
    if (primaryUIPort) {
      primaryUIPort.postMessage({
        type: 'CHROMEOS_BOOTSTRAP_STATE',
        state,
      })
    }
  })
  
  // Start bootstrap when UI connects
  // (handled in handleUIPortConnect)
}
```

### 3.3 Update handleUIPortConnect

Add ChromeOS bootstrap start:

```typescript
function handleUIPortConnect(port: chrome.runtime.Port): void {
  // ... existing code ...

  // Start ChromeOS bootstrap if on ChromeOS
  if (platform === 'chromeos' && chromeosBootstrap) {
    const state = chromeosBootstrap.getState()
    if (state.phase === 'idle') {
      chromeosBootstrap.start().then((result) => {
        console.log('[SW] ChromeOS bootstrap connected, port:', result.port)
        // Now the existing daemon-bridge can take over for roots/events
      }).catch((e) => {
        console.log('[SW] ChromeOS bootstrap stopped:', e)
      })
    }
    // Send current state to new UI
    port.postMessage({
      type: 'CHROMEOS_BOOTSTRAP_STATE',
      state,
    })
  }
}
```

### 3.4 Add message handlers

```typescript
// ChromeOS bootstrap actions
if (message.type === 'CHROMEOS_OPEN_INTENT') {
  chromeosBootstrap?.openIntent()
  sendResponse({ ok: true })
  return true
}

if (message.type === 'CHROMEOS_RESET_PAIRING') {
  chromeosBootstrap?.resetPairing().then(() => {
    sendResponse({ ok: true })
  })
  return true
}

if (message.type === 'GET_CHROMEOS_BOOTSTRAP_STATE') {
  const state = chromeosBootstrap?.getState() ?? null
  sendResponse({ ok: true, state })
  return true
}
```

## Phase 4: Create Hook for ChromeOS Bootstrap State

Create `packages/client/src/hooks/useChromeOSBootstrap.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { getBridge } from '../chrome/extension-bridge'
import type { BootstrapState } from '../../../../extension/src/lib/chromeos-bootstrap'

const INITIAL_STATE: BootstrapState = {
  phase: 'idle',
  port: null,
  problem: null,
  message: 'Starting...',
}

export function useChromeOSBootstrap() {
  const [state, setState] = useState<BootstrapState>(INITIAL_STATE)
  const [hasEverConnected, setHasEverConnected] = useState(false)

  useEffect(() => {
    const bridge = getBridge()
    
    // Get initial state
    bridge.sendMessage<{ ok: boolean; state?: BootstrapState }>({
      type: 'GET_CHROMEOS_BOOTSTRAP_STATE',
    }).then((response) => {
      if (response.ok && response.state) {
        setState(response.state)
        if (response.state.phase === 'connected') {
          setHasEverConnected(true)
        }
      }
    })

    // Listen for updates
    let port: chrome.runtime.Port | null = null
    try {
      if (bridge.isDevMode && bridge.extensionId) {
        port = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
      } else {
        port = chrome.runtime.connect({ name: 'ui' })
      }

      port.onMessage.addListener((msg: { type?: string; state?: BootstrapState }) => {
        if (msg.type === 'CHROMEOS_BOOTSTRAP_STATE' && msg.state) {
          setState(msg.state)
          if (msg.state.phase === 'connected') {
            setHasEverConnected(true)
          }
        }
      })
    } catch (e) {
      console.error('[useChromeOSBootstrap] Failed to connect:', e)
    }

    return () => {
      port?.disconnect()
    }
  }, [])

  const openIntent = useCallback(() => {
    getBridge().postMessage({ type: 'CHROMEOS_OPEN_INTENT' })
  }, [])

  const resetPairing = useCallback(() => {
    getBridge().postMessage({ type: 'CHROMEOS_RESET_PAIRING' })
  }, [])

  return {
    state,
    hasEverConnected,
    openIntent,
    resetPairing,
  }
}
```

## Phase 5: Update App.tsx to Use Platform-Specific Panel

In `packages/client/src/App.tsx`, update the SystemBridgePanel usage:

### 5.1 Add imports

```typescript
import { SystemBridgePanelChromeos } from './components/SystemBridgePanelChromeos'
import { useChromeOSBootstrap } from './hooks/useChromeOSBootstrap'
```

### 5.2 Add hook call (near other hooks)

```typescript
const chromeosBootstrap = useChromeOSBootstrap()
```

### 5.3 Update panel rendering

Replace the `<SystemBridgePanel ... />` with:

```typescript
{showBridgePanel && (
  ioBridgeState.platform === 'chromeos' ? (
    <SystemBridgePanelChromeos
      state={chromeosBootstrap.state}
      daemonVersion={daemonVersion}
      roots={roots}
      defaultRootKey={defaultRootKey}
      hasEverConnected={chromeosBootstrap.hasEverConnected}
      onClose={() => setShowBridgePanel(false)}
      onLaunch={chromeosBootstrap.openIntent}
      onResetPairing={chromeosBootstrap.resetPairing}
      onAddFolder={handleAddFolder}
      onOpenSettings={() => setShowSettings(true)}
      anchorRef={indicatorRef}
    />
  ) : (
    <SystemBridgePanel
      state={ioBridgeState}
      versionStatus={versionStatus}
      daemonVersion={daemonVersion}
      roots={roots}
      defaultRootKey={defaultRootKey}
      hasEverConnected={hasEverConnected}
      onClose={() => setShowBridgePanel(false)}
      onRetry={retryConnection}
      onLaunch={launch}
      onCancel={() => {}}
      onAddFolder={handleAddFolder}
      onOpenSettings={() => setShowSettings(true)}
      anchorRef={indicatorRef}
    />
  )
)}
```

## Verification

### Build

```bash
pnpm typecheck
pnpm test
pnpm build
```

### Test on Chromebook

1. **Not installed flow:**
   - Fresh Chromebook, no Android app
   - Extension shows "Setup Required" + Play Store link
   - Click Launch → opens Play Store (via fallback URL)

2. **Not running flow:**
   - App installed but not running
   - Extension shows "Android App Not Running"
   - Click Launch → app opens
   - Polling detects app → shows pairing prompt

3. **Pairing flow:**
   - Extension shows "Pairing Required"
   - Approve in Android app
   - Extension connects within 2s

4. **Token expired flow:**
   - Pair successfully, then clear token on Android side
   - Extension shows "Re-pairing Required"
   - Approve again → connects

5. **Quick retry:**
   - Cancel intent immediately
   - Click Launch again → works immediately (no 30s wait)

## Summary

| File | Change |
|------|--------|
| `extension/src/lib/chromeos-bootstrap.ts` | New file - clean polling loop |
| `extension/src/sw.ts` | Use ChromeOSBootstrap on ChromeOS |
| `packages/client/src/components/SystemBridgePanelChromeos.tsx` | New file - ChromeOS UI |
| `packages/client/src/hooks/useChromeOSBootstrap.ts` | New file - React hook |
| `packages/client/src/App.tsx` | Platform switch for panel |

The existing `daemon-bridge.ts` is not modified. ChromeOS uses the new bootstrap module; desktop continues using the existing code path.
