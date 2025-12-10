/**
 * Readiness computation for System Bridge UI.
 * Combines DaemonBridge state + version status + storage roots into a single status.
 */

import type { DaemonBridgeState, DownloadRoot } from '../daemon-bridge'
import type { VersionStatus } from './version-status'

export type ReadinessIssue = 'not_connected' | 'update_required' | 'no_root'

export type IndicatorColor = 'green' | 'yellow' | 'red'

export interface ReadinessStatus {
  /** Whether downloads can proceed */
  ready: boolean

  /** Indicator appearance */
  indicator: {
    label: string
    color: IndicatorColor
  }

  /** What's blocking readiness (if not ready) */
  issues: ReadinessIssue[]

  /** Whether to show update suggestion (non-blocking) */
  canSuggestUpdate: boolean

  /** Whether indicator should pulse (needs user attention) */
  pulse: boolean
}

/**
 * Compute readiness status from component states.
 */
export function getReadiness(
  state: DaemonBridgeState,
  versionStatus: VersionStatus,
  roots: DownloadRoot[],
  hasPendingTorrents: boolean,
): ReadinessStatus {
  const issues: ReadinessIssue[] = []

  // Check connection
  const isConnected = state.status === 'connected'
  if (!isConnected) {
    issues.push('not_connected')
  }

  // Check version (only relevant if connected)
  if (isConnected && versionStatus === 'update_required') {
    issues.push('update_required')
  }

  // Check roots (only relevant if connected)
  const hasRoot = roots.length > 0
  if (isConnected && !hasRoot) {
    issues.push('no_root')
  }

  const ready = issues.length === 0
  const canSuggestUpdate = isConnected && versionStatus === 'update_suggested'

  // Determine indicator
  const indicator = computeIndicator(state, versionStatus, hasRoot, canSuggestUpdate)

  // Pulse when action needed AND torrents waiting
  const pulse = !ready && hasPendingTorrents

  return {
    ready,
    indicator,
    issues,
    canSuggestUpdate,
    pulse,
  }
}

function computeIndicator(
  state: DaemonBridgeState,
  versionStatus: VersionStatus,
  hasRoot: boolean,
  canSuggestUpdate: boolean,
): { label: string; color: IndicatorColor } {
  // Connecting state
  if (state.status === 'connecting') {
    return { label: 'Connecting...', color: 'yellow' }
  }

  // Disconnected state
  if (state.status === 'disconnected') {
    if (state.lastError) {
      return { label: 'Offline', color: 'red' }
    }
    return { label: 'Setup', color: 'yellow' }
  }

  // Connected but version incompatible
  if (state.status === 'connected' && versionStatus === 'update_required') {
    return { label: 'Update Required', color: 'red' }
  }

  // Connected but no download root
  if (state.status === 'connected' && !hasRoot) {
    return { label: 'Setup', color: 'yellow' }
  }

  // Connected, compatible, has root - but update available
  if (state.status === 'connected' && canSuggestUpdate) {
    return { label: 'Update Available', color: 'green' }
  }

  // All good
  if (state.status === 'connected') {
    return { label: 'Ready', color: 'green' }
  }

  // Fallback
  return { label: 'Unknown', color: 'yellow' }
}

/**
 * Check if the user has ever successfully connected to the daemon.
 * This is persisted across service worker restarts.
 */
export async function hasEverConnected(): Promise<boolean> {
  const stored = await chrome.storage.local.get(['daemon:hasConnectedSuccessfully'])
  return stored['daemon:hasConnectedSuccessfully'] === true
}
