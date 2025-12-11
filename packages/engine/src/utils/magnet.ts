import { Bencode } from './bencode'
import { parseAddressKey, PeerAddress } from '../core/swarm'

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

export function generateMagnet(options: GenerateMagnetOptions): string {
  const { infoHash, name, announce } = options
  const params = new URLSearchParams()
  params.set('xt', `urn:btih:${infoHash}`)
  if (name) {
    params.set('dn', name)
  }
  if (announce) {
    for (const tracker of announce) {
      params.append('tr', tracker)
    }
  }
  return `magnet:?${params.toString()}`
}

/**
 * Parse peer hint address string (x.pe parameter).
 * Supports: "ip:port" for IPv4, "[ip]:port" for IPv6
 * Returns null for invalid addresses (silent failure for magnet parsing).
 */
function parsePeerHint(address: string): PeerAddress | null {
  try {
    const parsed = parseAddressKey(address)
    if (parsed.port < 1 || parsed.port > 65535) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function parseMagnet(uri: string): ParsedMagnet {
  if (!uri.startsWith('magnet:')) {
    throw new Error('Invalid magnet URI')
  }

  const url = new URL(uri)
  const params = url.searchParams

  const xt = params.get('xt')
  if (!xt || !xt.startsWith('urn:btih:')) {
    throw new Error('Invalid magnet URI: missing xt (urn:btih)')
  }

  const infoHash = xt.slice(9).toLowerCase() // remove 'urn:btih:' and normalize case
  const name = params.get('dn') || undefined
  const announce = params.getAll('tr')
  const urlList = params.getAll('ws') // web seeds

  // Parse peer hints (x.pe parameter)
  const peerHints = params.getAll('x.pe')
  const peers: PeerAddress[] = []
  for (const hint of peerHints) {
    const peer = parsePeerHint(hint)
    if (peer) {
      peers.push(peer)
    }
  }

  return {
    infoHash,
    name,
    announce: announce.length > 0 ? announce : undefined,
    urlList: urlList.length > 0 ? urlList : undefined,
    peers: peers.length > 0 ? peers : undefined,
  }
}

/**
 * Create a torrent file buffer from raw metadata (info dict) and trackers.
 * This allows re-adding a torrent with its metadata preserved.
 */
export function createTorrentBuffer(options: {
  metadataRaw: Uint8Array
  announce?: string[]
}): Uint8Array {
  const { metadataRaw, announce } = options

  // Decode the raw info dict
  const infoDict = Bencode.decode(metadataRaw)

  // Build the torrent file structure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const torrentData: Record<string, any> = {
    info: infoDict,
  }

  if (announce && announce.length > 0) {
    torrentData.announce = announce[0]
    // announce-list is a list of tiers, each tier is a list of trackers
    torrentData['announce-list'] = announce.map((t) => [t])
  }

  return Bencode.encode(torrentData)
}
