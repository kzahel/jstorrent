import { Torrent, ActivePiece } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

function formatElapsed(timestamp: number): string {
  const elapsed = Date.now() - timestamp
  if (elapsed < 1000) return `${elapsed}ms`
  const tenths = Math.floor(elapsed / 100) / 10
  return `${tenths.toFixed(1)}s`
}

/**
 * Column definitions for active piece table.
 */
const activePieceColumns: ColumnDef<ActivePiece>[] = [
  {
    id: 'index',
    header: '#',
    getValue: (p) => p.index,
    width: 60,
    align: 'right',
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (p) => formatBytes(p.length),
    width: 80,
    align: 'right',
  },
  {
    id: 'blocksNeeded',
    header: 'Blocks',
    getValue: (p) => p.blocksNeeded,
    width: 60,
    align: 'right',
  },
  {
    id: 'blocksReceived',
    header: 'Recv',
    getValue: (p) => p.blocksReceived,
    width: 60,
    align: 'right',
  },
  {
    id: 'requests',
    header: 'Reqs',
    getValue: (p) => p.outstandingRequests,
    width: 50,
    align: 'right',
  },
  {
    id: 'buffered',
    header: 'Buffered',
    getValue: (p) => formatBytes(p.bufferedBytes),
    width: 80,
    align: 'right',
  },
  {
    id: 'activity',
    header: 'Activity',
    getValue: (p) => formatElapsed(p.lastActivity),
    width: 70,
    align: 'right',
  },
]

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface PieceTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
  /** Get selected row keys (for Solid bridge) */
  getSelectedKeys?: () => Set<string>
  /** Called when selection changes */
  onSelectionChange?: (keys: Set<string>) => void
}

/**
 * Virtualized table showing active pieces being downloaded.
 * Displays raw metrics that update frequently via RAF loop.
 * Pieces disappear when persisted (hash verified, written to disk).
 */
export function PieceTable(props: PieceTableProps) {
  const getRows = (): ActivePiece[] => {
    const torrent = props.source.getTorrent(props.torrentHash)
    if (!torrent) return []
    return torrent.getActivePieces()
  }

  return (
    <TableMount<ActivePiece>
      getRows={getRows}
      getRowKey={(p) => String(p.index)}
      columns={activePieceColumns}
      storageKey="pieces"
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
      refreshKey={props.torrentHash}
    />
  )
}
