import React from 'react'
import { Torrent } from '@jstorrent/engine'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

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

interface TorrentItemProps {
  torrent: Torrent
  onStart?: (torrent: Torrent) => void
  onStop?: (torrent: Torrent) => void
  onDelete?: (torrent: Torrent) => void
}

export const TorrentItem: React.FC<TorrentItemProps> = ({ torrent, onStart, onStop, onDelete }) => {
  const isStopped = torrent.userState === 'stopped'

  return (
    <li
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        padding: '12px',
        marginBottom: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold' }}>{torrent.name || 'Loading metadata...'}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {torrent.activityState} | {(torrent.progress * 100).toFixed(1)}% | {torrent.numPeers} peers |{' '}
            {torrent.files.length} files | {formatBytes(torrent.contentStorage?.getTotalSize() || 0)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {formatBytes(torrent.downloadSpeed)}/s | {formatBytes(torrent.uploadSpeed)}/s
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {isStopped ? (
            <button
              style={iconButtonStyle}
              onClick={() => onStart?.(torrent)}
              title="Start"
            >
              ▶
            </button>
          ) : (
            <button
              style={iconButtonStyle}
              onClick={() => onStop?.(torrent)}
              title="Stop"
            >
              ⏸
            </button>
          )}
          <button
            style={{ ...iconButtonStyle, color: 'var(--accent-error)' }}
            onClick={() => onDelete?.(torrent)}
            title="Delete"
          >
            ✕
          </button>
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
              torrent.activityState === 'seeding' ? 'var(--accent-success)' : 'var(--accent-primary)',
            borderRadius: '2px',
          }}
        />
      </div>
    </li>
  )
}
