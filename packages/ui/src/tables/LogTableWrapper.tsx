import { useEffect, useRef } from 'react'
import { render } from 'solid-js/web'
import { LogTable } from './LogTable.solid'
import type { LogStore } from '@jstorrent/engine'

export interface LogTableWrapperProps {
  logStore: LogStore
  /** Callback to open settings panel (for gear icon) */
  onOpenSettings?: () => void
}

/**
 * React component that mounts a Solid LogTable.
 * Handles lifecycle and props bridging.
 */
export function LogTableWrapper({ logStore, onOpenSettings }: LogTableWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const dispose = render(
      () => LogTable({ logStore, onOpenSettings }) as unknown as Element,
      containerRef.current,
    )

    return () => dispose()
  }, [logStore, onOpenSettings])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
