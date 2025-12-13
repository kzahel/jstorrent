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

  // Keep refs to props that may change - Solid captures these at mount time,
  // so we need refs to always get the current value
  const getRowsRef = useRef(props.getRows)
  getRowsRef.current = props.getRows

  const getSelectedKeysRef = useRef(props.getSelectedKeys)
  getSelectedKeysRef.current = props.getSelectedKeys

  const onSelectionChangeRef = useRef(props.onSelectionChange)
  onSelectionChangeRef.current = props.onSelectionChange

  const onRowContextMenuRef = useRef(props.onRowContextMenu)
  onRowContextMenuRef.current = props.onRowContextMenu

  useEffect(() => {
    if (!containerRef.current) return

    // Dispose previous instance if any
    disposeRef.current?.()

    // Mount Solid component - call as function to avoid JSX type mismatch
    // Use wrapper functions that read from refs to always get current props
    disposeRef.current = render(
      () =>
        VirtualTable({
          getRows: () => getRowsRef.current(),
          getRowKey: props.getRowKey,
          columns: props.columns,
          storageKey: props.storageKey,
          getSelectedKeys: () => getSelectedKeysRef.current?.() ?? new Set(),
          onSelectionChange: (keys) => onSelectionChangeRef.current?.(keys),
          onRowClick: props.onRowClick,
          onRowDoubleClick: props.onRowDoubleClick,
          onRowContextMenu: (row, x, y) => onRowContextMenuRef.current?.(row, x, y),
          getRowTooltip: props.getRowTooltip,
          rowHeight: props.rowHeight,
        }) as unknown as Element,
      containerRef.current,
    )

    return () => {
      disposeRef.current?.()
      disposeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only mount once - Solid handles internal updates via getRows callback

  // Update props via Solid's reactivity (the getRows function is called each frame)
  // Other props are stable references, so no re-mount needed

  return (
    <div ref={containerRef} style={{ height: '100%', width: '100%' }} data-testid="table-mount" />
  )
}
