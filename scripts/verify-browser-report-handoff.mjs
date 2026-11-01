#!/usr/bin/env node
// Candidate or deployed website in bundled Chromium. No app or swarm.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../clients/web/node_modules/playwright-core/index.mjs';

const archive = process.argv[2];
assert(archive, 'Usage: node scripts/verify-browser-report-handoff.mjs EXTENSION.zip [--live] [--deployed]');
const deployed = process.argv.includes('--deployed');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'jstorrent-handoff-'));
let browser;
try {
  const extension = path.join(temporary, 'extension');
  execFileSync('unzip', ['-q', path.resolve(archive), '-d', extension]);
  const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json')));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/gu, nibble => String.fromCharCode(97 + parseInt(nibble, 16)));
  const handoffPaths = new Set(['/chrome-extension', '/chrome-extension.html']);
  if (deployed) assert.equal(id, 'dbokmlpefliilbjldladbimlcfgbolhk', 'Deployed verification requires the production extension identity');
  for (const pathname of handoffPaths) assert(manifest.externally_connectable.matches.includes('https://jstorrent.com' + pathname));
  if (process.argv.includes('--live')) {
    const response = await fetch('https://jstorrent.com/chrome-extension.html', { signal: AbortSignal.timeout(15_000) });
    assert(response.ok);
    assert(handoffPaths.has(new URL(response.url).pathname));
    console.log('PASS live redirect destination: ' + response.url);
  }
  browser = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  if (deployed) await browser.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'https://jstorrent.com' || url.protocol === 'chrome-extension:'
      ? route.continue() : route.abort();
  });
  else await browser.route('https://jstorrent.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/chrome-extension.html') return route.fulfill({ status: 302, headers: { location: '/chrome-extension' } });
    const file = ({ '/chrome-extension': 'chrome-extension.html', '/launch': 'launch.html', '/add/': 'add/index.html' })[pathname] ?? pathname.slice(1);
    const allowed = new Set(['chrome-extension.html', 'chrome-extension.js', 'chrome-extension.css', 'launch.html', 'add/index.html', 'add/index.js', 'js-32.png', 'favicon.ico']);
    if (!allowed.has(file)) return route.fulfill({ status: 404, body: '' });
    let body = readFileSync(path.join(root, 'website/public', file));
    if (file === 'chrome-extension.js') body = Buffer.from(body.toString().replaceAll('dbokmlpefliilbjldladbimlcfgbolhk', id));
    return route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html', body });
  });
  const popup = await browser.newPage();
  // Keep the host's native setup out of this disposable browser smoke.
  await popup.addInitScript(() => { chrome.runtime.getPlatformInfo = async () => ({ os: 'cros' }); });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const page = await browser.newPage();
  await page.goto('https://jstorrent.com/chrome-extension.html');
  await page.getByText('The extension is open. Continue there; Android approval may still be needed.', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/chrome-extension');
  assert(browser.pages().some(p => p.url().includes('/companion/companion.html')));
  console.log(`PASS ${deployed ? 'deployed' : 'candidate'} redirected website opens installed candidate extension`);
  const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
  await page.goto('https://jstorrent.com/launch#magnet=' + encodeURIComponent(magnet));
  const confirm = page.getByRole('button', { name: 'Add Torrent', exact: true });
  if (await confirm.isVisible()) await confirm.click();
  await page.getByText(/This older launch page could not connect/).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Magnet link' }).inputValue(), magnet);
  await page.goto('https://jstorrent.com/add/#magnet_uri=' + encodeURIComponent(magnet));
  await page.getByText(/This older download page cannot determine/).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Magnet link' }).inputValue(), magnet);
  assert.doesNotMatch(await page.locator('#status').innerText(), /Torrent Added|JSTorrent is not installed/);
  console.log('PASS legacy recovery preserves input without false installation or success claims');
  for (const companion of browser.pages().filter(candidate => candidate.url().includes('/companion/companion.html'))) await companion.close();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'productMetrics', op: 'support', failure: 'none' }));
  const pending = await browser.newPage();
  await pending.addInitScript(() => {
    // Inject an unreachable Android service while retaining the actual worker,
    // storage and report URL generation. Never contact an installed app.
    chrome.permissions.contains = async () => true;
    globalThis.fetch = async () => { throw new TypeError('controlled offline fixture'); };
  });
  await pending.goto(`chrome-extension://${id}/companion/companion.html`);
  await pending.waitForFunction(async () => (await chrome.storage.session.get('supportContextV1')).supportContextV1?.failure === 'connecting');
  assert.equal(await pending.locator('#companion-bootstrap').isVisible(), true);
  assert.equal(await pending.locator('#app').evaluate(element => element.childElementCount), 0);
  await pending.close();
  const unfinished = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'productMetrics', op: 'feedback' }));
  assert.equal(new URL(unfinished.state.url).searchParams.get('failure'), 'connecting');
  console.log('PASS real worker retains unfinished Android connection after page closes');
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const native = chrome.runtime.sendNativeMessage.bind(chrome.runtime);
    // Exercise a real Chrome missing-host error without launching a native app.
    chrome.runtime.sendNativeMessage = (_host, request, callback) => native('com.jstorrent.repro_missing_host', request, callback);
  });
  const desktop = await browser.newPage();
  await desktop.addInitScript(() => { chrome.runtime.getPlatformInfo = async () => ({ os: 'win' }); });
  await desktop.goto(`chrome-extension://${id}/popup/popup.html`);
  await desktop.waitForFunction(async () => (await chrome.storage.session.get('supportContextV1')).supportContextV1?.failure === 'native_host_unavailable');
  const missing = await desktop.evaluate(() => chrome.runtime.sendMessage({ type: 'productMetrics', op: 'feedback' }));
  assert.equal(new URL(missing.state.url).searchParams.get('failure'), 'native_host_unavailable');
  await desktop.close();
  console.log('PASS real missing-native-host error survives Windows popup reporting');
  const report = await popup.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'productMetrics', op: 'support', failure: 'permission_denied' });
    return chrome.runtime.sendMessage({ type: 'productMetrics', op: 'feedback' });
  });
  const reportUrl = new URL(report.state.url);
  assert.equal(reportUrl.searchParams.get('failure'), 'permission_denied');
  assert.equal(reportUrl.searchParams.get('entry'), 'popup/popup.html');
  assert.equal(reportUrl.searchParams.get('extv'), manifest.version);
  assert(reportUrl.searchParams.has('chrome'));
  const optedOut = await popup.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'productMetrics', op: 'acknowledge', enabled: false });
    return chrome.runtime.sendMessage({ type: 'productMetrics', op: 'feedback' });
  });
  assert.deepEqual([...new URL(optedOut.state.url).searchParams.keys()], ['v']);
  console.log('PASS real worker report context and statistics opt-out');
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
