import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectProductionWebsiteRelease } from '../website/src/lib/production-release.ts'

function qualifiedFixture() {
  const version = '0.3.0'
  const payloads = [
    `JSTorrent_${version}_x64-setup.exe`,
    `JSTorrent_${version}_x64_en-US.msi`,
    `JSTorrent_${version}_amd64.AppImage`,
    `JSTorrent_${version}_aarch64.AppImage`,
    'JSTorrent_aarch64.app.tar.gz',
    'JSTorrent_x64.app.tar.gz',
  ]
  const names = [
    ...payloads,
    ...payloads.map((n) => n + '.sig'),
    `JSTorrent_${version}_aarch64.dmg`,
    `JSTorrent_${version}_x64.dmg`,
    'latest.json',
  ]
  return {
    schema: 1,
    enabled: true,
    release: {
      version,
      tag: 'desktop-v0.3.0',
      repository: 'kzahel/rstorrent',
      sourceSha: 'a'.repeat(40),
      updaterPublicKeyId: '415D3DF4B3D0CFB8',
      qualified: true,
      sourceMaterials: {
        name: `JSTorrent_${version}_AppImage-sources-final.tar.gz`,
        bytes: 847197977,
        sha256: 'c'.repeat(64),
      },
      assets: names.map((name) => ({ name, bytes: 1234, sha256: 'b'.repeat(64) })),
    },
  }
}

test('committed descriptor selects the qualified public replacement and its sources', () => {
  const descriptor = JSON.parse(
    readFileSync(new URL('../website/src/data/production-release.json', import.meta.url)),
  )
  assert.equal(descriptor.enabled, true)
  assert.equal(descriptor.release.assets.length, 15)
  const selected = selectProductionWebsiteRelease(descriptor)
  assert.equal(selected.tag, `v${descriptor.release.version}`)
  assert.equal(selected.linuxSourceUrl,
    `https://github.com/${descriptor.release.repository}/releases/download/${descriptor.release.tag}/${descriptor.release.sourceMaterials.name}`)

})

test('an enabled qualified matrix binds all platform URLs to its immutable release', () => {
  const links = selectProductionWebsiteRelease(qualifiedFixture())
  assert.equal(links.tag, 'v0.3.0')
  const expectedSuffixes = {
    windowsUrl: 'JSTorrent_0.3.0_x64-setup.exe',
    macosPrimaryArmUrl: 'JSTorrent_0.3.0_aarch64.dmg',
    macosPrimaryIntelUrl: 'JSTorrent_0.3.0_x64.dmg',
    macosArmUrl: 'JSTorrent_0.3.0_aarch64.dmg',
    macosIntelUrl: 'JSTorrent_0.3.0_x64.dmg',
    linuxAppImageUrl: 'JSTorrent_0.3.0_amd64.AppImage',
    linuxArm64AppImageUrl: 'JSTorrent_0.3.0_aarch64.AppImage',
    linuxSourceUrl: 'JSTorrent_0.3.0_AppImage-sources-final.tar.gz',
  }
  for (const [field, name] of Object.entries(expectedSuffixes)) {
    assert.equal(
      links[field],
      'https://github.com/kzahel/rstorrent/releases/download/desktop-v0.3.0/' + name,
    )
  }
  assert.equal(qualifiedFixture().release.assets.length, 15)
  assert.equal(links.linuxDebUrl, undefined)
  assert.equal(links.linuxArm64DebUrl, undefined)
})

for (const name of ['JSTorrent_0.3.0_amd64.deb', 'JSTorrent-0.3.0-1.aarch64.rpm']) {
  test(`production inventory refuses excluded ${name}`, () => {
    const data = qualifiedFixture()
    data.release.assets[2].name = name
    assert.throws(() => selectProductionWebsiteRelease(data), /Invalid production asset name/)
  })
}

test('prepared qualified metadata remains inactive until enabled', () => {
  const data = qualifiedFixture()
  data.enabled = false
  assert.equal(selectProductionWebsiteRelease(data), null)
})

for (const [name, mutate] of [
  [
    'empty enabled inventory',
    (data) => {
      data.release = null
    },
  ],
  [
    'unsupported schema',
    (data) => {
      data.schema = 2
    },
  ],
  [
    'string enabled flag',
    (data) => {
      data.enabled = 'true'
    },
  ],
  [
    'unknown configuration fields',
    (data) => {
      data.url = 'https://example.invalid'
    },
  ],
  [
    'qualification absent',
    (data) => {
      data.release.qualified = false
    },
  ],
  [
    'incubation updater root',
    (data) => {
      data.release.updaterPublicKeyId = '788A785131367096'
    },
  ],
  [
    'source SHA absent',
    (data) => {
      data.release.sourceSha = ''
    },
  ],
  [
    'alternate repository',
    (data) => {
      data.release.repository = 'attacker/repository'
    },
  ],
  [
    'prerelease tag',
    (data) => {
      data.release.tag = 'desktop-latest-v0.3.0'
    },
  ],
  [
    'version mismatch',
    (data) => {
      data.release.version = '0.3.1'
    },
  ],
  [
    'noncanonical version',
    (data) => {
      data.release.version = '00.3.0'
      data.release.tag = 'desktop-v00.3.0'
    },
  ],
  [
    'old version',
    (data) => {
      data.release.version = '0.2.1'
      data.release.tag = 'desktop-v0.2.1'
    },
  ],
  [
    'missing architecture',
    (data) => {
      data.release.assets.pop()
    },
  ],
  [
    'duplicate asset',
    (data) => {
      data.release.assets[1] = data.release.assets[0]
    },
  ],
  [
    'preview product',
    (data) => {
      data.release.assets[0].name = 'JSTorrent Preview_0.3.0_x64-setup.exe'
    },
  ],
  [
    'injected asset URL',
    (data) => {
      data.release.assets[0].url = 'https://example.invalid'
    },
  ],
  [
    'invalid hash',
    (data) => {
      data.release.assets[0].sha256 = 'not-a-hash'
    },
  ],
  [
    'zero bytes',
    (data) => {
      data.release.assets[0].bytes = 0
    },
  ],
  [
    'oversized asset',
    (data) => {
      data.release.assets[0].bytes = 512 * 1024 * 1024 + 1
    },
  ],
]) {
  test('refuses ' + name, () => {
    const data = qualifiedFixture()
    mutate(data)
    assert.throws(() => selectProductionWebsiteRelease(data))
  })
}

for (const [name, mutate] of [
  [
    'missing source material',
    (data) => {
      delete data.release.sourceMaterials
    },
  ],
  [
    'wrong source version',
    (data) => {
      data.release.sourceMaterials.name = 'JSTorrent_0.2.1_AppImage-sources-final.tar.gz'
    },
  ],
  [
    'unbounded source archive',
    (data) => {
      data.release.sourceMaterials.bytes = 2 * 1024 * 1024 * 1024 + 1
    },
  ],
  [
    'fractional source size',
    (data) => {
      data.release.sourceMaterials.bytes = 1.5
    },
  ],
  [
    'missing source hash',
    (data) => {
      data.release.sourceMaterials.sha256 = ''
    },
  ],
  [
    'extra source fields',
    (data) => {
      data.release.sourceMaterials.url = 'https://example.invalid'
    },
  ],
]) {
  test(`production inventory refuses ${name}`, () => {
    const data = qualifiedFixture()
    mutate(data)
    assert.throws(() => selectProductionWebsiteRelease(data))
  })
}
