import { Bencode } from '../utils/bencode'
import { TorrentFile } from './torrent-file'
import * as crypto from 'crypto'

export interface ParsedTorrent {
  infoHash: Uint8Array
  name: string
  pieceLength: number
  pieces: Uint8Array[]
  files: TorrentFile[]
  length: number
  announce: string[]
}

export class TorrentParser {
  static parse(buffer: Uint8Array): ParsedTorrent {
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
    const infoHash = crypto.createHash('sha1').update(infoBuffer).digest()

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
    if (decoded['announce-list']) {
      for (const tier of decoded['announce-list']) {
        for (const url of tier) {
          announce.push(new TextDecoder().decode(url))
        }
      }
    } else if (decoded.announce) {
      announce.push(new TextDecoder().decode(decoded.announce))
    }

    return {
      infoHash,
      name,
      pieceLength,
      pieces,
      files,
      length: totalLength,
      announce,
    }
  }
}
