import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planLatestRelease, previousLatestRelease, verifiedDesktopInventory, verifiedMainPushRuns, verifyDraftInventoryAccess } from './latest-desktop-release.mjs';

const old = 'a'.repeat(40), sha = 'b'.repeat(40);
const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: true,
  assets: [{ name: 'JSTorrent_x64.app.tar.gz' }], ...extra });
const verified = { head_sha: sha, head_branch: 'main', event: 'push', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' };
const input = { sha, baseVersion: '0.3.1', releases: [], runs: [verified], isAncestor: () => true };

test('draft access uses a non-persisting API requiring effective write permission', () => {
  assert.equal(verifyDraftInventoryAccess({ repo: 'owner/project', sha,
    request: (path, body) => {
      assert.equal(path, 'repos/owner/project/releases/generate-notes');
      assert.deepEqual(body, { tag_name: 'desktop-inventory-access-check', target_commitish: sha });
      return { name: 'Generated', body: '' };
    } }), true);
  assert.throws(() => verifyDraftInventoryAccess({ repo: 'owner/project', sha,
    request: () => { throw new Error('HTTP 403'); } }), /HTTP 403/);
  for (const response of [undefined, {}, { name: 'Generated' }]) {
    assert.throws(() => verifyDraftInventoryAccess({ repo: 'owner/project', sha,
      request: () => response }), /capability response/);
  }
});

test('exact tags repair an incomplete list before choosing a version and previous source', () => {
  const latest = release('desktop-latest-v0.3.3');
  const stable = release('desktop-v0.3.1', { prerelease: false });
  for (const listed of [[stable], [{ ...latest, assets: [] }]]) {
    const fetched = [];
    const releases = verifiedDesktopInventory({
      listed, baseVersion: '0.3.1', canReadDrafts: true,
      tags: [stable.tag_name, latest.tag_name, 'desktop-v0.1.4'],
      lookup: tag => { fetched.push(tag); return tag === stable.tag_name ? stable : latest; },
    });
    assert.deepEqual(fetched.sort(), [latest.tag_name, stable.tag_name].sort());
    assert.equal(previousLatestRelease(releases), latest);
    assert.equal(planLatestRelease({ ...input, releases, previousSha: old }).version, '0.3.4');
  }
});
test('an unavailable or malformed exact release stops selection', () => {
  const tag = 'desktop-latest-v0.3.3';
  const inventory = { listed: [], tags: [tag], baseVersion: '0.3.1', canReadDrafts: true };
  assert.throws(() => verifiedDesktopInventory({ ...inventory, lookup: () => { throw new Error('HTTP 503'); } }), /HTTP 503/);
  for (const value of [release(tag, { assets: undefined }), release(tag, { assets: [] }),
    release(tag, { assets: [{ name: 'JSTorrent_0.3.3_x64.dmg' }] }), release('desktop-latest-v0.3.2')]) {
    assert.throws(() => verifiedDesktopInventory({ ...inventory, lookup: () => value }), /inventory|different tag/);
  }
});
test('exact refresh preserves frozen identities and unpublished drafts', () => {
  const frozen = release('desktop-latest-v0.9.999', { assets: [{ name: 'RSTorrent_x64.app.tar.gz' }] });
  const draft = release('desktop-latest-v0.3.90', { id: 90, draft: true, assets: [] });
  const releases = verifiedDesktopInventory({
    listed: [frozen, draft], tags: [], baseVersion: '0.3.1', canReadDrafts: true,
    lookup: tag => tag === frozen.tag_name ? frozen : draft,
    lookupDraft: id => { assert.equal(id, 90); return draft; },
  });
  assert.equal(previousLatestRelease(releases), undefined);
  assert.equal(planLatestRelease({ ...input, releases }).version, '0.3.2');
});
test('selection requires draft visibility before allocating a version', () => {
  const draft = release('desktop-latest-v0.3.5', { id: 55, draft: true });
  const inventory = { listed: [release('desktop-v0.3.4')], tags: [],
    baseVersion: '0.3.1', lookup: () => { throw new Error('must prove visibility first'); } };
  for (const canReadDrafts of [undefined, false]) {
    assert.throws(() => verifiedDesktopInventory({ ...inventory, canReadDrafts }), /Push access/);
  }
  const releases = verifiedDesktopInventory({ ...inventory, listed: [...inventory.listed, draft],
    canReadDrafts: true, lookup: () => inventory.listed[0],
    lookupDraft: id => { assert.equal(id, 55); return draft; } });
  assert.equal(planLatestRelease({ ...input, releases }).version, '0.3.6');
});
test('draft refresh uses its exact ID rather than the published-only tag endpoint', () => {
  const draft = release('desktop-latest-v0.3.5', { id: 55, draft: true });
  const inventory = { listed: [{ ...draft, assets: [] }], tags: [], baseVersion: '0.3.1',
    canReadDrafts: true, lookup: () => { throw new Error('by-tag lookup cannot read a draft'); } };
  const releases = verifiedDesktopInventory({ ...inventory,
    lookupDraft: id => { assert.equal(id, 55); return draft; } });
  assert.equal(planLatestRelease({ ...input, releases }).version, '0.3.6');
  assert.throws(() => verifiedDesktopInventory({ ...inventory, listed: [{ ...draft, id: undefined }] }), /draft release ID/);
  assert.throws(() => verifiedDesktopInventory({ ...inventory, lookupDraft: () => { throw new Error('HTTP 503'); } }), /HTTP 503/);
  assert.throws(() => verifiedDesktopInventory({ ...inventory,
    lookupDraft: () => ({ ...draft, tag_name: 'desktop-latest-v0.3.6' }) }), /different tag/);
});
test('CI selection retries missing list entries and refreshes the exact matching run', () => {
  let calls = 0;
  const current = { ...verified, id: 12 };
  const runs = verifiedMainPushRuns({
    sha,
    list: () => ++calls < 3 ? [{ ...current, head_sha: old }] : [{ ...current, status: 'in_progress', conclusion: null }],
    lookup: id => { assert.equal(id, current.id); return current; },
  });
  assert.equal(calls, 3);
  assert.deepEqual(runs, [current]);
  assert.equal(planLatestRelease({ ...input, runs }).build, true);
});
test('missing exact CI remains unverified after three bounded reads', () => {
  let calls = 0;
  const runs = verifiedMainPushRuns({ sha, list: () => { calls++; return []; },
    lookup: () => { throw new Error('must not look up another source'); } });
  assert.equal(calls, 3);
  assert.equal(planLatestRelease({ ...input, runs }).unverified, true);
});
test('a newer failed CI run cannot fall back to an older successful run', () => {
  const failed = { ...verified, id: 13, conclusion: 'failure' };
  const runs = verifiedMainPushRuns({ sha,
    list: () => [failed, { ...verified, id: 12 }],
    lookup: id => { assert.equal(id, failed.id); return failed; },
  });
  assert.equal(planLatestRelease({ ...input, runs }).unverified, true);
});
test('an exact CI lookup cannot substitute a different run or source', () => {
  const candidate = { ...verified, id: 12 };
  for (const changed of [{ id: 13 }, { head_sha: old }, { head_branch: 'other' }, { event: 'pull_request' }, { path: '.github/workflows/fast-ci.yml' }]) {
    assert.throws(() => verifiedMainPushRuns({ sha, list: () => [candidate],
      lookup: () => ({ ...candidate, ...changed }) }), /different/);
  }
});

test('first public Latest uses the common train and ignores frozen incubation', () => {
  const releases = [release('desktop-v0.3.1', { prerelease: false }),
    release('desktop-latest-v0.9.999', { assets: [{ name: 'RSTorrent_x64.app.tar.gz' }] })];
  assert.equal(previousLatestRelease(releases), undefined);
  assert.deepEqual(planLatestRelease({ ...input, releases }),
    { build: true, sha, version: '0.3.2', tag: 'desktop-latest-v0.3.2' });
});
test('new verified main advances both channels past occupied draft versions', () => {
  const releases = [release('desktop-latest-v0.3.9'), release('desktop-latest-v0.3.10'),
    release('desktop-v0.3.11', { prerelease: false }), release('desktop-latest-v0.3.90', { draft: true })];
  assert.equal(previousLatestRelease(releases).tag_name, 'desktop-latest-v0.3.10');
  assert.equal(planLatestRelease({ ...input, releases, previousSha: old }).version, '0.3.91');
});
test('already released main is skipped without allocating another version', () => {
  assert.equal(planLatestRelease({ ...input, releases: [release('desktop-latest-v0.3.2')], previousSha: sha }).build, false);
});
test('only exact successful main push CI qualifies; latest failed rerun wins', () => {
  for (const changes of [{ status: 'in_progress', conclusion: null }, { conclusion: 'failure' },
    { head_sha: old }, { head_branch: 'other' }, { event: 'pull_request' }]) {
    const result = planLatestRelease({ ...input, runs: [{ ...verified, ...changes }] });
    assert.equal(result.build, false); assert.equal(result.unverified, true);
  }
  assert.equal(planLatestRelease({ ...input, runs: [] }).build, false);
  assert.equal(planLatestRelease({ ...input, runs: [{ ...verified, conclusion: 'failure' }, verified] }).build, false);
});
test('missing or divergent previous source fails closed', () => {
  const previous = { ...input, releases: [release('desktop-latest-v0.3.2')] };
  assert.throws(() => planLatestRelease(previous), /previous Latest SHA/);
  assert.throws(() => planLatestRelease({ ...previous, previousSha: old, isAncestor: () => false }), /ancestor/);
  assert.throws(() => planLatestRelease({ ...input, sha: 'main' }), /Exact main SHA/);
});
test('scheduled publication uses qualified production identity and actual release tag', () => {
  const workflow = readFileSync(new URL('../.github/workflows/latest-desktop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /if: needs\.select\.outputs\.build == 'true'/);
  assert.match(workflow, /production_latest: true/);
  assert.match(workflow, /permissions:\n\s+actions: read\n(?:\s+#[^\n]*\n)*\s+contents: write/);
  const publisher = readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
  assert.equal((publisher.match(/RELEASE: \$\{\{ steps\.identity\.outputs\.tag \|\|/g) ?? []).length, 2);
});
