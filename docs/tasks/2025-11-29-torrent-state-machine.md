# Engine Suspend/Resume and Torrent State Machine

## Overview

Implement proper separation between:
1. **Engine-level suspend/resume** - Global kill switch for all network activity (used during session restore)
2. **Torrent-level user state** - User's intent for each torrent (active, stopped, queued)

This fixes the issue where torrents start networking before session restore completes.

## Concepts

### Engine Suspension
The engine can be suspended, which stops ALL network activity regardless of individual torrent states. Used for:
- Session restore (add torrents, restore bitfields, THEN resume)
- "Pause All" feature
- Network unavailable scenarios

### Torrent User State (Persisted)
What the user wants for this torrent:
- `active` - User wants it downloading/seeding
- `stopped` - User manually stopped it
- `queued` - User wants it active, but waiting for slot (future feature)

### Torrent Activity State (Derived, Not Persisted)
What's actually happening right now, derived from user state + engine state + progress:
- `stopped` - No network activity
- `checking` - Verifying existing data
- `downloading_metadata` - Fetching torrent info from peers
- `downloading` - Getting pieces
- `seeding` - Complete, uploading
- `error` - Something went wrong

## Task 1: Define State Types

**Create file**: `packages/engine/src/core/torrent-state.ts`

```typescript
/**
 * User's intent for the torrent - persisted to session store.
 */
export type TorrentUserState = 'active' | 'stopped' | 'queued'

/**
 * What the torrent is actually doing right now.
 * Derived from userState + engine state + torrent progress.
 * NOT persisted - computed on the fly.
 */
export type TorrentActivityState =
  | 'stopped'               // No network activity
  | 'checking'              // Verifying existing data on disk
  | 'downloading_metadata'  // Fetching .torrent info from peers
  | 'downloading'           // Actively downloading pieces
  | 'seeding'               // Complete, uploading to peers
  | 'error'                 // Something went wrong

/**
 * Compute activity state from torrent properties.
 */
export function computeActivityState(
  userState: TorrentUserState,
  engineSuspended: boolean,
  hasMetadata: boolean,
  isChecking: boolean,
  progress: number,
  hasError: boolean
): TorrentActivityState {
  // Engine suspended = everything stopped
  if (engineSuspended) return 'stopped'
  
  // User stopped or queued = stopped
  if (userState === 'stopped' || userState === 'queued') return 'stopped'
  
  // Error state
  if (hasError) return 'error'
  
  // Checking data
  if (isChecking) return 'checking'
  
  // No metadata yet
  if (!hasMetadata) return 'downloading_metadata'
  
  // Complete
  if (progress >= 1) return 'seeding'
  
  // Downloading
  return 'downloading'
}
```

## Task 2: Add Suspend/Resume to BtEngine

**Update file**: `packages/engine/src/core/bt-engine.ts`

Add suspension state and methods:

```typescript
export class BtEngine extends EngineComponent {
  // ... existing properties ...
  
  private _suspended: boolean = true  // Start suspended by default
  
  /**
   * Whether the engine is suspended (no network activity).
   */
  get isSuspended(): boolean {
    return this._suspended
  }
  
  /**
   * Suspend all network activity.
   * Torrents remain in their user state but stop all networking.
   * Use this during session restore or for "pause all" functionality.
   */
  suspend(): void {
    if (this._suspended) return
    
    this.logger.info('Suspending engine - stopping all network activity')
    this._suspended = true
    
    for (const torrent of this.torrents) {
      torrent.suspendNetwork()
    }
  }
  
  /**
   * Resume network activity.
   * Torrents with userState 'active' will start networking.
   * Torrents with userState 'stopped' or 'queued' remain stopped.
   */
  resume(): void {
    if (!this._suspended) return
    
    this.logger.info('Resuming engine - starting active torrents')
    this._suspended = false
    
    for (const torrent of this.torrents) {
      if (torrent.userState === 'active') {
        torrent.resumeNetwork()
      }
    }
  }
  
  // Update addTorrent to respect suspension
  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options: { storageToken?: string; userState?: TorrentUserState } = {},
  ): Promise<Torrent | null> {
    // ... existing torrent creation code ...
    
    // Set initial user state
    torrent.userState = options.userState ?? 'active'
    
    this.torrents.push(torrent)
    
    // Only start if engine not suspended AND user wants it active
    if (!this._suspended && torrent.userState === 'active') {
      torrent.start()
    }
    
    // Persist
    await this.sessionPersistence?.saveTorrentList()
    
    return torrent
  }
}
```

Also update the constructor to start suspended:

```typescript
constructor(options: BtEngineOptions) {
  // ... existing code ...
  
  // Start suspended - caller should call resume() after setup/restore
  this._suspended = true
  
  // Don't start server until resumed
  // Move this.startServer() call to resume() or make it respect suspension
}
```

## Task 3: Add State Management to Torrent

**Update file**: `packages/engine/src/core/torrent.ts`

Add imports:
```typescript
import { TorrentUserState, TorrentActivityState, computeActivityState } from './torrent-state'
```

Add properties and methods:

```typescript
export class Torrent extends EngineComponent {
  // ... existing properties ...
  
  /**
   * User's intent for this torrent - persisted.
   */
  public userState: TorrentUserState = 'active'
  
  /**
   * Queue position when userState is 'queued'.
   */
  public queuePosition?: number
  
  /**
   * Whether the torrent is currently checking data.
   */
  private _isChecking: boolean = false
  
  /**
   * Current error message if any.
   */
  public errorMessage?: string
  
  /**
   * Whether network is currently active for this torrent.
   */
  private _networkActive: boolean = false
  
  /**
   * Get the current activity state (derived, not persisted).
   */
  get activityState(): TorrentActivityState {
    return computeActivityState(
      this.userState,
      this.engine.isSuspended,
      this.hasMetadata,
      this._isChecking,
      this.progress,
      !!this.errorMessage
    )
  }
  
  /**
   * Whether this torrent has metadata (piece info, files, etc).
   */
  get hasMetadata(): boolean {
    return !!this.pieceManager
  }
  
  /**
   * User action: Start the torrent.
   * Changes userState to 'active' and starts networking if engine allows.
   */
  userStart(): void {
    this.logger.info('User starting torrent')
    this.userState = 'active'
    this.errorMessage = undefined
    
    if (!this.engine.isSuspended) {
      this.resumeNetwork()
    }
    
    // Persist state change
    this.engine.sessionPersistence?.saveTorrentList()
  }
  
  /**
   * User action: Stop the torrent.
   * Changes userState to 'stopped' and stops all networking.
   */
  userStop(): void {
    this.logger.info('User stopping torrent')
    this.userState = 'stopped'
    this.suspendNetwork()
    
    // Persist state change
    this.engine.sessionPersistence?.saveTorrentList()
  }
  
  /**
   * Internal: Suspend network activity.
   * Called by engine.suspend() or userStop().
   */
  suspendNetwork(): void {
    if (!this._networkActive) return
    
    this.logger.debug('Suspending network')
    this._networkActive = false
    
    // Stop tracker announces
    if (this.trackerManager) {
      this.trackerManager.stop()
    }
    
    // Close all peer connections
    for (const peer of this.peers) {
      peer.close()
    }
    this.peers = []
  }
  
  /**
   * Internal: Resume network activity.
   * Called by engine.resume() (for active torrents) or userStart().
   */
  resumeNetwork(): void {
    if (this._networkActive) return
    if (this.engine.isSuspended) return
    if (this.userState !== 'active') return
    
    this.logger.debug('Resuming network')
    this._networkActive = true
    
    // Start tracker announces
    if (this.trackerManager) {
      this.trackerManager.start()
    } else if (this.announce.length > 0) {
      // Initialize tracker manager if we have announces but no manager yet
      this.initTrackerManager()
    }
    
    // Note: Peer connections will come from tracker responses
  }
  
  /**
   * Start the torrent (internal, called after creation).
   * This is the existing start() method, renamed for clarity.
   */
  start(): void {
    if (this.engine.isSuspended) {
      this.logger.debug('Engine suspended, not starting')
      return
    }
    
    if (this.userState !== 'active') {
      this.logger.debug('User state is not active, not starting')
      return
    }
    
    this._networkActive = true
    
    // ... existing start logic (tracker init, etc) ...
  }
}
```

## Task 4: Update Session Persistence

**Update file**: `packages/engine/src/core/session-persistence.ts`

Add userState to persisted data:

```typescript
export interface TorrentSessionData {
  infoHash: string
  magnetLink?: string
  torrentFile?: string
  name?: string
  storageToken?: string
  addedAt: number
  
  // User state - NEW
  userState: TorrentUserState
  queuePosition?: number
}

// Update torrentToSessionData:
private torrentToSessionData(torrent: Torrent): TorrentSessionData {
  const infoHash = toHex(torrent.infoHash)
  const storageToken = this.engine.storageRootManager.getRootForTorrent(infoHash)
  
  return {
    infoHash,
    magnetLink: torrent.magnetLink,
    torrentFile: torrent.torrentFileBase64,
    name: torrent.name,
    storageToken,
    addedAt: torrent.addedAt || Date.now(),
    
    // Persist user state
    userState: torrent.userState,
    queuePosition: torrent.queuePosition,
  }
}

// Update restoreSession to restore userState:
async restoreSession(): Promise<number> {
  const torrents = await this.loadTorrentList()
  let restored = 0
  
  for (const data of torrents) {
    try {
      let torrent: Torrent | null = null
      
      if (data.magnetLink) {
        torrent = await this.engine.addTorrent(data.magnetLink, {
          storageToken: data.storageToken,
          userState: data.userState || 'active',  // Restore user state
        })
      } else if (data.torrentFile) {
        const buffer = this.base64ToUint8Array(data.torrentFile)
        torrent = await this.engine.addTorrent(buffer, {
          storageToken: data.storageToken,
          userState: data.userState || 'active',
        })
      }
      
      if (torrent) {
        // Restore queue position
        torrent.queuePosition = data.queuePosition
        
        // Load saved state (bitfield)
        const state = await this.loadTorrentState(data.infoHash)
        if (state && torrent.pieceManager) {
          torrent.pieceManager.restoreFromHex(state.bitfield)
          // Update bitfield reference
          torrent.bitfield = torrent.pieceManager.getBitField()
        }
        
        restored++
      }
    } catch (e) {
      console.error(`Failed to restore torrent ${data.infoHash}:`, e)
    }
  }
  
  return restored
}
```

## Task 5: Update Extension Client

**Update file**: `extension/src/lib/client.ts`

Update the initialization flow:

```typescript
async ensureDaemonReady(): Promise<ISockets> {
  if (this.ready && this.sockets) return this.sockets

  console.log('Ensuring daemon is ready...')
  await this.native.connect()

  // ... existing handshake code ...

  // Create engine (starts suspended by default)
  this.engine = new BtEngine({
    socketFactory: factory,
    storageRootManager: srm,
    sessionStore: store,
    onLog: (entry: LogEntry) => {
      this.logBuffer.add(entry)
    },
  })

  console.log('Daemon Engine initialized (suspended)')

  // Restore session BEFORE resuming
  const restored = await this.engine.restoreSession()
  console.log(`Restored ${restored} torrents from session`)

  // NOW resume - torrents with userState 'active' will start
  this.engine.resume()
  console.log('Engine resumed')

  this.sockets = this.engine.socketFactory as unknown as ISockets
  this.ready = true

  return this.sockets!
}
```

## Task 6: Add Torrent Control Methods to Client

**Update file**: `extension/src/lib/client.ts`

Add methods for UI to control torrents:

```typescript
/**
 * Start a torrent (set userState to 'active').
 */
startTorrent(infoHash: string): void {
  const torrent = this.engine?.getTorrent(infoHash)
  if (torrent) {
    torrent.userStart()
  }
}

/**
 * Stop a torrent (set userState to 'stopped').
 */
stopTorrent(infoHash: string): void {
  const torrent = this.engine?.getTorrent(infoHash)
  if (torrent) {
    torrent.userStop()
  }
}

/**
 * Pause all torrents (suspend engine).
 */
pauseAll(): void {
  this.engine?.suspend()
}

/**
 * Resume all torrents (resume engine).
 */
resumeAll(): void {
  this.engine?.resume()
}
```

## Task 7: Add Message Handlers in Service Worker

**Update file**: `extension/src/sw.ts`

Add handlers for torrent control:

```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ... existing handlers ...
  
  if (message.type === 'START_TORRENT') {
    client.startTorrent(message.infoHash)
    sendResponse({ ok: true })
    return true
  }
  
  if (message.type === 'STOP_TORRENT') {
    client.stopTorrent(message.infoHash)
    sendResponse({ ok: true })
    return true
  }
  
  if (message.type === 'PAUSE_ALL') {
    client.pauseAll()
    sendResponse({ ok: true })
    return true
  }
  
  if (message.type === 'RESUME_ALL') {
    client.resumeAll()
    sendResponse({ ok: true })
    return true
  }
})
```

## Task 8: Update Engine State to Include User State

**Update file**: `packages/engine/src/core/engine-state.ts`

Add userState and activityState to TorrentInfo:

```typescript
import { TorrentUserState, TorrentActivityState } from './torrent-state'

export interface TorrentInfo {
  // ... existing fields ...
  
  // States
  userState: TorrentUserState      // 'active' | 'stopped' | 'queued'
  activityState: TorrentActivityState  // 'downloading' | 'seeding' | etc
  queuePosition?: number
  
  // Remove the old 'state' field or keep for compatibility
}

// Update getTorrentInfo:
function getTorrentInfo(torrent: Torrent, engine: BtEngine): TorrentInfo {
  // ... existing code ...
  
  return {
    // ... existing fields ...
    
    userState: torrent.userState,
    activityState: torrent.activityState,
    queuePosition: torrent.queuePosition,
    
    // ... rest of fields ...
  }
}

// Also add engine suspension state:
export interface EngineInfo {
  // ... existing fields ...
  isSuspended: boolean
}

function getEngineInfo(engine: BtEngine): EngineInfo {
  return {
    // ... existing fields ...
    isSuspended: engine.isSuspended,
  }
}
```

## Task 9: Export New Types

**Update file**: `packages/engine/src/index.ts`

```typescript
// Torrent state
export type { TorrentUserState, TorrentActivityState } from './core/torrent-state'
export { computeActivityState } from './core/torrent-state'
```

## Task 10: Clean Up Old Code

Remove any existing `paused` boolean or `isPaused` property that was added by the previous fix. The new system uses:
- `userState` for user intent
- `activityState` (derived) for what's happening
- `engine.isSuspended` for global pause

Search for and remove:
- `torrent.isPaused`
- `torrent.paused`
- `options.paused` in addTorrent
- Any other ad-hoc pause logic

## Verification

```bash
# Build engine
cd packages/engine
pnpm build
pnpm test

# Build extension
cd ../../extension
pnpm build
```

Manual test:
1. Add a torrent, let it start downloading
2. Check DevTools: `chrome.runtime.sendMessage({type: 'GET_STATE'}, r => console.log(r.state.torrents[0].userState))` → should be 'active'
3. Stop the torrent via UI or: `chrome.runtime.sendMessage({type: 'STOP_TORRENT', infoHash: '...'})`
4. Check state again → userState should be 'stopped', activityState should be 'stopped'
5. Close Chrome, reopen
6. Check state → userState should still be 'stopped' (persisted)
7. Start torrent → should resume

Test session restore:
1. Add torrent, let it download some pieces
2. Close Chrome
3. Reopen - should see "Restored N torrents" BEFORE any tracker/peer logs
4. Torrent should have correct progress and continue from where it left off

## State Diagram

```
ENGINE LEVEL:
                    
  ┌──────────┐  resume()   ┌──────────┐
  │suspended │────────────►│ running  │
  │          │◄────────────│          │
  └──────────┘  suspend()  └──────────┘


TORRENT LEVEL (userState):

  ┌──────────┐                    
  │  queued  │◄─────────────┐     
  └────┬─────┘              │     
       │ slot available     │ queue full
       ▼                    │     
  ┌──────────┐  userStop() ┌┴─────────┐
  │  active  │────────────►│ stopped  │
  │          │◄────────────│          │
  └────┬─────┘ userStart() └──────────┘
       │                         ▲
       │ progress >= 1           │
       │ (auto, stays 'active')  │
       ▼                         │
  ┌──────────┐                   │
  │ (seeding)│───────────────────┘
  └──────────┘  userStop() or ratio reached


ACTIVITY STATE (derived):

  activityState = f(userState, engine.isSuspended, hasMetadata, progress, error)
  
  - engine.isSuspended=true → 'stopped'
  - userState='stopped'     → 'stopped'  
  - userState='queued'      → 'stopped'
  - error                   → 'error'
  - checking                → 'checking'
  - !hasMetadata            → 'downloading_metadata'
  - progress >= 1           → 'seeding'
  - else                    → 'downloading'
```

## Summary

**New file:**
- `packages/engine/src/core/torrent-state.ts` - State types and computation

**Updated files:**
- `packages/engine/src/core/bt-engine.ts` - Add suspend/resume, start suspended
- `packages/engine/src/core/torrent.ts` - Add userState, activityState, suspendNetwork/resumeNetwork
- `packages/engine/src/core/session-persistence.ts` - Persist userState
- `packages/engine/src/core/engine-state.ts` - Include states in snapshot
- `packages/engine/src/index.ts` - Export new types
- `extension/src/lib/client.ts` - Proper init flow with suspend/restore/resume
- `extension/src/sw.ts` - Add control message handlers

**Key behaviors:**
- Engine starts suspended
- Session restore happens while suspended (no network)
- resume() starts only torrents with userState='active'
- userState persists across restarts
- activityState is always computed, never persisted
