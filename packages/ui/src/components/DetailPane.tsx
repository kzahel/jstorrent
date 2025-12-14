import React, { useEffect } from 'react'
import { Torrent } from '@jstorrent/engine'
import type { LogStore, DiskQueueSnapshot, TrackerStats, BandwidthTracker } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
import { FileTable } from '../tables/FileTable'
import { SwarmTable } from '../tables/SwarmTable'
import { GeneralPane } from './GeneralPane'
import { LogTableWrapper } from '../tables/LogTableWrapper'
import { DiskTable } from '../tables/DiskTable'
import { TrackerTable } from '../tables/TrackerTable'
import { SpeedTab } from './SpeedTab'
import { useSelection } from '../hooks/useSelection'

export type DetailTab =
  | 'peers'
  | 'swarm'
  | 'pieces'
  | 'files'
  | 'general'
  | 'trackers'
  | 'logs'
  | 'disk'
  | 'speed'

export const DEFAULT_DETAIL_TAB: DetailTab = 'general'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
  getLogStore(): LogStore
  getDiskQueueSnapshot(hash: string): DiskQueueSnapshot | null
  getTrackerStats(hash: string): TrackerStats[]
  getBandwidthTracker(): BandwidthTracker
}

export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Selected hashes - empty Set means none, Set with 1 item shows details, Set with 2+ shows count */
  selectedHashes: Set<string>
  /** Active tab */
  activeTab: DetailTab
  /** Callback when tab changes */
  onTabChange: (tab: DetailTab) => void
}

const tabStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  textAlign: 'center',
}

const TAB_WIDTH = 80

const getTabStyle = (isActive: boolean): React.CSSProperties => ({
  ...tabStyle,
  width: TAB_WIDTH,
  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
  borderBottomColor: isActive ? 'var(--accent-primary)' : 'transparent',
})

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
  const { activeTab, onTabChange } = props

  // Get selected torrent (if single selection)
  const selectedHash = props.selectedHashes.size === 1 ? [...props.selectedHashes][0] : null
  const torrent = selectedHash ? props.source.getTorrent(selectedHash) : null

  // Selection state for detail pane tables (shared, cleared on tab/torrent switch)
  const detailSelection = useSelection()
  const { getSelectedKeys, onSelectionChange, clear: clearSelection } = detailSelection

  // Clear selection when tab or torrent changes
  useEffect(() => {
    clearSelection()
  }, [activeTab, selectedHash, clearSelection])

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
        <button style={getTabStyle(activeTab === 'general')} onClick={() => onTabChange('general')}>
          General
        </button>
        <button
          style={getTabStyle(activeTab === 'trackers')}
          onClick={() => onTabChange('trackers')}
        >
          Trackers
        </button>
        <button style={getTabStyle(activeTab === 'peers')} onClick={() => onTabChange('peers')}>
          Peers {torrent ? `(${torrent.numPeers})` : ''}
        </button>
        <button style={getTabStyle(activeTab === 'swarm')} onClick={() => onTabChange('swarm')}>
          Swarm
        </button>
        <button style={getTabStyle(activeTab === 'files')} onClick={() => onTabChange('files')}>
          Files {torrent ? `(${torrent.files.length})` : ''}
        </button>
        <button style={getTabStyle(activeTab === 'pieces')} onClick={() => onTabChange('pieces')}>
          Pieces
        </button>
        <button style={getTabStyle(activeTab === 'disk')} onClick={() => onTabChange('disk')}>
          Disk
        </button>
        <button style={getTabStyle(activeTab === 'logs')} onClick={() => onTabChange('logs')}>
          Logs
        </button>
        <button style={getTabStyle(activeTab === 'speed')} onClick={() => onTabChange('speed')}>
          Speed
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' &&
          renderTorrentContent(
            <PeerTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'peers',
          )}
        {activeTab === 'swarm' &&
          renderTorrentContent(
            <SwarmTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'swarm',
          )}
        {activeTab === 'pieces' &&
          renderTorrentContent(
            <PieceTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'pieces',
          )}
        {activeTab === 'files' &&
          renderTorrentContent(
            <FileTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'files',
          )}
        {activeTab === 'general' &&
          renderTorrentContent(<GeneralPane torrent={torrent!} />, 'general info')}
        {activeTab === 'trackers' &&
          renderTorrentContent(
            <TrackerTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'trackers',
          )}
        {activeTab === 'logs' && <LogTableWrapper logStore={props.source.getLogStore()} />}
        {activeTab === 'speed' && (
          <SpeedTab bandwidthTracker={props.source.getBandwidthTracker()} />
        )}
        {activeTab === 'disk' &&
          renderTorrentContent(
            <DiskTable
              source={props.source}
              torrentHash={selectedHash!}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />,
            'disk activity',
          )}
      </div>
    </div>
  )
}
