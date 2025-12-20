import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import type {
  BootstrapState,
  BootstrapProblem,
} from '../../../../extension/src/lib/chromeos-bootstrap'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.jstorrent.app'

export interface SystemBridgePanelChromeosProps {
  state: BootstrapState
  daemonVersion?: string
  roots: Array<{ key: string; display_name: string }>
  defaultRootKey: string | null
  hasEverConnected: boolean
  onClose: () => void
  onLaunch: () => void
  onResetPairing: () => void
  onAddFolder: () => void
  onOpenSettings?: () => void
  anchorRef?: RefObject<HTMLElement | null>
}

interface StateDisplay {
  title: string
  message: string
  showLaunchButton: boolean
  showResetButton: boolean
  showPlayStoreLink: boolean
}

function getStateDisplay(
  phase: BootstrapState['phase'],
  problem: BootstrapProblem,
  hasEverConnected: boolean,
): StateDisplay {
  if (phase === 'connected') {
    return {
      title: 'Connected',
      message: '',
      showLaunchButton: false,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  if (phase === 'connecting') {
    return {
      title: 'Connecting...',
      message: 'Establishing connection',
      showLaunchButton: false,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  if (phase === 'pairing') {
    if (problem === 'pair_conflict') {
      return {
        title: 'Pairing Blocked',
        message: 'Another pairing dialog is open. Dismiss it in the Android app and try again.',
        showLaunchButton: true,
        showResetButton: true,
        showPlayStoreLink: false,
      }
    }
    if (problem === 'token_invalid' || problem === 'auth_failed') {
      return {
        title: 'Re-pairing Required',
        message:
          'The connection token expired. Approve the new pairing request in the Android app.',
        showLaunchButton: true,
        showResetButton: true,
        showPlayStoreLink: false,
      }
    }
    return {
      title: 'Pairing Required',
      message: 'Approve the pairing request in the Android app.',
      showLaunchButton: true,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  // Handle connection_lost specifically
  if (problem === 'connection_lost') {
    return {
      title: 'Connection Lost',
      message: 'The Android app disconnected. Tap Launch to reconnect.',
      showLaunchButton: true,
      showResetButton: false,
      showPlayStoreLink: false,
    }
  }

  // probing or idle with not_reachable
  if (!hasEverConnected) {
    return {
      title: 'Setup Required',
      message: 'Install the JSTorrent companion app from the Play Store, then tap Launch.',
      showLaunchButton: true,
      showResetButton: false,
      showPlayStoreLink: true,
    }
  }

  return {
    title: 'Android App Not Running',
    message: 'Tap Launch to start the companion app.',
    showLaunchButton: true,
    showResetButton: false,
    showPlayStoreLink: false,
  }
}

export function SystemBridgePanelChromeos({
  state,
  daemonVersion,
  roots,
  defaultRootKey,
  hasEverConnected,
  onClose,
  onLaunch,
  onResetPairing,
  onAddFolder,
  onOpenSettings,
  anchorRef,
}: SystemBridgePanelChromeosProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const display = getStateDisplay(state.phase, state.problem, hasEverConnected)

  // Click-outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (anchorRef?.current && anchorRef.current.contains(target)) {
          return
        }
        onClose()
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, anchorRef])

  // Escape to close
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isConnected = state.phase === 'connected'

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
      <div style={{ padding: '16px' }}>
        {isConnected ? (
          <ConnectedContent
            port={state.port!}
            daemonVersion={daemonVersion}
            roots={roots}
            defaultRootKey={defaultRootKey}
            onAddFolder={onAddFolder}
            onOpenSettings={onOpenSettings}
            onClose={onClose}
          />
        ) : (
          <DisconnectedContent
            display={display}
            stateMessage={state.message}
            onLaunch={onLaunch}
            onResetPairing={onResetPairing}
          />
        )}
      </div>
    </div>
  )
}

function DisconnectedContent({
  display,
  stateMessage,
  onLaunch,
  onResetPairing,
}: {
  display: StateDisplay
  stateMessage: string
  onLaunch: () => void
  onResetPairing: () => void
}) {
  return (
    <div>
      <div style={{ marginBottom: '8px', fontWeight: 500 }}>{display.title}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        {display.message}
      </div>

      {/* Debug: show actual state message */}
      {stateMessage && stateMessage !== display.message && (
        <div
          style={{
            color: 'var(--text-tertiary)',
            fontSize: '11px',
            marginBottom: '12px',
            fontFamily: 'monospace',
          }}
        >
          {stateMessage}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {display.showLaunchButton && (
          <button
            onClick={onLaunch}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            Launch App
          </button>
        )}

        {display.showPlayStoreLink && (
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              textDecoration: 'none',
              color: 'var(--text-secondary)',
            }}
          >
            Get from Play Store
          </a>
        )}

        {display.showResetButton && (
          <button
            onClick={onResetPairing}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
            }}
          >
            Reset Pairing
          </button>
        )}
      </div>
    </div>
  )
}

function ConnectedContent({
  port,
  daemonVersion,
  roots,
  defaultRootKey,
  onAddFolder,
  onOpenSettings,
  onClose,
}: {
  port: number
  daemonVersion?: string
  roots: Array<{ key: string; display_name: string }>
  defaultRootKey: string | null
  onAddFolder: () => void
  onOpenSettings?: () => void
  onClose: () => void
}) {
  return (
    <>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Android App</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <div>&#x25CF; Connected {daemonVersion && `— v${daemonVersion}`}</div>
          <div style={{ marginTop: '4px' }}>100.115.92.2:{port}</div>
        </div>
      </div>

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
            style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
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
