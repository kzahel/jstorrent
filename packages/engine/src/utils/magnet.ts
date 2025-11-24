export interface ParsedMagnet {
  infoHash: string
  name?: string
  announce?: string[]
  urlList?: string[]
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
