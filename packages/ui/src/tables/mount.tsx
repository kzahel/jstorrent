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

    // Mount Solid component - call as function to avoid JSX type mismatch
    disposeRef.current = render(
      () =>
        VirtualTable({
          getRows: props.getRows,
          getRowKey: props.getRowKey,
          columns: props.columns,
          storageKey: props.storageKey,
          selectedKeys: props.selectedKeys,
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
  }, []) // Only mount once - Solid handles internal updates via getRows callback

  // Update props via Solid's reactivity (the getRows function is called each frame)
  // Other props are stable references, so no re-mount needed

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
