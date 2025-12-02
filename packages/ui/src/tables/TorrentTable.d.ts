import { Torrent } from '@jstorrent/engine'
import { ColumnDef } from './types'
/**
 * Column definitions for torrent table.
 */
export declare const torrentColumns: ColumnDef<Torrent>[]
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
export declare function TorrentTable(
  props: TorrentTableProps,
): import('react/jsx-runtime').JSX.Element
export {}
//# sourceMappingURL=TorrentTable.d.ts.map
