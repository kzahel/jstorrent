/**
 * UI Settings Utilities
 *
 * Provides theme utilities and a fast maxFps cache for RAF loops.
 * The actual settings store is in @jstorrent/engine and @jstorrent/client.
 */

// ============ Types ============

export type Theme = 'system' | 'dark' | 'light'
export type ProgressBarStyle = 'text' | 'bar'

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

// ============ ProgressBarStyle Cache ============

// Module-level cache for progressBarStyle - avoids storage reads during render
let cachedProgressBarStyle: ProgressBarStyle = 'bar'

/** Get cached progress bar style (fast memory read, no storage access) */
export function getProgressBarStyle(): ProgressBarStyle {
  return cachedProgressBarStyle
}

/** Set cached progress bar style (called by settings store subscriber) */
export function setProgressBarStyleCache(style: ProgressBarStyle): void {
  cachedProgressBarStyle = style
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
