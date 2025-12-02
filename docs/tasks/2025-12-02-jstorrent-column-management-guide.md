# JSTorrent Column Management

## Overview

Add comprehensive column management to virtualized tables:
- **Sort by column** - click header to sort, click again to reverse
- **Live sort** - damped insertion sort for continuously changing data
- **Column resize** - drag header edge
- **Column visibility** - show/hide columns
- **Column reorder** - drag to reorder in settings menu
- **Persistence** - all settings saved to sessionStorage

---

## Data Structures

### Extended ColumnConfig

Update `packages/ui/src/tables/types.ts`:

```ts
/**
 * Column definition for virtualized tables.
 */
export interface ColumnDef<T> {
  id: string
  header: string
  getValue: (row: T) => string | number
  width: number
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** If false, column cannot be hidden. Default true. */
  hideable?: boolean
  /** If false, cannot sort by this column. Default true. */
  sortable?: boolean
}

/**
 * Column visibility, width, order, and sort configuration.
 * Persisted to sessionStorage.
 */
export interface ColumnConfig {
  /** Ordered list of visible column IDs */
  visible: string[]
  /** Column widths (overrides defaults) */
  widths: Record<string, number>
  /** Current sort column ID (null = no sort) */
  sortColumn: string | null
  /** Sort direction */
  sortDirection: 'asc' | 'desc'
  /** Whether live sort is enabled */
  liveSort: boolean
}

/**
 * Props for table mount wrapper (React -> Solid bridge)
 */
export interface TableMountProps<T> {
  getRows: () => T[]
  getRowKey: (row: T) => string
  columns: ColumnDef<T>[]
  storageKey: string
  getSelectedKeys?: () => Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  onRowContextMenu?: (row: T, x: number, y: number) => void
  rowHeight?: number
  estimatedRowCount?: number
}
```

---

## Phase 1: Column Sorting (Click Header)

### 1.1 Update packages/ui/src/tables/column-config.ts

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
  const defaultConfig: ColumnConfig = {
    visible: defaultColumns.map((c) => c.id),
    widths: {},
    sortColumn: null,
    sortDirection: 'asc',
    liveSort: false,
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_PREFIX + storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnConfig>
      return {
        visible: parsed.visible ?? defaultConfig.visible,
        widths: parsed.widths ?? {},
        sortColumn: parsed.sortColumn ?? null,
        sortDirection: parsed.sortDirection ?? 'asc',
        liveSort: parsed.liveSort ?? false,
      }
    }
  } catch {
    // Ignore parse errors
  }

  return defaultConfig
}

/**
 * Save column config to sessionStorage.
 */
export function saveColumnConfig(storageKey: string, config: ColumnConfig): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(config))
  } catch {
    // Ignore storage errors
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

/**
 * Compare function for sorting rows by a column.
 * Includes tiebreaker on key to prevent jitter when values oscillate.
 */
export function createCompareFunction<T>(
  column: ColumnDef<T>,
  direction: 'asc' | 'desc',
  getKey: (row: T) => string,
): (a: T, b: T) => number {
  return (a: T, b: T) => {
    const aVal = column.getValue(a)
    const bVal = column.getValue(b)

    let result: number
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      result = aVal - bVal
    } else {
      result = String(aVal).localeCompare(String(bVal))
    }

    // Apply direction
    result = direction === 'asc' ? result : -result

    // Tiebreaker: use stable key to prevent jitter
    if (result === 0) {
      result = getKey(a).localeCompare(getKey(b))
    }

    return result
  }
}
```

### 1.2 Update VirtualTable.solid.tsx for sorting

This is a significant update. Here's the complete new file:

```tsx
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
import { createSignal, For, onCleanup, onMount, createMemo } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import { 
  getColumnWidth, 
  loadColumnConfig, 
  saveColumnConfig, 
  createCompareFunction 
} from './column-config'

export interface VirtualTableProps<T> {
  getRows: () => T[]
  getRowKey: (row: T) => string
  columns: ColumnDef<T>[]
  storageKey: string
  getSelectedKeys?: () => Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  onRowContextMenu?: (row: T, x: number, y: number) => void
  rowHeight?: number
}

/**
 * Perform one pass of insertion sort on keys, moving at most maxSwaps items.
 * Returns true if any swaps were made.
 */
function insertionSortStep<T>(
  keys: string[],
  sourceMap: Map<string, T>,
  compare: (a: T, b: T) => number,
  maxSwaps: number,
): boolean {
  let swaps = 0

  for (let i = 1; i < keys.length && swaps < maxSwaps; i++) {
    const a = sourceMap.get(keys[i - 1])
    const b = sourceMap.get(keys[i])
    if (a && b && compare(a, b) > 0) {
      const temp = keys[i - 1]
      keys[i - 1] = keys[i]
      keys[i] = temp
      swaps++
    }
  }

  return swaps > 0
}

export function VirtualTable<T>(props: VirtualTableProps<T>) {
  const rowHeight = props.rowHeight ?? 32

  // Column configuration (persisted)
  const [columnConfig, setColumnConfig] = createSignal<ColumnConfig>(
    loadColumnConfig(props.storageKey, props.columns),
  )

  // Save config changes
  const saveConfig = (config: ColumnConfig) => {
    setColumnConfig(config)
    saveColumnConfig(props.storageKey, config)
  }

  // Container ref for virtualizer
  let containerRef: HTMLDivElement | undefined

  // RAF-based update loop for live data
  const [tick, forceUpdate] = createSignal({}, { equals: false })

  // Sorted keys - tracked by row key instead of index
  // This avoids full re-sort when items are added/removed
  let sortedKeys: string[] = []
  let lastSortTime = 0

  // Get sorted rows
  const rows = createMemo(() => {
    tick() // Subscribe to RAF updates

    const source = props.getRows()
    const config = columnConfig()
    
    // Build a map for O(1) lookup by key
    const sourceMap = new Map<string, T>()
    for (const item of source) {
      sourceMap.set(props.getRowKey(item), item)
    }

    // Remove keys that no longer exist in source
    sortedKeys = sortedKeys.filter(key => sourceMap.has(key))

    // Find new keys (items added since last frame)
    const existingKeys = new Set(sortedKeys)
    const newKeys: string[] = []
    for (const item of source) {
      const key = props.getRowKey(item)
      if (!existingKeys.has(key)) {
        newKeys.push(key)
      }
    }

    // If we have new items and a sort column, insert them in roughly sorted position
    // Otherwise append to end (they'll migrate via insertion sort)
    if (newKeys.length > 0) {
      if (config.sortColumn) {
        const col = props.columns.find((c) => c.id === config.sortColumn)
        if (col) {
          const compare = createCompareFunction(col, config.sortDirection, props.getRowKey)
          // Sort just the new keys
          newKeys.sort((aKey, bKey) => {
            const a = sourceMap.get(aKey)
            const b = sourceMap.get(bKey)
            return a && b ? compare(a, b) : 0
          })
        }
      }
      // Append new keys (they'll settle into place via insertion sort)
      sortedKeys.push(...newKeys)
    }

    // Initial sort if sortedKeys was empty (first render)
    if (sortedKeys.length === source.length && sortedKeys.length > 0 && config.sortColumn) {
      const col = props.columns.find((c) => c.id === config.sortColumn)
      if (col && newKeys.length === sortedKeys.length) {
        // All items are new - do a full sort once
        const compare = createCompareFunction(col, config.sortDirection, props.getRowKey)
        sortedKeys.sort((aKey, bKey) => {
          const a = sourceMap.get(aKey)
          const b = sourceMap.get(bKey)
          return a && b ? compare(a, b) : 0
        })
      }
    }

    // Live sort: do one insertion sort step (throttled)
    // This is O(n) comparisons but max 2 swaps - comparisons are cheap
    if (config.liveSort && config.sortColumn) {
      const now = Date.now()
      if (now - lastSortTime > 200) {
        lastSortTime = now
        const col = props.columns.find((c) => c.id === config.sortColumn)
        if (col) {
          const compare = createCompareFunction(col, config.sortDirection, props.getRowKey)
          insertionSortStep(sortedKeys, sourceMap, compare, 2)
        }
      }
    }

    // Return rows in sorted order
    return sortedKeys.map((key) => sourceMap.get(key)).filter((item): item is T => item !== undefined)
  })

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

  // Get visible columns in order
  const visibleColumns = createMemo(() => {
    const config = columnConfig()
    return config.visible
      .map((id) => props.columns.find((c) => c.id === id))
      .filter((c): c is ColumnDef<T> => c !== undefined)
  })

  // Calculate total width
  const totalWidth = createMemo(() => {
    const config = columnConfig()
    return visibleColumns().reduce((sum, col) => sum + getColumnWidth(col, config), 0)
  })

  // Handle header click for sorting
  const handleHeaderClick = (column: ColumnDef<T>) => {
    if (column.sortable === false) return

    const config = columnConfig()
    let newDirection: 'asc' | 'desc' = 'asc'

    if (config.sortColumn === column.id) {
      // Toggle direction
      newDirection = config.sortDirection === 'asc' ? 'desc' : 'asc'
    }

    // Build source map and sort keys
    const source = props.getRows()
    const sourceMap = new Map<string, T>()
    for (const item of source) {
      sourceMap.set(props.getRowKey(item), item)
    }

    sortedKeys = Array.from(sourceMap.keys())
    const compare = createCompareFunction(column, newDirection, props.getRowKey)
    sortedKeys.sort((aKey, bKey) => {
      const a = sourceMap.get(aKey)
      const b = sourceMap.get(bKey)
      return a && b ? compare(a, b) : 0
    })

    saveConfig({
      ...config,
      sortColumn: column.id,
      sortDirection: newDirection,
    })
  }

  // Handle row click with selection logic
  const handleRowClick = (row: T, index: number, e: MouseEvent) => {
    props.onRowClick?.(row)

    if (!props.onSelectionChange || !props.getSelectedKeys) return

    const key = props.getRowKey(row)
    const current = props.getSelectedKeys()
    const allRows = rows()

    if (e.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index)
      const end = Math.max(anchorIndex, index)

      const rangeKeys = new Set<string>()
      for (let i = start; i <= end; i++) {
        if (allRows[i]) {
          rangeKeys.add(props.getRowKey(allRows[i]))
        }
      }

      if (e.ctrlKey || e.metaKey) {
        const next = new Set(current)
        for (const k of rangeKeys) {
          next.add(k)
        }
        props.onSelectionChange(next)
      } else {
        props.onSelectionChange(rangeKeys)
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      props.onSelectionChange(next)
      anchorIndex = index
    } else {
      props.onSelectionChange(new Set([key]))
      anchorIndex = index
    }
  }

  // Settings menu state
  const [showSettings, setShowSettings] = createSignal(false)
  const [settingsPos, setSettingsPos] = createSignal({ x: 0, y: 0 })

  // Header context menu state
  const [headerMenu, setHeaderMenu] = createSignal<{ x: number; y: number; columnId: string } | null>(null)

  const handleSettingsClick = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setSettingsPos({ x: rect.right - 200, y: rect.bottom + 4 })
    setShowSettings(!showSettings())
  }

  const handleHeaderContextMenu = (e: MouseEvent, column: ColumnDef<T>) => {
    e.preventDefault()
    setHeaderMenu({ x: e.clientX, y: e.clientY, columnId: column.id })
  }

  // Close menus when clicking outside
  const handleDocumentClick = (e: MouseEvent) => {
    if (showSettings()) {
      setShowSettings(false)
    }
    if (headerMenu()) {
      setHeaderMenu(null)
    }
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick)
  })

  onCleanup(() => {
    document.removeEventListener('click', handleDocumentClick)
  })

  // Column visibility toggle
  const toggleColumnVisibility = (columnId: string) => {
    const config = columnConfig()
    const isVisible = config.visible.includes(columnId)

    if (isVisible) {
      // Don't hide if it's the last visible column
      if (config.visible.length <= 1) return
      saveConfig({
        ...config,
        visible: config.visible.filter((id) => id !== columnId),
      })
    } else {
      // Add to end of visible list
      saveConfig({
        ...config,
        visible: [...config.visible, columnId],
      })
    }
  }

  // Toggle live sort
  const toggleLiveSort = () => {
    const config = columnConfig()
    saveConfig({ ...config, liveSort: !config.liveSort })
  }

  // Sort by column (from menu)
  const sortByColumn = (columnId: string) => {
    const column = props.columns.find((c) => c.id === columnId)
    if (column) {
      handleHeaderClick(column)
    }
  }

  // Move column in order
  const moveColumn = (columnId: string, direction: 'up' | 'down') => {
    const config = columnConfig()
    const index = config.visible.indexOf(columnId)
    if (index === -1) return

    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= config.visible.length) return

    const newVisible = [...config.visible]
    newVisible.splice(index, 1)
    newVisible.splice(newIndex, 0, columnId)

    saveConfig({ ...config, visible: newVisible })
  }

  // Column resize state
  const [resizing, setResizing] = createSignal<{ columnId: string; startX: number; startWidth: number } | null>(null)

  const handleResizeStart = (e: MouseEvent, column: ColumnDef<T>) => {
    e.preventDefault()
    e.stopPropagation()

    const config = columnConfig()
    const startWidth = getColumnWidth(column, config)

    setResizing({ columnId: column.id, startX: e.clientX, startWidth })

    const handleMouseMove = (e: MouseEvent) => {
      const r = resizing()
      if (!r) return

      const delta = e.clientX - r.startX
      const newWidth = Math.max(column.minWidth ?? 40, r.startWidth + delta)

      const config = columnConfig()
      saveConfig({
        ...config,
        widths: { ...config.widths, [r.columnId]: newWidth },
      })
    }

    const handleMouseUp = () => {
      setResizing(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
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
        position: 'relative',
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
          'z-index': '2',
          'min-width': '100%',
        }}
      >
        {/* Column headers */}
        <div style={{ display: 'flex', width: `${totalWidth()}px` }}>
          <For each={visibleColumns()}>
            {(column) => {
              const config = columnConfig()
              const isSorted = config.sortColumn === column.id
              const sortDir = config.sortDirection

              return (
                <div
                  style={{
                    width: `${getColumnWidth(column, config)}px`,
                    padding: '8px 12px',
                    'box-sizing': 'border-box',
                    'text-align': column.align ?? 'left',
                    'white-space': 'nowrap',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'border-right': '1px solid var(--border-color, #ddd)',
                    'flex-shrink': '0',
                    cursor: column.sortable !== false ? 'pointer' : 'default',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': column.align === 'right' ? 'flex-end' : 'flex-start',
                    gap: '4px',
                    position: 'relative',
                  }}
                  onClick={() => handleHeaderClick(column)}
                  onContextMenu={(e) => handleHeaderContextMenu(e, column)}
                >
                  <span>{column.header}</span>
                  {isSorted && (
                    <span style={{ 'font-size': '10px', opacity: 0.7 }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                  {config.liveSort && isSorted && (
                    <span style={{ 'font-size': '8px', color: 'var(--accent-primary, #1976d2)' }}>●</span>
                  )}
                  {/* Resize handle */}
                  <div
                    style={{
                      position: 'absolute',
                      right: '0',
                      top: '0',
                      bottom: '0',
                      width: '4px',
                      cursor: 'col-resize',
                      background: 'transparent',
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => handleResizeStart(e, column)}
                  />
                </div>
              )
            }}
          </For>
        </div>

        {/* Dead space + settings button */}
        <div style={{ 
          flex: '1', 
          'min-width': '40px',
          display: 'flex',
          'justify-content': 'flex-end',
          'align-items': 'center',
          'padding-right': '4px',
        }}>
          <button
            style={{
              width: '28px',
              height: '28px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              'border-radius': '4px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'font-size': '14px',
              opacity: '0.6',
            }}
            onClick={(e) => {
              e.stopPropagation()
              handleSettingsClick(e)
            }}
            title="Column settings"
          >
            ⚙
          </button>
        </div>
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
            const isSelected = () => {
              tick()
              return props.getSelectedKeys?.().has(key()) ?? false
            }

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
                  cursor: 'default',
                  'border-bottom': '1px solid var(--border-light, #eee)',
                }}
                style:background={isSelected() ? 'var(--bg-selected, #e3f2fd)' : 'var(--bg-primary, #fff)'}
                onClick={(e) => handleRowClick(row(), virtualRow.index, e)}
                onDblClick={() => props.onRowDoubleClick?.(row())}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const r = row()
                  const k = props.getRowKey(r)

                  if (!props.getSelectedKeys?.().has(k)) {
                    props.onSelectionChange?.(new Set([k]))
                    anchorIndex = virtualRow.index
                  }

                  props.onRowContextMenu?.(r, e.clientX, e.clientY)
                }}
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

      {/* Settings Menu */}
      {showSettings() && (
        <div
          style={{
            position: 'fixed',
            left: `${settingsPos().x}px`,
            top: `${settingsPos().y}px`,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-color, #ddd)',
            'border-radius': '6px',
            'box-shadow': '0 4px 12px rgba(0,0,0,0.15)',
            'z-index': '1000',
            'min-width': '200px',
            'font-weight': 'normal',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '8px 0' }}>
            <For each={props.columns}>
              {(column, index) => {
                const config = columnConfig()
                const isVisible = config.visible.includes(column.id)
                const isSorted = config.sortColumn === column.id
                const canMoveUp = isVisible && config.visible.indexOf(column.id) > 0
                const canMoveDown = isVisible && config.visible.indexOf(column.id) < config.visible.length - 1

                return (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      padding: '6px 12px',
                      gap: '8px',
                    }}
                  >
                    {/* Reorder buttons */}
                    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
                      <button
                        style={{
                          width: '16px',
                          height: '12px',
                          border: 'none',
                          background: 'transparent',
                          cursor: canMoveUp ? 'pointer' : 'default',
                          opacity: canMoveUp ? 0.6 : 0.2,
                          'font-size': '8px',
                          padding: 0,
                        }}
                        disabled={!canMoveUp}
                        onClick={() => moveColumn(column.id, 'up')}
                      >
                        ▲
                      </button>
                      <button
                        style={{
                          width: '16px',
                          height: '12px',
                          border: 'none',
                          background: 'transparent',
                          cursor: canMoveDown ? 'pointer' : 'default',
                          opacity: canMoveDown ? 0.6 : 0.2,
                          'font-size': '8px',
                          padding: 0,
                        }}
                        disabled={!canMoveDown}
                        onClick={() => moveColumn(column.id, 'down')}
                      >
                        ▼
                      </button>
                    </div>

                    {/* Visibility checkbox */}
                    <input
                      type="checkbox"
                      checked={isVisible}
                      disabled={column.hideable === false}
                      onChange={() => toggleColumnVisibility(column.id)}
                      style={{ cursor: column.hideable === false ? 'default' : 'pointer' }}
                    />

                    {/* Column name (click to sort) */}
                    <span
                      style={{
                        flex: '1',
                        cursor: column.sortable !== false ? 'pointer' : 'default',
                      }}
                      onClick={() => {
                        if (column.sortable !== false) {
                          sortByColumn(column.id)
                        }
                      }}
                    >
                      {column.header}
                    </span>

                    {/* Sort indicator */}
                    {isSorted && (
                      <span style={{ 'font-size': '10px', opacity: 0.7 }}>
                        {config.sortDirection === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                )
              }}
            </For>
          </div>

          {/* Live sort toggle */}
          <div
            style={{
              'border-top': '1px solid var(--border-color, #ddd)',
              padding: '8px 12px',
            }}
          >
            <label
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={columnConfig().liveSort}
                onChange={toggleLiveSort}
              />
              <span>Live Sort</span>
              {columnConfig().liveSort && (
                <span style={{ 'font-size': '10px', color: 'var(--text-secondary)' }}>
                  (updates every 200ms)
                </span>
              )}
            </label>
          </div>
        </div>
      )}

      {/* Header Context Menu */}
      {headerMenu() && (
        <div
          style={{
            position: 'fixed',
            left: `${headerMenu()!.x}px`,
            top: `${headerMenu()!.y}px`,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-color, #ddd)',
            'border-radius': '6px',
            'box-shadow': '0 4px 12px rgba(0,0,0,0.15)',
            'z-index': '1000',
            'min-width': '160px',
            'font-weight': 'normal',
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: 'none',
              'text-align': 'left',
              cursor: 'pointer',
              'font-size': '13px',
            }}
            onClick={() => {
              toggleColumnVisibility(headerMenu()!.columnId)
              setHeaderMenu(null)
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            Hide Column
          </button>
          <label
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              'font-size': '13px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <input
              type="checkbox"
              checked={columnConfig().liveSort}
              onChange={() => {
                toggleLiveSort()
              }}
            />
            Live Sort
          </label>
          <div style={{ height: '1px', background: 'var(--border-color, #ddd)', margin: '4px 0' }} />
          <button
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: 'none',
              'text-align': 'left',
              cursor: 'pointer',
              'font-size': '13px',
            }}
            onClick={() => {
              setHeaderMenu(null)
              setShowSettings(true)
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            Column Settings...
          </button>
        </div>
      )}
    </div>
  )
}
```

---

## Phase 2: Update mount.tsx

No changes needed - the existing mount.tsx should work since all the new functionality is internal to VirtualTable.

---

## Phase 3: Verification

```bash
# 1. Start dev server
cd extension && pnpm dev:web

# 2. Manual testing:

# Sorting:
# - Click column header → sorts ascending
# - Click same header → sorts descending
# - Arrow indicator shows current sort column/direction
# - Sorting persists across refresh

# Column resize:
# - Hover right edge of column header → cursor becomes col-resize
# - Drag to resize
# - Width persists across refresh

# Settings menu (⚙ button):
# - Click ⚙ → menu opens
# - Uncheck column → column hides
# - Click ▲/▼ → reorder columns
# - Click column name → sort by it
# - Toggle "Live Sort" → enables/disables
# - Click outside → menu closes

# Header context menu:
# - Right-click column header → menu appears
# - "Hide Column" → hides that column
# - "Live Sort" checkbox → toggles live sort
# - "Column Settings..." → opens main settings menu

# Live sort:
# - Enable live sort, sort by a speed column
# - Rows gradually reorder as speeds change
# - Small dot indicator shows live sort is active

# Column visibility:
# - Hidden columns can be shown via settings menu
# - Can't hide the last visible column
```

---

## Checklist

### Phase 1: Core Implementation
- [ ] Update types.ts with extended ColumnConfig
- [ ] Update column-config.ts with sort utilities
- [ ] Replace VirtualTable.solid.tsx with new implementation

### Phase 2: Testing
- [ ] Click-to-sort works
- [ ] Sort direction toggle works
- [ ] Sort indicator displays correctly
- [ ] Column resize works
- [ ] Settings menu opens/closes properly
- [ ] Column visibility toggle works
- [ ] Column reorder works (up/down buttons)
- [ ] Live sort toggle works
- [ ] Damped insertion sort animates smoothly
- [ ] Header context menu works
- [ ] All settings persist to sessionStorage

---

## Notes

**Alignment:** Column definitions already support `align: 'left' | 'center' | 'right'`. Numbers should be right-aligned, text left-aligned.

**Touch support:**
- Column header tap works for sorting
- Settings menu works with touch
- Column resize is harder on touch (4px target) but still possible
- Consider adding resize handles in settings menu for touch-friendly resize (future enhancement)

**Performance:**

*Key-based tracking:*
- Tracks sorted order by row keys (e.g., `ip:port` for peers), not array indices
- When items are added: new keys appended to end, migrate via insertion sort
- When items are removed: keys filtered out, no re-sort needed
- Avoids full re-sort when peer count changes frequently

*Insertion sort step:*
- Scans entire list doing comparisons (O(n) comparisons)
- But comparisons are cheap (number subtraction or string compare)
- Max 2 swaps per step prevents jarring jumps
- Only runs every 200ms when live sort enabled

*Tiebreaker:*
- When two items have equal sort values, falls back to key comparison
- Prevents jitter when values oscillate (e.g., speeds fluctuating between equal values)
- Example: two peers both at 1MB/s won't swap back and forth
