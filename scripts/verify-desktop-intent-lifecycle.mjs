#!/usr/bin/env node
// Controlled installed testbeds only. Connect to an already-owned test browser.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const moduleUrl = process.env.RSTORRENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.RSTORRENT_PLAYWRIGHT_MODULE).href
  : new URL('../clients/web/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(moduleUrl);
const browser = await chromium.connectOverCDP(process.env.RSTORRENT_TEST_CDP ?? 'http://127.0.0.1:9222');
const root = 'chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/';
const ui = root + 'companion/companion.html?backend=desktop';
const popupUrl = root + 'popup/popup.html';
const phase = process.argv[2] ?? 'recover';
const context = browser.contexts()[0];
async function ownPage(url) {
  let page = context.pages().find(page => page.url() === url);
  if (!page) { page = await context.newPage(); await page.goto(url); }
  return page;
}
async function instance(page) {
  return page.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'nativeBootstrap', op: 'attach_control' });
    return reply.ok ? reply.result.instanceId : null;
  });
}
async function connected(page) {
  await page.locator('[data-connection="connected"]').waitFor({ timeout: 25_000 });
  const id = await instance(page);
  assert(id, 'runtime must be attached');
  return id;
}
async function stopWorker(page) {
  const session = await context.newCDPSession(page);
  try {
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
  } finally { await session.detach(); }
}
try {
  if (phase === 'browser-close') {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close');
  } else if (phase === 'passive-stopped') {
    const popup = await ownPage(popupUrl);
    await popup.locator('#launch').waitFor();
    const page = await ownPage(ui);
    for (let index = 0; index < 2; index++) {
      await page.reload();
      await popup.reload();
      await stopWorker(page);
      assert.equal(await instance(page), null, 'passive page/worker recovery launched runtime');
    }
    await page.waitForTimeout(35_000);
    assert.equal(await instance(page), null);
    assert(await page.getByRole('button', { name: 'Start', exact: true }).isVisible());
    console.log(JSON.stringify({ phase, reloads: 2, workerStops: 2, observationSeconds: 35, runtimeStopped: true }));
  } else if (phase === 'incompatible') {
    const page = await ownPage(popupUrl);
    const before = await instance(page);
    const reply = await page.evaluate(() => chrome.runtime.sendNativeMessage(
      'com.jstorrent.rstorrent.native',
      { id: 'incompatible', protocolVersion: 999, op: 'start_control' },
    ));
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, 'unsupported_protocol');
    assert.equal(reply.result, undefined);
    assert.equal(await instance(page), before);
    console.log(JSON.stringify({ phase, rejected: true, runtimeUnchanged: true }));
  } else if (phase === 'toolbar') {
    // Open a real Chrome action popup, not a tab with its URL. Native toolbar
    // clicks are additionally exercised through Machine Control in acceptance.
    const launcher = await ownPage(popupUrl);
    await launcher.bringToFront();
    await launcher.evaluate(() => chrome.action.openPopup());
    const deadline = Date.now() + 25_000;
    while (!context.pages().some(page => page.url() === ui) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const page = context.pages().find(page => page.url() === ui);
    assert(page, 'toolbar did not open companion');
    const id = await connected(page);
    assert.equal(context.pages().filter(page => page.url() === ui).length, 1);
    await page.waitForFunction(async () => {
      const tab = await chrome.tabs.getCurrent();
      return tab.active && (await chrome.windows.get(tab.windowId)).focused;
    });
    console.log(JSON.stringify({ phase, instance: id, pages: 1, focused: true }));
  } else if (phase === 'recover' || phase === 'cycles') {
    const page = await ownPage(ui);
    const before = await connected(page);
    const cycles = phase === 'cycles' ? 64 : 2;
    for (let index = 0; index < cycles; index++) {
      await page.reload();
      assert.equal(await connected(page), before);
      await stopWorker(page);
      assert.equal(await instance(page), before);
    }
    console.log(JSON.stringify({ phase, cycles, workerStops: cycles, instance: before, sameOwner: true }));
  } else if (phase === 'discard') {
    const page = await ownPage(ui);
    const before = await connected(page);
    const id = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    const launcher = await ownPage(popupUrl);
    await launcher.bringToFront();
    const discarded = await launcher.evaluate(async id => (await chrome.tabs.discard(id))?.discarded, id);
    assert.equal(discarded, true);
    await page.bringToFront();
    assert.equal(await connected(page), before);
    console.log(JSON.stringify({ phase, discarded: true, sameOwner: true, instance: before }));
  } else if (phase === 'detach') {
    const pages = context.pages().filter(page => page.url().startsWith(root));
    for (const page of pages) await page.close();
    console.log(JSON.stringify({ phase, closedPages: pages.length }));
  } else {
    throw new Error('unknown lifecycle phase');
  }
} finally { await browser.close(); }
