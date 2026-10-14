#!/usr/bin/env node
// Run only inside a claimed disposable desktop testbed with a controlled library.
// Connects to an already-owned Chrome for Testing; never starts a host browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const playwrightModule = process.env.RSTORRENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.RSTORRENT_PLAYWRIGHT_MODULE).href
  : new URL('../clients/web/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(playwrightModule);
const phase = process.argv[2] ?? 'inspect';
const fixtureName = process.env.RSTORRENT_TEST_TORRENT_NAME ?? 'checkpoint.bin';
const browser = await chromium.connectOverCDP(process.env.RSTORRENT_TEST_CDP ?? 'http://127.0.0.1:9222');
try {
  const context = browser.contexts()[0];
  let page = context.pages().find(page => page.url().endsWith('companion/companion.html?backend=desktop'));
  if (phase === 'open') {
    const popup = await context.newPage();
    await popup.goto('chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/popup/popup.html');
    // A tab is deliberately not a toolbar action. Exercise its explicit button.
    await popup.locator('#launch').click();
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { clearInterval(poll); reject(new Error('companion did not open')); }, 20000);
      const poll = setInterval(() => {
        page = context.pages().find(candidate => candidate.url().endsWith('companion/companion.html?backend=desktop'));
        if (page) { clearInterval(poll); clearTimeout(deadline); resolve(); }
      }, 100);
    });
    // The launcher tab is no longer needed after its explicit action.
    await popup.close();
    await page.locator('[data-connection="connected"]').waitFor({ timeout: 20000 });
    console.log(JSON.stringify({ phase, connected: true }));
  }
  assert(page, 'open the packaged desktop companion in the owned test browser first');
  if (phase === 'picker') {
    if (!(await page.getByRole('dialog').isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await page.getByRole('button', { name: 'Add folder…', exact: true }).click();
    console.log(JSON.stringify({ phase, requested: true }));
  } else if (phase === 'picker-cancelled') {
    await page.getByText('Folder selection canceled', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Add folder…', exact: true }).isEnabled());
    console.log(JSON.stringify({ phase, cancelled: true }));
  } else if (phase === 'close-settings') {
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  } else if (phase === 'detach') {
    await page.close();
    console.log(JSON.stringify({ phase, detached: true }));
  } else if (phase === 'transfer') {
    assert(process.env.RSTORRENT_TEST_TORRENT_FILE, 'provide the controlled torrent file');
    await page.locator('input[type="file"][accept=".torrent,application/x-bittorrent"]').setInputFiles(process.env.RSTORRENT_TEST_TORRENT_FILE);
    await page.getByRole('row').filter({ hasText: fixtureName }).waitFor();
    console.log(JSON.stringify({ phase, fixtureName, added: true }));
  } else if (phase === 'complete') {
    await page.getByRole('row').filter({ hasText: fixtureName }).filter({ hasText: /complete|seeding/i }).waitFor({ timeout: 180_000 });
    console.log(JSON.stringify({ phase, fixtureName, completed: true }));
  } else if (phase === 'remember') {
    await page.evaluate(async () => { const response = await chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' }); if (!response.ok) throw new Error('attach failed'); globalThis.checkpointPreviousReady = response.result; });
    console.log(JSON.stringify({ phase, retainedOnlyInPageMemory: true }));
  } else if (phase === 'ui-running') {
    await page.getByRole('row').filter({ hasText: fixtureName }).filter({ hasText: /downloading|complete|seeding/i }).waitFor();
    console.log(JSON.stringify({ phase, converged: true }));
  } else if (phase === 'add') {
    const payload = Buffer.alloc(4096, 0x32);
    const digest = createHash('sha1').update(payload).digest();
    const info = Buffer.concat([Buffer.from('d6:lengthi4096e4:name14:checkpoint.bin12:piece lengthi16384e6:pieces20:'), digest, Buffer.from('7:privatei1ee')]);
    const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
    await page.locator('input[type="file"][accept=".torrent,application/x-bittorrent"]').setInputFiles({ name: 'checkpoint.torrent', mimeType: 'application/x-bittorrent', buffer: torrent });
    await page.getByRole('row').filter({ hasText: fixtureName }).waitFor();
    console.log(JSON.stringify({ phase, infoHash: createHash('sha1').update(info).digest('hex'), bytes: payload.length }));
  } else if (['pause', 'resume'].includes(phase)) {
    await page.getByRole('row').filter({ hasText: fixtureName }).click();
    await page.getByRole('button', { name: phase === 'pause' ? 'Pause' : 'Start', exact: true }).click();
    await page.getByRole('row').filter({ hasText: fixtureName }).filter({ hasText: phase === 'pause' ? 'Paused' : /downloading|complete|seeding/i }).waitFor();
    console.log(JSON.stringify({ phase, converged: true }));
  } else if (phase === 'native') {
    await page.getByRole('button', { name: 'Open desktop window', exact: true }).click();
    console.log(JSON.stringify({ phase, requested: true }));
  } else if (phase === 'race') {
    const result = await page.evaluate(async () => {
      const values = await Promise.all(Array.from({ length: 12 }, (_, i) => chrome.runtime.sendNativeMessage('com.jstorrent.rstorrent.native', { id: `race-${i}`, protocolVersion: 1, op: 'start_control' })));
      return values.map(value => ({ ok: value.ok, instanceId: value.result?.instanceId, error: value.error }));
    });
    assert(result.every(value => value.ok && value.instanceId), JSON.stringify(result));
    assert.equal(new Set(result.map(value => value.instanceId)).size, 1);
    console.log(JSON.stringify({ phase, requests: result.length, instances: 1, instanceId: result[0].instanceId }));
  } else if (phase === 'clicks') {
    const response = await page.evaluate(async () => Promise.all(Array.from({ length: 12 }, () => chrome.runtime.sendMessage({ type: 'desktopBootstrap', op: 'open' }))));
    assert(response.every(value => value.ok), JSON.stringify(response.map(value => ({ ok: value.ok, error: value.error }))));
    assert.equal(context.pages().filter(page => page.url().endsWith('companion/companion.html?backend=desktop')).length, 1);
    await page.waitForFunction(async () => {
      const tab = await chrome.tabs.getCurrent();
      return tab.active && (await chrome.windows.get(tab.windowId)).focused;
    });
    console.log(JSON.stringify({ phase, clicks: 12, pages: 1, activeTab: true, focusedWindow: true }));
  } else if (phase === 'stopped') {
    await page.waitForTimeout(35_000);
    const result = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' }));
    assert.equal(result.ok, false);
    assert(await page.getByRole('button', { name: 'Start', exact: true }).isVisible());
    console.log(JSON.stringify({ phase, attachRefused: true, explicitStartVisible: true, observationSeconds: 35 }));
  } else if (phase === 'start') {
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.locator('[data-connection="connected"]').waitFor({ timeout: 20_000 });
    console.log(JSON.stringify({ phase, connected: true }));
  } else {
    const report = await page.evaluate(async (phase) => {
      const bootstrap = await chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' });
      if (!bootstrap.ok) throw new Error('running desktop bootstrap failed');
      const ready = bootstrap.result;
      const socket = new WebSocket(ready.endpoint.replace('http:', 'ws:') + '/api/v1/connect');
      const frames = [];
      let waiter;
      socket.onmessage = event => { const value = JSON.parse(event.data); if (waiter) { const resolve = waiter; waiter = undefined; resolve(value); } else frames.push(value); };
      const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { waiter = undefined; reject(new Error('application response timed out')); }, 6000);
        waiter = value => { clearTimeout(timeout); resolve(value); };
      });
      await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('socket failed')); });
      try {
        socket.send(JSON.stringify({ type: 'connect', api_version: 1, encoding: 'json', client_instance_id: crypto.randomUUID().replaceAll('-', ''), token: phase === 'invalid' ? 'invalid' : phase === 'stale' ? globalThis.checkpointPreviousReady.credential : ready.credential }));
        const hello = await next();
        if (phase === 'invalid' || phase === 'stale') return { rejected: hello.error?.code === 'authentication_failed', libraryDisclosed: !!hello.hello };
        if (hello.type !== 'connected' || hello.hello.backend.instance_id !== ready.instanceId) throw new Error('identity mismatch');
        let call = 0;
        const dispatch = async command => {
          socket.send(JSON.stringify({ type: 'call', call_id: `call-${++call}`, operation: { type: 'dispatch', request: { version: 1, request_id: crypto.randomUUID(), command } } }));
          const reply = await next();
          if (reply.type !== 'result') throw new Error(JSON.stringify(reply));
          return reply.result;
        };
        if (phase === 'prepare' || phase === 'prepare-limited') {
          await dispatch({ type: 'update_client_settings', patch: { dht_enabled: false, peer_exchange_enabled: false, port_mapping: 'disabled', listener: { type: 'disabled' }, download_rate_limit: phase === 'prepare-limited' ? { type: 'limited', bytes_per_second: 262144 } : { type: 'unlimited' } } });
          await dispatch({ type: 'set_show_add_options', show: false });
          await dispatch({ type: 'set_show_file_selection', show: false });
        }
        const snapshot = await dispatch({ type: 'snapshot' });
        const state = snapshot.response?.snapshot;
        if (!state) throw new Error('snapshot failed');
        if (phase === 'reset-transfer') {
          // Refuse any library except the one independently generated fixture.
          if (state.torrents.length !== 1 || !JSON.stringify(state.torrents[0].protocol_identities).includes('5b6fd1f3a92b3661ecfef63f4412edfaea3d48c4')) throw new Error('not the controlled transfer library');
          const removed = await dispatch({ type: 'remove_torrent', torrent_id: state.torrents[0].torrent_id, data: 'delete_data' });
          if (removed.error) throw new Error(JSON.stringify(removed));
          return { phase, removed: true };
        }
        if (phase === 'partial-transfer' && !(state.torrents.length === 1 && state.torrents[0].verified_piece_count > 0 && state.torrents[0].verified_piece_count < state.torrents[0].piece_count)) throw new Error('transfer must be partially verified before detaching');
        return { phase, backend: hello.hello.backend, revision: state.revision,
          roots: state.storage.roots.map(root => ({ id: root.root_id, availability: root.availability })),
          torrents: state.torrents.map(torrent => ({ id: torrent.torrent_id, identities: torrent.protocol_identities, root: torrent.storage_root, state: torrent.state, running: torrent.desired_running, verifiedPieces: torrent.verified_piece_count, pieces: torrent.piece_count })) };
      } finally { socket.close(); }
    }, phase);
    if (phase === 'invalid' || phase === 'stale') { assert.equal(report.rejected, true); assert.equal(report.libraryDisclosed, false); }
    // This harness must use only independently generated fixtures; do not run on personal data.
    console.log(JSON.stringify(report));
  }
} finally { await browser.close(); }
