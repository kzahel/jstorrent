// Owned Chromium smoke: no installed user browser, native host or app profile.
import { chromium } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFile, mkdtemp, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { packagedFiles, extensionRoot } from './validate.mjs';

const project = path.resolve(extensionRoot, '../..');
const config = JSON.parse(await readFile(path.join(project, 'distribution/store-listings/locales.json')));
const locales = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'de', 'fr', 'ja', 'zh-CN', 'zh-TW'];
const owned = await mkdtemp(path.join(os.tmpdir(), 'jstorrent-extension-localization-'));
const output = path.join(project, '.local/store-localization/browser');
await mkdir(output, { recursive: true });
const receipt = [];
try {
  const extension = path.join(owned, 'extension');
  for (const file of packagedFiles) {
    const source = file.startsWith('companion/') ? path.join(project, 'clients/web/dist', file) : path.join(extensionRoot, file);
    await mkdir(path.dirname(path.join(extension, file)), { recursive: true });
    await cp(source, path.join(extension, file));
  }
  // Stable test identity; matches the source manifest, with no production host.
  for (const locale of locales) {
    assert(config.locales[locale]?.chrome, `Unconfigured locale ${locale}`);
    // macOS may retain the OS Chrome UI language despite --lang. Exercise
    // every exact packaged catalog through Chrome's native default/fallback
    // loader, with a fresh disposable profile, rather than mocking i18n.
    await rm(path.join(extension, '_locales'), { recursive: true, force: true });
    const chromeLocale = config.locales[locale].chrome;
    await cp(path.join(extensionRoot, '_locales', chromeLocale), path.join(extension, '_locales', chromeLocale), { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json')));
    manifest.default_locale = chromeLocale;
    await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    const profile = path.join(owned, 'profile-' + locale);
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true, locale, viewport: { width: 360, height: 900 },
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--lang=' + locale,
          '--use-mock-keychain', '--password-store=basic'],
      });
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).host;
      const native = await worker.evaluate(() => ({ language: chrome.i18n.getUILanguage(), summary: chrome.i18n.getMessage('extension_summary') }));
      const expected = JSON.parse(await readFile(path.join(extensionRoot, 'locales', locale + '.json')));
      const nativeMatches = native.summary === expected.extension_summary;
      assert(nativeMatches, 'Chrome native catalog differs from the reviewed source');
      const page = await context.newPage();
      await page.addInitScript(() => {
        // Keep native Chrome i18n, but never contact an installed host or use
        // a real app/library during this presentation qualification.
        chrome.runtime.getPlatformInfo = async () => ({ os: 'cros' });
        chrome.runtime.sendMessage = async () => ({ ok: true, state: {
          disclosureVersion: 1, statisticsEnabled: false,
          createdAtMillis: String(Date.now()), sessions: 1, everConnected: false,
        } });
        chrome.extension.getViews = () => [];
        chrome.permissions.contains = async () => false;
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`chrome-extension://${id}/popup/popup.html`);
      await page.waitForSelector('body [data-i18n]');
      const observed = await page.evaluate(() => ({ lang: document.documentElement.lang, text: document.body.textContent,
        overflow: document.documentElement.scrollWidth > 360,
        rawSlots: /\{slot\d+\}/u.test(document.body.textContent),
        links: [...document.querySelectorAll('a')].map(x=>x.href) }));
      assert(!observed.rawSlots, 'Unresolved named DOM slot');
      assert(!observed.overflow, 'Popup horizontal overflow');
      assert.deepEqual(errors, []);
      assert(observed.links.some(x=>x.includes('play.google.com/store/apps/details?id=com.jstorrent.app')));
      await page.screenshot({ path: path.join(output, locale + '-popup.png'), fullPage: true });
      await page.goto(`chrome-extension://${id}/crostini/setup.html`);
      await page.waitForSelector('body [data-i18n]');
      assert(await page.locator('a[href="https://play.google.com/store/apps/details?id=com.jstorrent.app"]').count() > 0);
      assert.equal(await page.evaluate(() => /\{slot\d+\}/u.test(document.body.textContent)), false);
      await page.setViewportSize({width:390,height:900});
      await page.screenshot({path:path.join(output,locale+'-setup.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Setup horizontal overflow');
      await page.goto(`chrome-extension://${id}/crostini/connect.html`);
      await page.waitForFunction(expected => document.querySelector('#connection-status')?.textContent === expected,
        expected.connect_dynamic_001);
      assert.equal(await page.evaluate(() => /\{slot\d+\}/u.test(document.body.textContent)), false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Connection horizontal overflow');
      assert.deepEqual(errors, []);
      await page.screenshot({path:path.join(output,locale+'-connect.png'),fullPage:true});
      receipt.push({ locale, selection: 'isolated native default/fallback catalog', nativeLanguage: native.language, nativeMatches, errors, popupWidth: 360, setupWidth: 390, connectionWidth: 390 });
      console.log(JSON.stringify(receipt.at(-1)));
    } finally { await context?.close(); }
  }
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
} finally { await rm(owned,{recursive:true,force:true}); }
