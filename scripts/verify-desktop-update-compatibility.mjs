#!/usr/bin/env node
// Opt-in, already-owned test browser in a claimed guest; never personal data.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.RSTORRENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.RSTORRENT_PLAYWRIGHT_MODULE).href
  : new URL('../clients/web/node_modules/playwright-core/index.mjs', import.meta.url).href);
const [phase = 'inspect', baselinePath] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(process.env.RSTORRENT_TEST_CDP ?? 'http://127.0.0.1:9222');
const url = 'chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/companion/companion.html?backend=desktop';
try {
  const context = browser.contexts()[0];
  let page = context.pages().find(candidate => candidate.url() === url);
  assert(page, 'open the controlled desktop companion first');
  if (phase === 'reload-extension') {
    await page.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1000));
    page = context.pages().find(candidate => candidate.url() === url) ?? await context.newPage();
    await page.goto(url);
    await page.locator('[data-connection="connected"]').waitFor();
    console.log(JSON.stringify({ phase, reopened: true }));
  } else if (phase === 'refused') {
    await page.reload();
    await page.getByRole('button', { name: 'Retry connection', exact: true }).waitFor();
    assert.match(await page.locator('#companion-status').innerText(), /incompatible.*Update/);
    assert(await page.locator('#app').isHidden());
    await page.waitForTimeout(8000);
    assert(await page.getByRole('button', { name: 'Retry connection', exact: true }).isEnabled());
    console.log(JSON.stringify({ phase, observationSeconds: 8, applicationHidden: true, retryVisible: true }));
  } else if (phase === 'retry-refused') {
    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await page.waitForTimeout(1000);
    assert(await page.getByRole('button', { name: 'Retry connection', exact: true }).isEnabled());
    assert(await page.locator('#app').isHidden());
    console.log(JSON.stringify({ phase, stillRefused: true }));
  } else if (phase === 'retry-repaired') {
    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await page.locator('[data-connection="connected"]').waitFor();
    console.log(JSON.stringify({ phase, attached: true }));
  } else {
    await page.locator('[data-connection="connected"]').waitFor();
    const observed = await page.evaluate(async () => {
      globalThis.compatibilityDocument ??= crypto.randomUUID();
      const bootstrap = await chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' });
      if (!bootstrap.ok) throw new Error('attach refused');
      const ready = bootstrap.result;
      const socket = new WebSocket(ready.endpoint.replace('http:', 'ws:') + '/api/v1/connect');
      const frames = [];
      let pending;
      socket.onmessage = event => {
        const frame = JSON.parse(event.data);
        if (pending) { const callback = pending; pending = undefined; callback(frame); }
        else frames.push(frame);
      };
      const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending = undefined; reject(new Error('response deadline')); }, 6000);
        pending = value => { clearTimeout(timer); resolve(value); };
      });
      try {
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('socket failed')); });
        socket.send(JSON.stringify({ type: 'connect', api_version: 1, encoding: 'json', client_instance_id: crypto.randomUUID().replaceAll('-', ''), token: ready.credential }));
        const hello = await next();
        if (hello.type !== 'connected' || hello.hello.backend.instance_id !== ready.instanceId) throw new Error('runtime identity mismatch');
        socket.send(JSON.stringify({ type: 'call', call_id: 'snapshot', operation: { type: 'dispatch', request: { version: 1, request_id: crypto.randomUUID(), command: { type: 'snapshot' } } } }));
        const response = await next();
        const snapshot = response.result?.response?.snapshot;
        if (!snapshot) throw new Error('snapshot missing');
        return { document: globalThis.compatibilityDocument, instance: ready.instanceId, library: {
          roots: snapshot.storage.roots.map(root => ({ id: root.root_id, availability: root.availability })),
          torrents: snapshot.torrents.map(torrent => ({ id: torrent.torrent_id, identities: torrent.protocol_identities,
            root: torrent.storage_root, state: torrent.state, running: torrent.desired_running,
            verifiedPieces: torrent.verified_piece_count, pieces: torrent.piece_count })),
        } };
      } finally { socket.close(); }
    });
    assert.equal(observed.library.roots.length, 1);
    assert.equal(observed.library.torrents.length, 1);
    assert.equal(observed.library.torrents[0].running, false);
    if (phase === 'record') {
      assert(baselinePath);
      writeFileSync(baselinePath, JSON.stringify(observed), { flag: 'wx', mode: 0o600 });
    } else if (phase.startsWith('assert')) {
      assert(baselinePath);
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      assert.deepEqual(observed.library, baseline.library);
      if (phase === 'assert-open-page') assert.equal(observed.document, baseline.document);
      if (phase === 'assert-same-runtime') assert.equal(observed.instance, baseline.instance);
      else assert.notEqual(observed.instance, baseline.instance);
    } else assert.equal(phase, 'inspect');
    console.log(JSON.stringify({ phase, instance: observed.instance, library: observed.library,
      ...(phase.startsWith('assert') ? { preserved: true } : {}) }));
  }
} finally { await browser.close(); }
