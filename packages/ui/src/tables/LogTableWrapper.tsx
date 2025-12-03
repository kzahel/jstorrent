import { useEffect, useRef } from 'react'
import { render } from 'solid-js/web'
import { LogTable } from './LogTable.solid'
import type { LogStore } from '@jstorrent/engine'

export interface LogTableWrapperProps {
  logStore: LogStore
}

/**
 * React component that mounts a Solid LogTable.
 * Handles lifecycle and props bridging.
 */
export function LogTableWrapper({ logStore }: LogTableWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const dispose = render(() => LogTable({ logStore }) as unknown as Element, containerRef.current)

    return () => dispose()
  }, [logStore])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
