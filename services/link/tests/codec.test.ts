import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCipheriv } from 'node:crypto';
import { encryptFragment, decryptFragment, decodeKey, parseShortLinkFragment, MAX_FRAGMENT_BYTES, MAX_RECORD_BYTES } from '../src/codec.ts';

const vectors = JSON.parse(readFileSync(new URL('../test-vectors.json', import.meta.url), 'utf8'));
for (const vector of vectors) {
  test('v1 OpenSSL vector matches WebCrypto encryption and decryption', async () => {
    const { record } = await encryptFragment(vector.fragment, decodeKey(vector.key), new Uint8Array(Buffer.from(vector.iv, 'hex')));
    assert.equal(Buffer.from(record).toString('base64'), vector.record);
    assert.equal(await decryptFragment(record, decodeKey(vector.key)), vector.fragment);
  });
}
test('padding edges, largest input and hard allocation bound', async () => {
  for (const length of [1, 1023, 1024, 1025, MAX_FRAGMENT_BYTES]) {
    const fragment = 'a'.repeat(length);
    const { record, key } = await encryptFragment(fragment);
    assert.equal(record.length, (Math.floor(length / 1024) + 1) * 1024 + 29);
    assert(record.length <= MAX_RECORD_BYTES);
    assert.equal(await decryptFragment(record, decodeKey(key)), fragment);
  }
  for (const bad of ['', 'x'.repeat(MAX_FRAGMENT_BYTES + 1), 'x#other', 'x\n', 'x%', 'x%0', '<script>', 'é']) {
    await assert.rejects(encryptFragment(bad));
  }
});
test('authentication rejects wrong key, tampering, version and truncation', async () => {
  const { record, key } = await encryptFragment('xt=test');
  await assert.rejects(decryptFragment(record, new Uint8Array(16)));
  for (const offset of [0, 1, 30, record.length - 1]) {
    const bad = record.slice(); bad[offset] ^= 1;
    await assert.rejects(decryptFragment(bad, decodeKey(key)));
  }
  await assert.rejects(decryptFragment(record.slice(1), decodeKey(key)));
});
test('authenticated hostile plaintext still fails padding and fragment validation', async () => {
  const key = Buffer.alloc(16); const iv = Buffer.alloc(12);
  for (const text of ['xt=good#bad', 'javascript:alert(1)\n', 'xt=%oops', 'xt=<script>', null]) {
    const padded = Buffer.alloc(1024);
    if (text !== null) { padded.write(text); padded[Buffer.byteLength(text)] = 0x80; }
    const cipher = createCipheriv('aes-128-gcm', key, iv);
    cipher.setAAD(Buffer.from('jstorrent-link-v1'));
    const record = Buffer.concat([Buffer.from([1]), iv, cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
    await assert.rejects(decryptFragment(record, key));
  }
});
test('short URL parser bounds IDs and requires canonical 128-bit keys', () => {
  const key = vectors[0].key;
  assert.equal(parseShortLinkFragment('#Abcd012345.' + key).id, 'Abcd012345');
  for (const bad of ['', '#a.' + key, '#Abcd012345.' + key + 'x', '#Abcd012345.' + key + '/other', '#Abcd012345.' + 'A'.repeat(21) + 'B']) {
    assert.throws(() => parseShortLinkFragment(bad));
  }
});
