import type { ReactNode } from 'react'
import { formatBytes } from '@jstorrent/ui'
import type { BtEngine } from '@jstorrent/engine'

interface AppHeaderProps {
  /** The torrent engine (for stats display) */
  engine: BtEngine | null
  /** Whether the daemon is connected */
  isConnected: boolean
  /** Platform-specific indicator (SystemIndicator on Chrome, empty on Android) */
  leadingSlot?: ReactNode
  /** Additional action buttons before settings */
  trailingSlot?: ReactNode
  /** Callback when settings button is clicked */
  onSettingsClick?: () => void
  /** Callback when bug report button is clicked (omit to hide button) */
  onBugReportClick?: () => void
  /** Logo image source (defaults to extension icon path) */
  logoSrc?: string
}

/**
 * Shared app header component.
 * Shows logo, title, optional indicator, stats, and action buttons.
 */
export function AppHeader({
  engine,
  isConnected,
  leadingSlot,
  trailingSlot,
  onSettingsClick,
  onBugReportClick,
  logoSrc = '../../icons/js-32.png',
}: AppHeaderProps) {
  return (
    <div
      style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      {/* Logo + Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img src={logoSrc} alt="JSTorrent" style={{ width: '24px', height: '24px' }} />
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>JSTorrent</h1>
      </div>

      {/* Platform-specific indicator */}
      {leadingSlot}

      {/* Stats + Actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <StatsDisplay engine={engine} isConnected={isConnected} />
        {trailingSlot}
        {onBugReportClick && (
          <button
            onClick={onBugReportClick}
            style={{
              background: 'var(--button-bg)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              padding: '6px 12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Report a bug"
          >
            <span style={{ fontSize: '14px' }}>🐛</span>
            Report Bug
          </button>
        )}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            style={{
              background: 'var(--button-bg)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              padding: '6px 12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '16px' }}>⚙</span>
            Settings
          </button>
        )}
      </div>
    </div>
  )
}

interface StatsDisplayProps {
  engine: BtEngine | null
  isConnected: boolean
}

/**
 * Stats display showing torrent count, peer count, and speeds.
 */
function StatsDisplay({ engine, isConnected }: StatsDisplayProps) {
  if (engine) {
    const downloadSpeed = engine.torrents.reduce((sum, t) => sum + t.downloadSpeed, 0)
    const uploadSpeed = engine.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0)
    return (
      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
        {engine.torrents.length} torrents | {engine.numConnections} peers | ↓{' '}
        {formatBytes(downloadSpeed)}/s | ↑ {formatBytes(uploadSpeed)}/s
      </span>
    )
  }
  return (
    <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
      {isConnected ? 'Initializing...' : 'Not connected'}
    </span>
  )
}
