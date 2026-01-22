/**
 * Background WebRTC Keep-Alive Manager
 *
 * Uses a local WebRTC data channel to prevent Chrome from throttling background tabs.
 * This is an alternative to the audio method that doesn't show an audio icon.
 *
 * Creates two local peer connections and establishes a data channel between them.
 * Periodic pings keep the connection "active".
 */

export class BackgroundWebRTCManager {
  private enabled = false
  private activeDownloadCount = 0
  private isBackgrounded = document.visibilityState === 'hidden'
  private isActive = false

  // WebRTC state
  private pc1: RTCPeerConnection | null = null
  private pc2: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private pingIntervalId: ReturnType<typeof setInterval> | null = null

  // Throttle detection
  // Note: WebRTC only prevents intensive throttling (60s), not basic throttling (1s)
  // Chrome still batches background tab timers to run once per second
  private checkIntervalId: ReturnType<typeof setInterval> | null = null
  private lastCheckTime = 0
  private readonly CHECK_INTERVAL_MS = 1000
  private readonly THROTTLE_THRESHOLD_MS = 500

  constructor() {
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private handleVisibilityChange = (): void => {
    this.isBackgrounded = document.visibilityState === 'hidden'
    console.log(`[BackgroundWebRTC] Tab ${this.isBackgrounded ? 'backgrounded' : 'foregrounded'}`)
    this.updateState()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.updateState()
  }

  updateActiveDownloads(count: number): void {
    this.activeDownloadCount = count
    this.updateState()
  }

  private updateState(): void {
    const shouldBeActive = this.enabled && this.activeDownloadCount > 0 && this.isBackgrounded

    if (shouldBeActive && !this.isActive) {
      this.start()
    } else if (!shouldBeActive && this.isActive) {
      this.stop()
    }
  }

  private async start(): Promise<void> {
    try {
      this.pc1 = new RTCPeerConnection()
      this.pc2 = new RTCPeerConnection()

      // ICE candidate exchange
      this.pc1.onicecandidate = (e) => {
        if (e.candidate) this.pc2?.addIceCandidate(e.candidate)
      }
      this.pc2.onicecandidate = (e) => {
        if (e.candidate) this.pc1?.addIceCandidate(e.candidate)
      }

      // Create data channel
      this.dataChannel = this.pc1.createDataChannel('keepalive')

      this.dataChannel.onopen = () => {
        console.log('[BackgroundWebRTC] Data channel open')
        this.pingIntervalId = setInterval(() => {
          if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send('ping')
          }
        }, 30000)
      }

      // Local signaling
      const offer = await this.pc1.createOffer()
      await this.pc1.setLocalDescription(offer)
      await this.pc2.setRemoteDescription(offer)

      const answer = await this.pc2.createAnswer()
      await this.pc2.setLocalDescription(answer)
      await this.pc1.setRemoteDescription(answer)

      this.isActive = true
      this.startThrottleDetection()
      console.log('[BackgroundWebRTC] Started')
    } catch (err) {
      console.error('[BackgroundWebRTC] Setup failed:', err)
    }
  }

  private stop(): void {
    this.stopThrottleDetection()

    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId)
      this.pingIntervalId = null
    }

    this.dataChannel?.close()
    this.dataChannel = null

    this.pc1?.close()
    this.pc1 = null

    this.pc2?.close()
    this.pc2 = null

    this.isActive = false
    console.log('[BackgroundWebRTC] Stopped')
  }

  private startThrottleDetection(): void {
    this.lastCheckTime = Date.now()
    this.checkIntervalId = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastCheckTime
      const expectedMax = this.CHECK_INTERVAL_MS + this.THROTTLE_THRESHOLD_MS

      if (elapsed > expectedMax) {
        console.warn(
          `[BackgroundWebRTC] Throttling detected! Expected ~${this.CHECK_INTERVAL_MS}ms, got ${elapsed}ms. ` +
            `WebRTC method may not be working.`,
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
