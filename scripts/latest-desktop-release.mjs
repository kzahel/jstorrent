import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compare, isPublishedDesktopRelease, nextDesktopVersion } from './desktop-release-train.mjs';

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
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY required');
  const sha = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA !== sha) throw new Error('Checkout must match the workflow main SHA');
  const releases = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Release inventory exceeds 10,000 entries');
    const batch = api(`repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const previous = previousLatestRelease(releases);
  const runs = api(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`).workflow_runs;
  const plan = planLatestRelease({
    sha,
    baseVersion: JSON.parse(readFileSync('clients/desktop/src-tauri/tauri.conf.json', 'utf8')).version,
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
