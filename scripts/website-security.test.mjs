import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromeExtensionPolicy, marketingPolicy, writeWebsiteHeaders } from './website-security.mjs';

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
  await writeFile(join(root, 'index.html'), '<html><head><script>trusted()</script></head><body>Home</body></html>');
  await mkdir(join(root, 'remote'));
  const remote = '<html><head><script>remote()</script></head></html>';
  await writeFile(join(root, 'remote/index.html'), remote);
  await mkdir(join(root, 'blog'));
  await writeFile(join(root, 'blog/index.html'), '<html>Blog</html>');
  assert.equal(await writeWebsiteHeaders(root), 2);
  const output = await readFile(join(root, '_headers'), 'utf8');
  assert(output.startsWith(original));
  assert(!output.includes(createHash('sha256').update('remote()').digest('base64')));
  assert(output.includes('\n/\n'));
  assert(output.includes('\n/blog/\n'));
  const home = await readFile(join(root, 'index.html'), 'utf8');
  assert(home.indexOf('http-equiv="Content-Security-Policy"') < home.indexOf('<script>'));
  assert(home.includes("form-action 'none'"));
  assert(!home.includes('frame-ancestors'));
  assert.equal(await readFile(join(root, 'remote/index.html'), 'utf8'), remote);
});

test('static hosts retain retired prototype guidance without an open redirect', async t => {
  const root = await mkdtemp(join(tmpdir(), 'website-redirect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '_headers'), "/*\n  Content-Security-Policy: script-src 'none'\n");
  await writeFile(join(root, '_redirects'), '/comingsoon.html /#download 301\n/comingsoon /#download 301\n');
  assert.equal(await writeWebsiteHeaders(root), 3);
  for (const path of ['comingsoon.html', 'comingsoon/index.html']) {
    const html = await readFile(join(root, path), 'utf8');
    assert(html.includes('0;url=https://jstorrent.com/#download'));
    assert(html.includes('http-equiv="Content-Security-Policy"'));
    assert(!html.includes('<script'));
  }
  await writeFile(join(root, '_redirects'), '/comingsoon.html https://unexpected.example 301\n');
  await assert.rejects(writeWebsiteHeaders(root), /Unexpected retired prototype redirect/);
});

test('Android handoff gets local-only document and header policy without analytics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'website-handoff-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '_headers'), "/*\n  Referrer-Policy: strict-origin-when-cross-origin\n");
  await writeFile(join(root, 'chrome-extension.html'), '<html><head><script type="module" src="/chrome-extension.js"></script></head></html>');
  await writeWebsiteHeaders(root);
  const html = await readFile(join(root, 'chrome-extension.html'), 'utf8');
  const headers = await readFile(join(root, '_headers'), 'utf8');
  assert(html.includes(chromeExtensionPolicy().replace("; frame-ancestors 'none'", '')));
  assert(headers.includes(chromeExtensionPolicy()));
  assert(headers.includes('Referrer-Policy: no-referrer'));
  assert(headers.includes('Cache-Control: no-store'));
  assert(!html.includes('analytics'));
  assert(!headers.includes('analytics'));
});
