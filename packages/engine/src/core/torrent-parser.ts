import { Bencode } from '../utils/bencode'
import { TorrentFile } from './torrent-file'
import { sha1 } from '../utils/hash'

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

export class TorrentParser {
  static async parse(buffer: Uint8Array): Promise<ParsedTorrent> {
    const decoded = Bencode.decode(buffer)
    const info = decoded.info
    if (!info) {
      throw new Error('Invalid torrent: missing info dictionary')
    }

    // Calculate infoHash
    const infoBuffer = Bencode.getRawInfo(buffer)
    if (!infoBuffer) {
      throw new Error('Invalid torrent: could not extract raw info for hashing')
    }

    // We need crypto for SHA1.
    // Since this is likely running in Node or an environment with crypto, we can use it.
    // However, to be safe and consistent with other parts, we might want to use a subtle crypto wrapper or just require('crypto').
    // The Torrent class uses `await import('crypto')`. We should probably do the same or use a synchronous version if possible.
    // For parsing, we usually want it synchronous.
    // Let's assume Node.js 'crypto' is available for now.
    // If this runs in browser, we'll need a polyfill or async API.
    // Given the synchronous signature, let's try to use require('crypto') if available, or throw.
    // Actually, `Bencode.getRawInfo` returns the buffer. The caller might want to hash it.
    // But `ParsedTorrent` should probably contain the hash.
    // Let's use `createHash` from `crypto`.
    const infoHash = await sha1(infoBuffer)
    return this.parseInfoDictionary(
      info,
      infoHash,
      decoded['announce-list'],
      decoded.announce,
      infoBuffer,
    )
  }

  static async parseInfoBuffer(infoBuffer: Uint8Array): Promise<ParsedTorrent> {
    const info = Bencode.decode(infoBuffer)
    const infoHash = await sha1(infoBuffer)
    return this.parseInfoDictionary(info, infoHash, undefined, undefined, infoBuffer)
  }

  static parseInfoDictionary(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info: any,
    infoHash: Uint8Array,
    announceList?: Uint8Array[][],
    announceUrl?: Uint8Array,
    infoBuffer?: Uint8Array,
  ): ParsedTorrent {
    const name = new TextDecoder().decode(info.name)
    const pieceLength = info['piece length']

    const piecesBuffer = info.pieces
    if (piecesBuffer.length % 20 !== 0) {
      throw new Error('Invalid torrent: pieces length must be multiple of 20')
    }

    const pieces: Uint8Array[] = []
    for (let i = 0; i < piecesBuffer.length; i += 20) {
      pieces.push(piecesBuffer.slice(i, i + 20))
    }

    const files: TorrentFile[] = []
    let totalLength = 0

    if (info.files) {
      // Multi-file
      let offset = 0
      for (const file of info.files) {
        const pathParts = file.path.map((p: Uint8Array) => new TextDecoder().decode(p))
        const path = pathParts.join('/')
        const length = file.length
        files.push({
          path,
          length,
          offset,
        })
        offset += length
        totalLength += length
      }
    } else {
      // Single file
      totalLength = info.length
      files.push({
        path: name,
        length: totalLength,
        offset: 0,
      })
    }

    const announce: string[] = []
    if (announceList) {
      for (const tier of announceList) {
        for (const url of tier) {
          announce.push(new TextDecoder().decode(url))
        }
      }
    } else if (announceUrl) {
      announce.push(new TextDecoder().decode(announceUrl))
    }

    return {
      infoHash,
      name,
      pieceLength,
      pieces,
      files,
      length: totalLength,
      announce,
      infoBuffer,
    }
  }
}
