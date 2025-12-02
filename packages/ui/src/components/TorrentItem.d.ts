import React from 'react'
import { Torrent } from '@jstorrent/engine'
export interface TorrentItemProps {
  torrent: Torrent
  onStart?: (torrent: Torrent) => void
  onStop?: (torrent: Torrent) => void
  onDelete?: (torrent: Torrent) => void
  onRecheck?: (torrent: Torrent) => void
  onReset?: (torrent: Torrent) => void
  onShare?: (torrent: Torrent) => void
}
export declare const TorrentItem: React.FC<TorrentItemProps>
//# sourceMappingURL=TorrentItem.d.ts.map
