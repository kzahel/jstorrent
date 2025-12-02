# JSTorrent Context Menu & Toolbar Actions

## Overview

Add torrent action menu in two forms:
1. **Right-click context menu** - appears at click position on table rows
2. **Toolbar dropdown** - "More" button appears when torrents are selected
3. **Smart button states** - Start/Stop disabled based on selection state

**Actions to support:**
- Start / Stop (already in toolbar, make smarter)
- Remove (already in toolbar)
- Re-verify Data
- Reset State
- Copy Magnet Link

---

## Phase 1: Create Context Menu Component

### 1.1 Create packages/ui/src/components/ContextMenu.tsx

```tsx
import React, { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

export interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color, #ddd)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  padding: '4px 0',
  minWidth: '160px',
  zIndex: 1000,
  fontSize: '13px',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'left',
  color: 'var(--text-primary)',
}

const disabledStyle: React.CSSProperties = {
  ...itemStyle,
  opacity: 0.5,
  cursor: 'default',
}

const dangerStyle: React.CSSProperties = {
  ...itemStyle,
  color: 'var(--accent-error, #d32f2f)',
}

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-color, #ddd)',
  margin: '4px 0',
}

export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Delay to avoid immediate close from the right-click event
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to stay in viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const menu = menuRef.current

    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  }, [x, y])

  return (
    <div ref={menuRef} style={{ ...menuStyle, left: x, top: y }}>
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} style={separatorStyle} />
        }

        const style = item.disabled
          ? disabledStyle
          : item.danger
            ? dangerStyle
            : itemStyle

        return (
          <button
            key={item.id}
            style={style}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                onSelect(item.id)
                onClose()
              }
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            {item.icon && <span>{item.icon}</span>}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
```

---

## Phase 2: Create Toolbar Dropdown Component

### 2.1 Create packages/ui/src/components/DropdownMenu.tsx

```tsx
import React, { useState, useRef, useEffect } from 'react'
import { ContextMenuItem } from './ContextMenu'

export interface DropdownMenuProps {
  label: string
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  disabled?: boolean
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
}

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color, #ddd)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  padding: '4px 0',
  minWidth: '160px',
  zIndex: 1000,
  fontSize: '13px',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'left',
  color: 'var(--text-primary)',
}

const dangerStyle: React.CSSProperties = {
  ...itemStyle,
  color: 'var(--accent-error, #d32f2f)',
}

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-color, #ddd)',
  margin: '4px 0',
}

export function DropdownMenu({ label, items, onSelect, disabled }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        style={{
          ...buttonStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span style={{ fontSize: '10px' }}>▼</span>
      </button>

      {open && (
        <div style={menuStyle}>
          {items.map((item) => {
            if (item.separator) {
              return <div key={item.id} style={separatorStyle} />
            }

            const style = item.danger ? dangerStyle : itemStyle

            return (
              <button
                key={item.id}
                style={{
                  ...style,
                  opacity: item.disabled ? 0.5 : 1,
                  cursor: item.disabled ? 'default' : 'pointer',
                }}
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled) {
                    onSelect(item.id)
                    setOpen(false)
                  }
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'none'
                }}
              >
                {item.icon && <span>{item.icon}</span>}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

---

## Phase 3: Add Right-Click Handler to VirtualTable

### 3.1 Update packages/ui/src/tables/types.ts

Add context menu callback to props:

```ts
export interface TableMountProps<T> {
  /** Function to get current row data */
  getRows: () => T[]
  /** Extract unique key from row */
  getRowKey: (row: T) => string
  /** Column definitions */
  columns: ColumnDef<T>[]
  /** Storage key for column config persistence */
  storageKey: string
  /** Get currently selected row keys */
  getSelectedKeys?: () => Set<string>
  /** Selection change handler */
  onSelectionChange?: (keys: Set<string>) => void
  /** Row click handler */
  onRowClick?: (row: T) => void
  /** Row double-click handler */
  onRowDoubleClick?: (row: T) => void
  /** Row right-click handler - receives row and mouse position */
  onRowContextMenu?: (row: T, x: number, y: number) => void
  /** Row height in pixels */
  rowHeight?: number
  /** Estimated total rows (for virtualization) */
  estimatedRowCount?: number
}
```

### 3.2 Update packages/ui/src/tables/VirtualTable.solid.tsx

Add context menu handling. Find the row div with `onClick` and add:

```tsx
onContextMenu={(e) => {
  e.preventDefault()
  const row = rows()[virtualRow.index]
  const key = props.getRowKey(row)
  
  // If right-clicking an unselected row, select it first
  if (!props.getSelectedKeys?.().has(key)) {
    props.onSelectionChange?.(new Set([key]))
    anchorIndex = virtualRow.index
  }
  
  props.onRowContextMenu?.(row, e.clientX, e.clientY)
}}
```

The full row div should look like:

```tsx
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
    cursor: 'default',
    'border-bottom': '1px solid var(--border-light, #eee)',
  }}
  style:background={isSelected() ? 'var(--bg-selected, #e3f2fd)' : 'var(--bg-primary, #fff)'}
  onClick={(e) => handleRowClick(rows()[virtualRow.index], virtualRow.index, e)}
  onDblClick={() => props.onRowDoubleClick?.(rows()[virtualRow.index])}
  onContextMenu={(e) => {
    e.preventDefault()
    const row = rows()[virtualRow.index]
    const key = props.getRowKey(row)
    
    // Select if not already selected
    if (!props.getSelectedKeys?.().has(key)) {
      props.onSelectionChange?.(new Set([key]))
      anchorIndex = virtualRow.index
    }
    
    props.onRowContextMenu?.(row, e.clientX, e.clientY)
  }}
>
```

### 3.3 Update packages/ui/src/tables/mount.tsx

Add the context menu prop:

```tsx
export function TableMount<T>(props: TableMountProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const disposeRef = useRef<(() => void) | null>(null)

  // Refs for props that may change
  const getSelectedKeysRef = useRef(props.getSelectedKeys)
  getSelectedKeysRef.current = props.getSelectedKeys

  const onSelectionChangeRef = useRef(props.onSelectionChange)
  onSelectionChangeRef.current = props.onSelectionChange

  const onRowContextMenuRef = useRef(props.onRowContextMenu)
  onRowContextMenuRef.current = props.onRowContextMenu

  useEffect(() => {
    if (!containerRef.current) return

    disposeRef.current?.()

    disposeRef.current = render(
      () =>
        VirtualTable({
          getRows: props.getRows,
          getRowKey: props.getRowKey,
          columns: props.columns,
          storageKey: props.storageKey,
          getSelectedKeys: () => getSelectedKeysRef.current?.() ?? new Set(),
          onSelectionChange: (keys) => onSelectionChangeRef.current?.(keys),
          onRowClick: props.onRowClick,
          onRowDoubleClick: props.onRowDoubleClick,
          onRowContextMenu: (row, x, y) => onRowContextMenuRef.current?.(row, x, y),
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

### 3.4 Update packages/ui/src/tables/TorrentTable.tsx

Add context menu prop:

```tsx
export interface TorrentTableProps {
  source: TorrentSource
  getSelectedHashes?: () => Set<string>
  onSelectionChange?: (hashes: Set<string>) => void
  onRowClick?: (torrent: Torrent) => void
  onRowDoubleClick?: (torrent: Torrent) => void
  onRowContextMenu?: (torrent: Torrent, x: number, y: number) => void
}

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
      onRowContextMenu={props.onRowContextMenu}
      rowHeight={28}
    />
  )
}
```

---

## Phase 4: Update UI Exports

### 4.1 Update packages/ui/src/index.ts

Add new components:

```ts
// Components
export { TorrentItem } from './components/TorrentItem'
export type { TorrentItemProps } from './components/TorrentItem'
export { DetailPane } from './components/DetailPane'
export type { DetailTab, DetailPaneProps } from './components/DetailPane'
export { ContextMenu } from './components/ContextMenu'
export type { ContextMenuItem, ContextMenuProps } from './components/ContextMenu'
export { DropdownMenu } from './components/DropdownMenu'
export type { DropdownMenuProps } from './components/DropdownMenu'

// Tables
export { TorrentTable, torrentColumns } from './tables/TorrentTable'
export { PeerTable } from './tables/PeerTable'
export { PieceTable } from './tables/PieceTable'
export type { PieceInfo } from './tables/PieceTable'
export { TableMount } from './tables/mount'
export type { ColumnDef, ColumnConfig, TableMountProps } from './tables/types'

// Utils
export * from './utils/format'
```

---

## Phase 5: Update App with Menus and Smart Buttons

### 5.1 Update extension/src/ui/app.tsx

This is a significant update. Here's the full AppContent component:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef, useMemo } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import { 
  TorrentTable, 
  DetailPane, 
  ContextMenu, 
  DropdownMenu,
  formatBytes,
  ContextMenuItem 
} from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

interface ContextMenuState {
  x: number
  y: number
  torrent: Torrent
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get selected torrent objects
  const selectedTorrentObjects = useMemo(() => {
    return [...selectedTorrents]
      .map(hash => adapter.getTorrent(hash))
      .filter((t): t is Torrent => t !== undefined)
  }, [selectedTorrents, adapter, torrents]) // include torrents to re-compute when list changes

  // Smart button states
  const hasSelection = selectedTorrents.size > 0
  const allStarted = hasSelection && selectedTorrentObjects.every(t => t.userState !== 'stopped')
  const allStopped = hasSelection && selectedTorrentObjects.every(t => t.userState === 'stopped')

  // --- Action handlers ---

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

  const handleStartSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState === 'stopped') {
        t.userStart()
      }
    }
  }

  const handleStopSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState !== 'stopped') {
        t.userStop()
      }
    }
  }

  const handleDeleteSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await adapter.removeTorrent(t)
    }
    setSelectedTorrents(new Set())
  }

  const handleRecheckSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await t.recheckData()
    }
  }

  const handleResetSelected = async () => {
    // Reset = remove + re-add in stopped state
    for (const t of selectedTorrentObjects) {
      const magnet = generateMagnet({
        infoHash: t.infoHashStr,
        name: t.name,
        announce: t.announce,
      })
      await adapter.removeTorrent(t)
      await adapter.addTorrent(magnet, { userState: 'stopped' })
    }
    setSelectedTorrents(new Set())
  }

  const handleCopyMagnet = () => {
    const magnets = selectedTorrentObjects.map(t => 
      generateMagnet({
        infoHash: t.infoHashStr,
        name: t.name,
        announce: t.announce,
      })
    )
    navigator.clipboard.writeText(magnets.join('\n'))
  }

  // --- Menu items ---

  const moreMenuItems: ContextMenuItem[] = [
    { id: 'recheck', label: 'Re-verify Data', icon: '🔍' },
    { id: 'reset', label: 'Reset State', icon: '↺' },
    { id: 'separator1', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '🔗' },
  ]

  const contextMenuItems: ContextMenuItem[] = [
    { id: 'start', label: 'Start', icon: '▶', disabled: allStarted },
    { id: 'stop', label: 'Stop', icon: '⏸', disabled: allStopped },
    { id: 'separator1', label: '', separator: true },
    { id: 'recheck', label: 'Re-verify Data', icon: '🔍' },
    { id: 'reset', label: 'Reset State', icon: '↺' },
    { id: 'separator2', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '🔗' },
    { id: 'separator3', label: '', separator: true },
    { id: 'remove', label: 'Remove', icon: '✕', danger: true },
  ]

  const handleMenuAction = (id: string) => {
    switch (id) {
      case 'start':
        handleStartSelected()
        break
      case 'stop':
        handleStopSelected()
        break
      case 'recheck':
        handleRecheckSelected()
        break
      case 'reset':
        handleResetSelected()
        break
      case 'copyMagnet':
        handleCopyMagnet()
        break
      case 'remove':
        handleDeleteSelected()
        break
    }
  }

  const handleContextMenu = (torrent: Torrent, x: number, y: number) => {
    setContextMenu({ x, y, torrent })
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
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>

        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'torrents' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'torrents' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'settings' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Settings
          </button>
        </div>

        <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '12px' }}>
          {torrents.length} torrents | {numConnections} peers |{' '}
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
                padding: '6px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '6px',
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
                  if (e.key === 'Enter') handleAddTorrent()
                }}
                placeholder="Magnet link or URL"
                style={{ flex: 1, padding: '4px 8px', maxWidth: '350px', fontSize: '13px' }}
              />
              <button
                onClick={handleAddTorrent}
                style={{ padding: '4px 10px', cursor: 'pointer', fontSize: '13px' }}
              >
                Add
              </button>
              
              <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />
              
              <button
                onClick={handleStartSelected}
                disabled={!hasSelection || allStarted}
                style={{
                  padding: '4px 10px',
                  cursor: hasSelection && !allStarted ? 'pointer' : 'default',
                  fontSize: '13px',
                  opacity: !hasSelection || allStarted ? 0.5 : 1,
                }}
                title="Start selected"
              >
                ▶ Start
              </button>
              <button
                onClick={handleStopSelected}
                disabled={!hasSelection || allStopped}
                style={{
                  padding: '4px 10px',
                  cursor: hasSelection && !allStopped ? 'pointer' : 'default',
                  fontSize: '13px',
                  opacity: !hasSelection || allStopped ? 0.5 : 1,
                }}
                title="Stop selected"
              >
                ⏸ Stop
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={!hasSelection}
                style={{
                  padding: '4px 10px',
                  cursor: hasSelection ? 'pointer' : 'default',
                  fontSize: '13px',
                  color: 'var(--accent-error)',
                  opacity: hasSelection ? 1 : 0.5,
                }}
                title="Remove selected"
              >
                ✕ Remove
              </button>
              
              <DropdownMenu
                label="More"
                items={moreMenuItems}
                onSelect={handleMenuAction}
                disabled={!hasSelection}
              />
            </div>

            {/* Main content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Torrent table */}
              <div style={{ flex: 1, minHeight: 150, borderBottom: '1px solid var(--border-color)' }}>
                {torrents.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No torrents. Add a magnet link to get started.
                  </div>
                ) : (
                  <TorrentTable
                    source={adapter}
                    getSelectedHashes={() => selectedTorrents}
                    onSelectionChange={setSelectedTorrents}
                    onRowDoubleClick={(torrent: Torrent) => {
                      if (torrent.userState === 'stopped') {
                        torrent.userStart()
                      } else {
                        torrent.userStop()
                      }
                    }}
                    onRowContextMenu={handleContextMenu}
                  />
                )}
              </div>

              {/* Detail pane */}
              <div style={{ height: 250, minHeight: 100 }}>
                <DetailPane source={adapter} selectedHashes={selectedTorrents} />
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onSelect={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
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

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>
  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  if (!engine) return <div style={{ padding: '20px' }}>Failed to initialize engine</div>

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

## Phase 6: Verification

```bash
# 1. Start dev server
cd extension && pnpm dev:web

# 2. Manual testing:

# Context menu:
# - Right-click a torrent → menu appears at cursor
# - Right-click unselected torrent → selects it, then shows menu
# - Multi-select → right-click → menu applies to all selected
# - Click action → action runs, menu closes
# - Click outside menu → menu closes
# - Press Escape → menu closes

# Toolbar dropdown:
# - No selection → "More" button disabled
# - Select torrent(s) → "More" button enabled
# - Click "More" → dropdown appears
# - Click action → runs for all selected

# Smart buttons:
# - No selection → Start, Stop, Remove all disabled (dim)
# - Select stopped torrent → Start enabled, Stop disabled
# - Select running torrent → Start disabled, Stop enabled
# - Select mix → both enabled
# - After starting all → Start becomes disabled
```

---

## Checklist

### Phase 1: ContextMenu
- [ ] Create packages/ui/src/components/ContextMenu.tsx

### Phase 2: DropdownMenu
- [ ] Create packages/ui/src/components/DropdownMenu.tsx

### Phase 3: VirtualTable context menu
- [ ] Add onRowContextMenu to types.ts
- [ ] Add onContextMenu handler to VirtualTable.solid.tsx row div
- [ ] Add ref pattern for onRowContextMenu in mount.tsx
- [ ] Add prop to TorrentTable.tsx

### Phase 4: Exports
- [ ] Update packages/ui/src/index.ts with new components

### Phase 5: App integration
- [ ] Add context menu state
- [ ] Add selectedTorrentObjects derived state
- [ ] Add smart button logic (allStarted, allStopped)
- [ ] Add menu action handlers
- [ ] Add DropdownMenu to toolbar
- [ ] Add onRowContextMenu to TorrentTable
- [ ] Render ContextMenu when state is set

### Phase 6: Testing
- [ ] Right-click shows menu
- [ ] Actions work for single and multi-select
- [ ] Toolbar dropdown works
- [ ] Smart button states correct
- [ ] Menus close properly
