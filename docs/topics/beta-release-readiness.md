# Beta Release Readiness

The October 24 maintenance audit finds newer advisories after the ctutils
repair below. Tactical [381](../tactical/381-dependency-cleanup-and-security.md)
updates crypto-bigint 0.7.5 to 0.7.6 (and its required ctutils 0.4.5), Tokio
1.53.1 to 1.53.3 in both Rust lockfiles, fast-uri to 3.1.9 in both npm
graphs, web undici to 7.30.1, and website undici/zod to 8.12.3/4.6.7.
Fresh review at RustSec `1645308cb4766561b0b274d8c93f7033a766fc96` has
zero probe/web/website vulnerabilities and preserves the existing warning
inventory and November 12 expiry. The workspace still reports
RUSTSEC-2026-0387 for crypto-bigint 0.5.5 through elliptic-curve 0.13.8,
P-256/P-384, OPAQUE and the pinned WebRTC graph. No compatible patched release
exists; a reviewed backport or coordinated crypto-stack migration needs
explicit direction. The strict release gate remains blocked. The bounded
[receipt](../tactical/evidence/381-dependency-cleanup.json) distinguishes
completed validation from this unresolved finding; this is not release
clearance.

Latest desktop run [39926104142](https://github.com/kzahel/jstorrent/actions/runs/39926104142)
stopped before packaging on October 23 when the fresh advisory database added
RUSTSEC-2026-0385 for ctutils 0.4.2 in both Cargo lockfiles. The workspace and
standalone iOS probe now select ctutils 0.4.4; its
[upstream security release](https://github.com/RustCrypto/utils/pull/1569)
fixes constant-time mask generation and 32-bit `u128` comparisons. No advisory
is waived. Fresh strict release review at advisory revision
`f7b2f6bc663452200bbe639ebb75e0c762b3422b` passes with zero vulnerabilities
in both Cargo and both npm reports, the existing reviewed warnings and
unchanged November 12 expiry. The 36 distribution-review and ten GLib
backport tests, workspace formatting, workspace Clippy and all 1,749 workspace
tests pass (20 existing ignores). Android release libraries build for x86_64
and ARM64; the standalone iOS probe passes formatting, its locked simulator
compile check and all four host tests. This repair does not itself publish a
release.

The October 23 Dependabot cleanup retains the verified GLib 0.18.5 backport
and the feature-guarded rand 0.7.3 review; alerts #1 and #18 are dismissed with
that evidence. The November 12 warning-review expiry is unchanged. The
non-shipping iOS storage probe now selects rustls 0.23.46, rustls-webpki
0.103.16, webpki-root-certs 1.0.10, quinn-proto 0.11.18 and chacha20 0.10.2.
Fresh audit of that previously uncovered lockfile found five Quinn advisories
and a yanked ChaCha dependency after the TLS refresh; the targeted updates
clear all probe vulnerabilities and warnings without changing production
dependencies. Its obsolete storage-key field name is aligned with the current
engine API so the probe compiles for the iOS simulator again.

Daily, pull-request and release advisory collection now includes the probe
lockfile. Review requires its exact digest, a fresh advisory database, zero
vulnerabilities and zero unreviewed warnings; bounded CI receipts include the
probe result and findings on failure. Local validation passes 36 distribution
review tests, ten GLib backport tests, workflow actionlint, workspace/probe
formatting, the locked iOS simulator compile check and fresh strict review
of both Cargo and both npm lockfiles. This cleanup does not publish a release
or repeat physical probe qualification.

Tactical [380](../tactical/380-product-release.md) completes the October 22
release: desktop Stable 0.3.4 and Android 1.0.32 are public, requiring extension
1.1.5+. Extension 1.1.6 and remote controller 0.3.3 were already verified.
Android's exact signed dual-ABI/16-KiB artifacts and physical ChromeOS
pairing/folder selection pass; Play confirms availability in all 178 countries.
Desktop exact-source full CI and all five signed native jobs pass at ecd65fe4.
The collector's corresponding-source inventory failure is recovered separately
with reviewed tooling/pins at 9bc0b3ef, retaining every original signed native
byte and CI-signed metadata. Thirteen source-helper tests and all 39,249 source
carrier members verify. Both Mac native hosts execute; Intel uses Rosetta.

Unchanged-byte Stable promotion passes. All seventeen public assets in each
channel, six payload signatures, signed database facts and live update offers
verify; equal/newer callers receive no update. Four automatic targets remain
enabled and Linux ARM remains manual. The canonical website deploy passes,
and public provenance/download links select 0.3.4 at bdd9c4e9. Final web
validation is 886 passed/three existing skips plus typecheck; the fifteen-delivery
ledger and database-history checks pass. The
[desktop receipt](../tactical/evidence/380-desktop-release-receipt.json) records
exact source, recovery and public evidence. This does not repeat 377's installed
update cohorts or establish production stability. These current decisions
supersede historical publication holds below.

The October 21 Latest 0.3.4 source check at `52067935` failed its fresh
dependency audit before packaging or publication. Earlier dependency fixes had
passed advisory review on October 20. The lockfiles now select rustls-webpki
0.103.16, webpki-roots 1.0.10, webpki-root-certs 1.0.10 and Vite 8.1.6 within
its existing minor series. Upstream documents the certificate distrust fixes
([0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html),
[0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html),
[0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html)) and the
[Vite editor-command issue](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
Fresh Cargo and both npm audits now have zero vulnerabilities, and the strict
release-ready review passes with the existing warning inventory, independently
verified GLib backport and unchanged November 12 expiry. Independent advisory
review now runs daily at 05:31 UTC, retaining the fresh publication gate.
GitHub Dependabot alerts and automatic security updates are enabled; these
findings were absent from its open alerts at inspection, so that service remains
an additional signal.

Local validation passes: `cargo fmt --all -- --check`,
`cargo clippy --workspace --locked -- -D warnings` and
`cargo test --workspace --locked` (1,749 passed, 20 ignored);
`npm run typecheck --prefix clients/web`, `npm run test --prefix clients/web`
(870 passed, three skipped) and `npm run build --prefix clients/web`, including
CSP validation. `actionlint .github/workflows/dependency-review.yml` and
`python3 -m unittest discover -s scripts -p test_distribution_review.py`
(30 tests) pass. `clients/android/build.sh` completes both release ABIs and
Kotlin binding generation; packaging initially stops on local disk exhaustion.
After space is available, `clients/android/gradlew -p clients/android
assembleDebug testDebugUnitTest` passes, followed by
`python3 scripts/inspect-android-notices.py --archive
clients/android/app/build/outputs/apk/debug/app-debug.apk --variant debug`
(84 Maven and 207 Rust packages). This patch does not publish a release.

The October 18 Latest collector failure is in source extraction: Ubuntu 24.04's
7-Zip cannot read the Zstandard SquashFS used by the signed AppImages. Source
packagers now use `unsquashfs` at the reviewed runtime boundary without executing
either architecture. Full CI and release source checks install squashfs-tools
and exercise a synthetic Zstandard filesystem with an outer runtime, selective
notice extraction and invalid-offset refusals. Ubuntu extraction of both exact
0.3.3 AppImages verifies all 141 x64 and 140 ARM64 notice hashes. Hosted CI for
this repair is recorded by its commit checks; the failed 0.3.3 draft remains
private until publication is separately authorized.

Tactical [379](../tactical/379-release-security-dependencies.md) repairs the
fresh-audit blocker found during 378 publication: rustls 0.23.46 and ZIP 9.0.4,
with optional ZIP extraction disabled on the unchanged updater 2.10.1. Raw
Windows installers/Linux AppImages and unconditional macOS tar.gz remain.
No vulnerability is waived. Five source-reviewed warning additions retain the
existing November 12 expiry. Full source CI, all five signed native builds
and all 17 public Latest 0.3.2 assets pass qualification. The Linux source
carrier is completed with the corrected 7-Zip lookup after the collector
stops with its draft private; original signed native bytes are retained.

Tactical [377](../tactical/377-compatible-touchless-release-channels.md) adds
authenticated database admission, one increasing Stable/Latest release train,
source-bearing Latest publication and immutable Stable promotion. Actual signed
macOS ARM, Windows x64 and Linux x64 installations pass real 900/60 cycles,
higher-version/older-schema refusal and compatible Stable catch-up with retained
identities and channel choice. Background typing and transfer hashes/intent
pass; a real uncommitted SQLite migration crash rolls back and recovers on an
explicit relaunch. Exact package/source and sanitized result receipts are in
[377 evidence](../tactical/evidence/377-compatible-updates.json). Intel macOS under Rosetta also passes the full real-idle late-focus test and
manual compatible Stable catch-up. Both channels now permit unattended install
on macOS ARM/x64, Windows x64 and Linux x64. Linux ARM remains manual; no
physical Intel claim is inferred. Public Stable retains the strict-companion
hold; service permission alone publishes no package. Tactical
[378](../tactical/378-public-latest-and-nightly.md) authorizes Latest publication
and a daily changed-main release, accepting only the eight current field
exposures with extension 1.1.5 or newer required. Latest 0.3.2 and all five live
update offers verify, including authenticated metadata and unchanged Stable
bodies. Stable publication is not authorized.

Tactical [355](../tactical/355-automatic-updates.md) narrows the automatic
update plan to desktop app/NSIS/AppImage. The accepted goal is unattended
restart after 15 minutes without interaction, with transfer intent and user
data preserved. Native scheduling, verified staging and joined shutdown are implemented;
production activation awaits signed qualification on every enabled target.
The required gate is a repeatable synthetic signed A-to-B VM update through
Machine Control, checking real executable replacement, preserved transfer/data
intent and no foreground activation during background use. macOS ARM64 passes repeated presentation matrices, real 900/60-second
hidden and unfocused intervals, five feed/download failures, and controlled
download/seeding resumption. Windows/Linux ARM64 synthetic presentation matrices also pass. See 355 for
exact source receipts and the remaining shipping qualification gates.
Android in-app updates and the self-updating Linux CLI are separate follow-ups;
377 records the additional signed installed evidence and bounded rollout.

Tactical [372](../tactical/372-ci-packaging-and-presentation-regressions.md)
repairs desktop notice generation for npm's SSH spelling of the exact reviewed
mediabunny Git commit. HTTPS and SSH map to the same public preferred-source
archive; other origins, revisions and license declarations remain refused. The
production-lockfile regression, 29 distribution tests and actual macOS notice
generation (462 Rust / 35 npm packages) pass locally. Hosted package verification
is tracked by the submitted commit's CI checks.

Tactical [330](../tactical/330-android-1-0-31-production-release.md) submits
Android 1.0.31/code 31 for production at 100%, automatically publishing after
approval. Exact tagged signed APK/AAB checks and source Android/SAF integration
pass. At 14:37 UTC on October 13, Play shows only 31 Start full rollout in
Changes in review; quick checks are running and managed publishing is off.
Production remains 1.0.30 until approval. Installed delivery and stability
remain separate. Full source CI has one Windows socket-bind test failure;
all other applicable jobs, including Rust/web/Android, pass.

Tactical [326](../tactical/326-full-product-release.md) publishes desktop 0.3.1
from tagged 5fa018ff after full source/signed CI and independent package/source
qualification. All 17 public assets, the live website and 11 production updater
selectors verify; frozen incubation offers remain unchanged. Original-key Android
1.0.30/code 30 is available on Google Play at 100% in all 178 targeted countries.
Exact tagged artifacts and source Android/SAF checks pass. Extension 1.1.4 is
pending review with automatic publication after approval, preserving public
visibility, all regions and existing permissions.
Extension approval, installed acceptance and stability remain separate.


## Android 1.0.29 submission, 2026-10-12

Tactical [315](../tactical/315-android-1-0-29-production-release.md) records the
original-key signed 1.0.29/code 29 production submission from tagged 8ddf2e8b.
Full source/signed CI, independent APK/AAB gates and 29 owned navigation/shutdown
cases each on API 28/35 pass. At 07:01 UTC Play shows only 29, Start full rollout,
Changes in review, with managed publishing off. By 15:34 UTC quick checks have
completed and Play explicitly confirms changes are now in review. Automatic
100% publication follows approval. Approval and installed stability are not
inferred.

## Store delivery, 2026-10-11

Extension 1.1.3 is approved and published to the existing production Web Store
item. Separate ignored receipt089 confirms the physical live listing, fresh
store installation/source/version, Android28 pairing and empty-library
connection, retained pairing on reload and normal Shutdown/relaunch/Retry
reconnect. Package, persisted grants and notification preference are preserved;
individual tabs/windows close and the installed extension remains for canaries.
This supersedes the pending-review state in the historical paragraphs below.
An existing-extension update, Android production-installed canary and real
24-hour observation remain under [297](../tactical/297-staged-store-delivery-and-soak.md).
The maintainer explicitly directs Android 1.0.28/code 28 to 100% at 19:52 UTC;
Play confirms full availability and ignored report090 preserves the state.
This supersedes the 5% hold. The tested Android28 predates production
publication; production-installed migration and stability evidence remain open.

## Release identity, 2026-10-11

JSTorrent is the sole active release lane; desktop 0.3.0 already ships with its
original identity, signing key and updater endpoint. The RSTorrent incubation
release track is frozen. Earlier instructions to resume that flavor's package
or updater campaign are superseded by the
[owning release policy](product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11).
Historical validation remains evidence for its exact artifacts; retained
debug identities and legacy routes do not constitute an active release lane.

Hosted CI38056213798 passes every applicable job at37a09a68, including both
Linux extracted native/MIT packaging gates and Windows. Workflow preparation
corrects the earlier unsigned Linux failures without changing signedff632
candidate bytes. Separate081 preserves the actual hosted result.

Tactical296 separates overlapping production/preview desktop tag prefixes with
an exact package-family asset rule and isolated qualified caches/notes. Server
6013309 passes92 tests/typecheck/build; repository27 release/candidate checks
pass, including missing/wrong marker refusals. Actual rebuilt/restarted deployment retains
preview0.1.4/0.2.801 and byte-identical production0.2.1 offers under077.

Extension1.1.3 is submitted to the existing Web Store item with automatic
publication disabled and is actually pending review. Public privacy bytes now
match website52bfe325. Android28 is available internally and managed publishing
is on; production remains23. The exact desktop0.3.0 private draft retains all17
verified assets, including corresponding sources, and its tag pinsff632f45.
No asynchronous review or public cutover is inferred from a prepared draft.

Separate071 now qualifies exact signedff632 Linux x64 normal HTTPS updating from
released0.2.1: ten checks/six refusals, four-record native Quit/reopen, preserved
payload/source and persisted disclosure opt-out. Scoped restoration, VM-off/
release and private-trial removal pass; ordinary routes remain unchanged.
Separate072 prepares adjacent Linux source/rebuild links with30 website guards,
frozen enabled/disabled builds and four responsive captures. Real metadata stays
inactive pending actual public assets; publication remains a distinct gate.

Current authorized finish-line scope includes staged publication. Separate068
qualifies actual internal Play27-to28 delivery, preserved installation/grants and
paused/running Repair with independent hashes, cold reopens, managed signer and
clean Chromebook workspace. Production Play remains unchanged. Separate069 binds
a complete local source carrier to signedff632 AppImages;38,866 members and both
offline metadata graphs verify. Original-r0 ARM runtime build/relink now executes
under070, complementing x64;24 exports/AArch64 checks and VM-off/release pass.
Public source delivery, proportional new Linux installed evidence and live
cutover remain next. Historical paragraphs below retain their original scope.

Explicitly authorized main push and artifact-only signed rebuilds now pass at
`ff632f45`: Android run38050769738 and desktop run38050770001. Independent
Android28 APK/AAB identity/original-upload certificate, dual ABI,16-KiB and notice
checks pass. Normal release-APK Repair/whole hashes/cold reopens pass in an owned
API35 emulator; final14 frame/brand captures and emulator/AVD cleanup pass.
The failed ADB attempt and corrected verifier setup remain recorded. All five desktop
lanes/collector,15 hashes, six original-root signatures/wrong-root refusals,
11 selectors, both Mac trust/staples and native Windows NSIS/MSI trust pass.
Five independent inventories include both Linux custom-source/native guards.
Windows staging/server is removed, VM off and claim released. Separate066/067
own exact evidence. Store delivery, source offer, installed qualification and
publication retain their separate gates; no tag/release/feed/store is activated.

Tactical294 completes its bounded native packaging slice. Both native x64 and
ARM source builds pass130 TIFF tests/all240 original exports, relocation,
codec/original-loader, offscreen GTK and source/notice/MIT package gates.
Separate064 also passes actual x64 window, background, Show, normal Quit and
loaded-library observations with reviewed unchanged branding;065 owns ARM
native evidence. Original frozen packages are refused by the new gate. Both
Linux lanes prepare custom libraries before signing and repeat extracted checks.
Owned units/processes/roots/mounts/captures are removed, both VMs off/released.
Fresh original-signed candidates/source delivery, ARM product UI and ARM outer
runtime relink remain separate. No push or publication occurs.

The maintainer explicitly retains MIT on2026-10-10. Tactical294 supersedes the
pending combined-GPL proposal with bounded native GPL-only dependency removal
and new Linux package qualification. LGPL notice/source/relink and public source
delivery remain separate requirements. Existing2b83 signed Linux receipts stay
bound to their old bytes, not the future rebuilt package.

Tactical [293](../tactical/293-appimage-source-delivery.md) adds a verified local
frozen2b83 application source supplement:733 Cargo inputs,27 exact npm
distributions and14 preferred archives/16 bindings. Offline metadata for both
Linux targets and frozen web build/CSP pass; owned mutable staging is removed.
Actual TIFF dependencies in both images confirm GPL-2+ JBIG. The maintainer has selected dependency removal under294.
Separate062 also confirms GPL-3 Ayatana indicator through the tray library;
the full174/173 component hashes and173/172 ELF inventories pass. The frozen
loader source verifies. Removing JBIG alone is insufficient; 294 removes both identified library chains; the earlier combined-GPL
proposal is superseded. Owned extraction is removed; no license changes.
Original-r0 x64 source-build/relink executes successfully with24 exports/seven
static libraries verified; rebuilt bytes differ from the shipped runtime beyond
its named digest. VM off/release and owned cleanup pass. ARM, final per-package
disposition, complete native instructions and public source delivery stay open.

Finish-line059 prepares1.0.28/code28 containing Tactical292's paused-intent
Repair correction. Exact debug/API35 normal paused/running repair, source-offline
hashes and cold reopens pass; build/122 JVM/lint/script/notice checks and owned
AVD cleanup pass. Original-signed hosted APK/AAB, managed delivery and repair
remain open. Managed27 and frozen desktop2b83 receipts retain their bindings.
No push, tag, store upload or production publication occurs.

Fresh exact2b83 Mac ARM ordinary GUI and Linux x64 automatic HTTPS updates
also qualify in053/054: ten checks each, nine/six refusals, four-record native
Quit/reopen and privacy opt-out. Exact restoration/owned cleanup, VM-off/release
and private trial removal pass; ordinary routes remain unchanged. Actual report
images retain clipping/pre-existing OS overlays; source/package/relink and
public delivery remain separate. No production publication occurs.

Fresh2b83 Windows qualification now passes actual signed NSIS wizard/cancel,
populated manual replacement and released0.2.1 ordinary HTTPS updater retry
after an interrupted download. Eleven updater assertions/eight refusals and
four-record native Quit/reopen pass; exact restoration/off/release and private
trial removal verify. Read-only native fresh MSI Authenticode also passes in
the same owned session; MSI installation/associations remain separate.

Slice048 binds the fresh AppImages to all89 exact Ubuntu source versions,
descriptor/archive/patch hashes and129/128 original notices. A new local
530,073,600-byte exact2b83 review packet independently verifies736 members.
Both outer runtimes match previously inspected pinned8f39b89 bytes except their
named payload digest. Historical packets stay intact. Per-package disposition,
ARM relink qualification and a real public source delivery route
remain open; no source packet is published. Tactical259 owns exact evidence.

Fresh production-identity candidate2b83ed91 now passes all five signed lanes and
collector in run38029276220 with publication disabled. Independent15 asset
hashes/sizes, six original JSTorrent-root signatures/six incubation-root refusals,
11 selectors, both Mac strict signatures/Gatekeeper/app-and-DMG staples/ticket
CDHash binding, and five extracted package/notice inventories pass. Exact source,
proofs and corrected pre-staple/final-DMG verifier scope belong to Tactical259's
separate Slice043 report. Fresh Windows wizard/install/updater evidence is now
recorded in separate047/049 reports. Earlier A7 receipts remain exact-byte history;
corresponding-source/relink, public delivery and complete installed acceptance
remain open. No release, tag, feed, store review or publication occurs.

Tactical290 changes Windows installer artwork after the frozen a7 signed build.
Its bounded local native preview passes; final Windows identity/signature gates
reopen for fresh production packaging. Earlier a7/non-Windows proofs retain
their exact-byte scope. Slice024 now passes x64 updating under existing Rosetta,
with physical Intel hardware and DMG installation kept separate.

Slice020 collects the final A7 AppImages' exact89 Ubuntu Noble source versions,
every SHA-256-bound descriptor/source file and original128/129 notice files.
A local529.8MB review capsule includes frozen first-party source, selected
runtime material and provenance; all736 covered members verify independently.
Owned extraction is removed, no signed byte or public route changes. The older
Jammy matrix stays historical. Public delivery, per-package disposition and
complete runtime relink/native review remain open; slice016 caveats are retained.

Slice016 prepares a concrete10.95MB current outer-runtime review capsule:
seven verified upstream source archives, original notices, pinned Alpine
recipes/patches and the independently exercised x64 relink prototype. All43
archive entries verify internal checksums; supplemental notices include the
original mimalloc MIT copyright/license. Signed A7 bytes remain unchanged.
It is local selected runtime material, not a complete public source offer;
Ubuntu bundled-library sources/notices, distribution-ready instructions and
architecture review remain open. No VM or public upload occurs. Slice020 now
collects the exact Ubuntu sources; public delivery/per-package disposition
remains separate.

## Current execution checkpoint: 2026-10-09

The reviewed Android27 AAB is delivered to the existing internal track. Play
reports **27 (1.0.27), Available to internal testers**; production remains23,
and existing testers and all supported-device counts are unchanged. Its exact
AAB SHA-256 remains `383379eeb05363e6a361e02a9a1250fb6e72c8dc595b6267bb897b17f34156d8`.
The downloaded Play-generated universal APK independently verifies the existing
managed signing certificate, package identity, API28 minimum, target36, both
native ABIs and16-KiB ZIP/ELF alignment. Store availability and download checks
are separate from complete preserved-library and Shutdown/reopen acceptance.

D-03 now closes its bounded identity/version/signing contract: current27 exceeds
fresh Play pre-upload maximum26 and selected GitHub code24; original AAB upload
certificate and actual downloaded/installed Play certificates independently
verify. The managed upgrade retains its installation identity without clear or
uninstall. A-01–08 data/lifecycle/mixed-store and production shipment remain open.

One retained physical Chromebook now updates26-to27 through the actual Play
Update control without sideload, uninstall or clear. UID, first-install time,
Play installer and exact URI grants remain unchanged; both owned observations
clean up successfully. Later slice002 saves actual statistics opt-out and
qualifies normal Shutdown/task/service removal and Live reopen with exact
grants retained. Populated-library/reboot acceptance remains open. The other
device's documented ADB connection attempt refuses; no reboot, rootfs repair
or power-policy change is performed. Private receipts/screenshots stay ignored.

Original-root desktop candidate `a7ee65ed` now completes all five signed lanes
and collector in run37958746928; main CI37958695272 also succeeds. Independent
checks reconcile15 core sizes/hashes, six original-root signatures/six wrong-
root refusals and11 selectors. Both actual Noble AppImages carry the reviewed
WebKit2.52.6/OpenSSL3.0.13-0ubuntu3.16 floors. Five extracted formats reconcile
first-party binaries and notice manifests; owned extractions are removed.

Both Mac archives independently pass strict/deep Developer ID signatures,
original team, original icons and local ARM-host Gatekeeper. Both DMGs pass
stapling; Accepted Apple ticket CDHashes match each delivered app/main/host/DMG.
Native Windows x64 independently observes valid Kyle Graehl NSIS/MSI signatures
and Microsoft timestamps, with exact package hashes and read-only MSI identity.
Two harness errors stay failed: COM table methods initially emitted null and a
subsequent assertion incorrectly required manufacturer capitalization. Corrected
independent checks reconcile retained native observations; no package bytes
change. Windows staging is removed, VM off and claim released.

D-01/D-02 now close their bounded final identity/signature contracts alongside
D-03. Native installed/automatic-update/launcher, complete native security and
corresponding-source/relink acceptance remain separate P/R requirements. The
collector has exactly15 core assets; a production draft adds a separately
verified SHA256SUMS support file. Its synthetic draft metadata is not a live
GitHub draft, release, tag or updater feed.

Current signed Linux x64 AppImage and Mac ARM archive each pass eight real
old-writer migration assertions, valid/corrupt reverification, missing-root
preservation and stable four-row native Quit/restart. Refusal routes pass six
on Linux/nine on Mac. Actual native captures are visually reviewed; current
product titles/icons/menus show JSTorrent. The owned fresh profiles opt out of
statistics through real native input; independent persisted-state checks pass.
Inherited scoped state is restored, owned staging/capture copies removed, VMs
off, claims released and transfer servers reaped. Manual archive/AppImage
replacement does not qualify automatic updater, Intel native launch, FUSE or
all associations. Technical registration-failure copy and default tab/status
clipping remain recorded design findings.

## Current signed Windows NSIS, 2026-10-09

Exact a7 per-user NSIS manually replaces pinned0.2.1 and passes eight migration/
payload assertions, eight legacy refusal routes and stable four-row native
tray Quit/reopen. Nine actual captures are reviewed, including the correctly
branded firewall prompt. Independent50-registry/seven-file restoration, owned
firewall/staging cleanup and off/release pass. Earlier runner failures remain
failed; automatic updater and complete launcher/cohort acceptance stay open.
See Tactical259 for the byte-bound private receipt and design findings.

## Current signed native MSI qualification, 2026-10-09

Exact original-signed a7ee65ed MSI now passes quiet per-machine installation,
actual native About & updates checks and ordinary tray Quit/reopen. Both
initial and reopened screens show Windows MSI, Manual update required and Open
release downloads, without automatic-check status or check/install controls.
Three real captures are visually reviewed; build/package facts and JSTorrent
window/header/shortcut branding are consistent. Owned synthetic empty session
and version1/statistics-off fixtures do not change an inherited privacy choice.

Independent cabinet extraction matches both actually installed first-party
binary hashes and both notice hashes. NSIS/MSI main hashes correctly differ:
after excluding PE checksum/certificate fields, only the expected locked Tauri
bundle-type marker differs. No whole-binary equivalence is assumed. The initial
comparison harness incorrectly expected equality, then three changed bytes;
corrected evidence observes the two differing positions within NSS/MSI.

Independent restoration matches100 registry scopes/nine file scopes. Owned
MSI registration/staging/capture copies are removed; no unrelated firewall rule
is removed. Windows is off and the claim released. The first native attempt's
already-open-settings assumption and command-size cleanup failure stay failed;
separate exact-owned cleanup confirms restoration and staging removal before
the corrected repeat. This qualifies current native presentation/restart,
not installer wizard, legacy MSI migration, full associations or automatic
updater acceptance. Detailed receipts/screenshots remain ignored under259.

The exact extension draft upload remains authorized and blocked on the user's
Google passkey verification. Production publication and website deployment
remain outside the current instruction.

Ignored finish-line evidence retains delivery screenshots, exact artifact and
execution receipts, and each physical/build attempt. Nothing above closes the
whole installed/store acceptance checklist.

The maintainer authorizes the reviewed next candidate actions on 2026-10-09:
nonpublishing signed desktop build, exact production extension draft ZIP only,
and unchanged Android 27 delivery only to existing internal testers. No production
publication or sibling website deployment is included. Sourcefe30d273 is pushed;
attempt 37957327863 proves the original updater root, then is cancelled when a
remaining final signature CLI still expects ten payloads. Tactical285 corrects
it to six production/ten preview with 20 passing focused cases; replacement
qualification follows that tool-only commit. Store/installed acceptance remains
separate; current Web Store account verification requires a passkey.

Tactical [283](../tactical/283-companion-update-recovery-guidance.md) adds
component-specific recovery links and plain connection guidance in the
packaged extension, preserving attach-only retries and existing discovery/
pairing authority. The local source/render checkpoint remains separate from
actual store delivery and installed mixed-version acceptance under259. The
new production payload supersedes the prior source13dde build and source03e
extension upload proposals for final qualification; historical evidence stays
bound to its own bytes. No new build/store publication occurs.

Linux first-release scope is narrowed by maintainer direction on 2026-10-09:
best-effort AppImage desktop support, maintained bundled libraries, no older-
distro WebKit backport campaign, and CLI/headless fallback. Tactical 285 locally
applies production AppImage-only packaging on Ubuntu 24.04, with a reviewed
vendor WebKit build floor. Production now requires 15 core assets, six updater
signatures and 11 selectors; preview retains23/ten/15. Fresh signed inventories,
runtime/source review and representative launch evidence are still needed. Broader
Linux historical rows are scoped by this decision, not marked passed; final
candidate security, source obligations and representative installed checks
remain open. See the [accepted scope](product-direction.md#linux-release-scope-accepted-2026-10-09).

The frozen production-code build proposal is `13dde7a1`; shared web/extension
validation below was executed at source `03e63443`. New AppRun notice inputs
are locally qualified; revised hosted/signed qualification remains pending.

Runtime redistribution review has advanced under259 without product changes.
Seven source archives and ten original license files are inspected; pinned
libfuse/squashfuse archive hashes and all four exact Alpine recipe/archive
checksums plus16 auxiliary input hashes verify. Twelve source patches apply
sequentially in owned temporary extractions, which are removed.

A native x64 owned Alpine chroot builds runtime8f39b89 with patched libfuse3.15.0
and squashfuse0.5.2, using verified fixed zlib1.3.2-r1 packages. A separate
application-object/static-library relink runs version/help successfully.
Independent19-entry export hashes, seven libraries, ELF architecture and pinned
package/version facts verify. Both preliminary shell-path failures remain
failed; all three attempts remove their owned files/mounts, verify VM off and
release claims. No product profile, installed candidate or visible UI is used.
This prototype is not the original signed runtime, ARM validation or a delivered
source/relink offer. Complete native attribution/redistribution remains open;
the upstream runtime notice list also omits its statically linked mimalloc.

Original8c runtimes use Alpine zlib1.3.2-r0, while current1.3.2-r1 backports
[CVE-2026-85091](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148)
in nonblocking gzip writes. Both exact upstream debug assets verify release
SHA-256, original signed runtime GNU debuglink CRC and build-id bytes. Their
2,056/1,881 defined function tables contain no gzip-write functions or gzwrite.c;
109 C/header files across runtime/libfuse/squashfuse also have no such calls.
This supports a scoped absence inference, not complete security/exploitability
clearance. Maintained WebKit/accepted ABI, OpenSSL rebuild and R-05 remain open.

Tactical [282](../tactical/282-apprun-license-attribution.md) locally fixes
missing AppRun MIT copyright attribution in the exact signed8c AppImage notice
inspection. Both reviewed mirror launchers independently match upstream bytes;
the collector packages the original Simon Peter/RazZziel notice with exact
hash/source revision/origin/architecture checks. All26 distribution cases and
both actual launcher controlled-notice round trips pass. No implementation code
is imported. Fresh signed inputs change again after03e; earlier pending build
proposals are superseded. The upstream legacy release is marked obsolete and
archived build metadata is unavailable; reproducible build, all native source/
relink/security obligations and maintained WebKit/accepted ABI remain open.

The following shared-web/extension checks used source03e63443. The full default bundled
Chromium suite now passes62 cases with14 existing live/opt-in skips; focused
managed-package captures pass separately. Current branding2037 display values/
40 original assets and all maintained localization catalogs pass. Fresh exact-
lock Rust/npm review passes the unchanged seven-warning/backport policy and
2026-10-12 expiry; native WebKit/OpenSSL/source/relink holds remain separate.
The rebuilt production extension1.1.2 is400105 bytes/SHA-256
`38be77fd4237f8f09218dc69a1618b0cfdc8aa6143bbfe36346809edc2c93bfb`,
retains the existing item ID, and passes54 extension cases, exact19-entry ZIP/
13-bundle CSP validation and17 injected packaged onboarding/cache scenarios.
No device/store acceptance is inferred from injected cases. Authenticated
read-only store refresh remains Web Store published/draft1.1.1 with three
legacy screenshots/privacy text, and Play internal26/production23. No new
upload/draft save/certification/submission occurs. Frozen13dde push/nonpublishing
signed-build review supersedes pending681/b0b/932/03e proposals; explicit action
instruction remains pending. D-01/D-02 reopen for changed final package inputs;
immutable source8c signature/identity evidence remains valid for its own bytes.

Tactical [281](../tactical/281-managed-package-update-status.md) locally
repairs the actual MSI About-screen automatic-update contradiction. MSI/DEB/RPM
and unknown packages start and stay in existing manual package guidance, own
no check timers, and show no in-app check/install or automatic-check privacy
copy. Host policy, trust/routes and preference behavior remain unchanged.
Full web typecheck/478 tests (two existing skips),20 focused bundled-Chromium
render/accessibility cases and16 inspected managed/theme/width captures pass.
Fresh exact-source signed native MSI evidence remains open under259; renderer
fixtures are labeled separately from unchanged source8c before-fix captures.

The exact signed source8c Windows x64 MSI now passes quiet per-machine
fresh installation, both installed native publisher/timestamp checks,
five-entry distribution/notice inspection, native empty-library launch and
Quit/restart with a synthetic loopback/mapping-off/DHT-off/PEX-off fixture.
All four new native screenshots are visually inspected. Its owned
version1/statistics-off fixture and clean-shutdown marker persist. Normal
uninstall and independent100 HKCU/HKLM scopes/nine file-scope comparisons
pass; no owned process, firewall rule, candidate/related MSI or uninstall
key remains. All26 staging files are hash-bound and removed; VM off and
exact claim release pass. Installer wizard, legacy MSI migration and full
OS association dispatch remain unqualified. MSI uses its advertised
`JSTorrent.torrent` class and quoted short magnet path, recorded separately
from the private NSIS class; no NSIS-validator pass is inferred.

The real MSI About screen initially claims automatic updates are enabled.
Manual Check correctly changes to package-channel guidance, but automatic
schedule/privacy copy and the check button remain. Tactical281 repairs this
presentation/controller initialization issue; the desktop host already
refuses managed-package checks and replacement. Source8c screenshots are
unchanged before-fix evidence. The empty detail panel's implementation-oriented
copy is an additional design note, rather than an unstyled page.

Tactical [280](../tactical/280-desktop-executable-display-brand.md) locally
corrects the desktop output to `jstorrent-client`, preventing the observed
advanced-firewall filename from retaining the old display brand. The distinct
name preserves released old-writer process detection. All41 Node/23 native
distribution/85 Rust cases, clippy/fmt/workflow lint and the actual unsigned
Mac bundle/inventory pass. Identifiers, host, profiles, networking and updater
trust/routes remain intact. Fresh signed Windows system-label, migration and
updater evidence remains required under259; source8c receipts are unchanged.

The final signed source8c Windows x64 NSIS candidate now passes actual
per-user legacy0.2.1-to-successor0.3.0 installation: eight assertions, eight
registered refusal routes, four imported records, valid100%/corrupt0% recheck,
retained unavailable root, stable native Quit/restart and source/payload
preservation. All eleven new native captures are visually inspected. The
owned disclosure saves statistics off and remains version1/off after restart.
Independent checks compare48 HKCU scopes and seven restored file scopes;
exactly four newly created program-bound firewall Block rules are removed,
unrelated OS rules are preserved, no owned process remains, and35 hash-bound
staging files are removed. The VM is verified off and its claim released.
The separate MSI installation checkpoint above now passes its bounded scope.
Windows automatic/GUI updating and full launch/association cohorts remain open.
The advanced firewall inventory exposes `rstorrent-desktop.exe`; Tactical280
corrects the output name locally, with fresh signed system-label evidence still
required. This finding is separate from the branded product screenshots. The raw native-host
registration error also confirms the existing actionable-copy design gap.

The authorized native Windows x64 appliance rebuild is handed off with verified
AMD64 Windows11, real Python3.13 sqlite3/winreg, native semantic/capture/input
readiness and a real cold locked-to-unlocked stored-password login. Credential
bytes stay in a private0600 file/0700 parent; the registry stores its locator.
Native login delivery is confirmed while its effect field says no_effect;
independent unlocked state is recorded separately. Seed/staging cleanup and
restored inventory pass; VM off/claim available at handoff. One timed-out
factory-status journal intent lacks a result, so ready-close remains incomplete
without history alteration. Parent signed product qualification now resumes;
no product acceptance row is closed by rebuilding a machine.

Both exact signed source8c AppImages additionally bundle WebKitGTK
`2.50.4-0ubuntu0.22.04.1`. [Upstream WSA-2026-0003](https://webkitgtk.org/security/WSA-2026-0003.html)
lists affected versions before2.52.4, including CSP enforcement. Ubuntu's
[CVE-2026-43742 status](https://ubuntu.com/security/CVE-2026-43742) marks Jammy
Ignored and says current WebKit cannot be built on Jammy and earlier; Noble
has a fixed2.52.6 package. R-05 holds Linux shipment pending maintained runtime
and compatibility disposition; no product exploitability is asserted. T279's
OpenSSL floor does not resolve this separate WebKit gap or authorize a silent
minimum-OS change. Both bundled GLib versions meet the specific USN-8794-1
floor; this selected review is not a full native vulnerability inventory.

Tactical [279](../tactical/279-appimage-openssl-security-floor.md) records a
new native security shipment blocker: the exact signed source8c ARM AppImage
bundles OpenSSL `3.0.2-0ubuntu1.29`, below Ubuntu USN-8847-1's Jammy fixed
revision `3.0.2-0ubuntu1.30`. The x64 candidate contains the fixed revision.
A local packaging/extraction guard now refuses the ARM manifest, and Linux
builders explicitly refresh OpenSSL development/runtime packages. All 21
focused distribution cases and workflow lint pass locally. Rebuilding and
qualifying new signed bytes remain required; this is one advisory floor, not
complete native security clearance, and product exploitability is unestablished.
Original trust/integrity and functional receipts remain scoped to their bytes.


Topic: `beta-release-readiness`


Current finish-line checkpoint259 supersedes the historical candidate and store
statuses below. Approved desktop source8c/run37735081504 passes all five signed
lanes/collector,23 independent hashes/sizes,15 selectors and10 original-root
signatures and ten wrong-incubation-root refusals. Both Mac code signatures,
Accepted notarization receipts, DMG staples and local ARM Gatekeeper pass.
Final Mac ARM manual migration passes eight assertions/nine refusal routes,
with actual settled/restarted JSTorrent pixels, independent inherited-tree
restoration and off/released cleanup. Final signed ARM Debian extracted native payload
passes8 migration assertions/6 refusal routes, actual populated/restarted
pixels, source/payload preservation and restored/off/released cleanup. A
separate actual ARM Debian dpkg installation and installed native run also pass
eight migration assertions/six refusal routes, readable settled/restart pixels
and exact owned package/cache/profile restoration with VM off/claim released.
Updater and broader installed qualification remain separate. Approved private preview8c
is deployed and actually verified.

The final ARM Mac DMG also passes actual read-only mounting and standard app
bundle installation into the controlled guest's normal Applications location.
DMG SHA-256 is `8d2d1bba23d47f744f2feda4dcb9fd0f6af1c50eb7bbfb669ebd509f4a0a1373`;
strict/deep source and copied-bundle signatures pass and the mount is detached.
Eight migration assertions, nine refusal routes, stable four-row restart and
source/payload preservation pass. Settled/restarted native screenshots are
visually inspected for JSTorrent menu/title/icon/header and the styled library.
Independent inherited trees match; exact owned captures/staging are removed,
the transfer server is joined, VM is off and its claim released. This qualifies
DMG-mounted bundle installation, not GUI drag/drop or automatic updating.

The failed Linux launch probe remains failed. A bounded exact-owned cleanup
checks the actual apport crash-report backend for only that driver's command;
no retained matching report exists and zero files are removed. Unrelated crash
reports, markers and journals remain intact. Cleanup verifies VM off and claim
release. The first incorrect backend assumption stays failed.

The maintainer authorizes destruction/recreation of the rejected-login native
Windows x64 test appliance. A delegated YepAnywhere session now owns that
bounded provisioning task; canonical private credential-file/registry handoff,
real cold-boot stored-password login and native readiness are required before
resuming product qualification. This does not qualify Windows execution yet.

The final original-signed Linux x64 AppImage also passes its native
extract-and-run migration: eight assertions, six refusal routes, stable four-row
restart and exact source/payload preservation. Candidate SHA-256 is
`21d73341845fc1d93f45ae47ed393279a9f250407bfcfe0c22f5a63d75adcce7`.
All six native captures are visually inspected; settled/restarted JSTorrent
renders with its original icon/title/header and the owned disclosure choice
independently persists. The old 0.2.1 window remains blank. A system crash-report
dialog behind the refusal alert has unestablished ownership and is preserved;
raw registration recovery copy remains a design gap. The transient cgroup unit
is already collected at cleanup (stop reports not loaded). Guest/controller
roots and six hash-bound guest captures are absent; VM off and claim release
verify. FUSE, normal association delivery and automatic/GUI updating remain
separate. This is final source8c evidence, superseding historical manual x64
candidate scope without rewriting those receipts.

Actual final signed Linux x64 Debian installation now passes separately from
AppImage extraction. Exact candidate `0a71e2a3` installs `js-torrent` 0.3.0 amd64
with package-absence/file-collision guards; installed desktop/native-host hashes
match the signed package inventory. Eight migration assertions, six refusal
routes, source/payload preservation and readable settled/restarted JSTorrent
pass. Native owned disclosure input independently persists statistics false.
Cleanup purges only the owned package/files, restores inherited directory modes,
icon/application cache bytes and profile scopes, removes six exact exported
guest captures and guest/controller staging, then verifies VM off/claim release.
Bounded before/after apport metadata checks find no report tied to either exact
owned root; unrelated reports/markers/journals/dialogs remain intact. This does
not qualify normal launcher/associations or automatic updating.

Final signed Linux x64 controlled native launch also passes all twelve driver
cases in a fresh owned catalog with DHT/PEX off, loopback networking and queried
owned XDG associations. Twelve post-Quit IPC requests return Retry; busy-owner
retry and an 8.093-second bounded refusal pass. Native/background/magnet/file
replacement, both OS association paths with spaces/Unicode, twelve simultaneous
contenders with one owner, warm activation and 35-second no-resurrection pass.
The collected cgroup unit reports not loaded at stop; production singleton and
owned guest/controller roots are absent, VM off and claim release verify. This
qualifies controlled activation/ownership, not inherited pins, content intake or
browser/store updating. No product or graphics source change occurs.

Independent Git object/mode comparison finds 736 selected desktop/common Rust,
web, extension, website, distribution, packaging-script and release-workflow
inputs unchanged from signed source8c to the proposed CI/Android source681.
The sole Android Rust change is inside its test module; its runtime prefix is
identical. Android27's task-lifecycle/version changes remain separately scoped.
This does not prove new binary reproducibility, replace the signed8c identity,
or turn the failed8c/unperformed681 hosted CI results green.

Final signed desktop identity/signature gates D-01/D-02 now qualify. Native
Windows ARM verifies the exact installer hashes, accepted publisher and valid
Microsoft-timestamped Authenticode without login/install; both Mac archives
pass local ARM-host Gatekeeper policy (no Intel execution). Nine exact signed
formats pass independent binary/notice integrity/provenance inspection. Existing
native redistribution/source obligations stay under R-05. Final ARM AppImage
passes migration/refusal/owned acknowledgement/restoration, but native foreground
pixels stay unavailable and outer UI is prohibited. Final signed ARM native
controlled launch/OS associations, spaces/Unicode, 12-way one-owner concurrency
and stopped-after-Quit checks pass; inherited pins/browser/store and other
architectures remain open. Every completed session cleans up/off/releases.
Fresh exact-lock strict dependency review passes on 2026-10-08 with the existing
seven-warning policy, verified GLib backport and unchanged 2026-10-12 expiry.

Both final AppImage outer runtimes independently match upstream
`type2-runtime` revision `8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa` byte for
byte except each named 16-byte `.digest_md5` payload-digest section. The exact
upstream asset digests, ELF boundaries and pinned license/build/dependency inputs
are recorded in 259. This is runtime provenance, not complete corresponding-source
or redistribution acceptance; static dependency/relink and per-package review
remain under R-05.

Internal Play26 is delivered and both preserved managed packages update25-to26
through Play. The populated cohort retains complete/partial bytes and rows,
settings and durable SAF grant across engine restart. The other cohort retains
its inherited disclosure unchanged. Owned managed fixture records/files are
subsequently removed with installation metadata and inherited grant preserved.
Production remains23. Local Android27
fixes the real stale Live task after Shutdown and passes original-key packaging,
122 JVM cases/lint and actual isolated menu shutdown/reopen/hash/SAF/cleanup.
Code27 upload and revised-source hosted CI are unperformed. Original hosted8c
CI's Android listener test fails;277's test-only readiness correction and the
revised local fmt/clippy/1,575 cases pass. Web Store remains1.1.1; its native
inspection is complete read-only. No production release/feed/site publication
is performed; unavailable installed cohorts and owner policy remain open.


Tactical [271](../tactical/271-manual-production-desktop-publisher.md) prepares
an explicitly manual Stable JSTorrent publication path. Branch candidates and
stable tag pushes never publish; manual publication requires the exact stable
tag, no overrides and candidate mode disabled. Original-root signatures,
same-source/run/attempt legs and a complete private draft remain gates. The
production title uses JSTorrent, and all23 core assets/ten signature sidecars
remain, plus the24th SHA256SUMS support asset. Tag source is rechecked before
draft creation and publication. Local contract/refusal/shell tests, actionlint
and historical original-signed capsule assembly pass; this is not final signed
CI, installed qualification, a public release or updater/site activation.

Tactical [265](../tactical/265-production-website-release-handoff.md) prepares
sibling `0e935e75`'s disabled production website handoff. Its closed 23-asset
inventory, original updater root and curated immutable links pass 22 guards,
focused TypeScript and phone/wide actual/controlled views. Enabled links use
actual DMGs/direct Linux packages and cannot be replaced by legacy discovery.
Source/CI pointers follow the selected implementation; support recipients remain.
The real descriptor stays disabled/null. Final signed qualification, final production
publisher CI and public deployment remain separate gates; no external state changes.

Tactical [264](../tactical/264-hosted-website-dependency-qualification.md)
qualifies sibling hosted website commit `56dc2299` locally. Frozen Astro 7.3.6
build, eight hosted security/four migration cases, client typecheck/112 cases
and 18 responsive captures pass. Actual `/app` logo/phone header defects are
fixed. Version-scoped website advisories are zero; inherited module links,
other workspace importers and unrelated findings remain intact. Static-image
cache source-behavior limits remain explicit. No public deployment occurs.

Tactical [263](../tactical/263-finish-line-web-dependency-patches.md) updates
compatible web/website transitive dependencies after fresh npm advisories.
Web type/unit/build/CSP, 46 configured E2E cases (14 existing skips), 54 extension
cases, both byte-identical ZIP lanes and website static build pass. Fresh Cargo,
web and website reports pass strict release review with unchanged warning policy
and verified GLib provenance. Desktop notice generation passes. The cache
library's upstream max-stale behavior still reproduces in 4.3.0 despite registry
range clearance; exact Astro static-image call-path assessment and limits remain
explicit. Final signed desktop rebuilding/publication gates remain open.


Finish-line Tactical [259](../tactical/259-jstorrent-finish-line-checks.md)
owns the current source/artifact and installed gate execution, excluding iOS.
The `a35934d2` desktop capsule independently verifies 23 hashes, 15 updater
selections and ten original-root signatures; all five packaging legs pass.
Signed macOS ARM, Linux ARM and Linux x64 manual migration pass eight assertions;
current Linux x64 pixels render, while ARM black captures and the old x64 blank
window retain visual gaps. Tactical 261's exact fixed source passes 73 native
Linux tests and GNOME tray-name observation; final signed packages need a rebuild.
Original-key Android 1.0.26/code 26 is rebuilt at `37673687f15235840f3ac47ab044f2cd3e2f2445`
after Tactical 262's actual Network-status branding correction
with 121 passing JVM tests, lint and independent package validation. Fixed-source
physical B passes a full-hash 600-second detached background check. Full background
hours and broader physical/store gates remain open. Latest local checks pass
branding (2,036 display values / 40 assets), localization, extension tests/CSP/ZIP,
shared-web typecheck / 470 tests (two skipped), 46 browser E2E tests (14 skipped),
and website check/build. These use bundled Chromium and reap owned processes.
Authenticated Play remains production 23/internal 25/max uploaded 25. Explicit
internal upload and source push/nonpublishing candidate-build decisions are
pending. The prepared push also deploys the preview website update guide through
its existing workflow; production feeds/stores remain unchanged. No publication
has occurred. Native Windows x64 reaches its protected login route, but its stored
password fails verification; no product test starts. The guest is stopped and
claim released. Owned VMs remain off between ready checks.

Tactical [257](../tactical/257-play-upgrade-and-fresh-signed-candidates.md)
completes bounded current-source qualification at f5860c99: all ten executed
CI jobs and Website, signed JSTorrent desktop 0.3.0 on all five targets, all ten
original-root updater payload signatures and 23 independently matched receipt
hashes. Android 1.0.26/code 26 passes original upload signing and full package
validation, including the resolved JSTorrent label. The tactical links exact
receipts and a bounded actual Play 1.0.23-to-1.0.25 standalone migration.
Code 26 is not Play-uploaded or installed through Play; internal code 25 and
production code 23 remain. Fresh installed desktop, production extension,
broader SAF/lifecycle and product/soak gates stay open in the
[cutover checklist](../jstorrent-cutover-checklist.md).

Tactical [255](../tactical/255-android-play-internal-replacement.md) completes
the authorized Android internal Play release on 2026-10-04. The original upload
key matches Play and the retained public certificate; the existing CI inputs
are corrected. Local source `42a11817` produces validated 1.0.25/code 25 APK/AAB
with both ABIs, 116 passing release JVM tests and passing lint. Play reports the
replacement **Available to internal testers** on the existing `com.jstorrent.app`
property. Production remains 1.0.23. This supersedes the Android signing blocker
in the historical 251 account below; broader Play-installed cohorts and production cutover remain open. See the [artifact and publication receipt](../evidence/android-play-internal-255.json).

Tactical [254](../tactical/254-ci-candidate-and-pages-validation.md) repairs
the latest CI candidate-identity check for the isolated ChromeOS qualification
override and Pages assembly for the hashed JSTorrent PNG. All 63 affected
release/assembly tests, actual remote/website builds and local assembly pass
under Node 22.23.3. Debug isolation, production trust and immutable-asset guards
remain enforced. Hosted runs `36941113343`/`36941112964` remain failed until
new changes are pushed and rerun; no deployment or release gate is closed.

Tactical
[253](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
adds host-built isolated Android/extension artifacts and a native x86_64 Ubuntu
22.04 Crostini package. The exact unsigned package resolves dependencies and
passes controlled runtime byte/restart checks in cohort A's Debian 12
container. Android candidate-page pairing/recovery and byte-checked file intake
pass bounded slices. Both hosts finish controlled 60-minute byte-verified
observations and three recovery repetitions; owned test state is restored.
Normal Terminal startup restores Linux registration; the final offline connection
page and isolated current-package browser pass real file-picker intake and
source-offline completed-row/byte retention after VM restart. Current signed
installation/candidate Launcher, real fresh Play installation, store pairs,
cohort B and full lifecycle acceptance remain open. Native ARM64 retains its
separate release build lane. Nothing is published and no desktop cutover gate
is closed.

Tactical [251](../tactical/251-jstorrent-ci-candidates-and-installed-update.md)
completes bounded production-identity CI attempts using existing signing inputs,
with nonce identity proof, exact product receipts and retained-public-root
signature verification. Automatic incubation publication is paused; candidate
builds cannot publish. The successor update-service descriptor is prepared but
its live routing/feed is unchanged. Signed installed updating remains unqualified
until the exact candidate authenticates and an owned old-release guest passes.

Initial CI updater inputs are positively identified as the incubation key,
not JSTorrent's original key. Package attempts retain diagnostic evidence,
but cannot qualify old-app updating. The owned macOS 0.2.1 endpoint check
passes; production delivery rows remain open.
The Android retry passes signed APK/AAB construction, JVM tests and release lint,
then rejects the wrong original-APK certificate at staging. The first macOS
arm64 CI app independently passes original-team Developer ID signing,
notarization/stapling and Gatekeeper. Its updater signature is still wrong-root;
the manual installed handoff does not reach import before UI access ends.
Both Linux production package lanes pass the repaired source. Fresh macOS
notarization initially fails Apple's missing/expired agreement gate; the fresh
recheck below passes. Ordinary CI passes every executed job at 19eb3a88.
The Windows release lane also passes NSIS/MSI, expected-publisher and installed
signatures, silent installation and activation checks. Mac failures correctly
prevent complete collection; no production update or release is qualified.
The maintainer-supplied original key subsequently replaces the existing desktop
secret. Fresh nonce proof passes original-root verification with the unchanged
password. Run 36831643488 completes Windows/Linux package lanes and independent
verification passes all eight available original-key payload signatures and
16 receipt hashes. Attempt 1 fails Apple's agreement gate; complete-matrix
and installed gates remain open.

Fresh attempt 2 of run 36831643488 now passes both macOS jobs: Apple accepts
both apps and outer DMGs, with no DMG issues; signing, stapling and Gatekeeper
checks pass. The agreement error is no longer blocking CI. The collector refuses
the failed-only retry because it has only two current-attempt legs. Fresh complete
non-publishing run [36845370571](https://github.com/kzahel/rstorrent/actions/runs/36845370571) now passes at the same
source SHA: all five lanes, exact release collection and all ten original-root
updater payload signatures. See [Apple recheck evidence](../evidence/jstorrent-ci-candidate-251-apple-recheck.json). Complete candidate collection passes;
installed migration remains open. No production feed/store change is made.

Accepted
[252](../tactical/252-jstorrent-opt-in-upgrade-rehearsal.md) records a pinned,
opt-in installed trial.

Server commit `f45885c` implements the opt-in route and passes 86 tests plus
lint/typecheck/build. The maintainer authorizes its push and isolated deployment.
Twenty-seven live HTTPS checks preserve ordinary response bytes while selecting
the pinned candidate only for three generated test IDs. After qualification,
the private manifest/drop-in and owned assets are removed; 24 live HTTPS
response comparisons and five asset GET refusals prove normal routing restored. Exact signed CI packages
pass manual installed replacement on Linux x64, Windows x64 and macOS arm64:
four records from two profiles, supported settings, rechecking, startup fences,
registered legacy refusal, stable restart and source/payload preservation. See
[manual evidence](../evidence/jstorrent-upgrade-trial-252-manual-migration.json).
Original released HTTPS automatic upgrading passes on Linux x64 and macOS
arm64, including the migration/restart checks; Linux signature refusal and
interrupted-download retries also pass. macOS signature refusal preserves the
old executable hash and valid retry passes. macOS ordinary Check for Updates /
Install & Restart passes with the active legacy writer accounted for. See
[installed evidence](../evidence/jstorrent-upgrade-trial-252-installed.json).
Windows x64 automatic updating now passes the same installed migration/restart
oracles and eight registry refusal routes, with file/registry/firewall restoration.
Windows ordinary Check for Updates / Install & Restart also passes; a portable
source-snapshot path fix preserves the inactive-profile guard on Windows.
Expected-publisher Authenticode and original-path uninstaller continuity pass.
Windows signature refusal and interrupted-download retries also pass with the
exact old executable preserved. The one-ID trial is disabled; final ordinary
responses match, assets return 404 and the restored VM is off with claim released. The old Linux release
renders blank in this VM under three tested configurations, leaving its ordinary
UI path open. Controlled repair and real extension journeys remain open. Native catalog branding is corrected after
the candidate source and needs a fresh signed build.

The October 1 monthly rebuild of the unchanged upstream AppImage output plugin
invalidated its byte pins. Tactical 251 reviews the source/build provenance and
updates both architecture digests; hash refusal and final attribution checks
remain enforced. Both hosted native package lanes pass the repaired source.

## JSTorrent Production Candidates, 2026-10-01

Tactical [250](../tactical/250-jstorrent-production-identity-candidates.md)
prepares explicit JSTorrent desktop and extension candidate lanes while retaining
the incubation configurations. Android release now targets the existing
`com.jstorrent.app` app, code 25, and requires original-key secrets under
the existing `ANDROID_UPLOAD_*` names after Tactical 251's one-product
simplification; the separate canary certificate is retained only
as historical evidence. Earlier canary setup/publication records below do not
qualify this new production lane. No private secret provisioning or release
operation has run. [The cutover checklist](../jstorrent-cutover-checklist.md)
owns production graduation and installed delivery evidence.

Tactical [240](../tactical/240-signed-desktop-control-qualification.md) completes
signed current-source delivery with [Latest 0.2.801](../evidence/desktop-latest-v0.2.801.md).
Exact-source CI, five signed package lanes, public signatures/checksums and both
macOS notarized/stapled DMGs pass. Claimed macOS arm64 and Windows/Linux x64
installations pass native 701-to-801 updating, signed/registered helper checks,
background control, shared views, fresh browser-closed verified transfers,
picker cleanup, explicit/passive relaunch and bounded registration repair.
The Mac also installs the exact public DMG and recreates its bundled host.
Physical sleep/wake, interrupted updates, broader endurance, Intel/minimum-macOS
installed coverage and production graduation remain open. No importer has started.

Preflight corrects stale package/cancellation harness expectations, the macOS
CFT discovery path and the transitive Undici advisory. Fresh release audits and
exact-source main CI pass without changing the reviewed GLib warning policy.
Independent 701 testing finds the app notarized but its outer DMG only signed;
801 adds explicit DMG notarization, stapling and Gatekeeper open assessment
before final artifact hashes. Historical notarization evidence below concerns
the app bundle unless explicitly stated otherwise. Published assets remain
immutable; Stable, product identities and signing/update keys are unchanged.

Tactical [238](../tactical/238-signed-desktop-channel-recovery.md) now passes
installed signed 0.2.301 → 0.2.501 selection/replacement/relaunch on macOS arm64
and Windows/Linux x86_64. Native Stable selection retains Latest and reports
waiting for Stable to catch up; controlled roots and external sentinel bytes survive.
Linux passes on the explicitly recreated guest with verified registry-located
credentials. The selected published source predates desktop extension control,
so that tactical does not qualify current-source delivery; 240 supplies that
evidence. Interrupted replacement remains unqualified. 237 separately completes
selected macOS/Windows beta package repair/rollback, with exact inherited-state
cleanup.

Tactical [`237`](../tactical/237-macos-windows-package-recovery.md) updates
release source guards for the platform singleton factory and macOS Opened
handoff introduced by 234/235. All 21 release/package/input tests and checked
source validation pass; ordering, missing singleton and dropped OS-input
negative fixtures remain enforced. Installed package/update evidence is tracked
separately in that tactical.

Desktop channel publication checkpoint (2026-09-27): Tactical
[`230`](../tactical/230-desktop-stable-latest-update-channels.md) adds a
Stable/Latest product registry, native-owned selection and candidate lifecycle,
React choice, and verified-source nightly release path using the existing
signed five-target workflow. Remy's product-owned descriptor advertises both
channels. The first signed Latest prerelease
[`desktop-latest-v0.2.301`](../evidence/desktop-latest-v0.2.301.md) passed
exact-source main CI, source/build/finalizer gates, and all five production
updater routes. The parallel release pipeline then published
[`desktop-latest-v0.2.401`](../evidence/desktop-parallel-release-2026-09-27.md)
after five overlapping signed builds and one collector. At that checkpoint Latest resolved
`0.2.401`; Stable remained `0.1.4` for explicit and old channel-less requests.
238 records the September 29 live 0.2.501 offer and macOS/Windows/Linux
installed selection, replacement/relaunch and return-to-Stable evidence.

Maintenance checkpoint (2026-09-26): Tactical
[`219`](../tactical/219-dependency-and-ci-maintenance.md) repairs the newly
reported rustls advisory and seven website npm package findings locally,
extends weekly and tagged-release review to the website lockfile, and prepares
bounded weekly dependency-update PRs. Exact local Cargo/web/website review
reports zero vulnerabilities and retains all seven reviewed GLib/unmaintained
warnings. The two September 16/23 scheduled advisory failures preceded this
repair. Hosted website deployment and three-lockfile advisory review pass at
`62fc537a`, and GitHub Dependabot alerts/security updates are enabled.
GitHub shows one medium GLib 0.18.5 alert because its version-based view
cannot verify the locally patched source qualified in Tactical `218`; the
alert remains visible. Routine update PRs await separate review; the broad
patch groups were closed and future proposals use one dependency per PR.
Four first-scan major-version PRs were closed. Main CI `36235256275` passes
all ten required jobs at `39b4a127`; the website, advisory, and storage
workflow runs also pass.
The September 22 storage checkpoint run failed its
post-commit upload expectation. Five local repeats and fresh hosted full
verification run `36231952351` pass; the isolated failure remains unexplained
and the strict assertion retains better state counts for the next recurrence.
The exact-source storage matrix `36232442627` also passes.
The first source run `36232402842` then exposed a separate gateway test race:
an unthrottled view-set update returned 200 before shutdown closed the poll.
Tactical `219` makes that test's delivery interval longer than its poll wait;
20 focused local repetitions and the complete gateway suite pass. The
next hosted run found a stale GLib backport test call after the website audit
argument was added. Its test fixture now supplies all three reports; local
backport, distribution and desktop release-tool tests pass. The corrected
release-tools job and all other jobs pass in main CI run `36235256275`.
The later ungrouped-Dependabot configuration run `36238069794` passed nine
jobs and found a separate automatic listener test assumption: another process
claimed the probed preferred port, so the valid successor port failed an
exact-port assertion. The test now checks the actual coordinated TCP/UDP pair,
DHT source, and TCP acceptance. Its focused case passes 20 local repetitions
and the full session library passes 346 tests; exact-source hosted
qualification passes all ten jobs in main CI run `36239731206` at
`e1536fa8`.

Tactical [`218`](../tactical/218-glib-variant-iterator-backport.md) adopts and
qualifies the explicitly approved two-line GLib 0.18.5 backport. Exact source
and patch inventories, original MIT attribution, optimized native Linux
x86_64/ARM64 tests and packaged notice gates pass. The exact ARM64 AppImage
also passes native picker Cancel/selection, visible GNOME indicator,
background/Show, joined Quit and default-root/payload persistence. Only this
dependency blocker is cleared. Audit review retains all seven original
warnings, checks the backport independently and preserves future GLib advisory
detection through an audit-only registry projection. Corrected-source CI
run `34693467376` passes all 12 jobs at
`e535a5ffeb6cc9885a5e8f47196890d386960e35`. The subsequent policy-only closure
passes strict local review with source/audit inputs matching hosted evidence.

The full hosted result includes four unsigned desktop package lanes,
Windows native installation, owned Android runtime, iOS, web, Rust,
dependency review and extended storage recovery. CI-004 and CI-006 remain
closed. [Exact hosted evidence and remaining release gates](../evidence/release-readiness-ci-2026-09-12.md).

Completed local and hosted Tactical
[`217`](../tactical/217-android-distribution-attribution.md) builds and verifies
Android notice assets: 83 debug / 79 release Maven artifacts, 205 Rust
packages and all six native libraries. Original grants,
parent POMs, embedded notices and checksum-bound native supplements are
preserved. APK inspection caught and now passes a generated-assets directory
repair. JVM tests, lint, negative package checks and release asset generation
pass. The hosted APK has a byte-identical notice manifest and passes the
owned API 35 runtime cohort with 3/40 storage handles and full cleanup.
No Android release was signed.

Completed local and hosted Tactical
[`216`](../tactical/216-local-support-diagnostics-and-release-baseline.md)
adds the previewed, bounded local support export and public issue/guidance
links in desktop/shared-browser About. Hostile input, exact clipboard/download,
phone/wide light/dark accessibility and full web gates pass. The
[baseline proposal](../release-baseline.md) prepares the support decision and
compatibility matrix without selecting a version. REL-005, hosted Tactical
208 disclosure qualification, repaired signed-candidate qualification and publication remain
open; no automatic upload or context-transmission gate was enabled.

Tactical [`214`](../tactical/214-release-dependency-and-artifact-review.md)
repairs compatible web advisories and the yanked ChaCha dependency, adds an
expiring exact-warning review, generates attributable notices for all five
desktop targets, and validates a real macOS notice bundle. Package CI now
inspects embedded notices and bounded artifact contents. QA-005 remains open:
native platform notice coverage and source-delivery review need closure.
Tactical 218 resolves the GLib source-maintenance decision and qualifies its
approved backport.
The native follow-through now adds a project-local AppImage output hook,
exact distro package/source attribution, original copyright/common-license
texts and final-artifact manifest verification. Run `34687692788` passes all 12 jobs at
`a83de080d27adb80932a03c972db96d026c91520`; exact extracted AppImages verify
174 components / 113 distro packages / 128 notice files on x86_64 and
173 / 112 / 127 on ARM64. Launcher/runtime and corresponding-source obligations remain explicit
review items; Tactical 217 owns Android Maven/AAR attribution. Tagged
publication continues to enforce fresh advisory and source review. These are
explicit release findings, not a zero-issues claim from the audit exit code.

Current checkpoint (2026-09-26): public signed desktop `0.1.4` passed its
source, five package, and publication jobs. All five production routes offer
signed `0.1.4` metadata to `0.1.1` apps. Native Windows 11 x86_64
fresh-default `0.1.1` NSIS updated through the app's production route,
automatically reset and relaunched into exact build `691143b6db1c`, retained
expected Authenticode trust, and left an unrelated pre-update Documents
sentinel unchanged. The old folder picker could not select that sentinel as
a root, so selected-root preservation remains unproved by this run. The
common installed cohort, macOS arm64/Linux arm64 pre-update payload checks,
native notice/source-delivery clearance, and first supported persistence
baseline remain open. See [the exact package and acceptance record](../evidence/desktop-v0.1.4.md).

Earlier checkpoint (2026-09-12): public desktop `0.1.3` supersedes the
historical `0.1.2` checkpoint below. Exact native x86_64 installed acceptance
proves the Linux `0.1.1` → `0.1.3` update, native picker, retained default root,
joined Quit and payload-preserving removal. GNOME's inactive indicator leaves
visible tray presentation unproved. Windows signed replacement succeeds but
old-profile reset exits with error 5; Tactical `215` repairs current source
and passes 345 native session and 43 native desktop tests. Fresh signed
`0.1.3` startup, native picker and root relaunch pass after an explicit private
profile reset. Windows firewall Cancel produces only scoped inbound Public
block rules. A repaired signed automatic update remains a release gate.
See [the exact package and acceptance record](../evidence/desktop-v0.1.1-to-v0.1.3-x86_64.md).
The older campaign narrative below is historical where this checkpoint
supersedes its package versions or open platform evidence.

Work-selection policy: release tacticals may be active alongside unrelated
engine, client, platform, or product tacticals. **Active**, **Ready**, and
**Later** are planning states rather than a lock or required sequence. The
historical yield/resume/**Now** narrative below records past prioritization
only; it does not require future work to displace Tactical `158` or any other
active slice.

Status: **Active as of 2026-08-27.** RSTorrent desktop `0.1.0` is the first
public signed incubation release and `0.1.1` is its first updater-validation
release. Public `0.1.2` is the first signed candidate carrying the completed
desktop repairs and native bootstrap. Public ChromeOS Linux preview
`crostini-v0.1.0` now passes native x86_64/ARM64 builds, independent signed
asset validation, and exact website install/Launcher/relaunch evidence on the
physical x86_64 Chromebook; Android and iOS remain unreleased alpha lanes.
Credential-free cross-platform presubmit CI, a credentialed
five-target signed
desktop rehearsal, three tagged publications, production updater metadata, one
installed macOS arm64 launch smoke, and exact macOS arm64 and Linux arm64
`0.1.0`-to-`0.1.1` updates pass. Windows x86_64 replacement/relaunch also
passes under an automatic-loopback profile. Fresh default startup is blocked
in public `0.1.0` and `0.1.1` by local-network address selection; completed
Tactical `160` repairs that defect, and public `0.1.2` now contains the repair.
Completed Tactical `161` adds the native parented picker, makes the packaged
Linux picker self-contained, and
passes an installed unsigned Windows fresh-profile choose/cancel/repair/
restart campaign. The clean installed `0.1.1`-to-`0.1.2` update and Linux
x86_64 installed evidence remain open. First launch of the unsigned Windows
listener also exposed a Windows Security consent prompt that the signed
`0.1.2` installed campaign must characterize and document. Completed Tactical
`162` adds single-instance, default-on close-to-tray, persisted background
policy, visible manual updating, joined Quit/restart, native Linux arm64
packaging, and installed Windows x86_64/Linux arm64 lifecycle evidence.
Completed Tactical `164` adds desktop completion and attention notifications with
installed macOS arm64, Windows x86_64, and Linux arm64 evidence. Completed
Tactical `165` adds default-on desktop/Android active-work sleep inhibition,
removes Android's Wi-Fi lock, preserves truthful iOS finite-background policy,
and passes guest-native installed macOS arm64, Windows arm64, Linux arm64,
physical Android API 37, and physical iOS evidence. Explicit maintainer
direction temporarily yielded Tactical `158` to bounded desktop-bootstrap
Tactical `166`. That slice is complete after its exact-ID installed Chrome
`hello` and cold-launch smoke, and Tactical `158` remains active. Explicit
maintainer direction later on 2026-08-26 temporarily yields
that work to bounded ChromeOS Linux Tactical
[`167`](../tactical/167-chromeos-crostini-bundled-web-launcher.md). This is a
source-package and physical-device incubation slice, not a new public beta
lane or signed release. That slice is complete after the available physical
Chromebook lifecycle, detachable-transfer, preservation, and purge matrix;
the conditional full reboot was unavailable because the testbed has no
approved profile-login credential. Tactical `158` remains active.
Installed Intel macOS testing is deliberately omitted. The public product
name is RSTorrent for the foreseeable release line. A later production
graduation is expected to retain JSTorrent's existing name, application
identity, and updater trust root, with best-effort legacy-state migration
scoped separately. It is not a beta requirement. This topic is the
authoritative beta gap ledger and release checklist. Tactical
[`157`](../tactical/157-beta-release-foundation.md) completed the first cleanup
slice, cross-platform presubmit Tactical
[`159`](../tactical/159-cross-platform-presubmit-ci.md) is complete, and
bounded Windows listener repair Tactical
[`160`](../tactical/160-windows-local-network-address-selection.md) is
complete. Packaged desktop picker Tactical
[`161`](../tactical/161-packaged-desktop-folder-picker.md) is complete;
desktop lifecycle Tactical
[`162`](../tactical/162-desktop-single-instance-and-tray-lifecycle.md) is
complete; desktop-bootstrap Tactical
[`166`](../tactical/166-desktop-native-bootstrap-and-extension-scaffold.md) is
complete; signed release Tactical
[`158`](../tactical/158-desktop-signed-packaging-and-updater.md) retains its
open gates and remains active; Crostini Tactical `167` and
configured Linux headless-service Tactical `170` are complete.
Explicit maintainer direction temporarily yields Tactical `158` once more to
bounded platform-aware extension popup Tactical
[`168`](../tactical/168-platform-aware-extension-launcher.md). This polish adds
no release lane, permission, Android detection, or application-control scope;
its deterministic package and physical ChromeOS chooser/link/handoff spot
check pass. Tactical `158` remains active.
Explicit maintainer direction temporarily yields Tactical `158` to hosted
Crostini bootstrap/release Tactical
[`169`](../tactical/169-hosted-crostini-bootstrap-and-release.md). This is
non-publishing source plumbing and physical fixture validation; it does not
create a public ChromeOS Linux release or expand the beta lane. That slice is
complete after its deterministic and physical signed-fixture real-package
matrix. A subsequent explicitly authorized operation published non-latest
`crostini-v0.1.0`, deployed the website bootstrap, and passed exact public
x86_64 acceptance; Tactical `158` remains active.
Explicit maintainer direction on 2026-08-26 temporarily yielded Tactical `158`
to configured Linux headless-service Tactical
[`170`](../tactical/170-configured-linux-headless-service.md). Tactical `170`
is complete with deterministic source/package gates, isolated HTTPS/WSS proxy
evidence, and a real x86_64 Linux service/transfer/preservation campaign. It
creates no public release lane and does not absorb the owner remote-
authentication or relay campaign. Tactical `158` remains active with
its remaining signed Windows and Linux x86_64 acceptance gates unchanged.
Explicit maintainer direction later on 2026-08-26 temporarily yielded Tactical
`158` to signed headless release and trusted-LAN service Tactical
[`171`](../tactical/171-signed-headless-release-and-lan-service.md). It owns
the completed source-only signed distribution/update plumbing, one exact RFC 1918
unauthenticated full-owner mode, truthful browser presentation, and an
enabled healthy current-host service campaign. Public release/channel
deployment, unattended updating, system-wide ownership, firewall changes, and
Raspberry Pi mutation remain outside the slice. Tactical `158` remains active
with its open gates unchanged.
Maintainer direction on 2026-08-24 promotes OS-level `magnet:` and local
`.torrent` activation from a post-beta deferral to a beta usability gap;
completed Tactical
[`163`](../tactical/163-desktop-external-torrent-intake.md) closes that gap.
Installed Linux arm64, Windows x86_64-application, macOS arm64, and exact
hosted eight-job acceptance pass; the Windows package ran under Windows 11
arm64 x64 emulation, and the macOS campaign preserved JSTorrent's inherited
default handler. Maintainer direction on 2026-08-25 makes basic native desktop
completion and fatal/repair notifications a beta usability requirement;
completed Tactical
[`164`](../tactical/164-desktop-completion-and-attention-notifications.md)
closes that gap. Explicit maintainer direction on the same date makes active-
download sleep inhibition the next beta usability slice; Tactical `165` owns
desktop and Android settings/behavior plus iOS inapplicability before
returning signed-package ownership to Tactical `158`. That slice is complete.

Explicit maintainer direction on 2026-08-27 declares all `0.1.x` packages and
current platform previews unsupported incubation builds with disposable
application-owned state and contracts. They remain valid package, signing,
updater, and product-behavior fixtures, but they are not a persistence or
rollback baseline. A future version must be explicitly declared the first
supported beta or release before compatibility obligations begin; `0.2.0` is
only a possible version, not a selected one.
Explicit user direction immediately activated disposable-incubation state
Tactical [`179`](../tactical/179-disposable-incubation-state-epoch.md). It is
complete with a fresh schema-21 catalog and removal of compatibility-only
state readers while retaining bounded reset and external-payload safety.
Tactical `176` is also complete after its Xcode 26.6 simulator and unsigned
device-archive gates passed on 2026-08-29. Signed release Tactical `158`
remains active.
Explicit maintainer direction on 2026-08-30 activates focused ChromeOS Android
extension-control Tactical
[`194`](../tactical/194-chromeos-android-extension-control.md) alongside
Tactical `158`. It is the first migration-critical JSTorrent Android parity
slice: Android retains the only Rust engine/profile owner and the extension is
a detachable shared React client. It includes Android's
extension-triggered SAF picker and retained-root semantics so changing the
current root for new downloads does not discard grants used by older torrents.
It does not authorize store publication or turn other missing Android features
into implicit scope.
Completed Tactical
[`197`](../tactical/197-android-external-torrent-intake.md) now closes the
independent Android beta usability gap for external `magnet:` and local
`.torrent` activation. Exact manifest/runtime filters, generic confirmation,
the shared root/start/add flow, hostile-provider bounds, connected API 34
instrumentation, controlled transfer, privacy, temporary-grant revocation,
and cleanup pass. This does not select the production JSTorrent identity,
publish a store artifact, or close notification/network/lifecycle gates.

Explicit user direction on 2026-09-01 accepts JSTorrent-shaped installation
metrics, feedback context, and extension-uninstall survey behavior in
implementation-complete
Tactical
[`208`](../tactical/208-installation-metrics-and-feedback-parity.md). The
capability is not retroactively a blocker for an incubation package, but any
build that enables its richer feedback/uninstall queries must first satisfy
the exact disclosure, privacy, disable/reset, and hosted-recipient gates below.

## Scope And Release Definition

This topic answers whether a build is ready to be handed to people outside the
development team. It owns:

- the beta product boundary and deliberately deferred features;
- platform packaging, signing, installation, update, rollback, and uninstall
  readiness;
- presubmit, scheduled, release, and post-release validation gates;
- product identity, version, migration, privacy, support, licensing, and
  release-note gates; and
- the statused backlog of bounded tacticals needed to reach beta.

[`capability-readiness.md`](capability-readiness.md) remains the detailed
engine and application capability scoreboard and owns non-exclusive active and
ready work sets.
[`protocol-support.md`](protocol-support.md) owns exact BitTorrent protocol
claims. Platform and UI truth remains in
[`client-surfaces.md`](client-surfaces.md). This topic classifies those facts
for release rather than duplicating their design.

**Supported beta** means a versioned, signed build explicitly declared for
external testers with a documented supported platform and compatibility
boundary. Public availability, a local debug APK, unsigned Apple archive,
`tauri dev` window, website build, or headless web host does not make an
incubation build a supported beta.

Beta is a program with independent lanes. Desktop beta is not blocked on App
Store review, and mobile beta is not implied by a desktop tag:

| Lane | Intended beta channel | Current release state |
| --- | --- | --- |
| macOS desktop | signed/notarized DMG plus in-app updates | public `0.1.2` Developer ID-signed, notarized, and stapled app/DMG packages pass for arm64 and x86_64; its exact public arm64 DMG launches and repairs native-host registration in a bounded spot check; exact arm64 `0.1.0`-to-`0.1.1` replacement/relaunch and 238's fresh-profile signed `0.2.301`-to-`0.2.501` update/Stable catch-up pass; Intel installed testing remains omitted |
| Windows desktop | signed per-user NSIS plus in-app updates | public `0.1.2` NSIS and MSI packages contain the completed desktop repairs and have valid expected-publisher Authenticode signatures plus installed activation-registry validation; public per-user NSIS `0.1.0`-to-`0.1.1` replacement/relaunch passes under an automatic-loopback profile; 238 additionally passes fresh-profile signed x86_64 `0.2.301`-to-`0.2.501` updating and Stable catch-up |
| Linux desktop | AppImage plus in-app updates; DEB/RPM remain package-manager channels | public `0.1.2` AppImage, DEB, and RPM packages plus updater artifacts pass for x86_64 and arm64, including extracted activation metadata; exact arm64 AppImage `0.1.0`-to-`0.1.1` replacement/relaunch and the installed lifecycle/icon campaign pass; 238 adds fresh-profile signed x86_64 `0.2.301`-to-`0.2.501` update/relaunch and Stable catch-up |
| Linux headless | signed non-latest `headless-v*` GitHub Release plus pinned website bootstrap and explicit CLI apply | strict native x86_64/ARM64 workflow, signed manifest/bootstrap/check/apply source gates, and an exact enabled x86_64 trusted-LAN install pass; no public candidate or stable manifest is promoted, and native ARM64 install/update evidence is absent |
| Android, including ChromeOS | signed Android App Bundle through a closed testing channel | maintained Compose/in-process Rust/SAF app and hosted dual-ABI debug/test APK gates pass; release identity, signed AAB, emulator/store, and upgrade evidence absent |
| ChromeOS Linux | signed non-latest `crostini-v*` GitHub Release selected by the pinned website bootstrap | public `crostini-v0.1.0`, the deployed pinned bootstrap, production-key manifest, native x86_64/ARM64 packages, independent exact-asset validation, and physical x86_64 website install/Launcher/relaunch pass; physical native ARM64, full reboot, suspend, and installed update/rollback evidence remain absent |
| iOS/iPadOS | signed TestFlight build | maintained SwiftUI app plus hosted simulator tests and unsigned device archive pass; distribution identity, signing, TestFlight, and upgrade evidence absent |

The first external lane may ship when its own blockers and the shared product
blockers pass. Unsupported lanes must remain labelled development preview; the
project must not imply simultaneous availability.

## Release Policy

Checklist meanings are exact:

- `[x]` means repository evidence currently satisfies the stated gate.
- `[ ]` means open. Text after the item records whether it blocks every beta,
  one platform lane, or only a broader promise.
- A gate closes from recorded commands, artifacts, or testbed evidence, not
  from the presence of configuration or a code path.

A release candidate is cut from one reviewed commit. Versions are stable
three-component semantic versions. The application, package metadata,
changelog, tag, installer metadata, and updater response must agree. A tagged
workflow may create a draft release, but only a final validation job may make
it public. Tags, publication, store submission, and production-route changes
remain explicit maintainer actions.

Tactical [345](../tactical/345-supported-catalog-migrations.md) (2026-10-14)
ends automatic resets: shipped application state is migrated forward, never
reset or replaced, and only the user's Clear app data discards it. Schema 26,
shipped by every public release, is the supported session-catalog baseline;
pre-baseline incubation catalogs and future, malformed, ambiguous or busy state
fail closed unchanged. Current application identifiers, updater keys, and
routes remain operational values, not a promise that an older incubation
installation remains supported.

The first version explicitly declared the supported beta or release freezes
its fresh application identifiers, updater trust, route, and persistence/API
baseline from that point forward. It has no migration obligation to any
earlier incubation build. Later supported versions must follow the
compatibility and rollback policy declared with that baseline.

## Shared Beta Blockers

### Product identity and release contract

- [x] **REL-001 — Freeze the beta name and publisher identity.** Maintainer
  direction on 2026-08-22 selects RSTorrent as the public product identity for
  the foreseeable release line, beginning with an incubation beta. RSTorrent
  remains independent from current JSTorrent installations. Maintainer
  direction on 2026-08-23 records
  the general later goal: graduate the proven implementation through a normal
  JSTorrent update retaining JSTorrent branding, `com.jstorrent.desktop`, and
  its existing updater trust root. Exact timing and best-effort state migration
  are later scope; released RSTorrent routes and apps do not silently change
  identity.
- [ ] **REL-002 — Freeze application identifiers.** Desktop currently uses
  the accepted operational `com.jstorrent.rstorrent`, and release validation
  rejects accidental drift.
  Android still uses the unreleased `org.rstorrent.bootstrap`, and iOS uses
  `org.rstorrent.ios.dev`. Incubation apps do not inherit an existing
  JSTorrent application/store identity, and no `0.1.x` value constrains the
  future supported release. The shared gate remains open for those mobile
  lanes and for explicit reconfirmation at each lane's support boundary.
- [ ] **REL-003 — Establish one release version source and bump procedure.**
  Desktop web, Cargo, and Tauri metadata currently agree at `0.1.2`; Android
  and iOS use independent provisional values. Release validation must reject
  drift for the lane being shipped.
- [x] **REL-004 — Add a changelog and release-note policy.** `CHANGELOG.md` and
  the desktop release runbook require supported behavior, known limitations,
  data reset/migration, and security/privacy changes for each release.
- [ ] **REL-005 — Declare the first supported persistence baseline.**
  Session catalog: done by Tactical 345, which declares schema 26 the
  supported baseline, removes automatic reset, adds the forward migration
  runner and released-catalog fixtures, and leaves downgrade unsupported.
  Remaining: the other application-owned formats in the
  [candidate inventory](../release-baseline.md) and the audit follow-ups
  recorded in Tactical 345.
- [ ] **REL-006 — Define support, privacy, and legal presentation.** Ship
  license/notices, a privacy statement for network behavior and any update
  installation ID, support/report instructions, and a safe diagnostics export
  with user-visible contents. If Tactical `208` is enabled, the statement and
  in-product disclosure must additionally name the pseudonymous identifier,
  exact coarse statistics and recipients, query-string exposure, default-on
  choice, one-report override, durable disable, and reset behavior. The hosted
  feedback/uninstall pages must no longer claim that no usage data is
  collected. Tactical `208` now supplies the in-product disclosure, controls,
  exact preview, and corrected hosted source. REL-006 remains open because the
  source has not been deployed or publicly verified and the richer-context
  release gates deliberately remain off. A public check on 2026-09-26 still
  finds the linked [privacy page](https://jstorrent.com/privacy.html) claiming
  no analytics or usage-data transmission, while the `0.1.4` app presents a
  default-on pseudonymous-statistics choice. Reconcile the hosted statement
  and verify the live recipient pages before inviting outside testers.

### CI and repository health

Tactical [304](../tactical/304-fast-pr-feedback-and-ci-benchmarks.md) separates
early PR feedback from full qualification using only standard free hosted
runners. `Fast CI` lints affected portable crates and dependents, tests changed
libraries, restores the ordinary CI cache, and exposes **Fast PR feedback**
check. Its successful PR runs can trigger the isolated agent reviewer before
full CI finishes; failed/cancelled fast runs cannot. The 3--5 minute warm-run
duration remains a target: the initial broad, cache-miss hosted qualification
passes in 14m02s, and the parallel-contract layout passes in 14m23s. The contract
now runs alongside unit execution; compiler variation offsets that scheduling
saving in this pair. PR 26 subsequently passes full qualification and merges.
The first focused warm-dependency probe passes 603 engine tests with a 4m01s
Rust job, but takes 9m34s overall, including 4m55s waiting for its Rust runner.
The disposable probe's full matrix is cancelled to isolate build latency; this
does not establish ordinary 3--5 minute end-to-end feedback. Automatic review
is enabled and its first exact-head Fast CI trigger publishes a successful
review, including offline focused Rust tests, in 6m03s. Trusted-main reviewer
cache warming compiles locked workspace tests in 23m05s and saves a 2.25 GB
cache. The focused repeat passes Fast CI in 4m00s with another dependency-cache
hit and 603 passing tests. Its redundant full/performance runs are cancelled
early; the initial queueing result remains relevant to ordinary concurrency.
The second automatic review restores the reviewer cache in 37s and publishes
against the exact repeat head in 7m21s; this verifies reuse without demonstrating
a review-duration improvement. Existing
qualification jobs, platform evidence, release gates and branch-protection
policy are preserved. Queue contention and reviewer format/lint tooling are
bounded follow-ups recorded in the owning topics.

Tactical [`211`](../tactical/211-presubmit-signal-and-build-measurements.md)
repairs the companion FormatJS diagnostic-link rejection and two test-owned
completion/recheck seed-reconciliation waits. Ten ordinary jobs keep extension
packaging and release-tool checks independent of web contract/type/unit/E2E
coverage. Manual CI additionally calls the scheduled storage-recovery and
advisory workflows at the same source revision. Run `34684328524` passes all
12 jobs: 1,504 workspace tests, 386 web unit tests, 43 browser tests, native
platform/package checks, Android runtime, iOS and controlled recovery. Existing
opt-in skips remain explicit in the evidence. Compilation and execution have
separate timings and seven-day artifacts; the measured compilation cost does
not justify changing profiles or cache policy without a controlled comparison.
The qualification branch avoids the automatic public website deployment
attached to `main` pushes. See the
[exact run record](../evidence/release-readiness-ci-2026-09-12.md).

- [x] **CI-001 — Add ordinary presubmit CI.** Required checks run Rust
  formatting, workspace clippy with warnings denied, workspace tests,
  generated-contract drift, web typecheck/unit/build, and workflow/config
  checks. Hosted `main` run
  [`32627431920`](https://github.com/kzahel/rstorrent/actions/runs/32627431920)
  proves the credential-free runner and read-only permissions contract across
  all seven Rust/interop, web/E2E, desktop, Android, and iOS jobs.
- [x] **CI-002 — Add shared-web end-to-end coverage.** Run the deterministic
  Playwright suite in CI, retain failure traces/screenshots, and keep public-
  swarm cases opt-in rather than required. The locked Chromium job passes 33
  deterministic tests with 12 live cases skipped locally and on the hosted
  `main` run; failures retain bounded traces/screenshots.
- [x] **CI-003 — Add a desktop OS matrix.** Compile and package on macOS arm64
  and x86_64, Windows x86_64, and Linux x86_64; add Linux arm64 when a native
  runner or deliberate cross-build path exists. A compile-only matrix does not
  satisfy installer or update evidence. Hosted ordinary run
  [`32627431920`](https://github.com/kzahel/rstorrent/actions/runs/32627431920)
  passes the credential-free package floor. Signed rehearsal
  [`32627436936`](https://github.com/kzahel/rstorrent/actions/runs/32627436936)
  passes both macOS architectures, both native Linux architectures, and
  Windows x86_64 with the complete intended package matrix. Clean install and
  installed update evidence remain separately open under `QA-003` and
  `UPD-005`.
- [x] **CI-004 — Add Android gates.** Build both Rust ABIs, lint, unit test,
  assemble a release bundle, and run a bounded owned-emulator product smoke.
  Physical-device and ChromeOS evidence remains a release-candidate campaign,
  not an unattended presubmit mutation. Hosted presubmit now passes both Rust
  ABIs, generated Kotlin, lint/JVM tests, debug app APK, and instrumentation
  APK compilation. Tactical 210's signed canary AAB passes. Completed
  Tactical [`213`](../tactical/213-owned-android-runtime-ci.md) now runs the
  real SAF selection/restart/recheck/removal cohort on a uniquely owned API 35
  phone emulator and adds its bounded seven-day report to presubmit. Two
  ARM64 runs pass after fixing clipped confirmation controls and harness
  picker handoff. Hosted x86_64 runs `34682523287` and `34684328524` pass
  the real API 35 cohort with exact removal, 3/40 storage-handle high water
  and owned-AVD cleanup; see the [exact evidence](../evidence/release-readiness-ci-2026-09-12.md).
- [x] **CI-005 — Add iOS gates.** Generate bindings/project, build the device
  Rust library, run simulator unit/UI tests, and create an unsigned release
  archive on a pinned macOS/Xcode runner. Signed TestFlight work remains a
  protected release job. The exact Xcode 26.6 hosted Apple leg passes generated
  drift, 25 unit tests, 2 UI tests, and the unsigned device archive.
- [x] **CI-006 — Add a bounded controlled interoperability smoke.** Choose a
  short v1 magnet/torrent intake, transfer, verified direct content, restart, and seeding
  path against pinned libtorrent. Keep the long matrix and public catalog out
  of ordinary PR latency. The hosted presubmit passes Tactical `159`'s locked
  exact first-piece transfer and cleanup as the initial floor. Completed Tactical
  [`212`](../tactical/212-application-lifecycle-verification-gate.md) adds a
  hosted single/multifile application cohort with byte intake,
  complete hashes, source-offline restart/seeding, paused corruption checking,
  exact repair, keep-data removal, resource bounds, and joined cleanup. It
  also repairs Resume failing to restore a missing download-queue position
  after a paused seed recheck. Run `34682523287` passes the ordinary two-case
  presubmit and the four-case extended cohort. Both that run and corrected
  run `34684328524` pass the broader topology/checkpoint matrix and
  oversized restart/seeding cohort
  after repairing repeated checking with an exact verified-extent handoff.
  The bounded weekly workflow is also callable by manual CI; both hosted
  executions pass all three topology and three checkpoint crash cases.
- [x] **CI-007 — Repair scheduled performance CI.** The 2026-08-10 and
  2026-08-17 runs failed before tests because `astral-sh/setup-uv@v8` could not
  be resolved. The workflow now pins reviewed `setup-uv` `v8.3.2`; manual
  hosted run
  [`32568169955`](https://github.com/kzahel/rstorrent/actions/runs/32568169955)
  passes both smoke profiles and retains JSON artifact
  `performance-32568169955-1`. Scheduled full run
  [`34099890487`](https://github.com/kzahel/rstorrent/actions/runs/34099890487)
  passed on 2026-09-07 at `9c6c00b`; its event and full-job conclusion were
  independently checked on 2026-09-12, closing the weekly-run gate.
- [x] **CI-008 — Decide release branch protection policy.** Maintainer
  direction on 2026-08-23 deliberately keeps direct `main` work available and
  does not make branch protection an incubation-beta gate. Tagged publication
  remains fail-closed behind source checks, all release legs, and the sole
  finalizer.

### Product smoke and quality floor

- [x] **QA-001 — Core deterministic and local product suites pass.** On
  2026-08-23, Rust format/clippy/workspace tests, web typecheck and 262 passing
  unit tests with 2 skips, the production web build/CSP check, 33 deterministic
  Playwright tests with 12 live tests skipped, release-tool tests, and an
  optimized macOS app passed locally. Hosted run
  [`32627431920`](https://github.com/kzahel/rstorrent/actions/runs/32627431920)
  additionally passes the full seven-job Rust/interop, web/E2E, desktop,
  Android dual-ABI/lint/test, and iOS simulator/archive matrix.
- [ ] **QA-002 — Record a repeatable beta torrent cohort.** Cover small and
  large single/multifile v1 torrents, magnets and `.torrent` files, public and
  controlled discovery, selective files, pause/resume/restart/recheck,
  completion, opening, seeding, removal, low disk, corrupt data, and no-peer
  behavior without retaining payloads or sensitive logs.
- [ ] **QA-003 — Run installed release-candidate smokes.** Each claimed lane
  must install outside a source checkout, launch without development tools,
  complete the common cohort, survive relaunch/reboot where applicable, and
  uninstall with documented retained/removed state. The public `0.1.0` arm64
  DMG passed a bounded `/Applications` install, notarized launch, updater-ID
  initialization, and graceful-quit smoke. An isolated macOS arm64 appliance
  also installed that exact public build and updated through production to
  `0.1.1` with replacement, relaunch, and retained private updater identity.
  Linux arm64 passes the same exact public AppImage replacement/relaunch and
  updater-ID continuity check. Native Linux x86_64 also passes the public
  `0.1.1`-to-`0.1.3` AppImage update, relaunch, native picker, default-root
  retention, and payload-preserving removal. Windows x86_64 passes signed
  replacement from `0.1.1` to `0.1.3`, but automatic relaunch failed during
  old-catalog reset. Public `0.1.4` now passes native Windows x86_64
  `0.1.1`-to-`0.1.4` replacement, bounded reset, automatic relaunch, exact
  build and package-trust checks, and preservation of an unrelated Documents
  sentinel. Its old build could not select the sentinel as a root. The common
  cohort, reboot/relaunch, and full uninstall policy remain open. A separate
  unsigned x86_64 NSIS campaign under Windows 11 arm64 x64 emulation now passes
  installed cold/visible/hidden magnet and file activation, cancellation,
  bounded failures, duplicate handling, tray Quit, uninstall, and exact
  inherited-state restoration.
  Incubation update acceptance does not require retaining `0.1.x` torrents,
  settings, roots, selection, verification state, or updater identity; it must
  prove signed replacement, clean launch or bounded reset, and preservation of
  user-selected payload content.
- [x] **QA-004 — Establish a crash/support loop.** Users need an accessible
  version/build identity, copyable bounded diagnostics, known-issues link, and
  a report path. Automatic crash or analytics upload is not required for beta.
  Tactical `208`'s optional previewed coarse context may improve the report
  path after its hosted release gate is qualified, but it does not replace a
  user-visible diagnostics export or authorize automatic submission.
  Tactical `216` now supplies the desktop/shared-browser local report and
  public issue/guidance links with exact preview/copy/download, hostile-input
  and responsive accessibility evidence. This is current source; public
  `0.1.3` lacks the new export and candidate installation remains QA-003.
- [ ] **QA-005 — Review dependencies, notices, and release artifacts.** Verify
  license provenance, dependency advisories, archive contents, absence of
  secrets/development endpoints, and published checksums. All public `0.1.0`
  assets passed `SHA256SUMS`, manifest, target, signature, and immutable-URL
  checks. Public `0.1.2` passed the complete signed workflow and finalizer; its
  exact arm64 DMG also independently matched `SHA256SUMS` before the installed
  spot check. Current Rust/npm notices, the expiring advisory inventory and
  all four unsigned package-content gates pass in hosted run `34684328524`.
  Tactical 218 now qualifies the approved GLib backport and clears that
  dependency blocker with mandatory source proof. Native-platform notice
  clearance and source-delivery review remain open; dependency review alone
  does not close QA-005.

## Desktop Beta Checklist

### Packaging and platform integration

- [ ] **DESK-001 — Make the Tauri bundle real.** Tactical `157` supplies
  provisional icon assets and local bundle configuration. Hosted native DMG,
  NSIS, MSI, AppImage, DEB, and RPM builds now pass across the intended matrix.
  The public arm64 DMG also passed one installed macOS launch and graceful quit,
  followed by exact `0.1.0`-to-`0.1.1` replacement/relaunch in isolated macOS
  and Linux arm64 appliances. Windows x86_64 replacement/relaunch also passes
  under an automatic-loopback profile. Public `0.1.2` now contains the
  fresh-default and native root setup/repair changes and passes signed package
  validation. Public `0.1.3` now passes the native Linux x86_64 AppImage
  update, picker, relaunch, and payload-preserving removal. Public `0.1.4`
  passes a native Windows x86_64 fresh-default `0.1.1` update with automatic
  reset/relaunch, exact build and package trust, and an unchanged unrelated
  Documents sentinel. Selected-root preservation and broader clean-machine
  evidence remain required; Intel Mac installed testing is deliberately
  omitted.
- [x] **DESK-002 — Sign and notarize tagged builds.** Use the existing shared
  publisher Developer ID/notarization and Windows Azure signing setup. Missing
  credentials must fail a tagged build before publication; untagged CI must
  remain buildable without release credentials. Credentialed rehearsal
  [`32627436936`](https://github.com/kzahel/rstorrent/actions/runs/32627436936)
  proves Developer ID signing, Apple notarization/stapling, and expected-
  publisher Authenticode signing. Tagged run
  [`32656926123`](https://github.com/kzahel/rstorrent/actions/runs/32656926123)
  repeated those checks and published only after every leg and the sole
  finalizer passed. Tagged `0.1.1` run
  [`32661616090`](https://github.com/kzahel/rstorrent/actions/runs/32661616090)
  repeated the complete matrix and finalizer successfully. Tagged `0.1.2` run
  [`32959820514`](https://github.com/kzahel/rstorrent/actions/runs/32959820514)
  passed the same five signed legs and finalizer, including extracted Linux
  activation metadata and installed Windows activation-registry validation.
- [ ] **DESK-003 — Set least-privileged package ownership.** The default is a
  DMG-installed self-contained app on macOS, per-user NSIS on Windows, and a
  user-writable AppImage on Linux. MSI/DEB/RPM installs stay with their package
  managers and show a manual-update path.
- [x] **DESK-004 — Finish beta lifecycle integration.** Tactical `162`
  implements one desktop owner, second-launch restoration, default-on
  tray/background operation, persisted close policy, visible manual updating,
  and joined close/Quit/restart shutdown. The credential-free eight-job matrix
  and installed Windows x86_64/Linux arm64 campaigns pass, including branded
  shell icons and zero-process Quit. Autostart, crash restart, and identity
  migration remain post-beta decisions; external file/magnet handoff is now
  owned separately by DESK-008 and Tactical `163`.
- [ ] **DESK-005 — Qualify native root pickers.** Tactical `161` is complete.
  Its parented native Tauri picker passes installed Windows choose, cancel,
  first-default, unavailable-root repair, and controlled process-restart
  semantics; hosted Linux x86_64 AppImage testing proves the packaged picker
  dependency and build. Installed Linux desktop/portal behavior remains open,
  so the cross-platform gate is deliberately not checked.
- [x] **DESK-006 — Fix fresh-default Windows listener startup.** The public
  `0.1.0` and `0.1.1` Windows builds select `127.0.0.1` from the multicast
  source-route probe, reject it for local-network listening, fall back to
  `0.0.0.0`, and then fail application validation. Tactical `160` repairs the
  selector and wildcard fallback. Fresh signed `0.1.3` now passes native
  x86_64 default startup, root selection and relaunch. The separate old-
  catalog reset failure remains tracked by Tactical `215`.
- [x] **DESK-007 — Qualify Windows firewall consent.** Actual signed native
  x86_64 first launch displays Windows Security. Cancel leaves only exact-app
  inbound Public block rules and the product, picker and outbound updater
  usable. Incoming peers may remain blocked. A user may explicitly allow the
  exact app on a trusted private network; this campaign grants no Allow rule
  and does not claim public incoming reachability. See the September 12
  installed evidence and support guidance above.
- [x] **DESK-008 — Handle external magnets and torrent files.** Tactical
  `163` now registers the current RSTorrent packages for `magnet:` and
  local `.torrent` activation, forwards cold and warm input through the
  existing single desktop owner, reuses root/start options, and requires
  installed macOS arm64, Windows x86_64, and Linux arm64 proof. Deterministic
  and package gates plus all three installed campaigns pass. Windows exercised
  the real x86_64 NSIS/PE under Windows 11 arm64 x64 emulation. macOS proved
  targeted LaunchServices cold/visible/hidden delivery, cancellation, bounded
  failures, duplicate handling, tray Quit, cleanup, and retention of JSTorrent
  as the inherited default. Exact hosted run
  [`32775002484`](https://github.com/kzahel/rstorrent/actions/runs/32775002484)
  passed all eight platform jobs. This work does not adopt JSTorrent identity,
  extension routing, or remote `.torrent` URLs.
- [x] **DESK-009 — Notify on completion and fatal/repair state.** Completed
  Tactical `164` adds one native Rust notification owner. The exact standard
  Tauri package owns macOS/Windows delivery; Linux retains the same underlying
  exact native handle directly because the wrapper dropped it before GNOME
  could display or activate it. Completion and attention are edge-triggered
  and non-replaying; fresh settings enable both and allow users to suppress
  notifications only while RSTorrent is focused. The webview receives typed
  settings but no arbitrary OS-notification authority. Installed macOS arm64,
  Windows x86_64, and Linux arm64 evidence covers focused policy, hidden
  delivery, restart, settings, click behavior, joined Quit, and cleanup.
  Linux click restoration passes; macOS/Windows retain the tray fallback after
  measured standard-package click limits. Progress, aggregation, and mobile
  notification work remain outside the slice.
- [x] **DESK-010 — Prevent idle sleep during active downloads.** Completed
  Tactical `165` adds one default-on Tauri-only preference, authoritative
  `Starting`/`Downloading`/`Checking` policy, system-idle inhibition without
  display inhibition, and joined cleanup. Exact installed macOS arm64,
  Windows arm64, and Linux arm64 tests cover stalled work, minimized windows,
  preference changes, Pause, restart, Start, Quit, and cleanup. The exact-head
  unsigned Windows x86_64 package now repeats that native matrix on the native
  x86_64 appliance: SYSTEM-only request, more than 35 seconds held and
  minimized, off/on, Pause, joined Quit, paused process restart, Start, and
  final cleanup all pass. The next signed-candidate campaign still repeats the
  integrated package-trust/update case. Explicit sleep, lid close, shutdown,
  low-power policy, and seeding remain under ordinary OS policy.
- [x] **DESK-011 — Establish the beta extension bootstrap identity.** Tactical
  `166` adds the distinct bounded native-messaging host, target-triple Tauri
  sidecar packaging, per-user first-launch registration repair, NSIS cleanup,
  and a self-contained Manifest V3 seed whose only permission is
  `nativeMessaging`. Deterministic host/extension tests and an actual unsigned
  macOS app-bundle host `hello` pass. Chrome Web Store item
  `gcgoepclopkgijmclmlheafaglmbjlcc`, its public key, independently derived
  unpacked identity, and its exact native-host origin are pinned. The rebuilt
  app repairs a manifest containing only the production and beta origins.
  Chrome 151 on the installed unsigned macOS arm64 app proves the exact
  unpacked ID, native `hello` with the app stopped, and cold launch through
  **Open RSTorrent**. Full extension control, Crostini, hosted Windows/Linux
  package breadth, and production JSTorrent migration are not part of this
  beta-bootstrap gate.

### Desktop updater contract

RSTorrent will adopt the proven
[`desktop-update-v1`](https://github.com/kzahel/desktop-release-kit/blob/main/contract/desktop-update-v1.md)
contract and shared multi-product update service. The local
`desktop-release-kit` canary is the operational reference; AtPiano's updater
is still pending and is not the compatibility oracle.

- [x] **UPD-001 — Provision RSTorrent's update identity.** Generate one unique
  updater key, store only its public half in the app, add CI secrets for the
  private half/passphrase, and register an RSTorrent product route/config with
  the shared server. The distinct RSTorrent key pair was generated and all
  required updater/macOS/Windows repository secrets were confirmed present on
  2026-08-23. The public key, app endpoint, and product-owned server config are
  validated in source. The `/rstorrent` product descriptor was deployed to the
  shared production service and its health/product registration were verified
  on 2026-08-23. Credential values never enter this repository. The JSTorrent
  updater private key is not part of the incubation beta workflow.
- [x] **UPD-002 — Implement client behavior.** Add the Tauri updater/process
  plugins, stable random installation ID in the platform config directory,
  `X-CFU-Id`, exact check reason, a silent startup check after five seconds, a
  silent 24-hour check, bounded timeout/deduplication, manual check, visible
  release notes/progress/errors, explicit install, and relaunch only after
  successful installation. Native, controller, and component tests plus the
  full web regression suite pass locally.
- [x] **UPD-003 — Enforce package policy.** In-app replacement is allowed only
  for macOS app, Windows per-user NSIS, and user-writable Linux AppImage.
  MSI/DEB/RPM installations must use a visible manual/package-channel path.
- [x] **UPD-004 — Add release metadata validation.** Produce signed updater
  artifacts for `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`,
  `linux-x86_64`, and `linux-aarch64`; validate URLs, signatures, checksums,
  version agreement, immutable release assets, and draft-before-finalize. The
  source validators, negative tests, serialized five-leg workflow, and sole
  finalizer pass local checks. Hosted rehearsal
  [`32627436936`](https://github.com/kzahel/rstorrent/actions/runs/32627436936)
  produced all five private signed package sets. Tagged run
  [`32656926123`](https://github.com/kzahel/rstorrent/actions/runs/32656926123)
  then exercised the real draft, all required and package-specific
  `latest.json` entries, immutable GitHub release URLs, `SHA256SUMS`,
  complete-draft validation, and publication finalization. Independent public
  downloads and all five production routes passed after publication; see
  [`desktop-v0.1.0`](../evidence/desktop-v0.1.0.md). Tagged `0.1.1` run
  [`32661616090`](https://github.com/kzahel/rstorrent/actions/runs/32661616090)
  repeated the complete release matrix; all public checksums, the 15-key
  manifest, and current/older production-route probes passed. See
  [`desktop-v0.1.0-to-v0.1.1`](../evidence/desktop-v0.1.0-to-v0.1.1.md).
  Tagged `0.1.2` run
  [`32959820514`](https://github.com/kzahel/rstorrent/actions/runs/32959820514)
  passed the complete signed matrix and finalizer at exact commit `788e953`;
  its bounded public-DMG evidence is in
  [`desktop-v0.1.2`](../evidence/desktop-v0.1.2.md). Production-route and
  installed cross-version validation remain part of `UPD-005` rather than
  being inferred from publication.
- [ ] **UPD-005 — Prove a real cross-version package update.** On each
  supported desktop testbed, use an exact older public signed incubation build
  to check through the production route, explicitly approve replacement,
  relaunch, and verify the exact newer version/build and package trust. Old
  `0.1.x` torrents, settings, roots, selection, verification state, updater
  identity, and rollback are not retained-state requirements. If the newer
  build rejects its application-private state, it must take the declared
  bounded reset or fail-closed path while leaving user-selected payload
  content untouched and launching cleanly afterward. macOS arm64 and Linux
  arm64 now pass updater mechanics from exact
  public `0.1.0` to `0.1.1`, including explicit approval, replacement,
  relaunch, current-version checking, and private installation-ID continuity.
  Native Linux x86_64 passes the public `0.1.1`-to-`0.1.3` AppImage update,
  exact destination hash, relaunch, picker/default-root retention, and
  payload-sentinel preservation. Windows x86_64 proves Authenticode-valid
  `0.1.1`-to-`0.1.3` replacement from a fresh default profile; that build's
  old-catalog reset exited with Windows error 5. Public `0.1.4` now passes
  native Windows x86_64 fresh-default `0.1.1` replacement and automatic
  reset/relaunch through the production route, with exact build and package
  trust. An unrelated pre-update Documents sentinel is unchanged, but the old
  build could not select it as a root. macOS arm64 and Linux arm64 pre-update
  payload checks and the broader installed cohort remain open. Intel macOS
  installed testing is deliberately omitted by
  maintainer direction; source and metadata tests alone are its claim.
- [ ] **UPD-006 — Document update privacy and recovery.** Explain the random
  resettable installation ID, private server logging, automatic schedule,
  manual retry/download path, the absence of incubation rollback/state
  compatibility, statistics disable/reset behavior, anonymous checks when the
  disclosed preference is off, and behavior when an update, reset, or metadata
  service fails. Tactical `216` adds local support/privacy/recovery guidance
  including the actual Windows reset failure and observed firewall behavior.
  Corrected Tactical `208` public hosted pages remain unqualified, so the full
  public update/privacy gate remains open.

## Android/ChromeOS Beta Checklist

Tactical [`210`](../tactical/210-android-play-canary-setup.md) records the
maintainer-authorized separate Play canary setup begun on 2026-09-06. The
RSTorrent Canary app is created with `com.jstorrent.rstorrent`; the initial
console pass completed nine of eleven setup tasks, and the maintainer reports
completing the remaining forms. The adapted listing, reused icon/screenshots,
and canary banner are saved.

The authorized release follow-up adds the tag/version workflow and dedicated
upload signing identity. Both the manual rehearsal and
[tagged Android 0.1.0 workflow](https://github.com/kzahel/rstorrent/actions/runs/34039237324)
passed; the signed API-36 dual-ABI APK/AAB is available in the
[GitHub prerelease](https://github.com/kzahel/rstorrent/releases/tag/android-v0.1.0).
Signatures, expected certificate, manifest, ABIs, and 16 KiB packaging were
verified. The [Android runbook](../android-release.md) owns release commands
and the local signing backup procedure. No Play upload, rollout, or installed
qualification was performed by this follow-up.

This checklist owns the independent RSTorrent Android beta lane. Updating the
installed `com.jstorrent.app` product is a stronger and separately authorized
operation; [`android-jstorrent-replacement.md`](android-jstorrent-replacement.md)
owns its package/state handoff, production-extension rollout, and explicit
disposition of current JSTorrent Android features.

- [x] **AND-001 — Maintain a real first-party product.** Compose,
  in-process Rust, foreground-service lifecycle, SAF storage, generated UniFFI
  contract, dual ABI packaging, AVD, ChromeOS, and physical Android evidence
  exist. Tactical `157` graduates the complete module from `experiments/` to
  `clients/android` without splitting these owners.
- [ ] **AND-002 — Freeze application identity and upgrade semantics.** The beta
  is a distinct RSTorrent listing rather than an update/replacement for
  `com.jstorrent.app`. Its durable package is now `com.jstorrent.rstorrent`;
  installed data/state coexistence still needs qualification.
- [x] **AND-003 — Create a signed release App Bundle.** Tactical `210`
  configures dedicated upload signing, protected CI secrets, version code/name
  checks, and signed artifact inspection. Android `0.1.0` passes the hosted
  release pipeline. Minification remains deliberately disabled for the canary,
  so no mapping file is produced or implied.
- [ ] **AND-004 — Qualify the closed-testing channel.** Install from the store
  on representative Android and ChromeOS devices, prove store replacement from
  a disposable older fixture without requiring state retention, complete the
  cohort from fresh current state, recover foreground/background transitions,
  repair a revoked root, open content, and remove/uninstall cleanly.
- [ ] **AND-005 — Complete store and platform declarations.** Data safety,
  privacy, foreground service, notification, local-network/network behavior,
  content rating, listing text/screenshots, and support link must match actual
  behavior.
- [ ] **AND-006 — Retire Android platform deprecations.** The current build
  still warns on the legacy activity-result path plus notification and
  system-bar APIs. Migrate or deliberately bound each before a target-SDK or
  toolchain update turns warning debt into a release failure.
- [x] **AND-007 — Make active-download wake ownership explicit.** Completed
  Tactical `165` turns the former unconditional CPU/Wi-Fi lock path into a
  durable default-on preference over authoritative active operational states
  and retains only one service-owned partial CPU wake lock. A physical API 37
  device proves persistence, acquisition through screen-off Dozing, absence of
  a Wi-Fi lock, service-stop release, and exact data/root cleanup.
- [x] **AND-008 — Qualify ChromeOS Android extension control.** Tactical `194`
  carries the release-built shared React client through explicit
  Android-approved pairing to the one foreground-service application/engine/
  profile owner. Physical ChromeOS 150 now passes pairing, identity, packaged
  React control, Compose convergence, extension-triggered retained SAF roots,
  current/default future binding, referenced-root rejection, independent grant
  loss/repair, restart persistence, local `.torrent` intake, two controlled
  root-bound transfers, a detached 4 MiB transfer, reconnect, and exact
  cleanup without exposing a URI or descriptor. The product listener now binds
  only to ARC's fixed guest address. The exact extension connects from ChromeOS,
  while the Chromebook Wi-Fi address refuses raw TCP and the formerly
  successful spoofed-Host/Origin request from another LAN device. Shutdown,
  credential removal, uninstall, and post-cleanup refusal pass. Android-through-
  Compose remains a separate supported choice.
- [x] **AND-009 — Add background completion and actionable failure
  notifications.** Android now has the bounded service-native completion and
  fatal/storage-repair owner, default-on preferences, three truthful channels,
  initial/reset/recheck suppression, exact taps, denied/blocked visible-only
  shutdown, and prompt target-35 timeout handling. Deterministic, dual-ABI,
  API 34/35 connected, genuine controlled transfer/repair, resource, and
  cleanup gates pass. Completed Tactical
  [`198`](../tactical/198-android-completion-and-attention-notifications.md)
  also passes exact physical completion-to-torrent and attention-to-Storage
  taps, notification removal, zero restart/recheck replay, genuine repair,
  malformed-path restoration, and terminal cleanup on ChromeOS 150/API-33.
  Composed evidence covers denied-visible-only behavior, Compose-explained
  permission grant, companion disconnect/reconnect, the real ongoing-
  notification **Stop** action, listener refusal, and exact package/
  credential/power cleanup. This slice does not by itself claim a complete
  granted-background lifecycle.
  Tactical
  [`200`](../tactical/200-android-product-background-lifecycle.md) now
  implements that contract: explicit default-off continuation, qualifying
  active work, default stop on completion, optional continued seeding,
  activity handoff, intent-preserving joined shutdown, finite duration,
  Android-15 exhausted-quota fencing, and a bounded authenticated-companion
  reconnect grace. Connected API 28/35, controlled Home/reopen, task removal,
  process recovery, completion, seeding upload, shortened timeout, dual-ABI,
  and repository gates pass. Tactical `200` and `JAR-009` initially closed
  through maintainer-approved evidence composition; a later physical ChromeOS
  150/API-33 campaign directly adds Home/reopen, sticky recovery, completion,
  controlled background upload, seeding disable, authenticated companion
  retain/grace/reconnect/expiry, notification eligibility and Stop, relaunch,
  listener refusal, and exact cleanup. Reboot autostart,
  low-battery shutdown, VPN, and proxy remain outside both slices.
- [ ] **AND-010 — Add metered-network safety and bound VPN policy.** JSTorrent
  Android enforces unmetered/Wi-Fi-only and VPN-only prerequisites. Tactical
  [`199`](../tactical/199-android-live-unmetered-network-enforcement.md) now
  implements RSTorrent's required default-off unmetered cost policy with
  fail-closed startup, joined live BitTorrent egress convergence, automatic
  intent-preserving recovery, truthful generated/Compose state, and exact
  cleanup. Deterministic, dual-ABI, and installed API 28/35 AVD evidence
  passes. The unmetered gate remains open only for an explicitly authorized
  physical current-API phone handoff campaign; no physical device was used.
  VPN-only may remain a disclosed later feature unless a dedicated tactical
  proves Android network binding, handover races, socket leakage, tracker/DHT/
  peer coverage, and fail-closed recovery.
- [x] **AND-011 — Handle external magnets and torrent files.** Completed
  Tactical `197` makes the installed provisional Android product a narrow
  `ACTION_VIEW` handler for `magnet:`, exact BitTorrent-MIME `content://`, and
  supported `.torrent` content paths. Cold/warm delivery converges through one
  `singleTop` activity and service owner with generic root/start confirmation,
  one bounded ephemeral queue/read job, duplicate and retry-once semantics,
  temporary grants, privacy-preserving diagnostics, and no generated-contract
  change. JVM, lint/package, connected API 34, hostile-provider, exact-transfer,
  resource, revocation, and cleanup gates pass. Signed package/store handler
  declarations remain owned by `AND-003` through `AND-005`.

## iOS/iPadOS Beta Checklist

- [x] **IOS-001 — Maintain a real first-party product.** SwiftUI,
  in-process Rust/UniFFI, app Documents and qualified selected roots,
  simulator/physical lifecycle evidence, system preview, and reproducible
  unsigned/development archives exist.
- [ ] **IOS-002 — Freeze the distribution bundle identity.** Replace the
  `.dev` identifiers with a durable RSTorrent namespace while preserving the
  explicit independent-product and later-migration posture.
- [ ] **IOS-003 — Add complete app artwork and metadata.** Tactical `157`
  supplies provisional buildable artwork; final App Store icon, display copy,
  screenshots, privacy manifest review, support/privacy links, and localization
  review remain open.
- [ ] **IOS-004 — Automate a signed archive/export.** Use protected Apple
  credentials/profiles outside the repository, validate archive contents, and
  upload the exact reviewed build to TestFlight.
- [ ] **IOS-005 — Prove TestFlight replacement and lifecycle.** Install a
  disposable older fixture, replace it through TestFlight without requiring
  state retention, validate clean current state or bounded reset plus payload
  safety, run phone/iPad cohort cases, and record finite-background
  limitations. Compatibility begins only with the explicitly supported build.
- [ ] **IOS-006 — Make storage bridging Swift 6 concurrency-clean.** Current
  archives warn that asynchronous `NSLock` and `DispatchGroup.wait` calls in
  `PlatformStorageBridge` become errors in Swift 6 language mode. Replace them
  with an async-safe ownership design before enabling that mode or requiring a
  toolchain that does so.
- [x] **IOS-007 — Keep power behavior truthful.** Completed Tactical `165`
  adds no idle-timer assertion or general keep-awake setting. A current signed
  physical-device archive exposes the existing finite-background explanation
  across both Settings pages and resumes cleanly after Home/background, while
  Tactical `149` remains the lifecycle authority.

## Beta Feature Boundary

The beta MVP is an honest ordinary downloader/seeder, not feature parity with
every mature BitTorrent client. The following are required product behavior
for a lane unless the platform-specific checklist narrows them:

- magnet and local `.torrent` intake with clear errors and duplicates;
- path/root choice, selective files, pause/resume, queueing, recheck, remove
  with safe keep/delete choices, restart, completion, open/share through the
  platform's supported path, and basic speed/connection/seeding settings;
- truthful progress, no-peer/retry/storage/checking explanations, bounded logs,
  and version/support information; and
- repeatable common public v1 behavior plus the controlled correctness cohort.

These useful gaps are **not automatic beta blockers** when disclosed:

- embedded/progressive media playback and a media catalog;
- search, plugins, torrent creation, tracker mutation, rich numeric file
  priorities, ratio/time seed goals, and durable transfer totals;
- production remote access, relay, third-party pairing, and migration from
  legacy JSTorrent. Extension control remains required only for the explicitly
  advertised ChromeOS Android companion-client lane under `AND-008`;
- VPN-only, proxy, interface-specific, and broader power policy. Android
  metered-network safety is separately promoted to `AND-010`;
- local service discovery (BEP 14), HTTP web seeds (BEP 17/19), tracker scrape
  (BEP 48), hole punching (BEP 55), PCP/NAT-PMP, and full IPv6/uTP breadth; and
- complete BEP 52 coverage. Pure-v2 and hybrid behavior may be labelled beta
  or experimental according to the public-swarm cohort actually passed.

Missing features become blockers if the product advertises them, if their
absence creates corruption/security risk, or if cohort evidence shows they
are necessary for ordinary advertised downloads. Public incomplete-swarm
reliability and ordinary performance remain evidence requirements even though
no single optional BEP is mandatory.

## Tactical Status And Release Backlog

List order preserves the campaign record and rough release context; it is not
a required execution sequence. Independent items may become active
concurrently when directed, without demoting other active work.

1. **Complete — Tactical `157`: beta release foundation.** Established this
   ledger, graduated the Android module path, added provisional platform
   artwork/bundle metadata, corrected entry-point status, and preserved
   historical evidence.
2. **Complete — Tactical `159`: cross-platform presubmit CI.** Hosted Rust/web,
   native desktop, Android, iOS, deterministic E2E, and short locked
   loopback-interoperability jobs pass; the repaired performance workflow also
   retains a successful manual smoke artifact.
3. **Complete — Tactical `162`: desktop single-instance and tray lifecycle.**
   One application owner, default-on persisted background policy,
   close-to-tray, visible manual updater action, joined Quit/restart, native
   Linux arm64 packaging, release-only Windows GUI launch, and installed
   Windows x86_64/Linux arm64 proof pass. File/magnet handoff remains outside
   that completed slice and is now owned by Tactical `163`; autostart stays
   deferred.
4. **Active — Tactical `158`: desktop signed packaging and updater adoption.**
   The product-owned `desktop-update-v1` client, signed package workflow,
   release validation, per-app key, public configuration, production route,
   five-platform hosted rehearsal, three tagged publications, one installed
   macOS arm64 launch smoke, and exact macOS arm64 and Linux arm64
   `0.1.0`-to-`0.1.1` production-route updates are complete. Windows x86_64
   updater replacement also passes under an automatic-loopback profile.
   Completed Tactical `160` repairs fresh-default address selection on `main`;
   Completed Tactical `161` now proves unsigned installed Windows first-root
   setup; completed Tacticals `163`--`165` add external intake, notifications,
   and active-work sleep inhibition. Public `0.1.2` now carries those repairs,
   and its signed package matrix plus bounded macOS arm64 launch/native-host
   spot check pass. Later exact public `0.1.1`-to-`0.1.3` evidence closes the
   Linux x86_64 AppImage update and characterizes Windows firewall Cancel.
   Repeat clean Windows from the default with a signed build containing
   Tactical `215`'s reset repair under the disposable-state `UPD-005`
   contract. Intel
   macOS installed testing is deliberately omitted. Explicit maintainer
    direction temporarily yielded this item to now-complete Tacticals `169`,
    `170`, `171`, and now `179`. Its open gates remain unchanged.
5. **Complete — Tactical `163`: desktop external torrent intake.** The
   bounded shell/UI implementation, package gates, and installed Linux arm64,
   Windows x86_64-application, and macOS arm64 cold/visible/tray-hidden/
   cancel/failure/duplicate/Quit campaigns pass. Exact hosted run
   `32775002484` passed all eight platform jobs.
6. **Complete — Tactical `164`: desktop completion and attention
   notifications.** One Rust-owned, edge-triggered, non-replaying owner,
   versioned typed desktop preferences, deterministic/package gates, and
   installed macOS arm64, Windows x86_64, and Linux arm64 evidence pass.
7. **Complete — Tactical `165`: cross-platform active-download sleep
   inhibition.** One default-on desktop/Android preference, level-triggered
   system-idle ownership, iOS inapplicability, and real cleanup pass through
   machine-control on every available desktop/mobile target. Tactical `158`
   remains active.
8. **Complete — Tactical `160`: Windows local-network address selection.**
   Wildcard binding remains, only a concrete eligible address is reported,
   the bounded Windows best-route fallback and native CI regression pass, and
   signed installed proof returns to Tactical `158`.
9. **Complete — Tactical `161`: packaged desktop folder picker.** The native
   parented Windows picker, self-contained packaged Linux picker, stable root
   boundary, and installed Windows cancel/select/repair/restart evidence pass.
10. **Complete — Tactical `179`: disposable incubation state epoch.** The
   fresh schema-21 catalog resets every recognized schema 1 through 20 before
   startup. DHT-v1, desktop-settings-v1/v2, and browser-appearance-v1/v2
   readers are gone; current-format validation, crash convergence, fail-closed
   hostile/future handling, and external payload remain exact.
11. **Complete — Tactical `176`: durable High file priority.**
   High/Normal/Skip persistence, weighted ordinary scheduling, streaming
   composition, first-party presentation, Linux/web/Android gates, 28 iOS
   simulator tests, and the unsigned arm64 device archive pass.
12. **Ready — supported-release boundary.** Keep all `0.1.x` and current
   previews explicitly disposable, then choose and declare the first supported
   version with a fresh persistence/API baseline. No migration from incubation
   state is required. Complete its changelog, privacy/support, diagnostics
   export, and repeatable cohort before making that support claim.
13. **Later — platform release campaigns.** Close desktop, Android closed-
   testing, and iOS TestFlight gates independently with real signed
   replacement evidence under the disposable-incubation policy.
14. **Later — Tactical `153`.** Wired-LAN uTP scalability remains valuable
   engine evidence but no longer displaces the explicit beta-readiness
   campaign.
15. **Complete — Tactical `167`: ChromeOS Crostini bundled web launcher.** The
    bundled Rust host and React UI, static user service, registered Linux
    Launcher, and exact beta-extension handoff pass source gates and the
    available warm, twice-stopped-VM, detachable-transfer, preservation, and
    purge matrix on the physical Chromebook. The conditional full reboot was
    unavailable because no approved profile-login credential exists; signed
    public packages remain later breadth. Tactical `158` remains active.
16. **Complete — Tactical `168`: platform-aware extension launcher.** ChromeOS
    omits the irrelevant desktop-native flow and presents the exact published
    JSTorrent Android listing beside ChromeOS Linux; desktop platforms retain
    only desktop behavior. The deterministic reviewed `0.3.0` package and
    physical ChromeOS chooser, exact Play destination, and warm Crostini
    handoff pass without new permissions or availability claims.
17. **Complete — Tactical `169`: hosted Crostini bootstrap and release.** The
    pinned updater-key one-command installer, strict signed manifest, native
    x86_64/ARM64 `crostini-v*` workflow, release runbook, deterministic failure
    corpus, and exact non-public x86_64 physical package repair/failure matrix
    pass. A later explicitly authorized operation published non-latest
    `crostini-v0.1.0`, deployed the website bootstrap, independently verified
    every signed public artifact, and passed the exact website install,
    Launcher, and stop/relaunch flow on physical x86_64. Physical native
    ARM64, full reboot, suspend, and installed update/rollback remain open.
18. **Complete — Tactical `170`: configured Linux headless service.** One
    ordinary-user Rust application owner, exact React assets, strict durable
    root/listener/origin/Basic secret-file configuration, and a disabled-by-
    default systemd user unit pass deterministic and real x86_64 Linux gates.
    HTTPS/WSS proxy control, zero-view transfer, completed re-seeding, idle
    reachability, joined restart, rollback-safe repair, uninstall preservation,
    and exact cleanup pass. x86_64/ARM64 packages construct byte-identically;
    native ARM64 systemd and public distribution remain unclaimed.
19. **Complete — Tactical `171`: signed headless release and trusted-LAN
    service.** A strict signed two-architecture `headless-v*` lane, verified
    bootstrap, operator-approved CLI/browser update discovery and apply,
    exact RFC 1918 `lan-none` admission with truthful full-control UI, and an
    enabled healthy current-host x86_64 service campaign pass. No public
    publication, unattended update, system-wide service, firewall change, or
    Raspberry Pi mutation occurred. Tactical `158` remains active.
20. **Complete — Tactical `194`: ChromeOS Android extension control.** Preserve
    the JSTorrent companion user journey without its extension-owned engine or
    raw IO daemon: package the shared React UI in the beta extension, pair it
    explicitly over the same-device ARC boundary, and attach it to the one
    Android foreground application/profile owner. Provide the shared root UI
    through Android's SAF picker and retain older grants for their bound
    torrents when a new root becomes current. Physical cold launch, pairing,
    coexistence, two-root lifecycle, repair, detached transfer, reconnect, and
    cleanup pass. The companion is fixed to ARC's guest address; ChromeOS
    connects through ARC while the Chromebook Wi-Fi address refuses the same
    port and the formerly successful spoofed-Host/Origin request. Store
    publication, production JSTorrent extension changes, state import, media,
    notifications, and dynamic network policy remain outside the slice.

Each implementation item requires its own bounded tactical. These status
classifications are not authorization to tag, publish, alter production
routing, create store listings, or provision credentials without the required
maintainer action.

## Maintenance Contract

Every release-readiness tactical updates this checklist with actual evidence,
newly discovered blockers, and deliberate deferrals. Keep item IDs stable.
Do not check a platform gate from another platform's build, infer update
success from generated artifacts, or turn a changing public swarm into a
required presubmit.

Before handing a build to external testers, copy the applicable open items
into a version-specific release candidate record with the exact commit,
versions, artifacts, checksums, CI runs, installed/update evidence, known
issues, and final publication decision. This living topic remains the backlog;
it is not itself a release attestation.


## Qualified production desktop activation, 2026-10-10

Shipment295 publishes exact signedff632 desktop0.3.0 with independently
verified corresponding sources. All17 actual public downloads pass whole-file
hashes. Exact candidate Linux x64 updater and Mac ARM manual populated
replacement/reopen checks pass, with state restoration and VMs off/released.
Websitee0cb8a3c deploy38059186510 and actual phone/wide public links pass.
Server46b3b35 activates production0.3.0 with11 exact URL/signature selectors,
current/newer204, empty production Latest204 and unchanged preview hashes.
Original updater roots are retained. Separate079–083 own ignored receipts.

Renewed Web Store sign-in confirms extension 1.1.3 still Pending review.
Play approves all 92 changes and publishes Android 28 at 5% on October 10 at
16:51 UTC, with managed publishing still on. Separate088 records actual
approval and production rollout; production-channel installed canaries and the
24-hour observation remain open. The earliest observation end is October 11
at 16:51 UTC; unavailable Console metrics do not establish no failures.
The stated first-release default preserves ARM64/x86_64/API28+;
affected older devices retain their previous app. Exact managed28 detached hour,
hidden whole hash and independent three-reopen continuation pass under074.
The original text-only Pause harness failure and brief peer gap remain recorded.
Managed28 source-absent foreground upload passes under087 with original
listener setting, installed identity/grants and scoped cleanup. All VMs are off
and both Chromebook inventories empty under086. Dependency alerts retain the
existing source-verified GLib remediation and production rustls0.23.45; the
unreleased iOS probe remains outside release scope. Shipment295's bounded
stopping condition is complete; actual store delivery/soak continues under297.

Saved privacy/access/optional feedback Diagnostics and actual signed listing
assets are included under078/084. All29 text localizations are audited; Hindi
name retains JSTorrent spelling. Actual 5% publication is recorded under088;
production-channel installed delivery, 24-hour observation, physical Intel and
unrun reboot/sleep/background-upload gates remain unqualified.

## Compatible unattended channels (377)

Tactical [377](../tactical/377-compatible-touchless-release-channels.md)
adds authenticated per-release database compatibility to the existing
Stable/Latest choice. New public JSTorrent builds use one numeric version
train across both channels; equal-version promotion does not reinstall.
Stable selection saves the preference immediately and waits for a newer
compatible offer. Native admission authenticates the metadata, binds it to
the exact product/version/platform/payload, and checks all existing stores
before download and again before shutdown. Missing metadata fails closed.
The production code supports both channels only when the service explicitly
permits that native target; Stable permission remains false during qualification.
Latest is the first rollout lane. Promotion preserves tested native/source
bytes and checks its predecessor and source/digests again before publication.
The frozen incubation lane stays frozen. The shared service extension is
deployed with unchanged ordinary Stable bodies; public publication retains the
strict-companion hold, and private signed VM qualification remains in progress.
