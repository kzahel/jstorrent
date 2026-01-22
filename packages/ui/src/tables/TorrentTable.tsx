import { Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes, computeEtaSeconds, formatEta } from '../utils/format'
import { ProgressBar } from './ProgressBar.solid'

/**
 * Column definitions for torrent table.
 */
export const torrentColumns: ColumnDef<Torrent>[] = [
  {
    id: 'name',
    header: 'Name',
    getValue: (t) => t.name || 'Loading...',
    width: 300,
    minWidth: 100,
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (t) => formatBytes(t.contentStorage?.getTotalSize() ?? 0),
    width: 80,
    align: 'right',
  },
  {
    id: 'progress',
    header: 'Done',
    getValue: (t) => t.progress * 100, // Numeric for sorting
    width: 80,
    align: 'center',
    renderCell: (t) =>
      ProgressBar({
        progress: t.progress,
        isActive: t.activityState !== 'stopped',
      }),
  },
  {
    id: 'eta',
    header: 'ETA',
    getValue: (t) =>
      computeEtaSeconds(t.progress, t.contentStorage?.getTotalSize() ?? 0, t.downloadSpeed),
    width: 80,
    align: 'right',
    renderCell: (t) =>
      formatEta(t.progress, t.contentStorage?.getTotalSize() ?? 0, t.downloadSpeed),
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (t) => {
      if (t.activityState === 'checking') {
        return `${(t.checkingProgress * 100).toFixed(0)}% checking`
      }
      return t.activityState
    },
    width: 100,
    getCellTitle: (t) => t.errorMessage,
    getCellStyle: (t) =>
      t.errorMessage
        ? {
            color: '#e74c3c',
            'text-decoration': 'underline dotted',
            cursor: 'help',
          }
        : undefined,
  },
  {
    id: 'downloaded',
    header: 'Downloaded',
    getValue: (t) => formatBytes(t.totalDownloaded),
    width: 90,
    align: 'right',
  },
  {
    id: 'uploaded',
    header: 'Uploaded',
    getValue: (t) => formatBytes(t.totalUploaded),
    width: 90,
    align: 'right',
  },
  {
    id: 'downloadSpeed',
    header: 'Down Speed',
    getValue: (t) => (t.downloadSpeed > 0 ? formatBytes(t.downloadSpeed) + '/s' : '-'),
    width: 100,
    align: 'right',
  },
  {
    id: 'uploadSpeed',
    header: 'Up Speed',
    getValue: (t) => (t.uploadSpeed > 0 ? formatBytes(t.uploadSpeed) + '/s' : '-'),
    width: 100,
    align: 'right',
  },
  {
    id: 'peers',
    header: 'Peers',
    getValue: (t) => (t.numPeers > 0 ? t.numPeers : '-'),
    width: 60,
    align: 'right',
  },
  {
    id: 'addedAt',
    header: 'Added',
    getValue: (t) => t.addedAt,
    width: 140,
    align: 'right',
    renderCell: (_t, value) => (typeof value === 'number' ? new Date(value).toLocaleString() : '-'),
  },
  {
    id: 'completedAt',
    header: 'Completed',
    getValue: (t) => t.completedAt ?? 0,
    width: 140,
    align: 'right',
    defaultHidden: true,
    renderCell: (t) => (t.completedAt ? new Date(t.completedAt).toLocaleString() : '-'),
  },
]

/** Minimal interface for reading torrents - avoids coupling to full adapter */
interface TorrentSource {
  readonly torrents: Torrent[]
}

export interface TorrentTableProps {
  /** Source to read torrents from (read directly each frame, bypasses React) */
  source: TorrentSource
  /** Getter for selected torrent hashes (avoids closure issues) */
  getSelectedHashes?: () => Set<string>
  /** Selection change callback */
  onSelectionChange?: (hashes: Set<string>) => void
  /** Row click callback */
  onRowClick?: (torrent: Torrent) => void
  /** Row double-click callback */
  onRowDoubleClick?: (torrent: Torrent) => void
  /** Row right-click callback - receives torrent and mouse position */
  onRowContextMenu?: (torrent: Torrent, x: number, y: number) => void
}

/**
 * Virtualized torrent table component.
 * Reads directly from source on every frame - no React closure issues.
 */
export function TorrentTable(props: TorrentTableProps) {
  return (
    <TableMount<Torrent>
      getRows={() => props.source.torrents}
      getRowKey={(t) => t.infoHashStr}
      getRowTooltip={(t) => t.errorMessage}
      columns={torrentColumns}
      storageKey="torrents"
      getSelectedKeys={props.getSelectedHashes}
      onSelectionChange={props.onSelectionChange}
      onRowClick={props.onRowClick}
      onRowDoubleClick={props.onRowDoubleClick}
      onRowContextMenu={props.onRowContextMenu}
      rowHeight={28}
    />
  )
}
