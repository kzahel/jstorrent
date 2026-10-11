import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectProductionWebsiteRelease } from '../website/src/lib/production-release.ts';
import { signatureKeyId, updaterPublicKey, verifySignature } from './verify-desktop-signatures.mjs';

export function descriptorFromRelease(release, sourceSha, repository) {
  assert.equal(release.draft, false, 'release is still a draft');
  assert.equal(release.prerelease, false, 'release is a preview');
  assert(release.published_at, 'release has not been published');
  const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  assert(version, 'release is not a production desktop tag');
  const sourceName = `JSTorrent_${version}_AppImage-sources-final.tar.gz`;
  assert.equal(release.assets.length, 17, 'published inventory is incomplete or has unexpected assets');
  const asset = value => {
    assert(value && Number.isSafeInteger(value.size) && value.size > 0, 'invalid asset size');
    assert(/^sha256:[0-9a-f]{64}$/.test(value.digest ?? ''), 'asset has no immutable SHA-256');
    assert.equal(value.browser_download_url, `https://github.com/${repository}/releases/download/${release.tag_name}/${value.name}`, 'asset URL escaped the published capsule');
    return { name: value.name, bytes: value.size, sha256: value.digest.slice(7) };
  };
  const checksums = release.assets.filter(value => value.name === 'SHA256SUMS');
  assert.equal(checksums.length, 1, 'missing/duplicate checksum asset');
  assert(checksums[0].size <= 65536, 'checksum asset is unbounded');
  asset(checksums[0]);
  const descriptor = { schema: 1, enabled: true, release: {
    version, tag: release.tag_name, repository, sourceSha,
    updaterPublicKeyId: '415D3DF4B3D0CFB8', qualified: true,
    assets: release.assets.filter(value => value.name !== sourceName && value.name !== 'SHA256SUMS').map(asset).sort((a, b) => a.name.localeCompare(b.name)),
    sourceMaterials: asset(release.assets.find(value => value.name === sourceName)),
  } };
  selectProductionWebsiteRelease(descriptor);
  return descriptor;
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
export function sameInventory(left, right) {
  const normalize = value => ({ ...value.release, assets: [...value.release.assets].sort((a, b) => a.name.localeCompare(b.name)) });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function verifyDownloadedRelease(release, descriptor, directory) {
  const expected = new Map(release.assets.map(asset => [asset.name, asset]));
  for (const asset of expected.values()) {
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of createReadStream(join(directory, asset.name))) {
      bytes += chunk.length; assert(bytes <= asset.size, 'download exceeds declared bounds'); hash.update(chunk);
    }
    assert.equal(bytes, asset.size, `truncated asset: ${asset.name}`);
    assert.equal(`sha256:${hash.digest('hex')}`, asset.digest, `download digest mismatch: ${asset.name}`);
  }
  const sums = [...descriptor.release.assets, descriptor.release.sourceMaterials]
    .filter(asset => !asset.name.endsWith('.sig')).map(asset => `${asset.sha256}  ${asset.name}`).sort().join('\n') + '\n';
  assert.equal(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), sums, 'checksum inventory does not bind exact core and source bytes');
  const latest = JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8'));
  assert.equal(latest.version, descriptor.release.version, 'updater version disagrees');
  const prefix = `https://github.com/${descriptor.release.repository}/releases/download/${descriptor.release.tag}/`;
  const required = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-aarch64'];
  for (const key of required) assert(latest.platforms[key], `missing updater platform: ${key}`);
  const key = updaterPublicKey('JSTorrent');
  const signatureNames = descriptor.release.assets.filter(asset => asset.name.endsWith('.sig'));
  assert.equal(signatureNames.length, 6);
  for (const asset of signatureNames) {
    const signature = readFileSync(join(directory, asset.name), 'utf8').trim();
    assert.equal(signatureKeyId(signature), descriptor.release.updaterPublicKeyId, 'changed updater trust root');
    verifySignature(join(directory, asset.name.slice(0, -4)), signature, key);
  }
  for (const value of Object.values(latest.platforms)) {
    assert(value.url.startsWith(prefix), 'updater URL escaped release');
    const name = value.url.slice(prefix.length);
    assert(expected.has(name + '.sig'), 'updater selected an unsigned/unknown asset');
    assert.equal(value.signature, readFileSync(join(directory, name + '.sig'), 'utf8').trim(), 'updater signature does not match the published payload');
  }
}

async function main() {
  const [repository, tag, output] = process.argv.slice(2);
  assert(['kzahel/rstorrent'].includes(repository), 'unexpected production repository');
  assert(/^desktop-v\d+\.\d+\.\d+$/.test(tag ?? ''), 'invalid production tag');
  assert(output, 'usage: promote-website-release.mjs REPOSITORY TAG OUTPUT');
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]));
  const sourceSha = gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha']).trim();
  const descriptor = descriptorFromRelease(release, sourceSha, repository);
  const current = JSON.parse(readFileSync('website/src/data/production-release.json', 'utf8'));
  assert(compareVersions(descriptor.release.version, current.release.version) >= 0, 'refuse website downgrade');
  if (sameInventory(current, descriptor)) { console.log('Published release matches the already qualified website inventory'); return; }
  assert(compareVersions(descriptor.release.version, current.release.version) > 0, 'published version was mutated');
  const directory = mkdtempSync(join(tmpdir(), 'website-promotion-'));
  try {
    // Run once per new release, never on every website build. Remove all packages.
    execFileSync('gh', ['release', 'download', tag, '--repo', repository, '--dir', directory], { stdio: 'inherit' });
    await verifyDownloadedRelease(release, descriptor, directory);
    assert.equal(gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha']).trim(), sourceSha, 'tag moved during verification');
    writeFileSync(output, JSON.stringify(descriptor, null, 2) + '\n');
    console.log(`Verified production website inventory ${descriptor.release.version}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
