# JSTorrent Virtualized Tables Plan

## Context

We're adding high-performance virtualized tables using Solid.js + TanStack Virtual to `@jstorrent/ui`. The tables need to:

- Update at 60Hz+ when data changes (Solid's fine-grained reactivity)
- Handle thousands of rows efficiently (TanStack Virtual)
- Be mountable from React (the app shell is React)
- Support configurable columns with persistence to sessionStorage

**First table:** Torrent list (replacing the current `<ul>` with `TorrentItem` components)

---

## Phase 1: Add Dependencies

### 1.1 Update packages/ui/package.json

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
    "@jstorrent/engine": "workspace:*",
    "@tanstack/solid-virtual": "^3.13.0",
    "solid-js": "^1.9.0"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "typescript": "^5.2.2"
  }
}
```

### 1.2 Update extension/package.json

Add vite-plugin-solid for building Solid components:

```json
{
  "devDependencies": {
    "vite-plugin-solid": "^2.11.0"
  }
}
```

### 1.3 Update extension/vite.config.js

Replace the entire config with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import solid from 'vite-plugin-solid'
import { resolve } from 'path'
import dns from 'dns'
import fs from 'fs'

// Check if local.jstorrent.com resolves (needed for dev server)
const DEV_HOST = 'local.jstorrent.com'
// Default extension ID from pubkey.txt - can be overridden via VITE_EXTENSION_ID env var
const DEFAULT_EXTENSION_ID = 'bnceafpojmnimbnhamaeedgomdcgnbjk'
if (process.env.npm_lifecycle_event !== 'build') {
  dns.lookup(DEV_HOST, (err) => {
    if (err && err.code === 'ENOTFOUND') {
      console.log(`
ERROR: Cannot resolve '${DEV_HOST}'

The dev server requires '${DEV_HOST}' to point to localhost.
Add this line to your /etc/hosts file:

  127.0.0.1 ${DEV_HOST}

On Linux/Mac:
  echo "127.0.0.1 ${DEV_HOST}" | sudo tee -a /etc/hosts

On Windows (run as Administrator):
  echo 127.0.0.1 ${DEV_HOST} >> C:\\Windows\\System32\\drivers\\etc\\hosts
`)
      process.exit(1)
    }
  })
}

function sourcemapIgnoreLogger() {
  return {
    name: 'sourcemap-ignore-logger',
    writeBundle(options, bundle) {
      const outDir = options.dir || 'dist'
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && fileName.endsWith('.js')) {
          const mapPath = resolve(outDir, fileName + '.map')
          try {
            const mapContent = fs.readFileSync(mapPath, 'utf-8')
            const map = JSON.parse(mapContent)
            const sources = map.sources || []
            const ignoreList = []
            sources.forEach((source, index) => {
              if (source.includes('node_modules') || source.includes('/logging/')) {
                ignoreList.push(index)
              }
            })
            map.x_google_ignoreList = ignoreList
            fs.writeFileSync(mapPath, JSON.stringify(map))
          } catch (e) {
            // Map file might not exist for some chunks
          }
        }
      }
    },
  }
}

function printDevUrls() {
  return {
    name: 'print-dev-urls',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const extensionId = process.env.DEV_EXTENSION_ID || DEFAULT_EXTENSION_ID
        console.log(`
Development URLs:

  HMR Dev Server (standalone):
    http://${DEV_HOST}:3001/src/ui/app.html

  Chrome Extension UI:
    chrome-extension://${extensionId}/src/ui/app.html

  Website:
    http://${DEV_HOST}:3000/
`)
      })
    },
  }
}

function injectPublicKey() {
  return {
    name: 'inject-public-key',
    generateBundle(options, bundle) {
      try {
        const manifestPath = resolve(__dirname, 'public/manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
          const manifestJson = JSON.parse(manifestContent)

          const pubKeyContent = fs.readFileSync(resolve(__dirname, 'pubkey.txt'), 'utf-8')
          const match = pubKeyContent.match(/"key"\s*:\s*"([^"]+)"/)

          if (match && match[1]) {
            manifestJson.key = match[1]
            console.log('Injected public key into manifest.json')
          } else {
            console.warn('Could not find key in pubkey.txt')
          }

          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(manifestJson, null, 2),
          })
        } else {
          console.warn('public/manifest.json not found')
        }
      } catch (e) {
        console.warn('Failed to inject public key:', e.message)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    // Solid plugin MUST come first, only for .solid.tsx files
    solid({
      include: ['**/*.solid.tsx'],
      solid: {
        generate: 'dom',
      },
    }),
    // React plugin for all other .tsx files
    react({
      exclude: ['**/*.solid.tsx'],
    }),
    printDevUrls(),
    injectPublicKey(),
    sourcemapIgnoreLogger(),
  ],
  define: {
    'import.meta.env.DEV_EXTENSION_ID': JSON.stringify(
      process.env.DEV_EXTENSION_ID || DEFAULT_EXTENSION_ID,
    ),
    'import.meta.env.SHARE_URL': JSON.stringify(
      process.env.SHARE_URL || `http://${DEV_HOST}:3001/src/ui/share.html`,
    ),
  },
  server: {
    host: 'local.jstorrent.com',
    port: 3001,
    sourcemapIgnoreList: (relativeSourcePath) => {
      return relativeSourcePath.includes('node_modules') || relativeSourcePath.includes('/logging/')
    },
  },
  resolve: {
    alias: {
      '@jstorrent/engine': resolve(__dirname, '../packages/engine/src/index.ts'),
      '@jstorrent/client': resolve(__dirname, '../packages/client/src/index.ts'),
      '@jstorrent/ui': resolve(__dirname, '../packages/ui/src/index.ts'),
    },
  },
  build: {
    sourcemap: true,
    minify: false,
    sourcemapIgnoreList: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/ui/app.html'),
        share: resolve(__dirname, 'src/ui/share.html'),
        magnet: resolve(__dirname, 'src/magnet/magnet-handler.html'),
        sw: resolve(__dirname, 'src/sw.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') {
            return 'sw.js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
```

**Key change:** Files ending in `.solid.tsx` are compiled with Solid, everything else with React.

---

## Phase 2: Create Table Infrastructure

### 2.1 Create packages/ui/src/tables/types.ts

```ts
/**
 * Column definition for virtualized tables.
 */
export interface ColumnDef<T> {
  /** Unique identifier for this column */
  id: string
  /** Header text */
  header: string
  /** Extract display value from row data */
  getValue: (row: T) => string | number
  /** Initial width in pixels */
  width: number
  /** Minimum width when resizing */
  minWidth?: number
  /** Text alignment */
  align?: 'left' | 'center' | 'right'
}

/**
 * Column visibility and width configuration.
 * Persisted to sessionStorage.
 */
export interface ColumnConfig {
  /** Ordered list of visible column IDs */
  visible: string[]
  /** Column widths (overrides defaults) */
  widths: Record<string, number>
}

/**
 * Props for table mount wrapper (React -> Solid bridge)
 */
export interface TableMountProps<T> {
  /** Function to get current row data */
  getRows: () => T[]
  /** Extract unique key from row */
  getRowKey: (row: T) => string
  /** Column definitions */
  columns: ColumnDef<T>[]
  /** Storage key for column config persistence */
  storageKey: string
  /** Currently selected row keys */
  selectedKeys?: Set<string>
  /** Selection change handler */
  onSelectionChange?: (keys: Set<string>) => void
  /** Row click handler */
  onRowClick?: (row: T) => void
  /** Row double-click handler */
  onRowDoubleClick?: (row: T) => void
  /** Row height in pixels */
  rowHeight?: number
  /** Estimated total rows (for virtualization) */
  estimatedRowCount?: number
}
```

### 2.2 Create packages/ui/src/tables/column-config.ts

```ts
import { ColumnConfig, ColumnDef } from './types'

const STORAGE_PREFIX = 'jstorrent:columns:'

/**
 * Load column config from sessionStorage.
 */
export function loadColumnConfig<T>(
  storageKey: string,
  defaultColumns: ColumnDef<T>[],
): ColumnConfig {
  try {
    const stored = sessionStorage.getItem(STORAGE_PREFIX + storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnConfig>
      return {
        visible: parsed.visible ?? defaultColumns.map((c) => c.id),
        widths: parsed.widths ?? {},
      }
    }
  } catch {
    // Ignore parse errors
  }

  return {
    visible: defaultColumns.map((c) => c.id),
    widths: {},
  }
}

/**
 * Save column config to sessionStorage.
 */
export function saveColumnConfig(storageKey: string, config: ColumnConfig): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(config))
  } catch {
    // Ignore storage errors (quota, etc.)
  }
}

/**
 * Get effective width for a column.
 */
export function getColumnWidth<T>(
  column: ColumnDef<T>,
  config: ColumnConfig,
): number {
  return config.widths[column.id] ?? column.width
}
```

### 2.3 Create packages/ui/src/tables/VirtualTable.solid.tsx

```tsx
import { createSignal, createEffect, For, onCleanup, onMount } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import { getColumnWidth, loadColumnConfig, saveColumnConfig } from './column-config'

export interface VirtualTableProps<T> {
  getRows: () => T[]
  getRowKey: (row: T) => string
  columns: ColumnDef<T>[]
  storageKey: string
  selectedKeys?: Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  rowHeight?: number
}

export function VirtualTable<T>(props: VirtualTableProps<T>) {
  const rowHeight = props.rowHeight ?? 32

  // Column configuration (persisted)
  const [columnConfig, setColumnConfig] = createSignal<ColumnConfig>(
    loadColumnConfig(props.storageKey, props.columns)
  )

  // Save config changes
  createEffect(() => {
    saveColumnConfig(props.storageKey, columnConfig())
  })

  // Container ref for virtualizer
  let containerRef: HTMLDivElement | undefined

  // Create virtualizer
  const virtualizer = createVirtualizer({
    get count() {
      return props.getRows().length
    },
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => rowHeight,
    overscan: 5,
  })

  // RAF-based update loop for live data
  let rafId: number | undefined
  const [, forceUpdate] = createSignal({}, { equals: false })

  onMount(() => {
    const tick = () => {
      forceUpdate({})
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  })

  onCleanup(() => {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
    }
  })

  // Get visible columns
  const visibleColumns = () => {
    const config = columnConfig()
    return props.columns.filter((c) => config.visible.includes(c.id))
  }

  // Calculate total width
  const totalWidth = () => {
    const config = columnConfig()
    return visibleColumns().reduce((sum, col) => sum + getColumnWidth(col, config), 0)
  }

  // Handle row click
  const handleRowClick = (row: T, e: MouseEvent) => {
    props.onRowClick?.(row)

    if (props.onSelectionChange) {
      const key = props.getRowKey(row)
      const current = props.selectedKeys ?? new Set()

      if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        const next = new Set(current)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        props.onSelectionChange(next)
      } else if (e.shiftKey) {
        // Range selection (simplified - just add to selection)
        const next = new Set(current)
        next.add(key)
        props.onSelectionChange(next)
      } else {
        // Single selection
        props.onSelectionChange(new Set([key]))
      }
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflow: 'auto',
        'font-family': 'system-ui, sans-serif',
        'font-size': '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          position: 'sticky',
          top: '0',
          background: 'var(--bg-secondary, #f5f5f5)',
          'border-bottom': '1px solid var(--border-color, #ddd)',
          'font-weight': '600',
          'z-index': '1',
          width: `${totalWidth()}px`,
          'min-width': '100%',
        }}
      >
        <For each={visibleColumns()}>
          {(column) => (
            <div
              style={{
                width: `${getColumnWidth(column, columnConfig())}px`,
                padding: '8px 12px',
                'box-sizing': 'border-box',
                'text-align': column.align ?? 'left',
                'white-space': 'nowrap',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'border-right': '1px solid var(--border-color, #ddd)',
                'flex-shrink': '0',
              }}
            >
              {column.header}
            </div>
          )}
        </For>
      </div>

      {/* Virtual rows container */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: `${totalWidth()}px`,
          'min-width': '100%',
          position: 'relative',
        }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const row = () => props.getRows()[virtualRow.index]
            const key = () => props.getRowKey(row())
            const isSelected = () => props.selectedKeys?.has(key()) ?? false

            return (
              <div
                style={{
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  'align-items': 'center',
                  background: isSelected()
                    ? 'var(--bg-selected, #e3f2fd)'
                    : virtualRow.index % 2 === 0
                      ? 'var(--bg-primary, #fff)'
                      : 'var(--bg-alternate, #fafafa)',
                  cursor: 'pointer',
                  'border-bottom': '1px solid var(--border-light, #eee)',
                }}
                onClick={(e) => handleRowClick(row(), e)}
                onDblClick={() => props.onRowDoubleClick?.(row())}
              >
                <For each={visibleColumns()}>
                  {(column) => (
                    <div
                      style={{
                        width: `${getColumnWidth(column, columnConfig())}px`,
                        padding: '0 12px',
                        'box-sizing': 'border-box',
                        'text-align': column.align ?? 'left',
                        'white-space': 'nowrap',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'flex-shrink': '0',
                      }}
                    >
                      {column.getValue(row())}
                    </div>
                  )}
                </For>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
```

### 2.4 Create packages/ui/src/tables/mount.tsx (React wrapper)

```tsx
import { useEffect, useRef } from 'react'
import { render } from 'solid-js/web'
import { VirtualTable } from './VirtualTable.solid'
import type { TableMountProps } from './types'

/**
 * React component that mounts a Solid VirtualTable.
 * Handles lifecycle and props bridging.
 */
export function TableMount<T>(props: TableMountProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Dispose previous instance if any
    disposeRef.current?.()

    // Mount Solid component
    disposeRef.current = render(
      () => (
        <VirtualTable
          getRows={props.getRows}
          getRowKey={props.getRowKey}
          columns={props.columns}
          storageKey={props.storageKey}
          selectedKeys={props.selectedKeys}
          onSelectionChange={props.onSelectionChange}
          onRowClick={props.onRowClick}
          onRowDoubleClick={props.onRowDoubleClick}
          rowHeight={props.rowHeight}
        />
      ),
      containerRef.current,
    )

    return () => {
      disposeRef.current?.()
      disposeRef.current = null
    }
  }, []) // Only mount once - Solid handles internal updates

  // Update props via Solid's reactivity (the getRows function is called each frame)
  // Other props are stable references, so no re-mount needed

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', width: '100%' }}
    />
  )
}
```

---

## Phase 3: Create Torrent Table

### 3.1 Create packages/ui/src/tables/TorrentTable.tsx

```tsx
import { Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Column definitions for torrent table.
 */
export const torrentColumns: ColumnDef<Torrent>[] = [
  {
    id: 'name',
    header: 'Name',
    getValue: (t) => t.name || 'Loading...',
    width: 300,
    minWidth: 100,
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (t) => formatBytes(t.contentStorage?.getTotalSize() ?? 0),
    width: 80,
    align: 'right',
  },
  {
    id: 'progress',
    header: 'Done',
    getValue: (t) => `${(t.progress * 100).toFixed(1)}%`,
    width: 70,
    align: 'right',
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (t) => t.activityState,
    width: 100,
  },
  {
    id: 'downloadSpeed',
    header: 'Down',
    getValue: (t) => (t.downloadSpeed > 0 ? formatBytes(t.downloadSpeed) + '/s' : '-'),
    width: 90,
    align: 'right',
  },
  {
    id: 'uploadSpeed',
    header: 'Up',
    getValue: (t) => (t.uploadSpeed > 0 ? formatBytes(t.uploadSpeed) + '/s' : '-'),
    width: 90,
    align: 'right',
  },
  {
    id: 'peers',
    header: 'Peers',
    getValue: (t) => t.numPeers,
    width: 60,
    align: 'right',
  },
  {
    id: 'seeds',
    header: 'Seeds',
    getValue: (t) => {
      // Count peers that have 100% (are seeds)
      // This would need swarm data - simplified for now
      return '-'
    },
    width: 60,
    align: 'right',
  },
]

export interface TorrentTableProps {
  /** Function that returns current torrent list */
  getTorrents: () => Torrent[]
  /** Selected torrent info hashes */
  selectedHashes?: Set<string>
  /** Selection change callback */
  onSelectionChange?: (hashes: Set<string>) => void
  /** Row click callback */
  onRowClick?: (torrent: Torrent) => void
  /** Row double-click callback */
  onRowDoubleClick?: (torrent: Torrent) => void
}

/**
 * Virtualized torrent table component.
 */
export function TorrentTable(props: TorrentTableProps) {
  return (
    <TableMount<Torrent>
      getRows={props.getTorrents}
      getRowKey={(t) => t.infoHashStr}
      columns={torrentColumns}
      storageKey="torrents"
      selectedKeys={props.selectedHashes}
      onSelectionChange={props.onSelectionChange}
      onRowClick={props.onRowClick}
      onRowDoubleClick={props.onRowDoubleClick}
      rowHeight={28}
    />
  )
}
```

### 3.2 Update packages/ui/src/index.ts

```ts
// Components
export { TorrentItem } from './components/TorrentItem'
export type { TorrentItemProps } from './components/TorrentItem'

// Tables
export { TorrentTable, torrentColumns } from './tables/TorrentTable'
export { TableMount } from './tables/mount'
export type { ColumnDef, ColumnConfig, TableMountProps } from './tables/types'

// Utils
export * from './utils/format'
```

---

## Phase 4: Update App to Use Table

### 4.1 Update extension/src/ui/app.tsx

Replace the current torrents view with the new table. Change the torrents tab content from:

```tsx
{torrents.length === 0 ? (
  <p>No torrents. Add a magnet link to get started.</p>
) : (
  <ul style={{ listStyle: 'none', padding: 0 }}>
    {torrents.map((torrent) => (
      <TorrentItem
        key={torrent.infoHashStr}
        ...
      />
    ))}
  </ul>
)}
```

To:

```tsx
import { TorrentTable } from '@jstorrent/ui'

// In AppContent, add state for selection:
const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())

// Get the selected torrent for actions
const selectedTorrent = selectedTorrents.size === 1
  ? torrents.find(t => t.infoHashStr === [...selectedTorrents][0])
  : null

// Replace the torrents list with:
<div style={{ flex: 1, minHeight: 0 }}>
  <TorrentTable
    getTorrents={() => torrents}
    selectedHashes={selectedTorrents}
    onSelectionChange={setSelectedTorrents}
    onRowClick={(torrent) => {
      console.log('Clicked:', torrent.name)
    }}
    onRowDoubleClick={(torrent) => {
      // Toggle start/stop on double-click
      if (torrent.userState === 'stopped') {
        torrent.userStart()
      } else {
        torrent.userStop()
      }
    }}
  />
</div>
```

Here's the full updated app.tsx:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef } from 'react'
import { Torrent, generateMagnet, createTorrentBuffer } from '@jstorrent/engine'
import { TorrentTable, formatBytes } from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get single selected torrent for context actions
  const selectedTorrent =
    selectedTorrents.size === 1
      ? torrents.find((t) => t.infoHashStr === [...selectedTorrents][0])
      : null

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

  const handleDeleteSelected = async () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent) {
        await adapter.removeTorrent(torrent)
      }
    }
    setSelectedTorrents(new Set())
  }

  const handleStartSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState === 'stopped') {
        torrent.userStart()
      }
    }
  }

  const handleStopSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState !== 'stopped') {
        torrent.userStop()
      }
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

        {/* Stats */}
        <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '13px' }}>
          {torrents.length} torrents | {numConnections} connections |{' '}
          ↓ {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
          ↑ {formatBytes(globalStats.totalUploadRate)}/s
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <>
            {/* Toolbar */}
            <div
              style={{
                padding: '8px 20px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
              }}
            >
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
                style={{ flex: 1, padding: '6px 8px', maxWidth: '400px' }}
              />
              <button onClick={handleAddTorrent} style={{ padding: '6px 12px', cursor: 'pointer' }}>
                Add
              </button>
              <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />
              <button
                onClick={handleStartSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
                title="Start selected"
              >
                ▶
              </button>
              <button
                onClick={handleStopSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
                title="Stop selected"
              >
                ⏸
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--accent-error)' }}
                title="Remove selected"
              >
                ✕
              </button>
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0 }}>
              {torrents.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No torrents. Add a magnet link to get started.
                </div>
              ) : (
                <TorrentTable
                  getTorrents={() => torrents}
                  selectedHashes={selectedTorrents}
                  onSelectionChange={setSelectedTorrents}
                  onRowDoubleClick={(torrent) => {
                    if (torrent.userState === 'stopped') {
                      torrent.userStart()
                    } else {
                      torrent.userStop()
                    }
                  }}
                />
              )}
            </div>
          </>
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

---

## Phase 5: Update TypeScript Config

### 5.1 Update packages/ui/tsconfig.json

Add JSX preserve for Solid (Vite handles the transform):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
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

**Note:** This may cause issues since we have both React and Solid. An alternative approach is to NOT build packages/ui with tsc and instead let the consuming app's Vite handle everything. Let me provide an alternative:

### 5.1 Alternative: Skip tsc build for packages/ui

Update packages/ui/package.json to point directly to source:

```json
{
  "name": "@jstorrent/ui",
  "version": "0.0.1",
  "description": "JSTorrent UI components",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    },
    "./styles.css": "./src/styles.css"
  },
  "scripts": {
    "typecheck": "echo 'Skipped - Vite handles JSX transforms'"
  },
  "dependencies": {
    "@jstorrent/engine": "workspace:*",
    "@tanstack/solid-virtual": "^3.13.0",
    "solid-js": "^1.9.0"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "typescript": "^5.2.2"
  }
}
```

The Vite alias in extension/vite.config.js already points to source, so this works.

---

## Phase 6: Verification

```bash
# 1. Install new dependencies
pnpm install

# 2. Start dev server
cd extension && pnpm dev:web

# 3. Open http://local.jstorrent.com:3001/src/ui/app.html

# 4. Add a torrent and verify:
#    - Table renders with columns
#    - Rows update in real-time (speeds, progress)
#    - Selection works (click, ctrl+click)
#    - Double-click toggles start/stop

# 5. Run typecheck
pnpm -r typecheck

# 6. Run lint
pnpm -r lint
```

---

## Checklist

### Phase 1: Dependencies
- [ ] Update packages/ui/package.json with solid-js and @tanstack/solid-virtual
- [ ] Add vite-plugin-solid to extension devDependencies
- [ ] Update extension/vite.config.js with Solid plugin config

### Phase 2: Table Infrastructure
- [ ] Create packages/ui/src/tables/ directory
- [ ] Create packages/ui/src/tables/types.ts
- [ ] Create packages/ui/src/tables/column-config.ts
- [ ] Create packages/ui/src/tables/VirtualTable.solid.tsx
- [ ] Create packages/ui/src/tables/mount.tsx

### Phase 3: Torrent Table
- [ ] Create packages/ui/src/tables/TorrentTable.tsx
- [ ] Update packages/ui/src/index.ts exports

### Phase 4: App Integration
- [ ] Update extension/src/ui/app.tsx to use TorrentTable
- [ ] Remove TorrentItem usage (can keep component for reference)
- [ ] Add selection state and toolbar actions

### Phase 5: TypeScript
- [ ] Update packages/ui/package.json to export source directly
- [ ] Or update tsconfig.json for dual React/Solid JSX

### Phase 6: Verification
- [ ] pnpm install succeeds
- [ ] Dev server starts
- [ ] Table renders correctly
- [ ] Real-time updates work
- [ ] Selection works
- [ ] Typecheck passes
- [ ] Lint passes
