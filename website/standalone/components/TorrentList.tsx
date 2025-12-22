import type { TorrentState } from '../hooks/useEngine'
import { formatBytes, formatSpeed, formatEta } from './format'

interface TorrentListProps {
  torrents: TorrentState[]
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
}

export function TorrentList({ torrents, onPause, onResume, onRemove }: TorrentListProps) {
  if (torrents.length === 0) {
    return (
      <div className="empty-state">
        <p style={{ fontSize: '48px' }}>📥</p>
        <p>No torrents yet</p>
        <p style={{ fontSize: '12px' }}>Tap + to add a magnet link</p>
      </div>
    )
  }

  return (
    <div className="torrent-list">
      {torrents.map((t) => (
        <TorrentRow
          key={t.id}
          torrent={t}
          onPause={() => onPause(t.id)}
          onResume={() => onResume(t.id)}
          onRemove={() => onRemove(t.id)}
        />
      ))}
    </div>
  )
}

interface TorrentRowProps {
  torrent: TorrentState
  onPause: () => void
  onResume: () => void
  onRemove: () => void
}

function TorrentRow({ torrent, onPause, onResume, onRemove }: TorrentRowProps) {
  const { name, progress, downloadSpeed, uploadSpeed, status, size, eta, peers } = torrent
  const isPaused = status === 'paused'
  const isError = status === 'error'
  const isComplete = progress >= 1
  const isStopped = isPaused || isError // Both need resume button

  let statsText: string
  if (isError) {
    statsText = `Error - ${(progress * 100).toFixed(1)}% complete`
  } else if (isComplete) {
    statsText = `${formatBytes(size)} - Seeding - ↑${formatSpeed(uploadSpeed)}`
  } else if (isPaused) {
    statsText = `Paused - ${(progress * 100).toFixed(1)}%`
  } else {
    statsText = `${(progress * 100).toFixed(1)}% - ↓${formatSpeed(downloadSpeed)} - ${peers} peers${eta ? ` - ${formatEta(eta)}` : ''}`
  }

  return (
    <div className="torrent-row">
      <div className="torrent-info">
        <div className="torrent-name">{name || 'Loading metadata...'}</div>
        <div className={`torrent-stats ${isError ? 'error' : ''}`}>{statsText}</div>
        <div className="progress-bar">
          <div
            className={`progress-fill ${isPaused ? 'paused' : ''} ${isError ? 'error' : ''}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div className="torrent-actions">
        {isStopped ? (
          <button onClick={onResume} title={isError ? 'Retry' : 'Resume'}>
            ▶
          </button>
        ) : (
          <button onClick={onPause} title="Pause">
            ⏸
          </button>
        )}
        <button onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
    </div>
  )
}
