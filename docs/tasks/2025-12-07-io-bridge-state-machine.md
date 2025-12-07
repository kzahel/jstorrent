# IO Bridge State Machine Implementation

## Overview

Replace the implicit connection state in `DaemonLifecycleManager` with an explicit state machine that handles both desktop (native messaging) and ChromeOS (Android HTTP) platforms cleanly.

**Goals:**
- Explicit state machine with typed states and events
- Platform-specific adapters (Desktop, ChromeOS, Mock)
- Testable architecture with mock adapter
- Clear separation: pure state logic vs side effects vs platform I/O

**Non-goals:**
- Changing the underlying `DaemonConnection` WebSocket/HTTP client in `packages/engine`
- Modifying the Android app or native-host Rust code

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  extension/src/lib/io-bridge/                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  types.ts                 ← Shared types (DaemonInfo, etc.)                 │
│  io-bridge-state.ts       ← Pure state machine (states, events, transition) │
│  io-bridge-store.ts       ← StateStore (holds state, notifies listeners)    │
│  io-bridge-effects.ts     ← Side effect runner (async ops, timers)          │
│  io-bridge-adapter.ts     ← IIOBridgeAdapter interface                      │
│  index.ts                 ← Public exports                                  │
│                                                                             │
│  adapters/                                                                  │
│    desktop-adapter.ts     ← Native messaging (Win/Mac/Linux)                │
│    chromeos-adapter.ts    ← HTTP to Android container                       │
│    mock-adapter.ts        ← For unit tests                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## State Machine Design

### States

```
INITIALIZING
    │
    │ START
    ▼
PROBING ─────────────────────────────────────────┐
    │                                            │
    ├── PROBE_SUCCESS ──► CONNECTED              │
    │                                            │
    └── PROBE_FAILED                             │
            │                                    │
            ├── (desktop) ──► INSTALL_PROMPT     │
            │                      │             │
            │                      │ RETRY       │
            │                      └─────────────┤
            │                                    │
            └── (chromeos) ──► LAUNCH_PROMPT     │
                                   │             │
                                   │ USER_LAUNCH │
                                   ▼             │
                            AWAITING_LAUNCH      │
                                   │             │
                    ┌──────────────┼──────────┐  │
                    │              │          │  │
                    │ DAEMON_      │ LAUNCH_  │  │
                    │ CONNECTED    │ TIMEOUT  │  │
                    │              │          │  │
                    ▼              │          ▼  │
                CONNECTED          │   LAUNCH_FAILED
                    │              │          │  │
                    │              │          │ RETRY
                    │              │          └──┤
                    │              │             │
                    │ DAEMON_DISCONNECTED       │
                    ▼                            │
                DISCONNECTED                     │
                    │                            │
                    │ RETRY                      │
                    └────────────────────────────┘
```

### State Data

| State | Data |
|-------|------|
| `INITIALIZING` | (none) |
| `PROBING` | `platform`, `history` |
| `CONNECTED` | `platform`, `connectionId`, `daemonInfo` |
| `DISCONNECTED` | `platform`, `history`, `wasHealthy` |
| `INSTALL_PROMPT` | `platform: 'desktop'`, `history` |
| `LAUNCH_PROMPT` | `platform: 'chromeos'`, `history` |
| `AWAITING_LAUNCH` | `platform: 'chromeos'`, `history`, `startedAt` |
| `LAUNCH_FAILED` | `platform: 'chromeos'`, `history` |

### Events

| Event | Data | Triggered By |
|-------|------|--------------|
| `START` | `platform`, `history` | Effect runner on init |
| `PROBE_SUCCESS` | `connectionId`, `daemonInfo` | Adapter probe succeeded |
| `PROBE_FAILED` | (none) | Adapter probe failed |
| `USER_LAUNCH` | (none) | User clicked launch button |
| `USER_CANCEL` | (none) | User cancelled launch |
| `DAEMON_CONNECTED` | `connectionId`, `daemonInfo` | Daemon came up after launch |
| `DAEMON_DISCONNECTED` | `wasHealthy` | Connection lost |
| `LAUNCH_TIMEOUT` | (none) | 30s timer expired |
| `RETRY` | (none) | User clicked retry |

### Platform Differences

| Aspect | Desktop | ChromeOS |
|--------|---------|----------|
| `probe()` | Auto-launches native host | Only checks if daemon running |
| After `PROBE_FAILED` | → `INSTALL_PROMPT` | → `LAUNCH_PROMPT` |
| `triggerLaunch()` | No-op | Opens intent URL |
| States reachable | No `LAUNCH_*` states | No `INSTALL_PROMPT` |

---

## Implementation Phases

### Phase 1: Pure State Machine + Types

Create the core state machine with no dependencies. Fully testable in isolation.

**Files to create:**
- `extension/src/lib/io-bridge/types.ts`
- `extension/src/lib/io-bridge/io-bridge-state.ts`

**Verification:** Unit tests pass for all state transitions.

---

### Phase 2: Store + Mock Adapter + Effect Runner

Create the infrastructure for running the state machine with side effects.

**Files to create:**
- `extension/src/lib/io-bridge/io-bridge-store.ts`
- `extension/src/lib/io-bridge/io-bridge-adapter.ts`
- `extension/src/lib/io-bridge/adapters/mock-adapter.ts`
- `extension/src/lib/io-bridge/io-bridge-effects.ts`

**Verification:** Integration tests pass using mock adapter.

---

### Phase 3: Desktop Adapter

Implement the real desktop adapter using native messaging.

**Files to create:**
- `extension/src/lib/io-bridge/adapters/desktop-adapter.ts`

**🔴 CHECKPOINT: Manual verification on Linux**
- Extension loads
- Native host launches automatically
- State transitions: INITIALIZING → PROBING → CONNECTED
- Disconnection handling works

---

### Phase 4: ChromeOS Adapter

Implement the ChromeOS adapter using HTTP to Android container.

**Files to create:**
- `extension/src/lib/io-bridge/adapters/chromeos-adapter.ts`

**🔴 CHECKPOINT: Manual verification on ChromeOS**
- Extension loads, shows LAUNCH_PROMPT
- Clicking launch opens Android app picker
- After approval: AWAITING_LAUNCH → CONNECTED
- Timeout works if user cancels dialog

---

### Phase 5: Integration + Migration

Wire the new IO Bridge into the extension, replacing `DaemonLifecycleManager`.

**Files to modify:**
- `extension/src/sw.ts`
- `extension/src/lib/daemon-lifecycle-manager.ts` (delete or deprecate)

**Files to create:**
- `extension/src/lib/io-bridge/index.ts`

**🔴 CHECKPOINT: Full manual verification**
- Linux: Full flow works
- ChromeOS: Full flow works
- Both: Reconnection after disconnect works
