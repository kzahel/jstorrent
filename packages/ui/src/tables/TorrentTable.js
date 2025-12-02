import { jsx as _jsx } from 'react/jsx-runtime'
import { TableMount } from './mount'
import { formatBytes } from '../utils/format'
/**
 * Column definitions for torrent table.
 */
export const torrentColumns = [
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
    getValue: (t) => `${(t.progress * 100).toFixed(1)}%`,
    width: 70,
    align: 'right',
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (t) => t.activityState,
    width: 100,
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
    id: 'seeds',
    header: 'Seeds',
    getValue: () => {
      // Count peers that have 100% (are seeds)
      // This would need swarm data - simplified for now
      return '-'
    },
    width: 60,
    align: 'right',
    sortable: false, // No real data to sort by
  },
]
/**
 * Virtualized torrent table component.
 * Reads directly from source on every frame - no React closure issues.
 */
export function TorrentTable(props) {
  return _jsx(TableMount, {
    getRows: () => props.source.torrents,
    getRowKey: (t) => t.infoHashStr,
    columns: torrentColumns,
    storageKey: 'torrents',
    getSelectedKeys: props.getSelectedHashes,
    onSelectionChange: props.onSelectionChange,
    onRowClick: props.onRowClick,
    onRowDoubleClick: props.onRowDoubleClick,
    onRowContextMenu: props.onRowContextMenu,
    rowHeight: 28,
  })
}
