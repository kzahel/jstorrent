import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const repoFile = path => join(repositoryRoot, path);

for (const mode of ['success', 'stale-inventory', 'concurrent-main']) {
  test(`promotion Git API transaction: ${mode}`, { skip: process.platform === 'win32' }, t => {
    const root = mkdtempSync(join(tmpdir(), 'website-git-api-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const baseline = readFileSync(repoFile('website/src/data/production-release.json'), 'utf8');
    const next = JSON.parse(baseline);
    const oldVersion = next.release.version;
    const parts = oldVersion.split('.').map(Number); parts[2]++;
    const nextVersion = parts.join('.');
    next.release.version = nextVersion; next.release.tag = `desktop-v${nextVersion}`;
    for (const asset of [...next.release.assets, next.release.sourceMaterials]) asset.name = asset.name.replace(oldVersion, nextVersion);
    const inventory = join(root, 'inventory.json'); writeFileSync(inventory, JSON.stringify(next));
    const calls = join(root, 'calls.ndjson');
    const gh = join(root, 'gh');
    writeFileSync(gh, `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);
const input=args.indexOf('--input');
const body=input<0?null:JSON.parse(fs.readFileSync(args[input+1],'utf8'));
fs.appendFileSync(process.env.MOCK_CALLS,JSON.stringify({args,body})+'\\n');
const endpoint=args[1];
let result={};
if(args[0]==='workflow')result={};
else if(endpoint.endsWith('git/ref/heads/main'))result={object:{sha:'a'.repeat(40)}};
else if(endpoint.includes('/contents/website/src/data/product-releases'))result={content:fs.readFileSync(process.env.MOCK_NEWS).toString('base64')};
else if(endpoint.includes('/contents/'))result={content:Buffer.from(process.env.MOCK_MODE==='stale-inventory'?'changed':fs.readFileSync(process.env.MOCK_BASELINE)).toString('base64')};
else if(endpoint.includes('/git/commits/') && !body)result={tree:{sha:'b'.repeat(40)}};
else if(endpoint.includes('/releases/tags/'))result={published_at:'2026-10-10T14:11:15Z'};
else if(endpoint.endsWith('/git/trees'))result={sha:'c'.repeat(40)};
else if(endpoint.endsWith('/git/commits'))result={sha:'d'.repeat(40)};
else if(endpoint.endsWith('/git/refs/heads/main') && process.env.MOCK_MODE==='concurrent-main')process.exit(1);
console.log(JSON.stringify(result));
`);
    chmodSync(gh, 0o700);
    const result = spawnSync(process.execPath, [repoFile('scripts/commit-website-promotion.mjs'), 'kzahel/jstorrent', inventory], { cwd: repositoryRoot, encoding: 'utf8', env: { ...process.env, PATH: root + ':' + process.env.PATH, MOCK_MODE: mode, MOCK_CALLS: calls, MOCK_BASELINE: repoFile('website/src/data/production-release.json'), MOCK_NEWS: repoFile('website/src/data/product-releases.json') } });
    const history = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const dispatched = history.some(call => call.args[0] === 'workflow');
    assert.equal(result.status === 0, mode === 'success', result.stderr);
    assert.equal(dispatched, mode === 'success');
    if (mode === 'stale-inventory') assert(!history.some(call => call.body));
    else {
      const tree = history.find(call => call.args[1].endsWith('/git/trees')).body;
      assert.deepEqual(tree.tree.map(file => file.path), ['website/src/data/production-release.json', 'website/src/data/product-releases.json']);
      const update = history.find(call => call.args[1].endsWith('/git/refs/heads/main')).body;
      assert.equal(update.force, false);
      const commit = history.find(call => call.args[1].endsWith('/git/commits') && call.body).body;
      assert.deepEqual(commit.parents, ['a'.repeat(40)]);
    }
  });
}
