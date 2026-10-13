# Tactical 330: Android 1.0.31 Production Release

Status: Preparing, 2026-10-13.

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
