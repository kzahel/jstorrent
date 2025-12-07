/**
 * IO Bridge Service
 *
 * High-level service that wraps the IO Bridge state machine for use in the
 * service worker. Provides a simpler API for common operations.
 */

import type { IOBridgeState, DaemonInfo, Platform, DownloadRoot } from './types'
import { IOBridgeStore } from './io-bridge-store'
import { IOBridgeEffects, type IOBridgeEffectsConfig } from './io-bridge-effects'
import type { IIOBridgeAdapter } from './io-bridge-adapter'
import { DesktopAdapter } from './adapters/desktop-adapter'
import { ChromeOSAdapter } from './adapters/chromeos-adapter'
import { detectPlatform } from '../platform'
import { isConnected } from './io-bridge-state'

/**
 * Native event from daemon (TorrentAdded, MagnetAdded, etc.)
 */
export interface NativeEvent {
  event: string
  payload: unknown
}

/**
 * Callback for state changes.
 */
export type StateChangeCallback = (state: IOBridgeState) => void

/**
 * Callback for native events.
 */
export type NativeEventCallback = (event: NativeEvent) => void

/**
 * IO Bridge Service configuration.
 */
export interface IOBridgeServiceConfig extends IOBridgeEffectsConfig {
  /** Override platform detection */
  platform?: Platform
  /** Override adapter (for testing) */
  adapter?: IIOBridgeAdapter
  /** Callback for native events (TorrentAdded, MagnetAdded, etc.) */
  onNativeEvent?: NativeEventCallback
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
  private onNativeEvent?: NativeEventCallback
  private pendingResolvers: Array<{
    resolve: (info: DaemonInfo) => void
    reject: (error: Error) => void
  }> = []
  private activeUICount = 0
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null
  private readonly GRACE_PERIOD_MS = 5000
  private nativeEventListenerSet = false

  constructor(config: IOBridgeServiceConfig = {}) {
    this.platform = config.platform ?? detectPlatform()
    this.onNativeEvent = config.onNativeEvent

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

  /**
   * Pick a download folder via native host dialog (desktop only).
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    if (this.platform !== 'desktop') {
      throw new Error('Folder picker not supported on ChromeOS')
    }

    const desktopAdapter = this.adapter as DesktopAdapter
    if (!desktopAdapter.send) {
      throw new Error('Desktop adapter does not support send')
    }

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      console.log(`[IOBridgeService] pickDownloadFolder: requestId=${requestId}`)

      const handler = (msg: unknown) => {
        console.log('[IOBridgeService] pickDownloadFolder handler received:', JSON.stringify(msg))
        if (typeof msg !== 'object' || msg === null) {
          console.log('[IOBridgeService] pickDownloadFolder: message not an object, ignoring')
          return
        }
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { root?: DownloadRoot }
          error?: string
        }

        console.log(
          `[IOBridgeService] pickDownloadFolder: comparing id=${response.id} with requestId=${requestId}`,
        )
        if (response.id !== requestId) {
          console.log('[IOBridgeService] pickDownloadFolder: ID mismatch, ignoring')
          return
        }

        console.log(
          `[IOBridgeService] pickDownloadFolder: ID match! ok=${response.ok}, type=${response.type}`,
        )
        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          console.log('[IOBridgeService] pickDownloadFolder: resolving with root')
          resolve(response.payload.root)
        } else {
          console.log('Folder picker cancelled or failed:', response.error)
          resolve(null)
        }
      }

      desktopAdapter.onMessage(handler)
      console.log(`[IOBridgeService] pickDownloadFolder: sending request`)
      desktopAdapter.send({
        op: 'pickDownloadDirectory',
        id: requestId,
      })
    })
  }

  // ===========================================================================
  // Private methods
  // ===========================================================================

  private handleStateChange(state: IOBridgeState, prevState: IOBridgeState): void {
    // Resolve pending promises when connected
    if (isConnected(state)) {
      const resolvers = this.pendingResolvers
      this.pendingResolvers = []
      for (const { resolve } of resolvers) {
        resolve(state.daemonInfo)
      }

      // Set up native event listener when connected (desktop only)
      if (!this.nativeEventListenerSet && this.onNativeEvent && this.platform === 'desktop') {
        this.setupNativeEventListener()
      }
    }

    // Reset event listener flag on disconnect
    if (prevState.name === 'CONNECTED' && state.name !== 'CONNECTED') {
      this.nativeEventListenerSet = false
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

  private setupNativeEventListener(): void {
    if (this.platform !== 'desktop' || !this.onNativeEvent) return

    const desktopAdapter = this.adapter as DesktopAdapter
    if (!desktopAdapter.onMessage) return

    this.nativeEventListenerSet = true

    desktopAdapter.onMessage((msg) => {
      if (typeof msg === 'object' && msg !== null && 'event' in msg) {
        console.log('[IOBridgeService] Received native event:', (msg as NativeEvent).event)
        this.onNativeEvent!(msg as NativeEvent)
      }
    })
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
