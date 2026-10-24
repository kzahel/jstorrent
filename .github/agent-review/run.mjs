import { spawn } from 'node:child_process';
import { mkdir, chmod, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy } from './proxy.mjs';

const root = resolve(process.env.REVIEW_DIR);
const source = dirname(fileURLToPath(import.meta.url));
const image = process.env.REVIEW_IMAGE ?? 'rstorrent-pr-review:ci';
const uid = process.getuid();
const mounts = ['--mount', `type=bind,src=${root}/repo,dst=/workspace`,
  '--mount', `type=bind,src=${root}/cache,dst=/cache`];
const isolation = ['--rm', '--user', `${uid}:${process.getgid()}`, '--cap-drop=ALL',
  '--security-opt=no-new-privileges', '--pids-limit=512', '--memory=8g', '--cpus=4',
  '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
  '--tmpfs', '/home/reviewer:rw,nosuid,nodev,size=64m,mode=1777'];

async function docker(args, { limit = 64 * 1024, timeout = 30 * 60 * 1000 } = {}) {
  const child = spawn('docker', args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'] });
  const output = []; let size = 0; let overflow = false;
  child.stdout.on('data', chunk => { size += chunk.length; if (size <= limit) output.push(chunk); else { overflow = true; child.kill(); } });
  // No raw repository-controlled output in privileged Actions logs.
  child.stderr.on('data', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (overflow || code !== 0) throw new Error(`Container command failed (${code}, output overflow=${overflow})`);
    return Buffer.concat(output);
  } finally { clearTimeout(timer); }
}

for (const name of ['repo', 'cache', 'cache/cargo', 'cache/npm', 'cache/target', 'broker', 'context']) {
  await mkdir(`${root}/${name}`, { recursive: true, mode: 0o700 });
}
const phase = process.argv[2];
if (phase === 'prepare' || phase === 'warm') {
  const args = ['run', '--name', `review-prepare-${process.env.GITHUB_RUN_ID ?? process.pid}`,
    ...isolation, ...mounts, '--env', 'CARGO_TARGET_DIR=/cache/target', '--env', 'npm_config_cache=/cache/npm',
    '--env', 'RUSTUP_TOOLCHAIN=1.97.0', image, 'sh', '-c',
    'mkdir -p /tmp/home clients/web/dist; cargo fetch --locked >&2; npm ci --prefix clients/web >&2' +
    (phase === 'warm' ? '; cargo test --locked --workspace --no-run >&2' : '')];
  // Run preparation before Tailscale or any model token is introduced.
  args[args.length - 1] = 'set -eu; ' + args[args.length - 1];
  try { await docker(args, { timeout: phase === 'warm' ? 40 * 60 * 1000 : 8 * 60 * 1000 }); }
  finally { await docker(['rm', '-f', `review-prepare-${process.env.GITHUB_RUN_ID ?? process.pid}`]).catch(() => {}); }
} else if (phase === 'review') {
  const metadata = JSON.parse(await readFile(`${root}/metadata.json`));
  for (const file of ['prompt.md', 'schema.json', 'proxy.mjs', 'container.mjs']) await copyFile(`${source}/${file}`, `${root}/context/${file}`);
  await writeFile(`${root}/context/context.json`, JSON.stringify(metadata));
  const { server } = createProxy({ token: process.env.AAR_TOKEN, origin: process.env.AAR_URL });
  if (!/^aar_[A-Za-z0-9_-]+$/.test(process.env.AAR_TOKEN ?? '')) throw new Error('Missing router token');
  const socketPath = `${root}/broker/router.sock`;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const name = `review-agent-${process.env.GITHUB_RUN_ID ?? process.pid}`;
  const cleanup = () => { spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }); server.closeAllConnections(); server.close(); };
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  try {
    const data = await docker(['run', '--name', name, ...isolation, '--network=none', ...mounts,
      '--mount', `type=bind,src=${root}/context,dst=/review,readonly`,
      '--mount', `type=bind,src=${root}/broker,dst=/broker,readonly`,
      '--env', `REVIEW_BASE_SHA=${metadata.base_sha}`, '--env', `REVIEW_HEAD_SHA=${metadata.head_sha}`,
      '--env', `REVIEW_MODEL=${process.env.REVIEW_MODEL ?? 'gpt-6.1-sol'}`,
      '--env', 'CARGO_TARGET_DIR=/cache/target', '--env', 'RUSTUP_TOOLCHAIN=1.97.0',
      '--env', 'npm_config_cache=/cache/npm', image, 'node', '/review/container.mjs']);
    await writeFile(`${root}/result.json`, data, { mode: 0o600 });
  } finally { cleanup(); }
} else { throw new Error('Expected prepare, warm, or review'); }
