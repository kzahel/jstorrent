import { useState, useEffect } from 'react'
import { applyTheme, setMaxFpsCache, setProgressBarStyleCache } from '@jstorrent/ui'
import type { ISettingsStore } from '@jstorrent/engine'

/**
 * Hook to initialize settings store and apply UI settings.
 * Extracted common pattern from App.tsx and StandaloneFullApp.tsx.
 *
 * @param settingsStore - The settings store to initialize and subscribe to
 * @returns Whether the settings store is ready
 */
export function useSettingsInit(settingsStore: ISettingsStore): boolean {
  const [ready, setReady] = useState(false)

  // Initialize store
  useEffect(() => {
    settingsStore.init().then(() => setReady(true))
  }, [settingsStore])

  // Apply UI caches once ready
  useEffect(() => {
    if (!ready) return

    // Apply initial values
    setMaxFpsCache(settingsStore.get('maxFps'))
    setProgressBarStyleCache(settingsStore.get('progressBarStyle'))
    applyTheme(settingsStore.get('theme'))

    // Subscribe to changes
    const unsubMaxFps = settingsStore.subscribe('maxFps', setMaxFpsCache)
    const unsubProgressBar = settingsStore.subscribe('progressBarStyle', setProgressBarStyleCache)
    const unsubTheme = settingsStore.subscribe('theme', applyTheme)

    return () => {
      unsubMaxFps()
      unsubProgressBar()
      unsubTheme()
    }
  }, [settingsStore, ready])

  return ready
}
