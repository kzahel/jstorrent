#!/usr/bin/env node
// Real Chromium cookie/origin checks against the product gateway. No DNS override.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '../clients/web/node_modules/playwright-core/index.mjs';

const binary = path.resolve(process.argv[2] ?? 'target/debug/rstorrent-gateway');
const root = await mkdtemp(path.join(tmpdir(), 'rstorrent-crostini-loopback-'));
let child, browser;
const neighbor = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ receivedSessionCookie: /(?:^|;\s*)rstorrent_web_session=/.test(request.headers.cookie ?? '') }));
});
function rawRequest(url, options) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, ok: response.statusCode === 200 }));
      response.on('error', reject);
    });
    request.setTimeout(2000, () => request.destroy(new Error('owned HTTP request timed out')));
    request.on('error', reject); request.end();
  });
}
async function stopGateway() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try { await stopped; } finally { clearTimeout(timer); }
}
try {
  await mkdir(path.join(root, 'web'));
  await writeFile(path.join(root, 'web/index.html'), '<!doctype html><title>Owned gateway auth fixture</title>');
  await new Promise(resolve => neighbor.listen(0, '127.0.0.1', resolve));
  const neighborPort = neighbor.address().port;
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://jstorrent.localhost:${port}`;
  async function startGateway() {
    child = spawn(binary, ['serve', '--profile-root', path.join(root, 'profile'), '--listen', `0.0.0.0:${port}`,
      '--origin', origin, '--auth', 'auto', '--web-root', path.join(root, 'web'), '--build-id', 'loopback-fixture', '--chromeos-crostini', '--no-open'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RSTORRENT_NETWORK_POLICY: 'loopback_only' } });
    let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`gateway exited: ${diagnostic}`);
      try {
        const response = await rawRequest(`http://127.0.0.1:${port}/healthz`, { headers: { Host: `jstorrent.localhost:${port}` } });
        if (response.ok) return;
      } catch { /* Wait for this owned process to listen. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('owned gateway did not become ready');
  }
  await startGateway();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const paired = await page.evaluate(async () => (await fetch('/api/v1/web-auth/policy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy: 'paired', label: 'Loopback fixture' }),
  })).status);
  assert.equal(paired, 201);
  const cookie = (await context.cookies(origin)).find(cookie => cookie.name === 'rstorrent_web_session');
  assert.ok(cookie); assert.equal(cookie.domain, 'jstorrent.localhost'); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('rstorrent_web_session')), false);
  const other = await context.newPage();
  for (const host of ['localhost', 'other.localhost', '127.0.0.1']) {
    await other.goto(`http://${host}:${neighborPort}`);
    assert.equal(JSON.parse(await other.locator('body').innerText()).receivedSessionCookie, false, host);
  }
  // Port is not a cookie boundary. Keep this limitation explicit in the test.
  await other.goto(`http://jstorrent.localhost:${neighborPort}`);
  assert.equal(JSON.parse(await other.locator('body').innerText()).receivedSessionCookie, true);
  for (const host of ['localhost', 'other.localhost', 'penguin.linux.test', 'jstorrent.localhost.evil']) {
    assert.equal((await rawRequest(`http://127.0.0.1:${port}/healthz`, { headers: { Host: `${host}:${port}` } })).status, 403);
    assert.equal((await rawRequest(`http://127.0.0.1:${port}/api/v1/web-auth/logout`, { method: 'POST', headers: {
      Host: `jstorrent.localhost:${port}`, Origin: `http://${host}:${port}`, Cookie: `${cookie.name}=${cookie.value}`,
    } })).status, 403);
  }
  await stopGateway(); await startGateway(); await page.reload();
  const state = await page.evaluate(async () => (await (await fetch('/api/v1/web-auth/status')).json()).state);
  assert.equal(state, 'session_valid');
  console.log('PASS actual Chromium loopback resolution, host-only HttpOnly cookie isolation, exact Host/Origin rejection, and paired-session restart');
} finally {
  await browser?.close();
  await stopGateway();
  await new Promise(resolve => neighbor.close(resolve));
  await rm(root, { recursive: true, force: true });
}
