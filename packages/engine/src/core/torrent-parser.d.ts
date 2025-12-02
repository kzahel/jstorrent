import { TorrentFile } from './torrent-file'
import { IHasher } from '../interfaces/hasher'
export interface ParsedTorrent {
  infoHash: Uint8Array
  name: string
  pieceLength: number
  pieces: Uint8Array[]
  files: TorrentFile[]
  length: number
  announce: string[]
  infoBuffer?: Uint8Array
}
export declare class TorrentParser {
  static parse(buffer: Uint8Array, hasher: IHasher): Promise<ParsedTorrent>
  static parseInfoBuffer(infoBuffer: Uint8Array, hasher: IHasher): Promise<ParsedTorrent>
  static parseInfoDictionary(
    info: any,
    infoHash: Uint8Array,
    announceList?: Uint8Array[][],
    announceUrl?: Uint8Array,
    infoBuffer?: Uint8Array,
  ): ParsedTorrent
}
//# sourceMappingURL=torrent-parser.d.ts.map
