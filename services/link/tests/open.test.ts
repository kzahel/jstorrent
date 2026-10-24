import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { encryptFragment } from '../src/codec.ts';

async function until(predicate: () => boolean) {
  for (let i = 0; i < 600; i++) { if (predicate()) return; await delay(5); }
  assert(predicate(), 'open-page operation did not finish');
}

test('open page handles hash changes, explicit retry, stale reads, redirect and cancellation', async t => {
  const status = { textContent: '' };
  const retry = Object.assign(new EventTarget(), { hidden: true });
  const window = new EventTarget();
  const replacements: string[] = [];
  const location = { hash: '#invalid', replace(url: string) { replacements.push(url); } };
  const requests: { resolve: (response: Response) => void; signal: AbortSignal; url: string }[] = [];
  const overrides = {
    document: { getElementById(id: string) { return id === 'status' ? status : retry; } },
    window, location,
    fetch: (url: string, options: RequestInit) => new Promise<Response>(resolve => requests.push({ resolve, signal: options.signal!, url })),
  };
  const saved = new Map(Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  await import('../src/open.ts');
  assert.match(status.textContent, /invalid, damaged/); assert.equal(requests.length, 0);
  const { record, key } = await encryptFragment('xt=test&tr=https%3A%2F%2Ftracker.example');
  location.hash = '#Absent0000.' + key;
  window.dispatchEvent(new Event('hashchange'));
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/v1/links/Absent0000');
  requests[0].resolve(new Response(null, { status: 404 }));
  await until(() => status.textContent.includes('unavailable or has expired'));
  assert.equal(retry.hidden, false);
  retry.dispatchEvent(new Event('click'));
  assert.equal(requests.length, 2);
  location.hash = '#invalid'; window.dispatchEvent(new Event('hashchange'));
  assert(requests[1].signal.aborted);
  requests[1].resolve(new Response(record));
  await setImmediate();
  assert.match(status.textContent, /invalid, damaged/); assert.deepEqual(replacements, []);
  location.hash = '#Success000.' + key; window.dispatchEvent(new Event('hashchange'));
  requests[2].resolve(new Response(record));
  await until(() => replacements.length === 1);
  assert.equal(replacements[0], 'https://jstorrent.com/share/#xt=test&tr=https%3A%2F%2Ftracker.example');
  location.hash = '#Absent0000.' + key; window.dispatchEvent(new Event('hashchange'));
  window.dispatchEvent(new Event('pagehide')); assert(requests[3].signal.aborted);
  requests[3].resolve(new Response(null, { status: 404 })); await setImmediate();
  location.hash = ''; window.dispatchEvent(new Event('hashchange'));
  assert.equal(replacements.at(-1), 'https://jstorrent.com/');
});
