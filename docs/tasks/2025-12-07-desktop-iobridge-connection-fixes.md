# Desktop IOBridge Connection Handling Fixes

## Overview

The IOBridge state machine is implemented but has gaps in detecting and handling connection failures on desktop (Linux/Windows/macOS). This task fixes those gaps to make the system indicator accurately reflect native host availability.

**Symptoms:**
- Uninstalling native host doesn't turn indicator red
- Once in `INSTALL_PROMPT`, no auto-detection when user installs
- State can get "stuck" without manual retry

**Goals:**
- Robust error detection in `NativeHostConnection` and `DesktopAdapter`
- Auto-polling from `INSTALL_PROMPT` to detect native host installation
- Proper disconnect detection for all failure modes
- Configurable retry behavior with exponential backoff

**Scope:** Desktop platforms only (Linux, Windows, macOS). ChromeOS improvements deferred.

---

## Background

### Current Architecture

```
sw.ts                     
    │ createIOBridgeService()
    ▼
IOBridgeService
    │
    ├── IOBridgeStore (state container)
    ├── IOBridgeEffects (side effect runner)
    └── DesktopAdapter
            │
            └── NativeHostConnection (chrome.runtime.connectNative)
```

### Current Flow

1. `IOBridgeService.start()` → dispatches `START` event
2. `START` → state becomes `PROBING`
3. `IOBridgeEffects.handleProbing()` calls `adapter.probe()`
4. `DesktopAdapter.probe()`:
   - Creates `NativeHostConnection`
   - Calls `connect()` → `chrome.runtime.connectNative()`
   - Sends handshake, waits for `DaemonInfo`
   - Returns `ProbeResult`
5. On success → `CONNECTED`
6. On failure → `INSTALL_PROMPT` (and stays there forever)

### Problem Areas

**1. `chrome.runtime.lastError` not checked properly**

In `native-connection.ts`:
```typescript
async connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      this.port = chrome.runtime.connectNative('com.jstorrent.native')
      if (chrome.runtime.lastError) {  // ← May not be set yet!
        reject(chrome.runtime.lastError)
      } else {
        resolve()  // ← Resolves immediately, before error can occur
      }
    } catch (e) {
      reject(e)
    }
  })
}
```

`chrome.runtime.lastError` is an async pattern - it's checked in callbacks, not synchronously after the call. The current code may resolve successfully even when the native host isn't installed.

**2. No polling from INSTALL_PROMPT**

In `io-bridge-effects.ts`, `handleStateChange()` only handles:
- `PROBING` → triggers probe
- `CONNECTED` → sets up disconnect watcher
- `AWAITING_LAUNCH` → sets up polling and timeout (ChromeOS only)
- `DISCONNECTED` → sets up auto-retry timer

There's no handler for `INSTALL_PROMPT`. Once in this state, the user must manually click "Retry".

**3. Disconnect detection gaps**

The `watchConnection()` wires up `port.onDisconnect`, but:
- Only called AFTER successful probe
- If probe succeeds but daemon crashes immediately after, may miss it
- No health check / keepalive mechanism

---

## Implementation Plan

### Phase 1: Fix NativeHostConnection Error Handling

**File:** `extension/src/lib/native-connection.ts`

The `connect()` method needs to wait for actual connection success/failure, not just the synchronous return.

#### 1.1 Update NativeHostConnection.connect()

```typescript
async connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      this.port = chrome.runtime.connectNative('com.jstorrent.native')
      
      // Set up disconnect handler FIRST to catch immediate failures
      const disconnectHandler = () => {
        const error = chrome.runtime.lastError?.message || 'Native host disconnected'
        console.error('[NativeHostConnection] Connection failed:', error)
        reject(new Error(error))
      }
      
      this.port.onDisconnect.addListener(disconnectHandler)
      
      // Wait a tick to see if connection fails immediately
      // Chrome sets lastError asynchronously
      setTimeout(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (this.port) {
          // Remove the reject-on-disconnect handler, will re-add for normal operation
          this.port.onDisconnect.removeListener(disconnectHandler)
          resolve()
        }
      }, 50)
    } catch (e) {
      reject(e)
    }
  })
}
```

**Key changes:**
- Add `onDisconnect` listener BEFORE resolving
- Use `setTimeout` to allow async error propagation
- Check `lastError` after a tick

#### 1.2 Add connection state tracking

```typescript
export class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null
  private connected = false
  private disconnectCallbacks: Array<() => void> = []
  
  async connect(): Promise<void> {
    // ... (updated implementation from 1.1)
    this.connected = true
  }
  
  isConnected(): boolean {
    return this.connected && this.port !== null
  }
  
  // ... rest of implementation
}
```

#### Verification

```bash
cd extension
pnpm typecheck
pnpm test
```

Manual test:
1. Uninstall native host
2. Open extension
3. Should show INSTALL_PROMPT (not CONNECTED)

---

### Phase 2: Add Polling from INSTALL_PROMPT

**Files:**
- `extension/src/lib/io-bridge/io-bridge-effects.ts`
- `extension/src/lib/io-bridge/types.ts` (if needed)

When in `INSTALL_PROMPT`, poll periodically to detect when user installs the native host.

#### 2.1 Add poll interval configuration

Update `IOBridgeEffectsConfig`:

```typescript
export interface IOBridgeEffectsConfig {
  /** Timeout for launch operation in ms (default: 30000) */
  launchTimeoutMs?: number
  /** Whether to auto-retry on disconnect (default: true) */
  autoRetryOnDisconnect?: boolean
  /** Delay before auto-retry in ms (default: 2000) */
  autoRetryDelayMs?: number
  /** Interval for polling from INSTALL_PROMPT in ms (default: 5000) */
  installPollIntervalMs?: number
  /** Max poll attempts from INSTALL_PROMPT before giving up (default: unlimited) */
  installPollMaxAttempts?: number
}

const DEFAULT_CONFIG: Required<IOBridgeEffectsConfig> = {
  launchTimeoutMs: 30000,
  autoRetryOnDisconnect: true,
  autoRetryDelayMs: 2000,
  installPollIntervalMs: 5000,
  installPollMaxAttempts: 0,  // 0 = unlimited
}
```

#### 2.2 Add INSTALL_PROMPT handler

In `IOBridgeEffects.handleStateChange()`:

```typescript
private handleStateChange(state: IOBridgeState, previousState: IOBridgeState): void {
  // Clean up effects from previous state
  if (previousState.name !== state.name) {
    this.cleanup()
  }

  // Trigger effects for new state
  switch (state.name) {
    case 'PROBING':
      this.handleProbing()
      break

    case 'CONNECTED':
      if (state.name === 'CONNECTED') {
        this.handleConnected(state.connectionId)
      }
      break

    case 'AWAITING_LAUNCH':
      this.handleAwaitingLaunch()
      break

    case 'DISCONNECTED':
      if (this.config.autoRetryOnDisconnect) {
        this.handleDisconnected()
      }
      break

    // NEW: Handle INSTALL_PROMPT
    case 'INSTALL_PROMPT':
      this.handleInstallPrompt()
      break
  }
}
```

#### 2.3 Implement handleInstallPrompt()

```typescript
private installPollAttempts = 0
private installPollTimer: ReturnType<typeof setInterval> | null = null

private handleInstallPrompt(): void {
  if (this.config.installPollIntervalMs <= 0) {
    console.log('[IOBridgeEffects] Install polling disabled')
    return
  }
  
  console.log('[IOBridgeEffects] Starting install poll interval')
  this.installPollAttempts = 0
  
  // Start polling
  this.installPollTimer = setInterval(() => {
    this.pollForInstall()
  }, this.config.installPollIntervalMs)
  
  // Register cleanup
  this.cleanupFns.push(() => {
    if (this.installPollTimer) {
      clearInterval(this.installPollTimer)
      this.installPollTimer = null
    }
  })
  
  // Do first poll immediately
  this.pollForInstall()
}

private async pollForInstall(): Promise<void> {
  this.installPollAttempts++
  
  // Check max attempts
  if (this.config.installPollMaxAttempts > 0 && 
      this.installPollAttempts > this.config.installPollMaxAttempts) {
    console.log('[IOBridgeEffects] Max install poll attempts reached')
    if (this.installPollTimer) {
      clearInterval(this.installPollTimer)
      this.installPollTimer = null
    }
    return
  }
  
  console.log(`[IOBridgeEffects] Polling for native host (attempt ${this.installPollAttempts})`)
  
  try {
    const result = await this.adapter.probe()
    if (result.success) {
      console.log('[IOBridgeEffects] Native host detected!')
      this.store.dispatch({
        type: 'PROBE_SUCCESS',
        connectionId: result.connectionId,
        daemonInfo: result.daemonInfo,
      })
    }
    // On failure, just keep polling
  } catch (error) {
    console.log('[IOBridgeEffects] Poll probe error (expected):', error)
    // Keep polling
  }
}
```

#### Verification

```bash
cd extension
pnpm typecheck
pnpm test
```

Manual test:
1. Uninstall native host
2. Open extension → shows INSTALL_PROMPT
3. Install native host (run installer)
4. Wait up to 5 seconds
5. Indicator should turn green (CONNECTED) automatically

---

### Phase 3: Improve Disconnect Detection

**Files:**
- `extension/src/lib/io-bridge/adapters/desktop-adapter.ts`
- `extension/src/lib/native-connection.ts`

#### 3.1 Wire up onDisconnect immediately in probe()

Update `DesktopAdapter.probe()` to set up disconnect handling as part of the probe:

```typescript
async probe(): Promise<ProbeResult> {
  try {
    // Create and connect to native host
    this.connection = this.config.createConnection()
    await this.connection.connect()

    // Set up disconnect handler IMMEDIATELY
    // This catches crashes during handshake
    let disconnectedDuringProbe = false
    this.connection.onDisconnect(() => {
      console.log('[DesktopAdapter] Disconnected during probe/operation')
      disconnectedDuringProbe = true
      // If we have a callback registered, notify it
      if (this.disconnectCallback) {
        this.disconnectCallback(true)
        this.cleanup()
      }
    })

    // Generate connection ID
    const connectionId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.currentConnectionId = connectionId

    // Get install ID from storage
    const installId = await this.getInstallId()

    // Send handshake
    const requestId = crypto.randomUUID()
    this.connection.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: requestId,
    })

    // Wait for DaemonInfo response
    const daemonInfo = await this.waitForDaemonInfo()
    
    // Check if we disconnected during handshake
    if (disconnectedDuringProbe) {
      throw new Error('Disconnected during handshake')
    }

    return {
      success: true,
      connectionId,
      daemonInfo,
    }
  } catch (error) {
    console.error('[DesktopAdapter] Probe failed:', error)
    this.cleanup()
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

#### 3.2 Add connection health indicator

Add a method to check if the connection is still alive:

```typescript
// In NativeHostConnection
private disconnected = false

onDisconnect(cb: () => void): void {
  this.disconnectCallbacks.push(cb)
  
  this.port?.onDisconnect.addListener(() => {
    this.disconnected = true
    this.connected = false
    for (const callback of this.disconnectCallbacks) {
      try {
        callback()
      } catch (e) {
        console.error('[NativeHostConnection] Disconnect callback error:', e)
      }
    }
  })
}

isDisconnected(): boolean {
  return this.disconnected
}
```

#### Verification

```bash
cd extension
pnpm typecheck
pnpm test
```

Manual test:
1. Start extension with native host running → CONNECTED
2. Kill native host process: `killall jstorrent-native`
3. Indicator should turn yellow/red (DISCONNECTED) within seconds
4. Native host auto-restarts or user restarts → should reconnect

---

### Phase 4: Add Exponential Backoff for Retries

**Files:**
- `extension/src/lib/io-bridge/io-bridge-state.ts` (update history)
- `extension/src/lib/io-bridge/io-bridge-effects.ts` (calculate delays)

#### 4.1 Enhance ConnectionHistory

Update the history tracking to support backoff:

```typescript
// In types.ts or io-bridge-state.ts
export interface ConnectionHistory {
  attempts: number
  lastAttempt: number | null
  lastError: string | null
  consecutiveFailures: number  // NEW
}

export function createConnectionHistory(): ConnectionHistory {
  return {
    attempts: 0,
    lastAttempt: null,
    lastError: null,
    consecutiveFailures: 0,
  }
}

export function recordAttempt(
  history: ConnectionHistory,
  error: string | null = null,
): ConnectionHistory {
  return {
    attempts: history.attempts + 1,
    lastAttempt: Date.now(),
    lastError: error,
    consecutiveFailures: error ? history.consecutiveFailures + 1 : 0,
  }
}

export function resetFailures(history: ConnectionHistory): ConnectionHistory {
  return {
    ...history,
    consecutiveFailures: 0,
    lastError: null,
  }
}
```

#### 4.2 Add backoff configuration

```typescript
export interface IOBridgeEffectsConfig {
  // ... existing
  
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelayMs?: number
  /** Maximum delay for exponential backoff in ms (default: 30000) */
  retryMaxDelayMs?: number
  /** Backoff multiplier (default: 2) */
  retryBackoffMultiplier?: number
}

const DEFAULT_CONFIG: Required<IOBridgeEffectsConfig> = {
  // ... existing
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30000,
  retryBackoffMultiplier: 2,
}
```

#### 4.3 Calculate backoff delay

```typescript
private calculateRetryDelay(consecutiveFailures: number): number {
  const { retryBaseDelayMs, retryMaxDelayMs, retryBackoffMultiplier } = this.config
  
  // Exponential backoff: base * multiplier^failures
  const delay = retryBaseDelayMs * Math.pow(retryBackoffMultiplier, consecutiveFailures)
  
  // Cap at max delay
  return Math.min(delay, retryMaxDelayMs)
}
```

#### 4.4 Use backoff in handleDisconnected

```typescript
private handleDisconnected(): void {
  const state = this.store.getState()
  if (state.name !== 'DISCONNECTED') return
  
  const delay = this.calculateRetryDelay(state.history.consecutiveFailures)
  console.log(`[IOBridgeEffects] Auto-retry in ${delay}ms (failures: ${state.history.consecutiveFailures})`)
  
  this.retryTimeout = setTimeout(() => {
    this.store.dispatch({ type: 'RETRY' })
  }, delay)

  this.cleanupFns.push(() => {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
  })
}
```

#### Verification

```bash
cd extension
pnpm typecheck
pnpm test
```

Add test for backoff:
```typescript
it('uses exponential backoff for retries', async () => {
  const adapter = new MockAdapter({
    platform: 'desktop',
    probeResult: createFailedProbeResult(),
  })

  const store = new IOBridgeStore()
  const effects = new IOBridgeEffects(store, adapter, {
    autoRetryOnDisconnect: true,
    retryBaseDelayMs: 1000,
    retryBackoffMultiplier: 2,
    retryMaxDelayMs: 10000,
  })

  // Start with a failed probe
  effects.start()
  await vi.runAllTimersAsync()
  expect(store.getState().name).toBe('INSTALL_PROMPT')

  // Simulate coming from DISCONNECTED state
  store.dispatch({ 
    type: 'DAEMON_DISCONNECTED', 
    wasHealthy: true 
  })
  
  // First retry after 1000ms
  await vi.advanceTimersByTimeAsync(999)
  expect(store.getState().name).toBe('DISCONNECTED')
  await vi.advanceTimersByTimeAsync(2)
  expect(store.getState().name).toBe('PROBING')

  effects.stop()
})
```

---

### Phase 5: Update Tests

**File:** `extension/src/lib/io-bridge/__tests__/io-bridge-integration.test.ts`

#### 5.1 Add tests for INSTALL_PROMPT polling

```typescript
describe('INSTALL_PROMPT polling', () => {
  it('polls for native host installation', async () => {
    const adapter = new MockAdapter({
      platform: 'desktop',
      probeResult: createFailedProbeResult(),
    })

    const store = new IOBridgeStore()
    const effects = new IOBridgeEffects(store, adapter, {
      installPollIntervalMs: 1000,
    })

    effects.start()
    await vi.runAllTimersAsync()
    expect(store.getState().name).toBe('INSTALL_PROMPT')
    expect(adapter.getProbeCallCount()).toBe(1) // Initial probe

    // Advance time, should poll again
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.getProbeCallCount()).toBe(2)

    // Make probe succeed
    adapter.setProbeResult(createSuccessProbeResult())
    
    // Next poll should succeed
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getState().name).toBe('CONNECTED')

    effects.stop()
  })

  it('stops polling when max attempts reached', async () => {
    const adapter = new MockAdapter({
      platform: 'desktop',
      probeResult: createFailedProbeResult(),
    })

    const store = new IOBridgeStore()
    const effects = new IOBridgeEffects(store, adapter, {
      installPollIntervalMs: 1000,
      installPollMaxAttempts: 3,
    })

    effects.start()
    await vi.runAllTimersAsync()
    expect(store.getState().name).toBe('INSTALL_PROMPT')

    // Poll 3 times
    await vi.advanceTimersByTimeAsync(3000)
    expect(adapter.getProbeCallCount()).toBe(4) // 1 initial + 3 polls

    // Should not poll anymore
    await vi.advanceTimersByTimeAsync(5000)
    expect(adapter.getProbeCallCount()).toBe(4)

    effects.stop()
  })

  it('disables polling when interval is 0', async () => {
    const adapter = new MockAdapter({
      platform: 'desktop',
      probeResult: createFailedProbeResult(),
    })

    const store = new IOBridgeStore()
    const effects = new IOBridgeEffects(store, adapter, {
      installPollIntervalMs: 0,
    })

    effects.start()
    await vi.runAllTimersAsync()
    expect(store.getState().name).toBe('INSTALL_PROMPT')

    // Advance time, should NOT poll
    await vi.advanceTimersByTimeAsync(10000)
    expect(adapter.getProbeCallCount()).toBe(1) // Only initial probe

    effects.stop()
  })
})
```

#### 5.2 Add tests for disconnect detection

```typescript
describe('Disconnect detection', () => {
  it('detects disconnect during handshake', async () => {
    // This requires updating MockAdapter to simulate disconnect during probe
    const adapter = new MockAdapter({
      platform: 'desktop',
      probeResult: createFailedProbeResult('Disconnected during handshake'),
    })

    const store = new IOBridgeStore()
    const effects = new IOBridgeEffects(store, adapter)

    effects.start()
    await vi.runAllTimersAsync()

    expect(store.getState().name).toBe('INSTALL_PROMPT')

    effects.stop()
  })

  it('detects disconnect after connection established', async () => {
    const connectionId = 'test-conn'
    const adapter = new MockAdapter({
      platform: 'desktop',
      probeResult: createSuccessProbeResult(connectionId),
    })

    const store = new IOBridgeStore()
    const effects = new IOBridgeEffects(store, adapter)

    effects.start()
    await vi.runAllTimersAsync()
    expect(store.getState().name).toBe('CONNECTED')

    // Simulate disconnect
    adapter.simulateDaemonDisconnected(connectionId, true)
    expect(store.getState().name).toBe('DISCONNECTED')

    effects.stop()
  })
})
```

---

## Verification Checklist

### After Phase 1:
- [ ] `NativeHostConnection.connect()` rejects when native host not installed
- [ ] Probe fails cleanly with descriptive error message
- [ ] No false positives (doesn't report success when host missing)

### After Phase 2:
- [ ] `INSTALL_PROMPT` state triggers polling
- [ ] Polling interval is configurable (default 5s)
- [ ] Polling stops when `PROBE_SUCCESS` dispatched
- [ ] Max attempts limit works (optional)

### After Phase 3:
- [ ] Killing native host process triggers `DAEMON_DISCONNECTED`
- [ ] Disconnection detected within 1-2 seconds
- [ ] Reconnection works after daemon restarts

### After Phase 4:
- [ ] Retry delay increases with consecutive failures
- [ ] Delay caps at maximum (30s default)
- [ ] Successful connection resets failure counter

### After Phase 5:
- [ ] All existing tests pass
- [ ] New tests cover polling behavior
- [ ] New tests cover disconnect detection
- [ ] New tests cover exponential backoff

---

## File Summary

### Files to Modify

```
extension/src/lib/native-connection.ts
  - Fix connect() error handling
  - Add isConnected(), isDisconnected() methods
  - Track connection state

extension/src/lib/io-bridge/io-bridge-effects.ts
  - Add handleInstallPrompt()
  - Add pollForInstall()
  - Add exponential backoff calculation
  - Update handleDisconnected() to use backoff

extension/src/lib/io-bridge/io-bridge-state.ts
  - Add consecutiveFailures to ConnectionHistory
  - Add resetFailures() helper

extension/src/lib/io-bridge/types.ts
  - Update ConnectionHistory interface

extension/src/lib/io-bridge/adapters/desktop-adapter.ts
  - Set up disconnect handler earlier in probe()
  - Improve error handling

extension/src/lib/io-bridge/__tests__/io-bridge-integration.test.ts
  - Add tests for INSTALL_PROMPT polling
  - Add tests for disconnect detection
  - Add tests for exponential backoff
```

---

## Testing Commands

```bash
# Type check
cd extension && pnpm typecheck

# Run unit tests
cd extension && pnpm test

# Run specific test file
cd extension && pnpm test src/lib/io-bridge/__tests__/io-bridge-integration.test.ts

# Build extension
pnpm build

# Manual testing (Linux)
cd native-host && ./scripts/install-local-linux.sh
# Then load extension in Chrome and test scenarios
```

---

## Notes

### Why not use chrome.runtime.sendNativeMessage()?

`sendNativeMessage()` is a one-shot API - it launches the native host, sends a message, gets a response, and the host exits. Our architecture needs a persistent connection because:
1. Native host spawns io-daemon as a child process
2. io-daemon maintains WebSocket connection for real-time data
3. Closing native host connection kills io-daemon

### Chrome API Error Patterns

Chrome extension APIs use an unusual error pattern:
- Errors don't throw exceptions
- Errors are set on `chrome.runtime.lastError`
- Must check `lastError` in callbacks, not synchronously
- Some errors only appear asynchronously via `onDisconnect`

This is why the current error handling doesn't work - it checks `lastError` synchronously.

### Alternative: Use Native Messaging Keepalive

Another approach would be to send periodic keepalive messages through the native messaging port. If the native host doesn't respond within a timeout, consider it dead. This would catch more failure modes but adds complexity. Consider for future if current approach proves insufficient.
