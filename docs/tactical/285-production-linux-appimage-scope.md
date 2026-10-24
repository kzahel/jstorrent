# Tactical 285: Production Linux AppImage Scope

Status: Complete locally, 2026-10-09, beneath finish-line Tactical259.

Owners: product-direction, beta-release-readiness, desktop-jstorrent-replacement
and desktop-release. Read their accepted Linux policy and Tactical279.

## Scope and stopping condition

Apply the accepted first-release best-effort Linux policy to production desktop
packaging. Build Linux lanes on Ubuntu 24.04 with freshly installed vendor
WebKit/OpenSSL packages; offer AppImages only for JSTorrent production. Remove
production DEB/RPM assets and updater selectors together. Stop after exact
asset/selector/refusal tests, workflow/source validation and documentation
reconciliation. A fresh signed build and installed qualification remain259.

Non-goals: older-distro WebKit backports, a distro compatibility matrix,
webview-free tray implementation, headless publication, engine changes and
changing the existing preview package-manager channels. No push, dispatch,
upload, tag or publication is performed by this local tactical.

## Invariants and validation

Retain both Linux architectures, production identity and updater trust root.
The collector must require the exact production package set and signatures;
missing or unexpected bytes fail. Preview still requires its existing full
matrix. Manifest aliases cannot advertise excluded packages. Ubuntu 24.04
establishes a newer build ABI; AppImage is not a promise of older-system support.
Keep notices, distro provenance and extracted security-floor checks intact.

Require the reviewed Noble WebKit fixed version2.52.6-0ubuntu0.24.04.1 or newer
at build time. This is a known advisory floor, not complete security clearance;
inspect the actual new bundled inventory before shipment. Ubuntu's
[CVE-2026-43742](https://ubuntu.com/security/CVE-2026-43742) and
[USN-8703-1](https://ubuntu.com/security/notices/USN-8703-1), checked2026-10-09,
record that Noble fix and explain that current WebKit cannot build on Jammy.

Test production 15 core assets/11 selectors/six signatures, preview 23/15/ten,
both Linux architectures, excluded package rejection and exact draft checks.
Run actionlint and existing desktop package/source/distribution tests. Keep
old candidate receipts historical; do not claim current signed/pixel evidence.

## Local execution and remaining work

The authorized finish-line build exposed a remaining final-collector verifier
that still required ten signatures. Before qualification, extend this tactical
to require six production signatures while retaining ten preview signatures,
the original cryptographic trust checks and product namespace checks. Validate
missing/extra/wrong-product/excluded-package refusals and actual minisign
wrong-root/tamper behavior. Stop after a local correction and replacement
nonpublishing build; the superseded attempt remains cancelled, not passed.

This follow-up passes 20 signature, collector, independent manifest and release
input cases, including actual minisign wrong-root/tamper checks. The final
CLI now requires six production signatures, refuses excluded DEB/RPM and
foreign product names, and retains ten signatures under the current preview
display name. Trust-root selection and cryptographic verification are unchanged.
Authorized source fe30d273 attempt 37957327863 is cancelled before qualification
and replaced after committing the verifier correction. Its original-root nonce
probe passes; its cancellation does not qualify the package matrix.

The workflow now selects AppImage-only bundles for production on both Ubuntu
24.04 architectures, refuses stray DEB/RPM outputs, checks the reviewed WebKit
floor and retains extracted notices/security inspection. Preview keeps its
three Linux package types. The collector, independent manifest validator,
private-draft gate and trial preparer use the new exact production set.
Release notes and the runbook distinguish the two products.

All 15 collector/manifest/publisher cases pass, including production exclusion,
stale selector refusal and exact draft hashes. All 33 existing desktop source,
input/nightly and candidate cases, 26 distribution review cases and actionlint
pass. No hosted/signed build runs. Actual Noble bundled package versions,
minimum ABI, source/relink offer and installed screenshots remain under259;
this local policy change does not clear the old signed AppImages.

## Hosted qualification under259, 2026-10-09

Frozen a7ee65ed completes the nonpublishing five-target production build in
37958746928. Exact15 core assets/six retained-root signatures/11 selectors and
six wrong-root refusals pass independently; no DEB/RPM is collected. Both real
AppImage inventories meet the reviewed Noble WebKit/OpenSSL floors, reconcile
first-party binaries and packaged notices, and remove owned extractions. Linux
x64 native supported extract-and-run migration/restart and visual checks pass
with VM-off/claim-release restoration. Complete native security/source/relink
delivery, ARM installed acceptance and normal update/FUSE remain under259.
