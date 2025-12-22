/**
 * TODO: Replace these with proper React modal dialogs.
 * Native window.confirm() and alert() don't work in Android WebView (standalone mode).
 * For now, we skip dialogs in standalone mode.
 */

declare global {
  interface Window {
    JSTORRENT_CONFIG?: { daemonUrl: string; platform: string }
  }
}

// Type-safe check for chrome API existence (works in both extension and web contexts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chromeApi: any = (globalThis as any).chrome

/**
 * Lightweight standalone detection without importing engine manager.
 * Returns true if we're NOT in a Chrome extension context (i.e., standalone mode).
 */
function isStandalone(): boolean {
  // Check for Android standalone config
  if (window.JSTORRENT_CONFIG?.platform) {
    return true
  }
  // Check if we're NOT in extension context
  return !(
    chromeApi &&
    chromeApi.runtime &&
    typeof chromeApi.runtime.id === 'string' &&
    chromeApi.runtime.id.length > 0
  )
}

/** Show confirm dialog, returns true in standalone mode (skips dialog) */
export function standaloneConfirm(message: string): boolean {
  if (isStandalone()) {
    return true
  }
  return window.confirm(message)
}

/** Show alert dialog, no-op in standalone mode */
export function standaloneAlert(message: string): void {
  if (isStandalone()) {
    console.warn('[standaloneAlert] Skipped in standalone mode:', message)
    return
  }
  alert(message)
}
