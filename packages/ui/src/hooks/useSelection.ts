import { useState, useCallback, useRef, useLayoutEffect } from 'react'

export interface UseSelectionResult {
  /** Current selected keys */
  selectedKeys: Set<string>
  /** Getter for selected keys (stable ref for Solid bridge) */
  getSelectedKeys: () => Set<string>
  /** Handle selection change */
  onSelectionChange: (keys: Set<string>) => void
  /** Clear selection */
  clear: () => void
  /** Get count of selected items */
  count: number
}

/**
 * Hook for managing selection state in tables.
 * Returns a stable getter function for use with Solid.js bridge.
 */
export function useSelection(): UseSelectionResult {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())

  // Ref for stable getter (required for Solid bridge to avoid closure issues)
  const selectedRef = useRef(selectedKeys)

  // Update ref in effect to avoid modifying during render
  useLayoutEffect(() => {
    selectedRef.current = selectedKeys
  }, [selectedKeys])

  const getSelectedKeys = useCallback(() => selectedRef.current, [])

  const onSelectionChange = useCallback((keys: Set<string>) => {
    setSelectedKeys(keys)
  }, [])

  const clear = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  return {
    selectedKeys,
    getSelectedKeys,
    onSelectionChange,
    clear,
    count: selectedKeys.size,
  }
}
