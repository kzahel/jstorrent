# 385 — Configured locale registration

Status: **Complete.**

## Scope And Invariants

Make the shared translation workflow ready for another language without editing
runtime language switches or applying German instructions to other locales.
`localization/locales.json` remains the platform shipping/preview registry and
adds per-locale direction metadata. Shared terminology files continue to own
register and wording guidance. Preserve all existing German source/translation/
terminology hashes and JSON preference values; no new locale is enabled.

React generation/watchers, native build catalog registration and Android's
existing generated LocaleConfig consume the registry. Packaged catalogs and
language lists agree; native desktop locales must have matching React support
at the corresponding shipping/preview tier. Unregistered/stale catalog files
must never become selectable or be accidentally packaged. English is the source
and final fallback. Runtime preview gates and release asset exclusion remain.

The runner reads locale-specific register/terminology from bound job snapshots,
requires an explicit target locale, and checks that guidance is internally
consistent before starting a worker. No model sessions or real translations
are needed for this preparation. No engine, database, external contract or
installed user data changes are in scope.

## Implementation And Validation

1. Add registry validation and direction metadata, generic catalog discovery and
   regional fallback. Keep Android's native resource/LocaleConfig authority.
2. Generalize React and native catalog registration, preference validation,
   locale resolution and release/preview separation.
3. Replace German-specific worker prompts with snapshot-bound locale guidance;
   retain terminology fingerprints and safe resumption/import behavior.
4. Prove French and regional/RTL cases using isolated fixtures, without adding
   real French catalogs, provenance or availability to the product.
5. Update the runbook with exact per-language configuration, generation,
   translation, preview validation and later promotion steps.

Required checks: registry/generator/prompt regression tests; existing offline
adapter/runner tests and global catalog checker; React typecheck/unit/relevant
language browser gates; native locale tests, formatting, clippy and release
compile; Android LocaleConfig generation check (runtime unchanged); deterministic
generation and preview/release asset checks. Broaden only for integration
failures. Test processes and disposable fixtures must be cleaned up.

Stopping condition: a fixture language registers from data through generation,
prompt guidance and runtime resolution; existing German behavior/evidence and
English-only releases are preserved; the maintained runbook explains the next
language; proportional checks pass and the work is committed.

## Outcome And Evidence

The registry now declares locale direction as data and validates platform lists,
canonical tags, pseudo separation and native/React tier compatibility. React
compiles a deterministic typed static-import module from registered catalogs;
native Cargo validates the shared registry and generates its table in OUT_DIR.
Android's existing native picker continues reading generated LocaleConfig.
Unregistered stale files stay outside imports; registered missing catalogs fail.
Shipping catalogs remain available independently of preview flags. Promotion
requires explicit release provenance rather than reusing preview qualification.

The runner requires `--locale`, reads register from each frozen export and
rejects missing/mismatched styles. French translator and terminology-review
fixtures use vous guidance without German defaults. Register snapshots are
checked against current configuration without changing existing fingerprints.
The QA front door accepts a registered `--locale` and rejects undeclared or
incomplete targets before Cargo. The runbook lists the actual per-language
metadata, Android plural/resource configuration, author/review/import, generated
outputs, preview QA and later promotion steps.

Validation on macOS:

- `node --test scripts/test-localization-registry.mjs
  .github/scripts/fast-ci.test.mjs`: 4 registry/Android-fixture + 9 CI routing
  tests. Fixture French, regional French and RTL registration needs only data;
  Android generation retains English-only release resources.
- `python3 -m unittest discover -s scripts -p 'test_*localization*.py'`: 46 tests,
  including four generic native-QA configuration tests. Android's adapter adds
  13 cases: `python3 -m unittest discover -s clients/android/scripts
  -p test_localization.py`. No external translation/model sessions were started.
- `npm run typecheck --prefix clients/web`, full Vitest (913 passed, three
  existing skips) and six German/pseudo browser cases pass. Fixtures cover
  French/fr-CA/ar-EG registration, System/persistence/native authority, script/
  region parents, direction and stale asset exclusion. A bounded exact-decimal
  fix retains Arabic digits and BigInt precision using cached Intl parts.
- Preview, ordinary release, companion and remote frontend builds pass; the
  preview data is included only with its gate. CSP checks pass across 80 JS
  bundles. Remote reuses its unchanged existing Wasm artifact.
- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`, and
  `cargo test -p rstorrent-desktop --lib` pass (91 desktop cases). The 14 native
  locale/generator cases pass both with the preview flag absent and enabled.
- Preview desktop lib/example clippy, `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1
  cargo check --release -p rstorrent-desktop --lib`, and the real hidden Tauri
  native catalog/menu/IPC example (17 cases) pass. No Windows/Linux runtime or
  real French language qualification is claimed by these fixtures.
- Global `node scripts/check-localization.mjs` passes, including exact generated
  registry comparison and every existing German source/translation/term review.
  CI checks generated output freshness and exercises the new registry tests.
  Workflow actionlint passes; generation is deterministic and diff checks clean.

SHA-256 comparisons confirm all existing German source catalogs, shared
terminology and review ledgers are byte-identical to the start of the task.
No French or RTL product locale was enabled, no installed profile or Pixel app
was changed, and all owned fixtures, traces and test processes were cleaned.
English-only shipping and German preview support remain as before.
