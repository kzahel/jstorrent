import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseLegacyLaunch, unregisterLegacyHandlers } from './legacy-launch.js'
const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=space+%E2%98%83&tr=https%3A%2F%2Fexample.invalid%2Fa%3Fx%3D1%26y%3D2'

test('historical envelopes preserve the inner magnet encoding and use native escape', () => {
  for (const [search, hash] of [
    ['', '#magnet_uri=' + encodeURIComponent(magnet)],
    ['', '#magnet=' + encodeURIComponent(magnet)],
    ['?magnet=' + encodeURIComponent(magnet) + '&token=obsolete&desktop=true', ''],
    ['?magnet_uri=' + encodeURIComponent(magnet), ''],
    ['', '#xt=urn:btih:' + 'a'.repeat(40)],
    ['', '#hash=' + 'a'.repeat(40)],
  ]) {
    const result = parseLegacyLaunch(search, hash)
    assert.ok(result.magnet)
    assert.equal(new URL(result.launchUrl).searchParams.get('magnet'), result.magnet)
    assert.ok(result.launchUrl.startsWith('jstorrent://launch?magnet='))
    if (hash.includes('magnet=') || hash.includes('magnet_uri=') || search.includes('magnet')) assert.equal(result.magnet, magnet)
    assert.ok(!result.launchUrl.includes('token'))
  }
})
test('untrusted, ambiguous and oversized inputs never acquire local path authority', () => {
  for (const [search, hash] of [
    ['?torrentPath=C%3A%5Csecret.torrent&token=old', ''],
    ['?magnet=file%3A%2F%2F%2Fsecret.torrent', ''],
    ['', '#magnet=javascript%3Aalert(1)'], ['', '#magnet=%FF'], ['', '#magnet=%ZZ'],
    ['', '#magnet=' + encodeURIComponent(encodeURIComponent(magnet))],
    ['?magnet=' + encodeURIComponent(magnet) + '&magnet=x', ''],
    ['', '#magnet=' + encodeURIComponent(magnet) + '&magnet_uri=x'],
    ['', '#MAGNET=' + encodeURIComponent(magnet) + '&magnet=x'],
    ['', '#hash=' + 'a'.repeat(40) + '&hash=' + 'b'.repeat(40)],
    ['?magnet=' + encodeURIComponent(magnet), '#hash=' + 'a'.repeat(40)],
    ['', '#magnet=' + encodeURIComponent(magnet + '&dn=' + 'x'.repeat(16384))],
    ['', '#' + 'x'.repeat(65536)],
  ]) {
    assert.deepEqual(parseLegacyLaunch(search, hash), { magnet: null, launchUrl: 'jstorrent://launch' })
  }
})
test('cleanup requests exactly the two known same-origin templates without gating launch', () => {
  const calls = []
  const browser = { unregisterProtocolHandler(...args) { calls.push(args) } }
  unregisterLegacyHandlers(browser, 'https://jstorrent.com')
  assert.deepEqual(calls, [
    ['magnet', 'https://jstorrent.com/add/#magnet_uri=%s'],
    ['magnet', 'https://jstorrent.com/share/#magnet_uri=%s'],
  ])
  assert.match(unregisterLegacyHandlers({}, 'https://jstorrent.com'), /settings/)
  assert.match(unregisterLegacyHandlers({ unregisterProtocolHandler() { throw Error() } }, 'https://jstorrent.com'), /settings/)
})
test('retained website source has no unsupported registration or native detection', async () => {
  for (const path of ['../components/LegacyLaunch.astro', '../components/Downloads.tsx', './legacy-launch.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /launch-ping|sendMessage|\bregisterProtocolHandler\(/)
  }
  for (const name of ['add/index.js', 'magnet/index.js', 'magnet/setup.js', 'magnet/testmagnet.js', 'js/index.js', 'jstorrent.install.js']) {
    await assert.rejects(readFile(new URL('../../public/' + name, import.meta.url)), { code: 'ENOENT' })
  }
})
