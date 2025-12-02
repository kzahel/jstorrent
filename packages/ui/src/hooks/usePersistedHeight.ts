import { useState, useCallback, useLayoutEffect } from 'react'

const STORAGE_KEY = 'jstorrent:detailPaneHeight'
const DEFAULT_HEIGHT = 250

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface UsePersistedHeightOptions {
  minHeight?: number
  /** Max height as fraction of window (0-1) */
  maxHeightRatio?: number
  defaultHeight?: number
}

export function usePersistedHeight(options: UsePersistedHeightOptions = {}) {
  const { minHeight = 100, maxHeightRatio = 0.7, defaultHeight = DEFAULT_HEIGHT } = options

  // Calculate max height based on window
  const getMaxHeight = useCallback(() => {
    return Math.floor(window.innerHeight * maxHeightRatio)
  }, [maxHeightRatio])

  // Load initial value from storage, clamped to current window
  const [height, setHeight] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed)) {
          return clamp(parsed, minHeight, getMaxHeight())
        }
      }
    } catch {
      // Ignore storage errors
    }
    return defaultHeight
  })

  // Re-clamp on window resize
  useLayoutEffect(() => {
    const handleResize = () => {
      const max = getMaxHeight()
      setHeight((h) => clamp(h, minHeight, max))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [minHeight, getMaxHeight])

  // Update height during drag (don't persist yet)
  const updateHeight = useCallback(
    (newHeight: number) => {
      const clamped = clamp(newHeight, minHeight, getMaxHeight())
      setHeight(clamped)
    },
    [minHeight, getMaxHeight],
  )

  // Persist height on drag end
  const persistHeight = useCallback((finalHeight: number) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(finalHeight))
    } catch {
      // Ignore storage errors
    }
  }, [])

  return {
    height,
    minHeight,
    maxHeight: getMaxHeight(),
    updateHeight,
    persistHeight,
  }
}
