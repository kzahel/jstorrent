# JSTorrent Multi-Select & Testing Implementation

## Overview

Improve table row selection UX and establish RTL testing pattern.

**Changes:**
1. Range selection with Shift+click (anchor → current)
2. Fix visual selection highlight (ref pattern for closure)
3. Cursor: `default` instead of `pointer`
4. Prevent text selection with `user-select: none`
5. Update DetailPane message for multi-select
6. Add RTL tests for selection behavior

---

## Phase 1: Update VirtualTable Selection Logic

### 1.1 Update packages/ui/src/tables/VirtualTable.solid.tsx

Replace the entire file:

```tsx
/* eslint-disable @typescript-eslint/ban-ts-comment, react/no-unknown-property */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
import { createSignal, For, onCleanup, onMount } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import { getColumnWidth, loadColumnConfig, saveColumnConfig } from './column-config'

export interface VirtualTableProps<T> {
  getRows: () => T[]
  getRowKey: (row: T) => string
  columns: ColumnDef<T>[]
  storageKey: string
  getSelectedKeys?: () => Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  rowHeight?: number
}

export function VirtualTable<T>(props: VirtualTableProps<T>) {
  const rowHeight = props.rowHeight ?? 32

  // Column configuration (persisted)
  const [columnConfig, setColumnConfig] = createSignal<ColumnConfig>(
    loadColumnConfig(props.storageKey, props.columns),
  )

  // Save config changes
  $effect(() => {
    saveColumnConfig(props.storageKey, columnConfig())
  })

  // Container ref for virtualizer
  let containerRef: HTMLDivElement | undefined

  // RAF-based update loop for live data
  const [tick, forceUpdate] = createSignal({}, { equals: false })

  // Derived rows accessor - subscribes to RAF tick
  const rows = () => {
    tick()
    return props.getRows()
  }

  // Anchor index for shift+click range selection
  let anchorIndex: number | null = null

  // Create virtualizer
  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => rowHeight,
    overscan: 5,
  })

  let rafId: number | undefined

  onMount(() => {
    const loop = () => {
      forceUpdate({})
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
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

  // Handle row click with selection logic
  const handleRowClick = (row: T, index: number, e: MouseEvent) => {
    props.onRowClick?.(row)

    if (!props.onSelectionChange || !props.getSelectedKeys) return

    const key = props.getRowKey(row)
    const current = props.getSelectedKeys()
    const allRows = rows()

    if (e.shiftKey && anchorIndex !== null) {
      // Range selection: anchor to current
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)
      
      const rangeKeys = new Set<string>()
      for (let i = start; i <= end; i++) {
        if (allRows[i]) {
          rangeKeys.add(props.getRowKey(allRows[i]))
        }
      }
      
      if (e.ctrlKey || e.metaKey) {
        // Shift+Ctrl: add range to existing selection
        const next = new Set(current)
        for (const k of rangeKeys) {
          next.add(k)
        }
        props.onSelectionChange(next)
      } else {
        // Shift only: replace selection with range
        props.onSelectionChange(rangeKeys)
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle single item
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      props.onSelectionChange(next)
      anchorIndex = index
    } else {
      // Single select - replace selection
      props.onSelectionChange(new Set([key]))
      anchorIndex = index
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
        'user-select': 'none',
      }}
      data-testid="virtual-table"
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
            const row = () => rows()[virtualRow.index]
            const key = () => props.getRowKey(row())
            const isSelected = () => props.getSelectedKeys?.().has(key()) ?? false

            return (
              <div
                data-testid="table-row"
                data-row-key={key()}
                data-selected={isSelected()}
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
                    : 'var(--bg-primary, #fff)',
                  cursor: 'default',
                  'border-bottom': '1px solid var(--border-light, #eee)',
                }}
                onClick={(e) => handleRowClick(row(), virtualRow.index, e)}
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

**Key changes:**
- `getSelectedKeys` is now a getter function (fixes closure issue)
- `anchorIndex` tracks last non-shift click for range selection
- Shift+click selects range from anchor to current
- Shift+Ctrl+click adds range to existing selection
- `cursor: 'default'` instead of `'pointer'`
- `user-select: 'none'` on container
- Added `data-testid` attributes for RTL

---

## Phase 2: Update TableMount Props

### 2.1 Update packages/ui/src/tables/types.ts

Change `selectedKeys` to `getSelectedKeys`:

```ts
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
  /** Get currently selected row keys (getter to avoid closure issues) */
  getSelectedKeys?: () => Set<string>
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

### 2.2 Update packages/ui/src/tables/mount.tsx

Update to use `getSelectedKeys`:

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
      () =>
        VirtualTable({
          getRows: props.getRows,
          getRowKey: props.getRowKey,
          columns: props.columns,
          storageKey: props.storageKey,
          getSelectedKeys: props.getSelectedKeys,
          onSelectionChange: props.onSelectionChange,
          onRowClick: props.onRowClick,
          onRowDoubleClick: props.onRowDoubleClick,
          rowHeight: props.rowHeight,
        }) as unknown as Element,
      containerRef.current,
    )

    return () => {
      disposeRef.current?.()
      disposeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} data-testid="table-mount" />
}
```

---

## Phase 3: Update TorrentTable

### 3.1 Update packages/ui/src/tables/TorrentTable.tsx

Change prop from `selectedHashes` to `getSelectedHashes`:

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
    getValue: () => '-',
    width: 60,
    align: 'right',
  },
]

/** Minimal interface for reading torrents */
interface TorrentSource {
  readonly torrents: Torrent[]
}

export interface TorrentTableProps {
  /** Source to read torrents from */
  source: TorrentSource
  /** Getter for selected torrent hashes (avoids closure issues) */
  getSelectedHashes?: () => Set<string>
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
      getRows={() => props.source.torrents}
      getRowKey={(t) => t.infoHashStr}
      columns={torrentColumns}
      storageKey="torrents"
      getSelectedKeys={props.getSelectedHashes}
      onSelectionChange={props.onSelectionChange}
      onRowClick={props.onRowClick}
      onRowDoubleClick={props.onRowDoubleClick}
      rowHeight={28}
    />
  )
}
```

---

## Phase 4: Update DetailPane Message

### 4.1 Update packages/ui/src/components/DetailPane.tsx

Update the multi-select case to show count:

```tsx
import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'

export type DetailTab = 'peers' | 'pieces' | 'files' | 'trackers'

interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}

export interface DetailPaneProps {
  source: TorrentSource
  /** Selected hashes - null means none, Set with 1 item shows details, Set with 2+ shows count */
  selectedHashes: Set<string>
}

const tabStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--text-secondary)',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  color: 'var(--text-primary)',
  borderBottomColor: 'var(--accent-primary)',
}

const emptyStateStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
}

export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('peers')
  
  // No selection
  if (props.selectedHashes.size === 0) {
    return <div style={emptyStateStyle}>Select a torrent to view details</div>
  }
  
  // Multi-selection
  if (props.selectedHashes.size > 1) {
    return (
      <div style={emptyStateStyle}>
        {props.selectedHashes.size} torrents selected
      </div>
    )
  }
  
  // Single selection - show details
  const selectedHash = [...props.selectedHashes][0]
  const torrent = props.source.getTorrent(selectedHash)
  
  if (!torrent) {
    return <div style={emptyStateStyle}>Torrent not found</div>
  }
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
      }}>
        <button
          style={activeTab === 'peers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('peers')}
        >
          Peers ({torrent.numPeers})
        </button>
        <button
          style={activeTab === 'pieces' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('pieces')}
        >
          Pieces ({torrent.completedPiecesCount}/{torrent.piecesCount})
        </button>
        <button
          style={activeTab === 'files' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('files')}
        >
          Files ({torrent.files.length})
        </button>
        <button
          style={activeTab === 'trackers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('trackers')}
        >
          Trackers
        </button>
      </div>
      
      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' && (
          <PeerTable source={props.source} torrentHash={selectedHash} />
        )}
        {activeTab === 'pieces' && (
          <PieceTable source={props.source} torrentHash={selectedHash} />
        )}
        {activeTab === 'files' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
            Files table coming soon
          </div>
        )}
        {activeTab === 'trackers' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
            Trackers table coming soon
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## Phase 5: Update App.tsx

### 5.1 Update extension/src/ui/app.tsx

Change to use getter pattern and pass Set to DetailPane:

Find the TorrentTable usage and change from:

```tsx
<TorrentTable
  source={adapter}
  selectedHashes={selectedTorrents}
  onSelectionChange={setSelectedTorrents}
  ...
/>
```

To:

```tsx
<TorrentTable
  source={adapter}
  getSelectedHashes={() => selectedTorrents}
  onSelectionChange={setSelectedTorrents}
  ...
/>
```

And change DetailPane from:

```tsx
<DetailPane
  source={adapter}
  selectedHash={selectedHash}
/>
```

To:

```tsx
<DetailPane
  source={adapter}
  selectedHashes={selectedTorrents}
/>
```

Remove the `selectedHash` derivation since DetailPane now handles it internally.

---

## Phase 6: Add RTL Tests

### 6.1 Install test dependencies (if not already present)

```bash
cd packages/ui
pnpm add -D vitest @testing-library/react @testing-library/user-event happy-dom
```

### 6.2 Create packages/ui/vitest.config.ts

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

### 6.3 Create packages/ui/src/test/setup.ts

```ts
import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

afterEach(() => {
  cleanup()
})
```

### 6.4 Create packages/ui/src/test/mocks.ts

```ts
/**
 * Mock torrent for testing
 */
export interface MockTorrent {
  infoHashStr: string
  name: string
  progress: number
  activityState: string
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  contentStorage?: { getTotalSize: () => number }
}

export function createMockTorrent(id: number): MockTorrent {
  const hash = id.toString(16).padStart(40, '0')
  return {
    infoHashStr: hash,
    name: `Test Torrent ${id.toString().padStart(3, '0')}`,
    progress: Math.random(),
    activityState: 'downloading',
    downloadSpeed: Math.floor(Math.random() * 1000000),
    uploadSpeed: Math.floor(Math.random() * 100000),
    numPeers: Math.floor(Math.random() * 20),
    contentStorage: { getTotalSize: () => 1024 * 1024 * 100 },
  }
}

export function createMockTorrents(count: number): MockTorrent[] {
  return Array.from({ length: count }, (_, i) => createMockTorrent(i + 1))
}

export interface MockSource {
  torrents: MockTorrent[]
  getTorrent: (hash: string) => MockTorrent | undefined
}

export function createMockSource(count: number): MockSource {
  const torrents = createMockTorrents(count)
  return {
    torrents,
    getTorrent: (hash: string) => torrents.find(t => t.infoHashStr === hash),
  }
}
```

### 6.5 Create packages/ui/src/tables/TorrentTable.test.tsx

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TorrentTable } from './TorrentTable'
import { createMockSource, MockTorrent } from '../test/mocks'

// Note: These tests use the React wrapper (TableMount) which mounts the Solid table.
// RTL interacts with the actual DOM regardless of which framework rendered it.

describe('TorrentTable', () => {
  it('renders rows for each torrent', async () => {
    const source = createMockSource(5)
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable source={source as any} />
      </div>
    )
    
    // Wait for Solid to mount and RAF to tick
    await waitFor(() => {
      expect(screen.getByTestId('virtual-table')).toBeInTheDocument()
    })
    
    // Check rows are rendered
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row')
      expect(rows.length).toBeGreaterThanOrEqual(5)
    })
  })

  it('calls onSelectionChange with clicked row key', async () => {
    const source = createMockSource(3)
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as any}
          getSelectedHashes={() => new Set()}
          onSelectionChange={onSelectionChange}
        />
      </div>
    )
    
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })
    
    const rows = screen.getAllByTestId('table-row')
    await user.click(rows[0])
    
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([source.torrents[0].infoHashStr])
    )
  })

  it('toggles selection with Ctrl+click', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[0].infoHashStr])
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as any}
          getSelectedHashes={() => selected}
          onSelectionChange={onSelectionChange}
        />
      </div>
    )
    
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })
    
    const rows = screen.getAllByTestId('table-row')
    
    // Ctrl+click second row - should add to selection
    await user.keyboard('[ControlLeft>]')
    await user.click(rows[1])
    await user.keyboard('[/ControlLeft]')
    
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([source.torrents[0].infoHashStr, source.torrents[1].infoHashStr])
    )
  })

  it('deselects with Ctrl+click on selected row', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[0].infoHashStr, source.torrents[1].infoHashStr])
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as any}
          getSelectedHashes={() => selected}
          onSelectionChange={onSelectionChange}
        />
      </div>
    )
    
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })
    
    const rows = screen.getAllByTestId('table-row')
    
    // Ctrl+click first row - should remove from selection
    await user.keyboard('[ControlLeft>]')
    await user.click(rows[0])
    await user.keyboard('[/ControlLeft]')
    
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([source.torrents[1].infoHashStr])
    )
  })

  it('range selects with Shift+click', async () => {
    const source = createMockSource(5)
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as any}
          getSelectedHashes={() => new Set()}
          onSelectionChange={onSelectionChange}
        />
      </div>
    )
    
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })
    
    const rows = screen.getAllByTestId('table-row')
    
    // Click first row (sets anchor)
    await user.click(rows[0])
    onSelectionChange.mockClear()
    
    // Shift+click third row (selects range 0-2)
    await user.keyboard('[ShiftLeft>]')
    await user.click(rows[2])
    await user.keyboard('[/ShiftLeft]')
    
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([
        source.torrents[0].infoHashStr,
        source.torrents[1].infoHashStr,
        source.torrents[2].infoHashStr,
      ])
    )
  })

  it('shows selected state visually', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[1].infoHashStr])
    
    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as any}
          getSelectedHashes={() => selected}
          onSelectionChange={() => {}}
        />
      </div>
    )
    
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row')
      expect(rows[1]).toHaveAttribute('data-selected', 'true')
      expect(rows[0]).toHaveAttribute('data-selected', 'false')
      expect(rows[2]).toHaveAttribute('data-selected', 'false')
    })
  })
})
```

### 6.6 Update packages/ui/package.json

Add test scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

---

## Phase 7: Verification

```bash
# 1. Run tests
cd packages/ui && pnpm test

# 2. Start dev server
cd extension && pnpm dev:web

# 3. Manual testing:
#    - Click row → single select, visible highlight
#    - Ctrl+click → add/remove from selection
#    - Click row A, Shift+click row D → selects A-D range
#    - Click row A, Shift+Ctrl+click row D → adds A-D to existing
#    - Multi-select → detail pane shows "N torrents selected"
#    - Cursor is default (not pointer)
#    - Cannot select text in rows
```

---

## Checklist

### Phase 1: VirtualTable
- [ ] Replace VirtualTable.solid.tsx with updated selection logic
- [ ] Add anchor tracking for range select
- [ ] Change cursor to default
- [ ] Add user-select: none
- [ ] Add data-testid attributes

### Phase 2: Types
- [ ] Change selectedKeys to getSelectedKeys in types.ts

### Phase 3: Mount
- [ ] Update mount.tsx to pass getSelectedKeys

### Phase 4: TorrentTable
- [ ] Change prop from selectedHashes to getSelectedHashes

### Phase 5: DetailPane  
- [ ] Update to accept Set and show count for multi-select

### Phase 6: App
- [ ] Update TorrentTable usage with getter
- [ ] Update DetailPane to receive Set

### Phase 7: Tests
- [ ] Add vitest config
- [ ] Add test setup
- [ ] Add mock utilities
- [ ] Add TorrentTable.test.tsx
- [ ] Verify tests pass

---

## Troubleshooting

**Tests fail with "Cannot find module 'solid-js'":**
The test environment doesn't compile .solid.tsx files. You may need to mock the Solid component or configure Vitest with the solid plugin:

```ts
// vitest.config.ts
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  test: { ... }
})
```

**Selection doesn't update visually:**
Verify `getSelectedHashes` is being called. Add a console.log in the getter to confirm RAF is triggering reads.

**Range select selects wrong rows:**
Check that `anchorIndex` is being set on non-shift clicks. The anchor should persist until the next non-shift click.
