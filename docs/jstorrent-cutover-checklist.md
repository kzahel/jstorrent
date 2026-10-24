# JSTorrent In-Place Cutover Checklist

Desktop, Android/ChromeOS, the existing extension and website are in scope.
iOS is excluded. Linux is best effort: AppImage only for this desktop release,
maintained bundled libraries and CLI/headless fallback; no older-distro backport
campaign or production DEB/RPM qualification. See the
[accepted scope](topics/product-direction.md#linux-release-scope-accepted-2026-10-09).

This document keeps the current tasks and acceptance contracts. Dated execution,
failures and historical signed candidates live in
[Tactical259](tactical/259-jstorrent-finish-line-checks.md) and the ignored
per-slice finish-line reports. Earlier passes remain bound to their exact artifacts.
Use the shorter [update scenarios](jstorrent-update-scenarios.md) for recovery
copy and independent store timing.

## Current finish-line tasks, 2026-10-10

The short [operational sequence](jstorrent-cutover-operations.md) records exact
release bindings, staged delivery, ownership and stop/recovery defaults.
Current execution: desktop 0.3.0 and its source archive are public; all 17
actual downloads pass hashes. The website and production updater are live;
11 qualified selectors preserve unchanged preview offers. Renewed Web Store
sign-in confirms extension 1.1.3 still Pending review with publication deferred.
Android 28 is approved and published at 5% on October 10 at 16:51 UTC; managed
publishing remains on and release 23 remains available. Separate report 088
records approval and the actual production rollout. The qualified
ARM64/x86_64/API28+ build is unchanged; unsupported older devices retain the old
app. The managed hour, verified upload and three-reopen continuation pass.
Production-channel installed canaries, the real 24-hour observation and unrun
physical tests remain unchecked. Earliest observation end: October 11 at
16:51 UTC, subject to actual evidence before expansion.

The detailed contracts below remain authoritative. This short list is the
current work; dated attempts and exact evidence belong to Tactical259 and the
ignored separate reports, rather than this summary.

- [x] Fresh MIT-compatible desktop candidate: source `ff632f45`,
  [run38050770001](https://github.com/kzahel/rstorrent/actions/runs/38050770001),
  five signed lanes/collector,15 independent hashes, six original-root signatures
  and wrong-root refusals,11 selectors, Mac trust/staples and native Windows
  NSIS/MSI signatures pass. Five extracted inventories and both Linux custom-source
  gates pass. Prior installed receipts stay historical; Windows VM off/released.
- [x] Actual managed28 enabled-background hour:3,602.88 seconds/118 foreground
  service samples, independently verified partial piece, hidden40-MiB whole hash
  and stop-at-completion service absence. A brief peer/counter gap recovered.
  Preserve the text-only Pause harness failure; independent label-based Pause,
  three normal Shutdown/reopens, Keep data/hash and owned cleanup pass under074.
  Notification denial restored, Power off and zero observed tabs/windows.
- [x] Play submission preparation: exact28 bundle saved at5%; public privacy,
  standalone reviewer instructions, optional feedback Diagnostics declaration,
  actual signed phone captures and original-brand graphic saved. All29 text
  localizations audited; Hindi name corrected to JSTorrent. Play shows Changes
  in review with managed publishing on under078/084. Approval and actual 5%
  publication are separately recorded under088; no installed canary is inferred.
- [x] Actual managed28 source-absent foreground upload: an independent peer
  receives4,194,304 bytes and the expected whole hash after the initial source
  listener closes. Original incoming setting, installed identity and grants
  remain unchanged; owned forward/source/row/file and normal Shutdown cleanup
  pass under087. All VMs off and both Chromebook inventories empty under086.
- [x] Historical desktop candidate: source `2b83ed91`,
  [run38029276220](https://github.com/kzahel/rstorrent/actions/runs/38029276220),
  five signed lanes/collector,15 hashes, six original-root signatures/wrong-root
  refusals,11 selectors, both Mac trust/notary/staples and five package inventories.
- [x] Fresh Windows installer artwork, native NSIS/MSI signatures, populated
  manual replacement and interrupted-download/ordinary GUI updater retry.
  Four-record Quit/reopen and exact restoration/off/release/trial removal pass.
- [x] Actual Play26-to27 retained installation, disclosure opt-out, populated
  Shutdown/cold recovery, verified download, notification-denied Minimize and
  owned-folder outage/restoration. These are bounded managed27 checks.
- [x] Historical Web Store draft1.1.2: exact ZIP, accurate description/permission
  copy, reviewed data categories and all three current screenshots saved and
  reload-verified. Published1.1.1 remains unchanged; no review submission.
- [x] Fresh AppImage source review packet:89 descriptor-bound source versions,
  original notices and unchanged outer-runtime binding; all736 members verify.
  The packet remains local and does not clear the requirements below.
- [x] Actual managed27 enabled-background hour:3,601.75 seconds/118 samples,
  hidden40MiB whole hash, service stop and normal return. Original harness
  failure retained; independent cleanup/settings/permission restoration pass.
- [x] Managed foreground upload: independent4MiB whole hash with original source
  absent, exact package/grant continuity, normal cleanup and empty workspace.
- [x] Exact1.1.2 candidate/managed27 permission, pairing, shared Pause and
  Shutdown/retained reconnect; scoped cleanup and zero tabs/windows pass.
  Normal companion setup remains; the owned browser credential is removed.
- [x] Exact1.1.3 actual managed Shutdown guidance/readable links, stopped Retry,
  normal launch/retained reconnect and scoped cleanup/zero tabs/windows pass.
- [x] Exact1.1.3 replaces the uploaded Web Store draft; reviewed listing,
  screenshots/privacy retained. It is now Pending review with automatic
  publication disabled; public1.1.1 remains unchanged.
- [x] Local retained-folder repair fix: unchanged API35 regression fails; fixed
  paused/running controls and cold reopens pass, with bytes/source cleanup.
- [x] Prepare1.0.28/code28; its exact debug APK repeats repaired intent/bytes and
  cold reopens, Android checks and owned AVD cleanup.
- [x] Verify frozen desktop application source inputs: exact offline Cargo/web
  sources and local carrier. Original-r0 x64 runtime source-build/relink passes;
  rebuilt bytes differ from shipped bytes. Owned staging removed, VM off/released.
- [x] Linux native packaging: x64 and ARM source/ABI/codec/offscreen/package
  gates pass (130 TIFF tests/all240 exports each). Actual x64 window/background/
  Show/Quit and loaded-library checks preserve branding and remove the identified
  GPL-only libraries. Build/hooks and extracted refusal gates added; both VMs
  off/released. Fresh signed Linux qualification/source delivery remain open;
  ARM product UI and outer-runtime relink are separate.
- [x] Original-upload-signed Android28 APK/AAB: source `ff632f45`,
  [run38050769738](https://github.com/kzahel/rstorrent/actions/runs/38050769738),
  original upload certificate, production identity, both ABIs,16-KiB alignment,
  bundle validation and exact notices pass independently. Normal release-APK
  Repair preserves paused/running intent, whole hashes and both cold reopens
  in a fresh owned API35 emulator. Final14 frame/brand snapshots pass; four
  Shutdowns join and emulator/AVD cleanup passes. Initial failures stay recorded.
- [x] Deliver Android28 through internal Play and re-run managed repair. Actual
  Play27-to28 retains installation identity/grants and independently verified
  managed signer. Paused/running repair, source-offline hashes, cold reopens and
  joined Shutdowns pass; owned data removed and zero tabs/windows verified.
  Historical managed27 retains its recorded failure.
  Physical sleep/network/reboot and
  populated old-store writers remain explicit. The other Chromebook stalls before app startup; guided recovery
  awaits confirmation of physical keyboard availability.
- [x] Fresh Mac ARM GUI and Linux x64 automatic HTTPS updater/restart pass: ten
  checks each, four-record native Quit/reopen, restoration/off/release and shared
  private trial removal. Historical A7 x64-under-Rosetta receipts retain their
  exact scope; physical Intel/Linux ARM/FUSE remain unrun.
- [x] Complete selected native redistribution/source/relink disposition and a
  real source-delivery route. Historical2b83 AppImages bundle GPL JBIG through
  TIFF and GPL-3 Ayatana through the tray library. MIT is retained:294's native
  rebuild removes those chains; both fresh signed packages pass extracted
  native/source gates. Exactff632 Linux x64 and Mac ARM installed checks pass.
  Final exactff632 local carrier and usable instructions pass independent full
  verification; original-r0 runtime source/relink executes on both architectures.
  Exact signedff632 Linux x64 updater/restart now passes under071. All17 public
  downloads, including final sources, pass independent hashes under080. Actual
  public website82 and all11 production updater selectors83 pass; original roots
  and preview channels remain unchanged.
- [ ] Review the exact shipment, supported gaps, soak/stop criteria and recovery
  owner. Submit/publish only the explicitly approved store/feed/release/website
  scope; actual store-update canaries follow approved delivery.

Linux is best effort, AppImage/headless; iOS is excluded. Application source
inputs in crates/web/Android app/extension and their reviewed lockfiles are
identical between A7 and2b83; this is source equivalence, not binary equivalence
or permission to relabel old artifact receipts. Default Status/detail clipping,
technical obstructed-registration errors and Android removed-detail navigation
remain recorded design findings.

Machine Control is the preferred testbed interface. Prepare the next executable
check before booting a VM; shut down/release between uses. Close Chromebook tabs
individually before windows and verify empty inventories after every slice.
Keep each detailed report and its screenshots under the ignored evidence path.

Owner: [product-surfaces-and-migration](topics/product-surfaces-and-migration.md).
Campaign: [231](tactical/231-jstorrent-migration-working-campaign.md).
Candidate mechanics: [250](tactical/250-jstorrent-production-identity-candidates.md).

For each installed cohort record exact source/artifact hashes, old/new versions,
public signing identity, platform/build, observation and recovery. Disposable
signatures, injected states and unsigned installations are explicitly scoped;
they cannot satisfy production delivery. Keep private values out of public docs.

## Candidate Identity And Delivery

- [x] **D-01 Desktop identity:** fresh source2b83/run38029276220 retains
  JSTorrent display/icon identity, `com.jstorrent.desktop`, original updater
  trust/route and0.3.0 ordering above the selected released0.2.1 baseline.
  Five-lane metadata, original assets and independent extracted package checks
  pass. Incubation identity/root remain separate; installed acceptance is P.
- [x] **D-02 Desktop signatures:** all six fresh updater signatures verify with
  the retained key and refuse the incubation root. Both Mac architectures pass
  strict/deep Developer ID/team, notary CDHash binding, app/DMG staples and
  Gatekeeper. Native Windows verifies fresh NSIS/MSI Kyle Graehl publishers and
  Microsoft timestamps. Independent hashes bind the actual final artifacts;
  failed inspection/preflight assumptions remain recorded. Source/redistribution
  and complete installed delivery remain R/P requirements, not signature claims.
- [x] **D-03 Android identity:** `com.jstorrent.app`; versionCode exceeds all Play
  tracks, including closed/internal/testing, and selected GitHub APKs. Record
  upload certificate separately from the existing Play app-signing certificate.
  Play-generated APK updates an installed Play build without uninstall/data clear.
  Code27 exceeds the fresh pre-upload maximum26 and selected GitHub code24.
  Exact original-upload-signed AAB, Play-generated APK and actual installed
  base APK independently verify their separate certificates. The retained
  Play26-to27 installation preserves UID, first-install time and installer.
  Library, privacy/lifecycle and broader physical acceptance remain A gates.
- [ ] **D-04 Extension identity:** existing Web Store item
  `dbokmlpefliilbjldladbimlcfgbolhk`, public manifest key derives that ID, and
  version exceeds every published track. Review permission/CSP/launch-route changes
  and store disclosure. Existing browser profile receives an actual extension
  update; a second unpacked ID is insufficient.
- [x] **D-05 Update services:** inspect candidate response/signature, OS/arch
  selection, version ordering and retained channel behavior. Check rollback/stop
  route before offering the candidate. Changes to GitHub asset ownership or the
  update server's product descriptor are explicit, reviewed operations. Actual
  production0.3.0 activation passes under083:11 selectors, current/newer204,
  empty production Latest204 and unchanged preview response hashes. Exact prior
  descriptor is saved for stop/offer restoration.

## Desktop Installed Matrix

Run on supported macOS arm64/x64, Windows x64 and Linux x64/arm64 package lanes;
select representative historical sources and browsers. Keep each unrun lane open.

- [ ] **P-01 Installed update:** real installed JSTorrent checks its normal route,
  verifies the candidate, replaces itself, relaunches and retains its OS identity.
  NSIS replacement, AppImage path and macOS bundle path are exercised. Package
  manager lanes have their documented upgrade route. Bounded 252 evidence passes
  original 0.2.1-to-0.3.0 HTTPS automatic delivery on Linux x64, Windows x64
  and macOS arm64, plus the ordinary Windows/macOS UI. Mac x64 now also passes under existing Rosetta; physical Intel hardware,
  Linux ARM and the Linux old-app UI remain open; the complete row is not satisfied.
- [ ] **P-02 Legacy shutdown:** running desktop/old native hosts, open legacy
  extension pages and idle pre-handshake helpers cannot remain payload writers.
  Managed old registrations refuse the legacy protocol. Failure to fence or prove
  shutdown stops import visibly; a retry preserves source and payload.
- [ ] **P-03 Import:** union multiple browser profiles; paused, active/partial,
  completed, pending magnets, cached metadata, Normal/Skip selections and multiple
  roots. Mapped settings carry best effort. Fresh and latest-format destinations,
  duplicate torrents, malformed records, unknown/missing roots and unavailable
  source stores have explicit outcomes. Foreign verified bits never bypass checking.
- [ ] **P-04 Durability:** crash before/inside/after the atomic catalog transaction,
  retry, process restart and OS restart. Exactly one completion marker; no duplicate
  records, source resurrection after clear or partial catalog publication.
- [ ] **P-05 Real bytes:** independently hash valid/corrupt/partial payload before
  and after; valid retained bytes recheck, corrupt bytes repair, interrupted content
  resumes. Missing roots are not recreated and repair restores the original binding.
- [ ] **P-06 Launch continuity:** existing launcher/pinned shortcut, tray Open,
  `.torrent` file and magnet links, browser toolbar and native window reach one
  owner/library. Include spaces/non-ASCII paths, cold/warm launches, simultaneous
  launch, explicit Quit, passive reconnect and browser restart.
- [ ] **P-07 Mixed desktop versions:** new extension + old desktop gives an explicit
  desktop update requirement; old extension + new desktop cannot write through the
  retired protocol. Both new clients show the migrated library. Credentials
  rotate on replacement and repeated pairing/registration repair preserves state.

## Android And Chromebook Installed Matrix

Controlled API 28/35 writer upgrades already pass in [247](tactical/247-android-ordinary-writer-upgrade.md)
and [248](tactical/248-chromeos-staggered-upgrade.md). Complete production/physical
rows independently; those tests use disposable signing and owned emulators.

- [ ] **A-01 Ordinary Android writers:** existing standalone and ChromeOS companion
  write real supported settings and paused/partial/completed torrents before the
  installed upgrade. Actual production package/signature, library and private
  downloads persist. Retained launcher component/pinned shortcut opens the new app.
- [ ] **A-02 SAF:** two different user-selected trees, exact per-torrent binding,
  real retained read/write grants, process restart, reboot, revoked/regranted tree
  and unavailable/removable provider. Preserve unrelated bytes; copied URI text
  never establishes permission. Include physical Chromebook ARCVM evidence.
- [ ] **A-03 Staggered stores:** old/old remains ordinary; new extension/old Android
  requests an app update without old pairing/I/O; old extension/new Android leaves
  standalone Android usable; new/new approves fresh pairing and controls the same
  migrated catalog. Exercise an existing production extension ID updated in place.
- [ ] **A-04 Android lifecycle:** foreground/background setting, unmetered network
  policy, leaving native/browser views, detached transfer completion, picker cancel,
  force-stop/relaunch and reboot. Device notification/power preferences behave as
  documented. No second engine/profile or legacy credential authority appears.
- [ ] **A-05 Historical cohorts:** qualify selected Play versions, companion remote
  KV and browser-local fallback/older routing explicitly. Crostini automatic
  migration stays out of scope and its library remains separate.
- [ ] **A-06 ChromeOS onboarding:** on both physical Chromebooks, qualify Play
  not enabled/setup unfinished, real app installation, unavailable/failed
  installation and mixed-version recovery. Record actual versus injected
  states, exact artifacts and every unrun condition; sideload/emulator evidence
  cannot close the Play journey. Tactical 253 passes six injected packaged-browser
  journeys and bounded cohort-A sideload/extension recovery, including real
  rejection, declared-window expiry and terminal manual cancellation. Real Play and
  cohort-B acceptance stay open.
- [ ] **A-07 Troubleshooting and Linux fallback:** before host connection,
  explain the observed failed stage and manual next action; offer explicit
  Crostini setup where permitted. Qualify Linux-not-enabled, package absent,
  stopped VM and unshared folder. Explain separate libraries, preserve Android
  state and show an unsupported outcome if neither host is available.
  Cohort-A offline recovery and exact Linux package runtime pass. Normal Terminal
  startup restores registration; current isolated browser file-picker intake,
  stopped-VM manual Retry and durable-profile row/byte retention pass. Current
  signed installation/candidate Launcher and the remaining setup/share/store
  cohorts keep full fallback acceptance open.
- [ ] **A-08 Physical repetition:** Tactical
  [253](tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)'s
  bounded cold-launch, verified transfer, view detach, interrupted connection,
  storage repair, restart and lifecycle cohort passes on both devices. Every
  unqualified route remains explicit before ChromeOS rollout. Cohort A passes
  three independent byte-verified recovery repetitions per host and both
  controlled 60-minute observations. Android detached completion and actual
  Remove/keep/restart pass. Linux hour observations and three repetitions remain
  runtime only; the follow-up adds bounded real browser/file-picker and
  source-offline VM recovery evidence. Current storage repair,
  sleep/reboot/device network loss and remaining cohort-B acceptance stay open.
  Owned test state, pairing storage and the stopped VM baseline are restored.

## Product, Recovery And Release Decision

After the current source/package gates, prioritize the remaining work in this
order. These are qualification and product decisions, not publication authority:

1. Continue actual store delivery under
   [297](tactical/297-staged-store-delivery-and-soak.md). Exact managed Android 28
   passes the detached hour, hidden completion, three normal reopens and
   source-absent foreground upload. Production release 23 remains available;
   controlled acceptance does not establish the production-channel installed
   canary or the full retained-library/lifecycle matrix. Release 28 is now
   published at 5% under088.
2. Qualify companion/browser-local writers and the actual production extension
   ID updated in place, then repeat mixed-store pairings on both physical cohorts.
3. Complete the two-tree/reboot/grant-loss and sleep/network-loss matrix; include
   retained bytes, actual upload serving and independently verified repair.
4. Requalify installed delivery against the fresh signed desktop bytes where
   source changes matter. Extend macOS x64 and representative current Linux
   systems under the accepted best-effort scope; previous signed-candidate
   evidence remains pinned to its own hashes.
5. Select the supported persistence/platform scope, feature dispositions, soak
   window and recovery responsibility, then review the exact shipment capsule.
   Keep unrun rows unchecked or explicitly exclude their unsupported scope.

- [ ] **R-01 Feature disposition:** review recorded unsupported VPN, battery/plugin
  and other gaps. Migrate only implemented matching semantics.
  Minimum API 28 (Android 9) is accepted; API 26/27 remain on the old app and
  outside the replacement cohort. Validate clear OS-update/unsupported-device
  guidance, including staggered extension updates with no available Play update.
- [ ] **R-02 User outcomes:** report imported/already-present/skipped/failed counts,
  actionable missing-folder repair and retry/recovery. Explain supported setting
  changes and dropped features. Verify voluntary support/export and privacy wording;
  do not include paths/hashes/credentials in automatic telemetry.
- [ ] **R-03 Recovery:** interrupt updater/install/migration, disk full, busy/locked
  store and denied registration/grant. Failure preserves source/payload and has an
  actionable retry. Old-engine rollback must not run concurrently with successor
  writers or pretend its retained verified bits are current.
- [ ] **R-04 Candidate soak:** real transfers, seeding, restart/sleep/wake and
  browser/native lifecycle over an agreed observation window. Record known gaps,
  selected cohorts, stop thresholds and rollback responsibility.
- [ ] **R-05 Shipment approval:** exact source and artifacts, all required CI,
  store version/certificate review, final checklist disposition, staged cohort and
  independent update order reviewed. Publishing/tagging/store uploads require an
  explicit instruction; this checklist prepares that review.
