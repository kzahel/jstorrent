import { useEffect, useRef } from 'react'
import type { DownloadRoot } from '../chrome/engine-manager'

// Version status from io-bridge
export type VersionStatus = 'compatible' | 'update_suggested' | 'update_required'

// Platform type
export type Platform = 'desktop' | 'chromeos'

// Daemon info structure
interface DaemonInfo {
  port: number
  token: string
  version?: number
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
  daemonVersion: number | undefined
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
  onSetDefaultRoot,
  onOpenSettings,
}: SystemBridgePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // First time = never successfully connected before (persistent across restarts)
  const isFirstTime = !hasEverConnected

  // Click-outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
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
  }, [onClose])

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

        {/* Download locations */}
        <div>
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>Download Locations</div>
          {roots.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              No download folder configured. Click &quot;Add Folder&quot; to get started.
            </div>
          ) : (
            <div style={{ fontSize: '13px' }}>
              {roots.map((root) => (
                <label
                  key={root.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 0',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="defaultRoot"
                    checked={root.key === defaultRootKey}
                    onChange={() => onSetDefaultRoot(root.key)}
                  />
                  <span style={{ flex: 1 }}>{root.display_name}</span>
                </label>
              ))}
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
              {isFirstTime && (
                <a
                  href="https://jstorrent.com/download"
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
                Launch App
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
