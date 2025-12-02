import { jsx as _jsx } from 'react/jsx-runtime'
import { TableMount } from './mount'
import { formatBytes } from '../utils/format'
/**
 * Compute piece info array from torrent.
 * Called every frame by the RAF loop.
 */
function computePieces(torrent) {
  if (!torrent || torrent.piecesCount === 0) return []
  const bitfield = torrent.bitfield
  const pieces = []
  // Build availability map from connected peers
  const availability = new Map()
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
const pieceColumns = [
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
/**
 * Virtualized piece table for a single torrent.
 * Can handle thousands of pieces efficiently.
 */
export function PieceTable(props) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null
  return _jsx(TableMount, {
    getRows: () => computePieces(getTorrent()),
    getRowKey: (p) => String(p.index),
    columns: pieceColumns,
    storageKey: 'pieces',
    rowHeight: 24,
  })
}
