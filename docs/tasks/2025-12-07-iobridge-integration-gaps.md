# IOBridge Integration Gaps

## Overview

This task bridges the gap between the IOBridge state machine implementation (Phases 1-5 from `2025-12-07-io-bridge-state-machine.md`) and the System Bridge UI (Phases 6-11 from `2025-12-07-system-bridge-ui.md`).

**Complete these tasks before starting the UI work.**

## Current State

- ✅ IOBridge state machine implemented
- ✅ Desktop and ChromeOS adapters implemented
- ✅ `sw.ts` updated to use `createIOBridgeService()`
- ❓ Event forwarding needs verification
- ❌ Old connection files not yet deleted
- ❌ UI cannot observe IOBridge state (only gets daemon info or error)
- ❌ Initialization still blocks on daemon connection

---

## Phase A: Verify Event Forwarding

The old `DaemonLifecycleManager` forwarded native events (`TorrentAdded`, `MagnetAdded`) to the UI. Verify the new `IOBridgeService` does the same.

### A.1 Check IOBridgeService API

Verify that `createIOBridgeService()` accepts an event callback or emits events that `sw.ts` can forward.

Look for something like:

```typescript
const ioBridge = createIOBridgeService({
  onNativeEvent: (event: NativeEvent) => {
    sendToUI(event)
    if (event.event === 'TorrentAdded' || event.event === 'MagnetAdded') {
      openUiTab()
    }
  }
})
```

Or event emitter pattern:

```typescript
ioBridge.on('nativeEvent', (event) => { ... })
```

### A.2 Test Event Flow

1. Start extension with daemon running
2. Add a `.torrent` file via the native host (drag to link-handler or file association)
3. Verify:
   - UI tab opens
   - Torrent appears in list
   - Console shows `[SW] Native event received: TorrentAdded`

If events aren't flowing, the adapter's `onMessage` handling needs to forward push events from the native connection.

### A.3 Fix if Needed

The desktop adapter should wire up message forwarding from the native port:

```typescript
// In DesktopIOBridgeAdapter.probe() or similar
this.nativePort.onMessage.addListener((msg) => {
  if (msg.event) {
    // Forward native push events
    this.eventCallback?.(msg as NativeEvent)
  }
})
```

---

## Phase B: Add State Observation

The UI needs to observe IOBridge state to render the System Bridge indicator. Currently it only gets daemon info or an error.

### B.1 Add GET_IOBRIDGE_STATE Message Handler

In `sw.ts`, add a new message type that returns the current state:

```typescript
// In handleMessage function, add:

if (message.type === 'GET_IOBRIDGE_STATE') {
  const state = ioBridge.getState()
  sendResponse({ ok: true, state })
  return true
}
```

This requires `IOBridgeService` to expose a `getState()` method that returns the current `IOBridgeState`.

### B.2 Add State to IOBridgeService

If not already present, add to `IOBridgeService` (or `IOBridgeEffects`):

```typescript
getState(): IOBridgeState {
  return this.store.getState()
}
```

### B.3 Update GET_DAEMON_INFO Response

Instead of throwing on failure, return the state so UI knows what's happening:

**Before:**
```typescript
if (message.type === 'GET_DAEMON_INFO') {
  ioBridge
    .getDaemonInfo()
    .then((info) => sendResponse({ ok: true, daemonInfo: info }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }))
  return true
}
```

**After:**
```typescript
if (message.type === 'GET_DAEMON_INFO') {
  const state = ioBridge.getState()
  
  if (state.type === 'CONNECTED') {
    sendResponse({ 
      ok: true, 
      daemonInfo: state.daemonInfo,
      state: state.type,
    })
  } else {
    sendResponse({ 
      ok: false, 
      state: state.type,
      // Include helpful context based on state
      ...(state.type === 'INSTALL_PROMPT' && { needsInstall: true }),
      ...(state.type === 'LAUNCH_PROMPT' && { needsLaunch: true }),
    })
  }
  return true
}
```

### B.4 Add State Change Subscription (Optional)

For real-time updates, the UI could subscribe to state changes via the existing port:

```typescript
// In IOBridgeService or sw.ts
store.subscribe((newState) => {
  if (primaryUIPort) {
    primaryUIPort.postMessage({ 
      type: 'IOBRIDGE_STATE_CHANGED', 
      state: newState 
    })
  }
})
```

This allows the UI to update immediately when state changes (e.g., connection established) without polling.

---

## Phase C: Delete Old Files

Remove deprecated connection code now that IOBridge is integrated.

### C.1 Files to Delete

```bash
cd extension/src/lib
rm daemon-lifecycle-manager.ts
rm android-connection.ts
```

### C.2 Verify No Remaining Imports

```bash
# From extension directory
grep -r "daemon-lifecycle-manager" src/
grep -r "android-connection" src/
grep -r "DaemonLifecycleManager" src/
grep -r "AndroidDaemonConnection" src/
```

Should return no results (except possibly comments).

### C.3 Check native-connection.ts

This file defines types that may still be needed:
- `DownloadRoot`
- `DaemonInfo`
- `INativeHostConnection`
- `NativeHostConnection`

**Option A:** Keep `native-connection.ts` if adapters still use `NativeHostConnection` class.

**Option B:** Move types to `io-bridge/types.ts` and delete `native-connection.ts`:

In `io-bridge/types.ts`, ensure these are defined:
```typescript
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
  version?: number
  roots: DownloadRoot[]
  host?: string
}
```

Then update imports throughout to use `@/lib/io-bridge/types` or the io-bridge index export.

### C.4 Update platform.ts (if needed)

Check if `platform.ts` duplicates functionality now in io-bridge. The `detectPlatform()` function should live in one place.

If io-bridge has its own platform detection, either:
- Delete `platform.ts` and update imports
- Or keep `platform.ts` and have io-bridge import from it

---

## Phase D: Prepare for Non-Blocking Init

The System Bridge UI requires the app to work without an active daemon connection. This phase prepares `engine-manager.ts` for that change.

### D.1 Current Problem

```typescript
// packages/client/src/chrome/engine-manager.ts
async doInit(): Promise<BtEngine> {
  const response = await bridge.sendMessage({ type: 'GET_DAEMON_INFO' })
  if (!response.ok) {
    throw new Error(`Failed to get daemon info: ${response.error}`)  // BLOCKS
  }
  
  // Everything below requires daemon connection
  this.daemonConnection = new DaemonConnection(...)
  await this.daemonConnection.connectWebSocket()
  // ... create engine with daemon adapters
}
```

And in `App.tsx`:
```typescript
if (error) return <div>Error: {error}</div>  // Dead end
```

### D.2 Target Architecture

```
Engine starts without daemon
         │
         ▼
┌─────────────────────────┐
│  BtEngine (suspended)   │  ← Can add torrents
│  - MemorySocketFactory  │  ← No actual networking
│  - MemoryFileSystem     │  ← Or null adapters
└─────────────────────────┘
         │
         │ IOBridge connects
         ▼
┌─────────────────────────┐
│  BtEngine (resumed)     │  ← Torrents start downloading
│  - DaemonSocketFactory  │  ← Real networking
│  - DaemonFileSystem     │  ← Real filesystem
└─────────────────────────┘
```

### D.3 Implementation Sketch

This is more substantial and can be done alongside Phase 10 (UI integration). Key changes:

**1. Split engine initialization:**

```typescript
// Phase 1: Create engine with null/memory adapters
function createOfflineEngine(): BtEngine {
  return new BtEngine({
    socketFactory: new NullSocketFactory(),  // No-op sockets
    storageRootManager: new StorageRootManager(() => new MemoryFileSystem()),
    sessionStore: createSessionStore(),
    startSuspended: true,
  })
}

// Phase 2: Upgrade to daemon adapters when connected
function upgradeEngineWithDaemon(engine: BtEngine, daemonInfo: DaemonInfo): void {
  const daemonConnection = new DaemonConnection(daemonInfo.port, daemonInfo.token, daemonInfo.host)
  await daemonConnection.connectWebSocket()
  
  // Replace adapters (may need engine API changes)
  engine.socketFactory = new DaemonSocketFactory(daemonConnection)
  engine.storageRootManager.setFileSystemFactory(
    (root) => new DaemonFileSystem(daemonConnection, root.key)
  )
  
  // Register roots
  for (const root of daemonInfo.roots) {
    engine.storageRootManager.addRoot({ ... })
  }
  
  // Resume
  engine.resume()
}
```

**2. NullSocketFactory:**

```typescript
// packages/engine/src/adapters/null/null-socket-factory.ts
export class NullSocketFactory implements ISocketFactory {
  createTcpSocket(): ITcpSocket {
    return new NullTcpSocket()
  }
  createUdpSocket(): IUdpSocket {
    return new NullUdpSocket()
  }
  createTcpServer(): ITcpServer | null {
    return null
  }
  wrapTcpSocket(socket: unknown): ITcpSocket {
    return new NullTcpSocket()
  }
}

class NullTcpSocket implements ITcpSocket {
  connect(): Promise<void> {
    return Promise.reject(new Error('No connection available'))
  }
  // ... other methods throw or no-op
}
```

**3. Update EngineManager:**

```typescript
async doInit(): Promise<BtEngine> {
  // Create engine immediately (offline mode)
  this.engine = createOfflineEngine()
  
  // Restore session (works without daemon - just loads torrent metadata)
  await this.engine.restoreSession()
  
  // Try to connect to daemon
  const response = await bridge.sendMessage({ type: 'GET_DAEMON_INFO' })
  if (response.ok) {
    await this.upgradeEngineWithDaemon(response.daemonInfo)
  }
  // If not ok, engine stays in offline mode - UI shows indicator
  
  return this.engine
}
```

### D.4 Defer to Phase 10

The full implementation of non-blocking init is intertwined with the UI work. This phase just identifies the pattern. Implement during Phase 10 of the System Bridge UI task.

---

## Verification Checklist

### After Phase A:
- [ ] Native events (`TorrentAdded`, `MagnetAdded`) flow from daemon → SW → UI
- [ ] Adding torrent via native host opens UI and shows torrent

### After Phase B:
- [ ] `GET_IOBRIDGE_STATE` message returns current state
- [ ] `GET_DAEMON_INFO` returns state info even when not connected
- [ ] (Optional) UI receives `IOBRIDGE_STATE_CHANGED` messages on port

### After Phase C:
- [ ] `daemon-lifecycle-manager.ts` deleted
- [ ] `android-connection.ts` deleted
- [ ] No broken imports
- [ ] Types consolidated in io-bridge or native-connection

### After Phase D:
- [ ] Implementation plan documented
- [ ] Ready to implement in Phase 10 of System Bridge UI

---

## File Summary

### Files to Delete
```
extension/src/lib/daemon-lifecycle-manager.ts
extension/src/lib/android-connection.ts
```

### Files to Modify
```
extension/src/sw.ts                    ← Add GET_IOBRIDGE_STATE handler
extension/src/lib/io-bridge/index.ts   ← Export getState if needed
extension/src/lib/io-bridge/types.ts   ← Consolidate types (if moving from native-connection)
```

### Files to Potentially Delete
```
extension/src/lib/native-connection.ts  ← If types moved to io-bridge
extension/src/lib/platform.ts           ← If duplicated in io-bridge
```

---

## Testing Commands

```bash
# Verify no broken imports after cleanup
cd extension
pnpm typecheck

# Run existing tests
pnpm test

# Manual verification
pnpm dev
# Test event forwarding with native host
```
