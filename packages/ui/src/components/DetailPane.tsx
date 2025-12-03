import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import type { LogStore } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
import { FileTable } from '../tables/FileTable'
import { GeneralPane } from './GeneralPane'
import { LogTableWrapper } from '../tables/LogTableWrapper'

export type DetailTab = 'peers' | 'pieces' | 'files' | 'general' | 'logs'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
  getLogStore(): LogStore
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

const placeholderStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
}

/**
 * Detail pane showing info about the selected torrent.
 * Tab bar is always visible. Logs tab works without selection.
 */
export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('logs')

  // Get selected torrent (if single selection)
  const selectedHash = props.selectedHashes.size === 1 ? [...props.selectedHashes][0] : null
  const torrent = selectedHash ? props.source.getTorrent(selectedHash) : null

  // Helper to render torrent-specific content or placeholder
  const renderTorrentContent = (content: React.ReactNode, tabName: string) => {
    if (props.selectedHashes.size === 0) {
      return <div style={placeholderStyle}>Select a torrent to view {tabName}</div>
    }
    if (props.selectedHashes.size > 1) {
      return <div style={placeholderStyle}>{props.selectedHashes.size} torrents selected</div>
    }
    if (!torrent) {
      return <div style={placeholderStyle}>Torrent not found</div>
    }
    return content
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar - always visible */}
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
          Peers {torrent ? `(${torrent.numPeers})` : ''}
        </button>
        <button
          style={activeTab === 'pieces' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('pieces')}
        >
          Pieces {torrent ? `(${torrent.completedPiecesCount}/${torrent.piecesCount})` : ''}
        </button>
        <button
          style={activeTab === 'files' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('files')}
        >
          Files {torrent ? `(${torrent.files.length})` : ''}
        </button>
        <button
          style={activeTab === 'general' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          style={activeTab === 'logs' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('logs')}
        >
          Logs
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' &&
          renderTorrentContent(
            <PeerTable source={props.source} torrentHash={selectedHash!} />,
            'peers',
          )}
        {activeTab === 'pieces' &&
          renderTorrentContent(
            <PieceTable source={props.source} torrentHash={selectedHash!} />,
            'pieces',
          )}
        {activeTab === 'files' &&
          renderTorrentContent(
            <FileTable source={props.source} torrentHash={selectedHash!} />,
            'files',
          )}
        {activeTab === 'general' &&
          renderTorrentContent(<GeneralPane torrent={torrent!} />, 'general info')}
        {activeTab === 'logs' && <LogTableWrapper logStore={props.source.getLogStore()} />}
      </div>
    </div>
  )
}
