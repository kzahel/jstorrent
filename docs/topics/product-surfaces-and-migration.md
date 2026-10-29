# Product Surfaces And JSTorrent Migration

Tactical [389](../tactical/389-localized-product-release.md) coordinates the
maintainer-authorized October 29 coordinated release: desktop 0.3.6, extension
1.1.8, Android 1.0.35/code 35, remote controller 0.3.5 and the canonical website.
It carries forward the existing extension 1.1.5+ host requirement for the same
eight reviewed fields, preserves identities/signing/data and separates store
submission from approval. The nineteen-locale source is qualified in 388.
The extension and remote controller are public. Android 1.0.35 is available to
one percent of production users across the existing 178 countries, following
a verified Play-signed upgrade and the registered standard seven-day plan.
Desktop 0.3.6 is public on Stable and Latest from full-CI-qualified source
5e3af4fd. All seventeen public assets per channel and all ten updater offers
verify; unchanged-byte promotion 40872253650 and canonical website deployment
40872952636 succeed. The website serves the six qualified 0.3.6 download links.
Desktop selection verifies effective draft access and refreshes drafts by ID, reserving
interrupted versions without replacing their source or signed assets.
The internal-only Android 1.0.34 candidate is superseded by 1.0.35 so both new
hosts include ZIP 9.0.5 and explicit header-consistency checks for torrent-list
imports. No new schema, API, signing root or advisory exception is introduced.

Tactical [379](../tactical/379-release-security-dependencies.md) removes fresh
dependency-audit blockers for 378's public Latest 0.3.2. It preserves the native
updater version, product identity, store migrations and package formats while
patching TLS and torrent-list ZIP handling. No Stable publication is implied.

Tactical [377](../tactical/377-compatible-touchless-release-channels.md) supplies
the compatible Stable/Latest train and production-signed private update
rehearsals. Promotion preserves tested native/source bytes and rechecks its
Stable predecessor, Latest source and every asset digest before publication.
Signed macOS ARM, Windows x64 and Linux x64 real-idle updates, schema refusal,
compatible Stable catch-up and retained-data checks pass. The shared service
controls automatic permission by channel and exact native target. Ordinary
Stable bodies remain unchanged. Tactical
[378](../tactical/378-public-latest-and-nightly.md) authorizes public Latest
and a daily changed-main publisher, with a bounded eight-field exception
requiring extension 1.1.5 or newer. Stable and Android keep their existing
companion guard, including when promoting Latest packages to Stable.
Intel macOS under Rosetta also passes the real-idle late-focus test and manual
Stable catch-up. Both channels permit exactly the four tested updater targets;
Linux ARM stays manual. Physical Intel coverage is not inferred.

Tactical [355](../tactical/355-automatic-updates.md) implements fully unattended
updates for JSTorrent macOS app, Windows NSIS and Linux AppImage. Maintainer
direction on October 16 permits a brief transfer interruption and restart
after 15 minutes without interaction. Existing identities, signing roots,
channels, durable data and package ownership remain constraints; default-on
activation follows the per-target signed qualification in 377. Android, store-managed extension
updates and the future Linux CLI retain their separate distribution owners.
This implementation does not change production routes or the 30-day compatibility policy.

Tactical [361](../tactical/361-extension-store-publishing-setup.md) lets an
`extension-v*` tag test, package and submit the production extension to its
existing Web Store item without a stored key, through a sibling workload
identity provider beside Yep Anywhere's on the same publisher. On 2026-10-15
the store API reported 1.1.4 published, and the workflow submitted 1.1.5
(the first tolerant companion) for automatic publication after review.
Listing, permissions and visibility are unchanged.

Tactical [336](../tactical/336-production-desktop-extension-control.md) repairs
production desktop-extension admission. Released desktop 0.3.0/0.3.1 retain
a native helper guard allowing only the beta ID, although registration and
authenticated WebSocket admission already allow production. The source repair
and an unpacked production 1.1.4/macOS candidate pass local launch/lifecycle
qualification. Public Latest 0.3.2 now contains the corrected signed desktop helper.
Stable 0.3.1 retains the guard; retrying or reinstalling the unchanged
extension cannot repair that older host.

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


## Android-owned ChromeOS setup, 2026-10-12

Tactical [320](../tactical/320-chromeos-android-owned-extension-setup.md) is
complete locally. The extension's Open JSTorrent Android action is a directly
clicked `jstorrent` intent targeting `com.jstorrent.app`; debug installs cannot
compete in that chooser. The old `rstorrent` scheme is incoming compatibility.
Connect in Chrome and Retry connection are attach-only, with explicit optional
browser permission recovery on the page.

Android owns setup, including a normal Settings → Advanced entry. It requires
notification eligibility, starts the existing companion and gives the explicit
setup action a fresh fixed bootstrap grace before opening the exact HTTPS
website handoff. The handoff only opens/focuses one extension UI; Android still
approves pairing, and credentials never enter the website URL/message. Website
unavailability retains the manual extension route. No standalone background or
seeding preference is enabled by setup.

Two physical API-33 cohorts pass isolated candidate launch/cancel/retry, native
setup, browser permission recovery, rejection/real expiry/fresh approval,
reload/process restart, singleton and unavailable-website manual return. Two
notification/channel Compose cases pass on each. Play signing differs from the
local upload signer, so this evidence preserves production packages and uses
explicit test identities plus exact HTTPS candidate bytes. Public hosting and
Play/Web Store updates are not deployed by this tactical. Deliver the website,
then the Android scheme/setup update, then the extension's new launch link;
qualify the production-installed pair before claiming the new public journey.
This supersedes the old no-return-path description below, without promising
one-action first setup or closing Tactical 253's broader ChromeOS matrix.


## JSTorrent-only release policy, 2026-10-11

Maintainer direction freezes the RSTorrent incubation release track. All new
product releases use JSTorrent identities and established signing continuity;
there is no ongoing second flavor or incubation release campaign. Desktop
already uses `com.jstorrent.desktop`, the original JSTorrent updater signing
key and `https://updates.jstorrent.com`; public 0.3.0 under
[295](../tactical/295-qualified-candidate-shipment.md) records the cutover.
This is an accepted freeze, not a proposal to provision that key again.
Isolated debug/test package identities and internal `rstorrent-*` names may
remain without constituting another release track.

The last recorded incubation desktop offers are Stable 0.1.4 and Latest
0.2.801. Retain published historical artifacts and existing legacy route
behavior while retiring release machinery; do not re-enable
`INCUBATION_PUBLICATION_ENABLED`, create new incubation packages, or advance
those channels. Old incubation apps trust a different updater key and must
not be redirected to JSTorrent payloads as an automatic migration.

For installed JSTorrent apps, preserve the existing update-check URL shape
`/tauri/{target}/{arch}/{current_version}`, implicit Stable selection when no
channel is supplied, the Tauri response fields, HTTP 204 for no update, and
the embedded signing trust root. The server may change its release discovery
and configuration behind that contract. Platform selection continues to use
the selected release's `latest.json` platform entries.

Tactical [296](../tactical/296-production-preview-feed-separation.md)'s exact
asset filters still prevent historical incubation releases from entering the
JSTorrent feed. The current `JSTorrent_x64.app.tar.gz` requirement is a legacy
release-selection guard, not a client requirement or the desired platform
model. A subsequent bounded cleanup should select eligible JSTorrent releases
without depending on one platform's filename, preserve historical exclusion
and isolate caches/notes, and verify existing client requests across platforms,
versions and channels. This documentation change does not remove that filter
or alter the deployed service.

Earlier incubation/qualification checkpoints below retain their evidence;
this policy supersedes their recommendations to continue RSTorrent releases.

Tacticals [299](../tactical/299-production-website-consolidation.md) and
[303](../tactical/303-canonical-remote-origin.md) complete website consolidation.
jstorrent.com serves this repository's established JSTorrent design, blog,
compatibility routes and guarded `/remote/` controller through Cloudflare Pages.
Qualified production releases automatically promote verified downloads and
announcements, then deploy the combined website. GitHub Pages is manual-only
marketing rollback. The old `/app` prototype has retirement guidance;
rstorrent.com marketing and remote documents redirect, while hashed remote
assets and installer routes remain available. The exact canonical remote browser
origin passes deployed security and disposable host/browser acceptance.
Private infrastructure records own the accepted DNS/forwarding migration;
registrar and repository names remain unchanged. Both previous implementation
READMEs point to this source. Repository renames remain a separate compatibility
decision.

## Android 1.0.29 production review submission, 2026-10-12

Tactical [315](../tactical/315-android-1-0-29-production-release.md) submits
the exact original-upload-key signed 1.0.29/code 29 AAB from tagged source
`8ddf2e8b` to the existing production app. At 07:01 UTC, Play shows the sole
change **29 (1.0.29), Start full rollout** under **Changes in review**.
The preview confirms 100% and all targeted countries with zero device losses;
managed publishing is off for automatic publication after approval. At 15:34
UTC quick checks have completed and Play explicitly confirms changes are now
in review; approval and public availability are not inferred.

The release includes 314's crash repair and the landed 308/310/311 file-selection,
setup/background and notification-settings fixes. Signed/publication and full
source CI pass; independent hashes, original signatures, identity, native
equality, alignment and notices pass. Fresh API 28/35 cohorts pass 29 owned
navigation/shutdown cases each. Native symbols are included, with readable
production symbolication unqualified. Production 28 remains until approval;
desktop 0.3.0 and extension 1.1.3 retain their separate delivery bindings.

## Production Android crash checkpoint, 2026-10-12

Read-only Play monitoring at approximately 05:12 UTC now shows one version-28
foreground crash, one affected user and one event on a Pixelbook/API 33. The
generated `AndroidApplicationClient.subscribe$suspendImpl` line 7308 maps
exactly to the destroyed-client handle guard. Version 28's all-category issue
view shows no other crash/ANR clusters in the September 14–October 12 window;
usable failure-rate denominators remain unavailable. These observations do not
establish population stability or the exact customer lifecycle trigger.

Tactical [314](../tactical/314-android-presentation-shutdown-race.md) reproduces
the late-request failure and locally fences terminal presentation closure,
contains setup errors and releases partially acquired groups. Android build
and regression evidence belong to 314; production delivery and observation
remain under 297. No store version, release binding or rollout is changed.
Play Statistics reports seven version 28 update events on October 10 and 17 on
October 11; these events are not unique users or a crash-rate denominator.

## Current store delivery checkpoint, 2026-10-11

Android 1.0.28/code 28 is now at 100% following explicit maintainer direction
at 19:52 UTC. Play confirms the rollout update and full availability; ignored
report090 records the release state. This supersedes the 5% hold below.
Expansion addresses the new extension's requirement for the successor Android
companion; production-installed migration and usable stability evidence remain
open under [297](../tactical/297-staged-store-delivery-and-soak.md).

Desktop 0.3.0 downloads, corresponding sources, website and production updater
are live and verified under295. Play approves all 92 changes and publishes
Android 28 at 5% at 16:51 UTC; managed publishing stays on and release 23
remains available. Extension 1.1.3 is approved and published on October 11;
the physical public listing and fresh Chrome Web Store installation confirm
delivery. Separate ignored receipt089 passes actual popup, Android28 pairing,
connected empty library, reload and normal Shutdown/relaunch/Retry reconnect,
with package/grants/notification preference preserved and tab/window cleanup.
This is fresh extension installation against an earlier internal Android28,
not an existing-extension update or Android production-installed canary.
Separate ignored report088 records the earlier actual Play publication states
and refreshed public Play listing copy/images/disclosure.
The local update guide now explains gradual Android rollout; Astro check/build
and styled phone/wide captures pass after correcting the capture server MIME
type. Public deployment of this root Astro guide is not asserted.
Production-channel canaries and real 24-hour observation
continue under [297](../tactical/297-staged-store-delivery-and-soak.md); earliest
observation end is October 11 at 16:51 UTC, not an automatic expansion time.
The 14:42 UTC read-only check finds eight version 28 device-update events since
rollout start in Play Statistics, despite unavailable release-dashboard totals.
Those are events, not unique users or a production-track installation receipt.
Version 28 vitals remain unavailable and the current feedback feed has no
1.0.28-tagged responses; see 297 for the report bounds.
At 19:41 UTC, the rollout remains at 5% and the Statistics table reports at
least ten version 28 update events, up from eight. Crash/ANR rates remain
unavailable and the feedback feed still has no 1.0.28 tag. The 24-hour minimum
has elapsed; production-installed canary and stability evidence remain open.
Earlier prepared-draft checkpoints below remain historical.


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

Tactical [291](../tactical/291-companion-shutdown-recovery-copy.md) locally
clarifies normal Android launch before attach-only Retry after Shutdown and
fixes dim companion troubleshooting links with the existing foreground token.
Full web typecheck/481 cases,56 extension cases, localization, companion/CSP
build and exact local production1.1.3 packaging pass. Six320/390/1100 source
renderer captures reproduce before contrast and pass after accessibility,
keyboard/overflow/cleanup checks; transport/view dependencies are injected.
Slice055 verifies actual managed27 Shutdown guidance/readable links, stopped
service after Retry and normal app-launch retained reconnect. Exact package/
grants/notification preference and scoped cleanup/zero tabs/windows pass; four
report checks reap their browser/server. Slice057 uploads the exact1.1.3 to the
existing draft; native Reload verifies draft1.1.3/public1.1.1. Listing/screenshots/
privacy remain. Submission and installed-store delivery remain under259; signed
desktop/Android retain their source bindings.

Fresh exact2b83 Mac ARM GUI and Linux x64 automatic HTTPS updating now pass
under053/054: ten checks, nine/six refusals, four-record import/native Quit/reopen
and independently persisted statistics off. Inherited source/payload/scopes
restore exactly; owned staging/capture/transports are removed, both VMs shut
down/release and the private trial is removed. Five payload404s/eight ordinary
responses verify. First checksum-field preflights remain failed before VM boot;
corrected digest-field retries pass. Separate actual reports retain clipping
and pre-existing Mac OS overlays. No public feed/release/store publication.

Slice050 freshly confirms the other Chromebook still stalls at the OS Play
startup screen and canonical ADB refuses. Installed acceptance on that cohort
remains blocked; no product failure is inferred. No pending-update reboot, app
reset or sideload occurs. Individual tabs/windows close to independently empty
inventories. Guided physical-recovery availability remains separate; actual
screenshot/refusal/cleanup evidence stays in the ignored separate report.

Slice049 now passes the fresh exact Windows signed successor through the
released0.2.1 ordinary HTTPS updater: interrupted download preserves the old
installation, normal GUI retry imports four records, and native Quit/reopen
retains them. Eleven checks/eight refusals and privacy opt-out pass. Independent
50-registry/seven-file restoration, owned staging/firewall cleanup, VM-off and
claim-release verify. The private fixed-fixture trial is removed; five payloads
return404 and eight ordinary routes remain unchanged. An initial malformed
attempt value was refused before VM boot and is preserved as failed evidence.
Separate actual screenshots/report retain clipping notes. No public feed/store
submission/release occurs; complete delivery/cohort acceptance remains open.

Slice047 independently qualifies fresh2b83 signed Windows NSIS Authenticode and
actual branded welcome/location pages. Normal Cancel before installing Next
preserves inherited scopes. Populated old0.2.1 manual replacement passes eight
checks/eight refusal routes, four records and native Quit/reopen; statistics
opt-out persists. Exact50-registry/seven-file restoration, owned firewall/staging
cleanup, VM-off and claim-release pass. Separate actual screenshots/report
retain Status/detail-tab clipping and technical registration-error copy as design
notes. Four390/1200px report/index checks pass and terminate their browser/server.
Fresh ordinary HTTPS updating now qualifies separately in049; no publication.

Slice045 saves and reload-verifies the three reviewed current-UI screenshots in
the existing Web Store item's draft: light Torrents, light Library, dark Torrents.
Their exact opaque RGB1280×800 hashes match Slice019; DEMO DATA/adapter labels
remain truthful. Actual before/after dashboard captures show the replacement and
order. Original icon, title,844-character description, category/language and
privacy categories/certifications/remote-code/policy URL remain. Draft1.1.2 and
published1.1.1 are unchanged. No review submission/publication or live-pairing
claim follows. The separate report passes390/1200px image/overflow/runtime checks;
bundled headless Chromium and report server terminate. Reports remain ignored.

The maintainer pushed main through `2b83ed91`; fresh signed candidate
[38029276220](https://github.com/kzahel/rstorrent/actions/runs/38029276220)
passes all five signed lanes and collector at that exact source with publication
disabled. Independent final artifacts pass15 hashes/sizes, six original-root
signatures/six wrong-root refusals and11 selectors. Both Mac architectures pass
strict signatures/Gatekeeper, app/DMG staples and accepted ticket CDHash binding;
five extracted formats pass notices/inventories. The initial verifier's pre-staple
versus final-DMG hash assumption remains failed, corrected through ticket binding.
Actual fresh Windows artwork/install/updater checks remain separate.
Local loopback/Crostini host permissions are confirmed for extension testing.

Slice044 installs the actual official1.1.1 extension against Play-managed27,
observes its generic Offline/Android-not-running menu and launch fallback into
Play Store, and returns to the usable native Live library through the shelf.
This empty, non-migrated managed profile has no migration-specific extension-update
card, so imported-cohort guidance and complete mixed-scenario acceptance remain
open. Normal Android Shutdown and removal of only the newly installed test
extension retain package identity/install times and persisted grant identity/
modes/time. Individual tabs/native windows close to zero; selected owned root
stays empty. Original cleanup runner's older-archive selection assertion remains
failed; independent review binds the actual uploaded ZIP and terminal cleanup.
Reports/screenshots remain ignored. No app reset, sideload, reboot, store submission
or publication occurs. B's pending OS update/SSH startup evidence remains a
separate recovery concern. Prior Slice042 push/access-pending text is historical.

Slice041 passes managed27 owned-folder unavailability/restoration with a
verified1MiB paused payload. Normal Shutdown removes task/service before each
marker/inventory-checked rename; the missing original path is not recreated.
Actual Library retains its row with Your library is retained/Repair, and Storage
shows unavailable/Repair. Restoring the original path returns Live/paused row,
available Storage and the full SHA-256 with the source paused. Package identity
and persisted grant identity/modes/time remain. Normal Keep data/Back/Shutdown,
exact owned cleanup and zero tab/window inventory pass; empty selected folder/
grant remain. No grant loss/regrant, completed Repair picking, second tree,
opaque root-ID, removable provider, relocated binding or reboot claim follows.
Duplicate current-folder rows and Select/Repair/provider wording are design notes.

Slice039 passes actual managed27 notification-denied partial-transfer OS
Minimize, cooperative service/controlled-peer closure and10-second stable
reference upload with the source available. Normal foreground return retains
row/64KiB prefix; source resumption completes the whole4MiB SHA-256. Active
states use fresh native accessibility/screenshots; two UIAutomator idle-capture
timeouts stay failed with separate ordinary owned cleanup. Package identity
and persisted grant identity/modes/time remain; normal Keep data/Back/Shutdown,
exact owned removal and zero tab/window cleanup pass. The empty selected folder/
grant remain, notifications stay denied and settings are untouched. A brief
source pause after hidden observation supports the return screenshot; no enabled-
background completion/hour, sleep/reboot/device network-loss or upload claim.

Slice040 passes exact original-signed A7 x64 DMG standard copying on ARM
with existing Rosetta: read-only source/copy strict/deep signatures and detach,
independent thin-x64 app-archive/main hash comparison, eight migration assertions/
nine refusal routes and native zero-exit/reopen with four records. Actual native
statistics opt-out persists independently. Inherited scoped file/type/mode/size/
hash trees restore; owned staging/captures/server are removed, VM off and claim
released. No updater activation occurs. Physical Intel, Finder drag/drop and
architecture crossover remain unrun. Actual screenshots retain JSTorrent
branding; narrow Status/detail-tab clipping and OS overlays are recorded.

Slice038 passes actual Play-managed code27 partial4MiB recovery on B.
Independent64KiB prefix survives task/service-absent force-stop and source-paused
cold Live reopen; restoring the controlled source completes the whole expected
SHA-256. Three completed paused force-stop/cold Live reopen repetitions preserve
file hash, package identity and persisted SAF grant identity/modes/time. Normal
Keep data/Back, empty library, Shutdown, exact owned file/marker removal,
reference/controller staging cleanup and zero tab/window inventory pass. The
selected empty owned folder/grant remain; notifications remain denied. Earlier
missing-app-start, LAN rate-policy and post-pause counter assumptions stay failed,
with separate scoped cleanup. Pinned libtorrent local peer-class/counter semantics
inform only the reference fixture. No background/hour/reboot/upload claim follows.

Slice037 saves and reload-verifies four conservative Web Store draft data
categories: local resettable identifier, authentication, usage activity and
website content. Five other categories, remote-code choice, existing three
certification values and policy URL remain unchanged. No submission or
publication occurs; final owner certification and accurate public policy
remain open. Slice036 observes the actual published1.1.1 official listing and
its ARC-data/notifications/native-application permission prompt, canceled
before installation. The old-store/new-managed pair awaits the concrete
installation-access answer; all B tabs/windows close after this preflight.

Slices034/035 inspect actual physical extension inventories: B has no
JSTorrent extension; A has unpacked1.1.1 under the production ID and stale
unpacked Beta0.4.0 with retired branding. Neither proves installed-store
continuity. Installed extensions remain unchanged for mixed-version work.
Cleanup corrects browser session restoration: individually close tabs with
verified input focus and decreasing actual page counts before windows. The
common targets projection omits type; its entries still represent pages.
After nine B tab closures and one A tab closure, independent normal Chrome
relaunches each expose only one new tab; those tabs also close. Original
window-only and shelf-focus failures remain distinct from the final empty
inventories. DEVELOPMENT.md records the durable cleanup procedure.

Slice033 qualifies actual Play-managed code27 controlled1MiB magnet/file
confirmation, independent payload SHA-256 and three normal populated paused
Shutdown/reopen repetitions with persisted SAF identity/modes/time and package
identity retained. Keep data removes the torrent but leaves its detail route
showing Torrent is no longer available; this navigation polish is recorded.
The original runner stays failed at its auto-navigation assumption. Separate
ordinary reopen verifies empty library and retained hash; normal Shutdown,
exact owned file/marker removal and seed/window/tab cleanup pass. The empty
selected owned test folder/grant deliberately remain. Notifications stay denied;
background/hour/upload/reboot and populated old-store migration are unqualified.
Original runner failures and scoped recoveries remain separate ignored receipts.

Slice031 passes actual Play-managed code27 system-picker cancellation and three
normal Shutdown/reopen repetitions on an empty B library, retaining exact
identity/grants and closing every window/tab. Two observed Back actions cancel;
the original one-Back runner assumption remains failed with cleanup preserved.
The native setup cards and system Download-root restriction are reviewed.
Population/reboot and other physical cohorts retain their own requirements.
Slice030 freshly verifies all VMs off/claims available and the private updater
root/drop-in absent, with unchanged ordinary routes and five private-route404s.

Slice028 passes exact signed a7 ARM DMG standard bundle-copy installation,
eight migration assertions/nine refusals, ordinary zero-exit/reopen, independent
ARM binary comparison and persisted statistics opt-out. Read-only mount,
staging/captures/server and inherited scopes restore; VM off/claim released.
Finder drag/drop and physical Intel remain separate. Native key receipt receiver
metadata reports Finder despite confirmed target activation; process joins
provide the exit evidence without a stronger focus claim.
Slice029 records the actual store's three retired-interface screenshots and
the current light Torrents/Library/dark Torrents proposal, visibly labeled Demo
data. No cloud graphic replacement or submission occurs in that review.

Slice024 passes exact a7 Intel-app ordinary GUI HTTPS updating under existing
Rosetta on the ARM VM: ten assertions/nine refusals, four records, native
Cmd-Q/reopen, independent privacy persistence and exact scoped restoration.
Owned staging/captures/server and private trial are removed; VM off/released.
Thin x64 old/new binaries are independently verified; physical Intel hardware
and DMG installation are separate. Initial ARM-pin/pre-fixture cleanup failures
remain preserved, with independent inherited-state and staging absence proof.
Slices026/027 save and reload-verify only the Web Store draft explanation and
description text. Existing privacy categories/certifications/screenshots and
public versions are unchanged; final reconciliation/submission remain open.

Tactical [290](../tactical/290-windows-installer-brand-artwork.md) corrects the
actual Windows NSIS generic artwork with original JSTorrent icons and blue/navy
welcome/header assets. Pinned schema/bitmap checks and26 release/trust cases pass;
actual non-installing native previews cancel normally with50-registry/seven-file
preservation and VM-off/release. Slice025 clearly distinguishes its presentation
harness from the signed a7 installer. Fresh original-signed Windows packaging
and focused installed/updater requalification remain required for these new
source inputs; old signed receipts retain their scope. No delivery occurs.

Slice017 passes exact A7 Mac ARM ordinary GUI HTTPS updating from released
unmodified0.2.1. Actual Install & Restart, ten assertions/nine refusal routes,
four-row native Cmd-Q/reopen, reverification, one marker and preservation pass.
Native screens/privacy input and independent persisted opt-out are reviewed.
Inherited scoped trees restore exactly; owned staging/captures/server, VM-off/
claim-release and private trial cleanup pass. Intel/DMG drag/drop stay separate.

Slice007 corrected attempt4 passes actual wrong-signature rejection, unchanged
old executable and valid A7 retry, eleven assertions/installed refusal routes,
four-row native Quit/reopen and source/payload preservation. Fresh native focus/
hover observation uses the resident-declared move operation; independent privacy
state,50-registry/seven-file restoration, owned cleanup/off/release and trial
removal pass. Three earlier runner failures remain failed and restored. No
product bytes change; the evidence does not claim one cause for every failure.

Tactical289 completes the prepared successor website's No Play Store recovery:
AppImage, best-effort Linux support, headless setup explicitly from source and
separate Android/Linux libraries replace legacy daemon instructions only when
curated production metadata is enabled. Actual disabled answer/links remain
unchanged. Fresh builds,24 guards, tracked docs and three-width screenshots pass;
separate ignored slice015 records the before/after. No public deployment occurs.

Slice010 passes exact A7 Linux x64 AppImage automatic delivery from released
unmodified0.2.1 over the private HTTPS trial on Ubuntu24.04 extract-and-run.
Ten assertions/installed refusals, four imported rows, native tray Quit/reopen,
actual JSTorrent screens and independent statistics opt-out pass. Inherited
scopes restore; owned guest/controller staging and capture copies are removed,
VM off/claim released and trial disabled with ordinary routes unchanged. The
finished transient unit is already absent at cleanup (stop exit5). FUSE, ARM,
older distributions and the ordinary old GUI remain separate best-effort scope.

Slice009 passes exact A7 Mac ARM automatic delivery from released unmodified
0.2.1 over the bounded private HTTPS trial. Ten assertions/nine refusal routes,
four imported rows, payload reverification and native Cmd-Q/reopen pass. Actual
JSTorrent screens and statistics opt-out are reviewed; independent SQLite and
inherited scoped restoration verify. Owned staging/captures and transfer server
are removed, VM off/claim released, trial disabled with ordinary routes unchanged.
Slice017 now passes the ordinary Mac GUI; Intel and DMG drag/drop stay separate.

Tactical288 locally corrects initial website fragments after client-only
Download hydration, sticky-header spacing and320px header/release-note/FAQ
presentation. Nine actual before/after views and fresh enabled/disabled builds,
24 inventory guards, focused formatting and tracked docs pass. The real
production descriptor stays disabled; no public deployment occurs. Tactical289
owns the remaining successor No Play Store FAQ's legacy daemon guidance.

Slice008 corrected attempt2 passes actual interrupted-download preservation
and ordinary old GUI Install & Restart to exact A7. Eleven assertions/eight
refusal routes, four records, native Quit/reopen, reverification, one marker and
source/payload preservation pass. Visually reviewed statistics opt-out persists
independently. All50 registry/seven file scopes restore exactly; owned cleanup,
VM-off/claim-release and private trial removal pass. The original failed attempt
and separate exact recovery remain preserved; product bytes stay unchanged.

Current checkpoint259 also qualifies the bounded live private updater selection
and verified removal, with unchanged ordinary routes. Released Windows0.2.1
automatically authenticates/installs exact A7 NSIS and passes native migration/
restart/restoration/off/release. Signature-failure retry attempts preserve their
runner failures and passing cleanup; corrected signature/interruption retries
now pass as recorded above.

Current checkpoint259: frozen a7 original-signed desktop five-target build and
main CI pass; bounded D-01/D-02/D-03 identity/signature contracts close. Actual
Mac ARM/Linux x64/Windows x64 NSIS manual migration/restart and signed native MSI
manual-update presentation pass with scoped restoration/off/release. Play27 is
available only to existing internal testers; one actual Play26-to27 install
preserves identity/grants and now passes bounded normal Shutdown/task/service
closure and Live reopen after actual statistics opt-out. Populated-library and
reboot acceptance remain separate.
Exact extension1.1.2 draft upload now succeeds on the existing item; actual
package tables confirm draft1.1.2 and unchanged published1.1.1. Submission and
publication remain separate. Full installed/store/security/source/relink and shipment disposition
remain open. The historical candidate checkpoints below retain their own scope.


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
distro WebKit backport campaign, and CLI/headless fallback. Tactical285 locally
applies production AppImage-only packaging on Ubuntu24.04 with a reviewed
WebKit build floor. Fresh signed/runtime/source and native evidence remain
required. Broader
Linux historical rows are scoped by this decision, not marked passed; final
candidate security, source obligations and representative installed checks
remain open. See the [accepted scope](product-direction.md#linux-release-scope-accepted-2026-10-09).

The locally qualified candidate source is03e63443. The full default bundled
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
upload/draft save/certification/submission occurs. Frozen03e push/nonpublishing
signed-build review supersedes pending681/b0b/932 proposals; explicit action
instruction remains pending. D-01/D-02 reopen for changed final package inputs;
immutable source8c signature/identity evidence remains valid for its own bytes.

Tactical [280](../tactical/280-desktop-executable-display-brand.md) locally
corrects the desktop output to `jstorrent-client`, preventing the observed
advanced-firewall filename from retaining the old display brand. The distinct
name preserves released old-writer process detection. All41 Node/23 native
distribution/85 Rust cases, clippy/fmt/workflow lint and the actual unsigned
Mac bundle/inventory pass. Identifiers, host, profiles, networking and updater
trust/routes remain intact. Fresh signed Windows system-label, migration and
updater evidence remains required under259; source8c receipts are unchanged.

Topic: `product-surfaces-and-migration`


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

Final ARM Mac DMG read-only mount/signature/normal bundle installation also
passes the eight/nine native migration/restart/restoration checks. Final signed
Linux x64 AppImage passes eight assertions/six refusal routes with readable
settled/restart branding, preserved bytes and exact owned cleanup/off/release.
Automatic/GUI updates and broader native installed cohorts remain open.
The rejected-login Windows x64 appliance rebuild is explicitly authorized and
delegated; actual cold login and canonical private credential handoff are
required before native product qualification resumes.

Final signed x64 Debian actual installation also passes eight migration/six
refusal checks, readable native restart and exact owned package/cache/profile
restoration, with VM off/claim released. Normal launcher/updater gates remain.

Final signed x64 controlled native launch also passes twelve scoped cases,
including all launch intents, owned OS associations/Unicode, one-owner races
and stopped-after-Quit behavior, with exact cleanup/off/release. Inherited
pins, content intake and browser/store updating remain separately open.

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

Tactical [258](../tactical/258-cross-surface-branding-and-design-audit.md)
completes the user-directed cross-surface display-brand audit. JSTorrent copy and
original assets now cover iOS/system labels, mobile headers, extension/Linux
onboarding, gateway and bootstrap fallbacks, support exports and website.
Desktop incubation packages display **JSTorrent Preview**; artifact staging
follows that filename while internal product selectors, identifiers, endpoints
and trust roots remain intact. Local native/build/render evidence and remaining
store/installed-platform gates are recorded in the
[audit execution record](../tactical/258-cross-surface-branding-and-design-audit.md). This changes no
publication, deployment, migration or production identity decision.

Tactical [257](../tactical/257-play-upgrade-and-fresh-signed-candidates.md)
adds bounded physical Play 1.0.23-to-1.0.25 standalone migration evidence.
The [receipt](../evidence/android-play-upgrade-257.json) records retained rows,
independent bytes, setting/grant continuity, conservative recheck/resume and
restart, plus cleanup limits. This leaves the broader installed matrix open.
Current-source f5860c99 signed desktop 0.3.0 on all five targets and Android
1.0.26/code 26 pass original-root signing/package validation and independent
artifact verification. Code 26 corrects the observed internal release label.
The tactical links exact receipts. Fresh package evidence retains 252's earlier
installed desktop source/hashes; code 26 is not Play-uploaded or installed
through Play. Code 25 remains internal, code 23 remains production, and feeds
and Web Store are unchanged.

Tactical 253's accepted Linux connection update uses
`http://jstorrent.localhost:3030` as its primary browser address, avoiding the
Baguette DNS-registration failure without moving the engine, library or files.
The dedicated localhost name separates its host-only cookies from ordinary
localhost applications. Update the preview Linux package and extension together;
old-host bookmarks and browser-local approval/appearance are not migrated.
No automatic Android switch, legacy-host fallback, cookie transfer or new proxy
is added. Both physical x86_64 cohorts pass bounded browser download/restart;
cohort B additionally passes the installed launcher. Production/store identity
and distribution gates remain separate.

Tactical [255](../tactical/255-android-play-internal-replacement.md) completes
the authorized Android internal Play release on 2026-10-04. The original upload
key matches Play and the retained public certificate; the existing CI inputs
are corrected. Local source `42a11817` produces validated 1.0.25/code 25 APK/AAB
with both ABIs, 116 passing release JVM tests and passing lint. Play reports the
replacement **Available to internal testers** on the existing `com.jstorrent.app`
property. Production remains 1.0.23. This supersedes the Android signing blocker
in the historical 251 account below; broader Play cohorts and production cutover
remain open. See the [artifact and publication receipt](../evidence/android-play-internal-255.json).

Tactical 253 is active. Portable pre-connection troubleshooting, manual
Retry/Cancel, explicit Linux choice and private-context preview pass focused
ownership tests, six injected Android and ten injected Linux packaged-browser
journeys, plus real HTTP-cache replacement. Android/Crostini
libraries remain separate, with no inferred store/policy diagnosis or automatic
switch. Exact host-built candidates pass bounded cohort-A Android and Linux
runtime evidence, including three recovery repetitions per host and both
controlled 60-minute byte-verified observations. Owned test state is restored.
Normal Terminal startup restores Linux registration after the earlier failed
administrative LXC session. The isolated current Linux browser connects, verifies
real file-picker intake and retains the completed row/bytes after VM restart
with the source offline. Full physical acceptance remains open. Cohort B is now
reachable and adds an inherited Play baseline, isolated Android/extension flows
and a fresh Linux setup with the signed public preview. Its registered launcher starts a healthy
service, but normal VM restart does not resolve the Linux hostname-registration
failure. Current signed candidate delivery, real fresh Play/store pairs and
full lifecycle gates remain open. Cutover A-06/07/08 remain unchecked.

Tactical [251](../tactical/251-jstorrent-ci-candidates-and-installed-update.md)
completes bounded production-identity CI attempts using existing signing inputs,
with nonce identity proof, exact product receipts and retained-public-root
signature verification. Automatic incubation publication is paused; candidate
builds cannot publish. The successor update-service descriptor is prepared but
its live routing/feed is unchanged. Signed installed updating remains unqualified
until the exact candidate authenticates and an owned old-release guest passes.

The initial CI signing proof fails against JSTorrent's retained public root and
verifies against the incubation root. That attempt required original inputs.
Controlled update-service routing and an old macOS app's unchanged-endpoint
check pass; no successor download/install/relaunch is yet qualified.
Windows and both Linux package lanes pass, and Android passes signed build/tests/
lint before original-certificate refusal. Fresh macOS notarization initially
fails Apple's team agreement gate; the recheck below passes. Ordinary CI
passes all executed jobs; the controlled CI-bundle handoff stops before import.
The maintainer-supplied original desktop key is now provisioned. Fresh CI nonce
proof passes JSTorrent's root with the existing password unchanged. Windows/Linux
package lanes and eight independently checked original-key signatures pass.
Android signing, complete same-attempt collection and authenticated installed
updating remain open independently.

Fresh attempt 2 of run 36831643488 now passes both macOS jobs: Apple accepts
both apps and outer DMGs, with no DMG issues; signing, stapling and Gatekeeper
checks pass. The agreement error is no longer blocking CI. The collector refuses
the failed-only retry because it has only two current-attempt legs. Fresh complete
non-publishing run [36845370571](https://github.com/kzahel/rstorrent/actions/runs/36845370571) now passes at the same
source SHA: all five lanes, exact release collection and all ten original-root
updater payload signatures. See [Apple recheck evidence](../evidence/jstorrent-ci-candidate-251-apple-recheck.json). Complete candidate collection passes;
installed migration remains open. No production feed/store change is made.

Accepted [252](../tactical/252-jstorrent-opt-in-upgrade-rehearsal.md) records a
test-only cohort on the existing HTTPS updater URL, using the old release's
already-sent installation ID and a pinned candidate. Implementation and private
deployment review precede any external change; ordinary production selection
stays unchanged. It is a real update inside an owned guest, with actual legacy
writers and source/settings/root/payload/restart assertions, not a feed check.

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
Windows x64 automatic and ordinary GUI updating now pass, as do signature
refusal and interrupted-download retries. Exact installed bytes/publisher and
uninstaller continuity, migration/restart and file/registry/firewall restoration
pass. The one-ID trial is disabled; eight ordinary response comparisons and five
asset GET refusals pass. The old Linux release
renders blank in this VM under three tested configurations, leaving its ordinary
UI path open. Controlled repair and real extension journeys remain open. Native catalog branding is corrected after
the candidate source and needs a fresh signed build.

Slice046 completes actual Play-managed27 background evidence: ordinary OS
Minimize keeps the controlled partial transfer detached for3,601.75 seconds;
all118 samples retain the foreground service/peer and advancing payload. The
whole40MiB file independently hashes while hidden; stop-at-completion removes
the service, and normal foreground return shows the complete row. Original
post-hour runner failure (Pause content-description missed by text-only lookup)
remains failed; independent normal Pause/Keep data/removal, Power restoration,
Shutdown and scoped files clean up. Normal OS UI restores the original denied
notification permission. Exact persisted grant/empty selected root remain;
zero tabs/windows verify. Separate report preserves both failed assumptions
and scoped passes. Physical sleep/network loss/reboot/background upload/store
delivery remain unrun. Four390/1200px report checks pass and reap their browser.


Slice051 completes managed27 foreground upload: an owned4MiB trackerless
fixture independently hashes, its original source/listener closes, and a
separate controlled leecher receives all4,194,304 bytes with the correct whole
SHA-1 through the owned ADB/SSH forward. The actual listener is observed via
normal Network settings. Original Incoming connections/denied notification
preferences, package identity and exact persisted grant remain. Normal Pause,
Keep data/removal and Shutdown clean up the row/file/marker; forwarding,
controller temporaries/source are reaped and zero tabs/windows verify. The
selected folder remains empty. Separate screenshot report records clear styled
notification guidance and awkward wrapping of the long fixture name. Four
390/1200px report/index checks pass and reap the bundled browser/server.
This is foreground upload, not background upload/network loss/reboot/store
update delivery.


Slice052 completes exact draft1.1.2/Play-managed27 physical pairing: normal
optional ARC permission deny/retry/allow and native reject/retry/approve pass.
An independently verified1MiB native row appears in Chrome; browser Pause is
observed natively. Normal Shutdown removes the service, and Retry remains
attach-only. Normal app relaunch/retry retains approved pairing, paused row and
whole hash with the source offline. Package, exact SAF grant and original denied
notification permission remain; owned row/file/installation/staging are removed
and all tabs/windows close. Normal companion opt-in/approved digest remain by
design: there is no normal disable/unpair UI; no private reset/edit is used.
First-use privacy below the fold, second Connect after Allow, inherited duplicate
chooser labels and encoded uninstall title are recorded. The opt-out uninstall
URL includes only version. Failed picker/capture/cross-surface driver assumptions
are preserved; package-scoped native actions pass. Four390/1200px report checks
pass and reap the browser/server. Tactical291 separately fixes the observed
Shutdown instruction/link contrast in1.1.3; actual repeat passes under055,
while store update remains open. No store delivery, reboot/network loss or background upload claim.


## Production Candidates, 2026-10-01

Tactical [250](../tactical/250-jstorrent-production-identity-candidates.md)
prepares explicit production candidates: desktop `com.jstorrent.desktop`
0.3.0 with the existing updater public root/route, Android `com.jstorrent.app`
1.0.25 (code 25) with the original public upload certificate and launcher
alias, and extension `dbokmlpefliilbjldladbimlcfgbolhk` 1.1.2. The desktop
runtime selects its updater by package identity and admits both exact reviewed
extension origins; generic gateways retain their configured origin boundary.
Normal desktop/Android debug builds and optional beta extension packaging stay
isolated. No private signing material is committed or transferred, and no
update service, store item, physical app or personal profile is changed.

The [full cutover checklist](../jstorrent-cutover-checklist.md) owns delivery,
installed migration, staggered updates and recovery acceptance. Checked-in
versions exceed the pinned sources, not yet authenticated store maxima. Original
private-key availability, Play signing, signed installed delivery, same-ID browser
updates and legacy launch routes remain explicit gates. Minimum API 28
(Android 9) is selected on 2026-10-01; API 26/27 installations are outside the
replacement cohort and need explicit unsupported-device guidance. Candidate
mechanics do not graduate the product for shipment.

The destination is one JSTorrent shipping lane. Original signing inputs are
already in use and desktop 0.3.0 is public. Incubation publication is frozen
under the 2026-10-11 policy above, rather than temporarily paused pending key
provisioning. Normal isolated debug builds remain useful after succession.

## Production Replacement And Branding

Maintainer direction on 2026-09-30 selects a near-term in-place JSTorrent
replacement, superseding the earlier foreseeable independent RSTorrent product
line. The production desktop retains `com.jstorrent.desktop`, JSTorrent's Tauri
updater public trust root and update channel; the existing private signing key
is supplied through release infrastructure, never source control. Android ships
as an update to the existing `com.jstorrent.app` Google Play app with signing
continuity and a higher versionCode. The successor extension updates the existing
production Web Store item, preserving its ID and host origin admission.
These are three independently delivered updates under the staggered contract
below, rather than a required synchronized release.

The successor uses the JSTorrent name and established blue-box icons before
cutover. A focused design refresh preserves familiar torrent lists, details,
folder selection and extension/native views of one library. Tactical
[249](../tactical/249-jstorrent-brand-and-extension-refresh.md) starts that work.
Internal crate/protocol names and separate incubation package IDs need not be
renamed. Signing/store continuity and exact production packaging remain release
qualification gates; source branding alone does not prove an installed update.

## ChromeOS Android Cutover Contract

Maintainer direction on 2026-10-09 selects a good-faith staggered rollout:
submit store candidates with publication held, make desktop/Android updates
obtainable, then publish the extension. Mixed versions remain expected after
publication. Recovery names the component to update when known, offers a
relevant link and explains native use while waiting; unknown connection
failures must not masquerade as confirmed version mismatches. The short
[scenario checklist](../jstorrent-update-scenarios.md) owns the walkthrough
and source-reviewed copy gaps; exact installed/store checks remain under259.
This direction does not itself authorize store submission or publication.

Maintainer direction on 2026-09-30 accepts independently staggered extension
and Android updates. Crostini automatic legacy migration is outside this
cutover. Android remains the sole successor engine, catalog and SAF owner;
the extension becomes a detachable client of that library.

| Installed extension | Installed Android app | Required outcome |
| --- | --- | --- |
| Legacy | Legacy | Existing companion behavior continues. |
| Successor | Legacy | Terminal Android-update requirement; no legacy engine, pairing or raw I/O fallback. |
| Legacy | Successor | Android imports and operates independently; old extension control is unavailable until updated. |
| Successor | Successor | Connect to the migrated Android library after migration completes; approve fresh pairing when required. |

Pinned legacy Android 1.0.24's extension routes session and shared configuration
KV through the companion into Android's `jstorrent_kv.db`, which the existing
atomic Android importer consumes. Its engine runs in the browser but its normal
connected library persists in Android. Browser-local fallback and releases
before remote KV routing need separate historical qualification; this is not
an all-historical-extension migration claim.

Migration must finish before successor companion admission. Keep source files,
payload and grants; current latest-format destination owners win and duplicate
torrents do not fail the import. No old verified-bit authority, credentials,
cross-app library copying or per-record migration ledger is introduced.

Android explains that the library is available there and extension control
requires an updated extension. The successor extension distinguishes a
recognized legacy Android service from an unavailable service, and presents
an explicit update/retry path. Very old extensions can retain their existing
connection error; a legacy-extension guidance release is helpful but optional.
Correctness cannot depend on receiving an intermediate extension release or
on which store updates first. Signed/store delivery and production identities
remain separately qualified release work.

Tactical [248](../tactical/248-chromeos-staggered-upgrade.md) owns bounded
compatibility presentation and the extension-driven installed rehearsal.
That controlled checkpoint passes on owned API 28/35 emulators: the actual
released extension writes the Android source, the installed upgrade preserves
settings/torrents/SAF access, mixed pairs settle as above, and fresh successor
pairing controls the same migrated owner. It does not qualify physical/store
replacement, actual production extension identity updates or browser-local
historical libraries.

Tactical [246](../tactical/246-android-legacy-import-and-installed-upgrade.md)
implements Android best-effort import and a controlled installed replacement
runner using the actual pinned released APK, a disposable shared certificate
and real SAF selection. Unsupported VPN/battery/plugin settings are dropped
by explicit maintainer direction; gaps remain recorded for cutover planning.
Production signing/branding/store delivery and extension rollout remain separate.

Tactical [245](../tactical/245-android-legacy-inventory-and-import-contract.md)
starts Android migration with a pinned Android 1.0.24 APK/source inventory,
13 generated format cases and the importer/upgrade contract in
[android-jstorrent-replacement](android-jstorrent-replacement.md). There is
one Android source session, with SAF and explicit private-download bindings.
Tactical 246 now owns importer and controlled package/grant upgrade evidence;
the accepted temporary ChromeOS extension-control gap remains separate.

Maintainer direction on 2026-09-30 simplifies the production transition:
replace JSTorrent desktop through its existing branded update and import into
a fresh successor catalog or an existing latest-format RSTorrent profile.
Existing torrents/settings win; matching legacy torrents are reported as
already present while distinct records continue importing. Older RSTorrent
profile conversion, field merging and a general conflict-resolution UI are
outside this allowance. The new
extension may require users to update JSTorrent desktop, without maintaining
the legacy engine/IO protocol. Temporary loss of Chromebook extension control
of the Rust Android app is acceptable with clear guidance to use Android's
own UI; restoring it and migrating Android state need not block desktop.
These decisions supersede uninterrupted companion continuity as an initial
rollout gate, while retaining the native-owner architecture and the existing
companion implementation. Exact release/store order remains open. The
[desktop replacement topic](desktop-jstorrent-replacement.md) owns the contract.

Tacticals 241/242/243 implement atomic desktop import and production-only
retirement of managed legacy native-host routes, with bounded installed macOS,
Windows NSIS and Linux AppImage checkpoints. Incubation identities remain
separate. Tactical [244](../tactical/244-unavailable-storage-presentation.md)
corrects blocked-storage presentation in shared React with deterministic
evidence. Signed production delivery and settings/privacy/support dispositions are graduation
work; no personal migration or production rollout has run.

Tactical [`234`](../tactical/234-desktop-user-intent-and-background-lifecycle.md)
owns the accepted desktop lifetime follow-up: retain the tray/status-bar icon
while the runtime runs, including idle/paused states; browser closure only
detaches. Fresh toolbar, Start, or OS torrent-input intent may relaunch after
Quit; page restoration, worker wake and retries only attach. Tray Open and
OS magnet/file delivery always use the native window. No preferred surface,
browser-profile routing, icon-hiding or automatic completion shutdown is added.
Installed macOS/Windows/Linux debug builds pass the bounded lifecycle
checkpoint: browser closure during a verified transfer, 64 reload/worker-stop
cycles, actual tab discard, explicit relaunch and passive no-resurrection.
Desktop disconnect retires only that client's abandoned view sets before
admitting a replacement; native views and other transports retain their owners.
Broader endurance and installer/update compatibility remain open.

Maintainer direction on 2026-09-28 starts desktop-first JSTorrent migration
planning and test design. The source survey, proposed data/support contract,
extension transition matrix and Machine Control rehearsal sequence now live in
[`desktop-jstorrent-replacement.md`](desktop-jstorrent-replacement.md).
This supersedes the historical statements below that migration planning is
not current work. Tactical [241](../tactical/241-atomic-legacy-desktop-import.md) now implements
the bounded atomic native desktop import and dormant production startup hook.
Installed legacy replacement and production rollout remain separate gates.
Follow-up direction the same day selects familiar user-experience continuity
as the North Star and desktop extension control as the first focus. Working
campaign [`231`](../tactical/231-jstorrent-migration-working-campaign.md)
tracks the rehearsals; planned slice
[`232`](../tactical/232-desktop-extension-control.md) owns desktop control.
Further direction the same day retires desktop multi-profile behavior:
migration unions all legacy desktop profiles for the current OS user into one
library. Extensions are clients of that desktop runtime, regardless of browser
profile; no source-profile chooser or successor desktop profile switching is
planned. The desktop replacement topic owns duplicate/conflict dispositions.

Tactical [`230`](../tactical/230-desktop-stable-latest-update-channels.md)
keeps RSTorrent's incubation app identity and updater trust root while adding
two desktop update channels. It does not change the eventual JSTorrent
graduation identity, route, or key.

Status: The host/client model, ChromeOS choices, and desktop extension
direction were accepted in product discussion on 2026-08-02. This topic
records graduation direction, not standing authorization for production
remote control, legacy migration, or extension-hosted control. Exact
unimplemented transports and security boundaries remain to be designed and
validated in bounded tacticals. Maintainer direction on
2026-08-09 accepts iOS as an eventual first-party in-process host; Tactical
[`116`](../tactical/116-platform-storage-coherence-and-ios-feasibility.md)
front-loads the physical storage/network/lifecycle feasibility that shaped the
common engine boundary. Explicit direction on 2026-08-13 schedules the first
maintained SwiftUI product in Tacticals `147`--`149`; that campaign is complete
with qualified external folder selection and physical lifecycle evidence,
without migration or publication.
Maintainer direction on 2026-08-22 starts the independent beta distribution
campaign in [`beta-release-readiness.md`](beta-release-readiness.md). That
campaign does not implicitly authorize legacy JSTorrent takeover, extension
work, or semantic import. Direction on 2026-08-23 records only the broad later
goal: a proven RSTorrent implementation may graduate through JSTorrent's
existing desktop identity and updater channel, with best-effort state migration
scoped at that time. This supersedes the earlier detailed import posture and
does not make migration planning current work.

Explicit maintainer direction on 2026-08-26 authorizes only the bounded
desktop-bootstrap foundation in Tactical
[`166`](../tactical/166-desktop-native-bootstrap-and-extension-scaffold.md): a
distinct typed compatibility/launch host, per-user registration and sidecar
packaging, and a store-seed MV3 extension. That bounded foundation is complete
after exact-ID installed Chrome `hello` and cold-launch evidence. It does not
choose the later headless service, full extension control, or Crostini
topology.

Subsequent maintainer direction on 2026-08-26 selects the first Crostini
product slice in Tactical
[`167`](../tactical/167-chromeos-crostini-bundled-web-launcher.md). The
Crostini package serves the mature React application with its Rust host;
the extension owns cold handoff, warm open/focus, setup, and later browser
integration rather than carrying the initial full UI bundle. A future
extension-hosted client remains possible but is not required for the
first ChromeOS Linux path. That bounded slice is complete after source gates
and the available physical Chromebook warm, twice-stopped-VM,
detachable-transfer, preservation, and purge matrix. Full reboot remains a
conditional gap because the testbed has no approved profile-login credential.
Completed platform-polish Tactical
[`168`](../tactical/168-platform-aware-extension-launcher.md) then makes the
extension choose platform-relevant launch surfaces. ChromeOS explicitly offers
the currently published JSTorrent Android app and the RSTorrent ChromeOS Linux
preview as separate data authorities; desktop systems retain only their native
bootstrap. The extension does not infer Play enablement or Android-app
installation.

Completed Tactical
[`169`](../tactical/169-hosted-crostini-bootstrap-and-release.md) adds the
bounded next distribution step: a website-hosted bootstrap, signed canonical
manifest, and native x86_64/ARM64 `crostini-v*` release workflow using the
existing RSTorrent beta trust root. Its physical x86_64 signed-fixture package
repair and fail-closed matrix pass. Subsequent explicit release authorization
published non-latest `crostini-v0.1.0`, deployed the pinned website bootstrap,
and passed independent public-asset verification plus the exact website
install, Launcher, and stop/relaunch path on the physical x86_64 Chromebook.
The native ARM64 package passes hosted build and archive gates without a
physical ARM64 runtime claim.

Maintainer direction on 2026-08-26 additionally accepts first-class headless
Linux as a product composition: one native service owns its profile and engine
without Tauri or a graphical session, while the host-served React UI and
later authenticated remote clients attach as detachable clients.
[`runtime-configurations-and-headless-deployment.md`](runtime-configurations-and-headless-deployment.md)
owns that runtime, service, listener, authentication, and reverse-proxy
direction. Configured Linux headless-service Tactical
[`170`](../tactical/170-configured-linux-headless-service.md) completes the
first implementation slice with one ordinary-user systemd service, detachable
React clients, strict hosted access, and data-preserving package
lifecycle. Completed signed headless release and trusted-LAN Tactical
[`171`](../tactical/171-signed-headless-release-and-lan-service.md) adds strict
signed source update machinery, one exact no-credential private-LAN mode, and
an enabled healthy current-host x86_64 deployment. No public headless channel,
physical ARM64 service, owner remote cryptography, or relay is claimed.

Explicit maintainer direction on 2026-08-30 selects ChromeOS Android
extension control as migration-critical release-parity work in active Tactical
[`194`](../tactical/194-chromeos-android-extension-control.md). It preserves
the familiar JSTorrent launch, pairing, dense browser presentation, and
background-service journey while reversing the old ownership: Android retains
the only Rust application service, engine, profile, networking, hashing, and
SAF authority; the extension is a detachable typed client. The same
React root action used with Crostini invokes Android's SAF picker, and retained
grants keep earlier torrents on their original roots when a new root becomes
current. This is workflow continuity, not legacy-state import, a raw IO
daemon, a public remote API, or production-extension publication.

Explicit user direction on 2026-09-01 further clarifies the succession goal:
useful JSTorrent product behavior is not discarded merely because RSTorrent
replaces its technical implementation. Implementation-complete Tactical
[`208`](../tactical/208-installation-metrics-and-feedback-parity.md) therefore
preserves the resettable installation identity, coarse local counters,
feedback context, and extension-uninstall survey as deliberately disclosed
product capabilities. Optional richer query fields remain release-disabled
pending deployed hosted-page verification. The work does not import
historical metric values, authorize continuous analytics, or make graduation
current work.

## Scope

This topic owns the product shape that separates a native engine host from the
UI used to control it, the resulting desktop and ChromeOS configurations,
the eventual iOS host shape, launch and handoff requirements,
host-visible state ownership, and the initial migration posture from
current JSTorrent installations.

It complements:

- [`../project-history.md`](../project-history.md), which records the
  JSTorrent succession and its graduation evidence;
- [`product-direction.md`](product-direction.md), which owns engine and
  platform constraints;
- [`client-surfaces.md`](client-surfaces.md), which owns the currently
  implemented browser, Tauri, and Android client adapters;
- [`application-control.md`](application-control.md) and
  [`application-view-api.md`](application-view-api.md), which own the semantic
  command and recoverable view contracts; and
- [`client-persistence.md`](client-persistence.md), which owns the typed SQLite
  authority and verified resume invariants; and
- [`runtime-configurations-and-headless-deployment.md`](runtime-configurations-and-headless-deployment.md),
  which owns visible, background, windowless, and headless runtime
  compositions plus their deployment configuration.

This topic does not select the final public name or domain, duplicate the
platform release sequence now owned by `beta-release-readiness`, expose the
native engine as a general-purpose third-party daemon API, or make product
migration an implicit beta requirement. The accepted first-party Linux
headless service remains a product host around the same application service,
not a peer, filesystem, or payload proxy.

## Product Model: Host And Client Are Separate

The product should distinguish the process that owns torrent state from the
surface through which a user views and controls it.

A **host** owns one application-service instance, its profile database,
torrent engine, peer and tracker networking, hashing, scheduling, storage
capabilities, and background lifecycle. A **client** attaches as a
detachable UI using application commands, snapshots, diffs, and events.
Closing or replacing one client must not silently create a second engine
or transfer profile ownership.

The web client retains substantial JavaScript and TypeScript heritage.
That is intentional. Rust ownership of the engine hot path does not require
removing the browser technology that makes JSTorrent's detailed interface and
browser integration valuable.

The accepted product invariants are:

- peer sockets, tracker and DHT work, hashing, scheduling, SQLite, and piece
  payloads remain in the selected host;
- an extension control channel carries bounded semantic commands and
  recoverable views, never raw socket, filesystem, or piece operations;
- every attached UI identifies the exact host instance and profile it is
  displaying;
- UI preferences are client state and do not decide profile ownership;
- more than one view may attach to one host when the host and transport
  explicitly support it; and
- different hosts never imply a shared live database, storage capability,
  or verified-piece authority merely because the same extension can reach
  both.

## Product Configurations

The likely successor has these useful compositions:

| Platform | Host | Client | State relationship |
| --- | --- | --- | --- |
| Desktop | Desktop Rust application service | Embedded Tauri webview | Owns the desktop profile |
| Desktop | Same desktop Rust application service | Browser extension | Shares the desktop profile |
| Linux server | Headless Rust application service | Host-served React UI or authenticated remote client | Owns one explicit server profile and its configured roots |
| ChromeOS | Rust application service in Crostini | Host-served React UI, launched through the browser extension | Owns a Linux profile and roots |
| ChromeOS | Rust application service in the Android app | Browser extension | Shares the Android profile |
| ChromeOS or Android | Same Android application service | Android Compose | Shares the Android host and profile |
| iOS/iPadOS | Rust application service in the native app | First-party JSTorrent SwiftUI presentation adapted to typed RSTorrent models | Owns an iOS profile, app Documents, and qualified selected on-device roots |

ChromeOS therefore has **two hosts and three client
configurations**:

1. Crostini plus extension;
2. Android plus extension; or
3. Android alone through Compose.

The second and third configurations are two views of the same Android host.
The Crostini configuration is a different host with different state and
storage.

The iOS application is another host, not a remote
client of desktop or Android. It runs the first-party Rust engine
in-process and owns its own profile, root capabilities, networking, and
lifecycle. An Apple bookmark or File Provider identity cannot be shared with
Android SAF or a desktop path, and matching filenames do not imply shared
verified state. Tactical `116` tests this shape on a physical device without
choosing the final UI toolkit, release channel, minimum OS, or migration path.
Tactical
[`123`](../tactical/123-ios-on-device-root-persistence-and-recovery.md)
records the former app-owned-only boundary and the evidence that iCloud is
ubiquitous while a separate local folder may return no public provider
identity. Completed Tactical `147` supersedes that product decision: iOS 16+
uses
app-owned Documents plus distinct stable qualified selected roots, rejects
iCloud and positively identified providers, and requires a physical capability
gate when lookup fails. Completed Tactical `148` directly reuses the first-
party JSTorrent SwiftUI presentation; completed Tactical `149` owns finite
background and recovery behavior. Completed Tacticals `152` and `154` add
qualified-root multifile correctness, publication-aware progress, and direct
Apple Quick Look/video presentation of complete files under the existing
scoped lease. None authorizes migration or public distribution.

## Desktop Extension And Embedded UI

The embedded desktop webview is not the only legitimate desktop preference.
Some users, including the maintainer, prefer the extension UI even when a
desktop application is installed. The successor should treat the extension as
a first-class desktop client rather than only a launcher, installation
probe, or reduced integration surface.

The desired desktop ownership model is one desktop host with two
possible web clients:

```text
Tauri webview ---------\
                       >-- desktop application service --> Rust engine
JSTorrent extension ---/
```

When the extension is chosen, native messaging may start the installed desktop
product without creating its webview window, or attach to an already running
host. Opening the desktop UI later should attach a webview to that same
host and profile. It must not start a competing application-service
instance or require the user to take the profile away from the extension.
The preferred successor interpretation is that the native host is a thin
bootstrap and connection surface for the desktop product: **headless** means
the same native application service running without a webview, not a separate
torrent or IO-daemon product.

This is a successor direction rather than a claim about the current JSTorrent
topology. Current JSTorrent separates the extension engine, native host,
profile-scoped KV store, IO daemon, and Tauri application, and exposes
profile-in-use and takeover behavior. That history demonstrates the need for
explicit ownership, but the successor should not preserve takeover as the
ordinary act of switching UIs.

The desktop handoff must eventually define and prove:

- how native messaging finds or starts exactly one host instance;
- how a headless host later creates or focuses the embedded desktop UI;
- how an extension page is opened or focused without duplicating it;
- whether both clients may remain attached simultaneously;
- how update, tray, deep-link, file-association, and shutdown ownership work
  when no webview is open; and
- how stale processes, incompatible versions, and profile conflicts recover
  without presenting an ambiguous takeover prompt.

The current in-process Tauri product remains the implementation and validation
path until an extension-control tactical accepts a different lifecycle and
security boundary. Completed Tactical
[`163`](../tactical/163-desktop-external-torrent-intake.md) adds RSTorrent-owned
`magnet:` and local `.torrent` activation to that current product only. It does
not implement extension routing, reuse JSTorrent identity, or decide the later
successor handoff topology. Installed Linux arm64 and Windows
x86_64-application plus macOS arm64 acceptance pass. The macOS campaign
preserved JSTorrent as the inherited default handler and targeted RSTorrent by
its current incubation bundle identifier. Exact hosted run `32775002484`
passed all eight platform jobs.

Tactical `166` adds only the predecessor seam to that later control work.
Its distinct `com.jstorrent.rstorrent.native` host can identify compatibility
and request launch of the existing desktop application; it owns no profile,
torrent state, listener, or application service. The initial JSTorrent Beta
ZIP established Chrome Web Store item `gcgoepclopkgijmclmlheafaglmbjlcc`; its
public key and exact beta origin are now pinned. The installed Chrome
`hello`/launch smoke passes with Chrome 151 and an installed unsigned macOS
arm64 app: `hello` succeeds while the desktop is stopped, and explicit launch
starts the cold app. Allow-listing the existing JSTorrent extension origin
does not make that extension compatible while it still addresses legacy host
`com.jstorrent.native`.

## ChromeOS Hosts

### Crostini plus extension

Crostini is implemented as a first-class ChromeOS host rather than only an
emergency fallback. The first local x86_64 package bundles and serves the mature
JavaScript/React control surface beside one native Linux process that owns the
Rust application service, database, networking, hashing, and filesystem I/O.
The extension is the Chrome-resident launch, focus, setup, and future
integration surface. It may later host the same detachable React client,
but the initial product does not duplicate those assets inside the extension.

The implementation adapts the proven `web-server-chrome` Crostini pattern:

- an owned, versioned, per-user x86_64 native package;
- an on-demand user service and registered non-terminal ChromeOS Launcher
  entry;
- a small launch helper that can wake a stopped Crostini VM and hand off to a
  dormant extension worker;
- a stable local controller endpoint with capability and version negotiation;
- exact local-host admission and persistent browser-session authentication;
- bundled setup, recovery, and uninstall guidance; and
- a normal host-served tab for routine control with extension setup and
  recovery pages.

RSTorrent adapts that pattern without copying web-server-specific policy. The
physical x86_64 campaign proves warm and twice-stopped-VM launch, singleton
service/listener/UI behavior, continued controlled transfer with no browser
view, persistent-profile recovery, and exact normal-uninstall and purge
ownership. It does not prove full reboot, suspend, signed update/rollback,
ARM64, incoming TCP, UDP tracker/DHT, uTP, or forwarding behavior. A later
physical storage campaign proves that the automatically mounted ChromeOS
Downloads path is not writable before **Share with Linux** and that its shared
9P path is materially slower than Crostini-local Btrfs for torrent-relevant
reads and writes. Tactical `178` keeps Linux `~/Downloads` as the recommended
default, explains its automatic **Linux files > Downloads** visibility, and
gives the exact opt-in sharing and selection steps in the Crostini React UI.

The efficiency advantage is architectural: the control boundary carries UI
state, while all frequent peer and file operations remain in one Rust process.
It does not establish a performance claim until measured against the Android
and desktop products.

### Android plus extension

Active Tactical
[`194`](../tactical/194-chromeos-android-extension-control.md) selects the
Android-plus-extension configuration for implementation. The Android
application operates normally on ChromeOS while exposing a narrow,
ChromeOS-only authenticated application-control surface to the extension.
This is not the current raw IO-companion architecture: the Android foreground
service owns the complete Rust application service and engine in-process,
while the extension packages the shared React application as another
client of its commands and views.

The extension and Compose UI therefore see the same Android profile. Either
surface may be attached without copying torrents or starting a second engine,
subject to the same revision, view-set, and lifecycle rules as other clients.

The cold-start handoff is materially less convenient than the Crostini path or
the Android app alone. The current ChromeOS behavior does not provide a
reliable one-action chain:

- the browser can make only a best-effort Android intent launch and ChromeOS
  requires an **Open with** confirmation;
- the remembered-launch choice is not reliable in current maintainer use; and
- Android now has a qualified candidate HTTPS UI-return path under Tactical
  `320`; public hosted/store delivery still needs qualification.

A cold user starts or confirms Android and completes native setup, then opens
Chrome through the handoff or returns manually to the extension. Once the
Android foreground service is already running,
the extension can reconnect directly. Product copy must describe this rather
than promise seamless launch.

Root acquisition is also client-neutral. The shared
`chooseDownloadRoot` interaction uses a Linux path picker for Crostini and an
Android-owned SAF picker for the Android host. Android keeps the URI and
grant private and returns only the resulting root snapshot. A new selected
tree becomes the one current/default root for future downloads; prior roots
and grants remain registered for the torrents already bound to them, and a
healthy retained root may be made current explicitly. Repair preserves the
root ID, and removal is allowed only when a root is neither current nor
referenced. The extension cannot submit a URI or silently redirect an existing
torrent.

Android plus extension remains a useful option for people who prefer the
extension's dense UI or want the same Android profile in both clients.
It remains the intended companion lane for current JSTorrent users, but
2026-09-30 direction permits a disclosed temporary browser-control gap during
replacement and removes uninterrupted continuity as a desktop rollout gate.
It should not dictate the primary ChromeOS flow while the two-action
cold start remains. The implemented promise is a familiar operating model after
a fresh RSTorrent install, root grant, and pairing; it does not import JSTorrent
torrents, settings, tokens, or verified state.

The selected security and topology boundary is deliberately local and narrow:
the extension uses the fixed ChromeOS ARC host and a bounded RSTorrent-only
port list, requests its exact host permission at the user's connect action,
and authenticates through explicit Android approval. Exact Host, extension
Origin, bearer credential, host/profile identity, resource bounds,
revocation, same-device routing evidence, and current Chrome Local Network
Access behavior are release gates. There is no network discovery, arbitrary
host input, LAN/tailnet/Internet claim, Android-served application shell, raw
file/socket/hash path, or media path in the first slice.

### Android alone

The Compose application remains the simplest ChromeOS path for a user who
wants Google Play installation and does not need the extension interface. It
uses the same Android host and profile as extension-controlled Android, so
changing between those two clients is not a migration.

Completed Tactical
[`117`](../tactical/117-jstorrent-shaped-android-product-ui.md) makes this a
credible primary path by adapting JSTorrent Android standalone's Library,
torrent-detail tabs, Speed, DHT, Logs, and Settings hierarchy to the typed
RSTorrent application. It retains RSTorrent branding and truthful capability
gaps rather than reproducing QuickJS or unsupported feature policy.

### ChromeOS choice and status

Maintainer direction on 2026-10-01 prioritizes full user-journey qualification
on both available physical Chromebooks, including Google Play not yet enabled,
failed/unavailable Android installation and an explicit Crostini route.
Tactical [253](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
owns the bounded onboarding, in-product troubleshooting and physical matrix.
Existing engine/emulator/one-device evidence does not close this gate.
Troubleshooting must be reachable before host connection and distinguish
observed failure stages from unknown Play/app/policy state. Android setup and
connection failures offer an explicit Linux choice where supported; switching
hosts retains the separate-library contract below. Neither available means
honest unsupported guidance, not an installation/retry loop. This is a ChromeOS
rollout priority and does not reinstate synchronized desktop/Android delivery.
The same direction selects host-built artifacts from an x86_64 Linux
development machine; physical Chromebooks need only installed runtime packages,
not Rust/build toolchains. Portable recovery presentation and deterministic
tests can proceed on the current workstation, and physical Android-only cases
do not depend on enabling Crostini. The exact Ubuntu 22.04 x86_64 package now resolves dependencies and runs in
cohort A's Debian 12 container. The administrative-start registration failure
is bounded to that path: ordinary Terminal startup registers the container and
hostname again. An offline connection page requests only optional access to
that exact hostname, validates bounded product/protocol health, retains manual
Retry/Cancel/help on failure and opens a fresh Linux document on success.
An older cached HTML shell must not retain obsolete package asset references;
an already connected warm tab is focused without reloading it. Isolated current
browser file-picker intake now passes, while current signed installation and
registered candidate Launcher delivery remain separate gates.
Cohort-A isolated Android approval/retry, shared-library recovery and controlled
file intake pass bounded slices. Both routes finish controlled 60-minute
observations and three independently verified recovery repetitions; Linux is
runtime evidence only. Test state is restored. Real Play installation, store
pairs and full lifecycle acceptance remain open under Tactical 253. On
2026-10-03 cohort B becomes available: its inherited Play app is the legacy
1.0.23 companion, the extension correctly requests an app update, and the
isolated current Android package passes three controlled byte-verified
download/source-offline restart repetitions. Fresh Linux setup and the signed
public-preview bootstrap also pass. Actual toolbar/OS launch, permission
denial/retry, Android pairing rejection and approval, shared-library file
intake/cancellation and keep-data removal also pass. Physical completion exposed
a strict-view contradiction, repaired
and repeated on a rebuilt APK. The initial completed-library cold restoration
showed temporary unavailability; the follow-up measures serial SAF observations,
bounds their overlap to four, and separates startup checking from view readiness.
Completed bytes and saved browser pairing recover within the existing timeout.
The registered public-preview and installed candidate launch their healthy
service; Chrome reports a DNS failure, and ChromeOS logs reject an empty IPv4
hostname registration. Normal Linux shutdown/Terminal restart does not repair
this cohort. Matching ChromeOS 150 release source and containerless/Baguette
logs now explain the empty-address registration path; an OS fix and renewed
browser qualification remain external. Setup guidance records this limitation.
Exact artifact hashes
and sustained outcomes belong to the tactical and private review report. Both
full 3,600-second observations verify bytes, including stable connected Android
completion; that original Linux pass remains runtime-only. The subsequent
dedicated-localhost slice separately qualifies the browser route on both
cohorts, as recorded at the top of this topic. Test-only state is removed,
the inherited Play app is preserved, and final device doctor passes ten checks.

The first-run UX should emphasize two host choices:

- **Use the Android app**, with optional extension remote control after the
  Android host is running; and
- **Use ChromeOS Linux with the extension**.

The product must not infer that Google Play, Android applications, or Crostini
is available from weak platform heuristics. It may remember an explicit user
choice and recognize a reachable, authenticated host. The extension should
always display whether it currently controls **Android** or **ChromeOS Linux**.

## Host Identity, Switching, And Isolation

The extension may remember separate pairings for desktop, Android, and
Crostini. Each successful connection should expose at least a host kind,
stable host instance identity, profile identity, application/control
protocol range, and current product version. Authentication tokens and
transport endpoints are scoped to that host identity.

Switching the extension from Android to Crostini switches libraries. It does
not move torrents, copy content, or reconcile progress. The UI must make that
transition visible so an apparently empty library is not mistaken for data
loss.

Android and Crostini cannot share live data or state:

- each owns its own profile database and verified-piece authority;
- Android SAF grants and document identities are not Linux paths;
- Crostini paths and ChromeOS **Share with Linux** state are not Android
  capabilities; and
- even when both can reach similarly named user files, concurrent ownership is
  unsafe without an explicit transfer and verification design.

The same torrent may be added independently to both hosts, but the product
must not imply synchronized intent or progress. A later cross-host move is
an explicit export/import operation, not live profile synchronization.

## Launch And Handoff UX

The current JSTorrent desktop and ChromeOS products show that a technically
working connection can still be difficult to understand. Product success
requires an explicit handoff model, not only a transport.

Every supported configuration should strive for these properties:

- the user can tell which host is installed, running, paired, and selected;
- one launch action opens or focuses the preferred client when the
  platform permits it;
- an action that merely requests another platform surface never reports that
  the surface definitely opened;
- starting or focusing a UI does not transfer or duplicate host ownership;
- a stopped host produces one actionable recovery path rather than a loop;
- closing a view does not silently stop active torrents unless the user chose
  that product behavior; and
- stale endpoints, tokens, versions, or instance identities fail closed and
  offer an understandable repair or re-pair action.

The unavoidable Android two-action cold start is an explicit exception, not a
failure to acknowledge in copy. Crostini may use its registered Linux Launcher
to wake the VM and then hand off to the extension. Desktop native messaging can
start or attach to the desktop host, but its exact window and process
lifecycle still requires a tactical.

## Later JSTorrent Graduation

The following records the pre-cutover plan; desktop 0.3.0 has since shipped
under JSTorrent and the incubation release track is frozen. Remaining migration
and store-delivery evidence continues under its owning tacticals.

RSTorrent's early work was an independent incubation beta. Desktop beta used
the `com.jstorrent.rstorrent` identifier, the RSTorrent update route, and its
own updater key so it can coexist safely with current JSTorrent installations.
There is no promise that an RSTorrent beta installation will silently change
into the production JSTorrent application.

The broad later goal is different: once the implementation is ready, ship it
as a normal JSTorrent desktop update while retaining JSTorrent branding,
`com.jstorrent.desktop`, and the updater trust root already embedded in
installed JSTorrent apps. The new release may present a refreshed interface
while using the Rust engine underneath.

Migration of useful legacy settings, torrent intent, and storage references is
best effort. Its exact source versions, fields, UX, and evidence will be chosen
from the products that exist when graduation work begins. Exhaustive parity or
migration of every historical profile and runtime detail is not a prerequisite.
Legacy completion claims still cannot become verified RSTorrent content without
the new engine's ordinary integrity checks.

Behavioral continuity is broader than database migration. Installation-level
usage context, feedback entry points, uninstall survey behavior, update
counting, privacy controls, and other small product journeys should be
evaluated intentionally against the then-current JSTorrent product rather than
silently disappearing in the rewrite. Tactical `208` implements the first such
closed behavior set with a fresh RSTorrent identity and counters; it explicitly
does not migrate JSTorrent's historical telemetry UUID or counter values. The
desktop beta may adopt its own prior updater UUID because that is the same
RSTorrent installation authority, not a JSTorrent migration.

This general direction reserves the production identity; it does not place the
JSTorrent updater private key in RSTorrent beta automation, authorize a
production update, or add migration work to the current beta checklist.

## Working Name And Product Identity

`RSTorrent` remains a historical incubation and internal component name because
it connects the Rust engine with JSTorrent's product lineage. Its similarity to the older
`rTorrent` name is acknowledged but is not currently considered a reason to
discard it: the visual and historical connection to JSTorrent is stronger in
this product context. `KTorrent` is not a practical alternative because it is
already the established KDE client name.

Maintainer direction on 2026-08-22 selects RSTorrent as the public product name
for the historical incubation line. The production replacement decision above
supersedes that earlier foreseeable-product policy.
Direction on 2026-08-23 selected
`com.jstorrent.rstorrent` as the incubation desktop identifier. Production
retains JSTorrent's installed application and extension audience while replacing
the engine. Maintainer direction on
2026-08-27 nevertheless makes every `0.1.x` identifier and installation
disposable incubation state rather than a compatibility obligation for the
first supported release. That identifier may remain in isolated development
builds; new releases use the JSTorrent production configuration.

## Existing Distribution And Coexistence

The existing JSTorrent desktop and extension identities and their installed
audiences are important assets. Production succession updates those products to
use the proven Rust application contract. The RSTorrent release track is frozen;
its retained artifacts and routes serve historical installs only. Exact
production extension/store delivery remains under the selected cutover campaign.
Preserving a familiar product capability does not require preserving its old
storage schema, JavaScript owner, Chrome-sync use, or unsafe privacy wording.

## Current Evidence And References

Current repository evidence already supplies useful parts of this direction:

- RSTorrent's application service has one profile-local typed SQLite authority
  with conservative recheck and transport-neutral commands.
- The leased application-view contract supports independent detachable clients
  and recovery after a view disappears or suspends.
- The Tauri and browser adapters already share one React client through
  different transports, while Android consumes the same semantic model through
  UniFFI and Compose.
- Tactical `170` proves the separate Linux-server composition on x86_64: one
  service process retains its application/profile/transfer/seed authority when
  every browser view detaches, then a fresh view recovers the same durable
  state. Its x86_64/ARM64 package construction does not turn desktop or mobile
  into clients of that service.
- The current JSTorrent checkout at `~/code/jstorrent` documents the extension
  engine, native-host bootstrap, profile conflict/takeover, IO daemon, Android
  companion, and Tauri split in `desktop/README.md`, `extension/README.md`, and
  `docs/contracts/`.
- The sibling `~/code/web-server-chrome` checkout records the signed Crostini
  installer, Launcher wake, local extension handoff, authenticated controller,
  and physical ChromeOS evidence in
  `docs/topics/chromeos-crostini-launcher.md`.

These are architecture and behavior references. This topic imports no source,
fixture, or wire contract from either sibling project.

## Open Decisions And Required Evidence

- Remaining store delivery and installed migration evidence after the desktop
  0.3.0 cutover through JSTorrent's existing product and updater identity.
- The exact desktop native-host and host process, single-instance, window, and
  shutdown ownership model. Desktop beta updating now adopts the external
  `desktop-update-v1` contract; its independent route/key, client presentation,
  and release pipeline are implemented through local gates, while hosted
  signed packages, route deployment, and installed evidence remain open in
  [`beta-release-readiness.md`](beta-release-readiness.md).
- Whether Tauri and extension views may remain attached simultaneously on
  desktop, and how command conflicts are presented.
- Production pairing, authentication, origin, rate, replay, token rotation,
  and protocol-compatibility policy for extension transports beyond Tactical
  `194`'s exact same-device ChromeOS Android boundary.
- Physical completion of Tactical `194`'s Android foreground-service,
  fixed-ARC endpoint, optional host permission, Local Network Access,
  pairing/revocation, same-device reachability, and cold-start recovery
  contract.
- Crostini update/rollback, suspend/reboot, shared-storage, physical native
  ARM64 runtime, and broader network contracts beyond the accepted public
  `crostini-v0.1.0` x86_64 installation and hosted two-architecture packages.
- Promoted signed public Linux-headless artifacts/stable manifest, native
  ARM64 systemd/update, representative mount/reboot, and long-run unattended
  evidence beyond the completed local x86_64 package/service campaign and
  signed source lane.
- The bounded best-effort set of legacy state worth migrating at graduation
  time.
- Physical desktop extension-control evidence and ChromeOS recovery from stale
  or incompatible signed installations.
- Physical ChromeOS TCP and UDP torrent behavior and representative Android
  versus Crostini resource and throughput measurements.
- iOS migration source and public distribution/release policy. Tacticals
  `147`--`149` select iOS 16+, SwiftUI, generated UniFFI, qualified on-device
  roots, finite lifecycle behavior, and reproducible development/archive
  packaging without App Store/TestFlight publication.

## Recommended Next Work

For the desktop migration campaign, Tactical `232` now has installed Linux,
Windows and macOS control checkpoints. Continue its broader browser lifecycle,
endurance and mixed-version/update-compatibility gates, tracked by Tactical
`231` and [`desktop-jstorrent-replacement.md`](desktop-jstorrent-replacement.md).
Tactical `241` implements atomic import against `233`'s Linux/Windows exports
with local crash, preservation and checker evidence. Tacticals 242/243 qualify
managed old-host fencing and bounded installed three-platform replacement.
244 resolves shared React unavailable-root presentation. Next resolve
support/privacy continuity.
No personal migration has run.
Existing independent release and platform campaigns below continue under
their own gates.

Completed Tactical `166` supplies historical store identity and installed
desktop bootstrap evidence. New signed desktop work uses JSTorrent's existing
identity and trust root; do not resume RSTorrent publication. Completed Tactical
`167` supplies the bounded ChromeOS Linux source package and physical handoff
evidence. Completed
Tactical `169` plus its separately authorized release operation supply signed
public `crostini-v0.1.0` artifacts and exact x86_64 website-install acceptance;
do not treat that as full extension control, physical ARM64 runtime,
update/rollback, or legacy migration.
Completed Tacticals `170` and `171` supply the first configured ordinary-user
Linux headless host, signed source update lane, exact trusted-LAN mode, and
installed x86_64 evidence. Treat public candidate/channel promotion,
system-wide ownership, native ARM64 service/update evidence, and owner remote
authentication as separate future operations or slices.
Tactical `194` implements the first migration-critical Android
JSTorrent-parity slice and physically proves the extension-controlled ChromeOS
journey, retained SAF-root selection/repair, and one Android engine/profile
owner. Its companion now binds only to ARC's fixed guest address: the exact
extension connects from ChromeOS while the Chromebook Wi-Fi address refuses
raw TCP and the formerly successful spoofed-Host/Origin request. Completion/
error notifications and metered/VPN enforcement remain the next core Android
release slices rather than additions to its completed transport boundary.
[`android-jstorrent-replacement.md`](android-jstorrent-replacement.md) now owns
the stricter Android production-replacement ledger, feature dispositions, and
coordinated extension rollout. When implementation is authorized, create its
bounded production-handoff tactical to fix the intentionally best-effort
legacy-state scope from then-current evidence before scheduling a store
replacement.

## Canonical repository consolidation, 2026-10-11

Tactical [305](../tactical/305-canonical-jstorrent-repository.md) owns the
authorized rename of the previous implementation to `jstorrent-typescript`
and this Rust implementation to `jstorrent`. Production updater routes,
application/store identities, original trust keys and immutable packages stay
unchanged. Release promotion distinguishes an approved repository alias from
changed bytes/source/trust. Existing signed headless/Crostini v1 identity remains
unchanged. Historical issue preservation and bulk legacy asset copying are not
required; bounded hosted asset/plugin continuity is. The original Chrome App
repository and local checkout directory names remain unchanged.
