# JSTorrent Extension — Architecture Document

**Last Updated**: November 2025  
**Status**: Current implementation overview

This document describes the Chrome MV3 extension component of the JSTorrent monorepo, including its architecture, build system, and integration with the native host stack.

---

## 1. Overview

The JSTorrent extension is a Chrome Manifest V3 extension that serves as the frontend and coordination layer for the JSTorrent BitTorrent client. It communicates with native Rust binaries via Chrome's native messaging API to perform privileged I/O operations (networking, filesystem access).

**Key Characteristics:**
- MV3-compliant (service worker-based, no persistent background page)
- TypeScript + React for UI
- Vite for bundling
- HMR available via localhost dev server (see main README for dev mode setup)
- Part of pnpm monorepo workspace

---

## 2. Repository Location

```
jstorrent-monorepo/
└── extension/           ← This component
    ├── src/
    ├── public/
    ├── test/
    ├── e2e/
    ├── package.json
    └── DESIGN.md        ← This file
```

The extension is a workspace package in the monorepo. Use `pnpm --filter extension <command>` to run commands.

---

## 3. Architecture

### 3.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker Thread                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ DaemonLifecycleManager                                  ││
│  │  - Keeps connectNative alive while UI tabs exist        ││
│  │  - Returns DaemonInfo on request                        ││
│  │  - Handles pickDownloadFolder (needs native host)       ││
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
│  │ React UI     │◀──│ BTEngine   │──▶│ DaemonConnection │  │
│  └──────────────┘   └────────────┘   └──────────────────┘  │
│        ▲                  │                                 │
│        └──────────────────┘                                 │
│         Same heap - zero serialization                      │
└─────────────────────────────────────────────────────────────┘
```

**Note:** BTEngine runs in the UI thread (not service worker) for better performance.
See `docs/design/move-btengine-to-ui-thread.md` for the detailed design rationale.

### 3.2 Key Components

#### Service Worker (`src/sw.ts`)
- Entry point for the extension
- Handles installation, external messages
- Manages daemon lifecycle via `DaemonLifecycleManager`
- Opens UI tab when torrents are added

#### DaemonLifecycleManager (`src/lib/daemon-lifecycle-manager.ts`)
- Keeps `connectNative` alive while UI tabs exist
- Returns DaemonInfo (port, token, roots) to UI
- Handles `pickDownloadFolder` (requires native host)
- Closes native connection after grace period when all UIs close

#### NativeHostConnection (`src/lib/native-connection.ts`)
- Wraps `chrome.runtime.connectNative('com.jstorrent.native')`
- Simple message passing interface
- Used only for handshake and coordination (not data transfer)

#### DaemonConnection (`src/lib/daemon-connection.ts`)
- WebSocket connection to io-daemon
- Implements binary protocol handshake (CLIENT_HELLO → SERVER_HELLO → AUTH → AUTH_RESULT)
- Handles frame-based communication

#### Sockets (`src/lib/sockets.ts`)
- High-level TCP/UDP socket abstraction
- Multiplexes multiple sockets over single WebSocket
- Implements the protocol defined in `design_docs/io-daemon-websocket-detail.md`
- Provides `ITcpSocket` and `IUdpSocket` interfaces

#### UI (`src/ui/app.tsx`)
- Currently a minimal debug interface
- Displays event log for development
- Will be expanded to full torrent management UI

---

## 4. File Structure

```
extension/
├── src/
│   ├── sw.ts                    # Service worker entry point
│   ├── lib/
│   │   ├── client.ts            # Main client orchestrator
│   │   ├── daemon-connection.ts # WebSocket to io-daemon
│   │   ├── native-connection.ts # Native messaging wrapper
│   │   └── sockets.ts           # TCP/UDP socket abstraction
│   ├── ui/
│   │   ├── app.html             # UI page HTML
│   │   └── app.tsx              # React UI component
│   └── magnet/
│       ├── magnet-handler.html  # Magnet link handler page
│       └── magnet-handler.ts    # Magnet handler logic (stub)
├── public/
│   ├── manifest.json            # MV3 manifest
│   ├── icons/                   # Extension icons
│   └── images/                  # Additional images
├── test/
│   ├── setup.ts                 # Vitest global setup
│   ├── mocks/
│   │   ├── mock-chrome.ts       # Chrome API mocks
│   │   └── mock-native-host.ts  # Native host mocks
│   └── unit/
│       └── example.unit.test.ts # Example unit test
├── e2e/
│   ├── playwright.config.ts     # Playwright configuration
│   ├── fixtures.ts              # Test fixtures
│   ├── extension.spec.ts        # Basic extension tests
│   ├── io-daemon.spec.ts        # Daemon integration tests
│   └── browser-discovery.spec.ts # Browser discovery tests
├── package.json
├── tsconfig.json
├── vite.config.js
└── vitest.config.ts
```

---

## 5. Build System

### 5.1 Vite Configuration

The extension uses Vite for bundling with these characteristics:
- Multi-entry build (service worker + HTML pages)
- Dev server with HMR available on `http://local.jstorrent.com:3001`
- Sourcemaps enabled
- Non-minified output for debugging

### 5.2 Commands

**From monorepo root:**
```bash
pnpm install                     # Install all dependencies
pnpm --filter extension build    # Build extension
pnpm --filter extension dev      # Watch mode + dev server
pnpm --filter extension test     # Unit tests
pnpm --filter extension test:e2e # Playwright tests
```

**Or from `extension/` directory:**
```bash
pnpm build          # Build to dist/
pnpm dev            # Both: extension watch + web dev server
pnpm dev:extension  # Extension build watch only
pnpm dev:web        # Web dev server with HMR only
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright integration tests
```

**Dev Mode Setup:** See main README for prerequisites (hosts file, DEV_ORIGINS).

### 5.3 Loading in Chrome

1. Build the extension: `pnpm build`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `extension/dist/`

---

## 6. Manifest Configuration

Key manifest.json settings:

```json
{
  "manifest_version": 3,
  "permissions": [
    "nativeMessaging",   // Connect to native host
    "storage",           // Store install ID, preferences
    "tabs"               // Open/focus UI tab
  ],
  "background": {
    "service_worker": "sw.js",
    "type": "module"     // ESM support
  },
  "externally_connectable": {
    "matches": [
      "https://jstorrent.com/*",
      "https://new.jstorrent.com/*",
      "http://local.jstorrent.com/*"
    ]
  }
}
```

The `externally_connectable` setting allows:
- JSTorrent website: Detect extension, send "launch-ping", trigger torrent additions
- Dev server (`http://local.jstorrent.com:3001`): Run UI with HMR for development

---

## 7. Data Flow

### 7.1 Extension Initialization (on launch-ping)

```
Website                    Extension                    Native Stack
   │                           │                            │
   │ ──launch-ping────────────▶│                            │
   │                           │                            │
   │                           │ connectNative()            │
   │                           │ ─────────────────────────▶ │ native-host
   │                           │                            │
   │                           │ { op: "handshake" }        │
   │                           │ ─────────────────────────▶ │
   │                           │                            │
   │                           │    DaemonInfo              │ spawns
   │                           │ ◀───────────────────────── │ io-daemon
   │                           │                            │
   │                           │ WebSocket connect          │
   │                           │ ─────────────────────────▶ │ io-daemon
   │                           │                            │
   │                           │ AUTH handshake             │
   │                           │ ◀─────────────────────────▶│
   │                           │                            │
   │ ◀─── { ok: true } ────────│                            │
   │                           │                            │
```

### 7.2 Socket Operation (e.g., TCP connect to peer)

```
Extension                              io-daemon
    │                                      │
    │ TCP_CONNECT (socketId, host, port)   │
    │ ────────────────────────────────────▶│
    │                                      │
    │ TCP_CONNECTED (socketId, status)     │
    │ ◀────────────────────────────────────│
    │                                      │
    │ TCP_SEND (socketId, data)            │
    │ ────────────────────────────────────▶│
    │                                      │
    │ TCP_RECV (socketId, data)            │
    │ ◀────────────────────────────────────│
    │                                      │
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

- **Framework**: Vitest with happy-dom
- **Location**: `test/unit/`
- **Mocks**: Chrome APIs mocked in `test/mocks/`
- **Run**: `pnpm test`

### 8.2 Integration Tests (Playwright)

- **Framework**: Playwright with Chromium
- **Location**: `e2e/`
- **Requirements**: Native host must be installed locally
- **Run**: `pnpm test:e2e`

Playwright loads the extension using:
```
--load-extension=dist
--disable-extensions-except=dist
```

### 8.3 Manual Testing

1. Build and load extension
2. Install native host locally:
   - Linux: `./native-host/scripts/install-local-linux.sh`
   - macOS: `./native-host/scripts/install-local-macos.sh`
3. Navigate to `https://new.jstorrent.com/launch`
4. Click to send launch-ping
5. Extension UI should open showing event log

---

## 9. Current Implementation State

### Implemented ✅
- Service worker with external message handling
- Native host connection and handshake
- io-daemon WebSocket connection with AUTH
- Binary protocol framing
- TCP/UDP socket abstraction
- Basic event-log UI
- E2E test infrastructure

### In Progress 🚧
- Full torrent management UI
- BitTorrent engine integration (from `packages/engine`)
- Download progress display
- Settings/preferences UI

### Planned 📋
- Magnet link handling (via link-handler → website → extension)
- .torrent file handling
- Download root selection UI
- Notification support
- Multiple torrent management

---

## 10. Integration with Monorepo

### 10.1 Workspace Dependencies

The extension can depend on other workspace packages:
- `@jstorrent/engine` - Core BitTorrent engine (planned)
- `@jstorrent/shared-ts` - Shared types and utilities (planned)

### 10.2 Shared Configuration

- ESLint: Uses root `eslint.config.js`
- TypeScript: Extends root `tsconfig.json`
- Prettier: Uses root `.prettierrc`

### 10.3 CI/CD

Extension CI runs on changes to:
- `extension/**`
- `packages/**`

See `.github/workflows/extension-ci.yml`

---

## 11. Security Considerations

### 11.1 Native Messaging Security

- Native host registered via Chrome's native messaging manifest
- Host validates extension ID before responding
- Install ID provides per-profile isolation

### 11.2 io-daemon Security

- Binds to localhost only (127.0.0.1)
- Requires auth token for all operations
- Token communicated via native messaging (not over network)

### 11.3 Download Roots

- Opaque tokens (SHA1-based) instead of raw paths
- Token verified by io-daemon on every operation
- Path traversal prevented by native host validation

---

## 12. Related Documentation

- `docs/design/move-btengine-to-ui-thread.md` - BTEngine in UI thread design
- `native-host/DESIGN.md` - Native stack architecture
- `design_docs/io-daemon-websocket-detail.md` - Binary protocol spec
- `packages/engine/docs/ARCHITECTURE-current.md` - BitTorrent engine
- `.github/copilot-instructions.md` - AI coding context

---

## Appendix: Message Types

### External Messages (from website)

```typescript
{ type: "launch-ping" }  // Wake extension, init native stack
```

### Internal Messages (SW ↔ UI)

```typescript
{ event: "magnetAdded", ... }   // Magnet link added
{ event: "torrentAdded", ... }  // Torrent file added
```

### Native Host Messages

```typescript
// Extension → Native Host
{ op: "handshake", extensionId, installId, id }

// Native Host → Extension
{ type: "DaemonInfo", payload: { port, token, version } }
```
