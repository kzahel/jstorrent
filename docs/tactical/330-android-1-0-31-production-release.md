# Tactical 330: Android 1.0.31 Production Release

Status: Complete submission, 2026-10-13. Quick checks are running; review and
approval remain pending. Automatic production publication at 100% is configured.

Topics: `beta-release-readiness`, `android-jstorrent-replacement`,
`product-surfaces-and-migration`.

## Scope and stopping condition

The maintainer requests a new Android version published to Play Console.
Prepare 1.0.31/code 31 from current main, including completed Tacticals 318,
327, 328 and 329. Preserve `com.jstorrent.app`, its existing signing roots,
production countries and the established 100% automatic-publication procedure.

Stop after exact tagged APK/AAB qualification and the production review
submission with automatic publication after approval. Record actual Console
state separately from asynchronous approval, installed delivery and stability.

Non-goals: new features, desktop/extension/iOS publication, listing changes,
signer rotation, device library mutation or unrelated pending changes.

## Ownership, invariants and evidence

The established release helper owns the version commit, annotated tag and
atomic push after checking maintainer Git identity. Actions owns signing,
dual-ABI construction, JVM tests, lint, notices and package/signature checks.
Independently validate the downloaded tagged artifacts against exact source
inputs and public SHA256SUMS before upload. Inspect Play's maximum version code,
pending changes and production stability before submission. Machine Control
owns browser/native interaction; Google owns review and managed distribution.

No new runtime tasks, dependencies or protocol contracts are introduced.
Existing source CI and the completed feature tacticals supply regression and
device evidence; the release run supplies fresh signed integration evidence.

## Initial checkpoint

Main is clean at `b1b52f7c5777f2136dcc74903f81a78fe84b2a7a` and matches
origin/main. Previous tagged production is 1.0.30/code 30. Maintainer Git name
and email are verified. All 27 Android release Python cases and the production
candidate configuration validator pass. Source CI 38409541971 is running.

## Tagged construction checkpoint

Release source is `70150ec99ff5613bb468fd816fed46c687ff7557`, pinned by
annotated `android-v1.0.31`. The established helper atomically pushes main and
the tag after its dry run. Signed Android run 38409971104 and exact-source CI
38409973610 are running. The earlier source CI fails during npm dependency
installation with ECONNRESET, then is cancelled by the newer source run;
this is a network failure, not a regression assertion.

Fresh Cargo advisory collection and both web/website npm audits pass the
release-ready review, with zero vulnerabilities and the seven existing reviewed
warnings. GitHub's two open alerts concern the unused iOS storage experiment
and the exact source-verified desktop GLib backport. Local Rust formatting and
Clippy, web typecheck, 532 web tests with two existing skips, and localization
catalog checks pass. Full Rust tests are running.

Local `cargo test --workspace` completes with 1,598 passed, 18 ignored and
zero failures. Play's production memory warning links to code 30's bundle
details: 16-KB pages are supported; DEX optimization is low because R8 is
disabled. No minification/toolchain policy change is introduced during release.

Exact-source CI 38409973610 passes its complete Android dual-ABI, JVM/lint,
instrumentation compilation and owned API 35 SAF lifecycle job. Its web
type/unit/build/deterministic browser job also passes. Tagged signed construction
and the remaining source CI jobs are still running.

Fresh authenticated Play inspection confirms production 30 at full rollout in
178 countries and maximum uploaded code 30. Managed publishing is off, with no
pending changes initially visible. Version-specific crash/ANR data is unavailable;
it does not establish population stability. Draft 31 is created and its release
notes entered; no bundle is uploaded and no review submission occurs yet.

## Signed artifact qualification and upload

Tagged run [38409971104](https://github.com/kzahel/jstorrent/actions/runs/38409971104)
passes signed dual-ABI construction, release JVM/lint, package/signature/notices
and alignment validation, then publishes the downloadable Android prerelease.
Independent validation of the exact downloaded bytes against tagged Gradle and
certificate inputs passes every normal APK/AAB gate. Both files match public
asset sizes/digests and SHA256SUMS:

- AAB: 61,706,447 bytes,
  `cf091640e5b3cbcc9209779b818149dfae3b497d6d0e8d419fc31455b0f36fbb`.
- APK: 105,385,991 bytes,
  `626aeb52aaa516a1c64a5287806142adc3199fc2db3c23006f026f5f45416f83`.

Play accepts the exact AAB as 31 (1.0.31), API 28+, target 36, both ABIs.
Upload uses the native chooser without widening browser extension permissions.
Previous bundle 30 is excluded. Preview and review submission remain next.

The source CI Windows job fails
`application_incoming_bootstrap_is_disabled_or_exactly_fixed` with Windows
socket errors 10013/10048. Android source integration and local Rust workspace
tests pass; no Windows release is made and this failure is not represented as
a full source CI pass. Hosted Rust tests complete and controlled lifecycle
validation is running. The Windows harness failure remains separate follow-up.

## Production submission and completion

Preview confirms zero device losses in every form factor, 100.0% rollout and
all targeted countries. Bundle 30 is excluded; 31 is the sole new bundle.
The only warning is the missing deobfuscation file; R8/minify remains disabled.
The existing listing and all unrelated product/store settings are unchanged.

At 14:37 UTC, final Send changes for review succeeds. Play shows only
**Production 31 (1.0.31), Start full rollout** in **Changes in review**, with
**Managed publishing off**. Quick checks are still running and Console says
the changes will be sent for review once those checks succeed. Actual review,
approval, public availability, installed delivery and stability are not inferred.
Automatic publication after approval needs no later operator action.

Source CI 38409973610 completes with all nine other applicable jobs passing,
including Rust formatting/Clippy/workspace and controlled libtorrent/application
checks, web and full Android/SAF integration. The Windows socket-bind test is
the sole failed job; the whole run is correctly reported as failed. No unrelated
Windows repair is introduced in this Android publication tactical.

This meets the authorized submission stopping condition. Minimal private release
receipts are retained in ignored local storage; temporary audit/build/test logs,
downloads and validation copies are removed. Browser debugger and the task's
host claim are released. No device data or signing inputs are changed.
