import { Bencode } from './bencode'

export interface ParsedMagnet {
  infoHash: string
  name?: string
  announce?: string[]
  urlList?: string[]
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

  const infoHash = xt.slice(9) // remove 'urn:btih:'
  const name = params.get('dn') || undefined
  const announce = params.getAll('tr')
  const urlList = params.getAll('ws') // web seeds

  return {
    infoHash,
    name,
    announce: announce.length > 0 ? announce : undefined,
    urlList: urlList.length > 0 ? urlList : undefined,
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
