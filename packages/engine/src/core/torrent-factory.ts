import { IHasher } from '../interfaces/hasher'
import { parseMagnet } from '../utils/magnet'
import { TorrentParser, ParsedTorrent } from './torrent-parser'
import { fromHex, toBase64 } from '../utils/buffer'
import type { PeerAddress } from './swarm'

/**
 * Result of parsing a magnet link or torrent file.
 * Contains all the information needed to create a Torrent instance.
 */
export interface ParsedTorrentInput {
  infoHash: Uint8Array
  infoHashStr: string
  announce: string[]

  // Origin info (one of these will be set)
  magnetLink?: string
  torrentFileBase64?: string

  // From magnet link
  magnetDisplayName?: string
  magnetPeerHints?: PeerAddress[]

  // From torrent file (has metadata)
  infoBuffer?: Uint8Array
  torrentFileBuffer?: Uint8Array // The entire .torrent file (for saving)
  parsedTorrent?: ParsedTorrent
}

/**
 * Parse a magnet link or torrent file buffer into a structured format.
 * This extracts all information without creating any Torrent objects.
 */
export async function parseTorrentInput(
  magnetOrBuffer: string | Uint8Array,
  hasher: IHasher,
): Promise<ParsedTorrentInput> {
  if (typeof magnetOrBuffer === 'string') {
    // Parse magnet link
    const parsed = parseMagnet(magnetOrBuffer)
    const infoHash = fromHex(parsed.infoHash)

    return {
      infoHash,
      infoHashStr: parsed.infoHash,
      announce: parsed.announce || [],
      magnetLink: magnetOrBuffer,
      magnetDisplayName: parsed.name,
      magnetPeerHints: parsed.peers,
    }
  } else {
    // Parse torrent file
    const parsedTorrent = await TorrentParser.parse(magnetOrBuffer, hasher)
    const infoHashStr = Array.from(parsedTorrent.infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return {
      infoHash: parsedTorrent.infoHash,
      infoHashStr,
      announce: parsedTorrent.announce,
      torrentFileBase64: toBase64(magnetOrBuffer),
      infoBuffer: parsedTorrent.infoBuffer,
      torrentFileBuffer: magnetOrBuffer, // Store raw buffer for persistence
      parsedTorrent,
    }
  }
}
