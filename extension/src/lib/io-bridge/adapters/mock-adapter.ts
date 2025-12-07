/**
 * Mock IO Bridge Adapter
 *
 * A controllable mock adapter for testing the IO Bridge.
 */

import type {
  IIOBridgeAdapter,
  ProbeResult,
  OnDaemonConnected,
  OnDaemonDisconnected,
} from '../io-bridge-adapter'
import type { Platform, DaemonInfo, ConnectionId } from '../types'

/**
 * Configuration for mock adapter behavior.
 */
export interface MockAdapterConfig {
  platform: Platform
  probeResult?: ProbeResult
  probeDelay?: number
  launchSucceeds?: boolean
  pollingInterval?: number
}

/**
 * Mock adapter for testing.
 *
 * Allows controlling behavior via configuration and methods.
 */
export class MockAdapter implements IIOBridgeAdapter {
  readonly platform: Platform

  private config: MockAdapterConfig
  private probeCallCount = 0
  private launchCallCount = 0
  private pollingCallbacks: OnDaemonConnected[] = []
  private disconnectCallbacks: Map<ConnectionId, OnDaemonDisconnected> = new Map()
  private pollingTimers: ReturnType<typeof setInterval>[] = []
  private disposed = false

  constructor(config: MockAdapterConfig) {
    this.config = config
    this.platform = config.platform
  }

  /**
   * Get probe call count for assertions.
   */
  getProbeCallCount(): number {
    return this.probeCallCount
  }

  /**
   * Get launch call count for assertions.
   */
  getLaunchCallCount(): number {
    return this.launchCallCount
  }

  /**
   * Update the probe result for subsequent probes.
   */
  setProbeResult(result: ProbeResult): void {
    this.config.probeResult = result
  }

  /**
   * Simulate daemon connecting (for ChromeOS flow).
   */
  simulateDaemonConnected(connectionId: ConnectionId, daemonInfo: DaemonInfo): void {
    for (const callback of this.pollingCallbacks) {
      callback(connectionId, daemonInfo)
    }
  }

  /**
   * Simulate daemon disconnecting.
   */
  simulateDaemonDisconnected(connectionId: ConnectionId, wasHealthy: boolean = true): void {
    const callback = this.disconnectCallbacks.get(connectionId)
    if (callback) {
      callback(wasHealthy)
    }
  }

  async probe(): Promise<ProbeResult> {
    this.probeCallCount++

    if (this.config.probeDelay) {
      await new Promise((resolve) => setTimeout(resolve, this.config.probeDelay))
    }

    return (
      this.config.probeResult ?? {
        success: false,
        error: 'No probe result configured',
      }
    )
  }

  async triggerLaunch(): Promise<boolean> {
    this.launchCallCount++

    if (this.platform !== 'chromeos') {
      return false
    }

    return this.config.launchSucceeds ?? true
  }

  startPolling(onConnected: OnDaemonConnected): () => void {
    this.pollingCallbacks.push(onConnected)

    const index = this.pollingCallbacks.length - 1

    return () => {
      this.pollingCallbacks.splice(index, 1)
    }
  }

  watchConnection(connectionId: ConnectionId, onDisconnected: OnDaemonDisconnected): () => void {
    this.disconnectCallbacks.set(connectionId, onDisconnected)

    return () => {
      this.disconnectCallbacks.delete(connectionId)
    }
  }

  dispose(): void {
    this.disposed = true
    this.pollingCallbacks = []
    this.disconnectCallbacks.clear()
    for (const timer of this.pollingTimers) {
      clearInterval(timer)
    }
    this.pollingTimers = []
  }

  isDisposed(): boolean {
    return this.disposed
  }
}

/**
 * Create a mock daemon info for testing.
 */
export function createMockDaemonInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
  return {
    port: 7800,
    token: 'test-token-' + Math.random().toString(36).slice(2),
    version: 1,
    roots: [
      {
        key: 'default',
        path: '/downloads',
        display_name: 'Downloads',
        removable: false,
        last_stat_ok: true,
        last_checked: Date.now(),
      },
    ],
    ...overrides,
  }
}

/**
 * Create a successful probe result.
 */
export function createSuccessProbeResult(
  connectionId: ConnectionId = 'mock-conn-' + Date.now(),
  daemonInfo: DaemonInfo = createMockDaemonInfo(),
): ProbeResult {
  return {
    success: true,
    connectionId,
    daemonInfo,
  }
}

/**
 * Create a failed probe result.
 */
export function createFailedProbeResult(error: string = 'Mock probe failed'): ProbeResult {
  return {
    success: false,
    error,
  }
}
