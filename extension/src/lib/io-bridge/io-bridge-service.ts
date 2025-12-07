/**
 * IO Bridge Service
 *
 * High-level service that wraps the IO Bridge state machine for use in the
 * service worker. Provides a simpler API for common operations.
 */

import type { IOBridgeState, DaemonInfo, Platform } from './types'
import { IOBridgeStore } from './io-bridge-store'
import { IOBridgeEffects, type IOBridgeEffectsConfig } from './io-bridge-effects'
import type { IIOBridgeAdapter } from './io-bridge-adapter'
import { DesktopAdapter } from './adapters/desktop-adapter'
import { ChromeOSAdapter } from './adapters/chromeos-adapter'
import { detectPlatform } from '../platform'
import { isConnected } from './io-bridge-state'

/**
 * Callback for state changes.
 */
export type StateChangeCallback = (state: IOBridgeState) => void

/**
 * IO Bridge Service configuration.
 */
export interface IOBridgeServiceConfig extends IOBridgeEffectsConfig {
  /** Override platform detection */
  platform?: Platform
  /** Override adapter (for testing) */
  adapter?: IIOBridgeAdapter
}

/**
 * High-level service for IO Bridge operations.
 *
 * Provides:
 * - Automatic platform detection and adapter selection
 * - Promise-based getDaemonInfo() for easy message handling
 * - State change subscriptions
 * - Graceful shutdown
 */
export class IOBridgeService {
  private store: IOBridgeStore
  private effects: IOBridgeEffects
  private adapter: IIOBridgeAdapter
  private platform: Platform
  private pendingResolvers: Array<{
    resolve: (info: DaemonInfo) => void
    reject: (error: Error) => void
  }> = []
  private activeUICount = 0
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null
  private readonly GRACE_PERIOD_MS = 5000

  constructor(config: IOBridgeServiceConfig = {}) {
    this.platform = config.platform ?? detectPlatform()

    // Create appropriate adapter
    this.adapter =
      config.adapter ??
      (this.platform === 'chromeos' ? new ChromeOSAdapter() : new DesktopAdapter())

    // Create store and effects
    this.store = new IOBridgeStore()
    this.effects = new IOBridgeEffects(this.store, this.adapter, config)

    // Subscribe to state changes
    this.store.subscribe((state, prevState) => {
      this.handleStateChange(state, prevState)
    })
  }

  /**
   * Start the IO Bridge service.
   */
  start(): void {
    this.effects.start(this.platform)
  }

  /**
   * Stop the IO Bridge service.
   */
  stop(): void {
    this.effects.stop()
    this.adapter.dispose()
    this.clearGracePeriod()
  }

  /**
   * Get the current state.
   */
  getState(): IOBridgeState {
    return this.store.getState()
  }

  /**
   * Get the detected platform.
   */
  getPlatform(): Platform {
    return this.platform
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(callback: StateChangeCallback): () => void {
    return this.store.subscribe(callback)
  }

  /**
   * Get daemon info, waiting for connection if necessary.
   *
   * This mimics the old DaemonLifecycleManager.getDaemonInfo() API.
   * - If already connected, returns immediately
   * - If connecting, waits for connection
   * - If in a prompt state, rejects with appropriate error
   */
  async getDaemonInfo(): Promise<DaemonInfo> {
    // Track UI connection
    this.clearGracePeriod()
    this.activeUICount++
    console.log(`[IOBridgeService] UI connected, count: ${this.activeUICount}`)

    const state = this.store.getState()

    // If already connected, return immediately
    if (isConnected(state)) {
      return state.daemonInfo
    }

    // If in a state that requires user action, reject
    if (
      state.name === 'INSTALL_PROMPT' ||
      state.name === 'LAUNCH_PROMPT' ||
      state.name === 'LAUNCH_FAILED'
    ) {
      throw new Error(`Daemon not connected: ${state.name}`)
    }

    // Wait for connection
    return new Promise<DaemonInfo>((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject })
    })
  }

  /**
   * Called when a UI closes.
   */
  onUIClosing(): void {
    this.activeUICount = Math.max(0, this.activeUICount - 1)
    console.log(`[IOBridgeService] UI disconnected, count: ${this.activeUICount}`)

    if (this.activeUICount === 0) {
      this.startGracePeriod()
    }
  }

  /**
   * Trigger user launch action (ChromeOS only).
   */
  triggerUserLaunch(): void {
    this.effects.userLaunch()
  }

  /**
   * Trigger retry action.
   */
  triggerRetry(): void {
    this.effects.retry()
  }

  /**
   * Cancel user launch action (ChromeOS only).
   */
  cancelUserLaunch(): void {
    this.effects.userCancel()
  }

  // ===========================================================================
  // Private methods
  // ===========================================================================

  private handleStateChange(state: IOBridgeState, _prevState: IOBridgeState): void {
    // Resolve pending promises when connected
    if (isConnected(state)) {
      const resolvers = this.pendingResolvers
      this.pendingResolvers = []
      for (const { resolve } of resolvers) {
        resolve(state.daemonInfo)
      }
    }

    // Reject pending promises on error states
    if (
      state.name === 'INSTALL_PROMPT' ||
      state.name === 'LAUNCH_PROMPT' ||
      state.name === 'LAUNCH_FAILED'
    ) {
      const resolvers = this.pendingResolvers
      this.pendingResolvers = []
      for (const { reject } of resolvers) {
        reject(new Error(`Daemon not connected: ${state.name}`))
      }
    }
  }

  private startGracePeriod(): void {
    console.log(`[IOBridgeService] Starting ${this.GRACE_PERIOD_MS}ms grace period`)

    this.gracePeriodTimer = setTimeout(() => {
      if (this.activeUICount === 0) {
        console.log('[IOBridgeService] Grace period expired, stopping bridge')
        // Note: We don't fully stop - just note that no UIs are active
        // The daemon connection remains but native host may terminate daemon
      }
    }, this.GRACE_PERIOD_MS)
  }

  private clearGracePeriod(): void {
    if (this.gracePeriodTimer) {
      clearTimeout(this.gracePeriodTimer)
      this.gracePeriodTimer = null
    }
  }
}

/**
 * Create and start an IO Bridge service.
 */
export function createIOBridgeService(config?: IOBridgeServiceConfig): IOBridgeService {
  const service = new IOBridgeService(config)
  service.start()
  return service
}
