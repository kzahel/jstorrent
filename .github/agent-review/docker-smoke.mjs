// Linux Docker boundary smoke with a synthetic Responses server. No inference.
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createProxy } from './proxy.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(resolve(tmpdir(), 'review-boundary-'));
await mkdir(`${root}/broker`, { mode: 0o700 });
let requests = 0;
const fake = http.createServer(async (req, res) => {
  for await (const _chunk of req) {}
  assert.equal(req.headers.authorization, 'Bearer aar_fixture_secret');
  requests++;
  if (req.url.startsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[]}'); return; }
  const item = { id: 'msg_fixture', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OFFLINE_OK' }] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'OFFLINE_OK' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]) res.write('data: ' + JSON.stringify(event) + '\n\n');
  res.end();
});
fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
const transport = { request(_url, options, callback) {
  return http.request({ ...options, host: '127.0.0.1', port: fake.address().port,
    path: _url.pathname.replace('/codex', '') }, callback);
} };
const { server } = createProxy({ token: 'aar_fixture_secret', origin: 'https://fixture.example/codex', transport });
await new Promise(resolve => server.listen(`${root}/broker/router.sock`, resolve));
await chmod(`${root}/broker/router.sock`, 0o600);
const code = `
import { createSocketBridge } from '/review/proxy.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.AAR_TOKEN, undefined);
assert.equal(process.env.GH_TOKEN, undefined);
assert.equal(existsSync('/var/run/docker.sock'), false);
for (const url of ['http://100.76.216.59:8446','https://example.com']) {
  await assert.rejects(fetch(url, {signal:AbortSignal.timeout(1000)}));
}
mkdirSync('/home/reviewer/.codex', {recursive:true});
const bridge = createSocketBridge('/broker/router.sock');
await new Promise(r=>bridge.listen(8417,'127.0.0.1',r));
// Keep the event loop serving the bridge while the real CLI runs.
const {spawn} = await import('node:child_process');
const child = spawn('codex', ['exec','--ephemeral','--skip-git-repo-check','--sandbox','danger-full-access',
  '-m','gpt-6-luna','-c','model_provider="fixture"',
  '-c','model_providers.fixture.name="Fixture"','-c','model_providers.fixture.base_url="http://127.0.0.1:8417"',
  '-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.env_key="PLACEHOLDER"',
  '-c','model_providers.fixture.supports_websockets=false','-c','model_providers.fixture.request_max_retries=0',
  '-c','model_providers.fixture.stream_max_retries=0','-c','features.shell_tool=false',
  '-c','web_search="disabled"','Return OFFLINE_OK'],
  {env:{...process.env,CODEX_HOME:'/home/reviewer/.codex',PLACEHOLDER:'non-secret'},stdio:['ignore','pipe','pipe']});
let out='',err=''; child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
const exit=await new Promise(r=>child.on('exit',r));
bridge.closeAllConnections();bridge.close();
assert.equal(exit,0,err);assert.match(out,/OFFLINE_OK/);
console.log('Container network, secret isolation, Unix proxy, and Codex SSE smoke passed');
`;
try {
  const name = `review-smoke-${process.pid}`;
  const child = spawn('docker', ['run', '--rm', '--name', name, '--network=none',
    '--user', `${process.getuid()}:${process.getgid()}`, '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--read-only', '--tmpfs', '/home/reviewer:rw,mode=1777,size=64m', '--tmpfs', '/tmp:rw,mode=1777,size=64m',
    '--mount', `type=bind,src=${source},dst=/review,readonly`,
    '--mount', `type=bind,src=${root}/broker,dst=/broker,readonly`,
    process.env.REVIEW_IMAGE ?? 'rstorrent-pr-review:ci', 'node', '--input-type=module', '-e', code],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
  const timer = setTimeout(() => { spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }); child.kill(); }, 60_000);
  const exit = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timer);
  assert.equal(exit, 0, err); assert.ok(requests >= 1); console.log(out.trim());
} finally {
  server.closeAllConnections(); server.close(); fake.closeAllConnections(); fake.close();
  await rm(root, { recursive: true, force: true });
}
