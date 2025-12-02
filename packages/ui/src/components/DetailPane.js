import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime'
import { useState } from 'react'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
const tabStyle = {
  padding: '8px 16px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--text-secondary)',
}
const activeTabStyle = {
  ...tabStyle,
  color: 'var(--text-primary)',
  borderBottomColor: 'var(--accent-primary)',
}
const emptyStateStyle = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
}
/**
 * Detail pane showing info about the selected torrent.
 */
export function DetailPane(props) {
  const [activeTab, setActiveTab] = useState('peers')
  // No selection
  if (props.selectedHashes.size === 0) {
    return _jsx('div', { style: emptyStateStyle, children: 'Select a torrent to view details' })
  }
  // Multi-selection
  if (props.selectedHashes.size > 1) {
    return _jsxs('div', {
      style: emptyStateStyle,
      children: [props.selectedHashes.size, ' torrents selected'],
    })
  }
  // Single selection - show details
  const selectedHash = [...props.selectedHashes][0]
  const torrent = props.source.getTorrent(selectedHash)
  if (!torrent) {
    return _jsx('div', { style: emptyStateStyle, children: 'Torrent not found' })
  }
  return _jsxs('div', {
    style: { height: '100%', display: 'flex', flexDirection: 'column' },
    children: [
      _jsxs('div', {
        style: {
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        },
        children: [
          _jsxs('button', {
            style: activeTab === 'peers' ? activeTabStyle : tabStyle,
            onClick: () => setActiveTab('peers'),
            children: ['Peers (', torrent.numPeers, ')'],
          }),
          _jsxs('button', {
            style: activeTab === 'pieces' ? activeTabStyle : tabStyle,
            onClick: () => setActiveTab('pieces'),
            children: ['Pieces (', torrent.completedPiecesCount, '/', torrent.piecesCount, ')'],
          }),
          _jsxs('button', {
            style: activeTab === 'files' ? activeTabStyle : tabStyle,
            onClick: () => setActiveTab('files'),
            children: ['Files (', torrent.files.length, ')'],
          }),
          _jsx('button', {
            style: activeTab === 'trackers' ? activeTabStyle : tabStyle,
            onClick: () => setActiveTab('trackers'),
            children: 'Trackers',
          }),
        ],
      }),
      _jsxs('div', {
        style: { flex: 1, minHeight: 0 },
        children: [
          activeTab === 'peers' &&
            _jsx(PeerTable, { source: props.source, torrentHash: selectedHash }),
          activeTab === 'pieces' &&
            _jsx(PieceTable, { source: props.source, torrentHash: selectedHash }),
          activeTab === 'files' &&
            _jsx('div', {
              style: { padding: 20, color: 'var(--text-secondary)' },
              children: 'Files table coming soon',
            }),
          activeTab === 'trackers' &&
            _jsx('div', {
              style: { padding: 20, color: 'var(--text-secondary)' },
              children: 'Trackers table coming soon',
            }),
        ],
      }),
    ],
  })
}
