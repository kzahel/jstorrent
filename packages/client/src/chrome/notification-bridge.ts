/**
 * Notification Bridge for UI Thread.
 * Sends notification events to the service worker.
 */

import { getBridge } from './extension-bridge'

export interface ProgressStats {
  activeCount: number
  errorCount: number
  downloadSpeed: number // bytes per second
  eta: number | null // seconds, null if unknown
  singleTorrentName?: string // set when activeCount === 1
}

class NotificationBridge {
  private throttleTimer: ReturnType<typeof setTimeout> | null = null
  private pendingStats: ProgressStats | null = null

  constructor() {
    this.setupVisibilityTracking()
  }

  private setupVisibilityTracking(): void {
    // Send initial state
    this.sendVisibility(document.visibilityState === 'visible')

    // Track changes
    document.addEventListener('visibilitychange', () => {
      this.sendVisibility(document.visibilityState === 'visible')
    })
  }

  private sendVisibility(visible: boolean): void {
    getBridge().postMessage({
      type: 'notification:visibility',
      visible,
    })
  }

  /**
   * Call this from the engine's progress event handler.
   * Throttles updates to avoid spamming the SW.
   */
  updateProgress(stats: ProgressStats): void {
    this.pendingStats = stats

    // Throttle to every 2 seconds
    if (this.throttleTimer === null) {
      this.sendProgressUpdate()
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null
        if (this.pendingStats) {
          this.sendProgressUpdate()
        }
      }, 2000)
    }
  }

  private sendProgressUpdate(): void {
    if (!this.pendingStats) return

    getBridge().postMessage({
      type: 'notification:stats',
      stats: this.pendingStats,
      visible: document.visibilityState === 'visible',
    })
  }

  onTorrentComplete(infoHash: string, name: string): void {
    getBridge().postMessage({
      type: 'notification:torrent-complete',
      infoHash,
      name,
    })
  }

  onTorrentError(infoHash: string, name: string, error: string): void {
    getBridge().postMessage({
      type: 'notification:torrent-error',
      infoHash,
      name,
      error,
    })
  }

  onAllComplete(): void {
    getBridge().postMessage({
      type: 'notification:all-complete',
    })
  }
}

// Singleton instance
export const notificationBridge = new NotificationBridge()
