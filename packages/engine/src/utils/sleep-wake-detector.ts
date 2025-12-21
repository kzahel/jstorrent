import { EventEmitter } from './event-emitter'

export interface WakeEvent {
  /** Estimated duration of sleep in milliseconds */
  sleepDurationMs: number
  /** Timestamp when wake was detected */
  timestamp: number
}

export interface SleepWakeDetectorOptions {
  /** Interval between time checks in milliseconds (default: 1000) */
  checkIntervalMs?: number
  /** Threshold above check interval to consider a wake event (default: 5000) */
  wakeThresholdMs?: number
}

/**
 * Detects system sleep/wake events using time-jump detection.
 *
 * During system sleep, JavaScript timers don't fire. When the system wakes,
 * the elapsed wall-clock time will be much greater than the expected interval.
 * If (elapsed - expected) > threshold, we emit a 'wake' event.
 *
 * Works in both browser and Node.js contexts.
 */
export class SleepWakeDetector extends EventEmitter {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastCheckTime: number = Date.now()
  private readonly checkIntervalMs: number
  private readonly wakeThresholdMs: number

  constructor(options?: SleepWakeDetectorOptions) {
    super()
    this.checkIntervalMs = options?.checkIntervalMs ?? 1000
    this.wakeThresholdMs = options?.wakeThresholdMs ?? 5000
  }

  /**
   * Start detecting sleep/wake events.
   * Emits 'wake' event when system wake is detected.
   */
  start(): void {
    if (this.intervalId) return

    this.lastCheckTime = Date.now()
    this.intervalId = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastCheckTime

      // If elapsed time is much greater than check interval, system likely woke from sleep
      if (elapsed > this.checkIntervalMs + this.wakeThresholdMs) {
        const sleepDurationMs = elapsed - this.checkIntervalMs
        const event: WakeEvent = { sleepDurationMs, timestamp: now }
        this.emit('wake', event)
      }

      this.lastCheckTime = now
    }, this.checkIntervalMs)
  }

  /**
   * Stop detecting sleep/wake events.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /**
   * Check if the detector is currently running.
   */
  isRunning(): boolean {
    return this.intervalId !== null
  }
}
