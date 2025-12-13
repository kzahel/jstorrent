/**
 * Power Manager for JSTorrent.
 * Prevents system sleep during active downloads when enabled.
 */

const SETTING_KEY = 'settings:keepAwake'

export class PowerManager {
  private keepAwakeEnabled = false
  private activeDownloadCount = 0
  private isKeepingAwake = false // Track current state to avoid spam

  constructor() {
    this.loadSettings()
    this.setupSettingsListener()
  }

  private async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(SETTING_KEY)
      if (SETTING_KEY in result) {
        const value = result[SETTING_KEY]
        if (typeof value === 'string') {
          try {
            this.keepAwakeEnabled = JSON.parse(value) as boolean
          } catch {
            this.keepAwakeEnabled = false
          }
        }
      }
    } catch (e) {
      console.error('[PowerManager] Failed to load settings:', e)
    }
  }

  private setupSettingsListener(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return

      if (changes[SETTING_KEY]) {
        const newValue = changes[SETTING_KEY].newValue
        if (typeof newValue === 'string') {
          try {
            this.keepAwakeEnabled = JSON.parse(newValue) as boolean
          } catch {
            this.keepAwakeEnabled = false
          }
        } else {
          this.keepAwakeEnabled = false
        }
        this.updatePowerState()
      }
    })
  }

  /**
   * Called when download stats are updated.
   * @param activeCount Number of currently active downloads
   */
  updateActiveDownloads(activeCount: number): void {
    this.activeDownloadCount = activeCount
    this.updatePowerState()
  }

  private updatePowerState(): void {
    const shouldKeepAwake = this.keepAwakeEnabled && this.activeDownloadCount > 0

    // Only act when state changes
    if (shouldKeepAwake && !this.isKeepingAwake) {
      console.log('[PowerManager] Requesting keep awake (system)')
      chrome.power.requestKeepAwake('system')
      this.isKeepingAwake = true
    } else if (!shouldKeepAwake && this.isKeepingAwake) {
      console.log('[PowerManager] Releasing keep awake')
      chrome.power.releaseKeepAwake()
      this.isKeepingAwake = false
    }
  }
}
