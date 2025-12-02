import { Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

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
    id: 'downloadSpeed',
    header: 'Down',
    getValue: (t) => (t.downloadSpeed > 0 ? formatBytes(t.downloadSpeed) + '/s' : '-'),
    width: 90,
    align: 'right',
  },
  {
    id: 'uploadSpeed',
    header: 'Up',
    getValue: (t) => (t.uploadSpeed > 0 ? formatBytes(t.uploadSpeed) + '/s' : '-'),
    width: 90,
    align: 'right',
  },
  {
    id: 'peers',
    header: 'Peers',
    getValue: (t) => t.numPeers,
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
