import { Torrent } from '@jstorrent/engine'
/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}
export interface PeerTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
}
/**
 * Virtualized peer table for a single torrent.
 */
export declare function PeerTable(props: PeerTableProps): import('react/jsx-runtime').JSX.Element
export {}
//# sourceMappingURL=PeerTable.d.ts.map
