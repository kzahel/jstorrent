import React, { useEffect } from 'react'
import { Torrent } from '@jstorrent/engine'
import type {
  LogStore,
  DiskQueueSnapshot,
  TrackerStats,
  BandwidthTracker,
  DHTStats,
  DHTNodeInfo,
} from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
import { FileTable } from '../tables/FileTable'
import type { TorrentFileInfo } from '@jstorrent/engine'
import { SwarmTable } from '../tables/SwarmTable'
import { GeneralPane } from './GeneralPane'
import { LogTableWrapper } from '../tables/LogTableWrapper'
import { DiskTable } from '../tables/DiskTable'
import { TrackerTable } from '../tables/TrackerTable'
import { SpeedTab } from './SpeedTab'
import { DhtTab } from './DhtTab'
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
  | 'dht'

export const DEFAULT_DETAIL_TAB: DetailTab = 'general'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
  getLogStore(): LogStore
  getDiskQueueSnapshot(hash: string): DiskQueueSnapshot | null
  getTrackerStats(hash: string): TrackerStats[]
  getBandwidthTracker(): BandwidthTracker
  getDHTStats(): DHTStats | null
  getDHTNodes(): DHTNodeInfo[]
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
  /** Callback when user wants to open a file */
  onOpenFile?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Callback when user wants to reveal a file in folder */
  onRevealInFolder?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Callback when user wants to copy the file path */
  onCopyFilePath?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Callback when user wants to set file priority */
  onSetFilePriority?: (torrentHash: string, fileIndex: number, priority: number) => void
  /** Callback to open logging settings */
  onOpenLoggingSettings?: () => void
}

const tabStyle: React.CSSProperties = {
  padding: 'var(--spacing-sm, 8px) var(--spacing-md, 12px)',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: 'var(--font-base, 13px)',
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

function TorrentPlaceholder({
  selectedCount,
  tabName,
}: {
  selectedCount: number
  tabName: string
}) {
  const message =
    selectedCount === 0
      ? `Select a torrent to view ${tabName}`
      : selectedCount > 1
        ? `${selectedCount} torrents selected`
        : 'Torrent not found'
  return <div style={placeholderStyle}>{message}</div>
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
        {/* Spacer pushes global tabs (Logs, Speed) to the right */}
        <div style={{ flex: 1 }} />
        <button style={getTabStyle(activeTab === 'logs')} onClick={() => onTabChange('logs')}>
          Logs
        </button>
        <button style={getTabStyle(activeTab === 'speed')} onClick={() => onTabChange('speed')}>
          Speed
        </button>
        <button style={getTabStyle(activeTab === 'dht')} onClick={() => onTabChange('dht')}>
          DHT
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' &&
          (selectedHash && torrent ? (
            <PeerTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="peers" />
          ))}
        {activeTab === 'swarm' &&
          (selectedHash && torrent ? (
            <SwarmTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="swarm" />
          ))}
        {activeTab === 'pieces' &&
          (selectedHash && torrent ? (
            <PieceTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="pieces" />
          ))}
        {activeTab === 'files' &&
          (selectedHash && torrent ? (
            <FileTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
              onOpenFile={props.onOpenFile}
              onRevealInFolder={props.onRevealInFolder}
              onCopyFilePath={props.onCopyFilePath}
              onSetFilePriority={props.onSetFilePriority}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="files" />
          ))}
        {activeTab === 'general' &&
          (torrent ? (
            <GeneralPane torrent={torrent} />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="general info" />
          ))}
        {activeTab === 'trackers' &&
          (selectedHash && torrent ? (
            <TrackerTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="trackers" />
          ))}
        {activeTab === 'logs' && (
          <LogTableWrapper
            logStore={props.source.getLogStore()}
            onOpenSettings={props.onOpenLoggingSettings}
          />
        )}
        {activeTab === 'speed' && (
          <SpeedTab bandwidthTracker={props.source.getBandwidthTracker()} />
        )}
        {activeTab === 'dht' && (
          <DhtTab stats={props.source.getDHTStats()} nodes={props.source.getDHTNodes()} />
        )}
        {activeTab === 'disk' &&
          (selectedHash && torrent ? (
            <DiskTable
              source={props.source}
              torrentHash={selectedHash}
              getSelectedKeys={getSelectedKeys}
              onSelectionChange={onSelectionChange}
            />
          ) : (
            <TorrentPlaceholder selectedCount={props.selectedHashes.size} tabName="disk activity" />
          ))}
      </div>
    </div>
  )
}
