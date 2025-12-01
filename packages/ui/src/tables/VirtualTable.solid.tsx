/* eslint-disable @typescript-eslint/ban-ts-comment, react/no-unknown-property */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
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
  const [columnConfig, _setColumnConfig] = createSignal<ColumnConfig>(
    loadColumnConfig(props.storageKey, props.columns),
  )

  // Save config changes
  createEffect(() => {
    saveColumnConfig(props.storageKey, columnConfig())
  })

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

  // Handle row click
  const handleRowClick = (row: T, e: MouseEvent) => {
    console.log(row)
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
            const row = () => rows()[virtualRow.index]
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
                    : 'var(--bg-primary, #fff)',
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
