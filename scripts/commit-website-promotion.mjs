import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, sameInventory } from './promote-website-release.mjs';
import { selectProductionWebsiteRelease } from '../website/src/lib/production-release.ts';

const [repository, inventory] = process.argv.slice(2);
assert.equal(repository, 'kzahel/rstorrent');
if (!existsSync(inventory)) { console.log('No new production inventory to commit'); process.exit(0); }
const descriptor = JSON.parse(readFileSync(inventory, 'utf8'));
selectProductionWebsiteRelease(descriptor);
const baseline = JSON.parse(readFileSync('website/src/data/production-release.json', 'utf8'));
if (sameInventory(baseline, descriptor)) { console.log('Website inventory already promoted'); process.exit(0); }
assert(compareVersions(descriptor.release.version, baseline.release.version) > 0, 'refuse unchanged or older website version');
const directory = mkdtempSync(join(tmpdir(), 'website-promotion-api-'));
try {
  let count = 0;
  const api = (endpoint, method = 'GET', body) => {
    const args = ['api', `repos/${repository}/${endpoint}`, '--method', method];
    if (body) { const file = join(directory, `${++count}.json`); writeFileSync(file, JSON.stringify(body)); args.push('--input', file); }
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  };
  const head = api('git/ref/heads/main').object.sha;
  const current = api(`contents/website/src/data/production-release.json?ref=${head}`);
  assert.equal(Buffer.from(current.content, 'base64').toString(), readFileSync('website/src/data/production-release.json', 'utf8'), 'website inventory changed during verification');
  const commit = api(`git/commits/${head}`);
  const published = api(`releases/tags/${descriptor.release.tag}`).published_at;
  assert(/^\d{4}-\d{2}-\d{2}T/.test(published), 'missing publication date');
  const announcement = api(`contents/website/src/data/product-releases.json?ref=${head}`);
  const entries = JSON.parse(Buffer.from(announcement.content, 'base64').toString());
  if (!entries.some(entry => entry.product === 'Desktop App' && entry.version === descriptor.release.version)) entries.unshift({ product: 'Desktop App', version: descriptor.release.version, date: published.slice(0, 10), items: ['A new JSTorrent desktop release is available. See the release notes for details.'] });
  const tree = api('git/trees', 'POST', { base_tree: commit.tree.sha, tree: [
    { path: 'website/src/data/production-release.json', mode: '100644', type: 'blob', content: JSON.stringify(descriptor, null, 2) + '\n' },
    { path: 'website/src/data/product-releases.json', mode: '100644', type: 'blob', content: JSON.stringify(entries.slice(0, 10), null, 2) + '\n' },
  ] });
  const result = api('git/commits', 'POST', { message: `Promote verified desktop ${descriptor.release.version} website downloads\n\nVerify public bytes and retained updater signatures before advancing\nthe website inventory and triggering its normal deployment workflow.\n\nTopic: product-surfaces-and-migration`, tree: tree.sha, parents: [head] });
  // A concurrent main change refuses this update instead of overwriting it.
  api('git/refs/heads/main', 'PATCH', { sha: result.sha, force: false });
  execFileSync('gh', ['workflow', 'run', 'deploy-website.yml', '--repo', repository, '--ref', 'main'], { stdio: 'inherit' });
  console.log(`Committed ${result.sha} and dispatched the website deployment`);
} finally { rmSync(directory, { recursive: true, force: true }); }
