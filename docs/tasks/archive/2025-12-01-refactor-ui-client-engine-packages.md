# JSTorrent Package Restructure Plan

## Context

We're splitting the monorepo to enable code sharing between extension, website, and future mobile apps.

**Current structure:**
```
extension/src/ui/          # React UI + chrome-specific glue
packages/engine/           # BitTorrent protocol
```

**Target structure:**
```
packages/engine/           # BitTorrent protocol (unchanged)
packages/client/           # Engine adapters, chrome bridges, React context/hooks  
packages/ui/               # Pure presentational components
extension/src/ui/          # Entry points only, composes packages
```

---

## Phase 1: Create packages/ui

### 1.1 Create directory structure

```bash
mkdir -p packages/ui/src/{components,tables,utils}
```

### 1.2 Create packages/ui/package.json

```json
{
  "name": "@jstorrent/ui",
  "version": "0.0.1",
  "description": "JSTorrent UI components",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./src/styles.css"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jstorrent/engine": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "typescript": "^5.2.2"
  }
}
```

### 1.3 Create packages/ui/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 1.4 Create packages/ui/src/utils/format.ts

```ts
/**
 * Format bytes as human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Format bytes per second as speed string (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s'
}

/**
 * Format percentage (0-1) as string (e.g., "67.5%")
 */
export function formatPercent(ratio: number, decimals = 1): string {
  return (ratio * 100).toFixed(decimals) + '%'
}

/**
 * Format seconds as duration string (e.g., "2h 15m", "5m 30s")
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '∞'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}
```

### 1.5 Create packages/ui/src/components/TorrentItem.tsx

Copy from `extension/src/ui/components/TorrentItem.tsx` but update the import:

```tsx
import React, { useState, useRef, useEffect } from 'react'
import { Torrent } from '@jstorrent/engine'
import { formatBytes } from '../utils/format'

const iconButtonStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  padding: 0,
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
}

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  zIndex: 100,
  minWidth: '150px',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'none',
  color: 'var(--text-primary)',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '13px',
}

export interface TorrentItemProps {
  torrent: Torrent
  onStart?: (torrent: Torrent) => void
  onStop?: (torrent: Torrent) => void
  onDelete?: (torrent: Torrent) => void
  onRecheck?: (torrent: Torrent) => void
  onReset?: (torrent: Torrent) => void
  onShare?: (torrent: Torrent) => void
}

export const TorrentItem: React.FC<TorrentItemProps> = ({
  torrent,
  onStart,
  onStop,
  onDelete,
  onRecheck,
  onReset,
  onShare,
}) => {
  const isStopped = torrent.userState === 'stopped'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const handleMenuAction = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return (
    <li
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '12px',
        marginBottom: '8px',
        cursor: 'pointer',
      }}
      onClick={() => console.log(torrent)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold' }}>{torrent.name || 'Loading metadata...'}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {torrent.activityState} | {(torrent.progress * 100).toFixed(1)}% | {torrent.numPeers}{' '}
            peers | {torrent.files.length} files |{' '}
            {formatBytes(torrent.contentStorage?.getTotalSize() || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {formatBytes(torrent.downloadSpeed)}/s | {formatBytes(torrent.uploadSpeed)}/s
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {isStopped ? (
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                onStart?.(torrent)
              }}
              title="Start"
            >
              ▶
            </button>
          ) : (
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                onStop?.(torrent)
              }}
              title="Stop"
            >
              ⏸
            </button>
          )}
          <button
            style={{ ...iconButtonStyle, color: 'var(--accent-error)' }}
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(torrent)
            }}
            title="Delete"
          >
            ✕
          </button>
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              title="More actions"
            >
              ☰
            </button>
            {menuOpen && (
              <div style={dropdownMenuStyle}>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onRecheck?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Re-verify Data
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onReset?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Reset State
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onShare?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Share Link
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          height: '4px',
          background: 'var(--progress-bg)',
          borderRadius: '2px',
          marginTop: '8px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${torrent.progress * 100}%`,
            background:
              torrent.activityState === 'seeding'
                ? 'var(--accent-success)'
                : 'var(--accent-primary)',
            borderRadius: '2px',
          }}
        />
      </div>
    </li>
  )
}
```

### 1.6 Copy styles.css

```bash
cp extension/src/ui/styles.css packages/ui/src/styles.css
```

### 1.7 Create packages/ui/src/index.ts

```ts
// Components
export { TorrentItem } from './components/TorrentItem'
export type { TorrentItemProps } from './components/TorrentItem'

// Utils
export * from './utils/format'
```

---

## Phase 2: Create packages/client

### 2.1 Create directory structure

```bash
mkdir -p packages/client/src/{adapters,chrome,context,hooks}
```

### 2.2 Create packages/client/package.json

```json
{
  "name": "@jstorrent/client",
  "version": "0.0.1",
  "description": "JSTorrent client adapters and React integration",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jstorrent/engine": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.1.31",
    "@types/react": "^18.2.37",
    "typescript": "^5.2.2"
  }
}
```

### 2.3 Create packages/client/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 2.4 Create packages/client/src/adapters/types.ts

```ts
import { BtEngine, Torrent } from '@jstorrent/engine'

/**
 * Abstract interface for engine access.
 * Allows UI to work with direct engine or RPC client.
 */
export interface EngineAdapter {
  /** All torrents in the engine */
  readonly torrents: Torrent[]

  /** Total number of peer connections */
  readonly numConnections: number

  /** Add a torrent from magnet link or .torrent buffer */
  addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options?: { userState?: 'active' | 'stopped' },
  ): Promise<Torrent | null>

  /** Remove a torrent */
  removeTorrent(torrent: Torrent): Promise<void>

  /** Get torrent by info hash string */
  getTorrent(infoHash: string): Torrent | undefined

  /** Subscribe to engine events */
  on(event: string, callback: (...args: unknown[]) => void): void

  /** Unsubscribe from engine events */
  off(event: string, callback: (...args: unknown[]) => void): void

  /** Clean up resources */
  destroy(): void
}

/**
 * Adapter that wraps a direct BtEngine instance.
 * Used when engine runs in the same JS heap.
 */
export class DirectEngineAdapter implements EngineAdapter {
  constructor(private engine: BtEngine) {}

  get torrents(): Torrent[] {
    return this.engine.torrents
  }

  get numConnections(): number {
    return this.engine.numConnections
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options?: { userState?: 'active' | 'stopped' },
  ): Promise<Torrent | null> {
    return this.engine.addTorrent(magnetOrBuffer, options)
  }

  async removeTorrent(torrent: Torrent): Promise<void> {
    await this.engine.removeTorrent(torrent)
  }

  getTorrent(infoHash: string): Torrent | undefined {
    return this.engine.getTorrent(infoHash)
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.engine.on(event as Parameters<typeof this.engine.on>[0], callback as () => void)
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.engine.off(event as Parameters<typeof this.engine.off>[0], callback as () => void)
  }

  destroy(): void {
    this.engine.destroy()
  }
}
```

### 2.5 Move chrome files

```bash
mv extension/src/ui/lib/extension-bridge.ts packages/client/src/chrome/extension-bridge.ts
mv extension/src/ui/lib/notification-bridge.ts packages/client/src/chrome/notification-bridge.ts
mv extension/src/ui/lib/engine-manager.ts packages/client/src/chrome/engine-manager.ts
```

### 2.6 Update imports in moved chrome files

In `packages/client/src/chrome/engine-manager.ts`, the imports should stay the same since they reference `@jstorrent/engine` and local files. Update the local imports:

```ts
// Change:
import { getBridge } from './extension-bridge'
import { notificationBridge, ProgressStats } from './notification-bridge'

// These should still work as-is since they're relative imports in the same directory
```

### 2.7 Create packages/client/src/context/EngineContext.tsx

```tsx
import { createContext, useContext, ReactNode } from 'react'
import { BtEngine } from '@jstorrent/engine'
import { EngineAdapter, DirectEngineAdapter } from '../adapters/types'

interface EngineContextValue {
  adapter: EngineAdapter
}

const EngineContext = createContext<EngineContextValue | null>(null)

export interface EngineProviderProps {
  /** Provide either a BtEngine (will be wrapped) or an EngineAdapter directly */
  engine?: BtEngine
  adapter?: EngineAdapter
  children: ReactNode
}

/**
 * Provides engine adapter to descendant components.
 */
export function EngineProvider({ engine, adapter, children }: EngineProviderProps) {
  const resolvedAdapter = adapter ?? (engine ? new DirectEngineAdapter(engine) : null)

  if (!resolvedAdapter) {
    throw new Error('EngineProvider requires either engine or adapter prop')
  }

  return <EngineContext.Provider value={{ adapter: resolvedAdapter }}>{children}</EngineContext.Provider>
}

/**
 * Access the engine adapter from context.
 * Must be used within an EngineProvider.
 */
export function useAdapter(): EngineAdapter {
  const context = useContext(EngineContext)
  if (!context) {
    throw new Error('useAdapter must be used within an EngineProvider')
  }
  return context.adapter
}

/**
 * Legacy hook for direct engine access.
 * Prefer useAdapter() for new code.
 */
export function useEngine(): BtEngine {
  const adapter = useAdapter()
  // This cast is safe when using DirectEngineAdapter
  // For RPC adapter, this would need different handling
  return (adapter as DirectEngineAdapter)['engine']
}
```

### 2.8 Create packages/client/src/hooks/useEngineState.ts

```ts
import { useState, useEffect, useCallback } from 'react'
import { Torrent } from '@jstorrent/engine'
import { useAdapter } from '../context/EngineContext'

/**
 * Hook for reactive engine state updates.
 * Uses direct heap access + event subscriptions instead of polling.
 */
export function useEngineState() {
  const adapter = useAdapter()
  const [, forceUpdate] = useState({})

  // Force re-render on engine events
  const refresh = useCallback(() => {
    forceUpdate({})
  }, [])

  useEffect(() => {
    // Subscribe to engine events that affect UI
    const engineEvents = ['torrent', 'torrent-complete', 'torrent-removed', 'error']

    for (const event of engineEvents) {
      adapter.on(event, refresh)
    }

    // Also refresh periodically for stats (download/upload rates)
    const interval = setInterval(refresh, 1000)

    return () => {
      for (const event of engineEvents) {
        adapter.off(event, refresh)
      }
      clearInterval(interval)
    }
  }, [adapter, refresh])

  // Compute global stats by summing from all torrents
  const torrents = adapter.torrents
  let totalDownloadRate = 0
  let totalUploadRate = 0
  for (const t of torrents) {
    totalDownloadRate += t.downloadSpeed
    totalUploadRate += t.uploadSpeed
  }

  return {
    adapter,
    torrents,
    numConnections: adapter.numConnections,
    globalStats: {
      totalDownloadRate,
      totalUploadRate,
    },
  }
}

/**
 * Hook for a single torrent's state.
 * More efficient for detail views.
 */
export function useTorrentState(infoHash: string): Torrent | null {
  const adapter = useAdapter()
  const [, forceUpdate] = useState({})

  useEffect(() => {
    const refresh = () => forceUpdate({})

    // Subscribe to events for this specific torrent
    const handler = (torrent: Torrent) => {
      const torrentInfoHash = Array.from(torrent.infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (torrentInfoHash === infoHash) {
        refresh()
      }
    }

    adapter.on('torrent', handler)
    adapter.on('torrent-complete', handler)

    const interval = setInterval(refresh, 1000)

    return () => {
      adapter.off('torrent', handler)
      adapter.off('torrent-complete', handler)
      clearInterval(interval)
    }
  }, [adapter, infoHash])

  return adapter.getTorrent(infoHash) ?? null
}
```

### 2.9 Create packages/client/src/index.ts

```ts
// Adapters
export { DirectEngineAdapter } from './adapters/types'
export type { EngineAdapter } from './adapters/types'

// Chrome extension specific
export { engineManager } from './chrome/engine-manager'
export type { DaemonInfo, DownloadRoot } from './chrome/engine-manager'
export { getBridge } from './chrome/extension-bridge'
export { notificationBridge } from './chrome/notification-bridge'
export type { ProgressStats } from './chrome/notification-bridge'

// React integration
export { EngineProvider, useAdapter, useEngine } from './context/EngineContext'
export type { EngineProviderProps } from './context/EngineContext'
export { useEngineState, useTorrentState } from './hooks/useEngineState'
```

---

## Phase 3: Update ESLint Config

Edit `eslint.config.js` and add these rules after the existing engine rules (around line 78, before prettierConfig):

```js
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-nodejs-modules': 'error',
    },
  },
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-nodejs-modules': 'error',
    },
  },
```

---

## Phase 4: Update Extension

### 4.1 Update extension/package.json

Add the new workspace dependencies:

```json
{
  "dependencies": {
    "@jstorrent/client": "workspace:*",
    "@jstorrent/engine": "workspace:*",
    "@jstorrent/ui": "workspace:*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
```

Note: `@jstorrent/engine` should already be there implicitly, but add `@jstorrent/client` and `@jstorrent/ui`.

### 4.2 Delete old files from extension

```bash
rm extension/src/ui/components/LogViewer.tsx
rm extension/src/ui/components/TorrentItem.tsx
rm extension/src/ui/lib/extension-bridge.ts
rm extension/src/ui/lib/notification-bridge.ts
rm extension/src/ui/lib/engine-manager.ts
rm extension/src/ui/context/EngineContext.tsx
rm extension/src/ui/hooks/useEngineState.ts
```

### 4.3 Update extension/src/ui/app.tsx

Replace the entire file with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef } from 'react'
import { Torrent, generateMagnet, createTorrentBuffer } from '@jstorrent/engine'
import { TorrentItem, formatBytes } from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      await adapter.addTorrent(new Uint8Array(buffer))
    } catch (err) {
      console.error('Failed to add torrent file:', err)
    }
    e.target.value = ''
  }

  const handleAddTorrent = async () => {
    if (!magnetInput) {
      fileInputRef.current?.click()
      return
    }

    try {
      await adapter.addTorrent(magnetInput)
      setMagnetInput('')
    } catch (e) {
      console.error('Failed to add torrent:', e)
    }
  }

  const handleStartTorrent = (torrent: Torrent) => {
    torrent.userStart()
  }

  const handleStopTorrent = (torrent: Torrent) => {
    torrent.userStop()
  }

  const handleDeleteTorrent = async (torrent: Torrent) => {
    await adapter.removeTorrent(torrent)
  }

  const handleRecheckTorrent = async (torrent: Torrent) => {
    await torrent.recheckData()
  }

  const handleResetTorrent = async (torrent: Torrent) => {
    const metadataRaw = torrent.metadataRaw
    let torrentData: string | Uint8Array

    if (metadataRaw) {
      torrentData = createTorrentBuffer({
        metadataRaw,
        announce: torrent.announce,
      })
    } else {
      torrentData = generateMagnet({
        infoHash: torrent.infoHashStr,
        name: torrent.name,
        announce: torrent.announce,
      })
    }

    await adapter.removeTorrent(torrent)
    await adapter.addTorrent(torrentData, { userState: 'stopped' })
  }

  const handleShareTorrent = (torrent: Torrent) => {
    const magnetUri = generateMagnet({
      infoHash: torrent.infoHashStr,
      name: torrent.name,
      announce: torrent.announce,
    })
    const shareUrl = `${import.meta.env.SHARE_URL}#magnet=${encodeURIComponent(magnetUri)}`
    window.open(shareUrl, '_blank')
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
          borderBottom: '1px solid var(--border-color)',
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
              background: activeTab === 'torrents' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'torrents' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'settings' ? 'white' : 'var(--button-text)',
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
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".torrent"
                style={{ display: 'none' }}
              />
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

            <div style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              {torrents.length} torrents | {numConnections} connections |{' '}
              {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
              {formatBytes(globalStats.totalUploadRate)}/s
            </div>

            {torrents.length === 0 ? (
              <p>No torrents. Add a magnet link to get started.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {torrents.map((torrent) => (
                  <TorrentItem
                    key={torrent.infoHashStr}
                    torrent={torrent}
                    onStart={handleStartTorrent}
                    onStop={handleStopTorrent}
                    onDelete={handleDeleteTorrent}
                    onRecheck={handleRecheckTorrent}
                    onReset={handleResetTorrent}
                    onShare={handleShareTorrent}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
    </div>
  )
}

function App() {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof engineManager.init>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
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

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  if (error) {
    return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  }

  if (!engine) {
    return <div style={{ padding: '20px' }}>Failed to initialize engine</div>
  }

  return (
    <EngineProvider engine={engine}>
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

### 4.4 Update extension/src/ui/components/DownloadRootsManager.tsx

Update the import:

```tsx
// Change:
import { engineManager } from '../lib/engine-manager'

// To:
import { engineManager } from '@jstorrent/client'
```

---

## Phase 5: Verification

Run these commands in order:

```bash
# 1. Install dependencies (will link workspace packages)
pnpm install

# 2. Build all packages in dependency order
pnpm -r build

# 3. Type check all packages
pnpm -r typecheck

# 4. Lint all packages
pnpm -r lint

# 5. Run extension tests
cd extension && pnpm test

# 6. Run extension e2e tests (if applicable)
cd extension && pnpm test:e2e
```

---

## Checklist

### Phase 1: packages/ui
- [ ] Create directory structure
- [ ] Create package.json
- [ ] Create tsconfig.json
- [ ] Create src/utils/format.ts
- [ ] Create src/components/TorrentItem.tsx
- [ ] Copy styles.css
- [ ] Create src/index.ts

### Phase 2: packages/client
- [ ] Create directory structure
- [ ] Create package.json
- [ ] Create tsconfig.json
- [ ] Create src/adapters/types.ts
- [ ] Move extension-bridge.ts to src/chrome/
- [ ] Move notification-bridge.ts to src/chrome/
- [ ] Move engine-manager.ts to src/chrome/
- [ ] Create src/context/EngineContext.tsx
- [ ] Create src/hooks/useEngineState.ts
- [ ] Create src/index.ts

### Phase 3: ESLint
- [ ] Add packages/client and packages/ui rules to eslint.config.js

### Phase 4: Extension updates
- [ ] Add workspace dependencies to package.json
- [ ] Delete LogViewer.tsx
- [ ] Delete old TorrentItem.tsx
- [ ] Delete old lib/ files (extension-bridge, notification-bridge, engine-manager)
- [ ] Delete old context/EngineContext.tsx
- [ ] Delete old hooks/useEngineState.ts
- [ ] Update app.tsx with new imports and structure
- [ ] Update DownloadRootsManager.tsx import

### Phase 5: Verification
- [ ] pnpm install succeeds
- [ ] pnpm -r build succeeds
- [ ] pnpm -r typecheck succeeds
- [ ] pnpm -r lint succeeds
- [ ] extension tests pass
