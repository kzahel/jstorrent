# @jstorrent/client

Glue layer between `@jstorrent/engine` and UI frameworks. Handles Chrome extension bridges, engine lifecycle, and provides React context/hooks.

## Architecture

```
@jstorrent/client
├── adapters/        # Engine access patterns
│   └── types.ts     # EngineAdapter interface
├── chrome/          # Chrome extension specific
│   ├── engine-manager.ts      # Engine lifecycle, daemon connection
│   ├── extension-bridge.ts    # Content script ↔ background messaging
│   └── notification-bridge.ts # Download notifications
├── context/
│   └── EngineContext.tsx      # React context provider
└── hooks/
    └── useEngineState.ts      # React hook for engine state
```

## EngineAdapter Interface

The adapter pattern abstracts engine access for different environments:

```ts
interface EngineAdapter {
  readonly torrents: Torrent[]
  readonly numConnections: number
  
  addTorrent(data: string | Uint8Array, opts?: AddTorrentOptions): Promise<Torrent | null>
  removeTorrent(torrent: Torrent): Promise<void>
  getTorrent(hash: string): Torrent | undefined
  
  on(event: string, callback: Function): void
  off(event: string, callback: Function): void
  destroy(): void
}
```

| Implementation | Use Case |
|---------------|----------|
| DirectEngineAdapter | Engine in same JS heap (extension, website, Android) |
| RpcEngineAdapter | Engine over HTTP/WebSocket (iOS, remote control) |

## Chrome Extension Usage

```tsx
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'

// Initialize engine (connects to io-daemon)
const engine = await engineManager.init()

// Wrap app
<EngineProvider engine={engine}>
  <App />
</EngineProvider>

// In components
function MyComponent() {
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  
  // adapter.torrents updates live (read by Solid RAF loop)
  // torrents is React state snapshot (for conditionals)
}
```

## Engine Manager

`engineManager` handles:

- Daemon WebSocket connection
- Engine instantiation with browser adapters
- Session persistence setup
- Storage root initialization

```ts
// Singleton - call once at app startup
const engine = await engineManager.init()

// Access anywhere after init
engineManager.engine  // BtEngine instance
```

## Extension Bridge

For communication between extension contexts:

```ts
import { extensionBridge } from '@jstorrent/client'

// In popup/tab - relay messages to service worker
extensionBridge.sendToBackground({ type: 'ADD_TORRENT', magnet: '...' })

// In service worker - handle messages
extensionBridge.onMessage((msg) => { ... })
```

## Notification Bridge

Desktop notifications for download events:

```ts
import { notificationBridge } from '@jstorrent/client'

// Setup listeners
notificationBridge.init(engine)

// Triggers notifications on:
// - Download complete
// - Metadata received (for magnet links)
```

## React Context

`EngineContext` provides:

```ts
{
  engine: BtEngine           // Raw engine instance
  adapter: EngineAdapter     // Abstracted access
}
```

## useEngineState Hook

Returns reactive state for React components:

```ts
const {
  adapter,           // For passing to Solid tables
  torrents,          // Torrent[] snapshot (React state)
  numConnections,    // number
  globalStats: {
    totalDownloadRate,  // bytes/sec
    totalUploadRate,    // bytes/sec
  }
} = useEngineState()
```

**Note:** `torrents` is a React state snapshot, updated periodically. For live 60fps updates, Solid tables read `adapter.torrents` directly via RAF loop.

## Environment Support

| Environment | Adapter | Notes |
|------------|---------|-------|
| Chrome Extension | Direct | Engine + daemon in extension process |
| jstorrent.com | Direct | Engine in page, relayed to extension |
| iOS App | RPC | SwiftUI frontend, engine on desktop |
| Android App | Direct | Engine in React Native (Hermes) |

## No Node.js APIs

This package is browser-only. ESLint enforces `import/no-nodejs-modules`.
