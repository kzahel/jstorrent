import { PeerAddress } from '../core/swarm'
export interface ParsedMagnet {
  infoHash: string
  name?: string
  announce?: string[]
  urlList?: string[]
  peers?: PeerAddress[]
}
export interface GenerateMagnetOptions {
  infoHash: string
  name?: string
  announce?: string[]
}
export declare function generateMagnet(options: GenerateMagnetOptions): string
export declare function parseMagnet(uri: string): ParsedMagnet
/**
 * Create a torrent file buffer from raw metadata (info dict) and trackers.
 * This allows re-adding a torrent with its metadata preserved.
 */
export declare function createTorrentBuffer(options: {
  metadataRaw: Uint8Array
  announce?: string[]
}): Uint8Array
//# sourceMappingURL=magnet.d.ts.map
