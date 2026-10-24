# Tactical 279: AppImage OpenSSL Security Floor

Status: Complete locally, 2026-10-08. Signed rebuilding remains separate.

Topics: `beta-release-readiness`, `capability-readiness`.

## Scope and stopping condition

The signed source8c ARM AppImage's hash-bound native manifest identifies
libssl3 from OpenSSL `3.0.2-0ubuntu1.29`. Ubuntu USN-8847-1 requires
`3.0.2-0ubuntu1.30` for Jammy and `3.0.13-0ubuntu3.16` for Noble. The x64
candidate already contains the Jammy fixed revision. Hold the ARM candidate
for rebuilding; product exploitability has not been established.

Refresh the OpenSSL build/runtime packages explicitly on Linux CI/release
builders. Require the actual attributed AppDir OpenSSL source and binary
versions to meet those reviewed floors before packaging/signing and during
post-extraction inspection. Unknown revision families require a fresh review.
Stop after focused refusal/acceptance tests and the exact retained manifests
independently demonstrate ARM refusal and x64 acceptance of this narrow gate.
A newly signed artifact and installed repeat require separate exact-source
build authority and remain unfinished until actually performed.

No engine, networking, TLS behavior, identity, key, updater or dependency-lock
changes. This is one advisory floor, not a complete native security scanner,
source offer or redistribution clearance. Existing signature/notice integrity
and functional receipts remain historical evidence for their exact bytes.

## Ownership, bounds and validation

The existing notice collector owns distro provenance derived from actual ELF
build IDs and dpkg metadata. It runs inside the AppImage pre-packaging hook;
the independent extraction inspector reuses manifest verification. Add a
bounded, deterministic check on those package entries without a subprocess,
new task or dependency. Accept only the reviewed Ubuntu revision families,
compare their decimal security revision numerically, and reject missing,
unreviewed, conflicting or below-floor OpenSSL runtime attribution.

Validate both reviewed Ubuntu series, revisions above and below each floor,
unknown/epoch/suffix versions, missing runtime attribution, source/binary
mismatch and tampered post-collection manifests. Inspect workflow syntax and
prove the frozen artifact manifests' different outcomes without executing or
modifying those artifacts. Keep detailed receipts under the ignored report
path. Update the checklist and owning topic with the rebuild blocker.

## Primary sources

- [Ubuntu USN-8847-1](https://ubuntu.com/security/notices/USN-8847-1),
  published 2026-09-29.
- [Ubuntu CVE-2026-84782 status](https://ubuntu.com/security/CVE-2026-84782),
  Jammy and Noble fixed-version rows, verified 2026-10-08.

## Local evidence and next action

All 21 focused distribution-review cases pass, including both Ubuntu floors,
future numeric revisions, old/missing/unknown/conflicting attribution and
pre-packaging/post-extraction refusal. Pinned actionlint v1.7.9 passes.
Independent reads preserve both frozen native manifest hashes: x64 accepts the
reviewed floor, ARM refuses `3.0.2-0ubuntu1.29`. Detailed receipts are ignored.

Both ordinary CI and the source/signed desktop workflow explicitly install
`libssl-dev` and `openssl` after updating apt metadata, refreshing the exactly
matched runtime dependency instead of relying on the runner's preinstalled
transitive package. Nightly desktop builds reuse that release workflow.
The existing collector refuses before its manifest is finalized or the output
plugin signs; extracted AppImage verification repeats the check.

This changes selected production packaging inputs after freeze681. The earlier
8c-to681 source-equivalence proof remains valid for those frozen commits only.
Next action: prepare an exact revised-source nonpublishing signed-build review;
only after specific build authority, rebuild and independently qualify the new
ARM package and its installed/native behavior. Do not reuse the old approval or
report the retained signed ARM candidate as ready for shipment.
