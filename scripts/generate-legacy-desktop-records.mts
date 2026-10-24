// Invokes pinned legacy writers; run with tsx against a disposable source archive.
// This is fixture generation, not an importer or a personal-library reader.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const source = process.env.RSTORRENT_LEGACY_SOURCE;
assert(source, 'provide the Tactical 233 pinned source archive');
const spec = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['empty', 'alpha', 'same', 'conflict', 'disjoint', 'unavailable', 'multifile'].includes(spec.variant));
assert(typeof spec.rootKey === 'string' && spec.rootKey.length <= 128);
assert(resolve(spec.rootPath) === spec.rootPath);
const moduleAt = (path: string) => import(pathToFileURL(join(source, path)).href);
const { BtEngine } = await moduleAt('packages/engine/src/core/bt-engine.ts');
const { MemorySocketFactory, InMemoryFileSystem } = await moduleAt('packages/engine/src/adapters/memory/index.ts');
const { StorageRootManager } = await moduleAt('packages/engine/src/storage/storage-root-manager.ts');
const { HostChannelSessionStore } = await moduleAt('packages/client/src/host/host-channel-session-store.ts');
const values = new Map<string, unknown>();
const channel = {
  async kvSet(key: string, value: unknown, { keyPrefix }: { keyPrefix: string }) { values.set(keyPrefix + key, structuredClone(value)); },
  async kvGet(key: string, { keyPrefix }: { keyPrefix: string }) { return values.get(keyPrefix + key); },
  async kvDelete(key: string, { keyPrefix }: { keyPrefix: string }) { values.delete(keyPrefix + key); },
  async kvKeys(prefix = '', { keyPrefix }: { keyPrefix: string }) { return [...values.keys()].filter(key => key.startsWith(keyPrefix + prefix)).map(key => key.slice(keyPrefix.length)); },
};
const memory = new InMemoryFileSystem();
const roots = new StorageRootManager(() => memory);
roots.addRoot({ key: spec.rootKey, path: spec.rootPath, label: 'Controlled fixture' });
roots.setDefaultRoot(spec.rootKey);
const engine = new BtEngine({ socketFactory: new MemorySocketFactory(), storageRootManager: roots,
  sessionStore: new HostChannelSessionStore(channel), startSuspended: true });
function bencode(value: any): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return bencode(Buffer.from(value));
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(value).sort().flatMap(key => [bencode(key), bencode(value[key])]), Buffer.from('e')]);
}
const records: any[] = [];
try {
  if (spec.variant !== 'empty') {
    const name = spec.variant === 'disjoint' ? '独立.bin' : 'shared.bin';
    const payload = Buffer.alloc(32768, spec.variant === 'disjoint' ? 0x47 : 0x32);
    const info = { length: payload.length, name, 'piece length': 16384,
      pieces: Buffer.concat([0, 16384].map(offset => createHash('sha1').update(payload.subarray(offset, offset + 16384)).digest())), private: 1 };
    const metainfo = bencode({ info });
    const infoHash = createHash('sha1').update(bencode(info)).digest('hex');
    const actual = spec.variant === 'conflict' ? payload.subarray(0, 16384) : payload;
    memory.files.set(name, actual);
    await mkdir(spec.rootPath, { recursive: true });
    const payloadPath = join(spec.rootPath, name);
    try { await writeFile(payloadPath, actual, { flag: 'wx' }); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(payloadPath), actual); }
    const { torrent } = await engine.addTorrent(metainfo, { storageKey: spec.rootKey, userState: spec.variant === 'conflict' ? 'active' : 'stopped' });
    assert(torrent);
    await torrent.recheckData();
    const verifiedPieces = torrent.bitfield.cardinality();
    assert.equal(verifiedPieces, actual.length / 16384);
    await engine.sessionPersistence.saveTorrentFile(infoHash, metainfo);
    await engine.sessionPersistence.saveTorrentState(torrent);
    records.push({ infoHash, source: 'file', name, bytes: actual.length, verifiedPieces,
      sha256: createHash('sha256').update(actual).digest('hex'), intent: torrent.userState });
    if (spec.variant === 'disjoint') {
      const magnetHash = '1234567890abcdef1234567890abcdef12345678';
      const { torrent: pending } = await engine.addTorrent(`magnet:?xt=urn:btih:${magnetHash}&dn=pending`, { storageKey: spec.rootKey, userState: 'stopped' });
      assert(pending);
      await engine.sessionPersistence.saveTorrentState(pending);
      records.push({ infoHash: magnetHash, source: 'magnet', intent: pending.userState });
    }
  }
  if (spec.variant === 'multifile') {
    const files = [{ path: ['選択.bin'], length: 16384 }, { path: ['skipped.bin'], length: 16384 }];
    const blocks = [Buffer.alloc(16384, 0x41), Buffer.alloc(16384, 0x42)];
    const info = { name: 'bundle', files, 'piece length': 16384,
      pieces: Buffer.concat(blocks.map(block => createHash('sha1').update(block).digest())), private: 1 };
    const infoHash = createHash('sha1').update(bencode(info)).digest('hex');
    const metainfo = bencode({ info });
    await memory.mkdir('bundle');
    memory.files.set('bundle/選択.bin', blocks[0]);
    await mkdir(join(spec.rootPath, 'bundle'), { recursive: true });
    await writeFile(join(spec.rootPath, 'bundle', '選択.bin'), blocks[0], { flag: 'wx' });
    const { torrent } = await engine.addTorrent(metainfo, { storageKey: spec.rootKey, userState: 'stopped' });
    assert(torrent);
    await torrent.setFilePriorityAsync(1, 1); // pinned legacy 1 means skip
    await torrent.recheckData();
    assert.equal(torrent.bitfield.cardinality(), 1);
    await engine.sessionPersistence.saveTorrentFile(infoHash, metainfo);
    await engine.sessionPersistence.saveTorrentState(torrent);
    records.push({ infoHash, source: 'file', name: 'bundle/選択.bin', bytes: 16384,
      verifiedPieces: 1, filePriorities: [...torrent.filePriorities],
      sha256: createHash('sha256').update(blocks[0]).digest('hex'), intent: torrent.userState });
  }
  await engine.sessionPersistence.saveTorrentList();
} finally { await engine.destroy(); }
assert(values.size <= 64);
await writeFile(process.argv[3], JSON.stringify({ records, kv: [...values].map(([key, value]) => ({ key, value: JSON.stringify(value) })) }, null, 2), { flag: 'wx' });
