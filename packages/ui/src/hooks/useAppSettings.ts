/**
 * UI Settings Utilities
 *
 * Provides theme utilities and a fast maxFps cache for RAF loops.
 * The actual settings store is in @jstorrent/engine and @jstorrent/client.
 */

// ============ Types ============

export type Theme = 'system' | 'dark' | 'light'

// ============ MaxFps Cache ============

// Module-level cache for maxFps - avoids storage reads in RAF loops
let cachedMaxFps = 60

/** Get cached maxFps value (fast memory read, no storage access) */
export function getMaxFps(): number {
  return cachedMaxFps
}

/** Set cached maxFps value (called by settings store subscriber) */
export function setMaxFpsCache(fps: number): void {
  cachedMaxFps = fps
}

// ============ Theme Utilities ============

/** Apply theme by setting data-theme attribute on document */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

/** Get current effective theme (resolves 'system' to actual theme) */
export function getEffectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}
