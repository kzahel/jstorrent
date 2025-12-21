/**
 * Background Audio Manager
 *
 * Plays silent audio to prevent Chrome from throttling background tabs.
 * Chrome throttles setTimeout/setInterval to 1-second minimum for background tabs,
 * but tabs playing audio are exempt from this throttling.
 *
 * Uses a 1Hz oscillator (below human hearing threshold) with minimal gain
 * to be effectively silent while still keeping the tab active.
 */

export class BackgroundAudioManager {
  private audioContext: AudioContext | null = null
  private oscillator: OscillatorNode | null = null
  private gainNode: GainNode | null = null
  private enabled = false
  private activeDownloadCount = 0
  private isBackgrounded = document.visibilityState === 'hidden'

  // Throttle detection
  private checkIntervalId: ReturnType<typeof setInterval> | null = null
  private lastCheckTime = 0
  private readonly CHECK_INTERVAL_MS = 200
  private readonly THROTTLE_THRESHOLD_MS = 500

  constructor() {
    // Listen for visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private handleVisibilityChange = (): void => {
    this.isBackgrounded = document.visibilityState === 'hidden'
    console.log(`[BackgroundAudio] Tab ${this.isBackgrounded ? 'backgrounded' : 'foregrounded'}`)
    this.updateAudioState()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.updateAudioState()
  }

  updateActiveDownloads(count: number): void {
    this.activeDownloadCount = count
    this.updateAudioState()
  }

  private updateAudioState(): void {
    // Only play audio when: enabled AND has active downloads AND tab is backgrounded
    const shouldPlay = this.enabled && this.activeDownloadCount > 0 && this.isBackgrounded

    if (shouldPlay && !this.audioContext) {
      this.startSilentAudio()
    } else if (!shouldPlay && this.audioContext) {
      this.stopSilentAudio()
    }
  }

  private startSilentAudio(): void {
    this.audioContext = new AudioContext()
    this.oscillator = this.audioContext.createOscillator()
    this.gainNode = this.audioContext.createGain()

    // 1 Hz oscillator - below human hearing threshold (~20Hz)
    this.oscillator.frequency.value = 1

    // Minimal gain - essentially silent
    this.gainNode.gain.value = 0.001

    this.oscillator.connect(this.gainNode)
    this.gainNode.connect(this.audioContext.destination)
    this.oscillator.start()
    console.log('[BackgroundAudio] Started silent audio (1Hz oscillator)')

    // Start throttle detection
    this.startThrottleDetection()
  }

  private stopSilentAudio(): void {
    this.stopThrottleDetection()

    if (this.oscillator) {
      this.oscillator.stop()
      this.oscillator.disconnect()
      this.oscillator = null
    }

    if (this.gainNode) {
      this.gainNode.disconnect()
      this.gainNode = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    console.log('[BackgroundAudio] Stopped silent audio')
  }

  private startThrottleDetection(): void {
    this.lastCheckTime = Date.now()
    this.checkIntervalId = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastCheckTime
      const expectedMax = this.CHECK_INTERVAL_MS + this.THROTTLE_THRESHOLD_MS

      if (elapsed > expectedMax) {
        console.warn(
          `[BackgroundAudio] Throttling detected! Expected ~${this.CHECK_INTERVAL_MS}ms, got ${elapsed}ms. ` +
            `Audio trick may not be working.`,
        )
      }

      this.lastCheckTime = now
    }, this.CHECK_INTERVAL_MS)
  }

  private stopThrottleDetection(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = null
    }
  }
}
