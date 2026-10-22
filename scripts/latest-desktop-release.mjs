import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { compare, isPublishedDesktopRelease, nextDesktopVersion } from './desktop-release-train.mjs';

export function verifiedDesktopInventory({ listed, tags, baseVersion, lookup }) {
  const releases = new Map(listed.map(release => [release.tag_name, release]));
  const candidates = new Set([...releases.keys(), ...tags].filter(tag => {
    const version = /^desktop-(?:latest-)?v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
    return version && compare(version, baseVersion) >= 0;
  }));
  assert(candidates.size <= 10000, 'Desktop tag inventory exceeds 10,000 entries');
  for (const tag of candidates) {
    // List responses may omit a release or its assets. Fetch each known tag
    // separately before allocating a version or choosing the previous source.
    // Lookup failures must stop selection, never make a published tag vanish.
    const release = lookup(tag);
    assert.equal(release.tag_name, tag, 'Exact release lookup returned a different tag');
    assert(Array.isArray(release.assets), `${tag}: missing exact asset inventory`);
    if (!release.draft) {
      assert(release.assets.length > 0, `${tag}: empty published asset inventory`);
      if (release.assets.some(asset => asset.name.startsWith('JSTorrent_')) ||
          isPublishedDesktopRelease(releases.get(tag) ?? {})) {
        assert(isPublishedDesktopRelease(release), `${tag}: incomplete production asset inventory`);
      }
    }
    releases.set(tag, release);
  }
  return [...releases.values()];
}

export function verifiedMainPushRuns({ sha, list, lookup }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const runs = list();
    const candidate = runs.find(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push');
    if (!candidate) continue;
    assert(Number.isSafeInteger(candidate.id) && candidate.id > 0, 'Exact CI run ID required');
    const current = lookup(candidate.id);
    assert.equal(current.id, candidate.id, 'Exact CI lookup returned a different run');
    assert.equal(current.head_sha, sha, 'Exact CI lookup returned a different source');
    assert.equal(current.head_branch, 'main', 'Exact CI lookup returned a different branch');
    assert.equal(current.event, 'push', 'Exact CI lookup returned a different event');
    assert.equal(current.path, '.github/workflows/ci.yml', 'Exact CI lookup returned a different workflow');
    return [current];
  }
  return [];
}

export function previousLatestRelease(releases) {
  return releases.filter(release => isPublishedDesktopRelease(release) &&
    release.prerelease === true && release.tag_name.startsWith('desktop-latest-v'))
    .sort((a, b) => compare(b.tag_name.slice(16), a.tag_name.slice(16)))[0];
}

export function planLatestRelease({ sha, baseVersion, releases, runs, previousSha, isAncestor }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Exact main SHA required');
  const previous = previousLatestRelease(releases);
  if (previous) {
    if (!/^[0-9a-f]{40}$/.test(previousSha ?? '')) throw new Error('Exact previous Latest SHA required');
    if (previousSha === sha) return { build: false, reason: 'Latest already contains this main commit' };
    if (!isAncestor(previousSha, sha)) throw new Error('Previous Latest is not an ancestor of main');
  }
  const run = runs.find(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push');
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') {
    return { build: false, unverified: true, reason: 'Exact main push CI has not succeeded' };
  }
  const version = nextDesktopVersion(baseVersion, releases);
  return { build: true, sha, version, tag: `desktop-latest-v${version}` };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}
function api(path) {
  return JSON.parse(execFileSync('gh', ['api', '-H', 'Cache-Control: no-cache', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY required');
  const sha = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA !== sha) throw new Error('Checkout must match the workflow main SHA');
  const listed = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Release inventory exceeds 10,000 entries');
    const batch = api(`repos/${repo}/releases?per_page=100&page=${page}`);
    listed.push(...batch);
    if (batch.length < 100) break;
  }
  const baseVersion = JSON.parse(readFileSync('clients/desktop/src-tauri/tauri.conf.json', 'utf8')).version;
  const releases = verifiedDesktopInventory({
    listed, baseVersion,
    tags: git('tag', '--list', 'desktop-v*', 'desktop-latest-v*').split('\n').filter(Boolean),
    lookup: tag => api(`repos/${repo}/releases/tags/${tag}`),
  });
  console.log('Verified published desktop inventory: ' + releases.filter(isPublishedDesktopRelease).map(release => release.tag_name).sort().join(', '));
  const previous = previousLatestRelease(releases);
  // Match the exact SHA locally: GitHub's head_sha filter can return an empty
  // list even when the same main-push run is present without that filter.
  const runs = verifiedMainPushRuns({
    sha,
    list: () => api(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100`).workflow_runs,
    lookup: id => api(`repos/${repo}/actions/runs/${id}`),
  });
  console.log('Exact main push CI: ' + JSON.stringify(runs.filter(run => run.head_sha === sha).map(({id, head_branch, event, status, conclusion}) => ({id, head_branch, event, status, conclusion}))));
  const plan = planLatestRelease({
    sha,
    baseVersion,
    releases, runs,
    previousSha: previous ? git('rev-parse', `${previous.tag_name}^{commit}`) : undefined,
    isAncestor: (old, current) => {
      const result = spawnSync('git', ['merge-base', '--is-ancestor', old, current]);
      if (result.status !== 0 && result.status !== 1) throw new Error('Cannot establish Latest ancestry');
      return result.status === 0;
    },
  });
  if (plan.unverified && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') throw new Error(plan.reason);
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    plan.build ? `Publishing **${plan.tag}** from \`${plan.sha}\`.\n` : `Skipped: ${plan.reason}.\n`);
  console.log(JSON.stringify(plan));
}
let isMain = false;
try { isMain = realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch {}
if (isMain) main().catch(error => { console.error(error); process.exitCode = 1; });
