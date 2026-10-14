import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_FILE_INDEX,
  MAX_FILE_NAME_LENGTH,
  MAX_PEER_HINTS,
  MAX_SELECTION_ENTRIES,
  MAX_SHARE_LENGTH,
  clipText,
  formatBytes,
  inspectMagnet,
  parseFileSelection,
  parsePeerHint,
  parseShareFragment,
} from './share-link.js'

const V1 = 'a88fda5954e89178c372716a6a78b8180ed4dad3'
const V2 = '1220' + 'cd'.repeat(32)

test('current format: magnet query string with a v1 hash', () => {
  const fragment = `#xt=urn:btih:${V1}&dn=The%20WIRED%20CD&tr=udp%3A%2F%2Ftracker.example%3A6969`
  assert.deepEqual(parseShareFragment(fragment), {
    ok: true,
    format: 'magnet-query',
    magnet: `magnet:?${fragment.slice(1)}`,
    name: 'The WIRED CD',
    infoHashes: [{ version: 1, value: V1 }],
    trackerCount: 1,
    totalSize: null,
    fileName: null,
    fileSize: null,
    selection: null,
    peerHints: null,
  })
})

test('current format: v2 and hybrid hashes', () => {
  const v2 = parseShareFragment(`xt=urn:btmh:${V2}&dn=v2+only`)
  assert.equal(v2.ok && v2.name, 'v2 only')
  assert.deepEqual(v2.ok && v2.infoHashes, [{ version: 2, value: V2 }])

  const hybrid = parseShareFragment(`xt=urn:btih:${V1.toUpperCase()}&xt=urn:btmh:${V2}`)
  assert.deepEqual(hybrid.ok && hybrid.infoHashes, [
    { version: 1, value: V1 },
    { version: 2, value: V2 },
  ])
})

test('current format: multiple raw trackers and extensions pass through verbatim', () => {
  const query =
    `xt=urn:btih:${V1}&tr=udp://tracker.example:6969/announce` +
    `&tr=http://tracker.example/announce?k=1&ws=https://seed.example/f&x.pe=10.0.0.1:6881`
  const result = parseShareFragment(`#${query}`)
  assert.equal(result.ok && result.magnet, `magnet:?${query}`)
  assert.equal(result.ok && result.trackerCount, 2)
  assert.equal(result.ok && result.name, null)
})

test('current format: xt need not come first when no legacy key is present', () => {
  const result = parseShareFragment(`dn=x&xt=urn:btih:${V1}`)
  assert.equal(result.ok && result.format, 'magnet-query')
  assert.equal(result.ok && result.magnet, `magnet:?dn=x&xt=urn:btih:${V1}`)
})

test('Chrome App link with hash, dn and magnet_uri prefers magnet_uri', () => {
  const magnet = `magnet:?xt=urn:btih:${V1}&dn=Big%20Buck&tr=udp%3A%2F%2Ft.example%3A1`
  const result = parseShareFragment(
    `#hash=${V1}&dn=Big%20Buck&magnet_uri=${encodeURIComponent(magnet)}`,
  )
  assert.equal(result.ok && result.format, 'legacy')
  assert.equal(result.ok && result.magnet, magnet)
  assert.equal(result.ok && result.trackerCount, 1)
})

test('Chrome App link with only hash and dn synthesizes a magnet', () => {
  const result = parseShareFragment(`#hash=${V1}&dn=A%20%26%20B`)
  assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}&dn=A%20%26%20B`)
  assert.equal(result.ok && result.name, 'A & B')

  const bare = parseShareFragment(`#hash=${V1}`)
  assert.equal(bare.ok && bare.magnet, `magnet:?xt=urn:btih:${V1}`)
  assert.equal(bare.ok && bare.name, null)
})

test('protocol-handler magnet_uri and TypeScript magnet links', () => {
  const magnet = `magnet:?xt=urn:btih:${V1}&dn=Handler`
  for (const key of ['magnet_uri', 'magnet']) {
    const result = parseShareFragment(`#${key}=${encodeURIComponent(magnet)}`)
    assert.equal(result.ok && result.format, 'legacy', key)
    assert.equal(result.ok && result.magnet, magnet, key)
    assert.equal(result.ok && result.name, 'Handler', key)
  }
})

test('unencoded legacy magnet keeps the rest of the fragment', () => {
  const result = parseShareFragment(`#magnet_uri=magnet:?xt=urn:btih:${V1}&tr=udp://t.example:1`)
  assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}&tr=udp://t.example:1`)
})

test('invalid magnet_uri falls back to a valid hash', () => {
  const result = parseShareFragment(`#hash=${V1}&magnet_uri=javascript%3Aalert(1)`)
  assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}`)
})

test('script and non-magnet URIs are rejected', () => {
  for (const fragment of [
    '#magnet_uri=javascript:alert(1)',
    '#magnet_uri=javascript%3Aalert(1)',
    '#magnet=javascript%3Amagnet%3A%3Fxt%3Durn%3Abtih%3A' + V1,
    '#magnet_uri=' + encodeURIComponent(`data:text/html,magnet:?xt=urn:btih:${V1}`),
    '#magnet_uri=' + encodeURIComponent(`magnet:?xt=urn:btih:${V1}\n<script>`),
  ]) {
    assert.equal(parseShareFragment(fragment).ok, false, fragment)
  }
})

test('garbage, empty and incomplete fragments are rejected', () => {
  for (const fragment of [
    undefined,
    '',
    '#',
    '#hello',
    '#dn=Only%20a%20name',
    '#xt=urn:btih:',
    '#xt=urn:btih:xyz',
    '#xt=urn:sha1:' + V1,
    '#xt=urn:btmh:1220abcd',
    '#hash=nothex&dn=x',
    '#magnet_uri=%E0%A4%A',
    '#' + 'a'.repeat(MAX_SHARE_LENGTH + 1),
  ]) {
    assert.equal(parseShareFragment(/** @type {string} */ (fragment)).ok, false, fragment)
  }
  assert.deepEqual(parseShareFragment(''), { ok: false, reason: 'empty' })
})

test('malformed escapes in a name do not reject a valid magnet', () => {
  const result = inspectMagnet(`magnet:?xt=urn:btih:${V1}&dn=50%25%zz`)
  assert.equal(result.ok && result.name, '50%25%zz')
})

test('base32 v1 hashes are accepted', () => {
  const result = parseShareFragment('xt=urn:btih:' + 'abcdefghijklmnopqrstuvwxyz234567')
  assert.deepEqual(result.ok && result.infoHashes, [
    { version: 1, value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' },
  ])
})

test('jst keys are display-only and stripped from the magnet', () => {
  const result = parseShareFragment(
    `#xt=urn:btih:${V1}&jst.file=Season%201%2FEpisode+01.mkv&dn=Show&jst.size=1610612736` +
      `&tr=udp%3A%2F%2Ft.example%3A1&jst.future=x`,
  )
  assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}&dn=Show&tr=udp%3A%2F%2Ft.example%3A1`)
  assert.equal(result.ok && result.fileName, 'Season 1/Episode 01.mkv')
  assert.equal(result.ok && result.fileSize, 1610612736)
  assert.equal(result.ok && result.name, 'Show')
  assert.equal(result.ok && result.trackerCount, 1)
})

test('jst prefix is case-sensitive and encoded keys are recognized', () => {
  const upper = parseShareFragment(`#xt=urn:btih:${V1}&JST.file=a&Jst.size=1`)
  assert.equal(upper.ok && upper.magnet, `magnet:?xt=urn:btih:${V1}&JST.file=a&Jst.size=1`)
  assert.equal(upper.ok && upper.fileName, null)

  const encoded = parseShareFragment(`#xt=urn:btih:${V1}&jst%2Efile=a.txt&&jst.size`)
  assert.equal(encoded.ok && encoded.magnet, `magnet:?xt=urn:btih:${V1}`)
  assert.equal(encoded.ok && encoded.fileName, 'a.txt')
  assert.equal(encoded.ok && encoded.fileSize, null)
})

test('jst keys alone do not make a link valid', () => {
  assert.equal(parseShareFragment('#jst.file=a&jst.size=1').ok, false)
  assert.equal(parseShareFragment(`#jst.file=a&xt=urn:btih:${V1}`).ok, true)
})

test('jst keys inside a legacy or pasted magnet are stripped too', () => {
  const magnet = `magnet:?xt=urn:btih:${V1}&jst.file=f.bin&dn=D`
  const legacy = parseShareFragment(`#magnet=${encodeURIComponent(magnet)}`)
  assert.equal(legacy.ok && legacy.magnet, `magnet:?xt=urn:btih:${V1}&dn=D`)
  assert.equal(legacy.ok && legacy.fileName, 'f.bin')
  const pasted = parseShareFragment(`#${magnet}`)
  assert.equal(pasted.ok && pasted.magnet, `magnet:?xt=urn:btih:${V1}&dn=D`)
})

test('garbage jst.file and jst.size values are ignored', () => {
  const base = `#xt=urn:btih:${V1}`
  for (const file of [
    '',
    '%20%20',
    '%E0%A4%A',
    'a%0Ab',
    'a%7Fb',
    'a%C2%85b',
    'evil%E2%80%AEtxt.exe',
    'x%E2%81%A6y',
    'a'.repeat(MAX_FILE_NAME_LENGTH + 1),
  ]) {
    const result = parseShareFragment(`${base}&jst.file=${file}`)
    assert.equal(result.ok, true, file)
    assert.equal(result.ok && result.fileName, null, file)
    assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}`, file)
  }
  const longest = parseShareFragment(`${base}&jst.file=${'a'.repeat(MAX_FILE_NAME_LENGTH)}`)
  assert.equal(longest.ok && longest.fileName?.length, MAX_FILE_NAME_LENGTH)
  const unicode = parseShareFragment(`${base}&jst.file=${encodeURIComponent('Ünïcødé 映画.mp4')}`)
  assert.equal(unicode.ok && unicode.fileName, 'Ünïcødé 映画.mp4')

  for (const size of ['-1', '1.5', '1e9', '+5', '0x10', '01', 'abc', '9007199254740992', '1'.repeat(30)]) {
    const result = parseShareFragment(`${base}&jst.size=${size}`)
    assert.equal(result.ok && result.fileSize, null, size)
  }
  const zero = parseShareFragment(`${base}&jst.size=0`)
  assert.equal(zero.ok && zero.fileSize, 0)
  const max = parseShareFragment(`${base}&jst.size=9007199254740991`)
  assert.equal(max.ok && max.fileSize, Number.MAX_SAFE_INTEGER)
})

test('the first jst.file wins', () => {
  const result = parseShareFragment(`#xt=urn:btih:${V1}&jst.file=one&jst.file=two`)
  assert.equal(result.ok && result.fileName, 'one')
})

test('xl is exposed as a validated total size and kept in the magnet', () => {
  const result = parseShareFragment(`#xt=urn:btih:${V1}&xl=734003200`)
  assert.equal(result.ok && result.totalSize, 734003200)
  assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}&xl=734003200`)
  for (const xl of ['-1', 'big', '1.0', '99999999999999999999']) {
    const bad = parseShareFragment(`#xt=urn:btih:${V1}&xl=${xl}`)
    assert.equal(bad.ok && bad.totalSize, null, xl)
    assert.equal(bad.ok && bad.magnet, `magnet:?xt=urn:btih:${V1}&xl=${xl}`, xl)
  }
})

test('so selections are counted, merged and described', () => {
  assert.deepEqual(parseFileSelection('0,2,4,6-8'), { count: 6, description: '0, 2, 4, 6–8' })
  assert.deepEqual(parseFileSelection('3'), { count: 1, description: '3' })
  assert.deepEqual(parseFileSelection('5-6'), { count: 2, description: '5, 6' })
  assert.deepEqual(parseFileSelection('8-9,1,0-3,2'), { count: 6, description: '0–3, 8, 9' })
  assert.deepEqual(parseFileSelection('1%2C3'), { count: 2, description: '1, 3' })
  assert.deepEqual(parseFileSelection('1,,3,'), { count: 2, description: '1, 3' })
  assert.deepEqual(parseFileSelection(`0-${MAX_FILE_INDEX}`), {
    count: MAX_FILE_INDEX + 1,
    description: `0–${MAX_FILE_INDEX}`,
  })
  const many = parseFileSelection(Array.from({ length: 20 }, (_, i) => i * 2).join(','))
  assert.equal(many?.count, 20)
  assert.equal(many?.description, '0, 2, 4, 6, 8, 10, 12, 14, …')
})

test('malformed or oversized so values are not described but stay in the magnet', () => {
  for (const so of [
    '',
    ',',
    'a',
    '1-',
    '-1',
    '3-1',
    '1-2-3',
    '1.5',
    '%ZZ',
    `${MAX_FILE_INDEX + 1}`,
    `0-${MAX_FILE_INDEX + 1}`,
    '123456',
    Array.from({ length: MAX_SELECTION_ENTRIES + 1 }, (_, i) => i).join(','),
    '1,'.repeat(2000),
  ]) {
    assert.equal(parseFileSelection(so), null, so.slice(0, 40))
    const result = parseShareFragment(`#xt=urn:btih:${V1}&so=${so}`)
    assert.equal(result.ok && result.selection, null, so.slice(0, 40))
    assert.equal(result.ok && result.magnet, `magnet:?xt=urn:btih:${V1}&so=${so}`, so.slice(0, 40))
  }
})

test('x.pe IPv4 and IPv6 hints are validated and classified', () => {
  assert.deepEqual(parsePeerHint('203.0.113.7:6881'), { address: '203.0.113.7:6881', scope: 'public' })
  assert.deepEqual(parsePeerHint('192.168.1.20%3A51413'), { address: '192.168.1.20:51413', scope: 'local' })
  for (const local of [
    '10.1.2.3:1',
    '172.16.0.1:1',
    '172.31.255.255:1',
    '127.0.0.1:1',
    '169.254.1.1:1',
    '100.64.0.1:1',
    '[::1]:1',
    '[fe80::1]:1',
    '[fd12:3456::1]:1',
    '[::ffff:192.168.0.1]:1',
  ]) {
    assert.equal(parsePeerHint(local)?.scope, 'local', local)
  }
  for (const pub of ['172.32.0.1:1', '8.8.8.8:65535', '[2001:db8::1]:6881', '[::ffff:8.8.8.8]:1']) {
    assert.equal(parsePeerHint(pub)?.scope, 'public', pub)
  }
  assert.deepEqual(parsePeerHint('[2001:DB8:0:0:0:0:0:1]:6881'), {
    address: '[2001:db8::1]:6881',
    scope: 'public',
  })
  for (const invalid of [
    '',
    'example.com:6881',
    '1.2.3.4',
    '1.2.3.4:0',
    '1.2.3.4:65536',
    '1.2.3.4:080',
    '256.1.1.1:1',
    '01.2.3.4:1',
    '1.2.3:1',
    '0.0.0.0:1',
    '224.0.0.1:1',
    '255.255.255.255:1',
    '::1:6881',
    '[::]:1',
    '[ff02::1]:1',
    '[fe80::1%25eth0]:1',
    '[1:2:3:4:5:6:7:8:9]:1',
    '[gggg::1]:1',
    '[1.2.3.4]:1',
    '%ZZ',
    '1.2.3.4:1<script>',
    '1'.repeat(300),
  ]) {
    assert.equal(parsePeerHint(invalid), null, invalid)
  }
})

test('x.pe entries are counted, deduplicated, bounded and left in the magnet', () => {
  const query =
    `xt=urn:btih:${V1}&x.pe=192.168.1.5:6881&x.pe=203.0.113.9:6881` +
    `&x.pe=192.168.1.5:6881&x.pe=bad&X.PE=[2001:db8::2]:7000`
  const result = parseShareFragment(`#${query}`)
  assert.equal(result.ok && result.magnet, `magnet:?${query}`)
  assert.deepEqual(result.ok && result.peerHints, {
    count: 3,
    hasLocal: true,
    hasPublic: true,
    entries: [
      { address: '192.168.1.5:6881', scope: 'local' },
      { address: '203.0.113.9:6881', scope: 'public' },
      { address: '[2001:db8::2]:7000', scope: 'public' },
    ],
  })

  const onlyInvalid = parseShareFragment(`#xt=urn:btih:${V1}&x.pe=host.example:1`)
  assert.equal(onlyInvalid.ok && onlyInvalid.peerHints, null)

  const flood = Array.from({ length: 500 }, (_, i) => `x.pe=10.0.${i >> 8}.${i & 255}:1`).join('&')
  const flooded = parseShareFragment(`#xt=urn:btih:${V1}&${flood}`)
  assert.equal(flooded.ok && flooded.peerHints?.count, MAX_PEER_HINTS)
})

test('a realistic rich share link', () => {
  const fragment =
    `#xt=urn:btih:${V1}&dn=Big+Buck+Bunny&xl=276445467` +
    `&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=wss%3A%2F%2Ftracker.webtorrent.dev` +
    `&so=2&x.pe=192.168.1.40:51413&x.pe=%5B2001%3Adb8%3A%3A40%5D%3A51413` +
    `&jst.file=Big+Buck+Bunny.mp4&jst.size=276134947`
  const result = parseShareFragment(fragment)
  assert.ok(result.ok)
  assert.equal(
    result.magnet,
    `magnet:?xt=urn:btih:${V1}&dn=Big+Buck+Bunny&xl=276445467` +
      `&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=wss%3A%2F%2Ftracker.webtorrent.dev` +
      `&so=2&x.pe=192.168.1.40:51413&x.pe=%5B2001%3Adb8%3A%3A40%5D%3A51413`,
  )
  assert.equal(result.format, 'magnet-query')
  assert.equal(result.name, 'Big Buck Bunny')
  assert.equal(result.fileName, 'Big Buck Bunny.mp4')
  assert.equal(result.fileSize, 276134947)
  assert.equal(result.totalSize, 276445467)
  assert.deepEqual(result.selection, { count: 1, description: '2' })
  assert.equal(result.trackerCount, 2)
  assert.equal(result.peerHints?.count, 2)
  assert.equal(result.peerHints?.hasLocal, true)
  assert.equal(result.peerHints?.hasPublic, true)
})

test('legacy formats carry no rich display values', () => {
  for (const fragment of [
    `#hash=${V1}&dn=Old`,
    `#magnet_uri=${encodeURIComponent(`magnet:?xt=urn:btih:${V1}&dn=Old`)}`,
    `#hash=${V1}&jst.file=ignored&jst.size=5`,
  ]) {
    const result = parseShareFragment(fragment)
    assert.equal(result.ok && result.format, 'legacy', fragment)
    assert.equal(result.ok && result.fileName, null, fragment)
    assert.equal(result.ok && result.fileSize, null, fragment)
    assert.equal(result.ok && result.totalSize, null, fragment)
    assert.equal(result.ok && result.selection, null, fragment)
    assert.equal(result.ok && result.peerHints, null, fragment)
    assert.ok(result.ok && !result.magnet.includes('jst.'), fragment)
  }
})

test('a maximum-length hostile fragment parses quickly', () => {
  const filler = '&so=' + '1,'.repeat(1000) + '&x.pe=' + 'x'.repeat(1000) + '&jst.file=' + '%41'.repeat(4000)
  let fragment = `#xt=urn:btih:${V1}`
  while (fragment.length + filler.length < MAX_SHARE_LENGTH) fragment += filler
  const started = performance.now()
  const result = parseShareFragment(fragment)
  assert.ok(performance.now() - started < 500)
  assert.equal(result.ok && result.selection, null)
  assert.equal(result.ok && result.peerHints, null)
  assert.equal(result.ok && result.fileName, null)
})

test('formatBytes uses 1024-based units and clipText keeps surrogate pairs whole', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(276134947), '263 MB')
  assert.equal(formatBytes(1610612736), '1.5 GB')
  assert.equal(formatBytes(Number.MAX_SAFE_INTEGER), '8.0 PB')

  assert.equal(clipText('short', 10), 'short')
  assert.equal(clipText('abcdefghij', 5), 'abcd…')
  assert.equal(clipText('abc😀def', 5), 'abc…')
})
