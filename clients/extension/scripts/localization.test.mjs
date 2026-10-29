import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localizeDocument, t } from '../src/localization.js';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');

test('native translation reorders original DOM slots without admitting markup or changing links', () => {
  const dom = new JSDOM('<html><body><p data-i18n="example">Before <a href="https://jstorrent.com">Link</a> after.</p></body></html>');
  const document = dom.window.document;
  const link = document.querySelector('a');
  let clicked = 0; link.addEventListener('click', () => { clicked += 1; });
  const original = globalThis.chrome;
  try {
    globalThis.chrome = { i18n: { getUILanguage: () => 'de', getMessage: key => key === 'example' ? '{slot1} danach <img src=x onerror=bad>' : key === 'catalog_locale' ? 'de' : key === 'catalog_direction' ? 'ltr' : '' } };
    localizeDocument(document);
    assert.equal(document.querySelector('a'), link);
    assert.equal(link.href, 'https://jstorrent.com/');
    assert.equal(document.querySelector('img'), null);
    assert.match(document.querySelector('p').textContent, /<img src=x/);
    link.dispatchEvent(new dom.window.Event('click')); assert.equal(clicked, 1);
    assert.equal(document.documentElement.lang, 'de');
  } finally { globalThis.chrome = original; dom.window.close(); }
});

test('every extracted English HTML message preserves exactly its original inline nodes', () => {
  for (const file of ['popup/popup.html','crostini/setup.html','crostini/connect.html']) {
    const dom = new JSDOM(readFileSync(new URL('../'+file, import.meta.url),'utf8'));
    const links = [...dom.window.document.querySelectorAll('a')].map(x=>x.href);
    const commands = [...dom.window.document.querySelectorAll('[data-command]')].map(x=>x.dataset.command);
    localizeDocument(dom.window.document);
    assert.deepEqual([...dom.window.document.querySelectorAll('a')].map(x=>x.href), links);
    assert.deepEqual([...dom.window.document.querySelectorAll('[data-command]')].map(x=>x.dataset.command), commands);
    assert.doesNotMatch(dom.window.document.body.textContent, /\{slot\d+\}/u);
    dom.window.close();
  }
});

test('English fallback and named values remain data', () => {
  assert.equal(t('extension_summary'), 'Add torrents from Chrome to the JSTorrent app on desktop or Chromebook.');
  assert.equal(t('metrics_summary', {days: '1',sessions: '2',connection: '<script>'}), 'Days since first use: 1 · Visible sessions: 2 · <script>');
});
