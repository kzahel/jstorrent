/**
 * Readiness computation for System Bridge UI.
 * Combines IOBridge state + version status + storage roots into a single status.
 */

import type { IOBridgeState } from './types'
import type { VersionStatus } from './version-status'
import type { DownloadRoot } from './types'

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
  state: IOBridgeState,
  versionStatus: VersionStatus,
  roots: DownloadRoot[],
  hasPendingTorrents: boolean,
): ReadinessStatus {
  const issues: ReadinessIssue[] = []

  // Check connection
  const isConnected = state.name === 'CONNECTED'
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
  state: IOBridgeState,
  versionStatus: VersionStatus,
  hasRoot: boolean,
  canSuggestUpdate: boolean,
): { label: string; color: IndicatorColor } {
  // Not connected states
  if (state.name === 'INITIALIZING') {
    return { label: 'Starting...', color: 'yellow' }
  }

  if (state.name === 'PROBING') {
    return { label: 'Connecting...', color: 'yellow' }
  }

  if (state.name === 'INSTALL_PROMPT') {
    return { label: 'Setup', color: 'yellow' }
  }

  if (state.name === 'LAUNCH_PROMPT') {
    return { label: 'Setup', color: 'yellow' }
  }

  if (state.name === 'AWAITING_LAUNCH') {
    return { label: 'Waiting...', color: 'yellow' }
  }

  if (state.name === 'LAUNCH_FAILED') {
    return { label: 'Failed', color: 'red' }
  }

  if (state.name === 'DISCONNECTED') {
    return { label: 'Offline', color: 'red' }
  }

  // Connected but version incompatible
  if (state.name === 'CONNECTED' && versionStatus === 'update_required') {
    return { label: 'Update Required', color: 'red' }
  }

  // Connected but no download root
  if (state.name === 'CONNECTED' && !hasRoot) {
    return { label: 'Setup', color: 'yellow' }
  }

  // Connected, compatible, has root - but update available
  if (state.name === 'CONNECTED' && canSuggestUpdate) {
    return { label: 'Update Available', color: 'green' }
  }

  // All good
  if (state.name === 'CONNECTED') {
    return { label: 'Ready', color: 'green' }
  }

  // Fallback
  return { label: 'Unknown', color: 'yellow' }
}

/**
 * Helper to determine if a state represents a "first time" user.
 * Based on whether there have been any previous attempts.
 * @deprecated Use hasEverConnected() for persistent first-time detection
 */
export function isFirstTimeUser(state: IOBridgeState): boolean {
  if ('history' in state) {
    return state.history.attempts === 0
  }
  return true
}

/**
 * Check if the user has ever successfully connected to the daemon.
 * This is persisted across service worker restarts.
 */
export async function hasEverConnected(): Promise<boolean> {
  const stored = await chrome.storage.local.get(['iobridge:hasConnectedSuccessfully'])
  return stored['iobridge:hasConnectedSuccessfully'] === true
}
