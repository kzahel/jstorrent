import { useState, useCallback, useLayoutEffect } from 'react'
import type { DetailTab } from '../components/DetailPane'

const UI_STATE_KEY = 'jstorrent:uiState'

interface PersistedUIState {
  detailPaneHeight: number
  detailPaneTab: DetailTab
}

export interface UsePersistedUIStateOptions {
  defaultHeight?: number
  defaultTab?: DetailTab
  minHeight?: number
  /** Max height as fraction of window (0-1) */
  maxHeightRatio?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function usePersistedUIState(options: UsePersistedUIStateOptions = {}) {
  const {
    defaultHeight = 250,
    defaultTab = 'general',
    minHeight = 100,
    maxHeightRatio = 0.7,
  } = options

  const getMaxHeight = useCallback(() => {
    return Math.floor(window.innerHeight * maxHeightRatio)
  }, [maxHeightRatio])

  // Load initial state from localStorage synchronously
  const getInitialState = useCallback((): PersistedUIState => {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedUIState>
        return {
          detailPaneHeight:
            typeof saved.detailPaneHeight === 'number'
              ? clamp(saved.detailPaneHeight, minHeight, getMaxHeight())
              : defaultHeight,
          detailPaneTab: saved.detailPaneTab || defaultTab,
        }
      }
    } catch {
      // Ignore parse errors
    }
    return { detailPaneHeight: defaultHeight, detailPaneTab: defaultTab }
  }, [defaultHeight, defaultTab, minHeight, getMaxHeight])

  const [height, setHeight] = useState(() => getInitialState().detailPaneHeight)
  const [activeTab, setActiveTab] = useState<DetailTab>(() => getInitialState().detailPaneTab)

  // Re-clamp height on window resize
  useLayoutEffect(() => {
    const handleResize = () => {
      const max = getMaxHeight()
      setHeight((h) => clamp(h, minHeight, max))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [minHeight, getMaxHeight])

  // Persist state to localStorage
  const persistState = useCallback((updates: Partial<PersistedUIState>) => {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY)
      const current: PersistedUIState = raw
        ? JSON.parse(raw)
        : { detailPaneHeight: height, detailPaneTab: activeTab }
      localStorage.setItem(UI_STATE_KEY, JSON.stringify({ ...current, ...updates }))
    } catch {
      // Ignore storage errors
    }
  }, [height, activeTab])

  // Update height during drag (don't persist yet)
  const updateHeight = useCallback(
    (newHeight: number) => {
      const clamped = clamp(newHeight, minHeight, getMaxHeight())
      setHeight(clamped)
    },
    [minHeight, getMaxHeight],
  )

  // Persist height on drag end
  const persistHeight = useCallback(
    (finalHeight: number) => {
      persistState({ detailPaneHeight: finalHeight })
    },
    [persistState],
  )

  // Update and persist tab
  const setTab = useCallback(
    (tab: DetailTab) => {
      setActiveTab(tab)
      persistState({ detailPaneTab: tab })
    },
    [persistState],
  )

  return {
    height,
    minHeight,
    maxHeight: getMaxHeight(),
    updateHeight,
    persistHeight,
    activeTab,
    setTab,
    loaded: true, // Always loaded immediately with localStorage
  }
}
