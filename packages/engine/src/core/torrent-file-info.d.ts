import { TorrentFile } from './torrent-file'
import type { Torrent } from './torrent'
export declare class TorrentFileInfo {
  private file
  private torrent
  constructor(file: TorrentFile, torrent: Torrent)
  get path(): string
  get length(): number
  get downloaded(): number
  get progress(): number
  get isComplete(): boolean
  get priority(): number
}
//# sourceMappingURL=torrent-file-info.d.ts.map
