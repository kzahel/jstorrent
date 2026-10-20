# Tactical 380: Desktop, Extension and Android Release

Status: Preparing, 2026-10-20. Publication requested by the maintainer.

Topics: `beta-release-readiness`, `mixed-version-compatibility`.

## Scope and stopping condition

Publish production JSTorrent desktop, extension 1.1.6 and Android
1.0.32/code 32 from qualified source. Desktop Stable is 0.3.1; public
Latest 0.3.3 exists at fe4be51c. Prefer immutable promotion after its
compatibility and installed-evidence requirements pass. Store submission
with automatic publication after review is the store stopping condition;
record pending review separately from public availability.

Preserve existing identities, signing roots, durable data, production
countries and rollout settings. No engine, schema, permissions, dependency,
listing, remote-controller or website changes. No unrelated store drafts.

## Policy checkpoint

Extension 1.1.5 is live since October 15. Strict extension 1.1.4 and older
remain inside the 30-day support window. Existing Latest authorization
covers eight reviewed fields only; it does not authorize Stable or Android.
An explicit maintainer decision is pending before either host publication.
Extension preparation and validation can proceed independently.

## Ownership and validation

Release helpers own version commits and atomic main/tag pushes. Actions owns
exact-source tests, compatibility, signing, notices, packaging and receipts.
Google owns review and distribution. Existing release concurrency serializes
publishers; no runtime tasks or protocol changes are introduced.

Run web typecheck/tests, extension tests and production packaging, release
helper tests, compatibility ledger and database-history checks. Require
hosted signed Android dual-ABI/JVM/lint/artifact validation and independently
verify downloaded artifacts before Play upload. Desktop promotion must retain
native bytes and signatures, verify authenticated database facts, exact
source and current Stable predecessor. Record exact checks and workflow runs.
