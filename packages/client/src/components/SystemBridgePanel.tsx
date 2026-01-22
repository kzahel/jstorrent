import type { RefObject } from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { DownloadRoot } from '../types'

/**
 * Stats from the daemon about socket and connection state
 */
export interface DaemonStats {
  tcp_sockets: number
  pending_connects: number
  pending_tcp: number
  udp_sockets: number
  tcp_servers: number
  ws_connections: number
  bytes_sent: number
  bytes_received: number
  uptime_secs: number
}

// Version status from io-bridge
export type VersionStatus = 'compatible' | 'update_suggested' | 'update_required'
// Platform type
export type Platform = 'desktop' | 'chromeos'

// Daemon info structure
interface DaemonInfo {
  port: number
  token: string
  version?: string
  roots: DownloadRoot[]
  host?: string
}

// Connection status (simplified from 8-state IOBridge)
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

// DaemonBridge state (new simplified state)
export interface DaemonBridgeState {
  status: ConnectionStatus
  platform: Platform
  daemonInfo: DaemonInfo | null
  roots: DownloadRoot[]
  lastError: string | null
}

export interface SystemBridgePanelProps {
  state: DaemonBridgeState
  versionStatus: VersionStatus
  daemonVersion: string | undefined
  roots: DownloadRoot[]
  defaultRootKey: string | null
  hasEverConnected: boolean
  onClose: () => void
  onRetry: () => void
  onLaunch: () => void
  onCancel: () => void
  onAddFolder: () => void
  onSetDefaultRoot: (key: string) => void
  onOpenSettings?: () => void
  /** Ref to the anchor element (toggle button) - clicks on it won't trigger close */
  anchorRef?: RefObject<HTMLElement | null>
  /** Optional callback to fetch daemon stats */
  onFetchStats?: () => Promise<DaemonStats | null>
}

export function SystemBridgePanel({
  state,
  versionStatus,
  daemonVersion,
  roots,
  defaultRootKey,
  hasEverConnected,
  onClose,
  onRetry,
  onLaunch,
  // onCancel - no longer used with simplified bridge
  onAddFolder,
  // onSetDefaultRoot - selection moved to Settings
  onOpenSettings,
  anchorRef,
  onFetchStats,
}: SystemBridgePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<DaemonStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // First time = never successfully connected before (persistent across restarts)
  const isFirstTime = !hasEverConnected

  // Fetch stats when expanded
  const handleToggleStats = useCallback(async () => {
    if (showStats) {
      setShowStats(false)
      return
    }
    setShowStats(true)
    if (onFetchStats) {
      setStatsLoading(true)
      try {
        const result = await onFetchStats()
        setStats(result)
      } finally {
        setStatsLoading(false)
      }
    }
  }, [showStats, onFetchStats])

  // Format bytes to human-readable
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  // Format uptime to human-readable
  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  // Click-outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      // Don't close if clicking inside the panel or on the anchor (toggle button)
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (anchorRef?.current && anchorRef.current.contains(target)) {
          // Click was on the toggle button - let its onClick handle the toggle
          return
        }
        onClose()
      }
    }

    // Delay adding listener to avoid immediate close from the click that opened the panel
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, anchorRef])

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '4px',
        width: '320px',
        background: 'var(--bg-primary, white)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '14px' }}>System Bridge</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '4px',
            color: 'var(--text-secondary)',
          }}
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>{renderContent()}</div>

      {/* Footer - only show when disconnected (has actions) */}
      {state.status === 'disconnected' && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-color, #e5e7eb)',
            display: 'flex',
            gap: '8px',
          }}
        >
          {renderActions()}
        </div>
      )}
    </div>
  )

  function renderContent() {
    switch (state.status) {
      case 'connecting':
        return (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: '8px' }}>Connecting...</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Looking for companion app
            </div>
          </div>
        )

      case 'disconnected':
        // Different messages based on platform and whether we've connected before
        if (state.platform === 'desktop') {
          return (
            <div>
              <div style={{ marginBottom: '12px', fontWeight: 500 }}>
                {state.lastError ? 'Connection Lost' : 'Companion App Required'}
              </div>
              <div
                style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}
              >
                {state.lastError ? (
                  <>Connection to companion app was lost. Click retry to reconnect.</>
                ) : (
                  <>
                    JSTorrent needs a companion app to handle downloads.
                    {isFirstTime && <> Download and install it to get started.</>}
                  </>
                )}
              </div>
            </div>
          )
        } else {
          // ChromeOS
          return (
            <div>
              <div style={{ marginBottom: '12px', fontWeight: 500 }}>
                {state.lastError ? 'Connection Lost' : 'Launch Companion App'}
              </div>
              <div
                style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}
              >
                {state.lastError ? (
                  <>Connection to companion app was lost. Click Launch to reconnect.</>
                ) : isFirstTime ? (
                  <>Install the JSTorrent Companion app from the Play Store, then click Launch.</>
                ) : (
                  <>Click Launch to start the companion app.</>
                )}
              </div>
            </div>
          )
        }

      case 'connected':
        return renderConnectedContent()

      default:
        return null
    }
  }

  function renderConnectedContent() {
    if (state.status !== 'connected' || !state.daemonInfo) return null

    const { daemonInfo } = state

    // Show update required prominently
    if (versionStatus === 'update_required') {
      return (
        <div>
          <div
            style={{
              padding: '12px',
              background: 'var(--accent-error-bg, #fef2f2)',
              borderRadius: '6px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontWeight: 500, color: 'var(--accent-error)', marginBottom: '4px' }}>
              Update Required
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              The companion app (v{daemonVersion ?? '?'}) is too old. Please download the latest
              version.
            </div>
          </div>
        </div>
      )
    }

    return (
      <>
        {/* Connection info */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>Companion App</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div>&#x25CF; Connected &mdash; v{daemonVersion ?? '?'}</div>
            <div style={{ marginTop: '4px' }}>
              {daemonInfo.host ?? '127.0.0.1'}:{daemonInfo.port}
            </div>
          </div>

          {versionStatus === 'update_suggested' && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                background: 'var(--accent-info-bg, #eff6ff)',
                borderRadius: '4px',
                fontSize: '13px',
              }}
            >
              Update available
            </div>
          )}
        </div>

        {/* Download location */}
        <div>
          <div style={{ fontWeight: 500, marginBottom: '4px' }}>Download Location</div>
          {roots.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              No download folder configured.
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {roots.find((r) => r.key === defaultRootKey)?.display_name ?? 'None selected'}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={onAddFolder}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Add Folder...
            </button>
            {onOpenSettings && (
              <button
                onClick={() => {
                  onOpenSettings()
                  onClose()
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: '6px 0',
                }}
              >
                Manage in Settings
              </button>
            )}
          </div>
        </div>

        {/* Stats section - only show if onFetchStats is provided */}
        {onFetchStats && (
          <div
            style={{
              marginTop: '16px',
              borderTop: '1px solid var(--border-color, #e5e7eb)',
              paddingTop: '12px',
            }}
          >
            <button
              onClick={handleToggleStats}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span
                style={{
                  transform: showStats ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s',
                }}
              >
                &#x25B6;
              </span>
              Debug Stats
            </button>

            {showStats && (
              <div
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                }}
              >
                {statsLoading ? (
                  <div>Loading...</div>
                ) : stats ? (
                  <div
                    style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 12px' }}
                  >
                    <span>Uptime:</span>
                    <span>{formatUptime(stats.uptime_secs)}</span>
                    <span>TCP Sockets:</span>
                    <span>{stats.tcp_sockets}</span>
                    <span>Pending TCP:</span>
                    <span>{stats.pending_tcp}</span>
                    <span>Pending Connects:</span>
                    <span>{stats.pending_connects}</span>
                    <span>UDP Sockets:</span>
                    <span>{stats.udp_sockets}</span>
                    <span>TCP Servers:</span>
                    <span>{stats.tcp_servers}</span>
                    <span>WS Connections:</span>
                    <span>{stats.ws_connections}</span>
                    <span>Bytes Sent:</span>
                    <span>{formatBytes(stats.bytes_sent)}</span>
                    <span>Bytes Received:</span>
                    <span>{formatBytes(stats.bytes_received)}</span>
                  </div>
                ) : (
                  <div>Unable to fetch stats</div>
                )}
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  function renderActions() {
    switch (state.status) {
      case 'connecting':
        // No actions while connecting, but show cancel if we want
        return null

      case 'disconnected':
        if (state.platform === 'desktop') {
          // Desktop: show download/retry
          return (
            <>
              {isFirstTime ? (
                <a
                  href="https://new.jstorrent.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                  }}
                >
                  Download
                </a>
              ) : (
                <a
                  href="https://new.jstorrent.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    fontSize: '13px',
                    textDecoration: 'none',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Reinstall
                </a>
              )}
              <button
                onClick={onRetry}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  ...(isFirstTime
                    ? {}
                    : {
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }),
                }}
              >
                {isFirstTime ? "I've Installed It" : 'Try Again'}
              </button>
            </>
          )
        } else {
          // ChromeOS: show launch button
          return (
            <>
              <button
                onClick={onLaunch}
                style={{
                  padding: '6px 12px',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {isFirstTime ? 'Setup JSTorrent' : 'Open JSTorrent'}
              </button>
              {isFirstTime && (
                <a
                  href="https://play.google.com/store/apps/details?id=com.jstorrent.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    fontSize: '13px',
                    textDecoration: 'none',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Install
                </a>
              )}
            </>
          )
        }

      case 'connected':
        return null

      default:
        return null
    }
  }
}
