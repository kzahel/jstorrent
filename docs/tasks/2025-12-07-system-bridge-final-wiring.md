# System Bridge Final Wiring

## Overview

This task connects the existing System Bridge UI components to real IOBridge state from the service worker, and makes the app work without an active daemon connection.

**Prerequisites completed:**
- ✅ IOBridgeService in SW with `getState()`, `subscribe()`, action methods
- ✅ SW forwards `IOBRIDGE_STATE_CHANGED` to UI port
- ✅ SW has `GET_IOBRIDGE_STATE` message handler
- ✅ SystemIndicator and SystemBridgePanel components
- ✅ useSystemBridge hook (expects state as prop)
- ✅ readiness.ts and version-status.ts utilities

**What this task does:**
1. Add IOBridge state subscription to App.tsx
2. Make App.tsx render UI even when daemon not connected
3. Wire SystemIndicator + SystemBridgePanel into the header
4. Connect action callbacks to SW messages
5. Add action message handlers to SW

---

## Phase 1: Add IOBridge Action Messages to SW

The SW needs handlers for user actions triggered from the panel.

### 1.1 Add Message Handlers in sw.ts

Find the `handleMessage` function and add these handlers after `GET_IOBRIDGE_STATE`:

```typescript
// Trigger user launch (ChromeOS)
if (message.type === 'IOBRIDGE_LAUNCH') {
  ioBridge.triggerUserLaunch()
  sendResponse({ ok: true })
  return true
}

// Cancel launch (ChromeOS)
if (message.type === 'IOBRIDGE_CANCEL') {
  ioBridge.cancelUserLaunch()
  sendResponse({ ok: true })
  return true
}

// Retry connection
if (message.type === 'IOBRIDGE_RETRY') {
  ioBridge.triggerRetry()
  sendResponse({ ok: true })
  return true
}
```

---

## Phase 2: Create useIOBridgeState Hook

This hook subscribes to IOBridge state changes from the service worker.

### 2.1 Create packages/client/src/hooks/useIOBridgeState.ts

```typescript
import { useState, useEffect, useCallback } from 'react'
import { getBridge } from '../chrome/extension-bridge'

/**
 * IOBridge state names (mirrored from extension/src/lib/io-bridge/types.ts)
 */
export type IOBridgeStateName =
  | 'INITIALIZING'
  | 'PROBING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'INSTALL_PROMPT'
  | 'LAUNCH_PROMPT'
  | 'AWAITING_LAUNCH'
  | 'LAUNCH_FAILED'

/**
 * Minimal IOBridge state for UI consumption.
 * Full state type is in extension; we only need what the UI uses.
 */
export interface IOBridgeState {
  name: IOBridgeStateName
  platform?: 'desktop' | 'chromeos'
  daemonInfo?: {
    port: number
    token: string
    version?: number
    roots: Array<{
      key: string
      path: string
      display_name: string
      removable: boolean
      last_stat_ok: boolean
      last_checked: number
    }>
    host?: string
  }
  history?: {
    attempts: number
    lastAttempt: number | null
    lastError: string | null
  }
}

const INITIAL_STATE: IOBridgeState = { name: 'INITIALIZING' }

/**
 * Hook to subscribe to IOBridge state from service worker.
 *
 * Returns current state and action callbacks.
 */
export function useIOBridgeState() {
  const [state, setState] = useState<IOBridgeState>(INITIAL_STATE)
  const [port, setPort] = useState<chrome.runtime.Port | null>(null)

  // Connect to SW and subscribe to state changes
  useEffect(() => {
    const bridge = getBridge()
    let swPort: chrome.runtime.Port | null = null

    // Fetch initial state
    bridge
      .sendMessage<{ ok: boolean; state?: IOBridgeState }>({ type: 'GET_IOBRIDGE_STATE' })
      .then((response) => {
        if (response.ok && response.state) {
          setState(response.state)
        }
      })
      .catch((e) => {
        console.error('[useIOBridgeState] Failed to get initial state:', e)
      })

    // Connect port for real-time updates
    try {
      if (bridge.isDevMode && bridge.extensionId) {
        swPort = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
      } else {
        swPort = chrome.runtime.connect({ name: 'ui' })
      }

      swPort.onMessage.addListener((msg: { type?: string; state?: IOBridgeState }) => {
        if (msg.type === 'IOBRIDGE_STATE_CHANGED' && msg.state) {
          setState(msg.state)
        }
      })

      swPort.onDisconnect.addListener(() => {
        console.log('[useIOBridgeState] Port disconnected')
        setPort(null)
      })

      setPort(swPort)
    } catch (e) {
      console.error('[useIOBridgeState] Failed to connect port:', e)
    }

    return () => {
      swPort?.disconnect()
    }
  }, [])

  // Action callbacks
  const retry = useCallback(() => {
    getBridge().postMessage({ type: 'IOBRIDGE_RETRY' })
  }, [])

  const launch = useCallback(() => {
    getBridge().postMessage({ type: 'IOBRIDGE_LAUNCH' })
  }, [])

  const cancel = useCallback(() => {
    getBridge().postMessage({ type: 'IOBRIDGE_CANCEL' })
  }, [])

  return {
    state,
    isConnected: state.name === 'CONNECTED',
    retry,
    launch,
    cancel,
  }
}
```

---

## Phase 3: Update App.tsx

The app needs to:
1. Always render (not block on daemon)
2. Show SystemIndicator in header
3. Show SystemBridgePanel when indicator clicked
4. Initialize engine only when connected

### 3.1 Add Imports

At the top of App.tsx, add:

```typescript
import { useIOBridgeState } from './hooks/useIOBridgeState'
import { useSystemBridge } from './hooks/useSystemBridge'
import { SystemIndicator } from './components/SystemIndicator'
import { SystemBridgePanel } from './components/SystemBridgePanel'
```

### 3.2 Replace the App Component

Replace the entire `App` function (lines 464-494) with:

```typescript
function App() {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof engineManager.init>> | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)

  // Subscribe to IOBridge state
  const { state: ioBridgeState, isConnected, retry, launch, cancel } = useIOBridgeState()

  // Get roots and default root from connected state
  const roots = ioBridgeState.name === 'CONNECTED' ? ioBridgeState.daemonInfo?.roots ?? [] : []
  const [defaultRootKey, setDefaultRootKey] = useState<string | null>(null)

  // Check if there are pending torrents (torrents added but not downloading)
  // For now, false until engine is initialized
  const hasPendingTorrents = engine ? engine.torrents.some((t) => t.userState === 'active' && !t.hasMetadata) : false

  // System bridge hook
  const systemBridge = useSystemBridge({
    state: ioBridgeState,
    roots,
    defaultRootKey,
    hasPendingTorrents,
    onRetry: retry,
    onLaunch: launch,
    onCancel: cancel,
    onDisconnect: () => {
      // TODO: Implement disconnect if needed
      console.log('Disconnect requested')
    },
    onAddFolder: async () => {
      const root = await engineManager.pickDownloadFolder()
      if (root) {
        // Root will be added via daemon info update
      }
    },
    onSetDefaultRoot: async (key: string) => {
      setDefaultRootKey(key)
      if (engine) {
        await engineManager.setDefaultRoot(key)
      }
    },
  })

  // Initialize engine when connected (and not already initialized)
  useEffect(() => {
    if (isConnected && !engine && !isInitializing && !initError) {
      setIsInitializing(true)
      engineManager
        .init()
        .then((eng) => {
          setEngine(eng)
          // Set default root from engine
          const currentDefault = eng.storageRootManager.getDefaultRoot()
          if (currentDefault) {
            setDefaultRootKey(currentDefault.key)
          }
        })
        .catch((e) => {
          console.error('Failed to initialize engine:', e)
          setInitError(String(e))
        })
        .finally(() => {
          setIsInitializing(false)
        })
    }
  }, [isConnected, engine, isInitializing, initError])

  // Always render - show indicator even when not connected
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Header with System Bridge indicator */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>

        {/* System Bridge indicator */}
        <div style={{ position: 'relative' }}>
          <SystemIndicator
            label={systemBridge.readiness.indicator.label}
            color={systemBridge.readiness.indicator.color}
            pulse={systemBridge.readiness.pulse}
            onClick={systemBridge.togglePanel}
          />
          {systemBridge.panelOpen && (
            <SystemBridgePanel
              state={ioBridgeState}
              versionStatus={systemBridge.versionStatus}
              daemonVersion={systemBridge.daemonVersion}
              roots={roots}
              defaultRootKey={defaultRootKey}
              onRetry={retry}
              onLaunch={launch}
              onCancel={cancel}
              onDisconnect={() => console.log('Disconnect')}
              onAddFolder={async () => {
                await engineManager.pickDownloadFolder()
              }}
              onSetDefaultRoot={(key) => {
                setDefaultRootKey(key)
                engineManager.setDefaultRoot(key)
              }}
              onCopyDebugInfo={systemBridge.copyDebugInfo}
              onClose={systemBridge.closePanel}
            />
          )}
        </div>

        <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '12px' }}>
          {engine ? (
            <>
              {engine.torrents.length} torrents | {engine.numConnections} peers
            </>
          ) : isConnected ? (
            'Initializing...'
          ) : (
            'Not connected'
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {engine ? (
          <EngineProvider engine={engine}>
            <AppContent />
          </EngineProvider>
        ) : initError ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ color: 'var(--accent-error)', marginBottom: '16px' }}>
              Failed to initialize: {initError}
            </div>
            <button onClick={() => { setInitError(null); retry(); }}>
              Retry
            </button>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {ioBridgeState.name === 'INITIALIZING' && 'Starting...'}
            {ioBridgeState.name === 'PROBING' && 'Connecting to daemon...'}
            {ioBridgeState.name === 'INSTALL_PROMPT' && 'Click the indicator above to set up JSTorrent.'}
            {ioBridgeState.name === 'LAUNCH_PROMPT' && 'Click the indicator above to launch the companion app.'}
            {ioBridgeState.name === 'AWAITING_LAUNCH' && 'Waiting for companion app...'}
            {ioBridgeState.name === 'LAUNCH_FAILED' && 'Failed to connect. Click the indicator to retry.'}
            {ioBridgeState.name === 'DISCONNECTED' && 'Connection lost. Click the indicator to reconnect.'}
            {ioBridgeState.name === 'CONNECTED' && !engine && 'Initializing engine...'}
          </div>
        )}
      </div>
    </div>
  )
}
```

### 3.3 Remove Duplicate Header from AppContent

The header is now in `App`, so `AppContent` shouldn't render its own. Update `AppContent` to remove the header section (lines 238-285 in original).

Find and remove this block from `AppContent`:

```typescript
{/* Header */}
<div
  style={{
    padding: '8px 16px',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  }}
>
  <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>
  ... (tabs and stats)
</div>
```

Actually, let's keep AppContent simpler - it should just render the tab content. The tabs can move to App or stay but the header should be unified.

**Alternative approach:** Keep AppContent as-is but pass stats down. This is cleaner separation.

Let me revise - the header stays in App, AppContent just gets the content area:

### 3.3 (Revised) Simplify AppContent

Change the outer div of `AppContent` from:

```typescript
<div
  style={{
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'sans-serif',
  }}
>
```

To:

```typescript
<div
  style={{
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  }}
>
```

And remove the Header section entirely from AppContent (the `{/* Header */}` block from lines 238-285).

---

## Phase 4: Update SystemBridgePanel Props

The existing panel may need prop adjustments to match what App passes.

### 4.1 Check SystemBridgePanel.tsx Interface

View the current props interface and ensure it matches what we're passing in Phase 3.

The panel should accept:

```typescript
interface SystemBridgePanelProps {
  state: IOBridgeState
  versionStatus: VersionStatus
  daemonVersion: number | undefined
  roots: DownloadRoot[]
  defaultRootKey: string | null
  onRetry: () => void
  onLaunch: () => void
  onCancel: () => void
  onDisconnect: () => void
  onAddFolder: () => void
  onSetDefaultRoot: (key: string) => void
  onCopyDebugInfo: () => void
  onClose: () => void
}
```

If the existing component has different props, update either the component or the App.tsx calls to match.

---

## Phase 5: Handle Port Conflict

Currently both `useIOBridgeState` and `engine-manager.ts` try to connect to the SW port with name `'ui'`. The SW only keeps one UI port (single UI enforcement).

### Recommended: Merge Port Handling into useIOBridgeState

Have `useIOBridgeState` handle ALL port messages (including `TorrentAdded`, `MagnetAdded`, `CLOSE`), and expose them via callbacks.

### 5.1 Update useIOBridgeState to Handle All Messages

```typescript
export function useIOBridgeState(onNativeEvent?: (event: string, payload: unknown) => void) {
  // ... existing state and setup ...

  swPort.onMessage.addListener((msg) => {
    if (msg.type === 'IOBRIDGE_STATE_CHANGED' && msg.state) {
      setState(msg.state)
    } else if (msg.type === 'CLOSE') {
      window.close()
    } else if (msg.event) {
      // Forward native events (TorrentAdded, MagnetAdded)
      onNativeEvent?.(msg.event, msg.payload)
    }
  })

  // ...
}
```

### 5.2 Update App.tsx to Forward Events

```typescript
const { state, isConnected, retry, launch, cancel } = useIOBridgeState((event, payload) => {
  if (engine) {
    engineManager.handleNativeEvent(event, payload)
  }
})
```

### 5.3 Expose handleNativeEvent on EngineManager

In `engine-manager.ts`, make the private method public:

```typescript
/**
 * Handle native events forwarded from service worker.
 * Public so App can forward events from useIOBridgeState.
 */
async handleNativeEvent(event: string, payload: unknown): Promise<void> {
  // ... existing implementation (currently private)
}
```

### 5.4 Remove Port Connection from EngineManager

Delete or skip the `connectToServiceWorker()` call in `doInit()`, since the port is now managed by `useIOBridgeState`.

---

## Phase 6: Polish

### 6.1 Click Outside to Close Panel

The panel needs click-outside handling. This may already be in SystemBridgePanel or needs to be added.

### 6.2 Keyboard Support

- Escape closes panel
- Tab navigation within panel

### 6.3 Loading States

Show spinner during async operations (adding folder, etc.)

---

## Verification

### Manual Testing Checklist

1. **Start extension with daemon not installed:**
   - [ ] App loads without error
   - [ ] Indicator shows "Setup" (yellow)
   - [ ] Panel shows install instructions
   - [ ] Main content shows helpful message

2. **Start extension with daemon installed but not running:**
   - [ ] Indicator shows "Setup" or "Connecting..."
   - [ ] Panel shows appropriate state

3. **Start extension with daemon running:**
   - [ ] Indicator transitions to "Ready" (green)
   - [ ] Engine initializes
   - [ ] Torrents load
   - [ ] Stats appear in header

4. **Daemon disconnects while running:**
   - [ ] Indicator changes to "Offline" (red)
   - [ ] Panel shows reconnect option
   - [ ] Existing torrents remain visible (stale)

5. **Add torrent while disconnected:**
   - [ ] Torrent can be added (to session)
   - [ ] Indicator pulses (action needed)
   - [ ] Torrent starts when reconnected

6. **Download roots:**
   - [ ] Panel shows root list when connected
   - [ ] Can change default root
   - [ ] Can add new folder

### Type Check

```bash
cd packages/client
pnpm typecheck
```

### Test

```bash
cd packages/client
pnpm test
```

---

## File Summary

### New Files
```
packages/client/src/hooks/useIOBridgeState.ts
```

### Modified Files
```
extension/src/sw.ts                     ← Add IOBRIDGE_LAUNCH, IOBRIDGE_CANCEL, IOBRIDGE_RETRY handlers
packages/client/src/App.tsx             ← Major rewrite for non-blocking init
packages/client/src/chrome/engine-manager.ts  ← Expose handleNativeEvent, remove port connection
packages/client/src/hooks/useSystemBridge.ts  ← May need minor updates
packages/client/src/components/SystemBridgePanel.tsx  ← May need prop updates
```

### Files to Eventually Delete (Not in This Task)
```
extension/src/lib/native-connection.ts  ← Types still re-exported, keep for now
```

---

## Architecture After This Task

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Service Worker                             │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      IOBridgeService                            ││
│  │  - State machine                                                 ││
│  │  - Platform adapters                                             ││
│  │  - Native event forwarding                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              │ Port messages                         │
│                              │ - IOBRIDGE_STATE_CHANGED             │
│                              │ - TorrentAdded/MagnetAdded           │
│                              │ - CLOSE                              │
│                              ▼                                       │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              App.tsx                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │useIOBridgeState │  │ useSystemBridge │  │   EngineManager     │ │
│  │ - Subscribe to  │  │ - Readiness     │  │ - Init when         │ │
│  │   state changes │  │ - Panel state   │  │   connected         │ │
│  │ - Action cbs    │  │ - Indicator     │  │ - Torrent ops       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
│           │                   │                      │              │
│           └───────────────────┼──────────────────────┘              │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  Header: [JSTorrent] [SystemIndicator ▼] [Stats...]             ││
│  │                         └─► SystemBridgePanel (dropdown)        ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │  Content: EngineProvider > AppContent (when engine ready)       ││
│  │           OR placeholder message (when not connected)           ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```
