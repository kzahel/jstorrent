import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planLatestRelease, previousLatestRelease } from './latest-desktop-release.mjs';

const old = 'a'.repeat(40), sha = 'b'.repeat(40);
const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: true,
  assets: [{ name: 'JSTorrent_x64.app.tar.gz' }], ...extra });
const verified = { head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };
const input = { sha, baseVersion: '0.3.1', releases: [], runs: [verified], isAncestor: () => true };

test('first public Latest uses the common train and ignores frozen incubation', () => {
  const releases = [release('desktop-v0.3.1', { prerelease: false }),
    release('desktop-latest-v0.9.999', { assets: [{ name: 'RSTorrent_x64.app.tar.gz' }] })];
  assert.equal(previousLatestRelease(releases), undefined);
  assert.deepEqual(planLatestRelease({ ...input, releases }),
    { build: true, sha, version: '0.3.2', tag: 'desktop-latest-v0.3.2' });
});
test('any new verified main commit qualifies and both channels advance the train', () => {
  const releases = [release('desktop-latest-v0.3.9'), release('desktop-latest-v0.3.10'),
    release('desktop-v0.3.11', { prerelease: false }), release('desktop-latest-v0.3.90', { draft: true })];
  assert.equal(previousLatestRelease(releases).tag_name, 'desktop-latest-v0.3.10');
  assert.equal(planLatestRelease({ ...input, releases, previousSha: old }).version, '0.3.12');
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
  const publisher = readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
  assert.equal((publisher.match(/RELEASE: \$\{\{ steps\.identity\.outputs\.tag \|\|/g) ?? []).length, 2);
});
