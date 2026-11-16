// Command-driven Windows qualification. Build only with the isolated identity:
// TAURI_CONFIG={identifier:com.jstorrent.qualification.handlers,
// productName:JSTorrent Handler Qualification,plugins:{deep-link:{desktop:{schemes:[magnet,jstorrent]}}}}
// The ordinary shipping binary is never launched by this runner.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '../clients/web/node_modules/playwright-core/index.mjs';
assert.equal(process.platform, 'win32');
const executable = resolve(process.argv[2] ?? 'target/debug/jstorrent-client.exe');
assert.ok(executable.startsWith(resolve('target/debug') + '\\'), 'use the isolated debug candidate');
const directory = await mkdtemp(resolve(tmpdir(), 'jstorrent-launch-intake-'));
const registry = () => {
  const result = spawnSync('python.exe', ['scripts/diagnose-windows-handlers.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
};
const before = registry();
const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&tr=https%3A%2F%2Fexample.invalid%2Fa%3Fx%3D1%26y%3D2&dn=space+%E2%98%83';
const envelope = 'jstorrent://launch?magnet=' + encodeURIComponent(magnet);
const children = [];
let browser;
let output = '';
const env = { ...process.env, RSTORRENT_DESKTOP_DATA_ROOT: directory,
  WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview') };
async function waitFor(callback, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await callback().catch(() => null);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('native launch qualification deadline expired');
}
async function launch(args) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes.toString()).slice(-16000); });
  child.on('error', error => { output += error.message; });
  return child;
}
async function stop() {
  await browser?.close().catch(() => {}); browser = null;
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise(resolve => child.once('close', resolve));
    }
  }
}
async function attach() {
  await waitFor(async () => (await fetch('http://127.0.0.1:' + env.JSTORRENT_TEST_PORT + '/json/version')).ok);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + env.JSTORRENT_TEST_PORT);
  const page = await waitFor(async () => browser.contexts()[0]?.pages().find(page => !page.url().startsWith('devtools:')));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
  assert.equal(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|name')), 'JSTorrent Handler Qualification');
  return page;
}
const pull = page => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_external_intake_pull'));
async function pending(page, kind) {
  const snapshot = await waitFor(async () => { const state = await pull(page); return state.pending.length ? state : null; });
  assert.equal(snapshot.pending.length, 1, 'one pending item despite plugin/startup duplicate delivery');
  assert.equal(snapshot.pending[0].kind, kind);
  await page.getByRole('dialog').first().waitFor({ state: 'visible' });
  await page.evaluate(id => window.__TAURI_INTERNALS__.invoke('desktop_external_intake_cancel', { activationId: id }), snapshot.pending[0].id);
  await waitFor(async () => (await pull(page)).pending.length === 0);
}
try {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  env.JSTORRENT_TEST_PORT = String(listener.address().port);
  await new Promise(resolve => listener.close(resolve));
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=' + env.JSTORRENT_TEST_PORT;
  await launch([envelope, magnet]);
  let page = await attach();
  await pending(page, 'magnet');
  await launch([envelope, envelope]);
  await pending(page, 'magnet');
  const file = resolve(directory, 'space and ☃.torrent');
  await writeFile(file, 'de'); // No confirmation: the file is never parsed/added.
  await launch([file]);
  await pending(page, 'torrent_file');
  const generation = (await pull(page)).generation;
  await launch(['jstorrent://launch?torrentPath=' + encodeURIComponent(file)]);
  await waitFor(async () => (await pull(page)).generation !== generation);
  assert.equal((await pull(page)).pending.length, 0);
  assert.equal(browser.contexts()[0].pages().filter(page => !page.url().startsWith('devtools:')).length, 1);
  await stop();
  // A fresh process owns the background host. The bare legacy URL opens its window.
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = identity.stdout.match(/S-1-[0-9-]+/)?.[0];
  assert.ok(sid);
  const pipe = 'rstorrent-desktop-v1-' + createHash('sha256').update(sid)
    .update(Buffer.from(resolve(directory, 'config/native-host/desktop-control-v1.sock'), 'utf16le')).digest('hex');
  await launch(['--extension-background']);
  await waitFor(async () => (await readdir('\\\\.\\pipe\\')).includes(pipe));
  await launch(['jstorrent://launch']);
  page = await attach();
  assert.equal((await pull(page)).pending.length, 0);
  await launch([envelope]);
  await pending(page, 'magnet');
  await stop();
  assert.deepEqual(registry(), before, 'qualification must leave installed registrations unchanged');
  console.log(JSON.stringify({ cold: true, warm: true, unicodeFile: true, duplicates: true, backgroundBareLaunch: true, backgroundMagnet: true, pathRefused: true, installedRegistrationsUnchanged: true }));
} catch (error) {
  // No input is intentionally logged; these are only bounded process diagnostics.
  console.error(output.replaceAll(magnet, '<magnet>').replaceAll(envelope, '<launch>'));
  throw error;
} finally {
  await stop();
  assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
  assert.ok(basename(directory).startsWith('jstorrent-launch-intake-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
