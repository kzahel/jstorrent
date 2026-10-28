import test from 'node:test';
import assert from 'node:assert/strict';
import { planChecks, requireFastSuccess } from './fast-ci.mjs';

const names = ['protocol', 'engine', 'session', 'gateway', 'unrelated', 'desktop', 'android', 'ios'];
const dependencies = { engine: ['protocol'], session: ['engine'], gateway: ['session'], desktop: ['gateway'] };
const metadata = { workspace_root: '/repo', workspace_members: names,
  packages: names.map(name => ({ id: name, name: `rstorrent-${name}`,
    manifest_path: `/repo/${name === 'desktop' ? 'clients/desktop/src-tauri' : `crates/rstorrent-${name}`}/Cargo.toml`,
    targets: [{ kind: ['lib'] }], dependencies: (dependencies[name] ?? []).map(d => ({ name: `rstorrent-${d}`, path: `/repo/crates/rstorrent-${d}` })) })) };
test('portable dependents are selected transitively without unrelated crates or native builds', () => {
  const p = planChecks(['crates/rstorrent-engine/src/lib.rs'], metadata);
  assert.deepEqual(p.packages, ['rstorrent-engine', 'rstorrent-gateway', 'rstorrent-session']);
  assert.deepEqual(p.testPackages, ['rstorrent-engine']);
  assert.equal(p.contract, true); assert.equal(p.web, true);
});
test('excluded native roots do not break transitive impact on a portable dependent', () => {
  const bridge = { id: 'bridge', name: 'rstorrent-bridge', manifest_path: '/repo/crates/rstorrent-bridge/Cargo.toml',
    targets: [{ kind: ['lib'] }], dependencies: [{ name: 'rstorrent-desktop', path: '/repo/clients/desktop/src-tauri' }] };
  const expanded = { ...metadata, workspace_members: [...metadata.workspace_members, bridge.id],
    packages: [...metadata.packages, bridge] };
  assert.ok(planChecks(['crates/rstorrent-engine/src/lib.rs'], expanded).packages.includes('rstorrent-bridge'));
});
test('shared inputs, native changes and unknown paths conservatively check portable Rust', () => {
  for (const path of ['Cargo.lock', 'Cargo.toml', 'rust-toolchain.toml', '.cargo/config.toml', 'vendor/x/src/lib.rs',
    'crates/rstorrent-engine/Cargo.toml', 'clients/desktop/src-tauri/src/lib.rs', 'clients/android/app/foo.kt',
    'crates/new/src/lib.rs', '.github/workflows/fast-ci.yml']) {
    assert.equal(planChecks([path], metadata).packages.length, 5, path);
  }
});
test('documentation-only changes skip product builds; web, extension and website remain distinct', () => {
  assert.deepEqual(planChecks(['docs/tactical/example.md', 'README.md'], metadata),
    { rust: false, unitTests: false, packages: [], testPackages: [], web: false, contract: false, extension: false, website: false, notices: false });
  const p = planChecks(['clients/web/src/app.tsx'], metadata);
  assert.equal(p.web, true); assert.equal(p.rust, false); assert.equal(p.contract, false);
  assert.equal(planChecks(['clients/extension/manifest.json'], metadata).extension, true);
  assert.equal(planChecks(['website/src/index.astro'], metadata).website, true);
  assert.equal(planChecks(['docs/example.py'], metadata).rust, true);
});
test('deletions and moved old paths retain their former dependency impact', () => {
  const p = planChecks(['crates/rstorrent-protocol/src/old.rs', 'docs/new.md'], metadata);
  assert.deepEqual(p.packages, ['rstorrent-engine', 'rstorrent-gateway', 'rstorrent-protocol', 'rstorrent-session']);
});
test('translation-only changes run catalog and offline checks without engine builds', () => {
  for (const path of ['localization/terminology/de.json', 'localization/android/de.json',
    'clients/desktop/src-tauri/locales/de.json', 'clients/desktop/src-tauri/locales/en.comments.json',
    'clients/android/app/src/debug/res/values-de/strings.xml',
    'clients/android/app/src/main/res/values-de/strings.xml',
    'clients/android/app/src/main/res/values/strings.xml', 'clients/android/scripts/localization.py',
    'scripts/localization.py', 'scripts/localization-ya.py', 'scripts/localization-icu.mjs',
    'scripts/translation_terms.py', 'scripts/check-localization.mjs',
    'scripts/localization-registry.mjs', 'scripts/test-localization-registry.mjs',
    'scripts/desktop-locale-smoke.py', 'scripts/test_desktop_localization_smoke.py',
    'scripts/test_shared_localization.py', 'scripts/test_localization_ya.py',
    'scripts/localization-codex.py', 'scripts/test_localization_codex.py',
    'scripts/localization-campaign.py', 'scripts/test_localization_campaign.py']) {
    const plan = planChecks([path], metadata);
    assert.equal(plan.web, true, path);
    assert.deepEqual(plan.packages, [], path);
    assert.equal(plan.extension, false, path);
    assert.equal(plan.website, false, path);
  }
});
test('the aggregate requires selected jobs and tools, with explicit unselected skips', () => {
  const jobs = { plan: { result: 'success', outputs: { rust: 'true', unitTests: 'true', contract: 'true', web: 'true', extension: 'false', website: 'false', notices: 'true' } },
    rust: { result: 'success' }, contract: { result: 'success' }, web: { result: 'success' }, website: { result: 'skipped' }, notices: { result: 'success' }, tools: { result: 'success' } };
  assert.doesNotThrow(() => requireFastSuccess(jobs));
  for (const name of ['plan', 'rust', 'contract', 'web', 'notices', 'tools']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.throws(() => requireFastSuccess({ ...jobs, [name]: { ...jobs[name], result } }));
    }
  }
  assert.throws(() => requireFastSuccess({ ...jobs, website: { result: 'failure' } }));
  assert.throws(() => requireFastSuccess({ ...jobs, plan: { result: 'success', outputs: {} } }));
  const docs = { ...jobs, plan: { result: 'success', outputs: { rust: 'false', unitTests: 'false', contract: 'false', web: 'false', extension: 'false', website: 'false', notices: 'false' } },
    rust: { result: 'skipped' }, contract: { result: 'skipped' }, web: { result: 'skipped' }, notices: { result: 'skipped' } };
  assert.doesNotThrow(() => requireFastSuccess(docs));
  assert.throws(() => requireFastSuccess({ ...docs, tools: { result: 'failure' } }));
});
test('dependency and provenance changes select notice checks before packaging', () => {
  for (const path of ['Cargo.lock', 'Cargo.toml', 'crates/rstorrent-engine/Cargo.toml',
    'clients/desktop/src-tauri/Cargo.toml', 'clients/web/package.json', 'clients/web/package-lock.json',
    'distribution/licenses/cargo-sources.json', 'distribution/licenses/example.txt', 'distribution/about.toml',
    'vendor/glib-0.18.5/src/lib.rs', 'scripts/prepare-release-notices.py', 'scripts/glib_backport.py',
    'clients/web/scripts/patch-playsvideo.mjs', '.github/workflows/fast-ci.yml', '.github/scripts/fast-ci.mjs']) {
    assert.equal(planChecks([path], metadata).notices, true, path);
  }
  for (const path of ['README.md', 'clients/web/src/app.tsx', 'crates/rstorrent-engine/src/lib.rs',
    'website/package-lock.json']) {
    assert.equal(planChecks([path], metadata).notices, false, path);
  }
});
test('binary-only packages are linted without inventing a library test target', () => {
  const binary = { id: 'tool', name: 'rstorrent-tool', manifest_path: '/repo/crates/rstorrent-tool/Cargo.toml',
    targets: [{ kind: ['bin'] }], dependencies: [] };
  const expanded = { ...metadata, workspace_members: [...metadata.workspace_members, binary.id], packages: [...metadata.packages, binary] };
  const p = planChecks(['crates/rstorrent-tool/src/main.rs'], expanded);
  assert.deepEqual(p.packages, ['rstorrent-tool']); assert.deepEqual(p.testPackages, []);
  assert.equal(p.rust, true); assert.equal(p.unitTests, false);
});
