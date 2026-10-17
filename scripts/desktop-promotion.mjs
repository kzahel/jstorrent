import assert from 'node:assert/strict';
import { compare } from './desktop-release-train.mjs';
export function currentDesktopStable(releases) {
  const stable = releases.filter(release => !release.draft && !release.prerelease
    && /^desktop-v\d+\.\d+\.\d+$/.test(release.tag_name)
    && release.assets.some(asset => asset.name === 'JSTorrent_x64.app.tar.gz'))
    .sort((a, b) => compare(b.tag_name.slice(9), a.tag_name.slice(9)))[0];
  assert(stable, 'existing Stable release required');
  return stable;
}
export function assertPromotionFresh(plan, releases, source, sourceSha) {
  assert(Number.isSafeInteger(plan.previousStableId) && plan.previousStableId > 0, 'missing Stable release identity');
  assert(/^sha256:[a-f0-9]{64}$/.test(plan.previousStableManifestDigest), 'missing Stable metadata digest');
  const stable = currentDesktopStable(releases);
  assert.equal(stable.tag_name, `desktop-v${plan.previousStableVersion}`, 'Stable changed; prepare and qualify the promotion again');
  assert.equal(stable.id, plan.previousStableId, 'Stable release was replaced');
  assert.equal(stable.assets.find(asset => asset.name === 'latest.json')?.digest,
    plan.previousStableManifestDigest, 'Stable metadata changed');
  assert.equal(sourceSha, plan.sourceSha, 'Latest source tag changed');
  const current = planDesktopPromotion(source, plan.previousStableVersion, 'kzahel/jstorrent');
  assert.equal(current.tag, plan.tag, 'promotion target changed');
  assert.deepEqual(source.assets.map(({name, size, digest}) => ({name, size, digest})).sort((a,b) => a.name.localeCompare(b.name)),
    plan.sourceAssets, 'Latest assets changed after preparation');
}
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
    const maximum = asset.name === `JSTorrent_${version}_AppImage-sources-final.tar.gz` ? 2*1024*1024*1024 : 512*1024*1024;
    assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maximum, 'invalid asset size');
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
