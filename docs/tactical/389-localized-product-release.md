# 389 — Localized product release

Status: **Active (October 29, 2026).** The maintainer explicitly requests a new
release across desktop, extension, mobile, website and the other production
surfaces after accepting the localized Pixel 9 development build.

Current delivery: extension 1.1.8 and remote controller 0.3.5 are public. Android
1.0.35 is publicly rolling out at one percent. Desktop 0.3.6 selects source
5e3af4fdaac41200173ca18fea13a049d7903d08 after full source CI 40855333497;
signed workflow 40860728878 is in progress. Stable and website promotion remain
pending. The prior private draft 0.3.5 is preserved unchanged.

## Scope and stopping condition

Publish desktop 0.3.6 through the existing signed Latest pipeline and unchanged
Stable promotion; extension 1.1.8 to the existing Chrome Web Store item; Android
1.0.35/code 35 through signed tag construction, internal Play and production
staged rollout; remote controller 0.3.5; and the canonical production website.
Store submission with automatic publication after review is the store stopping
condition. Record pending review and staged availability separately from full
public delivery. Verify the actual public desktop, updater, remote and website
outputs before marking complete.

JSTorrent remains the sole production identity. iOS has no current production
release lane. No incubation packages are republished, and no new iOS/headless/
Crostini production lane is introduced.
Preserve signing roots, app IDs, user data, store countries, permissions and
the existing rollout plan. No schema, engine or new remote API changes belong
to this release. Keep temporary receipts/downloads under ignored local state.

## Prerequisites and decisions

Tactical 388 supplies nineteen release-input locales, independent review of
39,664 resources, real macOS/Android qualification and green source CI at
90d13426. The physical Pixel 9 accepted the matching development build; the
upload-signed APK cannot replace its Play-signed production package. Any
production upgrade validation must retain Google's signing identity and data.

Desktop 0.3.5 is an older, unpublished signed draft. Never replace its source or
assets with this campaign. Fix numeric allocation to reserve recognizable
JSTorrent drafts, then select 0.3.6 while keeping public channel selection
limited to published releases. Add a regression covering the observed draft
collision and retain the frozen-identity exclusion.

The eight reviewed companion field exposures and minimum extension 1.1.5
already ship in Stable 0.3.4 and Android 1.0.33. This coordinated release carries
that accepted requirement forward for the two exact new host tags; it does not
accept a new enum, unsolicited view, permission or exposure, or disable the
strict-client guard globally. Disclose the existing requirement in host notes.

## Execution and evidence

1. Commit this plan, changelogs, exact host acceptance and the allocator fix;
   run release-tool, compatibility, extension and relevant web tests.
2. Tag extension/Android using the maintained helpers. Capture their exact
   client/host sources and record delivery metadata in a compat-only commit;
   do not let unrelated pushes obscure Android's exact-source CI gate.
3. Publish the independently captured/tagged remote controller, verify digests,
   headers and its public disposable canary with signed cleanup.
4. After successful exact-main CI, publish a fresh signed desktop Latest,
   verify its same-run inventory/signatures and installed qualification, then
   promote those immutable bytes to Stable. Verify production downloads and
   updater offers, then the canonical website promotion/deployment.
5. Publish the verified Android bundle to internal Play, qualify the same
   Play-signed upgrade on an authorized physical device, then submit the same
   bundle to production with the standard staged plan. Retain and verify store
   receipts and review status. Required external environment approvals remain
   explicit gates; do not bypass them.
6. Update the living topics and delivery ledger with actual versions, sources,
   run IDs, store state and limitations. Commit/push final evidence and clean
   task-owned artifacts and processes. Never report a review submission as an
   approved/public store release.

Validation includes release helper/train/promotion tests, current dependency
review and license gates, compatibility capture/live matrices, strict web and
extension checks, signed native builds, Android JVM/lint/package checks, exact
download verification and live website/controller source provenance.

## Preparation checkpoint

The allocator regression and existing train/input/promotion/policy suites pass
36 cases. Strict web typecheck and all 959 web cases pass (three existing
skips), all seventy extension cases and production manifest validation pass,
and all five Android version-helper cases pass. Both exact new host tags pass
the unchanged-eight-field acceptance; database compatibility metadata is current.
No store, permissions, schema or native runtime behavior changes are included
in preparation. Hosted signed construction and store submission remain pending.

## Corresponding-source prerequisite

The retained 0.3.5 draft failed its collector on a missing preferred-source
record for fast-uri 3.1.9. Inspection finds three missing records for already
locked dependencies: fast-uri 3.1.9 (BSD-3-Clause), undici 7.30.1 and zustand
5.0.15 (MIT). Exact npm integrity, upstream version/commit, root license text
and preferred-archive SHA-256 are checked before adding their source pins. The
[license inventory](../../distribution/licenses/README.md) records origin,
reuse permission and the source bindings. Existing dependency versions and
license/advisory gates are unchanged. Preflight against the prior release
lockfile now resolves all changed web inputs. Final same-run Linux package and
source-carrier binding still belongs to the fresh desktop collector.

All sixteen changed web inputs relative to the pinned prior release now resolve
to exact reviewed records; the six current-source carrier regressions pass.
The read-only Play check in Actions 40829325910 confirms that production code
33 is now completed, so the next standard staged rollout has no unfinished
predecessor to alter. This inspection made no Play track change.

## Client-capture expectation correction

Extension 1.1.8 passes its tagged release workflow (40829159867) and is
submitted to Chrome Web Store with automatic publication after review. The
independent ZIP digest, build record, manifest and store receipt agree. Its
exact client capture exposes a test bookkeeping error: the legacy raw-frame
expectation table has no entry for a new client, so zero decoder failures are
compared with `undefined`. Require zero failures by default; retain the exact
reviewed failures for legacy clients and all unattributed-break and strictness
checks. This changes test expectations only, not application behavior.

The immutable remote 0.3.4 candidate at bbb01b48 contains that test error and
cannot pass its build. Retain its tag, withdraw its unserved ledger entry and
advance the corrected candidate to 0.3.5. Do not retag or bypass the gate.

## Public client delivery and selector visibility

Extension 1.1.8 is now public: Chrome's update endpoint serves that exact
version, and authenticated read-only workflow 40838594752 reports PUBLISHED.
Remote 0.3.5 passes build, live compatibility and deployment in 40833955970.
All 42 public files and headers verify against b4763454; its disposable public
canary passes private/shared sign-in, reload/browser restart, revocation and
signed route release. The rollback archive SHA-256 is
89e140c45973f3e803d96123611ad7d87f5df8114e0b8f5cdec53f0c64195796.

Full source CI 40834141428 and Fast CI 40834141486 pass at 32627b35. Android
tagged construction 40834015653 and live matrix 40834015690 pass. Internal
Play publication 40839278904 accepts code 34, with bundle SHA-256
942e7a16e62e026e5fd14d27f7abc355a485dc87d64cb81a18dca3ea07e7c580.
Production promotion still awaits the Play-signed physical update check.

The first desktop dispatch, 40839275749, still selects occupied 0.3.5 because
its job-level read-only token hides drafts. Cancellation occurs before native
packaging; the collector reports that no release was created. The retained
draft still has its original 474e139c target and sixteen assets. GitHub's
[release API](https://docs.github.com/en/rest/releases/releases#list-releases)
only lists drafts for callers with push access, and its by-tag endpoint only
returns published releases. Give the main-only selector the parent workflow's
existing contents-write permission, require proof of push access before
allocation, and refresh drafts by exact release ID. Keep published-channel
selection unchanged. Thirty-eight release-tool cases and a live read-only
selector dry run now reserve the draft and choose 0.3.6. The corrected source
must pass fresh full main CI before another desktop dispatch.

## ZIP advisory discovered before host promotion

The unmerged security-only dependency PR 30 identifies upstream
[GHSA-m665-v7pm-7grj](https://github.com/zip-rs/zip2/security/advisories/GHSA-m665-v7pm-7grj):
ZIP 9.0.4 is affected by local/central-header ambiguity; 9.0.5 is designated
patched. The fresh RustSec report still contains only the existing bigint
finding, so its absence there is not treated as clearance of the GitHub
advisory. The host's torrent-list reader uses bounded in-memory ZipArchive
reads, not streaming filesystem extraction. Adopt the upstream patch and
explicit header-consistency validation before reading bundle contents.

Keep the existing 256-MiB archive and 4,096-torrent limits; validate only after
the entry-count check. This adds bounded metadata checks, not filesystem
extraction, tasks, sockets, schema or application API changes. Preserve ZIP-4
version-one fixture compatibility and normal stored/deflated round trips.
Add an independently authored local/central-name mismatch regression; do not
copy upstream source, tests or fixtures. Consult upstream `src/read/mod.rs`,
`src/read/zip_archive.rs`, `src/read/stream.rs` and
`tests/header_consistency.rs`, plus the existing 348 import design. The
upstream MIT crate remains an existing dependency with unchanged features.

Re-review the old bigint binding by comparing exact all-target/all-feature
backend identities, features, dependencies, dependents and crypto-source
hashes. Rebind only if unchanged; retain the original accepted finding and
November 12 expiry. No new vulnerability exception is allowed.

Android 1.0.34 remains an internal-only candidate and will be superseded by
1.0.35/code 35 before production promotion. Desktop remains 0.3.6. Both hosts
must pass fresh source, signed build, compatibility and proportional Android
checks. The public extension/controller do not contain the host ZIP parser.

The new mismatch test first fails on ZIP 9.0.5 without the explicit opt-in,
then passes with header validation. All nine bundle tests pass, including
the existing ZIP-4 fixture, normal round trips and compressed-size bounds;
session all-target Clippy and workspace formatting pass. Strict web typecheck
and 971 web cases pass (three existing skips), as do 48 dependency-review
guard cases. Fresh strict dependency review is release-ready with exactly
the existing bigint exception. Its graph/source comparison is recorded in
381's evidence; the accepted finding, authorization date and expiry remain
unchanged. The eight companion exposures are carried forward to exact
android-v1.0.35, with extension 1.1.5+ still required.


The actual workflow-token preflight 40843398320 exposes a second visibility
issue: GitHub reports `permissions.push: false` for this installation token
even while its effective Contents permission is write. Replace that user-role
check with the non-persisting
[release-notes generation endpoint](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release),
which requires Contents write and saves no notes, tag or release. Keep API
errors and malformed replies fatal. All 39 release-tool tests pass; the local
live dry run proves access, reserves draft 0.3.5 by ID, then stops at the
expected pending exact-main CI gate. A fresh workflow-token preflight and full
CI remain required before desktop construction.

This correction is isolated in a detached release checkout because another
local session is editing extension and store-localization work. That work is
preserved and excluded from these pinned release candidates. Android 1.0.35's
signed construction 40842706846 and fresh hosted dependency review 40843105049
pass. Full exact-source CI 40842999153 must finish before pushing this selector
correction, preserving its compat-only provenance for Play publication.


## Final Android candidate qualification

Exact-source main CI 40842999153 passes on its second attempt at db0d7490.
The first attempt was canceled by a concurrent store-listing push; only its
canceled jobs were restarted, preserving the successful checks. Android's
signed build 40842706846, live compatibility 40842706853 and fresh strict
dependency review 40843105049 all pass. GitHub marks both manifest/lock records
of the ZIP advisory fixed at 09:04:02 UTC.

Internal Play workflow 40852868563 accepts the exact code35 AAB with SHA-256
edcf00fc29b6e80a44a601f6b9859bb37a01d822e1d190c222938a3bf1fc1fb7.
The already-enrolled physical API-37 tester updates production 1.0.33 through
the official Play Store to 1.0.35. Its original app ID, first-install timestamp
and Google app-signing certificate are preserved. All three installed ARM64
native libraries match that exact AAB. All five visible torrent identities and seeding states
survive the upgrade, French switching and process restart. The picker exposes
all nineteen languages plus System; French persists across restart, then the
original System preference is restored. No uninstall, data clear, torrent
mutation, signing substitution or browser-download workaround is used.

Selector correction 36ce7c40 preserves the concurrent committed store work.
Actual workflow-token preflight 40852872411 passes the effective-write probe,
reserves the original draft 0.3.5 by ID, then stops only at the pending new
source CI gate. Full desktop-source CI 40852865492 remains required. The first
36ce7c40 host capture passes all 91 compatibility cases. A later committed
store/extension-localization push cancels its pending full CI before desktop
construction. Desktop source advances to 96c1a27f, retaining the selector fix;
there is no Cargo, web UI or native-desktop delta. Discard only the unused,
uncommitted 36ce7c40 capture and capture the exact new source. Full CI
40854238086 now owns desktop qualification.
Production Play workflow 40854017766 requests the same internal bundle on the
standard seven-day staged plan starting at one percent; acceptance and actual
review/availability still require verification. Its normal production
environment review is approved without changing protection rules.


Production Android workflow 40854017766 succeeds and its receipt binds the
same internal AAB without another upload, previous production code33, code35,
status inProgress and userFraction0.01. Play Console independently shows
1.0.35 under Changes in review/quick checks, Start staged rollout at1%, and
managed publishing off. This is accepted automatic-publication submission,
not yet observed public production availability.


### Observed Android production availability

A fresh Console inspection now shows no unpublished changes and a production
release 1.0.35 **Available to 1% of users on Google Play**, released October 29
at 11:19 AM Console-local, across the existing 178 countries/regions. Record
firstPublic October29 and status rolling-out, rather than treating the earlier
submission receipt as publication. Deployment7409239330 binds the same AAB and
records the unchanged standard-7d fractions/hold periods. No manual rollout
increase is performed.


## Pinned desktop construction

After the separate store-delivery documentation lands, full main-push CI
40855333497 and Fast CI 40855333476 pass at 5e3af4fd. Latest workflow
40860728878 proves effective draft access, reserves the original 0.3.5 by ID
and selects 0.3.6 at that exact successful source. The delayed scheduled run
40855104583 safely skips unqualified source96 rather than starting a build.
Capture the exact selected 5e3af4fd host; all 91 compatibility cases and the
delivery ledger pass. Remove only the unused, uncommitted exploratory96
capture. Native packages, original-key signatures, fresh dependency/licensing
review and corresponding source remain construction/qualification gates.
