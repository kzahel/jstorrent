import { Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Piece info derived from torrent state.
 * Not a real class - computed on-the-fly for display.
 */
export interface PieceInfo {
  index: number
  size: number
  state: 'have' | 'active' | 'missing'
  availability: number // How many peers have this piece
}

/**
 * Compute piece info array from torrent.
 * Called every frame by the RAF loop.
 */
function computePieces(torrent: Torrent | null): PieceInfo[] {
  if (!torrent || torrent.piecesCount === 0) return []

  const bitfield = torrent.bitfield
  const pieces: PieceInfo[] = []

  // Build availability map from connected peers
  const availability = new Map<number, number>()
  for (const peer of torrent.peers) {
    if (peer.bitfield) {
      for (let i = 0; i < torrent.piecesCount; i++) {
        if (peer.bitfield.get(i)) {
          availability.set(i, (availability.get(i) ?? 0) + 1)
        }
      }
    }
  }

  for (let i = 0; i < torrent.piecesCount; i++) {
    const have = bitfield?.get(i) ?? false
    const isLast = i === torrent.piecesCount - 1
    const size = isLast ? torrent.lastPieceLength : torrent.pieceLength

    pieces.push({
      index: i,
      size,
      state: have ? 'have' : 'missing', // TODO: detect 'active' from ActivePieceManager
      availability: availability.get(i) ?? 0,
    })
  }

  return pieces
}

/**
 * Column definitions for piece table.
 */
const pieceColumns: ColumnDef<PieceInfo>[] = [
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
    getValue: (p) => formatBytes(p.size),
    width: 80,
    align: 'right',
  },
  {
    id: 'state',
    header: 'State',
    getValue: (p) => p.state,
    width: 80,
  },
  {
    id: 'availability',
    header: 'Avail',
    getValue: (p) => p.availability || '-',
    width: 50,
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
 * Virtualized piece table for a single torrent.
 * Can handle thousands of pieces efficiently.
 */
export function PieceTable(props: PieceTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null

  return (
    <TableMount<PieceInfo>
      getRows={() => computePieces(getTorrent())}
      getRowKey={(p) => String(p.index)}
      columns={pieceColumns}
      storageKey="pieces"
      rowHeight={24}
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
    />
  )
}
