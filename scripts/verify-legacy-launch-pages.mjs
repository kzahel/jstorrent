// Assembled compatibility routes, using an independently identified test browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from '../clients/web/node_modules/playwright-core/index.mjs';
const root = resolve('website/dist');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) throw Error('outside site');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
    response.setHeader('Content-Type', types[file.split('.').at(-1)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { executablePath: process.argv[2] } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.handlerCalls = [];
    navigator.registerProtocolHandler = () => { throw Error('obsolete registration attempted'); };
    navigator.unregisterProtocolHandler = (...args) => window.handlerCalls.push(args);
    window.chrome = { runtime: { sendMessage() { throw Error('obsolete extension messaging attempted'); } } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&tr=https%3A%2F%2Fexample.invalid%2Fa%3Fx%3D1%26y%3D2&dn=space+%E2%98%83';
  let routes = 0;
  for (const path of ['/add/', '/launch/', '/launch.html', '/launch-test.html', '/testmagnet.html', '/magnet/', '/magnet/setup/', '/magnet/setup.html', '/magnet/test.html']) {
    const fragment = '#magnet_uri=' + encodeURIComponent(magnet);
    await page.goto(origin + path + fragment);
    await page.locator('#launch-magnet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#launch-magnet').inputValue(), magnet);
    assert.equal(new URL(await page.locator('#launch-open').getAttribute('href')).searchParams.get('magnet'), magnet);
    assert.equal(new URL(page.url()).hash, fragment);
    assert.equal(await page.evaluate(() => window.handlerCalls.length), 0);
    routes++;
  }
  await page.locator('#launch-cleanup').click();
  assert.deepEqual(await page.evaluate(() => window.handlerCalls), [
    ['magnet', origin + '/add/#magnet_uri=%s'], ['magnet', origin + '/share/#magnet_uri=%s'],
  ]);
  await page.goto(origin + '/launch.html?token=obsolete&desktop=true&magnet=' + encodeURIComponent(magnet));
  await page.locator('#launch-magnet').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#launch-magnet').inputValue(), magnet);
  assert.ok(!(await page.locator('#launch-open').getAttribute('href')).includes('token'));
  for (const input of ['?torrentPath=C%3A%5Csecret.torrent&token=obsolete', '#magnet=javascript%3Aalert(1)', '#magnet=%FF']) {
    await page.goto(origin + '/launch/' + input);
    await page.waitForFunction(() => document.querySelector('#launch-open')?.getAttribute('href') === 'jstorrent://launch');
    assert.equal(await page.locator('#launch-input').isVisible(), false);
    assert.ok(page.url().includes('/launch/'));
  }
  await page.goto(origin + '/share/#magnet=' + encodeURIComponent(magnet));
  await page.locator('#share-ready').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#share-open').getAttribute('href'), magnet);
  assert.equal(new URL(await page.locator('#share-desktop').getAttribute('href')).searchParams.get('magnet'), magnet);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ routes, queryAlias: true, untrustedInputs: 3, nativeEscape: true, exactCleanup: true, pageErrors: 0 }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
