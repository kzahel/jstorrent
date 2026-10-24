/** Curated release metadata; byte/signature verification is a separate gate. */
export const PRODUCTION_REPOSITORY = 'kzahel/jstorrent'
// Former name remains vacant on GitHub; signed historical metadata is immutable.
export const PRODUCTION_REPOSITORY_ALIASES = [PRODUCTION_REPOSITORY, 'kzahel/rstorrent'] as const
export function isProductionRepository(value: unknown): value is string {
  return PRODUCTION_REPOSITORY_ALIASES.some((repository) => repository === value)
}
export interface DesktopDownloadLinks {
  tag: string
  windowsUrl: string
  macosPrimaryArmUrl: string
  macosPrimaryIntelUrl: string
  macosArmUrl: string
  macosIntelUrl: string
  linuxDebUrl?: string
  linuxAppImageUrl: string
  linuxArm64DebUrl?: string
  linuxArm64AppImageUrl: string
  linuxSourceUrl?: string
}

function record(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  const result = value as Record<string, unknown>
  if (Object.keys(result).sort().join(',') !== fields.sort().join(',')) {
    throw new Error(`Unexpected ${label} fields`)
  }
  return result
}

export function selectProductionWebsiteRelease(value: unknown): DesktopDownloadLinks | null {
  const descriptor = record(value, ['schema', 'enabled', 'release'], 'descriptor')
  if (descriptor.schema !== 1 || typeof descriptor.enabled !== 'boolean') {
    throw new Error('Invalid production descriptor state')
  }
  if (descriptor.release === null) {
    if (descriptor.enabled) throw new Error('Enabled release has no qualified inventory')
    return null
  }
  const release = record(
    descriptor.release,
    [
      'version',
      'tag',
      'repository',
      'sourceSha',
      'updaterPublicKeyId',
      'qualified',
      'assets',
      'sourceMaterials',
    ],
    'release',
  )
  if (
    release.qualified !== true ||
    !isProductionRepository(release.repository) ||
    release.updaterPublicKeyId !== '415D3DF4B3D0CFB8' ||
    typeof release.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(release.sourceSha) ||
    typeof release.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.version) ||
    release.tag !== `desktop-v${release.version}`
  ) {
    throw new Error('Unqualified production source, version, tag or trust root')
  }
  const version = release.version
  const parts = version.split('.').map(Number)
  if (
    parts.some((part) => part > 65535) ||
    (parts[0] === 0 && (parts[1] < 2 || (parts[1] === 2 && parts[2] <= 1)))
  ) {
    throw new Error('Production version must exceed the legacy baseline')
  }
  const payloads = [
    `JSTorrent_${version}_x64-setup.exe`,
    `JSTorrent_${version}_x64_en-US.msi`,
    `JSTorrent_${version}_amd64.AppImage`,
    `JSTorrent_${version}_aarch64.AppImage`,
    'JSTorrent_aarch64.app.tar.gz',
    'JSTorrent_x64.app.tar.gz',
  ]
  const expected = new Set([
    ...payloads,
    ...payloads.map((name) => `${name}.sig`),
    `JSTorrent_${version}_aarch64.dmg`,
    `JSTorrent_${version}_x64.dmg`,
    'latest.json',
  ])
  if (!Array.isArray(release.assets) || release.assets.length !== expected.size) {
    throw new Error('Incomplete production platform inventory')
  }
  for (const value of release.assets) {
    const asset = record(value, ['name', 'bytes', 'sha256'], 'asset')
    if (
      typeof asset.name !== 'string' ||
      !expected.delete(asset.name) ||
      typeof asset.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      (asset.bytes as number) <= 0 ||
      (asset.bytes as number) > 512 * 1024 * 1024
    ) {
      throw new Error('Invalid production asset name, hash or size')
    }
  }
  if (expected.size) throw new Error('Missing production assets')
  const sources = record(release.sourceMaterials, ['name', 'bytes', 'sha256'], 'source materials')
  if (
    sources.name !== `JSTorrent_${version}_AppImage-sources-final.tar.gz` ||
    typeof sources.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sources.sha256) ||
    !Number.isSafeInteger(sources.bytes) ||
    (sources.bytes as number) <= 0 ||
    (sources.bytes as number) > 2 * 1024 * 1024 * 1024
  ) {
    throw new Error('Invalid AppImage source name, hash or size')
  }
  if (!descriptor.enabled) return null
  const prefix = `https://github.com/${PRODUCTION_REPOSITORY}/releases/download/${release.tag}/`
  const url = (name: string) => prefix + name
  const arm = url(`JSTorrent_${version}_aarch64.dmg`)
  const intel = url(`JSTorrent_${version}_x64.dmg`)
  return {
    tag: `v${version}`,
    windowsUrl: url(`JSTorrent_${version}_x64-setup.exe`),
    // Production Mac downloads use actual DMGs; do not invent optional PKG URLs.
    macosPrimaryArmUrl: arm,
    macosPrimaryIntelUrl: intel,
    macosArmUrl: arm,
    macosIntelUrl: intel,
    linuxAppImageUrl: url(`JSTorrent_${version}_amd64.AppImage`),
    linuxArm64AppImageUrl: url(`JSTorrent_${version}_aarch64.AppImage`),
    linuxSourceUrl: url(sources.name as string),
  }
}
