import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { eligible, changedLines, reviewPayload } from './github.mjs';
import { createProxy } from './proxy.mjs';

const sha = 'a'.repeat(40);
const pr = { state: 'open', draft: false, user: { id: 158352 },
  head: { sha, repo: { full_name: 'kzahel/jstorrent' } },
  base: { sha, ref: 'main', repo: { full_name: 'kzahel/jstorrent' } } };
const files = [{ filename: 'src/example.rs', patch: '@@ -1,3 +1,4 @@\n same\n-old\n+new\n+extra\n context' }];
const result = { summary: 'Review @everyone', validation: [{ command: 'cargo test', result: 'passed' }], limitations: [],
  findings: [{ title: 'Bug', body: 'Evidence', priority: 1, path: 'src/example.rs', line: 2 }] };

test('only current owner-authored same-repository main PRs qualify', () => {
  assert.equal(eligible(pr, sha), true);
  for (const change of [{ state: 'closed' }, { draft: true }, { user: { id: 1 } },
    { head: { ...pr.head, repo: { full_name: 'other/fork' } } }, { base: { ...pr.base, ref: 'release' } }]) {
    assert.equal(eligible({ ...pr, ...change }, sha), false);
  }
  assert.equal(eligible(pr, 'b'.repeat(40)), false);
});
test('inline findings must use a visible right-side diff line', () => {
  assert.deepEqual([...changedLines(files).get('src/example.rs')], [1, 2, 3, 4]);
  const payload = reviewPayload(result, { head_sha: sha, pr: 1 }, files);
  assert.equal(payload.event, 'COMMENT'); assert.equal(payload.commit_id, sha);
  assert.ok(!payload.body.includes('@everyone'));
  const absolute = reviewPayload({ ...result, findings: [{ ...result.findings[0], path: '/workspace/src/example.rs' }] }, { head_sha: sha, pr: 1 }, files);
  assert.deepEqual(absolute, payload);
  for (const change of [{ path: '../secret' }, { path: '/tmp/src/example.rs' },
    { path: '/workspace/../src/example.rs' }, { path: '/workspace/src/unknown.rs' },
    { path: '/workspace-other/src/example.rs' }, { line: 99 }, { priority: 4 }, { extra: 'field' }]) {
    assert.throws(() => reviewPayload({ ...result, findings: [{ ...result.findings[0], ...change }] }, { head_sha: sha, pr: 1 }, files));
  }
  assert.throws(() => reviewPayload({ ...result, summary: 'x'.repeat(4001) }, { head_sha: sha, pr: 1 }, files));
  assert.throws(() => reviewPayload({ ...result, findings: Array(21).fill(result.findings[0]) }, { head_sha: sha, pr: 1 }, files));
});

test('broker replaces authorization, limits routes, refuses redirects, and streams', async () => {
  let hits = 0; const observed = [];
  const upstream = http.createServer((req, res) => {
    hits++; observed.push(req.headers);
    if (req.url === '/responses/compact') { res.writeHead(302, { location: 'https://evil.example', authorization: 'secret' }).end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-secret': 'hidden' });
    res.write('data: first\n\n'); setTimeout(() => res.end('data: last\n\n'), 100);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const transport = { request(url, options, callback) {
    assert.equal(url.origin, 'https://router.example');
    assert.equal(url.pathname.startsWith('/codex/'), true);
    return http.request({ ...options, host: '127.0.0.1', port: upstream.address().port,
      path: url.pathname.replace('/codex', '') }, callback);
  } };
  const { server } = createProxy({ token: 'aar_test_secret', origin: 'https://router.example/codex', transport, maxBytes: 100, maxRequests: 4 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/owner', '/responses/../owner', '//evil.example/responses']) {
      assert.equal((await fetch(url + path, { method: 'POST' })).status, 404);
    }
    assert.equal(hits, 0);
    const response = await fetch(url + '/responses', { method: 'POST', headers: { authorization: 'Bearer attacker', 'x-secret': 'caller' }, body: '{}' });
    assert.equal(response.headers.get('x-secret'), null);
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
    while (!(await reader.read()).done) {}
    assert.equal(observed[0].authorization, 'Bearer aar_test_secret');
    assert.equal(observed[0]['x-secret'], undefined);
    assert.equal((await fetch(url + '/responses/compact', { method: 'POST' })).status, 502);
    assert.equal((await fetch(url + '/responses', { method: 'POST', body: 'x'.repeat(101) })).status, 413);
    assert.equal(hits, 2);
    await fetch(url + '/models');
    assert.equal((await fetch(url + '/models')).status, 429);
  } finally { server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); }
});
test('broker refuses credential-bearing or non-HTTPS destinations', () => {
  for (const origin of ['http://router/codex', 'https://user:password@router/codex', 'https://router/owner', 'https://router/codex?token=x']) {
    assert.throws(() => createProxy({ token: 'test', origin }));
  }
});
