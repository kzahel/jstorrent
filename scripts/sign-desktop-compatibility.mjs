import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compatibilityForSigning } from './desktop-promotion.mjs';
import { databaseCompatibility } from './desktop-compatibility.mjs';
import { verifySignature, updaterPublicKey } from './verify-desktop-signatures.mjs';
const root = resolve(import.meta.dirname, '..');
const directory = resolve(process.argv[2]);
const latestPath = join(directory, 'assets/latest.json');
const latest = JSON.parse(readFileSync(latestPath, 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'desktop-compatibility-'));
try {
  const file = join(work, 'compatibility.json');
  let previous;
  if (process.argv.includes('--promote')) {
    if (!latest.compatibility) throw new Error('Promotion requires authenticated original facts');
    const original = Buffer.from(latest.compatibility.data, 'base64');
    const originalFile = join(work, 'original.json');writeFileSync(originalFile, original);
    verifySignature(originalFile, latest.compatibility.signature, updaterPublicKey('JSTorrent'));
    previous = JSON.parse(original.toString());
  }
  const databases = compatibilityForSigning(latest, databaseCompatibility(root), previous);
  const bytes = Buffer.from(JSON.stringify({schemaVersion:1, version:latest.version,
    identifier:'com.jstorrent.desktop', databases, platforms:latest.platforms}));
  writeFileSync(file, bytes);
  execFileSync(join(root, 'clients/web/node_modules/.bin/tauri'), ['signer', 'sign', file], {stdio:'pipe'});
  const signature = readFileSync(file + '.sig', 'utf8').trim();
  verifySignature(file, signature, updaterPublicKey('JSTorrent'));
  latest.compatibility = { data:bytes.toString('base64'), signature };
  const updated = Buffer.from(JSON.stringify(latest, null, 2) + '\n');
  if (updated.length > 64 * 1024) throw new Error('Release metadata exceeds native client bound');
  writeFileSync(latestPath, updated);
  const releasePath = join(directory, 'release.json');
  const release = JSON.parse(readFileSync(releasePath, 'utf8'));
  const asset = release.assets.find(asset => asset.name === 'latest.json');
  asset.size = updated.length;
  asset.digest = 'sha256:' + createHash('sha256').update(updated).digest('hex');
  writeFileSync(releasePath, JSON.stringify(release, null, 2) + '\n');
} finally { rmSync(work, {recursive:true, force:true}); }
