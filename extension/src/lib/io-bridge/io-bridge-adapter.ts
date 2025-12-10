/**
 * IO Bridge Adapter Interface
 *
 * Defines the interface for platform-specific adapters.
 * Adapters handle the actual I/O operations for connecting to the daemon.
 */

import type { DaemonInfo, Platform, ConnectionId } from './types'

/**
 * Result of a probe operation.
 */
export type ProbeResult =
  | { success: true; connectionId: ConnectionId; daemonInfo: DaemonInfo }
  | { success: false; error?: string }

/**
 * Callback for when the daemon connects (used during awaiting launch).
 */
export type OnDaemonConnected = (connectionId: ConnectionId, daemonInfo: DaemonInfo) => void

/**
 * Callback for when the daemon disconnects.
 */
export type OnDaemonDisconnected = (wasHealthy: boolean) => void

/**
 * Platform-specific adapter interface.
 *
 * Each adapter handles the specifics of connecting to the daemon
 * on its platform (native messaging for desktop, HTTP for ChromeOS).
 */
export interface IIOBridgeAdapter {
  /**
   * The platform this adapter supports.
   */
  readonly platform: Platform

  /**
   * Probe for daemon availability.
   *
   * - Desktop: Opens native messaging, performs handshake
   * - ChromeOS: HTTP check to Android container
   *
   * Returns a promise that resolves with probe result.
   */
  probe(): Promise<ProbeResult>

  /**
   * Trigger daemon launch (ChromeOS only).
   *
   * - Desktop: No-op (native messaging auto-launches)
   * - ChromeOS: Opens intent URL to launch Android app
   *
   * Returns true if launch was triggered, false if not applicable.
   */
  triggerLaunch(): Promise<boolean>

  /**
   * Start polling for daemon connection (ChromeOS only).
   *
   * Used after triggerLaunch() to wait for the daemon to become available.
   * The onConnected callback is called if the daemon becomes available.
   *
   * Returns a cleanup function to stop polling.
   */
  startPolling(onConnected: OnDaemonConnected): () => void

  /**
   * Set up disconnect detection for an active connection.
   *
   * Called after successful probe or poll connection.
   * The onDisconnected callback is called if connection is lost.
   *
   * Returns a cleanup function.
   */
  watchConnection(connectionId: ConnectionId, onDisconnected: OnDaemonDisconnected): () => void

  /**
   * Clean up any resources held by the adapter.
   */
  dispose(): void

  /**
   * Trigger folder picker on Android (ChromeOS only).
   * Opens the SAF folder picker to let user select a download directory.
   *
   * Returns true if intent was opened successfully.
   */
  triggerAddRoot?(): Promise<boolean>

  /**
   * Wait for a new root to appear after picker (ChromeOS only).
   * Polls /roots endpoint until a new root key appears or timeout.
   *
   * @param existingKeys - Set of root keys that existed before picker was opened
   * @param timeoutMs - Maximum time to wait (default 30000ms)
   * @returns The new root if found, null if timeout
   */
  waitForNewRoot?(
    existingKeys: Set<string>,
    timeoutMs?: number,
  ): Promise<import('./types').DownloadRoot | null>
}

/**
 * Factory function type for creating adapters.
 */
export type AdapterFactory = () => IIOBridgeAdapter
