import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { handle } from '../src/worker.ts';
import { encryptFragment, MAX_RECORD_BYTES } from '../src/codec.ts';

function fixture() {
  const values = new Map<string, ArrayBuffer>();
  const puts: { id: string; ttl: number }[] = [];
  let reads = 0;
  let allowed = true;
  let failed = false;
  const keys: string[] = [];
  const env = {
    LINKS: {
      async get(id: string) { reads++; if (failed) throw new Error('private error'); return values.get(id) ?? null; },
      async put(id: string, bytes: Uint8Array, options: { expirationTtl: number }) {
        puts.push({ id, ttl: options.expirationTtl }); values.set(id, bytes.slice().buffer);
      },
    },
    CREATE_LIMIT: { async limit({ key }: { key: string }) { keys.push('create:' + key); return { success: allowed }; } },
    READ_LIMIT: { async limit({ key }: { key: string }) { keys.push('read:' + key); return { success: allowed }; } },
    ASSETS: { async fetch() { return new Response('<html>open</html>', { headers: { 'Content-Type': 'text/html' } }); } },
  };
  return { values, puts, keys, get reads() { return reads; }, set allowed(v: boolean) { allowed = v; }, set failed(v: boolean) { failed = v; },
    call: (path: string, init?: RequestInit) => handle(new Request('https://link.example' + path, init), env as never) };
}
function post(body: Uint8Array | string, extra = {}): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'CF-Connecting-IP': '192.0.2.1', ...extra }, body };
}

test('create then read preserves ciphertext, 30-day TTL, CORS and security policy', async () => {
  const f = fixture(); const { record } = await encryptFragment('xt=test');
  const created = await f.call('/v1/links', post(record));
  assert.equal(created.status, 201);
  const { id, expiresAt } = await created.json();
  assert.match(id, /^[A-Za-z0-9]{10}$/);
  assert(Math.abs(Date.parse(expiresAt) - Date.now() - 30 * 86400_000) < 5000);
  assert.deepEqual(f.puts, [{ id, ttl: 30 * 86400 }]);
  const read = await f.call('/v1/links/' + id);
  assert.equal(read.status, 200);
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), record);
  assert.equal(read.headers.get('Cache-Control'), 'no-store');
  assert.equal(read.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(read.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(read.headers.get('Referrer-Policy'), 'no-referrer');
  assert.deepEqual(f.keys, ['create:192.0.2.1', 'read:local']);
  assert.equal((await f.call('/v1/links/' + id, post(record))).status, 405);
  assert.equal(f.puts.length, 1);
});
test('body, media type, path, method and version bounds before storage', async () => {
  const f = fixture();
  assert.equal((await f.call('/v1/links', post(new Uint8Array(MAX_RECORD_BYTES + 1)))).status, 413);
  assert.equal((await f.call('/v1/links', post('tiny'))).status, 400);
  const { record } = await encryptFragment('xt=test'); record[0] = 2;
  assert.equal((await f.call('/v1/links', post(record))).status, 400);
  assert.equal((await f.call('/v1/links', post('x', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await f.call('/v1/links?key=never', post('x'))).status, 400);
  for (const path of ['/v1/links/no', '/v1/links/AAAAAAAAAA/extra', '/v1/no']) assert.equal((await f.call(path)).status, 404);
  assert.equal(f.reads, 0); assert.equal(f.puts.length, 0);
  assert.equal((await f.call('/v1/links/AAAAAAAAAA')).status, 404);
  assert.equal((await f.call('/v1/links')).status, 405);
});
test('streamed oversized body is cancelled without trusting Content-Length', async () => {
  const f = fixture(); let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  const response = await f.call('/v1/links', { ...post(''), body: stream, duplex: 'half' } as RequestInit);
  assert.equal(response.status, 413); assert(cancelled); assert.equal(f.puts.length, 0);
});
test('collision never intentionally replaces an existing ID and retries are bounded', async () => {
  const f = fixture(); f.values.set('AAAAAAAAAA', new Uint8Array([77]).buffer);
  const { record } = await encryptFragment('xt=test');
  const random = mock.method(crypto, 'getRandomValues', (bytes: Uint8Array) => bytes.fill(0));
  try {
    assert.equal((await f.call('/v1/links', post(record))).status, 503);
    assert.equal(f.reads, 5); assert.equal(f.puts.length, 0);
    assert.deepEqual(new Uint8Array(f.values.get('AAAAAAAAAA')!), new Uint8Array([77]));
  } finally { random.mock.restore(); }
});
test('preflight, rate limits, storage failures and assets carry safe headers', async () => {
  const f = fixture();
  assert.equal((await f.call('/v1/links', { method: 'OPTIONS' })).status, 204);
  f.allowed = false;
  const limited = await f.call('/v1/links', post('x'));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  assert.equal(limited.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(f.reads, 0);
  f.allowed = true; f.failed = true;
  const failed = await f.call('/v1/links/AAAAAAAAAA');
  assert.equal(failed.status, 503); assert.equal(await failed.text(), '');
  const asset = await f.call('/');
  assert.equal(asset.headers.get('Content-Security-Policy'), "default-src 'none'; base-uri 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'none'");
  assert.equal(asset.headers.get('Access-Control-Allow-Origin'), null);
});
