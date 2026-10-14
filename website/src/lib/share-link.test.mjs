import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_SHARE_LENGTH, inspectMagnet, parseShareFragment } from './share-link.js'

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
