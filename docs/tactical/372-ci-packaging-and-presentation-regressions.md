# Tactical 372: CI Packaging And Presentation Regressions

Status: Complete locally, 2026-10-15. Maintainer-directed CI repair.
Topics: `beta-release-readiness`, `client-surfaces`, `web-ui-design`.

## Scope and stopping condition

Repair failures in full CI run 38769837921 that still apply to current main:
desktop npm notice provenance, stale support-link browser assertions, restored
Settings after reload, and the owned Android pending-file-selection restart.
Stop after reproducing the applicable failures and passing proportional local
checks, including the owned Android lifecycle if product changes are needed.

## Non-goals and dependencies

No publication, release, protocol, engine, database or application API changes.
The maintainer authorized commit, push and hosted qualification on 2026-10-16.
The original run at a9f51e29 is observed separately; it cannot verify
unsubmitted fixes. Existing pinned media source and license remain unchanged.
Read Tacticals 203, 313, 325 and 365 and the client, web, application-view,
Android SAF and release-readiness topics. Protocol-oracle work is inapplicable
to these packaging, presentation and test corrections.

## Invariants, ownership and validation

Accept only the exact reviewed media package/version/license/commit through
npm's HTTPS and SSH spellings. Keep its public preferred-source archive in
notices and reject other origins and mutable revisions. Check the production
lockfile in the existing Python suite without requiring npm installation.

Browser tests retain exact external destinations, injected-opener rejection
and recovery, isolated popups, theme persistence and accessibility. They use
bundled Chromium with owned servers. Android retains zero preconfirmation
payload, file hashes, selection, restart, recheck, exact removal, bounded handles
and disposable AVD cleanup. Diagnose the loading state before changing waits.
No new background owner or resource limit is planned.

Run distribution tests and actual notice generation, web typecheck/unit/build
and deterministic E2E, plus the relevant Android checks and runtime smoke.
Record exact evidence and remaining hosted limitations below.

## Implementation and ownership

The lockfile records the reviewed mediabunny revision as `git+ssh`, while the
notice generator only allowed `git+https`. Both exact spellings now resolve to
the existing public archive; there is no dependency, source or license change.
The Python suite checks the real production lockfile as well as refused sources.

Support tests now cover Report on GitHub with its complete diagnostics body,
Send feedback with exact fixture context, Known issues and Help. All destinations
are locally intercepted in browser tests. The theme test observes the Settings
dialog restored by the URL instead of trying to click through its backdrop.

Android's Compose effect can queue an initial clear before the restored pending
torrent arrives. `ProductEngineService.withPresentation` launches each request
on the service pool and awaits readiness, allowing that old clear to reach the
repository after the newer presentation. The repository's own request generation
is assigned too late to preserve UI order at this outer boundary.

`PendingSelectionPresentation` now reserves order synchronously at the UI call
and discards obsolete actions after dispatch/readiness. One monitor makes the
generation check and repository submission atomic. This small Kotlin owner lives
beside the presentation repository and is testable without an Android Service,
native networking or a clock. It owns only a counter and reuses the service's
existing cancellable scope; repository subscriptions retain their close/join
and terminal-state guards. No task, queue, timeout or file-page bound is added.

## Evidence

Before the fixes, actual `npm_notices()` fails with the hosted integrity error,
and the two stale support-link Playwright cases fail locally. The theme test
passes locally before the fix but fails in hosted CI; its corrected assertion
directly tests the accepted reload behavior. Both controlled Android startup
dispatch orders fail without the request fence: an old clear closes the new
subscription, and an old present reopens a dismissed selection. Both pass with
the fence, together with the other 204 JVM cases.

Passing checks:

- `python3 -m unittest discover -s scripts -p test_distribution_review.py`:
  29 cases, including the real production lockfile without npm installation.
- `python3 scripts/prepare-release-notices.py --output /tmp/jstorrent-ci-notices`:
  real aarch64-apple-darwin notice generation, 462 Rust / 35 npm packages.
- `npm run typecheck --prefix clients/web`;
  `npm run test --prefix clients/web`: 832 passed, 3 skipped;
  `npm run build --prefix clients/web`: production build and CSP check pass.
- `npm run test:e2e --prefix clients/web`: all 71 deterministic cases pass;
  18 explicitly live-only cases are skipped. Bundled Chromium and the owned
  Vite server terminate.
- `cargo fmt --all -- --check` and `git diff --check`.
- `python3 -m unittest discover -s scripts -p 'test_*android*.py'`: 27 cases.
- `uv run --project tests/interop --locked python -m unittest discover -s
  tests/interop -p test_chromeos_qualification.py`: 54 cases.
- `clients/android/build.sh debug` rebuilds both native release ABIs and the
  host library and regenerates both Kotlin boundaries. Its first Gradle stage
  deliberately stops at the two failing-before regressions. An earlier direct
  Gradle attempt exposed stale local generated bindings, resolved by this build.
- After the fence, `clients/android/gradlew -p clients/android assembleDebug
  testDebugUnitTest lintDebug assembleDebugAndroidTest`: succeeds, 206 JVM tests.
- `python3 scripts/inspect-android-notices.py --archive
  clients/android/app/build/outputs/apk/debug/app-debug.apk --variant debug`:
  84 Maven artifacts, 206 Rust packages and six native libraries verify.
- The ordinary `scripts/android-runtime-smoke.py --output
  /tmp/jstorrent-ci-android-after.json` entry point runs through a temporary
  Python diagnostic wrapper using the locked interop environment. Earlier local
  runs hit macOS `killpg` EPERM after the product runner exited; the wrapper
  tolerates that only if `ps` independently proves the entire owned group absent.
  That fallback is unused on the final successful run. The wrapper is temporary
  and does not change the repository's cleanup contract.

The rebuilt debug APK SHA-256 is
`7a474486e19d7d337bf6ae7cf61db91f3cbc8f11520280d52bdf5536d80fb850`.
The full owned API 35 ARM64 profile passes on image revision 9: zero
preconfirmation content upload, selected/skipped-file checks, restart and Force
recheck, joined keep-payload cancellation, pre-metadata Download all overriding
source selection, exact hashes and removal. Selective and Download-all storage
peaks are respectively 3/40 and 6/40 handles. Cleanup is `ok`, the owned AVD
directory is removed, and no owned emulator remains. This is local ARM64
evidence, not hosted x86_64 qualification.

No Rust source or application contract changes, so additional engine workspace
tests and protocol qualification are inapplicable. Temporary reports, notices,
captures and diagnostic logs are removed. No publication occurs. The checks
above are local evidence; hosted qualification is recorded by the submitted
commit's GitHub Actions checks.

Initial hosted observation: at a9f51e29, full run
[38802110319](https://github.com/kzahel/jstorrent/actions/runs/38802110319)
fails exactly the same
three assertions repaired here (theme reload and both support-link cases).
Fast CI 38802110400 passes. The full run's four desktop package jobs fail notice
generation; Rust, Android, iOS, extension and workflow tools pass. These runs
contain none of this tactical's changes and are not verification of them.
