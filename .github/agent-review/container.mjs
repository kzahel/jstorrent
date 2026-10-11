import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createSocketBridge } from './proxy.mjs';

await mkdir('/home/reviewer', { recursive: true });
await mkdir('/home/reviewer/.codex', { recursive: true });
const bridge = createSocketBridge('/broker/router.sock');
await new Promise(resolve => bridge.listen(8417, '127.0.0.1', resolve));
await writeFile('/home/reviewer/.codex/config.toml', `model_provider = "aar"
model_reasoning_effort = "high"
approval_policy = "never"
web_search = "disabled"
[model_providers.aar]
name = "Agent Auth Router"
base_url = "http://127.0.0.1:8417"
wire_api = "responses"
env_key = "REVIEW_PLACEHOLDER"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`);
const child = spawn('codex', ['exec', '--ephemeral', '--sandbox', 'danger-full-access',
  '--output-schema', '/review/schema.json', '--output-last-message', '/tmp/result.json',
  '-m', process.env.REVIEW_MODEL, '-c', 'model_provider="aar"',
  '-c', 'model_reasoning_effort="high"', '-c', 'web_search="disabled"',
  '-c', 'model_providers.aar.supports_websockets=false', '-'], {
  cwd: '/workspace', env: { ...process.env, CODEX_HOME: '/home/reviewer/.codex', REVIEW_PLACEHOLDER: 'local-socket-only' },
  stdio: ['pipe', 'ignore', 'ignore'],
});
child.stdin.end(await readFile('/review/prompt.md'));
const timer = setTimeout(() => child.kill('SIGKILL'), 25 * 60 * 1000);
try {
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`Codex failed (${code})`);
  const data = await readFile('/tmp/result.json');
  if (data.length > 64 * 1024) throw new Error('Review output exceeds 64 KiB');
  JSON.parse(data.toString());
  process.stdout.write(data);
} finally { clearTimeout(timer); bridge.closeAllConnections(); bridge.close(); }
