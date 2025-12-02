/* eslint-disable @typescript-eslint/ban-ts-comment, react/no-unknown-property */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
import { createSignal, For, onCleanup, onMount } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { ColumnDef, ColumnConfig } from './types'
import { getColumnWidth, loadColumnConfig } from './column-config'

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

export function VirtualTable<T>(props: VirtualTableProps<T>) {
  const rowHeight = props.rowHeight ?? 32

  // Column configuration (persisted)
  const [columnConfig, _setColumnConfig] = createSignal<ColumnConfig>(
    loadColumnConfig(props.storageKey, props.columns),
  )

  // Anchor index for shift+click range selection
  let anchorIndex: number | null = null

  // Container ref for virtualizer
  let containerRef: HTMLDivElement | undefined

  // RAF-based update loop for live data
  let rafId: number | undefined
  const [tick, forceUpdate] = createSignal({}, { equals: false })

  // Derived accessor that subscribes to RAF updates
  const rows = () => {
    tick() // Subscribe to the RAF signal
    return props.getRows()
  }

  // Create virtualizer
  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => rowHeight,
    overscan: 5,
  })

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
            const isSelected = () => {
              tick() // Subscribe to RAF updates so selection changes are reactive
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

                  // If right-clicking an unselected row, select it first
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
    </div>
  )
}
