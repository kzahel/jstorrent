// Parses the fragment of a https://jstorrent.com/share/ link. The fragment is
// untrusted input. Callers may only use `magnet` as a link target after this
// module accepted it, and must render names and hashes as text.
//
// Accepted formats (see public/LEGACY-URLS.md):
// - current: `#xt=urn:btih:...&dn=...&tr=...`, the magnet's own query string,
//   optionally with display-only `jst.*` keys (Tactical 357);
// - Chrome App share links: `#hash=<hex>&dn=<name>&magnet_uri=<magnet>`,
//   where any key may be missing;
// - protocol-handler links: `#magnet_uri=<magnet>`;
// - TypeScript client links: `#magnet=<magnet>`.
//
// Names and sizes in a link (`dn`, `xl`, `jst.file`, `jst.size`) are the
// sharer's claims. The page labels them as coming from the link; nothing here
// verifies them.

/** Longest fragment or magnet this page inspects. */
export const MAX_SHARE_LENGTH = 64 * 1024
/** Longest decoded `jst.file` the page displays. */
export const MAX_FILE_NAME_LENGTH = 1024
/** Longest raw `so` value the page describes. */
export const MAX_SELECTION_LENGTH = 2048
/** Most comma-separated `so` entries the page describes. */
export const MAX_SELECTION_ENTRIES = 256
/** Highest `so` file index, matching libtorrent's magnet parser bound. */
export const MAX_FILE_INDEX = 10000
/** Most distinct valid `x.pe` addresses the page describes. */
export const MAX_PEER_HINTS = 8

const MAGNET_PREFIX = 'magnet:?'
const DISPLAY_PREFIX = 'jst.'
const LEGACY_KEYS = new Set(['hash', 'magnet_uri', 'magnet'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
// Control characters plus bidirectional formatting characters, which can make
// a file name read differently from what it is (for example `txt.exe`).
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/
const MAX_PEER_HINT_LENGTH = 64
const MAX_PEER_HINT_ATTEMPTS = 32
const MAX_DESCRIBED_RANGES = 8

/**
 * @typedef {{ version: 1 | 2, value: string }} InfoHash
 * @typedef {{ count: number, description: string }} FileSelection
 * @typedef {{ address: string, scope: 'local' | 'public' }} PeerHint
 * @typedef {{ count: number, hasLocal: boolean, hasPublic: boolean, entries: PeerHint[] }} PeerHints
 * @typedef {{
 *   ok: true,
 *   format: 'magnet-query' | 'legacy',
 *   magnet: string,
 *   name: string | null,
 *   infoHashes: InfoHash[],
 *   trackerCount: number,
 *   totalSize: number | null,
 *   fileName: string | null,
 *   fileSize: number | null,
 *   selection: FileSelection | null,
 *   peerHints: PeerHints | null,
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
 * The decoded, trimmed key of one `key=value` part, with its case preserved.
 * @param {string} part
 */
function partName(part) {
  const equals = part.indexOf('=')
  const rawKey = equals < 0 ? part : part.slice(0, equals)
  return (safeDecode(rawKey) ?? rawKey).trim()
}

/**
 * Splits `a=1&b=2` without decoding values. `name` keeps the key's case and
 * `key` is lower case. `offset` is where the raw value starts in `query`.
 * @param {string} query
 */
function splitParams(query) {
  /** @type {{ key: string, name: string, raw: string, offset: number }[]} */
  const params = []
  let start = 0
  for (const part of query.split('&')) {
    if (part) {
      const equals = part.indexOf('=')
      const name = partName(part)
      params.push({
        key: name.toLowerCase(),
        name,
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
 * A non-negative byte count without sign, exponent, fraction or leading zeros.
 * @param {string} raw
 * @returns {number | null}
 */
export function parseByteCount(raw) {
  const value = safeDecode(raw)?.trim() ?? ''
  if (!/^(0|[1-9]\d{0,15})$/.test(value)) return null
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) ? bytes : null
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function parseFileName(raw) {
  // Bound before decoding: each character is at most 12 escaped bytes.
  if (raw.length > MAX_FILE_NAME_LENGTH * 12) return null
  const name = (safeDecode(raw, true) ?? '').trim()
  if (!name || name.length > MAX_FILE_NAME_LENGTH || UNSAFE_NAME_CHARACTERS.test(name)) return null
  return name
}

/**
 * Parses a BEP 53 `so` value such as `0,2,4-6`. Returns null for anything
 * malformed or out of bounds; the parameter still stays in the magnet.
 * @param {string} raw
 * @returns {FileSelection | null}
 */
export function parseFileSelection(raw) {
  if (!raw || raw.length > MAX_SELECTION_LENGTH) return null
  const value = safeDecode(raw)
  if (!value) return null
  const tokens = value.split(',')
  if (tokens.length > MAX_SELECTION_ENTRIES) return null
  /** @type {[number, number][]} */
  const ranges = []
  for (const token of tokens) {
    const trimmed = token.trim()
    // libtorrent skips empty entries, so `1,,2` and a trailing comma are fine.
    if (!trimmed) continue
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(trimmed)
    if (!match) return null
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (end < start || end > MAX_FILE_INDEX) return null
    ranges.push([start, end])
  }
  if (ranges.length === 0) return null
  ranges.sort((a, b) => a[0] - b[0])
  /** @type {[number, number][]} */
  const merged = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  const count = merged.reduce((total, [start, end]) => total + end - start + 1, 0)
  const described = merged
    .slice(0, MAX_DESCRIBED_RANGES)
    .map(([start, end]) =>
      start === end ? `${start}` : end === start + 1 ? `${start}, ${end}` : `${start}–${end}`,
    )
  if (merged.length > MAX_DESCRIBED_RANGES) described.push('…')
  return { count, description: described.join(', ') }
}

/**
 * @param {number[]} octets
 * @returns {PeerHint['scope'] | null}
 */
function ipv4Scope([a, b]) {
  // Unspecified, multicast, reserved and broadcast addresses are not peers.
  if (a === 0 || a >= 224) return null
  if (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  ) {
    return 'local'
  }
  return 'public'
}

/**
 * Expands a WHATWG-serialized IPv6 address (hex groups, at most one `::`).
 * @param {string} address
 * @returns {number[] | null}
 */
function ipv6Groups(address) {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const parse = (/** @type {string} */ half) => (half ? half.split(':').map((g) => parseInt(g, 16)) : [])
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array(missing).fill(0), ...tail]
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/**
 * @param {number[]} g
 * @returns {PeerHint['scope'] | null}
 */
function ipv6Scope(g) {
  const zeroPrefix = (/** @type {number} */ n) => g.slice(0, n).every((group) => group === 0)
  if (zeroPrefix(8)) return null
  if (zeroPrefix(7) && g[7] === 1) return 'local'
  if (zeroPrefix(5) && g[5] === 0xffff) {
    return ipv4Scope([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  if ((g[0] & 0xff00) === 0xff00) return null
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xfe00) === 0xfc00) return 'local'
  return 'public'
}

/**
 * Parses one BEP 9 `x.pe` value: `a.b.c.d:port` or `[ipv6]:port`. Host
 * names and unusable addresses return null but stay in the magnet.
 * @param {string} raw
 * @returns {PeerHint | null}
 */
export function parsePeerHint(raw) {
  if (!raw || raw.length > MAX_PEER_HINT_LENGTH * 3) return null
  const value = safeDecode(raw)?.trim() ?? ''
  if (value.length > MAX_PEER_HINT_LENGTH) return null
  /** @type {string} */
  let host
  /** @type {PeerHint['scope'] | null} */
  let scope
  /** @type {string} */
  let port
  const v6 = /^\[([0-9a-f:.]{2,45})\]:(\d{1,5})$/i.exec(value)
  if (v6) {
    let normalized
    try {
      normalized = new URL(`http://[${v6[1]}]/`).hostname.slice(1, -1)
    } catch {
      return null
    }
    const groups = ipv6Groups(normalized)
    if (!groups) return null
    host = `[${normalized}]`
    scope = ipv6Scope(groups)
    port = v6[2]
  } else {
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(value)
    if (!v4) return null
    const parts = v4.slice(1, 5)
    // Leading zeros read as octal in some parsers; refuse the ambiguity.
    if (parts.some((part) => part.length > 1 && part.startsWith('0'))) return null
    const octets = parts.map(Number)
    if (octets.some((octet) => octet > 255)) return null
    host = octets.join('.')
    scope = ipv4Scope(octets)
    port = v4[5]
  }
  const portNumber = Number(port)
  if (!scope || portNumber < 1 || portNumber > 65535 || (port.length > 1 && port.startsWith('0'))) {
    return null
  }
  return { address: `${host}:${portNumber}`, scope }
}

/**
 * Validates a complete magnet URI, removes display-only `jst.*` keys and
 * extracts what the page displays.
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
  const fullQuery = magnet.slice(MAGNET_PREFIX.length)

  // `jst.` is case-sensitive; every such key is display-only and never part
  // of the rebuilt magnet. The first occurrence of each key is used.
  const parts = fullQuery.split('&')
  const kept = parts.filter((part) => !partName(part).startsWith(DISPLAY_PREFIX))
  const query = kept.length === parts.length ? fullQuery : kept.filter(Boolean).join('&')
  /** @type {string | null} */
  let fileName = null
  /** @type {number | null} */
  let fileSize = null
  if (kept.length !== parts.length) {
    const display = splitParams(fullQuery).filter(({ name }) => name.startsWith(DISPLAY_PREFIX))
    const fileParam = display.find(({ name }) => name === 'jst.file')
    const sizeParam = display.find(({ name }) => name === 'jst.size')
    if (fileParam) fileName = parseFileName(fileParam.raw)
    if (sizeParam) fileSize = parseByteCount(sizeParam.raw)
  }

  /** @type {InfoHash[]} */
  const infoHashes = []
  /** @type {string | null} */
  let name = null
  let trackerCount = 0
  /** @type {number | null} */
  let totalSize = null
  let sawSize = false
  /** @type {FileSelection | null} */
  let selection = null
  let sawSelection = false
  /** @type {PeerHint[]} */
  const peerEntries = []
  let peerAttempts = 0
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
    } else if (key === 'xl' && !sawSize) {
      sawSize = true
      totalSize = parseByteCount(raw)
    } else if (key === 'so' && !sawSelection) {
      sawSelection = true
      selection = parseFileSelection(raw)
    } else if (
      key === 'x.pe' &&
      peerEntries.length < MAX_PEER_HINTS &&
      peerAttempts < MAX_PEER_HINT_ATTEMPTS
    ) {
      peerAttempts++
      const hint = parsePeerHint(raw)
      if (hint && !peerEntries.some((known) => known.address === hint.address)) peerEntries.push(hint)
    }
  }
  if (infoHashes.length === 0) return { ok: false, reason: 'missing-info-hash' }
  const peerHints =
    peerEntries.length === 0
      ? null
      : {
          count: peerEntries.length,
          hasLocal: peerEntries.some((hint) => hint.scope === 'local'),
          hasPublic: peerEntries.some((hint) => hint.scope === 'public'),
          entries: peerEntries,
        }
  return {
    ok: true,
    magnet: MAGNET_PREFIX + query,
    name,
    infoHashes,
    trackerCount,
    totalSize,
    fileName,
    fileSize,
    selection,
    peerHints,
  }
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

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * Formats bytes with 1024-based units, like the product's binary data units.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const scaled = bytes / 1024 ** exponent
  return `${scaled >= 100 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${BYTE_UNITS[exponent]}`
}

/**
 * Shortens text for a heading or title without splitting a surrogate pair.
 * @param {string} text
 * @param {number} max
 */
export function clipText(text, max) {
  if (text.length <= max) return text
  let end = max - 1
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end--
  return `${text.slice(0, end)}…`
}
