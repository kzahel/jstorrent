import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const output = resolve(process.argv[2] ?? 'artifacts/verification/fast-ci-benchmark.json');
const packages = process.argv.slice(3);
if (!packages.length) packages.push('rstorrent-protocol', 'rstorrent-engine');
if (packages.some(p => !/^rstorrent-[a-z-]+$/.test(p))) throw new Error('Invalid package name');
const optLevel = process.env.FAST_CI_BENCHMARK_OPT_LEVEL ?? '1';
const codegenUnits = process.env.FAST_CI_BENCHMARK_CODEGEN_UNITS ?? '16';
if (!/^[012]$/.test(optLevel) || !/^\d+$/.test(codegenUnits) || +codegenUnits < 1 || +codegenUnits > 256) {
  throw new Error('Invalid candidate profile');
}
const directory = await mkdtemp(join(tmpdir(), 'rstorrent-fast-ci-benchmark-'));
const record = { platform: process.platform, arch: process.arch, logicalCpus: cpus().length,
  memoryBytes: totalmem(), cargoJobs: 4, packages, candidate: { optLevel: +optLevel, codegenUnits: +codegenUnits },
  startedAt: new Date().toISOString(), results: [] };
let activeChild; let interrupted = false;
function stop(signal) {
  if (!activeChild) return;
  try {
    if (process.platform === 'win32') activeChild.kill(signal);
    else process.kill(-activeChild.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { interrupted = true; stop('SIGTERM'); });
}
async function run(args, env = {}, capture = false) {
  if (interrupted) throw new Error('Benchmark interrupted');
  const start = performance.now();
  const child = spawn(args[0], args.slice(1), { env: { ...process.env, CARGO_BUILD_JOBS: '4', ...env },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  activeChild = child;
  let stdout = ''; let tail = ''; let lineBuffer = ''; const counts = [];
  child.stdout.on('data', b => {
    if (capture) stdout += b;
    tail = (tail + b).slice(-16000);
    const lines = (lineBuffer + b).split('\n'); lineBuffer = lines.pop();
    for (const line of lines) {
      const match = /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/.exec(line);
      if (match) counts.push({ passed: +match[1], failed: +match[2], ignored: +match[3] });
    }
  });
  child.stderr.on('data', b => { tail = (tail + b).slice(-16000); });
  const timer = setTimeout(() => stop('SIGKILL'), 20 * 60 * 1000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    const seconds = +((performance.now() - start) / 1000).toFixed(3);
    if (code !== 0) throw Object.assign(new Error(`${args.join(' ')} failed (${code})\n${tail}`),
      { command: args.join(' '), seconds, counts });
    return { seconds, stdout, counts };
  } finally { clearTimeout(timer); activeChild = undefined; }
}
try {
  record.sourceSha = (await run(['git', 'rev-parse', 'HEAD'], {}, true)).stdout.trim();
  record.rustc = (await run(['rustc', '--version'], {}, true)).stdout.trim();
  record.cargo = (await run(['cargo', '--version'], {}, true)).stdout.trim();
  record.manifestDiff = (await run(['git', 'diff', '--', 'Cargo.toml'], {}, true)).stdout;
  record.sourceDiffSha256 = createHash('sha256').update((await run(['git', 'diff', '--binary', '--',
    'Cargo.toml', 'Cargo.lock', 'crates', 'clients/desktop/src-tauri'], {}, true)).stdout).digest('hex');
  for (const profile of ['test', 'ci-candidate']) {
    const env = { CARGO_TARGET_DIR: join(directory, profile), CARGO_INCREMENTAL: '0' };
    const configuration = profile === 'test' ? [] : ['--config', 'profile.ci-candidate.inherits="dev"',
      '--config', `profile.ci-candidate.opt-level=${optLevel}`, '--config', `profile.ci-candidate.codegen-units=${codegenUnits}`];
    const args = ['cargo', ...configuration, 'test', '--locked', '--profile', profile,
      ...packages.flatMap(p => ['-p', p]), '--lib'];
    for (const phase of ['target-cold-compile', 'unchanged-compile', 'first-party-rebuild', 'test-execution']) {
      if (phase === 'first-party-rebuild') {
        await run(['cargo', ...configuration, 'clean', '--profile', profile, ...packages.flatMap(p => ['-p', p])], env);
      }
      console.log(`Benchmark ${profile}: ${phase}`);
      const command = phase === 'test-execution' ? args : [...args, '--no-run'];
      const result = await run(command, env);
      record.results.push({ profile, phase, argv: command, command: command.join(' '), seconds: result.seconds, counts: result.counts });
      await mkdir(resolve(output, '..'), { recursive: true });
      await writeFile(output, JSON.stringify(record, null, 2) + '\n');
      console.log(`${profile} ${phase}: ${result.seconds}s`);
    }
  }
  record.finalSourceSha = (await run(['git', 'rev-parse', 'HEAD'], {}, true)).stdout.trim();
  record.finalSourceDiffSha256 = createHash('sha256').update((await run(['git', 'diff', '--binary', '--',
    'Cargo.toml', 'Cargo.lock', 'crates', 'clients/desktop/src-tauri'], {}, true)).stdout).digest('hex');
  if (record.sourceSha !== record.finalSourceSha || record.sourceDiffSha256 !== record.finalSourceDiffSha256) {
    throw new Error('Source changed during the comparison; timings are not a paired benchmark');
  }
  record.completedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(record, null, 2) + '\n');
} catch (error) {
  record.failure = { command: error.command, seconds: error.seconds, counts: error.counts,
    message: error.message.slice(-2000) };
  record.completedAt = new Date().toISOString();
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + '\n');
  throw error;
} finally { await rm(directory, { recursive: true, force: true }); }
