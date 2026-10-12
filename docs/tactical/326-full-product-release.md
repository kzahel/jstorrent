# Tactical 326: Full Product Release

Status: Preparation in progress, 2026-10-13.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`,
`android-jstorrent-replacement`.

## Scope and stopping condition

The maintainer requests a new Android production release at 100%, superseding
the pending Play release if necessary, plus new desktop and extension releases.
Prepare Android 1.0.30/code 30, desktop 0.3.1 and production extension 1.1.4.
Preserve the existing app/store identities, signing roots and updater endpoint.
Use browser control for Play and the existing extension dashboard.

Prepare signed candidates and exact-source checks before publication. Clarify
whether the requested approval means store approval with automatic publication
or a final maintainer approval. Until answered, hold final publication. Stop
after the authorized publication/submission state and actual public desktop
assets, source offer, website and updater routes are verified; store approval
and installed acceptance remain separate evidence.

Non-goals: no new product feature, iOS or incubation release, signer rotation,
listing/privacy/permission changes, physical-device mutation or library reset.
Exclude unfinished duplicate-add changes in Tactical 318. Include the completed
Tactical 325 harness repair needed to qualify the current source, preserving
unrelated working-tree edits.

## Invariants, ownership and evidence

Bind all candidates to the committed source and immutable version tags. Verify
Git identity before pushes. Existing Actions owns signing and temporary secrets;
local packaging owns the reviewed production extension archive. Google owns
asynchronous store review. Inspect pending Play changes and maximum version code
before replacing 29; never submit unrelated changes. Maintain full rollout and
automatic publication only as authorized.

Run fresh dependency audits and renew the expiring warning review from actual
evidence. The initial audit finds five quinn-proto 0.11.16 advisories; update
only that locked optional dependency to patched 0.11.18, preserving the selected
engine architecture and current reqwest features. No QUIC feature is added.
Existing seven warnings, including the source-verified GLib backport, remain
subject to exact inventory/source validation. Read the upstream security fixes
at quinn-rs/quinn PRs 2790 and 2868; no source or fixtures are copied.

Validate Rust/web, Android JVM/lint and original-key APK/AAB packaging, all five
signed desktop legs and signatures/trust/notices, production extension identity,
and exact release inventory. Deliver sources for the actual Linux packages;
prior packages and source inventories cannot qualify new binaries. Release
construction, store submission, public availability and installed stability
must be reported separately. No background monitoring task is created.

The retained source-carrier tool hardcodes 0.3.0. Generalize only its versioned
archive root and AppImage names, deriving the version from candidate metadata
and verifying it against the exact committed Tauri source. Preserve all existing
digest, dependency-lock, runtime, source-package and closed-membership gates.
Regression coverage rejects wrong source/version and unsafe version paths.

## Initial checkpoint

Play shows production 28 at 100%, pending production 29 Start full rollout in
review, and managed publishing off. The extension dashboard shows production
1.1.3 published. GitHub desktop Latest remains 0.3.0. Local main has 13 committed
changes beyond origin/main plus unrelated working-tree changes. Fresh web and
website npm audits contain zero vulnerabilities. Dependency warning review
expired 2026-10-12; fresh Cargo advisory database is dated 2026-10-12.
