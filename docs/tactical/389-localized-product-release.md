# 389 — Localized product release

Status: **Active (October 29, 2026).** The maintainer explicitly requests a new
release across desktop, extension, mobile, website and the other production
surfaces after accepting the localized Pixel 9 development build.

## Scope and stopping condition

Publish desktop 0.3.6 through the existing signed Latest pipeline and unchanged
Stable promotion; extension 1.1.8 to the existing Chrome Web Store item; Android
1.0.34/code 34 through signed tag construction, internal Play and production
staged rollout; remote controller 0.3.4; and the canonical production website.
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
