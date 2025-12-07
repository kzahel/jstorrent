import { useState, useCallback, useMemo } from 'react'
import type { IOBridgeState, VersionStatus } from '../components/SystemBridgePanel'
import type { DownloadRoot } from '../chrome/engine-manager'
import { copyTextToClipboard } from '../utils/clipboard'

export type IndicatorColor = 'green' | 'yellow' | 'red'

export interface ReadinessStatus {
  ready: boolean
  indicator: {
    label: string
    color: IndicatorColor
  }
  issues: Array<'not_connected' | 'update_required' | 'no_root'>
  canSuggestUpdate: boolean
  pulse: boolean
}

/**
 * Compute readiness status from component states.
 * This is a local implementation matching extension/src/lib/io-bridge/readiness.ts
 */
function getReadiness(
  state: IOBridgeState,
  versionStatus: VersionStatus,
  roots: DownloadRoot[],
  hasPendingTorrents: boolean,
): ReadinessStatus {
  const issues: Array<'not_connected' | 'update_required' | 'no_root'> = []

  const isConnected = state.name === 'CONNECTED'
  if (!isConnected) {
    issues.push('not_connected')
  }

  if (isConnected && versionStatus === 'update_required') {
    issues.push('update_required')
  }

  const hasRoot = roots.length > 0
  if (isConnected && !hasRoot) {
    issues.push('no_root')
  }

  const ready = issues.length === 0
  const canSuggestUpdate = isConnected && versionStatus === 'update_suggested'
  const indicator = computeIndicator(state, versionStatus, hasRoot, canSuggestUpdate)
  const pulse = !ready && hasPendingTorrents

  return { ready, indicator, issues, canSuggestUpdate, pulse }
}

function computeIndicator(
  state: IOBridgeState,
  versionStatus: VersionStatus,
  hasRoot: boolean,
  canSuggestUpdate: boolean,
): { label: string; color: IndicatorColor } {
  if (state.name === 'INITIALIZING') return { label: 'Starting...', color: 'yellow' }
  if (state.name === 'PROBING') return { label: 'Connecting...', color: 'yellow' }
  if (state.name === 'INSTALL_PROMPT') return { label: 'Setup', color: 'yellow' }
  if (state.name === 'LAUNCH_PROMPT') return { label: 'Setup', color: 'yellow' }
  if (state.name === 'AWAITING_LAUNCH') return { label: 'Waiting...', color: 'yellow' }
  if (state.name === 'LAUNCH_FAILED') return { label: 'Failed', color: 'red' }
  if (state.name === 'DISCONNECTED') return { label: 'Offline', color: 'red' }

  if (state.name === 'CONNECTED' && versionStatus === 'update_required') {
    return { label: 'Update Required', color: 'red' }
  }
  if (state.name === 'CONNECTED' && !hasRoot) {
    return { label: 'Setup', color: 'yellow' }
  }
  if (state.name === 'CONNECTED' && canSuggestUpdate) {
    return { label: 'Update Available', color: 'green' }
  }
  if (state.name === 'CONNECTED') {
    return { label: 'Ready', color: 'green' }
  }

  return { label: 'Unknown', color: 'yellow' }
}

/**
 * Get version status from daemon version.
 */
function getVersionStatus(daemonVersion: number | undefined): VersionStatus {
  // Simple version check - expand this when versioning becomes more complex
  const minSupported = 1
  const current = 1

  if (daemonVersion === undefined) return 'compatible'
  if (daemonVersion < minSupported) return 'update_required'
  if (daemonVersion < current) return 'update_suggested'
  return 'compatible'
}

export interface UseSystemBridgeConfig {
  /** Current IOBridge state */
  state: IOBridgeState
  /** Download roots from daemon */
  roots: DownloadRoot[]
  /** Default root key from settings */
  defaultRootKey: string | null
  /** Whether there are torrents waiting for connection */
  hasPendingTorrents: boolean
  /** Callbacks for bridge actions */
  onRetry: () => void
  onLaunch: () => void
  onCancel: () => void
  onDisconnect: () => void
  onAddFolder: () => void
  onSetDefaultRoot: (key: string) => void
}

export interface UseSystemBridgeResult {
  /** Whether the panel is open */
  panelOpen: boolean
  /** Open the panel */
  openPanel: () => void
  /** Close the panel */
  closePanel: () => void
  /** Toggle the panel */
  togglePanel: () => void
  /** Readiness status */
  readiness: ReadinessStatus
  /** Version status */
  versionStatus: VersionStatus
  /** Daemon version (if connected) */
  daemonVersion: number | undefined
  /** Copy debug info to clipboard */
  copyDebugInfo: () => Promise<void>
}

/**
 * Hook for managing System Bridge UI state.
 *
 * Takes bridge state and actions as dependencies, computes readiness,
 * and manages panel open/closed state.
 */
export function useSystemBridge(config: UseSystemBridgeConfig): UseSystemBridgeResult {
  const { state, roots, hasPendingTorrents } = config

  const [panelOpen, setPanelOpen] = useState(false)

  // Extract daemon version from connected state
  const daemonVersion = state.name === 'CONNECTED' ? state.daemonInfo.version : undefined
  const versionStatus = useMemo(() => getVersionStatus(daemonVersion), [daemonVersion])

  // Compute readiness
  const readiness = useMemo(
    () => getReadiness(state, versionStatus, roots, hasPendingTorrents),
    [state, versionStatus, roots, hasPendingTorrents],
  )

  // Panel actions
  const openPanel = useCallback(() => setPanelOpen(true), [])
  const closePanel = useCallback(() => setPanelOpen(false), [])
  const togglePanel = useCallback(() => setPanelOpen((prev) => !prev), [])

  // Debug info copy
  const copyDebugInfo = useCallback(async () => {
    const platform = 'platform' in state ? state.platform : 'unknown'
    const info = {
      state: state.name,
      platform,
      version: daemonVersion,
      versionStatus,
      ready: readiness.ready,
      issues: readiness.issues,
      roots: roots.length,
    }
    const text = `JSTorrent Debug Info\n${JSON.stringify(info, null, 2)}`
    await copyTextToClipboard(text)
  }, [state, daemonVersion, versionStatus, readiness, roots])

  return {
    panelOpen,
    openPanel,
    closePanel,
    togglePanel,
    readiness,
    versionStatus,
    daemonVersion,
    copyDebugInfo,
  }
}
