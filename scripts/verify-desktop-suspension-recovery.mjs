#!/usr/bin/env node
// Opt-in runner for a claimed guest, owned test browser and private fixture only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.RSTORRENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.RSTORRENT_PLAYWRIGHT_MODULE).href
  : new URL('../clients/web/node_modules/playwright-core/index.mjs', import.meta.url).href);
const [phase, baselinePath, payloadPath] = process.argv.slice(2);
assert(['limit', 'unlimit', 'record', 'recover', 'complete'].includes(phase));
const browser = await chromium.connectOverCDP(process.env.RSTORRENT_TEST_CDP ?? 'http://127.0.0.1:9222');
const url = 'chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/companion/companion.html?backend=desktop';
try {
  const context = browser.contexts()[0];
  let page = context.pages().find(candidate => candidate.url() === url);
  if (!page) { page = await context.newPage(); await page.goto(url); }
  // Opening/restoring this page attaches only, including after browser restart.
  await page.locator('[data-connection="connected"]').waitFor({ timeout: 25_000 });
  const deadline = Date.now() + 180_000;
  let observed;
  do {
    observed = await page.evaluate(async phase => {
      const bootstrap = await chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' });
      if (!bootstrap.ok) throw new Error('attach refused');
      const ready = bootstrap.result;
      const socket = new WebSocket(ready.endpoint.replace('http:', 'ws:') + '/api/v1/connect');
      const frames = []; let pending;
      socket.onmessage = event => {
        const frame = JSON.parse(event.data);
        if (pending) { const resolve = pending; pending = undefined; resolve(frame); }
        else frames.push(frame);
      };
      const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending = undefined; reject(new Error('response deadline')); }, 6000);
        pending = frame => { clearTimeout(timer); resolve(frame); };
      });
      try {
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('socket failed')); });
        socket.send(JSON.stringify({ type: 'connect', api_version: 1, encoding: 'json', client_instance_id: crypto.randomUUID().replaceAll('-', ''), token: ready.credential }));
        const hello = await next();
        if (hello.type !== 'connected' || hello.hello.backend.instance_id !== ready.instanceId) throw new Error('identity mismatch');
        let call = 0;
        const dispatch = async command => {
          socket.send(JSON.stringify({ type: 'call', call_id: String(++call), operation: { type: 'dispatch', request: { version: 1, request_id: crypto.randomUUID(), command } } }));
          const reply = await next();
          if (reply.type !== 'result' || reply.error || reply.result?.error) throw new Error('command refused');
          return reply.result;
        };
        if (phase === 'limit' || phase === 'unlimit') await dispatch({ type: 'update_client_settings', patch: {
          download_rate_limit: phase === 'limit' ? { type: 'limited', bytes_per_second: 65536 } : { type: 'unlimited' },
        } });
        const result = await dispatch({ type: 'snapshot' });
        const state = result.response?.snapshot;
        if (!state) throw new Error('snapshot missing');
        return { instance: ready.instanceId, roots: state.storage.roots.map(root => root.root_id),
          torrents: state.torrents.map(torrent => ({ id: torrent.torrent_id, identity: torrent.protocol_identities.v1,
            root: torrent.storage_root, running: torrent.desired_running, pieces: torrent.piece_count,
            verified: torrent.verified_piece_count })) };
      } finally { socket.close(); }
    }, phase);
    const transfer = observed.torrents.find(torrent => torrent.identity === '5b6fd1f3a92b3661ecfef63f4412edfaea3d48c4');
    if (phase === 'limit' || phase === 'unlimit') break;
    assert(transfer, 'controlled transfer missing');
    assert.equal(transfer.pieces, 512);
    assert.equal(transfer.running, true);
    if (phase === 'record') {
      if (transfer.verified === 0 && Date.now() < deadline) { await page.waitForTimeout(1000); continue; }
      assert(transfer.verified > 0 && transfer.verified < 512, 'must suspend a partially verified transfer');
      writeFileSync(baselinePath, JSON.stringify(observed), { flag: 'wx', mode: 0o600 });
    } else {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      assert.equal(observed.instance, baseline.instance, 'passive recovery replaced the runtime');
      assert.deepEqual(observed.roots, baseline.roots);
      assert.deepEqual(observed.torrents.map(({ verified, ...rest }) => rest), baseline.torrents.map(({ verified, ...rest }) => rest));
      for (const before of baseline.torrents) assert(observed.torrents.find(torrent => torrent.id === before.id).verified >= before.verified);
      if (phase === 'complete') {
        if (transfer.verified !== 512 && Date.now() < deadline) { await page.waitForTimeout(1000); continue; }
        assert.equal(transfer.verified, 512);
        const bytes = readFileSync(payloadPath);
        assert.equal(bytes.length, 33554432);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), '99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8');
      }
    }
    break;
  } while (true);
  console.log(JSON.stringify({ phase, ...observed, ...(phase === 'complete' ? { independentlyVerifiedBytes: 33554432 } : {}) }));
} finally { await browser.close(); }
