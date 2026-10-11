// Exercise the real static output with its Cloudflare CSP using bundled Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from '../clients/web/node_modules/playwright/index.mjs';

const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const root = resolve('website/dist');
const headerText = await readFile(join(root, '_headers'), 'utf8');
const rules = [];
for (const block of headerText.split(/\n\s*\n/)) {
  const lines = block.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  if (!lines[0]?.startsWith('/')) continue;
  rules.push({ pattern: lines[0], headers: lines.slice(1) });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) throw Error('path traversal');
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
    catch { if (!extname(file)) { try { await stat(file + '.html'); file += '.html'; } catch { file = join(file, 'index.html'); } } }
    let body;
    try { body = await readFile(file); } catch { body = await readFile(join(root, '404.html')); response.statusCode = 404; }
    const headers = new Map();
    for (const rule of rules) {
      const pattern = new RegExp('^' + rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$');
      if (!pattern.test(pathname)) continue;
      for (const line of rule.headers) {
        if (line.trim().startsWith('! ')) { headers.delete(line.trim().slice(2).toLowerCase()); continue; }
        const i = line.indexOf(':'); if (i < 0) continue;
        const key = line.slice(0, i).trim().toLowerCase();
        const value = line.slice(i + 1).trim();
        headers.set(key, headers.has(key) ? headers.get(key) + ', ' + value : value);
      }
    }
    for (const [key, value] of headers) response.setHeader(key, value);
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(400); response.end('Bad request'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// An explicit hosted origin runs the same acceptance checks after deployment.
const base = process.env.WEBSITE_CAPTURE_BASE ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const receipts = [];
async function capture(name, url, width, theme, interaction) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => {
    localStorage.setItem('theme', theme);
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI }));
  }, theme);
  // Preserve recipients without recording visits or submitting any form.
  await page.route(/(?:cloudflareinsights\.com|google-analytics\.com|googletagmanager\.com)/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://docs.google.com/forms/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Existing Google Form preserved. No test response submitted.</p>' }));
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (interaction) await interaction(page);
    const result = await page.evaluate(() => ({
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth,
      brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
      csp: window.__cspViolations,
      theme: document.documentElement.dataset.theme,
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
    }));
    await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
    receipts.push({ name, width, title: await page.title(), errors, ...result });
    assert.equal(result.overflow, false, `${name}: overflow`);
    assert.equal(result.brokenImages.length, 0, `${name}: broken images`);
    assert.equal(errors.length, 0, `${name}: page errors ${errors}`);
    assert.equal(result.csp.length, 0, `${name}: CSP violations ${JSON.stringify(result.csp)}`);
    assert(!/rstorrent/i.test(result.text), `${name}: obsolete display branding`);
  } finally { await context.close(); }
}
try {
  for (const width of [390, 1200]) await capture(`before-home-${width}`, 'https://jstorrent.com/', width, 'light');
  for (const width of [320, 390, 1200]) for (const theme of ['light', 'dark']) {
    await capture(`after-home-${width}-${theme}`, base + '/', width, theme, async page => {
      await page.getByRole('button', { name: 'Linux', exact: true }).click();
      assert.equal(await page.locator('a[href$=".AppImage"]:visible').count(), 2);
      assert.equal(await page.locator('a[href$="AppImage-sources-final.tar.gz"]:visible').count(), 1);
      await page.getByRole('button', { name: 'Mac', exact: true }).click();
      assert.equal(await page.locator('a[href$=".dmg"]:visible').count(), 2);
      await page.getByRole('button', { name: 'Windows', exact: true }).click();
      assert.equal(await page.locator('a[href$="-setup.exe"]:visible').count(), 1);
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme === 'light' ? 'dark' : 'light');
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    });
    await capture(`after-download-${width}-${theme}`, base + '/#download', width, theme, async page => {
      const top = await page.locator('#download').evaluate(e => e.getBoundingClientRect().top);
      assert(top >= 0 && top < 200, `direct Download fragment displaced: ${top}`);
      await page.getByRole('button', { name: 'Linux', exact: true }).click();
    });
  }
  for (const [name, path] of [
    ['blog', '/blog/'], ['blog-post', '/blog/dht-ipv6-bug/'], ['migration', '/migrate/'],
    ['prototype-retired', '/app/'], ['privacy', '/privacy.html'], ['pairing', '/pair.html'],
    ['feedback', '/feedback.html?device=%3Cimg%20src=x%20onerror=alert(1)%3E&platform=android&v=1.0.28'],
    ['uninstall', '/uninstall.html?platform=desktop&v=0.3.0'], ['not-found', '/missing-page/'],
  ]) for (const width of [390, 1200]) await capture(`after-${name}-${width}`, base + path, width, 'light');
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const page = await noJs.newPage();
  await page.goto(base);
  assert.equal(await page.locator('a[href$="-setup.exe"]').count(), 1, 'download missing without JavaScript');
  assert.equal(await page.locator('a[href$=".dmg"]').count(), 2);
  assert.equal(await page.locator('a[href$=".AppImage"]').count(), 2);
  await noJs.close();
} finally {
  await writeFile(join(output, 'capture.json'), JSON.stringify({ observedAt: new Date().toISOString(), receipts }, null, 2) + '\n');
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Passed ${receipts.length} real website views and no-JavaScript download check`);
