import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { descriptorFromRelease, compareVersions, sameInventory, verifyDownloadedRelease } from './promote-website-release.mjs';

const descriptor = JSON.parse(readFileSync(new URL('../website/src/data/production-release.json', import.meta.url)));
function release() {
  const d = descriptor.release;
  return { draft: false, prerelease: false, published_at: '2026-10-10T14:11:15Z', tag_name: d.tag,
    assets: [...d.assets, d.sourceMaterials, { name: 'SHA256SUMS', bytes: 1000, sha256: 'a'.repeat(64) }].map(asset => ({ name: asset.name, size: asset.bytes, digest: `sha256:${asset.sha256}`, browser_download_url: `https://github.com/${d.repository}/releases/download/${d.tag}/${asset.name}` })) };
}
test('public metadata matches the qualified capsule independent of API asset order', () => {
  const r = release(); r.assets.reverse();
  const generated = descriptorFromRelease(r, descriptor.release.sourceSha, descriptor.release.repository);
  assert(sameInventory(descriptor, generated));
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.2.1', '0.3.0'), -1);
});
for (const [name, mutate] of [
  ['draft', r => r.draft = true], ['preview', r => r.prerelease = true],
  ['incubation tag', r => r.tag_name = 'desktop-latest-v0.3.0'],
  ['missing sources', r => r.assets.pop()],
  ['duplicate payload', r => r.assets[1] = r.assets[0]],
  ['foreign download', r => r.assets[0].browser_download_url = 'https://example.invalid/payload'],
  ['missing immutable hash', r => r.assets[0].digest = null],
  ['unexpected extra', r => r.assets.push(r.assets[0])],
]) test(`website promotion refuses ${name}`, () => {
  const r = release(); mutate(r);
  assert.throws(() => descriptorFromRelease(r, descriptor.release.sourceSha, descriptor.release.repository));
});
test('download verification rejects corrupted bytes before trusting signatures', async t => {
  const root = mkdtempSync(join(tmpdir(), 'website-corrupt-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = release(); r.assets = [{ name: 'payload', size: 4, digest: `sha256:${'b'.repeat(64)}` }];
  writeFileSync(join(root, 'payload'), 'evil');
  await assert.rejects(verifyDownloadedRelease(r, descriptor, root), /download digest mismatch/);
});
