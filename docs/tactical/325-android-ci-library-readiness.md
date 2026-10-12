# Tactical 325: Android CI Library Readiness

Status: Complete locally, 2026-10-13. Repaired-source hosted CI remains unrun.

Topics: `client-surfaces`

## Scope and stopping condition

Repair the owned Android CI SAF profile's first-use completion assertion.
Hosted run [38281520899](https://github.com/kzahel/jstorrent/actions/runs/38281520899)
fails waiting for the retired Live tab; the current default library tab is All.
Every other applicable full-CI job and Fast CI pass at `e7542c57`.
Stop after a failing-before regression, passing helper checks and the actual
owned API 35 file-selection lifecycle pass with cleanup verified.

## Non-goals and dependencies

No product UI, engine, generated contract, storage, permission or statistics
policy changes. Preserve existing unrelated working-tree edits. Publication,
source push and hosted qualification of the repaired source remain separate.
Read Tactical 213, Tactical 310, client-surfaces, application-view-api,
web-ui-design, android-saf-storage and beta-release-readiness. The exact current
LibraryFilter.ALL default and English catalog replace the stale harness label.
Protocol and libtorrent source study are inapplicable to this harness-only fix;
the existing pinned independent peer and payload checks remain unchanged.

## Invariants, ownership and limits

The helper must disable statistics before saving, refresh observed geometry
between actions, and observe the library only after the disclosure disappears.
It retains its 30-second deadline and introduces no new task or mutable owner.
The existing smoke wrapper owns the disposable AVD/process group, 600-second
runtime limit and 4-MiB output cap. Existing exact hashes, preconfirmation
traffic, restart/recheck/removal and handle-limit assertions remain mandatory.

## Validation

Exercise checked-to-unchecked disclosure, fresh Save geometry, current All
library readiness and a bounded missing-library failure. Run the existing
Android Python controls and the actual owned API 35 smoke; record exact results
and emulator cleanup below.

## Results

The original helper fails two of the three new regression cases and reproduces
the hosted `owned product disclosure did not reach the Live library` failure
on a fresh API 35 ARM64 AVD. Replacing the retired label and timeout message
with All preserves the disclosure-first branch and the existing deadline.

The complete repaired smoke passes against the same debug APK SHA-256,
`c75e6a831fa0f80bf795c63fb0dd4fdcfc6874d855eb348f8921dc76605a1c96`,
on `android-35/google_apis/arm64-v8a`, image revision 9. Selective storage peaks
at 3/40 handles; Download all peaks at 6/40. It proves zero preconfirmation
upload, absent skipped files, restart and Force recheck, joined local-torrent
cancellation retaining payload, pre-metadata Download all overriding source
selection, exact hashes and exact removal. Cleanup reports `ok` and the owned
AVD root is removed. Before and after use the existing working-tree APK;
unrelated edits are preserved. This is ARM64 local evidence, not a repaired
hosted x86_64 result.

Passing checks:

- `python3 -m unittest discover -s scripts -p 'test_*android*.py'`: 27 cases,
  including the three new first-use regressions, wrapper cleanup/privacy and
  release controls.
- `uv run --project tests/interop --locked python -m unittest discover -s
  tests/interop -p 'test_android_upload_transport.py'`: five cases.
- `uv run --project tests/interop --locked python -m unittest discover -s
  tests/interop -p 'test_chromeos_qualification.py'`: 54 cases.
- `clients/android/gradlew -p clients/android assembleDebug testDebugUnitTest
  lintDebug assembleDebugAndroidTest`: successful, existing JVM/lint/build
  tasks up to date. No Rust/generated-boundary code changes or ABI rebuild.
- `uv run --project tests/interop --locked python
  scripts/android-runtime-smoke.py --output /tmp/jstorrent-ci-after.json`:
  full owned profile passes; temporary before/after reports are removed.
- `scripts/release-android.sh --check`, `cargo fmt --all -- --check` and
  `git diff --check` pass.

No push or publication occurs. Latest hosted full CI remains failed at
`e7542c57`; the other applicable jobs and Fast CI passed there. The checkout
also contains newer local commits, so a future push must qualify its exact
submitted source rather than rerun the obsolete failed revision.
