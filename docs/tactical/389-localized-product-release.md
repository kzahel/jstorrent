# 389 — Localized product release

Status: **Complete (October 29, 2026); Android rollout completed at 100% on October 30.** The maintainer explicitly requests a new
release across desktop, extension, mobile, website and the other production
surfaces after accepting the localized Pixel 9 development build.

Current delivery: desktop 0.3.6 is public on Stable and Latest; extension
1.1.8 and remote controller 0.3.5 are public; Android 1.0.35 is available at
100% after explicit maintainer authorization on October 30. The canonical
website serves the qualified 0.3.6 downloads and nineteen-language release
notes. The original desktop 0.3.5 private draft is preserved unchanged.
The separate localized extension 1.1.9/store-description follow-up remains
owned by Tactical 390 and is not reported as published here.

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

## Exact-source draft completion

Collector 40860728878 stops at the corresponding-source gate after signing and
uploading the fifteen core assets and initial checksum inventory to private
draft 427807280. Publication has not occurred. Inspection of both exact
AppImages identifies two new pairs, Brotli `1.1.0-2ubuntu0.1` and systemd
`255.4-1ubuntu8.18`; the gate initially reports only Brotli. Review the complete
pair difference, original licenses, Ubuntu changelogs and patches, exact
primary HTTPS descriptors and every referenced archive before adding pins.
The [native source guide](../../distribution/linux-native/README.md) records
origin and reuse terms. No advisory/source gate is waived.

Complete this same draft from its original source `5e3af4fd` and immutable
native assets, using the maintained source packager and final draft validators
locally. The source index records the updated input-pin hash separately from
the original application source. Only the missing corresponding-source carrier,
its checksum inventory and release notes may be added/updated. Neither native
payloads nor signatures nor authenticated updater facts may change. Verify
all exact CI leg provenance, original updater signatures, signed database
facts, source carrier contents and final uploaded bytes before publication;
record local recovery separately from the failed collector workflow. A new
application source still requires a new numeric version. The older draft
0.3.5 is not part of recovery and stays unchanged.

## Published delivery and final verification

All requested production lanes reach their stopping condition on October 29:

| Surface | Delivery | Source and production evidence |
| --- | --- | --- |
| Desktop | 0.3.6 Stable and Latest, public | `5e3af4fd`; full source CI 40855333497, five signed builds/source checks 40860728878, unchanged-byte Stable promotion 40872253650 |
| Android | 1.0.35/code 35, available to 1% | `7bed9c13`; signed build 40842706846, exact-source CI 40842999153 attempt 2, internal 40852868563, production 40854017766, standard-7d deployment 7409239330 |
| Extension | 1.1.8, public | `7d172835`; build/store workflow 40829159867, authenticated PUBLISHED status 40838594752, independent update endpoint serves 1.1.8 |
| Remote controller | 0.3.5, public | `b4763454`; production 40833955970, all 42 files and headers verified, public canary passes with signed route cleanup |
| Website | 0.3.6 downloads, public | verified inventory promotion 40872582144, initial deployment 40872726897, final copy deployment 40872952636 at `08f422ffd20c4b8e0c53be10c31866ee70966cbd` |

### Desktop recovery and public bytes

The five native CI legs are independently reassembled with their original
run/source/version facts, then compared with the existing draft. All fifteen
core assets, original updater manifest and authenticated database facts match;
all six payload signatures verify against the retained original key. The
source carrier is completed using reviewed pins at `c5b3b2fb`, without changing
any native executable or signature. Its SHA-256 is
`da04232859ac2dbc2eb214ef673f7ca7fcc6ee75d4e6e9db683fa3de8340be81`,
size 1,383,075,962 bytes. All 39,597 archive members verify; all 85 native source
pairs and both exact AppImage hashes are bound. Its 781 current locked Cargo
packages pass empty-Cargo-home offline metadata on both Linux targets.
All six current-source and seven source-carrier regressions pass.
The original collector remains a failed historical workflow; completion is
local recovery through the maintained source and complete final-draft gates,
followed by successful unchanged-byte Stable promotion. No exception or gate
is removed or waived.

Latest is public at 12:17:11 UTC and Stable at 12:20:51 UTC. All seventeen
assets from each public channel are independently downloaded without
credentials; sizes, SHA-256 digests and complete checksum inventories verify. Stable retains
all original native/source bytes. All ten public target/channel offers match
their exact manifests and retained-key authenticated compatibility envelopes.
The original database versions remain session 29/product 4/metrics 1. The four
automatic targets and manual Linux ARM64 policy are unchanged.

Both Mac architectures independently pass strict deep code signatures, original
Developer ID team continuity, app/DMG Gatekeeper acceptance, valid staples and
accepted notarization tickets bound by code hashes. Notarization log file hashes
are pre-staple values; they are not misreported as final DMG byte hashes.
Prior localization runtime evidence remains macOS and Android. The extra
Windows installed smoke stops at a canceled protected login before installation;
no login retry, installed Windows result or physical x64 result is claimed.
Normal guest shutdown and exact owned workspace/claim release succeed, and
independent inspection confirms the source off and exclusive claim available.
Preexisting persistent workspace records and primary app profiles are preserved.

The actual desktop dependency review is release-ready, with no new exception:
only the previously authorized crypto-bigint finding remains, retaining its
October 24 authorization and November 12 expiry. Both ZIP advisory records are
fixed, and a fresh GitHub alert read returns no open findings. This is bounded
release evidence, not comprehensive security clearance.

### Final live website and store state

The final canonical provenance marker reports source
`08f422ffd20c4b8e0c53be10c31866ee70966cbd` and desktopVersion 0.3.6. All six public
download/source links resolve to the exact qualified Stable asset names. The
live page includes the nineteen-language release notes and CSP; the update
guide no longer advertises its stale first-cutover version. Astro checks all 27
files without diagnostics, and the production build plus 58 generated route
policies pass. The actual website workflows also pass their test/build gates.

At the October 29 checkpoint, Android is available to one percent, with
automatic standard-7d holds and increments. The October 30 authorization and
completion below supersede that staged-rollout restriction.
The official physical Play upgrade, retained Google signer, exact installed
native libraries, five retained seeding torrents, all nineteen picker locales,
French restart and restored System preference are recorded above. Extension
1.1.8 is independently rechecked at the public update endpoint. The separately
staged 1.1.9 and Chrome description synchronization are not duplicated here.
The already current Link service is not redeployed merely to create a new tag;
iOS remains development-only and frozen release identities stay frozen.

Final delivery status/captures and the living topics are updated together.
All seven ledger/window regressions pass. Ledger checks pass for all
twenty-three entries and their required captures.
Task-owned captures, downloads, logs, helper processes and the isolated release
checkout are removed after their durable evidence is committed and pushed;
other sessions, store dashboard state and localization locks are preserved.

## Android rollout completion, October 30

The maintainer explicitly requests Android production at 100% now, superseding
this version's remaining standard-7d stages. The existing signed
`android-v1.0.35`/code 35 bundle is retained, with SHA-256
`edcf00fc29b6e80a44a601f6b9859bb37a01d822e1d190c222938a3bf1fc1fb7`.
No build or new version is needed.

Fresh read-only [report 41110829463](https://github.com/kzahel/jstorrent/actions/runs/41110829463)
confirms code 35 at 1% and passes the existing report-count vitals gate. No
crash or ANR counts are returned for the rollout observation period. Crash
rate data ends October 21 and is stale; this is bounded gate evidence, not a
claim of zero failures.

[Rollout 41110914606](https://github.com/kzahel/jstorrent/actions/runs/41110914606)
is dispatched with `tag=android-v1.0.35`, `action=complete` and its existing
production environment is approved under the explicit maintainer instruction.
It succeeds at 18:55 UTC, submitting one validated Play edit from
`inProgress`/0.01 to `completed`, with production deployment 7446386562.
The deployment preserves the source, bundle hash and original plan history.

Authenticated Play Console independently confirms **Available on Google Play**,
**Rollout percentage 100%**, **Rolled out to 100%**, and availability in **178 of
178 countries / regions**. Its bundle table shows code 35 active, code 33
deactivated and no retained bundles. The existing first-public date remains
October 29. No unpublished changes are shown in Test and release. The rollout
is complete; the scheduled advancer has no remaining stage for this version.
