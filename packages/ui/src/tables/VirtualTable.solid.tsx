/* eslint-disable @typescript-eslint/ban-ts-comment, react/no-unknown-property */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
import { createSignal, For, onCleanup, onMount, createMemo } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import {
  getColumnWidth,
  loadColumnConfig,
  saveColumnConfig,
  createCompareFunction,
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
    sortedKeys = sortedKeys.filter((key) => sourceMap.has(key))

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
    return sortedKeys
      .map((key) => sourceMap.get(key))
      .filter((item): item is T => item !== undefined)
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

  // Get visible columns in display order (from columnOrder, filtered by visible)
  const visibleColumns = createMemo(() => {
    const config = columnConfig()
    const visibleSet = new Set(config.visible)
    return config.columnOrder
      .filter((id) => visibleSet.has(id))
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
  const [headerMenu, setHeaderMenu] = createSignal<{
    x: number
    y: number
    columnId: string
  } | null>(null)

  // Constrain menu position to viewport bounds
  const constrainToViewport = (
    x: number,
    y: number,
    menuWidth: number,
    menuHeight: number,
  ): { x: number; y: number } => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const padding = 8 // Keep some padding from edges

    // Constrain X: if menu would overflow right, move it left
    let constrainedX = x
    if (x + menuWidth > viewportWidth - padding) {
      constrainedX = Math.max(padding, viewportWidth - menuWidth - padding)
    }
    if (constrainedX < padding) {
      constrainedX = padding
    }

    // Constrain Y: if menu would overflow bottom, move it up
    let constrainedY = y
    if (y + menuHeight > viewportHeight - padding) {
      constrainedY = Math.max(padding, viewportHeight - menuHeight - padding)
    }
    if (constrainedY < padding) {
      constrainedY = padding
    }

    return { x: constrainedX, y: constrainedY }
  }

  // Estimated menu dimensions (used for initial positioning)
  const SETTINGS_MENU_WIDTH = 220
  const SETTINGS_MENU_HEIGHT = 400 // Approximate max height
  const CONTEXT_MENU_WIDTH = 180
  const CONTEXT_MENU_HEIGHT = 120 // 3 items + padding

  const handleSettingsClick = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pos = constrainToViewport(
      rect.right - SETTINGS_MENU_WIDTH,
      rect.bottom + 4,
      SETTINGS_MENU_WIDTH,
      SETTINGS_MENU_HEIGHT,
    )
    setSettingsPos(pos)
    setShowSettings(!showSettings())
  }

  const handleHeaderContextMenu = (e: MouseEvent, column: ColumnDef<T>) => {
    e.preventDefault()
    const pos = constrainToViewport(e.clientX, e.clientY, CONTEXT_MENU_WIDTH, CONTEXT_MENU_HEIGHT)
    setHeaderMenu({ x: pos.x, y: pos.y, columnId: column.id })
  }

  // Close menus when clicking outside
  const handleDocumentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    // Don't close if clicking the settings button (it handles its own toggle)
    if (target.closest('[title="Column settings"]')) return
    // Don't close if clicking inside the settings menu
    if (target.closest('[data-settings-menu]')) return
    // Don't close if clicking inside the header context menu
    if (target.closest('[data-header-menu]')) return

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

  // Column visibility toggle - just adds/removes from visible set
  // Display order is controlled by columnOrder
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
      // Add to visible - order is determined by columnOrder
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

  // Drag state for column reordering (mouse and touch)
  const [draggedColumn, setDraggedColumn] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<string | null>(null)

  // Touch drag state for column reordering
  const [touchDragState, setTouchDragState] = createSignal<{
    columnId: string
    startY: number
    currentY: number
    itemHeight: number
  } | null>(null)

  // Reorder column to new position (updates columnOrder)
  const reorderColumn = (columnId: string, targetId: string) => {
    if (columnId === targetId) return

    const config = columnConfig()
    const newOrder = [...config.columnOrder]

    const fromIndex = newOrder.indexOf(columnId)
    const toIndex = newOrder.indexOf(targetId)

    if (fromIndex === -1 || toIndex === -1) return

    // Remove from old position and insert at new position
    newOrder.splice(fromIndex, 1)
    newOrder.splice(toIndex, 0, columnId)

    saveConfig({ ...config, columnOrder: newOrder })
  }

  // Move column to the end of the list
  const moveColumnToEnd = (columnId: string) => {
    const config = columnConfig()
    const newOrder = config.columnOrder.filter((id) => id !== columnId)
    newOrder.push(columnId)
    saveConfig({ ...config, columnOrder: newOrder })
  }

  // Get columns in display order (from columnOrder)
  const orderedColumns = createMemo(() => {
    const config = columnConfig()
    return config.columnOrder
      .map((id) => props.columns.find((c) => c.id === id))
      .filter((c): c is ColumnDef<T> => c !== undefined)
  })

  // Touch handlers for column reordering (all columns can be reordered)
  const handleColumnTouchStart = (e: TouchEvent, columnId: string) => {
    const touch = e.touches[0]
    const target = e.currentTarget as HTMLElement
    const itemHeight = target.offsetHeight

    setTouchDragState({
      columnId,
      startY: touch.clientY,
      currentY: touch.clientY,
      itemHeight,
    })
    setDraggedColumn(columnId)
  }

  const handleColumnTouchMove = (e: TouchEvent) => {
    const state = touchDragState()
    if (!state) return

    e.preventDefault() // Prevent scrolling while dragging
    const touch = e.touches[0]

    setTouchDragState({ ...state, currentY: touch.clientY })

    // Find which column we're over
    const menuElement = (e.currentTarget as HTMLElement).closest('[data-settings-menu]')
    if (!menuElement) return

    // Check for end drop zone first
    const endZone = menuElement.querySelector('[data-drop-end]')
    if (endZone) {
      const endRect = endZone.getBoundingClientRect()
      if (touch.clientY >= endRect.top && touch.clientY <= endRect.bottom) {
        setDropTarget('__end__')
        return
      }
    }

    const items = menuElement.querySelectorAll('[data-column-item]')
    for (const item of items) {
      const rect = item.getBoundingClientRect()
      const itemColumnId = item.getAttribute('data-column-item')

      if (
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom &&
        itemColumnId &&
        itemColumnId !== state.columnId
      ) {
        setDropTarget(itemColumnId)
        break
      }
    }
  }

  const handleColumnTouchEnd = () => {
    const state = touchDragState()
    const target = dropTarget()

    if (state && target && state.columnId !== target) {
      if (target === '__end__') {
        moveColumnToEnd(state.columnId)
      } else {
        reorderColumn(state.columnId, target)
      }
    }

    setTouchDragState(null)
    setDraggedColumn(null)
    setDropTarget(null)
  }

  // Column resize state
  const [resizing, setResizing] = createSignal<{
    columnId: string
    startX: number
    startWidth: number
  } | null>(null)

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

  // Touch resize handler for mobile
  const handleResizeTouchStart = (e: TouchEvent, column: ColumnDef<T>) => {
    e.preventDefault()
    e.stopPropagation()

    const touch = e.touches[0]
    const config = columnConfig()
    const startWidth = getColumnWidth(column, config)

    setResizing({ columnId: column.id, startX: touch.clientX, startWidth })

    const handleTouchMove = (e: TouchEvent) => {
      const r = resizing()
      if (!r) return

      const touch = e.touches[0]
      const delta = touch.clientX - r.startX
      const newWidth = Math.max(column.minWidth ?? 40, r.startWidth + delta)

      const config = columnConfig()
      saveConfig({
        ...config,
        widths: { ...config.widths, [r.columnId]: newWidth },
      })
    }

    const handleTouchEnd = () => {
      setResizing(null)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
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
              // Use accessor functions for reactive values
              const isSorted = () => columnConfig().sortColumn === column.id
              const sortDir = () => columnConfig().sortDirection
              const isLiveSort = () => columnConfig().liveSort

              return (
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
                    cursor: column.sortable !== false ? 'pointer' : 'default',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': column.align === 'right' ? 'flex-end' : 'flex-start',
                    gap: '4px',
                    position: 'relative',
                    background: 'var(--bg-secondary, #f5f5f5)',
                  }}
                  onClick={() => handleHeaderClick(column)}
                  onContextMenu={(e) => handleHeaderContextMenu(e, column)}
                >
                  <span>{column.header}</span>
                  {isSorted() && (
                    <span style={{ 'font-size': '10px', opacity: 0.7 }}>
                      {sortDir() === 'asc' ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                  {isLiveSort() && isSorted() && (
                    <span style={{ 'font-size': '8px', color: 'var(--accent-primary, #1976d2)' }}>
                      {'\u25CF'}
                    </span>
                  )}
                  {/* Resize handle - wider touch target for mobile */}
                  <div
                    style={{
                      position: 'absolute',
                      right: '-6px',
                      top: '0',
                      bottom: '0',
                      width: '16px',
                      cursor: 'col-resize',
                      background: 'transparent',
                      'touch-action': 'none',
                      'z-index': '1',
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => handleResizeStart(e, column)}
                    onTouchStart={(e) => handleResizeTouchStart(e, column)}
                  />
                </div>
              )
            }}
          </For>
        </div>

        {/* Dead space + settings button */}
        <div
          style={{
            flex: '1',
            'min-width': '40px',
            display: 'flex',
            'justify-content': 'flex-end',
            'align-items': 'center',
            'padding-right': '4px',
          }}
        >
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
            {'\u2699'}
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
                style:background={
                  isSelected() ? 'var(--bg-highlight, #264f78)' : 'var(--bg-primary, #1e1e1e)'
                }
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
          data-settings-menu
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
            'max-height': 'calc(100vh - 16px)',
            overflow: 'auto',
            'font-weight': 'normal',
          }}
        >
          <div style={{ padding: '8px 0' }}>
            <For each={orderedColumns()}>
              {(column) => {
                // Use accessor functions for reactive values
                const isVisible = () => columnConfig().visible.includes(column.id)
                const isSorted = () => columnConfig().sortColumn === column.id
                const isDragging = () => draggedColumn() === column.id
                const isDropTarget = () =>
                  dropTarget() === column.id && draggedColumn() !== column.id

                return (
                  <div
                    data-column-item={column.id}
                    draggable={true}
                    onDragStart={(e) => {
                      setDraggedColumn(column.id)
                      e.dataTransfer!.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      const dragged = draggedColumn()
                      const target = dropTarget()
                      if (dragged && target && dragged !== target) {
                        if (target === '__end__') {
                          moveColumnToEnd(dragged)
                        } else {
                          reorderColumn(dragged, target)
                        }
                      }
                      setDraggedColumn(null)
                      setDropTarget(null)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDropTarget(column.id)
                    }}
                    onDragLeave={() => {
                      if (dropTarget() === column.id) {
                        setDropTarget(null)
                      }
                    }}
                    onTouchStart={(e) => handleColumnTouchStart(e, column.id)}
                    onTouchMove={handleColumnTouchMove}
                    onTouchEnd={handleColumnTouchEnd}
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      padding: '6px 12px',
                      gap: '8px',
                      opacity: isDragging() ? 0.5 : 1,
                      background: isDropTarget() ? 'var(--bg-secondary, #f0f0f0)' : 'transparent',
                      'border-top': isDropTarget()
                        ? '2px solid var(--accent-primary, #1976d2)'
                        : '2px solid transparent',
                      cursor: 'grab',
                      'touch-action': 'none',
                    }}
                  >
                    {/* Drag handle */}
                    <span
                      style={{
                        opacity: '0.4',
                        cursor: 'grab',
                        'font-size': '12px',
                        'user-select': 'none',
                      }}
                    >
                      {'\u2630'}
                    </span>

                    {/* Visibility checkbox */}
                    <input
                      type="checkbox"
                      checked={isVisible()}
                      disabled={column.hideable === false}
                      onClick={() => toggleColumnVisibility(column.id)}
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
                    {isSorted() && (
                      <span style={{ 'font-size': '10px', opacity: 0.7 }}>
                        {columnConfig().sortDirection === 'asc' ? '\u25B2' : '\u25BC'}
                      </span>
                    )}
                  </div>
                )
              }}
            </For>

            {/* End drop target - for moving columns to the end */}
            <div
              data-drop-end
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget('__end__')
              }}
              onDragLeave={() => {
                if (dropTarget() === '__end__') {
                  setDropTarget(null)
                }
              }}
              style={{
                height: '24px',
                margin: '0 12px',
                'border-radius': '4px',
                background:
                  dropTarget() === '__end__' ? 'var(--bg-secondary, #f0f0f0)' : 'transparent',
                'border-top':
                  dropTarget() === '__end__'
                    ? '2px solid var(--accent-primary, #1976d2)'
                    : '2px solid transparent',
              }}
            />
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
              <input type="checkbox" checked={columnConfig().liveSort} onClick={toggleLiveSort} />
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
          data-header-menu
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')
            }
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <input
              type="checkbox"
              checked={columnConfig().liveSort}
              onClick={() => {
                toggleLiveSort()
              }}
            />
            Live Sort
          </label>
          <div
            style={{ height: '1px', background: 'var(--border-color, #ddd)', margin: '4px 0' }}
          />
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
              // Position settings menu at same location as context menu, constrained to viewport
              const menu = headerMenu()
              if (menu) {
                const pos = constrainToViewport(
                  menu.x,
                  menu.y,
                  SETTINGS_MENU_WIDTH,
                  SETTINGS_MENU_HEIGHT,
                )
                setSettingsPos(pos)
              }
              setHeaderMenu(null)
              setShowSettings(true)
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            Table Settings...
          </button>
        </div>
      )}
    </div>
  )
}
