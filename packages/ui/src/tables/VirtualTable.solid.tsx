/* eslint-disable @typescript-eslint/ban-ts-comment, react/no-unknown-property */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
import { createSignal, createEffect, For, onCleanup, onMount, createMemo } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import {
  getColumnWidth,
  getBaseWidthForStorage,
  getScaledMinWidth,
  getUiScale,
  loadColumnConfig,
  saveColumnConfig,
  createCompareFunction,
} from './column-config'
import { createThrottledRaf } from '../utils/throttledRaf'
import { getMaxFps } from '../hooks/useAppSettings'

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
  getRowTooltip?: (row: T) => string | undefined
  rowHeight?: number
  getRowStyle?: (row: T) => Record<string, string> | undefined
  /** Callback to receive forceUpdate function for external refresh triggering */
  onForceUpdate?: (forceUpdate: () => void) => void
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

// Get row height from CSS variable (with fallback)
function getRowHeightFromCSS(): number {
  const style = getComputedStyle(document.documentElement)
  const value = style.getPropertyValue('--row-height')
  return value ? parseInt(value, 10) : 32
}

export function VirtualTable<T>(props: VirtualTableProps<T>) {
  // Use CSS variable for row height, re-read on scale changes
  const [rowHeight, setRowHeight] = createSignal(props.rowHeight ?? getRowHeightFromCSS())

  // Track UI scale for column width scaling (signal triggers re-computation of widths)
  const [uiScale, setUiScale] = createSignal(getUiScale())

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

  // Expose forceUpdate to parent for external refresh triggering
  props.onForceUpdate?.(() => forceUpdate({}))

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

  // Focus index for keyboard navigation (tracks keyboard cursor position)
  const [focusIndex, setFocusIndex] = createSignal<number | null>(null)

  // Local selection state for instant feedback (avoids React async state update delay)
  const [selectedKeys, setSelectedKeys] = createSignal<Set<string>>(
    props.getSelectedKeys?.() ?? new Set(),
  )

  // Track if we're the source of the last selection change (to avoid sync loops).
  // This is needed because selection state lives in two places:
  // 1. React's selectedTorrents state in App.tsx (source of truth for toolbar actions)
  // 2. Solid's selectedKeys signal here (for instant visual feedback on row clicks)
  //
  // When the user clicks a row, we update local state immediately for snappy UI,
  // then notify React via onSelectionChange. React updates its state async.
  // Without this flag, the sync effect below would see the mismatch and re-sync,
  // potentially causing flicker or race conditions.
  let localSelectionChange = false

  // Update selection: local signal (instant) + notify parent
  const updateSelection = (keys: Set<string>) => {
    localSelectionChange = true
    setSelectedKeys(keys)
    props.onSelectionChange?.(keys)
    // Reset flag after React has had time to process the state update.
    // setTimeout(0) ensures this runs after the current event loop tick,
    // giving React's setState time to batch and apply the change.
    setTimeout(() => {
      localSelectionChange = false
    }, 0)
  }

  // Sync local selection from parent when React changes selection externally.
  //
  // Problem: React can clear selection without going through this table (e.g., when
  // "Reset State" action calls setSelectedTorrents(new Set()) in App.tsx). When this
  // happens, React's toolbar shows "no selection" but Solid's local state still has
  // the old selection, causing the row to stay visually highlighted - a desync.
  //
  // Solution: On each RAF tick, compare parent (React) and local (Solid) selection.
  // If they differ and we didn't cause the change, sync local to match parent.
  // This runs ~60fps but the comparison is cheap (just set size + membership check).
  createEffect(() => {
    tick() // Subscribe to RAF updates
    if (localSelectionChange) return // Skip if we caused the change

    const parentKeys = props.getSelectedKeys?.() ?? new Set()
    const localKeys = selectedKeys()

    // Check if they differ
    if (parentKeys.size !== localKeys.size) {
      setSelectedKeys(new Set(parentKeys))
    } else if (parentKeys.size > 0) {
      // Same size but check contents
      for (const k of parentKeys) {
        if (!localKeys.has(k)) {
          setSelectedKeys(new Set(parentKeys))
          break
        }
      }
    }
  })

  // Create virtualizer
  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => rowHeight(),
    overscan: 5,
  })

  // Virtual items - use effect + signal to force immediate updates when tick changes
  const [virtualItems, setVirtualItems] = createSignal(virtualizer.getVirtualItems())
  createEffect(() => {
    tick() // Subscribe to RAF/forceUpdate
    setVirtualItems(virtualizer.getVirtualItems())
  })

  // Throttled RAF loop for live updates (respects maxFps setting)
  let throttledRaf: { start: () => void; stop: () => void } | undefined

  onMount(() => {
    throttledRaf = createThrottledRaf(() => forceUpdate({}), getMaxFps)
    throttledRaf.start()

    // Watch for UI scale changes via MutationObserver on data-scale attribute
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-scale') {
          if (!props.rowHeight) {
            setRowHeight(getRowHeightFromCSS())
          }
          setUiScale(getUiScale())
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-scale'],
    })
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    throttledRaf?.stop()
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

  // Calculate total width (re-computes when scale changes via uiScale signal)
  const totalWidth = createMemo(() => {
    const config = columnConfig()
    uiScale() // Subscribe to scale changes
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

    if (!props.onSelectionChange) return

    const key = props.getRowKey(row)
    const current = selectedKeys()
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
        updateSelection(next)
      } else {
        updateSelection(rangeKeys)
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      updateSelection(next)
      anchorIndex = index
    } else {
      updateSelection(new Set([key]))
      anchorIndex = index
    }
    setFocusIndex(index)
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    // Handle Escape to clear selection
    if (e.key === 'Escape') {
      if (props.onSelectionChange && selectedKeys().size > 0) {
        e.preventDefault()
        updateSelection(new Set())
        anchorIndex = null
        setFocusIndex(null)
      }
      return
    }

    // Handle Ctrl+A / Cmd+A for select all
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      if (!props.onSelectionChange) return

      const allRows = rows()
      const allKeys = new Set<string>()
      for (const row of allRows) {
        allKeys.add(props.getRowKey(row))
      }
      updateSelection(allKeys)
      return
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (!props.onSelectionChange) return

    e.preventDefault()
    const allRows = rows()
    if (allRows.length === 0) return

    // Determine starting index (use focus, then anchor, then 0)
    const startIndex = focusIndex() ?? anchorIndex ?? 0

    // Calculate new index
    const newIndex =
      e.key === 'ArrowUp'
        ? Math.max(0, startIndex - 1)
        : Math.min(allRows.length - 1, startIndex + 1)

    const key = props.getRowKey(allRows[newIndex])

    if (e.shiftKey) {
      // Range selection from anchor to newIndex
      if (anchorIndex === null) anchorIndex = startIndex
      const start = Math.min(anchorIndex, newIndex)
      const end = Math.max(anchorIndex, newIndex)
      const rangeKeys = new Set<string>()
      for (let i = start; i <= end; i++) {
        rangeKeys.add(props.getRowKey(allRows[i]))
      }
      updateSelection(rangeKeys)
    } else {
      // Single selection
      updateSelection(new Set([key]))
      anchorIndex = newIndex
    }

    setFocusIndex(newIndex)

    // Scroll into view
    virtualizer.scrollToIndex(newIndex, { align: 'auto' })
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
  // Calculate settings menu height based on number of columns
  // Each column item is ~32px (6px padding × 2 + content), plus end drop zone (24px),
  // live sort section (~56px), and container padding (~16px)
  const SETTINGS_MENU_HEIGHT = props.columns.length * 32 + 24 + 56 + 16
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

  // Close menus when pressing Escape
  const handleDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showSettings()) {
        setShowSettings(false)
        e.preventDefault()
      }
      if (headerMenu()) {
        setHeaderMenu(null)
        e.preventDefault()
      }
    }
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleDocumentKeyDown)
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
      const newWidth = Math.max(getScaledMinWidth(column), r.startWidth + delta)

      const config = columnConfig()
      saveConfig({
        ...config,
        widths: { ...config.widths, [r.columnId]: getBaseWidthForStorage(newWidth) },
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
      const newWidth = Math.max(getScaledMinWidth(column), r.startWidth + delta)

      const config = columnConfig()
      saveConfig({
        ...config,
        widths: { ...config.widths, [r.columnId]: getBaseWidthForStorage(newWidth) },
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
      tabindex="0"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        // Clear selection when clicking empty space (not on a row, header, or menu)
        const target = e.target as HTMLElement
        if (
          !target.closest('[data-testid="table-row"]') &&
          !target.closest('[data-settings-menu]') &&
          !target.closest('[data-header-menu]') &&
          !target.closest('button') &&
          props.onSelectionChange &&
          selectedKeys().size > 0
        ) {
          updateSelection(new Set())
          anchorIndex = null
          setFocusIndex(null)
        }
      }}
      style={{
        height: '100%',
        overflow: 'auto',
        'font-family': 'system-ui, sans-serif',
        'font-size': 'var(--font-base, 13px)',
        'user-select': 'none',
        position: 'relative',
        outline: 'none',
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
          width: `${totalWidth()}px`,
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
                    padding: 'var(--spacing-sm, 8px) var(--spacing-md, 12px)',
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
                    gap: 'var(--spacing-xs, 4px)',
                    position: 'relative',
                    background: 'var(--bg-secondary, #f5f5f5)',
                  }}
                  onClick={() => handleHeaderClick(column)}
                  onContextMenu={(e) => handleHeaderContextMenu(e, column)}
                >
                  <span>{column.header}</span>
                  {isSorted() && (
                    <span style={{ 'font-size': 'var(--font-xs, 10px)', opacity: 0.7 }}>
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
        <For each={virtualItems()}>
          {(virtualRow) => {
            const row = () => rows()[virtualRow.index]
            const key = () => props.getRowKey(row())
            const isSelected = () => selectedKeys().has(key())

            return (
              <div
                data-testid="table-row"
                data-row-key={key()}
                data-selected={isSelected()}
                title={props.getRowTooltip?.(row())}
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
                  ...props.getRowStyle?.(row()),
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

                  if (!selectedKeys().has(k)) {
                    updateSelection(new Set([k]))
                    anchorIndex = virtualRow.index
                    setFocusIndex(virtualRow.index)
                  }

                  props.onRowContextMenu?.(r, e.clientX, e.clientY)
                }}
              >
                <For each={visibleColumns()}>
                  {(column) => (
                    <div
                      title={column.getCellTitle?.(row())}
                      style={{
                        width: `${getColumnWidth(column, columnConfig())}px`,
                        padding: '0 var(--spacing-md, 12px)',
                        'box-sizing': 'border-box',
                        'text-align': column.align ?? 'left',
                        'white-space': 'nowrap',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'flex-shrink': '0',
                        ...column.getCellStyle?.(row()),
                      }}
                    >
                      {column.renderCell
                        ? column.renderCell(row(), column.getValue(row()))
                        : column.getValue(row())}
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
