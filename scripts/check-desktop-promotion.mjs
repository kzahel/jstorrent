import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPromotionFresh } from './desktop-promotion.mjs';

const directory = process.argv[2];
assert(directory, 'usage: check-desktop-promotion.mjs PREPARED_DIRECTORY');
const plan = JSON.parse(readFileSync(resolve(directory, 'promotion.json'), 'utf8'));
assert(/^desktop-latest-v\d+\.\d+\.\d+$/.test(plan.sourceTag), 'exact source tag required');
const api = (...args) => JSON.parse(execFileSync('gh', ['api', ...args], {encoding: 'utf8', maxBuffer: 32*1024*1024}));
const repository = 'repos/kzahel/jstorrent';
const releases = api('--paginate', '--slurp', `${repository}/releases?per_page=100`).flat();
const source = api(`${repository}/releases/tags/${plan.sourceTag}`);
const sourceSha = api(`${repository}/commits/${plan.sourceTag}`).sha;
assertPromotionFresh(plan, releases, source, sourceSha);
console.log('Stable predecessor, Latest source and all tested asset digests remain unchanged');
