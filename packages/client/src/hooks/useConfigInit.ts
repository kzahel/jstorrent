import { useEffect } from 'react'
import { applyTheme, setMaxFpsCache, setProgressBarStyleCache } from '@jstorrent/ui'
import type { ConfigHub } from '@jstorrent/engine'

/**
 * Hook to initialize UI caches from ConfigHub.
 *
 * Subscribes to theme, maxFps, and progressBarStyle changes
 * and applies them to the UI caches.
 *
 * @param configHub - The ConfigHub instance (can be null before engine init)
 */
export function useConfigInit(configHub: ConfigHub | null | undefined): void {
  useEffect(() => {
    if (!configHub) return

    // Apply initial values from ConfigHub
    setMaxFpsCache(configHub.maxFps.get())
    setProgressBarStyleCache(configHub.progressBarStyle.get())
    applyTheme(configHub.theme.get())

    // Subscribe to changes
    const unsubMaxFps = configHub.maxFps.subscribe(setMaxFpsCache)
    const unsubProgressBar = configHub.progressBarStyle.subscribe(setProgressBarStyleCache)
    const unsubTheme = configHub.theme.subscribe(applyTheme)

    return () => {
      unsubMaxFps()
      unsubProgressBar()
      unsubTheme()
    }
  }, [configHub])
}
