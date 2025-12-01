import React, { useState, useRef, useEffect } from 'react'
import { Torrent } from '@jstorrent/engine'
import { formatBytes } from '../utils/format'

const iconButtonStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  padding: 0,
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
}

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  zIndex: 100,
  minWidth: '150px',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'none',
  color: 'var(--text-primary)',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '13px',
}

export interface TorrentItemProps {
  torrent: Torrent
  onStart?: (torrent: Torrent) => void
  onStop?: (torrent: Torrent) => void
  onDelete?: (torrent: Torrent) => void
  onRecheck?: (torrent: Torrent) => void
  onReset?: (torrent: Torrent) => void
  onShare?: (torrent: Torrent) => void
}

export const TorrentItem: React.FC<TorrentItemProps> = ({
  torrent,
  onStart,
  onStop,
  onDelete,
  onRecheck,
  onReset,
  onShare,
}) => {
  const isStopped = torrent.userState === 'stopped'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const handleMenuAction = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return (
    <li
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '12px',
        marginBottom: '8px',
        cursor: 'pointer',
      }}
      onClick={() => console.log(torrent)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold' }}>{torrent.name || 'Loading metadata...'}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {torrent.activityState} | {(torrent.progress * 100).toFixed(1)}% | {torrent.numPeers}{' '}
            peers | {torrent.files.length} files |{' '}
            {formatBytes(torrent.contentStorage?.getTotalSize() || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {formatBytes(torrent.downloadSpeed)}/s | {formatBytes(torrent.uploadSpeed)}/s
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {isStopped ? (
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                onStart?.(torrent)
              }}
              title="Start"
            >
              ▶
            </button>
          ) : (
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                onStop?.(torrent)
              }}
              title="Stop"
            >
              ⏸
            </button>
          )}
          <button
            style={{ ...iconButtonStyle, color: 'var(--accent-error)' }}
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(torrent)
            }}
            title="Delete"
          >
            ✕
          </button>
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              style={iconButtonStyle}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              title="More actions"
            >
              ☰
            </button>
            {menuOpen && (
              <div style={dropdownMenuStyle}>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onRecheck?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Re-verify Data
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onReset?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Reset State
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleMenuAction(() => onShare?.(torrent))
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  Share Link
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          height: '4px',
          background: 'var(--progress-bg)',
          borderRadius: '2px',
          marginTop: '8px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${torrent.progress * 100}%`,
            background:
              torrent.activityState === 'seeding'
                ? 'var(--accent-success)'
                : 'var(--accent-primary)',
            borderRadius: '2px',
          }}
        />
      </div>
    </li>
  )
}
