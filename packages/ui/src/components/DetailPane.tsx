import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'

export type DetailTab = 'peers' | 'pieces' | 'files' | 'trackers'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}

export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Currently selected torrent hash (null = none selected) */
  selectedHash: string | null
}

const tabStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--text-secondary)',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  color: 'var(--text-primary)',
  borderBottomColor: 'var(--accent-primary)',
}

/**
 * Detail pane showing info about the selected torrent.
 */
export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('peers')

  if (!props.selectedHash) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        Select a torrent to view details
      </div>
    )
  }

  const torrent = props.source.getTorrent(props.selectedHash)
  if (!torrent) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        Torrent not found
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <button
          style={activeTab === 'peers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('peers')}
        >
          Peers ({torrent.numPeers})
        </button>
        <button
          style={activeTab === 'pieces' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('pieces')}
        >
          Pieces ({torrent.completedPiecesCount}/{torrent.piecesCount})
        </button>
        <button
          style={activeTab === 'files' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('files')}
        >
          Files ({torrent.files.length})
        </button>
        <button
          style={activeTab === 'trackers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('trackers')}
        >
          Trackers
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' && (
          <PeerTable source={props.source} torrentHash={props.selectedHash} />
        )}
        {activeTab === 'pieces' && (
          <PieceTable source={props.source} torrentHash={props.selectedHash} />
        )}
        {activeTab === 'files' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Files table coming soon</div>
        )}
        {activeTab === 'trackers' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
            Trackers table coming soon
          </div>
        )}
      </div>
    </div>
  )
}
