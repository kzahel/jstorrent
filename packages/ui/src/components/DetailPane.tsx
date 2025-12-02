import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
import { GeneralPane } from './GeneralPane'

export type DetailTab = 'general' | 'peers' | 'pieces' | 'files' | 'trackers'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}

export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Selected hashes - empty Set means none, Set with 1 item shows details, Set with 2+ shows count */
  selectedHashes: Set<string>
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

const emptyStateStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
}

/**
 * Detail pane showing info about the selected torrent.
 */
export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('general')

  // No selection
  if (props.selectedHashes.size === 0) {
    return <div style={emptyStateStyle}>Select a torrent to view details</div>
  }

  // Multi-selection
  if (props.selectedHashes.size > 1) {
    return <div style={emptyStateStyle}>{props.selectedHashes.size} torrents selected</div>
  }

  // Single selection - show details
  const selectedHash = [...props.selectedHashes][0]
  const torrent = props.source.getTorrent(selectedHash)

  if (!torrent) {
    return <div style={emptyStateStyle}>Torrent not found</div>
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
          style={activeTab === 'general' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
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
        {activeTab === 'general' && <GeneralPane torrent={torrent} />}
        {activeTab === 'peers' && <PeerTable source={props.source} torrentHash={selectedHash} />}
        {activeTab === 'pieces' && <PieceTable source={props.source} torrentHash={selectedHash} />}
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
