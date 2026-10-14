// Parses the fragment of a https://jstorrent.com/share/ link. The fragment is
// untrusted input. Callers may only use `magnet` as a link target after this
// module accepted it, and must render names and hashes as text.
//
// Accepted formats (see public/LEGACY-URLS.md):
// - current: `#xt=urn:btih:...&dn=...&tr=...`, the magnet's own query string;
// - Chrome App share links: `#hash=<hex>&dn=<name>&magnet_uri=<magnet>`,
//   where any key may be missing;
// - protocol-handler links: `#magnet_uri=<magnet>`;
// - TypeScript client links: `#magnet=<magnet>`.

/** Longest fragment or magnet this page inspects. */
export const MAX_SHARE_LENGTH = 64 * 1024

const MAGNET_PREFIX = 'magnet:?'
const LEGACY_KEYS = new Set(['hash', 'magnet_uri', 'magnet'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * @typedef {{ version: 1 | 2, value: string }} InfoHash
 * @typedef {{
 *   ok: true,
 *   format: 'magnet-query' | 'legacy',
 *   magnet: string,
 *   name: string | null,
 *   infoHashes: InfoHash[],
 *   trackerCount: number,
 * }} ShareLink
 * @typedef {{ ok: false, reason: 'empty' | 'too-long' | 'not-magnet' | 'missing-info-hash' }} InvalidShareLink
 */

/**
 * @param {string} value
 * @param {boolean} [plusIsSpace]
 * @returns {string | null}
 */
function safeDecode(value, plusIsSpace = false) {
  try {
    return decodeURIComponent(plusIsSpace ? value.replace(/\+/g, ' ') : value)
  } catch {
    return null
  }
}

/**
 * Splits `a=1&b=2` without decoding values. `offset` is where the raw value
 * starts in `query`.
 * @param {string} query
 */
function splitParams(query) {
  /** @type {{ key: string, raw: string, offset: number }[]} */
  const params = []
  let start = 0
  for (const part of query.split('&')) {
    if (part) {
      const equals = part.indexOf('=')
      const rawKey = equals < 0 ? part : part.slice(0, equals)
      const key = (safeDecode(rawKey) ?? rawKey).trim().toLowerCase()
      params.push({
        key,
        raw: equals < 0 ? '' : part.slice(equals + 1),
        offset: start + (equals < 0 ? part.length : equals + 1),
      })
    }
    start += part.length + 1
  }
  return params
}

/**
 * @param {string} kind
 * @param {string} hash
 * @returns {InfoHash | null}
 */
function infoHash(kind, hash) {
  if (kind === 'btih') {
    if (/^[0-9a-f]{40}$/i.test(hash)) return { version: 1, value: hash.toLowerCase() }
    if (/^[a-z2-7]{32}$/i.test(hash)) return { version: 1, value: hash.toUpperCase() }
    return null
  }
  // BEP 52 info hashes are SHA-256 multihashes: 0x12, length 0x20, digest.
  if (/^1220[0-9a-f]{64}$/i.test(hash)) return { version: 2, value: hash.toLowerCase() }
  return null
}

/**
 * Validates a complete magnet URI and extracts what the page displays.
 * @param {string} magnet
 * @returns {Omit<ShareLink, 'format'> | InvalidShareLink}
 */
export function inspectMagnet(magnet) {
  if (typeof magnet !== 'string' || magnet.length === 0) return { ok: false, reason: 'empty' }
  if (magnet.length > MAX_SHARE_LENGTH) return { ok: false, reason: 'too-long' }
  if (
    magnet.slice(0, MAGNET_PREFIX.length).toLowerCase() !== MAGNET_PREFIX ||
    CONTROL_CHARACTERS.test(magnet)
  ) {
    return { ok: false, reason: 'not-magnet' }
  }
  const query = magnet.slice(MAGNET_PREFIX.length)
  /** @type {InfoHash[]} */
  const infoHashes = []
  /** @type {string | null} */
  let name = null
  let trackerCount = 0
  for (const { key, raw } of splitParams(query)) {
    if (/^xt(\.\d+)?$/.test(key)) {
      const match = /^urn:(btih|btmh):(.*)$/i.exec(safeDecode(raw) ?? '')
      const hash = match && infoHash(match[1].toLowerCase(), match[2].trim())
      if (hash && !infoHashes.some((known) => known.value === hash.value)) infoHashes.push(hash)
    } else if (key === 'dn' && name === null) {
      const decoded = (safeDecode(raw, true) ?? raw).trim()
      if (decoded) name = decoded
    } else if (/^tr(\.\d+)?$/.test(key) && raw) {
      trackerCount++
    }
  }
  if (infoHashes.length === 0) return { ok: false, reason: 'missing-info-hash' }
  return { ok: true, magnet: MAGNET_PREFIX + query, name, infoHashes, trackerCount }
}

/**
 * @param {Omit<ShareLink, 'format'> | InvalidShareLink} result
 * @param {ShareLink['format']} format
 * @returns {ShareLink | InvalidShareLink}
 */
function withFormat(result, format) {
  return result.ok ? { ...result, format } : result
}

/**
 * @param {string} fragment
 * @param {{ key: string, raw: string, offset: number }[]} params
 * @returns {Omit<ShareLink, 'format'> | InvalidShareLink}
 */
function parseLegacy(fragment, params) {
  /** @type {Omit<ShareLink, 'format'> | InvalidShareLink} */
  let result = { ok: false, reason: 'missing-info-hash' }
  for (const key of ['magnet_uri', 'magnet']) {
    const param = params.find((candidate) => candidate.key === key)
    if (!param) continue
    // Encoded values are the documented form. A raw magnet cannot be split
    // on `&`, so it takes the rest of the fragment.
    const magnet = /^magnet:\?/i.test(param.raw)
      ? fragment.slice(param.offset)
      : safeDecode(param.raw)
    result = inspectMagnet(magnet ?? '')
    if (result.ok) return result
  }
  const hashParam = params.find((candidate) => candidate.key === 'hash')
  const hash = hashParam && safeDecode(hashParam.raw)?.trim()
  if (hash && infoHash('btih', hash)) {
    const dnParam = params.find((candidate) => candidate.key === 'dn')
    const dn = dnParam && (safeDecode(dnParam.raw) ?? '').trim()
    return inspectMagnet(
      `${MAGNET_PREFIX}xt=urn:btih:${hash}${dn ? `&dn=${encodeURIComponent(dn)}` : ''}`,
    )
  }
  return result
}

/**
 * Parses `location.hash` (with or without the leading `#`).
 * @param {string} fragment
 * @returns {ShareLink | InvalidShareLink}
 */
export function parseShareFragment(fragment) {
  let value = typeof fragment === 'string' ? fragment : ''
  if (value.startsWith('#')) value = value.slice(1)
  if (!value) return { ok: false, reason: 'empty' }
  if (value.length > MAX_SHARE_LENGTH) return { ok: false, reason: 'too-long' }
  // A complete magnet pasted after the `#`.
  if (/^magnet:\?/i.test(value)) return withFormat(inspectMagnet(value), 'magnet-query')

  const params = splitParams(value)
  const legacy = params.some(({ key }) => LEGACY_KEYS.has(key))
  const hasXt = params.some(({ key }) => /^xt(\.\d+)?$/.test(key))
  if (params[0]?.key === 'xt' || (hasXt && !legacy)) {
    return withFormat(inspectMagnet(MAGNET_PREFIX + value), 'magnet-query')
  }
  if (legacy) return withFormat(parseLegacy(value, params), 'legacy')
  return { ok: false, reason: 'missing-info-hash' }
}
