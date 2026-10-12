# Tactical 315: Android 1.0.29 Production Release

Status: Complete submission, 2026-10-12. Play quick checks complete;
review/approval pending. Automatic production publication at 100% is configured.

Topics: `android-jstorrent-replacement`, `product-surfaces-and-migration`,
`beta-release-readiness`.

## Authorization, scope and stopping condition

The maintainer explicitly requests a new Android release at 100%, submitted
for review and automatically published to production when approved. Prepare
1.0.29/code 29 from current main plus completed Tactical 314's crash repair.
Include the already landed Android optional file selection (308), simpler
first-use/background setup (310), and notification settings consolidation (311).

Commit the repair and release notes, run the established version/tag/signed CI
lane, independently validate exact signed APK/AAB artifacts, then upload to the
existing `com.jstorrent.app` production track. Configure full availability and
automatic publication after approval. Stop when Console verifies submission
for review, the exact version/code, 100% rollout and automatic publication;
approval itself remains asynchronous and must not be inferred.

Non-goals: no desktop/extension release, new feature, signing-root rotation,
store listing/privacy/permissions change, user library reset, physical-device
mutation, or incubation release. Existing API 28 minimum and both native ABIs
remain. Preserve immutable version 28 artifacts and production app identity.

## Invariants and ownership

Version 29 must exceed the freshly inspected Play maximum. Current source and
the immutable release tag bind every artifact; preserve original upload and
Play app-signing certificates. Hosted release gates validate package/version,
both ABIs, native equality, notices and 16-KiB ELF/ZIP alignment. Source checks
and proportional installed emulator evidence remain distinct from store
approval or production-installed acceptance.

The standard release helper owns version bump, commit, tag and atomic push.
Git identity is verified before pushing. The existing Actions workflow owns
temporary signing inputs, signed artifact checks and downloadable prerelease;
Play owns review and production publication. No new tasks or runtime contracts.
Private store receipts stay ignored; committed status excludes private account
identifiers and credentials. Upload only the independently verified AAB.

The explicit 100% direction supersedes staged-rollout/managed-publication holds
for this release. Do not publish unrelated pending changes without checking
their scope. No further routine approval is required by this tactical.

## Validation and restart checkpoint

Read current Android release/workflow/helpers, shipment 297 and local repair 314.
Play production currently serves 28; fresh maximum-code, pending-change and
managed-publishing checks remain next. Repair 314 already passes 13 regressions,
all 136 debug/release JVM cases, lint, fresh dual-ABI/generated build and notices.
Validate the new version's signed artifacts and hosted source checks before
submission. Record actual release hashes, source/tag, workflow and Console
submission/publication setting evidence below as each step completes.

Play preflight confirms maximum uploaded code 28, production/internal 28 and no
unrelated pending/ready changes; managed publishing is currently on. Release
tool tests pass 24 cases. Git identity is the maintainer; origin is canonical.

## Tagged source and installed emulator checks

The standard helper atomically pushes main and annotated `android-v1.0.29`.
Signed source is `8ddf2e8be2c50e957f2e4946dbde68e58ba76e4d`; preparation/crash
repair commit is `a80cc3c5`. The initial Android Release/source CI in-progress
checkpoint is superseded by the completed results below.

`python3 clients/android/scripts/run-localization-matrix.py --class
'org.rstorrent.bootstrap.ProductNavigationTest,org.rstorrent.bootstrap.ProductBackgroundLifecycleTest#visibleStartCreatesANewGenerationAfterJoinedShutdown'`
passes 29 cases each on fresh owned API 28 phone and API 35 tablet AVDs. This
includes ordinary native joined Shutdown/reopen, all 28 product-navigation
cases and the landed add/background/notification presentation. Both owned
AVDs/emulator processes are removed. These debug cases do not prove Play
installation or exact signed installed bytes.

Read-only open advisory inspection identifies two existing moderate alerts:
experimental iOS probe rustls and desktop GLib. The Android ARM64 dependency
graph selects rustls 0.23.45 and contains no GLib; no new Android dependency
is introduced by this release. Existing unrelated accepted/experimental
review boundaries are unchanged.

## Signed artifact qualification

Android Release [38211702291](https://github.com/kzahel/jstorrent/actions/runs/38211702291)
passes both signed construction and publication at exact tagged source 8ddf2e8b.
The downloadable [JSTorrent Android 1.0.29 prerelease](https://github.com/kzahel/jstorrent/releases/tag/android-v1.0.29)
retains normal Android candidate status and does not replace desktop Latest.

Downloaded Actions artifacts independently match both `SHA256SUMS` and the
public release's asset SHA-256/size metadata:

- AAB: 61,687,137 bytes,
  `ae82abff549e794adff63a55dd01b93e0496fa1b157d46d0c557a60c4d107c8c`.
- APK: 105,280,883 bytes,
  `12c58fb28001701ca986f39ef46b6a2928472ea155da20b801ee19753c360b45`.

`python3 scripts/validate-android-release.py --bundletool
.local/final-cutover-259/bundletool.jar` passes the actual downloaded artifacts:
original upload certificate/signatures, com.jstorrent.app 29/1.0.29, API 28/36,
legacy launcher, non-debuggable/no diagnostic receivers, both native ABIs,
APK/AAB native equality, 16-KiB ELF/ZIP alignment and notices. The verifier jar
retains the workflow's exact pinned hash. Release notices contain 79 Maven and
205 Rust packages. AAB metadata includes native symbol files for Rust/JNA on
both ABIs; matching readable native production traces remain unqualified.

The exact verified AAB is selected through Chrome's native file chooser after
the connector upload route refuses unavailable file-URL access. No extension
permissions are changed. Console processes 29/1.0.29 with both ABIs, API 28+
and attached native debug symbols; completed submission is recorded below.
Private receipts and public release artifacts are retained under ignored local
release evidence; credentials and private account identifiers are excluded.

## Production submission and terminal checkpoint

At 07:01 UTC on October 12, Console confirms only one submitted change:
**Production 29 (1.0.29), Start full rollout**, under **Changes in review**.
The release preview explicitly retains 100.0% and all targeted countries,
with zero supported-device losses across every form factor. Managed publishing
is turned **off**; Console defines this as automatic publication as soon as
updates are approved. No unrelated draft/listing changes are submitted.

The final Send changes for review confirmation is accepted. Play's automated
quick checks are still running and say changes will proceed to review once
checks succeed. This is an accepted submission, not completed checks, approval,
public availability or production-installed evidence. No later operator action
is required to publish after approval. Existing 28 remains available until
Google completes that process. A fresh 15:34 UTC Console observation confirms
the quick-check progress has cleared and explicitly states **Your changes are
now in review**. The sole production 29 full-rollout change and managed
publishing off remain visible. Approval and publication are still pending.

Source [CI 38211702546](https://github.com/kzahel/jstorrent/actions/runs/38211702546)
passes all ten applicable jobs, including Rust/loopback, web/E2E, Android owned
runtime, both Linux lanes, Windows, Mac and iOS; optional verification and
advisory dispatches are intentionally skipped. Fast CI 38211702298 also passes.
Signed Android run 38211702291 passes build and public asset publication.
The fresh read-only Control Room check reports all JSTorrent collectors
succeeding at 06:28 UTC; its new 1.1.3 uninstall response has no substantive text.

The only Play warning is absent deobfuscation mapping; release R8/minify is
disabled, and native symbols are independently present and acknowledged by
Play. Public listing/privacy, signer roots, API support and desktop/extension
offers are unchanged. Both owned emulators are removed; the native picker is
closed, the GitHub tab is restored, and the Play submission page is retained.
Private preview/submission screenshots and artifact receipts remain ignored.

Stopping condition is met. Next observation belongs to 315/297 and the ongoing
monitoring runbook: check review status, eventual production 29
availability, installed behavior and version 29 vitals. No background agent or
new monitoring schedule is created by this submission.
