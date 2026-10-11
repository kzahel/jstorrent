import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownerId = 158352;
const repository = 'kzahel/rstorrent';
const shaPattern = /^[a-f0-9]{40}$/;

export function eligible(pr, expectedSha) {
  return pr.state === 'open' && !pr.draft && pr.user.id === ownerId &&
    pr.head.repo?.full_name === repository && pr.base.repo?.full_name === repository &&
    pr.base.ref === 'main' && shaPattern.test(pr.head.sha) && shaPattern.test(pr.base.sha) &&
    (!expectedSha || pr.head.sha === expectedSha);
}

export function changedLines(files) {
  const result = new Map();
  for (const file of files) {
    const lines = new Set(); let line = null;
    for (const text of (file.patch ?? '').split('\n')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (match) { line = Number(match[1]); continue; }
      if (line === null || text.startsWith('\\')) continue;
      if (text.startsWith('+') || text.startsWith(' ')) lines.add(line++);
      else if (!text.startsWith('-')) line = null;
    }
    result.set(file.filename, lines);
  }
  return result;
}

const text = (value, limit) => {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid review text');
  return value.replaceAll('@', '@\u200b');
};
const keys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...expected].sort().join()) throw new Error('Unexpected review fields');
};

export function reviewPayload(data, metadata, files) {
  keys(data, ['summary', 'findings', 'validation', 'limitations']);
  if (!Array.isArray(data.findings) || data.findings.length > 20 || !Array.isArray(data.validation) ||
      data.validation.length > 30 || !Array.isArray(data.limitations) || data.limitations.length > 20) throw new Error('Review lists exceed limits');
  if (!shaPattern.test(metadata.head_sha) || !Number.isSafeInteger(metadata.pr)) throw new Error('Invalid review metadata');
  const lines = changedLines(files);
  const comments = data.findings.map(finding => {
    keys(finding, ['title', 'body', 'priority', 'path', 'line']);
    if (!Number.isInteger(finding.priority) || finding.priority < 0 || finding.priority > 3 ||
        !Number.isInteger(finding.line) || !lines.get(finding.path)?.has(finding.line)) throw new Error('Finding is outside the PR diff');
    return { path: finding.path, line: finding.line, side: 'RIGHT',
      body: `**[P${finding.priority}] ${text(finding.title, 160)}**\n\n${text(finding.body, 4000)}` };
  });
  const validation = data.validation.map(check => {
    keys(check, ['command', 'result']);
    return `- ${text(check.command, 300)}: ${text(check.result, 1500)}`;
  });
  const marker = `<!-- agent-review:${metadata.head_sha} -->`;
  const body = `${marker}\nReviewed commit ${metadata.head_sha}.\n\n${text(data.summary, 4000)}\n\n` +
    `Validation:\n${validation.length ? validation.join('\n') : 'No additional checks were run.'}\n\n` +
    `Limitations:\n${data.limitations.length ? data.limitations.map(s => '- ' + text(s, 1500)).join('\n') : 'None reported.'}`;
  if (body.length + comments.reduce((n, c) => n + c.body.length, 0) > 30_000) throw new Error('Review exceeds publication limit');
  return { commit_id: metadata.head_sha, event: 'COMMENT', body, comments };
}

async function api(path, body) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub API failed (${response.status})`);
  return response.json();
}
async function pages(path, maximum = 30) {
  const result = [];
  for (let page = 1; page <= maximum; page++) {
    const items = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    result.push(...items); if (items.length < 100) return result;
  }
  throw new Error('GitHub list exceeds limit');
}
function git(args, cwd, home) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd, env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('PR checkout failed');
  return result.stdout.trim();
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Only the trusted main workflow may run');
  const root = resolve(process.env.REVIEW_DIR);
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH));
  if (process.argv[2] === 'prepare') {
    let number; let expectedSha; let ci;
    if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
      ci = event.workflow_run;
      if (ci.event !== 'pull_request' || ci.head_repository?.full_name !== repository || !shaPattern.test(ci.head_sha)) return;
      const workflow = await api(`actions/workflows/${ci.workflow_id}`);
      if (workflow.path !== '.github/workflows/ci.yml') return;
      expectedSha = ci.head_sha;
      const candidates = ci.pull_requests?.length ? ci.pull_requests : await api(`commits/${expectedSha}/pulls`);
      if (candidates.length !== 1) return;
      number = candidates[0].number;
    } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^\d{1,8}$/.test(event.inputs?.pr ?? '')) {
      number = Number(event.inputs.pr);
    } else return;
    const pr = await api(`pulls/${number}`);
    if (!eligible(pr, expectedSha)) return;
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(`${root}/git-home`, { recursive: true, mode: 0o700 });
    await mkdir(`${root}/repo`, { recursive: true, mode: 0o700 });
    git(['init', '.'], `${root}/repo`, `${root}/git-home`);
    // Public fetch, with no GH_TOKEN or persisted credential helper.
    git(['fetch', '--no-tags', 'https://github.com/' + repository + '.git', pr.head.sha, pr.base.sha], `${root}/repo`, `${root}/git-home`);
    git(['checkout', '--detach', pr.head.sha], `${root}/repo`, `${root}/git-home`);
    const baseSha = git(['merge-base', pr.base.sha, pr.head.sha], `${root}/repo`, `${root}/git-home`);
    let jobs = [];
    if (ci) jobs = (await api(`actions/runs/${ci.id}/jobs?per_page=100`)).jobs.map(j => ({ name: j.name, conclusion: j.conclusion }));
    await writeFile(`${root}/metadata.json`, JSON.stringify({ pr: number, head_sha: pr.head.sha, base_sha: baseSha,
      ci: ci ? { url: ci.html_url, conclusion: ci.conclusion, jobs } : null }));
    await appendFile(process.env.GITHUB_OUTPUT, `eligible=true\npr=${number}\nsha=${pr.head.sha}\n`);
  } else if (process.argv[2] === 'publish') {
    const metadata = JSON.parse(await readFile(`${root}/metadata.json`));
    const data = await readFile(`${root}/result.json`);
    if (data.length > 64 * 1024) throw new Error('Review output exceeds limit');
    const pr = await api(`pulls/${metadata.pr}`);
    if (!eligible(pr, metadata.head_sha)) { console.log('Skipped stale or ineligible PR'); return; }
    const previous = await pages(`pulls/${metadata.pr}/reviews`);
    const marker = `<!-- agent-review:${metadata.head_sha} -->`;
    if (previous.some(r => r.user?.type === 'Bot' && r.body?.includes(marker))) { console.log('Review already published'); return; }
    const payload = reviewPayload(JSON.parse(data), metadata, await pages(`pulls/${metadata.pr}/files`));
    // Recheck immediately before posting; the review remains bound to commit_id.
    if (!eligible(await api(`pulls/${metadata.pr}`), metadata.head_sha)) return;
    const review = await api(`pulls/${metadata.pr}/reviews`, payload);
    console.log(`Published review: ${review.html_url}`);
  } else throw new Error('Expected prepare or publish');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
