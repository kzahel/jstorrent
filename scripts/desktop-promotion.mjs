import assert from 'node:assert/strict';
import { compare } from './desktop-release-train.mjs';
/** A promotion changes release metadata and location, never native packages. */
export function planDesktopPromotion(release, currentStableVersion, repository) {
  assert.equal(repository, 'kzahel/jstorrent', 'unexpected production repository');
  assert.equal(release.draft, false, 'Latest must already be public');
  assert.equal(release.prerelease, true, 'source must be a Latest prerelease');
  const match = /^desktop-latest-v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  assert(match, 'source must be a Latest tag');
  const version = match[1];
  assert(compare(version, currentStableVersion) > 0, 'Stable must advance');
  assert.equal(release.assets.length, 17, 'complete signed production inventory required');
  const names = new Set();
  for (const asset of release.assets) {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(asset.name) && !names.has(asset.name), 'invalid or duplicate release asset');
    names.add(asset.name);
    assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 512*1024*1024, 'invalid asset size');
    assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'missing asset digest');
    assert.equal(asset.browser_download_url, `https://github.com/${repository}/releases/download/${release.tag_name}/${asset.name}`, 'foreign release asset');
  }
  for(const name of ['latest.json','SHA256SUMS','JSTorrent_x64.app.tar.gz','JSTorrent_aarch64.app.tar.gz',`JSTorrent_${version}_AppImage-sources-final.tar.gz`]) assert(names.has(name), 'incomplete production assets');
  return {version, sourceTag:release.tag_name, tag:`desktop-v${version}`, assets:release.assets};
}
export function promotedManifest(latest, plan, repository) {
  assert.equal(latest.version, plan.version, 'promotion must preserve installed version');
  assert(latest.compatibility, 'authenticated database metadata required');
  const platforms = {};
  for(const [key, payload] of Object.entries(latest.platforms)) {
    const prefix=`https://github.com/${repository}/releases/download/${plan.sourceTag}/`;
    assert(payload.url.startsWith(prefix), 'foreign updater payload');
    const name=decodeURIComponent(payload.url.slice(prefix.length));
    assert(plan.assets.some(asset=>asset.name===name), 'unknown updater payload');
    platforms[key]={...payload,url:`https://github.com/${repository}/releases/download/${plan.tag}/${encodeURIComponent(name)}`};
  }
  return {...latest,platforms};
}

export function compatibilityForSigning(latest, currentDatabases, previous) {
  if (!previous) return currentDatabases;
  assert.equal(previous.schemaVersion, 1);
  assert.equal(previous.version, latest.version, 'promoted version changed');
  assert.equal(previous.identifier, 'com.jstorrent.desktop', 'foreign compatibility identity');
  assert.deepEqual(Object.keys(previous.platforms).sort(),Object.keys(latest.platforms).sort(),'platform inventory changed');
  for(const [key,payload] of Object.entries(latest.platforms)) assert.equal(payload.signature,previous.platforms[key].signature,'promotion changed native bytes');
  return previous.databases;
}
