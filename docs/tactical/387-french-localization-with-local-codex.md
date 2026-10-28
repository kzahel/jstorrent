# 387 — French localization with local Codex

Status: **Complete.** French release inputs are enabled and qualified locally;
no release, store submission or installed production app was changed.

## Scope and stopping condition

Complete French (`fr`) for the shared React UI, native desktop shell and
Android. The maintainer requested local Codex `gpt-6.1-sol`, high reasoning,
normal speed (no fast tier), and bypass permissions for translation and
independent review. Use the existing ChatGPT-authenticated local CLI; do not
route this campaign through Claude or a work-account pool.

Add a maintained local CLI runner reusing the existing export, worker prompts,
validation and importer. Every batch receives a fresh translating session and
a separate reviewing session. Verify launch evidence before accepting results,
retain exact session identities in per-message provenance, and resume completed
work without starting replacement sessions. Catalog writes remain owned by one
importer per platform. No third-party translation source is copied.

Set shared French register (concise neutral French, vous when direct address is
needed), terminology and native plural categories before freezing source jobs.
Register complete reviewed catalogs for preview qualification, then complete
release registration and package checks within this task. Publishing binaries,
store submissions, iOS and website/store/support translation are out of scope.
Existing German translations, locale preferences, engine/application contracts,
durable stores and installed production profiles must be preserved.

Stopping condition: all three French catalogs are complete, independently
reviewed, current and selectable in qualified release inputs; source/catalog,
tooling, web/browser, native desktop and Android checks pass; evidence and
remaining platform limitations are recorded; owned workers and temporary
artifacts are cleaned; completed work is committed. No publication occurs.

## Ownership and resource limits

The runner owns its process groups, bounded output logs, timeout, signal
cancellation and joined termination. Workers write only their exact ignored
response paths and may validate, but never import or edit product sources.
Work state binds the frozen jobs, requested settings and validated output
hashes. Unconfirmed process ownership or changed jobs/results must fail closed.
Resume revalidates imports idempotently rather than trusting task state alone.

Use at most three active local workers across all platform runners; batches
contain at most 100 resources and workers at most four batches. Start with an
80-resource batch size and at most three batches per worker. Bound each worker
to 30 minutes and its output files to the existing 16 MiB JSON limit. Keep
machine paths, CLI configuration and authentication outside tracked files.

## Validation

- Runner regressions: exact model/effort/tier/permission arguments, provenance,
  separate review, rejection of corrupt/stale/mutated output, safe resumption,
  cancellation and process termination.
- Existing shared, YA and Android workflow tests; registry/generator checks;
  global localization and branding checks; deterministic generation.
- Web typecheck and full unit suite; French live switching, formatting,
  plurals, focus/persistence and responsive accessibility browser checks.
- Preview and release assets, CSP and language availability; native catalog,
  menu and isolated desktop-product locale smoke; proportional desktop compile.
- Android resource compilation, lint, native locale configuration and owned
  API 28/35 actual-locale layout/lifecycle evidence. Do not target arbitrary
  attached devices or change the maintainer's installed production app.

## Execution evidence

### Authoring and ownership

All 2,479 current resources are complete and independently reviewed: 1,797
React, 20 native desktop and 662 Android. Every French per-message ledger names
different translating/reviewing sessions using `gpt-6.1-sol`. The 24 base workers
and four small correction workers (French and German) all completed with actual
rollout evidence matching high reasoning, normal tier, never approvals and
danger-full-access. The separate launcher probe and implementation review used
the same requested settings. No YA work pool, API-key provider or third-party
translation catalog was used.

Final glossary review found two inherited German examples in the English-language
French guidance for completion and resumption. They are now French examples.
A fresh independent local session, with the same verified settings, reviewed
all 57 affected entries (42 React, one desktop, 14 Android) against frozen
terminology snapshots. It required no catalog corrections. Explicit terminology
adoption records that session while retaining original translator/reviewer
identities; no catalog or generated runtime value changed.

The local runner reuses the maintained YA worker prompts, snapshot guidance,
validators and importer. Its own process-backed regression suite verifies
separate review, normal launch evidence, corrupted/mutated output rejection,
exact resumption, kernel locking, interrupted launch recovery and termination
of descendants after their leader exits. Independent implementation review
identified stale-lock recovery races, post-launch bookkeeping gaps and process
group cleanup gaps; these are fixed. Direct local worker ownership is explicitly
supported on macOS/Linux, without an unsafe Windows signal-zero probe.

Completed React and native-desktop jobs were resumed using the same commands:
zero new workers started, exact imports revalidated, and SHA-256 checks showed
no changes to either French catalog or its provenance. Per-message metadata and
catalog checks have no missing, stale, invalid, conflicting, unreviewed or
terminology-affected entries. Except for the single independently reviewed
Android correction below, all pre-existing German messages, terminology and
review records are byte-identical to the campaign's starting point.

### French-specific fixes and packaging

French uses `one`, `many` and `other`; zero and one share a category, while
million counts exercise `many`. Android lint found an existing count-free
pronoun plural (`remove_folder_torrents_wait`) that could not honestly add a
count argument absent from its source contract. It is now one complete,
count-neutral sentence: "Transfers stop until you choose this folder again."
The call site uses a string resource, and fresh one-message French/German jobs
completed independent translation/review/import. No lint suppression was added.
All other Android resources and the selected-folder behavior are unchanged.

French resources live in Android's main source set and in the shared/native
shipping lists. German remains preview-only; iOS remains English-only. Native
LocaleConfig and React catalog registration were regenerated. The in-app picker
must work offline independently of the system language, so Android language
splits are disabled and the actual AAB configuration is validated. This follows
[Android's documented bundle guidance](https://developer.android.com/guide/app-bundle/configure-base#handling_language_changes)
without introducing a Play language-download dependency. ABI/density handling,
signing identities, release versions, durable stores and application contracts
are unchanged.

### Validation and limits

- `npm run typecheck --prefix clients/web` passes. Final
  `npm run test --prefix clients/web`: 925 cases pass, three existing skips.
  French tests cover release availability, regional negotiation, zero/one/
  million plurals, percentages and decimal-comma formatting. Synthetic preview
  fixtures explicitly isolate themselves from the newly shipping language.
- `npm run test:e2e --prefix clients/web -- french-localization.spec.ts
  german-localization.spec.ts localization.spec.ts`: all 16 bundled-Chromium
  cases pass, including French desktop/390px layout, Axe, destructive copy,
  selection retention, System/override/reload, peer labels and German/pseudo
  regressions. An actual production build also passes French System selection,
  explicit persistence/reload and German exclusion with its saved preference
  preserved. The browser/server are closed by their owner.
- Vite ordinary release/preview and companion/remote frontend builds pass.
  Remote uses a local qualification build ID, nonconnecting example relay URL
  and the existing unchanged Wasm artifact; no remote engine build or deployed
  relay qualification is claimed. The existing `dynamicCodeViolations` CSP
  guard passes 51 ordinary + 51 preview + one companion + 28 remote JavaScript
  bundles. French is included in every output; German appears only in preview.
- `python3 -m unittest discover -s scripts -p 'test_*localization*.py'`:
  55 cases pass, including nine local-runner cases. Android adapter discovery
  adds 13 cases. `node --test scripts/test-localization-registry.mjs
  .github/scripts/fast-ci.test.mjs`: 13 cases pass. Focused native-smoke tooling
  and Android release-validator tests pass too. The global localization and
  branding checks pass (2,724 display values and 40 original assets).
- `cargo fmt --all -- --check`, `cargo clippy -p rstorrent-desktop --example
  desktop_locale_smoke -- -D warnings`, `cargo test -p rstorrent-desktop --lib`
  (91 cases), and `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1 cargo check --release
  -p rstorrent-desktop --lib` pass. The parameterized real native menu/IPC
  example passes 17/17 with `-- fr`.
- `python3 scripts/desktop-locale-smoke.py --locale fr --frontend-dir
  .local/387-french/assets-preview --restore-frontend-dir
  .local/387-french/assets-release` passes 29/29 on two final runs: 16 live and
  13 after restart, with preference persistence, System reset, keyboard focus,
  retained host/profile/views and joined shutdown. An initial concurrent run
  timed out waiting for System-radio focus after its language/persistence checks
  passed. That failure did not reproduce with the unchanged product in the
  instrumented and final repeats. Timeout diagnostics now report focused radio
  state; no speculative product focus change was made. The normal debug binary
  is restored from frozen ordinary assets after each run.
- Normal `clients/android/build.sh release` passes with the existing original
  signing environment, building both Rust ABIs, generating Kotlin and running
  release unit tests/lint. Final Gradle `bundleRelease assembleDebug
  assembleDebugAndroidTest lintDebug testDebugUnitTest` passes after the bundle
  configuration change; both debug and release unit suites pass 220 cases each.
  Signed APK/AAB validation passes with the pinned
  bundletool, original certificate, correct identity, matching ABIs and 16 KiB
  alignment. Actual bundle configuration has `LANGUAGE` splitting negated.
- `python3 clients/android/scripts/run-localization-matrix.py --api 28 --api 35
  --locale fr --class org.rstorrent.bootstrap.LanguageSelectionInstrumentationTest,
  org.rstorrent.bootstrap.LanguageActivityRecreationTest,
  org.rstorrent.bootstrap.LocalizationComposeTest,
  org.rstorrent.bootstrap.FrenchLocalizationInstrumentationTest,
  org.rstorrent.bootstrap.LocalizationInstrumentationTest` passes. The class
  argument is supplied as one comma-separated value without spaces. Fresh
  owned API 28 phone and API 35 tablet runs execute eight and ten cases;
  API-33-only methods are excluded on API 28. Checks include native French
  resources, zero/one/two/million counts, retained language/navigation/service
  ownership through activity recreation, notifications and reachable dialog
  controls. Both AVDs are removed afterward.

Runtime qualification here is macOS and owned Android emulators; Windows/Linux
native runtime and actual Google Play delivery are not claimed. All local model
workers are complete, test apps/servers/emulators are stopped and temporary
translation, capture and build snapshots are removed. Native production profiles,
browser registration and the maintainer's existing device apps are preserved.
