import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { marketingPolicy, writeWebsiteHeaders } from './website-security.mjs';

test('only the exact trusted inline script bytes receive CSP authority', () => {
  const body = "\nconsole.log('theme');\n";
  const hash = createHash('sha256').update(body).digest('base64');
  const policy = marketingPolicy(`<script>${body}</script><script src="/external.js"></script><script type="application/json">{}</script>`);
  assert(policy.includes(`'sha256-${hash}'`));
  assert.equal([...policy.matchAll(/sha256-/g)].length, 1);
  assert(!marketingPolicy(`<script>${body.trim()}</script>`).includes(hash));
  assert(!/script-src[^;]*(unsafe-inline|unsafe-eval)/.test(policy));
  assert(policy.includes("script-src-attr 'none'"));
});

test('marketing headers never hash or broaden the remote client policy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'website-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = "/*\n  Content-Security-Policy: script-src 'none'\n\n/remote/*\n  ! Content-Security-Policy\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'\n";
  await writeFile(join(root, '_headers'), original);
  await writeFile(join(root, 'index.html'), '<script>trusted()</script>');
  await mkdir(join(root, 'remote'));
  await writeFile(join(root, 'remote/index.html'), '<script>remote()</script>');
  await mkdir(join(root, 'blog'));
  await writeFile(join(root, 'blog/index.html'), '<html>Blog</html>');
  assert.equal(await writeWebsiteHeaders(root), 2);
  const output = await readFile(join(root, '_headers'), 'utf8');
  assert(output.startsWith(original));
  assert(!output.includes(createHash('sha256').update('remote()').digest('base64')));
  assert(output.includes('\n/\n'));
  assert(output.includes('\n/blog/\n'));
});
