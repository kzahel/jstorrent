/**
 * Desktop IO Bridge Adapter
 *
 * Uses Chrome native messaging to connect to the native host,
 * which manages the daemon lifecycle on Windows, Mac, and Linux.
 */

import type {
  IIOBridgeAdapter,
  ProbeResult,
  OnDaemonConnected,
  OnDaemonDisconnected,
} from '../io-bridge-adapter'
import type { DaemonInfo, ConnectionId } from '../types'
import { NativeHostConnection, type INativeHostConnection } from '../../native-connection'

const HANDSHAKE_TIMEOUT_MS = 10000

/**
 * Configuration for the desktop adapter.
 */
export interface DesktopAdapterConfig {
  /** Factory for creating native host connections (for testing) */
  createConnection?: () => INativeHostConnection
  /** Timeout for handshake in ms */
  handshakeTimeoutMs?: number
}

/**
 * Desktop adapter using Chrome native messaging.
 *
 * On desktop platforms (Windows, Mac, Linux), the native messaging host
 * automatically launches the daemon when connected.
 */
export class DesktopAdapter implements IIOBridgeAdapter {
  readonly platform = 'desktop' as const

  private config: Required<DesktopAdapterConfig>
  private connection: INativeHostConnection | null = null
  private disconnectCallback: OnDaemonDisconnected | null = null
  private currentConnectionId: ConnectionId | null = null

  constructor(config: DesktopAdapterConfig = {}) {
    this.config = {
      createConnection: config.createConnection ?? (() => new NativeHostConnection()),
      handshakeTimeoutMs: config.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    }
  }

  async probe(): Promise<ProbeResult> {
    try {
      // Create and connect to native host
      this.connection = this.config.createConnection()
      await this.connection.connect()

      // Set up disconnect handler IMMEDIATELY to catch crashes during handshake
      let disconnectedDuringProbe = false
      this.connection.onDisconnect(() => {
        console.log('[DesktopAdapter] Disconnected during probe/operation')
        disconnectedDuringProbe = true
        // If we have a callback registered (from watchConnection), notify it
        if (this.disconnectCallback) {
          this.disconnectCallback(true)
          this.cleanup()
        }
      })

      // Generate connection ID
      const connectionId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.currentConnectionId = connectionId

      // Get install ID from storage
      const installId = await this.getInstallId()

      // Send handshake
      const requestId = crypto.randomUUID()
      this.connection.send({
        op: 'handshake',
        extensionId: chrome.runtime.id,
        installId,
        id: requestId,
      })

      // Wait for DaemonInfo response
      const daemonInfo = await this.waitForDaemonInfo()

      // Check if we disconnected during handshake
      if (disconnectedDuringProbe) {
        throw new Error('Disconnected during handshake')
      }

      return {
        success: true,
        connectionId,
        daemonInfo,
      }
    } catch (error) {
      console.error('[DesktopAdapter] Probe failed:', error)
      this.cleanup()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async triggerLaunch(): Promise<boolean> {
    // Desktop native messaging auto-launches the native host
    // No explicit launch needed
    return false
  }

  startPolling(_onConnected: OnDaemonConnected): () => void {
    // Desktop doesn't need polling - probe handles everything
    return () => {}
  }

  watchConnection(connectionId: ConnectionId, onDisconnected: OnDaemonDisconnected): () => void {
    if (connectionId !== this.currentConnectionId) {
      console.warn('[DesktopAdapter] watchConnection called with unknown connectionId')
      return () => {}
    }

    // Store the callback - the disconnect handler was already set up in probe()
    // and will call this callback when disconnect occurs
    this.disconnectCallback = onDisconnected

    return () => {
      this.disconnectCallback = null
    }
  }

  dispose(): void {
    this.cleanup()
  }

  /**
   * Send a message to the native host.
   * Useful for operations like pickDownloadDirectory.
   */
  send(msg: unknown): void {
    this.connection?.send(msg)
  }

  /**
   * Register a message handler for native host messages.
   */
  onMessage(cb: (msg: unknown) => void): void {
    this.connection?.onMessage(cb)
  }

  // ===========================================================================
  // Private methods
  // ===========================================================================

  private async getInstallId(): Promise<string> {
    const result = await chrome.storage.local.get('installId')
    if (result.installId) {
      return result.installId as string
    }
    const newId = crypto.randomUUID()
    await chrome.storage.local.set({ installId: newId })
    return newId
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Handshake timeout'))
      }, this.config.handshakeTimeoutMs)

      const handler = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'type' in msg &&
          (msg as { type: string }).type === 'DaemonInfo' &&
          'payload' in msg
        ) {
          clearTimeout(timeoutId)
          const payload = (msg as { type: string; payload: DaemonInfo }).payload
          console.log('[DesktopAdapter] Received DaemonInfo:', payload)
          resolve(payload)
        }
      }

      this.connection?.onMessage(handler)
    })
  }

  private cleanup(): void {
    // Note: Chrome native messaging doesn't have an explicit disconnect method
    // Setting connection to null allows garbage collection
    this.connection = null
    this.currentConnectionId = null
    this.disconnectCallback = null
  }
}
