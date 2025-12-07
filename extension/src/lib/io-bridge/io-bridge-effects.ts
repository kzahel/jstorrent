/**
 * IO Bridge Effects Runner
 *
 * Handles side effects for the IO Bridge state machine.
 * Listens to state changes and triggers appropriate async operations.
 */

import type { IOBridgeState, Platform, ConnectionHistory } from './types'
import type { IIOBridgeAdapter } from './io-bridge-adapter'
import { IOBridgeStore } from './io-bridge-store'
import { createConnectionHistory } from './io-bridge-state'

/**
 * Configuration for the effects runner.
 */
export interface IOBridgeEffectsConfig {
  /** Timeout for launch operation in ms (default: 30000) */
  launchTimeoutMs?: number
  /** Whether to auto-retry on disconnect (default: true) */
  autoRetryOnDisconnect?: boolean
  /** Delay before auto-retry in ms (default: 2000) */
  autoRetryDelayMs?: number
}

const DEFAULT_CONFIG: Required<IOBridgeEffectsConfig> = {
  launchTimeoutMs: 30000,
  autoRetryOnDisconnect: true,
  autoRetryDelayMs: 2000,
}

/**
 * Effects runner for the IO Bridge.
 *
 * Subscribes to store changes and triggers appropriate side effects:
 * - Probes when entering PROBING state
 * - Sets up disconnect watchers when entering CONNECTED state
 * - Starts polling and timeout when entering AWAITING_LAUNCH state
 */
export class IOBridgeEffects {
  private store: IOBridgeStore
  private adapter: IIOBridgeAdapter
  private config: Required<IOBridgeEffectsConfig>

  private unsubscribe: (() => void) | null = null
  private cleanupFns: Array<() => void> = []
  private launchTimeout: ReturnType<typeof setTimeout> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private isStarted = false

  constructor(store: IOBridgeStore, adapter: IIOBridgeAdapter, config: IOBridgeEffectsConfig = {}) {
    this.store = store
    this.adapter = adapter
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the effects runner.
   *
   * Subscribes to store and dispatches START event.
   */
  start(platform?: Platform, history?: ConnectionHistory): void {
    if (this.isStarted) {
      console.warn('[IOBridgeEffects] Already started')
      return
    }

    this.isStarted = true

    // Subscribe to state changes
    this.unsubscribe = this.store.subscribe((state, previousState) => {
      this.handleStateChange(state, previousState)
    })

    // Dispatch START event
    this.store.dispatch({
      type: 'START',
      platform: platform ?? this.adapter.platform,
      history: history ?? createConnectionHistory(),
    })
  }

  /**
   * Stop the effects runner and clean up resources.
   */
  stop(): void {
    this.isStarted = false

    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }

    this.cleanup()
  }

  /**
   * Manually trigger a retry.
   */
  retry(): void {
    this.store.dispatch({ type: 'RETRY' })
  }

  /**
   * Manually trigger user launch (ChromeOS).
   */
  userLaunch(): void {
    this.store.dispatch({ type: 'USER_LAUNCH' })
  }

  /**
   * Manually trigger user cancel (ChromeOS).
   */
  userCancel(): void {
    this.store.dispatch({ type: 'USER_CANCEL' })
  }

  private handleStateChange(state: IOBridgeState, previousState: IOBridgeState): void {
    // Clean up effects from previous state
    if (previousState.name !== state.name) {
      this.cleanup()
    }

    // Trigger effects for new state
    switch (state.name) {
      case 'PROBING':
        this.handleProbing()
        break

      case 'CONNECTED':
        if (state.name === 'CONNECTED') {
          this.handleConnected(state.connectionId)
        }
        break

      case 'AWAITING_LAUNCH':
        this.handleAwaitingLaunch()
        break

      case 'DISCONNECTED':
        if (this.config.autoRetryOnDisconnect) {
          this.handleDisconnected()
        }
        break
    }
  }

  private async handleProbing(): Promise<void> {
    try {
      const result = await this.adapter.probe()

      if (result.success) {
        this.store.dispatch({
          type: 'PROBE_SUCCESS',
          connectionId: result.connectionId,
          daemonInfo: result.daemonInfo,
        })
      } else {
        this.store.dispatch({ type: 'PROBE_FAILED' })
      }
    } catch (error) {
      console.error('[IOBridgeEffects] Probe error:', error)
      this.store.dispatch({ type: 'PROBE_FAILED' })
    }
  }

  private handleConnected(connectionId: string): void {
    // Watch for disconnection
    const cleanup = this.adapter.watchConnection(connectionId, (wasHealthy) => {
      this.store.dispatch({
        type: 'DAEMON_DISCONNECTED',
        wasHealthy,
      })
    })

    this.cleanupFns.push(cleanup)
  }

  private async handleAwaitingLaunch(): Promise<void> {
    // Trigger launch
    await this.adapter.triggerLaunch()

    // Start polling for daemon
    const stopPolling = this.adapter.startPolling((connectionId, daemonInfo) => {
      this.store.dispatch({
        type: 'DAEMON_CONNECTED',
        connectionId,
        daemonInfo,
      })
    })

    this.cleanupFns.push(stopPolling)

    // Set up timeout
    this.launchTimeout = setTimeout(() => {
      this.store.dispatch({ type: 'LAUNCH_TIMEOUT' })
    }, this.config.launchTimeoutMs)

    this.cleanupFns.push(() => {
      if (this.launchTimeout) {
        clearTimeout(this.launchTimeout)
        this.launchTimeout = null
      }
    })
  }

  private handleDisconnected(): void {
    // Auto-retry after delay
    this.retryTimeout = setTimeout(() => {
      this.store.dispatch({ type: 'RETRY' })
    }, this.config.autoRetryDelayMs)

    this.cleanupFns.push(() => {
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout)
        this.retryTimeout = null
      }
    })
  }

  private cleanup(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn()
      } catch (error) {
        console.error('[IOBridgeEffects] Cleanup error:', error)
      }
    }
    this.cleanupFns = []
  }
}

/**
 * Create and start an IO Bridge with the given adapter.
 *
 * Convenience function that wires up the store, adapter, and effects.
 */
export function createIOBridge(
  adapter: IIOBridgeAdapter,
  config?: IOBridgeEffectsConfig,
): {
  store: IOBridgeStore
  effects: IOBridgeEffects
  stop: () => void
} {
  const store = new IOBridgeStore()
  const effects = new IOBridgeEffects(store, adapter, config)

  effects.start()

  return {
    store,
    effects,
    stop: () => {
      effects.stop()
      adapter.dispose()
    },
  }
}
