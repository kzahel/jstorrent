import { Torrent } from '@jstorrent/engine'
export type DetailTab = 'peers' | 'pieces' | 'files' | 'trackers'
/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}
export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Selected hashes - empty Set means none, Set with 1 item shows details, Set with 2+ shows count */
  selectedHashes: Set<string>
}
/**
 * Detail pane showing info about the selected torrent.
 */
export declare function DetailPane(props: DetailPaneProps): import('react/jsx-runtime').JSX.Element
export {}
//# sourceMappingURL=DetailPane.d.ts.map
