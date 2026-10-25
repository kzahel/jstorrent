import { spawnSync } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativePackages = new Set(['rstorrent-desktop', 'rstorrent-android', 'rstorrent-ios']);
const shaPattern = /^[a-f0-9]{40}$/;
const documentation = path => /^(docs\/.*|README\.md|DEVELOPMENT\.md|AGENTS\.md|CLAUDE\.md)$/.test(path) &&
  /\.(md|png|jpg|svg)$/.test(path);
const localizationTools = new Set([
  'scripts/check-localization.mjs', 'scripts/localization.py', 'scripts/localization-icu.mjs',
  'scripts/localization-ya.py', 'scripts/translation_terms.py',
  'scripts/test_shared_localization.py', 'scripts/test_localization_ya.py',
  'clients/android/scripts/localization.py', 'clients/android/scripts/test_localization.py',
  'clients/android/scripts/check-locale-config.mjs',
]);
const localizationInput = path => localizationTools.has(path) || path.startsWith('localization/') ||
  /^clients\/desktop\/src-tauri\/locales\/[^/]+\.json$/.test(path) ||
  /^clients\/android\/app\/src\/(main|debug)\/res\/values(?:-[^/]+)?\/strings\.xml$/.test(path);

export function requireFastSuccess(jobs) {
  if (jobs.plan?.result !== 'success') throw new Error('Selection did not succeed');
  for (const flag of ['rust', 'unitTests', 'contract', 'web', 'extension', 'website', 'notices']) {
    if (!['true', 'false'].includes(jobs.plan.outputs?.[flag])) throw new Error(`Missing selection: ${flag}`);
  }
  const required = { tools: true, rust: jobs.plan.outputs.rust === 'true',
    contract: jobs.plan.outputs.contract === 'true',
    web: jobs.plan.outputs.web === 'true' || jobs.plan.outputs.extension === 'true',
    website: jobs.plan.outputs.website === 'true',
    notices: jobs.plan.outputs.notices === 'true' };
  for (const [name, selected] of Object.entries(required)) {
    const expected = selected ? 'success' : 'skipped';
    if (jobs[name]?.result !== expected) throw new Error(`${name}: ${jobs[name]?.result}, expected ${expected}`);
  }
}

// Native adapter tests, feature variants, integration targets and generated
// platform boundaries remain in full CI. This lane tests affected portable libs.
export function planChecks(paths, metadata) {
  const root = resolve(metadata.workspace_root);
  const members = metadata.packages.filter(p => metadata.workspace_members.includes(p.id));
  const byDirectory = members.map(p => [relative(root, dirname(p.manifest_path)).split(sep).join('/'), p]);
  const portable = members.filter(p => !nativePackages.has(p.name));
  const selected = new Set(); let allRust = false;
  let web = false; let extension = false; let website = false; let notices = false;
  for (const path of paths) {
    if (/(^|\/)Cargo\.(toml|lock)$/.test(path) || path.startsWith('vendor/') ||
        path.startsWith('distribution/') || /^scripts\/(prepare-release-notices|glib_backport)\.py$/.test(path) ||
        /^clients\/web\/package(-lock)?\.json$/.test(path) || path === 'clients/web/scripts/patch-playsvideo.mjs' ||
        path === '.github/workflows/fast-ci.yml' || path === '.github/scripts/fast-ci.mjs') notices = true;
    if (documentation(path)) continue;
    // Offline translation and catalog checks run in the web lane. Copy-only
    // edits do not require rebuilding the Rust engine or unrelated products.
    if (localizationInput(path)) { web = true; continue; }
    const owner = byDirectory.find(([directory]) => path.startsWith(directory + '/'))?.[1];
    if (owner && !path.endsWith('Cargo.toml')) {
      if (nativePackages.has(owner.name)) allRust = true;
      else selected.add(owner.name);
      if (owner.name === 'rstorrent-desktop') web = true;
    } else if (path.startsWith('clients/web/')) web = true;
    else if (path.startsWith('clients/extension/')) extension = true;
    else if (path.startsWith('website/')) website = true;
    else if (path.startsWith('clients/android/') || path.startsWith('clients/ios/')) allRust = true;
    else { allRust = true; web = true; extension = true; website = true; }
  }
  if (allRust) for (const p of portable) selected.add(p.name);
  const testPackages = portable.filter(p => selected.has(p.name) &&
    p.targets.some(t => t.kind.some(kind => ['lib', 'rlib', 'proc-macro'].includes(kind)))).map(p => p.name).sort();
  let added = true;
  while (added) {
    added = false;
    for (const p of members) {
      if (!selected.has(p.name) && p.dependencies.some(d => d.path && selected.has(d.name))) {
        selected.add(p.name); added = true;
      }
    }
  }
  const packages = portable.filter(p => selected.has(p.name)).map(p => p.name).sort();
  // Only gateway dependencies can change the generated application contract.
  const contract = packages.includes('rstorrent-gateway');
  return { rust: packages.length > 0, unitTests: testPackages.length > 0, packages, testPackages,
    web: web || contract, contract, extension, website, notices };
}

function command(args) {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}
async function main() {
  const phase = process.argv[2] ?? 'plan';
  if (phase === 'gate') {
    requireFastSuccess(JSON.parse(process.env.NEEDS_JSON));
    console.log('Every selected fast check passed. Full platform qualification is separate.');
    return;
  }
  if (phase !== 'plan') {
    const packages = JSON.parse((phase === 'compile' || phase === 'test'
      ? process.env.FAST_CI_TEST_PACKAGES : process.env.FAST_CI_PACKAGES) ?? '[]');
    if (!Array.isArray(packages) || !packages.length || packages.some(p => typeof p !== 'string' || !/^rstorrent-[a-z-]+$/.test(p))) {
      throw new Error('Invalid Rust package selection');
    }
    const selection = packages.flatMap(p => ['-p', p]);
    const commands = {
      lint: ['cargo', 'clippy', '--locked', ...selection, '--all-targets', '--', '-D', 'warnings'],
      compile: ['cargo', 'test', '--locked', ...selection, '--lib', '--no-run', '--timings'],
      test: ['cargo', 'test', '--locked', ...selection, '--lib'],
      contract: ['cargo', 'run', '--locked', '-p', 'rstorrent-gateway', '--bin', 'export_types', '--',
        'clients/web/src/api/generated/v1.ts', 'clients/web/src/api/generated/v1.schema.json',
        'clients/web/src/fixtures/reactive-trace.json', 'clients/web/src/fixtures/view-set-trace.json'],
    };
    if (!commands[phase]) throw new Error('Unknown check phase');
    const result = spawnSync(commands[phase][0], commands[phase].slice(1), { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    if (phase === 'contract') command(['git', 'diff', '--exit-code', '--', 'clients/web/src/api/generated',
      'clients/web/src/fixtures/reactive-trace.json', 'clients/web/src/fixtures/view-set-trace.json']);
    return;
  }
  const metadata = JSON.parse(command(['cargo', 'metadata', '--locked', '--no-deps', '--format-version', '1']));
  const base = process.env.FAST_CI_BASE_SHA;
  let paths;
  if (base && shaPattern.test(base) && !/^0+$/.test(base)) {
    const ancestor = command(['git', 'merge-base', base, 'HEAD']).trim();
    paths = command(['git', 'diff', '--no-renames', '--name-only', '-z', ancestor, 'HEAD']).split('\0').filter(Boolean);
  } else paths = command(['git', 'ls-files', '-z']).split('\0').filter(Boolean);
  const plan = planChecks(paths, metadata);
  await writeFile('fast-ci-plan.json', JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify(plan));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) =>
      `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
