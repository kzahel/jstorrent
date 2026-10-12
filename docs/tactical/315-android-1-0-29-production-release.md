# Tactical 315: Android 1.0.29 Production Release

Status: Active, 2026-10-12.

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
mutation, or incubation release. Existing API28 minimum and both native ABIs
remain. Preserve immutable version28 artifacts and production app identity.

## Invariants and ownership

Version29 must exceed the freshly inspected Play maximum. Current source and
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
Play production currently serves28; fresh maximum-code, pending-change and
managed-publishing checks remain next. Repair314 already passes 13 regressions,
all 136 debug/release JVM cases, lint, fresh dual-ABI/generated build and notices.
Validate the new version's signed artifacts and hosted source checks before
submission. Record actual release hashes, source/tag, workflow and Console
submission/publication setting evidence below as each step completes.

Play preflight confirms maximum uploaded code28, production/internal28 and no
unrelated pending/ready changes; managed publishing is currently on. Release
tool tests pass24 cases. Git identity is the maintainer; origin is canonical.
