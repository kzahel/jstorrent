/**
 * Notification Manager for JSTorrent.
 * Handles Chrome notifications for download events and persistent progress.
 *
 * Uses the unified settings store keys from @jstorrent/engine/settings/schema.
 */

export interface ProgressStats {
  activeCount: number
  errorCount: number
  downloadSpeed: number // bytes per second
  eta: number | null // seconds, null if unknown
  singleTorrentName?: string // set when activeCount === 1
}

// Settings keys (prefixed as stored in chrome.storage.sync)
const SETTING_KEYS = {
  onTorrentComplete: 'settings:notifications.onTorrentComplete',
  onAllComplete: 'settings:notifications.onAllComplete',
  onError: 'settings:notifications.onError',
  progressWhenBackgrounded: 'settings:notifications.progressWhenBackgrounded',
} as const

// Default values (must match schema in @jstorrent/engine)
const DEFAULTS = {
  onTorrentComplete: true,
  onAllComplete: true,
  onError: true,
  progressWhenBackgrounded: false,
} as const

const PROGRESS_NOTIFICATION_ID = 'jstorrent-progress'
const ALL_COMPLETE_NOTIFICATION_ID = 'jstorrent-all-complete'

export class NotificationManager {
  private onTorrentCompleteEnabled: boolean = DEFAULTS.onTorrentComplete
  private onAllCompleteEnabled: boolean = DEFAULTS.onAllComplete
  private onErrorEnabled: boolean = DEFAULTS.onError
  private progressWhenBackgroundedEnabled: boolean = DEFAULTS.progressWhenBackgrounded
  private uiVisible: boolean = true
  private progressNotificationActive: boolean = false
  private lastProgressStats: ProgressStats | null = null

  constructor() {
    this.loadSettings()
    this.setupClickHandler()
    this.setupSettingsListener()
  }

  // ============================================================================
  // Settings Management
  // ============================================================================

  async loadSettings(): Promise<void> {
    try {
      const keys = Object.values(SETTING_KEYS)
      const result = await chrome.storage.sync.get(keys)

      // Get stored values (may be raw values or JSON strings)
      const getValue = <T>(key: string, defaultValue: T): T => {
        if (key in result) {
          const value = result[key]
          // If it's already the right type, use it directly
          if (typeof value === typeof defaultValue) {
            return value as T
          }
          // If it's a JSON string, parse it
          if (typeof value === 'string') {
            try {
              return JSON.parse(value) as T
            } catch {
              return defaultValue
            }
          }
        }
        return defaultValue
      }

      this.onTorrentCompleteEnabled = getValue(
        SETTING_KEYS.onTorrentComplete,
        DEFAULTS.onTorrentComplete,
      )
      this.onAllCompleteEnabled = getValue(SETTING_KEYS.onAllComplete, DEFAULTS.onAllComplete)
      this.onErrorEnabled = getValue(SETTING_KEYS.onError, DEFAULTS.onError)
      this.progressWhenBackgroundedEnabled = getValue(
        SETTING_KEYS.progressWhenBackgrounded,
        DEFAULTS.progressWhenBackgrounded,
      )
    } catch (e) {
      console.error('[NotificationManager] Failed to load settings:', e)
    }
  }

  private setupSettingsListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return

      for (const [key, change] of Object.entries(changes)) {
        const parseValue = <T>(defaultValue: T): T => {
          const value = change.newValue
          // If it's already the right type, use it directly
          if (typeof value === typeof defaultValue) {
            return value as T
          }
          // If it's a JSON string, parse it
          if (typeof value === 'string') {
            try {
              return JSON.parse(value) as T
            } catch {
              return defaultValue
            }
          }
          return defaultValue
        }

        switch (key) {
          case SETTING_KEYS.onTorrentComplete:
            this.onTorrentCompleteEnabled = parseValue(DEFAULTS.onTorrentComplete)
            break
          case SETTING_KEYS.onAllComplete:
            this.onAllCompleteEnabled = parseValue(DEFAULTS.onAllComplete)
            break
          case SETTING_KEYS.onError:
            this.onErrorEnabled = parseValue(DEFAULTS.onError)
            break
          case SETTING_KEYS.progressWhenBackgrounded:
            this.progressWhenBackgroundedEnabled = parseValue(DEFAULTS.progressWhenBackgrounded)
            break
        }
      }
    })
  }

  // ============================================================================
  // State Updates from UI
  // ============================================================================

  setUiVisibility(visible: boolean): void {
    const wasVisible = this.uiVisible
    this.uiVisible = visible

    // console.log(`[NotificationManager] UI visibility: ${wasVisible} -> ${visible}`)

    if (visible && !wasVisible) {
      // UI came to foreground - clear persistent notification
      this.clearProgressNotification()
    } else if (!visible && wasVisible) {
      // UI went to background - maybe show persistent notification
      if (this.shouldShowPersistentProgress() && this.lastProgressStats) {
        this.showProgressNotification(this.lastProgressStats)
      }
    }
  }

  updateProgress(stats: ProgressStats): void {
    this.lastProgressStats = stats

    if (this.progressNotificationActive) {
      // Update the existing notification
      this.showProgressNotification(stats)
    } else if (this.shouldShowPersistentProgress() && stats.activeCount > 0) {
      // Start showing persistent notification
      this.showProgressNotification(stats)
    }

    // Check if all downloads just completed
    if (stats.activeCount === 0 && this.progressNotificationActive) {
      this.onAllComplete()
    }
  }

  // ============================================================================
  // Event Handlers (called when UI sends events)
  // ============================================================================

  onTorrentComplete(infoHash: string, name: string): void {
    console.log('[NotificationManager] onTorrentComplete called:', {
      infoHash,
      name,
      progressNotificationActive: this.progressNotificationActive,
      settingEnabled: this.onTorrentCompleteEnabled,
    })

    // Suppress if persistent progress is active
    if (this.progressNotificationActive) {
      console.log('[NotificationManager] Suppressed: progress notification active')
      return
    }
    if (!this.onTorrentCompleteEnabled) {
      console.log('[NotificationManager] Suppressed: setting disabled')
      return
    }

    this.showEventNotification(`jstorrent-complete-${infoHash}`, 'Download Complete', name)
  }

  onTorrentError(infoHash: string, name: string, error: string): void {
    console.log('[NotificationManager] onTorrentError called:', {
      infoHash,
      name,
      error,
      progressNotificationActive: this.progressNotificationActive,
      settingEnabled: this.onErrorEnabled,
    })

    // Suppress if persistent progress is active (errors shown in progress message)
    if (this.progressNotificationActive) {
      console.log('[NotificationManager] Suppressed: progress notification active')
      return
    }
    if (!this.onErrorEnabled) {
      console.log('[NotificationManager] Suppressed: setting disabled')
      return
    }

    this.showEventNotification(`jstorrent-error-${infoHash}`, 'Download Error', `${name}: ${error}`)
  }

  onAllComplete(): void {
    console.log('[NotificationManager] onAllComplete called:', {
      progressNotificationActive: this.progressNotificationActive,
      settingEnabled: this.onAllCompleteEnabled,
    })

    if (!this.onAllCompleteEnabled) {
      console.log('[NotificationManager] Suppressed: setting disabled')
      this.clearProgressNotification()
      return
    }

    // Replace progress notification with completion message
    // Use same ID so it replaces in place
    if (this.progressNotificationActive) {
      console.log('[NotificationManager] Replacing progress notification with completion')
      chrome.notifications.create(
        PROGRESS_NOTIFICATION_ID,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/js-128.png'),
          title: 'JSTorrent',
          message: 'All downloads complete',
          requireInteraction: false,
          silent: false,
        },
        (notificationId) => {
          if (chrome.runtime.lastError) {
            console.error(
              '[NotificationManager] All complete notification failed:',
              chrome.runtime.lastError.message,
            )
          } else {
            console.log('[NotificationManager] All complete notification created:', notificationId)
          }
        },
      )
      this.progressNotificationActive = false
    } else {
      this.showEventNotification(
        ALL_COMPLETE_NOTIFICATION_ID,
        'JSTorrent',
        'All downloads complete',
      )
    }
  }

  onDuplicateTorrent(name: string): void {
    console.log('[NotificationManager] onDuplicateTorrent called:', { name })
    chrome.notifications.create(
      `jstorrent-duplicate-${Date.now()}`,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/js-128.png'),
        title: 'Already Added',
        message: `"${name}" is already in your torrent list`,
        priority: 0,
        requireInteraction: false,
        silent: false,
      },
      (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[NotificationManager] Duplicate notification failed:',
            chrome.runtime.lastError.message,
          )
        } else {
          console.log('[NotificationManager] Duplicate notification created:', notificationId)
        }
      },
    )
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  private shouldShowPersistentProgress(): boolean {
    return !this.uiVisible && this.progressWhenBackgroundedEnabled
  }

  private showProgressNotification(stats: ProgressStats): void {
    const message = this.formatProgressMessage(stats)

    console.log('[NotificationManager] Creating progress notification:', message)
    chrome.notifications.create(
      PROGRESS_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/js-128.png'),
        title: 'JSTorrent',
        message,
        requireInteraction: true,
        silent: true, // No sound on updates
      },
      (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[NotificationManager] Progress notification failed:',
            chrome.runtime.lastError.message,
          )
        } else {
          console.log('[NotificationManager] Progress notification created:', notificationId)
          this.progressNotificationActive = true
        }
      },
    )
  }

  private clearProgressNotification(): void {
    if (this.progressNotificationActive) {
      chrome.notifications.clear(PROGRESS_NOTIFICATION_ID)
      this.progressNotificationActive = false
    }
  }

  private showEventNotification(id: string, title: string, message: string): void {
    console.log('[NotificationManager] Creating event notification:', { id, title, message })
    chrome.notifications.create(
      id,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/js-128.png'),
        title,
        message,
        requireInteraction: false,
        silent: false,
      },
      (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[NotificationManager] Event notification failed:',
            chrome.runtime.lastError.message,
          )
        } else {
          console.log('[NotificationManager] Event notification created:', notificationId)
        }
      },
    )
  }

  private setupClickHandler(): void {
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId.startsWith('jstorrent')) {
        this.focusOrOpenUI()
        chrome.notifications.clear(notificationId)
      }
    })
  }

  private async focusOrOpenUI(): Promise<void> {
    try {
      const url = chrome.runtime.getURL('src/ui/app.html')
      // Use getContexts() instead of tabs.query({ url }) - works without "tabs" permission
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] })
      const existing = contexts.find((c) => c.documentUrl === url)

      if (existing?.tabId && existing.tabId !== -1) {
        await chrome.tabs.update(existing.tabId, { active: true })
        if (existing.windowId && existing.windowId !== -1) {
          await chrome.windows.update(existing.windowId, { focused: true })
        }
      } else {
        await chrome.tabs.create({ url })
      }
    } catch (e) {
      console.error('[NotificationManager] Failed to focus/open UI:', e)
    }
  }

  // ============================================================================
  // Formatting Helpers
  // ============================================================================

  private formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) {
      return `${bytesPerSec} B/s`
    } else if (bytesPerSec < 1024 * 1024) {
      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
    } else {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
    }
  }

  private formatEta(seconds: number): string {
    if (seconds < 60) {
      return `${Math.floor(seconds)}s`
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m`
    } else {
      const hours = Math.floor(seconds / 3600)
      const mins = Math.floor((seconds % 3600) / 60)
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    }
  }

  private formatProgressMessage(stats: ProgressStats): string {
    const { activeCount, errorCount, downloadSpeed, eta, singleTorrentName } = stats

    const parts: string[] = []

    // Count or name
    if (activeCount === 1 && singleTorrentName) {
      parts.push(singleTorrentName)
    } else {
      let countPart = `${activeCount} downloading`
      if (errorCount > 0) {
        countPart += `, ${errorCount} error${errorCount !== 1 ? 's' : ''}`
      }
      parts.push(countPart)
    }

    // Speed
    parts.push(`↓ ${this.formatSpeed(downloadSpeed)}`)

    // ETA
    if (eta !== null && eta > 0) {
      parts.push(`ETA ${this.formatEta(eta)}`)
    }

    return parts.join(' • ')
  }
}
