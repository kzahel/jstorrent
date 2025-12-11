import { useState, useEffect, useCallback, useLayoutEffect } from 'react'
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

  const [height, setHeight] = useState(defaultHeight)
  const [activeTab, setActiveTab] = useState<DetailTab>(defaultTab)
  const [loaded, setLoaded] = useState(false)

  // Load from chrome.storage.local on mount
  useEffect(() => {
    const loadState = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get(UI_STATE_KEY)
        const saved = result[UI_STATE_KEY] as PersistedUIState | undefined
        if (saved) {
          if (typeof saved.detailPaneHeight === 'number') {
            setHeight(clamp(saved.detailPaneHeight, minHeight, getMaxHeight()))
          }
          if (saved.detailPaneTab) {
            setActiveTab(saved.detailPaneTab)
          }
        }
      }
      setLoaded(true)
    }
    loadState()
  }, [minHeight, getMaxHeight])

  // Re-clamp height on window resize
  useLayoutEffect(() => {
    const handleResize = () => {
      const max = getMaxHeight()
      setHeight((h) => clamp(h, minHeight, max))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [minHeight, getMaxHeight])

  // Persist state to chrome.storage.local
  const persistState = useCallback(
    (updates: Partial<PersistedUIState>) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(UI_STATE_KEY).then((result) => {
          const current = (result[UI_STATE_KEY] as PersistedUIState) || {
            detailPaneHeight: height,
            detailPaneTab: activeTab,
          }
          chrome.storage.local.set({
            [UI_STATE_KEY]: { ...current, ...updates },
          })
        })
      }
    },
    [height, activeTab],
  )

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
    loaded,
  }
}
