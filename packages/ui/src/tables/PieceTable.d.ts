import { Torrent } from '@jstorrent/engine'
/**
 * Piece info derived from torrent state.
 * Not a real class - computed on-the-fly for display.
 */
export interface PieceInfo {
  index: number
  size: number
  state: 'have' | 'active' | 'missing'
  availability: number
}
/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}
export interface PieceTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
}
/**
 * Virtualized piece table for a single torrent.
 * Can handle thousands of pieces efficiently.
 */
export declare function PieceTable(props: PieceTableProps): import('react/jsx-runtime').JSX.Element
export {}
//# sourceMappingURL=PieceTable.d.ts.map
